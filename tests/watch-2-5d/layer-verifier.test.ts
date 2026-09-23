import { createHash } from "node:crypto";
import * as fs from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type VerificationFailure = Error & {
  readonly code: string;
  readonly failure: {
    readonly code: string;
    readonly issueCode: string;
    readonly ok: false;
    readonly path: string;
  };
  readonly issueCode: string;
  readonly path: string;
};

type VerificationResult = {
  readonly approvedMovingLayerIds: readonly string[];
  readonly completedGates: readonly string[];
  readonly depthEnabled: boolean;
  readonly networkRequests: 0;
  readonly ok: true;
  readonly packagePresent: boolean;
  readonly protectedEntryCount: number;
  readonly releaseStatus: "fallback-only" | "ready";
  readonly selectedPhase: string | null;
  readonly writes: 0;
};

type ApprovalClosureResult = {
  readonly eligible: boolean;
  readonly ok: boolean;
  readonly reason: string | null;
  readonly releasable: boolean;
};

type VerifierModule = {
  readonly WATCH_LAYER_GATE_ORDER: readonly string[];
  readonly WATCH_LAYER_VERIFY_ISSUE_CODES: Readonly<Record<string, string>>;
  evaluateWatchLayerApprovalRequirement(
    value: Readonly<Record<string, unknown>>,
    expectation: Readonly<Record<string, unknown>>,
  ): ApprovalClosureResult;
  parseWatchLayerVerifyArguments(argv: readonly string[]): Readonly<{
    readonly help?: boolean;
    readonly projectRoot?: string;
  }>;
  verifyWatchLayerAssets(options?: {
    readonly projectRoot?: string;
  }): Promise<VerificationResult>;
  withWatchLayerVerifierSandbox<T>(operation: () => Promise<T> | T): Promise<T>;
};

// @ts-expect-error -- executable ESM is explicitly typed above.
const verifier = (await import("../../scripts/verify-watch-layer-assets.mjs")) as unknown as VerifierModule;

const PROJECT_ROOT = process.cwd();
const IMMUTABLE_CHECK_PATHS = [
  "data/watch-image-asset.json",
  "data/watch-layer-release.json",
  "package.json",
  "source/assets/elite-watch-master.png",
  "source/assets/watch-2-5d/v1/authoring.json",
  "tests/fixtures/glass-header-hover-preservation.sha256",
] as const;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function captureFileIdentities(): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries(await Promise.all(IMMUTABLE_CHECK_PATHS.map(async (path) => [
    path,
    sha256(await readFile(resolve(PROJECT_ROOT, path))),
  ])));
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

async function captureFailure(operation: () => Promise<unknown>): Promise<VerificationFailure> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as VerificationFailure;
  }
  throw new Error("Expected watch-layer verification to fail");
}

describe("fixed-order read-only watch-layer verifier", () => {
  it("publishes the approved deterministic gate order", () => {
    expect(verifier.WATCH_LAYER_GATE_ORDER).toEqual([
      "predecessor",
      "protected-integrity",
      "schema-path",
      "identities",
      "provenance-approvals",
      "segmentation",
      "reconstruction",
      "fidelity-coverage",
      "motion",
      "depth",
      "public-assets-runtime-manifest",
      "budgets",
      "input-hashes",
    ]);
    expect(Object.isFrozen(verifier.WATCH_LAYER_GATE_ORDER)).toBe(true);
  });

  it("rejects approval supersets, partial bindings, non-evidence substitutes, decisions, and unrelated layers", () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const hashC = "c".repeat(64);
    const expectation = {
      approvalId: "approval-segmentation",
      artifactSha256: [hashA, hashB],
      layerIds: ["layer-wheel"],
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [200],
      scope: "segmentation",
    };
    const approved = {
      artifactSha256: [hashA, hashB],
      decision: "approved",
      id: "approval-segmentation",
      layerIds: ["layer-wheel"],
      notes: "Reviewed the exact current segmentation and evidence set.",
      reviewedAt: "2026-05-19T12:00:00.000Z",
      reviewedPoseIds: ["reference-pose"],
      reviewedZoomPercent: [200],
      reviewer: "fixture-reviewer",
      scope: "segmentation",
    };

    expect(verifier.evaluateWatchLayerApprovalRequirement(approved, expectation)).toMatchObject({
      eligible: true,
      ok: true,
      reason: null,
      releasable: true,
    });

    const invalidCases = [
      {
        record: { ...approved, artifactSha256: [hashA, hashB, hashC] },
        reason: "APPROVAL_HASH_MISMATCH",
      },
      {
        record: { ...approved, artifactSha256: [hashA] },
        reason: "APPROVAL_HASH_MISMATCH",
      },
      {
        record: { ...approved, artifactSha256: [hashA, hashC] },
        reason: "APPROVAL_HASH_MISMATCH",
      },
      {
        record: { ...approved, layerIds: ["layer-unrelated", "layer-wheel"] },
        reason: "APPROVAL_LAYER_MISMATCH",
      },
      {
        record: {
          ...approved,
          decision: "pending",
          reviewedAt: null,
          reviewer: null,
        },
        reason: "APPROVAL_DECISION_PENDING",
      },
      {
        record: { ...approved, decision: "rejected" },
        reason: "APPROVAL_DECISION_REJECTED",
      },
    ];
    for (const { record, reason } of invalidCases) {
      expect(verifier.evaluateWatchLayerApprovalRequirement(record, expectation)).toMatchObject({
        eligible: false,
        ok: false,
        reason,
        releasable: false,
      });
    }
  });

  it("accepts the checked-in URL-free fallback and preserves inspected bytes", async () => {
    const successorPackage = resolve(PROJECT_ROOT, "data/watch-layer-package.json");
    const successorPublicRoot = resolve(PROJECT_ROOT, "public/assets/watch-2-5d/v1");
    const before = await captureFileIdentities();

    expect(await pathExists(successorPackage)).toBe(false);
    expect(await pathExists(successorPublicRoot)).toBe(false);

    const result = await verifier.verifyWatchLayerAssets({ projectRoot: PROJECT_ROOT });

    expect(result).toMatchObject({
      approvedMovingLayerIds: [],
      completedGates: verifier.WATCH_LAYER_GATE_ORDER,
      depthEnabled: false,
      networkRequests: 0,
      ok: true,
      packagePresent: false,
      releaseStatus: "fallback-only",
      selectedPhase: null,
      writes: 0,
    });
    expect(result.protectedEntryCount).toBeGreaterThan(0);
    expect(await captureFileIdentities()).toEqual(before);
    expect(await pathExists(successorPackage)).toBe(false);
    expect(await pathExists(successorPublicRoot)).toBe(false);
  }, 60_000);

  it("blocks filesystem mutation and network access, then restores both capabilities", async () => {
    const root = await mkdtemp(join(tmpdir(), "watch-layer-verifier-sandbox-"));
    const forbiddenPath = resolve(root, "forbidden.txt");
    const originalWriteFileSync = fs.writeFileSync;
    const originalFetch = globalThis.fetch;

    try {
      const mutationFailure = await captureFailure(() => (
        verifier.withWatchLayerVerifierSandbox(() => {
          fs.writeFileSync(forbiddenPath, "forbidden");
        })
      ));
      expect(mutationFailure).toMatchObject({
        code: "LAYER_INPUT_CHANGED",
        issueCode: verifier.WATCH_LAYER_VERIFY_ISSUE_CODES.FILESYSTEM_MUTATION_FORBIDDEN,
        name: "WatchLayerVerificationError",
      });
      expect(await pathExists(forbiddenPath)).toBe(false);
      expect(fs.writeFileSync).toBe(originalWriteFileSync);

      const networkFailure = await captureFailure(() => (
        verifier.withWatchLayerVerifierSandbox(async () => {
          await globalThis.fetch("https://example.invalid/watch-layer-verifier");
        })
      ));
      expect(networkFailure).toMatchObject({
        code: "LAYER_PATH_INVALID",
        issueCode: verifier.WATCH_LAYER_VERIFY_ISSUE_CODES.NETWORK_FORBIDDEN,
        name: "WatchLayerVerificationError",
      });
      expect(globalThis.fetch).toBe(originalFetch);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports predecessor failure before every later fault for an empty project", async () => {
    const root = await mkdtemp(join(tmpdir(), "watch-layer-verifier-precedence-"));
    try {
      const failure = await captureFailure(() => (
        verifier.verifyWatchLayerAssets({ projectRoot: root })
      ));
      expect(failure).toMatchObject({
        code: "LAYER_PREDECESSOR_INVALID",
        issueCode: verifier.WATCH_LAYER_VERIFY_ISSUE_CODES.PREDECESSOR_INVALID,
        name: "WatchLayerVerificationError",
        path: "data/watch-image-asset.json",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects malformed CLI arguments without beginning verification", () => {
    expect(verifier.parseWatchLayerVerifyArguments([])).toEqual({});
    expect(verifier.parseWatchLayerVerifyArguments(["--help"])).toEqual({ help: true });
    expect(() => verifier.parseWatchLayerVerifyArguments([
      "--project-root",
      PROJECT_ROOT,
      "--project-root",
      PROJECT_ROOT,
    ])).toThrowError(expect.objectContaining({
      code: "LAYER_SCHEMA_INVALID",
      issueCode: verifier.WATCH_LAYER_VERIFY_ISSUE_CODES.ARGUMENT_INVALID,
    }));
  });
});
