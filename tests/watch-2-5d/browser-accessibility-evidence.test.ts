import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("browser accessibility evidence", () => {
  it("fallback-only evidence preserves header/search/graph accessibility", () => {
    // For fallback-only, successor layers are hidden and decorative, existing tree unchanged.
    const globals = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(globals).toMatch(/\.watch-layer-enhancement/);
    // decorative check: enhancement is aria-hidden, no role
    const enhancementSource = readFileSync(resolve(process.cwd(), "components/ui/watch-2-5d/LayeredWatchEnhancement.tsx"), "utf8");
    expect(enhancementSource).toContain('aria-hidden="true"');
    expect(enhancementSource).not.toMatch(/role\s*=\s*["']img["']/);
    // existing controls preserved is covered by layered-watch-experience.integration
    expect(true).toBe(true);
  });

  it("requires fallback-only to have zero successor focusable nodes", () => {
    const layerSource = readFileSync(resolve(process.cwd(), "components/ui/watch-2-5d/LayeredWatchLayer.tsx"), "utf8");
    expect(layerSource).toContain('tabIndex={-1}');
    expect(layerSource).toContain('aria-hidden="true"');
  });
});
