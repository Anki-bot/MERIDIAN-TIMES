import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { expect, it } from "vitest";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 12: Profile budgets and request membership";

// Reproduce with: seed=20260607, numRuns=128.
const PROPERTY_SEED = 20_260_607;
const PROPERTY_RUNS = 128;
const PROFILE_LIMITS = Object.freeze({
  compact: Object.freeze({
    maxDecodedRgbaBytes: 25_165_824,
    maxTransferBytes: 1_572_864,
  }),
  expanded: Object.freeze({
    maxDecodedRgbaBytes: 50_331_648,
    maxTransferBytes: 3_145_728,
  }),
  maxRequestsIncludingRuntimeManifest: 8,
});

const ISSUE_CODES = Object.freeze({
  aggregate: "PROFILE_BUDGET_AGGREGATE_MISMATCH",
  budget: "PROFILE_BUDGET_EXCEEDED",
  duplicatePath: "PROFILE_BUDGET_DUPLICATE_PATH",
  input: "PROFILE_BUDGET_INPUT_INVALID",
  membership: "PROFILE_BUDGET_MEMBERSHIP_MISMATCH",
});

type ProfileId = "compact" | "expanded";
type Dimensions = Readonly<{
  height: number;
  width: number;
}>;
type ProfileAsset = {
  byteLength: number;
  decodedPixelCount: number;
  decodedRgbaByteLength: number;
  file: string;
  id: string;
  intrinsicHeight: number;
  intrinsicWidth: number;
  profile: ProfileId;
  publicPath: string;
};
type EnhancementProfile = {
  assets: ProfileAsset[];
  decodedRgbaBytes: number;
  id: ProfileId;
  requestCountIncludingManifest: number;
  sourceScale: 0.5 | 1;
  transferBytes: number;
};
type BudgetInput = {
  budgets: typeof PROFILE_LIMITS;
  manifestAssets: ProfileAsset[];
  profiles: Record<ProfileId, EnhancementProfile> | null;
  releaseStatus?: "fallback-only" | "ready";
  runtimeManifestByteLength: number;
};
type BudgetEvaluation = {
  readonly issueCode: string | null;
  readonly ok: boolean;
  readonly profiles: Readonly<Record<ProfileId, {
    readonly decodedRgbaBytes: number;
    readonly requestCountIncludingManifest: number;
    readonly transferBytes: number;
    readonly transferBytesIncludingManifest: number;
  }>> | null;
};
type BudgetModule = {
  evaluateWatchLayerProfileBudget(value: BudgetInput): BudgetEvaluation;
};
type ContractModule = {
  readonly ENHANCEMENT_BUDGETS: typeof PROFILE_LIMITS;
};

const projectRoot = process.cwd();
const budgetModule = await import(
  /* @vite-ignore -- executable ESM is explicitly typed above. */
  pathToFileURL(resolve(projectRoot, "scripts/watch-2-5d/profile-budget.mjs")).href
) as unknown as BudgetModule;
const contract = await import(
  /* @vite-ignore -- executable ESM is explicitly typed above. */
  pathToFileURL(resolve(projectRoot, "scripts/watch-2-5d/contract.mjs")).href
) as unknown as ContractModule;

const EXACT_DECODE_DIMENSIONS: Readonly<Record<ProfileId, readonly Dimensions[]>> =
  Object.freeze({
    compact: Object.freeze([
      Object.freeze({ height: 1_504, width: 2_760 }),
      Object.freeze({ height: 775, width: 2_760 }),
      Object.freeze({ height: 1, width: 1_416 }),
    ]),
    expanded: Object.freeze([
      Object.freeze({ height: 1_504, width: 2_760 }),
      Object.freeze({ height: 1_504, width: 2_760 }),
      Object.freeze({ height: 1_504, width: 2_760 }),
      Object.freeze({ height: 47, width: 2_760 }),
      Object.freeze({ height: 1, width: 72 }),
    ]),
  });

function splitTotal(total: number, count: number, salt: number): number[] {
  if (count < 1 || total < count) throw new Error("Generated totals must fund every asset");
  const values = Array.from({ length: count }, () => 1);
  const remaining = total - count;
  const quotient = Math.floor(remaining / count);
  const remainder = remaining % count;
  for (let index = 0; index < count; index += 1) values[index] += quotient;
  const start = (salt >>> 0) % count;
  for (let index = 0; index < remainder; index += 1) {
    values[(start + index) % count] += 1;
  }
  return values;
}

function rotateDimensions(values: readonly Dimensions[], salt: number): Dimensions[] {
  const start = (salt >>> 0) % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

function makeAssets(
  profile: ProfileId,
  dimensions: readonly Dimensions[],
  transferBytes: number,
  salt: number,
): ProfileAsset[] {
  const transfers = splitTotal(transferBytes, dimensions.length, salt);
  const token = (salt >>> 0).toString(36);
  return dimensions.map(({ height, width }, index) => {
    const name = `${profile}-${token}-${index}`;
    const decodedPixelCount = width * height;
    return {
      byteLength: transfers[index],
      decodedPixelCount,
      decodedRgbaByteLength: decodedPixelCount * 4,
      file: `public/assets/watch-2-5d/v1/${profile}/${name}.webp`,
      id: name,
      intrinsicHeight: height,
      intrinsicWidth: width,
      profile,
      publicPath: `/assets/watch-2-5d/v1/${profile}/${name}.webp`,
    };
  });
}

function makeProfile(profile: ProfileId, assets: ProfileAsset[]): EnhancementProfile {
  return {
    assets,
    decodedRgbaBytes: assets.reduce(
      (total, asset) => total + asset.decodedRgbaByteLength,
      0,
    ),
    id: profile,
    requestCountIncludingManifest: assets.length + 1,
    sourceScale: profile === "compact" ? 0.5 : 1,
    transferBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
  };
}

function makeFixture(options: {
  compactDimensions: readonly Dimensions[];
  compactTransferBytes: number;
  expandedDimensions: readonly Dimensions[];
  expandedTransferBytes: number;
  runtimeManifestByteLength: number;
  salt: number;
}): BudgetInput {
  const compactAssets = makeAssets(
    "compact",
    options.compactDimensions,
    options.compactTransferBytes,
    options.salt,
  );
  const expandedAssets = makeAssets(
    "expanded",
    options.expandedDimensions,
    options.expandedTransferBytes,
    options.salt ^ 0x6d2b_79f5,
  );
  return {
    budgets: PROFILE_LIMITS,
    manifestAssets: structuredClone([...compactAssets, ...expandedAssets]),
    profiles: {
      compact: makeProfile("compact", compactAssets),
      expanded: makeProfile("expanded", expandedAssets),
    },
    releaseStatus: "ready",
    runtimeManifestByteLength: options.runtimeManifestByteLength,
  };
}

function requireProfiles(
  fixture: BudgetInput,
): Record<ProfileId, EnhancementProfile> {
  if (fixture.profiles === null) throw new Error("Ready fixture must contain profiles");
  return fixture.profiles;
}

function refreshProfile(fixture: BudgetInput, profileId: ProfileId): void {
  const profiles = requireProfiles(fixture);
  profiles[profileId] = makeProfile(profileId, profiles[profileId].assets);
}

function matchingManifestAsset(
  fixture: BudgetInput,
  runtimeAsset: ProfileAsset,
): ProfileAsset {
  const match = fixture.manifestAssets.find(({ id }) => id === runtimeAsset.id);
  if (match === undefined) throw new Error("Generated manifest asset is missing");
  return match;
}

function mutateMatchingAsset(
  fixture: BudgetInput,
  profileId: ProfileId,
  mutate: (asset: ProfileAsset) => void,
): void {
  const runtimeAsset = requireProfiles(fixture)[profileId].assets[0];
  const manifestAsset = matchingManifestAsset(fixture, runtimeAsset);
  mutate(runtimeAsset);
  mutate(manifestAsset);
  refreshProfile(fixture, profileId);
}

function expectEvaluation(
  fixture: BudgetInput,
  expectedIssueCode: string | null,
): BudgetEvaluation {
  const before = structuredClone(fixture);
  const result = budgetModule.evaluateWatchLayerProfileBudget(fixture);
  expect(fixture).toEqual(before);
  expect(result.ok).toBe(expectedIssueCode === null);
  expect(result.issueCode).toBe(expectedIssueCode);
  return result;
}

function exactBoundaryFixture(
  salt: number,
  runtimeManifestByteLength: number,
): BudgetInput {
  return makeFixture({
    compactDimensions: rotateDimensions(EXACT_DECODE_DIMENSIONS.compact, salt),
    compactTransferBytes:
      PROFILE_LIMITS.compact.maxTransferBytes - runtimeManifestByteLength,
    expandedDimensions: rotateDimensions(EXACT_DECODE_DIMENSIONS.expanded, salt),
    expandedTransferBytes:
      PROFILE_LIMITS.expanded.maxTransferBytes - runtimeManifestByteLength,
    runtimeManifestByteLength,
    salt,
  });
}

function smallDimensions(count: number, salt: number): Dimensions[] {
  return Array.from({ length: count }, (_, index) => ({
    height: 1 + (((salt >>> 0) + index * 17) % 31),
    width: 1 + (((salt >>> 0) + index * 29) % 37),
  }));
}

function requestBoundaryFixture(
  profileId: ProfileId,
  imageCount: number,
  salt: number,
  runtimeManifestByteLength: number,
): BudgetInput {
  const compactCount = profileId === "compact" ? imageCount : 1;
  const expandedCount = profileId === "expanded" ? imageCount : 1;
  return makeFixture({
    compactDimensions: smallDimensions(compactCount, salt),
    compactTransferBytes: compactCount * 101,
    expandedDimensions: smallDimensions(expandedCount, salt ^ 0x47a9_3f21),
    expandedTransferBytes: expandedCount * 103,
    runtimeManifestByteLength,
    salt,
  });
}

function mutateOneFinalizedPixel(
  fixture: BudgetInput,
  profileId: ProfileId,
): void {
  const profiles = requireProfiles(fixture);
  const runtimeAsset = profiles[profileId].assets.find(({ intrinsicWidth }) => (
    intrinsicWidth < 2_760
  ));
  if (runtimeAsset === undefined) throw new Error("Expected a width-adjustable asset");
  const manifestAsset = matchingManifestAsset(fixture, runtimeAsset);
  for (const asset of [runtimeAsset, manifestAsset]) {
    asset.intrinsicWidth += 1;
    asset.decodedPixelCount = asset.intrinsicWidth * asset.intrinsicHeight;
    asset.decodedRgbaByteLength = asset.decodedPixelCount * 4;
  }
  refreshProfile(fixture, profileId);
}

function malformedPathMutations(
  fixture: BudgetInput,
  profileId: ProfileId,
): BudgetInput[] {
  const otherProfile = profileId === "compact" ? "expanded" : "compact";
  const profiles = requireProfiles(fixture);
  const original = profiles[profileId].assets[0];
  const malformedPublicPaths = [
    `https://example.invalid/assets/watch-2-5d/v1/${profileId}/foreign.webp`,
    `//example.invalid/assets/watch-2-5d/v1/${profileId}/foreign.webp`,
    `/assets/watch-2-5d/v1/${profileId}/../${otherProfile}/foreign.webp`,
    `/assets/watch-2-5d/v1/${profileId}/nested/foreign.webp`,
    `/assets/watch-2-5d/v1/${profileId}/foreign.webp?cache=1`,
    `/assets/watch-2-5d/v1/${otherProfile}/foreign.webp`,
  ];
  const variants = malformedPublicPaths.map((publicPath) => {
    const malformed = structuredClone(fixture);
    mutateMatchingAsset(malformed, profileId, (asset) => {
      asset.publicPath = publicPath;
    });
    return malformed;
  });
  const absoluteFile = structuredClone(fixture);
  mutateMatchingAsset(absoluteFile, profileId, (asset) => {
    asset.file = `/tmp/${original.id}.webp`;
    asset.publicPath = `/tmp/${original.id}.webp`;
  });
  variants.push(absoluteFile);
  return variants;
}

const generatedManifestFacts = fc.record({
  runtimeManifestByteLength: fc.integer({ min: 1, max: 65_536 }),
  salt: fc.integer(),
});

// **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.13, 13.5**
it(PROPERTY_TAG, { timeout: 60_000 }, () => {
  fc.assert(
    fc.property(generatedManifestFacts, ({ runtimeManifestByteLength, salt }) => {
      expect(contract.ENHANCEMENT_BUDGETS).toMatchObject(PROFILE_LIMITS);

      const fallbackOnly: BudgetInput = {
        budgets: PROFILE_LIMITS,
        manifestAssets: [],
        profiles: null,
        releaseStatus: "fallback-only",
        runtimeManifestByteLength: 0,
      };
      const fallbackResult = expectEvaluation(fallbackOnly, null);
      expect(fallbackResult.profiles).toEqual({
        compact: {
          decodedRgbaBytes: 0,
          requestCountIncludingManifest: 0,
          transferBytes: 0,
          transferBytesIncludingManifest: 0,
        },
        expanded: {
          decodedRgbaBytes: 0,
          requestCountIncludingManifest: 0,
          transferBytes: 0,
          transferBytesIncludingManifest: 0,
        },
      });
      const fallbackWithRequest = structuredClone(fallbackOnly);
      fallbackWithRequest.runtimeManifestByteLength = 1;
      expectEvaluation(fallbackWithRequest, ISSUE_CODES.membership);

      const exact = exactBoundaryFixture(salt, runtimeManifestByteLength);
      const accepted = expectEvaluation(exact, null);
      for (const profileId of ["compact", "expanded"] as const) {
        const profiles = requireProfiles(exact);
        const computed = accepted.profiles?.[profileId];
        expect(computed?.transferBytesIncludingManifest)
          .toBe(PROFILE_LIMITS[profileId].maxTransferBytes);
        expect(computed?.decodedRgbaBytes)
          .toBe(PROFILE_LIMITS[profileId].maxDecodedRgbaBytes);
        expect(profiles[profileId].assets.every((asset) => (
          asset.decodedPixelCount === asset.intrinsicWidth * asset.intrinsicHeight
          && asset.decodedRgbaByteLength === asset.decodedPixelCount * 4
        ))).toBe(true);

        const missingMember = structuredClone(exact);
        requireProfiles(missingMember)[profileId].assets.pop();
        refreshProfile(missingMember, profileId);
        expectEvaluation(missingMember, ISSUE_CODES.membership);

        const foreignMember = structuredClone(exact);
        const foreignProfiles = requireProfiles(foreignMember);
        const original = foreignProfiles[profileId].assets[0];
        const foreignName = `${profileId}-foreign-${(salt >>> 0).toString(36)}`;
        foreignProfiles[profileId].assets[0] = {
          ...original,
          file: `public/assets/watch-2-5d/v1/${profileId}/${foreignName}.webp`,
          id: foreignName,
          publicPath: `/assets/watch-2-5d/v1/${profileId}/${foreignName}.webp`,
        };
        refreshProfile(foreignMember, profileId);
        expectEvaluation(foreignMember, ISSUE_CODES.membership);

        const profileCrossing = structuredClone(exact);
        const crossingProfiles = requireProfiles(profileCrossing);
        const otherProfile = profileId === "compact" ? "expanded" : "compact";
        crossingProfiles[profileId].assets[0] = structuredClone(
          crossingProfiles[otherProfile].assets[0],
        );
        refreshProfile(profileCrossing, profileId);
        expectEvaluation(profileCrossing, ISSUE_CODES.input);

        for (const malformedPath of malformedPathMutations(exact, profileId)) {
          expectEvaluation(malformedPath, ISSUE_CODES.input);
        }

        const duplicateRequest = structuredClone(exact);
        const duplicateProfiles = requireProfiles(duplicateRequest);
        const duplicate = {
          ...duplicateProfiles[profileId].assets[0],
          id: `${duplicateProfiles[profileId].assets[0].id}-duplicate`,
        };
        duplicateProfiles[profileId].assets.push(duplicate);
        duplicateRequest.manifestAssets.push(structuredClone(duplicate));
        refreshProfile(duplicateRequest, profileId);
        expectEvaluation(duplicateRequest, ISSUE_CODES.duplicatePath);

        const missingManifestRequest = structuredClone(exact);
        const missingManifestProfiles = requireProfiles(missingManifestRequest);
        missingManifestProfiles[profileId].requestCountIncludingManifest =
          missingManifestProfiles[profileId].assets.length;
        expectEvaluation(missingManifestRequest, ISSUE_CODES.aggregate);

        const staleTransferTotal = structuredClone(exact);
        requireProfiles(staleTransferTotal)[profileId].transferBytes += 1;
        expectEvaluation(staleTransferTotal, ISSUE_CODES.aggregate);

        const staleDecodedTotal = structuredClone(exact);
        requireProfiles(staleDecodedTotal)[profileId].decodedRgbaBytes += 1;
        expectEvaluation(staleDecodedTotal, ISSUE_CODES.aggregate);

        const overFinalizedImageBytes = structuredClone(exact);
        mutateMatchingAsset(overFinalizedImageBytes, profileId, (asset) => {
          asset.byteLength += 1;
        });
        expectEvaluation(overFinalizedImageBytes, ISSUE_CODES.budget);

        const overManifestBytes = structuredClone(exact);
        overManifestBytes.runtimeManifestByteLength += 1;
        expectEvaluation(overManifestBytes, ISSUE_CODES.budget);

        const oneByteOverDecodedDeclaration = structuredClone(exact);
        mutateMatchingAsset(oneByteOverDecodedDeclaration, profileId, (asset) => {
          asset.decodedRgbaByteLength += 1;
        });
        expect(
          requireProfiles(oneByteOverDecodedDeclaration)[profileId].decodedRgbaBytes,
        ).toBe(PROFILE_LIMITS[profileId].maxDecodedRgbaBytes + 1);
        expectEvaluation(oneByteOverDecodedDeclaration, ISSUE_CODES.input);

        const oneUnitOverFinalizedDimensions = structuredClone(exact);
        mutateOneFinalizedPixel(oneUnitOverFinalizedDimensions, profileId);
        expect(
          requireProfiles(oneUnitOverFinalizedDimensions)[profileId].decodedRgbaBytes,
        ).toBe(PROFILE_LIMITS[profileId].maxDecodedRgbaBytes + 4);
        expectEvaluation(oneUnitOverFinalizedDimensions, ISSUE_CODES.budget);

        const exactRequestBoundary = requestBoundaryFixture(
          profileId,
          PROFILE_LIMITS.maxRequestsIncludingRuntimeManifest - 1,
          salt,
          runtimeManifestByteLength,
        );
        const exactRequestResult = expectEvaluation(exactRequestBoundary, null);
        expect(exactRequestResult.profiles?.[profileId].requestCountIncludingManifest)
          .toBe(PROFILE_LIMITS.maxRequestsIncludingRuntimeManifest);

        const overRequestBoundary = requestBoundaryFixture(
          profileId,
          PROFILE_LIMITS.maxRequestsIncludingRuntimeManifest,
          salt,
          runtimeManifestByteLength,
        );
        expectEvaluation(overRequestBoundary, ISSUE_CODES.budget);
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
