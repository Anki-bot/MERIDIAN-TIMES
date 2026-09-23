export const FULL_3D_CANONICAL_MASTER_SHA256 = "7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b" as const;
export const FULL_3D_PACKAGE_ID = "full-3d-watch-package" as const;
export const FULL_3D_RELEASE_ID = "full-3d-watch-release-v1" as const;

export type Full3DSupportCode = "browser-unknown" | "webgl-unavailable" | "full-3d-not-ready";
export type Full3DRuntimeFailureCode = "full-3d-asset-missing" | "full-3d-provenance-invalid";

export interface Full3DAssetPackage {
  readonly schemaVersion: 1;
  readonly packageId: typeof FULL_3D_PACKAGE_ID;
  readonly releaseId: typeof FULL_3D_RELEASE_ID;
  readonly canonicalMasterSha256: typeof FULL_3D_CANONICAL_MASTER_SHA256;
  readonly status: "fallback-only" | "ready";
  readonly geometry: readonly string[];
  readonly materials: readonly string[];
}

export interface Full3DReleaseFallback {
  readonly schemaVersion: 1;
  readonly status: "fallback-only";
  readonly runtimeManifest: null;
}

export interface Full3DReleaseReady {
  readonly schemaVersion: 1;
  readonly status: "ready";
  readonly packageId: typeof FULL_3D_PACKAGE_ID;
  readonly releaseId: typeof FULL_3D_RELEASE_ID;
  readonly runtimeManifest: { readonly publicPath: "/assets/full-3d/runtime.json"; readonly sha256: string; readonly byteLength: number };
}

export type Full3DRelease = Full3DReleaseFallback | Full3DReleaseReady;
