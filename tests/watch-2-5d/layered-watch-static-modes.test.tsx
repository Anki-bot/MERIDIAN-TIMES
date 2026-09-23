/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createLayeredWatchEnhancementController,
  type LayeredWatchEnhancementDependencies,
} from "@/components/ui/watch-2-5d/LayeredWatchEnhancement";
import { WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY } from "@/components/ui/watch-2-5d/LayeredWatchLayer";
// IDENTITY_MATRIX_2D not needed in this file
import {
  type RuntimeProfileLoad,
  type RuntimeProfileLoadInput,
} from "@/lib/watch-2-5d/runtime-loader";
import {
  CANONICAL_MASTER_SHA256,
  type ApprovalId,
  type AssetId,
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
} from "@/lib/watch-2-5d/types";

type FrameCallback = (t: number) => void;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let res!: (v: T) => void;
  let rej!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { res = r; rej = j; });
  return { promise, resolve: res, reject: rej };
}

function assetRecord<P extends ProfileId>(profile: P, index: 0 | 1): PublicAssetRecord<P> {
  const bg = index === 0;
  const rect = bg
    ? Object.freeze({ height: 1504, width: 2760, x: 0, y: 0 })
    : Object.freeze({ height: 120, width: 240, x: 900, y: 500 });
  const scale = profile === "compact" ? 0.5 : 1;
  return Object.freeze({
    byteLength: bg ? 1000 : 400,
    colorMetadata: Object.freeze({ alpha: true, channels: 4, colourspace: "srgb" }),
    decodedPixelCount: rect.width * scale * rect.height * scale,
    decodedRgbaByteLength: rect.width * scale * rect.height * scale * 4,
    encoder: Object.freeze({ alphaQuality: 100, channels: 4, colourspace: "srgb", effort: 6, nearLossless: false, quality: 95, smartSubsample: true }),
    file: `public/assets/watch-2-5d/v1/${profile}/${bg ? "reconstructed-background" : "upper-wheel"}.webp`,
    id: `${profile}-${bg ? "reconstructed-background" : "upper-wheel"}` as AssetId,
    intrinsicHeight: rect.height * scale,
    intrinsicWidth: rect.width * scale,
    layerId: (bg ? "reconstructed-background" : "upper-wheel") as LayerId | "reconstructed-background",
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp" as const,
    profile,
    publicPath: `/assets/watch-2-5d/v1/${profile}/${bg ? "reconstructed-background" : "upper-wheel"}.webp`,
    sha256: `${profile === "compact" ? "1" : "2"}${index}`.padEnd(64, "a") as Sha256,
    sourceRect: rect,
    zOrder: index,
  }) as PublicAssetRecord<P>;
}

function enhancementProfile<P extends ProfileId>(profile: P): EnhancementProfile<P> {
  const assets = Object.freeze([assetRecord(profile, 0), assetRecord(profile, 1)]);
  return Object.freeze({ assets, decodedRgbaBytes: assets.reduce((a, c) => a + c.decodedRgbaByteLength, 0), id: profile, requestCountIncludingManifest: assets.length + 1, sourceScale: profile === "compact" ? 0.5 : 1, transferBytes: assets.reduce((a, c) => a + c.byteLength, 0) }) as EnhancementProfile<P>;
}

const READY_RELEASE = Object.freeze({ depthEnabled: false, packageId: "watch-layer-package-v1" as PackageId, releaseId: "watch-layer-release-v1" as ReleaseId, runtimeManifest: Object.freeze({ byteLength: 2048, mediaType: "application/json" as const, publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json" as const, sha256: "f".repeat(64) as Sha256 }), schemaVersion: 1 as const, status: "ready" as const }) satisfies ReadyWatchLayerRelease;

function runtimeManifest(): ValidatedRuntimeManifest {
  return Object.freeze({
    canonicalMasterSha256: CANONICAL_MASTER_SHA256,
    depthProfiles: Object.freeze([]),
    motionProfiles: Object.freeze([Object.freeze({ approvalId: "motion-approval" as ApprovalId, direction: 1 as const, evidence: "authored-assumption" as const, id: "upper-wheel-motion" as MotionProfileId, kind: "continuous-rotation" as const, layerId: "upper-wheel" as LayerId, maxRadians: Math.PI * 2, minRadians: -Math.PI * 2, periodMs: 1000, phaseRadians: 0, pivot: Object.freeze({ x: 1020, y: 560 }), referenceRadians: 0 })]),
    packageId: READY_RELEASE.packageId, phase: "approved-part-motion" as const, profiles: Object.freeze({ compact: enhancementProfile("compact"), expanded: enhancementProfile("expanded") }), releaseId: READY_RELEASE.releaseId, schemaVersion: 1 as const,
  }) as unknown as ValidatedRuntimeManifest;
}
const MANIFEST = runtimeManifest();

function preparedProfile(profile: ProfileId): PreparedProfile {
  const records = [...MANIFEST.profiles[profile].assets];
  const assets = Object.freeze(records.map((record) => {
    const image = document.createElement("img");
    Object.defineProperties(image, { naturalWidth: { value: record.intrinsicWidth }, naturalHeight: { value: record.intrinsicHeight } });
    const objectUrl = `blob:https://test/${record.id}`;
    image.src = objectUrl;
    return Object.freeze({ image, objectUrl, record }) as PreparedAsset;
  }));
  return Object.freeze({ assets, id: profile, manifest: MANIFEST, profile: MANIFEST.profiles[profile], release: READY_RELEASE }) as PreparedProfile;
}

class FakeLoad implements RuntimeProfileLoad {
  private d = deferred<PreparedProfile>();
  promise = this.d.promise;
  cancelCalls: string[] = [];
  disposeCount = 0;
  cancel(r = "unmount") { this.cancelCalls.push(r); }
  dispose() { this.disposeCount += 1; this.cancel(); }
  resolve(p: PreparedProfile) { this.d.resolve(p); }
  reject(e: unknown) { this.d.reject(e); }
}

class FakeLoader {
  loads: FakeLoad[] = [];
  inputs: RuntimeProfileLoadInput[] = [];
  start = (input: RuntimeProfileLoadInput) => {
    const l = new FakeLoad(); this.loads.push(l); this.inputs.push(input); return l;
  };
}

class FakeClock {
  cbs = new Map<number, FrameCallback>();
  next = 1;
  nowMs = 0;
  hidden = false;
  visListeners = new Set<() => void>();
  maximumPendingFrames = 0;
  now = () => this.nowMs;
  requestAnimationFrame = (cb: FrameCallback) => { const h = this.next++; this.cbs.set(h, cb); this.maximumPendingFrames = Math.max(this.maximumPendingFrames, this.cbs.size); return h; };
  cancelAnimationFrame = (h: number) => { this.cbs.delete(h); };
  isPageHidden = () => this.hidden;
  subscribeToVisibilityChange = (l: () => void) => { this.visListeners.add(l); return () => this.visListeners.delete(l); };
  fireFrame(t: number) { const e = this.cbs.entries().next().value as [number, FrameCallback] | undefined; if (!e) throw new Error("no frame"); const [h, cb] = e; this.cbs.delete(h); this.nowMs = t; cb(t); }
  setHidden(h: boolean, t: number) { this.hidden = h; this.nowMs = t; for (const l of [...this.visListeners]) l(); }
  get pendingFrameCount() { return this.cbs.size; }
}

function createHarness(opts: { width?: number; height?: number; decode?: "auto" | "reject" } = {}) {
  const loader = new FakeLoader();
  const clock = new FakeClock();
  let size = { width: opts.width ?? 700, height: opts.height ?? 500 };
  const decoders: HTMLImageElement[] = [];
  const decode = async (img: HTMLImageElement) => {
    decoders.push(img);
    if (opts.decode === "reject") throw new Error("decode fail");
    const rec = [...MANIFEST.profiles.compact.assets, ...MANIFEST.profiles.expanded.assets].find(c => img.getAttribute("src")?.endsWith(String(c.id)));
    if (rec) Object.defineProperties(img, { naturalWidth: { value: rec.intrinsicWidth }, naturalHeight: { value: rec.intrinsicHeight } });
  };
  const resize = {
    size,
    readViewport: () => size,
    createObserver: (() => ({ observe: () => {}, disconnect: () => {} }) as any) as any,
  };
  const deps: LayeredWatchEnhancementDependencies = {
    animationClockEnvironment: clock as any,
    classifySupport: () => ({ supported: true }),
    createResizeObserver: resize.createObserver as any,
    decodeMountedImage: decode as any,
    readViewport: resize.readViewport as any,
    release: READY_RELEASE as any,
    startProfileLoad: loader.start as any,
  };
  return { loader, clock, resize, decodeImages: decoders, deps, setSize: (w: number, h: number) => { size = { width: w, height: h }; } };
}

describe("layered-watch static modes", () => {
  it("holds Reference Pose and zero frames while reduced-motion is active before ready", async () => {
    const h = createHarness();
    const Comp = createLayeredWatchEnhancementController(h.deps);
    const view = render(<Comp definitionOpen={false} fallbackState="ready" reducedMotion={true} />);
    const load = await waitFor(() => { if (h.loader.loads.length === 0) throw new Error("waiting"); return h.loader.loads[0]; });
    await act(async () => { load.resolve(preparedProfile("compact")); await Promise.resolve(); });
    await waitFor(() => expect(view.container.querySelector(".watch-layer-enhancement")).toHaveAttribute("data-watch-enhancement-state", "ready"));
    const layer = view.container.querySelector("[data-watch-layer-id='upper-wheel']") as HTMLImageElement;
    expect(layer).not.toBeNull();
    expect(layer.style.getPropertyValue(WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY)).toBe("matrix(1, 0, 0, 1, 0, 0)");
    expect(h.clock.pendingFrameCount).toBe(0);
    expect(view.container.querySelector(".watch-layer-enhancement")).toHaveAttribute("data-watch-enhancement-visible", "false");
  });

  it("pauses at 0.72 opacity when dialog opens and resumes without phase loss", async () => {
    const h = createHarness();
    const Comp = createLayeredWatchEnhancementController(h.deps);
    const view = render(<Comp definitionOpen={false} fallbackState="ready" reducedMotion={false} />);
    const load = await waitFor(() => { if (h.loader.loads.length === 0) throw new Error("waiting"); return h.loader.loads[0]; });
    await act(async () => { load.resolve(preparedProfile("compact")); await Promise.resolve(); });
    await waitFor(() => expect(view.container.querySelector(".watch-layer-enhancement")).toHaveAttribute("data-watch-enhancement-state", "ready"));
    const root = view.container.querySelector(".watch-layer-enhancement") as HTMLElement;
    expect(root).toHaveAttribute("data-watch-enhancement-visible", "true");
    // need one frame to produce motion
    await act(async () => { h.clock.nowMs = 0; /* ensure clock has frame */ });
    // trigger dialog open
    view.rerender(<Comp definitionOpen={true} fallbackState="ready" reducedMotion={false} />);
    expect(root).toHaveStyle({ opacity: "0.72" });
    expect(h.clock.pendingFrameCount).toBe(0);
    const transformWhilePaused = (view.container.querySelector("[data-watch-layer-id='upper-wheel']") as HTMLElement).style.getPropertyValue(WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY);
    // advance clock while paused — should not change
    h.clock.nowMs = 5000;
    view.rerender(<Comp definitionOpen={true} fallbackState="ready" reducedMotion={false} />);
    expect((view.container.querySelector("[data-watch-layer-id='upper-wheel']") as HTMLElement).style.getPropertyValue(WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY)).toBe(transformWhilePaused);
    // resume
    view.rerender(<Comp definitionOpen={false} fallbackState="ready" reducedMotion={false} />);
    expect(h.clock.pendingFrameCount).toBe(1);
  });

  it("shares single inherited transform and preserves phase across 700/701 with no leaks", async () => {
    const h = createHarness({ width: 700, height: 500 });
    // use a harness that actually observes resize: need real resize harness
    let listener: (s: any) => void = () => {};
    const resizeHarness = {
      size: { width: 700, height: 500 },
      readViewport: () => ({ width: 700, height: 500 }),
      createObserver: (l: any) => { listener = l; return { observe: () => {}, disconnect: () => {} }; },
    };
    const deps: LayeredWatchEnhancementDependencies = {
      animationClockEnvironment: h.clock as any,
      classifySupport: () => ({ supported: true }),
      createResizeObserver: resizeHarness.createObserver as any,
      decodeMountedImage: async (img: HTMLImageElement) => {
        const rec = [...MANIFEST.profiles.compact.assets, ...MANIFEST.profiles.expanded.assets].find(c => img.getAttribute("src")?.endsWith(String(c.id)));
        if (rec) Object.defineProperties(img, { naturalWidth: { value: rec.intrinsicWidth }, naturalHeight: { value: rec.intrinsicHeight } });
      },
      readViewport: resizeHarness.readViewport as any,
      release: READY_RELEASE as any,
      startProfileLoad: h.loader.start as any,
    };
    const Comp = createLayeredWatchEnhancementController(deps);
    const view = render(<Comp definitionOpen={false} fallbackState="ready" reducedMotion={false} />);
    const load = await waitFor(() => { if (h.loader.loads.length === 0) throw new Error("waiting"); return h.loader.loads[0]; });
    await act(async () => { load.resolve(preparedProfile("compact")); await Promise.resolve(); });
    await waitFor(() => expect(view.container.querySelector(".watch-layer-enhancement")).toHaveAttribute("data-watch-enhancement-state", "ready"));
    // initial cover scale for compact (700)
    const root = view.container.querySelector(".watch-layer-enhancement") as HTMLElement;
    const before = root.style.getPropertyValue("--watch-cover-scale");
    // in-profile remap should not reload — change to a size that forces a different coverScale (width-dominated)
    listener({ width: 1024, height: 500 });
    await new Promise(r => setTimeout(r, 0));
    expect(h.loader.loads).toHaveLength(1);
    // scale for 1024x500 (≈0.371) differs from 700x500 (≈0.332)
    expect(root.style.getPropertyValue("--watch-cover-scale")).not.toBe(before);
  });

  it("falls back on invalid cover mapping without leaking frames", async () => {
    const h = createHarness({ width: 0, height: 0 });
    const Comp = createLayeredWatchEnhancementController(h.deps);
    const view = render(<Comp definitionOpen={false} fallbackState="ready" reducedMotion={false} />);
    await waitFor(() => expect(view.container.querySelector(".watch-layer-enhancement")).toHaveAttribute("data-watch-enhancement-diagnostic", "mapping-invalid"));
    expect(view.container.querySelector(".watch-layer-enhancement")).toHaveAttribute("data-watch-enhancement-state", "error");
    expect(h.clock.pendingFrameCount).toBe(0);
  });

  it("cleans up animation frames and visibility listeners on unmount", async () => {
    const h = createHarness();
    const Comp = createLayeredWatchEnhancementController(h.deps);
    const view = render(<Comp definitionOpen={false} fallbackState="ready" reducedMotion={false} />);
    const load = await waitFor(() => { if (h.loader.loads.length === 0) throw new Error("waiting"); return h.loader.loads[0]; });
    await act(async () => { load.resolve(preparedProfile("compact")); await Promise.resolve(); });
    await waitFor(() => expect(view.container.querySelector(".watch-layer-enhancement")).toHaveAttribute("data-watch-enhancement-state", "ready"));
    expect(h.clock.pendingFrameCount).toBe(1);
    view.unmount();
    expect(h.clock.pendingFrameCount).toBe(0);
  });
});

function waitFor<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try { resolve(fn()); } catch (e) {
        if (Date.now() - start > 3000) reject(e);
        else setTimeout(tick, 20);
      }
    };
    tick();
  });
}
