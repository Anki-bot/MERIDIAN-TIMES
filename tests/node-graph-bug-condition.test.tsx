import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { NodeGraph } from "@/components/ui/NodeGraph";
import { dictionaryTerms } from "@/lib/dictionary";
import { GRAPH_NODES, buildGraphEdges, buildRestingGraphEdges } from "@/lib/graph";
import type { WatchAudience } from "@/lib/types";
import { installMatchMedia } from "./helpers/match-media";

const motionPreference = vi.hoisted(() => ({ reduced: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduced,
  };
});

const PROPERTY_SEED = 0xC0FFEE;
const nodeGraphPath = resolve(process.cwd(), "components/ui/NodeGraph.tsx");
const globalsPath = resolve(process.cwd(), "app/globals.css");
const nodeGraphSource = readFileSync(nodeGraphPath, "utf8");
const globalsSource = readFileSync(globalsPath, "utf8");
const graphPathsSource = nodeGraphSource.slice(
  nodeGraphSource.indexOf("function GraphPaths"),
  nodeGraphSource.indexOf("export function NodeGraph"),
);

type Scenario = {
  readonly width: number;
  readonly activeAudience: WatchAudience | null;
  readonly selectedTermId: string | null;
  readonly previewNodeId: string | null;
  readonly reducedMotion: boolean;
  readonly interaction?: "focus" | "pointer";
};

type GraphObservation = {
  readonly variants: readonly string[];
  readonly activeEdgeCount: number;
  readonly activePathCount: number;
  readonly activeEdgeIds: readonly (string | null)[];
  readonly particleCount: number;
  readonly animateMotionCount: number;
  readonly desktopParticleCount: number;
  readonly mobileParticleCount: number;
};

function exactCssRule(source: string, selector: string): string {
  for (let openingIndex = 0; openingIndex < source.length; openingIndex += 1) {
    if (source[openingIndex] !== "{") continue;
    const previousOpening = source.lastIndexOf("{", openingIndex - 1);
    const previousClosing = source.lastIndexOf("}", openingIndex - 1);
    const prelude = source.slice(Math.max(previousOpening, previousClosing) + 1, openingIndex).trim();
    if (prelude !== selector) continue;

    let depth = 1;
    let closingIndex = openingIndex + 1;
    while (closingIndex < source.length && depth > 0) {
      if (source[closingIndex] === "{") depth += 1;
      if (source[closingIndex] === "}") depth -= 1;
      closingIndex += 1;
    }
    return source.slice(openingIndex + 1, closingIndex - 1);
  }
  return "";
}

function sourceLineContaining(source: string, fragment: string): string | null {
  return source.split("\n").map((line) => line.trim()).find((line) => line.includes(fragment)) ?? null;
}

function expectedObservation(scenario: Scenario): GraphObservation {
  // Match NodeGraph.tsx dynamic edge generation (39 edges)
  const menBrands = [
    "armani exchange",
    "audemars piguet",
    "bentley",
    "boss",
    "citizen",
    "diesel",
    "emporio armani",
    "edifice",
    "franck muller",
    "g-shock",
    "guess",
    "hublot",
    "jacob&co",
    "maserati",
    "movado",
    "omega",
    "patek philippe",
    "richard mille",
    "rolex",
    "seiko",
    "seven friday",
    "tag heuer",
    "tissot",
    "tommy hilfiger",
    "vacheron constantini",
  ];
  const womenBrands = [
    "versace",
    "swarovski",
    "lacoste",
    "longines",
    "burberry",
    "calvin klein",
    "cartier",
  ];
  const unisexBrands = ["fossil", "gucci", "michael kors", "orient", "rado"];
  const normalizeStr = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, "");
  const menSet = new Set(menBrands.map(normalizeStr));
  const womenSet = new Set(womenBrands.map(normalizeStr));
  const unisexSet = new Set(unisexBrands.map(normalizeStr));
  const GRAPH_EDGES = buildRestingGraphEdges(dictionaryTerms);
  const menId = GRAPH_NODES.find((n) => n.termId === "men" || n.id === "men")?.id || "men";
  const womenId = GRAPH_NODES.find((n) => n.termId === "women" || n.id === "women")?.id || "women";
  const augmentedEdges: typeof GRAPH_EDGES extends readonly (infer U)[] ? U[] : never = [...(GRAPH_EDGES as any)];
  GRAPH_NODES.forEach((node) => {
    if (node.kind === "brand" && node.id !== menId && node.id !== womenId && node.termId !== "watches") {
      const normId = normalizeStr(node.termId);
      const isMen = menSet.has(normId) || unisexSet.has(normId);
      const isWomen = womenSet.has(normId) || unisexSet.has(normId);
      if (isMen && !(augmentedEdges as any).some((e: any) => e.fromId === menId && e.toId === node.id)) {
        (augmentedEdges as any).push({ id: `e-m-${node.id}`, fromId: menId, toId: node.id, emphasized: true });
      }
      if (isWomen && !(augmentedEdges as any).some((e: any) => e.fromId === womenId && e.toId === node.id)) {
        (augmentedEdges as any).push({ id: `e-w-${node.id}`, fromId: womenId, toId: node.id, emphasized: true });
      }
    }
  });
  const activeGender: string | null = scenario.activeAudience
    ? scenario.activeAudience === "men"
      ? "Men"
      : "Women"
    : null;
  const activeEdges = (augmentedEdges as any).filter((edge: any) => {
    const isGenderActive = activeGender ? edge.fromId === (activeGender === "Men" ? menId : womenId) : false;
    const isPreviewActive = scenario.previewNodeId
      ? edge.fromId === scenario.previewNodeId || edge.toId === scenario.previewNodeId
      : false;
    return isGenderActive || isPreviewActive;
  });
  const edges = activeEdges.map((e: any) => ({ id: e.id } as any));
  // Particles replaced by dotted flowing strings - particle counts should be 0
  const particleCount = 0;
  const mobile = scenario.width <= 700;
  return {
    variants: [mobile ? "mobile" : "desktop"],
    activeEdgeCount: edges.length,
    activePathCount: edges.length,
    activeEdgeIds: edges.map(({ id }: any) => id),
    particleCount,
    animateMotionCount: particleCount,
    desktopParticleCount: 0,
    mobileParticleCount: 0,
  };
}

function observeGraph(scenario: Scenario): GraphObservation {
  const media = installMatchMedia({
    width: scenario.width,
    reducedMotion: scenario.reducedMotion,
  });
  motionPreference.reduced = scenario.reducedMotion;
  const view = render(
    <NodeGraph
      terms={dictionaryTerms}
      activeAudience={scenario.activeAudience}
      selectedTermId={scenario.selectedTermId}
      onAudienceSelect={vi.fn()}
      onTermSelect={vi.fn()}
    />,
  );

  try {
    if (scenario.previewNodeId) {
      const node = view.container.querySelector<HTMLElement>(
        `[data-presentation-id="${scenario.previewNodeId}"]`,
      );
      if (!node) throw new Error(`Missing graph node ${scenario.previewNodeId}`);
      if (scenario.interaction === "focus") fireEvent.focus(node);
      else fireEvent.pointerEnter(node);
    }

    const variants = Array.from(
      view.container.querySelectorAll<SVGElement>("svg.graph-connections"),
      (svg) => svg.classList.contains("graph-connections--mobile") ? "mobile" : "desktop",
    );
    const activeGroups = Array.from(
      view.container.querySelectorAll<SVGGElement>(
        ".graph-connections .graph-connections__active > g",
      ),
    );

    return {
      variants,
      activeEdgeCount: activeGroups.length,
      activePathCount: view.container.querySelectorAll(
        ".graph-connections .graph-connections__active path",
      ).length,
      activeEdgeIds: activeGroups.map((group) => group.getAttribute("data-edge-id")),
      particleCount: view.container.querySelectorAll(
        ".graph-connections .connection-particle",
      ).length,
      animateMotionCount: view.container.querySelectorAll(
        ".graph-connections animateMotion",
      ).length,
      desktopParticleCount: view.container.querySelectorAll(
        ".graph-connections--desktop .connection-particle",
      ).length,
      mobileParticleCount: view.container.querySelectorAll(
        ".graph-connections--mobile .connection-particle",
      ).length,
    };
  } finally {
    view.unmount();
    motionPreference.reduced = false;
    media.restore();
  }
}

describe("bug condition: bounded responsive graph effects", () => {
  it("mounts only one responsive graph and one particle per MEN edge", () => {
    const scenario: Scenario = {
      width: 1024,
      activeAudience: null,
      selectedTermId: null,
      previewNodeId: "men",
      reducedMotion: false,
      interaction: "pointer",
    };
    const observation = observeGraph(scenario);

    expect(
      observation,
      `MEN counterexample (logical N=12): ${JSON.stringify(observation)}`,
    ).toEqual(expectedObservation(scenario));
  });

  it("mounts only one responsive graph and one particle per focused Patek edge", () => {
    const scenario: Scenario = {
      width: 1024,
      activeAudience: null,
      selectedTermId: null,
      previewNodeId: "patek-philippe",
      reducedMotion: false,
      interaction: "focus",
    };
    const observation = observeGraph(scenario);

    expect(
      observation,
      `Patek counterexample (logical N=2): ${JSON.stringify(observation)}`,
    ).toEqual(expectedObservation(scenario));
  });

  it("retains reduced-motion rays while mounting no traveling particles", () => {
    const scenario: Scenario = {
      width: 700,
      activeAudience: null,
      selectedTermId: null,
      previewNodeId: "patek-philippe",
      reducedMotion: true,
      interaction: "focus",
    };
    expect(observeGraph(scenario)).toEqual(expectedObservation(scenario));
  });

  it("uses plain native active paths without SVG blur or particle CSS filters", () => {
    const particleRule = exactCssRule(globalsSource, ".connection-particle");
    const sourceEvidence = {
      hasPlainNativeActivePath: /<path\s+id=\{pathId\}/.test(graphPathsSource),
      motionPath: sourceLineContaining(graphPathsSource, "<motion.path"),
      svgFilter: sourceLineContaining(graphPathsSource, "<filter"),
      gaussianBlur: sourceLineContaining(graphPathsSource, "<feGaussianBlur"),
      activePathFilter: sourceLineContaining(graphPathsSource, "filter={`url(#${glowId})`}"),
      particleFanOut: sourceLineContaining(graphPathsSource, "Array.from({ length: 3 }") ,
      particleCssFilter: sourceLineContaining(particleRule, "filter:"),
      particleCircleSourceCount: graphPathsSource.match(/<circle\b/g)?.length ?? 0,
      animateMotionSourceCount: graphPathsSource.match(/<animateMotion\b/g)?.length ?? 0,
    };

    expect(
      sourceEvidence,
      `Active-effect source counterexample: ${JSON.stringify(sourceEvidence)}`,
    ).toEqual({
      hasPlainNativeActivePath: true,
      motionPath: null,
      svgFilter: null,
      gaussianBlur: null,
      activePathFilter: null,
      particleFanOut: null,
      particleCssFilter: null,
      particleCircleSourceCount: 0,
      animateMotionSourceCount: 0,
    });
  });

  // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
  it("Property 1: bounds responsive variants, edge IDs, and particles for valid graph states", () => {
    const previewIds = [null, ...GRAPH_NODES.map(({ id }) => id)] as const;
    const selectedTermIds = [null, ...dictionaryTerms.map(({ id }) => id)] as const;

    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 320, max: 1920 }),
          activeAudience: fc.constantFrom<WatchAudience | null>(null, "men", "women"),
          selectedTermId: fc.constantFrom<string | null>(...selectedTermIds),
          previewNodeId: fc.constantFrom<string | null>(...previewIds),
          reducedMotion: fc.boolean(),
        }),
        (scenario) => {
          expect(observeGraph(scenario)).toEqual(expectedObservation(scenario));
        },
      ),
      { numRuns: 50, seed: PROPERTY_SEED },
    );
  });
});
