import type { CanonicalCoverTransform } from "./cover-transform";
import {
  assertNever,
  type ApprovalId,
  type ContinuousRotationProfile,
  type LayerId,
  type MotionEvidence,
  type MotionProfile,
  type ReadonlyMatrix2D,
  type SourcePoint,
  type ValidatedRuntimeManifest,
} from "./types";

export const FULL_ROTATION_RADIANS = Math.PI * 2;
export const INHERITED_GLOBAL_PERIOD_MS = 28_000 as const;
export const INHERITED_GLOBAL_SEGMENT_MS = 14_000 as const;

export const INHERITED_GLOBAL_EASING = Object.freeze({
  x1: 0.42,
  x2: 0.58,
  y1: 0,
  y2: 1,
} as const);

export const INHERITED_GLOBAL_START = Object.freeze({
  scale: 1.06,
  translateXPercent: -1.25,
  translateYPercent: -0.5,
} as const);

export const INHERITED_GLOBAL_OUTWARD = Object.freeze({
  scale: 1.1,
  translateXPercent: 1.25,
  translateYPercent: 0.75,
} as const);

export const IDENTITY_MATRIX_2D: ReadonlyMatrix2D = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});
export const IDENTITY_MATRIX = IDENTITY_MATRIX_2D;

const NUMERIC_EPSILON = 1e-10;
const EMPTY_MOTION_SET = Object.freeze({}) as Readonly<Record<string, ReadonlyMatrix2D>>;

export const MOTION_SAMPLING_FAILURE_CODES = [
  "active-elapsed-invalid",
  "motion-profile-invalid",
  "reference-phase-invalid",
  "relationship-invalid",
  "matrix-invalid",
] as const;
export type MotionSamplingFailureCode = (typeof MOTION_SAMPLING_FAILURE_CODES)[number];

export class MotionSamplingError extends RangeError {
  readonly code: MotionSamplingFailureCode;

  constructor(code: MotionSamplingFailureCode, message: string) {
    super(message);
    this.name = "MotionSamplingError";
    this.code = code;
  }
}

export interface InheritedGlobalTransformSample {
  readonly cycleProgress: number;
  readonly easedSegmentProgress: number;
  readonly scale: number;
  readonly segment: "outward" | "return";
  readonly segmentProgress: number;
  readonly translateXPercent: number;
  readonly translateYPercent: number;
}

/** The exact approved, hash-bound relationship shape used by the local package gate. */
export interface ApprovedLinkedGearRelationship {
  readonly id: string;
  readonly driverLayerId: LayerId;
  readonly drivenLayerId: LayerId;
  readonly driverToothCount: number;
  readonly drivenToothCount: number;
  readonly direction: "opposite";
  readonly evidence: MotionEvidence;
  readonly approvalId: ApprovalId;
}

export interface LinkedGearSamplingInput {
  readonly activeElapsedMs: number;
  readonly driverProfile: ContinuousRotationProfile;
  readonly drivenProfile: ContinuousRotationProfile;
  readonly relationship: ApprovedLinkedGearRelationship;
}

export interface LinkedGearMotionSample {
  readonly angularVelocityRatio: number;
  readonly driven: ReadonlyMatrix2D;
  readonly drivenAngleRadians: number;
  readonly driver: ReadonlyMatrix2D;
  readonly driverAngleRadians: number;
}

export type RuntimeMotionLayerId = LayerId | "reconstructed-background";

export interface ApprovedTransformCompositionInput {
  readonly global: ReadonlyMatrix2D;
  readonly cover: CanonicalCoverTransform | ReadonlyMatrix2D;
  readonly depth?: ReadonlyMatrix2D;
  readonly part?: ReadonlyMatrix2D;
}

function samplingError(code: MotionSamplingFailureCode, message: string): never {
  throw new MotionSamplingError(code, message);
}

function finiteNumber(
  value: number,
  name: string,
  code: MotionSamplingFailureCode = "motion-profile-invalid",
): number {
  if (!Number.isFinite(value)) {
    return samplingError(code, `${name} must be finite.`);
  }
  return value;
}

function positiveFinite(
  value: number,
  name: string,
  code: MotionSamplingFailureCode = "motion-profile-invalid",
): number {
  const result = finiteNumber(value, name, code);
  if (result <= 0) {
    return samplingError(code, `${name} must be positive.`);
  }
  return result;
}

function activeElapsed(value: number): number {
  const result = finiteNumber(value, "Active Elapsed Time", "active-elapsed-invalid");
  if (result < 0) {
    return samplingError(
      "active-elapsed-invalid",
      "Active Elapsed Time must be nonnegative.",
    );
  }
  return result;
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function positiveModulo(value: number, modulus: number): number {
  const remainder = value % modulus;
  return cleanZero(remainder < 0 ? remainder + modulus : remainder);
}

function approximatelyEqual(left: number, right: number, epsilon = NUMERIC_EPSILON): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= epsilon * scale;
}

function assertMatrix(matrix: ReadonlyMatrix2D, name: string): ReadonlyMatrix2D {
  for (const field of ["a", "b", "c", "d", "e", "f"] as const) {
    finiteNumber(matrix[field], `${name}.${field}`, "matrix-invalid");
  }
  return matrix;
}

function freezeMatrix(matrix: ReadonlyMatrix2D): ReadonlyMatrix2D {
  assertMatrix(matrix, "matrix");
  return Object.freeze({
    a: cleanZero(matrix.a),
    b: cleanZero(matrix.b),
    c: cleanZero(matrix.c),
    d: cleanZero(matrix.d),
    e: cleanZero(matrix.e),
    f: cleanZero(matrix.f),
  });
}

/** Returns elapsed milliseconds in the half-open interval [0, periodMs). */
export function normalizeCycle(activeElapsedMs: number, periodMs: number): number {
  return positiveModulo(
    activeElapsed(activeElapsedMs),
    positiveFinite(periodMs, "periodMs"),
  );
}

/** Returns normalized cycle progress in the half-open interval [0, 1). */
export function normalizeCycleProgress(activeElapsedMs: number, periodMs: number): number {
  const period = positiveFinite(periodMs, "periodMs");
  return normalizeCycle(activeElapsedMs, period) / period;
}

/** Returns the rotation-equivalent angle in [-π, π). */
export function normalizeSignedRadians(angleRadians: number): number {
  const angle = finiteNumber(angleRadians, "angleRadians");
  const normalized = positiveModulo(angle + Math.PI, FULL_ROTATION_RADIANS) - Math.PI;
  return cleanZero(normalized);
}

function anglesEquivalent(left: number, right: number): boolean {
  return Math.abs(normalizeSignedRadians(left - right)) <= NUMERIC_EPSILON;
}

function equivalentAngleWithinBounds(
  angleRadians: number,
  minRadians: number,
  maxRadians: number,
): number {
  const angle = finiteNumber(angleRadians, "angleRadians");
  const minimum = finiteNumber(minRadians, "minRadians");
  const maximum = finiteNumber(maxRadians, "maxRadians");
  if (minimum > maximum) {
    return samplingError("motion-profile-invalid", "Motion bounds are reversed.");
  }

  if (angle >= minimum - NUMERIC_EPSILON && angle <= maximum + NUMERIC_EPSILON) {
    return Math.min(maximum, Math.max(minimum, angle));
  }

  const minimumTurn = Math.ceil(
    (minimum - angle - NUMERIC_EPSILON) / FULL_ROTATION_RADIANS,
  );
  const maximumTurn = Math.floor(
    (maximum - angle + NUMERIC_EPSILON) / FULL_ROTATION_RADIANS,
  );
  if (minimumTurn > maximumTurn) {
    return samplingError(
      "motion-profile-invalid",
      "Motion bounds cannot contain a rotation-equivalent sampled angle.",
    );
  }

  const turn = minimumTurn > 0 ? minimumTurn : maximumTurn < 0 ? maximumTurn : 0;
  const normalized = angle + turn * FULL_ROTATION_RADIANS;
  return Math.min(maximum, Math.max(minimum, cleanZero(normalized)));
}

function validateCommonMotionProfile(profile: MotionProfile): void {
  for (const [name, value] of [
    ["phaseRadians", profile.phaseRadians],
    ["minRadians", profile.minRadians],
    ["maxRadians", profile.maxRadians],
    ["referenceRadians", profile.referenceRadians],
    ["pivot.x", profile.pivot.x],
    ["pivot.y", profile.pivot.y],
  ] as const) {
    finiteNumber(value, name);
  }
  if (profile.direction !== -1 && profile.direction !== 1) {
    samplingError("motion-profile-invalid", "Motion direction must be -1 or 1.");
  }
  if (
    profile.minRadians > profile.maxRadians
    || profile.referenceRadians < profile.minRadians
    || profile.referenceRadians > profile.maxRadians
  ) {
    samplingError(
      "motion-profile-invalid",
      "Motion bounds must contain the reference angle.",
    );
  }
}

/**
 * Defensively checks kinematic invariants that are stricter than structural typing.
 * A mismatch is a runtime invariant failure, never an inferred or corrected motion.
 */
export function validateMotionProfileForSampling(profile: MotionProfile): void {
  validateCommonMotionProfile(profile);

  switch (profile.kind) {
    case "continuous-rotation": {
      positiveFinite(profile.periodMs, "periodMs");
      if (profile.maxRadians - profile.minRadians < FULL_ROTATION_RADIANS - NUMERIC_EPSILON) {
        samplingError(
          "motion-profile-invalid",
          "Continuous rotation bounds must contain one complete rotation.",
        );
      }
      if (!anglesEquivalent(profile.phaseRadians, profile.referenceRadians)) {
        samplingError(
          "reference-phase-invalid",
          "Continuous rotation phase must begin at the reference angle.",
        );
      }
      return;
    }
    case "discrete-rotation": {
      positiveFinite(profile.cadenceMs, "cadenceMs");
      const step = finiteNumber(profile.stepRadians, "stepRadians");
      if (step === 0) {
        samplingError("motion-profile-invalid", "Discrete rotation step must be nonzero.");
      }
      if (profile.maxRadians - profile.minRadians < FULL_ROTATION_RADIANS - NUMERIC_EPSILON) {
        samplingError(
          "motion-profile-invalid",
          "Discrete rotation bounds must contain one complete rotation.",
        );
      }
      if (!anglesEquivalent(profile.phaseRadians, profile.referenceRadians)) {
        samplingError(
          "reference-phase-invalid",
          "Discrete rotation phase must begin at the reference angle.",
        );
      }
      return;
    }
    case "oscillation": {
      positiveFinite(profile.periodMs, "periodMs");
      const amplitude = positiveFinite(profile.amplitudeRadians, "amplitudeRadians");
      if (
        !approximatelyEqual(profile.minRadians, -amplitude)
        || !approximatelyEqual(profile.maxRadians, amplitude)
      ) {
        samplingError(
          "motion-profile-invalid",
          "Oscillation bounds must equal its symmetric amplitude.",
        );
      }
      const referenceAtPhase = amplitude * Math.sin(
        normalizeSignedRadians(profile.phaseRadians),
      );
      if (!approximatelyEqual(referenceAtPhase, profile.referenceRadians)) {
        samplingError(
          "reference-phase-invalid",
          "Oscillation phase must begin at the reference angle.",
        );
      }
      return;
    }
    default:
      return assertNever(profile, "Unsupported motion profile");
  }
}

/** Samples the approved absolute part angle from profile data and Active Elapsed Time only. */
export function sampleMotionAngle(
  profile: MotionProfile,
  activeElapsedMs: number,
): number {
  validateMotionProfileForSampling(profile);
  const elapsed = activeElapsed(activeElapsedMs);

  switch (profile.kind) {
    case "continuous-rotation": {
      const progress = normalizeCycleProgress(elapsed, profile.periodMs);
      if (progress === 0) return profile.referenceRadians;
      return equivalentAngleWithinBounds(
        profile.referenceRadians
          + profile.direction * FULL_ROTATION_RADIANS * progress,
        profile.minRadians,
        profile.maxRadians,
      );
    }
    case "discrete-rotation": {
      const stepCount = Math.floor(elapsed / profile.cadenceMs);
      if (!Number.isSafeInteger(stepCount)) {
        return samplingError(
          "active-elapsed-invalid",
          "Active Elapsed Time produces an unsafe discrete step count.",
        );
      }
      if (stepCount === 0) return profile.referenceRadians;
      const reducedStep = positiveModulo(
        Math.abs(profile.stepRadians),
        FULL_ROTATION_RADIANS,
      );
      const reducedDelta = positiveModulo(
        stepCount * reducedStep,
        FULL_ROTATION_RADIANS,
      );
      if (reducedDelta === 0) return profile.referenceRadians;
      return equivalentAngleWithinBounds(
        profile.referenceRadians + profile.direction * reducedDelta,
        profile.minRadians,
        profile.maxRadians,
      );
    }
    case "oscillation": {
      const progress = normalizeCycleProgress(elapsed, profile.periodMs);
      if (progress === 0) return profile.referenceRadians;
      const phase = normalizeSignedRadians(profile.phaseRadians)
        + profile.direction * FULL_ROTATION_RADIANS * progress;
      const sampled = profile.amplitudeRadians * Math.sin(phase);
      if (sampled < profile.minRadians - NUMERIC_EPSILON
        || sampled > profile.maxRadians + NUMERIC_EPSILON) {
        return samplingError(
          "motion-profile-invalid",
          "Oscillation sample exceeded its declared bounds.",
        );
      }
      return cleanZero(Math.min(profile.maxRadians, Math.max(profile.minRadians, sampled)));
    }
    default:
      return assertNever(profile, "Unsupported motion profile");
  }
}

/** Builds a CSS-compatible 2D rotation about an approved canonical-source pivot. */
export function createPivotCenteredRotationMatrix(
  angleRadians: number,
  pivot: SourcePoint,
): ReadonlyMatrix2D {
  const angle = finiteNumber(angleRadians, "angleRadians");
  const pivotX = finiteNumber(pivot.x, "pivot.x");
  const pivotY = finiteNumber(pivot.y, "pivot.y");
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  return freezeMatrix({
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    e: pivotX - cosine * pivotX + sine * pivotY,
    f: pivotY - sine * pivotX - cosine * pivotY,
  });
}

export const createRotationMatrixAroundPivot = createPivotCenteredRotationMatrix;

/** Pure profile sampler required by the runtime design. */
export function sampleMotion(
  profile: MotionProfile,
  activeElapsedMs: number,
): ReadonlyMatrix2D {
  return createPivotCenteredRotationMatrix(
    sampleMotionAngle(profile, activeElapsedMs),
    profile.pivot,
  );
}

/**
 * A profile exists in ValidatedRuntimeManifest only after package approval closure.
 * Missing/static/background layers therefore receive the shared exact identity.
 */
export function sampleApprovedLayerMotion(
  manifest: ValidatedRuntimeManifest,
  layerId: RuntimeMotionLayerId,
  activeElapsedMs: number,
): ReadonlyMatrix2D {
  activeElapsed(activeElapsedMs);
  if (manifest.phase === "static-layered-reconstruction") return IDENTITY_MATRIX_2D;

  const profiles = manifest.motionProfiles.filter((profile) => profile.layerId === layerId);
  if (profiles.length === 0) return IDENTITY_MATRIX_2D;
  if (profiles.length !== 1) {
    return samplingError(
      "motion-profile-invalid",
      `Layer ${String(layerId)} has more than one approved motion profile.`,
    );
  }
  return sampleMotion(profiles[0], activeElapsedMs);
}

export const sampleLayerMotion = sampleApprovedLayerMotion;

/** Returns only approved moving-layer entries; an empty approved set is frozen and empty. */
export function sampleApprovedMotionSet(
  manifest: ValidatedRuntimeManifest,
  activeElapsedMs: number,
): Readonly<Record<string, ReadonlyMatrix2D>> {
  activeElapsed(activeElapsedMs);
  if (
    manifest.phase === "static-layered-reconstruction"
    || manifest.motionProfiles.length === 0
  ) {
    return EMPTY_MOTION_SET;
  }

  const sampled: Record<string, ReadonlyMatrix2D> = {};
  const profiles = [...manifest.motionProfiles].sort((left, right) => (
    String(left.layerId).localeCompare(String(right.layerId))
  ));
  for (const profile of profiles) {
    const key = String(profile.layerId);
    if (Object.hasOwn(sampled, key)) {
      return samplingError(
        "motion-profile-invalid",
        `Layer ${key} has more than one approved motion profile.`,
      );
    }
    sampled[key] = sampleMotion(profile, activeElapsedMs);
  }
  return Object.freeze(sampled);
}

export const sampleApprovedMotion = sampleApprovedMotionSet;

function validateLinkedGearInput(input: LinkedGearSamplingInput): void {
  const { driverProfile, drivenProfile, relationship } = input;
  activeElapsed(input.activeElapsedMs);
  validateMotionProfileForSampling(driverProfile);
  validateMotionProfileForSampling(drivenProfile);

  if (
    relationship.id.trim() === ""
    || String(relationship.approvalId).trim() === ""
    || (relationship.evidence !== "visible-evidence"
      && relationship.evidence !== "authored-assumption")
    || relationship.direction !== "opposite"
    || relationship.driverLayerId === relationship.drivenLayerId
    || relationship.driverLayerId !== driverProfile.layerId
    || relationship.drivenLayerId !== drivenProfile.layerId
    || !Number.isSafeInteger(relationship.driverToothCount)
    || relationship.driverToothCount <= 0
    || !Number.isSafeInteger(relationship.drivenToothCount)
    || relationship.drivenToothCount <= 0
  ) {
    samplingError(
      "relationship-invalid",
      "Linked-gear sampling requires one explicit, approved, profile-bound tooth-count relationship.",
    );
  }

  if (drivenProfile.direction !== -driverProfile.direction) {
    samplingError(
      "relationship-invalid",
      "Linked gears must declare opposite profile directions.",
    );
  }
  const expectedDrivenPeriod = driverProfile.periodMs
    * relationship.drivenToothCount
    / relationship.driverToothCount;
  if (!approximatelyEqual(drivenProfile.periodMs, expectedDrivenPeriod)) {
    samplingError(
      "relationship-invalid",
      "Linked-gear periods do not match the approved inverse tooth-count ratio.",
    );
  }
}

/** Driven angular velocity divided by driver angular velocity. */
export function linkedGearAngularVelocityRatio(
  relationship: ApprovedLinkedGearRelationship,
): number {
  if (
    relationship.direction !== "opposite"
    || !Number.isSafeInteger(relationship.driverToothCount)
    || relationship.driverToothCount <= 0
    || !Number.isSafeInteger(relationship.drivenToothCount)
    || relationship.drivenToothCount <= 0
    || String(relationship.approvalId).trim() === ""
  ) {
    return samplingError(
      "relationship-invalid",
      "Linked-gear ratio requires approved positive integer tooth counts and opposite direction.",
    );
  }
  return -relationship.driverToothCount / relationship.drivenToothCount;
}

export function sampleLinkedGearMotion(
  input: LinkedGearSamplingInput,
): ReadonlyMatrix2D {
  validateLinkedGearInput(input);
  return sampleMotion(input.drivenProfile, input.activeElapsedMs);
}

export function sampleLinkedGearPair(
  input: LinkedGearSamplingInput,
): Readonly<LinkedGearMotionSample> {
  validateLinkedGearInput(input);
  const driverAngleRadians = sampleMotionAngle(
    input.driverProfile,
    input.activeElapsedMs,
  );
  const drivenAngleRadians = sampleMotionAngle(
    input.drivenProfile,
    input.activeElapsedMs,
  );
  return Object.freeze({
    angularVelocityRatio: linkedGearAngularVelocityRatio(input.relationship),
    driven: createPivotCenteredRotationMatrix(
      drivenAngleRadians,
      input.drivenProfile.pivot,
    ),
    drivenAngleRadians,
    driver: createPivotCenteredRotationMatrix(
      driverAngleRadians,
      input.driverProfile.pivot,
    ),
    driverAngleRadians,
  });
}

function cubicBezierCoordinate(parameter: number, first: number, second: number): number {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * first
    + 3 * inverse * parameter * parameter * second
    + parameter * parameter * parameter;
}

function cubicBezierDerivative(parameter: number, first: number, second: number): number {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * first
    + 6 * inverse * parameter * (second - first)
    + 3 * parameter * parameter * (1 - second);
}

/** Solves the predecessor CSS cubic-bezier(0.42, 0, 0.58, 1). */
export function easeInOutCubicBezier(progress: number): number {
  const target = finiteNumber(progress, "progress");
  if (target < 0 || target > 1) {
    return samplingError("motion-profile-invalid", "Easing progress must be within [0, 1].");
  }
  if (target === 0 || target === 1) return target;

  let parameter = target;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = cubicBezierCoordinate(
      parameter,
      INHERITED_GLOBAL_EASING.x1,
      INHERITED_GLOBAL_EASING.x2,
    ) - target;
    if (Math.abs(error) <= 1e-12) {
      return cubicBezierCoordinate(
        parameter,
        INHERITED_GLOBAL_EASING.y1,
        INHERITED_GLOBAL_EASING.y2,
      );
    }
    const derivative = cubicBezierDerivative(
      parameter,
      INHERITED_GLOBAL_EASING.x1,
      INHERITED_GLOBAL_EASING.x2,
    );
    if (Math.abs(derivative) < 1e-8) break;
    const next = parameter - error / derivative;
    if (next <= 0 || next >= 1) break;
    parameter = next;
  }

  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    parameter = (lower + upper) / 2;
    const current = cubicBezierCoordinate(
      parameter,
      INHERITED_GLOBAL_EASING.x1,
      INHERITED_GLOBAL_EASING.x2,
    );
    if (Math.abs(current - target) <= 1e-12) break;
    if (current < target) lower = parameter;
    else upper = parameter;
  }
  return cubicBezierCoordinate(
    parameter,
    INHERITED_GLOBAL_EASING.y1,
    INHERITED_GLOBAL_EASING.y2,
  );
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

/** Samples the exact 14-second outward / 14-second return predecessor transform. */
export function sampleInheritedGlobalTransform(
  activeElapsedMs: number,
): Readonly<InheritedGlobalTransformSample> {
  const cycleElapsed = normalizeCycle(activeElapsedMs, INHERITED_GLOBAL_PERIOD_MS);
  const outward = cycleElapsed <= INHERITED_GLOBAL_SEGMENT_MS;
  const segmentProgress = outward
    ? cycleElapsed / INHERITED_GLOBAL_SEGMENT_MS
    : (cycleElapsed - INHERITED_GLOBAL_SEGMENT_MS) / INHERITED_GLOBAL_SEGMENT_MS;
  const easedSegmentProgress = easeInOutCubicBezier(segmentProgress);
  const start = outward ? INHERITED_GLOBAL_START : INHERITED_GLOBAL_OUTWARD;
  const end = outward ? INHERITED_GLOBAL_OUTWARD : INHERITED_GLOBAL_START;

  return Object.freeze({
    cycleProgress: cycleElapsed / INHERITED_GLOBAL_PERIOD_MS,
    easedSegmentProgress,
    scale: interpolate(start.scale, end.scale, easedSegmentProgress),
    segment: outward ? "outward" : "return",
    segmentProgress,
    translateXPercent: interpolate(
      start.translateXPercent,
      end.translateXPercent,
      easedSegmentProgress,
    ),
    translateYPercent: interpolate(
      start.translateYPercent,
      end.translateYPercent,
      easedSegmentProgress,
    ),
  });
}

/** Converts inherited percentage translation and center-origin scale to viewport pixels. */
export function inheritedGlobalSampleToMatrix(
  sample: InheritedGlobalTransformSample,
  viewportWidth: number,
  viewportHeight: number,
): ReadonlyMatrix2D {
  const width = positiveFinite(viewportWidth, "viewportWidth", "matrix-invalid");
  const height = positiveFinite(viewportHeight, "viewportHeight", "matrix-invalid");
  const scale = positiveFinite(sample.scale, "sample.scale", "matrix-invalid");
  const translationX = finiteNumber(
    sample.translateXPercent,
    "sample.translateXPercent",
    "matrix-invalid",
  ) * width / 100;
  const translationY = finiteNumber(
    sample.translateYPercent,
    "sample.translateYPercent",
    "matrix-invalid",
  ) * height / 100;
  const originX = width / 2;
  const originY = height / 2;

  return freezeMatrix({
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: translationX + originX * (1 - scale),
    f: translationY + originY * (1 - scale),
  });
}

export function sampleInheritedGlobalMatrix(
  activeElapsedMs: number,
  viewportWidth: number,
  viewportHeight: number,
): ReadonlyMatrix2D {
  return inheritedGlobalSampleToMatrix(
    sampleInheritedGlobalTransform(activeElapsedMs),
    viewportWidth,
    viewportHeight,
  );
}

export function canonicalCoverTransformToMatrix(
  transform: CanonicalCoverTransform,
): ReadonlyMatrix2D {
  const scale = positiveFinite(transform.coverScale, "cover.coverScale", "matrix-invalid");
  return freezeMatrix({
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: finiteNumber(transform.offsetX, "cover.offsetX", "matrix-invalid"),
    f: finiteNumber(transform.offsetY, "cover.offsetY", "matrix-invalid"),
  });
}

function isCanonicalCoverTransform(
  value: CanonicalCoverTransform | ReadonlyMatrix2D,
): value is CanonicalCoverTransform {
  return "coverScale" in value;
}

/** Matrix product `left · right`; the right transform is applied to a point first. */
export function multiplyMatrix2D(
  left: ReadonlyMatrix2D,
  right: ReadonlyMatrix2D,
): ReadonlyMatrix2D {
  assertMatrix(left, "left");
  assertMatrix(right, "right");
  return freezeMatrix({
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  });
}

export const multiplyMatrices = multiplyMatrix2D;

/** Composes `global · cover · depth · part` exactly as specified by the runtime design. */
export function composeLayerTransform(
  input: ApprovedTransformCompositionInput,
): ReadonlyMatrix2D {
  const cover = isCanonicalCoverTransform(input.cover)
    ? canonicalCoverTransformToMatrix(input.cover)
    : assertMatrix(input.cover, "cover");
  const depth = input.depth ?? IDENTITY_MATRIX_2D;
  const part = input.part ?? IDENTITY_MATRIX_2D;
  return multiplyMatrix2D(
    multiplyMatrix2D(
      multiplyMatrix2D(assertMatrix(input.global, "global"), cover),
      assertMatrix(depth, "depth"),
    ),
    assertMatrix(part, "part"),
  );
}

export const composeApprovedTransforms = composeLayerTransform;

export function composeGlobalCoverDepthPartTransforms(
  global: ReadonlyMatrix2D,
  cover: CanonicalCoverTransform | ReadonlyMatrix2D,
  depth: ReadonlyMatrix2D = IDENTITY_MATRIX_2D,
  part: ReadonlyMatrix2D = IDENTITY_MATRIX_2D,
): ReadonlyMatrix2D {
  return composeLayerTransform({ cover, depth, global, part });
}

export function applyMatrixToPoint(
  matrix: ReadonlyMatrix2D,
  point: SourcePoint,
): Readonly<SourcePoint> {
  assertMatrix(matrix, "matrix");
  const x = finiteNumber(point.x, "point.x", "matrix-invalid");
  const y = finiteNumber(point.y, "point.y", "matrix-invalid");
  return Object.freeze({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  });
}

export function isIdentityMatrix(
  matrix: ReadonlyMatrix2D,
  tolerance = 0,
): boolean {
  const epsilon = finiteNumber(tolerance, "tolerance", "matrix-invalid");
  if (epsilon < 0) {
    return samplingError("matrix-invalid", "Identity tolerance must be nonnegative.");
  }
  return Math.abs(matrix.a - 1) <= epsilon
    && Math.abs(matrix.b) <= epsilon
    && Math.abs(matrix.c) <= epsilon
    && Math.abs(matrix.d - 1) <= epsilon
    && Math.abs(matrix.e) <= epsilon
    && Math.abs(matrix.f) <= epsilon;
}
