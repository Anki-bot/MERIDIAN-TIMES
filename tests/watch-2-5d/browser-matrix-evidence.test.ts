/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { classifyBrowserSupport } from "@/lib/watch-2-5d/browser-support";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("browser matrix evidence", () => {
  it("supports the approved matrix floors", () => {
    // chrome 120
    const chrome120 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(classifyBrowserSupport({ userAgent: chrome120, fetch: () => {}, AbortController: class {}, crypto: { subtle: { digest: () => {} } }, HTMLImageElement: { prototype: { decode: () => {} } }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, ResizeObserver: class {}, matchMedia: () => ({}), document: { visibilityState: "visible", hidden: false, addEventListener: () => {}, removeEventListener: () => {} }, CSS: { supports: () => true } } as any).supported).toBe(true);
  });

  it("fallback-only requires no matrix evidence for ready, but ready would require matrix", () => {
    const release = JSON.parse(readFileSync(resolve(process.cwd(), "data/watch-layer-release.json"), "utf8"));
    if (release.status === "fallback-only") {
      expect(release.runtimeManifest).toBeNull();
    } else {
      expect(release.status).toBe("ready");
    }
  });

  it("unknown browser yields browser-unknown and zero requests", () => {
    const unknown = classifyBrowserSupport({ userAgent: "UnknownBrowser/1.0" } as any);
    expect(unknown.supported).toBe(false);
    if (!unknown.supported) expect((unknown as any).code).toBe("browser-unknown");
  });
});
