"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchDictionary } from "@/lib/search";
import type { DictionaryTerm } from "@/lib/types";

interface SearchBarProps {
  readonly terms: readonly DictionaryTerm[];
  readonly onSelect: (term: DictionaryTerm, opener?: HTMLElement | null) => void;
}

export function SearchBar({ terms, onSelect }: SearchBarProps) {
  const reduceMotion = useReducedMotion();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => searchDictionary(terms, query), [query, terms]);
  const isExpanded = open && results.length > 0;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function choose(term: DictionaryTerm) {
    setQuery(term.term);
    setOpen(false);
    onSelect(term, inputRef.current);
  }

  function clearSearch() {
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="search-combobox">
      <div className={`search-pill${isExpanded ? " search-pill--expanded" : ""}`}>
        <label className="sr-only" htmlFor="watch-search">Search watch brands and terminology</label>
        <input
          ref={inputRef}
          id="watch-search"
          type="search"
          value={query}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search thousands of watches..."
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isExpanded}
          aria-controls={listboxId}
          aria-activedescendant={isExpanded ? `${listboxId}-option-${activeIndex}` : undefined}
          onFocus={() => setOpen(results.length > 0)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current + 1) % results.length);
            } else if (event.key === "ArrowUp" && results.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current - 1 + results.length) % results.length);
            } else if (event.key === "Enter" && isExpanded) {
              event.preventDefault();
              const result = results[activeIndex];
              if (result) choose(result.term);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
        {query ? (
          <button className="search-pill__clear" type="button" onClick={clearSearch} aria-label="Clear search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        ) : null}
        <svg className="search-pill__icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.2" />
          <path d="m15.1 15.1 4.6 4.6" />
        </svg>
      </div>

      <AnimatePresence>
        {isExpanded ? (
          <motion.div
            className="search-results"
            initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.995 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="search-results__meta">
              <span>{results.length} {results.length === 1 ? "result" : "results"}</span>
              <span>↑↓ navigate · ↵ open</span>
            </div>
            <ul id={listboxId} role="listbox" aria-label="Watch dictionary suggestions">
              {results.map(({ term, matchedField }, index) => (
                <li
                  id={`${listboxId}-option-${index}`}
                  key={term.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? "is-active" : undefined}
                  onPointerMove={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(term)}
                >
                  <span className="search-result__ruby" aria-hidden="true" />
                  <span className="search-result__text">
                    <strong>{term.term}</strong>
                    <span>{term.category} · matched {matchedField}</span>
                  </span>
                  <span className="search-result__arrow" aria-hidden="true">↗</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <p className="sr-only" role="status" aria-live="polite">
        {query ? `${results.length} search suggestions available.` : "Search is clear."}
      </p>
    </div>
  );
}
