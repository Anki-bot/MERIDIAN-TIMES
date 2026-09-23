type MediaState = {
  width: number;
  reducedMotion: boolean;
};

type ControlledQuery = {
  readonly mediaQuery: MediaQueryList;
  readonly listenerCount: () => number;
  readonly update: () => void;
};

export interface MatchMediaController {
  readonly setReducedMotion: (reducedMotion: boolean) => void;
  readonly setViewportWidth: (width: number) => void;
  readonly listenerCount: () => number;
  readonly restore: () => void;
}

function queryMatches(query: string, state: MediaState): boolean {
  const maxWidths = Array.from(
    query.matchAll(/\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/gi),
    (match) => Number(match[1]),
  );
  const minWidths = Array.from(
    query.matchAll(/\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/gi),
    (match) => Number(match[1]),
  );

  if (maxWidths.some((width) => state.width > width)) return false;
  if (minWidths.some((width) => state.width < width)) return false;
  if (/\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(query)) {
    return state.reducedMotion;
  }
  if (/\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/i.test(query)) {
    return !state.reducedMotion;
  }
  return true;
}

function createControlledQuery(query: string, state: MediaState): ControlledQuery {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const legacyListeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = queryMatches(query, state);

  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (type === "change" && listener) listeners.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (type === "change" && listener) listeners.delete(listener);
    },
    addListener(listener: (event: MediaQueryListEvent) => void) {
      legacyListeners.add(listener);
    },
    removeListener(listener: (event: MediaQueryListEvent) => void) {
      legacyListeners.delete(listener);
    },
    dispatchEvent(event: Event) {
      for (const listener of listeners) {
        if (typeof listener === "function") listener.call(mediaQuery, event);
        else listener.handleEvent(event);
      }
      return !event.defaultPrevented;
    },
  } as unknown as MediaQueryList;

  return {
    mediaQuery,
    listenerCount: () => listeners.size + legacyListeners.size + (mediaQuery.onchange ? 1 : 0),
    update: () => {
      const nextMatches = queryMatches(query, state);
      if (nextMatches === matches) return;
      matches = nextMatches;
      const event = new Event("change") as MediaQueryListEvent;
      Object.defineProperties(event, {
        matches: { value: matches },
        media: { value: query },
      });
      mediaQuery.onchange?.call(mediaQuery, event);
      mediaQuery.dispatchEvent(event);
      for (const listener of legacyListeners) listener.call(mediaQuery, event);
    },
  };
}

export function installMatchMedia({
  width = 1024,
  reducedMotion = false,
}: Partial<MediaState> = {}): MatchMediaController {
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
  const state: MediaState = { width, reducedMotion };
  const queries = new Map<string, ControlledQuery>();
  let restored = false;

  const matchMedia = (query: string): MediaQueryList => {
    let controlledQuery = queries.get(query);
    if (!controlledQuery) {
      controlledQuery = createControlledQuery(query, state);
      queries.set(query, controlledQuery);
    }
    return controlledQuery.mediaQuery;
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: matchMedia,
  });

  function updateQueries() {
    for (const query of queries.values()) query.update();
  }

  return {
    setReducedMotion(nextReducedMotion) {
      state.reducedMotion = nextReducedMotion;
      updateQueries();
    },
    setViewportWidth(nextWidth) {
      state.width = nextWidth;
      updateQueries();
    },
    listenerCount: () => Array.from(queries.values()).reduce(
      (count, query) => count + query.listenerCount(),
      0,
    ),
    restore() {
      if (restored) return;
      restored = true;
      const leakedListeners = Array.from(queries.values()).reduce(
        (count, query) => count + query.listenerCount(),
        0,
      );
      if (originalDescriptor) {
        Object.defineProperty(window, "matchMedia", originalDescriptor);
      }
      if (leakedListeners > 0) {
        throw new Error(`matchMedia test double leaked ${leakedListeners} listener(s)`);
      }
    },
  };
}
