import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;
type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};
type EvidenceOutput = {
  readonly bytes: Buffer;
  readonly path: string;
};
type ReviewSet = {
  readonly artifactPaths: readonly string[];
  readonly bindingSha256: string;
  readonly id: string;
  readonly poseIds: readonly string[];
  readonly scope: string;
  readonly zoomPercent: readonly number[];
};
type EvidenceIndex = JsonRecord & {
  readonly artifacts: readonly (JsonRecord & {
    readonly kind: string;
    readonly path: string;
    readonly poseId: string | null;
    readonly sha256: string;
    readonly zoomPercent: number;
  })[];
  readonly reviewPolicy: JsonRecord;
  readonly reviewSets: readonly ReviewSet[];
};
type RenderedEvidence = {
  readonly index: EvidenceIndex;
  readonly indexIdentity: FileIdentity;
  readonly outputs: readonly EvidenceOutput[];
  readonly reviewSets: readonly ReviewSet[];
};
type ReviewEvidenceModule = {
  readonly LAYER_REVIEW_EVIDENCE_INDEX_PATH: string;
  readonly REVIEW_EVIDENCE_ISSUE_CODES: Readonly<Record<string, string>>;
  renderLayerReviewEvidence(options: JsonRecord): Promise<RenderedEvidence>;
  validateLayerReviewEvidenceIndex(value: unknown): EvidenceIndex;
};
type ApprovalTemplate = JsonRecord & {
  readonly artifactSha256: readonly string[];
  readonly decision: "pending";
  readonly id: string;
  readonly layerIds: readonly string[];
  readonly reviewedAt: null;
  readonly reviewedPoseIds: readonly string[];
  readonly reviewedZoomPercent: readonly number[];
  readonly reviewer: null;
  readonly scope: string;
};
type GeneratedTemplate = {
  readonly expectation: JsonRecord;
  readonly evidenceSetId: string | null;
  readonly outputPath: string;
  readonly template: ApprovalTemplate;
};
type ApprovalGeneratorModule = {
  generateWatchLayerApprovalTemplate(options: {
    readonly outputPath?: string;
    readonly projectRoot: string;
    readonly request: JsonRecord;
  }): Promise<GeneratedTemplate>;
  validateWatchLayerApprovalDecision(options: {
    readonly approvalId?: string;
    readonly decision: JsonRecord;
    readonly evidenceIndex?: string;
    readonly evidenceSetId: string;
    readonly projectRoot: string;
  }): Promise<JsonRecord>;
};

type FixtureOptions = {
  readonly depthScaleDelta?: number;
  readonly fillBlue?: number;
  readonly maskExtraPixel?: boolean;
  readonly motionMaximum?: number;
  readonly pivotX?: number;
};
type EvidenceFixture = {
  readonly inputFiles: Readonly<Record<string, Buffer>>;
  readonly renderOptions: JsonRecord;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const evidence = (await import("../../scripts/watch-2-5d/review-evidence.mjs")) as unknown as ReviewEvidenceModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const approvalGenerator = (await import("../../scripts/generate-watch-layer-approval-template.mjs")) as unknown as ApprovalGeneratorModule;

const SOURCE_PATH = "source/assets/synthetic-layer-review-source.png";
const AUTHORING_PATH = "source/assets/watch-2-5d/v1/authoring.json";
const SEGMENTATION_PATH = "source/assets/watch-2-5d/v1/masks/layer-wheel.png";
const REGION_PATH = "source/assets/watch-2-5d/v1/masks/layer-wheel-region.png";
const BOUNDARY_PATH = "source/assets/watch-2-5d/v1/masks/layer-wheel-boundary.png";
const FILL_PATH = "source/assets/watch-2-5d/v1/reconstruction/layer-wheel-fill.png";
const WIDTH = 8;
const HEIGHT = 6;
const temporaryRoots = new Set<string>();

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function identity(path: string, bytes: Uint8Array): FileIdentity {
  return { byteLength: bytes.byteLength, path, sha256: sha256(bytes) };
}

function setPixel(mask: Buffer, x: number, y: number, alpha = 255): void {
  mask[y * WIDTH + x] = alpha;
}

async function grayscalePng(data: Buffer): Promise<Buffer> {
  return sharp(data, { raw: { channels: 1, height: HEIGHT, width: WIDTH } })
    .toColourspace("b-w")
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      effort: 10,
      palette: false,
      progressive: false,
    })
    .toBuffer();
}

async function rgbaPng(data: Buffer): Promise<Buffer> {
  return sharp(data, { raw: { channels: 4, height: HEIGHT, width: WIDTH } })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      effort: 10,
      palette: false,
      progressive: false,
    })
    .toBuffer();
}

function maskMetadata(id: string, file: string, bytes: Buffer, data: Buffer): JsonRecord {
  let alphaSum = 0;
  let nonZeroPixelCount = 0;
  let minimumX = WIDTH;
  let minimumY = HEIGHT;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const alpha = data[y * WIDTH + x];
      alphaSum += alpha;
      if (alpha === 0) continue;
      nonZeroPixelCount += 1;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  return {
    alphaSum,
    file,
    height: HEIGHT,
    id,
    nonZeroPixelCount,
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

async function buildFixture(options: FixtureOptions = {}): Promise<EvidenceFixture> {
  const pivotX = options.pivotX ?? 3.5;
  const sourceRgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      sourceRgba[offset] = 30 + x * 20;
      sourceRgba[offset + 1] = 40 + y * 25;
      sourceRgba[offset + 2] = 80 + (x + y) * 10;
      sourceRgba[offset + 3] = 255;
    }
  }
  const sourceBytes = await rgbaPng(sourceRgba);

  const segmentationData = Buffer.alloc(WIDTH * HEIGHT);
  setPixel(segmentationData, 2, 2, 255);
  setPixel(segmentationData, 3, 2, 192);
  setPixel(segmentationData, 4, 2, 255);
  if (options.maskExtraPixel) setPixel(segmentationData, 3, 3, 128);

  const regionData = Buffer.alloc(WIDTH * HEIGHT);
  for (const [x, y] of [[2, 2], [3, 2], [4, 2], [3, 3], [5, 2]]) {
    setPixel(regionData, x, y);
  }
  const boundaryData = Buffer.from(regionData);
  setPixel(boundaryData, 1, 2);
  setPixel(boundaryData, 6, 2);

  const [segmentationBytes, regionBytes, boundaryBytes] = await Promise.all([
    grayscalePng(segmentationData),
    grayscalePng(regionData),
    grayscalePng(boundaryData),
  ]);
  const fillRgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < regionData.byteLength; pixel += 1) {
    if (regionData[pixel] === 0) continue;
    const offset = pixel * 4;
    fillRgba[offset] = 12;
    fillRgba[offset + 1] = 140;
    fillRgba[offset + 2] = options.fillBlue ?? 210;
    fillRgba[offset + 3] = 255;
  }
  const fillBytes = await rgbaPng(fillRgba);

  const segmentationRecord = maskMetadata(
    "mask-wheel-segmentation",
    SEGMENTATION_PATH,
    segmentationBytes,
    segmentationData,
  );
  const regionRecord = maskMetadata(
    "mask-wheel-region",
    REGION_PATH,
    regionBytes,
    regionData,
  );
  const boundaryRecord = maskMetadata(
    "mask-wheel-boundary",
    BOUNDARY_PATH,
    boundaryBytes,
    boundaryData,
  );
  const layer: JsonRecord = {
    approvalIds: ["approval-reconstruction"],
    disposition: "approved-moving",
    id: "layer-wheel",
    motionProfileId: "motion-wheel",
    pivot: { x: pivotX, y: 2.5 },
    provenanceIds: ["provenance-layer-wheel"],
    reconstructedPixelCount: 5,
    referenceTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    segmentationMaskId: "mask-wheel-segmentation",
    semanticClass: "exposed-gear",
    sourceRect: { height: 4, width: 6, x: 1, y: 1 },
    sourceVisiblePixelCount: Number(segmentationRecord.nonZeroPixelCount),
    zOrder: 10,
  };
  const motionProfile: JsonRecord = {
    approvalId: "approval-motion",
    direction: 1,
    evidence: "authored-assumption",
    id: "motion-wheel",
    kind: "continuous-rotation",
    layerId: "layer-wheel",
    maxRadians: options.motionMaximum ?? 0.5,
    minRadians: -0.5,
    periodMs: 60_000,
    phaseRadians: 0,
    pivot: { x: pivotX, y: 2.5 },
    referenceRadians: 0,
  };
  const depthProfile: JsonRecord = {
    authoredInterpretation: true,
    enabled: false,
    id: "depth-compact",
    layers: [{
      displacementShortAxisFraction: 0.004,
      layerId: "layer-wheel",
      phaseRadians: 0,
      rotationDegrees: 0.5,
      scaleDelta: options.depthScaleDelta ?? 0.01,
      zOrder: 10,
    }],
    periodMs: 28_000,
    profile: "compact",
  };
  const reconstruction: JsonRecord = {
    approvalId: "approval-reconstruction",
    boundaryMaskId: "mask-wheel-boundary",
    fillFile: FILL_PATH,
    fillId: "fill-wheel",
    fillSha256: sha256(fillBytes),
    id: "reconstruction-wheel",
    method: "manual-paint",
    provenanceId: "provenance-fill-wheel",
    regionMaskId: "mask-wheel-region",
    syntheticPixelCount: 5,
  };
  const authoringBytes = Buffer.from(`${JSON.stringify({
    depthProfiles: [depthProfile],
    layers: [layer],
    masks: [segmentationRecord, regionRecord, boundaryRecord],
    motionProfiles: [motionProfile],
    reconstructions: [reconstruction],
  })}\n`);

  return {
    inputFiles: {
      [AUTHORING_PATH]: authoringBytes,
      [BOUNDARY_PATH]: boundaryBytes,
      [FILL_PATH]: fillBytes,
      [REGION_PATH]: regionBytes,
      [SEGMENTATION_PATH]: segmentationBytes,
      [SOURCE_PATH]: sourceBytes,
    },
    renderOptions: {
      authoringIdentity: identity(AUTHORING_PATH, authoringBytes),
      depthProfiles: [depthProfile],
      layers: [layer],
      masks: [
        { bytes: segmentationBytes, record: segmentationRecord },
        { bytes: regionBytes, record: regionRecord },
        { bytes: boundaryBytes, record: boundaryRecord },
      ],
      motionProfiles: [motionProfile],
      reconstructions: [{ fillBytes, record: reconstruction }],
      sourceBytes,
      sourceHeight: HEIGHT,
      sourceIdentity: identity(SOURCE_PATH, sourceBytes),
      sourceWidth: WIDTH,
    },
  };
}

function reviewSet(rendered: RenderedEvidence, id: string): ReviewSet {
  const selected = rendered.reviewSets.find((entry) => entry.id === id);
  if (selected === undefined) throw new Error(`Missing review set ${id}`);
  return selected;
}

async function writeProject(
  root: string,
  fixture: EvidenceFixture,
  rendered: RenderedEvidence,
): Promise<void> {
  const entries = [
    ...Object.entries(fixture.inputFiles),
    ...rendered.outputs.map(({ bytes, path }) => [path, bytes] as const),
  ];
  for (const [path, bytes] of entries) {
    const absolutePath = resolve(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "watch-layer-evidence-"));
  temporaryRoots.add(root);
  return root;
}

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("hash-bound authored layer review evidence", () => {
  it("renders exact mask, reconstruction, pivot, reference, motion, and disabled-depth evidence at required zooms", async () => {
    const fixture = await buildFixture();
    const first = await evidence.renderLayerReviewEvidence(fixture.renderOptions);
    const second = await evidence.renderLayerReviewEvidence(fixture.renderOptions);

    expect(first.index).toEqual(second.index);
    expect(first.outputs.map(({ bytes, path }) => ({ path, sha256: sha256(bytes) })))
      .toEqual(second.outputs.map(({ bytes, path }) => ({ path, sha256: sha256(bytes) })));
    expect(first.indexIdentity.path).toBe(evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH);
    expect(first.index.reviewPolicy).toMatchObject({
      approvalMutation: false,
      depthActivation: false,
      evidenceOnly: true,
      semanticInference: false,
      statusMutation: false,
      templateDecision: "pending-only",
    });

    const kinds = new Set(first.index.artifacts.map(({ kind }) => kind));
    expect(kinds).toEqual(new Set([
      "approved-change-overlay",
      "exact-mask-edge",
      "extreme-pose",
      "pivot-marker",
      "reference-pose",
      "residual-silhouette-diagnostic",
      "segmentation-mask-alpha",
      "source-reconstructed-comparison",
    ]));
    const poseIds = new Set(first.index.artifacts
      .map(({ poseId }) => poseId)
      .filter((poseId): poseId is string => poseId !== null));
    expect(poseIds).toEqual(new Set([
      "depth-compact-maximum",
      "depth-compact-minimum",
      "motion-wheel-maximum",
      "motion-wheel-minimum",
      "reference-pose",
    ]));
    expect(reviewSet(first, "layer-wheel-segmentation").zoomPercent).toEqual([200]);
    expect(reviewSet(first, "layer-wheel-pivot").zoomPercent).toEqual([200]);
    for (const id of [
      "layer-wheel-reconstruction",
      "layer-wheel-motion-wheel-motion",
      "layer-wheel-depth-compact-depth",
      "layer-wheel-fidelity",
    ]) {
      expect(reviewSet(first, id).zoomPercent, id).toEqual([100, 200]);
    }
    expect(reviewSet(first, "layer-wheel-depth-compact-depth").poseIds).toEqual([
      "depth-compact-maximum",
      "depth-compact-minimum",
      "reference-pose",
    ]);

    const indexOutput = first.outputs.find(({ path }) => (
      path === evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH
    ));
    expect(indexOutput).toBeDefined();
    expect(() => evidence.validateLayerReviewEvidenceIndex(
      JSON.parse(indexOutput?.bytes.toString("utf8") ?? "null"),
    )).not.toThrow();
    for (const artifact of first.index.artifacts) {
      const output = first.outputs.find(({ path }) => path === artifact.path);
      expect(output, artifact.path).toBeDefined();
      if (output === undefined) continue;
      expect(sha256(output.bytes)).toBe(artifact.sha256);
      expect(await sharp(output.bytes).metadata()).toMatchObject({ format: "png" });
    }
  });

  it("changes the corresponding evidence binding for every mask, fill, pivot, motion, or depth-profile mutation", async () => {
    const baseline = await evidence.renderLayerReviewEvidence((await buildFixture()).renderOptions);
    const cases: readonly [FixtureOptions, string][] = [
      [{ maskExtraPixel: true }, "layer-wheel-segmentation"],
      [{ fillBlue: 180 }, "layer-wheel-reconstruction"],
      [{ pivotX: 3.25 }, "layer-wheel-pivot"],
      [{ motionMaximum: 0.75 }, "layer-wheel-motion-wheel-motion"],
      [{ depthScaleDelta: 0.012 }, "layer-wheel-depth-compact-depth"],
    ];

    for (const [mutation, setId] of cases) {
      const changed = await evidence.renderLayerReviewEvidence((await buildFixture(mutation)).renderOptions);
      expect(reviewSet(changed, setId).bindingSha256, setId)
        .not.toBe(reviewSet(baseline, setId).bindingSha256);
      expect(changed.indexIdentity.sha256, setId)
        .not.toBe(baseline.indexIdentity.sha256);
    }
  });

  it("feeds one current evidence set into a pending-only template and rejects stale or pending decisions", async () => {
    const fixture = await buildFixture();
    const rendered = await evidence.renderLayerReviewEvidence(fixture.renderOptions);
    const root = await temporaryRoot();
    await writeProject(root, fixture, rendered);

    const generated = await approvalGenerator.generateWatchLayerApprovalTemplate({
      projectRoot: root,
      request: {
        evidenceIndex: evidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH,
        evidenceSetId: "layer-wheel-motion-wheel-motion",
        id: "approval-layer-wheel-motion",
        notes: "Pending human review of exact motion evidence.",
      },
    });
    expect(generated.evidenceSetId).toBe("layer-wheel-motion-wheel-motion");
    expect(generated.template).toMatchObject({
      decision: "pending",
      id: "approval-layer-wheel-motion",
      layerIds: ["layer-wheel"],
      reviewedAt: null,
      reviewedPoseIds: [
        "motion-wheel-maximum",
        "motion-wheel-minimum",
        "reference-pose",
      ],
      reviewedZoomPercent: [100, 200],
      reviewer: null,
      scope: "motion",
    });
    expect(JSON.parse(await readFile(resolve(root, generated.outputPath), "utf8")))
      .toEqual(generated.template);

    await expect(approvalGenerator.validateWatchLayerApprovalDecision({
      decision: generated.template,
      evidenceSetId: "layer-wheel-motion-wheel-motion",
      projectRoot: root,
    })).rejects.toMatchObject({ issueCode: "APPROVAL_DECISION_PENDING" });

    const approvedDecision: JsonRecord = {
      ...generated.template,
      decision: "approved",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewer: "fixture-reviewer",
    };
    await expect(approvalGenerator.validateWatchLayerApprovalDecision({
      decision: approvedDecision,
      evidenceSetId: "layer-wheel-motion-wheel-motion",
      projectRoot: root,
    })).resolves.toMatchObject({
      decision: "approved",
      id: "approval-layer-wheel-motion",
    });

    const changedFixture = await buildFixture({ motionMaximum: 0.75 });
    const changedEvidence = await evidence.renderLayerReviewEvidence(changedFixture.renderOptions);
    await writeProject(root, changedFixture, changedEvidence);
    await expect(approvalGenerator.validateWatchLayerApprovalDecision({
      decision: approvedDecision,
      evidenceSetId: "layer-wheel-motion-wheel-motion",
      projectRoot: root,
    })).rejects.toMatchObject({ issueCode: "APPROVAL_HASH_MISMATCH" });
  });

  it("keeps the empty static/fallback outcome valid without inventing evidence or approvals", async () => {
    const fixture = await buildFixture();
    const rendered = await evidence.renderLayerReviewEvidence({
      ...fixture.renderOptions,
      depthProfiles: [],
      layers: [],
      masks: [],
      motionProfiles: [],
      reconstructions: [],
    });
    expect(rendered.index.artifacts).toEqual([]);
    expect(rendered.reviewSets).toEqual([]);
    expect(rendered.outputs).toHaveLength(1);
    expect(rendered.index.reviewPolicy).toMatchObject({
      approvalMutation: false,
      depthActivation: false,
      statusMutation: false,
    });
  });
});
