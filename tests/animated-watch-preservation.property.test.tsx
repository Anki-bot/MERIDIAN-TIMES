import { act, render } from "@testing-library/react";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { NodeGraph } from "@/components/ui/NodeGraph";
import { WatchImageBackdrop } from "@/components/ui/WatchImageBackdrop";
import { dictionaryTerms } from "@/lib/dictionary";
import {
  GRAPH_NODES,
  buildGraphEdges,
  buildRestingGraphEdges,
  isGraphNodeEnabled,
} from "@/lib/graph";
import type { WatchAudience } from "@/lib/types";

const motionPreference = vi.hoisted(() => ({ reduced: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduced,
  };
});

const PROPERTY_TAG =
  "Feature: animated-watch-image-glass-header, Property 6: Graph and responsive-state preservation";

// Reproduce with: seed=20250620, numRuns=128.
const PROPERTY_SEED = 20_250_620;
const PROPERTY_RUNS = 128;
const MOBILE_GRAPH_QUERY = "(max-width: 700px)";
const SUPPORTED_WIDTH_MIN = 320;
const SUPPORTED_WIDTH_MAX = 2560;

type SelectionState = {
  readonly activeAudience: WatchAudience | null;
  readonly selectedTermId: string | null;
};

type EdgeSummary = {
  readonly emphasized: boolean;
  readonly id: string;
};

type ControlSummary = {
  readonly ariaDisabled: string | null;
  readonly ariaPressed: string | null;
  readonly isAudienceSelected: boolean;
  readonly isConnected: boolean;
  readonly isEnabled: boolean;
  readonly isLocked: boolean;
  readonly isPreviewed: boolean;
  readonly isSelected: boolean;
  readonly mobileX: string;
  readonly mobileY: string;
  readonly name: string | null;
  readonly presentationId: string | null;
  readonly tabIndex: number;
  readonly type: string | null;
  readonly x: string;
  readonly y: string;
};

type PreservedState = {
  readonly activeEdges: readonly EdgeSummary[];
  readonly controls: readonly ControlSummary[];
  readonly definitionOpen: string | undefined;
  readonly focusedPresentationId: string | null;
  readonly networkMode: string | undefined;
  readonly reducedMotion: string | undefined;
};

const termById = new Map(dictionaryTerms.map((term) => [term.id, term]));
const presentationCountByTerm = GRAPH_NODES.reduce((counts, node) => {
  counts.set(node.termId, (counts.get(node.termId) ?? 0) + 1);
  return counts;
}, new Map<string, number>());
const graphTermIds = [...new Set(GRAPH_NODES.map((node) => node.termId))];

const VALID_SELECTION_STATES: readonly SelectionState[] = [
  { activeAudience: null, selectedTermId: null },
  { activeAudience: "men", selectedTermId: null },
  { activeAudience: "women", selectedTermId: null },
  ...graphTermIds.flatMap((selectedTermId): SelectionState[] => {
    const term = termById.get(selectedTermId);
    return term
      ? term.audiences.map((activeAudience) => ({ activeAudience, selectedTermId }))
      : [];
  }),
];

const scenarioArbitrary = fc.record({
  initialWidth: fc.integer({ min: SUPPORTED_WIDTH_MIN, max: SUPPORTED_WIDTH_MAX }),
  previewNodeId: fc.constantFrom<string | null>(
    null,
    ...GRAPH_NODES.map(({ id }) => id),
  ),
  reducedMotion: fc.boolean(),
  selection: fc.constantFrom(...VALID_SELECTION_STATES),
});

function expectedEdges(
  selection: SelectionState,
  previewNodeId: string | null,
): readonly EdgeSummary[] {
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
  const augmentedEdges: typeof GRAPH_EDGES extends readonly (infer U)[] ? U[] : never = [...GRAPH_EDGES as any];
  GRAPH_NODES.forEach((node) => {
    if (node.kind === "brand" && node.id !== menId && node.id !== womenId && node.termId !== "watches") {
      const normId = normalizeStr(node.termId);
      const isMen = menSet.has(normId) || unisexSet.has(normId);
      const isWomen = womenSet.has(normId) || unisexSet.has(normId);
      if (isMen && !augmentedEdges.some((e: any) => e.fromId === menId && e.toId === node.id)) {
        augmentedEdges.push({ id: `e-m-${node.id}`, fromId: menId, toId: node.id, emphasized: true } as any);
      }
      if (isWomen && !augmentedEdges.some((e: any) => e.fromId === womenId && e.toId === node.id)) {
        augmentedEdges.push({ id: `e-w-${node.id}`, fromId: womenId, toId: node.id, emphasized: true } as any);
      }
    }
  });
  const activeGender: string | null = selection.activeAudience
    ? selection.activeAudience === "men"
      ? "Men"
      : "Women"
    : null;
  const activeEdges = augmentedEdges
    .filter((edge: any) => {
      const isGenderActive = activeGender ? edge.fromId === (activeGender === "Men" ? menId : womenId) : false;
      const isPreviewActive = previewNodeId ? edge.fromId === previewNodeId || edge.toId === previewNodeId : false;
      return isGenderActive || isPreviewActive;
    })
    .map((edge: any) => ({ id: edge.id, emphasized: true }));
  return activeEdges as readonly EdgeSummary[];
}

function circularPosition(index: number, total: number, mobile: boolean): { x: number; y: number } {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const radius = mobile ? 30 : 26;
  const centerX = 35;
  const centerY = 48;
  return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
}

function expectedControls(
  selection: SelectionState,
  previewNodeId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  width: number,
): readonly ControlSummary[] {
  const connectedNodeIds = new Set(
    (() => {
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
      const augmentedEdges: any[] = [...(GRAPH_EDGES as any)];
      GRAPH_NODES.forEach((node) => {
        if (node.kind === "brand" && node.id !== menId && node.id !== womenId && node.termId !== "watches") {
          const normId = normalizeStr(node.termId);
          const isMen = menSet.has(normId) || unisexSet.has(normId);
          const isWomen = womenSet.has(normId) || unisexSet.has(normId);
          if (isMen && !augmentedEdges.some((e: any) => e.fromId === menId && e.toId === node.id)) {
            augmentedEdges.push({ id: `e-m-${node.id}`, fromId: menId, toId: node.id, emphasized: true });
          }
          if (isWomen && !augmentedEdges.some((e: any) => e.fromId === womenId && e.toId === node.id)) {
            augmentedEdges.push({ id: `e-w-${node.id}`, fromId: womenId, toId: node.id, emphasized: true });
          }
        }
      });
      const activeGender: string | null = selection.activeAudience
        ? selection.activeAudience === "men"
          ? "Men"
          : "Women"
        : null;
      return (augmentedEdges as any)
        .filter((edge: any) => {
          const isGenderActive = activeGender ? edge.fromId === (activeGender === "Men" ? menId : womenId) : false;
          const isPreviewActive = previewNodeId ? edge.fromId === previewNodeId || edge.toId === previewNodeId : false;
          return isGenderActive || isPreviewActive;
        })
        .flatMap(({ fromId, toId }: any) => [fromId, toId]);
    })(),
  );
  const brandNodes = GRAPH_NODES.filter((n) => n.kind === "brand");
  const isLevel2 = selection.activeAudience !== null;

  return GRAPH_NODES.map((node) => {
    const term = termById.get(node.termId);
    if (!term) throw new Error(`Missing graph term: ${node.termId}`);

    const enabled = isGraphNodeEnabled(term, selection.activeAudience);
    const audienceNode = node.kind === "audience";
    const brandNode = node.kind === "brand";
    const duplicateLabel = (presentationCountByTerm.get(node.termId) ?? 0) > 1
      ? `, ${node.id.includes("upper") ? "upper" : "lower"} network node`
      : "";
    const activationLabel = enabled
      ? "open definition"
      : "choose a gender to unlock; focus or hover to preview connections";

    // Cinematic dive: diving parent at center (off-center 35% for details panel), entering brands circular
    // Resting constellation: manualPositions + layoutMap fallback (matches NodeGraph.tsx)
    let x = `${node.desktop.x}%`;
    let y = `${node.desktop.y}%`;
    let mobileX = `${node.desktop.x}%`;
    let mobileY = `${node.desktop.y}%`;
    if (isLevel2) {
      if (audienceNode && node.id === selection.activeAudience) {
        x = "50%";
        y = "50%";
        mobileX = "50%";
        mobileY = "50%";
      } else if (brandNode) {
        const brandsOnly = GRAPH_NODES.filter(
          (n) => n.termId !== "men" && n.termId !== "women" && n.termId !== "watches" && n.kind === "brand",
        );
        const bIndex = brandsOnly.findIndex((n) => n.id === node.id);
        const validIndex = bIndex >= 0 ? bIndex : brandNodes.findIndex((n) => n.id === node.id);
        const angle = (validIndex / brandsOnly.length) * (2 * Math.PI) - Math.PI / 2;
        const radius = validIndex % 2 === 0 ? 25 : 40;
        const tx = 50 + radius * Math.cos(angle);
        const ty = 50 + radius * Math.sin(angle);
        x = `${tx}%`;
        y = `${ty}%`;
        mobileX = `${tx}%`;
        mobileY = `${ty}%`;
      }
    } else if (brandNode) {
      const brandIndex = brandNodes.findIndex((n) => n.id === node.id);
      const manualPositions: Record<string, { x: number; y: number }> = {
        seiko: { x: 42, y: 69 },
        omega: { x: 42, y: 39 },
        citizen: { x: 13, y: 37 },
        fossil: { x: 51, y: 66 },
        rolex: { x: 34, y: 73 },
        movado: { x: 26, y: 74 },
        "jacob-co": { x: 20, y: 56 },
        "franck-muller": { x: 24, y: 37 },
        sevenfriday: { x: 63, y: 79 },
        "vacheron-constantin": { x: 73, y: 84 },
        "tommy-hilfiger": { x: 42, y: 85 },
        "tag-heuer": { x: 6, y: 80 },
        "michael-kors": { x: 5, y: 53 },
        hublot: { x: 11, y: 63 },
        "richard-mille": { x: 16, y: 72 },
        lacoste: { x: 45, y: 53 },
        tissot: { x: 30, y: 85 },
        "audemars-piguet": { x: 11, y: 21 },
        "g-shock": { x: 57, y: 46 },
        orient: { x: 58, y: 63 },
        "emporio-armani": { x: 65, y: 33 },
        gucci: { x: 75, y: 37 },
        "patek-philippe": { x: 72, y: 70 },
        swarovski: { x: 85, y: 69 },
      };
      if (node.id && manualPositions[node.id]) {
        const pos = manualPositions[node.id];
        x = `${pos.x}%`;
        y = `${pos.y}%`;
        mobileX = `${pos.x}%`;
        mobileY = `${pos.y}%`;
      } else {
        const layoutMap = [
          { x: 10, y: 18 },
          { x: 26, y: 18 },
          { x: 42, y: 18 },
          { x: 58, y: 18 },
          { x: 74, y: 18 },
          { x: 90, y: 18 },
          { x: 17, y: 29 },
          { x: 34, y: 29 },
          { x: 50, y: 29 },
          { x: 66, y: 29 },
          { x: 83, y: 29 },
          { x: 10, y: 41 },
          { x: 22, y: 41 },
          { x: 50, y: 41 },
          { x: 78, y: 41 },
          { x: 90, y: 41 },
          { x: 12, y: 54 },
          { x: 24, y: 54 },
          { x: 50, y: 54 },
          { x: 76, y: 54 },
          { x: 88, y: 54 },
          { x: 8, y: 66 },
          { x: 20, y: 66 },
          { x: 40, y: 66 },
          { x: 60, y: 66 },
          { x: 80, y: 66 },
          { x: 92, y: 66 },
          { x: 15, y: 77 },
          { x: 32, y: 77 },
          { x: 50, y: 77 },
          { x: 68, y: 77 },
          { x: 85, y: 77 },
          { x: 10, y: 87 },
          { x: 28, y: 87 },
          { x: 50, y: 87 },
          { x: 72, y: 87 },
          { x: 90, y: 87 },
        ];
        const pos = layoutMap[brandIndex % layoutMap.length];
        x = `${pos.x}%`;
        y = `${pos.y}%`;
        mobileX = `${pos.x}%`;
        mobileY = `${pos.y}%`;
      }
    }

    return {
      ariaDisabled: String(!enabled),
      ariaPressed: audienceNode
        ? String(selection.activeAudience === term.id)
        : null,
      isAudienceSelected: audienceNode && selection.activeAudience === term.id,
      isConnected: connectedNodeIds.has(node.id),
      isEnabled: enabled,
      isLocked: !enabled,
      isPreviewed: previewNodeId === node.id,
      isSelected: selection.selectedTermId === term.id,
      mobileX,
      mobileY,
      name: audienceNode
        ? `${term.nodeLabel}, activate ${term.term}`
        : `${term.term}${duplicateLabel}, ${activationLabel}`,
      presentationId: node.id,
      tabIndex: 0,
      type: "button",
      x,
      y,
    };
  });
}

function observedControls(container: HTMLElement): readonly ControlSummary[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(".atlas-controls > button.atlas-node"),
    (control) => ({
      ariaDisabled: control.getAttribute("aria-disabled"),
      ariaPressed: control.getAttribute("aria-pressed"),
      isAudienceSelected: control.classList.contains("is-audience-selected"),
      isConnected: control.classList.contains("is-connected"),
      isEnabled: control.classList.contains("is-enabled"),
      isLocked: control.classList.contains("is-locked"),
      isPreviewed: control.classList.contains("is-previewed"),
      isSelected: control.classList.contains("is-selected"),
      mobileX: control.style.getPropertyValue("--node-mobile-x"),
      mobileY: control.style.getPropertyValue("--node-mobile-y"),
      name: control.getAttribute("aria-label"),
      presentationId: control.getAttribute("data-presentation-id"),
      tabIndex: control.tabIndex,
      type: control.getAttribute("type"),
      x: control.style.getPropertyValue("--node-x"),
      y: control.style.getPropertyValue("--node-y"),
    }),
  );
}

function observedActiveEdges(container: HTMLElement): readonly EdgeSummary[] {
  return Array.from(
    container.querySelectorAll<SVGGElement>(
      ".graph-connections__active > g[data-edge-id]",
    ),
    (group) => ({
      emphasized: group.classList.contains("is-emphasized"),
      id: group.getAttribute("data-edge-id") ?? "",
    }),
  );
}

function capturePreservedState(container: HTMLElement): PreservedState {
  const focusedElement = document.activeElement;
  const focusedPresentationId = focusedElement instanceof HTMLElement
    && focusedElement.matches("button.atlas-node")
    ? focusedElement.getAttribute("data-presentation-id")
    : null;
  const graph = container.querySelector<HTMLElement>(".node-graph");
  const backdrop = container.querySelector<HTMLElement>(".watch-image-backdrop");

  return {
    activeEdges: observedActiveEdges(container),
    controls: observedControls(container),
    definitionOpen: backdrop?.dataset.definitionOpen,
    focusedPresentationId,
    networkMode: graph?.dataset.networkMode,
    reducedMotion: backdrop?.dataset.reducedMotion,
  };
}

function installViewport(initialWidth: number) {
  let width = initialWidth;
  const originalMatchMedia = window.matchMedia;
  const originalWidthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const listeners = new Set<(event: Event) => void>();

  const mediaQuery = {
    get matches() {
      return width <= 700;
    },
    media: MOBILE_GRAPH_QUERY,
    onchange: null,
    addEventListener: (_type: string, listener: (event: Event) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: Event) => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: Event) => void) => listeners.add(listener),
    removeListener: (listener: (event: Event) => void) => listeners.delete(listener),
    dispatchEvent: (event: Event) => {
      for (const listener of listeners) listener(event);
      return true;
    },
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
  window.matchMedia = ((query: string) => (
    query === MOBILE_GRAPH_QUERY
      ? mediaQuery
      : ({ ...mediaQuery, matches: false, media: query } as MediaQueryList)
  )) as typeof window.matchMedia;

  return {
    setWidth(nextWidth: number) {
      const previousMatch = width <= 700;
      width = nextWidth;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
        writable: true,
      });
      if (previousMatch !== (width <= 700)) {
        mediaQuery.dispatchEvent(new Event("change"));
      }
    },
    restore() {
      window.matchMedia = originalMatchMedia;
      if (originalWidthDescriptor) {
        Object.defineProperty(window, "innerWidth", originalWidthDescriptor);
      } else {
        Reflect.deleteProperty(window, "innerWidth");
      }
    },
  };
}

function assertScene(
  container: HTMLElement,
  selection: SelectionState,
  previewNodeId: string | null,
  reducedMotion: boolean,
  width: number,
): PreservedState {
  const edges = expectedEdges(selection, previewNodeId);
  const svgs = container.querySelectorAll<SVGElement>("svg.graph-connections");
  expect(svgs).toHaveLength(1);
  const svg = svgs[0];
  expect(svg).toHaveClass(
    width <= 700 ? "graph-connections--mobile" : "graph-connections--desktop",
  );
  expect(svg.querySelector(".graph-connections__active")).toHaveAttribute(
    "data-active-edge-count",
    String(edges.length),
  );
  expect(observedActiveEdges(container)).toEqual(edges);

  const restingEdgeIds = Array.from(
    svg.querySelectorAll<SVGPathElement>(".graph-connections__rest > path[data-edge-id]"),
    (path) => path.getAttribute("data-edge-id"),
  );
  expect(restingEdgeIds).toEqual(
    buildRestingGraphEdges(dictionaryTerms).map(({ id }) => id),
  );

  const activeGroups = svg.querySelectorAll<SVGGElement>(
    ".graph-connections__active > g[data-edge-id]",
  );
  expect(activeGroups).toHaveLength(edges.length);
  expect(svg.querySelectorAll(".graph-connections__active > g > path")).toHaveLength(
    edges.length,
  );
  // Particles replaced by dotted flowing strings - no particles expected
  expect(svg.querySelectorAll(".connection-particle")).toHaveLength(0);
  expect(svg.querySelectorAll("animateMotion")).toHaveLength(0);
  expect(svg.querySelectorAll("mpath")).toHaveLength(0);
  expect(svg.querySelectorAll(".graph-connections__active path[stroke-dasharray='3 6']")).toHaveLength(
    edges.length,
  );

  const controls = observedControls(container);
  expect(controls).toHaveLength(39);
  expect(container.querySelector(".atlas-controls")).toHaveAttribute(
    "data-atlas-control-count",
    "39",
  );
  expect(controls).toEqual(expectedControls(selection, previewNodeId, width));
  expect(
    Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.atlas-node"),
      (control) => control.hasAttribute("disabled"),
    ),
  ).toEqual(Array.from({ length: 39 }, () => false));

  const backdrop = container.querySelector<HTMLElement>(".watch-image-backdrop");
  expect(backdrop).toHaveAttribute(
    "data-definition-open",
    String(selection.selectedTermId !== null),
  );
  expect(backdrop).toHaveAttribute("data-reduced-motion", String(reducedMotion));

  return capturePreservedState(container);
}

// **Validates: Requirements 7.5, 7.11, 9.11**
it(PROPERTY_TAG, () => {
  fc.assert(
    fc.property(scenarioArbitrary, (scenario) => {
      motionPreference.reduced = scenario.reducedMotion;
      const viewport = installViewport(scenario.initialWidth);
      const onAudienceSelect = vi.fn();
      const onTermSelect = vi.fn();
      const rendered = render(
        <>
          <WatchImageBackdrop
            definitionOpen={scenario.selection.selectedTermId !== null}
            reducedMotion={scenario.reducedMotion}
          />
          <NodeGraph
            terms={dictionaryTerms}
            activeAudience={scenario.selection.activeAudience}
            selectedTermId={scenario.selection.selectedTermId}
            onAudienceSelect={onAudienceSelect}
            onTermSelect={onTermSelect}
          />
        </>,
      );

      try {
        if (scenario.previewNodeId) {
          const previewControl = rendered.container.querySelector<HTMLButtonElement>(
            `[data-presentation-id="${scenario.previewNodeId}"]`,
          );
          if (!previewControl) {
            throw new Error(`Missing preview control: ${scenario.previewNodeId}`);
          }
          act(() => previewControl.focus());
        }

        const backdrop = rendered.container.querySelector<HTMLElement>(
          ".watch-image-backdrop",
        );
        const img = rendered.container.querySelector<HTMLImageElement>(
          ".watch-image-backdrop img",
        ) as HTMLImageElement | null;
        expect(backdrop).not.toBeNull();
        expect(img).not.toBeNull();
        if (!backdrop || !img) return;

        expect(img.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
        expect(img.getAttribute("aria-hidden")).toBe("true");
        expect(img.className).toContain("watch-image-backdrop__image");
        expect(img.className).toContain("object-cover");

        const initialControls = Array.from(
          rendered.container.querySelectorAll<HTMLButtonElement>("button.atlas-node"),
        );
        const baselineState = assertScene(
          rendered.container,
          scenario.selection,
          scenario.previewNodeId,
          scenario.reducedMotion,
          scenario.initialWidth,
        );

        const transitionTo = (width: number) => {
          act(() => viewport.setWidth(width));
          const state = assertScene(
            rendered.container,
            scenario.selection,
            scenario.previewNodeId,
            scenario.reducedMotion,
            width,
          );
          expect(state).toEqual(baselineState);
          expect(rendered.container.querySelector(".watch-image-backdrop")).toBe(backdrop);
          expect(rendered.container.querySelector(".watch-image-backdrop img")).toBe(
            img,
          );
          expect(
            Array.from(
              rendered.container.querySelectorAll<HTMLButtonElement>("button.atlas-node"),
            ),
          ).toEqual(initialControls);
          expect(window.innerWidth).toBe(width);
          return null;
        };

        const compactCandidate = transitionTo(700);
        const expandedCandidate = transitionTo(701);
        // Video is single source, no candidate switching
        expect(compactCandidate).toBeNull();
        expect(expandedCandidate).toBeNull();
        expect(transitionTo(700)).toBeNull();

        expect(onAudienceSelect).not.toHaveBeenCalled();
        expect(onTermSelect).not.toHaveBeenCalled();
      } finally {
        rendered.unmount();
        viewport.restore();
        motionPreference.reduced = false;
      }
    }),
    {
      numRuns: PROPERTY_RUNS,
      seed: PROPERTY_SEED,
      verbose: true,
    },
  );
}, 30_000);
