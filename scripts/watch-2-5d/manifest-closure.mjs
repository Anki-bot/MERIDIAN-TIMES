import {
  APPROVED_MASTER_IDENTITY,
  DEPTH_PROFILE_SCHEMA,
  GEAR_RELATIONSHIP_SCHEMA,
  LAYER_ASSET_MANIFEST_SCHEMA,
  LAYER_GATE_FAILURE_CODES,
  LAYER_RECORD_SCHEMA,
  MOTION_PROFILE_SCHEMA,
  PREDECESSOR_MANIFEST_IDENTITY,
  PROVENANCE_CLASSIFICATIONS,
  RELEASE_POINTER_SCHEMA,
  RUNTIME_MANIFEST_SCHEMA,
  canonicalJsonStringify,
  canonicalizeJson,
  serializeCanonicalJson,
  sha256,
} from "./contract.mjs";
import { evaluateApprovalClosure } from "./approval-records.mjs";

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CLASSIFICATION_SET = new Set(PROVENANCE_CLASSIFICATIONS);

export const MANIFEST_CLOSURE_ISSUE_CODES = Object.freeze({
  APPROVAL_BINDING_INVALID: "CLOSURE_APPROVAL_BINDING_INVALID",
  APPROVAL_MISSING: "CLOSURE_APPROVAL_MISSING",
  APPROVAL_NOT_CLOSED: "CLOSURE_APPROVAL_NOT_CLOSED",
  ARTIFACT_DUPLICATE: "CLOSURE_ARTIFACT_DUPLICATE",
  ARTIFACT_IDENTITY_MISMATCH: "CLOSURE_ARTIFACT_IDENTITY_MISMATCH",
  ARTIFACT_MISSING: "CLOSURE_ARTIFACT_MISSING",
  INPUT_INVALID: "CLOSURE_INPUT_INVALID",
  PHASE_ASSET_MISSING: "CLOSURE_PHASE_ASSET_MISSING",
  PHASE_PROJECTION_MISMATCH: "CLOSURE_PHASE_PROJECTION_MISMATCH",
  PROVENANCE_ARTIFACT_MISMATCH: "CLOSURE_PROVENANCE_ARTIFACT_MISMATCH",
  PROVENANCE_CLASSIFICATION_MISMATCH: "CLOSURE_PROVENANCE_CLASSIFICATION_MISMATCH",
  PROVENANCE_CYCLE: "CLOSURE_PROVENANCE_CYCLE",
  PROVENANCE_MISSING: "CLOSURE_PROVENANCE_MISSING",
  PROVENANCE_ORPHAN: "CLOSURE_PROVENANCE_ORPHAN",
  PROVENANCE_PARENT_MISMATCH: "CLOSURE_PROVENANCE_PARENT_MISMATCH",
  PROVENANCE_PARENT_MISSING: "CLOSURE_PROVENANCE_PARENT_MISSING",
  REFERENCE_INVALID: "CLOSURE_REFERENCE_INVALID",
  RELEASE_REFERENCE_MISMATCH: "CLOSURE_RELEASE_REFERENCE_MISMATCH",
  RUNTIME_IDENTITY_MISMATCH: "CLOSURE_RUNTIME_IDENTITY_MISMATCH",
  RUNTIME_MEMBERSHIP_MISMATCH: "CLOSURE_RUNTIME_MEMBERSHIP_MISMATCH",
});

class ManifestClosureError extends TypeError {
  constructor(issueCode, message, path, code = LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID) {
    super(message);
    this.code = code;
    this.issueCode = issueCode;
    this.name = "ManifestClosureError";
    this.path = path;
  }
}

function closureFail(issueCode, message, path = "$") {
  throw new ManifestClosureError(issueCode, message, path);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactFields(value, fields, path) {
  if (!isPlainObject(value)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Value must be a plain object", path);
  }
  const expected = [...fields].sort();
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID,
      `Object fields must equal ${expected.join(", ")}`,
      path,
    );
  }
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !STABLE_ID_PATTERN.test(value)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Value must be a stable lowercase ID", path);
  }
  return value;
}

function assertSha256(value, path) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Value must be a lowercase SHA-256", path);
  }
  return value;
}

function assertUniqueStrings(values, path) {
  if (!Array.isArray(values)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Value must be an array", path);
  }
  const seen = new Set();
  values.forEach((value, index) => {
    assertSha256(value, `${path}[${index}]`);
    if (seen.has(value)) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Hash arrays must not contain duplicates", `${path}[${index}]`);
    }
    seen.add(value);
  });
  return values;
}

function assertUniqueIds(values, path) {
  if (!Array.isArray(values)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Value must be an array", path);
  }
  const seen = new Set();
  values.forEach((value, index) => {
    assertStableId(value, `${path}[${index}]`);
    if (seen.has(value)) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "ID arrays must not contain duplicates", `${path}[${index}]`);
    }
    seen.add(value);
  });
  return values;
}

function equalSets(left, right) {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function isSubset(subset, superset) {
  const values = new Set(superset);
  return subset.every((value) => values.has(value));
}

function canonicalRecordHash(schema, value) {
  return sha256(schema.serialize(value));
}

export function createPhaseProjection(packageId, phase) {
  assertStableId(packageId, "$.packageId");
  if (!isPlainObject(phase)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Phase must be a plain object", "$.phase");
  }
  if (typeof phase.name !== "string" || !Array.isArray(phase.assetSha256)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Phase projection input is incomplete", "$.phase");
  }
  phase.assetSha256.forEach((digest, index) => assertSha256(digest, `$.phase.assetSha256[${index}]`));
  if (phase.runtimeManifestSha256 !== null) {
    assertSha256(phase.runtimeManifestSha256, "$.phase.runtimeManifestSha256");
  }
  return canonicalizeJson({
    assetSha256: phase.assetSha256,
    name: phase.name,
    packageId,
    runtimeManifestSha256: phase.runtimeManifestSha256,
  });
}

export function hashPhaseProjection(packageId, phase) {
  return sha256(serializeCanonicalJson(createPhaseProjection(packageId, phase)));
}

function pivotProjectionHash(layer) {
  return sha256(serializeCanonicalJson({
    layerId: layer.id,
    pivot: layer.pivot,
  }));
}

function parseObservedArtifacts(value) {
  if (!Array.isArray(value)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "artifacts must be an array", "$.artifacts");
  }
  const artifacts = value.map((artifact, index) => {
    const path = `$.artifacts[${index}]`;
    assertExactFields(
      artifact,
      ["classification", "id", "immediateParentSha256", "sha256"],
      path,
    );
    assertStableId(artifact.id, `${path}.id`);
    assertSha256(artifact.sha256, `${path}.sha256`);
    assertUniqueStrings(artifact.immediateParentSha256, `${path}.immediateParentSha256`);
    if (artifact.immediateParentSha256.length === 0) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Derived artifacts require at least one immediate parent", `${path}.immediateParentSha256`);
    }
    if (!CLASSIFICATION_SET.has(artifact.classification)) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Artifact classification is unsupported", `${path}.classification`);
    }
    return artifact;
  });

  const byId = new Map();
  artifacts.forEach((artifact, index) => {
    if (byId.has(artifact.id)) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.ARTIFACT_DUPLICATE,
        `Artifact ID ${artifact.id} is duplicated`,
        `$.artifacts[${index}].id`,
      );
    }
    byId.set(artifact.id, artifact);
  });
  return { artifacts, byId };
}

function validateArtifactProvenance(manifest, artifacts, artifactById) {
  const provenanceByArtifactId = new Map();
  manifest.provenance.forEach((record, index) => {
    if (!artifactById.has(record.artifactId)) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_ORPHAN,
        `Provenance ${record.id} names an unobserved artifact`,
        `$.manifest.provenance[${index}].artifactId`,
      );
    }
    if (provenanceByArtifactId.has(record.artifactId)) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_ARTIFACT_MISMATCH,
        `Artifact ${record.artifactId} has more than one provenance record`,
        `$.manifest.provenance[${index}].artifactId`,
      );
    }
    provenanceByArtifactId.set(record.artifactId, record);
  });

  for (const artifact of artifacts) {
    const record = provenanceByArtifactId.get(artifact.id);
    if (record === undefined) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_MISSING,
        `Artifact ${artifact.id} lacks provenance`,
        "$.manifest.provenance",
      );
    }
    if (record.artifactSha256 !== artifact.sha256) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_ARTIFACT_MISMATCH,
        `Provenance hash for ${artifact.id} does not match observed bytes`,
        `$.manifest.provenance.${record.id}.artifactSha256`,
      );
    }
    if (record.classification !== artifact.classification) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_CLASSIFICATION_MISMATCH,
        `Provenance classification for ${artifact.id} does not match the observed artifact classification`,
        `$.manifest.provenance.${record.id}.classification`,
      );
    }
    if (!equalSets(record.immediateParentSha256, artifact.immediateParentSha256)) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_PARENT_MISMATCH,
        `Provenance parents for ${artifact.id} do not match the exact current parent set`,
        `$.manifest.provenance.${record.id}.immediateParentSha256`,
      );
    }
  }

  const trustedRoots = new Set([
    APPROVED_MASTER_IDENTITY.sha256,
    PREDECESSOR_MANIFEST_IDENTITY.sha256,
  ]);
  const artifactHashes = new Set(artifacts.map(({ sha256: digest }) => digest));
  for (const artifact of artifacts) {
    for (const parentHash of artifact.immediateParentSha256) {
      if (!trustedRoots.has(parentHash) && !artifactHashes.has(parentHash)) {
        closureFail(
          MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_PARENT_MISSING,
          `Parent hash for ${artifact.id} does not resolve`,
          `$.artifacts.${artifact.id}.immediateParentSha256`,
        );
      }
    }
  }

  const parentsByHash = new Map();
  for (const artifact of artifacts) {
    const parents = parentsByHash.get(artifact.sha256) ?? new Set();
    for (const parentHash of artifact.immediateParentSha256) {
      if (artifactHashes.has(parentHash)) parents.add(parentHash);
    }
    parentsByHash.set(artifact.sha256, parents);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (digest) => {
    if (visiting.has(digest)) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_CYCLE,
        "Artifact parent links must form an acyclic graph",
        "$.manifest.provenance",
      );
    }
    if (visited.has(digest)) return;
    visiting.add(digest);
    for (const parentHash of parentsByHash.get(digest) ?? []) visit(parentHash);
    visiting.delete(digest);
    visited.add(digest);
  };
  for (const digest of artifactHashes) visit(digest);

  return provenanceByArtifactId;
}

function requireArtifact(artifactById, id, expectedHash, path) {
  const artifact = artifactById.get(id);
  if (artifact === undefined) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.ARTIFACT_MISSING, `Artifact ${id} is missing`, path);
  }
  if (artifact.sha256 !== expectedHash) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.ARTIFACT_IDENTITY_MISMATCH,
      `Artifact ${id} does not match its manifest identity`,
      path,
    );
  }
  return artifact;
}

function requireReference(map, id, path, label) {
  const value = map.get(id);
  if (value === undefined) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.REFERENCE_INVALID, `${label} ${id} does not resolve`, path);
  }
  return value;
}

function addApprovalContext(contexts, approvalById, {
  approvalId,
  hashes = [],
  layerIds = [],
  path,
  scope,
}) {
  const approval = requireReference(approvalById, approvalId, path, "Approval");
  if (scope !== null && approval.scope !== scope) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID,
      `Approval ${approvalId} must use ${scope} scope`,
      path,
    );
  }
  const existing = contexts.get(approvalId) ?? {
    hashes: new Set(),
    layerIds: new Set(),
    scope: approval.scope,
  };
  if (existing.scope !== approval.scope) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID, `Approval ${approvalId} has incompatible uses`, path);
  }
  hashes.forEach((digest) => existing.hashes.add(digest));
  layerIds.forEach((layerId) => existing.layerIds.add(layerId));
  contexts.set(approvalId, existing);
}

function sameRecordCollections(left, right) {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map((record) => [record.id, canonicalJsonStringify(record)]));
  return left.every((record) => rightById.get(record.id) === canonicalJsonStringify(record));
}

function validateRuntimeClosure(manifest, runtimeValue, release, artifactById, phaseByName) {
  if (release.status === "fallback-only") {
    if (runtimeValue !== null || manifest.runtimeManifest !== null) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.RELEASE_REFERENCE_MISMATCH,
        "A fallback-only release must not resolve a runtime manifest",
        "$.release.runtimeManifest",
      );
    }
    return { runtimeHash: null, selectedPhase: null };
  }

  if (runtimeValue === null || manifest.runtimeManifest === null) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RELEASE_REFERENCE_MISMATCH,
      "A ready release requires one exact runtime manifest",
      "$.runtimeManifest",
    );
  }
  const runtimeManifest = RUNTIME_MANIFEST_SCHEMA.parse(runtimeValue);
  const runtimeBytes = RUNTIME_MANIFEST_SCHEMA.serializeLine(runtimeManifest);
  const runtimeHash = sha256(runtimeBytes);
  if (
    manifest.runtimeManifest.sha256 !== runtimeHash
    || manifest.runtimeManifest.byteLength !== runtimeBytes.byteLength
  ) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RUNTIME_IDENTITY_MISMATCH,
      "Package runtime-manifest identity does not match canonical runtime bytes",
      "$.manifest.runtimeManifest",
    );
  }
  if (
    release.runtimeManifest.sha256 !== runtimeHash
    || release.runtimeManifest.byteLength !== runtimeBytes.byteLength
    || release.runtimeManifest.publicPath !== manifest.runtimeManifest.publicPath
    || release.runtimeManifest.mediaType !== manifest.runtimeManifest.mediaType
  ) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RELEASE_REFERENCE_MISMATCH,
      "Release runtime-manifest identity does not match the package",
      "$.release.runtimeManifest",
    );
  }
  if (
    release.packageId !== manifest.packageId
    || runtimeManifest.packageId !== manifest.packageId
    || release.releaseId !== runtimeManifest.releaseId
  ) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RELEASE_REFERENCE_MISMATCH,
      "Release, package, and runtime IDs do not close",
      "$.release",
    );
  }

  const runtimeAssets = [
    ...runtimeManifest.profiles.compact.assets,
    ...runtimeManifest.profiles.expanded.assets,
  ];
  if (!sameRecordCollections(runtimeAssets, manifest.publicAssets)) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RUNTIME_MEMBERSHIP_MISMATCH,
      "Runtime profile assets must equal the package public-asset set",
      "$.runtimeManifest.profiles",
    );
  }
  if (
    !sameRecordCollections(runtimeManifest.motionProfiles, manifest.motionProfiles)
    || !sameRecordCollections(runtimeManifest.depthProfiles, manifest.depthProfiles)
  ) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RUNTIME_MEMBERSHIP_MISMATCH,
      "Runtime motion and depth records must equal the package records",
      "$.runtimeManifest",
    );
  }
  runtimeAssets.forEach((asset, index) => {
    requireArtifact(artifactById, asset.id, asset.sha256, `$.runtimeManifest.assets[${index}]`);
  });

  const selectedPhase = requireReference(
    phaseByName,
    runtimeManifest.phase,
    "$.runtimeManifest.phase",
    "Phase",
  );
  if (selectedPhase.status !== "approved" || selectedPhase.runtimeManifestSha256 !== runtimeHash) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RELEASE_REFERENCE_MISMATCH,
      "Ready runtime must resolve an approved phase bound to its exact hash",
      "$.manifest.phases",
    );
  }
  if (!isSubset(runtimeAssets.map(({ sha256: digest }) => digest), selectedPhase.assetSha256)) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RUNTIME_MEMBERSHIP_MISMATCH,
      "Released phase must bind every runtime public asset hash",
      "$.manifest.phases",
    );
  }
  const hasEnabledDepth = manifest.depthProfiles.some(({ enabled }) => enabled);
  if (
    release.depthEnabled !== hasEnabledDepth
    || (release.depthEnabled && runtimeManifest.phase !== "optional-depth")
  ) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.RELEASE_REFERENCE_MISMATCH,
      "Release depth flag does not match the selected runtime phase",
      "$.release.depthEnabled",
    );
  }
  return { runtimeHash, selectedPhase };
}

function evaluateApprovalContexts({
  approvalContexts,
  approvalRequirements,
  approvalById,
  bindingHashes,
  evidenceHashes,
  layerById,
}) {
  if (!Array.isArray(approvalRequirements)) {
    closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "approvalRequirements must be an array", "$.approvalRequirements");
  }
  const requirementsById = new Map();
  approvalRequirements.forEach((requirement, index) => {
    const path = `$.approvalRequirements[${index}]`;
    if (!isPlainObject(requirement)) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID, "Approval requirement must be a plain object", path);
    }
    const hasEvidence = Object.prototype.hasOwnProperty.call(requirement, "evidenceSha256");
    assertExactFields(
      requirement,
      [
        "approvalId",
        "artifactSha256",
        ...(hasEvidence ? ["evidenceSha256"] : []),
        "layerIds",
        "reviewedPoseIds",
        "reviewedZoomPercent",
        "scope",
      ],
      path,
    );
    const approvalId = assertStableId(requirement.approvalId, `${path}.approvalId`);
    assertUniqueStrings(requirement.artifactSha256, `${path}.artifactSha256`);
    const requirementEvidenceHashes = hasEvidence
      ? assertUniqueStrings(requirement.evidenceSha256, `${path}.evidenceSha256`)
      : [];
    assertUniqueIds(requirement.layerIds, `${path}.layerIds`);
    const artifactHashes = new Set(requirement.artifactSha256);
    if (requirementEvidenceHashes.some((digest) => artifactHashes.has(digest))) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID,
        `Approval requirement ${approvalId} must keep artifact and evidence hash sets disjoint`,
        path,
      );
    }
    if (requirementsById.has(approvalId)) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID, `Approval requirement ${approvalId} is duplicated`, `${path}.approvalId`);
    }
    requirementsById.set(approvalId, {
      ...requirement,
      evidenceSha256: requirementEvidenceHashes,
    });
  });

  if (
    requirementsById.size !== approvalContexts.size
    || [...approvalContexts.keys()].some((approvalId) => !requirementsById.has(approvalId))
  ) {
    closureFail(
      MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_MISSING,
      "Every referenced approval requires one exact current expectation",
      "$.approvalRequirements",
    );
  }

  for (const [approvalId, context] of approvalContexts) {
    const requirement = requirementsById.get(approvalId);
    if (requirement.scope !== context.scope) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID, `Approval requirement ${approvalId} has an incompatible scope`, `$.approvalRequirements.${approvalId}`);
    }
    for (const digest of requirement.artifactSha256) {
      if (!bindingHashes.has(digest)) {
        closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID, `Approval ${approvalId} binds an unknown artifact hash`, `$.approvalRequirements.${approvalId}.artifactSha256`);
      }
    }
    for (const digest of requirement.evidenceSha256) {
      if (!evidenceHashes.has(digest)) {
        closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID, `Approval ${approvalId} binds a hash that is not current review evidence`, `$.approvalRequirements.${approvalId}.evidenceSha256`);
      }
    }
    for (const layerId of requirement.layerIds) {
      if (!layerById.has(layerId)) {
        closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID, `Approval ${approvalId} binds an unknown layer`, `$.approvalRequirements.${approvalId}.layerIds`);
      }
    }
    if (
      !equalSets([...context.hashes], requirement.artifactSha256)
      || !equalSets([...context.layerIds], requirement.layerIds)
    ) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID,
        `Approval ${approvalId} must equal the exact current artifact and layer sets`,
        `$.approvalRequirements.${approvalId}`,
      );
    }
    const result = evaluateApprovalClosure(approvalById.get(approvalId), {
      approvalId,
      artifactSha256: [...requirement.artifactSha256, ...requirement.evidenceSha256],
      layerIds: requirement.layerIds,
      reviewedPoseIds: requirement.reviewedPoseIds,
      reviewedZoomPercent: requirement.reviewedZoomPercent,
      scope: requirement.scope,
    });
    if (!result.ok) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_NOT_CLOSED,
        `Approval ${approvalId} does not close: ${result.reason}`,
        `$.manifest.approvals.${approvalId}`,
      );
    }
  }
}

function inspectManifestClosure(options) {
  const hasExternalEvidence = isPlainObject(options)
    && Object.prototype.hasOwnProperty.call(options, "evidenceSha256");
  assertExactFields(
    options,
    [
      "approvalRequirements",
      "artifacts",
      ...(hasExternalEvidence ? ["evidenceSha256"] : []),
      "manifest",
      "release",
      "runtimeManifest",
    ],
    "$",
  );
  const externalEvidenceSha256 = hasExternalEvidence
    ? assertUniqueStrings(options.evidenceSha256, "$.evidenceSha256")
    : [];
  const manifest = LAYER_ASSET_MANIFEST_SCHEMA.parse(options.manifest);
  const release = RELEASE_POINTER_SCHEMA.parse(options.release);
  const { artifacts, byId: artifactById } = parseObservedArtifacts(options.artifacts);
  const provenanceByArtifactId = validateArtifactProvenance(
    manifest,
    artifacts,
    artifactById,
  );
  const provenanceById = new Map(manifest.provenance.map((record) => [record.id, record]));
  const maskById = new Map(manifest.masks.map((record) => [record.id, record]));
  const layerById = new Map(manifest.layers.map((record) => [record.id, record]));
  const motionById = new Map(manifest.motionProfiles.map((record) => [record.id, record]));
  const approvalById = new Map(manifest.approvals.map((record) => [record.id, record]));
  const phaseByName = new Map(manifest.phases.map((record) => [record.name, record]));
  const approvalContexts = new Map();
  const bindingHashes = new Set([
    APPROVED_MASTER_IDENTITY.sha256,
    PREDECESSOR_MANIFEST_IDENTITY.sha256,
    ...artifacts.map(({ sha256: digest }) => digest),
  ]);
  const packageArtifactHashes = new Set();

  manifest.masks.forEach((mask, index) => {
    requireArtifact(artifactById, mask.id, mask.sha256, `$.manifest.masks[${index}]`);
    packageArtifactHashes.add(mask.sha256);
    const provenance = requireReference(provenanceById, mask.provenanceId, `$.manifest.masks[${index}].provenanceId`, "Provenance");
    if (provenance.artifactId !== mask.id) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_ARTIFACT_MISMATCH, `Mask ${mask.id} provenance names another artifact`, `$.manifest.masks[${index}].provenanceId`);
    }
  });

  manifest.layers.forEach((layer, index) => {
    requireReference(maskById, layer.segmentationMaskId, `$.manifest.layers[${index}].segmentationMaskId`, "Mask");
    const layerHash = canonicalRecordHash(LAYER_RECORD_SCHEMA, layer);
    bindingHashes.add(layerHash);
    packageArtifactHashes.add(layerHash);
    requireArtifact(artifactById, layer.id, layerHash, `$.manifest.layers[${index}]`);
    if (layer.provenanceIds.length === 0) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_MISSING, `Layer ${layer.id} requires provenance`, `$.manifest.layers[${index}].provenanceIds`);
    }
    const layerProvenance = layer.provenanceIds.map((provenanceId) => requireReference(
      provenanceById,
      provenanceId,
      `$.manifest.layers[${index}].provenanceIds`,
      "Provenance",
    ));
    if (!layerProvenance.some(({ artifactId }) => artifactId === layer.id)) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_ARTIFACT_MISMATCH, `Layer ${layer.id} lacks provenance for its canonical record`, `$.manifest.layers[${index}].provenanceIds`);
    }
    layer.approvalIds.forEach((approvalId) => {
      const approval = requireReference(approvalById, approvalId, `$.manifest.layers[${index}].approvalIds`, "Approval");
      const mask = maskById.get(layer.segmentationMaskId);
      const hashes = approval.scope === "segmentation"
        ? [mask.sha256]
        : approval.scope === "pivot" && layer.pivot !== undefined
          ? [pivotProjectionHash(layer)]
          : [];
      hashes.forEach((digest) => bindingHashes.add(digest));
      addApprovalContext(approvalContexts, approvalById, {
        approvalId,
        hashes,
        layerIds: [layer.id],
        path: `$.manifest.layers[${index}].approvalIds`,
        scope: approval.scope,
      });
    });
  });

  manifest.reconstructions.forEach((reconstruction, index) => {
    const regionMask = requireReference(maskById, reconstruction.regionMaskId, `$.manifest.reconstructions[${index}].regionMaskId`, "Mask");
    const boundaryMask = requireReference(maskById, reconstruction.boundaryMaskId, `$.manifest.reconstructions[${index}].boundaryMaskId`, "Mask");
    const fill = requireArtifact(artifactById, reconstruction.fillId, reconstruction.fillSha256, `$.manifest.reconstructions[${index}].fillId`);
    packageArtifactHashes.add(reconstruction.fillSha256);
    if (fill.classification !== "synthetic") {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_CLASSIFICATION_MISMATCH, "Reconstruction fills must be classified synthetic", `$.manifest.reconstructions[${index}].fillId`);
    }
    const provenance = requireReference(provenanceById, reconstruction.provenanceId, `$.manifest.reconstructions[${index}].provenanceId`, "Provenance");
    if (provenance.artifactId !== reconstruction.fillId) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_ARTIFACT_MISMATCH, "Reconstruction provenance must identify the exact fill", `$.manifest.reconstructions[${index}].provenanceId`);
    }
    const reconstructionLayerIds = manifest.layers
      .filter(({ approvalIds }) => approvalIds.includes(reconstruction.approvalId))
      .map(({ id }) => id);
    if (reconstructionLayerIds.length === 0) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_BINDING_INVALID,
        `Reconstruction ${reconstruction.id} approval is not linked by any layer`,
        `$.manifest.reconstructions[${index}].approvalId`,
      );
    }
    addApprovalContext(approvalContexts, approvalById, {
      approvalId: reconstruction.approvalId,
      hashes: [reconstruction.fillSha256, regionMask.sha256, boundaryMask.sha256],
      layerIds: reconstructionLayerIds,
      path: `$.manifest.reconstructions[${index}].approvalId`,
      scope: "reconstruction",
    });
  });

  manifest.motionProfiles.forEach((motion, index) => {
    const layer = requireReference(layerById, motion.layerId, `$.manifest.motionProfiles[${index}].layerId`, "Layer");
    if (layer.motionProfileId !== motion.id) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.REFERENCE_INVALID, `Motion ${motion.id} is not the layer's declared profile`, `$.manifest.motionProfiles[${index}].layerId`);
    }
    const motionHash = canonicalRecordHash(MOTION_PROFILE_SCHEMA, motion);
    bindingHashes.add(motionHash);
    packageArtifactHashes.add(motionHash);
    requireArtifact(artifactById, motion.id, motionHash, `$.manifest.motionProfiles[${index}]`);
    addApprovalContext(approvalContexts, approvalById, {
      approvalId: motion.approvalId,
      hashes: [motionHash],
      layerIds: [motion.layerId],
      path: `$.manifest.motionProfiles[${index}].approvalId`,
      scope: "motion",
    });
  });

  manifest.relationships.forEach((relationship, index) => {
    const driver = requireReference(layerById, relationship.driverLayerId, `$.manifest.relationships[${index}].driverLayerId`, "Layer");
    const driven = requireReference(layerById, relationship.drivenLayerId, `$.manifest.relationships[${index}].drivenLayerId`, "Layer");
    if (driver.disposition !== "approved-moving" || driven.disposition !== "approved-moving") {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.REFERENCE_INVALID, "Relationships may only connect approved moving layers", `$.manifest.relationships[${index}]`);
    }
    const relationshipHash = canonicalRecordHash(GEAR_RELATIONSHIP_SCHEMA, relationship);
    bindingHashes.add(relationshipHash);
    packageArtifactHashes.add(relationshipHash);
    requireArtifact(artifactById, relationship.id, relationshipHash, `$.manifest.relationships[${index}]`);
    addApprovalContext(approvalContexts, approvalById, {
      approvalId: relationship.approvalId,
      hashes: [relationshipHash],
      layerIds: [relationship.driverLayerId, relationship.drivenLayerId],
      path: `$.manifest.relationships[${index}].approvalId`,
      scope: "motion",
    });
  });

  manifest.depthProfiles.forEach((depth, index) => {
    depth.layers.forEach(({ layerId }, layerIndex) => requireReference(layerById, layerId, `$.manifest.depthProfiles[${index}].layers[${layerIndex}].layerId`, "Layer"));
    const depthHash = canonicalRecordHash(DEPTH_PROFILE_SCHEMA, depth);
    bindingHashes.add(depthHash);
    packageArtifactHashes.add(depthHash);
    requireArtifact(artifactById, depth.id, depthHash, `$.manifest.depthProfiles[${index}]`);
    if (depth.enabled) {
      addApprovalContext(approvalContexts, approvalById, {
        approvalId: depth.approvalId,
        hashes: [depthHash],
        layerIds: depth.layers.map(({ layerId }) => layerId),
        path: `$.manifest.depthProfiles[${index}].approvalId`,
        scope: "depth",
      });
    }
  });

  manifest.publicAssets.forEach((asset, index) => {
    requireArtifact(artifactById, asset.id, asset.sha256, `$.manifest.publicAssets[${index}]`);
    packageArtifactHashes.add(asset.sha256);
    if (asset.layerId !== "reconstructed-background") {
      requireReference(layerById, asset.layerId, `$.manifest.publicAssets[${index}].layerId`, "Layer");
    }
    if (!provenanceByArtifactId.has(asset.id)) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.PROVENANCE_MISSING, `Public asset ${asset.id} requires provenance`, `$.manifest.publicAssets[${index}]`);
    }
  });

  for (const layer of manifest.layers.filter(({ disposition }) => disposition === "approved-moving")) {
    const scopes = new Set(layer.approvalIds.map((approvalId) => approvalById.get(approvalId)?.scope));
    if (!scopes.has("segmentation") || !scopes.has("pivot")) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_MISSING, `Approved moving layer ${layer.id} requires segmentation and pivot approvals`, `$.manifest.layers.${layer.id}.approvalIds`);
    }
    requireReference(motionById, layer.motionProfileId, `$.manifest.layers.${layer.id}.motionProfileId`, "Motion profile");
    const hasReconstructionApproval = manifest.reconstructions.some((reconstruction) => (
      layer.approvalIds.includes(reconstruction.approvalId)
    ));
    if (!hasReconstructionApproval) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_MISSING, `Approved moving layer ${layer.id} requires reconstruction approval`, `$.manifest.layers.${layer.id}`);
    }
  }

  for (const phase of manifest.phases) {
    const expectedHash = hashPhaseProjection(manifest.packageId, phase);
    bindingHashes.add(expectedHash);
    if (phase.phasePayloadSha256 !== expectedHash) {
      closureFail(
        MANIFEST_CLOSURE_ISSUE_CODES.PHASE_PROJECTION_MISMATCH,
        `Phase ${phase.name} does not match its canonical projection`,
        `$.manifest.phases.${phase.name}.phasePayloadSha256`,
      );
    }
    phase.assetSha256.forEach((digest) => {
      if (![...artifactById.values()].some((artifact) => artifact.sha256 === digest)) {
        closureFail(MANIFEST_CLOSURE_ISSUE_CODES.PHASE_ASSET_MISSING, `Phase ${phase.name} binds an unknown artifact hash`, `$.manifest.phases.${phase.name}.assetSha256`);
      }
      packageArtifactHashes.add(digest);
    });
  }

  const runtimeClosure = validateRuntimeClosure(
    manifest,
    options.runtimeManifest,
    release,
    artifactById,
    phaseByName,
  );
  if (runtimeClosure.runtimeHash !== null) bindingHashes.add(runtimeClosure.runtimeHash);
  if (runtimeClosure.selectedPhase !== null) {
    const selectedPhase = runtimeClosure.selectedPhase;
    if (selectedPhase.approvalId === undefined) {
      closureFail(MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_MISSING, "A released phase requires an exact release approval", `$.manifest.phases.${selectedPhase.name}.approvalId`);
    }
    const releasedMovingLayerIds = ["approved-part-motion", "optional-depth"].includes(selectedPhase.name)
      ? manifest.layers
        .filter(({ disposition }) => disposition === "approved-moving")
        .map(({ id }) => id)
      : [];
    addApprovalContext(approvalContexts, approvalById, {
      approvalId: selectedPhase.approvalId,
      hashes: [
        selectedPhase.phasePayloadSha256,
        selectedPhase.runtimeManifestSha256,
        ...selectedPhase.assetSha256,
      ],
      layerIds: releasedMovingLayerIds,
      path: `$.manifest.phases.${selectedPhase.name}.approvalId`,
      scope: "release",
    });

    if (manifest.layers.length === 0) {
      const globalFidelityApprovals = manifest.approvals.filter((approval) => (
        approval.scope === "fidelity" && approval.layerIds.length === 0
      ));
      if (globalFidelityApprovals.length !== 1) {
        closureFail(
          MANIFEST_CLOSURE_ISSUE_CODES.APPROVAL_MISSING,
          "A ready empty-layer package requires exactly one global fidelity approval",
          "$.manifest.approvals",
        );
      }
      const fidelityApproval = globalFidelityApprovals[0];
      const fidelityHashes = [
        APPROVED_MASTER_IDENTITY.sha256,
        selectedPhase.phasePayloadSha256,
        selectedPhase.runtimeManifestSha256,
        ...selectedPhase.assetSha256,
      ];
      fidelityHashes.forEach((digest) => bindingHashes.add(digest));
      addApprovalContext(approvalContexts, approvalById, {
        approvalId: fidelityApproval.id,
        hashes: fidelityHashes,
        layerIds: [],
        path: `$.manifest.approvals.${fidelityApproval.id}`,
        scope: "fidelity",
      });
    }
  }

  const evidenceHashes = new Set([
    ...externalEvidenceSha256,
    ...artifacts
      .map(({ sha256: digest }) => digest)
      .filter((digest) => !packageArtifactHashes.has(digest)),
  ]);
  evaluateApprovalContexts({
    approvalById,
    approvalContexts,
    approvalRequirements: options.approvalRequirements,
    bindingHashes,
    evidenceHashes,
    layerById,
  });

  return Object.freeze({
    code: null,
    eligible: true,
    issueCode: null,
    message: "Manifest, provenance, approvals, phases, and release references are closed",
    ok: true,
    path: null,
    releasable: release.status === "ready",
  });
}

function failureResult(error) {
  if (error instanceof ManifestClosureError) {
    return Object.freeze({
      code: error.code,
      eligible: false,
      issueCode: error.issueCode,
      message: error.message,
      ok: false,
      path: error.path,
      releasable: false,
    });
  }
  if (error !== null && typeof error === "object" && "code" in error) {
    return Object.freeze({
      code: typeof error.code === "string" ? error.code : LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      eligible: false,
      issueCode: "issueCode" in error && typeof error.issueCode === "string"
        ? error.issueCode
        : MANIFEST_CLOSURE_ISSUE_CODES.INPUT_INVALID,
      message: error instanceof Error ? error.message : "Closure input is invalid",
      ok: false,
      path: "path" in error && typeof error.path === "string" ? error.path : "$",
      releasable: false,
    });
  }
  throw error;
}

/**
 * Pure, fail-closed referential and hash-closure evaluation for a strict package.
 * `artifacts` represents identities observed by the caller from current bytes; this
 * module performs no filesystem or network operations and never mutates its inputs.
 */
export function evaluateManifestClosure(options) {
  try {
    return inspectManifestClosure(options);
  } catch (error) {
    return failureResult(error);
  }
}

export function isManifestClosureEligible(options) {
  return evaluateManifestClosure(options).eligible;
}
