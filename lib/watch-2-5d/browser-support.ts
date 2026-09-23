import type { BrowserSupportResult, SupportCode } from "./types";

export const SUPPORTED_BROWSER_FAMILIES = [
  "chrome",
  "edge",
  "firefox",
  "safari",
  "ios-safari",
  "android-chrome",
] as const;
export type SupportedBrowserFamily = (typeof SUPPORTED_BROWSER_FAMILIES)[number];

export interface BrowserVersion {
  readonly text: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly build: number;
}

export interface ClassifiedBrowser {
  readonly family: SupportedBrowserFamily;
  readonly version: BrowserVersion;
}

export type BrowserMatrixResult =
  | { readonly supported: true; readonly browser: ClassifiedBrowser }
  | { readonly supported: false; readonly code: "browser-unknown" }
  | {
      readonly supported: false;
      readonly code: "browser-version-unsupported";
      readonly browser: ClassifiedBrowser;
    };

/** Browser globals are deliberately injectable so classification remains pure and testable. */
export interface BrowserSupportEnvironment {
  readonly userAgent?: unknown;
  readonly fetch?: unknown;
  readonly AbortController?: unknown;
  readonly crypto?: unknown;
  readonly HTMLImageElement?: unknown;
  readonly requestAnimationFrame?: unknown;
  readonly cancelAnimationFrame?: unknown;
  readonly ResizeObserver?: unknown;
  readonly matchMedia?: unknown;
  readonly document?: unknown;
  readonly CSS?: unknown;
}

export type BrowserGatedLoaderResult<T> =
  | { readonly supported: false; readonly code: SupportCode }
  | { readonly supported: true; readonly value: T };

export const BROWSER_VERSION_FLOORS = Object.freeze({
  chrome: Object.freeze({ major: 120, minor: 0 }),
  edge: Object.freeze({ major: 120, minor: 0 }),
  firefox: Object.freeze({ major: 121, minor: 0 }),
  safari: Object.freeze({ major: 17, minor: 2 }),
  "ios-safari": Object.freeze({ major: 17, minor: 2 }),
  "android-chrome": Object.freeze({ major: 120, minor: 0 }),
} satisfies Readonly<Record<SupportedBrowserFamily, Readonly<{
  major: number;
  minor: number;
}>>>);

const UNKNOWN_BROWSER_RESULT = Object.freeze({
  code: "browser-unknown",
  supported: false,
} as const);
const SUPPORTED_RESULT = Object.freeze({ supported: true } as const);
const MAX_USER_AGENT_LENGTH = 2_048;
const MAX_VERSION_COMPONENT = 999_999;
const IOS_DEVICE_PATTERN = /\((?:iPad|iPhone|iPod)(?:;|\))/u;
const ANDROID_PATTERN = /(?:^|[ (;])Android(?:[ \d;)]|$)/u;
const DESKTOP_PLATFORM_PATTERN = /\((?:CrOS |Macintosh;|Windows NT|X11;)/u;
const REJECTED_BROWSER_TOKENS = [
  "Brave",
  "Chromium",
  "CriOS",
  "Ddg",
  "DuckDuckGo",
  "EdgA",
  "EdgiOS",
  "Electron",
  "FxiOS",
  "GSA",
  "HeadlessChrome",
  "OPR",
  "OPiOS",
  "OPT",
  "Opera",
  "PaleMoon",
  "SamsungBrowser",
  "SeaMonkey",
  "UCBrowser",
  "Vivaldi",
  "Waterfox",
  "YaBrowser",
] as const;

type ObjectLike = object | ((...args: never[]) => unknown);

function isObjectLike(value: unknown): value is ObjectLike {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function safeProperty(value: unknown, property: PropertyKey): unknown {
  if (!isObjectLike(value)) return undefined;
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasToken(userAgent: string, token: string): boolean {
  return new RegExp(`(?:^|[\\s;(])${escapeRegExp(token)}\\/`, "u").test(userAgent);
}

function singleTokenValue(userAgent: string, token: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|[\\s;(])${escapeRegExp(token)}\\/([^\\s;)]+)(?=$|[\\s;)])`,
    "gu",
  );
  const matches = [...userAgent.matchAll(pattern)];
  return matches.length === 1 ? matches[0][1] : undefined;
}

function singleRvValue(userAgent: string): string | undefined {
  const matches = [
    ...userAgent.matchAll(/(?:^|[\s;(])rv:([^\s;)]+)(?=$|[\s;)])/gu),
  ];
  return matches.length === 1 ? matches[0][1] : undefined;
}

function parseDottedVersion(
  value: string | undefined,
  minimumComponents: number,
  maximumComponents: number,
): BrowserVersion | undefined {
  if (value === undefined || value.length === 0 || value.length > 48) return undefined;
  const parts = value.split(".");
  if (parts.length < minimumComponents || parts.length > maximumComponents) return undefined;

  const components: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d*)$/u.test(part)) return undefined;
    const component = Number(part);
    if (!Number.isSafeInteger(component) || component > MAX_VERSION_COMPONENT) return undefined;
    components.push(component);
  }

  return Object.freeze({
    build: components[3] ?? 0,
    major: components[0],
    minor: components[1] ?? 0,
    patch: components[2] ?? 0,
    text: value,
  });
}

function parseIosSystemVersion(userAgent: string): BrowserVersion | undefined {
  const matches = [
    ...userAgent.matchAll(
      /(?:CPU (?:iPhone )?OS|iPhone OS) ((?:0|[1-9]\d*)(?:_(?:0|[1-9]\d*)){1,2}) like Mac OS X/gu,
    ),
  ];
  if (matches.length !== 1) return undefined;
  return parseDottedVersion(matches[0][1].replaceAll("_", "."), 2, 3);
}

function sameMajorMinor(left: BrowserVersion, right: BrowserVersion): boolean {
  return left.major === right.major && left.minor === right.minor;
}

function hasChromiumEngineShape(userAgent: string): boolean {
  return userAgent.includes("(KHTML, like Gecko)")
    && parseDottedVersion(singleTokenValue(userAgent, "AppleWebKit"), 2, 4) !== undefined
    && parseDottedVersion(singleTokenValue(userAgent, "Safari"), 2, 4) !== undefined;
}

function atOrAboveFloor(
  family: SupportedBrowserFamily,
  version: BrowserVersion,
): boolean {
  const floor = BROWSER_VERSION_FLOORS[family];
  return version.major > floor.major
    || (version.major === floor.major && version.minor >= floor.minor);
}

function finishBrowser(
  family: SupportedBrowserFamily,
  version: BrowserVersion,
): BrowserMatrixResult {
  const browser = Object.freeze({ family, version });
  if (!atOrAboveFloor(family, version)) {
    return Object.freeze({
      browser,
      code: "browser-version-unsupported",
      supported: false,
    });
  }
  return Object.freeze({ browser, supported: true });
}

function classifyEdge(userAgent: string): BrowserMatrixResult {
  if (
    !DESKTOP_PLATFORM_PATTERN.test(userAgent)
    || ANDROID_PATTERN.test(userAgent)
    || IOS_DEVICE_PATTERN.test(userAgent)
    || hasToken(userAgent, "Mobile")
    || hasToken(userAgent, "Firefox")
    || hasToken(userAgent, "Version")
    || !hasChromiumEngineShape(userAgent)
  ) {
    return UNKNOWN_BROWSER_RESULT;
  }
  const chrome = parseDottedVersion(singleTokenValue(userAgent, "Chrome"), 4, 4);
  const edge = parseDottedVersion(singleTokenValue(userAgent, "Edg"), 4, 4);
  if (chrome === undefined || edge === undefined || chrome.major !== edge.major) {
    return UNKNOWN_BROWSER_RESULT;
  }
  return finishBrowser("edge", edge);
}

function classifyChrome(userAgent: string): BrowserMatrixResult {
  if (
    hasToken(userAgent, "Firefox")
    || hasToken(userAgent, "Version")
    || hasToken(userAgent, "Edg")
    || IOS_DEVICE_PATTERN.test(userAgent)
    || !hasChromiumEngineShape(userAgent)
  ) {
    return UNKNOWN_BROWSER_RESULT;
  }
  const chrome = parseDottedVersion(singleTokenValue(userAgent, "Chrome"), 4, 4);
  if (chrome === undefined) return UNKNOWN_BROWSER_RESULT;

  if (ANDROID_PATTERN.test(userAgent)) {
    if (/(?:^|[ ;])wv(?:[ ;)])/u.test(userAgent)) return UNKNOWN_BROWSER_RESULT;
    return finishBrowser("android-chrome", chrome);
  }
  if (!DESKTOP_PLATFORM_PATTERN.test(userAgent) || hasToken(userAgent, "Mobile")) {
    return UNKNOWN_BROWSER_RESULT;
  }
  return finishBrowser("chrome", chrome);
}

function classifyFirefox(userAgent: string): BrowserMatrixResult {
  if (
    !DESKTOP_PLATFORM_PATTERN.test(userAgent)
    || ANDROID_PATTERN.test(userAgent)
    || IOS_DEVICE_PATTERN.test(userAgent)
    || hasToken(userAgent, "Mobile")
    || hasToken(userAgent, "Chrome")
    || hasToken(userAgent, "Edg")
    || hasToken(userAgent, "Safari")
    || hasToken(userAgent, "Version")
    || singleTokenValue(userAgent, "Gecko") !== "20100101"
  ) {
    return UNKNOWN_BROWSER_RESULT;
  }
  const firefox = parseDottedVersion(singleTokenValue(userAgent, "Firefox"), 2, 3);
  const revision = parseDottedVersion(singleRvValue(userAgent), 2, 3);
  if (firefox === undefined || revision === undefined || !sameMajorMinor(firefox, revision)) {
    return UNKNOWN_BROWSER_RESULT;
  }
  return finishBrowser("firefox", firefox);
}

function classifySafari(userAgent: string): BrowserMatrixResult {
  if (
    hasToken(userAgent, "Chrome")
    || hasToken(userAgent, "Edg")
    || hasToken(userAgent, "Firefox")
    || !hasChromiumEngineShape(userAgent)
  ) {
    return UNKNOWN_BROWSER_RESULT;
  }
  const safari = parseDottedVersion(singleTokenValue(userAgent, "Version"), 2, 3);
  if (safari === undefined) return UNKNOWN_BROWSER_RESULT;

  if (IOS_DEVICE_PATTERN.test(userAgent)) {
    const ios = parseIosSystemVersion(userAgent);
    if (
      ios === undefined
      || !sameMajorMinor(safari, ios)
      || !hasToken(userAgent, "Mobile")
    ) {
      return UNKNOWN_BROWSER_RESULT;
    }
    return finishBrowser("ios-safari", safari);
  }
  if (
    hasToken(userAgent, "Mobile")
    || ANDROID_PATTERN.test(userAgent)
    || !/\(Macintosh;\s+Intel Mac OS X /u.test(userAgent)
  ) {
    return UNKNOWN_BROWSER_RESULT;
  }
  return finishBrowser("safari", safari);
}

/** Classifies only explicit, well-formed members of the approved browser matrix. */
export function classifyBrowserUserAgent(userAgent: unknown): BrowserMatrixResult {
  if (
    typeof userAgent !== "string"
    || userAgent.length === 0
    || userAgent.length > MAX_USER_AGENT_LENGTH
    || userAgent.trim() !== userAgent
    || !/^[\x20-\x7e]+$/u.test(userAgent)
    || !userAgent.startsWith("Mozilla/5.0 (")
    || REJECTED_BROWSER_TOKENS.some((token) => hasToken(userAgent, token))
  ) {
    return UNKNOWN_BROWSER_RESULT;
  }

  if (hasToken(userAgent, "Edg")) return classifyEdge(userAgent);
  if (hasToken(userAgent, "Firefox")) return classifyFirefox(userAgent);
  if (hasToken(userAgent, "Chrome")) return classifyChrome(userAgent);
  if (hasToken(userAgent, "Version") && hasToken(userAgent, "Safari")) {
    return classifySafari(userAgent);
  }
  return UNKNOWN_BROWSER_RESULT;
}

function unsupported(code: SupportCode): BrowserSupportResult {
  return Object.freeze({ code, supported: false });
}

function currentBrowserEnvironment(): BrowserSupportEnvironment {
  const scope: unknown = globalThis;
  const navigatorValue = safeProperty(scope, "navigator");
  return Object.freeze({
    AbortController: safeProperty(scope, "AbortController"),
    CSS: safeProperty(scope, "CSS"),
    HTMLImageElement: safeProperty(scope, "HTMLImageElement"),
    ResizeObserver: safeProperty(scope, "ResizeObserver"),
    cancelAnimationFrame: safeProperty(scope, "cancelAnimationFrame"),
    crypto: safeProperty(scope, "crypto"),
    document: safeProperty(scope, "document"),
    fetch: safeProperty(scope, "fetch"),
    matchMedia: safeProperty(scope, "matchMedia"),
    requestAnimationFrame: safeProperty(scope, "requestAnimationFrame"),
    userAgent: safeProperty(navigatorValue, "userAgent"),
  });
}

function supportsCss(cssValue: unknown, property: string, value: string): boolean {
  const supports = safeProperty(cssValue, "supports");
  if (!isFunction(supports)) return false;
  try {
    return Reflect.apply(supports, cssValue, [property, value]) === true;
  } catch {
    return false;
  }
}

function hasPageVisibility(documentValue: unknown): boolean {
  return typeof safeProperty(documentValue, "visibilityState") === "string"
    && typeof safeProperty(documentValue, "hidden") === "boolean"
    && isFunction(safeProperty(documentValue, "addEventListener"))
    && isFunction(safeProperty(documentValue, "removeEventListener"));
}

/**
 * Checks the browser matrix before capabilities, then capabilities in SupportCode order.
 * This function performs no fetch, decode, observer construction, or animation request.
 */
export function classifyBrowserSupport(
  environment: BrowserSupportEnvironment = currentBrowserEnvironment(),
): BrowserSupportResult {
  const browser = classifyBrowserUserAgent(safeProperty(environment, "userAgent"));
  if (!browser.supported) return unsupported(browser.code);

  if (!isFunction(safeProperty(environment, "fetch"))) {
    return unsupported("fetch-unavailable");
  }
  if (!isFunction(safeProperty(environment, "AbortController"))) {
    return unsupported("abort-controller-unavailable");
  }

  const cryptoValue = safeProperty(environment, "crypto");
  const subtleValue = safeProperty(cryptoValue, "subtle");
  if (!isFunction(safeProperty(subtleValue, "digest"))) {
    return unsupported("crypto-digest-unavailable");
  }

  const imageConstructor = safeProperty(environment, "HTMLImageElement");
  if (!isFunction(safeProperty(safeProperty(imageConstructor, "prototype"), "decode"))) {
    return unsupported("image-decode-unavailable");
  }
  if (
    !isFunction(safeProperty(environment, "requestAnimationFrame"))
    || !isFunction(safeProperty(environment, "cancelAnimationFrame"))
  ) {
    return unsupported("animation-frame-unavailable");
  }
  if (!isFunction(safeProperty(environment, "ResizeObserver"))) {
    return unsupported("resize-observer-unavailable");
  }
  if (!isFunction(safeProperty(environment, "matchMedia"))) {
    return unsupported("media-query-unavailable");
  }
  if (!hasPageVisibility(safeProperty(environment, "document"))) {
    return unsupported("page-visibility-unavailable");
  }

  const cssValue = safeProperty(environment, "CSS");
  if (!supportsCss(cssValue, "transform", "translate(0px, 0px)")) {
    return unsupported("css-transform-unavailable");
  }
  if (!supportsCss(cssValue, "--watch-layer-support", "0")) {
    return unsupported("css-custom-properties-unavailable");
  }
  return SUPPORTED_RESULT;
}

/** Invokes the successor loader exactly once only after the complete support gate passes. */
export function runSuccessorLoaderIfSupported<T>(
  loader: () => T,
  environment?: BrowserSupportEnvironment,
): BrowserGatedLoaderResult<T> {
  const support = classifyBrowserSupport(environment);
  if (!support.supported) return support;
  return Object.freeze({ supported: true, value: loader() });
}
