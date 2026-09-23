import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
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
  AUTHORING_DOCUMENT_SCHEMA,
  CANONICAL_PROJECT_PATHS,
  DEFAULT_PROJECT_ROOT,
  LAYER_GATE_FAILURE_CODES,
  assertApprovedMasterIdentity,
  assertInputHashSnapshotUnchanged,
  assertSafeProjectRelativePath,
  createInputHashSnapshot,
  inspectSafeRegularFile,
  resolveSafeProjectPath,
} from "./watch-2-5d/contract.mjs";
import {
  CANDIDATE_EVIDENCE_DIRECTORY,
  CANDIDATE_EVIDENCE_INDEX_PATH,
  REVIEW_EVIDENCE_ISSUE_CODES,
  renderCandidateReviewEvidence,
} from "./watch-2-5d/review-evidence.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const GENERATED_RELATIVE_PATH_PATTERNS = Object.freeze([
  /^index\.json$/u,
  /^contact-sheets\/contact-sheet-(?:100|200)-\d{3}\.png$/u,
  /^candidates\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/(?:crop|alpha-reviewer-aid|edge-contrast-reviewer-aid)-(?:100|200)\.png$/u,
]);
const USAGE = `Usage:
  node scripts/inspect-watch-layer-candidates.mjs [--project-root <path>]

The inspector reads only the canonical master and strict authoring.json candidate
inventory, then atomically writes deterministic review-only evidence beneath:
  ${CANDIDATE_EVIDENCE_DIRECTORY}/

It accepts no source, output, status, approval, mask, fill, public-asset, or release
override. Edge, contrast, and alpha outputs are reviewer aids only and make no
semantic or visual approval decision.`;

export const CANDIDATE_INSPECTOR_ISSUE_CODES = Object.freeze({
  ARGUMENT_INVALID: "INSPECTOR_ARGUMENT_INVALID",
  AUTHORING_INVALID: "INSPECTOR_AUTHORING_INVALID",
  NETWORK_DISABLED: "INSPECTOR_NETWORK_DISABLED",
  OUTPUT_INVALID: "INSPECTOR_OUTPUT_INVALID",
  OUTPUT_UNSAFE: "INSPECTOR_OUTPUT_UNSAFE",
  PUBLICATION_FAILED: "INSPECTOR_PUBLICATION_FAILED",
});

export class CandidateInspectorError extends Error {
  constructor(issueCode, message, path = "$", code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID) {
    super(message);
    this.code = code;
    this.issueCode = issueCode;
    this.name = "CandidateInspectorError";
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

function fail(issueCode, message, path = "$", code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID) {
  throw new CandidateInspectorError(issueCode, message, path, code);
}

function isMissing(error) {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT";
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isContainedAbsolutePath(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !fromRoot.startsWith("/")
  );
}

function projectPathFromAbsolute(projectRoot, absolutePath) {
  if (!isContainedAbsolutePath(projectRoot, absolutePath)) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
      "Inspector path escapes the project root",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

/** Run one operation with browser-style network entry points replaced by fail-closed guards. */
export async function withCandidateInspectorNetworkDisabled(operation) {
  if (typeof operation !== "function") {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
      "Network-disabled operation must be a function",
    );
  }
  const names = ["fetch", "WebSocket", "XMLHttpRequest"];
  const descriptors = new Map();
  const installed = [];
  const guard = function candidateInspectorNetworkGuard() {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.NETWORK_DISABLED,
      "Candidate inspection forbids network access",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  };

  try {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      if (descriptor !== undefined && descriptor.configurable === false) {
        fail(
          CANDIDATE_INSPECTOR_ISSUE_CODES.NETWORK_DISABLED,
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

async function assertExistingDirectory(path, projectRelativePath) {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
      "Required review output parent is missing or unreadable",
      projectRelativePath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
      "Review output parent must be a regular non-symlink directory",
      projectRelativePath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
}

async function assertSafeReviewDirectory(projectRoot) {
  const root = resolve(projectRoot);
  await assertExistingDirectory(root, ".");
  let current = root;
  for (const segment of CANONICAL_PROJECT_PATHS.successorReviewDirectory.split("/")) {
    current = resolve(current, segment);
    await assertExistingDirectory(
      current,
      projectPathFromAbsolute(root, current),
    );
  }
  const expected = resolveSafeProjectPath(
    CANONICAL_PROJECT_PATHS.successorReviewDirectory,
    {
      allowPublic: false,
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
      projectRoot: root,
    },
  );
  if (current !== expected) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
      "Review output directory differs from its canonical safe path",
      CANONICAL_PROJECT_PATHS.successorReviewDirectory,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return current;
}

function generatedRelativePath(outputPath) {
  const normalized = assertSafeProjectRelativePath(outputPath, {
    allowPublic: false,
    allowedRoots: [CANDIDATE_EVIDENCE_DIRECTORY],
  });
  if (!normalized.startsWith(`${CANDIDATE_EVIDENCE_DIRECTORY}/`)) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_INVALID,
      "Generated output must be below the canonical candidate evidence directory",
      normalized,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const child = normalized.slice(CANDIDATE_EVIDENCE_DIRECTORY.length + 1);
  if (!GENERATED_RELATIVE_PATH_PATTERNS.some((pattern) => pattern.test(child))) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_INVALID,
      "Generated output path is not a recognized review-evidence member",
      normalized,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return child;
}

async function collectPackageFiles(root, relativeDirectory = "") {
  const directory = relativeDirectory === "" ? root : resolve(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
      "Generated evidence directory cannot be read safely",
      relativeDirectory || CANDIDATE_EVIDENCE_DIRECTORY,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const files = [];
  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    if (entry.isSymbolicLink()) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
        "Generated evidence package must not contain symbolic links",
        relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    const child = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectPackageFiles(root, child));
    } else if (entry.isFile()) {
      if (!GENERATED_RELATIVE_PATH_PATTERNS.some((pattern) => pattern.test(child))) {
        fail(
          CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
          "Generated evidence package contains an unrecognized file",
          child,
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        );
      }
      files.push(child);
    } else {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
        "Generated evidence package contains a non-regular entry",
        child,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  return files;
}

async function inspectExistingPackage(path) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return false;
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
      "Existing evidence package cannot be inspected",
      CANDIDATE_EVIDENCE_DIRECTORY,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
      "Existing evidence package must be a regular non-symlink directory",
      CANDIDATE_EVIDENCE_DIRECTORY,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  await collectPackageFiles(path);
  return true;
}

function expectedOutputMap(outputs) {
  const expected = new Map();
  for (const output of outputs) {
    const relativePath = generatedRelativePath(output.path);
    if (expected.has(relativePath)) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_INVALID,
        "Evidence renderer returned a duplicate output path",
        output.path,
      );
    }
    if (!Buffer.isBuffer(output.bytes)) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_INVALID,
        "Evidence renderer returned non-buffer output bytes",
        output.path,
      );
    }
    expected.set(relativePath, output.bytes);
  }
  if (!expected.has("index.json")) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_INVALID,
      "Evidence renderer did not return the canonical hash index",
      CANDIDATE_EVIDENCE_INDEX_PATH,
    );
  }
  return expected;
}

async function packageMatches(path, expected, { throwOnMismatch = false } = {}) {
  const exists = await inspectExistingPackage(path);
  if (!exists) {
    if (throwOnMismatch) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.PUBLICATION_FAILED,
        "Published evidence package is missing",
        CANDIDATE_EVIDENCE_DIRECTORY,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }
    return false;
  }
  const actualPaths = await collectPackageFiles(path);
  const expectedPaths = [...expected.keys()].sort(lexicalCompare);
  if (
    actualPaths.length !== expectedPaths.length
    || actualPaths.some((entry, index) => entry !== expectedPaths[index])
  ) {
    if (throwOnMismatch) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.PUBLICATION_FAILED,
        "Published evidence membership differs from generated output",
        CANDIDATE_EVIDENCE_DIRECTORY,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }
    return false;
  }
  for (const relativePath of expectedPaths) {
    let actual;
    try {
      actual = await readFile(resolve(path, relativePath));
    } catch {
      if (throwOnMismatch) {
        fail(
          CANDIDATE_INSPECTOR_ISSUE_CODES.PUBLICATION_FAILED,
          "Published evidence file cannot be read",
          `${CANDIDATE_EVIDENCE_DIRECTORY}/${relativePath}`,
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }
      return false;
    }
    if (!actual.equals(expected.get(relativePath))) {
      if (throwOnMismatch) {
        fail(
          CANDIDATE_INSPECTOR_ISSUE_CODES.PUBLICATION_FAILED,
          "Published evidence bytes differ from generated output",
          `${CANDIDATE_EVIDENCE_DIRECTORY}/${relativePath}`,
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }
      return false;
    }
  }
  return true;
}

async function writeStagedPackage(packagePath, expected) {
  await mkdir(packagePath, { mode: 0o755 });
  for (const relativePath of [...expected.keys()].sort(lexicalCompare)) {
    const absolutePath = resolve(packagePath, relativePath);
    if (!isContainedAbsolutePath(packagePath, absolutePath)) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.OUTPUT_UNSAFE,
        "Staged output escapes its isolated package directory",
        relativePath,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    await mkdir(dirname(absolutePath), { mode: 0o755, recursive: true });
    await writeFile(absolutePath, expected.get(relativePath), {
      flag: "wx",
      mode: 0o644,
    });
  }
  await packageMatches(packagePath, expected, { throwOnMismatch: true });
}

async function publishEvidencePackage({
  beforeInputs,
  outputs,
  projectRoot,
}) {
  const reviewDirectory = await assertSafeReviewDirectory(projectRoot);
  const finalPath = resolveSafeProjectPath(CANDIDATE_EVIDENCE_DIRECTORY, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
    projectRoot,
  });
  const expected = expectedOutputMap(outputs);
  if (await packageMatches(finalPath, expected)) {
    await assertInputHashSnapshotUnchanged(beforeInputs, { projectRoot });
    return false;
  }

  const workDirectory = await mkdtemp(resolve(reviewDirectory, ".candidate-evidence-work-"));
  const stagedPackage = resolve(workDirectory, "package");
  const previousPackage = resolve(workDirectory, "previous");
  let hadPrevious = false;
  let published = false;
  try {
    await writeStagedPackage(stagedPackage, expected);
    await assertInputHashSnapshotUnchanged(beforeInputs, { projectRoot });
    hadPrevious = await inspectExistingPackage(finalPath);
    if (hadPrevious) await rename(finalPath, previousPackage);
    try {
      await rename(stagedPackage, finalPath);
      published = true;
      await packageMatches(finalPath, expected, { throwOnMismatch: true });
      await assertInputHashSnapshotUnchanged(beforeInputs, { projectRoot });
    } catch (error) {
      if (published) {
        await rm(finalPath, { force: true, recursive: true });
        published = false;
      }
      if (hadPrevious) await rename(previousPackage, finalPath);
      throw error;
    }
    if (hadPrevious) await rm(previousPackage, { recursive: true });
    return true;
  } finally {
    await rm(workDirectory, { force: true, recursive: true });
  }
}

/**
 * Validate immutable inputs, render evidence, and publish only the tool-owned review
 * package. Candidate dispositions, approvals, masks, fills, public assets, and the
 * fallback-only release are never write targets.
 */
export async function inspectWatchLayerCandidates({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const root = resolve(projectRoot);
  return withCandidateInspectorNetworkDisabled(async () => {
    const inputPaths = [
      CANONICAL_PROJECT_PATHS.canonicalMaster,
      CANONICAL_PROJECT_PATHS.successorAuthoring,
    ];
    const beforeInputs = await createInputHashSnapshot(inputPaths, {
      projectRoot: root,
    });
    const approvedMaster = await assertApprovedMasterIdentity({ projectRoot: root });
    const master = await inspectSafeRegularFile(
      CANONICAL_PROJECT_PATHS.canonicalMaster,
      {
        allowPublic: false,
        expectedPath: CANONICAL_PROJECT_PATHS.canonicalMaster,
        projectRoot: root,
      },
    );
    if (
      master.identity.byteLength !== approvedMaster.byteLength
      || master.identity.sha256 !== approvedMaster.sha256
    ) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_IDENTITY_MISMATCH,
        "Canonical source changed between identity checks",
        CANONICAL_PROJECT_PATHS.canonicalMaster,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }

    const authoring = await inspectSafeRegularFile(
      CANONICAL_PROJECT_PATHS.successorAuthoring,
      {
        allowPublic: false,
        allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
        expectedPath: CANONICAL_PROJECT_PATHS.successorAuthoring,
        projectRoot: root,
      },
    );
    let document;
    try {
      document = AUTHORING_DOCUMENT_SCHEMA.parseJson(authoring.bytes, {
        allowTrailingNewline: true,
        requireCanonical: true,
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.AUTHORING_INVALID,
        "Authoring document cannot be parsed by the strict schema",
        CANONICAL_PROJECT_PATHS.successorAuthoring,
      );
    }

    const rendered = await renderCandidateReviewEvidence({
      authoringIdentity: authoring.identity,
      candidateInventory: document.candidateInventory,
      sourceBytes: master.bytes,
      sourceHeight: APPROVED_MASTER_IDENTITY.intrinsicHeight,
      sourceIdentity: master.identity,
      sourceWidth: APPROVED_MASTER_IDENTITY.intrinsicWidth,
    });
    await assertInputHashSnapshotUnchanged(beforeInputs, { projectRoot: root });

    const changed = await publishEvidencePackage({
      beforeInputs,
      outputs: rendered.outputs,
      projectRoot: root,
    });
    await assertInputHashSnapshotUnchanged(beforeInputs, { projectRoot: root });

    return Object.freeze({
      artifactCount: rendered.artifactRecords.length,
      candidateCount: document.candidateInventory.length,
      changed,
      indexIdentity: rendered.indexIdentity,
      indexPath: CANDIDATE_EVIDENCE_INDEX_PATH,
      sourceIdentity: approvedMaster,
    });
  });
}

export const runCandidateInspector = inspectWatchLayerCandidates;

export function parseCandidateInspectorArguments(argv) {
  if (!Array.isArray(argv)) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
      "CLI arguments must be an array",
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      if (parsed.help) {
        fail(
          CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
          "--help may be supplied only once",
          flag,
        );
      }
      parsed.help = true;
      continue;
    }
    if (flag !== "--project-root") {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
        `Unknown argument ${String(flag)}`,
        String(flag),
      );
    }
    if (parsed.projectRoot !== undefined) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
        "--project-root may be supplied only once",
        flag,
      );
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      fail(
        CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
        "--project-root requires one path value",
        flag,
      );
    }
    parsed.projectRoot = value;
    index += 1;
  }
  if (parsed.help && parsed.projectRoot !== undefined) {
    fail(
      CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
      "--help cannot be combined with --project-root",
      "--help",
    );
  }
  return Object.freeze(parsed);
}

function formatFailure(error) {
  if (error && typeof error === "object" && "code" in error) {
    const issue = "issueCode" in error ? `/${String(error.issueCode)}` : "";
    const message = "message" in error
      ? String(error.message)
      : "Candidate inspection failed";
    return `${String(error.code)}${issue}: ${message}`;
  }
  return `${LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function runCandidateInspectorCli(argv = process.argv.slice(2)) {
  const parsed = parseCandidateInspectorArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return null;
  }
  const result = await inspectWatchLayerCandidates({
    projectRoot: parsed.projectRoot ?? DEFAULT_PROJECT_ROOT,
  });
  console.log(
    `WATCH_LAYER_CANDIDATE_EVIDENCE_OK ${result.candidateCount} candidates ${result.artifactCount} artifacts ${result.indexPath} ${result.indexIdentity.sha256}`,
  );
  return result;
}

async function main() {
  try {
    await runCandidateInspectorCli();
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  await main();
}
