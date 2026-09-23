const SCHEMA_FAILURE_CODE = "LAYER_SCHEMA_INVALID";

export const CANONICAL_JSON_ISSUE_CODES = Object.freeze({
  CYCLE: "SCHEMA_JSON_CYCLE",
  INVALID_TEXT: "SCHEMA_JSON_MALFORMED",
  INVALID_VALUE: "SCHEMA_JSON_INVALID_VALUE",
  NON_CANONICAL: "SCHEMA_JSON_NON_CANONICAL",
  NONFINITE_NUMBER: "SCHEMA_NUMBER_NONFINITE",
});

export class CanonicalJsonError extends TypeError {
  constructor(issueCode, message, path = "$") {
    super(message);
    this.code = SCHEMA_FAILURE_CODE;
    this.issueCode = issueCode;
    this.name = "CanonicalJsonError";
    this.path = path;
    this.failure = Object.freeze({
      code: this.code,
      issueCode: this.issueCode,
      message: this.message,
      ok: false,
      path: this.path,
    });
  }

  toJSON() {
    return this.failure;
  }
}

function fail(issueCode, message, path) {
  throw new CanonicalJsonError(issueCode, message, path);
}

function propertyPath(parent, key) {
  return /^[A-Za-z_$][A-Za-z\d_$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function assertUnicodeScalarString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) {
        fail(
          CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
          "Canonical JSON strings must not contain unpaired UTF-16 surrogates",
          path,
        );
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(
        CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
        "Canonical JSON strings must not contain unpaired UTF-16 surrogates",
        path,
      );
    }
  }
}

function cloneCanonical(value, path, ancestors) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(
        CANONICAL_JSON_ISSUE_CODES.NONFINITE_NUMBER,
        "Canonical JSON numbers must be finite",
        path,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    fail(
      CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
      `Canonical JSON cannot represent ${typeof value}`,
      path,
    );
  }
  if (ancestors.has(value)) {
    fail(
      CANONICAL_JSON_ISSUE_CODES.CYCLE,
      "Canonical JSON cannot represent cyclic data",
      path,
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (
          typeof key !== "string"
          || !/^(?:0|[1-9]\d*)$/u.test(key)
          || Number(key) >= value.length
        ) {
          fail(
            CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
            "Canonical JSON arrays must not contain named or symbol properties",
            path,
          );
        }
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          fail(
            CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
            "Canonical JSON arrays must not be sparse",
            `${path}[${index}]`,
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
          fail(
            CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
            "Canonical JSON array entries must be enumerable data properties",
            `${path}[${index}]`,
          );
        }
        result.push(cloneCanonical(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return Object.freeze(result);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(
        CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
        "Canonical JSON objects must be plain records",
        path,
      );
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      fail(
        CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
        "Canonical JSON objects must not contain symbol keys",
        path,
      );
    }

    const result = {};
    const keys = ownKeys.map(String).sort();
    for (const key of keys) {
      const keyPath = propertyPath(path, key);
      assertUnicodeScalarString(key, keyPath);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        fail(
          CANONICAL_JSON_ISSUE_CODES.INVALID_VALUE,
          "Canonical JSON object fields must be enumerable data properties",
          keyPath,
        );
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: cloneCanonical(descriptor.value, keyPath, ancestors),
        writable: true,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Return a deeply frozen semantic JSON clone. Arrays retain their declared order and
 * the source value is never modified; canonical key order is applied during emission.
 */
export function canonicalizeJson(value) {
  return cloneCanonical(value, "$", new Set());
}

function emitCanonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => emitCanonicalJson(entry)).join(",")}]`;
  }
  const fields = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${emitCanonicalJson(value[key])}`);
  return `{${fields.join(",")}}`;
}

/** Serialize one JSON value with recursively UTF-16-sorted object keys and no whitespace. */
export function canonicalJsonStringify(value) {
  return emitCanonicalJson(canonicalizeJson(value));
}

/** Return canonical UTF-8 bytes without a trailing newline. */
export function serializeCanonicalJson(value) {
  return Buffer.from(canonicalJsonStringify(value), "utf8");
}

/** Return canonical UTF-8 bytes followed by exactly one LF for checked-in JSON files. */
export function serializeCanonicalJsonLine(value) {
  return Buffer.from(`${canonicalJsonStringify(value)}\n`, "utf8");
}

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

function textFromInput(input) {
  if (typeof input === "string") return input;
  if (ArrayBuffer.isView(input)) {
    try {
      return STRICT_UTF8_DECODER.decode(
        new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
      );
    } catch {
      fail(
        CANONICAL_JSON_ISSUE_CODES.INVALID_TEXT,
        "JSON input contains malformed UTF-8 bytes",
        "$",
      );
    }
  }
  fail(
    CANONICAL_JSON_ISSUE_CODES.INVALID_TEXT,
    "JSON input must be a UTF-8 string or byte view",
    "$",
  );
}

/**
 * Parse JSON and return its canonical frozen representation. When requireCanonical is
 * true, the supplied bytes must already equal canonical serialization (optionally with
 * one trailing LF).
 */
export function parseCanonicalJson(
  input,
  { allowTrailingNewline = false, requireCanonical = false } = {},
) {
  const text = textFromInput(input);
  if (text.charCodeAt(0) === 0xfeff) {
    fail(
      CANONICAL_JSON_ISSUE_CODES.INVALID_TEXT,
      "JSON input must not contain a byte-order mark",
      "$",
    );
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(
      CANONICAL_JSON_ISSUE_CODES.INVALID_TEXT,
      "JSON input is malformed",
      "$",
    );
  }

  const canonical = canonicalizeJson(value);
  if (requireCanonical) {
    const serialized = emitCanonicalJson(canonical);
    const accepted = text === serialized
      || (allowTrailingNewline && text === `${serialized}\n`);
    if (!accepted) {
      fail(
        CANONICAL_JSON_ISSUE_CODES.NON_CANONICAL,
        "JSON input is valid but not in canonical byte form",
        "$",
      );
    }
  }
  return canonical;
}

export const canonicalStringify = canonicalJsonStringify;
export const canonicalJsonBytes = serializeCanonicalJson;
export const canonicalJsonLineBytes = serializeCanonicalJsonLine;
