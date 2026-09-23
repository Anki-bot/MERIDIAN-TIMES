import { canonicalJsonStringify } from "./canonical-json.mjs";
import {
  CANONICAL_PROJECT_PATHS,
  CANONICAL_SOURCE_COORDINATE_SPACE,
} from "./contract.mjs";

export const WATCH_LAYER_PROFILE_IDS = Object.freeze(["compact", "expanded"]);

export const WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES = Object.freeze({
  AGGREGATE_MISMATCH: "PROFILE_BUDGET_AGGREGATE_MISMATCH",
  BUDGET_EXCEEDED: "PROFILE_BUDGET_EXCEEDED",
  DUPLICATE_PATH: "PROFILE_BUDGET_DUPLICATE_PATH",
  INPUT_INVALID: "PROFILE_BUDGET_INPUT_INVALID",
  MEMBERSHIP_MISMATCH: "PROFILE_BUDGET_MEMBERSHIP_MISMATCH",
});

const PUBLIC_ASSET_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.webp$/u;

class ProfileBudgetEvaluationFailure extends Error {
  constructor(issueCode, message, path) {
    super(message);
    this.issueCode = issueCode;
    this.path = path;
  }
}

function reject(issueCode, message, path) {
  throw new ProfileBudgetEvaluationFailure(issueCode, message, path);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertNonnegativeSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Profile byte, dimension, and request values must be nonnegative safe integers",
      path,
    );
  }
  return value;
}

function assertPositiveSafeInteger(value, path) {
  assertNonnegativeSafeInteger(value, path);
  if (value === 0) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Finalized bytes, dimensions, and positive limits must be greater than zero",
      path,
    );
  }
  return value;
}

function assertProfileMap(value) {
  if (!isPlainObject(value)) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Profiles must be a compact/expanded record",
      "$.profiles",
    );
  }
  const actual = Object.keys(value).sort();
  if (
    actual.length !== WATCH_LAYER_PROFILE_IDS.length
    || actual.some((profile, index) => profile !== WATCH_LAYER_PROFILE_IDS[index])
  ) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Profiles must contain exactly compact and expanded",
      "$.profiles",
    );
  }
  return value;
}

function assertBudgets(value) {
  if (!isPlainObject(value)) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Budget limits must be an object",
      "$.budgets",
    );
  }
  assertPositiveSafeInteger(
    value.maxRequestsIncludingRuntimeManifest,
    "$.budgets.maxRequestsIncludingRuntimeManifest",
  );
  for (const profileId of WATCH_LAYER_PROFILE_IDS) {
    const limits = value[profileId];
    if (!isPlainObject(limits)) {
      reject(
        WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
        `Missing ${profileId} budget limits`,
        `$.budgets.${profileId}`,
      );
    }
    assertPositiveSafeInteger(
      limits.maxTransferBytes,
      `$.budgets.${profileId}.maxTransferBytes`,
    );
    assertPositiveSafeInteger(
      limits.maxDecodedRgbaBytes,
      `$.budgets.${profileId}.maxDecodedRgbaBytes`,
    );
  }
  return value;
}

function registerUniquePath(owners, value, path) {
  const previous = owners.get(value);
  if (previous !== undefined) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.DUPLICATE_PATH,
      `Asset path duplicates ${previous}`,
      path,
    );
  }
  owners.set(value, path);
}

function assertCanonicalProfilePaths(asset, path) {
  if (typeof asset.file !== "string" || typeof asset.publicPath !== "string") {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Asset paths must be strings",
      path,
    );
  }
  const expectedFilePrefix = `${CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/${asset.profile}/`;
  const fileName = asset.file.startsWith(expectedFilePrefix)
    ? asset.file.slice(expectedFilePrefix.length)
    : "";
  if (!PUBLIC_ASSET_NAME_PATTERN.test(fileName)) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Asset file must be a canonical local active-profile WebP path",
      `${path}.file`,
    );
  }
  const expectedPublicPath = `/${asset.file.slice("public/".length)}`;
  if (asset.publicPath !== expectedPublicPath) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Asset publicPath must be the same-origin projection of its canonical file",
      `${path}.publicPath`,
    );
  }
}

function inspectAsset(asset, expectedProfile, path, pathOwners) {
  if (!isPlainObject(asset)) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Profile assets must be plain objects",
      path,
    );
  }
  if (
    typeof asset.id !== "string"
    || asset.id.length === 0
    || !WATCH_LAYER_PROFILE_IDS.includes(asset.profile)
    || (expectedProfile !== null && asset.profile !== expectedProfile)
  ) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Asset identity or profile is invalid",
      path,
    );
  }

  assertCanonicalProfilePaths(asset, path);
  registerUniquePath(pathOwners.files, asset.file, `${path}.file`);
  registerUniquePath(pathOwners.publicPaths, asset.publicPath, `${path}.publicPath`);

  assertPositiveSafeInteger(asset.byteLength, `${path}.byteLength`);
  const intrinsicWidth = assertPositiveSafeInteger(
    asset.intrinsicWidth,
    `${path}.intrinsicWidth`,
  );
  const intrinsicHeight = assertPositiveSafeInteger(
    asset.intrinsicHeight,
    `${path}.intrinsicHeight`,
  );
  if (
    intrinsicWidth > CANONICAL_SOURCE_COORDINATE_SPACE.width
    || intrinsicHeight > CANONICAL_SOURCE_COORDINATE_SPACE.height
  ) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Finalized asset dimensions must remain within canonical source bounds",
      path,
    );
  }
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  const decodedRgbaByteLength = decodedPixelCount * 4;
  if (
    !Number.isSafeInteger(decodedPixelCount)
    || !Number.isSafeInteger(decodedRgbaByteLength)
    || asset.decodedPixelCount !== decodedPixelCount
    || asset.decodedRgbaByteLength !== decodedRgbaByteLength
  ) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Decoded totals must equal finalized intrinsic dimensions in RGBA",
      path,
    );
  }

  try {
    return canonicalJsonStringify(asset);
  } catch {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
      "Asset records must be canonically serializable",
      path,
    );
  }
}

function sameMembership(left, right) {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

function profileSummary({
  decodedRgbaBytes,
  requestCountIncludingManifest,
  runtimeManifestByteLength,
  transferBytes,
}) {
  const transferBytesIncludingManifest = transferBytes + runtimeManifestByteLength;
  assertNonnegativeSafeInteger(
    transferBytesIncludingManifest,
    "$.runtimeManifestByteLength",
  );
  return Object.freeze({
    decodedRgbaBytes,
    requestCountIncludingManifest,
    transferBytes,
    transferBytesIncludingManifest,
  });
}

function emptyProfileSummaries() {
  return Object.freeze(Object.fromEntries(WATCH_LAYER_PROFILE_IDS.map((profileId) => [
    profileId,
    profileSummary({
      decodedRgbaBytes: 0,
      requestCountIncludingManifest: 0,
      runtimeManifestByteLength: 0,
      transferBytes: 0,
    }),
  ])));
}

function successResult(profiles) {
  return Object.freeze({
    issueCode: null,
    message: null,
    ok: true,
    path: null,
    profiles,
  });
}

function failureResult(error) {
  return Object.freeze({
    issueCode: error.issueCode,
    message: error.message,
    ok: false,
    path: error.path,
    profiles: null,
  });
}

function evaluateFallbackOnlyResources({ manifestAssets, profiles, runtimeManifestByteLength }) {
  assertNonnegativeSafeInteger(runtimeManifestByteLength, "$.runtimeManifestByteLength");
  if (
    runtimeManifestByteLength !== 0
    || !Array.isArray(manifestAssets)
    || manifestAssets.length !== 0
    || profiles !== null
  ) {
    reject(
      WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.MEMBERSHIP_MISMATCH,
      "Fallback-only must contain zero runtime-manifest or image resources",
      "$",
    );
  }
  return successResult(emptyProfileSummaries());
}

/**
 * Evaluate exact package/runtime profile membership and finalized profile budgets.
 * A ready runtime manifest contributes one request and its own bytes to each active
 * profile. A fallback-only release succeeds only with zero successor resources.
 * Inputs are inspected without mutation.
 */
export function evaluateWatchLayerProfileBudget({
  budgets,
  manifestAssets,
  profiles,
  releaseStatus = "ready",
  runtimeManifestByteLength,
} = {}) {
  try {
    const limits = assertBudgets(budgets);
    if (releaseStatus === "fallback-only") {
      return evaluateFallbackOnlyResources({
        manifestAssets,
        profiles,
        runtimeManifestByteLength,
      });
    }
    if (releaseStatus !== "ready") {
      reject(
        WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
        "Release status must be ready or fallback-only",
        "$.releaseStatus",
      );
    }

    const profileMap = assertProfileMap(profiles);
    assertPositiveSafeInteger(runtimeManifestByteLength, "$.runtimeManifestByteLength");
    if (!Array.isArray(manifestAssets)) {
      reject(
        WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
        "Manifest assets must be an array",
        "$.manifestAssets",
      );
    }

    const manifestPathOwners = { files: new Map(), publicPaths: new Map() };
    const manifestSignatures = manifestAssets.map((asset, index) => inspectAsset(
      asset,
      null,
      `$.manifestAssets[${index}]`,
      manifestPathOwners,
    ));

    const runtimePathOwners = { files: new Map(), publicPaths: new Map() };
    const runtimeSignatures = [];
    const computedProfiles = {};
    for (const profileId of WATCH_LAYER_PROFILE_IDS) {
      const profile = profileMap[profileId];
      const path = `$.profiles.${profileId}`;
      if (!isPlainObject(profile) || !Array.isArray(profile.assets)) {
        reject(
          WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.INPUT_INVALID,
          "Each profile must contain an asset array",
          path,
        );
      }
      const signatures = profile.assets.map((asset, index) => inspectAsset(
        asset,
        profileId,
        `${path}.assets[${index}]`,
        runtimePathOwners,
      ));
      runtimeSignatures.push(...signatures);

      const transferBytes = profile.assets.reduce(
        (total, asset) => total + asset.byteLength,
        0,
      );
      const decodedRgbaBytes = profile.assets.reduce(
        (total, asset) => total + asset.decodedRgbaByteLength,
        0,
      );
      assertNonnegativeSafeInteger(transferBytes, `${path}.transferBytes`);
      assertNonnegativeSafeInteger(decodedRgbaBytes, `${path}.decodedRgbaBytes`);
      const requestCountIncludingManifest = profile.assets.length + 1;
      for (const [field, actual] of [
        ["transferBytes", transferBytes],
        ["decodedRgbaBytes", decodedRgbaBytes],
        ["requestCountIncludingManifest", requestCountIncludingManifest],
      ]) {
        assertNonnegativeSafeInteger(profile[field], `${path}.${field}`);
        if (profile[field] !== actual) {
          reject(
            WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.AGGREGATE_MISMATCH,
            `${profileId} ${field} does not equal finalized membership`,
            `${path}.${field}`,
          );
        }
      }

      computedProfiles[profileId] = profileSummary({
        decodedRgbaBytes,
        requestCountIncludingManifest,
        runtimeManifestByteLength,
        transferBytes,
      });
    }

    if (!sameMembership(runtimeSignatures, manifestSignatures)) {
      reject(
        WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.MEMBERSHIP_MISMATCH,
        "Runtime compact/expanded assets must equal the package manifest asset set",
        "$.profiles",
      );
    }

    for (const profileId of WATCH_LAYER_PROFILE_IDS) {
      const computed = computedProfiles[profileId];
      const profileLimits = limits[profileId];
      if (
        computed.requestCountIncludingManifest
          > limits.maxRequestsIncludingRuntimeManifest
        || computed.transferBytesIncludingManifest > profileLimits.maxTransferBytes
        || computed.decodedRgbaBytes > profileLimits.maxDecodedRgbaBytes
      ) {
        reject(
          WATCH_LAYER_PROFILE_BUDGET_ISSUE_CODES.BUDGET_EXCEEDED,
          `${profileId} profile exceeds request, transfer, or decoded-memory limits`,
          `$.profiles.${profileId}`,
        );
      }
    }

    return successResult(Object.freeze(computedProfiles));
  } catch (error) {
    if (error instanceof ProfileBudgetEvaluationFailure) return failureResult(error);
    throw error;
  }
}
