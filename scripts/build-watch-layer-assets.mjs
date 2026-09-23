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
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { verifyWatchImageAssets } from "./verify-watch-image-assets.mjs";
import {
  APPROVED_MASTER_IDENTITY,
  AUTHORING_DOCUMENT_SCHEMA,
  CANONICAL_PROJECT_PATHS,
  CANONICAL_SOURCE_COORDINATE_SPACE,
  DEFAULT_PROJECT_ROOT,
  ENHANCEMENT_BUDGETS,
  GEAR_RELATIONSHIP_SCHEMA,
  LAYER_ASSET_MANIFEST_SCHEMA,
  LAYER_GATE_FAILURE_CODES,
  LAYER_RECORD_SCHEMA,
  MOTION_PROFILE_SCHEMA,
  PHASE_RECORD_SCHEMA,
  PREDECESSOR_MANIFEST_IDENTITY,
  PUBLIC_ASSET_RECORD_SCHEMA,
  RELEASE_POINTER_SCHEMA,
  RUNTIME_MANIFEST_SCHEMA,
  assertApprovedMasterIdentity,
  assertInputHashSnapshotUnchanged,
  assertPredecessorManifestIdentity,
  canonicalJsonStringify,
  canonicalizeJson,
  createInputHashSnapshot,
  inspectApprovedDependencyFields,
  inspectSafeRegularFile,
  parseCanonicalJson,
  serializeCanonicalJsonLine,
  sha256,
} from "./watch-2-5d/contract.mjs";
import { extractMaskedRgba } from "./watch-2-5d/image-operations.mjs";
import {
  evaluateManifestClosure,
  hashPhaseProjection,
} from "./watch-2-5d/manifest-closure.mjs";
import { LAYER_REVIEW_EVIDENCE_INDEX_PATH } from "./watch-2-5d/review-evidence.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const NORMALIZED_INPUTS_FILENAME = "normalized-package-inputs.json";

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

export const WATCH_LAYER_PROFILE_IDS = Object.freeze(["compact", "expanded"]);
export const WATCH_LAYER_PROFILE_SPECS = Object.freeze({
  compact: Object.freeze({ height: 752, sourceScale: 0.5, width: 1_380 }),
  expanded: Object.freeze({ height: 1_504, sourceScale: 1, width: 2_760 }),
});
export const WATCH_LAYER_WEBP_ENCODER = Object.freeze({
  alphaQuality: 100,
  channels: 4,
  colourspace: "srgb",
  effort: 6,
  nearLossless: false,
  quality: 95,
  smartSubsample: true,
});
export const MAX_WATCH_LAYER_PROFILE_IMAGES = 6;
export const RECONSTRUCTED_BACKGROUND_Z_ORDER = 0;
export const WATCH_LAYER_RUNTIME_MANIFEST_PATH =
  `${CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/runtime-manifest.json`;

export const NORMALIZED_WATCH_LAYER_INPUTS_PATH =
  `${CANONICAL_PROJECT_PATHS.successorReviewDirectory}/${NORMALIZED_INPUTS_FILENAME}`;
export const WATCH_LAYER_BUILD_REVIEW_DIRECTORY =
  `${CANONICAL_PROJECT_PATHS.successorReviewDirectory}/build`;
export const WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH =
  `${WATCH_LAYER_BUILD_REVIEW_DIRECTORY}/input-snapshot.json`;
export const WATCH_LAYER_BUILD_METADATA_PATH =
  `${WATCH_LAYER_BUILD_REVIEW_DIRECTORY}/build-metadata.json`;
export const STAGED_WATCH_LAYER_PACKAGE_PATH =
  CANONICAL_PROJECT_PATHS.successorPackageManifest;

export const WATCH_LAYER_BUILD_ISSUE_CODES = Object.freeze({
  ARGUMENT_INVALID: "LAYER_BUILD_ARGUMENT_INVALID",
  DEPTH_FORBIDDEN: "LAYER_BUILD_DEPTH_FORBIDDEN",
  INPUT_INVALID: "LAYER_BUILD_INPUT_INVALID",
  NETWORK_DISABLED: "LAYER_BUILD_NETWORK_DISABLED",
  NORMALIZED_IDENTITY_MISMATCH: "LAYER_BUILD_NORMALIZED_IDENTITY_MISMATCH",
  OUTPUT_CHANGED: "LAYER_BUILD_OUTPUT_CHANGED",
  PHASE_INVALID: "LAYER_BUILD_PHASE_INVALID",
  PREDECESSOR_INVALID: "LAYER_BUILD_PREDECESSOR_INVALID",
  PROFILE_BUDGET_EXCEEDED: "LAYER_BUILD_PROFILE_BUDGET_EXCEEDED",
  PROFILE_ENCODE_FAILED: "LAYER_BUILD_PROFILE_ENCODE_FAILED",
  PROFILE_IDENTITY_MISMATCH: "LAYER_BUILD_PROFILE_IDENTITY_MISMATCH",
  PROFILE_INPUT_INVALID: "LAYER_BUILD_PROFILE_INPUT_INVALID",
  PROFILE_LAYER_FORBIDDEN: "LAYER_BUILD_PROFILE_LAYER_FORBIDDEN",
  PROFILE_LIMIT_EXCEEDED: "LAYER_BUILD_PROFILE_LIMIT_EXCEEDED",
  PROFILE_PHASE_INVALID: "LAYER_BUILD_PROFILE_PHASE_INVALID",
  PUBLIC_ASSET_FORBIDDEN: "LAYER_BUILD_PUBLIC_ASSET_FORBIDDEN",
  RELEASE_NOT_FALLBACK: "LAYER_BUILD_RELEASE_NOT_FALLBACK",
  STAGE_INVALID: "LAYER_BUILD_STAGE_INVALID",
  STAGE_WRITE_FAILED: "LAYER_BUILD_STAGE_WRITE_FAILED",
});

export class WatchLayerBuildError extends Error {
  constructor(
    issueCode,
    message,
    path = "$",
    code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
  ) {
    super(message);
    this.code = code;
    this.failure = Object.freeze({ code, issueCode, message, ok: false, path });
    this.issueCode = issueCode;
    this.name = "WatchLayerBuildError";
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
  code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
) {
  throw new WatchLayerBuildError(issueCode, message, path, code);
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

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
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

function assertExactFields(value, expectedFields, path) {
  if (!isPlainObject(value)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
      "Normalized package value must be a plain object",
      path,
    );
  }
  const expected = [...expectedFields].sort(lexicalCompare);
  const actual = Object.keys(value).sort(lexicalCompare);
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
      `Normalized package fields must equal ${expected.join(", ")}`,
      path,
    );
  }
  return value;
}

function assertArray(value, path) {
  if (!Array.isArray(value)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
      "Normalized package field must be an array",
      path,
    );
  }
  return value;
}

function assertIdentityRecord(value, expected, path) {
  assertExactFields(value, ["byteLength", "path", "sha256"], path);
  if (
    value.path !== expected.path
    || value.sha256 !== expected.sha256
    || value.byteLength !== expected.byteLength
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.NORMALIZED_IDENTITY_MISMATCH,
      "Normalized identity does not match current bytes",
      path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
}

/** Run all project inspection with browser-style network entry points disabled. */
export async function withWatchLayerBuildNetworkDisabled(operation) {
  if (typeof operation !== "function") {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
      "Network-disabled build operation must be a function",
      "$.operation",
    );
  }
  const names = ["fetch", "WebSocket", "XMLHttpRequest"];
  const descriptors = new Map();
  const installed = [];
  const guard = function watchLayerBuildNetworkGuard() {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.NETWORK_DISABLED,
      "Watch-layer package staging forbids network access",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  };

  try {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      if (descriptor !== undefined && descriptor.configurable === false) {
        fail(
          WATCH_LAYER_BUILD_ISSUE_CODES.NETWORK_DISABLED,
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

async function verifyPredecessorFirst(projectRoot) {
  try {
    return await verifyWatchImageAssets({ projectRoot });
  } catch {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PREDECESSOR_INVALID,
      "Predecessor watch-image verification failed before successor inspection",
      CANONICAL_PROJECT_PATHS.predecessorManifest,
      LAYER_GATE_FAILURE_CODES.PREDECESSOR_INVALID,
    );
  }
}

async function inspectOptionalFileState(projectRoot, projectPath) {
  const absolutePath = resolve(projectRoot, projectPath);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (isMissing(error)) return Object.freeze({ kind: "absent", path: projectPath });
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.OUTPUT_CHANGED,
      "Existing project output cannot be inspected",
      projectPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.OUTPUT_CHANGED,
      "Existing package output must be a regular non-symlink file",
      projectPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const bytes = await readFile(absolutePath);
  return Object.freeze({
    byteLength: bytes.byteLength,
    kind: "file",
    path: projectPath,
    sha256: sha256(bytes),
  });
}

async function collectDirectoryState(absoluteRoot, relativePath = "") {
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const members = [];
  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const childAbsolute = resolve(absoluteRoot, entry.name);
    if (entry.isSymbolicLink()) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.OUTPUT_CHANGED,
        "Successor public output may not contain symbolic links",
        childRelative,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    if (entry.isDirectory()) {
      members.push({ kind: "directory", path: childRelative });
      members.push(...await collectDirectoryState(childAbsolute, childRelative));
    } else if (entry.isFile()) {
      const bytes = await readFile(childAbsolute);
      members.push({
        byteLength: bytes.byteLength,
        kind: "file",
        path: childRelative,
        sha256: sha256(bytes),
      });
    } else {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.OUTPUT_CHANGED,
        "Successor public output must contain only regular files and directories",
        childRelative,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  return members;
}

async function inspectPublicOutputState(projectRoot) {
  const projectPath = CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory;
  const absolutePath = resolve(projectRoot, projectPath);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (isMissing(error)) return Object.freeze({ kind: "absent", members: [], path: projectPath });
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.OUTPUT_CHANGED,
      "Successor public output cannot be inspected",
      projectPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.OUTPUT_CHANGED,
      "Successor public output must be a regular non-symlink directory",
      projectPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const members = await collectDirectoryState(absolutePath);
  const firstFile = members.find(({ kind }) => kind === "file");
  if (firstFile !== undefined) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PUBLIC_ASSET_FORBIDDEN,
      "Fallback-only package staging forbids successor public/runtime assets",
      `${projectPath}/${firstFile.path}`,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  return deepFreeze({ kind: "directory", members, path: projectPath });
}

async function snapshotCurrentOutputs(projectRoot) {
  const release = await inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.successorRelease, {
    allowPublic: false,
    expectedPath: CANONICAL_PROJECT_PATHS.successorRelease,
    projectRoot,
  });
  const releaseValue = RELEASE_POINTER_SCHEMA.parseJson(release.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  });
  if (
    releaseValue.status !== "fallback-only"
    || releaseValue.runtimeManifest !== null
    || releaseValue.depthEnabled !== false
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.RELEASE_NOT_FALLBACK,
      "Task 6.1 stages only a URL-free fallback-only package",
      CANONICAL_PROJECT_PATHS.successorRelease,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  const [packageState, publicState] = await Promise.all([
    inspectOptionalFileState(projectRoot, CANONICAL_PROJECT_PATHS.successorPackageManifest),
    inspectPublicOutputState(projectRoot),
  ]);
  return deepFreeze({
    package: packageState,
    publicAssets: publicState,
    release: {
      identity: release.identity,
      value: releaseValue,
    },
  });
}

async function assertCurrentOutputsUnchanged(projectRoot, before) {
  const after = await snapshotCurrentOutputs(projectRoot);
  if (canonicalJsonStringify(after) !== canonicalJsonStringify(before)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.OUTPUT_CHANGED,
      "Current package, release, or public output changed during isolated staging",
      "$",
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
  return after;
}

function parsePredecessorDerivativePaths(bytes) {
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PREDECESSOR_INVALID,
      "Verified predecessor manifest cannot be parsed",
      CANONICAL_PROJECT_PATHS.predecessorManifest,
      LAYER_GATE_FAILURE_CODES.PREDECESSOR_INVALID,
    );
  }
  const derivatives = document?.derivativePolicy?.derivatives;
  if (!Array.isArray(derivatives)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PREDECESSOR_INVALID,
      "Verified predecessor manifest omits derivative membership",
      CANONICAL_PROJECT_PATHS.predecessorManifest,
      LAYER_GATE_FAILURE_CODES.PREDECESSOR_INVALID,
    );
  }
  return derivatives.map((entry) => entry.file);
}

function validateNormalizedDocument(value) {
  assertExactFields(value, [
    "approvedMovingLayerIds",
    "artifactIssues",
    "authoring",
    "candidateDecisions",
    "depthEnabled",
    "evidenceIndex",
    "excludedLayerIds",
    "fileInputs",
    "mode",
    "packageInputs",
    "phases",
    "publicAssets",
    "releaseStatus",
    "runtimeManifest",
    "schemaVersion",
    "staticLayerIds",
  ], "$normalized");
  if (value.schemaVersion !== 1) {
    fail(WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID, "Normalized schemaVersion must be 1", "$normalized.schemaVersion");
  }
  if (value.depthEnabled !== false) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.DEPTH_FORBIDDEN,
      "Task 6.1 requires disabled optional depth",
      "$normalized.depthEnabled",
      LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
    );
  }
  if (
    value.releaseStatus !== "fallback-only"
    || value.runtimeManifest !== null
    || !Array.isArray(value.publicAssets)
    || value.publicAssets.length !== 0
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PUBLIC_ASSET_FORBIDDEN,
      "Task 6.1 normalized inputs must remain fallback-only without runtime/public assets",
      "$normalized",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  assertExactFields(value.fileInputs, ["fills", "masks"], "$normalized.fileInputs");
  assertExactFields(value.packageInputs, [
    "approvals",
    "layers",
    "masks",
    "motionProfiles",
    "provenance",
    "reconstructions",
    "relationships",
  ], "$normalized.packageInputs");
  for (const field of [
    "approvedMovingLayerIds",
    "artifactIssues",
    "candidateDecisions",
    "excludedLayerIds",
    "phases",
    "staticLayerIds",
  ]) assertArray(value[field], `$normalized.${field}`);
  for (const field of ["fills", "masks"]) {
    assertArray(value.fileInputs[field], `$normalized.fileInputs.${field}`);
  }
  for (const field of Object.keys(value.packageInputs)) {
    assertArray(value.packageInputs[field], `$normalized.packageInputs.${field}`);
  }
  const approvedMoving = value.packageInputs.layers
    .filter(({ disposition }) => disposition === "approved-moving")
    .map(({ id }) => id)
    .sort(lexicalCompare);
  const declaredMoving = [...value.approvedMovingLayerIds].sort(lexicalCompare);
  if (canonicalJsonStringify(approvedMoving) !== canonicalJsonStringify(declaredMoving)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
      "Normalized approvedMovingLayerIds must equal the approved-moving layer set",
      "$normalized.approvedMovingLayerIds",
    );
  }
  const expectedMode = declaredMoving.length === 0 ? "reference-pose" : "approved-moving";
  if (value.mode !== expectedMode) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
      "Normalized mode does not match the approved-moving layer set",
      "$normalized.mode",
    );
  }
  return value;
}

function buildCanonicalPhases(packageId, normalizedPhases, authoringPhases) {
  if (canonicalJsonStringify(normalizedPhases) !== canonicalJsonStringify(authoringPhases)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PHASE_INVALID,
      "Normalized phases differ from the strict authored phase declarations",
      "$normalized.phases",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  let nonApprovedSeen = false;
  return normalizedPhases.map((value, index) => {
    const phase = PHASE_RECORD_SCHEMA.parse(value);
    if (phase.ordinal !== index) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PHASE_INVALID,
        "Delivery phases must use canonical ordinal order",
        `$normalized.phases[${index}]`,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    if (phase.status === "approved" && nonApprovedSeen) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PHASE_INVALID,
        "Approved delivery phases must form one contiguous prefix",
        `$normalized.phases[${index}].status`,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    if (phase.status !== "approved") nonApprovedSeen = true;
    if (phase.runtimeManifestSha256 !== null) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PUBLIC_ASSET_FORBIDDEN,
        "Fallback-only phase records cannot bind a runtime manifest",
        `$normalized.phases[${index}].runtimeManifestSha256`,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    const expectedHash = hashPhaseProjection(packageId, phase);
    return PHASE_RECORD_SCHEMA.parse({ ...phase, phasePayloadSha256: expectedHash });
  });
}

async function inspectDeclaredFileInputs(projectRoot, normalized) {
  const groups = [
    {
      entries: normalized.fileInputs.masks,
      expected: new Map(normalized.packageInputs.masks.map((record) => [record.id, {
        path: record.file,
        sha256: record.sha256,
      }])),
      name: "masks",
    },
    {
      entries: normalized.fileInputs.fills,
      expected: new Map(normalized.packageInputs.reconstructions.map((record) => [record.fillId, {
        path: record.fillFile,
        sha256: record.fillSha256,
      }])),
      name: "fills",
    },
  ];
  const paths = [];
  for (const group of groups) {
    if (group.entries.length !== group.expected.size) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
        `Normalized ${group.name} file identities do not cover the accepted package records`,
        `$normalized.fileInputs.${group.name}`,
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      );
    }
    const seenIds = new Set();
    const seenPaths = new Set();
    for (let index = 0; index < group.entries.length; index += 1) {
      const entry = group.entries[index];
      const entryPath = `$normalized.fileInputs.${group.name}[${index}]`;
      assertExactFields(entry, ["artifactId", "byteLength", "path", "sha256"], entryPath);
      if (seenIds.has(entry.artifactId) || seenPaths.has(entry.path)) {
        fail(
          WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
          `Normalized ${group.name} identities must be unique`,
          entryPath,
        );
      }
      seenIds.add(entry.artifactId);
      seenPaths.add(entry.path);
      const expected = group.expected.get(entry.artifactId);
      if (expected === undefined || expected.path !== entry.path || expected.sha256 !== entry.sha256) {
        fail(
          WATCH_LAYER_BUILD_ISSUE_CODES.NORMALIZED_IDENTITY_MISMATCH,
          `Normalized ${group.name} identity differs from its package record`,
          entryPath,
          LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        );
      }
      const inspected = await inspectSafeRegularFile(entry.path, {
        allowPublic: false,
        allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
        expectedPath: entry.path,
        projectRoot,
      });
      assertIdentityRecord({
        byteLength: entry.byteLength,
        path: entry.path,
        sha256: entry.sha256,
      }, inspected.identity, entryPath);
      paths.push(entry.path);
    }
  }
  return uniqueSorted(paths);
}

function buildObservedArtifacts(manifest) {
  const provenanceByArtifactId = new Map(
    manifest.provenance.map((record) => [record.artifactId, record]),
  );
  const artifacts = new Map();
  const add = (id, digest) => {
    const provenance = provenanceByArtifactId.get(id);
    if (provenance === undefined) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
        `Artifact ${id} lacks normalized provenance`,
        "$normalized.packageInputs.provenance",
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    artifacts.set(id, {
      classification: provenance.classification,
      id,
      immediateParentSha256: provenance.immediateParentSha256,
      sha256: digest,
    });
  };

  for (const mask of manifest.masks) add(mask.id, mask.sha256);
  for (const reconstruction of manifest.reconstructions) {
    add(reconstruction.fillId, reconstruction.fillSha256);
  }
  for (const layer of manifest.layers) {
    add(layer.id, sha256(LAYER_RECORD_SCHEMA.serialize(layer)));
  }
  for (const motion of manifest.motionProfiles) {
    add(motion.id, sha256(MOTION_PROFILE_SCHEMA.serialize(motion)));
  }
  for (const relationship of manifest.relationships) {
    add(relationship.id, sha256(GEAR_RELATIONSHIP_SCHEMA.serialize(relationship)));
  }
  return [...artifacts.values()].sort((left, right) => lexicalCompare(left.id, right.id));
}

function buildApprovalRequirements(approvals) {
  return approvals.map((record) => ({
    approvalId: record.id,
    artifactSha256: record.artifactSha256,
    layerIds: record.layerIds,
    reviewedPoseIds: record.reviewedPoseIds,
    reviewedZoomPercent: record.reviewedZoomPercent,
    scope: record.scope,
  }));
}

function constructPackageManifest(authoring, normalized) {
  if (
    authoring.depthEnabled !== false
    || authoring.depthProfiles.some(({ enabled }) => enabled)
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.DEPTH_FORBIDDEN,
      "Task 6.1 cannot stage enabled optional depth",
      "$.authoring.depthProfiles",
      LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
    );
  }
  const phases = buildCanonicalPhases(
    authoring.packageId,
    normalized.phases,
    authoring.phases,
  );
  const manifest = LAYER_ASSET_MANIFEST_SCHEMA.parse({
    approvals: normalized.packageInputs.approvals,
    budgets: ENHANCEMENT_BUDGETS,
    canonicalMaster: APPROVED_MASTER_IDENTITY,
    depthProfiles: [],
    layers: normalized.packageInputs.layers,
    masks: normalized.packageInputs.masks,
    motionProfiles: normalized.packageInputs.motionProfiles,
    packageId: authoring.packageId,
    packageVersion: authoring.packageVersion,
    parentSpec: authoring.parentSpec,
    phases,
    predecessorContract: PREDECESSOR_MANIFEST_IDENTITY,
    provenance: normalized.packageInputs.provenance,
    publicAssets: [],
    reconstructions: normalized.packageInputs.reconstructions,
    relationships: normalized.packageInputs.relationships,
    runtimeManifest: null,
    schemaVersion: 1,
    sourceCoordinateSpace: authoring.sourceCoordinateSpace,
    sourceDateEpoch: authoring.sourceDateEpoch,
  });
  const closure = evaluateManifestClosure({
    approvalRequirements: buildApprovalRequirements(manifest.approvals),
    artifacts: buildObservedArtifacts(manifest),
    manifest,
    release: {
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    },
    runtimeManifest: null,
  });
  if (!closure.ok) {
    fail(
      closure.issueCode ?? WATCH_LAYER_BUILD_ISSUE_CODES.INPUT_INVALID,
      closure.message,
      closure.path ?? "$",
      closure.code ?? LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  return manifest;
}

async function inspectBuildInputs(projectRoot, predecessorResult, outputSnapshot) {
  const predecessor = await inspectSafeRegularFile(
    CANONICAL_PROJECT_PATHS.predecessorManifest,
    {
      allowPublic: false,
      expectedPath: CANONICAL_PROJECT_PATHS.predecessorManifest,
      projectRoot,
    },
  );
  const predecessorDerivativePaths = parsePredecessorDerivativePaths(predecessor.bytes);
  const basePaths = uniqueSorted([
    CANONICAL_PROJECT_PATHS.canonicalMaster,
    CANONICAL_PROJECT_PATHS.dependencyManifest,
    CANONICAL_PROJECT_PATHS.predecessorManifest,
    CANONICAL_PROJECT_PATHS.successorAuthoring,
    CANONICAL_PROJECT_PATHS.successorRelease,
    LAYER_REVIEW_EVIDENCE_INDEX_PATH,
    NORMALIZED_WATCH_LAYER_INPUTS_PATH,
    ...predecessorDerivativePaths,
    ...(outputSnapshot.package.kind === "file"
      ? [CANONICAL_PROJECT_PATHS.successorPackageManifest]
      : []),
  ]);
  const initialSnapshot = await createInputHashSnapshot(basePaths, {
    allowPublic: true,
    projectRoot,
  });
  const [authoringFile, normalizedFile, evidenceFile] = await Promise.all([
    inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.successorAuthoring, {
      allowPublic: false,
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
      expectedPath: CANONICAL_PROJECT_PATHS.successorAuthoring,
      projectRoot,
    }),
    inspectSafeRegularFile(NORMALIZED_WATCH_LAYER_INPUTS_PATH, {
      allowPublic: false,
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
      expectedPath: NORMALIZED_WATCH_LAYER_INPUTS_PATH,
      projectRoot,
    }),
    inspectSafeRegularFile(LAYER_REVIEW_EVIDENCE_INDEX_PATH, {
      allowPublic: false,
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
      expectedPath: LAYER_REVIEW_EVIDENCE_INDEX_PATH,
      projectRoot,
    }),
  ]);
  const authoring = AUTHORING_DOCUMENT_SCHEMA.parseJson(authoringFile.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  });
  const normalized = validateNormalizedDocument(parseCanonicalJson(normalizedFile.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  }));
  assertIdentityRecord(normalized.authoring, authoringFile.identity, "$normalized.authoring");
  assertIdentityRecord(normalized.evidenceIndex, evidenceFile.identity, "$normalized.evidenceIndex");
  if (
    authoring.canonicalMaster.sha256 !== predecessorResult.master.sha256
    || authoring.predecessorContract.sha256 !== predecessor.identity.sha256
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.NORMALIZED_IDENTITY_MISMATCH,
      "Authored package header differs from verified predecessor inputs",
      "$.authoring",
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  const declaredPaths = await inspectDeclaredFileInputs(projectRoot, normalized);
  await assertInputHashSnapshotUnchanged(initialSnapshot, {
    allowPublic: true,
    projectRoot,
  });
  const immutableSnapshot = await createInputHashSnapshot(
    uniqueSorted([...basePaths, ...declaredPaths]),
    { allowPublic: true, projectRoot },
  );
  const manifest = constructPackageManifest(authoring, normalized);
  return deepFreeze({
    authoring,
    authoringIdentity: authoringFile.identity,
    evidenceIdentity: evidenceFile.identity,
    immutableSnapshot,
    manifest,
    normalized,
    normalizedIdentity: normalizedFile.identity,
    predecessorDerivativeCount: predecessorDerivativePaths.length,
  });
}

async function assertDirectoryIsSafe(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
      `${label} does not exist or cannot be inspected`,
      path,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
      `${label} must be a regular non-symlink directory`,
      path,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
}

async function assertDestinationAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
      "Staging destination cannot be inspected safely",
      path,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  fail(
    WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
    "Staging destination must not already exist",
    path,
    LAYER_GATE_FAILURE_CODES.PATH_INVALID,
  );
}

function pathsOverlap(left, right) {
  return isContainedAbsolutePath(left, right) || isContainedAbsolutePath(right, left);
}

function assertStagingDestinationIsIsolated(projectRoot, destinationDirectory) {
  for (const projectPath of Object.values(CANONICAL_PROJECT_PATHS)) {
    const reservedPath = resolve(projectRoot, projectPath);
    if (pathsOverlap(destinationDirectory, reservedPath)) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
        "Staging destination must not overlap a canonical project input or output",
        destinationDirectory,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
}

async function createStageLocation(projectRoot, stagingDirectory) {
  if (stagingDirectory === undefined) {
    const ownerDirectory = await mkdtemp(join(tmpdir(), "watch-layer-package-stage-"));
    const workingDirectory = resolve(ownerDirectory, ".work");
    const destinationDirectory = resolve(ownerDirectory, "staged");
    await mkdir(workingDirectory, { mode: 0o755 });
    return {
      destinationDirectory,
      ownerDirectory,
      removeOwnerOnFailure: true,
      workingDirectory,
    };
  }
  if (typeof stagingDirectory !== "string" || stagingDirectory.length === 0) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
      "stagingDirectory must be a nonempty path",
      "$.stagingDirectory",
    );
  }
  const destinationDirectory = resolve(stagingDirectory);
  assertStagingDestinationIsIsolated(projectRoot, destinationDirectory);
  const parent = dirname(destinationDirectory);
  await assertDirectoryIsSafe(parent, "Staging parent");
  await assertDestinationAbsent(destinationDirectory);
  const workingDirectory = await mkdtemp(
    resolve(parent, `.${basename(destinationDirectory)}.work-`),
  );
  return {
    destinationDirectory,
    ownerDirectory: null,
    removeOwnerOnFailure: false,
    workingDirectory,
  };
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

async function writeStagedFile(workingDirectory, projectPath, bytes) {
  const target = resolve(workingDirectory, projectPath);
  if (!isContainedAbsolutePath(workingDirectory, target)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
      "Staged output escapes its isolated directory",
      projectPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  await mkdir(dirname(target), { mode: 0o755, recursive: true });
  await writeExclusive(target, bytes);
}

async function collectStagedFiles(absoluteRoot, relativePath = "") {
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const childAbsolute = resolve(absoluteRoot, entry.name);
    if (entry.isSymbolicLink()) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
        "Staged output may not contain symbolic links",
        childRelative,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    if (entry.isDirectory()) files.push(...await collectStagedFiles(childAbsolute, childRelative));
    else if (entry.isFile()) files.push(childRelative);
    else {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
        "Staged output must contain only regular files",
        childRelative,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  return files.sort(lexicalCompare);
}

async function assertStagedBytes(workingDirectory, expectedFiles) {
  const actualPaths = await collectStagedFiles(workingDirectory);
  const expectedPaths = [...expectedFiles.keys()].sort(lexicalCompare);
  if (
    actualPaths.length !== expectedPaths.length
    || actualPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_WRITE_FAILED,
      "Staged output membership differs from the deterministic build plan",
      workingDirectory,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
  for (const path of expectedPaths) {
    const actual = await readFile(resolve(workingDirectory, path));
    if (!actual.equals(expectedFiles.get(path))) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_WRITE_FAILED,
        "Staged output bytes changed before commit",
        path,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }
  }
}

function fileIdentity(path, bytes) {
  return Object.freeze({
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  });
}

function normalizeProfileByteView(value, expectedByteLength, path) {
  const tag = Object.prototype.toString.call(value);
  if (
    !ArrayBuffer.isView(value)
    || (
      !Buffer.isBuffer(value)
      && tag !== "[object Uint8Array]"
      && tag !== "[object Uint8ClampedArray]"
    )
    || value.byteLength !== expectedByteLength
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      `Profile raster must contain exactly ${expectedByteLength} unsigned bytes`,
      path,
    );
  }
  return Buffer.from(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function normalizeProfileRgba(value, path, { canonical = false, opaque = false } = {}) {
  if (!isPlainObject(value)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      "Profile RGBA input must be a plain raster object",
      path,
    );
  }
  const { width, height } = value;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > CANONICAL_SOURCE_COORDINATE_SPACE.width
    || height > CANONICAL_SOURCE_COORDINATE_SPACE.height
    || (
      canonical
      && (
        width !== CANONICAL_SOURCE_COORDINATE_SPACE.width
        || height !== CANONICAL_SOURCE_COORDINATE_SPACE.height
      )
    )
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      canonical
        ? "Profile RGBA input must equal the canonical 2760x1504 source space"
        : "Profile RGBA dimensions must be positive and canonically bounded",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  const data = normalizeProfileByteView(value.data, width * height * 4, `${path}.data`);
  if (opaque) {
    for (let offset = 3; offset < data.byteLength; offset += 4) {
      if (data[offset] !== 255) {
        fail(
          WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
          "Canonical source and reconstructed background inputs must be fully opaque",
          `${path}.data[${offset}]`,
          LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        );
      }
    }
  }
  return Object.freeze({ data, height, width });
}

function normalizeProfileMask(value, path) {
  if (!isPlainObject(value)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      "Profile layer mask must be a plain raster object",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  const { width, height } = value;
  if (
    width !== CANONICAL_SOURCE_COORDINATE_SPACE.width
    || height !== CANONICAL_SOURCE_COORDINATE_SPACE.height
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      "Profile layer mask must use canonical 2760x1504 coordinates",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  return Object.freeze({
    data: normalizeProfileByteView(value.data, width * height, `${path}.data`),
    height,
    width,
  });
}

function normalizeUniqueProfileIds(value, path) {
  if (!Array.isArray(value)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      "Approved profile layer IDs must be an array",
      path,
    );
  }
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (typeof id !== "string" || id.length === 0 || ids.has(id)) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
        "Approved profile layer IDs must be nonempty and unique",
        `${path}[${index}]`,
      );
    }
    ids.add(id);
  }
  return [...ids];
}

function normalizePresentationLayerInputs(layerInputs) {
  if (!Array.isArray(layerInputs)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      "Presentation layer inputs must be an array",
      "$.layerInputs",
    );
  }
  const inputs = new Map();
  for (let index = 0; index < layerInputs.length; index += 1) {
    const input = layerInputs[index];
    const path = `$.layerInputs[${index}]`;
    assertExactFields(input, ["mask", "record"], path);
    const record = LAYER_RECORD_SCHEMA.parse(input.record);
    if (record.id === "reconstructed-background" || inputs.has(record.id)) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
        "Presentation layer records must use unique non-reserved IDs",
        `${path}.record.id`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    inputs.set(record.id, Object.freeze({
      mask: input.mask,
      path,
      record,
    }));
  }
  return inputs;
}

function selectPresentationLayers({
  approvedMovingLayerIds,
  approvedStaticOccluderLayerIds,
  canonicalSource,
  layerInputs,
}) {
  const movingIds = normalizeUniqueProfileIds(
    approvedMovingLayerIds,
    "$.approvedMovingLayerIds",
  );
  const occluderIds = normalizeUniqueProfileIds(
    approvedStaticOccluderLayerIds,
    "$.approvedStaticOccluderLayerIds",
  );
  const movingSet = new Set(movingIds);
  if (occluderIds.some((id) => movingSet.has(id))) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_LAYER_FORBIDDEN,
      "A presentation layer cannot be both moving and a static occluder",
      "$.approvedStaticOccluderLayerIds",
      LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
    );
  }
  const selectedIds = [...movingIds, ...occluderIds];
  if (selectedIds.length > MAX_WATCH_LAYER_PROFILE_IMAGES) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_LIMIT_EXCEEDED,
      `A profile may contain at most ${MAX_WATCH_LAYER_PROFILE_IMAGES} cropped layer images`,
      "$.layerInputs",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }

  const inputs = normalizePresentationLayerInputs(layerInputs);
  const selected = [];
  const zOrders = new Set([RECONSTRUCTED_BACKGROUND_Z_ORDER]);
  for (const id of selectedIds) {
    const input = inputs.get(id);
    if (input === undefined) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
        `Approved presentation layer ${id} has no raster input`,
        "$.layerInputs",
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    const moving = movingSet.has(id);
    if (
      moving
      && (
        input.record.disposition !== "approved-moving"
        || input.record.motionProfileId === undefined
        || input.record.approvalIds.length === 0
      )
    ) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_LAYER_FORBIDDEN,
        `Layer ${id} is not approved for independent motion`,
        `${input.path}.record.disposition`,
        LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
      );
    }
    if (
      !moving
      && (
        input.record.disposition !== "static"
        || input.record.motionProfileId !== undefined
        || input.record.approvalIds.length === 0
      )
    ) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_LAYER_FORBIDDEN,
        `Layer ${id} is not an explicitly approved static occluder`,
        `${input.path}.record.disposition`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    if (zOrders.has(input.record.zOrder)) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
        "Presentation background and layer z-orders must form a unique total order",
        `${input.path}.record.zOrder`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    zOrders.add(input.record.zOrder);
    const mask = normalizeProfileMask(input.mask, `${input.path}.mask`);
    const raster = extractMaskedRgba({
      mask,
      source: canonicalSource,
      sourceRect: input.record.sourceRect,
    });
    if (
      raster.sourceRect === null
      || raster.sourceVisiblePixelCount !== input.record.sourceVisiblePixelCount
    ) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_IDENTITY_MISMATCH,
        `Layer ${id} source-visible coverage differs from its approved record`,
        `${input.path}.record.sourceVisiblePixelCount`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    selected.push(Object.freeze({
      id,
      moving,
      raster: normalizeProfileRgba(raster, `${input.path}.extractedRaster`),
      record: input.record,
    }));
  }
  return Object.freeze(selected.sort((left, right) => (
    left.record.zOrder - right.record.zOrder || lexicalCompare(left.id, right.id)
  )));
}

function selectRuntimeMotionProfiles(selectedPhase, motionProfiles, selectedLayers) {
  if (!Array.isArray(motionProfiles)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
      "Motion profile inputs must be an array",
      "$.motionProfiles",
      LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
    );
  }
  if (selectedPhase === "static-layered-reconstruction") return Object.freeze([]);

  const byId = new Map();
  for (let index = 0; index < motionProfiles.length; index += 1) {
    const profile = MOTION_PROFILE_SCHEMA.parse(motionProfiles[index]);
    if (byId.has(profile.id)) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_INPUT_INVALID,
        "Motion profile inputs must use unique IDs",
        `$.motionProfiles[${index}].id`,
        LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
      );
    }
    byId.set(profile.id, profile);
  }

  const selectedProfiles = [];
  for (const layer of selectedLayers) {
    if (!layer.moving) continue;
    const profile = byId.get(layer.record.motionProfileId);
    if (
      profile === undefined
      || profile.layerId !== layer.id
      || !layer.record.approvalIds.includes(profile.approvalId)
    ) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_LAYER_FORBIDDEN,
        `Approved moving layer ${layer.id} lacks its exact approved motion profile`,
        `$.motionProfiles.${String(layer.record.motionProfileId)}`,
        LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
      );
    }
    selectedProfiles.push(profile);
  }
  return Object.freeze(selectedProfiles);
}

function targetProfileDimensions(sourceRect, profile) {
  const spec = WATCH_LAYER_PROFILE_SPECS[profile];
  return Object.freeze({
    height: Math.max(1, Math.round(sourceRect.height * spec.sourceScale)),
    width: Math.max(1, Math.round(sourceRect.width * spec.sourceScale)),
  });
}

function inspectWebpSignature(bytes, path) {
  if (
    bytes.byteLength < 12
    || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.byteLength
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_IDENTITY_MISMATCH,
      "Finalized presentation asset must have one complete RIFF WebP signature",
      path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  return bytes.subarray(0, 12).toString("hex");
}

async function encodePresentationAsset({
  layerId,
  profile,
  raster,
  sourceRect,
  zOrder,
}) {
  const dimensions = targetProfileDimensions(sourceRect, profile);
  let pipeline = sharp(raster.data, {
    failOn: "error",
    limitInputPixels: raster.width * raster.height,
    raw: { channels: 4, height: raster.height, width: raster.width },
    sequentialRead: true,
  })
    .toColourspace(WATCH_LAYER_WEBP_ENCODER.colourspace)
    .ensureAlpha();
  if (dimensions.width !== raster.width || dimensions.height !== raster.height) {
    pipeline = pipeline.resize({
      fastShrinkOnLoad: false,
      fit: "fill",
      height: dimensions.height,
      kernel: sharp.kernel.lanczos3,
      width: dimensions.width,
    });
  }

  let bytes;
  try {
    bytes = await pipeline.webp({
      alphaQuality: WATCH_LAYER_WEBP_ENCODER.alphaQuality,
      effort: WATCH_LAYER_WEBP_ENCODER.effort,
      nearLossless: WATCH_LAYER_WEBP_ENCODER.nearLossless,
      quality: WATCH_LAYER_WEBP_ENCODER.quality,
      smartSubsample: WATCH_LAYER_WEBP_ENCODER.smartSubsample,
    }).toBuffer();
  } catch {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_ENCODE_FAILED,
      "Presentation WebP encoding failed within the approved finite settings",
      `$.profiles.${profile}.${layerId}`,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }

  const file = `${CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/${profile}/${layerId}.webp`;
  const magicSignatureHex = inspectWebpSignature(bytes, file);
  let metadata;
  let decoded;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: dimensions.width * dimensions.height,
      sequentialRead: true,
    }).metadata();
    decoded = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: dimensions.width * dimensions.height,
      sequentialRead: true,
    })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_IDENTITY_MISMATCH,
      "Finalized presentation WebP could not be decoded for identity inspection",
      file,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  if (
    metadata.format !== "webp"
    || metadata.width !== dimensions.width
    || metadata.height !== dimensions.height
    || metadata.space !== "srgb"
    || (metadata.pages !== undefined && metadata.pages !== 1)
    || decoded.info.width !== dimensions.width
    || decoded.info.height !== dimensions.height
    || decoded.info.channels !== 4
    || decoded.data.byteLength !== dimensions.width * dimensions.height * 4
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_IDENTITY_MISMATCH,
      "Finalized presentation WebP metadata differs from its approved profile",
      file,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }

  const record = PUBLIC_ASSET_RECORD_SCHEMA.parse({
    byteLength: bytes.byteLength,
    colorMetadata: {
      alpha: true,
      channels: decoded.info.channels,
      colourspace: "srgb",
    },
    decodedPixelCount: dimensions.width * dimensions.height,
    decodedRgbaByteLength: decoded.data.byteLength,
    encoder: WATCH_LAYER_WEBP_ENCODER,
    file,
    id: `${profile}-${layerId}`,
    intrinsicHeight: dimensions.height,
    intrinsicWidth: dimensions.width,
    layerId,
    magicSignatureHex,
    mediaType: "image/webp",
    profile,
    publicPath: `/${file.slice("public/".length)}`,
    sha256: sha256(bytes),
    sourceRect,
    zOrder,
  });
  return Object.freeze({ bytes: Buffer.from(bytes), record });
}

function assertFinalProfileBudget(profile, runtimeManifestByteLength) {
  const limits = ENHANCEMENT_BUDGETS[profile.id];
  if (
    profile.requestCountIncludingManifest > ENHANCEMENT_BUDGETS.maxRequestsIncludingRuntimeManifest
    || profile.decodedRgbaBytes > limits.maxDecodedRgbaBytes
    || profile.transferBytes + runtimeManifestByteLength > limits.maxTransferBytes
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_BUDGET_EXCEEDED,
      `Finalized ${profile.id} profile exceeds its request, transfer, or decoded-memory budget`,
      `$.profiles.${profile.id}`,
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
}

async function stageGeneratedPresentationFiles(stagingDirectory, files) {
  if (typeof stagingDirectory !== "string" || stagingDirectory.length === 0) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
      "stagingDirectory must be a nonempty path when supplied",
      "$.stagingDirectory",
    );
  }
  const root = resolve(stagingDirectory);
  await assertDirectoryIsSafe(root, "Presentation staging directory");
  const expectedFiles = new Map(files.map(({ bytes, path }) => [path, bytes]));
  await assertStagedBytes(root, new Map());
  for (const [path, bytes] of expectedFiles) await writeStagedFile(root, path, bytes);
  await assertStagedBytes(root, expectedFiles);
  return root;
}

/**
 * Generate only a complete staged presentation profile. The checked-in package calls
 * this with fallback-only, while tests may supply isolated approved synthetic rasters.
 */
export async function generateWatchLayerPresentationProfiles({
  approvedMovingLayerIds = [],
  approvedStaticOccluderLayerIds = [],
  canonicalSource,
  layerInputs = [],
  motionProfiles = [],
  packageId,
  reconstructedBackground,
  releaseId,
  selectedPhase = "fallback-only",
  stagingDirectory,
} = {}) {
  if (selectedPhase === "fallback-only") {
    const files = Object.freeze([]);
    const stagedAt = stagingDirectory === undefined
      ? null
      : await stageGeneratedPresentationFiles(stagingDirectory, files);
    return deepFreeze({
      files,
      profiles: null,
      publicAssets: [],
      releaseStatus: "fallback-only",
      runtimeManifest: null,
      runtimeManifestIdentity: null,
      selectedPhase,
      stagingDirectory: stagedAt,
    });
  }
  if (
    selectedPhase !== "static-layered-reconstruction"
    && selectedPhase !== "approved-part-motion"
  ) {
    fail(
      selectedPhase === "optional-depth"
        ? WATCH_LAYER_BUILD_ISSUE_CODES.DEPTH_FORBIDDEN
        : WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_PHASE_INVALID,
      "Task 6.2 supports only approved static-layered or motion presentation phases",
      "$.selectedPhase",
      selectedPhase === "optional-depth"
        ? LAYER_GATE_FAILURE_CODES.DEPTH_INVALID
        : LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }

  const source = normalizeProfileRgba(
    canonicalSource,
    "$.canonicalSource",
    { canonical: true, opaque: true },
  );
  const background = normalizeProfileRgba(
    reconstructedBackground,
    "$.reconstructedBackground",
    { canonical: true, opaque: true },
  );
  const selectedLayers = selectPresentationLayers({
    approvedMovingLayerIds,
    approvedStaticOccluderLayerIds,
    canonicalSource: source,
    layerInputs,
  });
  const selectedMotionProfiles = selectRuntimeMotionProfiles(
    selectedPhase,
    motionProfiles,
    selectedLayers,
  );

  const files = [];
  const assetsByProfile = {};
  const canonicalRect = Object.freeze({
    height: CANONICAL_SOURCE_COORDINATE_SPACE.height,
    width: CANONICAL_SOURCE_COORDINATE_SPACE.width,
    x: 0,
    y: 0,
  });
  for (const profile of WATCH_LAYER_PROFILE_IDS) {
    const encoded = [];
    encoded.push(await encodePresentationAsset({
      layerId: "reconstructed-background",
      profile,
      raster: background,
      sourceRect: canonicalRect,
      zOrder: RECONSTRUCTED_BACKGROUND_Z_ORDER,
    }));
    for (const layer of selectedLayers) {
      encoded.push(await encodePresentationAsset({
        layerId: layer.id,
        profile,
        raster: layer.raster,
        sourceRect: layer.record.sourceRect,
        zOrder: layer.record.zOrder,
      }));
    }
    assetsByProfile[profile] = Object.freeze(encoded.map(({ record }) => record));
    for (const { bytes, record } of encoded) {
      const identity = fileIdentity(record.file, bytes);
      if (
        identity.sha256 !== record.sha256
        || identity.byteLength !== record.byteLength
        || bytes.subarray(0, 12).toString("hex") !== record.magicSignatureHex
      ) {
        fail(
          WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_IDENTITY_MISMATCH,
          "Finalized presentation bytes differ from their recorded identity",
          record.file,
          LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        );
      }
      files.push(Object.freeze({ bytes, identity, path: record.file }));
    }
  }

  const runtimeManifest = RUNTIME_MANIFEST_SCHEMA.parse({
    canonicalMasterSha256: APPROVED_MASTER_IDENTITY.sha256,
    depthProfiles: [],
    motionProfiles: selectedMotionProfiles,
    packageId,
    phase: selectedPhase,
    profiles: Object.fromEntries(WATCH_LAYER_PROFILE_IDS.map((profile) => {
      const assets = assetsByProfile[profile];
      return [profile, {
        assets,
        decodedRgbaBytes: assets.reduce(
          (total, asset) => total + asset.decodedRgbaByteLength,
          0,
        ),
        id: profile,
        requestCountIncludingManifest: assets.length + 1,
        sourceScale: WATCH_LAYER_PROFILE_SPECS[profile].sourceScale,
        transferBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
      }];
    })),
    releaseId,
    schemaVersion: 1,
  });
  const runtimeManifestBytes = RUNTIME_MANIFEST_SCHEMA.serializeLine(runtimeManifest);
  const runtimeManifestFileIdentity = fileIdentity(
    WATCH_LAYER_RUNTIME_MANIFEST_PATH,
    runtimeManifestBytes,
  );
  const runtimeManifestIdentity = Object.freeze({
    byteLength: runtimeManifestFileIdentity.byteLength,
    file: runtimeManifestFileIdentity.path,
    mediaType: "application/json",
    publicPath: `/${runtimeManifestFileIdentity.path.slice("public/".length)}`,
    sha256: runtimeManifestFileIdentity.sha256,
  });
  for (const profile of WATCH_LAYER_PROFILE_IDS) {
    assertFinalProfileBudget(runtimeManifest.profiles[profile], runtimeManifestBytes.byteLength);
  }
  files.push(Object.freeze({
    bytes: runtimeManifestBytes,
    identity: runtimeManifestFileIdentity,
    path: WATCH_LAYER_RUNTIME_MANIFEST_PATH,
  }));
  files.sort((left, right) => lexicalCompare(left.path, right.path));
  const stagedAt = stagingDirectory === undefined
    ? null
    : await stageGeneratedPresentationFiles(stagingDirectory, files);
  return deepFreeze({
    files,
    profiles: runtimeManifest.profiles,
    publicAssets: WATCH_LAYER_PROFILE_IDS.flatMap((profile) => assetsByProfile[profile]),
    releaseStatus: "ready",
    runtimeManifest,
    runtimeManifestIdentity,
    selectedPhase,
    stagingDirectory: stagedAt,
  });
}

function createStagedDocuments(inputs, predecessorResult, presentation) {
  if (
    presentation.releaseStatus !== inputs.normalized.releaseStatus
    || canonicalJsonStringify(presentation.publicAssets)
      !== canonicalJsonStringify(inputs.manifest.publicAssets)
    || canonicalJsonStringify(presentation.runtimeManifestIdentity)
      !== canonicalJsonStringify(inputs.manifest.runtimeManifest)
  ) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.PROFILE_IDENTITY_MISMATCH,
      "Generated presentation output differs from the normalized package manifest",
      "$.presentation",
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  const packageBytes = LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(inputs.manifest);
  const packageIdentity = fileIdentity(STAGED_WATCH_LAYER_PACKAGE_PATH, packageBytes);
  const inputSnapshotBytes = serializeCanonicalJsonLine(inputs.immutableSnapshot);
  const inputSnapshotIdentity = fileIdentity(
    WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH,
    inputSnapshotBytes,
  );
  const metadata = canonicalizeJson({
    approvedMovingLayerIds: inputs.normalized.approvedMovingLayerIds,
    authoring: inputs.authoringIdentity,
    buildKind: "isolated-package-stage",
    depthEnabled: false,
    evidenceIndex: inputs.evidenceIdentity,
    generator: "scripts/build-watch-layer-assets.mjs",
    immutableInputSnapshot: {
      file: inputSnapshotIdentity,
      snapshotSha256: inputs.immutableSnapshot.snapshotSha256,
    },
    mode: inputs.normalized.mode,
    normalizedInputs: inputs.normalizedIdentity,
    package: packageIdentity,
    phaseProjections: inputs.manifest.phases.map((phase) => ({
      name: phase.name,
      ordinal: phase.ordinal,
      phasePayloadSha256: phase.phasePayloadSha256,
      status: phase.status,
    })),
    predecessor: {
      derivativeCount: inputs.predecessorDerivativeCount,
      manifestSha256: PREDECESSOR_MANIFEST_IDENTITY.sha256,
      masterSha256: predecessorResult.master.sha256,
    },
    publicAssets: presentation.publicAssets,
    releaseStatus: presentation.releaseStatus,
    runtimeManifest: presentation.runtimeManifestIdentity,
    schemaVersion: 1,
    sourceDateEpoch: inputs.manifest.sourceDateEpoch,
  });
  const metadataBytes = serializeCanonicalJsonLine(metadata);
  const metadataIdentity = fileIdentity(WATCH_LAYER_BUILD_METADATA_PATH, metadataBytes);
  const expectedFiles = new Map(presentation.files.map(({ bytes, path }) => [path, bytes]));
  for (const [path, bytes] of [
    [STAGED_WATCH_LAYER_PACKAGE_PATH, packageBytes],
    [WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH, inputSnapshotBytes],
    [WATCH_LAYER_BUILD_METADATA_PATH, metadataBytes],
  ]) {
    if (expectedFiles.has(path)) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.STAGE_INVALID,
        "Presentation output collides with deterministic package metadata",
        path,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    expectedFiles.set(path, bytes);
  }
  return deepFreeze({
    expectedFiles,
    inputSnapshotIdentity,
    metadata,
    metadataIdentity,
    packageIdentity,
  });
}

/**
 * Build a strict canonical package into a fresh isolated directory. This command
 * stages complete approved profiles when present but never publishes or alters release state.
 */
export async function buildWatchLayerAssets({
  beforeStageCommit,
  projectRoot = DEFAULT_PROJECT_ROOT,
  stagingDirectory,
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
      "projectRoot must be a nonempty path",
      "$.projectRoot",
    );
  }
  if (beforeStageCommit !== undefined && typeof beforeStageCommit !== "function") {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
      "beforeStageCommit must be a function when supplied",
      "$.beforeStageCommit",
    );
  }
  const root = resolve(projectRoot);
  return withWatchLayerBuildNetworkDisabled(async () => {
    // This is deliberately the first project inspection performed by the builder.
    const predecessorResult = await verifyPredecessorFirst(root);
    await Promise.all([
      assertApprovedMasterIdentity({ projectRoot: root }),
      assertPredecessorManifestIdentity({ projectRoot: root }),
      inspectApprovedDependencyFields({ projectRoot: root }),
    ]);
    const outputSnapshot = await snapshotCurrentOutputs(root);
    const inputs = await inspectBuildInputs(root, predecessorResult, outputSnapshot);
    const presentation = await generateWatchLayerPresentationProfiles({
      selectedPhase: inputs.normalized.releaseStatus,
    });
    const staged = createStagedDocuments(inputs, predecessorResult, presentation);
    const location = await createStageLocation(root, stagingDirectory);
    let committed = false;

    try {
      for (const [path, bytes] of staged.expectedFiles) {
        await writeStagedFile(location.workingDirectory, path, bytes);
      }
      await assertStagedBytes(location.workingDirectory, staged.expectedFiles);
      if (beforeStageCommit !== undefined) {
        await beforeStageCommit(Object.freeze({
          projectRoot: root,
          workingDirectory: location.workingDirectory,
        }));
      }
      await assertInputHashSnapshotUnchanged(inputs.immutableSnapshot, {
        allowPublic: true,
        projectRoot: root,
      });
      await assertCurrentOutputsUnchanged(root, outputSnapshot);
      await assertStagedBytes(location.workingDirectory, staged.expectedFiles);
      await verifyPredecessorFirst(root);
      await Promise.all([
        assertApprovedMasterIdentity({ projectRoot: root }),
        assertPredecessorManifestIdentity({ projectRoot: root }),
        inspectApprovedDependencyFields({ projectRoot: root }),
      ]);
      await assertInputHashSnapshotUnchanged(inputs.immutableSnapshot, {
        allowPublic: true,
        projectRoot: root,
      });
      await assertCurrentOutputsUnchanged(root, outputSnapshot);
      await rename(location.workingDirectory, location.destinationDirectory);
      committed = true;
      return deepFreeze({
        approvedMovingLayerIds: inputs.normalized.approvedMovingLayerIds,
        depthEnabled: false,
        inputSnapshotIdentity: staged.inputSnapshotIdentity,
        metadataIdentity: staged.metadataIdentity,
        mode: inputs.normalized.mode,
        packageIdentity: staged.packageIdentity,
        packagePath: resolve(
          location.destinationDirectory,
          STAGED_WATCH_LAYER_PACKAGE_PATH,
        ),
        publicAssets: presentation.publicAssets,
        releaseStatus: presentation.releaseStatus,
        runtimeManifest: presentation.runtimeManifestIdentity,
        stagingDirectory: location.destinationDirectory,
      });
    } finally {
      if (!committed) {
        await rm(location.workingDirectory, { force: true, recursive: true });
        if (location.removeOwnerOnFailure) {
          await rm(location.ownerDirectory, { force: true, recursive: true });
        }
      }
    }
  });
}

export const stageWatchLayerPackage = buildWatchLayerAssets;

export function parseWatchLayerBuildArguments(argv) {
  if (!Array.isArray(argv)) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
      "CLI arguments must be an array",
      "$.argv",
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      if (parsed.help) {
        fail(WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID, "--help may appear only once", flag);
      }
      parsed.help = true;
      continue;
    }
    const field = flag === "--project-root"
      ? "projectRoot"
      : flag === "--staging-directory"
        ? "stagingDirectory"
        : null;
    if (field === null || parsed[field] !== undefined) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
        `Unknown or repeated argument ${String(flag)}`,
        String(flag),
      );
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      fail(
        WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
        `${flag} requires one path value`,
        flag,
      );
    }
    parsed[field] = value;
    index += 1;
  }
  if (parsed.help && Object.keys(parsed).length !== 1) {
    fail(
      WATCH_LAYER_BUILD_ISSUE_CODES.ARGUMENT_INVALID,
      "--help cannot be combined with other arguments",
      "--help",
    );
  }
  return Object.freeze(parsed);
}

const USAGE = `Usage:\n  node scripts/build-watch-layer-assets.mjs [--project-root <path>] [--staging-directory <path>]\n\nStages a canonical watch-layer package plus any complete approved compact/expanded profiles.\nThe command never publishes data/watch-layer-package.json or changes the release pointer; fallback-only stages no successor profile or runtime asset.`;

function formatFailure(error) {
  if (error && typeof error === "object" && "code" in error) {
    const issue = "issueCode" in error ? `/${String(error.issueCode)}` : "";
    const message = "message" in error ? String(error.message) : "Watch-layer build failed";
    return `${String(error.code)}${issue}: ${message}`;
  }
  return `${LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function runWatchLayerBuildCli(argv = process.argv.slice(2)) {
  const parsed = parseWatchLayerBuildArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return null;
  }
  const result = await buildWatchLayerAssets({
    projectRoot: parsed.projectRoot ?? DEFAULT_PROJECT_ROOT,
    stagingDirectory: parsed.stagingDirectory,
  });
  console.log(
    `WATCH_LAYER_PACKAGE_STAGED ${result.mode} ${result.packageIdentity.sha256} ${result.stagingDirectory}`,
  );
  return result;
}

async function main() {
  try {
    await runWatchLayerBuildCli();
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  await main();
}
