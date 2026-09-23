import {
  CANONICAL_SOURCE_COORDINATE_SPACE,
  LAYER_GATE_FAILURE_CODES,
  serializeCanonicalJson,
  serializeCanonicalJsonLine,
  sha256,
} from "./contract.mjs";
import {
  SEGMENTATION_EDGE_BAND_RADIUS,
  createMaskEdgeBand,
  createMaskRaster,
} from "./image-operations.mjs";

export const REQUIRED_ALIGNMENT_VIEWPORT_WIDTHS = Object.freeze([
  320,
  390,
  700,
  701,
  1_024,
  1_440,
  2_560,
]);

export const SCREENSHOT_FIDELITY_THRESHOLDS = Object.freeze({
  maximumChannelDifference: 8,
  minimumMatchingPixelRatio: 0.995,
  minimumSsim: 0.995,
});

export const SSIM_CONFIGURATION = Object.freeze({
  dynamicRange: 255,
  edgeMode: "clamp",
  k1: 0.01,
  k2: 0.03,
  luminance: "rec-709",
  sigma: 1.5,
  windowSize: 11,
});

export const ALIGNMENT_TOLERANCE_CSS_PIXELS = 0.5;
export const SOURCE_SPACE_SAMPLE_KINDS = Object.freeze([
  "reference",
  "motion",
  "depth",
]);

export const FIDELITY_ISSUE_CODES = Object.freeze({
  ALIGNMENT_ERROR: "FIDELITY_ALIGNMENT_ERROR",
  ALIGNMENT_VIEWPORT_SET_INVALID: "FIDELITY_ALIGNMENT_VIEWPORT_SET_INVALID",
  ALPHA_COVERAGE_INCOMPLETE: "FIDELITY_ALPHA_COVERAGE_INCOMPLETE",
  DIMENSION_MISMATCH: "FIDELITY_DIMENSION_MISMATCH",
  FOOTPRINT_REPLACEMENT_INCOMPLETE: "FIDELITY_FOOTPRINT_REPLACEMENT_INCOMPLETE",
  IMMUTABLE_BYTES_CHANGED: "FIDELITY_IMMUTABLE_BYTES_CHANGED",
  INPUT_INVALID: "FIDELITY_INPUT_INVALID",
  SCREENSHOT_PIXEL_THRESHOLD: "FIDELITY_SCREENSHOT_PIXEL_THRESHOLD",
  SCREENSHOT_SSIM_THRESHOLD: "FIDELITY_SCREENSHOT_SSIM_THRESHOLD",
});

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SAMPLE_KIND_ORDER = new Map(
  SOURCE_SPACE_SAMPLE_KINDS.map((kind, index) => [kind, index]),
);
const CHANNEL_NAMES = Object.freeze(["red", "green", "blue", "alpha"]);
const MAX_RASTER_DIMENSION = 16_384;
const MAX_RASTER_PIXELS = 16_777_216;
const SSIM_RADIUS = Math.floor(SSIM_CONFIGURATION.windowSize / 2);
const GAUSSIAN_KERNEL = createGaussianKernel(
  SSIM_CONFIGURATION.windowSize,
  SSIM_CONFIGURATION.sigma,
);

export class FidelityGateError extends TypeError {
  constructor(
    issueCode,
    message,
    path = "$",
    code = LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
    report = null,
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
    this.name = "FidelityGateError";
    this.path = path;
    this.report = report;
  }

  toJSON() {
    return this.failure;
  }
}

function fail(
  issueCode,
  message,
  path = "$",
  code = LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
  report = null,
) {
  throw new FidelityGateError(issueCode, message, path, code, report);
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

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !STABLE_ID_PATTERN.test(value)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Identifier must be stable lowercase kebab-case",
      path,
    );
  }
  return value;
}

function assertSha256(value, path) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Input identity must be a lowercase SHA-256 digest",
      path,
    );
  }
  return value;
}

function assertFiniteNumber(value, path, { minimum = -Infinity, maximum = Infinity } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Value must be finite and inside the declared bounds",
      path,
    );
  }
  return value;
}

function assertDimension(value, path) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RASTER_DIMENSION) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      `Raster dimensions must be integers from 1 through ${MAX_RASTER_DIMENSION}`,
      path,
    );
  }
  return value;
}

function detachedUnsignedBytes(value, expectedLength, path) {
  const tag = Object.prototype.toString.call(value);
  const supported = Buffer.isBuffer(value)
    || tag === "[object Uint8Array]"
    || tag === "[object Uint8ClampedArray]";
  if (!ArrayBuffer.isView(value) || !supported || value.byteLength !== expectedLength) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      `Raster data must be an unsigned 8-bit array containing exactly ${expectedLength} bytes`,
      path,
    );
  }
  return Buffer.from(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function normalizeRaster(value, path, channels) {
  if (!isPlainObject(value)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Raster must be a plain object",
      path,
    );
  }
  const width = assertDimension(value.width, `${path}.width`);
  const height = assertDimension(value.height, `${path}.height`);
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_RASTER_PIXELS) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      `Raster may contain at most ${MAX_RASTER_PIXELS} pixels`,
      path,
    );
  }
  return Object.freeze({
    data: detachedUnsignedBytes(value.data, pixelCount * channels, `${path}.data`),
    height,
    width,
  });
}

function normalizeRgbaRaster(value, path) {
  return normalizeRaster(value, path, 4);
}

function normalizeMaskRaster(value, path) {
  const normalized = normalizeRaster(value, path, 1);
  if (
    normalized.width > CANONICAL_SOURCE_COORDINATE_SPACE.width
    || normalized.height > CANONICAL_SOURCE_COORDINATE_SPACE.height
  ) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Source-space masks cannot exceed canonical source dimensions",
      path,
    );
  }
  return createMaskRaster(normalized);
}

function assertSameDimensions(left, right, path) {
  if (left.width !== right.width || left.height !== right.height) {
    fail(
      FIDELITY_ISSUE_CODES.DIMENSION_MISMATCH,
      "Raster dimensions must match exactly",
      path,
    );
  }
}

function normalizeNamedMasks(value, path, width, height, idPrefix) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Mask collection must be an array",
      path,
    );
  }
  const ids = new Set();
  const normalized = value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const explicitlyNamed = isPlainObject(entry) && Object.hasOwn(entry, "mask");
    const id = assertStableId(
      explicitlyNamed ? entry.id : `${idPrefix}-${index + 1}`,
      `${entryPath}.id`,
    );
    if (ids.has(id)) {
      fail(
        FIDELITY_ISSUE_CODES.INPUT_INVALID,
        "Mask IDs must be unique within their collection",
        `${entryPath}.id`,
      );
    }
    ids.add(id);
    const mask = normalizeMaskRaster(explicitlyNamed ? entry.mask : entry, `${entryPath}.mask`);
    if (mask.width !== width || mask.height !== height) {
      fail(
        FIDELITY_ISSUE_CODES.DIMENSION_MISMATCH,
        "Every source-space mask must match the source dimensions",
        `${entryPath}.mask`,
      );
    }
    return Object.freeze({ id, mask });
  });
  normalized.sort((left, right) => lexicalCompare(left.id, right.id));
  return Object.freeze(normalized);
}

function rasterIdentity(raster) {
  return Object.freeze({
    byteLength: raster.data.byteLength,
    channels: 4,
    height: raster.height,
    sha256: sha256(raster.data),
    width: raster.width,
  });
}

function maskIdentity(mask, id = undefined) {
  const identity = {
    alphaSum: mask.alphaSum,
    byteLength: mask.data.byteLength,
    height: mask.height,
    nonZeroPixelCount: mask.nonZeroPixelCount,
    sha256: sha256(mask.data),
    width: mask.width,
  };
  if (id !== undefined) identity.id = id;
  return Object.freeze(identity);
}

function namedMaskIdentities(entries) {
  return Object.freeze(entries.map(({ id, mask }) => maskIdentity(mask, id)));
}

function createBinaryUnion(width, height, entries) {
  const data = Buffer.alloc(width * height);
  for (const entry of entries) {
    const mask = entry.mask ?? entry;
    for (let pixel = 0; pixel < data.byteLength; pixel += 1) {
      if (mask.data[pixel] !== 0) data[pixel] = 255;
    }
  }
  return createMaskRaster({ data, height, width });
}

function invertBinaryMask(mask) {
  return createMaskRaster({
    data: Uint8Array.from(mask.data, (alpha) => (alpha === 0 ? 255 : 0)),
    height: mask.height,
    width: mask.width,
  });
}

function normalizeRegionInputs(options, width, height) {
  const segmentationMasks = normalizeNamedMasks(
    options.segmentationMasks,
    "$.segmentationMasks",
    width,
    height,
    "segmentation-mask",
  );
  const approvedChangeMasks = normalizeNamedMasks(
    options.approvedChangeMasks,
    "$.approvedChangeMasks",
    width,
    height,
    "approved-change-mask",
  );
  const reconstructionMasks = normalizeNamedMasks(
    options.reconstructionMasks,
    "$.reconstructionMasks",
    width,
    height,
    "reconstruction-mask",
  );
  const sweepMasks = normalizeNamedMasks(
    options.sweepMasks,
    "$.sweepMasks",
    width,
    height,
    "sweep-mask",
  );
  const segmentationEdgeBands = Object.freeze(segmentationMasks.map(({ id, mask }) => (
    Object.freeze({
      id: `${id}-edge-band`,
      mask: createMaskEdgeBand(mask, SEGMENTATION_EDGE_BAND_RADIUS),
    })
  )));
  const segmentationEdgeBand = createBinaryUnion(
    width,
    height,
    segmentationEdgeBands,
  );
  const approvedChangeRegion = createBinaryUnion(width, height, [
    segmentationEdgeBand,
    ...approvedChangeMasks,
    ...reconstructionMasks,
    ...sweepMasks,
  ]);
  const immutableRegion = invertBinaryMask(approvedChangeRegion);
  return Object.freeze({
    approvedChangeMasks,
    approvedChangeRegion,
    immutableRegion,
    reconstructionMasks,
    segmentationEdgeBand,
    segmentationEdgeBands,
    segmentationMasks,
    sweepMasks,
  });
}

/**
 * Derive the binary segmentation edge band, approved-change region, and immutable
 * region in one source coordinate space. Any nonzero authored sample denotes region
 * membership; the derived masks use only 0 and 255.
 */
export function deriveFidelityRegions({
  approvedChangeMasks = [],
  height,
  reconstructionMasks = [],
  segmentationMasks = [],
  sweepMasks = [],
  width,
} = {}) {
  const normalizedWidth = assertDimension(width, "$.width");
  const normalizedHeight = assertDimension(height, "$.height");
  if (
    normalizedWidth > CANONICAL_SOURCE_COORDINATE_SPACE.width
    || normalizedHeight > CANONICAL_SOURCE_COORDINATE_SPACE.height
  ) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Source-space regions cannot exceed canonical source dimensions",
      "$",
    );
  }
  return normalizeRegionInputs({
    approvedChangeMasks,
    reconstructionMasks,
    segmentationMasks,
    sweepMasks,
  }, normalizedWidth, normalizedHeight);
}

export const deriveApprovedChangeRegions = deriveFidelityRegions;

function compareSourcePixels(source, composition, approvedChangeRegion) {
  let changedByteCount = 0;
  let changedPixelCount = 0;
  let changedOutsideApprovedByteCount = 0;
  let changedOutsideApprovedPixelCount = 0;
  let firstDifference = null;
  let firstOutsideApprovedDifference = null;
  const pixelCount = source.width * source.height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    let pixelChanged = false;
    let outsideByteCount = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const expected = source.data[offset + channel];
      const actual = composition.data[offset + channel];
      if (actual === expected) continue;
      pixelChanged = true;
      changedByteCount += 1;
      const difference = Object.freeze({
        actual,
        channel: CHANNEL_NAMES[channel],
        expected,
        pixelIndex: pixel,
        x: pixel % source.width,
        y: Math.floor(pixel / source.width),
      });
      if (firstDifference === null) firstDifference = difference;
      if (approvedChangeRegion.data[pixel] === 0) {
        outsideByteCount += 1;
        if (firstOutsideApprovedDifference === null) {
          firstOutsideApprovedDifference = difference;
        }
      }
    }
    if (!pixelChanged) continue;
    changedPixelCount += 1;
    if (outsideByteCount !== 0) {
      changedOutsideApprovedPixelCount += 1;
      changedOutsideApprovedByteCount += outsideByteCount;
    }
  }
  return Object.freeze({
    changedByteCount,
    changedInsideApprovedPixelCount: changedPixelCount - changedOutsideApprovedPixelCount,
    changedOutsideApprovedByteCount,
    changedOutsideApprovedPixelCount,
    changedPixelCount,
    exactByteEquality: changedByteCount === 0,
    firstDifference,
    firstOutsideApprovedDifference,
    immutableBytesPreserved: changedOutsideApprovedByteCount === 0,
  });
}

function inspectAlphaCoverage(composition, presentationMask = null) {
  let checkedPixelCount = 0;
  let nonOpaquePixelCount = 0;
  let transparentPixelCount = 0;
  let firstNonOpaquePixel = null;
  const pixelCount = composition.width * composition.height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (presentationMask !== null && presentationMask.data[pixel] === 0) continue;
    checkedPixelCount += 1;
    const alpha = composition.data[pixel * 4 + 3];
    if (alpha === 255) continue;
    nonOpaquePixelCount += 1;
    if (alpha === 0) transparentPixelCount += 1;
    if (firstNonOpaquePixel === null) {
      firstNonOpaquePixel = Object.freeze({
        alpha,
        pixelIndex: pixel,
        x: pixel % composition.width,
        y: Math.floor(pixel / composition.width),
      });
    }
  }
  return Object.freeze({
    checkedPixelCount,
    completeOpaqueCoverage: nonOpaquePixelCount === 0,
    firstNonOpaquePixel,
    nonOpaquePixelCount,
    transparentPixelCount,
  });
}

function inspectFootprintReplacement(source, reconstructedBackground, footprintMasks) {
  const footprintRegion = createBinaryUnion(source.width, source.height, footprintMasks);
  if (footprintRegion.nonZeroPixelCount === 0) {
    return Object.freeze({
      completeFootprintReplacement: true,
      firstNonOpaquePixel: null,
      firstResidualPixel: null,
      footprintPixelCount: 0,
      nonOpaquePixelCount: 0,
      residualSourcePixelCount: 0,
    });
  }
  if (reconstructedBackground === null) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "A reconstructed background is required when reference footprint masks are declared",
      "$.reconstructedBackground",
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
    );
  }

  let nonOpaquePixelCount = 0;
  let residualSourcePixelCount = 0;
  let firstNonOpaquePixel = null;
  let firstResidualPixel = null;
  for (let pixel = 0; pixel < footprintRegion.data.byteLength; pixel += 1) {
    if (footprintRegion.data[pixel] === 0) continue;
    const offset = pixel * 4;
    const alpha = reconstructedBackground.data[offset + 3];
    if (alpha !== 255) {
      nonOpaquePixelCount += 1;
      if (firstNonOpaquePixel === null) {
        firstNonOpaquePixel = Object.freeze({
          alpha,
          pixelIndex: pixel,
          x: pixel % source.width,
          y: Math.floor(pixel / source.width),
        });
      }
    }
    if (source.data.subarray(offset, offset + 4).equals(
      reconstructedBackground.data.subarray(offset, offset + 4),
    )) {
      residualSourcePixelCount += 1;
      if (firstResidualPixel === null) {
        firstResidualPixel = Object.freeze({
          pixelIndex: pixel,
          x: pixel % source.width,
          y: Math.floor(pixel / source.width),
        });
      }
    }
  }
  return Object.freeze({
    completeFootprintReplacement: nonOpaquePixelCount === 0
      && residualSourcePixelCount === 0,
    firstNonOpaquePixel,
    firstResidualPixel,
    footprintPixelCount: footprintRegion.nonZeroPixelCount,
    nonOpaquePixelCount,
    residualSourcePixelCount,
  });
}

function failureRecord(code, issueCode, message, path) {
  return Object.freeze({ code, issueCode, message, path });
}

function assertSampleKind(value) {
  if (!SOURCE_SPACE_SAMPLE_KINDS.includes(value)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Sample kind must be reference, motion, or depth",
      "$.sampleKind",
    );
  }
  return value;
}

/**
 * Produce a deterministic source-space truth report. Browser screenshots are not
 * accepted here: source and composition must be lossless RGBA rasters in one space.
 */
export function createSourceSpaceFidelityReport({
  approvedChangeMasks = [],
  canonicalSource,
  composition,
  poseId,
  presentationMask = undefined,
  reconstructedBackground = undefined,
  reconstructionMasks = [],
  referenceFootprintMasks = [],
  sampleKind = "reference",
  segmentationMasks = [],
  sweepMasks = [],
} = {}) {
  const normalizedPoseId = assertStableId(poseId, "$.poseId");
  const normalizedSampleKind = assertSampleKind(sampleKind);
  const source = normalizeRgbaRaster(canonicalSource, "$.canonicalSource");
  const normalizedComposition = normalizeRgbaRaster(composition, "$.composition");
  assertSameDimensions(source, normalizedComposition, "$.composition");

  const regions = normalizeRegionInputs({
    approvedChangeMasks,
    reconstructionMasks,
    segmentationMasks,
    sweepMasks,
  }, source.width, source.height);
  const normalizedPresentationMask = presentationMask === undefined
    ? null
    : normalizeMaskRaster(presentationMask, "$.presentationMask");
  if (normalizedPresentationMask !== null) {
    assertSameDimensions(source, normalizedPresentationMask, "$.presentationMask");
  }
  const footprintMasks = normalizeNamedMasks(
    referenceFootprintMasks,
    "$.referenceFootprintMasks",
    source.width,
    source.height,
    "reference-footprint-mask",
  );
  const normalizedBackground = reconstructedBackground === undefined
    ? null
    : normalizeRgbaRaster(reconstructedBackground, "$.reconstructedBackground");
  if (normalizedBackground !== null) {
    assertSameDimensions(source, normalizedBackground, "$.reconstructedBackground");
  }

  const sourceComparison = compareSourcePixels(
    source,
    normalizedComposition,
    regions.approvedChangeRegion,
  );
  const alphaCoverage = inspectAlphaCoverage(
    normalizedComposition,
    normalizedPresentationMask,
  );
  const footprintReplacement = inspectFootprintReplacement(
    source,
    normalizedBackground,
    footprintMasks,
  );

  const failures = [];
  if (!sourceComparison.immutableBytesPreserved) {
    failures.push(failureRecord(
      LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
      FIDELITY_ISSUE_CODES.IMMUTABLE_BYTES_CHANGED,
      "Composition changed at least one byte outside the approved-change region",
      "$.composition.data",
    ));
  }
  if (!alphaCoverage.completeOpaqueCoverage) {
    failures.push(failureRecord(
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      FIDELITY_ISSUE_CODES.ALPHA_COVERAGE_INCOMPLETE,
      "Composition does not provide opaque coverage for every presentation pixel",
      "$.composition.data",
    ));
  }
  if (!footprintReplacement.completeFootprintReplacement) {
    failures.push(failureRecord(
      LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
      FIDELITY_ISSUE_CODES.FOOTPRINT_REPLACEMENT_INCOMPLETE,
      "Reconstructed background does not replace the complete reference footprint",
      "$.reconstructedBackground.data",
    ));
  }

  const report = {
    browserCaptureIncluded: false,
    checks: {
      alphaCoverage,
      changeConfinement: Object.freeze({
        changedInsideApprovedPixelCount: sourceComparison.changedInsideApprovedPixelCount,
        changedOutsideApprovedByteCount: sourceComparison.changedOutsideApprovedByteCount,
        changedOutsideApprovedPixelCount: sourceComparison.changedOutsideApprovedPixelCount,
        firstOutsideApprovedDifference: sourceComparison.firstOutsideApprovedDifference,
        ok: sourceComparison.immutableBytesPreserved,
      }),
      completeFootprintReplacement: footprintReplacement,
      immutableBytes: Object.freeze({
        firstMismatch: sourceComparison.firstOutsideApprovedDifference,
        mismatchByteCount: sourceComparison.changedOutsideApprovedByteCount,
        mismatchPixelCount: sourceComparison.changedOutsideApprovedPixelCount,
        ok: sourceComparison.immutableBytesPreserved,
      }),
      losslessReferenceComparison: sourceComparison,
    },
    derived: {
      approvedChangeRegion: maskIdentity(regions.approvedChangeRegion),
      immutableRegion: maskIdentity(regions.immutableRegion),
      segmentationEdgeBand: maskIdentity(regions.segmentationEdgeBand),
      segmentationEdgeBands: namedMaskIdentities(regions.segmentationEdgeBands),
    },
    failures,
    inputs: {
      approvedChangeMasks: namedMaskIdentities(regions.approvedChangeMasks),
      canonicalSource: rasterIdentity(source),
      composition: rasterIdentity(normalizedComposition),
      presentationMask: normalizedPresentationMask === null
        ? null
        : maskIdentity(normalizedPresentationMask, "presentation-mask"),
      reconstructedBackground: normalizedBackground === null
        ? null
        : rasterIdentity(normalizedBackground),
      reconstructionMasks: namedMaskIdentities(regions.reconstructionMasks),
      referenceFootprintMasks: namedMaskIdentities(footprintMasks),
      segmentationMasks: namedMaskIdentities(regions.segmentationMasks),
      sweepMasks: namedMaskIdentities(regions.sweepMasks),
    },
    ok: failures.length === 0,
    poseId: normalizedPoseId,
    reportType: "source-space-fidelity",
    sampleKind: normalizedSampleKind,
    schemaVersion: 1,
    sourceSpaceTruth: true,
  };
  return deepFreeze(report);
}

export const compareSourceSpaceReference = createSourceSpaceFidelityReport;
export const renderFidelitySampleReport = createSourceSpaceFidelityReport;
export const renderDeterministicSampleReport = createSourceSpaceFidelityReport;

export function assertSourceSpaceFidelity(options) {
  const report = createSourceSpaceFidelityReport(options);
  if (report.ok) return report;
  const firstFailure = report.failures[0];
  throw new FidelityGateError(
    firstFailure.issueCode,
    firstFailure.message,
    firstFailure.path,
    firstFailure.code,
    report,
  );
}

export const validateSourceSpaceFidelity = assertSourceSpaceFidelity;

/** Produce a standalone opaque-coverage report for a composed pose. */
export function createAlphaCoverageReport({
  composition,
  poseId,
  presentationMask = undefined,
} = {}) {
  const normalizedPoseId = assertStableId(poseId, "$.poseId");
  const normalizedComposition = normalizeRgbaRaster(composition, "$.composition");
  const normalizedPresentationMask = presentationMask === undefined
    ? null
    : normalizeMaskRaster(presentationMask, "$.presentationMask");
  if (normalizedPresentationMask !== null) {
    assertSameDimensions(
      normalizedComposition,
      normalizedPresentationMask,
      "$.presentationMask",
    );
  }
  const coverage = inspectAlphaCoverage(
    normalizedComposition,
    normalizedPresentationMask,
  );
  const failures = coverage.completeOpaqueCoverage
    ? []
    : [failureRecord(
        LAYER_GATE_FAILURE_CODES.RECONSTRUCTION_INVALID,
        FIDELITY_ISSUE_CODES.ALPHA_COVERAGE_INCOMPLETE,
        "Composition does not provide opaque coverage for every presentation pixel",
        "$.composition.data",
      )];
  return deepFreeze({
    browserCaptureIncluded: false,
    checks: { alphaCoverage: coverage },
    failures,
    inputs: {
      composition: rasterIdentity(normalizedComposition),
      presentationMask: normalizedPresentationMask === null
        ? null
        : maskIdentity(normalizedPresentationMask, "presentation-mask"),
    },
    ok: failures.length === 0,
    poseId: normalizedPoseId,
    reportType: "alpha-coverage",
    schemaVersion: 1,
    sourceSpaceTruth: true,
  });
}

export function assertAlphaCoverage(options) {
  const report = createAlphaCoverageReport(options);
  if (report.ok) return report;
  const firstFailure = report.failures[0];
  throw new FidelityGateError(
    firstFailure.issueCode,
    firstFailure.message,
    firstFailure.path,
    firstFailure.code,
    report,
  );
}

export const validateAlphaCoverage = assertAlphaCoverage;
export const validateCompleteAlphaCoverage = assertAlphaCoverage;

/** Render a byte-stable suite report, sorted by sample kind and pose ID. */
export function renderFidelitySampleReports(value) {
  const samples = Array.isArray(value) ? value : value?.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "At least one source-space sample is required",
      "$.samples",
    );
  }
  const reports = samples.map((sample) => createSourceSpaceFidelityReport(sample));
  reports.sort((left, right) => (
    SAMPLE_KIND_ORDER.get(left.sampleKind) - SAMPLE_KIND_ORDER.get(right.sampleKind)
    || lexicalCompare(left.poseId, right.poseId)
  ));
  const poseIds = reports.map(({ poseId }) => poseId);
  if (new Set(poseIds).size !== poseIds.length) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Pose IDs must be unique within a sample report set",
      "$.samples",
    );
  }
  const inputProjection = reports.map(({ inputs, poseId, sampleKind }) => ({
    inputs,
    poseId,
    sampleKind,
  }));
  return deepFreeze({
    inputSetSha256: sha256(serializeCanonicalJson(inputProjection)),
    ok: reports.every(({ ok }) => ok),
    poseIds,
    reportType: "source-space-fidelity-samples",
    reports,
    sampleCount: reports.length,
    schemaVersion: 1,
  });
}

export function assertFidelitySampleReports(value) {
  const report = renderFidelitySampleReports(value);
  if (report.ok) return report;
  const failedSample = report.reports.find(({ ok }) => !ok);
  const firstFailure = failedSample.failures[0];
  throw new FidelityGateError(
    firstFailure.issueCode,
    firstFailure.message,
    firstFailure.path,
    firstFailure.code,
    report,
  );
}

function createGaussianKernel(windowSize, sigma) {
  const radius = Math.floor(windowSize / 2);
  const kernel = [];
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(weight);
    sum += weight;
  }
  return Object.freeze(kernel.map((weight) => weight / sum));
}

function createLuminance(raster) {
  const luminance = new Float64Array(raster.width * raster.height);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const offset = pixel * 4;
    luminance[pixel] = raster.data[offset] * 0.2126
      + raster.data[offset + 1] * 0.7152
      + raster.data[offset + 2] * 0.0722;
  }
  return luminance;
}

function gaussianBlur(signal, width, height) {
  const horizontal = new Float64Array(signal.length);
  const output = new Float64Array(signal.length);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let kernelIndex = 0; kernelIndex < GAUSSIAN_KERNEL.length; kernelIndex += 1) {
        const sourceX = Math.max(
          0,
          Math.min(width - 1, x + kernelIndex - SSIM_RADIUS),
        );
        sum += signal[rowOffset + sourceX] * GAUSSIAN_KERNEL[kernelIndex];
      }
      horizontal[rowOffset + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let kernelIndex = 0; kernelIndex < GAUSSIAN_KERNEL.length; kernelIndex += 1) {
        const sourceY = Math.max(
          0,
          Math.min(height - 1, y + kernelIndex - SSIM_RADIUS),
        );
        sum += horizontal[sourceY * width + x] * GAUSSIAN_KERNEL[kernelIndex];
      }
      output[y * width + x] = sum;
    }
  }
  return output;
}

function blurredProduct(left, right, width, height) {
  const product = new Float64Array(left.length);
  for (let index = 0; index < product.length; index += 1) {
    product[index] = left[index] * right[index];
  }
  return gaussianBlur(product, width, height);
}

function calculateSsim(reference, actual) {
  if (reference.data.equals(actual.data)) return 1;
  const referenceLuminance = createLuminance(reference);
  const actualLuminance = createLuminance(actual);
  const referenceMean = gaussianBlur(referenceLuminance, reference.width, reference.height);
  const actualMean = gaussianBlur(actualLuminance, actual.width, actual.height);
  const referenceSecondMoment = blurredProduct(
    referenceLuminance,
    referenceLuminance,
    reference.width,
    reference.height,
  );
  const actualSecondMoment = blurredProduct(
    actualLuminance,
    actualLuminance,
    actual.width,
    actual.height,
  );
  const crossMoment = blurredProduct(
    referenceLuminance,
    actualLuminance,
    reference.width,
    reference.height,
  );
  const c1 = (SSIM_CONFIGURATION.k1 * SSIM_CONFIGURATION.dynamicRange) ** 2;
  const c2 = (SSIM_CONFIGURATION.k2 * SSIM_CONFIGURATION.dynamicRange) ** 2;
  let scoreSum = 0;
  for (let pixel = 0; pixel < referenceLuminance.length; pixel += 1) {
    const meanReference = referenceMean[pixel];
    const meanActual = actualMean[pixel];
    const varianceReference = Math.max(
      0,
      referenceSecondMoment[pixel] - meanReference * meanReference,
    );
    const varianceActual = Math.max(
      0,
      actualSecondMoment[pixel] - meanActual * meanActual,
    );
    const covariance = crossMoment[pixel] - meanReference * meanActual;
    const numerator = (2 * meanReference * meanActual + c1)
      * (2 * covariance + c2);
    const denominator = (meanReference * meanReference + meanActual * meanActual + c1)
      * (varianceReference + varianceActual + c2);
    scoreSum += numerator / denominator;
  }
  return Math.max(-1, Math.min(1, scoreSum / referenceLuminance.length));
}

/** Compare two already captured RGBA screenshots; this is not source-space truth. */
export function compareScreenshotFidelity({ actual, poseId, reference } = {}) {
  const normalizedPoseId = assertStableId(poseId, "$.poseId");
  const normalizedReference = normalizeRgbaRaster(reference, "$.reference");
  const normalizedActual = normalizeRgbaRaster(actual, "$.actual");
  assertSameDimensions(normalizedReference, normalizedActual, "$.actual");

  const pixelCount = normalizedReference.width * normalizedReference.height;
  let matchingPixelCount = 0;
  let maximumObservedChannelDifference = 0;
  let firstPixelOutsideTolerance = null;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    let maximumPixelDifference = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      maximumPixelDifference = Math.max(
        maximumPixelDifference,
        Math.abs(
          normalizedReference.data[offset + channel]
          - normalizedActual.data[offset + channel],
        ),
      );
    }
    maximumObservedChannelDifference = Math.max(
      maximumObservedChannelDifference,
      maximumPixelDifference,
    );
    if (maximumPixelDifference <= SCREENSHOT_FIDELITY_THRESHOLDS.maximumChannelDifference) {
      matchingPixelCount += 1;
    } else if (firstPixelOutsideTolerance === null) {
      firstPixelOutsideTolerance = Object.freeze({
        maximumChannelDifference: maximumPixelDifference,
        pixelIndex: pixel,
        x: pixel % normalizedReference.width,
        y: Math.floor(pixel / normalizedReference.width),
      });
    }
  }

  const matchingPixelRatio = matchingPixelCount / pixelCount;
  const ssim = calculateSsim(normalizedReference, normalizedActual);
  const pixelThresholdPassed = matchingPixelRatio
    >= SCREENSHOT_FIDELITY_THRESHOLDS.minimumMatchingPixelRatio;
  const ssimThresholdPassed = ssim >= SCREENSHOT_FIDELITY_THRESHOLDS.minimumSsim;
  const failures = [];
  if (!ssimThresholdPassed) {
    failures.push(failureRecord(
      LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
      FIDELITY_ISSUE_CODES.SCREENSHOT_SSIM_THRESHOLD,
      "Screenshot structural similarity is below the approved threshold",
      "$.actual.data",
    ));
  }
  if (!pixelThresholdPassed) {
    failures.push(failureRecord(
      LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
      FIDELITY_ISSUE_CODES.SCREENSHOT_PIXEL_THRESHOLD,
      "Too few screenshot pixels satisfy the approved per-channel tolerance",
      "$.actual.data",
    ));
  }

  return deepFreeze({
    browserCaptureIncluded: true,
    checks: {
      perPixel: {
        firstPixelOutsideTolerance,
        matchingPixelCount,
        matchingPixelRatio,
        maximumObservedChannelDifference,
        ok: pixelThresholdPassed,
        pixelCount,
      },
      ssim: {
        configuration: SSIM_CONFIGURATION,
        ok: ssimThresholdPassed,
        value: ssim,
      },
    },
    failures,
    inputs: {
      actual: rasterIdentity(normalizedActual),
      reference: rasterIdentity(normalizedReference),
    },
    ok: failures.length === 0,
    poseId: normalizedPoseId,
    reportType: "screenshot-fidelity",
    schemaVersion: 1,
    sourceSpaceTruth: false,
    thresholds: SCREENSHOT_FIDELITY_THRESHOLDS,
  });
}

export const compareScreenshots = compareScreenshotFidelity;

export function assertScreenshotFidelity(options) {
  const report = compareScreenshotFidelity(options);
  if (report.ok) return report;
  const firstFailure = report.failures[0];
  throw new FidelityGateError(
    firstFailure.issueCode,
    firstFailure.message,
    firstFailure.path,
    firstFailure.code,
    report,
  );
}

function assertPositiveFiniteDimension(value, path) {
  return assertFiniteNumber(value, path, { minimum: Number.MIN_VALUE });
}

/** Compute the predecessor-equivalent centered object-fit: cover transform. */
export function createCanonicalCoverTransform({
  sourceHeight = CANONICAL_SOURCE_COORDINATE_SPACE.height,
  sourceWidth = CANONICAL_SOURCE_COORDINATE_SPACE.width,
  viewportHeight,
  viewportWidth,
} = {}) {
  const normalizedSourceWidth = assertPositiveFiniteDimension(sourceWidth, "$.sourceWidth");
  const normalizedSourceHeight = assertPositiveFiniteDimension(sourceHeight, "$.sourceHeight");
  const normalizedViewportWidth = assertPositiveFiniteDimension(
    viewportWidth,
    "$.viewportWidth",
  );
  const normalizedViewportHeight = assertPositiveFiniteDimension(
    viewportHeight,
    "$.viewportHeight",
  );
  const coverScale = Math.max(
    normalizedViewportWidth / normalizedSourceWidth,
    normalizedViewportHeight / normalizedSourceHeight,
  );
  const renderedWidth = normalizedSourceWidth * coverScale;
  const renderedHeight = normalizedSourceHeight * coverScale;
  return Object.freeze({
    coverScale,
    offsetX: (normalizedViewportWidth - renderedWidth) * 0.5,
    offsetY: (normalizedViewportHeight - renderedHeight) * 0.5,
    renderedHeight,
    renderedWidth,
    sourceHeight: normalizedSourceHeight,
    sourceWidth: normalizedSourceWidth,
    viewportHeight: normalizedViewportHeight,
    viewportWidth: normalizedViewportWidth,
  });
}

export const computeCanonicalCoverTransform = createCanonicalCoverTransform;

function normalizeSourcePoint(value, path, { allowBoundary = true } = {}) {
  if (!isPlainObject(value)) {
    fail(FIDELITY_ISSUE_CODES.INPUT_INVALID, "Source point must be an object", path);
  }
  const maximumX = allowBoundary
    ? CANONICAL_SOURCE_COORDINATE_SPACE.width
    : CANONICAL_SOURCE_COORDINATE_SPACE.width - Number.EPSILON;
  const maximumY = allowBoundary
    ? CANONICAL_SOURCE_COORDINATE_SPACE.height
    : CANONICAL_SOURCE_COORDINATE_SPACE.height - Number.EPSILON;
  return Object.freeze({
    x: assertFiniteNumber(value.x, `${path}.x`, { minimum: 0, maximum: maximumX }),
    y: assertFiniteNumber(value.y, `${path}.y`, { minimum: 0, maximum: maximumY }),
  });
}

function projectPointWithTransform(point, transform) {
  return Object.freeze({
    x: transform.offsetX + point.x * transform.coverScale,
    y: transform.offsetY + point.y * transform.coverScale,
  });
}

export function projectCanonicalPoint(point, transform) {
  const normalizedPoint = normalizeSourcePoint(point, "$.point");
  if (!isPlainObject(transform)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Cover transform must be an object",
      "$.transform",
    );
  }
  const normalizedTransform = {
    coverScale: assertPositiveFiniteDimension(
      transform.coverScale,
      "$.transform.coverScale",
    ),
    offsetX: assertFiniteNumber(transform.offsetX, "$.transform.offsetX"),
    offsetY: assertFiniteNumber(transform.offsetY, "$.transform.offsetY"),
  };
  return projectPointWithTransform(normalizedPoint, normalizedTransform);
}

export function projectCanonicalRect(rect, transform) {
  if (!isPlainObject(rect)) {
    fail(FIDELITY_ISSUE_CODES.INPUT_INVALID, "Source rectangle must be an object", "$.rect");
  }
  const topLeft = normalizeSourcePoint({ x: rect.x, y: rect.y }, "$.rect");
  const width = assertFiniteNumber(rect.width, "$.rect.width", {
    minimum: Number.MIN_VALUE,
    maximum: CANONICAL_SOURCE_COORDINATE_SPACE.width - topLeft.x,
  });
  const height = assertFiniteNumber(rect.height, "$.rect.height", {
    minimum: Number.MIN_VALUE,
    maximum: CANONICAL_SOURCE_COORDINATE_SPACE.height - topLeft.y,
  });
  const projected = projectCanonicalPoint(topLeft, transform);
  return Object.freeze({
    height: height * transform.coverScale,
    width: width * transform.coverScale,
    x: projected.x,
    y: projected.y,
  });
}

function normalizeObservedTransform(value, path) {
  if (!isPlainObject(value)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Observed cover transform must be an object",
      path,
    );
  }
  const coverScale = value.coverScale ?? value.scale;
  return Object.freeze({
    coverScale: assertPositiveFiniteDimension(coverScale, `${path}.coverScale`),
    offsetX: assertFiniteNumber(value.offsetX, `${path}.offsetX`),
    offsetY: assertFiniteNumber(value.offsetY, `${path}.offsetY`),
  });
}

function normalizeAlignmentAnchor(value, path) {
  if (!isPlainObject(value)) {
    fail(FIDELITY_ISSUE_CODES.INPUT_INVALID, "Alignment anchor must be an object", path);
  }
  const source = normalizeSourcePoint(value.source, `${path}.source`);
  const observed = value.observed === undefined
    ? null
    : normalizeSourcePointLike(value.observed, `${path}.observed`);
  return Object.freeze({
    id: assertStableId(value.id, `${path}.id`),
    observed,
    source,
  });
}

function normalizeSourcePointLike(value, path) {
  if (!isPlainObject(value)) {
    fail(FIDELITY_ISSUE_CODES.INPUT_INVALID, "Projected point must be an object", path);
  }
  return Object.freeze({
    x: assertFiniteNumber(value.x, `${path}.x`),
    y: assertFiniteNumber(value.y, `${path}.y`),
  });
}

function normalizeAlignmentSample(value, index) {
  const path = `$.samples[${index}]`;
  if (!isPlainObject(value)) {
    fail(FIDELITY_ISSUE_CODES.INPUT_INVALID, "Alignment sample must be an object", path);
  }
  const viewport = isPlainObject(value.viewport) ? value.viewport : value;
  const viewportWidth = assertFiniteNumber(
    viewport.width ?? value.viewportWidth,
    `${path}.viewport.width`,
    { minimum: Number.MIN_VALUE },
  );
  const viewportHeight = assertFiniteNumber(
    viewport.height ?? value.viewportHeight,
    `${path}.viewport.height`,
    { minimum: Number.MIN_VALUE },
  );
  if (!Number.isSafeInteger(viewportWidth)) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Alignment viewport width must be an integer CSS-pixel width",
      `${path}.viewport.width`,
    );
  }
  const anchorsValue = value.anchors ?? [];
  if (!Array.isArray(anchorsValue)) {
    fail(FIDELITY_ISSUE_CODES.INPUT_INVALID, "Alignment anchors must be an array", `${path}.anchors`);
  }
  const anchors = anchorsValue.map((anchor, anchorIndex) => (
    normalizeAlignmentAnchor(anchor, `${path}.anchors[${anchorIndex}]`)
  ));
  const anchorIds = anchors.map(({ id }) => id);
  if (new Set(anchorIds).size !== anchorIds.length) {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Alignment anchor IDs must be unique within a viewport sample",
      `${path}.anchors`,
    );
  }
  anchors.sort((left, right) => lexicalCompare(left.id, right.id));
  return Object.freeze({
    anchors: Object.freeze(anchors),
    observed: normalizeObservedTransform(value.observed, `${path}.observed`),
    viewport: Object.freeze({ height: viewportHeight, width: viewportWidth }),
  });
}

function alignmentDifference(expected, actual, id) {
  const deltaX = Math.abs(actual.x - expected.x);
  const deltaY = Math.abs(actual.y - expected.y);
  return Object.freeze({
    actual,
    deltaX,
    deltaY,
    expected,
    id,
    maximumAxisError: Math.max(deltaX, deltaY),
  });
}

/**
 * Validate canonical-to-viewport mapping at every mandatory profile/boundary width.
 * The caller supplies observed transforms (and optional observed pivot/boundary
 * anchors); no browser screenshot is treated as source-space evidence.
 */
export function checkCanonicalViewportAlignment({
  canonicalSourceSha256,
  poseId,
  samples,
} = {}) {
  const normalizedPoseId = assertStableId(poseId, "$.poseId");
  const sourceSha256 = assertSha256(canonicalSourceSha256, "$.canonicalSourceSha256");
  if (!Array.isArray(samples)) {
    fail(FIDELITY_ISSUE_CODES.INPUT_INVALID, "Alignment samples must be an array", "$.samples");
  }
  const normalizedSamples = samples.map(normalizeAlignmentSample);
  normalizedSamples.sort((left, right) => left.viewport.width - right.viewport.width);
  const widths = normalizedSamples.map(({ viewport }) => viewport.width);
  const missingViewportWidths = REQUIRED_ALIGNMENT_VIEWPORT_WIDTHS.filter(
    (width) => !widths.includes(width),
  );
  const unexpectedViewportWidths = widths.filter(
    (width) => !REQUIRED_ALIGNMENT_VIEWPORT_WIDTHS.includes(width),
  );
  const duplicateViewportWidths = [...new Set(widths.filter(
    (width, index) => widths.indexOf(width) !== index,
  ))].sort((left, right) => left - right);

  const canonicalPoints = Object.freeze([
    Object.freeze({ id: "source-bottom-left", x: 0, y: CANONICAL_SOURCE_COORDINATE_SPACE.height }),
    Object.freeze({
      id: "source-bottom-right",
      x: CANONICAL_SOURCE_COORDINATE_SPACE.width,
      y: CANONICAL_SOURCE_COORDINATE_SPACE.height,
    }),
    Object.freeze({
      id: "source-center",
      x: CANONICAL_SOURCE_COORDINATE_SPACE.width / 2,
      y: CANONICAL_SOURCE_COORDINATE_SPACE.height / 2,
    }),
    Object.freeze({ id: "source-top-left", x: 0, y: 0 }),
    Object.freeze({
      id: "source-top-right",
      x: CANONICAL_SOURCE_COORDINATE_SPACE.width,
      y: 0,
    }),
  ]);

  const viewportReports = normalizedSamples.map((sample) => {
    const expectedTransform = createCanonicalCoverTransform({
      viewportHeight: sample.viewport.height,
      viewportWidth: sample.viewport.width,
    });
    const transformChecks = canonicalPoints.map((point) => alignmentDifference(
      projectPointWithTransform(point, expectedTransform),
      projectPointWithTransform(point, sample.observed),
      point.id,
    ));
    const anchorChecks = sample.anchors.map((anchor) => {
      const expected = projectPointWithTransform(anchor.source, expectedTransform);
      const actual = anchor.observed ?? projectPointWithTransform(anchor.source, sample.observed);
      return alignmentDifference(expected, actual, anchor.id);
    });
    const checks = [...transformChecks, ...anchorChecks];
    const maximumAlignmentErrorCssPixels = checks.reduce(
      (maximum, check) => Math.max(maximum, check.maximumAxisError),
      0,
    );
    const firstViolation = checks.find(
      ({ maximumAxisError }) => maximumAxisError > ALIGNMENT_TOLERANCE_CSS_PIXELS,
    ) ?? null;
    const inputProjection = {
      anchors: sample.anchors,
      observed: sample.observed,
      viewport: sample.viewport,
    };
    return Object.freeze({
      anchorChecks,
      expectedTransform,
      firstViolation,
      inputSha256: sha256(serializeCanonicalJson(inputProjection)),
      maximumAlignmentErrorCssPixels,
      observedTransform: sample.observed,
      ok: firstViolation === null,
      transformChecks,
      viewport: sample.viewport,
    });
  });

  const failures = [];
  if (
    missingViewportWidths.length !== 0
    || unexpectedViewportWidths.length !== 0
    || duplicateViewportWidths.length !== 0
  ) {
    failures.push(failureRecord(
      LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
      FIDELITY_ISSUE_CODES.ALIGNMENT_VIEWPORT_SET_INVALID,
      "Alignment evidence must contain each mandatory CSS-pixel width exactly once",
      "$.samples",
    ));
  }
  if (viewportReports.some(({ ok }) => !ok)) {
    failures.push(failureRecord(
      LAYER_GATE_FAILURE_CODES.FIDELITY_INVALID,
      FIDELITY_ISSUE_CODES.ALIGNMENT_ERROR,
      "Canonical-to-viewport alignment exceeds 0.5 CSS pixel",
      "$.samples",
    ));
  }

  const alignmentInputProjection = normalizedSamples.map((sample) => ({
    anchors: sample.anchors,
    observed: sample.observed,
    viewport: sample.viewport,
  }));
  return deepFreeze({
    browserCaptureIncluded: false,
    canonicalCoordinateSpace: CANONICAL_SOURCE_COORDINATE_SPACE,
    failures,
    inputs: {
      alignmentSamplesSha256: sha256(serializeCanonicalJson(alignmentInputProjection)),
      canonicalSourceSha256: sourceSha256,
    },
    ok: failures.length === 0,
    poseId: normalizedPoseId,
    reportType: "canonical-viewport-alignment",
    requiredViewportWidths: REQUIRED_ALIGNMENT_VIEWPORT_WIDTHS,
    schemaVersion: 1,
    sourceSpaceTruth: false,
    toleranceCssPixels: ALIGNMENT_TOLERANCE_CSS_PIXELS,
    viewportSet: {
      duplicateViewportWidths,
      missingViewportWidths,
      unexpectedViewportWidths,
    },
    viewports: viewportReports,
  });
}

export const validateCanonicalViewportAlignment = checkCanonicalViewportAlignment;
export const checkSourceToViewportAlignment = checkCanonicalViewportAlignment;

export function assertCanonicalViewportAlignment(options) {
  const report = checkCanonicalViewportAlignment(options);
  if (report.ok) return report;
  const firstFailure = report.failures[0];
  throw new FidelityGateError(
    firstFailure.issueCode,
    firstFailure.message,
    firstFailure.path,
    firstFailure.code,
    report,
  );
}

/** Canonical UTF-8 JSON bytes with recursively sorted keys and one trailing LF. */
export function serializeFidelityReport(report) {
  if (!isPlainObject(report) || report.schemaVersion !== 1 || typeof report.reportType !== "string") {
    fail(
      FIDELITY_ISSUE_CODES.INPUT_INVALID,
      "Fidelity report must have schemaVersion 1 and a report type",
      "$",
    );
  }
  return serializeCanonicalJsonLine(report);
}

export const serializeDeterministicFidelityReport = serializeFidelityReport;
