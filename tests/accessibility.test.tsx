import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DefinitionPanel } from "@/components/ui/DefinitionPanel";
import { NodeGraph } from "@/components/ui/NodeGraph";
import { SearchBar } from "@/components/ui/SearchBar";
import { dictionaryTerms } from "@/lib/dictionary";

const EXPECTED_GRAPH_CONTROL_NAMES = [
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

describe("accessible UI behavior", () => {
  it("supports combobox keyboard navigation, selection, and clear", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SearchBar terms={dictionaryTerms} onSelect={onSelect} />);

    const input = screen.getByRole("combobox", { name: /search watch brands/i });
    expect(input).toHaveAttribute("placeholder", "Search thousands of watches...");
    await user.type(input, "moon");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toMatch(/moonphase|omega/);

    const clear = screen.getByRole("button", { name: /clear search/i });
    await user.click(clear);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("closes the modal on Escape and restores focus to its opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open Rolex";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const rolex = dictionaryTerms.find(({ id }) => id === "rolex") ?? null;

    const { rerender } = render(
      <DefinitionPanel
        term={rolex}
        allTerms={dictionaryTerms}
        opener={opener}
        onClose={onClose}
        onSelectRelated={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Rolex" })).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <DefinitionPanel
        term={null}
        allTerms={dictionaryTerms}
        opener={opener}
        onClose={onClose}
        onSelectRelated={vi.fn()}
      />,
    );
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it("renders related terminology as named, reachable buttons", () => {
    const tourbillon = dictionaryTerms.find(({ id }) => id === "tourbillon") ?? null;
    render(
      <DefinitionPanel
        term={tourbillon}
        allTerms={dictionaryTerms}
        opener={null}
        onClose={vi.fn()}
        onSelectRelated={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Escapement" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /close definition/i })).toHaveAccessibleName("Close definition");
  });

  it("exposes all graph nodes as native, named, focusable controls with observed states", () => {
    render(
      <NodeGraph
        terms={dictionaryTerms}
        activeAudience={null}
        selectedTermId={null}
        onAudienceSelect={vi.fn()}
        onTermSelect={vi.fn()}
      />,
    );

    const controls = screen.getAllByRole<HTMLButtonElement>("button");
    expect(controls).toHaveLength(39);
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual(
      EXPECTED_GRAPH_CONTROL_NAMES,
    );

    controls.forEach((control, index) => {
      expect(control).not.toBeDisabled();
      expect(control).toHaveAttribute("type", "button");
      expect(control.tabIndex).toBe(0);
      expect(control).toHaveAttribute("aria-disabled", index < 2 ? "false" : "true");
      control.focus();
      expect(control).toHaveFocus();
    });

    expect(controls[0]).toHaveAttribute("aria-pressed", "false");
    expect(controls[1]).toHaveAttribute("aria-pressed", "false");
    expect(controls.slice(2).every((control) => !control.hasAttribute("aria-pressed"))).toBe(true);
  });
});
