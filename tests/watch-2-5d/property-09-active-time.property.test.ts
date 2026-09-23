import { act, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { expect, it } from "vitest";
import {
  useAnimationClock,
  type AnimationClockEnvironment,
  type UseAnimationClockOptions,
} from "@/components/ui/watch-2-5d/useAnimationClock";
import {
  createActiveTimeState,
  sampleActiveTime,
  transitionActiveTime,
  type ActiveTimeConditions,
  type ActiveTimePauseReason,
  type ActiveTimeSample,
  type ActiveTimeState,
} from "@/lib/watch-2-5d/active-time";
import {
  FULL_ROTATION_RADIANS,
  IDENTITY_MATRIX_2D,
  sampleInheritedGlobalMatrix,
  sampleInheritedGlobalTransform,
  sampleMotion,
} from "@/lib/watch-2-5d/motion";
import type {
  ApprovalId,
  ContinuousRotationProfile,
  LayerId,
  MotionProfileId,
  ReadonlyMatrix2D,
} from "@/lib/watch-2-5d/types";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 9: Active-time pause and resume semantics";

// Reproduce with: seed=20260609, numRuns=128.
const PROPERTY_SEED = 20_260_609;
const PROPERTY_RUNS = 128;
const VIEWPORT_WIDTH = 1_440;
const VIEWPORT_HEIGHT = 900;

const CLOCK_FLAG_FIELDS = [
  "ready",
  "reducedMotion",
  "definitionOpen",
  "profileLoading",
  "unsupported",
  "error",
] as const;

type ClockFlag = (typeof CLOCK_FLAG_FIELDS)[number];
type ClockFlags = Pick<UseAnimationClockOptions, ClockFlag>;
type FrameCallback = (timestampMs: number) => void;

const ACTIVE_FLAGS: ClockFlags = Object.freeze({
  definitionOpen: false,
  error: false,
  profileLoading: false,
  ready: true,
  reducedMotion: false,
  unsupported: false,
});

const REFERENCE_MOTION_PROFILE: ContinuousRotationProfile = Object.freeze({
  approvalId: "property-09-motion-approval" as ApprovalId,
  direction: 1,
  evidence: "authored-assumption",
  id: "property-09-motion" as MotionProfileId,
  kind: "continuous-rotation",
  layerId: "property-09-layer" as LayerId,
  maxRadians: FULL_ROTATION_RADIANS,
  minRadians: -FULL_ROTATION_RADIANS,
  periodMs: 11_000,
  phaseRadians: 0.375,
  pivot: Object.freeze({ x: 1_380, y: 752 }),
  referenceRadians: 0.375,
});

interface TransformSnapshot {
  readonly depth: ReadonlyMatrix2D;
  readonly global: ReadonlyMatrix2D;
  readonly globalPhase: ReturnType<typeof sampleInheritedGlobalTransform>;
  readonly part: ReadonlyMatrix2D;
}

interface InitialCase {
  readonly flags: ClockFlags;
  readonly pageHidden: boolean;
  readonly timestampMs: number;
}

interface ModelState {
  activeBaselineTimestampMs: number | null;
  activeIntervalTotalMs: number;
  clockConditions: ActiveTimeConditions;
  environmentPageHidden: boolean;
  flags: ClockFlags;
  lastEventTimestampMs: number;
  nowMs: number;
  pendingFrame: boolean;
  staleCallbackCount: number;
}

interface RealState {
  activeTimeState: ActiveTimeState;
  environment: FakeAnimationClockEnvironment;
  flags: ClockFlags;
  samples: ActiveTimeSample[];
  view: RenderedClock;
}

class FakeAnimationClockEnvironment implements AnimationClockEnvironment {
  private readonly callbacks = new Map<number, FrameCallback>();
  private readonly cancelledCallbacks: FrameCallback[] = [];
  private readonly visibilityListeners = new Set<() => void>();
  private nextFrameHandle = 1;
  private nowMs = 0;
  private pageHidden = false;

  readonly now = (): number => this.nowMs;

  readonly requestAnimationFrame = (callback: FrameCallback): number => {
    const handle = this.nextFrameHandle;
    this.nextFrameHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  };

  readonly cancelAnimationFrame = (handle: number): void => {
    const callback = this.callbacks.get(handle);
    if (callback !== undefined) this.cancelledCallbacks.push(callback);
    this.callbacks.delete(handle);
  };

  readonly isPageHidden = (): boolean => this.pageHidden;

  readonly subscribeToVisibilityChange = (
    listener: () => void,
  ): (() => void) => {
    this.visibilityListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.visibilityListeners.delete(listener);
    };
  };

  initialize(timestampMs: number, pageHidden: boolean): void {
    this.nowMs = timestampMs;
    this.pageHidden = pageHidden;
  }

  setNow(timestampMs: number): void {
    if (!Number.isSafeInteger(timestampMs) || timestampMs < this.nowMs) {
      throw new RangeError("Generated clock timestamps must remain monotonic safe integers.");
    }
    this.nowMs = timestampMs;
  }

  fireFrame(timestampMs: number): void {
    this.setNow(timestampMs);
    const entry = this.callbacks.entries().next().value as
      | [number, FrameCallback]
      | undefined;
    if (entry === undefined) throw new Error("Expected one pending frame callback.");
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    callback(timestampMs);
  }

  togglePageHidden(timestampMs: number): void {
    this.setNow(timestampMs);
    this.pageHidden = !this.pageHidden;
    for (const listener of [...this.visibilityListeners]) listener();
  }

  invokeNextCancelledCallback(timestampMs: number): void {
    this.setNow(timestampMs);
    const callback = this.cancelledCallbacks.shift();
    if (callback === undefined) throw new Error("Expected one cancelled callback.");
    callback(timestampMs);
  }

  invokeAllCancelledCallbacks(timestampMs: number): void {
    this.setNow(timestampMs);
    for (const callback of this.cancelledCallbacks.splice(0)) {
      callback(timestampMs);
    }
  }

  get cancelledCallbackCount(): number {
    return this.cancelledCallbacks.length;
  }

  get currentTimestampMs(): number {
    return this.nowMs;
  }

  get hidden(): boolean {
    return this.pageHidden;
  }

  get pendingFrameCount(): number {
    return this.callbacks.size;
  }

  get visibilityListenerCount(): number {
    return this.visibilityListeners.size;
  }
}

function activeTimeConditions(
  flags: ClockFlags,
  pageHidden: boolean,
): ActiveTimeConditions {
  return {
    definitionOpen: flags.definitionOpen,
    error: flags.error,
    pageHidden,
    profileLoading: flags.profileLoading,
    ready: flags.ready,
    reducedMotion: flags.reducedMotion,
    unsupported: flags.unsupported,
  };
}

/** Independent reason oracle: no production reason derivation is reused. */
function modelPauseReasons(
  conditions: ActiveTimeConditions,
): readonly ActiveTimePauseReason[] {
  const reasons: ActiveTimePauseReason[] = [];
  if (conditions.reducedMotion) reasons.push("reduced-motion");
  if (conditions.definitionOpen) reasons.push("definition-dialog");
  if (conditions.pageHidden) reasons.push("page-hidden");
  if (conditions.profileLoading) reasons.push("profile-loading");
  if (conditions.unsupported) reasons.push("unsupported");
  if (conditions.error) reasons.push("error");
  return reasons;
}

function modelIsRunning(model: ModelState): boolean {
  return model.clockConditions.ready
    && modelPauseReasons(model.clockConditions).length === 0;
}

function modelHasVisibilityListener(model: ModelState): boolean {
  return model.flags.ready
    && !model.flags.reducedMotion
    && !model.flags.definitionOpen
    && !model.flags.profileLoading
    && !model.flags.unsupported
    && !model.flags.error;
}

function expectedSample(model: ModelState): ActiveTimeSample {
  const pauseReasons = modelPauseReasons(model.clockConditions);
  const referencePhase = pauseReasons.includes("reduced-motion");
  return {
    activeElapsedMs: model.activeIntervalTotalMs,
    pauseReasons,
    ready: model.clockConditions.ready,
    referencePhase,
    running: modelIsRunning(model),
    transformElapsedMs: referencePhase ? 0 : model.activeIntervalTotalMs,
  };
}

function createModelState(initial: InitialCase): ModelState {
  const flags = { ...initial.flags };
  const clockConditions = activeTimeConditions(flags, initial.pageHidden);
  const running = clockConditions.ready
    && modelPauseReasons(clockConditions).length === 0;
  return {
    activeBaselineTimestampMs: running ? initial.timestampMs : null,
    activeIntervalTotalMs: 0,
    clockConditions,
    environmentPageHidden: initial.pageHidden,
    flags,
    lastEventTimestampMs: initial.timestampMs,
    nowMs: initial.timestampMs,
    pendingFrame: running,
    staleCallbackCount: 0,
  };
}

function settleActiveModelInterval(model: ModelState): void {
  if (!modelIsRunning(model)) return;
  if (model.activeBaselineTimestampMs === null) {
    throw new Error("The independent running model requires a fresh baseline.");
  }
  model.activeIntervalTotalMs += model.nowMs - model.activeBaselineTimestampMs;
}

function synchronizeModelConditions(
  model: ModelState,
  conditions: ActiveTimeConditions,
): void {
  settleActiveModelInterval(model);
  if (model.pendingFrame) model.staleCallbackCount += 1;
  model.clockConditions = conditions;
  model.lastEventTimestampMs = model.nowMs;
  model.activeBaselineTimestampMs = modelIsRunning(model) ? model.nowMs : null;
  model.pendingFrame = modelIsRunning(model);
}

function runModelFrame(model: ModelState): void {
  if (!model.pendingFrame || !modelIsRunning(model)) {
    throw new Error("The independent model cannot run an unscheduled frame.");
  }
  settleActiveModelInterval(model);
  model.lastEventTimestampMs = model.nowMs;
  model.activeBaselineTimestampMs = model.nowMs;
  model.pendingFrame = true;
}

/**
 * A clock-only depth consumer used to prove the Reference Pose hand-off.
 * This is intentionally not an implementation of the separately gated depth task.
 */
function sampleDepthClockProbe(transformElapsedMs: number): ReadonlyMatrix2D {
  if (transformElapsedMs === 0) return IDENTITY_MATRIX_2D;
  const phase = transformElapsedMs / 9_000 * FULL_ROTATION_RADIANS;
  const wave = Math.sin(phase);
  return Object.freeze({
    a: 1 + wave * 0.005,
    b: 0,
    c: 0,
    d: 1 + wave * 0.005,
    e: wave * 2,
    f: wave * -1.5,
  });
}

function transformSnapshot(transformElapsedMs: number): TransformSnapshot {
  return Object.freeze({
    depth: sampleDepthClockProbe(transformElapsedMs),
    global: sampleInheritedGlobalMatrix(
      transformElapsedMs,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
    ),
    globalPhase: sampleInheritedGlobalTransform(transformElapsedMs),
    part: sampleMotion(REFERENCE_MOTION_PROFILE, transformElapsedMs),
  });
}

const REFERENCE_TRANSFORMS = transformSnapshot(0);

function renderProductionClock(
  environment: FakeAnimationClockEnvironment,
  initialFlags: ClockFlags,
  samples: ActiveTimeSample[],
) {
  const onFrame = (sample: ActiveTimeSample): void => {
    samples.push(sample);
  };
  return renderHook(
    (flags: ClockFlags) => useAnimationClock({
      ...flags,
      environment,
      onFrame,
    }),
    { initialProps: initialFlags },
  );
}

type RenderedClock = ReturnType<typeof renderProductionClock>;

function createRealState(initial: InitialCase): RealState {
  const environment = new FakeAnimationClockEnvironment();
  environment.initialize(initial.timestampMs, initial.pageHidden);
  const flags = { ...initial.flags };
  const samples: ActiveTimeSample[] = [];
  const activeTimeState = transitionActiveTime(createActiveTimeState(), {
    conditions: activeTimeConditions(flags, initial.pageHidden),
    timestampMs: initial.timestampMs,
    type: "conditions-changed",
  });
  const view = renderProductionClock(environment, flags, samples);
  return { activeTimeState, environment, flags, samples, view };
}

function assertEquivalent(model: ModelState, real: RealState): void {
  const expected = expectedSample(model);
  const directSample = sampleActiveTime(real.activeTimeState);
  const hookSample = real.view.result.current.getSnapshot();

  expect(directSample).toEqual(expected);
  expect(hookSample).toEqual(expected);
  expect(real.samples.at(-1)).toEqual(expected);
  expect(real.activeTimeState.activeElapsedMs).toBe(model.activeIntervalTotalMs);
  expect(real.activeTimeState.activeBaselineTimestampMs)
    .toBe(model.activeBaselineTimestampMs);
  expect(real.activeTimeState.lastTimestampMs).toBe(model.lastEventTimestampMs);
  expect(real.environment.currentTimestampMs).toBe(model.nowMs);
  expect(real.environment.hidden).toBe(model.environmentPageHidden);
  expect(real.environment.pendingFrameCount).toBe(model.pendingFrame ? 1 : 0);
  expect(real.environment.cancelledCallbackCount).toBe(model.staleCallbackCount);
  expect(real.environment.visibilityListenerCount)
    .toBe(modelHasVisibilityListener(model) ? 1 : 0);

  if (expected.referencePhase) {
    expect(transformSnapshot(expected.transformElapsedMs)).toEqual(
      REFERENCE_TRANSFORMS,
    );
  }
}

function advanceMonotonicTime(
  model: ModelState,
  real: RealState,
  deltaMs: number,
): void {
  model.nowMs += deltaMs;
  real.environment.setNow(model.nowMs);
}

function assertPausedTransformsStable(
  before: ActiveTimeSample,
  after: ActiveTimeSample,
): void {
  if (
    !before.running
    && !after.running
    && before.referencePhase === after.referencePhase
  ) {
    expect(transformSnapshot(after.transformElapsedMs)).toEqual(
      transformSnapshot(before.transformElapsedMs),
    );
  }
}

class ToggleFlagCommand implements fc.Command<ModelState, RealState> {
  constructor(
    readonly field: ClockFlag,
    readonly deltaMs: number,
  ) {}

  check(): boolean {
    return true;
  }

  run(model: ModelState, real: RealState): void {
    const before = expectedSample(model);
    const wasRunning = before.running;
    advanceMonotonicTime(model, real, this.deltaMs);

    model.flags = { ...model.flags, [this.field]: !model.flags[this.field] };
    synchronizeModelConditions(
      model,
      activeTimeConditions(model.flags, model.environmentPageHidden),
    );

    real.flags = { ...real.flags, [this.field]: !real.flags[this.field] };
    real.activeTimeState = transitionActiveTime(real.activeTimeState, {
      conditions: activeTimeConditions(real.flags, real.environment.hidden),
      timestampMs: model.nowMs,
      type: "conditions-changed",
    });
    act(() => real.view.rerender(real.flags));

    const after = expectedSample(model);
    assertEquivalent(model, real);
    assertPausedTransformsStable(before, after);
    if (!wasRunning && after.running) {
      expect(after.activeElapsedMs).toBe(before.activeElapsedMs);
      expect(real.activeTimeState.activeBaselineTimestampMs).toBe(model.nowMs);
    }
  }

  toString(): string {
    return `toggle-${this.field}(+${this.deltaMs}ms)`;
  }
}

class ToggleVisibilityCommand implements fc.Command<ModelState, RealState> {
  constructor(readonly deltaMs: number) {}

  check(): boolean {
    return true;
  }

  run(model: ModelState, real: RealState): void {
    const before = expectedSample(model);
    const listenerActive = modelHasVisibilityListener(model);
    expect(real.environment.visibilityListenerCount).toBe(listenerActive ? 1 : 0);
    advanceMonotonicTime(model, real, this.deltaMs);

    model.environmentPageHidden = !model.environmentPageHidden;
    if (listenerActive) {
      synchronizeModelConditions(
        model,
        activeTimeConditions(model.flags, model.environmentPageHidden),
      );
    }

    act(() => real.environment.togglePageHidden(model.nowMs));
    if (listenerActive) {
      real.activeTimeState = transitionActiveTime(real.activeTimeState, {
        conditions: activeTimeConditions(real.flags, real.environment.hidden),
        timestampMs: model.nowMs,
        type: "conditions-changed",
      });
    }

    const after = expectedSample(model);
    assertEquivalent(model, real);
    assertPausedTransformsStable(before, after);
    if (!before.running && after.running) {
      expect(after.activeElapsedMs).toBe(before.activeElapsedMs);
      expect(real.activeTimeState.activeBaselineTimestampMs).toBe(model.nowMs);
    }
  }

  toString(): string {
    return `toggle-visibility(+${this.deltaMs}ms)`;
  }
}

class FrameCommand implements fc.Command<ModelState, RealState> {
  constructor(readonly deltaMs: number) {}

  check(model: Readonly<ModelState>): boolean {
    return model.pendingFrame && modelIsRunning(model as ModelState);
  }

  run(model: ModelState, real: RealState): void {
    advanceMonotonicTime(model, real, this.deltaMs);
    runModelFrame(model);
    real.activeTimeState = transitionActiveTime(real.activeTimeState, {
      timestampMs: model.nowMs,
      type: "frame",
    });
    act(() => real.environment.fireFrame(model.nowMs));
    assertEquivalent(model, real);
  }

  toString(): string {
    return `frame(+${this.deltaMs}ms)`;
  }
}

class PausedProbeCommand implements fc.Command<ModelState, RealState> {
  constructor(readonly deltaMs: number) {}

  check(model: Readonly<ModelState>): boolean {
    return !modelIsRunning(model as ModelState);
  }

  run(model: ModelState, real: RealState): void {
    const beforeSample = real.view.result.current.getSnapshot();
    const beforeTransforms = transformSnapshot(beforeSample.transformElapsedMs);
    const beforeState = real.activeTimeState;
    const sampleCount = real.samples.length;

    advanceMonotonicTime(model, real, this.deltaMs);

    expect(real.activeTimeState).toBe(beforeState);
    expect(real.samples).toHaveLength(sampleCount);
    assertEquivalent(model, real);
    expect(transformSnapshot(
      real.view.result.current.getSnapshot().transformElapsedMs,
    )).toEqual(beforeTransforms);
  }

  toString(): string {
    return `paused-probe(+${this.deltaMs}ms)`;
  }
}

class InvokeStaleCallbackCommand implements fc.Command<ModelState, RealState> {
  constructor(readonly deltaMs: number) {}

  check(model: Readonly<ModelState>): boolean {
    return model.staleCallbackCount > 0;
  }

  run(model: ModelState, real: RealState): void {
    const beforeSample = real.view.result.current.getSnapshot();
    const beforeTransforms = transformSnapshot(beforeSample.transformElapsedMs);
    const beforeState = real.activeTimeState;
    const sampleCount = real.samples.length;
    const pendingFrames = real.environment.pendingFrameCount;

    advanceMonotonicTime(model, real, this.deltaMs);
    model.staleCallbackCount -= 1;
    act(() => real.environment.invokeNextCancelledCallback(model.nowMs));

    expect(real.activeTimeState).toBe(beforeState);
    expect(real.samples).toHaveLength(sampleCount);
    expect(real.environment.pendingFrameCount).toBe(pendingFrames);
    assertEquivalent(model, real);
    expect(transformSnapshot(
      real.view.result.current.getSnapshot().transformElapsedMs,
    )).toEqual(beforeTransforms);
  }

  toString(): string {
    return `invoke-stale-callback(+${this.deltaMs}ms)`;
  }
}

const timestampDeltaArbitrary = fc.oneof(
  fc.constantFrom(0, 1, 16, 250, 1_000, 10_000),
  fc.integer({ min: 0, max: 20_000 }),
);

const arbitraryFlags: fc.Arbitrary<ClockFlags> = fc.record({
  definitionOpen: fc.boolean(),
  error: fc.boolean(),
  profileLoading: fc.boolean(),
  ready: fc.boolean(),
  reducedMotion: fc.boolean(),
  unsupported: fc.boolean(),
});

const initialCaseArbitrary: fc.Arbitrary<InitialCase> = fc.record({
  flags: fc.oneof(
    fc.constant(ACTIVE_FLAGS),
    fc.constant(ACTIVE_FLAGS),
    arbitraryFlags,
  ),
  pageHidden: fc.oneof(fc.constant(false), fc.constant(false), fc.boolean()),
  timestampMs: fc.integer({ min: 0, max: 1_000_000 }),
});

const commandArbitraries: fc.Arbitrary<fc.Command<ModelState, RealState>>[] = [
  fc.tuple(fc.constantFrom(...CLOCK_FLAG_FIELDS), timestampDeltaArbitrary)
    .map(([field, deltaMs]) => new ToggleFlagCommand(field, deltaMs)),
  timestampDeltaArbitrary.map((deltaMs) => new ToggleVisibilityCommand(deltaMs)),
  timestampDeltaArbitrary.map((deltaMs) => new FrameCommand(deltaMs)),
  timestampDeltaArbitrary.map((deltaMs) => new PausedProbeCommand(deltaMs)),
  timestampDeltaArbitrary.map((deltaMs) => new InvokeStaleCallbackCommand(deltaMs)),
];

const commandsArbitrary = fc.commands(commandArbitraries, { maxCommands: 48 });

// **Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.7, 9.8, 9.9, 9.13, 9.14**
// Feature: interactive-layered-watch-2-5d, Property 9: Active-time pause and resume semantics
it(PROPERTY_TAG, { timeout: 120_000 }, () => {
  fc.assert(
    fc.property(initialCaseArbitrary, commandsArbitrary, (initial, commands) => {
      let real: RealState | undefined;
      let disposed = false;
      try {
        fc.modelRun(
          () => {
            const model = createModelState(initial);
            real = createRealState(initial);
            assertEquivalent(model, real);
            return { model, real };
          },
          commands,
        );

        if (real === undefined) throw new Error("Expected the model run to initialize.");
        const sampleCount = real.samples.length;
        act(() => real?.view.unmount());
        disposed = true;
        expect(real.environment.pendingFrameCount).toBe(0);
        expect(real.environment.visibilityListenerCount).toBe(0);

        // Staleness is callback-generation based; its timestamp remains monotonic.
        act(() => real?.environment.invokeAllCancelledCallbacks(
          real.environment.currentTimestampMs,
        ));
        expect(real.samples).toHaveLength(sampleCount);
        expect(real.environment.pendingFrameCount).toBe(0);
      } finally {
        if (!disposed && real !== undefined) act(() => real?.view.unmount());
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
