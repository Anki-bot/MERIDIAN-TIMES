import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;
type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};
type BuildResult = {
  readonly approvedMovingLayerIds: readonly string[];
  readonly depthEnabled: false;
  readonly inputSnapshotIdentity: FileIdentity;
  readonly metadataIdentity: FileIdentity;
  readonly mode: string;
  readonly packageIdentity: FileIdentity;
  readonly packagePath: string;
  readonly publicAssets: readonly unknown[];
  readonly releaseStatus: "fallback-only";
  readonly runtimeManifest: null;
  readonly stagingDirectory: string;
};
type BuilderModule = {
  readonly NORMALIZED_WATCH_LAYER_INPUTS_PATH: string;
  readonly STAGED_WATCH_LAYER_PACKAGE_PATH: string;
  readonly WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH: string;
  readonly WATCH_LAYER_BUILD_METADATA_PATH: string;
  buildWatchLayerAssets(options?: {
    readonly beforeStageCommit?: (context: {
      readonly projectRoot: string;
      readonly workingDirectory: string;
    }) => Promise<void> | void;
    readonly projectRoot?: string;
    readonly stagingDirectory?: string;
  }): Promise<BuildResult>;
};
type ContractModule = {
  readonly CANONICAL_PROJECT_PATHS: Readonly<Record<string, string>>;
  readonly LAYER_ASSET_MANIFEST_SCHEMA: {
    parseJson(value: Uint8Array, options?: JsonRecord): JsonRecord;
  };
  parseCanonicalJson(value: Uint8Array, options?: JsonRecord): JsonRecord;
  serializeCanonicalJsonLine(value: unknown): Buffer;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const builder = (await import("../../scripts/build-watch-layer-assets.mjs")) as unknown as BuilderModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;

const PROJECT_ROOT = process.cwd();
const temporaryRoots = new Set<string>();

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error !== null
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) return false;
    throw error;
  }
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

async function copyProjectMember(projectRoot: string, projectPath: string): Promise<void> {
  const source = resolve(PROJECT_ROOT, projectPath);
  const target = resolve(projectRoot, projectPath);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

async function createIsolatedProjectFixture(options: {
  readonly emptySuccessorPublicDirectory?: boolean;
  readonly priorPackageBytes?: Buffer;
} = {}): Promise<string> {
  const fixtureParent = await createTemporaryRoot("watch-layer-builder-fixture-");
  const projectRoot = resolve(fixtureParent, "project");
  await mkdir(projectRoot);
  const requiredMembers = [
    contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
    contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
    contract.CANONICAL_PROJECT_PATHS.predecessorPublicAssetsDirectory,
    contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
    contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
    contract.CANONICAL_PROJECT_PATHS.successorRelease,
    builder.NORMALIZED_WATCH_LAYER_INPUTS_PATH,
    "source/assets/watch-2-5d/v1/review/layer-evidence/index.json",
  ];
  for (const member of requiredMembers) await copyProjectMember(projectRoot, member);
  if (options.priorPackageBytes !== undefined) {
    const packagePath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    );
    await mkdir(dirname(packagePath), { recursive: true });
    await writeFile(packagePath, options.priorPackageBytes);
  }
  if (options.emptySuccessorPublicDirectory) {
    await mkdir(resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    ), { recursive: true });
  }
  return projectRoot;
}

async function stagedBytes(
  result: BuildResult,
  projectPath: string,
): Promise<Buffer> {
  return readFile(resolve(result.stagingDirectory, projectPath));
}

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("watch-layer canonical package staging", () => {
  it("reproduces identical canonical package/metadata bytes and keeps fallback outputs untouched", async () => {
    const stageParent = await createTemporaryRoot("watch-layer-builder-stage-");
    const releasePath = resolve(
      PROJECT_ROOT,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    );
    const currentPackagePath = resolve(
      PROJECT_ROOT,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    );
    const currentPublicPath = resolve(
      PROJECT_ROOT,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    );
    const releaseBefore = await readFile(releasePath);
    expect(await pathExists(currentPackagePath)).toBe(false);
    expect(await pathExists(currentPublicPath)).toBe(false);

    const first = await builder.buildWatchLayerAssets({
      projectRoot: PROJECT_ROOT,
      stagingDirectory: resolve(stageParent, "first"),
    });
    const second = await builder.buildWatchLayerAssets({
      projectRoot: PROJECT_ROOT,
      stagingDirectory: resolve(stageParent, "second"),
    });

    for (const path of [
      builder.STAGED_WATCH_LAYER_PACKAGE_PATH,
      builder.WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH,
      builder.WATCH_LAYER_BUILD_METADATA_PATH,
    ]) {
      expect(await stagedBytes(second, path), path).toEqual(await stagedBytes(first, path));
    }
    expect(await listFiles(first.stagingDirectory)).toEqual([
      builder.STAGED_WATCH_LAYER_PACKAGE_PATH,
      builder.WATCH_LAYER_BUILD_METADATA_PATH,
      builder.WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH,
    ].sort());
    expect((await listFiles(first.stagingDirectory)).some((path) => (
      path.startsWith("public/")
    ))).toBe(false);

    const packageBytes = await stagedBytes(first, builder.STAGED_WATCH_LAYER_PACKAGE_PATH);
    const manifest = contract.LAYER_ASSET_MANIFEST_SCHEMA.parseJson(packageBytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
    expect(packageBytes).toEqual(contract.serializeCanonicalJsonLine(manifest));
    expect(manifest).toMatchObject({
      approvals: [],
      depthProfiles: [],
      layers: [],
      masks: [],
      motionProfiles: [],
      packageId: "watch-layer-package",
      packageVersion: "1.0.0",
      publicAssets: [],
      reconstructions: [],
      relationships: [],
      runtimeManifest: null,
      schemaVersion: 1,
      sourceDateEpoch: 1_700_000_000,
    });
    expect(manifest.phases).toEqual([
      expect.objectContaining({ name: "source-preparation", ordinal: 0, status: "approved" }),
      expect.objectContaining({ name: "static-layered-reconstruction", ordinal: 1, status: "disabled" }),
      expect.objectContaining({ name: "approved-part-motion", ordinal: 2, status: "disabled" }),
      expect.objectContaining({ name: "optional-depth", ordinal: 3, status: "disabled" }),
    ]);

    const metadataBytes = await stagedBytes(first, builder.WATCH_LAYER_BUILD_METADATA_PATH);
    const metadata = contract.parseCanonicalJson(metadataBytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });
    expect(metadataBytes).toEqual(contract.serializeCanonicalJsonLine(metadata));
    expect(metadata).toMatchObject({
      approvedMovingLayerIds: [],
      buildKind: "isolated-package-stage",
      depthEnabled: false,
      mode: "reference-pose",
      package: {
        byteLength: packageBytes.byteLength,
        path: builder.STAGED_WATCH_LAYER_PACKAGE_PATH,
        sha256: sha256(packageBytes),
      },
      publicAssets: [],
      releaseStatus: "fallback-only",
      runtimeManifest: null,
      schemaVersion: 1,
      sourceDateEpoch: 1_700_000_000,
    });
    expect(first).toMatchObject({
      approvedMovingLayerIds: [],
      depthEnabled: false,
      mode: "reference-pose",
      publicAssets: [],
      releaseStatus: "fallback-only",
      runtimeManifest: null,
    });
    expect(second.packageIdentity).toEqual(first.packageIdentity);
    expect(second.metadataIdentity).toEqual(first.metadataIdentity);
    expect(second.inputSnapshotIdentity).toEqual(first.inputSnapshotIdentity);

    expect(await readFile(releasePath)).toEqual(releaseBefore);
    expect(await pathExists(currentPackagePath)).toBe(false);
    expect(await pathExists(currentPublicPath)).toBe(false);
  }, 120_000);

  it("aborts an input mutation, removes failed staging, and preserves prior outputs byte-for-byte", async () => {
    const priorPackageBytes = Buffer.from("prior-package-bytes\n");
    const projectRoot = await createIsolatedProjectFixture({
      emptySuccessorPublicDirectory: true,
      priorPackageBytes,
    });
    const stageParent = await createTemporaryRoot("watch-layer-builder-failed-stage-");
    const stageDirectory = resolve(stageParent, "candidate");
    const normalizedPath = resolve(projectRoot, builder.NORMALIZED_WATCH_LAYER_INPUTS_PATH);
    const releasePath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    );
    const packagePath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    );
    const publicPath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    );
    const releaseBefore = await readFile(releasePath);

    await expect(builder.buildWatchLayerAssets({
      beforeStageCommit: async () => {
        const bytes = await readFile(normalizedPath);
        await writeFile(normalizedPath, Buffer.concat([bytes, Buffer.from(" ")]));
      },
      projectRoot,
      stagingDirectory: stageDirectory,
    })).rejects.toMatchObject({
      code: "LAYER_INPUT_CHANGED",
      failure: {
        code: "LAYER_INPUT_CHANGED",
        path: builder.NORMALIZED_WATCH_LAYER_INPUTS_PATH,
      },
    });

    expect(await pathExists(stageDirectory)).toBe(false);
    expect(await readdir(stageParent)).toEqual([]);
    expect(await readFile(packagePath)).toEqual(priorPackageBytes);
    expect(await readFile(releasePath)).toEqual(releaseBefore);
    expect(await readdir(publicPath)).toEqual([]);
  }, 120_000);

  it("reports predecessor failure before malformed successor inputs and creates no stage", async () => {
    const projectRoot = await createIsolatedProjectFixture();
    const stageParent = await createTemporaryRoot("watch-layer-builder-predecessor-stage-");
    const stageDirectory = resolve(stageParent, "candidate");
    const predecessorPath = resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
    );
    const normalizedPath = resolve(projectRoot, builder.NORMALIZED_WATCH_LAYER_INPUTS_PATH);
    const predecessor = JSON.parse(await readFile(predecessorPath, "utf8")) as JsonRecord;
    predecessor.contractStatus = "invalid-before-successor-inspection";
    await writeFile(predecessorPath, Buffer.from(`${JSON.stringify(predecessor)}\n`));
    await writeFile(normalizedPath, Buffer.from("{malformed"));

    await expect(builder.buildWatchLayerAssets({
      projectRoot,
      stagingDirectory: stageDirectory,
    })).rejects.toMatchObject({
      code: "LAYER_PREDECESSOR_INVALID",
      issueCode: "LAYER_BUILD_PREDECESSOR_INVALID",
      path: contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
    });
    expect(await pathExists(stageDirectory)).toBe(false);
    expect(await readdir(stageParent)).toEqual([]);
  }, 120_000);
});
