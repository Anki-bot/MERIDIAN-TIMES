import fc from "fast-check";
import { expect, it } from "vitest";
import {
  COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS,
  createCanonicalCoverTransform,
  mapCanonicalPoint,
  mapCanonicalRect,
  resolveResponsiveCoverPresentation,
  type CanonicalCoverTransform,
  type CanonicalPoint,
  type CanonicalRect,
  type CoverMappingResult,
  type ProfileEncodingScale,
  type ViewportPoint,
  type ViewportRect,
  type WatchLayerProfile,
} from "@/lib/watch-2-5d/cover-transform";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 8: Cover mapping equivalence and responsive phase preservation";

// Reproduce with: seed=20260608, numRuns=128.
const PROPERTY_SEED = 20_260_608;
const PROPERTY_RUNS = 128;
const PREDECESSOR_SOURCE_SIZE = Object.freeze({ height: 1_504, width: 2_760 });
const PROFILE_CASES = Object.freeze([
  Object.freeze({ encodingScale: 0.5, profile: "compact" }),
  Object.freeze({ encodingScale: 1, profile: "expanded" }),
] as const);

type Viewport = Readonly<{ height: number; width: number }>;
type ProfileCase = Readonly<{
  encodingScale: ProfileEncodingScale;
  profile: WatchLayerProfile;
}>;
type PredecessorCoverTransform = Readonly<{
  canonicalScale: number;
  imageScale: number;
  offsetX: number;
  offsetY: number;
  renderedHeight: number;
  renderedWidth: number;
}>;

function unwrap<T>(result: CoverMappingResult<T>): T {
  expect(result.ok, result.ok ? undefined : `${result.code}: ${result.message}`).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

/** Independent oracle based on the predecessor image's intrinsic encoded size. */
function predecessorCenteredCoverOracle(
  viewport: Viewport,
  encodingScale: ProfileEncodingScale,
): PredecessorCoverTransform {
  const intrinsicWidth = PREDECESSOR_SOURCE_SIZE.width * encodingScale;
  const intrinsicHeight = PREDECESSOR_SOURCE_SIZE.height * encodingScale;
  const imageScale = Math.max(
    viewport.width / intrinsicWidth,
    viewport.height / intrinsicHeight,
  );
  const renderedWidth = intrinsicWidth * imageScale;
  const renderedHeight = intrinsicHeight * imageScale;

  return Object.freeze({
    canonicalScale: encodingScale * imageScale,
    imageScale,
    offsetX: (viewport.width - renderedWidth) / 2,
    offsetY: (viewport.height - renderedHeight) / 2,
    renderedHeight,
    renderedWidth,
  });
}

function oraclePoint(
  point: CanonicalPoint,
  oracle: PredecessorCoverTransform,
  encodingScale: ProfileEncodingScale,
): ViewportPoint {
  return {
    x: oracle.offsetX + point.x * encodingScale * oracle.imageScale,
    y: oracle.offsetY + point.y * encodingScale * oracle.imageScale,
  };
}

function oracleRect(
  rect: CanonicalRect,
  oracle: PredecessorCoverTransform,
  encodingScale: ProfileEncodingScale,
): ViewportRect {
  const topLeft = oraclePoint(rect, oracle, encodingScale);
  return {
    height: rect.height * encodingScale * oracle.imageScale,
    width: rect.width * encodingScale * oracle.imageScale,
    x: topLeft.x,
    y: topLeft.y,
  };
}

function expectWithinAlignmentTolerance(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    COVER_ALIGNMENT_TOLERANCE_CSS_PIXELS,
  );
}

function transformFor(viewport: Viewport, profileCase: ProfileCase): CanonicalCoverTransform {
  return unwrap(createCanonicalCoverTransform({
    encodingScale: profileCase.encodingScale,
    profile: profileCase.profile,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  }));
}

function exactAlignmentInput(
  transform: CanonicalCoverTransform,
  viewport: Viewport,
  profileCase: ProfileCase,
  point: CanonicalPoint,
  rect: CanonicalRect,
  activeElapsedMs: number,
) {
  const oracle = predecessorCenteredCoverOracle(viewport, profileCase.encodingScale);
  const boundarySource = {
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  };
  return {
    activeElapsedMs,
    boundaries: [{
      id: "generated-mask-boundary",
      observed: oraclePoint(boundarySource, oracle, profileCase.encodingScale),
      source: boundarySource,
    }],
    pivots: [{
      id: "generated-pivot",
      observed: oraclePoint(point, oracle, profileCase.encodingScale),
      source: point,
    }],
    transform,
  } as const;
}

function underCoveredTransform(
  transform: CanonicalCoverTransform,
  shrink: number,
): CanonicalCoverTransform {
  const renderedWidth = transform.renderedWidth * shrink;
  const renderedHeight = transform.renderedHeight * shrink;
  return {
    ...transform,
    coverScale: transform.coverScale * shrink,
    offsetX: (transform.viewportWidth - renderedWidth) / 2,
    offsetY: (transform.viewportHeight - renderedHeight) / 2,
    renderedHeight,
    renderedWidth,
  };
}

const supportedWidthArbitrary = fc.oneof(
  fc.constantFrom(320, 390, 700, 701, 1_024, 1_440, 2_560),
  fc.integer({ min: 320, max: 2_560 }),
);
const viewportHeightArbitrary = fc.integer({ min: 240, max: 2_560 });
const canonicalPointArbitrary = fc.record({
  x: fc.integer({ min: 0, max: PREDECESSOR_SOURCE_SIZE.width * 4 })
    .map((value) => value / 4),
  y: fc.integer({ min: 0, max: PREDECESSOR_SOURCE_SIZE.height * 4 })
    .map((value) => value / 4),
});
const canonicalRectArbitrary = fc
  .record({
    x: fc.integer({ min: 0, max: PREDECESSOR_SOURCE_SIZE.width - 1 }),
    y: fc.integer({ min: 0, max: PREDECESSOR_SOURCE_SIZE.height - 1 }),
  })
  .chain(({ x, y }) => fc.record({
    height: fc.integer({ min: 1, max: PREDECESSOR_SOURCE_SIZE.height - y }),
    width: fc.integer({ min: 1, max: PREDECESSOR_SOURCE_SIZE.width - x }),
    x: fc.constant(x),
    y: fc.constant(y),
  }));

const generatedCaseArbitrary = fc.record({
  activeElapsedMs: fc.integer({ min: 0, max: 2_147_483_647 }),
  alignmentAxis: fc.constantFrom("x" as const, "y" as const),
  alignmentSign: fc.constantFrom(-1 as const, 1 as const),
  compactViewport: fc.record({
    height: viewportHeightArbitrary,
    width: fc.oneof(fc.constant(700), fc.integer({ min: 320, max: 700 })),
  }),
  expandedViewport: fc.record({
    height: viewportHeightArbitrary,
    width: fc.oneof(fc.constant(701), fc.integer({ min: 701, max: 2_560 })),
  }),
  invalidAlignmentError: fc.integer({ min: 501, max: 4_000 })
    .map((value) => value / 1_000),
  orientationLongSide: fc.integer({ min: 701, max: 2_560 }),
  orientationShortSide: fc.integer({ min: 320, max: 700 }),
  point: canonicalPointArbitrary,
  rect: canonicalRectArbitrary,
  reverseProfileCrossing: fc.boolean(),
  shrink: fc.integer({ min: 500, max: 999 }).map((value) => value / 1_000),
  validDeltaX: fc.integer({ min: -490, max: 490 }).map((value) => value / 1_000),
  validDeltaY: fc.integer({ min: -490, max: 490 }).map((value) => value / 1_000),
  viewport: fc.record({
    height: viewportHeightArbitrary,
    width: supportedWidthArbitrary,
  }),
});

// **Validates: Requirements 8.2, 8.4, 8.7, 8.8, 8.12**
it(PROPERTY_TAG, { timeout: 60_000 }, () => {
  fc.assert(
    fc.property(generatedCaseArbitrary, (generated) => {
      const profileTransforms: CanonicalCoverTransform[] = [];

      for (const profileCase of PROFILE_CASES) {
        const transform = transformFor(generated.viewport, profileCase);
        const oracle = predecessorCenteredCoverOracle(
          generated.viewport,
          profileCase.encodingScale,
        );
        const mappedPoint = unwrap(mapCanonicalPoint(generated.point, transform));
        const mappedRect = unwrap(mapCanonicalRect(generated.rect, transform));
        const expectedPoint = oraclePoint(
          generated.point,
          oracle,
          profileCase.encodingScale,
        );
        const expectedRect = oracleRect(
          generated.rect,
          oracle,
          profileCase.encodingScale,
        );

        expectWithinAlignmentTolerance(transform.coverScale, oracle.canonicalScale);
        expectWithinAlignmentTolerance(transform.offsetX, oracle.offsetX);
        expectWithinAlignmentTolerance(transform.offsetY, oracle.offsetY);
        expectWithinAlignmentTolerance(transform.renderedWidth, oracle.renderedWidth);
        expectWithinAlignmentTolerance(transform.renderedHeight, oracle.renderedHeight);
        expectWithinAlignmentTolerance(mappedPoint.x, expectedPoint.x);
        expectWithinAlignmentTolerance(mappedPoint.y, expectedPoint.y);
        expectWithinAlignmentTolerance(mappedRect.x, expectedRect.x);
        expectWithinAlignmentTolerance(mappedRect.y, expectedRect.y);
        expectWithinAlignmentTolerance(mappedRect.width, expectedRect.width);
        expectWithinAlignmentTolerance(mappedRect.height, expectedRect.height);

        const validInput = exactAlignmentInput(
          transform,
          generated.viewport,
          profileCase,
          generated.point,
          generated.rect,
          generated.activeElapsedMs,
        );
        const validWithError = {
          ...validInput,
          pivots: [{
            ...validInput.pivots[0],
            observed: {
              x: validInput.pivots[0].observed.x + generated.validDeltaX,
              y: validInput.pivots[0].observed.y + generated.validDeltaY,
            },
          }],
        };
        const aligned = resolveResponsiveCoverPresentation(validWithError);
        expect(aligned.kind).toBe("enhanced");
        expect(aligned.activeElapsedMs).toBe(generated.activeElapsedMs);

        const invalidObserved = { ...validInput.pivots[0].observed };
        invalidObserved[generated.alignmentAxis] +=
          generated.alignmentSign * generated.invalidAlignmentError;
        const misaligned = resolveResponsiveCoverPresentation({
          ...validInput,
          pivots: [{ ...validInput.pivots[0], observed: invalidObserved }],
        });
        expect(misaligned.kind).toBe("fallback");
        expect(misaligned.activeElapsedMs).toBe(generated.activeElapsedMs);
        if (misaligned.kind !== "fallback") throw new Error("Expected fallback");
        expect(misaligned.failure.code).toBe("alignment-exceeded");

        const uncovered = resolveResponsiveCoverPresentation({
          ...validInput,
          transform: underCoveredTransform(transform, generated.shrink),
        });
        expect(uncovered.kind).toBe("fallback");
        expect(uncovered.activeElapsedMs).toBe(generated.activeElapsedMs);
        if (uncovered.kind !== "fallback") throw new Error("Expected fallback");
        expect(uncovered.failure.code).toBe("inadequate-coverage");

        profileTransforms.push(transform);
      }

      expect(profileTransforms[0]).toEqual(profileTransforms[1]);

      const crossingSequence = generated.reverseProfileCrossing
        ? [
            { profileCase: PROFILE_CASES[1], viewport: generated.expandedViewport },
            { profileCase: PROFILE_CASES[0], viewport: generated.compactViewport },
          ]
        : [
            { profileCase: PROFILE_CASES[0], viewport: generated.compactViewport },
            { profileCase: PROFILE_CASES[1], viewport: generated.expandedViewport },
          ];
      for (const { profileCase, viewport } of crossingSequence) {
        const selection = resolveResponsiveCoverPresentation(exactAlignmentInput(
          transformFor(viewport, profileCase),
          viewport,
          profileCase,
          generated.point,
          generated.rect,
          generated.activeElapsedMs,
        ));
        expect(selection.kind).toBe("enhanced");
        expect(selection.activeElapsedMs).toBe(generated.activeElapsedMs);
      }

      const orientationSequence = [
        {
          profileCase: PROFILE_CASES[0],
          viewport: {
            height: generated.orientationLongSide,
            width: generated.orientationShortSide,
          },
        },
        {
          profileCase: PROFILE_CASES[1],
          viewport: {
            height: generated.orientationShortSide,
            width: generated.orientationLongSide,
          },
        },
      ] as const;
      for (const { profileCase, viewport } of orientationSequence) {
        const remapped = resolveResponsiveCoverPresentation(exactAlignmentInput(
          transformFor(viewport, profileCase),
          viewport,
          profileCase,
          generated.point,
          generated.rect,
          generated.activeElapsedMs,
        ));
        expect(remapped.kind).toBe("enhanced");
        expect(remapped.activeElapsedMs).toBe(generated.activeElapsedMs);
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
