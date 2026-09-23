import { describe, expect, it } from "vitest";
import fc from "fast-check";
import source from "@/data/dictionary.json";
import { dictionaryTerms, validateDictionary } from "@/lib/dictionary";

const PROPERTY_SEED = 0x51a1c0de;

const REFERENCE_BRANDS = [
  "rolex",
  "patek-philippe",
  "audemars-piguet",
  "omega",
  "cartier",
  "tag-heuer",
  "hublot",
  "armani-exchange",
  "bentley",
  "hugo-boss",
  "burberry",
  "diesel",
  "movado",
];

describe("watch dictionary integrity", () => {
  it("loads a complete, relationship-safe original dictionary", () => {
    const validation = validateDictionary(source);
    expect(validation.issues).toEqual([]);
    expect(dictionaryTerms.length).toBeGreaterThanOrEqual(23);
    expect(new Set(dictionaryTerms.map(({ id }) => id)).size).toBe(dictionaryTerms.length);
    expect(new Set(dictionaryTerms.map(({ slug }) => slug)).size).toBe(dictionaryTerms.length);
    expect(dictionaryTerms.filter(({ kind }) => kind === "brand").map(({ id }) => id)).toEqual(
      expect.arrayContaining(REFERENCE_BRANDS),
    );
  });

  it("provides complete original records for every newly graphed maison", () => {
    for (const id of ["rolex", "cartier", "armani-exchange", "bentley", "hugo-boss"]) {
      const term = dictionaryTerms.find((candidate) => candidate.id === id);
      expect(term, `${id} should resolve`).toBeDefined();
      expect(term?.kind).toBe("brand");
      expect(term?.audiences).toEqual(["men", "women"]);
      expect(term?.definition.length).toBeGreaterThan(60);
      expect(term?.history.length).toBeGreaterThan(100);
      expect(term?.signatures).toHaveLength(3);
      expect(term?.parentIds).toEqual(["men", "women"]);
      expect(term?.graphNode).toBe(true);
    }
  });

  it("rejects entries with unresolved relationships", () => {
    const broken = structuredClone(source);
    broken[2].relatedIds.push("missing-maison");
    const result = validateDictionary(broken);
    expect(result.issues.some(({ field, message }) => field === "relatedIds" && message.includes("missing-maison"))).toBe(true);
    expect(result.terms.some(({ id }) => id === broken[2].id)).toBe(false);
  });

  it("Property: every relationship in any selected dictionary subset resolves", () => {
    const ids = dictionaryTerms.map(({ id }) => id);
    fc.assert(
      fc.property(fc.subarray(ids, { minLength: 1 }), (selectedIds) => {
        const selected = dictionaryTerms.filter(({ id }) => selectedIds.includes(id));
        const completeIds = new Set(dictionaryTerms.map(({ id }) => id));
        for (const term of selected) {
          expect([...term.parentIds, ...term.relatedIds].every((id) => completeIds.has(id))).toBe(true);
        }
      }),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });
});
