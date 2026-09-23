import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { expect, it } from "vitest";
import { createPreservationManifest } from "../helpers/integrity-manifest";

const PROPERTY_TAG =
  "Feature: interactive-layered-watch-2-5d, Property 1: Immutable predecessor and isolated successor boundary";

// Reproduce with: seed=20250518, numRuns=128.
// Every run contains one operation from each required boundary class.
const PROPERTY_SEED = 20_250_518;
const PROPERTY_RUNS = 128;
const PROJECT_ROOT = process.cwd();
const CONTRACT_PATH = resolve(PROJECT_ROOT, "scripts/watch-2-5d/contract.mjs");
const CONTRACT_MODULE_URL = pathToFileURL(CONTRACT_PATH).href;
const SYMLINK_PATH = "source/assets/watch-2-5d/v1/review/symlinked-input.json";

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

type MutableInputHashSnapshot = {
  algorithm: "sha256";
  files: FileIdentity[];
  schemaVersion: 1;
  snapshotSha256: string;
};

type ExpectedIdentity = {
  byteLength: number;
  manifestFile?: string;
  path: string;
  sha256: string;
  sourceFile?: string;
  readonly [field: string]: unknown;
};

type PackageDocument = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  readonly [field: string]: unknown;
};

type DependencySnapshots = {
  readonly dependencies: { readonly serialized: string };
  readonly devDependencies: { readonly serialized: string };
};

type ContractModule = {
  readonly APPROVED_MASTER_IDENTITY: Readonly<ExpectedIdentity>;
  readonly CANONICAL_PROJECT_PATHS: Readonly<Record<string, string>>;
  readonly CONTRACT_FAILURE_CODES: Readonly<{
    IDENTITY_MISMATCH: string;
    INPUT_CHANGED: string;
    PATH_INVALID: string;
    PROTECTED_ARTIFACT_CHANGED: string;
  }>;
  readonly DEPENDENCY_FIELD_SNAPSHOTS: DependencySnapshots;
  readonly PREDECESSOR_MANIFEST_IDENTITY: Readonly<ExpectedIdentity>;
  assertApprovedDependencyFields(document: unknown): DependencySnapshots;
  assertApprovedMasterIdentity(options?: { readonly projectRoot?: string }): Promise<FileIdentity>;
  assertCanonicalMasterIsNonPublic(): true;
  assertInputHashSnapshotUnchanged(
    snapshot: InputHashSnapshot,
    options?: { readonly projectRoot?: string },
  ): Promise<InputHashSnapshot>;
  assertPredecessorManifestIdentity(options?: { readonly projectRoot?: string }): Promise<FileIdentity>;
  assertProjectFileIdentity(
    identity: ExpectedIdentity,
    options?: { readonly projectRoot?: string },
  ): Promise<FileIdentity>;
  compareInputHashSnapshots(
    before: InputHashSnapshot,
    after: InputHashSnapshot,
  ): { readonly ok: true } | ContractFailure;
  createDeterministicFailure(
    code: string,
    message: string,
    path?: string | null,
  ): ContractFailure;
  createInputHashSnapshot(
    paths: readonly string[],
    options?: { readonly projectRoot?: string },
  ): Promise<InputHashSnapshot>;
  inspectApprovedDependencyFields(options?: { readonly projectRoot?: string }): Promise<DependencySnapshots>;
  inspectSafeRegularFile(
    path: string,
    options?: {
      readonly allowPublic?: boolean;
      readonly allowedRoots?: readonly string[];
      readonly projectRoot?: string;
    },
  ): Promise<{ readonly bytes: Buffer; readonly identity: FileIdentity }>;
  isProtectedArtifactMember(path: string): boolean;
  resolveSafeProjectPath(
    path: string,
    options?: {
      readonly allowPublic?: boolean;
      readonly allowedRoots?: readonly string[];
      readonly projectRoot?: string;
    },
  ): string;
  sha256(value: string | ArrayBufferView): string;
};

type SuccessfulGateOperation =
  | "canonical-master"
  | "dependency-fields"
  | "input-snapshot"
  | "non-public-master"
  | "predecessor-manifest";

type FailingGateOperation =
  | {
      readonly delta: number;
      readonly field: "byteLength" | "sha256";
      readonly kind: "identity";
      readonly target: "canonical-master" | "predecessor-manifest";
    }
  | {
      readonly delta: number;
      readonly field: "dependencies" | "devDependencies";
      readonly index: number;
      readonly kind: "dependency-field";
    }
  | {
      readonly index: number;
      readonly kind: "input-snapshot";
    };

type SuccessorLocation =
  | "approval"
  | "authoring"
  | "mask"
  | "package"
  | "public-compact"
  | "reconstruction"
  | "release"
  | "review";

type SuccessorMutation = {
  readonly location: SuccessorLocation;
  readonly payload: Uint8Array;
  readonly token: number;
};

type UnsafeMutation =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "symlink"; readonly path: typeof SYMLINK_PATH };

type ProtectedMutation = {
  readonly index: number;
  readonly kind: "delete" | "replace-byte" | "truncate";
  readonly offset: number;
  readonly xor: number;
};

type ScopeEscape =
  | {
      readonly behavior: "write-successor-artifact";
      readonly owner: "canonical-master" | "existing-control" | "predecessor-fallback";
    }
  | {
      readonly behavior: "attach-input-handler" | "mutate-predecessor-transform" | "replace-fallback";
      readonly owner: "successor-package";
    };

type MutationIntent = {
  readonly behavior:
    | "attach-input-handler"
    | "mutate-predecessor-transform"
    | "replace-fallback"
    | "write-successor-artifact";
  readonly owner:
    | "canonical-master"
    | "existing-control"
    | "predecessor-fallback"
    | "successor-package";
  readonly payload: Buffer;
  readonly target: string;
};

type MutationSuccess = {
  readonly absolutePath: string;
  readonly ok: true;
  readonly path: string;
};

type MutationEffects = {
  writes: number;
};

const successfulGateArbitrary = fc.constantFrom<SuccessfulGateOperation>(
  "canonical-master",
  "dependency-fields",
  "input-snapshot",
  "non-public-master",
  "predecessor-manifest",
);

const failingGateArbitrary: fc.Arbitrary<FailingGateOperation> = fc.oneof(
  fc.record({
    delta: fc.integer({ min: 1, max: 64 }),
    field: fc.constantFrom("byteLength" as const, "sha256" as const),
    kind: fc.constant("identity" as const),
    target: fc.constantFrom("canonical-master" as const, "predecessor-manifest" as const),
  }),
  fc.record({
    delta: fc.integer({ min: 1, max: 64 }),
    field: fc.constantFrom("dependencies" as const, "devDependencies" as const),
    index: fc.integer({ min: 0, max: 1_000 }),
    kind: fc.constant("dependency-field" as const),
  }),
  fc.record({
    index: fc.integer({ min: 0, max: 1_000 }),
    kind: fc.constant("input-snapshot" as const),
  }),
);

const successorMutationArbitrary: fc.Arbitrary<SuccessorMutation> = fc.record({
  location: fc.constantFrom<SuccessorLocation>(
    "approval",
    "authoring",
    "mask",
    "package",
    "public-compact",
    "reconstruction",
    "release",
    "review",
  ),
  payload: fc.uint8Array({ minLength: 1, maxLength: 96 }),
  token: fc.integer({ min: 0, max: 1_000_000 }),
});

const unsafeMutationArbitrary: fc.Arbitrary<UnsafeMutation> = fc.oneof(
  fc.record({
    kind: fc.constant("path" as const),
    path: fc.constantFrom(
      "/tmp/outside-successor.json",
      "C:/temp/outside-successor.json",
      "https://invalid.example/layer.webp",
      "data:image/png;base64,invalid",
      "source/assets/watch-2-5d/v1/../outside.json",
      "source\\assets\\watch-2-5d\\v1\\outside.json",
      "source/assets/watch-2-5d/v1/%2e%2e/outside.json",
      "source/assets/watch-2-5d/v1/review/item.json?changed=1",
      "public/unapproved/layer.webp",
      "public/assets/watch/not-a-successor.webp",
      "source/assets/unapproved/layer.png",
    ),
  }),
  fc.constant({ kind: "symlink" as const, path: SYMLINK_PATH }),
);

const protectedMutationArbitrary: fc.Arbitrary<ProtectedMutation> = fc.record({
  index: fc.integer({ min: 0, max: 10_000 }),
  kind: fc.constantFrom("delete" as const, "replace-byte" as const, "truncate" as const),
  offset: fc.integer({ min: 0, max: 10_000 }),
  xor: fc.integer({ min: 1, max: 255 }),
});

const scopeEscapeArbitrary: fc.Arbitrary<ScopeEscape> = fc.oneof(
  fc.record({
    behavior: fc.constant("write-successor-artifact" as const),
    owner: fc.constantFrom(
      "canonical-master" as const,
      "existing-control" as const,
      "predecessor-fallback" as const,
    ),
  }),
  fc.record({
    behavior: fc.constantFrom(
      "attach-input-handler" as const,
      "mutate-predecessor-transform" as const,
      "replace-fallback" as const,
    ),
    owner: fc.constant("successor-package" as const),
  }),
);

function isContainedPath(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function mutateFirstHexNibble(value: string): string {
  return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
}

function contractFailureFrom(error: unknown): ContractFailure {
  if (
    error !== null
    && typeof error === "object"
    && "failure" in error
  ) {
    const failure = (error as { readonly failure?: unknown }).failure;
    if (
      failure !== null
      && typeof failure === "object"
      && "ok" in failure
      && (failure as { readonly ok?: unknown }).ok === false
    ) {
      return failure as ContractFailure;
    }
  }
  throw error;
}

async function expectContractFailure(
  operation: () => unknown | Promise<unknown>,
  expectedCode: string,
): Promise<ContractFailure> {
  try {
    await operation();
  } catch (error) {
    const failure = contractFailureFrom(error);
    expect(failure).toMatchObject({ code: expectedCode, ok: false });
    return failure;
  }
  throw new Error(`Expected immutable-boundary failure ${expectedCode}`);
}

function successorPath(mutation: SuccessorMutation): string {
  const suffix = `property-${mutation.token}`;
  switch (mutation.location) {
    case "approval":
      return `source/assets/watch-2-5d/v1/approvals/${suffix}.json`;
    case "authoring":
      return "source/assets/watch-2-5d/v1/authoring.json";
    case "mask":
      return `source/assets/watch-2-5d/v1/masks/${suffix}.png`;
    case "package":
      return "data/watch-layer-package.json";
    case "public-compact":
      return `public/assets/watch-2-5d/v1/compact/${suffix}.webp`;
    case "reconstruction":
      return `source/assets/watch-2-5d/v1/reconstruction/${suffix}.png`;
    case "release":
      return "data/watch-layer-release.json";
    case "review":
      return `source/assets/watch-2-5d/v1/review/${suffix}.json`;
  }
}

function successorRoots(contract: ContractModule): readonly string[] {
  return [
    contract.CANONICAL_PROJECT_PATHS.successorSourceDirectory,
    contract.CANONICAL_PROJECT_PATHS.successorPackageManifest,
    contract.CANONICAL_PROJECT_PATHS.successorRelease,
    contract.CANONICAL_PROJECT_PATHS.successorPublicAssetsDirectory,
  ];
}

async function attemptBoundaryMutation(
  contract: ContractModule,
  intent: MutationIntent,
  options: {
    readonly commit: (absolutePath: string, payload: Buffer) => Promise<void>;
    readonly projectRoot: string;
    readonly protectedIds: ReadonlySet<string>;
  },
): Promise<MutationSuccess | ContractFailure> {
  if (options.protectedIds.has(intent.target)) {
    return contract.createDeterministicFailure(
      contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
      "Mutation target belongs to the immutable predecessor boundary",
      intent.target,
    );
  }

  if (
    intent.owner !== "successor-package"
    || intent.behavior !== "write-successor-artifact"
  ) {
    return contract.createDeterministicFailure(
      contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
      "Mutation owner or behavior falls outside the successor extension boundary",
      intent.target,
    );
  }

  let absolutePath: string;
  try {
    absolutePath = contract.resolveSafeProjectPath(intent.target, {
      allowPublic: true,
      allowedRoots: successorRoots(contract),
      projectRoot: options.projectRoot,
    });
  } catch (error) {
    return contractFailureFrom(error);
  }

  await options.commit(absolutePath, intent.payload);
  return { absolutePath, ok: true, path: intent.target };
}

async function runSuccessfulGateOperation(
  contract: ContractModule,
  operation: SuccessfulGateOperation,
  immutableSnapshot: InputHashSnapshot,
): Promise<void> {
  switch (operation) {
    case "canonical-master": {
      const identity = await contract.assertApprovedMasterIdentity({ projectRoot: PROJECT_ROOT });
      expect(identity).toEqual({
        byteLength: contract.APPROVED_MASTER_IDENTITY.byteLength,
        path: contract.APPROVED_MASTER_IDENTITY.path,
        sha256: contract.APPROVED_MASTER_IDENTITY.sha256,
      });
      return;
    }
    case "predecessor-manifest": {
      const identity = await contract.assertPredecessorManifestIdentity({ projectRoot: PROJECT_ROOT });
      expect(identity).toEqual({
        byteLength: contract.PREDECESSOR_MANIFEST_IDENTITY.byteLength,
        path: contract.PREDECESSOR_MANIFEST_IDENTITY.path,
        sha256: contract.PREDECESSOR_MANIFEST_IDENTITY.sha256,
      });
      return;
    }
    case "dependency-fields":
      expect(await contract.inspectApprovedDependencyFields({ projectRoot: PROJECT_ROOT }))
        .toEqual(contract.DEPENDENCY_FIELD_SNAPSHOTS);
      return;
    case "input-snapshot":
      expect(await contract.assertInputHashSnapshotUnchanged(
        immutableSnapshot,
        { projectRoot: PROJECT_ROOT },
      )).toEqual(immutableSnapshot);
      return;
    case "non-public-master":
      expect(contract.assertCanonicalMasterIsNonPublic()).toBe(true);
  }
}

async function runFailingGateOperation(
  contract: ContractModule,
  operation: FailingGateOperation,
  immutableSnapshot: InputHashSnapshot,
  packageDocument: PackageDocument,
): Promise<void> {
  if (operation.kind === "identity") {
    const approved = operation.target === "canonical-master"
      ? contract.APPROVED_MASTER_IDENTITY
      : contract.PREDECESSOR_MANIFEST_IDENTITY;
    const mutated = structuredClone(approved) as ExpectedIdentity;
    if (operation.field === "byteLength") mutated.byteLength += operation.delta;
    else mutated.sha256 = mutateFirstHexNibble(mutated.sha256);
    const suppliedBefore = structuredClone(mutated);

    await expectContractFailure(
      () => contract.assertProjectFileIdentity(mutated, { projectRoot: PROJECT_ROOT }),
      contract.CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
    );
    expect(mutated).toEqual(suppliedBefore);
    return;
  }

  if (operation.kind === "dependency-field") {
    const mutated = structuredClone(packageDocument);
    const dependencies = mutated[operation.field];
    const names = Object.keys(dependencies);
    const name = names[operation.index % names.length];
    dependencies[name] = `${dependencies[name]}-generated-${operation.delta}`;
    const suppliedBefore = structuredClone(mutated);

    await expectContractFailure(
      () => contract.assertApprovedDependencyFields(mutated),
      contract.CONTRACT_FAILURE_CODES.IDENTITY_MISMATCH,
    );
    expect(mutated).toEqual(suppliedBefore);
    return;
  }

  const changed = structuredClone(immutableSnapshot) as MutableInputHashSnapshot;
  const changedIndex = operation.index % changed.files.length;
  changed.files[changedIndex] = {
    ...changed.files[changedIndex],
    sha256: mutateFirstHexNibble(changed.files[changedIndex].sha256),
  };
  const payload = {
    algorithm: changed.algorithm,
    files: changed.files.map(({ byteLength, path, sha256 }) => ({ byteLength, path, sha256 })),
    schemaVersion: changed.schemaVersion,
  };
  changed.snapshotSha256 = contract.sha256(JSON.stringify(payload));
  const suppliedBefore = structuredClone(changed);

  expect(contract.compareInputHashSnapshots(immutableSnapshot, changed)).toEqual({
    code: contract.CONTRACT_FAILURE_CODES.INPUT_CHANGED,
    message: "Input bytes changed after the initial snapshot",
    ok: false,
    path: changed.files[changedIndex].path,
  });
  expect(changed).toEqual(suppliedBefore);
}

// **Validates: Requirements 1.2, 1.3, 1.6, 1.7, 1.8, 1.10, 1.11, 1.12, 2.6, 2.7, 2.13, 2.15, 13.12, 13.13, 13.15**
it(PROPERTY_TAG, { timeout: 120_000 }, async () => {
  const stagingRoot = await mkdtemp(resolve(tmpdir(), "watch-2-5d-property-01-"));
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  let networkAttempts = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (async () => {
      networkAttempts += 1;
      throw new Error("Property 1 forbids network access");
    }) as typeof fetch,
    writable: true,
  });

  try {
    const contract = await import(
      /* @vite-ignore -- executable ESM is typed by ContractModule above. */
      CONTRACT_MODULE_URL
    ) as unknown as ContractModule;
    const contractSource = await readFile(CONTRACT_PATH, "utf8");
    const filesystemImport = contractSource.match(
      /import\s*\{([^}]*)\}\s*from\s*["']node:fs\/promises["']/u,
    )?.[1] ?? "";
    expect(filesystemImport).not.toMatch(
      /\b(?:appendFile|chmod|chown|copyFile|cp|link|mkdir|rename|rm|rmdir|symlink|truncate|unlink|writeFile)\b/u,
    );
    expect(contractSource).not.toMatch(
      /from\s+["']node:(?:child_process|dgram|dns|http|http2|https|net|tls)["']/u,
    );
    expect(contractSource).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);

    const protectedBefore = createPreservationManifest(PROJECT_ROOT);
    const protectedIds = new Set(protectedBefore.map(({ id }) => id));
    expect(protectedIds.has(contract.CANONICAL_PROJECT_PATHS.canonicalMaster)).toBe(true);
    expect(protectedIds.has(contract.CANONICAL_PROJECT_PATHS.predecessorManifest)).toBe(true);
    expect(protectedIds.has(contract.CANONICAL_PROJECT_PATHS.protectedCanvas)).toBe(true);
    expect(
      [...protectedIds].some((id) => id.startsWith(
        `${contract.CANONICAL_PROJECT_PATHS.predecessorSpecDirectory}/`,
      )),
    ).toBe(true);
    expect(
      [...protectedIds]
        .filter((id) => contract.isProtectedArtifactMember(id))
        .length,
    ).toBeGreaterThan(0);

    const predecessorPath = resolve(
      PROJECT_ROOT,
      contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
    );
    const predecessorBytesBefore = await readFile(predecessorPath);
    const predecessorDocument = JSON.parse(predecessorBytesBefore.toString("utf8")) as {
      readonly presentation: {
        readonly layerCompatibility: { readonly segmentationApplied: boolean };
      };
    };
    expect(predecessorDocument.presentation.layerCompatibility.segmentationApplied).toBe(false);

    const immutableSnapshot = await contract.createInputHashSnapshot([
      contract.CANONICAL_PROJECT_PATHS.canonicalMaster,
      contract.CANONICAL_PROJECT_PATHS.predecessorManifest,
      contract.CANONICAL_PROJECT_PATHS.protectedCanvas,
    ], { projectRoot: PROJECT_ROOT });
    const packageDocument = JSON.parse(
      await readFile(resolve(PROJECT_ROOT, "package.json"), "utf8"),
    ) as PackageDocument;

    const symlinkTarget = resolve(stagingRoot, "review-input-target.json");
    const symlinkAbsolutePath = resolve(stagingRoot, SYMLINK_PATH);
    await mkdir(dirname(symlinkAbsolutePath), { recursive: true });
    await writeFile(symlinkTarget, Buffer.from("immutable symlink target\n"));
    await symlink(symlinkTarget, symlinkAbsolutePath);

    const effects: MutationEffects = { writes: 0 };
    const commit = async (absolutePath: string, payload: Buffer): Promise<void> => {
      effects.writes += 1;
      expect(isContainedPath(stagingRoot, absolutePath)).toBe(true);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, payload);
    };

    const propertyInputArbitrary = fc.record({
      failingGate: failingGateArbitrary,
      protectedMutation: protectedMutationArbitrary,
      scopeEscape: scopeEscapeArbitrary,
      successfulGate: successfulGateArbitrary,
      successorMutation: successorMutationArbitrary,
      unsafeMutation: unsafeMutationArbitrary,
    });

    await fc.assert(
      fc.asyncProperty(propertyInputArbitrary, async (input) => {
        const writesBeforeReadOnlyGates = effects.writes;
        const networkBefore = networkAttempts;

        await runSuccessfulGateOperation(
          contract,
          input.successfulGate,
          immutableSnapshot,
        );
        await runFailingGateOperation(
          contract,
          input.failingGate,
          immutableSnapshot,
          packageDocument,
        );
        expect(effects.writes).toBe(writesBeforeReadOnlyGates);
        expect(networkAttempts).toBe(networkBefore);

        const validPath = successorPath(input.successorMutation);
        const validPayload = Buffer.from(input.successorMutation.payload);
        const writesBeforeSuccessor = effects.writes;
        const validResult = await attemptBoundaryMutation(contract, {
          behavior: "write-successor-artifact",
          owner: "successor-package",
          payload: validPayload,
          target: validPath,
        }, {
          commit,
          projectRoot: stagingRoot,
          protectedIds,
        });
        expect(validResult).toMatchObject({ ok: true, path: validPath });
        expect(effects.writes).toBe(writesBeforeSuccessor + 1);
        if (validResult.ok) {
          expect(validResult.absolutePath).not.toBe(resolve(PROJECT_ROOT, validPath));
          expect(await readFile(validResult.absolutePath)).toEqual(validPayload);
        }

        const writesBeforeUnsafe = effects.writes;
        if (input.unsafeMutation.kind === "path") {
          const unsafeResult = await attemptBoundaryMutation(contract, {
            behavior: "write-successor-artifact",
            owner: "successor-package",
            payload: Buffer.from("must-not-be-written"),
            target: input.unsafeMutation.path,
          }, {
            commit,
            projectRoot: stagingRoot,
            protectedIds,
          });
          expect(unsafeResult).toMatchObject({
            code: contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
            ok: false,
            path: input.unsafeMutation.path,
          });
        } else {
          const targetBefore = await readFile(symlinkTarget);
          expect((await lstat(symlinkAbsolutePath)).isSymbolicLink()).toBe(true);
          const failure = await expectContractFailure(
            () => contract.inspectSafeRegularFile(input.unsafeMutation.path, {
              allowPublic: true,
              allowedRoots: successorRoots(contract),
              projectRoot: stagingRoot,
            }),
            contract.CONTRACT_FAILURE_CODES.PATH_INVALID,
          );
          expect(failure.path).toBe(input.unsafeMutation.path);
          expect(await readFile(symlinkTarget)).toEqual(targetBefore);
        }
        expect(effects.writes).toBe(writesBeforeUnsafe);

        const protectedIdsInOrder = [...protectedIds].sort();
        const protectedTarget = protectedIdsInOrder[
          input.protectedMutation.index % protectedIdsInOrder.length
        ];
        const protectedPayload = Buffer.from(
          `${input.protectedMutation.kind}:${input.protectedMutation.offset}:${input.protectedMutation.xor}`,
        );
        const writesBeforeProtected = effects.writes;
        const protectedResult = await attemptBoundaryMutation(contract, {
          behavior: "write-successor-artifact",
          owner: "successor-package",
          payload: protectedPayload,
          target: protectedTarget,
        }, {
          commit,
          projectRoot: stagingRoot,
          protectedIds,
        });
        expect(protectedResult).toEqual({
          code: contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
          message: "Mutation target belongs to the immutable predecessor boundary",
          ok: false,
          path: protectedTarget,
        });
        expect(effects.writes).toBe(writesBeforeProtected);

        const writesBeforeScopeEscape = effects.writes;
        const scopeResult = await attemptBoundaryMutation(contract, {
          behavior: input.scopeEscape.behavior,
          owner: input.scopeEscape.owner,
          payload: Buffer.from("must-remain-isolated"),
          target: "source/assets/watch-2-5d/v1/review/scope-probe.json",
        }, {
          commit,
          projectRoot: stagingRoot,
          protectedIds,
        });
        expect(scopeResult).toEqual({
          code: contract.CONTRACT_FAILURE_CODES.PROTECTED_ARTIFACT_CHANGED,
          message: "Mutation owner or behavior falls outside the successor extension boundary",
          ok: false,
          path: "source/assets/watch-2-5d/v1/review/scope-probe.json",
        });
        expect(effects.writes).toBe(writesBeforeScopeEscape);
        expect(networkAttempts).toBe(networkBefore);
      }),
      {
        numRuns: PROPERTY_RUNS,
        seed: PROPERTY_SEED,
        verbose: true,
      },
    );

    expect(createPreservationManifest(PROJECT_ROOT)).toEqual(protectedBefore);
    expect(await readFile(predecessorPath)).toEqual(predecessorBytesBefore);
    expect(
      (JSON.parse((await readFile(predecessorPath)).toString("utf8")) as {
        readonly presentation: {
          readonly layerCompatibility: { readonly segmentationApplied: boolean };
        };
      }).presentation.layerCompatibility.segmentationApplied,
    ).toBe(false);
    expect(await contract.assertInputHashSnapshotUnchanged(
      immutableSnapshot,
      { projectRoot: PROJECT_ROOT },
    )).toEqual(immutableSnapshot);
    expect(networkAttempts).toBe(0);
  } finally {
    if (fetchDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "fetch");
    } else {
      Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    }
    await rm(stagingRoot, { force: true, recursive: true });
  }
});
