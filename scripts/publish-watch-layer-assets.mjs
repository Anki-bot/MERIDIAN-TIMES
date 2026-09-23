import { randomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGED_WATCH_LAYER_PACKAGE_PATH,
  WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH,
  WATCH_LAYER_BUILD_METADATA_PATH,
} from "./build-watch-layer-assets.mjs";
import {
  CANONICAL_PROJECT_PATHS,
  DEFAULT_PROJECT_ROOT,
  LAYER_ASSET_MANIFEST_SCHEMA,
  LAYER_GATE_FAILURE_CODES,
  RELEASE_POINTER_SCHEMA,
  RUNTIME_MANIFEST_SCHEMA,
  canonicalJsonStringify,
  canonicalizeJson,
  parseCanonicalJson,
  serializeCanonicalJsonLine,
  sha256,
} from "./watch-2-5d/contract.mjs";
import { verifyWatchLayerAssets } from "./verify-watch-layer-assets.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const PUBLIC_CONTAINER_PATH = dirname(
  CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
);
const DATA_DIRECTORY_PATH = dirname(CANONICAL_PROJECT_PATHS.successorRelease);
const LOCK_DIRECTORY_PATH = `${PUBLIC_CONTAINER_PATH}/.publish-lock`;
const LOCK_OWNER_PATH = `${LOCK_DIRECTORY_PATH}/owner.json`;
const PUBLIC_BACKUP_PATH = `${PUBLIC_CONTAINER_PATH}/.v1.publish-backup`;
const PACKAGE_BACKUP_PATH = `${DATA_DIRECTORY_PATH}/.watch-layer-package.publish-backup.json`;
const PACKAGE_NEXT_PATH = `${DATA_DIRECTORY_PATH}/.watch-layer-package.publish-next.json`;
const RELEASE_BACKUP_PATH = `${DATA_DIRECTORY_PATH}/.watch-layer-release.publish-backup.json`;
const RELEASE_NEXT_PATH = `${DATA_DIRECTORY_PATH}/.watch-layer-release.publish-next.json`;
const JOURNAL_PATH = `${DATA_DIRECTORY_PATH}/.watch-layer-publication.json`;
const JOURNAL_NEXT_PATH = `${DATA_DIRECTORY_PATH}/.watch-layer-publication.next.json`;
const RELEASE_HISTORY_APPROVALS = new Set(["approved", "pending", "rejected"]);
const RELEASE_STATUSES = new Set(["fallback-only", "ready"]);
const DELIVERY_PHASE_NAMES = Object.freeze([
  "source-preparation",
  "static-layered-reconstruction",
  "approved-part-motion",
  "optional-depth",
]);
const RUNTIME_PHASES = new Set(DELIVERY_PHASE_NAMES.slice(1));
const HEX_64 = /^[a-f\d]{64}$/u;
const SUPPORTED_PACKAGE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export const WATCH_LAYER_RELEASE_HISTORY_PATH =
  CANONICAL_PROJECT_PATHS.successorReleaseHistory;
export const WATCH_LAYER_PUBLICATION_LOCK_PATH = LOCK_DIRECTORY_PATH;
export const WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH = LOCK_OWNER_PATH;

/**
 * Every regular-path step below is injectable while rollback material and lock
 * ownership are still intact. Stale-lock validation is conditional and tested
 * separately through the same onStep hook.
 */
export const WATCH_LAYER_PUBLICATION_STEPS = Object.freeze([
  "prepared-lock-owner",
  "acquired-publication-lock",
  "recovered-stale-state",
  "verified-current-release",
  "verified-staged-release",
  "synced-staged-release",
  "prepared-transaction",
  "backed-up-public-release",
  "installed-public-release",
  "installed-package-manifest",
  "verified-published-release",
  "committed-release-pointer",
  "cleaned-staging-directory",
  "releasing-publication-lock",
  "cleaning-publication-transaction",
]);

export const WATCH_LAYER_STALE_LOCK_STEPS = Object.freeze([
  "validated-stale-lock",
]);

export const WATCH_LAYER_PUBLISH_ISSUE_CODES = Object.freeze({
  ARGUMENT_INVALID: "LAYER_PUBLISH_ARGUMENT_INVALID",
  CROSS_DEVICE: "LAYER_PUBLISH_CROSS_DEVICE",
  HISTORY_INVALID: "LAYER_PUBLISH_HISTORY_INVALID",
  INTERRUPTED: "LAYER_PUBLISH_INTERRUPTED",
  LOCKED: "LAYER_PUBLISH_LOCKED",
  LOCK_OWNERSHIP_LOST: "LAYER_PUBLISH_LOCK_OWNERSHIP_LOST",
  MONOTONIC_VERSION_INVALID: "LAYER_PUBLISH_MONOTONIC_VERSION_INVALID",
  OUTPUT_CHANGED: "LAYER_PUBLISH_OUTPUT_CHANGED",
  RECOVERY_FAILED: "LAYER_PUBLISH_RECOVERY_FAILED",
  STAGE_INCOMPLETE: "LAYER_PUBLISH_STAGE_INCOMPLETE",
  STAGE_INVALID: "LAYER_PUBLISH_STAGE_INVALID",
  SYNC_FAILED: "LAYER_PUBLISH_SYNC_FAILED",
  VERIFICATION_FAILED: "LAYER_PUBLISH_VERIFICATION_FAILED",
});

export class WatchLayerPublicationError extends Error {
  constructor(
    issueCode,
    message,
    path = "$",
    code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
    cause,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
    this.failure = Object.freeze({ code, issueCode, message, ok: false, path });
    this.issueCode = issueCode;
    this.name = "WatchLayerPublicationError";
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
  cause,
) {
  throw new WatchLayerPublicationError(issueCode, message, path, code, cause);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null
    || typeof value !== "object"
    || Object.isFrozen(value)
    || ArrayBuffer.isView(value)
  ) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseSupportedPackageVersion(value, path) {
  if (typeof value !== "string" || value.length > 128) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.MONOTONIC_VERSION_INVALID,
      "packageVersion must be a bounded supported stable semantic version",
      path,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  const match = SUPPORTED_PACKAGE_VERSION.exec(value);
  if (match === null) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.MONOTONIC_VERSION_INVALID,
      "packageVersion must use canonical MAJOR.MINOR.PATCH semantic-version syntax without prerelease or build metadata",
      path,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  return Object.freeze(match.slice(1));
}

function compareNumericVersionPart(left, right) {
  return left.length !== right.length
    ? left.length < right.length ? -1 : 1
    : lexicalCompare(left, right);
}

export function compareSupportedWatchLayerPackageVersions(left, right) {
  const leftParts = parseSupportedPackageVersion(left, "$.leftPackageVersion");
  const rightParts = parseSupportedPackageVersion(right, "$.rightPackageVersion");
  for (let index = 0; index < leftParts.length; index += 1) {
    const ordering = compareNumericVersionPart(leftParts[index], rightParts[index]);
    if (ordering !== 0) return ordering;
  }
  return 0;
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

function isContainedPath(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function pathsOverlap(left, right) {
  return isContainedPath(left, right) || isContainedPath(right, left);
}

function assertExactFields(value, fields, path) {
  if (!isPlainObject(value)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Publication record must be a plain object",
      path,
    );
  }
  const expected = [...fields].sort(lexicalCompare);
  const actual = Object.keys(value).sort(lexicalCompare);
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      `Publication record fields must equal ${expected.join(", ")}`,
      path,
    );
  }
  return value;
}

function assertNonemptyString(value, path, maximum = 128) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Release-history string must be nonempty, bounded, and free of controls",
      path,
    );
  }
  return value;
}

function assertSha256(value, path) {
  if (typeof value !== "string" || !HEX_64.test(value)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Release-history identity must be a lowercase SHA-256 digest",
      path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  return value;
}

function validateReleaseHistoryEntry(value, index) {
  const path = `$.releases[${index}]`;
  assertExactFields(value, [
    "approvalStatus",
    "depthEnabled",
    "packageId",
    "packageSha256",
    "packageVersion",
    "phase",
    "releaseId",
    "releaseStatus",
    "runtimeManifestSha256",
  ], path);
  if (!RELEASE_HISTORY_APPROVALS.has(value.approvalStatus)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Release-history approvalStatus is unsupported",
      `${path}.approvalStatus`,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  assertNonemptyString(value.packageId, `${path}.packageId`);
  parseSupportedPackageVersion(value.packageVersion, `${path}.packageVersion`);
  assertSha256(value.packageSha256, `${path}.packageSha256`);
  if (!RELEASE_STATUSES.has(value.releaseStatus)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Release-history releaseStatus is unsupported",
      `${path}.releaseStatus`,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  if (typeof value.depthEnabled !== "boolean") {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Release-history depthEnabled must be boolean",
      `${path}.depthEnabled`,
    );
  }

  if (value.releaseStatus === "fallback-only") {
    if (
      value.depthEnabled !== false
      || value.phase !== null
      || value.releaseId !== null
      || value.runtimeManifestSha256 !== null
    ) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
        "Fallback-only history entries must be URL-free and carry no phase, release, runtime hash, or depth",
        path,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
  } else {
    if (!RUNTIME_PHASES.has(value.phase)) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
        "Ready history entry must name one runtime delivery phase",
        `${path}.phase`,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    assertNonemptyString(value.releaseId, `${path}.releaseId`);
    assertSha256(value.runtimeManifestSha256, `${path}.runtimeManifestSha256`);
    if (value.depthEnabled !== (value.phase === "optional-depth")) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
        "Ready history depthEnabled must agree with the optional-depth phase",
        `${path}.depthEnabled`,
        LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
      );
    }
  }
  return canonicalizeJson(value);
}

/** Parse the canonical, unknown-field-rejecting monotonic release history. */
export function parseWatchLayerReleaseHistory(input, options = {}) {
  const value = typeof input === "string" || ArrayBuffer.isView(input)
    ? parseCanonicalJson(input, options)
    : canonicalizeJson(input);
  assertExactFields(value, ["releases", "schemaVersion"], "$");
  if (value.schemaVersion !== 1 || !Array.isArray(value.releases)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Release history must use schemaVersion 1 and a releases array",
      "$",
    );
  }
  const releases = value.releases.map(validateReleaseHistoryEntry);
  const versions = new Set();
  for (let index = 0; index < releases.length; index += 1) {
    const version = releases[index].packageVersion;
    if (versions.has(version)) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
        `Release history contains duplicate packageVersion ${version}`,
        `$.releases[${index}].packageVersion`,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    versions.add(version);
  }
  return deepFreeze({ releases, schemaVersion: 1 });
}

/** Select the semantically newest entry that has an explicit approved decision. */
export function selectNewestApprovedWatchLayerRelease(history) {
  const parsed = parseWatchLayerReleaseHistory(history);
  const approved = parsed.releases
    .filter(({ approvalStatus }) => approvalStatus === "approved")
    .sort((left, right) => compareSupportedWatchLayerPackageVersions(
      left.packageVersion,
      right.packageVersion,
    ));
  if (approved.length === 0) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.MONOTONIC_VERSION_INVALID,
      "Release history contains no fully approved packageVersion",
      "$.releases",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  return approved[approved.length - 1];
}

async function inspectRegularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
      `${label} is missing or unreadable`,
      path,
      LAYER_GATE_FAILURE_CODES.MANIFEST_MISSING,
      error,
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
      `${label} must be a regular non-symlink file`,
      path,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const bytes = await readFile(path);
  return Object.freeze({
    bytes,
    identity: Object.freeze({
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    }),
  });
}

async function inspectOptionalRegularFile(path, label) {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.OUTPUT_CHANGED,
        `${label} must be a regular non-symlink file`,
        path,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    const bytes = await readFile(path);
    return Object.freeze({
      bytes,
      identity: Object.freeze({
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      }),
    });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function collectSafeTree(root) {
  const rootStats = await lstat(root).catch((error) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (rootStats === null) return null;
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
      "Staging root must be a regular non-symlink directory",
      root,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const directories = [];
  const files = [];
  const visit = async (absoluteDirectory, relativeDirectory) => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => lexicalCompare(left.name, right.name));
    for (const entry of entries) {
      const childRelative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const childAbsolute = resolve(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(
          WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
          "Publication trees may not contain symbolic links",
          childRelative,
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        );
      }
      if (entry.isDirectory()) {
        directories.push(childRelative);
        await visit(childAbsolute, childRelative);
      } else if (entry.isFile()) {
        files.push(childRelative);
      } else {
        fail(
          WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
          "Publication trees may contain only regular files and directories",
          childRelative,
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        );
      }
    }
  };
  await visit(root, "");
  return deepFreeze({
    directories: directories.sort(lexicalCompare),
    files: files.sort(lexicalCompare),
  });
}

function expectedDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    let parent = dirname(file);
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  return [...directories].sort(lexicalCompare);
}

function arraysEqual(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function canonicalEqual(left, right) {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function assertStagePathSafe(projectRoot, stagingDirectory) {
  if (typeof stagingDirectory !== "string" || stagingDirectory.length === 0) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
      "stagingDirectory must be a nonempty path",
      "$.stagingDirectory",
    );
  }
  const root = resolve(projectRoot);
  const stage = resolve(stagingDirectory);
  if (stage === root || isContainedPath(stage, root)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
      "Staging directory cannot contain the project root",
      stage,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  for (const projectPath of Object.values(CANONICAL_PROJECT_PATHS)) {
    const reserved = resolve(root, projectPath);
    if (pathsOverlap(stage, reserved)) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
        "Staging directory cannot overlap a canonical project input or output",
        stage,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  return stage;
}

async function readCanonicalStageFile(stage, projectPath, parser) {
  const absolute = resolve(stage, projectPath);
  if (!isContainedPath(stage, absolute)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
      "Staged project path escapes its root",
      projectPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const file = await inspectRegularFile(absolute, projectPath);
  let value;
  try {
    value = parser(file.bytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
      `Staged ${projectPath} is not strict canonical data`,
      projectPath,
      error && typeof error === "object" && "code" in error
        ? error.code
        : LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      error,
    );
  }
  return Object.freeze({ ...file, value });
}

function assertMetadataIdentity(actual, expected, path) {
  if (
    !isPlainObject(actual)
    || actual.path !== expected.path
    || actual.sha256 !== expected.sha256
    || actual.byteLength !== expected.byteLength
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
      "Build metadata identity differs from staged bytes",
      path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
}

function stageIdentity(path, file) {
  return Object.freeze({
    byteLength: file.identity.byteLength,
    path,
    sha256: file.identity.sha256,
  });
}

async function inspectCompleteStage(projectRoot, stagingDirectory) {
  const stage = assertStagePathSafe(projectRoot, stagingDirectory);
  const tree = await collectSafeTree(stage);
  if (tree === null) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
      "Staging directory is missing",
      stage,
      LAYER_GATE_FAILURE_CODES.MANIFEST_MISSING,
    );
  }
  const packageFile = await readCanonicalStageFile(
    stage,
    STAGED_WATCH_LAYER_PACKAGE_PATH,
    (bytes, options) => LAYER_ASSET_MANIFEST_SCHEMA.parseJson(bytes, options),
  );
  const metadataFile = await readCanonicalStageFile(
    stage,
    WATCH_LAYER_BUILD_METADATA_PATH,
    parseCanonicalJson,
  );
  const snapshotFile = await readCanonicalStageFile(
    stage,
    WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH,
    parseCanonicalJson,
  );
  const packageIdentity = stageIdentity(STAGED_WATCH_LAYER_PACKAGE_PATH, packageFile);
  const metadata = metadataFile.value;
  assertExactFields(metadata, [
    "approvedMovingLayerIds",
    "authoring",
    "buildKind",
    "depthEnabled",
    "evidenceIndex",
    "generator",
    "immutableInputSnapshot",
    "mode",
    "normalizedInputs",
    "package",
    "phaseProjections",
    "predecessor",
    "publicAssets",
    "releaseStatus",
    "runtimeManifest",
    "schemaVersion",
    "sourceDateEpoch",
  ], `$.${WATCH_LAYER_BUILD_METADATA_PATH}`);
  if (
    metadata.schemaVersion !== 1
    || metadata.buildKind !== "isolated-package-stage"
    || metadata.generator !== "scripts/build-watch-layer-assets.mjs"
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INVALID,
      "Staged build metadata does not identify the approved isolated builder",
      WATCH_LAYER_BUILD_METADATA_PATH,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  assertMetadataIdentity(metadata.package, packageIdentity, "$.metadata.package");
  assertMetadataIdentity(
    metadata.immutableInputSnapshot?.file,
    stageIdentity(WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH, snapshotFile),
    "$.metadata.immutableInputSnapshot.file",
  );
  if (
    metadata.immutableInputSnapshot.snapshotSha256
      !== snapshotFile.value.snapshotSha256
    || metadata.sourceDateEpoch !== packageFile.value.sourceDateEpoch
    || !canonicalEqual(metadata.publicAssets, packageFile.value.publicAssets)
    || !canonicalEqual(metadata.runtimeManifest, packageFile.value.runtimeManifest)
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
      "Staged build metadata does not close over the package and input snapshot",
      WATCH_LAYER_BUILD_METADATA_PATH,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }

  const inferredStatus = packageFile.value.runtimeManifest === null
    ? "fallback-only"
    : "ready";
  if (metadata.releaseStatus !== inferredStatus) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
      "Staged release status differs from package runtime membership",
      "$.metadata.releaseStatus",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }

  const expectedFiles = [
    STAGED_WATCH_LAYER_PACKAGE_PATH,
    WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH,
    WATCH_LAYER_BUILD_METADATA_PATH,
  ];
  let runtimeFile = null;
  let runtimeManifest = null;
  if (inferredStatus === "fallback-only") {
    if (
      packageFile.value.publicAssets.length !== 0
      || metadata.runtimeManifest !== null
    ) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
        "Fallback-only stage must contain zero runtime identity and public assets",
        STAGED_WATCH_LAYER_PACKAGE_PATH,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
  } else {
    const runtimePath = packageFile.value.runtimeManifest.file;
    runtimeFile = await readCanonicalStageFile(
      stage,
      runtimePath,
      (bytes, options) => RUNTIME_MANIFEST_SCHEMA.parseJson(bytes, options),
    );
    runtimeManifest = runtimeFile.value;
    const observedRuntime = stageIdentity(runtimePath, runtimeFile);
    if (
      observedRuntime.sha256 !== packageFile.value.runtimeManifest.sha256
      || observedRuntime.byteLength !== packageFile.value.runtimeManifest.byteLength
      || runtimeManifest.packageId !== packageFile.value.packageId
    ) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
        "Runtime manifest identity differs from the staged package",
        runtimePath,
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      );
    }
    expectedFiles.push(runtimePath);
    const runtimeAssets = [
      ...runtimeManifest.profiles.compact.assets,
      ...runtimeManifest.profiles.expanded.assets,
    ];
    if (!canonicalEqual(runtimeAssets, packageFile.value.publicAssets)) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
        "Runtime profile membership differs from package publicAssets",
        runtimePath,
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      );
    }
    for (const asset of packageFile.value.publicAssets) {
      const file = await inspectRegularFile(resolve(stage, asset.file), asset.file);
      if (
        file.identity.sha256 !== asset.sha256
        || file.identity.byteLength !== asset.byteLength
      ) {
        fail(
          WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
          "Staged public asset differs from its finalized package identity",
          asset.file,
          LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        );
      }
      expectedFiles.push(asset.file);
    }
  }

  expectedFiles.sort(lexicalCompare);
  const directories = expectedDirectories(expectedFiles);
  if (!arraysEqual(tree.files, expectedFiles) || !arraysEqual(tree.directories, directories)) {
    const all = [...new Set([
      ...tree.files,
      ...expectedFiles,
      ...tree.directories,
      ...directories,
    ])].sort(lexicalCompare);
    const changed = all.find((path) => (
      tree.files.includes(path) !== expectedFiles.includes(path)
      || tree.directories.includes(path) !== directories.includes(path)
    ));
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
      "Staging membership differs from the complete deterministic build plan",
      changed ?? stage,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }

  return deepFreeze({
    metadata,
    packageBytes: packageFile.bytes,
    packageIdentity,
    packageManifest: packageFile.value,
    releaseStatus: inferredStatus,
    runtimeBytes: runtimeFile?.bytes ?? null,
    runtimeManifest,
    stage,
    tree,
  });
}

async function readReleaseHistory(projectRoot) {
  const path = resolve(projectRoot, WATCH_LAYER_RELEASE_HISTORY_PATH);
  const file = await inspectRegularFile(path, WATCH_LAYER_RELEASE_HISTORY_PATH);
  let value;
  try {
    value = parseWatchLayerReleaseHistory(file.bytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
  } catch (error) {
    if (error instanceof WatchLayerPublicationError) throw error;
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Release history is not canonical or valid",
      WATCH_LAYER_RELEASE_HISTORY_PATH,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      error,
    );
  }
  return Object.freeze({ ...file, value });
}

/** Return the latest runtime-capable phase in the one contiguous approved prefix. */
export function selectLatestContiguousApprovedWatchLayerPhase(manifest) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.phases)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Package manifest must contain the canonical delivery-phase sequence",
      "$.phases",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  let nonApprovedSeen = false;
  let selected = null;
  for (let index = 0; index < DELIVERY_PHASE_NAMES.length; index += 1) {
    const phase = manifest.phases[index];
    if (
      !isPlainObject(phase)
      || phase.name !== DELIVERY_PHASE_NAMES[index]
      || phase.ordinal !== index
      || !["approved", "disabled", "pending", "rejected"].includes(phase.status)
    ) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
        "Package phases must use the canonical ordered delivery sequence",
        `$.phases[${index}]`,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    if (phase.status === "approved") {
      if (nonApprovedSeen) {
        fail(
          WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
          "Approved delivery phases must form one contiguous prefix",
          `$.phases[${index}].status`,
          LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        );
      }
      if (RUNTIME_PHASES.has(phase.name)) selected = phase;
    } else {
      nonApprovedSeen = true;
    }
  }
  if (manifest.phases.length !== DELIVERY_PHASE_NAMES.length) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Package manifest must contain exactly four delivery phases",
      "$.phases",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  return selected;
}

function deriveReleaseCandidate(stage, releaseHistory) {
  parseSupportedPackageVersion(
    stage.packageManifest.packageVersion,
    "$.packageVersion",
  );
  const selected = selectNewestApprovedWatchLayerRelease(releaseHistory.value);
  const selectedRuntimePhase = selectLatestContiguousApprovedWatchLayerPhase(
    stage.packageManifest,
  );
  if (
    stage.packageManifest.packageVersion !== selected.packageVersion
    || stage.packageManifest.packageId !== selected.packageId
    || stage.packageIdentity.sha256 !== selected.packageSha256
    || stage.releaseStatus !== selected.releaseStatus
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.MONOTONIC_VERSION_INVALID,
      "Staged package is not the semantically newest fully approved release-history entry",
      WATCH_LAYER_RELEASE_HISTORY_PATH,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }

  if (selected.releaseStatus === "fallback-only") {
    if (
      selectedRuntimePhase !== null
      || stage.runtimeManifest !== null
      || stage.packageManifest.runtimeManifest !== null
      || stage.packageManifest.publicAssets.length !== 0
    ) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
        "Fallback-only candidate must have no approved runtime phase, successor URL, or public asset",
        STAGED_WATCH_LAYER_PACKAGE_PATH,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    const release = RELEASE_POINTER_SCHEMA.parse({
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    });
    return deepFreeze({
      release,
      releaseBytes: RELEASE_POINTER_SCHEMA.serializeLine(release),
      selectedHistory: selected,
      selectedPhase: null,
    });
  }

  const runtimeIdentity = stage.packageManifest.runtimeManifest;
  const runtime = stage.runtimeManifest;
  const phase = selectedRuntimePhase;
  const releaseApproval = phase?.approvalId === undefined
    ? null
    : stage.packageManifest.approvals.find(({ id }) => id === phase.approvalId);
  if (
    runtimeIdentity === null
    || runtime === null
    || phase === null
    || runtime.phase !== phase.name
    || phase.runtimeManifestSha256 !== runtimeIdentity.sha256
    || releaseApproval?.scope !== "release"
    || releaseApproval.decision !== "approved"
    || selected.phase !== phase.name
    || selected.releaseId !== runtime.releaseId
    || selected.runtimeManifestSha256 !== runtimeIdentity.sha256
    || selected.depthEnabled !== (
      phase.name === "optional-depth"
      && stage.packageManifest.depthProfiles.some(({ enabled }) => enabled)
    )
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.HISTORY_INVALID,
      "Ready candidate does not select the latest contiguous approved phase with an exact release decision and runtime binding",
      WATCH_LAYER_RELEASE_HISTORY_PATH,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  const release = RELEASE_POINTER_SCHEMA.parse({
    depthEnabled: selected.depthEnabled,
    packageId: stage.packageManifest.packageId,
    releaseId: runtime.releaseId,
    runtimeManifest: {
      byteLength: runtimeIdentity.byteLength,
      mediaType: runtimeIdentity.mediaType,
      publicPath: runtimeIdentity.publicPath,
      sha256: runtimeIdentity.sha256,
    },
    schemaVersion: 1,
    status: "ready",
  });
  return deepFreeze({
    release,
    releaseBytes: RELEASE_POINTER_SCHEMA.serializeLine(release),
    selectedHistory: selected,
    selectedPhase: phase,
  });
}

async function capturePublicTree(projectRoot) {
  const path = resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory);
  const tree = await collectSafeTree(path);
  if (tree === null) return Object.freeze({ kind: "absent" });
  const files = [];
  for (const projectPath of tree.files) {
    const file = await inspectRegularFile(resolve(path, projectPath), projectPath);
    files.push({
      byteLength: file.identity.byteLength,
      path: projectPath,
      sha256: file.identity.sha256,
    });
  }
  return deepFreeze({ directories: tree.directories, files, kind: "directory" });
}

async function captureCurrentOutputs(projectRoot, releaseHistoryIdentity) {
  const releasePath = resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorRelease);
  const packagePath = resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorPackageManifest);
  const releaseFile = await inspectRegularFile(
    releasePath,
    CANONICAL_PROJECT_PATHS.successorRelease,
  );
  let release;
  try {
    release = RELEASE_POINTER_SCHEMA.parseJson(releaseFile.bytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.OUTPUT_CHANGED,
      "Current release pointer is invalid",
      CANONICAL_PROJECT_PATHS.successorRelease,
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      error,
    );
  }
  const packageFile = await inspectOptionalRegularFile(
    packagePath,
    CANONICAL_PROJECT_PATHS.successorPackageManifest,
  );
  let packageManifest = null;
  if (packageFile !== null) {
    try {
      packageManifest = LAYER_ASSET_MANIFEST_SCHEMA.parseJson(packageFile.bytes, {
        allowTrailingNewline: true,
        requireCanonical: true,
      });
    } catch (error) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.OUTPUT_CHANGED,
        "Current package manifest is invalid",
        CANONICAL_PROJECT_PATHS.successorPackageManifest,
        LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
        error,
      );
    }
  }
  return deepFreeze({
    package: packageFile === null
      ? { kind: "absent" }
      : {
          byteLength: packageFile.identity.byteLength,
          kind: "file",
          sha256: packageFile.identity.sha256,
        },
    packageManifest,
    publicAssets: await capturePublicTree(projectRoot),
    release,
    releaseBytes: Buffer.from(releaseFile.bytes),
    releaseIdentity: releaseFile.identity,
    releaseHistoryIdentity,
  });
}

function assertMonotonicAgainstCurrent(stage, current) {
  parseSupportedPackageVersion(
    stage.packageManifest.packageVersion,
    "$.packageVersion",
  );
  if (current.packageManifest === null) return;
  parseSupportedPackageVersion(
    current.packageManifest.packageVersion,
    "$.current.packageVersion",
  );
  const ordering = compareSupportedWatchLayerPackageVersions(
    stage.packageManifest.packageVersion,
    current.packageManifest.packageVersion,
  );
  if (
    ordering < 0
    || (
      ordering === 0
      && stage.packageIdentity.sha256 !== current.package.sha256
    )
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.MONOTONIC_VERSION_INVALID,
      "Publication cannot select an older semantic packageVersion or replace bytes within one version",
      "$.packageVersion",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
}

function assertEarlierApprovedPhaseAssetsPreserved(stage, current) {
  if (current.packageManifest === null) return;
  const currentByName = new Map(
    current.packageManifest.phases.map((phase) => [phase.name, phase]),
  );
  for (const phase of stage.packageManifest.phases) {
    const previous = currentByName.get(phase.name);
    if (
      phase.status === "approved"
      && previous?.status === "approved"
      && !arraysEqual(phase.assetSha256, previous.assetSha256)
    ) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.OUTPUT_CHANGED,
        `Approved assets for earlier phase ${phase.name} must remain byte-identical`,
        `$.phases.${phase.name}.assetSha256`,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
  }
}

async function copyProjectMember(projectRoot, verificationRoot, projectPath) {
  const source = resolve(projectRoot, projectPath);
  const destination = resolve(verificationRoot, projectPath);
  let sourceStats;
  try {
    sourceStats = await lstat(source);
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.VERIFICATION_FAILED,
      "Verification overlay input is missing",
      projectPath,
      LAYER_GATE_FAILURE_CODES.MANIFEST_MISSING,
      error,
    );
  }
  if (sourceStats.isSymbolicLink()) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.VERIFICATION_FAILED,
      "Verification overlay input may not be a symbolic link",
      projectPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
  await cp(source, destination, {
    dereference: false,
    errorOnExist: true,
    force: false,
    recursive: sourceStats.isDirectory(),
    verbatimSymlinks: true,
  });
}

const VERIFICATION_BASE_MEMBERS = Object.freeze([
  CANONICAL_PROJECT_PATHS.historicalSpecDirectory,
  CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
  CANONICAL_PROJECT_PATHS.globalsCss,
  CANONICAL_PROJECT_PATHS.protectedCanvas,
  CANONICAL_PROJECT_PATHS.dependencyManifest,
  CANONICAL_PROJECT_PATHS.predecessorManifest,
  CANONICAL_PROJECT_PATHS.predecessorPublicAssetsDirectory,
  CANONICAL_PROJECT_PATHS.canonicalMaster,
  CANONICAL_PROJECT_PATHS.successorSourceDirectory,
  "tests/fixtures/glass-header-hover-preservation.sha256",
]);

async function verifyCandidateInOverlay(projectRoot, stage, candidate) {
  const verificationRoot = await mkdtemp(resolve(
    tmpdir(),
    "watch-layer-publication-verify-",
  ));
  try {
    for (const projectPath of VERIFICATION_BASE_MEMBERS) {
      await copyProjectMember(projectRoot, verificationRoot, projectPath);
    }
    await copyProjectMember(
      stage.stage,
      verificationRoot,
      STAGED_WATCH_LAYER_PACKAGE_PATH,
    );
    if (candidate.release.status === "ready") {
      await copyProjectMember(
        stage.stage,
        verificationRoot,
        CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
      );
    }
    const releasePath = resolve(
      verificationRoot,
      CANONICAL_PROJECT_PATHS.successorRelease,
    );
    await mkdir(dirname(releasePath), { recursive: true, mode: 0o755 });
    await writeSyncedExclusive(releasePath, candidate.releaseBytes);
    return await verifyWatchLayerAssets({ projectRoot: verificationRoot });
  } finally {
    await rm(verificationRoot, { force: true, recursive: true });
  }
}

async function verifyInstalledCandidateInOverlay(projectRoot, candidate) {
  const verificationRoot = await mkdtemp(resolve(
    tmpdir(),
    "watch-layer-publication-installed-verify-",
  ));
  try {
    for (const projectPath of VERIFICATION_BASE_MEMBERS) {
      await copyProjectMember(projectRoot, verificationRoot, projectPath);
    }
    await copyProjectMember(
      projectRoot,
      verificationRoot,
      CANONICAL_PROJECT_PATHS.successorPackageManifest,
    );
    if (candidate.release.status === "ready") {
      await copyProjectMember(
        projectRoot,
        verificationRoot,
        CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
      );
    }
    const releasePath = resolve(
      verificationRoot,
      CANONICAL_PROJECT_PATHS.successorRelease,
    );
    await mkdir(dirname(releasePath), { recursive: true, mode: 0o755 });
    await writeSyncedExclusive(releasePath, candidate.releaseBytes);
    return await verifyWatchLayerAssets({ projectRoot: verificationRoot });
  } finally {
    await rm(verificationRoot, { force: true, recursive: true });
  }
}

function validateTestHooks(testHooks) {
  if (testHooks === undefined) return Object.freeze({});
  if (process.env.NODE_ENV !== "test") {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
      "Publication verification hooks are available only in the test environment",
      "$.testHooks",
    );
  }
  assertExactFields(
    testHooks,
    Object.keys(testHooks),
    "$.testHooks",
  );
  const allowed = new Set([
    "onStep",
    "verifyCandidate",
    "verifyCurrent",
    "verifyPublished",
  ]);
  for (const [name, value] of Object.entries(testHooks)) {
    if (!allowed.has(name) || typeof value !== "function") {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
        `Unsupported publication test hook ${name}`,
        `$.testHooks.${name}`,
      );
    }
  }
  return Object.freeze({ ...testHooks });
}

async function requireVerification(operation, path) {
  let result;
  try {
    result = await operation();
  } catch (error) {
    const code = error !== null
      && typeof error === "object"
      && "code" in error
      && typeof error.code === "string"
      ? error.code
      : LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID;
    const detail = error instanceof Error ? `: ${error.message}` : "";
    const errorPath = error !== null
      && typeof error === "object"
      && "path" in error
      && typeof error.path === "string"
      ? error.path
      : path;
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.VERIFICATION_FAILED,
      `Read-only watch-layer verification rejected publication${detail}`,
      errorPath,
      code,
      error,
    );
  }
  if (!isPlainObject(result) || result.ok !== true) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.VERIFICATION_FAILED,
      "Publication verifier must return an explicit successful result",
      path,
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    );
  }
  return result;
}

async function notifyStep(testHooks, step, context) {
  if (testHooks.onStep !== undefined) {
    await testHooks.onStep(step, Object.freeze(context));
  }
}

async function syncFile(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.SYNC_FAILED,
      "Publication file could not be durably synced",
      path,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      error,
    );
  } finally {
    await handle?.close();
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.SYNC_FAILED,
      "Publication directory could not be durably synced",
      path,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      error,
    );
  } finally {
    await handle?.close();
  }
}

async function syncTree(root) {
  const tree = await collectSafeTree(root);
  if (tree === null) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.STAGE_INCOMPLETE,
      "Cannot sync a missing staging tree",
      root,
      LAYER_GATE_FAILURE_CODES.MANIFEST_MISSING,
    );
  }
  for (const file of tree.files) await syncFile(resolve(root, file));
  for (const directory of [...tree.directories].sort((left, right) => (
    right.split("/").length - left.split("/").length
    || lexicalCompare(left, right)
  ))) {
    await syncDirectory(resolve(root, directory));
  }
  await syncDirectory(root);
}

async function writeSyncedExclusive(path, bytes) {
  const handle = await open(path, "wx", 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJournal(projectRoot, journal) {
  const next = resolve(projectRoot, JOURNAL_NEXT_PATH);
  const current = resolve(projectRoot, JOURNAL_PATH);
  await rm(next, { force: true });
  await writeSyncedExclusive(next, serializeCanonicalJsonLine(journal));
  await rename(next, current);
  await syncDirectory(resolve(projectRoot, DATA_DIRECTORY_PATH));
}

async function optionalPathKind(path) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
        "Transaction artifact may not be a symbolic link",
        path,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
      "Transaction artifact has an unsupported file type",
      path,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function removeSafeStage(projectRoot, stagingDirectory) {
  if (typeof stagingDirectory !== "string") return;
  const stage = assertStagePathSafe(projectRoot, stagingDirectory);
  await rm(stage, { force: true, recursive: true });
}

async function recoverInterruptedPublication(projectRoot) {
  const paths = {
    journal: resolve(projectRoot, JOURNAL_PATH),
    journalNext: resolve(projectRoot, JOURNAL_NEXT_PATH),
    package: resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorPackageManifest),
    packageBackup: resolve(projectRoot, PACKAGE_BACKUP_PATH),
    packageNext: resolve(projectRoot, PACKAGE_NEXT_PATH),
    publicAssets: resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory),
    publicBackup: resolve(projectRoot, PUBLIC_BACKUP_PATH),
    release: resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorRelease),
    releaseBackup: resolve(projectRoot, RELEASE_BACKUP_PATH),
    releaseNext: resolve(projectRoot, RELEASE_NEXT_PATH),
  };
  const journalFile = await inspectOptionalRegularFile(paths.journal, JOURNAL_PATH);
  let journal = null;
  if (journalFile !== null) {
    try {
      journal = parseCanonicalJson(journalFile.bytes, {
        allowTrailingNewline: true,
        requireCanonical: true,
      });
      assertExactFields(journal, [
        "candidatePackageSha256",
        "hadPackage",
        "hadPublic",
        "phase",
        "schemaVersion",
        "stagingDirectory",
      ], "$.journal");
      if (
        journal.schemaVersion !== 1
        || !["prepared", "committed"].includes(journal.phase)
        || typeof journal.hadPackage !== "boolean"
        || typeof journal.hadPublic !== "boolean"
        || !HEX_64.test(journal.candidatePackageSha256)
      ) throw new TypeError("Invalid publication journal values");
    } catch (error) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
        "Interrupted publication journal is invalid",
        JOURNAL_PATH,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        error,
      );
    }
  }

  if (journal?.phase === "prepared") {
    if (await optionalPathKind(paths.releaseBackup) === "file") {
      await rename(paths.releaseBackup, paths.release);
    }
    if (await optionalPathKind(paths.packageBackup) === "file") {
      await rm(paths.package, { force: true });
      await rename(paths.packageBackup, paths.package);
    } else if (!journal.hadPackage) {
      const current = await inspectOptionalRegularFile(paths.package, "current package");
      if (current?.identity.sha256 === journal.candidatePackageSha256) {
        await rm(paths.package, { force: true });
      }
    }
    if (await optionalPathKind(paths.publicBackup) === "directory") {
      await rm(paths.publicAssets, { force: true, recursive: true });
      await rename(paths.publicBackup, paths.publicAssets);
    } else if (!journal.hadPublic) {
      await rm(paths.publicAssets, { force: true, recursive: true });
    }
    await removeSafeStage(projectRoot, journal.stagingDirectory);
    await syncDirectory(resolve(projectRoot, DATA_DIRECTORY_PATH));
    await syncDirectory(resolve(projectRoot, PUBLIC_CONTAINER_PATH));
  } else if (journal?.phase === "committed") {
    await removeSafeStage(projectRoot, journal.stagingDirectory);
  }

  for (const path of [
    paths.packageNext,
    paths.releaseNext,
    paths.journalNext,
    paths.packageBackup,
    paths.releaseBackup,
    paths.publicBackup,
    paths.journal,
  ]) {
    await rm(path, { force: true, recursive: true });
  }
  await syncDirectory(resolve(projectRoot, DATA_DIRECTORY_PATH));
  await syncDirectory(resolve(projectRoot, PUBLIC_CONTAINER_PATH));
  return journal !== null;
}

function lockOwnerLiveness(pid) {
  try {
    process.kill(pid, 0);
    return "live";
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error) {
      if (error.code === "EPERM") return "live";
      if (error.code === "ESRCH") return "dead";
    }
    return "indeterminate";
  }
}

function filesystemIdentity(stats) {
  return Object.freeze({ dev: stats.dev, ino: stats.ino });
}

function sameFilesystemIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function inspectPublicationLock(lockPath) {
  let lockStats;
  try {
    lockStats = await lstat(lockPath);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!lockStats.isDirectory() || lockStats.isSymbolicLink()) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
      "Publication lock must be a regular non-symlink directory",
      LOCK_DIRECTORY_PATH,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const ownerPath = resolve(lockPath, "owner.json");
  let ownerStats;
  let ownerBytes;
  try {
    ownerStats = await lstat(ownerPath);
    if (!ownerStats.isFile() || ownerStats.isSymbolicLink()) {
      throw new TypeError("Lock owner must be a regular non-symlink file");
    }
    ownerBytes = await readFile(ownerPath);
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
      "Publication lock has no valid atomically established owner",
      LOCK_OWNER_PATH,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      error,
    );
  }
  let owner;
  try {
    owner = parseCanonicalJson(ownerBytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
    const fields = Object.keys(owner).sort(lexicalCompare);
    if (
      !isPlainObject(owner)
      || !arraysEqual(fields, ["pid", "schemaVersion", "token"])
      || owner.schemaVersion !== 1
      || !Number.isSafeInteger(owner.pid)
      || owner.pid < 1
      || typeof owner.token !== "string"
      || !HEX_64.test(owner.token)
    ) throw new TypeError("Invalid publication lock owner record");
  } catch (error) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
      "Publication lock owner record is malformed or unsupported",
      LOCK_OWNER_PATH,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      error,
    );
  }
  return deepFreeze({
    lockIdentity: filesystemIdentity(lockStats),
    owner: canonicalizeJson(owner),
    ownerIdentity: filesystemIdentity(ownerStats),
  });
}

async function assertExpectedPublicationLock(lockPath, expected, { stale = false } = {}) {
  const observed = await inspectPublicationLock(lockPath);
  if (
    observed === null
    || observed.owner.token !== expected.owner.token
    || !sameFilesystemIdentity(observed.lockIdentity, expected.lockIdentity)
    || !sameFilesystemIdentity(observed.ownerIdentity, expected.ownerIdentity)
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.LOCK_OWNERSHIP_LOST,
      "Publication lock ownership changed; the replacement lock was left untouched",
      LOCK_DIRECTORY_PATH,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
  const liveness = lockOwnerLiveness(observed.owner.pid);
  if (stale && liveness !== "dead") {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.LOCKED,
      "Stale-lock takeover requires the same valid owner token and a definitively dead owner process",
      LOCK_DIRECTORY_PATH,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
  return observed;
}

async function preparePublicationLockOwner(container, testHooks) {
  const token = randomBytes(32).toString("hex");
  const candidate = resolve(container, `.publish-lock-candidate-${token}`);
  await mkdir(candidate, { mode: 0o700 });
  try {
    await writeSyncedExclusive(
      resolve(candidate, "owner.json"),
      serializeCanonicalJsonLine({ pid: process.pid, schemaVersion: 1, token }),
    );
    await syncDirectory(candidate);
    await syncDirectory(container);
    const prepared = await inspectPublicationLock(candidate);
    await notifyStep(testHooks, "prepared-lock-owner", {
      candidatePath: candidate,
      lockPath: resolve(container, ".publish-lock"),
      token,
    });
    return Object.freeze({ candidate, prepared, token });
  } catch (error) {
    await rm(candidate, { force: true, recursive: true });
    throw error;
  }
}

async function acquirePublicationLock(projectRoot, testHooks) {
  const container = resolve(projectRoot, PUBLIC_CONTAINER_PATH);
  const lock = resolve(projectRoot, LOCK_DIRECTORY_PATH);
  await mkdir(container, { recursive: true, mode: 0o755 });
  await syncDirectory(dirname(container));
  const candidate = await preparePublicationLockOwner(container, testHooks);
  let candidatePresent = true;
  let installedHandle = null;
  let staleQuarantine = null;
  try {
    // Inspect first so rename never silently replaces an ownerless empty lock
    // directory. All cooperating publishers install a fully prepared directory,
    // so an absent-to-present race either wins atomically or observes a complete
    // owner record after rename reports a conflict.
    let existing = await inspectPublicationLock(lock);
    if (existing === null) {
      try {
        await rename(candidate.candidate, lock);
        candidatePresent = false;
      } catch (error) {
        existing = await inspectPublicationLock(lock);
        if (existing === null) throw error;
      }
    }

    if (candidatePresent) {
      const liveness = lockOwnerLiveness(existing.owner.pid);
      if (liveness !== "dead") {
        fail(
          WATCH_LAYER_PUBLISH_ISSUE_CODES.LOCKED,
          liveness === "live"
            ? "Another watch-layer publication owns the transaction lock"
            : "Publication lock owner liveness is indeterminate; takeover is blocked",
          LOCK_DIRECTORY_PATH,
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }

      await notifyStep(testHooks, "validated-stale-lock", {
        staleToken: existing.owner.token,
        takeoverToken: candidate.token,
      });
      await assertExpectedPublicationLock(lock, existing, { stale: true });
      staleQuarantine = resolve(
        container,
        `.publish-lock-stale-${existing.owner.token}-${candidate.token}`,
      );
      await rename(lock, staleQuarantine);
      await assertExpectedPublicationLock(staleQuarantine, existing, { stale: true });
      try {
        await rename(candidate.candidate, lock);
        candidatePresent = false;
      } catch (takeoverError) {
        const replacement = await inspectPublicationLock(lock);
        if (replacement === null) {
          await rename(staleQuarantine, lock).catch(() => {});
        } else {
          // The quarantined directory is the already-verified dead owner. It is
          // safe to remove; the concurrently installed replacement is untouched.
          await rm(staleQuarantine, { force: true, recursive: true }).catch(() => {});
        }
        staleQuarantine = null;
        throw takeoverError;
      }
    }

    const owned = await inspectPublicationLock(lock);
    if (
      owned === null
      || owned.owner.token !== candidate.token
      || !sameFilesystemIdentity(owned.lockIdentity, candidate.prepared.lockIdentity)
      || !sameFilesystemIdentity(owned.ownerIdentity, candidate.prepared.ownerIdentity)
    ) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.LOCK_OWNERSHIP_LOST,
        "Atomic lock installation did not retain the prepared ownership token and filesystem identity",
        LOCK_DIRECTORY_PATH,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }
    installedHandle = Object.freeze({ ...owned, lock, token: candidate.token });

    if (staleQuarantine !== null) {
      // Only the exact token/inodes validated above may be removed as stale.
      await assertExpectedPublicationLock(staleQuarantine, existing, { stale: true });
      await rm(staleQuarantine, { force: true, recursive: true });
      staleQuarantine = null;
    }
    await syncDirectory(container);
    return installedHandle;
  } catch (error) {
    if (installedHandle !== null) {
      await releasePublicationLock(projectRoot, installedHandle).catch(() => {});
    }
    throw error;
  } finally {
    if (candidatePresent) {
      await rm(candidate.candidate, { force: true, recursive: true });
    }
  }
}

async function releasePublicationLock(projectRoot, handle) {
  const container = resolve(projectRoot, PUBLIC_CONTAINER_PATH);
  await assertExpectedPublicationLock(handle.lock, handle);
  const retired = resolve(container, `.publish-lock-retired-${handle.token}`);
  await rename(handle.lock, retired);
  try {
    const moved = await inspectPublicationLock(retired);
    if (
      moved === null
      || moved.owner.token !== handle.token
      || !sameFilesystemIdentity(moved.lockIdentity, handle.lockIdentity)
      || !sameFilesystemIdentity(moved.ownerIdentity, handle.ownerIdentity)
    ) {
      if (await inspectPublicationLock(handle.lock) === null) {
        await rename(retired, handle.lock).catch(() => {});
      }
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.LOCK_OWNERSHIP_LOST,
        "Publication lock changed during release; no replacement lock was removed",
        LOCK_DIRECTORY_PATH,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }
    await rm(retired, { force: true, recursive: true });
    await syncDirectory(container);
  } catch (error) {
    if (await inspectPublicationLock(handle.lock) === null) {
      await rename(retired, handle.lock).catch(() => {});
    }
    throw error;
  }
}

async function assertSameFilesystem(stagePublic, publicContainer) {
  const [source, destination] = await Promise.all([
    stat(stagePublic),
    stat(publicContainer),
  ]);
  if (source.dev !== destination.dev) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.CROSS_DEVICE,
      "Staged public directory must share the destination filesystem for atomic rename",
      CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
}

async function assertSnapshotUnchanged(projectRoot, before, historyIdentity) {
  const after = await captureCurrentOutputs(projectRoot, historyIdentity);
  if (canonicalJsonStringify({
    ...after,
    releaseBytes: after.releaseBytes.toString("hex"),
  }) !== canonicalJsonStringify({
    ...before,
    releaseBytes: before.releaseBytes.toString("hex"),
  })) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.OUTPUT_CHANGED,
      "Current release outputs changed during pre-publication verification",
      "$",
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
  const history = await inspectRegularFile(
    resolve(projectRoot, WATCH_LAYER_RELEASE_HISTORY_PATH),
    WATCH_LAYER_RELEASE_HISTORY_PATH,
  );
  if (
    history.identity.sha256 !== historyIdentity.sha256
    || history.identity.byteLength !== historyIdentity.byteLength
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.OUTPUT_CHANGED,
      "Release history changed during pre-publication verification",
      WATCH_LAYER_RELEASE_HISTORY_PATH,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
}

async function assertStageUnchanged(stage) {
  const current = await inspectCompleteStage(dirname(stage.stage), stage.stage);
  if (
    current.packageIdentity.sha256 !== stage.packageIdentity.sha256
    || current.packageIdentity.byteLength !== stage.packageIdentity.byteLength
    || !canonicalEqual(current.metadata, stage.metadata)
    || !arraysEqual(current.tree.files, stage.tree.files)
    || !arraysEqual(current.tree.directories, stage.tree.directories)
  ) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.OUTPUT_CHANGED,
      "Staged output changed during verification",
      stage.stage,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
}

async function prepareTransaction(projectRoot, stage, candidate, current) {
  const dataDirectory = resolve(projectRoot, DATA_DIRECTORY_PATH);
  const releaseBackup = resolve(projectRoot, RELEASE_BACKUP_PATH);
  const packageNext = resolve(projectRoot, PACKAGE_NEXT_PATH);
  const releaseNext = resolve(projectRoot, RELEASE_NEXT_PATH);
  await writeSyncedExclusive(releaseBackup, current.releaseBytes);
  await writeSyncedExclusive(packageNext, stage.packageBytes);
  await writeSyncedExclusive(releaseNext, candidate.releaseBytes);
  const journal = canonicalizeJson({
    candidatePackageSha256: stage.packageIdentity.sha256,
    hadPackage: current.package.kind === "file",
    hadPublic: current.publicAssets.kind === "directory",
    phase: "prepared",
    schemaVersion: 1,
    stagingDirectory: stage.stage,
  });
  await writeJournal(projectRoot, journal);
  await syncDirectory(dataDirectory);
  return journal;
}

async function commitPublication(projectRoot, stage, candidate, current, testHooks) {
  const paths = {
    package: resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorPackageManifest),
    packageBackup: resolve(projectRoot, PACKAGE_BACKUP_PATH),
    packageNext: resolve(projectRoot, PACKAGE_NEXT_PATH),
    publicAssets: resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory),
    publicBackup: resolve(projectRoot, PUBLIC_BACKUP_PATH),
    publicContainer: resolve(projectRoot, PUBLIC_CONTAINER_PATH),
    release: resolve(projectRoot, CANONICAL_PROJECT_PATHS.successorRelease),
    releaseNext: resolve(projectRoot, RELEASE_NEXT_PATH),
  };
  let journal;
  try {
    journal = await prepareTransaction(projectRoot, stage, candidate, current);
    await notifyStep(testHooks, "prepared-transaction", { candidate, stage });

    if (current.publicAssets.kind === "directory") {
      await rename(paths.publicAssets, paths.publicBackup);
      await syncDirectory(paths.publicContainer);
    }
    await notifyStep(testHooks, "backed-up-public-release", { candidate, stage });

    if (candidate.release.status === "ready") {
      const stagedPublic = resolve(
        stage.stage,
        CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
      );
      await rename(stagedPublic, paths.publicAssets);
      await syncDirectory(paths.publicContainer);
    }
    await notifyStep(testHooks, "installed-public-release", { candidate, stage });

    if (current.package.kind === "file") {
      await rename(paths.package, paths.packageBackup);
    }
    await rename(paths.packageNext, paths.package);
    await syncDirectory(resolve(projectRoot, DATA_DIRECTORY_PATH));
    await notifyStep(testHooks, "installed-package-manifest", { candidate, stage });

    // Verify the exact installed package/public bytes against the candidate pointer
    // in an isolated overlay. The live pointer is deliberately still the prior one.
    const publishedVerification = await requireVerification(
      () => testHooks.verifyPublished === undefined
        ? verifyInstalledCandidateInOverlay(projectRoot, candidate)
        : testHooks.verifyPublished({ candidate, projectRoot, stage }),
      CANONICAL_PROJECT_PATHS.successorRelease,
    );
    await notifyStep(testHooks, "verified-published-release", {
      candidate,
      stage,
      verification: publishedVerification,
    });

    await rename(paths.releaseNext, paths.release);
    await syncDirectory(resolve(projectRoot, DATA_DIRECTORY_PATH));
    await notifyStep(testHooks, "committed-release-pointer", { candidate, stage });

    await rm(stage.stage, { force: true, recursive: true });
    await notifyStep(testHooks, "cleaned-staging-directory", { candidate, stage });
    return Object.freeze({ journal, publishedVerification });
  } catch (error) {
    try {
      await recoverInterruptedPublication(projectRoot);
    } catch (recoveryError) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
        "Publication failed and prior release recovery did not complete",
        "$",
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        recoveryError,
      );
    }
    if (error instanceof WatchLayerPublicationError) throw error;
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.INTERRUPTED,
      "Publication was interrupted and the prior release was restored",
      "$",
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      error,
    );
  }
}

/**
 * Publish one complete builder stage. The candidate is verified in an isolated
 * project-root overlay before any live output changes, synced recursively, then
 * exposed by same-filesystem directory rename with the release pointer committed last.
 */
export async function publishWatchLayerAssets({
  projectRoot = DEFAULT_PROJECT_ROOT,
  stagingDirectory,
  testHooks: suppliedTestHooks,
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
      "projectRoot must be a nonempty path",
      "$.projectRoot",
    );
  }
  const root = resolve(projectRoot);
  const stagePath = assertStagePathSafe(root, stagingDirectory);
  const testHooks = validateTestHooks(suppliedTestHooks);
  let lock = null;
  let transaction = null;

  try {
    lock = await acquirePublicationLock(root, testHooks);
    await notifyStep(testHooks, "acquired-publication-lock", {
      lockPath: lock.lock,
      token: lock.token,
    });

    const recoveredStaleState = await recoverInterruptedPublication(root);
    await notifyStep(testHooks, "recovered-stale-state", { recoveredStaleState });

    const releaseHistory = await readReleaseHistory(root);
    const stage = await inspectCompleteStage(root, stagePath);
    const candidate = deriveReleaseCandidate(stage, releaseHistory);
    const current = await captureCurrentOutputs(root, releaseHistory.identity);
    assertMonotonicAgainstCurrent(stage, current);
    assertEarlierApprovedPhaseAssetsPreserved(stage, current);

    const currentVerification = await requireVerification(
      () => testHooks.verifyCurrent === undefined
        ? verifyWatchLayerAssets({ projectRoot: root })
        : testHooks.verifyCurrent({ candidate, current, projectRoot: root, stage }),
      CANONICAL_PROJECT_PATHS.successorRelease,
    );
    await notifyStep(testHooks, "verified-current-release", {
      candidate,
      current,
      stage,
      verification: currentVerification,
    });

    const candidateVerification = await requireVerification(
      () => testHooks.verifyCandidate === undefined
        ? verifyCandidateInOverlay(root, stage, candidate)
        : testHooks.verifyCandidate({ candidate, current, projectRoot: root, stage }),
      stage.stage,
    );
    await notifyStep(testHooks, "verified-staged-release", {
      candidate,
      current,
      stage,
      verification: candidateVerification,
    });

    await assertSnapshotUnchanged(root, current, releaseHistory.identity);
    await assertStageUnchanged(stage);
    await syncTree(stage.stage);
    if (candidate.release.status === "ready") {
      await assertSameFilesystem(
        resolve(stage.stage, CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory),
        resolve(root, PUBLIC_CONTAINER_PATH),
      );
    }
    await notifyStep(testHooks, "synced-staged-release", { candidate, current, stage });

    await assertSnapshotUnchanged(root, current, releaseHistory.identity);
    await assertStageUnchanged(stage);
    transaction = await commitPublication(
      root,
      stage,
      candidate,
      current,
      testHooks,
    );

    // Both hooks execute while rollback backups and owned lock still exist.
    await notifyStep(testHooks, "releasing-publication-lock", {
      candidate,
      lockPath: lock.lock,
      token: lock.token,
    });
    await assertExpectedPublicationLock(lock.lock, lock);
    await notifyStep(testHooks, "cleaning-publication-transaction", {
      candidate,
      stage,
    });
    // No failure-injection boundary remains between this ownership check and
    // transaction cleanup. A replaced/wrong-token lock therefore rolls the
    // complete generation back while every backup is still available.
    await assertExpectedPublicationLock(lock.lock, lock);

    await writeJournal(root, { ...transaction.journal, phase: "committed" });
    await recoverInterruptedPublication(root);
    const publishedVerification = transaction.publishedVerification;
    transaction = null;
    await releasePublicationLock(root, lock);
    lock = null;

    return deepFreeze({
      depthEnabled: candidate.release.depthEnabled,
      packageId: stage.packageManifest.packageId,
      packageSha256: stage.packageIdentity.sha256,
      packageVersion: stage.packageManifest.packageVersion,
      publicDirectoryPublished: candidate.release.status === "ready",
      recoveredStaleState,
      release: candidate.release,
      releaseStatus: candidate.release.status,
      selectedPhase: candidate.selectedPhase?.name ?? null,
      verification: publishedVerification,
    });
  } catch (error) {
    let recoveryError = null;
    if (transaction !== null) {
      try {
        await writeJournal(root, { ...transaction.journal, phase: "prepared" });
        await recoverInterruptedPublication(root);
        transaction = null;
      } catch (caught) {
        recoveryError = caught;
      }
    }
    await rm(stagePath, { force: true, recursive: true }).catch((caught) => {
      recoveryError ??= caught;
    });
    if (lock !== null) {
      await releasePublicationLock(root, lock).catch((caught) => {
        if (
          !(caught instanceof WatchLayerPublicationError)
          || caught.issueCode !== WATCH_LAYER_PUBLISH_ISSUE_CODES.LOCK_OWNERSHIP_LOST
        ) recoveryError ??= caught;
      });
      lock = null;
    }
    if (recoveryError !== null) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.RECOVERY_FAILED,
        "Publication failed and complete prior-state recovery did not finish",
        "$",
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        recoveryError,
      );
    }
    if (error instanceof WatchLayerPublicationError) throw error;
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.INTERRUPTED,
      "Publication was interrupted and the prior release was restored",
      "$",
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      error,
    );
  }
}

export const publishWatchLayers = publishWatchLayerAssets;

export function parseWatchLayerPublishArguments(argv) {
  if (!Array.isArray(argv)) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
      "CLI arguments must be an array",
      "$.argv",
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      if (parsed.help) {
        fail(
          WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
          "--help may appear only once",
          flag,
        );
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
        WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
        `Unknown or repeated argument ${String(flag)}`,
        String(flag),
      );
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      fail(
        WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
        `${flag} requires one path value`,
        flag,
      );
    }
    parsed[field] = value;
    index += 1;
  }
  if (parsed.help && Object.keys(parsed).length !== 1) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
      "--help cannot be combined with other arguments",
      "--help",
    );
  }
  if (!parsed.help && parsed.stagingDirectory === undefined) {
    fail(
      WATCH_LAYER_PUBLISH_ISSUE_CODES.ARGUMENT_INVALID,
      "--staging-directory is required",
      "--staging-directory",
    );
  }
  return Object.freeze(parsed);
}

const USAGE = `Usage:\n  node scripts/publish-watch-layer-assets.mjs --staging-directory <path> [--project-root <path>]\n\nVerifies and atomically publishes the semantically newest fully approved watch-layer stage. The stage is consumed on success or failure; fallback-only publishes no successor URL or public directory.`;

function formatFailure(error) {
  if (error && typeof error === "object" && "code" in error) {
    const issue = "issueCode" in error ? `/${String(error.issueCode)}` : "";
    const path = "path" in error ? ` [${String(error.path)}]` : "";
    const message = error instanceof Error ? error.message : "Watch-layer publication failed";
    return `${String(error.code)}${issue}: ${message}${path}`;
  }
  return `${LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function runWatchLayerPublishCli(argv = process.argv.slice(2)) {
  const parsed = parseWatchLayerPublishArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return null;
  }
  const result = await publishWatchLayerAssets({
    projectRoot: parsed.projectRoot ?? DEFAULT_PROJECT_ROOT,
    stagingDirectory: parsed.stagingDirectory,
  });
  console.log(
    `WATCH_LAYER_PUBLICATION_OK status=${result.releaseStatus} version=${result.packageVersion} phase=${result.selectedPhase ?? "none"}`,
  );
  return result;
}

async function main() {
  try {
    await runWatchLayerPublishCli();
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  await main();
}
