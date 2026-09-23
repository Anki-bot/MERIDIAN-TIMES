import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { expect, it } from "vitest";
import {
  IDENTITY_MATRIX_2D,
  isIdentityMatrix,
  sampleApprovedLayerMotion,
  sampleApprovedMotionSet,
} from "@/lib/watch-2-5d/motion";
import type {
  LayerId,
  ValidatedRuntimeManifest,
} from "@/lib/watch-2-5d/types";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 5: Approved-motion eligibility and static default";

// Reproduce with: seed=20260605, numRuns=128.
const PROPERTY_SEED = 20_260_605;
const PROPERTY_RUNS = 128;

const MOTION_CLASSES = [
  "central-hand",
  "subdial-hand",
  "exposed-rotor",
  "exposed-gear",
  "visible-oscillator",
] as const;
const STATIC_CLASSES = [
  "dial-face",
  "subdial-face",
  "index",
  "text",
  "logo",
  "bridge",
  "plate",
  "screw",
  "jewel",
  "case",
  "crystal",
  "background",
  "unclassified",
] as const;
const MOTION_CLASS_SET = new Set<string>(MOTION_CLASSES);

const CANDIDATE_LAYER_ID = "layer-generated-part";
const STATIC_LAYER_ID = "layer-static-part";
const SEGMENTATION_MASK_ID = "mask-generated-segmentation";
const REGION_MASK_ID = "mask-generated-reconstruction-region";
const BOUNDARY_MASK_ID = "mask-generated-reconstruction-boundary";
const RECONSTRUCTION_ID = "reconstruction-generated-part";
const FILL_ID = "fill-generated-reconstruction";
const MOTION_ID = "motion-generated-part";
const SEGMENTATION_APPROVAL_ID = "approval-generated-segmentation";
const PIVOT_APPROVAL_ID = "approval-generated-pivot";
const RECONSTRUCTION_APPROVAL_ID = "approval-generated-reconstruction";
const MOTION_APPROVAL_ID = "approval-generated-motion";
const RELEASE_APPROVAL_ID = "approval-generated-release";

const PROVENANCE_IDS = Object.freeze({
  boundary: "provenance-generated-boundary",
  fill: "provenance-generated-fill",
  layer: "provenance-generated-layer",
  motion: "provenance-generated-motion",
  region: "provenance-generated-region",
  segmentation: "provenance-generated-segmentation",
} as const);

const CLOSURE_FAULTS = [
  "mask-missing",
  "pivot-missing",
  "reconstruction-missing",
  "profile-missing",
  "provenance-mask",
  "provenance-layer",
  "provenance-reconstruction",
  "provenance-motion",
  "approval-segmentation",
  "approval-pivot",
  "approval-reconstruction",
  "approval-motion",
  "approval-release",
  "approvals-empty",
] as const;

type SemanticClass = (typeof MOTION_CLASSES)[number] | (typeof STATIC_CLASSES)[number];
type ClosureFault = (typeof CLOSURE_FAULTS)[number];
type MotionKind = "continuous-rotation" | "discrete-rotation" | "oscillation";
type JsonRecord = Record<string, unknown>;

type StrictSchema = {
  serialize(value: unknown): Buffer;
  serializeLine(value: unknown): Buffer;
};

type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: Readonly<JsonRecord> & { readonly sha256: string };
  readonly CANONICAL_IDENTITY_MATRIX: Readonly<JsonRecord>;
  readonly CANONICAL_PROJECT_PATHS: Readonly<JsonRecord> & {
    readonly predecessorSpecDirectory: string;
  };
  readonly CANONICAL_SOURCE_COORDINATE_SPACE: Readonly<JsonRecord>;
  readonly ENHANCEMENT_BUDGETS: Readonly<JsonRecord>;
  readonly LAYER_RECORD_SCHEMA: StrictSchema;
  readonly MOTION_PROFILE_SCHEMA: StrictSchema;
  readonly PREDECESSOR_MANIFEST_IDENTITY: Readonly<JsonRecord> & {
    readonly sha256: string;
  };
  readonly RUNTIME_MANIFEST_SCHEMA: StrictSchema;
  serializeCanonicalJson(value: unknown): Buffer;
  sha256(value: string | ArrayBufferView): string;
};

type ClosureResult = Readonly<{
  eligible: boolean;
  issueCode: string | null;
  message: string;
  ok: boolean;
}>;

type ClosureModule = {
  evaluateManifestClosure(value: unknown): ClosureResult;
  hashPhaseProjection(packageId: string, phase: PhaseRecord): string;
};

type Scenario = Readonly<{
  amplitudeHundredths: number;
  cadenceMs: number;
  direction: -1 | 1;
  discreteSteps: number;
  elapsedNumerator: number;
  evidence: "visible-evidence" | "authored-assumption";
  faults: readonly ClosureFault[];
  maskPixelCount: number;
  periodMs: number;
  pivotX: number;
  pivotY: number;
  profileKind: MotionKind;
  reconstructionPixelCount: number;
  semanticClass: SemanticClass;
  stepDivisor: number;
}>;

type ArtifactIdentity = {
  classification: "source-derived" | "synthetic";
  id: string;
  immediateParentSha256: string[];
  sha256: string;
};

type ProvenanceRecord = {
  artifactId: string;
  artifactSha256: string;
  classification: "source-derived" | "synthetic";
  createdAt: string;
  id: string;
  immediateParentSha256: string[];
  method: string;
  operator: string;
  settings: Record<string, string | number | boolean>;
  tool: { name: string; version: string };
};

type ApprovalRecord = {
  artifactSha256: string[];
  decision: "approved" | "rejected";
  id: string;
  layerIds: string[];
  notes: string;
  reviewedAt: string;
  reviewedPoseIds: string[];
  reviewedZoomPercent: number[];
  reviewer: string;
  scope: "segmentation" | "reconstruction" | "pivot" | "motion" | "release";
};

type ApprovalRequirement = {
  approvalId: string;
  artifactSha256: string[];
  evidenceSha256: string[];
  layerIds: string[];
  reviewedPoseIds: string[];
  reviewedZoomPercent: number[];
  scope: ApprovalRecord["scope"];
};

type PhaseRecord = {
  approvalId?: string;
  assetSha256: string[];
  name: "source-preparation" | "static-layered-reconstruction" | "approved-part-motion" | "optional-depth";
  ordinal: 0 | 1 | 2 | 3;
  phasePayloadSha256: string;
  runtimeManifestSha256: string | null;
  status: "approved" | "disabled";
};

type RuntimeManifestFixture = JsonRecord & {
  motionProfiles: JsonRecord[];
  phase: "approved-part-motion";
};

type ClosureFixture = Readonly<{
  closureInput: Readonly<{
    approvalRequirements: ApprovalRequirement[];
    artifacts: ArtifactIdentity[];
    evidenceSha256: string[];
    manifest: JsonRecord;
    release: JsonRecord;
    runtimeManifest: RuntimeManifestFixture;
  }>;
  elapsedMs: number;
  runtimeManifest: RuntimeManifestFixture;
}>;

const projectRoot = process.cwd();
const contract = await import(
  /* @vite-ignore -- executable ESM is explicitly typed above. */
  pathToFileURL(resolve(projectRoot, "scripts/watch-2-5d/contract.mjs")).href
) as unknown as ContractModule;
const manifestClosure = await import(
  /* @vite-ignore -- executable ESM is explicitly typed above. */
  pathToFileURL(resolve(projectRoot, "scripts/watch-2-5d/manifest-closure.mjs")).href
) as unknown as ClosureModule;

const faultListArbitrary: fc.Arbitrary<readonly ClosureFault[]> = fc.oneof(
  { arbitrary: fc.constant([] as readonly ClosureFault[]), weight: 3 },
  {
    arbitrary: fc.uniqueArray(fc.constantFrom(...CLOSURE_FAULTS), {
      maxLength: 4,
      minLength: 1,
    }),
    weight: 5,
  },
);

const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  amplitudeHundredths: fc.integer({ max: 150, min: 5 }),
  cadenceMs: fc.integer({ max: 4_000, min: 50 }),
  direction: fc.constantFrom(-1 as const, 1 as const),
  discreteSteps: fc.integer({ max: 3, min: 1 }),
  elapsedNumerator: fc.integer({ max: 249, min: 1 }),
  evidence: fc.constantFrom("visible-evidence" as const, "authored-assumption" as const),
  faults: faultListArbitrary,
  maskPixelCount: fc.integer({ max: 20, min: 1 }),
  periodMs: fc.integer({ max: 120_000, min: 1_000 }),
  pivotX: fc.integer({ max: 2_750, min: 10 }),
  pivotY: fc.integer({ max: 1_494, min: 10 }),
  profileKind: fc.constantFrom(
    "continuous-rotation" as const,
    "discrete-rotation" as const,
    "oscillation" as const,
  ),
  reconstructionPixelCount: fc.integer({ max: 20, min: 1 }),
  semanticClass: fc.oneof(
    { arbitrary: fc.constantFrom(...MOTION_CLASSES), weight: 3 },
    { arbitrary: fc.constantFrom(...STATIC_CLASSES), weight: 2 },
  ),
  stepDivisor: fc.integer({ max: 12, min: 3 }),
});

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function mutateHash(value: string): string {
  return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
}

function recordHash(schema: StrictSchema, value: unknown): string {
  return contract.sha256(schema.serialize(value));
}

function canonicalHash(value: unknown): string {
  return contract.sha256(contract.serializeCanonicalJson(value));
}

function asLayerId(value: string): LayerId {
  return value as LayerId;
}

function profileAndElapsed(
  scenario: Scenario,
  pivot: Readonly<{ x: number; y: number }>,
): Readonly<{ elapsedMs: number; profile: JsonRecord }> {
  const base = {
    approvalId: MOTION_APPROVAL_ID,
    direction: scenario.direction,
    evidence: scenario.evidence,
    id: MOTION_ID,
    layerId: CANDIDATE_LAYER_ID,
    phaseRadians: 0,
    pivot,
    referenceRadians: 0,
  };

  if (scenario.profileKind === "continuous-rotation") {
    return {
      elapsedMs: scenario.periodMs * scenario.elapsedNumerator / 1_000,
      profile: {
        ...base,
        kind: scenario.profileKind,
        maxRadians: Math.PI * 2,
        minRadians: 0,
        periodMs: scenario.periodMs,
      },
    };
  }
  if (scenario.profileKind === "discrete-rotation") {
    return {
      elapsedMs: scenario.cadenceMs
        * (scenario.discreteSteps + scenario.elapsedNumerator / 1_000),
      profile: {
        ...base,
        cadenceMs: scenario.cadenceMs,
        kind: scenario.profileKind,
        maxRadians: Math.PI * 2,
        minRadians: 0,
        stepRadians: Math.PI / scenario.stepDivisor,
      },
    };
  }

  const amplitudeRadians = scenario.amplitudeHundredths / 100;
  return {
    elapsedMs: scenario.periodMs * scenario.elapsedNumerator / 1_000,
    profile: {
      ...base,
      amplitudeRadians,
      kind: scenario.profileKind,
      maxRadians: amplitudeRadians,
      minRadians: -amplitudeRadians,
      periodMs: scenario.periodMs,
    },
  };
}

function maskRecord(
  id: string,
  provenanceId: string,
  sha256: string,
  scenario: Scenario,
): JsonRecord {
  const tightBounds = {
    height: 20,
    width: 20,
    x: scenario.pivotX - 10,
    y: scenario.pivotY - 10,
  };
  return {
    alphaSum: scenario.maskPixelCount * 255,
    file: `source/assets/watch-2-5d/v1/masks/${id}.png`,
    height: 1_504,
    id,
    nonZeroPixelCount: scenario.maskPixelCount,
    provenanceId,
    sha256,
    tightBounds,
    width: 2_760,
  };
}

function provenanceRecord(
  artifact: ArtifactIdentity,
  id: string,
  method: string,
  stale: boolean,
): ProvenanceRecord {
  return {
    artifactId: artifact.id,
    artifactSha256: stale ? mutateHash(artifact.sha256) : artifact.sha256,
    classification: artifact.classification,
    createdAt: "2026-06-05T12:00:00.000Z",
    id,
    immediateParentSha256: [...artifact.immediateParentSha256],
    method,
    operator: "property-generator",
    settings: { deterministic: true },
    tool: { name: "Property Fixture Builder", version: "1.0.0" },
  };
}

function approvalRecord(
  id: string,
  scope: ApprovalRecord["scope"],
  semanticHashes: readonly string[],
  evidenceHashes: readonly string[],
  reviewedZoomPercent: readonly number[],
  reviewedPoseIds: readonly string[],
  rejected: boolean,
): ApprovalRecord {
  return {
    artifactSha256: uniqueSorted([...semanticHashes, ...evidenceHashes]),
    decision: rejected ? "rejected" : "approved",
    id,
    layerIds: [CANDIDATE_LAYER_ID],
    notes: `Exact generated ${scope} review.`,
    reviewedAt: "2026-06-05T13:00:00.000Z",
    reviewedPoseIds: [...reviewedPoseIds],
    reviewedZoomPercent: [...reviewedZoomPercent],
    reviewer: "property-reviewer",
    scope,
  };
}

function approvalRequirement(
  record: ApprovalRecord,
  semanticHashes: readonly string[],
  evidenceHashes: readonly string[],
): ApprovalRequirement {
  return {
    approvalId: record.id,
    artifactSha256: uniqueSorted(semanticHashes),
    evidenceSha256: uniqueSorted(evidenceHashes),
    layerIds: [...record.layerIds],
    reviewedPoseIds: [...record.reviewedPoseIds],
    reviewedZoomPercent: [...record.reviewedZoomPercent],
    scope: record.scope,
  };
}

function buildClosureFixture(scenario: Scenario): ClosureFixture {
  const faults = new Set<ClosureFault>(scenario.faults);
  const pivot = Object.freeze({ x: scenario.pivotX, y: scenario.pivotY });
  const profileSample = profileAndElapsed(scenario, pivot);
  const segmentationHash = canonicalHash({
    alpha: scenario.maskPixelCount,
    id: SEGMENTATION_MASK_ID,
    pivot,
  });
  const regionHash = canonicalHash({
    id: REGION_MASK_ID,
    pixels: scenario.reconstructionPixelCount,
    pivot,
  });
  const boundaryHash = canonicalHash({
    feather: 4,
    id: BOUNDARY_MASK_ID,
    regionHash,
  });
  const fillHash = canonicalHash({
    boundaryHash,
    classification: "synthetic",
    id: FILL_ID,
    regionHash,
  });
  const evidenceHash = canonicalHash({
    id: "evidence-generated-review",
    scenario: {
      maskPixelCount: scenario.maskPixelCount,
      reconstructionPixelCount: scenario.reconstructionPixelCount,
    },
  });

  const layer: JsonRecord = {
    approvalIds: [
      SEGMENTATION_APPROVAL_ID,
      PIVOT_APPROVAL_ID,
      RECONSTRUCTION_APPROVAL_ID,
    ],
    disposition: "approved-moving",
    id: CANDIDATE_LAYER_ID,
    motionProfileId: MOTION_ID,
    ...(faults.has("pivot-missing") ? {} : { pivot }),
    provenanceIds: [PROVENANCE_IDS.layer],
    reconstructedPixelCount: scenario.reconstructionPixelCount,
    referenceTransform: structuredClone(contract.CANONICAL_IDENTITY_MATRIX),
    segmentationMaskId: SEGMENTATION_MASK_ID,
    semanticClass: scenario.semanticClass,
    sourceRect: {
      height: 20,
      width: 20,
      x: scenario.pivotX - 10,
      y: scenario.pivotY - 10,
    },
    sourceVisiblePixelCount: scenario.maskPixelCount,
    zOrder: 10,
  };
  const layerHasValidShape = MOTION_CLASS_SET.has(scenario.semanticClass)
    && !faults.has("pivot-missing");
  const layerHash = layerHasValidShape
    ? recordHash(contract.LAYER_RECORD_SCHEMA, layer)
    : canonicalHash(layer);
  const motionHash = recordHash(contract.MOTION_PROFILE_SCHEMA, profileSample.profile);

  const artifacts: ArtifactIdentity[] = [
    {
      classification: "source-derived",
      id: SEGMENTATION_MASK_ID,
      immediateParentSha256: [contract.APPROVED_MASTER_IDENTITY.sha256],
      sha256: segmentationHash,
    },
    {
      classification: "synthetic",
      id: REGION_MASK_ID,
      immediateParentSha256: [contract.APPROVED_MASTER_IDENTITY.sha256],
      sha256: regionHash,
    },
    {
      classification: "synthetic",
      id: BOUNDARY_MASK_ID,
      immediateParentSha256: [regionHash],
      sha256: boundaryHash,
    },
    {
      classification: "synthetic",
      id: FILL_ID,
      immediateParentSha256: uniqueSorted([boundaryHash, regionHash]),
      sha256: fillHash,
    },
    {
      classification: "source-derived",
      id: CANDIDATE_LAYER_ID,
      immediateParentSha256: [segmentationHash],
      sha256: layerHash,
    },
    {
      classification: "synthetic",
      id: MOTION_ID,
      immediateParentSha256: [layerHash],
      sha256: motionHash,
    },
  ];
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const artifact = (id: string): ArtifactIdentity => {
    const value = artifactById.get(id);
    if (value === undefined) throw new Error(`Missing generated artifact ${id}`);
    return value;
  };

  const provenance: ProvenanceRecord[] = [
    provenanceRecord(
      artifact(SEGMENTATION_MASK_ID),
      PROVENANCE_IDS.segmentation,
      "manual-mask",
      faults.has("provenance-mask"),
    ),
    provenanceRecord(
      artifact(REGION_MASK_ID),
      PROVENANCE_IDS.region,
      "manual-mask",
      false,
    ),
    provenanceRecord(
      artifact(BOUNDARY_MASK_ID),
      PROVENANCE_IDS.boundary,
      "deterministic-generation",
      false,
    ),
    provenanceRecord(
      artifact(FILL_ID),
      PROVENANCE_IDS.fill,
      "manual-paint",
      faults.has("provenance-reconstruction"),
    ),
    provenanceRecord(
      artifact(CANDIDATE_LAYER_ID),
      PROVENANCE_IDS.layer,
      "source-extraction",
      faults.has("provenance-layer"),
    ),
    provenanceRecord(
      artifact(MOTION_ID),
      PROVENANCE_IDS.motion,
      "deterministic-generation",
      faults.has("provenance-motion"),
    ),
  ];

  const segmentation = maskRecord(
    SEGMENTATION_MASK_ID,
    PROVENANCE_IDS.segmentation,
    segmentationHash,
    scenario,
  );
  const region = maskRecord(
    REGION_MASK_ID,
    PROVENANCE_IDS.region,
    regionHash,
    scenario,
  );
  const boundary = maskRecord(
    BOUNDARY_MASK_ID,
    PROVENANCE_IDS.boundary,
    boundaryHash,
    scenario,
  );
  const reconstruction: JsonRecord = {
    approvalId: RECONSTRUCTION_APPROVAL_ID,
    boundaryMaskId: BOUNDARY_MASK_ID,
    fillFile: `source/assets/watch-2-5d/v1/reconstruction/${FILL_ID}.png`,
    fillId: FILL_ID,
    fillSha256: fillHash,
    id: RECONSTRUCTION_ID,
    method: "manual-paint",
    provenanceId: PROVENANCE_IDS.fill,
    regionMaskId: REGION_MASK_ID,
    syntheticPixelCount: scenario.reconstructionPixelCount,
  };
  const pivotHash = canonicalHash({ layerId: CANDIDATE_LAYER_ID, pivot });

  const profilePresent = !faults.has("profile-missing");
  const runtimeManifest: RuntimeManifestFixture = {
    canonicalMasterSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
    depthProfiles: [],
    motionProfiles: profilePresent ? [profileSample.profile] : [],
    packageId: "generated-motion-package",
    phase: "approved-part-motion",
    profiles: {
      compact: {
        assets: [],
        decodedRgbaBytes: 0,
        id: "compact",
        requestCountIncludingManifest: 1,
        sourceScale: 0.5,
        transferBytes: 0,
      },
      expanded: {
        assets: [],
        decodedRgbaBytes: 0,
        id: "expanded",
        requestCountIncludingManifest: 1,
        sourceScale: 1,
        transferBytes: 0,
      },
    },
    releaseId: "generated-motion-release",
    schemaVersion: 1,
  };
  const runtimeBytes = contract.RUNTIME_MANIFEST_SCHEMA.serializeLine(runtimeManifest);
  const runtimeHash = contract.sha256(runtimeBytes);
  const sourceAssets = uniqueSorted([segmentationHash, regionHash, boundaryHash]);
  const staticAssets = uniqueSorted([...sourceAssets, fillHash, layerHash]);
  const motionAssets = uniqueSorted([...staticAssets, motionHash]);
  const phases: PhaseRecord[] = [
    {
      assetSha256: sourceAssets,
      name: "source-preparation",
      ordinal: 0,
      phasePayloadSha256: "",
      runtimeManifestSha256: null,
      status: "approved",
    },
    {
      assetSha256: staticAssets,
      name: "static-layered-reconstruction",
      ordinal: 1,
      phasePayloadSha256: "",
      runtimeManifestSha256: null,
      status: "approved",
    },
    {
      approvalId: RELEASE_APPROVAL_ID,
      assetSha256: motionAssets,
      name: "approved-part-motion",
      ordinal: 2,
      phasePayloadSha256: "",
      runtimeManifestSha256: runtimeHash,
      status: "approved",
    },
    {
      assetSha256: [],
      name: "optional-depth",
      ordinal: 3,
      phasePayloadSha256: "",
      runtimeManifestSha256: null,
      status: "disabled",
    },
  ];
  for (const phase of phases) {
    phase.phasePayloadSha256 = manifestClosure.hashPhaseProjection(
      "generated-motion-package",
      phase,
    );
  }

  const releaseHashes = uniqueSorted([
    phases[2].phasePayloadSha256,
    runtimeHash,
    ...motionAssets,
  ]);
  const approvalDefinitions = [
    {
      evidence: [evidenceHash],
      hashes: [segmentationHash],
      id: SEGMENTATION_APPROVAL_ID,
      poses: ["reference-pose"],
      scope: "segmentation" as const,
      zooms: [200],
    },
    {
      evidence: [evidenceHash],
      hashes: [pivotHash],
      id: PIVOT_APPROVAL_ID,
      poses: ["reference-pose"],
      scope: "pivot" as const,
      zooms: [200],
    },
    {
      evidence: [evidenceHash],
      hashes: [fillHash, regionHash, boundaryHash],
      id: RECONSTRUCTION_APPROVAL_ID,
      poses: ["reference-pose", "motion-minimum", "motion-maximum"],
      scope: "reconstruction" as const,
      zooms: [100, 200],
    },
    {
      evidence: [evidenceHash],
      hashes: [motionHash],
      id: MOTION_APPROVAL_ID,
      poses: ["reference-pose", "motion-minimum", "motion-maximum"],
      scope: "motion" as const,
      zooms: [100, 200],
    },
    {
      evidence: [],
      hashes: releaseHashes,
      id: RELEASE_APPROVAL_ID,
      poses: ["release-pose"],
      scope: "release" as const,
      zooms: [],
    },
  ];
  const approvals = approvalDefinitions.map((definition) => approvalRecord(
    definition.id,
    definition.scope,
    definition.hashes,
    definition.evidence,
    definition.zooms,
    definition.poses,
    faults.has(`approval-${definition.scope}` as ClosureFault),
  ));
  const approvalRequirements = approvals.map((record, index) => approvalRequirement(
    record,
    approvalDefinitions[index].hashes,
    approvalDefinitions[index].evidence,
  ));
  const noApprovals = faults.has("approvals-empty");

  const manifest: JsonRecord = {
    approvals: noApprovals ? [] : approvals,
    budgets: structuredClone(contract.ENHANCEMENT_BUDGETS),
    canonicalMaster: structuredClone(contract.APPROVED_MASTER_IDENTITY),
    depthProfiles: [],
    layers: [layer],
    masks: faults.has("mask-missing")
      ? [region, boundary]
      : [segmentation, region, boundary],
    motionProfiles: profilePresent ? [profileSample.profile] : [],
    packageId: "generated-motion-package",
    packageVersion: "1.0.0",
    parentSpec: contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    phases,
    predecessorContract: structuredClone(contract.PREDECESSOR_MANIFEST_IDENTITY),
    provenance,
    publicAssets: [],
    reconstructions: faults.has("reconstruction-missing") ? [] : [reconstruction],
    relationships: [],
    runtimeManifest: {
      byteLength: runtimeBytes.byteLength,
      file: "public/assets/watch-2-5d/v1/runtime-manifest.json",
      mediaType: "application/json",
      publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      sha256: runtimeHash,
    },
    schemaVersion: 1,
    sourceCoordinateSpace: structuredClone(contract.CANONICAL_SOURCE_COORDINATE_SPACE),
    sourceDateEpoch: 1_700_000_000,
  };
  const release: JsonRecord = {
    depthEnabled: false,
    packageId: "generated-motion-package",
    releaseId: "generated-motion-release",
    runtimeManifest: {
      byteLength: runtimeBytes.byteLength,
      mediaType: "application/json",
      publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      sha256: runtimeHash,
    },
    schemaVersion: 1,
    status: "ready",
  };

  return {
    closureInput: {
      approvalRequirements: noApprovals ? [] : approvalRequirements,
      artifacts,
      evidenceSha256: [evidenceHash],
      manifest,
      release,
      runtimeManifest,
    },
    elapsedMs: profileSample.elapsedMs,
    runtimeManifest,
  };
}

/** Independent oracle: no production closure or sampler result participates. */
function oracleMovingEligibility(scenario: Scenario): boolean {
  return MOTION_CLASS_SET.has(scenario.semanticClass) && scenario.faults.length === 0;
}

function validatedManifest(
  runtimeManifest: RuntimeManifestFixture,
  active: boolean,
): ValidatedRuntimeManifest {
  return {
    ...runtimeManifest,
    motionProfiles: active ? runtimeManifest.motionProfiles : [],
    phase: active ? "approved-part-motion" : "static-layered-reconstruction",
  } as unknown as ValidatedRuntimeManifest;
}

// **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11**
// Feature: interactive-layered-watch-2-5d, Property 5: Approved-motion eligibility and static default
it(PROPERTY_TAG, { timeout: 120_000 }, () => {
  fc.assert(
    fc.property(scenarioArbitrary, (scenario) => {
      const fixture = buildClosureFixture(scenario);
      const expectedMoving = oracleMovingEligibility(scenario);
      const closure = manifestClosure.evaluateManifestClosure(fixture.closureInput);

      expect(
        closure.eligible,
        `closure mismatch for class=${scenario.semanticClass}, faults=${scenario.faults.join(",") || "none"}: ${closure.issueCode ?? closure.message}`,
      ).toBe(expectedMoving);

      const gatedManifest = validatedManifest(fixture.runtimeManifest, closure.eligible);
      const sampled = sampleApprovedMotionSet(gatedManifest, fixture.elapsedMs);
      const candidate = sampleApprovedLayerMotion(
        gatedManifest,
        asLayerId(CANDIDATE_LAYER_ID),
        fixture.elapsedMs,
      );
      const expectedMovingIds = expectedMoving ? [CANDIDATE_LAYER_ID] : [];

      expect(Object.keys(sampled)).toEqual(expectedMovingIds);
      expect(isIdentityMatrix(candidate, 1e-12)).toBe(!expectedMoving);
      if (expectedMoving) {
        expect(sampled[CANDIDATE_LAYER_ID]).toEqual(candidate);
      } else {
        expect(candidate).toBe(IDENTITY_MATRIX_2D);
        expect(sampled).toEqual({});
      }

      expect(sampleApprovedLayerMotion(
        gatedManifest,
        asLayerId(STATIC_LAYER_ID),
        fixture.elapsedMs,
      )).toBe(IDENTITY_MATRIX_2D);
      expect(sampleApprovedLayerMotion(
        gatedManifest,
        "reconstructed-background",
        fixture.elapsedMs,
      )).toBe(IDENTITY_MATRIX_2D);

      const emptyApprovedManifest = validatedManifest(fixture.runtimeManifest, false);
      expect(sampleApprovedMotionSet(emptyApprovedManifest, fixture.elapsedMs)).toEqual({});
      expect(sampleApprovedLayerMotion(
        emptyApprovedManifest,
        asLayerId(CANDIDATE_LAYER_ID),
        fixture.elapsedMs,
      )).toBe(IDENTITY_MATRIX_2D);
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
