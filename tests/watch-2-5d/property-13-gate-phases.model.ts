import { createHash } from "node:crypto";

export const WATCH_LAYER_DELIVERY_PHASES = [
  "source-preparation",
  "static-layered-reconstruction",
  "approved-part-motion",
  "optional-depth",
] as const;

export type WatchLayerPhaseName = (typeof WATCH_LAYER_DELIVERY_PHASES)[number];
export type WatchLayerRuntimePhase = Exclude<WatchLayerPhaseName, "source-preparation">;

export type WatchLayerPhaseAsset = Readonly<{
  bytes: string;
  id: string;
  phase: WatchLayerPhaseName;
  sha256: string;
}>;

export type WatchLayerPublicationCandidate = Readonly<{
  gatePassed: boolean;
  phaseAssets: readonly WatchLayerPhaseAsset[];
  selectedPhase: WatchLayerRuntimePhase | null;
}>;

export type WatchLayerDeliveryState = Readonly<{
  approvedThrough: WatchLayerRuntimePhase;
  installedAssets: readonly WatchLayerPhaseAsset[];
  release: Readonly<{
    selectedPhase: WatchLayerRuntimePhase | null;
    status: "fallback-only" | "ready";
  }>;
}>;

export type WatchLayerPublicationResult = Readonly<{
  outcome:
    | "earlier-assets-changed"
    | "gate-failed"
    | "non-monotonic"
    | "publication-failed"
    | "published";
  published: boolean;
  state: WatchLayerDeliveryState;
}>;

const SHA256 = /^[a-f\d]{64}$/u;
const RUNTIME_PHASES = new Set<WatchLayerPhaseName>(
  WATCH_LAYER_DELIVERY_PHASES.slice(1),
);

function phaseOrdinal(phase: WatchLayerPhaseName): number {
  return WATCH_LAYER_DELIVERY_PHASES.indexOf(phase);
}

function hashBytes(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

function canonicalAssets(
  assets: readonly WatchLayerPhaseAsset[],
): readonly WatchLayerPhaseAsset[] {
  const ids = new Set<string>();
  const canonical = assets.map((asset) => {
    if (
      typeof asset.id !== "string"
      || asset.id.length === 0
      || !WATCH_LAYER_DELIVERY_PHASES.includes(asset.phase)
      || typeof asset.bytes !== "string"
      || !SHA256.test(asset.sha256)
      || hashBytes(asset.bytes) !== asset.sha256
      || ids.has(asset.id)
    ) {
      throw new TypeError("Phase assets require unique IDs and exact byte hashes");
    }
    ids.add(asset.id);
    return Object.freeze({ ...asset });
  });
  canonical.sort((left, right) => (
    phaseOrdinal(left.phase) - phaseOrdinal(right.phase)
    || left.id.localeCompare(right.id)
  ));
  return Object.freeze(canonical);
}

function assertRuntimePhase(
  phase: WatchLayerRuntimePhase | null,
): asserts phase is WatchLayerRuntimePhase | null {
  if (phase !== null && !RUNTIME_PHASES.has(phase)) {
    throw new TypeError("Release selection must be a runtime-capable delivery phase");
  }
}

export function makeWatchLayerPhaseAsset(
  id: string,
  phase: WatchLayerPhaseName,
  bytes: string,
): WatchLayerPhaseAsset {
  return Object.freeze({
    bytes,
    id,
    phase,
    sha256: hashBytes(bytes),
  });
}

export function createWatchLayerPublicationCandidate(input: {
  readonly gatePassed: boolean;
  readonly phaseAssets: readonly WatchLayerPhaseAsset[];
  readonly selectedPhase: WatchLayerRuntimePhase | null;
}): WatchLayerPublicationCandidate {
  assertRuntimePhase(input.selectedPhase);
  return Object.freeze({
    gatePassed: input.gatePassed === true,
    phaseAssets: canonicalAssets(input.phaseAssets),
    selectedPhase: input.selectedPhase,
  });
}

export function createWatchLayerDeliveryState(
  candidate: WatchLayerPublicationCandidate,
): WatchLayerDeliveryState {
  if (!candidate.gatePassed || candidate.selectedPhase === null) {
    throw new TypeError("Initial delivery state requires one passing runtime phase");
  }
  const selectedOrdinal = phaseOrdinal(candidate.selectedPhase);
  const installedAssets = canonicalAssets(candidate.phaseAssets.filter(
    ({ phase }) => phaseOrdinal(phase) <= selectedOrdinal,
  ));
  return Object.freeze({
    approvedThrough: candidate.selectedPhase,
    installedAssets,
    release: Object.freeze({
      selectedPhase: candidate.selectedPhase,
      status: "ready" as const,
    }),
  });
}

function unchangedResult(
  state: WatchLayerDeliveryState,
  outcome: Exclude<WatchLayerPublicationResult["outcome"], "published">,
): WatchLayerPublicationResult {
  return Object.freeze({ outcome, published: false, state });
}

/**
 * Pure transaction oracle for the publication boundaries exported by the real
 * publisher. It deliberately models only atomic commit/rollback and immutable
 * earlier phase assets; filesystem mechanics remain covered by focused tests.
 */
export function attemptWatchLayerAtomicPublication(
  state: WatchLayerDeliveryState,
  candidate: WatchLayerPublicationCandidate,
  failureStep: string | null,
  publicationSteps: readonly string[],
): WatchLayerPublicationResult {
  if (
    failureStep !== null
    && !publicationSteps.includes(failureStep)
  ) {
    throw new TypeError("Publication failure step must be documented by the publisher");
  }
  if (!candidate.gatePassed || candidate.selectedPhase === null) {
    return unchangedResult(state, "gate-failed");
  }
  if (failureStep !== null) {
    return unchangedResult(state, "publication-failed");
  }

  const currentOrdinal = phaseOrdinal(state.approvedThrough);
  const selectedOrdinal = phaseOrdinal(candidate.selectedPhase);
  if (selectedOrdinal < currentOrdinal) {
    return unchangedResult(state, "non-monotonic");
  }

  const candidateAssets = canonicalAssets(candidate.phaseAssets.filter(
    ({ phase }) => phaseOrdinal(phase) <= selectedOrdinal,
  ));
  const candidateById = new Map(candidateAssets.map((asset) => [asset.id, asset]));
  const earlierAssetsChanged = state.installedAssets.some((installed) => {
    const candidateAsset = candidateById.get(installed.id);
    return candidateAsset === undefined
      || candidateAsset.phase !== installed.phase
      || candidateAsset.sha256 !== installed.sha256
      || candidateAsset.bytes !== installed.bytes;
  });
  if (earlierAssetsChanged) {
    return unchangedResult(state, "earlier-assets-changed");
  }

  const nextState = Object.freeze({
    approvedThrough: candidate.selectedPhase,
    installedAssets: candidateAssets,
    release: Object.freeze({
      selectedPhase: candidate.selectedPhase,
      status: "ready" as const,
    }),
  });
  return Object.freeze({
    outcome: "published" as const,
    published: true,
    state: nextState,
  });
}

/** Rollback changes only release metadata and keeps all installed bytes intact. */
export function rollbackWatchLayerRelease(
  state: WatchLayerDeliveryState,
  selectedPhase: WatchLayerRuntimePhase | null,
): WatchLayerDeliveryState {
  assertRuntimePhase(selectedPhase);
  if (
    selectedPhase !== null
    && phaseOrdinal(selectedPhase) > phaseOrdinal(state.approvedThrough)
  ) {
    throw new TypeError("Rollback cannot select a phase newer than the approved release");
  }
  return Object.freeze({
    approvedThrough: state.approvedThrough,
    installedAssets: state.installedAssets,
    release: Object.freeze(selectedPhase === null
      ? { selectedPhase: null, status: "fallback-only" as const }
      : { selectedPhase, status: "ready" as const }),
  });
}
