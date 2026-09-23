import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

type JsonRecord = Record<string, unknown>;
type StrictSchema = {
  parse(value: unknown): unknown;
  serialize(value: unknown): Buffer;
  serializeLine(value: unknown): Buffer;
};
type ContractModule = {
  APPROVAL_RECORD_SCHEMA: StrictSchema;
  APPROVED_MASTER_IDENTITY: JsonRecord;
  AUTHORING_DOCUMENT_SCHEMA: StrictSchema;
  AUTHORING_INTERPRETATION_NOTICE: string;
  CANONICAL_IDENTITY_MATRIX: JsonRecord;
  CANONICAL_PROJECT_PATHS: Record<string, string>;
  CANONICAL_SOURCE_COORDINATE_SPACE: { readonly height: number; readonly width: number };
  GEAR_RELATIONSHIP_SCHEMA: StrictSchema;
  LAYER_RECORD_SCHEMA: StrictSchema;
  MOTION_PROFILE_SCHEMA: StrictSchema;
  PHASE_NAMES: readonly string[];
  PREDECESSOR_MANIFEST_IDENTITY: JsonRecord;
  serializeCanonicalJson(value: unknown): Buffer;
  sha256(value: string | Uint8Array): string;
};
type CandidateDecision = {
  readonly authoredDisposition: string;
  readonly effectiveDisposition: string;
  readonly id: string;
  readonly primaryReason: string | null;
  readonly reasonCodes: readonly string[];
};
type LoaderResult = {
  readonly approvedMovingLayerIds: readonly string[];
  readonly artifactIssues: readonly JsonRecord[];
  readonly candidateDecisions: readonly CandidateDecision[];
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
  readonly staticLayerIds: readonly string[];
};
type LoaderModule = {
  AUTHORING_LOADER_ISSUE_CODES: Readonly<Record<string, string>>;
  AUTHORING_STATIC_REASON_CODES: Readonly<Record<string, string>>;
  loadWatchLayerAuthoring(options?: { readonly projectRoot?: string }): Promise<LoaderResult>;
};
type SourceRect = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};
type MaskFixture = {
  readonly alphaSum: number;
  readonly bytes: Buffer;
  readonly nonZeroPixelCount: number;
  readonly samples: readonly (readonly [number, number, number])[];
  readonly tightBounds: SourceRect;
};
type RasterAssets = {
  readonly boundary: MaskFixture;
  readonly boundaryTooWide: MaskFixture;
  readonly fill: Buffer;
  readonly fillPartialAlpha: Buffer;
  readonly region: MaskFixture;
  readonly segmentation: MaskFixture;
};
type FixtureOptions = {
  readonly approvalTransform?: (approvals: JsonRecord[]) => JsonRecord[];
  readonly boundary?: "valid" | "too-wide";
  readonly fill?: "valid" | "partial-alpha";
  readonly omitFill?: boolean;
  readonly segmentationMedia?: "valid" | "invalid-signature";
};
type AuthoredFixture = {
  readonly approvals: readonly JsonRecord[];
  readonly document: JsonRecord;
  readonly files: Readonly<Record<string, Buffer>>;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const loader = (await import("../../scripts/watch-2-5d/authoring-loader.mjs")) as unknown as LoaderModule;

const WIDTH = contract.CANONICAL_SOURCE_COORDINATE_SPACE.width;
const HEIGHT = contract.CANONICAL_SOURCE_COORDINATE_SPACE.height;
const PIXEL_COUNT = WIDTH * HEIGHT;
const MASK_DIRECTORY = "source/assets/watch-2-5d/v1/masks";
const RECONSTRUCTION_DIRECTORY = "source/assets/watch-2-5d/v1/reconstruction";
const APPROVAL_DIRECTORY = "source/assets/watch-2-5d/v1/approvals";
const REVIEW_DIRECTORY = "source/assets/watch-2-5d/v1/review";
const AUTHORING_PATH = "source/assets/watch-2-5d/v1/authoring.json";
const SEGMENTATION_PATH = `${MASK_DIRECTORY}/wheel-segmentation.png`;
const REGION_PATH = `${MASK_DIRECTORY}/wheel-reconstruction-region.png`;
const BOUNDARY_PATH = `${MASK_DIRECTORY}/wheel-reconstruction-boundary.png`;
const FILL_PATH = `${RECONSTRUCTION_DIRECTORY}/wheel-fill.png`;
const temporaryRoots = new Set<string>();
let rasterAssets: RasterAssets;

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pixelIndex(x: number, y: number): number {
  return y * WIDTH + x;
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

function tightBounds(samples: readonly (readonly [number, number, number])[]): SourceRect {
  const xs = samples.filter(([, , alpha]) => alpha !== 0).map(([x]) => x);
  const ys = samples.filter(([, , alpha]) => alpha !== 0).map(([, y]) => y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  return {
    height: maximumY - minimumY + 1,
    width: maximumX - minimumX + 1,
    x: minimumX,
    y: minimumY,
  };
}

function grayscaleMask(
  samples: readonly (readonly [number, number, number])[],
): MaskFixture {
  const raw = Buffer.alloc(PIXEL_COUNT);
  for (const [x, y, alpha] of samples) raw[pixelIndex(x, y)] = alpha;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 0;
  const scanlines = Buffer.alloc((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    raw.copy(scanlines, y * (WIDTH + 1) + 1, y * WIDTH, (y + 1) * WIDTH);
  }
  const bytes = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return {
    alphaSum: samples.reduce((total, [, , alpha]) => total + alpha, 0),
    bytes,
    nonZeroPixelCount: samples.filter(([, , alpha]) => alpha !== 0).length,
    samples,
    tightBounds: tightBounds(samples),
  };
}

async function rgbaFill(partialAlpha: boolean): Promise<Buffer> {
  const raw = Buffer.alloc(PIXEL_COUNT * 4);
  const regionPixels = [
    [100, 100],
    [101, 100],
    [102, 100],
  ] as const;
  regionPixels.forEach(([x, y], index) => {
    const offset = pixelIndex(x, y) * 4;
    raw[offset] = 60 + index;
    raw[offset + 1] = 80 + index;
    raw[offset + 2] = 120 + index;
    raw[offset + 3] = partialAlpha && index === 1 ? 254 : 255;
  });
  return sharp(raw, {
    limitInputPixels: PIXEL_COUNT,
    raw: { channels: 4, height: HEIGHT, width: WIDTH },
  })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      palette: false,
      progressive: false,
    })
    .toBuffer();
}

function phaseRecords(): JsonRecord[] {
  return contract.PHASE_NAMES.map((name, ordinal) => ({
    assetSha256: [],
    name,
    ordinal,
    phasePayloadSha256: "a".repeat(64),
    runtimeManifestSha256: null,
    status: ordinal === 0 ? "approved" : "disabled",
  }));
}

function emptyAuthoring(candidateInventory: JsonRecord[] = []): JsonRecord {
  return {
    approvedMovingLayerIds: [],
    approvals: [],
    authoredInterpretation: true,
    candidateInventory,
    canonicalMaster: structuredClone(contract.APPROVED_MASTER_IDENTITY),
    depthEnabled: false,
    depthProfiles: [],
    interpretationNotice: contract.AUTHORING_INTERPRETATION_NOTICE,
    layers: [],
    masks: [],
    motionProfiles: [],
    packageId: "watch-layer-package",
    packageVersion: "1.0.0",
    parentSpec: contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    phases: phaseRecords(),
    predecessorContract: structuredClone(contract.PREDECESSOR_MANIFEST_IDENTITY),
    provenance: [],
    reconstructions: [],
    relationships: [],
    schemaVersion: 1,
    sourceCoordinateSpace: structuredClone(contract.CANONICAL_SOURCE_COORDINATE_SPACE),
    sourceDateEpoch: 1_700_000_000,
  };
}

function maskRecord(
  id: string,
  file: string,
  fixture: MaskFixture,
  provenanceId: string,
): JsonRecord {
  return {
    alphaSum: fixture.alphaSum,
    file,
    height: HEIGHT,
    id,
    nonZeroPixelCount: fixture.nonZeroPixelCount,
    provenanceId,
    sha256: digest(fixture.bytes),
    tightBounds: fixture.tightBounds,
    width: WIDTH,
  };
}

function provenanceRecord({
  artifactId,
  artifactSha256,
  classification,
  id,
  immediateParentSha256,
  method,
}: {
  readonly artifactId: string;
  readonly artifactSha256: string;
  readonly classification: "source-derived" | "synthetic";
  readonly id: string;
  readonly immediateParentSha256: readonly string[];
  readonly method: string;
}): JsonRecord {
  return {
    artifactId,
    artifactSha256,
    classification,
    createdAt: "2026-05-17T12:34:56.000Z",
    id,
    immediateParentSha256,
    method,
    operator: "fixture-author",
    settings: { preserveAlpha: true },
    tool: { name: "Fixture Raster Editor", version: "1.0.0" },
  };
}

function approvalRecord({
  artifactSha256,
  id,
  layerIds = ["layer-wheel"],
  reviewedPoseIds = ["reference-pose"],
  reviewedZoomPercent,
  scope,
}: {
  readonly artifactSha256: readonly string[];
  readonly id: string;
  readonly layerIds?: readonly string[];
  readonly reviewedPoseIds?: readonly string[];
  readonly reviewedZoomPercent: readonly number[];
  readonly scope: string;
}): JsonRecord {
  return {
    artifactSha256: [...new Set(artifactSha256)].sort(),
    decision: "approved",
    id,
    layerIds,
    notes: `Exact ${scope} fixture review.`,
    reviewedAt: "2026-05-17T13:00:00.000Z",
    reviewedPoseIds,
    reviewedZoomPercent,
    reviewer: "fixture-reviewer",
    scope,
  };
}

function buildAuthoredFixture(options: FixtureOptions = {}): AuthoredFixture {
  const segmentation = rasterAssets.segmentation;
  const region = rasterAssets.region;
  const boundary = options.boundary === "too-wide"
    ? rasterAssets.boundaryTooWide
    : rasterAssets.boundary;
  const fillBytes = options.fill === "partial-alpha"
    ? rasterAssets.fillPartialAlpha
    : rasterAssets.fill;
  const segmentationBytes = options.segmentationMedia === "invalid-signature"
    ? Buffer.from("not-a-png")
    : segmentation.bytes;
  const segmentationRecord = {
    ...maskRecord(
      "mask-wheel-segmentation",
      SEGMENTATION_PATH,
      segmentation,
      "provenance-wheel-segmentation",
    ),
    sha256: digest(segmentationBytes),
  };
  const regionRecord = maskRecord(
    "mask-wheel-reconstruction-region",
    REGION_PATH,
    region,
    "provenance-wheel-reconstruction-region",
  );
  const boundaryRecord = maskRecord(
    "mask-wheel-reconstruction-boundary",
    BOUNDARY_PATH,
    boundary,
    "provenance-wheel-reconstruction-boundary",
  );
  const fillHash = digest(fillBytes);
  const layer: JsonRecord = {
    approvalIds: [
      "approval-segmentation",
      "approval-pivot",
      "approval-reconstruction",
    ],
    disposition: "approved-moving",
    id: "layer-wheel",
    motionProfileId: "motion-wheel",
    pivot: { x: 100.5, y: 100.5 },
    provenanceIds: [
      "provenance-wheel-segmentation",
      "provenance-layer-wheel",
    ],
    reconstructedPixelCount: region.nonZeroPixelCount,
    referenceTransform: structuredClone(contract.CANONICAL_IDENTITY_MATRIX),
    segmentationMaskId: "mask-wheel-segmentation",
    semanticClass: "exposed-gear",
    sourceRect: { height: 3, width: 5, x: 99, y: 99 },
    sourceVisiblePixelCount: segmentation.nonZeroPixelCount,
    zOrder: 10,
  };
  const layerHash = contract.sha256(contract.LAYER_RECORD_SCHEMA.serialize(layer));
  const motion: JsonRecord = {
    approvalId: "approval-motion",
    direction: 1,
    evidence: "authored-assumption",
    id: "motion-wheel",
    kind: "continuous-rotation",
    layerId: "layer-wheel",
    maxRadians: Math.PI * 2,
    minRadians: 0,
    periodMs: 60_000,
    phaseRadians: 0,
    pivot: { x: 100.5, y: 100.5 },
    referenceRadians: 0,
  };
  const motionHash = contract.sha256(contract.MOTION_PROFILE_SCHEMA.serialize(motion));
  const pivotHash = contract.sha256(contract.serializeCanonicalJson({
    layerId: "layer-wheel",
    pivot: { x: 100.5, y: 100.5 },
  }));
  const reconstruction: JsonRecord = {
    approvalId: "approval-reconstruction",
    boundaryMaskId: "mask-wheel-reconstruction-boundary",
    fillFile: FILL_PATH,
    fillId: "fill-wheel",
    fillSha256: fillHash,
    id: "reconstruction-wheel",
    method: "manual-paint",
    provenanceId: "provenance-fill-wheel",
    regionMaskId: "mask-wheel-reconstruction-region",
    syntheticPixelCount: region.nonZeroPixelCount,
  };
  const segmentationHash = String(segmentationRecord.sha256);
  const regionHash = String(regionRecord.sha256);
  const boundaryHash = String(boundaryRecord.sha256);
  const provenance = [
    provenanceRecord({
      artifactId: "mask-wheel-segmentation",
      artifactSha256: segmentationHash,
      classification: "source-derived",
      id: "provenance-wheel-segmentation",
      immediateParentSha256: [String(contract.APPROVED_MASTER_IDENTITY.sha256)],
      method: "manual-mask",
    }),
    provenanceRecord({
      artifactId: "mask-wheel-reconstruction-region",
      artifactSha256: regionHash,
      classification: "synthetic",
      id: "provenance-wheel-reconstruction-region",
      immediateParentSha256: [String(contract.APPROVED_MASTER_IDENTITY.sha256)],
      method: "manual-mask",
    }),
    provenanceRecord({
      artifactId: "mask-wheel-reconstruction-boundary",
      artifactSha256: boundaryHash,
      classification: "synthetic",
      id: "provenance-wheel-reconstruction-boundary",
      immediateParentSha256: [regionHash],
      method: "deterministic-generation",
    }),
    provenanceRecord({
      artifactId: "fill-wheel",
      artifactSha256: fillHash,
      classification: "synthetic",
      id: "provenance-fill-wheel",
      immediateParentSha256: [regionHash, boundaryHash].sort(),
      method: "manual-paint",
    }),
    provenanceRecord({
      artifactId: "layer-wheel",
      artifactSha256: layerHash,
      classification: "source-derived",
      id: "provenance-layer-wheel",
      immediateParentSha256: [segmentationHash],
      method: "source-extraction",
    }),
    provenanceRecord({
      artifactId: "motion-wheel",
      artifactSha256: motionHash,
      classification: "synthetic",
      id: "provenance-motion-wheel",
      immediateParentSha256: [layerHash],
      method: "deterministic-generation",
    }),
  ];
  const releaseHashes = [
    segmentationHash,
    pivotHash,
    fillHash,
    regionHash,
    boundaryHash,
    motionHash,
  ];
  let approvals = [
    approvalRecord({
      artifactSha256: [segmentationHash],
      id: "approval-segmentation",
      reviewedZoomPercent: [200],
      scope: "segmentation",
    }),
    approvalRecord({
      artifactSha256: [pivotHash],
      id: "approval-pivot",
      reviewedZoomPercent: [200],
      scope: "pivot",
    }),
    approvalRecord({
      artifactSha256: [fillHash, regionHash, boundaryHash],
      id: "approval-reconstruction",
      reviewedPoseIds: ["reference-pose", "motion-minimum", "motion-maximum"],
      reviewedZoomPercent: [100, 200],
      scope: "reconstruction",
    }),
    approvalRecord({
      artifactSha256: [motionHash],
      id: "approval-motion",
      reviewedPoseIds: ["reference-pose", "motion-minimum", "motion-maximum"],
      reviewedZoomPercent: [100, 200],
      scope: "motion",
    }),
    approvalRecord({
      artifactSha256: releaseHashes,
      id: "approval-release",
      reviewedZoomPercent: [],
      scope: "release",
    }),
  ];
  if (options.approvalTransform !== undefined) {
    approvals = options.approvalTransform(approvals.map((record) => structuredClone(record)));
  }
  const document = {
    ...emptyAuthoring(),
    approvedMovingLayerIds: ["layer-wheel"],
    layers: [layer],
    masks: [segmentationRecord, regionRecord, boundaryRecord],
    motionProfiles: [motion],
    provenance,
    reconstructions: [reconstruction],
  };
  const files: Record<string, Buffer> = {
    [BOUNDARY_PATH]: boundary.bytes,
    [REGION_PATH]: region.bytes,
    [SEGMENTATION_PATH]: segmentationBytes,
  };
  if (!options.omitFill) files[FILL_PATH] = fillBytes;
  return { approvals, document, files };
}

async function createProject(fixture: AuthoredFixture): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "watch-authoring-loader-"));
  temporaryRoots.add(root);
  await Promise.all([
    mkdir(resolve(root, MASK_DIRECTORY), { recursive: true }),
    mkdir(resolve(root, RECONSTRUCTION_DIRECTORY), { recursive: true }),
    mkdir(resolve(root, APPROVAL_DIRECTORY), { recursive: true }),
    mkdir(resolve(root, REVIEW_DIRECTORY), { recursive: true }),
  ]);
  await writeFile(
    resolve(root, AUTHORING_PATH),
    contract.AUTHORING_DOCUMENT_SCHEMA.serialize(fixture.document),
  );
  await Promise.all(Object.entries(fixture.files).map(([path, bytes]) => (
    writeFile(resolve(root, path), bytes)
  )));
  await Promise.all(fixture.approvals.map((approval) => (
    writeFile(
      resolve(root, APPROVAL_DIRECTORY, `${String(approval.id)}.json`),
      contract.APPROVAL_RECORD_SCHEMA.serializeLine(approval),
    )
  )));
  return root;
}

function decisionFor(result: LoaderResult, id: string): CandidateDecision {
  const decision = result.candidateDecisions.find((entry) => entry.id === id);
  if (decision === undefined) throw new Error(`Missing decision for ${id}`);
  return decision;
}

beforeAll(async () => {
  const segmentation = grayscaleMask([
    [100, 100, 255],
    [101, 100, 128],
  ]);
  const region = grayscaleMask([
    [100, 100, 255],
    [101, 100, 255],
    [102, 100, 255],
  ]);
  const boundary = grayscaleMask([
    [100, 100, 255],
    [101, 100, 255],
    [102, 100, 255],
    [103, 100, 255],
  ]);
  const boundaryTooWide = grayscaleMask([
    [100, 100, 255],
    [101, 100, 255],
    [102, 100, 255],
    [107, 100, 255],
  ]);
  const [fill, fillPartialAlpha] = await Promise.all([
    rgbaFill(false),
    rgbaFill(true),
  ]);
  rasterAssets = {
    boundary,
    boundaryTooWide,
    fill,
    fillPartialAlpha,
    region,
    segmentation,
  };
}, 60_000);

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("authored watch layer loader", () => {
  it("normalizes the real empty authored set without changing fallback-only or protected source bytes", async () => {
    const projectRoot = process.cwd();
    const protectedPaths = [
      "source/assets/elite-watch-master.png",
      AUTHORING_PATH,
      "data/watch-layer-release.json",
      "package.json",
    ];
    const before = new Map(await Promise.all(protectedPaths.map(async (path) => [
      path,
      digest(await readFile(resolve(projectRoot, path))),
    ] as const)));

    const result = await loader.loadWatchLayerAuthoring({ projectRoot });

    expect(result).toMatchObject({
      approvedMovingLayerIds: [],
      artifactIssues: [],
      excludedLayerIds: [],
      mode: "reference-pose",
      normalized: {
        approvals: [],
        fillInputs: [],
        layers: [],
        maskInputs: [],
        masks: [],
        motionProfiles: [],
        provenance: [],
        reconstructions: [],
        relationships: [],
      },
    });
    expect(result.candidateDecisions).toHaveLength(5);
    expect(result.candidateDecisions.every((decision) => (
      decision.effectiveDisposition === "static"
      && decision.primaryReason === loader.AUTHORING_STATIC_REASON_CODES.PROPOSED_STATIC
    ))).toBe(true);
    for (const path of protectedPaths) {
      expect(digest(await readFile(resolve(projectRoot, path)))).toBe(before.get(path));
    }
  }, 30_000);

  it("exposes one candidate only after exact media, provenance, geometry, and all approval scopes close", async () => {
    const fixture = buildAuthoredFixture();
    const root = await createProject(fixture);
    const result = await loader.loadWatchLayerAuthoring({ projectRoot: root });

    expect(result).toMatchObject({
      approvedMovingLayerIds: ["layer-wheel"],
      artifactIssues: [],
      excludedLayerIds: [],
      mode: "approved-moving",
    });
    expect(decisionFor(result, "layer-wheel")).toEqual({
      authoredDisposition: "approved-moving",
      effectiveDisposition: "approved-moving",
      id: "layer-wheel",
      primaryReason: null,
      reasonCodes: [],
    });
    expect(result.normalized).toMatchObject({
      layers: [{ id: "layer-wheel", disposition: "approved-moving" }],
      masks: [
        { id: "mask-wheel-segmentation" },
        { id: "mask-wheel-reconstruction-region" },
        { id: "mask-wheel-reconstruction-boundary" },
      ],
      motionProfiles: [{ id: "motion-wheel" }],
      reconstructions: [{ id: "reconstruction-wheel" }],
      relationships: [],
    });
    expect(result.normalized.approvals.map(({ id }) => id).sort()).toEqual([
      "approval-motion",
      "approval-pivot",
      "approval-reconstruction",
      "approval-release",
      "approval-segmentation",
    ]);
    expect(result.normalized.maskInputs).toHaveLength(3);
    expect(result.normalized.fillInputs).toHaveLength(1);
  }, 60_000);

  it("fails closed on known-current hash supersets, partial bindings, and rejected records", async () => {
    const fixture = buildAuthoredFixture({
      approvalTransform(approvals) {
        const pivotApproval = approvals.find(({ id }) => id === "approval-pivot");
        const pivotHash = String(
          (pivotApproval?.artifactSha256 as readonly string[] | undefined)?.[0],
        );
        return approvals.map((approval) => {
          if (approval.id === "approval-segmentation") {
            return {
              ...approval,
              artifactSha256: [
                ...(approval.artifactSha256 as readonly string[]),
                pivotHash,
              ].sort(),
            };
          }
          if (approval.id === "approval-reconstruction") {
            return {
              ...approval,
              artifactSha256: (approval.artifactSha256 as readonly string[]).slice(0, -1),
            };
          }
          if (approval.id === "approval-motion") {
            return { ...approval, decision: "rejected" };
          }
          return approval;
        });
      },
    });
    const root = await createProject(fixture);
    const result = await loader.loadWatchLayerAuthoring({ projectRoot: root });
    const decision = decisionFor(result, "layer-wheel");

    expect(result.approvedMovingLayerIds).toEqual([]);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      loader.AUTHORING_STATIC_REASON_CODES.SEGMENTATION_APPROVAL_NOT_CLOSED,
      loader.AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_APPROVAL_NOT_CLOSED,
      loader.AUTHORING_STATIC_REASON_CODES.MOTION_APPROVAL_NOT_CLOSED,
    ]));
  }, 60_000);

  it("rejects a release approval containing an unrelated moving layer ID", async () => {
    const fixture = buildAuthoredFixture({
      approvalTransform(approvals) {
        return approvals.map((approval) => approval.id === "approval-release"
          ? {
              ...approval,
              layerIds: ["layer-unrelated", "layer-wheel"],
            }
          : approval);
      },
    });
    const root = await createProject(fixture);
    const result = await loader.loadWatchLayerAuthoring({ projectRoot: root });

    expect(result.approvedMovingLayerIds).toEqual([]);
    expect(decisionFor(result, "layer-wheel").reasonCodes).toContain(
      loader.AUTHORING_STATIC_REASON_CODES.RELEASE_APPROVAL_NOT_CLOSED,
    );
  }, 60_000);

  it("downgrades incomplete, stale, and pending authored candidates with stable reasons and no substitutes", async () => {
    const fixture = buildAuthoredFixture({
      approvalTransform(approvals) {
        return approvals.map((approval) => {
          if (approval.id === "approval-segmentation") {
            return { ...approval, artifactSha256: ["f".repeat(64)] };
          }
          if (approval.id === "approval-motion") {
            return {
              ...approval,
              decision: "pending",
              reviewedAt: null,
              reviewer: null,
            };
          }
          return approval;
        });
      },
      omitFill: true,
    });
    const root = await createProject(fixture);
    const result = await loader.loadWatchLayerAuthoring({ projectRoot: root });
    const decision = decisionFor(result, "layer-wheel");

    expect(result).toMatchObject({
      approvedMovingLayerIds: [],
      excludedLayerIds: ["layer-wheel"],
      mode: "reference-pose",
      normalized: {
        fillInputs: [],
        layers: [],
        masks: [],
        motionProfiles: [],
        reconstructions: [],
      },
    });
    expect(decision.effectiveDisposition).toBe("static");
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      loader.AUTHORING_STATIC_REASON_CODES.SEGMENTATION_APPROVAL_NOT_CLOSED,
      loader.AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_INVALID,
      loader.AUTHORING_STATIC_REASON_CODES.MOTION_APPROVAL_NOT_CLOSED,
    ]));
    expect(result.artifactIssues).toContainEqual(expect.objectContaining({
      artifactId: "fill-wheel",
      code: loader.AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_MISSING,
    }));
  }, 60_000);

  it("rejects over-feathered boundaries, partial fill alpha, and invalid media by keeping candidates static", async () => {
    const geometricFixture = buildAuthoredFixture({
      boundary: "too-wide",
      fill: "partial-alpha",
    });
    const geometricRoot = await createProject(geometricFixture);
    const geometricResult = await loader.loadWatchLayerAuthoring({
      projectRoot: geometricRoot,
    });
    expect(decisionFor(geometricResult, "layer-wheel").reasonCodes).toContain(
      loader.AUTHORING_STATIC_REASON_CODES.RECONSTRUCTION_INVALID,
    );
    expect(geometricResult.approvedMovingLayerIds).toEqual([]);

    const mediaFixture = buildAuthoredFixture({
      segmentationMedia: "invalid-signature",
    });
    const mediaRoot = await createProject(mediaFixture);
    const mediaResult = await loader.loadWatchLayerAuthoring({ projectRoot: mediaRoot });
    expect(decisionFor(mediaResult, "layer-wheel").primaryReason).toBe(
      loader.AUTHORING_STATIC_REASON_CODES.MASK_INVALID,
    );
    expect(mediaResult.artifactIssues).toContainEqual(expect.objectContaining({
      artifactId: "mask-wheel-segmentation",
      code: loader.AUTHORING_LOADER_ISSUE_CODES.MASK_MEDIA_INVALID,
    }));
    expect(mediaResult.normalized.layers).toEqual([]);
  }, 90_000);

  it("rejects a symlinked authored artifact before decoding and leaves the target unchanged", async () => {
    const fixture = buildAuthoredFixture();
    const root = await createProject(fixture);
    const targetPath = resolve(root, "reviewer-owned-mask.png");
    await writeFile(targetPath, rasterAssets.segmentation.bytes);
    await rm(resolve(root, SEGMENTATION_PATH));
    await symlink(targetPath, resolve(root, SEGMENTATION_PATH));
    const before = digest(await readFile(targetPath));

    await expect(loader.loadWatchLayerAuthoring({ projectRoot: root })).rejects.toMatchObject({
      code: "LAYER_PATH_INVALID",
    });
    expect(digest(await readFile(targetPath))).toBe(before);
  });
});
