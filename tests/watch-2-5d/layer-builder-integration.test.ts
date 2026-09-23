import { createHash } from "node:crypto";
import * as fs from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  parse(value: unknown): JsonRecord;
  parseJson(value: Uint8Array, options?: JsonRecord): JsonRecord;
  serialize(value: unknown): Buffer;
  serializeLine(value: unknown): Buffer;
};
type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};
type VerificationFailure = Error & {
  readonly code: string;
  readonly issueCode: string;
  readonly path: string;
};
type BuilderResult = {
  readonly packageIdentity: FileIdentity;
  readonly stagingDirectory: string;
};
type GeneratedPresentation = {
  readonly files: readonly {
    readonly bytes: Buffer;
    readonly path: string;
  }[];
  readonly publicAssets: readonly JsonRecord[];
  readonly runtimeManifest: JsonRecord | null;
};
type BuilderModule = {
  readonly NORMALIZED_WATCH_LAYER_INPUTS_PATH: string;
  readonly STAGED_WATCH_LAYER_PACKAGE_PATH: string;
  readonly WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH: string;
  readonly WATCH_LAYER_BUILD_METADATA_PATH: string;
  readonly WATCH_LAYER_RUNTIME_MANIFEST_PATH: string;
  buildWatchLayerAssets(options: {
    readonly beforeStageCommit?: () => Promise<void> | void;
    readonly projectRoot: string;
    readonly stagingDirectory: string;
  }): Promise<BuilderResult>;
  generateWatchLayerPresentationProfiles(options: JsonRecord): Promise<GeneratedPresentation>;
};
type ContractModule = {
  readonly APPROVAL_RECORD_SCHEMA: StrictSchema;
  readonly APPROVED_MASTER_IDENTITY: JsonRecord;
  readonly AUTHORING_DOCUMENT_SCHEMA: StrictSchema;
  readonly AUTHORING_INTERPRETATION_NOTICE: string;
  readonly CANONICAL_IDENTITY_MATRIX: JsonRecord;
  readonly CANONICAL_PROJECT_PATHS: Readonly<Record<string, string>>;
  readonly CANONICAL_SOURCE_COORDINATE_SPACE: {
    readonly height: number;
    readonly width: number;
  };
  readonly ENHANCEMENT_BUDGETS: JsonRecord;
  readonly LAYER_ASSET_MANIFEST_SCHEMA: StrictSchema;
  readonly LAYER_RECORD_SCHEMA: StrictSchema;
  readonly MOTION_PROFILE_SCHEMA: StrictSchema;
  readonly PHASE_NAMES: readonly string[];
  readonly PHASE_RECORD_SCHEMA: StrictSchema;
  readonly PREDECESSOR_MANIFEST_IDENTITY: JsonRecord;
  readonly RELEASE_POINTER_SCHEMA: StrictSchema;
  readonly RUNTIME_MANIFEST_SCHEMA: StrictSchema;
  serializeCanonicalJson(value: unknown): Buffer;
  serializeCanonicalJsonLine(value: unknown): Buffer;
};
type LoaderModule = {
  loadWatchLayerAuthoring(options: { readonly projectRoot: string }): Promise<{
    readonly approvedMovingLayerIds: readonly string[];
    readonly normalized: {
      readonly approvals: readonly JsonRecord[];
      readonly layers: readonly JsonRecord[];
      readonly masks: readonly JsonRecord[];
      readonly motionProfiles: readonly JsonRecord[];
      readonly provenance: readonly JsonRecord[];
      readonly reconstructions: readonly JsonRecord[];
      readonly relationships: readonly JsonRecord[];
    };
  }>;
};
type ManifestClosureModule = {
  hashPhaseProjection(packageId: string, phase: JsonRecord): string;
};
type ApprovalToolsModule = {
  createReviewSetApprovalExpectation(options: {
    readonly approvalId: string;
    readonly evidenceIndexSha256: string;
    readonly reviewSet: JsonRecord;
  }): JsonRecord;
};
type RenderedLayerEvidence = {
  readonly indexIdentity: FileIdentity;
  readonly outputs: readonly {
    readonly bytes: Buffer;
    readonly path: string;
  }[];
  readonly reviewSets: readonly JsonRecord[];
};
type ReviewEvidenceModule = {
  readonly LAYER_REVIEW_EVIDENCE_INDEX_PATH: string;
  renderLayerReviewEvidence(options: JsonRecord): Promise<RenderedLayerEvidence>;
};
type ProfileBudgetModule = {
  evaluateWatchLayerProfileBudget(options: JsonRecord): {
    readonly issueCode: string | null;
    readonly ok: boolean;
    readonly profiles: Readonly<Record<string, JsonRecord>> | null;
  };
};
type PublisherModule = {
  readonly WATCH_LAYER_PUBLICATION_STEPS: readonly string[];
  readonly WATCH_LAYER_RELEASE_HISTORY_PATH: string;
  publishWatchLayerAssets(options: {
    readonly projectRoot: string;
    readonly stagingDirectory: string;
    readonly testHooks?: {
      readonly onStep?: (step: string) => Promise<void> | void;
    };
  }): Promise<{
    readonly recoveredStaleState: boolean;
    readonly releaseStatus: "fallback-only" | "ready";
    readonly selectedPhase: string | null;
    readonly verification: { readonly ok: true };
  }>;
};
type VerifierModule = {
  readonly WATCH_LAYER_GATE_ORDER: readonly string[];
  readonly WATCH_LAYER_VERIFY_ISSUE_CODES: Readonly<Record<string, string>>;
  verifyWatchLayerAssets(options: { readonly projectRoot: string }): Promise<{
    readonly approvedMovingLayerIds: readonly string[];
    readonly completedGates: readonly string[];
    readonly networkRequests: 0;
    readonly ok: true;
    readonly releaseStatus: "fallback-only" | "ready";
    readonly selectedPhase: string | null;
    readonly writes: 0;
  }>;
  withWatchLayerVerifierSandbox<T>(operation: () => Promise<T> | T): Promise<T>;
};
type MaskFixture = {
  readonly alphaSum: number;
  readonly bytes: Buffer;
  readonly nonZeroPixelCount: number;
  readonly tightBounds: JsonRecord;
};
type MovingRasterTemplate = {
  readonly boundary: MaskFixture;
  readonly fill: Buffer;
  readonly region: MaskFixture;
  readonly segmentation: MaskFixture;
};
type ReadyTemplate = {
  readonly approvals: readonly JsonRecord[];
  readonly authoringBytes: Buffer;
  readonly evidenceBytes: Buffer;
  readonly packageBytes: Buffer;
  readonly packageManifest: JsonRecord;
  readonly publicFiles: readonly {
    readonly bytes: Buffer;
    readonly path: string;
  }[];
  readonly releaseBytes: Buffer;
  readonly runtimeBytes: Buffer;
  readonly runtimeIdentity: JsonRecord;
  readonly runtimeManifest: JsonRecord;
};

// @ts-expect-error -- executable ESM modules are explicitly typed above.
const approvalTools = (await import("../../scripts/watch-2-5d/approval-records.mjs")) as unknown as ApprovalToolsModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const builder = (await import("../../scripts/build-watch-layer-assets.mjs")) as unknown as BuilderModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const loader = (await import("../../scripts/watch-2-5d/authoring-loader.mjs")) as unknown as LoaderModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const manifestClosure = (await import("../../scripts/watch-2-5d/manifest-closure.mjs")) as unknown as ManifestClosureModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const profileBudget = (await import("../../scripts/watch-2-5d/profile-budget.mjs")) as unknown as ProfileBudgetModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const publisher = (await import("../../scripts/publish-watch-layer-assets.mjs")) as unknown as PublisherModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const reviewEvidence = (await import("../../scripts/watch-2-5d/review-evidence.mjs")) as unknown as ReviewEvidenceModule;
// @ts-expect-error -- executable ESM modules are explicitly typed above.
const verifier = (await import("../../scripts/verify-watch-layer-assets.mjs")) as unknown as VerifierModule;

const PROJECT_ROOT = process.cwd();
const PACKAGE_ID = "watch-layer-package";
const SOURCE_DATE_EPOCH = 1_700_000_000;
const WIDTH = contract.CANONICAL_SOURCE_COORDINATE_SPACE.width;
const HEIGHT = contract.CANONICAL_SOURCE_COORDINATE_SPACE.height;
const PIXEL_COUNT = WIDTH * HEIGHT;
const HASH_ZERO = "0".repeat(64);
const APPROVAL_DIRECTORY = contract.CANONICAL_PROJECT_PATHS.successorApprovalsDirectory;
const MASK_DIRECTORY = contract.CANONICAL_PROJECT_PATHS.successorMasksDirectory;
const RECONSTRUCTION_DIRECTORY = contract.CANONICAL_PROJECT_PATHS.successorReconstructionDirectory;
const REVIEW_DIRECTORY = contract.CANONICAL_PROJECT_PATHS.successorReviewDirectory;
const SEGMENTATION_PATH = `${MASK_DIRECTORY}/wheel-segmentation.png`;
const REGION_PATH = `${MASK_DIRECTORY}/wheel-reconstruction-region.png`;
const BOUNDARY_PATH = `${MASK_DIRECTORY}/wheel-reconstruction-boundary.png`;
const FILL_PATH = `${RECONSTRUCTION_DIRECTORY}/wheel-fill.png`;
const PROTECTED_SPEC_PATH = `${contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory}/design.md`;
const BASELINE_COPY_PATHS = [
  contract.CANONICAL_PROJECT_PATHS.historicalSpecDirectory,
  contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
  contract.CANONICAL_PROJECT_PATHS.globalsCss,
  contract.CANONICAL_PROJECT_PATHS.protectedCanvas,
  contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
  contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
  contract.CANONICAL_PROJECT_PATHS.predecessorPublicAssetsDirectory,
  contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
  "tests/fixtures/glass-header-hover-preservation.sha256",
] as const;
const GUARDED_STATE_PATHS = [
  contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
  contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
  PROTECTED_SPEC_PATH,
  contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory,
  contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
  contract.CANONICAL_PROJECT_PATHS.successorRelease,
  contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
] as const;

const temporaryRoots = new Set<string>();
let baseEvidenceIndex: JsonRecord;
let movingRasterTemplate: MovingRasterTemplate;
let readyTemplate: ReadyTemplate;
let oldReadyTemplate: ReadyTemplate;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function identity(path: string, bytes: Uint8Array): FileIdentity {
  return { byteLength: bytes.byteLength, path, sha256: sha256(bytes) };
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

async function pathExists(path: string): Promise<boolean> {
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

async function writeProjectFile(
  projectRoot: string,
  projectPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const target = resolve(projectRoot, projectPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function copyProjectMember(projectRoot: string, projectPath: string): Promise<void> {
  const target = resolve(projectRoot, projectPath);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(PROJECT_ROOT, projectPath), target, { recursive: true });
}

async function createBaselineProject(prefix: string): Promise<string> {
  const owner = await temporaryRoot(prefix);
  const projectRoot = resolve(owner, "project");
  await mkdir(projectRoot);
  for (const path of BASELINE_COPY_PATHS) await copyProjectMember(projectRoot, path);
  return projectRoot;
}

async function cloneProject(projectRoot: string, prefix: string): Promise<string> {
  const owner = await temporaryRoot(prefix);
  const clone = resolve(owner, "project");
  await cp(projectRoot, clone, { recursive: true });
  return clone;
}

async function collectFileIdentities(
  root: string,
  relativePath = "",
): Promise<readonly string[]> {
  const absolute = relativePath ? resolve(root, relativePath) : root;
  let stats;
  try {
    stats = await lstat(absolute);
  } catch (error) {
    if (
      error !== null
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) return [`${relativePath}:absent`];
    throw error;
  }
  if (stats.isFile()) {
    const bytes = await readFile(absolute);
    return [`${relativePath}:file:${bytes.byteLength}:${sha256(bytes)}`];
  }
  const values = [`${relativePath}:directory`];
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    values.push(...await collectFileIdentities(root, child));
  }
  return values;
}

async function captureGuardedState(projectRoot: string): Promise<readonly string[]> {
  const values: string[] = [];
  for (const path of GUARDED_STATE_PATHS) {
    values.push(...await collectFileIdentities(projectRoot, path));
  }
  return values.sort(lexicalCompare);
}

async function captureFailure(projectRoot: string): Promise<VerificationFailure> {
  try {
    await verifier.verifyWatchLayerAssets({ projectRoot });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as VerificationFailure;
  }
  throw new Error("Expected watch-layer verification to fail");
}

async function captureOperationFailure(
  operation: () => Promise<unknown> | unknown,
): Promise<VerificationFailure> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as VerificationFailure;
  }
  throw new Error("Expected watch-layer operation to fail");
}

async function appendTamper(projectRoot: string, projectPath: string): Promise<void> {
  const path = resolve(projectRoot, projectPath);
  await writeFile(path, Buffer.concat([await readFile(path), Buffer.from(" ")]));
}

function buildPhase(
  name: string,
  ordinal: number,
  status: "approved" | "disabled",
  options: {
    readonly approvalId?: string;
    readonly assetSha256?: readonly string[];
    readonly runtimeManifestSha256?: string | null;
  } = {},
): JsonRecord {
  const unhashed: JsonRecord = {
    ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId }),
    assetSha256: [...(options.assetSha256 ?? [])].sort(lexicalCompare),
    name,
    ordinal,
    phasePayloadSha256: HASH_ZERO,
    runtimeManifestSha256: options.runtimeManifestSha256 ?? null,
    status,
  };
  return contract.PHASE_RECORD_SCHEMA.parse({
    ...unhashed,
    phasePayloadSha256: manifestClosure.hashPhaseProjection(PACKAGE_ID, unhashed),
  });
}

function fallbackPhases(): readonly JsonRecord[] {
  return contract.PHASE_NAMES.map((name, ordinal) => buildPhase(
    name,
    ordinal,
    ordinal === 0 ? "approved" : "disabled",
  ));
}

function approvalRecord(options: {
  readonly artifactSha256: readonly string[];
  readonly id: string;
  readonly layerIds?: readonly string[];
  readonly reviewedPoseIds?: readonly string[];
  readonly reviewedZoomPercent: readonly number[];
  readonly scope: string;
}): JsonRecord {
  return contract.APPROVAL_RECORD_SCHEMA.parse({
    artifactSha256: [...new Set(options.artifactSha256)].sort(lexicalCompare),
    decision: "approved",
    id: options.id,
    layerIds: options.layerIds ?? [],
    notes: `Exact ${options.scope} integration fixture review.`,
    reviewedAt: "2026-05-20T12:00:00.000Z",
    reviewedPoseIds: options.reviewedPoseIds ?? ["reference-pose"],
    reviewedZoomPercent: options.reviewedZoomPercent,
    reviewer: "integration-fixture-reviewer",
    scope: options.scope,
  });
}

function approvalFromReviewSet(
  rendered: RenderedLayerEvidence,
  approvalId: string,
  reviewSetId: string,
): JsonRecord {
  const reviewSet = rendered.reviewSets.find(({ id }) => id === reviewSetId);
  if (reviewSet === undefined) throw new Error(`Missing review set ${reviewSetId}`);
  const expectation = approvalTools.createReviewSetApprovalExpectation({
    approvalId,
    evidenceIndexSha256: rendered.indexIdentity.sha256,
    reviewSet,
  });
  return approvalRecord({
    artifactSha256: expectation.artifactSha256 as readonly string[],
    id: approvalId,
    layerIds: expectation.layerIds as readonly string[],
    reviewedPoseIds: expectation.reviewedPoseIds as readonly string[],
    reviewedZoomPercent: expectation.reviewedZoomPercent as readonly number[],
    scope: String(expectation.scope),
  });
}

function provenanceRecord(options: {
  readonly artifactId: string;
  readonly artifactSha256: string;
  readonly classification: "source-derived" | "synthetic";
  readonly id: string;
  readonly immediateParentSha256: readonly string[];
  readonly method: string;
}): JsonRecord {
  return {
    artifactId: options.artifactId,
    artifactSha256: options.artifactSha256,
    classification: options.classification,
    createdAt: "2026-05-20T11:00:00.000Z",
    id: options.id,
    immediateParentSha256: [...options.immediateParentSha256].sort(lexicalCompare),
    method: options.method,
    operator: "integration-fixture-author",
    settings: { deterministic: true },
    tool: { name: "watch-layer-integration-fixture", version: "1.0.0" },
  };
}

function authoringDocument(overrides: JsonRecord): JsonRecord {
  return {
    approvals: [],
    approvedMovingLayerIds: [],
    authoredInterpretation: true,
    candidateInventory: [],
    canonicalMaster: structuredClone(contract.APPROVED_MASTER_IDENTITY),
    depthEnabled: false,
    depthProfiles: [],
    interpretationNotice: contract.AUTHORING_INTERPRETATION_NOTICE,
    layers: [],
    masks: [],
    motionProfiles: [],
    packageId: PACKAGE_ID,
    packageVersion: "1.0.0",
    parentSpec: contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    phases: fallbackPhases(),
    predecessorContract: structuredClone(contract.PREDECESSOR_MANIFEST_IDENTITY),
    provenance: [],
    reconstructions: [],
    relationships: [],
    schemaVersion: 1,
    sourceCoordinateSpace: structuredClone(contract.CANONICAL_SOURCE_COORDINATE_SPACE),
    sourceDateEpoch: SOURCE_DATE_EPOCH,
    ...overrides,
  };
}

function evidenceIndexBytes(authoringBytes: Buffer): Buffer {
  const index = structuredClone(baseEvidenceIndex);
  index.authoring = identity(
    contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
    authoringBytes,
  );
  return contract.serializeCanonicalJsonLine(index);
}

async function writeSuccessorSource(
  projectRoot: string,
  authoringBytes: Buffer,
  approvals: readonly JsonRecord[],
  artifactFiles: Readonly<Record<string, Buffer>> = {},
  evidenceOutputs: readonly { readonly bytes: Buffer; readonly path: string }[] = [],
): Promise<Buffer> {
  for (const directory of [
    APPROVAL_DIRECTORY,
    MASK_DIRECTORY,
    RECONSTRUCTION_DIRECTORY,
    `${REVIEW_DIRECTORY}/layer-evidence`,
  ]) await mkdir(resolve(projectRoot, directory), { recursive: true });
  await writeProjectFile(
    projectRoot,
    contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
    authoringBytes,
  );
  let evidenceBytes: Buffer;
  if (evidenceOutputs.length === 0) {
    evidenceBytes = evidenceIndexBytes(authoringBytes);
    await writeProjectFile(
      projectRoot,
      `${REVIEW_DIRECTORY}/layer-evidence/index.json`,
      evidenceBytes,
    );
  } else {
    const indexOutput = evidenceOutputs.find(({ path }) => (
      path === reviewEvidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH
    ));
    if (indexOutput === undefined) throw new Error("Evidence renderer omitted its index");
    evidenceBytes = Buffer.from(indexOutput.bytes);
    for (const output of evidenceOutputs) {
      await writeProjectFile(projectRoot, output.path, output.bytes);
    }
  }
  for (const approval of approvals) {
    await writeProjectFile(
      projectRoot,
      `${APPROVAL_DIRECTORY}/${String(approval.id)}.json`,
      contract.APPROVAL_RECORD_SCHEMA.serializeLine(approval),
    );
  }
  for (const [path, bytes] of Object.entries(artifactFiles)) {
    await writeProjectFile(projectRoot, path, bytes);
  }
  return evidenceBytes;
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

function grayscaleMask(
  samples: readonly (readonly [number, number, number])[],
): MaskFixture {
  const raw = Buffer.alloc(PIXEL_COUNT);
  for (const [x, y, alpha] of samples) raw[y * WIDTH + x] = alpha;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 0;
  const scanlines = Buffer.alloc((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    raw.copy(scanlines, y * (WIDTH + 1) + 1, y * WIDTH, (y + 1) * WIDTH);
  }
  const nonzero = samples.filter(([, , alpha]) => alpha !== 0);
  const xs = nonzero.map(([x]) => x);
  const ys = nonzero.map(([, y]) => y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  return {
    alphaSum: nonzero.reduce((total, [, , alpha]) => total + alpha, 0),
    bytes: Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
    nonZeroPixelCount: nonzero.length,
    tightBounds: {
      height: maximumY - minimumY + 1,
      width: maximumX - minimumX + 1,
      x: minimumX,
      y: minimumY,
    },
  };
}

async function reconstructionFill(): Promise<Buffer> {
  const raw = Buffer.alloc(PIXEL_COUNT * 4);
  for (const [index, x] of [100, 101, 102].entries()) {
    const offset = (100 * WIDTH + x) * 4;
    raw[offset] = 60 + index;
    raw[offset + 1] = 80 + index;
    raw[offset + 2] = 120 + index;
    raw[offset + 3] = 255;
  }
  return sharp(raw, {
    limitInputPixels: PIXEL_COUNT,
    raw: { channels: 4, height: HEIGHT, width: WIDTH },
  }).png({
    adaptiveFiltering: false,
    compressionLevel: 9,
    palette: false,
    progressive: false,
  }).toBuffer();
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
    sha256: sha256(fixture.bytes),
    tightBounds: fixture.tightBounds,
    width: WIDTH,
  };
}

async function createMovingFallbackProject(): Promise<string> {
  const projectRoot = await createBaselineProject("watch-layer-moving-integration-");
  const segmentation = maskRecord(
    "mask-wheel-segmentation",
    SEGMENTATION_PATH,
    movingRasterTemplate.segmentation,
    "provenance-wheel-segmentation",
  );
  const region = maskRecord(
    "mask-wheel-reconstruction-region",
    REGION_PATH,
    movingRasterTemplate.region,
    "provenance-wheel-region",
  );
  const boundary = maskRecord(
    "mask-wheel-reconstruction-boundary",
    BOUNDARY_PATH,
    movingRasterTemplate.boundary,
    "provenance-wheel-boundary",
  );
  const fillHash = sha256(movingRasterTemplate.fill);
  const layer: JsonRecord = {
    approvalIds: [
      "approval-segmentation",
      "approval-pivot",
      "approval-reconstruction",
      "approval-fidelity",
    ],
    disposition: "approved-moving",
    id: "layer-wheel",
    motionProfileId: "motion-wheel",
    pivot: { x: 100.5, y: 100.5 },
    provenanceIds: ["provenance-layer-wheel"],
    reconstructedPixelCount: movingRasterTemplate.region.nonZeroPixelCount,
    referenceTransform: structuredClone(contract.CANONICAL_IDENTITY_MATRIX),
    segmentationMaskId: "mask-wheel-segmentation",
    semanticClass: "exposed-gear",
    sourceRect: { height: 3, width: 5, x: 99, y: 99 },
    sourceVisiblePixelCount: movingRasterTemplate.segmentation.nonZeroPixelCount,
    zOrder: 10,
  };
  const layerHash = sha256(contract.LAYER_RECORD_SCHEMA.serialize(layer));
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
  const motionHash = sha256(contract.MOTION_PROFILE_SCHEMA.serialize(motion));
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
    syntheticPixelCount: movingRasterTemplate.region.nonZeroPixelCount,
  };
  const segmentationHash = String(segmentation.sha256);
  const regionHash = String(region.sha256);
  const boundaryHash = String(boundary.sha256);
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
      id: "provenance-wheel-region",
      immediateParentSha256: [String(contract.APPROVED_MASTER_IDENTITY.sha256)],
      method: "manual-mask",
    }),
    provenanceRecord({
      artifactId: "mask-wheel-reconstruction-boundary",
      artifactSha256: boundaryHash,
      classification: "synthetic",
      id: "provenance-wheel-boundary",
      immediateParentSha256: [regionHash],
      method: "deterministic-generation",
    }),
    provenanceRecord({
      artifactId: "fill-wheel",
      artifactSha256: fillHash,
      classification: "synthetic",
      id: "provenance-fill-wheel",
      immediateParentSha256: [boundaryHash, regionHash],
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
  const phases = fallbackPhases();
  const authoring = contract.AUTHORING_DOCUMENT_SCHEMA.parse(authoringDocument({
    approvedMovingLayerIds: ["layer-wheel"],
    layers: [layer],
    masks: [segmentation, region, boundary],
    motionProfiles: [motion],
    phases,
    provenance,
    reconstructions: [reconstruction],
  }));
  const authoringBytes = contract.AUTHORING_DOCUMENT_SCHEMA.serializeLine(authoring);
  const sourceBytes = await readFile(resolve(
    projectRoot,
    contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
  ));
  const renderedEvidence = await reviewEvidence.renderLayerReviewEvidence({
    authoringIdentity: identity(
      contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
      authoringBytes,
    ),
    layers: [layer],
    masks: [
      { bytes: movingRasterTemplate.segmentation.bytes, record: segmentation },
      { bytes: movingRasterTemplate.region.bytes, record: region },
      { bytes: movingRasterTemplate.boundary.bytes, record: boundary },
    ],
    motionProfiles: [motion],
    reconstructions: [{ fillBytes: movingRasterTemplate.fill, record: reconstruction }],
    sourceBytes,
    sourceHeight: HEIGHT,
    sourceIdentity: identity(
      contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
      sourceBytes,
    ),
    sourceWidth: WIDTH,
  });
  const scopedApprovals = [
    approvalFromReviewSet(
      renderedEvidence,
      "approval-segmentation",
      "layer-wheel-segmentation",
    ),
    approvalFromReviewSet(renderedEvidence, "approval-pivot", "layer-wheel-pivot"),
    approvalFromReviewSet(
      renderedEvidence,
      "approval-reconstruction",
      "layer-wheel-reconstruction",
    ),
    approvalFromReviewSet(
      renderedEvidence,
      "approval-motion",
      "layer-wheel-motion-wheel-motion",
    ),
    approvalFromReviewSet(renderedEvidence, "approval-fidelity", "layer-wheel-fidelity"),
  ];
  const approvals = [
    ...scopedApprovals,
    approvalRecord({
      artifactSha256: scopedApprovals.flatMap((record) => (
        record.artifactSha256 as readonly string[]
      )),
      id: "approval-release",
      layerIds: ["layer-wheel"],
      reviewedPoseIds: [...new Set(scopedApprovals.flatMap((record) => (
        record.reviewedPoseIds as readonly string[]
      )))].sort(lexicalCompare),
      reviewedZoomPercent: [],
      scope: "release",
    }),
  ];
  await writeSuccessorSource(projectRoot, authoringBytes, approvals, {
    [BOUNDARY_PATH]: movingRasterTemplate.boundary.bytes,
    [FILL_PATH]: movingRasterTemplate.fill,
    [REGION_PATH]: movingRasterTemplate.region.bytes,
    [SEGMENTATION_PATH]: movingRasterTemplate.segmentation.bytes,
  }, renderedEvidence.outputs);
  const loaded = await loader.loadWatchLayerAuthoring({ projectRoot });
  if (loaded.approvedMovingLayerIds.join(",") !== "layer-wheel") {
    throw new Error("Authored integration fixture did not close its moving layer");
  }
  const packageManifest = contract.LAYER_ASSET_MANIFEST_SCHEMA.parse({
    approvals: loaded.normalized.approvals,
    budgets: contract.ENHANCEMENT_BUDGETS,
    canonicalMaster: contract.APPROVED_MASTER_IDENTITY,
    depthProfiles: [],
    layers: loaded.normalized.layers,
    masks: loaded.normalized.masks,
    motionProfiles: loaded.normalized.motionProfiles,
    packageId: PACKAGE_ID,
    packageVersion: "1.0.0",
    parentSpec: contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    phases,
    predecessorContract: contract.PREDECESSOR_MANIFEST_IDENTITY,
    provenance: loaded.normalized.provenance,
    publicAssets: [],
    reconstructions: loaded.normalized.reconstructions,
    relationships: loaded.normalized.relationships,
    runtimeManifest: null,
    schemaVersion: 1,
    sourceCoordinateSpace: contract.CANONICAL_SOURCE_COORDINATE_SPACE,
    sourceDateEpoch: SOURCE_DATE_EPOCH,
  });
  await writeProjectFile(
    projectRoot,
    contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    contract.LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(packageManifest),
  );
  await writeProjectFile(
    projectRoot,
    contract.CANONICAL_PROJECT_PATHS.successorRelease,
    contract.RELEASE_POINTER_SCHEMA.serializeLine({
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    }),
  );
  return projectRoot;
}

function assembleReadyTemplate(
  generated: GeneratedPresentation,
  releaseId: string,
  packageVersion: string,
): ReadyTemplate {
  if (generated.runtimeManifest === null) {
    throw new Error("Ready presentation fixture did not generate a runtime manifest");
  }
  const runtimeManifest = contract.RUNTIME_MANIFEST_SCHEMA.parse({
    ...structuredClone(generated.runtimeManifest),
    releaseId,
  });
  const runtimeBytes = contract.RUNTIME_MANIFEST_SCHEMA.serializeLine(runtimeManifest);
  const runtimeIdentity: JsonRecord = {
    byteLength: runtimeBytes.byteLength,
    file: builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH,
    mediaType: "application/json",
    publicPath: `/${builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH.slice("public/".length)}`,
    sha256: sha256(runtimeBytes),
  };
  const publicFiles: Array<{
    readonly bytes: Buffer<ArrayBufferLike>;
    readonly path: string;
  }> = generated.files
    .filter(({ path }) => path !== builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH)
    .map(({ bytes, path }) => ({ bytes: Buffer.from(bytes), path }));
  publicFiles.push({ bytes: runtimeBytes, path: builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH });
  publicFiles.sort((left, right) => lexicalCompare(left.path, right.path));
  const assetHashes = generated.publicAssets.map((asset) => String(asset.sha256));
  const phases = [
    buildPhase("source-preparation", 0, "approved"),
    buildPhase("static-layered-reconstruction", 1, "approved", {
      approvalId: "approval-release",
      assetSha256: assetHashes,
      runtimeManifestSha256: String(runtimeIdentity.sha256),
    }),
    buildPhase("approved-part-motion", 2, "disabled"),
    buildPhase("optional-depth", 3, "disabled"),
  ];
  const selectedPhase = phases[1];
  const releaseApproval = approvalRecord({
    artifactSha256: [
      String(selectedPhase.phasePayloadSha256),
      String(runtimeIdentity.sha256),
      ...assetHashes,
    ],
    id: "approval-release",
    reviewedZoomPercent: [],
    scope: "release",
  });
  const fidelityApproval = approvalRecord({
    artifactSha256: [
      String(contract.APPROVED_MASTER_IDENTITY.sha256),
      String(selectedPhase.phasePayloadSha256),
      String(runtimeIdentity.sha256),
      ...assetHashes,
    ],
    id: "approval-fidelity",
    reviewedZoomPercent: [100, 200],
    scope: "fidelity",
  });
  const approvals = [fidelityApproval, releaseApproval];
  const authoring = contract.AUTHORING_DOCUMENT_SCHEMA.parse(authoringDocument({
    packageVersion,
    phases,
  }));
  const authoringBytes = contract.AUTHORING_DOCUMENT_SCHEMA.serializeLine(authoring);
  const provenance = generated.publicAssets.map((asset) => provenanceRecord({
    artifactId: String(asset.id),
    artifactSha256: String(asset.sha256),
    classification: "source-derived",
    id: `provenance-${String(asset.id)}`,
    immediateParentSha256: [String(contract.APPROVED_MASTER_IDENTITY.sha256)],
    method: "deterministic-generation",
  }));
  const packageManifest = contract.LAYER_ASSET_MANIFEST_SCHEMA.parse({
    approvals,
    budgets: contract.ENHANCEMENT_BUDGETS,
    canonicalMaster: contract.APPROVED_MASTER_IDENTITY,
    depthProfiles: [],
    layers: [],
    masks: [],
    motionProfiles: [],
    packageId: PACKAGE_ID,
    packageVersion,
    parentSpec: contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    phases,
    predecessorContract: contract.PREDECESSOR_MANIFEST_IDENTITY,
    provenance,
    publicAssets: generated.publicAssets,
    reconstructions: [],
    relationships: [],
    runtimeManifest: runtimeIdentity,
    schemaVersion: 1,
    sourceCoordinateSpace: contract.CANONICAL_SOURCE_COORDINATE_SPACE,
    sourceDateEpoch: SOURCE_DATE_EPOCH,
  });
  const packageBytes = contract.LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(packageManifest);
  const releaseBytes = contract.RELEASE_POINTER_SCHEMA.serializeLine({
    depthEnabled: false,
    packageId: PACKAGE_ID,
    releaseId,
    runtimeManifest: {
      byteLength: runtimeBytes.byteLength,
      mediaType: "application/json",
      publicPath: String(runtimeIdentity.publicPath),
      sha256: String(runtimeIdentity.sha256),
    },
    schemaVersion: 1,
    status: "ready",
  });
  return {
    approvals,
    authoringBytes,
    evidenceBytes: evidenceIndexBytes(authoringBytes),
    packageBytes,
    packageManifest,
    publicFiles,
    releaseBytes,
    runtimeBytes,
    runtimeIdentity,
    runtimeManifest,
  };
}

async function createReadyProject(
  template: ReadyTemplate,
  currentStatus: "fallback-only" | "ready",
): Promise<string> {
  const projectRoot = await createBaselineProject("watch-layer-ready-integration-");
  await writeSuccessorSource(projectRoot, template.authoringBytes, template.approvals);
  if (currentStatus === "ready") {
    await writeProjectFile(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
      template.packageBytes,
    );
    for (const file of template.publicFiles) {
      await writeProjectFile(projectRoot, file.path, file.bytes);
    }
    await writeProjectFile(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
      template.releaseBytes,
    );
  } else {
    await writeProjectFile(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
      contract.RELEASE_POINTER_SCHEMA.serializeLine({
        depthEnabled: false,
        runtimeManifest: null,
        schemaVersion: 1,
        status: "fallback-only",
      }),
    );
  }
  return projectRoot;
}

async function writeReadyStage(
  projectRoot: string,
  stage: string,
  template: ReadyTemplate,
): Promise<void> {
  await mkdir(stage);
  await writeProjectFile(stage, builder.STAGED_WATCH_LAYER_PACKAGE_PATH, template.packageBytes);
  for (const file of template.publicFiles) await writeProjectFile(stage, file.path, file.bytes);
  const snapshot = { files: [], snapshotSha256: HASH_ZERO };
  const snapshotBytes = contract.serializeCanonicalJsonLine(snapshot);
  await writeProjectFile(stage, builder.WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH, snapshotBytes);
  const authoringBytes = await readFile(resolve(
    projectRoot,
    contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
  ));
  const evidenceBytes = await readFile(resolve(
    projectRoot,
    `${REVIEW_DIRECTORY}/layer-evidence/index.json`,
  ));
  const packageIdentity = identity(builder.STAGED_WATCH_LAYER_PACKAGE_PATH, template.packageBytes);
  const snapshotIdentity = identity(builder.WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH, snapshotBytes);
  const phases = template.packageManifest.phases as readonly JsonRecord[];
  const metadata = {
    approvedMovingLayerIds: [],
    authoring: identity(contract.CANONICAL_PROJECT_PATHS.successorAuthoring, authoringBytes),
    buildKind: "isolated-package-stage",
    depthEnabled: false,
    evidenceIndex: identity(`${REVIEW_DIRECTORY}/layer-evidence/index.json`, evidenceBytes),
    generator: "scripts/build-watch-layer-assets.mjs",
    immutableInputSnapshot: {
      file: snapshotIdentity,
      snapshotSha256: HASH_ZERO,
    },
    mode: "reference-pose",
    normalizedInputs: {
      byteLength: 0,
      path: builder.NORMALIZED_WATCH_LAYER_INPUTS_PATH,
      sha256: HASH_ZERO,
    },
    package: packageIdentity,
    phaseProjections: phases.map((phase) => ({
      name: phase.name,
      ordinal: phase.ordinal,
      phasePayloadSha256: phase.phasePayloadSha256,
      status: phase.status,
    })),
    predecessor: {
      derivativeCount: 10,
      manifestSha256: contract.PREDECESSOR_MANIFEST_IDENTITY.sha256,
      masterSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
    },
    publicAssets: template.packageManifest.publicAssets,
    releaseStatus: "ready",
    runtimeManifest: template.runtimeIdentity,
    schemaVersion: 1,
    sourceDateEpoch: SOURCE_DATE_EPOCH,
  };
  await writeProjectFile(
    stage,
    builder.WATCH_LAYER_BUILD_METADATA_PATH,
    contract.serializeCanonicalJsonLine(metadata),
  );
}

async function createPublicationFixture(template: ReadyTemplate): Promise<{
  readonly projectRoot: string;
  readonly stage: string;
}> {
  const projectRoot = await createReadyProject(template, "fallback-only");
  const stage = resolve(dirname(projectRoot), "stage");
  await writeReadyStage(projectRoot, stage, template);
  const releaseHistory = {
    releases: [{
      approvalStatus: "approved",
      depthEnabled: false,
      packageId: PACKAGE_ID,
      packageSha256: sha256(template.packageBytes),
      packageVersion: String(template.packageManifest.packageVersion),
      phase: "static-layered-reconstruction",
      releaseId: String(template.runtimeManifest.releaseId),
      releaseStatus: "ready",
      runtimeManifestSha256: String(template.runtimeIdentity.sha256),
    }],
    schemaVersion: 1,
  };
  await writeProjectFile(
    projectRoot,
    publisher.WATCH_LAYER_RELEASE_HISTORY_PATH,
    contract.serializeCanonicalJsonLine(releaseHistory),
  );
  return { projectRoot, stage };
}

async function createBuilderFixture(priorPackageBytes?: Buffer): Promise<string> {
  const owner = await temporaryRoot("watch-layer-builder-integration-");
  const projectRoot = resolve(owner, "project");
  await mkdir(projectRoot);
  for (const path of [
    contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
    contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
    contract.CANONICAL_PROJECT_PATHS.predecessorPublicAssetsDirectory,
    contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
    contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory,
    contract.CANONICAL_PROJECT_PATHS.successorRelease,
  ]) await copyProjectMember(projectRoot, path);
  if (priorPackageBytes !== undefined) {
    await writeProjectFile(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
      priorPackageBytes,
    );
    await mkdir(resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    ), { recursive: true });
  }
  return projectRoot;
}

beforeAll(async () => {
  baseEvidenceIndex = JSON.parse(await readFile(
    resolve(PROJECT_ROOT, `${REVIEW_DIRECTORY}/layer-evidence/index.json`),
    "utf8",
  )) as JsonRecord;
  movingRasterTemplate = {
    boundary: grayscaleMask([
      [100, 100, 255],
      [101, 100, 255],
      [102, 100, 255],
      [103, 100, 255],
    ]),
    fill: await reconstructionFill(),
    region: grayscaleMask([
      [100, 100, 255],
      [101, 100, 255],
      [102, 100, 255],
    ]),
    segmentation: grayscaleMask([
      [100, 100, 255],
      [101, 100, 128],
    ]),
  };
  const sourceBytes = await readFile(resolve(
    PROJECT_ROOT,
    contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
  ));
  const decoded = await sharp(sourceBytes, {
    failOn: "error",
    limitInputPixels: PIXEL_COUNT,
    sequentialRead: true,
  }).toColourspace("srgb").ensureAlpha().raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  const source = {
    data: decoded.data,
    height: decoded.info.height,
    width: decoded.info.width,
  };
  const generated = await builder.generateWatchLayerPresentationProfiles({
    approvedMovingLayerIds: [],
    approvedStaticOccluderLayerIds: [],
    canonicalSource: source,
    layerInputs: [],
    motionProfiles: [],
    packageId: PACKAGE_ID,
    reconstructedBackground: source,
    releaseId: "generated-template",
    selectedPhase: "static-layered-reconstruction",
  });
  readyTemplate = assembleReadyTemplate(generated, "release-new", "1.0.0");
  oldReadyTemplate = assembleReadyTemplate(generated, "release-old", "0.9.0");
}, 120_000);

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("deterministic builder/verifier integration", () => {
  it("rebuilds equivalent isolated stages and leaves real verifier inputs hash-identical", async () => {
    const realBefore = await captureGuardedState(PROJECT_ROOT);
    const realVerification = await verifier.verifyWatchLayerAssets({ projectRoot: PROJECT_ROOT });
    expect(realVerification).toMatchObject({
      approvedMovingLayerIds: [],
      completedGates: verifier.WATCH_LAYER_GATE_ORDER,
      networkRequests: 0,
      ok: true,
      releaseStatus: "fallback-only",
      selectedPhase: null,
      writes: 0,
    });
    expect(await captureGuardedState(PROJECT_ROOT)).toEqual(realBefore);

    const projectRoot = await createBuilderFixture();
    const stageOwner = await temporaryRoot("watch-layer-rebuild-equivalence-");
    const first = await builder.buildWatchLayerAssets({
      projectRoot,
      stagingDirectory: resolve(stageOwner, "first"),
    });
    const second = await builder.buildWatchLayerAssets({
      projectRoot,
      stagingDirectory: resolve(stageOwner, "second"),
    });
    expect(await collectFileIdentities(second.stagingDirectory))
      .toEqual(await collectFileIdentities(first.stagingDirectory));
    expect(second.packageIdentity).toEqual(first.packageIdentity);
    const stagedPackage = contract.LAYER_ASSET_MANIFEST_SCHEMA.parseJson(
      await readFile(resolve(first.stagingDirectory, builder.STAGED_WATCH_LAYER_PACKAGE_PATH)),
      { allowTrailingNewline: true, requireCanonical: true },
    );
    expect(stagedPackage).toMatchObject({
      approvals: [],
      layers: [],
      motionProfiles: [],
      publicAssets: [],
      runtimeManifest: null,
    });
    expect(await pathExists(resolve(
      first.stagingDirectory,
      builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH,
    ))).toBe(false);
    expect((await loader.loadWatchLayerAuthoring({ projectRoot })).approvedMovingLayerIds)
      .toEqual([]);
    expect(await pathExists(resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    ))).toBe(false);
    expect(await pathExists(resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    ))).toBe(false);
  }, 120_000);

  it("removes an interrupted stage while preserving every preexisting current output", async () => {
    const priorPackage = Buffer.from("preexisting-package-output\n");
    const projectRoot = await createBuilderFixture(priorPackage);
    const normalizedPath = resolve(projectRoot, builder.NORMALIZED_WATCH_LAYER_INPUTS_PATH);
    const releasePath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    );
    const packagePath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    );
    const publicPath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    );
    const releaseBefore = await readFile(releasePath);
    const stageOwner = await temporaryRoot("watch-layer-preserve-output-");
    const stage = resolve(stageOwner, "candidate");

    await expect(builder.buildWatchLayerAssets({
      beforeStageCommit: async () => {
        await appendTamper(projectRoot, builder.NORMALIZED_WATCH_LAYER_INPUTS_PATH);
      },
      projectRoot,
      stagingDirectory: stage,
    })).rejects.toMatchObject({ code: "LAYER_INPUT_CHANGED" });

    expect(await pathExists(stage)).toBe(false);
    expect(await readFile(packagePath)).toEqual(priorPackage);
    expect(await readFile(releasePath)).toEqual(releaseBefore);
    expect(await readdir(publicPath)).toEqual([]);
    expect((await readFile(normalizedPath)).at(-1)).toBe(32);
  }, 120_000);

  it("accepts a closed authored package, then rejects ordered source and artifact tampering without writes", async () => {
    const golden = await createMovingFallbackProject();
    await expect(verifier.verifyWatchLayerAssets({ projectRoot: golden }))
      .resolves.toMatchObject({
        approvedMovingLayerIds: ["layer-wheel"],
        ok: true,
        releaseStatus: "fallback-only",
        writes: 0,
      });
    const evidenceIndex = JSON.parse(await readFile(
      resolve(golden, reviewEvidence.LAYER_REVIEW_EVIDENCE_INDEX_PATH),
      "utf8",
    )) as JsonRecord;
    const firstEvidencePath = String(
      (evidenceIndex.artifacts as readonly JsonRecord[])[0]?.path,
    );
    expect(firstEvidencePath).not.toBe("undefined");

    const scenarios: readonly {
      readonly expectedCode: string;
      readonly name: string;
      readonly mutate: (projectRoot: string) => Promise<void>;
    }[] = [
      {
        expectedCode: "LAYER_SCHEMA_INVALID",
        name: "successor authored source",
        mutate: (root) => appendTamper(root, contract.CANONICAL_PROJECT_PATHS.successorAuthoring),
      },
      {
        expectedCode: "LAYER_PREDECESSOR_INVALID",
        name: "canonical master",
        mutate: (root) => appendTamper(root, contract.CANONICAL_PROJECT_PATHS.canonicalMaster),
      },
      {
        expectedCode: "LAYER_PROTECTED_ARTIFACT_CHANGED",
        name: "predecessor manifest",
        mutate: (root) => appendTamper(root, contract.CANONICAL_PROJECT_PATHS.predecessorManifest),
      },
      {
        expectedCode: "LAYER_PROTECTED_ARTIFACT_CHANGED",
        name: "protected predecessor specification",
        mutate: (root) => appendTamper(root, PROTECTED_SPEC_PATH),
      },
      {
        expectedCode: "LAYER_SCHEMA_INVALID",
        name: "package manifest",
        mutate: (root) => appendTamper(root, contract.CANONICAL_PROJECT_PATHS.successorPackageManifest),
      },
      {
        expectedCode: "LAYER_PROVENANCE_INVALID",
        name: "reviewer approval",
        mutate: async (root) => {
          const path = `${APPROVAL_DIRECTORY}/approval-segmentation.json`;
          const approval = contract.APPROVAL_RECORD_SCHEMA.parseJson(
            await readFile(resolve(root, path)),
            { allowTrailingNewline: true, requireCanonical: true },
          );
          const tamperedApproval = {
            ...approval,
            notes: "Tampered after package construction.",
          };
          await writeProjectFile(
            root,
            path,
            contract.APPROVAL_RECORD_SCHEMA.serializeLine(tamperedApproval),
          );
        },
      },
      {
        expectedCode: "LAYER_PROVENANCE_INVALID",
        name: "review evidence artifact",
        mutate: (root) => appendTamper(root, firstEvidencePath),
      },
      {
        expectedCode: "LAYER_IDENTITY_MISMATCH",
        name: "segmentation mask",
        mutate: (root) => appendTamper(root, SEGMENTATION_PATH),
      },
      {
        expectedCode: "LAYER_IDENTITY_MISMATCH",
        name: "reconstruction fill",
        mutate: (root) => appendTamper(root, FILL_PATH),
      },
    ];

    for (const scenario of scenarios) {
      const projectRoot = await cloneProject(golden, `watch-layer-tamper-${scenario.name.replaceAll(" ", "-")}-`);
      await scenario.mutate(projectRoot);
      const before = await captureGuardedState(projectRoot);
      const failure = await captureFailure(projectRoot);
      expect(failure.code, scenario.name).toBe(scenario.expectedCode);
      expect(await captureGuardedState(projectRoot), scenario.name).toEqual(before);
    }
  }, 180_000);

  it("rejects incompatible old/new runtime manifests and finalized public-byte tampering at the public gate", async () => {
    const golden = await createReadyProject(readyTemplate, "ready");
    await expect(verifier.verifyWatchLayerAssets({ projectRoot: golden }))
      .resolves.toMatchObject({ ok: true, releaseStatus: "ready", writes: 0 });

    const runtimeMismatch = await cloneProject(golden, "watch-layer-old-runtime-");
    await writeProjectFile(
      runtimeMismatch,
      builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH,
      oldReadyTemplate.runtimeBytes,
    );
    const runtimeBefore = await captureGuardedState(runtimeMismatch);
    const runtimeFailure = await captureFailure(runtimeMismatch);
    expect(runtimeFailure).toMatchObject({ code: "LAYER_IDENTITY_MISMATCH" });
    expect(await captureGuardedState(runtimeMismatch)).toEqual(runtimeBefore);

    const publicTamper = await cloneProject(golden, "watch-layer-public-tamper-");
    const publicAsset = (readyTemplate.packageManifest.publicAssets as readonly JsonRecord[])[0];
    await appendTamper(publicTamper, String(publicAsset.file));
    const publicBefore = await captureGuardedState(publicTamper);
    const publicFailure = await captureFailure(publicTamper);
    expect(publicFailure).toMatchObject({ code: "LAYER_IDENTITY_MISMATCH" });
    expect(await captureGuardedState(publicTamper)).toEqual(publicBefore);
  }, 180_000);

  it("sandboxes side effects and preserves fixed schema/provenance/public failure precedence", async () => {
    const sandboxRoot = await temporaryRoot("watch-layer-side-effect-sandbox-");
    const forbiddenPath = resolve(sandboxRoot, "forbidden.txt");
    const originalWriteFileSync = fs.writeFileSync;
    const originalFetch = globalThis.fetch;

    const writeFailure = await captureOperationFailure(() => (
      verifier.withWatchLayerVerifierSandbox(() => {
        fs.writeFileSync(forbiddenPath, "forbidden");
      })
    ));
    expect(writeFailure).toMatchObject({
      code: "LAYER_INPUT_CHANGED",
      issueCode: verifier.WATCH_LAYER_VERIFY_ISSUE_CODES.FILESYSTEM_MUTATION_FORBIDDEN,
    });
    expect(await pathExists(forbiddenPath)).toBe(false);
    expect(fs.writeFileSync).toBe(originalWriteFileSync);

    const networkFailure = await captureOperationFailure(() => (
      verifier.withWatchLayerVerifierSandbox(async () => {
        await globalThis.fetch("https://example.invalid/watch-layer-integration");
      })
    ));
    expect(networkFailure).toMatchObject({
      code: "LAYER_PATH_INVALID",
      issueCode: verifier.WATCH_LAYER_VERIFY_ISSUE_CODES.NETWORK_FORBIDDEN,
    });
    expect(globalThis.fetch).toBe(originalFetch);

    const golden = await createReadyProject(readyTemplate, "ready");
    const publicAsset = (readyTemplate.packageManifest.publicAssets as readonly JsonRecord[])[0];

    const schemaFirst = await cloneProject(golden, "watch-layer-precedence-schema-");
    await appendTamper(schemaFirst, contract.CANONICAL_PROJECT_PATHS.successorAuthoring);
    await appendTamper(schemaFirst, String(publicAsset.file));
    const schemaBefore = await captureGuardedState(schemaFirst);
    expect(await captureFailure(schemaFirst)).toMatchObject({ code: "LAYER_SCHEMA_INVALID" });
    expect(await captureGuardedState(schemaFirst)).toEqual(schemaBefore);

    const provenanceFirst = await cloneProject(golden, "watch-layer-precedence-provenance-");
    const approvalPath = `${APPROVAL_DIRECTORY}/approval-fidelity.json`;
    const approval = contract.APPROVAL_RECORD_SCHEMA.parseJson(
      await readFile(resolve(provenanceFirst, approvalPath)),
      { allowTrailingNewline: true, requireCanonical: true },
    );
    await writeProjectFile(
      provenanceFirst,
      approvalPath,
      contract.APPROVAL_RECORD_SCHEMA.serializeLine({
        ...approval,
        notes: "Current approval bytes intentionally differ for precedence coverage.",
      }),
    );
    await appendTamper(provenanceFirst, String(publicAsset.file));
    const provenanceBefore = await captureGuardedState(provenanceFirst);
    expect(await captureFailure(provenanceFirst)).toMatchObject({
      code: "LAYER_PROVENANCE_INVALID",
    });
    expect(await captureGuardedState(provenanceFirst)).toEqual(provenanceBefore);
  }, 180_000);

  it("requires one exact current global fidelity approval for a ready empty-layer package", async () => {
    const golden = await createReadyProject(readyTemplate, "ready");
    await expect(verifier.verifyWatchLayerAssets({ projectRoot: golden }))
      .resolves.toMatchObject({ ok: true, releaseStatus: "ready", writes: 0 });
    const fidelityApproval = readyTemplate.approvals.find(({ scope }) => scope === "fidelity");
    if (fidelityApproval === undefined) throw new Error("Ready template lacks fidelity approval");

    const scenarios: readonly {
      readonly name: string;
      readonly mutate: (projectRoot: string) => Promise<void>;
    }[] = [
      {
        name: "missing fidelity membership",
        mutate: async (root) => {
          const manifest = contract.LAYER_ASSET_MANIFEST_SCHEMA.parse({
            ...structuredClone(readyTemplate.packageManifest),
            approvals: (readyTemplate.packageManifest.approvals as readonly JsonRecord[])
              .filter(({ scope }) => scope !== "fidelity"),
          });
          await writeProjectFile(
            root,
            contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
            contract.LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(manifest),
          );
        },
      },
      {
        name: "stale fidelity binding",
        mutate: async (root) => {
          const stale = contract.APPROVAL_RECORD_SCHEMA.parse({
            ...structuredClone(fidelityApproval),
            artifactSha256: [HASH_ZERO],
          });
          const manifest = contract.LAYER_ASSET_MANIFEST_SCHEMA.parse({
            ...structuredClone(readyTemplate.packageManifest),
            approvals: (readyTemplate.packageManifest.approvals as readonly JsonRecord[])
              .map((approval) => approval.scope === "fidelity" ? stale : approval),
          });
          await writeProjectFile(
            root,
            `${APPROVAL_DIRECTORY}/${String(stale.id)}.json`,
            contract.APPROVAL_RECORD_SCHEMA.serializeLine(stale),
          );
          await writeProjectFile(
            root,
            contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
            contract.LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(manifest),
          );
        },
      },
      {
        name: "excess fidelity membership",
        mutate: async (root) => {
          const extra = contract.APPROVAL_RECORD_SCHEMA.parse({
            ...structuredClone(fidelityApproval),
            id: "approval-fidelity-extra",
          });
          const manifest = contract.LAYER_ASSET_MANIFEST_SCHEMA.parse({
            ...structuredClone(readyTemplate.packageManifest),
            approvals: [
              ...(readyTemplate.packageManifest.approvals as readonly JsonRecord[]),
              extra,
            ],
          });
          await writeProjectFile(
            root,
            `${APPROVAL_DIRECTORY}/${String(extra.id)}.json`,
            contract.APPROVAL_RECORD_SCHEMA.serializeLine(extra),
          );
          await writeProjectFile(
            root,
            contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
            contract.LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(manifest),
          );
        },
      },
    ];

    for (const scenario of scenarios) {
      const projectRoot = await cloneProject(
        golden,
        `watch-layer-fidelity-${scenario.name.replaceAll(" ", "-")}-`,
      );
      await scenario.mutate(projectRoot);
      const before = await captureGuardedState(projectRoot);
      const failure = await captureFailure(projectRoot);
      expect(failure.code, scenario.name).toBe("LAYER_PROVENANCE_INVALID");
      expect(await captureGuardedState(projectRoot), scenario.name).toEqual(before);
    }
  }, 180_000);

  it("records finalized WebP signatures, MIME, dimensions, color, and corrected active-profile budgets", async () => {
    const golden = await createReadyProject(readyTemplate, "ready");
    await expect(verifier.verifyWatchLayerAssets({ projectRoot: golden }))
      .resolves.toMatchObject({
        approvedMovingLayerIds: [],
        ok: true,
        releaseStatus: "ready",
        selectedPhase: "static-layered-reconstruction",
        writes: 0,
      });

    const publicFiles = new Map(readyTemplate.publicFiles.map((file) => [file.path, file]));
    const publicAssets = readyTemplate.packageManifest.publicAssets as readonly JsonRecord[];
    for (const asset of publicAssets) {
      const file = publicFiles.get(String(asset.file));
      expect(file, String(asset.file)).toBeDefined();
      if (file === undefined) continue;
      expect(file.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(file.bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(asset).toMatchObject({
        byteLength: file.bytes.byteLength,
        decodedPixelCount: Number(asset.intrinsicWidth) * Number(asset.intrinsicHeight),
        decodedRgbaByteLength:
          Number(asset.intrinsicWidth) * Number(asset.intrinsicHeight) * 4,
        mediaType: "image/webp",
        sha256: sha256(file.bytes),
      });
      expect(asset.encoder).toMatchObject({
        alphaQuality: 100,
        channels: 4,
        colourspace: "srgb",
        effort: 6,
        nearLossless: false,
        smartSubsample: true,
      });
      await expect(sharp(file.bytes).metadata()).resolves.toMatchObject({
        format: "webp",
        height: asset.intrinsicHeight,
        space: "srgb",
        width: asset.intrinsicWidth,
      });
    }
    expect(readyTemplate.runtimeIdentity).toMatchObject({
      byteLength: readyTemplate.runtimeBytes.byteLength,
      mediaType: "application/json",
      sha256: sha256(readyTemplate.runtimeBytes),
    });

    const profiles = readyTemplate.runtimeManifest.profiles as Readonly<Record<string, JsonRecord>>;
    const budgets = contract.ENHANCEMENT_BUDGETS as Readonly<Record<string, JsonRecord | number>>;
    for (const profileId of ["compact", "expanded"] as const) {
      const profile = profiles[profileId];
      const assets = profile.assets as readonly JsonRecord[];
      expect(profile.requestCountIncludingManifest).toBe(assets.length + 1);
      expect(profile.transferBytes).toBe(assets.reduce(
        (total, asset) => total + Number(asset.byteLength),
        0,
      ));
      expect(Number(profile.requestCountIncludingManifest)).toBeLessThanOrEqual(
        Number(budgets.maxRequestsIncludingRuntimeManifest),
      );
    }
    const budgetResult = profileBudget.evaluateWatchLayerProfileBudget({
      budgets: contract.ENHANCEMENT_BUDGETS,
      manifestAssets: publicAssets,
      profiles,
      runtimeManifestByteLength: readyTemplate.runtimeBytes.byteLength,
    });
    expect(budgetResult).toMatchObject({ issueCode: null, ok: true });
    if (budgetResult.profiles === null) throw new Error("Ready profiles lacked budget summaries");
    for (const profileId of ["compact", "expanded"] as const) {
      expect(budgetResult.profiles[profileId]).toMatchObject({
        requestCountIncludingManifest: profiles[profileId].requestCountIncludingManifest,
        transferBytes: profiles[profileId].transferBytes,
        transferBytesIncludingManifest:
          Number(profiles[profileId].transferBytes) + readyTemplate.runtimeBytes.byteLength,
      });
    }
  }, 180_000);

  it("verifies a complete candidate before any write and publishes it by same-device rename", async () => {
    const fixture = await createPublicationFixture(readyTemplate);
    const publicContainer = resolve(fixture.projectRoot, "public/assets/watch-2-5d");
    await mkdir(publicContainer, { recursive: true });
    const [sourceDevice, destinationDevice] = await Promise.all([
      stat(resolve(fixture.stage, contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory)),
      stat(publicContainer),
    ]);
    expect(sourceDevice.dev).toBe(destinationDevice.dev);
    const releaseBefore = await readFile(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    ));
    const observedSteps: string[] = [];

    const result = await publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        onStep: async (step) => {
          observedSteps.push(step);
          if (step === "verified-staged-release") {
            expect(await readFile(resolve(
              fixture.projectRoot,
              contract.CANONICAL_PROJECT_PATHS.successorRelease,
            ))).toEqual(releaseBefore);
            expect(await pathExists(resolve(
              fixture.projectRoot,
              contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
            ))).toBe(false);
            expect(await pathExists(resolve(
              fixture.projectRoot,
              contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
            ))).toBe(false);
          }
        },
      },
    });

    expect(result).toMatchObject({
      recoveredStaleState: false,
      releaseStatus: "ready",
      selectedPhase: "static-layered-reconstruction",
      verification: { ok: true },
    });
    expect(observedSteps.indexOf("verified-staged-release"))
      .toBeLessThan(observedSteps.indexOf("prepared-transaction"));
    expect(observedSteps.indexOf("installed-package-manifest"))
      .toBeLessThan(observedSteps.indexOf("committed-release-pointer"));
    expect(await readFile(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    ))).toEqual(readyTemplate.packageBytes);
    expect(await readFile(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    ))).toEqual(readyTemplate.releaseBytes);
    await expect(verifier.verifyWatchLayerAssets({ projectRoot: fixture.projectRoot }))
      .resolves.toMatchObject({ ok: true, releaseStatus: "ready", writes: 0 });
  }, 180_000);

  it("recovers the exact prior release after an interruption and leaves no partial candidate", async () => {
    const fixture = await createPublicationFixture(readyTemplate);
    const releasePath = resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    );
    const releaseBefore = await readFile(releasePath);
    const failureStep = "installed-package-manifest";
    expect(publisher.WATCH_LAYER_PUBLICATION_STEPS).toContain(failureStep);

    await expect(publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        onStep: (step) => {
          if (step === failureStep) throw new Error(`interrupt:${failureStep}`);
        },
      },
    })).rejects.toMatchObject({
      code: "LAYER_INPUT_CHANGED",
      issueCode: "LAYER_PUBLISH_INTERRUPTED",
    });

    expect(await readFile(releasePath)).toEqual(releaseBefore);
    expect(await pathExists(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    ))).toBe(false);
    expect(await pathExists(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    ))).toBe(false);
    expect(await pathExists(fixture.stage)).toBe(false);
    const transactionNames = (await readdir(resolve(fixture.projectRoot, "data")))
      .filter((name) => name.includes("publish") || name.includes("publication"));
    expect(transactionNames).toEqual([]);
    await expect(verifier.verifyWatchLayerAssets({ projectRoot: fixture.projectRoot }))
      .resolves.toMatchObject({ ok: true, releaseStatus: "fallback-only", writes: 0 });
  }, 180_000);
});
