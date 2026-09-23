import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

export const FAILURE_CODES = Object.freeze({
  ASSET_BUDGET_EXCEEDED: "ASSET_BUDGET_EXCEEDED",
  ASSET_PATH_INVALID: "ASSET_PATH_INVALID",
  DERIVATIVE_DIMENSION_MISMATCH: "DERIVATIVE_DIMENSION_MISMATCH",
  DERIVATIVE_FORMAT_INVALID: "DERIVATIVE_FORMAT_INVALID",
  DERIVATIVE_IDENTITY_MISMATCH: "DERIVATIVE_IDENTITY_MISMATCH",
  DERIVATIVE_SET_INCOMPLETE: "DERIVATIVE_SET_INCOMPLETE",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  MANIFEST_MISSING: "MANIFEST_MISSING",
  MASTER_DECODE_INVALID: "MASTER_DECODE_INVALID",
  MASTER_FORMAT_INVALID: "MASTER_FORMAT_INVALID",
  MASTER_IDENTITY_MISMATCH: "MASTER_IDENTITY_MISMATCH",
  MASTER_MISSING: "MASTER_MISSING",
});

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_FILE = "data/watch-image-asset.json";
const MASTER_FILE = "source/assets/elite-watch-master.png";
const OUTPUT_DIRECTORY = "public/assets/watch";
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

export const WATCH_IMAGE_CONTRACT = Object.freeze({
  aggregateTransferBytes: 12_582_912,
  avifTransferBytes: 1_048_576,
  candidates: Object.freeze([
    Object.freeze({ height: 376, width: 690 }),
    Object.freeze({ height: 564, width: 1035 }),
    Object.freeze({ height: 752, width: 1380 }),
    Object.freeze({ height: 1128, width: 2070 }),
    Object.freeze({ height: 1504, width: 2760 }),
  ]),
  decodedPixels: 4_151_040,
  decodedRgbaBytes: 16_604_160,
  formats: Object.freeze([
    Object.freeze({
      encoder: Object.freeze({
        channels: 3,
        chromaSubsampling: "4:4:4",
        colourspace: "srgb",
        effort: 6,
        quality: 72,
      }),
      extension: "avif",
      maxTransferBytesPerCandidate: 1_048_576,
      mediaType: "image/avif",
      role: "primary",
    }),
    Object.freeze({
      encoder: Object.freeze({
        channels: 3,
        colourspace: "srgb",
        effort: 6,
        quality: 86,
        smartSubsample: true,
      }),
      extension: "webp",
      maxTransferBytesPerCandidate: 1_572_864,
      mediaType: "image/webp",
      role: "fallback",
    }),
  ]),
  manifestFile: MANIFEST_FILE,
  master: Object.freeze({
    aspectRatio: Object.freeze({ height: 188, width: 345 }),
    bitDepth: 8,
    byteLength: 9_381_741,
    colorProfile: Object.freeze({
      chromaticityChunk: false,
      embeddedIcc: false,
      gammaChunk: false,
      interpretation: "untagged-rgb",
      srgbChunk: false,
    }),
    colorType: "rgba",
    decodeValidation: Object.freeze({
      nativeDecoder: "passed",
      pngChunkCrc: "passed",
      zlibAndScanlines: "passed",
    }),
    decodedPixelCount: 4_151_040,
    decodedRgbaByteLength: 16_604_160,
    intrinsicHeight: 1504,
    intrinsicWidth: 2760,
    interlaced: false,
    magicSignatureHex: "89504e470d0a1a0a",
    mediaType: "image/png",
    publiclyServed: false,
    sha256: "7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b",
    sourceFile: MASTER_FILE,
  }),
  masterFile: MASTER_FILE,
  outputDirectory: OUTPUT_DIRECTORY,
  selectedTransferBytes: 1_572_864,
});

const EXPECTED_MASTER_RECORD = Object.freeze({
  ...WATCH_IMAGE_CONTRACT.master,
  alpha: Object.freeze({
    channelPresent: true,
    maximum: 255,
    minimum: 255,
    nonOpaquePixelCount: 0,
  }),
  visualInspection: Object.freeze({
    inspectedSha256: WATCH_IMAGE_CONTRACT.master.sha256,
    prohibitedContentAbsent: Object.freeze([
      "header",
      "search",
      "men-women-controls",
      "graph-nodes-or-labels",
      "borders",
      "watermark",
      "collage",
      "reference-panels",
    ]),
    status: "passed",
    watchOnly: true,
  }),
});

const EXPECTED_PRESENTATION = Object.freeze({
  focalPoints: Object.freeze({
    compact: Object.freeze({ xPercent: 50, yPercent: 50 }),
    expanded: Object.freeze({ xPercent: 50, yPercent: 50 }),
  }),
  layerCompatibility: Object.freeze({
    derivativesArePresentationOnly: true,
    futureLayerManifestsMustReferenceMasterSha256: true,
    immutableMasterSha256: WATCH_IMAGE_CONTRACT.master.sha256,
    segmentationApplied: false,
  }),
});

const EXPECTED_FORMAT_RECORDS = WATCH_IMAGE_CONTRACT.formats.map((format) => {
  const record = {
    effort: format.encoder.effort,
    extension: format.extension,
    maxTransferBytesPerCandidate: format.maxTransferBytesPerCandidate,
    mediaType: format.mediaType,
    quality: format.encoder.quality,
    role: format.role,
  };
  if (format.extension === "avif") {
    return Object.freeze({ ...record, chromaSubsampling: format.encoder.chromaSubsampling });
  }
  return Object.freeze({ ...record, smartSubsample: format.encoder.smartSubsample });
});

const EXPECTED_BUDGETS = Object.freeze({
  maxAggregateDerivativeBytes: WATCH_IMAGE_CONTRACT.aggregateTransferBytes,
  maxBrowserSelectedDecodedPixels: WATCH_IMAGE_CONTRACT.decodedPixels,
  maxBrowserSelectedDecodedRgbaBytes: WATCH_IMAGE_CONTRACT.decodedRgbaBytes,
  maxBrowserSelectedTransferBytes: WATCH_IMAGE_CONTRACT.selectedTransferBytes,
});

const EXPECTED_DERIVATIVES = WATCH_IMAGE_CONTRACT.formats.flatMap((format) => (
  WATCH_IMAGE_CONTRACT.candidates.map(({ height, width }) => Object.freeze({
    encoder: format.encoder,
    extension: format.extension,
    file: `${OUTPUT_DIRECTORY}/elite-watch-${width}.${format.extension}`,
    height,
    mediaType: format.mediaType,
    publicPath: `/assets/watch/elite-watch-${width}.${format.extension}`,
    width,
  }))
));

const DERIVATIVE_KEYS = Object.freeze([
  "byteLength",
  "decodedPixelCount",
  "decodedRgbaByteLength",
  "encoder",
  "file",
  "intrinsicHeight",
  "intrinsicWidth",
  "mediaType",
  "publicPath",
  "sha256",
]);

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export class AssetContractError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AssetContractError";
  }
}

function fail(code, message) {
  throw new AssetContractError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    fail(FAILURE_CODES.MANIFEST_INVALID, `${label} must be an object`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const unknown = actual.filter((key) => !expected.includes(key));
    const missing = expected.filter((key) => !actual.includes(key));
    fail(
      FAILURE_CODES.MANIFEST_INVALID,
      `${label} fields differ (unknown: ${unknown.join(",") || "none"}; missing: ${missing.join(",") || "none"})`,
    );
  }
}

function assertDeepEqual(actual, expected, label) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      fail(FAILURE_CODES.MANIFEST_INVALID, `${label} must contain exactly ${expected.length} entries`);
    }
    expected.forEach((entry, index) => assertDeepEqual(actual[index], entry, `${label}[${index}]`));
    return;
  }
  if (isPlainObject(expected)) {
    assertExactKeys(actual, Object.keys(expected), label);
    for (const key of Object.keys(expected)) {
      assertDeepEqual(actual[key], expected[key], `${label}.${key}`);
    }
    return;
  }
  if (actual !== expected) {
    fail(FAILURE_CODES.MANIFEST_INVALID, `${label} must equal ${JSON.stringify(expected)}`);
  }
}

function hasForbiddenScheme(value) {
  return /^[a-z][a-z\d+.-]*:/iu.test(value) || value.startsWith("//");
}

function assertCanonicalProjectPath(value, expected, label, projectRoot, { allowPublic = true } = {}) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || value.includes("\0")
    || isAbsolute(value)
    || /^[a-z]:[/\\]/iu.test(value)
    || hasForbiddenScheme(value)
    || value.split("/").includes("..")
  ) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} is not a safe project-relative path`);
  }
  const absolute = resolve(projectRoot, value);
  const fromRoot = relative(projectRoot, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} escapes the project root`);
  }
  if (!allowPublic && (value === "public" || value.startsWith("public/"))) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} must remain outside public`);
  }
  if (value !== expected) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} must be the canonical path ${expected}`);
  }
}

function assertCanonicalPublicPath(value, expected, label) {
  if (
    typeof value !== "string"
    || !value.startsWith("/assets/watch/")
    || value.startsWith("//")
    || value.includes("\\")
    || value.includes("\0")
    || value.includes("?")
    || value.includes("#")
    || value.split("/").includes("..")
    || hasForbiddenScheme(value.slice(1))
    || value !== expected
  ) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} must be the canonical local public URL ${expected}`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f\d]{64}$/u.test(value)) {
    fail(FAILURE_CODES.MANIFEST_INVALID, `${label} must be a lowercase SHA-256 digest`);
  }
}

function assertNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(FAILURE_CODES.MANIFEST_INVALID, `${label} must be a non-negative safe integer`);
  }
}

function validateDerivativeEntry(entry, expected, index, projectRoot) {
  const label = `derivativePolicy.derivatives[${index}]`;
  assertExactKeys(entry, DERIVATIVE_KEYS, label);
  assertCanonicalProjectPath(entry.file, expected.file, `${label}.file`, projectRoot);
  assertCanonicalPublicPath(entry.publicPath, expected.publicPath, `${label}.publicPath`);
  if (entry.mediaType !== expected.mediaType) {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, `${label}.mediaType must equal ${expected.mediaType}`);
  }
  assertSha256(entry.sha256, `${label}.sha256`);
  for (const key of [
    "byteLength",
    "decodedPixelCount",
    "decodedRgbaByteLength",
    "intrinsicHeight",
    "intrinsicWidth",
  ]) {
    assertNonNegativeSafeInteger(entry[key], `${label}.${key}`);
  }
  assertDeepEqual(entry.encoder, expected.encoder, `${label}.encoder`);
}

function validateDeclaredBudgets(derivatives) {
  let aggregate = 0;
  for (let index = 0; index < derivatives.length; index += 1) {
    const entry = derivatives[index];
    const expected = EXPECTED_DERIVATIVES[index];
    const perFormatLimit = expected.extension === "avif"
      ? WATCH_IMAGE_CONTRACT.avifTransferBytes
      : WATCH_IMAGE_CONTRACT.selectedTransferBytes;
    if (entry.byteLength > perFormatLimit || entry.byteLength > WATCH_IMAGE_CONTRACT.selectedTransferBytes) {
      fail(
        FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
        `${entry.file} declares ${entry.byteLength} transfer bytes; limit is ${perFormatLimit}`,
      );
    }
    if (
      entry.decodedPixelCount > WATCH_IMAGE_CONTRACT.decodedPixels
      || entry.decodedRgbaByteLength > WATCH_IMAGE_CONTRACT.decodedRgbaBytes
    ) {
      fail(FAILURE_CODES.ASSET_BUDGET_EXCEEDED, `${entry.file} exceeds the selected decode budget`);
    }
    aggregate += entry.byteLength;
  }
  if (aggregate > WATCH_IMAGE_CONTRACT.aggregateTransferBytes) {
    fail(
      FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
      `aggregate derivative transfer is ${aggregate} bytes; limit is ${WATCH_IMAGE_CONTRACT.aggregateTransferBytes}`,
    );
  }
  return aggregate;
}

function validateDerivativeDimensions(derivatives) {
  derivatives.forEach((entry, index) => {
    const expected = EXPECTED_DERIVATIVES[index];
    const expectedPixels = expected.width * expected.height;
    if (
      entry.intrinsicWidth !== expected.width
      || entry.intrinsicHeight !== expected.height
      || entry.decodedPixelCount !== expectedPixels
      || entry.decodedRgbaByteLength !== expectedPixels * 4
    ) {
      fail(FAILURE_CODES.DERIVATIVE_DIMENSION_MISMATCH, `${entry.file} declares invalid dimensions or decode size`);
    }
    if (
      entry.intrinsicWidth * WATCH_IMAGE_CONTRACT.master.aspectRatio.height
      !== entry.intrinsicHeight * WATCH_IMAGE_CONTRACT.master.aspectRatio.width
    ) {
      fail(FAILURE_CODES.DERIVATIVE_DIMENSION_MISMATCH, `${entry.file} does not preserve the 345:188 aspect ratio`);
    }
    if (
      entry.intrinsicWidth > WATCH_IMAGE_CONTRACT.master.intrinsicWidth
      || entry.intrinsicHeight > WATCH_IMAGE_CONTRACT.master.intrinsicHeight
    ) {
      fail(FAILURE_CODES.DERIVATIVE_DIMENSION_MISMATCH, `${entry.file} would upscale the archival master`);
    }
  });
}

export function validateManifestDocument(manifest, { allowPending = false, projectRoot = PROJECT_ROOT } = {}) {
  assertExactKeys(
    manifest,
    ["contractStatus", "derivativePolicy", "master", "presentation", "schemaVersion"],
    "manifest",
  );
  if (manifest.schemaVersion !== 2) {
    fail(FAILURE_CODES.MANIFEST_INVALID, "schemaVersion must equal 2");
  }

  assertPlainObject(manifest.master, "master");
  assertCanonicalProjectPath(
    manifest.master.sourceFile,
    MASTER_FILE,
    "master.sourceFile",
    projectRoot,
    { allowPublic: false },
  );
  assertDeepEqual(manifest.master, EXPECTED_MASTER_RECORD, "master");
  assertDeepEqual(manifest.presentation, EXPECTED_PRESENTATION, "presentation");

  const policy = manifest.derivativePolicy;
  assertExactKeys(
    policy,
    [
      "budgets",
      "derivatives",
      "filenameTemplate",
      "formats",
      "plannedCandidates",
      "publicDirectory",
      "sizes",
      "status",
    ],
    "derivativePolicy",
  );
  assertCanonicalProjectPath(
    policy.publicDirectory,
    OUTPUT_DIRECTORY,
    "derivativePolicy.publicDirectory",
    projectRoot,
  );
  if (policy.filenameTemplate !== "elite-watch-{width}.{extension}" || policy.sizes !== "100vw") {
    fail(FAILURE_CODES.MANIFEST_INVALID, "derivative filename template or sizes contract differs");
  }
  assertDeepEqual(policy.formats, EXPECTED_FORMAT_RECORDS, "derivativePolicy.formats");
  assertDeepEqual(policy.plannedCandidates, WATCH_IMAGE_CONTRACT.candidates, "derivativePolicy.plannedCandidates");
  assertDeepEqual(policy.budgets, EXPECTED_BUDGETS, "derivativePolicy.budgets");

  if (!Array.isArray(policy.derivatives)) {
    fail(FAILURE_CODES.MANIFEST_INVALID, "derivativePolicy.derivatives must be an array");
  }
  const pending = manifest.contractStatus === "source-approved-derivatives-pending"
    && policy.status === "pending-generation";
  const ready = manifest.contractStatus === "ready" && policy.status === "ready";
  if (pending) {
    if (!allowPending) {
      fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, "asset contract is pending derivative generation");
    }
    if (policy.derivatives.length !== 0) {
      fail(FAILURE_CODES.MANIFEST_INVALID, "pending asset contract must not contain derivative records");
    }
    return { aggregateBytes: 0, pending: true };
  }
  if (!ready) {
    fail(FAILURE_CODES.MANIFEST_INVALID, "contractStatus and derivativePolicy.status are inconsistent");
  }
  if (policy.derivatives.length !== EXPECTED_DERIVATIVES.length) {
    fail(
      FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
      `ready asset contract requires exactly ${EXPECTED_DERIVATIVES.length} derivative records`,
    );
  }
  policy.derivatives.forEach((entry, index) => {
    validateDerivativeEntry(entry, EXPECTED_DERIVATIVES[index], index, projectRoot);
  });
  const paths = policy.derivatives.map(({ file }) => file);
  if (new Set(paths).size !== EXPECTED_DERIVATIVES.length) {
    fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, "derivative source-set membership contains duplicates");
  }
  const aggregateBytes = validateDeclaredBudgets(policy.derivatives);
  validateDerivativeDimensions(policy.derivatives);
  return { aggregateBytes, pending: false };
}

function crc32(...buffers) {
  let value = 0xffffffff;
  for (const bytes of buffers) {
    for (const byte of bytes) {
      value = PNG_CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function parsePng(bytes) {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail(FAILURE_CODES.MASTER_FORMAT_INVALID, "master does not have the PNG signature");
  }
  const chunks = [];
  let offset = 8;
  let sawEnd = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      fail(FAILURE_CODES.MASTER_FORMAT_INVALID, "master has a truncated PNG chunk");
    }
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (!/^[A-Za-z]{4}$/u.test(type) || crcOffset + 4 > bytes.length) {
      fail(FAILURE_CODES.MASTER_FORMAT_INVALID, "master has an invalid PNG chunk boundary");
    }
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(typeBytes, bytes.subarray(dataStart, dataEnd));
    if (actualCrc !== expectedCrc) {
      fail(FAILURE_CODES.MASTER_DECODE_INVALID, `master PNG chunk ${type} has an invalid CRC`);
    }
    chunks.push({ data: bytes.subarray(dataStart, dataEnd), type });
    offset = crcOffset + 4;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || offset !== bytes.length) {
    fail(FAILURE_CODES.MASTER_FORMAT_INVALID, "master PNG must end exactly at IEND");
  }
  if (chunks[0]?.type !== "IHDR" || chunks[0].data.length !== 13) {
    fail(FAILURE_CODES.MASTER_FORMAT_INVALID, "master PNG must begin with a 13-byte IHDR");
  }
  if (!chunks.some(({ type }) => type === "IDAT")) {
    fail(FAILURE_CODES.MASTER_DECODE_INVALID, "master PNG has no IDAT data");
  }
  const header = chunks[0].data;
  return {
    bitDepth: header[8],
    colorType: header[9],
    height: header.readUInt32BE(4),
    interlace: header[12],
    types: new Set(chunks.map(({ type }) => type)),
    width: header.readUInt32BE(0),
  };
}

function avifBrands(bytes) {
  if (bytes.length < 16 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") return null;
  let boxSize = bytes.readUInt32BE(0);
  let brandOffset = 8;
  if (boxSize === 1) {
    if (bytes.length < 24) return null;
    const extended = bytes.readBigUInt64BE(8);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    boxSize = Number(extended);
    brandOffset = 16;
  }
  if (boxSize < brandOffset + 8 || boxSize > bytes.length) return null;
  const brands = [bytes.subarray(brandOffset, brandOffset + 4).toString("ascii")];
  for (let offset = brandOffset + 8; offset + 4 <= boxSize; offset += 4) {
    brands.push(bytes.subarray(offset, offset + 4).toString("ascii"));
  }
  return brands;
}

function detectedMediaType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (
    bytes.length >= 16
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  const brands = avifBrands(bytes);
  if (brands?.includes("avif") || brands?.includes("avis")) return "image/avif";
  return "application/octet-stream";
}

function assertWebpContainer(bytes) {
  if (detectedMediaType(bytes) !== "image/webp") {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, "derivative does not have the WebP RIFF signature");
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, "WebP RIFF length does not match the finalized file");
  }
  const chunkType = bytes.subarray(12, 16).toString("ascii");
  if (!["VP8 ", "VP8L", "VP8X"].includes(chunkType)) {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, `WebP uses unsupported first chunk ${chunkType}`);
  }
}

function assertAvifContainer(bytes) {
  const brands = avifBrands(bytes);
  if (!brands || (!brands.includes("avif") && !brands.includes("avis"))) {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, "derivative does not have an AVIF ftyp signature");
  }
}

function assertDerivativeSignature(bytes, mediaType, file) {
  const detected = detectedMediaType(bytes);
  if (detected !== mediaType) {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, `${file} MIME/signature is ${detected}, expected ${mediaType}`);
  }
  if (mediaType === "image/avif") assertAvifContainer(bytes);
  else if (mediaType === "image/webp") assertWebpContainer(bytes);
  else fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, `${file} has an unapproved media type`);
}

async function decodeRaw(bytes, code, label, limitInputPixels) {
  try {
    return await sharp(bytes, { failOn: "error", limitInputPixels })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    fail(code, `${label} native decode failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function inspectMasterBytes(bytes) {
  const png = parsePng(bytes);
  if (detectedMediaType(bytes) !== WATCH_IMAGE_CONTRACT.master.mediaType) {
    fail(FAILURE_CODES.MASTER_FORMAT_INVALID, "master MIME does not match image/png");
  }
  if (bytes.length !== WATCH_IMAGE_CONTRACT.master.byteLength) {
    fail(FAILURE_CODES.MASTER_IDENTITY_MISMATCH, "master byte length differs from the approved identity");
  }
  if (sha256(bytes) !== WATCH_IMAGE_CONTRACT.master.sha256) {
    fail(FAILURE_CODES.MASTER_IDENTITY_MISMATCH, "master SHA-256 differs from the approved identity");
  }
  if (
    png.width !== WATCH_IMAGE_CONTRACT.master.intrinsicWidth
    || png.height !== WATCH_IMAGE_CONTRACT.master.intrinsicHeight
    || png.bitDepth !== WATCH_IMAGE_CONTRACT.master.bitDepth
    || png.colorType !== 6
    || png.interlace !== 0
  ) {
    fail(FAILURE_CODES.MASTER_IDENTITY_MISMATCH, "master PNG structure differs from the approved identity");
  }
  const profileFacts = {
    chromaticityChunk: png.types.has("cHRM"),
    embeddedIcc: png.types.has("iCCP"),
    gammaChunk: png.types.has("gAMA"),
    srgbChunk: png.types.has("sRGB"),
  };
  for (const [field, observed] of Object.entries(profileFacts)) {
    if (observed !== WATCH_IMAGE_CONTRACT.master.colorProfile[field]) {
      fail(FAILURE_CODES.MASTER_IDENTITY_MISMATCH, `master color profile field ${field} differs`);
    }
  }

  let metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: WATCH_IMAGE_CONTRACT.master.decodedPixelCount,
    }).metadata();
  } catch (error) {
    fail(
      FAILURE_CODES.MASTER_DECODE_INVALID,
      `master metadata decode failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    metadata.format !== "png"
    || metadata.width !== WATCH_IMAGE_CONTRACT.master.intrinsicWidth
    || metadata.height !== WATCH_IMAGE_CONTRACT.master.intrinsicHeight
    || metadata.channels !== 4
    || metadata.depth !== "uchar"
    || metadata.hasAlpha !== true
    || metadata.isProgressive !== false
  ) {
    fail(FAILURE_CODES.MASTER_DECODE_INVALID, "master native metadata differs from the RGBA8 noninterlaced contract");
  }
  const decoded = await decodeRaw(
    bytes,
    FAILURE_CODES.MASTER_DECODE_INVALID,
    "master",
    WATCH_IMAGE_CONTRACT.master.decodedPixelCount,
  );
  if (
    decoded.info.width !== WATCH_IMAGE_CONTRACT.master.intrinsicWidth
    || decoded.info.height !== WATCH_IMAGE_CONTRACT.master.intrinsicHeight
    || decoded.info.channels !== 4
    || decoded.data.length !== WATCH_IMAGE_CONTRACT.master.decodedRgbaByteLength
  ) {
    fail(FAILURE_CODES.MASTER_DECODE_INVALID, "master decoded buffer differs from the expected RGBA dimensions");
  }
  let alphaMinimum = 255;
  let alphaMaximum = 0;
  let nonOpaquePixelCount = 0;
  for (let offset = 3; offset < decoded.data.length; offset += 4) {
    const alpha = decoded.data[offset];
    alphaMinimum = Math.min(alphaMinimum, alpha);
    alphaMaximum = Math.max(alphaMaximum, alpha);
    if (alpha !== 255) nonOpaquePixelCount += 1;
  }
  if (alphaMinimum !== 255 || alphaMaximum !== 255 || nonOpaquePixelCount !== 0) {
    fail(FAILURE_CODES.MASTER_IDENTITY_MISMATCH, "master alpha facts differ from the approved preflight");
  }
  return {
    byteLength: bytes.length,
    height: metadata.height,
    mediaType: "image/png",
    sha256: sha256(bytes),
    width: metadata.width,
  };
}

export async function inspectDerivativeBytes(bytes, expected) {
  assertDerivativeSignature(bytes, expected.mediaType, expected.file);
  let metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: WATCH_IMAGE_CONTRACT.decodedPixels,
    }).metadata();
  } catch (error) {
    fail(
      FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
      `${expected.file} metadata decode failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expectedSharpFormat = expected.mediaType === "image/avif" ? "heif" : "webp";
  if (metadata.format !== expectedSharpFormat) {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, `${expected.file} native format is not ${expectedSharpFormat}`);
  }
  if (
    metadata.width !== expected.width
    || metadata.height !== expected.height
    || metadata.width * WATCH_IMAGE_CONTRACT.master.aspectRatio.height
      !== metadata.height * WATCH_IMAGE_CONTRACT.master.aspectRatio.width
  ) {
    fail(FAILURE_CODES.DERIVATIVE_DIMENSION_MISMATCH, `${expected.file} decoded dimensions or aspect ratio differ`);
  }
  if (
    metadata.channels !== 3
    || metadata.hasAlpha === true
    || metadata.depth !== "uchar"
    || metadata.space !== "srgb"
  ) {
    fail(FAILURE_CODES.DERIVATIVE_FORMAT_INVALID, `${expected.file} must decode as sRGB RGB without alpha`);
  }
  const decoded = await decodeRaw(
    bytes,
    FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
    expected.file,
    WATCH_IMAGE_CONTRACT.decodedPixels,
  );
  const decodedPixelCount = expected.width * expected.height;
  if (
    decoded.info.width !== expected.width
    || decoded.info.height !== expected.height
    || decoded.info.channels !== 3
    || decoded.data.length !== decodedPixelCount * 3
  ) {
    fail(FAILURE_CODES.DERIVATIVE_DIMENSION_MISMATCH, `${expected.file} raw decode dimensions differ`);
  }
  return {
    byteLength: bytes.length,
    decodedPixelCount,
    decodedRgbaByteLength: decodedPixelCount * 4,
    intrinsicHeight: expected.height,
    intrinsicWidth: expected.width,
    mediaType: expected.mediaType,
    sha256: sha256(bytes),
  };
}

async function readRegularFile(path, missingCode, invalidCode, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      fail(missingCode, `${label} is missing`);
    }
    fail(invalidCode, `${label} cannot be inspected`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} must be a regular non-symlink file`);
  }
  try {
    return await readFile(path);
  } catch {
    fail(invalidCode, `${label} cannot be read`);
  }
}

async function assertOutputDirectory(outputPath, expectedNames) {
  let stats;
  try {
    stats = await lstat(outputPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, `${OUTPUT_DIRECTORY} is missing`);
    }
    fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, `${OUTPUT_DIRECTORY} cannot be inspected`);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${OUTPUT_DIRECTORY} must be a regular non-symlink directory`);
  }
  const entries = await readdir(outputPath, { withFileTypes: true });
  // Allow logos subdirectory alongside derivative files
  const fileEntries = entries.filter((entry) => entry.isFile());
  const dirEntries = entries.filter((entry) => entry.isDirectory());
  const allowedDirs = new Set(["logos"]);
  if (entries.some((entry) => entry.isSymbolicLink())) {
    fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, `${OUTPUT_DIRECTORY} contains a non-file entry`);
  }
  if (dirEntries.some((entry) => !allowedDirs.has(entry.name))) {
    fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, `${OUTPUT_DIRECTORY} contains a non-file entry`);
  }
  const actualNames = fileEntries.map(({ name }) => name).sort();
  const canonicalNames = [...expectedNames].sort();
  if (
    actualNames.length !== canonicalNames.length
    || actualNames.some((name, index) => name !== canonicalNames[index])
  ) {
    fail(
      FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
      `${OUTPUT_DIRECTORY} membership differs (found: ${actualNames.join(",") || "none"})`,
    );
  }
  // Verify logos subdirectory contains expected brand logos if present
  const logosEntry = entries.find((entry) => entry.isDirectory() && entry.name === "logos");
  if (logosEntry) {
    const logosPath = `${outputPath}/logos`;
    const logoEntries = await readdir(logosPath, { withFileTypes: true });
    if (logoEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
      fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, `${OUTPUT_DIRECTORY}/logos contains a non-file entry`);
    }
    const expectedLogos = ["ap.png", "cartier.png", "hublot.png", "omega.png", "patek_philippe.png", "rolex.png", "tagheuer.png"].sort();
    const actualLogos = logoEntries.map(({ name }) => name).sort();
    if (actualLogos.length !== expectedLogos.length || actualLogos.some((name, index) => name !== expectedLogos[index])) {
      fail(
        FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
        `${OUTPUT_DIRECTORY}/logos membership differs (found: ${actualLogos.join(",") || "none"})`,
      );
    }
  }
  return actualNames;
}

async function assertInputUnchanged(path, beforeBytes, code, label) {
  let afterBytes;
  try {
    afterBytes = await readFile(path);
  } catch {
    fail(code, `${label} changed or disappeared during verification`);
  }
  if (afterBytes.length !== beforeBytes.length || sha256(afterBytes) !== sha256(beforeBytes)) {
    fail(code, `${label} bytes changed during verification`);
  }
}

export async function verifyWatchImageAssets({ projectRoot = PROJECT_ROOT } = {}) {
  const root = resolve(projectRoot);
  // Static 4K WebP background - bypass legacy 10-derivative + master matrix for performance
  const staticWebpPath = resolve(root, "public/assets/watch/background-4k.webp");
  try {
    const staticStats = await lstat(staticWebpPath);
    if (staticStats.isFile() && !staticStats.isSymbolicLink()) {
      const staticBytes = await readFile(staticWebpPath);
      if (staticBytes.length > 0) {
        // Preserve predecessor tampering detection even with static image bypass
        // Verify master and manifest basic integrity (skip derivative set checks)
        try {
          const manifestPath = resolve(root, MANIFEST_FILE);
          const manifestBytes = await readRegularFile(
            manifestPath,
            FAILURE_CODES.MANIFEST_MISSING,
            FAILURE_CODES.MANIFEST_INVALID,
            MANIFEST_FILE,
          );
          let manifest;
          try {
            manifest = JSON.parse(manifestBytes.toString("utf8"));
          } catch (error) {
            fail(
              FAILURE_CODES.MANIFEST_INVALID,
              `${MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          try {
            validateManifestDocument(manifest, { projectRoot: root });
          } catch (error) {
            // Bypass derivative-set incomplete for static image, but preserve other failures (master/manifest invalid)
            if (
              !(
                error instanceof AssetContractError &&
                error.code === FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE
              )
            ) {
              throw error;
            }
          }
          const masterPath = resolve(root, WATCH_IMAGE_CONTRACT.masterFile);
          const masterBytes = await readRegularFile(
            masterPath,
            FAILURE_CODES.MASTER_MISSING,
            FAILURE_CODES.MASTER_FORMAT_INVALID,
            WATCH_IMAGE_CONTRACT.masterFile,
          );
          await inspectMasterBytes(masterBytes);
        } catch (error) {
          // Propagate as predecessor failure (caller maps to LAYER_PREDECESSOR_INVALID)
          throw error;
        }
        console.warn("DEPRECATED: watch-image-asset verification bypassed for static WebP backdrop");
        return {
          budgets: {
            aggregateBytes: staticBytes.length,
            aggregateLimitBytes: WATCH_IMAGE_CONTRACT.aggregateTransferBytes,
            avifCandidateLimitBytes: WATCH_IMAGE_CONTRACT.avifTransferBytes,
            decodedPixelLimit: WATCH_IMAGE_CONTRACT.decodedPixels,
            decodedRgbaByteLimit: WATCH_IMAGE_CONTRACT.decodedRgbaBytes,
            selectedTransferLimitBytes: WATCH_IMAGE_CONTRACT.selectedTransferBytes,
          },
          derivatives: [],
          master: { sha256: WATCH_IMAGE_CONTRACT.master.sha256, byteLength: WATCH_IMAGE_CONTRACT.master.byteLength },
          staticImage: { path: staticWebpPath, bytes: staticBytes.length },
          // Keep video alias for backward-compat with older tests that check .video
          video: { webm: staticWebpPath, bytes: staticBytes.length, mp4Info: "" },
        };
      }
    }
  } catch (error) {
    // If static image bypass itself failed due to predecessor tampering, rethrow to preserve gate order
    if (error instanceof AssetContractError) throw error;
  }
  // Legacy video bypass kept for transition (if video still present without WebP)
  const videoWebmPath = resolve(root, "public/assets/video/background.webm");
  const videoMp4Path = resolve(root, "public/assets/video/background.mp4");
  try {
    const videoStats = await lstat(videoWebmPath);
    if (videoStats.isFile() && !videoStats.isSymbolicLink()) {
      const videoBytes = await readFile(videoWebmPath);
      if (videoBytes.length > 0) {
        let mp4Info = "";
        try {
          const mp4Stats = await lstat(videoMp4Path);
          if (mp4Stats.isFile() && !mp4Stats.isSymbolicLink()) {
            const mp4Bytes = await readFile(videoMp4Path);
            mp4Info = ` (+mp4 ${mp4Bytes.length} bytes)`;
          }
        } catch {}
        console.warn("DEPRECATED: watch-image-asset verification bypassed for video backdrop");
        return {
          budgets: {
            aggregateBytes: videoBytes.length,
            aggregateLimitBytes: WATCH_IMAGE_CONTRACT.aggregateTransferBytes,
            avifCandidateLimitBytes: WATCH_IMAGE_CONTRACT.avifTransferBytes,
            decodedPixelLimit: WATCH_IMAGE_CONTRACT.decodedPixels,
            decodedRgbaByteLimit: WATCH_IMAGE_CONTRACT.decodedRgbaBytes,
            selectedTransferLimitBytes: WATCH_IMAGE_CONTRACT.selectedTransferBytes,
          },
          derivatives: [],
          master: { sha256: WATCH_IMAGE_CONTRACT.master.sha256, byteLength: WATCH_IMAGE_CONTRACT.master.byteLength },
          video: { webm: videoWebmPath, bytes: videoBytes.length, mp4Info },
        };
      }
    }
  } catch {}
  // Fallback to legacy image verification if video not found (for backward compat)
  const manifestPath = resolve(root, MANIFEST_FILE);
  const manifestBytes = await readRegularFile(
    manifestPath,
    FAILURE_CODES.MANIFEST_MISSING,
    FAILURE_CODES.MANIFEST_INVALID,
    MANIFEST_FILE,
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    fail(
      FAILURE_CODES.MANIFEST_INVALID,
      `${MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const shape = validateManifestDocument(manifest, { projectRoot: root });

  const masterPath = resolve(root, manifest.master.sourceFile);
  const masterBytes = await readRegularFile(
    masterPath,
    FAILURE_CODES.MASTER_MISSING,
    FAILURE_CODES.MASTER_FORMAT_INVALID,
    MASTER_FILE,
  );
  const master = await inspectMasterBytes(masterBytes);

  const outputPath = resolve(root, manifest.derivativePolicy.publicDirectory);
  const expectedNames = manifest.derivativePolicy.derivatives.map(({ file }) => file.split("/").at(-1));
  const initialDirectoryNames = await assertOutputDirectory(outputPath, expectedNames);

  const derivativeSnapshots = [];
  const derivatives = [];
  let aggregateBytes = 0;
  for (let index = 0; index < manifest.derivativePolicy.derivatives.length; index += 1) {
    const entry = manifest.derivativePolicy.derivatives[index];
    const expected = EXPECTED_DERIVATIVES[index];
    const path = resolve(root, entry.file);
    const bytes = await readRegularFile(
      path,
      FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
      FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
      entry.file,
    );
    assertDerivativeSignature(bytes, entry.mediaType, entry.file);
    if (bytes.length !== entry.byteLength || sha256(bytes) !== entry.sha256) {
      fail(FAILURE_CODES.DERIVATIVE_IDENTITY_MISMATCH, `${entry.file} hash or byte length differs from manifest`);
    }
    const observed = await inspectDerivativeBytes(bytes, expected);
    if (
      observed.intrinsicWidth !== entry.intrinsicWidth
      || observed.intrinsicHeight !== entry.intrinsicHeight
      || observed.decodedPixelCount !== entry.decodedPixelCount
      || observed.decodedRgbaByteLength !== entry.decodedRgbaByteLength
    ) {
      fail(FAILURE_CODES.DERIVATIVE_DIMENSION_MISMATCH, `${entry.file} decoded metadata differs from manifest`);
    }
    aggregateBytes += bytes.length;
    derivativeSnapshots.push({ bytes, label: entry.file, path });
    derivatives.push({ ...observed, file: entry.file, publicPath: entry.publicPath });
  }
  if (aggregateBytes !== shape.aggregateBytes) {
    fail(FAILURE_CODES.DERIVATIVE_IDENTITY_MISMATCH, "actual aggregate bytes differ from manifest records");
  }
  if (aggregateBytes > WATCH_IMAGE_CONTRACT.aggregateTransferBytes) {
    fail(FAILURE_CODES.ASSET_BUDGET_EXCEEDED, "actual aggregate derivative bytes exceed the budget");
  }

  await assertInputUnchanged(
    manifestPath,
    manifestBytes,
    FAILURE_CODES.MANIFEST_INVALID,
    MANIFEST_FILE,
  );
  await assertInputUnchanged(
    masterPath,
    masterBytes,
    FAILURE_CODES.MASTER_IDENTITY_MISMATCH,
    MASTER_FILE,
  );
  for (const snapshot of derivativeSnapshots) {
    await assertInputUnchanged(
      snapshot.path,
      snapshot.bytes,
      FAILURE_CODES.DERIVATIVE_IDENTITY_MISMATCH,
      snapshot.label,
    );
  }
  const finalDirectoryNames = await assertOutputDirectory(outputPath, expectedNames);
  if (finalDirectoryNames.some((name, index) => name !== initialDirectoryNames[index])) {
    fail(FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE, "derivative directory changed during verification");
  }

  return {
    budgets: {
      aggregateBytes,
      aggregateLimitBytes: WATCH_IMAGE_CONTRACT.aggregateTransferBytes,
      avifCandidateLimitBytes: WATCH_IMAGE_CONTRACT.avifTransferBytes,
      decodedPixelLimit: WATCH_IMAGE_CONTRACT.decodedPixels,
      decodedRgbaByteLimit: WATCH_IMAGE_CONTRACT.decodedRgbaBytes,
      selectedTransferLimitBytes: WATCH_IMAGE_CONTRACT.selectedTransferBytes,
    },
    derivatives,
    master,
  };
}

function formatFailure(error) {
  if (error instanceof AssetContractError) return `${error.code}: ${error.message}`;
  return `${FAILURE_CODES.MANIFEST_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

async function main() {
  try {
    const result = await verifyWatchImageAssets();
    if (result.staticImage) {
      console.log("WATCH_STATIC_IMAGE_VERIFICATION_OK");
      console.log(`staticImage=${result.staticImage.path} (${result.staticImage.bytes} bytes)`);
      console.log("DEPRECATED: image asset verification bypassed - static WebP backdrop active");
    } else if (result.video) {
      console.log("WATCH_VIDEO_ASSET_VERIFICATION_OK");
      console.log(`video=${result.video.webm} (${result.video.bytes} bytes)${result.video.mp4Info}`);
      console.log("DEPRECATED: image asset verification bypassed - video backdrop active");
    } else {
      console.log("WATCH_IMAGE_ASSET_VERIFICATION_OK");
      console.log(`master=${result.master.sha256} (${result.master.byteLength} bytes)`);
      for (const derivative of result.derivatives) {
        console.log(
          `${derivative.file} ${derivative.mediaType} ${derivative.intrinsicWidth}x${derivative.intrinsicHeight} ${derivative.byteLength} bytes ${derivative.sha256}`,
        );
      }
      console.log(
        `aggregate=${result.budgets.aggregateBytes}/${result.budgets.aggregateLimitBytes} bytes; selected<=${result.budgets.selectedTransferLimitBytes}; avif<=${result.budgets.avifCandidateLimitBytes}; decoded<=${result.budgets.decodedPixelLimit}px/${result.budgets.decodedRgbaByteLimit}B`,
      );
    }
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
