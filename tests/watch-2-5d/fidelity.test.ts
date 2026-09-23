import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

type RgbaRaster = {
  readonly data: Buffer;
  readonly height: number;
  readonly width: number;
};

type MaskRaster = {
  readonly data: Buffer;
  readonly height: number;
  readonly width: number;
};

type NamedMask = {
  readonly id: string;
  readonly mask: MaskRaster;
};

type SourceReport = {
  readonly checks: {
    readonly alphaCoverage: {
      readonly completeOpaqueCoverage: boolean;
      readonly nonOpaquePixelCount: number;
    };
    readonly completeFootprintReplacement: {
      readonly completeFootprintReplacement: boolean;
      readonly residualSourcePixelCount: number;
    };
    readonly immutableBytes: {
      readonly mismatchByteCount: number;
      readonly mismatchPixelCount: number;
      readonly ok: boolean;
    };
    readonly losslessReferenceComparison: {
      readonly changedInsideApprovedPixelCount: number;
      readonly changedOutsideApprovedPixelCount: number;
      readonly exactByteEquality: boolean;
    };
  };
  readonly derived: {
    readonly approvedChangeRegion: {
      readonly nonZeroPixelCount: number;
      readonly sha256: string;
    };
    readonly immutableRegion: {
      readonly nonZeroPixelCount: number;
    };
    readonly segmentationEdgeBand: {
      readonly nonZeroPixelCount: number;
    };
  };
  readonly failures: readonly {
    readonly code: string;
    readonly issueCode: string;
  }[];
  readonly inputs: {
    readonly canonicalSource: {
      readonly byteLength: number;
      readonly sha256: string;
    };
    readonly composition: {
      readonly sha256: string;
    };
  };
  readonly ok: boolean;
  readonly poseId: string;
  readonly reportType: string;
  readonly sampleKind: "reference" | "motion" | "depth";
  readonly sourceSpaceTruth: boolean;
};

type SourceReportOptions = {
  readonly approvedChangeMasks?: readonly NamedMask[];
  readonly canonicalSource: RgbaRaster;
  readonly composition: RgbaRaster;
  readonly poseId: string;
  readonly presentationMask?: MaskRaster;
  readonly reconstructedBackground?: RgbaRaster;
  readonly reconstructionMasks?: readonly NamedMask[];
  readonly referenceFootprintMasks?: readonly NamedMask[];
  readonly sampleKind?: "reference" | "motion" | "depth";
  readonly segmentationMasks?: readonly NamedMask[];
  readonly sweepMasks?: readonly NamedMask[];
};

type CoverTransform = {
  readonly coverScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

type AlignmentSample = {
  readonly anchors?: readonly {
    readonly id: string;
    readonly observed?: { readonly x: number; readonly y: number };
    readonly source: { readonly x: number; readonly y: number };
  }[];
  readonly observed: CoverTransform;
  readonly viewport: { readonly height: number; readonly width: number };
};

type AlignmentReport = {
  readonly failures: readonly { readonly issueCode: string }[];
  readonly inputs: {
    readonly alignmentSamplesSha256: string;
    readonly canonicalSourceSha256: string;
  };
  readonly ok: boolean;
  readonly poseId: string;
  readonly viewportSet: {
    readonly missingViewportWidths: readonly number[];
  };
  readonly viewports: readonly {
    readonly inputSha256: string;
    readonly maximumAlignmentErrorCssPixels: number;
    readonly ok: boolean;
    readonly viewport: { readonly width: number };
  }[];
};

type ScreenshotReport = {
  readonly checks: {
    readonly perPixel: {
      readonly matchingPixelRatio: number;
      readonly maximumObservedChannelDifference: number;
      readonly ok: boolean;
    };
    readonly ssim: {
      readonly ok: boolean;
      readonly value: number;
    };
  };
  readonly inputs: {
    readonly actual: { readonly sha256: string };
    readonly reference: { readonly sha256: string };
  };
  readonly ok: boolean;
  readonly poseId: string;
  readonly sourceSpaceTruth: boolean;
};

type FidelityModule = {
  readonly ALIGNMENT_TOLERANCE_CSS_PIXELS: number;
  readonly FIDELITY_ISSUE_CODES: Readonly<Record<string, string>>;
  readonly REQUIRED_ALIGNMENT_VIEWPORT_WIDTHS: readonly number[];
  assertAlphaCoverage(options: {
    readonly composition: RgbaRaster;
    readonly poseId: string;
    readonly presentationMask?: MaskRaster;
  }): Readonly<Record<string, unknown>>;
  assertCanonicalViewportAlignment(options: {
    readonly canonicalSourceSha256: string;
    readonly poseId: string;
    readonly samples: readonly AlignmentSample[];
  }): AlignmentReport;
  assertScreenshotFidelity(options: {
    readonly actual: RgbaRaster;
    readonly poseId: string;
    readonly reference: RgbaRaster;
  }): ScreenshotReport;
  assertSourceSpaceFidelity(options: SourceReportOptions): SourceReport;
  checkCanonicalViewportAlignment(options: {
    readonly canonicalSourceSha256: string;
    readonly poseId: string;
    readonly samples: readonly AlignmentSample[];
  }): AlignmentReport;
  compareScreenshotFidelity(options: {
    readonly actual: RgbaRaster;
    readonly poseId: string;
    readonly reference: RgbaRaster;
  }): ScreenshotReport;
  createCanonicalCoverTransform(options: {
    readonly viewportHeight: number;
    readonly viewportWidth: number;
  }): CoverTransform;
  createSourceSpaceFidelityReport(options: SourceReportOptions): SourceReport;
  deriveFidelityRegions(options: {
    readonly approvedChangeMasks?: readonly NamedMask[];
    readonly height: number;
    readonly reconstructionMasks?: readonly NamedMask[];
    readonly segmentationMasks?: readonly NamedMask[];
    readonly sweepMasks?: readonly NamedMask[];
    readonly width: number;
  }): {
    readonly approvedChangeRegion: { readonly nonZeroPixelCount: number };
    readonly immutableRegion: { readonly nonZeroPixelCount: number };
    readonly segmentationEdgeBand: { readonly nonZeroPixelCount: number };
  };
  projectCanonicalPoint(
    point: { readonly x: number; readonly y: number },
    transform: CoverTransform,
  ): { readonly x: number; readonly y: number };
  renderFidelitySampleReports(samples: readonly SourceReportOptions[]): {
    readonly inputSetSha256: string;
    readonly ok: boolean;
    readonly poseIds: readonly string[];
    readonly reports: readonly SourceReport[];
    readonly sampleCount: number;
  };
  serializeFidelityReport(report: Readonly<Record<string, unknown>>): Buffer;
};

type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: {
    readonly byteLength: number;
    readonly sha256: string;
  };
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const fidelity = (await import("../../scripts/watch-2-5d/fidelity.mjs")) as unknown as FidelityModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHA256_PATTERN = /^[a-f\d]{64}$/u;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function maskFixture(
  width: number,
  height: number,
  samples: readonly (readonly [number, number, number])[] = [],
): MaskRaster {
  const data = Buffer.alloc(width * height);
  for (const [x, y, alpha] of samples) data[y * width + x] = alpha;
  return { data, height, width };
}

function rgbaFixture(
  width: number,
  height: number,
  sample: (x: number, y: number) => readonly [number, number, number, number],
): RgbaRaster {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(sample(x, y), pixelOffset(width, x, y));
    }
  }
  return { data, height, width };
}

function namedMask(id: string, mask: MaskRaster): NamedMask {
  return { id, mask };
}

function alignmentSamples(): readonly AlignmentSample[] {
  const viewportHeights = new Map<number, number>([
    [320, 568],
    [390, 844],
    [700, 900],
    [701, 900],
    [1_024, 576],
    [1_440, 900],
    [2_560, 1_440],
  ]);
  return fidelity.REQUIRED_ALIGNMENT_VIEWPORT_WIDTHS.map((width) => {
    const height = viewportHeights.get(width);
    if (height === undefined) throw new Error(`No deterministic height for width ${width}`);
    const observed = fidelity.createCanonicalCoverTransform({
      viewportHeight: height,
      viewportWidth: width,
    });
    const sourceCenter = { x: 1_380, y: 752 } as const;
    return {
      anchors: [{
        id: "approved-pivot",
        observed: fidelity.projectCanonicalPoint(sourceCenter, observed),
        source: sourceCenter,
      }],
      observed,
      viewport: { height, width },
    };
  });
}

// **Validates: Requirements 3.8, 3.15, 4.7, 4.8, 4.13, 4.14, 7.10, 8.5, 8.6, 13.6, 13.7**
describe("source-space fidelity, change confinement, and alpha gates", () => {
  it("derives approved bands, emits stable hash-bound reports, and rejects one-pixel faults", () => {
    const source = rgbaFixture(9, 9, (x, y) => [
      x * 20,
      y * 20,
      (x + y) * 10,
      255,
    ]);
    const sourceBefore = Buffer.from(source.data);
    const segmentation = namedMask(
      "moving-part-mask",
      maskFixture(9, 9, [[4, 4, 128]]),
    );
    const insideBand = { ...source, data: Buffer.from(source.data) };
    insideBand.data[pixelOffset(9, 4, 4)] ^= 0xff;

    const regions = fidelity.deriveFidelityRegions({
      height: 9,
      segmentationMasks: [segmentation],
      width: 9,
    });
    expect(regions.segmentationEdgeBand.nonZeroPixelCount).toBe(25);
    expect(regions.approvedChangeRegion.nonZeroPixelCount).toBe(25);
    expect(regions.immutableRegion.nonZeroPixelCount).toBe(56);

    const first = fidelity.createSourceSpaceFidelityReport({
      canonicalSource: source,
      composition: insideBand,
      poseId: "reference-pose",
      segmentationMasks: [segmentation],
    });
    const second = fidelity.createSourceSpaceFidelityReport({
      canonicalSource: source,
      composition: insideBand,
      poseId: "reference-pose",
      segmentationMasks: [segmentation],
    });
    expect(first).toMatchObject({
      checks: {
        alphaCoverage: {
          completeOpaqueCoverage: true,
          nonOpaquePixelCount: 0,
        },
        immutableBytes: {
          mismatchByteCount: 0,
          mismatchPixelCount: 0,
          ok: true,
        },
        losslessReferenceComparison: {
          changedInsideApprovedPixelCount: 1,
          changedOutsideApprovedPixelCount: 0,
          exactByteEquality: false,
        },
      },
      ok: true,
      poseId: "reference-pose",
      reportType: "source-space-fidelity",
      sampleKind: "reference",
      sourceSpaceTruth: true,
    });
    expect(first.inputs.canonicalSource).toEqual({
      byteLength: source.data.byteLength,
      channels: 4,
      height: 9,
      sha256: sha256(source.data),
      width: 9,
    });
    expect(first.derived.approvedChangeRegion.sha256).toMatch(SHA256_PATTERN);
    expect(fidelity.serializeFidelityReport(first as unknown as Readonly<Record<string, unknown>>))
      .toEqual(fidelity.serializeFidelityReport(second as unknown as Readonly<Record<string, unknown>>));
    expect(source.data).toEqual(sourceBefore);

    const immutableMutation = { ...source, data: Buffer.from(source.data) };
    immutableMutation.data[pixelOffset(9, 0, 0)] ^= 0xff;
    expect(() => fidelity.assertSourceSpaceFidelity({
      canonicalSource: source,
      composition: immutableMutation,
      poseId: "reference-pose",
      segmentationMasks: [segmentation],
    })).toThrowError(expect.objectContaining({
      code: "LAYER_FIDELITY_INVALID",
      issueCode: fidelity.FIDELITY_ISSUE_CODES.IMMUTABLE_BYTES_CHANGED,
    }));

    const coverageMutation = { ...insideBand, data: Buffer.from(insideBand.data) };
    coverageMutation.data[pixelOffset(9, 4, 4) + 3] = 254;
    expect(() => fidelity.assertSourceSpaceFidelity({
      canonicalSource: source,
      composition: coverageMutation,
      poseId: "motion-maximum",
      sampleKind: "motion",
      segmentationMasks: [segmentation],
    })).toThrowError(expect.objectContaining({
      code: "LAYER_RECONSTRUCTION_INVALID",
      issueCode: fidelity.FIDELITY_ISSUE_CODES.ALPHA_COVERAGE_INCOMPLETE,
    }));
    expect(() => fidelity.assertAlphaCoverage({
      composition: coverageMutation,
      poseId: "motion-maximum",
    })).toThrowError(expect.objectContaining({
      code: "LAYER_RECONSTRUCTION_INVALID",
      issueCode: fidelity.FIDELITY_ISSUE_CODES.ALPHA_COVERAGE_INCOMPLETE,
    }));
  });

  it("requires opaque reconstructed coverage with no residual reference footprint", () => {
    const source = rgbaFixture(5, 5, (x, y) => [x * 30, y * 30, 90, 255]);
    const footprint = namedMask(
      "moving-reference-footprint",
      maskFixture(5, 5, [[2, 2, 255]]),
    );
    const reconstructed = { ...source, data: Buffer.from(source.data) };
    reconstructed.data[pixelOffset(5, 2, 2)] ^= 0xff;

    const passing = fidelity.assertSourceSpaceFidelity({
      approvedChangeMasks: [footprint],
      canonicalSource: source,
      composition: source,
      poseId: "motion-minimum",
      reconstructedBackground: reconstructed,
      referenceFootprintMasks: [footprint],
      sampleKind: "motion",
    });
    expect(passing.checks.completeFootprintReplacement).toEqual({
      completeFootprintReplacement: true,
      firstNonOpaquePixel: null,
      firstResidualPixel: null,
      footprintPixelCount: 1,
      nonOpaquePixelCount: 0,
      residualSourcePixelCount: 0,
    });

    expect(() => fidelity.assertSourceSpaceFidelity({
      approvedChangeMasks: [footprint],
      canonicalSource: source,
      composition: source,
      poseId: "motion-minimum",
      reconstructedBackground: source,
      referenceFootprintMasks: [footprint],
      sampleKind: "motion",
    })).toThrowError(expect.objectContaining({
      code: "LAYER_RECONSTRUCTION_INVALID",
      issueCode: fidelity.FIDELITY_ISSUE_CODES.FOOTPRINT_REPLACEMENT_INCOMPLETE,
    }));
  });

  it("renders reference, motion, and depth reports with exact hashes and pose IDs", () => {
    const source = rgbaFixture(4, 4, (x, y) => [x * 50, y * 50, 100, 255]);
    const suite = fidelity.renderFidelitySampleReports([
      {
        canonicalSource: source,
        composition: source,
        poseId: "depth-maximum",
        sampleKind: "depth",
      },
      {
        canonicalSource: source,
        composition: source,
        poseId: "reference-pose",
        sampleKind: "reference",
      },
      {
        canonicalSource: source,
        composition: source,
        poseId: "motion-minimum",
        sampleKind: "motion",
      },
    ]);

    expect(suite).toMatchObject({
      ok: true,
      poseIds: ["reference-pose", "motion-minimum", "depth-maximum"],
      sampleCount: 3,
    });
    expect(suite.inputSetSha256).toMatch(SHA256_PATTERN);
    for (const report of suite.reports) {
      expect(report.poseId.length).toBeGreaterThan(0);
      expect(report.inputs.canonicalSource.sha256).toBe(sha256(source.data));
      expect(report.inputs.composition.sha256).toBe(sha256(source.data));
    }
  });
});

// **Validates: Requirements 3.8, 8.3, 8.6, 8.13, 13.6**
describe("documented screenshot fidelity comparator", () => {
  it("passes exact RGBA screenshots and rejects threshold violations without claiming source truth", () => {
    const reference = rgbaFixture(11, 11, (x, y) => [
      x * 20,
      y * 20,
      (x + y) * 10,
      255,
    ]);
    const exact = fidelity.compareScreenshotFidelity({
      actual: reference,
      poseId: "reference-pose",
      reference,
    });
    expect(exact).toMatchObject({
      checks: {
        perPixel: {
          matchingPixelRatio: 1,
          maximumObservedChannelDifference: 0,
          ok: true,
        },
        ssim: { ok: true, value: 1 },
      },
      ok: true,
      poseId: "reference-pose",
      sourceSpaceTruth: false,
    });
    expect(exact.inputs.actual.sha256).toBe(sha256(reference.data));
    expect(exact.inputs.reference.sha256).toBe(sha256(reference.data));

    const changed = rgbaFixture(11, 11, () => [255, 255, 255, 255]);
    expect(() => fidelity.assertScreenshotFidelity({
      actual: changed,
      poseId: "reference-pose",
      reference,
    })).toThrowError(expect.objectContaining({
      code: "LAYER_FIDELITY_INVALID",
      issueCode: fidelity.FIDELITY_ISSUE_CODES.SCREENSHOT_SSIM_THRESHOLD,
    }));
    const failed = fidelity.compareScreenshotFidelity({
      actual: changed,
      poseId: "reference-pose",
      reference,
    });
    expect(failed.ok).toBe(false);
    expect(failed.checks.ssim.value).toBeLessThan(0.995);
    expect(failed.checks.perPixel.matchingPixelRatio).toBeLessThan(0.995);
  });
});

// **Validates: Requirements 8.2, 8.4, 8.12, 8.13**
describe("canonical-to-viewport alignment gate", () => {
  it("checks every required width and rejects a one-CSS-pixel transform violation", () => {
    const canonicalSourceSha256 = sha256(Buffer.from("deterministic-canonical-source"));
    const samples = alignmentSamples();
    const passing = fidelity.assertCanonicalViewportAlignment({
      canonicalSourceSha256,
      poseId: "reference-pose",
      samples,
    });
    expect(passing).toMatchObject({
      ok: true,
      poseId: "reference-pose",
      viewportSet: { missingViewportWidths: [] },
    });
    expect(passing.inputs.canonicalSourceSha256).toBe(canonicalSourceSha256);
    expect(passing.inputs.alignmentSamplesSha256).toMatch(SHA256_PATTERN);
    expect(passing.viewports.map(({ viewport }) => viewport.width)).toEqual(
      fidelity.REQUIRED_ALIGNMENT_VIEWPORT_WIDTHS,
    );
    expect(passing.viewports.every(({ inputSha256 }) => SHA256_PATTERN.test(inputSha256)))
      .toBe(true);
    expect(passing.viewports.every(({ maximumAlignmentErrorCssPixels }) => (
      maximumAlignmentErrorCssPixels <= fidelity.ALIGNMENT_TOLERANCE_CSS_PIXELS
    ))).toBe(true);

    const misaligned = samples.map((sample) => sample.viewport.width === 701
      ? {
          ...sample,
          observed: {
            ...sample.observed,
            offsetX: sample.observed.offsetX + 1,
          },
        }
      : sample);
    const failed = fidelity.checkCanonicalViewportAlignment({
      canonicalSourceSha256,
      poseId: "reference-pose",
      samples: misaligned,
    });
    expect(failed.ok).toBe(false);
    expect(failed.failures).toContainEqual(expect.objectContaining({
      issueCode: fidelity.FIDELITY_ISSUE_CODES.ALIGNMENT_ERROR,
    }));
    expect(failed.viewports.find(({ viewport }) => viewport.width === 701)).toMatchObject({
      maximumAlignmentErrorCssPixels: 1,
      ok: false,
    });
    expect(() => fidelity.assertCanonicalViewportAlignment({
      canonicalSourceSha256,
      poseId: "reference-pose",
      samples: misaligned,
    })).toThrowError(expect.objectContaining({
      code: "LAYER_FIDELITY_INVALID",
      issueCode: fidelity.FIDELITY_ISSUE_CODES.ALIGNMENT_ERROR,
    }));
  });

  it("fails closed when any mandatory boundary/profile width is absent", () => {
    const failed = fidelity.checkCanonicalViewportAlignment({
      canonicalSourceSha256: sha256(Buffer.from("deterministic-canonical-source")),
      poseId: "reference-pose",
      samples: alignmentSamples().filter(({ viewport }) => viewport.width !== 700),
    });
    expect(failed).toMatchObject({
      ok: false,
      viewportSet: { missingViewportWidths: [700] },
    });
    expect(failed.failures).toContainEqual(expect.objectContaining({
      issueCode: fidelity.FIDELITY_ISSUE_CODES.ALIGNMENT_VIEWPORT_SET_INVALID,
    }));
  });
});

// **Validates: Requirements 3.8, 3.15, 4.7, 4.8, 8.5, 13.6, 13.7**
describe("read-only canonical source reference", () => {
  it("passes one finite exact decoded-source report without mutating the master", { timeout: 120_000 }, async () => {
    const sourcePath = resolve(PROJECT_ROOT, "source/assets/elite-watch-master.png");
    const pngBefore = await readFile(sourcePath);
    expect(sha256(pngBefore)).toBe(contract.APPROVED_MASTER_IDENTITY.sha256);
    expect(pngBefore.byteLength).toBe(contract.APPROVED_MASTER_IDENTITY.byteLength);

    const decoded = await sharp(pngBefore, {
      failOn: "error",
      limitInputPixels: 2_760 * 1_504,
      sequentialRead: true,
    })
      .ensureAlpha()
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
    const source: RgbaRaster = {
      data: decoded.data,
      height: decoded.info.height,
      width: decoded.info.width,
    };
    const decodedBefore = Buffer.from(source.data);
    const first = fidelity.assertSourceSpaceFidelity({
      canonicalSource: source,
      composition: source,
      poseId: "reference-pose",
    });
    const second = fidelity.assertSourceSpaceFidelity({
      canonicalSource: source,
      composition: source,
      poseId: "reference-pose",
    });

    expect(first).toMatchObject({
      checks: {
        alphaCoverage: {
          completeOpaqueCoverage: true,
          nonOpaquePixelCount: 0,
        },
        immutableBytes: {
          mismatchByteCount: 0,
          mismatchPixelCount: 0,
          ok: true,
        },
        losslessReferenceComparison: {
          exactByteEquality: true,
        },
      },
      ok: true,
      poseId: "reference-pose",
      sourceSpaceTruth: true,
    });
    expect(first.inputs.canonicalSource).toMatchObject({
      byteLength: 2_760 * 1_504 * 4,
      sha256: sha256(source.data),
    });
    expect(first.derived.approvedChangeRegion.nonZeroPixelCount).toBe(0);
    expect(first.derived.immutableRegion.nonZeroPixelCount).toBe(2_760 * 1_504);
    expect(fidelity.serializeFidelityReport(first as unknown as Readonly<Record<string, unknown>>))
      .toEqual(fidelity.serializeFidelityReport(second as unknown as Readonly<Record<string, unknown>>));
    expect(source.data.equals(decodedBefore)).toBe(true);

    const pngAfter = await readFile(sourcePath);
    expect(pngAfter.equals(pngBefore)).toBe(true);
  });
});
