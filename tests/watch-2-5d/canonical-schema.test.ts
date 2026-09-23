import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;
type StrictSchema = {
  parse(value: unknown): unknown;
  serialize(value: unknown): Buffer;
  stringify(value: unknown): string;
};

type ContractModule = {
  APPROVAL_RECORD_SCHEMA: StrictSchema;
  APPROVED_MASTER_IDENTITY: JsonRecord;
  AUTHORING_DOCUMENT_SCHEMA: StrictSchema;
  AUTHORING_INTERPRETATION_NOTICE: string;
  CANONICAL_IDENTITY_MATRIX: JsonRecord;
  CANONICAL_PROJECT_PATHS: Record<string, string>;
  CANONICAL_SOURCE_COORDINATE_SPACE: JsonRecord;
  DEPTH_PROFILE_SCHEMA: StrictSchema;
  ENHANCEMENT_BUDGETS: JsonRecord;
  GEAR_RELATIONSHIP_SCHEMA: StrictSchema;
  LAYER_ASSET_MANIFEST_SCHEMA: StrictSchema;
  LAYER_GATE_FAILURE_CODES: Record<string, string>;
  LAYER_RECORD_SCHEMA: StrictSchema;
  MASK_RECORD_SCHEMA: StrictSchema;
  MOTION_PROFILE_SCHEMA: StrictSchema;
  PHASE_NAMES: readonly string[];
  PHASE_RECORD_SCHEMA: StrictSchema;
  PREDECESSOR_MANIFEST_IDENTITY: JsonRecord;
  PROVENANCE_RECORD_SCHEMA: StrictSchema;
  PUBLIC_ASSET_RECORD_SCHEMA: StrictSchema;
  RECONSTRUCTION_RECORD_SCHEMA: StrictSchema;
  RELEASE_POINTER_SCHEMA: StrictSchema;
  RUNTIME_MANIFEST_SCHEMA: StrictSchema;
  SCHEMA_ISSUE_CODES: Record<string, string>;
  canonicalJsonStringify(value: unknown): string;
  canonicalizeJson(value: unknown): unknown;
  parseCanonicalJson(
    input: string | Uint8Array,
    options?: { allowTrailingNewline?: boolean; requireCanonical?: boolean },
  ): unknown;
  serializeCanonicalJson(value: unknown): Buffer;
};

const moduleUrl = `file://${resolve(
  process.cwd(),
  "scripts/watch-2-5d/contract.mjs",
)}`;
const contract = (await import(
  /* @vite-ignore -- executable ESM is typed by the local contract above. */
  moduleUrl
)) as unknown as ContractModule;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function phaseRecords(): JsonRecord[] {
  return contract.PHASE_NAMES.map((name, ordinal) => ({
    assetSha256: [],
    name,
    ordinal,
    phasePayloadSha256: HASH_A,
    runtimeManifestSha256: null,
    status: ordinal === 0 ? "approved" : "disabled",
  }));
}

function maskRecord(): JsonRecord {
  return {
    alphaSum: 255,
    file: "source/assets/watch-2-5d/v1/masks/example-mask.png",
    height: 1504,
    id: "mask-example",
    nonZeroPixelCount: 1,
    provenanceId: "provenance-mask",
    sha256: HASH_A,
    tightBounds: { height: 1, width: 1, x: 12, y: 34 },
    width: 2760,
  };
}

function layerRecord(): JsonRecord {
  return {
    approvalIds: [],
    disposition: "static",
    id: "layer-example",
    provenanceIds: ["provenance-layer"],
    reconstructedPixelCount: 0,
    referenceTransform: { ...contract.CANONICAL_IDENTITY_MATRIX },
    segmentationMaskId: "mask-example",
    semanticClass: "bridge",
    sourceRect: { height: 20, width: 40, x: 10, y: 30 },
    sourceVisiblePixelCount: 1,
    zOrder: 2,
  };
}

function reconstructionRecord(): JsonRecord {
  return {
    approvalId: "approval-reconstruction",
    boundaryMaskId: "mask-boundary",
    fillFile: "source/assets/watch-2-5d/v1/reconstruction/example-fill.png",
    fillId: "fill-example",
    fillSha256: HASH_B,
    id: "reconstruction-example",
    method: "manual-paint",
    provenanceId: "provenance-fill",
    regionMaskId: "mask-region",
    syntheticPixelCount: 12,
  };
}

function provenanceRecord(): JsonRecord {
  return {
    artifactId: "mask-example",
    artifactSha256: HASH_A,
    classification: "source-derived",
    createdAt: "2026-05-17T12:34:56.000Z",
    id: "provenance-mask",
    immediateParentSha256: [HASH_B],
    method: "manual-mask",
    operator: "review-operator",
    settings: { featherPixels: 2, preserveAlpha: true },
    tool: { name: "Local Raster Editor", version: "1.0.0" },
  };
}

function approvalRecord(): JsonRecord {
  return {
    artifactSha256: [HASH_A],
    decision: "approved",
    id: "approval-segmentation",
    layerIds: ["layer-example"],
    notes: "Reviewed exact mask evidence.",
    reviewedAt: "2026-05-17T13:00:00.000Z",
    reviewedPoseIds: ["reference-pose"],
    reviewedZoomPercent: [100, 200],
    reviewer: "visual-reviewer",
    scope: "segmentation",
  };
}

function motionProfile(): JsonRecord {
  return {
    approvalId: "approval-motion",
    direction: 1,
    evidence: "authored-assumption",
    id: "motion-example",
    kind: "continuous-rotation",
    layerId: "layer-example",
    maxRadians: Math.PI * 2,
    minRadians: 0,
    periodMs: 60_000,
    phaseRadians: 0,
    pivot: { x: 20.5, y: 40.5 },
    referenceRadians: 0,
  };
}

function relationshipRecord(): JsonRecord {
  return {
    approvalId: "approval-motion",
    direction: "opposite",
    drivenLayerId: "layer-driven",
    drivenToothCount: 20,
    driverLayerId: "layer-driver",
    driverToothCount: 10,
    evidence: "authored-assumption",
    id: "relationship-example",
  };
}

function depthProfile(): JsonRecord {
  return {
    authoredInterpretation: true,
    enabled: false,
    id: "depth-compact",
    layers: [],
    periodMs: 28_000,
    profile: "compact",
  };
}

function publicAssetRecord(profile: "compact" | "expanded" = "compact"): JsonRecord {
  const width = profile === "compact" ? 20 : 40;
  const height = profile === "compact" ? 10 : 20;
  return {
    byteLength: 512,
    colorMetadata: { alpha: true, channels: 4, colourspace: "srgb" },
    decodedPixelCount: width * height,
    decodedRgbaByteLength: width * height * 4,
    encoder: {
      alphaQuality: 100,
      channels: 4,
      colourspace: "srgb",
      effort: 6,
      nearLossless: false,
      quality: 95,
      smartSubsample: true,
    },
    file: `public/assets/watch-2-5d/v1/${profile}/layer-example.webp`,
    id: `asset-${profile}`,
    intrinsicHeight: height,
    intrinsicWidth: width,
    layerId: "layer-example",
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile,
    publicPath: `/assets/watch-2-5d/v1/${profile}/layer-example.webp`,
    sha256: profile === "compact" ? HASH_C : HASH_D,
    sourceRect: { height: 20, width: 40, x: 10, y: 30 },
    zOrder: 2,
  };
}

function authoringDocument(): JsonRecord {
  return {
    approvedMovingLayerIds: [],
    approvals: [],
    authoredInterpretation: true,
    candidateInventory: [],
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

function packageManifest(): JsonRecord {
  return {
    approvals: [],
    budgets: structuredClone(contract.ENHANCEMENT_BUDGETS),
    canonicalMaster: structuredClone(contract.APPROVED_MASTER_IDENTITY),
    depthProfiles: [],
    layers: [],
    masks: [],
    motionProfiles: [],
    packageId: "watch-layer-package",
    packageVersion: "1.0.0",
    parentSpec: contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    phases: phaseRecords(),
    predecessorContract: structuredClone(contract.PREDECESSOR_MANIFEST_IDENTITY),
    provenance: [],
    publicAssets: [],
    reconstructions: [],
    relationships: [],
    runtimeManifest: null,
    schemaVersion: 1,
    sourceCoordinateSpace: structuredClone(contract.CANONICAL_SOURCE_COORDINATE_SPACE),
    sourceDateEpoch: 1_700_000_000,
  };
}

function runtimeManifest(): JsonRecord {
  return {
    canonicalMasterSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
    depthProfiles: [],
    motionProfiles: [],
    packageId: "watch-layer-package",
    phase: "static-layered-reconstruction",
    profiles: {
      compact: {
        assets: [],
        decodedRgbaBytes: 0,
        id: "compact",
        requestCountIncludingManifest: 1,
        sourceScale: 0.5,
        transferBytes: 0,
      },
      expanded: {
        assets: [],
        decodedRgbaBytes: 0,
        id: "expanded",
        requestCountIncludingManifest: 1,
        sourceScale: 1,
        transferBytes: 0,
      },
    },
    releaseId: "release-v1",
    schemaVersion: 1,
  };
}

function expectSchemaFailure(
  operation: () => unknown,
  issueCode: string,
  code = contract.LAYER_GATE_FAILURE_CODES.SCHEMA_INVALID,
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code, issueCode, name: "WatchLayerSchemaError" });
    return;
  }
  throw new Error("Expected schema operation to fail");
}

describe("watch 2.5D canonical JSON", () => {
  it("sorts every object key without mutating input and is byte-stable", () => {
    const source = {
      zebra: 1,
      alpha: { zulu: true, beta: [3, { y: 2, a: 1 }] },
    };
    const originalTopLevelOrder = Object.keys(source);
    const expected = '{"alpha":{"beta":[3,{"a":1,"y":2}],"zulu":true},"zebra":1}';

    expect(contract.canonicalJsonStringify(source)).toBe(expected);
    expect(contract.serializeCanonicalJson(source)).toEqual(Buffer.from(expected));
    expect(contract.serializeCanonicalJson(source)).toEqual(contract.serializeCanonicalJson(source));
    expect(Object.keys(source)).toEqual(originalTopLevelOrder);
    expect(contract.parseCanonicalJson(expected, { requireCanonical: true })).toEqual({
      alpha: { beta: [3, { a: 1, y: 2 }], zulu: true },
      zebra: 1,
    });

    const magicKeys = JSON.parse(
      '{"2":"two","10":"ten","__proto__":{"inherited":true},"a":1}',
    ) as JsonRecord;
    const magicClone = contract.canonicalizeJson(magicKeys) as JsonRecord;
    expect(contract.canonicalJsonStringify(magicKeys)).toBe(
      '{"10":"ten","2":"two","__proto__":{"inherited":true},"a":1}',
    );
    expect(Object.getPrototypeOf(magicClone)).toBe(Object.prototype);
    expect(Object.hasOwn(magicClone, "__proto__")).toBe(true);
    expect((magicClone as { inherited?: unknown }).inherited).toBeUndefined();
  });

  it("rejects malformed JSON, malformed UTF-8, and values JSON cannot represent", () => {
    expect(() => contract.parseCanonicalJson("{broken"))
      .toThrowError(expect.objectContaining({ code: "LAYER_SCHEMA_INVALID", issueCode: "SCHEMA_JSON_MALFORMED" }));
    expect(() => contract.parseCanonicalJson(Buffer.from([
      0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d,
    ])))
      .toThrowError(expect.objectContaining({ code: "LAYER_SCHEMA_INVALID", issueCode: "SCHEMA_JSON_MALFORMED" }));
    expect(() => contract.canonicalizeJson({ invalid: Number.POSITIVE_INFINITY }))
      .toThrowError(expect.objectContaining({ code: "LAYER_SCHEMA_INVALID", issueCode: "SCHEMA_NUMBER_NONFINITE" }));
  });
});

describe("watch 2.5D strict schema families", () => {
  it("accepts every approved record and document family", () => {
    const validCases: readonly [StrictSchema, unknown][] = [
      [contract.MASK_RECORD_SCHEMA, maskRecord()],
      [contract.LAYER_RECORD_SCHEMA, layerRecord()],
      [contract.RECONSTRUCTION_RECORD_SCHEMA, reconstructionRecord()],
      [contract.PROVENANCE_RECORD_SCHEMA, provenanceRecord()],
      [contract.APPROVAL_RECORD_SCHEMA, approvalRecord()],
      [contract.MOTION_PROFILE_SCHEMA, motionProfile()],
      [contract.GEAR_RELATIONSHIP_SCHEMA, relationshipRecord()],
      [contract.DEPTH_PROFILE_SCHEMA, depthProfile()],
      [contract.PHASE_RECORD_SCHEMA, phaseRecords()[0]],
      [contract.PUBLIC_ASSET_RECORD_SCHEMA, publicAssetRecord()],
      [contract.AUTHORING_DOCUMENT_SCHEMA, authoringDocument()],
      [contract.LAYER_ASSET_MANIFEST_SCHEMA, packageManifest()],
      [contract.RUNTIME_MANIFEST_SCHEMA, runtimeManifest()],
      [contract.RELEASE_POINTER_SCHEMA, {
        depthEnabled: false,
        runtimeManifest: null,
        schemaVersion: 1,
        status: "fallback-only",
      }],
    ];

    for (const [schema, value] of validCases) {
      expect(() => schema.parse(value)).not.toThrow();
    }
  });

  it("rejects unknown fields in every record and document family", () => {
    const strictCases: readonly [StrictSchema, JsonRecord][] = [
      [contract.MASK_RECORD_SCHEMA, maskRecord()],
      [contract.LAYER_RECORD_SCHEMA, layerRecord()],
      [contract.RECONSTRUCTION_RECORD_SCHEMA, reconstructionRecord()],
      [contract.PROVENANCE_RECORD_SCHEMA, provenanceRecord()],
      [contract.APPROVAL_RECORD_SCHEMA, approvalRecord()],
      [contract.MOTION_PROFILE_SCHEMA, motionProfile()],
      [contract.GEAR_RELATIONSHIP_SCHEMA, relationshipRecord()],
      [contract.DEPTH_PROFILE_SCHEMA, depthProfile()],
      [contract.PHASE_RECORD_SCHEMA, phaseRecords()[0]],
      [contract.PUBLIC_ASSET_RECORD_SCHEMA, publicAssetRecord()],
      [contract.AUTHORING_DOCUMENT_SCHEMA, authoringDocument()],
      [contract.LAYER_ASSET_MANIFEST_SCHEMA, packageManifest()],
      [contract.RUNTIME_MANIFEST_SCHEMA, runtimeManifest()],
      [contract.RELEASE_POINTER_SCHEMA, {
        depthEnabled: false,
        runtimeManifest: null,
        schemaVersion: 1,
        status: "fallback-only",
      }],
    ];

    for (const [schema, value] of strictCases) {
      expectSchemaFailure(
        () => schema.parse({ ...value, unexpectedField: true }),
        contract.SCHEMA_ISSUE_CODES.FIELD_SET,
      );
    }
  });

  it("returns deterministic codes for duplicate IDs, nonfinite numbers, bounds, and unsupported classes", () => {
    const duplicate = authoringDocument();
    duplicate.candidateInventory = [
      {
        disposition: "proposed-static",
        id: "candidate-wheel",
        possibleClasses: ["exposed-gear"],
        sourceRect: { height: 10, width: 10, x: 0, y: 0 },
        uncertaintyNotes: "Static until reviewed.",
      },
      {
        disposition: "proposed-static",
        id: "candidate-wheel",
        possibleClasses: ["exposed-rotor"],
        sourceRect: { height: 10, width: 10, x: 20, y: 20 },
        uncertaintyNotes: "Still static.",
      },
    ];
    expectSchemaFailure(
      () => contract.AUTHORING_DOCUMENT_SCHEMA.parse(duplicate),
      contract.SCHEMA_ISSUE_CODES.DUPLICATE_ID,
    );

    expectSchemaFailure(
      () => contract.MOTION_PROFILE_SCHEMA.parse({ ...motionProfile(), periodMs: Number.NaN }),
      contract.SCHEMA_ISSUE_CODES.NONFINITE_NUMBER,
    );

    expectSchemaFailure(
      () => contract.MASK_RECORD_SCHEMA.parse({
        ...maskRecord(),
        tightBounds: { height: 1, width: 2, x: 2759, y: 0 },
      }),
      contract.SCHEMA_ISSUE_CODES.OUT_OF_BOUNDS,
    );

    expectSchemaFailure(
      () => contract.LAYER_RECORD_SCHEMA.parse({ ...layerRecord(), semanticClass: "invented-mechanism" }),
      contract.SCHEMA_ISSUE_CODES.UNSUPPORTED_ENUM,
    );

    const collidingRuntime = runtimeManifest();
    const profiles = collidingRuntime.profiles as Record<"compact" | "expanded", JsonRecord>;
    profiles.compact = {
      ...profiles.compact,
      assets: [{ ...publicAssetRecord("compact"), id: "asset-shared" }],
      decodedRgbaBytes: 800,
      requestCountIncludingManifest: 2,
      transferBytes: 512,
    };
    profiles.expanded = {
      ...profiles.expanded,
      assets: [{ ...publicAssetRecord("expanded"), id: "asset-shared" }],
      decodedRgbaBytes: 3_200,
      requestCountIncludingManifest: 2,
      transferBytes: 512,
    };
    expectSchemaFailure(
      () => contract.RUNTIME_MANIFEST_SCHEMA.parse(collidingRuntime),
      contract.SCHEMA_ISSUE_CODES.DUPLICATE_ID,
    );
  });

  it("enforces lowercase hashes, strict UTC timestamps, and approved local paths", () => {
    expectSchemaFailure(
      () => contract.MASK_RECORD_SCHEMA.parse({ ...maskRecord(), sha256: HASH_A.toUpperCase() }),
      contract.SCHEMA_ISSUE_CODES.HASH,
    );
    expectSchemaFailure(
      () => contract.PROVENANCE_RECORD_SCHEMA.parse({
        ...provenanceRecord(),
        createdAt: "2026-05-17T13:00:00+00:00",
      }),
      contract.SCHEMA_ISSUE_CODES.TIMESTAMP,
    );
    expectSchemaFailure(
      () => contract.MASK_RECORD_SCHEMA.parse({ ...maskRecord(), file: "../outside.png" }),
      contract.SCHEMA_ISSUE_CODES.PATH,
      contract.LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
    expectSchemaFailure(
      () => contract.PUBLIC_ASSET_RECORD_SCHEMA.parse({
        ...publicAssetRecord(),
        publicPath: "/assets/watch-2-5d/v1/compact/different-layer.webp",
      }),
      contract.SCHEMA_ISSUE_CODES.PATH,
      contract.LAYER_GATE_FAILURE_CODES.PATH_INVALID,
    );
  });

  it("serializes validated documents canonically and keeps fallback-only URL-free", () => {
    const fallback = {
      status: "fallback-only",
      schemaVersion: 1,
      runtimeManifest: null,
      depthEnabled: false,
    };
    const first = contract.RELEASE_POINTER_SCHEMA.serialize(fallback);
    const second = contract.RELEASE_POINTER_SCHEMA.serialize(structuredClone(fallback));

    expect(first).toEqual(second);
    expect(first.toString("utf8")).toBe(
      '{"depthEnabled":false,"runtimeManifest":null,"schemaVersion":1,"status":"fallback-only"}',
    );
    expect(first.toString("utf8")).not.toContain("/assets/watch-2-5d/");
  });
});
