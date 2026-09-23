import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  createLayeredWatchEnhancementController,
  type LayeredWatchEnhancementDependencies,
  type LayeredWatchEnhancementProps,
  type LayeredWatchResizeObserver,
  type LayeredWatchViewportSize,
} from "@/components/ui/watch-2-5d/LayeredWatchEnhancement";
import { WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY } from "@/components/ui/watch-2-5d/LayeredWatchLayer";
import type { AnimationClockEnvironment } from "@/components/ui/watch-2-5d/useAnimationClock";
import {
  FULL_ROTATION_RADIANS,
  IDENTITY_MATRIX_2D,
} from "@/lib/watch-2-5d/motion";
import {
  RuntimeLoaderCancelledError,
  RuntimeLoaderError,
  type RuntimeLoaderCancellationReason,
  type RuntimeProfileLoad,
  type RuntimeProfileLoadInput,
} from "@/lib/watch-2-5d/runtime-loader";
import {
  CANONICAL_MASTER_SHA256,
  type ApprovalId,
  type AssetId,
  type BrowserSupportResult,
  type DepthProfile,
  type EnhancementProfile,
  type LayerId,
  type MotionProfileId,
  type PackageId,
  type PreparedAsset,
  type PreparedProfile,
  type ProfileId,
  type PublicAssetRecord,
  type ReadyWatchLayerRelease,
  type ReleaseId,
  type Sha256,
  type ValidatedRuntimeManifest,
  type WatchLayerRelease,
} from "@/lib/watch-2-5d/types";

const COMPONENT_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "components/ui/watch-2-5d/LayeredWatchEnhancement.tsx",
  ),
  "utf8",
);

const READY_RELEASE = Object.freeze({
  depthEnabled: false,
  packageId: "watch-layer-package-v1" as PackageId,
  releaseId: "watch-layer-release-v1" as ReleaseId,
  runtimeManifest: Object.freeze({
    byteLength: 2_048,
    mediaType: "application/json" as const,
    publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json" as const,
    sha256: "f".repeat(64) as Sha256,
  }),
  schemaVersion: 1 as const,
  status: "ready" as const,
}) satisfies ReadyWatchLayerRelease;

const DEPTH_OPTED_IN_RELEASE = Object.freeze({
  ...READY_RELEASE,
  depthEnabled: true,
}) satisfies ReadyWatchLayerRelease;

const FALLBACK_RELEASE = Object.freeze({
  depthEnabled: false,
  runtimeManifest: null,
  schemaVersion: 1 as const,
  status: "fallback-only" as const,
}) satisfies WatchLayerRelease;

const MOVING_LAYER_ID = "upper-wheel" as LayerId;

type FrameCallback = (timestampMs: number) => void;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: () => boolean;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  let isSettled = false;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return Object.freeze({
    promise,
    reject: (error: unknown) => {
      if (isSettled) return;
      isSettled = true;
      rejectPromise(error);
    },
    resolve: (value: T) => {
      if (isSettled) return;
      isSettled = true;
      resolvePromise(value);
    },
    settled: () => isSettled,
  });
}

function assetRecord<P extends ProfileId>(
  profile: P,
  index: 0 | 1,
): PublicAssetRecord<P> {
  const background = index === 0;
  const sourceRect = background
    ? Object.freeze({ height: 1_504, width: 2_760, x: 0, y: 0 })
    : Object.freeze({ height: 120, width: 240, x: 900, y: 500 });
  const scale = profile === "compact" ? 0.5 : 1;
  const intrinsicWidth = sourceRect.width * scale;
  const intrinsicHeight = sourceRect.height * scale;
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  const name = background ? "reconstructed-background" : "upper-wheel";

  return Object.freeze({
    byteLength: background ? 1_000 : 400,
    colorMetadata: Object.freeze({
      alpha: true,
      channels: 4,
      colourspace: "srgb",
    }),
    decodedPixelCount,
    decodedRgbaByteLength: decodedPixelCount * 4,
    encoder: Object.freeze({
      alphaQuality: 100,
      channels: 4,
      colourspace: "srgb",
      effort: 6,
      nearLossless: false,
      quality: 95,
      smartSubsample: true,
    }),
    file: `public/assets/watch-2-5d/v1/${profile}/${name}.webp`,
    id: `${profile}-${name}` as AssetId,
    intrinsicHeight,
    intrinsicWidth,
    layerId: background ? "reconstructed-background" : MOVING_LAYER_ID,
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile,
    publicPath: `/assets/watch-2-5d/v1/${profile}/${name}.webp`,
    sha256: `${profile === "compact" ? "1" : "2"}${index}`
      .padEnd(64, "a") as Sha256,
    sourceRect,
    zOrder: index,
  }) as PublicAssetRecord<P>;
}

function enhancementProfile<P extends ProfileId>(
  profile: P,
): EnhancementProfile<P> {
  const assets = Object.freeze([
    assetRecord(profile, 0),
    assetRecord(profile, 1),
  ]);
  return Object.freeze({
    assets,
    decodedRgbaBytes: assets.reduce(
      (total, asset) => total + asset.decodedRgbaByteLength,
      0,
    ),
    id: profile,
    requestCountIncludingManifest: assets.length + 1,
    sourceScale: profile === "compact" ? 0.5 : 1,
    transferBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
  }) as EnhancementProfile<P>;
}

function runtimeManifest(
  release: ReadyWatchLayerRelease = READY_RELEASE,
  depthProfiles: readonly DepthProfile[] = Object.freeze([]),
): ValidatedRuntimeManifest {
  return Object.freeze({
    canonicalMasterSha256: CANONICAL_MASTER_SHA256,
    depthProfiles,
    motionProfiles: Object.freeze([Object.freeze({
      approvalId: "motion-approval" as ApprovalId,
      direction: 1 as const,
      evidence: "authored-assumption" as const,
      id: "upper-wheel-motion" as MotionProfileId,
      kind: "continuous-rotation" as const,
      layerId: MOVING_LAYER_ID,
      maxRadians: FULL_ROTATION_RADIANS,
      minRadians: -FULL_ROTATION_RADIANS,
      periodMs: 1_000,
      phaseRadians: 0,
      pivot: Object.freeze({ x: 1_020, y: 560 }),
      referenceRadians: 0,
    })]),
    packageId: release.packageId,
    phase: release.depthEnabled
      ? "optional-depth" as const
      : "approved-part-motion" as const,
    profiles: Object.freeze({
      compact: enhancementProfile("compact"),
      expanded: enhancementProfile("expanded"),
    }),
    releaseId: release.releaseId,
    schemaVersion: 1 as const,
  }) as unknown as ValidatedRuntimeManifest;
}

const MANIFEST = runtimeManifest();

function setNaturalDimensions(
  image: HTMLImageElement,
  width: number,
  height: number,
): void {
  Object.defineProperties(image, {
    naturalHeight: { configurable: true, value: height },
    naturalWidth: { configurable: true, value: width },
  });
}

function preparedProfile(
  profile: ProfileId,
  options: Readonly<{
    reverseAssets?: boolean;
    release?: ReadyWatchLayerRelease;
    manifest?: ValidatedRuntimeManifest;
  }> = {},
): PreparedProfile {
  const release = options.release ?? READY_RELEASE;
  const manifest = options.manifest ?? MANIFEST;
  const records = [...manifest.profiles[profile].assets];
  if (options.reverseAssets) records.reverse();
  const assets = Object.freeze(records.map((record) => {
    const image = document.createElement("img");
    setNaturalDimensions(image, record.intrinsicWidth, record.intrinsicHeight);
    const objectUrl = `blob:https://elite-watches.test/${record.id}`;
    image.src = objectUrl;
    return Object.freeze({ image, objectUrl, record }) as PreparedAsset;
  }));
  return Object.freeze({
    assets,
    id: profile,
    manifest,
    profile: manifest.profiles[profile],
    release,
  }) as PreparedProfile;
}

class FakeProfileLoad implements RuntimeProfileLoad {
  private readonly gate = deferred<PreparedProfile>();
  readonly cancelCalls: RuntimeLoaderCancellationReason[] = [];
  disposeCount = 0;

  readonly promise = this.gate.promise;

  cancel(reason: RuntimeLoaderCancellationReason = "unmount"): void {
    this.cancelCalls.push(reason);
    if (!this.gate.settled()) {
      this.gate.reject(new RuntimeLoaderCancelledError(reason));
    }
  }

  dispose(): void {
    this.disposeCount += 1;
    this.cancel("unmount");
  }

  resolve(profile: PreparedProfile): void {
    this.gate.resolve(profile);
  }

  reject(error: unknown): void {
    this.gate.reject(error);
  }
}

class FakeProfileLoader {
  readonly inputs: RuntimeProfileLoadInput[] = [];
  readonly loads: FakeProfileLoad[] = [];

  readonly start = (input: RuntimeProfileLoadInput): RuntimeProfileLoad => {
    const load = new FakeProfileLoad();
    this.inputs.push(input);
    this.loads.push(load);
    return load;
  };
}

class FakeResizeHarness {
  private readonly observers = new Set<{
    readonly listener: (size: LayeredWatchViewportSize) => void;
    active: boolean;
  }>();

  size: LayeredWatchViewportSize;
  observeCount = 0;
  disconnectCount = 0;

  constructor(width = 700, height = 500) {
    this.size = Object.freeze({ height, width });
  }

  readonly readViewport = (): LayeredWatchViewportSize => this.size;

  readonly createObserver = (
    listener: (size: LayeredWatchViewportSize) => void,
  ): LayeredWatchResizeObserver => {
    const record = { active: true, listener };
    this.observers.add(record);
    return {
      disconnect: () => {
        if (!record.active) return;
        record.active = false;
        this.disconnectCount += 1;
      },
      observe: () => {
        this.observeCount += 1;
      },
    };
  };

  emit(width: number, height: number): void {
    this.size = Object.freeze({ height, width });
    for (const observer of this.observers) {
      if (observer.active) observer.listener(this.size);
    }
  }

  get activeObserverCount(): number {
    return [...this.observers].filter(({ active }) => active).length;
  }
}

class FakeAnimationClock implements AnimationClockEnvironment {
  private readonly callbacks = new Map<number, FrameCallback>();
  private readonly visibilityListeners = new Set<() => void>();
  private nextHandle = 1;
  private nowMs = 0;
  private pageHidden = false;

  maximumPendingFrames = 0;
  requestedFrames = 0;
  cancelledFrames = 0;
  visibilitySubscriptions = 0;
  visibilityUnsubscriptions = 0;

  readonly now = (): number => this.nowMs;

  readonly requestAnimationFrame = (callback: FrameCallback): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.requestedFrames += 1;
    this.callbacks.set(handle, callback);
    this.maximumPendingFrames = Math.max(
      this.maximumPendingFrames,
      this.callbacks.size,
    );
    return handle;
  };

  readonly cancelAnimationFrame = (handle: number): void => {
    if (this.callbacks.delete(handle)) this.cancelledFrames += 1;
  };

  readonly isPageHidden = (): boolean => this.pageHidden;

  readonly subscribeToVisibilityChange = (
    listener: () => void,
  ): (() => void) => {
    this.visibilitySubscriptions += 1;
    this.visibilityListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.visibilityListeners.delete(listener);
      this.visibilityUnsubscriptions += 1;
    };
  };

  setNow(timestampMs: number): void {
    this.nowMs = timestampMs;
  }

  fireFrame(timestampMs: number): void {
    const entry = this.callbacks.entries().next().value as
      | [number, FrameCallback]
      | undefined;
    if (entry === undefined) throw new Error("Expected one pending frame.");
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    this.nowMs = timestampMs;
    callback(timestampMs);
  }

  setHidden(hidden: boolean, timestampMs: number): void {
    this.pageHidden = hidden;
    this.nowMs = timestampMs;
    for (const listener of [...this.visibilityListeners]) listener();
  }

  get pendingFrameCount(): number {
    return this.callbacks.size;
  }

  get visibilityListenerCount(): number {
    return this.visibilityListeners.size;
  }
}

type DecodeMode = "auto" | "hold" | "reject" | "wrong-dimensions";

class MountedDecodeHarness {
  readonly calls: HTMLImageElement[] = [];
  readonly gates: Deferred<void>[] = [];

  constructor(
    private readonly manifest: ValidatedRuntimeManifest,
    private readonly mode: DecodeMode = "auto",
  ) {}

  readonly decode = async (image: HTMLImageElement): Promise<void> => {
    this.calls.push(image);
    const record = [
      ...this.manifest.profiles.compact.assets,
      ...this.manifest.profiles.expanded.assets,
    ].find((candidate) => image.getAttribute("src")?.endsWith(String(candidate.id)));
    if (record === undefined) throw new Error("Unknown mounted fixture image.");

    if (this.mode === "reject") throw new Error("Injected decode failure.");
    if (this.mode === "hold") {
      const gate = deferred<void>();
      this.gates.push(gate);
      await gate.promise;
    }
    const width = this.mode === "wrong-dimensions"
      ? record.intrinsicWidth + 1
      : record.intrinsicWidth;
    setNaturalDimensions(image, width, record.intrinsicHeight);
  };
}

interface ControllerHarness {
  readonly Component: ReturnType<typeof createLayeredWatchEnhancementController>;
  readonly clock: FakeAnimationClock;
  readonly commits: { count: number };
  readonly decoder: MountedDecodeHarness;
  readonly loader: FakeProfileLoader;
  readonly resize: FakeResizeHarness;
  readonly supportCalls: { count: number };
}

function createHarness(options: Readonly<{
  decodeMode?: DecodeMode;
  height?: number;
  manifest?: ValidatedRuntimeManifest;
  release?: unknown;
  supported?: BrowserSupportResult;
  width?: number;
}> = {}): ControllerHarness {
  const release = options.release ?? READY_RELEASE;
  const manifest = options.manifest ?? MANIFEST;
  const loader = new FakeProfileLoader();
  const resize = new FakeResizeHarness(options.width, options.height);
  const clock = new FakeAnimationClock();
  const decoder = new MountedDecodeHarness(manifest, options.decodeMode);
  const commits = { count: 0 };
  const supportCalls = { count: 0 };
  const dependencies: LayeredWatchEnhancementDependencies = {
    animationClockEnvironment: clock,
    classifySupport: () => {
      supportCalls.count += 1;
      return options.supported ?? { supported: true };
    },
    createResizeObserver: resize.createObserver,
    decodeMountedImage: decoder.decode,
    onControllerCommit: () => {
      commits.count += 1;
    },
    readViewport: resize.readViewport,
    release,
    startProfileLoad: loader.start,
  };
  return {
    Component: createLayeredWatchEnhancementController(dependencies),
    clock,
    commits,
    decoder,
    loader,
    resize,
    supportCalls,
  };
}

const DEFAULT_PROPS = Object.freeze({
  definitionOpen: false,
  fallbackState: "ready" as const,
  reducedMotion: false,
}) satisfies LayeredWatchEnhancementProps;

function controllerRoot(container: HTMLElement): HTMLDivElement {
  const root = container.querySelector<HTMLDivElement>(".watch-layer-enhancement");
  if (root === null) throw new Error("Expected the layered watch controller root.");
  return root;
}

function movingLayer(container: HTMLElement): HTMLImageElement {
  const layer = container.querySelector<HTMLImageElement>(
    `[data-watch-layer-id="${MOVING_LAYER_ID}"]`,
  );
  if (layer === null) throw new Error("Expected the moving layer image.");
  return layer;
}

function renderController(
  harness: ControllerHarness,
  props: LayeredWatchEnhancementProps = DEFAULT_PROPS,
) {
  return render(
    <div data-testid="watch-facade-host">
      <h1>Existing application state</h1>
      <button type="button">Existing control</button>
      <input aria-label="Existing query" defaultValue="preserved" />
      <harness.Component {...props} />
    </div>,
  );
}

async function waitForLoad(
  harness: ControllerHarness,
  index: number,
): Promise<FakeProfileLoad> {
  await waitFor(() => expect(harness.loader.loads.length).toBeGreaterThan(index));
  return harness.loader.loads[index];
}

async function activate(
  harness: ControllerHarness,
  view: ReturnType<typeof render>,
  profile: ProfileId = "compact",
  loadIndex = 0,
): Promise<void> {
  const load = await waitForLoad(harness, loadIndex);
  await act(async () => {
    load.resolve(preparedProfile(profile));
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(controllerRoot(view.container)).toHaveAttribute(
      "data-watch-enhancement-state",
      "ready",
    );
  });
}

function layerTransform(layer: HTMLImageElement): string {
  return layer.style.getPropertyValue(WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY);
}

// Validates: Requirements 6.15–6.18, 7.1, 7.6–7.9, 8.2, 8.7–8.12,
// 9.1–9.14, 10.1–10.15, 11.1–11.4, 11.9, 11.13, 11.14.
describe("LayeredWatchEnhancement", () => {
  it("keeps fallback-only and unsupported browsers decorative with zero requests", async () => {
    const fallbackHarness = createHarness({ release: FALLBACK_RELEASE });
    const fallbackView = renderController(fallbackHarness);
    await waitFor(() => expect(fallbackHarness.supportCalls.count).toBe(1));

    const fallbackRoot = controllerRoot(fallbackView.container);
    expect(fallbackRoot).toHaveAttribute("aria-hidden", "true");
    expect(fallbackRoot).toHaveAttribute("data-watch-enhancement-state", "fallback-only");
    expect(fallbackRoot).toHaveAttribute("data-watch-enhancement-diagnostic", "none");
    expect(fallbackRoot).toHaveAttribute("data-watch-fallback-visible", "true");
    expect(fallbackRoot).toHaveStyle({ pointerEvents: "none", visibility: "hidden" });
    expect(fallbackHarness.loader.loads).toHaveLength(0);
    expect(fallbackHarness.resize.observeCount).toBe(0);
    expect(fallbackRoot.querySelectorAll("img")).toHaveLength(0);
    fallbackView.unmount();

    const unsupportedHarness = createHarness({
      supported: { code: "browser-unknown", supported: false },
    });
    const unsupportedView = renderController(unsupportedHarness);
    await waitFor(() => {
      expect(controllerRoot(unsupportedView.container)).toHaveAttribute(
        "data-watch-enhancement-diagnostic",
        "browser-unknown",
      );
    });

    const unsupportedRoot = controllerRoot(unsupportedView.container);
    expect(unsupportedRoot).toHaveAttribute("data-watch-enhancement-state", "unsupported");
    expect(unsupportedRoot).toHaveAttribute("data-watch-enhancement-visible", "false");
    expect(unsupportedHarness.loader.loads).toHaveLength(0);
    expect(unsupportedHarness.resize.observeCount).toBe(0);
    expect(screen.queryByText("browser-unknown")).not.toBeInTheDocument();
  });

  it("waits for fallback readiness before requesting and starts only once", async () => {
    const harness = createHarness();
    const view = renderController(harness, {
      ...DEFAULT_PROPS,
      fallbackState: "loading",
    });
    await waitFor(() => expect(harness.supportCalls.count).toBe(1));
    expect(harness.loader.loads).toHaveLength(0);

    view.rerender(
      <div data-testid="watch-facade-host">
        <h1>Existing application state</h1>
        <button type="button">Existing control</button>
        <input aria-label="Existing query" defaultValue="preserved" />
        <harness.Component {...DEFAULT_PROPS} />
      </div>,
    );
    await waitFor(() => expect(harness.loader.loads).toHaveLength(1));
    expect(harness.loader.inputs[0].profile).toBe("compact");
  });

  it("mounts a complete arbitrarily ordered profile hidden and activates once after all mounted decodes", async () => {
    const harness = createHarness({ decodeMode: "hold" });
    const view = renderController(harness);
    const query = screen.getByRole("textbox", { name: "Existing query" });
    query.focus();
    const load = await waitForLoad(harness, 0);

    expect(controllerRoot(view.container).querySelectorAll("img")).toHaveLength(0);
    await act(async () => {
      load.resolve(preparedProfile("compact", { reverseAssets: true }));
      await Promise.resolve();
    });
    await waitFor(() => expect(harness.decoder.gates).toHaveLength(2));

    const hiddenRoot = controllerRoot(view.container);
    expect(hiddenRoot).toHaveAttribute("data-watch-enhancement-state", "mounting-hidden");
    expect(hiddenRoot).toHaveAttribute("data-watch-enhancement-visible", "false");
    expect(hiddenRoot).toHaveAttribute("data-watch-fallback-visible", "true");
    expect(hiddenRoot).toHaveStyle({ visibility: "hidden" });
    expect(hiddenRoot.querySelectorAll("img.watch-layer-image")).toHaveLength(2);
    expect([...hiddenRoot.querySelectorAll("img")].map((image) => (
      image.getAttribute("data-watch-layer-id")
    ))).toEqual(["reconstructed-background", MOVING_LAYER_ID]);

    await act(async () => {
      harness.decoder.gates[1].resolve(undefined);
      await Promise.resolve();
    });
    expect(hiddenRoot).toHaveAttribute("data-watch-enhancement-state", "mounting-hidden");
    expect(hiddenRoot).toHaveStyle({ visibility: "hidden" });

    await act(async () => {
      harness.decoder.gates[0].resolve(undefined);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(hiddenRoot).toHaveAttribute("data-watch-enhancement-state", "ready");
    });
    expect(hiddenRoot).toHaveAttribute("data-watch-enhancement-visible", "true");
    expect(hiddenRoot).toHaveAttribute("data-watch-fallback-visible", "false");
    expect(hiddenRoot).toHaveStyle({ visibility: "visible" });
    expect(harness.loader.loads).toHaveLength(1);
    expect(document.activeElement).toBe(query);
    expect(query).toHaveValue("preserved");
    expect(hiddenRoot.querySelectorAll("button, input, [tabindex='0']")).toHaveLength(0);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("publishes one stable terminal diagnostic, cleans up, and never retries", async () => {
    const harness = createHarness();
    const view = renderController(harness);
    const load = await waitForLoad(harness, 0);
    await act(async () => {
      load.reject(new RuntimeLoaderError("asset-decode"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(controllerRoot(view.container)).toHaveAttribute(
        "data-watch-enhancement-state",
        "error",
      );
    });

    const root = controllerRoot(view.container);
    expect(root).toHaveAttribute("data-watch-enhancement-diagnostic", "asset-decode");
    expect(root).toHaveAttribute("data-watch-fallback-visible", "true");
    expect(root).toHaveAttribute("data-watch-enhancement-visible", "false");
    expect(root.querySelectorAll("img")).toHaveLength(0);
    expect(harness.resize.activeObserverCount).toBe(0);
    expect(load.disposeCount).toBe(1);
    expect(screen.queryByText("asset-decode")).not.toBeInTheDocument();

    view.rerender(
      <div>
        <h1>Existing application state</h1>
        <button type="button">Existing control</button>
        <input aria-label="Existing query" defaultValue="preserved" />
        <harness.Component
          {...DEFAULT_PROPS}
          definitionOpen
        />
      </div>,
    );
    expect(harness.loader.loads).toHaveLength(1);
    expect(root).toHaveAttribute("data-watch-enhancement-diagnostic", "asset-decode");
  });

  it("fails closed when the complete mounted tree has wrong intrinsic dimensions", async () => {
    const harness = createHarness({ decodeMode: "wrong-dimensions" });
    const view = renderController(harness);
    const load = await waitForLoad(harness, 0);
    await act(async () => {
      load.resolve(preparedProfile("compact"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(controllerRoot(view.container)).toHaveAttribute(
        "data-watch-enhancement-diagnostic",
        "asset-dimensions",
      );
    });

    const root = controllerRoot(view.container);
    expect(root).toHaveAttribute("data-watch-enhancement-state", "error");
    expect(root).toHaveStyle({ visibility: "hidden" });
    expect(root.querySelectorAll("img")).toHaveLength(0);
    expect(load.disposeCount).toBe(1);
  });

  it("uses one clock with no frame-driven React commits and honors dialog, visibility, and reduced-motion static modes", async () => {
    const harness = createHarness();
    const view = renderController(harness, {
      ...DEFAULT_PROPS,
      reducedMotion: true,
    });
    await activate(harness, view);
    const root = controllerRoot(view.container);
    const layer = movingLayer(view.container);
    const referenceTransform = layerTransform(layer);

    expect(root).toHaveAttribute("data-watch-enhancement-state", "ready");
    expect(root).toHaveAttribute("data-watch-enhancement-visible", "false");
    expect(root).toHaveAttribute("data-watch-fallback-visible", "true");
    expect(referenceTransform).toBe("matrix(1, 0, 0, 1, 0, 0)");
    expect(harness.clock.pendingFrameCount).toBe(0);

    view.rerender(
      <div data-testid="watch-facade-host">
        <h1>Existing application state</h1>
        <button type="button">Existing control</button>
        <input aria-label="Existing query" defaultValue="preserved" />
        <harness.Component {...DEFAULT_PROPS} />
      </div>,
    );
    expect(root).toHaveAttribute("data-watch-enhancement-visible", "true");
    expect(root).toHaveAttribute("data-watch-fallback-visible", "false");
    const commitsBeforeFrames = harness.commits.count;

    expect(harness.clock.pendingFrameCount).toBe(1);
    expect(harness.clock.visibilityListenerCount).toBe(1);
    act(() => harness.clock.fireFrame(100));
    const activeTransform = layerTransform(layer);
    expect(activeTransform).not.toBe(referenceTransform);
    expect(harness.commits.count).toBe(commitsBeforeFrames);
    expect(harness.clock.pendingFrameCount).toBe(1);

    harness.clock.setNow(100);
    view.rerender(
      <div data-testid="watch-facade-host">
        <h1>Existing application state</h1>
        <button type="button">Existing control</button>
        <input aria-label="Existing query" defaultValue="preserved" />
        <harness.Component {...DEFAULT_PROPS} definitionOpen />
      </div>,
    );
    expect(root).toHaveStyle({ opacity: "0.72" });
    expect(harness.clock.pendingFrameCount).toBe(0);
    expect(layerTransform(layer)).toBe(activeTransform);

    harness.clock.setNow(1_000);
    view.rerender(
      <div data-testid="watch-facade-host">
        <h1>Existing application state</h1>
        <button type="button">Existing control</button>
        <input aria-label="Existing query" defaultValue="preserved" />
        <harness.Component {...DEFAULT_PROPS} />
      </div>,
    );
    expect(layerTransform(layer)).toBe(activeTransform);
    expect(harness.clock.pendingFrameCount).toBe(1);
    act(() => harness.clock.fireFrame(1_010));
    expect(layerTransform(layer)).not.toBe(activeTransform);

    const beforeHidden = layerTransform(layer);
    act(() => harness.clock.setHidden(true, 1_020));
    expect(harness.clock.pendingFrameCount).toBe(0);
    const hiddenTransform = layerTransform(layer);
    expect(hiddenTransform).not.toBe("");
    act(() => harness.clock.setHidden(false, 5_000));
    expect(harness.clock.pendingFrameCount).toBe(1);
    expect(layerTransform(layer)).toBe(hiddenTransform);
    act(() => harness.clock.fireFrame(5_010));
    expect(layerTransform(layer)).not.toBe(beforeHidden);

    harness.clock.setNow(5_010);
    view.rerender(
      <div data-testid="watch-facade-host">
        <h1>Existing application state</h1>
        <button type="button">Existing control</button>
        <input aria-label="Existing query" defaultValue="preserved" />
        <harness.Component {...DEFAULT_PROPS} reducedMotion />
      </div>,
    );
    expect(harness.clock.pendingFrameCount).toBe(0);
    expect(layerTransform(layer)).toBe("matrix(1, 0, 0, 1, 0, 0)");
    expect(root).toHaveAttribute("data-watch-reduced-motion", "true");
    expect(root).toHaveAttribute("data-watch-enhancement-visible", "true");
    expect(root).toHaveAttribute("data-watch-fallback-visible", "false");
    expect(harness.clock.maximumPendingFrames).toBe(1);
  });

  it("remaps in-profile without reloading and atomically switches 700/701 profiles without losing phase", async () => {
    const harness = createHarness({ width: 700, height: 500 });
    const view = renderController(harness);
    await activate(harness, view);
    const root = controllerRoot(view.container);
    act(() => harness.clock.fireFrame(100));
    const compactMotion = layerTransform(movingLayer(view.container));
    const coverBeforeResize = root.style.getPropertyValue("--watch-cover-scale");

    act(() => harness.resize.emit(650, 900));
    expect(harness.loader.loads).toHaveLength(1);
    expect(root).toHaveAttribute("data-watch-enhancement-state", "ready");
    expect(root.style.getPropertyValue("--watch-cover-scale")).not.toBe(coverBeforeResize);
    expect(layerTransform(movingLayer(view.container))).toBe(compactMotion);

    act(() => harness.resize.emit(701, 500));
    await waitFor(() => expect(harness.loader.loads).toHaveLength(2));
    expect(root).toHaveAttribute("data-watch-enhancement-state", "profile-switch-loading");
    expect(root).toHaveAttribute("data-watch-enhancement-profile", "expanded");
    expect(root).toHaveAttribute("data-watch-fallback-visible", "true");
    expect(root).toHaveStyle({ visibility: "hidden" });
    expect(harness.loader.loads[0].cancelCalls).toContain("profile-change");
    expect(harness.clock.pendingFrameCount).toBe(0);

    harness.clock.setNow(5_000);
    await act(async () => {
      harness.loader.loads[1].resolve(preparedProfile("expanded"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(root).toHaveAttribute("data-watch-enhancement-state", "ready");
    });
    expect(root).toHaveAttribute("data-watch-enhancement-profile", "expanded");
    expect(root).toHaveAttribute("data-watch-fallback-visible", "false");
    expect(layerTransform(movingLayer(view.container))).toBe(compactMotion);
    expect(harness.clock.pendingFrameCount).toBe(1);

    act(() => harness.clock.fireFrame(5_010));
    expect(layerTransform(movingLayer(view.container))).not.toBe(compactMotion);
    expect(harness.clock.maximumPendingFrames).toBe(1);

    view.unmount();
    expect(harness.loader.loads[1].disposeCount).toBe(1);
    expect(harness.resize.activeObserverCount).toBe(0);
    expect(harness.clock.pendingFrameCount).toBe(0);
    expect(harness.clock.visibilityListenerCount).toBe(0);
  });

  it("maps any replacement-profile failure to one terminal profile-switch fallback", async () => {
    const harness = createHarness({ width: 700 });
    const view = renderController(harness);
    await activate(harness, view);

    act(() => harness.resize.emit(701, 500));
    const replacement = await waitForLoad(harness, 1);
    await act(async () => {
      replacement.reject(new RuntimeLoaderError("asset-fetch"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(controllerRoot(view.container)).toHaveAttribute(
        "data-watch-enhancement-diagnostic",
        "profile-switch",
      );
    });

    const root = controllerRoot(view.container);
    expect(root).toHaveAttribute("data-watch-enhancement-state", "error");
    expect(root).toHaveAttribute("data-watch-fallback-visible", "true");
    expect(harness.loader.loads).toHaveLength(2);
    expect(replacement.disposeCount).toBe(1);
    expect(harness.resize.activeObserverCount).toBe(0);
  });

  it("fails invalid cover mapping before requests and keeps diagnostics decorative", async () => {
    const harness = createHarness({ height: 0, width: 0 });
    const view = renderController(harness);
    await waitFor(() => {
      expect(controllerRoot(view.container)).toHaveAttribute(
        "data-watch-enhancement-diagnostic",
        "mapping-invalid",
      );
    });
    const root = controllerRoot(view.container);
    expect(root).toHaveAttribute("data-watch-enhancement-state", "error");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).not.toHaveAttribute("role");
    expect(root).not.toHaveAttribute("tabindex");
    expect(harness.loader.loads).toHaveLength(0);
    expect(harness.resize.observeCount).toBe(0);
    expect(screen.queryByText("mapping-invalid")).not.toBeInTheDocument();
  });

  it("keeps depth exact-default-off even when an injected future release opts in", async () => {
    const depthProfiles = Object.freeze([Object.freeze({
      approvalId: "depth-approval" as ApprovalId,
      authoredInterpretation: true as const,
      enabled: true,
      id: "compact-depth" as DepthProfile["id"],
      layers: Object.freeze([Object.freeze({
        displacementShortAxisFraction: 0.006,
        layerId: MOVING_LAYER_ID,
        phaseRadians: 0,
        rotationDegrees: 1,
        scaleDelta: 0.015,
        zOrder: 1,
      })]),
      periodMs: 5_000,
      profile: "compact" as const,
    })]) as readonly DepthProfile[];
    const manifest = runtimeManifest(DEPTH_OPTED_IN_RELEASE, depthProfiles);
    const harness = createHarness({
      manifest,
      release: DEPTH_OPTED_IN_RELEASE,
    });
    const view = renderController(harness);
    const load = await waitForLoad(harness, 0);
    await act(async () => {
      load.resolve(preparedProfile("compact", {
        manifest,
        release: DEPTH_OPTED_IN_RELEASE,
      }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(controllerRoot(view.container)).toHaveAttribute(
        "data-watch-enhancement-state",
        "ready",
      );
    });

    const root = controllerRoot(view.container);
    expect(root).toHaveAttribute("data-watch-depth", "disabled");
    expect(layerTransform(movingLayer(view.container))).toBe(
      "matrix(1, 0, 0, 1, 0, 0)",
    );
    expect(COMPONENT_SOURCE).not.toMatch(/from ["']@\/lib\/watch-2-5d\/depth["']/u);
  });

  it("preserves existing control state and focus through activation and profile switching", async () => {
    const user = userEvent.setup();
    const harness = createHarness({ width: 700 });
    const view = renderController(harness);
    const query = screen.getByRole("textbox", { name: "Existing query" });
    const control = screen.getByRole("button", { name: "Existing control" });
    await user.clear(query);
    await user.type(query, "calibre 321");
    query.focus();

    await activate(harness, view);
    expect(query).toHaveValue("calibre 321");
    expect(query).toHaveFocus();
    expect(control).toBeEnabled();

    act(() => harness.resize.emit(701, 500));
    const replacement = await waitForLoad(harness, 1);
    await act(async () => {
      replacement.resolve(preparedProfile("expanded"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(controllerRoot(view.container)).toHaveAttribute(
        "data-watch-enhancement-profile",
        "expanded",
      );
    });
    expect(query).toHaveValue("calibre 321");
    expect(query).toHaveFocus();
    await user.click(control);
    expect(control).toHaveFocus();
  });

  it("contains no second clock, direct frame scheduler, input tracking, or depth path", () => {
    expect(COMPONENT_SOURCE.match(/\buseAnimationClock\s*\(/gu)).toHaveLength(1);
    expect(COMPONENT_SOURCE).not.toMatch(/\brequestAnimationFrame\s*\(/u);
    expect(COMPONENT_SOURCE).not.toMatch(
      /\bon(?:Pointer|Touch|Mouse|Wheel|Drag|Key|Click|DoubleClick)\w*\s*=/u,
    );
    expect(COMPONENT_SOURCE).not.toMatch(
      /addEventListener\s*\(\s*["'](?:pointer|touch|mouse|wheel|drag|deviceorientation|devicemotion|keydown|keyup)/u,
    );
    expect(COMPONENT_SOURCE).not.toContain("@react-three");
    expect(COMPONENT_SOURCE).not.toContain("three");
    expect(COMPONENT_SOURCE).not.toContain("<canvas");
    expect(COMPONENT_SOURCE).not.toMatch(/watch-2-5d\/depth/u);
    expect(IDENTITY_MATRIX_2D).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });
});
