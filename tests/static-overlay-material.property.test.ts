import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import postcss from "postcss";
import { expect, it } from "vitest";

const PROPERTY_TAG =
  "Feature: animated-watch-image-glass-header, Property 5: Static material source safety";

// Reproduce with: seed=20250319, numRuns=128.
const PROPERTY_SEED = 20_250_319;
const PROPERTY_RUNS = 128;

const AUDITED_OVERLAY_SELECTORS = [
  ".site-masthead",
  ".search-pill",
  ".search-results",
  ".definition-layer",
  ".definition-panel",
  ".definition-panel__footer",
] as const;

const FORBIDDEN_MATERIAL_PROPERTIES = new Set([
  "backdrop-filter",
  "-webkit-backdrop-filter",
  "filter",
  "-webkit-filter",
  "background-position",
  "background-position-x",
  "background-position-y",
]);
const FORBIDDEN_MATERIAL_ANIMATION =
  /(?:shimmer|noise|specular[-_\s]*sweep)/i;
const PROTECTED_WATCH_SELECTOR =
  /\.(?:watch-(?:canvas-shell|static-fallback)|static-(?:case|gear|balance|bridge|jewel))[\w-]*/;

const globalsPath = resolve(process.cwd(), "app/globals.css");
const css = readFileSync(globalsPath, "utf8");
const stylesheet = postcss.parse(css, { from: globalsPath });

type AuditedOverlaySelector = (typeof AUDITED_OVERLAY_SELECTORS)[number];

type DeclarationRecord = {
  readonly property: string;
  readonly value: string;
};

type AuditedRule = {
  readonly context: string;
  readonly declarations: readonly DeclarationRecord[];
  readonly matchedOverlays: readonly AuditedOverlaySelector[];
  readonly selector: string;
};

type KeyframesRecord = {
  readonly context: string;
  readonly declarations: readonly DeclarationRecord[];
  readonly name: string;
};

type AnimationReference = {
  readonly name: string;
  readonly rule: AuditedRule;
};

type MastheadGradientStop = {
  readonly alpha: number;
  readonly context: string;
  readonly property: string;
  readonly rawStop: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchingAuditedOverlays(
  selector: string,
): readonly AuditedOverlaySelector[] {
  return AUDITED_OVERLAY_SELECTORS.filter((auditedSelector) => {
    const className = auditedSelector.slice(1);
    const classOrModifier = new RegExp(
      `\\.${escapeRegExp(className)}(?:--[\\w-]+)?(?![\\w-])`,
    );
    return classOrModifier.test(selector);
  });
}

function ruleContext(rule: postcss.Rule): string {
  const ancestors: string[] = [];
  let parent: postcss.Node | undefined = rule.parent;

  while (parent) {
    if (parent.type === "atrule") {
      const atRule = parent as postcss.AtRule;
      ancestors.unshift(`@${atRule.name} ${atRule.params}`.trim());
    }
    parent = parent.parent;
  }

  const line = rule.source?.start?.line ?? "?";
  return `${ancestors.join(" > ") || "<root>"} @ line ${line}`;
}

function directDeclarations(rule: postcss.Rule): readonly DeclarationRecord[] {
  return (rule.nodes ?? []).flatMap((node) => (
    node.type === "decl"
      ? [{ property: node.prop.toLowerCase(), value: node.value.trim() }]
      : []
  ));
}

function splitTopLevel(value: string, delimiter: "," | "/"): readonly string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      current += character;
      if (character === "\\") {
        current += value[index + 1] ?? "";
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;

    if (character === delimiter && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  parts.push(current.trim());
  return parts;
}

function splitTopLevelWhitespace(value: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;

  const flush = () => {
    if (current.trim()) tokens.push(current.trim());
    current = "";
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      current += character;
      if (character === "\\") {
        current += value[index + 1] ?? "";
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;

    if (/\s/.test(character) && depth === 0) {
      flush();
    } else {
      current += character;
    }
  }

  flush();
  return tokens;
}

const customProperties = new Map<string, string>();
stylesheet.walkRules((rule) => {
  if (!rule.selector.split(",").some((selector) => selector.trim() === ":root")) {
    return;
  }

  for (const declaration of directDeclarations(rule)) {
    if (declaration.property.startsWith("--")) {
      customProperties.set(declaration.property, declaration.value);
    }
  }
});

function resolveCustomProperties(
  value: string,
  resolving: readonly string[] = [],
): string {
  return value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
    (_reference, property: string, fallback: string | undefined) => {
      if (resolving.includes(property)) {
        throw new Error(`Circular custom property in audited material: ${property}`);
      }

      const replacement = customProperties.get(property) ?? fallback?.trim();
      if (replacement === undefined) {
        throw new Error(`Unresolved custom property in audited material: ${property}`);
      }

      return resolveCustomProperties(replacement, [...resolving, property]);
    },
  );
}

function findClosingParenthesis(value: string, openingIndex: number): number {
  let depth = 1;
  let quote: "'" | '"' | null = null;

  for (let index = openingIndex + 1; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Unbalanced CSS function: ${value}`);
}

function gradientArguments(value: string): readonly (readonly string[])[] {
  const gradients: string[][] = [];
  const gradientPattern =
    /(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = gradientPattern.exec(value)) !== null) {
    const openingIndex = value.indexOf("(", match.index);
    const closingIndex = findClosingParenthesis(value, openingIndex);
    gradients.push(splitTopLevel(
      value.slice(openingIndex + 1, closingIndex),
      ",",
    ) as string[]);
    gradientPattern.lastIndex = closingIndex + 1;
  }

  return gradients;
}

function parseAlphaToken(value: string): number | null {
  const token = value.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)%$/.test(token)) {
    return Number.parseFloat(token) / 100;
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
    return Number.parseFloat(token);
  }
  return null;
}

function functionalColorAlpha(name: string, body: string): number | null {
  const normalizedName = name.toLowerCase();
  const supportedColorFunctions = new Set([
    "rgb",
    "rgba",
    "hsl",
    "hsla",
    "hwb",
    "lab",
    "lch",
    "oklab",
    "oklch",
    "color",
  ]);
  if (!supportedColorFunctions.has(normalizedName)) return null;

  const slashParts = splitTopLevel(body, "/");
  if (slashParts.length === 2) return parseAlphaToken(slashParts[1]);
  if (slashParts.length > 2) return Number.NaN;

  const commaParts = splitTopLevel(body, ",");
  if (
    commaParts.length === 4
    && ["rgb", "rgba", "hsl", "hsla"].includes(normalizedName)
  ) {
    return parseAlphaToken(commaParts[3]);
  }

  return 1;
}

function colorStopAlpha(stop: string): number | null {
  const value = stop.trim();
  const hex = value.match(/^#([\da-f]{3,8})(?![\da-f])/i);
  if (hex) {
    if (hex[1].length === 4) {
      return Number.parseInt(hex[1][3] + hex[1][3], 16) / 255;
    }
    if (hex[1].length === 8) {
      return Number.parseInt(hex[1].slice(6), 16) / 255;
    }
    return 1;
  }
  if (/^transparent(?:\s|$)/i.test(value)) return 0;

  const functionMatch = value.match(/^([a-z][\w-]*)\s*\(/i);
  if (functionMatch) {
    const openingIndex = value.indexOf("(");
    const closingIndex = findClosingParenthesis(value, openingIndex);
    return functionalColorAlpha(
      functionMatch[1],
      value.slice(openingIndex + 1, closingIndex),
    );
  }

  if (/^[a-z][\w-]*(?:\s|$)/i.test(value)) return 1;
  return null;
}

const keyframesByName = new Map<string, KeyframesRecord[]>();
stylesheet.walkAtRules((atRule) => {
  if (!/(?:^|-)keyframes$/i.test(atRule.name)) return;

  const name = atRule.params.trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2");
  const line = atRule.source?.start?.line ?? "?";
  const record: KeyframesRecord = {
    context: `@${atRule.name} ${name} @ line ${line}`,
    declarations: [],
    name,
  };
  const declarations: DeclarationRecord[] = [];
  atRule.walkDecls((declaration) => {
    declarations.push({
      property: declaration.prop.toLowerCase(),
      value: declaration.value.trim(),
    });
  });
  keyframesByName.set(name, [
    ...(keyframesByName.get(name) ?? []),
    { ...record, declarations },
  ]);
});

const auditedRules: readonly AuditedRule[] = (() => {
  const rules: AuditedRule[] = [];
  stylesheet.walkRules((rule) => {
    const matchedOverlays = matchingAuditedOverlays(rule.selector);
    if (matchedOverlays.length === 0) return;

    rules.push({
      context: ruleContext(rule),
      declarations: directDeclarations(rule),
      matchedOverlays,
      selector: rule.selector,
    });
  });
  return rules;
})();

const mastheadGradientStops: readonly MastheadGradientStop[] = auditedRules
  .filter(({ matchedOverlays }) => matchedOverlays.includes(".site-masthead"))
  .flatMap((rule) => rule.declarations.flatMap((declaration) => {
    if (!["background", "background-image"].includes(declaration.property)) {
      return [];
    }

    const resolvedValue = resolveCustomProperties(declaration.value);
    return gradientArguments(resolvedValue).flatMap((argumentsList) => (
      argumentsList.flatMap((rawStop, stopIndex) => {
        const alpha = colorStopAlpha(rawStop);
        if (alpha !== null) {
          return [{
            alpha,
            context: `${rule.selector} (${rule.context}), gradient stop ${stopIndex + 1}`,
            property: declaration.property,
            rawStop,
          }];
        }

        const isGradientConfiguration = stopIndex === 0;
        const isColorHint = /^-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)$/i.test(
          rawStop.trim(),
        );
        if (isGradientConfiguration || isColorHint) return [];

        throw new Error(
          `Unable to parse masthead gradient stop "${rawStop}" in ${rule.selector}`,
        );
      })
    ));
  }));

const ANIMATION_KEYWORDS = new Set([
  "alternate",
  "alternate-reverse",
  "backwards",
  "both",
  "ease",
  "ease-in",
  "ease-in-out",
  "ease-out",
  "forwards",
  "infinite",
  "inherit",
  "initial",
  "linear",
  "none",
  "normal",
  "paused",
  "reverse",
  "revert",
  "revert-layer",
  "running",
  "step-end",
  "step-start",
  "unset",
]);

function unquote(value: string): string {
  const match = value.match(/^(?:"([^"]+)"|'([^']+)')$/);
  return match ? (match[1] ?? match[2]) : value;
}

function shorthandAnimationNames(value: string): readonly string[] {
  return splitTopLevel(value, ",").flatMap((animation) => (
    splitTopLevelWhitespace(animation).flatMap((token) => {
      const candidate = unquote(token);
      const lowerCandidate = candidate.toLowerCase();
      if (ANIMATION_KEYWORDS.has(lowerCandidate)) return [];
      if (/^-?(?:\d+\.?\d*|\.\d+)(?:ms|s)?$/i.test(candidate)) return [];
      if (/^[a-z-]+\(/i.test(candidate)) return [];
      return /^-?[_a-z][\w-]*$/i.test(candidate) ? [candidate] : [];
    })
  ));
}

function referencedAnimationNames(
  declaration: DeclarationRecord,
): readonly string[] {
  const value = resolveCustomProperties(declaration.value);
  if (declaration.property === "animation-name") {
    return splitTopLevel(value, ",")
      .map((name) => unquote(name.trim()))
      .filter((name) => !ANIMATION_KEYWORDS.has(name.toLowerCase()));
  }
  return declaration.property === "animation"
    ? shorthandAnimationNames(value)
    : [];
}

const animationReferences: readonly AnimationReference[] = auditedRules.flatMap(
  (rule) => rule.declarations.flatMap((declaration) => (
    referencedAnimationNames(declaration).map((name) => ({ name, rule }))
  )),
);

function directRuleViolations(rule: AuditedRule): readonly string[] {
  return rule.declarations.flatMap((declaration) => {
    const violations: string[] = [];
    if (FORBIDDEN_MATERIAL_PROPERTIES.has(declaration.property)) {
      violations.push(`${declaration.property}: ${declaration.value}`);
    }
    if (
      ["animation", "animation-name"].includes(declaration.property)
      && FORBIDDEN_MATERIAL_ANIMATION.test(declaration.value)
    ) {
      violations.push(`${declaration.property}: ${declaration.value}`);
    }
    return violations;
  });
}

function referencedAnimationViolations(
  reference: AnimationReference,
): readonly string[] {
  const definitions = keyframesByName.get(reference.name) ?? [];
  const violations: string[] = [];

  if (FORBIDDEN_MATERIAL_ANIMATION.test(reference.name)) {
    violations.push(`forbidden material animation name: ${reference.name}`);
  }
  if (definitions.length === 0) {
    violations.push(`unresolved referenced animation: ${reference.name}`);
  }

  for (const definition of definitions) {
    for (const declaration of definition.declarations) {
      if (FORBIDDEN_MATERIAL_PROPERTIES.has(declaration.property)) {
        violations.push(
          `${definition.context} -> ${declaration.property}: ${declaration.value}`,
        );
      }
    }
  }

  return violations;
}

function completeRuleOrder(
  selectedOrder: readonly number[],
  reverseRemainder: boolean,
): readonly number[] {
  const selected = new Set(selectedOrder);
  const remainder = auditedRules
    .map((_rule, index) => index)
    .filter((index) => !selected.has(index));
  if (reverseRemainder) remainder.reverse();
  return [...selectedOrder, ...remainder];
}

function rotate<T>(values: readonly T[], offset: number): readonly T[] {
  if (values.length === 0) return values;
  const normalizedOffset = offset % values.length;
  return [
    ...values.slice(normalizedOffset),
    ...values.slice(0, normalizedOffset),
  ];
}

const auditOrderArbitrary = fc.record({
  animationOffset: animationReferences.length > 0
    ? fc.integer({ min: 0, max: animationReferences.length - 1 })
    : fc.constant(0),
  reverseRemainder: fc.boolean(),
  selectedRuleOrder: fc.uniqueArray(
    fc.integer({ min: 0, max: auditedRules.length - 1 }),
    { minLength: 1, maxLength: auditedRules.length },
  ),
  stopOffset: fc.integer({ min: 0, max: mastheadGradientStops.length - 1 }),
});

// **Validates: Requirements 6.1, 6.8, 6.9**
it(PROPERTY_TAG, () => {
  expect(auditedRules.length).toBeGreaterThan(0);
  expect(mastheadGradientStops.length).toBeGreaterThan(0);

  for (const selector of AUDITED_OVERLAY_SELECTORS) {
    expect(
      auditedRules.some(({ matchedOverlays }) => matchedOverlays.includes(selector)),
      `No audited CSS block was parsed for ${selector}`,
    ).toBe(true);
  }

  // Protected legacy watch blocks are intentionally outside Property 5's scope;
  // tests/spec-integrity.test.ts independently guards their exact bytes.
  expect(
    auditedRules.filter(({ selector }) => PROTECTED_WATCH_SELECTOR.test(selector)),
  ).toEqual([]);

  fc.assert(
    fc.property(auditOrderArbitrary, ({
      animationOffset,
      reverseRemainder,
      selectedRuleOrder,
      stopOffset,
    }) => {
      const ruleOrder = completeRuleOrder(
        selectedRuleOrder,
        reverseRemainder,
      );

      expect(new Set(ruleOrder).size).toBe(auditedRules.length);
      for (const ruleIndex of ruleOrder) {
        const rule = auditedRules[ruleIndex];
        const violations = directRuleViolations(rule);
        expect(
          violations,
          `Audited overlay counterexample: ${rule.selector} (${rule.context})`,
        ).toEqual([]);
      }

      for (const stop of rotate(mastheadGradientStops, stopOffset)) {
        expect(
          Number.isFinite(stop.alpha) && stop.alpha >= 0 && stop.alpha <= 0.22,
          `Masthead stop counterexample: ${stop.context} -> ${stop.property}: ${stop.rawStop} (alpha ${stop.alpha})`,
        ).toBe(true);
      }

      for (const reference of rotate(animationReferences, animationOffset)) {
        const violations = referencedAnimationViolations(reference);
        expect(
          violations,
          `Animation counterexample: ${reference.rule.selector} (${reference.rule.context}) -> ${reference.name}`,
        ).toEqual([]);
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
});
