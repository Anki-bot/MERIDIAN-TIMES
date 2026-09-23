import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useAnimationClock,
  type AnimationClockEnvironment,
  type UseAnimationClockOptions,
} from "@/components/ui/watch-2-5d/useAnimationClock";
import type { ActiveTimePauseReason, ActiveTimeSample } from "@/lib/watch-2-5d/active-time";
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

type FrameCallback = (timestampMs: number) => void;
type ClockFlags = Pick<
  UseAnimationClockOptions,
  | "ready"
  | "reducedMotion"
  | "definitionOpen"
  | "profileLoading"
  | "unsupported"
  | "error"
>;

type HookProps = ClockFlags & {
  readonly initialActiveElapsedMs?: number;
  readonly onFrame: (sample: ActiveTimeSample) => void;
};

const ACTIVE_FLAGS: ClockFlags = Object.freeze({
  definitionOpen: false,
  error: false,
  profileLoading: false,
  ready: true,
  reducedMotion: false,
  unsupported: false,
});

const EXTERNAL_PAUSE_CASES = [
  ["reducedMotion", "reduced-motion"],
  ["definitionOpen", "definition-dialog"],
  ["profileLoading", "profile-loading"],
  ["unsupported", "unsupported"],
  ["error", "error"],
] as const satisfies readonly [keyof ClockFlags, ActiveTimePauseReason][];

const REFERENCE_ROTATION_PROFILE: ContinuousRotationProfile = Object.freeze({
  approvalId: "hook-reference-approval" as ApprovalId,
  direction: 1,
  evidence: "authored-assumption",
  id: "hook-reference-motion" as MotionProfileId,
  kind: "continuous-rotation",
  layerId: "hook-reference-layer" as LayerId,
  maxRadians: FULL_ROTATION_RADIANS,
  minRadians: -FULL_ROTATION_RADIANS,
  periodMs: 8_000,
  phaseRadians: 0.25,
  pivot: Object.freeze({ x: 1_380, y: 752 }),
  referenceRadians: 0.25,
});

class FakeAnimationClockEnvironment implements AnimationClockEnvironment {
  private readonly callbacks = new Map<number, FrameCallback>();
  private readonly cancelledCallbacks: FrameCallback[] = [];
  private readonly visibilityListeners = new Set<() => void>();
  private nextFrameHandle = 1;
  private nowMs = 0;
  private pageHidden = false;

  readonly cancelledFrameHandles: number[] = [];
  maximumPendingFrames = 0;
  requestedFrameCount = 0;
  visibilitySubscribeCount = 0;
  visibilityUnsubscribeCount = 0;

  readonly now = (): number => this.nowMs;

  readonly requestAnimationFrame = (callback: FrameCallback): number => {
    const handle = this.nextFrameHandle;
    this.nextFrameHandle += 1;
    this.requestedFrameCount += 1;
    this.callbacks.set(handle, callback);
    this.maximumPendingFrames = Math.max(
      this.maximumPendingFrames,
      this.callbacks.size,
    );
    return handle;
  };

  readonly cancelAnimationFrame = (handle: number): void => {
    const callback = this.callbacks.get(handle);
    if (callback !== undefined) this.cancelledCallbacks.push(callback);
    this.callbacks.delete(handle);
    this.cancelledFrameHandles.push(handle);
  };

  readonly isPageHidden = (): boolean => this.pageHidden;

  readonly subscribeToVisibilityChange = (
    listener: () => void,
  ): (() => void) => {
    this.visibilitySubscribeCount += 1;
    this.visibilityListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.visibilityListeners.delete(listener);
      this.visibilityUnsubscribeCount += 1;
    };
  };

  setNow(timestampMs: number): void {
    this.nowMs = timestampMs;
  }

  fireFrame(timestampMs: number): void {
    const entry = this.callbacks.entries().next().value as
      | [number, FrameCallback]
      | undefined;
    if (entry === undefined) throw new Error("Expected one pending animation frame.");
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    this.nowMs = Math.max(this.nowMs, timestampMs);
    callback(timestampMs);
  }

  setPageHidden(pageHidden: boolean, timestampMs: number): void {
    this.pageHidden = pageHidden;
    this.nowMs = timestampMs;
    for (const listener of [...this.visibilityListeners]) listener();
  }

  invokeCancelledCallbacks(timestampMs: number): void {
    for (const callback of this.cancelledCallbacks.splice(0)) callback(timestampMs);
  }

  get pendingFrameCount(): number {
    return this.callbacks.size;
  }

  get visibilityListenerCount(): number {
    return this.visibilityListeners.size;
  }
}

function hookProps(
  onFrame: (sample: ActiveTimeSample) => void,
  overrides: Partial<HookProps> = {},
): HookProps {
  return { ...ACTIVE_FLAGS, onFrame, ...overrides };
}

function renderClock(
  environment: FakeAnimationClockEnvironment,
  initialProps: HookProps,
) {
  return renderHook(
    (props: HookProps) => useAnimationClock({ ...props, environment }),
    { initialProps },
  );
}

function lastSample(
  onFrame: ReturnType<typeof vi.fn<(sample: ActiveTimeSample) => void>>,
): ActiveTimeSample {
  const sample = onFrame.mock.calls.at(-1)?.[0];
  if (sample === undefined) throw new Error("Expected an emitted clock sample.");
  return sample;
}

// Validates: Requirements 6.2, 6.3, 6.14–6.18, 8.7, 8.8, 9.1–9.5, 9.7–9.14.
describe("useAnimationClock", () => {
  it("maintains exactly one frame callback across frames and equivalent rerenders", () => {
    const environment = new FakeAnimationClockEnvironment();
    const onFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    const view = renderClock(environment, hookProps(onFrame));
    const initialHandle = view.result.current;

    expect(lastSample(onFrame)).toMatchObject({
      activeElapsedMs: 0,
      running: true,
      transformElapsedMs: 0,
    });
    expect(environment.pendingFrameCount).toBe(1);
    expect(environment.visibilityListenerCount).toBe(1);

    act(() => environment.fireFrame(16));
    expect(lastSample(onFrame).activeElapsedMs).toBe(16);
    expect(environment.pendingFrameCount).toBe(1);

    view.rerender(hookProps(onFrame));
    expect(view.result.current).toBe(initialHandle);
    expect(environment.pendingFrameCount).toBe(1);
    expect(environment.visibilityListenerCount).toBe(1);

    act(() => environment.fireFrame(32));
    expect(lastSample(onFrame).activeElapsedMs).toBe(32);
    expect(environment.pendingFrameCount).toBe(1);
    expect(environment.maximumPendingFrames).toBe(1);
  });

  it.each(EXTERNAL_PAUSE_CASES)(
    "cancels work for %s and excludes the paused interval on resume",
    (condition, reason) => {
      const environment = new FakeAnimationClockEnvironment();
      const onFrame = vi.fn<(sample: ActiveTimeSample) => void>();
      const view = renderClock(environment, hookProps(onFrame));

      act(() => environment.fireFrame(10));
      environment.setNow(20);
      view.rerender(hookProps(onFrame, { [condition]: true }));

      expect(lastSample(onFrame)).toMatchObject({
        activeElapsedMs: 20,
        pauseReasons: [reason],
        running: false,
        transformElapsedMs: reason === "reduced-motion" ? 0 : 20,
      });
      expect(environment.pendingFrameCount).toBe(0);
      expect(environment.visibilityListenerCount).toBe(0);

      environment.setNow(1_000);
      view.rerender(hookProps(onFrame));
      expect(lastSample(onFrame).activeElapsedMs).toBe(20);
      expect(environment.pendingFrameCount).toBe(1);
      expect(environment.visibilityListenerCount).toBe(1);

      act(() => environment.fireFrame(1_010));
      expect(lastSample(onFrame).activeElapsedMs).toBe(30);
      expect(environment.maximumPendingFrames).toBe(1);
    },
  );

  it("holds nested reasons and resumes only after the final reason clears", () => {
    const environment = new FakeAnimationClockEnvironment();
    const onFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    const view = renderClock(environment, hookProps(onFrame));

    act(() => environment.fireFrame(10));
    environment.setNow(20);
    view.rerender(hookProps(onFrame, { definitionOpen: true }));
    environment.setNow(30);
    view.rerender(hookProps(onFrame, {
      definitionOpen: true,
      reducedMotion: true,
    }));

    expect(lastSample(onFrame)).toMatchObject({
      activeElapsedMs: 20,
      pauseReasons: ["reduced-motion", "definition-dialog"],
      referencePhase: true,
      transformElapsedMs: 0,
    });

    environment.setNow(40);
    view.rerender(hookProps(onFrame, { reducedMotion: true }));
    expect(lastSample(onFrame).activeElapsedMs).toBe(20);
    expect(environment.pendingFrameCount).toBe(0);

    environment.setNow(50);
    view.rerender(hookProps(onFrame));
    expect(lastSample(onFrame).activeElapsedMs).toBe(20);
    act(() => environment.fireFrame(60));
    expect(lastSample(onFrame).activeElapsedMs).toBe(30);
  });

  it("pauses on page visibility, retains the required listener, and resumes without a jump", () => {
    const environment = new FakeAnimationClockEnvironment();
    const onFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    renderClock(environment, hookProps(onFrame));

    act(() => environment.fireFrame(10));
    act(() => environment.setPageHidden(true, 20));
    expect(lastSample(onFrame)).toMatchObject({
      activeElapsedMs: 20,
      pauseReasons: ["page-hidden"],
      running: false,
    });
    expect(environment.pendingFrameCount).toBe(0);
    expect(environment.visibilityListenerCount).toBe(1);

    environment.setNow(5_000);
    expect(lastSample(onFrame).activeElapsedMs).toBe(20);
    act(() => environment.setPageHidden(false, 5_000));
    expect(lastSample(onFrame).activeElapsedMs).toBe(20);
    expect(environment.pendingFrameCount).toBe(1);

    act(() => environment.fireFrame(5_010));
    expect(lastSample(onFrame).activeElapsedMs).toBe(30);
    expect(environment.maximumPendingFrames).toBe(1);
  });

  it("removes visibility work when another reason pauses a hidden page", () => {
    const environment = new FakeAnimationClockEnvironment();
    const onFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    const view = renderClock(environment, hookProps(onFrame));

    act(() => environment.setPageHidden(true, 10));
    expect(environment.visibilityListenerCount).toBe(1);
    environment.setNow(20);
    view.rerender(hookProps(onFrame, { definitionOpen: true }));
    expect(environment.visibilityListenerCount).toBe(0);

    act(() => environment.setPageHidden(false, 100));
    expect(lastSample(onFrame).pauseReasons).toEqual([
      "definition-dialog",
      "page-hidden",
    ]);

    view.rerender(hookProps(onFrame));
    expect(lastSample(onFrame).pauseReasons).toEqual([]);
    expect(environment.visibilityListenerCount).toBe(1);
    expect(environment.pendingFrameCount).toBe(1);
  });

  it("gates on readiness and preserves a supplied checkpoint through loading", () => {
    const environment = new FakeAnimationClockEnvironment();
    const onFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    const view = renderClock(environment, hookProps(onFrame, {
      initialActiveElapsedMs: 400,
      ready: false,
    }));

    expect(lastSample(onFrame)).toMatchObject({
      activeElapsedMs: 400,
      ready: false,
      running: false,
    });
    expect(environment.pendingFrameCount).toBe(0);
    expect(environment.visibilityListenerCount).toBe(0);

    environment.setNow(100);
    view.rerender(hookProps(onFrame, { initialActiveElapsedMs: 999 }));
    act(() => environment.fireFrame(120));
    expect(lastSample(onFrame).activeElapsedMs).toBe(420);

    environment.setNow(130);
    view.rerender(hookProps(onFrame, {
      profileLoading: true,
      ready: false,
    }));
    expect(lastSample(onFrame).activeElapsedMs).toBe(430);

    environment.setNow(1_000);
    view.rerender(hookProps(onFrame, { profileLoading: true }));
    expect(environment.pendingFrameCount).toBe(0);
    environment.setNow(1_100);
    view.rerender(hookProps(onFrame));
    act(() => environment.fireFrame(1_110));
    expect(lastSample(onFrame).activeElapsedMs).toBe(440);
  });

  it("ignores stale and duplicate RAF timestamps while retaining one callback", () => {
    const environment = new FakeAnimationClockEnvironment();
    environment.setNow(100);
    const onFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    renderClock(environment, hookProps(onFrame));

    act(() => environment.fireFrame(130));
    expect(lastSample(onFrame).activeElapsedMs).toBe(30);
    act(() => environment.fireFrame(120));
    expect(lastSample(onFrame).activeElapsedMs).toBe(30);
    act(() => environment.fireFrame(130));
    expect(lastSample(onFrame).activeElapsedMs).toBe(30);
    act(() => environment.fireFrame(140));
    expect(lastSample(onFrame).activeElapsedMs).toBe(40);
    expect(environment.pendingFrameCount).toBe(1);
    expect(environment.maximumPendingFrames).toBe(1);
  });

  it("publishes reference part and inherited transforms in the same reduced-motion commit", () => {
    const environment = new FakeAnimationClockEnvironment();
    const rendered = vi.fn<(sample: ActiveTimeSample) => void>();
    const view = renderClock(environment, hookProps(rendered));

    act(() => environment.fireFrame(2_000));
    expect(sampleMotionAngle(
      REFERENCE_ROTATION_PROFILE,
      lastSample(rendered).transformElapsedMs,
    )).not.toBe(REFERENCE_ROTATION_PROFILE.referenceRadians);

    environment.setNow(2_000);
    view.rerender(hookProps(rendered, { reducedMotion: true }));
    const reduced = lastSample(rendered);
    expect(reduced.activeElapsedMs).toBe(2_000);
    expect(reduced.transformElapsedMs).toBe(0);
    expect(sampleMotionAngle(
      REFERENCE_ROTATION_PROFILE,
      reduced.transformElapsedMs,
    )).toBe(REFERENCE_ROTATION_PROFILE.referenceRadians);
    expect(sampleInheritedGlobalTransform(reduced.transformElapsedMs))
      .toMatchObject(INHERITED_GLOBAL_START);
  });

  it("uses the latest callback without restarting and ignores cancelled callbacks after unmount", () => {
    const environment = new FakeAnimationClockEnvironment();
    const firstFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    const secondFrame = vi.fn<(sample: ActiveTimeSample) => void>();
    const view = renderClock(environment, hookProps(firstFrame));
    const requestsBeforeCallbackRerender = environment.requestedFrameCount;
    const subscriptionsBeforeCallbackRerender = environment.visibilitySubscribeCount;

    view.rerender(hookProps(secondFrame));
    expect(environment.requestedFrameCount).toBe(requestsBeforeCallbackRerender);
    expect(environment.visibilitySubscribeCount).toBe(
      subscriptionsBeforeCallbackRerender,
    );
    act(() => environment.fireFrame(16));
    expect(firstFrame).toHaveBeenCalledTimes(1);
    expect(secondFrame).toHaveBeenCalledTimes(1);

    environment.setNow(20);
    view.unmount();
    expect(environment.pendingFrameCount).toBe(0);
    expect(environment.visibilityListenerCount).toBe(0);
    expect(environment.cancelledFrameHandles.length).toBeGreaterThan(0);
    expect(environment.visibilityUnsubscribeCount).toBe(
      environment.visibilitySubscribeCount,
    );

    const callsAfterUnmount = secondFrame.mock.calls.length;
    act(() => environment.invokeCancelledCallbacks(1_000));
    expect(secondFrame).toHaveBeenCalledTimes(callsAfterUnmount);
    expect(environment.pendingFrameCount).toBe(0);
  });
});
