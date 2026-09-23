import { createHash } from "node:crypto";

const BROWSER_FAMILIES = ["chrome", "edge", "firefox", "safari", "ios-safari", "android-chrome"];
const EVIDENCE_SCHEMA_VERSION = 1;

function fail(code, path, message) {
  const err = new TypeError(message);
  err.code = code;
  err.path = path;
  err.issueCode = code;
  throw err;
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("BROWSER_EVIDENCE_INVALID", path, "Expected finite number");
  return value;
}

function canonicalKeys(obj) {
  return Object.keys(obj).sort();
}

function serializeCanonical(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(serializeCanonical).join(",")}]`;
  const keys = canonicalKeys(obj);
  return `{${keys.map(k => `${JSON.stringify(k)}:${serializeCanonical(obj[k])}`).join(",")}}`;
}

export function canonicalizeBrowserEvidence(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("BROWSER_EVIDENCE_INVALID", "$", "Evidence must be a plain object");
  }
  const allowed = new Set(["schemaVersion", "runId", "timestamp", "browser", "version", "viewport", "release", "evidence"]);
  const unknown = Object.keys(value).filter(k => !allowed.has(k));
  if (unknown.length > 0) fail("BROWSER_EVIDENCE_UNKNOWN_FIELD", `$.${unknown[0]}`, `Unknown field ${unknown[0]}`);
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) fail("BROWSER_EVIDENCE_INVALID", "$.schemaVersion", "Unsupported schemaVersion");

  // minimal validation for fallback-only vs ready
  if (value.browser && !BROWSER_FAMILIES.includes(value.browser)) {
    fail("BROWSER_EVIDENCE_INVALID", "$.browser", "Unsupported browser family");
  }
  if (value.viewport) {
    finiteNumber(value.viewport.width, "$.viewport.width");
    finiteNumber(value.viewport.height, "$.viewport.height");
    finiteNumber(value.viewport.dpr, "$.viewport.dpr");
  }
  // evidence field should be object
  if (value.evidence && typeof value.evidence !== "object") {
    fail("BROWSER_EVIDENCE_INVALID", "$.evidence", "Evidence must be object");
  }
  // return frozen canonical copy
  return Object.freeze(JSON.parse(serializeCanonical(value)));
}

export function serializeBrowserEvidence(value) {
  const canonical = canonicalizeBrowserEvidence(value);
  return Buffer.from(`${serializeCanonical(canonical)}\n`, "utf8");
}

export function parseBrowserEvidence(input) {
  let text;
  if (typeof input === "string") text = input;
  else if (Buffer.isBuffer(input)) text = input.toString("utf8");
  else fail("BROWSER_EVIDENCE_INVALID", "$", "Expected string or Buffer");
  if (text.charCodeAt(0) === 0xfeff) fail("BROWSER_EVIDENCE_INVALID", "$", "BOM not allowed");
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail("BROWSER_EVIDENCE_INVALID", "$", "Malformed JSON"); }
  return canonicalizeBrowserEvidence(parsed);
}

export function hashBrowserEvidence(value) {
  const bytes = serializeBrowserEvidence(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export const BROWSER_EVIDENCE_FAMILIES = Object.freeze([...BROWSER_FAMILIES]);
export const BROWSER_EVIDENCE_SCHEMA_VERSION = EVIDENCE_SCHEMA_VERSION;
