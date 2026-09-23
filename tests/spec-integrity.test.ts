import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPreservationManifest,
  formatPreservationManifest,
} from "./helpers/integrity-manifest";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/glass-header-hover-preservation.sha256",
);

const EXPECTED_HISTORICAL_SPEC_FILES = [
  ".kiro/specs/ai-coding-dictionary-inspired-site/.config.kiro",
  ".kiro/specs/ai-coding-dictionary-inspired-site/design.md",
  ".kiro/specs/ai-coding-dictionary-inspired-site/requirements.md",
  ".kiro/specs/ai-coding-dictionary-inspired-site/tasks.md",
  ".kiro/specs/ai-coding-dictionary-inspired-site/tasks.meta.json",
] as const;

const EXPECTED_PREDECESSOR_SPEC_FILES = [
  ".kiro/specs/animated-watch-image-glass-header/.config.kiro",
  ".kiro/specs/animated-watch-image-glass-header/design.md",
  ".kiro/specs/animated-watch-image-glass-header/requirements.md",
  ".kiro/specs/animated-watch-image-glass-header/tasks.md",
  ".kiro/specs/animated-watch-image-glass-header/tasks.meta.json",
] as const;

const EXPECTED_CANONICAL_MASTER_ENTRY = {
  digest: "7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b",
  id: "source/assets/elite-watch-master.png",
} as const;

const EXPECTED_PREDECESSOR_ASSET_CONTRACT_ENTRIES = [
  {
    digest: "8ade853f5bdccb9b60091b724e6366776093ca4d1a71d4b79d7bb2a026ed4c6c",
    id: "data/watch-image-asset.json",
  },
  {
    digest: "68a5f48a7c7d9cf99e1ed7335581c9961d98aa1a2a0305052c317cf5d7aaf00c",
    id: "public/assets/watch/elite-watch-1035.avif",
  },
  {
    digest: "31b7ed2c833da4f831a798aad3650afa735fa4e5ed954a685de38f404d2ded2c",
    id: "public/assets/watch/elite-watch-1035.webp",
  },
  {
    digest: "d79051a7dcf3b1c9fc46b6f1e9c7fdfc8bd5b521b7fee31e71d0eaee7c611826",
    id: "public/assets/watch/elite-watch-1380.avif",
  },
  {
    digest: "a9ea33b608279bdb31cca27d1cd6907fab34f4a0ca4257cd89d005d005d60e50",
    id: "public/assets/watch/elite-watch-1380.webp",
  },
  {
    digest: "2e65b63e8da875afea6470584cf02e5460c56521f4d0225e62f84170f87c62ca",
    id: "public/assets/watch/elite-watch-2070.avif",
  },
  {
    digest: "d3219aed27ee3f64fa6fd9e5f56caf8d8b20fcaf43e07039bb15a7cd90bf4f29",
    id: "public/assets/watch/elite-watch-2070.webp",
  },
  {
    digest: "63bd6548338fd8496a5e7fa4d4aa78b9a5de560d15c25b1af39cc90f4865b4d0",
    id: "public/assets/watch/elite-watch-2760.avif",
  },
  {
    digest: "f045d1c86290c57b3fd244f9d1d02071be04ea679603b9980737e8c52ab38f9e",
    id: "public/assets/watch/elite-watch-2760.webp",
  },
  {
    digest: "09385f38159761efc864801ecc7ef6371427279c56af1a9602b7dbd2b3316c10",
    id: "public/assets/watch/elite-watch-690.avif",
  },
  {
    digest: "2d0d78a8cce178c1a4f2ca5e32f7ca2158fb32aa13809d87e1192887a26b84c5",
    id: "public/assets/watch/elite-watch-690.webp",
  },
] as const;

const EXPECTED_DEPENDENCY_FIELD_ENTRIES = [
  {
    digest: "7e7d2505d0935b2c3a948da2b730ef366a05996d6eac58e05aa37a6c6842c5ad",
    id: "package.json#dependencies",
  },
  {
    digest: "3a7917869ae2f40a062971be4d01f74c9b9a6e3e1c693d188d3f61aa50f4a261",
    id: "package.json#devDependencies",
  },
] as const;

describe("glass-header hover preservation integrity", () => {
  it("matches the checked-in historical-spec, watch-canvas, and watch-CSS manifest", () => {
    const manifest = createPreservationManifest();
    const ids = manifest.map(({ id }) => id);
    const historicalIds = ids.filter((id) => (
      id.startsWith(".kiro/specs/ai-coding-dictionary-inspired-site/")
    ));
    const watchCssIds = ids.filter((id) => id.startsWith("app/globals.css#"));

    expect(historicalIds).toEqual(EXPECTED_HISTORICAL_SPEC_FILES);
    expect(ids).toContain("components/canvas/WatchMovementCanvas.tsx");
    expect(watchCssIds.length).toBeGreaterThan(0);
    expect(watchCssIds.every((id) => (
      /(?:watch-(?:canvas-shell|static-fallback)|static-(?:case|gear|balance|bridge|jewel))/.test(id)
    ))).toBe(true);
    expect(ids).not.toContain("app/globals.css");
    expect(watchCssIds.some((id) => id.includes("site-masthead"))).toBe(false);
    expect(watchCssIds.some((id) => id.includes("connection-particle"))).toBe(false);

    expect(formatPreservationManifest(manifest)).toBe(readFileSync(fixturePath, "utf8"));
  });

  it("extends coverage to the immutable predecessor and dependency contract", () => {
    const manifest = createPreservationManifest();
    const entriesById = new Map(manifest.map((entry) => [entry.id, entry]));
    const predecessorSpecIds = manifest
      .filter(({ id }) => id.startsWith(".kiro/specs/animated-watch-image-glass-header/"))
      .map(({ id }) => id);
    const predecessorAssetContractEntries = manifest.filter(({ id }) => (
      id === "data/watch-image-asset.json" || id.startsWith("public/assets/watch/")
    ));
    const dependencyFieldEntries = manifest.filter(({ id }) => id.startsWith("package.json#"));

    expect(predecessorSpecIds).toEqual(EXPECTED_PREDECESSOR_SPEC_FILES);
    expect(entriesById.get(EXPECTED_CANONICAL_MASTER_ENTRY.id)).toEqual(
      EXPECTED_CANONICAL_MASTER_ENTRY,
    );
    expect(predecessorAssetContractEntries).toEqual(
      EXPECTED_PREDECESSOR_ASSET_CONTRACT_ENTRIES,
    );
    expect(dependencyFieldEntries).toEqual(EXPECTED_DEPENDENCY_FIELD_ENTRIES);

    const predecessorManifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "data/watch-image-asset.json"), "utf8"),
    );
    expect(predecessorManifest.presentation.layerCompatibility.segmentationApplied).toBe(false);
  });
});
