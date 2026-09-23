"use client";

import { useContext } from "react";
import full3DRelease from "@/data/full-3d-release.json";
import { LayeredWatchEnhancement } from "@/components/ui/watch-2-5d/LayeredWatchEnhancement";
import { Full3DWatchCanvas } from "@/components/canvas/Full3DWatchCanvas";
import { ExperienceContext } from "@/lib/context/ExperienceContext";

export interface WatchImageBackdropProps {
  readonly definitionOpen?: boolean;
  readonly reducedMotion?: boolean;
}

export function WatchImageBackdrop({
  definitionOpen: propDefinitionOpen,
  reducedMotion: propReducedMotion,
}: WatchImageBackdropProps) {
  const ctx = useContext(ExperienceContext);
  const definitionOpen = propDefinitionOpen ?? ctx?.definitionOpen ?? false;
  const reducedMotion = propReducedMotion ?? ctx?.reducedMotion ?? false;
  return (
    <div
      className="watch-image-backdrop -z-10 absolute inset-0 h-full w-full overflow-hidden"
      data-definition-open={String(definitionOpen)}
      data-reduced-motion={String(reducedMotion)}
      data-image-state="ready"
      style={{ backgroundColor: "#101416", pointerEvents: "none" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="watch-image-backdrop__image absolute inset-0 h-full w-full object-cover -z-10"
        src="/assets/watch/background-4k.webp"
        alt=""
        aria-hidden="true"
        decoding="async"
        data-testid="watch-image-backdrop"
      />

      <LayeredWatchEnhancement
        definitionOpen={definitionOpen}
        fallbackState="ready"
        reducedMotion={reducedMotion}
      />

      {full3DRelease.status === "ready" ? (
        <Full3DWatchCanvas
          definitionOpen={definitionOpen}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </div>
  );
}
