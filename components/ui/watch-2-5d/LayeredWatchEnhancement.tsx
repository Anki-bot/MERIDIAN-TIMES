"use client";

import type { CSSProperties, ComponentType } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import compiledReleasePointer from "@/data/watch-layer-release.json";
import {
  LayeredWatchLayer,
  WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY,
} from "./LayeredWatchLayer";
import {
  useAnimationClock,
  type AnimationClockEnvironment,
} from "./useAnimationClock";
import type { ActiveTimeSample } from "@/lib/watch-2-5d/active-time";
import { classifyBrowserSupport } from "@/lib/watch-2-5d/browser-support";
import {
  PROFILE_ENCODING_SCALES,
  createCanonicalCoverTransform,
  type CanonicalCoverTransform,
} from "@/lib/watch-2-5d/cover-transform";
import {
  IDENTITY_MATRIX_2D,
  canonicalCoverTransformToMatrix,
  sampleApprovedLayerMotion,
  sampleInheritedGlobalMatrix,
} from "@/lib/watch-2-5d/motion";
import {
  RuntimeLoaderCancelledError,
  RuntimeLoaderError,
  startRuntimeProfileLoad,
  type RuntimeProfileLoad,
  type RuntimeProfileLoadInput,
} from "@/lib/watch-2-5d/runtime-loader";
import { parseWatchLayerRelease } from "@/lib/watch-2-5d/runtime-schema";
import {
  createEnhancementState,
  getEnhancementDiagnosticCode,
  transitionEnhancementState,
  type EnhancementState,
} from "@/lib/watch-2-5d/runtime-state";
import type {
  BrowserSupportResult,
  PreparedAsset,
  PreparedProfile,
  ProfileId,
  ReadonlyMatrix2D,
  ReadyWatchLayerRelease,
  RuntimeFailureCode,
  WatchLayerRelease,
} from "@/lib/watch-2-5d/types";

export type LayeredWatchFallbackState = "loading" | "ready" | "error";

/** The complete facade-facing contract intended for WatchImageBackdrop in Task 10.3. */
export interface LayeredWatchEnhancementProps {
  readonly definitionOpen: boolean;
  readonly fallbackState: LayeredWatchFallbackState;
  readonly reducedMotion: boolean;
}

export interface LayeredWatchViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface LayeredWatchResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

/**
 * Factory-only injection boundary for deterministic component tests. The exported
 * production component below always uses the secure browser defaults.
 */
export interface LayeredWatchEnhancementDependencies {
  readonly release: unknown;
  readonly classifySupport: () => BrowserSupportResult;
  readonly startProfileLoad: (
    input: RuntimeProfileLoadInput,
  ) => RuntimeProfileLoad;
  readonly createResizeObserver: (
    listener: (size: LayeredWatchViewportSize) => void,
  ) => LayeredWatchResizeObserver;
  readonly readViewport: (target: Element) => LayeredWatchViewportSize;
  readonly decodeMountedImage: (image: HTMLImageElement) => Promise<void>;
  readonly animationClockEnvironment?: AnimationClockEnvironment;
  /** Test-only commit probe; omitted by the production dependency set. */
  readonly onControllerCommit?: () => void;
}

export type LayeredWatchEnhancementDependencyOverrides = Partial<
  LayeredWatchEnhancementDependencies
>;

interface BootstrapSnapshot {
  readonly kind: "bootstrap";
  readonly generation: 0;
}

interface BootstrapErrorSnapshot {
  readonly kind: "bootstrap-error";
  readonly generation: 0;
  readonly code: "runtime-invariant";
}

interface RuntimeSnapshot {
  readonly activated: boolean;
  readonly kind: "runtime";
  readonly generation: number;
  readonly state: EnhancementState;
}

type ControllerSnapshot =
  | BootstrapSnapshot
  | BootstrapErrorSnapshot
  | RuntimeSnapshot;

type LoadMode = "initial" | "profile-switch";
type MountFailureCode = "asset-decode" | "asset-dimensions" | "runtime-invariant";

interface LayerElementEntry {
  readonly asset: PreparedAsset;
  readonly image: HTMLImageElement;
}

interface MountRequest {
  readonly generation: number;
  readonly mode: LoadMode;
  readonly prepared: PreparedProfile;
}

const COMPACT_MAX_WIDTH_CSS_PIXELS = 700;
const NO_DIAGNOSTIC = "none";
const NO_PROFILE = "none";
const INITIAL_SAMPLE: ActiveTimeSample = Object.freeze({
  activeElapsedMs: 0,
  pauseReasons: Object.freeze([]),
  ready: false,
  referencePhase: false,
  running: false,
  transformElapsedMs: 0,
});
const BOOTSTRAP_SNAPSHOT: BootstrapSnapshot = Object.freeze({
  generation: 0,
  kind: "bootstrap",
});

const ROOT_STYLE_BASE = Object.freeze({
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
  position: "absolute",
  zIndex: 3,
}) satisfies CSSProperties;

const GROUP_STYLE_BASE = Object.freeze({
  left: 0,
  pointerEvents: "none",
  position: "absolute",
  top: 0,
  transformOrigin: "0 0",
}) satisfies CSSProperties;

class MountedProfileVerificationError extends Error {
  readonly code: MountFailureCode;

  constructor(code: MountFailureCode) {
    super(`Mounted watch profile verification failed (${code})`);
    this.name = "MountedProfileVerificationError";
    this.code = code;
  }
}

function defaultCreateResizeObserver(
  listener: (size: LayeredWatchViewportSize) => void,
): LayeredWatchResizeObserver {
  const observer = new ResizeObserver((entries) => {
    const entry = entries.at(-1);
    if (entry === undefined) return;
    listener(Object.freeze({
      height: entry.contentRect.height,
      width: entry.contentRect.width,
    }));
  });
  return observer;
}

function defaultReadViewport(target: Element): LayeredWatchViewportSize {
  const rect = target.getBoundingClientRect();
  return Object.freeze({ height: rect.height, width: rect.width });
}

function defaultDecodeMountedImage(image: HTMLImageElement): Promise<void> {
  return image.decode();
}

const DEFAULT_DEPENDENCIES: LayeredWatchEnhancementDependencies = Object.freeze({
  classifySupport: classifyBrowserSupport,
  createResizeObserver: defaultCreateResizeObserver,
  decodeMountedImage: defaultDecodeMountedImage,
  readViewport: defaultReadViewport,
  release: compiledReleasePointer,
  startProfileLoad: (input: RuntimeProfileLoadInput) => startRuntimeProfileLoad(input),
});

function resolveDependencies(
  overrides: LayeredWatchEnhancementDependencyOverrides,
): LayeredWatchEnhancementDependencies {
  return Object.freeze({
    animationClockEnvironment: overrides.animationClockEnvironment,
    classifySupport: overrides.classifySupport ?? DEFAULT_DEPENDENCIES.classifySupport,
    createResizeObserver:
      overrides.createResizeObserver ?? DEFAULT_DEPENDENCIES.createResizeObserver,
    decodeMountedImage:
      overrides.decodeMountedImage ?? DEFAULT_DEPENDENCIES.decodeMountedImage,
    onControllerCommit: overrides.onControllerCommit,
    readViewport: overrides.readViewport ?? DEFAULT_DEPENDENCIES.readViewport,
    release: Object.prototype.hasOwnProperty.call(overrides, "release")
      ? overrides.release
      : DEFAULT_DEPENDENCIES.release,
    startProfileLoad:
      overrides.startProfileLoad ?? DEFAULT_DEPENDENCIES.startProfileLoad,
  });
}

function cssNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

function matrixCssValue(matrix: ReadonlyMatrix2D): string {
  return `matrix(${[
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e,
    matrix.f,
  ].map(cssNumber).join(", ")})`;
}

function profileForWidth(width: number): ProfileId {
  return width <= COMPACT_MAX_WIDTH_CSS_PIXELS ? "compact" : "expanded";
}

function profileForState(state: EnhancementState): ProfileId | null {
  switch (state.kind) {
    case "loading-manifest":
    case "loading-assets":
    case "mounting-hidden":
    case "profile-switch-loading":
      return state.targetProfile;
    case "ready":
      return state.prepared.id;
    case "fallback-only":
    case "unsupported":
    case "error":
      return null;
  }
}

function preparedForState(state: EnhancementState | null): PreparedProfile | null {
  if (state === null) return null;
  if (state.kind === "mounting-hidden" || state.kind === "ready") {
    return state.prepared;
  }
  if (state.kind === "profile-switch-loading" && state.stage === "mounting-hidden") {
    return state.prepared;
  }
  return null;
}

function mountRequestForSnapshot(snapshot: ControllerSnapshot): MountRequest | null {
  if (snapshot.kind !== "runtime") return null;
  if (snapshot.state.kind === "mounting-hidden") {
    return Object.freeze({
      generation: snapshot.generation,
      mode: "initial",
      prepared: snapshot.state.prepared,
    });
  }
  if (
    snapshot.state.kind === "profile-switch-loading"
    && snapshot.state.stage === "mounting-hidden"
  ) {
    return Object.freeze({
      generation: snapshot.generation,
      mode: "profile-switch",
      prepared: snapshot.state.prepared,
    });
  }
  return null;
}

function isProfileLoading(state: EnhancementState | null): boolean {
  if (state === null || state.terminal) return false;
  return state.kind !== "ready";
}

function localizeCanonicalTransform(
  matrix: ReadonlyMatrix2D,
  asset: PreparedAsset,
): ReadonlyMatrix2D {
  const { x, y } = asset.record.sourceRect;
  return Object.freeze({
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.a * x + matrix.c * y + matrix.e - x,
    f: matrix.b * x + matrix.d * y + matrix.f - y,
  });
}

function mapLoadFailure(error: unknown, mode: LoadMode): RuntimeFailureCode | null {
  if (error instanceof RuntimeLoaderCancelledError) return null;
  if (mode === "profile-switch") return "profile-switch";
  return error instanceof RuntimeLoaderError ? error.code : "runtime-invariant";
}

function stateAfterFailure(
  state: EnhancementState,
  code: RuntimeFailureCode,
): EnhancementState {
  return transitionEnhancementState(state, { code, type: "failure" }).state;
}

function controllerStateName(snapshot: ControllerSnapshot): string {
  if (snapshot.kind === "bootstrap") return "fallback-only";
  if (snapshot.kind === "bootstrap-error") return "error";
  return snapshot.state.kind;
}

function controllerDiagnostic(snapshot: ControllerSnapshot): string {
  if (snapshot.kind === "bootstrap-error") return snapshot.code;
  if (snapshot.kind === "runtime") {
    return getEnhancementDiagnosticCode(snapshot.state) ?? NO_DIAGNOSTIC;
  }
  return NO_DIAGNOSTIC;
}

function mountFailureCode(error: unknown): MountFailureCode {
  return error instanceof MountedProfileVerificationError
    ? error.code
    : "asset-decode";
}

/**
 * Creates a controller bound to an explicit runtime environment. Application
 * code should use LayeredWatchEnhancement, not this deterministic test seam.
 */
export function createLayeredWatchEnhancementController(
  overrides: LayeredWatchEnhancementDependencyOverrides = {},
): ComponentType<LayeredWatchEnhancementProps> {
  const dependencies = resolveDependencies(overrides);

  function LayeredWatchEnhancementController({
    definitionOpen,
    fallbackState,
    reducedMotion,
  }: LayeredWatchEnhancementProps) {
    const [snapshot, setSnapshot] = useState<ControllerSnapshot>(BOOTSTRAP_SNAPSHOT);
    const snapshotRef = useRef<ControllerSnapshot>(BOOTSTRAP_SNAPSHOT);
    const mountedRef = useRef(false);
    const generationCounterRef = useRef(0);
    const startedLoadGenerationRef = useRef<number | null>(null);
    const activeLoadRef = useRef<RuntimeProfileLoad | null>(null);
    const resizeObserverRef = useRef<LayeredWatchResizeObserver | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const globalGroupRef = useRef<HTMLDivElement | null>(null);
    const coverGroupRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<LayeredWatchViewportSize | null>(null);
    const coverTransformRef = useRef<CanonicalCoverTransform | null>(null);
    const preparedRef = useRef<PreparedProfile | null>(null);
    const layerElementsRef = useRef<readonly LayerElementEntry[]>(Object.freeze([]));
    const lastSampleRef = useRef<ActiveTimeSample>(INITIAL_SAMPLE);
    const frameFailureScheduledRef = useRef(false);

    const runtimeState = snapshot.kind === "runtime" ? snapshot.state : null;
    const prepared = preparedForState(runtimeState);
    const previouslyActivated = snapshot.kind === "runtime" && snapshot.activated;
    const enhancementVisible = runtimeState?.kind === "ready"
      && fallbackState === "ready"
      && (!reducedMotion || previouslyActivated);
    const unsupported = runtimeState?.kind === "unsupported";
    const error = snapshot.kind === "bootstrap-error" || runtimeState?.kind === "error";
    const profileLoading = isProfileLoading(runtimeState);

    useLayoutEffect(() => {
      dependencies.onControllerCommit?.();
    });

    const publish = useCallback((next: ControllerSnapshot): void => {
      snapshotRef.current = next;
      if (mountedRef.current) setSnapshot(next);
    }, []);

    const publishRuntimeState = useCallback((
      state: EnhancementState,
      generation: number,
    ): void => {
      const current = snapshotRef.current;
      const activated = current.kind === "runtime" && current.activated;
      publish(Object.freeze({ activated, generation, kind: "runtime", state }));
    }, [publish]);

    useLayoutEffect(() => {
      if (!enhancementVisible) return;
      const current = snapshotRef.current;
      if (current.kind !== "runtime" || current.activated) return;
      publish(Object.freeze({ ...current, activated: true }));
    }, [enhancementVisible, publish]);

    const publishFailure = useCallback((
      code: RuntimeFailureCode,
      collapseProfileSwitch = false,
    ): void => {
      const current = snapshotRef.current;
      if (current.kind === "bootstrap") {
        publish(Object.freeze({
          code: "runtime-invariant",
          generation: 0,
          kind: "bootstrap-error",
        }));
        return;
      }
      if (current.kind !== "runtime" || current.state.terminal) return;
      const failureCode = collapseProfileSwitch
        && current.state.kind === "profile-switch-loading"
        ? "profile-switch"
        : code;
      publishRuntimeState(
        stateAfterFailure(current.state, failureCode),
        current.generation,
      );
    }, [publish, publishRuntimeState]);

    const scheduleFrameFailure = useCallback((): void => {
      if (frameFailureScheduledRef.current) return;
      frameFailureScheduledRef.current = true;
      queueMicrotask(() => {
        frameFailureScheduledRef.current = false;
        if (mountedRef.current) publishFailure("runtime-invariant");
      });
    }, [publishFailure]);

    const renderFrame = useCallback((sample: ActiveTimeSample): void => {
      lastSampleRef.current = sample;
      const viewport = viewportRef.current;
      try {
        if (viewport !== null && globalGroupRef.current !== null) {
          globalGroupRef.current.style.transform = matrixCssValue(
            sampleInheritedGlobalMatrix(
              sample.transformElapsedMs,
              viewport.width,
              viewport.height,
            ),
          );
        }

        const currentPrepared = preparedRef.current;
        if (currentPrepared === null) return;
        const entries = layerElementsRef.current;
        if (entries.length !== currentPrepared.assets.length) {
          throw new MountedProfileVerificationError("runtime-invariant");
        }

        for (const entry of entries) {
          const part = sampleApprovedLayerMotion(
            currentPrepared.manifest,
            entry.asset.record.layerId,
            sample.transformElapsedMs,
          );
          const local = localizeCanonicalTransform(part, entry.asset);
          entry.image.style.setProperty(
            WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY,
            matrixCssValue(local),
          );
        }
      } catch {
        scheduleFrameFailure();
      }
    }, [scheduleFrameFailure]);

    useLayoutEffect(() => {
      preparedRef.current = prepared;
      if (prepared === null || rootRef.current === null) {
        layerElementsRef.current = Object.freeze([]);
        return;
      }

      const images = Array.from(
        rootRef.current.querySelectorAll<HTMLImageElement>("img.watch-layer-image"),
      );
      if (images.length !== prepared.assets.length) {
        layerElementsRef.current = Object.freeze([]);
        scheduleFrameFailure();
        return;
      }

      layerElementsRef.current = Object.freeze(images.map((image, index) => {
        image.style.position = "absolute";
        image.style.transform = `var(${WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY})`;
        image.style.transformOrigin = "0 0";
        image.style.willChange = "transform";
        return Object.freeze({ asset: prepared.assets[index], image });
      }));
      renderFrame(lastSampleRef.current);
    }, [prepared, renderFrame, scheduleFrameFailure]);

    const clock = useAnimationClock({
      definitionOpen,
      environment: dependencies.animationClockEnvironment,
      error,
      onFrame: renderFrame,
      profileLoading,
      ready: enhancementVisible,
      reducedMotion,
      unsupported,
    });

    const applyMapping = useCallback((
      size: LayeredWatchViewportSize,
      profile: ProfileId,
    ): boolean => {
      const result = createCanonicalCoverTransform({
        encodingScale: PROFILE_ENCODING_SCALES[profile],
        profile,
        viewportHeight: size.height,
        viewportWidth: size.width,
      });
      if (!result.ok) return false;

      viewportRef.current = Object.freeze({ height: size.height, width: size.width });
      coverTransformRef.current = result.value;
      const coverGroup = coverGroupRef.current;
      if (coverGroup !== null) {
        coverGroup.style.transform = matrixCssValue(
          canonicalCoverTransformToMatrix(result.value),
        );
      }
      const root = rootRef.current;
      if (root !== null) {
        root.style.setProperty("--watch-cover-scale", cssNumber(result.value.coverScale));
        root.style.setProperty("--watch-cover-offset-x", `${result.value.offsetX}px`);
        root.style.setProperty("--watch-cover-offset-y", `${result.value.offsetY}px`);
      }
      renderFrame(clock.getSnapshot());
      return true;
    }, [clock, renderFrame]);

    const handleResize = useCallback((size: LayeredWatchViewportSize): void => {
      const current = snapshotRef.current;
      if (current.kind !== "runtime" || current.state.terminal) return;
      const currentProfile = profileForState(current.state);
      if (currentProfile === null) return;
      const nextProfile = profileForWidth(size.width);

      if (!applyMapping(size, nextProfile)) {
        publishFailure("mapping-invalid");
        return;
      }
      if (nextProfile === currentProfile) return;

      const nextGeneration = generationCounterRef.current + 1;
      generationCounterRef.current = nextGeneration;
      if (current.state.kind === "ready") {
        const switched = transitionEnhancementState(current.state, {
          activeElapsedMs: clock.getSnapshot().activeElapsedMs,
          targetProfile: nextProfile,
          type: "profile-switch-started",
        });
        publishRuntimeState(switched.state, nextGeneration);
        return;
      }

      const restarted = createEnhancementState({
        profile: nextProfile,
        release: current.state.release,
        support: { supported: true },
      });
      publishRuntimeState(restarted, nextGeneration);
    }, [applyMapping, clock, publishFailure, publishRuntimeState]);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
        activeLoadRef.current?.dispose();
        activeLoadRef.current = null;
      };
    }, []);

    useEffect(() => {
      let localObserver: LayeredWatchResizeObserver | null = null;
      let release: WatchLayerRelease;
      let support: BrowserSupportResult;

      try {
        release = parseWatchLayerRelease(dependencies.release);
        support = dependencies.classifySupport();
      } catch {
        publish(Object.freeze({
          code: "runtime-invariant",
          generation: 0,
          kind: "bootstrap-error",
        }));
        return;
      }

      if (release.status === "fallback-only" || !support.supported) {
        generationCounterRef.current += 1;
        publishRuntimeState(createEnhancementState({
          profile: "compact",
          release,
          support,
        }), generationCounterRef.current);
        return;
      }

      const root = rootRef.current;
      const target = root?.parentElement ?? root;
      if (target === null) {
        publish(Object.freeze({
          code: "runtime-invariant",
          generation: 0,
          kind: "bootstrap-error",
        }));
        return;
      }

      let size: LayeredWatchViewportSize;
      try {
        size = dependencies.readViewport(target);
      } catch {
        size = Object.freeze({ height: Number.NaN, width: Number.NaN });
      }
      const profile = Number.isFinite(size.width)
        ? profileForWidth(size.width)
        : "compact";
      generationCounterRef.current += 1;
      const generation = generationCounterRef.current;
      let initialState = createEnhancementState({ profile, release, support });
      if (!applyMapping(size, profile)) {
        initialState = stateAfterFailure(initialState, "mapping-invalid");
        publishRuntimeState(initialState, generation);
        return;
      }
      publishRuntimeState(initialState, generation);

      try {
        localObserver = dependencies.createResizeObserver(handleResize);
        resizeObserverRef.current = localObserver;
        localObserver.observe(target);
      } catch {
        publishFailure("runtime-invariant");
      }

      return () => {
        localObserver?.disconnect();
        if (resizeObserverRef.current === localObserver) {
          resizeObserverRef.current = null;
        }
      };
    }, [
      applyMapping,
      handleResize,
      publish,
      publishFailure,
      publishRuntimeState,
    ]);

    const loadState = snapshot.kind === "runtime" ? snapshot.state : null;
    const loadGeneration = snapshot.kind === "runtime" ? snapshot.generation : null;
    const loadMode: LoadMode | null = loadState?.kind === "loading-manifest"
      ? "initial"
      : loadState?.kind === "profile-switch-loading"
          && loadState.stage === "loading-assets"
        ? "profile-switch"
        : null;
    const loadProfile = loadState === null ? null : profileForState(loadState);
    const loadRelease: ReadyWatchLayerRelease | null = loadState !== null
      && loadState.release.status === "ready"
      ? loadState.release
      : null;

    useEffect(() => {
      if (
        fallbackState !== "ready"
        || loadMode === null
        || loadGeneration === null
        || loadProfile === null
        || loadRelease === null
        || startedLoadGenerationRef.current === loadGeneration
      ) {
        return;
      }

      startedLoadGenerationRef.current = loadGeneration;
      activeLoadRef.current?.cancel("profile-change");

      let load: RuntimeProfileLoad;
      try {
        load = dependencies.startProfileLoad({
          profile: loadProfile,
          release: loadRelease,
        });
      } catch (loadError) {
        const code = mapLoadFailure(loadError, loadMode);
        if (code !== null) publishFailure(code, loadMode === "profile-switch");
        return;
      }
      activeLoadRef.current = load;

      void load.promise.then((loadedProfile) => {
        const current = snapshotRef.current;
        if (
          !mountedRef.current
          || current.kind !== "runtime"
          || current.generation !== loadGeneration
        ) {
          load.dispose();
          return;
        }

        let nextState = current.state;
        const expectedProfile = profileForState(nextState);
        if (loadedProfile.id !== expectedProfile) {
          nextState = stateAfterFailure(
            nextState,
            loadMode === "profile-switch" ? "profile-switch" : "runtime-invariant",
          );
          publishRuntimeState(nextState, loadGeneration);
          return;
        }

        if (loadMode === "initial" && nextState.kind === "loading-manifest") {
          nextState = transitionEnhancementState(nextState, {
            manifest: loadedProfile.manifest,
            type: "manifest-loaded",
          }).state;
        }

        for (const asset of loadedProfile.assets) {
          if (nextState.terminal) break;
          nextState = transitionEnhancementState(nextState, {
            asset,
            type: "asset-loaded",
          }).state;
        }

        const completeInitial = nextState.kind === "mounting-hidden";
        const completeSwitch = nextState.kind === "profile-switch-loading"
          && nextState.stage === "mounting-hidden";
        if (!nextState.terminal && !completeInitial && !completeSwitch) {
          nextState = stateAfterFailure(
            nextState,
            loadMode === "profile-switch" ? "profile-switch" : "runtime-invariant",
          );
        }
        publishRuntimeState(nextState, loadGeneration);
      }).catch((loadError: unknown) => {
        const current = snapshotRef.current;
        if (
          !mountedRef.current
          || current.kind !== "runtime"
          || current.generation !== loadGeneration
        ) {
          return;
        }
        const code = mapLoadFailure(loadError, loadMode);
        if (code !== null) publishFailure(code, loadMode === "profile-switch");
      });
    }, [
      fallbackState,
      loadGeneration,
      loadMode,
      loadProfile,
      loadRelease,
      publishFailure,
      publishRuntimeState,
    ]);

    const mountRequest = mountRequestForSnapshot(snapshot);
    useEffect(() => {
      if (mountRequest === null) return;
      let cancelled = false;

      const verify = async (): Promise<void> => {
        const entries = layerElementsRef.current;
        if (entries.length !== mountRequest.prepared.assets.length) {
          throw new MountedProfileVerificationError("runtime-invariant");
        }

        await Promise.all(entries.map(async ({ asset, image }) => {
          if (
            !image.isConnected
            || image.getAttribute("src") !== asset.objectUrl
            || image.getAttribute("aria-hidden") !== "true"
          ) {
            throw new MountedProfileVerificationError("runtime-invariant");
          }
          try {
            await dependencies.decodeMountedImage(image);
          } catch {
            throw new MountedProfileVerificationError("asset-decode");
          }
          if (
            !image.isConnected
            || image.getAttribute("src") !== asset.objectUrl
            || image.naturalWidth !== asset.record.intrinsicWidth
            || image.naturalHeight !== asset.record.intrinsicHeight
          ) {
            throw new MountedProfileVerificationError("asset-dimensions");
          }
        }));

        if (cancelled || !mountedRef.current) return;
        const current = snapshotRef.current;
        if (
          current.kind !== "runtime"
          || current.generation !== mountRequest.generation
        ) {
          return;
        }
        const completed = transitionEnhancementState(current.state, {
          profile: mountRequest.prepared.id,
          type: "mount-complete",
        });
        publishRuntimeState(completed.state, current.generation);
      };

      void verify().catch((verificationError: unknown) => {
        if (cancelled || !mountedRef.current) return;
        const code = mountFailureCode(verificationError);
        publishFailure(
          mountRequest.mode === "profile-switch" ? "profile-switch" : code,
          mountRequest.mode === "profile-switch",
        );
      });

      return () => {
        cancelled = true;
      };
    }, [mountRequest, publishFailure, publishRuntimeState]);

    useEffect(() => {
      if (!error && fallbackState !== "error") return;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      activeLoadRef.current?.dispose();
      activeLoadRef.current = null;
    }, [error, fallbackState]);

    const profile = runtimeState === null ? null : profileForState(runtimeState);
    const stage = runtimeState?.kind === "profile-switch-loading"
      ? runtimeState.stage
      : runtimeState?.kind ?? "fallback-only";
    const rootStyle: CSSProperties = {
      ...ROOT_STYLE_BASE,
      height: "100%",
      opacity: definitionOpen ? 0.72 : 1,
      visibility: enhancementVisible ? "visible" : "hidden",
      width: "100%",
    };

    return (
      <div
        ref={rootRef}
        className="watch-layer-enhancement"
        aria-hidden="true"
        data-watch-enhancement-state={controllerStateName(snapshot)}
        data-watch-enhancement-stage={stage}
        data-watch-enhancement-diagnostic={controllerDiagnostic(snapshot)}
        data-watch-enhancement-profile={profile ?? NO_PROFILE}
        data-watch-enhancement-visible={String(enhancementVisible)}
        data-watch-fallback-visible={String(!enhancementVisible)}
        data-watch-depth="disabled"
        data-watch-definition-open={String(definitionOpen)}
        data-watch-reduced-motion={String(reducedMotion)}
        style={rootStyle}
      >
        <div
          ref={globalGroupRef}
          className="watch-layer-global-group"
          aria-hidden="true"
          style={{
            ...GROUP_STYLE_BASE,
            height: "100%",
            transform: matrixCssValue(IDENTITY_MATRIX_2D),
            width: "100%",
          }}
        >
          <div
            ref={coverGroupRef}
            className="watch-layer-cover-group"
            aria-hidden="true"
            style={{
              ...GROUP_STYLE_BASE,
              height: "1504px",
              transform: matrixCssValue(IDENTITY_MATRIX_2D),
              width: "2760px",
            }}
          >
            {prepared?.assets.map((asset) => (
              <LayeredWatchLayer
                key={String(asset.record.id)}
                asset={asset}
                relativeTransform={IDENTITY_MATRIX_2D}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  LayeredWatchEnhancementController.displayName = "LayeredWatchEnhancementController";
  return LayeredWatchEnhancementController;
}

const ProductionLayeredWatchEnhancement = createLayeredWatchEnhancementController();

/** Secure production controller consumed by the unchanged facade in Task 10.3. */
export function LayeredWatchEnhancement(props: LayeredWatchEnhancementProps) {
  return <ProductionLayeredWatchEnhancement {...props} />;
}
