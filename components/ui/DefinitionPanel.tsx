"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import type { DictionaryTerm } from "@/lib/types";

interface DefinitionPanelProps {
  readonly term: DictionaryTerm | null;
  readonly allTerms: readonly DictionaryTerm[];
  readonly opener: HTMLElement | null;
  readonly onClose: () => void;
  readonly onSelectRelated: (term: DictionaryTerm) => void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function DefinitionPanel({
  term,
  allTerms,
  opener,
  onClose,
  onSelectRelated,
}: DefinitionPanelProps) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const retainedOpenerRef = useRef<HTMLElement | null>(null);
  const isOpen = term !== null;
  const relatedTerms = useMemo(() => {
    if (!term) return [];
    const ids = new Set(term.relatedIds);
    return allTerms.filter((candidate) => ids.has(candidate.id));
  }, [allTerms, term]);

  useEffect(() => {
    if (!isOpen) return undefined;
    if (opener) retainedOpenerRef.current = opener;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const returnTarget = retainedOpenerRef.current;
      queueMicrotask(() => {
        if (returnTarget?.isConnected && !(returnTarget as HTMLButtonElement).disabled) {
          returnTarget.focus();
        } else {
          document.getElementById("watch-search")?.focus();
        }
      });
    };
  }, [isOpen, onClose, opener]);

  useEffect(() => {
    if (!term) return;
    const focusHandle = window.setTimeout(() => titleRef.current?.focus(), reduceMotion ? 0 : 80);
    return () => window.clearTimeout(focusHandle);
  }, [reduceMotion, term]);

  return (
    <AnimatePresence>
      {term ? (
        <motion.div
          className="definition-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.28 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.aside
            ref={panelRef}
            className="definition-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="definition-title"
            aria-describedby="definition-summary"
            initial={reduceMotion ? false : { opacity: 0, x: 54, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32, scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="definition-panel__rail" aria-hidden="true">
              <span>MW</span>
              <span>{term.category.toUpperCase()}</span>
              <span>{term.id.slice(0, 3).toUpperCase()}</span>
            </div>

            <button className="definition-close" type="button" onClick={onClose} aria-label="Close definition">
              <span>CLOSE</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
            </button>

            <motion.div
              key={term.id}
              className="definition-panel__content"
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.34, delay: reduceMotion ? 0 : 0.08 }}
            >
              <div className="definition-kicker">
                <span className="definition-kicker__ruby" aria-hidden="true" />
                <span>{term.category}</span>
                <span aria-hidden="true">/</span>
                <span>{term.kind === "brand" ? "MAISON" : "REFERENCE"}</span>
              </div>

              <h2 id="definition-title" ref={titleRef} tabIndex={-1}>{term.term}</h2>
              <p id="definition-summary" className="definition-summary">{term.definition}</p>

              <div className="definition-divider" aria-hidden="true"><span /></div>

              <section aria-labelledby="history-heading">
                <div className="definition-section-heading">
                  <span>01</span><h3 id="history-heading">History & context</h3>
                </div>
                <p>{term.history}</p>
              </section>

              <section aria-labelledby="signatures-heading">
                <div className="definition-section-heading">
                  <span>02</span><h3 id="signatures-heading">Signatures</h3>
                </div>
                <ul className="signature-list">
                  {term.signatures.map((signature) => (
                    <li key={signature}><span aria-hidden="true" />{signature}</li>
                  ))}
                </ul>
              </section>

              {relatedTerms.length > 0 ? (
                <section aria-labelledby="related-heading">
                  <div className="definition-section-heading">
                    <span>03</span><h3 id="related-heading">Related terminology</h3>
                  </div>
                  <div className="related-term-list">
                    {relatedTerms.map((related) => (
                      <button key={related.id} type="button" onClick={() => onSelectRelated(related)}>
                        <span>{related.term}</span><span aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </motion.div>

            <div className="definition-panel__footer" aria-hidden="true">
              <span>MERIDIAN WATCHES ARCHIVE</span>
              <span>ESC TO CLOSE</span>
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
