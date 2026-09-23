import { describe, expect, it } from "vitest";
import {
  ENHANCEMENT_EVENT_TYPES,
  ENHANCEMENT_STATE_KINDS,
  createEnhancementState,
  getEnhancementDiagnosticCode,
  transitionEnhancementState,
} from "@/lib/watch-2-5d/runtime-state";
import type {
  EnhancementEvent,
  EnhancementEventType,
  EnhancementState,
  EnhancementTransitionResult,
  ProfileSwitchLoadingEnhancementState,
} from "@/lib/watch-2-5d/runtime-state";
import {
  CANONICAL_MASTER_SHA256,
  RUNTIME_FAILURE_CODES,
  assertNever,
} from "@/lib/watch-2-5d/types";
import type {
  AssetId,
  EnhancementProfile,
  FallbackOnlyWatchLayerRelease,
  PackageId,
  PreparedAsset,
  ProfileId,
  PublicAssetRecord,
  ReadyWatchLayerRelease,
  ReleaseId,
  Sha256,
  ValidatedRuntimeManifest,
} from "@/lib/watch-2-5d/types";

const READY_RELEASE = Object.freeze({
  depthEnabled: false,
  packageId: "watch-layer-package" as PackageId,
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

const FALLBACK_RELEASE = Object.freeze({
  depthEnabled: false,
  runtimeManifest: null,
  schemaVersion: 1 as const,
  status: "fallback-only" as const,
}) satisfies FallbackOnlyWatchLayerRelease;

function publicAsset<P extends ProfileId>(
  profile: P,
  index: number,
): PublicAssetRecord<P> {
  const name = index === 0 ? "reconstructed-background" : `layer-${index}`;
  const sourceRect = index === 0
    ? { height: 1_504, width: 2_760, x: 0, y: 0 }
    : { height: 80 + index, width: 120 + index, x: 100 * index, y: 80 * index };
  const scale = profile === "compact" ? 0.5 : 1;
  const intrinsicWidth = Math.ceil(sourceRect.width * scale);
  const intrinsicHeight = Math.ceil(sourceRect.height * scale);
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;

  return Object.freeze({
    byteLength: 400 + index,
    colorMetadata: Object.freeze({ alpha: true, channels: 4, colourspace: "srgb" }),
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
    layerId: index === 0 ? "reconstructed-background" : `watch-layer-${index}`,
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile,
    publicPath: `/assets/watch-2-5d/v1/${profile}/${name}.webp`,
    sha256: (index + (profile === "compact" ? 1 : 10))
      .toString(16)
      .padStart(64, "0") as Sha256,
    sourceRect: Object.freeze(sourceRect),
    zOrder: index,
  }) as PublicAssetRecord<P>;
}

function enhancementProfile<P extends ProfileId>(profile: P): EnhancementProfile<P> {
  const assets = Object.freeze([
    publicAsset(profile, 0),
    publicAsset(profile, 1),
    publicAsset(profile, 2),
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

const MANIFEST = Object.freeze({
  canonicalMasterSha256: CANONICAL_MASTER_SHA256,
  depthProfiles: Object.freeze([]),
  motionProfiles: Object.freeze([]),
  packageId: READY_RELEASE.packageId,
  phase: "static-layered-reconstruction" as const,
  profiles: Object.freeze({
    compact: enhancementProfile("compact"),
    expanded: enhancementProfile("expanded"),
  }),
  releaseId: READY_RELEASE.releaseId,
  schemaVersion: 1 as const,
}) as unknown as ValidatedRuntimeManifest;

function preparedAsset(record: PublicAssetRecord): PreparedAsset {
  return Object.freeze({
    image: document.createElement("img"),
    objectUrl: `blob:watch-2-5d/${record.id}`,
    record,
  });
}

const PREPARED_ASSETS = Object.freeze({
  compact: Object.freeze(MANIFEST.profiles.compact.assets.map(preparedAsset)),
  expanded: Object.freeze(MANIFEST.profiles.expanded.assets.map(preparedAsset)),
});

function supportedInitial(profile: ProfileId = "compact"): EnhancementState {
  return createEnhancementState({
    profile,
    release: READY_RELEASE,
    support: { supported: true },
  });
}

function unwrap(result: EnhancementTransitionResult): EnhancementState {
  expect(
    result.accepted,
    result.accepted ? undefined : `Rejected transition: ${result.reason}`,
  ).toBe(true);
  if (!result.accepted) throw new Error(result.reason);
  return result.state;
}

function loadingAssets(profile: ProfileId = "compact"): EnhancementState {
  return unwrap(transitionEnhancementState(
    supportedInitial(profile),
    { manifest: MANIFEST, type: "manifest-loaded" },
  ));
}

function mountingHidden(profile: ProfileId = "compact"): EnhancementState {
  let state = loadingAssets(profile);
  for (const asset of PREPARED_ASSETS[profile]) {
    state = unwrap(transitionEnhancementState(state, { asset, type: "asset-loaded" }));
  }
  expect(state.kind).toBe("mounting-hidden");
  return state;
}

function ready(profile: ProfileId = "compact"): EnhancementState {
  return unwrap(transitionEnhancementState(
    mountingHidden(profile),
    { profile, type: "mount-complete" },
  ));
}

function switchLoadingAssets(): ProfileSwitchLoadingEnhancementState {
  const state = unwrap(transitionEnhancementState(ready("compact"), {
    activeElapsedMs: 7_500,
    targetProfile: "expanded",
    type: "profile-switch-started",
  }));
  if (state.kind !== "profile-switch-loading") {
    throw new Error(`Expected profile-switch-loading, received ${state.kind}`);
  }
  return state;
}

function switchMountingHidden(): ProfileSwitchLoadingEnhancementState {
  let state: EnhancementState = switchLoadingAssets();
  for (const asset of PREPARED_ASSETS.expanded) {
    state = unwrap(transitionEnhancementState(state, { asset, type: "asset-loaded" }));
  }
  if (state.kind !== "profile-switch-loading") {
    throw new Error(`Expected profile-switch-loading, received ${state.kind}`);
  }
  expect(state.stage).toBe("mounting-hidden");
  return state;
}

function eventForState(
  state: EnhancementState,
  type: EnhancementEventType,
): EnhancementEvent {
  switch (type) {
    case "manifest-loaded":
      return { manifest: MANIFEST, type };
    case "asset-loaded": {
      const profile = state.kind === "profile-switch-loading"
        ? state.targetProfile
        : state.kind === "loading-assets"
          ? state.targetProfile
          : "compact";
      return { asset: PREPARED_ASSETS[profile][0], type };
    }
    case "mount-complete": {
      const profile = state.kind === "mounting-hidden"
        || state.kind === "profile-switch-loading"
        ? state.targetProfile
        : "compact";
      return { profile, type };
    }
    case "active-time-checkpoint":
      return { activeElapsedMs: state.activeElapsedMs + 1, type };
    case "profile-switch-started":
      return {
        activeElapsedMs: state.activeElapsedMs + 1,
        targetProfile: state.kind === "ready" && state.prepared.id === "expanded"
          ? "compact"
          : "expanded",
        type,
      };
    case "failure":
      return { code: "manifest-fetch", type };
    default:
      return assertNever(type, "runtime-state test event fixture");
  }
}

// Validates: Requirements 8.7, 8.8, 8.12, 10.1–10.10, 10.13–10.15, 14.7, 14.9.
describe("watch 2.5D pure enhancement runtime state", () => {
  it("classifies fallback-only and unsupported navigation as terminal zero-enhancement states", () => {
    const fallback = createEnhancementState({
      profile: "compact",
      release: FALLBACK_RELEASE,
      support: { code: "browser-version-unsupported", supported: false },
    });
    expect(fallback).toMatchObject({
      diagnosticCode: null,
      enhancementVisible: false,
      fallbackVisible: true,
      kind: "fallback-only",
      terminal: true,
    });

    const unsupported = createEnhancementState({
      profile: "expanded",
      release: READY_RELEASE,
      support: { code: "browser-version-unsupported", supported: false },
    });
    expect(unsupported).toMatchObject({
      code: "browser-version-unsupported",
      diagnosticCode: "browser-version-unsupported",
      enhancementVisible: false,
      fallbackVisible: true,
      kind: "unsupported",
      terminal: true,
    });
    expect(getEnhancementDiagnosticCode(unsupported))
      .toBe("browser-version-unsupported");

    const lateStart = transitionEnhancementState(
      unsupported,
      { manifest: MANIFEST, type: "manifest-loaded" },
    );
    expect(lateStart).toMatchObject({
      accepted: false,
      effect: "none",
      reason: "terminal-state",
      state: unsupported,
    });
  });

  it("accepts prepared assets in arbitrary order but emits ready only after complete hidden mounting", () => {
    let state = loadingAssets();
    expect(state).toMatchObject({
      completedAssets: [],
      enhancementVisible: false,
      fallbackVisible: true,
      kind: "loading-assets",
    });

    state = unwrap(transitionEnhancementState(state, {
      asset: PREPARED_ASSETS.compact[2],
      type: "asset-loaded",
    }));
    state = unwrap(transitionEnhancementState(state, {
      asset: PREPARED_ASSETS.compact[0],
      type: "asset-loaded",
    }));
    expect(state.kind).toBe("loading-assets");
    if (state.kind !== "loading-assets") throw new Error("Expected loading assets");
    expect(state.completedAssets.map(({ record }) => record.id)).toEqual([
      MANIFEST.profiles.compact.assets[0].id,
      MANIFEST.profiles.compact.assets[2].id,
    ]);
    expect(state.fallbackVisible).toBe(true);

    const finalAsset = transitionEnhancementState(state, {
      asset: PREPARED_ASSETS.compact[1],
      type: "asset-loaded",
    });
    expect(finalAsset).toMatchObject({
      accepted: true,
      effect: "none",
      state: {
        enhancementVisible: false,
        fallbackVisible: true,
        kind: "mounting-hidden",
      },
    });
    state = unwrap(finalAsset);
    if (state.kind !== "mounting-hidden") throw new Error("Expected hidden mount");
    expect(state.prepared.assets.map(({ record }) => record.id)).toEqual(
      MANIFEST.profiles.compact.assets.map(({ id }) => id),
    );

    const activated = transitionEnhancementState(
      state,
      { profile: "compact", type: "mount-complete" },
    );
    expect(activated).toMatchObject({
      accepted: true,
      effect: "atomic-ready",
      state: {
        activeElapsedMs: 0,
        enhancementVisible: true,
        fallbackVisible: false,
        kind: "ready",
      },
    });

    const duplicateReady = transitionEnhancementState(
      activated.state,
      { profile: "compact", type: "mount-complete" },
    );
    expect(duplicateReady).toMatchObject({
      accepted: false,
      effect: "terminal-error",
      reason: "event-not-allowed",
      state: {
        code: "runtime-invariant",
        fallbackVisible: true,
        kind: "error",
      },
    });
  });

  it("rejects partial mount, duplicate, unexpected, and substituted asset transitions", () => {
    const partialState = unwrap(transitionEnhancementState(
      loadingAssets(),
      { asset: PREPARED_ASSETS.compact[0], type: "asset-loaded" },
    ));
    const partialMount = transitionEnhancementState(
      partialState,
      { profile: "compact", type: "mount-complete" },
    );
    expect(partialMount).toMatchObject({
      accepted: false,
      effect: "terminal-error",
      reason: "event-not-allowed",
      state: {
        code: "runtime-invariant",
        enhancementVisible: false,
        failureOrdinal: 1,
        fallbackVisible: true,
        kind: "error",
        terminal: true,
      },
    });

    const lateFailure = transitionEnhancementState(
      partialMount.state,
      { code: "asset-decode", type: "failure" },
    );
    expect(lateFailure).toMatchObject({
      accepted: false,
      effect: "none",
      reason: "terminal-state",
      state: partialMount.state,
    });
    expect(getEnhancementDiagnosticCode(lateFailure.state)).toBe("runtime-invariant");

    const firstAsset = unwrap(transitionEnhancementState(
      loadingAssets(),
      { asset: PREPARED_ASSETS.compact[0], type: "asset-loaded" },
    ));
    expect(transitionEnhancementState(firstAsset, {
      asset: PREPARED_ASSETS.compact[0],
      type: "asset-loaded",
    })).toMatchObject({
      accepted: false,
      reason: "asset-duplicate",
      state: { code: "runtime-invariant", kind: "error" },
    });

    expect(transitionEnhancementState(loadingAssets(), {
      asset: PREPARED_ASSETS.expanded[0],
      type: "asset-loaded",
    })).toMatchObject({
      accepted: false,
      reason: "asset-unexpected",
      state: { code: "runtime-invariant", kind: "error" },
    });

    const expected = MANIFEST.profiles.compact.assets[0];
    const substituted = preparedAsset(Object.freeze({
      ...expected,
      sha256: "e".repeat(64) as Sha256,
    }));
    expect(transitionEnhancementState(loadingAssets(), {
      asset: substituted,
      type: "asset-loaded",
    })).toMatchObject({
      accepted: false,
      reason: "asset-invalid",
      state: { code: "runtime-invariant", kind: "error" },
    });
  });

  it("preserves Active Elapsed Time while swapping profiles and resumes only after atomic mounting", () => {
    let state = ready();
    const checkpoint = transitionEnhancementState(state, {
      activeElapsedMs: 12_345,
      type: "active-time-checkpoint",
    });
    state = unwrap(checkpoint);
    expect(state).toMatchObject({
      activeElapsedMs: 12_345,
      fallbackVisible: false,
      kind: "ready",
    });

    const switchStarted = transitionEnhancementState(state, {
      activeElapsedMs: 12_500,
      targetProfile: "expanded",
      type: "profile-switch-started",
    });
    expect(switchStarted).toMatchObject({
      accepted: true,
      effect: "fallback-shown",
      state: {
        activeElapsedMs: 12_500,
        enhancementVisible: false,
        fallbackVisible: true,
        fromProfile: "compact",
        kind: "profile-switch-loading",
        stage: "loading-assets",
        targetProfile: "expanded",
      },
    });
    state = unwrap(switchStarted);

    for (const index of [2, 0, 1]) {
      state = unwrap(transitionEnhancementState(state, {
        asset: PREPARED_ASSETS.expanded[index],
        type: "asset-loaded",
      }));
      expect(state.activeElapsedMs).toBe(12_500);
      expect(state.fallbackVisible).toBe(true);
    }
    expect(state).toMatchObject({
      activeElapsedMs: 12_500,
      kind: "profile-switch-loading",
      stage: "mounting-hidden",
    });

    const switched = transitionEnhancementState(
      state,
      { profile: "expanded", type: "mount-complete" },
    );
    expect(switched).toMatchObject({
      accepted: true,
      effect: "atomic-ready",
      state: {
        activeElapsedMs: 12_500,
        fallbackVisible: false,
        kind: "ready",
        prepared: { id: "expanded" },
      },
    });

    const failedSwitch = transitionEnhancementState(
      unwrap(transitionEnhancementState(switched.state, {
        activeElapsedMs: 14_000,
        targetProfile: "compact",
        type: "profile-switch-started",
      })),
      { code: "profile-switch", type: "failure" },
    );
    expect(failedSwitch).toMatchObject({
      accepted: true,
      effect: "terminal-error",
      state: {
        activeElapsedMs: 14_000,
        code: "profile-switch",
        diagnosticCode: "profile-switch",
        fallbackVisible: true,
        kind: "error",
        terminal: true,
      },
    });
  });

  it("keeps orientation/remapping checkpoints monotonic without changing the ready profile", () => {
    const initial = ready("compact");
    if (initial.kind !== "ready") throw new Error("Expected ready state");
    const remapped = transitionEnhancementState(initial, {
      activeElapsedMs: 2_750,
      type: "active-time-checkpoint",
    });
    expect(remapped).toMatchObject({
      accepted: true,
      effect: "none",
      state: {
        activeElapsedMs: 2_750,
        fallbackVisible: false,
        kind: "ready",
      },
    });
    if (!remapped.accepted || remapped.state.kind !== "ready") {
      throw new Error("Expected a ready checkpoint");
    }
    expect(remapped.state.prepared).toBe(initial.prepared);

    expect(transitionEnhancementState(remapped.state, {
      activeElapsedMs: 2_749,
      type: "active-time-checkpoint",
    })).toMatchObject({
      accepted: false,
      reason: "active-elapsed-invalid",
      state: { code: "runtime-invariant", kind: "error" },
    });
  });

  it.each(RUNTIME_FAILURE_CODES)(
    "keeps the first %s diagnostic terminal and stable for the navigation",
    (code) => {
      const failed = transitionEnhancementState(
        supportedInitial(),
        { code, type: "failure" },
      );
      expect(failed).toMatchObject({
        accepted: true,
        effect: "terminal-error",
        state: {
          code,
          diagnosticCode: code,
          enhancementVisible: false,
          failureOrdinal: 1,
          fallbackVisible: true,
          kind: "error",
          terminal: true,
        },
      });

      const second = transitionEnhancementState(
        failed.state,
        { code: code === "asset-fetch" ? "manifest-fetch" : "asset-fetch", type: "failure" },
      );
      expect(second).toMatchObject({
        accepted: false,
        effect: "none",
        reason: "terminal-state",
        state: failed.state,
      });
      expect(getEnhancementDiagnosticCode(second.state)).toBe(code);
    },
  );

  it("covers the complete state/event transition table and fails closed for every impossible pair", () => {
    const samples: readonly {
      readonly label: string;
      readonly state: EnhancementState;
      readonly allowed: readonly EnhancementEventType[];
    }[] = [
      { label: "fallback-only", state: createEnhancementState({
        profile: "compact",
        release: FALLBACK_RELEASE,
        support: { supported: true },
      }), allowed: [] },
      { label: "unsupported", state: createEnhancementState({
        profile: "compact",
        release: READY_RELEASE,
        support: { code: "browser-unknown", supported: false },
      }), allowed: [] },
      { label: "loading-manifest", state: supportedInitial(), allowed: [
        "manifest-loaded",
        "failure",
      ] },
      { label: "loading-assets", state: loadingAssets(), allowed: [
        "asset-loaded",
        "failure",
      ] },
      { label: "mounting-hidden", state: mountingHidden(), allowed: [
        "mount-complete",
        "failure",
      ] },
      { label: "ready", state: ready(), allowed: [
        "active-time-checkpoint",
        "profile-switch-started",
        "failure",
      ] },
      { label: "profile-switch-loading/assets", state: switchLoadingAssets(), allowed: [
        "asset-loaded",
        "failure",
      ] },
      { label: "profile-switch-loading/mount", state: switchMountingHidden(), allowed: [
        "mount-complete",
        "failure",
      ] },
      { label: "error", state: transitionEnhancementState(
        supportedInitial(),
        { code: "manifest-fetch", type: "failure" },
      ).state, allowed: [] },
    ];

    expect(new Set(samples.map(({ state }) => state.kind)))
      .toEqual(new Set(ENHANCEMENT_STATE_KINDS));

    for (const sample of samples) {
      for (const eventType of ENHANCEMENT_EVENT_TYPES) {
        const event = eventForState(sample.state, eventType);
        const result = transitionEnhancementState(sample.state, event);
        const shouldAccept = sample.allowed.includes(eventType);
        expect(
          result.accepted,
          `${sample.label} + ${eventType}`,
        ).toBe(shouldAccept);

        if (!shouldAccept) {
          expect(result.effect, `${sample.label} + ${eventType}`).toBe(
            sample.state.terminal ? "none" : "terminal-error",
          );
          if (sample.state.terminal) {
            expect(result.state).toBe(sample.state);
          } else {
            expect(result.state).toMatchObject({
              code: "runtime-invariant",
              enhancementVisible: false,
              fallbackVisible: true,
              kind: "error",
              terminal: true,
            });
          }
        }
      }
    }
  });
});
