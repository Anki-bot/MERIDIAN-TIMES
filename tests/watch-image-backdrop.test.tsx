import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WatchImageBackdrop } from "@/components/ui/WatchImageBackdrop";

function getImageTree(container: HTMLElement) {
  const backdrop = container.querySelector<HTMLElement>(".watch-image-backdrop");
  const img = container.querySelector<HTMLImageElement>("img.watch-image-backdrop__image");

  if (!backdrop || !img) {
    throw new Error("Expected the complete watch static image backdrop tree.");
  }

  return { backdrop, img };
}

describe("WatchImageBackdrop", () => {
  it("renders one exact static WebP backdrop with required attributes and without video/picture", () => {
    const { container } = render(
      <WatchImageBackdrop definitionOpen={false} reducedMotion={false} />,
    );
    const { backdrop, img } = getImageTree(container);

    expect(container.querySelectorAll(".watch-image-backdrop")).toHaveLength(1);
    expect(container.querySelectorAll("img.watch-image-backdrop__image")).toHaveLength(1);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(container.querySelectorAll("picture")).toHaveLength(0);
    expect(container.querySelectorAll("canvas")).toHaveLength(0);

    expect(img.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
    expect(img.getAttribute("aria-hidden")).toBe("true");
    expect(img.getAttribute("alt")).toBe("");

    expect(backdrop.className).toContain("watch-image-backdrop");
    expect(backdrop.className).toContain("-z-10");
    expect(img.className).toContain("watch-image-backdrop__image");
    expect(img.className).toContain("object-cover");
    expect(img.className).toContain("absolute");
    expect(img.className).toContain("-z-10");

    const serialized = container.innerHTML;
    expect(serialized).not.toContain("elite-watch-master.png");
    expect(serialized).not.toContain("source/assets");

    expect(backdrop).toHaveStyle({ backgroundColor: "#101416", pointerEvents: "none" });
  });

  it("exposes definitionOpen and reducedMotion as data attributes and remains decorative", () => {
    const view = render(
      <WatchImageBackdrop definitionOpen={false} reducedMotion={false} />,
    );
    const { backdrop } = getImageTree(view.container);

    expect(backdrop).toHaveAttribute("data-definition-open", "false");
    expect(backdrop).toHaveAttribute("data-reduced-motion", "false");

    view.rerender(<WatchImageBackdrop definitionOpen reducedMotion={false} />);
    expect(backdrop).toHaveAttribute("data-definition-open", "true");

    view.rerender(<WatchImageBackdrop definitionOpen={false} reducedMotion />);
    expect(backdrop).toHaveAttribute("data-reduced-motion", "true");

    const img = view.container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not intercept focus or pointer operation from a surrounding control", async () => {
    const { container } = render(
      <div>
        <WatchImageBackdrop definitionOpen={false} reducedMotion={false} />
        <button type="button">Surrounding control</button>
      </div>,
    );
    const backdrop = container.querySelector<HTMLElement>(".watch-image-backdrop") as HTMLElement;
    const img = container.querySelector<HTMLImageElement>("img") as HTMLImageElement;
    const control = screen.getByRole("button", { name: "Surrounding control" });

    expect(backdrop).toHaveStyle({ pointerEvents: "none" });
    expect(img.getAttribute("aria-hidden")).toBe("true");
    expect(control.tabIndex).not.toBe(-1);
  });

  it("maintains image persistence and correct layering behind Node Graph", () => {
    const { container } = render(<WatchImageBackdrop definitionOpen={false} reducedMotion={false} />);
    const img = container.querySelector("img") as HTMLImageElement;
    const backdrop = container.querySelector(".watch-image-backdrop") as HTMLElement;
    expect(img.getAttribute("src")).toBe("/assets/watch/background-4k.webp");
    expect(backdrop.className).toContain("-z-10");
    expect(img.className).toContain("-z-10");
    expect(img.className).toContain("object-cover");
  });
});
