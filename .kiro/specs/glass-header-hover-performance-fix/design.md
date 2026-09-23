# Glass Header and Hover Performance Bugfix Design

## Overview

This design removes two independent sources of unnecessary rendering work while preserving the ELITE WATCHES presentation and interaction contracts. The masthead becomes a static, genuinely translucent dark-neutral surface with no backdrop sampling. The atlas graph mounts exactly one responsive SVG, presents active rays as plain native SVG paths, and runs at most one native SMIL particle per active edge.

The implementation is deliberately narrow:

- `app/globals.css` owns the masthead material and graph paint-cost reductions.
- `components/ui/NodeGraph.tsx` owns responsive SVG selection and active-edge markup.
- `tests/` and `scripts/atlas-visibility-smoke.mjs` own deterministic source, DOM, hydration, interaction, and finite browser-performance checks.
- `components/canvas/WatchMovementCanvas.tsx`, watch geometry/content, camera behavior, and static fallback logic remain unchanged when the scoped fix passes the browser gate.
- No production dependency, worker, canvas copy, animation loop, or new application state is introduced.

The implementation order is bugfix-oriented: first record deterministic counterexamples on the unfixed code, then record passing preservation behavior, apply the scoped changes, and finally run the same checks plus the warmed browser measurement.

## Glossary

- **Bug_Condition (C)**: A default masthead render or active atlas interaction for which the current implementation exceeds the static-surface or graph-effect budgets.
- **Header_Bug_Condition (C_H)**: The default `.site-masthead` uses a background stop above 0.22 alpha or applies standard/prefixed backdrop filtering.
- **Graph_Bug_Condition (C_G)**: A graph render that mounts more than one responsive SVG, or an active state that creates more than one traveling particle per edge or uses framework-driven paths, SVG Gaussian blur, or particle drop shadows.
- **Performance_Bug_Condition (C_P)**: A warmed 12-edge interaction misses the response, hit-testing, error, longest-task, or cumulative-blocking limits.
- **Property (P)**: The complete expected output predicate returned by `expectedBehavior` for inputs satisfying `C`.
- **Preservation**: Equality of user-observable behavior between the unfixed function/rendering pipeline `F` and fixed pipeline `F'` outside the intentionally replaced material and effect mechanisms.
- **GraphPaths**: The private renderer in `components/ui/NodeGraph.tsx` that creates one responsive SVG containing resting and active relationships.
- **Active_Edge_Count (N)**: The number of edges returned by `buildGraphEdges` for the current audience, selection, or preview state.
- **Responsive_Graph_Variant**: Either the desktop coordinate set for widths above 700 CSS pixels or the mobile coordinate set for widths at or below 700 CSS pixels.
- **Hydration_Snapshot**: The stable desktop (`false`) server snapshot used by `useSyncExternalStore` so server markup and the first hydration render match.
- **Traveling_Particle**: One SVG `<circle>` with one native `<animateMotion>` child and an `<mpath>` reference to its edge path.
- **Visual_Response_Latency**: Time on the page performance clock from the dispatched pointer event timestamp to the first animation frame at which all expected paths and particles satisfy the visible-state predicate.
- **Long_Task**: A browser-reported main-thread task longer than the 50-millisecond long-task boundary.
- **Cumulative_Blocking_Time**: For one measured interaction, `sum(max(0, task.duration - 50ms))` over long tasks that overlap that interaction window.
- **Reference_Browser**: The locally available supported Chrome or Chromium used by the existing finite protocol-based atlas smoke at 1024×576 CSS pixels and device-pixel ratio 1.

## Bug Details

### Bug Condition

The defect is the union `C = C_H ∪ C_G ∪ C_P`:

- `C_H` contains default masthead renders whose authored gradient has a stop alpha above 0.22 or whose computed/source style applies `backdrop-filter` or `-webkit-backdrop-filter`.
- `C_G` contains graph renders with duplicated responsive SVGs and active interactions whose mounted/effect work is not bounded by the active edge count.
- `C_P` contains warmed dense interactions that violate any clause 2.6 browser threshold.

The responsive width, motion preference, render mode, and interaction state are inputs. Mounted element counts, authored effects, visibility, and performance entries are observations from `F` or `F'`.

**Formal Specification:**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type RenderObservation
  OUTPUT: boolean

  headerBug :=
    X.headerMode = DEFAULT
    AND (
      X.headerMaximumGradientStopAlpha > 0.22
      OR X.mastheadHasStandardBackdropFilter
      OR X.mastheadHasPrefixedBackdropFilter
    )

  graphBug :=
    X.mountedResponsiveGraphCount != 1
    OR (
      X.activeEdgeCount > 0
      AND (
        X.mountedActiveEdgeCount != X.activeEdgeCount
        OR (NOT X.reducedMotion AND X.travelingParticleCount != X.activeEdgeCount)
        OR (X.reducedMotion AND X.travelingParticleCount != 0)
        OR X.hasFrameworkAnimatedActivePath
        OR X.hasSvgGaussianBlur
        OR X.hasParticleDropShadow
      )
    )

  performanceBug :=
    X.isWarmedDenseFan
    AND (
      X.visualResponseLatencyMs > 100
      OR NOT X.allControlsHitTestable
      OR X.runtimeOrConsoleErrorCount > 0
      OR X.longestMainThreadTaskMs > 100
      OR X.cumulativeBlockingTimeMs > 100
    )

  RETURN headerBug OR graphBug OR performanceBug
END FUNCTION

FUNCTION expectedBehavior(result)
  INPUT: result of type RenderObservation
  OUTPUT: boolean

  headerCorrect :=
    result.headerMode != DEFAULT
    OR (
      result.headerMaximumGradientStopAlpha <= 0.22
      AND NOT result.mastheadHasStandardBackdropFilter
      AND NOT result.mastheadHasPrefixedBackdropFilter
      AND result.headerEdgeWidthCssPx = 1
      AND result.headerMaterialIsStatic
    )

  graphCorrect :=
    result.mountedResponsiveGraphCount = 1
    AND (
      result.activeEdgeCount = 0
      OR (
        result.mountedActiveEdgeCount = result.activeEdgeCount
        AND result.relationshipIds = result.expectedRelationshipIds
        AND NOT result.hasFrameworkAnimatedActivePath
        AND NOT result.hasSvgGaussianBlur
        AND NOT result.hasParticleDropShadow
        AND (
          (result.reducedMotion AND result.travelingParticleCount = 0)
          OR (NOT result.reducedMotion
              AND result.travelingParticleCount = result.activeEdgeCount)
        )
      )
    )

  performanceCorrect :=
    NOT result.isMeasuredDenseFan
    OR (
      result.visualResponseLatencyMs <= 100
      AND result.allControlsHitTestable
      AND result.runtimeOrConsoleErrorCount = 0
      AND result.longestMainThreadTaskMs <= 100
      AND result.cumulativeBlockingTimeMs <= 100
    )

  RETURN headerCorrect AND graphCorrect AND performanceCorrect
END FUNCTION
```

### Concrete Manifestations

1. **Default masthead:** `--header-glass-fallback` is authored at alpha `0.95`, and the supported-filter branch uses alpha `0.70`, so the header reads as a light slab rather than transparent glass.
2. **Animated backdrop:** `.site-masthead` applies both `backdrop-filter: blur(22px) saturate(118%)` and its WebKit-prefixed equivalent, causing the moving watch scene to be sampled continuously.
3. **Dense MEN preview:** Hovering MEN produces `N = 12` relationships. Both desktop and mobile `GraphPaths` trees remain mounted, so the DOM contains 24 active edge groups and 72 particles (`12 edges × 2 variants × 3 particles`).
4. **Brand focus:** Focusing Patek Philippe produces two logical incoming relationships, but both variants and three particles per edge create four active groups and 12 total particles even though only one SVG is visible.
5. **Per-edge paint cost:** Every responsive SVG defines an `feGaussianBlur`/`feMerge` glow, every active ray is a `motion.path`, and every particle uses two CSS drop shadows.
6. **Existing smoke blind spot:** The browser smoke queries only the desktop SVG and therefore reports 36 MEN particles and six Patek particles; it does not expose the equivalent hidden-mobile work.
7. **Boundary example:** At 700 CSS pixels the mobile path geometry must be selected; at 701 CSS pixels desktop geometry must be selected. In either case exactly one SVG may be mounted after hydration.
8. **Reduced-motion example:** A focused brand must retain its two visible incoming rays but mount zero traveling particles.

## Expected Behavior

### Preservation Requirements

**Unchanged header behavior:**

- Keep the existing semantic `<header>`, Primary navigation, Account navigation, labels, destinations, DOM order, accessible names, and one native activation per link.
- Keep the wordmark geometrically centered at 50% of the viewport.
- Keep the 68 CSS pixel height above 700 pixels and 60 CSS pixel height at or below 700 pixels.
- Keep all visible compact links at least 44×44 CSS pixels and keep focus indication unobscured.
- Preserve at least 4.5:1 text contrast and 3:1 focus-indicator contrast using opaque foregrounds and a static crisp contrast halo/ring rather than backdrop blur.
- Preserve forced-colors behavior with `Canvas`, `CanvasText`/`LinkText`, `Highlight`, and a visible one-pixel boundary; transparency is not required in forced-colors mode.
- Keep one crisp one-CSS-pixel divider/highlight and one restrained, static exterior shadow.

**Unchanged graph behavior:**

- Preserve the edge IDs and relationship meaning produced by `buildRestingGraphEdges` and `buildGraphEdges`; no relationship data or curve calculation changes.
- Preserve resting rays, hovered/focused preview fans, selected-audience persistence, selected-term emphasis, gradient family, and clearly visible moving dots when motion is allowed.
- Preserve node coordinates, labels, accessible names, `aria-disabled`/`aria-pressed`, pointer/focus preview behavior, and audience/term activation.
- Preserve zero particle motion under reduced motion while retaining all rays and operable controls.
- Preserve `pointer-events: none` on decorative SVG content and `pointer-events: auto` on the dedicated controls plane.
- Preserve resize state: changing responsive variants may remount only the decorative SVG; `hoveredNodeId`, `focusedNodeId`, active audience, selected term, search, and definition state remain owned by their existing components.

**Unchanged application scope:**

- Keep `WatchMovementCanvas`, watch assets/geometry, camera behavior, WebGL capability handling, and static fallback untouched for the initial implementation and whenever the scoped post-fix measurement passes.
- Keep all files in `.kiro/specs/ai-coding-dictionary-inspired-site/` byte-for-byte unchanged.
- Keep all finite smoke expectations except particle/variant assertions explicitly superseded by the new budgets.

## Hypothesized Root Cause

1. **Material opacity and continuous backdrop sampling**
   - The prior premium-glass implementation deliberately chose a `0.95` fallback and `0.70` enhanced tint to support dark foreground text.
   - Its `@supports` branch applies 22-pixel blur and saturation to a layer above an animated canvas. The visual result is too opaque, and the filter requires repeated compositing while the canvas changes.

2. **CSS visibility is being treated as a workload gate**
   - `NodeGraph` unconditionally renders desktop and mobile `GraphPaths` instances.
   - The media query changes `display`, but hidden SVG SMIL/filter trees remain mounted and can retain animation/effect bookkeeping. CSS visibility therefore does not enforce a one-variant runtime budget.

3. **The active fan multiplies expensive per-edge work**
   - Each active edge uses a Framer Motion path transition, an SVG Gaussian glow, three indefinitely repeating SMIL particles, and two CSS drop shadows.
   - The duplicate responsive trees multiply this cost. The 12-edge dense case reaches 72 particles before accounting for path animations and filters.

4. **Tests count only the visible desktop subtree**
   - Existing unit and browser assertions use `.graph-connections--desktop` selectors, so they validate visual output but not total mounted work.
   - Existing expected counts encode three particles per edge and do not enforce source-level filter/animation budgets.

5. **No finite interaction performance oracle exists**
   - The smoke already controls a production browser and gathers errors/hit-testing evidence, but it has no event-to-frame marker or long-task observer.
   - Arbitrary sleeps or host-side command timing would mix protocol overhead with page work and be flaky; instrumentation must use the page clock and state-driven frame completion.

## Correctness Properties

Property 1: Bug Condition - Static Glass and Bounded Active Graph Effects

_For any_ default masthead render, supported viewport, motion preference, and valid graph interaction where `isBugCondition` returns true, the fixed pipeline SHALL satisfy `expectedBehavior`: the default gradient stops remain at or below 0.22 alpha with no masthead backdrop filter; exactly one responsive SVG owns the expected `N` relationships; native active paths use no Gaussian blur or framework path animation; motion-allowed states contain exactly `N` unfiltered native traveling particles while reduced-motion states contain zero; and each measured warmed dense interaction satisfies every clause 2.6 threshold.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Header, Graph, Accessibility, and Application Contracts

_For any_ input outside the replaced backdrop-sampling and duplicated active-effect mechanisms, the fixed pipeline SHALL produce the same semantic, navigation, graph-relationship, selection, search, definition, and watch-rendering behavior as the original pipeline, while preserving responsive header geometry, contrast/focus/target accessibility, forced colors, resting and reduced-motion graph presentation, hit-testing, historical specification bytes, and all nonsuperseded finite regression expectations.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12**

## Fix Implementation

### 1. Static Transparent Masthead

**File:** `app/globals.css`

Replace the high-opacity fallback/enhanced material tokens with one default static material. The intended values are explicit to make the alpha budget machine-checkable:

```css
:root {
  --header-glass-top: rgba(10, 14, 16, 0.20);
  --header-glass-bottom: rgba(10, 14, 16, 0.12);
  --header-glass-border: rgba(255, 255, 255, 0.38);
  --header-glass-highlight: rgba(255, 255, 255, 0.18);
  --header-glass-shadow: rgba(0, 0, 0, 0.16);
  --header-label: #f8f5ee;
  --header-gold: #ffd990;
  --header-text-halo: #07090a;
  --header-focus: #fff2bd;
}

.site-masthead {
  border-bottom: 1px solid var(--header-glass-border);
  background: linear-gradient(
    180deg,
    var(--header-glass-top) 0%,
    var(--header-glass-bottom) 100%
  );
  box-shadow:
    inset 0 1px 0 var(--header-glass-highlight),
    0 6px 18px var(--header-glass-shadow);
  color: var(--header-label);
}
```

Implementation constraints:

- Both authored gradient-stop alphas are below the inclusive `0.22` ceiling. Do not add another masthead background gradient, pseudo-element, image, noise layer, `color-mix`, or opaque default overlay.
- Remove the masthead `@supports` filter branch entirely. No `.site-masthead` rule, including preference and forced-color branches, may declare either `backdrop-filter` spelling, even with value `none`.
- Remove unused header blur/saturation and high-opacity enhanced/fallback tokens.
- Keep the existing position, z-index, dimensions, padding, and responsive selectors.
- Keep the divider exactly one CSS pixel. Keep the exterior shadow static, at alpha `0.16`, with a bounded 18-pixel blur and no animation/transition/`will-change`.
- Use the opaque light label and gold colors above. Give small labels and the wordmark a crisp one-pixel, zero-blur dark halo (four cardinal `text-shadow` offsets) so foreground contrast remains stable over both dark gears and bright metal without making the whole header opaque.
- Preserve the existing underline interaction. Use a two-tone focus treatment: the existing two-pixel light outline plus a static dark backing ring, each meeting 3:1 against its adjacent color, without reducing the 44×44 target or clipping the outline.
- For `prefers-reduced-transparency: reduce` and `prefers-contrast: more`, a solid dark neutral such as `#101416` may replace the default gradient; this is an explicit accessibility override, not a default gradient stop.
- In `forced-colors: active`, retain a solid `Canvas` background, `CanvasText`/`LinkText`, a `CanvasText` boundary, and `Highlight` focus; remove authored text halos and shadows there. Do not suppress user-agent color adjustment.

Contrast validation uses the exact foreground/halo token pairs and finite browser focus states. If a target fails, adjust the opaque foreground or halo/ring colors—not the gradient above 0.22 and not by restoring backdrop filtering.

### 2. Hydration-Safe Single Responsive Graph

**File:** `components/ui/NodeGraph.tsx`

No project-local media-query hook exists, so use `useSyncExternalStore` directly with module-stable functions and the existing 700-pixel breakpoint:

```typescript
const MOBILE_GRAPH_QUERY = "(max-width: 700px)";

function subscribeToGraphViewport(onStoreChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mediaQuery = window.matchMedia(MOBILE_GRAPH_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getGraphViewportSnapshot(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(MOBILE_GRAPH_QUERY).matches
    : false;
}

function getServerGraphViewportSnapshot(): boolean {
  return false;
}
```

`NodeGraph` obtains `mobile` from:

```typescript
const mobile = useSyncExternalStore(
  subscribeToGraphViewport,
  getGraphViewportSnapshot,
  getServerGraphViewportSnapshot,
);
```

Then replace the two unconditional `GraphPaths` calls with one:

```tsx
<GraphPaths
  mobile={mobile}
  idPrefix={graphId}
  restingEdges={restingEdges}
  activeEdges={activeEdges}
  reducedMotion={reducedMotion}
/>
```

Hydration contract:

1. SSR emits one desktop SVG because the server snapshot is `false`.
2. The first hydration render uses the same server snapshot, so element type, class, IDs, and `useId` prefix match with no hydration recovery.
3. On a narrow client, React compares the client snapshot after hydration and performs one normal update to the mobile SVG.
4. Existing CSS hides the server desktop SVG at narrow widths until that update, avoiding duplicate or incorrect rays. Controls remain semantic and operable.
5. Media-query change events swap the one decorative SVG while leaving `NodeGraph` interaction state and all parent application state intact.
6. Subscription cleanup removes the exact listener. Do not use `window.innerWidth` during render, a mount-only `useEffect` flag, `suppressHydrationWarning`, or a temporary dual render.

### 3. Native Lightweight Active Rays

**File:** `components/ui/NodeGraph.tsx`

Keep gradient definitions and all path geometry, IDs, edge IDs, stroke-width classes, and pointer-event behavior. Remove only the expensive active presentation mechanisms:

- Remove `motion` from the Framer Motion import; retaining `useReducedMotion` is allowed.
- Delete the glow filter ID, `<filter>`, `<feGaussianBlur>`, `<feMerge>`, and active path `filter` attribute.
- Replace each `<motion.path>` with a plain SVG `<path>` carrying `id`, `d`, `stroke`, and existing identifying attributes.
- Remove `initial`, `animate`, and `transition`; active paths are immediately visible through the existing `.graph-connections__active path` CSS.
- Do not replace the path transition with a CSS keyframe, Web Animation, timer, or JavaScript loop.

This makes the active ray itself a static native SVG shape. Only its single particle moves.

### 4. One Native Particle per Active Edge

**Files:** `components/ui/NodeGraph.tsx`, `app/globals.css`

For each active edge when reduced motion is false, render exactly one circle and one `animateMotion`:

```tsx
{!reducedMotion ? (
  <circle
    className="connection-particle"
    r={edge.emphasized ? 0.5 : 0.4}
  >
    <animateMotion
      dur={edge.emphasized ? "1.35s" : "1.6s"}
      begin={`${edgeIndex * -0.09}s`}
      repeatCount="indefinite"
    >
      <mpath href={`#${pathId}`} />
    </animateMotion>
  </circle>
) : null}
```

The exact radius/duration may be tuned within these small bounds for visibility, but cardinality cannot change. Negative native begin offsets prevent all dots from appearing synchronized without adding timers.

In CSS:

- Remove the `filter: drop-shadow(...)` declaration from `.connection-particle`; do not replace it with any CSS/SVG filter.
- Preserve visibility with an opaque ivory fill, a contrasting warm-dark native SVG stroke, a small stroke width, and opacity near 1.
- Keep the graph SVG noninteractive. Particle markup remains absent under reduced motion while resting and active paths remain present.

For any active state, runtime budgets are:

| Effect | Motion allowed | Reduced motion |
|---|---:|---:|
| Mounted `.graph-connections` SVGs | 1 | 1 |
| Active edge groups/paths | `N` | `N` |
| `.connection-particle` circles | `N` | 0 |
| `<animateMotion>` elements | `N` | 0 |
| Framer Motion active paths | 0 | 0 |
| SVG Gaussian-blur filters | 0 | 0 |
| Particle CSS drop-shadow filters | 0 | 0 |

### 5. Test and Smoke Updates

**Files:** `tests/node-graph.test.tsx`, a focused source/effect contract test under `tests/`, `tests/setup.ts` only if the shared media-query controller is needed, and `scripts/atlas-visibility-smoke.mjs`.

- Change existing desktop-only count assertions to total mounted-work assertions.
- MEN hover becomes 12 active groups, 12 particles, and 12 `animateMotion` elements total.
- Patek focus becomes two active groups, two particles, and two `animateMotion` elements total.
- Assert exactly one graph SVG, and assert its `--desktop`/`--mobile` class matches the media-query snapshot.
- Add reduced-motion coverage: relationships remain but particle and `animateMotion` counts are zero.
- Add source contracts scoped to `.site-masthead`, `GraphPaths`, and `.connection-particle`; do not ban unrelated backdrop filters elsewhere in the application.
- Update smoke selectors from `.graph-connections--desktop` to the single mounted `.graph-connections` where the assertion is about total work. At the reference desktop viewport also assert that sole SVG is the desktop variant.
- Keep existing node count, relationship, ray visibility, layer ordering, hydration readiness, hit-testing, runtime error, and failed-response assertions.

### 6. Watch-Canvas Contingency Gate

Do not modify `components/canvas/WatchMovementCanvas.tsx` or watch-specific CSS in the initial patch. Run the post-fix finite browser measurement after the header/graph changes. If all clause 2.6 thresholds pass, the watch implementation remains untouched. If a threshold fails, preserve the raw interaction/long-task evidence, stop implementation, and re-hypothesize the remaining bottleneck before proposing any canvas change; do not opportunistically reduce watch quality or animation.

## Testing Strategy

### Validation Approach

Validation follows the four bugfix phases:

1. **Explore:** Add expected-behavior budget tests and run them on unfixed code. They must fail with concrete source/DOM counterexamples.
2. **Preserve:** Record and test existing semantic, relationship, reduced-motion, responsive geometry, and application behaviors on unfixed code. These tests must pass before implementation.
3. **Implement:** Apply only the CSS and `NodeGraph` changes above.
4. **Validate:** Re-run the same exploration tests, preservation tests, full finite suite, build, and browser smoke/performance protocol.

No watch mode, development server, arbitrary performance sleep, or visual-only assertion is part of the automated gate.

### Exploratory Bug Condition Checking

**Goal:** Prove the deterministic structural bug before changing production code and record any performance baseline without assuming it will fail identically on every host.

**Expected-behavior exploration tests (fail on unfixed code):**

1. Parse all `.site-masthead` rules and assert default gradient stop alpha `<= 0.22` and zero standard/prefixed backdrop-filter declarations. Counterexample: alphas `0.95`/`0.70` and both filter spellings.
2. Hover MEN and assert one graph SVG, 12 active groups, and 12 particles total. Counterexample: two SVGs, 24 groups, and 72 particles.
3. Focus Patek and assert one graph SVG, two active groups, and two particles total. Counterexample: two SVGs, four groups, and 12 particles.
4. Assert no `motion.path`, `feGaussianBlur`, active-ray filter attribute, or `.connection-particle` drop shadow. Each assertion fails on the unfixed source.
5. Run the finite browser protocol once on unfixed production output and save the measured values as diagnostic evidence. The structural tests—not host timing—are the deterministic proof that the bug exists.

Do not weaken these expected-behavior tests when they fail. The same tests become fix checks after implementation.

### Preservation Checking

Before implementation, observe and lock these passing baselines:

- Header landmark/navigation names, link text/destinations/order, centered wordmark anchor, native activation count, 68/60-pixel geometry, compact visibility rules, and 44-pixel targets.
- Exact resting, MEN, WOMEN, each brand-preview, active-audience, selected-term emphasis, and duplicate-Rolex relationship IDs from `buildGraphEdges`.
- Locked brand focusability and activation gating.
- Reduced-motion rays with no traveling motion.
- All 13 controls, their accessible names/states, and decorative/control pointer-event separation.
- Audience selection, term opening, definition closing/focus restoration, search, and navigation behavior.
- A sorted SHA-256 manifest of `.kiro/specs/ai-coding-dictionary-inspired-site/` and a change-scope record for watch canvas files.

**Pseudocode:**

```pascal
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT observableBehavior(F(X)) = observableBehavior(F'(X))
END FOR
```

The preservation comparison excludes only the intended header material implementation, responsive SVG cardinality, active-path animation implementation, particle cardinality, and forbidden filters.

### Fix Checking

**Pseudocode:**

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  result := fixedRenderPipeline(X)
  ASSERT expectedBehavior(result)
END FOR
```

The deterministic source/DOM budgets must pass before the browser timing result is interpreted.

### Unit Tests

Use Vitest/JSDOM and the installed Testing Library:

- **Header source contract:** Read `app/globals.css`, extract balanced `.site-masthead` declaration blocks, resolve the two default gradient tokens, and assert every stop alpha is `<= 0.22`. Assert no masthead block contains `backdrop-filter` or `-webkit-backdrop-filter`; assert one-pixel edge/highlight, bounded static shadow, fixed foreground/halo/focus tokens, preference overrides, and forced-color system tokens.
- **Graph source contract:** Read only `GraphPaths` source and assert plain `<path>` output, no `motion.path`, no SVG filter/Gaussian blur, and one native circle/`animateMotion` branch. Read only `.connection-particle` declarations and reject `drop-shadow`/filter effects.
- **Effect cardinality:** For each finite interaction state, compare active group IDs to `buildGraphEdges`, assert one mounted SVG, then assert `particles = animateMotion = N` or zero under reduced motion.
- **Media-query updates:** Use a controllable `MediaQueryList` test double with real listener registration/removal. Cross 700/701 and assert exactly one matching variant after each `act`-wrapped change event.
- **SSR/hydration:** `renderToString` with the server snapshot, hydrate under a client `matches: true` mobile query using `hydrateRoot`, collect `onRecoverableError`/console errors, and assert initial markup hydrates without recovery before becoming one mobile SVG.
- **Header preservation:** Assert existing semantic markup, links, names, target styles, and no component markup change.

### Property-Based Tests

Use the already installed `fast-check` with a fixed seed and finite run count so failures reproduce exactly:

1. **Property 1—responsive/effect budget:** Generate viewport widths from 320 through 1920, valid audience/preview/selection states, and motion preference. For each case, derive `N` and expected edge IDs with `buildGraphEdges`; assert one matching responsive SVG, `N` paths, exactly `N` particles when motion is allowed, zero particles under reduced motion, and no forbidden effects.
2. **Property 1—header alpha budget:** Parse the finite authored masthead gradient stops, then quantify over each extracted stop and assert `0 <= alpha <= 0.22`.
3. **Property 2—relationship preservation:** Generate valid graph states and compare post-fix edge-ID sets, emphasis flags, node accessible names/states, and activation outcomes with the observation-first baseline recorded before implementation.

Use a documented seed (for example `0xC0FFEE`) and about 50 runs; do not use randomized browser timing.

### Integration Tests

- Hydrate the application at 700 and 701 CSS pixels and verify one graph variant, correct coordinate mode, no hydration warning, and preserved state across a breakpoint change.
- Exercise pointer hover, keyboard focus, audience selection, term selection, definition close, and search while checking exact relationship IDs and node hit targets.
- Emulate reduced motion and verify rays/selection remain while native particles are absent.
- Check the masthead in default, reduced-transparency/increased-contrast where supported, and forced-colors modes. Verify 68/60-pixel height, centered wordmark, 44×44 targets, light-text/dark-halo contrast >= 4.5:1, and two-tone focus contrast >= 3:1.
- In the browser smoke, assert one desktop SVG at 1024×576, 12 MEN particles, two Patek particles, visible active paths, and no errors or failed resources.

### Finite Hover Performance Measurement

Extend `scripts/atlas-visibility-smoke.mjs`; do not add a browser dependency. The existing script already launches a finite production server/browser, uses the browser protocol, waits for hydration, dispatches input, checks hit-testing, collects errors, and terminates its child processes.

**Environment and setup:**

1. Run against a production build in the reference browser at 1024×576, DPR 1.
2. Fail as unsupported if `PerformanceObserver.supportedEntryTypes` does not include `longtask`; do not silently report a pass.
3. Install an in-page `PerformanceObserver` before interactions. Store long-task `{startTime, duration}` entries and merge callback entries with `observer.takeRecords()` when finalizing each sample.
4. Install a one-shot capture listener on the MEN control. Use the event's high-resolution `timeStamp` as the interaction start; never use host `Date.now()` or protocol round-trip duration.
5. Define visual readiness from actual state: mode is `preview-men`, one mounted SVG contains 12 active groups and 12 particles, every active path is visible with nonzero opacity/stroke width, and every particle has a positive radius and visible computed style.

**Finite sequence:**

1. Perform one complete MEN hover, visible-state confirmation, pointer leave, and resting-state confirmation as warm-up. Exclude it from assertions and clear entries afterward.
2. Perform exactly three measured interactions. Before each, wait by DOM condition for resting mode and two animation frames, clear sample entries, arm the event/frame probe, and dispatch the pointer move.
3. In the page, inspect the first `requestAnimationFrame` that satisfies visual readiness and record `performance.now() - event.timeStamp` as visual response latency. Use one following frame only to finalize records; do not sleep for an assumed render duration.
4. Define the sample end at finalization. Include every long task whose interval overlaps `[event.timeStamp, sampleEnd]`, including a task that began before the event callback.
5. For each sample compute `longestTask = max(duration, 0)` and `blocking = sum(max(0, duration - 50))`.
6. While the fan is active, verify all 13 control centers still resolve to their corresponding `.atlas-node` through `elementsFromPoint`.
7. Leave MEN and wait for resting mode before the next iteration.

**Per-interaction assertions (no averaging and no retries):**

- visual response latency `<= 100ms`;
- all controls hit-testable;
- zero runtime/console errors and zero failed application responses;
- no individual main-thread task `> 100ms`;
- cumulative blocking time `<= 100ms`.

Poll timeouts remain only finite failure guards; they are not measurements. Emit all three raw sample records in failure output so a genuine regression can be distinguished from unsupported instrumentation. This protocol avoids arbitrary wall-clock sleeps and host/process timing while matching clause 2.6 exactly.

### Regression Commands

After implementation, run only finite commands:

```text
npm test
npm run typecheck
npm run lint
npm run build
npm run smoke:atlas
```

The smoke starts and stops its own finite production child process. Do not run `npm run dev`, a watcher, or an interactive application as part of validation.

### Requirement Traceability

| Requirements | Design element | Primary verification |
|---|---|---|
| 1.1, 2.1 | Static low-alpha masthead tokens | Unfixed counterexample; alpha source property; browser transmission check |
| 1.2, 2.2 | Remove masthead filter branch/declarations | Scoped source check; computed masthead filter is `none` |
| 1.3, 2.3 | Plain active paths and bounded native particles | Interaction tests; visible-ray smoke; finite performance protocol |
| 1.4, 2.4 | One `useSyncExternalStore`-selected SVG | Width property; 700/701 resize; SSR/hydration test |
| 1.5, 2.5 | `N`/zero particle budget and forbidden-effect budget | Unfixed 72-particle counterexample; source and runtime cardinality properties |
| 1.6, 2.6 | Warm-up plus three in-page measured interactions | Event-to-frame and long-task records per interaction |
| 3.1 | Existing 68/60 CSS breakpoint geometry | 700/701 computed-layout boundary checks |
| 3.2 | Unchanged masthead markup and activation | DOM/accessibility/activation tests |
| 3.3 | Opaque foreground, crisp halo, two-tone focus, 44px targets | Token contrast plus compact browser geometry/focus checks |
| 3.4 | System-color forced-colors override | Scoped source and supported browser emulation |
| 3.5 | One-pixel edge/highlight and restrained static shadow | CSS source/computed-style contract |
| 3.6 | Unchanged edge builders and IDs | Observation-first edge matrix and property test |
| 3.7 | Keep rays, suppress particles under reduced motion | Reduced-motion unit/integration checks |
| 3.8 | Decorative pointer isolation and native controls | Pointer/keyboard/touch tests and per-sample center hit-testing |
| 3.9 | Canvas contingency gate | Passing performance record plus watch-file change-scope/digest review |
| 3.10 | Existing application state and error behavior | Existing suite, full interactions, console/runtime collection |
| 3.11 | Historical spec byte preservation | Sorted pre/post SHA-256 manifest |
| 3.12 | Nonsuperseded finite regression suite | Full test/type/lint/build/smoke commands with only count updates |
