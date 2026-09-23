import fc from "fast-check";
import { expect, it } from "vitest";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 3: Canonical segmentation and reference composition";

// Reproduce with: seed=20250520, numRuns=128.
const PROPERTY_SEED = 20_250_520;
const PROPERTY_RUNS = 128;

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

type StrictSchema = {
  serialize(value: unknown): Buffer;
};

type ContractModule = {
  readonly CANONICAL_IDENTITY_MATRIX: Readonly<Record<string, number>>;
  readonly LAYER_RECORD_SCHEMA: StrictSchema;
  readonly SEMANTIC_CLASSES: readonly string[];
};

type OverlapResult = {
  readonly compositingOrder: readonly {
    readonly id: string;
    readonly zOrder: number;
  }[];
  readonly coverageCount: Uint16Array;
  readonly ownerIndex: Int32Array;
  readonly overlapPixelCount: number;
};

type CompositeResult = RgbaRaster & {
  readonly classification: Buffer;
  readonly compositingOrder: readonly {
    readonly id: string;
    readonly zOrder: number;
  }[];
  readonly nonOpaquePixelCount: number;
  readonly overlapPixelCount: number;
  readonly sourceVisiblePixelCount: number;
  readonly syntheticPixelCount: number;
  readonly transparentPixelCount: number;
};

type ExtractedLayer = RgbaRaster & {
  readonly alphaSum: number;
  readonly classification: Buffer;
  readonly mask: MaskRaster | null;
  readonly sourceRect: SourceRect | null;
  readonly sourceVisiblePixelCount: number;
  readonly syntheticPixelCount: number;
};

type ImageOperationsModule = {
  compositeOrderedLayers(layers: readonly {
    readonly classification: "source-visible" | "synthetic";
    readonly id: string;
    readonly image: RgbaRaster;
    readonly mask: MaskRaster;
    readonly zOrder: number;
  }[]): CompositeResult;
  computeTightBounds(mask: MaskRaster): SourceRect | null;
  countMaskCoverage(mask: MaskRaster): Readonly<{
    alphaSum: number;
    nonZeroPixelCount: number;
    opaquePixelCount: number;
    partialPixelCount: number;
  }>;
  createMaskEdgeBand(mask: MaskRaster, radius?: number): MaskRaster;
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
  extractMaskedRgba(options: {
    readonly mask: MaskRaster;
    readonly source: RgbaRaster;
    readonly sourceRect: SourceRect;
  }): ExtractedLayer;
  resolveOrderedOverlap(layers: readonly {
    readonly id: string;
    readonly mask: MaskRaster;
    readonly zOrder: number;
  }[]): OverlapResult;
};

type LayerRecord = {
  readonly approvalIds: readonly string[];
  readonly disposition: "static";
  readonly id: string;
  readonly provenanceIds: readonly string[];
  readonly reconstructedPixelCount: number;
  readonly referenceTransform: Readonly<Record<string, number>>;
  readonly segmentationMaskId: string;
  readonly semanticClass: string;
  readonly sourceRect: SourceRect;
  readonly sourceVisiblePixelCount: number;
  readonly zOrder: number;
};

type LayerFixture = {
  readonly authoredAlpha: Buffer;
  readonly image: RgbaRaster;
  readonly mask: MaskRaster;
  readonly record: LayerRecord;
  readonly requiresPartialAlpha: boolean;
};

type CompositionFixture = {
  readonly expectedOverlapPixelCount: number;
  readonly immutableMask: MaskRaster;
  readonly layers: readonly LayerFixture[];
  readonly reviewedCompositingOrder: readonly {
    readonly id: string;
    readonly zOrder: number;
  }[];
  readonly reviewedOwners: readonly string[];
  readonly source: RgbaRaster;
};

type ExtraLayerSeed = {
  readonly alphaValues: readonly number[];
  readonly semanticClass: string;
  readonly sourceRect: SourceRect;
};

type GeneratedCase = {
  readonly baseSemanticClass: string;
  readonly extraLayers: readonly ExtraLayerSeed[];
  readonly height: number;
  readonly immutableFlags: readonly boolean[];
  readonly ownerPixel: number;
  readonly sourceRgb: Uint8Array;
  readonly targetLayer: number;
  readonly width: number;
  readonly zOrders: readonly number[];
};

type InspectionResult =
  | { readonly accepted: true; readonly reason: null }
  | {
      readonly accepted: false;
      readonly reason:
        | "alpha"
        | "bounds"
        | "count"
        | "immutable"
        | "order"
        | "owner"
        | "production-validation";
    };

type RejectionReason = Extract<
  InspectionResult,
  { readonly accepted: false }
>["reason"];

// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const imageOperations = (await import("../../scripts/watch-2-5d/image-operations.mjs")) as unknown as ImageOperationsModule;

function semanticClassArbitrary(): fc.Arbitrary<string> {
  if (contract.SEMANTIC_CLASSES.length === 0) {
    throw new Error("The production semantic-class catalog must not be empty");
  }
  return fc.integer({
    min: 0,
    max: contract.SEMANTIC_CLASSES.length - 1,
  }).map((index) => {
    const semanticClass = contract.SEMANTIC_CLASSES[index];
    if (semanticClass === undefined) throw new Error("Generated semantic class is absent");
    return semanticClass;
  });
}

function sourceRectArbitrary(width: number, height: number): fc.Arbitrary<SourceRect> {
  return fc.record({
    x: fc.integer({ min: 3, max: width - 1 }),
    y: fc.integer({ min: 3, max: height - 1 }),
  }).chain(({ x, y }) => fc.record({
    height: fc.integer({ min: 1, max: height - y }),
    width: fc.integer({ min: 1, max: width - x }),
    x: fc.constant(x),
    y: fc.constant(y),
  }).map((sourceRect) => ({ ...sourceRect })));
}

function extraLayerArbitrary(width: number, height: number): fc.Arbitrary<ExtraLayerSeed> {
  return sourceRectArbitrary(width, height).chain((sourceRect) => {
    const area = sourceRect.width * sourceRect.height;
    return fc.record({
      alphaParts: fc.tuple(
        fc.integer({ min: 1, max: 254 }),
        fc.array(fc.integer({ min: 1, max: 255 }), {
          maxLength: area - 1,
          minLength: area - 1,
        }),
      ),
      semanticClass: semanticClassArbitrary(),
    }).map(({ alphaParts: [partialAlpha, remainingAlpha], semanticClass }) => ({
      alphaValues: [partialAlpha, ...remainingAlpha],
      semanticClass,
      sourceRect,
    }));
  });
}

const generatedCaseArbitrary: fc.Arbitrary<GeneratedCase> = fc.record({
  height: fc.integer({ min: 7, max: 10 }),
  layerCount: fc.integer({ min: 2, max: 4 }),
  width: fc.integer({ min: 7, max: 10 }),
}).chain(({ height, layerCount, width }) => {
  const pixelCount = width * height;
  return fc.record({
    baseSemanticClass: semanticClassArbitrary(),
    extraLayers: fc.array(extraLayerArbitrary(width, height), {
      maxLength: layerCount - 1,
      minLength: layerCount - 1,
    }),
    immutableFlags: fc.array(fc.boolean(), {
      maxLength: pixelCount,
      minLength: pixelCount,
    }),
    ownerPixel: fc.integer({ min: 0, max: pixelCount - 1 }),
    sourceRgb: fc.uint8Array({
      maxLength: pixelCount * 3,
      minLength: pixelCount * 3,
    }),
    targetLayer: fc.integer({ min: 0, max: layerCount - 1 }),
    zOrders: fc.uniqueArray(fc.integer({ min: 0, max: 32 }), {
      maxLength: layerCount,
      minLength: layerCount,
    }),
  }).map((generated) => ({
    ...generated,
    height,
    width,
  }));
});

function sameRect(left: SourceRect | null, right: SourceRect): boolean {
  return left !== null
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function sameOrder(
  left: readonly { readonly id: string; readonly zOrder: number }[],
  right: readonly { readonly id: string; readonly zOrder: number }[],
): boolean {
  return left.length === right.length && left.every((entry, index) => (
    entry.id === right[index]?.id && entry.zOrder === right[index]?.zOrder
  ));
}

function createSource(generated: GeneratedCase): RgbaRaster {
  const pixelCount = generated.width * generated.height;
  const data = Buffer.alloc(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceOffset = pixel * 3;
    const outputOffset = pixel * 4;
    data[outputOffset] = generated.sourceRgb[sourceOffset] ?? 0;
    data[outputOffset + 1] = generated.sourceRgb[sourceOffset + 1] ?? 0;
    data[outputOffset + 2] = generated.sourceRgb[sourceOffset + 2] ?? 0;
    data[outputOffset + 3] = 255;
  }
  return imageOperations.createRgbaRaster({
    data,
    height: generated.height,
    width: generated.width,
  });
}

function createLayer(
  source: RgbaRaster,
  sourceRect: SourceRect,
  semanticClass: string,
  alphaValues: readonly number[],
  zOrder: number,
  index: number,
): LayerFixture {
  const data = Buffer.alloc(source.width * source.height);
  for (let localY = 0; localY < sourceRect.height; localY += 1) {
    for (let localX = 0; localX < sourceRect.width; localX += 1) {
      const localPixel = localY * sourceRect.width + localX;
      const sourcePixel = (sourceRect.y + localY) * source.width + sourceRect.x + localX;
      data[sourcePixel] = alphaValues[localPixel] ?? 0;
    }
  }
  const id = `layer-${index}`;
  return {
    authoredAlpha: Buffer.from(alphaValues),
    image: source,
    mask: imageOperations.createMaskRaster({
      data,
      height: source.height,
      width: source.width,
    }),
    record: {
      approvalIds: [],
      disposition: "static",
      id,
      provenanceIds: [],
      reconstructedPixelCount: 0,
      referenceTransform: { ...contract.CANONICAL_IDENTITY_MATRIX },
      segmentationMaskId: `mask-${id}`,
      semanticClass,
      sourceRect,
      sourceVisiblePixelCount: sourceRect.width * sourceRect.height,
      zOrder,
    },
    requiresPartialAlpha: index !== 0,
  };
}

function reviewedOwners(layers: readonly LayerFixture[], pixelCount: number): readonly string[] {
  const ordered = [...layers].sort((left, right) => (
    left.record.zOrder - right.record.zOrder
    || left.record.id.localeCompare(right.record.id)
  ));
  return Array.from({ length: pixelCount }, (_, pixel) => {
    let owner: string | null = null;
    for (const layer of ordered) {
      if (layer.mask.data[pixel] !== 0) owner = layer.record.id;
    }
    if (owner === null) throw new Error(`Generated source pixel ${pixel} has no reviewed owner`);
    return owner;
  });
}

function buildFixture(generated: GeneratedCase): CompositionFixture {
  const source = createSource(generated);
  const fullSourceRect = {
    height: source.height,
    width: source.width,
    x: 0,
    y: 0,
  } as const;
  const layers = [
    createLayer(
      source,
      fullSourceRect,
      generated.baseSemanticClass,
      Array.from({ length: source.width * source.height }, () => 255),
      generated.zOrders[0] ?? 0,
      0,
    ),
    ...generated.extraLayers.map((seed, index) => createLayer(
      source,
      seed.sourceRect,
      seed.semanticClass,
      seed.alphaValues,
      generated.zOrders[index + 1] ?? index + 1,
      index + 1,
    )),
  ];
  const pixelCount = source.width * source.height;
  const expectedOverlapPixelCount = Array.from({ length: pixelCount }, (_, pixel) => (
    layers.reduce((count, layer) => count + Number(layer.mask.data[pixel] !== 0), 0)
  )).filter((coverage) => coverage > 1).length;
  const edgeBands = layers.slice(1).map((layer) => (
    imageOperations.createMaskEdgeBand(layer.mask)
  ));
  const immutableData = Buffer.alloc(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const outsideEveryEdgeBand = edgeBands.every((band) => band.data[pixel] === 0);
    immutableData[pixel] = generated.immutableFlags[pixel] && outsideEveryEdgeBand ? 255 : 0;
  }
  immutableData[0] = 255;
  if (edgeBands.some((band) => band.data[0] !== 0)) {
    throw new Error("Bounded generators must reserve source pixel zero as immutable");
  }
  const reviewedCompositingOrder = layers
    .map(({ record: { id, zOrder } }) => ({ id, zOrder }))
    .sort((left, right) => left.zOrder - right.zOrder || left.id.localeCompare(right.id));

  return {
    expectedOverlapPixelCount,
    immutableMask: imageOperations.createMaskRaster({
      data: immutableData,
      height: source.height,
      width: source.width,
    }),
    layers,
    reviewedCompositingOrder,
    reviewedOwners: reviewedOwners(layers, pixelCount),
    source,
  };
}

function inspectFixture(fixture: CompositionFixture): InspectionResult {
  try {
    for (const layer of fixture.layers) {
      contract.LAYER_RECORD_SCHEMA.serialize(layer.record);
      const extracted = imageOperations.extractMaskedRgba({
        mask: layer.mask,
        source: fixture.source,
        sourceRect: layer.record.sourceRect,
      });
      const coverage = imageOperations.countMaskCoverage(layer.mask);
      const tightBounds = imageOperations.computeTightBounds(layer.mask);
      if (!sameRect(extracted.sourceRect, layer.record.sourceRect) || !sameRect(tightBounds, layer.record.sourceRect)) {
        return { accepted: false, reason: "bounds" };
      }
      if (
        coverage.nonZeroPixelCount !== layer.record.sourceVisiblePixelCount
        || extracted.sourceVisiblePixelCount !== layer.record.sourceVisiblePixelCount
        || extracted.syntheticPixelCount !== layer.record.reconstructedPixelCount
      ) {
        return { accepted: false, reason: "count" };
      }
      if (
        extracted.mask === null
        || !extracted.mask.data.equals(layer.authoredAlpha)
        || extracted.alphaSum !== coverage.alphaSum
        || (layer.requiresPartialAlpha && coverage.partialPixelCount === 0)
      ) {
        return { accepted: false, reason: "alpha" };
      }
    }

    const overlap = imageOperations.resolveOrderedOverlap(fixture.layers.map((layer) => ({
      id: layer.record.id,
      mask: layer.mask,
      zOrder: layer.record.zOrder,
    })));
    if (!sameOrder(overlap.compositingOrder, fixture.reviewedCompositingOrder)) {
      return { accepted: false, reason: "order" };
    }
    if (overlap.overlapPixelCount !== fixture.expectedOverlapPixelCount) {
      return { accepted: false, reason: "order" };
    }
    for (let pixel = 0; pixel < overlap.ownerIndex.length; pixel += 1) {
      const ownerIndex = overlap.ownerIndex[pixel];
      const actualOwner = ownerIndex < 0
        ? null
        : overlap.compositingOrder[ownerIndex]?.id ?? null;
      if (actualOwner === null || actualOwner !== fixture.reviewedOwners[pixel]) {
        return { accepted: false, reason: "owner" };
      }
      const expectedCoverage = fixture.layers.reduce((count, layer) => (
        count + Number(layer.mask.data[pixel] !== 0)
      ), 0);
      if (overlap.coverageCount[pixel] !== expectedCoverage) {
        return { accepted: false, reason: "owner" };
      }
    }

    const composed = imageOperations.compositeOrderedLayers(fixture.layers.map((layer) => ({
      classification: "source-visible" as const,
      id: layer.record.id,
      image: layer.image,
      mask: layer.mask,
      zOrder: layer.record.zOrder,
    })));
    if (
      !sameOrder(composed.compositingOrder, fixture.reviewedCompositingOrder)
      || composed.overlapPixelCount !== fixture.expectedOverlapPixelCount
      || composed.sourceVisiblePixelCount !== fixture.source.width * fixture.source.height
      || composed.syntheticPixelCount !== 0
      || composed.transparentPixelCount !== 0
    ) {
      return { accepted: false, reason: "owner" };
    }
    for (let pixel = 0; pixel < fixture.immutableMask.data.length; pixel += 1) {
      if (fixture.immutableMask.data[pixel] === 0) continue;
      const offset = pixel * 4;
      if (!composed.data.subarray(offset, offset + 4).equals(
        fixture.source.data.subarray(offset, offset + 4),
      )) {
        return { accepted: false, reason: "immutable" };
      }
    }
    return { accepted: true, reason: null };
  } catch {
    return { accepted: false, reason: "production-validation" };
  }
}

function replaceLayerRecord(
  fixture: CompositionFixture,
  index: number,
  update: (record: LayerRecord) => LayerRecord,
): CompositionFixture {
  return {
    ...fixture,
    layers: fixture.layers.map((layer, layerIndex) => layerIndex === index
      ? { ...layer, record: update(layer.record) }
      : layer),
  };
}

function withChangedImmutablePixels(fixture: CompositionFixture): CompositionFixture {
  const immutablePixel = fixture.immutableMask.data.findIndex((alpha) => alpha !== 0);
  if (immutablePixel < 0) throw new Error("Generated fixture must contain an immutable pixel");
  return {
    ...fixture,
    layers: fixture.layers.map((layer) => {
      const data = Buffer.from(layer.image.data);
      const offset = immutablePixel * 4;
      data[offset] = (data[offset] ?? 0) ^ 0xff;
      return {
        ...layer,
        image: imageOperations.createRgbaRaster({
          data,
          height: layer.image.height,
          width: layer.image.width,
        }),
      };
    }),
  };
}

// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.12, 3.13, 3.15, 8.5**
// Feature: interactive-layered-watch-2-5d, Property 3: Canonical segmentation and reference composition
it(PROPERTY_TAG, { timeout: 120_000 }, () => {
  fc.assert(
    fc.property(generatedCaseArbitrary, (generated) => {
      const valid = buildFixture(generated);
      expect(inspectFixture(valid)).toEqual({ accepted: true, reason: null });

      const targetLayer = valid.layers[generated.targetLayer];
      if (targetLayer === undefined) throw new Error("Generated target layer is absent");

      const invalidSemantic = replaceLayerRecord(valid, generated.targetLayer, (record) => ({
        ...record,
        semanticClass: "not-a-reviewed-semantic-class",
      }));
      const invalidBound = replaceLayerRecord(valid, generated.targetLayer, (record) => ({
        ...record,
        sourceRect: {
          height: 1,
          width: 1,
          x: valid.source.width,
          y: 0,
        },
      }));
      const invalidCount = replaceLayerRecord(valid, generated.targetLayer, (record) => ({
        ...record,
        sourceVisiblePixelCount: Math.max(0, record.sourceVisiblePixelCount - 1),
      }));
      const invalidOwners = [...valid.reviewedOwners];
      invalidOwners[generated.ownerPixel] = "missing-reviewed-owner";
      const invalidOwner: CompositionFixture = {
        ...valid,
        reviewedOwners: invalidOwners,
      };
      const invalidOrder: CompositionFixture = {
        ...valid,
        reviewedCompositingOrder: [...valid.reviewedCompositingOrder].reverse(),
      };
      const duplicateZOrder = replaceLayerRecord(valid, 1, (record) => ({
        ...record,
        zOrder: valid.layers[0]?.record.zOrder ?? record.zOrder,
      }));

      const rejected: readonly {
        readonly fixture: CompositionFixture;
        readonly name: string;
        readonly reason: RejectionReason;
      }[] = [
        { fixture: invalidSemantic, name: "invalid semantic class", reason: "production-validation" },
        { fixture: invalidBound, name: "out-of-raster source rectangle", reason: "production-validation" },
        { fixture: invalidCount, name: "stale source-visible count", reason: "count" },
        { fixture: invalidOwner, name: "unreviewed source-visible owner", reason: "owner" },
        { fixture: invalidOrder, name: "stale reviewed compositing order", reason: "order" },
        { fixture: duplicateZOrder, name: "non-total duplicate z-order", reason: "production-validation" },
        { fixture: withChangedImmutablePixels(valid), name: "changed immutable source pixel", reason: "immutable" },
      ];

      for (const invalid of rejected) {
        expect(
          inspectFixture(invalid.fixture),
          `${invalid.name} must reject the generated reference composition`,
        ).toEqual({ accepted: false, reason: invalid.reason });
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
