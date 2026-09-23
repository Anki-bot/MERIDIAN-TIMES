import dictionarySource from "../data/dictionary.json";
import {
  DICTIONARY_CATEGORIES,
  TERM_KINDS,
  WATCH_AUDIENCES,
  type DictionaryIssue,
  type DictionaryTerm,
  type DictionaryValidationResult,
} from "./types";

const REQUIRED_TEXT_FIELDS = [
  "id",
  "slug",
  "term",
  "nodeLabel",
  "definition",
  "history",
] as const;

const REQUIRED_ARRAY_FIELDS = [
  "audiences",
  "signatures",
  "parentIds",
  "relatedIds",
  "keywords",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrimmedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isUniqueTextArray(value: unknown, allowEmpty: boolean): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(isTrimmedText)
    && new Set(value).size === value.length;
}

function cloneTerm(source: Record<string, unknown>): DictionaryTerm {
  return Object.freeze({
    id: source.id as string,
    slug: source.slug as string,
    term: source.term as string,
    nodeLabel: source.nodeLabel as string,
    category: source.category as DictionaryTerm["category"],
    kind: source.kind as DictionaryTerm["kind"],
    audiences: Object.freeze([...(source.audiences as string[])]) as DictionaryTerm["audiences"],
    definition: source.definition as string,
    history: source.history as string,
    signatures: Object.freeze([...(source.signatures as string[])]),
    parentIds: Object.freeze([...(source.parentIds as string[])]),
    relatedIds: Object.freeze([...(source.relatedIds as string[])]),
    keywords: Object.freeze([...(source.keywords as string[])]),
    graphNode: source.graphNode as boolean,
  });
}

function localIssues(source: unknown, index: number): DictionaryIssue[] {
  const issues: DictionaryIssue[] = [];

  if (!isRecord(source)) {
    return [{ index, field: "entry", message: "Entry must be an object." }];
  }

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!isTrimmedText(source[field])) {
      issues.push({ index, field, message: `${field} must be non-empty trimmed text.` });
    }
  }

  if (isTrimmedText(source.slug) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.slug)) {
    issues.push({ index, field: "slug", message: "slug must be lowercase kebab-case." });
  }

  if (!DICTIONARY_CATEGORIES.includes(source.category as never)) {
    issues.push({ index, field: "category", message: "category is not supported." });
  }

  if (!TERM_KINDS.includes(source.kind as never)) {
    issues.push({ index, field: "kind", message: "kind is not supported." });
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    const allowEmpty = field === "parentIds" || field === "relatedIds";
    if (!isUniqueTextArray(source[field], allowEmpty)) {
      issues.push({ index, field, message: `${field} must be a unique trimmed text array${allowEmpty ? "" : " with at least one value"}.` });
    }
  }

  if (
    Array.isArray(source.audiences)
    && !source.audiences.every((value) => WATCH_AUDIENCES.includes(value as never))
  ) {
    issues.push({ index, field: "audiences", message: "audiences contains an unsupported collection." });
  }

  if (typeof source.graphNode !== "boolean") {
    issues.push({ index, field: "graphNode", message: "graphNode must be a boolean." });
  }

  if (
    TERM_KINDS.includes(source.kind as never)
    && source.kind !== "collection"
    && Array.isArray(source.parentIds)
    && source.parentIds.length === 0
  ) {
    issues.push({ index, field: "parentIds", message: "Non-collection entries require at least one parent." });
  }

  return issues;
}

export function validateDictionary(source: unknown): DictionaryValidationResult {
  if (!Array.isArray(source)) {
    return Object.freeze({
      terms: Object.freeze([]),
      issues: Object.freeze([{ index: -1, field: "dictionary", message: "Dictionary must be an array." }]),
    });
  }

  const issues: DictionaryIssue[] = [];
  const locallyValid = source.flatMap((candidate, index) => {
    const candidateIssues = localIssues(candidate, index);
    issues.push(...candidateIssues);
    return candidateIssues.length === 0 && isRecord(candidate)
      ? [{ index, term: cloneTerm(candidate) }]
      : [];
  });

  const idCounts = new Map<string, number>();
  const slugCounts = new Map<string, number>();
  for (const { term } of locallyValid) {
    idCounts.set(term.id, (idCounts.get(term.id) ?? 0) + 1);
    slugCounts.set(term.slug, (slugCounts.get(term.slug) ?? 0) + 1);
  }

  let survivors = locallyValid.filter(({ index, term }) => {
    let valid = true;
    if ((idCounts.get(term.id) ?? 0) > 1) {
      issues.push({ index, field: "id", message: `Duplicate id: ${term.id}.` });
      valid = false;
    }
    if ((slugCounts.get(term.slug) ?? 0) > 1) {
      issues.push({ index, field: "slug", message: `Duplicate slug: ${term.slug}.` });
      valid = false;
    }
    return valid;
  });

  let changed = true;
  const reportedRelationships = new Set<string>();
  while (changed) {
    changed = false;
    const availableIds = new Set(survivors.map(({ term }) => term.id));
    survivors = survivors.filter(({ index, term }) => {
      const badReferences = [...term.parentIds, ...term.relatedIds].filter(
        (reference) => reference === term.id || !availableIds.has(reference),
      );
      if (badReferences.length === 0) {
        return true;
      }
      for (const reference of badReferences) {
        const key = `${index}:${reference}`;
        if (!reportedRelationships.has(key)) {
          issues.push({
            index,
            field: term.parentIds.includes(reference) ? "parentIds" : "relatedIds",
            message: reference === term.id
              ? "Entries cannot reference themselves."
              : `Unknown dictionary reference: ${reference}.`,
          });
          reportedRelationships.add(key);
        }
      }
      changed = true;
      return false;
    });
  }

  return Object.freeze({
    terms: Object.freeze(survivors.map(({ term }) => term)),
    issues: Object.freeze(issues),
  });
}

const validation = validateDictionary(dictionarySource);
if (validation.issues.length > 0) {
  throw new Error(
    `MERIDIAN WATCHES dictionary is invalid:\n${validation.issues
      .map((issue) => `[${issue.index}] ${issue.field}: ${issue.message}`)
      .join("\n")}`,
  );
}

export const dictionaryTerms = validation.terms;

export function getTermById(id: string): DictionaryTerm | undefined {
  return dictionaryTerms.find((term) => term.id === id);
}

export function getRelatedTerms(term: DictionaryTerm): readonly DictionaryTerm[] {
  const related = new Set(term.relatedIds);
  return dictionaryTerms.filter((candidate) => related.has(candidate.id));
}
