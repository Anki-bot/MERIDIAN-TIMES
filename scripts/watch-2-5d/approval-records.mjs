import {
  APPROVAL_RECORD_SCHEMA,
  APPROVAL_SCOPES,
  DEFAULT_PROJECT_ROOT,
  LAYER_GATE_FAILURE_CODES,
  PROVENANCE_RECORD_SCHEMA,
  assertInputHashSnapshotUnchanged,
  assertSafeProjectRelativePath,
  createInputHashSnapshot,
} from "./contract.mjs";

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export const APPROVAL_TOOL_ISSUE_CODES = Object.freeze({
  APPROVAL_ABSENT: "APPROVAL_ABSENT",
  APPROVAL_DECISION_PENDING: "APPROVAL_DECISION_PENDING",
  APPROVAL_DECISION_REJECTED: "APPROVAL_DECISION_REJECTED",
  APPROVAL_HASH_MISMATCH: "APPROVAL_HASH_MISMATCH",
  APPROVAL_ID_MISMATCH: "APPROVAL_ID_MISMATCH",
  APPROVAL_INPUT_INVALID: "APPROVAL_INPUT_INVALID",
  APPROVAL_LAYER_MISMATCH: "APPROVAL_LAYER_MISMATCH",
  APPROVAL_NOT_APPROVED: "APPROVAL_NOT_APPROVED",
  APPROVAL_POSE_MISMATCH: "APPROVAL_POSE_MISMATCH",
  APPROVAL_RECORD_INVALID: "APPROVAL_RECORD_INVALID",
  APPROVAL_SCOPE_MISMATCH: "APPROVAL_SCOPE_MISMATCH",
  APPROVAL_ZOOM_MISMATCH: "APPROVAL_ZOOM_MISMATCH",
  PROVENANCE_ARTIFACT_MISMATCH: "PROVENANCE_ARTIFACT_MISMATCH",
  PROVENANCE_PARENT_MISMATCH: "PROVENANCE_PARENT_MISMATCH",
  PROVENANCE_RECORD_INVALID: "PROVENANCE_RECORD_INVALID",
  TEMPLATE_DECISION_FORBIDDEN: "APPROVAL_TEMPLATE_DECISION_FORBIDDEN",
});

/**
 * Minimum visual evidence required by the approved design. Callers may require
 * additional zooms or poses for a particular artifact set, but may not weaken
 * these scope defaults.
 */
export const APPROVAL_SCOPE_REQUIREMENTS = deepFreeze({
  depth: {
    allowEmptyLayerIds: false,
    requiredZoomPercent: [100, 200],
  },
  fidelity: {
    allowEmptyLayerIds: true,
    requiredZoomPercent: [100, 200],
  },
  motion: {
    allowEmptyLayerIds: false,
    requiredZoomPercent: [100, 200],
  },
  pivot: {
    allowEmptyLayerIds: false,
    requiredZoomPercent: [200],
  },
  reconstruction: {
    allowEmptyLayerIds: false,
    requiredZoomPercent: [100, 200],
  },
  release: {
    allowEmptyLayerIds: true,
    requiredZoomPercent: [],
  },
  segmentation: {
    allowEmptyLayerIds: false,
    requiredZoomPercent: [200],
  },
});

export class ApprovalRecordToolError extends TypeError {
  constructor(issueCode, message, path = "$") {
    super(message);
    this.code = LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID;
    this.issueCode = issueCode;
    this.name = "ApprovalRecordToolError";
    this.path = path;
    this.failure = Object.freeze({
      code: this.code,
      issueCode,
      message,
      ok: false,
      path,
    });
  }

  toJSON() {
    return this.failure;
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(issueCode, message, path = "$") {
  throw new ApprovalRecordToolError(issueCode, message, path);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function arraysEqual(left, right) {
  return left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function selectAliasedValue(value, primary, alias, fallback) {
  const hasPrimary = hasOwn(value, primary);
  const hasAlias = hasOwn(value, alias);
  if (hasPrimary && hasAlias) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      `${primary} and ${alias} are aliases and cannot both be supplied`,
      `$.${primary}`,
    );
  }
  if (hasPrimary) return value[primary];
  if (hasAlias) return value[alias];
  return fallback;
}

function normalizeStringSet(value, path, {
  allowEmpty = true,
  pattern = null,
} = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      allowEmpty ? "Value must be an array" : "Value must be a nonempty array",
      path,
    );
  }

  const seen = new Set();
  const result = [];
  value.forEach((entry, index) => {
    if (
      typeof entry !== "string"
      || entry.length === 0
      || (pattern !== null && !pattern.test(entry))
    ) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Array entries must be valid nonempty strings",
        `${path}[${index}]`,
      );
    }
    if (seen.has(entry)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `Duplicate value ${JSON.stringify(entry)}`,
        `${path}[${index}]`,
      );
    }
    seen.add(entry);
    result.push(entry);
  });
  return result.sort();
}

function normalizeHashes(value, path = "$.artifactSha256", { allowEmpty = false } = {}) {
  return normalizeStringSet(value, path, {
    allowEmpty,
    pattern: SHA256_PATTERN,
  });
}

function normalizeIds(value, path, { allowEmpty = true } = {}) {
  return normalizeStringSet(value, path, {
    allowEmpty,
    pattern: STABLE_ID_PATTERN,
  });
}

function normalizeZooms(value, path = "$.reviewedZoomPercent") {
  if (!Array.isArray(value)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Review zooms must be an array",
      path,
    );
  }
  const seen = new Set();
  const result = [];
  value.forEach((zoom, index) => {
    if (zoom !== 100 && zoom !== 200) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Review zoom must be 100 or 200",
        `${path}[${index}]`,
      );
    }
    if (seen.has(zoom)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `Duplicate review zoom ${zoom}`,
        `${path}[${index}]`,
      );
    }
    seen.add(zoom);
    result.push(zoom);
  });
  return result.sort((left, right) => left - right);
}

function assertScope(value, path = "$.scope") {
  if (typeof value !== "string" || !APPROVAL_SCOPES.includes(value)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      `Unsupported approval scope: ${String(value)}`,
      path,
    );
  }
  return value;
}

function scopeRequirements(scope) {
  return APPROVAL_SCOPE_REQUIREMENTS[assertScope(scope)];
}

function normalizePathSet(value, path, projectRoot) {
  if (!Array.isArray(value)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval input paths must be an array",
      path,
    );
  }
  const normalized = value.map((entry, index) => {
    if (typeof entry !== "string") {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Approval input path must be a string",
        `${path}[${index}]`,
      );
    }
    return assertSafeProjectRelativePath(entry, {
      allowPublic: true,
      projectRoot,
    });
  });
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval input paths must be unique",
      path,
    );
  }
  return normalized.sort();
}

function assertDisjoint(left, right, leftName, rightName) {
  const rightSet = new Set(right);
  const duplicate = left.find((entry) => rightSet.has(entry));
  if (duplicate !== undefined) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      `${leftName} and ${rightName} must not assign two roles to ${duplicate}`,
      "$",
    );
  }
}

function hashesFrom(value) {
  if (isPlainObject(value.bindings)) {
    return value.bindings.artifactSha256;
  }
  return value.artifactSha256;
}

function posesFrom(value) {
  return selectAliasedValue(value, "reviewedPoseIds", "poseIds", undefined);
}

function layersFrom(value) {
  return selectAliasedValue(value, "layerIds", "layers", undefined);
}

function zoomsFrom(value) {
  return selectAliasedValue(value, "reviewedZoomPercent", "zoomPercent", undefined);
}

function exactExpectation(value) {
  if (!isPlainObject(value)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval expectation must be a plain object",
    );
  }
  const scope = assertScope(value.scope);
  const requirement = scopeRequirements(scope);
  const artifactSha256 = normalizeHashes(hashesFrom(value));
  const layerIds = normalizeIds(layersFrom(value), "$.layerIds", {
    allowEmpty: requirement.allowEmptyLayerIds,
  });
  const reviewedPoseIds = normalizeIds(posesFrom(value), "$.reviewedPoseIds", {
    allowEmpty: false,
  });
  const suppliedZooms = zoomsFrom(value);
  const reviewedZoomPercent = suppliedZooms === undefined
    ? [...requirement.requiredZoomPercent]
    : normalizeZooms(suppliedZooms);
  for (const requiredZoom of requirement.requiredZoomPercent) {
    if (!reviewedZoomPercent.includes(requiredZoom)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `${scope} review requires ${requiredZoom}% evidence`,
        "$.reviewedZoomPercent",
      );
    }
  }

  let approvalId;
  if (value.approvalId !== undefined || value.id !== undefined) {
    const selected = value.approvalId ?? value.id;
    approvalId = normalizeIds([selected], "$.approvalId", { allowEmpty: false })[0];
  }

  return deepFreeze({
    approvalId,
    artifactSha256,
    layerIds,
    reviewedPoseIds,
    reviewedZoomPercent,
    scope,
  });
}

/**
 * Build the exact approval expectation represented by one validated layer review
 * set. The index identity is itself evidence, while input, rendered-evidence,
 * and canonical projection hashes remain one indivisible reviewer binding.
 */
export function createReviewSetApprovalExpectation({
  approvalId,
  evidenceIndexSha256,
  reviewSet,
} = {}) {
  if (
    !isPlainObject(reviewSet)
    || !Array.isArray(reviewSet.inputFiles)
    || !Array.isArray(reviewSet.evidenceSha256)
    || !Array.isArray(reviewSet.projectionSha256)
  ) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Layer review set is incomplete",
      "$.reviewSet",
    );
  }
  const inputSha256 = reviewSet.inputFiles.map((identity, index) => {
    if (!isPlainObject(identity)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Layer review input identity must be an object",
        `$.reviewSet.inputFiles[${index}]`,
      );
    }
    return identity.sha256;
  });
  return exactExpectation({
    approvalId,
    artifactSha256: [...new Set([
      evidenceIndexSha256,
      ...inputSha256,
      ...reviewSet.evidenceSha256,
      ...reviewSet.projectionSha256,
    ])].sort(),
    layerIds: reviewSet.layerIds,
    reviewedPoseIds: reviewSet.poseIds,
    reviewedZoomPercent: reviewSet.zoomPercent,
    scope: reviewSet.scope,
  });
}

function validateScopeEvidence(record) {
  const requirement = scopeRequirements(record.scope);
  if (record.artifactSha256.length === 0) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval must bind at least one exact artifact or evidence hash",
      "$.artifactSha256",
    );
  }
  if (!requirement.allowEmptyLayerIds && record.layerIds.length === 0) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      `${record.scope} approval must identify at least one layer`,
      "$.layerIds",
    );
  }
  if (record.reviewedPoseIds.length === 0) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval must identify every reviewed pose, including the reference pose where applicable",
      "$.reviewedPoseIds",
    );
  }
  for (const requiredZoom of requirement.requiredZoomPercent) {
    if (!record.reviewedZoomPercent.includes(requiredZoom)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `${record.scope} approval requires ${requiredZoom}% evidence`,
        "$.reviewedZoomPercent",
      );
    }
  }
  if (record.notes.trim().length === 0) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval notes must be nonempty",
      "$.notes",
    );
  }
  return record;
}

/**
 * Hash all explicitly supplied local artifact and evidence files. The returned
 * approval hash set is the sorted union of both roles because ApprovalRecord
 * intentionally binds hashes rather than local paths.
 */
export async function computeApprovalInputHashes(options = {}) {
  if (!isPlainObject(options)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval hash options must be a plain object",
    );
  }
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const artifactPaths = normalizePathSet(
    selectAliasedValue(options, "artifacts", "artifactPaths", []),
    "$.artifacts",
    projectRoot,
  );
  const evidencePaths = normalizePathSet(
    selectAliasedValue(options, "evidence", "evidencePaths", []),
    "$.evidence",
    projectRoot,
  );
  assertDisjoint(artifactPaths, evidencePaths, "artifacts", "evidence");
  const allPaths = [...artifactPaths, ...evidencePaths].sort();
  if (allPaths.length === 0) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "At least one artifact or evidence file is required",
      "$",
    );
  }

  const inputSnapshot = await createInputHashSnapshot(allPaths, {
    allowPublic: true,
    projectRoot,
  });
  await assertInputHashSnapshotUnchanged(inputSnapshot, {
    allowPublic: true,
    projectRoot,
  });

  const identitiesByPath = new Map(
    inputSnapshot.files.map((identity) => [identity.path, identity]),
  );
  const artifactIdentities = artifactPaths.map((path) => identitiesByPath.get(path));
  const evidenceIdentities = evidencePaths.map((path) => identitiesByPath.get(path));
  const sourceArtifactSha256 = [
    ...new Set(artifactIdentities.map(({ sha256 }) => sha256)),
  ].sort();
  const evidenceSha256 = [
    ...new Set(evidenceIdentities.map(({ sha256 }) => sha256)),
  ].sort();
  const artifactSha256 = [
    ...new Set([...sourceArtifactSha256, ...evidenceSha256]),
  ].sort();

  return deepFreeze({
    artifactIdentities,
    artifactSha256,
    evidenceIdentities,
    evidenceSha256,
    inputSnapshot,
    sourceArtifactSha256,
  });
}

export const computeApprovalHashes = computeApprovalInputHashes;
export const hashApprovalInputs = computeApprovalInputHashes;

/** Create strict provenance metadata whose artifact and parent hashes come from current bytes. */
export async function createProvenanceRecordFromFiles(options = {}) {
  if (!isPlainObject(options)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Provenance options must be a plain object",
    );
  }
  const bindings = await computeApprovalInputHashes({
    artifacts: [options.artifactPath],
    evidence: options.immediateParentPaths,
    projectRoot: options.projectRoot ?? DEFAULT_PROJECT_ROOT,
  });
  const record = {
    artifactId: options.artifactId,
    artifactSha256: bindings.artifactIdentities[0].sha256,
    classification: options.classification,
    createdAt: options.createdAt,
    id: options.id,
    immediateParentSha256: bindings.evidenceSha256,
    method: options.method,
    operator: options.operator,
    settings: options.settings,
    tool: options.tool,
  };
  return PROVENANCE_RECORD_SCHEMA.parse(record);
}

export const createProvenanceRecord = createProvenanceRecordFromFiles;

/**
 * Validate a reviewer record structurally and enforce scope-specific evidence.
 * Pending records remain valid inputs, but only evaluateApprovalClosure can make
 * a record releasable, and it accepts only a separately supplied approved decision.
 */
export function validateReviewerApprovalRecord(value, expectations = undefined) {
  const record = validateScopeEvidence(APPROVAL_RECORD_SCHEMA.parse(value));
  if (record.decision !== "pending") {
    // The strict schema already enforces a non-null reviewer and exact UTC instant.
    if (record.reviewer.trim().length === 0) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Reviewed decisions require a nonempty reviewer",
        "$.reviewer",
      );
    }
  }

  if (expectations !== undefined) {
    const expected = exactExpectation(expectations);
    if (expected.approvalId !== undefined && record.id !== expected.approvalId) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ID_MISMATCH,
        "Approval ID does not match the required approval",
        "$.id",
      );
    }
    if (record.scope !== expected.scope) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_SCOPE_MISMATCH,
        "Approval scope does not match the required scope",
        "$.scope",
      );
    }
    if (!arraysEqual([...record.artifactSha256].sort(), expected.artifactSha256)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
        "Approval hashes do not match the exact current artifact and evidence set",
        "$.artifactSha256",
      );
    }
    if (!arraysEqual([...record.layerIds].sort(), expected.layerIds)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_LAYER_MISMATCH,
        "Approval layer IDs do not match the exact required layer set",
        "$.layerIds",
      );
    }
    if (!arraysEqual([...record.reviewedPoseIds].sort(), expected.reviewedPoseIds)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_POSE_MISMATCH,
        "Approval pose IDs do not match every required pose",
        "$.reviewedPoseIds",
      );
    }
    if (!arraysEqual(
      [...record.reviewedZoomPercent].sort((left, right) => left - right),
      expected.reviewedZoomPercent,
    )) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ZOOM_MISMATCH,
        "Approval zoom evidence does not match the exact required zoom set",
        "$.reviewedZoomPercent",
      );
    }
  }
  return record;
}

export const validateApprovalRecordInput = validateReviewerApprovalRecord;

/** Build a canonical pending template. No caller field can supply a visual decision. */
export function createPendingApprovalTemplate(options = {}) {
  if (!isPlainObject(options)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Pending approval options must be a plain object",
    );
  }
  if (
    (hasOwn(options, "decision") && options.decision !== "pending")
    || (hasOwn(options, "reviewer") && options.reviewer !== null)
    || (hasOwn(options, "reviewedAt") && options.reviewedAt !== null)
  ) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.TEMPLATE_DECISION_FORBIDDEN,
      "Template generation cannot supply or infer a reviewer decision",
      "$",
    );
  }

  const scope = assertScope(options.scope);
  const requirement = scopeRequirements(scope);
  const suppliedZooms = zoomsFrom(options);
  const reviewedZoomPercent = suppliedZooms === undefined
    ? [...requirement.requiredZoomPercent]
    : normalizeZooms(suppliedZooms);
  const template = {
    artifactSha256: normalizeHashes(hashesFrom(options)),
    decision: "pending",
    id: options.id,
    layerIds: normalizeIds(layersFrom(options), "$.layerIds", {
      allowEmpty: requirement.allowEmptyLayerIds,
    }),
    notes: options.notes
      ?? `Pending human ${scope} review; this template records no visual decision.`,
    reviewedAt: null,
    reviewedPoseIds: normalizeIds(posesFrom(options), "$.reviewedPoseIds", {
      allowEmpty: false,
    }),
    reviewedZoomPercent,
    reviewer: null,
    scope,
  };
  return validateReviewerApprovalRecord(template);
}

export const buildPendingApprovalTemplate = createPendingApprovalTemplate;

export function serializePendingApprovalTemplate(value) {
  const record = validateReviewerApprovalRecord(value);
  if (record.decision !== "pending" || record.reviewer !== null || record.reviewedAt !== null) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.TEMPLATE_DECISION_FORBIDDEN,
      "Only a pending, undecided approval template can be serialized by this function",
      "$",
    );
  }
  return APPROVAL_RECORD_SCHEMA.serializeLine(record);
}

export const serializeApprovalTemplate = serializePendingApprovalTemplate;

function closureFailure(reason, message, expected, approvalId = null) {
  return deepFreeze({
    approvalId,
    code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    eligible: false,
    message,
    ok: false,
    outcome: expected.scope === "release" || expected.scope === "fidelity"
      ? "fallback-only"
      : "static",
    reason,
    releasable: false,
    scope: expected.scope,
  });
}

/**
 * Compare a historical reviewer record with the exact current hash/ID/evidence
 * expectation. Stale, partial, pending, rejected, and malformed records return a
 * deterministic fail-closed value rather than becoming release eligible.
 */
export function evaluateApprovalClosure(value, expectations) {
  const expected = exactExpectation(expectations);
  if (value === null || value === undefined) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ABSENT,
      "Required approval record is absent",
      expected,
    );
  }

  let record;
  try {
    record = validateReviewerApprovalRecord(value);
  } catch (error) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_RECORD_INVALID,
      error instanceof Error ? error.message : "Approval record is invalid",
      expected,
      isPlainObject(value) && typeof value.id === "string" ? value.id : null,
    );
  }

  if (expected.approvalId !== undefined && record.id !== expected.approvalId) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ID_MISMATCH,
      "Approval ID does not match the required approval",
      expected,
      record.id,
    );
  }
  if (record.scope !== expected.scope) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_SCOPE_MISMATCH,
      "Approval scope does not match the required scope",
      expected,
      record.id,
    );
  }
  if (!arraysEqual([...record.artifactSha256].sort(), expected.artifactSha256)) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
      "Approval hashes do not match the exact current artifact and evidence set",
      expected,
      record.id,
    );
  }
  if (!arraysEqual([...record.layerIds].sort(), expected.layerIds)) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_LAYER_MISMATCH,
      "Approval layer IDs do not match the exact required layer set",
      expected,
      record.id,
    );
  }
  if (!arraysEqual([...record.reviewedPoseIds].sort(), expected.reviewedPoseIds)) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_POSE_MISMATCH,
      "Approval pose IDs do not match every required pose",
      expected,
      record.id,
    );
  }
  if (!arraysEqual(
    [...record.reviewedZoomPercent].sort((left, right) => left - right),
    expected.reviewedZoomPercent,
  )) {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ZOOM_MISMATCH,
      "Approval zoom evidence does not match the exact required zoom set",
      expected,
      record.id,
    );
  }
  if (record.decision === "pending") {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_DECISION_PENDING,
      "Approval remains pending human review",
      expected,
      record.id,
    );
  }
  if (record.decision === "rejected") {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_DECISION_REJECTED,
      "Reviewer rejected the exact artifact set",
      expected,
      record.id,
    );
  }
  if (record.decision !== "approved") {
    return closureFailure(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_NOT_APPROVED,
      "Approval decision is not approved",
      expected,
      record.id,
    );
  }

  return deepFreeze({
    approvalId: record.id,
    code: null,
    eligible: true,
    message: "Approval hashes and review evidence close against current inputs",
    ok: true,
    outcome: "approved",
    reason: null,
    releasable: true,
    scope: record.scope,
  });
}

export const checkApprovalClosure = evaluateApprovalClosure;

export function isApprovalClosed(value, expectations) {
  return evaluateApprovalClosure(value, expectations).ok;
}

/** Compare provenance metadata with exact current artifact and parent identities. */
export function evaluateProvenanceClosure(value, expectations) {
  if (!isPlainObject(expectations)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Provenance expectation must be a plain object",
    );
  }
  const artifactSha256 = normalizeHashes(
    [expectations.artifactSha256],
    "$.artifactSha256",
  )[0];
  const immediateParentSha256 = normalizeHashes(
    expectations.immediateParentSha256,
    "$.immediateParentSha256",
  );

  let record;
  try {
    record = PROVENANCE_RECORD_SCHEMA.parse(value);
  } catch (error) {
    return deepFreeze({
      code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      message: error instanceof Error ? error.message : "Provenance record is invalid",
      ok: false,
      reason: APPROVAL_TOOL_ISSUE_CODES.PROVENANCE_RECORD_INVALID,
    });
  }
  if (
    expectations.artifactId !== undefined
    && record.artifactId !== expectations.artifactId
  ) {
    return deepFreeze({
      code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      message: "Provenance artifact ID does not match the current artifact",
      ok: false,
      reason: APPROVAL_TOOL_ISSUE_CODES.PROVENANCE_ARTIFACT_MISMATCH,
    });
  }
  if (record.artifactSha256 !== artifactSha256) {
    return deepFreeze({
      code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      message: "Provenance artifact hash does not match current bytes",
      ok: false,
      reason: APPROVAL_TOOL_ISSUE_CODES.PROVENANCE_ARTIFACT_MISMATCH,
    });
  }
  if (!arraysEqual([...record.immediateParentSha256].sort(), immediateParentSha256)) {
    return deepFreeze({
      code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      message: "Provenance parent hashes do not match the exact current parent set",
      ok: false,
      reason: APPROVAL_TOOL_ISSUE_CODES.PROVENANCE_PARENT_MISMATCH,
    });
  }
  return deepFreeze({
    code: null,
    message: "Provenance closes against current artifact and parent identities",
    ok: true,
    reason: null,
  });
}

export const checkProvenanceClosure = evaluateProvenanceClosure;

/**
 * Resolve all required approvals for a proposed moving set. An empty proposed set
 * is explicitly valid and remains at Reference Pose without manufacturing records.
 */
export function evaluateApprovalSetClosure({
  approvals = [],
  approvedMovingLayerIds = [],
  requirements = [],
} = {}) {
  const movingLayerIds = normalizeIds(
    approvedMovingLayerIds,
    "$.approvedMovingLayerIds",
  );
  if (!Array.isArray(approvals) || !Array.isArray(requirements)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approvals and requirements must be arrays",
      "$",
    );
  }
  if (movingLayerIds.length === 0) {
    return deepFreeze({
      approvedMovingLayerIds: [],
      failures: [],
      mode: "reference-pose",
      ok: true,
      releasable: true,
    });
  }

  if (requirements.length === 0) {
    return deepFreeze({
      approvedMovingLayerIds: [],
      failures: [deepFreeze({
        approvalId: null,
        code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        eligible: false,
        message: "A nonempty moving set requires explicit approval expectations",
        ok: false,
        outcome: "static",
        reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ABSENT,
        releasable: false,
        scope: null,
      })],
      mode: "static",
      ok: false,
      releasable: false,
    });
  }

  const expectedRequirements = requirements.map((requirement) => exactExpectation(requirement));
  const approvedRequirementLayerIds = normalizeIds(
    [...new Set(expectedRequirements.flatMap(({ layerIds }) => layerIds))],
    "$.requirements.layerIds",
  );
  if (!arraysEqual(movingLayerIds, approvedRequirementLayerIds)) {
    return deepFreeze({
      approvedMovingLayerIds: [],
      failures: [deepFreeze({
        approvalId: null,
        code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        eligible: false,
        message: "Approved moving layer IDs must equal the exact layer set covered by the approval requirements",
        ok: false,
        outcome: "static",
        reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_LAYER_MISMATCH,
        releasable: false,
        scope: null,
      })],
      mode: "static",
      ok: false,
      releasable: false,
    });
  }

  const failures = [];
  for (const expected of expectedRequirements) {
    const matching = approvals.find((approval) => (
      isPlainObject(approval)
      && (
        expected.approvalId === undefined
          ? approval.scope === expected.scope
          : approval.id === expected.approvalId
      )
    ));
    const result = evaluateApprovalClosure(matching, expected);
    if (!result.ok) failures.push(result);
  }

  if (failures.length !== 0) {
    return deepFreeze({
      approvedMovingLayerIds: [],
      failures,
      mode: "static",
      ok: false,
      releasable: false,
    });
  }
  return deepFreeze({
    approvedMovingLayerIds: movingLayerIds,
    failures: [],
    mode: "approved-moving",
    ok: true,
    releasable: true,
  });
}

export const resolveApprovalClosure = evaluateApprovalSetClosure;
