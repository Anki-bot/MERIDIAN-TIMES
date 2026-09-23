import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_VERSION_FLOORS,
  SUPPORTED_BROWSER_FAMILIES,
  classifyBrowserUserAgent,
  runSuccessorLoaderIfSupported,
} from "@/lib/watch-2-5d/browser-support";
import type {
  BrowserSupportEnvironment,
  SupportedBrowserFamily,
} from "@/lib/watch-2-5d/browser-support";
import { createCanonicalCoverTransform } from "@/lib/watch-2-5d/cover-transform";
import {
  RuntimeLoaderCancelledError,
  RuntimeLoaderError,
  startRuntimeProfileLoad,
} from "@/lib/watch-2-5d/runtime-loader";
import type {
  RuntimeLoaderDependencies,
  RuntimeLoaderResponse,
} from "@/lib/watch-2-5d/runtime-loader";
import {
  RUNTIME_SCHEMA_ISSUE_CODES,
  RuntimeSchemaError,
  isReadyWatchLayerRelease,
  parseRuntimeManifest,
  parseWatchLayerRelease,
  parseWatchLayerReleaseJson,
} from "@/lib/watch-2-5d/runtime-schema";
import {
  createEnhancementState,
  transitionEnhancementState,
} from "@/lib/watch-2-5d/runtime-state";
import type {
  EnhancementState,
  EnhancementTransitionResult,
} from "@/lib/watch-2-5d/runtime-state";
import {
  CANONICAL_MASTER_SHA256,
  RUNTIME_FAILURE_CODES,
} from "@/lib/watch-2-5d/types";
import type {
  ProfileId,
  ReadyWatchLayerRelease,
  RuntimeFailureCode,
} from "@/lib/watch-2-5d/types";

type Bytes = Uint8Array<ArrayBuffer>;
type JsonRecord = Record<string, unknown>;

interface RuntimeFixture {
  readonly assetPaths: Readonly<Record<ProfileId, readonly string[]>>;
  readonly bodies: ReadonlyMap<string, Bytes>;
  readonly manifest: JsonRecord;
  readonly manifestBytes: Bytes;
  readonly release: ReadyWatchLayerRelease;
}

interface ResponseOverride {
  readonly bodyError?: boolean;
  readonly bytes?: Bytes;
  readonly mediaType?: string;
  readonly status?: number;
}

interface BodyGate {
  readonly promise: Promise<Bytes>;
  isSettled(): boolean;
  resolve(bytes: Bytes): void;
}

interface HarnessOptions {
  readonly bodyGates?: ReadonlyMap<string, BodyGate>;
  readonly decodeFailures?: ReadonlySet<string>;
  readonly dimensionOverrides?: ReadonlyMap<
    string,
    Readonly<{ height: number; width: number }>
  >;
  readonly fetchFailures?: ReadonlySet<string>;
  readonly pendingFetchPaths?: ReadonlySet<string>;
  readonly responses?: ReadonlyMap<string, ResponseOverride>;
}

interface LoaderFailureCase {
  readonly code: RuntimeFailureCode;
  readonly configure: (fixture: RuntimeFixture) => Readonly<{
    options?: HarnessOptions;
    profile?: ProfileId;
  }>;
  readonly create?: () => RuntimeFixture;
  readonly manifestOnly?: boolean;
  readonly name: string;
  readonly zeroRequests?: boolean;
}

let prohibitedExternalFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  prohibitedExternalFetch = vi.fn(() => {
    throw new Error("Task 8.6 tests prohibit external fetch");
  });
  vi.stubGlobal("fetch", prohibitedExternalFetch);
});

afterEach(() => {
  expect(prohibitedExternalFetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function bytesFromText(text: string): Bytes {
  return new TextEncoder().encode(text) as Bytes;
}

function arrayBuffer(bytes: Bytes): ArrayBuffer {
  return bytes.slice().buffer;
}

function sha256(bytes: Bytes): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Buffer(bytes: Bytes): ArrayBuffer {
  return Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer;
}

function hex(bytes: Bytes): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function webpBytes(marker: number): Bytes {
  const bytes = new Uint8Array(48);
  bytes.set([
    0x52,
    0x49,
    0x46,
    0x46,
    marker,
    0,
    0,
    0,
    0x57,
    0x45,
    0x42,
    0x50,
  ]);
  bytes.fill(marker, 12);
  return bytes;
}

function assetRecord(
  profileId: ProfileId,
  layerId: string,
  name: string,
  bytes: Bytes,
  sourceRect: Readonly<{ height: number; width: number; x: number; y: number }>,
  zOrder: number,
): JsonRecord {
  const sourceScale = profileId === "compact" ? 0.5 : 1;
  const intrinsicWidth = Math.ceil(sourceRect.width * sourceScale);
  const intrinsicHeight = Math.ceil(sourceRect.height * sourceScale);
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  const publicPath = `/assets/watch-2-5d/v1/${profileId}/${name}.webp`;

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
    id: `${profileId}-${name}`,
    intrinsicHeight,
    intrinsicWidth,
    layerId,
    magicSignatureHex: hex(bytes.slice(0, 12)),
    mediaType: "image/webp",
    profile: profileId,
    publicPath,
    sha256: sha256(bytes),
    sourceRect,
    zOrder,
  };
}

function profileRecord(profileId: ProfileId, assets: readonly JsonRecord[]): JsonRecord {
  return {
    assets,
    decodedRgbaBytes: assets.reduce(
      (total, asset) => total + Number(asset.decodedRgbaByteLength),
      0,
    ),
    id: profileId,
    requestCountIncludingManifest: assets.length + 1,
    sourceScale: profileId === "compact" ? 0.5 : 1,
    transferBytes: assets.reduce(
      (total, asset) => total + Number(asset.byteLength),
      0,
    ),
  };
}

function createFixture(
  mutateManifest?: (manifest: JsonRecord) => void,
): RuntimeFixture {
  const compactBytes = [webpBytes(1), webpBytes(2), webpBytes(3)] as const;
  const expandedBytes = [webpBytes(4), webpBytes(5), webpBytes(6)] as const;
  const layers = [
    {
      id: "reconstructed-background",
      name: "reconstructed-background",
      rect: { height: 1_504, width: 2_760, x: 0, y: 0 },
      zOrder: 0,
    },
    {
      id: "moving-layer-one",
      name: "moving-layer-one",
      rect: { height: 80, width: 100, x: 120, y: 240 },
      zOrder: 1,
    },
    {
      id: "moving-layer-two",
      name: "moving-layer-two",
      rect: { height: 64, width: 72, x: 420, y: 360 },
      zOrder: 2,
    },
  ] as const;
  const compactAssets = layers.map((layer, index) => assetRecord(
    "compact",
    layer.id,
    layer.name,
    compactBytes[index],
    layer.rect,
    layer.zOrder,
  ));
  const expandedAssets = layers.map((layer, index) => assetRecord(
    "expanded",
    layer.id,
    layer.name,
    expandedBytes[index],
    layer.rect,
    layer.zOrder,
  ));
  const manifest: JsonRecord = {
    canonicalMasterSha256: CANONICAL_MASTER_SHA256,
    depthProfiles: [],
    motionProfiles: [],
    packageId: "watch-layer-package",
    phase: "static-layered-reconstruction",
    profiles: {
      compact: profileRecord("compact", compactAssets),
      expanded: profileRecord("expanded", expandedAssets),
    },
    releaseId: "release-v1",
    schemaVersion: 1,
  };
  mutateManifest?.(manifest);

  const manifestBytes = bytesFromText(JSON.stringify(manifest));
  const parsedRelease = parseWatchLayerRelease({
    depthEnabled: false,
    packageId: "watch-layer-package",
    releaseId: "release-v1",
    runtimeManifest: {
      byteLength: manifestBytes.byteLength,
      mediaType: "application/json",
      publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      sha256: sha256(manifestBytes),
    },
    schemaVersion: 1,
    status: "ready",
  });
  if (!isReadyWatchLayerRelease(parsedRelease)) {
    throw new Error("Ready runtime fixture parsed as fallback-only");
  }

  const compactPaths = compactAssets.map((asset) => String(asset.publicPath));
  const expandedPaths = expandedAssets.map((asset) => String(asset.publicPath));
  return {
    assetPaths: { compact: compactPaths, expanded: expandedPaths },
    bodies: new Map([
      [parsedRelease.runtimeManifest.publicPath, manifestBytes],
      ...compactPaths.map((path, index) => [path, compactBytes[index]] as const),
      ...expandedPaths.map((path, index) => [path, expandedBytes[index]] as const),
    ]),
    manifest,
    manifestBytes,
    release: parsedRelease,
  };
}

function createBodyGate(): BodyGate {
  let resolvePromise!: (bytes: Bytes) => void;
  let settled = false;
  const promise = new Promise<Bytes>((resolvePromiseInput) => {
    resolvePromise = resolvePromiseInput;
  });

  return {
    isSettled: () => settled,
    promise,
    resolve: (bytes) => {
      if (settled) throw new Error("Body gate settled more than once");
      settled = true;
      resolvePromise(bytes);
    },
  };
}

function changedLastByte(bytes: Bytes): Bytes {
  const changed = bytes.slice();
  changed[changed.length - 1] ^= 0xff;
  return changed;
}

function assetRecords(fixture: RuntimeFixture): ReadonlyMap<string, JsonRecord> {
  const profiles = fixture.manifest.profiles as Record<ProfileId, JsonRecord>;
  return new Map(((["compact", "expanded"] as const).flatMap((profileId) => (
    (profiles[profileId].assets as JsonRecord[]).map((record) => [
      String(record.publicPath),
      record,
    ] as const)
  ))));
}

function createHarness(
  fixture: RuntimeFixture,
  options: HarnessOptions = {},
) {
  const records = assetRecords(fixture);
  const pathByBodyHash = new Map<string, string>();
  for (const [path, bytes] of fixture.bodies) {
    if (path !== fixture.release.runtimeManifest.publicPath) {
      pathByBodyHash.set(sha256(bytes), path);
    }
  }

  let activeBodyCount = 0;
  let activeFetchCount = 0;
  let internalAbortController: AbortController | null = null;
  let objectUrlOrdinal = 0;
  const createdObjectUrls: string[] = [];
  const events: string[] = [];
  const images: HTMLImageElement[] = [];
  const liveObjectUrls = new Set<string>();
  const pathByObjectUrl = new Map<string, string>();
  const pendingAbortListeners = new Set<EventListener>();
  const revocationCounts = new Map<string, number>();

  const abort = vi.fn(() => {
    internalAbortController?.abort();
  });

  const fetch = vi.fn(async (
    input: string,
    init: Readonly<RequestInit>,
  ): Promise<RuntimeLoaderResponse> => {
    activeFetchCount += 1;
    events.push(`fetch:${input}`);

    if (options.fetchFailures?.has(input) === true) {
      activeFetchCount -= 1;
      throw new Error("injected fetch failure");
    }
    if (options.pendingFetchPaths?.has(input) === true) {
      return new Promise<RuntimeLoaderResponse>((_resolve, reject) => {
        const signal = init.signal;
        if (signal === undefined || signal === null) {
          activeFetchCount -= 1;
          reject(new Error("pending request did not receive an abort signal"));
          return;
        }
        if (signal.aborted) {
          activeFetchCount -= 1;
          reject(new DOMException("aborted", "AbortError"));
          return;
        }

        const onAbort: EventListener = () => {
          signal.removeEventListener("abort", onAbort);
          pendingAbortListeners.delete(onAbort);
          activeFetchCount -= 1;
          reject(new DOMException("aborted", "AbortError"));
        };
        pendingAbortListeners.add(onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }

    const expected = fixture.bodies.get(input);
    if (expected === undefined) {
      activeFetchCount -= 1;
      throw new Error(`unexpected request: ${input}`);
    }
    const override = options.responses?.get(input);
    const responseBytes = override?.bytes ?? expected;
    const mediaType = override?.mediaType
      ?? (input === fixture.release.runtimeManifest.publicPath
        ? "application/json"
        : "image/webp");
    let bodyConsumed = false;
    activeFetchCount -= 1;

    return {
      arrayBuffer: async () => {
        if (bodyConsumed) throw new Error("response body consumed more than once");
        bodyConsumed = true;
        activeBodyCount += 1;
        try {
          if (override?.bodyError === true) {
            throw new Error("injected response body failure");
          }
          const gate = options.bodyGates?.get(input);
          const body = gate === undefined ? responseBytes : await gate.promise;
          return arrayBuffer(body);
        } finally {
          activeBodyCount -= 1;
        }
      },
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type"
          ? mediaType
          : null,
      },
      status: override?.status ?? 200,
    };
  });

  const createObjectURL = vi.fn((bytes: Bytes, mediaType: "image/webp") => {
    if (mediaType !== "image/webp") {
      throw new Error(`unexpected object URL media type: ${mediaType}`);
    }
    const path = pathByBodyHash.get(sha256(bytes));
    if (path === undefined) {
      throw new Error("object URL requested for bytes outside the verified fixture");
    }
    objectUrlOrdinal += 1;
    const objectUrl = `blob:watch-2-5d/${objectUrlOrdinal}`;
    createdObjectUrls.push(objectUrl);
    liveObjectUrls.add(objectUrl);
    pathByObjectUrl.set(objectUrl, path);
    events.push(`url:${path}`);
    return objectUrl;
  });

  const revokeObjectURL = vi.fn((objectUrl: string) => {
    revocationCounts.set(objectUrl, (revocationCounts.get(objectUrl) ?? 0) + 1);
    liveObjectUrls.delete(objectUrl);
    events.push(`revoke:${objectUrl}`);
  });

  const decodeImage = vi.fn(async (image: HTMLImageElement) => {
    const objectUrl = image.getAttribute("src") ?? "";
    const path = pathByObjectUrl.get(objectUrl);
    if (path === undefined) throw new Error("decode received an unknown object URL");
    events.push(`decode:${path}`);
    if (options.decodeFailures?.has(path) === true) {
      throw new Error("injected decode failure");
    }

    const record = records.get(path);
    if (record === undefined) throw new Error("decode fixture record is missing");
    const dimensions = options.dimensionOverrides?.get(path);
    Object.defineProperties(image, {
      naturalHeight: {
        configurable: true,
        value: dimensions?.height ?? Number(record.intrinsicHeight),
      },
      naturalWidth: {
        configurable: true,
        value: dimensions?.width ?? Number(record.intrinsicWidth),
      },
    });
  });

  const dependencies: RuntimeLoaderDependencies = {
    createAbortController: () => {
      if (internalAbortController !== null) {
        throw new Error("one runtime load created multiple AbortControllers");
      }
      internalAbortController = new AbortController();
      return { abort, signal: internalAbortController.signal };
    },
    createImage: () => {
      const image = document.createElement("img");
      images.push(image);
      return image;
    },
    createObjectURL,
    decodeImage,
    digest: async (_algorithm, bytes) => sha256Buffer(bytes),
    fetch,
    revokeObjectURL,
  };

  return {
    abort,
    activeBodyCount: () => activeBodyCount,
    activeFetchCount: () => activeFetchCount,
    createObjectURL,
    createdObjectUrls,
    decodeImage,
    dependencies,
    events,
    fetch,
    images,
    liveObjectUrls,
    pendingAbortListeners,
    revocationCounts,
    revokeObjectURL,
  };
}

type RuntimeHarness = ReturnType<typeof createHarness>;

function createTrackedOwner() {
  const controller = new AbortController();
  return {
    addEventListener: vi.spyOn(controller.signal, "addEventListener"),
    controller,
    removeEventListener: vi.spyOn(controller.signal, "removeEventListener"),
  };
}

type TrackedOwner = ReturnType<typeof createTrackedOwner>;

function expectOwnerListenerReleased(owner: TrackedOwner): void {
  expect(owner.addEventListener).toHaveBeenCalledTimes(1);
  const listener = owner.addEventListener.mock.calls[0][1];
  expect(owner.addEventListener).toHaveBeenCalledWith(
    "abort",
    listener,
    { once: true },
  );
  expect(owner.removeEventListener).toHaveBeenCalledTimes(1);
  expect(owner.removeEventListener).toHaveBeenCalledWith("abort", listener);
}

function expectNoResourceLeaks(
  harness: RuntimeHarness,
  bodyGates: readonly BodyGate[] = [],
): void {
  expect(harness.activeFetchCount()).toBe(0);
  expect(harness.activeBodyCount()).toBe(0);
  expect(harness.pendingAbortListeners.size).toBe(0);
  expect(harness.liveObjectUrls.size).toBe(0);
  expect(bodyGates.every((gate) => gate.isSettled())).toBe(true);
  expect(harness.abort).toHaveBeenCalledTimes(1);
  expect(harness.images.every((image) => !image.hasAttribute("src"))).toBe(true);
  for (const objectUrl of harness.createdObjectUrls) {
    expect(harness.revocationCounts.get(objectUrl)).toBe(1);
  }
  expect(harness.revokeObjectURL).toHaveBeenCalledTimes(
    harness.createdObjectUrls.length,
  );
}

async function flushUntil(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`Microtask condition did not settle: ${message}`);
}

async function flushMicrotasks(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

async function captureLoaderRejection(
  promise: Promise<unknown>,
): Promise<RuntimeLoaderError | RuntimeLoaderCancelledError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RuntimeLoaderError || error instanceof RuntimeLoaderCancelledError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected runtime loading to reject");
}

function acceptedState(result: EnhancementTransitionResult): EnhancementState {
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.reason);
  return result.state;
}

function readyStateFromPrepared(
  fixture: RuntimeFixture,
  prepared: Awaited<ReturnType<typeof startRuntimeProfileLoad>["promise"]>,
): EnhancementState {
  let state = createEnhancementState({
    profile: prepared.id,
    release: fixture.release,
    support: { supported: true },
  });
  state = acceptedState(transitionEnhancementState(state, {
    manifest: prepared.manifest,
    type: "manifest-loaded",
  }));
  for (const asset of prepared.assets) {
    state = acceptedState(transitionEnhancementState(state, {
      asset,
      type: "asset-loaded",
    }));
  }
  return acceptedState(transitionEnhancementState(state, {
    profile: prepared.id,
    type: "mount-complete",
  }));
}

function expectSchemaIssue(
  operation: () => unknown,
  issueCode: string,
): RuntimeSchemaError {
  try {
    operation();
  } catch (error) {
    if (!(error instanceof RuntimeSchemaError)) throw error;
    expect(error.issueCode).toBe(issueCode);
    return error;
  }
  throw new Error("Expected runtime schema validation to fail");
}

function startFromInitialState(
  input: Parameters<typeof createEnhancementState>[0],
  startLoader: () => void,
): EnhancementState {
  const state = createEnhancementState(input);
  if (!state.terminal) startLoader();
  return state;
}

function versionText(
  family: SupportedBrowserFamily,
  version: Readonly<{ major: number; minor: number }>,
): string {
  return family === "chrome" || family === "edge" || family === "android-chrome"
    ? `${version.major}.${version.minor}.0.0`
    : `${version.major}.${version.minor}`;
}

function belowFloor(
  floor: Readonly<{ major: number; minor: number }>,
): Readonly<{ major: number; minor: number }> {
  return floor.minor > 0
    ? { major: floor.major, minor: floor.minor - 1 }
    : { major: floor.major - 1, minor: 999 };
}

const USER_AGENT_BUILDERS: Readonly<Record<
  SupportedBrowserFamily,
  (version: string) => string
>> = Object.freeze({
  "android-chrome": (version) => (
    `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 `
    + `(KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`
  ),
  chrome: (version) => (
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 `
    + `(KHTML, like Gecko) Chrome/${version} Safari/537.36`
  ),
  edge: (version) => (
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 `
    + `(KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`
  ),
  firefox: (version) => (
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${version}) `
    + `Gecko/20100101 Firefox/${version}`
  ),
  "ios-safari": (version) => (
    `Mozilla/5.0 (iPhone; CPU iPhone OS ${version.replaceAll(".", "_")} like Mac OS X) `
    + `AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} `
    + "Mobile/15E148 Safari/604.1"
  ),
  safari: (version) => (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) "
    + `AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`
  ),
});

function supportedEnvironment(userAgent: string): BrowserSupportEnvironment {
  class DecodableImageElement {}
  Object.defineProperty(DecodableImageElement.prototype, "decode", {
    value: () => Promise.resolve(),
  });

  return {
    AbortController,
    CSS: {
      supports: (property: string) => property === "transform"
        || property === "--watch-layer-support",
    },
    HTMLImageElement: DecodableImageElement,
    ResizeObserver: class ResizeObserverStub {},
    cancelAnimationFrame: () => undefined,
    crypto: { subtle: { digest: () => Promise.resolve(new ArrayBuffer(32)) } },
    document: {
      addEventListener: () => undefined,
      hidden: false,
      removeEventListener: () => undefined,
      visibilityState: "visible",
    },
    fetch: () => Promise.resolve(),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1,
    userAgent,
  };
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) return [values.slice()];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]));
}

const COMPLETION_ORDERS = permutations([0, 1, 2] as const).map((order, index) => ({
  caseId: index + 1,
  order,
}));

const LOADER_FAILURE_CASES: readonly LoaderFailureCase[] = [
  {
    code: "manifest-fetch",
    configure: (fixture) => ({
      options: {
        fetchFailures: new Set([fixture.release.runtimeManifest.publicPath]),
      },
    }),
    manifestOnly: true,
    name: "manifest fetch rejection",
  },
  {
    code: "manifest-media",
    configure: (fixture) => ({
      options: {
        responses: new Map([[fixture.release.runtimeManifest.publicPath, {
          mediaType: "application/json; charset=utf-8",
        }]]),
      },
    }),
    manifestOnly: true,
    name: "manifest exact media type",
  },
  {
    code: "manifest-identity",
    configure: (fixture) => ({
      options: {
        responses: new Map([[fixture.release.runtimeManifest.publicPath, {
          bytes: changedLastByte(fixture.manifestBytes),
        }]]),
      },
    }),
    manifestOnly: true,
    name: "manifest digest identity",
  },
  {
    code: "manifest-schema",
    configure: () => ({}),
    create: () => createFixture((manifest) => {
      manifest.reviewer = "must-not-enter-the-runtime-payload";
    }),
    manifestOnly: true,
    name: "strict manifest schema",
  },
  {
    code: "asset-fetch",
    configure: (fixture) => ({
      options: {
        fetchFailures: new Set([fixture.assetPaths.compact[1]]),
      },
    }),
    name: "asset fetch rejection",
  },
  {
    code: "asset-media",
    configure: (fixture) => ({
      options: {
        responses: new Map([[fixture.assetPaths.compact[1], {
          mediaType: "image/avif",
        }]]),
      },
    }),
    name: "asset exact media type",
  },
  {
    code: "asset-identity",
    configure: (fixture) => ({
      options: {
        responses: new Map([[fixture.assetPaths.compact[1], {
          bytes: changedLastByte(fixture.bodies.get(fixture.assetPaths.compact[1])!),
        }]]),
      },
    }),
    name: "asset digest identity",
  },
  {
    code: "asset-dimensions",
    configure: (fixture) => ({
      options: {
        dimensionOverrides: new Map([[fixture.assetPaths.compact[1], {
          height: 40,
          width: 51,
        }]]),
      },
    }),
    name: "asset intrinsic dimensions",
  },
  {
    code: "asset-decode",
    configure: (fixture) => ({
      options: {
        decodeFailures: new Set([fixture.assetPaths.compact[1]]),
      },
    }),
    name: "asset decode rejection",
  },
  {
    code: "runtime-invariant",
    configure: () => ({ profile: "future-profile" as ProfileId }),
    name: "invalid runtime profile invariant",
    zeroRequests: true,
  },
];

// **Validates: Requirements 10.1–10.15, 12.13–12.17, 13.9, 14.7, 14.9**
describe("Task 8.6 runtime schema, browser, loader, and cleanup examples", () => {
  it("keeps the checked-in fallback release byte-exact, URL-free, and at zero loader invocations", () => {
    const expected = Buffer.from(
      "{\"depthEnabled\":false,\"runtimeManifest\":null,\"schemaVersion\":1,\"status\":\"fallback-only\"}\n",
      "utf8",
    );
    const releaseBytes = readFileSync(
      resolve(process.cwd(), "data/watch-layer-release.json"),
    );
    expect(releaseBytes.equals(expected)).toBe(true);

    const release = parseWatchLayerReleaseJson(releaseBytes);
    expect(Buffer.from(`${JSON.stringify(release)}\n`, "utf8").equals(releaseBytes))
      .toBe(true);
    expect(release.runtimeManifest).toBeNull();

    const startLoader = vi.fn();
    const state = startFromInitialState({
      profile: "compact",
      release,
      support: { supported: true },
    }, startLoader);
    expect(state).toMatchObject({
      diagnosticCode: null,
      fallbackVisible: true,
      kind: "fallback-only",
      terminal: true,
    });
    expect(startLoader).not.toHaveBeenCalled();

    const readyFixture = createFixture();
    const eligible = startFromInitialState({
      profile: "compact",
      release: readyFixture.release,
      support: { supported: true },
    }, startLoader);
    expect(eligible.kind).toBe("loading-manifest");
    expect(startLoader).toHaveBeenCalledTimes(1);
  });

  it.each(SUPPORTED_BROWSER_FAMILIES.map((family) => ({ family })))(
    "enforces the exact $family version floor before invoking the successor loader",
    ({ family }) => {
      const floor = BROWSER_VERSION_FLOORS[family];
      const atFloor = versionText(family, floor);
      const below = versionText(family, belowFloor(floor));
      const atFloorUserAgent = USER_AGENT_BUILDERS[family](atFloor);
      const belowUserAgent = USER_AGENT_BUILDERS[family](below);

      expect(classifyBrowserUserAgent(atFloorUserAgent)).toMatchObject({
        browser: {
          family,
          version: { major: floor.major, minor: floor.minor },
        },
        supported: true,
      });
      expect(classifyBrowserUserAgent(belowUserAgent)).toMatchObject({
        browser: { family },
        code: "browser-version-unsupported",
        supported: false,
      });

      const belowFloorLoader = vi.fn(() => "must-not-run");
      expect(runSuccessorLoaderIfSupported(
        belowFloorLoader,
        supportedEnvironment(belowUserAgent),
      )).toEqual({
        code: "browser-version-unsupported",
        supported: false,
      });
      expect(belowFloorLoader).not.toHaveBeenCalled();

      const atFloorLoader = vi.fn(() => family);
      expect(runSuccessorLoaderIfSupported(
        atFloorLoader,
        supportedEnvironment(atFloorUserAgent),
      )).toEqual({ supported: true, value: family });
      expect(atFloorLoader).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts only the canonical manifest URL and active-profile same-origin asset allowlist", () => {
    const fixture = createFixture();
    const parsed = parseRuntimeManifest(fixture.manifest, fixture.release);
    expect(parsed.profiles.compact.assets.map(({ publicPath }) => publicPath))
      .toEqual(fixture.assetPaths.compact);

    for (const publicPath of [
      "https://cdn.example/runtime-manifest.json",
      "//cdn.example/runtime-manifest.json",
      "data:application/json,{}",
      "/assets/watch-2-5d/v2/runtime-manifest.json",
      "/assets/watch-2-5d/v1/runtime-manifest.json?next=1",
    ]) {
      expectSchemaIssue(() => parseWatchLayerRelease({
        ...fixture.release,
        runtimeManifest: {
          ...fixture.release.runtimeManifest,
          publicPath,
        },
      }), RUNTIME_SCHEMA_ISSUE_CODES.VALUE);
    }

    for (const publicPath of [
      "https://cdn.example/watch.webp",
      "//cdn.example/watch.webp",
      "data:image/webp;base64,UklGRg==",
      "/assets/watch-2-5d/v2/compact/watch.webp",
      "/assets/watch-2-5d/v1/expanded/watch.webp",
      "/assets/watch-2-5d/v1/compact/../watch.webp",
      "/assets/watch-2-5d/v1/compact/%2e%2e.webp",
      "/assets/watch-2-5d/v1/compact/watch.webp?next=1",
      "/assets/watch-2-5d/v1/compact/watch.webp#fragment",
      "/assets/watch-2-5d/v1/compact\\watch.webp",
    ]) {
      const manifest = structuredClone(fixture.manifest);
      const profiles = manifest.profiles as Record<ProfileId, JsonRecord>;
      const assets = profiles.compact.assets as JsonRecord[];
      assets[0].publicPath = publicPath;
      expectSchemaIssue(
        () => parseRuntimeManifest(manifest, fixture.release),
        RUNTIME_SCHEMA_ISSUE_CODES.PATH,
      );
    }
  });

  it.each(COMPLETION_ORDERS)(
    "returns one complete manifest-ordered profile for completion permutation $caseId",
    async ({ order }) => {
      const fixture = createFixture();
      const owner = createTrackedOwner();
      const gates = fixture.assetPaths.compact.map(() => createBodyGate());
      const bodyGates = new Map(fixture.assetPaths.compact.map((path, index) => [
        path,
        gates[index],
      ] as const));
      const harness = createHarness(fixture, { bodyGates });
      const load = startRuntimeProfileLoad({
        profile: "compact",
        release: fixture.release,
        signal: owner.controller.signal,
      }, harness.dependencies);

      await flushUntil(
        () => harness.fetch.mock.calls.length === fixture.assetPaths.compact.length + 1,
        "all active-profile requests to start",
      );
      for (const index of order) {
        const path = fixture.assetPaths.compact[index];
        gates[index].resolve(fixture.bodies.get(path)!);
        await flushUntil(
          () => harness.events.includes(`decode:${path}`),
          `decode completion for ${path}`,
        );
      }

      const prepared = await load.promise;
      expect(prepared.id).toBe("compact");
      expect(prepared.assets.map(({ record }) => record.publicPath))
        .toEqual(fixture.assetPaths.compact);
      expect(harness.events.filter((event) => event.startsWith("decode:")))
        .toEqual(order.map((index) => `decode:${fixture.assetPaths.compact[index]}`));
      expect(harness.fetch.mock.calls.map(([path]) => path)).toEqual([
        fixture.release.runtimeManifest.publicPath,
        ...fixture.assetPaths.compact,
      ]);
      expect(harness.fetch.mock.calls.some(([path]) => (
        fixture.assetPaths.expanded.includes(path)
      ))).toBe(false);
      for (const [, init] of harness.fetch.mock.calls) {
        expect(init).toMatchObject({
          cache: "no-store",
          credentials: "same-origin",
          method: "GET",
          mode: "same-origin",
          redirect: "error",
        });
        expect(init.signal).toBe(harness.fetch.mock.calls[0][1].signal);
        expect(Object.isFrozen(init)).toBe(true);
      }
      expect(harness.abort).not.toHaveBeenCalled();
      expect(harness.liveObjectUrls.size).toBe(3);

      load.dispose();
      load.dispose();
      load.cancel("profile-change");
      expectOwnerListenerReleased(owner);
      expectNoResourceLeaks(harness, gates);
    },
  );

  it.each(LOADER_FAILURE_CASES)(
    "publishes $code for $name, cleans once, and performs no retry or substitution",
    async ({
      code,
      configure,
      create = createFixture,
      manifestOnly,
      zeroRequests,
    }) => {
      const fixture = create();
      const configured = configure(fixture);
      const owner = createTrackedOwner();
      const harness = createHarness(fixture, configured.options);
      const load = startRuntimeProfileLoad({
        profile: configured.profile ?? "compact",
        release: fixture.release,
        signal: owner.controller.signal,
      }, harness.dependencies);
      const error = await captureLoaderRejection(load.promise);
      await flushMicrotasks();

      expect(error).toBeInstanceOf(RuntimeLoaderError);
      expect(error).toEqual(expect.objectContaining({ code }));
      expect(error.message).toBe(`Watch layer runtime loading failed (${code})`);
      expect(error.message).not.toMatch(/Users|reviewer|https?:\/\//u);

      const terminal = transitionEnhancementState(createEnhancementState({
        profile: "compact",
        release: fixture.release,
        support: { supported: true },
      }), { code, type: "failure" });
      expect(terminal).toMatchObject({
        accepted: true,
        effect: "terminal-error",
        state: {
          code,
          diagnosticCode: code,
          failureOrdinal: 1,
          fallbackVisible: true,
          kind: "error",
          terminal: true,
        },
      });
      const lateRetry = transitionEnhancementState(
        terminal.state,
        { code: code === "asset-fetch" ? "manifest-fetch" : "asset-fetch", type: "failure" },
      );
      expect(lateRetry).toMatchObject({
        accepted: false,
        effect: "none",
        reason: "terminal-state",
        state: terminal.state,
      });

      const requestedPaths = harness.fetch.mock.calls.map(([path]) => path);
      const requestCountAfterFailure = requestedPaths.length;
      await flushMicrotasks();
      expect(harness.fetch).toHaveBeenCalledTimes(requestCountAfterFailure);
      expect(new Set(requestedPaths).size).toBe(requestedPaths.length);
      expect(requestedPaths.every((path) => (
        path === fixture.release.runtimeManifest.publicPath
        || fixture.assetPaths.compact.includes(path)
      ))).toBe(true);
      expect(requestedPaths.some((path) => fixture.assetPaths.expanded.includes(path)))
        .toBe(false);
      if (manifestOnly === true) {
        expect(requestedPaths).toEqual([fixture.release.runtimeManifest.publicPath]);
      }
      if (zeroRequests === true) expect(requestedPaths).toEqual([]);

      load.cancel("profile-change");
      load.dispose();
      expectOwnerListenerReleased(owner);
      expectNoResourceLeaks(harness);
    },
  );

  it("cancels a partially staged profile switch load and releases every URL, request, signal, and promise", async () => {
    const fixture = createFixture();
    const owner = createTrackedOwner();
    const pendingPath = fixture.assetPaths.compact[2];
    const harness = createHarness(fixture, {
      pendingFetchPaths: new Set([pendingPath]),
    });
    const load = startRuntimeProfileLoad({
      profile: "compact",
      release: fixture.release,
      signal: owner.controller.signal,
    }, harness.dependencies);

    await flushUntil(
      () => harness.createObjectURL.mock.calls.length === 2
        && harness.pendingAbortListeners.size === 1,
      "two staged URLs and one pending request",
    );
    const requestsBeforeCancel = harness.fetch.mock.calls.length;
    load.cancel("profile-change");
    load.cancel("profile-change");
    load.dispose();
    const error = await captureLoaderRejection(load.promise);
    await flushMicrotasks();

    expect(error).toBeInstanceOf(RuntimeLoaderCancelledError);
    expect(error).toMatchObject({ reason: "profile-change" });
    expect(error).not.toHaveProperty("code");
    expect(harness.fetch).toHaveBeenCalledTimes(requestsBeforeCancel);
    expectOwnerListenerReleased(owner);
    expectNoResourceLeaks(harness);
  });

  it("turns a real mapping rejection into one terminal mapping-invalid fallback", () => {
    const fixture = createFixture();
    const mapping = createCanonicalCoverTransform({
      encodingScale: 0.5,
      profile: "compact",
      viewportHeight: 844,
      viewportWidth: Number.NaN,
    });
    expect(mapping).toMatchObject({
      code: "nonfinite-input",
      ok: false,
      path: "$.viewportWidth",
    });

    const initial = createEnhancementState({
      profile: "compact",
      release: fixture.release,
      support: { supported: true },
    });
    const failed = transitionEnhancementState(initial, {
      code: "mapping-invalid",
      type: "failure",
    });
    expect(failed).toMatchObject({
      accepted: true,
      effect: "terminal-error",
      state: {
        code: "mapping-invalid",
        diagnosticCode: "mapping-invalid",
        fallbackVisible: true,
        kind: "error",
      },
    });
    expect(transitionEnhancementState(failed.state, {
      code: "runtime-invariant",
      type: "failure",
    })).toMatchObject({
      accepted: false,
      effect: "none",
      reason: "terminal-state",
      state: failed.state,
    });
  });

  it("preserves active time, fails a profile switch once, and never requests a retry", async () => {
    const fixture = createFixture();
    const owner = createTrackedOwner();
    const harness = createHarness(fixture);
    const load = startRuntimeProfileLoad({
      profile: "compact",
      release: fixture.release,
      signal: owner.controller.signal,
    }, harness.dependencies);
    const prepared = await load.promise;
    let state = readyStateFromPrepared(fixture, prepared);
    expect(state.kind).toBe("ready");

    state = acceptedState(transitionEnhancementState(state, {
      activeElapsedMs: 12_500,
      targetProfile: "expanded",
      type: "profile-switch-started",
    }));
    expect(state).toMatchObject({
      activeElapsedMs: 12_500,
      fallbackVisible: true,
      fromProfile: "compact",
      kind: "profile-switch-loading",
      targetProfile: "expanded",
    });

    const failed = transitionEnhancementState(state, {
      code: "profile-switch",
      type: "failure",
    });
    expect(failed).toMatchObject({
      accepted: true,
      effect: "terminal-error",
      state: {
        activeElapsedMs: 12_500,
        code: "profile-switch",
        diagnosticCode: "profile-switch",
        fallbackVisible: true,
        kind: "error",
        terminal: true,
      },
    });
    expect(transitionEnhancementState(failed.state, {
      activeElapsedMs: 12_500,
      targetProfile: "expanded",
      type: "profile-switch-started",
    })).toMatchObject({
      accepted: false,
      effect: "none",
      reason: "terminal-state",
      state: failed.state,
    });
    expect(harness.fetch.mock.calls.map(([path]) => path)).toEqual([
      fixture.release.runtimeManifest.publicPath,
      ...fixture.assetPaths.compact,
    ]);

    load.dispose();
    expectOwnerListenerReleased(owner);
    expectNoResourceLeaks(harness);
  });

  it("routes every published runtime failure code through its responsible module boundary", () => {
    const coveredCodes = new Set<RuntimeFailureCode>([
      ...LOADER_FAILURE_CASES.map(({ code }) => code),
      "mapping-invalid",
      "profile-switch",
    ]);
    expect([...coveredCodes].sort()).toEqual([...RUNTIME_FAILURE_CODES].sort());
  });
});
