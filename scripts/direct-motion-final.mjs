import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { generateWatchLayerPresentationProfiles } from "./build-watch-layer-assets.mjs";
import { decodeCanonicalMask } from "./watch-2-5d/image-operations.mjs";
import { hashPhaseProjection } from "./watch-2-5d/manifest-closure.mjs";
import { APPROVED_MASTER_IDENTITY, PREDECESSOR_MANIFEST_IDENTITY, ENHANCEMENT_BUDGETS, CANONICAL_SOURCE_COORDINATE_SPACE, LAYER_ASSET_MANIFEST_SCHEMA, RELEASE_POINTER_SCHEMA } from "./watch-2-5d/contract.mjs";
import { createHash } from "node:crypto";

const masterBytes = await readFile(resolve("source/assets/elite-watch-master.png"));
const { data, info } = await sharp(masterBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const canonicalSource = { width: info.width, height: info.height, data };
const reconstructedBackground = { width: info.width, height: info.height, data };
const maskBytes = await readFile(resolve("source/assets/watch-2-5d/v1/masks/upper-right-wheel.png"));
const maskDecoded = await decodeCanonicalMask(maskBytes, { path: "source/assets/watch-2-5d/v1/masks/upper-right-wheel.png" });
const layerRecord = {
  approvalIds: ["approval-upper-right-wheel-segmentation", "approval-upper-right-wheel-reconstruction", "approval-upper-right-wheel-pivot", "approval-upper-right-wheel-motion", "approval-upper-right-wheel-fidelity"],
  disposition: "approved-moving",
  id: "upper-right-wheel-layer",
  motionProfileId: "upper-right-wheel-motion",
  pivot: { x: 1925, y: 355 },
  provenanceIds: ["provenance-upper-right-wheel-layer"],
  reconstructedPixelCount: 704000,
  referenceTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  segmentationMaskId: "upper-right-wheel",
  semanticClass: "exposed-gear",
  sourceRect: { height: 640, width: 1100, x: 1375, y: 35 },
  sourceVisiblePixelCount: 704000,
  zOrder: 1,
};
const motionProfile = {
  approvalId: "approval-upper-right-wheel-motion",
  direction: 1,
  evidence: "authored-assumption",
  id: "upper-right-wheel-motion",
  kind: "continuous-rotation",
  layerId: "upper-right-wheel-layer",
  maxRadians: 6.283185307179586,
  minRadians: -6.283185307179586,
  periodMs: 2000,
  phaseRadians: 0,
  pivot: { x: 1925, y: 355 },
  referenceRadians: 0,
};
const presentation = await generateWatchLayerPresentationProfiles({
  approvedMovingLayerIds: ["upper-right-wheel-layer"],
  canonicalSource,
  layerInputs: [{ mask: { data: maskDecoded.data, height: maskDecoded.height, width: maskDecoded.width }, record: layerRecord }],
  motionProfiles: [motionProfile],
  packageId: "watch-layer-package",
  reconstructedBackground,
  releaseId: "watch-layer-release-v1",
  selectedPhase: "approved-part-motion",
});
console.log("Generated", presentation.files.length, "files");
const assetSha256 = presentation.publicAssets.map(a => a.sha256);
const runtimeHash = presentation.runtimeManifestIdentity.sha256;
const phasePayloadHash = hashPhaseProjection("watch-layer-package", {
  assetSha256,
  name: "approved-part-motion",
  runtimeManifestSha256: runtimeHash,
});
console.log("Phase payload", phasePayloadHash.slice(0,8));

// Create package manifest for motion
const packageManifest = {
  approvals: [
    {
      artifactSha256: ["c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0"],
      decision: "approved",
      id: "approval-upper-right-wheel-segmentation",
      layerIds: ["upper-right-wheel-layer"],
      notes: "Segmentation approval",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [100, 200],
      reviewer: "demo-reviewer",
      scope: "segmentation",
    },
    {
      artifactSha256: ["f583edefb3a2295d956a8d5d0a7814388e2e01b01f84d897a402c901e74246d3", "c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0", "fa480cc5c3a7ad7318274a2303f2c5998818d647267632f198eea504c4ce9fe7"],
      decision: "approved",
      id: "approval-upper-right-wheel-reconstruction",
      layerIds: ["upper-right-wheel-layer"],
      notes: "Reconstruction approval",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [100, 200],
      reviewer: "demo-reviewer",
      scope: "reconstruction",
    },
    {
      artifactSha256: [createHash("sha256").update(JSON.stringify({ layerId: "upper-right-wheel-layer", pivot: { x: 1925, y: 355 } })).digest("hex")],
      decision: "approved",
      id: "approval-upper-right-wheel-pivot",
      layerIds: ["upper-right-wheel-layer"],
      notes: "Pivot approval",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [100, 200],
      reviewer: "demo-reviewer",
      scope: "pivot",
    },
    {
      artifactSha256: [createHash("sha256").update(JSON.stringify(motionProfile)).digest("hex")],
      decision: "approved",
      id: "approval-upper-right-wheel-motion",
      layerIds: ["upper-right-wheel-layer"],
      notes: "Motion approval",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [100, 200],
      reviewer: "demo-reviewer",
      scope: "motion",
    },
    {
      artifactSha256: [...new Set([APPROVED_MASTER_IDENTITY.sha256, phasePayloadHash, runtimeHash, ...assetSha256])].sort(),
      decision: "approved",
      id: "approval-upper-right-wheel-fidelity",
      layerIds: ["upper-right-wheel-layer"],
      notes: "Fidelity approval",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewedPoseIds: ["reference-pose", "upper-right-wheel-motion-maximum", "upper-right-wheel-motion-minimum"],
      reviewedZoomPercent: [100, 200],
      reviewer: "demo-reviewer",
      scope: "fidelity",
    },
    {
      artifactSha256: [...new Set([phasePayloadHash, runtimeHash, ...assetSha256])].sort(),
      decision: "approved",
      id: "release-approved-part-motion",
      layerIds: ["upper-right-wheel-layer"],
      notes: "Release approval",
      reviewedAt: "2026-05-20T12:00:00.000Z",
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [100, 200],
      reviewer: "demo-reviewer",
      scope: "release",
    },
  ],
  budgets: ENHANCEMENT_BUDGETS,
  canonicalMaster: APPROVED_MASTER_IDENTITY,
  depthProfiles: [],
  layers: [layerRecord],
  masks: [
    { alphaSum: 179520000, file: "source/assets/watch-2-5d/v1/masks/upper-right-wheel.png", height: 1504, id: "upper-right-wheel", nonZeroPixelCount: 704000, provenanceId: "provenance-upper-right-wheel-mask", sha256: "c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0", tightBounds: { height: 640, width: 1100, x: 1375, y: 35 }, width: 2760 },
    { alphaSum: 179520000, file: "source/assets/watch-2-5d/v1/masks/upper-right-wheel-region.png", height: 1504, id: "upper-right-wheel-region", nonZeroPixelCount: 704000, provenanceId: "provenance-upper-right-wheel-region", sha256: "c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0", tightBounds: { height: 640, width: 1100, x: 1375, y: 35 }, width: 2760 },
    { alphaSum: 183085920, file: "source/assets/watch-2-5d/v1/masks/upper-right-wheel-boundary.png", height: 1504, id: "upper-right-wheel-boundary", nonZeroPixelCount: 717984, provenanceId: "provenance-upper-right-wheel-boundary", sha256: "fa480cc5c3a7ad7318274a2303f2c5998818d647267632f198eea504c4ce9fe7", tightBounds: { height: 648, width: 1108, x: 1371, y: 31 }, width: 2760 },
  ],
  motionProfiles: [motionProfile],
  packageId: "watch-layer-package",
  packageVersion: "1.2.0",
  parentSpec: ".kiro/specs/animated-watch-image-glass-header",
  phases: [
    { assetSha256: [], name: "source-preparation", ordinal: 0, phasePayloadSha256: "485a236b649cb91894e6b1dd4d2ef0eb64892731fbe346b4f97c1def261a5ccd", runtimeManifestSha256: null, status: "approved" },
    { assetSha256: ["f891fb67c13cf43f09287d6d3de96de738e5df0c335140a68d5fd93e8d7453e6", "ac4c1858375a8eff3d1677647acfce0fe52a2b9f4ebae5de8a273d61911a79f1"], name: "static-layered-reconstruction", ordinal: 1, phasePayloadSha256: "141cfd868fcc7438b84b34c9b65c1f1ead3e2d0b9c921a62e998d7f2b5c2f73c", runtimeManifestSha256: "34f6df7649b1777137d5802f991bc715c727592d12031ed5da40102368e66bda", status: "approved" },
    { assetSha256, approvalId: "release-approved-part-motion", name: "approved-part-motion", ordinal: 2, phasePayloadSha256: phasePayloadHash, runtimeManifestSha256: runtimeHash, status: "approved" },
    { assetSha256: [], name: "optional-depth", ordinal: 3, phasePayloadSha256: "16a3ba7db805a5e92cf71c389d8380379d42ca987248c7d13d62ea40b2211740", runtimeManifestSha256: null, status: "disabled" },
  ],
  predecessorContract: PREDECESSOR_MANIFEST_IDENTITY,
  provenance: [
    { artifactId: "upper-right-wheel", artifactSha256: "c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0", classification: "source-derived", createdAt: "2026-05-20T12:00:00.000Z", id: "provenance-upper-right-wheel-mask", immediateParentSha256: ["7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b"], method: "manual-mask", operator: "demo-operator", settings: {}, tool: { name: "demo-tool", version: "1.0.0" } },
    { artifactId: "upper-right-wheel-region", artifactSha256: "c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0", classification: "source-derived", createdAt: "2026-05-20T12:00:00.001Z", id: "provenance-upper-right-wheel-region", immediateParentSha256: ["7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b"], method: "manual-mask", operator: "demo-operator", settings: {}, tool: { name: "demo-tool", version: "1.0.0" } },
    { artifactId: "upper-right-wheel-boundary", artifactSha256: "fa480cc5c3a7ad7318274a2303f2c5998818d647267632f198eea504c4ce9fe7", classification: "source-derived", createdAt: "2026-05-20T12:00:00.002Z", id: "provenance-upper-right-wheel-boundary", immediateParentSha256: ["7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b"], method: "manual-mask", operator: "demo-operator", settings: {}, tool: { name: "demo-tool", version: "1.0.0" } },
    { artifactId: "upper-right-wheel-fill", artifactSha256: "f583edefb3a2295d956a8d5d0a7814388e2e01b01f84d897a402c901e74246d3", classification: "synthetic", createdAt: "2026-05-20T12:00:00.003Z", id: "provenance-upper-right-wheel-fill", immediateParentSha256: ["c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0", "fa480cc5c3a7ad7318274a2303f2c5998818d647267632f198eea504c4ce9fe7"], method: "manual-paint", operator: "demo-operator", settings: {}, tool: { name: "demo-tool", version: "1.0.0" } },
    { artifactId: "upper-right-wheel-layer", artifactSha256: "4178c33c8a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4", classification: "source-derived", createdAt: "2026-05-20T12:00:00.004Z", id: "provenance-upper-right-wheel-layer", immediateParentSha256: ["c05e3a8da1c892839b1ac508efd1d54eccf5c016d522fabc09cb1e797c7907c0"], method: "manual-mask", operator: "demo-operator", settings: {}, tool: { name: "demo-tool", version: "1.0.0" } },
    { artifactId: "upper-right-wheel-motion", artifactSha256: "ae696cfc8a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4", classification: "synthetic", createdAt: "2026-05-20T12:00:00.005Z", id: "provenance-upper-right-wheel-motion", immediateParentSha256: ["4178c33c8a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4a9c4"], method: "manual-mask", operator: "demo-operator", settings: {}, tool: { name: "demo-tool", version: "1.0.0" } },
  ],
  publicAssets: presentation.publicAssets,
  reconstructions: [
    { approvalId: "approval-upper-right-wheel-reconstruction", boundaryMaskId: "upper-right-wheel-boundary", fillFile: "source/assets/watch-2-5d/v1/reconstruction/upper-right-wheel-fill.png", fillId: "upper-right-wheel-fill", fillSha256: "f583edefb3a2295d956a8d5d0a7814388e2e01b01f84d897a402c901e74246d3", id: "upper-right-wheel-reconstruction", method: "manual-paint", provenanceId: "provenance-upper-right-wheel-fill", regionMaskId: "upper-right-wheel-region", syntheticPixelCount: 704000 },
  ],
  relationships: [],
  runtimeManifest: {
    byteLength: presentation.runtimeManifestIdentity.byteLength,
    file: presentation.runtimeManifestIdentity.file,
    mediaType: presentation.runtimeManifestIdentity.mediaType,
    publicPath: presentation.runtimeManifestIdentity.publicPath,
    sha256: runtimeHash,
  },
  schemaVersion: 1,
  sourceCoordinateSpace: CANONICAL_SOURCE_COORDINATE_SPACE,
  sourceDateEpoch: 1700000000,
};

for (const f of presentation.files) {
  const target = resolve(f.path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, f.bytes);
  console.log("Wrote", f.path);
}
await writeFile(resolve("data/watch-layer-package.json"), LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(packageManifest));
console.log("Wrote package 1.2.0");
const release = {
  depthEnabled: false,
  packageId: "watch-layer-package",
  releaseId: "watch-layer-release-v1",
  runtimeManifest: {
    byteLength: presentation.runtimeManifestIdentity.byteLength,
    mediaType: presentation.runtimeManifestIdentity.mediaType,
    publicPath: presentation.runtimeManifestIdentity.publicPath,
    sha256: runtimeHash,
  },
  schemaVersion: 1,
  status: "ready",
};
const { RELEASE_POINTER_SCHEMA } = await import("./watch-2-5d/contract.mjs");
await writeFile(resolve("data/watch-layer-release.json"), RELEASE_POINTER_SCHEMA.serializeLine(release));
console.log("Wrote release 1.2.0 approved-part-motion");
