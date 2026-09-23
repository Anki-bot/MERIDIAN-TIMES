import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EliteWatchesExperience } from "@/components/EliteWatchesExperience";
import { dictionaryTerms } from "@/lib/dictionary";
import { GRAPH_NODES, buildGraphEdges } from "@/lib/graph";

const BACKDROP_SOURCE = readFileSync(resolve(process.cwd(), "components/ui/WatchImageBackdrop.tsx"), "utf8");
const ENHANCEMENT_SOURCE = readFileSync(resolve(process.cwd(), "components/ui/watch-2-5d/LayeredWatchEnhancement.tsx"), "utf8");
const LAYER_SOURCE = readFileSync(resolve(process.cwd(), "components/ui/watch-2-5d/LayeredWatchLayer.tsx"), "utf8");
const ELITE_SOURCE = readFileSync(resolve(process.cwd(), "components/EliteWatchesExperience.tsx"), "utf8");
const GLOBALS_SOURCE = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("layered-watch experience integration", () => {
  it("preserves header, search, 13 graph controls, and content before/after enhancement states", async () => {
    const view = render(<EliteWatchesExperience terms={dictionaryTerms} />);
    // header landmark
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Primary navigation")).toBeInTheDocument();
    expect(screen.getByLabelText("Account navigation")).toBeInTheDocument();
    expect(screen.getByLabelText("MERIDIAN WATCHES home")).toHaveTextContent("MERIDIAN WATCHES");
    // search
    expect(screen.getByPlaceholderText("Search thousands of watches...")).toBeInTheDocument();
    // 39 graph controls (2 audience + 37 brand nodes)
    const controls = screen.getAllByRole("button").filter(b => b.classList.contains("atlas-node"));
    expect(controls).toHaveLength(39);
    expect(controls.map(b => b.getAttribute("data-presentation-id")).sort()).toEqual(GRAPH_NODES.map(n => n.id).sort());
    // dictionary content still present via search
    const input = screen.getByLabelText("Search watch brands and terminology");
    await userEvent.type(input, "rolex");
    expect(await screen.findByText("Rolex")).toBeInTheDocument();
    await userEvent.clear(input);
    // graph relationships remain model-driven
    const edges = buildGraphEdges(dictionaryTerms, "men", null, null);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every(e => e.active)).toBe(true);
    // dialog not open initially
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // open a term via search (more deterministic than graph click timing)
    const searchInput = screen.getByLabelText("Search watch brands and terminology");
    await userEvent.type(searchInput, "Omega");
    const options = await screen.findAllByRole("option", { name: /Omega/ });
    const option = options[0];
    await userEvent.click(option);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // definition text should be present (at least part of known Omega definition)
    expect(dialog.textContent).toMatch(/Omega|co-axial|Swiss manufacture/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // skip link
    expect(screen.getByText("Skip to watch explorer").getAttribute("href")).toBe("#watch-explorer");
    view.unmount();
  });

  it("keeps successor layers decorative and below controls/dialog", () => {
    const { container } = render(<EliteWatchesExperience terms={dictionaryTerms} />);
    const enhancement = container.querySelector(".watch-layer-enhancement");
    expect(enhancement).not.toBeNull();
    expect(enhancement?.getAttribute("aria-hidden")).toBe("true");
    expect(enhancement?.querySelectorAll("img.watch-layer-image").length).toBe(0); // fallback-only
    // ensure no focusable successor
    expect(enhancement?.querySelectorAll("button, input, [tabindex='0']").length).toBe(0);
    // z-index: backdrop 2, enhancement 3, scrim 12, explorer 20, masthead 100, dialog 200, skip 500
    expect(GLOBALS_SOURCE).toMatch(/\.watch-layer-enhancement[\s\S]*?z-index:\s*3/);
    expect(GLOBALS_SOURCE).toMatch(/\.watch-layer-enhancement[\s\S]*?pointer-events:\s*none/);
    // decorative check: no role/img
    expect(container.querySelector(".watch-layer-enhancement img[role]")).toBeNull();
  });

  it("contains no forbidden input tracking or 3D runtime imports in successor", () => {
    const combined = BACKDROP_SOURCE + ENHANCEMENT_SOURCE + LAYER_SOURCE;
    expect(combined).not.toMatch(/\bonPointerMove|\bonTouch|\bonWheel|\bonDrag\b/);
    expect(combined).not.toMatch(/\bdeviceorientation|\bdevicemotion|\bgetUserMedia\b/);
    expect(combined).not.toMatch(/addEventListener\s*\(\s*["'](?:pointer|touch|wheel|drag)/);
    expect(combined).not.toContain("@react-three");
    expect(combined).not.toContain("three");
    expect(combined).not.toContain("<canvas");
    expect(combined).not.toContain("WebGL");
    expect(ELITE_SOURCE).not.toMatch(/watch-2-5d\/depth/);
    expect(ENHANCEMENT_SOURCE).not.toMatch(/from\s+["']@\/lib\/watch-2-5d\/depth["']/);
  });

  it("preserves dictionary labels, browse instruction, and placeholder", () => {
    render(<EliteWatchesExperience terms={dictionaryTerms} />);
    expect(screen.getByText("SELECT GENDER TO BROWSE BRANDS")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search thousands of watches...")).toBeInTheDocument();
    // all collection terms still present via dictionary
    expect(dictionaryTerms.find(t => t.id === "men")).toBeDefined();
    expect(dictionaryTerms.find(t => t.id === "rolex")).toBeDefined();
  });

  it("retains focus order and hit-testing independence from enhancement", async () => {
    const view = render(<EliteWatchesExperience terms={dictionaryTerms} />);
    const search = screen.getByLabelText("Search watch brands and terminology");
    // focus should go search -> graph nodes sequentially via tab
    search.focus();
    expect(document.activeElement).toBe(search);
    // simulate tab to first graph node
    fireEvent.keyDown(search, { key: "Tab" });
    // after enhancement mount, pointer events still none on backdrop/enhancement
    const backdrop = view.container.querySelector(".watch-image-backdrop") as HTMLElement;
    expect(backdrop.style.pointerEvents || getComputedStyle(backdrop).pointerEvents).toMatch(/none/);
    const enhancement = view.container.querySelector(".watch-layer-enhancement") as HTMLElement;
    expect(enhancement.style.pointerEvents || getComputedStyle(enhancement).pointerEvents).toMatch(/none/);
  });
});
