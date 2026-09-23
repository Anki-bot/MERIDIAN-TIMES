import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export interface PreservationManifestEntry {
  readonly digest: string;
  readonly id: string;
}

type CssBlock = {
  readonly ancestors: readonly string[];
  readonly body: string;
  readonly selector: string;
};

const HISTORICAL_SPEC_DIRECTORY = ".kiro/specs/ai-coding-dictionary-inspired-site";
const WATCH_CANVAS_PATH = "components/canvas/WatchMovementCanvas.tsx";
const GLOBALS_PATH = "app/globals.css";
const WATCH_SELECTOR_PATTERN = /\.(?:watch-(?:canvas-shell|static-fallback)|static-(?:case|gear|balance|bridge|jewel))[\w-]*/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function listFilesRecursively(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFilesRecursively(path) : entry.isFile() ? [path] : [];
    });
}

function normalizePrelude(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

function findOpeningBrace(source: string, start: number, end: number): number {
  let quote: "'" | '"' | null = null;
  let inComment = false;

  for (let index = start; index < end; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      continue;
    }
    if (current === "{") return index;
  }
  return -1;
}

function findClosingBrace(source: string, openingIndex: number, end: number): number {
  let depth = 1;
  let quote: "'" | '"' | null = null;
  let inComment = false;

  for (let index = openingIndex + 1; index < end; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced CSS block starting at byte ${openingIndex}`);
}

function collectCssBlocks(
  source: string,
  start = 0,
  end = source.length,
  ancestors: readonly string[] = [],
): readonly CssBlock[] {
  const blocks: CssBlock[] = [];
  let cursor = start;

  while (cursor < end) {
    const openingIndex = findOpeningBrace(source, cursor, end);
    if (openingIndex < 0) break;
    const rawPrelude = source.slice(cursor, openingIndex);
    const prelude = normalizePrelude(rawPrelude.slice(rawPrelude.lastIndexOf(";") + 1));
    const closingIndex = findClosingBrace(source, openingIndex, end);

    if (prelude.startsWith("@")) {
      blocks.push(...collectCssBlocks(
        source,
        openingIndex + 1,
        closingIndex,
        [...ancestors, prelude],
      ));
    } else if (prelude) {
      blocks.push({
        ancestors,
        body: source.slice(openingIndex + 1, closingIndex),
        selector: prelude,
      });
    }
    cursor = closingIndex + 1;
  }

  return blocks;
}

export function extractWatchCssManifestEntries(source: string): readonly PreservationManifestEntry[] {
  const occurrences = new Map<string, number>();
  return collectCssBlocks(source)
    .filter(({ selector }) => WATCH_SELECTOR_PATTERN.test(selector))
    .map(({ ancestors, body, selector }) => {
      const qualifiedSelector = [...ancestors, selector].join(" > ");
      const baseId = `${GLOBALS_PATH}#${qualifiedSelector}`;
      const occurrence = (occurrences.get(baseId) ?? 0) + 1;
      occurrences.set(baseId, occurrence);
      const id = occurrence === 1 ? baseId : `${baseId} [${occurrence}]`;
      const payload = `${ancestors.join("\n")}\n${selector}\n{${body}}`;
      return { digest: digest(payload), id };
    })
    .sort((left, right) => compareText(left.id, right.id));
}

export function createPreservationManifest(
  projectRoot = process.cwd(),
): readonly PreservationManifestEntry[] {
  const protectedSpecDirectories = [
    HISTORICAL_SPEC_DIRECTORY,
    ".kiro/specs/animated-watch-image-glass-header",
  ] as const;
  const predecessorAssetContractPaths = [
    "data/watch-image-asset.json",
    "public/assets/watch/elite-watch-1035.avif",
    "public/assets/watch/elite-watch-1035.webp",
    "public/assets/watch/elite-watch-1380.avif",
    "public/assets/watch/elite-watch-1380.webp",
    "public/assets/watch/elite-watch-2070.avif",
    "public/assets/watch/elite-watch-2070.webp",
    "public/assets/watch/elite-watch-2760.avif",
    "public/assets/watch/elite-watch-2760.webp",
    "public/assets/watch/elite-watch-690.avif",
    "public/assets/watch/elite-watch-690.webp",
  ] as const;
  const canonicalMasterPath = "source/assets/elite-watch-master.png";
  const packagePath = "package.json";
  const dependencyFields = ["dependencies", "devDependencies"] as const;

  const protectedSpecFiles = protectedSpecDirectories.flatMap((directory) => (
    listFilesRecursively(resolve(projectRoot, directory))
  ));
  const protectedFilePaths = [
    ...protectedSpecFiles,
    resolve(projectRoot, WATCH_CANVAS_PATH),
    resolve(projectRoot, canonicalMasterPath),
    ...predecessorAssetContractPaths.map((path) => resolve(projectRoot, path)),
  ];
  const fileEntries = protectedFilePaths.map((path) => ({
    digest: digest(readFileSync(path)),
    id: normalizedPath(projectRoot, path),
  }));

  const packageDocument: unknown = JSON.parse(
    readFileSync(resolve(projectRoot, packagePath), "utf8"),
  );
  if (
    packageDocument === null
    || typeof packageDocument !== "object"
    || Array.isArray(packageDocument)
  ) {
    throw new Error("package.json must contain a JSON object");
  }
  const dependencyEntries = dependencyFields.map((field) => {
    const value = (packageDocument as Record<string, unknown>)[field];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`package.json ${field} must contain a JSON object`);
    }
    const serialized = JSON.stringify(value);
    return {
      digest: digest(serialized),
      id: `${packagePath}#${field}`,
    };
  });

  const watchCssEntries = extractWatchCssManifestEntries(
    readFileSync(resolve(projectRoot, GLOBALS_PATH), "utf8"),
  );

  return [...fileEntries, ...dependencyEntries, ...watchCssEntries]
    .sort((left, right) => compareText(left.id, right.id));
}

export function formatPreservationManifest(
  entries: readonly PreservationManifestEntry[],
): string {
  return `${entries.map(({ digest: hash, id }) => `${hash}  ${id}`).join("\n")}\n`;
}
