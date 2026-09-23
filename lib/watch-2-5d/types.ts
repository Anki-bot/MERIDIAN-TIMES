const SHA256_BRAND: unique symbol = Symbol("Sha256");
const ASSET_ID_BRAND: unique symbol = Symbol("AssetId");
const LAYER_ID_BRAND: unique symbol = Symbol("LayerId");
const APPROVAL_ID_BRAND: unique symbol = Symbol("ApprovalId");
const MOTION_PROFILE_ID_BRAND: unique symbol = Symbol("MotionProfileId");
const DEPTH_PROFILE_ID_BRAND: unique symbol = Symbol("DepthProfileId");
const PACKAGE_ID_BRAND: unique symbol = Symbol("PackageId");
const RELEASE_ID_BRAND: unique symbol = Symbol("ReleaseId");
const VALIDATED_MANIFEST_BRAND: unique symbol = Symbol("ValidatedRuntimeManifest");

export type Sha256 = string & { readonly [SHA256_BRAND]: true };
export type AssetId = string & { readonly [ASSET_ID_BRAND]: true };
export type LayerId = string & { readonly [LAYER_ID_BRAND]: true };
export type ApprovalId = string & { readonly [APPROVAL_ID_BRAND]: true };
export type MotionProfileId = string & { readonly [MOTION_PROFILE_ID_BRAND]: true };
export type DepthProfileId = string & { readonly [DEPTH_PROFILE_ID_BRAND]: true };
export type PackageId = string & { readonly [PACKAGE_ID_BRAND]: true };
export type ReleaseId = string & { readonly [RELEASE_ID_BRAND]: true };

export const CANONICAL_SOURCE_WIDTH = 2_760 as const;
export const CANONICAL_SOURCE_HEIGHT = 1_504 as const;
export const CANONICAL_MASTER_SHA256 =
  "7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b" as Sha256;
export const WATCH_LAYER_PUBLIC_ROOT = "/assets/watch-2-5d/v1/" as const;
export const WATCH_LAYER_RUNTIME_MANIFEST_PATH =
  "/assets/watch-2-5d/v1/runtime-manifest.json" as const;

export const PROFILE_IDS = ["compact", "expanded"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];
export type ProfileSourceScale<P extends ProfileId> = P extends "compact" ? 0.5 : 1;

export const RUNTIME_PHASES = [
  "static-layered-reconstruction",
  "approved-part-motion",
  "optional-depth",
] as const;
export type RuntimePhase = (typeof RUNTIME_PHASES)[number];

export interface SourcePoint {
  readonly x: number;
  readonly y: number;
}

/** A nonempty half-open rectangle in canonical 2760×1504 source coordinates. */
export interface SourceRect extends SourcePoint {
  readonly width: number;
  readonly height: number;
}

export interface ReadonlyMatrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface PublicAssetColorMetadata {
  readonly alpha: true;
  readonly channels: 4;
  readonly colourspace: "srgb";
}

export interface PublicAssetEncoder {
  readonly alphaQuality: 100;
  readonly channels: 4;
  readonly colourspace: "srgb";
  readonly effort: 6;
  readonly nearLossless: false;
  readonly quality: number;
  readonly smartSubsample: true;
}

export type PublicAssetPath<P extends ProfileId = ProfileId> =
  `/assets/watch-2-5d/v1/${P}/${string}.webp`;
export type PublicAssetFile<P extends ProfileId = ProfileId> =
  `public/assets/watch-2-5d/v1/${P}/${string}.webp`;
export type PublicAssetLayerId = LayerId | "reconstructed-background";

export interface PublicAssetRecord<P extends ProfileId = ProfileId> {
  readonly id: AssetId;
  readonly profile: P;
  readonly layerId: PublicAssetLayerId;
  readonly file: PublicAssetFile<P>;
  readonly publicPath: PublicAssetPath<P>;
  readonly mediaType: "image/webp";
  readonly magicSignatureHex: string;
  readonly sha256: Sha256;
  readonly byteLength: number;
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
  readonly decodedPixelCount: number;
  readonly decodedRgbaByteLength: number;
  readonly sourceRect: SourceRect;
  readonly zOrder: number;
  readonly colorMetadata: PublicAssetColorMetadata;
  readonly encoder: PublicAssetEncoder;
}

export interface EnhancementProfile<P extends ProfileId = ProfileId> {
  readonly id: P;
  readonly sourceScale: ProfileSourceScale<P>;
  readonly assets: readonly PublicAssetRecord<P>[];
  readonly transferBytes: number;
  readonly decodedRgbaBytes: number;
  readonly requestCountIncludingManifest: number;
}

export type CompactEnhancementProfile = EnhancementProfile<"compact">;
export type ExpandedEnhancementProfile = EnhancementProfile<"expanded">;

export interface RuntimeProfiles {
  readonly compact: CompactEnhancementProfile;
  readonly expanded: ExpandedEnhancementProfile;
}

export type Direction = -1 | 1;
export type MotionEvidence = "visible-evidence" | "authored-assumption";

export interface MotionProfileBase {
  readonly id: MotionProfileId;
  readonly layerId: LayerId;
  readonly pivot: SourcePoint;
  readonly direction: Direction;
  readonly phaseRadians: number;
  readonly minRadians: number;
  readonly maxRadians: number;
  readonly referenceRadians: number;
  readonly evidence: MotionEvidence;
  readonly approvalId: ApprovalId;
}

export interface ContinuousRotationProfile extends MotionProfileBase {
  readonly kind: "continuous-rotation";
  readonly periodMs: number;
}

export interface DiscreteRotationProfile extends MotionProfileBase {
  readonly kind: "discrete-rotation";
  readonly cadenceMs: number;
  readonly stepRadians: number;
}

export interface OscillationProfile extends MotionProfileBase {
  readonly kind: "oscillation";
  readonly periodMs: number;
  readonly amplitudeRadians: number;
}

export type MotionProfile =
  | ContinuousRotationProfile
  | DiscreteRotationProfile
  | OscillationProfile;

export interface DepthLayerValue {
  readonly layerId: LayerId;
  readonly zOrder: number;
  readonly displacementShortAxisFraction: number;
  readonly scaleDelta: number;
  readonly rotationDegrees: number;
  readonly phaseRadians: number;
}

export interface DepthProfile<P extends ProfileId = ProfileId> {
  readonly id: DepthProfileId;
  readonly profile: P;
  readonly enabled: boolean;
  readonly periodMs: number;
  readonly layers: readonly DepthLayerValue[];
  readonly authoredInterpretation: true;
  readonly approvalId?: ApprovalId;
}

export type CompactDepthProfile = DepthProfile<"compact">;
export type ExpandedDepthProfile = DepthProfile<"expanded">;

export interface RuntimeManifest {
  readonly schemaVersion: 1;
  readonly packageId: PackageId;
  readonly releaseId: ReleaseId;
  readonly canonicalMasterSha256: Sha256;
  readonly phase: RuntimePhase;
  readonly profiles: RuntimeProfiles;
  readonly motionProfiles: readonly MotionProfile[];
  readonly depthProfiles: readonly DepthProfile[];
}

/** A manifest can receive this brand only from release-bound runtime schema validation. */
export type ValidatedRuntimeManifest = RuntimeManifest & {
  readonly [VALIDATED_MANIFEST_BRAND]: true;
};

export interface RuntimeManifestIdentity {
  readonly publicPath: typeof WATCH_LAYER_RUNTIME_MANIFEST_PATH;
  readonly mediaType: "application/json";
  readonly sha256: Sha256;
  readonly byteLength: number;
}

export interface FallbackOnlyWatchLayerRelease {
  readonly schemaVersion: 1;
  readonly status: "fallback-only";
  readonly runtimeManifest: null;
  readonly depthEnabled: false;
}

export interface ReadyWatchLayerRelease {
  readonly schemaVersion: 1;
  readonly status: "ready";
  readonly releaseId: ReleaseId;
  readonly packageId: PackageId;
  readonly runtimeManifest: RuntimeManifestIdentity;
  readonly depthEnabled: boolean;
}

export type WatchLayerRelease =
  | FallbackOnlyWatchLayerRelease
  | ReadyWatchLayerRelease;

export interface PreparedAsset<P extends ProfileId = ProfileId> {
  readonly record: PublicAssetRecord<P>;
  readonly objectUrl: string;
  readonly image: HTMLImageElement;
}

/** A complete decoded profile. Partial asset collections cannot satisfy this type. */
export interface PreparedProfile<P extends ProfileId = ProfileId> {
  readonly id: P;
  readonly release: ReadyWatchLayerRelease;
  readonly manifest: ValidatedRuntimeManifest;
  readonly profile: EnhancementProfile<P>;
  readonly assets: readonly PreparedAsset<P>[];
}

export const SUPPORT_CODES = [
  "browser-unknown",
  "browser-version-unsupported",
  "fetch-unavailable",
  "abort-controller-unavailable",
  "crypto-digest-unavailable",
  "image-decode-unavailable",
  "animation-frame-unavailable",
  "resize-observer-unavailable",
  "media-query-unavailable",
  "page-visibility-unavailable",
  "css-transform-unavailable",
  "css-custom-properties-unavailable",
] as const;
export type SupportCode = (typeof SUPPORT_CODES)[number];

export type BrowserSupportResult =
  | { readonly supported: true }
  | { readonly supported: false; readonly code: SupportCode };

export const RUNTIME_FAILURE_CODES = [
  "manifest-fetch",
  "manifest-media",
  "manifest-identity",
  "manifest-schema",
  "asset-fetch",
  "asset-media",
  "asset-identity",
  "asset-dimensions",
  "asset-decode",
  "mapping-invalid",
  "profile-switch",
  "runtime-invariant",
] as const;
export type RuntimeFailureCode = (typeof RUNTIME_FAILURE_CODES)[number];

export function assertNever(value: never, context = "Unhandled watch-layer variant"): never {
  throw new Error(`${context}: ${String(value)}`);
}
