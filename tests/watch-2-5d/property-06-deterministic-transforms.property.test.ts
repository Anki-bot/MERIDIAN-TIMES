import fc from "fast-check";
import { expect, it, vi } from "vitest";
import {
  createCanonicalCoverTransform,
  type CanonicalCoverTransform,
} from "@/lib/watch-2-5d/cover-transform";
import {
  FULL_ROTATION_RADIANS,
  IDENTITY_MATRIX_2D,
  composeLayerTransform,
  sampleApprovedLayerMotion,
  sampleInheritedGlobalMatrix,
  sampleInheritedGlobalTransform,
  sampleMotion,
  sampleMotionAngle,
} from "@/lib/watch-2-5d/motion";
import {
  isReadyWatchLayerRelease,
  parseRuntimeManifest,
  parseWatchLayerRelease,
} from "@/lib/watch-2-5d/runtime-schema";
import {
  CANONICAL_MASTER_SHA256,
  type MotionProfile,
  type ProfileId,
  type ReadonlyMatrix2D,
  type ReadyWatchLayerRelease,
  type SourceRect,
  type ValidatedRuntimeManifest,
} from "@/lib/watch-2-5d/types";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 6: Elapsed-time deterministic transform composition";

// Reproduce with: seed=20260606, numRuns=128.
const PROPERTY_SEED = 20_260_606;
const PROPERTY_RUNS = 128;
const STATIC_LAYER_ID = "static-dial";
const FULL_SOURCE_RECT = Object.freeze({ height: 1_504, width: 2_760, x: 0, y: 0 });
const STATIC_LAYER_RECT = Object.freeze({ height: 32, width: 32, x: 0, y: 0 });
const MATRIX_FIELDS = ["a", "b", "c", "d", "e", "f"] as const;

type JsonRecord = Record<string, unknown>;
type ClockDisposition = "active" | "dialog-paused" | "page-hidden-paused";
type ApplicationState = Readonly<{
  clockDisposition: ClockDisposition;
  depthEnabled: false;
  enhancement: "ready";
  profile: ProfileId;
}>;
type Viewport = Readonly<{ height: number; width: number }>;
type MotionGeometry = Readonly<{
  direction: -1 | 1;
  evidence: "authored-assumption" | "visible-evidence";
  pivotOffsetX: number;
  pivotOffsetY: number;
  referenceIndex: number;
  x: number;
  y: number;
}>;
type GeneratedMotion =
  | (MotionGeometry & Readonly<{
      kind: "continuous-rotation";
      periodMs: number;
    }>)
  | (MotionGeometry & Readonly<{
      cadenceMs: number;
      kind: "discrete-rotation";
      stepDivisor: 2 | 4 | 8 | 16;
    }>)
  | (MotionGeometry & Readonly<{
      amplitudeRadians: number;
      kind: "oscillation";
      periodMs: number;
    }>);
type FramePartitionRecipe = Readonly<{
  firstFrameCount: number;
  firstSalt: number;
  secondFrameCountOffset: number;
  secondSalt: number;
}>;
type LayerTransformSample = Readonly<{
  composed: ReadonlyMatrix2D;
  depth: ReadonlyMatrix2D;
  global: ReadonlyMatrix2D;
  globalCycleProgress: number;
  layerId: string;
  part: ReadonlyMatrix2D;
}>;
type PresentationSample = Readonly<{
  cover: CanonicalCoverTransform;
  global: ReadonlyMatrix2D;
  globalCycleProgress: number;
  layers: readonly LayerTransformSample[];
}>;

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function readyRelease(): ReadyWatchLayerRelease {
  const release = parseWatchLayerRelease({
    depthEnabled: false,
    packageId: "watch-layer-package",
    releaseId: "release-v1",
    runtimeManifest: {
      byteLength: 2_048,
      mediaType: "application/json",
      publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      sha256: hash(900),
    },
    schemaVersion: 1,
    status: "ready",
  });
  if (!isReadyWatchLayerRelease(release)) {
    throw new Error("Generated release unexpectedly parsed as fallback-only");
  }
  return release;
}

const READY_RELEASE = readyRelease();

function movingLayerId(index: number): string {
  return `moving-layer-${index}`;
}

function sourceRectFor(config: GeneratedMotion): SourceRect {
  return Object.freeze({ height: 64, width: 64, x: config.x, y: config.y });
}

function asset(
  profileId: ProfileId,
  layerId: string,
  sourceRect: SourceRect,
  zOrder: number,
  hashIndex: number,
): JsonRecord {
  const isBackground = layerId === "reconstructed-background";
  const intrinsicWidth = isBackground
    ? profileId === "compact" ? 1_380 : 2_760
    : profileId === "compact" ? Math.ceil(sourceRect.width / 2) : sourceRect.width;
  const intrinsicHeight = isBackground
    ? profileId === "compact" ? 752 : 1_504
    : profileId === "compact" ? Math.ceil(sourceRect.height / 2) : sourceRect.height;
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  const name = layerId;

  return {
    byteLength: 256 + zOrder,
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
    file: `public/assets/watch-2-5d/v1/${profileId}/${name}.webp`,
    id: `${profileId}-${name}`,
    intrinsicHeight,
    intrinsicWidth,
    layerId,
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile: profileId,
    publicPath: `/assets/watch-2-5d/v1/${profileId}/${name}.webp`,
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
    transferBytes: assets.reduce(
      (total, entry) => total + Number(entry.byteLength),
      0,
    ),
  };
}

function motionProfile(config: GeneratedMotion, index: number): JsonRecord {
  const referenceRadians = config.kind === "oscillation"
    ? 0
    : config.referenceIndex * Math.PI / 8;
  const base = {
    approvalId: `approval-motion-${index}`,
    direction: config.direction,
    evidence: config.evidence,
    id: `motion-profile-${index}`,
    layerId: movingLayerId(index),
    maxRadians: config.kind === "oscillation"
      ? config.amplitudeRadians
      : referenceRadians + FULL_ROTATION_RADIANS,
    minRadians: config.kind === "oscillation"
      ? -config.amplitudeRadians
      : referenceRadians - FULL_ROTATION_RADIANS,
    phaseRadians: config.kind === "oscillation" ? 0 : referenceRadians,
    pivot: {
      x: config.x + config.pivotOffsetX,
      y: config.y + config.pivotOffsetY,
    },
    referenceRadians,
  };

  switch (config.kind) {
    case "continuous-rotation":
      return { ...base, kind: config.kind, periodMs: config.periodMs };
    case "discrete-rotation":
      return {
        ...base,
        cadenceMs: config.cadenceMs,
        kind: config.kind,
        stepRadians: FULL_ROTATION_RADIANS / config.stepDivisor,
      };
    case "oscillation":
      return {
        ...base,
        amplitudeRadians: config.amplitudeRadians,
        kind: config.kind,
        periodMs: config.periodMs,
      };
  }
}

function rawManifest(configs: readonly GeneratedMotion[]): JsonRecord {
  const layerFixtures = [
    { id: STATIC_LAYER_ID, rect: STATIC_LAYER_RECT, zOrder: 1 },
    ...configs.map((config, index) => ({
      id: movingLayerId(index),
      rect: sourceRectFor(config),
      zOrder: index + 2,
    })),
  ];

  const assetsFor = (profileId: ProfileId, hashOffset: number): JsonRecord[] => [
    asset(
      profileId,
      "reconstructed-background",
      FULL_SOURCE_RECT,
      0,
      hashOffset,
    ),
    ...layerFixtures.map((layer, index) => asset(
      profileId,
      layer.id,
      layer.rect,
      layer.zOrder,
      hashOffset + index + 1,
    )),
  ];
  const compactAssets = assetsFor("compact", 100);
  const expandedAssets = assetsFor("expanded", 200);

  return {
    canonicalMasterSha256: CANONICAL_MASTER_SHA256,
    depthProfiles: [],
    motionProfiles: configs.map(motionProfile),
    packageId: "watch-layer-package",
    phase: "approved-part-motion",
    profiles: {
      compact: profile("compact", compactAssets),
      expanded: profile("expanded", expandedAssets),
    },
    releaseId: "release-v1",
    schemaVersion: 1,
  };
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Independent affine-product oracle; no production multiplication helper is used. */
function multiplyMatrixOracle(
  left: ReadonlyMatrix2D,
  right: ReadonlyMatrix2D,
): ReadonlyMatrix2D {
  return Object.freeze({
    a: cleanZero(left.a * right.a + left.c * right.b),
    b: cleanZero(left.b * right.a + left.d * right.b),
    c: cleanZero(left.a * right.c + left.c * right.d),
    d: cleanZero(left.b * right.c + left.d * right.d),
    e: cleanZero(left.a * right.e + left.c * right.f + left.e),
    f: cleanZero(left.b * right.e + left.d * right.f + left.f),
  });
}

function coverMatrixOracle(transform: CanonicalCoverTransform): ReadonlyMatrix2D {
  return Object.freeze({
    a: transform.coverScale,
    b: 0,
    c: 0,
    d: transform.coverScale,
    e: transform.offsetX,
    f: transform.offsetY,
  });
}

function composeMatrixOracle(
  global: ReadonlyMatrix2D,
  cover: CanonicalCoverTransform,
  depth: ReadonlyMatrix2D,
  part: ReadonlyMatrix2D,
): ReadonlyMatrix2D {
  return multiplyMatrixOracle(
    multiplyMatrixOracle(
      multiplyMatrixOracle(global, coverMatrixOracle(cover)),
      depth,
    ),
    part,
  );
}

function samplePresentation(
  manifest: ValidatedRuntimeManifest,
  state: ApplicationState,
  viewport: Viewport,
  activeElapsedMs: number,
): PresentationSample {
  const coverResult = createCanonicalCoverTransform({
    encodingScale: state.profile === "compact" ? 0.5 : 1,
    profile: state.profile,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  });
  if (!coverResult.ok) throw new Error(coverResult.message);

  const globalTransform = sampleInheritedGlobalTransform(activeElapsedMs);
  const global = sampleInheritedGlobalMatrix(
    activeElapsedMs,
    viewport.width,
    viewport.height,
  );
  const layers = manifest.profiles[state.profile].assets.map((entry) => {
    const part = sampleApprovedLayerMotion(manifest, entry.layerId, activeElapsedMs);
    const depth = IDENTITY_MATRIX_2D;
    return Object.freeze({
      composed: composeLayerTransform({
        cover: coverResult.value,
        depth,
        global,
        part,
      }),
      depth,
      global,
      globalCycleProgress: globalTransform.cycleProgress,
      layerId: String(entry.layerId),
      part,
    });
  });

  return Object.freeze({
    cover: coverResult.value,
    global,
    globalCycleProgress: globalTransform.cycleProgress,
    layers: Object.freeze(layers),
  });
}

/** Independent frame-schedule oracle: all partitions are positive and sum exactly. */
function partitionElapsedTime(
  activeElapsedMs: number,
  frameCount: number,
  salt: number,
): readonly number[] {
  if (
    !Number.isSafeInteger(activeElapsedMs)
    || activeElapsedMs < frameCount
    || !Number.isSafeInteger(frameCount)
    || frameCount < 1
  ) {
    throw new Error("Frame partition inputs must be positive safe integers");
  }
  const base = Math.floor(activeElapsedMs / frameCount);
  const remainder = activeElapsedMs % frameCount;
  const partition = Array.from({ length: frameCount }, () => base);
  const start = (salt >>> 0) % frameCount;
  for (let index = 0; index < remainder; index += 1) {
    partition[(start + index) % frameCount] += 1;
  }
  return Object.freeze(partition);
}

function elapsedTimeOracle(frameSchedule: readonly number[]): number {
  return frameSchedule.reduce((total, delta) => {
    if (!Number.isSafeInteger(delta) || delta <= 0) {
      throw new Error("A rendered-frame partition must contain positive integers");
    }
    return total + delta;
  }, 0);
}

function sampleFrameSchedule(
  manifest: ValidatedRuntimeManifest,
  state: ApplicationState,
  viewport: Viewport,
  frameSchedule: readonly number[],
): PresentationSample {
  let activeElapsedMs = 0;
  let sampled = samplePresentation(manifest, state, viewport, activeElapsedMs);
  for (const delta of frameSchedule) {
    activeElapsedMs += delta;
    sampled = samplePresentation(manifest, state, viewport, activeElapsedMs);
  }
  return sampled;
}

function matrixSnapshot(sample: PresentationSample) {
  return {
    global: sample.global,
    layers: sample.layers.map((layer) => ({
      composed: layer.composed,
      depth: layer.depth,
      global: layer.global,
      layerId: layer.layerId,
      part: layer.part,
    })),
  };
}

function encodedMatrixSnapshot(sample: PresentationSample): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(matrixSnapshot(sample)));
}

function expectOneGlobalPhase(sample: PresentationSample): void {
  expect(sample.layers.length).toBeGreaterThanOrEqual(3);
  expect(new Set(sample.layers.map((layer) => layer.global)).size).toBe(1);
  expect(new Set(sample.layers.map((layer) => layer.globalCycleProgress)).size).toBe(1);

  for (const layer of sample.layers) {
    expect(layer.global).toBe(sample.global);
    expect(layer.globalCycleProgress).toBe(sample.globalCycleProgress);
    expect(layer.composed).toEqual(composeMatrixOracle(
      sample.global,
      sample.cover,
      layer.depth,
      layer.part,
    ));
  }
}

function completeCycleMs(profile: MotionProfile): number {
  switch (profile.kind) {
    case "continuous-rotation":
    case "oscillation":
      return profile.periodMs;
    case "discrete-rotation":
      return profile.cadenceMs * Math.round(
        FULL_ROTATION_RADIANS / Math.abs(profile.stepRadians),
      );
  }
}

function sampleWithoutAmbientInputs<T>(operation: () => T): T {
  const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
    throw new Error("Motion sampling must not read wall-clock time");
  });
  const random = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Motion sampling must not read unrecorded random input");
  });
  try {
    return operation();
  } finally {
    random.mockRestore();
    dateNow.mockRestore();
  }
}

const motionGeometryArbitraries = {
  direction: fc.constantFrom(-1 as const, 1 as const),
  evidence: fc.constantFrom(
    "authored-assumption" as const,
    "visible-evidence" as const,
  ),
  pivotOffsetX: fc.integer({ min: 0, max: 63 }),
  pivotOffsetY: fc.integer({ min: 0, max: 63 }),
  referenceIndex: fc.integer({ min: -8, max: 8 }),
  x: fc.integer({ min: 0, max: 2_696 }),
  y: fc.integer({ min: 0, max: 1_440 }),
};

const generatedMotionArbitrary: fc.Arbitrary<GeneratedMotion> = fc.oneof(
  fc.record({
    ...motionGeometryArbitraries,
    kind: fc.constant("continuous-rotation" as const),
    periodMs: fc.integer({ min: 64, max: 1_000_000 }),
  }),
  fc.record({
    ...motionGeometryArbitraries,
    cadenceMs: fc.integer({ min: 16, max: 100_000 }),
    kind: fc.constant("discrete-rotation" as const),
    stepDivisor: fc.constantFrom(2 as const, 4 as const, 8 as const, 16 as const),
  }),
  fc.record({
    ...motionGeometryArbitraries,
    amplitudeRadians: fc.integer({ min: 1, max: 1_000 }).map((value) => value / 1_000),
    kind: fc.constant("oscillation" as const),
    periodMs: fc.integer({ min: 64, max: 1_000_000 }),
  }),
);

const applicationStateArbitrary: fc.Arbitrary<ApplicationState> = fc.record({
  clockDisposition: fc.constantFrom(
    "active" as const,
    "dialog-paused" as const,
    "page-hidden-paused" as const,
  ),
  depthEnabled: fc.constant(false as const),
  enhancement: fc.constant("ready" as const),
  profile: fc.constantFrom("compact" as const, "expanded" as const),
});

const activeElapsedArbitrary = fc.oneof(
  fc.constantFrom(16, 13_999, 14_000, 14_001, 27_999, 28_000, 28_001),
  fc.integer({ min: 16, max: 2_000_000_000 }),
);

const generatedCaseArbitrary = fc.record({
  activeElapsedMs: activeElapsedArbitrary,
  applicationState: applicationStateArbitrary,
  framePartition: fc.record({
    firstFrameCount: fc.integer({ min: 1, max: 8 }),
    firstSalt: fc.integer(),
    secondFrameCountOffset: fc.integer({ min: 1, max: 8 }),
    secondSalt: fc.integer(),
  }) satisfies fc.Arbitrary<FramePartitionRecipe>,
  manifest: fc.array(generatedMotionArbitrary, { minLength: 1, maxLength: 4 }),
  viewport: fc.record({
    height: fc.integer({ min: 240, max: 2_560 }),
    width: fc.oneof(
      fc.constantFrom(320, 390, 700, 701, 1_024, 1_440, 2_560),
      fc.integer({ min: 320, max: 2_560 }),
    ),
  }),
});

// **Validates: Requirements 6.2, 6.3, 6.4, 6.10, 6.11, 6.14, 6.15, 6.16, 6.17, 6.18**
it(PROPERTY_TAG, { timeout: 60_000 }, () => {
  fc.assert(
    fc.property(generatedCaseArbitrary, (generated) => {
      const raw = rawManifest(generated.manifest);
      const firstManifest = parseRuntimeManifest(structuredClone(raw), READY_RELEASE);
      const secondManifest = parseRuntimeManifest(structuredClone(raw), READY_RELEASE);
      expect(secondManifest).toEqual(firstManifest);

      const firstFrameCount = generated.framePartition.firstFrameCount;
      const secondFrameCount = firstFrameCount
        + generated.framePartition.secondFrameCountOffset;
      const firstSchedule = partitionElapsedTime(
        generated.activeElapsedMs,
        firstFrameCount,
        generated.framePartition.firstSalt,
      );
      const secondSchedule = partitionElapsedTime(
        generated.activeElapsedMs,
        secondFrameCount,
        generated.framePartition.secondSalt,
      );
      expect(firstSchedule).not.toEqual(secondSchedule);
      expect(elapsedTimeOracle(firstSchedule)).toBe(generated.activeElapsedMs);
      expect(elapsedTimeOracle(secondSchedule)).toBe(generated.activeElapsedMs);

      const {
        directFirst,
        directSecond,
        firstScheduleResult,
        reference,
        secondScheduleResult,
      } = sampleWithoutAmbientInputs(() => ({
        directFirst: samplePresentation(
          firstManifest,
          generated.applicationState,
          generated.viewport,
          generated.activeElapsedMs,
        ),
        directSecond: samplePresentation(
          secondManifest,
          structuredClone(generated.applicationState),
          structuredClone(generated.viewport),
          generated.activeElapsedMs,
        ),
        firstScheduleResult: sampleFrameSchedule(
          firstManifest,
          generated.applicationState,
          generated.viewport,
          firstSchedule,
        ),
        reference: samplePresentation(
          firstManifest,
          generated.applicationState,
          generated.viewport,
          0,
        ),
        secondScheduleResult: sampleFrameSchedule(
          secondManifest,
          generated.applicationState,
          generated.viewport,
          secondSchedule,
        ),
      }));

      expect(matrixSnapshot(directSecond)).toEqual(matrixSnapshot(directFirst));
      expect(encodedMatrixSnapshot(directSecond)).toEqual(
        encodedMatrixSnapshot(directFirst),
      );
      expect(matrixSnapshot(firstScheduleResult)).toEqual(matrixSnapshot(directFirst));
      expect(matrixSnapshot(secondScheduleResult)).toEqual(matrixSnapshot(directFirst));
      expect(encodedMatrixSnapshot(firstScheduleResult)).toEqual(
        encodedMatrixSnapshot(secondScheduleResult),
      );

      expectOneGlobalPhase(directFirst);
      expectOneGlobalPhase(firstScheduleResult);
      expectOneGlobalPhase(secondScheduleResult);
      expect(reference.globalCycleProgress).toBe(0);
      expect(reference.global).toEqual(sampleInheritedGlobalMatrix(
        0,
        generated.viewport.width,
        generated.viewport.height,
      ));

      for (const profile of firstManifest.motionProfiles) {
        const angle = sampleMotionAngle(profile, generated.activeElapsedMs);
        expect(angle).toBeGreaterThanOrEqual(profile.minRadians);
        expect(angle).toBeLessThanOrEqual(profile.maxRadians);
        expect(sampleMotionAngle(profile, 0)).toBe(profile.referenceRadians);
        expect(sampleMotion(profile, completeCycleMs(profile))).toEqual(
          sampleMotion(profile, 0),
        );
      }

      const staticLayer = directFirst.layers.find(
        ({ layerId }) => layerId === STATIC_LAYER_ID,
      );
      const background = directFirst.layers.find(
        ({ layerId }) => layerId === "reconstructed-background",
      );
      expect(staticLayer?.part).toBe(IDENTITY_MATRIX_2D);
      expect(background?.part).toBe(IDENTITY_MATRIX_2D);
      expect(directFirst.layers.every(({ depth }) => depth === IDENTITY_MATRIX_2D))
        .toBe(true);

      for (const field of MATRIX_FIELDS) {
        expect(Number.isFinite(directFirst.global[field])).toBe(true);
        expect(directFirst.layers.every(({ composed, part }) => (
          Number.isFinite(composed[field]) && Number.isFinite(part[field])
        ))).toBe(true);
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
