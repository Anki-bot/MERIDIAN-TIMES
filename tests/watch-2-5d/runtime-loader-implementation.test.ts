import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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
  isReadyWatchLayerRelease,
  parseWatchLayerRelease,
} from "@/lib/watch-2-5d/runtime-schema";
import { CANONICAL_MASTER_SHA256 } from "@/lib/watch-2-5d/types";
import type {
  ProfileId,
  ReadyWatchLayerRelease,
  RuntimeFailureCode,
} from "@/lib/watch-2-5d/types";

type JsonRecord = Record<string, unknown>;
type Bytes = Uint8Array<ArrayBuffer>;

interface RuntimeFixture {
  readonly assetPaths: Readonly<{
    compact: readonly [string, string];
    expanded: readonly [string, string];
  }>;
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

interface HarnessOptions {
  readonly bodyPromises?: ReadonlyMap<string, Promise<Bytes>>;
  readonly decodeFailures?: ReadonlySet<string>;
  readonly dimensionOverrides?: ReadonlyMap<
    string,
    Readonly<{ height: number; width: number }>
  >;
  readonly fetchFailures?: ReadonlySet<string>;
  readonly responses?: ReadonlyMap<string, ResponseOverride>;
}

interface RuntimeHarness {
  readonly abort: ReturnType<typeof vi.fn>;
  readonly createObjectURL: ReturnType<typeof vi.fn>;
  readonly decodeImage: ReturnType<typeof vi.fn>;
  readonly dependencies: RuntimeLoaderDependencies;
  readonly events: string[];
  readonly fetch: ReturnType<typeof vi.fn>;
  readonly images: HTMLImageElement[];
  readonly revokeObjectURL: ReturnType<typeof vi.fn>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function sha256(bytes: Bytes): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(bytes: Bytes): ArrayBuffer {
  return Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer;
}

function hex(bytes: Bytes): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function webpBytes(marker: number): Bytes {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46, marker, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  bytes.fill(marker, 12);
  return bytes;
}

function asset(
  profile: ProfileId,
  layerId: string,
  name: string,
  bytes: Bytes,
  sourceRect: Readonly<{ height: number; width: number; x: number; y: number }>,
  intrinsic: Readonly<{ height: number; width: number }>,
  zOrder: number,
): JsonRecord {
  const decodedPixelCount = intrinsic.width * intrinsic.height;
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
    id: `${profile}-${name}`,
    intrinsicHeight: intrinsic.height,
    intrinsicWidth: intrinsic.width,
    layerId,
    magicSignatureHex: hex(bytes.slice(0, 12)),
    mediaType: "image/webp",
    profile,
    publicPath,
    sha256: sha256(bytes),
    sourceRect,
    zOrder,
  };
}

function profile(profileId: ProfileId, assets: readonly JsonRecord[]): JsonRecord {
  return {
    assets,
    decodedRgbaBytes: assets.reduce(
      (total, entry) => total + Number(entry.decodedRgbaByteLength),
      0,
    ),
    id: profileId,
    requestCountIncludingManifest: assets.length + 1,
    sourceScale: profileId === "compact" ? 0.5 : 1,
    transferBytes: assets.reduce(
      (total, entry) => total + Number(entry.byteLength),
      0,
    ),
  };
}

function createFixture(
  mutateManifest?: (manifest: JsonRecord) => void,
): RuntimeFixture {
  const compactBackgroundBytes = webpBytes(1);
  const compactLayerBytes = webpBytes(2);
  const expandedBackgroundBytes = webpBytes(3);
  const expandedLayerBytes = webpBytes(4);
  const fullRect = { height: 1_504, width: 2_760, x: 0, y: 0 };
  const layerRect = { height: 80, width: 100, x: 120, y: 240 };

  const compactAssets = [
    asset(
      "compact",
      "reconstructed-background",
      "reconstructed-background",
      compactBackgroundBytes,
      fullRect,
      { height: 752, width: 1_380 },
      0,
    ),
    asset(
      "compact",
      "moving-layer",
      "moving-layer",
      compactLayerBytes,
      layerRect,
      { height: 40, width: 50 },
      1,
    ),
  ];
  const expandedAssets = [
    asset(
      "expanded",
      "reconstructed-background",
      "reconstructed-background",
      expandedBackgroundBytes,
      fullRect,
      { height: 1_504, width: 2_760 },
      0,
    ),
    asset(
      "expanded",
      "moving-layer",
      "moving-layer",
      expandedLayerBytes,
      layerRect,
      { height: 80, width: 100 },
      1,
    ),
  ];
  const manifest: JsonRecord = {
    canonicalMasterSha256: CANONICAL_MASTER_SHA256,
    depthProfiles: [],
    motionProfiles: [],
    packageId: "watch-layer-package",
    phase: "static-layered-reconstruction",
    profiles: {
      compact: profile("compact", compactAssets),
      expanded: profile("expanded", expandedAssets),
    },
    releaseId: "release-v1",
    schemaVersion: 1,
  };
  mutateManifest?.(manifest);

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)) as Bytes;
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

  const compactPaths = compactAssets.map((entry) => String(entry.publicPath)) as [string, string];
  const expandedPaths = expandedAssets.map((entry) => String(entry.publicPath)) as [string, string];
  return {
    assetPaths: { compact: compactPaths, expanded: expandedPaths },
    bodies: new Map([
      [parsedRelease.runtimeManifest.publicPath, manifestBytes],
      [compactPaths[0], compactBackgroundBytes],
      [compactPaths[1], compactLayerBytes],
      [expandedPaths[0], expandedBackgroundBytes],
      [expandedPaths[1], expandedLayerBytes],
    ]),
    manifest,
    manifestBytes,
    release: parsedRelease,
  };
}

function assetRecords(fixture: RuntimeFixture): ReadonlyMap<string, JsonRecord> {
  const profiles = fixture.manifest.profiles as Record<ProfileId, JsonRecord>;
  const entries = (["compact", "expanded"] as const).flatMap((profileId) => (
    (profiles[profileId].assets as JsonRecord[]).map((record) => [
      String(record.publicPath),
      record,
    ] as const)
  ));
  return new Map(entries);
}

function response(
  bytes: Bytes,
  mediaType: string,
  status: number,
  bodyPromise: Promise<Bytes> | undefined,
  bodyError: boolean,
): RuntimeLoaderResponse {
  return {
    arrayBuffer: async () => {
      if (bodyError) throw new Error("injected body failure");
      const body = bodyPromise === undefined ? bytes : await bodyPromise;
      return body.slice().buffer;
    },
    headers: {
      get: (name: string) => name.toLowerCase() === "content-type" ? mediaType : null,
    },
    status,
  };
}

function createHarness(
  fixture: RuntimeFixture,
  options: HarnessOptions = {},
): RuntimeHarness {
  const nativeAbortController = new AbortController();
  const abort = vi.fn(() => nativeAbortController.abort());
  const records = assetRecords(fixture);
  const pathByBodyHash = new Map<string, string>();
  for (const [path, bytes] of fixture.bodies) {
    if (path !== fixture.release.runtimeManifest.publicPath) {
      pathByBodyHash.set(sha256(bytes), path);
    }
  }

  const events: string[] = [];
  const images: HTMLImageElement[] = [];
  const pathByObjectUrl = new Map<string, string>();
  let objectUrlOrdinal = 0;

  const fetch = vi.fn(async (input: string) => {
    events.push(`fetch:${input}`);
    if (options.fetchFailures?.has(input) === true) {
      throw new Error("injected fetch failure");
    }
    const expected = fixture.bodies.get(input);
    if (expected === undefined) throw new Error("unexpected request");
    const override = options.responses?.get(input);
    return response(
      override?.bytes ?? expected,
      override?.mediaType
        ?? (input === fixture.release.runtimeManifest.publicPath
          ? "application/json"
          : "image/webp"),
      override?.status ?? 200,
      options.bodyPromises?.get(input),
      override?.bodyError ?? false,
    );
  });

  const createObjectURL = vi.fn((bytes: Bytes) => {
    const path = pathByBodyHash.get(sha256(bytes));
    if (path === undefined) throw new Error("object URL requested for unverified bytes");
    const objectUrl = `blob:watch-2-5d/${objectUrlOrdinal += 1}`;
    pathByObjectUrl.set(objectUrl, path);
    events.push(`url:${path}`);
    return objectUrl;
  });
  const revokeObjectURL = vi.fn((objectUrl: string) => {
    events.push(`revoke:${objectUrl}`);
  });
  const decodeImage = vi.fn(async (image: HTMLImageElement) => {
    const objectUrl = image.getAttribute("src") ?? "";
    const path = pathByObjectUrl.get(objectUrl);
    if (path === undefined) throw new Error("unknown object URL");
    events.push(`decode:${path}`);
    if (options.decodeFailures?.has(path) === true) {
      throw new Error("injected decode failure");
    }
    const record = records.get(path);
    if (record === undefined) throw new Error("missing asset record");
    const override = options.dimensionOverrides?.get(path);
    Object.defineProperties(image, {
      naturalHeight: {
        configurable: true,
        value: override?.height ?? Number(record.intrinsicHeight),
      },
      naturalWidth: {
        configurable: true,
        value: override?.width ?? Number(record.intrinsicWidth),
      },
    });
  });

  const dependencies: RuntimeLoaderDependencies = {
    createAbortController: () => ({ abort, signal: nativeAbortController.signal }),
    createImage: () => {
      const image = document.createElement("img");
      images.push(image);
      return image;
    },
    createObjectURL,
    decodeImage,
    digest: async (_algorithm, bytes) => {
      const path = pathByBodyHash.get(sha256(bytes))
        ?? (sha256(bytes) === sha256(fixture.manifestBytes)
          ? fixture.release.runtimeManifest.publicPath
          : "unknown");
      events.push(`digest:${path}`);
      return digest(bytes);
    },
    fetch,
    revokeObjectURL,
  };

  return {
    abort,
    createObjectURL,
    decodeImage,
    dependencies,
    events,
    fetch,
    images,
    revokeObjectURL,
  };
}

function changedLastByte(bytes: Bytes): Bytes {
  const changed = bytes.slice();
  changed[changed.length - 1] ^= 0xff;
  return changed;
}

function releaseWithManifestIdentity(
  fixture: RuntimeFixture,
  identity: Partial<ReadyWatchLayerRelease["runtimeManifest"]>,
): ReadyWatchLayerRelease {
  return {
    ...fixture.release,
    runtimeManifest: {
      ...fixture.release.runtimeManifest,
      ...identity,
    },
  };
}

async function rejectedError(
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
  throw new Error("Expected runtime profile loading to reject");
}

// **Validates: Requirements 10.1–10.10, 10.13–10.15, 12.5, 12.13–12.15, 13.9, 14.7, 14.9**
describe("Task 8.4 hash-verifying same-origin runtime loader", () => {
  it("returns one detached complete profile in manifest order after reverse completion", async () => {
    const fixture = createFixture();
    const backgroundBody = deferred<Bytes>();
    const layerBody = deferred<Bytes>();
    const harness = createHarness(fixture, {
      bodyPromises: new Map([
        [fixture.assetPaths.compact[0], backgroundBody.promise],
        [fixture.assetPaths.compact[1], layerBody.promise],
      ]),
    });
    const load = startRuntimeProfileLoad(
      { profile: "compact", release: fixture.release },
      harness.dependencies,
    );

    await vi.waitFor(() => {
      expect(harness.fetch).toHaveBeenCalledTimes(3);
    });
    layerBody.resolve(fixture.bodies.get(fixture.assetPaths.compact[1])!);
    await vi.waitFor(() => {
      expect(harness.events).toContain(`decode:${fixture.assetPaths.compact[1]}`);
    });
    backgroundBody.resolve(fixture.bodies.get(fixture.assetPaths.compact[0])!);

    const prepared = await load.promise;
    expect(prepared.id).toBe("compact");
    expect(prepared.assets.map(({ record }) => record.publicPath)).toEqual(
      fixture.assetPaths.compact,
    );
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
    }
    for (const path of fixture.assetPaths.compact) {
      expect(harness.events.indexOf(`digest:${path}`))
        .toBeLessThan(harness.events.indexOf(`url:${path}`));
    }
    expect(harness.images).toHaveLength(2);
    for (const image of harness.images) {
      expect(image.isConnected).toBe(false);
      expect(image.alt).toBe("");
      expect(image.decoding).toBe("async");
      expect(image.draggable).toBe(false);
      expect(image.getAttribute("src")).toMatch(/^blob:watch-2-5d\//u);
    }
    expect(harness.abort).not.toHaveBeenCalled();
    expect(harness.revokeObjectURL).not.toHaveBeenCalled();

    load.dispose();
    load.dispose();
    load.cancel("profile-change");
    expect(harness.abort).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectURL).toHaveBeenCalledTimes(2);
    for (const [objectUrl] of harness.createObjectURL.mock.results.map(({ value }) => [value])) {
      expect(harness.revokeObjectURL.mock.calls.filter(([value]) => value === objectUrl))
        .toHaveLength(1);
    }
    expect(harness.images.every((image) => !image.hasAttribute("src"))).toBe(true);
  });

  const failureCases: readonly {
    readonly code: RuntimeFailureCode;
    readonly configure: (
      fixture: RuntimeFixture,
    ) => Readonly<{
      inputRelease?: ReadyWatchLayerRelease;
      options?: HarnessOptions;
    }>;
    readonly create?: () => RuntimeFixture;
    readonly manifestOnly?: boolean;
    readonly name: string;
  }[] = [
    {
      code: "manifest-fetch",
      configure: (fixture) => ({
        options: { fetchFailures: new Set([fixture.release.runtimeManifest.publicPath]) },
      }),
      manifestOnly: true,
      name: "manifest fetch",
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
      name: "manifest exact MIME",
    },
    {
      code: "manifest-identity",
      configure: (fixture) => ({
        inputRelease: releaseWithManifestIdentity(fixture, {
          byteLength: fixture.release.runtimeManifest.byteLength + 1,
        }),
      }),
      manifestOnly: true,
      name: "manifest byte length",
    },
    {
      code: "manifest-identity",
      configure: (fixture) => ({
        inputRelease: releaseWithManifestIdentity(fixture, { sha256: "f".repeat(64) as never }),
      }),
      manifestOnly: true,
      name: "manifest SHA-256",
    },
    {
      code: "manifest-schema",
      configure: () => ({}),
      create: () => createFixture((manifest) => {
        manifest.reviewer = "must-not-enter-runtime";
      }),
      manifestOnly: true,
      name: "strict manifest schema",
    },
    {
      code: "manifest-identity",
      configure: () => ({}),
      create: () => createFixture((manifest) => {
        manifest.packageId = "other-package";
      }),
      manifestOnly: true,
      name: "compiled release binding",
    },
    {
      code: "manifest-schema",
      configure: () => ({}),
      create: () => createFixture((manifest) => {
        const profiles = manifest.profiles as Record<ProfileId, JsonRecord>;
        const assets = profiles.compact.assets as JsonRecord[];
        assets[1].publicPath = "https://remote.example/generated.webp";
        assets[1].file = "public/remote/generated.webp";
      }),
      manifestOnly: true,
      name: "remote or generated member",
    },
    {
      code: "asset-fetch",
      configure: (fixture) => ({
        options: { fetchFailures: new Set([fixture.assetPaths.compact[1]]) },
      }),
      name: "asset fetch",
    },
    {
      code: "asset-media",
      configure: (fixture) => ({
        options: {
          responses: new Map([[fixture.assetPaths.compact[1], { mediaType: "image/avif" }]]),
        },
      }),
      name: "asset exact MIME",
    },
    {
      code: "asset-identity",
      configure: (fixture) => ({
        options: {
          responses: new Map([[fixture.assetPaths.compact[1], {
            bytes: fixture.bodies.get(fixture.assetPaths.compact[1])!.slice(0, -1),
          }]]),
        },
      }),
      name: "asset byte length",
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
      name: "asset SHA-256",
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
        options: { decodeFailures: new Set([fixture.assetPaths.compact[1]]) },
      }),
      name: "asset decode",
    },
  ];

  it.each(failureCases)(
    "fails once for $name, aborts once, revokes each staged URL once, and never retries",
    async ({ code, configure, create = createFixture, manifestOnly }) => {
      const fixture = create();
      const configured = configure(fixture);
      const harness = createHarness(fixture, configured.options);
      const load = startRuntimeProfileLoad({
        profile: "compact",
        release: configured.inputRelease ?? fixture.release,
      }, harness.dependencies);
      const error = await rejectedError(load.promise);

      expect(error).toBeInstanceOf(RuntimeLoaderError);
      expect(error).toMatchObject({ code });
      expect(error.message).not.toMatch(/Users|reviewer|https?:\/\//u);
      expect(harness.abort).toHaveBeenCalledTimes(1);
      load.cancel("profile-change");
      load.dispose();
      expect(harness.abort).toHaveBeenCalledTimes(1);

      const requestedPaths = harness.fetch.mock.calls.map(([path]) => path as string);
      expect(new Set(requestedPaths).size).toBe(requestedPaths.length);
      expect(requestedPaths.some((path) => fixture.assetPaths.expanded.includes(path))).toBe(false);
      if (manifestOnly === true) {
        expect(requestedPaths).toEqual([fixture.release.runtimeManifest.publicPath]);
      }
      for (const { value: objectUrl, type } of harness.createObjectURL.mock.results) {
        if (type !== "return") continue;
        expect(harness.revokeObjectURL.mock.calls.filter(([value]) => value === objectUrl))
          .toHaveLength(1);
      }
      expect(harness.revokeObjectURL).toHaveBeenCalledTimes(
        harness.createObjectURL.mock.results.filter(({ type }) => type === "return").length,
      );
    },
  );

  it("cancels an in-flight profile change once without retrying or publishing a diagnostic", async () => {
    const fixture = createFixture();
    const harness = createHarness(fixture);
    const pendingFetch = vi.fn((input: string, init: Readonly<RequestInit>) => (
      new Promise<RuntimeLoaderResponse>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
        harness.events.push(`pending:${input}`);
      })
    ));
    const dependencies = { ...harness.dependencies, fetch: pendingFetch };
    const load = startRuntimeProfileLoad(
      { profile: "expanded", release: fixture.release },
      dependencies,
    );

    await vi.waitFor(() => expect(pendingFetch).toHaveBeenCalledTimes(1));
    load.cancel("profile-change");
    load.cancel("profile-change");
    load.dispose();
    const error = await rejectedError(load.promise);

    expect(error).toBeInstanceOf(RuntimeLoaderCancelledError);
    expect(error).toMatchObject({ reason: "profile-change" });
    expect(error).not.toHaveProperty("code");
    expect(harness.abort).toHaveBeenCalledTimes(1);
    expect(pendingFetch).toHaveBeenCalledTimes(1);
    expect(harness.createObjectURL).not.toHaveBeenCalled();
    expect(harness.revokeObjectURL).not.toHaveBeenCalled();
  });
});
