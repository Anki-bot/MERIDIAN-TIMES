import {
  RuntimeSchemaError,
  isReadyWatchLayerRelease,
  parseRuntimeManifestJson,
  parseWatchLayerRelease,
} from "./runtime-schema";
import { PROFILE_IDS } from "./types";
import type {
  EnhancementProfile,
  PreparedAsset,
  PreparedProfile,
  ProfileId,
  PublicAssetRecord,
  ReadyWatchLayerRelease,
  RuntimeFailureCode,
  Sha256,
} from "./types";

export const RUNTIME_LOADER_CANCELLATION_REASONS = [
  "unmount",
  "profile-change",
] as const;

export type RuntimeLoaderCancellationReason =
  (typeof RUNTIME_LOADER_CANCELLATION_REASONS)[number];

/** A stable public failure that intentionally omits URLs, payloads, and schema details. */
export class RuntimeLoaderError extends Error {
  readonly code: RuntimeFailureCode;

  constructor(code: RuntimeFailureCode) {
    super(`Watch layer runtime loading failed (${code})`);
    this.code = code;
    this.name = "RuntimeLoaderError";
  }
}

/** Lifecycle cancellation is not an enhancement failure and should not publish a diagnostic. */
export class RuntimeLoaderCancelledError extends Error {
  readonly reason: RuntimeLoaderCancellationReason;

  constructor(reason: RuntimeLoaderCancellationReason) {
    super("Watch layer runtime loading was cancelled");
    this.name = "RuntimeLoaderCancelledError";
    this.reason = reason;
  }
}

export interface RuntimeLoaderResponse {
  readonly headers: Pick<Headers, "get">;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface RuntimeLoaderDependencies {
  readonly createAbortController: () => AbortController;
  readonly createImage: () => HTMLImageElement;
  readonly createObjectURL: (
    bytes: Uint8Array<ArrayBuffer>,
    mediaType: "image/webp",
  ) => string;
  readonly decodeImage: (image: HTMLImageElement) => Promise<void>;
  readonly digest: (
    algorithm: "SHA-256",
    bytes: Uint8Array<ArrayBuffer>,
  ) => Promise<ArrayBuffer>;
  readonly fetch: (
    input: string,
    init: Readonly<RequestInit>,
  ) => Promise<RuntimeLoaderResponse>;
  readonly revokeObjectURL: (objectUrl: string) => void;
}

export interface RuntimeProfileLoadInput<P extends ProfileId = ProfileId> {
  readonly profile: P;
  readonly release: ReadyWatchLayerRelease;
  /** Optional owner signal; aborting it is treated as unmount cleanup. */
  readonly signal?: AbortSignal;
}

export interface RuntimeProfileLoad<P extends ProfileId = ProfileId> {
  /** Resolves only after the entire selected profile has decoded and passed dimensions. */
  readonly promise: Promise<PreparedProfile<P>>;
  /** Idempotently aborts in-flight work and revokes every staged or prepared object URL. */
  cancel(reason?: RuntimeLoaderCancellationReason): void;
  /** Convenience alias for unmount cleanup. */
  dispose(): void;
}

interface ResponseFailureCodes {
  readonly fetch: RuntimeFailureCode;
  readonly identity: RuntimeFailureCode;
  readonly media: RuntimeFailureCode;
}

type LifecycleState = "loading" | "ready" | "cancelled" | "failed";

class RuntimeLoadLifecycle {
  readonly signal: AbortSignal;

  private readonly abortController: AbortController;
  private readonly dependencies: RuntimeLoaderDependencies;
  private readonly externalSignal: AbortSignal | undefined;
  private readonly images: HTMLImageElement[] = [];
  private readonly objectUrls: string[] = [];
  private cleaned = false;
  private cancellationError: RuntimeLoaderCancelledError | null = null;
  private state: LifecycleState = "loading";

  private readonly handleExternalAbort = (): void => {
    this.cancel("unmount");
  };

  constructor(
    dependencies: RuntimeLoaderDependencies,
    externalSignal: AbortSignal | undefined,
  ) {
    this.dependencies = dependencies;
    this.abortController = dependencies.createAbortController();
    this.signal = this.abortController.signal;
    this.externalSignal = externalSignal;

    if (externalSignal?.aborted === true) {
      this.cancel("unmount");
    } else {
      externalSignal?.addEventListener("abort", this.handleExternalAbort, { once: true });
    }
  }

  assertLoading(): void {
    if (this.cancellationError !== null) throw this.cancellationError;
    if (this.state !== "loading") throw new RuntimeLoaderError("runtime-invariant");
  }

  stageImage(image: HTMLImageElement): void {
    if (this.state !== "loading") {
      try {
        image.removeAttribute("src");
      } catch {
        // Cleanup is best-effort per image and continues for all remaining resources.
      }
      this.assertLoading();
    }
    this.images.push(image);
  }

  stageObjectUrl(objectUrl: string): void {
    if (this.state !== "loading") {
      try {
        this.dependencies.revokeObjectURL(objectUrl);
      } catch {
        // A re-entrant cancellation must not leak a just-created URL.
      }
      this.assertLoading();
    }
    this.objectUrls.push(objectUrl);
  }

  markReady(): void {
    this.assertLoading();
    this.state = "ready";
  }

  cancel(reason: RuntimeLoaderCancellationReason): void {
    if (this.state === "cancelled" || this.state === "failed") return;
    this.cancellationError = new RuntimeLoaderCancelledError(reason);
    this.state = "cancelled";
    this.cleanup();
  }

  fail(): RuntimeLoaderCancelledError | null {
    if (this.state === "cancelled") return this.cancellationError;
    if (this.state === "failed") return null;
    this.state = "failed";
    this.cleanup();
    return null;
  }

  private cleanup(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    this.externalSignal?.removeEventListener("abort", this.handleExternalAbort);

    try {
      this.abortController.abort();
    } catch {
      // Continue cleanup even if an injected AbortController is defective.
    }

    for (const image of this.images) {
      try {
        image.removeAttribute("src");
      } catch {
        // Continue cleanup for the remaining images and URLs.
      }
    }

    for (const objectUrl of this.objectUrls) {
      try {
        this.dependencies.revokeObjectURL(objectUrl);
      } catch {
        // Every staged URL receives exactly one revocation attempt.
      }
    }
  }
}

function loaderFailure(code: RuntimeFailureCode): RuntimeLoaderError {
  return new RuntimeLoaderError(code);
}

function bytesToHex(bytes: Uint8Array<ArrayBuffer>): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function assertSha256(
  bytes: Uint8Array<ArrayBuffer>,
  expected: Sha256,
  code: RuntimeFailureCode,
  dependencies: RuntimeLoaderDependencies,
): Promise<void> {
  let digest: ArrayBuffer;
  try {
    digest = await dependencies.digest("SHA-256", bytes);
  } catch {
    throw loaderFailure(code);
  }
  const digestBytes = new Uint8Array(digest);
  if (digestBytes.byteLength !== 32 || bytesToHex(digestBytes) !== expected) {
    throw loaderFailure(code);
  }
}

function exactMediaType(
  response: RuntimeLoaderResponse,
  expected: string,
  code: RuntimeFailureCode,
): void {
  let actual: string | null;
  try {
    actual = response.headers.get("content-type");
  } catch {
    throw loaderFailure(code);
  }
  if (actual !== expected) throw loaderFailure(code);
}

async function fetchVerifiedBytes(
  publicPath: string,
  mediaType: "application/json" | "image/webp",
  byteLength: number,
  sha256: Sha256,
  failureCodes: ResponseFailureCodes,
  lifecycle: RuntimeLoadLifecycle,
  dependencies: RuntimeLoaderDependencies,
): Promise<Uint8Array<ArrayBuffer>> {
  lifecycle.assertLoading();

  let response: RuntimeLoaderResponse;
  try {
    response = await dependencies.fetch(publicPath, Object.freeze({
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
      mode: "same-origin",
      redirect: "error",
      signal: lifecycle.signal,
    } satisfies RequestInit));
  } catch {
    throw loaderFailure(failureCodes.fetch);
  }
  lifecycle.assertLoading();

  if (response === null || typeof response !== "object" || response.status !== 200) {
    throw loaderFailure(failureCodes.fetch);
  }
  exactMediaType(response, mediaType, failureCodes.media);

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    throw loaderFailure(failureCodes.fetch);
  }
  lifecycle.assertLoading();

  if (
    Object.prototype.toString.call(buffer) !== "[object ArrayBuffer]"
    || buffer.byteLength !== byteLength
  ) {
    throw loaderFailure(failureCodes.identity);
  }
  const bytes = new Uint8Array(buffer);
  await assertSha256(bytes, sha256, failureCodes.identity, dependencies);
  lifecycle.assertLoading();
  return bytes;
}

function validateReadyRelease(value: ReadyWatchLayerRelease): ReadyWatchLayerRelease {
  try {
    const parsed = parseWatchLayerRelease(value);
    if (!isReadyWatchLayerRelease(parsed)) throw loaderFailure("manifest-identity");
    return parsed;
  } catch (error) {
    if (error instanceof RuntimeLoaderError) throw error;
    throw loaderFailure("manifest-identity");
  }
}

function validateProfileId<P extends ProfileId>(profile: P): P {
  if (!PROFILE_IDS.includes(profile)) throw loaderFailure("runtime-invariant");
  return profile;
}

function parseVerifiedManifest(
  bytes: Uint8Array<ArrayBuffer>,
  release: ReadyWatchLayerRelease,
) {
  try {
    return parseRuntimeManifestJson(bytes, release);
  } catch (error) {
    if (error instanceof RuntimeSchemaError) {
      throw loaderFailure(
        error.code === "manifest-identity" ? "manifest-identity" : "manifest-schema",
      );
    }
    throw loaderFailure("manifest-schema");
  }
}

function assertWebpSignature(
  bytes: Uint8Array<ArrayBuffer>,
  record: PublicAssetRecord,
): void {
  if (
    bytes.byteLength < 12
    || bytesToHex(bytes.slice(0, 12)) !== record.magicSignatureHex
  ) {
    throw loaderFailure("asset-identity");
  }
}

async function prepareAsset<P extends ProfileId>(
  record: PublicAssetRecord<P>,
  lifecycle: RuntimeLoadLifecycle,
  dependencies: RuntimeLoaderDependencies,
): Promise<PreparedAsset<P>> {
  const bytes = await fetchVerifiedBytes(
    record.publicPath,
    record.mediaType,
    record.byteLength,
    record.sha256,
    {
      fetch: "asset-fetch",
      identity: "asset-identity",
      media: "asset-media",
    },
    lifecycle,
    dependencies,
  );
  assertWebpSignature(bytes, record);
  lifecycle.assertLoading();

  let objectUrl: string;
  try {
    objectUrl = dependencies.createObjectURL(bytes, record.mediaType);
  } catch {
    throw loaderFailure("asset-decode");
  }
  if (typeof objectUrl !== "string" || objectUrl.length === 0) {
    throw loaderFailure("asset-decode");
  }
  lifecycle.stageObjectUrl(objectUrl);

  let image: HTMLImageElement;
  try {
    image = dependencies.createImage();
  } catch {
    throw loaderFailure("asset-decode");
  }
  if (image === null || typeof image !== "object" || Boolean(image.isConnected)) {
    throw loaderFailure("asset-decode");
  }
  lifecycle.stageImage(image);

  try {
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    image.src = objectUrl;
    await dependencies.decodeImage(image);
  } catch {
    throw loaderFailure("asset-decode");
  }
  lifecycle.assertLoading();

  if (
    Boolean(image.isConnected)
    || image.naturalWidth !== record.intrinsicWidth
    || image.naturalHeight !== record.intrinsicHeight
  ) {
    throw loaderFailure("asset-dimensions");
  }

  return Object.freeze({ image, objectUrl, record });
}

async function prepareProfile<P extends ProfileId>(
  input: RuntimeProfileLoadInput<P>,
  lifecycle: RuntimeLoadLifecycle,
  dependencies: RuntimeLoaderDependencies,
): Promise<PreparedProfile<P>> {
  const release = validateReadyRelease(input.release);
  const profileId = validateProfileId(input.profile);
  lifecycle.assertLoading();

  const manifestBytes = await fetchVerifiedBytes(
    release.runtimeManifest.publicPath,
    release.runtimeManifest.mediaType,
    release.runtimeManifest.byteLength,
    release.runtimeManifest.sha256,
    {
      fetch: "manifest-fetch",
      identity: "manifest-identity",
      media: "manifest-media",
    },
    lifecycle,
    dependencies,
  );
  const manifest = parseVerifiedManifest(manifestBytes, release);
  const profile = manifest.profiles[profileId] as EnhancementProfile<P>;

  const assets = Object.freeze(await Promise.all(profile.assets.map((record) => (
    prepareAsset(record as PublicAssetRecord<P>, lifecycle, dependencies)
  ))));
  lifecycle.assertLoading();

  const prepared = Object.freeze({
    assets,
    id: profileId,
    manifest,
    profile,
    release,
  }) satisfies PreparedProfile<P>;
  lifecycle.markReady();
  return prepared;
}

export function createBrowserRuntimeLoaderDependencies(): RuntimeLoaderDependencies {
  const browserFetch = globalThis.fetch;
  const browserCrypto = globalThis.crypto?.subtle;
  const BrowserImage = globalThis.Image;
  const BrowserAbortController = globalThis.AbortController;
  const createObjectURL = globalThis.URL?.createObjectURL;
  const revokeObjectURL = globalThis.URL?.revokeObjectURL;

  if (
    typeof browserFetch !== "function"
    || browserCrypto === undefined
    || typeof browserCrypto.digest !== "function"
    || typeof BrowserImage !== "function"
    || typeof BrowserAbortController !== "function"
    || typeof createObjectURL !== "function"
    || typeof revokeObjectURL !== "function"
  ) {
    throw loaderFailure("runtime-invariant");
  }

  return Object.freeze({
    createAbortController: () => new BrowserAbortController(),
    createImage: () => new BrowserImage(),
    createObjectURL: (bytes: Uint8Array<ArrayBuffer>, mediaType: "image/webp") => (
      createObjectURL.call(globalThis.URL, new Blob([bytes], { type: mediaType }))
    ),
    decodeImage: (image: HTMLImageElement) => image.decode(),
    digest: (algorithm: "SHA-256", bytes: Uint8Array<ArrayBuffer>) => (
      browserCrypto.digest(algorithm, bytes) as Promise<ArrayBuffer>
    ),
    fetch: (input: string, init: Readonly<RequestInit>) => browserFetch(input, init),
    revokeObjectURL: (objectUrl: string) => {
      revokeObjectURL.call(globalThis.URL, objectUrl);
    },
  });
}

/**
 * Starts one selected-profile load. The returned handle must be cancelled/disposed
 * by its owner on unmount or profile replacement, including after successful resolve.
 */
export function startRuntimeProfileLoad<P extends ProfileId>(
  input: RuntimeProfileLoadInput<P>,
  dependencies: RuntimeLoaderDependencies = createBrowserRuntimeLoaderDependencies(),
): RuntimeProfileLoad<P> {
  const lifecycle = new RuntimeLoadLifecycle(dependencies, input.signal);
  const promise = prepareProfile(input, lifecycle, dependencies).catch((error: unknown) => {
    const cancellation = lifecycle.fail();
    if (cancellation !== null) throw cancellation;
    if (error instanceof RuntimeLoaderError) throw error;
    throw loaderFailure("runtime-invariant");
  });

  return Object.freeze({
    cancel: (reason: RuntimeLoaderCancellationReason = "unmount") => {
      lifecycle.cancel(reason);
    },
    dispose: () => {
      lifecycle.cancel("unmount");
    },
    promise,
  });
}
