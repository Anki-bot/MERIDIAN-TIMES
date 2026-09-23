import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPreservationManifest,
  formatPreservationManifest,
} from "../helpers/integrity-manifest";

const fileMutationGuard = vi.hoisted(() => ({
  armed: false,
  attempts: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const actualRecord = actual as unknown as Record<string, unknown>;
  const guarded: Record<string, unknown> = { ...actualRecord };
  const mutators = [
    "appendFile",
    "chmod",
    "chown",
    "copyFile",
    "cp",
    "lchmod",
    "lchown",
    "link",
    "lutimes",
    "mkdir",
    "mkdtemp",
    "rename",
    "rm",
    "rmdir",
    "symlink",
    "truncate",
    "unlink",
    "utimes",
    "writeFile",
  ] as const;

  const guardedDefault = actualRecord.default !== null
    && typeof actualRecord.default === "object"
    ? { ...(actualRecord.default as Record<string, unknown>) }
    : actualRecord.default;

  for (const method of mutators) {
    const original = actualRecord[method];
    if (typeof original !== "function") continue;
    const guardedMutator = function (this: unknown, ...args: unknown[]): unknown {
      if (fileMutationGuard.armed) {
        fileMutationGuard.attempts.push(`node:fs/promises.${method}`);
        throw new Error(`Read-only contract inspection attempted node:fs/promises.${method}`);
      }
      return Reflect.apply(original, this, args);
    };
    guarded[method] = guardedMutator;
    if (guardedDefault !== null && typeof guardedDefault === "object") {
      (guardedDefault as Record<string, unknown>)[method] = guardedMutator;
    }
  }

  if (guardedDefault !== undefined) guarded.default = guardedDefault;
  return guarded;
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const actualRecord = actual as unknown as Record<string, unknown>;
  const guarded: Record<string, unknown> = { ...actualRecord };
  const mutators = [
    "appendFile",
    "appendFileSync",
    "chmod",
    "chmodSync",
    "chown",
    "chownSync",
    "copyFile",
    "copyFileSync",
    "cp",
    "cpSync",
    "fchmod",
    "fchmodSync",
    "fchown",
    "fchownSync",
    "ftruncate",
    "ftruncateSync",
    "futimes",
    "futimesSync",
    "lchmod",
    "lchmodSync",
    "lchown",
    "lchownSync",
    "link",
    "linkSync",
    "lutimes",
    "lutimesSync",
    "mkdir",
    "mkdirSync",
    "mkdtemp",
    "mkdtempSync",
    "rename",
    "renameSync",
    "rm",
    "rmSync",
    "rmdir",
    "rmdirSync",
    "symlink",
    "symlinkSync",
    "truncate",
    "truncateSync",
    "unlink",
    "unlinkSync",
    "utimes",
    "utimesSync",
    "write",
    "writeFile",
    "writeFileSync",
    "writeSync",
    "writev",
    "writevSync",
  ] as const;

  const guardedDefault = actualRecord.default !== null
    && typeof actualRecord.default === "object"
    ? { ...(actualRecord.default as Record<string, unknown>) }
    : actualRecord.default;

  for (const method of mutators) {
    const original = actualRecord[method];
    if (typeof original !== "function") continue;
    const guardedMutator = function (this: unknown, ...args: unknown[]): unknown {
      if (fileMutationGuard.armed) {
        fileMutationGuard.attempts.push(`node:fs.${method}`);
        throw new Error(`Read-only contract inspection attempted node:fs.${method}`);
      }
      return Reflect.apply(original, this, args);
    };
    guarded[method] = guardedMutator;
    if (guardedDefault !== null && typeof guardedDefault === "object") {
      (guardedDefault as Record<string, unknown>)[method] = guardedMutator;
    }
  }

  if (guardedDefault !== undefined) guarded.default = guardedDefault;
  return guarded;
});

type ContractFailure = {
  readonly code: string;
  readonly message: string;
  readonly ok: false;
  readonly path: string | null;
};

type FileIdentity = {
  readonly byteLength: number;
  readonly path: string;
  readonly sha256: string;
};

type InputHashSnapshot = {
  readonly algorithm: "sha256";
  readonly files: readonly FileIdentity[];
  readonly schemaVersion: 1;
  readonly snapshotSha256: string;
};

type PathOptions = {
  readonly allowPublic?: boolean;
  readonly allowedRoots?: readonly string[];
  readonly expectedPath?: string;
  readonly failureCode?: string;
  readonly projectRoot?: string;
};

type ContractModule = {
  readonly APPROVED_DEPENDENCY_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly APPROVED_MASTER_IDENTITY: Readonly<Record<string, unknown>> & {
    readonly byteLength: number;
    readonly path: string;
    readonly sha256: string;
    readonly sourceFile: string;
  };
  readonly CANONICAL_MASTER_PATH: string;
  readonly CANONICAL_PROJECT_PATHS: Readonly<Record<string, string>>;
  readonly CONTRACT_FAILURE_CODES: Readonly<Record<
    | "IDENTITY_MISMATCH"
    | "INPUT_CHANGED"
    | "PATH_INVALID"
    | "PREDECESSOR_INVALID"
    | "PROTECTED_ARTIFACT_CHANGED",
    string
  >>;
  readonly DEPENDENCY_FIELD_SNAPSHOTS: Readonly<Record<string, unknown>>;
  readonly PREDECESSOR_MANIFEST_IDENTITY: Readonly<Record<string, unknown>> & {
    readonly byteLength: number;
    readonly contractStatus: string;
    readonly derivativeCount: number;
    readonly immutableMasterSha256: string;
    readonly manifestFile: string;
    readonly path: string;
    readonly schemaVersion: number;
    readonly segmentationApplied: false;
    readonly sha256: string;
  };
  readonly PROTECTED_ARTIFACT_RULES: {
    readonly cssManifestIdPrefix: string;
    readonly directoryRoots: readonly string[];
    readonly exactFiles: readonly string[];
  };
  assertApprovedMasterIdentity(options?: PathOptions): Promise<FileIdentity>;
  assertCanonicalMasterIsNonPublic(): boolean;
  assertInputHashSnapshotUnchanged(
    before: InputHashSnapshot,
    options?: PathOptions,
  ): Promise<InputHashSnapshot>;
  assertPredecessorManifestIdentity(options?: PathOptions): Promise<FileIdentity>;
  assertProjectFileIdentity(
    expectedIdentity: Readonly<Record<string, unknown>>,
    options?: PathOptions,
  ): Promise<FileIdentity>;
  assertSafeProjectRelativePath(value: unknown, options?: PathOptions): string;
  compareInputHashSnapshots(
    before: InputHashSnapshot,
    after: InputHashSnapshot,
    options?: Pick<PathOptions, "failureCode">,
  ): { readonly ok: true } | ContractFailure;
  createInputHashSnapshot(
    projectRelativePaths: readonly string[],
    options?: PathOptions,
  ): Promise<InputHashSnapshot>;
  inspectApprovedDependencyFields(options?: PathOptions): Promise<Readonly<Record<string, unknown>>>;
  inspectSafeRegularFile(
    projectRelativePath: string,
    options?: PathOptions,
  ): Promise<{ readonly bytes: Buffer; readonly identity: FileIdentity }>;
  isProtectedArtifactMember(value: unknown): boolean;
  readSafeRegularFile(projectRelativePath: string, options?: PathOptions): Promise<Buffer>;
  serializeInputHashSnapshot(snapshot: InputHashSnapshot): Buffer;
};

type PredecessorManifest = {
  contractStatus: string;
  derivativePolicy: {
    derivatives: Array<{
      file: string;
      sha256: string;
    }>;
  };
  master: Record<string, unknown> & {
    sourceFile: string;
  };
  presentation: {
    layerCompatibility: {
      immutableMasterSha256: string;
      segmentationApplied: boolean;
    };
  };
  schemaVersion: number;
};

// @ts-expect-error -- The dependency-free executable ESM is explicitly typed above.
const contract = (await import("../../scripts/watch-2-5d/contract.mjs")) as unknown as ContractModule;

const PROJECT_ROOT = process.cwd();
const CONTRACT_SOURCE_PATH = resolve(
  PROJECT_ROOT,
  "scripts/watch-2-5d/contract.mjs",
);
const PRESERVATION_FIXTURE_PATH = resolve(
  PROJECT_ROOT,
  "tests/fixtures/glass-header-hover-preservation.sha256",
);
const temporaryRoots = new Set<string>();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "watch-2-5d-baseline-"));
  temporaryRoots.add(root);
  return root;
}

async function writeFixture(
  root: string,
  projectRelativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const absolutePath = resolve(root, projectRelativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

function normalizeProjectPath(absolutePath: string): string {
  return relative(PROJECT_ROOT, absolutePath).split(sep).join("/");
}

async function listFilesRecursively(projectRelativeDirectory: string): Promise<readonly string[]> {
  const absoluteDirectory = resolve(PROJECT_ROOT, projectRelativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => (
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ))) {
    const absolutePath = resolve(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(normalizeProjectPath(absolutePath)));
    } else if (entry.isFile()) {
      files.push(normalizeProjectPath(absolutePath));
    }
  }
  return files;
}

async function captureContractFailure(
  operation: () => unknown | Promise<unknown>,
  expectedCode: string,
  expectedPath?: string,
): Promise<ContractFailure> {
  try {
    await operation();
  } catch (error) {
    expect(error).toMatchObject({
      code: expectedCode,
      failure: {
        code: expectedCode,
        ok: false,
      },
      name: "ImmutableBoundaryContractError",
    });
    const failure = (error as { failure: ContractFailure }).failure;
    if (expectedPath !== undefined) expect(failure.path).toBe(expectedPath);
    return failure;
  }
  throw new Error(`Expected immutable-boundary failure ${expectedCode}`);
}

async function withReadOnlyInspection<T>(operation: () => Promise<T>): Promise<T> {
  const fetchAttempt = vi.fn(() => {
    throw new Error("Contract inspection attempted a network request through fetch");
  });
  const webSocketAttempt = vi.fn(function WebSocketGuard() {
    throw new Error("Contract inspection attempted a network request through WebSocket");
  });
  const xhrAttempt = vi.fn(function XMLHttpRequestGuard() {
    throw new Error("Contract inspection attempted a network request through XMLHttpRequest");
  });

  vi.stubGlobal("fetch", fetchAttempt);
  vi.stubGlobal("WebSocket", webSocketAttempt);
  vi.stubGlobal("XMLHttpRequest", xhrAttempt);
  fileMutationGuard.attempts.length = 0;
  fileMutationGuard.armed = true;

  try {
    const result = await operation();
    expect(fetchAttempt).not.toHaveBeenCalled();
    expect(webSocketAttempt).not.toHaveBeenCalled();
    expect(xhrAttempt).not.toHaveBeenCalled();
    expect(fileMutationGuard.attempts).toEqual([]);
    return result;
  } finally {
    fileMutationGuard.armed = false;
    vi.unstubAllGlobals();
  }
}

afterEach(async () => {
  fileMutationGuard.armed = false;
  fileMutationGuard.attempts.length = 0;
  vi.unstubAllGlobals();
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("watch 2.5D immutable predecessor baseline", () => {
  it("accepts the real baseline and inspects every input without network or filesystem writes", async () => {
    const contractSource = await readFile(CONTRACT_SOURCE_PATH, "utf8");
    expect(contractSource).not.toMatch(
      /["']node:(?:dgram|dns(?:\/promises)?|http2?|https|net|tls)["']|\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u,
    );
    expect(contractSource).not.toMatch(
      /\b(?:appendFile|chmod|chown|copyFile|cp|link|lutimes|mkdir|mkdtemp|rename|rm|rmdir|symlink|truncate|unlink|utimes|write|writeFile|writev)(?:Sync)?\s*\(/u,
    );

    const preservationManifest = createPreservationManifest(PROJECT_ROOT);
    const baselineInputPaths = [...new Set([
      ...preservationManifest
        .map(({ id }) => id)
        .filter((id) => !id.includes("#")),
      contract.CANONICAL_PROJECT_PATHS.globalsCss,
      contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
    ])].sort();

    const inspected = await withReadOnlyInspection(async () => {
      const before = await contract.createInputHashSnapshot(baselineInputPaths, {
        allowPublic: true,
        projectRoot: PROJECT_ROOT,
      });
      const masterIdentity = await contract.assertApprovedMasterIdentity({
        projectRoot: PROJECT_ROOT,
      });
      const predecessorIdentity = await contract.assertPredecessorManifestIdentity({
        projectRoot: PROJECT_ROOT,
      });
      const dependencySnapshots = await contract.inspectApprovedDependencyFields({
        projectRoot: PROJECT_ROOT,
      });
      const predecessorBytes = await contract.readSafeRegularFile(
        contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
        { projectRoot: PROJECT_ROOT },
      );
      const packageBytes = await contract.readSafeRegularFile(
        contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
        { projectRoot: PROJECT_ROOT },
      );
      const after = await contract.assertInputHashSnapshotUnchanged(before, {
        allowPublic: true,
        projectRoot: PROJECT_ROOT,
      });
      return {
        after,
        before,
        dependencySnapshots,
        masterIdentity,
        packageDocument: JSON.parse(packageBytes.toString("utf8")) as Record<string, unknown>,
        predecessorBytes,
        predecessorIdentity,
        predecessorManifest: JSON.parse(predecessorBytes.toString("utf8")) as PredecessorManifest,
      };
    });

    expect(inspected.masterIdentity).toEqual({
      byteLength: contract.APPROVED_MASTER_IDENTITY.byteLength,
      path: contract.APPROVED_MASTER_IDENTITY.path,
      sha256: contract.APPROVED_MASTER_IDENTITY.sha256,
    });
    expect(inspected.predecessorIdentity).toEqual({
      byteLength: contract.PREDECESSOR_MANIFEST_IDENTITY.byteLength,
      path: contract.PREDECESSOR_MANIFEST_IDENTITY.path,
      sha256: contract.PREDECESSOR_MANIFEST_IDENTITY.sha256,
    });
    expect(contract.assertCanonicalMasterIsNonPublic()).toBe(true);
    expect(contract.CANONICAL_MASTER_PATH.startsWith("public/")).toBe(false);
    expect(inspected.after).toEqual(inspected.before);
    expect(contract.serializeInputHashSnapshot(inspected.after)).toEqual(
      contract.serializeInputHashSnapshot(inspected.before),
    );

    const predecessor = inspected.predecessorManifest;
    expect({
      byteLength: inspected.predecessorBytes.byteLength,
      contractStatus: predecessor.contractStatus,
      derivativeCount: predecessor.derivativePolicy.derivatives.length,
      immutableMasterSha256: predecessor.presentation.layerCompatibility.immutableMasterSha256,
      manifestFile: contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      path: contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      schemaVersion: predecessor.schemaVersion,
      segmentationApplied: predecessor.presentation.layerCompatibility.segmentationApplied,
      sha256: sha256(inspected.predecessorBytes),
    }).toEqual(contract.PREDECESSOR_MANIFEST_IDENTITY);
    expect(predecessor.presentation.layerCompatibility.segmentationApplied).toBe(false);

    for (const [field, expected] of Object.entries(contract.APPROVED_MASTER_IDENTITY)) {
      const actual = field === "path"
        ? predecessor.master.sourceFile
        : predecessor.master[field];
      expect(actual, `predecessor master field ${field}`).toEqual(expected);
    }

    const preservationById = new Map(
      preservationManifest.map((entry) => [entry.id, entry.digest]),
    );
    for (const derivative of predecessor.derivativePolicy.derivatives) {
      expect(preservationById.get(derivative.file)).toBe(derivative.sha256);
    }

    expect(inspected.packageDocument.dependencies).toEqual(
      contract.APPROVED_DEPENDENCY_FIELDS.dependencies,
    );
    expect(inspected.packageDocument.devDependencies).toEqual(
      contract.APPROVED_DEPENDENCY_FIELDS.devDependencies,
    );
    expect(inspected.dependencySnapshots).toEqual(contract.DEPENDENCY_FIELD_SNAPSHOTS);
  });

  it("rejects every unsafe path class and confines successor paths to successor roots", async () => {
    const root = await createTemporaryRoot();
    const symlinkPath = `${contract.CANONICAL_PROJECT_PATHS.successorMasksDirectory}/escape.png`;
    await mkdir(resolve(root, contract.CANONICAL_PROJECT_PATHS.successorMasksDirectory), {
      recursive: true,
    });
    await symlink(
      resolve(PROJECT_ROOT, contract.CANONICAL_MASTER_PATH),
      resolve(root, symlinkPath),
    );

    await withReadOnlyInspection(async () => {
      const invalidPaths: readonly [unknown, PathOptions?][] = [
        ["/tmp/watch.png"],
        ["C:/temp/watch.png"],
        ["https://example.invalid/watch.png"],
        ["data:image/png;base64,AAAA"],
        ["../watch.png"],
        ["source/assets/../watch.png"],
        ["source/assets/%2e%2e/watch.png"],
        ["//server/share/watch.png"],
        ["public/unapproved/watch.png", { allowPublic: true }],
        [
          "public/assets/watch-2-5d/v1/../escape.webp",
          {
            allowPublic: true,
            allowedRoots: [contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory],
          },
        ],
      ];

      for (const [path, options] of invalidPaths) {
        await captureContractFailure(
          () => contract.assertSafeProjectRelativePath(path, options),
          contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
          typeof path === "string" ? path : undefined,
        );
      }

      const repeatedFirst = await captureContractFailure(
        () => contract.assertSafeProjectRelativePath("../watch.png"),
        contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        "../watch.png",
      );
      const repeatedSecond = await captureContractFailure(
        () => contract.assertSafeProjectRelativePath("../watch.png"),
        contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        "../watch.png",
      );
      expect(repeatedSecond).toEqual(repeatedFirst);

      expect(contract.assertSafeProjectRelativePath(
        contract.CANONICAL_PROJECT_PATHS.successorAuthoring,
        {
          allowedRoots: [contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory],
        },
      )).toBe(contract.CANONICAL_PROJECT_PATHS.successorAuthoring);
      expect(contract.assertSafeProjectRelativePath(
        `${contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/compact/layer.webp`,
        {
          allowPublic: true,
          allowedRoots: [contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory],
        },
      )).toBe("public/assets/watch-2-5d/v1/compact/layer.webp");

      await captureContractFailure(
        () => contract.assertSafeProjectRelativePath(
          contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
          {
            allowedRoots: [contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory],
          },
        ),
        contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      );
      await captureContractFailure(
        () => contract.assertSafeProjectRelativePath(
          `${contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory}/compact/layer.webp`,
        ),
        contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        "public/assets/watch-2-5d/v1/compact/layer.webp",
      );
      await captureContractFailure(
        () => contract.inspectSafeRegularFile(symlinkPath, {
          allowedRoots: [contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory],
          projectRoot: root,
        }),
        contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        symlinkPath,
      );
    });
  });

  it("covers every inherited protected member and keeps successor directories isolated", async () => {
    const inspected = await withReadOnlyInspection(async () => {
      const manifest = createPreservationManifest(PROJECT_ROOT);
      const historicalSpecFiles = await listFilesRecursively(
        contract.CANONICAL_PROJECT_PATHS.historicalSpecDirectory,
      );
      const predecessorSpecFiles = await listFilesRecursively(
        contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
      );
      const predecessorDocument = JSON.parse(await readFile(
        resolve(PROJECT_ROOT, contract.CANONICAL_PROJECT_PATHS.predecessorManifest),
        "utf8",
      )) as PredecessorManifest;
      const fixture = await readFile(PRESERVATION_FIXTURE_PATH, "utf8");
      return {
        fixture,
        historicalSpecFiles,
        manifest,
        predecessorDocument,
        predecessorSpecFiles,
      };
    });

    const manifestIds = inspected.manifest.map(({ id }) => id);
    const watchCssIds = manifestIds.filter((id) => (
      id.startsWith(contract.PROTECTED_ARTIFACT_RULES.cssManifestIdPrefix)
    ));
    const formalProtectedIds = [
      ...inspected.historicalSpecFiles,
      ...inspected.predecessorSpecFiles,
      ...contract.PROTECTED_ARTIFACT_RULES.exactFiles,
      ...watchCssIds,
    ].sort();
    const predecessorAssetIds = [
      contract.CANONICAL_MASTER_PATH,
      contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      ...inspected.predecessorDocument.derivativePolicy.derivatives.map(({ file }) => file),
    ];
    const expectedIntegrityIds = [
      ...formalProtectedIds,
      ...predecessorAssetIds,
      `${contract.CANONICAL_PROJECT_PATHS.dependencyManifest}#dependencies`,
      `${contract.CANONICAL_PROJECT_PATHS.dependencyManifest}#devDependencies`,
    ].sort();

    expect(watchCssIds.length).toBeGreaterThan(0);
    expect(manifestIds).toEqual(expectedIntegrityIds);
    expect(formatPreservationManifest(inspected.manifest)).toBe(inspected.fixture);
    expect(contract.PROTECTED_ARTIFACT_RULES.directoryRoots).toEqual([
      contract.CANONICAL_PROJECT_PATHS.historicalSpecDirectory,
      contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory,
    ]);
    expect(contract.PROTECTED_ARTIFACT_RULES.exactFiles).toEqual([
      contract.CANONICAL_PROJECT_PATHS.protectedCanvas,
    ]);

    for (const id of formalProtectedIds) {
      expect(contract.isProtectedArtifactMember(id), id).toBe(true);
    }
    for (const id of predecessorAssetIds) {
      expect(manifestIds, id).toContain(id);
    }

    const successorPaths = Object.entries(contract.CANONICAL_PROJECT_PATHS)
      .filter(([name]) => name.startsWith("successor"))
      .map(([, path]) => path);
    for (const successorPath of successorPaths) {
      expect(contract.isProtectedArtifactMember(successorPath), successorPath).toBe(false);
      expect(contract.PROTECTED_ARTIFACT_RULES.directoryRoots.some((protectedRoot) => (
        successorPath === protectedRoot || successorPath.startsWith(`${protectedRoot}/`)
      ))).toBe(false);
    }
    expect(contract.CANONICAL_MASTER_PATH.startsWith(
      `${contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory}/`,
    )).toBe(false);
  });

  it("returns documented deterministic first failures for one-field, one-path, and one-byte mutations", async () => {
    const realPredecessorBytes = await readFile(
      resolve(PROJECT_ROOT, contract.CANONICAL_PROJECT_PATHS.predecessorManifest),
    );
    const fieldRoot = await createTemporaryRoot();
    const fieldMutation = JSON.parse(realPredecessorBytes.toString("utf8")) as PredecessorManifest;
    fieldMutation.presentation.layerCompatibility.segmentationApplied = true;
    await writeFixture(
      fieldRoot,
      contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      Buffer.from(`${JSON.stringify(fieldMutation, null, 2)}\n`),
    );

    const byteRoot = await createTemporaryRoot();
    const byteMutationPath = resolve(byteRoot, contract.CANONICAL_MASTER_PATH);
    await mkdir(dirname(byteMutationPath), { recursive: true });
    await copyFile(resolve(PROJECT_ROOT, contract.CANONICAL_MASTER_PATH), byteMutationPath);
    const mutatedMasterBytes = Buffer.from(await readFile(byteMutationPath));
    mutatedMasterBytes[64] ^= 0x01;
    await writeFile(byteMutationPath, mutatedMasterBytes);

    const dependencyRoot = await createTemporaryRoot();
    const dependencyMutation = JSON.parse(await readFile(
      resolve(PROJECT_ROOT, contract.CANONICAL_PROJECT_PATHS.dependencyManifest),
      "utf8",
    )) as { dependencies: Record<string, string> };
    dependencyMutation.dependencies.react = "19.2.8-test-field-mutation";
    await writeFixture(
      dependencyRoot,
      contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
      Buffer.from(`${JSON.stringify(dependencyMutation, null, 2)}\n`),
    );

    const protectedRoot = await createTemporaryRoot();
    const protectedPath = contract.CANONICAL_PROJECT_PATHS.protectedCanvas;
    await writeFixture(
      protectedRoot,
      protectedPath,
      await readFile(resolve(PROJECT_ROOT, protectedPath)),
    );
    const protectedBefore = await withReadOnlyInspection(() => (
      contract.createInputHashSnapshot([protectedPath], { projectRoot: protectedRoot })
    ));
    const protectedBytes = Buffer.from(await readFile(resolve(protectedRoot, protectedPath)));
    protectedBytes[0] ^= 0x01;
    await writeFile(resolve(protectedRoot, protectedPath), protectedBytes);

    await withReadOnlyInspection(async () => {
      const fieldFailure = await captureContractFailure(
        () => contract.assertPredecessorManifestIdentity({ projectRoot: fieldRoot }),
        contract.CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
        contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      );
      expect(await captureContractFailure(
        () => contract.assertPredecessorManifestIdentity({ projectRoot: fieldRoot }),
        contract.CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
        contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      )).toEqual(fieldFailure);

      const byteFailure = await captureContractFailure(
        () => contract.assertApprovedMasterIdentity({ projectRoot: byteRoot }),
        contract.CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
        contract.CANONICAL_MASTER_PATH,
      );
      expect(await captureContractFailure(
        () => contract.assertApprovedMasterIdentity({ projectRoot: byteRoot }),
        contract.CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
        contract.CANONICAL_MASTER_PATH,
      )).toEqual(byteFailure);

      await captureContractFailure(
        () => contract.inspectApprovedDependencyFields({ projectRoot: dependencyRoot }),
        contract.CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
        contract.CANONICAL_PROJECT_PATHS.dependencyManifest,
      );

      const unsafeIdentity = {
        ...contract.APPROVED_MASTER_IDENTITY,
        path: "../elite-watch-master.png",
        sourceFile: "../elite-watch-master.png",
      };
      const pathFailure = await captureContractFailure(
        () => contract.assertProjectFileIdentity(unsafeIdentity, { projectRoot: byteRoot }),
        contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        "../elite-watch-master.png",
      );
      expect(await captureContractFailure(
        () => contract.assertProjectFileIdentity(unsafeIdentity, { projectRoot: byteRoot }),
        contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
        "../elite-watch-master.png",
      )).toEqual(pathFailure);

      const protectedAfter = await contract.createInputHashSnapshot([protectedPath], {
        projectRoot: protectedRoot,
      });
      expect(contract.compareInputHashSnapshots(protectedBefore, protectedAfter)).toEqual({
        code: contract.CONTRACT_FAILURE_CODES.INPUT_CHANGED,
        message: "Input bytes changed after the initial snapshot",
        ok: false,
        path: protectedPath,
      });
      expect(contract.compareInputHashSnapshots(protectedBefore, protectedAfter, {
        failureCode: contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
      })).toEqual({
        code: contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
        message: "Input bytes changed after the initial snapshot",
        ok: false,
        path: protectedPath,
      });
      await captureContractFailure(
        () => contract.assertInputHashSnapshotUnchanged(protectedBefore, {
          failureCode: contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
          projectRoot: protectedRoot,
        }),
        contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
        protectedPath,
      );
    });
  });
});
