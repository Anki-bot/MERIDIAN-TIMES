import fc from "fast-check";
import { expect, it } from "vitest";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 4: Reconstruction containment, change confinement, and opaque coverage";

// Reproduce with: seed=20250604, numRuns=128.
const PROPERTY_SEED = 20_250_604;
const PROPERTY_RUNS = 128;

type Rgba = readonly [number, number, number, 255];
type Offset = readonly [number, number];
type SourceRect = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};
type MaskRaster = {
  readonly alphaSum: number;
  readonly data: Buffer;
  readonly height: number;
  readonly nonZeroPixelCount: number;
  readonly opaquePixelCount: number;
  readonly partialPixelCount: number;
  readonly tightBounds: SourceRect | null;
  readonly width: number;
};
type RgbaRaster = {
  readonly data: Buffer;
  readonly height: number;
  readonly width: number;
};
type ReconstructionRecord = {
  readonly boundaryMask: MaskRaster;
  readonly fill: RgbaRaster;
  readonly footprintMask: MaskRaster;
  readonly id: string;
  readonly reconstructionMask: MaskRaster;
  readonly zOrder: number;
};
type ReconstructionResult = RgbaRaster & {
  readonly approvedChangeMask: MaskRaster;
  readonly classification: Buffer;
  readonly completeFootprintReplacement: boolean;
  readonly image: RgbaRaster;
  readonly immutablePixelCount: number;
  readonly nonOpaquePixelCount: number;
  readonly reconstructionRecords: readonly {
    readonly classification: "synthetic";
    readonly id: string;
    readonly zOrder: number;
  }[];
  readonly replacedFootprintPixelCount: number;
  readonly sourceVisiblePixelCount: number;
  readonly syntheticPixelCount: number;
  readonly transparentPixelCount: number;
};
type CompositeResult = RgbaRaster & {
  readonly compositingOrder: readonly {
    readonly id: string;
    readonly zOrder: number;
  }[];
  readonly image: RgbaRaster;
  readonly nonOpaquePixelCount: number;
  readonly transparentPixelCount: number;
};
type ImageOperationsModule = {
  readonly IMAGE_OPERATION_ISSUE_CODES: Readonly<Record<string, string>>;
  readonly MAX_RECONSTRUCTION_FEATHER_PIXELS: number;
  compositeOrderedLayers(layers: readonly {
    readonly classification: "source-visible" | "synthetic";
    readonly id: string;
    readonly image: RgbaRaster;
    readonly mask: MaskRaster;
    readonly zOrder: number;
  }[]): CompositeResult;
  composeReconstructedBackground(options: {
    readonly reconstructions: readonly ReconstructionRecord[];
    readonly source: RgbaRaster;
  }): ReconstructionResult;
  createMaskRaster(input: {
    readonly data: Uint8Array;
    readonly height: number;
    readonly width: number;
  }): MaskRaster;
  createRgbaRaster(input: {
    readonly data: Uint8Array;
    readonly height: number;
    readonly width: number;
  }): RgbaRaster;
  createSmallRasterOracle(options: {
    readonly classification: Uint8Array;
    readonly image: RgbaRaster;
    readonly masks: Readonly<Record<string, MaskRaster>>;
  }): Readonly<Record<string, unknown>>;
  createSweptBoundary(
    masks: readonly MaskRaster[],
    options?: { readonly feather?: number },
  ): MaskRaster;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const imageOperations = (await import("../../scripts/watch-2-5d/image-operations.mjs")) as unknown as ImageOperationsModule;

type OracleLayer = {
  readonly color: Rgba;
  readonly id: string;
  readonly mask: Uint8Array;
  readonly zOrder: number;
};
type CandidateEvaluation =
  | { readonly eligible: true; readonly result: ReconstructionResult }
  | {
      readonly code: string;
      readonly eligible: false;
      readonly issueCode: string;
    };

const nonZeroOffsetArbitrary = fc
  .tuple(
    fc.integer({ max: 2, min: -2 }),
    fc.integer({ max: 2, min: -2 }),
  )
  .filter(([x, y]) => x !== 0 || y !== 0);

const scenarioArbitrary = fc
  .record({
    height: fc.integer({ max: 8, min: 4 }),
    width: fc.integer({ max: 8, min: 4 }),
  })
  .chain(({ height, width }) => {
    const pixelCount = width * height;
    const pixelArbitrary = fc.integer({ max: pixelCount - 1, min: 0 });
    return fc.record({
      backgroundRgb: fc.tuple(
        fc.integer({ max: 255, min: 0 }),
        fc.integer({ max: 255, min: 0 }),
        fc.integer({ max: 255, min: 0 }),
      ),
      depthOffset: nonZeroOffsetArbitrary,
      faultSalt: fc.nat(),
      feather: fc.integer({ max: 4, min: 0 }),
      footprintIndices: fc.uniqueArray(pixelArbitrary, {
        maxLength: Math.min(10, pixelCount),
        minLength: 1,
      }),
      height: fc.constant(height),
      inputReversed: fc.boolean(),
      motionOffset: nonZeroOffsetArbitrary,
      movingAboveOccluder: fc.boolean(),
      occluderIndices: fc.uniqueArray(pixelArbitrary, {
        maxLength: Math.min(8, pixelCount),
        minLength: 0,
      }),
      reconstructionZOrder: fc.integer({ max: 100, min: -100 }),
      width: fc.constant(width),
      zOrders: fc.uniqueArray(fc.integer({ max: 40, min: -40 }), {
        maxLength: 3,
        minLength: 3,
      }),
    });
  });

function binaryMaskData(pixelCount: number, indices: readonly number[]): Buffer {
  const data = Buffer.alloc(pixelCount);
  for (const index of indices) data[index] = 255;
  return data;
}

function translateMaskData(
  indices: readonly number[],
  width: number,
  height: number,
  [offsetX, offsetY]: Offset,
): Buffer {
  const translated = Buffer.alloc(width * height);
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const translatedX = (x + offsetX + width) % width;
    const translatedY = (y + offsetY + height) % height;
    translated[translatedY * width + translatedX] = 255;
  }
  return translated;
}

function oracleSweptBoundary(
  poseMasks: readonly Uint8Array[],
  width: number,
  height: number,
  feather: number,
): Buffer {
  const union = Buffer.alloc(width * height);
  for (const poseMask of poseMasks) {
    for (let pixel = 0; pixel < union.byteLength; pixel += 1) {
      union[pixel] = Math.max(union[pixel], poseMask[pixel]);
    }
  }

  const swept = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let maximum = 0;
      for (
        let sampleY = Math.max(0, y - feather);
        sampleY <= Math.min(height - 1, y + feather);
        sampleY += 1
      ) {
        for (
          let sampleX = Math.max(0, x - feather);
          sampleX <= Math.min(width - 1, x + feather);
          sampleX += 1
        ) {
          maximum = Math.max(maximum, union[sampleY * width + sampleX]);
        }
      }
      swept[y * width + x] = maximum;
    }
  }
  return swept;
}

function solidRgbaData(pixelCount: number, color: Rgba): Buffer {
  const data = Buffer.alloc(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    data.set(color, pixel * 4);
  }
  return data;
}

function oracleCompositeOpaque(
  layers: readonly OracleLayer[],
  width: number,
  height: number,
): Buffer {
  const ordered = [...layers].sort((left, right) => (
    left.zOrder - right.zOrder || left.id.localeCompare(right.id)
  ));
  const output = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (const layer of ordered) {
      if (layer.mask[pixel] !== 0) output.set(layer.color, pixel * 4);
    }
  }
  return output;
}

function pixelBytes(image: Uint8Array, pixel: number): Buffer {
  return Buffer.from(image.subarray(pixel * 4, pixel * 4 + 4));
}

function readErrorField(error: unknown, field: "code" | "issueCode"): string {
  if (error !== null && typeof error === "object") {
    const value = Reflect.get(error, field);
    if (typeof value === "string") return value;
  }
  throw error;
}

function evaluateCandidate(
  source: RgbaRaster,
  record: ReconstructionRecord,
): CandidateEvaluation {
  try {
    return {
      eligible: true,
      result: imageOperations.composeReconstructedBackground({
        reconstructions: [record],
        source,
      }),
    };
  } catch (error) {
    return {
      code: readErrorField(error, "code"),
      eligible: false,
      issueCode: readErrorField(error, "issueCode"),
    };
  }
}

// **Validates: Requirements 4.1, 4.2, 4.7, 4.8, 4.9, 4.13, 4.14, 5.9, 7.10, 8.6, 13.7**
// Feature: interactive-layered-watch-2-5d, Property 4: Reconstruction containment, change confinement, and opaque coverage
it(PROPERTY_TAG, { timeout: 120_000 }, () => {
  fc.assert(
    fc.property(scenarioArbitrary, (scenario) => {
      const {
        backgroundRgb,
        depthOffset,
        faultSalt,
        feather,
        footprintIndices,
        height,
        inputReversed,
        motionOffset,
        movingAboveOccluder,
        occluderIndices,
        reconstructionZOrder,
        width,
      } = scenario;
      const pixelCount = width * height;
      const [backgroundZOrder, lowerForegroundZOrder, upperForegroundZOrder] = [
        ...scenario.zOrders,
      ].sort((left, right) => left - right);
      const movingZOrder = movingAboveOccluder
        ? upperForegroundZOrder
        : lowerForegroundZOrder;
      const occluderZOrder = movingAboveOccluder
        ? lowerForegroundZOrder
        : upperForegroundZOrder;
      const backgroundColor = [...backgroundRgb, 255] as Rgba;
      const movingColor = [
        backgroundRgb[0] ^ 0xff,
        backgroundRgb[1] ^ 0x55,
        backgroundRgb[2] ^ 0xaa,
        255,
      ] as const;
      const occluderColor = [
        backgroundRgb[0] ^ 0x55,
        backgroundRgb[1] ^ 0xaa,
        backgroundRgb[2] ^ 0xff,
        255,
      ] as const;

      const fullMaskData = Buffer.alloc(pixelCount, 255);
      const footprintData = binaryMaskData(pixelCount, footprintIndices);
      const motionData = translateMaskData(
        footprintIndices,
        width,
        height,
        motionOffset,
      );
      const depthData = translateMaskData(
        footprintIndices,
        width,
        height,
        depthOffset,
      );
      const occluderData = binaryMaskData(pixelCount, occluderIndices);
      const footprintMask = imageOperations.createMaskRaster({
        data: footprintData,
        height,
        width,
      });
      const motionMask = imageOperations.createMaskRaster({
        data: motionData,
        height,
        width,
      });
      const depthMask = imageOperations.createMaskRaster({
        data: depthData,
        height,
        width,
      });
      const occluderMask = imageOperations.createMaskRaster({
        data: occluderData,
        height,
        width,
      });
      const fullMask = imageOperations.createMaskRaster({
        data: fullMaskData,
        height,
        width,
      });
      const approvedChangeMask = imageOperations.createSweptBoundary(
        [footprintMask, motionMask, depthMask],
        { feather },
      );
      const expectedApprovedChange = oracleSweptBoundary(
        [footprintData, motionData, depthData],
        width,
        height,
        feather,
      );

      expect(feather).toBeLessThanOrEqual(
        imageOperations.MAX_RECONSTRUCTION_FEATHER_PIXELS,
      );
      expect(approvedChangeMask.data).toEqual(expectedApprovedChange);

      const sourceBytes = oracleCompositeOpaque([
        {
          color: backgroundColor,
          id: "background",
          mask: fullMaskData,
          zOrder: backgroundZOrder,
        },
        {
          color: movingColor,
          id: "moving-part",
          mask: footprintData,
          zOrder: movingZOrder,
        },
        {
          color: occluderColor,
          id: "static-occluder",
          mask: occluderData,
          zOrder: occluderZOrder,
        },
      ], width, height);
      const source = imageOperations.createRgbaRaster({
        data: sourceBytes,
        height,
        width,
      });
      const fill = imageOperations.createRgbaRaster({
        data: solidRgbaData(pixelCount, backgroundColor),
        height,
        width,
      });
      const movingImage = imageOperations.createRgbaRaster({
        data: solidRgbaData(pixelCount, movingColor),
        height,
        width,
      });
      const occluderImage = imageOperations.createRgbaRaster({
        data: solidRgbaData(pixelCount, occluderColor),
        height,
        width,
      });
      const validRecord: ReconstructionRecord = {
        boundaryMask: approvedChangeMask,
        fill,
        footprintMask,
        id: "synthetic-background-fill",
        reconstructionMask: approvedChangeMask,
        zOrder: reconstructionZOrder,
      };
      const validEvaluation = evaluateCandidate(source, validRecord);
      expect(validEvaluation.eligible).toBe(true);
      if (!validEvaluation.eligible) {
        throw new Error(`Valid reconstruction was rejected: ${validEvaluation.code}`);
      }

      const reconstructed = validEvaluation.result;
      const approvedPixelCount = expectedApprovedChange.reduce(
        (count, alpha) => count + Number(alpha !== 0),
        0,
      );
      expect(reconstructed).toMatchObject({
        completeFootprintReplacement: true,
        immutablePixelCount: pixelCount - approvedPixelCount,
        nonOpaquePixelCount: 0,
        replacedFootprintPixelCount: footprintIndices.length,
        syntheticPixelCount: approvedPixelCount,
        transparentPixelCount: 0,
      });
      expect(reconstructed.approvedChangeMask.data).toEqual(expectedApprovedChange);
      expect(reconstructed.reconstructionRecords).toEqual([{
        classification: "synthetic",
        id: validRecord.id,
        zOrder: reconstructionZOrder,
      }]);

      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        if (expectedApprovedChange[pixel] === 0) {
          expect(pixelBytes(reconstructed.data, pixel)).toEqual(
            pixelBytes(source.data, pixel),
          );
        } else {
          expect(pixelBytes(reconstructed.data, pixel)).toEqual(
            Buffer.from(backgroundColor),
          );
        }
        if (footprintData[pixel] !== 0) {
          expect(pixelBytes(reconstructed.data, pixel)).not.toEqual(
            pixelBytes(source.data, pixel),
          );
        }
      }

      const oracle = imageOperations.createSmallRasterOracle({
        classification: reconstructed.classification,
        image: reconstructed.image,
        masks: {
          "approved-change": reconstructed.approvedChangeMask,
          "depth-sample": depthMask,
          footprint: footprintMask,
          "motion-sample": motionMask,
        },
      });
      expect(oracle).toMatchObject({
        schemaVersion: 1,
        sourceCoordinateSpace: { height, width },
      });

      const poseSamples = [
        { id: "reference-sample", mask: footprintMask, oracleMask: footprintData },
        { id: "motion-sample", mask: motionMask, oracleMask: motionData },
        { id: "depth-sample", mask: depthMask, oracleMask: depthData },
      ] as const;
      for (const pose of poseSamples) {
        const layers = [
          {
            classification: "source-visible" as const,
            id: "reconstructed-background",
            image: reconstructed.image,
            mask: fullMask,
            zOrder: backgroundZOrder,
          },
          {
            classification: "source-visible" as const,
            id: "moving-part",
            image: movingImage,
            mask: pose.mask,
            zOrder: movingZOrder,
          },
          {
            classification: "source-visible" as const,
            id: "static-occluder",
            image: occluderImage,
            mask: occluderMask,
            zOrder: occluderZOrder,
          },
        ];
        if (inputReversed) layers.reverse();
        const composed = imageOperations.compositeOrderedLayers(layers);
        const expected = oracleCompositeOpaque([
          {
            color: backgroundColor,
            id: "reconstructed-background",
            mask: fullMaskData,
            zOrder: backgroundZOrder,
          },
          {
            color: movingColor,
            id: "moving-part",
            mask: pose.oracleMask,
            zOrder: movingZOrder,
          },
          {
            color: occluderColor,
            id: "static-occluder",
            mask: occluderData,
            zOrder: occluderZOrder,
          },
        ], width, height);

        expect(composed.data, `${pose.id} must match the bounded oracle`).toEqual(expected);
        expect(composed).toMatchObject({
          nonOpaquePixelCount: 0,
          transparentPixelCount: 0,
        });
        expect(composed.compositingOrder).toEqual([
          { id: "reconstructed-background", zOrder: backgroundZOrder },
          ...[
            { id: "moving-part", zOrder: movingZOrder },
            { id: "static-occluder", zOrder: occluderZOrder },
          ].sort((left, right) => left.zOrder - right.zOrder),
        ]);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          expect(composed.data[pixel * 4 + 3], `${pose.id} must remain opaque`).toBe(255);
          if (!pixelBytes(composed.data, pixel).equals(pixelBytes(source.data, pixel))) {
            expect(
              expectedApprovedChange[pixel],
              `${pose.id} changed pixel ${pixel} outside the approved-change region`,
            ).not.toBe(0);
          }
        }
        if (pose.id === "reference-sample") {
          expect(composed.data).toEqual(source.data);
        }
      }

      const approvedIndices = Array.from(expectedApprovedChange.keys()).filter(
        (pixel) => expectedApprovedChange[pixel] !== 0,
      );
      const approvedFaultPixel = approvedIndices[faultSalt % approvedIndices.length];
      const footprintFaultPixel = footprintIndices[faultSalt % footprintIndices.length];

      const holeFillData = Buffer.from(fill.data);
      holeFillData[approvedFaultPixel * 4 + 3] = 0;
      const residualMaskData = Buffer.from(approvedChangeMask.data);
      residualMaskData[footprintFaultPixel] = 0;
      const escapedBoundaryData = Buffer.from(approvedChangeMask.data);
      escapedBoundaryData[approvedFaultPixel] = 0;
      const invalidRecords: readonly {
        readonly name: string;
        readonly record: ReconstructionRecord;
      }[] = [
        {
          name: "transparent reconstruction hole",
          record: {
            ...validRecord,
            fill: imageOperations.createRgbaRaster({
              data: holeFillData,
              height,
              width,
            }),
          },
        },
        {
          name: "residual reference footprint",
          record: {
            ...validRecord,
            reconstructionMask: imageOperations.createMaskRaster({
              data: residualMaskData,
              height,
              width,
            }),
          },
        },
        {
          name: "synthetic pixel outside swept boundary",
          record: {
            ...validRecord,
            boundaryMask: imageOperations.createMaskRaster({
              data: escapedBoundaryData,
              height,
              width,
            }),
          },
        },
      ];

      for (const invalid of invalidRecords) {
        const evaluation = evaluateCandidate(source, invalid.record);
        expect(
          evaluation.eligible,
          `${invalid.name} must disable the generated candidate`,
        ).toBe(false);
        expect(evaluation).toMatchObject({
          code: "LAYER_RECONSTRUCTION_INVALID",
          eligible: false,
          issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
        });
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
