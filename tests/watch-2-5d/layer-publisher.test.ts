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
type ReleaseHistoryEntry = {
  readonly approvalStatus: "approved" | "pending" | "rejected";
  readonly depthEnabled: boolean;
  readonly packageId: string;
  readonly packageSha256: string;
  readonly packageVersion: string;
  readonly phase: string | null;
  readonly releaseId: string | null;
  readonly releaseStatus: "fallback-only" | "ready";
  readonly runtimeManifestSha256: string | null;
};
type PublisherModule = {
  readonly WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH: string;
  readonly WATCH_LAYER_PUBLICATION_LOCK_PATH: string;
  readonly WATCH_LAYER_PUBLICATION_STEPS: readonly string[];
  readonly WATCH_LAYER_RELEASE_HISTORY_PATH: string;
  readonly WATCH_LAYER_STALE_LOCK_STEPS: readonly string[];
  compareSupportedWatchLayerPackageVersions(left: string, right: string): number;
  parseWatchLayerReleaseHistory(value: unknown, options?: JsonRecord): {
    readonly releases: readonly ReleaseHistoryEntry[];
    readonly schemaVersion: 1;
  };
  publishWatchLayerAssets(options: {
    readonly projectRoot: string;
    readonly stagingDirectory: string;
    readonly testHooks?: {
      readonly onStep?: (step: string, context?: JsonRecord) => Promise<void> | void;
      readonly verifyCandidate?: () => Promise<{ readonly ok: true }> | { readonly ok: true };
      readonly verifyCurrent?: () => Promise<{ readonly ok: true }> | { readonly ok: true };
      readonly verifyPublished?: () => Promise<{ readonly ok: true }> | { readonly ok: true };
    };
  }): Promise<{
    readonly packageSha256: string;
    readonly packageVersion: string;
    readonly publicDirectoryPublished: boolean;
    readonly release: JsonRecord;
    readonly releaseStatus: "fallback-only" | "ready";
    readonly selectedPhase: string | null;
  }>;
  selectLatestContiguousApprovedWatchLayerPhase(value: unknown): JsonRecord | null;
  selectNewestApprovedWatchLayerRelease(value: unknown): ReleaseHistoryEntry;
};
type BuilderModule = {
  readonly WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH: string;
  readonly WATCH_LAYER_BUILD_METADATA_PATH: string;
  buildWatchLayerAssets(options: {
    readonly projectRoot: string;
    readonly stagingDirectory: string;
  }): Promise<{
    readonly packageIdentity: {
      readonly byteLength: number;
      readonly path: string;
      readonly sha256: string;
    };
    readonly stagingDirectory: string;
  }>;
};
type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: JsonRecord;
  readonly CANONICAL_PROJECT_PATHS: Readonly<Record<string, string>>;
  readonly CANONICAL_SOURCE_COORDINATE_SPACE: JsonRecord;
  readonly ENHANCEMENT_BUDGETS: JsonRecord;
  readonly LAYER_ASSET_MANIFEST_SCHEMA: {
    parseJson(value: Uint8Array, options?: JsonRecord): JsonRecord;
    serializeLine(value: unknown): Buffer;
  };
  readonly PREDECESSOR_MANIFEST_IDENTITY: JsonRecord;
  readonly RELEASE_POINTER_SCHEMA: {
    parseJson(value: Uint8Array, options?: JsonRecord): JsonRecord;
    serializeLine(value: unknown): Buffer;
  };
  readonly RUNTIME_MANIFEST_SCHEMA: {
    serializeLine(value: unknown): Buffer;
  };
  serializeCanonicalJsonLine(value: unknown): Buffer;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const publisher = (await import("../../scripts/publish-watch-layer-assets.mjs")) as unknown as PublisherModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const builder = (await import("../../scripts/build-watch-layer-assets.mjs")) as unknown as BuilderModule;
// @ts-expect-error -- executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;

const PROJECT_ROOT = process.cwd();
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const PACKAGE_ID = "watch-layer-package";
const temporaryRoots = new Set<string>();

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryRoot(prefix: string): Promise<string> {
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

async function writeProjectFile(
  root: string,
  projectPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const target = resolve(root, projectPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function copyProjectMember(root: string, projectPath: string): Promise<void> {
  const source = resolve(PROJECT_ROOT, projectPath);
  const destination = resolve(root, projectPath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

function historyEntry(
  overrides: Partial<ReleaseHistoryEntry> = {},
): ReleaseHistoryEntry {
  return {
    approvalStatus: "approved",
    depthEnabled: false,
    packageId: PACKAGE_ID,
    packageSha256: HASH_A,
    packageVersion: "1.0.0",
    phase: null,
    releaseId: null,
    releaseStatus: "fallback-only",
    runtimeManifestSha256: null,
    ...overrides,
  };
}

function releaseHistory(entries: readonly ReleaseHistoryEntry[]): JsonRecord {
  return { releases: entries, schemaVersion: 1 };
}

async function writeReleaseHistory(
  projectRoot: string,
  entries: readonly ReleaseHistoryEntry[],
): Promise<void> {
  await writeProjectFile(
    projectRoot,
    publisher.WATCH_LAYER_RELEASE_HISTORY_PATH,
    contract.serializeCanonicalJsonLine(releaseHistory(entries)),
  );
}

function phaseRecord(
  name: string,
  ordinal: number,
  status: "approved" | "disabled",
  phasePayloadSha256: string,
  options: {
    readonly approvalId?: string;
    readonly runtimeManifestSha256?: string | null;
  } = {},
): JsonRecord {
  return {
    ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId }),
    assetSha256: [],
    name,
    ordinal,
    phasePayloadSha256,
    runtimeManifestSha256: options.runtimeManifestSha256 ?? null,
    status,
  };
}

function commonPackageFields(packageVersion: string): JsonRecord {
  return {
    budgets: contract.ENHANCEMENT_BUDGETS,
    canonicalMaster: contract.APPROVED_MASTER_IDENTITY,
    depthProfiles: [],
    layers: [],
    masks: [],
    motionProfiles: [],
    packageId: PACKAGE_ID,
    packageVersion,
    parentSpec: ".kiro/specs/animated-watch-image-glass-header",
    predecessorContract: contract.PREDECESSOR_MANIFEST_IDENTITY,
    provenance: [],
    publicAssets: [],
    reconstructions: [],
    relationships: [],
    schemaVersion: 1,
    sourceCoordinateSpace: contract.CANONICAL_SOURCE_COORDINATE_SPACE,
    sourceDateEpoch: 1_700_000_000,
  };
}

function buildReadyArtifacts(packageVersion: string, releaseId: string): {
  readonly packageBytes: Buffer;
  readonly packageManifest: JsonRecord;
  readonly release: JsonRecord;
  readonly releaseBytes: Buffer;
  readonly runtimeBytes: Buffer;
  readonly runtimeIdentity: JsonRecord;
  readonly runtimeManifest: JsonRecord;
} {
  const runtimeManifest = {
    canonicalMasterSha256: String(contract.APPROVED_MASTER_IDENTITY.sha256),
    depthProfiles: [],
    motionProfiles: [],
    packageId: PACKAGE_ID,
    phase: "static-layered-reconstruction",
    profiles: {
      compact: {
        assets: [],
        decodedRgbaBytes: 0,
        id: "compact",
        requestCountIncludingManifest: 1,
        sourceScale: 0.5,
        transferBytes: 0,
      },
      expanded: {
        assets: [],
        decodedRgbaBytes: 0,
        id: "expanded",
        requestCountIncludingManifest: 1,
        sourceScale: 1,
        transferBytes: 0,
      },
    },
    releaseId,
    schemaVersion: 1,
  };
  const runtimeBytes = contract.RUNTIME_MANIFEST_SCHEMA.serializeLine(runtimeManifest);
  const runtimeIdentity = {
    byteLength: runtimeBytes.byteLength,
    file: "public/assets/watch-2-5d/v1/runtime-manifest.json",
    mediaType: "application/json",
    publicPath: "/assets/watch-2-5d/v1/runtime-manifest.json",
    sha256: sha256(runtimeBytes),
  };
  const releaseApproval = {
    artifactSha256: [HASH_B, runtimeIdentity.sha256],
    decision: "approved",
    id: "release-approval",
    layerIds: [],
    notes: "Synthetic fixture approval for atomic publication tests.",
    reviewedAt: "2026-05-20T12:00:00.000Z",
    reviewedPoseIds: ["reference-pose"],
    reviewedZoomPercent: [100, 200],
    reviewer: "fixture-reviewer",
    scope: "release",
  };
  const packageManifest = {
    ...commonPackageFields(packageVersion),
    approvals: [releaseApproval],
    phases: [
      phaseRecord("source-preparation", 0, "approved", HASH_A),
      phaseRecord("static-layered-reconstruction", 1, "approved", HASH_B, {
        approvalId: "release-approval",
        runtimeManifestSha256: runtimeIdentity.sha256,
      }),
      phaseRecord("approved-part-motion", 2, "disabled", HASH_C),
      phaseRecord("optional-depth", 3, "disabled", "d".repeat(64)),
    ],
    runtimeManifest: runtimeIdentity,
  };
  const packageBytes = contract.LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(packageManifest);
  const release = {
    depthEnabled: false,
    packageId: PACKAGE_ID,
    releaseId,
    runtimeManifest: {
      byteLength: runtimeIdentity.byteLength,
      mediaType: "application/json",
      publicPath: runtimeIdentity.publicPath,
      sha256: runtimeIdentity.sha256,
    },
    schemaVersion: 1,
    status: "ready",
  };
  return {
    packageBytes,
    packageManifest,
    release,
    releaseBytes: contract.RELEASE_POINTER_SCHEMA.serializeLine(release),
    runtimeBytes,
    runtimeIdentity,
    runtimeManifest,
  };
}

async function writeSyntheticStage(
  stage: string,
  artifacts: ReturnType<typeof buildReadyArtifacts>,
): Promise<{ readonly packageSha256: string }> {
  const packageBytes = artifacts.packageBytes;
  const packageManifest = artifacts.packageManifest;
  const snapshot = { files: [], snapshotSha256: HASH_A };
  const snapshotBytes = contract.serializeCanonicalJsonLine(snapshot);
  const runtimeIdentity = artifacts.runtimeIdentity;
  const releaseStatus = "ready";
  const identity = (path: string, bytes: Uint8Array): JsonRecord => ({
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  });
  const packageIdentity = identity(
    contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    packageBytes,
  );
  const snapshotIdentity = identity(builder.WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH, snapshotBytes);
  const metadata = {
    approvedMovingLayerIds: [],
    authoring: { byteLength: 1, path: "source/assets/watch-2-5d/v1/authoring.json", sha256: HASH_A },
    buildKind: "isolated-package-stage",
    depthEnabled: false,
    evidenceIndex: { byteLength: 1, path: "source/assets/watch-2-5d/v1/review/layer-evidence/index.json", sha256: HASH_B },
    generator: "scripts/build-watch-layer-assets.mjs",
    immutableInputSnapshot: { file: snapshotIdentity, snapshotSha256: HASH_A },
    mode: "reference-pose",
    normalizedInputs: { byteLength: 1, path: "source/assets/watch-2-5d/v1/review/normalized-package-inputs.json", sha256: HASH_C },
    package: packageIdentity,
    phaseProjections: (packageManifest.phases as JsonRecord[]).map((phase) => ({
      name: phase.name,
      ordinal: phase.ordinal,
      phasePayloadSha256: phase.phasePayloadSha256,
      status: phase.status,
    })),
    predecessor: {
      derivativeCount: 10,
      manifestSha256: contract.PREDECESSOR_MANIFEST_IDENTITY.sha256,
      masterSha256: contract.APPROVED_MASTER_IDENTITY.sha256,
    },
    publicAssets: [],
    releaseStatus,
    runtimeManifest: runtimeIdentity,
    schemaVersion: 1,
    sourceDateEpoch: 1_700_000_000,
  };
  await writeProjectFile(
    stage,
    contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    packageBytes,
  );
  await writeProjectFile(
    stage,
    builder.WATCH_LAYER_BUILD_INPUT_SNAPSHOT_PATH,
    snapshotBytes,
  );
  await writeProjectFile(
    stage,
    builder.WATCH_LAYER_BUILD_METADATA_PATH,
    contract.serializeCanonicalJsonLine(metadata),
  );
  await writeProjectFile(
    stage,
    "public/assets/watch-2-5d/v1/runtime-manifest.json",
    artifacts.runtimeBytes,
  );
  return { packageSha256: sha256(packageBytes) };
}

async function createMinimalPublicationProject(
  current: ReturnType<typeof buildReadyArtifacts>,
  candidate: ReturnType<typeof buildReadyArtifacts>,
): Promise<{ readonly projectRoot: string; readonly stage: string }> {
  const root = await temporaryRoot("watch-layer-publisher-fixture-");
  const projectRoot = resolve(root, "project");
  const stage = resolve(root, "stage");
  await mkdir(projectRoot);
  await mkdir(stage);
  await writeProjectFile(
    projectRoot,
    contract.CANONICAL_PROJECT_PATHS.successorRelease,
    current.releaseBytes,
  );
  await writeProjectFile(
    projectRoot,
    contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    current.packageBytes,
  );
  await writeProjectFile(
    projectRoot,
    "public/assets/watch-2-5d/v1/runtime-manifest.json",
    current.runtimeBytes,
  );
  const staged = await writeSyntheticStage(stage, candidate);
  await writeReleaseHistory(projectRoot, [historyEntry({
    packageSha256: staged.packageSha256,
    packageVersion: String(candidate.packageManifest.packageVersion),
    phase: "static-layered-reconstruction",
    releaseId: String(candidate.runtimeManifest.releaseId),
    releaseStatus: "ready",
    runtimeManifestSha256: String(candidate.runtimeIdentity.sha256),
  })]);
  return { projectRoot, stage };
}

async function listTransactionArtifacts(projectRoot: string): Promise<readonly string[]> {
  const locations = [resolve(projectRoot, "data"), resolve(projectRoot, "public/assets/watch-2-5d")];
  const names: string[] = [];
  for (const location of locations) {
    if (!await pathExists(location)) continue;
    for (const name of await readdir(location)) {
      if (name.includes("publish")) names.push(`${location}:${name}`);
    }
  }
  return names.sort();
}

async function createFullFallbackProject(): Promise<{
  readonly projectRoot: string;
  readonly stage: string;
}> {
  const root = await temporaryRoot("watch-layer-publisher-full-");
  const projectRoot = resolve(root, "project");
  const stage = resolve(root, "stage");
  await mkdir(projectRoot);
  for (const member of [
    contract.CANONICAL_PROJECT_PATHS.historicalSpecDirectory,
    contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    contract.CANONICAL_PROJECT_PATHS.globalsCss,
    contract.CANONICAL_PROJECT_PATHS.protectedCanvas,
    contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
    contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
    contract.CANONICAL_PROJECT_PATHS.predecessorPublicAssetsDirectory,
    contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
    contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory,
    contract.CANONICAL_PROJECT_PATHS.successorRelease,
    "tests/fixtures/glass-header-hover-preservation.sha256",
  ]) await copyProjectMember(projectRoot, member);
  const built = await builder.buildWatchLayerAssets({ projectRoot, stagingDirectory: stage });
  await writeReleaseHistory(projectRoot, [historyEntry({
    packageSha256: built.packageIdentity.sha256,
    packageVersion: "1.0.0",
  })]);
  return { projectRoot, stage };
}

type PublicationState = {
  readonly packageManifest: unknown;
  readonly publicAssets: unknown;
  readonly release: unknown;
};

async function captureFilesystemValue(path: string): Promise<unknown> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (
      error !== null
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) return { kind: "absent" };
    throw error;
  }
  if (stats.isFile()) {
    return { bytes: (await readFile(path)).toString("hex"), kind: "file" };
  }
  if (stats.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return {
      entries: await Promise.all(entries.map(async (entry) => [
        entry.name,
        await captureFilesystemValue(resolve(path, entry.name)),
      ])),
      kind: "directory",
    };
  }
  return { kind: stats.isSymbolicLink() ? "symlink" : "other" };
}

async function capturePublicationState(projectRoot: string): Promise<PublicationState> {
  return {
    packageManifest: await captureFilesystemValue(resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    )),
    publicAssets: await captureFilesystemValue(resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    )),
    release: await captureFilesystemValue(resolve(
      projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    )),
  };
}

async function writePublicationLockOwner(
  projectRoot: string,
  token: string,
  pid: number,
  options: { readonly replaceDirectory?: boolean } = {},
): Promise<void> {
  const lockPath = resolve(projectRoot, publisher.WATCH_LAYER_PUBLICATION_LOCK_PATH);
  if (options.replaceDirectory) {
    await rm(lockPath, { force: true, recursive: true });
  }
  await mkdir(lockPath, { recursive: true });
  await writeProjectFile(
    projectRoot,
    publisher.WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH,
    contract.serializeCanonicalJsonLine({ pid, schemaVersion: 1, token }),
  );
}

function definitelyDeadPid(): number {
  for (const pid of [2_147_483_647, 1_000_000_000, 10_000_000]) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (
        error !== null
        && typeof error === "object"
        && "code" in error
        && error.code === "ESRCH"
      ) return pid;
    }
  }
  throw new Error("Unable to identify a definitively dead process id for the stale-lock test");
}

function withPhaseAssetHashes(
  artifacts: ReturnType<typeof buildReadyArtifacts>,
  phaseName: string,
  assetSha256: readonly string[],
): ReturnType<typeof buildReadyArtifacts> {
  const packageManifest = structuredClone(artifacts.packageManifest);
  const phases = packageManifest.phases as JsonRecord[];
  const phase = phases.find(({ name }) => name === phaseName);
  if (phase === undefined) throw new Error(`Unknown synthetic phase ${phaseName}`);
  phase.assetSha256 = [...assetSha256];
  const packageBytes = contract.LAYER_ASSET_MANIFEST_SCHEMA.serializeLine(packageManifest);
  return { ...artifacts, packageBytes, packageManifest };
}

const successfulVerificationHooks = {
  verifyCandidate: () => ({ ok: true as const }),
  verifyCurrent: () => ({ ok: true as const }),
  verifyPublished: () => ({ ok: true as const }),
};

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("atomic watch-layer publication", () => {
  it("orders strict supported semantic versions and rejects malformed or unsupported values", () => {
    const history = releaseHistory([
      historyEntry({ packageSha256: HASH_A, packageVersion: "1.10.0" }),
      historyEntry({ packageSha256: HASH_B, packageVersion: "1.9.0" }),
      historyEntry({ approvalStatus: "pending", packageSha256: HASH_C, packageVersion: "9.0.0" }),
    ]);

    expect(publisher.compareSupportedWatchLayerPackageVersions("1.10.0", "1.9.0"))
      .toBeGreaterThan(0);
    expect(publisher.compareSupportedWatchLayerPackageVersions("2.0.0", "10.0.0"))
      .toBeLessThan(0);
    expect(publisher.compareSupportedWatchLayerPackageVersions(
      "999999999999999999999.0.0",
      "10.0.0",
    )).toBeGreaterThan(0);
    expect(publisher.selectNewestApprovedWatchLayerRelease(history).packageVersion)
      .toBe("1.10.0");

    for (const malformed of [
      "",
      "1",
      "1.0",
      "1.0.0.0",
      "01.0.0",
      "1.01.0",
      "1.0.01",
      "1.0.0-alpha",
      "1.0.0+build",
      "v1.0.0",
      "1.0.-1",
      "1.0.0 ",
      `${"1".repeat(129)}.0.0`,
    ]) {
      expect(
        () => publisher.compareSupportedWatchLayerPackageVersions(malformed, "1.0.0"),
        malformed,
      ).toThrowError(expect.objectContaining({
        issueCode: "LAYER_PUBLISH_MONOTONIC_VERSION_INVALID",
      }));
      expect(
        () => publisher.parseWatchLayerReleaseHistory(releaseHistory([
          historyEntry({ packageVersion: malformed }),
        ])),
        malformed,
      ).toThrowError(expect.objectContaining({
        issueCode: "LAYER_PUBLISH_MONOTONIC_VERSION_INVALID",
      }));
    }

    expect(() => publisher.parseWatchLayerReleaseHistory(releaseHistory([
      historyEntry({
        phase: "static-layered-reconstruction",
        releaseId: "forbidden-fallback-release",
      }),
    ]))).toThrowError(expect.objectContaining({
      issueCode: "LAYER_PUBLISH_HISTORY_INVALID",
    }));
  });

  it("selects only the latest phase in one contiguous approved prefix", () => {
    const manifest = (statuses: readonly string[]): JsonRecord => ({
      phases: [
        "source-preparation",
        "static-layered-reconstruction",
        "approved-part-motion",
        "optional-depth",
      ].map((name, ordinal) => ({ name, ordinal, status: statuses[ordinal] })),
    });

    expect(publisher.selectLatestContiguousApprovedWatchLayerPhase(
      manifest(["disabled", "disabled", "disabled", "disabled"]),
    )).toBeNull();
    expect(publisher.selectLatestContiguousApprovedWatchLayerPhase(
      manifest(["approved", "disabled", "disabled", "disabled"]),
    )).toBeNull();
    expect(publisher.selectLatestContiguousApprovedWatchLayerPhase(
      manifest(["approved", "approved", "disabled", "disabled"]),
    )).toMatchObject({ name: "static-layered-reconstruction" });
    expect(publisher.selectLatestContiguousApprovedWatchLayerPhase(
      manifest(["approved", "approved", "approved", "disabled"]),
    )).toMatchObject({ name: "approved-part-motion" });
    expect(publisher.selectLatestContiguousApprovedWatchLayerPhase(
      manifest(["approved", "approved", "approved", "approved"]),
    )).toMatchObject({ name: "optional-depth" });
    expect(() => publisher.selectLatestContiguousApprovedWatchLayerPhase(
      manifest(["approved", "disabled", "approved", "disabled"]),
    )).toThrowError(expect.objectContaining({
      issueCode: "LAYER_PUBLISH_HISTORY_INVALID",
    }));
  });

  it("publishes the real fallback-only stage through the read-only verifier with no successor URL or public tree", async () => {
    const fixture = await createFullFallbackProject();
    const result = await publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
    });
    const releaseBytes = await readFile(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    ));
    const release = contract.RELEASE_POINTER_SCHEMA.parseJson(releaseBytes, {
      allowTrailingNewline: true,
      requireCanonical: true,
    });

    expect(result).toMatchObject({
      packageVersion: "1.0.0",
      publicDirectoryPublished: false,
      releaseStatus: "fallback-only",
      selectedPhase: null,
    });
    expect(release).toEqual({
      depthEnabled: false,
      runtimeManifest: null,
      schemaVersion: 1,
      status: "fallback-only",
    });
    expect(Object.hasOwn(release, "releaseId")).toBe(false);
    expect(Object.hasOwn(release, "packageId")).toBe(false);
    expect(await pathExists(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    ))).toBe(true);
    expect(await pathExists(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
    ))).toBe(false);
    expect(await pathExists(fixture.stage)).toBe(false);
    expect(await listTransactionArtifacts(fixture.projectRoot)).toEqual([]);
  }, 120_000);

  it("renames one complete ready directory into place, verifies installed bytes, and commits its release pointer last", async () => {
    const current = buildReadyArtifacts("0.9.0", "release-old");
    const candidate = buildReadyArtifacts("1.0.0", "release-new");
    const fixture = await createMinimalPublicationProject(current, candidate);
    const steps: string[] = [];

    const result = await publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        ...successfulVerificationHooks,
        onStep: (step) => { steps.push(step); },
      },
    });

    expect(result).toMatchObject({
      packageVersion: "1.0.0",
      publicDirectoryPublished: true,
      releaseStatus: "ready",
      selectedPhase: "static-layered-reconstruction",
    });
    expect(await readFile(resolve(
      fixture.projectRoot,
      "public/assets/watch-2-5d/v1/runtime-manifest.json",
    ))).toEqual(candidate.runtimeBytes);
    expect(await readFile(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    ))).toEqual(candidate.packageBytes);
    expect(await readFile(resolve(
      fixture.projectRoot,
      contract.CANONICAL_PROJECT_PATHS.successorRelease,
    ))).toEqual(candidate.releaseBytes);
    expect(steps.indexOf("installed-public-release"))
      .toBeLessThan(steps.indexOf("verified-published-release"));
    expect(steps.indexOf("installed-package-manifest"))
      .toBeLessThan(steps.indexOf("verified-published-release"));
    expect(steps.indexOf("verified-published-release"))
      .toBeLessThan(steps.indexOf("committed-release-pointer"));
    expect(await pathExists(fixture.stage)).toBe(false);
    expect(await pathExists(resolve(
      fixture.projectRoot,
      publisher.WATCH_LAYER_PUBLICATION_LOCK_PATH,
    ))).toBe(false);
    expect(await listTransactionArtifacts(fixture.projectRoot)).toEqual([]);
  }, 30_000);

  it("allows only one concurrent publisher and keeps the active owner token unchanged", async () => {
    const current = buildReadyArtifacts("0.9.0", "release-old-concurrent");
    const candidate = buildReadyArtifacts("1.0.0", "release-new-concurrent");
    const fixture = await createMinimalPublicationProject(current, candidate);
    const secondStage = resolve(dirname(fixture.stage), "stage-second");
    await mkdir(secondStage);
    await writeSyntheticStage(secondStage, candidate);

    let continueFirst!: () => void;
    const firstMayContinue = new Promise<void>((resolveContinue) => {
      continueFirst = resolveContinue;
    });
    let reportAcquired!: (context: JsonRecord) => void;
    const firstAcquired = new Promise<JsonRecord>((resolveAcquired) => {
      reportAcquired = resolveAcquired;
    });
    const firstPublication = publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        ...successfulVerificationHooks,
        onStep: async (step, context = {}) => {
          if (step === "acquired-publication-lock") {
            reportAcquired(context);
            await firstMayContinue;
          }
        },
      },
    });

    const acquiredContext = await firstAcquired;
    expect(String(acquiredContext.token)).toMatch(/^[a-f\d]{64}$/u);
    const ownerPath = resolve(
      fixture.projectRoot,
      publisher.WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH,
    );
    const ownerBefore = await readFile(ownerPath);
    try {
      await expect(publisher.publishWatchLayerAssets({
        projectRoot: fixture.projectRoot,
        stagingDirectory: secondStage,
        testHooks: successfulVerificationHooks,
      })).rejects.toMatchObject({
        issueCode: "LAYER_PUBLISH_LOCKED",
      });
      expect(await readFile(ownerPath)).toEqual(ownerBefore);
      expect(await pathExists(secondStage)).toBe(false);
    } finally {
      continueFirst();
    }

    await expect(firstPublication).resolves.toMatchObject({
      packageVersion: "1.0.0",
      releaseStatus: "ready",
    });
    expect(await pathExists(resolve(
      fixture.projectRoot,
      publisher.WATCH_LAYER_PUBLICATION_LOCK_PATH,
    ))).toBe(false);
  }, 30_000);

  it("fails closed on ownerless or malformed locks instead of replacing them", async () => {
    for (const ownerKind of ["missing", "malformed"] as const) {
      const current = buildReadyArtifacts("0.9.0", `release-old-${ownerKind}`);
      const candidate = buildReadyArtifacts("1.0.0", `release-new-${ownerKind}`);
      const fixture = await createMinimalPublicationProject(current, candidate);
      const stateBefore = await capturePublicationState(fixture.projectRoot);
      const lockPath = resolve(
        fixture.projectRoot,
        publisher.WATCH_LAYER_PUBLICATION_LOCK_PATH,
      );
      await mkdir(lockPath, { recursive: true });
      if (ownerKind === "malformed") {
        await writeProjectFile(
          fixture.projectRoot,
          publisher.WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH,
          Buffer.from("not-canonical-owner\n", "utf8"),
        );
      }

      await expect(publisher.publishWatchLayerAssets({
        projectRoot: fixture.projectRoot,
        stagingDirectory: fixture.stage,
        testHooks: successfulVerificationHooks,
      })).rejects.toMatchObject({
        issueCode: "LAYER_PUBLISH_RECOVERY_FAILED",
      });
      expect(await capturePublicationState(fixture.projectRoot)).toEqual(stateBefore);
      expect(await pathExists(lockPath)).toBe(true);
      expect(await pathExists(fixture.stage)).toBe(false);
      if (ownerKind === "missing") {
        expect(await readdir(lockPath)).toEqual([]);
      } else {
        expect(await readFile(resolve(lockPath, "owner.json")))
          .toEqual(Buffer.from("not-canonical-owner\n", "utf8"));
      }
    }
  }, 30_000);

  it("takes over only an unchanged valid lock whose owner is definitively dead", async () => {
    const current = buildReadyArtifacts("0.9.0", "release-old-stale");
    const candidate = buildReadyArtifacts("1.0.0", "release-new-stale");
    const fixture = await createMinimalPublicationProject(current, candidate);
    const staleToken = "1".repeat(64);
    await writePublicationLockOwner(
      fixture.projectRoot,
      staleToken,
      definitelyDeadPid(),
      { replaceDirectory: true },
    );
    const observedTokens: string[] = [];

    const result = await publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        ...successfulVerificationHooks,
        onStep: (step, context = {}) => {
          if (step === "validated-stale-lock") {
            observedTokens.push(String(context.staleToken), String(context.takeoverToken));
          }
        },
      },
    });

    expect(observedTokens[0]).toBe(staleToken);
    expect(observedTokens[1]).toMatch(/^[a-f\d]{64}$/u);
    expect(observedTokens[1]).not.toBe(staleToken);
    expect(result).toMatchObject({ releaseStatus: "ready" });
    expect(await pathExists(resolve(
      fixture.projectRoot,
      publisher.WATCH_LAYER_PUBLICATION_LOCK_PATH,
    ))).toBe(false);
    expect(await listTransactionArtifacts(fixture.projectRoot)).toEqual([]);
  }, 30_000);

  it("leaves a replacement lock untouched when ownership changes during stale takeover", async () => {
    const current = buildReadyArtifacts("0.9.0", "release-old-takeover-race");
    const candidate = buildReadyArtifacts("1.0.0", "release-new-takeover-race");
    const fixture = await createMinimalPublicationProject(current, candidate);
    const staleToken = "2".repeat(64);
    const replacementToken = "3".repeat(64);
    await writePublicationLockOwner(
      fixture.projectRoot,
      staleToken,
      definitelyDeadPid(),
      { replaceDirectory: true },
    );
    const stateBefore = await capturePublicationState(fixture.projectRoot);

    await expect(publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        ...successfulVerificationHooks,
        onStep: async (step) => {
          if (step === "validated-stale-lock") {
            await writePublicationLockOwner(
              fixture.projectRoot,
              replacementToken,
              process.pid,
              { replaceDirectory: true },
            );
          }
        },
      },
    })).rejects.toMatchObject({
      issueCode: "LAYER_PUBLISH_LOCK_OWNERSHIP_LOST",
    });

    expect(await capturePublicationState(fixture.projectRoot)).toEqual(stateBefore);
    expect(await readFile(resolve(
      fixture.projectRoot,
      publisher.WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH,
    ))).toEqual(contract.serializeCanonicalJsonLine({
      pid: process.pid,
      schemaVersion: 1,
      token: replacementToken,
    }));
    expect(await pathExists(fixture.stage)).toBe(false);
  }, 30_000);

  it("rolls back and never removes a wrong-token replacement observed before release", async () => {
    const current = buildReadyArtifacts("0.9.0", "release-old-wrong-token");
    const candidate = buildReadyArtifacts("1.0.0", "release-new-wrong-token");
    const fixture = await createMinimalPublicationProject(current, candidate);
    const stateBefore = await capturePublicationState(fixture.projectRoot);
    const replacementToken = "4".repeat(64);

    await expect(publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        ...successfulVerificationHooks,
        onStep: async (step) => {
          if (step === "cleaning-publication-transaction") {
            await writePublicationLockOwner(
              fixture.projectRoot,
              replacementToken,
              process.pid,
            );
          }
        },
      },
    })).rejects.toMatchObject({
      issueCode: "LAYER_PUBLISH_LOCK_OWNERSHIP_LOST",
    });

    expect(await capturePublicationState(fixture.projectRoot)).toEqual(stateBefore);
    expect(await readFile(resolve(
      fixture.projectRoot,
      publisher.WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH,
    ))).toEqual(contract.serializeCanonicalJsonLine({
      pid: process.pid,
      schemaVersion: 1,
      token: replacementToken,
    }));
    expect(await pathExists(fixture.stage)).toBe(false);
  }, 30_000);

  it("restores the complete prior generation after every injected publication step interruption", async () => {
    expect(publisher.WATCH_LAYER_PUBLICATION_STEPS).toEqual([
      "prepared-lock-owner",
      "acquired-publication-lock",
      "recovered-stale-state",
      "verified-current-release",
      "verified-staged-release",
      "synced-staged-release",
      "prepared-transaction",
      "backed-up-public-release",
      "installed-public-release",
      "installed-package-manifest",
      "verified-published-release",
      "committed-release-pointer",
      "cleaned-staging-directory",
      "releasing-publication-lock",
      "cleaning-publication-transaction",
    ]);

    for (const failureStep of publisher.WATCH_LAYER_PUBLICATION_STEPS) {
      const current = buildReadyArtifacts("0.9.0", `release-old-${failureStep}`);
      const candidate = buildReadyArtifacts("1.0.0", `release-new-${failureStep}`);
      const fixture = await createMinimalPublicationProject(current, candidate);
      const stateBefore = await capturePublicationState(fixture.projectRoot);

      await expect(publisher.publishWatchLayerAssets({
        projectRoot: fixture.projectRoot,
        stagingDirectory: fixture.stage,
        testHooks: {
          ...successfulVerificationHooks,
          onStep: (step) => {
            if (step === failureStep) throw new Error(`interrupt:${failureStep}`);
          },
        },
      }), failureStep).rejects.toMatchObject({
        issueCode: "LAYER_PUBLISH_INTERRUPTED",
      });

      expect(
        await capturePublicationState(fixture.projectRoot),
        failureStep,
      ).toEqual(stateBefore);
      expect(await pathExists(fixture.stage), failureStep).toBe(false);
      expect(await pathExists(resolve(
        fixture.projectRoot,
        publisher.WATCH_LAYER_PUBLICATION_LOCK_PATH,
      )), failureStep).toBe(false);
      expect(await listTransactionArtifacts(fixture.projectRoot), failureStep).toEqual([]);
    }
  }, 120_000);

  it("preserves a stale lock and the prior generation when takeover validation is interrupted", async () => {
    const current = buildReadyArtifacts("0.9.0", "release-old-stale-interrupt");
    const candidate = buildReadyArtifacts("1.0.0", "release-new-stale-interrupt");
    const fixture = await createMinimalPublicationProject(current, candidate);
    const staleToken = "5".repeat(64);
    const stalePid = definitelyDeadPid();
    await writePublicationLockOwner(
      fixture.projectRoot,
      staleToken,
      stalePid,
      { replaceDirectory: true },
    );
    const stateBefore = await capturePublicationState(fixture.projectRoot);

    await expect(publisher.publishWatchLayerAssets({
      projectRoot: fixture.projectRoot,
      stagingDirectory: fixture.stage,
      testHooks: {
        ...successfulVerificationHooks,
        onStep: (step) => {
          if (step === "validated-stale-lock") throw new Error("interrupt:stale-lock");
        },
      },
    })).rejects.toMatchObject({
      issueCode: "LAYER_PUBLISH_INTERRUPTED",
    });

    expect(await capturePublicationState(fixture.projectRoot)).toEqual(stateBefore);
    expect(await readFile(resolve(
      fixture.projectRoot,
      publisher.WATCH_LAYER_PUBLICATION_LOCK_OWNER_PATH,
    ))).toEqual(contract.serializeCanonicalJsonLine({
      pid: stalePid,
      schemaVersion: 1,
      token: staleToken,
    }));
    expect(await pathExists(fixture.stage)).toBe(false);
  }, 30_000);

  it("uses semantic monotonicity against the current package and preserves same-version bytes", async () => {
    const newerFixture = await createMinimalPublicationProject(
      buildReadyArtifacts("1.9.0", "release-current-1-9"),
      buildReadyArtifacts("1.10.0", "release-candidate-1-10"),
    );
    await expect(publisher.publishWatchLayerAssets({
      projectRoot: newerFixture.projectRoot,
      stagingDirectory: newerFixture.stage,
      testHooks: successfulVerificationHooks,
    })).resolves.toMatchObject({ packageVersion: "1.10.0" });

    for (const scenario of [
      {
        candidate: buildReadyArtifacts("1.9.0", "release-candidate-older"),
        current: buildReadyArtifacts("1.10.0", "release-current-newer"),
      },
      {
        candidate: buildReadyArtifacts("1.10.0", "release-candidate-different-bytes"),
        current: buildReadyArtifacts("1.10.0", "release-current-same-version"),
      },
    ]) {
      const fixture = await createMinimalPublicationProject(
        scenario.current,
        scenario.candidate,
      );
      const stateBefore = await capturePublicationState(fixture.projectRoot);
      await expect(publisher.publishWatchLayerAssets({
        projectRoot: fixture.projectRoot,
        stagingDirectory: fixture.stage,
        testHooks: successfulVerificationHooks,
      })).rejects.toMatchObject({
        issueCode: "LAYER_PUBLISH_MONOTONIC_VERSION_INVALID",
      });
      expect(await capturePublicationState(fixture.projectRoot)).toEqual(stateBefore);
    }
  }, 30_000);

  it("keeps earlier approved phase asset identities byte-for-byte when later phases are disabled", async () => {
    const stableAssetHash = "6".repeat(64);
    const current = withPhaseAssetHashes(
      buildReadyArtifacts("1.0.0", "release-current-stable-assets"),
      "static-layered-reconstruction",
      [stableAssetHash],
    );
    const preservedCandidate = withPhaseAssetHashes(
      buildReadyArtifacts("1.1.0", "release-candidate-stable-assets"),
      "static-layered-reconstruction",
      [stableAssetHash],
    );
    const preservedFixture = await createMinimalPublicationProject(
      current,
      preservedCandidate,
    );
    await expect(publisher.publishWatchLayerAssets({
      projectRoot: preservedFixture.projectRoot,
      stagingDirectory: preservedFixture.stage,
      testHooks: successfulVerificationHooks,
    })).resolves.toMatchObject({
      selectedPhase: "static-layered-reconstruction",
    });
    const publishedManifest = contract.LAYER_ASSET_MANIFEST_SCHEMA.parseJson(
      await readFile(resolve(
        preservedFixture.projectRoot,
        contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
      )),
      { allowTrailingNewline: true, requireCanonical: true },
    );
    expect((publishedManifest.phases as JsonRecord[])[1].assetSha256)
      .toEqual([stableAssetHash]);
    expect((publishedManifest.phases as JsonRecord[]).slice(2).map(({ status }) => status))
      .toEqual(["disabled", "disabled"]);

    const changedCandidate = withPhaseAssetHashes(
      buildReadyArtifacts("1.1.0", "release-candidate-changed-assets"),
      "static-layered-reconstruction",
      ["7".repeat(64)],
    );
    const changedFixture = await createMinimalPublicationProject(current, changedCandidate);
    const stateBefore = await capturePublicationState(changedFixture.projectRoot);
    await expect(publisher.publishWatchLayerAssets({
      projectRoot: changedFixture.projectRoot,
      stagingDirectory: changedFixture.stage,
      testHooks: successfulVerificationHooks,
    })).rejects.toMatchObject({
      issueCode: "LAYER_PUBLISH_OUTPUT_CHANGED",
    });
    expect(await capturePublicationState(changedFixture.projectRoot)).toEqual(stateBefore);
  }, 30_000);
});
