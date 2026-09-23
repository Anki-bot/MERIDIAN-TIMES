import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

type ProfileId = "compact" | "expanded";
type SourceRect = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};
type Raster = {
  readonly data: Uint8Array;
  readonly height: number;
  readonly width: number;
};
type PublicAsset = {
  readonly byteLength: number;
  readonly colorMetadata: {
    readonly alpha: true;
    readonly channels: 4;
    readonly colourspace: "srgb";
  };
  readonly decodedPixelCount: number;
  readonly decodedRgbaByteLength: number;
  readonly encoder: Readonly<Record<string, unknown>>;
  readonly file: string;
  readonly id: string;
  readonly intrinsicHeight: number;
  readonly intrinsicWidth: number;
  readonly layerId: string;
  readonly magicSignatureHex: string;
  readonly mediaType: "image/webp";
  readonly profile: ProfileId;
  readonly publicPath: string;
  readonly sha256: string;
  readonly sourceRect: SourceRect;
  readonly zOrder: number;
};
type EnhancementProfile = {
  readonly assets: readonly PublicAsset[];
  readonly decodedRgbaBytes: number;
  readonly id: ProfileId;
  readonly requestCountIncludingManifest: number;
  readonly sourceScale: 0.5 | 1;
  readonly transferBytes: number;
};
type RuntimeManifest = {
  readonly depthProfiles: readonly unknown[];
  readonly motionProfiles: readonly Record<string, unknown>[];
  readonly phase: "static-layered-reconstruction" | "approved-part-motion";
  readonly profiles: Readonly<Record<ProfileId, EnhancementProfile>>;
};
type GeneratedProfiles = {
  readonly files: readonly {
    readonly bytes: Buffer;
    readonly identity: {
      readonly byteLength: number;
      readonly path: string;
      readonly sha256: string;
    };
    readonly path: string;
  }[];
  readonly profiles: Readonly<Record<ProfileId, EnhancementProfile>> | null;
  readonly publicAssets: readonly PublicAsset[];
  readonly releaseStatus: "fallback-only" | "ready";
  readonly runtimeManifest: RuntimeManifest | null;
  readonly runtimeManifestIdentity: {
    readonly byteLength: number;
    readonly file: string;
    readonly mediaType: "application/json";
    readonly publicPath: string;
    readonly sha256: string;
  } | null;
  readonly selectedPhase: string;
  readonly stagingDirectory: string | null;
};
type ProfileGenerationOptions = {
  readonly approvedMovingLayerIds?: readonly string[];
  readonly approvedStaticOccluderLayerIds?: readonly string[];
  readonly canonicalSource?: Raster;
  readonly layerInputs?: readonly {
    readonly mask: Raster;
    readonly record: Readonly<Record<string, unknown>>;
  }[];
  readonly motionProfiles?: readonly Readonly<Record<string, unknown>>[];
  readonly packageId?: string;
  readonly reconstructedBackground?: Raster;
  readonly releaseId?: string;
  readonly selectedPhase?: string;
  readonly stagingDirectory?: string;
};
type BuilderModule = {
  readonly MAX_WATCH_LAYER_PROFILE_IMAGES: number;
  readonly WATCH_LAYER_PROFILE_SPECS: Readonly<Record<ProfileId, {
    readonly height: number;
    readonly sourceScale: 0.5 | 1;
    readonly width: number;
  }>>;
  readonly WATCH_LAYER_RUNTIME_MANIFEST_PATH: string;
  readonly WATCH_LAYER_WEBP_ENCODER: Readonly<Record<string, unknown>>;
  generateWatchLayerPresentationProfiles(
    options?: ProfileGenerationOptions,
  ): Promise<GeneratedProfiles>;
};
type ContractModule = {
  readonly ENHANCEMENT_BUDGETS: {
    readonly compact: {
      readonly maxDecodedRgbaBytes: number;
      readonly maxTransferBytes: number;
    };
    readonly expanded: {
      readonly maxDecodedRgbaBytes: number;
      readonly maxTransferBytes: number;
    };
    readonly maxRequestsIncludingRuntimeManifest: number;
  };
  readonly RUNTIME_MANIFEST_SCHEMA: {
    parseJson(value: Uint8Array, options?: Readonly<Record<string, unknown>>): RuntimeManifest;
    serializeLine(value: RuntimeManifest): Buffer;
  };
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const builder = (await import("../../scripts/build-watch-layer-assets.mjs")) as unknown as BuilderModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;

const SOURCE_WIDTH = 2_760;
const SOURCE_HEIGHT = 1_504;
const IDENTITY_MATRIX = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
const MOVING_RECT = Object.freeze({ height: 48, width: 64, x: 120, y: 160 });
const STATIC_RECT = Object.freeze({ height: 24, width: 32, x: 240, y: 220 });
const temporaryRoots = new Set<string>();

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function paintRect(
  data: Buffer,
  rect: SourceRect,
  color: readonly [number, number, number, number],
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * SOURCE_WIDTH + x) * 4;
      data.set(color, offset);
    }
  }
}

function rectMask(rect: SourceRect): Raster {
  const data = Buffer.alloc(SOURCE_WIDTH * SOURCE_HEIGHT);
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    data.fill(255, y * SOURCE_WIDTH + rect.x, y * SOURCE_WIDTH + rect.x + rect.width);
  }
  return { data, height: SOURCE_HEIGHT, width: SOURCE_WIDTH };
}

function movingLayerRecord(id = "approved-wheel"): Readonly<Record<string, unknown>> {
  return Object.freeze({
    approvalIds: ["segmentation-approval", "motion-approval"],
    disposition: "approved-moving",
    id,
    motionProfileId: `${id}-motion`,
    pivot: { x: MOVING_RECT.x + 32, y: MOVING_RECT.y + 24 },
    provenanceIds: [`${id}-provenance`],
    reconstructedPixelCount: MOVING_RECT.width * MOVING_RECT.height,
    referenceTransform: IDENTITY_MATRIX,
    segmentationMaskId: `${id}-mask`,
    semanticClass: "exposed-gear",
    sourceRect: MOVING_RECT,
    sourceVisiblePixelCount: MOVING_RECT.width * MOVING_RECT.height,
    zOrder: 10,
  });
}

function staticLayerRecord(
  id = "unapproved-static-candidate",
  zOrder = 20,
  approvalIds: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    approvalIds,
    disposition: "static",
    id,
    provenanceIds: [`${id}-provenance`],
    reconstructedPixelCount: 0,
    referenceTransform: IDENTITY_MATRIX,
    segmentationMaskId: `${id}-mask`,
    semanticClass: "bridge",
    sourceRect: STATIC_RECT,
    sourceVisiblePixelCount: STATIC_RECT.width * STATIC_RECT.height,
    zOrder,
  });
}

function motionProfile(id = "approved-wheel"): Readonly<Record<string, unknown>> {
  return Object.freeze({
    approvalId: "motion-approval",
    direction: 1,
    evidence: "authored-assumption",
    id: `${id}-motion`,
    kind: "continuous-rotation",
    layerId: id,
    maxRadians: Math.PI * 2,
    minRadians: -Math.PI * 2,
    periodMs: 12_000,
    phaseRadians: 0,
    pivot: { x: MOVING_RECT.x + 32, y: MOVING_RECT.y + 24 },
    referenceRadians: 0,
  });
}

function createApprovedSyntheticFixture(): ProfileGenerationOptions & {
  readonly canonicalSource: Raster;
  readonly reconstructedBackground: Raster;
} {
  const canonicalData = Buffer.alloc(SOURCE_WIDTH * SOURCE_HEIGHT * 4);
  canonicalData.fill(Buffer.from([24, 48, 72, 255]));
  paintRect(canonicalData, MOVING_RECT, [210, 90, 30, 255]);
  paintRect(canonicalData, STATIC_RECT, [80, 150, 210, 255]);
  const backgroundData = Buffer.from(canonicalData);
  paintRect(backgroundData, MOVING_RECT, [24, 48, 72, 255]);

  return {
    approvedMovingLayerIds: ["approved-wheel"],
    approvedStaticOccluderLayerIds: [],
    canonicalSource: { data: canonicalData, height: SOURCE_HEIGHT, width: SOURCE_WIDTH },
    layerInputs: [
      { mask: rectMask(MOVING_RECT), record: movingLayerRecord() },
      { mask: rectMask(STATIC_RECT), record: staticLayerRecord() },
    ],
    motionProfiles: [motionProfile()],
    packageId: "synthetic-watch-package",
    reconstructedBackground: {
      data: backgroundData,
      height: SOURCE_HEIGHT,
      width: SOURCE_WIDTH,
    },
    releaseId: "synthetic-watch-release",
    selectedPhase: "approved-part-motion",
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

async function listFiles(root: string, relativePath = ""): Promise<readonly string[]> {
  const directory = relativePath ? resolve(root, relativePath) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("deterministic watch-layer presentation profiles", () => {
  it("stages byte-identical compact/expanded WebPs with closed identities and budgets", async () => {
    expect(contract.ENHANCEMENT_BUDGETS).toMatchObject({
      compact: {
        maxDecodedRgbaBytes: 25_165_824,
        maxTransferBytes: 1_572_864,
      },
      expanded: {
        maxDecodedRgbaBytes: 50_331_648,
        maxTransferBytes: 3_145_728,
      },
      maxRequestsIncludingRuntimeManifest: 8,
    });
    expect(builder.WATCH_LAYER_WEBP_ENCODER).toEqual({
      alphaQuality: 100,
      channels: 4,
      colourspace: "srgb",
      effort: 6,
      nearLossless: false,
      quality: 95,
      smartSubsample: true,
    });

    const fixture = createApprovedSyntheticFixture();
    const sourceBefore = sha256(fixture.canonicalSource.data);
    const backgroundBefore = sha256(fixture.reconstructedBackground.data);
    const parent = await temporaryRoot("watch-layer-profile-stage-");
    const firstStage = resolve(parent, "first");
    const secondStage = resolve(parent, "second");
    await mkdir(firstStage);
    await mkdir(secondStage);

    const first = await builder.generateWatchLayerPresentationProfiles({
      ...fixture,
      stagingDirectory: firstStage,
    });
    const second = await builder.generateWatchLayerPresentationProfiles({
      ...fixture,
      stagingDirectory: secondStage,
    });

    expect(first.releaseStatus).toBe("ready");
    expect(first.selectedPhase).toBe("approved-part-motion");
    expect(first.runtimeManifest).not.toBeNull();
    expect(first.runtimeManifestIdentity).not.toBeNull();
    expect(second.runtimeManifest).toEqual(first.runtimeManifest);
    expect(second.runtimeManifestIdentity).toEqual(first.runtimeManifestIdentity);
    expect(first.publicAssets).toHaveLength(4);
    expect(first.publicAssets.some(({ layerId }) => (
      layerId === "unapproved-static-candidate"
    ))).toBe(false);
    expect(first.runtimeManifest?.motionProfiles).toHaveLength(1);
    expect(first.runtimeManifest?.depthProfiles).toEqual([]);

    const expectedFiles = [
      "public/assets/watch-2-5d/v1/compact/approved-wheel.webp",
      "public/assets/watch-2-5d/v1/compact/reconstructed-background.webp",
      "public/assets/watch-2-5d/v1/expanded/approved-wheel.webp",
      "public/assets/watch-2-5d/v1/expanded/reconstructed-background.webp",
      builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH,
    ].sort();
    expect(await listFiles(firstStage)).toEqual(expectedFiles);
    expect(await listFiles(secondStage)).toEqual(expectedFiles);
    for (const path of expectedFiles) {
      expect(await readFile(resolve(secondStage, path)), path)
        .toEqual(await readFile(resolve(firstStage, path)));
    }

    const runtimeBytes = await readFile(
      resolve(firstStage, builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH),
    );
    const runtimeManifest = contract.RUNTIME_MANIFEST_SCHEMA.parseJson(runtimeBytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
    expect(runtimeBytes).toEqual(contract.RUNTIME_MANIFEST_SCHEMA.serializeLine(runtimeManifest));
    expect(first.runtimeManifestIdentity).toEqual({
      byteLength: runtimeBytes.byteLength,
      file: builder.WATCH_LAYER_RUNTIME_MANIFEST_PATH,
      mediaType: "application/json",
      publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
      sha256: sha256(runtimeBytes),
    });

    for (const profileId of ["compact", "expanded"] as const) {
      const profile = runtimeManifest.profiles[profileId];
      const limits = contract.ENHANCEMENT_BUDGETS[profileId];
      expect(profile.assets).toHaveLength(2);
      expect(profile.assets.filter(({ layerId }) => (
        layerId === "reconstructed-background"
      ))).toHaveLength(1);
      expect(profile.requestCountIncludingManifest).toBe(3);
      expect(profile.requestCountIncludingManifest)
        .toBeLessThanOrEqual(contract.ENHANCEMENT_BUDGETS.maxRequestsIncludingRuntimeManifest);
      expect(profile.transferBytes + runtimeBytes.byteLength)
        .toBeLessThanOrEqual(limits.maxTransferBytes);
      expect(profile.decodedRgbaBytes).toBeLessThanOrEqual(limits.maxDecodedRgbaBytes);
      expect(profile.assets.reduce((total, asset) => total + asset.byteLength, 0))
        .toBe(profile.transferBytes);
      expect(profile.assets.reduce(
        (total, asset) => total + asset.decodedRgbaByteLength,
        0,
      )).toBe(profile.decodedRgbaBytes);

      const background = profile.assets.find(({ layerId }) => (
        layerId === "reconstructed-background"
      ));
      const moving = profile.assets.find(({ layerId }) => layerId === "approved-wheel");
      expect(background).toMatchObject({
        intrinsicHeight: builder.WATCH_LAYER_PROFILE_SPECS[profileId].height,
        intrinsicWidth: builder.WATCH_LAYER_PROFILE_SPECS[profileId].width,
        sourceRect: { height: SOURCE_HEIGHT, width: SOURCE_WIDTH, x: 0, y: 0 },
      });
      expect(moving).toMatchObject({
        intrinsicHeight: profileId === "compact" ? 24 : 48,
        intrinsicWidth: profileId === "compact" ? 32 : 64,
        sourceRect: MOVING_RECT,
        zOrder: 10,
      });
    }

    for (const asset of first.publicAssets) {
      const bytes = await readFile(resolve(firstStage, asset.file));
      const metadata = await sharp(bytes, { failOn: "error" }).metadata();
      expect(asset.mediaType).toBe("image/webp");
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(asset.magicSignatureHex).toBe(bytes.subarray(0, 12).toString("hex"));
      expect(asset.sha256).toBe(sha256(bytes));
      expect(asset.byteLength).toBe(bytes.byteLength);
      expect(asset.publicPath).toBe(`/${asset.file.slice("public/".length)}`);
      expect(asset.decodedPixelCount).toBe(asset.intrinsicWidth * asset.intrinsicHeight);
      expect(asset.decodedRgbaByteLength).toBe(asset.decodedPixelCount * 4);
      expect(asset.colorMetadata).toEqual({ alpha: true, channels: 4, colourspace: "srgb" });
      expect(asset.encoder).toEqual(builder.WATCH_LAYER_WEBP_ENCODER);
      expect(metadata).toMatchObject({
        format: "webp",
        height: asset.intrinsicHeight,
        space: "srgb",
        width: asset.intrinsicWidth,
      });
    }
    expect(sha256(fixture.canonicalSource.data)).toBe(sourceBefore);
    expect(sha256(fixture.reconstructedBackground.data)).toBe(backgroundBefore);
  }, 120_000);

  it("emits no profile or runtime asset for fallback-only production selection", async () => {
    const stage = await temporaryRoot("watch-layer-fallback-profile-");
    const result = await builder.generateWatchLayerPresentationProfiles({
      selectedPhase: "fallback-only",
      stagingDirectory: stage,
    });

    expect(result).toMatchObject({
      files: [],
      profiles: null,
      publicAssets: [],
      releaseStatus: "fallback-only",
      runtimeManifest: null,
      runtimeManifestIdentity: null,
      selectedPhase: "fallback-only",
    });
    expect(await listFiles(stage)).toEqual([]);
  });

  it("enforces approved layer eligibility and the six-crop/eight-request boundary", async () => {
    const fixture = createApprovedSyntheticFixture();
    const staticRecord = staticLayerRecord();
    await expect(builder.generateWatchLayerPresentationProfiles({
      ...fixture,
      approvedMovingLayerIds: ["unapproved-static-candidate"],
      layerInputs: [{ mask: rectMask(STATIC_RECT), record: staticRecord }],
      motionProfiles: [],
    })).rejects.toMatchObject({
      code: "LAYER_MOTION_INVALID",
      issueCode: "LAYER_BUILD_PROFILE_LAYER_FORBIDDEN",
    });

    const motionCandidate = Object.freeze({
      ...movingLayerRecord("unapproved-motion-candidate"),
      approvalIds: [],
      disposition: "motion-candidate",
    });
    await expect(builder.generateWatchLayerPresentationProfiles({
      ...fixture,
      approvedMovingLayerIds: ["unapproved-motion-candidate"],
      layerInputs: [{ mask: rectMask(MOVING_RECT), record: motionCandidate }],
      motionProfiles: [],
    })).rejects.toMatchObject({
      code: "LAYER_MOTION_INVALID",
      issueCode: "LAYER_BUILD_PROFILE_LAYER_FORBIDDEN",
    });

    const approvedOccluders = Array.from({ length: 6 }, (_, index) => ({
      mask: rectMask(STATIC_RECT),
      record: staticLayerRecord(`approved-occluder-${index + 1}`, 30 + index, [
        `occluder-approval-${index + 1}`,
      ]),
    }));
    const boundary = await builder.generateWatchLayerPresentationProfiles({
      ...fixture,
      approvedMovingLayerIds: [],
      approvedStaticOccluderLayerIds: approvedOccluders.map(({ record }) => String(record.id)),
      layerInputs: approvedOccluders,
      motionProfiles: [],
      selectedPhase: "static-layered-reconstruction",
    });
    expect(builder.MAX_WATCH_LAYER_PROFILE_IMAGES).toBe(6);
    expect(boundary.publicAssets).toHaveLength(14);
    for (const profileId of ["compact", "expanded"] as const) {
      const profile = boundary.runtimeManifest?.profiles[profileId];
      expect(profile?.requestCountIncludingManifest).toBe(8);
      expect(profile?.assets).toHaveLength(7);
      expect(profile?.assets.filter(({ layerId }) => (
        layerId === "reconstructed-background"
      ))).toHaveLength(1);
      expect(profile?.assets.filter(({ layerId }) => (
        layerId !== "reconstructed-background"
      )).every(({ sourceRect }) => (
        JSON.stringify(sourceRect) === JSON.stringify(STATIC_RECT)
      ))).toBe(true);
    }

    const tooManyOccluders = Array.from({ length: 7 }, (_, index) => ({
      mask: rectMask(STATIC_RECT),
      record: staticLayerRecord(`approved-occluder-${index + 1}`, 30 + index, [
        `occluder-approval-${index + 1}`,
      ]),
    }));
    await expect(builder.generateWatchLayerPresentationProfiles({
      ...fixture,
      approvedMovingLayerIds: [],
      approvedStaticOccluderLayerIds: tooManyOccluders.map(({ record }) => String(record.id)),
      layerInputs: tooManyOccluders,
      motionProfiles: [],
      selectedPhase: "static-layered-reconstruction",
    })).rejects.toMatchObject({
      code: "LAYER_BUDGET_EXCEEDED",
      issueCode: "LAYER_BUILD_PROFILE_LIMIT_EXCEEDED",
    });

    await expect(builder.generateWatchLayerPresentationProfiles({
      selectedPhase: "optional-depth",
    })).rejects.toMatchObject({
      code: "LAYER_DEPTH_INVALID",
      issueCode: "LAYER_BUILD_DEPTH_FORBIDDEN",
    });
  }, 120_000);
});
