import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  LayeredWatchLayer,
  LayeredWatchLayerInvariantError,
  WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY,
} from "@/components/ui/watch-2-5d/LayeredWatchLayer";
import type {
  AssetId,
  LayerId,
  PreparedAsset,
  PublicAssetRecord,
  ReadonlyMatrix2D,
  Sha256,
  SourceRect,
} from "@/lib/watch-2-5d/types";

const COMPONENT_SOURCE = readFileSync(
  resolve(process.cwd(), "components/ui/watch-2-5d/LayeredWatchLayer.tsx"),
  "utf8",
);

const SOURCE_RECT = Object.freeze({
  height: 149,
  width: 377,
  x: 113,
  y: 211,
}) satisfies SourceRect;

const RELATIVE_TRANSFORM = Object.freeze({
  a: 0.75,
  b: -0,
  c: -0.125,
  d: 1,
  e: 8.5,
  f: -3,
}) satisfies ReadonlyMatrix2D;

function createRecord(
  sourceRect: SourceRect = SOURCE_RECT,
  zOrder = 23,
): PublicAssetRecord<"expanded"> {
  const decodedPixelCount = SOURCE_RECT.width * SOURCE_RECT.height;
  return Object.freeze({
    byteLength: 1_024,
    colorMetadata: Object.freeze({
      alpha: true,
      channels: 4,
      colourspace: "srgb",
    }),
    decodedPixelCount,
    decodedRgbaByteLength: decodedPixelCount * 4,
    encoder: Object.freeze({
      alphaQuality: 100,
      channels: 4,
      colourspace: "srgb",
      effort: 6,
      nearLossless: false,
      quality: 95,
      smartSubsample: true,
    }),
    file: "public/assets/watch-2-5d/v1/expanded/upper-wheel.webp",
    id: "asset-upper-wheel-expanded" as AssetId,
    intrinsicHeight: SOURCE_RECT.height,
    intrinsicWidth: SOURCE_RECT.width,
    layerId: "upper-wheel" as LayerId,
    magicSignatureHex: "524946460000000057454250",
    mediaType: "image/webp",
    profile: "expanded",
    publicPath: "/assets/watch-2-5d/v1/expanded/upper-wheel.webp",
    sha256: "a".repeat(64) as Sha256,
    sourceRect,
    zOrder,
  });
}

function createPreparedAsset(
  objectUrl = "blob:https://elite-watches.test/verified-upper-wheel",
  sourceRect: SourceRect = SOURCE_RECT,
  zOrder = 23,
): PreparedAsset<"expanded"> {
  const image = document.createElement("img");
  Object.defineProperties(image, {
    naturalHeight: { configurable: true, value: SOURCE_RECT.height },
    naturalWidth: { configurable: true, value: SOURCE_RECT.width },
  });
  image.src = objectUrl;

  return Object.freeze({
    image,
    objectUrl,
    record: createRecord(sourceRect, zOrder),
  });
}

function getLayer(container: HTMLElement): HTMLImageElement {
  const layer = container.querySelector<HTMLImageElement>("img.watch-layer-image");
  if (!layer) throw new Error("Expected one layered watch image.");
  return layer;
}

function withRecord(
  asset: PreparedAsset<"expanded">,
  changes: Partial<Pick<PublicAssetRecord<"expanded">, "sourceRect" | "zOrder">>,
): PreparedAsset<"expanded"> {
  return {
    ...asset,
    record: {
      ...asset.record,
      ...changes,
    },
  };
}

interface InvalidCase {
  readonly label: string;
  readonly asset: () => PreparedAsset<"expanded">;
  readonly transform: ReadonlyMatrix2D;
  readonly path: string;
}

const INVALID_CASES: readonly InvalidCase[] = [
  {
    asset: () => createPreparedAsset("https://example.test/unverified.webp"),
    label: "a non-object URL",
    path: "asset.objectUrl",
    transform: RELATIVE_TRANSFORM,
  },
  {
    asset: () => withRecord(createPreparedAsset(), {
      sourceRect: { ...SOURCE_RECT, width: 2_700 },
    }),
    label: "an out-of-bounds canonical rectangle",
    path: "asset.record.sourceRect",
    transform: RELATIVE_TRANSFORM,
  },
  {
    asset: () => withRecord(createPreparedAsset(), { zOrder: 1.5 }),
    label: "a fractional z-order",
    path: "asset.record.zOrder",
    transform: RELATIVE_TRANSFORM,
  },
  {
    asset: createPreparedAsset,
    label: "a nonfinite transform component",
    path: "relativeTransform.e",
    transform: { ...RELATIVE_TRANSFORM, e: Number.POSITIVE_INFINITY },
  },
];

// Validates: Requirements 6.16, 6.17, 7.6–7.9, 11.1, 11.2, 11.13.
describe("LayeredWatchLayer", () => {
  it("is decorative, skipped by focus, non-draggable, and excluded from pointer interaction", async () => {
    const user = userEvent.setup();
    const onControlClick = vi.fn();
    const asset = createPreparedAsset();
    asset.image.alt = "Untrusted decoded-image text";
    asset.image.tabIndex = 0;
    asset.image.draggable = true;
    asset.image.style.pointerEvents = "auto";
    asset.image.onclick = vi.fn();

    const { container } = render(
      <div>
        <button type="button">Before layer</button>
        <LayeredWatchLayer
          asset={asset}
          relativeTransform={RELATIVE_TRANSFORM}
        />
        <button type="button" onClick={onControlClick}>After layer</button>
      </div>,
    );
    const layer = getLayer(container);
    const before = screen.getByRole("button", { name: "Before layer" });
    const after = screen.getByRole("button", { name: "After layer" });

    expect(container.querySelectorAll("img.watch-layer-image")).toHaveLength(1);
    expect(layer).toHaveAttribute("alt", "");
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer).not.toHaveAttribute("role");
    expect(layer).toHaveAccessibleName("");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(layer).toHaveAttribute("tabindex", "-1");
    expect(layer.tabIndex).toBe(-1);
    expect(layer).toHaveAttribute("draggable", "false");
    expect(layer.draggable).toBe(false);
    expect(layer).toHaveStyle({ pointerEvents: "none" });
    expect(layer.getAttributeNames().filter((name) => name.startsWith("on"))).toEqual([]);
    expect(COMPONENT_SOURCE).not.toMatch(
      /\bon(?:Click|DoubleClick|Pointer\w*|Touch\w*|Mouse\w*|Wheel|Drag\w*|Key\w*|Focus|Blur|Load|Error)\s*=/u,
    );
    expect(COMPONENT_SOURCE).not.toMatch(/<img[\s\S]*?\{\s*\.\.\./u);

    await user.tab();
    expect(before).toHaveFocus();
    await user.tab();
    expect(after).toHaveFocus();
    await expect(user.click(layer)).rejects.toThrow(/pointer-events: none/u);
    await user.click(after);
    expect(onControlClick).toHaveBeenCalledTimes(1);
  });

  it("renders deterministic canonical geometry, approved z-order, object URL, and only a relative transform custom property", () => {
    const asset = createPreparedAsset();
    const view = render(
      <LayeredWatchLayer
        asset={asset}
        relativeTransform={RELATIVE_TRANSFORM}
      />,
    );
    const layer = getLayer(view.container);
    const initialMarkup = view.container.innerHTML;

    expect(layer).toHaveAttribute("data-watch-layer-id", "upper-wheel");
    expect(layer).toHaveAttribute("src", asset.objectUrl);
    expect(layer).not.toHaveAttribute("srcset");
    expect(layer.outerHTML).not.toContain(asset.record.publicPath);
    expect(layer.style.left).toBe("113px");
    expect(layer.style.top).toBe("211px");
    expect(layer.style.width).toBe("377px");
    expect(layer.style.height).toBe("149px");
    expect(layer.style.zIndex).toBe("23");
    expect(layer.style.getPropertyValue(WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY)).toBe(
      "matrix(0.75, 0, -0.125, 1, 8.5, -3)",
    );
    expect(layer.style.transform).toBe("");
    expect(Array.from(layer.style).filter((name) => (
      name.includes("global") || name.includes("inherited")
    ))).toEqual([]);

    view.rerender(
      <LayeredWatchLayer
        asset={asset}
        relativeTransform={{ ...RELATIVE_TRANSFORM }}
      />,
    );
    expect(view.container.innerHTML).toBe(initialMarkup);
  });

  it.each(INVALID_CASES)("fails closed for $label", ({ asset, transform, path }) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(
      <LayeredWatchLayer asset={asset()} relativeTransform={transform} />,
    )).toThrow(LayeredWatchLayerInvariantError);

    try {
      render(<LayeredWatchLayer asset={asset()} relativeTransform={transform} />);
    } catch (error) {
      expect(error).toBeInstanceOf(LayeredWatchLayerInvariantError);
      expect(error).toMatchObject({ code: "runtime-invariant", path });
    } finally {
      consoleError.mockRestore();
    }
  });
});
