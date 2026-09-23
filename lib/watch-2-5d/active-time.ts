export const ACTIVE_TIME_PAUSE_REASONS = [
  "reduced-motion",
  "definition-dialog",
  "page-hidden",
  "profile-loading",
  "unsupported",
  "error",
] as const;

export type ActiveTimePauseReason =
  (typeof ACTIVE_TIME_PAUSE_REASONS)[number];

export interface ActiveTimeConditions {
  readonly ready: boolean;
  readonly reducedMotion: boolean;
  readonly definitionOpen: boolean;
  readonly pageHidden: boolean;
  readonly profileLoading: boolean;
  readonly unsupported: boolean;
  readonly error: boolean;
}

export interface ActiveTimeState {
  /** Time accumulated only while the enhancement was eligible to animate. */
  readonly activeElapsedMs: number;
  /** The timestamp from which the next active interval is measured. */
  readonly activeBaselineTimestampMs: number | null;
  /** Highest monotonic timestamp accepted from any transition. */
  readonly lastTimestampMs: number | null;
  readonly pauseReasons: readonly ActiveTimePauseReason[];
  readonly ready: boolean;
}

export interface ActiveTimeSample {
  readonly activeElapsedMs: number;
  readonly transformElapsedMs: number;
  readonly pauseReasons: readonly ActiveTimePauseReason[];
  readonly ready: boolean;
  readonly referencePhase: boolean;
  readonly running: boolean;
}

export type ActiveTimeEvent =
  | {
      readonly type: "conditions-changed";
      readonly conditions: ActiveTimeConditions;
      readonly timestampMs: number;
    }
  | {
      readonly type: "frame";
      readonly timestampMs: number;
    };

const EMPTY_PAUSE_REASONS = Object.freeze([]) as readonly ActiveTimePauseReason[];

function nonnegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number.`);
  }
  return value;
}

function freezeState(state: ActiveTimeState): ActiveTimeState {
  return Object.freeze(state);
}

function samePauseReasons(
  left: readonly ActiveTimePauseReason[],
  right: readonly ActiveTimePauseReason[],
): boolean {
  return left.length === right.length
    && left.every((reason, index) => reason === right[index]);
}

/** Maps runtime conditions to one stable, duplicate-free reason set. */
export function deriveActiveTimePauseReasons(
  conditions: ActiveTimeConditions,
): readonly ActiveTimePauseReason[] {
  const reasons: ActiveTimePauseReason[] = [];
  if (conditions.reducedMotion) reasons.push("reduced-motion");
  if (conditions.definitionOpen) reasons.push("definition-dialog");
  if (conditions.pageHidden) reasons.push("page-hidden");
  if (conditions.profileLoading) reasons.push("profile-loading");
  if (conditions.unsupported) reasons.push("unsupported");
  if (conditions.error) reasons.push("error");
  return reasons.length === 0 ? EMPTY_PAUSE_REASONS : Object.freeze(reasons);
}

export function createActiveTimeState(
  initialActiveElapsedMs = 0,
): ActiveTimeState {
  return freezeState({
    activeBaselineTimestampMs: null,
    activeElapsedMs: nonnegativeFinite(
      initialActiveElapsedMs,
      "initialActiveElapsedMs",
    ),
    lastTimestampMs: null,
    pauseReasons: EMPTY_PAUSE_REASONS,
    ready: false,
  });
}

export function isActiveTimeRunning(state: ActiveTimeState): boolean {
  return state.ready && state.pauseReasons.length === 0;
}

function effectiveTimestamp(
  state: ActiveTimeState,
  observedTimestampMs: number,
): number {
  const observed = nonnegativeFinite(observedTimestampMs, "timestampMs");
  return state.lastTimestampMs === null
    ? observed
    : Math.max(state.lastTimestampMs, observed);
}

function accruedElapsedAt(
  state: ActiveTimeState,
  timestampMs: number,
): number {
  if (!isActiveTimeRunning(state)) return state.activeElapsedMs;
  if (state.activeBaselineTimestampMs === null) {
    throw new RangeError("A running Active Time state requires a timestamp baseline.");
  }

  const elapsed = state.activeElapsedMs
    + Math.max(0, timestampMs - state.activeBaselineTimestampMs);
  return nonnegativeFinite(elapsed, "activeElapsedMs");
}

/**
 * Pure semantic source for Active Elapsed Time.
 *
 * Every event first settles the preceding active interval against a monotonic
 * timestamp watermark. A transition from paused to running then records the
 * current watermark as a fresh baseline, so no paused duration can leak into
 * the next frame.
 */
export function transitionActiveTime(
  state: ActiveTimeState,
  event: ActiveTimeEvent,
): ActiveTimeState {
  const timestampMs = effectiveTimestamp(state, event.timestampMs);
  const activeElapsedMs = accruedElapsedAt(state, timestampMs);

  if (event.type === "frame") {
    const activeBaselineTimestampMs = isActiveTimeRunning(state)
      ? timestampMs
      : null;
    if (
      activeElapsedMs === state.activeElapsedMs
      && activeBaselineTimestampMs === state.activeBaselineTimestampMs
      && timestampMs === state.lastTimestampMs
    ) {
      return state;
    }
    return freezeState({
      ...state,
      activeBaselineTimestampMs,
      activeElapsedMs,
      lastTimestampMs: timestampMs,
    });
  }

  const pauseReasons = deriveActiveTimePauseReasons(event.conditions);
  const running = event.conditions.ready && pauseReasons.length === 0;
  const activeBaselineTimestampMs = running ? timestampMs : null;

  if (
    activeElapsedMs === state.activeElapsedMs
    && activeBaselineTimestampMs === state.activeBaselineTimestampMs
    && timestampMs === state.lastTimestampMs
    && event.conditions.ready === state.ready
    && samePauseReasons(pauseReasons, state.pauseReasons)
  ) {
    return state;
  }

  return freezeState({
    activeBaselineTimestampMs,
    activeElapsedMs,
    lastTimestampMs: timestampMs,
    pauseReasons,
    ready: event.conditions.ready,
  });
}

/**
 * Returns the clock value consumed by transform samplers. Reduced motion keeps
 * the accumulated clock intact while exposing time zero, the approved
 * Reference Pose phase, immediately.
 */
export function sampleActiveTime(state: ActiveTimeState): ActiveTimeSample {
  const referencePhase = state.pauseReasons.includes("reduced-motion");
  return Object.freeze({
    activeElapsedMs: state.activeElapsedMs,
    pauseReasons: state.pauseReasons,
    ready: state.ready,
    referencePhase,
    running: isActiveTimeRunning(state),
    transformElapsedMs: referencePhase ? 0 : state.activeElapsedMs,
  });
}
