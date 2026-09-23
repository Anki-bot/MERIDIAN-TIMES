import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;
type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};
type MaskRaster = {
  readonly data: Buffer;
  readonly height: number;
  readonly nonZeroPixelCount: number;
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
  readonly completeFootprintReplacement: boolean;
  readonly footprintMask: MaskRaster;
  readonly immutablePixelCount: number;
  readonly nonOpaquePixelCount: number;
  readonly replacedFootprintPixelCount: number;
  readonly sourceVisiblePixelCount: number;
  readonly syntheticPixelCount: number;
  readonly transparentPixelCount: number;
};
type ImageOperationsModule = {
  readonly IMAGE_OPERATION_ISSUE_CODES: Readonly<Record<string, string>>;
  composeReconstructedBackground(options: {
    readonly reconstructions: readonly ReconstructionRecord[];
    readonly source: RgbaRaster;
  }): ReconstructionResult;
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
};
type LoadedAuthoring = {
  readonly approvedMovingLayerIds: readonly string[];
  readonly artifactIssues: readonly JsonRecord[];
  readonly authoringIdentity: FileIdentity;
  readonly candidateDecisions: readonly JsonRecord[];
  readonly excludedLayerIds: readonly string[];
  readonly mode: string;
  readonly normalized: {
    readonly approvals: readonly JsonRecord[];
    readonly fillInputs: readonly JsonRecord[];
    readonly layers: readonly JsonRecord[];
    readonly maskInputs: readonly JsonRecord[];
    readonly masks: readonly JsonRecord[];
    readonly motionProfiles: readonly JsonRecord[];
    readonly provenance: readonly JsonRecord[];
    readonly reconstructions: readonly JsonRecord[];
    readonly relationships: readonly JsonRecord[];
  };
  readonly reviewInputs: {
    readonly approvals: readonly JsonRecord[];
    readonly depthProfiles: readonly JsonRecord[];
    readonly layers: readonly JsonRecord[];
    readonly masks: readonly JsonRecord[];
    readonly motionProfiles: readonly JsonRecord[];
    readonly reconstructions: readonly JsonRecord[];
  };
  readonly sourceDocument: JsonRecord;
  readonly staticLayerIds: readonly string[];
};
type LoaderModule = {
  loadWatchLayerAuthoring(options: {
    readonly projectRoot: string;
  }): Promise<LoadedAuthoring>;
};
type EvidenceIndex = JsonRecord & {
  readonly artifactCount: number;
  readonly artifacts: readonly JsonRecord[];
  readonly canonicalMaster: FileIdentity & {
    readonly height: number;
    readonly mediaType: string;
    readonly width: number;
  };
  readonly reviewSetCount: number;
  readonly reviewSets: readonly JsonRecord[];
};
type RenderedEvidence = {
  readonly index: EvidenceIndex;
  readonly indexIdentity: FileIdentity;
  readonly outputs: readonly {
    readonly bytes: Buffer;
    readonly path: string;
  }[];
};
type EvidenceModule = {
  readonly LAYER_REVIEW_EVIDENCE_INDEX_PATH: string;
  renderLayerReviewEvidence(options: JsonRecord): Promise<RenderedEvidence>;
  validateLayerReviewEvidenceIndex(value: unknown): EvidenceIndex;
};
type ApprovalSetResult = {
  readonly approvedMovingLayerIds: readonly string[];
  readonly failures: readonly JsonRecord[];
  readonly mode: string;
  readonly ok: boolean;
  readonly releasable: boolean;
};
type ApprovalModule = {
  readonly APPROVAL_TOOL_ISSUE_CODES: Readonly<Record<string, string>>;
  evaluateApprovalSetClosure(options: {
    readonly approvals: readonly JsonRecord[];
    readonly approvedMovingLayerIds: readonly string[];
    readonly requirements: readonly JsonRecord[];
  }): ApprovalSetResult;
};
type ReleasePointer = {
  readonly depthEnabled: boolean;
  readonly runtimeManifest: null | JsonRecord;
  readonly schemaVersion: number;
  readonly status: string;
};
type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: FileIdentity;
  readonly CANONICAL_PROJECT_PATHS: Readonly<Record<string, string>>;
  readonly CANONICAL_SOURCE_COORDINATE_SPACE: {
    readonly height: number;
    readonly width: number;
  };
  readonly RELEASE_POINTER_SCHEMA: {
    parseJson(value: Uint8Array, options?: JsonRecord): ReleasePointer;
  };
  serializeCanonicalJson(value: unknown): Buffer;
  serializeCanonicalJsonLine(value: unknown): Buffer;
};
type RealSourceDiagnostic = {
  readonly approvals: ApprovalSetResult;
  readonly composition: Readonly<Record<string, number | boolean>>;
  readonly evidence: Readonly<Record<string, number | string | boolean>>;
  readonly normalizedPackageClosed: boolean;
  readonly poseCoverage: readonly Readonly<Record<string, number | string>>[];
  readonly productionArtifactMembers: Readonly<Record<string, readonly string[]>>;
  readonly publicSuccessorPathExists: boolean;
  readonly release: ReleasePointer;
  readonly schemaVersion: 1;
  readonly source: Readonly<Record<string, number | string | boolean>>;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const loader = (await import("../../scripts/watch-2-5d/authoring-loader.mjs")) as unknown as LoaderModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const imageOperations = (await import("../../scripts/watch-2-5d/image-operations.mjs")) as unknown as ImageOperationsModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const evidence = (await import("../../scripts/watch-2-5d/review-evidence.mjs")) as unknown as EvidenceModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const approvals = (await import("../../scripts/watch-2-5d/approval-records.mjs")) as unknown as ApprovalModule;

const PROJECT_ROOT = process.cwd();
const WIDTH = contract.CANONICAL_SOURCE_COORDINATE_SPACE.width;
const HEIGHT = contract.CANONICAL_SOURCE_COORDINATE_SPACE.height;
const PIXEL_COUNT = WIDTH * HEIGHT;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function packageInputProjection(loaded: LoadedAuthoring): JsonRecord {
  return {
    approvals: loaded.normalized.approvals,
    layers: loaded.normalized.layers,
    masks: loaded.normalized.masks,
    motionProfiles: loaded.normalized.motionProfiles,
    provenance: loaded.normalized.provenance,
    reconstructions: loaded.normalized.reconstructions,
    relationships: loaded.normalized.relationships,
  };
}

function stableRecordEqual(left: unknown, right: unknown): boolean {
  return contract.serializeCanonicalJson(left).equals(
    contract.serializeCanonicalJson(right),
  );
}

async function decodeCanonicalSource(bytes: Buffer): Promise<RgbaRaster> {
  const decoded = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: PIXEL_COUNT,
    sequentialRead: true,
  })
    .ensureAlpha()
    .toColourspace("srgb")
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== WIDTH
    || decoded.info.height !== HEIGHT
    || decoded.info.channels !== 4
    || decoded.data.byteLength !== PIXEL_COUNT * 4
  ) {
    throw new Error("Canonical source did not decode to exact 2760x1504 RGBA bytes");
  }
  return imageOperations.createRgbaRaster({
    data: decoded.data,
    height: decoded.info.height,
    width: decoded.info.width,
  }, { canonical: true });
}

function countImmutableByteMismatches(
  source: RgbaRaster,
  composition: ReconstructionResult,
): number {
  let mismatchCount = 0;
  for (let pixel = 0; pixel < PIXEL_COUNT; pixel += 1) {
    if (composition.approvedChangeMask.data[pixel] !== 0) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      if (composition.data[offset + channel] !== source.data[offset + channel]) {
        mismatchCount += 1;
      }
    }
  }
  return mismatchCount;
}

function countResidualFootprintPixels(
  source: RgbaRaster,
  composition: ReconstructionResult,
): number {
  let residualCount = 0;
  for (let pixel = 0; pixel < PIXEL_COUNT; pixel += 1) {
    if (composition.footprintMask.data[pixel] === 0) continue;
    const offset = pixel * 4;
    let equal = true;
    for (let channel = 0; channel < 4; channel += 1) {
      if (composition.data[offset + channel] !== source.data[offset + channel]) {
        equal = false;
        break;
      }
    }
    if (equal) residualCount += 1;
  }
  return residualCount;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error !== null
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) return false;
    throw error;
  }
}

async function runRealSourcePass(): Promise<{
  readonly diagnostic: RealSourceDiagnostic;
  readonly diagnosticBytes: Buffer;
}> {
  const sourcePath = resolve(
    PROJECT_ROOT,
    contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
  );
  const normalizedPath = resolve(
    PROJECT_ROOT,
    contract.CANONICAL_PROJECT_PATHS.successorReviewDirectory,
    "normalized-package-inputs.json",
  );
  const evidencePath = resolve(
    PROJECT_ROOT,
    evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH,
  );
  const releasePath = resolve(
    PROJECT_ROOT,
    contract.CANONICAL_PROJECT_PATHS.successorRelease,
  );
  const [
    sourceBefore,
    normalizedBytes,
    committedEvidenceBytes,
    releaseBytes,
    loaded,
  ] = await Promise.all([
    readFile(sourcePath),
    readFile(normalizedPath),
    readFile(evidencePath),
    readFile(releasePath),
    loader.loadWatchLayerAuthoring({ projectRoot: PROJECT_ROOT }),
  ]);
  const sourcePreSha256 = sha256(sourceBefore);
  const normalizedDocument = JSON.parse(normalizedBytes.toString("utf8")) as JsonRecord;
  const committedEvidence = evidence.validateLayerReviewEvidenceIndex(
    JSON.parse(committedEvidenceBytes.toString("utf8")),
  );
  const release = contract.RELEASE_POINTER_SCHEMA.parseJson(releaseBytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  });
  const source = await decodeCanonicalSource(sourceBefore);
  const composition = imageOperations.composeReconstructedBackground({
    reconstructions: [],
    source,
  });
  const renderedEvidence = await evidence.renderLayerReviewEvidence({
    ...loaded.reviewInputs,
    authoringIdentity: loaded.authoringIdentity,
    sourceBytes: sourceBefore,
    sourceIdentity: {
      byteLength: sourceBefore.byteLength,
      path: contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
      sha256: sourcePreSha256,
    },
  });
  const approvalClosure = approvals.evaluateApprovalSetClosure({
    approvals: loaded.reviewInputs.approvals,
    approvedMovingLayerIds: loaded.approvedMovingLayerIds,
    requirements: [],
  });
  const sourceAfter = await readFile(sourcePath);
  const productionDirectories = {
    approvals: contract.CANONICAL_PROJECT_PATHS.successorApprovalsDirectory,
    masks: contract.CANONICAL_PROJECT_PATHS.successorMasksDirectory,
    reconstruction: contract.CANONICAL_PROJECT_PATHS.successorReconstructionDirectory,
  };
  const productionArtifactMembers = Object.fromEntries(await Promise.all(
    Object.entries(productionDirectories).map(async ([name, path]) => [
      name,
      (await readdir(resolve(PROJECT_ROOT, path))).sort(),
    ] as const),
  ));
  const evidenceIdentity = normalizedDocument.evidenceIndex as JsonRecord;
  const normalizedPackageClosed = stableRecordEqual(
    normalizedDocument.packageInputs,
    packageInputProjection(loaded),
  )
    && stableRecordEqual(normalizedDocument.approvedMovingLayerIds, loaded.approvedMovingLayerIds)
    && stableRecordEqual(normalizedDocument.artifactIssues, loaded.artifactIssues)
    && stableRecordEqual(normalizedDocument.candidateDecisions, loaded.candidateDecisions)
    && stableRecordEqual(normalizedDocument.excludedLayerIds, loaded.excludedLayerIds)
    && stableRecordEqual(normalizedDocument.staticLayerIds, loaded.staticLayerIds)
    && normalizedDocument.mode === loaded.mode;
  const evidenceClosed = evidenceIdentity.path === evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH
    && evidenceIdentity.byteLength === committedEvidenceBytes.byteLength
    && evidenceIdentity.sha256 === sha256(committedEvidenceBytes)
    && renderedEvidence.indexIdentity.byteLength === committedEvidenceBytes.byteLength
    && renderedEvidence.indexIdentity.sha256 === sha256(committedEvidenceBytes)
    && stableRecordEqual(renderedEvidence.index, committedEvidence);
  const immutableByteMismatchCount = countImmutableByteMismatches(
    source,
    composition,
  );
  const residualSilhouettePixelCount = countResidualFootprintPixels(
    source,
    composition,
  );
  const declaredExtremePoseCount = loaded.normalized.motionProfiles.length * 2
    + loaded.reviewInputs.depthProfiles.filter((profile) => profile.enabled === true).length * 2;
  const diagnostic: RealSourceDiagnostic = {
    approvals: approvalClosure,
    composition: {
      approvedChangePixelCount: composition.approvedChangeMask.nonZeroPixelCount,
      completeFootprintReplacement: composition.completeFootprintReplacement,
      immutableByteMismatchCount,
      immutablePixelCount: composition.immutablePixelCount,
      replacedFootprintPixelCount: composition.replacedFootprintPixelCount,
      residualSilhouettePixelCount,
      syntheticPixelCount: composition.syntheticPixelCount,
    },
    evidence: {
      artifactCount: committedEvidence.artifactCount,
      evidenceClosed,
      evidenceIndexSha256: sha256(committedEvidenceBytes),
      renderedOutputCount: renderedEvidence.outputs.length,
      reviewSetCount: committedEvidence.reviewSetCount,
    },
    normalizedPackageClosed,
    poseCoverage: [{
      nonOpaquePixelCount: composition.nonOpaquePixelCount,
      poseId: "reference-pose",
      transparentPixelCount: composition.transparentPixelCount,
    }],
    productionArtifactMembers,
    publicSuccessorPathExists: await exists(resolve(
      PROJECT_ROOT,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    )),
    release,
    schemaVersion: 1,
    source: {
      byteLength: sourceBefore.byteLength,
      declaredExtremePoseCount,
      declaredSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
      decodedRgbaBytes: source.data.byteLength,
      height: source.height,
      postSha256: sha256(sourceAfter),
      preSha256: sourcePreSha256,
      sourceBytesPreserved: sourceAfter.equals(sourceBefore),
      width: source.width,
    },
  };
  return {
    diagnostic,
    diagnosticBytes: contract.serializeCanonicalJsonLine(diagnostic),
  };
}

function canonicalMask(
  samples: readonly (readonly [number, number, number])[],
): MaskRaster {
  const data = Buffer.alloc(PIXEL_COUNT);
  for (const [x, y, alpha] of samples) data[y * WIDTH + x] = alpha;
  return imageOperations.createMaskRaster({ data, height: HEIGHT, width: WIDTH }, {
    canonical: true,
  });
}

function canonicalFill(
  source: RgbaRaster,
  x: number,
  y: number,
  alpha = 255,
): RgbaRaster {
  const data = Buffer.alloc(PIXEL_COUNT * 4);
  const offset = (y * WIDTH + x) * 4;
  data[offset] = 255 - source.data[offset];
  data[offset + 1] = 255 - source.data[offset + 1];
  data[offset + 2] = 255 - source.data[offset + 2];
  data[offset + 3] = alpha;
  return imageOperations.createRgbaRaster({ data, height: HEIGHT, width: WIDTH }, {
    canonical: true,
  });
}

function failureDiagnostic(
  source: RgbaRaster,
  record: ReconstructionRecord,
): Readonly<Record<string, unknown>> {
  try {
    imageOperations.composeReconstructedBackground({
      reconstructions: [record],
      source,
    });
    return Object.freeze({ motionEligible: true });
  } catch (error) {
    if (error === null || typeof error !== "object") throw error;
    return Object.freeze({
      code: "code" in error ? error.code : null,
      issueCode: "issueCode" in error ? error.issueCode : null,
      message: error instanceof Error ? error.message : null,
      motionEligible: false,
      path: "path" in error ? error.path : null,
    });
  }
}

describe("real-source watch layer composition and approval integration", () => {
  it("passes the exact empty-moving authored set as byte-identical reference/fallback output", async () => {
    const first = await runRealSourcePass();
    const second = await runRealSourcePass();

    expect(second.diagnosticBytes).toEqual(first.diagnosticBytes);
    expect(first.diagnostic).toMatchObject({
      approvals: {
        approvedMovingLayerIds: [],
        failures: [],
        mode: "reference-pose",
        ok: true,
        releasable: true,
      },
      composition: {
        approvedChangePixelCount: 0,
        completeFootprintReplacement: true,
        immutableByteMismatchCount: 0,
        immutablePixelCount: PIXEL_COUNT,
        replacedFootprintPixelCount: 0,
        residualSilhouettePixelCount: 0,
        syntheticPixelCount: 0,
      },
      evidence: {
        artifactCount: 0,
        evidenceClosed: true,
        renderedOutputCount: 1,
        reviewSetCount: 0,
      },
      normalizedPackageClosed: true,
      poseCoverage: [{
        nonOpaquePixelCount: 0,
        poseId: "reference-pose",
        transparentPixelCount: 0,
      }],
      productionArtifactMembers: {
        approvals: [],
        masks: [],
        reconstruction: [],
      },
      publicSuccessorPathExists: false,
      release: {
        depthEnabled: false,
        runtimeManifest: null,
        schemaVersion: 1,
        status: "fallback-only",
      },
      source: {
        byteLength: contract.APPROVED_MASTER_IDENTITY.byteLength,
        declaredExtremePoseCount: 0,
        declaredSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
        decodedRgbaBytes: PIXEL_COUNT * 4,
        height: HEIGHT,
        postSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
        preSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
        sourceBytesPreserved: true,
        width: WIDTH,
      },
    });
    expect(first.diagnosticBytes.toString("utf8").endsWith("\n")).toBe(true);
  }, 120_000);

  it("confines a detached real-source reconstruction and blocks every deterministic fault class", async () => {
    const sourceBytes = await readFile(resolve(
      PROJECT_ROOT,
      contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
    ));
    const source = await decodeCanonicalSource(sourceBytes);
    const x = 100;
    const y = 100;
    const footprint = canonicalMask([[x, y, 255]]);
    const reconstruction = canonicalMask([[x, y, 255]]);
    const boundary = canonicalMask([[x, y, 255]]);
    const empty = canonicalMask([]);
    const fill = canonicalFill(source, x, y);

    // These detached rasters are finite test mutations only. They are never written,
    // published, or represented as production masks, fills, motion, or approvals.
    const valid = imageOperations.composeReconstructedBackground({
      reconstructions: [{
        boundaryMask: boundary,
        fill,
        footprintMask: footprint,
        id: "detached-real-source-probe",
        reconstructionMask: reconstruction,
        zOrder: 1,
      }],
      source,
    });
    expect(valid).toMatchObject({
      completeFootprintReplacement: true,
      immutablePixelCount: PIXEL_COUNT - 1,
      nonOpaquePixelCount: 0,
      replacedFootprintPixelCount: 1,
      syntheticPixelCount: 1,
      transparentPixelCount: 0,
    });
    expect(countImmutableByteMismatches(source, valid)).toBe(0);
    expect(countResidualFootprintPixels(source, valid)).toBe(0);

    const faultCases: readonly [string, ReconstructionRecord, string][] = [
      [
        "seam-mask-violation",
        {
          boundaryMask: empty,
          fill,
          footprintMask: footprint,
          id: "seam-mask-violation",
          reconstructionMask: reconstruction,
          zOrder: 1,
        },
        "Reconstruction mask must remain inside its swept boundary",
      ],
      [
        "transparent-pixel",
        {
          boundaryMask: boundary,
          fill: canonicalFill(source, x, y, 254),
          footprintMask: footprint,
          id: "transparent-pixel",
          reconstructionMask: reconstruction,
          zOrder: 1,
        },
        "Synthetic reconstruction fill must be opaque wherever its mask is nonzero",
      ],
      [
        "residual-silhouette",
        {
          boundaryMask: boundary,
          fill,
          footprintMask: footprint,
          id: "residual-silhouette",
          reconstructionMask: empty,
          zOrder: 1,
        },
        "Reconstruction mask must replace the complete reference footprint",
      ],
    ];
    for (const [faultId, record, message] of faultCases) {
      const first = failureDiagnostic(source, record);
      const second = failureDiagnostic(source, record);
      expect(second, faultId).toEqual(first);
      expect(first, faultId).toEqual(expect.objectContaining({
        code: "LAYER_RECONSTRUCTION_INVALID",
        issueCode: imageOperations.IMAGE_OPERATION_ISSUE_CODES.RECONSTRUCTION_INVALID,
        message,
        motionEligible: false,
      }));
    }

    const evidenceIndexBytes = await readFile(resolve(
      PROJECT_ROOT,
      evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH,
    ));
    const currentHashes = [sha256(sourceBytes), sha256(evidenceIndexBytes)].sort();
    const approvalExpectation: JsonRecord = {
      approvalId: "approval-detached-motion",
      artifactSha256: currentHashes,
      layerIds: ["layer-detached-probe"],
      reviewedPoseIds: [
        "detached-motion-maximum",
        "detached-motion-minimum",
        "reference-pose",
      ],
      reviewedZoomPercent: [100, 200],
      scope: "motion",
    };
    const staleApproval: JsonRecord = {
      artifactSha256: ["f".repeat(64)],
      decision: "approved",
      id: "approval-detached-motion",
      layerIds: ["layer-detached-probe"],
      notes: "Detached stale-hash rejection probe; not a production approval.",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewedPoseIds: [
        "detached-motion-maximum",
        "detached-motion-minimum",
        "reference-pose",
      ],
      reviewedZoomPercent: [100, 200],
      reviewer: "test-only-reviewer",
      scope: "motion",
    };
    const firstStaleResult = approvals.evaluateApprovalSetClosure({
      approvals: [staleApproval],
      approvedMovingLayerIds: ["layer-detached-probe"],
      requirements: [approvalExpectation],
    });
    const secondStaleResult = approvals.evaluateApprovalSetClosure({
      approvals: [staleApproval],
      approvedMovingLayerIds: ["layer-detached-probe"],
      requirements: [approvalExpectation],
    });
    expect(secondStaleResult).toEqual(firstStaleResult);
    expect(firstStaleResult).toMatchObject({
      approvedMovingLayerIds: [],
      failures: [{
        eligible: false,
        outcome: "static",
        reason: approvals.APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
        releasable: false,
        scope: "motion",
      }],
      mode: "static",
      ok: false,
      releasable: false,
    });
  }, 120_000);
});
