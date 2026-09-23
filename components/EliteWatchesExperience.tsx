"use client";

import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { DefinitionPanel } from "@/components/ui/DefinitionPanel";
import { NodeGraph } from "@/components/ui/NodeGraph";
import { SearchBar } from "@/components/ui/SearchBar";
import { audienceForTerm } from "@/lib/graph";
import { useExperienceContext } from "@/lib/context/ExperienceContext";
import type { DictionaryTerm, WatchAudience } from "@/lib/types";

interface EliteWatchesExperienceProps {
  readonly terms: readonly DictionaryTerm[];
}

export function EliteWatchesExperience({ terms }: EliteWatchesExperienceProps) {
  const { setDefinitionOpen, setReducedMotion } = useExperienceContext();
  const reduceMotion = useReducedMotion();
  const [activeAudience, setActiveAudience] = useState<WatchAudience | null>(
    null,
  );
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<DictionaryTerm | null>(null);
  const [definitionOpener, setDefinitionOpener] = useState<HTMLElement | null>(
    null,
  );

  useEffect(() => {
    setReducedMotion(Boolean(reduceMotion));
  }, [reduceMotion, setReducedMotion]);

  useEffect(() => {
    setDefinitionOpen(selectedTerm !== null);
  }, [selectedTerm, setDefinitionOpen]);

  const openTerm = useCallback(
    (term: DictionaryTerm, opener?: HTMLElement | null) => {
      if (opener) setDefinitionOpener(opener);
      if (term.kind === "specific-watch") {
        setActiveAudience((current) => audienceForTerm(term, current));
      } else {
        setActiveAudience((current) => audienceForTerm(term, current));
        if (term.kind === "brand") setActiveBrand(term.id);
      }
      setSelectedTerm(term);
    },
    [],
  );

  const closeDefinition = useCallback(() => {
    setSelectedTerm(null);
  }, []);

  const handleAudienceSelect = useCallback(
    (audience: WatchAudience) => {
      setActiveAudience((current) => {
        const next = current === audience ? null : audience;
        if (next === null) setActiveBrand(null);
        return next;
      });
    },
    [activeBrand],
  );

  const handleBrandSelect = useCallback(
    (brandId: string) => {
      const term = terms.find((candidate) => candidate.id === brandId);
      if (!term) {
        setActiveBrand((current) => (current === brandId ? null : brandId));
        return;
      }
      setActiveAudience((current) => audienceForTerm(term, current));
      setActiveBrand(brandId);
      setSelectedTerm(term);
      const opener = document.querySelector<HTMLElement>(
        `button.atlas-node[data-presentation-id="${brandId}"]`,
      );
      if (opener) setDefinitionOpener(opener);
    },
    [terms],
  );

  const handleBackdropBack = useCallback(() => {
    if (activeBrand !== null) {
      setActiveBrand(null);
      return;
    }
    if (activeAudience !== null) {
      setActiveAudience(null);
    }
  }, [activeAudience, activeBrand]);

  const activeLabel =
    activeAudience === "men" ? "Men's collection" : "Women's collection";

  return (
    <>
      <a className="skip-link" href="#watch-explorer">
        Skip to watch explorer
      </a>

      <header className="site-masthead">
        <nav
          className="masthead-nav masthead-nav--left"
          aria-label="Primary navigation"
        >
          <a href="#watch-atlas">COLLECTION</a>
          <a href="/about">ABOUT</a>
        </nav>

        <a
          className="wordmark"
          href="#watch-explorer"
          aria-label="MERIDIAN WATCHES home"
        >
          MERIDIAN WATCHES
        </a>

        <nav
          className="masthead-nav masthead-nav--right flex items-center gap-6"
          aria-label="Account navigation"
        >
          <div className="transform scale-75 origin-right opacity-90 hover:opacity-100 transition-opacity">
            <SearchBar terms={terms} onSelect={openTerm} />
          </div>
          <a href="/contact">CONTACT</a>
          <a href="/login">LOGIN</a>
        </nav>
      </header>

      <main id="watch-explorer" className="watch-explorer" tabIndex={-1}>
        <h1 className="sr-only">MERIDIAN WATCHES interactive watch atlas</h1>

        <NodeGraph
          terms={terms}
          activeAudience={activeAudience}
          activeBrand={activeBrand}
          selectedTermId={selectedTerm?.id ?? null}
          onAudienceSelect={handleAudienceSelect}
          onBrandSelect={handleBrandSelect}
          onTermSelect={openTerm}
          onBackdropBack={handleBackdropBack}
        />

        <p className="browse-instruction">
          {activeBrand
            ? `SHOWING ${activeBrand.toUpperCase()} COLLECTION — SELECT A WATCH`
            : activeAudience
              ? `${activeLabel.toUpperCase()} — SELECT A BRAND`
              : "SELECT GENDER TO BROWSE BRANDS"}
        </p>
      </main>

      <DefinitionPanel
        term={selectedTerm}
        allTerms={terms}
        opener={definitionOpener}
        onClose={closeDefinition}
        onSelectRelated={(term) => openTerm(term)}
      />
    </>
  );
}
