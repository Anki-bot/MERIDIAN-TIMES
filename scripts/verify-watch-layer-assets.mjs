import dns from "node:dns";
import dgram from "node:dgram";
import fs from "node:fs";
import fsPromises, {
  lstat,
  readdir,
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { resolve } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { verifyWatchImageAssets } from "./verify-watch-image-assets.mjs";
import {
  createReviewSetApprovalExpectation,
  evaluateApprovalClosure,
  validateReviewerApprovalRecord,
} from "./watch-2-5d/approval-records.mjs";
import { loadWatchLayerAuthoring } from "./watch-2-5d/authoring-loader.mjs";
import {
  APPROVED_MASTER_IDENTITY,
  AUTHORING_DOCUMENT_SCHEMA,
  CANONICAL_IDENTITY_MATRIX,
  CANONICAL_PROJECT_PATHS,
  DEFAULT_PROJECT_ROOT,
  DEPTH_PROFILE_SCHEMA,
  ENHANCEMENT_BUDGETS,
  GEAR_RELATIONSHIP_SCHEMA,
  LAYER_ASSET_MANIFEST_SCHEMA,
  LAYER_GATE_FAILURE_CODES,
  LAYER_RECORD_SCHEMA,
  MOTION_PROFILE_SCHEMA,
  PREDECESSOR_MANIFEST_IDENTITY,
  RELEASE_POINTER_SCHEMA,
  RUNTIME_MANIFEST_SCHEMA,
  APPROVAL_RECORD_SCHEMA,
  assertApprovedMasterIdentity,
  assertInputHashSnapshotUnchanged,
  assertPredecessorManifestIdentity,
  assertSafeProjectRelativePath,
  canonicalJsonStringify,
  createInputHashSnapshot,
  inspectApprovedDependencyFields,
  inspectSafeRegularFile,
  parseCanonicalJson,
  serializeCanonicalJson,
  sha256,
} from "./watch-2-5d/contract.mjs";
import {
  createSourceSpaceFidelityReport,
} from "./watch-2-5d/fidelity.mjs";
import {
  compositeOrderedLayers,
  composeReconstructedBackground,
  createMaskRaster,
  resolveOrderedOverlap,
  unionMasks,
} from "./watch-2-5d/image-operations.mjs";
import {
  evaluateManifestClosure,
  hashPhaseProjection,
} from "./watch-2-5d/manifest-closure.mjs";
import {
  LAYER_REVIEW_EVIDENCE_INDEX_PATH,
  validateLayerReviewEvidenceIndex,
} from "./watch-2-5d/review-evidence.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const PRESERVATION_FIXTURE_PATH = "tests/fixtures/glass-header-hover-preservation.sha256";
const PRESERVATION_FIXTURE_IDENTITY = Object.freeze({
  byteLength: 5_528,
  sha256: "888b8818bf6839b33f8d3bd3787ffa44d25ea90f19ed9ebc8ead5a9a24e3cb71",
});
const WATCH_LAYER_RUNTIME_MANIFEST_PATH =
  `${CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/runtime-manifest.json`;
const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";
const WEBP_PREFIX_BYTES = 12;
const PROTECTED_WATCH_SELECTOR_PATTERN = /\.(?:watch-(?:canvas-shell|static-fallback)|static-(?:case|gear|balance|bridge|jewel))[\w-]*/u;
const PREDECESSOR_PUBLIC_ASSET_PATHS = Object.freeze([
  "public/assets/watch/elite-watch-1035.avif",
  "public/assets/watch/elite-watch-1035.webp",
  "public/assets/watch/elite-watch-1380.avif",
  "public/assets/watch/elite-watch-1380.webp",
  "public/assets/watch/elite-watch-2070.avif",
  "public/assets/watch/elite-watch-2070.webp",
  "public/assets/watch/elite-watch-2760.avif",
  "public/assets/watch/elite-watch-2760.webp",
  "public/assets/watch/elite-watch-690.avif",
  "public/assets/watch/elite-watch-690.webp",
]);
const APPROVED_FAILURE_CODE_SET = new Set(Object.values(LAYER_GATE_FAILURE_CODES));
const IDENTITY_MATRIX_TEXT = canonicalJsonStringify(CANONICAL_IDENTITY_MATRIX);

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

export const WATCH_LAYER_GATE_ORDER = Object.freeze([
  "predecessor",
  "protected-integrity",
  "schema-path",
  "identities",
  "provenance-approvals",
  "segmentation",
  "reconstruction",
  "fidelity-coverage",
  "motion",
  "depth",
  "public-assets-runtime-manifest",
  "budgets",
  "input-hashes",
]);

export const WATCH_LAYER_VERIFY_ISSUE_CODES = Object.freeze({
  APPROVAL_INCOMPLETE: "LAYER_VERIFY_APPROVAL_INCOMPLETE",
  ARGUMENT_INVALID: "LAYER_VERIFY_ARGUMENT_INVALID",
  BUDGET_INVALID: "LAYER_VERIFY_BUDGET_INVALID",
  DEPTH_INVALID: "LAYER_VERIFY_DEPTH_INVALID",
  FIDELITY_INCOMPLETE: "LAYER_VERIFY_FIDELITY_INCOMPLETE",
  FILESYSTEM_MUTATION_FORBIDDEN: "LAYER_VERIFY_FILESYSTEM_MUTATION_FORBIDDEN",
  IDENTITY_INVALID: "LAYER_VERIFY_IDENTITY_INVALID",
  INPUT_CHANGED: "LAYER_VERIFY_INPUT_CHANGED",
  MANIFEST_MISSING: "LAYER_VERIFY_MANIFEST_MISSING",
  MOTION_INVALID: "LAYER_VERIFY_MOTION_INVALID",
  NETWORK_FORBIDDEN: "LAYER_VERIFY_NETWORK_FORBIDDEN",
  PATH_INVALID: "LAYER_VERIFY_PATH_INVALID",
  PREDECESSOR_INVALID: "LAYER_VERIFY_PREDECESSOR_INVALID",
  PROTECTED_INTEGRITY_INVALID: "LAYER_VERIFY_PROTECTED_INTEGRITY_INVALID",
  PROVENANCE_INVALID: "LAYER_VERIFY_PROVENANCE_INVALID",
  PUBLIC_ASSET_INVALID: "LAYER_VERIFY_PUBLIC_ASSET_INVALID",
  RECONSTRUCTION_INVALID: "LAYER_VERIFY_RECONSTRUCTION_INVALID",
  SCHEMA_INVALID: "LAYER_VERIFY_SCHEMA_INVALID",
  SEGMENTATION_INVALID: "LAYER_VERIFY_SEGMENTATION_INVALID",
});

export class WatchLayerVerificationError extends Error {
  constructor(code, issueCode, message, path = "$") {
    super(message);
    this.code = code;
    this.failure = Object.freeze({ code, issueCode, message, ok: false, path });
    this.issueCode = issueCode;
    this.name = "WatchLayerVerificationError";
    this.path = path;
  }

  toJSON() {
    return this.failure;
  }
}

function fail(code, issueCode, message, path = "$") {
  if (!APPROVED_FAILURE_CODE_SET.has(code)) {
    throw new TypeError(`Unsupported layer-gate failure code: ${String(code)}`);
  }
  throw new WatchLayerVerificationError(code, issueCode, message, path);
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

function arraysEqual(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function setsEqual(left, right) {
  return arraysEqual([...left].sort(lexicalCompare), [...right].sort(lexicalCompare));
}

function canonicalEqual(left, right) {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function stablePathFromError(error, fallback = "$") {
  return error !== null
    && typeof error === "object"
    && "path" in error
    && typeof error.path === "string"
    ? error.path
    : fallback;
}

function stableIssueFromError(error, fallback) {
  return error !== null
    && typeof error === "object"
    && "issueCode" in error
    && typeof error.issueCode === "string"
    ? error.issueCode
    : fallback;
}

function normalizeGateError(error, fallbackCode, fallbackIssue, fallbackMessage) {
  if (error instanceof WatchLayerVerificationError) return error;
  if (
    error !== null
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && APPROVED_FAILURE_CODE_SET.has(error.code)
  ) {
    return new WatchLayerVerificationError(
      error.code,
      stableIssueFromError(error, fallbackIssue),
      error instanceof Error ? error.message : fallbackMessage,
      stablePathFromError(error),
    );
  }
  return new WatchLayerVerificationError(
    fallbackCode,
    fallbackIssue,
    error instanceof Error ? error.message : fallbackMessage,
    stablePathFromError(error),
  );
}

function isPromiseLike(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function runGate(context, name, fallbackCode, fallbackIssue, operation) {
  context.completedGates.push(name);
  try {
    const result = operation();
    if (!isPromiseLike(result)) return result;
    return Promise.resolve(result).catch((error) => {
      throw normalizeGateError(
        error,
        fallbackCode,
        fallbackIssue,
        `${name} verification failed`,
      );
    });
  } catch (error) {
    throw normalizeGateError(
      error,
      fallbackCode,
      fallbackIssue,
      `${name} verification failed`,
    );
  }
}

/**
 * Stable fallback failure metadata for each gate. The full verifier and generated
 * fault projections use the same documented ordering and normalization codes.
 */
export const WATCH_LAYER_GATE_FAILURES = deepFreeze({
  predecessor: {
    code: LAYER_GATE_FAILURE_CODES.PREDECESSOR_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.PREDECESSOR_INVALID,
  },
  "protected-integrity": {
    code: LAYER_GATE_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.PROTECTED_INTEGRITY_INVALID,
  },
  "schema-path": {
    code: LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.SCHEMA_INVALID,
  },
  identities: {
    code: LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
  },
  "provenance-approvals": {
    code: LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
  },
  segmentation: {
    code: LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.SEGMENTATION_INVALID,
  },
  reconstruction: {
    code: LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.RECONSTRUCTION_INVALID,
  },
  "fidelity-coverage": {
    code: LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
  },
  motion: {
    code: LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.MOTION_INVALID,
  },
  depth: {
    code: LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.DEPTH_INVALID,
  },
  "public-assets-runtime-manifest": {
    code: LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
  },
  budgets: {
    code: LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.BUDGET_INVALID,
  },
  "input-hashes": {
    code: LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    issueCode: WATCH_LAYER_VERIFY_ISSUE_CODES.INPUT_CHANGED,
  },
});

/**
 * Execute one complete synthetic gate plan through the verifier's real ordered
 * gate/error normalization and read-only sandbox. This is intentionally limited
 * to supplied local operations and cannot publish or mutate inspected inputs.
 */
export function verifyWatchLayerGateSequence(operations) {
  if (!isPlainObject(operations)) {
    fail(
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
      "Gate operations must be a plain object",
      "$.operations",
    );
  }
  const actualNames = Object.keys(operations).sort(lexicalCompare);
  const expectedNames = [...WATCH_LAYER_GATE_ORDER].sort(lexicalCompare);
  if (
    actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])
    || WATCH_LAYER_GATE_ORDER.some((name) => typeof operations[name] !== "function")
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
      "Gate operations must provide exactly one function per documented gate",
      "$.operations",
    );
  }

  const context = { completedGates: [] };
  const runAt = (index) => {
    if (index === WATCH_LAYER_GATE_ORDER.length) {
      return deepFreeze({ completedGates: [...context.completedGates], ok: true });
    }
    const name = WATCH_LAYER_GATE_ORDER[index];
    const fallback = WATCH_LAYER_GATE_FAILURES[name];
    const result = runGate(
      context,
      name,
      fallback.code,
      fallback.issueCode,
      operations[name],
    );
    return isPromiseLike(result)
      ? Promise.resolve(result).then(() => runAt(index + 1))
      : runAt(index + 1);
  };
  return withWatchLayerVerifierSandbox(() => runAt(0));
}

/**
 * Evaluate the verifier's canonical delivery-phase closure without mutating the
 * supplied manifest projection. Artifact hashes represent already observed,
 * identity-checked package members.
 */
export function evaluateWatchLayerPhaseClosure(input) {
  if (
    !isPlainObject(input)
    || !Array.isArray(input.artifactSha256)
    || !isPlainObject(input.manifest)
    || !Array.isArray(input.manifest.phases)
    || !isPlainObject(input.release)
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
      "Phase closure input must contain artifact hashes, a manifest, and a release",
      "$.phaseClosure",
    );
  }
  const artifacts = new Map(input.artifactSha256.map((digest, index) => [
    `artifact-${index}`,
    { digest },
  ]));
  const context = {
    artifacts,
    manifest: input.manifest,
    release: input.release,
    selectedPhase: null,
  };
  validatePhaseClosure(context);
  return deepFreeze({
    approvedPhaseNames: input.manifest.phases
      .filter(({ status }) => status === "approved")
      .map(({ name }) => name),
    selectedPhase: context.selectedPhase?.name ?? null,
  });
}

function installReplacement(target, name, replacement, restorations, installed) {
  if (target === null || target === undefined) return;
  let targetNames = installed.get(target);
  if (targetNames === undefined) {
    targetNames = new Set();
    installed.set(target, targetNames);
  }
  if (targetNames.has(name)) return;
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (descriptor === undefined || typeof target[name] !== "function") return;
  if (descriptor.configurable !== true && descriptor.writable !== true) {
    fail(
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.FILESYSTEM_MUTATION_FORBIDDEN,
      `Cannot sandbox non-replaceable capability ${name}`,
      name,
    );
  }
  Object.defineProperty(target, name, {
    ...descriptor,
    configurable: descriptor.configurable,
    value: replacement,
  });
  targetNames.add(name);
  restorations.push(() => Object.defineProperty(target, name, descriptor));
}

function installGlobalGuard(name, guard, restorations) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor !== undefined && descriptor.configurable === false) {
    fail(
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.NETWORK_FORBIDDEN,
      `Cannot sandbox non-configurable network global ${name}`,
      name,
    );
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: guard,
    writable: false,
  });
  restorations.push(() => {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, descriptor);
  });
}

/**
 * Run one verification operation with browser/Node network entry points and all
 * common filesystem mutation APIs replaced by deterministic throwing guards.
 */
export function withWatchLayerVerifierSandbox(operation) {
  if (typeof operation !== "function") {
    fail(
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
      "Verifier sandbox operation must be a function",
      "$.operation",
    );
  }
  const restorations = [];
  const installed = new WeakMap();
  const filesystemGuard = function watchLayerFilesystemMutationGuard() {
    fail(
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.FILESYSTEM_MUTATION_FORBIDDEN,
      "Read-only watch-layer verification forbids filesystem mutation",
      "$",
    );
  };
  const networkGuard = function watchLayerNetworkGuard() {
    fail(
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.NETWORK_FORBIDDEN,
      "Watch-layer verification forbids network access",
      "$",
    );
  };

  const fsMutationMethods = [
    "appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync",
    "copyFile", "copyFileSync", "cp", "cpSync", "createWriteStream", "fchmod",
    "fchmodSync", "fchown", "fchownSync", "fdatasync", "fdatasyncSync", "ftruncate",
    "ftruncateSync", "futimes", "futimesSync", "link", "linkSync", "lchmod",
    "lchmodSync", "lchown", "lchownSync", "lutimes", "lutimesSync", "mkdir",
    "mkdirSync", "mkdtemp", "mkdtempSync", "open", "openSync", "rename",
    "renameSync", "rm", "rmSync", "rmdir", "rmdirSync", "symlink", "symlinkSync",
    "truncate", "truncateSync", "unlink", "unlinkSync", "utimes", "utimesSync",
    "write", "writeFile", "writeFileSync", "writeSync", "writev", "writevSync",
  ];
  const promiseMutationMethods = [
    "appendFile", "chmod", "chown", "copyFile", "cp", "link", "lchmod", "lchown",
    "lutimes", "mkdir", "mkdtemp", "open", "rename", "rm", "rmdir", "symlink",
    "truncate", "unlink", "utimes", "writeFile",
  ];
  const networkTargets = [
    [http, ["get", "request"]],
    [https, ["get", "request"]],
    [net, ["connect", "createConnection"]],
    [tls, ["connect"]],
    [dgram, ["createSocket"]],
    [dns, [
      "lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny",
      "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs",
      "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse",
    ]],
    [dns.promises, [
      "lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny",
      "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs",
      "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse",
    ]],
  ];
  let restored = false;
  const restoreCapabilities = () => {
    if (restored) return;
    restored = true;
    for (const restore of restorations.reverse()) restore();
    syncBuiltinESMExports();
  };

  try {
    for (const name of ["fetch", "WebSocket", "XMLHttpRequest", "EventSource"]) {
      installGlobalGuard(name, networkGuard, restorations);
    }
    for (const name of fsMutationMethods) {
      installReplacement(fs, name, filesystemGuard, restorations, installed);
    }
    for (const target of [fsPromises, fs.promises]) {
      for (const name of promiseMutationMethods) {
        installReplacement(target, name, filesystemGuard, restorations, installed);
      }
    }
    for (const [target, names] of networkTargets) {
      for (const name of names) {
        installReplacement(target, name, networkGuard, restorations, installed);
      }
    }
    syncBuiltinESMExports();
    const result = operation();
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(restoreCapabilities);
    }
    restoreCapabilities();
    return result;
  } catch (error) {
    restoreCapabilities();
    throw error;
  }
}

function normalizeCssPrelude(value) {
  return value.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\s+/gu, " ").trim();
}

function findCssOpeningBrace(source, start, end) {
  let quote = null;
  let inComment = false;
  for (let index = start; index < end; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"') quote = current;
    else if (current === "{") return index;
  }
  return -1;
}

function findCssClosingBrace(source, openingIndex, end) {
  let depth = 1;
  let quote = null;
  let inComment = false;
  for (let index = openingIndex + 1; index < end; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"') quote = current;
    else if (current === "{") depth += 1;
    else if (current === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  fail(
    LAYER_GATE_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
    WATCH_LAYER_VERIFY_ISSUE_CODES.PROTECTED_INTEGRITY_INVALID,
    "Protected CSS contains an unbalanced block",
    CANONICAL_PROJECT_PATHS.globalsCss,
  );
}

function collectCssBlocks(source, start = 0, end = source.length, ancestors = []) {
  const blocks = [];
  let cursor = start;
  while (cursor < end) {
    const openingIndex = findCssOpeningBrace(source, cursor, end);
    if (openingIndex < 0) break;
    const rawPrelude = source.slice(cursor, openingIndex);
    const prelude = normalizeCssPrelude(rawPrelude.slice(rawPrelude.lastIndexOf(";") + 1));
    const closingIndex = findCssClosingBrace(source, openingIndex, end);
    if (prelude.startsWith("@")) {
      blocks.push(...collectCssBlocks(
        source,
        openingIndex + 1,
        closingIndex,
        [...ancestors, prelude],
      ));
    } else if (prelude) {
      blocks.push({
        ancestors,
        body: source.slice(openingIndex + 1, closingIndex),
        selector: prelude,
      });
    }
    cursor = closingIndex + 1;
  }
  return blocks;
}

function extractProtectedCssEntries(source) {
  const occurrences = new Map();
  return collectCssBlocks(source)
    .filter(({ selector }) => PROTECTED_WATCH_SELECTOR_PATTERN.test(selector))
    .map(({ ancestors, body, selector }) => {
      const qualifiedSelector = [...ancestors, selector].join(" > ");
      const baseId = `${CANONICAL_PROJECT_PATHS.globalsCss}#${qualifiedSelector}`;
      const occurrence = (occurrences.get(baseId) ?? 0) + 1;
      occurrences.set(baseId, occurrence);
      const id = occurrence === 1 ? baseId : `${baseId} [${occurrence}]`;
      const payload = `${ancestors.join("\n")}\n${selector}\n{${body}}`;
      return { digest: sha256(payload), id };
    })
    .sort((left, right) => lexicalCompare(left.id, right.id));
}

async function assertSafeDirectory(projectRoot, projectPath, { allowPublic = false, optional = false } = {}) {
  const normalized = assertSafeProjectRelativePath(projectPath, {
    allowPublic,
    projectRoot,
  });
  let current = resolve(projectRoot);
  const rootStats = await lstat(current).catch(() => null);
  if (rootStats === null || !rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
      "Project root must be a regular non-symlink directory",
      normalized,
    );
  }
  for (let index = 0; index < normalized.split("/").length; index += 1) {
    const segment = normalized.split("/")[index];
    current = resolve(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (optional && isMissing(error)) {
        return null;
      }
      fail(
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
        "Required directory is missing or unreadable",
        normalized,
      );
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail(
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
        "Project directories must be regular and non-symlinked",
        normalized,
      );
    }
  }
  return current;
}

async function collectSafeDirectoryFiles(projectRoot, projectPath, {
  allowPublic = false,
  optional = false,
} = {}) {
  const rootDirectory = await assertSafeDirectory(projectRoot, projectPath, {
    allowPublic,
    optional,
  });
  if (rootDirectory === null) return [];
  const files = [];
  const visit = async (absoluteDirectory, relativeDirectory) => {
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      fail(
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
        "Directory membership cannot be inspected",
        relativeDirectory,
      );
    }
    entries.sort((left, right) => lexicalCompare(left.name, right.name));
    for (const entry of entries) {
      const childPath = `${relativeDirectory}/${entry.name}`;
      const childAbsolute = resolve(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
          "Directory membership must not contain symbolic links",
          childPath,
        );
      }
      if (entry.isDirectory()) await visit(childAbsolute, childPath);
      else if (entry.isFile()) files.push(childPath);
      else {
        fail(
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
          "Directory membership must contain only regular files and directories",
          childPath,
        );
      }
    }
  };
  await visit(rootDirectory, projectPath);
  return files.sort(lexicalCompare);
}

async function inspectOptionalRegularFile(projectRoot, projectPath, options = {}) {
  const absolutePath = resolve(projectRoot, projectPath);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (isMissing(error)) return null;
    fail(
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
      "Optional project file cannot be inspected",
      projectPath,
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
      "Project input must be a regular non-symlink file",
      projectPath,
    );
  }
  return inspectSafeRegularFile(projectPath, {
    allowPublic: true,
    projectRoot,
    ...options,
  });
}

async function createProtectedIntegrityManifest(projectRoot) {
  const specPaths = [];
  for (const directory of [
    CANONICAL_PROJECT_PATHS.historicalSpecDirectory,
    CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
  ]) {
    specPaths.push(...await collectSafeDirectoryFiles(projectRoot, directory));
  }
  const filePaths = uniqueSorted([
    ...specPaths,
    CANONICAL_PROJECT_PATHS.protectedCanvas,
    CANONICAL_PROJECT_PATHS.canonicalMaster,
    CANONICAL_PROJECT_PATHS.predecessorManifest,
    ...PREDECESSOR_PUBLIC_ASSET_PATHS,
  ]);
  const entries = [];
  for (const path of filePaths) {
    const inspected = await inspectSafeRegularFile(path, {
      allowPublic: true,
      projectRoot,
    });
    entries.push({ digest: inspected.identity.sha256, id: path });
  }

  const packageFile = await inspectSafeRegularFile(
    CANONICAL_PROJECT_PATHS.dependencyManifest,
    { projectRoot },
  );
  let packageDocument;
  try {
    packageDocument = JSON.parse(packageFile.bytes.toString("utf8"));
  } catch {
    fail(
      LAYER_GATE_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROTECTED_INTEGRITY_INVALID,
      "Protected dependency manifest is not valid JSON",
      CANONICAL_PROJECT_PATHS.dependencyManifest,
    );
  }
  for (const field of ["dependencies", "devDependencies"]) {
    if (!isPlainObject(packageDocument[field])) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROTECTED_INTEGRITY_INVALID,
        `Protected ${field} field is not an object`,
        `${CANONICAL_PROJECT_PATHS.dependencyManifest}#${field}`,
      );
    }
    entries.push({
      digest: sha256(JSON.stringify(packageDocument[field])),
      id: `${CANONICAL_PROJECT_PATHS.dependencyManifest}#${field}`,
    });
  }

  const globals = await inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.globalsCss, {
    projectRoot,
  });
  entries.push(...extractProtectedCssEntries(globals.bytes.toString("utf8")));
  entries.sort((left, right) => lexicalCompare(left.id, right.id));
  return {
    entries,
    paths: uniqueSorted([
      ...filePaths,
      CANONICAL_PROJECT_PATHS.dependencyManifest,
      CANONICAL_PROJECT_PATHS.globalsCss,
      PRESERVATION_FIXTURE_PATH,
    ]),
    text: `${entries.map(({ digest, id }) => `${digest}  ${id}`).join("\n")}\n`,
  };
}

async function verifyProtectedIntegrity(projectRoot) {
  const fixture = await inspectSafeRegularFile(PRESERVATION_FIXTURE_PATH, {
    projectRoot,
  });
  if (
    fixture.identity.byteLength !== PRESERVATION_FIXTURE_IDENTITY.byteLength
    || fixture.identity.sha256 !== PRESERVATION_FIXTURE_IDENTITY.sha256
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROTECTED_INTEGRITY_INVALID,
      "Protected preservation fixture differs from its reviewed identity",
      PRESERVATION_FIXTURE_PATH,
    );
  }
  const actual = await createProtectedIntegrityManifest(projectRoot);
  if (!fixture.bytes.equals(Buffer.from(actual.text, "utf8"))) {
    const expectedLines = fixture.bytes.toString("utf8").trimEnd().split("\n");
    const expectedById = new Map(expectedLines.map((line) => {
      const separator = line.indexOf("  ");
      return [line.slice(separator + 2), line.slice(0, separator)];
    }));
    const actualById = new Map(actual.entries.map(({ digest, id }) => [id, digest]));
    const ids = uniqueSorted([...expectedById.keys(), ...actualById.keys()]);
    const changed = ids.find((id) => expectedById.get(id) !== actualById.get(id)) ?? null;
    fail(
      LAYER_GATE_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROTECTED_INTEGRITY_INVALID,
      "Protected artifact membership or bytes differ from the reviewed manifest",
      changed,
    );
  }
  return deepFreeze({ entryCount: actual.entries.length, paths: actual.paths });
}

async function parseExternalApprovals(projectRoot, paths) {
  const records = [];
  for (const path of paths) {
    const file = await inspectSafeRegularFile(path, {
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorApprovalsDirectory],
      projectRoot,
    });
    records.push(APPROVAL_RECORD_SCHEMA.parseJson(file.bytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    }));
  }
  return records;
}

async function loadStrictDocuments(context) {
  const releaseFile = await inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.successorRelease, {
    expectedPath: CANONICAL_PROJECT_PATHS.successorRelease,
    projectRoot: context.projectRoot,
  }).catch((error) => {
    if (error && typeof error === "object" && error.code === LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH) {
      fail(
        LAYER_GATE_FAILURE_CODES.MANIFEST_MISSING,
        WATCH_LAYER_VERIFY_ISSUE_CODES.MANIFEST_MISSING,
        "Watch-layer release pointer is missing or unreadable",
        CANONICAL_PROJECT_PATHS.successorRelease,
      );
    }
    throw error;
  });
  const release = RELEASE_POINTER_SCHEMA.parseJson(releaseFile.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  });
  const authoringFile = await inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.successorAuthoring, {
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
    expectedPath: CANONICAL_PROJECT_PATHS.successorAuthoring,
    projectRoot: context.projectRoot,
  }).catch((error) => {
    if (error && typeof error === "object" && error.code === LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH) {
      fail(
        LAYER_GATE_FAILURE_CODES.MANIFEST_MISSING,
        WATCH_LAYER_VERIFY_ISSUE_CODES.MANIFEST_MISSING,
        "Watch-layer authoring document is missing or unreadable",
        CANONICAL_PROJECT_PATHS.successorAuthoring,
      );
    }
    throw error;
  });
  const authoring = AUTHORING_DOCUMENT_SCHEMA.parseJson(authoringFile.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  });
  const packageFile = await inspectOptionalRegularFile(
    context.projectRoot,
    CANONICAL_PROJECT_PATHS.successorPackageManifest,
    { expectedPath: CANONICAL_PROJECT_PATHS.successorPackageManifest },
  );
  if (release.status === "ready" && packageFile === null) {
    fail(
      LAYER_GATE_FAILURE_CODES.MANIFEST_MISSING,
      WATCH_LAYER_VERIFY_ISSUE_CODES.MANIFEST_MISSING,
      "A ready release requires data/watch-layer-package.json",
      CANONICAL_PROJECT_PATHS.successorPackageManifest,
    );
  }
  const manifest = packageFile === null
    ? null
    : LAYER_ASSET_MANIFEST_SCHEMA.parseJson(packageFile.bytes, {
        allowTrailingNewline: true,
        requireCanonical: true,
      });

  const approvalPaths = await collectSafeDirectoryFiles(
    context.projectRoot,
    CANONICAL_PROJECT_PATHS.successorApprovalsDirectory,
    { optional: true },
  );
  const externalApprovals = await parseExternalApprovals(context.projectRoot, approvalPaths);
  const allAuthoredApprovals = [...authoring.approvals, ...externalApprovals];
  const approvalIds = new Set();
  for (const approval of allAuthoredApprovals) {
    if (approvalIds.has(approval.id)) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        `Approval ID ${approval.id} is supplied more than once`,
        `$.approvals.${approval.id}`,
      );
    }
    approvalIds.add(approval.id);
  }

  if (release.status === "fallback-only" && manifest !== null) {
    if (manifest.runtimeManifest !== null || manifest.publicAssets.length !== 0) {
      fail(
        LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.SCHEMA_INVALID,
        "A fallback-only release cannot carry runtime or public presentation members",
        "$.manifest",
      );
    }
  }

  context.releaseFile = releaseFile;
  context.release = release;
  context.authoringFile = authoringFile;
  context.authoring = authoring;
  context.packageFile = packageFile;
  context.manifest = manifest;
  context.approvalPaths = approvalPaths;
  context.authoredApprovals = allAuthoredApprovals;
}

async function fileExistsState(projectRoot, path) {
  try {
    const stats = await lstat(resolve(projectRoot, path));
    return stats.isFile() && !stats.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    fail(
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PATH_INVALID,
      "Project input existence cannot be inspected",
      path,
    );
  }
}

async function createVerifierInputSnapshot(context) {
  const hasApprovals = context.authoredApprovals.length !== 0;
  const reviewPaths = hasApprovals
    ? await collectSafeDirectoryFiles(
        context.projectRoot,
        CANONICAL_PROJECT_PATHS.successorReviewDirectory,
        { optional: true },
      )
    : [];
  const manifestPaths = context.manifest === null
    ? []
    : [
        ...context.manifest.masks.map(({ file }) => file),
        ...context.manifest.reconstructions.map(({ fillFile }) => fillFile),
        ...context.manifest.publicAssets.map(({ file }) => file),
        ...(context.manifest.runtimeManifest === null
          ? []
          : [context.manifest.runtimeManifest.file]),
      ];
  const expectedPaths = uniqueSorted([
    ...context.protectedIntegrity.paths,
    CANONICAL_PROJECT_PATHS.successorAuthoring,
    CANONICAL_PROJECT_PATHS.successorRelease,
    CANONICAL_PROJECT_PATHS.successorPackageManifest,
    ...context.approvalPaths,
    ...reviewPaths,
    ...manifestPaths,
  ]);
  const presence = new Map();
  for (const path of expectedPaths) presence.set(path, await fileExistsState(context.projectRoot, path));
  const existingPaths = expectedPaths.filter((path) => presence.get(path));
  const snapshot = await createInputHashSnapshot(existingPaths, {
    allowPublic: true,
    projectRoot: context.projectRoot,
  });
  const directoryMembership = new Map();
  for (const [path, allowPublic, include] of [
    [CANONICAL_PROJECT_PATHS.successorApprovalsDirectory, false, true],
    [CANONICAL_PROJECT_PATHS.successorReviewDirectory, false, hasApprovals],
    [CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory, true, true],
  ]) {
    if (include) {
      directoryMembership.set(path, await collectSafeDirectoryFiles(
        context.projectRoot,
        path,
        { allowPublic, optional: true },
      ));
    }
  }
  context.inputSnapshot = snapshot;
  context.expectedInputPaths = expectedPaths;
  context.inputPresence = presence;
  context.directoryMembership = directoryMembership;
}

async function verifyIdentities(context) {
  await Promise.all([
    assertApprovedMasterIdentity({ projectRoot: context.projectRoot }),
    assertPredecessorManifestIdentity({ projectRoot: context.projectRoot }),
    inspectApprovedDependencyFields({ projectRoot: context.projectRoot }),
  ]);
  context.artifacts = new Map();
  context.maskFiles = new Map();
  context.fillFiles = new Map();
  if (context.manifest === null) return;

  for (const field of [
    "canonicalMaster",
    "packageId",
    "packageVersion",
    "parentSpec",
    "predecessorContract",
    "sourceCoordinateSpace",
    "sourceDateEpoch",
  ]) {
    if (!canonicalEqual(context.manifest[field], context.authoring[field])) {
      fail(
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
        `Package ${field} differs from the current authored package identity`,
        `$.manifest.${field}`,
      );
    }
  }
  if (
    context.release.status === "ready"
    && context.release.packageId !== context.manifest.packageId
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
      "Ready release package ID differs from the current package manifest",
      "$.release.packageId",
    );
  }

  const provenanceByArtifact = new Map(
    context.manifest.provenance.map((record) => [record.artifactId, record]),
  );
  const addArtifact = (id, digest, kind, path = `$.artifacts.${id}`) => {
    if (context.artifacts.has(id)) {
      fail(
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
        `Artifact ID ${id} is duplicated`,
        path,
      );
    }
    context.artifacts.set(id, { digest, id, kind, path });
  };

  for (const mask of context.manifest.masks) {
    const inspected = await inspectSafeRegularFile(mask.file, {
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorMasksDirectory],
      expectedPath: mask.file,
      projectRoot: context.projectRoot,
    });
    if (inspected.identity.sha256 !== mask.sha256) {
      fail(
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
        `Mask ${mask.id} differs from its manifest hash`,
        mask.file,
      );
    }
    context.maskFiles.set(mask.id, inspected);
    addArtifact(mask.id, mask.sha256, "mask", mask.file);
  }
  for (const reconstruction of context.manifest.reconstructions) {
    const inspected = await inspectSafeRegularFile(reconstruction.fillFile, {
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorReconstructionDirectory],
      expectedPath: reconstruction.fillFile,
      projectRoot: context.projectRoot,
    });
    if (inspected.identity.sha256 !== reconstruction.fillSha256) {
      fail(
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
        `Reconstruction fill ${reconstruction.fillId} differs from its manifest hash`,
        reconstruction.fillFile,
      );
    }
    context.fillFiles.set(reconstruction.fillId, inspected);
    addArtifact(
      reconstruction.fillId,
      reconstruction.fillSha256,
      "reconstruction-fill",
      reconstruction.fillFile,
    );
  }
  for (const layer of context.manifest.layers) {
    addArtifact(layer.id, sha256(LAYER_RECORD_SCHEMA.serialize(layer)), "layer");
  }
  for (const motion of context.manifest.motionProfiles) {
    addArtifact(motion.id, sha256(MOTION_PROFILE_SCHEMA.serialize(motion)), "motion");
  }
  for (const relationship of context.manifest.relationships) {
    addArtifact(
      relationship.id,
      sha256(GEAR_RELATIONSHIP_SCHEMA.serialize(relationship)),
      "relationship",
    );
  }
  for (const depth of context.manifest.depthProfiles) {
    addArtifact(depth.id, sha256(DEPTH_PROFILE_SCHEMA.serialize(depth)), "depth");
  }
  for (const asset of context.manifest.publicAssets) {
    addArtifact(asset.id, asset.sha256, "public-asset", asset.file);
  }
  for (const artifact of context.artifacts.values()) {
    artifact.provenance = provenanceByArtifact.get(artifact.id) ?? null;
  }
}

function readyEmptyLayerFidelityApprovals(context) {
  if (
    context.release.status !== "ready"
    || context.manifest === null
    || context.manifest.layers.length !== 0
  ) return [];
  return context.manifest.approvals.filter((approval) => (
    approval.scope === "fidelity" && approval.layerIds.length === 0
  ));
}

function validatePackageMatchesAuthoredInputs(context) {
  if (context.manifest === null) return;
  const normalized = context.loadedAuthoring.normalized;
  for (const field of [
    "layers",
    "masks",
    "motionProfiles",
    "reconstructions",
    "relationships",
  ]) {
    if (!canonicalEqual(context.manifest[field], normalized[field])) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        `Package ${field} differ from the current normalized authored inputs`,
        `$.manifest.${field}`,
      );
    }
  }
  if (!canonicalEqual(context.manifest.depthProfiles, context.authoring.depthProfiles)) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
      "Package depth profiles differ from the current authored inputs",
      "$.manifest.depthProfiles",
    );
  }
  const canonicalAuthoredPhases = context.authoring.phases.map((phase) => ({
    ...phase,
    phasePayloadSha256: hashPhaseProjection(context.authoring.packageId, phase),
  }));
  if (!canonicalEqual(context.manifest.phases, canonicalAuthoredPhases)) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
      "Package delivery phases differ from the canonical current authored inputs",
      "$.manifest.phases",
    );
  }

  const authoredApprovalById = new Map(
    context.authoredApprovals.map((approval) => [approval.id, approval]),
  );
  const expectedApprovalIds = uniqueSorted([
    ...context.manifest.layers.flatMap(({ approvalIds }) => approvalIds),
    ...context.manifest.reconstructions.map(({ approvalId }) => approvalId),
    ...context.manifest.motionProfiles.map(({ approvalId }) => approvalId),
    ...context.manifest.relationships.map(({ approvalId }) => approvalId),
    ...context.manifest.depthProfiles
      .filter(({ enabled }) => enabled)
      .map(({ approvalId }) => approvalId),
    ...context.manifest.phases.flatMap(({ approvalId }) => (
      approvalId === undefined ? [] : [approvalId]
    )),
    ...normalized.approvals.map(({ id }) => id),
    ...readyEmptyLayerFidelityApprovals(context).map(({ id }) => id),
  ]);
  const packageApprovalIds = context.manifest.approvals
    .map(({ id }) => id)
    .sort(lexicalCompare);
  if (!arraysEqual(packageApprovalIds, expectedApprovalIds)) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
      "Package approval IDs must equal the exact current referenced and normalized set",
      "$.manifest.approvals",
    );
  }
  for (const approval of context.manifest.approvals) {
    if (!canonicalEqual(authoredApprovalById.get(approval.id), approval)) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        `Package approval ${approval.id} is not the exact current reviewer-supplied record`,
        `$.manifest.approvals.${approval.id}`,
      );
    }
  }

  const authoredProvenanceById = new Map(
    context.authoring.provenance.map((record) => [record.id, record]),
  );
  const generatedArtifactIds = new Set([
    ...context.manifest.publicAssets.map(({ id }) => id),
    ...context.manifest.depthProfiles.map(({ id }) => id),
  ]);
  for (const record of context.manifest.provenance) {
    if (generatedArtifactIds.has(record.artifactId)) continue;
    if (!canonicalEqual(authoredProvenanceById.get(record.id), record)) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        `Package provenance ${record.id} is not the exact current authored record`,
        `$.manifest.provenance.${record.id}`,
      );
    }
  }
}

function validatePhaseClosure(context) {
  if (context.manifest === null) {
    context.selectedPhase = null;
    return;
  }
  let nonApprovedSeen = false;
  for (const phase of context.manifest.phases) {
    if (phase.phasePayloadSha256 !== hashPhaseProjection(context.manifest.packageId, phase)) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        `Phase ${phase.name} has a stale canonical projection hash`,
        `$.manifest.phases.${phase.name}.phasePayloadSha256`,
      );
    }
    if (phase.status === "approved" && nonApprovedSeen) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        "Approved delivery phases must form one contiguous prefix",
        `$.manifest.phases.${phase.name}.status`,
      );
    }
    if (phase.status !== "approved") nonApprovedSeen = true;
    for (const digest of phase.assetSha256) {
      if (![...context.artifacts.values()].some(({ digest: current }) => current === digest)) {
        fail(
          LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
          `Phase ${phase.name} binds an unknown artifact hash`,
          `$.manifest.phases.${phase.name}.assetSha256`,
        );
      }
    }
  }

  if (context.release.status === "fallback-only") {
    context.selectedPhase = null;
    if (context.manifest.runtimeManifest !== null) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        "Fallback-only package cannot bind a runtime manifest",
        "$.manifest.runtimeManifest",
      );
    }
    return;
  }

  const selected = context.manifest.phases.filter((phase) => (
    phase.status === "approved"
    && phase.runtimeManifestSha256 === context.release.runtimeManifest.sha256
  ));
  if (selected.length !== 1) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
      "Ready release must select exactly one approved hash-bound delivery phase",
      "$.manifest.phases",
    );
  }
  context.selectedPhase = selected[0];
  if (context.selectedPhase.approvalId === undefined) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
      "Ready delivery phase requires an exact release approval",
      `$.manifest.phases.${context.selectedPhase.name}.approvalId`,
    );
  }
}

function validateProvenanceGraph(context) {
  if (context.manifest === null) return;
  const recordsByArtifact = new Map();
  for (const record of context.manifest.provenance) {
    const records = recordsByArtifact.get(record.artifactId) ?? [];
    records.push(record);
    recordsByArtifact.set(record.artifactId, records);
  }
  const trustedHashes = new Set([
    APPROVED_MASTER_IDENTITY.sha256,
    PREDECESSOR_MANIFEST_IDENTITY.sha256,
    ...context.inputSnapshot.files.map(({ sha256: digest }) => digest),
    ...[...context.artifacts.values()].map(({ digest }) => digest),
  ]);
  const artifactHashSet = new Set(
    [...context.artifacts.values()].map(({ digest }) => digest),
  );

  for (const artifact of context.artifacts.values()) {
    const records = recordsByArtifact.get(artifact.id) ?? [];
    if (records.length !== 1) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        `Artifact ${artifact.id} requires exactly one provenance record`,
        `$.manifest.provenance.${artifact.id}`,
      );
    }
    const record = records[0];
    artifact.provenance = record;
    if (
      record.artifactSha256 !== artifact.digest
      || record.immediateParentSha256.some((digest) => !trustedHashes.has(digest))
      || record.immediateParentSha256.includes(record.artifactSha256)
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        `Provenance for ${artifact.id} does not close against current bytes and parents`,
        `$.manifest.provenance.${record.id}`,
      );
    }
    if (artifact.kind === "reconstruction-fill" && record.classification !== "synthetic") {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        "Reconstruction fills must remain classified synthetic",
        `$.manifest.provenance.${record.id}.classification`,
      );
    }
  }
  for (const record of context.manifest.provenance) {
    if (!context.artifacts.has(record.artifactId)) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        `Provenance ${record.id} names an unobserved artifact`,
        `$.manifest.provenance.${record.id}.artifactId`,
      );
    }
  }

  const parentsByHash = new Map();
  for (const artifact of context.artifacts.values()) {
    parentsByHash.set(
      artifact.digest,
      artifact.provenance.immediateParentSha256.filter((digest) => artifactHashSet.has(digest)),
    );
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (digest) => {
    if (visiting.has(digest)) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
        "Artifact provenance graph contains a cycle",
        "$.manifest.provenance",
      );
    }
    if (visited.has(digest)) return;
    visiting.add(digest);
    for (const parent of parentsByHash.get(digest) ?? []) visit(parent);
    visiting.delete(digest);
    visited.add(digest);
  };
  for (const digest of artifactHashSet) visit(digest);
}

function pivotProjectionHash(layer) {
  return sha256(serializeCanonicalJson({ layerId: layer.id, pivot: layer.pivot }));
}

function approvalById(manifest, id, path) {
  const approval = manifest.approvals.find((record) => record.id === id);
  if (approval === undefined) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
      `Approval ${String(id)} does not resolve`,
      path,
    );
  }
  return approval;
}

function currentReviewApprovalExpectation(
  context,
  approvalId,
  reviewSetId,
  requiredHashes,
  requiredLayerIds,
  scope,
  path,
) {
  const evidence = context.loadedAuthoring?.reviewApprovalEvidence;
  if (reviewSetId === undefined || evidence?.hasIndex !== true) return null;
  const reviewSet = evidence.reviewSets.find(({ id }) => id === reviewSetId);
  if (reviewSet === undefined) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
      `Approval ${approvalId} lacks its exact current ${scope} evidence set`,
      path,
    );
  }
  let expectation;
  try {
    expectation = createReviewSetApprovalExpectation({
      approvalId,
      evidenceIndexSha256: evidence.indexIdentity.sha256,
      reviewSet,
    });
  } catch (error) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      stableIssueFromError(error, WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE),
      error instanceof Error ? error.message : "Current approval evidence is invalid",
      path,
    );
  }
  if (
    expectation.scope !== scope
    || !setsEqual(expectation.layerIds, requiredLayerIds)
    || requiredHashes.some((digest) => !expectation.artifactSha256.includes(digest))
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
      `Approval ${approvalId} evidence does not bind the exact current ${scope} inputs`,
      path,
    );
  }
  return expectation;
}

function registerApprovalBinding(context, approval, expectation, requiredHashes, requiredLayerIds) {
  context.approvalBindings ??= new Map();
  const existing = context.approvalBindings.get(approval.id);
  const semanticHashes = new Set(existing?.semanticHashes ?? []);
  const layerIds = new Set(existing?.layerIds ?? []);
  requiredHashes.forEach((digest) => semanticHashes.add(digest));
  requiredLayerIds.forEach((id) => layerIds.add(id));
  if (
    existing !== undefined
    && (
      existing.scope !== expectation.scope
      || !canonicalEqual(existing.expectation, expectation)
    )
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
      `Approval ${approval.id} has incompatible current uses`,
      `$.manifest.approvals.${approval.id}`,
    );
  }
  context.approvalBindings.set(approval.id, {
    expectation,
    layerIds: [...layerIds].sort(lexicalCompare),
    scope: expectation.scope,
    semanticHashes: [...semanticHashes].sort(lexicalCompare),
  });
}

export function evaluateWatchLayerApprovalRequirement(value, expectation) {
  return evaluateApprovalClosure(value, expectation);
}

function assertClosedApproval(context, approval, {
  requiredHashes = [],
  requiredLayerIds = [],
  reviewSetId,
  scope,
  path,
}) {
  let validated;
  try {
    validated = validateReviewerApprovalRecord(approval);
  } catch (error) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      stableIssueFromError(error, WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE),
      error instanceof Error ? error.message : "Approval record is invalid",
      path,
    );
  }
  const exactHashes = uniqueSorted(requiredHashes);
  const exactLayerIds = uniqueSorted(requiredLayerIds);
  const evidenceExpectation = currentReviewApprovalExpectation(
    context,
    validated.id,
    reviewSetId,
    exactHashes,
    exactLayerIds,
    scope,
    path,
  );
  const expectation = evidenceExpectation ?? {
    approvalId: validated.id,
    artifactSha256: exactHashes,
    layerIds: exactLayerIds,
    reviewedPoseIds: validated.reviewedPoseIds,
    reviewedZoomPercent: validated.reviewedZoomPercent,
    scope,
  };
  const closure = evaluateApprovalClosure(validated, expectation);
  if (!closure.ok) {
    fail(
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      closure.reason ?? WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
      closure.message,
      path,
    );
  }
  registerApprovalBinding(context, validated, expectation, exactHashes, exactLayerIds);
  return validated;
}

function validateApprovalClosure(context) {
  if (context.manifest === null) return;
  const manifest = context.manifest;
  const maskById = new Map(manifest.masks.map((record) => [record.id, record]));
  const motionById = new Map(manifest.motionProfiles.map((record) => [record.id, record]));
  context.approvalBindings = new Map();

  for (const layer of manifest.layers) {
    for (const approvalId of layer.approvalIds) {
      const approval = approvalById(manifest, approvalId, `$.manifest.layers.${layer.id}.approvalIds`);
      if (approval.scope === "segmentation") {
        assertClosedApproval(context, approval, {
          requiredHashes: [maskById.get(layer.segmentationMaskId)?.sha256].filter(Boolean),
          requiredLayerIds: [layer.id],
          reviewSetId: `${layer.id}-segmentation`,
          scope: "segmentation",
          path: `$.manifest.approvals.${approval.id}`,
        });
      } else if (approval.scope === "pivot") {
        if (layer.pivot === undefined) {
          fail(
            LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
            WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
            `Pivot approval ${approval.id} has no current layer pivot`,
            `$.manifest.layers.${layer.id}.pivot`,
          );
        }
        assertClosedApproval(context, approval, {
          requiredHashes: [pivotProjectionHash(layer)],
          requiredLayerIds: [layer.id],
          reviewSetId: `${layer.id}-pivot`,
          scope: "pivot",
          path: `$.manifest.approvals.${approval.id}`,
        });
      } else if (approval.scope === "fidelity") {
        assertClosedApproval(context, approval, {
          requiredHashes: [],
          requiredLayerIds: [layer.id],
          reviewSetId: `${layer.id}-fidelity`,
          scope: "fidelity",
          path: `$.manifest.approvals.${approval.id}`,
        });
      }
    }
    if (layer.disposition === "approved-moving") {
      const scopes = new Set(layer.approvalIds.map((id) => approvalById(
        manifest,
        id,
        `$.manifest.layers.${layer.id}.approvalIds`,
      ).scope));
      if (!scopes.has("segmentation") || !scopes.has("pivot")) {
        fail(
          LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
          `Approved moving layer ${layer.id} lacks segmentation or pivot approval`,
          `$.manifest.layers.${layer.id}.approvalIds`,
        );
      }
      const motion = motionById.get(layer.motionProfileId);
      if (motion === undefined) {
        fail(
          LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
          `Approved moving layer ${layer.id} lacks a motion profile`,
          `$.manifest.layers.${layer.id}.motionProfileId`,
        );
      }
    }
  }

  for (const reconstruction of manifest.reconstructions) {
    const approval = approvalById(
      manifest,
      reconstruction.approvalId,
      `$.manifest.reconstructions.${reconstruction.id}.approvalId`,
    );
    const requiredLayerIds = manifest.layers
      .filter(({ approvalIds }) => approvalIds.includes(reconstruction.approvalId))
      .map(({ id }) => id)
      .sort(lexicalCompare);
    if (requiredLayerIds.length === 0) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        `Reconstruction ${reconstruction.id} is not bound by any current layer`,
        `$.manifest.reconstructions.${reconstruction.id}.approvalId`,
      );
    }
    assertClosedApproval(context, approval, {
      requiredHashes: [
        reconstruction.fillSha256,
        maskById.get(reconstruction.regionMaskId)?.sha256,
        maskById.get(reconstruction.boundaryMaskId)?.sha256,
      ].filter(Boolean),
      requiredLayerIds,
      reviewSetId: requiredLayerIds.length === 1
        ? `${requiredLayerIds[0]}-reconstruction`
        : undefined,
      scope: "reconstruction",
      path: `$.manifest.approvals.${approval.id}`,
    });
  }
  for (const motion of manifest.motionProfiles) {
    const approval = approvalById(
      manifest,
      motion.approvalId,
      `$.manifest.motionProfiles.${motion.id}.approvalId`,
    );
    assertClosedApproval(context, approval, {
      requiredHashes: [sha256(MOTION_PROFILE_SCHEMA.serialize(motion))],
      requiredLayerIds: [motion.layerId],
      reviewSetId: `${motion.layerId}-${motion.id}-motion`,
      scope: "motion",
      path: `$.manifest.approvals.${approval.id}`,
    });
  }
  for (const relationship of manifest.relationships) {
    const approval = approvalById(
      manifest,
      relationship.approvalId,
      `$.manifest.relationships.${relationship.id}.approvalId`,
    );
    assertClosedApproval(context, approval, {
      requiredHashes: [sha256(GEAR_RELATIONSHIP_SCHEMA.serialize(relationship))],
      requiredLayerIds: [relationship.driverLayerId, relationship.drivenLayerId],
      scope: "motion",
      path: `$.manifest.approvals.${approval.id}`,
    });
  }
  for (const depth of manifest.depthProfiles.filter(({ enabled }) => enabled)) {
    const approval = approvalById(
      manifest,
      depth.approvalId,
      `$.manifest.depthProfiles.${depth.id}.approvalId`,
    );
    const requiredLayerIds = depth.layers.map(({ layerId }) => layerId);
    assertClosedApproval(context, approval, {
      requiredHashes: [sha256(DEPTH_PROFILE_SCHEMA.serialize(depth))],
      requiredLayerIds,
      reviewSetId: requiredLayerIds.length === 1
        ? `${requiredLayerIds[0]}-${depth.id}-depth`
        : undefined,
      scope: "depth",
      path: `$.manifest.approvals.${approval.id}`,
    });
  }
  if (context.selectedPhase !== null) {
    const approval = approvalById(
      manifest,
      context.selectedPhase.approvalId,
      `$.manifest.phases.${context.selectedPhase.name}.approvalId`,
    );
    assertClosedApproval(context, approval, {
      requiredHashes: [
        context.selectedPhase.phasePayloadSha256,
        context.selectedPhase.runtimeManifestSha256,
        ...context.selectedPhase.assetSha256,
      ].filter(Boolean),
      requiredLayerIds: ["approved-part-motion", "optional-depth"]
        .includes(context.selectedPhase.name)
        ? manifest.layers
            .filter(({ disposition }) => disposition === "approved-moving")
            .map(({ id }) => id)
        : [],
      scope: "release",
      path: `$.manifest.approvals.${approval.id}`,
    });
  }

  const globalFidelityApprovals = readyEmptyLayerFidelityApprovals(context);
  if (context.selectedPhase !== null && manifest.layers.length === 0) {
    if (globalFidelityApprovals.length !== 1) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        "Ready empty-layer presentation requires exactly one referenced fidelity approval",
        "$.manifest.approvals",
      );
    }
    const approval = globalFidelityApprovals[0];
    assertClosedApproval(context, approval, {
      requiredHashes: [
        APPROVED_MASTER_IDENTITY.sha256,
        context.selectedPhase.phasePayloadSha256,
        context.selectedPhase.runtimeManifestSha256,
        ...context.selectedPhase.assetSha256,
      ].filter(Boolean),
      requiredLayerIds: [],
      scope: "fidelity",
      path: `$.manifest.approvals.${approval.id}`,
    });
  }

  for (const approvalId of referencedApprovalIds(context)) {
    if (!context.approvalBindings.has(approvalId)) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        `Approval ${approvalId} has no exact current manifest binding`,
        `$.manifest.approvals.${approvalId}`,
      );
    }
  }
  for (const approval of manifest.approvals) {
    if (approval.decision !== "approved") {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        "Package manifests may not carry pending or rejected review decisions",
        `$.manifest.approvals.${approval.id}.decision`,
      );
    }
  }
}

async function verifyProvenanceAndApprovals(context) {
  context.loadedAuthoring = await loadWatchLayerAuthoring({
    projectRoot: context.projectRoot,
  });
  if (context.manifest === null) {
    if (context.loadedAuthoring.approvedMovingLayerIds.length !== 0) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        "Fallback-only release without a package cannot expose approved moving inputs",
        "$.authoring.approvedMovingLayerIds",
      );
    }
    context.selectedPhase = null;
    return;
  }
  validatePackageMatchesAuthoredInputs(context);
  validatePhaseClosure(context);
  validateProvenanceGraph(context);
  validateApprovalClosure(context);
}

function validateSegmentation(context) {
  if (context.manifest === null || context.manifest.layers.length === 0) return;
  const maskInputs = new Map(
    context.loadedAuthoring.normalized.maskInputs.map((entry) => [entry.record.id, entry]),
  );
  const zOrders = new Set();
  const ordered = [];
  for (const layer of context.manifest.layers) {
    const input = maskInputs.get(layer.segmentationMaskId);
    if (input === undefined) {
      fail(
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.SEGMENTATION_INVALID,
        `Layer ${layer.id} lacks its current decoded segmentation mask`,
        `$.manifest.layers.${layer.id}.segmentationMaskId`,
      );
    }
    if (zOrders.has(layer.zOrder)) {
      fail(
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.SEGMENTATION_INVALID,
        "Layer z-orders must form one unique total order",
        `$.manifest.layers.${layer.id}.zOrder`,
      );
    }
    zOrders.add(layer.zOrder);
    if (
      input.raster.nonZeroPixelCount !== layer.sourceVisiblePixelCount
      || input.raster.tightBounds === null
      || layer.sourceRect.x > input.raster.tightBounds.x
      || layer.sourceRect.y > input.raster.tightBounds.y
      || layer.sourceRect.x + layer.sourceRect.width
        < input.raster.tightBounds.x + input.raster.tightBounds.width
      || layer.sourceRect.y + layer.sourceRect.height
        < input.raster.tightBounds.y + input.raster.tightBounds.height
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.SEGMENTATION_INVALID,
        `Layer ${layer.id} source coverage differs from its decoded mask`,
        `$.manifest.layers.${layer.id}`,
      );
    }
    if (
      layer.disposition !== "approved-moving"
      && (layer.motionProfileId !== undefined || layer.depthProfileId !== undefined)
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.SEGMENTATION_INVALID,
        "Static or unapproved layers cannot own independent transform profiles",
        `$.manifest.layers.${layer.id}`,
      );
    }
    ordered.push({ id: layer.id, mask: input.raster, zOrder: layer.zOrder });
  }
  resolveOrderedOverlap(ordered);
}

async function decodeCanonicalSource(context) {
  if (context.canonicalSource !== undefined) return context.canonicalSource;
  const source = await inspectSafeRegularFile(CANONICAL_PROJECT_PATHS.canonicalMaster, {
    expectedPath: CANONICAL_PROJECT_PATHS.canonicalMaster,
    projectRoot: context.projectRoot,
  });
  let metadata;
  let decoded;
  try {
    metadata = await sharp(source.bytes, {
      failOn: "error",
      limitInputPixels: APPROVED_MASTER_IDENTITY.intrinsicWidth
        * APPROVED_MASTER_IDENTITY.intrinsicHeight,
      sequentialRead: true,
    }).metadata();
    decoded = await sharp(source.bytes, {
      failOn: "error",
      limitInputPixels: APPROVED_MASTER_IDENTITY.intrinsicWidth
        * APPROVED_MASTER_IDENTITY.intrinsicHeight,
      sequentialRead: true,
    }).ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
      "Canonical source cannot be decoded for source-space verification",
      CANONICAL_PROJECT_PATHS.canonicalMaster,
    );
  }
  if (
    metadata.format !== "png"
    || source.bytes.subarray(0, 8).toString("hex") !== PNG_SIGNATURE_HEX
    || decoded.info.width !== APPROVED_MASTER_IDENTITY.intrinsicWidth
    || decoded.info.height !== APPROVED_MASTER_IDENTITY.intrinsicHeight
    || decoded.info.channels !== 4
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
      "Canonical source decode differs from its approved RGBA identity",
      CANONICAL_PROJECT_PATHS.canonicalMaster,
    );
  }
  context.canonicalSource = Object.freeze({
    data: Buffer.from(decoded.data),
    height: decoded.info.height,
    width: decoded.info.width,
  });
  return context.canonicalSource;
}

function reconstructionLayerIds(context, reconstruction) {
  return context.manifest.layers
    .filter(({ approvalIds }) => approvalIds.includes(reconstruction.approvalId))
    .map(({ id }) => id)
    .sort(lexicalCompare);
}

async function validateReconstruction(context) {
  if (context.manifest === null) return;
  const source = await decodeCanonicalSource(context);
  const maskInputs = new Map(
    context.loadedAuthoring.normalized.maskInputs.map((entry) => [entry.record.id, entry.raster]),
  );
  const fillInputs = new Map(
    context.loadedAuthoring.normalized.fillInputs.map((entry) => [entry.record.fillId, entry.raster]),
  );
  const layerById = new Map(context.manifest.layers.map((layer) => [layer.id, layer]));
  const records = [];
  const coveredMovingIds = new Set();
  for (let index = 0; index < context.manifest.reconstructions.length; index += 1) {
    const reconstruction = context.manifest.reconstructions[index];
    const layerIds = reconstructionLayerIds(context, reconstruction);
    const footprintMasks = layerIds.map((id) => {
      const layer = layerById.get(id);
      const mask = layer === undefined ? undefined : maskInputs.get(layer.segmentationMaskId);
      if (layer === undefined || mask === undefined) {
        fail(
          LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.RECONSTRUCTION_INVALID,
          `Reconstruction ${reconstruction.id} references an unresolved layer footprint`,
          `$.manifest.reconstructions.${reconstruction.id}`,
        );
      }
      if (layer.disposition === "approved-moving") coveredMovingIds.add(layer.id);
      return mask;
    });
    if (footprintMasks.length === 0) {
      fail(
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.RECONSTRUCTION_INVALID,
        "Reconstruction approval must bind at least one layer footprint",
        `$.manifest.reconstructions.${reconstruction.id}.approvalId`,
      );
    }
    const regionMask = maskInputs.get(reconstruction.regionMaskId);
    const boundaryMask = maskInputs.get(reconstruction.boundaryMaskId);
    const fill = fillInputs.get(reconstruction.fillId);
    if (regionMask === undefined || boundaryMask === undefined || fill === undefined) {
      fail(
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.RECONSTRUCTION_INVALID,
        `Reconstruction ${reconstruction.id} lacks a current decoded mask or fill`,
        `$.manifest.reconstructions.${reconstruction.id}`,
      );
    }
    const footprintMask = footprintMasks.length === 1
      ? footprintMasks[0]
      : unionMasks(footprintMasks);
    records.push({
      boundaryMask,
      fill,
      footprintMask,
      id: reconstruction.id,
      reconstructionMask: regionMask,
      zOrder: index,
    });
  }
  for (const layer of context.manifest.layers.filter(({ disposition }) => (
    disposition === "approved-moving"
  ))) {
    if (!coveredMovingIds.has(layer.id)) {
      fail(
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.RECONSTRUCTION_INVALID,
        `Approved moving layer ${layer.id} lacks complete reconstruction coverage`,
        `$.manifest.layers.${layer.id}`,
      );
    }
  }
  context.reconstructedBackground = composeReconstructedBackground({
    reconstructions: records,
    source,
  });
  context.reconstructionRecords = records;
}

async function inspectEvidenceSetBinding(context, indexFile, index, reviewSet) {
  const artifactByPath = new Map(index.artifacts.map((artifact) => [artifact.path, artifact]));
  const hashes = new Set([indexFile.identity.sha256, ...reviewSet.projectionSha256]);
  for (const expected of reviewSet.inputFiles) {
    const current = await inspectSafeRegularFile(expected.path, {
      allowPublic: true,
      projectRoot: context.projectRoot,
    });
    if (
      current.identity.sha256 !== expected.sha256
      || current.identity.byteLength !== expected.byteLength
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
        "Fidelity review input differs from the indexed identity",
        expected.path,
      );
    }
    hashes.add(current.identity.sha256);
  }
  for (const path of reviewSet.artifactPaths) {
    const expected = artifactByPath.get(path);
    const current = await inspectSafeRegularFile(path, {
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
      projectRoot: context.projectRoot,
    });
    if (
      expected === undefined
      || current.identity.sha256 !== expected.sha256
      || current.identity.byteLength !== expected.byteLength
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
        "Fidelity evidence differs from the current evidence index",
        path,
      );
    }
    hashes.add(current.identity.sha256);
  }
  return [...hashes].sort(lexicalCompare);
}

async function validateFidelityApprovals(context) {
  const manifest = context.manifest;
  const fidelityApprovals = manifest.approvals.filter(({ scope }) => scope === "fidelity");
  const indexFile = await inspectSafeRegularFile(LAYER_REVIEW_EVIDENCE_INDEX_PATH, {
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
    expectedPath: LAYER_REVIEW_EVIDENCE_INDEX_PATH,
    projectRoot: context.projectRoot,
  });
  const index = validateLayerReviewEvidenceIndex(parseCanonicalJson(indexFile.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  }));
  const fidelitySets = index.reviewSets.filter(({ scope }) => scope === "fidelity");

  if (manifest.layers.length === 0) {
    const requiredHashes = [
      APPROVED_MASTER_IDENTITY.sha256,
      context.selectedPhase.phasePayloadSha256,
      context.selectedPhase.runtimeManifestSha256,
      ...context.selectedPhase.assetSha256,
    ].filter(Boolean);
    const passing = fidelityApprovals.filter((approval) => {
      try {
        assertClosedApproval(context, approval, {
          requiredHashes,
          requiredLayerIds: [],
          scope: "fidelity",
          path: `$.manifest.approvals.${approval.id}`,
        });
        return approval.reviewedPoseIds.includes("reference-pose")
          && approval.reviewedZoomPercent.includes(100)
          && approval.reviewedZoomPercent.includes(200);
      } catch (error) {
        if (error instanceof WatchLayerVerificationError) return false;
        throw error;
      }
    });
    if (passing.length !== 1) {
      fail(
        LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
        "Ready empty-layer presentation requires one exact approved reference fidelity record",
        "$.manifest.approvals",
      );
    }
    return;
  }

  for (const layer of manifest.layers) {
    const sets = fidelitySets.filter(({ layerIds }) => (
      layerIds.length === 1 && layerIds[0] === layer.id
    ));
    if (sets.length !== 1) {
      fail(
        LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
        `Layer ${layer.id} requires one current fidelity evidence set`,
        LAYER_REVIEW_EVIDENCE_INDEX_PATH,
      );
    }
    const reviewSet = sets[0];
    const expectedHashes = await inspectEvidenceSetBinding(
      context,
      indexFile,
      index,
      reviewSet,
    );
    const passing = fidelityApprovals.filter((approval) => evaluateApprovalClosure(approval, {
      approvalId: approval.id,
      artifactSha256: expectedHashes,
      layerIds: reviewSet.layerIds,
      reviewedPoseIds: reviewSet.poseIds,
      reviewedZoomPercent: reviewSet.zoomPercent,
      scope: "fidelity",
    }).ok);
    if (passing.length !== 1) {
      fail(
        LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
        `Layer ${layer.id} lacks one exact hash-bound fidelity approval`,
        `$.manifest.approvals`,
      );
    }
  }
}

async function validateFidelityAndCoverage(context) {
  if (context.manifest === null || context.release.status === "fallback-only") return;
  const source = await decodeCanonicalSource(context);
  const background = context.reconstructedBackground
    ?? composeReconstructedBackground({ source });
  const maskInputs = new Map(
    context.loadedAuthoring.normalized.maskInputs.map((entry) => [entry.record.id, entry.raster]),
  );
  const fullMask = createMaskRaster({
    data: Buffer.alloc(source.width * source.height, 255),
    height: source.height,
    width: source.width,
  });
  const layers = [{
    classification: "source-visible",
    id: "reconstructed-background",
    image: background.image,
    mask: fullMask,
    zOrder: -1,
  }];
  for (const layer of context.manifest.layers) {
    if (canonicalJsonStringify(layer.referenceTransform) !== IDENTITY_MATRIX_TEXT) {
      fail(
        LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
        "Source-space verifier requires the approved reference pose to be identity-aligned",
        `$.manifest.layers.${layer.id}.referenceTransform`,
      );
    }
    layers.push({
      classification: "source-visible",
      id: layer.id,
      image: source,
      mask: maskInputs.get(layer.segmentationMaskId),
      zOrder: layer.zOrder,
    });
  }
  const composition = layers.length === 1
    ? background.image
    : compositeOrderedLayers(layers).image;
  const report = createSourceSpaceFidelityReport({
    canonicalSource: source,
    composition,
    poseId: "reference-pose",
    reconstructedBackground: background.image,
    reconstructionMasks: (context.reconstructionRecords ?? []).map(({ id, reconstructionMask }) => ({
      id,
      mask: reconstructionMask,
    })),
    referenceFootprintMasks: (context.reconstructionRecords ?? []).map(({ footprintMask, id }) => ({
      id,
      mask: footprintMask,
    })),
    segmentationMasks: context.manifest.layers.map((layer) => ({
      id: layer.id,
      mask: maskInputs.get(layer.segmentationMaskId),
    })),
  });
  if (!report.ok) {
    const first = report.failures[0];
    fail(
      first.code,
      first.issueCode,
      first.message,
      first.path,
    );
  }
  context.fidelityReport = report;
  await validateFidelityApprovals(context);
}

function validateMotion(context) {
  if (context.manifest === null) return;
  const layerById = new Map(context.manifest.layers.map((layer) => [layer.id, layer]));
  const motionById = new Map(context.manifest.motionProfiles.map((motion) => [motion.id, motion]));
  const moving = context.manifest.layers.filter(({ disposition }) => (
    disposition === "approved-moving"
  ));
  for (const layer of context.manifest.layers) {
    const motion = layer.motionProfileId === undefined
      ? undefined
      : motionById.get(layer.motionProfileId);
    if (layer.disposition !== "approved-moving") {
      if (motion !== undefined || layer.motionProfileId !== undefined) {
        fail(
          LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.MOTION_INVALID,
          `Static layer ${layer.id} cannot receive independent motion`,
          `$.manifest.layers.${layer.id}.motionProfileId`,
        );
      }
      continue;
    }
    if (
      motion === undefined
      || motion.layerId !== layer.id
      || !canonicalEqual(motion.pivot, layer.pivot)
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.MOTION_INVALID,
        `Approved moving layer ${layer.id} lacks its exact pivot-bound motion profile`,
        `$.manifest.layers.${layer.id}.motionProfileId`,
      );
    }
  }
  if (context.manifest.motionProfiles.length !== moving.length) {
    fail(
      LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.MOTION_INVALID,
      "Motion profile membership must equal the approved-moving layer set",
      "$.manifest.motionProfiles",
    );
  }

  for (const relationship of context.manifest.relationships) {
    const driver = layerById.get(relationship.driverLayerId);
    const driven = layerById.get(relationship.drivenLayerId);
    const driverMotion = driver === undefined ? undefined : motionById.get(driver.motionProfileId);
    const drivenMotion = driven === undefined ? undefined : motionById.get(driven.motionProfileId);
    if (
      driver?.disposition !== "approved-moving"
      || driven?.disposition !== "approved-moving"
      || driverMotion?.kind !== "continuous-rotation"
      || drivenMotion?.kind !== "continuous-rotation"
      || driverMotion.direction === drivenMotion.direction
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.MOTION_INVALID,
        `Relationship ${relationship.id} does not connect opposite approved continuous rotations`,
        `$.manifest.relationships.${relationship.id}`,
      );
    }
    const actualRatio = driverMotion.periodMs / drivenMotion.periodMs;
    const expectedRatio = relationship.driverToothCount / relationship.drivenToothCount;
    if (Math.abs(actualRatio - expectedRatio) > 1e-9) {
      fail(
        LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.MOTION_INVALID,
        `Relationship ${relationship.id} violates its inverse tooth-count speed ratio`,
        `$.manifest.relationships.${relationship.id}`,
      );
    }
  }
  // An empty approved-moving set is deliberately valid and remains at Reference Pose.
}

function validateDepth(context) {
  if (context.manifest === null) {
    if (context.release.depthEnabled !== false) {
      fail(
        LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.DEPTH_INVALID,
        "A package-free fallback cannot enable depth",
        "$.release.depthEnabled",
      );
    }
    return;
  }
  const enabled = context.manifest.depthProfiles.filter(({ enabled: value }) => value);
  if (context.release.depthEnabled !== (enabled.length !== 0)) {
    fail(
      LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.DEPTH_INVALID,
      "Release depth flag differs from enabled depth profile membership",
      "$.release.depthEnabled",
    );
  }
  if (enabled.length === 0) return;
  if (
    context.selectedPhase?.name !== "optional-depth"
    || !setsEqual(enabled.map(({ profile }) => profile), ["compact", "expanded"])
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.DEPTH_INVALID,
      "Enabled depth requires approved compact and expanded profiles in the optional-depth phase",
      "$.manifest.depthProfiles",
    );
  }
  const layerById = new Map(context.manifest.layers.map((layer) => [layer.id, layer]));
  for (const profile of enabled) {
    for (const value of profile.layers) {
      const layer = layerById.get(value.layerId);
      if (layer === undefined || layer.zOrder !== value.zOrder) {
        fail(
          LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.DEPTH_INVALID,
          `Depth profile ${profile.id} references a missing or reordered layer`,
          `$.manifest.depthProfiles.${profile.id}`,
        );
      }
    }
  }
}

async function inspectPublicAsset(context, asset) {
  const file = await inspectSafeRegularFile(asset.file, {
    allowPublic: true,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory],
    expectedPath: asset.file,
    projectRoot: context.projectRoot,
  });
  const bytes = file.bytes;
  if (
    bytes.byteLength !== asset.byteLength
    || sha256(bytes) !== asset.sha256
    || bytes.byteLength < WEBP_PREFIX_BYTES
    || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.byteLength
    || bytes.subarray(0, WEBP_PREFIX_BYTES).toString("hex") !== asset.magicSignatureHex
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
      `Public asset ${asset.id} has an invalid finalized identity or WebP signature`,
      asset.file,
    );
  }
  let metadata;
  let decoded;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: asset.decodedPixelCount,
      sequentialRead: true,
    }).metadata();
    decoded = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: asset.decodedPixelCount,
      sequentialRead: true,
    }).toColourspace("srgb").ensureAlpha().raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
      `Public asset ${asset.id} cannot be decoded as bounded WebP`,
      asset.file,
    );
  }
  if (
    metadata.format !== "webp"
    || metadata.width !== asset.intrinsicWidth
    || metadata.height !== asset.intrinsicHeight
    || metadata.space !== "srgb"
    || decoded.info.width !== asset.intrinsicWidth
    || decoded.info.height !== asset.intrinsicHeight
    || decoded.info.channels !== 4
    || decoded.data.byteLength !== asset.decodedRgbaByteLength
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
      `Public asset ${asset.id} decoded metadata differs from its manifest`,
      asset.file,
    );
  }
  context.artifacts.get(asset.id).digest = file.identity.sha256;
  return file;
}

function referencedApprovalIds(context) {
  if (context.manifest === null) return [];
  return uniqueSorted([
    ...context.manifest.layers.flatMap(({ approvalIds }) => approvalIds),
    ...context.manifest.reconstructions.map(({ approvalId }) => approvalId),
    ...context.manifest.motionProfiles.map(({ approvalId }) => approvalId),
    ...context.manifest.relationships.map(({ approvalId }) => approvalId),
    ...context.manifest.depthProfiles
      .filter(({ enabled }) => enabled)
      .map(({ approvalId }) => approvalId),
    ...(context.selectedPhase?.approvalId === undefined
      ? []
      : [context.selectedPhase.approvalId]),
    ...readyEmptyLayerFidelityApprovals(context).map(({ id }) => id),
  ]);
}

function buildObservedArtifacts(context) {
  return [...context.artifacts.values()]
    .map((artifact) => {
      const provenance = artifact.provenance;
      if (provenance === null) {
        fail(
          LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
          `Artifact ${artifact.id} lacks provenance at closure`,
          artifact.path,
        );
      }
      return {
        classification: provenance.classification,
        id: artifact.id,
        immediateParentSha256: provenance.immediateParentSha256,
        sha256: artifact.digest,
      };
    })
    .sort((left, right) => lexicalCompare(left.id, right.id));
}

function createManifestApprovalClosureInput(context) {
  const approvalRequirements = [];
  const evidenceSha256 = new Set();
  for (const approvalId of referencedApprovalIds(context)) {
    const binding = context.approvalBindings?.get(approvalId);
    if (binding === undefined) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        `Approval ${approvalId} lacks an exact verifier binding`,
        `$.manifest.approvals.${approvalId}`,
      );
    }
    const expectation = binding.expectation;
    if (
      !setsEqual(binding.layerIds, expectation.layerIds)
      || binding.semanticHashes.some((digest) => !expectation.artifactSha256.includes(digest))
    ) {
      fail(
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.APPROVAL_INCOMPLETE,
        `Approval ${approvalId} verifier binding is internally inconsistent`,
        `$.manifest.approvals.${approvalId}`,
      );
    }
    const semanticHashes = new Set(binding.semanticHashes);
    const approvalEvidenceSha256 = expectation.artifactSha256
      .filter((digest) => !semanticHashes.has(digest))
      .sort(lexicalCompare);
    approvalEvidenceSha256.forEach((digest) => evidenceSha256.add(digest));
    approvalRequirements.push({
      approvalId,
      artifactSha256: [...binding.semanticHashes],
      evidenceSha256: approvalEvidenceSha256,
      layerIds: [...binding.layerIds],
      reviewedPoseIds: [...expectation.reviewedPoseIds],
      reviewedZoomPercent: [...expectation.reviewedZoomPercent],
      scope: expectation.scope,
    });
  }
  return deepFreeze({
    approvalRequirements,
    evidenceSha256: [...evidenceSha256].sort(lexicalCompare),
  });
}

async function validatePublicAssetsAndRuntime(context) {
  const publicFiles = await collectSafeDirectoryFiles(
    context.projectRoot,
    CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    { allowPublic: true, optional: true },
  );
  if (context.release.status === "fallback-only") {
    if (publicFiles.length !== 0) {
      fail(
        LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
        WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
        "Fallback-only release must expose zero successor public resources",
        publicFiles[0],
      );
    }
    if (context.manifest !== null) {
      const approvalClosureInput = createManifestApprovalClosureInput(context);
      const closure = evaluateManifestClosure({
        approvalRequirements: approvalClosureInput.approvalRequirements,
        artifacts: buildObservedArtifacts(context),
        evidenceSha256: approvalClosureInput.evidenceSha256,
        manifest: context.manifest,
        release: context.release,
        runtimeManifest: null,
      });
      if (!closure.ok) {
        fail(
          closure.code ?? LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
          closure.issueCode ?? WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
          closure.message,
          closure.path ?? "$",
        );
      }
    }
    context.runtimeManifest = null;
    context.runtimeFile = null;
    return;
  }

  const expectedFiles = uniqueSorted([
    WATCH_LAYER_RUNTIME_MANIFEST_PATH,
    ...context.manifest.publicAssets.map(({ file }) => file),
  ]);
  if (!arraysEqual(publicFiles, expectedFiles)) {
    const changed = uniqueSorted([...publicFiles, ...expectedFiles]).find((path) => (
      publicFiles.includes(path) !== expectedFiles.includes(path)
    ));
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
      "Successor public membership differs from the exact package profile set",
      changed ?? CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    );
  }
  const runtimeFile = await inspectSafeRegularFile(WATCH_LAYER_RUNTIME_MANIFEST_PATH, {
    allowPublic: true,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory],
    expectedPath: WATCH_LAYER_RUNTIME_MANIFEST_PATH,
    projectRoot: context.projectRoot,
  });
  const runtimeManifest = RUNTIME_MANIFEST_SCHEMA.parseJson(runtimeFile.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  });
  if (
    runtimeFile.identity.sha256 !== context.release.runtimeManifest.sha256
    || runtimeFile.identity.byteLength !== context.release.runtimeManifest.byteLength
    || runtimeFile.identity.sha256 !== context.manifest.runtimeManifest.sha256
    || runtimeFile.identity.byteLength !== context.manifest.runtimeManifest.byteLength
  ) {
    fail(
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
      "Runtime manifest bytes do not match the package and release identities",
      WATCH_LAYER_RUNTIME_MANIFEST_PATH,
    );
  }
  for (const asset of context.manifest.publicAssets) {
    await inspectPublicAsset(context, asset);
  }

  const approvalClosureInput = createManifestApprovalClosureInput(context);
  const closure = evaluateManifestClosure({
    approvalRequirements: approvalClosureInput.approvalRequirements,
    artifacts: buildObservedArtifacts(context),
    evidenceSha256: approvalClosureInput.evidenceSha256,
    manifest: context.manifest,
    release: context.release,
    runtimeManifest,
  });
  if (!closure.ok) {
    const publicIssue = [
      "CLOSURE_RELEASE_REFERENCE_MISMATCH",
      "CLOSURE_RUNTIME_IDENTITY_MISMATCH",
      "CLOSURE_RUNTIME_MEMBERSHIP_MISMATCH",
    ].includes(closure.issueCode);
    fail(
      publicIssue
        ? LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH
        : closure.code ?? LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      closure.issueCode ?? WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
      closure.message,
      closure.path ?? "$",
    );
  }
  context.runtimeManifest = runtimeManifest;
  context.runtimeFile = runtimeFile;
}

async function validateBudgets(context) {
  if (context.release.status === "fallback-only") return;
  const { evaluateWatchLayerProfileBudget } = await import(
    "./watch-2-5d/profile-budget.mjs"
  );
  const result = evaluateWatchLayerProfileBudget({
    budgets: ENHANCEMENT_BUDGETS,
    manifestAssets: context.manifest.publicAssets,
    profiles: context.runtimeManifest.profiles,
    runtimeManifestByteLength: context.runtimeFile.identity.byteLength,
  });
  if (!result.ok) {
    fail(
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.BUDGET_INVALID,
      result.message,
      result.path,
    );
  }
}

async function verifyFinalInputHashes(context) {
  for (const path of context.expectedInputPaths) {
    const present = await fileExistsState(context.projectRoot, path);
    if (present !== context.inputPresence.get(path)) {
      fail(
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        WATCH_LAYER_VERIFY_ISSUE_CODES.INPUT_CHANGED,
        "Input membership changed during verification",
        path,
      );
    }
  }
  for (const [path, before] of context.directoryMembership) {
    const after = await collectSafeDirectoryFiles(context.projectRoot, path, {
      allowPublic: path.startsWith("public/"),
      optional: true,
    });
    if (!arraysEqual(before, after)) {
      fail(
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        WATCH_LAYER_VERIFY_ISSUE_CODES.INPUT_CHANGED,
        "Input directory membership changed during verification",
        path,
      );
    }
  }
  try {
    await assertInputHashSnapshotUnchanged(context.inputSnapshot, {
      allowPublic: true,
      projectRoot: context.projectRoot,
    });
  } catch (error) {
    fail(
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.INPUT_CHANGED,
      error instanceof Error ? error.message : "Input bytes changed during verification",
      stablePathFromError(error),
    );
  }
}

/**
 * Verify the predecessor and successor package in the documented fixed order.
 * This function never writes, requests a network resource, retries, or publishes.
 */
export async function verifyWatchLayerAssets({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail(
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
      "projectRoot must be a nonempty path",
      "$.projectRoot",
    );
  }
  const context = {
    completedGates: [],
    projectRoot: resolve(projectRoot),
  };
  return withWatchLayerVerifierSandbox(async () => {
    context.predecessor = await runGate(
      context,
      "predecessor",
      LAYER_GATE_FAILURE_CODES.PREDECESSOR_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PREDECESSOR_INVALID,
      async () => {
        try {
          return await verifyWatchImageAssets({ projectRoot: context.projectRoot });
        } catch (error) {
          fail(
            LAYER_GATE_FAILURE_CODES.PREDECESSOR_INVALID,
            WATCH_LAYER_VERIFY_ISSUE_CODES.PREDECESSOR_INVALID,
            error instanceof Error ? error.message : "Predecessor verification failed",
            CANONICAL_PROJECT_PATHS.predecessorManifest,
          );
        }
      },
    );
    context.protectedIntegrity = await runGate(
      context,
      "protected-integrity",
      LAYER_GATE_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROTECTED_INTEGRITY_INVALID,
      () => verifyProtectedIntegrity(context.projectRoot),
    );
    await runGate(
      context,
      "schema-path",
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.SCHEMA_INVALID,
      async () => {
        await loadStrictDocuments(context);
        await createVerifierInputSnapshot(context);
      },
    );
    await runGate(
      context,
      "identities",
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.IDENTITY_INVALID,
      () => verifyIdentities(context),
    );
    await runGate(
      context,
      "provenance-approvals",
      LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PROVENANCE_INVALID,
      () => verifyProvenanceAndApprovals(context),
    );
    await runGate(
      context,
      "segmentation",
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.SEGMENTATION_INVALID,
      () => validateSegmentation(context),
    );
    await runGate(
      context,
      "reconstruction",
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.RECONSTRUCTION_INVALID,
      () => validateReconstruction(context),
    );
    await runGate(
      context,
      "fidelity-coverage",
      LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.FIDELITY_INCOMPLETE,
      () => validateFidelityAndCoverage(context),
    );
    await runGate(
      context,
      "motion",
      LAYER_GATE_FAILURE_CODES.MOTION_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.MOTION_INVALID,
      () => validateMotion(context),
    );
    await runGate(
      context,
      "depth",
      LAYER_GATE_FAILURE_CODES.DEPTH_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.DEPTH_INVALID,
      () => validateDepth(context),
    );
    await runGate(
      context,
      "public-assets-runtime-manifest",
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
      WATCH_LAYER_VERIFY_ISSUE_CODES.PUBLIC_ASSET_INVALID,
      () => validatePublicAssetsAndRuntime(context),
    );
    await runGate(
      context,
      "budgets",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.BUDGET_INVALID,
      () => validateBudgets(context),
    );
    await runGate(
      context,
      "input-hashes",
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      WATCH_LAYER_VERIFY_ISSUE_CODES.INPUT_CHANGED,
      () => verifyFinalInputHashes(context),
    );

    return deepFreeze({
      approvedMovingLayerIds: context.manifest === null
        ? []
        : context.manifest.layers
            .filter(({ disposition }) => disposition === "approved-moving")
            .map(({ id }) => id)
            .sort(lexicalCompare),
      completedGates: [...context.completedGates],
      depthEnabled: context.release.depthEnabled,
      networkRequests: 0,
      ok: true,
      packagePresent: context.manifest !== null,
      protectedEntryCount: context.protectedIntegrity.entryCount,
      releaseStatus: context.release.status,
      selectedPhase: context.selectedPhase?.name ?? null,
      writes: 0,
    });
  });
}

export const verifyLayerAssets = verifyWatchLayerAssets;
export const verifyWatchLayers = verifyWatchLayerAssets;

export function parseWatchLayerVerifyArguments(argv) {
  if (!Array.isArray(argv)) {
    fail(
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
      "CLI arguments must be an array",
      "$.argv",
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      if (parsed.help === true) {
        fail(
          LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
          WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
          "--help may appear only once",
          flag,
        );
      }
      parsed.help = true;
      continue;
    }
    if (flag !== "--project-root" || parsed.projectRoot !== undefined) {
      fail(
        LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
        `Unknown or repeated argument ${String(flag)}`,
        String(flag),
      );
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      fail(
        LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
        WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
        "--project-root requires one path value",
        flag,
      );
    }
    parsed.projectRoot = value;
    index += 1;
  }
  if (parsed.help && Object.keys(parsed).length !== 1) {
    fail(
      LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
      WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
      "--help cannot be combined with other arguments",
      "--help",
    );
  }
  return Object.freeze(parsed);
}

const USAGE = `Usage:\n  node scripts/verify-watch-layer-assets.mjs [--project-root <path>]\n\nRuns the fixed-order, read-only Layer Asset Gate. A valid fallback-only release exits zero and requests no successor resources.`;

function formatFailure(error) {
  if (error && typeof error === "object" && "code" in error) {
    const issue = "issueCode" in error ? `/${String(error.issueCode)}` : "";
    const message = error instanceof Error ? error.message : "Watch-layer verification failed";
    const path = "path" in error && error.path !== null ? ` [${String(error.path)}]` : "";
    return `${String(error.code)}${issue}: ${message}${path}`;
  }
  return `${LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function runWatchLayerVerifyCli(argv = process.argv.slice(2)) {
  const parsed = parseWatchLayerVerifyArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return null;
  }
  const result = await verifyWatchLayerAssets({
    projectRoot: parsed.projectRoot ?? DEFAULT_PROJECT_ROOT,
  });
  console.log(
    `WATCH_LAYER_ASSET_VERIFICATION_OK status=${result.releaseStatus} phase=${result.selectedPhase ?? "none"} package=${result.packagePresent ? "present" : "absent"}`,
  );
  return result;
}

async function main() {
  try {
    await runWatchLayerVerifyCli();
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  await main();
}
