import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/** The checked-in application root, independent of process.cwd(). */
export const DEFAULT_PROJECT_ROOT = resolve(MODULE_DIRECTORY, "../..");

export const CANONICAL_PROJECT_PATHS = deepFreeze({
  canonicalMaster: "source/assets/elite-watch-master.png",
  dependencyManifest: "package.json",
  globalsCss: "app/globals.css",
  historicalSpecDirectory: ".kiro/specs/ai-coding-dictionary-inspired-site",
  predecessorManifest: "data/watch-image-asset.json",
  predecessorPublicAssetsDirectory: "public/assets/watch",
  predecessorSpecDirectory: ".kiro/specs/animated-watch-image-glass-header",
  protectedCanvas: "components/canvas/WatchMovementCanvas.tsx",
  successorApprovalsDirectory: "source/assets/watch-2-5d/v1/approvals",
  successorAuthoring: "source/assets/watch-2-5d/v1/authoring.json",
  successorMasksDirectory: "source/assets/watch-2-5d/v1/masks",
  successorPackageManifest: "data/watch-layer-package.json",
  successorPublicAssetsDirectory: "public/assets/watch-2-5d/v1",
  successorReconstructionDirectory: "source/assets/watch-2-5d/v1/reconstruction",
  successorRelease: "data/watch-layer-release.json",
  successorReleaseHistory: "source/assets/watch-2-5d/v1/release-history.json",
  successorReviewDirectory: "source/assets/watch-2-5d/v1/review",
  successorSourceDirectory: "source/assets/watch-2-5d/v1",
});

export const PROJECT_PATHS = CANONICAL_PROJECT_PATHS;
export const CANONICAL_MASTER_PATH = CANONICAL_PROJECT_PATHS.canonicalMaster;
export const PREDECESSOR_MANIFEST_PATH = CANONICAL_PROJECT_PATHS.predecessorManifest;
export const DEPENDENCY_MANIFEST_PATH = CANONICAL_PROJECT_PATHS.dependencyManifest;

export const APPROVED_PUBLIC_DIRECTORIES = deepFreeze([
  CANONICAL_PROJECT_PATHS.predecessorPublicAssetsDirectory,
  CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
]);

export const APPROVED_MASTER_IDENTITY = deepFreeze({
  bitDepth: 8,
  byteLength: 9_381_741,
  colorType: "rgba",
  intrinsicHeight: 1504,
  intrinsicWidth: 2760,
  magicSignatureHex: "89504e470d0a1a0a",
  mediaType: "image/png",
  path: CANONICAL_MASTER_PATH,
  publiclyServed: false,
  sha256: "7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b",
  sourceFile: CANONICAL_MASTER_PATH,
});

export const PREDECESSOR_MANIFEST_IDENTITY = deepFreeze({
  byteLength: 9_265,
  contractStatus: "ready",
  derivativeCount: 10,
  immutableMasterSha256: APPROVED_MASTER_IDENTITY.sha256,
  manifestFile: PREDECESSOR_MANIFEST_PATH,
  path: PREDECESSOR_MANIFEST_PATH,
  schemaVersion: 2,
  segmentationApplied: false,
  sha256: "8ade853f5bdccb9b60091b724e6366776093ca4d1a71d4b79d7bb2a026ed4c6c",
});

export const APPROVED_DEPENDENCY_FIELDS = deepFreeze({
  dependencies: {
    "@react-three/drei": "10.7.8",
    "@react-three/fiber": "9.7.0",
    "framer-motion": "13.1.1",
    next: "16.3.3",
    react: "19.2.8",
    "react-dom": "19.2.8",
    three: "0.185.1",
  },
  devDependencies: {
    "@tailwindcss/postcss": "4.3.3",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.6",
    "@types/node": "26.4.0",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "@types/three": "0.185.4",
    eslint: "9.39.3",
    "eslint-config-next": "16.3.3",
    "fast-check": "4.9.0",
    jsdom: "30.0.1",
    postcss: "8.5.26",
    tailwindcss: "4.3.3",
    typescript: "5.9.3",
    vitest: "4.1.11",
  },
});

export const CONTRACT_FAILURE_CODES = deepFreeze({
  IDENTITY_MISMATCH: "LAYER_IDENTITY_MISMATCH",
  INPUT_CHANGED: "LAYER_INPUT_CHANGED",
  PATH_INVALID: "LAYER_PATH_INVALID",
  PREDECESSOR_INVALID: "LAYER_PREDECESSOR_INVALID",
  PROTECTED_ARTIFACT_CHANGED: "LAYER_PROTECTED_ARTIFACT_CHANGED",
});

export const FAILURE_CODES = CONTRACT_FAILURE_CODES;
export const CONTRACT_SUCCESS = Object.freeze({ ok: true });

const FAILURE_CODE_SET = new Set(Object.values(CONTRACT_FAILURE_CODES));
const WINDOWS_ABSOLUTE_PATTERN = /^[a-z]:[/\\]/iu;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;
const ENCODED_PATH_CONTROL_PATTERN = /%(?:00|2e|2f|5c)/iu;
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const PROTECTED_WATCH_SELECTOR_PATTERN = /\.(?:watch-(?:canvas-shell|static-fallback)|static-(?:case|gear|balance|bridge|jewel))[\w-]*/u;

export const PROTECTED_ARTIFACT_RULES = deepFreeze({
  cssManifestIdPrefix: `${CANONICAL_PROJECT_PATHS.globalsCss}#`,
  directoryRoots: [
    CANONICAL_PROJECT_PATHS.historicalSpecDirectory,
    CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
  ],
  exactFiles: [CANONICAL_PROJECT_PATHS.protectedCanvas],
});

export const DEPENDENCY_FIELD_SNAPSHOTS = createDependencyFieldSnapshots(
  APPROVED_DEPENDENCY_FIELDS,
);

/**
 * A plain, frozen failure value suitable for stable comparisons and serialization.
 * It deliberately excludes stacks, system error text, timestamps, and absolute paths.
 */
export function createDeterministicFailure(code, message, path = null) {
  if (!FAILURE_CODE_SET.has(code)) {
    throw new TypeError(`Unsupported immutable-boundary failure code: ${String(code)}`);
  }
  return Object.freeze({
    code,
    message: String(message),
    ok: false,
    path: path === null ? null : String(path),
  });
}

export const createContractFailure = createDeterministicFailure;

export class ImmutableBoundaryContractError extends Error {
  constructor(failure) {
    super(failure.message);
    this.code = failure.code;
    this.failure = failure;
    this.name = "ImmutableBoundaryContractError";
    this.path = failure.path;
  }

  toJSON() {
    return this.failure;
  }
}

export const ContractError = ImmutableBoundaryContractError;

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, path = null) {
  throw new ImmutableBoundaryContractError(
    createDeterministicFailure(code, message, path),
  );
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isWithinProjectPath(path, directory) {
  return path === directory || path.startsWith(`${directory}/`);
}

function isContainedAbsolutePath(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function validateRelativePathSyntax(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.includes("?")
    || value.includes("#")
    || value.startsWith("//")
    || value.startsWith("~")
    || isAbsolute(value)
    || WINDOWS_ABSOLUTE_PATTERN.test(value)
    || URI_SCHEME_PATTERN.test(value)
    || ENCODED_PATH_CONTROL_PATTERN.test(value)
  ) {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      "Path must be a canonical local project-relative path",
      typeof value === "string" ? value : null,
    );
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      "Path must not contain empty, current-directory, or traversal segments",
      value,
    );
  }
  return value;
}

function resolvePathRecord(value, {
  allowPublic = false,
  allowedRoots,
  expectedPath,
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const projectRelativePath = validateRelativePathSyntax(value);
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail(CONTRACT_FAILURE_CODES.PATH_INVALID, "Project root must be a nonempty path", projectRelativePath);
  }

  if (expectedPath !== undefined && projectRelativePath !== expectedPath) {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      `Path must equal the canonical project path ${expectedPath}`,
      projectRelativePath,
    );
  }

  if (isWithinProjectPath(projectRelativePath, "public")) {
    const inApprovedPublicDirectory = APPROVED_PUBLIC_DIRECTORIES.some((directory) => (
      isWithinProjectPath(projectRelativePath, directory)
    ));
    if (!allowPublic || !inApprovedPublicDirectory) {
      fail(
        CONTRACT_FAILURE_CODES.PATH_INVALID,
        "Path is not within an approved public asset directory",
        projectRelativePath,
      );
    }
  }

  if (allowedRoots !== undefined) {
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
      fail(
        CONTRACT_FAILURE_CODES.PATH_INVALID,
        "Path policy must contain at least one approved project-relative root",
        projectRelativePath,
      );
    }
    const roots = allowedRoots.map((root) => validateRelativePathSyntax(root));
    if (!roots.some((root) => isWithinProjectPath(projectRelativePath, root))) {
      fail(
        CONTRACT_FAILURE_CODES.PATH_INVALID,
        "Path is outside the approved local directory set",
        projectRelativePath,
      );
    }
  }

  const root = resolve(projectRoot);
  const absolutePath = resolve(root, projectRelativePath);
  if (!isContainedAbsolutePath(root, absolutePath)) {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      "Path escapes the project root",
      projectRelativePath,
    );
  }

  return Object.freeze({ absolutePath, projectRelativePath, projectRoot: root });
}

/** Validate a local project-relative path and return it unchanged. */
export function assertSafeProjectRelativePath(value, options = {}) {
  return resolvePathRecord(value, options).projectRelativePath;
}

export const assertCanonicalProjectPath = assertSafeProjectRelativePath;

/** Resolve a validated project-relative path without touching the filesystem. */
export function resolveSafeProjectPath(value, options = {}) {
  return resolvePathRecord(value, options).absolutePath;
}

export function isSafeProjectRelativePath(value, options = {}) {
  try {
    resolvePathRecord(value, options);
    return true;
  } catch (error) {
    if (error instanceof ImmutableBoundaryContractError) return false;
    throw error;
  }
}

/**
 * Recognize members of the inherited protected set without broadening protection
 * to the complete globals.css file (only its recorded watch block IDs are members).
 */
export function isProtectedArtifactMember(value) {
  if (typeof value !== "string") return false;
  if (value.startsWith(PROTECTED_ARTIFACT_RULES.cssManifestIdPrefix)) {
    const selectorId = value.slice(PROTECTED_ARTIFACT_RULES.cssManifestIdPrefix.length);
    return selectorId.length > 0 && PROTECTED_WATCH_SELECTOR_PATTERN.test(selectorId);
  }

  try {
    validateRelativePathSyntax(value);
  } catch (error) {
    if (error instanceof ImmutableBoundaryContractError) return false;
    throw error;
  }

  return PROTECTED_ARTIFACT_RULES.exactFiles.includes(value)
    || PROTECTED_ARTIFACT_RULES.directoryRoots.some((directory) => (
      isWithinProjectPath(value, directory)
    ));
}

export const isProtectedArtifact = isProtectedArtifactMember;

export function assertProtectedArtifactMember(value) {
  if (!isProtectedArtifactMember(value)) {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      "Path is not a member of the inherited protected artifact set",
      typeof value === "string" ? value : null,
    );
  }
  return value;
}

export function sha256(value) {
  if (typeof value !== "string" && !ArrayBuffer.isView(value)) {
    throw new TypeError("SHA-256 input must be a string or byte view");
  }
  return createHash("sha256").update(value).digest("hex");
}

export const hashBytes = sha256;

function stableStatIdentity(stats) {
  return {
    ctimeMs: stats.ctimeMs,
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function equalStatIdentity(left, right) {
  return left.ctimeMs === right.ctimeMs
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size;
}

async function safeLstat(path, projectRelativePath, { final = false } = {}) {
  try {
    return await lstat(path);
  } catch {
    fail(
      final ? CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH : CONTRACT_FAILURE_CODES.PATH_INVALID,
      final ? "Required input file is missing or unreadable" : "Project path cannot be inspected safely",
      projectRelativePath,
    );
  }
}

/**
 * Read a regular file after rejecting symlinks in the root, every parent component,
 * and the final file. The returned bytes are detached from the inspected file.
 */
export async function inspectSafeRegularFile(projectRelativePath, options = {}) {
  const resolvedPath = resolvePathRecord(projectRelativePath, options);
  const rootStats = await safeLstat(
    resolvedPath.projectRoot,
    resolvedPath.projectRelativePath,
  );
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      "Project root must be a regular non-symlink directory",
      resolvedPath.projectRelativePath,
    );
  }

  const segments = resolvedPath.projectRelativePath.split("/");
  let currentPath = resolvedPath.projectRoot;
  let initialFileStats;
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = resolve(currentPath, segments[index]);
    const final = index === segments.length - 1;
    const stats = await safeLstat(currentPath, resolvedPath.projectRelativePath, { final });
    if (stats.isSymbolicLink()) {
      fail(
        CONTRACT_FAILURE_CODES.PATH_INVALID,
        "Project file path must not contain a symbolic link",
        resolvedPath.projectRelativePath,
      );
    }
    if (!final && !stats.isDirectory()) {
      fail(
        CONTRACT_FAILURE_CODES.PATH_INVALID,
        "Project file parent must be a regular directory",
        resolvedPath.projectRelativePath,
      );
    }
    if (final) {
      if (!stats.isFile()) {
        fail(
          CONTRACT_FAILURE_CODES.PATH_INVALID,
          "Project input must be a regular non-symlink file",
          resolvedPath.projectRelativePath,
        );
      }
      initialFileStats = stableStatIdentity(stats);
    }
  }

  let realRoot;
  let realFile;
  try {
    [realRoot, realFile] = await Promise.all([
      realpath(resolvedPath.projectRoot),
      realpath(resolvedPath.absolutePath),
    ]);
  } catch {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      "Project file real path cannot be inspected safely",
      resolvedPath.projectRelativePath,
    );
  }
  if (!isContainedAbsolutePath(realRoot, realFile)) {
    fail(
      CONTRACT_FAILURE_CODES.PATH_INVALID,
      "Project file resolves outside the project root",
      resolvedPath.projectRelativePath,
    );
  }

  let bytes;
  try {
    bytes = await readFile(resolvedPath.absolutePath);
  } catch {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      "Required input file is unreadable",
      resolvedPath.projectRelativePath,
    );
  }

  const finalStats = await safeLstat(
    resolvedPath.absolutePath,
    resolvedPath.projectRelativePath,
    { final: true },
  );
  if (
    finalStats.isSymbolicLink()
    || !finalStats.isFile()
    || !equalStatIdentity(initialFileStats, stableStatIdentity(finalStats))
  ) {
    fail(
      CONTRACT_FAILURE_CODES.INPUT_CHANGED,
      "Input changed while it was being inspected",
      resolvedPath.projectRelativePath,
    );
  }

  const identity = deepFreeze({
    byteLength: bytes.byteLength,
    path: resolvedPath.projectRelativePath,
    sha256: sha256(bytes),
  });
  return { bytes, identity };
}

export async function readSafeRegularFile(projectRelativePath, options = {}) {
  const inspected = await inspectSafeRegularFile(projectRelativePath, options);
  return inspected.bytes;
}

export async function assertSafeRegularFile(projectRelativePath, options = {}) {
  const inspected = await inspectSafeRegularFile(projectRelativePath, options);
  return inspected.identity;
}

function expectedIdentityPath(expectedIdentity) {
  if (!isPlainObject(expectedIdentity)) {
    fail(CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH, "Expected file identity must be an object");
  }
  const declaredPaths = [
    expectedIdentity.path,
    expectedIdentity.sourceFile,
    expectedIdentity.manifestFile,
  ].filter((value) => value !== undefined);
  if (
    declaredPaths.length === 0
    || declaredPaths.some((value) => typeof value !== "string")
    || declaredPaths.some((value) => value !== declaredPaths[0])
  ) {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      "Expected file identity must declare one consistent project-relative path",
    );
  }
  return declaredPaths[0];
}

/** Verify raw byte length and SHA-256 against an immutable approved identity. */
export async function assertProjectFileIdentity(expectedIdentity, options = {}) {
  const path = expectedIdentityPath(expectedIdentity);
  if (
    !Number.isSafeInteger(expectedIdentity.byteLength)
    || expectedIdentity.byteLength < 0
    || typeof expectedIdentity.sha256 !== "string"
    || !SHA256_PATTERN.test(expectedIdentity.sha256)
  ) {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      "Expected file identity must contain a byte length and lowercase SHA-256",
      path,
    );
  }

  const actual = await assertSafeRegularFile(path, {
    ...options,
    expectedPath: path,
  });
  if (
    actual.byteLength !== expectedIdentity.byteLength
    || actual.sha256 !== expectedIdentity.sha256
  ) {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      "File bytes differ from the approved identity",
      path,
    );
  }
  return actual;
}

export function assertCanonicalMasterIsNonPublic() {
  assertSafeProjectRelativePath(APPROVED_MASTER_IDENTITY.path, {
    allowPublic: false,
    expectedPath: CANONICAL_MASTER_PATH,
  });
  if (APPROVED_MASTER_IDENTITY.publiclyServed !== false) {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      "Canonical master identity must remain non-public",
      CANONICAL_MASTER_PATH,
    );
  }
  return true;
}

export async function assertApprovedMasterIdentity(options = {}) {
  assertCanonicalMasterIsNonPublic();
  return assertProjectFileIdentity(APPROVED_MASTER_IDENTITY, options);
}

export async function assertPredecessorManifestIdentity(options = {}) {
  return assertProjectFileIdentity(PREDECESSOR_MANIFEST_IDENTITY, options);
}

function assertDependencyMap(value, field) {
  if (!isPlainObject(value)) {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      `${field} must be a JSON object`,
      DEPENDENCY_MANIFEST_PATH,
    );
  }
  for (const [name, version] of Object.entries(value)) {
    if (name.length === 0 || typeof version !== "string" || version.length === 0) {
      fail(
        CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
        `${field} must contain nonempty package names and exact string versions`,
        DEPENDENCY_MANIFEST_PATH,
      );
    }
  }
}

function createOneDependencySnapshot(field, value) {
  assertDependencyMap(value, field);
  const clonedValue = Object.fromEntries(Object.entries(value));
  const serialized = JSON.stringify(clonedValue);
  return deepFreeze({
    byteLength: Buffer.byteLength(serialized),
    field,
    serialized,
    sha256: sha256(serialized),
    value: clonedValue,
  });
}

/** Snapshot only dependency fields, preserving their parsed key order and exact versions. */
export function createDependencyFieldSnapshots(packageDocument) {
  if (!isPlainObject(packageDocument)) {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      "Package document must be a JSON object",
      DEPENDENCY_MANIFEST_PATH,
    );
  }
  return deepFreeze({
    dependencies: createOneDependencySnapshot(
      "dependencies",
      packageDocument.dependencies,
    ),
    devDependencies: createOneDependencySnapshot(
      "devDependencies",
      packageDocument.devDependencies,
    ),
  });
}

export const snapshotDependencyFields = createDependencyFieldSnapshots;

export function assertApprovedDependencyFields(packageDocument) {
  const actual = createDependencyFieldSnapshots(packageDocument);
  for (const field of ["dependencies", "devDependencies"]) {
    if (actual[field].serialized !== DEPENDENCY_FIELD_SNAPSHOTS[field].serialized) {
      fail(
        CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
        `${field} differs from the approved dependency-field snapshot`,
        DEPENDENCY_MANIFEST_PATH,
      );
    }
  }
  return actual;
}

export async function inspectApprovedDependencyFields(options = {}) {
  const bytes = await readSafeRegularFile(DEPENDENCY_MANIFEST_PATH, {
    ...options,
    expectedPath: DEPENDENCY_MANIFEST_PATH,
  });
  let packageDocument;
  try {
    packageDocument = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(
      CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
      "Package document is not valid JSON",
      DEPENDENCY_MANIFEST_PATH,
    );
  }
  return assertApprovedDependencyFields(packageDocument);
}

function inputSnapshotPayload(files) {
  return {
    algorithm: "sha256",
    files: files.map(({ byteLength, path, sha256: digest }) => ({
      byteLength,
      path,
      sha256: digest,
    })),
    schemaVersion: 1,
  };
}

function validateInputSnapshot(snapshot) {
  if (
    !isPlainObject(snapshot)
    || snapshot.schemaVersion !== 1
    || snapshot.algorithm !== "sha256"
    || !Array.isArray(snapshot.files)
    || typeof snapshot.snapshotSha256 !== "string"
    || !SHA256_PATTERN.test(snapshot.snapshotSha256)
  ) {
    fail(CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH, "Input hash snapshot has an invalid shape");
  }

  let previousPath = null;
  for (const entry of snapshot.files) {
    if (
      !isPlainObject(entry)
      || typeof entry.path !== "string"
      || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 0
      || typeof entry.sha256 !== "string"
      || !SHA256_PATTERN.test(entry.sha256)
      || (previousPath !== null && entry.path <= previousPath)
    ) {
      fail(CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH, "Input hash snapshot entries are invalid");
    }
    previousPath = entry.path;
  }

  const payloadDigest = sha256(JSON.stringify(inputSnapshotPayload(snapshot.files)));
  if (payloadDigest !== snapshot.snapshotSha256) {
    fail(CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH, "Input hash snapshot fingerprint is invalid");
  }
  return snapshot;
}

/** Capture a sorted, immutable, byte-stable SHA-256 snapshot of regular files. */
export async function createInputHashSnapshot(projectRelativePaths, options = {}) {
  if (!Array.isArray(projectRelativePaths)) {
    fail(CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH, "Input snapshot paths must be an array");
  }
  const paths = [...new Set(projectRelativePaths)].sort();
  const files = [];
  for (const path of paths) {
    files.push(await assertSafeRegularFile(path, options));
  }
  const payload = inputSnapshotPayload(files);
  return deepFreeze({
    ...payload,
    snapshotSha256: sha256(JSON.stringify(payload)),
  });
}

export const captureInputSnapshot = createInputHashSnapshot;
export const snapshotProjectFiles = createInputHashSnapshot;

export function serializeInputHashSnapshot(snapshot) {
  validateInputSnapshot(snapshot);
  return Buffer.from(`${JSON.stringify({
    algorithm: snapshot.algorithm,
    files: snapshot.files,
    schemaVersion: snapshot.schemaVersion,
    snapshotSha256: snapshot.snapshotSha256,
  })}\n`);
}

export const serializeInputSnapshot = serializeInputHashSnapshot;

export function compareInputHashSnapshots(
  before,
  after,
  { failureCode = CONTRACT_FAILURE_CODES.INPUT_CHANGED } = {},
) {
  validateInputSnapshot(before);
  validateInputSnapshot(after);
  if (before.snapshotSha256 === after.snapshotSha256) return CONTRACT_SUCCESS;

  const beforeEntries = new Map(before.files.map((entry) => [entry.path, entry]));
  const afterEntries = new Map(after.files.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  const changedPath = paths.find((path) => {
    const first = beforeEntries.get(path);
    const second = afterEntries.get(path);
    return !first
      || !second
      || first.byteLength !== second.byteLength
      || first.sha256 !== second.sha256;
  }) ?? null;

  return createDeterministicFailure(
    failureCode,
    changedPath === null
      ? "Input hash snapshot fingerprint changed"
      : "Input bytes changed after the initial snapshot",
    changedPath,
  );
}

export async function assertInputHashSnapshotUnchanged(
  before,
  options = {},
) {
  validateInputSnapshot(before);
  const failureCode = options.failureCode ?? CONTRACT_FAILURE_CODES.INPUT_CHANGED;
  let after;
  try {
    after = await createInputHashSnapshot(
      before.files.map(({ path }) => path),
      options,
    );
  } catch (error) {
    if (
      error instanceof ImmutableBoundaryContractError
      && error.code === CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH
    ) {
      fail(failureCode, "Input changed or disappeared after the initial snapshot", error.path);
    }
    throw error;
  }

  const comparison = compareInputHashSnapshots(before, after, { failureCode });
  if (!comparison.ok) throw new ImmutableBoundaryContractError(comparison);
  return after;
}

export const assertInputSnapshotUnchanged = assertInputHashSnapshotUnchanged;


// Strict successor schemas and canonical JSON serialization. Kept dependency-free so
// the immutable dependency contract remains unchanged.
import {
  CANONICAL_JSON_ISSUE_CODES,
  CanonicalJsonError,
  canonicalJsonStringify,
  canonicalizeJson,
  parseCanonicalJson,
  serializeCanonicalJson,
  serializeCanonicalJsonLine,
} from "./canonical-json.mjs";

export {
  CANONICAL_JSON_ISSUE_CODES,
  CanonicalJsonError,
  canonicalJsonStringify,
  canonicalizeJson,
  parseCanonicalJson,
  serializeCanonicalJson,
  serializeCanonicalJsonLine,
};

export const LAYER_GATE_FAILURE_CODES = deepFreeze({
  BUDGET_EXCEEDED: "LAYER_BUDGET_EXCEEDED",
  DEPTH_INVALID: "LAYER_DEPTH_INVALID",
  FIDELITY_INVALID: "LAYER_FIDELITY_INVALID",
  IDENTITY_MISMATCH: CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
  INPUT_CHANGED: CONTRACT_FAILURE_CODES.INPUT_CHANGED,
  MANIFEST_MISSING: "LAYER_MANIFEST_MISSING",
  MOTION_INVALID: "LAYER_MOTION_INVALID",
  PATH_INVALID: CONTRACT_FAILURE_CODES.PATH_INVALID,
  PREDECESSOR_INVALID: CONTRACT_FAILURE_CODES.PREDECESSOR_INVALID,
  PROTECTED_ARTIFACT_CHANGED: CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
  PROVENANCE_INVALID: "LAYER_PROVENANCE_INVALID",
  RECONSTRUCTION_INVALID: "LAYER_RECONSTRUCTION_INVALID",
  SCHEMA_INVALID: "LAYER_SCHEMA_INVALID",
  SEGMENTATION_INVALID: "LAYER_SEGMENTATION_INVALID",
});

export const APPROVED_LAYER_GATE_FAILURE_CODES = deepFreeze(
  Object.values(LAYER_GATE_FAILURE_CODES),
);

export const SCHEMA_ISSUE_CODES = deepFreeze({
  DUPLICATE_ID: "SCHEMA_DUPLICATE_ID",
  FIELD_SET: "SCHEMA_FIELD_SET_INVALID",
  HASH: "SCHEMA_SHA256_INVALID",
  ID: "SCHEMA_ID_INVALID",
  NONFINITE_NUMBER: CANONICAL_JSON_ISSUE_CODES.NONFINITE_NUMBER,
  OUT_OF_BOUNDS: "SCHEMA_COORDINATE_OUT_OF_BOUNDS",
  PATH: "SCHEMA_PATH_INVALID",
  TIMESTAMP: "SCHEMA_UTC_TIMESTAMP_INVALID",
  TYPE: "SCHEMA_TYPE_INVALID",
  UNSUPPORTED_ENUM: "SCHEMA_ENUM_UNSUPPORTED",
  VALUE: "SCHEMA_VALUE_INVALID",
});

export const CANONICAL_SOURCE_COORDINATE_SPACE = deepFreeze({
  height: 1504,
  width: 2760,
});

export const MOTION_SEMANTIC_CLASSES = deepFreeze([
  "central-hand",
  "subdial-hand",
  "exposed-rotor",
  "exposed-gear",
  "visible-oscillator",
]);

export const STATIC_SEMANTIC_CLASSES = deepFreeze([
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
]);

export const SEMANTIC_CLASSES = deepFreeze([
  ...MOTION_SEMANTIC_CLASSES,
  ...STATIC_SEMANTIC_CLASSES,
]);

export const AUTHORING_METHODS = deepFreeze([
  "source-extraction",
  "manual-mask",
  "manual-paint",
  "clone-from-visible-source",
  "local-inpainting",
  "deterministic-generation",
]);

export const PROVENANCE_CLASSIFICATIONS = deepFreeze([
  "source-derived",
  "synthetic",
]);

export const APPROVAL_SCOPES = deepFreeze([
  "segmentation",
  "reconstruction",
  "pivot",
  "motion",
  "depth",
  "fidelity",
  "release",
]);

export const APPROVAL_DECISIONS = deepFreeze([
  "pending",
  "approved",
  "rejected",
]);

export const LAYER_DISPOSITIONS = deepFreeze([
  "static",
  "motion-candidate",
  "approved-moving",
]);

export const MOTION_KINDS = deepFreeze([
  "continuous-rotation",
  "discrete-rotation",
  "oscillation",
]);

export const PHASE_NAMES = deepFreeze([
  "source-preparation",
  "static-layered-reconstruction",
  "approved-part-motion",
  "optional-depth",
]);

export const PHASE_STATUSES = deepFreeze([
  "pending",
  "approved",
  "disabled",
  "rejected",
]);

export const PROFILE_IDS = deepFreeze(["compact", "expanded"]);
export const RELATIONSHIP_EVIDENCE_CLASSES = deepFreeze([
  "visible-evidence",
  "authored-assumption",
]);

export const AUTHORING_INTERPRETATION_NOTICE =
  "Masks, reconstruction, pivots, motion, and depth are authored interpretations; synthetic pixels are not recovered source truth.";

export const CANONICAL_IDENTITY_MATRIX = deepFreeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

export const ENHANCEMENT_BUDGETS = deepFreeze({
  compact: {
    maxDecodedRgbaBytes: 25_165_824,
    maxTransferBytes: 1_572_864,
  },
  expanded: {
    maxDecodedRgbaBytes: 50_331_648,
    maxTransferBytes: 3_145_728,
  },
  frameSampleCount: 120,
  maxRequestsIncludingRuntimeManifest: 8,
  maximumCumulativeBlockingMs: 100,
  maximumFrameIntervalMs: 100,
  maximumInteractionResponseMs: 100,
  maximumOverlappingTaskMs: 100,
  minimumIntervalsAtOrBelow25Ms: 114,
});

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const STRICT_UTC_TIMESTAMP_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const LOWERCASE_HEX_PATTERN = /^(?:[a-f\d]{2})+$/u;
const SETTINGS_KEY_PATTERN = /^[A-Za-z][A-Za-z\d_.-]{0,127}$/u;
const PUBLIC_ASSET_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.webp$/u;
const MAX_STABLE_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 16_384;
const MAX_CANONICAL_PIXELS = CANONICAL_SOURCE_COORDINATE_SPACE.width
  * CANONICAL_SOURCE_COORDINATE_SPACE.height;
const MOTION_CLASS_SET = new Set(MOTION_SEMANTIC_CLASSES);
const SEMANTIC_CLASS_SET = new Set(SEMANTIC_CLASSES);
const METHOD_SET = new Set(AUTHORING_METHODS);
const CLASSIFICATION_SET = new Set(PROVENANCE_CLASSIFICATIONS);
const APPROVAL_SCOPE_SET = new Set(APPROVAL_SCOPES);
const APPROVAL_DECISION_SET = new Set(APPROVAL_DECISIONS);
const DISPOSITION_SET = new Set(LAYER_DISPOSITIONS);
const MOTION_KIND_SET = new Set(MOTION_KINDS);
const PHASE_STATUS_SET = new Set(PHASE_STATUSES);
const PROFILE_SET = new Set(PROFILE_IDS);
const RELATIONSHIP_EVIDENCE_SET = new Set(RELATIONSHIP_EVIDENCE_CLASSES);

export class WatchLayerSchemaError extends TypeError {
  constructor(
    issueCode,
    message,
    path = "$",
    code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
  ) {
    super(message);
    this.code = code;
    this.issueCode = issueCode;
    this.name = "WatchLayerSchemaError";
    this.path = path;
    this.failure = Object.freeze({
      code,
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

export const SchemaValidationError = WatchLayerSchemaError;

function schemaFail(
  issueCode,
  message,
  path,
  code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
) {
  throw new WatchLayerSchemaError(issueCode, message, path, code);
}

function childPath(path, field) {
  return `${path}.${field}`;
}

function indexPath(path, index) {
  return `${path}[${index}]`;
}

function assertSchemaRecord(value, requiredFields, optionalFields, path) {
  if (!isPlainObject(value)) {
    schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Value must be a plain object", path);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    schemaFail(SCHEMA_ISSUE_CODES.FIELD_SET, "Object must not contain symbol fields", path);
  }

  const required = [...requiredFields].sort();
  const optional = [...optionalFields].sort();
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value).sort();
  const unknown = actual.filter((field) => !allowed.has(field));
  const missing = required.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
  if (unknown.length !== 0 || missing.length !== 0) {
    schemaFail(
      SCHEMA_ISSUE_CODES.FIELD_SET,
      `Object fields differ (unknown: ${unknown.join(",") || "none"}; missing: ${missing.join(",") || "none"})`,
      path,
    );
  }

  for (const field of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      schemaFail(
        SCHEMA_ISSUE_CODES.FIELD_SET,
        "Schema fields must be enumerable data properties",
        childPath(path, field),
      );
    }
  }
  return value;
}

function assertSchemaArray(value, path) {
  if (!Array.isArray(value)) {
    schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Value must be an array", path);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Array must not be sparse", indexPath(path, index));
    }
  }
  return value;
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") {
    schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Value must be a boolean", path);
  }
  return value;
}

function assertString(value, path, { allowEmpty = false, maxLength = MAX_TEXT_LENGTH } = {}) {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || value.length > maxLength
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    schemaFail(
      SCHEMA_ISSUE_CODES.TYPE,
      allowEmpty ? "Value must be a bounded string" : "Value must be a nonempty bounded string",
      path,
    );
  }
  return value;
}

function assertStableId(value, path) {
  assertString(value, path, { maxLength: MAX_STABLE_ID_LENGTH });
  if (!STABLE_ID_PATTERN.test(value)) {
    schemaFail(
      SCHEMA_ISSUE_CODES.ID,
      "Identifier must be stable lowercase kebab-case",
      path,
    );
  }
  return value;
}

function assertFiniteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    schemaFail(
      SCHEMA_ISSUE_CODES.NONFINITE_NUMBER,
      "Value must be a finite number",
      path,
    );
  }
  return value;
}

function assertSafeInteger(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    schemaFail(
      SCHEMA_ISSUE_CODES.VALUE,
      `Value must be a safe integer from ${minimum} through ${maximum}`,
      path,
    );
  }
  return value;
}

function assertPositiveFinite(value, path) {
  assertFiniteNumber(value, path);
  if (value <= 0) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Value must be greater than zero", path);
  }
  return value;
}

function assertEnum(value, allowedSet, path, label) {
  if (typeof value !== "string" || !allowedSet.has(value)) {
    schemaFail(
      SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM,
      `Unsupported ${label}: ${typeof value === "string" ? value : String(value)}`,
      path,
    );
  }
  return value;
}

function assertSha256(value, path) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    schemaFail(
      SCHEMA_ISSUE_CODES.HASH,
      "Value must be a lowercase 64-character SHA-256 digest",
      path,
    );
  }
  return value;
}

function assertLowercaseHex(value, path, { minimumBytes = 1 } = {}) {
  if (
    typeof value !== "string"
    || value.length < minimumBytes * 2
    || !LOWERCASE_HEX_PATTERN.test(value)
  ) {
    schemaFail(
      SCHEMA_ISSUE_CODES.VALUE,
      "Value must be lowercase, even-length hexadecimal bytes",
      path,
    );
  }
  return value;
}

function assertStrictUtcTimestamp(value, path) {
  if (
    typeof value !== "string"
    || !STRICT_UTC_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    schemaFail(
      SCHEMA_ISSUE_CODES.TIMESTAMP,
      "Timestamp must be a real UTC instant in YYYY-MM-DDTHH:mm:ss.sssZ form",
      path,
    );
  }
  return value;
}

function assertLiteral(value, expected, path) {
  if (value !== expected) {
    schemaFail(
      SCHEMA_ISSUE_CODES.VALUE,
      `Value must equal ${JSON.stringify(expected)}`,
      path,
    );
  }
  return value;
}

function assertUniqueValues(values, path, issueCode = SCHEMA_ISSUE_CODES.DUPLICATE_ID) {
  const firstIndex = new Map();
  values.forEach((value, index) => {
    if (firstIndex.has(value)) {
      schemaFail(
        issueCode,
        `Duplicate value ${JSON.stringify(value)} first appeared at index ${firstIndex.get(value)}`,
        indexPath(path, index),
      );
    }
    firstIndex.set(value, index);
  });
}

function assertIdArray(value, path, { allowEmpty = true } = {}) {
  const array = assertSchemaArray(value, path);
  if (!allowEmpty && array.length === 0) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Array must not be empty", path);
  }
  array.forEach((entry, index) => assertStableId(entry, indexPath(path, index)));
  assertUniqueValues(array, path);
  return array;
}

function assertSha256Array(value, path, { allowEmpty = true } = {}) {
  const array = assertSchemaArray(value, path);
  if (!allowEmpty && array.length === 0) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Array must not be empty", path);
  }
  array.forEach((entry, index) => assertSha256(entry, indexPath(path, index)));
  assertUniqueValues(array, path, SCHEMA_ISSUE_CODES.VALUE);
  return array;
}

function assertSchemaProjectPath(value, path, options) {
  try {
    return assertSafeProjectRelativePath(value, options);
  } catch (error) {
    if (error instanceof ImmutableBoundaryContractError) {
      schemaFail(
        SCHEMA_ISSUE_CODES.PATH,
        "Value must be an approved canonical local project-relative path",
        path,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    throw error;
  }
}

function assertCanonicalPublicUrl(value, profile, path) {
  assertString(value, path);
  const prefix = `/assets/watch-2-5d/v1/${profile}/`;
  if (
    !value.startsWith(prefix)
    || value.startsWith("//")
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || value.split("/").some((segment) => segment === "." || segment === "..")
    || !PUBLIC_ASSET_NAME_PATTERN.test(value.slice(prefix.length))
  ) {
    schemaFail(
      SCHEMA_ISSUE_CODES.PATH,
      "Value must be a canonical same-origin watch 2.5D WebP URL",
      path,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return value;
}

function assertSourcePoint(value, path, { withinRect = null } = {}) {
  assertSchemaRecord(value, ["x", "y"], [], path);
  assertFiniteNumber(value.x, childPath(path, "x"));
  assertFiniteNumber(value.y, childPath(path, "y"));
  const inCanonical = value.x >= 0
    && value.x < CANONICAL_SOURCE_COORDINATE_SPACE.width
    && value.y >= 0
    && value.y < CANONICAL_SOURCE_COORDINATE_SPACE.height;
  const inRect = withinRect === null || (
    value.x >= withinRect.x
    && value.x < withinRect.x + withinRect.width
    && value.y >= withinRect.y
    && value.y < withinRect.y + withinRect.height
  );
  if (!inCanonical || !inRect) {
    schemaFail(
      SCHEMA_ISSUE_CODES.OUT_OF_BOUNDS,
      "Point must lie inside its half-open canonical source boundary",
      path,
    );
  }
  return value;
}

function assertSourceRect(value, path) {
  assertSchemaRecord(value, ["height", "width", "x", "y"], [], path);
  assertSafeInteger(value.x, childPath(path, "x"), {
    maximum: CANONICAL_SOURCE_COORDINATE_SPACE.width - 1,
  });
  assertSafeInteger(value.y, childPath(path, "y"), {
    maximum: CANONICAL_SOURCE_COORDINATE_SPACE.height - 1,
  });
  assertSafeInteger(value.width, childPath(path, "width"), {
    minimum: 1,
    maximum: CANONICAL_SOURCE_COORDINATE_SPACE.width,
  });
  assertSafeInteger(value.height, childPath(path, "height"), {
    minimum: 1,
    maximum: CANONICAL_SOURCE_COORDINATE_SPACE.height,
  });
  if (
    value.x + value.width > CANONICAL_SOURCE_COORDINATE_SPACE.width
    || value.y + value.height > CANONICAL_SOURCE_COORDINATE_SPACE.height
  ) {
    schemaFail(
      SCHEMA_ISSUE_CODES.OUT_OF_BOUNDS,
      "Half-open rectangle must be contained by the 2760x1504 canonical source",
      path,
    );
  }
  return value;
}

function assertMatrix(value, path) {
  assertSchemaRecord(value, ["a", "b", "c", "d", "e", "f"], [], path);
  for (const field of ["a", "b", "c", "d", "e", "f"]) {
    assertFiniteNumber(value[field], childPath(path, field));
  }
  return value;
}

function assertSourceCoordinateSpace(value, path) {
  assertSchemaRecord(value, ["height", "width"], [], path);
  assertLiteral(value.width, CANONICAL_SOURCE_COORDINATE_SPACE.width, childPath(path, "width"));
  assertLiteral(value.height, CANONICAL_SOURCE_COORDINATE_SPACE.height, childPath(path, "height"));
}

function assertExactIdentity(value, expected, path) {
  const fields = Object.keys(expected);
  assertSchemaRecord(value, fields, [], path);
  for (const field of fields) {
    assertLiteral(value[field], expected[field], childPath(path, field));
  }
}

function validateMaskRecordShape(value, path) {
  assertSchemaRecord(value, [
    "alphaSum",
    "file",
    "height",
    "id",
    "nonZeroPixelCount",
    "provenanceId",
    "sha256",
    "tightBounds",
    "width",
  ], [], path);
  assertStableId(value.id, childPath(path, "id"));
  assertSchemaProjectPath(value.file, childPath(path, "file"), {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorMasksDirectory],
  });
  if (!value.file.endsWith(".png")) {
    schemaFail(SCHEMA_ISSUE_CODES.PATH, "Mask file must use the .png extension", childPath(path, "file"), LAYER_GATE_FAILURE_CODES.PATH_INVALID);
  }
  assertSha256(value.sha256, childPath(path, "sha256"));
  assertLiteral(value.width, CANONICAL_SOURCE_COORDINATE_SPACE.width, childPath(path, "width"));
  assertLiteral(value.height, CANONICAL_SOURCE_COORDINATE_SPACE.height, childPath(path, "height"));
  assertSafeInteger(value.nonZeroPixelCount, childPath(path, "nonZeroPixelCount"), {
    maximum: MAX_CANONICAL_PIXELS,
  });
  assertSafeInteger(value.alphaSum, childPath(path, "alphaSum"), {
    maximum: MAX_CANONICAL_PIXELS * 255,
  });
  assertSourceRect(value.tightBounds, childPath(path, "tightBounds"));
  assertStableId(value.provenanceId, childPath(path, "provenanceId"));
  const tightArea = value.tightBounds.width * value.tightBounds.height;
  if (
    value.nonZeroPixelCount === 0
    || value.nonZeroPixelCount > tightArea
    || value.alphaSum < value.nonZeroPixelCount
    || value.alphaSum > value.nonZeroPixelCount * 255
  ) {
    schemaFail(
      SCHEMA_ISSUE_CODES.VALUE,
      "Mask counts must describe nonzero 8-bit samples inside tightBounds",
      path,
    );
  }
}

function validateLayerRecordShape(value, path) {
  assertSchemaRecord(value, [
    "approvalIds",
    "disposition",
    "id",
    "provenanceIds",
    "reconstructedPixelCount",
    "referenceTransform",
    "segmentationMaskId",
    "semanticClass",
    "sourceRect",
    "sourceVisiblePixelCount",
    "zOrder",
  ], ["depthProfileId", "motionProfileId", "pivot"], path);
  assertStableId(value.id, childPath(path, "id"));
  assertEnum(value.semanticClass, SEMANTIC_CLASS_SET, childPath(path, "semanticClass"), "semantic class");
  assertEnum(value.disposition, DISPOSITION_SET, childPath(path, "disposition"), "layer disposition");
  assertSourceRect(value.sourceRect, childPath(path, "sourceRect"));
  assertStableId(value.segmentationMaskId, childPath(path, "segmentationMaskId"));
  assertSafeInteger(value.zOrder, childPath(path, "zOrder"));
  assertSafeInteger(value.sourceVisiblePixelCount, childPath(path, "sourceVisiblePixelCount"), {
    maximum: value.sourceRect.width * value.sourceRect.height,
  });
  assertSafeInteger(value.reconstructedPixelCount, childPath(path, "reconstructedPixelCount"), {
    maximum: MAX_CANONICAL_PIXELS,
  });
  assertMatrix(value.referenceTransform, childPath(path, "referenceTransform"));
  assertIdArray(value.provenanceIds, childPath(path, "provenanceIds"));
  assertIdArray(value.approvalIds, childPath(path, "approvalIds"));
  if (value.pivot !== undefined) {
    assertSourcePoint(value.pivot, childPath(path, "pivot"), { withinRect: value.sourceRect });
  }
  if (value.motionProfileId !== undefined) {
    assertStableId(value.motionProfileId, childPath(path, "motionProfileId"));
  }
  if (value.depthProfileId !== undefined) {
    assertStableId(value.depthProfileId, childPath(path, "depthProfileId"));
  }
  if (value.disposition === "approved-moving") {
    if (!MOTION_CLASS_SET.has(value.semanticClass)) {
      schemaFail(
        SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM,
        "Approved moving layers must use an allowed motion semantic class",
        childPath(path, "semanticClass"),
      );
    }
    for (const field of ["pivot", "motionProfileId"]) {
      if (value[field] === undefined) {
        schemaFail(
          SCHEMA_ISSUE_CODES.FIELD_SET,
          `Approved moving layer requires ${field}`,
          childPath(path, field),
        );
      }
    }
  }
}

function validateReconstructionRecordShape(value, path) {
  assertSchemaRecord(value, [
    "approvalId",
    "boundaryMaskId",
    "fillFile",
    "fillId",
    "fillSha256",
    "id",
    "method",
    "provenanceId",
    "regionMaskId",
    "syntheticPixelCount",
  ], [], path);
  for (const field of ["id", "fillId", "regionMaskId", "boundaryMaskId", "provenanceId", "approvalId"]) {
    assertStableId(value[field], childPath(path, field));
  }
  if (value.fillId === value.id) {
    schemaFail(SCHEMA_ISSUE_CODES.DUPLICATE_ID, "Reconstruction and fill IDs must differ", childPath(path, "fillId"));
  }
  assertSchemaProjectPath(value.fillFile, childPath(path, "fillFile"), {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorReconstructionDirectory],
  });
  if (!value.fillFile.endsWith(".png")) {
    schemaFail(SCHEMA_ISSUE_CODES.PATH, "Reconstruction fill must use the .png extension", childPath(path, "fillFile"), LAYER_GATE_FAILURE_CODES.PATH_INVALID);
  }
  assertSha256(value.fillSha256, childPath(path, "fillSha256"));
  assertSafeInteger(value.syntheticPixelCount, childPath(path, "syntheticPixelCount"), {
    minimum: 1,
    maximum: MAX_CANONICAL_PIXELS,
  });
  assertEnum(value.method, METHOD_SET, childPath(path, "method"), "authoring method");
  if (["source-extraction", "manual-mask"].includes(value.method)) {
    schemaFail(
      SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM,
      "Synthetic reconstruction must use an approved synthetic authoring method",
      childPath(path, "method"),
    );
  }
}

function validateProvenanceRecordShape(value, path) {
  assertSchemaRecord(value, [
    "artifactId",
    "artifactSha256",
    "classification",
    "createdAt",
    "id",
    "immediateParentSha256",
    "method",
    "operator",
    "settings",
    "tool",
  ], [], path);
  assertStableId(value.id, childPath(path, "id"));
  assertStableId(value.artifactId, childPath(path, "artifactId"));
  assertSha256(value.artifactSha256, childPath(path, "artifactSha256"));
  assertSha256Array(value.immediateParentSha256, childPath(path, "immediateParentSha256"), { allowEmpty: false });
  assertSchemaRecord(value.tool, ["name", "version"], [], childPath(path, "tool"));
  assertString(value.tool.name, childPath(path, "tool.name"), { maxLength: 256 });
  assertString(value.tool.version, childPath(path, "tool.version"), { maxLength: 128 });
  if (!isPlainObject(value.settings)) {
    schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Settings must be a plain object", childPath(path, "settings"));
  }
  for (const key of Object.keys(value.settings).sort()) {
    if (!SETTINGS_KEY_PATTERN.test(key)) {
      schemaFail(SCHEMA_ISSUE_CODES.FIELD_SET, "Setting key is not stable", `${childPath(path, "settings")}.${key}`);
    }
    const setting = value.settings[key];
    if (typeof setting === "number") assertFiniteNumber(setting, `${childPath(path, "settings")}.${key}`);
    else if (typeof setting === "string") assertString(setting, `${childPath(path, "settings")}.${key}`, { allowEmpty: true });
    else if (typeof setting !== "boolean") {
      schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Setting value must be a string, finite number, or boolean", `${childPath(path, "settings")}.${key}`);
    }
  }
  assertString(value.operator, childPath(path, "operator"), { maxLength: 256 });
  assertStrictUtcTimestamp(value.createdAt, childPath(path, "createdAt"));
  assertEnum(value.method, METHOD_SET, childPath(path, "method"), "authoring method");
  assertEnum(value.classification, CLASSIFICATION_SET, childPath(path, "classification"), "provenance classification");
}

function validateApprovalRecordShape(value, path) {
  assertSchemaRecord(value, [
    "artifactSha256",
    "decision",
    "id",
    "layerIds",
    "notes",
    "reviewedAt",
    "reviewedPoseIds",
    "reviewedZoomPercent",
    "reviewer",
    "scope",
  ], [], path);
  assertStableId(value.id, childPath(path, "id"));
  assertEnum(value.scope, APPROVAL_SCOPE_SET, childPath(path, "scope"), "approval scope");
  assertEnum(value.decision, APPROVAL_DECISION_SET, childPath(path, "decision"), "approval decision");
  assertSha256Array(value.artifactSha256, childPath(path, "artifactSha256"));
  assertIdArray(value.layerIds, childPath(path, "layerIds"));
  const zooms = assertSchemaArray(value.reviewedZoomPercent, childPath(path, "reviewedZoomPercent"));
  zooms.forEach((zoom, index) => {
    if (zoom !== 100 && zoom !== 200) {
      schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Review zoom must be 100 or 200", indexPath(childPath(path, "reviewedZoomPercent"), index));
    }
  });
  assertUniqueValues(zooms, childPath(path, "reviewedZoomPercent"), SCHEMA_ISSUE_CODES.VALUE);
  assertIdArray(value.reviewedPoseIds, childPath(path, "reviewedPoseIds"));
  assertString(value.notes, childPath(path, "notes"), { allowEmpty: true });
  if (value.decision === "pending") {
    if (value.reviewer !== null || value.reviewedAt !== null) {
      schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Pending approvals must have null reviewer and reviewedAt", path);
    }
  } else {
    assertString(value.reviewer, childPath(path, "reviewer"), { maxLength: 256 });
    assertStrictUtcTimestamp(value.reviewedAt, childPath(path, "reviewedAt"));
    if (value.artifactSha256.length === 0) {
      schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Reviewed decisions require at least one artifact hash", childPath(path, "artifactSha256"));
    }
  }
}

const MOTION_BASE_FIELDS = [
  "approvalId",
  "direction",
  "evidence",
  "id",
  "kind",
  "layerId",
  "maxRadians",
  "minRadians",
  "phaseRadians",
  "pivot",
  "referenceRadians",
];

function validateMotionProfileShape(value, path) {
  if (!isPlainObject(value)) {
    schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Motion profile must be a plain object", path);
  }
  assertEnum(value.kind, MOTION_KIND_SET, childPath(path, "kind"), "motion kind");
  const kindFields = value.kind === "continuous-rotation"
    ? ["periodMs"]
    : value.kind === "discrete-rotation"
      ? ["cadenceMs", "stepRadians"]
      : ["amplitudeRadians", "periodMs"];
  assertSchemaRecord(value, [...MOTION_BASE_FIELDS, ...kindFields], [], path);
  assertStableId(value.id, childPath(path, "id"));
  assertStableId(value.layerId, childPath(path, "layerId"));
  assertSourcePoint(value.pivot, childPath(path, "pivot"));
  if (value.direction !== -1 && value.direction !== 1) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Motion direction must be -1 or 1", childPath(path, "direction"));
  }
  for (const field of ["phaseRadians", "minRadians", "maxRadians", "referenceRadians"]) {
    assertFiniteNumber(value[field], childPath(path, field));
  }
  if (
    value.minRadians > value.maxRadians
    || value.referenceRadians < value.minRadians
    || value.referenceRadians > value.maxRadians
  ) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Motion bounds must contain the reference angle", path);
  }
  assertEnum(value.evidence, RELATIONSHIP_EVIDENCE_SET, childPath(path, "evidence"), "motion evidence classification");
  assertStableId(value.approvalId, childPath(path, "approvalId"));
  if (value.kind === "continuous-rotation") {
    assertPositiveFinite(value.periodMs, childPath(path, "periodMs"));
  } else if (value.kind === "discrete-rotation") {
    assertPositiveFinite(value.cadenceMs, childPath(path, "cadenceMs"));
    assertFiniteNumber(value.stepRadians, childPath(path, "stepRadians"));
    if (value.stepRadians === 0) {
      schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Discrete rotation step must be nonzero", childPath(path, "stepRadians"));
    }
  } else {
    assertPositiveFinite(value.periodMs, childPath(path, "periodMs"));
    assertPositiveFinite(value.amplitudeRadians, childPath(path, "amplitudeRadians"));
    if (
      value.minRadians !== -value.amplitudeRadians
      || value.maxRadians !== value.amplitudeRadians
    ) {
      schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Oscillation bounds must be symmetric around zero", path);
    }
  }
}

function validateGearRelationshipShape(value, path) {
  assertSchemaRecord(value, [
    "approvalId",
    "direction",
    "drivenLayerId",
    "drivenToothCount",
    "driverLayerId",
    "driverToothCount",
    "evidence",
    "id",
  ], [], path);
  for (const field of ["id", "driverLayerId", "drivenLayerId", "approvalId"]) {
    assertStableId(value[field], childPath(path, field));
  }
  if (value.driverLayerId === value.drivenLayerId) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "A gear relationship requires two distinct layers", path);
  }
  assertSafeInteger(value.driverToothCount, childPath(path, "driverToothCount"), { minimum: 1 });
  assertSafeInteger(value.drivenToothCount, childPath(path, "drivenToothCount"), { minimum: 1 });
  assertLiteral(value.direction, "opposite", childPath(path, "direction"));
  assertEnum(value.evidence, RELATIONSHIP_EVIDENCE_SET, childPath(path, "evidence"), "relationship evidence classification");
}

function validateDepthLayerValueShape(value, path) {
  assertSchemaRecord(value, [
    "displacementShortAxisFraction",
    "layerId",
    "phaseRadians",
    "rotationDegrees",
    "scaleDelta",
    "zOrder",
  ], [], path);
  assertStableId(value.layerId, childPath(path, "layerId"));
  assertSafeInteger(value.zOrder, childPath(path, "zOrder"));
  for (const field of [
    "displacementShortAxisFraction",
    "scaleDelta",
    "rotationDegrees",
    "phaseRadians",
  ]) {
    assertFiniteNumber(value[field], childPath(path, field));
  }
  if (Math.abs(value.displacementShortAxisFraction) > 0.006) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Depth displacement exceeds 0.006 of the shorter axis", childPath(path, "displacementShortAxisFraction"));
  }
  if (Math.abs(value.scaleDelta) > 0.015) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Depth scale delta exceeds 0.015", childPath(path, "scaleDelta"));
  }
  if (Math.abs(value.rotationDegrees) > 1) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Depth rotation exceeds one degree", childPath(path, "rotationDegrees"));
  }
}

function validateDepthProfileShape(value, path) {
  assertSchemaRecord(value, [
    "authoredInterpretation",
    "enabled",
    "id",
    "layers",
    "periodMs",
    "profile",
  ], ["approvalId"], path);
  assertStableId(value.id, childPath(path, "id"));
  assertEnum(value.profile, PROFILE_SET, childPath(path, "profile"), "profile ID");
  assertBoolean(value.enabled, childPath(path, "enabled"));
  assertPositiveFinite(value.periodMs, childPath(path, "periodMs"));
  const layers = assertSchemaArray(value.layers, childPath(path, "layers"));
  layers.forEach((entry, index) => validateDepthLayerValueShape(entry, indexPath(childPath(path, "layers"), index)));
  assertUniqueValues(layers.map(({ layerId }) => layerId), childPath(path, "layers"));
  assertLiteral(value.authoredInterpretation, true, childPath(path, "authoredInterpretation"));
  if (value.approvalId !== undefined) {
    assertStableId(value.approvalId, childPath(path, "approvalId"));
  }
  if (value.enabled && value.approvalId === undefined) {
    schemaFail(SCHEMA_ISSUE_CODES.FIELD_SET, "Enabled depth requires approvalId", childPath(path, "approvalId"));
  }
  if (layers.length > 1) {
    const displacements = layers.map(({ displacementShortAxisFraction }) => displacementShortAxisFraction);
    const scales = layers.map(({ scaleDelta }) => scaleDelta);
    const rotations = layers.map(({ rotationDegrees }) => rotationDegrees);
    if (
      Math.max(...displacements) - Math.min(...displacements) > 0.006
      || Math.max(...scales) - Math.min(...scales) > 0.015
      || Math.max(...rotations) - Math.min(...rotations) > 1
    ) {
      schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Aggregate foreground-to-background depth delta exceeds approved bounds", childPath(path, "layers"));
    }
  }
}

function validatePhaseRecordShape(value, path) {
  assertSchemaRecord(value, [
    "assetSha256",
    "name",
    "ordinal",
    "phasePayloadSha256",
    "runtimeManifestSha256",
    "status",
  ], ["approvalId"], path);
  if (!PHASE_NAMES.includes(value.name)) {
    schemaFail(SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM, `Unsupported phase name: ${String(value.name)}`, childPath(path, "name"));
  }
  assertLiteral(value.ordinal, PHASE_NAMES.indexOf(value.name), childPath(path, "ordinal"));
  assertEnum(value.status, PHASE_STATUS_SET, childPath(path, "status"), "phase status");
  assertSha256(value.phasePayloadSha256, childPath(path, "phasePayloadSha256"));
  if (value.runtimeManifestSha256 !== null) {
    assertSha256(value.runtimeManifestSha256, childPath(path, "runtimeManifestSha256"));
  }
  assertSha256Array(value.assetSha256, childPath(path, "assetSha256"));
  if (value.approvalId !== undefined) {
    assertStableId(value.approvalId, childPath(path, "approvalId"));
  }
}

function assertPhaseSequence(value, path) {
  const phases = assertSchemaArray(value, path);
  if (phases.length !== PHASE_NAMES.length) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, `Phase list must contain exactly ${PHASE_NAMES.length} records`, path);
  }
  phases.forEach((phase, index) => {
    validatePhaseRecordShape(phase, indexPath(path, index));
    if (phase.name !== PHASE_NAMES[index]) {
      schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Phase records must use canonical delivery order", indexPath(path, index));
    }
  });
}

function validateCandidateRecordShape(value, path) {
  assertSchemaRecord(value, [
    "disposition",
    "id",
    "possibleClasses",
    "sourceRect",
    "uncertaintyNotes",
  ], [], path);
  assertStableId(value.id, childPath(path, "id"));
  assertLiteral(value.disposition, "proposed-static", childPath(path, "disposition"));
  assertSourceRect(value.sourceRect, childPath(path, "sourceRect"));
  const possible = assertSchemaArray(value.possibleClasses, childPath(path, "possibleClasses"));
  if (possible.length === 0) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Candidate must list at least one possible review class", childPath(path, "possibleClasses"));
  }
  possible.forEach((semanticClass, index) => assertEnum(
    semanticClass,
    SEMANTIC_CLASS_SET,
    indexPath(childPath(path, "possibleClasses"), index),
    "semantic class",
  ));
  assertUniqueValues(possible, childPath(path, "possibleClasses"), SCHEMA_ISSUE_CODES.VALUE);
  assertString(value.uncertaintyNotes, childPath(path, "uncertaintyNotes"));
}

function validateEncoderShape(value, path) {
  assertSchemaRecord(value, [
    "alphaQuality",
    "channels",
    "colourspace",
    "effort",
    "nearLossless",
    "quality",
    "smartSubsample",
  ], [], path);
  assertLiteral(value.colourspace, "srgb", childPath(path, "colourspace"));
  assertLiteral(value.channels, 4, childPath(path, "channels"));
  assertSafeInteger(value.quality, childPath(path, "quality"), { minimum: 1, maximum: 100 });
  assertLiteral(value.alphaQuality, 100, childPath(path, "alphaQuality"));
  assertLiteral(value.effort, 6, childPath(path, "effort"));
  assertLiteral(value.smartSubsample, true, childPath(path, "smartSubsample"));
  assertLiteral(value.nearLossless, false, childPath(path, "nearLossless"));
}

function validateColorMetadataShape(value, path) {
  assertSchemaRecord(value, ["alpha", "channels", "colourspace"], [], path);
  assertLiteral(value.colourspace, "srgb", childPath(path, "colourspace"));
  assertLiteral(value.channels, 4, childPath(path, "channels"));
  assertLiteral(value.alpha, true, childPath(path, "alpha"));
}

function validatePublicAssetRecordShape(value, path) {
  assertSchemaRecord(value, [
    "byteLength",
    "colorMetadata",
    "decodedPixelCount",
    "decodedRgbaByteLength",
    "encoder",
    "file",
    "id",
    "intrinsicHeight",
    "intrinsicWidth",
    "layerId",
    "magicSignatureHex",
    "mediaType",
    "profile",
    "publicPath",
    "sha256",
    "sourceRect",
    "zOrder",
  ], [], path);
  assertStableId(value.id, childPath(path, "id"));
  assertEnum(value.profile, PROFILE_SET, childPath(path, "profile"), "profile ID");
  if (value.layerId !== "reconstructed-background") {
    assertStableId(value.layerId, childPath(path, "layerId"));
  }
  assertSchemaProjectPath(value.file, childPath(path, "file"), {
    allowPublic: true,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory],
  });
  const expectedFilePrefix = `${CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/${value.profile}/`;
  if (!value.file.startsWith(expectedFilePrefix) || !PUBLIC_ASSET_NAME_PATTERN.test(value.file.slice(expectedFilePrefix.length))) {
    schemaFail(SCHEMA_ISSUE_CODES.PATH, "Public asset file must be a profile-local WebP path", childPath(path, "file"), LAYER_GATE_FAILURE_CODES.PATH_INVALID);
  }
  assertCanonicalPublicUrl(value.publicPath, value.profile, childPath(path, "publicPath"));
  const projectedPublicPath = `/${value.file.slice("public/".length)}`;
  if (value.publicPath !== projectedPublicPath) {
    schemaFail(
      SCHEMA_ISSUE_CODES.PATH,
      "Public asset file and publicPath must identify the same resource",
      childPath(path, "publicPath"),
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  assertLiteral(value.mediaType, "image/webp", childPath(path, "mediaType"));
  assertLowercaseHex(value.magicSignatureHex, childPath(path, "magicSignatureHex"), { minimumBytes: 12 });
  assertSha256(value.sha256, childPath(path, "sha256"));
  assertSafeInteger(value.byteLength, childPath(path, "byteLength"), { minimum: 1 });
  assertSafeInteger(value.intrinsicWidth, childPath(path, "intrinsicWidth"), { minimum: 1, maximum: CANONICAL_SOURCE_COORDINATE_SPACE.width });
  assertSafeInteger(value.intrinsicHeight, childPath(path, "intrinsicHeight"), { minimum: 1, maximum: CANONICAL_SOURCE_COORDINATE_SPACE.height });
  const decodedPixels = value.intrinsicWidth * value.intrinsicHeight;
  assertLiteral(value.decodedPixelCount, decodedPixels, childPath(path, "decodedPixelCount"));
  assertLiteral(value.decodedRgbaByteLength, decodedPixels * 4, childPath(path, "decodedRgbaByteLength"));
  assertSourceRect(value.sourceRect, childPath(path, "sourceRect"));
  assertSafeInteger(value.zOrder, childPath(path, "zOrder"));
  validateColorMetadataShape(value.colorMetadata, childPath(path, "colorMetadata"));
  validateEncoderShape(value.encoder, childPath(path, "encoder"));
}

function validateEnhancementProfileShape(value, expectedProfile, path) {
  assertSchemaRecord(value, [
    "assets",
    "decodedRgbaBytes",
    "id",
    "requestCountIncludingManifest",
    "sourceScale",
    "transferBytes",
  ], [], path);
  assertLiteral(value.id, expectedProfile, childPath(path, "id"));
  assertLiteral(value.sourceScale, expectedProfile === "compact" ? 0.5 : 1, childPath(path, "sourceScale"));
  const assets = assertSchemaArray(value.assets, childPath(path, "assets"));
  assets.forEach((asset, index) => {
    validatePublicAssetRecordShape(asset, indexPath(childPath(path, "assets"), index));
    assertLiteral(asset.profile, expectedProfile, childPath(indexPath(childPath(path, "assets"), index), "profile"));
  });
  assertUniqueValues(assets.map(({ id }) => id), childPath(path, "assets"));
  assertSafeInteger(value.transferBytes, childPath(path, "transferBytes"));
  assertSafeInteger(value.decodedRgbaBytes, childPath(path, "decodedRgbaBytes"));
  assertSafeInteger(value.requestCountIncludingManifest, childPath(path, "requestCountIncludingManifest"), { minimum: 1 });
  const transferBytes = assets.reduce((total, asset) => total + asset.byteLength, 0);
  const decodedRgbaBytes = assets.reduce((total, asset) => total + asset.decodedRgbaByteLength, 0);
  assertLiteral(value.transferBytes, transferBytes, childPath(path, "transferBytes"));
  assertLiteral(value.decodedRgbaBytes, decodedRgbaBytes, childPath(path, "decodedRgbaBytes"));
  assertLiteral(value.requestCountIncludingManifest, assets.length + 1, childPath(path, "requestCountIncludingManifest"));
}

function validateRuntimeManifestIdentityShape(value, path, { includeFile }) {
  const required = includeFile
    ? ["byteLength", "file", "mediaType", "publicPath", "sha256"]
    : ["byteLength", "mediaType", "publicPath", "sha256"];
  assertSchemaRecord(value, required, [], path);
  if (includeFile) {
    assertSchemaProjectPath(value.file, childPath(path, "file"), {
      allowPublic: true,
      expectedPath: `${CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/runtime-manifest.json`,
    });
  }
  assertLiteral(value.publicPath, "/assets/watch-2-5d/v1/runtime-manifest.json", childPath(path, "publicPath"));
  assertLiteral(value.mediaType, "application/json", childPath(path, "mediaType"));
  assertSha256(value.sha256, childPath(path, "sha256"));
  assertSafeInteger(value.byteLength, childPath(path, "byteLength"), { minimum: 1 });
}

function validateBudgetsShape(value, path) {
  assertSchemaRecord(value, Object.keys(ENHANCEMENT_BUDGETS), [], path);
  assertSchemaRecord(value.compact, Object.keys(ENHANCEMENT_BUDGETS.compact), [], childPath(path, "compact"));
  assertSchemaRecord(value.expanded, Object.keys(ENHANCEMENT_BUDGETS.expanded), [], childPath(path, "expanded"));
  for (const [field, expected] of Object.entries(ENHANCEMENT_BUDGETS)) {
    if (isPlainObject(expected)) {
      for (const [nestedField, nestedExpected] of Object.entries(expected)) {
        assertLiteral(value[field][nestedField], nestedExpected, `${childPath(path, field)}.${nestedField}`);
      }
    } else {
      assertLiteral(value[field], expected, childPath(path, field));
    }
  }
}

function validateRecordArray(value, path, validator) {
  const records = assertSchemaArray(value, path);
  records.forEach((record, index) => validator(record, indexPath(path, index)));
  assertUniqueValues(records.map(({ id }) => id), path);
  return records;
}

function assertGloballyUniqueIds(groups) {
  const seen = new Map();
  for (const { entries, path } of groups) {
    entries.forEach((entry, index) => {
      const id = entry.id;
      if (seen.has(id)) {
        schemaFail(
          SCHEMA_ISSUE_CODES.DUPLICATE_ID,
          `Identifier ${JSON.stringify(id)} duplicates ${seen.get(id)}`,
          childPath(indexPath(path, index), "id"),
        );
      }
      seen.set(id, childPath(indexPath(path, index), "id"));
    });
  }
}

function validateCommonPackageHeader(value, path) {
  assertLiteral(value.schemaVersion, 1, childPath(path, "schemaVersion"));
  assertStableId(value.packageId, childPath(path, "packageId"));
  assertString(value.packageVersion, childPath(path, "packageVersion"), { maxLength: 128 });
  assertLiteral(value.parentSpec, CANONICAL_PROJECT_PATHS.predecessorSpecDirectory, childPath(path, "parentSpec"));
  assertExactIdentity(value.canonicalMaster, APPROVED_MASTER_IDENTITY, childPath(path, "canonicalMaster"));
  assertExactIdentity(value.predecessorContract, PREDECESSOR_MANIFEST_IDENTITY, childPath(path, "predecessorContract"));
  assertSourceCoordinateSpace(value.sourceCoordinateSpace, childPath(path, "sourceCoordinateSpace"));
  assertSafeInteger(value.sourceDateEpoch, childPath(path, "sourceDateEpoch"));
}

function validateAuthoringDocumentShape(value, path) {
  assertSchemaRecord(value, [
    "approvedMovingLayerIds",
    "approvals",
    "authoredInterpretation",
    "candidateInventory",
    "canonicalMaster",
    "depthEnabled",
    "depthProfiles",
    "interpretationNotice",
    "layers",
    "masks",
    "motionProfiles",
    "packageId",
    "packageVersion",
    "parentSpec",
    "phases",
    "predecessorContract",
    "provenance",
    "reconstructions",
    "relationships",
    "schemaVersion",
    "sourceCoordinateSpace",
    "sourceDateEpoch",
  ], [], path);
  validateCommonPackageHeader(value, path);
  assertLiteral(value.authoredInterpretation, true, childPath(path, "authoredInterpretation"));
  assertLiteral(value.interpretationNotice, AUTHORING_INTERPRETATION_NOTICE, childPath(path, "interpretationNotice"));
  assertBoolean(value.depthEnabled, childPath(path, "depthEnabled"));
  assertPhaseSequence(value.phases, childPath(path, "phases"));
  const candidates = validateRecordArray(value.candidateInventory, childPath(path, "candidateInventory"), validateCandidateRecordShape);
  const masks = validateRecordArray(value.masks, childPath(path, "masks"), validateMaskRecordShape);
  const layers = validateRecordArray(value.layers, childPath(path, "layers"), validateLayerRecordShape);
  const reconstructions = validateRecordArray(value.reconstructions, childPath(path, "reconstructions"), validateReconstructionRecordShape);
  const motionProfiles = validateRecordArray(value.motionProfiles, childPath(path, "motionProfiles"), validateMotionProfileShape);
  const relationships = validateRecordArray(value.relationships, childPath(path, "relationships"), validateGearRelationshipShape);
  const depthProfiles = validateRecordArray(value.depthProfiles, childPath(path, "depthProfiles"), validateDepthProfileShape);
  const provenance = validateRecordArray(value.provenance, childPath(path, "provenance"), validateProvenanceRecordShape);
  const approvals = validateRecordArray(value.approvals, childPath(path, "approvals"), validateApprovalRecordShape);
  const approvedMovingLayerIds = assertIdArray(value.approvedMovingLayerIds, childPath(path, "approvedMovingLayerIds"));
  const approvedLayerIds = layers.filter(({ disposition }) => disposition === "approved-moving").map(({ id }) => id).sort();
  if (JSON.stringify([...approvedMovingLayerIds].sort()) !== JSON.stringify(approvedLayerIds)) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "approvedMovingLayerIds must equal the approved-moving layer set", childPath(path, "approvedMovingLayerIds"));
  }
  if (!value.depthEnabled && depthProfiles.some(({ enabled }) => enabled)) {
    schemaFail(SCHEMA_ISSUE_CODES.VALUE, "Disabled authoring depth cannot contain an enabled depth profile", childPath(path, "depthProfiles"));
  }
  assertGloballyUniqueIds([
    { entries: candidates, path: childPath(path, "candidateInventory") },
    { entries: masks, path: childPath(path, "masks") },
    { entries: layers, path: childPath(path, "layers") },
    { entries: reconstructions, path: childPath(path, "reconstructions") },
    { entries: motionProfiles, path: childPath(path, "motionProfiles") },
    { entries: relationships, path: childPath(path, "relationships") },
    { entries: depthProfiles, path: childPath(path, "depthProfiles") },
    { entries: provenance, path: childPath(path, "provenance") },
    { entries: approvals, path: childPath(path, "approvals") },
  ]);
  const fillEntries = reconstructions.map(({ fillId }) => ({ id: fillId }));
  assertGloballyUniqueIds([
    ...[
      { entries: candidates, path: childPath(path, "candidateInventory") },
      { entries: masks, path: childPath(path, "masks") },
      { entries: layers, path: childPath(path, "layers") },
      { entries: reconstructions, path: childPath(path, "reconstructions") },
      { entries: motionProfiles, path: childPath(path, "motionProfiles") },
      { entries: relationships, path: childPath(path, "relationships") },
      { entries: depthProfiles, path: childPath(path, "depthProfiles") },
      { entries: provenance, path: childPath(path, "provenance") },
      { entries: approvals, path: childPath(path, "approvals") },
    ],
    { entries: fillEntries, path: childPath(path, "reconstructions") },
  ]);
}

function validateLayerAssetManifestShape(value, path) {
  assertSchemaRecord(value, [
    "approvals",
    "budgets",
    "canonicalMaster",
    "depthProfiles",
    "layers",
    "masks",
    "motionProfiles",
    "packageId",
    "packageVersion",
    "parentSpec",
    "phases",
    "predecessorContract",
    "provenance",
    "publicAssets",
    "reconstructions",
    "relationships",
    "runtimeManifest",
    "schemaVersion",
    "sourceCoordinateSpace",
    "sourceDateEpoch",
  ], [], path);
  validateCommonPackageHeader(value, path);
  assertPhaseSequence(value.phases, childPath(path, "phases"));
  const masks = validateRecordArray(value.masks, childPath(path, "masks"), validateMaskRecordShape);
  const layers = validateRecordArray(value.layers, childPath(path, "layers"), validateLayerRecordShape);
  const reconstructions = validateRecordArray(value.reconstructions, childPath(path, "reconstructions"), validateReconstructionRecordShape);
  const motionProfiles = validateRecordArray(value.motionProfiles, childPath(path, "motionProfiles"), validateMotionProfileShape);
  const relationships = validateRecordArray(value.relationships, childPath(path, "relationships"), validateGearRelationshipShape);
  const depthProfiles = validateRecordArray(value.depthProfiles, childPath(path, "depthProfiles"), validateDepthProfileShape);
  const provenance = validateRecordArray(value.provenance, childPath(path, "provenance"), validateProvenanceRecordShape);
  const approvals = validateRecordArray(value.approvals, childPath(path, "approvals"), validateApprovalRecordShape);
  const publicAssets = validateRecordArray(value.publicAssets, childPath(path, "publicAssets"), validatePublicAssetRecordShape);
  if (value.runtimeManifest !== null) {
    validateRuntimeManifestIdentityShape(value.runtimeManifest, childPath(path, "runtimeManifest"), { includeFile: true });
  }
  validateBudgetsShape(value.budgets, childPath(path, "budgets"));
  const fillEntries = reconstructions.map(({ fillId }) => ({ id: fillId }));
  assertGloballyUniqueIds([
    { entries: masks, path: childPath(path, "masks") },
    { entries: layers, path: childPath(path, "layers") },
    { entries: reconstructions, path: childPath(path, "reconstructions") },
    { entries: fillEntries, path: childPath(path, "reconstructions") },
    { entries: motionProfiles, path: childPath(path, "motionProfiles") },
    { entries: relationships, path: childPath(path, "relationships") },
    { entries: depthProfiles, path: childPath(path, "depthProfiles") },
    { entries: provenance, path: childPath(path, "provenance") },
    { entries: approvals, path: childPath(path, "approvals") },
    { entries: publicAssets, path: childPath(path, "publicAssets") },
  ]);
}

function validateRuntimeManifestShape(value, path) {
  assertSchemaRecord(value, [
    "canonicalMasterSha256",
    "depthProfiles",
    "motionProfiles",
    "packageId",
    "phase",
    "profiles",
    "releaseId",
    "schemaVersion",
  ], [], path);
  assertLiteral(value.schemaVersion, 1, childPath(path, "schemaVersion"));
  assertStableId(value.packageId, childPath(path, "packageId"));
  assertStableId(value.releaseId, childPath(path, "releaseId"));
  assertLiteral(value.canonicalMasterSha256, APPROVED_MASTER_IDENTITY.sha256, childPath(path, "canonicalMasterSha256"));
  if (!["static-layered-reconstruction", "approved-part-motion", "optional-depth"].includes(value.phase)) {
    schemaFail(SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM, `Unsupported runtime phase: ${String(value.phase)}`, childPath(path, "phase"));
  }
  assertSchemaRecord(value.profiles, ["compact", "expanded"], [], childPath(path, "profiles"));
  validateEnhancementProfileShape(value.profiles.compact, "compact", childPath(path, "profiles.compact"));
  validateEnhancementProfileShape(value.profiles.expanded, "expanded", childPath(path, "profiles.expanded"));
  const motionProfiles = validateRecordArray(value.motionProfiles, childPath(path, "motionProfiles"), validateMotionProfileShape);
  const depthProfiles = validateRecordArray(value.depthProfiles, childPath(path, "depthProfiles"), validateDepthProfileShape);
  assertGloballyUniqueIds([
    { entries: value.profiles.compact.assets, path: childPath(path, "profiles.compact.assets") },
    { entries: value.profiles.expanded.assets, path: childPath(path, "profiles.expanded.assets") },
    { entries: motionProfiles, path: childPath(path, "motionProfiles") },
    { entries: depthProfiles, path: childPath(path, "depthProfiles") },
  ]);
}

function validateReleasePointerShape(value, path) {
  if (!isPlainObject(value)) {
    schemaFail(SCHEMA_ISSUE_CODES.TYPE, "Release pointer must be a plain object", path);
  }
  if (value.status === "fallback-only") {
    assertSchemaRecord(value, ["depthEnabled", "runtimeManifest", "schemaVersion", "status"], [], path);
    assertLiteral(value.schemaVersion, 1, childPath(path, "schemaVersion"));
    assertLiteral(value.runtimeManifest, null, childPath(path, "runtimeManifest"));
    assertLiteral(value.depthEnabled, false, childPath(path, "depthEnabled"));
    return;
  }
  if (value.status === "ready") {
    assertSchemaRecord(value, [
      "depthEnabled",
      "packageId",
      "releaseId",
      "runtimeManifest",
      "schemaVersion",
      "status",
    ], [], path);
    assertLiteral(value.schemaVersion, 1, childPath(path, "schemaVersion"));
    assertStableId(value.releaseId, childPath(path, "releaseId"));
    assertStableId(value.packageId, childPath(path, "packageId"));
    validateRuntimeManifestIdentityShape(value.runtimeManifest, childPath(path, "runtimeManifest"), { includeFile: false });
    assertBoolean(value.depthEnabled, childPath(path, "depthEnabled"));
    return;
  }
  schemaFail(SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM, `Unsupported release status: ${String(value.status)}`, childPath(path, "status"));
}

function createStrictSchema(name, validator) {
  const schema = {
    name,
    parse(value) {
      validator(value, "$" );
      return canonicalizeJson(value);
    },
    parseJson(input, options = {}) {
      return schema.parse(parseCanonicalJson(input, options));
    },
    safeParse(value) {
      try {
        return Object.freeze({ data: schema.parse(value), success: true });
      } catch (error) {
        if (error instanceof WatchLayerSchemaError || error instanceof CanonicalJsonError) {
          return Object.freeze({ error, success: false });
        }
        throw error;
      }
    },
    serialize(value) {
      return serializeCanonicalJson(schema.parse(value));
    },
    serializeLine(value) {
      return serializeCanonicalJsonLine(schema.parse(value));
    },
    stringify(value) {
      return canonicalJsonStringify(schema.parse(value));
    },
  };
  return Object.freeze(schema);
}

export const MASK_RECORD_SCHEMA = createStrictSchema("MaskRecord", validateMaskRecordShape);
export const LAYER_RECORD_SCHEMA = createStrictSchema("LayerRecord", validateLayerRecordShape);
export const RECONSTRUCTION_RECORD_SCHEMA = createStrictSchema("ReconstructionRecord", validateReconstructionRecordShape);
export const PROVENANCE_RECORD_SCHEMA = createStrictSchema("ProvenanceRecord", validateProvenanceRecordShape);
export const APPROVAL_RECORD_SCHEMA = createStrictSchema("ApprovalRecord", validateApprovalRecordShape);
export const MOTION_PROFILE_SCHEMA = createStrictSchema("MotionProfile", validateMotionProfileShape);
export const GEAR_RELATIONSHIP_SCHEMA = createStrictSchema("GearRelationship", validateGearRelationshipShape);
export const DEPTH_PROFILE_SCHEMA = createStrictSchema("DepthProfile", validateDepthProfileShape);
export const PHASE_RECORD_SCHEMA = createStrictSchema("PhaseRecord", validatePhaseRecordShape);
export const PUBLIC_ASSET_RECORD_SCHEMA = createStrictSchema("PublicAssetRecord", validatePublicAssetRecordShape);
export const AUTHORING_DOCUMENT_SCHEMA = createStrictSchema("AuthoringDocument", validateAuthoringDocumentShape);
export const LAYER_ASSET_MANIFEST_SCHEMA = createStrictSchema("LayerAssetManifest", validateLayerAssetManifestShape);
export const RUNTIME_MANIFEST_SCHEMA = createStrictSchema("RuntimeManifest", validateRuntimeManifestShape);
export const RELEASE_POINTER_SCHEMA = createStrictSchema("WatchLayerRelease", validateReleasePointerShape);

export const WATCH_LAYER_SCHEMAS = deepFreeze({
  approval: APPROVAL_RECORD_SCHEMA,
  authoring: AUTHORING_DOCUMENT_SCHEMA,
  depth: DEPTH_PROFILE_SCHEMA,
  layer: LAYER_RECORD_SCHEMA,
  manifest: LAYER_ASSET_MANIFEST_SCHEMA,
  mask: MASK_RECORD_SCHEMA,
  motion: MOTION_PROFILE_SCHEMA,
  phase: PHASE_RECORD_SCHEMA,
  provenance: PROVENANCE_RECORD_SCHEMA,
  publicAsset: PUBLIC_ASSET_RECORD_SCHEMA,
  reconstruction: RECONSTRUCTION_RECORD_SCHEMA,
  relationship: GEAR_RELATIONSHIP_SCHEMA,
  release: RELEASE_POINTER_SCHEMA,
  runtimeManifest: RUNTIME_MANIFEST_SCHEMA,
});

export const SCHEMAS = WATCH_LAYER_SCHEMAS;

export function validateMaskRecord(value) { return MASK_RECORD_SCHEMA.parse(value); }
export function validateLayerRecord(value) { return LAYER_RECORD_SCHEMA.parse(value); }
export function validateReconstructionRecord(value) { return RECONSTRUCTION_RECORD_SCHEMA.parse(value); }
export function validateProvenanceRecord(value) { return PROVENANCE_RECORD_SCHEMA.parse(value); }
export function validateApprovalRecord(value) { return APPROVAL_RECORD_SCHEMA.parse(value); }
export function validateMotionProfile(value) { return MOTION_PROFILE_SCHEMA.parse(value); }
export function validateGearRelationship(value) { return GEAR_RELATIONSHIP_SCHEMA.parse(value); }
export function validateDepthProfile(value) { return DEPTH_PROFILE_SCHEMA.parse(value); }
export function validatePhaseRecord(value) { return PHASE_RECORD_SCHEMA.parse(value); }
export function validatePublicAssetRecord(value) { return PUBLIC_ASSET_RECORD_SCHEMA.parse(value); }
export function validateAuthoringDocument(value) { return AUTHORING_DOCUMENT_SCHEMA.parse(value); }
export function validateLayerAssetManifest(value) { return LAYER_ASSET_MANIFEST_SCHEMA.parse(value); }
export function validateRuntimeManifest(value) { return RUNTIME_MANIFEST_SCHEMA.parse(value); }
export function validateReleasePointer(value) { return RELEASE_POINTER_SCHEMA.parse(value); }

export const parseAuthoringDocument = validateAuthoringDocument;
export const parseLayerAssetManifest = validateLayerAssetManifest;
export const parseRuntimeManifest = validateRuntimeManifest;
export const parseReleasePointer = validateReleasePointer;
