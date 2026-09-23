import { describe, expect, it, vi } from "vitest";
import { createCanonicalCoverTransform } from "@/lib/watch-2-5d/cover-transform";
import {
  FULL_ROTATION_RADIANS,
  IDENTITY_MATRIX_2D,
  INHERITED_GLOBAL_OUTWARD,
  INHERITED_GLOBAL_START,
  MotionSamplingError,
  applyMatrixToPoint,
  composeLayerTransform,
  easeInOutCubicBezier,
  inheritedGlobalSampleToMatrix,
  isIdentityMatrix,
  linkedGearAngularVelocityRatio,
  multiplyMatrix2D,
  sampleApprovedLayerMotion,
  sampleApprovedMotionSet,
  sampleInheritedGlobalMatrix,
  sampleInheritedGlobalTransform,
  sampleLinkedGearPair,
  sampleMotion,
  sampleMotionAngle,
  type ApprovedLinkedGearRelationship,
} from "@/lib/watch-2-5d/motion";
import type {
  ApprovalId,
  ContinuousRotationProfile,
  DiscreteRotationProfile,
  LayerId,
  MotionProfile,
  MotionProfileId,
  OscillationProfile,
  ReadonlyMatrix2D,
  ValidatedRuntimeManifest,
} from "@/lib/watch-2-5d/types";

const DRIVER_LAYER = "driver-gear" as LayerId;
const DRIVEN_LAYER = "driven-gear" as LayerId;
const STATIC_LAYER = "static-dial" as LayerId;
const APPROVAL = "approval-motion" as ApprovalId;

function motionId(value: string): MotionProfileId {
  return value as MotionProfileId;
}

function continuous(
  overrides: Partial<ContinuousRotationProfile> = {},
): ContinuousRotationProfile {
  return {
    approvalId: APPROVAL,
    direction: 1,
    evidence: "authored-assumption",
    id: motionId("motion-continuous"),
    kind: "continuous-rotation",
    layerId: DRIVER_LAYER,
    maxRadians: FULL_ROTATION_RADIANS,
    minRadians: -FULL_ROTATION_RADIANS,
    periodMs: 12_000,
    phaseRadians: 0,
    pivot: { x: 1_380.25, y: 752.5 },
    referenceRadians: 0,
    ...overrides,
  };
}

function discrete(
  overrides: Partial<DiscreteRotationProfile> = {},
): DiscreteRotationProfile {
  return {
    approvalId: APPROVAL,
    cadenceMs: 1_000,
    direction: 1,
    evidence: "visible-evidence",
    id: motionId("motion-discrete"),
    kind: "discrete-rotation",
    layerId: DRIVER_LAYER,
    maxRadians: FULL_ROTATION_RADIANS,
    minRadians: -FULL_ROTATION_RADIANS,
    phaseRadians: 0,
    pivot: { x: 400, y: 300 },
    referenceRadians: 0,
    stepRadians: Math.PI / 6,
    ...overrides,
  };
}

function oscillator(
  overrides: Partial<OscillationProfile> = {},
): OscillationProfile {
  return {
    amplitudeRadians: 0.4,
    approvalId: APPROVAL,
    direction: 1,
    evidence: "authored-assumption",
    id: motionId("motion-oscillator"),
    kind: "oscillation",
    layerId: DRIVER_LAYER,
    maxRadians: 0.4,
    minRadians: -0.4,
    periodMs: 1_000,
    phaseRadians: 0,
    pivot: { x: 250, y: 125 },
    referenceRadians: 0,
    ...overrides,
  };
}

function manifest(
  phase: "static-layered-reconstruction" | "approved-part-motion" | "optional-depth",
  motionProfiles: readonly MotionProfile[],
): ValidatedRuntimeManifest {
  return { phase, motionProfiles } as unknown as ValidatedRuntimeManifest;
}

function translation(x: number, y: number): ReadonlyMatrix2D {
  return Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
}

function scale(value: number): ReadonlyMatrix2D {
  return Object.freeze({ a: value, b: 0, c: 0, d: value, e: 0, f: 0 });
}

function expectMatrixClose(
  actual: ReadonlyMatrix2D,
  expected: ReadonlyMatrix2D,
  digits = 12,
): void {
  for (const field of ["a", "b", "c", "d", "e", "f"] as const) {
    expect(actual[field]).toBeCloseTo(expected[field], digits);
  }
}

// **Validates: Requirements 5.1–5.12, 6.1–6.18, 8.4, 13.8**
describe("pure approved watch motion", () => {
  it("samples continuous periods, directions, bounds, cycle normalization, and reference phase", () => {
    const reference = 0.25;
    const clockwise = continuous({
      phaseRadians: reference,
      referenceRadians: reference,
    });
    const counterclockwise = continuous({
      direction: -1,
      id: motionId("motion-counterclockwise"),
      phaseRadians: reference,
      referenceRadians: reference,
    });

    expect(sampleMotionAngle(clockwise, 0)).toBe(reference);
    expect(sampleMotionAngle(clockwise, clockwise.periodMs)).toBe(reference);
    expect(sampleMotionAngle(clockwise, clockwise.periodMs * 3)).toBe(reference);
    expect(sampleMotionAngle(clockwise, clockwise.periodMs / 4)).toBeCloseTo(
      reference + Math.PI / 2,
      12,
    );
    expect(sampleMotionAngle(counterclockwise, counterclockwise.periodMs / 4))
      .toBeCloseTo(reference - Math.PI / 2, 12);
    expect(sampleMotionAngle(clockwise, clockwise.periodMs * 7 + 3_000))
      .toBeCloseTo(sampleMotionAngle(clockwise, 3_000), 12);

    for (const elapsed of [0, 1_000, 3_000, 6_000, 9_000, 11_999.5, 12_000]) {
      const angle = sampleMotionAngle(clockwise, elapsed);
      expect(angle).toBeGreaterThanOrEqual(clockwise.minRadians);
      expect(angle).toBeLessThanOrEqual(clockwise.maxRadians);
    }
    expectMatrixClose(
      sampleMotion(clockwise, clockwise.periodMs),
      sampleMotion(clockwise, 0),
    );
  });

  it("holds discrete rotation until cadence boundaries and wraps complete stepped cycles", () => {
    const profile = discrete({ direction: -1 });

    expect(sampleMotionAngle(profile, 0)).toBe(0);
    expect(sampleMotionAngle(profile, 999.999)).toBe(0);
    expect(sampleMotionAngle(profile, 1_000)).toBeCloseTo(-Math.PI / 6, 12);
    expect(sampleMotionAngle(profile, 2_000)).toBeCloseTo(-Math.PI / 3, 12);
    expect(sampleMotionAngle(profile, 12_000)).toBe(0);
    expect(sampleMotionAngle(profile, 24_000)).toBe(0);
    expect(isIdentityMatrix(sampleMotion(profile, 12_000), 1e-12)).toBe(true);
  });

  it("keeps oscillation symmetric, bounded, zero-mean, directional, and continuous", () => {
    const positive = oscillator();
    const negative = oscillator({ direction: -1, id: motionId("motion-oscillator-reverse") });

    expect(sampleMotionAngle(positive, 0)).toBe(positive.referenceRadians);
    expect(sampleMotionAngle(positive, 250)).toBeCloseTo(positive.amplitudeRadians, 12);
    expect(sampleMotionAngle(positive, 500)).toBeCloseTo(0, 12);
    expect(sampleMotionAngle(positive, 750)).toBeCloseTo(-positive.amplitudeRadians, 12);
    expect(sampleMotionAngle(positive, 1_000)).toBe(positive.referenceRadians);
    expect(sampleMotionAngle(negative, 250)).toBeCloseTo(-positive.amplitudeRadians, 12);

    const cycleSamples = Array.from({ length: 16 }, (_, index) => (
      sampleMotionAngle(positive, index * positive.periodMs / 16)
    ));
    expect(cycleSamples.reduce((sum, angle) => sum + angle, 0) / cycleSamples.length)
      .toBeCloseTo(0, 12);
    expect(Math.min(...cycleSamples)).toBeGreaterThanOrEqual(positive.minRadians);
    expect(Math.max(...cycleSamples)).toBeLessThanOrEqual(positive.maxRadians);

    const beforeBoundary = sampleMotionAngle(positive, positive.periodMs - 0.001);
    const afterBoundary = sampleMotionAngle(positive, 0.001);
    expect(Math.abs(beforeBoundary - positive.referenceRadians)).toBeLessThan(0.000_01);
    expect(Math.abs(afterBoundary - positive.referenceRadians)).toBeLessThan(0.000_01);
  });

  it("uses only explicitly approved opposite linked-gear tooth ratios", () => {
    const driver = continuous({
      direction: 1,
      layerId: DRIVER_LAYER,
      periodMs: 12_000,
    });
    const driven = continuous({
      direction: -1,
      id: motionId("motion-driven"),
      layerId: DRIVEN_LAYER,
      periodMs: 24_000,
      pivot: { x: 800, y: 600 },
    });
    const relationship: ApprovedLinkedGearRelationship = {
      approvalId: APPROVAL,
      direction: "opposite",
      drivenLayerId: DRIVEN_LAYER,
      drivenToothCount: 20,
      driverLayerId: DRIVER_LAYER,
      driverToothCount: 10,
      evidence: "authored-assumption",
      id: "relationship-driver-driven",
    };

    expect(linkedGearAngularVelocityRatio(relationship)).toBe(-0.5);
    const pair = sampleLinkedGearPair({
      activeElapsedMs: 3_000,
      drivenProfile: driven,
      driverProfile: driver,
      relationship,
    });
    expect(pair.driverAngleRadians).toBeCloseTo(Math.PI / 2, 12);
    expect(pair.drivenAngleRadians).toBeCloseTo(-Math.PI / 4, 12);
    expect(
      pair.drivenAngleRadians / pair.driverAngleRadians,
    ).toBeCloseTo(pair.angularVelocityRatio, 12);

    expect(() => sampleLinkedGearPair({
      activeElapsedMs: 3_000,
      drivenProfile: { ...driven, direction: 1 },
      driverProfile: driver,
      relationship,
    })).toThrowError(MotionSamplingError);
    expect(() => linkedGearAngularVelocityRatio({
      ...relationship,
      approvalId: "" as ApprovalId,
    })).toThrowError(/approved positive integer tooth counts/u);
  });

  it("keeps a rotation pivot fixed and composes global → cover → depth → part", () => {
    const profile = continuous({ periodMs: 8_000 });
    const part = sampleMotion(profile, 2_000);
    const pivotAfterPart = applyMatrixToPoint(part, profile.pivot);
    expect(pivotAfterPart.x).toBeCloseTo(profile.pivot.x, 12);
    expect(pivotAfterPart.y).toBeCloseTo(profile.pivot.y, 12);

    const coverResult = createCanonicalCoverTransform({
      viewportHeight: 900,
      viewportWidth: 1_440,
    });
    expect(coverResult.ok).toBe(true);
    if (!coverResult.ok) throw new Error(coverResult.message);
    const global = sampleInheritedGlobalMatrix(4_000, 1_440, 900);
    const depth = translation(4, -3);
    const withPart = composeLayerTransform({
      cover: coverResult.value,
      depth,
      global,
      part,
    });
    const withoutPart = composeLayerTransform({
      cover: coverResult.value,
      depth,
      global,
      part: IDENTITY_MATRIX_2D,
    });
    const projectedWithPart = applyMatrixToPoint(withPart, profile.pivot);
    const projectedWithoutPart = applyMatrixToPoint(withoutPart, profile.pivot);
    expect(Math.abs(projectedWithPart.x - projectedWithoutPart.x)).toBeLessThan(1e-9);
    expect(Math.abs(projectedWithPart.y - projectedWithoutPart.y)).toBeLessThan(1e-9);

    const orderedDepth = translation(3, 4);
    const ordered = composeLayerTransform({
      cover: scale(2),
      depth: orderedDepth,
      global: translation(100, 200),
      part,
    });
    const point = { x: 2, y: 5 };
    const explicit = applyMatrixToPoint(
      translation(100, 200),
      applyMatrixToPoint(
        scale(2),
        applyMatrixToPoint(orderedDepth, applyMatrixToPoint(part, point)),
      ),
    );
    expect(applyMatrixToPoint(ordered, point)).toEqual(explicit);
  });

  it("reproduces the predecessor 28-second cubic-Bezier outward and return transform", () => {
    expect(easeInOutCubicBezier(0)).toBe(0);
    expect(easeInOutCubicBezier(0.25)).toBeCloseTo(0.129_161_931_047_3, 12);
    expect(easeInOutCubicBezier(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutCubicBezier(0.75)).toBeCloseTo(0.870_838_068_952_7, 12);
    expect(easeInOutCubicBezier(1)).toBe(1);

    const start = sampleInheritedGlobalTransform(0);
    const outwardMidpoint = sampleInheritedGlobalTransform(7_000);
    const outward = sampleInheritedGlobalTransform(14_000);
    const returnMidpoint = sampleInheritedGlobalTransform(21_000);
    const complete = sampleInheritedGlobalTransform(28_000);

    expect(start).toMatchObject({ ...INHERITED_GLOBAL_START, segment: "outward" });
    expect(outward).toMatchObject({ ...INHERITED_GLOBAL_OUTWARD, segment: "outward" });
    expect(outwardMidpoint).toMatchObject({
      scale: 1.08,
      translateXPercent: 0,
      translateYPercent: 0.125,
    });
    expect(returnMidpoint).toMatchObject({
      scale: 1.08,
      translateXPercent: 0,
      translateYPercent: 0.125,
    });
    expect(complete).toEqual(start);
    expect(sampleInheritedGlobalTransform(28_000 * 4 + 7_000)).toEqual(outwardMidpoint);

    const justBeforeCycle = sampleInheritedGlobalTransform(28_000 - 0.001);
    expect(Math.abs(justBeforeCycle.scale - start.scale)).toBeLessThan(1e-10);
    expect(Math.abs(justBeforeCycle.translateXPercent - start.translateXPercent))
      .toBeLessThan(1e-8);
    expect(Math.abs(justBeforeCycle.translateYPercent - start.translateYPercent))
      .toBeLessThan(1e-8);
  });

  it("uses center-origin global scaling and preserves the declared translation at the center", () => {
    const width = 1_440;
    const height = 900;
    const sample = sampleInheritedGlobalTransform(0);
    const matrix = inheritedGlobalSampleToMatrix(sample, width, height);
    const center = { x: width / 2, y: height / 2 };
    const transformed = applyMatrixToPoint(matrix, center);

    expect(transformed.x).toBeCloseTo(center.x + width * sample.translateXPercent / 100, 12);
    expect(transformed.y).toBeCloseTo(center.y + height * sample.translateYPercent / 100, 12);
    expectMatrixClose(matrix, sampleInheritedGlobalMatrix(0, width, height));
  });

  it("keeps static, unapproved, background, and empty-approved-set layers at Reference Pose", () => {
    const approved = continuous();
    const empty = manifest("approved-part-motion", []);
    const active = manifest("approved-part-motion", [approved]);
    const staticPhase = manifest("static-layered-reconstruction", [approved]);

    expect(sampleApprovedMotionSet(empty, 9_000)).toEqual({});
    expect(Object.isFrozen(sampleApprovedMotionSet(empty, 9_000))).toBe(true);
    expect(sampleApprovedLayerMotion(empty, STATIC_LAYER, 9_000)).toBe(IDENTITY_MATRIX_2D);
    expect(sampleApprovedLayerMotion(empty, "reconstructed-background", 9_000))
      .toBe(IDENTITY_MATRIX_2D);
    expect(sampleApprovedLayerMotion(active, STATIC_LAYER, 3_000)).toBe(IDENTITY_MATRIX_2D);
    expect(sampleApprovedLayerMotion(staticPhase, DRIVER_LAYER, 3_000))
      .toBe(IDENTITY_MATRIX_2D);
    expect(isIdentityMatrix(sampleApprovedLayerMotion(active, DRIVER_LAYER, 3_000)))
      .toBe(false);
    expect(Object.keys(sampleApprovedMotionSet(active, 3_000))).toEqual([DRIVER_LAYER]);
  });

  it("is repeatable for equal manifest/time inputs without ambient time or random input", () => {
    const profile = continuous();
    const active = manifest("approved-part-motion", [profile]);
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("wall clock must not be read");
    });
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("random input must not be read");
    });

    const first = sampleApprovedMotionSet(active, 4_321.5);
    const second = sampleApprovedMotionSet(active, 4_321.5);
    expect(second).toEqual(first);
    expect(multiplyMatrix2D(IDENTITY_MATRIX_2D, first[DRIVER_LAYER]))
      .toEqual(first[DRIVER_LAYER]);
  });

  it("fails closed for invalid elapsed time, bounds, and reference phases", () => {
    expect(() => sampleMotion(continuous(), Number.NaN)).toThrowError(
      /Active Elapsed Time must be finite/u,
    );
    expect(() => sampleMotion(continuous(), -1)).toThrowError(
      /must be nonnegative/u,
    );
    expect(() => sampleMotion(continuous({ maxRadians: 1, minRadians: -1 }), 0))
      .toThrowError(/one complete rotation/u);
    expect(() => sampleMotion(continuous({ phaseRadians: 0.5 }), 0))
      .toThrowError(/reference angle/u);
    expect(() => sampleMotion(oscillator({ phaseRadians: Math.PI / 2 }), 0))
      .toThrowError(/reference angle/u);
  });
});
