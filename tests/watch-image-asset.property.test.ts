import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { expect, it } from "vitest";

const PROPERTY_TAG =
  "Feature: animated-watch-image-glass-header, Property 1: Source-and-derivative gate soundness and nonmutation";

// Reproduce with: seed=20250314, numRuns=128.
// Every run contains one input from each generated class below.
const PROPERTY_SEED = 20_250_314;
const PROPERTY_RUNS = 128;
const PROJECT_ROOT = process.cwd();
const MANIFEST_PATH = resolve(PROJECT_ROOT, "data/watch-image-asset.json");
const VERIFIER_MODULE_URL = `file://${resolve(
  PROJECT_ROOT,
  "scripts/verify-watch-image-assets.mjs",
)}`;

interface AssetContractFailure extends Error {
  readonly code: string;
}

interface MutableDerivative {
  byteLength: number;
  decodedPixelCount: number;
  decodedRgbaByteLength: number;
  encoder: Record<string, boolean | number | string>;
  file: string;
  intrinsicHeight: number;
  intrinsicWidth: number;
  mediaType: string;
  publicPath: string;
  sha256: string;
}

interface MutableManifest {
  contractStatus: string;
  derivativePolicy: {
    budgets: Record<string, number>;
    derivatives: MutableDerivative[];
    publicDirectory: string;
    status: string;
    [key: string]: unknown;
  };
  master: {
    byteLength: number;
    sha256: string;
    sourceFile: string;
    [key: string]: unknown;
  };
  presentation: Record<string, unknown>;
  schemaVersion: number;
}

interface SyntheticDerivativeExpectation {
  readonly file: string;
  readonly height: number;
  readonly mediaType: "image/avif" | "image/webp";
  readonly width: number;
}

interface VerifierModule {
  readonly AssetContractError: new (code: string, message: string) => AssetContractFailure;
  readonly FAILURE_CODES: Readonly<Record<string, string>>;
  readonly WATCH_IMAGE_CONTRACT: {
    readonly aggregateTransferBytes: number;
    readonly avifTransferBytes: number;
    readonly decodedPixels: number;
    readonly decodedRgbaBytes: number;
    readonly manifestFile: string;
    readonly masterFile: string;
    readonly selectedTransferBytes: number;
  };
  inspectDerivativeBytes(
    bytes: Buffer,
    expected: SyntheticDerivativeExpectation,
  ): Promise<unknown>;
  inspectMasterBytes(bytes: Buffer): Promise<unknown>;
  validateManifestDocument(
    manifest: unknown,
    options?: { readonly allowPending?: boolean; readonly projectRoot?: string },
  ): { readonly aggregateBytes: number; readonly pending: boolean };
  verifyWatchImageAssets(options?: { readonly projectRoot?: string }): Promise<{
    readonly derivatives: readonly unknown[];
    readonly master: { readonly byteLength: number; readonly sha256: string };
  }>;
}

type SignatureKind = "avif" | "master-png" | "webp";
type MembershipMutation = "append-duplicate" | "remove-entry" | "replace-entry";
type FieldMutation =
  | "derivative-media-type"
  | "derivative-width"
  | "encoder-quality"
  | "master-byte-length"
  | "master-sha-nibble"
  | "schema-version";
type BudgetBoundary =
  | "aggregate-transfer"
  | "avif-transfer"
  | "decoded-pixels"
  | "decoded-rgba"
  | "selected-transfer";

type PathMutation =
  | { readonly target: "derivative-file"; readonly value: string }
  | { readonly target: "derivative-public-path"; readonly value: string }
  | { readonly target: "master-source"; readonly value: string }
  | { readonly target: "public-directory"; readonly value: string };

const signatureArbitrary = fc.oneof(
  fc.record({
    kind: fc.constant("master-png" as const),
    offset: fc.integer({ min: 0, max: 7 }),
    xor: fc.integer({ min: 1, max: 255 }),
  }),
  fc.record({
    kind: fc.constant("avif" as const),
    offset: fc.integer({ min: 4, max: 7 }),
    xor: fc.integer({ min: 1, max: 255 }),
  }),
  fc.record({
    kind: fc.constant("webp" as const),
    offset: fc.integer({ min: 0, max: 3 }),
    xor: fc.integer({ min: 1, max: 255 }),
  }),
);

const unsafePathArbitrary: fc.Arbitrary<PathMutation> = fc.oneof(
  fc.record({
    target: fc.constant("master-source" as const),
    value: fc.constantFrom(
      "../synthetic-non-hero.png",
      "/tmp/synthetic-non-hero.png",
      "https://invalid.example/synthetic-non-hero.png",
      "data:image/png;base64,invalid",
      "public/assets/watch/synthetic-non-hero.png",
    ),
  }),
  fc.record({
    target: fc.constant("public-directory" as const),
    value: fc.constantFrom(
      "../public/assets/watch",
      "/tmp/watch",
      "https://invalid.example/watch",
      "public/assets/../watch",
    ),
  }),
  fc.record({
    target: fc.constant("derivative-file" as const),
    value: fc.constantFrom(
      "../synthetic-non-hero.avif",
      "/tmp/synthetic-non-hero.avif",
      "https://invalid.example/synthetic-non-hero.avif",
      "public/assets/watch/../synthetic-non-hero.avif",
    ),
  }),
  fc.record({
    target: fc.constant("derivative-public-path" as const),
    value: fc.constantFrom(
      "https://invalid.example/synthetic-non-hero.avif",
      "data:image/avif;base64,invalid",
      "/assets/watch/../synthetic-non-hero.avif",
      "/assets/watch/synthetic-non-hero.avif?changed=1",
    ),
  }),
);

const propertyInputArbitrary = fc.record({
  budget: fc.record({
    avifIndex: fc.integer({ min: 0, max: 4 }),
    kind: fc.constantFrom<BudgetBoundary>(
      "aggregate-transfer",
      "avif-transfer",
      "decoded-pixels",
      "decoded-rgba",
      "selected-transfer",
    ),
    largestIndex: fc.constantFrom(4, 9),
    webpIndex: fc.integer({ min: 5, max: 9 }),
  }),
  cloneThroughJson: fc.boolean(),
  field: fc.record({
    index: fc.integer({ min: 0, max: 9 }),
    kind: fc.constantFrom<FieldMutation>(
      "derivative-media-type",
      "derivative-width",
      "encoder-quality",
      "master-byte-length",
      "master-sha-nibble",
      "schema-version",
    ),
  }),
  membership: fc.record({
    index: fc.integer({ min: 0, max: 9 }),
    kind: fc.constantFrom<MembershipMutation>(
      "append-duplicate",
      "remove-entry",
      "replace-entry",
    ),
  }),
  signature: signatureArbitrary,
  unsafePath: unsafePathArbitrary,
});

function cloneManifest(manifest: MutableManifest, throughJson = false): MutableManifest {
  return throughJson
    ? JSON.parse(JSON.stringify(manifest)) as MutableManifest
    : structuredClone(manifest);
}

function mutateFirstHexNibble(value: string): string {
  return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function expectContractFailure(
  verifier: VerifierModule,
  action: () => unknown | Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(verifier.AssetContractError);
  expect((caught as AssetContractFailure).code).toBe(expectedCode);
}

async function expectManifestFailureWithoutMutation(
  verifier: VerifierModule,
  manifest: MutableManifest,
  expectedCode: string,
): Promise<void> {
  const before = JSON.stringify(manifest);
  await expectContractFailure(
    verifier,
    () => verifier.validateManifestDocument(manifest, { projectRoot: PROJECT_ROOT }),
    expectedCode,
  );
  expect(JSON.stringify(manifest)).toBe(before);
}

function applyPathMutation(manifest: MutableManifest, mutation: PathMutation): void {
  switch (mutation.target) {
    case "master-source":
      manifest.master.sourceFile = mutation.value;
      break;
    case "public-directory":
      manifest.derivativePolicy.publicDirectory = mutation.value;
      break;
    case "derivative-file":
      manifest.derivativePolicy.derivatives[0].file = mutation.value;
      break;
    case "derivative-public-path":
      manifest.derivativePolicy.derivatives[0].publicPath = mutation.value;
      break;
  }
}

function applyMembershipMutation(
  manifest: MutableManifest,
  mutation: { readonly index: number; readonly kind: MembershipMutation },
): string {
  const derivatives = manifest.derivativePolicy.derivatives;
  if (mutation.kind === "remove-entry") {
    derivatives.splice(mutation.index, 1);
    return "DERIVATIVE_SET_INCOMPLETE";
  }
  if (mutation.kind === "append-duplicate") {
    derivatives.push(structuredClone(derivatives[mutation.index]));
    return "DERIVATIVE_SET_INCOMPLETE";
  }

  derivatives[mutation.index] = structuredClone(
    derivatives[(mutation.index + 1) % derivatives.length],
  );
  return "ASSET_PATH_INVALID";
}

function applyFieldMutation(
  manifest: MutableManifest,
  mutation: { readonly index: number; readonly kind: FieldMutation },
): string {
  const derivative = manifest.derivativePolicy.derivatives[mutation.index];
  switch (mutation.kind) {
    case "schema-version":
      manifest.schemaVersion += 1;
      return "MANIFEST_INVALID";
    case "master-sha-nibble":
      manifest.master.sha256 = mutateFirstHexNibble(manifest.master.sha256);
      return "MANIFEST_INVALID";
    case "master-byte-length":
      manifest.master.byteLength += 1;
      return "MANIFEST_INVALID";
    case "derivative-media-type":
      derivative.mediaType = "image/png";
      return "DERIVATIVE_FORMAT_INVALID";
    case "derivative-width":
      derivative.intrinsicWidth += 1;
      return "DERIVATIVE_DIMENSION_MISMATCH";
    case "encoder-quality":
      derivative.encoder.quality = Number(derivative.encoder.quality) + 1;
      return "MANIFEST_INVALID";
  }
}

function budgetBoundaryPair(
  manifest: MutableManifest,
  contract: VerifierModule["WATCH_IMAGE_CONTRACT"],
  input: {
    readonly avifIndex: number;
    readonly kind: BudgetBoundary;
    readonly largestIndex: number;
    readonly webpIndex: number;
  },
): { readonly exact: MutableManifest; readonly over: MutableManifest } {
  const exact = cloneManifest(manifest);
  const derivatives = exact.derivativePolicy.derivatives;

  switch (input.kind) {
    case "avif-transfer":
      derivatives[input.avifIndex].byteLength = contract.avifTransferBytes;
      break;
    case "selected-transfer":
      derivatives[input.webpIndex].byteLength = contract.selectedTransferBytes;
      break;
    case "aggregate-transfer": {
      for (let index = 0; index < 5; index += 1) {
        derivatives[index].byteLength = contract.avifTransferBytes;
      }
      for (let index = 5; index < 9; index += 1) {
        derivatives[index].byteLength = contract.selectedTransferBytes;
      }
      derivatives[9].byteLength = contract.aggregateTransferBytes
        - 5 * contract.avifTransferBytes
        - 4 * contract.selectedTransferBytes;
      break;
    }
    case "decoded-pixels":
      derivatives[input.largestIndex].decodedPixelCount = contract.decodedPixels;
      break;
    case "decoded-rgba":
      derivatives[input.largestIndex].decodedRgbaByteLength = contract.decodedRgbaBytes;
      break;
  }

  const over = cloneManifest(exact);
  const overDerivatives = over.derivativePolicy.derivatives;
  switch (input.kind) {
    case "avif-transfer":
      overDerivatives[input.avifIndex].byteLength += 1;
      break;
    case "selected-transfer":
      overDerivatives[input.webpIndex].byteLength += 1;
      break;
    case "aggregate-transfer":
      overDerivatives[9].byteLength += 1;
      break;
    case "decoded-pixels":
      overDerivatives[input.largestIndex].decodedPixelCount += 1;
      break;
    case "decoded-rgba":
      overDerivatives[input.largestIndex].decodedRgbaByteLength += 1;
      break;
  }

  return { exact, over };
}

function syntheticSignatureBytes(kind: SignatureKind): Buffer {
  if (kind === "master-png") {
    return Buffer.from("89504e470d0a1a0a", "hex");
  }
  if (kind === "webp") {
    const bytes = Buffer.alloc(20);
    bytes.write("RIFF", 0, "ascii");
    bytes.writeUInt32LE(12, 4);
    bytes.write("WEBP", 8, "ascii");
    bytes.write("VP8 ", 12, "ascii");
    return bytes;
  }

  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("avif", 8, "ascii");
  bytes.writeUInt32BE(0, 12);
  bytes.write("mif1", 16, "ascii");
  bytes.write("miaf", 20, "ascii");
  return bytes;
}

async function assertInvalidSyntheticSignature(
  verifier: VerifierModule,
  input: { readonly kind: SignatureKind; readonly offset: number; readonly xor: number },
): Promise<void> {
  const bytes = syntheticSignatureBytes(input.kind);
  bytes[input.offset] ^= input.xor;
  const before = Buffer.from(bytes);

  if (input.kind === "master-png") {
    await expectContractFailure(
      verifier,
      () => verifier.inspectMasterBytes(bytes),
      verifier.FAILURE_CODES.MASTER_FORMAT_INVALID,
    );
  } else {
    const expected: SyntheticDerivativeExpectation = {
      file: `synthetic-non-hero.${input.kind}`,
      height: 376,
      mediaType: input.kind === "avif" ? "image/avif" : "image/webp",
      width: 690,
    };
    await expectContractFailure(
      verifier,
      () => verifier.inspectDerivativeBytes(bytes, expected),
      verifier.FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
    );
  }

  expect(bytes).toEqual(before);
}

async function snapshotAssetInputs(manifest: MutableManifest): Promise<Record<string, string>> {
  const files = [
    "data/watch-image-asset.json",
    manifest.master.sourceFile,
    ...manifest.derivativePolicy.derivatives.map(({ file }) => file),
  ];
  const entries = await Promise.all(files.map(async (file) => {
    const bytes = await readFile(resolve(PROJECT_ROOT, file));
    return [file, `${bytes.length}:${digest(bytes)}`] as const;
  }));
  return Object.fromEntries(entries);
}

function assertNoNetworkCapability(source: string): void {
  expect(source).not.toMatch(
    /from\s+["']node:(?:child_process|dgram|dns|http|http2|https|net|tls)["']/u,
  );
  expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
}

// **Validates: Requirements 1.8–1.15**
it(PROPERTY_TAG, { timeout: 120_000 }, async () => {
  const verifier = await import(
    /* @vite-ignore */ VERIFIER_MODULE_URL
  ) as unknown as VerifierModule;
  const manifestBytes = await readFile(MANIFEST_PATH);
  const canonicalManifest = JSON.parse(manifestBytes.toString("utf8")) as MutableManifest;
  const packageDocument = JSON.parse(
    await readFile(resolve(PROJECT_ROOT, "package.json"), "utf8"),
  ) as { readonly scripts: Readonly<Record<string, string>> };

  // The real checked-in set proves the success branch, accepts the >6 MiB archival
  // master, performs no writes, and contains finalized identities (static image, video or 10 derivatives).
  const beforeRealInputs = await snapshotAssetInputs(canonicalManifest);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verified: any = await verifier.verifyWatchImageAssets({ projectRoot: PROJECT_ROOT });
  if (verified.staticImage ?? verified.video) {
    expect((verified.staticImage?.bytes ?? verified.video?.bytes)).toBeGreaterThan(0);
    expect(verified.master.byteLength).toBeGreaterThan(6 * 1024 * 1024);
  } else {
    expect(verified.derivatives).toHaveLength(10);
    expect(verified.master.byteLength).toBeGreaterThan(6 * 1024 * 1024);
  }
  expect(await snapshotAssetInputs(canonicalManifest)).toEqual(beforeRealInputs);

  // npm's lifecycle ordering guarantees each pre-script finishes before its paired
  // command. The gate is therefore the exact first lifecycle step for all three.
  expect(packageDocument.scripts["verify:watch-images"]).toBe(
    "node scripts/verify-watch-image-assets.mjs",
  );
  expect(packageDocument.scripts["verify:watch-layers"]).toBe(
    "node scripts/verify-watch-layer-assets.mjs",
  );
  expect(packageDocument.scripts["build:watch-layers"]).toBe(
    "node scripts/build-watch-layer-assets.mjs",
  );
  for (const lifecycle of ["dev", "test", "build"] as const) {
    expect(packageDocument.scripts[`pre${lifecycle}`]).toBe(
      "npm run verify:watch-images && npm run verify:watch-layers",
    );
  }

  // The generator and verifier have no network-capable imports or browser network APIs.
  assertNoNetworkCapability(
    await readFile(resolve(PROJECT_ROOT, "scripts/build-watch-image-assets.mjs"), "utf8"),
  );
  assertNoNetworkCapability(
    await readFile(resolve(PROJECT_ROOT, "scripts/verify-watch-image-assets.mjs"), "utf8"),
  );

  // A generated missing-input fixture is an empty synthetic directory, never an image
  // or runtime fallback. The failing gate must leave even this directory untouched.
  const missingRoot = await mkdtemp(join(tmpdir(), "watch-gate-synthetic-non-hero-"));
  try {
    const beforeEntries = await readdir(missingRoot);
    await expectContractFailure(
      verifier,
      () => verifier.verifyWatchImageAssets({ projectRoot: missingRoot }),
      verifier.FAILURE_CODES.MANIFEST_MISSING,
    );
    expect(await readdir(missingRoot)).toEqual(beforeEntries);
  } finally {
    await rm(missingRoot, { force: true, recursive: true });
  }

  await fc.assert(
    fc.asyncProperty(propertyInputArbitrary, async (input) => {
      // Consistent contracts always validate and validation never mutates the object.
      const consistent = cloneManifest(canonicalManifest, input.cloneThroughJson);
      const consistentBefore = JSON.stringify(consistent);
      const consistentResult = verifier.validateManifestDocument(consistent, {
        projectRoot: PROJECT_ROOT,
      });
      expect(consistentResult.pending).toBe(false);
      expect(consistentResult.aggregateBytes).toBe(
        consistent.derivativePolicy.derivatives.reduce(
          (total, derivative) => total + derivative.byteLength,
          0,
        ),
      );
      expect(JSON.stringify(consistent)).toBe(consistentBefore);

      // One changed signature byte in an in-memory, synthetic/non-hero container
      // prefix is rejected without changing the supplied bytes.
      await assertInvalidSyntheticSignature(verifier, input.signature);

      const unsafePath = cloneManifest(canonicalManifest);
      applyPathMutation(unsafePath, input.unsafePath);
      await expectManifestFailureWithoutMutation(
        verifier,
        unsafePath,
        verifier.FAILURE_CODES.ASSET_PATH_INVALID,
      );

      const changedMembership = cloneManifest(canonicalManifest);
      const membershipCode = applyMembershipMutation(changedMembership, input.membership);
      await expectManifestFailureWithoutMutation(
        verifier,
        changedMembership,
        verifier.FAILURE_CODES[membershipCode],
      );

      const changedField = cloneManifest(canonicalManifest);
      const fieldCode = applyFieldMutation(changedField, input.field);
      await expectManifestFailureWithoutMutation(
        verifier,
        changedField,
        verifier.FAILURE_CODES[fieldCode],
      );

      // Every declared limit accepts its exact boundary and rejects boundary + 1.
      const boundary = budgetBoundaryPair(
        canonicalManifest,
        verifier.WATCH_IMAGE_CONTRACT,
        input.budget,
      );
      const exactBefore = JSON.stringify(boundary.exact);
      verifier.validateManifestDocument(boundary.exact, { projectRoot: PROJECT_ROOT });
      expect(JSON.stringify(boundary.exact)).toBe(exactBefore);
      await expectManifestFailureWithoutMutation(
        verifier,
        boundary.over,
        verifier.FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
      );
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
