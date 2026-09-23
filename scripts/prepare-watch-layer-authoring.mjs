import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import {
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPROVED_MASTER_IDENTITY,
  CANONICAL_PROJECT_PATHS,
  DEFAULT_PROJECT_ROOT,
  LAYER_GATE_FAILURE_CODES,
  RELEASE_POINTER_SCHEMA,
  assertApprovedMasterIdentity,
  assertInputHashSnapshotUnchanged,
  assertPredecessorManifestIdentity,
  canonicalizeJson,
  createInputHashSnapshot,
  inspectApprovedDependencyFields,
  inspectSafeRegularFile,
  resolveSafeProjectPath,
  serializeCanonicalJsonLine,
  sha256,
} from "./watch-2-5d/contract.mjs";
import { evaluateApprovalClosure } from "./watch-2-5d/approval-records.mjs";
import {
  AUTHORING_STATIC_REASON_CODES,
  loadWatchLayerAuthoring,
} from "./watch-2-5d/authoring-loader.mjs";
import {
  LAYER_REVIEW_EVIDENCE_DIRECTORY,
  LAYER_REVIEW_EVIDENCE_INDEX_PATH,
  isLayerReviewEvidencePath,
  renderLayerReviewEvidence,
  validateLayerReviewEvidenceIndex,
} from "./watch-2-5d/review-evidence.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const NORMALIZED_INPUTS_FILENAME = "normalized-package-inputs.json";
export const NORMALIZED_WATCH_LAYER_INPUTS_PATH =
  `${CANONICAL_PROJECT_PATHS.successorReviewDirectory}/${NORMALIZED_INPUTS_FILENAME}`;

export const PRODUCTION_AUTHORING_ISSUE_CODES = Object.freeze({
  APPROVAL_AMBIGUOUS: "PRODUCTION_AUTHORING_APPROVAL_AMBIGUOUS",
  APPROVAL_NOT_CLOSED: "PRODUCTION_AUTHORING_APPROVAL_NOT_CLOSED",
  ARGUMENT_INVALID: "PRODUCTION_AUTHORING_ARGUMENT_INVALID",
  DEPTH_FORBIDDEN: "PRODUCTION_AUTHORING_DEPTH_FORBIDDEN",
  EVIDENCE_INVALID: "PRODUCTION_AUTHORING_EVIDENCE_INVALID",
  NETWORK_DISABLED: "PRODUCTION_AUTHORING_NETWORK_DISABLED",
  NORMALIZED_OUTPUT_INVALID: "PRODUCTION_AUTHORING_NORMALIZED_OUTPUT_INVALID",
  OUTPUT_UNSAFE: "PRODUCTION_AUTHORING_OUTPUT_UNSAFE",
  PUBLICATION_FAILED: "PRODUCTION_AUTHORING_PUBLICATION_FAILED",
  PUBLIC_ASSET_FORBIDDEN: "PRODUCTION_AUTHORING_PUBLIC_ASSET_FORBIDDEN",
  RELEASE_NOT_FALLBACK: "PRODUCTION_AUTHORING_RELEASE_NOT_FALLBACK",
});

export const PRODUCTION_AUTHORING_STATIC_REASON_CODES = Object.freeze({
  EVIDENCE_APPROVAL_NOT_CLOSED: "AUTHORING_STATIC_EVIDENCE_APPROVAL_NOT_CLOSED",
  FIDELITY_APPROVAL_MISSING: "AUTHORING_STATIC_FIDELITY_APPROVAL_MISSING",
  RELEASE_APPROVAL_NOT_CLOSED: AUTHORING_STATIC_REASON_CODES.RELEASE_APPROVAL_NOT_CLOSED,
});

export class ProductionAuthoringError extends Error {
  constructor(
    issueCode,
    message,
    path = "$",
    code = LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
  ) {
    super(message);
    this.code = code;
    this.failure = Object.freeze({ code, issueCode, message, ok: false, path });
    this.issueCode = issueCode;
    this.name = "ProductionAuthoringError";
    this.path = path;
  }

  toJSON() {
    return this.failure;
  }
}

function fail(
  issueCode,
  message,
  path = "$",
  code = LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
) {
  throw new ProductionAuthoringError(issueCode, message, path, code);
}

function deepFreeze(value) {
  if (
    value === null
    || typeof value !== "object"
    || Object.isFrozen(value)
    || ArrayBuffer.isView(value)
  ) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(lexicalCompare);
}

function setEqual(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function isMissing(error) {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT";
}

function isContainedAbsolutePath(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !fromRoot.startsWith("/")
  );
}

function normalizedReviewPath(projectRoot) {
  return resolveSafeProjectPath(CANONICAL_PROJECT_PATHS.successorReviewDirectory, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
    projectRoot,
  });
}

/** Run production preparation with browser-style network entry points disabled. */
export async function withProductionAuthoringNetworkDisabled(operation) {
  if (typeof operation !== "function") {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID,
      "Network-disabled production authoring operation must be a function",
      "$",
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
    );
  }
  const names = ["fetch", "WebSocket", "XMLHttpRequest"];
  const descriptors = new Map();
  const installed = [];
  const guard = function productionAuthoringNetworkGuard() {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.NETWORK_DISABLED,
      "Production authored-package preparation forbids network access",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  };

  try {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      if (descriptor !== undefined && descriptor.configurable === false) {
        fail(
          PRODUCTION_AUTHORING_ISSUE_CODES.NETWORK_DISABLED,
          `Cannot disable non-configurable network global ${name}`,
          name,
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        );
      }
      descriptors.set(name, descriptor);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: guard,
        writable: false,
      });
      installed.push(name);
    }
    return await operation();
  } finally {
    for (const name of installed.reverse()) {
      const descriptor = descriptors.get(name);
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
}

function approvalExpectationForReviewSet(reviewSet, indexIdentity, approvalId) {
  return deepFreeze({
    approvalId,
    artifactSha256: uniqueSorted([
      indexIdentity.sha256,
      ...reviewSet.inputFiles.map(({ sha256: digest }) => digest),
      ...reviewSet.evidenceSha256,
      ...reviewSet.projectionSha256,
    ]),
    layerIds: [...reviewSet.layerIds],
    reviewedPoseIds: [...reviewSet.poseIds],
    reviewedZoomPercent: [...reviewSet.zoomPercent],
    scope: reviewSet.scope,
  });
}

export function createEvidenceApprovalExpectation({
  approvalId,
  evidenceIndex,
  evidenceIndexIdentity,
  evidenceSetId,
} = {}) {
  const index = validateLayerReviewEvidenceIndex(evidenceIndex);
  const reviewSet = index.reviewSets.find(({ id }) => id === evidenceSetId);
  if (reviewSet === undefined) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
      `Required evidence set ${String(evidenceSetId)} is absent`,
      "$.evidenceSetId",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  if (
    evidenceIndexIdentity?.path !== LAYER_REVIEW_EVIDENCE_INDEX_PATH
    || evidenceIndexIdentity.sha256 === undefined
  ) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
      "Evidence index identity must identify the canonical layer-evidence index",
      "$.evidenceIndexIdentity",
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  return approvalExpectationForReviewSet(
    reviewSet,
    evidenceIndexIdentity,
    approvalId,
  );
}

function exactApprovalForSet({
  allowedApprovalIds,
  approvalById,
  index,
  indexIdentity,
  reviewSetId,
}) {
  const reviewSet = index.reviewSets.find(({ id }) => id === reviewSetId);
  if (reviewSet === undefined) {
    return Object.freeze({
      ok: false,
      reason: PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
      reviewSet: null,
    });
  }
  const candidates = uniqueSorted(allowedApprovalIds)
    .map((id) => approvalById.get(id))
    .filter((record) => record !== undefined && record.scope === reviewSet.scope)
    .map((record) => ({
      expectation: approvalExpectationForReviewSet(reviewSet, indexIdentity, record.id),
      record,
    }));
  const passing = candidates.filter(({ expectation, record }) => (
    evaluateApprovalClosure(record, expectation).ok
  ));
  if (passing.length !== 1) {
    return Object.freeze({
      ok: false,
      reason: passing.length > 1
        ? PRODUCTION_AUTHORING_ISSUE_CODES.APPROVAL_AMBIGUOUS
        : PRODUCTION_AUTHORING_ISSUE_CODES.APPROVAL_NOT_CLOSED,
      reviewSet,
    });
  }
  return Object.freeze({
    expectation: passing[0].expectation,
    ok: true,
    record: passing[0].record,
    reviewSet,
  });
}

function replaceDecision(decisions, layerId, reason) {
  const prior = decisions.find(({ id }) => id === layerId);
  const next = {
    authoredDisposition: prior?.authoredDisposition ?? "approved-moving",
    effectiveDisposition: "static",
    id: layerId,
    primaryReason: reason,
    reasonCodes: uniqueSorted([...(prior?.reasonCodes ?? []), reason]),
  };
  return [
    ...decisions.filter(({ id }) => id !== layerId),
    next,
  ].sort((left, right) => lexicalCompare(left.id, right.id));
}

function closeLayerReviewScopes(layer, loaderResult, approvalById, index, indexIdentity) {
  const bindings = [];
  const requireSet = (reviewSetId, approvalIds) => {
    const result = exactApprovalForSet({
      allowedApprovalIds: approvalIds,
      approvalById,
      index,
      indexIdentity,
      reviewSetId,
    });
    if (!result.ok) return false;
    bindings.push(result);
    return true;
  };

  if (!requireSet(`${layer.id}-segmentation`, layer.approvalIds)) {
    return Object.freeze({ bindings: [], ok: false });
  }
  if (!requireSet(`${layer.id}-fidelity`, layer.approvalIds)) {
    return Object.freeze({ bindings: [], ok: false });
  }
  if (layer.disposition !== "approved-moving") {
    return Object.freeze({ bindings, ok: true });
  }
  if (layer.pivot === undefined || !requireSet(`${layer.id}-pivot`, layer.approvalIds)) {
    return Object.freeze({ bindings: [], ok: false });
  }

  const reconstructions = loaderResult.normalized.reconstructions.filter((record) => (
    layer.approvalIds.includes(record.approvalId)
  ));
  if (
    reconstructions.length === 0
    || !requireSet(
      `${layer.id}-reconstruction`,
      reconstructions.map(({ approvalId }) => approvalId),
    )
  ) {
    return Object.freeze({ bindings: [], ok: false });
  }

  const motion = loaderResult.normalized.motionProfiles.find((profile) => (
    profile.id === layer.motionProfileId && profile.layerId === layer.id
  ));
  if (
    motion === undefined
    || !requireSet(`${layer.id}-${motion.id}-motion`, [motion.approvalId])
  ) {
    return Object.freeze({ bindings: [], ok: false });
  }
  return Object.freeze({ bindings, ok: true });
}

function exactReleaseApproval(preliminary, approvalById) {
  if (preliminary.length === 0) return Object.freeze({ ok: true, record: null });
  const layerIds = preliminary.map(({ layer }) => layer.id).sort(lexicalCompare);
  const artifactSha256 = uniqueSorted(preliminary.flatMap(({ closure }) => (
    closure.bindings.flatMap(({ record }) => record.artifactSha256)
  )));
  const reviewedPoseIds = uniqueSorted(preliminary.flatMap(({ closure }) => (
    closure.bindings.flatMap(({ reviewSet }) => reviewSet.poseIds)
  )));
  const candidates = [...approvalById.values()].filter((record) => (
    record.scope === "release" && setEqual(record.layerIds, layerIds)
  ));
  const passing = candidates.filter((record) => evaluateApprovalClosure(record, {
    approvalId: record.id,
    artifactSha256,
    layerIds,
    reviewedPoseIds,
    reviewedZoomPercent: [],
    scope: "release",
  }).ok);
  if (passing.length !== 1) {
    return Object.freeze({
      ok: false,
      reason: passing.length > 1
        ? PRODUCTION_AUTHORING_ISSUE_CODES.APPROVAL_AMBIGUOUS
        : PRODUCTION_AUTHORING_ISSUE_CODES.APPROVAL_NOT_CLOSED,
      record: null,
    });
  }
  return Object.freeze({ ok: true, record: passing[0] });
}

/**
 * Filter loader output through the exact current layer-evidence index. Generic,
 * stale, pending, rejected, or partially bound records cannot survive this step.
 */
export function normalizeEvidenceApprovedAuthoring({
  evidence,
  loaderResult,
} = {}) {
  if (!loaderResult || !evidence) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID,
      "Normalization requires loader output and rendered evidence",
      "$",
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
    );
  }
  const index = validateLayerReviewEvidenceIndex(evidence.index);
  if (
    index.authoring.path !== loaderResult.authoringIdentity.path
    || index.authoring.sha256 !== loaderResult.authoringIdentity.sha256
    || index.authoring.byteLength !== loaderResult.authoringIdentity.byteLength
    || index.canonicalMaster.sha256 !== APPROVED_MASTER_IDENTITY.sha256
  ) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
      "Layer evidence does not bind the exact current authoring document and canonical master",
      LAYER_REVIEW_EVIDENCE_INDEX_PATH,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }

  const approvals = loaderResult.reviewInputs.approvals;
  const approvalById = new Map(approvals.map((record) => [record.id, record]));
  const acceptedStatic = [];
  const preliminaryMoving = [];
  const usedApprovalById = new Map();
  let decisions = [...loaderResult.candidateDecisions];

  for (const layer of loaderResult.normalized.layers) {
    const closure = closeLayerReviewScopes(
      layer,
      loaderResult,
      approvalById,
      index,
      evidence.indexIdentity,
    );
    if (!closure.ok) {
      decisions = replaceDecision(
        decisions,
        layer.id,
        PRODUCTION_AUTHORING_STATIC_REASON_CODES.EVIDENCE_APPROVAL_NOT_CLOSED,
      );
      continue;
    }
    if (layer.disposition === "approved-moving") preliminaryMoving.push({ closure, layer });
    else acceptedStatic.push({ closure, layer });
  }

  const release = exactReleaseApproval(preliminaryMoving, approvalById);
  const acceptedMoving = release.ok ? preliminaryMoving : [];
  if (!release.ok) {
    for (const { layer } of preliminaryMoving) {
      decisions = replaceDecision(
        decisions,
        layer.id,
        PRODUCTION_AUTHORING_STATIC_REASON_CODES.RELEASE_APPROVAL_NOT_CLOSED,
      );
    }
  }

  for (const { closure } of [...acceptedStatic, ...acceptedMoving]) {
    for (const { record } of closure.bindings) usedApprovalById.set(record.id, record);
  }
  if (release.record !== null) usedApprovalById.set(release.record.id, release.record);

  const acceptedLayers = [...acceptedStatic, ...acceptedMoving]
    .map(({ layer }) => layer)
    .sort((left, right) => left.zOrder - right.zOrder || lexicalCompare(left.id, right.id));
  const acceptedLayerIds = new Set(acceptedLayers.map(({ id }) => id));
  const movingLayerIds = new Set(acceptedMoving.map(({ layer }) => layer.id));
  const normalizedReconstructions = loaderResult.normalized.reconstructions.filter((record) => (
    acceptedLayers.some((layer) => layer.approvalIds.includes(record.approvalId))
  ));
  const normalizedMotionProfiles = loaderResult.normalized.motionProfiles.filter(({ layerId }) => (
    movingLayerIds.has(layerId)
  ));
  const normalizedRelationships = loaderResult.normalized.relationships.filter((record) => (
    movingLayerIds.has(record.driverLayerId) && movingLayerIds.has(record.drivenLayerId)
  ));
  for (const relationship of normalizedRelationships) {
    const record = approvalById.get(relationship.approvalId);
    if (record !== undefined) usedApprovalById.set(record.id, record);
  }
  const neededMaskIds = new Set(acceptedLayers.map(({ segmentationMaskId }) => segmentationMaskId));
  for (const reconstruction of normalizedReconstructions) {
    neededMaskIds.add(reconstruction.regionMaskId);
    neededMaskIds.add(reconstruction.boundaryMaskId);
  }
  const normalizedMasks = loaderResult.normalized.masks.filter(({ id }) => neededMaskIds.has(id));
  const neededArtifactIds = new Set([
    ...acceptedLayers.map(({ id }) => id),
    ...normalizedMasks.map(({ id }) => id),
    ...normalizedReconstructions.map(({ fillId }) => fillId),
    ...normalizedMotionProfiles.map(({ id }) => id),
    ...normalizedRelationships.map(({ id }) => id),
  ]);
  const normalizedProvenance = loaderResult.normalized.provenance.filter(({ artifactId }) => (
    neededArtifactIds.has(artifactId)
  ));
  const normalizedMaskInputs = loaderResult.normalized.maskInputs.filter(({ record }) => (
    neededMaskIds.has(record.id)
  ));
  const reconstructionIds = new Set(normalizedReconstructions.map(({ id }) => id));
  const normalizedFillInputs = loaderResult.normalized.fillInputs.filter(({ record }) => (
    reconstructionIds.has(record.id)
  ));
  const approvedMovingLayerIds = [...movingLayerIds].sort(lexicalCompare);
  const excludedLayerIds = loaderResult.sourceDocument.layers
    .map(({ id }) => id)
    .filter((id) => !acceptedLayerIds.has(id))
    .sort(lexicalCompare);
  const staticLayerIds = uniqueSorted([
    ...decisions
      .filter(({ effectiveDisposition }) => effectiveDisposition === "static")
      .map(({ id }) => id),
    ...acceptedStatic.map(({ layer }) => layer.id),
  ]);

  return deepFreeze({
    approvedMovingLayerIds,
    artifactIssues: loaderResult.artifactIssues,
    authoringIdentity: loaderResult.authoringIdentity,
    candidateDecisions: decisions,
    excludedLayerIds,
    inputSnapshot: loaderResult.inputSnapshot,
    mode: approvedMovingLayerIds.length === 0 ? "reference-pose" : "approved-moving",
    normalized: {
      approvals: [...usedApprovalById.values()].sort((left, right) => lexicalCompare(left.id, right.id)),
      fillInputs: normalizedFillInputs,
      layers: acceptedLayers,
      maskInputs: normalizedMaskInputs,
      masks: normalizedMasks,
      motionProfiles: normalizedMotionProfiles,
      provenance: normalizedProvenance,
      reconstructions: normalizedReconstructions,
      relationships: normalizedRelationships,
    },
    reviewInputs: loaderResult.reviewInputs,
    schemaVersion: 1,
    sourceDocument: loaderResult.sourceDocument,
    staticLayerIds,
  });
}

function normalizedDocument(result, evidence) {
  const document = canonicalizeJson({
    approvedMovingLayerIds: result.approvedMovingLayerIds,
    artifactIssues: result.artifactIssues,
    authoring: result.authoringIdentity,
    candidateDecisions: result.candidateDecisions,
    depthEnabled: false,
    evidenceIndex: evidence.indexIdentity,
    excludedLayerIds: result.excludedLayerIds,
    fileInputs: {
      fills: result.normalized.fillInputs.map(({ identity, record }) => ({
        artifactId: record.fillId,
        ...identity,
      })),
      masks: result.normalized.maskInputs.map(({ identity, record }) => ({
        artifactId: record.id,
        ...identity,
      })),
    },
    mode: result.mode,
    packageInputs: {
      approvals: result.normalized.approvals,
      layers: result.normalized.layers,
      masks: result.normalized.masks,
      motionProfiles: result.normalized.motionProfiles,
      provenance: result.normalized.provenance,
      reconstructions: result.normalized.reconstructions,
      relationships: result.normalized.relationships,
    },
    phases: result.sourceDocument.phases,
    publicAssets: [],
    releaseStatus: "fallback-only",
    runtimeManifest: null,
    schemaVersion: 1,
    staticLayerIds: result.staticLayerIds,
  });
  return Object.freeze({
    bytes: serializeCanonicalJsonLine(document),
    document,
  });
}

async function assertFallbackRelease(projectRoot) {
  const release = await inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.successorRelease, {
    allowPublic: false,
    expectedPath: CANONICAL_PROJECT_PATHS.successorRelease,
    projectRoot,
  });
  const value = RELEASE_POINTER_SCHEMA.parseJson(release.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  });
  if (
    value.status !== "fallback-only"
    || value.runtimeManifest !== null
    || value.depthEnabled !== false
  ) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.RELEASE_NOT_FALLBACK,
      "Task 5.4 requires the compiled release to remain fallback-only and URL-free",
      CANONICAL_PROJECT_PATHS.successorRelease,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  return release.identity;
}

async function collectRegularMembers(absoluteRoot, relativeRoot = "") {
  let entries;
  try {
    entries = await readdir(absoluteRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
      "Generated package directory cannot be read safely",
      relativeRoot || "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const files = [];
  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    const childRelative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    const childAbsolute = resolve(absoluteRoot, entry.name);
    if (entry.isSymbolicLink()) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
        "Generated package directories may not contain symbolic links",
        childRelative,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    if (entry.isDirectory()) {
      files.push(...await collectRegularMembers(childAbsolute, childRelative));
    } else if (entry.isFile()) files.push(childRelative);
    else {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
        "Generated package members must be regular files",
        childRelative,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  return files.sort(lexicalCompare);
}

async function assertNoSuccessorPublicAssets(projectRoot) {
  const publicRoot = resolveSafeProjectPath(CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory, {
    allowPublic: true,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory],
    projectRoot,
  });
  let stats;
  try {
    stats = await lstat(publicRoot);
  } catch (error) {
    if (isMissing(error)) return;
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.PUBLIC_ASSET_FORBIDDEN,
      "Successor public asset directory cannot be inspected",
      CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.PUBLIC_ASSET_FORBIDDEN,
      "Successor public asset path must not be a file or symbolic link",
      CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const files = await collectRegularMembers(publicRoot);
  if (files.length !== 0) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.PUBLIC_ASSET_FORBIDDEN,
      "Task 5.4 cannot publish a successor public or runtime asset",
      `${CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/${files[0]}`,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
}

function expectedEvidenceMap(outputs) {
  const expected = new Map();
  for (const output of outputs) {
    if (!isLayerReviewEvidencePath(output.path) || !Buffer.isBuffer(output.bytes)) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
        "Layer evidence renderer returned an unsafe path or non-buffer bytes",
        String(output.path),
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    const prefix = `${LAYER_REVIEW_EVIDENCE_DIRECTORY}/`;
    if (!output.path.startsWith(prefix)) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
        "Layer evidence output is outside its canonical package",
        output.path,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    const relativePath = output.path.slice(prefix.length);
    if (expected.has(relativePath)) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
        "Layer evidence renderer returned a duplicate path",
        output.path,
      );
    }
    expected.set(relativePath, output.bytes);
  }
  if (!expected.has("index.json")) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.EVIDENCE_INVALID,
      "Layer evidence renderer omitted the canonical index",
      LAYER_REVIEW_EVIDENCE_INDEX_PATH,
    );
  }
  return expected;
}

async function directoryMatches(absoluteDirectory, expected) {
  let stats;
  try {
    stats = await lstat(absoluteDirectory);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
      "Existing layer evidence must be a regular non-symlink directory",
      LAYER_REVIEW_EVIDENCE_DIRECTORY,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const actualPaths = await collectRegularMembers(absoluteDirectory);
  const expectedPaths = [...expected.keys()].sort(lexicalCompare);
  if (
    actualPaths.length !== expectedPaths.length
    || actualPaths.some((value, index) => value !== expectedPaths[index])
  ) return false;
  for (const path of expectedPaths) {
    const actual = await readFile(resolve(absoluteDirectory, path));
    if (!actual.equals(expected.get(path))) return false;
  }
  return true;
}

async function writeStagedEvidence(absoluteDirectory, expected) {
  await mkdir(absoluteDirectory, { mode: 0o755 });
  for (const path of [...expected.keys()].sort(lexicalCompare)) {
    const target = resolve(absoluteDirectory, path);
    if (!isContainedAbsolutePath(absoluteDirectory, target)) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
        "Staged evidence path escapes its isolated directory",
        path,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    await mkdir(dirname(target), { mode: 0o755, recursive: true });
    const handle = await open(target, "wx", 0o644);
    try {
      await handle.writeFile(expected.get(path));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  if (!await directoryMatches(absoluteDirectory, expected)) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.PUBLICATION_FAILED,
      "Staged layer evidence differs from generated bytes",
      LAYER_REVIEW_EVIDENCE_DIRECTORY,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
}

async function regularFileMatches(path, bytes) {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
        "Normalized output must be a regular non-symlink file",
        NORMALIZED_WATCH_LAYER_INPUTS_PATH,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    return (await readFile(path)).equals(bytes);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function ensureReviewDirectory(projectRoot) {
  const root = resolve(projectRoot);
  let current = root;
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
      "Project root must be a regular non-symlink directory",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  for (const segment of CANONICAL_PROJECT_PATHS.successorReviewDirectory.split("/")) {
    current = resolve(current, segment);
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
        "Review output parent must be a regular non-symlink directory",
        CANONICAL_PROJECT_PATHS.successorReviewDirectory,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  if (current !== normalizedReviewPath(root)) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
      "Review output parent differs from its canonical path",
      CANONICAL_PROJECT_PATHS.successorReviewDirectory,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return current;
}

function immutableInputPaths(loaderResult) {
  return uniqueSorted([
    CANONICAL_PROJECT_PATHS.canonicalMaster,
    CANONICAL_PROJECT_PATHS.dependencyManifest,
    CANONICAL_PROJECT_PATHS.predecessorManifest,
    CANONICAL_PROJECT_PATHS.successorRelease,
    ...loaderResult.inputSnapshot.files
      .map(({ path }) => path)
      .filter((path) => (
        path !== NORMALIZED_WATCH_LAYER_INPUTS_PATH
        && path !== LAYER_REVIEW_EVIDENCE_DIRECTORY
        && !path.startsWith(`${LAYER_REVIEW_EVIDENCE_DIRECTORY}/`)
      )),
  ]);
}

async function writeExclusive(path, bytes) {
  const handle = await open(path, "wx", 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Regenerate canonical authored-layer evidence, re-evaluate exact reviewer
 * decisions, and publish only non-public normalized inputs. The release pointer
 * and every public/runtime path remain untouched.
 */
export async function prepareWatchLayerAuthoring({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID,
      "projectRoot must be a nonempty path",
      "$.projectRoot",
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
    );
  }
  const root = resolve(projectRoot);
  return withProductionAuthoringNetworkDisabled(async () => {
    await Promise.all([
      assertApprovedMasterIdentity({ projectRoot: root }),
      assertPredecessorManifestIdentity({ projectRoot: root }),
      inspectApprovedDependencyFields({ projectRoot: root }),
      assertFallbackRelease(root),
      assertNoSuccessorPublicAssets(root),
    ]);

    const initial = await loadWatchLayerAuthoring({ projectRoot: root });
    if (
      initial.sourceDocument.depthEnabled !== false
      || initial.sourceDocument.depthProfiles.some(({ enabled }) => enabled)
    ) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.DEPTH_FORBIDDEN,
        "Task 5.4 cannot enable optional depth",
        "$.depthEnabled",
        LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
      );
    }
    const immutableSnapshot = await createInputHashSnapshot(
      immutableInputPaths(initial),
      { allowPublic: false, projectRoot: root },
    );
    const master = await inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.canonicalMaster, {
      allowPublic: false,
      expectedPath: CANONICAL_PROJECT_PATHS.canonicalMaster,
      projectRoot: root,
    });
    const rendered = await renderLayerReviewEvidence({
      authoringIdentity: initial.authoringIdentity,
      depthProfiles: initial.reviewInputs.depthProfiles,
      layers: initial.reviewInputs.layers,
      masks: initial.reviewInputs.masks,
      motionProfiles: initial.reviewInputs.motionProfiles,
      reconstructions: initial.reviewInputs.reconstructions,
      sourceBytes: master.bytes,
      sourceHeight: APPROVED_MASTER_IDENTITY.intrinsicHeight,
      sourceIdentity: master.identity,
      sourceWidth: APPROVED_MASTER_IDENTITY.intrinsicWidth,
    });
    await assertInputHashSnapshotUnchanged(immutableSnapshot, {
      allowPublic: false,
      projectRoot: root,
    });

    const reviewDirectory = await ensureReviewDirectory(root);
    const evidenceDirectory = resolveSafeProjectPath(LAYER_REVIEW_EVIDENCE_DIRECTORY, {
      allowPublic: false,
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
      projectRoot: root,
    });
    const normalizedPath = resolveSafeProjectPath(NORMALIZED_WATCH_LAYER_INPUTS_PATH, {
      allowPublic: false,
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
      projectRoot: root,
    });
    const expectedEvidence = expectedEvidenceMap(rendered.outputs);
    const workDirectory = await mkdtemp(resolve(reviewDirectory, ".production-authoring-work-"));
    const stagedEvidence = resolve(workDirectory, "layer-evidence");
    const previousEvidence = resolve(workDirectory, "previous-layer-evidence");
    const stagedNormalized = resolve(workDirectory, NORMALIZED_INPUTS_FILENAME);
    const previousNormalized = resolve(workDirectory, `previous-${NORMALIZED_INPUTS_FILENAME}`);
    let evidenceChanged = false;
    let normalizedChanged = false;
    let evidenceBackedUp = false;
    let normalizedBackedUp = false;
    let evidencePublished = false;
    let normalizedPublished = false;

    try {
      await writeStagedEvidence(stagedEvidence, expectedEvidence);
      if (!await directoryMatches(evidenceDirectory, expectedEvidence)) {
        try {
          const stats = await lstat(evidenceDirectory);
          if (!stats.isDirectory() || stats.isSymbolicLink()) {
            fail(
              PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
              "Existing layer evidence must be a regular directory",
              LAYER_REVIEW_EVIDENCE_DIRECTORY,
              LAYER_GATE_FAILURE_CODES.PATH_INVALID,
            );
          }
          await rename(evidenceDirectory, previousEvidence);
          evidenceBackedUp = true;
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await rename(stagedEvidence, evidenceDirectory);
        evidencePublished = true;
        evidenceChanged = true;
      }
      if (!await directoryMatches(evidenceDirectory, expectedEvidence)) {
        fail(
          PRODUCTION_AUTHORING_ISSUE_CODES.PUBLICATION_FAILED,
          "Published layer evidence differs from generated bytes",
          LAYER_REVIEW_EVIDENCE_DIRECTORY,
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }

      const loaded = await loadWatchLayerAuthoring({ projectRoot: root });
      const normalized = normalizeEvidenceApprovedAuthoring({ evidence: rendered, loaderResult: loaded });
      const output = normalizedDocument(normalized, rendered);
      await writeExclusive(stagedNormalized, output.bytes);
      if (!await regularFileMatches(normalizedPath, output.bytes)) {
        try {
          const stats = await lstat(normalizedPath);
          if (!stats.isFile() || stats.isSymbolicLink()) {
            fail(
              PRODUCTION_AUTHORING_ISSUE_CODES.OUTPUT_UNSAFE,
              "Existing normalized inputs must be a regular file",
              NORMALIZED_WATCH_LAYER_INPUTS_PATH,
              LAYER_GATE_FAILURE_CODES.PATH_INVALID,
            );
          }
          await rename(normalizedPath, previousNormalized);
          normalizedBackedUp = true;
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await rename(stagedNormalized, normalizedPath);
        normalizedPublished = true;
        normalizedChanged = true;
      }
      if (!await regularFileMatches(normalizedPath, output.bytes)) {
        fail(
          PRODUCTION_AUTHORING_ISSUE_CODES.PUBLICATION_FAILED,
          "Published normalized inputs differ from canonical bytes",
          NORMALIZED_WATCH_LAYER_INPUTS_PATH,
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }

      await assertInputHashSnapshotUnchanged(immutableSnapshot, {
        allowPublic: false,
        projectRoot: root,
      });
      await Promise.all([
        assertFallbackRelease(root),
        assertNoSuccessorPublicAssets(root),
      ]);
      if (evidenceBackedUp) await rm(previousEvidence, { force: true, recursive: true });
      if (normalizedBackedUp) await rm(previousNormalized, { force: true });
      return deepFreeze({
        approvedMovingLayerIds: normalized.approvedMovingLayerIds,
        candidateDecisions: normalized.candidateDecisions,
        changed: evidenceChanged || normalizedChanged,
        evidenceChanged,
        evidenceIndexIdentity: rendered.indexIdentity,
        evidenceIndexPath: LAYER_REVIEW_EVIDENCE_INDEX_PATH,
        mode: normalized.mode,
        normalized: normalized.normalized,
        normalizedChanged,
        normalizedDocument: output.document,
        normalizedIdentity: {
          byteLength: output.bytes.byteLength,
          path: NORMALIZED_WATCH_LAYER_INPUTS_PATH,
          sha256: sha256(output.bytes),
        },
        normalizedPath: NORMALIZED_WATCH_LAYER_INPUTS_PATH,
        staticLayerIds: normalized.staticLayerIds,
      });
    } catch (error) {
      if (normalizedPublished) await rm(normalizedPath, { force: true });
      if (normalizedBackedUp) await rename(previousNormalized, normalizedPath);
      if (evidencePublished) await rm(evidenceDirectory, { force: true, recursive: true });
      if (evidenceBackedUp) await rename(previousEvidence, evidenceDirectory);
      throw error;
    } finally {
      await rm(workDirectory, { force: true, recursive: true });
    }
  });
}

export const wireProductionWatchLayerAuthoring = prepareWatchLayerAuthoring;

export function parseProductionAuthoringArguments(argv) {
  if (!Array.isArray(argv)) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID,
      "CLI arguments must be an array",
      "$",
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      if (parsed.help) {
        fail(PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID, "--help may appear only once");
      }
      parsed.help = true;
      continue;
    }
    if (flag !== "--project-root" || parsed.projectRoot !== undefined) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID,
        `Unknown or repeated argument ${String(flag)}`,
        String(flag),
        LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      );
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      fail(
        PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID,
        "--project-root requires one path value",
        flag,
        LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      );
    }
    parsed.projectRoot = value;
    index += 1;
  }
  if (parsed.help && parsed.projectRoot !== undefined) {
    fail(
      PRODUCTION_AUTHORING_ISSUE_CODES.ARGUMENT_INVALID,
      "--help cannot be combined with --project-root",
      "--help",
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
    );
  }
  return Object.freeze(parsed);
}

const USAGE = `Usage:\n  node scripts/prepare-watch-layer-authoring.mjs [--project-root <path>]\n\nRegenerates non-public hash-bound layer evidence and normalized authored inputs.\nIt never creates masks, fills, approvals, public assets, runtime assets, or a ready release.`;

function formatFailure(error) {
  if (error && typeof error === "object" && "code" in error) {
    const issue = "issueCode" in error ? `/${String(error.issueCode)}` : "";
    const message = "message" in error ? String(error.message) : "Production authoring failed";
    return `${String(error.code)}${issue}: ${message}`;
  }
  return `${LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function runProductionAuthoringCli(argv = process.argv.slice(2)) {
  const parsed = parseProductionAuthoringArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return null;
  }
  const result = await prepareWatchLayerAuthoring({
    projectRoot: parsed.projectRoot ?? DEFAULT_PROJECT_ROOT,
  });
  console.log(
    `WATCH_LAYER_AUTHORING_READY ${result.mode} ${result.approvedMovingLayerIds.length} moving ${result.evidenceIndexPath} ${result.evidenceIndexIdentity.sha256} ${result.normalizedPath} ${result.normalizedIdentity.sha256}`,
  );
  return result;
}

async function main() {
  try {
    await runProductionAuthoringCli();
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  await main();
}
