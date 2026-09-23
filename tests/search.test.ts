import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dictionaryTerms } from "@/lib/dictionary";
import { normalizeSearchValue, searchDictionary } from "@/lib/search";

const PROPERTY_SEED = 0x51a1c0de;

describe("fuzzy watch search", () => {
  it("matches exact names, aliases, signatures, and tolerant abbreviations", () => {
    expect(searchDictionary(dictionaryTerms, "Rolex")[0]?.term.id).toBe("rolex");
    expect(searchDictionary(dictionaryTerms, "Moonwatch")[0]?.term.id).toBe("omega");
    expect(searchDictionary(dictionaryTerms, "Cartier")[0]?.term.id).toBe("cartier");
    expect(searchDictionary(dictionaryTerms, "rotating cage")[0]?.term.id).toBe("tourbillon");
    expect(searchDictionary(dictionaryTerms, "ptk philpe")[0]?.term.id).toBe("patek-philippe");
  });

  it("returns no suggestions for a blank query and obeys the result limit", () => {
    expect(searchDictionary(dictionaryTerms, "   ")).toEqual([]);
    expect(searchDictionary(dictionaryTerms, "watch", 3)).toHaveLength(3);
  });

  it("normalizes punctuation, accents, and repeated whitespace", () => {
    expect(normalizeSearchValue("  Cartier–Tank  ")).toBe("cartier tank");
    expect(normalizeSearchValue("MÉCANIQUE  &  LUNE")).toBe("mecanique and lune");
  });

  it("Property: an exact term query always ranks that entry first", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: dictionaryTerms.length - 1 }),
        fc.boolean(),
        (index, uppercase) => {
          const expected = dictionaryTerms[index];
          const query = uppercase ? expected.term.toLocaleUpperCase("en-US") : expected.term;
          expect(searchDictionary(dictionaryTerms, query)[0]?.term.id).toBe(expected.id);
        },
      ),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });
});
