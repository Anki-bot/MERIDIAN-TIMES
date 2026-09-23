import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsPath = resolve(process.cwd(), "app/globals.css");
const css = readFileSync(globalsPath, "utf8");

type RuleBlock = {
  readonly declarations: string;
  readonly openingIndex: number;
};

function extractExactRuleBlocks(source: string, selector: string): readonly RuleBlock[] {
  const blocks: RuleBlock[] = [];

  for (let openingIndex = 0; openingIndex < source.length; openingIndex += 1) {
    if (source[openingIndex] !== "{") continue;
    const previousOpening = source.lastIndexOf("{", openingIndex - 1);
    const previousClosing = source.lastIndexOf("}", openingIndex - 1);
    const rawPrelude = source.slice(Math.max(previousOpening, previousClosing) + 1, openingIndex);
    const prelude = rawPrelude.slice(rawPrelude.lastIndexOf(";") + 1).trim();
    if (prelude !== selector) continue;

    let depth = 1;
    let closingIndex = openingIndex + 1;
    while (closingIndex < source.length && depth > 0) {
      if (source[closingIndex] === "{") depth += 1;
      if (source[closingIndex] === "}") depth -= 1;
      closingIndex += 1;
    }
    blocks.push({
      declarations: source.slice(openingIndex + 1, closingIndex - 1),
      openingIndex,
    });
  }

  return blocks;
}

function declarationsByName(block: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of block.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    declarations.set(
      declaration.slice(0, separator).trim(),
      declaration.slice(separator + 1).trim(),
    );
  }
  return declarations;
}

function rgbaAlpha(value: string): number | null {
  const match = value.match(/^rgba\([^)]*,\s*(\d*\.?\d+)\s*\)$/i);
  return match ? Number(match[1]) : null;
}

function blockContext(source: string, openingIndex: number): string {
  const nearbySource = source.slice(Math.max(0, openingIndex - 320), openingIndex);
  const contexts = [
    "@supports backdrop-filter",
    "@media (prefers-reduced-transparency: reduce)",
    "@media (prefers-contrast: more)",
    "@media (forced-colors: active)",
  ];
  return contexts.reduce((nearest, context) => (
    nearbySource.lastIndexOf(context) > nearbySource.lastIndexOf(nearest) ? context : nearest
  ));
}

describe("bug condition: default glass masthead", () => {
  const rootBlock = extractExactRuleBlocks(css, ":root")[0]?.declarations ?? "";
  const rootTokens = declarationsByName(rootBlock);

  it("keeps every authored default masthead color stop at or below 0.22 alpha", () => {
    const materialTokenNames = [
      "--header-glass-top",
      "--header-glass-bottom",
      "--header-glass-fallback",
      "--header-glass-enhanced",
    ];
    const authoredStops = materialTokenNames.flatMap((name) => {
      const value = rootTokens.get(name);
      if (!value) return [];
      return [{ name, value, alpha: rgbaAlpha(value) }];
    });
    const invalidStops = authoredStops.filter(
      ({ alpha }) => alpha === null || alpha < 0 || alpha > 0.22,
    );
    const evidence = [
      "--header-glass-fallback",
      "--header-glass-enhanced",
      "--header-blur",
      "--header-saturation",
    ].map((name) => `${name}: ${rootTokens.get(name) ?? "<absent>"}`);

    expect(
      { authoredStopCount: authoredStops.length, invalidStops },
      `Header alpha counterexample:\n${evidence.join("\n")}`,
    ).toEqual({ authoredStopCount: 2, invalidStops: [] });
  });

  it("contains no standard or prefixed backdrop-filter declaration in any masthead rule", () => {
    const filterDeclarations = extractExactRuleBlocks(css, ".site-masthead").flatMap((block) => {
      const declarations = declarationsByName(block.declarations);
      return ["backdrop-filter", "-webkit-backdrop-filter"].flatMap((property) => {
        const rawValue = declarations.get(property);
        if (!rawValue) return [];
        const resolvedValue = rawValue.replace(/var\((--[^)]+)\)/g, (reference, token: string) => (
          rootTokens.get(token) ?? reference
        ));
        return [{
          context: blockContext(css, block.openingIndex),
          declaration: `${property}: ${resolvedValue}`,
        }];
      });
    });

    expect(
      filterDeclarations,
      `Masthead filter counterexample:\n${filterDeclarations
        .map(({ context, declaration }) => `${context} -> ${declaration}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
