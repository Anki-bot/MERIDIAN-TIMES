export const CANONICAL_SOURCE_SIZE = Object.freeze({
  width: 2_760,
  height: 1_504,
});

export const COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS = 0.5;

export const PROFILE_ENCODING_SCALES = Object.freeze({
  compact: 0.5,
  expanded: 1,
} as const);

const COVERAGE_EPSILON_CSS_PIXELS = 1e-7;

export type WatchLayerProfile = keyof typeof PROFILE_ENCODING_SCALES;
export type ProfileEncodingScale = (typeof PROFILE_ENCODING_SCALES)[WatchLayerProfile];

export interface CanonicalPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanonicalRect extends CanonicalPoint {
  readonly width: number;
  readonly height: number;
}

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewportRect extends ViewportPoint {
  readonly width: number;
  readonly height: number;
}

export interface CanonicalCoverTransform {
  readonly coverScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly renderedHeight: number;
  readonly renderedWidth: number;
  readonly sourceHeight: typeof CANONICAL_SOURCE_SIZE.height;
  readonly sourceWidth: typeof CANONICAL_SOURCE_SIZE.width;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}

export interface CreateCanonicalCoverTransformInput {
  readonly viewportHeight: number;
  readonly viewportWidth: number;
  /** Optional runtime profile metadata. It never changes canonical geometry. */
  readonly profile?: WatchLayerProfile;
  /** Optional manifest source scale. Only the approved 0.5 and 1 scales are accepted. */
  readonly encodingScale?: ProfileEncodingScale;
}

export type CoverMappingFailureCode =
  | "alignment-input-invalid"
  | "alignment-exceeded"
  | "canonical-bounds-invalid"
  | "inadequate-coverage"
  | "input-invalid"
  | "nonfinite-input"
  | "nonpositive-dimension"
  | "profile-invalid"
  | "transform-inconsistent";

export interface CoverMappingFailure {
  readonly ok: false;
  readonly code: CoverMappingFailureCode;
  readonly message: string;
  readonly path: string;
}

export interface CoverMappingSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type CoverMappingResult<T> = CoverMappingSuccess<T> | CoverMappingFailure;

export interface CoverCoverage {
  readonly bounds: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  };
  readonly gaps: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  };
  readonly maximumGapCssPixels: number;
}

export interface CanonicalAlignmentSample {
  readonly id: string;
  readonly source: CanonicalPoint;
  readonly observed: ViewportPoint;
}

export interface CanonicalAlignmentCheck {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly expected: ViewportPoint;
  readonly id: string;
  readonly kind: "boundary" | "pivot";
  readonly maximumAxisErrorCssPixels: number;
  readonly observed: ViewportPoint;
  readonly source: CanonicalPoint;
}

export interface CanonicalAlignmentReport {
  readonly boundaryChecks: readonly CanonicalAlignmentCheck[];
  readonly maximumAlignmentErrorCssPixels: number;
  readonly pivotChecks: readonly CanonicalAlignmentCheck[];
  readonly toleranceCssPixels: typeof COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS;
}

export interface CheckCanonicalAlignmentInput {
  readonly boundaries?: readonly CanonicalAlignmentSample[];
  readonly pivots?: readonly CanonicalAlignmentSample[];
  readonly transform: CanonicalCoverTransform;
}

export type CanonicalAlignmentResult =
  | {
      readonly ok: true;
      readonly report: CanonicalAlignmentReport;
    }
  | (CoverMappingFailure & {
      readonly report?: CanonicalAlignmentReport;
    });

function success<T>(value: T): CoverMappingSuccess<T> {
  return Object.freeze({ ok: true, value });
}

function failure(
  code: CoverMappingFailureCode,
  path: string,
  message: string,
): CoverMappingFailure {
  return Object.freeze({ code, message, ok: false, path });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, path: string): CoverMappingResult<number> {
  if (typeof value !== "number") {
    return failure("input-invalid", path, "Expected a number.");
  }
  if (!Number.isFinite(value)) {
    return failure("nonfinite-input", path, "Expected a finite number.");
  }
  return success(value);
}

function positiveDimension(value: unknown, path: string): CoverMappingResult<number> {
  const normalized = finiteNumber(value, path);
  if (!normalized.ok) return normalized;
  if (normalized.value <= 0) {
    return failure("nonpositive-dimension", path, "Expected a positive dimension.");
  }
  return normalized;
}

function freezePoint(point: CanonicalPoint): Readonly<CanonicalPoint> {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeViewportPoint(point: ViewportPoint): Readonly<ViewportPoint> {
  return Object.freeze({ x: point.x, y: point.y });
}

function normalizeProfileSelection(
  input: Readonly<Record<string, unknown>>,
): CoverMappingResult<true> {
  const profile = input.profile;
  if (profile !== undefined && profile !== "compact" && profile !== "expanded") {
    return failure("profile-invalid", "$.profile", "Expected compact or expanded profile.");
  }

  const encodingScale = input.encodingScale;
  if (encodingScale !== undefined) {
    const normalizedScale = finiteNumber(encodingScale, "$.encodingScale");
    if (!normalizedScale.ok) return normalizedScale;
    if (normalizedScale.value !== 0.5 && normalizedScale.value !== 1) {
      return failure(
        "profile-invalid",
        "$.encodingScale",
        "Expected the approved compact (0.5) or expanded (1) encoding scale.",
      );
    }
    if (
      profile !== undefined
      && normalizedScale.value !== PROFILE_ENCODING_SCALES[profile]
    ) {
      return failure(
        "profile-invalid",
        "$.encodingScale",
        "Encoding scale does not match the selected profile.",
      );
    }
  }

  return success(true);
}

function deriveCanonicalCoverTransform(
  viewportWidth: number,
  viewportHeight: number,
): CanonicalCoverTransform {
  const coverScale = Math.max(
    viewportWidth / CANONICAL_SOURCE_SIZE.width,
    viewportHeight / CANONICAL_SOURCE_SIZE.height,
  );
  const renderedWidth = CANONICAL_SOURCE_SIZE.width * coverScale;
  const renderedHeight = CANONICAL_SOURCE_SIZE.height * coverScale;

  return Object.freeze({
    coverScale,
    offsetX: (viewportWidth - renderedWidth) * 0.5,
    offsetY: (viewportHeight - renderedHeight) * 0.5,
    renderedHeight,
    renderedWidth,
    sourceHeight: CANONICAL_SOURCE_SIZE.height,
    sourceWidth: CANONICAL_SOURCE_SIZE.width,
    viewportHeight,
    viewportWidth,
  });
}

function numericTolerance(...values: readonly number[]): number {
  const magnitude = Math.max(1, ...values.map((value) => Math.abs(value)));
  return Math.max(COVERAGE_EPSILON_CSS_PIXELS, Number.EPSILON * magnitude * 32);
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= numericTolerance(left, right);
}

function normalizeCoverTransform(value: unknown): CoverMappingResult<CanonicalCoverTransform> {
  if (!isRecord(value)) {
    return failure("input-invalid", "$.transform", "Cover transform must be an object.");
  }

  const sourceWidth = positiveDimension(value.sourceWidth, "$.transform.sourceWidth");
  if (!sourceWidth.ok) return sourceWidth;
  const sourceHeight = positiveDimension(value.sourceHeight, "$.transform.sourceHeight");
  if (!sourceHeight.ok) return sourceHeight;
  if (
    sourceWidth.value !== CANONICAL_SOURCE_SIZE.width
    || sourceHeight.value !== CANONICAL_SOURCE_SIZE.height
  ) {
    return failure(
      "transform-inconsistent",
      "$.transform.sourceWidth",
      "Cover transform must use the canonical 2760 by 1504 source space.",
    );
  }

  const viewportWidth = positiveDimension(value.viewportWidth, "$.transform.viewportWidth");
  if (!viewportWidth.ok) return viewportWidth;
  const viewportHeight = positiveDimension(value.viewportHeight, "$.transform.viewportHeight");
  if (!viewportHeight.ok) return viewportHeight;
  const coverScale = positiveDimension(value.coverScale, "$.transform.coverScale");
  if (!coverScale.ok) return coverScale;
  const renderedWidth = positiveDimension(value.renderedWidth, "$.transform.renderedWidth");
  if (!renderedWidth.ok) return renderedWidth;
  const renderedHeight = positiveDimension(value.renderedHeight, "$.transform.renderedHeight");
  if (!renderedHeight.ok) return renderedHeight;
  const offsetX = finiteNumber(value.offsetX, "$.transform.offsetX");
  if (!offsetX.ok) return offsetX;
  const offsetY = finiteNumber(value.offsetY, "$.transform.offsetY");
  if (!offsetY.ok) return offsetY;

  return success(Object.freeze({
    coverScale: coverScale.value,
    offsetX: offsetX.value,
    offsetY: offsetY.value,
    renderedHeight: renderedHeight.value,
    renderedWidth: renderedWidth.value,
    sourceHeight: CANONICAL_SOURCE_SIZE.height,
    sourceWidth: CANONICAL_SOURCE_SIZE.width,
    viewportHeight: viewportHeight.value,
    viewportWidth: viewportWidth.value,
  }));
}

function validateCanonicalTransform(value: unknown): CoverMappingResult<CanonicalCoverTransform> {
  const normalized = normalizeCoverTransform(value);
  if (!normalized.ok) return normalized;

  const expected = deriveCanonicalCoverTransform(
    normalized.value.viewportWidth,
    normalized.value.viewportHeight,
  );
  const fields = [
    "coverScale",
    "offsetX",
    "offsetY",
    "renderedHeight",
    "renderedWidth",
  ] as const;
  for (const field of fields) {
    if (!approximatelyEqual(normalized.value[field], expected[field])) {
      return failure(
        "transform-inconsistent",
        `$.transform.${field}`,
        "Transform does not match the centered canonical object-fit cover model.",
      );
    }
  }

  const coverage = coverageForTransform(normalized.value);
  if (coverage.maximumGapCssPixels > COVERAGE_EPSILON_CSS_PIXELS) {
    return failure(
      "inadequate-coverage",
      "$.transform",
      "Cover transform leaves part of the viewport uncovered.",
    );
  }

  return normalized;
}

function coverageForTransform(transform: CanonicalCoverTransform): CoverCoverage {
  const left = transform.offsetX;
  const top = transform.offsetY;
  const right = left + transform.renderedWidth;
  const bottom = top + transform.renderedHeight;
  const gaps = Object.freeze({
    bottom: Math.max(0, transform.viewportHeight - bottom),
    left: Math.max(0, left),
    right: Math.max(0, transform.viewportWidth - right),
    top: Math.max(0, top),
  });

  return Object.freeze({
    bounds: Object.freeze({ bottom, left, right, top }),
    gaps,
    maximumGapCssPixels: Math.max(gaps.bottom, gaps.left, gaps.right, gaps.top),
  });
}

/**
 * Computes the centered predecessor `object-fit: cover` transform in canonical
 * 2760×1504 coordinates. Compact/expanded encoding metadata is validated but
 * deliberately excluded from the equations and returned geometry.
 */
export function createCanonicalCoverTransform(
  input: CreateCanonicalCoverTransformInput,
): CoverMappingResult<CanonicalCoverTransform> {
  if (!isRecord(input)) {
    return failure("input-invalid", "$", "Cover transform input must be an object.");
  }

  const profileSelection = normalizeProfileSelection(input);
  if (!profileSelection.ok) return profileSelection;
  const viewportWidth = positiveDimension(input.viewportWidth, "$.viewportWidth");
  if (!viewportWidth.ok) return viewportWidth;
  const viewportHeight = positiveDimension(input.viewportHeight, "$.viewportHeight");
  if (!viewportHeight.ok) return viewportHeight;

  const transform = deriveCanonicalCoverTransform(viewportWidth.value, viewportHeight.value);
  const finiteOutputs = [
    transform.coverScale,
    transform.offsetX,
    transform.offsetY,
    transform.renderedHeight,
    transform.renderedWidth,
  ];
  if (finiteOutputs.some((value) => !Number.isFinite(value))) {
    return failure(
      "nonfinite-input",
      "$",
      "Viewport dimensions produce nonfinite cover geometry.",
    );
  }

  const coverage = coverageForTransform(transform);
  if (coverage.maximumGapCssPixels > COVERAGE_EPSILON_CSS_PIXELS) {
    return failure(
      "inadequate-coverage",
      "$",
      "Viewport dimensions do not produce complete cover geometry.",
    );
  }

  return success(transform);
}

export const computeCanonicalCoverTransform = createCanonicalCoverTransform;

/** Checks an externally supplied transform without throwing or accepting gaps. */
export function checkCoverCoverage(transform: unknown): CoverMappingResult<CoverCoverage> {
  const normalized = normalizeCoverTransform(transform);
  if (!normalized.ok) return normalized;
  const coverage = coverageForTransform(normalized.value);
  if (coverage.maximumGapCssPixels > COVERAGE_EPSILON_CSS_PIXELS) {
    return failure(
      "inadequate-coverage",
      "$.transform",
      "Cover transform leaves part of the viewport uncovered.",
    );
  }
  return success(coverage);
}

function normalizeCanonicalPoint(
  value: unknown,
  path: string,
): CoverMappingResult<CanonicalPoint> {
  if (!isRecord(value)) {
    return failure("input-invalid", path, "Canonical point must be an object.");
  }
  const x = finiteNumber(value.x, `${path}.x`);
  if (!x.ok) return x;
  const y = finiteNumber(value.y, `${path}.y`);
  if (!y.ok) return y;
  if (
    x.value < 0
    || x.value > CANONICAL_SOURCE_SIZE.width
    || y.value < 0
    || y.value > CANONICAL_SOURCE_SIZE.height
  ) {
    return failure(
      "canonical-bounds-invalid",
      path,
      "Canonical point lies outside the 2760 by 1504 source space.",
    );
  }
  return success(freezePoint({ x: x.value, y: y.value }));
}

function normalizeCanonicalRect(
  value: unknown,
  path: string,
): CoverMappingResult<CanonicalRect> {
  if (!isRecord(value)) {
    return failure("input-invalid", path, "Canonical rectangle must be an object.");
  }
  const point = normalizeCanonicalPoint(value, path);
  if (!point.ok) return point;
  const width = positiveDimension(value.width, `${path}.width`);
  if (!width.ok) return width;
  const height = positiveDimension(value.height, `${path}.height`);
  if (!height.ok) return height;
  if (
    point.value.x + width.value > CANONICAL_SOURCE_SIZE.width
    || point.value.y + height.value > CANONICAL_SOURCE_SIZE.height
  ) {
    return failure(
      "canonical-bounds-invalid",
      path,
      "Canonical rectangle exceeds the 2760 by 1504 source space.",
    );
  }
  return success(Object.freeze({
    height: height.value,
    width: width.value,
    x: point.value.x,
    y: point.value.y,
  }));
}

function projectPoint(point: CanonicalPoint, transform: CanonicalCoverTransform): ViewportPoint {
  return freezeViewportPoint({
    x: transform.offsetX + point.x * transform.coverScale,
    y: transform.offsetY + point.y * transform.coverScale,
  });
}

export function mapCanonicalPoint(
  point: CanonicalPoint,
  transform: CanonicalCoverTransform,
): CoverMappingResult<ViewportPoint> {
  const normalizedTransform = validateCanonicalTransform(transform);
  if (!normalizedTransform.ok) return normalizedTransform;
  const normalizedPoint = normalizeCanonicalPoint(point, "$.point");
  if (!normalizedPoint.ok) return normalizedPoint;
  const projected = projectPoint(normalizedPoint.value, normalizedTransform.value);
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
    return failure("nonfinite-input", "$.point", "Point mapping produced a nonfinite result.");
  }
  return success(projected);
}

export const projectCanonicalPoint = mapCanonicalPoint;

export function mapCanonicalRect(
  rect: CanonicalRect,
  transform: CanonicalCoverTransform,
): CoverMappingResult<ViewportRect> {
  const normalizedTransform = validateCanonicalTransform(transform);
  if (!normalizedTransform.ok) return normalizedTransform;
  const normalizedRect = normalizeCanonicalRect(rect, "$.rect");
  if (!normalizedRect.ok) return normalizedRect;
  const topLeft = projectPoint(normalizedRect.value, normalizedTransform.value);
  const projected = Object.freeze({
    height: normalizedRect.value.height * normalizedTransform.value.coverScale,
    width: normalizedRect.value.width * normalizedTransform.value.coverScale,
    x: topLeft.x,
    y: topLeft.y,
  });
  if (Object.values(projected).some((value) => !Number.isFinite(value))) {
    return failure("nonfinite-input", "$.rect", "Rectangle mapping produced a nonfinite result.");
  }
  return success(projected);
}

export const mapCanonicalRectangle = mapCanonicalRect;
export const projectCanonicalRect = mapCanonicalRect;

function normalizeAlignmentSamples(
  value: unknown,
  kind: CanonicalAlignmentCheck["kind"],
): CoverMappingResult<readonly CanonicalAlignmentCheck[]> {
  const collectionName = kind === "boundary" ? "boundaries" : "pivots";
  if (value === undefined) return success(Object.freeze([]));
  if (!Array.isArray(value)) {
    return failure(
      "alignment-input-invalid",
      `$.${collectionName}`,
      "Alignment samples must be an array.",
    );
  }

  const checks: CanonicalAlignmentCheck[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const path = `$.${collectionName}[${index}]`;
    const sample = value[index];
    if (!isRecord(sample) || typeof sample.id !== "string" || sample.id.trim() === "") {
      return failure("alignment-input-invalid", `${path}.id`, "Alignment sample needs an ID.");
    }
    const source = normalizeCanonicalPoint(sample.source, `${path}.source`);
    if (!source.ok) return source;
    if (!isRecord(sample.observed)) {
      return failure("alignment-input-invalid", `${path}.observed`, "Observed point must be an object.");
    }
    const observedX = finiteNumber(sample.observed.x, `${path}.observed.x`);
    if (!observedX.ok) return observedX;
    const observedY = finiteNumber(sample.observed.y, `${path}.observed.y`);
    if (!observedY.ok) return observedY;

    checks.push(Object.freeze({
      deltaX: 0,
      deltaY: 0,
      expected: Object.freeze({ x: 0, y: 0 }),
      id: sample.id,
      kind,
      maximumAxisErrorCssPixels: 0,
      observed: freezeViewportPoint({ x: observedX.value, y: observedY.value }),
      source: source.value,
    }));
  }

  checks.sort((left, right) => left.id.localeCompare(right.id));
  return success(Object.freeze(checks));
}

/**
 * Checks approved pivot and mask-boundary projections against the canonical
 * transform. Any nonfinite sample, duplicate ID, missing sample set, uncovered
 * transform, or axis error above 0.5 CSS pixel fails closed.
 */
export function checkCanonicalAlignment(
  input: CheckCanonicalAlignmentInput,
): CanonicalAlignmentResult {
  if (!isRecord(input)) {
    return failure("alignment-input-invalid", "$", "Alignment input must be an object.");
  }
  const transform = validateCanonicalTransform(input.transform);
  if (!transform.ok) return transform;
  const pivots = normalizeAlignmentSamples(input.pivots, "pivot");
  if (!pivots.ok) return pivots;
  const boundaries = normalizeAlignmentSamples(input.boundaries, "boundary");
  if (!boundaries.ok) return boundaries;
  if (pivots.value.length + boundaries.value.length === 0) {
    return failure(
      "alignment-input-invalid",
      "$",
      "At least one pivot or boundary sample is required.",
    );
  }

  const ids = [...pivots.value, ...boundaries.value].map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    return failure(
      "alignment-input-invalid",
      "$",
      "Pivot and boundary sample IDs must be unique.",
    );
  }

  const evaluate = (check: CanonicalAlignmentCheck): CanonicalAlignmentCheck => {
    const expected = projectPoint(check.source, transform.value);
    const deltaX = Math.abs(check.observed.x - expected.x);
    const deltaY = Math.abs(check.observed.y - expected.y);
    return Object.freeze({
      ...check,
      deltaX,
      deltaY,
      expected,
      maximumAxisErrorCssPixels: Math.max(deltaX, deltaY),
    });
  };
  const pivotChecks = Object.freeze(pivots.value.map(evaluate));
  const boundaryChecks = Object.freeze(boundaries.value.map(evaluate));
  const maximumAlignmentErrorCssPixels = [...pivotChecks, ...boundaryChecks].reduce(
    (maximum, check) => Math.max(maximum, check.maximumAxisErrorCssPixels),
    0,
  );
  const report = Object.freeze({
    boundaryChecks,
    maximumAlignmentErrorCssPixels,
    pivotChecks,
    toleranceCssPixels: COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS,
  });

  if (maximumAlignmentErrorCssPixels > COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS) {
    return Object.freeze({
      ...failure(
        "alignment-exceeded",
        "$",
        "Canonical pivot or boundary alignment exceeds 0.5 CSS pixel.",
      ),
      report,
    });
  }

  return Object.freeze({ ok: true, report });
}

export const checkPivotAndBoundaryAlignment = checkCanonicalAlignment;
export const validateCanonicalAlignment = checkCanonicalAlignment;

export interface ResolveResponsiveCoverPresentationInput
  extends CheckCanonicalAlignmentInput {
  /** Opaque clock value carried through remapping; this helper never advances or resets it. */
  readonly activeElapsedMs: number;
}

export type ResponsiveCoverPresentation =
  | {
      readonly activeElapsedMs: number;
      readonly coverage: CoverCoverage;
      readonly kind: "enhanced";
      readonly report: CanonicalAlignmentReport;
    }
  | {
      readonly activeElapsedMs: number;
      readonly failure: CoverMappingFailure;
      readonly kind: "fallback";
    };

/**
 * Selects enhanced presentation only when the existing coverage and alignment
 * proofs both pass. The active clock value is intentionally treated as opaque
 * state so viewport remaps and profile crossings cannot consume or reset it.
 */
export function resolveResponsiveCoverPresentation(
  input: ResolveResponsiveCoverPresentationInput,
): ResponsiveCoverPresentation {
  const coverage = checkCoverCoverage(input.transform);
  if (!coverage.ok) {
    return Object.freeze({
      activeElapsedMs: input.activeElapsedMs,
      failure: coverage,
      kind: "fallback",
    });
  }

  const alignment = checkCanonicalAlignment(input);
  if (!alignment.ok) {
    return Object.freeze({
      activeElapsedMs: input.activeElapsedMs,
      failure: alignment,
      kind: "fallback",
    });
  }

  return Object.freeze({
    activeElapsedMs: input.activeElapsedMs,
    coverage: coverage.value,
    kind: "enhanced",
    report: alignment.report,
  });
}
