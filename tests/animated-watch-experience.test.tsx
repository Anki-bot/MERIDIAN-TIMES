import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EliteWatchesExperience } from "@/components/EliteWatchesExperience";
import { dictionaryTerms } from "@/lib/dictionary";

const motionPreference = vi.hoisted(() => ({ reduced: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduced,
  };
});

const MOBILE_GRAPH_QUERY = "(max-width: 700px)";

const EXPECTED_DICTIONARY_TERMS = [
  [
    "men",
    "Men's Watches"
  ],
  [
    "women",
    "Women's Watches"
  ],
  [
    "audemars-piguet",
    "Audemars Piguet"
  ],
  [
    "armani-exchange",
    "Armani Exchange"
  ],
  [
    "bentley",
    "Bentley"
  ],
  [
    "hugo-boss",
    "Hugo Boss"
  ],
  [
    "burberry",
    "Burberry"
  ],
  [
    "cartier",
    "Cartier"
  ],
  [
    "citizen",
    "Citizen"
  ],
  [
    "calvin-klein",
    "Calvin Klein"
  ],
  [
    "diesel",
    "Diesel"
  ],
  [
    "emporio-armani",
    "Emporio Armani"
  ],
  [
    "edifice",
    "Edifice"
  ],
  [
    "fossil",
    "Fossil"
  ],
  [
    "franck-muller",
    "Franck Muller"
  ],
  [
    "g-shock",
    "G-Shock"
  ],
  [
    "gucci",
    "Gucci"
  ],
  [
    "guess",
    "Guess"
  ],
  [
    "hublot",
    "Hublot"
  ],
  [
    "jacob-co",
    "Jacob & Co."
  ],
  [
    "lacoste",
    "Lacoste"
  ],
  [
    "longines",
    "Longines"
  ],
  [
    "maserati",
    "Maserati"
  ],
  [
    "michael-kors",
    "Michael Kors"
  ],
  [
    "movado",
    "Movado"
  ],
  [
    "omega",
    "Omega"
  ],
  [
    "orient",
    "Orient"
  ],
  [
    "patek-philippe",
    "Patek Philippe"
  ],
  [
    "rado",
    "Rado"
  ],
  [
    "richard-mille",
    "Richard Mille"
  ],
  [
    "rolex",
    "Rolex"
  ],
  [
    "seiko",
    "Seiko"
  ],
  [
    "sevenfriday",
    "SevenFriday"
  ],
  [
    "swarovski",
    "Swarovski"
  ],
  [
    "tag-heuer",
    "TAG Heuer"
  ],
  [
    "tissot",
    "Tissot"
  ],
  [
    "tommy-hilfiger",
    "Tommy Hilfiger"
  ],
  [
    "vacheron-constantin",
    "Vacheron Constantin"
  ],
  [
    "versace",
    "Versace"
  ],
  [
    "tourbillon",
    "Tourbillon"
  ],
  [
    "chronograph",
    "Chronograph"
  ],
  [
    "perpetual-calendar",
    "Perpetual Calendar"
  ],
  [
    "minute-repeater",
    "Minute Repeater"
  ],
  [
    "moonphase",
    "Moonphase"
  ],
  [
    "escapement",
    "Escapement"
  ],
  [
    "balance-wheel",
    "Balance Wheel"
  ],
  [
    "automatic-movement",
    "Automatic Movement"
  ],
  [
    "power-reserve",
    "Power Reserve"
  ],
  [
    "skeleton-watch",
    "Skeleton Watch"
  ],
  [
    "grand-complication",
    "Grand Complication"
  ],
  [
    "audemars-piguet-watch-2",
    "Audemars Piguet Watch 2"
  ],
  [
    "audemars-royal-oak",
    "Audemars Royal Oak"
  ],
  [
    "armani-exchange-watch-1",
    "Armani Exchange Watch 1"
  ],
  [
    "armani-exchange-watch-2",
    "Armani Exchange Watch 2"
  ],
  [
    "bentley-watch-1",
    "Bentley Watch 1"
  ],
  [
    "bentley-watch-2",
    "Bentley Watch 2"
  ],
  [
    "hugo-boss-watch-1",
    "Hugo Boss Watch 1"
  ],
  [
    "hugo-boss-watch-2",
    "Hugo Boss Watch 2"
  ],
  [
    "burberry-watch-1",
    "Burberry Watch 1"
  ],
  [
    "burberry-watch-2",
    "Burberry Watch 2"
  ],
  [
    "cartier-ballon-bleu",
    "Cartier Ballon Bleu"
  ],
  [
    "cartier-panthere",
    "Cartier Panthère"
  ],
  [
    "cartier-santos",
    "Cartier Santos"
  ],
  [
    "cartier-tank",
    "Cartier Tank"
  ],
  [
    "citizen-watch-1",
    "Citizen Watch 1"
  ],
  [
    "citizen-watch-2",
    "Citizen Watch 2"
  ],
  [
    "calvin-klein-watch-1",
    "Calvin Klein Watch 1"
  ],
  [
    "calvin-klein-watch-2",
    "Calvin Klein Watch 2"
  ],
  [
    "diesel-watch-1",
    "Diesel Watch 1"
  ],
  [
    "diesel-watch-2",
    "Diesel Watch 2"
  ],
  [
    "emporio-armani-watch-1",
    "Emporio Armani Watch 1"
  ],
  [
    "emporio-armani-watch-2",
    "Emporio Armani Watch 2"
  ],
  [
    "edifice-watch-1",
    "Edifice Watch 1"
  ],
  [
    "edifice-watch-2",
    "Edifice Watch 2"
  ],
  [
    "fossil-watch-1",
    "Fossil Watch 1"
  ],
  [
    "fossil-watch-2",
    "Fossil Watch 2"
  ],
  [
    "franck-muller-watch-1",
    "Franck Muller Watch 1"
  ],
  [
    "franck-muller-watch-2",
    "Franck Muller Watch 2"
  ],
  [
    "g-shock-watch-1",
    "G-Shock Watch 1"
  ],
  [
    "g-shock-watch-2",
    "G-Shock Watch 2"
  ],
  [
    "gucci-watch-1",
    "Gucci Watch 1"
  ],
  [
    "gucci-watch-2",
    "Gucci Watch 2"
  ],
  [
    "guess-watch-1",
    "Guess Watch 1"
  ],
  [
    "guess-watch-2",
    "Guess Watch 2"
  ],
  [
    "hublot-watch-1",
    "Hublot Watch 1"
  ],
  [
    "hublot-watch-2",
    "Hublot Watch 2"
  ],
  [
    "jacob-co-watch-1",
    "Jacob & Co. Watch 1"
  ],
  [
    "jacob-co-watch-2",
    "Jacob & Co. Watch 2"
  ],
  [
    "lacoste-watch-1",
    "Lacoste Watch 1"
  ],
  [
    "lacoste-watch-2",
    "Lacoste Watch 2"
  ],
  [
    "longines-watch-1",
    "Longines Watch 1"
  ],
  [
    "longines-watch-2",
    "Longines Watch 2"
  ],
  [
    "maserati-watch-1",
    "Maserati Watch 1"
  ],
  [
    "maserati-watch-2",
    "Maserati Watch 2"
  ],
  [
    "michael-kors-watch-1",
    "Michael Kors Watch 1"
  ],
  [
    "michael-kors-watch-2",
    "Michael Kors Watch 2"
  ],
  [
    "movado-watch-1",
    "Movado Watch 1"
  ],
  [
    "movado-watch-2",
    "Movado Watch 2"
  ],
  [
    "omega-speedmaster",
    "Omega Speedmaster"
  ],
  [
    "omega-watch-2",
    "Omega Watch 2"
  ],
  [
    "orient-watch-1",
    "Orient Watch 1"
  ],
  [
    "orient-watch-2",
    "Orient Watch 2"
  ],
  [
    "patek-calatrava",
    "Patek Calatrava"
  ],
  [
    "patek-nautilus",
    "Patek Nautilus"
  ],
  [
    "rado-watch-1",
    "Rado Watch 1"
  ],
  [
    "rado-watch-2",
    "Rado Watch 2"
  ],
  [
    "richard-mille-watch-1",
    "Richard Mille Watch 1"
  ],
  [
    "richard-mille-watch-2",
    "Richard Mille Watch 2"
  ],
  [
    "rolex-datejust",
    "Rolex Datejust"
  ],
  [
    "rolex-daytona",
    "Rolex Daytona"
  ],
  [
    "rolex-submariner",
    "Rolex Submariner"
  ],
  [
    "seiko-watch-1",
    "Seiko Watch 1"
  ],
  [
    "seiko-watch-2",
    "Seiko Watch 2"
  ],
  [
    "sevenfriday-watch-1",
    "SevenFriday Watch 1"
  ],
  [
    "sevenfriday-watch-2",
    "SevenFriday Watch 2"
  ],
  [
    "swarovski-watch-1",
    "Swarovski Watch 1"
  ],
  [
    "swarovski-watch-2",
    "Swarovski Watch 2"
  ],
  [
    "tag-heuer-watch-1",
    "Tag Heuer Watch 1"
  ],
  [
    "tag-heuer-watch-2",
    "Tag Heuer Watch 2"
  ],
  [
    "tissot-watch-1",
    "Tissot Watch 1"
  ],
  [
    "tissot-watch-2",
    "Tissot Watch 2"
  ],
  [
    "tommy-hilfiger-watch-1",
    "Tommy Hilfiger Watch 1"
  ],
  [
    "tommy-hilfiger-watch-2",
    "Tommy Hilfiger Watch 2"
  ],
  [
    "vacheron-constantin-watch-1",
    "Vacheron Constantin Watch 1"
  ],
  [
    "vacheron-constantin-watch-2",
    "Vacheron Constantin Watch 2"
  ],
  [
    "versace-watch-1",
    "Versace Watch 1"
  ],
  [
    "versace-watch-2",
    "Versace Watch 2"
  ]
] as const;

const EXPECTED_GRAPH_PRESENTATIONS = [
  [
    "men",
    "MEN"
  ],
  [
    "women",
    "WOMEN"
  ],
  [
    "audemars-piguet",
    "AUDEMARS PIGUET"
  ],
  [
    "armani-exchange",
    "ARMANI EXCHANGE"
  ],
  [
    "bentley",
    "BENTLEY"
  ],
  [
    "hugo-boss",
    "HUGO BOSS"
  ],
  [
    "burberry",
    "BURBERRY"
  ],
  [
    "cartier",
    "CARTIER"
  ],
  [
    "citizen",
    "CITIZEN"
  ],
  [
    "calvin-klein",
    "CALVIN KLEIN"
  ],
  [
    "diesel",
    "DIESEL"
  ],
  [
    "emporio-armani",
    "EMPORIO ARMANI"
  ],
  [
    "edifice",
    "EDIFICE"
  ],
  [
    "fossil",
    "FOSSIL"
  ],
  [
    "franck-muller",
    "FRANCK MULLER"
  ],
  [
    "g-shock",
    "G-SHOCK"
  ],
  [
    "gucci",
    "GUCCI"
  ],
  [
    "guess",
    "GUESS"
  ],
  [
    "hublot",
    "HUBLOT"
  ],
  [
    "jacob-co",
    "JACOB & CO."
  ],
  [
    "lacoste",
    "LACOSTE"
  ],
  [
    "longines",
    "LONGINES"
  ],
  [
    "maserati",
    "MASERATI"
  ],
  [
    "michael-kors",
    "MICHAEL KORS"
  ],
  [
    "movado",
    "MOVADO"
  ],
  [
    "omega",
    "OMEGA"
  ],
  [
    "orient",
    "ORIENT"
  ],
  [
    "patek-philippe",
    "PATEK PHILIPPE"
  ],
  [
    "rado",
    "RADO"
  ],
  [
    "richard-mille",
    "RICHARD MILLE"
  ],
  [
    "rolex",
    "ROLEX"
  ],
  [
    "seiko",
    "SEIKO"
  ],
  [
    "sevenfriday",
    "SEVENFRIDAY"
  ],
  [
    "swarovski",
    "SWAROVSKI"
  ],
  [
    "tag-heuer",
    "TAG HEUER"
  ],
  [
    "tissot",
    "TISSOT"
  ],
  [
    "tommy-hilfiger",
    "TOMMY HILFIGER"
  ],
  [
    "vacheron-constantin",
    "VACHERON CONSTANTIN"
  ],
  [
    "versace",
    "VERSACE"
  ]
] as const;

const BRAND_PRESENTATION_IDS = [
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
  "versace"
] as const;

const EXPECTED_RESTING_EDGE_IDS = [
  "men--women",
  ...BRAND_PRESENTATION_IDS.flatMap((presentationId) => [
    `men--${presentationId}`,
    `women--${presentationId}`,
  ]),
] as const;

const EXPECTED_PATEK_CONTENT = {
  definition:
    "A Geneva manufacture associated with refined finishing, restrained design, and a deep command of classical complications.",
  history:
    "Founded in 1839, the house developed from bespoke pocket watches into one of the central names in complicated wristwatch making. Its archives connect elegant time-only pieces with calendars, repeaters, and grand complications.",
  signatures: [
    "Hand-finished calibres",
    "Classical complications",
    "Understated casework",
  ],
} as const;

function renderExperience() {
  return render(<EliteWatchesExperience terms={dictionaryTerms} />);
}

function getGraphControl(container: HTMLElement, presentationId: string): HTMLButtonElement {
  const control = container.querySelector<HTMLButtonElement>(
    `button.atlas-node[data-presentation-id="${presentationId}"]`,
  );
  if (!control) throw new Error(`Missing graph control: ${presentationId}`);
  return control;
}

function activeEdgeIds(container: HTMLElement): readonly string[] {
  return Array.from(
    container.querySelectorAll<SVGGElement>(
      ".graph-connections__active > g[data-edge-id]",
    ),
    (edge) => edge.getAttribute("data-edge-id") ?? "",
  );
}

function expectedAudienceEdgeIds(audience: "men" | "women"): readonly string[] {
  if (audience === "men") {
    return ["men--women", ...BRAND_PRESENTATION_IDS.map((presentationId) => `men--${presentationId}`)];
  }
  return BRAND_PRESENTATION_IDS.map((presentationId) => `women--${presentationId}`);
}

function expectPatekContent(dialog: HTMLElement) {
  expect(within(dialog).getByText(EXPECTED_PATEK_CONTENT.definition)).toBeInTheDocument();
  expect(within(dialog).getByText(EXPECTED_PATEK_CONTENT.history)).toBeInTheDocument();
  for (const signature of EXPECTED_PATEK_CONTENT.signatures) {
    expect(within(dialog).getByText(signature)).toBeInTheDocument();
  }
}

function installResponsiveViewport(initialWidth: number) {
  let width = initialWidth;
  const originalMatchMedia = window.matchMedia;
  const originalWidthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const listeners = new Set<(event: Event) => void>();

  const mobileMediaQuery = {
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
    query === MOBILE_GRAPH_QUERY ? mobileMediaQuery : originalMatchMedia(query)
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
        mobileMediaQuery.dispatchEvent(new Event("change"));
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

afterEach(() => {
  motionPreference.reduced = false;
});

// **Validates: Requirements 2.8–2.10, 7.1–7.13, 8.4–8.9**
describe("animated watch experience integration preservation", () => {
  it("keeps the canonical dictionary, graph labels and relationships, and interface copy unchanged", () => {
    const { container } = renderExperience();

    expect(dictionaryTerms.map(({ id, term }) => [id, term])).toEqual(
      EXPECTED_DICTIONARY_TERMS,
    );
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button.atlas-node"), (node) => [
        node.dataset.presentationId,
        node.querySelector(".atlas-node__label")?.textContent,
      ]),
    ).toEqual(EXPECTED_GRAPH_PRESENTATIONS);
    expect(
      Array.from(
        container.querySelectorAll<SVGPathElement>(
          ".graph-connections__rest > path[data-edge-id]",
        ),
        (edge) => edge.getAttribute("data-edge-id"),
      ),
    ).toEqual(EXPECTED_RESTING_EDGE_IDS);

    expect(screen.getByRole("combobox", { name: /search watch brands/i })).toHaveAttribute(
      "placeholder",
      "Search thousands of watches...",
    );
    expect(screen.getByText("SELECT GENDER TO BROWSE BRANDS")).toHaveClass(
      "browse-instruction",
    );
  });

  it("preserves cyclic search Arrow navigation, Enter selection, and clear focus restoration", async () => {
    const user = userEvent.setup();
    renderExperience();
    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: /search watch brands/i,
    });

    await user.type(input, "moon");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options.slice(0, 2).map((option) => option.querySelector("strong")?.textContent)).toEqual([
      "Moonphase",
      "Omega",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);

    await user.keyboard("{ArrowUp}");
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options.at(-1)?.id);

    await user.keyboard("{ArrowDown}");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Omega" });
    expect(input).toHaveValue("Omega");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    await user.click(within(dialog).getByRole("button", { name: "Close definition" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Omega" })).not.toBeInTheDocument());
    await waitFor(() => expect(input).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.getByText("Search is clear.")).toBeInTheDocument();
  });

  it("gives keyboard focus precedence over pointer hover and restores the pointer preview on blur", () => {
    const { container } = renderExperience();
    const region = screen.getByRole("region", { name: /interactive watch brand network/i });
    const men = getGraphControl(container, "men");
    const women = getGraphControl(container, "women");
    const patek = getGraphControl(container, "patek-philippe");

    fireEvent.pointerEnter(men);
    expect(region).toHaveAttribute("data-network-mode", "preview-men");
    expect(activeEdgeIds(container)).toEqual(expectedAudienceEdgeIds("men"));

    act(() => patek.focus());
    expect(patek).toHaveFocus();
    expect(region).toHaveAttribute("data-network-mode", "preview-patek-philippe");
    expect(activeEdgeIds(container)).toEqual([
      "men--patek-philippe",
      "women--patek-philippe",
    ]);

    fireEvent.pointerEnter(women);
    expect(region).toHaveAttribute("data-network-mode", "preview-patek-philippe");
    expect(activeEdgeIds(container)).toEqual([
      "men--patek-philippe",
      "women--patek-philippe",
    ]);

    act(() => patek.blur());
    expect(region).toHaveAttribute("data-network-mode", "preview-women");
    expect(activeEdgeIds(container)).toEqual(["men--women", ...BRAND_PRESENTATION_IDS.map((id) => `women--${id}`)]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("persists MEN and WOMEN selection after pointer leave and blur", async () => {
    const user = userEvent.setup();
    const { container } = renderExperience();
    const region = screen.getByRole("region", { name: /interactive watch brand network/i });
    const men = getGraphControl(container, "men");
    const women = getGraphControl(container, "women");

    await user.click(men);
    fireEvent.pointerLeave(men);
    act(() => men.blur());
    expect(men).toHaveAttribute("aria-pressed", "true");
    expect(women).toHaveAttribute("aria-pressed", "false");
    expect(region).toHaveAttribute("data-network-mode", "active-men");
    expect(activeEdgeIds(container)).toEqual(expectedAudienceEdgeIds("men"));
    expect(screen.getByText("Men's collection active. Compatible brand nodes are illuminated.")).toBeInTheDocument();

    // Hidden sibling has pointerEvents:none per accessibility polish — use fireEvent to simulate programmatic activation
    fireEvent.click(women);
    fireEvent.pointerLeave(women);
    act(() => women.blur());
    expect(men).toHaveAttribute("aria-pressed", "false");
    expect(women).toHaveAttribute("aria-pressed", "true");
    expect(region).toHaveAttribute("data-network-mode", "active-women");
    expect(activeEdgeIds(container)).toEqual(expectedAudienceEdgeIds("women"));
    expect(screen.getByText("Women's collection active. Compatible brand nodes are illuminated.")).toBeInTheDocument();
  });

  it("keeps locked brands focusable and preview-only, then opens existing content when enabled and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const { container } = renderExperience();
    const region = screen.getByRole("region", { name: /interactive watch brand network/i });
    const backdrop = container.querySelector<HTMLElement>(".watch-image-backdrop");
    const men = getGraphControl(container, "men");
    const patek = getGraphControl(container, "patek-philippe");

    expect(patek).toHaveAttribute("aria-disabled", "true");
    act(() => patek.focus());
    expect(patek).toHaveFocus();
    expect(region).toHaveAttribute("data-network-mode", "preview-patek-philippe");
    expect(activeEdgeIds(container)).toEqual([
      "men--patek-philippe",
      "women--patek-philippe",
    ]);

    // Locked brand is in dim constellation with pointer-events none - use fireEvent to simulate programmatic click
    fireEvent.click(patek);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(men);
    fireEvent.pointerLeave(men);
    act(() => men.blur());
    expect(patek).toHaveAttribute("aria-disabled", "false");
    expect(patek).toHaveAccessibleName("Patek Philippe, open definition");

    await user.click(patek);
    const dialog = await screen.findByRole("dialog", { name: "Patek Philippe" });
    expectPatekContent(dialog);
    expect(backdrop).toHaveAttribute("data-definition-open", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Patek Philippe" })).not.toBeInTheDocument());
    await waitFor(() => expect(patek).toHaveFocus());
    expect(backdrop).toHaveAttribute("data-definition-open", "false");
    expect(men).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps navigation, search, graph, and dialog controls operable after a runtime image error", async () => {
    const user = userEvent.setup();
    const { container } = renderExperience();
    // Static WebP backdrop: always present
    const img = container.querySelector<HTMLImageElement>("img.watch-image-backdrop__image");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
    expect(container.querySelector(".watch-image-backdrop")).toBeInTheDocument();

    const headerLinks = within(screen.getByRole("banner")).getAllByRole("link");
    expect(headerLinks).toHaveLength(5);
    const login = within(screen.getByRole("banner")).getByRole("link", { name: "LOGIN" });
    let loginActivationCount = 0;
    const countLoginActivation = (event: MouseEvent) => {
      event.preventDefault();
      loginActivationCount += 1;
    };
    login.addEventListener("click", countLoginActivation);
    act(() => login.focus());
    expect(login).toHaveFocus();
    await user.click(login);
    login.removeEventListener("click", countLoginActivation);
    expect(loginActivationCount).toBe(1);

    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: /search watch brands/i,
    });
    await user.type(input, "omega");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();

    const women = getGraphControl(container, "women");
    await user.click(women);
    fireEvent.pointerLeave(women);
    act(() => women.blur());
    const cartier = getGraphControl(container, "cartier");
    expect(cartier).toHaveAttribute("aria-disabled", "false");
    await user.click(cartier);
    const dialog = await screen.findByRole("dialog", { name: "Cartier" });
    await user.click(within(dialog).getByRole("button", { name: "Close definition" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cartier" })).not.toBeInTheDocument());
    await waitFor(() => expect(cartier).toHaveFocus());

    expect(women).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps navigation, search, graph, and dialog operation available under reduced motion", async () => {
    motionPreference.reduced = true;
    const user = userEvent.setup();
    const { container } = renderExperience();
    const backdrop = container.querySelector<HTMLElement>(".watch-image-backdrop");
    const img = container.querySelector<HTMLImageElement>("img.watch-image-backdrop__image");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
    expect(backdrop).toHaveAttribute("data-reduced-motion", "true");

    const collection = within(screen.getByRole("banner")).getByRole("link", {
      name: "COLLECTION",
    });
    let collectionActivationCount = 0;
    const countCollectionActivation = (event: MouseEvent) => {
      event.preventDefault();
      collectionActivationCount += 1;
    };
    collection.addEventListener("click", countCollectionActivation);
    await user.click(collection);
    collection.removeEventListener("click", countCollectionActivation);
    expect(collectionActivationCount).toBe(1);

    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: /search watch brands/i,
    });
    await user.type(input, "Patek");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveFocus();

    const men = getGraphControl(container, "men");
    await user.click(men);
    fireEvent.pointerLeave(men);
    act(() => men.blur());
    expect(activeEdgeIds(container)).toEqual(expectedAudienceEdgeIds("men"));
    expect(container.querySelectorAll(".connection-particle")).toHaveLength(0);
    expect(container.querySelectorAll("animateMotion")).toHaveLength(0);

    const patek = getGraphControl(container, "patek-philippe");
    await user.click(patek);
    expect(await screen.findByRole("dialog", { name: "Patek Philippe" })).toBeInTheDocument();
    expect(backdrop).toHaveAttribute("data-definition-open", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Patek Philippe" })).not.toBeInTheDocument());
    await waitFor(() => expect(patek).toHaveFocus());
    expect(backdrop).toHaveAttribute("data-definition-open", "false");
  });

  it("retains audience, query, preview, focus, dialog, controls, and the hero tree across 700/701 transitions", async () => {
    const viewport = installResponsiveViewport(700);
    const user = userEvent.setup();
    const rendered = renderExperience();

    try {
      const { container } = rendered;
      const region = screen.getByRole("region", { name: /interactive watch brand network/i });
      const img = container.querySelector<HTMLImageElement>("img.watch-image-backdrop__image");
      const women = getGraphControl(container, "women");
      const cartier = getGraphControl(container, "cartier");
      const controls = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button.atlas-node"),
      );
      const input = screen.getByRole<HTMLInputElement>("combobox", {
        name: /search watch brands/i,
      });

      expect(container.querySelector("svg.graph-connections--mobile")).toBeInTheDocument();
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
      await user.click(women);
      fireEvent.pointerLeave(women);
      act(() => women.blur());
      await user.type(input, "omega");
      act(() => cartier.focus());

      expect(women).toHaveAttribute("aria-pressed", "true");
      expect(input).toHaveValue("omega");
      expect(cartier).toHaveFocus();
      expect(region).toHaveAttribute("data-network-mode", "preview-cartier");
      expect(activeEdgeIds(container)).toHaveLength(38);
      expect(activeEdgeIds(container)).toEqual(expect.arrayContaining(["men--cartier", "women--cartier"]));

      act(() => viewport.setWidth(701));
      expect(container.querySelector("svg.graph-connections--desktop")).toBeInTheDocument();
      expect(container.querySelector("img.watch-image-backdrop__image")).toBe(img);
      expect(Array.from(container.querySelectorAll("button.atlas-node"))).toEqual(controls);
      expect(women).toHaveAttribute("aria-pressed", "true");
      expect(input).toHaveValue("omega");
      expect(cartier).toHaveFocus();
      expect(region).toHaveAttribute("data-network-mode", "preview-cartier");
      expect(activeEdgeIds(container)).toHaveLength(38);
      expect(activeEdgeIds(container)).toEqual(expect.arrayContaining(["men--cartier", "women--cartier"]));

      act(() => viewport.setWidth(700));
      expect(container.querySelector("svg.graph-connections--mobile")).toBeInTheDocument();
      expect(container.querySelector("img.watch-image-backdrop__image")).toBe(img);
      expect(cartier).toHaveFocus();

      await user.click(cartier);
      const dialog = await screen.findByRole("dialog", { name: "Cartier" });
      expect(container.querySelector(".watch-image-backdrop")).toHaveAttribute(
        "data-definition-open",
        "true",
      );
      expect(input).toHaveValue("omega");
      expect(women).toHaveAttribute("aria-pressed", "true");

      act(() => viewport.setWidth(701));
      expect(container.querySelector("svg.graph-connections--desktop")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Cartier" })).toBe(dialog);
      expect(container.querySelector("img.watch-image-backdrop__image")).toBe(img);
      expect(input).toHaveValue("omega");
      expect(women).toHaveAttribute("aria-pressed", "true");

      act(() => viewport.setWidth(700));
      expect(container.querySelector("svg.graph-connections--mobile")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Cartier" })).toBe(dialog);
      expect(container.querySelector("img.watch-image-backdrop__image")).toBe(img);

      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cartier" })).not.toBeInTheDocument());
      await waitFor(() => expect(cartier).toHaveFocus());
      expect(women).toHaveAttribute("aria-pressed", "true");
      expect(input).toHaveValue("omega");
    } finally {
      rendered.unmount();
      viewport.restore();
    }
  });
});
