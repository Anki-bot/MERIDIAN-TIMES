"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface ExperienceContextValue {
  readonly definitionOpen: boolean;
  readonly setDefinitionOpen: (open: boolean) => void;
  readonly reducedMotion: boolean;
  readonly setReducedMotion: (reduced: boolean) => void;
}

export const ExperienceContext = createContext<ExperienceContextValue | undefined>(undefined);

export function ExperienceProvider({ children }: { readonly children: ReactNode }) {
  const [definitionOpen, setDefinitionOpen] = useState<boolean>(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  return (
    <ExperienceContext.Provider value={{ definitionOpen, setDefinitionOpen, reducedMotion, setReducedMotion }}>
      {children}
    </ExperienceContext.Provider>
  );
}

export function useExperienceContext(): ExperienceContextValue {
  const ctx = useContext(ExperienceContext);
  if (!ctx) {
    throw new Error("useExperienceContext must be used within an ExperienceProvider");
  }
  return ctx;
}
