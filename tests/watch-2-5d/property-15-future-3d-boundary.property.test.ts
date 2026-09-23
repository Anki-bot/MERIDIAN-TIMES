import { Buffer } from "node:buffer";
import fc from "fast-check";
import { expect, it } from "vitest";
import {
  RUNTIME_SCHEMA_ISSUE_CODES,
  isReadyWatchLayerRelease,
  parseWatchLayerRelease,
  safeParseRuntimeManifest,
  safeParseWatchLayerRelease,
} from "../../lib/watch-2-5d/runtime-schema";
import { CANONICAL_MASTER_SHA256 } from "../../lib/watch-2-5d/types";
import type { ProfileId, ReadyWatchLayerRelease } from "../../lib/watch-2-5d/types";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 15: Future full-3D handoff is separate and non-destructive";

// Reproduce with: seed=20260615, numRuns=128.
const PROPERTY_SEED = 20_260_615;
const PROPERTY_RUNS = 128;
const CURRENT_PUBLIC_ROOT = "/assets/watch-2-5d/v1/";
const FUTURE_PUBLIC_ROOT = "/assets/watch-full-3d/v1/";
const UTF8_ENCODER = new TextEncoder();

const MIGRATION_GATES = [
  "separate-specification",
  "appearance-fidelity",
  "behavior-parity",
  "accessibility",
  "browser-compatibility",
  "performance",
  "provenance",
  "atomic-fallback",
] as const;

type JsonRecord = Record<string, unknown>;
type PriorPresentation = "approved-2.5d" | "static-fallback";
type SelectedPresentation = PriorPresentation | "future-full-3d";
type MigrationGate = (typeof MIGRATION_GATES)[number];
type MigrationGateOutcomes = Record<MigrationGate, boolean>;
type AdditionalSourceKind = "drawing" | "measurement" | "model-source" | "photograph";
type GeometryTruthLabel = "authored-reconstruction" | "measured-evidence" | "source-recovered";
type RuntimePayloadTarget =
  | "fallback-release"
  | "ready-release"
  | "manifest-root"
  | "manifest-profile"
  | "manifest-asset";
type DeclarationFault =
  | "additional-source-license"
  | "additional-source-provenance"
  | "atomic-fallback"
  | "authored-reconstruction"
  | "canonical-hash"
  | "current-package-independence"
  | "package-namespace"
  | "package-type"
  | "semantic-correspondence"
  | "separate-specification"
  | "source-truth-claim"
  | null;

type AdditionalSourceProvenance = {
  artifactSha256: string;
  authoredAssumptions: string[];
  origin: string;
  sourceId: string;
};

type AdditionalSource = {
  id: string;
  kind: AdditionalSourceKind;
  license: string | null;
  provenance: AdditionalSourceProvenance | null;
  sha256: string;
};

type GeometryDeclaration = {
  id: string;
  measurementSourceIds: string[];
  truthLabel: GeometryTruthLabel;
};

type SemanticCorrespondence = {
  layerRecordId: string;
  semanticPartId: string;
};

type FuturePackageDeclaration = {
  additionalSources: AdditionalSource[];
  atomicFallback: {
    available: boolean;
    target: PriorPresentation;
  };
  canonicalAppearanceSha256: string;
  claims: {
    canonicalMasterAloneSuppliedHiddenGeometry: boolean;
  };
  geometry: GeometryDeclaration[];
  packageId: string;
  packageType: string;
  preservesCurrentLayerPackage: boolean;
  publicNamespace: string;
  semanticCorrespondences: SemanticCorrespondence[] | null;
  separateSpecification: {
    designApproved: boolean;
    requirementsApproved: boolean;
    tasksApproved: boolean;
  };
};

type HandoffContext = {
  approvedSemanticPartIds: readonly string[];
  currentLayerRecordIds: readonly string[];
};

type AdditionalSourceFact = {
  assumptionToken: number;
  kind: AdditionalSourceKind;
  license: string;
  originToken: number;
  sha256: string;
};

type Scenario = {
  additionalGeometryMeasured: boolean[];
  additionalSources: AdditionalSourceFact[];
  assetBytes: Uint8Array[];
  declarationFault: DeclarationFault;
  failedMigrationGate: MigrationGate | null;
  includeCorrespondences: boolean;
  packageManifestBytes: Uint8Array;
  priorPresentation: PriorPresentation;
  runtimeHash: string;
  runtimePayloadTarget: RuntimePayloadTarget;
  token: number;
  wrongHash: string;
};

type RuntimeSchemaAttempt = {
  readonly baseAccepted: boolean;
  readonly declarationAccepted: boolean;
  readonly issueCode: string | null;
};

type CurrentByteSet = {
  readonly assets: Uint8Array[];
  readonly packageManifest: Uint8Array;
  readonly releasePointer: Uint8Array;
  readonly runtimeManifest: Uint8Array;
};

const sha256Arbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString("hex"));

const additionalSourceFactArbitrary: fc.Arbitrary<AdditionalSourceFact> = fc.record({
  assumptionToken: fc.nat({ max: 1_000_000 }),
  kind: fc.constantFrom<AdditionalSourceKind>(
    "drawing",
    "measurement",
    "model-source",
    "photograph",
  ),
  license: fc.constantFrom(
    "CC-BY-4.0",
    "CC0-1.0",
    "LicenseRef-Project-Authored",
    "LicenseRef-Supplier-Evidence",
  ),
  originToken: fc.nat({ max: 1_000_000 }),
  sha256: sha256Arbitrary,
});

const declarationFaultArbitrary = fc.constantFrom<DeclarationFault>(
  null,
  "additional-source-license",
  "additional-source-provenance",
  "atomic-fallback",
  "authored-reconstruction",
  "canonical-hash",
  "current-package-independence",
  "package-namespace",
  "package-type",
  "semantic-correspondence",
  "separate-specification",
  "source-truth-claim",
);

const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  additionalGeometryMeasured: fc.array(fc.boolean(), { maxLength: 2 }),
  additionalSources: fc.array(additionalSourceFactArbitrary, {
    minLength: 1,
    maxLength: 4,
  }),
  assetBytes: fc.array(fc.uint8Array({ minLength: 1, maxLength: 64 }), {
    minLength: 1,
    maxLength: 4,
  }),
  declarationFault: declarationFaultArbitrary,
  failedMigrationGate: fc.oneof(
    fc.constant(null),
    fc.constantFrom<MigrationGate>(...MIGRATION_GATES),
  ),
  includeCorrespondences: fc.boolean(),
  packageManifestBytes: fc.uint8Array({ minLength: 1, maxLength: 96 }),
  priorPresentation: fc.constantFrom<PriorPresentation>(
    "approved-2.5d",
    "static-fallback",
  ),
  runtimeHash: sha256Arbitrary,
  runtimePayloadTarget: fc.constantFrom<RuntimePayloadTarget>(
    "fallback-release",
    "ready-release",
    "manifest-root",
    "manifest-profile",
    "manifest-asset",
  ),
  token: fc.nat({ max: 1_000_000 }),
  wrongHash: sha256Arbitrary,
});

function differentHash(candidate: string, expected: string): string {
  if (candidate !== expected) return candidate;
  return `${candidate[0] === "0" ? "1" : "0"}${candidate.slice(1)}`;
}

function createValidFutureDeclaration(
  scenario: Scenario,
): Readonly<{ declaration: FuturePackageDeclaration; context: HandoffContext }> {
  const token = scenario.token.toString(36);
  const additionalSources = scenario.additionalSources.map((fact, index) => {
    const id = `future-source-${token}-${index}`;
    return {
      id,
      kind: fact.kind,
      license: fact.license,
      provenance: {
        artifactSha256: fact.sha256,
        authoredAssumptions: [`assumption-${fact.assumptionToken.toString(36)}`],
        origin: `recorded-source-${fact.originToken.toString(36)}`,
        sourceId: id,
      },
      sha256: fact.sha256,
    } satisfies AdditionalSource;
  });
  const approvedSemanticPartIds = [
    `semantic-balance-${token}`,
    `semantic-wheel-${token}`,
  ];
  const currentLayerRecordIds = [
    `layer-balance-${token}`,
    `layer-wheel-${token}`,
  ];
  const geometry: GeometryDeclaration[] = [
    {
      id: `geometry-authored-${token}`,
      measurementSourceIds: [],
      truthLabel: "authored-reconstruction",
    },
    ...scenario.additionalGeometryMeasured.map((measured, index) => ({
      id: `geometry-${token}-${index}`,
      measurementSourceIds: measured
        ? [additionalSources[index % additionalSources.length].id]
        : [],
      truthLabel: measured ? "measured-evidence" as const : "authored-reconstruction" as const,
    })),
  ];

  return {
    context: { approvedSemanticPartIds, currentLayerRecordIds },
    declaration: {
      additionalSources,
      atomicFallback: {
        available: true,
        target: scenario.priorPresentation,
      },
      canonicalAppearanceSha256: CANONICAL_MASTER_SHA256,
      claims: {
        canonicalMasterAloneSuppliedHiddenGeometry: false,
      },
      geometry,
      packageId: `future-watch-package-${token}`,
      packageType: "full-3d-asset-package",
      preservesCurrentLayerPackage: true,
      publicNamespace: `${FUTURE_PUBLIC_ROOT}${token}/`,
      semanticCorrespondences: scenario.includeCorrespondences
        ? approvedSemanticPartIds.map((semanticPartId, index) => ({
            layerRecordId: currentLayerRecordIds[index],
            semanticPartId,
          }))
        : null,
      separateSpecification: {
        designApproved: true,
        requirementsApproved: true,
        tasksApproved: true,
      },
    },
  };
}

function applyDeclarationFault(
  valid: FuturePackageDeclaration,
  context: HandoffContext,
  fault: DeclarationFault,
  wrongHash: string,
): FuturePackageDeclaration {
  const declaration = structuredClone(valid);
  if (fault === null) return declaration;

  switch (fault) {
    case "additional-source-license":
      declaration.additionalSources[0].license = null;
      break;
    case "additional-source-provenance":
      declaration.additionalSources[0].provenance = null;
      break;
    case "atomic-fallback":
      declaration.atomicFallback.available = false;
      break;
    case "authored-reconstruction":
      declaration.geometry[0].truthLabel = "source-recovered";
      break;
    case "canonical-hash":
      declaration.canonicalAppearanceSha256 = differentHash(
        wrongHash,
        CANONICAL_MASTER_SHA256,
      );
      break;
    case "current-package-independence":
      declaration.preservesCurrentLayerPackage = false;
      break;
    case "package-namespace":
      declaration.publicNamespace = CURRENT_PUBLIC_ROOT;
      break;
    case "package-type":
      declaration.packageType = "watch-layer-runtime-package";
      break;
    case "semantic-correspondence":
      declaration.semanticCorrespondences = [{
        layerRecordId: `${context.currentLayerRecordIds[0]}-unknown`,
        semanticPartId: context.approvedSemanticPartIds[0],
      }];
      break;
    case "separate-specification":
      declaration.separateSpecification.tasksApproved = false;
      break;
    case "source-truth-claim":
      declaration.claims.canonicalMasterAloneSuppliedHiddenGeometry = true;
      break;
  }
  return declaration;
}

/** Independent metadata oracle; it does not call current runtime schema code. */
function referenceFutureHandoffValidity(
  declaration: FuturePackageDeclaration,
  context: HandoffContext,
): boolean {
  const sourceIds = new Set(declaration.additionalSources.map(({ id }) => id));
  if (sourceIds.size !== declaration.additionalSources.length) return false;

  const sourcesClose = declaration.additionalSources.every((source) => (
    source.license !== null
    && source.license.trim().length > 0
    && source.provenance !== null
    && source.provenance.sourceId === source.id
    && source.provenance.artifactSha256 === source.sha256
    && source.provenance.origin.trim().length > 0
    && source.provenance.authoredAssumptions.every((value) => value.trim().length > 0)
  ));
  const geometryIsTruthful = declaration.geometry.every((geometry) => (
    geometry.measurementSourceIds.every((sourceId) => sourceIds.has(sourceId))
    && (
      geometry.measurementSourceIds.length > 0
      || geometry.truthLabel === "authored-reconstruction"
    )
  ));

  const seenSemanticIds = new Set<string>();
  const correspondencesClose = declaration.semanticCorrespondences === null
    || declaration.semanticCorrespondences.every((correspondence) => {
      if (seenSemanticIds.has(correspondence.semanticPartId)) return false;
      seenSemanticIds.add(correspondence.semanticPartId);
      return context.approvedSemanticPartIds.includes(correspondence.semanticPartId)
        && context.currentLayerRecordIds.includes(correspondence.layerRecordId);
    });

  return declaration.packageType === "full-3d-asset-package"
    && declaration.publicNamespace.startsWith(FUTURE_PUBLIC_ROOT)
    && !declaration.publicNamespace.startsWith(CURRENT_PUBLIC_ROOT)
    && declaration.canonicalAppearanceSha256 === CANONICAL_MASTER_SHA256
    && declaration.separateSpecification.requirementsApproved
    && declaration.separateSpecification.designApproved
    && declaration.separateSpecification.tasksApproved
    && sourcesClose
    && geometryIsTruthful
    && correspondencesClose
    && declaration.atomicFallback.available
    && declaration.preservesCurrentLayerPackage
    && !declaration.claims.canonicalMasterAloneSuppliedHiddenGeometry;
}

/** Minimal pure boundary model; only a future approved spec may select 3D. */
function selectPresentationAtHandoffBoundary(input: Readonly<{
  metadataValid: boolean;
  migrationGates: MigrationGateOutcomes;
  priorPresentation: PriorPresentation;
  scope: "current-2.5d-feature" | "future-approved-spec";
}>): SelectedPresentation {
  if (input.scope !== "future-approved-spec") return input.priorPresentation;
  if (!input.metadataValid) return input.priorPresentation;
  if (MIGRATION_GATES.some((gate) => !input.migrationGates[gate])) {
    return input.priorPresentation;
  }
  return "future-full-3d";
}

function migrationGateOutcomes(failedGate: MigrationGate | null): MigrationGateOutcomes {
  const outcomes = {} as MigrationGateOutcomes;
  for (const gate of MIGRATION_GATES) outcomes[gate] = gate !== failedGate;
  return outcomes;
}

function makeAsset(
  profileId: ProfileId,
  token: string,
  sha256: string,
): JsonRecord {
  const intrinsicWidth = profileId === "compact" ? 1_380 : 2_760;
  const intrinsicHeight = profileId === "compact" ? 752 : 1_504;
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  const name = `background-${token}`;
  return {
    byteLength: 512,
    colorMetadata: { alpha: true, channels: 4, colourspace: "srgb" },
    decodedPixelCount,
    decodedRgbaByteLength: decodedPixelCount * 4,
    encoder: {
      alphaQuality: 100,
      channels: 4,
      colourspace: "srgb",
      effort: 6,
      nearLossless: false,
      quality: 95,
      smartSubsample: true,
    },
    file: `public/assets/watch-2-5d/v1/${profileId}/${name}.webp`,
    id: `${profileId}-${name}`,
    intrinsicHeight,
    intrinsicWidth,
    layerId: "reconstructed-background",
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile: profileId,
    publicPath: `/assets/watch-2-5d/v1/${profileId}/${name}.webp`,
    sha256,
    sourceRect: { height: 1_504, width: 2_760, x: 0, y: 0 },
    zOrder: 0,
  };
}

function makeProfile(profileId: ProfileId, asset: JsonRecord): JsonRecord {
  return {
    assets: [asset],
    decodedRgbaBytes: Number(asset.decodedRgbaByteLength),
    id: profileId,
    requestCountIncludingManifest: 2,
    sourceScale: profileId === "compact" ? 0.5 : 1,
    transferBytes: Number(asset.byteLength),
  };
}

function makeReadyRelease(token: string, runtimeHash: string): JsonRecord {
  return {
    depthEnabled: false,
    packageId: `watch-package-${token}`,
    releaseId: `watch-release-${token}`,
    runtimeManifest: {
      byteLength: 2_048,
      mediaType: "application/json",
      publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      sha256: runtimeHash,
    },
    schemaVersion: 1,
    status: "ready",
  };
}

function makeFallbackRelease(): JsonRecord {
  return {
    depthEnabled: false,
    runtimeManifest: null,
    schemaVersion: 1,
    status: "fallback-only",
  };
}

function makeRuntimeManifest(token: string, runtimeHash: string): JsonRecord {
  const compactAsset = makeAsset("compact", token, runtimeHash);
  const expandedAsset = makeAsset(
    "expanded",
    token,
    differentHash(runtimeHash, runtimeHash),
  );
  return {
    canonicalMasterSha256: CANONICAL_MASTER_SHA256,
    depthProfiles: [],
    motionProfiles: [],
    packageId: `watch-package-${token}`,
    phase: "static-layered-reconstruction",
    profiles: {
      compact: makeProfile("compact", compactAsset),
      expanded: makeProfile("expanded", expandedAsset),
    },
    releaseId: `watch-release-${token}`,
    schemaVersion: 1,
  };
}

function requireReadyRelease(value: JsonRecord): ReadyWatchLayerRelease {
  const parsed = parseWatchLayerRelease(value);
  if (!isReadyWatchLayerRelease(parsed)) {
    throw new Error("Generated ready release parsed as fallback-only");
  }
  return parsed;
}

function attemptCurrentRuntimeDeclaration(
  target: RuntimePayloadTarget,
  declaration: FuturePackageDeclaration,
  readyRelease: JsonRecord,
  fallbackRelease: JsonRecord,
  runtimeManifest: JsonRecord,
): RuntimeSchemaAttempt {
  if (target === "fallback-release" || target === "ready-release") {
    const base = target === "fallback-release" ? fallbackRelease : readyRelease;
    const baseResult = safeParseWatchLayerRelease(base);
    const payload = structuredClone(base);
    payload.full3dAssetPackage = structuredClone(declaration);
    const result = safeParseWatchLayerRelease(payload);
    return {
      baseAccepted: baseResult.success,
      declarationAccepted: result.success,
      issueCode: result.success ? null : result.error.issueCode,
    };
  }

  const compiledRelease = requireReadyRelease(readyRelease);
  const baseResult = safeParseRuntimeManifest(runtimeManifest, compiledRelease);
  const payload = structuredClone(runtimeManifest);
  const profiles = payload.profiles as Record<ProfileId, JsonRecord>;
  if (target === "manifest-root") {
    payload.full3dAssetPackage = structuredClone(declaration);
  } else if (target === "manifest-profile") {
    profiles.compact.full3dAssetPackage = structuredClone(declaration);
  } else {
    const assets = profiles.compact.assets as JsonRecord[];
    assets[0].full3dAssetPackage = structuredClone(declaration);
  }
  const result = safeParseRuntimeManifest(payload, compiledRelease);
  return {
    baseAccepted: baseResult.success,
    declarationAccepted: result.success,
    issueCode: result.success ? null : result.error.issueCode,
  };
}

function snapshotCurrentBytes(bytes: CurrentByteSet): Readonly<{
  assets: readonly string[];
  packageManifest: string;
  releasePointer: string;
  runtimeManifest: string;
}> {
  return {
    assets: bytes.assets.map((asset) => Buffer.from(asset).toString("hex")),
    packageManifest: Buffer.from(bytes.packageManifest).toString("hex"),
    releasePointer: Buffer.from(bytes.releasePointer).toString("hex"),
    runtimeManifest: Buffer.from(bytes.runtimeManifest).toString("hex"),
  };
}

function serializeSeparateFutureDeclaration(
  declaration: FuturePackageDeclaration,
): Uint8Array {
  return UTF8_ENCODER.encode(JSON.stringify({
    declaration,
    handoffKind: "future-full-3d",
  }));
}

// **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.10, 15.11, 15.12, 15.13, 15.14**
it(PROPERTY_TAG, { timeout: 60_000 }, () => {
  fc.assert(
    fc.property(scenarioArbitrary, (scenario) => {
      const token = scenario.token.toString(36);
      const { declaration: validDeclaration, context } = createValidFutureDeclaration(
        scenario,
      );
      const generatedDeclaration = applyDeclarationFault(
        validDeclaration,
        context,
        scenario.declarationFault,
        scenario.wrongHash,
      );
      const validMetadata = referenceFutureHandoffValidity(validDeclaration, context);
      const generatedMetadataValid = referenceFutureHandoffValidity(
        generatedDeclaration,
        context,
      );

      expect(validMetadata).toBe(true);
      expect(generatedMetadataValid).toBe(scenario.declarationFault === null);

      const readyRelease = makeReadyRelease(token, scenario.runtimeHash);
      const fallbackRelease = makeFallbackRelease();
      const runtimeManifest = makeRuntimeManifest(token, scenario.runtimeHash);
      const readyReleaseBefore = structuredClone(readyRelease);
      const fallbackReleaseBefore = structuredClone(fallbackRelease);
      const runtimeManifestBefore = structuredClone(runtimeManifest);
      const currentBytes: CurrentByteSet = {
        assets: scenario.assetBytes.map((bytes) => bytes.slice()),
        packageManifest: scenario.packageManifestBytes.slice(),
        releasePointer: UTF8_ENCODER.encode(JSON.stringify(readyRelease)),
        runtimeManifest: UTF8_ENCODER.encode(JSON.stringify(runtimeManifest)),
      };
      const currentBytesBefore = snapshotCurrentBytes(currentBytes);

      const validSeparateHandoffBytes = serializeSeparateFutureDeclaration(validDeclaration);
      const generatedSeparateHandoffBytes = serializeSeparateFutureDeclaration(
        generatedDeclaration,
      );
      expect(validSeparateHandoffBytes.byteLength).toBeGreaterThan(0);
      expect(generatedSeparateHandoffBytes.byteLength).toBeGreaterThan(0);
      expect(snapshotCurrentBytes(currentBytes)).toEqual(currentBytesBefore);

      const runtimeAttempt = attemptCurrentRuntimeDeclaration(
        scenario.runtimePayloadTarget,
        generatedDeclaration,
        readyRelease,
        fallbackRelease,
        runtimeManifest,
      );
      expect(runtimeAttempt.baseAccepted).toBe(true);
      expect(runtimeAttempt.declarationAccepted).toBe(false);
      expect(runtimeAttempt.issueCode).toBe(RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET);
      expect(readyRelease).toEqual(readyReleaseBefore);
      expect(fallbackRelease).toEqual(fallbackReleaseBefore);
      expect(runtimeManifest).toEqual(runtimeManifestBefore);
      expect(snapshotCurrentBytes(currentBytes)).toEqual(currentBytesBefore);

      const generatedGateOutcomes = migrationGateOutcomes(
        scenario.failedMigrationGate,
      );
      expect(selectPresentationAtHandoffBoundary({
        metadataValid: generatedMetadataValid,
        migrationGates: generatedGateOutcomes,
        priorPresentation: scenario.priorPresentation,
        scope: "current-2.5d-feature",
      })).toBe(scenario.priorPresentation);

      const expectedFutureSelection: SelectedPresentation = generatedMetadataValid
        && scenario.failedMigrationGate === null
        ? "future-full-3d"
        : scenario.priorPresentation;
      expect(selectPresentationAtHandoffBoundary({
        metadataValid: generatedMetadataValid,
        migrationGates: generatedGateOutcomes,
        priorPresentation: scenario.priorPresentation,
        scope: "future-approved-spec",
      })).toBe(expectedFutureSelection);

      for (const failedGate of MIGRATION_GATES) {
        expect(selectPresentationAtHandoffBoundary({
          metadataValid: true,
          migrationGates: migrationGateOutcomes(failedGate),
          priorPresentation: scenario.priorPresentation,
          scope: "future-approved-spec",
        })).toBe(scenario.priorPresentation);
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
