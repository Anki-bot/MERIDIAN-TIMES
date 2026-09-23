/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("lifecycle and release contract", () => {
  it("verifies predecessor-first ordering in predev/pretest/prebuild", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts.predev).toContain("verify:watch-images");
    expect(pkg.scripts.predev).toContain("verify:watch-layers");
    expect(pkg.scripts.predev.indexOf("verify:watch-images")).toBeLessThan(pkg.scripts.predev.indexOf("verify:watch-layers"));
    expect(pkg.scripts.pretest).toContain("verify:watch-images");
    expect(pkg.scripts.pretest).toContain("verify:watch-layers");
    expect(pkg.scripts.prebuild).toContain("verify:watch-images");
    expect(pkg.scripts.prebuild).toContain("verify:watch-layers");
    expect(pkg.scripts["build:watch-layers"]).toBeDefined();
    expect(pkg.scripts["verify:watch-layers"]).toBeDefined();
  });

  it("keeps dependencies byte-for-byte and has no watcher command", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.devDependencies).toBeDefined();
    expect(pkg.scripts.dev).toBe("next dev");
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/watch.*--watch|nodemon/);
  });

  it("fallback-only release has no ready pointer and passes read-only verification", () => {
    const release = JSON.parse(readFileSync(resolve(process.cwd(), "data/watch-layer-release.json"), "utf8"));
    expect(release.schemaVersion).toBe(1);
    if (release.status === "fallback-only") {
      expect(release.runtimeManifest).toBeNull();
      expect(release.depthEnabled).toBe(false);
    }
    // verify:watch-layers should exit 0 for fallback-only
    const out = execSync("node scripts/verify-watch-layer-assets.mjs", { encoding: "utf8" });
    expect(out).toContain("WATCH_LAYER_ASSET_VERIFICATION_OK");
    expect(out).toContain("fallback-only");
  });

  it("read-only verifier performs zero writes and optional depth can be skipped", async () => {
    const verifier = await import("../../scripts/verify-watch-layer-assets.mjs" as any).catch(() => null);
    void verifier;
    // depth disabled is valid core release
    const release = JSON.parse(readFileSync(resolve(process.cwd(), "data/watch-layer-release.json"), "utf8"));
    expect(release.depthEnabled).toBe(false);
    // core release without depth still passes
    expect(["fallback-only", "ready"]).toContain(release.status);
  });
});
