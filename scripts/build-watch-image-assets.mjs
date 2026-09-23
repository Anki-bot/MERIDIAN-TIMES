import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  AssetContractError,
  FAILURE_CODES,
  WATCH_IMAGE_CONTRACT,
  inspectDerivativeBytes,
  inspectMasterBytes,
  validateManifestDocument,
  verifyWatchImageAssets,
} from "./verify-watch-image-assets.mjs";

sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_OUTPUTS = WATCH_IMAGE_CONTRACT.formats.flatMap((format) => (
  WATCH_IMAGE_CONTRACT.candidates.map(({ height, width }) => ({
    encoder: format.encoder,
    extension: format.extension,
    file: `${WATCH_IMAGE_CONTRACT.outputDirectory}/elite-watch-${width}.${format.extension}`,
    height,
    mediaType: format.mediaType,
    publicPath: `/assets/watch/elite-watch-${width}.${format.extension}`,
    width,
  }))
));

function fail(code, message) {
  throw new AssetContractError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readRegularFile(path, missingCode, invalidCode, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      fail(missingCode, `${label} is missing`);
    }
    fail(invalidCode, `${label} cannot be inspected`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} must be a regular non-symlink file`);
  }
  try {
    return await readFile(path);
  } catch {
    fail(invalidCode, `${label} cannot be read`);
  }
}

async function ensureSafeOutputDirectory(root) {
  const parts = ["public", "public/assets", WATCH_IMAGE_CONTRACT.outputDirectory];
  for (const part of parts) {
    const path = resolve(root, part);
    try {
      const stats = await lstat(path);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        fail(FAILURE_CODES.ASSET_PATH_INVALID, `${part} must be a regular non-symlink directory`);
      }
    } catch (error) {
      if (error instanceof AssetContractError) throw error;
      if (error && typeof error === "object" && error.code === "ENOENT") {
        await mkdir(path);
      } else {
        fail(FAILURE_CODES.ASSET_PATH_INVALID, `${part} cannot be prepared safely`);
      }
    }
  }
  const outputPath = resolve(root, WATCH_IMAGE_CONTRACT.outputDirectory);
  const allowedNames = new Set(EXPECTED_OUTPUTS.map(({ file }) => file.split("/").at(-1)));
  const entries = await readdir(outputPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !allowedNames.has(entry.name)) {
      fail(
        FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
        `${WATCH_IMAGE_CONTRACT.outputDirectory} contains unapproved entry ${entry.name}`,
      );
    }
  }
  return outputPath;
}

async function assertTargetSafe(path, label) {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} must be a regular non-symlink file`);
    }
  } catch (error) {
    if (error instanceof AssetContractError) throw error;
    if (!(error && typeof error === "object" && error.code === "ENOENT")) {
      fail(FAILURE_CODES.ASSET_PATH_INVALID, `${label} cannot be inspected safely`);
    }
  }
}

async function writeAtomic(path, bytes) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o644 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writeIfChanged(path, bytes, label) {
  await assertTargetSafe(path, label);
  try {
    const current = await readFile(path);
    if (current.equals(bytes)) return false;
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  }
  await writeAtomic(path, bytes);
  return true;
}

async function assertBytesUnchanged(path, before, code, label) {
  let after;
  try {
    after = await readFile(path);
  } catch {
    fail(code, `${label} changed or disappeared during generation`);
  }
  if (after.length !== before.length || sha256(after) !== sha256(before)) {
    fail(code, `${label} bytes changed during generation`);
  }
}

function createPipeline(masterBytes, output) {
  const pipeline = sharp(masterBytes, {
    failOn: "error",
    limitInputPixels: WATCH_IMAGE_CONTRACT.master.decodedPixelCount,
    sequentialRead: true,
  })
    .resize({
      fastShrinkOnLoad: false,
      fit: "inside",
      height: output.height,
      kernel: sharp.kernel.lanczos3,
      width: output.width,
      withoutEnlargement: true,
    })
    .toColourspace("srgb")
    .removeAlpha();

  if (output.extension === "avif") {
    return pipeline.avif({
      chromaSubsampling: output.encoder.chromaSubsampling,
      effort: output.encoder.effort,
      lossless: false,
      quality: output.encoder.quality,
    });
  }
  return pipeline.webp({
    effort: output.encoder.effort,
    lossless: false,
    quality: output.encoder.quality,
    smartSubsample: output.encoder.smartSubsample,
  });
}

function assertGeneratedBudgets(generated) {
  let aggregateBytes = 0;
  for (const { bytes, output } of generated) {
    const formatLimit = output.extension === "avif"
      ? WATCH_IMAGE_CONTRACT.avifTransferBytes
      : WATCH_IMAGE_CONTRACT.selectedTransferBytes;
    if (bytes.length > formatLimit || bytes.length > WATCH_IMAGE_CONTRACT.selectedTransferBytes) {
      fail(
        FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
        `${output.file} is ${bytes.length} bytes; transfer limit is ${formatLimit}`,
      );
    }
    aggregateBytes += bytes.length;
  }
  if (aggregateBytes > WATCH_IMAGE_CONTRACT.aggregateTransferBytes) {
    fail(
      FAILURE_CODES.ASSET_BUDGET_EXCEEDED,
      `generated aggregate is ${aggregateBytes} bytes; limit is ${WATCH_IMAGE_CONTRACT.aggregateTransferBytes}`,
    );
  }
  return aggregateBytes;
}

function readyManifestFrom(manifest, derivatives) {
  return {
    ...manifest,
    contractStatus: "ready",
    derivativePolicy: {
      ...manifest.derivativePolicy,
      derivatives,
      status: "ready",
    },
  };
}

function pendingManifestFrom(manifest) {
  return {
    ...manifest,
    contractStatus: "source-approved-derivatives-pending",
    derivativePolicy: {
      ...manifest.derivativePolicy,
      derivatives: [],
      status: "pending-generation",
    },
  };
}

export async function buildWatchImageAssets({ projectRoot = PROJECT_ROOT } = {}) {
  const root = resolve(projectRoot);
  const manifestPath = resolve(root, WATCH_IMAGE_CONTRACT.manifestFile);
  const manifestBytes = await readRegularFile(
    manifestPath,
    FAILURE_CODES.MANIFEST_MISSING,
    FAILURE_CODES.MANIFEST_INVALID,
    WATCH_IMAGE_CONTRACT.manifestFile,
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    fail(
      FAILURE_CODES.MANIFEST_INVALID,
      `${WATCH_IMAGE_CONTRACT.manifestFile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateManifestDocument(manifest, { allowPending: true, projectRoot: root });

  const masterPath = resolve(root, WATCH_IMAGE_CONTRACT.masterFile);
  const masterBytes = await readRegularFile(
    masterPath,
    FAILURE_CODES.MASTER_MISSING,
    FAILURE_CODES.MASTER_FORMAT_INVALID,
    WATCH_IMAGE_CONTRACT.masterFile,
  );

  // No image pipeline is created until the exact archival bytes pass all source checks.
  await inspectMasterBytes(masterBytes);

  const generated = [];
  for (const output of EXPECTED_OUTPUTS) {
    if (
      output.width > WATCH_IMAGE_CONTRACT.master.intrinsicWidth
      || output.height > WATCH_IMAGE_CONTRACT.master.intrinsicHeight
      || output.width * WATCH_IMAGE_CONTRACT.master.aspectRatio.height
        !== output.height * WATCH_IMAGE_CONTRACT.master.aspectRatio.width
    ) {
      fail(FAILURE_CODES.DERIVATIVE_DIMENSION_MISMATCH, `${output.file} would crop, distort, or upscale the master`);
    }
    let bytes;
    try {
      bytes = await createPipeline(masterBytes, output).toBuffer();
    } catch (error) {
      fail(
        FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
        `${output.file} encode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await inspectDerivativeBytes(bytes, output);
    generated.push({ bytes, output });
  }
  const aggregateBytes = assertGeneratedBudgets(generated);

  // Check immutable inputs again before any public or manifest write.
  await assertBytesUnchanged(
    masterPath,
    masterBytes,
    FAILURE_CODES.MASTER_IDENTITY_MISMATCH,
    WATCH_IMAGE_CONTRACT.masterFile,
  );
  await assertBytesUnchanged(
    manifestPath,
    manifestBytes,
    FAILURE_CODES.MANIFEST_INVALID,
    WATCH_IMAGE_CONTRACT.manifestFile,
  );

  await ensureSafeOutputDirectory(root);
  for (const { bytes, output } of generated) {
    await writeIfChanged(resolve(root, output.file), bytes, output.file);
  }

  // Records are built from finalized on-disk bytes, never from optimistic encoder metadata.
  const derivativeRecords = [];
  for (const output of EXPECTED_OUTPUTS) {
    const path = resolve(root, output.file);
    const finalizedBytes = await readRegularFile(
      path,
      FAILURE_CODES.DERIVATIVE_SET_INCOMPLETE,
      FAILURE_CODES.DERIVATIVE_FORMAT_INVALID,
      output.file,
    );
    const observed = await inspectDerivativeBytes(finalizedBytes, output);
    derivativeRecords.push({
      publicPath: output.publicPath,
      file: output.file,
      mediaType: output.mediaType,
      sha256: observed.sha256,
      byteLength: observed.byteLength,
      intrinsicWidth: observed.intrinsicWidth,
      intrinsicHeight: observed.intrinsicHeight,
      decodedPixelCount: observed.decodedPixelCount,
      decodedRgbaByteLength: observed.decodedRgbaByteLength,
      encoder: { ...output.encoder },
    });
  }

  const readyManifest = readyManifestFrom(manifest, derivativeRecords);
  validateManifestDocument(readyManifest, { projectRoot: root });
  await assertBytesUnchanged(
    masterPath,
    masterBytes,
    FAILURE_CODES.MASTER_IDENTITY_MISMATCH,
    WATCH_IMAGE_CONTRACT.masterFile,
  );
  await assertBytesUnchanged(
    manifestPath,
    manifestBytes,
    FAILURE_CODES.MANIFEST_INVALID,
    WATCH_IMAGE_CONTRACT.manifestFile,
  );

  const serializedReadyManifest = Buffer.from(`${JSON.stringify(readyManifest, null, 2)}\n`);
  await writeAtomic(manifestPath, serializedReadyManifest);

  try {
    await verifyWatchImageAssets({ projectRoot: root });
  } catch (error) {
    // A failed post-write gate must never leave the contract claiming readiness.
    const currentManifest = await readFile(manifestPath);
    if (currentManifest.equals(serializedReadyManifest)) {
      const pending = Buffer.from(`${JSON.stringify(pendingManifestFrom(manifest), null, 2)}\n`);
      await writeAtomic(manifestPath, pending);
    }
    throw error;
  }

  await assertBytesUnchanged(
    masterPath,
    masterBytes,
    FAILURE_CODES.MASTER_IDENTITY_MISMATCH,
    WATCH_IMAGE_CONTRACT.masterFile,
  );
  return { aggregateBytes, derivatives: derivativeRecords };
}

function formatFailure(error) {
  if (error instanceof AssetContractError) return `${error.code}: ${error.message}`;
  return `${FAILURE_CODES.MANIFEST_INVALID}: ${error instanceof Error ? error.message : String(error)}`;
}

async function main() {
  try {
    const result = await buildWatchImageAssets();
    console.log("WATCH_IMAGE_ASSET_BUILD_OK");
    for (const derivative of result.derivatives) {
      console.log(
        `${derivative.file} ${derivative.mediaType} ${derivative.intrinsicWidth}x${derivative.intrinsicHeight} ${derivative.byteLength} bytes ${derivative.sha256}`,
      );
    }
    console.log(
      `aggregate=${result.aggregateBytes}/${WATCH_IMAGE_CONTRACT.aggregateTransferBytes} bytes`,
    );
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
