import fc from "fast-check";
import { expect, it } from "vitest";
import {
  FULL_ROTATION_RADIANS,
  linkedGearAngularVelocityRatio,
  sampleLinkedGearPair,
  sampleMotion,
  sampleMotionAngle,
  type ApprovedLinkedGearRelationship,
} from "@/lib/watch-2-5d/motion";
import type {
  ApprovalId,
  ContinuousRotationProfile,
  Direction,
  DiscreteRotationProfile,
  LayerId,
  MotionProfile,
  MotionProfileId,
  OscillationProfile,
  ReadonlyMatrix2D,
  SourcePoint,
} from "@/lib/watch-2-5d/types";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 7: Kinematic profile bounds, ratios, pivots, and continuity";

// Reproduce with: seed=20260609, numRuns=128.
const PROPERTY_SEED = 20_260_609;
const PROPERTY_RUNS = 128;
const PIVOT_TOLERANCE_CSS_PIXELS = 0.5;
const ORACLE_ANGLE_TOLERANCE_RADIANS = 4e-6;
const CYCLE_EDGE_FRACTION = 1e-6;
const ZERO_MEAN_SAMPLE_COUNT = 64;
const APPROVAL_ID = "approval-property-07" as ApprovalId;

function layerId(value: string): LayerId {
  return value as LayerId;
}

function motionProfileId(value: string): MotionProfileId {
  return value as MotionProfileId;
}

function rotationBounds(
  referenceRadians: number,
  direction: Direction,
): Readonly<{ maxRadians: number; minRadians: number }> {
  return direction === 1
    ? { maxRadians: referenceRadians + FULL_ROTATION_RADIANS, minRadians: referenceRadians }
    : { maxRadians: referenceRadians, minRadians: referenceRadians - FULL_ROTATION_RADIANS };
}

function continuousProfile(
  id: string,
  layer: LayerId,
  periodMs: number,
  direction: Direction,
  referenceRadians: number,
  pivot: SourcePoint,
): ContinuousRotationProfile {
  return {
    approvalId: APPROVAL_ID,
    direction,
    evidence: "authored-assumption",
    id: motionProfileId(id),
    kind: "continuous-rotation",
    layerId: layer,
    periodMs,
    phaseRadians: referenceRadians,
    pivot,
    referenceRadians,
    ...rotationBounds(referenceRadians, direction),
  };
}

function discreteProfile(
  cadenceMs: number,
  direction: Direction,
  referenceRadians: number,
  pivot: SourcePoint,
  stepsPerCycle: number,
): DiscreteRotationProfile {
  return {
    approvalId: APPROVAL_ID,
    cadenceMs,
    direction,
    evidence: "visible-evidence",
    id: motionProfileId("property-07-discrete-hand"),
    kind: "discrete-rotation",
    layerId: layerId("property-07-discrete-hand-layer"),
    phaseRadians: referenceRadians,
    pivot,
    referenceRadians,
    stepRadians: FULL_ROTATION_RADIANS / stepsPerCycle,
    ...rotationBounds(referenceRadians, direction),
  };
}

function oscillatorProfile(
  amplitudeRadians: number,
  direction: Direction,
  periodMs: number,
  phaseRadians: number,
  pivot: SourcePoint,
): OscillationProfile {
  return {
    amplitudeRadians,
    approvalId: APPROVAL_ID,
    direction,
    evidence: "authored-assumption",
    id: motionProfileId("property-07-oscillator"),
    kind: "oscillation",
    layerId: layerId("property-07-oscillator-layer"),
    maxRadians: amplitudeRadians,
    minRadians: -amplitudeRadians,
    periodMs,
    phaseRadians,
    pivot,
    referenceRadians: amplitudeRadians * Math.sin(phaseRadians),
  };
}

function cycleFractionOracle(activeElapsedMs: number, periodMs: number): number {
  const cycles = activeElapsedMs / periodMs;
  return cycles - Math.floor(cycles);
}

function continuousAngleOracle(
  profile: ContinuousRotationProfile,
  activeElapsedMs: number,
): number {
  return profile.referenceRadians
    + profile.direction
      * FULL_ROTATION_RADIANS
      * cycleFractionOracle(activeElapsedMs, profile.periodMs);
}

function discreteAngleOracle(
  profile: DiscreteRotationProfile,
  activeElapsedMs: number,
  stepsPerCycle: number,
): number {
  const completedSteps = Math.floor(activeElapsedMs / profile.cadenceMs);
  const cycleStep = completedSteps % stepsPerCycle;
  return profile.referenceRadians
    + profile.direction * FULL_ROTATION_RADIANS * cycleStep / stepsPerCycle;
}

function oscillatorAngleOracle(
  profile: OscillationProfile,
  activeElapsedMs: number,
): number {
  const phase = profile.phaseRadians
    + profile.direction
      * FULL_ROTATION_RADIANS
      * cycleFractionOracle(activeElapsedMs, profile.periodMs);
  return profile.amplitudeRadians * Math.sin(phase);
}

function circularAngleError(actual: number, expected: number): number {
  const delta = actual - expected;
  return Math.abs(delta - Math.round(delta / FULL_ROTATION_RADIANS)
    * FULL_ROTATION_RADIANS);
}

function expectCircularAngleClose(
  actual: number,
  expected: number,
  tolerance = ORACLE_ANGLE_TOLERANCE_RADIANS,
): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(circularAngleError(actual, expected)).toBeLessThanOrEqual(tolerance);
}

function expectScalarClose(
  actual: number,
  expected: number,
  tolerance = ORACLE_ANGLE_TOLERANCE_RADIANS,
): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectWithinDeclaredBounds(profile: MotionProfile, angleRadians: number): void {
  expect(Number.isFinite(angleRadians)).toBe(true);
  expect(angleRadians).toBeGreaterThanOrEqual(profile.minRadians);
  expect(angleRadians).toBeLessThanOrEqual(profile.maxRadians);
}

function applyAffineOracle(
  matrix: ReadonlyMatrix2D,
  point: SourcePoint,
): Readonly<SourcePoint> {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function expectProjectedPivotStable(
  profile: MotionProfile,
  activeElapsedMs: number,
  projectionScale: number,
): void {
  const transformedPivot = applyAffineOracle(
    sampleMotion(profile, activeElapsedMs),
    profile.pivot,
  );
  const projectedApprovedPivot = {
    x: profile.pivot.x * projectionScale,
    y: profile.pivot.y * projectionScale,
  };
  const projectedTransformedPivot = {
    x: transformedPivot.x * projectionScale,
    y: transformedPivot.y * projectionScale,
  };
  const maximumAxisDrift = Math.max(
    Math.abs(projectedTransformedPivot.x - projectedApprovedPivot.x),
    Math.abs(projectedTransformedPivot.y - projectedApprovedPivot.y),
  );

  expect(Number.isFinite(maximumAxisDrift)).toBe(true);
  expect(maximumAxisDrift).toBeLessThanOrEqual(PIVOT_TOLERANCE_CSS_PIXELS);
}

function expectMatricesClose(
  actual: ReadonlyMatrix2D,
  expected: ReadonlyMatrix2D,
  tolerance = 1e-6,
): void {
  for (const field of ["a", "b", "c", "d", "e", "f"] as const) {
    expect(Math.abs(actual[field] - expected[field])).toBeLessThanOrEqual(tolerance);
  }
}

function expectContinuousProfileInvariant(
  profile: ContinuousRotationProfile,
  activeElapsedMs: number,
  cycleIndex: number,
  cycleFractionNumerator: number,
  projectionScale: number,
): void {
  const sampled = sampleMotionAngle(profile, activeElapsedMs);
  expectWithinDeclaredBounds(profile, sampled);
  expectCircularAngleClose(sampled, continuousAngleOracle(profile, activeElapsedMs));
  expectProjectedPivotStable(profile, activeElapsedMs, projectionScale);

  const cycleBase = profile.periodMs
    * (cycleIndex + cycleFractionNumerator / 1_024);
  const repeated = cycleBase + profile.periodMs;
  const baseAngle = sampleMotionAngle(profile, cycleBase);
  const repeatedAngle = sampleMotionAngle(profile, repeated);
  expectWithinDeclaredBounds(profile, baseAngle);
  expectWithinDeclaredBounds(profile, repeatedAngle);
  expectCircularAngleClose(baseAngle, continuousAngleOracle(profile, cycleBase));
  expectCircularAngleClose(repeatedAngle, continuousAngleOracle(profile, repeated));
  expectCircularAngleClose(repeatedAngle, baseAngle);
  expectMatricesClose(sampleMotion(profile, profile.periodMs), sampleMotion(profile, 0));

  const edgeDelta = profile.periodMs * CYCLE_EDGE_FRACTION;
  const beforeBoundary = sampleMotionAngle(profile, profile.periodMs - edgeDelta);
  const afterBoundary = sampleMotionAngle(profile, profile.periodMs + edgeDelta);
  expectCircularAngleClose(
    beforeBoundary,
    continuousAngleOracle(profile, profile.periodMs - edgeDelta),
  );
  expectCircularAngleClose(
    afterBoundary,
    continuousAngleOracle(profile, profile.periodMs + edgeDelta),
  );
  expect(circularAngleError(beforeBoundary, afterBoundary)).toBeLessThanOrEqual(
    2 * FULL_ROTATION_RADIANS * CYCLE_EDGE_FRACTION
      + ORACLE_ANGLE_TOLERANCE_RADIANS,
  );
}

function expectDiscreteProfileInvariant(
  profile: DiscreteRotationProfile,
  stepsPerCycle: number,
  activeElapsedMs: number,
  cycleIndex: number,
  stepOffsetSeed: number,
  intraCadenceEighths: number,
  projectionScale: number,
): void {
  const sampled = sampleMotionAngle(profile, activeElapsedMs);
  expectWithinDeclaredBounds(profile, sampled);
  expectCircularAngleClose(
    sampled,
    discreteAngleOracle(profile, activeElapsedMs, stepsPerCycle),
  );
  expectProjectedPivotStable(profile, activeElapsedMs, projectionScale);

  const cyclePeriodMs = profile.cadenceMs * stepsPerCycle;
  const stepOffset = stepOffsetSeed % stepsPerCycle;
  const cycleBase = profile.cadenceMs
    * (cycleIndex * stepsPerCycle + stepOffset + intraCadenceEighths / 8);
  const repeated = cycleBase + cyclePeriodMs;
  const baseAngle = sampleMotionAngle(profile, cycleBase);
  const repeatedAngle = sampleMotionAngle(profile, repeated);
  expectWithinDeclaredBounds(profile, baseAngle);
  expectWithinDeclaredBounds(profile, repeatedAngle);
  expectCircularAngleClose(
    baseAngle,
    discreteAngleOracle(profile, cycleBase, stepsPerCycle),
  );
  expectCircularAngleClose(
    repeatedAngle,
    discreteAngleOracle(profile, repeated, stepsPerCycle),
  );
  expectCircularAngleClose(repeatedAngle, baseAngle);
  expectMatricesClose(sampleMotion(profile, cyclePeriodMs), sampleMotion(profile, 0));

  const cadenceStart = profile.cadenceMs
    * (cycleIndex * stepsPerCycle + stepOffset);
  const cadenceEnd = cadenceStart + profile.cadenceMs * (1 - CYCLE_EDGE_FRACTION);
  expectCircularAngleClose(
    sampleMotionAngle(profile, cadenceEnd),
    sampleMotionAngle(profile, cadenceStart),
  );
}

function expectOscillatorInvariant(
  profile: OscillationProfile,
  activeElapsedMs: number,
  cycleIndex: number,
  cycleFractionNumerator: number,
  projectionScale: number,
): void {
  const sampled = sampleMotionAngle(profile, activeElapsedMs);
  const oscillatorTolerance = ORACLE_ANGLE_TOLERANCE_RADIANS
    * Math.max(1, profile.amplitudeRadians);
  expectWithinDeclaredBounds(profile, sampled);
  expectScalarClose(
    sampled,
    oscillatorAngleOracle(profile, activeElapsedMs),
    oscillatorTolerance,
  );
  expectProjectedPivotStable(profile, activeElapsedMs, projectionScale);

  const cycleBase = profile.periodMs
    * (cycleIndex + cycleFractionNumerator / 1_024);
  const repeated = cycleBase + profile.periodMs;
  const baseAngle = sampleMotionAngle(profile, cycleBase);
  const repeatedAngle = sampleMotionAngle(profile, repeated);
  expectWithinDeclaredBounds(profile, baseAngle);
  expectWithinDeclaredBounds(profile, repeatedAngle);
  expectScalarClose(baseAngle, oscillatorAngleOracle(profile, cycleBase), oscillatorTolerance);
  expectScalarClose(
    repeatedAngle,
    oscillatorAngleOracle(profile, repeated),
    oscillatorTolerance,
  );
  expectScalarClose(repeatedAngle, baseAngle, oscillatorTolerance);
  expectMatricesClose(sampleMotion(profile, profile.periodMs), sampleMotion(profile, 0));

  const edgeDelta = profile.periodMs * CYCLE_EDGE_FRACTION;
  const beforeBoundary = sampleMotionAngle(profile, profile.periodMs - edgeDelta);
  const afterBoundary = sampleMotionAngle(profile, profile.periodMs + edgeDelta);
  expectScalarClose(
    beforeBoundary,
    oscillatorAngleOracle(profile, profile.periodMs - edgeDelta),
    oscillatorTolerance,
  );
  expectScalarClose(
    afterBoundary,
    oscillatorAngleOracle(profile, profile.periodMs + edgeDelta),
    oscillatorTolerance,
  );
  expect(Math.abs(beforeBoundary - afterBoundary)).toBeLessThanOrEqual(
    2
      * FULL_ROTATION_RADIANS
      * profile.amplitudeRadians
      * CYCLE_EDGE_FRACTION
      + oscillatorTolerance,
  );

  let sampledCycleSum = 0;
  let oracleCycleSum = 0;
  for (let index = 0; index < ZERO_MEAN_SAMPLE_COUNT; index += 1) {
    const elapsed = index * profile.periodMs / ZERO_MEAN_SAMPLE_COUNT;
    const cycleSample = sampleMotionAngle(profile, elapsed);
    const oracleSample = oscillatorAngleOracle(profile, elapsed);
    expectWithinDeclaredBounds(profile, cycleSample);
    expectScalarClose(cycleSample, oracleSample, oscillatorTolerance);
    sampledCycleSum += cycleSample;
    oracleCycleSum += oracleSample;
  }
  const scale = Math.max(1, profile.amplitudeRadians);
  expect(Math.abs(oracleCycleSum / ZERO_MEAN_SAMPLE_COUNT))
    .toBeLessThanOrEqual(1e-12 * scale);
  expect(Math.abs(sampledCycleSum / ZERO_MEAN_SAMPLE_COUNT))
    .toBeLessThanOrEqual(1e-10 * scale);
}

function expectRelativeClose(actual: number, expected: number, tolerance = 1e-10): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    tolerance * Math.max(1, Math.abs(actual), Math.abs(expected)),
  );
}

const periodArbitrary = fc.oneof(
  fc.constantFrom(1, 2, 1_000, 1_000_000),
  fc.integer({ min: 1, max: 1_000_000 }),
);
const cadenceArbitrary = fc.oneof(
  fc.constantFrom(1, 2, 1_000, 100_000),
  fc.integer({ min: 1, max: 100_000 }),
);
const handSecondPeriodArbitrary = fc.oneof(
  fc.constantFrom(1, 1_000, 100_000),
  fc.integer({ min: 1, max: 100_000 }),
);
const gearDriverPeriodArbitrary = fc.oneof(
  fc.constantFrom(1_000, 60_000, 1_000_000),
  fc.integer({ min: 1_000, max: 1_000_000 }),
);
const toothCountArbitrary = fc.oneof(
  fc.constantFrom(1, 2, 255, 256),
  fc.integer({ min: 1, max: 256 }),
);
const stepsPerCycleArbitrary = fc.oneof(
  fc.constantFrom(1, 2, 4, 60, 360),
  fc.integer({ min: 1, max: 360 }),
);
const directionArbitrary = fc.constantFrom(-1 as const, 1 as const);
const phaseArbitrary = fc.oneof(
  fc.constantFrom(
    -2 * FULL_ROTATION_RADIANS,
    -Math.PI / 2,
    0,
    Math.PI / 2,
    2 * FULL_ROTATION_RADIANS,
  ),
  fc.integer({ min: -8_192, max: 8_192 })
    .map((value) => value * Math.PI / 1_024),
);
const amplitudeArbitrary = fc.oneof(
  fc.constantFrom(0.000_001, 0.25, 1, 2),
  fc.integer({ min: 1, max: 2_000_000 }).map((value) => value / 1_000_000),
);
const activeElapsedArbitrary = fc.record({
  quarter: fc.integer({ min: 0, max: 3 }),
  whole: fc.integer({ min: 0, max: 1_000_000_000 }),
}).map(({ quarter, whole }) => whole + quarter / 4);

function canonicalCoordinateArbitrary(maximum: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constant(0),
    fc.constant(maximum),
    fc.integer({ min: 0, max: maximum * 4 }).map((value) => value / 4),
  );
}

const pivotArbitrary = fc.record({
  x: canonicalCoordinateArbitrary(2_760),
  y: canonicalCoordinateArbitrary(1_504),
});
const projectionScaleArbitrary = fc.oneof(
  fc.constantFrom(0.001, 0.5, 1, 8),
  fc.integer({ min: 1, max: 8_000 }).map((value) => value / 1_000),
);

const generatedCaseArbitrary = fc.record({
  activeElapsedMs: activeElapsedArbitrary,
  cadenceMs: cadenceArbitrary,
  continuousPeriodMs: periodArbitrary,
  cycleFractionNumerator: fc.integer({ min: 0, max: 1_023 }),
  cycleIndex: fc.integer({ min: 0, max: 32 }),
  direction: directionArbitrary,
  discreteStepOffsetSeed: fc.integer({ min: 0, max: 10_000 }),
  gearDirection: directionArbitrary,
  gearDrivenPivot: pivotArbitrary,
  gearDrivenToothCount: toothCountArbitrary,
  gearDriverPeriodMs: gearDriverPeriodArbitrary,
  gearDriverPivot: pivotArbitrary,
  gearDriverToothCount: toothCountArbitrary,
  handPivot: pivotArbitrary,
  handSecondPeriodMs: handSecondPeriodArbitrary,
  intraCadenceEighths: fc.integer({ min: 0, max: 7 }),
  oscillatorAmplitudeRadians: amplitudeArbitrary,
  oscillatorDirection: directionArbitrary,
  oscillatorPeriodMs: periodArbitrary,
  oscillatorPhaseRadians: phaseArbitrary,
  oscillatorPivot: pivotArbitrary,
  projectionScale: projectionScaleArbitrary,
  rotationPhaseRadians: phaseArbitrary,
  rotationPivot: pivotArbitrary,
  stepsPerCycle: stepsPerCycleArbitrary,
});

// **Validates: Requirements 6.1, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11**
it(PROPERTY_TAG, { timeout: 60_000 }, () => {
  fc.assert(
    fc.property(generatedCaseArbitrary, (generated) => {
      const continuousHand = continuousProfile(
        "property-07-continuous-hand",
        layerId("property-07-continuous-hand-layer"),
        generated.continuousPeriodMs,
        generated.direction,
        generated.rotationPhaseRadians,
        generated.rotationPivot,
      );
      const discreteHand = discreteProfile(
        generated.cadenceMs,
        generated.direction,
        generated.rotationPhaseRadians,
        generated.rotationPivot,
        generated.stepsPerCycle,
      );
      const oscillator = oscillatorProfile(
        generated.oscillatorAmplitudeRadians,
        generated.oscillatorDirection,
        generated.oscillatorPeriodMs,
        generated.oscillatorPhaseRadians,
        generated.oscillatorPivot,
      );

      const secondHand = continuousProfile(
        "property-07-second-hand",
        layerId("property-07-second-hand-layer"),
        generated.handSecondPeriodMs,
        generated.direction,
        generated.rotationPhaseRadians,
        generated.handPivot,
      );
      const minuteHand = continuousProfile(
        "property-07-minute-hand",
        layerId("property-07-minute-hand-layer"),
        generated.handSecondPeriodMs * 60,
        generated.direction,
        generated.rotationPhaseRadians,
        generated.handPivot,
      );
      const hourHand = continuousProfile(
        "property-07-hour-hand",
        layerId("property-07-hour-hand-layer"),
        generated.handSecondPeriodMs * 60 * 12,
        generated.direction,
        generated.rotationPhaseRadians,
        generated.handPivot,
      );

      const drivenGearPeriodMs = generated.gearDriverPeriodMs
        * generated.gearDrivenToothCount
        / generated.gearDriverToothCount;
      const driverGear = continuousProfile(
        "property-07-driver-gear",
        layerId("property-07-driver-gear-layer"),
        generated.gearDriverPeriodMs,
        generated.gearDirection,
        generated.rotationPhaseRadians,
        generated.gearDriverPivot,
      );
      const drivenGear = continuousProfile(
        "property-07-driven-gear",
        layerId("property-07-driven-gear-layer"),
        drivenGearPeriodMs,
        generated.gearDirection === 1 ? -1 : 1,
        generated.rotationPhaseRadians,
        generated.gearDrivenPivot,
      );
      const relationship: ApprovedLinkedGearRelationship = {
        approvalId: APPROVAL_ID,
        direction: "opposite",
        drivenLayerId: drivenGear.layerId,
        drivenToothCount: generated.gearDrivenToothCount,
        driverLayerId: driverGear.layerId,
        driverToothCount: generated.gearDriverToothCount,
        evidence: "authored-assumption",
        id: "property-07-linked-gears",
      };

      const continuousProfiles = [
        continuousHand,
        secondHand,
        minuteHand,
        hourHand,
        driverGear,
        drivenGear,
      ] as const;
      for (const profile of continuousProfiles) {
        expectContinuousProfileInvariant(
          profile,
          generated.activeElapsedMs,
          generated.cycleIndex,
          generated.cycleFractionNumerator,
          generated.projectionScale,
        );
      }
      expectDiscreteProfileInvariant(
        discreteHand,
        generated.stepsPerCycle,
        generated.activeElapsedMs,
        generated.cycleIndex,
        generated.discreteStepOffsetSeed,
        generated.intraCadenceEighths,
        generated.projectionScale,
      );
      expectOscillatorInvariant(
        oscillator,
        generated.activeElapsedMs,
        generated.cycleIndex,
        generated.cycleFractionNumerator,
        generated.projectionScale,
      );

      expect(continuousHand.kind).toBe("continuous-rotation");
      expect(discreteHand.kind).toBe("discrete-rotation");
      expect(discreteHand.cadenceMs).toBe(generated.cadenceMs);
      expect(hourHand.periodMs / minuteHand.periodMs).toBe(12);
      expect(minuteHand.periodMs / secondHand.periodMs).toBe(60);

      const handRatioElapsed = secondHand.periodMs / 8;
      const secondDelta = sampleMotionAngle(secondHand, handRatioElapsed)
        - secondHand.referenceRadians;
      const minuteDelta = sampleMotionAngle(minuteHand, handRatioElapsed)
        - minuteHand.referenceRadians;
      const hourDelta = sampleMotionAngle(hourHand, handRatioElapsed)
        - hourHand.referenceRadians;
      expectRelativeClose(minuteDelta / secondDelta, 1 / 60);
      expectRelativeClose(hourDelta / minuteDelta, 1 / 12);
      expectRelativeClose(
        generated.direction * FULL_ROTATION_RADIANS / minuteHand.periodMs
          / (generated.direction * FULL_ROTATION_RADIANS / secondHand.periodMs),
        1 / 60,
      );
      expectRelativeClose(
        generated.direction * FULL_ROTATION_RADIANS / hourHand.periodMs
          / (generated.direction * FULL_ROTATION_RADIANS / minuteHand.periodMs),
        1 / 12,
      );

      const expectedGearRatio = -generated.gearDriverToothCount
        / generated.gearDrivenToothCount;
      expectRelativeClose(
        linkedGearAngularVelocityRatio(relationship),
        expectedGearRatio,
      );
      expectRelativeClose(
        (drivenGear.direction * FULL_ROTATION_RADIANS / drivenGear.periodMs)
          / (driverGear.direction * FULL_ROTATION_RADIANS / driverGear.periodMs),
        expectedGearRatio,
      );

      const arbitraryPair = sampleLinkedGearPair({
        activeElapsedMs: generated.activeElapsedMs,
        drivenProfile: drivenGear,
        driverProfile: driverGear,
        relationship,
      });
      expectCircularAngleClose(
        arbitraryPair.driverAngleRadians,
        continuousAngleOracle(driverGear, generated.activeElapsedMs),
      );
      expectCircularAngleClose(
        arbitraryPair.drivenAngleRadians,
        continuousAngleOracle(drivenGear, generated.activeElapsedMs),
      );
      expectRelativeClose(arbitraryPair.angularVelocityRatio, expectedGearRatio);

      const gearRatioElapsed = Math.min(driverGear.periodMs, drivenGear.periodMs) / 8;
      const ratioPair = sampleLinkedGearPair({
        activeElapsedMs: gearRatioElapsed,
        drivenProfile: drivenGear,
        driverProfile: driverGear,
        relationship,
      });
      const driverDelta = ratioPair.driverAngleRadians - driverGear.referenceRadians;
      const drivenDelta = ratioPair.drivenAngleRadians - drivenGear.referenceRadians;
      expect(Math.sign(driverDelta)).toBe(driverGear.direction);
      expect(Math.sign(drivenDelta)).toBe(drivenGear.direction);
      expectRelativeClose(drivenDelta / driverDelta, expectedGearRatio);
      expectProjectedPivotStable(driverGear, gearRatioElapsed, generated.projectionScale);
      expectProjectedPivotStable(drivenGear, gearRatioElapsed, generated.projectionScale);
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
