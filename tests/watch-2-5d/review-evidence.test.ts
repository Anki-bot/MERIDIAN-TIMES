import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

type JsonRecord = Record<string, unknown>;
type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};
type StrictSchema = {
  parse(value: unknown): unknown;
  serializeLine(value: unknown): Buffer;
};
type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: FileIdentity & {
    readonly intrinsicHeight: number;
    readonly intrinsicWidth: number;
  };
  readonly AUTHORING_DOCUMENT_SCHEMA: StrictSchema;
  readonly CANONICAL_PROJECT_PATHS: Record<string, string>;
  readonly CONTRACT_FAILURE_CODES: Record<string, string>;
  sha256(value: string | ArrayBufferView): string;
};
type Candidate = {
  readonly disposition: "proposed-static";
  readonly id: string;
  readonly possibleClasses: readonly string[];
  readonly sourceRect: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly uncertaintyNotes: string;
};
type RenderedOutput = {
  readonly bytes: Buffer;
  readonly path: string;
};
type RenderedEvidence = {
  readonly artifactRecords: readonly JsonRecord[];
  readonly index: JsonRecord;
  readonly indexIdentity: FileIdentity;
  readonly outputs: readonly RenderedOutput[];
};
type ReviewEvidenceModule = {
  readonly CANDIDATE_EVIDENCE_DIRECTORY: string;
  readonly CANDIDATE_EVIDENCE_INDEX_PATH: string;
  readonly REVIEW_EVIDENCE_ISSUE_CODES: Record<string, string>;
  readonly REVIEW_EVIDENCE_LIMITS: {
    readonly maxCandidateCount: number;
  };
  renderCandidateReviewEvidence(options: {
    readonly authoringIdentity: FileIdentity;
    readonly candidateInventory: readonly Candidate[];
    readonly sourceBytes: Uint8Array;
    readonly sourceHeight: number;
    readonly sourceIdentity: FileIdentity;
    readonly sourceWidth: number;
  }): Promise<RenderedEvidence>;
  validateReviewCandidateInventory(
    value: unknown,
    options: { readonly sourceHeight: number; readonly sourceWidth: number },
  ): readonly Candidate[];
};
type InspectorResult = {
  readonly artifactCount: number;
  readonly candidateCount: number;
  readonly changed: boolean;
  readonly indexIdentity: FileIdentity;
  readonly indexPath: string;
};
type InspectorModule = {
  readonly CANDIDATE_INSPECTOR_ISSUE_CODES: Record<string, string>;
  inspectWatchLayerCandidates(options: { readonly projectRoot: string }): Promise<InspectorResult>;
  parseCandidateInspectorArguments(argv: readonly string[]): Readonly<Record<string, unknown>>;
  withCandidateInspectorNetworkDisabled<T>(operation: () => Promise<T> | T): Promise<T>;
};

// @ts-expect-error -- dependency-free executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const evidence = (await import("../../scripts/watch-2-5d/review-evidence.mjs")) as unknown as ReviewEvidenceModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const inspector = (await import("../../scripts/inspect-watch-layer-candidates.mjs")) as unknown as InspectorModule;

const PROJECT_ROOT = process.cwd();
const REAL_MASTER_PATH = resolve(
  PROJECT_ROOT,
  contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
);
const REAL_AUTHORING_PATH = resolve(
  PROJECT_ROOT,
  contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
);
const temporaryRoots = new Set<string>();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function createTemporaryRoot(prefix = "watch-2-5d-inspector-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

async function syntheticPng(width: number, height: number): Promise<Buffer> {
  const rgba = Buffer.allocUnsafe(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = (x * 31 + y * 7) % 256;
      rgba[offset + 1] = (x * 11 + y * 43) % 256;
      rgba[offset + 2] = (x * 19 + y * 23) % 256;
      rgba[offset + 3] = (x + y) % 3 === 0 ? 128 : 255;
    }
  }
  return sharp(rgba, { raw: { channels: 4, height, width } })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      effort: 10,
      palette: false,
      progressive: false,
    })
    .toBuffer();
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    disposition: "proposed-static",
    id: "candidate-copper-wheel",
    possibleClasses: ["exposed-gear", "exposed-rotor"],
    sourceRect: { height: 3, width: 4, x: 2, y: 1 },
    uncertaintyNotes: "Reviewer-authored rectangle remains static pending visual review.",
    ...overrides,
  };
}

function identity(path: string, bytes: Uint8Array): FileIdentity {
  return {
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

function outputDigestList(rendered: RenderedEvidence): readonly JsonRecord[] {
  return rendered.outputs.map(({ bytes, path }) => ({
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  }));
}

async function listFiles(root: string, relativeDirectory = ""): Promise<readonly string[]> {
  const directory = relativeDirectory === "" ? root : resolve(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    const child = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile() || entry.isSymbolicLink()) files.push(child);
  }
  return files;
}

async function fileDigestList(root: string): Promise<readonly JsonRecord[]> {
  const paths = await listFiles(root);
  return Promise.all(paths.map(async (path) => {
    const bytes = await readFile(resolve(root, path));
    return { byteLength: bytes.byteLength, path, sha256: sha256(bytes) };
  }));
}

async function writeRealisticProject(
  root: string,
  { masterSymlink = false } = {},
): Promise<{ readonly authoringBytes: Buffer; readonly masterBytes: Buffer }> {
  const masterPath = resolve(root, contract.CANONICAL_PROJECT_PATHS.canonicalMaster);
  const authoringPath = resolve(root, contract.CANONICAL_PROJECT_PATHS.successorAuthoring);
  const reviewPath = resolve(root, contract.CANONICAL_PROJECT_PATHS.successorReviewDirectory);
  await mkdir(dirname(masterPath), { recursive: true });
  await mkdir(dirname(authoringPath), { recursive: true });
  await mkdir(reviewPath, { recursive: true });
  if (masterSymlink) await symlink(REAL_MASTER_PATH, masterPath);
  else await copyFile(REAL_MASTER_PATH, masterPath);

  const sourceDocument = JSON.parse(await readFile(REAL_AUTHORING_PATH, "utf8")) as JsonRecord;
  sourceDocument.candidateInventory = [candidate({
    id: "candidate-review-zone",
    possibleClasses: ["exposed-gear"],
    sourceRect: { height: 10, width: 12, x: 32, y: 24 },
  })];
  const authoringBytes = contract.AUTHORING_DOCUMENT_SCHEMA.serializeLine(sourceDocument);
  await writeFile(authoringPath, authoringBytes);
  return {
    authoringBytes,
    masterBytes: await readFile(REAL_MASTER_PATH),
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("finite candidate review evidence renderer", () => {
  it("generates byte-identical bounded 100%/200% crops, overlays, contact sheets, and canonical index", async () => {
    const sourceBytes = await syntheticPng(8, 6);
    const sourceBefore = Buffer.from(sourceBytes);
    const candidates = [candidate()];
    const candidatesBefore = structuredClone(candidates);
    const authoringBytes = Buffer.from("canonical synthetic authoring input\n");
    const options = {
      authoringIdentity: identity("source/assets/watch-2-5d/v1/authoring.json", authoringBytes),
      candidateInventory: candidates,
      sourceBytes,
      sourceHeight: 6,
      sourceIdentity: identity("source/assets/synthetic-review-source.png", sourceBytes),
      sourceWidth: 8,
    } as const;

    const first = await evidence.renderCandidateReviewEvidence(options);
    const second = await evidence.renderCandidateReviewEvidence(options);

    expect(outputDigestList(first)).toEqual(outputDigestList(second));
    expect(first.index).toEqual(second.index);
    expect(sourceBytes).toEqual(sourceBefore);
    expect(candidates).toEqual(candidatesBefore);
    expect(first.artifactRecords).toHaveLength(8);
    expect(first.outputs).toHaveLength(9);
    expect(first.indexIdentity.path).toBe(evidence.CANDIDATE_EVIDENCE_INDEX_PATH);
    expect(first.outputs.every(({ path }) => (
      path.startsWith(`${evidence.CANDIDATE_EVIDENCE_DIRECTORY}/`)
      && !path.startsWith("public/")
    ))).toBe(true);

    const indexOutput = first.outputs.find(({ path }) => (
      path === evidence.CANDIDATE_EVIDENCE_INDEX_PATH
    ));
    expect(indexOutput).toBeDefined();
    const indexText = indexOutput?.bytes.toString("utf8") ?? "";
    expect(indexText.endsWith("\n")).toBe(true);
    expect(indexText.slice(0, -1)).toBe(JSON.stringify(JSON.parse(indexText)));
    expect(first.index).toMatchObject({
      artifactCount: 8,
      candidates: [{
        authoredDisposition: "proposed-static",
        id: "candidate-copper-wheel",
        statusChanged: false,
      }],
      generator: {
        deterministic: true,
        networkAccess: "disabled",
      },
      reviewPolicy: {
        approvalMutation: false,
        edgeContrastClassification: "reviewer-aid-only",
        evidenceOnly: true,
        semanticInference: false,
        statusMutation: false,
        zoomPercent: [100, 200],
      },
      sourceCoordinateSpace: { height: 6, width: 8 },
    });

    const candidateArtifacts = first.artifactRecords.filter((record) => (
      record.candidateId === "candidate-copper-wheel"
    ));
    expect(candidateArtifacts).toHaveLength(6);
    expect(candidateArtifacts.map(({ kind, zoomPercent }) => `${String(kind)}:${String(zoomPercent)}`).sort())
      .toEqual([
        "alpha-overlay:100",
        "alpha-overlay:200",
        "edge-contrast-overlay:100",
        "edge-contrast-overlay:200",
        "source-crop:100",
        "source-crop:200",
      ]);
    for (const artifact of candidateArtifacts) {
      const output = first.outputs.find(({ path }) => path === artifact.path);
      expect(output).toBeDefined();
      if (output === undefined) throw new Error(`Missing rendered output ${String(artifact.path)}`);
      const metadata = await sharp(output.bytes).metadata();
      const scale = Number(artifact.zoomPercent) / 100;
      expect(metadata).toMatchObject({
        format: "png",
        height: 3 * scale,
        width: 4 * scale,
      });
      expect(artifact.semanticInference).toBe(false);
      expect(artifact.reviewerAid).toBe(true);
    }
  });

  it("rejects malformed, duplicate, non-static, out-of-bounds, and unbounded candidate inventories", () => {
    const valid = candidate();
    const invalidCases: readonly unknown[] = [
      [{ ...valid, unexpected: true }],
      [valid, { ...valid }],
      [{ ...valid, disposition: "approved-moving" }],
      [{ ...valid, sourceRect: { height: 2, width: 3, x: 7, y: 5 } }],
      [{ ...valid, possibleClasses: ["invented-mechanism"] }],
    ];
    for (const invalid of invalidCases) {
      expect(() => evidence.validateReviewCandidateInventory(invalid, {
        sourceHeight: 6,
        sourceWidth: 8,
      })).toThrowError(expect.objectContaining({
        code: "LAYER_SCHEMA_INVALID",
        issueCode: expect.stringMatching(/^REVIEW_(?:CANDIDATE|INPUT)_INVALID$/u),
      }));
    }

    const excessive = Array.from(
      { length: evidence.REVIEW_EVIDENCE_LIMITS.maxCandidateCount + 1 },
      (_, index) => candidate({ id: `candidate-${index}` }),
    );
    expect(() => evidence.validateReviewCandidateInventory(excessive, {
      sourceHeight: 6,
      sourceWidth: 8,
    })).toThrowError(expect.objectContaining({
      code: "LAYER_BUDGET_EXCEEDED",
      issueCode: evidence.REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
    }));
  });
});

describe("finite local candidate inspector", () => {
  it("publishes only review evidence, preserves source and authoring bytes, and makes an identical rerun a no-op", async () => {
    const root = await createTemporaryRoot();
    const fixture = await writeRealisticProject(root);
    const fetchAttempt = vi.fn(async () => {
      throw new Error("network must remain disabled");
    });
    vi.stubGlobal("fetch", fetchAttempt);

    const first = await inspector.inspectWatchLayerCandidates({ projectRoot: root });
    const outputDirectory = resolve(root, evidence.CANDIDATE_EVIDENCE_DIRECTORY);
    const firstOutputDigests = await fileDigestList(outputDirectory);
    const second = await inspector.inspectWatchLayerCandidates({ projectRoot: root });
    const secondOutputDigests = await fileDigestList(outputDirectory);

    expect(first).toMatchObject({
      artifactCount: 8,
      candidateCount: 1,
      changed: true,
      indexPath: evidence.CANDIDATE_EVIDENCE_INDEX_PATH,
    });
    expect(second).toMatchObject({
      artifactCount: 8,
      candidateCount: 1,
      changed: false,
      indexIdentity: first.indexIdentity,
    });
    expect(secondOutputDigests).toEqual(firstOutputDigests);
    expect(fetchAttempt).not.toHaveBeenCalled();
    expect((await readFile(resolve(root, contract.CANONICAL_PROJECT_PATHS.canonicalMaster)))
      .equals(fixture.masterBytes)).toBe(true);
    expect((await readFile(resolve(root, contract.CANONICAL_PROJECT_PATHS.successorAuthoring)))
      .equals(fixture.authoringBytes)).toBe(true);

    const index = JSON.parse(await readFile(
      resolve(root, evidence.CANDIDATE_EVIDENCE_INDEX_PATH),
      "utf8",
    )) as JsonRecord;
    expect(index).toMatchObject({
      authoring: {
        sha256: sha256(fixture.authoringBytes),
      },
      candidates: [{
        authoredDisposition: "proposed-static",
        id: "candidate-review-zone",
        statusChanged: false,
      }],
      canonicalMaster: {
        sha256: contract.APPROVED_MASTER_IDENTITY.sha256,
      },
      reviewPolicy: {
        approvalMutation: false,
        semanticInference: false,
        statusMutation: false,
      },
    });

    const projectFiles = await listFiles(root);
    const allowedInputs = new Set([
      contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
      contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
    ]);
    for (const path of projectFiles) {
      expect(
        allowedInputs.has(path)
        || path.startsWith(`${evidence.CANDIDATE_EVIDENCE_DIRECTORY}/`),
        path,
      ).toBe(true);
      expect(path.startsWith("public/")).toBe(false);
      expect(path.includes("/masks/")).toBe(false);
      expect(path.includes("/reconstruction/")).toBe(false);
      expect(path.includes("/approvals/")).toBe(false);
    }
  }, 60_000);

  it("rejects non-regular canonical input and exposes no source/output override", async () => {
    const root = await createTemporaryRoot("watch-2-5d-inspector-symlink-");
    await writeRealisticProject(root, { masterSymlink: true });

    await expect(inspector.inspectWatchLayerCandidates({ projectRoot: root }))
      .rejects.toMatchObject({
        code: contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        path: contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
      });
    await expect(inspector.withCandidateInspectorNetworkDisabled(async () => {
      await fetch("https://example.invalid/forbidden");
    })).rejects.toMatchObject({
      issueCode: inspector.CANDIDATE_INSPECTOR_ISSUE_CODES.NETWORK_DISABLED,
    });
    expect(() => inspector.parseCandidateInspectorArguments(["--output", "public/escape.png"]))
      .toThrowError(expect.objectContaining({
        issueCode: inspector.CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
      }));
    expect(() => inspector.parseCandidateInspectorArguments(["--source", "other.png"]))
      .toThrowError(expect.objectContaining({
        issueCode: inspector.CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
      }));
    await expect(readFile(resolve(root, evidence.CANDIDATE_EVIDENCE_INDEX_PATH)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
