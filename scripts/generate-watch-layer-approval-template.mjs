import {
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_PROJECT_PATHS,
  DEFAULT_PROJECT_ROOT,
  LAYER_GATE_FAILURE_CODES,
  assertInputHashSnapshotUnchanged,
  assertSafeProjectRelativePath,
  inspectSafeRegularFile,
  parseCanonicalJson,
  readSafeRegularFile,
  resolveSafeProjectPath,
  serializeCanonicalJsonLine,
  sha256,
} from "./watch-2-5d/contract.mjs";
import {
  APPROVAL_TOOL_ISSUE_CODES,
  ApprovalRecordToolError,
  computeApprovalInputHashes,
  createPendingApprovalTemplate,
  serializePendingApprovalTemplate,
  validateReviewerApprovalRecord,
} from "./watch-2-5d/approval-records.mjs";
import {
  LAYER_REVIEW_EVIDENCE_INDEX_PATH,
  resolveLayerReviewEvidenceSet,
  validateLayerReviewEvidenceIndex,
} from "./watch-2-5d/review-evidence.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const STABLE_FILE_STEM_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const LEGACY_REQUEST_FIELDS = Object.freeze([
  "artifacts",
  "evidence",
  "id",
  "layerIds",
  "notes",
  "reviewedPoseIds",
  "reviewedZoomPercent",
  "scope",
]);
const INDEX_REQUEST_FIELDS = Object.freeze([
  "evidenceIndex",
  "evidenceSetId",
  "id",
  "notes",
]);

const USAGE = `Usage:
  node scripts/generate-watch-layer-approval-template.mjs \\
    --id <approval-id> --scope <scope> \\
    --artifact <project-relative-path> [--artifact <path> ...] \\
    [--evidence <project-relative-path> ...] \\
    [--layer <layer-id> ...] --pose <pose-id> [--pose <pose-id> ...] \\
    [--zoom 100] [--zoom 200] --notes <text> [--output <path>]

  node scripts/generate-watch-layer-approval-template.mjs \\
    --id <approval-id> --evidence-index ${LAYER_REVIEW_EVIDENCE_INDEX_PATH} \\
    --evidence-set <review-set-id> --notes <text> [--output <path>]

  node scripts/generate-watch-layer-approval-template.mjs \\
    --request <project-relative-json> [--output <path>]

Options:
  --project-root <path>  Override the application root (primarily for isolated tooling tests).
  --output <path>        Must be a direct .json child of source/assets/watch-2-5d/v1/approvals.
  --help                 Print this finite command help.

Evidence-index mode derives every hash, layer ID, pose ID, scope, and required zoom
from the current canonical index. Those fields cannot be weakened by CLI input.
The generated record is always pending with null reviewer and reviewedAt fields.
An existing output is never overwritten.`;

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

function assertExactRequestFields(value, allowedFields, requiredFields) {
  const actualFields = Object.keys(value).sort();
  const allowed = new Set(allowedFields);
  const unknown = actualFields.filter((field) => !allowed.has(field));
  const missing = requiredFields.filter((field) => !hasOwn(value, field));
  if (unknown.length !== 0 || missing.length !== 0) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      `Template request fields differ (unknown: ${unknown.join(",") || "none"}; missing: ${missing.join(",") || "none"})`,
      "$",
    );
  }
}

function validateTemplateRequest(value) {
  if (!isPlainObject(value)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval template request must be a plain object",
    );
  }
  const hasEvidenceIndex = hasOwn(value, "evidenceIndex");
  const hasEvidenceSetId = hasOwn(value, "evidenceSetId");
  if (hasEvidenceIndex || hasEvidenceSetId) {
    if (!hasEvidenceIndex || !hasEvidenceSetId) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Evidence-index requests require both evidenceIndex and evidenceSetId",
        "$",
      );
    }
    assertExactRequestFields(value, INDEX_REQUEST_FIELDS, INDEX_REQUEST_FIELDS);
    const normalized = { ...value };
    Object.defineProperty(normalized, "mode", {
      enumerable: false,
      value: "evidence-index",
    });
    return Object.freeze(normalized);
  }

  assertExactRequestFields(
    value,
    LEGACY_REQUEST_FIELDS,
    LEGACY_REQUEST_FIELDS.filter((field) => field !== "reviewedZoomPercent"),
  );
  const normalized = { ...value };
  Object.defineProperty(normalized, "mode", {
    enumerable: false,
    value: "explicit-paths",
  });
  return Object.freeze(normalized);
}

function canonicalOutputPath(outputPath, approvalId, projectRoot) {
  const candidate = outputPath
    ?? `${CANONICAL_PROJECT_PATHS.successorApprovalsDirectory}/${approvalId}.json`;
  const normalized = assertSafeProjectRelativePath(candidate, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorApprovalsDirectory],
    projectRoot,
  });
  if (
    dirname(normalized) !== CANONICAL_PROJECT_PATHS.successorApprovalsDirectory
    || !normalized.endsWith(".json")
    || !STABLE_FILE_STEM_PATTERN.test(basename(normalized, ".json"))
  ) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval output must be a direct, stable .json child of the approved non-public approvals directory",
      "$.output",
    );
  }
  return normalized;
}

async function ensureDirectoryChain(projectRoot, projectRelativeDirectory) {
  const root = resolve(projectRoot);
  let rootStats;
  try {
    rootStats = await lstat(root);
  } catch {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Project root cannot be inspected",
      "$.projectRoot",
    );
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Project root must be a regular non-symlink directory",
      "$.projectRoot",
    );
  }

  let current = root;
  for (const segment of projectRelativeDirectory.split("/")) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        fail(
          APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
          "Approval output parent must be a regular non-symlink directory",
          projectRelativeDirectory,
        );
      }
    } catch (error) {
      if (error instanceof ApprovalRecordToolError) throw error;
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        fail(
          APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
          "Approval output parent cannot be inspected safely",
          projectRelativeDirectory,
        );
      }
      await mkdir(current, { mode: 0o755 });
      const created = await lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        fail(
          APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
          "Approval output parent could not be created safely",
          projectRelativeDirectory,
        );
      }
    }
  }
}

async function assertTargetAbsent(absolutePath, projectRelativePath) {
  try {
    await lstat(absolutePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval output cannot be inspected safely",
      projectRelativePath,
    );
  }
  fail(
    APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
    "Approval output already exists and will not be overwritten",
    projectRelativePath,
  );
}

async function writeExclusive(path, bytes) {
  let handle;
  try {
    handle = await open(path, "wx", 0o644);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Approval output already exists and will not be overwritten",
        path,
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function sameIdentity(actual, expected) {
  return actual.path === expected.path
    && actual.sha256 === expected.sha256
    && actual.byteLength === expected.byteLength;
}

async function resolveEvidenceIndexBindings({
  approvalId,
  evidenceIndex,
  evidenceSetId,
  projectRoot,
}) {
  const indexPath = assertSafeProjectRelativePath(evidenceIndex, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
    projectRoot,
  });
  if (indexPath !== LAYER_REVIEW_EVIDENCE_INDEX_PATH) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      `Evidence index must use the canonical path ${LAYER_REVIEW_EVIDENCE_INDEX_PATH}`,
      "$.evidenceIndex",
    );
  }
  const inspectedIndex = await inspectSafeRegularFile(indexPath, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
    expectedPath: indexPath,
    projectRoot,
  });
  let index;
  try {
    index = validateLayerReviewEvidenceIndex(parseCanonicalJson(inspectedIndex.bytes));
  } catch (error) {
    if (error && typeof error === "object" && "issueCode" in error) throw error;
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Layer evidence index is not valid canonical JSON",
      indexPath,
    );
  }
  if (!serializeCanonicalJsonLine(index).equals(inspectedIndex.bytes)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Layer evidence index bytes are not canonical",
      indexPath,
    );
  }
  const reviewSet = resolveLayerReviewEvidenceSet(index, evidenceSetId);
  const artifactPaths = reviewSet.inputFiles.map(({ path }) => path);
  const evidencePaths = [indexPath, ...reviewSet.artifactPaths];
  const bindings = await computeApprovalInputHashes({
    artifacts: artifactPaths,
    evidence: evidencePaths,
    projectRoot,
  });

  const artifactByPath = new Map(
    bindings.artifactIdentities.map((identity) => [identity.path, identity]),
  );
  for (const expected of reviewSet.inputFiles) {
    const actual = artifactByPath.get(expected.path);
    if (actual === undefined || !sameIdentity(actual, expected)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
        "Evidence-index input identity differs from current bytes",
        expected.path,
      );
    }
  }
  const indexedArtifactByPath = new Map(
    index.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  const evidenceByPath = new Map(
    bindings.evidenceIdentities.map((identity) => [identity.path, identity]),
  );
  if (!sameIdentity(evidenceByPath.get(indexPath), inspectedIndex.identity)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
      "Evidence index changed during approval binding",
      indexPath,
    );
  }
  for (const path of reviewSet.artifactPaths) {
    const expected = indexedArtifactByPath.get(path);
    const actual = evidenceByPath.get(path);
    if (
      expected === undefined
      || actual === undefined
      || actual.path !== expected.path
      || actual.sha256 !== expected.sha256
      || actual.byteLength !== expected.byteLength
    ) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
        "Rendered evidence identity differs from the current evidence index",
        path,
      );
    }
  }

  const artifactSha256 = [
    ...new Set([
      ...bindings.artifactSha256,
      ...reviewSet.projectionSha256,
    ]),
  ].sort();
  const expectation = Object.freeze({
    approvalId,
    artifactSha256,
    layerIds: reviewSet.layerIds,
    reviewedPoseIds: reviewSet.poseIds,
    reviewedZoomPercent: reviewSet.zoomPercent,
    scope: reviewSet.scope,
  });
  return Object.freeze({
    artifactSha256,
    evidenceIndex: index,
    expectation,
    inputSnapshot: bindings.inputSnapshot,
    reviewSet,
  });
}

async function resolveTemplateBindings(validatedRequest, projectRoot) {
  if (validatedRequest.mode === "evidence-index") {
    return resolveEvidenceIndexBindings({
      approvalId: validatedRequest.id,
      evidenceIndex: validatedRequest.evidenceIndex,
      evidenceSetId: validatedRequest.evidenceSetId,
      projectRoot,
    });
  }
  const bindings = await computeApprovalInputHashes({
    artifacts: validatedRequest.artifacts,
    evidence: validatedRequest.evidence,
    projectRoot,
  });
  return Object.freeze({
    artifactSha256: bindings.artifactSha256,
    expectation: Object.freeze({
      approvalId: validatedRequest.id,
      artifactSha256: bindings.artifactSha256,
      layerIds: validatedRequest.layerIds,
      reviewedPoseIds: validatedRequest.reviewedPoseIds,
      reviewedZoomPercent: validatedRequest.reviewedZoomPercent,
      scope: validatedRequest.scope,
    }),
    inputSnapshot: bindings.inputSnapshot,
    reviewSet: null,
  });
}

/**
 * Compute current bindings and write one canonical pending template. This function
 * cannot accept decision/reviewer fields and never overwrites an authored record.
 */
export async function generateWatchLayerApprovalTemplate({
  outputPath,
  projectRoot = DEFAULT_PROJECT_ROOT,
  request,
} = {}) {
  const validatedRequest = validateTemplateRequest(request);
  const bindings = await resolveTemplateBindings(validatedRequest, projectRoot);
  const expectation = bindings.expectation;
  const template = createPendingApprovalTemplate({
    artifactSha256: bindings.artifactSha256,
    id: validatedRequest.id,
    layerIds: expectation.layerIds,
    notes: validatedRequest.notes,
    reviewedPoseIds: expectation.reviewedPoseIds,
    reviewedZoomPercent: expectation.reviewedZoomPercent,
    scope: expectation.scope,
  });
  const bytes = serializePendingApprovalTemplate(template);
  const relativeOutputPath = canonicalOutputPath(outputPath, template.id, projectRoot);
  if (bindings.inputSnapshot.files.some(({ path }) => path === relativeOutputPath)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Approval output cannot also be a hashed artifact or evidence input",
      relativeOutputPath,
    );
  }

  await assertInputHashSnapshotUnchanged(bindings.inputSnapshot, {
    allowPublic: true,
    projectRoot,
  });
  await ensureDirectoryChain(
    projectRoot,
    CANONICAL_PROJECT_PATHS.successorApprovalsDirectory,
  );
  const absoluteOutputPath = resolveSafeProjectPath(relativeOutputPath, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorApprovalsDirectory],
    projectRoot,
  });
  await assertTargetAbsent(absoluteOutputPath, relativeOutputPath);

  let created = false;
  try {
    await writeExclusive(absoluteOutputPath, bytes);
    created = true;
    await assertInputHashSnapshotUnchanged(bindings.inputSnapshot, {
      allowPublic: true,
      projectRoot,
    });
    const inspected = await inspectSafeRegularFile(relativeOutputPath, {
      allowPublic: false,
      expectedPath: relativeOutputPath,
      projectRoot,
    });
    if (!inspected.bytes.equals(bytes)) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        "Written approval template bytes differ from canonical pending bytes",
        relativeOutputPath,
      );
    }
  } catch (error) {
    if (created) {
      try {
        await unlink(absoluteOutputPath);
      } catch {
        // Preserve the original deterministic failure. The exclusive output is
        // never an inspected input and cleanup is best-effort on I/O failure.
      }
    }
    throw error;
  }

  return Object.freeze({
    artifactSha256: bindings.artifactSha256,
    byteLength: bytes.byteLength,
    expectation: Object.freeze({
      ...expectation,
      reviewedPoseIds: template.reviewedPoseIds,
      reviewedZoomPercent: template.reviewedZoomPercent,
    }),
    evidenceSetId: bindings.reviewSet?.id ?? null,
    outputPath: relativeOutputPath,
    sha256: sha256(bytes),
    template,
  });
}

export const generateApprovalTemplate = generateWatchLayerApprovalTemplate;

/**
 * Validate a separately authored approved/rejected decision against the current
 * evidence set. Pending templates are deliberately not accepted as decisions.
 */
export async function validateWatchLayerApprovalDecision({
  approvalId,
  decision,
  evidenceIndex = LAYER_REVIEW_EVIDENCE_INDEX_PATH,
  evidenceSetId,
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  if (!isPlainObject(decision)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "Reviewer decision must be supplied as a separate plain object",
      "$.decision",
    );
  }
  const expectedApprovalId = approvalId ?? decision.id;
  const bindings = await resolveEvidenceIndexBindings({
    approvalId: expectedApprovalId,
    evidenceIndex,
    evidenceSetId,
    projectRoot,
  });
  const record = validateReviewerApprovalRecord(decision, bindings.expectation);
  if (record.decision === "pending") {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_DECISION_PENDING,
      "A generated pending template is not a separately supplied reviewer decision",
      "$.decision",
    );
  }
  await assertInputHashSnapshotUnchanged(bindings.inputSnapshot, {
    allowPublic: true,
    projectRoot,
  });
  return record;
}

export const validateApprovalDecisionAgainstEvidence = validateWatchLayerApprovalDecision;

function addRepeated(target, field, value) {
  if (!target[field]) target[field] = [];
  target[field].push(value);
}

function setOnce(target, field, value, flag) {
  if (target[field] !== undefined) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      `${flag} may be supplied only once`,
      flag,
    );
  }
  target[field] = value;
}

export function parseApprovalTemplateArguments(argv) {
  if (!Array.isArray(argv)) {
    fail(
      APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
      "CLI arguments must be an array",
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      parsed.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `${flag} requires a value`,
        flag,
      );
    }
    index += 1;
    if (flag === "--artifact") addRepeated(parsed, "artifacts", value);
    else if (flag === "--evidence") addRepeated(parsed, "evidence", value);
    else if (flag === "--layer") addRepeated(parsed, "layerIds", value);
    else if (flag === "--pose") addRepeated(parsed, "reviewedPoseIds", value);
    else if (flag === "--zoom") addRepeated(parsed, "reviewedZoomPercent", Number(value));
    else if (flag === "--id") setOnce(parsed, "id", value, flag);
    else if (flag === "--scope") setOnce(parsed, "scope", value, flag);
    else if (flag === "--notes") setOnce(parsed, "notes", value, flag);
    else if (flag === "--output") setOnce(parsed, "outputPath", value, flag);
    else if (flag === "--project-root") setOnce(parsed, "projectRoot", value, flag);
    else if (flag === "--request") setOnce(parsed, "requestPath", value, flag);
    else if (flag === "--evidence-index") setOnce(parsed, "evidenceIndex", value, flag);
    else if (flag === "--evidence-set") setOnce(parsed, "evidenceSetId", value, flag);
    else {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `Unknown argument ${flag}`,
        flag,
      );
    }
  }
  return parsed;
}

async function requestFromArguments(parsed) {
  const projectRoot = parsed.projectRoot ?? DEFAULT_PROJECT_ROOT;
  if (parsed.requestPath !== undefined) {
    const conflicting = [
      "artifacts",
      "evidence",
      "evidenceIndex",
      "evidenceSetId",
      "id",
      "layerIds",
      "notes",
      "reviewedPoseIds",
      "reviewedZoomPercent",
      "scope",
    ].filter((field) => parsed[field] !== undefined);
    if (conflicting.length !== 0) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `--request cannot be combined with direct request fields: ${conflicting.join(",")}`,
        "--request",
      );
    }
    const requestPath = assertSafeProjectRelativePath(parsed.requestPath, {
      allowPublic: false,
      projectRoot,
    });
    const requestBytes = await readSafeRegularFile(requestPath, {
      allowPublic: false,
      expectedPath: requestPath,
      projectRoot,
    });
    return {
      projectRoot,
      request: validateTemplateRequest(parseCanonicalJson(requestBytes)),
    };
  }

  if (parsed.evidenceIndex !== undefined || parsed.evidenceSetId !== undefined) {
    const conflicting = [
      "artifacts",
      "evidence",
      "layerIds",
      "reviewedPoseIds",
      "reviewedZoomPercent",
      "scope",
    ].filter((field) => parsed[field] !== undefined);
    if (conflicting.length !== 0) {
      fail(
        APPROVAL_TOOL_ISSUE_CODES.APPROVAL_INPUT_INVALID,
        `Evidence-index mode cannot be combined with manually selected fields: ${conflicting.join(",")}`,
        "$",
      );
    }
    return {
      projectRoot,
      request: validateTemplateRequest({
        evidenceIndex: parsed.evidenceIndex,
        evidenceSetId: parsed.evidenceSetId,
        id: parsed.id,
        notes: parsed.notes,
      }),
    };
  }

  return {
    projectRoot,
    request: validateTemplateRequest({
      artifacts: parsed.artifacts ?? [],
      evidence: parsed.evidence ?? [],
      id: parsed.id,
      layerIds: parsed.layerIds ?? [],
      notes: parsed.notes,
      reviewedPoseIds: parsed.reviewedPoseIds ?? [],
      reviewedZoomPercent: parsed.reviewedZoomPercent ?? [],
      scope: parsed.scope,
    }),
  };
}

function formatFailure(error) {
  if (error && typeof error === "object" && "code" in error) {
    const issue = "issueCode" in error ? `/${String(error.issueCode)}` : "";
    const message = "message" in error ? String(error.message) : "Approval template generation failed";
    return `${String(error.code)}${issue}: ${message}`;
  }
  return `${LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function runApprovalTemplateCli(argv = process.argv.slice(2)) {
  const parsed = parseApprovalTemplateArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return null;
  }
  const { projectRoot, request } = await requestFromArguments(parsed);
  const result = await generateWatchLayerApprovalTemplate({
    outputPath: parsed.outputPath,
    projectRoot,
    request,
  });
  console.log(
    `WATCH_LAYER_APPROVAL_TEMPLATE_PENDING ${result.outputPath} ${result.byteLength} bytes ${result.sha256}`,
  );
  return result;
}

async function main() {
  try {
    await runApprovalTemplateCli();
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  await main();
}
