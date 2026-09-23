import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;
type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};
type CanonicalParseOptions = {
  readonly allowTrailingNewline?: boolean;
  readonly requireCanonical?: boolean;
};
type StrictSchema = {
  parse(value: unknown): unknown;
  parseJson(input: string | Uint8Array, options?: CanonicalParseOptions): unknown;
  serializeLine(value: unknown): Buffer;
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
type AuthoringDocument = JsonRecord & {
  readonly approvals: readonly unknown[];
  readonly approvedMovingLayerIds: readonly string[];
  readonly candidateInventory: readonly Candidate[];
};
type EvidenceArtifact = {
  readonly byteLength: number;
  readonly candidateId: string | null;
  readonly kind: string;
  readonly path: string;
  readonly reviewerAid: boolean;
  readonly semanticInference: boolean;
  readonly sha256: string;
  readonly zoomPercent: 100 | 200;
};
type EvidenceIndex = JsonRecord & {
  readonly artifactCount: number;
  readonly artifacts: readonly EvidenceArtifact[];
  readonly authoring: FileIdentity & { readonly candidateInventorySha256: string };
  readonly candidates: readonly (JsonRecord & {
    readonly authoredDisposition: "proposed-static";
    readonly id: string;
    readonly statusChanged: boolean;
  })[];
  readonly canonicalMaster: FileIdentity & {
    readonly height: number;
    readonly width: number;
  };
  readonly outputSetSha256: string;
  readonly reviewPolicy: JsonRecord & {
    readonly approvalMutation: boolean;
    readonly evidenceOnly: boolean;
    readonly semanticInference: boolean;
    readonly statusMutation: boolean;
  };
};
type RenderedEvidence = {
  readonly index: JsonRecord;
  readonly outputs: readonly {
    readonly bytes: Buffer;
    readonly path: string;
  }[];
};
type ContractModule = {
  readonly APPROVAL_RECORD_SCHEMA: StrictSchema;
  readonly APPROVED_MASTER_IDENTITY: FileIdentity & {
    readonly intrinsicHeight: number;
    readonly intrinsicWidth: number;
  };
  readonly AUTHORING_DOCUMENT_SCHEMA: StrictSchema;
  readonly CANONICAL_PROJECT_PATHS: Record<string, string>;
  readonly CANONICAL_SOURCE_COORDINATE_SPACE: {
    readonly height: number;
    readonly width: number;
  };
  readonly LAYER_GATE_FAILURE_CODES: Record<string, string>;
  readonly RELEASE_POINTER_SCHEMA: StrictSchema;
  serializeCanonicalJson(value: unknown): Buffer;
  sha256(value: string | ArrayBufferView): string;
};
type ReviewEvidenceModule = {
  readonly CANDIDATE_EVIDENCE_DIRECTORY: string;
  readonly CANDIDATE_EVIDENCE_INDEX_PATH: string;
  readonly REVIEW_EVIDENCE_ISSUE_CODES: Record<string, string>;
  isCandidateEvidencePath(value: unknown): boolean;
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
type InspectorModule = {
  readonly CANDIDATE_INSPECTOR_ISSUE_CODES: Record<string, string>;
  parseCandidateInspectorArguments(argv: readonly string[]): Readonly<JsonRecord>;
  withCandidateInspectorNetworkDisabled<T>(operation: () => Promise<T> | T): Promise<T>;
};
type ApprovalModule = {
  readonly APPROVAL_TOOL_ISSUE_CODES: Record<string, string>;
  evaluateApprovalClosure(value: unknown, expectations: JsonRecord): Readonly<JsonRecord>;
  evaluateApprovalSetClosure(options?: JsonRecord): Readonly<JsonRecord>;
};

const PROJECT_ROOT = process.cwd();
const contractUrl = pathToFileURL(resolve(
  PROJECT_ROOT,
  "scripts/watch-2-5d/contract.mjs",
)).href;
const evidenceUrl = pathToFileURL(resolve(
  PROJECT_ROOT,
  "scripts/watch-2-5d/review-evidence.mjs",
)).href;
const inspectorUrl = pathToFileURL(resolve(
  PROJECT_ROOT,
  "scripts/inspect-watch-layer-candidates.mjs",
)).href;
const approvalUrl = pathToFileURL(resolve(
  PROJECT_ROOT,
  "scripts/watch-2-5d/approval-records.mjs",
)).href;

const contract = (await import(
  /* @vite-ignore -- executable ESM is typed by the local contract above. */
  contractUrl
)) as unknown as ContractModule;
const evidence = (await import(
  /* @vite-ignore -- executable ESM is typed by the local contract above. */
  evidenceUrl
)) as unknown as ReviewEvidenceModule;
const inspector = (await import(
  /* @vite-ignore -- executable ESM is typed by the local contract above. */
  inspectorUrl
)) as unknown as InspectorModule;
const approvalTools = (await import(
  /* @vite-ignore -- executable ESM is typed by the local contract above. */
  approvalUrl
)) as unknown as ApprovalModule;

const MASTER_PATH = resolve(
  PROJECT_ROOT,
  contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
);
const AUTHORING_PATH = resolve(
  PROJECT_ROOT,
  contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
);
const RELEASE_PROJECT_PATH = "data/watch-layer-release.json";
const RELEASE_PATH = resolve(PROJECT_ROOT, RELEASE_PROJECT_PATH);
const EVIDENCE_DIRECTORY_PATH = resolve(
  PROJECT_ROOT,
  evidence.CANDIDATE_EVIDENCE_DIRECTORY,
);
const EVIDENCE_INDEX_PATH = resolve(
  PROJECT_ROOT,
  evidence.CANDIDATE_EVIDENCE_INDEX_PATH,
);

function identity(path: string, bytes: Uint8Array): FileIdentity {
  return {
    byteLength: bytes.byteLength,
    path,
    sha256: contract.sha256(bytes),
  };
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listRegularFiles(
  root: string,
  relativeDirectory = "",
): Promise<readonly string[]> {
  const directory = relativeDirectory === ""
    ? root
    : resolve(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    const child = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const stats = await lstat(resolve(root, child));
    if (stats.isSymbolicLink()) {
      throw new Error(`Unexpected symbolic link in evidence package: ${child}`);
    }
    if (stats.isDirectory()) {
      files.push(...await listRegularFiles(root, child));
    } else if (stats.isFile()) {
      files.push(child);
    } else {
      throw new Error(`Unexpected non-regular evidence entry: ${child}`);
    }
  }

  return files;
}

function parseCanonicalAuthoring(bytes: Uint8Array): AuthoringDocument {
  return contract.AUTHORING_DOCUMENT_SCHEMA.parseJson(bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  }) as AuthoringDocument;
}

function parseCanonicalRelease(bytes: Uint8Array): JsonRecord {
  return contract.RELEASE_POINTER_SCHEMA.parseJson(bytes, {
    allowTrailingNewline: true,
    requireCanonical: true,
  }) as JsonRecord;
}

function candidateFixture(overrides: Partial<Candidate> = {}): Candidate {
  return {
    disposition: "proposed-static",
    id: "candidate-static-zone",
    possibleClasses: ["exposed-gear"],
    sourceRect: { height: 12, width: 16, x: 20, y: 24 },
    uncertaintyNotes: "Reviewer-authored test zone remains static pending review.",
    ...overrides,
  };
}

describe("candidate inspector isolation and bounded inputs", () => {
  it("disables network access, confines output paths, and rejects unsafe candidate/decode bounds", async () => {
    await expect(inspector.withCandidateInspectorNetworkDisabled(async () => {
      await fetch("https://example.invalid/inspector-network-must-be-disabled");
    })).rejects.toMatchObject({
      issueCode: inspector.CANDIDATE_INSPECTOR_ISSUE_CODES.NETWORK_DISABLED,
    });

    for (const override of ["--source", "--output", "--approval", "--status"]) {
      expect(() => inspector.parseCandidateInspectorArguments([
        override,
        "public/forbidden.png",
      ])).toThrowError(expect.objectContaining({
        issueCode: inspector.CANDIDATE_INSPECTOR_ISSUE_CODES.ARGUMENT_INVALID,
      }));
    }

    expect(evidence.isCandidateEvidencePath(
      `${evidence.CANDIDATE_EVIDENCE_DIRECTORY}/candidates/candidate-static-zone/crop-100.png`,
    )).toBe(true);
    for (const unsafePath of [
      "/tmp/crop.png",
      "https://example.invalid/crop.png",
      "data:image/png;base64,AAAA",
      "public/assets/watch-2-5d/v1/crop.png",
      `${evidence.CANDIDATE_EVIDENCE_DIRECTORY}/../escape.png`,
    ]) {
      expect(evidence.isCandidateEvidencePath(unsafePath), unsafePath).toBe(false);
    }

    const validCandidate = candidateFixture();
    expect(() => evidence.validateReviewCandidateInventory(
      [validCandidate, { ...validCandidate }],
      { sourceHeight: 100, sourceWidth: 100 },
    )).toThrowError(expect.objectContaining({
      issueCode: evidence.REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
    }));
    expect(() => evidence.validateReviewCandidateInventory(
      [{
        ...validCandidate,
        sourceRect: { height: 12, width: 16, x: 90, y: 24 },
      }],
      { sourceHeight: 100, sourceWidth: 100 },
    )).toThrowError(expect.objectContaining({
      issueCode: evidence.REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
    }));
    expect(() => evidence.validateReviewCandidateInventory(
      [{ ...validCandidate, disposition: "approved-moving" }],
      { sourceHeight: 100, sourceWidth: 100 },
    )).toThrowError(expect.objectContaining({
      issueCode: evidence.REVIEW_EVIDENCE_ISSUE_CODES.CANDIDATE_INVALID,
    }));

    const boundedBytes = Buffer.from("bounded-decode-check");
    await expect(evidence.renderCandidateReviewEvidence({
      authoringIdentity: identity(
        contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
        boundedBytes,
      ),
      candidateInventory: [],
      sourceBytes: boundedBytes,
      sourceHeight: contract.CANONICAL_SOURCE_COORDINATE_SPACE.height,
      sourceIdentity: identity("source/assets/bounded-source.png", boundedBytes),
      sourceWidth: contract.CANONICAL_SOURCE_COORDINATE_SPACE.width + 1,
    })).rejects.toMatchObject({
      code: contract.LAYER_GATE_FAILURE_CODES.BUDGET_EXCEEDED,
      issueCode: evidence.REVIEW_EVIDENCE_ISSUE_CODES.OUTPUT_BOUNDS,
    });
  });
});

describe("candidate inspector committed evidence reproducibility", () => {
  it("binds complete committed crop, overlay, and index bytes to exact real-source inputs", async () => {
    const [masterBytes, authoringBytes, indexBytes] = await Promise.all([
      readFile(MASTER_PATH),
      readFile(AUTHORING_PATH),
      readFile(EVIDENCE_INDEX_PATH),
    ]);
    const masterBefore = Buffer.from(masterBytes);
    const authoringBefore = Buffer.from(authoringBytes);
    const authoring = parseCanonicalAuthoring(authoringBytes);
    const index = JSON.parse(indexBytes.toString("utf8")) as EvidenceIndex;
    const candidates = evidence.validateReviewCandidateInventory(
      authoring.candidateInventory,
      {
        sourceHeight: contract.CANONICAL_SOURCE_COORDINATE_SPACE.height,
        sourceWidth: contract.CANONICAL_SOURCE_COORDINATE_SPACE.width,
      },
    );

    expect(identity(
      contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
      masterBytes,
    )).toEqual({
      byteLength: contract.APPROVED_MASTER_IDENTITY.byteLength,
      path: contract.APPROVED_MASTER_IDENTITY.path,
      sha256: contract.APPROVED_MASTER_IDENTITY.sha256,
    });
    expect(index.canonicalMaster).toMatchObject({
      ...identity(contract.CANONICAL_PROJECT_PATHS.canonicalMaster, masterBytes),
      height: contract.APPROVED_MASTER_IDENTITY.intrinsicHeight,
      width: contract.APPROVED_MASTER_IDENTITY.intrinsicWidth,
    });
    expect(index.authoring).toEqual({
      ...identity(contract.CANONICAL_PROJECT_PATHS.successorAuthoring, authoringBytes),
      candidateInventorySha256: contract.sha256(
        contract.serializeCanonicalJson(candidates),
      ),
    });
    expect(indexBytes).toEqual(Buffer.concat([
      contract.serializeCanonicalJson(index),
      Buffer.from("\n"),
    ]));

    expect(index.artifactCount).toBe(32);
    expect(index.artifactCount).toBe(index.artifacts.length);
    expect(new Set(index.artifacts.map(({ path }) => path)).size)
      .toBe(index.artifacts.length);
    const reproducedOutputSetSha256 = contract.sha256(
      contract.serializeCanonicalJson(index.artifacts.map((artifact) => ({
        byteLength: artifact.byteLength,
        path: artifact.path,
        sha256: artifact.sha256,
      }))),
    );
    expect(index.outputSetSha256).toBe(reproducedOutputSetSha256);
    expect(index.outputSetSha256)
      .toBe("a054b915924c2c7138c614f3caba2ae598845bcbae071eb1fdee858eb10df93f");

    const committedMembers = (await listRegularFiles(EVIDENCE_DIRECTORY_PATH))
      .map((path) => `${evidence.CANDIDATE_EVIDENCE_DIRECTORY}/${path}`)
      .sort(lexicalCompare);
    const indexedMembers = [
      ...index.artifacts.map(({ path }) => path),
      evidence.CANDIDATE_EVIDENCE_INDEX_PATH,
    ].sort(lexicalCompare);
    expect(committedMembers).toEqual(indexedMembers);

    for (const artifact of index.artifacts) {
      expect(evidence.isCandidateEvidencePath(artifact.path), artifact.path).toBe(true);
      expect(artifact.path.startsWith("public/"), artifact.path).toBe(false);
      expect(artifact.reviewerAid).toBe(true);
      expect(artifact.semanticInference).toBe(false);
      const artifactBytes = await readFile(resolve(PROJECT_ROOT, artifact.path));
      expect(artifactBytes.byteLength, artifact.path).toBe(artifact.byteLength);
      expect(contract.sha256(artifactBytes), artifact.path).toBe(artifact.sha256);
    }

    const expectedCandidateArtifacts = [
      "alpha-overlay:100",
      "alpha-overlay:200",
      "edge-contrast-overlay:100",
      "edge-contrast-overlay:200",
      "source-crop:100",
      "source-crop:200",
    ];
    for (const candidate of candidates) {
      expect(index.artifacts
        .filter(({ candidateId }) => candidateId === candidate.id)
        .map(({ kind, zoomPercent }) => `${kind}:${zoomPercent}`)
        .sort(), candidate.id)
        .toEqual(expectedCandidateArtifacts);
    }
    expect(index.artifacts
      .filter(({ candidateId }) => candidateId === null)
      .map(({ kind, zoomPercent }) => `${kind}:${zoomPercent}`)
      .sort())
      .toEqual(["contact-sheet:100", "contact-sheet:200"]);

    expect(candidates.every(({ disposition }) => disposition === "proposed-static"))
      .toBe(true);
    expect(index.candidates.map(({ id }) => id))
      .toEqual(candidates.map(({ id }) => id));
    expect(index.candidates.every(({ authoredDisposition, statusChanged }) => (
      authoredDisposition === "proposed-static" && statusChanged === false
    ))).toBe(true);
    expect(index.reviewPolicy).toMatchObject({
      approvalMutation: false,
      evidenceOnly: true,
      semanticInference: false,
      statusMutation: false,
    });

    expect(masterBytes.equals(masterBefore)).toBe(true);
    expect(authoringBytes.equals(authoringBefore)).toBe(true);
    expect(contract.sha256(await readFile(MASTER_PATH)))
      .toBe(contract.sha256(masterBefore));
    expect(contract.sha256(await readFile(AUTHORING_PATH)))
      .toBe(contract.sha256(authoringBefore));
  });
});

describe("candidate evidence remains outside approval and release authority", () => {
  it("cannot satisfy an approval scope or promote the static authored inventory", async () => {
    const [authoringBytes, indexBytes] = await Promise.all([
      readFile(AUTHORING_PATH),
      readFile(EVIDENCE_INDEX_PATH),
    ]);
    const authoring = parseCanonicalAuthoring(authoringBytes);
    const index = JSON.parse(indexBytes.toString("utf8")) as EvidenceIndex;
    const candidateArtifact = index.artifacts.find((artifact) => (
      artifact.candidateId === "center-right-copper-wheel"
      && artifact.kind === "source-crop"
      && artifact.zoomPercent === 200
    ));
    expect(candidateArtifact).toBeDefined();
    if (candidateArtifact === undefined) {
      throw new Error("Missing representative committed candidate artifact");
    }

    const expectation = {
      artifactSha256: [candidateArtifact.sha256],
      layerIds: [candidateArtifact.candidateId],
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [200],
      scope: "segmentation",
    };
    expect(() => contract.APPROVAL_RECORD_SCHEMA.parse(candidateArtifact))
      .toThrowError();
    expect(approvalTools.evaluateApprovalClosure(candidateArtifact, expectation))
      .toMatchObject({
        eligible: false,
        ok: false,
        outcome: "static",
        reason: approvalTools.APPROVAL_TOOL_ISSUE_CODES.APPROVAL_RECORD_INVALID,
        releasable: false,
      });
    expect(approvalTools.evaluateApprovalSetClosure({
      approvals: index.artifacts,
      approvedMovingLayerIds: [candidateArtifact.candidateId],
      requirements: [expectation],
    })).toMatchObject({
      approvedMovingLayerIds: [],
      mode: "static",
      ok: false,
      releasable: false,
    });

    expect(authoring.approvals).toEqual([]);
    expect(authoring.approvedMovingLayerIds).toEqual([]);
    expect(authoring.candidateInventory.every(({ disposition }) => (
      disposition === "proposed-static"
    ))).toBe(true);
    expect(index.reviewPolicy.approvalMutation).toBe(false);
    expect(index.reviewPolicy.statusMutation).toBe(false);
  });

  it("keeps canonical fallback-only records valid when every candidate evidence file is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "watch-2-5d-fallback-without-evidence-"));
    try {
      const isolatedAuthoringPath = resolve(
        root,
        contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
      );
      const isolatedReleasePath = resolve(root, RELEASE_PROJECT_PATH);
      await mkdir(dirname(isolatedAuthoringPath), { recursive: true });
      await mkdir(dirname(isolatedReleasePath), { recursive: true });
      await copyFile(AUTHORING_PATH, isolatedAuthoringPath);
      await copyFile(RELEASE_PATH, isolatedReleasePath);

      await expect(lstat(resolve(root, evidence.CANDIDATE_EVIDENCE_DIRECTORY)))
        .rejects.toMatchObject({ code: "ENOENT" });
      const authoring = parseCanonicalAuthoring(await readFile(isolatedAuthoringPath));
      const release = parseCanonicalRelease(await readFile(isolatedReleasePath));

      expect(release).toEqual({
        depthEnabled: false,
        runtimeManifest: null,
        schemaVersion: 1,
        status: "fallback-only",
      });
      expect(contract.RELEASE_POINTER_SCHEMA.serializeLine(release).toString("utf8"))
        .not.toContain("/assets/watch-2-5d/");
      expect(authoring.approvals).toEqual([]);
      expect(authoring.approvedMovingLayerIds).toEqual([]);
      expect(approvalTools.evaluateApprovalSetClosure({
        approvals: authoring.approvals,
        approvedMovingLayerIds: authoring.approvedMovingLayerIds,
        requirements: [],
      })).toEqual({
        approvedMovingLayerIds: [],
        failures: [],
        mode: "reference-pose",
        ok: true,
        releasable: true,
      });
      expect([...await listRegularFiles(root)].sort(lexicalCompare)).toEqual([
        RELEASE_PROJECT_PATH,
        contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
      ].sort(lexicalCompare));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
