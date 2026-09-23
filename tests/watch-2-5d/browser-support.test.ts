import { describe, expect, it, vi } from "vitest";
import {
  classifyBrowserSupport,
  classifyBrowserUserAgent,
  runSuccessorLoaderIfSupported,
  type BrowserSupportEnvironment,
  type SupportedBrowserFamily,
} from "@/lib/watch-2-5d/browser-support";
import type { SupportCode } from "@/lib/watch-2-5d/types";

function chrome(version: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function edge(version: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`;
}

function firefox(version: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${version}) Gecko/20100101 Firefox/${version}`;
}

function safari(version: string): string {
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;
}

function iosSafari(version: string): string {
  const systemVersion = version.replaceAll(".", "_");
  return `Mozilla/5.0 (iPhone; CPU iPhone OS ${systemVersion} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`;
}

function androidChrome(version: string): string {
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`;
}

function supportedEnvironment(userAgent = chrome("120.0.0.0")): BrowserSupportEnvironment {
  class DecodableImageElement {}
  Object.defineProperty(DecodableImageElement.prototype, "decode", {
    value: () => Promise.resolve(),
  });

  return {
    AbortController: class AbortControllerStub {},
    CSS: {
      supports: (property: string) => property === "transform"
        || property === "--watch-layer-support",
    },
    HTMLImageElement: DecodableImageElement,
    ResizeObserver: class ResizeObserverStub {},
    cancelAnimationFrame: () => undefined,
    crypto: { subtle: { digest: () => Promise.resolve(new ArrayBuffer(32)) } },
    document: {
      addEventListener: () => undefined,
      hidden: false,
      removeEventListener: () => undefined,
      visibilityState: "visible",
    },
    fetch: () => Promise.resolve(),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1,
    userAgent,
  };
}

type CapabilityCase = readonly [
  name: string,
  code: SupportCode,
  mutate: (environment: BrowserSupportEnvironment) => BrowserSupportEnvironment,
];

const CAPABILITY_CASES: readonly CapabilityCase[] = [
  ["fetch", "fetch-unavailable", (environment) => ({ ...environment, fetch: undefined })],
  [
    "AbortController",
    "abort-controller-unavailable",
    (environment) => ({ ...environment, AbortController: undefined }),
  ],
  [
    "crypto.subtle.digest",
    "crypto-digest-unavailable",
    (environment) => ({ ...environment, crypto: { subtle: {} } }),
  ],
  [
    "HTMLImageElement.decode",
    "image-decode-unavailable",
    (environment) => ({ ...environment, HTMLImageElement: class ImageWithoutDecode {} }),
  ],
  [
    "requestAnimationFrame",
    "animation-frame-unavailable",
    (environment) => ({ ...environment, requestAnimationFrame: undefined }),
  ],
  [
    "cancelAnimationFrame",
    "animation-frame-unavailable",
    (environment) => ({ ...environment, cancelAnimationFrame: undefined }),
  ],
  [
    "ResizeObserver",
    "resize-observer-unavailable",
    (environment) => ({ ...environment, ResizeObserver: undefined }),
  ],
  [
    "matchMedia",
    "media-query-unavailable",
    (environment) => ({ ...environment, matchMedia: undefined }),
  ],
  [
    "Page Visibility",
    "page-visibility-unavailable",
    (environment) => ({
      ...environment,
      document: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    }),
  ],
  [
    "CSS transforms",
    "css-transform-unavailable",
    (environment) => ({
      ...environment,
      CSS: { supports: (property: string) => property === "--watch-layer-support" },
    }),
  ],
  [
    "CSS custom properties",
    "css-custom-properties-unavailable",
    (environment) => ({
      ...environment,
      CSS: { supports: (property: string) => property === "transform" },
    }),
  ],
];

// **Validates: Requirements 10.13, 10.14, 12.14, 12.15, 12.17**
describe("conservative browser support classification", () => {
  it.each([
    ["Chrome below floor", chrome("119.0.0.0"), false, "browser-version-unsupported"],
    ["Chrome at floor", chrome("120.0.0.0"), true, "chrome"],
    ["Edge below floor", edge("119.0.0.0"), false, "browser-version-unsupported"],
    ["Edge at floor", edge("120.0.0.0"), true, "edge"],
    ["Firefox below floor", firefox("120.0"), false, "browser-version-unsupported"],
    ["Firefox at floor", firefox("121.0"), true, "firefox"],
    ["Safari below floor", safari("17.1"), false, "browser-version-unsupported"],
    ["Safari at floor", safari("17.2"), true, "safari"],
    ["iOS Safari below floor", iosSafari("17.1"), false, "browser-version-unsupported"],
    ["iOS Safari at floor", iosSafari("17.2"), true, "ios-safari"],
    [
      "Android Chrome below floor",
      androidChrome("119.0.0.0"),
      false,
      "browser-version-unsupported",
    ],
    ["Android Chrome at floor", androidChrome("120.0.0.0"), true, "android-chrome"],
    ["Safari compares minor components numerically", safari("17.10"), true, "safari"],
  ] as const)("classifies the fixed $0 boundary", (_name, userAgent, supported, detail) => {
    const result = classifyBrowserUserAgent(userAgent);
    expect(result.supported).toBe(supported);
    if (supported) {
      if (!result.supported) throw new Error(`Expected supported ${detail}`);
      expect(result.browser.family).toBe(detail as SupportedBrowserFamily);
    } else {
      if (result.supported) throw new Error("Expected an unsupported boundary result");
      expect(result.code).toBe(detail);
    }
  });

  it.each([
    [
      "Chrome on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    ],
    [
      "Firefox on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
    ],
    [
      "Edge on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0 Mobile/15E148 Safari/605.1.15",
    ],
    [
      "Opera on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/2.2.0 Mobile/15E148 Safari/9537.53",
    ],
  ] as const)("rejects alternative iOS token: $0", (_name, userAgent) => {
    expect(classifyBrowserUserAgent(userAgent)).toEqual({
      code: "browser-unknown",
      supported: false,
    });
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", ` ${chrome("120.0.0.0")}`],
    ["unknown browser", "Mozilla/5.0 (compatible; ExampleBrowser/120.0)"],
    ["short Chrome version", chrome("120.0")],
    ["duplicate Chrome token", `${chrome("120.0.0.0")} Chrome/120.0.0.0`],
    [
      "conflicting Chromium and Firefox tokens",
      `${chrome("120.0.0.0")} Gecko/20100101 Firefox/121.0`,
    ],
    [
      "mismatched iOS and Safari versions",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    ],
    [
      "Android WebView",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
    ],
    [
      "headless Chromium",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    ],
  ] as const)("fails closed for malformed or unknown UA: $0", (_name, userAgent) => {
    expect(classifyBrowserUserAgent(userAgent)).toEqual({
      code: "browser-unknown",
      supported: false,
    });
  });

  it.each(CAPABILITY_CASES)(
    "returns the deterministic support code when $name is unavailable",
    (_name, code, mutate) => {
      expect(classifyBrowserSupport(mutate(supportedEnvironment()))).toEqual({
        code,
        supported: false,
      });
    },
  );

  it("requires both animation-frame functions and handles CSS.supports exceptions", () => {
    expect(classifyBrowserSupport({
      ...supportedEnvironment(),
      CSS: { supports: () => { throw new Error("unsupported"); } },
    })).toEqual({ code: "css-transform-unavailable", supported: false });

    expect(classifyBrowserSupport({
      ...supportedEnvironment(),
      cancelAnimationFrame: undefined,
      requestAnimationFrame: undefined,
    })).toEqual({ code: "animation-frame-unavailable", supported: false });
  });

  it("checks browser validity before capability precedence and is repeatable", () => {
    const missingEverything: BrowserSupportEnvironment = {
      userAgent: "not a browser",
    };
    const first = classifyBrowserSupport(missingEverything);
    const second = classifyBrowserSupport(missingEverything);
    expect(first).toEqual({ code: "browser-unknown", supported: false });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);

    expect(classifyBrowserSupport({ userAgent: chrome("119.0.0.0") })).toEqual({
      code: "browser-version-unsupported",
      supported: false,
    });
    expect(classifyBrowserSupport({ userAgent: chrome("120.0.0.0") })).toEqual({
      code: "fetch-unavailable",
      supported: false,
    });
  });

  it("accepts each approved browser only when all required capabilities exist", () => {
    for (const userAgent of [
      chrome("120.0.0.0"),
      edge("120.0.0.0"),
      firefox("121.0"),
      safari("17.2"),
      iosSafari("17.2"),
      androidChrome("120.0.0.0"),
    ]) {
      expect(classifyBrowserSupport(supportedEnvironment(userAgent))).toEqual({
        supported: true,
      });
    }
  });

  it("never invokes the successor loader for any unsupported browser or capability", () => {
    const unsupportedEnvironments: BrowserSupportEnvironment[] = [
      { userAgent: "unknown" },
      { userAgent: chrome("119.0.0.0") },
      ...CAPABILITY_CASES.map(([, , mutate]) => mutate(supportedEnvironment())),
    ];

    for (const environment of unsupportedEnvironments) {
      const loader = vi.fn(() => "should-not-load");
      const result = runSuccessorLoaderIfSupported(loader, environment);
      expect(result.supported).toBe(false);
      expect(loader).not.toHaveBeenCalled();
    }
  });

  it("invokes the successor loader once only after the complete gate passes", () => {
    const prepared = Object.freeze({ id: "prepared-profile" });
    const loader = vi.fn(() => prepared);
    const result = runSuccessorLoaderIfSupported(loader, supportedEnvironment());

    expect(result).toEqual({ supported: true, value: prepared });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
