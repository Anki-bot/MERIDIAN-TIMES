# Implementation Plan

## Execution Contract

- Execute tasks strictly in dependency order. Every task and subtask is mandatory.
- Task 1 is complete only when its expected-behavior tests have been run against the unfixed code, failed as expected, and emitted the required concrete counterexamples. Those failures confirm the bugs; do not weaken the assertions or change production code during Task 1.
- Task 2 follows the observation-first methodology and is complete only when its targeted preservation tests pass on the unfixed code. Do not include the intentionally failing Task 1 tests in that baseline command.
- Use only finite commands. Do not run `npm run dev`, watch mode, an interactive application, or a persistent server. `npm run smoke:atlas` is allowed because `scripts/atlas-visibility-smoke.mjs` owns and terminates its finite production child processes.
- Keep `.kiro/specs/ai-coding-dictionary-inspired-site/` byte-for-byte unchanged. Do not modify `components/canvas/WatchMovementCanvas.tsx` or watch-specific CSS unless the final contingency gate fails and the requirements/design are explicitly revised first.
- Property-based tests use `fast-check` with seed `0xC0FFEE` and approximately 50 finite runs. Browser timing is measured only by the finite in-page protocol in Task 4, never by randomized PBT input or host/protocol round-trip time.

- [x] 1. Write and run bug-condition exploration tests against the unfixed code
  - **Property 1: Bug Condition** - Static Glass and Bounded Active Graph Effects
  - **CRITICAL**: Write expected-behavior tests before implementing the fix. Run them on the UNFIXED code and expect them to FAIL; these failures are the deterministic proof that the defects exist.
  - Add `tests/glass-header-bug-condition.test.ts` and scope its source parser to `:root` header tokens and balanced `.site-masthead` declaration blocks in `app/globals.css`; do not reject unrelated backdrop filters elsewhere in the application.
  - **Header counterexample**: assert every default authored masthead color-stop alpha is `<= 0.22` and that no `.site-masthead` block declares either filter spelling. Make the failure output record the current `--header-glass-fallback: rgba(245, 243, 238, 0.95)`, `--header-glass-enhanced: rgba(244, 242, 236, 0.7)`, `--header-blur: 22px`, and `--header-saturation: 118%` values.
  - **Header filter counterexample**: record that the supported branch currently applies both `backdrop-filter: blur(22px) saturate(118%)` and `-webkit-backdrop-filter: blur(22px) saturate(118%)`, and that both spellings also remain as `none` declarations in the reduced-transparency, increased-contrast, and forced-colors `.site-masthead` blocks. The desired test must reject all masthead declarations, including `none`.
  - Add `tests/node-graph-bug-condition.test.tsx`; update total-work assertions in `tests/node-graph.test.tsx` so selectors start at the mounted `.graph-connections` subtree rather than inspecting only `.graph-connections--desktop`. Add a controllable `MediaQueryList` helper at `tests/helpers/match-media.ts` and install/restore it per test without leaking listeners.
  - **Responsive/edge counterexample**: assert exactly one mounted responsive SVG and exactly `N` active groups for the edge IDs returned by `buildGraphEdges`. Record that the unfixed render mounts two SVGs (`--desktop` and `--mobile`); MEN has logical `N = 12` but mounts 24 active groups, while Patek focus has logical `N = 2` but mounts four active groups.
  - **Particle counterexample**: assert `particle circles = animateMotion elements = N` when motion is allowed and both counts are zero under reduced motion. Record that unfixed MEN hover mounts 72 circles and 72 `animateMotion` elements total (`12 × 2 × 3`), and unfixed Patek focus mounts 12 of each (`2 × 2 × 3`). Also record the existing desktop-only blind spot of 36 MEN particles and six Patek particles.
  - **Filter/animation counterexample**: assert `GraphPaths` contains plain native active paths and no `motion.path`, active-path `filter` attribute, SVG `<filter>`, `feGaussianBlur`, or per-particle CSS filter. Record the current `motion.path`, one `feGaussianBlur stdDeviation="0.7"` per mounted SVG, `filter="url(#…-ray-glow)"` on every active path, `Array.from({ length: 3 })`, and `.connection-particle { filter: drop-shadow(0 0 2px #fff) drop-shadow(0 0 5px rgba(246, 173, 77, 0.9)); }` evidence.
  - Add a scoped PBT over widths 320–1920, valid audience/preview/selection states, and reduced-motion preference. Derive `N` and edge IDs from `buildGraphEdges`; assert one matching variant, `N` active paths, and `N`/zero particles according to motion preference. Scope deterministic examples to MEN and Patek so failure reproduction does not depend on generated input order.
  - Run `npm test -- tests/glass-header-bug-condition.test.ts tests/node-graph-bug-condition.test.tsx tests/node-graph.test.tsx` on unfixed code. The command must exit nonzero for the stated expected-behavior assertions. Capture the exact failing examples in the task/PBT result and mark this task complete despite the expected nonzero exit.
  - Run `npm run build`, then `ATLAS_ASSERT=0 ATLAS_VERBOSE=1 npm run smoke:atlas` once on unfixed code as mandatory diagnostic evidence. Preserve its current desktop-only 36/6 particle observations and error/resource output; do not treat host timing as a pass/fail oracle before Task 4 adds in-page timing.
  - _Bug_Condition: `isBugCondition(X)` where `C_H`, `C_G`, or diagnostic `C_P` holds, as defined in `design.md`_
  - _Expected_Behavior: `expectedBehavior(result)` from `design.md`_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 2. Write and run observation-first preservation property tests on the unfixed code
  - **Property 2: Preservation** - Header, Graph, Accessibility, and Application Contracts
  - **IMPORTANT**: Observe the current non-bug-condition behavior first, encode only that observed behavior, and verify these tests PASS on UNFIXED code before any production edit. Exclude the intentionally replaced masthead material, duplicate responsive SVG cardinality, framework path animation, particle cardinality, and forbidden filters from preservation baselines.
  - Add `tests/glass-header-hover-preservation.test.tsx` around `components/EliteWatchesExperience.tsx` and `components/ui/NodeGraph.tsx`, mocking only the canvas boundary needed for deterministic JSDOM rendering. Record and assert the header landmark; Primary and Account navigation names; link text, destinations, DOM/focus order, and one native activation; centered wordmark anchor; 68/60-pixel CSS geometry; 44×44 targets; focus contract; and forced-colors system-token contract.
  - Extend `tests/graph.test.ts` with an observation-first finite edge-ID/emphasis matrix for resting, MEN, WOMEN, every brand preview, active audience, selected term, and duplicate Rolex presentations. Add a seeded PBT over valid graph states that preserves exact relationship IDs, emphasis flags, enabled states, and activation outcomes without preserving the intentionally replaced rendering mechanisms.
  - Extend `tests/node-graph.test.tsx` and `tests/accessibility.test.tsx` with passing unfixed baselines for all 13 native controls, accessible names/states, pointer/focus preview meaning, audience and term activation, focus restoration, search, decorative/control pointer-event separation, and reduced-motion rays with no traveling particles.
  - Add `tests/spec-integrity.test.ts` and checked-in `tests/fixtures/glass-header-hover-preservation.sha256`. Generate a sorted SHA-256 manifest for every file under `.kiro/specs/ai-coding-dictionary-inspired-site/`, `components/canvas/WatchMovementCanvas.tsx`, and extracted watch-specific CSS selector blocks; assert the current bytes against that manifest so later tasks cannot silently alter historical-spec or watch behavior.
  - Run only the preservation baseline with `npm test -- tests/glass-header-hover-preservation.test.tsx tests/graph.test.ts tests/node-graph.test.tsx tests/accessibility.test.tsx tests/spec-integrity.test.ts`. The targeted command must pass on unfixed code; if it fails, correct the observation or test isolation before implementation rather than changing production behavior.
  - _Preservation: `observableBehavior(F(X)) = observableBehavior(F'(X))` for `NOT isBugCondition(X)`, with only the explicitly replaced mechanisms excluded_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

- [x] 3. Implement and deterministically verify the scoped fix

  - [x] 3.1 Implement the static transparent masthead in `app/globals.css`
    - Replace the fallback/enhanced material with `--header-glass-top: rgba(10, 14, 16, 0.20)` and `--header-glass-bottom: rgba(10, 14, 16, 0.12)`; use the design’s explicit border `0.38`, highlight `0.18`, shadow `0.16`, opaque light-label/gold, dark-halo, and focus tokens.
    - Make the default `.site-masthead` a static two-stop gradient, keep the divider exactly one CSS pixel, and bound the exterior shadow to the static `0 6px 18px` design value. Remove the masthead `@supports` branch, blur/saturation tokens, and every standard or prefixed masthead filter declaration, including `none` in accessibility overrides. Do not remove unrelated filters outside `.site-masthead`.
    - Add the specified zero-blur four-cardinal text halo and two-tone focus treatment while preserving the existing underline, 68/60-pixel heights, centered wordmark, 44×44 targets, navigation markup, and unclipped focus. Keep solid `#101416` preference overrides and forced-colors `Canvas`, `CanvasText`/`LinkText`, and `Highlight` behavior without authored shadows/halos.
    - Do not add pseudo-element material, noise, `color-mix`, animation, transition, or `will-change` to the header.
    - _Bug_Condition: `C_H` in `isBugCondition(X)`_
    - _Expected_Behavior: `headerCorrect` in `expectedBehavior(result)`_
    - _Preservation: responsive geometry, semantics, contrast/focus/target contracts, forced colors, and static one-pixel edge from `design.md`_
    - _Properties: Property 1 and Property 2_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Implement one responsive lightweight graph in `components/ui/NodeGraph.tsx` and `app/globals.css`
    - Add module-stable `MOBILE_GRAPH_QUERY`, `subscribeToGraphViewport`, `getGraphViewportSnapshot`, and desktop-`false` `getServerGraphViewportSnapshot`; call `useSyncExternalStore` in `NodeGraph` and render exactly one `GraphPaths` instance. Preserve the 700/701 boundary, desktop SSR/first hydration snapshot, narrow-client post-hydration update, exact listener cleanup, graph/parent state, and existing CSS bridge that hides the server desktop SVG on a narrow client until the update.
    - Do not use `window.innerWidth` during render, a mount-only flag, dual rendering, `suppressHydrationWarning`, or a new application state owner.
    - Remove `motion` from the Framer Motion import while retaining `useReducedMotion`. Delete the glow ID/filter tree and replace every `motion.path` with a plain native `<path>` preserving IDs, geometry, gradients, edge IDs, emphasis classes, and pointer isolation; add no replacement path animation, timer, loop, or CSS keyframe.
    - Render exactly one native `<circle>` and one `<animateMotion>` per active edge when motion is allowed, using one `<mpath>` reference and deterministic negative edge offset. Render zero particles under reduced motion while retaining active and resting rays. Remove only `.connection-particle` drop shadows from `app/globals.css`; retain visibility with opaque ivory fill, native contrasting stroke, small stroke width, and near-one opacity.
    - Keep `buildRestingGraphEdges`, `buildGraphEdges`, node coordinates, accessible controls, graph relationships, and all watch-canvas code unchanged.
    - _Bug_Condition: `C_G` in `isBugCondition(X)`_
    - _Expected_Behavior: `graphCorrect` in `expectedBehavior(result)`_
    - _Preservation: graph relationship, accessibility, state, reduced-motion, and hit-testing requirements from `design.md`_
    - _Properties: Property 1 and Property 2_
    - _Requirements: 2.3, 2.4, 2.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 3.3 Re-run the same bug-condition exploration tests and verify expected behavior
    - **Property 1: Expected Behavior** - Static Glass and Bounded Active Graph Effects
    - Re-run the exact Task 1 tests; do not replace them with new tests or relax any expected-behavior assertion.
    - Verify the masthead maximum default alpha is `<= 0.22` with zero masthead filter declarations; widths 320–1920 mount exactly one matching graph SVG; every state has the exact `buildGraphEdges` edge IDs; motion-allowed states have `particles = animateMotion = N`; reduced motion has zero; and forbidden path/filter mechanisms are absent.
    - Run `npm test -- tests/glass-header-bug-condition.test.ts tests/node-graph-bug-condition.test.tsx tests/node-graph.test.tsx`. The command must now pass, proving the deterministic portions of Property 1 are fixed.
    - _Expected_Behavior: `headerCorrect` and `graphCorrect` in `expectedBehavior(result)`_
    - _Properties: Property 1_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.4 Re-run the same preservation tests and verify no deterministic regressions
    - **Property 2: Preservation** - Header, Graph, Accessibility, and Application Contracts
    - Re-run the exact targeted tests and integrity fixture from Task 2; do not write replacement baselines after production edits.
    - Run `npm test -- tests/glass-header-hover-preservation.test.tsx tests/graph.test.ts tests/node-graph.test.tsx tests/accessibility.test.tsx tests/spec-integrity.test.ts` and require every preservation assertion to remain passing.
    - _Preservation: `observableBehavior(F(X)) = observableBehavior(F'(X))` for the preserved input domain_
    - _Properties: Property 2_
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

- [x] 4. Update and run finite smoke/performance instrumentation

  - [x] 4.1 Implement structural and in-page performance assertions in `scripts/atlas-visibility-smoke.mjs`
    - Replace desktop-only total-work selectors with the sole mounted `.graph-connections`; at the fixed 1024×576, DPR-1 reference viewport separately assert that sole SVG has the desktop variant class. Update MEN to 12 active groups/particles/`animateMotion` elements and Patek to two, while preserving node count, edge visibility, layer ordering, hydration readiness, hit-testing, runtime-error, and failed-response assertions.
    - Fail as unsupported when `PerformanceObserver.supportedEntryTypes` lacks `longtask`. Install the observer before interaction, store `{ startTime, duration }`, and merge callback entries with `takeRecords()` at sample finalization.
    - Instrument MEN with a one-shot capture listener and use the dispatched event’s high-resolution `timeStamp`. Define visual readiness as `preview-men`, one SVG, 12 visible nonzero active paths, 12 visible positive-radius particles, and no missing active work; record the first `requestAnimationFrame` satisfying that predicate and finalize records one frame later.
    - Execute exactly one complete warm-up hover/visible/leave/rest cycle, clear its entries, then execute exactly three measured hover interactions. Before each sample wait by resting DOM state plus two animation frames, clear entries, arm the probe, dispatch pointer input, verify all 13 control centers with `elementsFromPoint`, leave MEN, and await resting state. Do not average, retry, or use arbitrary sleeps as measurements.
    - For each sample include every long task overlapping `[event.timeStamp, sampleEnd]`; compute `longestTask = max(duration, 0)` and `blocking = sum(max(0, duration - 50))`. Assert latency `<= 100ms`, longest task `<= 100ms`, blocking `<= 100ms`, all controls hit-testable, and zero runtime/console errors or failed application responses.
    - Emit all three raw sample records on both success and failure. Retain finite poll deadlines only as failure guards and preserve `finally` cleanup of browser, server, protocol client, profile, and temporary output.
    - Add `tests/atlas-smoke-contract.test.ts` to source-check the fixed sample count, thresholds, required observer support failure, event-time/frame readiness, overlap/blocking formula, raw-record output, one-variant assertions, and child cleanup so accidental weakening is caught without starting a browser.
    - _Bug_Condition: `C_P` and the browser-observable portion of `C_G` in `isBugCondition(X)`_
    - _Expected_Behavior: `performanceCorrect` and `graphCorrect` in `expectedBehavior(result)`_
    - _Properties: Property 1 and Property 2_
    - _Requirements: 1.6, 2.3, 2.4, 2.5, 2.6, 3.6, 3.8, 3.9, 3.10, 3.12_

  - [x] 4.2 Run the updated finite browser fix check
    - Run `npm test -- tests/atlas-smoke-contract.test.ts`, then `npm run build`, then `npm run smoke:atlas`. Do not supply `ATLAS_ASSERT=0`, retry a failed sample, or substitute host-side timing.
    - Require all three measured interactions to satisfy every threshold independently and retain their raw records as validation evidence. An unsupported long-task observer, timeout, runtime error, failed response, hit-test failure, or threshold violation is a failed task.
    - _Expected_Behavior: `performanceCorrect` in `expectedBehavior(result)`_
    - _Properties: Property 1 and Property 2_
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.8, 3.9, 3.10, 3.12_

- [x] 5. Complete full finite validation and enforce the watch-canvas contingency gate

  - [x] 5.1 Run the complete finite regression sequence
    - Run, as separate finite commands, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run smoke:atlas`. Every command must pass with no watcher, persistent development server, skipped assertion, averaged browser result, or retry. Treat any protected-file checksum mismatch from `tests/spec-integrity.test.ts` as a validation failure.
    - Confirm Property 1’s deterministic source/DOM checks and three browser samples pass together, and Property 2’s semantics, relationships, accessibility, reduced-motion, state, historical-spec, and watch-scope checks remain green.
    - _Properties: Property 1 and Property 2_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

  - [x] 5.2 Apply the mandatory watch-canvas and historical-spec contingency gate
    - Re-run `npm test -- tests/spec-integrity.test.ts` as an independent byte/scope check and require the checked-in manifest to match every historical-spec file, `components/canvas/WatchMovementCanvas.tsx`, and the preserved watch-specific CSS blocks. Do not regenerate or accept a new manifest after implementation changes.
    - If all Task 4/5 performance thresholds pass, require the watch implementation to remain untouched and close the bugfix without any canvas, geometry, content, camera, WebGL, or static-fallback change.
    - If any performance threshold fails, preserve all raw interaction/long-task records, stop implementation, leave watch files unchanged, and return to requirements/design for a new root-cause hypothesis before proposing a canvas change. Do not opportunistically reduce watch quality or bypass the gate.
    - _Preservation: watch rendering and historical specification remain unchanged when the scoped fix passes_
    - _Properties: Property 1 and Property 2_
    - _Requirements: 2.6, 3.9, 3.10, 3.11, 3.12_

## Dependency DAG and Execution Waves

The graph is acyclic and intentionally serial at shared-file boundaries:

```text
1 -> 2 -> 3.1 -> 3.2 -> 3.3 -> 3.4 -> 4.1 -> 4.2 -> 5.1 -> 5.2
```

| Wave | Leaf task | Depends on | Concurrency/safety reason |
|---:|---|---|---|
| 1 | 1 | — | Establish failing expected-behavior evidence before any production edit. |
| 2 | 2 | 1 | Lock passing unfixed preservation behavior after counterexamples are known. |
| 3 | 3.1 | 2 | First production edit; owns masthead changes in `app/globals.css`. |
| 4 | 3.2 | 3.1 | Logically separate graph fix, but serialized because it also edits `app/globals.css`; owns `NodeGraph.tsx` graph changes. |
| 5 | 3.3 | 3.2 | Verify the same Property 1 tests only after both production edits are complete. |
| 6 | 3.4 | 3.3 | Verify the unchanged-behavior baseline after deterministic fix checks pass. |
| 7 | 4.1 | 3.4 | Instrument only the settled fixed DOM/effect contract. |
| 8 | 4.2 | 4.1 | Run the browser protocol only after instrumentation and its source contract exist. |
| 9 | 5.1 | 4.2 | Full finite validation consumes all completed implementation and smoke work. |
| 10 | 5.2 | 5.1 | Final gate uses passing raw performance and regression evidence. |

No implementation leaves share a wave. In particular, Tasks 3.1 and 3.2 must not run concurrently because both modify `app/globals.css`; Task 3.2 must be one coordinated edit for `components/ui/NodeGraph.tsx` and its particle CSS.

## Traceability Matrix

| Clauses / property | Exploration or baseline | Implementation | Authoritative verification |
|---|---|---|---|
| 1.1, 2.1 | Task 1 header alpha counterexample | 3.1 | 3.3, 5.1 |
| 1.2, 2.2 | Task 1 masthead filter counterexample | 3.1 | 3.3, 5.1 |
| 1.3, 2.3 | Task 1 active-fan/effect counterexamples | 3.2 | 3.3, 4.1–4.2, 5.1 |
| 1.4, 2.4 | Task 1 two-variant counterexample | 3.2 | 3.3, 4.1–4.2, 5.1 |
| 1.5, 2.5 | Task 1 72/12-particle and filter counterexamples | 3.2 | 3.3, 4.1–4.2, 5.1 |
| 1.6, 2.6 | Task 1 unfixed diagnostic record | 4.1 | 4.2, 5.1–5.2 |
| 3.1–3.5 | Task 2 header preservation baseline | 3.1 | 3.4, 5.1 |
| 3.6–3.8 | Task 2 graph/accessibility/reduced-motion baseline | 3.2 | 3.4, 4.2, 5.1 |
| 3.9 | Task 2 watch source/CSS manifest | 3.2 scoped exclusion | 4.2, 5.1–5.2 |
| 3.10 | Task 2 application-state/error baseline | 3.2 scoped preservation | 3.4, 4.2, 5.1 |
| 3.11 | Task 2 historical-spec manifest | No implementation change permitted | 3.4, 5.1–5.2 |
| 3.12 | Task 2 nonsuperseded finite baseline | Tasks 3–4 | 4.2, 5.1–5.2 |
| Property 1 | Task 1 expected failures | 3.1–3.2, 4.1 | 3.3, 4.2, 5.1 |
| Property 2 | Task 2 passing unfixed baseline | Preservation constraints in 3.1–3.2 and 4.1 | 3.4, 4.2, 5.1–5.2 |
