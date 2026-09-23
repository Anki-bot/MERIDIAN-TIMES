import { createHash } from "node:crypto";
import { dirname } from "node:path";
import sharp from "sharp";
import {
  CANONICAL_PROJECT_PATHS,
  CANONICAL_SOURCE_COORDINATE_SPACE,
  LAYER_GATE_FAILURE_CODES,
  SEMANTIC_CLASSES,
  assertSafeProjectRelativePath,
  canonicalizeJson,
  serializeCanonicalJson,
  serializeCanonicalJsonLine,
  sha256,
} from "./contract.mjs";

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

export const CANDIDATE_EVIDENCE_DIRECTORY =
  `${CANONICAL_PROJECT_PATHS.successorReviewDirectory}/candidate-evidence`;
export const CANDIDATE_EVIDENCE_INDEX_PATH =
  `${CANDIDATE_EVIDENCE_DIRECTORY}/index.json`;

export const REVIEW_EVIDENCE_ISSUE_CODES = Object.freeze({
  CANDIDATE_INVALID: "REVIEW_CANDIDATE_INVALID",
  ENCODE_FAILED: "REVIEW_ENCODE_FAILED",
  INPUT_INVALID: "REVIEW_INPUT_INVALID",
  OUTPUT_BOUNDS: "REVIEW_OUTPUT_BOUNDS",
  SOURCE_DECODE_INVALID: "REVIEW_SOURCE_DECODE_INVALID",
  SOURCE_IDENTITY_MISMATCH: "REVIEW_SOURCE_IDENTITY_MISMATCH",
});

export const REVIEW_EVIDENCE_LIMITS = Object.freeze({
  maxCandidateCount: 64,
  maxContactSheetDimension: 8_192,
  maxContactSheetPixels: 24_000_000,
  maxOutputFiles: 512,
  maxSingleArtifactPixels: 20_000_000,
  maxTotalOutputPixels: 128_000_000,
  zoomPercent: Object.freeze([100, 200]),
});

const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SEMANTIC_CLASS_SET = new Set(SEMANTIC_CLASSES);
const CANDIDATE_FIELDS = Object.freeze([
  "disposition",
  "id",
  "possibleClasses",
  "sourceRect",
  "uncertaintyNotes",
]);
const PNG_OPTIONS = Object.freeze({
  adaptiveFiltering: false,
  compressionLevel: 9,
  effort: 10,
  palette: false,
  progressive: false,
});
const REVIEWER_AID_NOTICE =
  "Edge, contrast, and alpha visualizations are reviewer aids only; they do not infer semantics, approve motion, or establish source truth.";
const GENERATOR_NAME = "watch-layer-candidate-review-evidence";
const GENERATOR_VERSION = 1;

export class ReviewEvidenceError extends TypeError {
  constructor(issueCode, message, path = "$", code = LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID) {
    super(message);
    this.code = code;
    this.issueCode = issueCode;
    this.name = "ReviewEvidenceError";
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
  throw new ReviewEvidenceError(issueCode, message, path, code);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, expected, path) {
  if (!isPlainObject(value)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Value must be a plain object", path);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((field, index) => field !== wanted[index])
  ) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      `Object fields must equal ${wanted.join(",")}`,
      path,
    );
  }
  return value;
}

function detachedBytes(value, path) {
  if (!ArrayBuffer.isView(value)) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Image input must be a byte view",
      path,
    );
  }
  return Buffer.from(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function assertPositiveInteger(value, path, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      `Value must be an integer from 1 through ${maximum}`,
      path,
    );
  }
  return value;
}

function validateIdentity(value, path) {
  exactFields(value, ["byteLength", "path", "sha256"], path);
  const projectPath = assertSafeProjectRelativePath(value.path, { allowPublic: false });
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Identity byteLength must be a nonnegative safe integer",
      `${path}.byteLength`,
    );
  }
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256)) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Identity sha256 must be a lowercase SHA-256 digest",
      `${path}.sha256`,
    );
  }
  return Object.freeze({
    byteLength: value.byteLength,
    path: projectPath,
    sha256: value.sha256,
  });
}

function validateRect(value, sourceWidth, sourceHeight, path) {
  exactFields(value, ["height", "width", "x", "y"], path);
  for (const field of ["x", "y", "width", "height"]) {
    if (!Number.isSafeInteger(value[field])) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
        "Candidate rectangle values must be safe integers",
        `${path}.${field}`,
      );
    }
  }
  if (
    value.x < 0
    || value.y < 0
    || value.width < 1
    || value.height < 1
    || value.x + value.width > sourceWidth
    || value.y + value.height > sourceHeight
  ) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
      "Candidate rectangle must be nonempty and contained by the source image",
      path,
    );
  }
  return Object.freeze({
    height: value.height,
    width: value.width,
    x: value.x,
    y: value.y,
  });
}

export function validateReviewCandidateInventory(
  value,
  {
    sourceHeight = CANONICAL_SOURCE_COORDINATE_SPACE.height,
    sourceWidth = CANONICAL_SOURCE_COORDINATE_SPACE.width,
  } = {},
) {
  assertPositiveInteger(sourceWidth, "$.sourceWidth");
  assertPositiveInteger(sourceHeight, "$.sourceHeight");
  if (!Array.isArray(value)) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
      "Candidate inventory must be an array",
      "$.candidateInventory",
    );
  }
  if (value.length > REVIEW_EVIDENCE_LIMITS.maxCandidateCount) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
      `Candidate inventory exceeds the finite limit of ${REVIEW_EVIDENCE_LIMITS.maxCandidateCount}`,
      "$.candidateInventory",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }

  const ids = new Set();
  const candidates = value.map((candidate, index) => {
    const path = `$.candidateInventory[${index}]`;
    exactFields(candidate, CANDIDATE_FIELDS, path);
    if (typeof candidate.id !== "string" || !STABLE_ID_PATTERN.test(candidate.id)) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
        "Candidate ID must be stable lowercase kebab-case",
        `${path}.id`,
      );
    }
    if (ids.has(candidate.id)) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
        `Duplicate candidate ID ${candidate.id}`,
        `${path}.id`,
      );
    }
    ids.add(candidate.id);
    if (candidate.disposition !== "proposed-static") {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
        "Candidate evidence may be generated only for proposed-static candidates",
        `${path}.disposition`,
      );
    }
    if (!Array.isArray(candidate.possibleClasses) || candidate.possibleClasses.length === 0) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
        "Candidate must contain at least one reviewer-authored possible class",
        `${path}.possibleClasses`,
      );
    }
    const classSet = new Set();
    const possibleClasses = candidate.possibleClasses.map((semanticClass, classIndex) => {
      if (typeof semanticClass !== "string" || !SEMANTIC_CLASS_SET.has(semanticClass)) {
        fail(
          REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
          "Candidate possible class is not an approved semantic class",
          `${path}.possibleClasses[${classIndex}]`,
        );
      }
      if (classSet.has(semanticClass)) {
        fail(
          REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
          `Duplicate possible class ${semanticClass}`,
          `${path}.possibleClasses[${classIndex}]`,
        );
      }
      classSet.add(semanticClass);
      return semanticClass;
    });
    if (
      typeof candidate.uncertaintyNotes !== "string"
      || candidate.uncertaintyNotes.length === 0
      || candidate.uncertaintyNotes.length > 16_384
    ) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
        "Candidate uncertainty notes must be a nonempty bounded string",
        `${path}.uncertaintyNotes`,
      );
    }
    return Object.freeze({
      disposition: "proposed-static",
      id: candidate.id,
      possibleClasses: Object.freeze([...possibleClasses]),
      sourceRect: validateRect(candidate.sourceRect, sourceWidth, sourceHeight, `${path}.sourceRect`),
      uncertaintyNotes: candidate.uncertaintyNotes,
    });
  });
  return Object.freeze(candidates);
}

function artifactPath(path) {
  const normalized = assertSafeProjectRelativePath(path, {
    allowPublic: false,
    allowedRoots: [CANDIDATE_EVIDENCE_DIRECTORY],
  });
  if (normalized === CANDIDATE_EVIDENCE_DIRECTORY) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Evidence artifact path must identify a file beneath the evidence directory",
      path,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return normalized;
}

function inspectPngSignature(bytes, path) {
  if (bytes.byteLength < 8 || bytes.subarray(0, 8).toString("hex") !== PNG_SIGNATURE_HEX) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_DECODE_INVALID,
      "Source bytes must use the PNG signature",
      path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
}

async function decodeSourceRgba(bytes, sourceWidth, sourceHeight, sourcePath) {
  inspectPngSignature(bytes, sourcePath);
  const decodedPixels = sourceWidth * sourceHeight;
  let metadata;
  let decoded;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: decodedPixels,
      sequentialRead: true,
    }).metadata();
    decoded = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: decodedPixels,
      sequentialRead: true,
    })
      .ensureAlpha()
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_DECODE_INVALID,
      "Source PNG cannot be decoded within the finite image bounds",
      sourcePath,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  if (
    metadata.format !== "png"
    || metadata.width !== sourceWidth
    || metadata.height !== sourceHeight
    || metadata.depth !== "uchar"
    || decoded.info.width !== sourceWidth
    || decoded.info.height !== sourceHeight
    || decoded.info.channels !== 4
    || decoded.data.byteLength !== decodedPixels * 4
  ) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_DECODE_INVALID,
      "Source PNG metadata or decoded RGBA dimensions differ from the declared source space",
      sourcePath,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  return Buffer.from(decoded.data);
}

function extractRgba(source, sourceWidth, rect) {
  const output = Buffer.allocUnsafe(rect.width * rect.height * 4);
  const sourceStride = sourceWidth * 4;
  const outputStride = rect.width * 4;
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = (rect.y + row) * sourceStride + rect.x * 4;
    source.copy(output, row * outputStride, sourceStart, sourceStart + outputStride);
  }
  return output;
}

function scaleNearestRgba(source, width, height, scale) {
  if (scale === 1) return Buffer.from(source);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const output = Buffer.allocUnsafe(scaledWidth * scaledHeight * 4);
  const sourceStride = width * 4;
  const outputStride = scaledWidth * 4;
  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    const expandedRow = Buffer.allocUnsafe(outputStride);
    for (let sourceX = 0; sourceX < width; sourceX += 1) {
      const sourceOffset = sourceY * sourceStride + sourceX * 4;
      for (let repeatX = 0; repeatX < scale; repeatX += 1) {
        const outputOffset = (sourceX * scale + repeatX) * 4;
        source.copy(expandedRow, outputOffset, sourceOffset, sourceOffset + 4);
      }
    }
    for (let repeatY = 0; repeatY < scale; repeatY += 1) {
      expandedRow.copy(output, (sourceY * scale + repeatY) * outputStride);
    }
  }
  return output;
}

function createAlphaReviewerAid(source) {
  const output = Buffer.allocUnsafe(source.byteLength);
  for (let offset = 0; offset < source.byteLength; offset += 4) {
    const alpha = source[offset + 3];
    const inverse = 255 - alpha;
    output[offset] = Math.floor((source[offset] * alpha + 255 * inverse + 127) / 255);
    output[offset + 1] = Math.floor((source[offset + 1] * alpha + 127) / 255);
    output[offset + 2] = Math.floor((source[offset + 2] * alpha + 255 * inverse + 127) / 255);
    output[offset + 3] = 255;
  }
  return output;
}

function luminance(source, width, height, x, y) {
  const boundedX = Math.max(0, Math.min(width - 1, x));
  const boundedY = Math.max(0, Math.min(height - 1, y));
  const offset = (boundedY * width + boundedX) * 4;
  const alpha = source[offset + 3];
  const value = (
    77 * source[offset]
    + 150 * source[offset + 1]
    + 29 * source[offset + 2]
  ) >> 8;
  return Math.floor((value * alpha + 127) / 255);
}

function createEdgeContrastReviewerAid(source, width, height) {
  const output = Buffer.allocUnsafe(source.byteLength);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const topLeft = luminance(source, width, height, x - 1, y - 1);
      const top = luminance(source, width, height, x, y - 1);
      const topRight = luminance(source, width, height, x + 1, y - 1);
      const left = luminance(source, width, height, x - 1, y);
      const right = luminance(source, width, height, x + 1, y);
      const bottomLeft = luminance(source, width, height, x - 1, y + 1);
      const bottom = luminance(source, width, height, x, y + 1);
      const bottomRight = luminance(source, width, height, x + 1, y + 1);
      const gradientX = -topLeft - 2 * left - bottomLeft
        + topRight + 2 * right + bottomRight;
      const gradientY = -topLeft - 2 * top - topRight
        + bottomLeft + 2 * bottom + bottomRight;
      const rawStrength = Math.min(255, Math.floor((Math.abs(gradientX) + Math.abs(gradientY)) / 8));
      const strength = rawStrength < 24 ? 0 : rawStrength;
      const inverse = 255 - strength;
      const offset = (y * width + x) * 4;
      output[offset] = Math.floor((source[offset] * inverse + 127) / 255);
      output[offset + 1] = Math.floor((source[offset + 1] * inverse + 255 * strength + 127) / 255);
      output[offset + 2] = Math.floor((source[offset + 2] * inverse + 255 * strength + 127) / 255);
      output[offset + 3] = 255;
    }
  }
  return output;
}

async function encodeDeterministicPng(raw, width, height, path) {
  let bytes;
  try {
    bytes = await sharp(raw, {
      limitInputPixels: width * height,
      raw: { channels: 4, height, width },
    })
      .png(PNG_OPTIONS)
      .toBuffer();
  } catch {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.ENCODE_FAILED,
      "Review evidence PNG encoding failed",
      path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  if (bytes.subarray(0, 8).toString("hex") !== PNG_SIGNATURE_HEX) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.ENCODE_FAILED,
      "Encoded review evidence does not have a PNG signature",
      path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  return bytes;
}

const FONT_3X5 = Object.freeze({
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "111", "100", "111"],
  "3": ["110", "001", "111", "001", "110"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "110"],
  "-": ["000", "000", "111", "000", "000"],
  a: ["010", "101", "111", "101", "101"],
  b: ["110", "101", "110", "101", "110"],
  c: ["011", "100", "100", "100", "011"],
  d: ["110", "101", "101", "101", "110"],
  e: ["111", "100", "110", "100", "111"],
  f: ["111", "100", "110", "100", "100"],
  g: ["011", "100", "101", "101", "011"],
  h: ["101", "101", "111", "101", "101"],
  i: ["111", "010", "010", "010", "111"],
  j: ["001", "001", "001", "101", "010"],
  k: ["101", "101", "110", "101", "101"],
  l: ["100", "100", "100", "100", "111"],
  m: ["101", "111", "111", "101", "101"],
  n: ["101", "111", "111", "111", "101"],
  o: ["010", "101", "101", "101", "010"],
  p: ["110", "101", "110", "100", "100"],
  q: ["010", "101", "101", "111", "011"],
  r: ["110", "101", "110", "101", "101"],
  s: ["011", "100", "010", "001", "110"],
  t: ["111", "010", "010", "010", "010"],
  u: ["101", "101", "101", "101", "111"],
  v: ["101", "101", "101", "101", "010"],
  w: ["101", "101", "111", "111", "101"],
  x: ["101", "101", "010", "101", "101"],
  y: ["101", "101", "010", "010", "010"],
  z: ["111", "001", "010", "100", "111"],
});

function textWidth(text, scale) {
  return text.length === 0 ? 0 : (text.length * 4 - 1) * scale;
}

function fillRgba(buffer, red, green, blue, alpha = 255) {
  for (let offset = 0; offset < buffer.byteLength; offset += 4) {
    buffer[offset] = red;
    buffer[offset + 1] = green;
    buffer[offset + 2] = blue;
    buffer[offset + 3] = alpha;
  }
}

function fillRect(buffer, width, height, x, y, rectWidth, rectHeight, color) {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(width, x + rectWidth);
  const endY = Math.min(height, y + rectHeight);
  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      const offset = (row * width + column) * 4;
      buffer[offset] = color[0];
      buffer[offset + 1] = color[1];
      buffer[offset + 2] = color[2];
      buffer[offset + 3] = color[3] ?? 255;
    }
  }
}

function drawText(buffer, width, height, x, y, text, scale, color) {
  let cursorX = x;
  for (const character of text) {
    const glyph = FONT_3X5[character];
    if (!glyph) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
        `Bitmap label does not support character ${JSON.stringify(character)}`,
        "$",
      );
    }
    glyph.forEach((row, glyphY) => {
      [...row].forEach((sample, glyphX) => {
        if (sample === "1") {
          fillRect(
            buffer,
            width,
            height,
            cursorX + glyphX * scale,
            y + glyphY * scale,
            scale,
            scale,
            color,
          );
        }
      });
    });
    cursorX += 4 * scale;
  }
}

function compositeRgba(destination, destinationWidth, destinationHeight, source, sourceWidth, sourceHeight, x, y) {
  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    const destinationY = y + sourceY;
    if (destinationY < 0 || destinationY >= destinationHeight) continue;
    for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
      const destinationX = x + sourceX;
      if (destinationX < 0 || destinationX >= destinationWidth) continue;
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const destinationOffset = (destinationY * destinationWidth + destinationX) * 4;
      const alpha = source[sourceOffset + 3];
      const inverse = 255 - alpha;
      destination[destinationOffset] = Math.floor((source[sourceOffset] * alpha + destination[destinationOffset] * inverse + 127) / 255);
      destination[destinationOffset + 1] = Math.floor((source[sourceOffset + 1] * alpha + destination[destinationOffset + 1] * inverse + 127) / 255);
      destination[destinationOffset + 2] = Math.floor((source[sourceOffset + 2] * alpha + destination[destinationOffset + 2] * inverse + 127) / 255);
      destination[destinationOffset + 3] = 255;
    }
  }
}

function borderColor(candidateId) {
  const digest = createHash("sha256").update(candidateId).digest();
  return [digest[0] | 0x80, digest[1] | 0x80, digest[2] | 0x80, 255];
}

function createContactTile(candidate, crop, zoomPercent) {
  const scale = zoomPercent / 100;
  const labelScale = scale;
  const padding = 4 * scale;
  const labelHeight = 5 * labelScale;
  const cropWidth = candidate.sourceRect.width * scale;
  const cropHeight = candidate.sourceRect.height * scale;
  const labelWidth = textWidth(candidate.id, labelScale);
  const width = Math.max(cropWidth, labelWidth) + padding * 2;
  const cropX = Math.floor((width - cropWidth) / 2);
  const cropY = padding + labelHeight + padding;
  const height = cropY + cropHeight + padding;
  const tile = Buffer.allocUnsafe(width * height * 4);
  fillRgba(tile, 19, 23, 29, 255);
  const color = borderColor(candidate.id);
  drawText(tile, width, height, padding, padding, candidate.id, labelScale, color);

  const checkerSize = 8 * scale;
  for (let y = 0; y < cropHeight; y += checkerSize) {
    for (let x = 0; x < cropWidth; x += checkerSize) {
      const alternate = ((x / checkerSize) + (y / checkerSize)) % 2 === 0;
      fillRect(
        tile,
        width,
        height,
        cropX + x,
        cropY + y,
        Math.min(checkerSize, cropWidth - x),
        Math.min(checkerSize, cropHeight - y),
        alternate ? [92, 98, 108, 255] : [142, 148, 158, 255],
      );
    }
  }
  compositeRgba(tile, width, height, crop, cropWidth, cropHeight, cropX, cropY);
  const border = scale;
  fillRect(tile, width, height, cropX - border, cropY - border, cropWidth + border * 2, border, color);
  fillRect(tile, width, height, cropX - border, cropY + cropHeight, cropWidth + border * 2, border, color);
  fillRect(tile, width, height, cropX - border, cropY, border, cropHeight, color);
  fillRect(tile, width, height, cropX + cropWidth, cropY, border, cropHeight, color);
  return Object.freeze({
    borderColorHex: Buffer.from(color.slice(0, 3)).toString("hex"),
    bytes: tile,
    cropHeight,
    cropWidth,
    cropX,
    cropY,
    height,
    width,
  });
}

function planContactPages(tiles, zoomPercent) {
  if (tiles.length === 0) return [];
  const scale = zoomPercent / 100;
  const gutter = 8 * scale;
  const headerText = `reviewer-aid-only-no-semantic-inference-zoom-${zoomPercent}`;
  const headerScale = scale;
  const headerHeight = 5 * headerScale + gutter * 2;
  const minimumWidth = textWidth(headerText, headerScale) + gutter * 2;
  const pages = [];
  let page;

  function newPage() {
    return {
      height: headerHeight + gutter,
      placements: [],
      rowHeight: 0,
      width: minimumWidth,
      x: gutter,
      y: headerHeight,
    };
  }

  function canFit(target, tile, x, y) {
    const projectedWidth = Math.max(target.width, x + tile.width + gutter);
    const projectedHeight = Math.max(target.height, y + tile.height + gutter);
    return projectedWidth <= REVIEW_EVIDENCE_LIMITS.maxContactSheetDimension
      && projectedHeight <= REVIEW_EVIDENCE_LIMITS.maxContactSheetDimension
      && projectedWidth * projectedHeight <= REVIEW_EVIDENCE_LIMITS.maxContactSheetPixels;
  }

  function finish() {
    if (page && page.placements.length !== 0) {
      pages.push(Object.freeze({
        headerScale,
        headerText,
        height: page.height,
        placements: Object.freeze([...page.placements]),
        width: page.width,
      }));
    }
  }

  page = newPage();
  for (const entry of tiles) {
    let x = page.x;
    let y = page.y;
    if (x !== gutter && x + entry.tile.width + gutter > REVIEW_EVIDENCE_LIMITS.maxContactSheetDimension) {
      x = gutter;
      y = page.y + page.rowHeight + gutter;
    }
    if (!canFit(page, entry.tile, x, y)) {
      finish();
      page = newPage();
      x = page.x;
      y = page.y;
      if (!canFit(page, entry.tile, x, y)) {
        fail(
          REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
          `Candidate ${entry.candidate.id} cannot fit a bounded ${zoomPercent}% contact sheet`,
          `$.candidateInventory.${entry.candidate.id}`,
          LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
        );
      }
    }
    page.placements.push(Object.freeze({
      borderColorHex: entry.tile.borderColorHex,
      candidateId: entry.candidate.id,
      crop: Object.freeze({
        height: entry.tile.cropHeight,
        width: entry.tile.cropWidth,
        x: x + entry.tile.cropX,
        y: y + entry.tile.cropY,
      }),
      height: entry.tile.height,
      width: entry.tile.width,
      x,
      y,
    }));
    page.width = Math.max(page.width, x + entry.tile.width + gutter);
    page.height = Math.max(page.height, y + entry.tile.height + gutter);
    page.rowHeight = Math.max(page.rowHeight, entry.tile.height);
    page.x = x + entry.tile.width + gutter;
    page.y = y;
  }
  finish();
  return pages;
}

function renderContactPage(page, tileByCandidateId) {
  const canvas = Buffer.allocUnsafe(page.width * page.height * 4);
  fillRgba(canvas, 8, 11, 16, 255);
  drawText(
    canvas,
    page.width,
    page.height,
    8 * page.headerScale,
    8 * page.headerScale,
    page.headerText,
    page.headerScale,
    [214, 224, 236, 255],
  );
  for (const placement of page.placements) {
    const tile = tileByCandidateId.get(placement.candidateId);
    compositeRgba(
      canvas,
      page.width,
      page.height,
      tile.bytes,
      tile.width,
      tile.height,
      placement.x,
      placement.y,
    );
  }
  return canvas;
}

function outputFingerprint(records) {
  return sha256(serializeCanonicalJson(records.map(({ byteLength, path, sha256: digest }) => ({
    byteLength,
    path,
    sha256: digest,
  }))));
}

/**
 * Render review-only evidence entirely in memory. The only semantic values used are
 * the reviewer-authored candidate IDs, rectangles, possible classes, static
 * dispositions, and uncertainty notes supplied by the strict authoring document.
 */
export async function renderCandidateReviewEvidence({
  authoringIdentity,
  candidateInventory,
  sourceBytes,
  sourceHeight = CANONICAL_SOURCE_COORDINATE_SPACE.height,
  sourceIdentity,
  sourceWidth = CANONICAL_SOURCE_COORDINATE_SPACE.width,
} = {}) {
  assertPositiveInteger(sourceWidth, "$.sourceWidth");
  assertPositiveInteger(sourceHeight, "$.sourceHeight");
  const sourcePixels = sourceWidth * sourceHeight;
  if (!Number.isSafeInteger(sourcePixels) || sourcePixels > CANONICAL_SOURCE_COORDINATE_SPACE.width * CANONICAL_SOURCE_COORDINATE_SPACE.height) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
      "Source decode dimensions exceed the canonical finite pixel bound",
      "$.sourceCoordinateSpace",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }

  const declaredSource = validateIdentity(sourceIdentity, "$.sourceIdentity");
  const declaredAuthoring = validateIdentity(authoringIdentity, "$.authoringIdentity");
  const bytes = detachedBytes(sourceBytes, "$.sourceBytes");
  if (
    bytes.byteLength !== declaredSource.byteLength
    || sha256(bytes) !== declaredSource.sha256
  ) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_IDENTITY_MISMATCH,
      "Source bytes differ from the declared source identity",
      declaredSource.path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  const candidates = validateReviewCandidateInventory(candidateInventory, {
    sourceHeight,
    sourceWidth,
  });
  const decoded = await decodeSourceRgba(
    bytes,
    sourceWidth,
    sourceHeight,
    declaredSource.path,
  );

  const outputs = [];
  const artifactRecords = [];
  const baseCrops = new Map();
  let totalOutputPixels = 0;

  function reserveOutput(path, width, height) {
    if (
      !Number.isSafeInteger(width)
      || !Number.isSafeInteger(height)
      || width < 1
      || height < 1
      || width > REVIEW_EVIDENCE_LIMITS.maxContactSheetDimension
      || height > REVIEW_EVIDENCE_LIMITS.maxContactSheetDimension
      || width * height > REVIEW_EVIDENCE_LIMITS.maxSingleArtifactPixels
    ) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
        "Review artifact exceeds the finite per-file dimension or pixel bound",
        path,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      );
    }
    totalOutputPixels += width * height;
    if (totalOutputPixels > REVIEW_EVIDENCE_LIMITS.maxTotalOutputPixels) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
        "Review evidence exceeds the finite aggregate decoded-pixel bound",
        path,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      );
    }
    if (outputs.length + 1 >= REVIEW_EVIDENCE_LIMITS.maxOutputFiles) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
        "Review evidence exceeds the finite output-file bound",
        path,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      );
    }
  }

  async function addPng({
    candidateId = null,
    kind,
    path,
    purpose,
    raw,
    sourceRect = null,
    width,
    height,
    zoomPercent,
    placements = undefined,
  }) {
    const normalizedPath = artifactPath(path);
    reserveOutput(normalizedPath, width, height);
    const png = await encodeDeterministicPng(raw, width, height, normalizedPath);
    const record = {
      byteLength: png.byteLength,
      candidateId,
      height,
      kind,
      mediaType: "image/png",
      path: normalizedPath,
      purpose,
      reviewerAid: true,
      semanticInference: false,
      sha256: sha256(png),
      sourceRect,
      width,
      zoomPercent,
    };
    if (placements !== undefined) record.placements = placements;
    artifactRecords.push(canonicalizeJson(record));
    outputs.push(Object.freeze({ bytes: png, path: normalizedPath }));
  }

  for (const candidate of candidates) {
    const crop = extractRgba(decoded, sourceWidth, candidate.sourceRect);
    const alphaAid = createAlphaReviewerAid(crop);
    const edgeAid = createEdgeContrastReviewerAid(
      crop,
      candidate.sourceRect.width,
      candidate.sourceRect.height,
    );
    baseCrops.set(candidate.id, crop);
    for (const zoomPercent of REVIEW_EVIDENCE_LIMITS.zoomPercent) {
      const scale = zoomPercent / 100;
      const width = candidate.sourceRect.width * scale;
      const height = candidate.sourceRect.height * scale;
      const variants = [
        {
          kind: "source-crop",
          name: `crop-${zoomPercent}.png`,
          purpose: "reviewer-authored-source-rectangle",
          raw: scaleNearestRgba(crop, candidate.sourceRect.width, candidate.sourceRect.height, scale),
        },
        {
          kind: "alpha-overlay",
          name: `alpha-reviewer-aid-${zoomPercent}.png`,
          purpose: "reviewer-aid-only-source-alpha-visualization",
          raw: scaleNearestRgba(alphaAid, candidate.sourceRect.width, candidate.sourceRect.height, scale),
        },
        {
          kind: "edge-contrast-overlay",
          name: `edge-contrast-reviewer-aid-${zoomPercent}.png`,
          purpose: "reviewer-aid-only-edge-and-contrast-visualization",
          raw: scaleNearestRgba(edgeAid, candidate.sourceRect.width, candidate.sourceRect.height, scale),
        },
      ];
      for (const variant of variants) {
        await addPng({
          candidateId: candidate.id,
          height,
          kind: variant.kind,
          path: `${CANDIDATE_EVIDENCE_DIRECTORY}/candidates/${candidate.id}/${variant.name}`,
          purpose: variant.purpose,
          raw: variant.raw,
          sourceRect: candidate.sourceRect,
          width,
          zoomPercent,
        });
      }
    }
  }

  for (const zoomPercent of REVIEW_EVIDENCE_LIMITS.zoomPercent) {
    const scale = zoomPercent / 100;
    const tileEntries = candidates.map((candidate) => {
      const scaledCrop = scaleNearestRgba(
        baseCrops.get(candidate.id),
        candidate.sourceRect.width,
        candidate.sourceRect.height,
        scale,
      );
      return Object.freeze({
        candidate,
        tile: createContactTile(candidate, scaledCrop, zoomPercent),
      });
    });
    const tileByCandidateId = new Map(
      tileEntries.map(({ candidate, tile }) => [candidate.id, tile]),
    );
    const pages = planContactPages(tileEntries, zoomPercent);
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex];
      await addPng({
        height: page.height,
        kind: "contact-sheet",
        path: `${CANDIDATE_EVIDENCE_DIRECTORY}/contact-sheets/contact-sheet-${zoomPercent}-${String(pageIndex + 1).padStart(3, "0")}.png`,
        placements: page.placements,
        purpose: "reviewer-aid-only-candidate-contact-sheet",
        raw: renderContactPage(page, tileByCandidateId),
        width: page.width,
        zoomPercent,
      });
    }
  }

  artifactRecords.sort((left, right) => left.path.localeCompare(right.path, "en"));
  outputs.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const candidateInventorySha256 = sha256(serializeCanonicalJson(candidates));
  const index = canonicalizeJson({
    artifactCount: artifactRecords.length,
    artifacts: artifactRecords,
    authoring: {
      byteLength: declaredAuthoring.byteLength,
      candidateInventorySha256,
      path: declaredAuthoring.path,
      sha256: declaredAuthoring.sha256,
    },
    candidates: candidates.map((candidate) => ({
      artifactPaths: artifactRecords
        .filter(({ candidateId }) => candidateId === candidate.id)
        .map(({ path }) => path),
      authoredDisposition: candidate.disposition,
      authoredPossibleClasses: candidate.possibleClasses,
      id: candidate.id,
      sourceRect: candidate.sourceRect,
      statusChanged: false,
      uncertaintyNotes: candidate.uncertaintyNotes,
    })),
    canonicalMaster: {
      byteLength: declaredSource.byteLength,
      height: sourceHeight,
      mediaType: "image/png",
      path: declaredSource.path,
      sha256: declaredSource.sha256,
      width: sourceWidth,
    },
    generator: {
      deterministic: true,
      name: GENERATOR_NAME,
      networkAccess: "disabled",
      sharpVersion: sharp.versions.sharp,
      version: GENERATOR_VERSION,
      vipsVersion: sharp.versions.vips,
    },
    outputSetSha256: outputFingerprint(artifactRecords),
    reviewPolicy: {
      approvalMutation: false,
      edgeContrastClassification: "reviewer-aid-only",
      evidenceOnly: true,
      notice: REVIEWER_AID_NOTICE,
      semanticInference: false,
      statusMutation: false,
      zoomPercent: REVIEW_EVIDENCE_LIMITS.zoomPercent,
    },
    schemaVersion: 1,
    sourceCoordinateSpace: {
      height: sourceHeight,
      width: sourceWidth,
    },
  });
  const indexBytes = serializeCanonicalJsonLine(index);
  const indexPath = artifactPath(CANDIDATE_EVIDENCE_INDEX_PATH);
  outputs.push(Object.freeze({ bytes: indexBytes, path: indexPath }));

  return Object.freeze({
    artifactRecords: Object.freeze([...artifactRecords]),
    index,
    indexIdentity: Object.freeze({
      byteLength: indexBytes.byteLength,
      path: indexPath,
      sha256: sha256(indexBytes),
    }),
    outputs: Object.freeze(outputs),
  });
}

export const generateCandidateReviewEvidence = renderCandidateReviewEvidence;

export function isCandidateEvidencePath(value) {
  if (typeof value !== "string") return false;
  try {
    const normalized = artifactPath(value);
    return normalized === CANDIDATE_EVIDENCE_INDEX_PATH
      || dirname(normalized).startsWith(CANDIDATE_EVIDENCE_DIRECTORY);
  } catch {
    return false;
  }
}


/**
 * Hash-bound authored-layer evidence is intentionally separate from candidate
 * inspection. Candidate evidence remains a neutral reviewer aid; this index binds
 * only explicitly supplied masks, fills, pivots, and profile declarations.
 */
export const LAYER_REVIEW_EVIDENCE_DIRECTORY =
  `${CANONICAL_PROJECT_PATHS.successorReviewDirectory}/layer-evidence`;
export const LAYER_REVIEW_EVIDENCE_INDEX_PATH =
  `${LAYER_REVIEW_EVIDENCE_DIRECTORY}/index.json`;

export const LAYER_REVIEW_EVIDENCE_LIMITS = Object.freeze({
  maxArtifacts: 1_024,
  maxLayers: 64,
  maxReviewSets: 512,
  maxSingleArtifactPixels: 20_000_000,
  maxTotalOutputPixels: 536_870_912,
  zoomPercent: Object.freeze([100, 200]),
});

const LAYER_EVIDENCE_GENERATOR_NAME = "watch-layer-hash-bound-review-evidence";
const LAYER_EVIDENCE_GENERATOR_VERSION = 1;
const REVIEW_SCOPE_SET = new Set([
  "depth",
  "fidelity",
  "motion",
  "pivot",
  "reconstruction",
  "segmentation",
]);
const LAYER_DISPOSITION_SET = new Set([
  "approved-moving",
  "motion-candidate",
  "static",
]);
const LAYER_EVIDENCE_NOTICE =
  "Masks, fills, pivots, motion, and depth shown here are authored interpretations. Evidence generation records no approval and makes no source-truth claim.";

function layerEvidencePath(value) {
  const normalized = assertSafeProjectRelativePath(value, {
    allowPublic: false,
    allowedRoots: [LAYER_REVIEW_EVIDENCE_DIRECTORY],
  });
  if (normalized === LAYER_REVIEW_EVIDENCE_DIRECTORY) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Layer evidence path must identify a file beneath the evidence directory",
      String(value),
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return normalized;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeLayerEvidence(value) {
  if (
    value === null
    || typeof value !== "object"
    || Object.isFrozen(value)
    || ArrayBuffer.isView(value)
  ) return value;
  for (const child of Object.values(value)) freezeLayerEvidence(child);
  return Object.freeze(value);
}

function layerStableId(value, path) {
  if (typeof value !== "string" || !STABLE_ID_PATTERN.test(value)) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Value must be a stable lowercase kebab-case ID",
      path,
    );
  }
  return value;
}

function layerHash(value, path) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Value must be a lowercase SHA-256 digest",
      path,
    );
  }
  return value;
}

function uniqueSorted(values, path, validate) {
  if (!Array.isArray(values)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Value must be an array", path);
  }
  const result = values.map((value, index) => validate(value, `${path}[${index}]`));
  const unique = new Set(result);
  if (unique.size !== result.length) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Array values must be unique", path);
  }
  return [...result].sort(lexicalCompare);
}

function layerRect(value, width, height, path) {
  return validateRect(value, width, height, path);
}

function rectEqual(left, right) {
  return left !== null
    && right !== null
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function countMaskSamples(data, width, height) {
  let alphaSum = 0;
  let nonZeroPixelCount = 0;
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[y * width + x];
      alphaSum += alpha;
      if (alpha === 0) continue;
      nonZeroPixelCount += 1;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  return Object.freeze({
    alphaSum,
    nonZeroPixelCount,
    tightBounds: maximumX < 0
      ? null
      : Object.freeze({
          height: maximumY - minimumY + 1,
          width: maximumX - minimumX + 1,
          x: minimumX,
          y: minimumY,
        }),
  });
}

async function decodeLayerMaskInput(entry, sourceWidth, sourceHeight, index) {
  const path = `$.masks[${index}]`;
  exactFields(entry, ["bytes", "record"], path);
  if (!isPlainObject(entry.record)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Mask record must be an object", `${path}.record`);
  }
  const record = entry.record;
  layerStableId(record.id, `${path}.record.id`);
  const file = assertSafeProjectRelativePath(record.file, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorMasksDirectory],
  });
  if (!file.endsWith(".png")) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Mask evidence input must be a PNG beneath the authored mask directory",
      `${path}.record.file`,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const bytes = detachedBytes(entry.bytes, `${path}.bytes`);
  inspectPngSignature(bytes, file);
  const digest = sha256(bytes);
  if (digest !== layerHash(record.sha256, `${path}.record.sha256`)) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_IDENTITY_MISMATCH,
      "Mask bytes differ from the authored mask hash",
      file,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  let metadata;
  let decoded;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: sourceWidth * sourceHeight,
      sequentialRead: true,
    }).metadata();
    decoded = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: sourceWidth * sourceHeight,
      sequentialRead: true,
    })
      .greyscale()
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_DECODE_INVALID,
      "Authored mask cannot be decoded within the source-space bounds",
      file,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  if (
    metadata.format !== "png"
    || metadata.width !== sourceWidth
    || metadata.height !== sourceHeight
    || metadata.depth !== "uchar"
    || metadata.channels !== 1
    || metadata.hasAlpha !== false
    || decoded.info.channels !== 1
    || decoded.data.byteLength !== sourceWidth * sourceHeight
  ) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_DECODE_INVALID,
      "Authored mask must be a single-channel 8-bit source-space PNG",
      file,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  const data = Buffer.from(decoded.data);
  const counts = countMaskSamples(data, sourceWidth, sourceHeight);
  if (counts.nonZeroPixelCount === 0) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Authored review masks must contain at least one nonzero sample",
      file,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  if (
    (record.width !== undefined && record.width !== sourceWidth)
    || (record.height !== undefined && record.height !== sourceHeight)
    || (record.nonZeroPixelCount !== undefined
      && record.nonZeroPixelCount !== counts.nonZeroPixelCount)
    || (record.alphaSum !== undefined && record.alphaSum !== counts.alphaSum)
    || (record.tightBounds !== undefined && !rectEqual(record.tightBounds, counts.tightBounds))
  ) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Authored mask metadata differs from decoded mask samples",
      `${path}.record`,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  return freezeLayerEvidence({
    data,
    height: sourceHeight,
    identity: { byteLength: bytes.byteLength, path: file, sha256: digest },
    record: canonicalizeJson(record),
    tightBounds: counts.tightBounds,
    width: sourceWidth,
  });
}

async function decodeLayerFillInput(record, value, sourceWidth, sourceHeight, path) {
  const file = assertSafeProjectRelativePath(record.fillFile, {
    allowPublic: false,
    allowedRoots: [CANONICAL_PROJECT_PATHS.successorReconstructionDirectory],
  });
  if (!file.endsWith(".png")) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
      "Reconstruction evidence input must be a PNG beneath the authored reconstruction directory",
      `${path}.record.fillFile`,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const bytes = detachedBytes(value, `${path}.fillBytes`);
  inspectPngSignature(bytes, file);
  const digest = sha256(bytes);
  if (digest !== layerHash(record.fillSha256, `${path}.record.fillSha256`)) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_IDENTITY_MISMATCH,
      "Reconstruction fill bytes differ from the authored fill hash",
      file,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  let metadata;
  let decoded;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: sourceWidth * sourceHeight,
      sequentialRead: true,
    }).metadata();
    decoded = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: sourceWidth * sourceHeight,
      sequentialRead: true,
    }).raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_DECODE_INVALID,
      "Authored reconstruction fill cannot be decoded within source-space bounds",
      file,
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  if (
    metadata.format !== "png"
    || metadata.width !== sourceWidth
    || metadata.height !== sourceHeight
    || metadata.depth !== "uchar"
    || metadata.channels !== 4
    || metadata.hasAlpha !== true
    || decoded.info.channels !== 4
    || decoded.data.byteLength !== sourceWidth * sourceHeight * 4
  ) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_DECODE_INVALID,
      "Authored reconstruction fill must be an 8-bit RGBA source-space PNG",
      file,
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  return freezeLayerEvidence({
    data: Buffer.from(decoded.data),
    height: sourceHeight,
    identity: { byteLength: bytes.byteLength, path: file, sha256: digest },
    width: sourceWidth,
  });
}

function maskEdge(mask, width, height) {
  const output = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const inside = mask[pixel] !== 0;
      let boundary = false;
      for (let offsetY = -1; offsetY <= 1 && !boundary; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          const sampleInside = sampleX >= 0
            && sampleX < width
            && sampleY >= 0
            && sampleY < height
            && mask[sampleY * width + sampleX] !== 0;
          if (sampleInside !== inside) {
            boundary = true;
            break;
          }
        }
      }
      if (boundary) output[pixel] = 255;
    }
  }
  return output;
}

function unionMaskData(masks, width, height) {
  const output = Buffer.alloc(width * height);
  for (const mask of masks) {
    for (let pixel = 0; pixel < output.byteLength; pixel += 1) {
      output[pixel] = Math.max(output[pixel], mask[pixel]);
    }
  }
  return output;
}

function maskBounds(data, width, height) {
  return countMaskSamples(data, width, height).tightBounds;
}

function paddedLayerRect(rect, padding, width, height) {
  const x = Math.max(0, Math.floor(rect.x - padding));
  const y = Math.max(0, Math.floor(rect.y - padding));
  const right = Math.min(width, Math.ceil(rect.x + rect.width + padding));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height + padding));
  return Object.freeze({ height: bottom - y, width: right - x, x, y });
}

function layerRgbaFromMask(source, mask) {
  const output = Buffer.alloc(source.byteLength);
  for (let pixel = 0; pixel < mask.byteLength; pixel += 1) {
    const offset = pixel * 4;
    const maskAlpha = mask[pixel];
    output[offset] = source[offset];
    output[offset + 1] = source[offset + 1];
    output[offset + 2] = source[offset + 2];
    output[offset + 3] = Math.floor((source[offset + 3] * maskAlpha + 127) / 255);
  }
  return output;
}

function blendRgbaPixel(destination, destinationOffset, source, sourceOffset) {
  const sourceAlpha = source[sourceOffset + 3];
  if (sourceAlpha === 0) return;
  const destinationAlpha = destination[destinationOffset + 3];
  if (sourceAlpha === 255 || destinationAlpha === 0) {
    source.copy(destination, destinationOffset, sourceOffset, sourceOffset + 4);
    return;
  }
  const inverse = 255 - sourceAlpha;
  const alphaNumerator = sourceAlpha * 255 + destinationAlpha * inverse;
  for (let channel = 0; channel < 3; channel += 1) {
    const numerator = source[sourceOffset + channel] * sourceAlpha * 255
      + destination[destinationOffset + channel] * destinationAlpha * inverse;
    destination[destinationOffset + channel] = Math.floor(
      (numerator + Math.floor(alphaNumerator / 2)) / alphaNumerator,
    );
  }
  destination[destinationOffset + 3] = Math.floor((alphaNumerator + 127) / 255);
}

function transformLayer(source, mask, width, height, transform) {
  const output = Buffer.alloc(source.byteLength);
  const outputMask = Buffer.alloc(mask.byteLength);
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  const inverseScale = 1 / transform.scale;
  for (let destinationY = 0; destinationY < height; destinationY += 1) {
    for (let destinationX = 0; destinationX < width; destinationX += 1) {
      const translatedX = destinationX + 0.5 - transform.translateX - transform.pivot.x;
      const translatedY = destinationY + 0.5 - transform.translateY - transform.pivot.y;
      const sourceX = (cosine * translatedX + sine * translatedY) * inverseScale
        + transform.pivot.x;
      const sourceY = (-sine * translatedX + cosine * translatedY) * inverseScale
        + transform.pivot.y;
      const sampleX = Math.floor(sourceX);
      const sampleY = Math.floor(sourceY);
      if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) continue;
      const sourcePixel = sampleY * width + sampleX;
      const destinationPixel = destinationY * width + destinationX;
      source.copy(output, destinationPixel * 4, sourcePixel * 4, sourcePixel * 4 + 4);
      outputMask[destinationPixel] = mask[sourcePixel];
    }
  }
  return Object.freeze({ data: output, mask: outputMask });
}

function compositeWholeLayer(background, layer) {
  const output = Buffer.from(background);
  for (let offset = 0; offset < layer.byteLength; offset += 4) {
    blendRgbaPixel(output, offset, layer, offset);
  }
  return output;
}

function reconstructBackground(source, segmentationMask, reconstructions) {
  const background = Buffer.from(source);
  for (const reconstruction of reconstructions) {
    for (let pixel = 0; pixel < reconstruction.regionMask.data.byteLength; pixel += 1) {
      const maskAlpha = reconstruction.regionMask.data[pixel];
      if (maskAlpha === 0) continue;
      const sourceOffset = pixel * 4;
      const authored = Buffer.from(reconstruction.fill.data.subarray(sourceOffset, sourceOffset + 4));
      authored[3] = Math.floor((authored[3] * maskAlpha + 127) / 255);
      blendRgbaPixel(background, sourceOffset, authored, 0);
    }
  }
  const regionMasks = reconstructions.map(({ regionMask }) => regionMask.data);
  return Object.freeze({
    data: background,
    reconstructionMask: regionMasks.length === 0
      ? Buffer.alloc(segmentationMask.byteLength)
      : unionMaskData(regionMasks, reconstructions[0].regionMask.width, reconstructions[0].regionMask.height),
  });
}

function sourceCrop(data, width, rect) {
  return extractRgba(data, width, rect);
}

function createMaskAlphaVisual(source, mask, width, rect) {
  const crop = sourceCrop(source, width, rect);
  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const sourcePixel = (rect.y + localY) * width + rect.x + localX;
      const alpha = mask[sourcePixel];
      const offset = (localY * rect.width + localX) * 4;
      crop[offset] = alpha;
      crop[offset + 1] = alpha;
      crop[offset + 2] = alpha;
      crop[offset + 3] = 255;
    }
  }
  return crop;
}

function createMaskEdgeVisual(source, mask, width, height, rect) {
  const crop = sourceCrop(source, width, rect);
  const edge = maskEdge(mask, width, height);
  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const sourcePixel = (rect.y + localY) * width + rect.x + localX;
      const offset = (localY * rect.width + localX) * 4;
      if (edge[sourcePixel] !== 0) {
        crop[offset] = 255;
        crop[offset + 1] = 0;
        crop[offset + 2] = 255;
      } else if (mask[sourcePixel] !== 0) {
        crop[offset] = Math.floor((crop[offset] + 0) / 2);
        crop[offset + 1] = Math.floor((crop[offset + 1] + 220) / 2);
        crop[offset + 2] = Math.floor((crop[offset + 2] + 255) / 2);
      } else {
        crop[offset] = Math.floor(crop[offset] / 2);
        crop[offset + 1] = Math.floor(crop[offset + 1] / 2);
        crop[offset + 2] = Math.floor(crop[offset + 2] / 2);
      }
      crop[offset + 3] = 255;
    }
  }
  return crop;
}

function createApprovedChangeVisual(source, approvedChangeMask, width, rect) {
  const crop = sourceCrop(source, width, rect);
  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const sourcePixel = (rect.y + localY) * width + rect.x + localX;
      const offset = (localY * rect.width + localX) * 4;
      if (approvedChangeMask[sourcePixel] !== 0) {
        crop[offset] = Math.floor((crop[offset] + 255) / 2);
        crop[offset + 1] = Math.floor((crop[offset + 1] + 150) / 2);
        crop[offset + 2] = Math.floor(crop[offset + 2] / 2);
      } else {
        crop[offset] = Math.floor(crop[offset] / 3);
        crop[offset + 1] = Math.floor(crop[offset + 1] / 3);
        crop[offset + 2] = Math.floor(crop[offset + 2] / 3);
      }
      crop[offset + 3] = 255;
    }
  }
  return crop;
}

function createResidualSilhouetteVisual(source, reconstructed, footprintMask, width, rect) {
  const output = sourceCrop(reconstructed, width, rect);
  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const sourcePixel = (rect.y + localY) * width + rect.x + localX;
      const offset = (localY * rect.width + localX) * 4;
      if (footprintMask[sourcePixel] === 0) {
        output[offset] = Math.floor(output[offset] / 3);
        output[offset + 1] = Math.floor(output[offset + 1] / 3);
        output[offset + 2] = Math.floor(output[offset + 2] / 3);
      } else {
        const sourceOffset = sourcePixel * 4;
        const difference = Math.max(
          Math.abs(source[sourceOffset] - reconstructed[sourceOffset]),
          Math.abs(source[sourceOffset + 1] - reconstructed[sourceOffset + 1]),
          Math.abs(source[sourceOffset + 2] - reconstructed[sourceOffset + 2]),
          Math.abs(source[sourceOffset + 3] - reconstructed[sourceOffset + 3]),
        );
        if (difference <= 8) {
          output[offset] = 255;
          output[offset + 1] = 24;
          output[offset + 2] = 24;
        } else {
          output[offset] = Math.min(255, difference * 2);
          output[offset + 1] = 255;
          output[offset + 2] = 48;
        }
      }
      output[offset + 3] = 255;
    }
  }
  return output;
}

function createVerticalComparison(source, reconstructed, width, rect) {
  const top = sourceCrop(source, width, rect);
  const bottom = sourceCrop(reconstructed, width, rect);
  const outputHeight = rect.height * 2 + 1;
  const output = Buffer.alloc(rect.width * outputHeight * 4);
  top.copy(output, 0);
  fillRect(output, rect.width, outputHeight, 0, rect.height, rect.width, 1, [255, 255, 255, 255]);
  bottom.copy(output, rect.width * (rect.height + 1) * 4);
  return Object.freeze({ data: output, height: outputHeight, width: rect.width });
}

function createPivotVisual(source, width, rect, pivot) {
  const output = sourceCrop(source, width, rect);
  const x = Math.round(pivot.x - rect.x);
  const y = Math.round(pivot.y - rect.y);
  fillRect(output, rect.width, rect.height, x - 7, y - 1, 15, 3, [255, 32, 32, 255]);
  fillRect(output, rect.width, rect.height, x - 1, y - 7, 3, 15, [255, 32, 32, 255]);
  fillRect(output, rect.width, rect.height, x - 2, y - 2, 5, 5, [255, 255, 255, 255]);
  fillRect(output, rect.width, rect.height, x - 1, y - 1, 3, 3, [0, 0, 0, 255]);
  return output;
}

function normalizeLayerRecord(record, sourceWidth, sourceHeight, index) {
  const path = `$.layers[${index}]`;
  if (!isPlainObject(record)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer must be a plain object", path);
  }
  const id = layerStableId(record.id, `${path}.id`);
  if (typeof record.semanticClass !== "string" || !SEMANTIC_CLASS_SET.has(record.semanticClass)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer semantic class is invalid", `${path}.semanticClass`);
  }
  if (!LAYER_DISPOSITION_SET.has(record.disposition)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer disposition is invalid", `${path}.disposition`);
  }
  layerStableId(record.segmentationMaskId, `${path}.segmentationMaskId`);
  if (!Number.isSafeInteger(record.zOrder)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer z-order must be a safe integer", `${path}.zOrder`);
  }
  const sourceRect = layerRect(record.sourceRect, sourceWidth, sourceHeight, `${path}.sourceRect`);
  const approvalIds = uniqueSorted(record.approvalIds ?? [], `${path}.approvalIds`, layerStableId);
  let pivot = null;
  if (record.pivot !== undefined) {
    if (!isPlainObject(record.pivot) || !Number.isFinite(record.pivot.x) || !Number.isFinite(record.pivot.y)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer pivot must be a finite source point", `${path}.pivot`);
    }
    if (
      record.pivot.x < sourceRect.x
      || record.pivot.x >= sourceRect.x + sourceRect.width
      || record.pivot.y < sourceRect.y
      || record.pivot.y >= sourceRect.y + sourceRect.height
    ) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer pivot must lie inside sourceRect", `${path}.pivot`);
    }
    pivot = Object.freeze({ x: record.pivot.x, y: record.pivot.y });
  }
  return freezeLayerEvidence({
    ...canonicalizeJson(record),
    approvalIds,
    id,
    pivot,
    sourceRect,
  });
}

function normalizeMotionProfile(profile, layer, index) {
  const path = `$.motionProfiles[${index}]`;
  if (!isPlainObject(profile)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Motion profile must be a plain object", path);
  }
  layerStableId(profile.id, `${path}.id`);
  if (profile.layerId !== layer.id) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Motion profile layerId must match its layer", `${path}.layerId`);
  }
  if (!layer.pivot || !isPlainObject(profile.pivot)
    || profile.pivot.x !== layer.pivot.x || profile.pivot.y !== layer.pivot.y) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Motion profile pivot must exactly match the layer pivot", `${path}.pivot`);
  }
  for (const field of ["minRadians", "maxRadians", "referenceRadians"]) {
    if (!Number.isFinite(profile[field])) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Motion angles must be finite", `${path}.${field}`);
    }
  }
  if (profile.minRadians > profile.referenceRadians || profile.referenceRadians > profile.maxRadians) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Motion bounds must contain the reference pose", path);
  }
  if (!["continuous-rotation", "discrete-rotation", "oscillation"].includes(profile.kind)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Motion kind is invalid", `${path}.kind`);
  }
  return freezeLayerEvidence(canonicalizeJson(profile));
}

function poseTransform({
  pivot,
  rotationRadians = 0,
  scale = 1,
  translateX = 0,
  translateY = 0,
}) {
  if (
    !pivot
    || !Number.isFinite(rotationRadians)
    || !Number.isFinite(scale)
    || scale <= 0
    || !Number.isFinite(translateX)
    || !Number.isFinite(translateY)
  ) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Pose transform must be finite and nondegenerate", "$.pose");
  }
  return Object.freeze({ pivot, rotationRadians, scale, translateX, translateY });
}

function createLayerPoses(layer, motionProfile, depthProfiles, sourceWidth, sourceHeight) {
  const defaultPivot = layer.pivot ?? Object.freeze({
    x: layer.sourceRect.x + layer.sourceRect.width / 2,
    y: layer.sourceRect.y + layer.sourceRect.height / 2,
  });
  const layerProjectionSha256 = sha256(serializeCanonicalJson(layer));
  const poses = [{
    enabled: true,
    id: "reference-pose",
    kind: "reference",
    profileId: null,
    projectionSha256: [layerProjectionSha256],
    transform: poseTransform({ pivot: defaultPivot }),
  }];
  if (motionProfile !== null) {
    const profileSha256 = sha256(serializeCanonicalJson(motionProfile));
    for (const [suffix, angle] of [
      ["minimum", motionProfile.minRadians],
      ["maximum", motionProfile.maxRadians],
    ]) {
      poses.push({
        enabled: true,
        id: `${motionProfile.id}-${suffix}`,
        kind: "motion-extreme",
        profileId: motionProfile.id,
        projectionSha256: [layerProjectionSha256, profileSha256],
        transform: poseTransform({
          pivot: layer.pivot,
          rotationRadians: angle - motionProfile.referenceRadians,
        }),
      });
    }
  }
  const shorterAxis = Math.min(sourceWidth, sourceHeight);
  for (const profile of depthProfiles) {
    const value = profile.layers.find(({ layerId }) => layerId === layer.id);
    if (value === undefined) continue;
    const profileSha256 = sha256(serializeCanonicalJson(profile));
    for (const [suffix, direction] of [["minimum", -1], ["maximum", 1]]) {
      poses.push({
        enabled: profile.enabled === true,
        id: `${profile.id}-${suffix}`,
        kind: "depth-extreme",
        profileId: profile.id,
        projectionSha256: [layerProjectionSha256, profileSha256],
        transform: poseTransform({
          pivot: defaultPivot,
          rotationRadians: direction * value.rotationDegrees * Math.PI / 180,
          scale: 1 + direction * value.scaleDelta,
          translateX: direction * value.displacementShortAxisFraction * shorterAxis,
        }),
      });
    }
  }
  const ids = new Set();
  for (const pose of poses) {
    layerStableId(pose.id, `$.poses.${pose.id}`);
    if (ids.has(pose.id)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, `Duplicate pose ID ${pose.id}`, "$.poses");
    }
    ids.add(pose.id);
  }
  return poses.map((pose) => freezeLayerEvidence(pose));
}

function bindingProjection(reviewSet) {
  return {
    artifactPaths: reviewSet.artifactPaths,
    evidenceSha256: reviewSet.evidenceSha256,
    id: reviewSet.id,
    inputFiles: reviewSet.inputFiles,
    layerIds: reviewSet.layerIds,
    poseIds: reviewSet.poseIds,
    projectionSha256: reviewSet.projectionSha256,
    scope: reviewSet.scope,
    zoomPercent: reviewSet.zoomPercent,
  };
}

function createReviewSet({
  artifactRecords,
  id,
  inputFiles,
  layerIds,
  poseIds,
  projectionSha256,
  scope,
  zoomPercent,
}) {
  layerStableId(id, `$.reviewSets.${id}.id`);
  if (!REVIEW_SCOPE_SET.has(scope)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review set scope is invalid", `$.reviewSets.${id}.scope`);
  }
  const artifacts = [...artifactRecords].sort((left, right) => lexicalCompare(left.path, right.path));
  if (artifacts.length === 0) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review set must contain evidence artifacts", `$.reviewSets.${id}`);
  }
  const core = canonicalizeJson({
    artifactPaths: artifacts.map(({ path }) => path),
    evidenceSha256: [...new Set(artifacts.map(({ sha256: digest }) => digest))].sort(lexicalCompare),
    id,
    inputFiles: [...inputFiles]
      .map((identity) => canonicalizeJson(identity))
      .sort((left, right) => lexicalCompare(left.path, right.path)),
    layerIds: uniqueSorted(layerIds, `$.reviewSets.${id}.layerIds`, layerStableId),
    poseIds: uniqueSorted(poseIds, `$.reviewSets.${id}.poseIds`, layerStableId),
    projectionSha256: uniqueSorted(
      projectionSha256,
      `$.reviewSets.${id}.projectionSha256`,
      layerHash,
    ),
    scope,
    zoomPercent: [...new Set(zoomPercent)].sort((left, right) => left - right),
  });
  if (
    core.poseIds.length === 0
    || core.zoomPercent.length === 0
    || core.zoomPercent.some((zoom) => zoom !== 100 && zoom !== 200)
  ) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review set must bind poses and 100%/200% evidence", `$.reviewSets.${id}`);
  }
  return canonicalizeJson({
    ...core,
    bindingSha256: sha256(serializeCanonicalJson(bindingProjection(core))),
  });
}

function artifactMatches(record, {
  kinds = null,
  poseIds = null,
  profileId = undefined,
  zoomPercent = null,
} = {}) {
  return (kinds === null || kinds.includes(record.kind))
    && (poseIds === null || poseIds.includes(record.poseId))
    && (profileId === undefined || record.profileId === profileId)
    && (zoomPercent === null || zoomPercent.includes(record.zoomPercent));
}

/**
 * Render deterministic authored-layer review evidence entirely in memory.
 * Missing visual inputs are never manufactured: callers must supply exact mask and
 * fill bytes referenced by the explicit records. Empty layers are a valid static
 * outcome and produce an empty, canonical evidence index.
 */
export async function renderLayerReviewEvidence({
  authoringIdentity,
  depthProfiles = [],
  layers = [],
  masks = [],
  motionProfiles = [],
  reconstructions = [],
  sourceBytes,
  sourceHeight = CANONICAL_SOURCE_COORDINATE_SPACE.height,
  sourceIdentity,
  sourceWidth = CANONICAL_SOURCE_COORDINATE_SPACE.width,
} = {}) {
  assertPositiveInteger(sourceWidth, "$.sourceWidth");
  assertPositiveInteger(sourceHeight, "$.sourceHeight");
  if (sourceWidth * sourceHeight > CANONICAL_SOURCE_COORDINATE_SPACE.width * CANONICAL_SOURCE_COORDINATE_SPACE.height) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
      "Layer evidence source dimensions exceed the canonical finite bound",
      "$.sourceCoordinateSpace",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
  const declaredSource = validateIdentity(sourceIdentity, "$.sourceIdentity");
  const declaredAuthoring = validateIdentity(authoringIdentity, "$.authoringIdentity");
  const bytes = detachedBytes(sourceBytes, "$.sourceBytes");
  if (bytes.byteLength !== declaredSource.byteLength || sha256(bytes) !== declaredSource.sha256) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.SOURCE_IDENTITY_MISMATCH,
      "Source bytes differ from the declared source identity",
      declaredSource.path,
      LAYER_GATE_FAILURE_CODES.IDENTITY_MISMATCH,
    );
  }
  if (!Array.isArray(layers) || layers.length > LAYER_REVIEW_EVIDENCE_LIMITS.maxLayers) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
      `Layer evidence accepts at most ${LAYER_REVIEW_EVIDENCE_LIMITS.maxLayers} layers`,
      "$.layers",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
  if (!Array.isArray(masks) || !Array.isArray(reconstructions)
    || !Array.isArray(motionProfiles) || !Array.isArray(depthProfiles)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Authored layer evidence collections must be arrays", "$");
  }

  const source = await decodeSourceRgba(bytes, sourceWidth, sourceHeight, declaredSource.path);
  const decodedMasks = await Promise.all(masks.map((entry, index) => (
    decodeLayerMaskInput(entry, sourceWidth, sourceHeight, index)
  )));
  const maskById = new Map();
  for (const mask of decodedMasks) {
    if (maskById.has(mask.record.id)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, `Duplicate mask ID ${mask.record.id}`, "$.masks");
    }
    maskById.set(mask.record.id, mask);
  }

  const decodedReconstructions = [];
  for (let index = 0; index < reconstructions.length; index += 1) {
    const path = `$.reconstructions[${index}]`;
    const entry = reconstructions[index];
    exactFields(entry, ["fillBytes", "record"], path);
    const record = entry.record;
    if (!isPlainObject(record)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Reconstruction record must be an object", `${path}.record`);
    }
    for (const field of ["id", "fillId", "regionMaskId", "boundaryMaskId", "approvalId"]) {
      layerStableId(record[field], `${path}.record.${field}`);
    }
    const regionMask = maskById.get(record.regionMaskId);
    const boundaryMask = maskById.get(record.boundaryMaskId);
    if (regionMask === undefined || boundaryMask === undefined) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
        "Reconstruction evidence requires its exact region and boundary masks",
        `${path}.record`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
    const fill = await decodeLayerFillInput(
      record,
      entry.fillBytes,
      sourceWidth,
      sourceHeight,
      path,
    );
    decodedReconstructions.push(freezeLayerEvidence({
      boundaryMask,
      fill,
      record: canonicalizeJson(record),
      regionMask,
    }));
  }

  const normalizedLayers = layers.map((record, index) => (
    normalizeLayerRecord(record, sourceWidth, sourceHeight, index)
  ));
  const layerIds = new Set();
  const zOrders = new Set();
  for (const layer of normalizedLayers) {
    if (layerIds.has(layer.id) || zOrders.has(layer.zOrder)) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
        "Layer IDs and z-orders must each be unique",
        `$.layers.${layer.id}`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    layerIds.add(layer.id);
    zOrders.add(layer.zOrder);
  }
  const motionIds = new Set();
  const depthIds = new Set();
  for (const profile of motionProfiles) {
    layerStableId(profile.id, "$.motionProfiles.id");
    if (motionIds.has(profile.id)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, `Duplicate motion profile ${profile.id}`, "$.motionProfiles");
    }
    motionIds.add(profile.id);
  }
  for (const profile of depthProfiles) {
    if (!isPlainObject(profile)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Depth profile must be an object", "$.depthProfiles");
    }
    layerStableId(profile.id, "$.depthProfiles.id");
    if (depthIds.has(profile.id) || !Array.isArray(profile.layers)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, `Duplicate or malformed depth profile ${profile.id}`, "$.depthProfiles");
    }
    depthIds.add(profile.id);
  }

  const outputs = [];
  const artifactRecords = [];
  const reviewSets = [];
  let totalOutputPixels = 0;

  async function addLayerPng({
    inputSha256,
    kind,
    layerId,
    panelLayout = "single",
    poseId = null,
    profileId = null,
    purpose,
    raw,
    sourceRect,
    width,
    height,
    zoomPercent,
  }) {
    const pathParts = [kind];
    if (poseId !== null) pathParts.push(poseId);
    pathParts.push(String(zoomPercent));
    const path = layerEvidencePath(
      `${LAYER_REVIEW_EVIDENCE_DIRECTORY}/layers/${layerId}/${pathParts.join("-")}.png`,
    );
    const pixels = width * height;
    if (
      !Number.isSafeInteger(pixels)
      || width < 1
      || height < 1
      || width > REVIEW_EVIDENCE_LIMITS.maxContactSheetDimension
      || height > REVIEW_EVIDENCE_LIMITS.maxContactSheetDimension
      || pixels > LAYER_REVIEW_EVIDENCE_LIMITS.maxSingleArtifactPixels
    ) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
        "Layer evidence artifact exceeds finite dimensions",
        path,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      );
    }
    totalOutputPixels += pixels;
    if (
      totalOutputPixels > LAYER_REVIEW_EVIDENCE_LIMITS.maxTotalOutputPixels
      || artifactRecords.length >= LAYER_REVIEW_EVIDENCE_LIMITS.maxArtifacts
    ) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
        "Layer evidence exceeds finite aggregate output limits",
        path,
        LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      );
    }
    const png = await encodeDeterministicPng(raw, width, height, path);
    const record = {
      byteLength: png.byteLength,
      height,
      inputSha256: [...new Set(inputSha256)].sort(lexicalCompare),
      kind,
      layerId,
      mediaType: "image/png",
      panelLayout,
      path,
      poseId,
      profileId,
      purpose,
      reviewerAid: true,
      reviewSetIds: [],
      semanticInference: false,
      sha256: sha256(png),
      sourceRect,
      syntheticTruthClaim: false,
      width,
      zoomPercent,
    };
    artifactRecords.push(record);
    outputs.push(Object.freeze({ bytes: png, path }));
    return record;
  }

  for (const layer of normalizedLayers.sort((left, right) => (
    left.zOrder - right.zOrder || lexicalCompare(left.id, right.id)
  ))) {
    const segmentationMask = maskById.get(layer.segmentationMaskId);
    if (segmentationMask === undefined) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
        "Layer evidence requires the exact referenced segmentation mask",
        `$.layers.${layer.id}.segmentationMaskId`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    const associatedReconstructions = decodedReconstructions.filter(({ record }) => (
      layer.approvalIds.includes(record.approvalId)
    ));
    const motionMatches = motionProfiles
      .map((profile, index) => ({ index, profile }))
      .filter(({ profile }) => profile.layerId === layer.id);
    if (motionMatches.length > 1) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer has more than one motion profile", `$.layers.${layer.id}`);
    }
    const motionProfile = motionMatches.length === 0
      ? null
      : normalizeMotionProfile(motionMatches[0].profile, layer, motionMatches[0].index);
    if (layer.motionProfileId !== undefined
      && (motionProfile === null || motionProfile.id !== layer.motionProfileId)) {
      fail(
        REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID,
        "Layer motionProfileId requires the exact declared profile",
        `$.layers.${layer.id}.motionProfileId`,
      );
    }
    const applicableDepthProfiles = depthProfiles.filter((profile) => (
      profile.layers.some(({ layerId: valueLayerId }) => valueLayerId === layer.id)
    )).map((profile) => freezeLayerEvidence(canonicalizeJson(profile)));
    const poses = createLayerPoses(
      layer,
      motionProfile,
      applicableDepthProfiles,
      sourceWidth,
      sourceHeight,
    );
    const rawLayer = layerRgbaFromMask(source, segmentationMask.data);
    const reconstructed = reconstructBackground(source, segmentationMask.data, associatedReconstructions);
    const renderedPoses = poses.map((pose) => {
      const transformed = transformLayer(
        rawLayer,
        segmentationMask.data,
        sourceWidth,
        sourceHeight,
        pose.transform,
      );
      return freezeLayerEvidence({
        ...pose,
        image: compositeWholeLayer(reconstructed.data, transformed.data),
        mask: transformed.mask,
      });
    });
    const edge = maskEdge(segmentationMask.data, sourceWidth, sourceHeight);
    const changeMasks = [edge, reconstructed.reconstructionMask, ...renderedPoses.map(({ mask }) => mask)];
    const approvedChangeMask = unionMaskData(changeMasks, sourceWidth, sourceHeight);
    const reviewBounds = maskBounds(approvedChangeMask, sourceWidth, sourceHeight) ?? layer.sourceRect;
    const reviewRect = paddedLayerRect(reviewBounds, 4, sourceWidth, sourceHeight);
    const layerProjectionSha256 = sha256(serializeCanonicalJson(layer));
    const pivotProjectionSha256 = layer.pivot === null
      ? null
      : sha256(serializeCanonicalJson({ layerId: layer.id, pivot: layer.pivot }));
    const reconstructionProjectionSha256 = associatedReconstructions.flatMap(({
      boundaryMask,
      fill,
      regionMask,
    }) => [
      boundaryMask.identity.sha256,
      fill.identity.sha256,
      regionMask.identity.sha256,
    ]);
    const motionProjectionSha256 = motionProfile === null
      ? []
      : [sha256(serializeCanonicalJson(motionProfile))];
    const depthProjectionById = new Map(applicableDepthProfiles.map((profile) => [
      profile.id,
      sha256(serializeCanonicalJson(profile)),
    ]));
    const commonInputFiles = [
      declaredAuthoring,
      declaredSource,
      segmentationMask.identity,
      ...associatedReconstructions.flatMap(({ boundaryMask, fill, regionMask }) => [
        boundaryMask.identity,
        fill.identity,
        regionMask.identity,
      ]),
    ].filter((identity, index, all) => (
      all.findIndex(({ path }) => path === identity.path) === index
    )).sort((left, right) => lexicalCompare(left.path, right.path));
    const commonInputSha256 = [
      ...commonInputFiles.map(({ sha256: digest }) => digest),
      layerProjectionSha256,
      ...reconstructionProjectionSha256,
    ];

    const layerArtifacts = [];
    const emitScaled = async ({ baseData, baseHeight = reviewRect.height, baseWidth = reviewRect.width, ...options }) => {
      for (const zoomPercent of options.zoomPercent) {
        const scale = zoomPercent / 100;
        const record = await addLayerPng({
          ...options,
          height: baseHeight * scale,
          inputSha256: options.inputSha256,
          raw: scaleNearestRgba(baseData, baseWidth, baseHeight, scale),
          sourceRect: reviewRect,
          width: baseWidth * scale,
          zoomPercent,
        });
        layerArtifacts.push(record);
      }
    };

    await emitScaled({
      baseData: createMaskAlphaVisual(source, segmentationMask.data, sourceWidth, reviewRect),
      inputSha256: [...commonInputSha256],
      kind: "segmentation-mask-alpha",
      layerId: layer.id,
      purpose: "exact-authored-segmentation-alpha",
      zoomPercent: [200],
    });
    await emitScaled({
      baseData: createMaskEdgeVisual(
        source,
        segmentationMask.data,
        sourceWidth,
        sourceHeight,
        reviewRect,
      ),
      inputSha256: [...commonInputSha256],
      kind: "exact-mask-edge",
      layerId: layer.id,
      purpose: "exact-nonzero-mask-boundary-over-source",
      zoomPercent: [200],
    });
    if (associatedReconstructions.length !== 0) {
      const comparison = createVerticalComparison(source, reconstructed.data, sourceWidth, reviewRect);
      await emitScaled({
        baseData: comparison.data,
        baseHeight: comparison.height,
        baseWidth: comparison.width,
        inputSha256: [...commonInputSha256],
        kind: "source-reconstructed-comparison",
        layerId: layer.id,
        panelLayout: "source-top-reconstructed-bottom",
        purpose: "source-and-authored-reconstructed-background-comparison",
        zoomPercent: [100, 200],
      });
      await emitScaled({
        baseData: createResidualSilhouetteVisual(
          source,
          reconstructed.data,
          segmentationMask.data,
          sourceWidth,
          reviewRect,
        ),
        inputSha256: [...commonInputSha256],
        kind: "residual-silhouette-diagnostic",
        layerId: layer.id,
        purpose: "reviewer-aid-only-residual-source-footprint-diagnostic",
        zoomPercent: [100, 200],
      });
    }
    await emitScaled({
      baseData: createApprovedChangeVisual(source, approvedChangeMask, sourceWidth, reviewRect),
      inputSha256: [
        ...commonInputSha256,
        ...motionProjectionSha256,
        ...depthProjectionById.values(),
      ],
      kind: "approved-change-overlay",
      layerId: layer.id,
      purpose: "declared-pose-sweep-edge-and-reconstruction-union",
      zoomPercent: [100, 200],
    });
    if (layer.pivot !== null) {
      await emitScaled({
        baseData: createPivotVisual(source, sourceWidth, reviewRect, layer.pivot),
        inputSha256: [...commonInputSha256, pivotProjectionSha256],
        kind: "pivot-marker",
        layerId: layer.id,
        purpose: "exact-authored-source-coordinate-pivot",
        zoomPercent: [200],
      });
    }
    for (const pose of renderedPoses) {
      await emitScaled({
        baseData: sourceCrop(pose.image, sourceWidth, reviewRect),
        inputSha256: [...commonInputSha256, ...pose.projectionSha256],
        kind: pose.kind === "reference" ? "reference-pose" : "extreme-pose",
        layerId: layer.id,
        poseId: pose.id,
        profileId: pose.profileId,
        purpose: pose.kind === "reference"
          ? "authored-layer-reference-pose"
          : `declared-${pose.kind}`,
        zoomPercent: [100, 200],
      });
    }

    const referencePoseIds = ["reference-pose"];
    const allPoseIds = renderedPoses.map(({ id }) => id);
    const poseArtifacts = layerArtifacts.filter((record) => (
      ["reference-pose", "extreme-pose"].includes(record.kind)
    ));
    const segmentationArtifacts = layerArtifacts.filter((record) => (
      artifactMatches(record, {
        kinds: ["segmentation-mask-alpha", "exact-mask-edge", "reference-pose"],
        zoomPercent: [200],
      })
    ));
    reviewSets.push(createReviewSet({
      artifactRecords: segmentationArtifacts,
      id: `${layer.id}-segmentation`,
      inputFiles: [declaredAuthoring, declaredSource, segmentationMask.identity],
      layerIds: [layer.id],
      poseIds: referencePoseIds,
      projectionSha256: [layerProjectionSha256],
      scope: "segmentation",
      zoomPercent: [200],
    }));

    if (layer.pivot !== null) {
      const pivotArtifacts = layerArtifacts.filter((record) => (
        artifactMatches(record, {
          kinds: ["pivot-marker", "reference-pose", "extreme-pose"],
          poseIds: [null, ...allPoseIds.filter((id) => (
            id === "reference-pose" || id.startsWith(`${motionProfile?.id ?? "no-motion"}-`)
          ))],
          zoomPercent: [200],
        })
      ));
      reviewSets.push(createReviewSet({
        artifactRecords: pivotArtifacts,
        id: `${layer.id}-pivot`,
        inputFiles: [declaredAuthoring, declaredSource, segmentationMask.identity],
        layerIds: [layer.id],
        poseIds: motionProfile === null
          ? referencePoseIds
          : ["reference-pose", `${motionProfile.id}-minimum`, `${motionProfile.id}-maximum`],
        projectionSha256: [layerProjectionSha256, pivotProjectionSha256],
        scope: "pivot",
        zoomPercent: [200],
      }));
    }

    if (associatedReconstructions.length !== 0) {
      reviewSets.push(createReviewSet({
        artifactRecords: layerArtifacts.filter((record) => (
          [
            "approved-change-overlay",
            "extreme-pose",
            "reference-pose",
            "residual-silhouette-diagnostic",
            "source-reconstructed-comparison",
          ].includes(record.kind)
        )),
        id: `${layer.id}-reconstruction`,
        inputFiles: commonInputFiles,
        layerIds: [layer.id],
        poseIds: allPoseIds,
        projectionSha256: [layerProjectionSha256, ...reconstructionProjectionSha256],
        scope: "reconstruction",
        zoomPercent: [100, 200],
      }));
    }

    if (motionProfile !== null) {
      const motionPoseIds = [
        "reference-pose",
        `${motionProfile.id}-minimum`,
        `${motionProfile.id}-maximum`,
      ];
      reviewSets.push(createReviewSet({
        artifactRecords: layerArtifacts.filter((record) => (
          record.kind === "approved-change-overlay"
          || record.kind === "pivot-marker"
          || (["reference-pose", "extreme-pose"].includes(record.kind)
            && motionPoseIds.includes(record.poseId))
        )),
        id: `${layer.id}-${motionProfile.id}-motion`,
        inputFiles: commonInputFiles,
        layerIds: [layer.id],
        poseIds: motionPoseIds,
        projectionSha256: [
          layerProjectionSha256,
          pivotProjectionSha256,
          ...motionProjectionSha256,
        ],
        scope: "motion",
        zoomPercent: [100, 200],
      }));
    }

    for (const profile of applicableDepthProfiles) {
      const depthPoseIds = [
        "reference-pose",
        `${profile.id}-minimum`,
        `${profile.id}-maximum`,
      ];
      reviewSets.push(createReviewSet({
        artifactRecords: layerArtifacts.filter((record) => (
          record.kind === "approved-change-overlay"
          || (["reference-pose", "extreme-pose"].includes(record.kind)
            && depthPoseIds.includes(record.poseId))
        )),
        id: `${layer.id}-${profile.id}-depth`,
        inputFiles: commonInputFiles,
        layerIds: [layer.id],
        poseIds: depthPoseIds,
        projectionSha256: [layerProjectionSha256, depthProjectionById.get(profile.id)],
        scope: "depth",
        zoomPercent: [100, 200],
      }));
    }

    reviewSets.push(createReviewSet({
      artifactRecords: [
        ...poseArtifacts,
        ...layerArtifacts.filter(({ kind }) => kind === "approved-change-overlay"),
      ],
      id: `${layer.id}-fidelity`,
      inputFiles: commonInputFiles,
      layerIds: [layer.id],
      poseIds: allPoseIds,
      projectionSha256: [
        layerProjectionSha256,
        ...reconstructionProjectionSha256,
        ...motionProjectionSha256,
        ...depthProjectionById.values(),
      ],
      scope: "fidelity",
      zoomPercent: [100, 200],
    }));

    const layerReviewSetIds = reviewSets
      .filter(({ layerIds: ids }) => ids.includes(layer.id))
      .map(({ id }) => id);
    for (const artifact of layerArtifacts) {
      artifact.reviewSetIds = layerReviewSetIds.filter((reviewSetId) => (
        reviewSets.find(({ id }) => id === reviewSetId).artifactPaths.includes(artifact.path)
      )).sort(lexicalCompare);
    }
  }

  if (reviewSets.length > LAYER_REVIEW_EVIDENCE_LIMITS.maxReviewSets) {
    fail(
      REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
      "Layer evidence exceeds the finite review-set limit",
      "$.reviewSets",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
  artifactRecords.sort((left, right) => lexicalCompare(left.path, right.path));
  reviewSets.sort((left, right) => lexicalCompare(left.id, right.id));
  outputs.sort((left, right) => lexicalCompare(left.path, right.path));
  const canonicalArtifacts = artifactRecords.map((record) => canonicalizeJson(record));
  const index = canonicalizeJson({
    artifactCount: canonicalArtifacts.length,
    artifacts: canonicalArtifacts,
    authoring: declaredAuthoring,
    canonicalMaster: {
      ...declaredSource,
      height: sourceHeight,
      mediaType: "image/png",
      width: sourceWidth,
    },
    generator: {
      depthDisplacementAxis: "canonical-x",
      deterministic: true,
      name: LAYER_EVIDENCE_GENERATOR_NAME,
      networkAccess: "disabled",
      sharpVersion: sharp.versions.sharp,
      version: LAYER_EVIDENCE_GENERATOR_VERSION,
      vipsVersion: sharp.versions.vips,
    },
    outputSetSha256: outputFingerprint(canonicalArtifacts),
    reviewPolicy: {
      approvalMutation: false,
      authoredInterpretationsOnly: true,
      depthActivation: false,
      evidenceOnly: true,
      notice: LAYER_EVIDENCE_NOTICE,
      semanticInference: false,
      statusMutation: false,
      templateDecision: "pending-only",
      zoomPercent: LAYER_REVIEW_EVIDENCE_LIMITS.zoomPercent,
    },
    reviewSetCount: reviewSets.length,
    reviewSets,
    schemaVersion: 1,
    sourceCoordinateSpace: { height: sourceHeight, width: sourceWidth },
  });
  const validatedIndex = validateLayerReviewEvidenceIndex(index);
  const indexBytes = serializeCanonicalJsonLine(validatedIndex);
  const indexPath = layerEvidencePath(LAYER_REVIEW_EVIDENCE_INDEX_PATH);
  outputs.push(Object.freeze({ bytes: indexBytes, path: indexPath }));
  return freezeLayerEvidence({
    artifactRecords: canonicalArtifacts,
    index: validatedIndex,
    indexIdentity: {
      byteLength: indexBytes.byteLength,
      path: indexPath,
      sha256: sha256(indexBytes),
    },
    outputs,
    reviewSets: validatedIndex.reviewSets,
  });
}

export const generateLayerReviewEvidence = renderLayerReviewEvidence;
export const renderHashBoundLayerReviewEvidence = renderLayerReviewEvidence;

/** Validate a canonical layer-evidence index before it is used for approval binding. */
export function validateLayerReviewEvidenceIndex(value) {
  if (!isPlainObject(value)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Layer evidence index must be an object", "$");
  }
  exactFields(value, [
    "artifactCount",
    "artifacts",
    "authoring",
    "canonicalMaster",
    "generator",
    "outputSetSha256",
    "reviewPolicy",
    "reviewSetCount",
    "reviewSets",
    "schemaVersion",
    "sourceCoordinateSpace",
  ], "$index");
  if (value.schemaVersion !== 1
    || !isPlainObject(value.generator)
    || value.generator.name !== LAYER_EVIDENCE_GENERATOR_NAME
    || value.generator.version !== LAYER_EVIDENCE_GENERATOR_VERSION) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Unsupported layer evidence index version", "$index.schemaVersion");
  }
  const sourceWidth = value.sourceCoordinateSpace?.width;
  const sourceHeight = value.sourceCoordinateSpace?.height;
  assertPositiveInteger(sourceWidth, "$index.sourceCoordinateSpace.width");
  assertPositiveInteger(sourceHeight, "$index.sourceCoordinateSpace.height");
  const authoring = validateIdentity(value.authoring, "$index.authoring");
  if (!isPlainObject(value.canonicalMaster)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Index canonicalMaster must be an object", "$index.canonicalMaster");
  }
  const canonicalMaster = validateIdentity({
    byteLength: value.canonicalMaster.byteLength,
    path: value.canonicalMaster.path,
    sha256: value.canonicalMaster.sha256,
  }, "$index.canonicalMaster");
  if (
    value.canonicalMaster.width !== sourceWidth
    || value.canonicalMaster.height !== sourceHeight
    || value.canonicalMaster.mediaType !== "image/png"
  ) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Index source identity dimensions are inconsistent", "$index.canonicalMaster");
  }
  if (!Array.isArray(value.artifacts) || value.artifactCount !== value.artifacts.length) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Index artifact count is inconsistent", "$index.artifacts");
  }
  const artifactPaths = new Set();
  const artifacts = value.artifacts.map((record, index) => {
    const path = `$index.artifacts[${index}]`;
    if (!isPlainObject(record)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Evidence artifact must be an object", path);
    }
    const normalizedPath = layerEvidencePath(record.path);
    if (artifactPaths.has(normalizedPath)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Evidence artifact paths must be unique", `${path}.path`);
    }
    artifactPaths.add(normalizedPath);
    layerHash(record.sha256, `${path}.sha256`);
    layerStableId(record.layerId, `${path}.layerId`);
    if (
      !Number.isSafeInteger(record.byteLength) || record.byteLength < 1
      || !Number.isSafeInteger(record.width) || record.width < 1
      || !Number.isSafeInteger(record.height) || record.height < 1
      || ![100, 200].includes(record.zoomPercent)
      || record.mediaType !== "image/png"
      || record.reviewerAid !== true
      || record.semanticInference !== false
      || record.syntheticTruthClaim !== false
    ) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Evidence artifact metadata is invalid", path);
    }
    uniqueSorted(record.inputSha256, `${path}.inputSha256`, layerHash);
    uniqueSorted(record.reviewSetIds, `${path}.reviewSetIds`, layerStableId);
    if (record.poseId !== null) layerStableId(record.poseId, `${path}.poseId`);
    if (record.profileId !== null) layerStableId(record.profileId, `${path}.profileId`);
    layerRect(record.sourceRect, sourceWidth, sourceHeight, `${path}.sourceRect`);
    return canonicalizeJson({ ...record, path: normalizedPath });
  });
  if (value.outputSetSha256 !== outputFingerprint(artifacts)) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Evidence output-set hash is stale", "$index.outputSetSha256");
  }
  if (!Array.isArray(value.reviewSets) || value.reviewSetCount !== value.reviewSets.length) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Index review-set count is inconsistent", "$index.reviewSets");
  }
  const artifactByPath = new Map(artifacts.map((record) => [record.path, record]));
  const reviewSetIds = new Set();
  const reviewSets = value.reviewSets.map((reviewSet, index) => {
    const path = `$index.reviewSets[${index}]`;
    exactFields(reviewSet, [
      "artifactPaths",
      "bindingSha256",
      "evidenceSha256",
      "id",
      "inputFiles",
      "layerIds",
      "poseIds",
      "projectionSha256",
      "scope",
      "zoomPercent",
    ], path);
    const id = layerStableId(reviewSet.id, `${path}.id`);
    if (reviewSetIds.has(id)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review-set IDs must be unique", `${path}.id`);
    }
    reviewSetIds.add(id);
    if (!REVIEW_SCOPE_SET.has(reviewSet.scope)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review-set scope is invalid", `${path}.scope`);
    }
    const selectedPaths = uniqueSorted(reviewSet.artifactPaths, `${path}.artifactPaths`, (entry, entryPath) => {
      const normalized = layerEvidencePath(entry);
      if (!artifactByPath.has(normalized)) {
        fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review set references unknown evidence", entryPath);
      }
      return normalized;
    });
    if (selectedPaths.length === 0) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review set cannot be empty", `${path}.artifactPaths`);
    }
    const selectedHashes = [...new Set(selectedPaths.map((entry) => artifactByPath.get(entry).sha256))]
      .sort(lexicalCompare);
    const declaredHashes = uniqueSorted(reviewSet.evidenceSha256, `${path}.evidenceSha256`, layerHash);
    if (selectedHashes.length !== declaredHashes.length
      || selectedHashes.some((digest, digestIndex) => digest !== declaredHashes[digestIndex])) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review-set evidence hashes are stale", `${path}.evidenceSha256`);
    }
    if (!Array.isArray(reviewSet.inputFiles)) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review-set inputFiles must be an array", `${path}.inputFiles`);
    }
    const inputFiles = reviewSet.inputFiles.map((identity, identityIndex) => (
      validateIdentity(identity, `${path}.inputFiles[${identityIndex}]`)
    )).sort((left, right) => lexicalCompare(left.path, right.path));
    if (new Set(inputFiles.map(({ path: inputPath }) => inputPath)).size !== inputFiles.length) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review-set input paths must be unique", `${path}.inputFiles`);
    }
    const normalized = canonicalizeJson({
      artifactPaths: selectedPaths,
      evidenceSha256: declaredHashes,
      id,
      inputFiles,
      layerIds: uniqueSorted(reviewSet.layerIds, `${path}.layerIds`, layerStableId),
      poseIds: uniqueSorted(reviewSet.poseIds, `${path}.poseIds`, layerStableId),
      projectionSha256: uniqueSorted(reviewSet.projectionSha256, `${path}.projectionSha256`, layerHash),
      scope: reviewSet.scope,
      zoomPercent: [...new Set(reviewSet.zoomPercent)].sort((left, right) => left - right),
    });
    if (
      normalized.layerIds.length === 0
      || normalized.poseIds.length === 0
      || normalized.zoomPercent.length === 0
      || normalized.zoomPercent.some((zoom) => zoom !== 100 && zoom !== 200)
    ) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review-set bindings are incomplete", path);
    }
    const expectedBinding = sha256(serializeCanonicalJson(bindingProjection(normalized)));
    if (reviewSet.bindingSha256 !== expectedBinding) {
      fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Review-set binding hash is stale", `${path}.bindingSha256`);
    }
    return canonicalizeJson({ ...normalized, bindingSha256: expectedBinding });
  });
  for (const artifact of artifacts) {
    for (const reviewSetId of artifact.reviewSetIds) {
      const reviewSet = reviewSets.find(({ id }) => id === reviewSetId);
      if (reviewSet === undefined || !reviewSet.artifactPaths.includes(artifact.path)) {
        fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, "Artifact review-set membership is inconsistent", artifact.path);
      }
    }
  }
  layerHash(value.outputSetSha256, "$index.outputSetSha256");
  return freezeLayerEvidence(canonicalizeJson({
    ...value,
    artifacts,
    authoring,
    canonicalMaster: { ...value.canonicalMaster, ...canonicalMaster },
    reviewSets,
  }));
}

export function resolveLayerReviewEvidenceSet(index, evidenceSetId) {
  const validated = validateLayerReviewEvidenceIndex(index);
  const id = layerStableId(evidenceSetId, "$.evidenceSetId");
  const reviewSet = validated.reviewSets.find((entry) => entry.id === id);
  if (reviewSet === undefined) {
    fail(REVIEW_EVIDENCE_ISSUE_CODES.INPUT_INVALID, `Unknown layer evidence set ${id}`, "$.evidenceSetId");
  }
  return reviewSet;
}

export function isLayerReviewEvidencePath(value) {
  if (typeof value !== "string") return false;
  try {
    const normalized = layerEvidencePath(value);
    return normalized === LAYER_REVIEW_EVIDENCE_INDEX_PATH
      || dirname(normalized).startsWith(LAYER_REVIEW_EVIDENCE_DIRECTORY);
  } catch {
    return false;
  }
}
