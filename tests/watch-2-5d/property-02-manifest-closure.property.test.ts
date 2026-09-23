import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { expect, it } from "vitest";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 2: Manifest, provenance, approval, and release closure";

// Reproduce with: seed=20250519, numRuns=128.
const PROPERTY_SEED = 20_250_519;
const PROPERTY_RUNS = 128;
const HASH_UNKNOWN_A = "e".repeat(64);
const HASH_UNKNOWN_B = "f".repeat(64);

type StrictSchema = {
  serialize(value: unknown): Buffer;
  serializeLine(value: unknown): Buffer;
};

type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: Readonly<Record<string, unknown>> & {
    readonly sha256: string;
  };
  readonly CANONICAL_IDENTITY_MATRIX: Readonly<Record<string, number>>;
  readonly CANONICAL_PROJECT_PATHS: Readonly<Record<string, string>>;
  readonly CANONICAL_SOURCE_COORDINATE_SPACE: Readonly<Record<string, number>>;
  readonly ENHANCEMENT_BUDGETS: Readonly<Record<string, unknown>>;
  readonly GEAR_RELATIONSHIP_SCHEMA: StrictSchema;
  readonly LAYER_RECORD_SCHEMA: StrictSchema;
  readonly MOTION_PROFILE_SCHEMA: StrictSchema;
  readonly PREDECESSOR_MANIFEST_IDENTITY: Readonly<Record<string, unknown>> & {
    readonly sha256: string;
  };
  readonly RUNTIME_MANIFEST_SCHEMA: StrictSchema;
  serializeCanonicalJson(value: unknown): Buffer;
  sha256(value: string | ArrayBufferView): string;
};

type ClosureResult = {
  readonly code: string | null;
  readonly eligible: boolean;
  readonly issueCode: string | null;
  readonly ok: boolean;
  readonly releasable: boolean;
};

type ClosureModule = {
  evaluateManifestClosure(value: unknown): ClosureResult;
};

type ApprovalSetResult = {
  readonly approvedMovingLayerIds: readonly string[];
  readonly failures: readonly unknown[];
  readonly mode: string;
  readonly ok: boolean;
  readonly releasable: boolean;
};

type ApprovalModule = {
  evaluateApprovalSetClosure(options: {
    readonly approvals: readonly ApprovalRecord[];
    readonly approvedMovingLayerIds: readonly string[];
    readonly requirements: readonly ApprovalRequirement[];
  }): ApprovalSetResult;
};

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
  decision: "approved" | "pending" | "rejected";
  id: string;
  layerIds: string[];
  notes: string;
  reviewedAt: string | null;
  reviewedPoseIds: string[];
  reviewedZoomPercent: number[];
  reviewer: string | null;
  scope: string;
};

type ApprovalRequirement = {
  approvalId: string;
  artifactSha256: string[];
  evidenceSha256?: string[];
  layerIds: string[];
  reviewedPoseIds: string[];
  reviewedZoomPercent: number[];
  scope: string;
};

type PhaseRecord = {
  approvalId?: string;
  assetSha256: string[];
  name: string;
  ordinal: number;
  phasePayloadSha256: string;
  runtimeManifestSha256: string | null;
  status: string;
};

type LayerRecord = {
  approvalIds: string[];
  disposition: string;
  id: string;
  motionProfileId: string;
  pivot: { x: number; y: number };
  provenanceIds: string[];
  reconstructedPixelCount: number;
  referenceTransform: Record<string, number>;
  segmentationMaskId: string;
  semanticClass: string;
  sourceRect: { height: number; width: number; x: number; y: number };
  sourceVisiblePixelCount: number;
  zOrder: number;
};

type MotionRecord = {
  approvalId: string;
  direction: -1 | 1;
  evidence: string;
  id: string;
  kind: string;
  layerId: string;
  maxRadians: number;
  minRadians: number;
  periodMs: number;
  phaseRadians: number;
  pivot: { x: number; y: number };
  referenceRadians: number;
};

type RelationshipRecord = {
  approvalId: string;
  direction: "opposite";
  drivenLayerId: string;
  drivenToothCount: number;
  driverLayerId: string;
  driverToothCount: number;
  evidence: string;
  id: string;
};

type PublicAssetRecord = {
  byteLength: number;
  colorMetadata: { alpha: true; channels: 4; colourspace: "srgb" };
  decodedPixelCount: number;
  decodedRgbaByteLength: number;
  encoder: {
    alphaQuality: 100;
    channels: 4;
    colourspace: "srgb";
    effort: 6;
    nearLossless: false;
    quality: number;
    smartSubsample: true;
  };
  file: string;
  id: string;
  intrinsicHeight: number;
  intrinsicWidth: number;
  layerId: string;
  magicSignatureHex: string;
  mediaType: "image/webp";
  profile: "compact" | "expanded";
  publicPath: string;
  sha256: string;
  sourceRect: { height: number; width: number; x: number; y: number };
  zOrder: number;
};

type ClosureFixture = {
  approvalRequirements: ApprovalRequirement[];
  artifacts: ArtifactIdentity[];
  manifest: {
    approvals: ApprovalRecord[];
    budgets: Record<string, unknown>;
    canonicalMaster: Record<string, unknown>;
    depthProfiles: unknown[];
    layers: LayerRecord[];
    masks: Array<Record<string, unknown> & { id: string; provenanceId: string; sha256: string }>;
    motionProfiles: MotionRecord[];
    packageId: string;
    packageVersion: string;
    parentSpec: string;
    phases: PhaseRecord[];
    predecessorContract: Record<string, unknown>;
    provenance: ProvenanceRecord[];
    publicAssets: PublicAssetRecord[];
    reconstructions: Array<Record<string, unknown> & {
      approvalId: string;
      fillId: string;
      provenanceId: string;
    }>;
    relationships: RelationshipRecord[];
    runtimeManifest: {
      byteLength: number;
      file: string;
      mediaType: string;
      publicPath: string;
      sha256: string;
    };
    schemaVersion: number;
    sourceCoordinateSpace: Record<string, number>;
    sourceDateEpoch: number;
  };
  release: {
    depthEnabled: boolean;
    packageId: string;
    releaseId: string;
    runtimeManifest: {
      byteLength: number;
      mediaType: string;
      publicPath: string;
      sha256: string;
    };
    schemaVersion: number;
    status: "ready";
  };
  runtimeManifest: {
    canonicalMasterSha256: string;
    depthProfiles: unknown[];
    motionProfiles: MotionRecord[];
    packageId: string;
    phase: string;
    profiles: {
      compact: {
        assets: PublicAssetRecord[];
        decodedRgbaBytes: number;
        id: "compact";
        requestCountIncludingManifest: number;
        sourceScale: 0.5;
        transferBytes: number;
      };
      expanded: {
        assets: PublicAssetRecord[];
        decodedRgbaBytes: number;
        id: "expanded";
        requestCountIncludingManifest: number;
        sourceScale: 1;
        transferBytes: number;
      };
    };
    releaseId: string;
    schemaVersion: number;
  };
};

type GeneratedGraph = {
  classificationBits: boolean[];
  evidenceCount: number;
  parentSelectors: number[];
  salt: number;
  stem: string;
};

type EdgeBreaker = {
  readonly name: string;
  breakEdge(fixture: ClosureFixture): void;
};

const projectRoot = process.cwd();
const contract = await import(
  /* @vite-ignore -- executable ESM is typed by ContractModule above. */
  pathToFileURL(resolve(projectRoot, "scripts/watch-2-5d/contract.mjs")).href
) as unknown as ContractModule;
const closure = await import(
  /* @vite-ignore -- executable ESM is typed by ClosureModule above. */
  pathToFileURL(resolve(projectRoot, "scripts/watch-2-5d/manifest-closure.mjs")).href
) as unknown as ClosureModule;
const approvalTools = await import(
  /* @vite-ignore -- executable ESM is typed by ApprovalModule above. */
  pathToFileURL(resolve(projectRoot, "scripts/watch-2-5d/approval-records.mjs")).href
) as unknown as ApprovalModule;

const lowercaseLetterArbitrary = fc
  .integer({ min: 97, max: 122 })
  .map((codePoint) => String.fromCharCode(codePoint));
const stemArbitrary = fc
  .array(lowercaseLetterArbitrary, { minLength: 1, maxLength: 6 })
  .map((characters) => characters.join(""));

const graphArbitrary: fc.Arbitrary<GeneratedGraph> = fc.record({
  classificationBits: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  evidenceCount: fc.integer({ min: 1, max: 4 }),
  parentSelectors: fc.array(fc.nat({ max: 1_000_000 }), { minLength: 64, maxLength: 64 }),
  salt: fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
  stem: stemArbitrary,
});

function digest(salt: number, label: string): string {
  return contract.sha256(`${salt}:${label}`);
}

function recordHash(schema: StrictSchema, value: unknown): string {
  return contract.sha256(schema.serialize(value));
}

function phaseProjectionHash(packageId: string, phase: PhaseRecord): string {
  return contract.sha256(contract.serializeCanonicalJson({
    assetSha256: phase.assetSha256,
    name: phase.name,
    packageId,
    runtimeManifestSha256: phase.runtimeManifestSha256,
  }));
}

function mutateHash(value: string): string {
  return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
}

function approval(
  id: string,
  scope: string,
  artifactSha256: string[],
  layerIds: string[],
  reviewedZoomPercent: number[],
  reviewedPoseIds: string[],
): ApprovalRecord {
  return {
    artifactSha256,
    decision: "approved",
    id,
    layerIds,
    notes: `Reviewed exact ${scope} hashes and evidence.`,
    reviewedAt: "2026-05-19T12:00:00.000Z",
    reviewedPoseIds,
    reviewedZoomPercent,
    reviewer: "property-reviewer",
    scope,
  };
}

function requirement(
  record: ApprovalRecord,
  evidenceSha256: readonly string[] = [],
): ApprovalRequirement {
  const evidence = new Set(evidenceSha256);
  return {
    approvalId: record.id,
    artifactSha256: record.artifactSha256.filter((digestValue) => !evidence.has(digestValue)),
    evidenceSha256: [...evidenceSha256],
    layerIds: [...record.layerIds],
    reviewedPoseIds: [...record.reviewedPoseIds],
    reviewedZoomPercent: [...record.reviewedZoomPercent],
    scope: record.scope,
  };
}

function publicAsset(
  id: string,
  layerId: string,
  profile: "compact" | "expanded",
  sha256: string,
  byteLength: number,
  zOrder: number,
): PublicAssetRecord {
  const intrinsicWidth = profile === "compact" ? 20 : 40;
  const intrinsicHeight = profile === "compact" ? 10 : 20;
  return {
    byteLength,
    colorMetadata: { alpha: true, channels: 4, colourspace: "srgb" },
    decodedPixelCount: intrinsicWidth * intrinsicHeight,
    decodedRgbaByteLength: intrinsicWidth * intrinsicHeight * 4,
    encoder: {
      alphaQuality: 100,
      channels: 4,
      colourspace: "srgb",
      effort: 6,
      nearLossless: false,
      quality: 95,
      smartSubsample: true,
    },
    file: `public/assets/watch-2-5d/v1/${profile}/${id}.webp`,
    id,
    intrinsicHeight,
    intrinsicWidth,
    layerId,
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile,
    publicPath: `/assets/watch-2-5d/v1/${profile}/${id}.webp`,
    sha256,
    sourceRect: { height: 20, width: 40, x: zOrder === 10 ? 10 : 100, y: 30 },
    zOrder,
  };
}

function buildClosedFixture(generated: GeneratedGraph): ClosureFixture {
  const { classificationBits, evidenceCount, parentSelectors, salt, stem } = generated;
  const packageId = `${stem}-package`;
  const releaseId = `${stem}-release`;
  const id = (suffix: string): string => `${stem}-${suffix}`;

  const maskDriverId = id("mask-driver");
  const maskDrivenId = id("mask-driven");
  const layerDriverId = id("layer-driver");
  const layerDrivenId = id("layer-driven");
  const fillDriverId = id("fill-driver");
  const fillDrivenId = id("fill-driven");
  const motionDriverId = id("motion-driver");
  const motionDrivenId = id("motion-driven");
  const relationshipId = id("relationship");

  const segmentationDriverId = id("approval-segmentation-driver");
  const segmentationDrivenId = id("approval-segmentation-driven");
  const pivotDriverId = id("approval-pivot-driver");
  const pivotDrivenId = id("approval-pivot-driven");
  const reconstructionDriverId = id("approval-reconstruction-driver");
  const reconstructionDrivenId = id("approval-reconstruction-driven");
  const motionApprovalId = id("approval-motion");
  const releaseApprovalId = id("approval-release");

  const maskDriverHash = digest(salt, maskDriverId);
  const maskDrivenHash = digest(salt, maskDrivenId);
  const fillDriverHash = digest(salt, fillDriverId);
  const fillDrivenHash = digest(salt, fillDrivenId);
  const evidenceHashes = Array.from({ length: evidenceCount }, (_, index) => (
    digest(salt, id(`evidence-${index}`))
  ));
  const primaryEvidenceHash = evidenceHashes[0];

  const layerDriver: LayerRecord = {
    approvalIds: [segmentationDriverId, pivotDriverId, reconstructionDriverId],
    disposition: "approved-moving",
    id: layerDriverId,
    motionProfileId: motionDriverId,
    pivot: { x: 20.5, y: 40.5 },
    provenanceIds: [id("layer-driver-provenance")],
    reconstructedPixelCount: 12,
    referenceTransform: { ...contract.CANONICAL_IDENTITY_MATRIX },
    segmentationMaskId: maskDriverId,
    semanticClass: "exposed-gear",
    sourceRect: { height: 20, width: 40, x: 10, y: 30 },
    sourceVisiblePixelCount: 1,
    zOrder: 10,
  };
  const layerDriven: LayerRecord = {
    approvalIds: [segmentationDrivenId, pivotDrivenId, reconstructionDrivenId],
    disposition: "approved-moving",
    id: layerDrivenId,
    motionProfileId: motionDrivenId,
    pivot: { x: 110.5, y: 40.5 },
    provenanceIds: [id("layer-driven-provenance")],
    reconstructedPixelCount: 12,
    referenceTransform: { ...contract.CANONICAL_IDENTITY_MATRIX },
    segmentationMaskId: maskDrivenId,
    semanticClass: "exposed-gear",
    sourceRect: { height: 20, width: 40, x: 100, y: 30 },
    sourceVisiblePixelCount: 1,
    zOrder: 20,
  };
  const layerDriverHash = recordHash(contract.LAYER_RECORD_SCHEMA, layerDriver);
  const layerDrivenHash = recordHash(contract.LAYER_RECORD_SCHEMA, layerDriven);

  const motionDriver: MotionRecord = {
    approvalId: motionApprovalId,
    direction: 1,
    evidence: classificationBits[0] ? "visible-evidence" : "authored-assumption",
    id: motionDriverId,
    kind: "continuous-rotation",
    layerId: layerDriverId,
    maxRadians: Math.PI * 2,
    minRadians: 0,
    periodMs: 60_000,
    phaseRadians: 0,
    pivot: { ...layerDriver.pivot },
    referenceRadians: 0,
  };
  const motionDriven: MotionRecord = {
    approvalId: motionApprovalId,
    direction: -1,
    evidence: classificationBits[1] ? "visible-evidence" : "authored-assumption",
    id: motionDrivenId,
    kind: "continuous-rotation",
    layerId: layerDrivenId,
    maxRadians: Math.PI * 2,
    minRadians: 0,
    periodMs: 120_000,
    phaseRadians: 0,
    pivot: { ...layerDriven.pivot },
    referenceRadians: 0,
  };
  const relationship: RelationshipRecord = {
    approvalId: motionApprovalId,
    direction: "opposite",
    drivenLayerId: layerDrivenId,
    drivenToothCount: 20 + Math.abs(salt % 11),
    driverLayerId: layerDriverId,
    driverToothCount: 10 + Math.abs(salt % 7),
    evidence: classificationBits[2] ? "visible-evidence" : "authored-assumption",
    id: relationshipId,
  };
  const motionDriverHash = recordHash(contract.MOTION_PROFILE_SCHEMA, motionDriver);
  const motionDrivenHash = recordHash(contract.MOTION_PROFILE_SCHEMA, motionDriven);
  const relationshipHash = recordHash(contract.GEAR_RELATIONSHIP_SCHEMA, relationship);

  const compactDriver = publicAsset(
    id("asset-compact-driver"),
    layerDriverId,
    "compact",
    digest(salt, id("asset-compact-driver")),
    500 + Math.abs(salt % 101),
    10,
  );
  const compactDriven = publicAsset(
    id("asset-compact-driven"),
    layerDrivenId,
    "compact",
    digest(salt, id("asset-compact-driven")),
    600 + Math.abs(salt % 101),
    20,
  );
  const expandedDriver = publicAsset(
    id("asset-expanded-driver"),
    layerDriverId,
    "expanded",
    digest(salt, id("asset-expanded-driver")),
    900 + Math.abs(salt % 101),
    10,
  );
  const expandedDriven = publicAsset(
    id("asset-expanded-driven"),
    layerDrivenId,
    "expanded",
    digest(salt, id("asset-expanded-driven")),
    1_000 + Math.abs(salt % 101),
    20,
  );
  const publicAssets = [compactDriver, compactDriven, expandedDriver, expandedDriven];

  const artifactSeeds: Array<Omit<ArtifactIdentity, "immediateParentSha256">> = [
    { classification: "source-derived", id: maskDriverId, sha256: maskDriverHash },
    { classification: "source-derived", id: maskDrivenId, sha256: maskDrivenHash },
    { classification: "synthetic", id: fillDriverId, sha256: fillDriverHash },
    { classification: "synthetic", id: fillDrivenId, sha256: fillDrivenHash },
    { classification: "synthetic", id: layerDriverId, sha256: layerDriverHash },
    { classification: "synthetic", id: layerDrivenId, sha256: layerDrivenHash },
    { classification: "synthetic", id: motionDriverId, sha256: motionDriverHash },
    { classification: "synthetic", id: motionDrivenId, sha256: motionDrivenHash },
    { classification: "synthetic", id: relationshipId, sha256: relationshipHash },
    ...publicAssets.map(({ id: assetId, sha256 }) => ({
      classification: "source-derived" as const,
      id: assetId,
      sha256,
    })),
    ...evidenceHashes.map((sha256, index) => ({
      classification: classificationBits[index % classificationBits.length]
        ? "synthetic" as const
        : "source-derived" as const,
      id: id(`evidence-${index}`),
      sha256,
    })),
  ];
  const roots = [
    contract.APPROVED_MASTER_IDENTITY.sha256,
    contract.PREDECESSOR_MANIFEST_IDENTITY.sha256,
  ];
  const artifacts: ArtifactIdentity[] = artifactSeeds.map((artifact, index) => {
    const candidates = [...roots, ...artifactSeeds.slice(0, index).map(({ sha256 }) => sha256)];
    const first = candidates[parentSelectors[index * 2] % candidates.length];
    const second = candidates[parentSelectors[index * 2 + 1] % candidates.length];
    const immediateParentSha256 = classificationBits[index % classificationBits.length]
      && second !== first
      ? [first, second]
      : [first];
    return { ...artifact, immediateParentSha256 };
  });

  const provenanceId = (artifactId: string): string => `${artifactId}-provenance`;
  layerDriver.provenanceIds = [provenanceId(layerDriverId)];
  layerDriven.provenanceIds = [provenanceId(layerDrivenId)];
  const refreshedLayerDriverHash = recordHash(contract.LAYER_RECORD_SCHEMA, layerDriver);
  const refreshedLayerDrivenHash = recordHash(contract.LAYER_RECORD_SCHEMA, layerDriven);
  const layerDriverArtifact = artifacts.find(({ id: artifactId }) => artifactId === layerDriverId);
  const layerDrivenArtifact = artifacts.find(({ id: artifactId }) => artifactId === layerDrivenId);
  if (layerDriverArtifact === undefined || layerDrivenArtifact === undefined) {
    throw new Error("Generated layer artifacts are missing");
  }
  layerDriverArtifact.sha256 = refreshedLayerDriverHash;
  layerDrivenArtifact.sha256 = refreshedLayerDrivenHash;

  const provenance: ProvenanceRecord[] = artifacts.map((artifact, index) => ({
    artifactId: artifact.id,
    artifactSha256: artifact.sha256,
    classification: artifact.classification,
    createdAt: "2026-05-19T11:00:00.000Z",
    id: provenanceId(artifact.id),
    immediateParentSha256: [...artifact.immediateParentSha256],
    method: artifact.classification === "synthetic" ? "manual-paint" : "source-extraction",
    operator: "property-generator",
    settings: { generated: true, index },
    tool: { name: "Property Fixture Builder", version: "1.0.0" },
  }));

  const masks = [
    {
      alphaSum: 255,
      file: `source/assets/watch-2-5d/v1/masks/${maskDriverId}.png`,
      height: 1504,
      id: maskDriverId,
      nonZeroPixelCount: 1,
      provenanceId: provenanceId(maskDriverId),
      sha256: maskDriverHash,
      tightBounds: { height: 1, width: 1, x: 20, y: 40 },
      width: 2760,
    },
    {
      alphaSum: 255,
      file: `source/assets/watch-2-5d/v1/masks/${maskDrivenId}.png`,
      height: 1504,
      id: maskDrivenId,
      nonZeroPixelCount: 1,
      provenanceId: provenanceId(maskDrivenId),
      sha256: maskDrivenHash,
      tightBounds: { height: 1, width: 1, x: 110, y: 40 },
      width: 2760,
    },
  ];
  const reconstructions = [
    {
      approvalId: reconstructionDriverId,
      boundaryMaskId: maskDriverId,
      fillFile: `source/assets/watch-2-5d/v1/reconstruction/${fillDriverId}.png`,
      fillId: fillDriverId,
      fillSha256: fillDriverHash,
      id: id("reconstruction-driver"),
      method: "manual-paint",
      provenanceId: provenanceId(fillDriverId),
      regionMaskId: maskDriverId,
      syntheticPixelCount: 12,
    },
    {
      approvalId: reconstructionDrivenId,
      boundaryMaskId: maskDrivenId,
      fillFile: `source/assets/watch-2-5d/v1/reconstruction/${fillDrivenId}.png`,
      fillId: fillDrivenId,
      fillSha256: fillDrivenHash,
      id: id("reconstruction-driven"),
      method: "manual-paint",
      provenanceId: provenanceId(fillDrivenId),
      regionMaskId: maskDrivenId,
      syntheticPixelCount: 12,
    },
  ];

  const pivotDriverHash = contract.sha256(contract.serializeCanonicalJson({
    layerId: layerDriverId,
    pivot: layerDriver.pivot,
  }));
  const pivotDrivenHash = contract.sha256(contract.serializeCanonicalJson({
    layerId: layerDrivenId,
    pivot: layerDriven.pivot,
  }));
  const approvals: ApprovalRecord[] = [
    approval(segmentationDriverId, "segmentation", [maskDriverHash, primaryEvidenceHash], [layerDriverId], [200], ["reference-pose"]),
    approval(segmentationDrivenId, "segmentation", [maskDrivenHash, primaryEvidenceHash], [layerDrivenId], [200], ["reference-pose"]),
    approval(pivotDriverId, "pivot", [pivotDriverHash, primaryEvidenceHash], [layerDriverId], [200], ["reference-pose"]),
    approval(pivotDrivenId, "pivot", [pivotDrivenHash, primaryEvidenceHash], [layerDrivenId], [200], ["reference-pose"]),
    approval(reconstructionDriverId, "reconstruction", [fillDriverHash, maskDriverHash, primaryEvidenceHash], [layerDriverId], [100, 200], ["reference-pose", "motion-extreme"]),
    approval(reconstructionDrivenId, "reconstruction", [fillDrivenHash, maskDrivenHash, primaryEvidenceHash], [layerDrivenId], [100, 200], ["reference-pose", "motion-extreme"]),
    approval(motionApprovalId, "motion", [motionDriverHash, motionDrivenHash, relationshipHash, primaryEvidenceHash], [layerDriverId, layerDrivenId], [100, 200], ["reference-pose", "motion-extreme"]),
  ];

  const runtimeManifest: ClosureFixture["runtimeManifest"] = {
    canonicalMasterSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
    depthProfiles: [],
    motionProfiles: [motionDriver, motionDriven],
    packageId,
    phase: "approved-part-motion",
    profiles: {
      compact: {
        assets: [compactDriver, compactDriven],
        decodedRgbaBytes: compactDriver.decodedRgbaByteLength + compactDriven.decodedRgbaByteLength,
        id: "compact",
        requestCountIncludingManifest: 3,
        sourceScale: 0.5,
        transferBytes: compactDriver.byteLength + compactDriven.byteLength,
      },
      expanded: {
        assets: [expandedDriver, expandedDriven],
        decodedRgbaBytes: expandedDriver.decodedRgbaByteLength + expandedDriven.decodedRgbaByteLength,
        id: "expanded",
        requestCountIncludingManifest: 3,
        sourceScale: 1,
        transferBytes: expandedDriver.byteLength + expandedDriven.byteLength,
      },
    },
    releaseId,
    schemaVersion: 1,
  };
  const runtimeBytes = contract.RUNTIME_MANIFEST_SCHEMA.serializeLine(runtimeManifest);
  const runtimeHash = contract.sha256(runtimeBytes);
  const sourceAssets = [maskDriverHash, maskDrivenHash];
  const staticAssets = [
    ...sourceAssets,
    fillDriverHash,
    fillDrivenHash,
    ...publicAssets.map(({ sha256 }) => sha256),
  ];
  const motionAssets = [
    ...staticAssets,
    motionDriverHash,
    motionDrivenHash,
    relationshipHash,
  ];
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
      approvalId: releaseApprovalId,
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
  phases.forEach((phase) => {
    phase.phasePayloadSha256 = phaseProjectionHash(packageId, phase);
  });
  const releasedPhase = phases[2];
  const releaseApproval = approval(
    releaseApprovalId,
    "release",
    [releasedPhase.phasePayloadSha256, runtimeHash, ...releasedPhase.assetSha256],
    [layerDriverId, layerDrivenId],
    [],
    ["release-pose"],
  );
  approvals.push(releaseApproval);

  return {
    approvalRequirements: approvals.map((record) => requirement(
      record,
      record.scope === "release" ? [] : [primaryEvidenceHash],
    )),
    artifacts,
    manifest: {
      approvals,
      budgets: structuredClone(contract.ENHANCEMENT_BUDGETS) as Record<string, unknown>,
      canonicalMaster: structuredClone(contract.APPROVED_MASTER_IDENTITY),
      depthProfiles: [],
      layers: [layerDriver, layerDriven],
      masks,
      motionProfiles: [motionDriver, motionDriven],
      packageId,
      packageVersion: "1.0.0",
      parentSpec: contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
      phases,
      predecessorContract: structuredClone(contract.PREDECESSOR_MANIFEST_IDENTITY),
      provenance,
      publicAssets,
      reconstructions,
      relationships: [relationship],
      runtimeManifest: {
        byteLength: runtimeBytes.byteLength,
        file: "public/assets/watch-2-5d/v1/runtime-manifest.json",
        mediaType: "application/json",
        publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
        sha256: runtimeHash,
      },
      schemaVersion: 1,
      sourceCoordinateSpace: structuredClone(contract.CANONICAL_SOURCE_COORDINATE_SPACE),
      sourceDateEpoch: 1_700_000_000 + Math.abs(salt % 10_000),
    },
    release: {
      depthEnabled: false,
      packageId,
      releaseId,
      runtimeManifest: {
        byteLength: runtimeBytes.byteLength,
        mediaType: "application/json",
        publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
        sha256: runtimeHash,
      },
      schemaVersion: 1,
      status: "ready",
    },
    runtimeManifest,
  };
}

function findProvenance(fixture: ClosureFixture, artifactId: string): ProvenanceRecord {
  const provenance = fixture.manifest.provenance.find((record) => record.artifactId === artifactId);
  if (provenance === undefined) throw new Error(`Missing generated provenance for ${artifactId}`);
  return provenance;
}

function findApproval(fixture: ClosureFixture, scope: string): ApprovalRecord {
  const approvalRecord = fixture.manifest.approvals.find((record) => record.scope === scope);
  if (approvalRecord === undefined) throw new Error(`Missing generated ${scope} approval`);
  return approvalRecord;
}

function findRequirement(fixture: ClosureFixture, approvalId: string): ApprovalRequirement {
  const approvalRequirement = fixture.approvalRequirements.find((record) => record.approvalId === approvalId);
  if (approvalRequirement === undefined) throw new Error(`Missing generated requirement for ${approvalId}`);
  return approvalRequirement;
}

const EDGE_BREAKERS: readonly EdgeBreaker[] = [
  {
    name: "duplicate artifact ID",
    breakEdge(fixture) {
      fixture.artifacts[1].id = fixture.artifacts[0].id;
    },
  },
  {
    name: "observed artifact hash differs from current provenance",
    breakEdge(fixture) {
      fixture.artifacts[0].sha256 = mutateHash(fixture.artifacts[0].sha256);
    },
  },
  {
    name: "provenance parent differs from the observed parent set",
    breakEdge(fixture) {
      const artifact = fixture.artifacts[0];
      artifact.immediateParentSha256 = [
        artifact.immediateParentSha256[0] === contract.APPROVED_MASTER_IDENTITY.sha256
          ? contract.PREDECESSOR_MANIFEST_IDENTITY.sha256
          : contract.APPROVED_MASTER_IDENTITY.sha256,
      ];
    },
  },
  {
    name: "unresolved provenance parent",
    breakEdge(fixture) {
      fixture.manifest.provenance[0].immediateParentSha256 = [HASH_UNKNOWN_A];
      fixture.artifacts[0].immediateParentSha256 = [HASH_UNKNOWN_A];
    },
  },
  {
    name: "cyclic provenance ancestry",
    breakEdge(fixture) {
      const first = fixture.artifacts[0];
      const second = fixture.artifacts[1];
      first.immediateParentSha256 = [second.sha256];
      second.immediateParentSha256 = [first.sha256];
      findProvenance(fixture, first.id).immediateParentSha256 = [second.sha256];
      findProvenance(fixture, second.id).immediateParentSha256 = [first.sha256];
    },
  },
  {
    name: "provenance classification differs from current classification",
    breakEdge(fixture) {
      const artifact = fixture.artifacts[0];
      findProvenance(fixture, artifact.id).classification = artifact.classification === "synthetic"
        ? "source-derived"
        : "synthetic";
    },
  },
  {
    name: "synthetic fill relabeled source-derived",
    breakEdge(fixture) {
      const fillId = fixture.manifest.reconstructions[0].fillId;
      const artifact = fixture.artifacts.find(({ id }) => id === fillId);
      if (artifact === undefined) throw new Error("Missing generated fill");
      artifact.classification = "source-derived";
      findProvenance(fixture, fillId).classification = "source-derived";
    },
  },
  {
    name: "missing provenance record",
    breakEdge(fixture) {
      fixture.manifest.provenance.shift();
    },
  },
  {
    name: "orphan provenance record",
    breakEdge(fixture) {
      fixture.artifacts.pop();
    },
  },
  {
    name: "duplicate manifest record ID",
    breakEdge(fixture) {
      fixture.manifest.publicAssets[0].id = fixture.manifest.masks[0].id;
    },
  },
  {
    name: "dangling layer mask",
    breakEdge(fixture) {
      fixture.manifest.layers[0].segmentationMaskId = "missing-mask";
    },
  },
  {
    name: "dangling layer provenance",
    breakEdge(fixture) {
      fixture.manifest.layers[0].provenanceIds = ["missing-provenance"];
    },
  },
  {
    name: "stale approval artifact hash",
    breakEdge(fixture) {
      findApproval(fixture, "segmentation").artifactSha256[0] = HASH_UNKNOWN_A;
    },
  },
  {
    name: "approval artifact binding includes an unrelated known-hash superset",
    breakEdge(fixture) {
      const segmentation = findApproval(fixture, "segmentation");
      const segmentationRequirement = findRequirement(fixture, segmentation.id);
      const unrelatedHash = fixture.manifest.masks[1].sha256;
      segmentation.artifactSha256.push(unrelatedHash);
      segmentationRequirement.artifactSha256.push(unrelatedHash);
    },
  },
  {
    name: "approval evidence binding includes a package-artifact hash",
    breakEdge(fixture) {
      const segmentation = findApproval(fixture, "segmentation");
      const segmentationRequirement = findRequirement(fixture, segmentation.id);
      const unrelatedHash = fixture.manifest.publicAssets[0].sha256;
      segmentation.artifactSha256.push(unrelatedHash);
      segmentationRequirement.evidenceSha256?.push(unrelatedHash);
    },
  },
  {
    name: "approval includes an unrelated existing moving layer",
    breakEdge(fixture) {
      const segmentation = findApproval(fixture, "segmentation");
      const segmentationRequirement = findRequirement(fixture, segmentation.id);
      const unrelatedLayerId = fixture.manifest.layers[1].id;
      segmentation.layerIds.push(unrelatedLayerId);
      segmentationRequirement.layerIds.push(unrelatedLayerId);
    },
  },
  {
    name: "pending approval decision",
    breakEdge(fixture) {
      const motionApproval = findApproval(fixture, "motion");
      motionApproval.decision = "pending";
      motionApproval.reviewer = null;
      motionApproval.reviewedAt = null;
    },
  },
  {
    name: "missing referenced approval",
    breakEdge(fixture) {
      const motionApproval = findApproval(fixture, "motion");
      fixture.manifest.approvals = fixture.manifest.approvals.filter(({ id }) => id !== motionApproval.id);
    },
  },
  {
    name: "missing approval expectation",
    breakEdge(fixture) {
      fixture.approvalRequirements.pop();
    },
  },
  {
    name: "approval expectation binds an unknown hash",
    breakEdge(fixture) {
      fixture.approvalRequirements[0].artifactSha256[0] = HASH_UNKNOWN_B;
    },
  },
  {
    name: "approval binds an unknown layer",
    breakEdge(fixture) {
      const segmentation = findApproval(fixture, "segmentation");
      segmentation.layerIds = ["missing-layer"];
      findRequirement(fixture, segmentation.id).layerIds = ["missing-layer"];
    },
  },
  {
    name: "dangling relationship driver",
    breakEdge(fixture) {
      fixture.manifest.relationships[0].driverLayerId = "missing-layer";
    },
  },
  {
    name: "relationship references wrong approval scope",
    breakEdge(fixture) {
      fixture.manifest.relationships[0].approvalId = findApproval(fixture, "segmentation").id;
    },
  },
  {
    name: "relationship record hash changes",
    breakEdge(fixture) {
      fixture.manifest.relationships[0].driverToothCount += 1;
    },
  },
  {
    name: "dangling motion layer",
    breakEdge(fixture) {
      fixture.manifest.motionProfiles[0].layerId = "missing-layer";
    },
  },
  {
    name: "dangling public asset layer",
    breakEdge(fixture) {
      fixture.manifest.publicAssets[0].layerId = "missing-layer";
    },
  },
  {
    name: "stale phase projection hash",
    breakEdge(fixture) {
      fixture.manifest.phases[0].phasePayloadSha256 = HASH_UNKNOWN_A;
    },
  },
  {
    name: "phase binds an unknown artifact",
    breakEdge(fixture) {
      const phase = fixture.manifest.phases[2];
      phase.assetSha256[0] = HASH_UNKNOWN_A;
      phase.phasePayloadSha256 = phaseProjectionHash(fixture.manifest.packageId, phase);
    },
  },
  {
    name: "released phase omits a runtime asset",
    breakEdge(fixture) {
      const phase = fixture.manifest.phases[2];
      const runtimeAssetHash = fixture.runtimeManifest.profiles.compact.assets[0].sha256;
      phase.assetSha256 = phase.assetSha256.filter((digestValue) => digestValue !== runtimeAssetHash);
      phase.phasePayloadSha256 = phaseProjectionHash(fixture.manifest.packageId, phase);
    },
  },
  {
    name: "phase runtime hash differs from runtime bytes",
    breakEdge(fixture) {
      const phase = fixture.manifest.phases[2];
      phase.runtimeManifestSha256 = HASH_UNKNOWN_A;
      phase.phasePayloadSha256 = phaseProjectionHash(fixture.manifest.packageId, phase);
    },
  },
  {
    name: "runtime identity uses newline-free schema bytes instead of published canonical bytes",
    breakEdge(fixture) {
      const newlineFreeBytes = contract.RUNTIME_MANIFEST_SCHEMA.serialize(fixture.runtimeManifest);
      const newlineFreeHash = contract.sha256(newlineFreeBytes);
      const phase = fixture.manifest.phases[2];
      phase.runtimeManifestSha256 = newlineFreeHash;
      phase.phasePayloadSha256 = phaseProjectionHash(fixture.manifest.packageId, phase);
      fixture.manifest.runtimeManifest.byteLength = newlineFreeBytes.byteLength;
      fixture.manifest.runtimeManifest.sha256 = newlineFreeHash;
      fixture.release.runtimeManifest.byteLength = newlineFreeBytes.byteLength;
      fixture.release.runtimeManifest.sha256 = newlineFreeHash;
    },
  },
  {
    name: "package runtime identity is stale",
    breakEdge(fixture) {
      fixture.manifest.runtimeManifest.sha256 = HASH_UNKNOWN_A;
    },
  },
  {
    name: "release runtime identity is stale",
    breakEdge(fixture) {
      fixture.release.runtimeManifest.sha256 = HASH_UNKNOWN_A;
    },
  },
  {
    name: "release package ID differs",
    breakEdge(fixture) {
      fixture.release.packageId = "different-package";
    },
  },
  {
    name: "runtime asset identity differs",
    breakEdge(fixture) {
      fixture.runtimeManifest.profiles.compact.assets[0].sha256 = HASH_UNKNOWN_A;
    },
  },
  {
    name: "release approval omits the selected phase projection",
    breakEdge(fixture) {
      const releaseApproval = findApproval(fixture, "release");
      const releaseRequirement = findRequirement(fixture, releaseApproval.id);
      const selectedPayload = fixture.manifest.phases[2].phasePayloadSha256;
      const earlierPayload = fixture.manifest.phases[0].phasePayloadSha256;
      releaseApproval.artifactSha256 = releaseApproval.artifactSha256.map((digestValue) => (
        digestValue === selectedPayload ? earlierPayload : digestValue
      ));
      releaseRequirement.artifactSha256 = [...releaseApproval.artifactSha256];
    },
  },
];

// **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.9, 2.10, 2.11, 2.14, 3.14, 4.3, 4.4, 4.5, 4.6, 4.10, 5.10, 6.12, 6.13, 14.5, 14.10**
// Feature: interactive-layered-watch-2-5d, Property 2: Manifest, provenance, approval, and release closure
it(PROPERTY_TAG, { timeout: 120_000 }, () => {
  fc.assert(
    fc.property(graphArbitrary, (generated) => {
      const valid = buildClosedFixture(generated);
      const validBefore = structuredClone(valid);
      const validResult = closure.evaluateManifestClosure(valid);

      expect(validResult).toMatchObject({
        code: null,
        eligible: true,
        issueCode: null,
        ok: true,
        releasable: true,
      });
      expect(valid).toEqual(validBefore);

      const movingLayerIds = valid.manifest.layers
        .filter(({ disposition }) => disposition === "approved-moving")
        .map(({ id }) => id);
      const approvalSetRequirements = valid.manifest.approvals.map((record) => requirement(record));
      expect(approvalTools.evaluateApprovalSetClosure({
        approvals: valid.manifest.approvals,
        approvedMovingLayerIds: movingLayerIds,
        requirements: approvalSetRequirements,
      })).toMatchObject({
        approvedMovingLayerIds: [...movingLayerIds].sort(),
        failures: [],
        mode: "approved-moving",
        ok: true,
        releasable: true,
      });
      expect(approvalTools.evaluateApprovalSetClosure({
        approvals: valid.manifest.approvals,
        approvedMovingLayerIds: [...movingLayerIds, `${generated.stem}-unrelated-layer`],
        requirements: approvalSetRequirements,
      })).toMatchObject({
        approvedMovingLayerIds: [],
        mode: "static",
        ok: false,
        releasable: false,
      });

      for (const edgeBreaker of EDGE_BREAKERS) {
        const broken = structuredClone(valid);
        edgeBreaker.breakEdge(broken);
        const brokenBefore = structuredClone(broken);
        const result = closure.evaluateManifestClosure(broken);
        expect(
          result.eligible,
          `${edgeBreaker.name} must make the generated package ineligible`,
        ).toBe(false);
        expect(result.ok).toBe(false);
        expect(broken).toEqual(brokenBefore);
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
