import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_SCHEMA_ISSUE_CODES,
  RuntimeSchemaError,
  isReadyWatchLayerRelease,
  parseRuntimeManifest,
  parseRuntimeManifestJson,
  parseWatchLayerRelease,
  parseWatchLayerReleaseJson,
  safeParseRuntimeManifest,
  safeParseWatchLayerRelease,
} from "../../lib/watch-2-5d/runtime-schema";
import {
  CANONICAL_MASTER_SHA256,
  RUNTIME_FAILURE_CODES,
  SUPPORT_CODES,
  assertNever,
} from "../../lib/watch-2-5d/types";
import type {
  MotionProfile,
  ProfileId,
  ReadyWatchLayerRelease,
  WatchLayerRelease,
} from "../../lib/watch-2-5d/types";

type JsonRecord = Record<string, unknown>;
type SourceRectFixture = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

const FULL_SOURCE_RECT = Object.freeze({ height: 1_504, width: 2_760, x: 0, y: 0 });
const MOVING_RECTS = Object.freeze([
  Object.freeze({ height: 40, width: 60, x: 100, y: 120 }),
  Object.freeze({ height: 30, width: 50, x: 300, y: 240 }),
  Object.freeze({ height: 44, width: 44, x: 500, y: 360 }),
]);

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function asset(
  profile: ProfileId,
  layerId: string,
  name: string,
  sourceRect: SourceRectFixture,
  zOrder: number,
  hashIndex: number,
): JsonRecord {
  const intrinsicWidth = layerId === "reconstructed-background"
    ? profile === "compact" ? 1_380 : 2_760
    : profile === "compact" ? Math.ceil(sourceRect.width / 2) : sourceRect.width;
  const intrinsicHeight = layerId === "reconstructed-background"
    ? profile === "compact" ? 752 : 1_504
    : profile === "compact" ? Math.ceil(sourceRect.height / 2) : sourceRect.height;
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  return {
    byteLength: 512,
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
    file: `public/assets/watch-2-5d/v1/${profile}/${name}.webp`,
    id: `${profile}-${name}`,
    intrinsicHeight,
    intrinsicWidth,
    layerId,
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile,
    publicPath: `/assets/watch-2-5d/v1/${profile}/${name}.webp`,
    sha256: hash(hashIndex),
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
    transferBytes: assets.reduce((total, entry) => total + Number(entry.byteLength), 0),
  };
}

function readyRelease(depthEnabled = false): ReadyWatchLayerRelease {
  const parsed = parseWatchLayerRelease({
    depthEnabled,
    packageId: "watch-layer-package",
    releaseId: "release-v1",
    runtimeManifest: {
      byteLength: 2_048,
      mediaType: "application/json",
      publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      sha256: hash(15),
    },
    schemaVersion: 1,
    status: "ready",
  });
  if (!isReadyWatchLayerRelease(parsed)) {
    throw new Error("Ready fixture unexpectedly parsed as fallback-only");
  }
  return parsed;
}

function manifestWithLayers(layerFixtures: readonly {
  readonly id: string;
  readonly name: string;
  readonly rect: SourceRectFixture;
  readonly zOrder: number;
}[]): JsonRecord {
  const compactAssets = [
    asset("compact", "reconstructed-background", "reconstructed-background", FULL_SOURCE_RECT, 0, 1),
    ...layerFixtures.map((layer, index) => asset(
      "compact",
      layer.id,
      layer.name,
      layer.rect,
      layer.zOrder,
      20 + index,
    )),
  ];
  const expandedAssets = [
    asset("expanded", "reconstructed-background", "reconstructed-background", FULL_SOURCE_RECT, 0, 2),
    ...layerFixtures.map((layer, index) => asset(
      "expanded",
      layer.id,
      layer.name,
      layer.rect,
      layer.zOrder,
      40 + index,
    )),
  ];
  return {
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
}

function staticManifest(): JsonRecord {
  return manifestWithLayers([]);
}

function motionManifest(): JsonRecord {
  const layers = [
    { id: "continuous-layer", name: "continuous-layer", rect: MOVING_RECTS[0], zOrder: 1 },
    { id: "discrete-layer", name: "discrete-layer", rect: MOVING_RECTS[1], zOrder: 2 },
    { id: "oscillator-layer", name: "oscillator-layer", rect: MOVING_RECTS[2], zOrder: 3 },
  ] as const;
  const manifest = manifestWithLayers(layers);
  manifest.phase = "approved-part-motion";
  manifest.motionProfiles = [
    {
      approvalId: "approval-continuous",
      direction: 1,
      evidence: "authored-assumption",
      id: "motion-continuous",
      kind: "continuous-rotation",
      layerId: "continuous-layer",
      maxRadians: Math.PI * 2,
      minRadians: -Math.PI * 2,
      periodMs: 12_000,
      phaseRadians: 0,
      pivot: { x: 130, y: 140 },
      referenceRadians: 0,
    },
    {
      approvalId: "approval-discrete",
      cadenceMs: 1_000,
      direction: -1,
      evidence: "visible-evidence",
      id: "motion-discrete",
      kind: "discrete-rotation",
      layerId: "discrete-layer",
      maxRadians: Math.PI * 2,
      minRadians: -Math.PI * 2,
      phaseRadians: 0,
      pivot: { x: 325, y: 255 },
      referenceRadians: 0,
      stepRadians: Math.PI / 30,
    },
    {
      amplitudeRadians: 0.2,
      approvalId: "approval-oscillator",
      direction: 1,
      evidence: "authored-assumption",
      id: "motion-oscillator",
      kind: "oscillation",
      layerId: "oscillator-layer",
      maxRadians: 0.2,
      minRadians: -0.2,
      periodMs: 500,
      phaseRadians: 0,
      pivot: { x: 522, y: 382 },
      referenceRadians: 0,
    },
  ];
  return manifest;
}

function optionalDepthManifest(): JsonRecord {
  const manifest = motionManifest();
  manifest.phase = "optional-depth";
  manifest.depthProfiles = (["compact", "expanded"] as const).map((profileId, index) => ({
    approvalId: `approval-depth-${profileId}`,
    authoredInterpretation: true,
    enabled: true,
    id: `depth-${profileId}`,
    layers: [{
      displacementShortAxisFraction: index === 0 ? 0.001 : 0.002,
      layerId: "continuous-layer",
      phaseRadians: 0,
      rotationDegrees: 0.2,
      scaleDelta: 0.003,
      zOrder: 1,
    }],
    periodMs: 28_000,
    profile: profileId,
  }));
  return manifest;
}

function expectSchemaError(
  operation: () => unknown,
  issueCode?: string,
  code?: string,
): RuntimeSchemaError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeSchemaError);
    if (!(error instanceof RuntimeSchemaError)) throw error;
    if (issueCode !== undefined) expect(error.issueCode).toBe(issueCode);
    if (code !== undefined) expect(error.code).toBe(code);
    return error;
  }
  throw new Error("Expected runtime schema validation to fail");
}

function releaseSummary(release: WatchLayerRelease): string {
  switch (release.status) {
    case "fallback-only":
      return "fallback-only";
    case "ready":
      return release.releaseId;
    default:
      return assertNever(release, "release exhaustiveness");
  }
}

function motionTimingField(profile: MotionProfile): number {
  switch (profile.kind) {
    case "continuous-rotation":
    case "oscillation":
      return profile.periodMs;
    case "discrete-rotation":
      return profile.cadenceMs;
    default:
      return assertNever(profile, "motion exhaustiveness");
  }
}

// Validates: Requirements 10.13–10.15, 12.13, 15.13.
describe("watch 2.5D release runtime schema", () => {
  it("accepts the checked-in fallback-only release as a structurally URL-free variant", () => {
    const bytes = readFileSync(
      resolve(process.cwd(), "data/watch-layer-release.json"),
      "utf8",
    );
    const parsed = parseWatchLayerReleaseJson(bytes);

    expect(parsed).toEqual({
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    });
    expect(releaseSummary(parsed)).toBe("fallback-only");
    expect(JSON.stringify(parsed)).not.toContain("/assets/");
    expect(isReadyWatchLayerRelease(parsed)).toBe(false);
    expect(safeParseWatchLayerRelease(JSON.parse(bytes))).toMatchObject({ success: true });
  });

  it("rejects every URL-bearing or depth-enabled fallback-only mutation", () => {
    const fallback = {
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    };
    expectSchemaError(
      () => parseWatchLayerRelease({
        ...fallback,
        runtimeManifest: { publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json" },
      }),
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
    );
    expectSchemaError(
      () => parseWatchLayerRelease({
        ...fallback,
        publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      }),
      RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
    );
    expectSchemaError(
      () => parseWatchLayerRelease({ ...fallback, depthEnabled: true }),
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
    );
  });

  it("requires the ready pointer to name the one canonical same-origin manifest", () => {
    expectSchemaError(() => parseWatchLayerRelease({
      ...readyRelease(),
      runtimeManifest: {
        ...readyRelease().runtimeManifest,
        publicPath: "https://example.test/assets/watch-2-5d/v1/runtime-manifest.json",
      },
    }), RUNTIME_SCHEMA_ISSUE_CODES.VALUE);

    const parsed = readyRelease();
    expect(isReadyWatchLayerRelease(parsed)).toBe(true);
    expect(releaseSummary(parsed)).toBe("release-v1");
    expect(Object.isFrozen(parsed.runtimeManifest)).toBe(true);
  });
});

// Validates: Requirements 2.9–2.13, 6.1, 7.1–7.5, 10.7–10.15, 12.5, 12.13–12.16, 15.13.
describe("watch 2.5D public runtime manifest schema", () => {
  it("accepts and release-binds exact static, motion, and approved depth payloads", () => {
    const staticRelease = readyRelease();
    const parsedStatic = parseRuntimeManifest(staticManifest(), staticRelease);
    expect(parsedStatic.phase).toBe("static-layered-reconstruction");
    expect(parsedStatic.profiles.compact.assets).toHaveLength(1);
    expect(Object.isFrozen(parsedStatic.profiles.compact.assets)).toBe(true);

    const parsedMotion = parseRuntimeManifest(motionManifest(), staticRelease);
    expect(parsedMotion.motionProfiles.map(motionTimingField)).toEqual([12_000, 1_000, 500]);

    const depthRelease = readyRelease(true);
    const parsedDepth = parseRuntimeManifest(optionalDepthManifest(), depthRelease);
    expect(parsedDepth.depthProfiles).toHaveLength(2);
    expect(parsedDepth.depthProfiles.every(({ authoredInterpretation }) => (
      authoredInterpretation
    ))).toBe(true);

    const jsonBytes = new TextEncoder().encode(JSON.stringify(staticManifest()));
    expect(parseRuntimeManifestJson(jsonBytes, staticRelease).releaseId).toBe("release-v1");
    expect(safeParseRuntimeManifest(staticManifest(), staticRelease)).toMatchObject({
      success: true,
    });
  });

  it("rejects unknown fields at every public payload level", () => {
    const mutations = [
      (value: JsonRecord) => { value.geometry = {}; },
      (value: JsonRecord) => {
        const profiles = value.profiles as Record<ProfileId, JsonRecord>;
        profiles.compact.futureProfile = true;
      },
      (value: JsonRecord) => {
        const profiles = value.profiles as Record<ProfileId, JsonRecord>;
        const assets = profiles.compact.assets as JsonRecord[];
        assets[0].mesh = "future.glb";
      },
      (value: JsonRecord) => {
        const motions = value.motionProfiles as JsonRecord[];
        motions[0].randomSeed = 42;
      },
      (value: JsonRecord) => {
        const depths = value.depthProfiles as JsonRecord[];
        depths[0].perspectiveCamera = true;
      },
    ];

    for (const mutate of mutations) {
      const value = structuredClone(optionalDepthManifest());
      mutate(value);
      expectSchemaError(
        () => parseRuntimeManifest(value, readyRelease(true)),
        RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
      );
    }
  });

  it("accepts only canonical profile-local same-origin WebP members", () => {
    const invalidPaths = [
      "https://cdn.example/watch.webp",
      "//cdn.example/watch.webp",
      "/assets/watch-2-5d/v2/compact/watch.webp",
      "/assets/watch-2-5d/v1/expanded/watch.webp",
      "/assets/watch-2-5d/v1/compact/../watch.webp",
      "/assets/watch-2-5d/v1/compact/watch.webp?next=1",
      "/assets/watch-2-5d/v1/compact/%2e%2e.webp",
    ];
    for (const publicPath of invalidPaths) {
      const value = structuredClone(staticManifest());
      const profiles = value.profiles as Record<ProfileId, JsonRecord>;
      const assets = profiles.compact.assets as JsonRecord[];
      assets[0].publicPath = publicPath;
      expectSchemaError(
        () => parseRuntimeManifest(value, readyRelease()),
        RUNTIME_SCHEMA_ISSUE_CODES.PATH,
      );
    }
  });

  it("rejects payloads not bound to the compiled package, release, or canonical source", () => {
    for (const [field, replacement] of [
      ["packageId", "other-package"],
      ["releaseId", "other-release"],
      ["canonicalMasterSha256", hash(14)],
    ] as const) {
      const value = structuredClone(staticManifest());
      value[field] = replacement;
      expectSchemaError(
        () => parseRuntimeManifest(value, readyRelease()),
        RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
        "manifest-identity",
      );
    }
  });

  it("rejects future-3D, non-WebP, partial, over-requested, and depth-bypass payloads", () => {
    const future = structuredClone(staticManifest());
    future.phase = "future-full-3d";
    expectSchemaError(
      () => parseRuntimeManifest(future, readyRelease()),
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
    );

    const modelAsset = structuredClone(staticManifest());
    const modelProfiles = modelAsset.profiles as Record<ProfileId, JsonRecord>;
    const modelAssets = modelProfiles.compact.assets as JsonRecord[];
    modelAssets[0].mediaType = "model/gltf+json";
    expectSchemaError(
      () => parseRuntimeManifest(modelAsset, readyRelease()),
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
    );

    const partial = structuredClone(staticManifest());
    const partialProfiles = partial.profiles as Record<ProfileId, JsonRecord>;
    partialProfiles.compact = profile("compact", []);
    expectSchemaError(
      () => parseRuntimeManifest(partial, readyRelease()),
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
    );

    const tooManyLayers = Array.from({ length: 7 }, (_, index) => ({
      id: `layer-${index + 1}`,
      name: `layer-${index + 1}`,
      rect: { height: 2, width: 2, x: index * 3, y: index * 3 },
      zOrder: index + 1,
    }));
    expectSchemaError(
      () => parseRuntimeManifest(manifestWithLayers(tooManyLayers), readyRelease()),
      RUNTIME_SCHEMA_ISSUE_CODES.BUDGET,
    );

    expectSchemaError(
      () => parseRuntimeManifest(optionalDepthManifest(), readyRelease(false)),
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "manifest-identity",
    );
    expectSchemaError(
      () => parseRuntimeManifest(motionManifest(), readyRelease(true)),
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "manifest-identity",
    );
  });

  it("returns deterministic safe-parse failures for malformed JSON and schema values", () => {
    expectSchemaError(
      () => parseRuntimeManifestJson("{broken", readyRelease()),
      RUNTIME_SCHEMA_ISSUE_CODES.JSON,
    );
    expectSchemaError(
      () => parseWatchLayerReleaseJson("\ufeff{}"),
      RUNTIME_SCHEMA_ISSUE_CODES.JSON,
    );
    const invalid = structuredClone(staticManifest());
    invalid.schemaVersion = 2;
    const result = safeParseRuntimeManifest(invalid, readyRelease());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.toJSON()).toMatchObject({
        code: "manifest-schema",
        issueCode: RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
        ok: false,
        path: "$manifest.schemaVersion",
      });
    }
  });

  it("publishes unique exhaustive support and runtime failure code sets", () => {
    expect(new Set(SUPPORT_CODES).size).toBe(SUPPORT_CODES.length);
    expect(new Set(RUNTIME_FAILURE_CODES).size).toBe(RUNTIME_FAILURE_CODES.length);
    expect(RUNTIME_FAILURE_CODES).toContain("manifest-schema");
    expect(RUNTIME_FAILURE_CODES).toContain("runtime-invariant");
  });
});
