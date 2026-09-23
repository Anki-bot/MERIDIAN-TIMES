import { describe, expect, it } from "vitest";
import {
  CANONICAL_SOURCE_SIZE,
  COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS,
  checkCanonicalAlignment,
  checkCoverCoverage,
  createCanonicalCoverTransform,
  mapCanonicalPoint,
  mapCanonicalRect,
  type CanonicalCoverTransform,
  type CanonicalPoint,
  type CoverMappingResult,
} from "@/lib/watch-2-5d/cover-transform";

const FIXED_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 700, height: 900 },
  { width: 701, height: 900 },
  { width: 1_024, height: 576 },
  { width: 1_440, height: 900 },
  { width: 2_560, height: 1_440 },
] as const;

function unwrap<T>(result: CoverMappingResult<T>): T {
  expect(result.ok, result.ok ? undefined : `${result.code}: ${result.message}`).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function predecessorObjectFitPoint(
  point: CanonicalPoint,
  viewport: { readonly width: number; readonly height: number },
  encodingScale: 0.5 | 1,
): CanonicalPoint {
  const intrinsicWidth = CANONICAL_SOURCE_SIZE.width * encodingScale;
  const intrinsicHeight = CANONICAL_SOURCE_SIZE.height * encodingScale;
  const imageScale = Math.max(
    viewport.width / intrinsicWidth,
    viewport.height / intrinsicHeight,
  );
  const renderedWidth = intrinsicWidth * imageScale;
  const renderedHeight = intrinsicHeight * imageScale;
  return {
    x: (viewport.width - renderedWidth) / 2 + point.x * encodingScale * imageScale,
    y: (viewport.height - renderedHeight) / 2 + point.y * encodingScale * imageScale,
  };
}

// **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.7, 8.8, 8.12**
describe("canonical cover transform", () => {
  it.each(FIXED_VIEWPORTS)(
    "matches the predecessor centered cover model at $width×$height",
    (viewport) => {
      const canonicalSamples = [
        { x: 0, y: 0 },
        { x: CANONICAL_SOURCE_SIZE.width, y: 0 },
        {
          x: CANONICAL_SOURCE_SIZE.width / 2,
          y: CANONICAL_SOURCE_SIZE.height / 2,
        },
        { x: 1_947.25, y: 423.75 },
        {
          x: CANONICAL_SOURCE_SIZE.width,
          y: CANONICAL_SOURCE_SIZE.height,
        },
      ] as const;
      const transform = unwrap(createCanonicalCoverTransform({
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
      }));

      for (const source of canonicalSamples) {
        const actual = unwrap(mapCanonicalPoint(source, transform));
        const expected = predecessorObjectFitPoint(source, viewport, 1);
        expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(
          COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS,
        );
        expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(
          COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS,
        );
      }

      const coverage = unwrap(checkCoverCoverage(transform));
      expect(coverage.maximumGapCssPixels).toBe(0);
      expect(coverage.bounds.left).toBeLessThanOrEqual(0);
      expect(coverage.bounds.top).toBeLessThanOrEqual(0);
      expect(coverage.bounds.right).toBeGreaterThanOrEqual(viewport.width);
      expect(coverage.bounds.bottom).toBeGreaterThanOrEqual(viewport.height);
    },
  );

  it.each(FIXED_VIEWPORTS)(
    "keeps canonical point and rectangle geometry identical across profiles at $width px",
    (viewport) => {
      const compact = unwrap(createCanonicalCoverTransform({
        encodingScale: 0.5,
        profile: "compact",
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
      }));
      const expanded = unwrap(createCanonicalCoverTransform({
        encodingScale: 1,
        profile: "expanded",
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
      }));
      expect(compact).toEqual(expanded);

      const sourcePoint = { x: 1_947.25, y: 423.75 } as const;
      const compactPoint = unwrap(mapCanonicalPoint(sourcePoint, compact));
      const expandedPoint = unwrap(mapCanonicalPoint(sourcePoint, expanded));
      expect(compactPoint).toEqual(expandedPoint);
      expect(compactPoint).toEqual(
        predecessorObjectFitPoint(sourcePoint, viewport, 0.5),
      );

      const sourceRect = { x: 320, y: 240, width: 640, height: 384 } as const;
      const compactRect = unwrap(mapCanonicalRect(sourceRect, compact));
      const expandedRect = unwrap(mapCanonicalRect(sourceRect, expanded));
      const expectedTopLeft = predecessorObjectFitPoint(sourceRect, viewport, 0.5);
      const expectedBottomRight = predecessorObjectFitPoint({
        x: sourceRect.x + sourceRect.width,
        y: sourceRect.y + sourceRect.height,
      }, viewport, 0.5);

      expect(compactRect).toEqual(expandedRect);
      expect(compactRect.x).toBeCloseTo(expectedTopLeft.x, 10);
      expect(compactRect.y).toBeCloseTo(expectedTopLeft.y, 10);
      expect(compactRect.width).toBeCloseTo(expectedBottomRight.x - expectedTopLeft.x, 10);
      expect(compactRect.height).toBeCloseTo(expectedBottomRight.y - expectedTopLeft.y, 10);
    },
  );

  it("checks approved pivots and mask boundaries at the inclusive 0.5 CSS-pixel limit", () => {
    const transform = unwrap(createCanonicalCoverTransform({
      viewportHeight: 900,
      viewportWidth: 1_440,
    }));
    const pivotSource = { x: 1_380, y: 752 } as const;
    const boundarySource = { x: 2_200, y: 430 } as const;
    const pivot = unwrap(mapCanonicalPoint(pivotSource, transform));
    const boundary = unwrap(mapCanonicalPoint(boundarySource, transform));

    const passing = checkCanonicalAlignment({
      boundaries: [{
        id: "mask-boundary",
        observed: { x: boundary.x, y: boundary.y - 0.5 },
        source: boundarySource,
      }],
      pivots: [{
        id: "approved-pivot",
        observed: { x: pivot.x + 0.5, y: pivot.y },
        source: pivotSource,
      }],
      transform,
    });
    expect(passing).toMatchObject({
      ok: true,
      report: {
        maximumAlignmentErrorCssPixels: 0.5,
        toleranceCssPixels: 0.5,
      },
    });

    const failing = checkCanonicalAlignment({
      boundaries: [{
        id: "mask-boundary",
        observed: { x: boundary.x, y: boundary.y + 0.500_001 },
        source: boundarySource,
      }],
      pivots: [{ id: "approved-pivot", observed: pivot, source: pivotSource }],
      transform,
    });
    expect(failing).toMatchObject({
      code: "alignment-exceeded",
      ok: false,
      report: {
        maximumAlignmentErrorCssPixels: expect.any(Number),
        toleranceCssPixels: 0.5,
      },
    });
    if (failing.ok || !failing.report) throw new Error("Expected an alignment report.");
    expect(failing.report.maximumAlignmentErrorCssPixels).toBeGreaterThan(0.5);
  });

  it("fails closed for nonfinite input, invalid canonical geometry, and inadequate coverage", () => {
    expect(createCanonicalCoverTransform({
      viewportHeight: 844,
      viewportWidth: Number.NaN,
    })).toMatchObject({ code: "nonfinite-input", ok: false, path: "$.viewportWidth" });
    expect(createCanonicalCoverTransform({
      viewportHeight: 844,
      viewportWidth: 0,
    })).toMatchObject({ code: "nonpositive-dimension", ok: false });
    expect(createCanonicalCoverTransform({
      encodingScale: 1,
      profile: "compact",
      viewportHeight: 844,
      viewportWidth: 390,
    })).toMatchObject({ code: "profile-invalid", ok: false });

    const transform = unwrap(createCanonicalCoverTransform({
      viewportHeight: 844,
      viewportWidth: 390,
    }));
    expect(mapCanonicalPoint({ x: Number.POSITIVE_INFINITY, y: 0 }, transform))
      .toMatchObject({ code: "nonfinite-input", ok: false });
    expect(mapCanonicalPoint({ x: -1, y: 0 }, transform))
      .toMatchObject({ code: "canonical-bounds-invalid", ok: false });
    expect(mapCanonicalRect({ x: 2_700, y: 1_400, width: 100, height: 100 }, transform))
      .toMatchObject({ code: "canonical-bounds-invalid", ok: false });

    const underScale = 0.9;
    const inadequate: CanonicalCoverTransform = {
      ...transform,
      coverScale: transform.coverScale * underScale,
      offsetX: (transform.viewportWidth - transform.renderedWidth * underScale) / 2,
      offsetY: (transform.viewportHeight - transform.renderedHeight * underScale) / 2,
      renderedHeight: transform.renderedHeight * underScale,
      renderedWidth: transform.renderedWidth * underScale,
    };
    expect(checkCoverCoverage(inadequate)).toMatchObject({
      code: "inadequate-coverage",
      ok: false,
    });
    expect(mapCanonicalPoint({ x: 1_380, y: 752 }, inadequate)).toMatchObject({
      code: "transform-inconsistent",
      ok: false,
    });
    expect(checkCanonicalAlignment({ transform, pivots: [], boundaries: [] })).toMatchObject({
      code: "alignment-input-invalid",
      ok: false,
    });
  });
});
