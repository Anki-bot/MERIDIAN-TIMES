import { render } from "@testing-library/react";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { EliteWatchesExperience } from "@/components/EliteWatchesExperience";
import { WatchImageBackdrop } from "@/components/ui/WatchImageBackdrop";
import { dictionaryTerms } from "@/lib/dictionary";

vi.mock("@/components/canvas/WatchMovementCanvas", () => ({
  WatchMovementCanvas: () => {
    throw new Error("WatchMovementCanvas must not be mounted by EliteWatchesExperience.");
  },
}));

const PROPERTY_TAG =
  "Feature: animated-watch-image-glass-header, Property 2: Sole responsive hero-medium invariant";

// Reproduce with: seed=20250333, numRuns=128.
const PROPERTY_SEED = 20_250_333;
const PROPERTY_RUNS = 128;

const propertyInputArbitrary = fc.record({
  definitionOpen: fc.boolean(),
  reducedMotion: fc.boolean(),
  viewportWidth: fc.integer({ min: 320, max: 2560 }),
});

function assertSoleStaticHeroTree(container: HTMLElement) {
  const backdrops = container.querySelectorAll<HTMLElement>(".watch-image-backdrop");
  expect(backdrops).toHaveLength(1);

  const backdrop = backdrops[0];
  const imgs = backdrop.querySelectorAll<HTMLImageElement>("img.watch-image-backdrop__image");
  expect(imgs).toHaveLength(1);
  expect(container.querySelectorAll("img.watch-image-backdrop__image")).toHaveLength(1);
  expect(container.querySelectorAll("video")).toHaveLength(0);
  expect(container.querySelectorAll("picture")).toHaveLength(0);
  expect(container.querySelectorAll("canvas")).toHaveLength(0);
  expect(container.querySelector(".watch-canvas-shell")).not.toBeInTheDocument();

  const img = imgs[0];
  expect(img.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
  expect(img.getAttribute("aria-hidden")).toBe("true");
  expect(img.className).toContain("watch-image-backdrop__image");
  expect(img.className).toContain("object-cover");

  return { backdrop, img };
}

// **Validates: Requirements 2.1–2.5, 2.10, 9.2 - now static WebP backdrop**
it(PROPERTY_TAG, () => {
  const experience = render(<EliteWatchesExperience terms={dictionaryTerms} />);
  try {
    const { img } = assertSoleStaticHeroTree(experience.container);
    expect(img.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
    expect(experience.container.innerHTML).not.toContain("elite-watch-master.png");
  } finally {
    experience.unmount();
  }

  fc.assert(
    fc.property(propertyInputArbitrary, (input) => {
      const previousWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: input.viewportWidth,
      });

      const rendered = render(
        <WatchImageBackdrop
          definitionOpen={input.definitionOpen}
          reducedMotion={input.reducedMotion}
        />,
      );

      try {
        const { backdrop, img } = assertSoleStaticHeroTree(rendered.container);
        expect(backdrop).toHaveAttribute(
          "data-definition-open",
          String(input.definitionOpen),
        );
        expect(backdrop).toHaveAttribute(
          "data-reduced-motion",
          String(input.reducedMotion),
        );
        expect(img).toBeDefined();
        expect(backdrop.className).toContain("-z-10");
      } finally {
        rendered.unmount();
        if (previousWidth) {
          Object.defineProperty(window, "innerWidth", previousWidth);
        } else {
          Reflect.deleteProperty(window, "innerWidth");
        }
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
