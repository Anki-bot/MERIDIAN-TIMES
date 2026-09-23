import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EliteWatchesExperience } from "@/components/EliteWatchesExperience";
import { dictionaryTerms } from "@/lib/dictionary";

vi.mock("@/components/ui/WatchImageBackdrop", () => ({
  WatchImageBackdrop: ({
    definitionOpen,
    reducedMotion,
  }: {
    definitionOpen: boolean;
    reducedMotion: boolean;
  }) => (
    <div
      data-testid="watch-image-backdrop-boundary"
      data-definition-open={String(definitionOpen)}
      data-reduced-motion={String(reducedMotion)}
    />
  ),
}));

const globalsSource = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

type RuleBlock = {
  readonly declarations: string;
  readonly openingIndex: number;
};

function normalizePrelude(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

function extractExactRuleBlocks(source: string, selector: string): readonly RuleBlock[] {
  const blocks: RuleBlock[] = [];
  const expectedPrelude = normalizePrelude(selector);

  for (let openingIndex = 0; openingIndex < source.length; openingIndex += 1) {
    if (source[openingIndex] !== "{") continue;
    const previousOpening = source.lastIndexOf("{", openingIndex - 1);
    const previousClosing = source.lastIndexOf("}", openingIndex - 1);
    const rawPrelude = source.slice(Math.max(previousOpening, previousClosing) + 1, openingIndex);
    const prelude = normalizePrelude(rawPrelude.slice(rawPrelude.lastIndexOf(";") + 1));
    if (prelude !== expectedPrelude) continue;

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

function extractAtRuleBody(source: string, atRule: string): string {
  const start = source.indexOf(atRule);
  if (start < 0) return "";
  const openingIndex = source.indexOf("{", start + atRule.length);
  if (openingIndex < 0) return "";

  let depth = 1;
  let closingIndex = openingIndex + 1;
  while (closingIndex < source.length && depth > 0) {
    if (source[closingIndex] === "{") depth += 1;
    if (source[closingIndex] === "}") depth -= 1;
    closingIndex += 1;
  }
  return source.slice(openingIndex + 1, closingIndex - 1);
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

function declarationsFor(
  source: string,
  selector: string,
  predicate: (declarations: ReadonlyMap<string, string>) => boolean = () => true,
): ReadonlyMap<string, string> {
  for (const block of extractExactRuleBlocks(source, selector)) {
    const declarations = declarationsByName(block.declarations);
    if (predicate(declarations)) return declarations;
  }
  return new Map();
}

function renderExperience() {
  return render(<EliteWatchesExperience terms={dictionaryTerms} />);
}

describe("observation-first glass header and application preservation", () => {
  it("preserves header landmarks, native links, destinations, order, and one activation", () => {
    renderExperience();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    expect(within(header).getByRole("navigation", { name: "Account navigation" })).toBeVisible();

    const exposedBrandSource = [
      "app/layout.tsx",
      "components/EliteWatchesExperience.tsx",
      "components/ui/DefinitionPanel.tsx",
      "lib/dictionary.ts",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
    expect(exposedBrandSource).toContain('title: "MERIDIAN WATCHES | A Living Atlas of Haute Horlogerie"');
    expect(exposedBrandSource).toContain('applicationName: "MERIDIAN WATCHES"');
    expect(exposedBrandSource).toContain("<span>MW</span>");
    expect(exposedBrandSource).toContain("MERIDIAN WATCHES ARCHIVE");
    expect(exposedBrandSource).toContain("MERIDIAN WATCHES dictionary is invalid");
    expect(exposedBrandSource).not.toContain(["ELITE", "WATCHES"].join(" "));
    expect(screen.getByRole("heading", {
      level: 1,
      name: "MERIDIAN WATCHES interactive watch atlas",
    })).toBeInTheDocument();

    const links = within(header).getAllByRole<HTMLAnchorElement>("link");
    expect(links.map((link) => ({
      text: link.textContent?.trim(),
      name: link.getAttribute("aria-label") ?? link.textContent?.trim(),
      destination: link.getAttribute("href"),
      tabIndex: link.tabIndex,
    }))).toEqual([
      { text: "COLLECTION", name: "COLLECTION", destination: "#watch-atlas", tabIndex: 0 },
      { text: "ABOUT", name: "ABOUT", destination: "/about", tabIndex: 0 },
      { text: "MERIDIAN WATCHES", name: "MERIDIAN WATCHES home", destination: "#watch-explorer", tabIndex: 0 },
      { text: "CONTACT", name: "CONTACT", destination: "/contact", tabIndex: 0 },
      { text: "LOGIN", name: "LOGIN", destination: "/login", tabIndex: 0 },
    ]);

    for (const link of links) {
      let activationCount = 0;
      const countActivation = (event: Event) => {
        event.preventDefault();
        activationCount += 1;
      };
      link.addEventListener("click", countActivation);
      fireEvent.click(link);
      link.removeEventListener("click", countActivation);
      expect(activationCount, link.textContent ?? link.href).toBe(1);
    }
  });

  it("preserves responsive header geometry, centered wordmark, target size, focus, and forced colors", () => {
    const desktopHeader = declarationsFor(
      globalsSource,
      ".site-masthead",
      (declarations) => declarations.get("height") === "68px",
    );
    const mobileSource = extractAtRuleBody(globalsSource, "@media (max-width: 700px)");
    const mobileHeader = declarationsFor(mobileSource, ".site-masthead");
    const navTarget = declarationsFor(globalsSource, ".masthead-nav a");
    const mobileNavTarget = declarationsFor(mobileSource, ".masthead-nav a");
    const compactVisibility = declarationsFor(
      mobileSource,
      ".masthead-nav--left a:nth-child(2), .masthead-nav--right a:first-child",
    );
    const wordmark = declarationsFor(globalsSource, ".wordmark");
    const globalFocus = declarationsFor(globalsSource, ":focus-visible");
    const headerFocus = declarationsFor(globalsSource, ".site-masthead a:focus-visible");

    expect(desktopHeader.get("height")).toBe("68px");
    expect(mobileHeader.get("height")).toBe("60px");
    expect(desktopHeader.get("border-bottom")).toMatch(/^1px\s+solid\b/);
    expect(navTarget.get("min-width")).toBe("44px");
    expect(navTarget.get("min-height")).toBe("44px");
    expect(mobileNavTarget.get("min-width")).toBe("44px");
    expect(compactVisibility.get("display")).toBe("none");
    expect(wordmark.get("top")).toBe("50%");
    expect(wordmark.get("left")).toBe("50%");
    expect(wordmark.get("transform")).toBe("translate(-50%, -50%)");
    expect(wordmark.get("min-height")).toBe("44px");
    expect(globalFocus.get("outline")).toMatch(/^2px\s+solid\b/);
    expect(Number.parseFloat(globalFocus.get("outline-offset") ?? "-1")).toBeGreaterThanOrEqual(0);
    expect(headerFocus.get("outline-color")).toBeTruthy();
    expect(headerFocus.get("outline")).not.toBe("none");

    const forcedColorsSource = extractAtRuleBody(globalsSource, "@media (forced-colors: active)");
    const forcedHeader = declarationsFor(forcedColorsSource, ".site-masthead");
    const forcedLinks = declarationsFor(forcedColorsSource, ".masthead-nav a, .wordmark");
    const forcedUnderline = declarationsFor(forcedColorsSource, ".masthead-nav a::after");
    const forcedFocus = declarationsFor(forcedColorsSource, ".site-masthead a:focus-visible");

    expect(forcedHeader.get("border-bottom-color")).toBe("CanvasText");
    expect(forcedHeader.get("background")).toBe("Canvas");
    expect(forcedHeader.get("color")).toBe("CanvasText");
    expect(forcedLinks.get("color")).toBe("LinkText");
    expect(forcedUnderline.get("background")).toBe("Highlight");
    expect(forcedFocus.get("outline-color")).toBe("Highlight");
    expect(forcedColorsSource).not.toMatch(/forced-color-adjust\s*:\s*none/i);
  });

  it("preserves audience selection, term opening, image backdrop state, close behavior, and focus restoration", async () => {
    const user = userEvent.setup();
    renderExperience();
    const region = screen.getByRole("region", { name: /interactive watch brand network/i });
    const imageBackdrop = screen.getByTestId("watch-image-backdrop-boundary");
    expect(region).toHaveAttribute("data-network-mode", "resting");
    expect(imageBackdrop).toHaveAttribute("data-definition-open", "false");
    expect(imageBackdrop).toHaveAttribute("data-reduced-motion", "false");

    const men = screen.getByRole("button", { name: /MEN, activate Men's Watches/i });
    await user.click(men);
    expect(men).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(
      "Men's collection active. Compatible brand nodes are illuminated.",
      { selector: "p[role='status']" },
    )).toBeInTheDocument();

    fireEvent.pointerLeave(men);
    fireEvent.blur(men);
    expect(region).toHaveAttribute("data-network-mode", "active-men");

    const patek = screen.getByRole("button", { name: /Patek Philippe, open definition/i });
    await user.click(patek);
    expect(screen.getByRole("dialog", { name: "Patek Philippe" })).toBeInTheDocument();
    expect(imageBackdrop).toHaveAttribute("data-definition-open", "true");

    await user.click(screen.getByRole("button", { name: "Close definition" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Patek Philippe" })).not.toBeInTheDocument());
    await waitFor(() => expect(patek).toHaveFocus());
    expect(imageBackdrop).toHaveAttribute("data-definition-open", "false");
  });
});
