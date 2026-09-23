import { assertNever } from "./types";
import type {
  BrowserSupportResult,
  EnhancementProfile,
  FallbackOnlyWatchLayerRelease,
  PreparedAsset,
  PreparedProfile,
  ProfileId,
  PublicAssetRecord,
  ReadyWatchLayerRelease,
  RuntimeFailureCode,
  SupportCode,
  ValidatedRuntimeManifest,
  WatchLayerRelease,
} from "./types";

export const ENHANCEMENT_STATE_KINDS = [
  "fallback-only",
  "unsupported",
  "loading-manifest",
  "loading-assets",
  "mounting-hidden",
  "ready",
  "profile-switch-loading",
  "error",
] as const;

export type EnhancementStateKind = (typeof ENHANCEMENT_STATE_KINDS)[number];

export const ENHANCEMENT_EVENT_TYPES = [
  "manifest-loaded",
  "asset-loaded",
  "mount-complete",
  "active-time-checkpoint",
  "profile-switch-started",
  "failure",
] as const;

export type EnhancementEventType = (typeof ENHANCEMENT_EVENT_TYPES)[number];

export const ENHANCEMENT_TRANSITION_REJECTION_CODES = [
  "terminal-state",
  "event-not-allowed",
  "manifest-mismatch",
  "profile-invalid",
  "asset-unexpected",
  "asset-duplicate",
  "asset-invalid",
  "mount-profile-mismatch",
  "active-elapsed-invalid",
  "profile-switch-invalid",
] as const;

export type EnhancementTransitionRejectionCode =
  (typeof ENHANCEMENT_TRANSITION_REJECTION_CODES)[number];

export type EnhancementDiagnosticCode = SupportCode | RuntimeFailureCode;

interface HiddenEnhancementState {
  readonly fallbackVisible: true;
  readonly enhancementVisible: false;
}

interface VisibleEnhancementState {
  readonly fallbackVisible: false;
  readonly enhancementVisible: true;
}

interface NonterminalEnhancementState {
  readonly terminal: false;
  readonly diagnosticCode: null;
}

interface TerminalEnhancementState {
  readonly terminal: true;
}

export interface FallbackOnlyEnhancementState
  extends HiddenEnhancementState, TerminalEnhancementState {
  readonly kind: "fallback-only";
  readonly activeElapsedMs: 0;
  readonly diagnosticCode: null;
  readonly release: FallbackOnlyWatchLayerRelease;
}

export interface UnsupportedEnhancementState
  extends HiddenEnhancementState, TerminalEnhancementState {
  readonly kind: "unsupported";
  readonly activeElapsedMs: 0;
  readonly code: SupportCode;
  readonly diagnosticCode: SupportCode;
  readonly release: ReadyWatchLayerRelease;
}

export interface LoadingManifestEnhancementState
  extends HiddenEnhancementState, NonterminalEnhancementState {
  readonly kind: "loading-manifest";
  readonly activeElapsedMs: 0;
  readonly release: ReadyWatchLayerRelease;
  readonly targetProfile: ProfileId;
}

export interface LoadingAssetsEnhancementState
  extends HiddenEnhancementState, NonterminalEnhancementState {
  readonly kind: "loading-assets";
  readonly activeElapsedMs: 0;
  readonly completedAssets: readonly PreparedAsset[];
  readonly manifest: ValidatedRuntimeManifest;
  readonly profile: EnhancementProfile;
  readonly release: ReadyWatchLayerRelease;
  readonly targetProfile: ProfileId;
}

export interface MountingHiddenEnhancementState
  extends HiddenEnhancementState, NonterminalEnhancementState {
  readonly kind: "mounting-hidden";
  readonly activeElapsedMs: 0;
  readonly prepared: PreparedProfile;
  readonly release: ReadyWatchLayerRelease;
  readonly targetProfile: ProfileId;
}

export interface ReadyEnhancementState
  extends VisibleEnhancementState, NonterminalEnhancementState {
  readonly kind: "ready";
  /** Last monotonic clock checkpoint. This is not intended for per-frame updates. */
  readonly activeElapsedMs: number;
  readonly prepared: PreparedProfile;
  readonly release: ReadyWatchLayerRelease;
}

interface ProfileSwitchLoadingBase
  extends HiddenEnhancementState, NonterminalEnhancementState {
  readonly kind: "profile-switch-loading";
  /** Frozen for the entire switch; loading and mounting never advance active time. */
  readonly activeElapsedMs: number;
  readonly fromProfile: ProfileId;
  readonly manifest: ValidatedRuntimeManifest;
  readonly release: ReadyWatchLayerRelease;
  readonly targetProfile: ProfileId;
}

export interface ProfileSwitchAssetsEnhancementState
  extends ProfileSwitchLoadingBase {
  readonly stage: "loading-assets";
  readonly completedAssets: readonly PreparedAsset[];
  readonly profile: EnhancementProfile;
}

export interface ProfileSwitchMountingEnhancementState
  extends ProfileSwitchLoadingBase {
  readonly stage: "mounting-hidden";
  readonly prepared: PreparedProfile;
}

export type ProfileSwitchLoadingEnhancementState =
  | ProfileSwitchAssetsEnhancementState
  | ProfileSwitchMountingEnhancementState;

export interface ErrorEnhancementState
  extends HiddenEnhancementState, TerminalEnhancementState {
  readonly kind: "error";
  readonly activeElapsedMs: number;
  readonly code: RuntimeFailureCode;
  readonly diagnosticCode: RuntimeFailureCode;
  readonly failedFrom: Exclude<
    EnhancementStateKind,
    "fallback-only" | "unsupported" | "error"
  >;
  /** A navigation can enter the terminal error state only once. */
  readonly failureOrdinal: 1;
  readonly release: ReadyWatchLayerRelease;
}

export type EnhancementState =
  | FallbackOnlyEnhancementState
  | UnsupportedEnhancementState
  | LoadingManifestEnhancementState
  | LoadingAssetsEnhancementState
  | MountingHiddenEnhancementState
  | ReadyEnhancementState
  | ProfileSwitchLoadingEnhancementState
  | ErrorEnhancementState;

export interface CreateEnhancementStateInput {
  readonly profile: ProfileId;
  readonly release: WatchLayerRelease;
  readonly support: BrowserSupportResult;
}

export type EnhancementEvent =
  | {
      readonly type: "manifest-loaded";
      readonly manifest: ValidatedRuntimeManifest;
    }
  | {
      readonly type: "asset-loaded";
      readonly asset: PreparedAsset;
    }
  | {
      readonly type: "mount-complete";
      readonly profile: ProfileId;
    }
  | {
      readonly type: "active-time-checkpoint";
      readonly activeElapsedMs: number;
    }
  | {
      readonly type: "profile-switch-started";
      readonly activeElapsedMs: number;
      readonly targetProfile: ProfileId;
    }
  | {
      readonly type: "failure";
      readonly code: RuntimeFailureCode;
    };

export type EnhancementTransitionEffect =
  | "none"
  | "atomic-ready"
  | "fallback-shown"
  | "terminal-error";

export interface AcceptedEnhancementTransition {
  readonly accepted: true;
  readonly effect: EnhancementTransitionEffect;
  readonly state: EnhancementState;
}

export interface RejectedEnhancementTransition {
  readonly accepted: false;
  readonly effect: "none" | "terminal-error";
  readonly reason: EnhancementTransitionRejectionCode;
  /**
   * Invalid nonterminal transitions fail closed to runtime-invariant. Callers must
   * adopt this state even when accepted is false.
   */
  readonly state: EnhancementState;
}

export type EnhancementTransitionResult =
  | AcceptedEnhancementTransition
  | RejectedEnhancementTransition;

function freezeState<T extends EnhancementState>(state: T): T {
  return Object.freeze(state);
}

function accepted(
  state: EnhancementState,
  effect: EnhancementTransitionEffect = "none",
): AcceptedEnhancementTransition {
  return Object.freeze({ accepted: true, effect, state });
}

function rejected(
  state: EnhancementState,
  reason: EnhancementTransitionRejectionCode,
  effect: RejectedEnhancementTransition["effect"],
): RejectedEnhancementTransition {
  return Object.freeze({ accepted: false, effect, reason, state });
}

function loadingManifestState(
  release: ReadyWatchLayerRelease,
  targetProfile: ProfileId,
): LoadingManifestEnhancementState {
  return freezeState({
    activeElapsedMs: 0,
    diagnosticCode: null,
    enhancementVisible: false,
    fallbackVisible: true,
    kind: "loading-manifest",
    release,
    targetProfile,
    terminal: false,
  });
}

function readyState(
  prepared: PreparedProfile,
  activeElapsedMs: number,
): ReadyEnhancementState {
  return freezeState({
    activeElapsedMs,
    diagnosticCode: null,
    enhancementVisible: true,
    fallbackVisible: false,
    kind: "ready",
    prepared,
    release: prepared.release,
    terminal: false,
  });
}

export function createEnhancementState(
  input: CreateEnhancementStateInput,
): EnhancementState {
  if (input.release.status === "fallback-only") {
    return freezeState({
      activeElapsedMs: 0,
      diagnosticCode: null,
      enhancementVisible: false,
      fallbackVisible: true,
      kind: "fallback-only",
      release: input.release,
      terminal: true,
    });
  }

  if (!input.support.supported) {
    return freezeState({
      activeElapsedMs: 0,
      code: input.support.code,
      diagnosticCode: input.support.code,
      enhancementVisible: false,
      fallbackVisible: true,
      kind: "unsupported",
      release: input.release,
      terminal: true,
    });
  }

  return loadingManifestState(input.release, input.profile);
}

function releaseForState(
  state: Exclude<EnhancementState, FallbackOnlyEnhancementState | UnsupportedEnhancementState>,
): ReadyWatchLayerRelease {
  switch (state.kind) {
    case "loading-manifest":
    case "loading-assets":
    case "mounting-hidden":
    case "ready":
    case "profile-switch-loading":
    case "error":
      return state.release;
    default:
      return assertNever(state, "runtime-state release lookup");
  }
}

function activeElapsedForState(
  state: Exclude<EnhancementState, FallbackOnlyEnhancementState | UnsupportedEnhancementState>,
): number {
  return state.activeElapsedMs;
}

function errorState(
  state: Exclude<EnhancementState, FallbackOnlyEnhancementState | UnsupportedEnhancementState | ErrorEnhancementState>,
  code: RuntimeFailureCode,
): ErrorEnhancementState {
  return freezeState({
    activeElapsedMs: activeElapsedForState(state),
    code,
    diagnosticCode: code,
    enhancementVisible: false,
    failedFrom: state.kind,
    failureOrdinal: 1,
    fallbackVisible: true,
    kind: "error",
    release: releaseForState(state),
    terminal: true,
  });
}

function rejectInvalid(
  state: Exclude<EnhancementState, FallbackOnlyEnhancementState | UnsupportedEnhancementState | ErrorEnhancementState>,
  reason: EnhancementTransitionRejectionCode,
): RejectedEnhancementTransition {
  return rejected(errorState(state, "runtime-invariant"), reason, "terminal-error");
}

function profileIssue(
  release: ReadyWatchLayerRelease,
  manifest: ValidatedRuntimeManifest,
  targetProfile: ProfileId,
): EnhancementTransitionRejectionCode | null {
  if (
    manifest.releaseId !== release.releaseId
    || manifest.packageId !== release.packageId
  ) {
    return "manifest-mismatch";
  }

  const profile = manifest.profiles[targetProfile] as EnhancementProfile;
  const expectedScale = targetProfile === "compact" ? 0.5 : 1;
  if (
    profile.id !== targetProfile
    || profile.sourceScale !== expectedScale
    || profile.assets.length === 0
  ) {
    return "profile-invalid";
  }

  const ids = new Set<string>();
  for (const asset of profile.assets) {
    if (asset.profile !== targetProfile || ids.has(asset.id)) {
      return "profile-invalid";
    }
    ids.add(asset.id);
  }

  return null;
}

function sameSourceRect(
  left: PublicAssetRecord["sourceRect"],
  right: PublicAssetRecord["sourceRect"],
): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function sameAssetRecord(
  actual: PublicAssetRecord,
  expected: PublicAssetRecord,
): boolean {
  return actual.id === expected.id
    && actual.profile === expected.profile
    && actual.layerId === expected.layerId
    && actual.file === expected.file
    && actual.publicPath === expected.publicPath
    && actual.mediaType === expected.mediaType
    && actual.magicSignatureHex === expected.magicSignatureHex
    && actual.sha256 === expected.sha256
    && actual.byteLength === expected.byteLength
    && actual.intrinsicWidth === expected.intrinsicWidth
    && actual.intrinsicHeight === expected.intrinsicHeight
    && actual.decodedPixelCount === expected.decodedPixelCount
    && actual.decodedRgbaByteLength === expected.decodedRgbaByteLength
    && actual.zOrder === expected.zOrder
    && sameSourceRect(actual.sourceRect, expected.sourceRect)
    && actual.colorMetadata.alpha === expected.colorMetadata.alpha
    && actual.colorMetadata.channels === expected.colorMetadata.channels
    && actual.colorMetadata.colourspace === expected.colorMetadata.colourspace
    && actual.encoder.alphaQuality === expected.encoder.alphaQuality
    && actual.encoder.channels === expected.encoder.channels
    && actual.encoder.colourspace === expected.encoder.colourspace
    && actual.encoder.effort === expected.encoder.effort
    && actual.encoder.nearLossless === expected.encoder.nearLossless
    && actual.encoder.quality === expected.encoder.quality
    && actual.encoder.smartSubsample === expected.encoder.smartSubsample;
}

function preparedAssetIssue(
  profile: EnhancementProfile,
  completedAssets: readonly PreparedAsset[],
  asset: PreparedAsset,
): EnhancementTransitionRejectionCode | null {
  const expected = profile.assets.find(({ id }) => id === asset.record.id);
  if (expected === undefined) return "asset-unexpected";
  if (completedAssets.some(({ record }) => record.id === asset.record.id)) {
    return "asset-duplicate";
  }
  if (
    !sameAssetRecord(asset.record, expected)
    || typeof asset.objectUrl !== "string"
    || asset.objectUrl.length === 0
    || typeof asset.image !== "object"
    || asset.image === null
  ) {
    return "asset-invalid";
  }
  return null;
}

function addAssetInManifestOrder(
  profile: EnhancementProfile,
  completedAssets: readonly PreparedAsset[],
  asset: PreparedAsset,
): readonly PreparedAsset[] {
  const byId = new Map(completedAssets.map((entry) => [entry.record.id, entry]));
  byId.set(asset.record.id, asset);
  return Object.freeze(profile.assets.flatMap((record) => {
    const completed = byId.get(record.id);
    return completed === undefined ? [] : [completed];
  }));
}

function preparedProfile(
  release: ReadyWatchLayerRelease,
  manifest: ValidatedRuntimeManifest,
  profile: EnhancementProfile,
  assets: readonly PreparedAsset[],
): PreparedProfile {
  return Object.freeze({
    assets,
    id: profile.id,
    manifest,
    profile,
    release,
  });
}

function loadAssetForInitialState(
  state: LoadingAssetsEnhancementState,
  asset: PreparedAsset,
): EnhancementTransitionResult {
  const issue = preparedAssetIssue(state.profile, state.completedAssets, asset);
  if (issue !== null) return rejectInvalid(state, issue);

  const completedAssets = addAssetInManifestOrder(
    state.profile,
    state.completedAssets,
    asset,
  );
  if (completedAssets.length < state.profile.assets.length) {
    return accepted(freezeState({ ...state, completedAssets }));
  }

  const prepared = preparedProfile(
    state.release,
    state.manifest,
    state.profile,
    completedAssets,
  );
  return accepted(freezeState({
    activeElapsedMs: 0,
    diagnosticCode: null,
    enhancementVisible: false,
    fallbackVisible: true,
    kind: "mounting-hidden",
    prepared,
    release: state.release,
    targetProfile: state.targetProfile,
    terminal: false,
  }));
}

function loadAssetForProfileSwitch(
  state: ProfileSwitchAssetsEnhancementState,
  asset: PreparedAsset,
): EnhancementTransitionResult {
  const issue = preparedAssetIssue(state.profile, state.completedAssets, asset);
  if (issue !== null) return rejectInvalid(state, issue);

  const completedAssets = addAssetInManifestOrder(
    state.profile,
    state.completedAssets,
    asset,
  );
  if (completedAssets.length < state.profile.assets.length) {
    return accepted(freezeState({ ...state, completedAssets }));
  }

  const prepared = preparedProfile(
    state.release,
    state.manifest,
    state.profile,
    completedAssets,
  );
  return accepted(freezeState({
    activeElapsedMs: state.activeElapsedMs,
    diagnosticCode: null,
    enhancementVisible: false,
    fallbackVisible: true,
    fromProfile: state.fromProfile,
    kind: "profile-switch-loading",
    manifest: state.manifest,
    prepared,
    release: state.release,
    stage: "mounting-hidden",
    targetProfile: state.targetProfile,
    terminal: false,
  }));
}

function validActiveElapsed(value: number, minimum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value >= 0;
}

function transitionLoadingManifest(
  state: LoadingManifestEnhancementState,
  event: Exclude<EnhancementEvent, { readonly type: "failure" }>,
): EnhancementTransitionResult {
  if (event.type !== "manifest-loaded") {
    return rejectInvalid(state, "event-not-allowed");
  }

  const issue = profileIssue(state.release, event.manifest, state.targetProfile);
  if (issue !== null) return rejectInvalid(state, issue);
  const profile = event.manifest.profiles[state.targetProfile] as EnhancementProfile;
  return accepted(freezeState({
    activeElapsedMs: 0,
    completedAssets: Object.freeze([]),
    diagnosticCode: null,
    enhancementVisible: false,
    fallbackVisible: true,
    kind: "loading-assets",
    manifest: event.manifest,
    profile,
    release: state.release,
    targetProfile: state.targetProfile,
    terminal: false,
  }));
}

function transitionLoadingAssets(
  state: LoadingAssetsEnhancementState,
  event: Exclude<EnhancementEvent, { readonly type: "failure" }>,
): EnhancementTransitionResult {
  if (event.type !== "asset-loaded") {
    return rejectInvalid(state, "event-not-allowed");
  }
  return loadAssetForInitialState(state, event.asset);
}

function transitionMountingHidden(
  state: MountingHiddenEnhancementState,
  event: Exclude<EnhancementEvent, { readonly type: "failure" }>,
): EnhancementTransitionResult {
  if (event.type !== "mount-complete") {
    return rejectInvalid(state, "event-not-allowed");
  }
  if (event.profile !== state.targetProfile || event.profile !== state.prepared.id) {
    return rejectInvalid(state, "mount-profile-mismatch");
  }
  return accepted(readyState(state.prepared, 0), "atomic-ready");
}

function transitionReady(
  state: ReadyEnhancementState,
  event: Exclude<EnhancementEvent, { readonly type: "failure" }>,
): EnhancementTransitionResult {
  if (event.type === "active-time-checkpoint") {
    if (!validActiveElapsed(event.activeElapsedMs, state.activeElapsedMs)) {
      return rejectInvalid(state, "active-elapsed-invalid");
    }
    return accepted(readyState(state.prepared, event.activeElapsedMs));
  }

  if (event.type === "profile-switch-started") {
    if (
      event.targetProfile === state.prepared.id
      || !validActiveElapsed(event.activeElapsedMs, state.activeElapsedMs)
    ) {
      return rejectInvalid(state, "profile-switch-invalid");
    }
    const issue = profileIssue(
      state.release,
      state.prepared.manifest,
      event.targetProfile,
    );
    if (issue !== null) return rejectInvalid(state, issue);
    const profile = state.prepared.manifest.profiles[event.targetProfile] as EnhancementProfile;
    return accepted(freezeState({
      activeElapsedMs: event.activeElapsedMs,
      completedAssets: Object.freeze([]),
      diagnosticCode: null,
      enhancementVisible: false,
      fallbackVisible: true,
      fromProfile: state.prepared.id,
      kind: "profile-switch-loading",
      manifest: state.prepared.manifest,
      profile,
      release: state.release,
      stage: "loading-assets",
      targetProfile: event.targetProfile,
      terminal: false,
    }), "fallback-shown");
  }

  return rejectInvalid(state, "event-not-allowed");
}

function transitionProfileSwitchLoading(
  state: ProfileSwitchLoadingEnhancementState,
  event: Exclude<EnhancementEvent, { readonly type: "failure" }>,
): EnhancementTransitionResult {
  if (state.stage === "loading-assets") {
    if (event.type !== "asset-loaded") {
      return rejectInvalid(state, "event-not-allowed");
    }
    return loadAssetForProfileSwitch(state, event.asset);
  }

  if (event.type !== "mount-complete") {
    return rejectInvalid(state, "event-not-allowed");
  }
  if (event.profile !== state.targetProfile || event.profile !== state.prepared.id) {
    return rejectInvalid(state, "mount-profile-mismatch");
  }
  return accepted(
    readyState(state.prepared, state.activeElapsedMs),
    "atomic-ready",
  );
}

export function transitionEnhancementState(
  state: EnhancementState,
  event: EnhancementEvent,
): EnhancementTransitionResult {
  if (state.terminal) {
    return rejected(state, "terminal-state", "none");
  }

  if (event.type === "failure") {
    return accepted(errorState(state, event.code), "terminal-error");
  }

  switch (state.kind) {
    case "loading-manifest":
      return transitionLoadingManifest(state, event);
    case "loading-assets":
      return transitionLoadingAssets(state, event);
    case "mounting-hidden":
      return transitionMountingHidden(state, event);
    case "ready":
      return transitionReady(state, event);
    case "profile-switch-loading":
      return transitionProfileSwitchLoading(state, event);
    default:
      return assertNever(state, "runtime-state transition");
  }
}

export function getEnhancementDiagnosticCode(
  state: EnhancementState,
): EnhancementDiagnosticCode | null {
  return state.diagnosticCode;
}
