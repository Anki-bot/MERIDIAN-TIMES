import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

type JsonRecord = Record<string, unknown>;

type DerivativeRecord = {
  byteLength: number;
  decodedPixelCount: number;
  decodedRgbaByteLength: number;
  encoder: JsonRecord;
  file: string;
  intrinsicHeight: number;
  intrinsicWidth: number;
  mediaType: "image/avif" | "image/webp";
  publicPath: string;
  sha256: string;
};

type AssetManifest = {
  contractStatus: string;
  derivativePolicy: JsonRecord & {
    derivatives: DerivativeRecord[];
    publicDirectory: string;
    status: string;
  };
  master: JsonRecord & { sourceFile: string };
  presentation: JsonRecord;
  schemaVersion: number;
};

type ExpectedDerivative = {
  file: string;
  height: number;
  mediaType: "image/avif" | "image/webp";
  width: number;
};

type FailureCodes = Readonly<Record<
  | "ASSET_BUDGET_EXCEEDED"
  | "ASSET_PATH_INVALID"
  | "DERIVATIVE_FORMAT_INVALID"
  | "DERIVATIVE_IDENTITY_MISMATCH"
  | "DERIVATIVE_SET_INCOMPLETE"
  | "MANIFEST_INVALID"
  | "MANIFEST_MISSING"
  | "MASTER_FORMAT_INVALID"
  | "MASTER_MISSING",
  string
>>;

type WatchImageContract = {
  aggregateTransferBytes: number;
  avifTransferBytes: number;
  candidates: readonly { height: number; width: number }[];
  decodedPixels: number;
  decodedRgbaBytes: number;
  formats: readonly {
    extension: "avif" | "webp";
    maxTransferBytesPerCandidate: number;
    mediaType: "image/avif" | "image/webp";
  }[];
  manifestFile: string;
  master: {
    aspectRatio: { height: number; width: number };
    intrinsicHeight: number;
    intrinsicWidth: number;
    sha256: string;
  };
  masterFile: string;
  outputDirectory: string;
  selectedTransferBytes: number;
};

type VerificationResult = {
  budgets: { aggregateBytes: number };
  derivatives: readonly DerivativeRecord[];
  master: { sha256: string };
};

type VerifierModule = {
  FAILURE_CODES: FailureCodes;
  WATCH_IMAGE_CONTRACT: WatchImageContract;
  inspectDerivativeBytes: (
    bytes: Buffer,
    expected: ExpectedDerivative,
  ) => Promise<unknown>;
  validateManifestDocument: (
    manifest: unknown,
    options?: { allowPending?: boolean; projectRoot?: string },
  ) => { aggregateBytes: number; pending: boolean };
  verifyWatchImageAssets: (
    options?: { projectRoot?: string },
  ) => Promise<VerificationResult>;
};

type BuildModule = {
  buildWatchImageAssets: (
    options?: { projectRoot?: string },
  ) => Promise<{ aggregateBytes: number; derivatives: readonly DerivativeRecord[] }>;
};

const verifierModuleUrl = `file://${resolve(
  process.cwd(),
  "scripts/verify-watch-image-assets.mjs",
)}`;
const buildModuleUrl = `file://${resolve(
  process.cwd(),
  "scripts/build-watch-image-assets.mjs",
)}`;

const verifierModule = (await import(
  /* @vite-ignore -- The executable module is typed by the local VerifierModule contract. */
  verifierModuleUrl
)) as unknown as VerifierModule;
const buildModule = (await import(
  /* @vite-ignore -- The executable module is typed by the local BuildModule contract. */
  buildModuleUrl
)) as unknown as BuildModule;

const {
  FAILURE_CODES,
  WATCH_IMAGE_CONTRACT,
  inspectDerivativeBytes,
  validateManifestDocument,
  verifyWatchImageAssets,
} = verifierModule;
const { buildWatchImageAssets } = buildModule;

const PROJECT_ROOT = process.cwd();
const MANIFEST_PATH = resolve(PROJECT_ROOT, WATCH_IMAGE_CONTRACT.manifestFile);
const BUILD_SCRIPT_PATH = resolve(PROJECT_ROOT, "scripts/build-watch-image-assets.mjs");
const VERIFY_SCRIPT_PATH = resolve(PROJECT_ROOT, "scripts/verify-watch-image-assets.mjs");
const PACKAGE_PATH = resolve(PROJECT_ROOT, "package.json");
const realManifest = JSON.parse(
  await readFile(MANIFEST_PATH, "utf8"),
) as AssetManifest;
const buildSource = await readFile(BUILD_SCRIPT_PATH, "utf8");
const verifySource = await readFile(VERIFY_SCRIPT_PATH, "utf8");
const temporaryRoots = new Set<string>();

function cloneManifest(): AssetManifest {
  return structuredClone(realManifest);
}

function pendingManifest(): AssetManifest {
  const manifest = cloneManifest();
  manifest.contractStatus = "source-approved-derivatives-pending";
  manifest.derivativePolicy.status = "pending-generation";
  manifest.derivativePolicy.derivatives = [];
  return manifest;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function expectContractFailure(
  operation: () => unknown | Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(Promise.resolve().then(operation)).rejects.toMatchObject({
    code,
    name: "AssetContractError",
  });
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "watch-contract-synthetic-non-hero-"));
  temporaryRoots.add(root);
  return root;
}

async function writeBytes(root: string, relativePath: string, bytes: Uint8Array): Promise<void> {
  const path = resolve(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeManifest(root: string, manifest: AssetManifest): Promise<void> {
  await writeBytes(
    root,
    WATCH_IMAGE_CONTRACT.manifestFile,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  );
}

async function createContractRoot({
  copyDerivatives = false,
  copyMaster = false,
  manifest = cloneManifest(),
}: {
  copyDerivatives?: boolean;
  copyMaster?: boolean;
  manifest?: AssetManifest;
} = {}): Promise<string> {
  const root = await createTemporaryRoot();
  await writeManifest(root, manifest);

  if (copyMaster) {
    const destination = resolve(root, WATCH_IMAGE_CONTRACT.masterFile);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(PROJECT_ROOT, WATCH_IMAGE_CONTRACT.masterFile), destination);
  }

  if (copyDerivatives) {
    for (const derivative of manifest.derivativePolicy.derivatives) {
      const destination = resolve(root, derivative.file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(PROJECT_ROOT, derivative.file), destination);
    }
  }

  return root;
}

async function snapshots(paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const entries = await Promise.all(paths.map(async (path) => [
    path,
    digest(await readFile(path)),
  ] as const));
  return new Map(entries);
}

async function createSyntheticNonHeroWebp(): Promise<Buffer> {
  const width = 16;
  const height = 16;
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const cyan = (pixel + Math.floor(pixel / width)) % 2 === 0;
    const offset = pixel * channels;
    pixels[offset] = cyan ? 0 : 255;
    pixels[offset + 1] = cyan ? 255 : 0;
    pixels[offset + 2] = 255;
  }
  return sharp(pixels, { raw: { channels, height, width } })
    .webp({ quality: 40 })
    .toBuffer();
}

function derivativeFor(
  manifest: AssetManifest,
  extension: "avif" | "webp",
  width?: number,
): DerivativeRecord {
  const suffix = `.${extension}`;
  const derivative = manifest.derivativePolicy.derivatives.find((entry) => (
    entry.file.endsWith(suffix) && (width === undefined || entry.intrinsicWidth === width)
  ));
  if (!derivative) throw new Error(`Missing ${width ?? "any"} ${extension} derivative`);
  return derivative;
}

function stubNetworkFailure(): ReturnType<typeof vi.fn> {
  const networkAttempt = vi.fn(() => Promise.reject(new Error(
    "Tests prohibit network access for the watch image asset contract",
  )));
  vi.stubGlobal("fetch", networkAttempt);
  return networkAttempt;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("watch image source and manifest contract", () => {
  it("returns deterministic failures for a missing manifest and missing or invalid master", async () => {
    const emptyRoot = await createTemporaryRoot();
    await expectContractFailure(
      () => verifyWatchImageAssets({ projectRoot: emptyRoot }),
      FAILURE_CODES.MANIFEST_MISSING,
    );

    const missingMasterRoot = await createContractRoot();
    await expectContractFailure(
      () => verifyWatchImageAssets({ projectRoot: missingMasterRoot }),
      FAILURE_CODES.MASTER_MISSING,
    );

    const invalidMasterRoot = await createContractRoot();
    await writeBytes(
      invalidMasterRoot,
      WATCH_IMAGE_CONTRACT.masterFile,
      Buffer.from("SYNTHETIC_NON_HERO_NOT_A_PNG"),
    );
    await expectContractFailure(
      () => verifyWatchImageAssets({ projectRoot: invalidMasterRoot }),
      FAILURE_CODES.MASTER_FORMAT_INVALID,
    );
  });

  it("accepts a pending manifest only for generation and rejects malformed manifests", async () => {
    const pending = pendingManifest();
    expect(validateManifestDocument(pending, { allowPending: true })).toEqual({
      aggregateBytes: 0,
      pending: true,
    });
    await expectContractFailure(
      () => validateManifestDocument(pending),
      FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
    );

    const unknownField = cloneManifest() as AssetManifest & { unexpectedField?: boolean };
    unknownField.unexpectedField = true;
    await expectContractFailure(
      () => validateManifestDocument(unknownField),
      FAILURE_CODES.MANIFEST_INVALID,
    );

    const malformedRoot = await createTemporaryRoot();
    await writeBytes(
      malformedRoot,
      WATCH_IMAGE_CONTRACT.manifestFile,
      Buffer.from("{ this is deliberately malformed test JSON"),
    );
    await expectContractFailure(
      () => verifyWatchImageAssets({ projectRoot: malformedRoot }),
      FAILURE_CODES.MANIFEST_INVALID,
    );
  });

  it("rejects invalid derivative signatures and MIME/signature disagreement", async () => {
    await expectContractFailure(
      () => inspectDerivativeBytes(
        Buffer.from("SYNTHETIC_NON_HERO_NOT_AN_IMAGE"),
        {
          file: "tests-only/synthetic-non-hero.webp",
          height: 16,
          mediaType: "image/webp",
          width: 16,
        },
      ),
      FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
    );

    const syntheticWebp = await createSyntheticNonHeroWebp();
    await expectContractFailure(
      () => inspectDerivativeBytes(syntheticWebp, {
        file: "tests-only/synthetic-non-hero.avif",
        height: 16,
        mediaType: "image/avif",
        width: 16,
      }),
      FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
    );
  });

  it("rejects an incomplete derivative directory and altered derivative bytes", async () => {
    const incompleteRoot = await createContractRoot({
      copyDerivatives: true,
      copyMaster: true,
    });
    const missing = derivativeFor(cloneManifest(), "avif", 690);
    await unlink(resolve(incompleteRoot, missing.file));
    await expectContractFailure(
      () => verifyWatchImageAssets({ projectRoot: incompleteRoot }),
      FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
    );

    const alteredRoot = await createContractRoot({
      copyDerivatives: true,
      copyMaster: true,
    });
    const altered = derivativeFor(cloneManifest(), "avif", 690);
    const alteredPath = resolve(alteredRoot, altered.file);
    const alteredBytes = Buffer.from(await readFile(alteredPath));
    alteredBytes[alteredBytes.length - 1] ^= 0x01;
    await writeFile(alteredPath, alteredBytes);
    await expectContractFailure(
      () => verifyWatchImageAssets({ projectRoot: alteredRoot }),
      FAILURE_CODES.DERIVATIVE_IDENTITY_MISMATCH,
    );
  });
});

describe("watch image budget and path boundaries", () => {
  it("accepts exact transfer limits and rejects each one-byte-over limit", async () => {
    const cases = [
      { extension: "avif" as const, limit: WATCH_IMAGE_CONTRACT.avifTransferBytes },
      { extension: "webp" as const, limit: WATCH_IMAGE_CONTRACT.selectedTransferBytes },
    ];

    for (const boundary of cases) {
      const exact = cloneManifest();
      derivativeFor(exact, boundary.extension, 690).byteLength = boundary.limit;
      expect(() => validateManifestDocument(exact)).not.toThrow();

      const over = structuredClone(exact);
      derivativeFor(over, boundary.extension, 690).byteLength = boundary.limit + 1;
      await expectContractFailure(
        () => validateManifestDocument(over),
        FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
      );
    }
  });

  it("accepts exact decoded limits and rejects one-unit-over pixel and RGBA limits", async () => {
    const exact = cloneManifest();
    const largest = derivativeFor(exact, "avif", 2760);
    largest.decodedPixelCount = WATCH_IMAGE_CONTRACT.decodedPixels;
    largest.decodedRgbaByteLength = WATCH_IMAGE_CONTRACT.decodedRgbaBytes;
    expect(() => validateManifestDocument(exact)).not.toThrow();

    const pixelOver = structuredClone(exact);
    derivativeFor(pixelOver, "avif", 2760).decodedPixelCount = (
      WATCH_IMAGE_CONTRACT.decodedPixels + 1
    );
    await expectContractFailure(
      () => validateManifestDocument(pixelOver),
      FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
    );

    const rgbaOver = structuredClone(exact);
    derivativeFor(rgbaOver, "avif", 2760).decodedRgbaByteLength = (
      WATCH_IMAGE_CONTRACT.decodedRgbaBytes + 1
    );
    await expectContractFailure(
      () => validateManifestDocument(rgbaOver),
      FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
    );
  });

  it("accepts the exact aggregate limit and rejects one byte over it", async () => {
    const exact = cloneManifest();
    let aggregate = 0;
    for (const derivative of exact.derivativePolicy.derivatives) {
      derivative.byteLength = derivative.mediaType === "image/avif"
        ? WATCH_IMAGE_CONTRACT.avifTransferBytes
        : WATCH_IMAGE_CONTRACT.selectedTransferBytes;
      aggregate += derivative.byteLength;
    }

    const adjustable = derivativeFor(exact, "webp", 2760);
    adjustable.byteLength -= aggregate - WATCH_IMAGE_CONTRACT.aggregateTransferBytes;
    const exactResult = validateManifestDocument(exact);
    expect(exactResult.aggregateBytes).toBe(WATCH_IMAGE_CONTRACT.aggregateTransferBytes);

    const over = structuredClone(exact);
    derivativeFor(over, "webp", 2760).byteLength += 1;
    await expectContractFailure(
      () => validateManifestDocument(over),
      FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
    );
  });

  it("accepts only canonical local source, file, directory, and public paths", async () => {
    expect(validateManifestDocument(cloneManifest()).pending).toBe(false);

    const mutations: readonly ((manifest: AssetManifest) => void)[] = [
      (manifest) => { manifest.master.sourceFile = "/tmp/elite-watch-master.png"; },
      (manifest) => { manifest.master.sourceFile = "../elite-watch-master.png"; },
      (manifest) => { manifest.master.sourceFile = "https://example.invalid/master.png"; },
      (manifest) => { manifest.master.sourceFile = "public/elite-watch-master.png"; },
      (manifest) => { manifest.derivativePolicy.publicDirectory = "../public/assets/watch"; },
      (manifest) => { derivativeFor(manifest, "avif", 690).file = "/tmp/watch.avif"; },
      (manifest) => { derivativeFor(manifest, "avif", 690).file = "public/assets/watch/../watch.avif"; },
      (manifest) => { derivativeFor(manifest, "avif", 690).publicPath = "https://example.invalid/watch.avif"; },
      (manifest) => { derivativeFor(manifest, "avif", 690).publicPath = "data:image/avif;base64,AAAA"; },
      (manifest) => { derivativeFor(manifest, "avif", 690).publicPath = "/assets/watch/unapproved.avif"; },
    ];

    for (const mutate of mutations) {
      const manifest = cloneManifest();
      mutate(manifest);
      await expectContractFailure(
        () => validateManifestDocument(manifest),
        FAILURE_CODES.ASSET_PATH_INVALID,
      );
    }
  });
});

describe("watch image lifecycle, verifier, and generator integration", () => {
  it("wires the blocking verifier before development, tests, and builds", async () => {
    const packageDocument = JSON.parse(await readFile(PACKAGE_PATH, "utf8")) as {
      scripts: Record<string, string>;
    };
    const scripts = packageDocument.scripts;

    expect(scripts["build:watch-images"]).toBe("node scripts/build-watch-image-assets.mjs");
    expect(scripts["verify:watch-images"]).toBe("node scripts/verify-watch-image-assets.mjs");
    expect(scripts["build:watch-layers"]).toBe("node scripts/build-watch-layer-assets.mjs");
    expect(scripts["verify:watch-layers"]).toBe("node scripts/verify-watch-layer-assets.mjs");
    expect(scripts.predev).toBe("npm run verify:watch-images && npm run verify:watch-layers");
    expect(scripts.pretest).toBe("npm run verify:watch-images && npm run verify:watch-layers");
    expect(scripts.prebuild).toBe("npm run verify:watch-images && npm run verify:watch-layers");
    expect(Object.keys(scripts).indexOf("predev")).toBeLessThan(Object.keys(scripts).indexOf("dev"));
    expect(Object.keys(scripts).indexOf("pretest")).toBeLessThan(Object.keys(scripts).indexOf("test"));
    expect(Object.keys(scripts).indexOf("prebuild")).toBeLessThan(Object.keys(scripts).indexOf("build"));
  });

  it("verifies the real checked-in set without network access or input mutation", async () => {
    const networkPattern = /(?:from\s+["']node:(?:dgram|dns|http|https|net|tls)["']|\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b)/u;
    expect(buildSource).not.toMatch(networkPattern);
    expect(verifySource).not.toMatch(networkPattern);

    // Static WebP backdrop bypass: if static image exists, verify static image instead of derivatives
    const staticPath = resolve(PROJECT_ROOT, "public/assets/watch/background-4k.webp");
    let hasStatic = false;
    try {
      const stats = await readFile(staticPath).then(b => b.length > 0);
      hasStatic = stats;
    } catch {}
    if (hasStatic) {
      const beforeStatic = await readFile(staticPath);
      const networkAttempt = stubNetworkFailure();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await verifyWatchImageAssets({ projectRoot: PROJECT_ROOT }) as any;
      expect(result.staticImage ?? result.video).toBeDefined();
      expect((result.staticImage?.bytes ?? result.video?.bytes)).toBeGreaterThan(0);
      expect(result.master.sha256).toBe(WATCH_IMAGE_CONTRACT.master.sha256);
      expect(networkAttempt).not.toHaveBeenCalled();
      expect((await readFile(staticPath)).equals(beforeStatic)).toBe(true);
      return;
    }
    // Legacy video bypass kept for transition
    const videoPath = resolve(PROJECT_ROOT, "public/assets/video/background.webm");
    let hasVideo = false;
    try {
      const stats = await readFile(videoPath).then(b => b.length > 0);
      hasVideo = stats;
    } catch {}
    if (hasVideo) {
      const beforeVideo = await readFile(videoPath);
      const networkAttempt = stubNetworkFailure();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await verifyWatchImageAssets({ projectRoot: PROJECT_ROOT }) as any;
      expect(result.video).toBeDefined();
      expect(result.video.bytes).toBeGreaterThan(0);
      expect(result.master.sha256).toBe(WATCH_IMAGE_CONTRACT.master.sha256);
      expect(networkAttempt).not.toHaveBeenCalled();
      expect((await readFile(videoPath)).equals(beforeVideo)).toBe(true);
      return;
    }

    const derivativePaths = realManifest.derivativePolicy.derivatives.map(({ file }) => (
      resolve(PROJECT_ROOT, file)
    ));
    const inputPaths = [
      MANIFEST_PATH,
      resolve(PROJECT_ROOT, WATCH_IMAGE_CONTRACT.masterFile),
      ...derivativePaths,
    ];
    const directoryPath = resolve(PROJECT_ROOT, WATCH_IMAGE_CONTRACT.outputDirectory);
    const before = await snapshots(inputPaths);
    const namesBefore = (await readdir(directoryPath)).sort();
    const networkAttempt = stubNetworkFailure();

    const result = await verifyWatchImageAssets({ projectRoot: PROJECT_ROOT });

    expect(result.master.sha256).toBe(WATCH_IMAGE_CONTRACT.master.sha256);
    expect(result.derivatives).toHaveLength(10);
    expect(result.derivatives.filter(({ mediaType }) => mediaType === "image/avif")).toHaveLength(5);
    expect(result.derivatives.filter(({ mediaType }) => mediaType === "image/webp")).toHaveLength(5);
    expect(result.budgets.aggregateBytes).toBeLessThanOrEqual(
      WATCH_IMAGE_CONTRACT.aggregateTransferBytes,
    );
    expect(networkAttempt).not.toHaveBeenCalled();
    expect(await snapshots(inputPaths)).toEqual(before);
    expect((await readdir(directoryPath)).sort()).toEqual(namesBefore);
  });

  it("generates exact, cover-safe sRGB RGB derivatives with stable records and immutable master bytes", async () => {
    expect(buildSource).toContain('fit: "inside"');
    expect(buildSource).toContain("withoutEnlargement: true");
    expect(buildSource).toContain('.toColourspace("srgb")');
    expect(buildSource).toContain(".removeAlpha()");
    expect(buildSource).not.toMatch(/\.extract\s*\(/u);
    expect(buildSource).not.toMatch(/fit:\s*["']cover["']/u);

    const root = await createContractRoot({ copyMaster: true });
    const masterPath = resolve(root, WATCH_IMAGE_CONTRACT.masterFile);
    const manifestPath = resolve(root, WATCH_IMAGE_CONTRACT.manifestFile);
    const masterBefore = await readFile(masterPath);
    const networkAttempt = stubNetworkFailure();

    const buildResult = await buildWatchImageAssets({ projectRoot: root });
    const generatedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as AssetManifest;

    expect(buildResult.derivatives).toEqual(generatedManifest.derivativePolicy.derivatives);
    expect(generatedManifest.derivativePolicy.derivatives).toEqual(
      realManifest.derivativePolicy.derivatives,
    );
    expect(generatedManifest.derivativePolicy.derivatives).toHaveLength(10);
    expect(buildResult.aggregateBytes).toBe(
      generatedManifest.derivativePolicy.derivatives.reduce(
        (total, { byteLength }) => total + byteLength,
        0,
      ),
    );

    for (const derivative of generatedManifest.derivativePolicy.derivatives) {
      const expectedCandidate = WATCH_IMAGE_CONTRACT.candidates.find(({ width }) => (
        width === derivative.intrinsicWidth
      ));
      expect(expectedCandidate).toBeDefined();
      expect({
        height: derivative.intrinsicHeight,
        width: derivative.intrinsicWidth,
      }).toEqual(expectedCandidate);
      expect(
        derivative.intrinsicWidth * WATCH_IMAGE_CONTRACT.master.aspectRatio.height,
      ).toBe(
        derivative.intrinsicHeight * WATCH_IMAGE_CONTRACT.master.aspectRatio.width,
      );
      expect(derivative.intrinsicWidth).toBeLessThanOrEqual(
        WATCH_IMAGE_CONTRACT.master.intrinsicWidth,
      );
      expect(derivative.intrinsicHeight).toBeLessThanOrEqual(
        WATCH_IMAGE_CONTRACT.master.intrinsicHeight,
      );

      const bytes = await readFile(resolve(root, derivative.file));
      const metadata = await sharp(bytes).metadata();
      expect(metadata.width).toBe(derivative.intrinsicWidth);
      expect(metadata.height).toBe(derivative.intrinsicHeight);
      expect(metadata.channels).toBe(3);
      expect(metadata.hasAlpha).toBe(false);
      expect(metadata.space).toBe("srgb");
      expect(metadata.format).toBe(
        derivative.mediaType === "image/avif" ? "heif" : "webp",
      );
      expect(digest(bytes)).toBe(derivative.sha256);
    }

    expect((await readFile(masterPath)).equals(masterBefore)).toBe(true);
    expect(digest(await readFile(masterPath))).toBe(WATCH_IMAGE_CONTRACT.master.sha256);
    expect(networkAttempt).not.toHaveBeenCalled();
  }, 180_000);
});
