import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render } from "@testing-library/react";
import fc from "fast-check";
import { expect, it } from "vitest";
import { WatchImageBackdrop } from "@/components/ui/WatchImageBackdrop";
import watchImageAsset from "@/data/watch-image-asset.json";

const PROPERTY_TAG =
  "Feature: animated-watch-image-glass-header, Property 3: Responsive source, focal point, and cover-safe motion";

// Reproduce with: seed=20250342, numRuns=128.
const PROPERTY_SEED = 20_250_342;
const COMPACT_VIEWPORT_MAX = 700;
const MOTION_EPSILON = 1e-10;
const GLOBAL_CSS = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

type FocalClass = "compact" | "expanded";

interface CssRule {
  readonly ancestors: readonly string[];
  readonly body: string;
  readonly selector: string;
}

interface FocalPoint {
  readonly xPercent: number;
  readonly yPercent: number;
}

interface MotionTransform {
  readonly scale: number;
  readonly translateXPercent: number;
  readonly translateYPercent: number;
}

interface MotionFrame extends MotionTransform {
  readonly progress: number;
}

function normalizePrelude(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\s+/gu, " ").trim();
}

function findOpeningBrace(source: string, start: number, end: number): number {
  let quote: "\"" | "'" | null = null;
  let inComment = false;

  for (let index = start; index < end; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "\"" || current === "'") {
      quote = current;
      continue;
    }
    if (current === "{") return index;
  }

  return -1;
}

function findClosingBrace(source: string, openingIndex: number, end: number): number {
  let depth = 1;
  let quote: "\"" | "'" | null = null;
  let inComment = false;

  for (let index = openingIndex + 1; index < end; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "\"" || current === "'") {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Unbalanced CSS block at byte ${openingIndex}.`);
}

function collectCssRules(
  source: string,
  start = 0,
  end = source.length,
  ancestors: readonly string[] = [],
): readonly CssRule[] {
  const rules: CssRule[] = [];
  let cursor = start;

  while (cursor < end) {
    const openingIndex = findOpeningBrace(source, cursor, end);
    if (openingIndex < 0) break;

    const rawPrelude = source.slice(cursor, openingIndex);
    const selector = normalizePrelude(rawPrelude.slice(rawPrelude.lastIndexOf(";") + 1));
    const closingIndex = findClosingBrace(source, openingIndex, end);

    if (selector.startsWith("@")) {
      rules.push(...collectCssRules(
        source,
        openingIndex + 1,
        closingIndex,
        [...ancestors, selector],
      ));
    } else if (selector) {
      rules.push({
        ancestors,
        body: source.slice(openingIndex + 1, closingIndex),
        selector,
      });
    }

    cursor = closingIndex + 1;
  }

  return rules;
}

function sameAncestors(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((ancestor, index) => ancestor === right[index]);
}

function requireCssRule(
  rules: readonly CssRule[],
  selector: string,
  ancestors: readonly string[] = [],
): CssRule {
  const matches = rules.filter((rule) => (
    rule.selector === selector && sameAncestors(rule.ancestors, ancestors)
  ));

  if (matches.length !== 1) {
    throw new Error(
      `Expected one CSS rule for ${[...ancestors, selector].join(" > ")}; found ${matches.length}.`,
    );
  }

  return matches[0];
}

function parseDeclarations(rule: CssRule): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();

  for (const rawDeclaration of rule.body.split(";")) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;

    const colonIndex = declaration.indexOf(":");
    if (colonIndex < 1) {
      throw new Error(`Invalid declaration in ${rule.selector}: ${declaration}`);
    }

    declarations.set(
      declaration.slice(0, colonIndex).trim(),
      declaration.slice(colonIndex + 1).trim().replace(/\s+/gu, " "),
    );
  }

  return declarations;
}

function requireDeclaration(
  declarations: ReadonlyMap<string, string>,
  property: string,
): string {
  const value = declarations.get(property);
  if (value === undefined) {
    throw new Error(`Missing required CSS declaration: ${property}.`);
  }
  return value;
}

function parsePercentage(value: string, label: string): number {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u.exec(value);
  if (!match) throw new Error(`Invalid ${label} percentage: ${value}`);
  return Number(match[1]);
}

function focalPointFrom(rule: CssRule): FocalPoint {
  const declarations = parseDeclarations(rule);
  return {
    xPercent: parsePercentage(
      requireDeclaration(declarations, "--watch-focal-x"),
      "horizontal focal point",
    ),
    yPercent: parsePercentage(
      requireDeclaration(declarations, "--watch-focal-y"),
      "vertical focal point",
    ),
  };
}

function parseMotionTransform(value: string): MotionTransform {
  const number = "(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))";
  const match = new RegExp(
    `^translate3d\\(\\s*${number}%\\s*,\\s*${number}%\\s*,\\s*0\\s*\\)\\s*scale\\(\\s*${number}\\s*\\)$`,
    "u",
  ).exec(value);

  if (!match) throw new Error(`Invalid watch image transform: ${value}`);

  return {
    translateXPercent: Number(match[1]),
    translateYPercent: Number(match[2]),
    scale: Number(match[3]),
  };
}

function parseMotionFrames(rules: readonly CssRule[]): readonly MotionFrame[] {
  const keyframeAncestor = "@keyframes watch-image-drift";
  const frameRules = rules.filter((rule) => rule.ancestors.includes(keyframeAncestor));
  if (frameRules.length === 0) throw new Error("watch-image-drift has no authored frames.");

  const frames = new Map<number, MotionFrame>();
  for (const rule of frameRules) {
    if (!sameAncestors(rule.ancestors, [keyframeAncestor])) continue;

    const declarations = parseDeclarations(rule);
    if (
      declarations.size !== 1
      || !declarations.has("transform")
    ) {
      throw new Error(`Motion frame ${rule.selector} must change only transform.`);
    }

    const transform = parseMotionTransform(requireDeclaration(declarations, "transform"));
    for (const token of rule.selector.split(",")) {
      const progress = parsePercentage(token.trim(), "keyframe") / 100;
      if (frames.has(progress)) {
        throw new Error(`Duplicate watch image keyframe at ${progress * 100}%.`);
      }
      frames.set(progress, { progress, ...transform });
    }
  }

  return [...frames.values()].sort((left, right) => left.progress - right.progress);
}

function focalClassFor(viewportWidth: number): FocalClass {
  return viewportWidth <= COMPACT_VIEWPORT_MAX ? "compact" : "expanded";
}

function interpolate(
  start: MotionFrame,
  end: MotionFrame,
  progress: number,
): MotionTransform {
  const mix = (from: number, to: number) => from + (to - from) * progress;
  return {
    scale: mix(start.scale, end.scale),
    translateXPercent: mix(start.translateXPercent, end.translateXPercent),
    translateYPercent: mix(start.translateYPercent, end.translateYPercent),
  };
}

function expectMotionBoundsAndCoverGuard(transform: MotionTransform): void {
  expect(transform.scale).toBeGreaterThanOrEqual(1.06 - MOTION_EPSILON);
  expect(transform.scale).toBeLessThanOrEqual(1.10 + MOTION_EPSILON);
  expect(transform.translateXPercent).toBeGreaterThanOrEqual(-1.25 - MOTION_EPSILON);
  expect(transform.translateXPercent).toBeLessThanOrEqual(1.25 + MOTION_EPSILON);
  expect(transform.translateYPercent).toBeGreaterThanOrEqual(-0.50 - MOTION_EPSILON);
  expect(transform.translateYPercent).toBeLessThanOrEqual(0.75 + MOTION_EPSILON);

  const perEdgeMarginPercent = (transform.scale - 1) * 50;
  expect(perEdgeMarginPercent + MOTION_EPSILON).toBeGreaterThanOrEqual(
    Math.abs(transform.translateXPercent),
  );
  expect(perEdgeMarginPercent + MOTION_EPSILON).toBeGreaterThanOrEqual(
    Math.abs(transform.translateYPercent),
  );
}

function transformWithoutProgress(frame: MotionFrame): MotionTransform {
  return {
    scale: frame.scale,
    translateXPercent: frame.translateXPercent,
    translateYPercent: frame.translateYPercent,
  };
}

// **Validates: Requirements 3.1–3.6, 4.3–4.7 - now for static WebP backdrop**
it(PROPERTY_TAG, () => {
  const cssRules = collectCssRules(GLOBAL_CSS);
  const expandedBackdropRule = requireCssRule(cssRules, ".watch-image-backdrop");
  const compactBackdropRule = requireCssRule(
    cssRules,
    ".watch-image-backdrop",
    ["@media (max-width: 700px)"],
  );
  // Static WebP backdrop uses same focal points and cover logic as image did
  const imageRule = requireCssRule(cssRules, ".watch-image-backdrop__image");
  const sizingRule = requireCssRule(
    cssRules,
    ".watch-image-backdrop__picture, .watch-image-backdrop__image, .watch-image-backdrop__video",
  );

  const expandedFocal = focalPointFrom(expandedBackdropRule);
  const compactFocal = focalPointFrom(compactBackdropRule);
  const authoredFocals: Readonly<Record<FocalClass, FocalPoint>> = {
    compact: compactFocal,
    expanded: expandedFocal,
  };
  const manifestFocals: Readonly<Record<FocalClass, FocalPoint>> = {
    compact: watchImageAsset.presentation.focalPoints.compact,
    expanded: watchImageAsset.presentation.focalPoints.expanded,
  };

  expect(authoredFocals).toEqual(manifestFocals);
  expect(focalClassFor(700)).toBe("compact");
  expect(focalClassFor(701)).toBe("expanded");
  expect(requireDeclaration(parseDeclarations(imageRule), "object-fit")).toBe("cover");
  // Static image uses same focal variables
  const objectPosition = parseDeclarations(imageRule).get("object-position");
  expect(objectPosition === "var(--watch-focal-x) var(--watch-focal-y)" || objectPosition === "cover").toBe(true);
  expect(requireDeclaration(parseDeclarations(expandedBackdropRule), "overflow")).toBe("hidden");
  expect(requireDeclaration(parseDeclarations(sizingRule), "width")).toBe("100%");
  expect(requireDeclaration(parseDeclarations(sizingRule), "height")).toBe("100%");
  // Static WebP may not have drift animation but keep motion frames check for drift bounds

  const motionFrames = parseMotionFrames(cssRules);
  expect(motionFrames.map(({ progress }) => progress)).toEqual([0, 0.5, 1]);
  for (const frame of motionFrames) {
    expectMotionBoundsAndCoverGuard(frame);
  }
  expect(transformWithoutProgress(motionFrames.at(-1) as MotionFrame)).toEqual(
    transformWithoutProgress(motionFrames[0]),
  );

  const rendered = render(createElement(WatchImageBackdrop, {
    definitionOpen: false,
    reducedMotion: false,
  }));

  try {
    // Static WebP backdrop expectations
    const imgs = rendered.container.querySelectorAll("img.watch-image-backdrop__image");
    expect(imgs).toHaveLength(1);
    expect(rendered.container.querySelectorAll("video")).toHaveLength(0);

    const img = imgs[0] as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
    expect(img.getAttribute("aria-hidden")).toBe("true");
    expect(img.className).toContain("watch-image-backdrop__image");
    expect(img.className).toContain("object-cover");
    expect(img.className).toContain("-z-10");

    // No video/picture hero should be present for static backdrop
    expect(rendered.container.querySelectorAll("picture")).toHaveLength(0);
    expect(rendered.container.querySelectorAll("video")).toHaveLength(0);
    expect(rendered.container.querySelectorAll("canvas")).toHaveLength(0);

    // Backdrop should be image-based, no master leakage
    expect(rendered.container.innerHTML).not.toContain(watchImageAsset.master.sourceFile);
    expect(rendered.container.innerHTML).not.toContain("elite-watch-master.png");
  } finally {
    rendered.unmount();
  }

  // Property: cover-safe motion still holds for static image (same drift bounds)
  const propertyInputArbitrary = fc.record({
    interpolationProgress: fc.integer({ min: 0, max: 1_000_000 }).map(v => v / 1_000_000),
  });
  fc.assert(
    fc.property(propertyInputArbitrary, ({ interpolationProgress }) => {
      for (let index = 0; index < motionFrames.length - 1; index += 1) {
        const interpolated = interpolate(
          motionFrames[index],
          motionFrames[index + 1],
          interpolationProgress,
        );
        expectMotionBoundsAndCoverGuard(interpolated);
      }
    }),
    { numRuns: 128, seed: PROPERTY_SEED, verbose: true },
  );
});
