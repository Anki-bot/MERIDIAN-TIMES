import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

// Dynamic executable-ESM fixtures intentionally expose JSON records without generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;
type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};
type EvidenceOutput = {
  readonly bytes: Buffer;
  readonly path: string;
};
type RenderedEvidence = {
  readonly index: JsonRecord;
  readonly indexIdentity: FileIdentity;
  readonly outputs: readonly EvidenceOutput[];
};
type ProductionModule = {
  readonly NORMALIZED_WATCH_LAYER_INPUTS_PATH: string;
  createEvidenceApprovalExpectation(options: JsonRecord): JsonRecord;
  normalizeEvidenceApprovedAuthoring(options: JsonRecord): JsonRecord;
  prepareWatchLayerAuthoring(options?: { readonly projectRoot?: string }): Promise<JsonRecord>;
};
type EvidenceModule = {
  readonly LAYER_REVIEW_EVIDENCE_INDEX_PATH: string;
  renderLayerReviewEvidence(options: JsonRecord): Promise<RenderedEvidence>;
  validateLayerReviewEvidenceIndex(value: unknown): JsonRecord;
};
type LoaderModule = {
  loadWatchLayerAuthoring(options?: { readonly projectRoot?: string }): Promise<JsonRecord>;
};
type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: JsonRecord;
  readonly CANONICAL_PROJECT_PATHS: Record<string, string>;
  readonly CANONICAL_SOURCE_COORDINATE_SPACE: { readonly height: number; readonly width: number };
  readonly RELEASE_POINTER_SCHEMA: {
    parseJson(value: Uint8Array, options?: JsonRecord): JsonRecord;
  };
  serializeCanonicalJson(value: unknown): Buffer;
  serializeCanonicalJsonLine(value: unknown): Buffer;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const production = (await import("../../scripts/prepare-watch-layer-authoring.mjs")) as unknown as ProductionModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const evidence = (await import("../../scripts/watch-2-5d/review-evidence.mjs")) as unknown as EvidenceModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const loader = (await import("../../scripts/watch-2-5d/authoring-loader.mjs")) as unknown as LoaderModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;

const PROJECT_ROOT = process.cwd();
const WIDTH = 8;
const HEIGHT = 6;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function identity(path: string, bytes: Uint8Array): FileIdentity {
  return { byteLength: bytes.byteLength, path, sha256: sha256(bytes) };
}

function setPixel(data: Buffer, x: number, y: number, alpha = 255): void {
  data[y * WIDTH + x] = alpha;
}

async function grayscalePng(data: Buffer): Promise<Buffer> {
  return sharp(data, { raw: { channels: 1, height: HEIGHT, width: WIDTH } })
    .toColourspace("b-w")
    .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
    .toBuffer();
}

async function rgbaPng(data: Buffer): Promise<Buffer> {
  return sharp(data, { raw: { channels: 4, height: HEIGHT, width: WIDTH } })
    .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
    .toBuffer();
}

function maskRecord(id: string, file: string, bytes: Buffer, data: Buffer): JsonRecord {
  const samples: [number, number, number][] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const alpha = data[y * WIDTH + x];
      if (alpha !== 0) samples.push([x, y, alpha]);
    }
  }
  const xs = samples.map(([x]) => x);
  const ys = samples.map(([, y]) => y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  return {
    alphaSum: samples.reduce((total, [, , alpha]) => total + alpha, 0),
    file,
    height: HEIGHT,
    id,
    nonZeroPixelCount: samples.length,
    provenanceId: `provenance-${id}`,
    sha256: sha256(bytes),
    tightBounds: {
      height: maximumY - minimumY + 1,
      width: maximumX - minimumX + 1,
      x: minimumX,
      y: minimumY,
    },
    width: WIDTH,
  };
}

function approvedRecord(id: string, expectation: JsonRecord): JsonRecord {
  return {
    artifactSha256: expectation.artifactSha256,
    decision: "approved",
    id,
    layerIds: expectation.layerIds,
    notes: `Exact current ${String(expectation.scope)} evidence reviewed.`,
    reviewedAt: "2026-05-20T12:00:00.000Z",
    reviewedPoseIds: expectation.reviewedPoseIds,
    reviewedZoomPercent: expectation.reviewedZoomPercent,
    reviewer: "fixture-reviewer",
    scope: expectation.scope,
  };
}

async function exactMovingFixture(): Promise<{
  readonly evidence: RenderedEvidence;
  readonly loaderResult: JsonRecord;
}> {
  const sourceRgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    sourceRgba[pixel * 4] = 30 + pixel;
    sourceRgba[pixel * 4 + 1] = 90 + pixel;
    sourceRgba[pixel * 4 + 2] = 150 + pixel;
    sourceRgba[pixel * 4 + 3] = 255;
  }
  const sourceBytes = await rgbaPng(sourceRgba);
  const segmentationData = Buffer.alloc(WIDTH * HEIGHT);
  setPixel(segmentationData, 2, 2);
  setPixel(segmentationData, 3, 2, 192);
  setPixel(segmentationData, 4, 2);
  const regionData = Buffer.from(segmentationData.map((alpha) => alpha === 0 ? 0 : 255));
  setPixel(regionData, 3, 3);
  const boundaryData = Buffer.from(regionData);
  setPixel(boundaryData, 1, 2);
  setPixel(boundaryData, 5, 2);
  const [segmentationBytes, regionBytes, boundaryBytes] = await Promise.all([
    grayscalePng(segmentationData),
    grayscalePng(regionData),
    grayscalePng(boundaryData),
  ]);
  const fillRgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < regionData.byteLength; pixel += 1) {
    if (regionData[pixel] === 0) continue;
    fillRgba[pixel * 4] = 12;
    fillRgba[pixel * 4 + 1] = 140;
    fillRgba[pixel * 4 + 2] = 210;
    fillRgba[pixel * 4 + 3] = 255;
  }
  const fillBytes = await rgbaPng(fillRgba);
  const segmentation = maskRecord(
    "mask-wheel-segmentation",
    "source/assets/watch-2-5d/v1/masks/wheel-segmentation.png",
    segmentationBytes,
    segmentationData,
  );
  const region = maskRecord(
    "mask-wheel-region",
    "source/assets/watch-2-5d/v1/masks/wheel-region.png",
    regionBytes,
    regionData,
  );
  const boundary = maskRecord(
    "mask-wheel-boundary",
    "source/assets/watch-2-5d/v1/masks/wheel-boundary.png",
    boundaryBytes,
    boundaryData,
  );
  const layer: JsonRecord = {
    approvalIds: [
      "approval-fidelity",
      "approval-pivot",
      "approval-reconstruction",
      "approval-segmentation",
    ],
    disposition: "approved-moving",
    id: "layer-wheel",
    motionProfileId: "motion-wheel",
    pivot: { x: 3.5, y: 2.5 },
    provenanceIds: ["provenance-layer-wheel"],
    reconstructedPixelCount: 4,
    referenceTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    segmentationMaskId: segmentation.id,
    semanticClass: "exposed-gear",
    sourceRect: { height: 4, width: 6, x: 1, y: 1 },
    sourceVisiblePixelCount: 3,
    zOrder: 10,
  };
  const reconstruction: JsonRecord = {
    approvalId: "approval-reconstruction",
    boundaryMaskId: boundary.id,
    fillFile: "source/assets/watch-2-5d/v1/reconstruction/wheel-fill.png",
    fillId: "fill-wheel",
    fillSha256: sha256(fillBytes),
    id: "reconstruction-wheel",
    method: "manual-paint",
    provenanceId: "provenance-fill-wheel",
    regionMaskId: region.id,
    syntheticPixelCount: 4,
  };
  const motion: JsonRecord = {
    approvalId: "approval-motion",
    direction: 1,
    evidence: "authored-assumption",
    id: "motion-wheel",
    kind: "continuous-rotation",
    layerId: layer.id,
    maxRadians: 0.5,
    minRadians: -0.5,
    periodMs: 60_000,
    phaseRadians: 0,
    pivot: layer.pivot,
    referenceRadians: 0,
  };
  const authoringBytes = Buffer.from("{\"fixture\":\"exact-moving\"}\n");
  const rendered = await evidence.renderLayerReviewEvidence({
    authoringIdentity: identity(
      "source/assets/watch-2-5d/v1/authoring.json",
      authoringBytes,
    ),
    layers: [layer],
    masks: [
      { bytes: segmentationBytes, record: segmentation },
      { bytes: regionBytes, record: region },
      { bytes: boundaryBytes, record: boundary },
    ],
    motionProfiles: [motion],
    reconstructions: [{ fillBytes, record: reconstruction }],
    sourceBytes,
    sourceHeight: HEIGHT,
    sourceIdentity: identity("source/assets/synthetic-review-source.png", sourceBytes),
    sourceWidth: WIDTH,
  });
  // The pure production normalizer requires the approved canonical-master hash.
  const canonicalIndexCandidate = structuredClone(rendered.index);
  canonicalIndexCandidate.canonicalMaster.sha256 = contract.APPROVED_MASTER_IDENTITY.sha256;
  const canonicalIndex = evidence.validateLayerReviewEvidenceIndex(canonicalIndexCandidate);
  const indexBytes = contract.serializeCanonicalJsonLine(canonicalIndex);
  const exactEvidence = {
    ...rendered,
    index: canonicalIndex,
    indexIdentity: {
      byteLength: indexBytes.byteLength,
      path: evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH,
      sha256: sha256(indexBytes),
    },
  };
  const setIds = [
    ["approval-segmentation", "layer-wheel-segmentation"],
    ["approval-pivot", "layer-wheel-pivot"],
    ["approval-reconstruction", "layer-wheel-reconstruction"],
    ["approval-motion", "layer-wheel-motion-wheel-motion"],
    ["approval-fidelity", "layer-wheel-fidelity"],
  ] as const;
  const scoped = setIds.map(([approvalId, evidenceSetId]) => approvedRecord(
    approvalId,
    production.createEvidenceApprovalExpectation({
      approvalId,
      evidenceIndex: exactEvidence.index,
      evidenceIndexIdentity: exactEvidence.indexIdentity,
      evidenceSetId,
    }),
  ));
  const release: JsonRecord = {
    artifactSha256: [...new Set(scoped.flatMap((record) => record.artifactSha256))].sort(),
    decision: "approved",
    id: "approval-release",
    layerIds: [layer.id],
    notes: "Exact current release evidence reviewed.",
    reviewedAt: "2026-05-20T12:10:00.000Z",
    reviewedPoseIds: [...new Set(scoped.flatMap((record) => record.reviewedPoseIds))].sort(),
    reviewedZoomPercent: [],
    reviewer: "fixture-reviewer",
    scope: "release",
  };
  const loaderResult: JsonRecord = {
    approvedMovingLayerIds: [layer.id],
    artifactIssues: [],
    authoringIdentity: exactEvidence.index.authoring,
    candidateDecisions: [{
      authoredDisposition: "approved-moving",
      effectiveDisposition: "approved-moving",
      id: layer.id,
      primaryReason: null,
      reasonCodes: [],
    }],
    excludedLayerIds: [],
    inputSnapshot: { files: [] },
    mode: "approved-moving",
    normalized: {
      approvals: [...scoped, release],
      fillInputs: [],
      layers: [layer],
      maskInputs: [],
      masks: [segmentation, region, boundary],
      motionProfiles: [motion],
      provenance: [],
      reconstructions: [reconstruction],
      relationships: [],
    },
    reviewInputs: { approvals: [...scoped, release] },
    schemaVersion: 1,
    sourceDocument: { depthEnabled: false, layers: [layer], phases: [] },
    staticLayerIds: [],
  };
  return { evidence: exactEvidence, loaderResult };
}

describe("production authored-package evidence boundary", () => {
  it("keeps a moving layer only when every exact current review scope and release approval close", async () => {
    const fixture = await exactMovingFixture();
    const accepted = production.normalizeEvidenceApprovedAuthoring(fixture);
    expect(accepted).toMatchObject({
      approvedMovingLayerIds: ["layer-wheel"],
      mode: "approved-moving",
      normalized: {
        layers: [{ id: "layer-wheel", disposition: "approved-moving" }],
        motionProfiles: [{ id: "motion-wheel" }],
        reconstructions: [{ id: "reconstruction-wheel" }],
      },
    });
    expect(accepted.normalized.approvals.map(({ id }: JsonRecord) => id).sort()).toEqual([
      "approval-fidelity",
      "approval-motion",
      "approval-pivot",
      "approval-reconstruction",
      "approval-release",
      "approval-segmentation",
    ]);

    const stale = structuredClone(fixture.loaderResult);
    stale.reviewInputs.approvals = stale.reviewInputs.approvals.map((record: JsonRecord) => (
      record.id === "approval-segmentation"
        ? { ...record, artifactSha256: ["f".repeat(64)] }
        : record
    ));
    const rejected = production.normalizeEvidenceApprovedAuthoring({
      evidence: fixture.evidence,
      loaderResult: stale,
    });
    expect(rejected).toMatchObject({
      approvedMovingLayerIds: [],
      mode: "reference-pose",
      normalized: {
        approvals: [],
        layers: [],
        masks: [],
        motionProfiles: [],
        reconstructions: [],
      },
    });
    expect(rejected.candidateDecisions).toContainEqual(expect.objectContaining({
      effectiveDisposition: "static",
      id: "layer-wheel",
      primaryReason: "AUTHORING_STATIC_EVIDENCE_APPROVAL_NOT_CLOSED",
    }));
  });

  it("reproduces the committed empty production evidence and normalized reference-pose inputs without publishing runtime assets", async () => {
    const protectedPaths = [
      contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
      contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
      contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
    ];
    const before = new Map(await Promise.all(protectedPaths.map(async (path) => [
      path,
      sha256(await readFile(resolve(PROJECT_ROOT, path))),
    ] as const)));

    const result = await production.prepareWatchLayerAuthoring({ projectRoot: PROJECT_ROOT });
    expect(result).toMatchObject({
      approvedMovingLayerIds: [],
      changed: false,
      evidenceChanged: false,
      mode: "reference-pose",
      normalizedChanged: false,
      normalizedDocument: {
        approvedMovingLayerIds: [],
        depthEnabled: false,
        mode: "reference-pose",
        packageInputs: {
          approvals: [],
          layers: [],
          masks: [],
          motionProfiles: [],
          provenance: [],
          reconstructions: [],
          relationships: [],
        },
        publicAssets: [],
        releaseStatus: "fallback-only",
        runtimeManifest: null,
      },
    });
    expect(result.candidateDecisions).toHaveLength(5);
    expect(result.candidateDecisions.every((decision: JsonRecord) => (
      decision.effectiveDisposition === "static"
    ))).toBe(true);

    const [indexBytes, normalizedBytes, releaseBytes] = await Promise.all([
      readFile(resolve(PROJECT_ROOT, evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH)),
      readFile(resolve(PROJECT_ROOT, production.NORMALIZED_WATCH_LAYER_INPUTS_PATH)),
      readFile(resolve(PROJECT_ROOT, contract.CANONICAL_PROJECT_PATHS.successorRelease)),
    ]);
    const index = evidence.validateLayerReviewEvidenceIndex(JSON.parse(indexBytes.toString("utf8")));
    expect(index).toMatchObject({ artifactCount: 0, artifacts: [], reviewSetCount: 0, reviewSets: [] });
    expect(indexBytes).toEqual(contract.serializeCanonicalJsonLine(index));
    expect(normalizedBytes).toEqual(contract.serializeCanonicalJsonLine(
      JSON.parse(normalizedBytes.toString("utf8")),
    ));
    expect(contract.RELEASE_POINTER_SCHEMA.parseJson(releaseBytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    })).toEqual({
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    });
    expect(releaseBytes.toString("utf8")).not.toContain("/assets/watch-2-5d/");
    await expect(lstat(resolve(
      PROJECT_ROOT,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    ))).rejects.toMatchObject({ code: "ENOENT" });
    for (const path of protectedPaths) {
      expect(sha256(await readFile(resolve(PROJECT_ROOT, path)))).toBe(before.get(path));
    }

    const loaded = await loader.loadWatchLayerAuthoring({ projectRoot: PROJECT_ROOT });
    expect(loaded.reviewInputs).toMatchObject({
      approvals: [],
      depthProfiles: [],
      layers: [],
      masks: [],
      motionProfiles: [],
      reconstructions: [],
    });
  }, 60_000);
});
