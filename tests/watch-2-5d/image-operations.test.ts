import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

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
type CompositeResult = RgbaRaster & {
  readonly classification: Buffer;
  readonly compositingOrder: readonly { readonly id: string; readonly zOrder: number }[];
  readonly image: RgbaRaster;
  readonly nonOpaquePixelCount: number;
  readonly overlapMask: MaskRaster;
  readonly overlapPixelCount: number;
  readonly sourceVisiblePixelCount: number;
  readonly syntheticPixelCount: number;
  readonly transparentPixelCount: number;
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
  readonly footprintMask: MaskRaster;
  readonly image: RgbaRaster;
  readonly immutablePixelCount: number;
  readonly nonOpaquePixelCount: number;
  readonly replacedFootprintPixelCount: number;
  readonly sourceVisiblePixelCount: number;
  readonly syntheticPixelCount: number;
  readonly transparentPixelCount: number;
};
type Oracle = Readonly<Record<string, unknown>>;
type ImageOperationsModule = {
  readonly IMAGE_OPERATION_ISSUE_CODES: Readonly<Record<string, string>>;
  readonly MAX_RECONSTRUCTION_FEATHER_PIXELS: number;
  readonly PIXEL_CLASSIFICATION_CODES: Readonly<Record<string, number>>;
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
  computeTightBounds(mask: MaskRaster): SourceRect | null;
  countMaskCoverage(mask: MaskRaster): Readonly<Record<string, number>>;
  createMaskEdgeBand(mask: MaskRaster, radius?: number): MaskRaster;
  createMaskRaster(input: {
    readonly data: Uint8Array;
    readonly height: number;
    readonly width: number;
  }, options?: { readonly canonical?: boolean }): MaskRaster;
  createRgbaRaster(input: {
    readonly data: Uint8Array;
    readonly height: number;
    readonly width: number;
  }, options?: { readonly canonical?: boolean }): RgbaRaster;
  createSmallRasterOracle(options: {
    readonly classification?: Uint8Array;
    readonly image?: RgbaRaster;
    readonly masks?: Readonly<Record<string, MaskRaster>>;
  }): Oracle;
  createSweptBoundary(
    masks: readonly MaskRaster[],
    options?: { readonly feather?: number },
  ): MaskRaster;
  decodeCanonicalMask(value: Uint8Array, options?: { readonly path?: string }): Promise<MaskRaster>;
  decodeMaskPng8(value: Uint8Array, options: {
    readonly expectedHeight: number;
    readonly expectedWidth: number;
    readonly path?: string;
  }): Promise<MaskRaster>;
  differenceMasks(left: MaskRaster, right: MaskRaster): MaskRaster;
  extractMaskedRgba(options: {
    readonly edgePad?: number;
    readonly mask: MaskRaster;
    readonly source: RgbaRaster;
    readonly sourceRect?: SourceRect;
  }): RgbaRaster & {
    readonly alphaSum: number;
    readonly classification: Buffer;
    readonly mask: MaskRaster | null;
    readonly sourceRect: SourceRect | null;
    readonly sourceVisiblePixelCount: number;
    readonly syntheticPixelCount: number;
  };
  intersectMasks(masks: readonly MaskRaster[]): MaskRaster;
  resolveOrderedOverlap(layers: readonly {
    readonly id: string;
    readonly mask: MaskRaster;
    readonly zOrder: number;
  }[]): {
    readonly compositingOrder: readonly { readonly id: string; readonly zOrder: number }[];
    readonly coverageCount: Uint16Array;
    readonly overlapMask: MaskRaster;
    readonly overlapPixelCount: number;
    readonly ownerIndex: Int32Array;
  };
  serializeSmallRasterOracle(oracle: Oracle): Buffer;
  unionMasks(masks: readonly MaskRaster[]): MaskRaster;
  writeSmallRasterOracle(options: {
    readonly oracle: Oracle;
    readonly relativePath?: string;
    readonly stagingDirectory: string;
  }): Promise<{
    readonly byteLength: number;
    readonly path: string;
    readonly sha256: string;
  }>;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const imageOperations = (await import("../../scripts/watch-2-5d/image-operations.mjs")) as unknown as ImageOperationsModule;

const CANONICAL_WIDTH = 2_760;
const CANONICAL_HEIGHT = 1_504;
const PNG_OPTIONS = {
  adaptiveFiltering: false,
  compressionLevel: 9,
  palette: false,
  progressive: false,
} as const;
const temporaryRoots = new Set<string>();

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pixelIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

function maskFixture(
  width: number,
  height: number,
  samples: readonly (readonly [number, number, number])[] = [],
): MaskRaster {
  const data = Buffer.alloc(width * height);
  for (const [x, y, alpha] of samples) data[pixelIndex(width, x, y)] = alpha;
  return imageOperations.createMaskRaster({ data, height, width });
}

function rgbaFixture(
  width: number,
  height: number,
  sample: (x: number, y: number) => readonly [number, number, number, number],
): RgbaRaster {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = pixelIndex(width, x, y) * 4;
      const value = sample(x, y);
      data.set(value, offset);
    }
  }
  return imageOperations.createRgbaRaster({ data, height, width });
}

function rgbaAt(image: RgbaRaster, x: number, y: number): readonly number[] {
  const offset = pixelIndex(image.width, x, y) * 4;
  return Array.from(image.data.subarray(offset, offset + 4));
}

function pngCrc32(value: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb8_8320);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.from(data);
  const chunk = Buffer.alloc(12 + payload.byteLength);
  chunk.writeUInt32BE(payload.byteLength, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(
    pngCrc32(Buffer.concat([typeBytes, payload])),
    8 + payload.byteLength,
  );
  return chunk;
}

async function grayscalePng(width: number, height: number, data: Uint8Array): Promise<Buffer> {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  for (let y = 0; y < height; y += 1) {
    source.copy(scanlines, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function rgbaPng(width: number, height: number, data: Uint8Array): Promise<Buffer> {
  return sharp(data, { raw: { channels: 4, height, width } })
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "watch-2-5d-image-operations-"));
  temporaryRoots.add(root);
  return root;
}

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("strict canonical mask decoding", () => {
  it("decodes only canonical 8-bit grayscale bytes and retains antialiased samples", async () => {
    const raw = Buffer.alloc(CANONICAL_WIDTH * CANONICAL_HEIGHT);
    raw[pixelIndex(CANONICAL_WIDTH, 12, 20)] = 64;
    raw[pixelIndex(CANONICAL_WIDTH, 13, 20)] = 128;
    raw[pixelIndex(CANONICAL_WIDTH, 14, 21)] = 255;
    const png = await grayscalePng(CANONICAL_WIDTH, CANONICAL_HEIGHT, raw);
    const pngBefore = Buffer.from(png);

    const first = await imageOperations.decodeCanonicalMask(png);
    const second = await imageOperations.decodeCanonicalMask(png);

    expect(first.data).toEqual(raw);
    expect(second.data).toEqual(first.data);
    expect(first).toMatchObject({
      alphaSum: 447,
      height: CANONICAL_HEIGHT,
      nonZeroPixelCount: 3,
      opaquePixelCount: 1,
      partialPixelCount: 2,
      tightBounds: { height: 2, width: 3, x: 12, y: 20 },
      width: CANONICAL_WIDTH,
    });
    expect(png).toEqual(pngBefore);
  }, 60_000);

  it("rejects noncanonical dimensions and non-grayscale PNG color types deterministically", async () => {
    const grayscale = await grayscalePng(2, 2, Buffer.from([0, 64, 128, 255]));
    await expect(imageOperations.decodeCanonicalMask(grayscale)).rejects.toMatchObject({
      code: "LAYER_SEGMENTATION_INVALID",
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.DIMENSION_MISMATCH,
    });

    const rgba = await rgbaPng(2, 2, Buffer.from([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 127, 0, 255,
    ]));
    await expect(imageOperations.decodeMaskPng8(rgba, {
      expectedHeight: 2,
      expectedWidth: 2,
    })).rejects.toMatchObject({
      code: "LAYER_SEGMENTATION_INVALID",
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.MASK_DECODE_INVALID,
    });

    expect(() => imageOperations.createMaskRaster({
      data: Buffer.alloc((CANONICAL_WIDTH + 1) * 2),
      height: 2,
      width: CANONICAL_WIDTH + 1,
    })).toThrowError(expect.objectContaining({
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.INPUT_INVALID,
    }));
  });
});

describe("mask algebra, bounds, edge bands, and swept boundaries", () => {
  it("uses half-open tight bounds and deterministic alpha-preserving set operations", () => {
    const left = maskFixture(5, 4, [
      [1, 1, 64],
      [2, 1, 128],
      [1, 2, 255],
    ]);
    const right = maskFixture(5, 4, [
      [2, 1, 200],
      [3, 2, 255],
    ]);

    expect(imageOperations.computeTightBounds(left)).toEqual({
      height: 2,
      width: 2,
      x: 1,
      y: 1,
    });
    expect(imageOperations.countMaskCoverage(left)).toEqual({
      alphaSum: 447,
      nonZeroPixelCount: 3,
      opaquePixelCount: 1,
      partialPixelCount: 2,
    });

    const union = imageOperations.unionMasks([left, right]);
    const intersection = imageOperations.intersectMasks([left, right]);
    const difference = imageOperations.differenceMasks(left, right);
    expect(Array.from(union.data)).toEqual([
      0, 0, 0, 0, 0,
      0, 64, 200, 0, 0,
      0, 255, 0, 255, 0,
      0, 0, 0, 0, 0,
    ]);
    expect(intersection.nonZeroPixelCount).toBe(1);
    expect(intersection.data[pixelIndex(5, 2, 1)]).toBe(128);
    expect(difference.data[pixelIndex(5, 2, 1)]).toBe(0);
    expect(difference.data[pixelIndex(5, 1, 1)]).toBe(64);
  });

  it("builds two-sided edge bands and unions declared pose masks before bounded feathering", () => {
    const center = maskFixture(5, 5, [[2, 2, 128]]);
    const edgeBand = imageOperations.createMaskEdgeBand(center, 1);
    expect(edgeBand).toMatchObject({
      nonZeroPixelCount: 9,
      tightBounds: { height: 3, width: 3, x: 1, y: 1 },
    });
    expect(new Set(edgeBand.data)).toEqual(new Set([0, 255]));

    const leftPose = maskFixture(5, 5, [[1, 2, 128]]);
    const rightPose = maskFixture(5, 5, [[3, 2, 255]]);
    const swept = imageOperations.createSweptBoundary(
      [leftPose, rightPose],
      { feather: 1 },
    );
    expect(swept).toMatchObject({
      nonZeroPixelCount: 15,
      tightBounds: { height: 3, width: 5, x: 0, y: 1 },
    });
    expect(swept.data[pixelIndex(5, 0, 1)]).toBe(128);
    expect(swept.data[pixelIndex(5, 4, 3)]).toBe(255);
    expect(() => imageOperations.createSweptBoundary([center], {
      feather: imageOperations.MAX_RECONSTRUCTION_FEATHER_PIXELS + 1,
    })).toThrowError(expect.objectContaining({
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.COORDINATE_INVALID,
    }));
  });
});

describe("alpha-preserving extraction and ordered compositing", () => {
  it("extracts the exact half-open source rectangle without mutating source or mask bytes", () => {
    const source = rgbaFixture(4, 3, (x, y) => [
      x * 40 + y,
      y * 50 + x,
      200 - x * 10,
      x === 1 && y === 1 ? 200 : 255,
    ]);
    const mask = maskFixture(4, 3, [
      [1, 1, 128],
      [2, 1, 255],
    ]);
    const sourceBefore = Buffer.from(source.data);
    const maskBefore = Buffer.from(mask.data);

    const extracted = imageOperations.extractMaskedRgba({ mask, source });

    expect(extracted).toMatchObject({
      alphaSum: 355,
      height: 1,
      sourceRect: { height: 1, width: 2, x: 1, y: 1 },
      sourceVisiblePixelCount: 2,
      syntheticPixelCount: 0,
      width: 2,
    });
    expect(rgbaAt(extracted, 0, 0)).toEqual([41, 51, 190, 100]);
    expect(rgbaAt(extracted, 1, 0)).toEqual([81, 52, 180, 255]);
    expect(extracted.mask?.data).toEqual(Buffer.from([128, 255]));
    expect(source.data).toEqual(sourceBefore);
    expect(mask.data).toEqual(maskBefore);

    const empty = imageOperations.extractMaskedRgba({
      mask: maskFixture(4, 3),
      source,
    });
    expect(empty).toMatchObject({
      alphaSum: 0,
      height: 0,
      mask: null,
      sourceRect: null,
      sourceVisiblePixelCount: 0,
      width: 0,
    });
  });

  it("uses explicit total z-order for overlap ownership and straight-alpha composition", () => {
    const base = rgbaFixture(2, 1, () => [255, 0, 0, 255]);
    const green = rgbaFixture(2, 1, () => [0, 255, 0, 255]);
    const blueHalf = rgbaFixture(2, 1, () => [0, 0, 255, 128]);
    const full = maskFixture(2, 1, [[0, 0, 255], [1, 0, 255]]);
    const firstOnly = maskFixture(2, 1, [[0, 0, 255]]);
    const layerMasks = [
      { id: "high", mask: firstOnly, zOrder: 20 },
      { id: "base", mask: full, zOrder: 0 },
      { id: "middle", mask: firstOnly, zOrder: 10 },
    ] as const;

    const overlap = imageOperations.resolveOrderedOverlap(layerMasks);
    expect(overlap.compositingOrder).toEqual([
      { id: "base", zOrder: 0 },
      { id: "middle", zOrder: 10 },
      { id: "high", zOrder: 20 },
    ]);
    expect(overlap.ownerIndex[0]).toBe(2);
    expect(overlap.ownerIndex[1]).toBe(0);
    expect(overlap.coverageCount).toEqual(new Uint16Array([3, 1]));
    expect(overlap.overlapPixelCount).toBe(1);

    const composed = imageOperations.compositeOrderedLayers([
      {
        classification: "synthetic",
        id: "high",
        image: blueHalf,
        mask: firstOnly,
        zOrder: 20,
      },
      {
        classification: "source-visible",
        id: "base",
        image: base,
        mask: full,
        zOrder: 0,
      },
      {
        classification: "synthetic",
        id: "middle",
        image: green,
        mask: firstOnly,
        zOrder: 10,
      },
    ]);
    expect(rgbaAt(composed, 0, 0)).toEqual([0, 127, 128, 255]);
    expect(rgbaAt(composed, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(composed).toMatchObject({
      nonOpaquePixelCount: 0,
      overlapPixelCount: 1,
      sourceVisiblePixelCount: 1,
      syntheticPixelCount: 1,
      transparentPixelCount: 0,
    });
    expect(Array.from(composed.classification)).toEqual([
      imageOperations.PIXEL_CLASSIFICATION_CODES.synthetic,
      imageOperations.PIXEL_CLASSIFICATION_CODES["source-visible"],
    ]);

    expect(() => imageOperations.resolveOrderedOverlap([
      { id: "one", mask: full, zOrder: 1 },
      { id: "two", mask: full, zOrder: 1 },
    ])).toThrowError(expect.objectContaining({
      code: "LAYER_SEGMENTATION_INVALID",
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.OVERLAP_INVALID,
    }));
  });
});

describe("reconstructed-background composition", () => {
  it("replaces complete footprints, confines changes, preserves z-order, and labels all fill pixels synthetic", () => {
    const source = rgbaFixture(4, 2, (x, y) => [
      20 + x * 30,
      40 + y * 60,
      80 + x + y,
      255,
    ]);
    const sourceBefore = Buffer.from(source.data);
    const footprintMask = maskFixture(4, 2, [
      [1, 0, 255],
      [2, 0, 255],
    ]);
    const reconstructionMask = maskFixture(4, 2, [
      [1, 0, 255],
      [2, 0, 255],
      [3, 0, 128],
    ]);
    const boundaryMask = maskFixture(4, 2, [
      [0, 0, 255],
      [1, 0, 255],
      [2, 0, 255],
      [3, 0, 255],
    ]);
    const fill = rgbaFixture(4, 2, () => [7, 19, 211, 255]);

    const result = imageOperations.composeReconstructedBackground({
      reconstructions: [{
        boundaryMask,
        fill,
        footprintMask,
        id: "synthetic-fill",
        reconstructionMask,
        zOrder: 10,
      }],
      source,
    });

    expect(result).toMatchObject({
      completeFootprintReplacement: true,
      immutablePixelCount: 5,
      nonOpaquePixelCount: 0,
      replacedFootprintPixelCount: 2,
      sourceVisiblePixelCount: 5,
      syntheticPixelCount: 3,
      transparentPixelCount: 0,
    });
    expect(result.approvedChangeMask.nonZeroPixelCount).toBe(3);
    expect(rgbaAt(result, 1, 0)).toEqual([7, 19, 211, 255]);
    expect(rgbaAt(result, 2, 0)).toEqual([7, 19, 211, 255]);
    expect(rgbaAt(result, 0, 0)).toEqual(rgbaAt(source, 0, 0));
    expect(rgbaAt(result, 0, 1)).toEqual(rgbaAt(source, 0, 1));
    expect(result.classification[pixelIndex(4, 3, 0)])
      .toBe(imageOperations.PIXEL_CLASSIFICATION_CODES.synthetic);
    expect(source.data).toEqual(sourceBefore);

    const empty = imageOperations.composeReconstructedBackground({
      reconstructions: [],
      source,
    });
    expect(empty.data).toEqual(source.data);
    expect(empty).toMatchObject({
      immutablePixelCount: 8,
      replacedFootprintPixelCount: 0,
      sourceVisiblePixelCount: 8,
      syntheticPixelCount: 0,
    });
  });

  it("rejects incomplete footprints, out-of-bound fills, and nonopaque reconstruction data", () => {
    const source = rgbaFixture(3, 1, () => [30, 40, 50, 255]);
    const footprintMask = maskFixture(3, 1, [[1, 0, 255]]);
    const empty = maskFixture(3, 1);
    const center = maskFixture(3, 1, [[1, 0, 255]]);
    const leftBoundary = maskFixture(3, 1, [[0, 0, 255]]);
    const opaqueFill = rgbaFixture(3, 1, () => [80, 90, 100, 255]);
    const transparentFill = rgbaFixture(3, 1, (x) => [
      80,
      90,
      100,
      x === 1 ? 254 : 255,
    ]);

    const invalidRecords: readonly ReconstructionRecord[] = [
      {
        boundaryMask: center,
        fill: opaqueFill,
        footprintMask,
        id: "missing-footprint",
        reconstructionMask: empty,
        zOrder: 1,
      },
      {
        boundaryMask: leftBoundary,
        fill: opaqueFill,
        footprintMask,
        id: "outside-boundary",
        reconstructionMask: center,
        zOrder: 1,
      },
      {
        boundaryMask: center,
        fill: transparentFill,
        footprintMask,
        id: "transparent-fill",
        reconstructionMask: center,
        zOrder: 1,
      },
    ];

    for (const record of invalidRecords) {
      expect(() => imageOperations.composeReconstructedBackground({
        reconstructions: [record],
        source,
      })).toThrowError(expect.objectContaining({
        code: "LAYER_RECONSTRUCTION_INVALID",
        issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
      }));
    }
  });
});

describe("small-raster oracle and staging-only output", () => {
  it("serializes byte-stable rows and cannot write outside the supplied non-symlink staging root", async () => {
    const source = rgbaFixture(2, 2, (x, y) => [
      20 + x,
      30 + y,
      40 + x + y,
      255,
    ]);
    const footprintMask = maskFixture(2, 2, [[1, 0, 255]]);
    const reconstruction = imageOperations.composeReconstructedBackground({
      reconstructions: [{
        boundaryMask: footprintMask,
        fill: rgbaFixture(2, 2, () => [100, 110, 120, 255]),
        footprintMask,
        id: "oracle-fill",
        reconstructionMask: footprintMask,
        zOrder: 1,
      }],
      source,
    });
    const oracle = imageOperations.createSmallRasterOracle({
      classification: reconstruction.classification,
      image: reconstruction.image,
      masks: {
        "approved-change": reconstruction.approvedChangeMask,
        footprint: reconstruction.footprintMask,
      },
    });
    const firstBytes = imageOperations.serializeSmallRasterOracle(oracle);
    const secondBytes = imageOperations.serializeSmallRasterOracle(oracle);
    expect(secondBytes).toEqual(firstBytes);
    expect(firstBytes.toString("utf8").endsWith("\n")).toBe(true);
    expect(JSON.parse(firstBytes.toString("utf8"))).toMatchObject({
      classificationRows: [
        ["source-visible", "synthetic"],
        ["source-visible", "source-visible"],
      ],
      masks: {
        "approved-change": [[0, 255], [0, 0]],
        footprint: [[0, 255], [0, 0]],
      },
      schemaVersion: 1,
      sourceCoordinateSpace: { height: 2, width: 2 },
    });

    const root = await temporaryRoot();
    const staging = resolve(root, "staging");
    const outside = resolve(root, "outside");
    await mkdir(staging);
    await mkdir(outside);
    expect(await readdir(staging)).toEqual([]);
    expect(await readdir(outside)).toEqual([]);

    const identity = await imageOperations.writeSmallRasterOracle({
      oracle,
      relativePath: "diagnostics/oracle.json",
      stagingDirectory: staging,
    });
    expect(identity).toEqual({
      byteLength: firstBytes.byteLength,
      path: "diagnostics/oracle.json",
      sha256: sha256(firstBytes),
    });
    expect(await readFile(resolve(staging, identity.path))).toEqual(firstBytes);
    expect(await readdir(outside)).toEqual([]);

    await expect(imageOperations.writeSmallRasterOracle({
      oracle,
      relativePath: "../escape.json",
      stagingDirectory: staging,
    })).rejects.toMatchObject({
      code: "LAYER_PATH_INVALID",
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
    });
    await expect(imageOperations.writeSmallRasterOracle({
      oracle,
      relativePath: resolve(root, "absolute-escape.json"),
      stagingDirectory: staging,
    })).rejects.toMatchObject({
      code: "LAYER_PATH_INVALID",
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
    });

    await symlink(outside, resolve(staging, "linked-outside"));
    await expect(imageOperations.writeSmallRasterOracle({
      oracle,
      relativePath: "linked-outside/escape.json",
      stagingDirectory: staging,
    })).rejects.toMatchObject({
      code: "LAYER_PATH_INVALID",
      issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.OUTPUT_UNSAFE,
    });
    expect(await readdir(outside)).toEqual([]);
  });
});
