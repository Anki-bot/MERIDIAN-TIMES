import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;
type CanonicalParseOptions = {
  allowTrailingNewline?: boolean;
  requireCanonical?: boolean;
};
type StrictSchema = {
  parse(value: unknown): unknown;
  parseJson(input: string | Uint8Array, options?: CanonicalParseOptions): unknown;
  serialize(value: unknown): Buffer;
  serializeLine(value: unknown): Buffer;
  stringify(value: unknown): string;
};

type ContractModule = {
  APPROVAL_RECORD_SCHEMA: StrictSchema;
  APPROVED_MASTER_IDENTITY: JsonRecord;
  AUTHORING_DOCUMENT_SCHEMA: StrictSchema;
  AUTHORING_INTERPRETATION_NOTICE: string;
  CANONICAL_PROJECT_PATHS: Record<string, string>;
  CANONICAL_SOURCE_COORDINATE_SPACE: JsonRecord;
  LAYER_GATE_FAILURE_CODES: Record<string, string>;
  MASK_RECORD_SCHEMA: StrictSchema;
  PHASE_NAMES: readonly string[];
  PHASE_RECORD_SCHEMA: StrictSchema;
  PREDECESSOR_MANIFEST_IDENTITY: JsonRecord;
  PROVENANCE_RECORD_SCHEMA: StrictSchema;
  RECONSTRUCTION_RECORD_SCHEMA: StrictSchema;
  RELEASE_POINTER_SCHEMA: StrictSchema;
  SCHEMA_ISSUE_CODES: Record<string, string>;
  serializeCanonicalJson(value: unknown): Buffer;
  sha256(value: string | Uint8Array): string;
};

type ApprovalModule = {
  APPROVAL_TOOL_ISSUE_CODES: Record<string, string>;
  evaluateApprovalClosure(
    value: unknown,
    expectations: JsonRecord,
  ): Readonly<JsonRecord>;
  evaluateApprovalSetClosure(options?: JsonRecord): Readonly<JsonRecord>;
  evaluateProvenanceClosure(
    value: unknown,
    expectations: JsonRecord,
  ): Readonly<JsonRecord>;
};

const contractUrl = pathToFileURL(resolve(
  process.cwd(),
  "scripts/watch-2-5d/contract.mjs",
)).href;
const approvalUrl = pathToFileURL(resolve(
  process.cwd(),
  "scripts/watch-2-5d/approval-records.mjs",
)).href;

const contract = (await import(
  /* @vite-ignore -- executable ESM is typed by the local contract above. */
  contractUrl
)) as unknown as ContractModule;
const approvalTools = (await import(
  /* @vite-ignore -- executable ESM is typed by the local contract above. */
  approvalUrl
)) as unknown as ApprovalModule;

// Every artifact/evidence identity below is synthetic, in-memory test metadata. This
// suite never writes a mask, fill, approval, review image, or runtime/public asset.
const SOURCE_HASH = "1".repeat(64);
const MASK_HASH = "2".repeat(64);
const FILL_HASH = "3".repeat(64);
const EVIDENCE_HASH = "4".repeat(64);
const REPLACEMENT_HASH = "5".repeat(64);

const EXPECTED_PHASE_HASHES = [
  "bbf37922b548b3384ea8070b2db85ba702aa53c2fb04577f41be9b814dd09d2b",
  "ff255f844f9781d06cf60bea0d657aee4c91c12bf78de5dd7190b29bbc997d34",
  "01e1a5cdac668d47be4c57ba69214dd623a6d1aae39ca20e8aa87016422d280b",
  "ed43a49326fe82c52fb59d427cfbfe8a94cae21334fc459c7f8015ad41905d0d",
] as const;

function phaseProjection(name: string, ordinal: number): JsonRecord {
  return {
    assetSha256: [],
    name,
    ordinal,
    runtimeManifestSha256: null,
    status: ordinal === 0 ? "approved" : "disabled",
  };
}

function phaseRecords(): JsonRecord[] {
  return contract.PHASE_NAMES.map((name, ordinal) => {
    const projection = phaseProjection(name, ordinal);
    return {
      ...projection,
      phasePayloadSha256: contract.sha256(
        contract.serializeCanonicalJson(projection),
      ),
    };
  });
}

function syntheticMask(file = "source/assets/watch-2-5d/v1/masks/synthetic-mask.png"): JsonRecord {
  return {
    alphaSum: 128,
    file,
    height: 1504,
    id: "mask-synthetic",
    nonZeroPixelCount: 1,
    provenanceId: "provenance-synthetic-mask",
    sha256: MASK_HASH,
    tightBounds: { height: 1, width: 1, x: 24, y: 48 },
    width: 2760,
  };
}

function syntheticProvenance(): JsonRecord {
  return {
    artifactId: "fill-synthetic",
    artifactSha256: FILL_HASH,
    classification: "synthetic",
    createdAt: "2026-05-17T12:34:56.000Z",
    id: "provenance-synthetic-fill",
    immediateParentSha256: [SOURCE_HASH, MASK_HASH],
    method: "manual-paint",
    operator: "synthetic-test-operator",
    settings: { featherPixels: 2, preserveAlpha: true },
    tool: { name: "Synthetic Test Raster Tool", version: "1.0.0" },
  };
}

function syntheticReconstruction(): JsonRecord {
  return {
    approvalId: "approval-synthetic-reconstruction",
    boundaryMaskId: "mask-synthetic-boundary",
    fillFile: "source/assets/watch-2-5d/v1/reconstruction/synthetic-fill.png",
    fillId: "fill-synthetic",
    fillSha256: FILL_HASH,
    id: "reconstruction-synthetic",
    method: "manual-paint",
    provenanceId: "provenance-synthetic-fill",
    regionMaskId: "mask-synthetic-region",
    syntheticPixelCount: 16,
  };
}

function syntheticApproval(): JsonRecord {
  return {
    artifactSha256: [FILL_HASH, EVIDENCE_HASH],
    decision: "approved",
    id: "approval-synthetic-reconstruction",
    layerIds: ["layer-synthetic"],
    notes: "Synthetic fixture reviewed for contract behavior only.",
    reviewedAt: "2026-05-17T13:00:00.000Z",
    reviewedPoseIds: ["reference-pose", "motion-extreme-positive"],
    reviewedZoomPercent: [100, 200],
    reviewer: "synthetic-test-reviewer",
    scope: "reconstruction",
  };
}

function syntheticFallbackAuthoring(): JsonRecord {
  return {
    approvedMovingLayerIds: [],
    approvals: [],
    authoredInterpretation: true,
    candidateInventory: [{
      disposition: "proposed-static",
      id: "candidate-synthetic-zone",
      possibleClasses: ["exposed-gear", "unclassified"],
      sourceRect: { height: 20, width: 20, x: 100, y: 120 },
      uncertaintyNotes: "Synthetic fixture remains static without reviewed authored inputs.",
    }],
    canonicalMaster: structuredClone(contract.APPROVED_MASTER_IDENTITY),
    depthEnabled: false,
    depthProfiles: [],
    interpretationNotice: contract.AUTHORING_INTERPRETATION_NOTICE,
    layers: [],
    masks: [],
    motionProfiles: [],
    packageId: "synthetic-watch-layer-package",
    packageVersion: "0.0.0-test",
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

function syntheticFallbackRelease(): JsonRecord {
  return {
    depthEnabled: false,
    runtimeManifest: null,
    schemaVersion: 1,
    status: "fallback-only",
  };
}

function expectSchemaFailureWithoutMutation(
  schema: StrictSchema,
  fixture: JsonRecord,
  issueCode: string,
  code = contract.LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
): void {
  const before = structuredClone(fixture);
  try {
    schema.parse(fixture);
  } catch (error) {
    expect(error).toMatchObject({
      code,
      issueCode,
      name: "WatchLayerSchemaError",
    });
    expect(fixture).toEqual(before);
    return;
  }
  throw new Error("Expected strict schema validation to fail");
}

describe("watch 2.5D authored contract examples", () => {
  it("round-trips valid synthetic examples byte-identically with exact canonical phase bytes", () => {
    const phases = phaseRecords();
    const exactFirstPhase =
      `{"assetSha256":[],"name":"source-preparation","ordinal":0,`
      + `"phasePayloadSha256":"${EXPECTED_PHASE_HASHES[0]}",`
      + `"runtimeManifestSha256":null,"status":"approved"}`;

    expect(phases.map(({ phasePayloadSha256 }) => phasePayloadSha256))
      .toEqual(EXPECTED_PHASE_HASHES);
    expect(contract.PHASE_RECORD_SCHEMA.stringify(phases[0])).toBe(exactFirstPhase);

    const validExamples: readonly [StrictSchema, JsonRecord][] = [
      [contract.PHASE_RECORD_SCHEMA, phases[0]],
      [contract.MASK_RECORD_SCHEMA, syntheticMask()],
      [contract.PROVENANCE_RECORD_SCHEMA, syntheticProvenance()],
      [contract.RECONSTRUCTION_RECORD_SCHEMA, syntheticReconstruction()],
      [contract.APPROVAL_RECORD_SCHEMA, syntheticApproval()],
      [contract.AUTHORING_DOCUMENT_SCHEMA, syntheticFallbackAuthoring()],
      [contract.RELEASE_POINTER_SCHEMA, syntheticFallbackRelease()],
    ];

    for (const [schema, fixture] of validExamples) {
      const before = structuredClone(fixture);
      const firstBytes = schema.serializeLine(fixture);
      const parsed = schema.parseJson(firstBytes, {
        allowTrailingNewline: true,
        requireCanonical: true,
      });

      expect(schema.serializeLine(parsed)).toEqual(firstBytes);
      expect(fixture).toEqual(before);
    }
  });

  it("rejects unknown top-level and nested authored fields without changing fixtures", () => {
    const authoringWithUnknown = {
      ...syntheticFallbackAuthoring(),
      inferredMechanism: "forbidden",
    };
    expectSchemaFailureWithoutMutation(
      contract.AUTHORING_DOCUMENT_SCHEMA,
      authoringWithUnknown,
      contract.SCHEMA_ISSUE_CODES.FIELD_SET,
    );

    const provenance = syntheticProvenance();
    const provenanceWithUnknownToolField = {
      ...provenance,
      tool: {
        ...(provenance.tool as JsonRecord),
        remoteService: "forbidden",
      },
    };
    expectSchemaFailureWithoutMutation(
      contract.PROVENANCE_RECORD_SCHEMA,
      provenanceWithUnknownToolField,
      contract.SCHEMA_ISSUE_CODES.FIELD_SET,
    );
  });

  it.each([
    ["absolute POSIX", "/tmp/synthetic-mask.png"],
    ["absolute Windows", "C:\\temp\\synthetic-mask.png"],
    ["remote", "https://example.invalid/synthetic-mask.png"],
    ["data scheme", "data:image/png;base64,AAAA"],
    ["traversal", "source/assets/watch-2-5d/v1/masks/../synthetic-mask.png"],
    ["outside the approved local directory", "source/assets/watch-2-5d/v1/review/synthetic-mask.png"],
    ["unapproved public", "public/unapproved/synthetic-mask.png"],
  ])("rejects the %s path class without mutating the synthetic mask", (_label, file) => {
    expectSchemaFailureWithoutMutation(
      contract.MASK_RECORD_SCHEMA,
      syntheticMask(file),
      contract.SCHEMA_ISSUE_CODES.PATH,
      contract.LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  });

  it("closes exact provenance ancestry and reports deterministic stale-parent failures", () => {
    const provenance = syntheticProvenance();
    const before = structuredClone(provenance);
    const exactExpectation = {
      artifactId: "fill-synthetic",
      artifactSha256: FILL_HASH,
      immediateParentSha256: [SOURCE_HASH, MASK_HASH],
    };

    expect(approvalTools.evaluateProvenanceClosure(provenance, exactExpectation))
      .toMatchObject({ code: null, ok: true, reason: null });
    expect(approvalTools.evaluateProvenanceClosure(provenance, {
      ...exactExpectation,
      immediateParentSha256: [SOURCE_HASH, REPLACEMENT_HASH],
    })).toMatchObject({
      code: contract.LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      ok: false,
      reason: approvalTools.APPROVAL_TOOL_ISSUE_CODES.PROVENANCE_PARENT_MISMATCH,
    });

    const missingAncestry = {
      ...provenance,
      immediateParentSha256: [],
    };
    expect(approvalTools.evaluateProvenanceClosure(missingAncestry, exactExpectation))
      .toMatchObject({
        code: contract.LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
        ok: false,
        reason: approvalTools.APPROVAL_TOOL_ISSUE_CODES.PROVENANCE_RECORD_INVALID,
      });
    expect(provenance).toEqual(before);
  });

  it("labels reconstruction as synthetic and rejects source-truth classifications and claims", () => {
    const reconstruction = syntheticReconstruction();
    const provenance = syntheticProvenance();
    const parsedReconstruction = contract.RECONSTRUCTION_RECORD_SCHEMA.parse(
      reconstruction,
    ) as JsonRecord;
    const parsedProvenance = contract.PROVENANCE_RECORD_SCHEMA.parse(
      provenance,
    ) as JsonRecord;

    expect(parsedReconstruction).toMatchObject({
      method: "manual-paint",
      syntheticPixelCount: 16,
    });
    expect(parsedProvenance).toMatchObject({
      classification: "synthetic",
      method: "manual-paint",
    });
    expect(contract.AUTHORING_INTERPRETATION_NOTICE)
      .toContain("synthetic pixels are not recovered source truth");

    expectSchemaFailureWithoutMutation(
      contract.RECONSTRUCTION_RECORD_SCHEMA,
      { ...reconstruction, method: "source-extraction" },
      contract.SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM,
    );
    expectSchemaFailureWithoutMutation(
      contract.PROVENANCE_RECORD_SCHEMA,
      { ...provenance, classification: "recovered-source" },
      contract.SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM,
    );
    expectSchemaFailureWithoutMutation(
      contract.AUTHORING_DOCUMENT_SCHEMA,
      {
        ...syntheticFallbackAuthoring(),
        interpretationNotice: "Synthetic pixels are recovered original hidden pixels.",
      },
      contract.SCHEMA_ISSUE_CODES.VALUE,
    );
  });

  it("invalidates an approval when any bound artifact or evidence hash changes", () => {
    const record = syntheticApproval();
    const before = structuredClone(record);
    const exactExpectation = {
      approvalId: "approval-synthetic-reconstruction",
      artifactSha256: [FILL_HASH, EVIDENCE_HASH],
      layerIds: ["layer-synthetic"],
      reviewedPoseIds: ["reference-pose", "motion-extreme-positive"],
      reviewedZoomPercent: [100, 200],
      scope: "reconstruction",
    };

    expect(approvalTools.evaluateApprovalClosure(record, exactExpectation))
      .toMatchObject({
        approvalId: "approval-synthetic-reconstruction",
        eligible: true,
        ok: true,
        outcome: "approved",
        releasable: true,
      });

    expect(approvalTools.evaluateApprovalClosure(record, {
      ...exactExpectation,
      artifactSha256: [REPLACEMENT_HASH, EVIDENCE_HASH],
    })).toMatchObject({
      code: contract.LAYER_GATE_FAILURE_CODES.PROVENANCE_INVALID,
      eligible: false,
      ok: false,
      outcome: "static",
      reason: approvalTools.APPROVAL_TOOL_ISSUE_CODES.APPROVAL_HASH_MISMATCH,
      releasable: false,
    });
    expect(record).toEqual(before);
  });

  it("keeps fallback-only structurally URL-free and rejects any attached resource", () => {
    const release = syntheticFallbackRelease();
    const before = structuredClone(release);
    const parsed = contract.RELEASE_POINTER_SCHEMA.parse(release) as JsonRecord;
    const bytes = contract.RELEASE_POINTER_SCHEMA.serialize(release);

    expect(parsed).toEqual({
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    });
    expect(bytes.toString("utf8")).toBe(
      '{"depthEnabled":false,"runtimeManifest":null,"schemaVersion":1,"status":"fallback-only"}',
    );
    expect(bytes.toString("utf8")).not.toContain("/assets/watch-2-5d/");
    expect(release).toEqual(before);

    expectSchemaFailureWithoutMutation(
      contract.RELEASE_POINTER_SCHEMA,
      {
        ...release,
        runtimeManifest: {
          byteLength: 1,
          mediaType: "application/json",
          publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
          sha256: SOURCE_HASH,
        },
      },
      contract.SCHEMA_ISSUE_CODES.VALUE,
    );
    expectSchemaFailureWithoutMutation(
      contract.RELEASE_POINTER_SCHEMA,
      { ...release, releaseId: "synthetic-release" },
      contract.SCHEMA_ISSUE_CODES.FIELD_SET,
    );
  });

  it("binds each phase to exact canonical projection bytes and rejects malformed hashes", () => {
    const phases = phaseRecords();
    phases.forEach((phase, index) => {
      const projection = phaseProjection(contract.PHASE_NAMES[index], index);
      expect(phase.phasePayloadSha256).toBe(
        contract.sha256(contract.serializeCanonicalJson(projection)),
      );
      expect(() => contract.PHASE_RECORD_SCHEMA.parse(phase)).not.toThrow();
    });

    const changedProjection = {
      ...phaseProjection("approved-part-motion", 2),
      status: "pending",
    };
    expect(contract.sha256(contract.serializeCanonicalJson(changedProjection)))
      .not.toBe(phases[2].phasePayloadSha256);

    expectSchemaFailureWithoutMutation(
      contract.PHASE_RECORD_SCHEMA,
      {
        ...phases[0],
        phasePayloadSha256: String(phases[0].phasePayloadSha256).toUpperCase(),
      },
      contract.SCHEMA_ISSUE_CODES.HASH,
    );
  });

  it("accepts an empty approved-moving set as Reference Pose and fails closed otherwise", () => {
    const authoring = syntheticFallbackAuthoring();
    const before = structuredClone(authoring);
    const parsed = contract.AUTHORING_DOCUMENT_SCHEMA.parse(authoring) as JsonRecord;

    expect(parsed).toMatchObject({
      approvedMovingLayerIds: [],
      approvals: [],
      depthEnabled: false,
      layers: [],
      masks: [],
      motionProfiles: [],
      reconstructions: [],
      relationships: [],
    });
    expect(approvalTools.evaluateApprovalSetClosure({
      approvals: [],
      approvedMovingLayerIds: [],
      requirements: [],
    })).toEqual({
      approvedMovingLayerIds: [],
      failures: [],
      mode: "reference-pose",
      ok: true,
      releasable: true,
    });
    expect(authoring).toEqual(before);

    expect(approvalTools.evaluateApprovalSetClosure({
      approvals: [],
      approvedMovingLayerIds: ["layer-synthetic"],
      requirements: [],
    })).toMatchObject({
      approvedMovingLayerIds: [],
      mode: "static",
      ok: false,
      releasable: false,
    });

    expectSchemaFailureWithoutMutation(
      contract.AUTHORING_DOCUMENT_SCHEMA,
      {
        ...syntheticFallbackAuthoring(),
        approvedMovingLayerIds: ["layer-synthetic"],
      },
      contract.SCHEMA_ISSUE_CODES.VALUE,
    );

    const authoringWithPromotedCandidate = syntheticFallbackAuthoring();
    authoringWithPromotedCandidate.candidateInventory = [{
      ...((authoringWithPromotedCandidate.candidateInventory as JsonRecord[])[0]),
      disposition: "approved-moving",
    }];
    expectSchemaFailureWithoutMutation(
      contract.AUTHORING_DOCUMENT_SCHEMA,
      authoringWithPromotedCandidate,
      contract.SCHEMA_ISSUE_CODES.VALUE,
    );
  });
});
