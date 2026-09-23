import { createHash } from "node:crypto";
import fc from "fast-check";
import { expect, it } from "vitest";
import {
  WATCH_LAYER_DELIVERY_PHASES,
  attemptWatchLayerAtomicPublication,
  createWatchLayerDeliveryState,
  createWatchLayerPublicationCandidate,
  makeWatchLayerPhaseAsset,
  rollbackWatchLayerRelease,
  type WatchLayerDeliveryState,
  type WatchLayerPhaseAsset,
  type WatchLayerPhaseName,
  type WatchLayerPublicationCandidate,
  type WatchLayerPublicationResult,
  type WatchLayerRuntimePhase,
} from "./property-13-gate-phases.model";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 13: Deterministic gate precedence and monotonic delivery phases";

// Reproduce with: seed=20250608, numRuns=128.
const PROPERTY_SEED = 20_250_608;
const PROPERTY_RUNS = 128;
const PACKAGE_ID = "watch-layer-package";
const PHASE_STATUSES = ["pending", "approved", "disabled", "rejected"] as const;
const NON_APPROVED_PHASE_STATUSES = ["pending", "disabled", "rejected"] as const;
const APPROVAL_FAULTS = [
  "none",
  "missing",
  "pending",
  "rejected",
  "hash-mismatch",
  "extra-hash",
] as const;
const PHASE_FAULTS = [
  "none",
  "unknown-artifact",
  "stale-projection",
  "runtime-mismatch",
] as const;
const APPROVAL_STATUSES = ["approved", "pending", "rejected"] as const;
const RUNTIME_PHASES = WATCH_LAYER_DELIVERY_PHASES.slice(1) as readonly WatchLayerRuntimePhase[];

type PhaseStatus = (typeof PHASE_STATUSES)[number];
type ApprovalFault = (typeof APPROVAL_FAULTS)[number];
type PhaseFault = (typeof PHASE_FAULTS)[number];
type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

type GateFailureMetadata = {
  readonly code: string;
  readonly issueCode: string;
};

type GateFailure = Error & GateFailureMetadata & {
  readonly failure: {
    readonly code: string;
    readonly issueCode: string;
    readonly ok: false;
  };
};

type ApprovalClosureResult = {
  readonly eligible: boolean;
  readonly ok: boolean;
  readonly reason: string | null;
  readonly releasable: boolean;
};

type ApprovalRecord = {
  artifactSha256: string[];
  decision: "approved" | "pending" | "rejected";
  id: string;
  layerIds: string[];
  notes: string;
  reviewedAt: string | null;
  reviewedPoseIds: string[];
  reviewedZoomPercent: number[];
  reviewer: string | null;
  scope: "release";
};

type ApprovalExpectation = {
  approvalId: string;
  artifactSha256: string[];
  layerIds: string[];
  reviewedPoseIds: string[];
  reviewedZoomPercent: number[];
  scope: "release";
};

type PhaseRecord = {
  approvalId?: string;
  assetSha256: string[];
  name: WatchLayerPhaseName;
  ordinal: number;
  phasePayloadSha256: string;
  runtimeManifestSha256: string | null;
  status: PhaseStatus;
};

type PhaseManifestProjection = {
  readonly packageId: string;
  readonly phases: readonly PhaseRecord[];
  readonly runtimeManifest: { readonly sha256: string } | null;
};

type PhaseReleaseProjection =
  | { readonly status: "fallback-only" }
  | {
      readonly runtimeManifest: { readonly sha256: string };
      readonly status: "ready";
    };

type ReleaseHistoryEntry = {
  readonly approvalStatus: ApprovalStatus;
  readonly depthEnabled: boolean;
  readonly packageId: string;
  readonly packageSha256: string;
  readonly packageVersion: string;
  readonly phase: WatchLayerRuntimePhase | null;
  readonly releaseId: string | null;
  readonly releaseStatus: "fallback-only" | "ready";
  readonly runtimeManifestSha256: string | null;
};

type ReleaseHistory = {
  readonly releases: readonly ReleaseHistoryEntry[];
  readonly schemaVersion: 1;
};

type PhaseFixture = {
  readonly approvalClosed: boolean;
  readonly approvalEntries: readonly {
    readonly expectation: ApprovalExpectation;
    readonly record: ApprovalRecord | null;
    readonly shouldClose: boolean;
  }[];
  readonly approvedPhaseNames: readonly WatchLayerPhaseName[];
  readonly candidate: WatchLayerPublicationCandidate;
  readonly expectedPhaseClosure: boolean;
  readonly input: {
    readonly artifactSha256: readonly string[];
    readonly manifest: PhaseManifestProjection;
    readonly release: PhaseReleaseProjection;
  };
  readonly isContiguousPrefix: boolean;
  readonly selectedPhase: WatchLayerRuntimePhase | null;
};

type Scenario = {
  readonly approvalFault: ApprovalFault;
  readonly approvalTarget: number;
  readonly assetSalts: readonly number[];
  readonly faultNames: readonly string[];
  readonly phaseFault: PhaseFault;
  readonly phaseStatuses: readonly PhaseStatus[];
  readonly phaseTarget: number;
  readonly preserveEarlierAssets: boolean;
  readonly publicationFailureStep: string;
  readonly releaseHistory: ReleaseHistory;
};

type ModelState = {
  candidate: WatchLayerPublicationCandidate;
  delivery: WatchLayerDeliveryState;
};

type RealState = {
  candidate: WatchLayerPublicationCandidate;
  delivery: WatchLayerDeliveryState;
};

type VerifierModule = {
  readonly WATCH_LAYER_GATE_FAILURES: Readonly<Record<string, GateFailureMetadata>>;
  readonly WATCH_LAYER_GATE_ORDER: readonly string[];
  evaluateWatchLayerApprovalRequirement(
    value: Readonly<Record<string, unknown>>,
    expectation: Readonly<Record<string, unknown>>,
  ): ApprovalClosureResult;
  evaluateWatchLayerPhaseClosure(input: {
    readonly artifactSha256: readonly string[];
    readonly manifest: PhaseManifestProjection;
    readonly release: PhaseReleaseProjection;
  }): {
    readonly approvedPhaseNames: readonly string[];
    readonly selectedPhase: string | null;
  };
  verifyWatchLayerGateSequence(
    operations: Readonly<Record<string, () => unknown>>,
  ):
    | { readonly completedGates: readonly string[]; readonly ok: true }
    | Promise<{ readonly completedGates: readonly string[]; readonly ok: true }>;
};

type PublisherModule = {
  readonly WATCH_LAYER_PUBLICATION_STEPS: readonly string[];
  selectLatestContiguousApprovedWatchLayerPhase(
    manifest: { readonly phases: readonly PhaseRecord[] },
  ): PhaseRecord | null;
  selectNewestApprovedWatchLayerRelease(history: ReleaseHistory): ReleaseHistoryEntry;
};

type ManifestClosureModule = {
  hashPhaseProjection(packageId: string, phase: PhaseRecord): string;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const verifier = (await import("../../scripts/verify-watch-layer-assets.mjs")) as unknown as VerifierModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const publisher = (await import("../../scripts/publish-watch-layer-assets.mjs")) as unknown as PublisherModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const manifestClosure = (await import("../../scripts/watch-2-5d/manifest-closure.mjs")) as unknown as ManifestClosureModule;

const gateNameArbitrary = fc.constantFrom(...verifier.WATCH_LAYER_GATE_ORDER);
const simultaneousFaultsArbitrary = fc.uniqueArray(gateNameArbitrary, {
  maxLength: verifier.WATCH_LAYER_GATE_ORDER.length,
  minLength: 2,
});
const anyPhaseVectorArbitrary = fc.array(fc.constantFrom(...PHASE_STATUSES), {
  maxLength: WATCH_LAYER_DELIVERY_PHASES.length,
  minLength: WATCH_LAYER_DELIVERY_PHASES.length,
});
const validPhaseVectorArbitrary = fc
  .integer({ max: WATCH_LAYER_DELIVERY_PHASES.length, min: 0 })
  .chain((approvedCount) => fc.array(fc.constantFrom(...NON_APPROVED_PHASE_STATUSES), {
    maxLength: WATCH_LAYER_DELIVERY_PHASES.length - approvedCount,
    minLength: WATCH_LAYER_DELIVERY_PHASES.length - approvedCount,
  }).map((tail) => [
    ...Array.from({ length: approvedCount }, () => "approved" as const),
    ...tail,
  ]));
const phaseVectorArbitrary = fc.oneof(
  validPhaseVectorArbitrary,
  validPhaseVectorArbitrary,
  anyPhaseVectorArbitrary,
);
const packageVersionArbitrary = fc
  .tuple(
    fc.integer({ max: 20, min: 0 }),
    fc.integer({ max: 20, min: 0 }),
    fc.integer({ max: 20, min: 0 }),
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);
const releaseHistoryArbitrary: fc.Arbitrary<ReleaseHistory> = fc
  .uniqueArray(packageVersionArbitrary, { maxLength: 8, minLength: 1 })
  .chain((versions) => fc.tuple(
    fc.array(fc.constantFrom(...APPROVAL_STATUSES), {
      maxLength: versions.length,
      minLength: versions.length,
    }),
    fc.array(fc.constantFrom<WatchLayerRuntimePhase | null>(null, ...RUNTIME_PHASES), {
      maxLength: versions.length,
      minLength: versions.length,
    }),
  ).map(([approvalStatuses, phases]) => ({
    releases: versions.map((packageVersion, index): ReleaseHistoryEntry => {
      const phase = phases[index];
      const ready = phase !== null;
      return {
        approvalStatus: index === 0 ? "approved" : approvalStatuses[index],
        depthEnabled: phase === "optional-depth",
        packageId: PACKAGE_ID,
        packageSha256: digest(`package:${index}:${packageVersion}`),
        packageVersion,
        phase,
        releaseId: ready ? `release-${index}` : null,
        releaseStatus: ready ? "ready" : "fallback-only",
        runtimeManifestSha256: ready ? digest(`runtime:${index}:${packageVersion}`) : null,
      };
    }),
    schemaVersion: 1 as const,
  })));

const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  approvalFault: fc.constantFrom(...APPROVAL_FAULTS),
  approvalTarget: fc.integer({ max: 3, min: 0 }),
  assetSalts: fc.uniqueArray(fc.integer({ max: 1_000_000, min: 0 }), {
    maxLength: 8,
    minLength: 8,
  }),
  faultNames: simultaneousFaultsArbitrary,
  phaseFault: fc.constantFrom(...PHASE_FAULTS),
  phaseStatuses: phaseVectorArbitrary,
  phaseTarget: fc.integer({ max: 3, min: 0 }),
  preserveEarlierAssets: fc.boolean(),
  publicationFailureStep: fc.constantFrom(...publisher.WATCH_LAYER_PUBLICATION_STEPS),
  releaseHistory: releaseHistoryArbitrary,
});

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function serializedBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function phaseOrdinal(phase: WatchLayerPhaseName): number {
  return WATCH_LAYER_DELIVERY_PHASES.indexOf(phase);
}

function formsApprovedPrefix(statuses: readonly PhaseStatus[]): boolean {
  let nonApprovedSeen = false;
  for (const status of statuses) {
    if (status === "approved" && nonApprovedSeen) return false;
    if (status !== "approved") nonApprovedSeen = true;
  }
  return true;
}

function selectedRuntimePhase(
  statuses: readonly PhaseStatus[],
): WatchLayerRuntimePhase | null {
  if (!formsApprovedPrefix(statuses)) return null;
  let selected: WatchLayerRuntimePhase | null = null;
  statuses.forEach((status, ordinal) => {
    if (status === "approved" && ordinal > 0) {
      selected = WATCH_LAYER_DELIVERY_PHASES[ordinal] as WatchLayerRuntimePhase;
    }
  });
  return selected;
}

function compareSupportedSemanticVersions(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    const ordering = leftPart.length !== rightPart.length
      ? leftPart.length < rightPart.length ? -1 : 1
      : leftPart < rightPart ? -1 : leftPart > rightPart ? 1 : 0;
    if (ordering !== 0) return ordering;
  }
  return 0;
}

function newestApprovedRelease(history: ReleaseHistory): ReleaseHistoryEntry {
  return history.releases
    .filter(({ approvalStatus }) => approvalStatus === "approved")
    .reduce((newest, candidate) => (
      compareSupportedSemanticVersions(newest.packageVersion, candidate.packageVersion) < 0
        ? candidate
        : newest
    ));
}

function buildPhaseAssets(
  salts: readonly number[],
  prefix: string,
): readonly WatchLayerPhaseAsset[] {
  return WATCH_LAYER_DELIVERY_PHASES.map((phase, ordinal) => (
    makeWatchLayerPhaseAsset(
      `asset-${phase}`,
      phase,
      `${prefix}:${phase}:${salts[ordinal]}`,
    )
  ));
}

function uniqueHashes(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function buildPhaseFixture(
  scenario: Scenario,
  baselineAssets: readonly WatchLayerPhaseAsset[],
): PhaseFixture {
  const statuses = [...scenario.phaseStatuses] as PhaseStatus[];
  const isContiguousPrefix = formsApprovedPrefix(statuses);
  const selectedPhase = selectedRuntimePhase(statuses);
  const selectedIndex = selectedPhase === null ? null : phaseOrdinal(selectedPhase);
  const candidateAssets = buildPhaseAssets(scenario.assetSalts.slice(4), "candidate").map(
    (asset, ordinal) => {
      if (ordinal >= 2) return asset;
      if (scenario.preserveEarlierAssets || ordinal !== scenario.phaseTarget % 2) {
        return baselineAssets[ordinal];
      }
      return makeWatchLayerPhaseAsset(
        asset.id,
        asset.phase,
        `${baselineAssets[ordinal].bytes}:changed:${scenario.assetSalts[ordinal + 4]}`,
      );
    },
  );
  const artifactSha256 = candidateAssets.map(({ sha256 }) => sha256);
  const phaseTarget = scenario.phaseTarget % WATCH_LAYER_DELIVERY_PHASES.length;
  const phaseAssetBindings = WATCH_LAYER_DELIVERY_PHASES.map((_, ordinal) => (
    artifactSha256.slice(0, ordinal + 1)
  ));
  if (scenario.phaseFault === "unknown-artifact") {
    phaseAssetBindings[phaseTarget] = [
      ...phaseAssetBindings[phaseTarget],
      digest(`unknown:${scenario.assetSalts[phaseTarget]}`),
    ];
  }

  const phases = WATCH_LAYER_DELIVERY_PHASES.map((name, ordinal): PhaseRecord => ({
    ...(statuses[ordinal] === "approved" ? { approvalId: `approval-phase-${ordinal}` } : {}),
    assetSha256: phaseAssetBindings[ordinal],
    name,
    ordinal,
    phasePayloadSha256: digest(`placeholder:${ordinal}`),
    runtimeManifestSha256: statuses[ordinal] === "approved" && ordinal > 0
      ? digest(`runtime:${name}:${scenario.assetSalts[ordinal]}`)
      : null,
    status: statuses[ordinal],
  }));
  phases.forEach((phase) => {
    phase.phasePayloadSha256 = manifestClosure.hashPhaseProjection(PACKAGE_ID, phase);
  });
  if (scenario.phaseFault === "stale-projection") {
    phases[phaseTarget].phasePayloadSha256 = digest(
      `stale:${phases[phaseTarget].phasePayloadSha256}`,
    );
  }

  const approvedIndices = phases
    .map((phase, ordinal) => ({ ordinal, phase }))
    .filter(({ phase }) => phase.status === "approved")
    .map(({ ordinal }) => ordinal);
  const approvalTarget = approvedIndices.length === 0
    ? null
    : approvedIndices[scenario.approvalTarget % approvedIndices.length];
  const approvalEntries = approvedIndices.map((ordinal) => {
    const phase = phases[ordinal];
    const approvalId = `approval-phase-${ordinal}`;
    const expectedHashes = uniqueHashes([
      phase.phasePayloadSha256,
      phase.runtimeManifestSha256,
      ...phase.assetSha256,
    ]);
    const expectation: ApprovalExpectation = {
      approvalId,
      artifactSha256: expectedHashes,
      layerIds: [],
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [],
      scope: "release",
    };
    let record: ApprovalRecord | null = {
      artifactSha256: [...expectedHashes],
      decision: "approved",
      id: approvalId,
      layerIds: [],
      notes: "Exact generated phase release decision.",
      reviewedAt: "2026-06-08T00:00:00.000Z",
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [],
      reviewer: "property-reviewer",
      scope: "release",
    };
    const targeted = ordinal === approvalTarget;
    if (targeted) {
      switch (scenario.approvalFault) {
        case "missing":
          delete phase.approvalId;
          record = null;
          break;
        case "pending":
          record = {
            ...record,
            decision: "pending",
            reviewedAt: null,
            reviewer: null,
          };
          break;
        case "rejected":
          record = { ...record, decision: "rejected" };
          break;
        case "hash-mismatch":
          record = {
            ...record,
            artifactSha256: [
              digest(`approval-mismatch:${scenario.assetSalts[ordinal]}`),
              ...record.artifactSha256.slice(1),
            ],
          };
          break;
        case "extra-hash":
          record = {
            ...record,
            artifactSha256: [
              ...record.artifactSha256,
              digest(`approval-extra:${scenario.assetSalts[ordinal]}`),
            ],
          };
          break;
        case "none":
          break;
      }
    }
    return {
      expectation,
      record,
      shouldClose: !targeted || scenario.approvalFault === "none",
    };
  });

  const selectedRecord = selectedIndex === null ? null : phases[selectedIndex];
  const selectedRuntimeHash = selectedRecord?.runtimeManifestSha256 ?? null;
  const releaseRuntimeHash = (
    selectedRuntimeHash !== null && scenario.phaseFault === "runtime-mismatch"
  )
    ? digest(`wrong-runtime:${selectedRuntimeHash}`)
    : selectedRuntimeHash;
  const ready = selectedRuntimeHash !== null;
  const selectedApprovalMissing = selectedIndex !== null
    && approvalTarget === selectedIndex
    && scenario.approvalFault === "missing";
  const phaseFaultBlocksClosure = scenario.phaseFault === "unknown-artifact"
    || scenario.phaseFault === "stale-projection"
    || (scenario.phaseFault === "runtime-mismatch" && ready);
  const expectedPhaseClosure = isContiguousPrefix
    && !phaseFaultBlocksClosure
    && !selectedApprovalMissing;
  const approvalClosed = approvalEntries.every(({ shouldClose }) => shouldClose);

  return {
    approvalClosed,
    approvalEntries,
    approvedPhaseNames: phases
      .filter(({ status }) => status === "approved")
      .map(({ name }) => name),
    candidate: createWatchLayerPublicationCandidate({
      gatePassed: expectedPhaseClosure && approvalClosed,
      phaseAssets: candidateAssets,
      selectedPhase,
    }),
    expectedPhaseClosure,
    input: {
      artifactSha256,
      manifest: {
        packageId: PACKAGE_ID,
        phases,
        runtimeManifest: ready ? { sha256: selectedRuntimeHash } : null,
      },
      release: ready
        ? { runtimeManifest: { sha256: releaseRuntimeHash as string }, status: "ready" }
        : { status: "fallback-only" },
    },
    isContiguousPrefix,
    selectedPhase,
  };
}

function captureSynchronousFailure(operation: () => unknown): GateFailure {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error) return error as GateFailure;
    throw error;
  }
  throw new Error("Expected synchronous layer-gate operation to fail");
}

function canonicalStateAssets(
  assets: readonly WatchLayerPhaseAsset[],
  selectedPhase: WatchLayerRuntimePhase,
): readonly WatchLayerPhaseAsset[] {
  const selectedOrdinal = phaseOrdinal(selectedPhase);
  return [...assets]
    .filter(({ phase }) => phaseOrdinal(phase) <= selectedOrdinal)
    .sort((left, right) => (
      phaseOrdinal(left.phase) - phaseOrdinal(right.phase)
      || left.id.localeCompare(right.id)
    ));
}

function referencePublication(
  state: WatchLayerDeliveryState,
  candidate: WatchLayerPublicationCandidate,
  failureStep: string | null,
): WatchLayerPublicationResult {
  if (!candidate.gatePassed || candidate.selectedPhase === null) {
    return { outcome: "gate-failed", published: false, state };
  }
  if (failureStep !== null) {
    return { outcome: "publication-failed", published: false, state };
  }
  if (phaseOrdinal(candidate.selectedPhase) < phaseOrdinal(state.approvedThrough)) {
    return { outcome: "non-monotonic", published: false, state };
  }
  const candidateAssets = canonicalStateAssets(candidate.phaseAssets, candidate.selectedPhase);
  const candidateById = new Map(candidateAssets.map((asset) => [asset.id, asset]));
  const changedEarlierAsset = state.installedAssets.some((asset) => {
    const next = candidateById.get(asset.id);
    return next === undefined
      || next.phase !== asset.phase
      || next.sha256 !== asset.sha256
      || next.bytes !== asset.bytes;
  });
  if (changedEarlierAsset) {
    return { outcome: "earlier-assets-changed", published: false, state };
  }
  return {
    outcome: "published",
    published: true,
    state: {
      approvedThrough: candidate.selectedPhase,
      installedAssets: candidateAssets,
      release: { selectedPhase: candidate.selectedPhase, status: "ready" },
    },
  };
}

function referenceRollback(
  state: WatchLayerDeliveryState,
  selectedPhase: WatchLayerRuntimePhase | null,
): WatchLayerDeliveryState {
  return {
    approvedThrough: state.approvedThrough,
    installedAssets: state.installedAssets,
    release: selectedPhase === null
      ? { selectedPhase: null, status: "fallback-only" }
      : { selectedPhase, status: "ready" },
  };
}

function validCandidateThrough(
  selectedPhase: WatchLayerRuntimePhase,
  existingAssets: readonly WatchLayerPhaseAsset[],
  salt: number,
): WatchLayerPublicationCandidate {
  const targetOrdinal = phaseOrdinal(selectedPhase);
  const existingByPhase = new Map(existingAssets.map((asset) => [asset.phase, asset]));
  const phaseAssets = WATCH_LAYER_DELIVERY_PHASES
    .slice(0, targetOrdinal + 1)
    .map((phase) => existingByPhase.get(phase) ?? makeWatchLayerPhaseAsset(
      `asset-${phase}`,
      phase,
      `workflow:${phase}:${salt}`,
    ));
  return createWatchLayerPublicationCandidate({
    gatePassed: true,
    phaseAssets,
    selectedPhase,
  });
}

function normalizeRollbackTarget(
  requestedOrdinal: number,
  approvedThrough: WatchLayerRuntimePhase,
): WatchLayerRuntimePhase | null {
  if (requestedOrdinal < 1) return null;
  const approvedOrdinal = phaseOrdinal(approvedThrough);
  const selectedOrdinal = Math.min(requestedOrdinal, approvedOrdinal);
  return WATCH_LAYER_DELIVERY_PHASES[selectedOrdinal] as WatchLayerRuntimePhase;
}

class PublishCommand implements fc.Command<ModelState, RealState> {
  constructor(readonly failureStep: string | null) {}

  check(): boolean {
    return true;
  }

  run(model: ModelState, real: RealState): void {
    const expected = referencePublication(model.delivery, model.candidate, this.failureStep);
    const actual = attemptWatchLayerAtomicPublication(
      real.delivery,
      real.candidate,
      this.failureStep,
      publisher.WATCH_LAYER_PUBLICATION_STEPS,
    );
    model.delivery = expected.state;
    real.delivery = actual.state;
    expect(actual.outcome).toBe(expected.outcome);
    expect(actual.published).toBe(expected.published);
    expect(real.delivery).toEqual(model.delivery);
  }

  toString(): string {
    return `publish(${this.failureStep ?? "success"})`;
  }
}

class RollbackCommand implements fc.Command<ModelState, RealState> {
  constructor(readonly requestedOrdinal: number) {}

  check(): boolean {
    return true;
  }

  run(model: ModelState, real: RealState): void {
    const selectedPhase = normalizeRollbackTarget(
      this.requestedOrdinal,
      model.delivery.approvedThrough,
    );
    const installedBefore = real.delivery.installedAssets;
    model.delivery = referenceRollback(model.delivery, selectedPhase);
    real.delivery = rollbackWatchLayerRelease(real.delivery, selectedPhase);
    expect(real.delivery).toEqual(model.delivery);
    expect(real.delivery.installedAssets).toBe(installedBefore);
  }

  toString(): string {
    return `rollback(${this.requestedOrdinal})`;
  }
}

class StageLaterCandidateCommand implements fc.Command<ModelState, RealState> {
  constructor(
    readonly targetOrdinal: number,
    readonly gatePassed: boolean,
    readonly mutateEarlierAsset: boolean,
    readonly salt: number,
  ) {}

  check(): boolean {
    return true;
  }

  run(model: ModelState, real: RealState): void {
    const currentOrdinal = phaseOrdinal(model.delivery.approvedThrough);
    const selectedOrdinal = Math.max(currentOrdinal, Math.min(3, this.targetOrdinal));
    const selectedPhase = WATCH_LAYER_DELIVERY_PHASES[selectedOrdinal] as WatchLayerRuntimePhase;
    const baseCandidate = validCandidateThrough(
      selectedPhase,
      model.delivery.installedAssets,
      this.salt,
    );
    let phaseAssets = baseCandidate.phaseAssets;
    if (this.mutateEarlierAsset && phaseAssets.length > 0) {
      const [first, ...rest] = phaseAssets;
      phaseAssets = [
        makeWatchLayerPhaseAsset(
          first.id,
          first.phase,
          `${first.bytes}:mutated:${this.salt}`,
        ),
        ...rest,
      ];
    }
    const candidate = createWatchLayerPublicationCandidate({
      gatePassed: this.gatePassed,
      phaseAssets,
      selectedPhase,
    });
    model.candidate = candidate;
    real.candidate = candidate;
    expect(real.delivery).toEqual(model.delivery);
  }

  toString(): string {
    return `stage-later(${this.targetOrdinal},${this.gatePassed},${this.mutateEarlierAsset})`;
  }
}

const modelCommandArbitraries: fc.Arbitrary<fc.Command<ModelState, RealState>>[] = [
  fc.option(fc.constantFrom(...publisher.WATCH_LAYER_PUBLICATION_STEPS), { nil: null })
    .map((failureStep) => new PublishCommand(failureStep)),
  fc.integer({ max: 3, min: -1 })
    .map((ordinal) => new RollbackCommand(ordinal)),
  fc.record({
    gatePassed: fc.boolean(),
    mutateEarlierAsset: fc.boolean(),
    salt: fc.integer({ max: 1_000_000, min: 0 }),
    targetOrdinal: fc.integer({ max: 3, min: 1 }),
  }).map(({ gatePassed, mutateEarlierAsset, salt, targetOrdinal }) => (
    new StageLaterCandidateCommand(
      targetOrdinal,
      gatePassed,
      mutateEarlierAsset,
      salt,
    )
  )),
];
const modelCommandsArbitrary = fc.commands(modelCommandArbitraries, { maxCommands: 24 });

function assertGatePrecedence(scenario: Scenario): void {
  const generatedPackage = {
    faults: Object.fromEntries(verifier.WATCH_LAYER_GATE_ORDER.map((name) => [
      name,
      scenario.faultNames.includes(name),
    ])),
    packageId: PACKAGE_ID,
  };
  const before = structuredClone(generatedPackage);
  const bytesBefore = serializedBytes(generatedPackage);
  const executedGates: string[] = [];
  const operations = Object.fromEntries(verifier.WATCH_LAYER_GATE_ORDER.map((name) => [
    name,
    () => {
      executedGates.push(name);
      if (generatedPackage.faults[name]) throw new Error(`generated fault at ${name}`);
    },
  ]));
  const firstFaultIndex = verifier.WATCH_LAYER_GATE_ORDER.findIndex((name) => (
    generatedPackage.faults[name]
  ));
  const firstFaultName = verifier.WATCH_LAYER_GATE_ORDER[firstFaultIndex];
  const expectedFailure = verifier.WATCH_LAYER_GATE_FAILURES[firstFaultName];
  const failure = captureSynchronousFailure(() => (
    verifier.verifyWatchLayerGateSequence(operations)
  ));

  expect(failure).toMatchObject({
    code: expectedFailure.code,
    failure: {
      code: expectedFailure.code,
      issueCode: expectedFailure.issueCode,
      ok: false,
    },
    issueCode: expectedFailure.issueCode,
  });
  expect(executedGates).toEqual(verifier.WATCH_LAYER_GATE_ORDER.slice(0, firstFaultIndex + 1));
  expect(generatedPackage).toEqual(before);
  expect(serializedBytes(generatedPackage)).toEqual(bytesBefore);
}

function assertPhaseAndApprovalClosure(fixture: PhaseFixture): void {
  const inputBefore = structuredClone(fixture.input);
  const inputBytesBefore = serializedBytes(fixture.input);

  if (fixture.expectedPhaseClosure) {
    expect(verifier.evaluateWatchLayerPhaseClosure(fixture.input)).toEqual({
      approvedPhaseNames: fixture.approvedPhaseNames,
      selectedPhase: fixture.selectedPhase,
    });
  } else {
    expect(captureSynchronousFailure(() => (
      verifier.evaluateWatchLayerPhaseClosure(fixture.input)
    ))).toMatchObject({ code: "LAYER_PROVENANCE_INVALID" });
  }

  if (fixture.isContiguousPrefix) {
    expect(
      publisher.selectLatestContiguousApprovedWatchLayerPhase(fixture.input.manifest)?.name ?? null,
    ).toBe(fixture.selectedPhase);
  } else {
    expect(captureSynchronousFailure(() => (
      publisher.selectLatestContiguousApprovedWatchLayerPhase(fixture.input.manifest)
    ))).toMatchObject({ issueCode: "LAYER_PUBLISH_HISTORY_INVALID" });
  }

  for (const entry of fixture.approvalEntries) {
    if (entry.record === null) {
      expect(entry.shouldClose).toBe(false);
      continue;
    }
    const closure = verifier.evaluateWatchLayerApprovalRequirement(
      entry.record,
      entry.expectation,
    );
    expect(closure.eligible).toBe(entry.shouldClose);
    expect(closure.ok).toBe(entry.shouldClose);
    expect(closure.releasable).toBe(entry.shouldClose);
  }
  expect(fixture.approvalEntries.every(({ shouldClose }) => shouldClose))
    .toBe(fixture.approvalClosed);
  expect(fixture.input).toEqual(inputBefore);
  expect(serializedBytes(fixture.input)).toEqual(inputBytesBefore);
}

function runRequiredPublicationWorkflow(
  scenario: Scenario,
  initialState: WatchLayerDeliveryState,
  failedCandidate: WatchLayerPublicationCandidate,
): WatchLayerDeliveryState {
  const blocked = attemptWatchLayerAtomicPublication(
    initialState,
    createWatchLayerPublicationCandidate({
      gatePassed: false,
      phaseAssets: failedCandidate.phaseAssets,
      selectedPhase: failedCandidate.selectedPhase,
    }),
    null,
    publisher.WATCH_LAYER_PUBLICATION_STEPS,
  );
  expect(blocked).toMatchObject({ outcome: "gate-failed", published: false });
  expect(blocked.state).toBe(initialState);

  const motionCandidate = validCandidateThrough(
    "approved-part-motion",
    initialState.installedAssets,
    scenario.assetSalts[6],
  );
  for (const failureStep of publisher.WATCH_LAYER_PUBLICATION_STEPS) {
    const interrupted = attemptWatchLayerAtomicPublication(
      initialState,
      motionCandidate,
      failureStep,
      publisher.WATCH_LAYER_PUBLICATION_STEPS,
    );
    expect(interrupted).toMatchObject({
      outcome: "publication-failed",
      published: false,
    });
    expect(interrupted.state).toBe(initialState);
  }

  const motionPublished = attemptWatchLayerAtomicPublication(
    initialState,
    motionCandidate,
    null,
    publisher.WATCH_LAYER_PUBLICATION_STEPS,
  );
  expect(motionPublished).toMatchObject({
    outcome: "published",
    published: true,
    state: { release: { selectedPhase: "approved-part-motion", status: "ready" } },
  });
  const motionState = motionPublished.state;
  const motionBytes = serializedBytes(motionState.installedAssets);

  const depthCandidate = validCandidateThrough(
    "optional-depth",
    motionState.installedAssets,
    scenario.assetSalts[7],
  );
  const interruptedDepth = attemptWatchLayerAtomicPublication(
    motionState,
    depthCandidate,
    scenario.publicationFailureStep,
    publisher.WATCH_LAYER_PUBLICATION_STEPS,
  );
  expect(interruptedDepth.state).toBe(motionState);
  expect(serializedBytes(interruptedDepth.state.installedAssets)).toEqual(motionBytes);

  const depthPublished = attemptWatchLayerAtomicPublication(
    motionState,
    depthCandidate,
    null,
    publisher.WATCH_LAYER_PUBLICATION_STEPS,
  );
  expect(depthPublished.published).toBe(true);
  const depthState = depthPublished.state;
  expect(depthState.installedAssets.slice(0, motionState.installedAssets.length))
    .toEqual(motionState.installedAssets);

  const [firstAsset, ...otherAssets] = depthCandidate.phaseAssets;
  const changedEarlierCandidate = createWatchLayerPublicationCandidate({
    gatePassed: true,
    phaseAssets: [
      makeWatchLayerPhaseAsset(
        firstAsset.id,
        firstAsset.phase,
        `${firstAsset.bytes}:forbidden-later-change:${scenario.assetSalts[0]}`,
      ),
      ...otherAssets,
    ],
    selectedPhase: "optional-depth",
  });
  const blockedEarlierChange = attemptWatchLayerAtomicPublication(
    depthState,
    changedEarlierCandidate,
    null,
    publisher.WATCH_LAYER_PUBLICATION_STEPS,
  );
  expect(blockedEarlierChange).toMatchObject({
    outcome: "earlier-assets-changed",
    published: false,
  });
  expect(blockedEarlierChange.state).toBe(depthState);

  for (const rollbackPhase of [
    null,
    "static-layered-reconstruction",
    "approved-part-motion",
    "optional-depth",
  ] as const) {
    const rolledBack = rollbackWatchLayerRelease(depthState, rollbackPhase);
    expect(rolledBack.installedAssets).toBe(depthState.installedAssets);
    expect(serializedBytes(rolledBack.installedAssets))
      .toEqual(serializedBytes(depthState.installedAssets));
    expect(rolledBack.release.selectedPhase).toBe(rollbackPhase);
  }
  return depthState;
}

// **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.8, 13.9, 13.14, 13.17, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10**
// Feature: interactive-layered-watch-2-5d, Property 13: Deterministic gate precedence and monotonic delivery phases
it(PROPERTY_TAG, { timeout: 120_000 }, () => {
  fc.assert(
    fc.property(
      scenarioArbitrary,
      modelCommandsArbitrary,
      (scenario, commands) => {
        assertGatePrecedence(scenario);

        const baselineAssets = buildPhaseAssets(scenario.assetSalts, "baseline");
        const baselineCandidate = createWatchLayerPublicationCandidate({
          gatePassed: true,
          phaseAssets: baselineAssets,
          selectedPhase: "static-layered-reconstruction",
        });
        const initialState = createWatchLayerDeliveryState(baselineCandidate);
        const phaseFixture = buildPhaseFixture(scenario, baselineAssets);
        assertPhaseAndApprovalClosure(phaseFixture);

        const historyBefore = structuredClone(scenario.releaseHistory);
        const historyBytesBefore = serializedBytes(scenario.releaseHistory);
        expect(publisher.selectNewestApprovedWatchLayerRelease(scenario.releaseHistory))
          .toEqual(newestApprovedRelease(scenario.releaseHistory));
        expect(scenario.releaseHistory).toEqual(historyBefore);
        expect(serializedBytes(scenario.releaseHistory)).toEqual(historyBytesBefore);

        const finalRequiredState = runRequiredPublicationWorkflow(
          scenario,
          initialState,
          phaseFixture.candidate,
        );
        expect(finalRequiredState.approvedThrough).toBe("optional-depth");

        fc.modelRun(
          () => ({
            model: { candidate: phaseFixture.candidate, delivery: initialState },
            real: { candidate: phaseFixture.candidate, delivery: initialState },
          }),
          commands,
        );
      },
    ),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
