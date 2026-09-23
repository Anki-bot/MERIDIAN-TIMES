import type { DictionaryTerm, SearchResult } from "./types";

export function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function acronym(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

function subsequencePenalty(candidate: string, query: string): number | null {
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < query.length; candidateIndex += 1) {
    if (candidate[candidateIndex] === query[queryIndex]) {
      if (firstMatch < 0) firstMatch = candidateIndex;
      lastMatch = candidateIndex;
      queryIndex += 1;
    }
  }

  if (queryIndex !== query.length) return null;
  return Math.max(0, lastMatch - firstMatch + 1 - query.length) + firstMatch;
}

function scoreCandidate(candidateValue: string, normalizedQuery: string, weight: number): number {
  const candidate = normalizeSearchValue(candidateValue);
  if (!candidate) return Number.NEGATIVE_INFINITY;
  if (candidate === normalizedQuery) return weight + 120;
  if (candidate.startsWith(normalizedQuery)) return weight + 92 - Math.min(24, candidate.length - normalizedQuery.length);

  const wordIndex = candidate.split(" ").findIndex((word) => word.startsWith(normalizedQuery));
  if (wordIndex >= 0) return weight + 76 - wordIndex * 3;

  const containedAt = candidate.indexOf(normalizedQuery);
  if (containedAt >= 0) return weight + 62 - Math.min(30, containedAt);
  if (acronym(candidate) === normalizedQuery) return weight + 70;

  const penalty = subsequencePenalty(candidate, normalizedQuery.replaceAll(" ", ""));
  return penalty === null ? Number.NEGATIVE_INFINITY : weight + 35 - Math.min(34, penalty);
}

function bestFieldScore(term: DictionaryTerm, query: string): Omit<SearchResult, "term"> | null {
  const candidates: Array<{
    field: SearchResult["matchedField"];
    value: string;
    weight: number;
  }> = [
    { field: "term", value: term.term, weight: 150 },
    { field: "term", value: term.nodeLabel, weight: 142 },
    ...term.keywords.map((value) => ({ field: "keyword" as const, value, weight: 112 })),
    ...term.signatures.map((value) => ({ field: "signature" as const, value, weight: 92 })),
    { field: "category", value: term.category, weight: 72 },
    { field: "definition", value: term.definition, weight: 46 },
  ];

  let best: Omit<SearchResult, "term"> | null = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate.value, query, candidate.weight);
    if (Number.isFinite(score) && (!best || score > best.score)) {
      best = { score, matchedField: candidate.field };
    }
  }
  return best;
}

export function searchDictionary(
  terms: readonly DictionaryTerm[],
  query: string,
  limit = 7,
): readonly SearchResult[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery || limit <= 0) return [];

  return terms
    .flatMap((term) => {
      const match = bestFieldScore(term, normalizedQuery);
      return match ? [{ term, ...match }] : [];
    })
    .sort((left, right) => (
      right.score - left.score
      || left.term.term.localeCompare(right.term.term, "en", { sensitivity: "base" })
      || left.term.id.localeCompare(right.term.id, "en")
    ))
    .slice(0, limit);
}
