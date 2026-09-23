import { render } from "@testing-library/react";
import fc from "fast-check";
import { expect, it } from "vitest";
import { WatchImageBackdrop } from "@/components/ui/WatchImageBackdrop";

const PROPERTY_TAG =
  "Feature: animated-watch-image-glass-header, Property 4: Static mode and whole-image transform invariant";

// Reproduce with: seed=20250318, numRuns=128.
const PROPERTY_SEED = 20_250_318;
const PROPERTY_RUNS = 128;

const FORBIDDEN_PART_LAYER_SELECTOR = [
  "[data-depth]",
  "[data-part]",
  "[data-region]",
  "[data-watch-part]",
  "[data-watch-region]",
  '[class*="watch-image-backdrop__layer"]',
  '[class*="watch-image-backdrop__part"]',
  '[class*="watch-image-backdrop__region"]',
].join(", ");

type GeneratedLoadState = "error" | "loading" | "ready";

const modeCaseArbitrary = fc.record({
  definitionOpen: fc.boolean(),
  loadState: fc.constantFrom<GeneratedLoadState>("loading", "ready", "error"),
  reducedMotion: fc.boolean(),
});

function requireElement<T extends Element>(
  parent: ParentNode,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector);
  expect(element, `Expected ${selector} to exist`).not.toBeNull();
  return element as T;
}

// Static WebP backdrop is globally persistent and does not have load states
it(PROPERTY_TAG, () => {
  fc.assert(
    fc.property(modeCaseArbitrary, ({
      definitionOpen,
      reducedMotion,
    }) => {
      const rendered = render(
        <WatchImageBackdrop
          definitionOpen={definitionOpen}
          reducedMotion={reducedMotion}
        />,
      );

      try {
        const backdrop = requireElement<HTMLElement>(
          rendered.container,
          ".watch-image-backdrop",
        );
        const img = requireElement<HTMLImageElement>(backdrop, "img.watch-image-backdrop__image");

        expect(img).toBeDefined();
        expect(img.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
        expect(img.getAttribute("aria-hidden")).toBe("true");
        expect(img.className).toContain("watch-image-backdrop__image");
        expect(img.className).toContain("object-cover");
        expect(img.className).toContain("-z-10");

        expect(backdrop.querySelectorAll("picture")).toHaveLength(0);
        expect(backdrop.querySelectorAll("video")).toHaveLength(0);
        expect(backdrop.querySelectorAll("img.watch-image-backdrop__image")).toHaveLength(1);
        expect(backdrop.querySelector("img.watch-image-backdrop__image")).toBe(img);
        expect(backdrop.querySelectorAll("canvas")).toHaveLength(0);
        expect(backdrop.querySelectorAll(FORBIDDEN_PART_LAYER_SELECTOR)).toHaveLength(0);

        expect(backdrop).toHaveAttribute(
          "data-reduced-motion",
          String(reducedMotion),
        );
        expect(backdrop).toHaveAttribute(
          "data-definition-open",
          String(definitionOpen),
        );

        expect(img.getAttribute("aria-hidden")).toBe("true");
      } finally {
        rendered.unmount();
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
