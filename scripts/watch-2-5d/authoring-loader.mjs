import {
  lstat,
  readdir,
} from "node:fs/promises";
import {
  basename,
  relative,
  resolve,
  sep,
} from "node:path";
import sharp from "sharp";
import {
  APPROVAL_RECORD_SCHEMA,
  APPROVED_MASTER_IDENTITY,
  AUTHORING_DOCUMENT_SCHEMA,
  CANONICAL_PROJECT_PATHS,
  CANONICAL_SOURCE_COORDINATE_SPACE,
  DEFAULT_PROJECT_ROOT,
  DEPTH_PROFILE_SCHEMA,
  GEAR_RELATIONSHIP_SCHEMA,
  LAYER_GATE_FAILURE_CODES,
  LAYER_RECORD_SCHEMA,
  MOTION_PROFILE_SCHEMA,
  MOTION_SEMANTIC_CLASSES,
  PREDECESSOR_MANIFEST_IDENTITY,
  assertInputHashSnapshotUnchanged,
  assertSafeProjectRelativePath,
  createInputHashSnapshot,
  inspectSafeRegularFile,
  parseCanonicalJson,
  resolveSafeProjectPath,
  serializeCanonicalJson,
  sha256,
} from "./contract.mjs";
import {
  APPROVAL_TOOL_ISSUE_CODES,
  createReviewSetApprovalExpectation,
  evaluateApprovalClosure,
  evaluateProvenanceClosure,
  validateReviewerApprovalRecord,
} from "./approval-records.mjs";
import {
  LAYER_REVIEW_EVIDENCE_INDEX_PATH,
  validateLayerReviewEvidenceIndex,
} from "./review-evidence.mjs";
import {
  MAX_RECONSTRUCTION_FEATHER_PIXELS,
  decodeCanonicalMask,
  dilateMask,
  unionMasks,
} from "./image-operations.mjs";

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";
const PNG_IHDR_LENGTH = 13;
const PNG_IHDR_TYPE = "IHDR";
const RGBA_PNG_COLOR_TYPE = 6;
const STABLE_FILE_STEM_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MOTION_CLASS_SET = new Set(MOTION_SEMANTIC_CLASSES);

export const AUTHORING_LOADER_LIMITS = Object.freeze({
  maxApprovalFileBytes: 1_048_576,
  maxApprovalFiles: 256,
  maxArtifactFiles: 256,
  maxAuthoringBytes: 8_388_608,
  maxEvidenceFiles: 1_024,
  maxEvidenceTotalBytes: 536_870_912,
});

export const AUTHORING_LOADER_ISSUE_CODES = Object.freeze({
  APPROVAL_AMBIGUOUS: "AUTHORING_APPROVAL_AMBIGUOUS",
  APPROVAL_FILE_INVALID: "AUTHORING_APPROVAL_FILE_INVALID",
  ARGUMENT_INVALID: "AUTHORING_ARGUMENT_INVALID",
  AUTHORING_INVALID: "AUTHORING_DOCUMENT_INVALID",
  DIRECTORY_UNSAFE: "AUTHORING_DIRECTORY_UNSAFE",
  FILL_ALPHA_INVALID: "AUTHORING_FILL_ALPHA_INVALID",
  FILL_IDENTITY_MISMATCH: "AUTHORING_FILL_IDENTITY_MISMATCH",
  FILL_MEDIA_INVALID: "AUTHORING_FILL_MEDIA_INVALID",
  INPUT_CHANGED: "AUTHORING_INPUT_CHANGED",
  LIMIT_EXCEEDED: "AUTHORING_LIMIT_EXCEEDED",
  MASK_IDENTITY_MISMATCH: "AUTHORING_MASK_IDENTITY_MISMATCH",
  MASK_MEDIA_INVALID: "AUTHORING_MASK_MEDIA_INVALID",
  MASK_METADATA_MISMATCH: "AUTHORING_MASK_METADATA_MISMATCH",
  NETWORK_DISABLED: "AUTHORING_NETWORK_DISABLED",
  PROVENANCE_INVALID: "AUTHORING_PROVENANCE_INVALID",
  RECONSTRUCTION_GEOMETRY_INVALID: "AUTHORING_RECONSTRUCTION_GEOMETRY_INVALID",
});

export const AUTHORING_STATIC_REASON_CODES = Object.freeze({
  AUTHORED_STATIC: "AUTHORING_STATIC_AUTHORED",
  FIDELITY_APPROVAL_MISSING: "AUTHORING_STATIC_FIDELITY_APPROVAL_MISSING",
  FIDELITY_APPROVAL_NOT_CLOSED: "AUTHORING_STATIC_FIDELITY_APPROVAL_NOT_CLOSED",
  LAYER_PROVENANCE_INVALID: "AUTHORING_STATIC_LAYER_PROVENANCE_INVALID",
  MASK_FILE_MISSING: "AUTHORING_STATIC_MASK_FILE_MISSING",
  MASK_INVALID: "AUTHORING_STATIC_MASK_INVALID",
  MASK_PROVENANCE_INVALID: "AUTHORING_STATIC_MASK_PROVENANCE_INVALID",
  MOTION_APPROVAL_MISSING: "AUTHORING_STATIC_MOTION_APPROVAL_MISSING",
  MOTION_APPROVAL_NOT_CLOSED: "AUTHORING_STATIC_MOTION_APPROVAL_NOT_CLOSED",
  MOTION_PROFILE_INVALID: "AUTHORING_STATIC_MOTION_PROFILE_INVALID",
  NOT_AUTHORED_APPROVED: "AUTHORING_STATIC_NOT_AUTHORED_APPROVED",
  PIVOT_APPROVAL_MISSING: "AUTHORING_STATIC_PIVOT_APPROVAL_MISSING",
  PIVOT_APPROVAL_NOT_CLOSED: "AUTHORING_STATIC_PIVOT_APPROVAL_NOT_CLOSED",
  PIVOT_INVALID: "AUTHORING_STATIC_PIVOT_INVALID",
  PROPOSED_STATIC: "AUTHORING_STATIC_PROPOSED",
  RECONSTRUCTION_APPROVAL_MISSING: "AUTHORING_STATIC_RECONSTRUCTION_APPROVAL_MISSING",
  RECONSTRUCTION_APPROVAL_NOT_CLOSED: "AUTHORING_STATIC_RECONSTRUCTION_APPROVAL_NOT_CLOSED",
  RECONSTRUCTION_INVALID: "AUTHORING_STATIC_RECONSTRUCTION_INVALID",
  RECONSTRUCTION_MISSING: "AUTHORING_STATIC_RECONSTRUCTION_MISSING",
  RELEASE_APPROVAL_AMBIGUOUS: "AUTHORING_STATIC_RELEASE_APPROVAL_AMBIGUOUS",
  RELEASE_APPROVAL_MISSING: "AUTHORING_STATIC_RELEASE_APPROVAL_MISSING",
  RELEASE_APPROVAL_NOT_CLOSED: "AUTHORING_STATIC_RELEASE_APPROVAL_NOT_CLOSED",
  SEGMENTATION_APPROVAL_MISSING: "AUTHORING_STATIC_SEGMENTATION_APPROVAL_MISSING",
  SEGMENTATION_APPROVAL_NOT_CLOSED: "AUTHORING_STATIC_SEGMENTATION_APPROVAL_NOT_CLOSED",
  SEGMENTATION_GEOMETRY_INVALID: "AUTHORING_STATIC_SEGMENTATION_GEOMETRY_INVALID",
});

export class AuthoringLoaderError extends TypeError {
  constructor(
    issueCode,
    message,
    path = "$",
    code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
  ) {
    super(message);
    this.code = code;
    this.failure = Object.freeze({
      code,
      issueCode,
      message,
      ok: false,
      path,
    });
    this.issueCode = issueCode;
    this.name = "AuthoringLoaderError";
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
  throw new AuthoringLoaderError(issueCode, message, path, code);
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

function addUnique(target, value) {
  if (!target.includes(value)) target.push(value);
}

function sameRect(left, right) {
  return left !== null
    && right !== null
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function samePoint(left, right) {
  return left !== undefined
    && right !== undefined
    && left.x === right.x
    && left.y === right.y;
}

function setEqual(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function includesEvery(values, required) {
  const set = new Set(values);
  return required.every((value) => set.has(value));
}

function stableIssue(artifactId, code, path) {
  return Object.freeze({ artifactId, code, path });
}

/** Execute loader work with browser-style network entry points replaced by guards. */
export async function withAuthoringLoaderNetworkDisabled(operation) {
  if (typeof operation !== "function") {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.ARGUMENT_INVALID,
      "Network-disabled loader operation must be a function",
    );
  }
  const names = ["fetch", "WebSocket", "XMLHttpRequest"];
  const descriptors = new Map();
  const installed = [];
  const guard = function authoringLoaderNetworkGuard() {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.NETWORK_DISABLED,
      "Authored asset loading forbids network access",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  };

  try {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      if (descriptor !== undefined && descriptor.configurable === false) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.NETWORK_DISABLED,
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

async function assertRegularDirectoryChain(projectRoot, projectRelativeDirectory, {
  optional = false,
} = {}) {
  const root = resolve(projectRoot);
  let rootStats;
  try {
    rootStats = await lstat(root);
  } catch {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
      "Project root cannot be inspected",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
      "Project root must be a regular non-symlink directory",
      "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }

  let current = root;
  const segments = projectRelativeDirectory.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (optional && isMissing(error)) return null;
      fail(
        AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
        "Authored package directory is missing or unreadable",
        projectRelativeDirectory,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
        "Authored package directories must be regular and non-symlinked",
        projectRelativeDirectory,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  return current;
}

async function collectRegularFiles(projectRoot, projectRelativeDirectory, {
  directJson = false,
  limit,
  optional = false,
  recursive = false,
} = {}) {
  const normalizedDirectory = assertSafeProjectRelativePath(projectRelativeDirectory, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
    projectRoot,
  });
  const rootDirectory = await assertRegularDirectoryChain(
    projectRoot,
    normalizedDirectory,
    { optional },
  );
  if (rootDirectory === null) return [];

  const files = [];
  const visit = async (absoluteDirectory, relativeDirectory) => {
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
        "Authored package directory cannot be read safely",
        relativeDirectory,
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    entries.sort((left, right) => lexicalCompare(left.name, right.name));
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      const absolutePath = resolve(absoluteDirectory, entry.name);
      if (!isContainedAbsolutePath(resolve(projectRoot), absolutePath)) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
          "Authored package member escapes the project root",
          relativePath,
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        );
      }
      if (entry.isSymbolicLink()) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
          "Authored package directories may not contain symbolic links",
          relativePath,
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        );
      }
      if (entry.isDirectory()) {
        if (!recursive) {
          fail(
            AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
            "Approval records must be direct files in the approvals directory",
            relativePath,
            LAYER_GATE_FAILURE_CODES.PATH_INVALID,
          );
        }
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
          "Authored package members must be regular files",
          relativePath,
          LAYER_GATE_FAILURE_CODES.PATH_INVALID,
        );
      }
      if (directJson) {
        const stem = basename(entry.name, ".json");
        if (!entry.name.endsWith(".json") || !STABLE_FILE_STEM_PATTERN.test(stem)) {
          fail(
            AUTHORING_LOADER_ISSUE_CODES.APPROVAL_FILE_INVALID,
            "Approval files must be stable direct .json children",
            relativePath,
            LAYER_GATE_FAILURE_CODES.PATH_INVALID,
          );
        }
      }
      files.push(relativePath);
      if (files.length > limit) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.LIMIT_EXCEEDED,
          `Authored package directory exceeds its finite ${limit}-file limit`,
          projectRelativeDirectory,
          LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
        );
      }
    }
  };
  await visit(rootDirectory, normalizedDirectory);
  return files;
}

async function pathExistsForSnapshot(projectRoot, projectRelativePath) {
  const absolutePath = resolveSafeProjectPath(projectRelativePath, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
    projectRoot,
  });
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    fail(
      AUTHORING_LOADER_ISSUE_CODES.DIRECTORY_UNSAFE,
      "Declared authored artifact cannot be inspected",
      projectRelativePath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
}

function inspectStrictRgbaPngHeader(bytes, path) {
  if (
    bytes.byteLength < 33
    || bytes.subarray(0, 8).toString("hex") !== PNG_SIGNATURE_HEX
    || bytes.readUInt32BE(8) !== PNG_IHDR_LENGTH
    || bytes.subarray(12, 16).toString("ascii") !== PNG_IHDR_TYPE
  ) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.FILL_MEDIA_INVALID,
      "Reconstruction fill must have a valid PNG signature and leading IHDR",
      path,
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const compressionMethod = bytes[26];
  const filterMethod = bytes[27];
  const interlaceMethod = bytes[28];
  if (
    width !== CANONICAL_SOURCE_COORDINATE_SPACE.width
    || height !== CANONICAL_SOURCE_COORDINATE_SPACE.height
    || bitDepth !== 8
    || colorType !== RGBA_PNG_COLOR_TYPE
    || compressionMethod !== 0
    || filterMethod !== 0
    || interlaceMethod !== 0
  ) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.FILL_MEDIA_INVALID,
      "Reconstruction fill must be a non-interlaced 8-bit RGBA PNG in canonical 2760x1504 space",
      path,
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
}

/** Decode a strict canonical 8-bit RGBA reconstruction fill without adding alpha. */
export async function decodeCanonicalRgbaFill(value, { path = "$.fill" } = {}) {
  if (!ArrayBuffer.isView(value)) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.FILL_MEDIA_INVALID,
      "Reconstruction fill input must be a byte view",
      path,
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  const bytes = Buffer.from(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
  inspectStrictRgbaPngHeader(bytes, path);
  const { width, height } = CANONICAL_SOURCE_COORDINATE_SPACE;
  const pixelCount = width * height;
  let metadata;
  let decoded;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: pixelCount,
      sequentialRead: true,
    }).metadata();
    decoded = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: pixelCount,
      sequentialRead: true,
    })
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.FILL_MEDIA_INVALID,
      "Reconstruction fill cannot be decoded within canonical bounds",
      path,
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  if (
    metadata.format !== "png"
    || metadata.width !== width
    || metadata.height !== height
    || metadata.depth !== "uchar"
    || metadata.channels !== 4
    || metadata.hasAlpha !== true
    || (metadata.pages !== undefined && metadata.pages !== 1)
    || decoded.info.width !== width
    || decoded.info.height !== height
    || decoded.info.channels !== 4
    || decoded.data.byteLength !== pixelCount * 4
  ) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.FILL_MEDIA_INVALID,
      "Decoded reconstruction fill must remain single-page canonical 8-bit RGBA",
      path,
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }

  let opaquePixelCount = 0;
  let partialPixelCount = 0;
  let transparentPixelCount = 0;
  for (let offset = 3; offset < decoded.data.byteLength; offset += 4) {
    const alpha = decoded.data[offset];
    if (alpha === 0) transparentPixelCount += 1;
    else if (alpha === 255) opaquePixelCount += 1;
    else partialPixelCount += 1;
  }
  return Object.freeze({
    data: Buffer.from(decoded.data),
    height,
    opaquePixelCount,
    partialPixelCount,
    transparentPixelCount,
    width,
  });
}

/** Validate one reconstruction against its footprint, boundary, and opaque fill. */
export function validateReconstructionRasterGeometry({
  boundaryMask,
  fill,
  regionMask,
  segmentationMask,
  syntheticPixelCount,
} = {}) {
  if (
    !boundaryMask
    || !fill
    || !regionMask
    || !segmentationMask
    || boundaryMask.width !== CANONICAL_SOURCE_COORDINATE_SPACE.width
    || boundaryMask.height !== CANONICAL_SOURCE_COORDINATE_SPACE.height
    || regionMask.width !== boundaryMask.width
    || regionMask.height !== boundaryMask.height
    || segmentationMask.width !== boundaryMask.width
    || segmentationMask.height !== boundaryMask.height
    || fill.width !== boundaryMask.width
    || fill.height !== boundaryMask.height
  ) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.RECONSTRUCTION_GEOMETRY_INVALID,
      "Reconstruction rasters must share canonical source dimensions",
      "$",
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  const featherLimit = dilateMask(regionMask, MAX_RECONSTRUCTION_FEATHER_PIXELS);
  let syntheticPixels = 0;
  for (let pixel = 0; pixel < regionMask.data.byteLength; pixel += 1) {
    const regionAlpha = regionMask.data[pixel];
    const boundaryAlpha = boundaryMask.data[pixel];
    const segmentationAlpha = segmentationMask.data[pixel];
    const fillAlpha = fill.data[pixel * 4 + 3];
    if (segmentationAlpha > regionAlpha) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.RECONSTRUCTION_GEOMETRY_INVALID,
        "Reconstruction region must replace the complete segmentation footprint",
        `$.regionMask[${pixel}]`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
    if (regionAlpha !== 0 && boundaryAlpha === 0) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.RECONSTRUCTION_GEOMETRY_INVALID,
        "Reconstruction region must remain inside its boundary",
        `$.regionMask[${pixel}]`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
    if (boundaryAlpha !== 0 && featherLimit.data[pixel] === 0) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.RECONSTRUCTION_GEOMETRY_INVALID,
        `Reconstruction boundary exceeds the ${MAX_RECONSTRUCTION_FEATHER_PIXELS}-pixel feather limit`,
        `$.boundaryMask[${pixel}]`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
    if (fillAlpha !== 0) {
      syntheticPixels += 1;
      if (boundaryAlpha === 0) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.FILL_ALPHA_INVALID,
          "Synthetic fill pixels must remain inside the reconstruction boundary",
          `$.fill[${pixel}]`,
          LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        );
      }
    }
    if (regionAlpha !== 0 && fillAlpha !== 255) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.FILL_ALPHA_INVALID,
        "Reconstruction fill must be opaque throughout its declared region",
        `$.fill[${pixel}]`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
  }
  if (
    syntheticPixelCount !== regionMask.nonZeroPixelCount
    || syntheticPixels !== syntheticPixelCount
  ) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.FILL_ALPHA_INVALID,
      "Declared synthetic pixel count must equal the opaque reconstruction region",
      "$.syntheticPixelCount",
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  return Object.freeze({
    boundaryPixelCount: boundaryMask.nonZeroPixelCount,
    featherPixels: MAX_RECONSTRUCTION_FEATHER_PIXELS,
    regionPixelCount: regionMask.nonZeroPixelCount,
    syntheticPixelCount: syntheticPixels,
  });
}

function sourceRectMatchesMask(sourceRect, tightBounds) {
  if (tightBounds === null) return false;
  const contains = sourceRect.x <= tightBounds.x
    && sourceRect.y <= tightBounds.y
    && sourceRect.x + sourceRect.width >= tightBounds.x + tightBounds.width
    && sourceRect.y + sourceRect.height >= tightBounds.y + tightBounds.height;
  if (!contains) return false;
  return tightBounds.x - sourceRect.x <= MAX_RECONSTRUCTION_FEATHER_PIXELS
    && tightBounds.y - sourceRect.y <= MAX_RECONSTRUCTION_FEATHER_PIXELS
    && sourceRect.x + sourceRect.width - tightBounds.x - tightBounds.width
      <= MAX_RECONSTRUCTION_FEATHER_PIXELS
    && sourceRect.y + sourceRect.height - tightBounds.y - tightBounds.height
      <= MAX_RECONSTRUCTION_FEATHER_PIXELS;
}

function pivotProjectionHash(layer) {
  return sha256(serializeCanonicalJson({
    layerId: layer.id,
    pivot: layer.pivot,
  }));
}

function canonicalRecordHash(schema, value) {
  return sha256(schema.serialize(value));
}

function validatePackageLimits(document) {
  const artifactCount = document.masks.length + document.reconstructions.length;
  if (artifactCount > AUTHORING_LOADER_LIMITS.maxArtifactFiles) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.LIMIT_EXCEEDED,
      "Authored mask and reconstruction membership exceeds the finite artifact limit",
      "$",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
}

async function parseExternalApprovalFiles(paths, projectRoot, snapshotByPath) {
  const records = [];
  for (const path of paths) {
    const inspected = await inspectSafeRegularFile(path, {
      allowPublic: false,
      allowedRoots: [CANONICAL_PROJECT_PATHS.successorApprovalsDirectory],
      projectRoot,
    });
    if (inspected.identity.byteLength > AUTHORING_LOADER_LIMITS.maxApprovalFileBytes) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.LIMIT_EXCEEDED,
        "Approval record exceeds the finite byte limit",
        path,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      );
    }
    const snapshotIdentity = snapshotByPath.get(path);
    if (
      snapshotIdentity === undefined
      || snapshotIdentity.sha256 !== inspected.identity.sha256
      || snapshotIdentity.byteLength !== inspected.identity.byteLength
    ) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.INPUT_CHANGED,
        "Approval bytes changed after the input snapshot",
        path,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }
    let record;
    try {
      record = APPROVAL_RECORD_SCHEMA.parseJson(inspected.bytes, {
        allowTrailingNewline: true,
        requireCanonical: true,
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;
      fail(
        AUTHORING_LOADER_ISSUE_CODES.APPROVAL_FILE_INVALID,
        "Approval file is not a strict canonical approval record",
        path,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    if (basename(path, ".json") !== record.id) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.APPROVAL_FILE_INVALID,
        "Approval filename must equal its stable record ID",
        path,
        LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      );
    }
    records.push(Object.freeze({ path, record, source: "file" }));
  }
  return records;
}

async function inspectLayerReviewEvidenceIndex(projectRoot) {
  const inspected = await inspectSafeRegularFile(LAYER_REVIEW_EVIDENCE_INDEX_PATH, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorReviewDirectory],
    expectedPath: LAYER_REVIEW_EVIDENCE_INDEX_PATH,
    projectRoot,
  });
  const index = validateLayerReviewEvidenceIndex(parseCanonicalJson(inspected.bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  }));
  return Object.freeze({ identity: inspected.identity, index });
}

function sameFileIdentity(actual, expected) {
  return actual !== undefined
    && expected !== undefined
    && actual.path === expected.path
    && actual.sha256 === expected.sha256
    && actual.byteLength === expected.byteLength;
}

function createCurrentReviewApprovalEvidence({
  authoringIdentity,
  indexIdentity,
  index,
  snapshotByPath,
}) {
  const currentHeader = sameFileIdentity(index.authoring, authoringIdentity)
    && index.canonicalMaster.path === APPROVED_MASTER_IDENTITY.path
    && index.canonicalMaster.sha256 === APPROVED_MASTER_IDENTITY.sha256
    && index.canonicalMaster.byteLength === APPROVED_MASTER_IDENTITY.byteLength
    && index.canonicalMaster.width === APPROVED_MASTER_IDENTITY.intrinsicWidth
    && index.canonicalMaster.height === APPROVED_MASTER_IDENTITY.intrinsicHeight
    && index.canonicalMaster.mediaType === APPROVED_MASTER_IDENTITY.mediaType;
  const artifactByPath = new Map(index.artifacts.map((artifact) => [
    artifact.path,
    artifact,
  ]));
  const reviewSets = currentHeader
    ? index.reviewSets.filter((reviewSet) => (
        reviewSet.inputFiles.every((identity) => sameFileIdentity(
          snapshotByPath.get(identity.path),
          identity,
        ))
        && reviewSet.artifactPaths.every((path) => sameFileIdentity(
          snapshotByPath.get(path),
          artifactByPath.get(path),
        ))
      ))
    : [];
  return deepFreeze({
    hasIndex: true,
    indexIdentity,
    reviewSets,
  });
}

function createApprovalCatalog(inlineApprovals, externalApprovals) {
  const entries = [
    ...inlineApprovals.map((record) => Object.freeze({
      path: CANONICAL_PROJECT_PATHS.successorAuthoring,
      record,
      source: "inline",
    })),
    ...externalApprovals,
  ];
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.record.id) ?? [];
    group.push(entry);
    groups.set(entry.record.id, group);
  }
  const byId = new Map();
  const duplicateIds = new Set();
  for (const [id, group] of groups) {
    if (group.length !== 1) {
      duplicateIds.add(id);
      continue;
    }
    let validated = null;
    let validationReason = null;
    try {
      validated = validateReviewerApprovalRecord(group[0].record);
    } catch (error) {
      validationReason = error && typeof error === "object" && "issueCode" in error
        ? error.issueCode
        : APPROVAL_TOOL_ISSUE_CODES.APPROVAL_RECORD_INVALID;
    }
    byId.set(id, Object.freeze({
      ...group[0],
      record: validated ?? group[0].record,
      valid: validated !== null,
      validationReason,
    }));
  }
  return Object.freeze({ byId, duplicateIds, entries });
}

async function loadMaskStates(document, inspectedByPath, existingPaths) {
  const states = new Map();
  for (const record of document.masks) {
    if (!existingPaths.has(record.file)) {
      states.set(record.id, Object.freeze({
        issueCode: AUTHORING_STATIC_REASON_CODES.MASK_FILE_MISSING,
        ok: false,
        record,
      }));
      continue;
    }
    const inspected = inspectedByPath.get(record.file);
    if (
      inspected.identity.sha256 !== record.sha256
      || inspected.identity.byteLength === 0
    ) {
      states.set(record.id, Object.freeze({
        issueCode: AUTHORING_LOADER_ISSUE_CODES.MASK_IDENTITY_MISMATCH,
        ok: false,
        record,
      }));
      continue;
    }
    let raster;
    try {
      raster = await decodeCanonicalMask(inspected.bytes, { path: record.file });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        states.set(record.id, Object.freeze({
          issueCode: AUTHORING_LOADER_ISSUE_CODES.MASK_MEDIA_INVALID,
          ok: false,
          record,
        }));
        continue;
      }
      throw error;
    }
    if (
      raster.nonZeroPixelCount !== record.nonZeroPixelCount
      || raster.alphaSum !== record.alphaSum
      || !sameRect(raster.tightBounds, record.tightBounds)
    ) {
      states.set(record.id, Object.freeze({
        issueCode: AUTHORING_LOADER_ISSUE_CODES.MASK_METADATA_MISMATCH,
        ok: false,
        record,
      }));
      continue;
    }
    states.set(record.id, Object.freeze({
      bytes: Buffer.from(inspected.bytes),
      identity: inspected.identity,
      ok: true,
      raster,
      record,
    }));
  }
  return states;
}

async function loadFillStates(document, inspectedByPath, existingPaths) {
  const states = new Map();
  for (const reconstruction of document.reconstructions) {
    if (!existingPaths.has(reconstruction.fillFile)) {
      states.set(reconstruction.fillId, Object.freeze({
        issueCode: AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_MISSING,
        ok: false,
        reconstruction,
      }));
      continue;
    }
    const inspected = inspectedByPath.get(reconstruction.fillFile);
    if (inspected.identity.sha256 !== reconstruction.fillSha256) {
      states.set(reconstruction.fillId, Object.freeze({
        issueCode: AUTHORING_LOADER_ISSUE_CODES.FILL_IDENTITY_MISMATCH,
        ok: false,
        reconstruction,
      }));
      continue;
    }
    let raster;
    try {
      raster = await decodeCanonicalRgbaFill(inspected.bytes, {
        path: reconstruction.fillFile,
      });
    } catch (error) {
      if (error instanceof AuthoringLoaderError) {
        states.set(reconstruction.fillId, Object.freeze({
          issueCode: error.issueCode,
          ok: false,
          reconstruction,
        }));
        continue;
      }
      throw error;
    }
    states.set(reconstruction.fillId, Object.freeze({
      bytes: Buffer.from(inspected.bytes),
      identity: inspected.identity,
      ok: true,
      raster,
      reconstruction,
    }));
  }
  return states;
}

/**
 * Expose only explicitly supplied, successfully decoded authored files for
 * deterministic evidence rendering. These inputs do not imply approval: the
 * production evidence boundary evaluates reviewer decisions separately after the
 * canonical evidence index has been regenerated.
 */
function createReviewEvidenceInputs({
  approvalCatalog,
  document,
  fillStates,
  maskStates,
}) {
  const layers = document.layers.filter(({ segmentationMaskId }) => (
    maskStates.get(segmentationMaskId)?.ok === true
  ));
  const layerIds = new Set(layers.map(({ id }) => id));
  const reconstructions = document.reconstructions.filter((record) => (
    fillStates.get(record.fillId)?.ok === true
    && maskStates.get(record.regionMaskId)?.ok === true
    && maskStates.get(record.boundaryMaskId)?.ok === true
  ));
  const neededMaskIds = new Set(layers.map(({ segmentationMaskId }) => segmentationMaskId));
  for (const reconstruction of reconstructions) {
    neededMaskIds.add(reconstruction.regionMaskId);
    neededMaskIds.add(reconstruction.boundaryMaskId);
  }
  const masks = document.masks
    .filter(({ id }) => neededMaskIds.has(id) && maskStates.get(id)?.ok === true)
    .map((record) => Object.freeze({
      bytes: Buffer.from(maskStates.get(record.id).bytes),
      record,
    }));
  const reconstructionInputs = reconstructions.map((record) => Object.freeze({
    fillBytes: Buffer.from(fillStates.get(record.fillId).bytes),
    record,
  }));
  const motionProfiles = document.motionProfiles.filter(({ layerId }) => layerIds.has(layerId));
  const depthProfiles = document.depthProfiles.filter(({ layers: depthLayers }) => (
    depthLayers.some(({ layerId }) => layerIds.has(layerId))
  ));
  const approvals = [...approvalCatalog.byId.values()]
    .filter(({ valid }) => valid)
    .map(({ record }) => record)
    .sort((left, right) => lexicalCompare(left.id, right.id));

  return deepFreeze({
    approvals,
    depthProfiles,
    layers,
    masks,
    motionProfiles,
    reconstructions: reconstructionInputs,
  });
}

function createArtifactDescriptors(document, maskStates, fillStates) {
  const descriptors = new Map();
  const segmentationMaskIds = new Set(
    document.layers.map(({ segmentationMaskId }) => segmentationMaskId),
  );
  const reconstructionMaskIds = new Set(document.reconstructions.flatMap((record) => [
    record.regionMaskId,
    record.boundaryMaskId,
  ]));

  for (const record of document.masks) {
    const state = maskStates.get(record.id);
    if (!state?.ok) continue;
    const usedForSegmentation = segmentationMaskIds.has(record.id);
    const usedForReconstruction = reconstructionMaskIds.has(record.id);
    descriptors.set(record.id, Object.freeze({
      allowedClassifications: usedForSegmentation && usedForReconstruction
        ? ["source-derived", "synthetic"]
        : [usedForSegmentation ? "source-derived" : "synthetic"],
      hash: record.sha256,
      id: record.id,
      kind: "mask",
      requiredParents: usedForSegmentation ? [APPROVED_MASTER_IDENTITY.sha256] : [],
    }));
  }

  for (const reconstruction of document.reconstructions) {
    const state = fillStates.get(reconstruction.fillId);
    if (!state?.ok) continue;
    const requiredParents = [
      maskStates.get(reconstruction.regionMaskId)?.record?.sha256,
      maskStates.get(reconstruction.boundaryMaskId)?.record?.sha256,
    ].filter((value) => typeof value === "string");
    descriptors.set(reconstruction.fillId, Object.freeze({
      allowedClassifications: ["synthetic"],
      expectedMethod: reconstruction.method,
      hash: reconstruction.fillSha256,
      id: reconstruction.fillId,
      kind: "fill",
      requiredParents,
    }));
  }

  const layerHashes = new Map();
  for (const layer of document.layers) {
    const hash = canonicalRecordHash(LAYER_RECORD_SCHEMA, layer);
    layerHashes.set(layer.id, hash);
    const maskHash = maskStates.get(layer.segmentationMaskId)?.record?.sha256;
    descriptors.set(layer.id, Object.freeze({
      allowedClassifications: ["source-derived"],
      hash,
      id: layer.id,
      kind: "layer",
      requiredParents: typeof maskHash === "string" ? [maskHash] : [],
    }));
  }

  for (const motion of document.motionProfiles) {
    const hash = canonicalRecordHash(MOTION_PROFILE_SCHEMA, motion);
    const parent = layerHashes.get(motion.layerId);
    descriptors.set(motion.id, Object.freeze({
      allowedClassifications: ["synthetic"],
      hash,
      id: motion.id,
      kind: "motion",
      requiredParents: parent === undefined ? [] : [parent],
    }));
  }

  for (const relationship of document.relationships) {
    const hash = canonicalRecordHash(GEAR_RELATIONSHIP_SCHEMA, relationship);
    descriptors.set(relationship.id, Object.freeze({
      allowedClassifications: ["synthetic"],
      hash,
      id: relationship.id,
      kind: "relationship",
      requiredParents: [
        layerHashes.get(relationship.driverLayerId),
        layerHashes.get(relationship.drivenLayerId),
      ].filter((value) => value !== undefined),
    }));
  }

  for (const depth of document.depthProfiles) {
    const hash = canonicalRecordHash(DEPTH_PROFILE_SCHEMA, depth);
    descriptors.set(depth.id, Object.freeze({
      allowedClassifications: ["synthetic"],
      hash,
      id: depth.id,
      kind: "depth",
      requiredParents: depth.layers
        .map(({ layerId }) => layerHashes.get(layerId))
        .filter((value) => value !== undefined),
    }));
  }

  return { descriptors, layerHashes };
}

function validateProvenanceCatalog(document, descriptors, knownHashes) {
  const recordsByArtifactId = new Map();
  for (const record of document.provenance) {
    const records = recordsByArtifactId.get(record.artifactId) ?? [];
    records.push(record);
    recordsByArtifactId.set(record.artifactId, records);
  }

  const cycleHashes = new Set();
  const descriptorHashes = new Set([...descriptors.values()].map(({ hash }) => hash));
  const parentsByHash = new Map();
  for (const record of document.provenance) {
    if (!descriptorHashes.has(record.artifactSha256)) continue;
    const parents = parentsByHash.get(record.artifactSha256) ?? new Set();
    for (const parent of record.immediateParentSha256) {
      if (descriptorHashes.has(parent)) parents.add(parent);
    }
    parentsByHash.set(record.artifactSha256, parents);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (hash) => {
    if (visiting.has(hash)) {
      for (const current of visiting) cycleHashes.add(current);
      cycleHashes.add(hash);
      return;
    }
    if (visited.has(hash)) return;
    visiting.add(hash);
    for (const parent of parentsByHash.get(hash) ?? []) visit(parent);
    visiting.delete(hash);
    visited.add(hash);
  };
  for (const hash of descriptorHashes) visit(hash);

  const byId = new Map();
  for (const record of document.provenance) {
    const descriptor = descriptors.get(record.artifactId);
    const ambiguous = (recordsByArtifactId.get(record.artifactId)?.length ?? 0) !== 1;
    let valid = descriptor !== undefined && !ambiguous;
    if (valid) {
      valid = record.artifactSha256 === descriptor.hash
        && descriptor.allowedClassifications.includes(record.classification)
        && (descriptor.expectedMethod === undefined || descriptor.expectedMethod === record.method)
        && includesEvery(record.immediateParentSha256, descriptor.requiredParents)
        && record.immediateParentSha256.every((hash) => knownHashes.has(hash))
        && !record.immediateParentSha256.includes(record.artifactSha256)
        && !cycleHashes.has(record.artifactSha256);
    }
    if (valid) {
      valid = evaluateProvenanceClosure(record, {
        artifactId: descriptor.id,
        artifactSha256: descriptor.hash,
        immediateParentSha256: record.immediateParentSha256,
      }).ok;
    }
    byId.set(record.id, Object.freeze({
      artifactId: record.artifactId,
      ok: valid,
      record,
    }));
  }
  return Object.freeze({ byId, recordsByArtifactId });
}

function provenanceForArtifact(catalog, artifactId) {
  const records = catalog.recordsByArtifactId.get(artifactId) ?? [];
  if (records.length !== 1) return null;
  const state = catalog.byId.get(records[0].id);
  return state?.ok ? state : null;
}

function exactProvenanceReference(catalog, provenanceId, artifactId) {
  const state = catalog.byId.get(provenanceId);
  return state?.ok === true && state.artifactId === artifactId;
}

function checkApproval({
  approvalCatalog,
  approvalId,
  requiredHashes,
  requiredLayerIds,
  reviewApprovalEvidence,
  reviewSetId,
  scope,
}) {
  if (approvalId === null || approvalId === undefined) {
    return Object.freeze({ ok: false, reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ABSENT });
  }
  if (approvalCatalog.duplicateIds.has(approvalId)) {
    return Object.freeze({ ok: false, reason: AUTHORING_LOADER_ISSUE_CODES.APPROVAL_AMBIGUOUS });
  }
  const entry = approvalCatalog.byId.get(approvalId);
  if (entry === undefined) {
    return Object.freeze({ ok: false, reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ABSENT });
  }
  if (!entry.valid) {
    return Object.freeze({ ok: false, reason: entry.validationReason });
  }
  const record = entry.record;
  const exactHashes = [...new Set(requiredHashes)].sort(lexicalCompare);
  const exactLayerIds = [...new Set(requiredLayerIds)].sort(lexicalCompare);
  let expectation;
  if (reviewApprovalEvidence.hasIndex && reviewSetId !== undefined) {
    const reviewSet = reviewApprovalEvidence.reviewSets.find(({ id }) => id === reviewSetId);
    if (reviewSet === undefined) {
      return Object.freeze({
        ok: false,
        reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
      });
    }
    try {
      expectation = createReviewSetApprovalExpectation({
        approvalId,
        evidenceIndexSha256: reviewApprovalEvidence.indexIdentity.sha256,
        reviewSet,
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        reason: error && typeof error === "object" && "issueCode" in error
          ? error.issueCode
          : APPROVAL_TOOL_ISSUE_CODES.APPROVAL_RECORD_INVALID,
      });
    }
    if (expectation.scope !== scope) {
      return Object.freeze({
        ok: false,
        reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_SCOPE_MISMATCH,
      });
    }
    if (!setEqual(expectation.layerIds, exactLayerIds)) {
      return Object.freeze({
        ok: false,
        reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_LAYER_MISMATCH,
      });
    }
    if (!includesEvery(expectation.artifactSha256, exactHashes)) {
      return Object.freeze({
        ok: false,
        reason: APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
      });
    }
  } else {
    expectation = {
      approvalId,
      artifactSha256: exactHashes,
      layerIds: exactLayerIds,
      reviewedPoseIds: record.reviewedPoseIds,
      reviewedZoomPercent: record.reviewedZoomPercent,
      scope,
    };
  }

  let closure;
  try {
    closure = evaluateApprovalClosure(record, expectation);
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error && typeof error === "object" && "issueCode" in error
        ? error.issueCode
        : APPROVAL_TOOL_ISSUE_CODES.APPROVAL_RECORD_INVALID,
    });
  }
  return Object.freeze({ ...closure, expectation, record });
}

function approvalIdsForScope(layer, scope, approvalCatalog) {
  return layer.approvalIds.filter((id) => {
    const entry = approvalCatalog.byId.get(id);
    return entry?.record?.scope === scope;
  });
}

function addApprovalReason(reasons, result, missingCode, notClosedCode) {
  addUnique(
    reasons,
    result.reason === APPROVAL_TOOL_ISSUE_CODES.APPROVAL_ABSENT
      ? missingCode
      : notClosedCode,
  );
}

function createDecision(id, authoredDisposition, reasons) {
  return Object.freeze({
    authoredDisposition,
    effectiveDisposition: reasons.length === 0 ? "approved-moving" : "static",
    id,
    primaryReason: reasons[0] ?? null,
    reasonCodes: Object.freeze([...reasons]),
  });
}

function evaluateBaseLayer(layer, maskStates, provenanceCatalog) {
  const reasons = [];
  const maskState = maskStates.get(layer.segmentationMaskId);
  if (maskState === undefined || maskState.issueCode === AUTHORING_STATIC_REASON_CODES.MASK_FILE_MISSING) {
    addUnique(reasons, AUTHORING_STATIC_REASON_CODES.MASK_FILE_MISSING);
    return { maskState, reasons };
  }
  if (!maskState.ok) {
    addUnique(reasons, AUTHORING_STATIC_REASON_CODES.MASK_INVALID);
    return { maskState, reasons };
  }
  if (!exactProvenanceReference(
    provenanceCatalog,
    maskState.record.provenanceId,
    maskState.record.id,
  )) {
    addUnique(reasons, AUTHORING_STATIC_REASON_CODES.MASK_PROVENANCE_INVALID);
  }
  if (
    layer.sourceVisiblePixelCount !== maskState.raster.nonZeroPixelCount
    || !sourceRectMatchesMask(layer.sourceRect, maskState.raster.tightBounds)
  ) {
    addUnique(reasons, AUTHORING_STATIC_REASON_CODES.SEGMENTATION_GEOMETRY_INVALID);
  }
  const ownProvenance = provenanceForArtifact(provenanceCatalog, layer.id);
  if (
    ownProvenance === null
    || !layer.provenanceIds.includes(ownProvenance.record.id)
    || layer.provenanceIds.some((id) => provenanceCatalog.byId.get(id)?.ok !== true)
  ) {
    addUnique(reasons, AUTHORING_STATIC_REASON_CODES.LAYER_PROVENANCE_INVALID);
  }
  return { maskState, reasons };
}

function associatedReconstructions(layer, document, approvalCatalog) {
  return document.reconstructions.filter((reconstruction) => {
    if (layer.approvalIds.includes(reconstruction.approvalId)) return true;
    const approval = approvalCatalog.byId.get(reconstruction.approvalId)?.record;
    return approval?.layerIds?.includes(layer.id) === true;
  });
}

function validateLayerReconstructions({
  approvalCatalog,
  document,
  fillStates,
  layer,
  maskStates,
  provenanceCatalog,
  reviewApprovalEvidence,
  segmentationMask,
}) {
  const reasons = [];
  const approvedRecords = [];
  const usedApprovalIds = [];
  const requiredHashes = [];
  const records = associatedReconstructions(layer, document, approvalCatalog);
  if (records.length === 0) {
    addUnique(reasons, AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_MISSING);
    return { approvedRecords, reasons, requiredHashes, usedApprovalIds };
  }

  const validRegionMasks = [];
  for (const record of records) {
    const regionState = maskStates.get(record.regionMaskId);
    const boundaryState = maskStates.get(record.boundaryMaskId);
    const fillState = fillStates.get(record.fillId);
    if (!regionState?.ok || !boundaryState?.ok || !fillState?.ok) {
      addUnique(reasons, AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_INVALID);
      continue;
    }
    if (
      !exactProvenanceReference(provenanceCatalog, regionState.record.provenanceId, regionState.record.id)
      || !exactProvenanceReference(provenanceCatalog, boundaryState.record.provenanceId, boundaryState.record.id)
      || !exactProvenanceReference(provenanceCatalog, record.provenanceId, record.fillId)
    ) {
      addUnique(reasons, AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_INVALID);
      continue;
    }
    try {
      validateReconstructionRasterGeometry({
        boundaryMask: boundaryState.raster,
        fill: fillState.raster,
        regionMask: regionState.raster,
        segmentationMask,
        syntheticPixelCount: record.syntheticPixelCount,
      });
    } catch (error) {
      if (error instanceof AuthoringLoaderError) {
        addUnique(reasons, AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_INVALID);
        continue;
      }
      throw error;
    }
    const hashes = [
      record.fillSha256,
      regionState.record.sha256,
      boundaryState.record.sha256,
    ];
    const approval = checkApproval({
      approvalCatalog,
      approvalId: record.approvalId,
      requiredHashes: hashes,
      requiredLayerIds: [layer.id],
      reviewApprovalEvidence,
      reviewSetId: `${layer.id}-reconstruction`,
      scope: "reconstruction",
    });
    if (!approval.ok) {
      addApprovalReason(
        reasons,
        approval,
        AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_APPROVAL_MISSING,
        AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_APPROVAL_NOT_CLOSED,
      );
      continue;
    }
    approvedRecords.push(record);
    usedApprovalIds.push(record.approvalId);
    requiredHashes.push(...approval.record.artifactSha256);
    validRegionMasks.push(regionState.raster);
  }

  if (reasons.length === 0) {
    const union = unionMasks(validRegionMasks);
    if (union.nonZeroPixelCount !== layer.reconstructedPixelCount) {
      addUnique(reasons, AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_INVALID);
    }
  }
  return { approvedRecords, reasons, requiredHashes, usedApprovalIds };
}

function releaseApprovalCandidates(approvalCatalog) {
  return [...approvalCatalog.byId.values()]
    .filter(({ record, valid }) => valid && record.scope === "release")
    .sort((left, right) => lexicalCompare(left.record.id, right.record.id));
}

function normalizeLoadedPackage({
  approvalCatalog,
  authoringIdentity,
  document,
  evidenceHashes,
  fillStates,
  inputSnapshot,
  maskStates,
  reviewApprovalEvidence,
}) {
  const { descriptors } = createArtifactDescriptors(
    document,
    maskStates,
    fillStates,
  );
  const knownHashes = new Set([
    APPROVED_MASTER_IDENTITY.sha256,
    PREDECESSOR_MANIFEST_IDENTITY.sha256,
    authoringIdentity.sha256,
    ...evidenceHashes,
    ...[...descriptors.values()].map(({ hash }) => hash),
  ]);
  const provenanceCatalog = validateProvenanceCatalog(
    document,
    descriptors,
    knownHashes,
  );
  const pivotHashes = new Map();
  for (const layer of document.layers) {
    if (layer.pivot !== undefined) {
      const hash = pivotProjectionHash(layer);
      pivotHashes.set(layer.id, hash);
    }
  }

  const decisions = document.candidateInventory.map((candidate) => createDecision(
    candidate.id,
    candidate.disposition,
    [AUTHORING_STATIC_REASON_CODES.PROPOSED_STATIC],
  ));
  const acceptedStaticLayers = [];
  const preliminaryMoving = [];
  const layerContexts = new Map();
  const usedApprovalIds = new Set();
  const usedReconstructionIds = new Set();
  const usedMotionIds = new Set();

  for (const layer of document.layers) {
    const base = evaluateBaseLayer(layer, maskStates, provenanceCatalog);
    if (layer.disposition === "static") {
      const reasons = [...base.reasons];
      const staticApprovalIds = [];
      if (reasons.length === 0 && reviewApprovalEvidence.hasIndex) {
        const segmentationApprovalIds = approvalIdsForScope(
          layer,
          "segmentation",
          approvalCatalog,
        );
        const segmentationApproval = checkApproval({
          approvalCatalog,
          approvalId: segmentationApprovalIds.length === 1
            ? segmentationApprovalIds[0]
            : null,
          requiredHashes: [base.maskState.record.sha256],
          requiredLayerIds: [layer.id],
          reviewApprovalEvidence,
          reviewSetId: `${layer.id}-segmentation`,
          scope: "segmentation",
        });
        if (segmentationApprovalIds.length !== 1 || !segmentationApproval.ok) {
          addApprovalReason(
            reasons,
            segmentationApproval,
            AUTHORING_STATIC_REASON_CODES.SEGMENTATION_APPROVAL_MISSING,
            AUTHORING_STATIC_REASON_CODES.SEGMENTATION_APPROVAL_NOT_CLOSED,
          );
        } else {
          staticApprovalIds.push(segmentationApprovalIds[0]);
        }

        const fidelityApprovalIds = approvalIdsForScope(
          layer,
          "fidelity",
          approvalCatalog,
        );
        const fidelityApproval = checkApproval({
          approvalCatalog,
          approvalId: fidelityApprovalIds.length === 1 ? fidelityApprovalIds[0] : null,
          requiredHashes: [],
          requiredLayerIds: [layer.id],
          reviewApprovalEvidence,
          reviewSetId: `${layer.id}-fidelity`,
          scope: "fidelity",
        });
        if (fidelityApprovalIds.length !== 1 || !fidelityApproval.ok) {
          addApprovalReason(
            reasons,
            fidelityApproval,
            AUTHORING_STATIC_REASON_CODES.FIDELITY_APPROVAL_MISSING,
            AUTHORING_STATIC_REASON_CODES.FIDELITY_APPROVAL_NOT_CLOSED,
          );
        } else {
          staticApprovalIds.push(fidelityApprovalIds[0]);
        }
      }
      if (reasons.length === 0) {
        acceptedStaticLayers.push(layer);
        staticApprovalIds.forEach((id) => usedApprovalIds.add(id));
      }
      decisions.push(createDecision(
        layer.id,
        layer.disposition,
        reasons.length === 0
          ? [AUTHORING_STATIC_REASON_CODES.AUTHORED_STATIC]
          : reasons,
      ));
      continue;
    }
    if (layer.disposition !== "approved-moving") {
      decisions.push(createDecision(
        layer.id,
        layer.disposition,
        base.reasons.length === 0
          ? [AUTHORING_STATIC_REASON_CODES.NOT_AUTHORED_APPROVED]
          : base.reasons,
      ));
      continue;
    }

    const reasons = [...base.reasons];
    const context = {
      layer,
      motion: null,
      reconstructions: [],
      requiredHashes: new Set(),
      usedApprovalIds: new Set(),
    };
    if (base.maskState?.ok) context.requiredHashes.add(base.maskState.record.sha256);
    if (reasons.length === 0) {
      const segmentationApprovalIds = approvalIdsForScope(
        layer,
        "segmentation",
        approvalCatalog,
      );
      const segmentationApproval = checkApproval({
        approvalCatalog,
        approvalId: segmentationApprovalIds.length === 1
          ? segmentationApprovalIds[0]
          : null,
        requiredHashes: [base.maskState.record.sha256],
        requiredLayerIds: [layer.id],
        reviewApprovalEvidence,
        reviewSetId: `${layer.id}-segmentation`,
        scope: "segmentation",
      });
      if (segmentationApprovalIds.length !== 1 || !segmentationApproval.ok) {
        addApprovalReason(
          reasons,
          segmentationApproval,
          AUTHORING_STATIC_REASON_CODES.SEGMENTATION_APPROVAL_MISSING,
          AUTHORING_STATIC_REASON_CODES.SEGMENTATION_APPROVAL_NOT_CLOSED,
        );
      } else {
        context.usedApprovalIds.add(segmentationApprovalIds[0]);
        segmentationApproval.record.artifactSha256.forEach((hash) => (
          context.requiredHashes.add(hash)
        ));
      }

      if (layer.pivot === undefined || !MOTION_CLASS_SET.has(layer.semanticClass)) {
        addUnique(reasons, AUTHORING_STATIC_REASON_CODES.PIVOT_INVALID);
      } else {
        const pivotApprovalIds = approvalIdsForScope(layer, "pivot", approvalCatalog);
        const pivotHash = pivotHashes.get(layer.id);
        context.requiredHashes.add(pivotHash);
        const pivotApproval = checkApproval({
          approvalCatalog,
          approvalId: pivotApprovalIds.length === 1 ? pivotApprovalIds[0] : null,
          requiredHashes: [pivotHash],
          requiredLayerIds: [layer.id],
          reviewApprovalEvidence,
          reviewSetId: `${layer.id}-pivot`,
          scope: "pivot",
        });
        if (pivotApprovalIds.length !== 1 || !pivotApproval.ok) {
          addApprovalReason(
            reasons,
            pivotApproval,
            AUTHORING_STATIC_REASON_CODES.PIVOT_APPROVAL_MISSING,
            AUTHORING_STATIC_REASON_CODES.PIVOT_APPROVAL_NOT_CLOSED,
          );
        } else {
          context.usedApprovalIds.add(pivotApprovalIds[0]);
          pivotApproval.record.artifactSha256.forEach((hash) => (
            context.requiredHashes.add(hash)
          ));
        }
      }

      const reconstruction = validateLayerReconstructions({
        approvalCatalog,
        document,
        fillStates,
        layer,
        maskStates,
        provenanceCatalog,
        reviewApprovalEvidence,
        segmentationMask: base.maskState.raster,
      });
      reconstruction.reasons.forEach((reason) => addUnique(reasons, reason));
      reconstruction.requiredHashes.forEach((hash) => context.requiredHashes.add(hash));
      reconstruction.usedApprovalIds.forEach((id) => context.usedApprovalIds.add(id));
      context.reconstructions = reconstruction.approvedRecords;

      const motion = document.motionProfiles.find(({ id }) => id === layer.motionProfileId);
      if (
        motion === undefined
        || motion.layerId !== layer.id
        || !samePoint(motion.pivot, layer.pivot)
        || provenanceForArtifact(provenanceCatalog, motion.id) === null
      ) {
        addUnique(reasons, AUTHORING_STATIC_REASON_CODES.MOTION_PROFILE_INVALID);
      } else {
        const motionHash = descriptors.get(motion.id).hash;
        context.requiredHashes.add(motionHash);
        const motionApproval = checkApproval({
          approvalCatalog,
          approvalId: motion.approvalId,
          requiredHashes: [motionHash],
          requiredLayerIds: [layer.id],
          reviewApprovalEvidence,
          reviewSetId: `${layer.id}-${motion.id}-motion`,
          scope: "motion",
        });
        if (!motionApproval.ok) {
          addApprovalReason(
            reasons,
            motionApproval,
            AUTHORING_STATIC_REASON_CODES.MOTION_APPROVAL_MISSING,
            AUTHORING_STATIC_REASON_CODES.MOTION_APPROVAL_NOT_CLOSED,
          );
        } else {
          context.motion = motion;
          context.usedApprovalIds.add(motion.approvalId);
          motionApproval.record.artifactSha256.forEach((hash) => (
            context.requiredHashes.add(hash)
          ));
        }
      }

      if (reviewApprovalEvidence.hasIndex) {
        const fidelityApprovalIds = approvalIdsForScope(
          layer,
          "fidelity",
          approvalCatalog,
        );
        const fidelityApproval = checkApproval({
          approvalCatalog,
          approvalId: fidelityApprovalIds.length === 1 ? fidelityApprovalIds[0] : null,
          requiredHashes: [],
          requiredLayerIds: [layer.id],
          reviewApprovalEvidence,
          reviewSetId: `${layer.id}-fidelity`,
          scope: "fidelity",
        });
        if (fidelityApprovalIds.length !== 1 || !fidelityApproval.ok) {
          addApprovalReason(
            reasons,
            fidelityApproval,
            AUTHORING_STATIC_REASON_CODES.FIDELITY_APPROVAL_MISSING,
            AUTHORING_STATIC_REASON_CODES.FIDELITY_APPROVAL_NOT_CLOSED,
          );
        } else {
          context.usedApprovalIds.add(fidelityApprovalIds[0]);
          fidelityApproval.record.artifactSha256.forEach((hash) => (
            context.requiredHashes.add(hash)
          ));
        }
      }
    }

    if (reasons.length === 0) {
      preliminaryMoving.push(layer);
      layerContexts.set(layer.id, context);
    } else {
      decisions.push(createDecision(layer.id, layer.disposition, reasons));
    }
  }

  let releaseApproval = null;
  if (preliminaryMoving.length !== 0) {
    const preliminaryIds = preliminaryMoving.map(({ id }) => id).sort(lexicalCompare);
    const requiredHashes = [...new Set(preliminaryMoving.flatMap(({ id }) => (
      [...layerContexts.get(id).requiredHashes]
    )))].sort(lexicalCompare);
    const passingReleaseApprovals = releaseApprovalCandidates(approvalCatalog)
      .map((entry) => ({
        entry,
        result: checkApproval({
          approvalCatalog,
          approvalId: entry.record.id,
          requiredHashes,
          requiredLayerIds: preliminaryIds,
          reviewApprovalEvidence,
          scope: "release",
        }),
      }))
      .filter(({ result }) => result.ok);
    if (passingReleaseApprovals.length === 1) {
      releaseApproval = passingReleaseApprovals[0].entry.record;
    } else {
      const reason = releaseApprovalCandidates(approvalCatalog).length === 0
        ? AUTHORING_STATIC_REASON_CODES.RELEASE_APPROVAL_MISSING
        : passingReleaseApprovals.length > 1
          ? AUTHORING_STATIC_REASON_CODES.RELEASE_APPROVAL_AMBIGUOUS
          : AUTHORING_STATIC_REASON_CODES.RELEASE_APPROVAL_NOT_CLOSED;
      for (const layer of preliminaryMoving) {
        decisions.push(createDecision(layer.id, layer.disposition, [reason]));
      }
    }
  }

  const approvedMovingLayers = releaseApproval === null ? [] : preliminaryMoving;
  if (releaseApproval !== null) usedApprovalIds.add(releaseApproval.id);
  for (const layer of approvedMovingLayers) {
    const context = layerContexts.get(layer.id);
    context.usedApprovalIds.forEach((id) => usedApprovalIds.add(id));
    context.reconstructions.forEach(({ id }) => usedReconstructionIds.add(id));
    if (context.motion !== null) usedMotionIds.add(context.motion.id);
    decisions.push(createDecision(layer.id, layer.disposition, []));
  }

  const approvedMovingIds = new Set(approvedMovingLayers.map(({ id }) => id));
  const normalizedRelationships = [];
  for (const relationship of document.relationships) {
    if (
      !approvedMovingIds.has(relationship.driverLayerId)
      || !approvedMovingIds.has(relationship.drivenLayerId)
      || provenanceForArtifact(provenanceCatalog, relationship.id) === null
    ) continue;
    const relationshipHash = descriptors.get(relationship.id).hash;
    const approval = checkApproval({
      approvalCatalog,
      approvalId: relationship.approvalId,
      requiredHashes: [relationshipHash],
      requiredLayerIds: [relationship.driverLayerId, relationship.drivenLayerId],
      reviewApprovalEvidence,
      scope: "motion",
    });
    if (!approval.ok) continue;
    normalizedRelationships.push(relationship);
    usedApprovalIds.add(relationship.approvalId);
  }

  const normalizedLayers = [
    ...acceptedStaticLayers,
    ...approvedMovingLayers,
  ].sort((left, right) => left.zOrder - right.zOrder || lexicalCompare(left.id, right.id));
  const neededMaskIds = new Set(normalizedLayers.map(({ segmentationMaskId }) => segmentationMaskId));
  for (const reconstruction of document.reconstructions) {
    if (!usedReconstructionIds.has(reconstruction.id)) continue;
    neededMaskIds.add(reconstruction.regionMaskId);
    neededMaskIds.add(reconstruction.boundaryMaskId);
  }
  const normalizedMasks = document.masks.filter(({ id }) => (
    neededMaskIds.has(id) && maskStates.get(id)?.ok
  ));
  const normalizedReconstructions = document.reconstructions.filter(({ id }) => (
    usedReconstructionIds.has(id)
  ));
  const normalizedMotionProfiles = document.motionProfiles.filter(({ id }) => (
    usedMotionIds.has(id)
  ));
  const neededArtifactIds = new Set([
    ...normalizedMasks.map(({ id }) => id),
    ...normalizedLayers.map(({ id }) => id),
    ...normalizedReconstructions.map(({ fillId }) => fillId),
    ...normalizedMotionProfiles.map(({ id }) => id),
    ...normalizedRelationships.map(({ id }) => id),
  ]);
  const normalizedProvenance = document.provenance.filter((record) => (
    neededArtifactIds.has(record.artifactId)
    && provenanceCatalog.byId.get(record.id)?.ok === true
  ));
  const normalizedApprovals = [...usedApprovalIds]
    .sort(lexicalCompare)
    .map((id) => approvalCatalog.byId.get(id)?.record)
    .filter((record) => record !== undefined);
  const maskInputs = normalizedMasks.map((record) => {
    const state = maskStates.get(record.id);
    return Object.freeze({ identity: state.identity, raster: state.raster, record });
  });
  const fillInputs = normalizedReconstructions.map((record) => {
    const state = fillStates.get(record.fillId);
    return Object.freeze({ identity: state.identity, raster: state.raster, record });
  });
  const artifactIssues = [
    ...[...maskStates.values()]
      .filter(({ ok }) => !ok)
      .map((state) => stableIssue(state.record.id, state.issueCode, state.record.file)),
    ...[...fillStates.values()]
      .filter(({ ok }) => !ok)
      .map((state) => stableIssue(
        state.reconstruction.fillId,
        state.issueCode,
        state.reconstruction.fillFile,
      )),
    ...document.provenance
      .filter((record) => provenanceCatalog.byId.get(record.id)?.ok !== true)
      .map((record) => stableIssue(
        record.artifactId,
        AUTHORING_LOADER_ISSUE_CODES.PROVENANCE_INVALID,
        `$.provenance.${record.id}`,
      )),
  ].sort((left, right) => (
    lexicalCompare(left.artifactId, right.artifactId)
    || lexicalCompare(left.code, right.code)
  ));
  const orderedDecisions = decisions.sort((left, right) => lexicalCompare(left.id, right.id));
  const staticLayerIds = orderedDecisions
    .filter(({ effectiveDisposition }) => effectiveDisposition === "static")
    .map(({ id }) => id);
  const normalizedLayerIds = new Set(normalizedLayers.map(({ id }) => id));

  return deepFreeze({
    approvedMovingLayerIds: approvedMovingLayers.map(({ id }) => id).sort(lexicalCompare),
    artifactIssues,
    authoringIdentity,
    candidateDecisions: orderedDecisions,
    excludedLayerIds: document.layers
      .map(({ id }) => id)
      .filter((id) => !normalizedLayerIds.has(id))
      .sort(lexicalCompare),
    inputSnapshot,
    mode: approvedMovingLayers.length === 0 ? "reference-pose" : "approved-moving",
    normalized: {
      approvals: normalizedApprovals,
      fillInputs,
      layers: normalizedLayers,
      maskInputs,
      masks: normalizedMasks,
      motionProfiles: normalizedMotionProfiles,
      provenance: normalizedProvenance,
      reconstructions: normalizedReconstructions,
      relationships: normalizedRelationships,
    },
    schemaVersion: 1,
    sourceDocument: document,
    staticLayerIds,
  });
}

/**
 * Load reviewer-authored package inputs without writing, requesting a network
 * resource, manufacturing an artifact, or treating a pending decision as approval.
 */
export async function loadWatchLayerAuthoring({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail(
      AUTHORING_LOADER_ISSUE_CODES.ARGUMENT_INVALID,
      "projectRoot must be a nonempty path",
      "$.projectRoot",
    );
  }
  const root = resolve(projectRoot);
  return withAuthoringLoaderNetworkDisabled(async () => {
    const preliminaryAuthoring = await inspectSafeRegularFile(
      CANONICAL_PROJECT_PATHS.successorAuthoring,
      {
        allowPublic: false,
        allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
        expectedPath: CANONICAL_PROJECT_PATHS.successorAuthoring,
        projectRoot: root,
      },
    );
    if (preliminaryAuthoring.identity.byteLength > AUTHORING_LOADER_LIMITS.maxAuthoringBytes) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.LIMIT_EXCEEDED,
        "Authoring document exceeds its finite byte limit",
        CANONICAL_PROJECT_PATHS.successorAuthoring,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      );
    }
    let preliminaryDocument;
    try {
      preliminaryDocument = AUTHORING_DOCUMENT_SCHEMA.parseJson(
        preliminaryAuthoring.bytes,
        { allowTrailingNewline: true, requireCanonical: true },
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;
      fail(
        AUTHORING_LOADER_ISSUE_CODES.AUTHORING_INVALID,
        "Authoring document cannot be parsed by the strict canonical schema",
        CANONICAL_PROJECT_PATHS.successorAuthoring,
      );
    }
    validatePackageLimits(preliminaryDocument);

    const approvalPaths = await collectRegularFiles(
      root,
      CANONICAL_PROJECT_PATHS.successorApprovalsDirectory,
      {
        directJson: true,
        limit: AUTHORING_LOADER_LIMITS.maxApprovalFiles,
        optional: true,
        recursive: false,
      },
    );
    const hasApprovals = preliminaryDocument.approvals.length !== 0
      || approvalPaths.length !== 0;
    const evidencePaths = hasApprovals
      ? await collectRegularFiles(
        root,
        CANONICAL_PROJECT_PATHS.successorReviewDirectory,
        {
          limit: AUTHORING_LOADER_LIMITS.maxEvidenceFiles,
          optional: true,
          recursive: true,
        },
      )
      : [];
    const preliminaryReviewEvidence = evidencePaths.includes(LAYER_REVIEW_EVIDENCE_INDEX_PATH)
      ? await inspectLayerReviewEvidenceIndex(root)
      : null;
    const indexedInputPaths = preliminaryReviewEvidence === null
      ? []
      : preliminaryReviewEvidence.index.reviewSets.flatMap(({ inputFiles }) => (
          inputFiles.map(({ path }) => path)
        ));
    const declaredPaths = [
      ...preliminaryDocument.masks.map(({ file }) => file),
      ...preliminaryDocument.reconstructions.map(({ fillFile }) => fillFile),
    ];
    const existingDeclaredPaths = [];
    for (const path of [...new Set(declaredPaths)].sort(lexicalCompare)) {
      if (await pathExistsForSnapshot(root, path)) existingDeclaredPaths.push(path);
    }
    const inputPaths = [...new Set([
      CANONICAL_PROJECT_PATHS.successorAuthoring,
      ...approvalPaths,
      ...evidencePaths,
      ...indexedInputPaths,
      ...existingDeclaredPaths,
    ])].sort(lexicalCompare);
    const inputSnapshot = await createInputHashSnapshot(inputPaths, {
      allowPublic: false,
      projectRoot: root,
    });
    const snapshotByPath = new Map(inputSnapshot.files.map((identity) => [
      identity.path,
      identity,
    ]));
    const snappedAuthoring = snapshotByPath.get(CANONICAL_PROJECT_PATHS.successorAuthoring);
    if (
      snappedAuthoring?.sha256 !== preliminaryAuthoring.identity.sha256
      || snappedAuthoring?.byteLength !== preliminaryAuthoring.identity.byteLength
    ) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.INPUT_CHANGED,
        "Authoring bytes changed during input discovery",
        CANONICAL_PROJECT_PATHS.successorAuthoring,
        LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
      );
    }
    const evidenceTotalBytes = evidencePaths.reduce((total, path) => (
      total + (snapshotByPath.get(path)?.byteLength ?? 0)
    ), 0);
    if (evidenceTotalBytes > AUTHORING_LOADER_LIMITS.maxEvidenceTotalBytes) {
      fail(
        AUTHORING_LOADER_ISSUE_CODES.LIMIT_EXCEEDED,
        "Review evidence exceeds the finite total-byte limit",
        CANONICAL_PROJECT_PATHS.successorReviewDirectory,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
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
    const document = AUTHORING_DOCUMENT_SCHEMA.parseJson(authoring.bytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
    let reviewApprovalEvidence = deepFreeze({
      hasIndex: false,
      indexIdentity: null,
      reviewSets: [],
    });
    if (preliminaryReviewEvidence !== null) {
      const currentReviewEvidence = await inspectLayerReviewEvidenceIndex(root);
      const snappedIndex = snapshotByPath.get(LAYER_REVIEW_EVIDENCE_INDEX_PATH);
      if (
        !sameFileIdentity(currentReviewEvidence.identity, snappedIndex)
        || !sameFileIdentity(currentReviewEvidence.identity, preliminaryReviewEvidence.identity)
      ) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.INPUT_CHANGED,
          "Layer review evidence index changed during input discovery",
          LAYER_REVIEW_EVIDENCE_INDEX_PATH,
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }
      reviewApprovalEvidence = createCurrentReviewApprovalEvidence({
        authoringIdentity: authoring.identity,
        index: currentReviewEvidence.index,
        indexIdentity: currentReviewEvidence.identity,
        snapshotByPath,
      });
    }
    const externalApprovals = await parseExternalApprovalFiles(
      approvalPaths,
      root,
      snapshotByPath,
    );
    const approvalCatalog = createApprovalCatalog(document.approvals, externalApprovals);

    const existingPathSet = new Set(existingDeclaredPaths);
    const inspectedByPath = new Map();
    for (const path of existingDeclaredPaths) {
      const inspected = await inspectSafeRegularFile(path, {
        allowPublic: false,
        allowedRoots: [CANONICAL_PROJECT_PATHS.successorSourceDirectory],
        projectRoot: root,
      });
      const snapshotIdentity = snapshotByPath.get(path);
      if (
        snapshotIdentity === undefined
        || snapshotIdentity.sha256 !== inspected.identity.sha256
        || snapshotIdentity.byteLength !== inspected.identity.byteLength
      ) {
        fail(
          AUTHORING_LOADER_ISSUE_CODES.INPUT_CHANGED,
          "Authored artifact changed after the input snapshot",
          path,
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }
      inspectedByPath.set(path, inspected);
    }

    const maskStates = await loadMaskStates(document, inspectedByPath, existingPathSet);
    const fillStates = await loadFillStates(document, inspectedByPath, existingPathSet);
    const evidenceHashes = evidencePaths.map((path) => snapshotByPath.get(path).sha256);
    const reviewInputs = createReviewEvidenceInputs({
      approvalCatalog,
      document,
      fillStates,
      maskStates,
    });
    const normalized = normalizeLoadedPackage({
      approvalCatalog,
      authoringIdentity: authoring.identity,
      document,
      evidenceHashes,
      fillStates,
      inputSnapshot,
      maskStates,
      reviewApprovalEvidence,
    });
    await assertInputHashSnapshotUnchanged(inputSnapshot, {
      allowPublic: false,
      projectRoot: root,
    });
    return deepFreeze({ ...normalized, reviewApprovalEvidence, reviewInputs });
  });
}

export const loadAuthoredWatchPackage = loadWatchLayerAuthoring;
export const loadAuthoringPackage = loadWatchLayerAuthoring;
export const loadAuthoredLayerInputs = loadWatchLayerAuthoring;
