import {
  CANONICAL_MASTER_SHA256,
  CANONICAL_SOURCE_HEIGHT,
  CANONICAL_SOURCE_WIDTH,
  RUNTIME_PHASES,
  WATCH_LAYER_RUNTIME_MANIFEST_PATH,
} from "./types";
import type {
  ApprovalId,
  AssetId,
  CompactEnhancementProfile,
  ContinuousRotationProfile,
  DepthLayerValue,
  DepthProfile,
  DepthProfileId,
  Direction,
  DiscreteRotationProfile,
  EnhancementProfile,
  ExpandedEnhancementProfile,
  FallbackOnlyWatchLayerRelease,
  LayerId,
  MotionEvidence,
  MotionProfile,
  MotionProfileId,
  OscillationProfile,
  PackageId,
  ProfileId,
  PublicAssetColorMetadata,
  PublicAssetEncoder,
  PublicAssetFile,
  PublicAssetLayerId,
  PublicAssetPath,
  PublicAssetRecord,
  ReadyWatchLayerRelease,
  ReleaseId,
  RuntimeFailureCode,
  RuntimeManifestIdentity,
  RuntimePhase,
  Sha256,
  SourcePoint,
  SourceRect,
  ValidatedRuntimeManifest,
  WatchLayerRelease,
} from "./types";

export const RUNTIME_SCHEMA_ISSUE_CODES = Object.freeze({
  BINDING: "RUNTIME_SCHEMA_RELEASE_BINDING",
  BOUNDS: "RUNTIME_SCHEMA_BOUNDS",
  BUDGET: "RUNTIME_SCHEMA_BUDGET",
  DUPLICATE: "RUNTIME_SCHEMA_DUPLICATE",
  FIELD_SET: "RUNTIME_SCHEMA_FIELD_SET",
  HASH: "RUNTIME_SCHEMA_HASH",
  ID: "RUNTIME_SCHEMA_ID",
  JSON: "RUNTIME_SCHEMA_JSON",
  PATH: "RUNTIME_SCHEMA_PATH",
  TYPE: "RUNTIME_SCHEMA_TYPE",
  VALUE: "RUNTIME_SCHEMA_VALUE",
} as const);

export type RuntimeSchemaIssueCode =
  (typeof RUNTIME_SCHEMA_ISSUE_CODES)[keyof typeof RUNTIME_SCHEMA_ISSUE_CODES];

export class RuntimeSchemaError extends TypeError {
  readonly code: RuntimeFailureCode;
  readonly issueCode: RuntimeSchemaIssueCode;
  readonly path: string;

  constructor(
    issueCode: RuntimeSchemaIssueCode,
    message: string,
    path = "$",
    code: RuntimeFailureCode = "manifest-schema",
  ) {
    super(message);
    this.code = code;
    this.issueCode = issueCode;
    this.name = "RuntimeSchemaError";
    this.path = path;
  }

  toJSON(): Readonly<{
    code: RuntimeFailureCode;
    issueCode: RuntimeSchemaIssueCode;
    message: string;
    ok: false;
    path: string;
  }> {
    return Object.freeze({
      code: this.code,
      issueCode: this.issueCode,
      message: this.message,
      ok: false,
      path: this.path,
    });
  }
}

export type RuntimeSchemaResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: RuntimeSchemaError };

type JsonRecord = Record<string, unknown>;

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const WEBP_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.webp$/u;
const WEBP_SIGNATURE_PATTERN = /^52494646[a-f\d]{8}57454250$/u;
const MAX_STABLE_ID_LENGTH = 128;
const MAX_PROFILE_ASSETS = 7;
const MAX_REQUESTS_INCLUDING_MANIFEST = 8;
const PROFILE_BUDGETS = Object.freeze({
  compact: Object.freeze({
    maxDecodedRgbaBytes: 25_165_824,
    maxTransferBytes: 1_572_864,
  }),
  expanded: Object.freeze({
    maxDecodedRgbaBytes: 50_331_648,
    maxTransferBytes: 3_145_728,
  }),
});

function fail(
  issueCode: RuntimeSchemaIssueCode,
  message: string,
  path: string,
  code: RuntimeFailureCode = "manifest-schema",
): never {
  throw new RuntimeSchemaError(issueCode, message, path, code);
}

function fieldPath(parent: string, field: string): string {
  return /^[A-Za-z_$][A-Za-z\d_$]*$/u.test(field)
    ? `${parent}.${field}`
    : `${parent}[${JSON.stringify(field)}]`;
}

function indexPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

function plainRecord(value: unknown, path: string): JsonRecord {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.TYPE,
      "Expected a plain JSON object",
      path,
    );
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return fail(
        RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
        "JSON objects must not contain symbol fields",
        path,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail(
        RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
        "JSON object fields must be enumerable data properties",
        fieldPath(path, key),
      );
    }
  }
  return value as JsonRecord;
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): JsonRecord {
  const record = plainRecord(value, path);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
      `Unknown field ${JSON.stringify(unknown[0])}`,
      fieldPath(path, unknown[0]),
    );
  }
  const missing = required.filter((key) => !Object.hasOwn(record, key));
  if (missing.length > 0) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
      `Missing required field ${JSON.stringify(missing[0])}`,
      fieldPath(path, missing[0]),
    );
  }
  return record;
}

function jsonArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.TYPE, "Expected a JSON array", path);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(?:0|[1-9]\d*)$/u.test(key)
      || Number(key) >= value.length
    ) {
      return fail(
        RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
        "JSON arrays must not contain named or symbol fields",
        path,
      );
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail(
        RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
        "JSON arrays must be dense enumerable data arrays",
        indexPath(path, index),
      );
    }
  }
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.TYPE, "Expected a string", path);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.TYPE, "Expected a boolean", path);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.TYPE, "Expected a finite number", path);
  }
  return value;
}

function safeInteger(
  value: unknown,
  path: string,
  { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {},
): number {
  const number = finiteNumber(value, path);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
      `Expected a safe integer from ${minimum} through ${maximum}`,
      path,
    );
  }
  return number;
}

function positiveFinite(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.VALUE, "Expected a positive number", path);
  }
  return number;
}

function literal<T extends string | number | boolean | null>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
      `Expected ${JSON.stringify(expected)}`,
      path,
    );
  }
  return expected;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  const string = stringValue(value, path);
  if (!allowed.includes(string)) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
      `Unsupported value ${JSON.stringify(string)}`,
      path,
    );
  }
  return string as T[number];
}

function stableId<T extends string>(value: unknown, path: string): T {
  const id = stringValue(value, path);
  if (id.length > MAX_STABLE_ID_LENGTH || !STABLE_ID_PATTERN.test(id)) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.ID,
      "Expected a lowercase kebab-case stable identifier",
      path,
    );
  }
  return id as T;
}

function sha256(value: unknown, path: string): Sha256 {
  const hash = stringValue(value, path);
  if (!SHA256_PATTERN.test(hash)) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.HASH,
      "Expected a lowercase 64-hex SHA-256 digest",
      path,
    );
  }
  return hash as Sha256;
}

function parseSourcePoint(value: unknown, path: string): SourcePoint {
  const record = exactRecord(value, ["x", "y"], [], path);
  const point = {
    x: finiteNumber(record.x, fieldPath(path, "x")),
    y: finiteNumber(record.y, fieldPath(path, "y")),
  };
  if (
    point.x < 0
    || point.x >= CANONICAL_SOURCE_WIDTH
    || point.y < 0
    || point.y >= CANONICAL_SOURCE_HEIGHT
  ) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BOUNDS,
      "Point must lie inside the canonical source",
      path,
    );
  }
  return Object.freeze(point);
}

function parseSourceRect(value: unknown, path: string): SourceRect {
  const record = exactRecord(value, ["height", "width", "x", "y"], [], path);
  const rect = {
    height: safeInteger(record.height, fieldPath(path, "height"), {
      minimum: 1,
      maximum: CANONICAL_SOURCE_HEIGHT,
    }),
    width: safeInteger(record.width, fieldPath(path, "width"), {
      minimum: 1,
      maximum: CANONICAL_SOURCE_WIDTH,
    }),
    x: safeInteger(record.x, fieldPath(path, "x"), {
      minimum: 0,
      maximum: CANONICAL_SOURCE_WIDTH - 1,
    }),
    y: safeInteger(record.y, fieldPath(path, "y"), {
      minimum: 0,
      maximum: CANONICAL_SOURCE_HEIGHT - 1,
    }),
  };
  if (
    rect.x + rect.width > CANONICAL_SOURCE_WIDTH
    || rect.y + rect.height > CANONICAL_SOURCE_HEIGHT
  ) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BOUNDS,
      "Half-open rectangle must be contained by the canonical source",
      path,
    );
  }
  return Object.freeze(rect);
}

function parseColorMetadata(value: unknown, path: string): PublicAssetColorMetadata {
  const record = exactRecord(value, ["alpha", "channels", "colourspace"], [], path);
  return Object.freeze({
    alpha: literal(record.alpha, true, fieldPath(path, "alpha")),
    channels: literal(record.channels, 4, fieldPath(path, "channels")),
    colourspace: literal(record.colourspace, "srgb", fieldPath(path, "colourspace")),
  });
}

function parseEncoder(value: unknown, path: string): PublicAssetEncoder {
  const record = exactRecord(value, [
    "alphaQuality",
    "channels",
    "colourspace",
    "effort",
    "nearLossless",
    "quality",
    "smartSubsample",
  ], [], path);
  return Object.freeze({
    alphaQuality: literal(record.alphaQuality, 100, fieldPath(path, "alphaQuality")),
    channels: literal(record.channels, 4, fieldPath(path, "channels")),
    colourspace: literal(record.colourspace, "srgb", fieldPath(path, "colourspace")),
    effort: literal(record.effort, 6, fieldPath(path, "effort")),
    nearLossless: literal(record.nearLossless, false, fieldPath(path, "nearLossless")),
    quality: safeInteger(record.quality, fieldPath(path, "quality"), {
      minimum: 1,
      maximum: 100,
    }),
    smartSubsample: literal(record.smartSubsample, true, fieldPath(path, "smartSubsample")),
  });
}

function parseAssetPath<P extends ProfileId>(
  value: unknown,
  profile: P,
  path: string,
): PublicAssetPath<P> {
  const publicPath = stringValue(value, path);
  const prefix = `/assets/watch-2-5d/v1/${profile}/`;
  const name = publicPath.startsWith(prefix) ? publicPath.slice(prefix.length) : "";
  if (
    !publicPath.startsWith("/")
    || publicPath.startsWith("//")
    || !WEBP_NAME_PATTERN.test(name)
    || publicPath.includes("\\")
    || publicPath.includes("?")
    || publicPath.includes("#")
    || publicPath.includes("%")
  ) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.PATH,
      "Asset must use a canonical same-origin /assets/watch-2-5d/v1 profile URL",
      path,
    );
  }
  return publicPath as PublicAssetPath<P>;
}

function parseAssetLayerId(value: unknown, path: string): PublicAssetLayerId {
  if (value === "reconstructed-background") return value;
  return stableId<LayerId>(value, path);
}

function parsePublicAsset<P extends ProfileId>(
  value: unknown,
  profile: P,
  path: string,
): PublicAssetRecord<P> {
  const record = exactRecord(value, [
    "byteLength",
    "colorMetadata",
    "decodedPixelCount",
    "decodedRgbaByteLength",
    "encoder",
    "file",
    "id",
    "intrinsicHeight",
    "intrinsicWidth",
    "layerId",
    "magicSignatureHex",
    "mediaType",
    "profile",
    "publicPath",
    "sha256",
    "sourceRect",
    "zOrder",
  ], [], path);
  literal(record.profile, profile, fieldPath(path, "profile"));
  const publicPath = parseAssetPath(record.publicPath, profile, fieldPath(path, "publicPath"));
  const expectedFile = `public${publicPath}` as PublicAssetFile<P>;
  const file = literal(record.file, expectedFile, fieldPath(path, "file"));
  const intrinsicWidth = safeInteger(record.intrinsicWidth, fieldPath(path, "intrinsicWidth"), {
    minimum: 1,
    maximum: CANONICAL_SOURCE_WIDTH,
  });
  const intrinsicHeight = safeInteger(record.intrinsicHeight, fieldPath(path, "intrinsicHeight"), {
    minimum: 1,
    maximum: CANONICAL_SOURCE_HEIGHT,
  });
  const decodedPixelCount = intrinsicWidth * intrinsicHeight;
  const signature = stringValue(record.magicSignatureHex, fieldPath(path, "magicSignatureHex"));
  if (!WEBP_SIGNATURE_PATTERN.test(signature)) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
      "Expected a 12-byte RIFF/WEBP magic signature",
      fieldPath(path, "magicSignatureHex"),
    );
  }

  return Object.freeze({
    byteLength: safeInteger(record.byteLength, fieldPath(path, "byteLength"), { minimum: 1 }),
    colorMetadata: parseColorMetadata(record.colorMetadata, fieldPath(path, "colorMetadata")),
    decodedPixelCount: literal(
      record.decodedPixelCount,
      decodedPixelCount,
      fieldPath(path, "decodedPixelCount"),
    ),
    decodedRgbaByteLength: literal(
      record.decodedRgbaByteLength,
      decodedPixelCount * 4,
      fieldPath(path, "decodedRgbaByteLength"),
    ),
    encoder: parseEncoder(record.encoder, fieldPath(path, "encoder")),
    file,
    id: stableId<AssetId>(record.id, fieldPath(path, "id")),
    intrinsicHeight,
    intrinsicWidth,
    layerId: parseAssetLayerId(record.layerId, fieldPath(path, "layerId")),
    magicSignatureHex: signature,
    mediaType: literal(record.mediaType, "image/webp", fieldPath(path, "mediaType")),
    profile,
    publicPath,
    sha256: sha256(record.sha256, fieldPath(path, "sha256")),
    sourceRect: parseSourceRect(record.sourceRect, fieldPath(path, "sourceRect")),
    zOrder: safeInteger(record.zOrder, fieldPath(path, "zOrder")),
  });
}

function assertUnique(values: readonly string[], path: string, label: string): void {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    if (seen.has(values[index])) {
      fail(
        RUNTIME_SCHEMA_ISSUE_CODES.DUPLICATE,
        `Duplicate ${label} ${JSON.stringify(values[index])}`,
        indexPath(path, index),
      );
    }
    seen.add(values[index]);
  }
}

function parseEnhancementProfile<P extends ProfileId>(
  value: unknown,
  profile: P,
  runtimeManifestByteLength: number,
  path: string,
): EnhancementProfile<P> {
  const record = exactRecord(value, [
    "assets",
    "decodedRgbaBytes",
    "id",
    "requestCountIncludingManifest",
    "sourceScale",
    "transferBytes",
  ], [], path);
  literal(record.id, profile, fieldPath(path, "id"));
  const sourceScale = literal(
    record.sourceScale,
    profile === "compact" ? 0.5 : 1,
    fieldPath(path, "sourceScale"),
  );
  const rawAssets = jsonArray(record.assets, fieldPath(path, "assets"));
  if (rawAssets.length > MAX_PROFILE_ASSETS) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BUDGET,
      `A profile may contain no more than ${MAX_PROFILE_ASSETS} image assets`,
      fieldPath(path, "assets"),
    );
  }
  const assets = Object.freeze(rawAssets.map((asset, index) => parsePublicAsset(
    asset,
    profile,
    indexPath(fieldPath(path, "assets"), index),
  )));
  assertUnique(assets.map(({ id }) => id), fieldPath(path, "assets"), "asset ID");
  assertUnique(assets.map(({ publicPath }) => publicPath), fieldPath(path, "assets"), "asset path");
  assertUnique(assets.map(({ layerId }) => layerId), fieldPath(path, "assets"), "layer asset");
  if (assets.filter(({ layerId }) => layerId === "reconstructed-background").length !== 1) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
      "Each ready profile requires exactly one reconstructed-background asset",
      fieldPath(path, "assets"),
    );
  }

  const transferBytes = assets.reduce((total, asset) => total + asset.byteLength, 0);
  const decodedRgbaBytes = assets.reduce(
    (total, asset) => total + asset.decodedRgbaByteLength,
    0,
  );
  const requestCountIncludingManifest = assets.length + 1;
  literal(record.transferBytes, transferBytes, fieldPath(path, "transferBytes"));
  literal(record.decodedRgbaBytes, decodedRgbaBytes, fieldPath(path, "decodedRgbaBytes"));
  literal(
    record.requestCountIncludingManifest,
    requestCountIncludingManifest,
    fieldPath(path, "requestCountIncludingManifest"),
  );
  const limits = PROFILE_BUDGETS[profile];
  if (
    requestCountIncludingManifest > MAX_REQUESTS_INCLUDING_MANIFEST
    || transferBytes + runtimeManifestByteLength > limits.maxTransferBytes
    || decodedRgbaBytes > limits.maxDecodedRgbaBytes
  ) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BUDGET,
      `${profile} profile exceeds its request, transfer, or decoded-memory budget`,
      path,
    );
  }

  return Object.freeze({
    assets,
    decodedRgbaBytes,
    id: profile,
    requestCountIncludingManifest,
    sourceScale,
    transferBytes,
  }) as EnhancementProfile<P>;
}

const MOTION_BASE_FIELDS = [
  "approvalId",
  "direction",
  "evidence",
  "id",
  "kind",
  "layerId",
  "maxRadians",
  "minRadians",
  "phaseRadians",
  "pivot",
  "referenceRadians",
] as const;
const MOTION_KINDS = [
  "continuous-rotation",
  "discrete-rotation",
  "oscillation",
] as const;
const MOTION_EVIDENCE = ["visible-evidence", "authored-assumption"] as const;

function parseDirection(value: unknown, path: string): Direction {
  if (value !== -1 && value !== 1) {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.VALUE, "Direction must be -1 or 1", path);
  }
  return value;
}

function parseMotionProfile(value: unknown, path: string): MotionProfile {
  const candidate = plainRecord(value, path);
  const kind = enumValue(candidate.kind, MOTION_KINDS, fieldPath(path, "kind"));
  const kindFields = kind === "continuous-rotation"
    ? ["periodMs"]
    : kind === "discrete-rotation"
      ? ["cadenceMs", "stepRadians"]
      : ["amplitudeRadians", "periodMs"];
  const record = exactRecord(value, [...MOTION_BASE_FIELDS, ...kindFields], [], path);
  const minRadians = finiteNumber(record.minRadians, fieldPath(path, "minRadians"));
  const maxRadians = finiteNumber(record.maxRadians, fieldPath(path, "maxRadians"));
  const referenceRadians = finiteNumber(
    record.referenceRadians,
    fieldPath(path, "referenceRadians"),
  );
  if (minRadians > maxRadians || referenceRadians < minRadians || referenceRadians > maxRadians) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BOUNDS,
      "Motion bounds must contain the reference angle",
      path,
    );
  }
  const base = {
    approvalId: stableId<ApprovalId>(record.approvalId, fieldPath(path, "approvalId")),
    direction: parseDirection(record.direction, fieldPath(path, "direction")),
    evidence: enumValue(
      record.evidence,
      MOTION_EVIDENCE,
      fieldPath(path, "evidence"),
    ) as MotionEvidence,
    id: stableId<MotionProfileId>(record.id, fieldPath(path, "id")),
    layerId: stableId<LayerId>(record.layerId, fieldPath(path, "layerId")),
    maxRadians,
    minRadians,
    phaseRadians: finiteNumber(record.phaseRadians, fieldPath(path, "phaseRadians")),
    pivot: parseSourcePoint(record.pivot, fieldPath(path, "pivot")),
    referenceRadians,
  };

  if (kind === "continuous-rotation") {
    return Object.freeze({
      ...base,
      kind,
      periodMs: positiveFinite(record.periodMs, fieldPath(path, "periodMs")),
    }) satisfies ContinuousRotationProfile;
  }
  if (kind === "discrete-rotation") {
    const stepRadians = finiteNumber(record.stepRadians, fieldPath(path, "stepRadians"));
    if (stepRadians === 0) {
      return fail(
        RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
        "Discrete rotation step must be nonzero",
        fieldPath(path, "stepRadians"),
      );
    }
    return Object.freeze({
      ...base,
      cadenceMs: positiveFinite(record.cadenceMs, fieldPath(path, "cadenceMs")),
      kind,
      stepRadians,
    }) satisfies DiscreteRotationProfile;
  }

  const amplitudeRadians = positiveFinite(
    record.amplitudeRadians,
    fieldPath(path, "amplitudeRadians"),
  );
  if (minRadians !== -amplitudeRadians || maxRadians !== amplitudeRadians) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BOUNDS,
      "Oscillation bounds must be symmetric around zero",
      path,
    );
  }
  return Object.freeze({
    ...base,
    amplitudeRadians,
    kind,
    periodMs: positiveFinite(record.periodMs, fieldPath(path, "periodMs")),
  }) satisfies OscillationProfile;
}

function parseDepthLayerValue(value: unknown, path: string): DepthLayerValue {
  const record = exactRecord(value, [
    "displacementShortAxisFraction",
    "layerId",
    "phaseRadians",
    "rotationDegrees",
    "scaleDelta",
    "zOrder",
  ], [], path);
  const displacementShortAxisFraction = finiteNumber(
    record.displacementShortAxisFraction,
    fieldPath(path, "displacementShortAxisFraction"),
  );
  const scaleDelta = finiteNumber(record.scaleDelta, fieldPath(path, "scaleDelta"));
  const rotationDegrees = finiteNumber(
    record.rotationDegrees,
    fieldPath(path, "rotationDegrees"),
  );
  if (
    Math.abs(displacementShortAxisFraction) > 0.006
    || Math.abs(scaleDelta) > 0.015
    || Math.abs(rotationDegrees) > 1
  ) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BOUNDS,
      "Depth layer exceeds subtle-depth bounds",
      path,
    );
  }
  return Object.freeze({
    displacementShortAxisFraction,
    layerId: stableId<LayerId>(record.layerId, fieldPath(path, "layerId")),
    phaseRadians: finiteNumber(record.phaseRadians, fieldPath(path, "phaseRadians")),
    rotationDegrees,
    scaleDelta,
    zOrder: safeInteger(record.zOrder, fieldPath(path, "zOrder")),
  });
}

function parseDepthProfile(value: unknown, path: string): DepthProfile {
  const record = exactRecord(value, [
    "authoredInterpretation",
    "enabled",
    "id",
    "layers",
    "periodMs",
    "profile",
  ], ["approvalId"], path);
  const profile = enumValue(record.profile, ["compact", "expanded"] as const, fieldPath(path, "profile"));
  const enabled = booleanValue(record.enabled, fieldPath(path, "enabled"));
  const layers = Object.freeze(jsonArray(record.layers, fieldPath(path, "layers")).map(
    (layer, index) => parseDepthLayerValue(
      layer,
      indexPath(fieldPath(path, "layers"), index),
    ),
  ));
  assertUnique(layers.map(({ layerId }) => layerId), fieldPath(path, "layers"), "depth layer");
  if (layers.length > 1) {
    const displacements = layers.map(({ displacementShortAxisFraction }) => (
      displacementShortAxisFraction
    ));
    const scales = layers.map(({ scaleDelta }) => scaleDelta);
    const rotations = layers.map(({ rotationDegrees }) => rotationDegrees);
    if (
      Math.max(...displacements) - Math.min(...displacements) > 0.006
      || Math.max(...scales) - Math.min(...scales) > 0.015
      || Math.max(...rotations) - Math.min(...rotations) > 1
    ) {
      return fail(
        RUNTIME_SCHEMA_ISSUE_CODES.BOUNDS,
        "Aggregate foreground-to-background depth delta exceeds approved bounds",
        fieldPath(path, "layers"),
      );
    }
  }
  const approvalId = Object.hasOwn(record, "approvalId")
    ? stableId<ApprovalId>(record.approvalId, fieldPath(path, "approvalId"))
    : undefined;
  if (enabled && approvalId === undefined) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.FIELD_SET,
      "Enabled depth requires approvalId",
      fieldPath(path, "approvalId"),
    );
  }
  const common = {
    authoredInterpretation: literal(
      record.authoredInterpretation,
      true,
      fieldPath(path, "authoredInterpretation"),
    ),
    enabled,
    id: stableId<DepthProfileId>(record.id, fieldPath(path, "id")),
    layers,
    periodMs: positiveFinite(record.periodMs, fieldPath(path, "periodMs")),
    profile,
  };
  return Object.freeze(approvalId === undefined ? common : { ...common, approvalId });
}

function parseRuntimeManifestIdentity(value: unknown, path: string): RuntimeManifestIdentity {
  const record = exactRecord(value, ["byteLength", "mediaType", "publicPath", "sha256"], [], path);
  return Object.freeze({
    byteLength: safeInteger(record.byteLength, fieldPath(path, "byteLength"), { minimum: 1 }),
    mediaType: literal(record.mediaType, "application/json", fieldPath(path, "mediaType")),
    publicPath: literal(
      record.publicPath,
      WATCH_LAYER_RUNTIME_MANIFEST_PATH,
      fieldPath(path, "publicPath"),
    ),
    sha256: sha256(record.sha256, fieldPath(path, "sha256")),
  });
}

export function parseWatchLayerRelease(value: unknown): WatchLayerRelease {
  const candidate = plainRecord(value, "$release");
  const status = stringValue(candidate.status, "$release.status");
  if (status === "fallback-only") {
    const record = exactRecord(
      value,
      ["depthEnabled", "runtimeManifest", "schemaVersion", "status"],
      [],
      "$release",
    );
    return Object.freeze({
      depthEnabled: literal(record.depthEnabled, false, "$release.depthEnabled"),
      runtimeManifest: literal(record.runtimeManifest, null, "$release.runtimeManifest"),
      schemaVersion: literal(record.schemaVersion, 1, "$release.schemaVersion"),
      status,
    }) satisfies FallbackOnlyWatchLayerRelease;
  }
  if (status === "ready") {
    const record = exactRecord(value, [
      "depthEnabled",
      "packageId",
      "releaseId",
      "runtimeManifest",
      "schemaVersion",
      "status",
    ], [], "$release");
    return Object.freeze({
      depthEnabled: booleanValue(record.depthEnabled, "$release.depthEnabled"),
      packageId: stableId<PackageId>(record.packageId, "$release.packageId"),
      releaseId: stableId<ReleaseId>(record.releaseId, "$release.releaseId"),
      runtimeManifest: parseRuntimeManifestIdentity(
        record.runtimeManifest,
        "$release.runtimeManifest",
      ),
      schemaVersion: literal(record.schemaVersion, 1, "$release.schemaVersion"),
      status,
    }) satisfies ReadyWatchLayerRelease;
  }
  return fail(
    RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
    `Unsupported release status ${JSON.stringify(status)}`,
    "$release.status",
  );
}

export function isReadyWatchLayerRelease(
  release: WatchLayerRelease,
): release is ReadyWatchLayerRelease {
  return release.status === "ready";
}

function sameRect(left: SourceRect, right: SourceRect): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function pointInRect(point: SourcePoint, rect: SourceRect): boolean {
  return point.x >= rect.x
    && point.x < rect.x + rect.width
    && point.y >= rect.y
    && point.y < rect.y + rect.height;
}

function assertProfileParity(
  compact: CompactEnhancementProfile,
  expanded: ExpandedEnhancementProfile,
): void {
  const compactByLayer = new Map(compact.assets.map((asset) => [asset.layerId, asset]));
  const expandedByLayer = new Map(expanded.assets.map((asset) => [asset.layerId, asset]));
  if (
    compactByLayer.size !== expandedByLayer.size
    || [...compactByLayer.keys()].some((layerId) => !expandedByLayer.has(layerId))
  ) {
    fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "Compact and expanded profiles must contain the same logical layers",
      "$manifest.profiles",
      "manifest-identity",
    );
  }
  for (const [layerId, compactAsset] of compactByLayer) {
    const expandedAsset = expandedByLayer.get(layerId);
    if (
      expandedAsset === undefined
      || compactAsset.zOrder !== expandedAsset.zOrder
      || !sameRect(compactAsset.sourceRect, expandedAsset.sourceRect)
    ) {
      fail(
        RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
        "Compact and expanded logical layer metadata must match",
        "$manifest.profiles",
        "manifest-identity",
      );
    }
  }
}

function assertMotionBindings(
  motions: readonly MotionProfile[],
  profiles: Readonly<{
    compact: CompactEnhancementProfile;
    expanded: ExpandedEnhancementProfile;
  }>,
): void {
  for (let index = 0; index < motions.length; index += 1) {
    const motion = motions[index];
    const compact = profiles.compact.assets.find(({ layerId }) => layerId === motion.layerId);
    const expanded = profiles.expanded.assets.find(({ layerId }) => layerId === motion.layerId);
    if (
      compact === undefined
      || expanded === undefined
      || !pointInRect(motion.pivot, compact.sourceRect)
      || !pointInRect(motion.pivot, expanded.sourceRect)
    ) {
      fail(
        RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
        "Motion profile must reference one profile-complete layer with an in-bounds pivot",
        indexPath("$manifest.motionProfiles", index),
        "manifest-identity",
      );
    }
  }
}

function assertDepthBindings(
  depths: readonly DepthProfile[],
  profiles: Readonly<{
    compact: CompactEnhancementProfile;
    expanded: ExpandedEnhancementProfile;
  }>,
): void {
  assertUnique(depths.map(({ profile }) => profile), "$manifest.depthProfiles", "depth profile target");
  for (let depthIndex = 0; depthIndex < depths.length; depthIndex += 1) {
    const depth = depths[depthIndex];
    const assets = profiles[depth.profile].assets;
    for (let layerIndex = 0; layerIndex < depth.layers.length; layerIndex += 1) {
      const layer = depth.layers[layerIndex];
      const asset = assets.find(({ layerId }) => layerId === layer.layerId);
      if (asset === undefined || asset.zOrder !== layer.zOrder) {
        fail(
          RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
          "Depth values must reference a profile member with its approved z-order",
          indexPath(
            fieldPath(indexPath("$manifest.depthProfiles", depthIndex), "layers"),
            layerIndex,
          ),
          "manifest-identity",
        );
      }
    }
  }
}

export function parseRuntimeManifest(
  value: unknown,
  compiledRelease: ReadyWatchLayerRelease,
): ValidatedRuntimeManifest {
  const release = parseWatchLayerRelease(compiledRelease);
  if (!isReadyWatchLayerRelease(release)) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "A fallback-only release cannot bind a runtime manifest",
      "$release.status",
      "manifest-identity",
    );
  }
  const record = exactRecord(value, [
    "canonicalMasterSha256",
    "depthProfiles",
    "motionProfiles",
    "packageId",
    "phase",
    "profiles",
    "releaseId",
    "schemaVersion",
  ], [], "$manifest");
  const packageId = stableId<PackageId>(record.packageId, "$manifest.packageId");
  const releaseId = stableId<ReleaseId>(record.releaseId, "$manifest.releaseId");
  if (packageId !== release.packageId || releaseId !== release.releaseId) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "Runtime manifest packageId and releaseId must match the compiled release",
      "$manifest",
      "manifest-identity",
    );
  }
  const canonicalMasterSha256 = sha256(
    record.canonicalMasterSha256,
    "$manifest.canonicalMasterSha256",
  );
  if (canonicalMasterSha256 !== CANONICAL_MASTER_SHA256) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "Runtime manifest must reference the approved canonical master",
      "$manifest.canonicalMasterSha256",
      "manifest-identity",
    );
  }
  const phase = enumValue(record.phase, RUNTIME_PHASES, "$manifest.phase") as RuntimePhase;
  const profileRecord = exactRecord(
    record.profiles,
    ["compact", "expanded"],
    [],
    "$manifest.profiles",
  );
  const profiles = Object.freeze({
    compact: parseEnhancementProfile(
      profileRecord.compact,
      "compact",
      release.runtimeManifest.byteLength,
      "$manifest.profiles.compact",
    ),
    expanded: parseEnhancementProfile(
      profileRecord.expanded,
      "expanded",
      release.runtimeManifest.byteLength,
      "$manifest.profiles.expanded",
    ),
  });
  assertProfileParity(profiles.compact, profiles.expanded);

  const motionProfiles = Object.freeze(jsonArray(
    record.motionProfiles,
    "$manifest.motionProfiles",
  ).map((profile, index) => parseMotionProfile(
    profile,
    indexPath("$manifest.motionProfiles", index),
  )));
  const depthProfiles = Object.freeze(jsonArray(
    record.depthProfiles,
    "$manifest.depthProfiles",
  ).map((profile, index) => parseDepthProfile(
    profile,
    indexPath("$manifest.depthProfiles", index),
  )));
  assertUnique(motionProfiles.map(({ id }) => id), "$manifest.motionProfiles", "motion ID");
  assertUnique(depthProfiles.map(({ id }) => id), "$manifest.depthProfiles", "depth ID");
  assertUnique([
    ...profiles.compact.assets.map(({ id }) => id),
    ...profiles.expanded.assets.map(({ id }) => id),
    ...motionProfiles.map(({ id }) => id),
    ...depthProfiles.map(({ id }) => id),
  ], "$manifest", "runtime record ID");
  assertMotionBindings(motionProfiles, profiles);
  assertDepthBindings(depthProfiles, profiles);

  if (phase === "static-layered-reconstruction" && motionProfiles.length > 0) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.VALUE,
      "Static layered phase cannot contain motion profiles",
      "$manifest.motionProfiles",
    );
  }
  const enabledDepthProfiles = depthProfiles.filter(({ enabled }) => enabled);
  if (!release.depthEnabled && enabledDepthProfiles.length > 0) {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "Compiled release disables depth but the manifest enables it",
      "$manifest.depthProfiles",
      "manifest-identity",
    );
  }
  if (release.depthEnabled) {
    const enabledTargets = new Set(enabledDepthProfiles.map(({ profile }) => profile));
    if (
      phase !== "optional-depth"
      || enabledDepthProfiles.length !== 2
      || !enabledTargets.has("compact")
      || !enabledTargets.has("expanded")
    ) {
      return fail(
        RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
        "Depth-enabled releases require approved compact and expanded optional-depth profiles",
        "$manifest.depthProfiles",
        "manifest-identity",
      );
    }
  } else if (phase === "optional-depth") {
    return fail(
      RUNTIME_SCHEMA_ISSUE_CODES.BINDING,
      "Optional-depth phase requires a depth-enabled compiled release",
      "$manifest.phase",
      "manifest-identity",
    );
  }

  return Object.freeze({
    canonicalMasterSha256,
    depthProfiles,
    motionProfiles,
    packageId,
    phase,
    profiles,
    releaseId,
    schemaVersion: literal(record.schemaVersion, 1, "$manifest.schemaVersion"),
  }) as ValidatedRuntimeManifest;
}

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

function parseJsonInput(input: string | ArrayBuffer | ArrayBufferView, path: string): unknown {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else if (input instanceof ArrayBuffer) {
    try {
      text = STRICT_UTF8_DECODER.decode(new Uint8Array(input));
    } catch {
      return fail(RUNTIME_SCHEMA_ISSUE_CODES.JSON, "Malformed UTF-8 JSON payload", path);
    }
  } else if (ArrayBuffer.isView(input)) {
    try {
      text = STRICT_UTF8_DECODER.decode(
        new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
      );
    } catch {
      return fail(RUNTIME_SCHEMA_ISSUE_CODES.JSON, "Malformed UTF-8 JSON payload", path);
    }
  } else {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.TYPE, "Expected JSON text or bytes", path);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.JSON, "JSON payload must not contain a BOM", path);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail(RUNTIME_SCHEMA_ISSUE_CODES.JSON, "Malformed JSON payload", path);
  }
}

export function parseWatchLayerReleaseJson(
  input: string | ArrayBuffer | ArrayBufferView,
): WatchLayerRelease {
  return parseWatchLayerRelease(parseJsonInput(input, "$release"));
}

export function parseRuntimeManifestJson(
  input: string | ArrayBuffer | ArrayBufferView,
  compiledRelease: ReadyWatchLayerRelease,
): ValidatedRuntimeManifest {
  return parseRuntimeManifest(parseJsonInput(input, "$manifest"), compiledRelease);
}

export function safeParseWatchLayerRelease(value: unknown): RuntimeSchemaResult<WatchLayerRelease> {
  try {
    return Object.freeze({ data: parseWatchLayerRelease(value), success: true });
  } catch (error) {
    if (error instanceof RuntimeSchemaError) {
      return Object.freeze({ error, success: false });
    }
    throw error;
  }
}

export function safeParseRuntimeManifest(
  value: unknown,
  compiledRelease: ReadyWatchLayerRelease,
): RuntimeSchemaResult<ValidatedRuntimeManifest> {
  try {
    return Object.freeze({
      data: parseRuntimeManifest(value, compiledRelease),
      success: true,
    });
  } catch (error) {
    if (error instanceof RuntimeSchemaError) {
      return Object.freeze({ error, success: false });
    }
    throw error;
  }
}
