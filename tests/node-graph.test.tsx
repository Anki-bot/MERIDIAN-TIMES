import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeGraph } from "@/components/ui/NodeGraph";
import { dictionaryTerms } from "@/lib/dictionary";
import { GRAPH_NODES, buildGraphEdges } from "@/lib/graph";

const motionPreference = vi.hoisted(() => ({ reduced: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduced,
  };
});

const globalsSource = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

const LOCKED_CONTROL_NAMES = [
  "MEN, activate Men's Watches",
  "WOMEN, activate Women's Watches",
  "Audemars Piguet, choose a gender to unlock; focus or hover to preview connections",
  "Armani Exchange, choose a gender to unlock; focus or hover to preview connections",
  "Bentley, choose a gender to unlock; focus or hover to preview connections",
  "Hugo Boss, choose a gender to unlock; focus or hover to preview connections",
  "Burberry, choose a gender to unlock; focus or hover to preview connections",
  "Cartier, choose a gender to unlock; focus or hover to preview connections",
  "Citizen, choose a gender to unlock; focus or hover to preview connections",
  "Calvin Klein, choose a gender to unlock; focus or hover to preview connections",
  "Diesel, choose a gender to unlock; focus or hover to preview connections",
  "Emporio Armani, choose a gender to unlock; focus or hover to preview connections",
  "Edifice, choose a gender to unlock; focus or hover to preview connections",
  "Fossil, choose a gender to unlock; focus or hover to preview connections",
  "Franck Muller, choose a gender to unlock; focus or hover to preview connections",
  "G-Shock, choose a gender to unlock; focus or hover to preview connections",
  "Gucci, choose a gender to unlock; focus or hover to preview connections",
  "Guess, choose a gender to unlock; focus or hover to preview connections",
  "Hublot, choose a gender to unlock; focus or hover to preview connections",
  "Jacob & Co., choose a gender to unlock; focus or hover to preview connections",
  "Lacoste, choose a gender to unlock; focus or hover to preview connections",
  "Longines, choose a gender to unlock; focus or hover to preview connections",
  "Maserati, choose a gender to unlock; focus or hover to preview connections",
  "Michael Kors, choose a gender to unlock; focus or hover to preview connections",
  "Movado, choose a gender to unlock; focus or hover to preview connections",
  "Omega, choose a gender to unlock; focus or hover to preview connections",
  "Orient, choose a gender to unlock; focus or hover to preview connections",
  "Patek Philippe, choose a gender to unlock; focus or hover to preview connections",
  "Rado, choose a gender to unlock; focus or hover to preview connections",
  "Richard Mille, choose a gender to unlock; focus or hover to preview connections",
  "Rolex, choose a gender to unlock; focus or hover to preview connections",
  "Seiko, choose a gender to unlock; focus or hover to preview connections",
  "SevenFriday, choose a gender to unlock; focus or hover to preview connections",
  "Swarovski, choose a gender to unlock; focus or hover to preview connections",
  "TAG Heuer, choose a gender to unlock; focus or hover to preview connections",
  "Tissot, choose a gender to unlock; focus or hover to preview connections",
  "Tommy Hilfiger, choose a gender to unlock; focus or hover to preview connections",
  "Vacheron Constantin, choose a gender to unlock; focus or hover to preview connections",
  "Versace, choose a gender to unlock; focus or hover to preview connections",
] as const;

function renderGraph(
  activeAudience: "men" | "women" | null = null,
  reducedMotion = false,
  activeBrand: string | null = null,
) {
  motionPreference.reduced = reducedMotion;
  const onAudienceSelect = vi.fn();
  const onBrandSelect = vi.fn();
  const onTermSelect = vi.fn();
  const onBackdropBack = vi.fn();
  const view = render(
    <NodeGraph
      terms={dictionaryTerms}
      activeAudience={activeAudience}
      activeBrand={activeBrand}
      selectedTermId={null}
      onAudienceSelect={onAudienceSelect}
      onBrandSelect={onBrandSelect}
      onTermSelect={onTermSelect}
      onBackdropBack={onBackdropBack}
    />,
  );
  return { ...view, onAudienceSelect, onBrandSelect, onTermSelect, onBackdropBack };
}

function mountedVariantEdgeIds(container: HTMLElement): readonly (readonly string[])[] {
  return Array.from(container.querySelectorAll<SVGElement>(".graph-connections"), (svg) => (
    Array.from(
      svg.querySelectorAll<SVGGElement>(".graph-connections__active > g"),
      (group) => group.getAttribute("data-edge-id") ?? "",
    )
  ));
}

function expectEveryMountedVariantToShow(
  container: HTMLElement,
  expectedEdgeIds: readonly string[],
) {
  const variants = mountedVariantEdgeIds(container);
  expect(variants.length).toBeGreaterThan(0);
  for (const edgeIds of variants) expect(edgeIds).toEqual(expectedEdgeIds);
}

function expectEveryActiveEdgeToHaveTravelingMotion(container: HTMLElement) {
  const groups = Array.from(
    container.querySelectorAll<SVGGElement>(".graph-connections__active > g"),
  );
  expect(groups.length).toBeGreaterThan(0);
  // Dotted flowing strings: each active edge now has a dotted path (strokeDasharray 3 6) instead of particle
  expect(groups.every((group) => {
    const path = group.querySelector("path");
    return path !== null && path.getAttribute("stroke-dasharray") === "3 6";
  })).toBe(true);
}

function exactRuleBlocks(source: string, selector: string): readonly string[] {
  const blocks: string[] = [];
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();

  for (let openingIndex = 0; openingIndex < source.length; openingIndex += 1) {
    if (source[openingIndex] !== "{") continue;
    const previousOpening = source.lastIndexOf("{", openingIndex - 1);
    const previousClosing = source.lastIndexOf("}", openingIndex - 1);
    const rawPrelude = source.slice(Math.max(previousOpening, previousClosing) + 1, openingIndex);
    const prelude = rawPrelude
      .slice(rawPrelude.lastIndexOf(";") + 1)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (prelude !== normalizedSelector) continue;

    let depth = 1;
    let closingIndex = openingIndex + 1;
    while (closingIndex < source.length && depth > 0) {
      if (source[closingIndex] === "{") depth += 1;
      if (source[closingIndex] === "}") depth -= 1;
      closingIndex += 1;
    }
    blocks.push(source.slice(openingIndex + 1, closingIndex - 1));
  }

  return blocks;
}

function someRuleDeclares(selector: string, declaration: RegExp): boolean {
  return exactRuleBlocks(globalsSource, selector).some((block) => declaration.test(block));
}

afterEach(() => {
  motionPreference.reduced = false;
});

describe("interactive watch graph", () => {
  it("keeps locked brand nodes focusable and previews their two gender relationships", () => {
    const { container, onTermSelect } = renderGraph();
    const patek = screen.getByRole("button", { name: /Patek Philippe.*choose a gender/i });

    expect(patek).not.toBeDisabled();
    expect(patek).toHaveAttribute("aria-disabled", "true");
    patek.focus();
    fireEvent.focus(patek);

    expect(patek).toHaveFocus();
    expect(screen.getByRole("region", { name: /interactive watch brand network/i })).toHaveAttribute(
      "data-network-mode",
      "preview-patek-philippe",
    );
    const expectedIds = buildGraphEdges(
      dictionaryTerms,
      null,
      null,
      "patek-philippe",
    ).map(({ id }) => id);
    expectEveryMountedVariantToShow(container, expectedIds);
    expectEveryActiveEdgeToHaveTravelingMotion(container);

    fireEvent.click(patek);
    expect(onTermSelect).not.toHaveBeenCalled();
  });

  it("immediately fans the preserved relationships while a gender is hovered", () => {
    const { container } = renderGraph();
    const men = screen.getByRole("button", { name: /MEN, activate Men's Watches/i });

    fireEvent.pointerEnter(men);
    expect(screen.getByRole("region", { name: /interactive watch brand network/i })).toHaveAttribute(
      "data-network-mode",
      "preview-men",
    );
    const expectedIds = buildGraphEdges(dictionaryTerms, null, null, "men").map(({ id }) => id);
    expectEveryMountedVariantToShow(container, expectedIds);
    expectEveryActiveEdgeToHaveTravelingMotion(container);

    fireEvent.pointerLeave(men);
    expect(mountedVariantEdgeIds(container).every((edgeIds) => edgeIds.length === 0)).toBe(true);
  });

  it("gives keyboard focus precedence over pointer preview and restores the pointer preview on blur", () => {
    renderGraph();
    const region = screen.getByRole("region", { name: /interactive watch brand network/i });
    const men = screen.getByRole("button", { name: /MEN, activate Men's Watches/i });
    const patek = screen.getByRole("button", { name: /Patek Philippe.*choose a gender/i });

    fireEvent.pointerEnter(men);
    expect(region).toHaveAttribute("data-network-mode", "preview-men");
    fireEvent.focus(patek);
    expect(region).toHaveAttribute("data-network-mode", "preview-patek-philippe");
    fireEvent.blur(patek);
    expect(region).toHaveAttribute("data-network-mode", "preview-men");
    fireEvent.pointerLeave(men);
    expect(region).toHaveAttribute("data-network-mode", "resting");
  });

  it("locks a selected gender network and gates brand activation until selection", async () => {
    const { container, rerender, onAudienceSelect, onBrandSelect } = renderGraph();
    const men = screen.getByRole("button", { name: /MEN, activate Men's Watches/i });

    fireEvent.click(men);
    expect(onAudienceSelect).toHaveBeenCalledTimes(1);
    expect(onAudienceSelect).toHaveBeenCalledWith("men");

    rerender(
      <NodeGraph
        terms={dictionaryTerms}
        activeAudience="men"
        activeBrand={null}
        selectedTermId={null}
        onAudienceSelect={onAudienceSelect}
        onBrandSelect={onBrandSelect}
        onTermSelect={vi.fn()}
        onBackdropBack={vi.fn()}
      />,
    );

    const patek = await screen.findByRole("button", { name: /Patek Philippe, open definition/i }, { timeout: 3000 });
    expect(patek).toHaveAttribute("aria-disabled", "false");
    // Cinematic dive: diving parent MEN should be at center with massive scale, brand entering from center
    const menAfter = await screen.findByRole("button", { name: /MEN, activate Men's Watches/i }, { timeout: 3000 });
    // Men should be diving (scale 50) - check via data attribute (stable key keeps same element, so immediate)
    await new Promise((r) => setTimeout(r, 50));
    expect(menAfter.getAttribute("data-dive-state")).toBe("diving");
    expect(menAfter.classList.contains("is-diving")).toBe(true);
    expect(patek.getAttribute("data-dive-state")).toBe("entering");
    expect(patek.classList.contains("is-entering")).toBe(true);
    // Verify weighty duration/easing are present and no deprecated mode="wait" (popLayout or no mode)
    const nodeGraphSource = readFileSync(resolve(process.cwd(), "components/ui/NodeGraph.tsx"), "utf8");
    expect(nodeGraphSource).not.toMatch(/AnimatePresence[^>]*mode="wait"/);
    expect(nodeGraphSource).toMatch(/diveDuration\s*=\s*1\.0/);
    expect(nodeGraphSource).toMatch(/scale:\s*50/);
    expect(nodeGraphSource).toMatch(/easeInOut/);
    const expectedIds = buildGraphEdges(dictionaryTerms, "men", null).map(({ id }) => id);
    expectEveryMountedVariantToShow(container, expectedIds);

    fireEvent.click(patek);
    expect(onBrandSelect).toHaveBeenCalledTimes(1);
    expect(onBrandSelect).toHaveBeenCalledWith("patek-philippe");
  });

  it("preserves all 39 native controls, accessible states, names, and coordinates", () => {
    const { container } = renderGraph();
    const controlsLayer = container.querySelector<HTMLElement>(".atlas-controls");
    const nodes = screen.getAllByRole("button");

    expect(controlsLayer).toHaveAttribute("data-atlas-control-count", "39");
    expect(nodes).toHaveLength(39);
    expect(nodes.map((node) => node.getAttribute("aria-label"))).toEqual(LOCKED_CONTROL_NAMES);
    expect(nodes.every((node) => node.getAttribute("type") === "button")).toBe(true);
    expect(nodes.every((node) => !node.hasAttribute("disabled") && node.tabIndex === 0)).toBe(true);

    for (const [index, node] of nodes.entries()) {
      const definition = GRAPH_NODES[index];
      expect(node).toHaveAttribute("data-presentation-id", definition.id);
      // Brand nodes now use manualPositions + layoutMap fallback (matches NodeGraph.tsx gridJitterPosition)
      if (definition.kind === "brand") {
        const brandIndex = GRAPH_NODES.filter((n) => n.kind === "brand").findIndex((n) => n.id === definition.id);
        const expected = (() => {
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
          if (definition.id && manualPositions[definition.id]) {
            return manualPositions[definition.id];
          }
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
          return { x: pos.x, y: pos.y };
        })();
        expect(node.style.getPropertyValue("--node-x")).toBe(`${expected.x}%`);
        expect(node.style.getPropertyValue("--node-y")).toBe(`${expected.y}%`);
        expect(node.style.getPropertyValue("--node-mobile-x")).toBe(`${expected.x}%`);
        expect(node.style.getPropertyValue("--node-mobile-y")).toBe(`${expected.y}%`);
      } else {
        expect(node.style.getPropertyValue("--node-x")).toBe(`${definition.desktop.x}%`);
        expect(node.style.getPropertyValue("--node-y")).toBe(`${definition.desktop.y}%`);
        expect(node.style.getPropertyValue("--node-mobile-x")).toBe(`${definition.desktop.x}%`);
        expect(node.style.getPropertyValue("--node-mobile-y")).toBe(`${definition.desktop.y}%`);
      }
      expect(node).toHaveAttribute("aria-disabled", definition.kind === "audience" ? "false" : "true");
      if (definition.kind === "audience") expect(node).toHaveAttribute("aria-pressed", "false");
      else expect(node).not.toHaveAttribute("aria-pressed");
    }
  });

  it("renders Rolex control with unique presentation and SVG ids", () => {
    const { container } = renderGraph();
    const rolexNodes = screen.getAllByRole("button", { name: /Rolex/i });
    expect(rolexNodes).toHaveLength(1);
    expect(rolexNodes.map((node) => node.getAttribute("data-presentation-id"))).toEqual([
      "rolex",
    ]);

    const men = screen.getByRole("button", { name: /MEN, activate Men's Watches/i });
    fireEvent.pointerEnter(men);
    const ids = Array.from(container.querySelectorAll("[id]"), (node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dottedPaths = Array.from(
      container.querySelectorAll(".graph-connections__active path[stroke-dasharray='3 6']"),
      (node) => node.getAttribute("d"),
    );
    expect(dottedPaths.length).toBeGreaterThan(0);
    expect(dottedPaths.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
  });

  it("keeps controls above decorative rays with preserved pointer-event separation", () => {
    const { container } = renderGraph();
    const controlsLayer = container.querySelector<HTMLElement>(".atlas-controls");
    const nodes = Array.from(container.querySelectorAll<HTMLButtonElement>("button.atlas-node"));
    const decorativeSvgs = Array.from(container.querySelectorAll<SVGElement>("svg.graph-connections"));

    expect(nodes.every((node) => node.parentElement === controlsLayer)).toBe(true);
    expect(decorativeSvgs.length).toBeGreaterThan(0);
    expect(decorativeSvgs.every((svg) => svg.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(someRuleDeclares(".node-graph", /pointer-events\s*:\s*none/)).toBe(true);
    expect(someRuleDeclares(".graph-connections", /pointer-events\s*:\s*none/)).toBe(true);
    expect(someRuleDeclares(".atlas-controls", /pointer-events\s*:\s*none/)).toBe(true);
    expect(someRuleDeclares(".atlas-node", /pointer-events\s*:\s*auto/)).toBe(true);

    const men = screen.getByRole("button", { name: /MEN, activate Men's Watches/i });
    fireEvent.pointerEnter(men);
    const expectedCount = buildGraphEdges(dictionaryTerms, null, null, "men").length;
    for (const svg of decorativeSvgs) {
      const activePaths = Array.from(
        svg.querySelectorAll<SVGPathElement>(".graph-connections__active path"),
      );
      expect(activePaths).toHaveLength(expectedCount);
      expect(activePaths.every((path) => path.style.opacity !== "0")).toBe(true);
    }
  });

  it("retains focused relationships but removes traveling motion under reduced motion", () => {
    const { container } = renderGraph(null, true);
    const patek = screen.getByRole("button", { name: /Patek Philippe.*choose a gender/i });
    fireEvent.focus(patek);

    const expectedIds = buildGraphEdges(
      dictionaryTerms,
      null,
      null,
      "patek-philippe",
    ).map(({ id }) => id);
    expectEveryMountedVariantToShow(container, expectedIds);
    expect(container.querySelectorAll(".graph-connections__active path").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".connection-particle")).toHaveLength(0);
    expect(container.querySelectorAll("animateMotion")).toHaveLength(0);
  });
});
