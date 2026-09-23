import { createHash } from "node:crypto";
import fc from "fast-check";
import { expect, it } from "vitest";
import {
  classifyBrowserSupport,
  runSuccessorLoaderIfSupported,
} from "@/lib/watch-2-5d/browser-support";
import type {
  BrowserSupportEnvironment,
} from "@/lib/watch-2-5d/browser-support";
import {
  RuntimeLoaderCancelledError,
  RuntimeLoaderError,
  startRuntimeProfileLoad,
} from "@/lib/watch-2-5d/runtime-loader";
import type {
  RuntimeLoaderDependencies,
  RuntimeLoaderResponse,
  RuntimeProfileLoad,
} from "@/lib/watch-2-5d/runtime-loader";
import {
  createEnhancementState,
  getEnhancementDiagnosticCode,
  transitionEnhancementState,
} from "@/lib/watch-2-5d/runtime-state";
import type {
  EnhancementEvent,
  EnhancementState,
} from "@/lib/watch-2-5d/runtime-state";
import {
  isReadyWatchLayerRelease,
  parseRuntimeManifestJson,
  parseWatchLayerRelease,
} from "@/lib/watch-2-5d/runtime-schema";
import {
  CANONICAL_MASTER_SHA256,
  RUNTIME_FAILURE_CODES,
  SUPPORT_CODES,
} from "@/lib/watch-2-5d/types";
import type {
  PreparedAsset,
  PreparedProfile,
  ProfileId,
  PublicAssetRecord,
  ReadyWatchLayerRelease,
  RuntimeFailureCode,
  Sha256,
  SupportCode,
  ValidatedRuntimeManifest,
} from "@/lib/watch-2-5d/types";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 11: Atomic enhancement loader and fail-once fallback";

// Reproduce with: seed=20260825, numRuns=128.
const PROPERTY_SEED = 20_260_825;
const PROPERTY_RUNS = 128;
const MANIFEST_PATH = "/assets/watch-2-5d/v1/runtime-manifest.json";
const MAX_ASSETS = 3;
const SUCCESSFUL_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UNSUPPORTED_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

type Bytes = Uint8Array<ArrayBuffer>;
type JsonRecord = Record<string, unknown>;
type FetchOutcome = "success" | "fetch-failure" | "media-failure" | "identity-failure";
type DecodeOutcome = "success" | "decode-failure" | "dimensions-failure";
type ReferenceStage =
  | "unsupported"
  | "loading-manifest"
  | "loading-assets"
  | "mounting-hidden"
  | "ready"
  | "profile-switch-loading"
  | "profile-switch-mounting"
  | "error";
type FetchStatus = "not-requested" | "pending" | "succeeded";
type DecodeStatus = "not-started" | "pending" | "succeeded";

interface CapabilityTuple {
  readonly abortController: boolean;
  readonly animationFrame: boolean;
  readonly browser: boolean;
  readonly cancelAnimationFrame: boolean;
  readonly cssCustomProperties: boolean;
  readonly cssTransform: boolean;
  readonly digest: boolean;
  readonly fetch: boolean;
  readonly imageDecode: boolean;
  readonly matchMedia: boolean;
  readonly pageVisibility: boolean;
  readonly resizeObserver: boolean;
}

interface PropertyScenario {
  readonly assetCount: number;
  readonly assetPriorities: readonly number[];
  readonly capabilities: CapabilityTuple;
  readonly decodePriorities: readonly number[];
  readonly initialProfile: ProfileId;
  readonly switchElapsedIncrement: number;
  readonly token: number;
}

interface RuntimeFixture {
  readonly assetCount: number;
  readonly assetPaths: Readonly<Record<ProfileId, readonly string[]>>;
  readonly bodies: ReadonlyMap<string, Bytes>;
  readonly recordByPath: ReadonlyMap<string, PublicAssetRecord>;
  readonly release: ReadyWatchLayerRelease;
  readonly validatedManifest: ValidatedRuntimeManifest;
}

interface ReferenceLoad {
  readonly profile: ProfileId;
  readonly switching: boolean;
  manifestPending: boolean;
  readonly fetches: FetchStatus[];
  readonly decodes: DecodeStatus[];
  liveResources: number;
}

interface ReferenceModel {
  readonly assetCount: number;
  activeElapsedMs: number;
  atomicReadyTransitions: number;
  cleanedLoads: number;
  cleanedResources: number;
  currentProfile: ProfileId;
  diagnostic: RuntimeFailureCode | null;
  disposed: boolean;
  failureRequestCount: number | null;
  load: ReferenceLoad | null;
  loaderStarts: number;
  requests: number;
  stage: ReferenceStage;
  supported: boolean;
  terminalFailures: number;
  totalResources: number;
}

interface RealModel {
  readonly controller: RuntimeController;
}

interface LoadEpoch {
  readonly id: number;
  readonly profile: ProfileId;
  readonly switching: boolean;
  abortCalls: number;
  completion: "pending" | "succeeded" | "failed" | "cancelled";
  handle: RuntimeProfileLoad | null;
  manifestAnnounced: boolean;
  prepared: PreparedProfile | null;
  settled: Promise<void>;
}

interface PendingFetch {
  readonly deferred: Deferred<RuntimeLoaderResponse>;
  readonly epoch: LoadEpoch;
  readonly path: string;
}

interface PendingDecode {
  readonly deferred: Deferred<Exclude<DecodeOutcome, "decode-failure">>;
  readonly epoch: LoadEpoch;
  readonly image: HTMLImageElement;
  readonly path: string;
}

interface ObjectUrlRecord {
  readonly epoch: LoadEpoch;
  readonly path: string;
  revoked: number;
}

const ALL_CAPABILITIES: CapabilityTuple = Object.freeze({
  abortController: true,
  animationFrame: true,
  browser: true,
  cancelAnimationFrame: true,
  cssCustomProperties: true,
  cssTransform: true,
  digest: true,
  fetch: true,
  imageDecode: true,
  matchMedia: true,
  pageVisibility: true,
  resizeObserver: true,
});

const arbitraryCapabilityTuple: fc.Arbitrary<CapabilityTuple> = fc.oneof(
  { arbitrary: fc.constant(ALL_CAPABILITIES), weight: 3 },
  {
    arbitrary: fc.record({
      abortController: fc.boolean(),
      animationFrame: fc.boolean(),
      browser: fc.boolean(),
      cancelAnimationFrame: fc.boolean(),
      cssCustomProperties: fc.boolean(),
      cssTransform: fc.boolean(),
      digest: fc.boolean(),
      fetch: fc.boolean(),
      imageDecode: fc.boolean(),
      matchMedia: fc.boolean(),
      pageVisibility: fc.boolean(),
      resizeObserver: fc.boolean(),
    }),
    weight: 7,
  },
);

const scenarioArbitrary: fc.Arbitrary<PropertyScenario> = fc.record({
  assetCount: fc.integer({ min: 1, max: MAX_ASSETS }),
  assetPriorities: fc.array(fc.nat({ max: 1_000_000 }), {
    minLength: MAX_ASSETS,
    maxLength: MAX_ASSETS,
  }),
  capabilities: arbitraryCapabilityTuple,
  decodePriorities: fc.array(fc.nat({ max: 1_000_000 }), {
    minLength: MAX_ASSETS,
    maxLength: MAX_ASSETS,
  }),
  initialProfile: fc.constantFrom<ProfileId>("compact", "expanded"),
  switchElapsedIncrement: fc.nat({ max: 60_000 }),
  token: fc.nat({ max: 1_000_000 }),
});

const fetchOutcomeArbitrary = fc.oneof(
  { arbitrary: fc.constant<FetchOutcome>("success"), weight: 12 },
  { arbitrary: fc.constant<FetchOutcome>("fetch-failure"), weight: 1 },
  { arbitrary: fc.constant<FetchOutcome>("media-failure"), weight: 1 },
  { arbitrary: fc.constant<FetchOutcome>("identity-failure"), weight: 1 },
);
const decodeOutcomeArbitrary = fc.oneof(
  { arbitrary: fc.constant<DecodeOutcome>("success"), weight: 12 },
  { arbitrary: fc.constant<DecodeOutcome>("decode-failure"), weight: 1 },
  { arbitrary: fc.constant<DecodeOutcome>("dimensions-failure"), weight: 1 },
);

class Deferred<T> {
  readonly promise: Promise<T>;
  settled = false;
  private readonly rejectPromise: (reason?: unknown) => void;
  private readonly resolvePromise: (value: T) => void;

  constructor() {
    let rejectPromise!: (reason?: unknown) => void;
    let resolvePromise!: (value: T) => void;
    this.promise = new Promise<T>((resolve, reject) => {
      rejectPromise = reject;
      resolvePromise = resolve;
    });
    this.rejectPromise = rejectPromise;
    this.resolvePromise = resolvePromise;
  }

  reject(reason?: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise(reason);
  }

  resolve(value: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolvePromise(value);
  }
}

function sha256(bytes: Bytes): Sha256 {
  return createHash("sha256").update(bytes).digest("hex") as Sha256;
}

function digest(bytes: Bytes): ArrayBuffer {
  return Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer;
}

function bytesToHex(bytes: Bytes): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function webpBytes(token: number, profileIndex: number, assetIndex: number): Bytes {
  const bytes = new Uint8Array(32) as Bytes;
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  for (let index = 4; index < 8; index += 1) {
    bytes[index] = (token + profileIndex * 71 + assetIndex * 43 + index * 19) & 0xff;
  }
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  for (let index = 12; index < bytes.length; index += 1) {
    bytes[index] = (token * 17 + profileIndex * 89 + assetIndex * 53 + index * 29) & 0xff;
  }
  return bytes;
}

function sourceRect(assetIndex: number): Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}> {
  if (assetIndex === 0) return { height: 1_504, width: 2_760, x: 0, y: 0 };
  return {
    height: 80 + assetIndex * 4,
    width: 120 + assetIndex * 4,
    x: 100 * assetIndex,
    y: 80 * assetIndex,
  };
}

function makeAsset(
  profile: ProfileId,
  profileIndex: number,
  assetIndex: number,
  token: number,
  bytes: Bytes,
): JsonRecord {
  const rect = sourceRect(assetIndex);
  const scale = profile === "compact" ? 0.5 : 1;
  const intrinsicWidth = Math.ceil(rect.width * scale);
  const intrinsicHeight = Math.ceil(rect.height * scale);
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  const name = assetIndex === 0
    ? `reconstructed-background-${token.toString(36)}`
    : `layer-${assetIndex}-${token.toString(36)}`;
  const publicPath = `/assets/watch-2-5d/v1/${profile}/${name}.webp`;

  return {
    byteLength: bytes.byteLength,
    colorMetadata: { alpha: true, channels: 4, colourspace: "srgb" },
    decodedPixelCount,
    decodedRgbaByteLength: decodedPixelCount * 4,
    encoder: {
      alphaQuality: 100,
      channels: 4,
      colourspace: "srgb",
      effort: 6,
      nearLossless: false,
      quality: 95,
      smartSubsample: true,
    },
    file: `public${publicPath}`,
    id: `${profile}-asset-${assetIndex}-${token.toString(36)}`,
    intrinsicHeight,
    intrinsicWidth,
    layerId: assetIndex === 0 ? "reconstructed-background" : `watch-layer-${assetIndex}`,
    magicSignatureHex: bytesToHex(bytes.slice(0, 12) as Bytes),
    mediaType: "image/webp",
    profile,
    publicPath,
    sha256: sha256(bytes),
    sourceRect: rect,
    zOrder: assetIndex,
    profileIndex,
  };
}

function makeProfile(profile: ProfileId, assets: readonly JsonRecord[]): JsonRecord {
  return {
    assets,
    decodedRgbaBytes: assets.reduce(
      (total, asset) => total + Number(asset.decodedRgbaByteLength),
      0,
    ),
    id: profile,
    requestCountIncludingManifest: assets.length + 1,
    sourceScale: profile === "compact" ? 0.5 : 1,
    transferBytes: assets.reduce(
      (total, asset) => total + Number(asset.byteLength),
      0,
    ),
  };
}

function createFixture(scenario: PropertyScenario): RuntimeFixture {
  const bodies = new Map<string, Bytes>();
  const profileAssets = {} as Record<ProfileId, JsonRecord[]>;

  (["compact", "expanded"] as const).forEach((profile, profileIndex) => {
    profileAssets[profile] = Array.from({ length: scenario.assetCount }, (_, assetIndex) => {
      const bytes = webpBytes(scenario.token, profileIndex, assetIndex);
      const asset = makeAsset(profile, profileIndex, assetIndex, scenario.token, bytes);
      delete asset.profileIndex;
      bodies.set(String(asset.publicPath), bytes);
      return asset;
    });
  });

  const manifest: JsonRecord = {
    canonicalMasterSha256: CANONICAL_MASTER_SHA256,
    depthProfiles: [],
    motionProfiles: [],
    packageId: `watch-package-${scenario.token.toString(36)}`,
    phase: "static-layered-reconstruction",
    profiles: {
      compact: makeProfile("compact", profileAssets.compact),
      expanded: makeProfile("expanded", profileAssets.expanded),
    },
    releaseId: `watch-release-${scenario.token.toString(36)}`,
    schemaVersion: 1,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)) as Bytes;
  bodies.set(MANIFEST_PATH, manifestBytes);
  const parsedRelease = parseWatchLayerRelease({
    depthEnabled: false,
    packageId: manifest.packageId,
    releaseId: manifest.releaseId,
    runtimeManifest: {
      byteLength: manifestBytes.byteLength,
      mediaType: "application/json",
      publicPath: MANIFEST_PATH,
      sha256: sha256(manifestBytes),
    },
    schemaVersion: 1,
    status: "ready",
  });
  if (!isReadyWatchLayerRelease(parsedRelease)) {
    throw new Error("Generated ready release parsed as fallback-only");
  }
  const validatedManifest = parseRuntimeManifestJson(manifestBytes, parsedRelease);
  const assetPaths = {
    compact: validatedManifest.profiles.compact.assets.map(({ publicPath }) => publicPath),
    expanded: validatedManifest.profiles.expanded.assets.map(({ publicPath }) => publicPath),
  };
  const recordByPath = new Map<string, PublicAssetRecord>();
  for (const profile of ["compact", "expanded"] as const) {
    for (const record of validatedManifest.profiles[profile].assets) {
      recordByPath.set(record.publicPath, record);
    }
  }
  return {
    assetCount: scenario.assetCount,
    assetPaths,
    bodies,
    recordByPath,
    release: parsedRelease,
    validatedManifest,
  };
}

function referenceSupports(tuple: CapabilityTuple): boolean {
  return tuple.abortController
    && tuple.animationFrame
    && tuple.browser
    && tuple.cancelAnimationFrame
    && tuple.cssCustomProperties
    && tuple.cssTransform
    && tuple.digest
    && tuple.fetch
    && tuple.imageDecode
    && tuple.matchMedia
    && tuple.pageVisibility
    && tuple.resizeObserver;
}

function createSupportEnvironment(
  tuple: CapabilityTuple,
  externalRequests: { count: number },
): BrowserSupportEnvironment {
  class DecodableImage {}
  if (tuple.imageDecode) {
    Object.defineProperty(DecodableImage.prototype, "decode", {
      value: () => Promise.resolve(),
    });
  }

  return {
    AbortController: tuple.abortController ? class AbortControllerCapability {} : undefined,
    CSS: {
      supports: (property: string) => (
        (property === "transform" && tuple.cssTransform)
        || (property === "--watch-layer-support" && tuple.cssCustomProperties)
      ),
    },
    HTMLImageElement: DecodableImage,
    ResizeObserver: tuple.resizeObserver ? class ResizeObserverCapability {} : undefined,
    cancelAnimationFrame: tuple.cancelAnimationFrame ? () => undefined : undefined,
    crypto: tuple.digest
      ? { subtle: { digest: () => Promise.resolve(new ArrayBuffer(32)) } }
      : { subtle: {} },
    document: tuple.pageVisibility
      ? {
          addEventListener: () => undefined,
          hidden: false,
          removeEventListener: () => undefined,
          visibilityState: "visible",
        }
      : {},
    fetch: tuple.fetch
      ? () => {
          externalRequests.count += 1;
          throw new Error("Browser environment fetch must never execute in this property");
        }
      : undefined,
    matchMedia: tuple.matchMedia ? () => ({ matches: false }) : undefined,
    requestAnimationFrame: tuple.animationFrame ? () => 1 : undefined,
    userAgent: tuple.browser ? SUCCESSFUL_BROWSER_UA : UNSUPPORTED_BROWSER_UA,
  };
}

function changedLastByte(bytes: Bytes): Bytes {
  const changed = bytes.slice() as Bytes;
  changed[changed.length - 1] ^= 0xff;
  return changed;
}

function responseFor(path: string, expected: Bytes, outcome: FetchOutcome): RuntimeLoaderResponse {
  const isManifest = path === MANIFEST_PATH;
  const responseBytes = outcome === "identity-failure" ? changedLastByte(expected) : expected;
  const mediaType = outcome === "media-failure"
    ? isManifest ? "application/json; charset=utf-8" : "image/avif"
    : isManifest ? "application/json" : "image/webp";
  return {
    arrayBuffer: async () => responseBytes.slice().buffer,
    headers: {
      get: (name: string) => name.toLowerCase() === "content-type" ? mediaType : null,
    },
    status: 200,
  };
}

async function drainMicrotasks(count = 16): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

async function waitUntil(
  predicate: () => boolean,
  label: string,
): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

class InjectedRuntimeDependencies {
  readonly dependencies: RuntimeLoaderDependencies;
  readonly epochs: LoadEpoch[] = [];
  readonly externalRequests: { count: number };
  readonly images: HTMLImageElement[] = [];
  readonly objectUrls = new Map<string, ObjectUrlRecord>();
  readonly requestLog: { readonly epochId: number; readonly path: string }[] = [];

  private readonly fixture: RuntimeFixture;
  private readonly onAssetDecoded: (
    epoch: LoadEpoch,
    path: string,
    image: HTMLImageElement,
    objectUrl: string,
  ) => void;
  private readonly onManifestAccepted: (epoch: LoadEpoch) => void;
  private readonly pathByBodyHash = new Map<string, string>();
  private readonly pendingDecodes = new Map<string, PendingDecode>();
  private readonly pendingFetches = new Map<string, PendingFetch>();
  private readonly signalEpoch = new WeakMap<AbortSignal, LoadEpoch>();
  private readonly imageDecodeKey = new WeakMap<HTMLImageElement, string>();
  private currentEpoch: LoadEpoch | null = null;
  private objectUrlOrdinal = 0;

  constructor(
    fixture: RuntimeFixture,
    externalRequests: { count: number },
    onManifestAccepted: (epoch: LoadEpoch) => void,
    onAssetDecoded: (
      epoch: LoadEpoch,
      path: string,
      image: HTMLImageElement,
      objectUrl: string,
    ) => void,
  ) {
    this.fixture = fixture;
    this.externalRequests = externalRequests;
    this.onManifestAccepted = onManifestAccepted;
    this.onAssetDecoded = onAssetDecoded;
    for (const [path, bytes] of fixture.bodies) {
      if (path !== MANIFEST_PATH) this.pathByBodyHash.set(sha256(bytes), path);
    }

    this.dependencies = {
      createAbortController: () => this.createAbortController(),
      createImage: () => this.createImage(),
      createObjectURL: (bytes) => this.createObjectURL(bytes),
      decodeImage: (image) => this.decodeImage(image),
      digest: async (_algorithm, bytes) => digest(bytes),
      fetch: (input, init) => this.fetch(input, init),
      revokeObjectURL: (objectUrl) => this.revokeObjectURL(objectUrl),
    };
  }

  setCurrentEpoch(epoch: LoadEpoch | null): void {
    this.currentEpoch = epoch;
  }

  pendingManifest(epoch: LoadEpoch): boolean {
    return this.pendingFetches.has(this.fetchKey(epoch, MANIFEST_PATH));
  }

  pendingAsset(epoch: LoadEpoch, index: number): boolean {
    const path = this.fixture.assetPaths[epoch.profile][index];
    return path !== undefined && this.pendingFetches.has(this.fetchKey(epoch, path));
  }

  pendingDecode(epoch: LoadEpoch, index: number): boolean {
    const path = this.fixture.assetPaths[epoch.profile][index];
    return path !== undefined && this.pendingDecodes.has(this.fetchKey(epoch, path));
  }

  pendingAssetFetchCount(epoch: LoadEpoch): number {
    return this.fixture.assetPaths[epoch.profile].filter((path) => (
      this.pendingFetches.has(this.fetchKey(epoch, path))
    )).length;
  }

  settleManifest(epoch: LoadEpoch, outcome: FetchOutcome): void {
    this.settleFetch(epoch, MANIFEST_PATH, outcome);
  }

  settleAsset(epoch: LoadEpoch, index: number, outcome: FetchOutcome): void {
    const path = this.fixture.assetPaths[epoch.profile][index];
    if (path === undefined) throw new Error(`Missing generated asset ${index}`);
    this.settleFetch(epoch, path, outcome);
  }

  settleDecode(epoch: LoadEpoch, index: number, outcome: DecodeOutcome): void {
    const path = this.fixture.assetPaths[epoch.profile][index];
    if (path === undefined) throw new Error(`Missing generated decode asset ${index}`);
    const key = this.fetchKey(epoch, path);
    const pending = this.pendingDecodes.get(key);
    if (pending === undefined) throw new Error(`No pending decode for ${key}`);
    if (outcome === "decode-failure") {
      pending.deferred.reject(new Error("injected decode failure"));
    } else {
      pending.deferred.resolve(outcome);
    }
  }

  totalAbortCalls(): number {
    return this.epochs.reduce((total, epoch) => total + epoch.abortCalls, 0);
  }

  totalRevocations(): number {
    return [...this.objectUrls.values()].reduce((total, record) => total + record.revoked, 0);
  }

  assertRequestMembership(): void {
    for (const epoch of this.epochs) {
      const actual = this.requestLog
        .filter(({ epochId }) => epochId === epoch.id)
        .map(({ path }) => path);
      const allowed = new Set([MANIFEST_PATH, ...this.fixture.assetPaths[epoch.profile]]);
      expect(actual.every((path) => allowed.has(path))).toBe(true);
      expect(new Set(actual).size).toBe(actual.length);
    }
  }

  assertCompleteCleanup(): void {
    expect(this.pendingFetches.size).toBe(0);
    expect(this.pendingDecodes.size).toBe(0);
    for (const epoch of this.epochs) expect(epoch.abortCalls).toBe(1);
    for (const record of this.objectUrls.values()) expect(record.revoked).toBe(1);
    expect(this.images.every((image) => !image.hasAttribute("src"))).toBe(true);
    expect(this.externalRequests.count).toBe(0);
  }

  private fetchKey(epoch: LoadEpoch, path: string): string {
    return `${epoch.id}:${path}`;
  }

  private requireCurrentEpoch(): LoadEpoch {
    if (this.currentEpoch === null) throw new Error("Runtime dependency used without an epoch");
    return this.currentEpoch;
  }

  private createAbortController(): AbortController {
    const epoch = this.requireCurrentEpoch();
    const native = new AbortController();
    const controller = {
      abort: () => {
        epoch.abortCalls += 1;
        native.abort();
      },
      signal: native.signal,
    } as AbortController;
    this.signalEpoch.set(native.signal, epoch);
    return controller;
  }

  private createImage(): HTMLImageElement {
    const image = document.createElement("img");
    const nativeRemoveAttribute = image.removeAttribute.bind(image);
    image.removeAttribute = (name: string): void => {
      if (name === "src") {
        const key = this.imageDecodeKey.get(image);
        if (key !== undefined) {
          this.pendingDecodes.get(key)?.deferred.reject(
            new DOMException("cancelled", "AbortError"),
          );
        }
      }
      nativeRemoveAttribute(name);
    };
    this.images.push(image);
    return image;
  }

  private createObjectURL(bytes: Bytes): string {
    const epoch = this.requireCurrentEpoch();
    const path = this.pathByBodyHash.get(sha256(bytes));
    if (path === undefined) throw new Error("Object URL requested for unverified bytes");
    const objectUrl = `blob:watch-2-5d/${epoch.id}/${this.objectUrlOrdinal += 1}`;
    this.objectUrls.set(objectUrl, { epoch, path, revoked: 0 });
    return objectUrl;
  }

  private revokeObjectURL(objectUrl: string): void {
    const record = this.objectUrls.get(objectUrl);
    if (record === undefined) throw new Error("Unknown object URL revocation");
    record.revoked += 1;
  }

  private fetch(input: string, init: Readonly<RequestInit>): Promise<RuntimeLoaderResponse> {
    const signal = init.signal;
    const epoch = signal === null || signal === undefined
      ? undefined
      : this.signalEpoch.get(signal);
    if (epoch === undefined) throw new Error("Runtime request did not use its loader signal");
    const allowed = new Set([MANIFEST_PATH, ...this.fixture.assetPaths[epoch.profile]]);
    if (!allowed.has(input)) throw new Error(`Non-profile request: ${input}`);
    const key = this.fetchKey(epoch, input);
    if (this.pendingFetches.has(key)) throw new Error(`Duplicate request: ${key}`);

    if (input !== MANIFEST_PATH && !epoch.manifestAnnounced) {
      epoch.manifestAnnounced = true;
      this.onManifestAccepted(epoch);
    }
    const deferred = new Deferred<RuntimeLoaderResponse>();
    const pending = { deferred, epoch, path: input } satisfies PendingFetch;
    this.pendingFetches.set(key, pending);
    this.requestLog.push({ epochId: epoch.id, path: input });

    const abort = (): void => {
      deferred.reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    return deferred.promise.then(
      (value) => {
        signal?.removeEventListener("abort", abort);
        this.pendingFetches.delete(key);
        return value;
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", abort);
        this.pendingFetches.delete(key);
        throw error;
      },
    );
  }

  private settleFetch(epoch: LoadEpoch, path: string, outcome: FetchOutcome): void {
    const key = this.fetchKey(epoch, path);
    const pending = this.pendingFetches.get(key);
    if (pending === undefined) throw new Error(`No pending request for ${key}`);
    if (outcome === "fetch-failure") {
      pending.deferred.reject(new Error("injected fetch failure"));
      return;
    }
    const expected = this.fixture.bodies.get(path);
    if (expected === undefined) throw new Error(`Missing fixture body for ${path}`);
    pending.deferred.resolve(responseFor(path, expected, outcome));
  }

  private decodeImage(image: HTMLImageElement): Promise<void> {
    const objectUrl = image.getAttribute("src") ?? "";
    const objectRecord = this.objectUrls.get(objectUrl);
    if (objectRecord === undefined) throw new Error("Decode used an unknown object URL");
    const key = this.fetchKey(objectRecord.epoch, objectRecord.path);
    if (this.pendingDecodes.has(key)) throw new Error(`Duplicate decode: ${key}`);
    const deferred = new Deferred<Exclude<DecodeOutcome, "decode-failure">>();
    const pending = {
      deferred,
      epoch: objectRecord.epoch,
      image,
      path: objectRecord.path,
    } satisfies PendingDecode;
    this.pendingDecodes.set(key, pending);
    this.imageDecodeKey.set(image, key);

    return deferred.promise.then(
      (outcome) => {
        this.pendingDecodes.delete(key);
        this.imageDecodeKey.delete(image);
        const record = this.fixture.recordByPath.get(objectRecord.path);
        if (record === undefined) throw new Error("Decode path lacks a manifest record");
        Object.defineProperties(image, {
          naturalHeight: {
            configurable: true,
            value: record.intrinsicHeight,
          },
          naturalWidth: {
            configurable: true,
            value: outcome === "dimensions-failure"
              ? record.intrinsicWidth + 1
              : record.intrinsicWidth,
          },
        });
        if (outcome === "success") {
          this.onAssetDecoded(
            objectRecord.epoch,
            objectRecord.path,
            image,
            objectUrl,
          );
        }
      },
      (error: unknown) => {
        this.pendingDecodes.delete(key);
        this.imageDecodeKey.delete(image);
        throw error;
      },
    );
  }
}

class RuntimeController {
  readonly fixture: RuntimeFixture;
  readonly injected: InjectedRuntimeDependencies;
  readonly supported: boolean;
  readonly externalRequests = { count: 0 };

  atomicReadyTransitions = 0;
  disposed = false;
  failureRequestCount: number | null = null;
  loaderStarts = 0;
  state: EnhancementState;
  terminalFailures = 0;

  private activeEpoch: LoadEpoch | null = null;
  private epochOrdinal = 0;

  constructor(
    fixture: RuntimeFixture,
    profile: ProfileId,
    capabilities: CapabilityTuple,
  ) {
    this.fixture = fixture;
    const environment = createSupportEnvironment(capabilities, this.externalRequests);
    const support = classifyBrowserSupport(environment);
    this.supported = support.supported;
    this.state = createEnhancementState({
      profile,
      release: fixture.release,
      support,
    });
    this.injected = new InjectedRuntimeDependencies(
      fixture,
      this.externalRequests,
      (epoch) => this.onManifestAccepted(epoch),
      (epoch, path, image, objectUrl) => (
        this.onAssetDecoded(epoch, path, image, objectUrl)
      ),
    );

    const gated = runSuccessorLoaderIfSupported(
      () => this.beginLoad(profile, false),
      environment,
    );
    expect(gated.supported).toBe(this.supported);
    expect(this.externalRequests.count).toBe(0);
  }

  get fallbackVisible(): boolean {
    return this.disposed || this.state.fallbackVisible;
  }

  get enhancementVisible(): boolean {
    return !this.disposed && this.state.enhancementVisible;
  }

  get currentEpoch(): LoadEpoch | null {
    return this.activeEpoch;
  }

  async settleManifest(outcome: FetchOutcome): Promise<void> {
    const epoch = this.requireActiveEpoch();
    this.injected.settleManifest(epoch, outcome);
    if (outcome === "success") {
      await waitUntil(
        () => this.injected.pendingAssetFetchCount(epoch) === this.fixture.assetCount,
        "all profile asset requests",
      );
    } else {
      await epoch.settled;
    }
    await drainMicrotasks();
  }

  async settleAsset(index: number, outcome: FetchOutcome): Promise<void> {
    const epoch = this.requireActiveEpoch();
    this.injected.settleAsset(epoch, index, outcome);
    if (outcome === "success") {
      await waitUntil(
        () => this.injected.pendingDecode(epoch, index),
        `decode ${index}`,
      );
    } else {
      await epoch.settled;
    }
    await drainMicrotasks();
  }

  async settleDecode(index: number, outcome: DecodeOutcome): Promise<void> {
    const epoch = this.requireActiveEpoch();
    this.injected.settleDecode(epoch, index, outcome);
    if (outcome !== "success") {
      await epoch.settled;
    } else {
      await drainMicrotasks();
      const mountingComplete = this.state.kind === "mounting-hidden"
        || (
          this.state.kind === "profile-switch-loading"
          && this.state.stage === "mounting-hidden"
        );
      if (mountingComplete) await epoch.settled;
    }
    await drainMicrotasks();
  }

  async mount(profile: ProfileId): Promise<void> {
    if (this.disposed) return;
    const result = this.applyEvent({ profile, type: "mount-complete" });
    if (resultBecameError(result)) await this.cancelActive("profile-change");
    await drainMicrotasks();
  }

  async switchProfile(profile: ProfileId, activeElapsedMs: number): Promise<void> {
    if (this.disposed) return;
    const result = this.applyEvent({
      activeElapsedMs,
      targetProfile: profile,
      type: "profile-switch-started",
    });
    if (
      result.accepted
      && result.state.kind === "profile-switch-loading"
      && result.state.targetProfile === profile
    ) {
      await this.cancelActive("profile-change");
      this.beginLoad(profile, true);
    } else if (resultBecameError(result)) {
      await this.cancelActive("profile-change");
    }
    await drainMicrotasks();
  }

  async fail(code: RuntimeFailureCode): Promise<void> {
    if (this.disposed) return;
    const result = this.applyEvent({ code, type: "failure" });
    if (resultBecameError(result)) await this.cancelActive("profile-change");
    await drainMicrotasks();
  }

  async cleanup(): Promise<void> {
    this.disposed = true;
    await this.cancelActive("unmount");
    await drainMicrotasks();
  }

  async awaitAllEpochs(): Promise<void> {
    await Promise.all(this.injected.epochs.map(({ settled }) => settled));
    await drainMicrotasks();
  }

  private beginLoad(profile: ProfileId, switching: boolean): RuntimeProfileLoad {
    if (this.disposed || this.state.terminal) {
      throw new Error("Attempted to start a terminal or disposed runtime loader");
    }
    const epoch: LoadEpoch = {
      abortCalls: 0,
      completion: "pending",
      handle: null,
      id: this.epochOrdinal += 1,
      manifestAnnounced: false,
      prepared: null,
      profile,
      settled: Promise.resolve(),
      switching,
    };
    this.loaderStarts += 1;
    this.activeEpoch = epoch;
    this.injected.epochs.push(epoch);
    this.injected.setCurrentEpoch(epoch);
    const handle = startRuntimeProfileLoad(
      { profile, release: this.fixture.release },
      this.injected.dependencies,
    );
    epoch.handle = handle;
    epoch.settled = handle.promise.then(
      (prepared) => {
        epoch.completion = "succeeded";
        epoch.prepared = prepared;
        expect(prepared.id).toBe(profile);
        expect(prepared.assets).toHaveLength(this.fixture.assetCount);
      },
      (error: unknown) => {
        if (error instanceof RuntimeLoaderCancelledError) {
          epoch.completion = "cancelled";
          return;
        }
        epoch.completion = "failed";
        const code = epoch.switching
          ? "profile-switch"
          : error instanceof RuntimeLoaderError
            ? error.code
            : "runtime-invariant";
        this.applyEvent({ code, type: "failure" });
      },
    );
    return handle;
  }

  private requireActiveEpoch(): LoadEpoch {
    if (this.activeEpoch === null) throw new Error("No active runtime loader");
    return this.activeEpoch;
  }

  private onManifestAccepted(epoch: LoadEpoch): void {
    if (this.disposed || epoch !== this.activeEpoch || epoch.switching) return;
    this.applyEvent({
      manifest: this.fixture.validatedManifest,
      type: "manifest-loaded",
    });
  }

  private onAssetDecoded(
    epoch: LoadEpoch,
    path: string,
    image: HTMLImageElement,
    objectUrl: string,
  ): void {
    if (this.disposed || epoch !== this.activeEpoch || this.state.terminal) return;
    const record = this.fixture.recordByPath.get(path);
    if (record === undefined) throw new Error("Decoded asset is not in the manifest");
    const asset = Object.freeze({ image, objectUrl, record }) satisfies PreparedAsset;
    this.applyEvent({ asset, type: "asset-loaded" });
  }

  private applyEvent(event: EnhancementEvent): ReturnType<typeof transitionEnhancementState> {
    const wasTerminal = this.state.terminal;
    const result = transitionEnhancementState(this.state, event);
    this.state = result.state;
    if (!wasTerminal && result.state.kind === "error") {
      this.terminalFailures += 1;
      this.failureRequestCount ??= this.injected.requestLog.length;
    }
    if (result.accepted && result.effect === "atomic-ready") {
      this.atomicReadyTransitions += 1;
    }
    return result;
  }

  private async cancelActive(reason: "profile-change" | "unmount"): Promise<void> {
    const epoch = this.activeEpoch;
    if (epoch === null) return;
    if (reason === "unmount") epoch.handle?.dispose();
    else epoch.handle?.cancel(reason);
    await epoch.settled;
    if (this.activeEpoch === epoch) this.activeEpoch = null;
    this.injected.setCurrentEpoch(null);
  }
}

function resultBecameError(
  result: ReturnType<typeof transitionEnhancementState>,
): boolean {
  return result.state.kind === "error" && result.effect === "terminal-error";
}

function createReferenceModel(scenario: PropertyScenario): ReferenceModel {
  const supported = referenceSupports(scenario.capabilities);
  const model: ReferenceModel = {
    activeElapsedMs: 0,
    assetCount: scenario.assetCount,
    atomicReadyTransitions: 0,
    cleanedLoads: 0,
    cleanedResources: 0,
    currentProfile: scenario.initialProfile,
    diagnostic: null,
    disposed: false,
    failureRequestCount: null,
    load: null,
    loaderStarts: 0,
    requests: 0,
    stage: supported ? "loading-manifest" : "unsupported",
    supported,
    terminalFailures: 0,
    totalResources: 0,
  };
  if (supported) startReferenceLoad(model, scenario.initialProfile, false);
  return model;
}

function startReferenceLoad(
  model: ReferenceModel,
  profile: ProfileId,
  switching: boolean,
): void {
  model.loaderStarts += 1;
  model.requests += 1;
  model.load = {
    decodes: Array.from({ length: model.assetCount }, () => "not-started"),
    fetches: Array.from({ length: model.assetCount }, () => "not-requested"),
    liveResources: 0,
    manifestPending: true,
    profile,
    switching,
  };
}

function cleanupReferenceLoad(model: ReferenceModel): void {
  if (model.load === null) return;
  model.cleanedLoads += 1;
  model.cleanedResources += model.load.liveResources;
  model.load = null;
}

function failReference(model: ReferenceModel, code: RuntimeFailureCode): void {
  if (model.disposed || model.stage === "unsupported" || model.stage === "error") return;
  model.stage = "error";
  model.diagnostic = code;
  model.terminalFailures += 1;
  model.failureRequestCount ??= model.requests;
  cleanupReferenceLoad(model);
}

function settleManifestReference(model: ReferenceModel, outcome: FetchOutcome): void {
  const load = model.load;
  if (load === null || !load.manifestPending) return;
  load.manifestPending = false;
  if (outcome !== "success") {
    failReference(
      model,
      load.switching
        ? "profile-switch"
        : outcome === "fetch-failure"
          ? "manifest-fetch"
          : outcome === "media-failure"
            ? "manifest-media"
            : "manifest-identity",
    );
    return;
  }
  load.fetches.fill("pending");
  model.requests += model.assetCount;
  if (!load.switching) model.stage = "loading-assets";
}

function settleAssetReference(
  model: ReferenceModel,
  index: number,
  outcome: FetchOutcome,
): void {
  const load = model.load;
  if (load === null || load.fetches[index] !== "pending") return;
  if (outcome !== "success") {
    failReference(
      model,
      load.switching
        ? "profile-switch"
        : outcome === "fetch-failure"
          ? "asset-fetch"
          : outcome === "media-failure"
            ? "asset-media"
            : "asset-identity",
    );
    return;
  }
  load.fetches[index] = "succeeded";
  load.decodes[index] = "pending";
  load.liveResources += 1;
  model.totalResources += 1;
}

function settleDecodeReference(
  model: ReferenceModel,
  index: number,
  outcome: DecodeOutcome,
): void {
  const load = model.load;
  if (load === null || load.decodes[index] !== "pending") return;
  if (outcome !== "success") {
    failReference(
      model,
      load.switching
        ? "profile-switch"
        : outcome === "decode-failure"
          ? "asset-decode"
          : "asset-dimensions",
    );
    return;
  }
  load.decodes[index] = "succeeded";
  if (load.decodes.every((status) => status === "succeeded")) {
    model.stage = load.switching ? "profile-switch-mounting" : "mounting-hidden";
  }
}

function mountReference(model: ReferenceModel, profile: ProfileId): void {
  if (model.disposed || model.stage === "unsupported" || model.stage === "error") return;
  const validStage = model.stage === "mounting-hidden"
    || model.stage === "profile-switch-mounting";
  if (!validStage || profile !== model.currentProfile) {
    failReference(model, "runtime-invariant");
    return;
  }
  model.stage = "ready";
  model.atomicReadyTransitions += 1;
}

function switchReference(
  model: ReferenceModel,
  profile: ProfileId,
  activeElapsedMs: number,
): void {
  if (model.disposed || model.stage === "unsupported" || model.stage === "error") return;
  if (
    model.stage !== "ready"
    || profile === model.currentProfile
    || !Number.isFinite(activeElapsedMs)
    || activeElapsedMs < model.activeElapsedMs
  ) {
    failReference(model, "runtime-invariant");
    return;
  }
  cleanupReferenceLoad(model);
  model.activeElapsedMs = activeElapsedMs;
  model.currentProfile = profile;
  model.stage = "profile-switch-loading";
  startReferenceLoad(model, profile, true);
}

function cleanupReference(model: ReferenceModel): void {
  if (!model.disposed) {
    model.disposed = true;
    cleanupReferenceLoad(model);
  }
}

function currentCompletedAssets(model: ReferenceModel): number {
  return model.load?.decodes.filter((status) => status === "succeeded").length ?? 0;
}

function expectedProductionKind(model: ReferenceModel): EnhancementState["kind"] {
  switch (model.stage) {
    case "unsupported":
      return "unsupported";
    case "loading-manifest":
      return "loading-manifest";
    case "loading-assets":
      return "loading-assets";
    case "mounting-hidden":
      return "mounting-hidden";
    case "ready":
      return "ready";
    case "profile-switch-loading":
    case "profile-switch-mounting":
      return "profile-switch-loading";
    case "error":
      return "error";
  }
}

function assertAgreement(model: ReferenceModel, real: RealModel): void {
  const { controller } = real;
  const expectedEnhancementVisible = !model.disposed && model.stage === "ready";
  expect(controller.supported).toBe(model.supported);
  expect(controller.enhancementVisible).toBe(expectedEnhancementVisible);
  expect(controller.fallbackVisible).toBe(!expectedEnhancementVisible);
  expect(controller.loaderStarts).toBe(model.loaderStarts);
  expect(controller.injected.requestLog).toHaveLength(model.requests);
  expect(controller.injected.objectUrls.size).toBe(model.totalResources);
  expect(controller.injected.totalRevocations()).toBe(model.cleanedResources);
  expect(controller.injected.totalAbortCalls()).toBe(model.cleanedLoads);
  expect(controller.atomicReadyTransitions).toBe(model.atomicReadyTransitions);
  expect(controller.terminalFailures).toBe(model.terminalFailures);
  expect(controller.externalRequests.count).toBe(0);
  controller.injected.assertRequestMembership();

  if (!model.disposed) {
    expect(controller.state.kind).toBe(expectedProductionKind(model));
    expect(controller.state.activeElapsedMs).toBe(model.activeElapsedMs);
  }
  if (model.stage === "error") {
    expect(getEnhancementDiagnosticCode(controller.state)).toBe(model.diagnostic);
    expect(controller.failureRequestCount).toBe(model.failureRequestCount);
    expect(controller.injected.requestLog).toHaveLength(model.failureRequestCount ?? -1);
  } else if (model.stage === "unsupported") {
    expect(SUPPORT_CODES).toContain(
      getEnhancementDiagnosticCode(controller.state) as SupportCode,
    );
    expect(controller.injected.requestLog).toHaveLength(0);
  } else if (!model.disposed) {
    expect(getEnhancementDiagnosticCode(controller.state)).toBeNull();
  }

  if (!model.disposed && controller.state.kind === "loading-assets") {
    expect(controller.state.completedAssets).toHaveLength(currentCompletedAssets(model));
  }
  if (
    !model.disposed
    && controller.state.kind === "profile-switch-loading"
    && controller.state.stage === "loading-assets"
  ) {
    expect(controller.state.completedAssets).toHaveLength(currentCompletedAssets(model));
  }
  if (!expectedEnhancementVisible) {
    expect(controller.enhancementVisible).toBe(false);
    expect(controller.fallbackVisible).toBe(true);
  }
}

class SettleManifestCommand implements fc.AsyncCommand<ReferenceModel, RealModel> {
  constructor(readonly outcome: FetchOutcome) {}

  check(model: Readonly<ReferenceModel>): boolean {
    return model.load?.manifestPending === true;
  }

  async run(model: ReferenceModel, real: RealModel): Promise<void> {
    settleManifestReference(model, this.outcome);
    await real.controller.settleManifest(this.outcome);
    assertAgreement(model, real);
  }

  toString(): string {
    return `manifest(${this.outcome})`;
  }
}

class SettleAssetCommand implements fc.AsyncCommand<ReferenceModel, RealModel> {
  constructor(readonly index: number, readonly outcome: FetchOutcome) {}

  check(model: Readonly<ReferenceModel>): boolean {
    return model.load?.fetches[this.index] === "pending";
  }

  async run(model: ReferenceModel, real: RealModel): Promise<void> {
    settleAssetReference(model, this.index, this.outcome);
    await real.controller.settleAsset(this.index, this.outcome);
    assertAgreement(model, real);
  }

  toString(): string {
    return `asset(${this.index},${this.outcome})`;
  }
}

class SettleDecodeCommand implements fc.AsyncCommand<ReferenceModel, RealModel> {
  constructor(readonly index: number, readonly outcome: DecodeOutcome) {}

  check(model: Readonly<ReferenceModel>): boolean {
    return model.load?.decodes[this.index] === "pending";
  }

  async run(model: ReferenceModel, real: RealModel): Promise<void> {
    settleDecodeReference(model, this.index, this.outcome);
    await real.controller.settleDecode(this.index, this.outcome);
    assertAgreement(model, real);
  }

  toString(): string {
    return `decode(${this.index},${this.outcome})`;
  }
}

class MountCommand implements fc.AsyncCommand<ReferenceModel, RealModel> {
  constructor(readonly profile: ProfileId) {}

  check(model: Readonly<ReferenceModel>): boolean {
    return !model.disposed;
  }

  async run(model: ReferenceModel, real: RealModel): Promise<void> {
    mountReference(model, this.profile);
    await real.controller.mount(this.profile);
    assertAgreement(model, real);
  }

  toString(): string {
    return `mount(${this.profile})`;
  }
}

class SwitchCommand implements fc.AsyncCommand<ReferenceModel, RealModel> {
  constructor(readonly profile: ProfileId, readonly elapsedIncrement: number) {}

  check(model: Readonly<ReferenceModel>): boolean {
    return !model.disposed;
  }

  async run(model: ReferenceModel, real: RealModel): Promise<void> {
    const activeElapsedMs = model.activeElapsedMs + this.elapsedIncrement;
    switchReference(model, this.profile, activeElapsedMs);
    await real.controller.switchProfile(this.profile, activeElapsedMs);
    assertAgreement(model, real);
  }

  toString(): string {
    return `switch(${this.profile},+${this.elapsedIncrement})`;
  }
}

class FailureCommand implements fc.AsyncCommand<ReferenceModel, RealModel> {
  constructor(readonly code: RuntimeFailureCode) {}

  check(model: Readonly<ReferenceModel>): boolean {
    return !model.disposed;
  }

  async run(model: ReferenceModel, real: RealModel): Promise<void> {
    failReference(model, this.code);
    await real.controller.fail(this.code);
    assertAgreement(model, real);
  }

  toString(): string {
    return `failure(${this.code})`;
  }
}

class CleanupCommand implements fc.AsyncCommand<ReferenceModel, RealModel> {
  check(): boolean {
    return true;
  }

  async run(model: ReferenceModel, real: RealModel): Promise<void> {
    cleanupReference(model);
    await real.controller.cleanup();
    assertAgreement(model, real);
  }

  toString(): string {
    return "cleanup()";
  }
}

const manifestCommandArbitrary: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>> =
  fetchOutcomeArbitrary.map((outcome) => new SettleManifestCommand(outcome));
const assetCommandArbitrary: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>> = fc
  .tuple(fc.integer({ min: 0, max: MAX_ASSETS - 1 }), fetchOutcomeArbitrary)
  .map(([index, outcome]) => new SettleAssetCommand(index, outcome));
const decodeCommandArbitrary: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>> = fc
  .tuple(fc.integer({ min: 0, max: MAX_ASSETS - 1 }), decodeOutcomeArbitrary)
  .map(([index, outcome]) => new SettleDecodeCommand(index, outcome));
const mountCommandArbitrary: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>> = fc
  .constantFrom<ProfileId>("compact", "expanded")
  .map((profile) => new MountCommand(profile));
const switchCommandArbitrary: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>> = fc
  .tuple(
    fc.constantFrom<ProfileId>("compact", "expanded"),
    fc.nat({ max: 10_000 }),
  )
  .map(([profile, elapsed]) => new SwitchCommand(profile, elapsed));
const failureCommandArbitrary: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>> = fc
  .constantFrom<RuntimeFailureCode>(...RUNTIME_FAILURE_CODES)
  .map((code) => new FailureCommand(code));
const cleanupCommandArbitrary: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>> =
  fc.constant(new CleanupCommand());

const commandArbitraries: fc.Arbitrary<fc.AsyncCommand<ReferenceModel, RealModel>>[] = [
  ...Array.from({ length: 8 }, () => manifestCommandArbitrary),
  ...Array.from({ length: 8 }, () => assetCommandArbitrary),
  ...Array.from({ length: 8 }, () => decodeCommandArbitrary),
  mountCommandArbitrary,
  switchCommandArbitrary,
  failureCommandArbitrary,
  cleanupCommandArbitrary,
];
const commandsArbitrary = fc.commands(commandArbitraries, { maxCommands: 28 });

function orderedIndices(priorities: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => index).sort((left, right) => (
    priorities[left] - priorities[right] || left - right
  ));
}

async function finishCurrentLoadSuccessfully(
  model: ReferenceModel,
  real: RealModel,
  assetOrder: readonly number[],
  decodeOrder: readonly number[],
): Promise<void> {
  if (model.disposed || model.stage === "unsupported" || model.stage === "error") return;
  if (model.load?.manifestPending) {
    settleManifestReference(model, "success");
    await real.controller.settleManifest("success");
    assertAgreement(model, real);
  }
  for (const index of assetOrder) {
    if (model.load?.fetches[index] !== "pending") continue;
    settleAssetReference(model, index, "success");
    await real.controller.settleAsset(index, "success");
    assertAgreement(model, real);
  }
  for (const index of decodeOrder) {
    if (model.load?.decodes[index] !== "pending") continue;
    settleDecodeReference(model, index, "success");
    await real.controller.settleDecode(index, "success");
    assertAgreement(model, real);
  }
  if (model.stage === "mounting-hidden" || model.stage === "profile-switch-mounting") {
    mountReference(model, model.currentProfile);
    await real.controller.mount(model.currentProfile);
    assertAgreement(model, real);
  }
  expect(model.stage).toBe("ready");
}

async function finishAndCleanup(
  scenario: PropertyScenario,
  model: ReferenceModel,
  real: RealModel,
): Promise<void> {
  const assetOrder = orderedIndices(scenario.assetPriorities, scenario.assetCount);
  const decodeOrder = orderedIndices(scenario.decodePriorities, scenario.assetCount);
  await finishCurrentLoadSuccessfully(model, real, assetOrder, decodeOrder);

  if (!model.disposed && model.stage === "ready") {
    const target = model.currentProfile === "compact" ? "expanded" : "compact";
    const elapsed = model.activeElapsedMs + scenario.switchElapsedIncrement;
    switchReference(model, target, elapsed);
    await real.controller.switchProfile(target, elapsed);
    assertAgreement(model, real);
    await finishCurrentLoadSuccessfully(
      model,
      real,
      [...assetOrder].reverse(),
      [...decodeOrder].reverse(),
    );
    expect(model.activeElapsedMs).toBe(elapsed);
    expect(real.controller.state.activeElapsedMs).toBe(elapsed);
  }

  cleanupReference(model);
  await real.controller.cleanup();
  await real.controller.cleanup();
  await real.controller.awaitAllEpochs();
  assertAgreement(model, real);
  real.controller.injected.assertCompleteCleanup();

  if (!model.supported) {
    expect(model.requests).toBe(0);
    expect(real.controller.injected.requestLog).toHaveLength(0);
  }
  if (model.stage === "error") {
    expect(model.terminalFailures).toBe(1);
    expect(real.controller.terminalFailures).toBe(1);
    expect(real.controller.injected.requestLog).toHaveLength(
      model.failureRequestCount ?? -1,
    );
  }
}

// **Validates: Requirements 10.1–10.5, 10.7, 10.8, 10.13–10.15, 8.12, 12.14, 12.15, 14.7, 14.9**
it(PROPERTY_TAG, { timeout: 120_000 }, async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArbitrary, commandsArbitrary, async (scenario, commands) => {
      const fixture = createFixture(scenario);
      const model = createReferenceModel(scenario);
      const real: RealModel = {
        controller: new RuntimeController(
          fixture,
          scenario.initialProfile,
          scenario.capabilities,
        ),
      };
      expect(real.controller.supported).toBe(referenceSupports(scenario.capabilities));
      assertAgreement(model, real);

      await fc.asyncModelRun(() => ({ model, real }), commands);
      await finishAndCleanup(scenario, model, real);
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
