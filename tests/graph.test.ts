import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dictionaryTerms } from "@/lib/dictionary";
import {
  GRAPH_NODES,
  audienceForTerm,
  buildGraphEdges,
  buildRestingGraphEdges,
  getGraphNode,
  isGraphNodeEnabled,
} from "@/lib/graph";
import type { WatchAudience } from "@/lib/types";

const PROPERTY_SEED = 0x51a1c0de;
const PRESERVATION_PROPERTY_SEED = 0xC0FFEE;
const REFERENCE_BRAND_IDS = [
  "audemars-piguet",
  "armani-exchange",
  "bentley",
  "hugo-boss",
  "burberry",
  "cartier",
  "citizen",
  "calvin-klein",
  "diesel",
  "emporio-armani",
  "edifice",
  "fossil",
  "franck-muller",
  "g-shock",
  "gucci",
  "guess",
  "hublot",
  "jacob-co",
  "lacoste",
  "longines",
  "maserati",
  "michael-kors",
  "movado",
  "omega",
  "orient",
  "patek-philippe",
  "rado",
  "richard-mille",
  "rolex",
  "seiko",
  "sevenfriday",
  "swarovski",
  "tag-heuer",
  "tissot",
  "tommy-hilfiger",
  "vacheron-constantin",
  "versace",
] as const;

const OBSERVED_BRAND_PRESENTATIONS = [
  { presentationId: "audemars-piguet", termId: "audemars-piguet" },
  { presentationId: "armani-exchange", termId: "armani-exchange" },
  { presentationId: "bentley", termId: "bentley" },
  { presentationId: "hugo-boss", termId: "hugo-boss" },
  { presentationId: "burberry", termId: "burberry" },
  { presentationId: "cartier", termId: "cartier" },
  { presentationId: "citizen", termId: "citizen" },
  { presentationId: "calvin-klein", termId: "calvin-klein" },
  { presentationId: "diesel", termId: "diesel" },
  { presentationId: "emporio-armani", termId: "emporio-armani" },
  { presentationId: "edifice", termId: "edifice" },
  { presentationId: "fossil", termId: "fossil" },
  { presentationId: "franck-muller", termId: "franck-muller" },
  { presentationId: "g-shock", termId: "g-shock" },
  { presentationId: "gucci", termId: "gucci" },
  { presentationId: "guess", termId: "guess" },
  { presentationId: "hublot", termId: "hublot" },
  { presentationId: "jacob-co", termId: "jacob-co" },
  { presentationId: "lacoste", termId: "lacoste" },
  { presentationId: "longines", termId: "longines" },
  { presentationId: "maserati", termId: "maserati" },
  { presentationId: "michael-kors", termId: "michael-kors" },
  { presentationId: "movado", termId: "movado" },
  { presentationId: "omega", termId: "omega" },
  { presentationId: "orient", termId: "orient" },
  { presentationId: "patek-philippe", termId: "patek-philippe" },
  { presentationId: "rado", termId: "rado" },
  { presentationId: "richard-mille", termId: "richard-mille" },
  { presentationId: "rolex", termId: "rolex" },
  { presentationId: "seiko", termId: "seiko" },
  { presentationId: "sevenfriday", termId: "sevenfriday" },
  { presentationId: "swarovski", termId: "swarovski" },
  { presentationId: "tag-heuer", termId: "tag-heuer" },
  { presentationId: "tissot", termId: "tissot" },
  { presentationId: "tommy-hilfiger", termId: "tommy-hilfiger" },
  { presentationId: "vacheron-constantin", termId: "vacheron-constantin" },
  { presentationId: "versace", termId: "versace" },
] as const;

const OBSERVED_PRESENTATION_BY_ID: ReadonlyMap<
  string,
  (typeof OBSERVED_BRAND_PRESENTATIONS)[number]
> = new Map(
  OBSERVED_BRAND_PRESENTATIONS.map((presentation) => [presentation.presentationId, presentation]),
);

function observedAudienceEdgeIds(audience: WatchAudience): readonly string[] {
  return [
    "men--women",
    ...OBSERVED_BRAND_PRESENTATIONS.map(({ presentationId }) => `${audience}--${presentationId}`),
  ];
}

const OBSERVED_RESTING_EDGE_IDS = [
  "men--women",
  ...OBSERVED_BRAND_PRESENTATIONS.flatMap(({ presentationId }) => [
    `men--${presentationId}`,
    `women--${presentationId}`,
  ]),
];

function observedActiveEdgeIds(
  activeAudience: WatchAudience | null,
  previewNodeId: string | null,
): readonly string[] {
  if (previewNodeId === "men" || previewNodeId === "women") {
    return observedAudienceEdgeIds(previewNodeId);
  }
  if (previewNodeId && OBSERVED_PRESENTATION_BY_ID.has(previewNodeId)) {
    return [`men--${previewNodeId}`, `women--${previewNodeId}`];
  }
  return activeAudience ? observedAudienceEdgeIds(activeAudience) : [];
}

function observedEdgeTermId(edgeId: string): string {
  if (edgeId === "men--women") return "women";
  const presentationId = edgeId.slice(edgeId.indexOf("--") + 2);
  return OBSERVED_PRESENTATION_BY_ID.get(presentationId)?.termId ?? presentationId;
}

function observedEdgeSummary({
  activeAudience,
  selectedTermId,
  previewNodeId,
}: {
  activeAudience: WatchAudience | null;
  selectedTermId: string | null;
  previewNodeId: string | null;
}) {
  const ids = observedActiveEdgeIds(activeAudience, previewNodeId);
  // High-contrast particles: emphasized when hovering (preview) or when selected term matches
  const isPreviewEmphasized = previewNodeId !== null;
  return ids.map((id) => ({
    id,
    emphasized: isPreviewEmphasized || observedEdgeTermId(id) === selectedTermId,
  }));
}

describe("node graph activation", () => {
  it("uses unique presentation ids", () => {
    expect(GRAPH_NODES.map(({ id }) => id)).toEqual([
      "men",
      "women",
      ...REFERENCE_BRAND_IDS,
    ]);
    expect(new Set(GRAPH_NODES.map(({ id }) => id)).size).toBe(GRAPH_NODES.length);
    expect(GRAPH_NODES.filter(({ termId }) => termId === "rolex").map(({ id }) => id)).toEqual([
      "rolex",
    ]);
    expect(GRAPH_NODES.every(({ termId }) => dictionaryTerms.some(({ id }) => id === termId))).toBe(true);
  });

  it("matches the supplied desktop node placement", () => {
    expect(getGraphNode("men")?.desktop).toEqual({ x: 32, y: 55 });
    expect(getGraphNode("women")?.desktop).toEqual({ x: 67, y: 55 });
    expect(getGraphNode("patek-philippe")?.desktop).toEqual({ x: 24, y: 47 });
    expect(getGraphNode("hublot")?.desktop).toEqual({ x: 68, y: 81 });
  });

  it("renders the observed complete resting relationship matrix without activating it", () => {
    const resting = buildRestingGraphEdges(dictionaryTerms);
    expect(resting.map(({ id }) => id)).toEqual(OBSERVED_RESTING_EDGE_IDS);
    expect(resting.every(({ active, emphasized }) => !active && !emphasized)).toBe(true);
    expect(buildGraphEdges(dictionaryTerms, null, null)).toEqual([]);
  });

  it("fans the selected gender to compatible brands and emphasizes selected duplicates", () => {
    const edges = buildGraphEdges(dictionaryTerms, "women", "rolex");
    expect(edges).toHaveLength(REFERENCE_BRAND_IDS.length + 1);
    expect(edges.filter(({ toTermId }) => toTermId === "rolex")).toHaveLength(1);
    expect(edges.filter(({ toTermId }) => toTermId === "rolex").every(({ emphasized }) => emphasized)).toBe(true);
    expect(edges.every(({ active }) => active)).toBe(true);
    expect(edges.filter(({ id }) => id !== "men--women").every(({ fromTermId }) => fromTermId === "women")).toBe(true);
  });

  it("previews either a gender fan or every compatible ray for one brand", () => {
    const menPreview = buildGraphEdges(dictionaryTerms, null, null, "men");
    expect(menPreview).toHaveLength(REFERENCE_BRAND_IDS.length + 1);
    expect(menPreview.filter(({ id }) => id !== "men--women").every(({ fromId }) => fromId === "men")).toBe(true);

    const brandPreview = buildGraphEdges(dictionaryTerms, null, null, "patek-philippe");
    expect(brandPreview).toHaveLength(2);
    expect(brandPreview.every(({ toId, emphasized }) => toId === "patek-philippe" && emphasized)).toBe(true);
    expect(brandPreview.map(({ fromTermId }) => fromTermId).sort()).toEqual(["men", "women"]);
  });

  it("preserves the observed edge-id and emphasis matrix for every preview and persistent state", () => {
    const scenarios = [
      {
        label: "resting",
        activeAudience: null,
        selectedTermId: null,
        previewNodeId: null,
      },
      {
        label: "MEN preview",
        activeAudience: null,
        selectedTermId: null,
        previewNodeId: "men",
      },
      {
        label: "WOMEN preview",
        activeAudience: null,
        selectedTermId: null,
        previewNodeId: "women",
      },
      ...OBSERVED_BRAND_PRESENTATIONS.map(({ presentationId }) => ({
        label: `${presentationId} preview`,
        activeAudience: null,
        selectedTermId: null,
        previewNodeId: presentationId,
      })),
      {
        label: "persistent MEN network",
        activeAudience: "men",
        selectedTermId: null,
        previewNodeId: null,
      },
      {
        label: "persistent WOMEN network",
        activeAudience: "women",
        selectedTermId: null,
        previewNodeId: null,
      },
      {
        label: "selected Patek in MEN network",
        activeAudience: "men",
        selectedTermId: "patek-philippe",
        previewNodeId: null,
      },
      {
        label: "both selected Rolex presentations in WOMEN network",
        activeAudience: "women",
        selectedTermId: "rolex",
        previewNodeId: null,
      },
    ] satisfies readonly {
      label: string;
      activeAudience: WatchAudience | null;
      selectedTermId: string | null;
      previewNodeId: string | null;
    }[];

    for (const scenario of scenarios) {
      const observed = buildGraphEdges(
        dictionaryTerms,
        scenario.activeAudience,
        scenario.selectedTermId,
        scenario.previewNodeId,
      ).map(({ id, active, emphasized }) => ({ id, active, emphasized }));
      const expected = observedEdgeSummary(scenario).map((edge) => ({ ...edge, active: true }));
      expect(observed, scenario.label).toEqual(expected);
    }
  });

  it("preserves the current audience when a term belongs to both collections", () => {
    const rolex = dictionaryTerms.find(({ id }) => id === "rolex");
    expect(rolex).toBeDefined();
    if (rolex) expect(audienceForTerm(rolex, "women")).toBe("women");
  });

  it("Property: non-primary availability is exactly audience membership", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: dictionaryTerms.length - 1 }),
        fc.constantFrom<WatchAudience | null>("men", "women", null),
        (index, audience) => {
          const term = dictionaryTerms[index];
          const expected = term.kind === "collection"
            ? true
            : term.kind === "specific-watch"
              ? false
              : audience !== null && term.audiences.includes(audience);
          expect(isGraphNodeEnabled(term, audience)).toBe(expected);
        },
      ),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });

  // **Validates: Requirements 3.6, 3.8, 3.10**
  it("Property 2: preserves relationships, emphasis, enabled states, and activation outcomes", () => {
    const previewNodeIds = [null, "men", "women", ...REFERENCE_BRAND_IDS] as const;
    const selectedTermIds = [null, ...dictionaryTerms.map(({ id }) => id)] as const;

    fc.assert(
      fc.property(
        fc.record({
          activeAudience: fc.constantFrom<WatchAudience | null>(null, "men", "women"),
          selectedTermId: fc.constantFrom<string | null>(...selectedTermIds),
          previewNodeId: fc.constantFrom<string | null>(...previewNodeIds),
          activationTermIndex: fc.integer({ min: 0, max: dictionaryTerms.length - 1 }),
          currentAudience: fc.constantFrom<WatchAudience | null>(null, "men", "women"),
        }),
        (scenario) => {
          const actualEdges = buildGraphEdges(
            dictionaryTerms,
            scenario.activeAudience,
            scenario.selectedTermId,
            scenario.previewNodeId,
          ).map(({ id, emphasized }) => ({ id, emphasized }));
          expect(actualEdges).toEqual(observedEdgeSummary(scenario));

          const enabledStates = GRAPH_NODES.map((node) => {
            const term = dictionaryTerms.find(({ id }) => id === node.termId);
            return term ? isGraphNodeEnabled(term, scenario.activeAudience) : false;
          });
          expect(enabledStates).toEqual(
            GRAPH_NODES.map((node) => {
              if (node.kind === "audience") return true;
              if (node.kind === "watch") return false;
              return scenario.activeAudience !== null;
            }),
          );

          const activationTerm = dictionaryTerms[scenario.activationTermIndex];
          const expectedAudience = activationTerm.id === "men" || activationTerm.id === "women"
            ? activationTerm.id
            : scenario.currentAudience && activationTerm.audiences.includes(scenario.currentAudience)
              ? scenario.currentAudience
              : activationTerm.audiences[0] ?? "men";
          expect(audienceForTerm(activationTerm, scenario.currentAudience)).toBe(expectedAudience);
        },
      ),
      { numRuns: 50, seed: PRESERVATION_PROPERTY_SEED },
    );
  });
});
