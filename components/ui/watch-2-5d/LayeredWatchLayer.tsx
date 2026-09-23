"use client";

import type { CSSProperties } from "react";
import {
  CANONICAL_SOURCE_HEIGHT,
  CANONICAL_SOURCE_WIDTH,
  type PreparedAsset,
  type ProfileId,
  type ReadonlyMatrix2D,
  type SourceRect,
} from "@/lib/watch-2-5d/types";

export const WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY = "--watch-layer-transform" as const;

const MATRIX_FIELDS = ["a", "b", "c", "d", "e", "f"] as const;

type LayeredWatchLayerStyle = CSSProperties & {
  readonly [WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY]: string;
};

export interface LayeredWatchLayerProps<P extends ProfileId = ProfileId> {
  readonly asset: PreparedAsset<P>;
  /** Precomposed approved relative depth/part transform; global motion belongs to the outer group. */
  readonly relativeTransform: ReadonlyMatrix2D;
}

export class LayeredWatchLayerInvariantError extends RangeError {
  readonly code = "runtime-invariant" as const;
  readonly path: string;

  constructor(path: string) {
    super(`Invalid layered watch value at ${path}.`);
    this.name = "LayeredWatchLayerInvariantError";
    this.path = path;
  }
}

function invariantFailure(path: string): never {
  throw new LayeredWatchLayerInvariantError(path);
}

function assertCanonicalSourceRect(rect: SourceRect): SourceRect {
  if (rect === null || typeof rect !== "object") {
    return invariantFailure("asset.record.sourceRect");
  }

  for (const field of ["x", "y", "width", "height"] as const) {
    if (!Number.isSafeInteger(rect[field])) {
      return invariantFailure(`asset.record.sourceRect.${field}`);
    }
  }

  if (
    rect.x < 0
    || rect.y < 0
    || rect.width <= 0
    || rect.height <= 0
    || rect.x + rect.width > CANONICAL_SOURCE_WIDTH
    || rect.y + rect.height > CANONICAL_SOURCE_HEIGHT
  ) {
    return invariantFailure("asset.record.sourceRect");
  }

  return rect;
}

function assertVerifiedObjectUrl(objectUrl: string): string {
  if (
    typeof objectUrl !== "string"
    || objectUrl.length <= "blob:".length
    || objectUrl !== objectUrl.trim()
    || !objectUrl.startsWith("blob:")
    || /\s/u.test(objectUrl)
  ) {
    return invariantFailure("asset.objectUrl");
  }

  return objectUrl;
}

function assertZOrder(zOrder: number): number {
  if (!Number.isSafeInteger(zOrder)) {
    return invariantFailure("asset.record.zOrder");
  }
  return zOrder;
}

function assertRelativeTransform(transform: ReadonlyMatrix2D): ReadonlyMatrix2D {
  if (transform === null || typeof transform !== "object") {
    return invariantFailure("relativeTransform");
  }

  for (const field of MATRIX_FIELDS) {
    if (!Number.isFinite(transform[field])) {
      return invariantFailure(`relativeTransform.${field}`);
    }
  }

  return transform;
}

function cssNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

function matrixCssValue(transform: ReadonlyMatrix2D): string {
  return `matrix(${MATRIX_FIELDS.map((field) => cssNumber(transform[field])).join(", ")})`;
}

export function LayeredWatchLayer<P extends ProfileId>({
  asset,
  relativeTransform,
}: LayeredWatchLayerProps<P>) {
  const sourceRect = assertCanonicalSourceRect(asset.record.sourceRect);
  const objectUrl = assertVerifiedObjectUrl(asset.objectUrl);
  const zOrder = assertZOrder(asset.record.zOrder);
  const transform = assertRelativeTransform(relativeTransform);
  const style = {
    height: `${sourceRect.height}px`,
    left: `${sourceRect.x}px`,
    pointerEvents: "none",
    top: `${sourceRect.y}px`,
    width: `${sourceRect.width}px`,
    zIndex: zOrder,
    [WATCH_LAYER_TRANSFORM_CUSTOM_PROPERTY]: matrixCssValue(transform),
  } satisfies LayeredWatchLayerStyle;

  return (
    // Verified decoded blob URLs must bypass Next Image optimization and make no network substitution.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="watch-layer-image"
      data-watch-layer-id={String(asset.record.layerId)}
      src={objectUrl}
      alt=""
      aria-hidden="true"
      tabIndex={-1}
      decoding="async"
      draggable={false}
      style={style}
    />
  );
}
