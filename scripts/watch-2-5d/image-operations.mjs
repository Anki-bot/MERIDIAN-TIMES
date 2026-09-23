import {
  lstat,
  mkdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import sharp from "sharp";
import {
  CANONICAL_SOURCE_COORDINATE_SPACE,
  LAYER_GATE_FAILURE_CODES,
  serializeCanonicalJsonLine,
  sha256,
} from "./contract.mjs";

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

export const SEGMENTATION_EDGE_BAND_RADIUS = 2;
export const MAX_RECONSTRUCTION_FEATHER_PIXELS = 4;
export const SMALL_RASTER_ORACLE_MAX_PIXELS = 4_096;

export const PIXEL_CLASSIFICATION_CODES = Object.freeze({
  unpainted: 0,
  "source-visible": 1,
  synthetic: 2,
});

export const IMAGE_OPERATION_ISSUE_CODES = Object.freeze({
  CLASSIFICATION_INVALID: "IMAGE_CLASSIFICATION_INVALID",
  COORDINATE_INVALID: "IMAGE_COORDINATE_INVALID",
  DIMENSION_MISMATCH: "IMAGE_DIMENSION_MISMATCH",
  INPUT_INVALID: "IMAGE_INPUT_INVALID",
  MASK_DECODE_INVALID: "IMAGE_MASK_DECODE_INVALID",
  MASK_EMPTY: "IMAGE_MASK_EMPTY",
  ORACLE_INVALID: "IMAGE_ORACLE_INVALID",
  OUTPUT_UNSAFE: "IMAGE_OUTPUT_UNSAFE",
  OUTPUT_WRITE_FAILED: "IMAGE_OUTPUT_WRITE_FAILED",
  OVERLAP_INVALID: "IMAGE_OVERLAP_INVALID",
  RECONSTRUCTION_INVALID: "IMAGE_RECONSTRUCTION_INVALID",
});

const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";
const PNG_IHDR_TYPE = "IHDR";
const PNG_IHDR_LENGTH = 13;
const GRAYSCALE_PNG_COLOR_TYPE = 0;
const CLASSIFICATION_NAMES = Object.freeze([
  "unpainted",
  "source-visible",
  "synthetic",
]);
const CLASSIFICATION_NAME_SET = new Set(CLASSIFICATION_NAMES);
const ORACLE_MASK_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const WINDOWS_ABSOLUTE_PATTERN = /^[a-z]:[/\\]/iu;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

export class ImageOperationError extends TypeError {
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
    this.name = "ImageOperationError";
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
  throw new ImageOperationError(issueCode, message, path, code);
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

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPositiveDimension(value, path, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.INPUT_INVALID,
      `Dimension must be an integer from 1 through ${maximum}`,
      path,
    );
  }
  return value;
}

function assertRasterDimensions(width, height, path = "$", { canonical = false } = {}) {
  assertPositiveDimension(
    width,
    `${path}.width`,
    CANONICAL_SOURCE_COORDINATE_SPACE.width,
  );
  assertPositiveDimension(
    height,
    `${path}.height`,
    CANONICAL_SOURCE_COORDINATE_SPACE.height,
  );
  if (
    canonical
    && (
      width !== CANONICAL_SOURCE_COORDINATE_SPACE.width
      || height !== CANONICAL_SOURCE_COORDINATE_SPACE.height
    )
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.DIMENSION_MISMATCH,
      "Raster dimensions must equal the canonical 2760x1504 source space",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  return { height, width };
}

function detachedBytes(value, path) {
  if (!ArrayBuffer.isView(value)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.INPUT_INVALID,
      "Byte input must be an ArrayBuffer view",
      path,
    );
  }
  return Buffer.from(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function assertByteRasterData(value, expectedLength, path) {
  const tag = Object.prototype.toString.call(value);
  const isUnsignedByteArray = Buffer.isBuffer(value)
    || tag === "[object Uint8Array]"
    || tag === "[object Uint8ClampedArray]";
  if (!ArrayBuffer.isView(value) || !isUnsignedByteArray) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.INPUT_INVALID,
      "Raster data must be an unsigned 8-bit byte array",
      path,
    );
  }
  if (value.byteLength !== expectedLength) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.DIMENSION_MISMATCH,
      `Raster data must contain exactly ${expectedLength} bytes`,
      path,
    );
  }
  return value;
}

function normalizeMask(mask, path = "$.mask") {
  if (!isPlainObject(mask)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.INPUT_INVALID,
      "Mask must be a plain raster object",
      path,
    );
  }
  const { width, height } = assertRasterDimensions(mask.width, mask.height, path);
  const data = assertByteRasterData(mask.data, width * height, `${path}.data`);
  return { data, height, width };
}

function normalizeRgba(image, path = "$.image") {
  if (!isPlainObject(image)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.INPUT_INVALID,
      "RGBA image must be a plain raster object",
      path,
    );
  }
  const { width, height } = assertRasterDimensions(image.width, image.height, path);
  const data = assertByteRasterData(
    image.data,
    width * height * 4,
    `${path}.data`,
  );
  return { data, height, width };
}

function assertSameDimensions(left, right, path) {
  if (left.width !== right.width || left.height !== right.height) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.DIMENSION_MISMATCH,
      "Raster dimensions must match exactly",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
}

function tightBoundsFromData(data, width, height) {
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[rowOffset + x] === 0) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  if (maximumX < 0) return null;
  return Object.freeze({
    height: maximumY - minimumY + 1,
    width: maximumX - minimumX + 1,
    x: minimumX,
    y: minimumY,
  });
}

function countMaskData(data) {
  let alphaSum = 0;
  let nonZeroPixelCount = 0;
  let opaquePixelCount = 0;
  let partialPixelCount = 0;
  for (const alpha of data) {
    alphaSum += alpha;
    if (alpha === 0) continue;
    nonZeroPixelCount += 1;
    if (alpha === 255) opaquePixelCount += 1;
    else partialPixelCount += 1;
  }
  return Object.freeze({
    alphaSum,
    nonZeroPixelCount,
    opaquePixelCount,
    partialPixelCount,
  });
}

function createMaskResult(data, width, height) {
  const copied = Buffer.from(data);
  const counts = countMaskData(copied);
  return Object.freeze({
    ...counts,
    data: copied,
    height,
    tightBounds: tightBoundsFromData(copied, width, height),
    width,
  });
}

function createRgbaResult(data, width, height) {
  return Object.freeze({
    data: Buffer.from(data),
    height,
    width,
  });
}

/** Create a detached bounded 8-bit mask raster for pure operations or small-raster tests. */
export function createMaskRaster({ data, height, width }, { canonical = false } = {}) {
  assertRasterDimensions(width, height, "$.mask", { canonical });
  const bytes = assertByteRasterData(data, width * height, "$.mask.data");
  return createMaskResult(bytes, width, height);
}

/** Create a detached bounded straight-alpha RGBA raster. */
export function createRgbaRaster({ data, height, width }, { canonical = false } = {}) {
  assertRasterDimensions(width, height, "$.image", { canonical });
  const bytes = assertByteRasterData(data, width * height * 4, "$.image.data");
  return createRgbaResult(bytes, width, height);
}

function inspectStrictGrayscalePngHeader(bytes, expectedWidth, expectedHeight, path) {
  if (
    bytes.byteLength < 33
    || bytes.subarray(0, 8).toString("hex") !== PNG_SIGNATURE_HEX
    || bytes.readUInt32BE(8) !== PNG_IHDR_LENGTH
    || bytes.subarray(12, 16).toString("ascii") !== PNG_IHDR_TYPE
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.MASK_DECODE_INVALID,
      "Mask must have a valid PNG signature and leading IHDR chunk",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const compressionMethod = bytes[26];
  const filterMethod = bytes[27];
  const interlaceMethod = bytes[28];
  if (width !== expectedWidth || height !== expectedHeight) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.DIMENSION_MISMATCH,
      `Mask PNG dimensions must equal ${expectedWidth}x${expectedHeight}`,
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  if (
    bitDepth !== 8
    || colorType !== GRAYSCALE_PNG_COLOR_TYPE
    || compressionMethod !== 0
    || filterMethod !== 0
    || interlaceMethod !== 0
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.MASK_DECODE_INVALID,
      "Mask PNG must be non-interlaced 8-bit grayscale with no alpha or palette",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
}

/** Decode a strict non-interlaced 8-bit grayscale PNG at explicitly declared dimensions. */
export async function decodeMaskPng8(
  value,
  {
    expectedHeight = CANONICAL_SOURCE_COORDINATE_SPACE.height,
    expectedWidth = CANONICAL_SOURCE_COORDINATE_SPACE.width,
    path = "$.mask",
  } = {},
) {
  assertRasterDimensions(expectedWidth, expectedHeight, "$.expectedDimensions");
  const bytes = detachedBytes(value, path);
  inspectStrictGrayscalePngHeader(
    bytes,
    expectedWidth,
    expectedHeight,
    path,
  );

  const pixelCount = expectedWidth * expectedHeight;
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
      .greyscale()
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
  } catch {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.MASK_DECODE_INVALID,
      "Mask PNG cannot be decoded within the declared finite bounds",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }

  if (
    metadata.format !== "png"
    || metadata.width !== expectedWidth
    || metadata.height !== expectedHeight
    || metadata.depth !== "uchar"
    || metadata.channels !== 1
    || metadata.hasAlpha !== false
    || (metadata.pages !== undefined && metadata.pages !== 1)
    || decoded.info.width !== expectedWidth
    || decoded.info.height !== expectedHeight
    || decoded.info.channels !== 1
    || decoded.data.byteLength !== pixelCount
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.MASK_DECODE_INVALID,
      "Decoded mask metadata must remain single-channel 8-bit grayscale",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }

  const mask = createMaskResult(decoded.data, expectedWidth, expectedHeight);
  return Object.freeze({
    ...mask,
    bitDepth: 8,
    colorType: "grayscale",
    mediaType: "image/png",
  });
}

/** Decode a production mask fixed to the complete 2760x1504 canonical source space. */
export async function decodeCanonicalMask(value, options = {}) {
  return decodeMaskPng8(value, {
    ...options,
    expectedHeight: CANONICAL_SOURCE_COORDINATE_SPACE.height,
    expectedWidth: CANONICAL_SOURCE_COORDINATE_SPACE.width,
  });
}

/** Return the minimal half-open rectangle containing every nonzero mask sample. */
export function computeTightBounds(mask) {
  const normalized = normalizeMask(mask);
  return tightBoundsFromData(
    normalized.data,
    normalized.width,
    normalized.height,
  );
}

export const tightMaskBounds = computeTightBounds;

/** Return deterministic alpha/nonzero coverage counts without changing the mask. */
export function countMaskCoverage(mask) {
  return countMaskData(normalizeMask(mask).data);
}

function validateMaskCollection(masks, path = "$.masks") {
  if (!Array.isArray(masks) || masks.length === 0) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.INPUT_INVALID,
      "Mask collection must contain at least one mask",
      path,
    );
  }
  const normalized = masks.map((mask, index) => normalizeMask(
    mask,
    `${path}[${index}]`,
  ));
  for (let index = 1; index < normalized.length; index += 1) {
    assertSameDimensions(normalized[0], normalized[index], `${path}[${index}]`);
  }
  return normalized;
}

/** Alpha-preserving mask union: each output sample is the maximum input sample. */
export function unionMasks(masks) {
  const normalized = validateMaskCollection(masks);
  const output = Buffer.alloc(normalized[0].width * normalized[0].height);
  for (let offset = 0; offset < output.byteLength; offset += 1) {
    let alpha = 0;
    for (const mask of normalized) alpha = Math.max(alpha, mask.data[offset]);
    output[offset] = alpha;
  }
  return createMaskResult(output, normalized[0].width, normalized[0].height);
}

/** Alpha-preserving mask intersection: each output sample is the minimum input sample. */
export function intersectMasks(masks) {
  const normalized = validateMaskCollection(masks);
  const output = Buffer.alloc(normalized[0].width * normalized[0].height);
  for (let offset = 0; offset < output.byteLength; offset += 1) {
    let alpha = 255;
    for (const mask of normalized) alpha = Math.min(alpha, mask.data[offset]);
    output[offset] = alpha;
  }
  return createMaskResult(output, normalized[0].width, normalized[0].height);
}

/** Alpha-preserving subtraction with saturation at zero. */
export function differenceMasks(leftMask, rightMask) {
  const left = normalizeMask(leftMask, "$.leftMask");
  const right = normalizeMask(rightMask, "$.rightMask");
  assertSameDimensions(left, right, "$.rightMask");
  const output = Buffer.alloc(left.width * left.height);
  for (let offset = 0; offset < output.byteLength; offset += 1) {
    output[offset] = Math.max(0, left.data[offset] - right.data[offset]);
  }
  return createMaskResult(output, left.width, left.height);
}

export const maskUnion = unionMasks;
export const maskIntersection = intersectMasks;
export const maskDifference = differenceMasks;

function assertRadius(value, path, { minimum = 0 } = {}) {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > MAX_RECONSTRUCTION_FEATHER_PIXELS
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.COORDINATE_INVALID,
      `Radius must be an integer from ${minimum} through ${MAX_RECONSTRUCTION_FEATHER_PIXELS}`,
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  return value;
}

/** Expand an alpha mask by repeating the maximum neighboring alpha sample. */
export function dilateMask(mask, radius = 1) {
  const normalized = normalizeMask(mask);
  assertRadius(radius, "$.radius");
  if (radius === 0) {
    return createMaskResult(normalized.data, normalized.width, normalized.height);
  }

  const horizontal = Buffer.alloc(normalized.width * normalized.height);
  const output = Buffer.alloc(normalized.width * normalized.height);
  for (let y = 0; y < normalized.height; y += 1) {
    const rowOffset = y * normalized.width;
    for (let x = 0; x < normalized.width; x += 1) {
      let maximum = 0;
      const startX = Math.max(0, x - radius);
      const endX = Math.min(normalized.width - 1, x + radius);
      for (let sampleX = startX; sampleX <= endX; sampleX += 1) {
        maximum = Math.max(maximum, normalized.data[rowOffset + sampleX]);
      }
      horizontal[rowOffset + x] = maximum;
    }
  }
  for (let y = 0; y < normalized.height; y += 1) {
    const startY = Math.max(0, y - radius);
    const endY = Math.min(normalized.height - 1, y + radius);
    for (let x = 0; x < normalized.width; x += 1) {
      let maximum = 0;
      for (let sampleY = startY; sampleY <= endY; sampleY += 1) {
        maximum = Math.max(
          maximum,
          horizontal[sampleY * normalized.width + x],
        );
      }
      output[y * normalized.width + x] = maximum;
    }
  }
  return createMaskResult(output, normalized.width, normalized.height);
}

function erodeBinaryMask(mask, radius) {
  const output = Buffer.alloc(mask.width * mask.height);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let fullyInside = true;
      for (let sampleY = y - radius; sampleY <= y + radius && fullyInside; sampleY += 1) {
        if (sampleY < 0 || sampleY >= mask.height) {
          fullyInside = false;
          break;
        }
        for (let sampleX = x - radius; sampleX <= x + radius; sampleX += 1) {
          if (
            sampleX < 0
            || sampleX >= mask.width
            || mask.data[sampleY * mask.width + sampleX] === 0
          ) {
            fullyInside = false;
            break;
          }
        }
      }
      output[y * mask.width + x] = fullyInside ? 255 : 0;
    }
  }
  return output;
}

/** Create the binary region extending the declared radius to both sides of a mask edge. */
export function createMaskEdgeBand(mask, radius = SEGMENTATION_EDGE_BAND_RADIUS) {
  const normalized = normalizeMask(mask);
  assertRadius(radius, "$.radius", { minimum: 1 });
  const binary = createMaskResult(
    Uint8Array.from(normalized.data, (alpha) => (alpha === 0 ? 0 : 255)),
    normalized.width,
    normalized.height,
  );
  const expanded = dilateMask(binary, radius);
  const eroded = erodeBinaryMask(binary, radius);
  const output = Buffer.alloc(normalized.width * normalized.height);
  for (let offset = 0; offset < output.byteLength; offset += 1) {
    output[offset] = expanded.data[offset] !== 0 && eroded[offset] === 0 ? 255 : 0;
  }
  return createMaskResult(output, normalized.width, normalized.height);
}

export const createEdgeBand = createMaskEdgeBand;

/** Union every declared pose and add at most the approved four-pixel feather. */
export function createSweptBoundary(masks, { feather = 0 } = {}) {
  assertRadius(feather, "$.feather");
  const swept = unionMasks(masks);
  return feather === 0 ? swept : dilateMask(swept, feather);
}

function validateSourceRect(rect, width, height, path = "$.sourceRect") {
  if (!isPlainObject(rect)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.COORDINATE_INVALID,
      "Source rectangle must be a plain object",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  for (const field of ["x", "y", "width", "height"]) {
    if (!Number.isSafeInteger(rect[field])) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.COORDINATE_INVALID,
        "Source rectangle values must be safe integers",
        `${path}.${field}`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
  }
  if (
    rect.x < 0
    || rect.y < 0
    || rect.width < 1
    || rect.height < 1
    || rect.x + rect.width > width
    || rect.y + rect.height > height
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.COORDINATE_INVALID,
      "Source rectangle must be nonempty, half-open, and contained by the raster",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  return Object.freeze({
    height: rect.height,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  });
}

function rectContains(outer, inner) {
  return outer.x <= inner.x
    && outer.y <= inner.y
    && outer.x + outer.width >= inner.x + inner.width
    && outer.y + outer.height >= inner.y + inner.height;
}

function paddedRect(rect, padding, width, height) {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const right = Math.min(width, rect.x + rect.width + padding);
  const bottom = Math.min(height, rect.y + rect.height + padding);
  return Object.freeze({
    height: bottom - y,
    width: right - x,
    x,
    y,
  });
}

function multiplyAlpha(left, right) {
  return Math.floor((left * right + 127) / 255);
}

/** Extract straight RGBA source pixels while retaining every authored mask alpha sample. */
export function extractMaskedRgba({
  edgePad = 0,
  mask,
  source,
  sourceRect = undefined,
} = {}) {
  const normalizedSource = normalizeRgba(source, "$.source");
  const normalizedMask = normalizeMask(mask, "$.mask");
  assertSameDimensions(normalizedSource, normalizedMask, "$.mask");
  assertRadius(edgePad, "$.edgePad");

  const tightBounds = tightBoundsFromData(
    normalizedMask.data,
    normalizedMask.width,
    normalizedMask.height,
  );
  if (tightBounds === null) {
    return Object.freeze({
      alphaSum: 0,
      classification: Buffer.alloc(0),
      data: Buffer.alloc(0),
      height: 0,
      mask: null,
      sourceRect: null,
      sourceVisiblePixelCount: 0,
      syntheticPixelCount: 0,
      width: 0,
    });
  }

  let extractionRect;
  if (sourceRect === undefined) {
    extractionRect = paddedRect(
      tightBounds,
      edgePad,
      normalizedSource.width,
      normalizedSource.height,
    );
  } else {
    if (edgePad !== 0) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.COORDINATE_INVALID,
        "edgePad cannot be combined with an explicit sourceRect",
        "$.edgePad",
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    extractionRect = validateSourceRect(
      sourceRect,
      normalizedSource.width,
      normalizedSource.height,
    );
    if (!rectContains(extractionRect, tightBounds)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.COORDINATE_INVALID,
        "sourceRect must contain every nonzero mask sample",
        "$.sourceRect",
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
  }

  const pixelCount = extractionRect.width * extractionRect.height;
  const rgba = Buffer.alloc(pixelCount * 4);
  const croppedMask = Buffer.alloc(pixelCount);
  const classification = Buffer.alloc(pixelCount);
  let alphaSum = 0;
  let sourceVisiblePixelCount = 0;
  for (let localY = 0; localY < extractionRect.height; localY += 1) {
    const sourceY = extractionRect.y + localY;
    for (let localX = 0; localX < extractionRect.width; localX += 1) {
      const sourceX = extractionRect.x + localX;
      const sourcePixel = sourceY * normalizedSource.width + sourceX;
      const outputPixel = localY * extractionRect.width + localX;
      const sourceOffset = sourcePixel * 4;
      const outputOffset = outputPixel * 4;
      const maskAlpha = normalizedMask.data[sourcePixel];
      const outputAlpha = multiplyAlpha(
        normalizedSource.data[sourceOffset + 3],
        maskAlpha,
      );
      rgba[outputOffset] = normalizedSource.data[sourceOffset];
      rgba[outputOffset + 1] = normalizedSource.data[sourceOffset + 1];
      rgba[outputOffset + 2] = normalizedSource.data[sourceOffset + 2];
      rgba[outputOffset + 3] = outputAlpha;
      croppedMask[outputPixel] = maskAlpha;
      alphaSum += outputAlpha;
      if (outputAlpha !== 0) {
        classification[outputPixel] = PIXEL_CLASSIFICATION_CODES["source-visible"];
        sourceVisiblePixelCount += 1;
      }
    }
  }

  return Object.freeze({
    alphaSum,
    classification,
    data: rgba,
    height: extractionRect.height,
    mask: createMaskResult(
      croppedMask,
      extractionRect.width,
      extractionRect.height,
    ),
    sourceRect: extractionRect,
    sourceVisiblePixelCount,
    syntheticPixelCount: 0,
    width: extractionRect.width,
  });
}

export const extractAlphaPreservingLayer = extractMaskedRgba;

function normalizeOrderedMaskLayers(layers, path = "$.layers") {
  if (!Array.isArray(layers) || layers.length === 0) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OVERLAP_INVALID,
      "Ordered layer collection must contain at least one layer",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  if (layers.length > 65_535) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OVERLAP_INVALID,
      "Ordered layer collection exceeds the finite overlap limit",
      path,
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
  const ids = new Set();
  const zOrders = new Set();
  const normalized = layers.map((layer, index) => {
    const layerPath = `${path}[${index}]`;
    if (!isPlainObject(layer)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.OVERLAP_INVALID,
        "Ordered layer must be a plain object",
        layerPath,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    if (typeof layer.id !== "string" || layer.id.length === 0 || ids.has(layer.id)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.OVERLAP_INVALID,
        "Ordered layer IDs must be nonempty and unique",
        `${layerPath}.id`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    if (!Number.isSafeInteger(layer.zOrder) || zOrders.has(layer.zOrder)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.OVERLAP_INVALID,
        "Ordered layer z-orders must be safe integers and form a total unique order",
        `${layerPath}.zOrder`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
    ids.add(layer.id);
    zOrders.add(layer.zOrder);
    return {
      id: layer.id,
      mask: normalizeMask(layer.mask, `${layerPath}.mask`),
      original: layer,
      zOrder: layer.zOrder,
    };
  });
  for (let index = 1; index < normalized.length; index += 1) {
    assertSameDimensions(
      normalized[0].mask,
      normalized[index].mask,
      `${path}[${index}].mask`,
    );
  }
  return normalized.sort((left, right) => (
    left.zOrder - right.zOrder || lexicalCompare(left.id, right.id)
  ));
}

/** Resolve overlap using ascending z-order composition and highest-z ownership. */
export function resolveOrderedOverlap(layers) {
  const ordered = normalizeOrderedMaskLayers(layers);
  const width = ordered[0].mask.width;
  const height = ordered[0].mask.height;
  const pixelCount = width * height;
  const coverageCount = new Uint16Array(pixelCount);
  const ownerIndex = new Int32Array(pixelCount);
  ownerIndex.fill(-1);

  for (let layerIndex = 0; layerIndex < ordered.length; layerIndex += 1) {
    const mask = ordered[layerIndex].mask.data;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (mask[pixel] === 0) continue;
      coverageCount[pixel] += 1;
      ownerIndex[pixel] = layerIndex;
    }
  }

  const overlap = Buffer.alloc(pixelCount);
  let overlapPixelCount = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (coverageCount[pixel] > 1) {
      overlap[pixel] = 255;
      overlapPixelCount += 1;
    }
  }

  return Object.freeze({
    compositingOrder: Object.freeze(ordered.map(({ id, zOrder }) => Object.freeze({
      id,
      zOrder,
    }))),
    coverageCount,
    height,
    overlapMask: createMaskResult(overlap, width, height),
    overlapPixelCount,
    ownerIndex,
    width,
  });
}

export const orderMaskOverlaps = resolveOrderedOverlap;

function assertClassification(value, path) {
  if (typeof value !== "string" || !CLASSIFICATION_NAME_SET.has(value) || value === "unpainted") {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.CLASSIFICATION_INVALID,
      "Composited layers must be classified as source-visible or synthetic",
      path,
      LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
    );
  }
  return value;
}

function blendStraightRgba(destination, destinationOffset, source, sourceOffset, sourceAlpha) {
  if (sourceAlpha === 0) return destination[destinationOffset + 3];
  const destinationAlpha = destination[destinationOffset + 3];
  if (sourceAlpha === 255 || destinationAlpha === 0) {
    destination[destinationOffset] = source[sourceOffset];
    destination[destinationOffset + 1] = source[sourceOffset + 1];
    destination[destinationOffset + 2] = source[sourceOffset + 2];
    destination[destinationOffset + 3] = sourceAlpha;
    return sourceAlpha;
  }

  const inverse = 255 - sourceAlpha;
  const alphaNumerator = sourceAlpha * 255 + destinationAlpha * inverse;
  for (let channel = 0; channel < 3; channel += 1) {
    const colorNumerator = source[sourceOffset + channel] * sourceAlpha * 255
      + destination[destinationOffset + channel] * destinationAlpha * inverse;
    destination[destinationOffset + channel] = Math.floor(
      (colorNumerator + Math.floor(alphaNumerator / 2)) / alphaNumerator,
    );
  }
  const outputAlpha = Math.floor((alphaNumerator + 127) / 255);
  destination[destinationOffset + 3] = outputAlpha;
  return outputAlpha;
}

function countClassifications(classification, rgba) {
  let nonOpaquePixelCount = 0;
  let sourceVisiblePixelCount = 0;
  let syntheticPixelCount = 0;
  let transparentPixelCount = 0;
  for (let pixel = 0; pixel < classification.byteLength; pixel += 1) {
    const alpha = rgba[pixel * 4 + 3];
    if (alpha < 255) nonOpaquePixelCount += 1;
    if (alpha === 0) {
      transparentPixelCount += 1;
      continue;
    }
    if (classification[pixel] === PIXEL_CLASSIFICATION_CODES.synthetic) {
      syntheticPixelCount += 1;
    } else if (classification[pixel] === PIXEL_CLASSIFICATION_CODES["source-visible"]) {
      sourceVisiblePixelCount += 1;
    } else {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.CLASSIFICATION_INVALID,
        "Every painted pixel must resolve to source-visible or synthetic",
        `$.classification[${pixel}]`,
        LAYER_GATE_FAILURE_CODES.SEGMENTATION_INVALID,
      );
    }
  }
  return Object.freeze({
    nonOpaquePixelCount,
    sourceVisiblePixelCount,
    syntheticPixelCount,
    transparentPixelCount,
  });
}

/** Count final exclusive source-visible/synthetic classifications. */
export function countPixelClassifications(classification, image) {
  const normalizedImage = normalizeRgba(image, "$.image");
  const bytes = assertByteRasterData(
    classification,
    normalizedImage.width * normalizedImage.height,
    "$.classification",
  );
  return countClassifications(bytes, normalizedImage.data);
}

/** Composite explicit layers in a total z-order using straight-alpha source-over. */
export function compositeOrderedLayers(layers) {
  const ordered = normalizeOrderedMaskLayers(layers);
  const width = ordered[0].mask.width;
  const height = ordered[0].mask.height;
  const pixelCount = width * height;
  const rgba = Buffer.alloc(pixelCount * 4);
  const classification = Buffer.alloc(pixelCount);

  for (let layerIndex = 0; layerIndex < ordered.length; layerIndex += 1) {
    const orderedLayer = ordered[layerIndex];
    const layerPath = `$.layers.${orderedLayer.id}`;
    const image = normalizeRgba(
      orderedLayer.original.image ?? orderedLayer.original.rgba,
      `${layerPath}.image`,
    );
    assertSameDimensions(orderedLayer.mask, image, `${layerPath}.image`);
    const classificationName = assertClassification(
      orderedLayer.original.classification,
      `${layerPath}.classification`,
    );
    const classificationCode = PIXEL_CLASSIFICATION_CODES[classificationName];

    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const maskAlpha = orderedLayer.mask.data[pixel];
      if (maskAlpha === 0) continue;
      const offset = pixel * 4;
      const sourceAlpha = multiplyAlpha(image.data[offset + 3], maskAlpha);
      if (sourceAlpha === 0) continue;
      const destinationAlpha = rgba[offset + 3];
      blendStraightRgba(rgba, offset, image.data, offset, sourceAlpha);
      if (sourceAlpha === 255 || destinationAlpha === 0) {
        classification[pixel] = classificationCode;
      } else if (
        classificationCode === PIXEL_CLASSIFICATION_CODES.synthetic
        || classification[pixel] === PIXEL_CLASSIFICATION_CODES.synthetic
      ) {
        classification[pixel] = PIXEL_CLASSIFICATION_CODES.synthetic;
      } else {
        classification[pixel] = PIXEL_CLASSIFICATION_CODES["source-visible"];
      }
    }
  }

  const overlap = resolveOrderedOverlap(ordered.map(({ id, mask, zOrder }) => ({
    id,
    mask,
    zOrder,
  })));
  const counts = countClassifications(classification, rgba);
  const image = createRgbaResult(rgba, width, height);
  return Object.freeze({
    ...counts,
    classification,
    compositingOrder: overlap.compositingOrder,
    data: image.data,
    height,
    image,
    overlapMask: overlap.overlapMask,
    overlapPixelCount: overlap.overlapPixelCount,
    width,
  });
}

function validateReconstructionRecords(reconstructions, source) {
  if (!Array.isArray(reconstructions)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
      "Reconstruction records must be an array",
      "$.reconstructions",
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }
  const ids = new Set();
  const zOrders = new Set();
  return reconstructions.map((record, index) => {
    const path = `$.reconstructions[${index}]`;
    if (!isPlainObject(record)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
        "Reconstruction record must be a plain object",
        path,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
    if (typeof record.id !== "string" || record.id.length === 0 || ids.has(record.id)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
        "Reconstruction IDs must be nonempty and unique",
        `${path}.id`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
    if (!Number.isSafeInteger(record.zOrder) || zOrders.has(record.zOrder)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
        "Reconstruction z-orders must be safe integers and unique",
        `${path}.zOrder`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
    ids.add(record.id);
    zOrders.add(record.zOrder);
    const footprintMask = normalizeMask(record.footprintMask, `${path}.footprintMask`);
    const reconstructionMask = normalizeMask(
      record.reconstructionMask,
      `${path}.reconstructionMask`,
    );
    const boundaryMask = normalizeMask(record.boundaryMask, `${path}.boundaryMask`);
    const fill = normalizeRgba(record.fill, `${path}.fill`);
    for (const [name, raster] of [
      ["footprintMask", footprintMask],
      ["reconstructionMask", reconstructionMask],
      ["boundaryMask", boundaryMask],
      ["fill", fill],
    ]) {
      assertSameDimensions(source, raster, `${path}.${name}`);
    }

    for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
      const reconstructionAlpha = reconstructionMask.data[pixel];
      if (
        reconstructionAlpha !== 0
        && boundaryMask.data[pixel] === 0
      ) {
        fail(
          IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
          "Reconstruction mask must remain inside its swept boundary",
          `${path}.reconstructionMask`,
          LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        );
      }
      if (footprintMask.data[pixel] > reconstructionAlpha) {
        fail(
          IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
          "Reconstruction mask must replace the complete reference footprint",
          `${path}.footprintMask`,
          LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        );
      }
      if (reconstructionAlpha !== 0 && fill.data[pixel * 4 + 3] !== 255) {
        fail(
          IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
          "Synthetic reconstruction fill must be opaque wherever its mask is nonzero",
          `${path}.fill`,
          LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        );
      }
    }

    return Object.freeze({
      boundaryMask,
      fill,
      footprintMask,
      id: record.id,
      reconstructionMask,
      zOrder: record.zOrder,
    });
  }).sort((left, right) => (
    left.zOrder - right.zOrder || lexicalCompare(left.id, right.id)
  ));
}

function fullMask(width, height) {
  return createMaskResult(Buffer.alloc(width * height, 255), width, height);
}

function classificationForSource(source) {
  const classification = Buffer.alloc(source.width * source.height);
  for (let pixel = 0; pixel < classification.byteLength; pixel += 1) {
    if (source.data[pixel * 4 + 3] !== 0) {
      classification[pixel] = PIXEL_CLASSIFICATION_CODES["source-visible"];
    }
  }
  return classification;
}

/**
 * Replace approved footprints with explicit RGBA fills. Every fill contribution is
 * classified synthetic, including clone/inpaint inputs that happen to resemble source.
 */
export function composeReconstructedBackground({
  reconstructions = [],
  source,
} = {}) {
  const normalizedSource = normalizeRgba(source, "$.source");
  const records = validateReconstructionRecords(reconstructions, normalizedSource);
  if (records.length === 0) {
    const image = createRgbaResult(
      normalizedSource.data,
      normalizedSource.width,
      normalizedSource.height,
    );
    const classification = classificationForSource(normalizedSource);
    const counts = countClassifications(classification, image.data);
    const emptyMask = createMaskResult(
      Buffer.alloc(normalizedSource.width * normalizedSource.height),
      normalizedSource.width,
      normalizedSource.height,
    );
    return Object.freeze({
      ...counts,
      approvedChangeMask: emptyMask,
      classification,
      completeFootprintReplacement: true,
      data: image.data,
      footprintMask: emptyMask,
      height: image.height,
      image,
      immutablePixelCount: normalizedSource.width * normalizedSource.height,
      reconstructionRecords: Object.freeze([]),
      replacedFootprintPixelCount: 0,
      width: image.width,
    });
  }

  const approvedChangeMask = unionMasks(records.map(({ reconstructionMask }) => (
    reconstructionMask
  )));
  const footprintMask = unionMasks(records.map(({ footprintMask: mask }) => mask));
  const layers = [
    {
      classification: "source-visible",
      id: "canonical-source-background",
      image: normalizedSource,
      mask: fullMask(normalizedSource.width, normalizedSource.height),
      zOrder: Number.MIN_SAFE_INTEGER,
    },
    ...records.map((record) => ({
      classification: "synthetic",
      id: record.id,
      image: record.fill,
      mask: record.reconstructionMask,
      zOrder: record.zOrder,
    })),
  ];
  const composed = compositeOrderedLayers(layers);
  for (let pixel = 0; pixel < normalizedSource.width * normalizedSource.height; pixel += 1) {
    const outputOffset = pixel * 4;
    if (approvedChangeMask.data[pixel] === 0) {
      for (let channel = 0; channel < 4; channel += 1) {
        if (composed.data[outputOffset + channel] !== normalizedSource.data[outputOffset + channel]) {
          fail(
            IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
            "Reconstruction changed a pixel outside the approved change mask",
            `$.output[${pixel}]`,
            LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
          );
        }
      }
    } else if (composed.data[outputOffset + 3] !== 255) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
        "Reconstruction region must have opaque composed coverage",
        `$.output[${pixel}]`,
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      );
    }
  }

  return Object.freeze({
    approvedChangeMask,
    classification: composed.classification,
    completeFootprintReplacement: true,
    data: composed.data,
    height: composed.height,
    image: composed.image,
    immutablePixelCount: normalizedSource.width * normalizedSource.height
      - approvedChangeMask.nonZeroPixelCount,
    nonOpaquePixelCount: composed.nonOpaquePixelCount,
    reconstructionRecords: Object.freeze(records.map(({ id, zOrder }) => Object.freeze({
      classification: "synthetic",
      id,
      zOrder,
    }))),
    replacedFootprintPixelCount: footprintMask.nonZeroPixelCount,
    sourceVisiblePixelCount: composed.sourceVisiblePixelCount,
    syntheticPixelCount: composed.syntheticPixelCount,
    transparentPixelCount: composed.transparentPixelCount,
    footprintMask,
    width: composed.width,
  });
}

function normalizeClassificationRaster(value, width, height, path) {
  const bytes = assertByteRasterData(value, width * height, path);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] > PIXEL_CLASSIFICATION_CODES.synthetic) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.CLASSIFICATION_INVALID,
        "Classification raster contains an unsupported code",
        `${path}[${index}]`,
      );
    }
  }
  return bytes;
}

function rowsFromMask(mask) {
  return Array.from({ length: mask.height }, (_, y) => (
    Array.from(mask.data.subarray(y * mask.width, (y + 1) * mask.width))
  ));
}

function rowsFromRgba(image) {
  return Array.from({ length: image.height }, (_, y) => (
    Array.from({ length: image.width }, (_, x) => {
      const offset = (y * image.width + x) * 4;
      return Array.from(image.data.subarray(offset, offset + 4));
    })
  ));
}

function rowsFromClassifications(classification, width, height) {
  return Array.from({ length: height }, (_, y) => (
    Array.from({ length: width }, (_, x) => (
      CLASSIFICATION_NAMES[classification[y * width + x]]
    ))
  ));
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** Produce a canonical-JSON-safe row oracle for bounded synthetic rasters. */
export function createSmallRasterOracle({
  classification = undefined,
  image = undefined,
  masks = {},
} = {}) {
  if (!isPlainObject(masks)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
      "Oracle masks must be a plain object",
      "$.masks",
    );
  }
  const maskEntries = Object.entries(masks).sort(([left], [right]) => (
    lexicalCompare(left, right)
  ));
  for (const [name] of maskEntries) {
    if (!ORACLE_MASK_NAME_PATTERN.test(name)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
        "Oracle mask names must be stable lowercase kebab-case",
        `$.masks.${name}`,
      );
    }
  }

  const normalizedImage = image === undefined ? null : normalizeRgba(image, "$.image");
  const normalizedMasks = maskEntries.map(([name, mask]) => ([
    name,
    normalizeMask(mask, `$.masks.${name}`),
  ]));
  const dimensions = normalizedImage ?? normalizedMasks[0]?.[1];
  if (dimensions === undefined) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
      "Oracle must contain an RGBA image or at least one mask",
      "$",
    );
  }
  if (dimensions.width * dimensions.height > SMALL_RASTER_ORACLE_MAX_PIXELS) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
      `Oracle rasters may contain at most ${SMALL_RASTER_ORACLE_MAX_PIXELS} pixels`,
      "$",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
  for (const [name, mask] of normalizedMasks) {
    assertSameDimensions(dimensions, mask, `$.masks.${name}`);
  }

  let classifications = null;
  if (normalizedImage !== null) {
    if (classification === undefined) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.CLASSIFICATION_INVALID,
        "RGBA oracle output requires an explicit classification raster",
        "$.classification",
      );
    }
    classifications = normalizeClassificationRaster(
      classification,
      dimensions.width,
      dimensions.height,
      "$.classification",
    );
    countClassifications(classifications, normalizedImage.data);
  } else if (classification !== undefined) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.CLASSIFICATION_INVALID,
      "Classification raster requires an RGBA oracle image",
      "$.classification",
    );
  }

  const oracle = {
    masks: Object.fromEntries(normalizedMasks.map(([name, mask]) => ([
      name,
      rowsFromMask(mask),
    ]))),
    schemaVersion: 1,
    sourceCoordinateSpace: {
      height: dimensions.height,
      width: dimensions.width,
    },
  };
  if (normalizedImage !== null) {
    oracle.classificationRows = rowsFromClassifications(
      classifications,
      dimensions.width,
      dimensions.height,
    );
    oracle.rgbaRows = rowsFromRgba(normalizedImage);
  }
  return deepFreeze(oracle);
}

export const createSmallRasterOracleOutput = createSmallRasterOracle;

function validateSmallRasterOracle(oracle) {
  if (
    !isPlainObject(oracle)
    || oracle.schemaVersion !== 1
    || !isPlainObject(oracle.sourceCoordinateSpace)
    || !isPlainObject(oracle.masks)
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
      "Small-raster oracle has an invalid top-level shape",
      "$",
    );
  }
  const { width, height } = assertRasterDimensions(
    oracle.sourceCoordinateSpace.width,
    oracle.sourceCoordinateSpace.height,
    "$.sourceCoordinateSpace",
  );
  if (width * height > SMALL_RASTER_ORACLE_MAX_PIXELS) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
      "Small-raster oracle exceeds its finite pixel limit",
      "$",
      LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
    );
  }
  for (const [name, rows] of Object.entries(oracle.masks)) {
    if (
      !ORACLE_MASK_NAME_PATTERN.test(name)
      || !Array.isArray(rows)
      || rows.length !== height
      || rows.some((row) => (
        !Array.isArray(row)
        || row.length !== width
        || row.some((sample) => !Number.isInteger(sample) || sample < 0 || sample > 255)
      ))
    ) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
        "Small-raster oracle mask rows are invalid",
        `$.masks.${name}`,
      );
    }
  }
  const hasRgba = Object.hasOwn(oracle, "rgbaRows");
  const hasClassifications = Object.hasOwn(oracle, "classificationRows");
  if (hasRgba !== hasClassifications) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
      "Oracle RGBA and classification rows must be present together",
      "$",
    );
  }
  if (hasRgba) {
    if (
      !Array.isArray(oracle.rgbaRows)
      || oracle.rgbaRows.length !== height
      || oracle.rgbaRows.some((row) => (
        !Array.isArray(row)
        || row.length !== width
        || row.some((pixel) => (
          !Array.isArray(pixel)
          || pixel.length !== 4
          || pixel.some((sample) => !Number.isInteger(sample) || sample < 0 || sample > 255)
        ))
      ))
      || !Array.isArray(oracle.classificationRows)
      || oracle.classificationRows.length !== height
      || oracle.classificationRows.some((row) => (
        !Array.isArray(row)
        || row.length !== width
        || row.some((entry) => !CLASSIFICATION_NAME_SET.has(entry))
      ))
    ) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.ORACLE_INVALID,
        "Oracle RGBA or classification rows are invalid",
        "$",
      );
    }
  }
  return oracle;
}

/** Serialize an oracle with stable canonical key ordering and one trailing newline. */
export function serializeSmallRasterOracle(oracle) {
  return serializeCanonicalJsonLine(validateSmallRasterOracle(oracle));
}

function isContainedAbsolutePath(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function validateStagingRelativePath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.startsWith("//")
    || value.startsWith("~")
    || isAbsolute(value)
    || WINDOWS_ABSOLUTE_PATTERN.test(value)
    || URI_SCHEME_PATTERN.test(value)
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "Oracle output path must be a canonical staging-relative path",
      typeof value === "string" ? value : "$",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
    || !value.endsWith(".json")
  ) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "Oracle output must be a JSON file without empty or traversal segments",
      value,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  return segments;
}

async function assertRegularDirectory(path, displayPath) {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "Staging directory is missing or unreadable",
      displayPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "Staging output parents must be regular non-symlink directories",
      displayPath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
}

async function ensureSafeStagingParent(stagingRoot, segments) {
  const realRoot = await realpath(stagingRoot);
  let current = stagingRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!isContainedAbsolutePath(stagingRoot, current)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
        "Oracle output escapes the supplied staging directory",
        segments.join("/"),
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
    try {
      await mkdir(current, { mode: 0o755 });
    } catch (error) {
      if (!isMissing(error) && !(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        fail(
          IMAGE_OPERATION_ISSUE_CODES.OUTPUT_WRITE_FAILED,
          "Oracle staging parent could not be created",
          segments.join("/"),
          LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
        );
      }
    }
    await assertRegularDirectory(current, segments.join("/"));
    const currentRealPath = await realpath(current);
    if (!isContainedAbsolutePath(realRoot, currentRealPath)) {
      fail(
        IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
        "Oracle staging parent resolves outside the supplied staging directory",
        segments.join("/"),
        LAYER_GATE_FAILURE_CODES.PATH_INVALID,
      );
    }
  }
  return current;
}

/** Write only canonical oracle bytes beneath an existing caller-owned staging directory. */
export async function writeSmallRasterOracle({
  oracle,
  relativePath = "small-raster-oracle.json",
  stagingDirectory,
} = {}) {
  if (typeof stagingDirectory !== "string" || stagingDirectory.length === 0) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "A caller-supplied staging directory is required",
      "$.stagingDirectory",
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const stagingRoot = resolve(stagingDirectory);
  await assertRegularDirectory(stagingRoot, "$.stagingDirectory");
  const segments = validateStagingRelativePath(relativePath);
  const filename = segments.at(-1);
  const parentSegments = segments.slice(0, -1);
  const parent = await ensureSafeStagingParent(stagingRoot, parentSegments);
  const outputPath = resolve(parent, filename);
  if (!isContainedAbsolutePath(stagingRoot, outputPath)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "Oracle output escapes the supplied staging directory",
      relativePath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }

  const bytes = serializeSmallRasterOracle(oracle);
  try {
    await writeFile(outputPath, bytes, { flag: "wx", mode: 0o644 });
  } catch {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_WRITE_FAILED,
      "Oracle output must be a new regular file in the supplied staging directory",
      relativePath,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }

  let stats;
  try {
    stats = await lstat(outputPath);
  } catch {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_WRITE_FAILED,
      "Written oracle output cannot be inspected",
      relativePath,
      LAYER_GATE_FAILURE_CODES.INPUT_CHANGED,
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "Written oracle output must remain a regular non-symlink file",
      relativePath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }
  const realRoot = await realpath(stagingRoot);
  const realOutput = await realpath(outputPath);
  if (!isContainedAbsolutePath(realRoot, realOutput)) {
    fail(
      IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
      "Written oracle output resolves outside the supplied staging directory",
      relativePath,
      LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  }

  return Object.freeze({
    byteLength: bytes.byteLength,
    path: relativePath,
    sha256: sha256(bytes),
  });
}
