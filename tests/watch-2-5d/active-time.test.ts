import { describe, expect, it } from "vitest";
import {
  ACTIVE_TIME_PAUSE_REASONS,
  createActiveTimeState,
  deriveActiveTimePauseReasons,
  isActiveTimeRunning,
  sampleActiveTime,
  transitionActiveTime,
  type ActiveTimeConditions,
  type ActiveTimePauseReason,
  type ActiveTimeState,
} from "@/lib/watch-2-5d/active-time";
import {
  FULL_ROTATION_RADIANS,
  INHERITED_GLOBAL_START,
  sampleInheritedGlobalTransform,
  sampleMotionAngle,
} from "@/lib/watch-2-5d/motion";
import type {
  ApprovalId,
  ContinuousRotationProfile,
  LayerId,
  MotionProfileId,
} from "@/lib/watch-2-5d/types";

const ACTIVE_CONDITIONS: ActiveTimeConditions = Object.freeze({
  definitionOpen: false,
  error: false,
  pageHidden: false,
  profileLoading: false,
  ready: true,
  reducedMotion: false,
  unsupported: false,
});

const PAUSE_CASES = [
  ["reducedMotion", "reduced-motion"],
  ["definitionOpen", "definition-dialog"],
  ["pageHidden", "page-hidden"],
  ["profileLoading", "profile-loading"],
  ["unsupported", "unsupported"],
  ["error", "error"],
] as const satisfies readonly [keyof ActiveTimeConditions, ActiveTimePauseReason][];

function conditions(
  overrides: Partial<ActiveTimeConditions> = {},
): ActiveTimeConditions {
  return { ...ACTIVE_CONDITIONS, ...overrides };
}

function changeConditions(
  state: ActiveTimeState,
  timestampMs: number,
  overrides: Partial<ActiveTimeConditions> = {},
): ActiveTimeState {
  return transitionActiveTime(state, {
    conditions: conditions(overrides),
    timestampMs,
    type: "conditions-changed",
  });
}

function frame(state: ActiveTimeState, timestampMs: number): ActiveTimeState {
  return transitionActiveTime(state, { timestampMs, type: "frame" });
}

const REFERENCE_ROTATION_PROFILE: ContinuousRotationProfile = Object.freeze({
  approvalId: "clock-reference-approval" as ApprovalId,
  direction: 1,
  evidence: "authored-assumption",
  id: "clock-reference-motion" as MotionProfileId,
  kind: "continuous-rotation",
  layerId: "clock-reference-layer" as LayerId,
  maxRadians: FULL_ROTATION_RADIANS,
  minRadians: -FULL_ROTATION_RADIANS,
  periodMs: 10_000,
  phaseRadians: 0.375,
  pivot: Object.freeze({ x: 1_380, y: 752 }),
  referenceRadians: 0.375,
});

// Validates: Requirements 6.2, 6.3, 6.14–6.18, 8.7, 8.8, 9.1–9.5, 9.7–9.14.
describe("pure Active Elapsed Time model", () => {
  it("derives every pause reason once in stable semantic order", () => {
    expect(ACTIVE_TIME_PAUSE_REASONS).toEqual([
      "reduced-motion",
      "definition-dialog",
      "page-hidden",
      "profile-loading",
      "unsupported",
      "error",
    ]);
    expect(deriveActiveTimePauseReasons(conditions())).toEqual([]);

    for (const [condition, reason] of PAUSE_CASES) {
      expect(deriveActiveTimePauseReasons(conditions({ [condition]: true })))
        .toEqual([reason]);
    }

    const allReasons = deriveActiveTimePauseReasons(conditions({
      definitionOpen: true,
      error: true,
      pageHidden: true,
      profileLoading: true,
      reducedMotion: true,
      unsupported: true,
    }));
    expect(allReasons).toEqual(ACTIVE_TIME_PAUSE_REASONS);
    expect(Object.isFrozen(allReasons)).toBe(true);
  });

  it.each(PAUSE_CASES)(
    "excludes the complete %s pause interval and resumes from a fresh baseline",
    (condition, reason) => {
      let state = changeConditions(createActiveTimeState(), 100);
      state = frame(state, 125);
      state = changeConditions(state, 150, { [condition]: true });

      expect(sampleActiveTime(state)).toMatchObject({
        activeElapsedMs: 50,
        pauseReasons: [reason],
        running: false,
      });

      state = frame(state, 5_000);
      expect(state.activeElapsedMs).toBe(50);
      state = changeConditions(state, 8_000);
      expect(state.activeBaselineTimestampMs).toBe(8_000);
      expect(state.activeElapsedMs).toBe(50);
      state = frame(state, 8_025);

      expect(sampleActiveTime(state)).toMatchObject({
        activeElapsedMs: 75,
        pauseReasons: [],
        running: true,
      });
    },
  );

  it("preserves accumulated time across nested reasons until the final reason clears", () => {
    let state = changeConditions(createActiveTimeState(), 0);
    state = frame(state, 10);
    state = changeConditions(state, 20, { definitionOpen: true });
    state = changeConditions(state, 30, {
      definitionOpen: true,
      reducedMotion: true,
    });

    expect(state.activeElapsedMs).toBe(20);
    expect(state.pauseReasons).toEqual([
      "reduced-motion",
      "definition-dialog",
    ]);

    state = changeConditions(state, 40, { reducedMotion: true });
    expect(state.activeElapsedMs).toBe(20);
    expect(state.activeBaselineTimestampMs).toBeNull();
    expect(isActiveTimeRunning(state)).toBe(false);

    state = changeConditions(state, 50);
    expect(state.activeElapsedMs).toBe(20);
    expect(state.activeBaselineTimestampMs).toBe(50);
    state = frame(state, 60);
    expect(state.activeElapsedMs).toBe(30);
  });

  it("requires ready state in addition to an empty reason set", () => {
    let state = createActiveTimeState(400);
    state = frame(state, 20);
    state = changeConditions(state, 100, { ready: false });
    state = frame(state, 500);
    expect(sampleActiveTime(state)).toMatchObject({
      activeElapsedMs: 400,
      ready: false,
      running: false,
    });

    state = changeConditions(state, 600);
    state = frame(state, 630);
    state = changeConditions(state, 650, {
      profileLoading: true,
      ready: false,
    });
    expect(state.activeElapsedMs).toBe(450);

    state = changeConditions(state, 900, { profileLoading: true });
    state = frame(state, 1_000);
    expect(state.activeElapsedMs).toBe(450);

    state = changeConditions(state, 1_100);
    state = frame(state, 1_110);
    expect(state.activeElapsedMs).toBe(460);
  });

  it("ignores stale and duplicate timestamps without regressing its watermark or phase", () => {
    let state = changeConditions(createActiveTimeState(), 100);
    state = frame(state, 130);
    expect(state.activeElapsedMs).toBe(30);

    const beforeStaleFrame = state;
    state = frame(state, 120);
    expect(state).toBe(beforeStaleFrame);
    state = frame(state, 130);
    expect(state).toBe(beforeStaleFrame);

    state = changeConditions(state, 110, { definitionOpen: true });
    expect(state.activeElapsedMs).toBe(30);
    expect(state.lastTimestampMs).toBe(130);

    state = frame(state, 500);
    state = changeConditions(state, 400);
    expect(state.activeBaselineTimestampMs).toBe(500);
    state = frame(state, 490);
    expect(state.activeElapsedMs).toBe(30);
    state = frame(state, 510);
    expect(state.activeElapsedMs).toBe(40);
  });

  it("exposes the approved reference phase immediately without discarding elapsed time", () => {
    let state = changeConditions(createActiveTimeState(), 1_000);
    state = frame(state, 4_250);
    state = changeConditions(state, 4_250, { reducedMotion: true });

    const reducedSample = sampleActiveTime(state);
    expect(reducedSample).toMatchObject({
      activeElapsedMs: 3_250,
      referencePhase: true,
      running: false,
      transformElapsedMs: 0,
    });
    expect(sampleMotionAngle(
      REFERENCE_ROTATION_PROFILE,
      reducedSample.transformElapsedMs,
    )).toBe(REFERENCE_ROTATION_PROFILE.referenceRadians);
    expect(sampleInheritedGlobalTransform(reducedSample.transformElapsedMs))
      .toMatchObject(INHERITED_GLOBAL_START);

    state = changeConditions(state, 5_000, { definitionOpen: true });
    const dialogSample = sampleActiveTime(state);
    expect(dialogSample.referencePhase).toBe(false);
    expect(dialogSample.transformElapsedMs).toBe(3_250);
  });

  it("keeps model outputs immutable and validates elapsed/timestamp domains", () => {
    const initial = createActiveTimeState(12.5);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.pauseReasons)).toBe(true);
    expect(Object.isFrozen(sampleActiveTime(initial))).toBe(true);

    expect(() => createActiveTimeState(-1)).toThrow(RangeError);
    expect(() => createActiveTimeState(Number.NaN)).toThrow(RangeError);
    expect(() => transitionActiveTime(initial, {
      timestampMs: Number.POSITIVE_INFINITY,
      type: "frame",
    })).toThrow(RangeError);
    expect(() => changeConditions(initial, -0.001)).toThrow(RangeError);
  });
});
