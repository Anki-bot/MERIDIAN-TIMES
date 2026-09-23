"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  createActiveTimeState,
  deriveActiveTimePauseReasons,
  isActiveTimeRunning,
  sampleActiveTime,
  transitionActiveTime,
  type ActiveTimeConditions,
  type ActiveTimeSample,
  type ActiveTimeState,
} from "@/lib/watch-2-5d/active-time";

export interface AnimationClockEnvironment {
  readonly now: () => number;
  readonly requestAnimationFrame: (
    callback: (timestampMs: number) => void,
  ) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  readonly isPageHidden: () => boolean;
  readonly subscribeToVisibilityChange: (
    listener: () => void,
  ) => () => void;
}

export interface UseAnimationClockOptions {
  readonly ready: boolean;
  readonly reducedMotion: boolean;
  readonly definitionOpen: boolean;
  readonly profileLoading: boolean;
  readonly unsupported: boolean;
  readonly error: boolean;
  readonly initialActiveElapsedMs?: number;
  readonly onFrame: (sample: ActiveTimeSample) => void;
  /** A stable adapter may be supplied by deterministic tests. */
  readonly environment?: AnimationClockEnvironment;
}

export interface AnimationClockHandle {
  readonly getSnapshot: () => ActiveTimeSample;
}

const BROWSER_ANIMATION_CLOCK_ENVIRONMENT: AnimationClockEnvironment =
  Object.freeze({
    cancelAnimationFrame: (handle: number) => window.cancelAnimationFrame(handle),
    isPageHidden: () => document.visibilityState === "hidden",
    now: () => window.performance.now(),
    requestAnimationFrame: (callback: (timestampMs: number) => void) => (
      window.requestAnimationFrame(callback)
    ),
    subscribeToVisibilityChange: (listener: () => void) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  });

function clockConditions(
  options: Pick<
    UseAnimationClockOptions,
    | "ready"
    | "reducedMotion"
    | "definitionOpen"
    | "profileLoading"
    | "unsupported"
    | "error"
  >,
  pageHidden: boolean,
): ActiveTimeConditions {
  return {
    definitionOpen: options.definitionOpen,
    error: options.error,
    pageHidden,
    profileLoading: options.profileLoading,
    ready: options.ready,
    reducedMotion: options.reducedMotion,
    unsupported: options.unsupported,
  };
}

/**
 * Owns one group animation clock without causing React renders per frame.
 * Transform work remains in `onFrame`; callers can synchronously checkpoint
 * the pure model through the stable returned handle.
 */
export function useAnimationClock({
  ready,
  reducedMotion,
  definitionOpen,
  profileLoading,
  unsupported,
  error,
  initialActiveElapsedMs = 0,
  onFrame,
  environment = BROWSER_ANIMATION_CLOCK_ENVIRONMENT,
}: UseAnimationClockOptions): AnimationClockHandle {
  const stateRef = useRef<ActiveTimeState>(
    createActiveTimeState(initialActiveElapsedMs),
  );
  const onFrameRef = useRef(onFrame);

  useLayoutEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const getSnapshot = useCallback(
    () => sampleActiveTime(stateRef.current),
    [],
  );
  const handle = useMemo<AnimationClockHandle>(
    () => ({ getSnapshot }),
    [getSnapshot],
  );

  useLayoutEffect(() => {
    let disposed = false;
    let frameHandle: number | null = null;
    let frameGeneration = 0;
    let pageHidden = environment.isPageHidden();
    let removeVisibilityListener: (() => void) | null = null;

    const optionConditions = {
      definitionOpen,
      error,
      profileLoading,
      ready,
      reducedMotion,
      unsupported,
    } as const;

    function cancelScheduledFrame(): void {
      frameGeneration += 1;
      if (frameHandle !== null) {
        environment.cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
    }

    function emitCurrentSample(): void {
      onFrameRef.current(sampleActiveTime(stateRef.current));
    }

    function scheduleFrame(): void {
      if (
        disposed
        || frameHandle !== null
        || !isActiveTimeRunning(stateRef.current)
      ) {
        return;
      }

      const generation = ++frameGeneration;
      frameHandle = environment.requestAnimationFrame((timestampMs) => {
        if (disposed || generation !== frameGeneration) return;
        frameHandle = null;
        stateRef.current = transitionActiveTime(stateRef.current, {
          timestampMs,
          type: "frame",
        });
        emitCurrentSample();
        scheduleFrame();
      });
    }

    function synchronize(timestampMs: number): void {
      cancelScheduledFrame();
      stateRef.current = transitionActiveTime(stateRef.current, {
        conditions: clockConditions(optionConditions, pageHidden),
        timestampMs,
        type: "conditions-changed",
      });
      emitCurrentSample();
      scheduleFrame();
    }

    synchronize(environment.now());

    const nonVisibilityReasons = deriveActiveTimePauseReasons(
      clockConditions(optionConditions, false),
    );
    if (ready && nonVisibilityReasons.length === 0) {
      removeVisibilityListener = environment.subscribeToVisibilityChange(() => {
        pageHidden = environment.isPageHidden();
        synchronize(environment.now());
      });
    }

    return () => {
      disposed = true;
      cancelScheduledFrame();
      removeVisibilityListener?.();
      removeVisibilityListener = null;
      stateRef.current = transitionActiveTime(stateRef.current, {
        conditions: {
          ...clockConditions(optionConditions, pageHidden),
          ready: false,
        },
        timestampMs: environment.now(),
        type: "conditions-changed",
      });
    };
  }, [
    definitionOpen,
    environment,
    error,
    profileLoading,
    ready,
    reducedMotion,
    unsupported,
  ]);

  return handle;
}
