export const DICTIONARY_CATEGORIES = [
  "Collection",
  "Maison",
  "Complication",
  "Mechanics",
  "Specific Watch",
] as const;

export const TERM_KINDS = [
  "collection",
  "brand",
  "complication",
  "mechanics",
  "specific-watch",
] as const;

export const WATCH_AUDIENCES = ["men", "women"] as const;

export type DictionaryCategory = (typeof DICTIONARY_CATEGORIES)[number];
export type DictionaryTermKind = (typeof TERM_KINDS)[number];
export type WatchAudience = (typeof WATCH_AUDIENCES)[number];

export interface DictionaryTerm {
  readonly id: string;
  readonly slug: string;
  readonly term: string;
  readonly nodeLabel: string;
  readonly category: DictionaryCategory;
  readonly kind: DictionaryTermKind;
  readonly audiences: readonly WatchAudience[];
  readonly definition: string;
  readonly history: string;
  readonly signatures: readonly string[];
  readonly parentIds: readonly string[];
  readonly relatedIds: readonly string[];
  readonly keywords: readonly string[];
  readonly graphNode: boolean;
}

export interface DictionaryIssue {
  readonly index: number;
  readonly field: string;
  readonly message: string;
}

export interface DictionaryValidationResult {
  readonly terms: readonly DictionaryTerm[];
  readonly issues: readonly DictionaryIssue[];
}

export interface SearchResult {
  readonly term: DictionaryTerm;
  readonly score: number;
  readonly matchedField: "term" | "keyword" | "signature" | "category" | "definition";
}
