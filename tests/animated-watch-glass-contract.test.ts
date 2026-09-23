import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsPath = resolve(process.cwd(), "app/globals.css");
const smokePath = resolve(process.cwd(), "scripts/atlas-visibility-smoke.mjs");
const css = readFileSync(globalsPath, "utf8");
const smoke = readFileSync(smokePath, "utf8");

interface CssRule {
  readonly ancestors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
  readonly selector: string;
}

interface MotionFrame {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

const AUDITED_OVERLAYS = [
  "site-masthead",
  "search-pill",
  "search-results",
  "definition-layer",
  "definition-panel",
  "definition-panel__footer",
] as const;
const PROTECTED_SELECTOR_PATTERN = /\.(?:watch-(?:canvas-shell|static-fallback)|static-(?:case|gear|balance|bridge|jewel))[\w-]*/;
const FEATURE_SELECTOR_PATTERN = /\.(?:watch-image-backdrop(?:__[\w-]+)?|cinematic-vignette|site-masthead|masthead-nav|wordmark)(?=[\s.:#[>+~,]|$)/;

function normalizePrelude(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

function findOpeningBrace(source: string, start: number, end: number): number {
  let quote: "'" | '"' | null = null;
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
    if (current === "'" || current === '"') quote = current;
    else if (current === "{") return index;
  }
  return -1;
}

function findClosingBrace(source: string, openingIndex: number, end: number): number {
  let depth = 1;
  let quote: "'" | '"' | null = null;
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
    if (current === "'" || current === '"') quote = current;
    else if (current === "{") depth += 1;
    else if (current === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced CSS block at byte ${openingIndex}`);
}

function declarationsByName(block: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of block.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    declarations.set(
      declaration.slice(0, separator).trim().toLowerCase(),
      declaration.slice(separator + 1).trim(),
    );
  }
  return declarations;
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
    const prelude = normalizePrelude(rawPrelude.slice(rawPrelude.lastIndexOf(";") + 1));
    const closingIndex = findClosingBrace(source, openingIndex, end);
    if (prelude.startsWith("@")) {
      rules.push(...collectCssRules(
        source,
        openingIndex + 1,
        closingIndex,
        [...ancestors, prelude],
      ));
    } else if (prelude) {
      rules.push({
        ancestors,
        declarations: declarationsByName(source.slice(openingIndex + 1, closingIndex)),
        selector: prelude,
      });
    }
    cursor = closingIndex + 1;
  }
  return rules;
}

const rules = collectCssRules(css);

function ruleFor(
  selector: string,
  ancestor: string | null = null,
): CssRule {
  const normalizedSelector = normalizePrelude(selector);
  const match = rules.find((rule) => (
    rule.selector === normalizedSelector
      && (ancestor === null
        ? rule.ancestors.length === 0
        : rule.ancestors.includes(ancestor))
  ));
  expect(match, `Missing CSS rule ${ancestor ? `${ancestor} > ` : ""}${selector}`).toBeDefined();
  return match as CssRule;
}

function splitTopLevel(value: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let cursor = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(cursor, index).trim());
      cursor = index + 1;
    }
  }
  parts.push(value.slice(cursor).trim());
  return parts;
}

function numericShadowTerms(value: string): readonly number[] {
  const prefix = value.replace(/^inset\s+/, "").replace(/(?:var|rgba?)\([\s\S]*$/i, "");
  return Array.from(prefix.matchAll(/-?\d*\.?\d+(?:px)?/g), ({ 0: token }) => (
    Number.parseFloat(token)
  ));
}

function rgbaAlpha(value: string): number {
  const match = value.match(/rgba\([^)]*,\s*(\d*\.?\d+)\s*\)$/i);
  expect(match, `Expected an rgba color, received ${value}`).not.toBeNull();
  return Number(match?.[1]);
}

function extractFunction(value: string, name: string): string {
  const start = value.indexOf(`${name}(`);
  expect(start, `Missing ${name}()`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced ${name}() value`);
}

function parseMotionTransform(value: string): MotionFrame {
  const match = value.match(
    /^translate3d\(\s*(-?\d*\.?\d+)%\s*,\s*(-?\d*\.?\d+)%\s*,\s*0\s*\)\s*scale\(\s*(\d*\.?\d+)\s*\)$/,
  );
  expect(match, `Unexpected motion transform: ${value}`).not.toBeNull();
  return {
    x: Number(match?.[1]),
    y: Number(match?.[2]),
    scale: Number(match?.[3]),
  };
}

function selectorContainsClass(selector: string, className: string): boolean {
  return new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s.:#[>+~,]|$)`).test(selector);
}

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `Missing source marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `Missing source marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function hexToRgb(value: string): readonly [number, number, number] {
  const normalized = value.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character.repeat(2)).join("")
    : normalized;
  expect(expanded).toMatch(/^[\da-f]{6}$/i);
  return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16)) as unknown as readonly [number, number, number];
}

function contrastRatio(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number],
): number {
  const luminance = (rgb: readonly [number, number, number]) => {
    const [red, green, blue] = rgb.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

describe("animated watch image motion contract", () => {
  it("uses an exact 28-second transform-only cycle with bounded equal endpoints", () => {
    const animationRule = ruleFor(
      '.watch-image-backdrop[data-image-state="ready"][data-reduced-motion="false"] .watch-image-backdrop__image',
    );
    expect(animationRule.declarations.get("animation")).toBe(
      "watch-image-drift 28s ease-in-out infinite",
    );

    const keyframeRules = rules.filter((rule) => (
      rule.ancestors.includes("@keyframes watch-image-drift")
    ));
    expect(keyframeRules).toHaveLength(2);
    const frames = new Map<number, MotionFrame>();
    for (const rule of keyframeRules) {
      expect([...rule.declarations.keys()]).toEqual(["transform"]);
      const frame = parseMotionTransform(rule.declarations.get("transform") ?? "");
      for (const selector of rule.selector.split(",")) {
        frames.set(Number.parseFloat(selector), frame);
      }
    }

    expect([...frames.keys()].sort((left, right) => left - right)).toEqual([0, 50, 100]);
    expect(frames.get(0)).toEqual({ x: -1.25, y: -0.5, scale: 1.06 });
    expect(frames.get(50)).toEqual({ x: 1.25, y: 0.75, scale: 1.1 });
    expect(frames.get(100)).toEqual(frames.get(0));

    const authoredFrames = [...frames.values()];
    expect(Math.min(...authoredFrames.map(({ x }) => x))).toBe(-1.25);
    expect(Math.max(...authoredFrames.map(({ x }) => x))).toBe(1.25);
    expect(Math.min(...authoredFrames.map(({ y }) => y))).toBe(-0.5);
    expect(Math.max(...authoredFrames.map(({ y }) => y))).toBe(0.75);
    expect(Math.min(...authoredFrames.map(({ scale }) => scale))).toBe(1.06);
    expect(Math.max(...authoredFrames.map(({ scale }) => scale))).toBe(1.1);

    const animationOwners = rules.filter((rule) => (
      rule.declarations.get("animation")?.includes("watch-image-drift")
    ));
    expect(animationOwners.map(({ selector }) => selector)).toEqual([animationRule.selector]);
    expect(ruleFor(
      '.watch-image-backdrop[data-image-state="ready"][data-definition-open="true"] .watch-image-backdrop__image',
    ).declarations.get("animation-play-state")).toBe("paused");
  });
});

describe("static smoke-glass material contract", () => {
  const root = ruleFor(":root").declarations;
  const masthead = ruleFor(".site-masthead").declarations;

  it("keeps the edge and inset highlight at one pixel and the exterior shadow within budget", () => {
    expect(masthead.get("border")).toMatch(/^1px\s+solid\b/);
    expect(masthead.get("border-bottom")).toMatch(/^1px\s+solid\b/);

    const shadows = splitTopLevel(masthead.get("box-shadow") ?? "");
    expect(shadows).toHaveLength(2);
    expect(shadows[0]).toMatch(/^inset\b/);
    expect(numericShadowTerms(shadows[0]).slice(0, 3)).toEqual([0, 1, 0]);
    expect(shadows[0]).toContain("var(--header-glass-highlight)");
    expect(rgbaAlpha(root.get("--header-glass-highlight") ?? "")).toBe(0.18);

    expect(shadows[1]).not.toMatch(/^inset\b/);
    const exteriorTerms = numericShadowTerms(shadows[1]);
    expect(exteriorTerms[2]).toBeLessThanOrEqual(28);
    expect(shadows[1]).toContain("var(--header-glass-shadow)");
    expect(rgbaAlpha(root.get("--header-glass-shadow") ?? "")).toBeLessThanOrEqual(0.18);
  });

  it("provides at least 0.62 scrim alpha behind the complete masthead", () => {
    const background = ruleFor(".cinematic-vignette").declarations.get("background") ?? "";
    const topGradient = extractFunction(background, "linear-gradient");
    const stops = Array.from(
      topGradient.matchAll(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d*\.?\d+)\s*\)\s*(\d*\.?\d+)(?:px)?/gi),
      (match) => ({ alpha: Number(match[1]), position: Number(match[2]) }),
    );
    expect(stops.length).toBeGreaterThanOrEqual(3);

    const expandedBottom = 12 + 68;
    const compactBottom = 8 + 60;
    const alphaAt = (position: number) => {
      const nextIndex = stops.findIndex((stop) => stop.position >= position);
      if (nextIndex <= 0) return stops[Math.max(0, nextIndex)]?.alpha ?? 0;
      const previous = stops[nextIndex - 1];
      const next = stops[nextIndex];
      const progress = (position - previous.position) / (next.position - previous.position);
      return previous.alpha + (next.alpha - previous.alpha) * progress;
    };
    for (let position = 0; position <= Math.max(expandedBottom, compactBottom); position += 1) {
      expect(alphaAt(position), `scrim alpha at ${position}px`).toBeGreaterThanOrEqual(0.62);
    }
  });

  it("locks expanded and compact inset, height, and radius tokens", () => {
    expect(Object.fromEntries([
      "top",
      "right",
      "left",
      "height",
      "border-radius",
    ].map((property) => [property, masthead.get(property)]))).toEqual({
      top: "12px",
      right: "16px",
      left: "16px",
      height: "68px",
      "border-radius": "22px",
    });

    const compact = ruleFor(".site-masthead", "@media (max-width: 700px)").declarations;
    expect(Object.fromEntries([
      "top",
      "right",
      "left",
      "height",
      "border-radius",
    ].map((property) => [property, compact.get(property)]))).toEqual({
      top: "8px",
      right: "8px",
      left: "8px",
      height: "60px",
      "border-radius": "18px",
    });
  });

  it("keeps audited overlays static and excludes protected watch selectors", () => {
    const auditedRules = rules.filter((rule) => (
      AUDITED_OVERLAYS.some((className) => selectorContainsClass(rule.selector, className))
    ));
    expect(auditedRules.length).toBeGreaterThan(AUDITED_OVERLAYS.length);
    const forbiddenProperties = new Set([
      "backdrop-filter",
      "-webkit-backdrop-filter",
      "filter",
      "background-position",
      "animation",
      "animation-name",
    ]);
    for (const rule of auditedRules) {
      expect(
        [...rule.declarations.keys()].filter((property) => forbiddenProperties.has(property)),
        rule.selector,
      ).toEqual([]);
      expect([...rule.declarations.values()].join(" "), rule.selector).not.toMatch(
        /\b(?:shimmer|noise|specular-sweep)\b/i,
      );
      expect(rule.selector, rule.selector).not.toMatch(PROTECTED_SELECTOR_PATTERN);
    }

    const vignette = ruleFor(".cinematic-vignette").declarations;
    expect(vignette.get("pointer-events")).toBe("none");
    expect(
      [...vignette.keys()].filter((property) => forbiddenProperties.has(property)),
    ).toEqual([]);
    expect(vignette.get("background")).not.toMatch(/url\(|image-set\(/i);

    const featureRules = rules.filter((rule) => FEATURE_SELECTOR_PATTERN.test(rule.selector));
    const protectedRules = rules.filter((rule) => PROTECTED_SELECTOR_PATTERN.test(rule.selector));
    expect(featureRules.length).toBeGreaterThan(0);
    expect(protectedRules.length).toBeGreaterThan(0);
    expect(featureRules.every((rule) => !PROTECTED_SELECTOR_PATTERN.test(rule.selector))).toBe(true);
    expect(protectedRules.every((rule) => (
      !/watch-image-drift|--watch-focal|--header-glass/.test(
        [...rule.declarations.values()].join(" "),
      )
    ))).toBe(true);
  });

  it("provides contrast, focus, and static preference/forced-color fallbacks", () => {
    const conservativeSurface = [89, 91, 92] as const;
    expect(contrastRatio(hexToRgb(root.get("--header-label") ?? ""), conservativeSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hexToRgb(root.get("--header-gold") ?? ""), conservativeSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hexToRgb(root.get("--header-focus") ?? ""), conservativeSurface)).toBeGreaterThanOrEqual(3);

    const focus = ruleFor(".site-masthead a:focus-visible").declarations;
    expect(focus.get("outline")).toMatch(/^2px\s+solid\b/);
    expect(Number.parseFloat(focus.get("outline-offset") ?? "-1")).toBeGreaterThanOrEqual(0);

    const reducedTransparency = ruleFor(
      ".site-masthead",
      "@media (prefers-reduced-transparency: reduce)",
    ).declarations;
    expect(reducedTransparency.get("background")).toBe("#101416");

    const increasedContrast = ruleFor(
      ".site-masthead",
      "@media (prefers-contrast: more)",
    ).declarations;
    expect(increasedContrast.get("background")).toBe("#080b0c");
    expect(increasedContrast.get("border-color")).toBe("#f8f5ee");

    const forcedHeader = ruleFor(
      ".site-masthead",
      "@media (forced-colors: active)",
    ).declarations;
    expect(forcedHeader.get("background")).toBe("Canvas");
    expect(forcedHeader.get("color")).toBe("CanvasText");
    expect(forcedHeader.get("border-color")).toBe("CanvasText");
    expect(forcedHeader.get("box-shadow")).toBe("none");
    expect(ruleFor(
      ".masthead-nav a, .wordmark",
      "@media (forced-colors: active)",
    ).declarations.get("color")).toBe("LinkText");
    expect(ruleFor(
      ".site-masthead a:focus-visible",
      "@media (forced-colors: active)",
    ).declarations.get("outline-color")).toBe("Highlight");
  });
});

describe("finite compact and expanded browser-layout contract", () => {
  it("measures responsive visibility, centering, targets, clearance, overflow, contrast, and focus", () => {
    const inspection = sourceBetween(
      smoke,
      "const layoutInspectionExpression = String.raw`",
      "const inspectLayout = async",
    );
    const assertions = sourceBetween(
      smoke,
      "const assertLayoutReport =",
      "const assertPreferenceReport =",
    );

    expect(smoke).toContain("compact: Object.freeze({ width: 390, height: 844 })");
    expect(smoke).toContain("expanded: VIEWPORT");
    expect(smoke).toContain('const CONSERVATIVE_HEADER_SURFACE = "rgb(89, 91, 92)";');
    expect(inspection).toContain("header.querySelectorAll('a')");
    expect(inspection).toContain("document.querySelector('.wordmark')");
    expect(inspection).toContain("document.querySelector('.search-stage')");
    expect(inspection).toContain("document.documentElement.scrollWidth");
    expect(inspection).toContain("contrastRatio(style.color");
    expect(inspection).toContain("link.focus({ preventScroll: true })");
    expect(inspection).toContain("outlineWidth");
    expect(inspection).toContain("clipped");

    expect(assertions).toContain("expectation.visibleLinks");
    expect(assertions).toContain("layout.wordmark.centerDelta <= 1");
    expect(assertions).toContain("link.box.width >= 44 && link.box.height >= 44");
    expect(assertions).toContain("layout.search.clearance >= expectation.minimumSearchClearance");
    expect(assertions).toContain("layout.overflow.scrollWidth <= layout.overflow.clientWidth");
    expect(assertions).toContain("link.contrastRatio >= 4.5");
    expect(assertions).toContain("numericCss(entry.outlineWidth) >= 2");
    expect(assertions).toContain("entry.contrastRatio >= 3");
    expect(assertions).toContain("!entry.clipped");

    expect(smoke).toContain('visibleLinks: ["COLLECTION", "ABOUT", "MERIDIAN WATCHES home", "CONTACT", "LOGIN"]');
    expect(smoke).toContain('visibleLinks: ["COLLECTION", "MERIDIAN WATCHES home", "LOGIN"]');
    expect(smoke).toContain('hiddenLinks: ["ABOUT", "CONTACT"]');
    expect(smoke).toContain("minimumSearchClearance: 20");
    expect(smoke).toContain("minimumSearchClearance: 8");
  });

  it("uses finite media emulation for reduced transparency, increased contrast, and forced colors", () => {
    const preferenceAssertions = sourceBetween(
      smoke,
      "const assertPreferenceReport =",
      "const layoutReports =",
    );
    const inspectionRuntime = sourceBetween(
      smoke,
      "const inspectLayout = async",
      "const assertLayoutReport =",
    );
    const collection = sourceBetween(smoke, "const layoutReports =", "const result = {");

    expect(collection).toContain("expanded: await inspectLayout(LAYOUT_VIEWPORTS.expanded)");
    expect(collection).toContain("compact: await inspectLayout(LAYOUT_VIEWPORTS.compact)");
    expect(collection).toContain('{ name: "prefers-reduced-transparency", value: "reduce" }');
    expect(collection).toContain('{ name: "prefers-contrast", value: "more" }');
    expect(collection).toContain('{ name: "forced-colors", value: "active" }');
    expect(inspectionRuntime).toContain('client.send("Emulation.setEmulatedMedia"');
    expect(inspectionRuntime).toContain("requestAnimationFrame(() => requestAnimationFrame(resolve))");

    expect(preferenceAssertions).toContain('layout.header.backdropFilter, "none"');
    expect(preferenceAssertions).toContain('layout.header.backgroundColor, "rgb(16, 20, 22)"');
    expect(preferenceAssertions).toContain('layout.header.backgroundColor, "rgb(8, 11, 12)"');
    expect(preferenceAssertions).toContain('layout.header.borderTopColor, "rgb(248, 245, 238)"');
    expect(preferenceAssertions).toContain("layout.media.forcedColors, true");
    expect(preferenceAssertions).toContain('layout.header.boxShadow, "none"');

    expect(smoke).toContain(
      'assertPreferenceReport(layoutReports.reducedTransparency, "reduced transparency")',
    );
    expect(smoke).toContain(
      'assertPreferenceReport(layoutReports.increasedContrast, "increased contrast")',
    );
    expect(smoke).toContain(
      'assertPreferenceReport(layoutReports.forcedColors, "forced colors")',
    );
  });
});
