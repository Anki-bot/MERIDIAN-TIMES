# Implementation Plan: Signal & Syntax

## Overview

Implement the approved “Signal & Syntax” feature as a progressively enhanced, static vanilla HTML/CSS/JavaScript application. Work incrementally from the validated content and pure state layer through the semantic shell, accessible interactions, responsive styling, motion, integration, and release gates. Every source path, test path, generated artifact, and tool configuration must remain at or beneath `/Users/ankitkumar/Desktop/CODE/activity`.

## Tasks

- [x] 1. Establish the testable content and catalog foundation
  - [x] 1.1 Configure native ES-module and single-run test tooling
    - Create `package.json` and `package-lock.json` directly beneath Project_Root, set the package to native ES modules, and add finite non-watch test commands based on `node --test`.
    - Add `fast-check` as an exact development dependency at version `4.9.0`; add no runtime framework or runtime dependency.
    - Keep every install target, cache/output path controlled by the project, test file, and configuration beneath Project_Root, and abort rather than operate on an outside or unverifiable path.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 12.8, 12.10, 13.6, 13.7_

  - [x] 1.2 Create the original structured dictionary repository
    - Create `data/terms.js` with at least 12 independently written entries across at least 3 categories, including every required text and array field and only valid, resolvable relationships.
    - Use the approved “Signal & Syntax” educational identity and original AI-assisted-building content; do not retain the legacy studio copy or introduce reference-site text, branding, assets, or third-party media.
    - Keep the foundation asset-free by using authored data and system resources only; do not create an empty `assets/` tree.
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.8, 2.9, 3.9, 4.1, 4.2, 4.4, 4.6, 4.7, 4.8, 4.9, 4.10, 12.2, 12.5, 12.6, 12.12_

  - [x] 1.3 Implement repository validation, immutable indexes, and diagnostics
    - Create `scripts/catalog.js` with multi-pass shape, uniqueness, fixed-point relationship, foundation-minimum, and snapshot validation.
    - Reject every member of an id or slug collision, exclude invalid entries without losing independent valid entries, and return frozen entries, categories, id accessors, search indexes, diagnostics, and the foundation-minimum result.
    - Report every failed rule once in a grouped development-console diagnostic identified by id, slug, or source position; never silently repair authored values.
    - Implement the locale-stable three-key comparator and category/search-index derivation without mutating source data.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.13, 4.14, 4.15, 13.6_

  - [x] 1.4 Implement keyed catalog and detail projection helpers
    - Extend `scripts/catalog.js` with pure catalog/detail view-model helpers and a keyed DOM renderer that derives all labels from the validated repository.
    - Render each ordered result exactly once with cached card nodes and a single `DocumentFragment` commit; insert authored values with `textContent` and attribute setters rather than content-derived HTML.
    - Derive categories, count, no-results content, optional alias/relationship sections, and uniquely keyed selected state without clearing the accepted query or filter.
    - Expose native entry buttons with stable ids, visible action labels, `aria-controls`, and matching `aria-expanded` state for later controller wiring.
    - _Requirements: 3.4, 3.5, 3.11, 4.11, 4.12, 5.10, 5.11, 6.1, 6.2, 6.3, 6.5, 6.8, 6.9, 10.5, 10.10_

  - [x]* 1.5 Write the property test for accepted-entry local schema soundness
    - Add exactly one tagged, seeded `fc.property`/`fc.assert` test to `tests/catalog.test.mjs`, with at least 100 generated cases and seed `0x51a1c0de`.
    - Generate valid and malformed field/array/slug combinations and assert that admitted values satisfy every local rule and are preserved rather than rewritten.
    - **Property 1: Accepted entries satisfy the local schema**
    - **Validates: Requirements 4.1, 4.2, 4.4, 4.6, 4.7, 13.6**

  - [x]* 1.6 Write the property test for global identity and relationship integrity
    - Add exactly one tagged, reproducible generated test to `tests/catalog.test.mjs`; retain seed and shrink-path output for replay.
    - Exercise id/slug collisions and relationship invalidation chains, asserting pairwise uniqueness, exact resolution, and retention of independent valid entries.
    - **Property 2: Admitted repositories have global identity and relationship integrity**
    - **Validates: Requirements 4.3, 4.5, 4.8, 4.14, 13.6**

  - [x]* 1.7 Write the property test for complete attributable rejection diagnostics
    - Add exactly one tagged, seeded generated test to `tests/catalog.test.mjs` covering simultaneous local, uniqueness, and relationship failures.
    - Assert that every modeled failed rule has an attributable diagnostic and that no rejected source entry reaches the validated snapshot.
    - **Property 3: Rejection diagnostics are complete and attributable**
    - **Validates: Requirements 4.14, 4.15, 13.6**

  - [x]* 1.8 Write the property test for deterministic catalog ordering
    - Add exactly one tagged, seeded generated test to `tests/catalog.test.mjs` using case, normalized-term, and id ties.
    - Assert permutation preservation, exactly-once membership, and ascending adjacency under the approved three-key code-unit comparator.
    - **Property 4: Catalog ordering follows the deterministic three-key comparator**
    - **Validates: Requirements 4.13**

  - [x]* 1.9 Add focused catalog and authored-content examples
    - Add readable examples to `tests/catalog.test.mjs` for missing/whitespace fields, malformed slugs, duplicate arrays, collision members, fixed-point relationship rejection, diagnostic formatting, comparator ties, and text that resembles markup.
    - Assert that the authored `data/terms.js` fixture has no validation issues, contains at least 12 valid entries and 3 categories, and supplies original nonempty definitions and explanations.
    - _Requirements: 2.2, 4.1–4.15, 13.6_

- [x] 2. Implement deterministic search and browsing state
  - [x] 2.1 Implement Unicode-safe query acceptance and result selection
    - Create `scripts/search.js` with first-200-Unicode-code-point acceptance, Unicode trimming, NFKC plus `en-US` lowercasing, and a violation result for over-limit input.
    - Implement a pure selector using only term, aliases, short definition, and category; intersect exact category filtering with normalized substring matching and use the catalog comparator for final ordering.
    - Keep selection synchronous and side-effect free for repositories up to 500 entries; do not debounce or mutate repository/state inputs.
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.13, 5.17_

  - [x] 2.2 Implement initial, query, filter, and reset state transitions
    - Extend `scripts/search.js` with the initial browsing state, query/filter/reset reducer paths, and a view-model selector for results, count, and no-results visibility.
    - Return the previous state object for identity transitions, preserve ordering, and make reset restore only query/filter while maintaining the approved closed-detail browsing invariant.
    - Keep query and filter application order-independent and state serializable for later orientation/layout preservation.
    - _Requirements: 5.1, 5.5, 5.6, 5.7, 5.8, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 9.12_

  - [x]* 2.3 Write the property test for initial browsing state
    - Add exactly one tagged, seeded generated test to `tests/search.test.mjs`, with at least 100 cases.
    - Generate valid repositories and assert empty query, all-categories state, complete exactly-once membership, and deterministic initial order.
    - **Property 5: Initial browsing state is the complete ordered repository**
    - **Validates: Requirements 5.1**

  - [x]* 2.4 Write the property test for Unicode query acceptance
    - Add exactly one tagged, seeded generated Unicode test to `tests/search.test.mjs` covering whitespace, combining sequences, and astral code points.
    - Assert the trimmed first-200-code-point prefix, maximum length, and exact over-limit violation signal.
    - **Property 6: Query acceptance trims and enforces the Unicode code-point limit**
    - **Validates: Requirements 5.2, 5.17**

  - [x]* 2.5 Write the property test for normalization-invariant results
    - Add exactly one tagged, seeded generated test to `tests/search.test.mjs` for query pairs equal under NFKC and `en-US` lowercase normalization.
    - Assert identical ordered result ids under every generated valid category filter.
    - **Property 7: Normalization-equivalent queries are result invariant**
    - **Validates: Requirements 5.3, 5.13, 13.7**

  - [x]* 2.6 Write the property test for the independent query/filter model
    - Add exactly one tagged, seeded generated test to `tests/search.test.mjs` with an independently implemented membership oracle.
    - Assert all-and-only intersection membership and deterministic order for empty/nonempty queries and all/exact category filters.
    - **Property 8: Search and category selection equal the independent intersection model**
    - **Validates: Requirements 5.4, 5.5, 5.6, 5.7, 5.8**

  - [x]* 2.7 Write the property test for reset restoration
    - Add exactly one tagged, seeded generated test to `tests/search.test.mjs` over reachable browsing states.
    - Assert one reset produces the same query, filter, membership, and ordering projection as initialization.
    - **Property 9: Reset restores the initial browsing projection**
    - **Validates: Requirements 5.12**

  - [x]* 2.8 Write the property test for active-filter idempotence
    - Add exactly one tagged, seeded generated test to `tests/search.test.mjs` and retain replay metadata.
    - Assert that reapplying the current filter preserves the state and exact ordered results.
    - **Property 10: Reapplying the active filter is idempotent**
    - **Validates: Requirements 5.14, 13.7**

  - [x]* 2.9 Write the property test for query/filter confluence
    - Add exactly one tagged, seeded generated test to `tests/search.test.mjs` from identical reachable states.
    - Assert query-then-filter and filter-then-query end with identical accepted values and ordered result ids.
    - **Property 11: Query and filter application are confluent**
    - **Validates: Requirements 5.15, 13.7**

  - [x]* 2.10 Write the property test for reset idempotence
    - Add exactly one tagged, seeded generated test to `tests/search.test.mjs` over arbitrary reachable browsing states.
    - Assert repeated reset returns the same state/projection as a single reset.
    - **Property 12: Reset is idempotent**
    - **Validates: Requirements 5.16, 13.7**

  - [x]* 2.11 Add focused search examples and a deterministic 500-entry selector check
    - Add examples to `tests/search.test.mjs` for empty/whitespace input, mixed case, combining marks, surrogate pairs, exact 200/201-code-point boundaries, alias/definition/category matches, punctuation-bearing categories, no match, repeated actions, and both action orders.
    - Generate a deterministic 500-entry fixture and verify complete membership/order plus the pure selection timing budget without weakening correctness assertions.
    - _Requirements: 5.1–5.17, 13.7_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Replace the legacy page with the semantic original visual foundation
  - [x] 4.1 Build the semantic static shell and a safe module-entry scaffold
    - Rewrite `index.html` to remove the Studio Nodal presentation, contact form, Google Fonts, Three.js, inline styling, and all legacy/reference identities.
    - Add the first-focus skip link; semantic header/navigation/main/footer landmarks; introduction, browse controls, catalog, contextual-information, and footer in exact source order; one H1; valid H2/H3 nesting; five real navigation destinations; labeled search/radios/reset; persistent visible status and no-results hosts; reusable dialog shell; and return-to-top control.
    - Include original title/description, project identity/purpose/disclaimer, visible static unavailable copy, and `<noscript>` support. Start enhanced controls disabled and load only `styles.css` plus `script.js` as a module.
    - Replace `script.js` with a no-legacy composition scaffold that imports only implemented core modules, safely validates/renders available content, and leaves fallback/readiness state intact until every required controller can be mounted.
    - _Requirements: 1.4, 2.2, 2.7, 3.1–3.11, 7.1, 10.2, 10.3, 10.4, 10.5, 10.13, 10.16, 11.11, 11.12, 11.13, 12.1_

  - [x] 4.2 Create visual tokens, base rules, and the stylesheet entry point
    - Rewrite `styles.css` as an import-only entry point and create `styles/tokens.css` and `styles/base.css` with the approved warm-paper, ink, violet, rust, and focus-blue system; system serif/sans stacks; spacing/type/motion tokens; reset; semantic defaults; fallback/readiness states; and robust text wrapping.
    - Implement a visible 3 px focus treatment, system-font fallback, native scrolling/scrollbars, skip-link behavior, non-color-only states, and contrast-safe base colors without `transition: all`.
    - _Requirements: 2.4, 3.2, 7.12, 7.14, 9.1, 10.1, 10.6, 10.7, 10.8, 11.13, 12.3_

  - [x] 4.3 Implement section, grid, sticky-header, and dialog layout
    - Create `styles/layout.css` and import it after base rules from `styles.css`.
    - Implement the original centered field-notes rail, section spacing, fixed source-order presentation, persistent unobscured Browse access, `minmax(0, 1fr)` catalog grid, fixed decorative geometry, dialog bounds/internal scrolling, 80ch explanation measure, and heading `scroll-margin` for the maximum sticky-header height.
    - Prevent page-level overflow without hiding required content or replacing browser-native scrolling.
    - _Requirements: 2.4, 3.1, 3.5, 3.10, 7.2, 7.12, 9.1, 9.9, 11.10, 12.3_

  - [x] 4.4 Implement control, catalog, detail, status, and footer component styles
    - Create `styles/components.css` and import it after layout rules from `styles.css`.
    - Style the approved navigation, browse controls, native radio filters, result status, cards, no-results panel, dialog/optional sections, related controls, error text, contextual information, and footer with original signal-ring/index motifs.
    - Provide at least 44×44 CSS-pixel primary hit areas, persistent action labels, unclipped focus, checked/selected/error/disabled distinctions, and fine-pointer hover styles that never activate state.
    - _Requirements: 2.4, 3.3, 3.4, 3.6, 3.7, 5.10, 7.9, 7.10, 7.11, 7.13, 7.14, 9.10, 9.11, 10.6, 10.7, 10.8, 10.15, 12.3_

- [x] 5. Implement detail interactions and accessibility coordination
  - [x] 5.1 Implement pure detail, selection, and interaction state transitions
    - Create `scripts/interactions.js` with pure handling for entry open, related open, detail close, menu open, and menu close events without duplicating search ownership.
    - Build exact replacement-only detail projections, optional-section omission, defensive unresolved-relation omission, stable original-opener tracking, and unique selected-control derivation.
    - Return identity states for unavailable/repeated actions and preserve query/filter/result state across interaction events.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 9.12_

  - [x] 5.2 Implement delegated catalog activation and modal detail lifecycle
    - Extend `scripts/interactions.js` with one delegated catalog click path, native button activation semantics, complete detail replacement, related-term controls, and one shared dismissal path for close control and Escape/cancel.
    - Use native `showModal()` when available and an in-project dialog/inert/tab-containment fallback otherwise; focus the title on open and restore the original opener (or stable-id/catalog-heading fallback) on close.
    - Commit DOM and ARIA state before motion, avoid duplicate key/touch/pointer dispatch, and return a cleanup function that removes every listener and fallback attribute.
    - _Requirements: 6.1–6.10, 7.8, 7.9, 7.13, 7.14, 10.10, 10.11, 10.12, 10.17, 10.18, 13.3, 13.4, 13.9_

  - [x] 5.3 Implement live status, focus, constraint-error, and fallback accessibility helpers
    - Create `scripts/accessibility.js` with the singular result-announcement planner, live-region coordinator, heading/skip focus helpers, visible and programmatically associated query-limit errors, modal fallback focus planning, and focus restoration.
    - Update the pre-existing polite atomic status only when ordered result ids change, never move focus for announcements, and avoid duplicate writes for identity/case-only transitions.
    - Keep decorative layers hidden from assistive technology and ensure every helper cleans up temporary ARIA, inert, and tabindex changes.
    - _Requirements: 5.17, 10.3, 10.5, 10.9, 10.10, 10.11, 10.12, 10.13, 10.15, 10.16, 10.17, 10.18_

  - [x]* 5.4 Write the property test for exact detail projection and replacement
    - Add exactly one tagged, seeded generated test to `tests/interactions.test.mjs`, with at least 100 cases.
    - Assert exact selected-entry fields/resolvable relationships and the absence of all prior entry-specific values after replacement.
    - **Property 13: Detail projection is exact and replacement-only**
    - **Validates: Requirements 6.1, 6.8**

  - [x]* 5.5 Write the property test for related navigation and opener preservation
    - Add exactly one tagged, seeded generated test to `tests/interactions.test.mjs` over valid open-detail states and resolvable relationships.
    - Assert that related activation keeps the viewer open, selects exactly the target, and preserves the original catalog opener id.
    - **Property 14: Related navigation selects the referenced entry without changing the opener**
    - **Validates: Requirements 6.4**

  - [x]* 5.6 Write the property test for unique keyed catalog selection
    - Add exactly one tagged, seeded generated test to `tests/interactions.test.mjs` over ordered result ids and selected ids.
    - Assert at most one selected control and exact id equality whenever a control is selected.
    - **Property 15: Catalog selected state is unique and correctly keyed**
    - **Validates: Requirements 6.5**

  - [x]* 5.7 Write the property test for singular non-focusing result announcements
    - Add exactly one tagged, seeded generated test to `tests/interactions.test.mjs` over prior/next ordered result-id sequences.
    - Assert exactly one polite count update and no focus command for changed sequences, and no update for identical sequences.
    - **Property 17: Result announcements are singular and non-focusing**
    - **Validates: Requirements 10.9**

  - [x]* 5.8 Add focused detail and accessibility examples
    - Add examples to `tests/interactions.test.mjs` for empty aliases/relationships, one defensively missing relationship, complete replacement, unresolved entry activation, shared close behavior, disconnected-opener fallback, native/fallback dialog plans, constraint-error association, and exact announcement text.
    - Assert that closing an already closed viewer and repeated/unavailable interactions are identity transitions.
    - _Requirements: 5.17, 6.1–6.10, 10.9–10.18, 13.3_

- [x] 6. Implement navigation and responsive input-mode behavior
  - [x] 6.1 Implement section navigation and compact-menu control
    - Create `scripts/navigation.js` with immediate heading focus plus unobscured scroll, reduced-motion behavior selection, skip-link handling, return-to-top, persistent Browse access, compact disclosure state/ARIA synchronization, Escape restoration, and close-before-navigation.
    - Omit controls whose destination cannot be resolved, close compact navigation when entering expanded layout, and preserve all query/filter/result/detail state during layout changes.
    - Return cleanup for links, keyboard handlers, and media-query listeners.
    - _Requirements: 3.8, 3.10, 7.1–7.7, 7.12, 7.14, 8.12, 9.6, 9.7, 9.12, 10.16, 13.1, 13.2_

  - [x] 6.2 Implement exact responsive, zoom, and coarse-input CSS rules
    - Create `styles/responsive.css` and import it last from `styles.css`.
    - Encode nonoverlapping one-, two-, three-, and four-column ranges at 320–767, 768–1199, 1200–1599, and 1600–2560 CSS pixels; switch navigation below 768 pixels; and keep the compact search input at least 16 CSS pixels.
    - Add fluid gutters, wrapping/min-width protections, compact dialog layout, coarse/touch-only persistent actions, orientation-safe reflow, 200% zoom support, and exact no-horizontal-overflow behavior.
    - _Requirements: 7.9, 7.10, 7.11, 9.1–9.13, 12.3, 13.2, 13.4_

  - [x]* 6.3 Add focused navigation and state-preservation examples
    - Extend `tests/interactions.test.mjs` with examples for menu open/close identity, expanded-state mapping, Escape focus return, close-before-link navigation, missing destinations, reduced-motion scroll selection, expanded-breakpoint closure, and layout/orientation events that leave business state unchanged.
    - Assert one semantic action per keyboard-, touch-, and pointer-generated native click in the controller plan.
    - _Requirements: 3.8, 3.10, 7.1–7.14, 8.12, 9.6, 9.7, 9.12, 13.3, 13.4_

- [x] 7. Implement bounded motion and reduced-motion adaptation
  - [x] 7.1 Implement the approved motion tokens and CSS states
    - Create `styles/motion.css` and update `styles.css` so imports remain tokens, base, layout, components, motion, then responsive.
    - Implement 160 ms feedback, 300 ms state, 560 ms entrance, 70 ms source-order stagger, 18 px card reveal, and 420 ms pointer return using explicit opacity/transform/color properties only.
    - Add final-visible no-delay reduced-motion states, 80 ms color/opacity-only essential feedback, resting pointer decoration, and no translation/rotation/scale under reduced motion.
    - _Requirements: 2.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.10, 8.11, 8.13, 8.14, 12.3, 13.5_

  - [x] 7.2 Implement reveal, pointer-field, visibility, and preference coordination
    - Create `scripts/motion.js` with introduction staging, one `IntersectionObserver` at threshold `0.15`, one-time card reveal, and immediate-visible fallback when observation is unavailable.
    - Implement finite normalized pointer mapping clamped to 18 px, one animation-frame coordinator, pointer-exit return, signal-field intersection eligibility, page-visibility cancellation, and live reduced-motion/fine-pointer changes.
    - Keep controls responsive before animation completion, write only transform variables, cancel all pending work on cleanup, and never start ambient work while hidden, reduced, coarse-pointer-only, or offscreen.
    - _Requirements: 8.4–8.16, 11.14, 13.5, 13.9_

  - [x]* 7.3 Write the property test for bounded pointer displacement
    - Add exactly one tagged, seeded generated test to `tests/interactions.test.mjs` over finite pointer coordinates and positive viewport dimensions.
    - Assert finite per-axis values within the designed 18 px bound and therefore within the required 24 px maximum.
    - **Property 16: Pointer decoration displacement is bounded**
    - **Validates: Requirements 8.7**

  - [x]* 7.4 Add focused motion-planning and lifecycle examples
    - Extend `tests/interactions.test.mjs` with examples for source-order delays, one-time reveal state, observer/matchMedia/requestAnimationFrame capability fallbacks, hidden-page cancellation, pointer rest, live reduced-motion changes, immediate navigation, and cleanup idempotence.
    - Assert that reduced-motion plans contain no entrance transform/delay and only permitted essential color/opacity timing.
    - _Requirements: 8.1–8.16, 11.14, 13.5, 13.9_

- [x] 8. Wire the application through a transactional composition root
  - [x] 8.1 Complete bootstrap, rendering, controller mounting, and cleanup
    - Rewrite the scaffold in `script.js` as the approved `bootstrap(document, rawEntries)` composition root with explicit imports and callbacks, one immutable app-state snapshot, one dispatch/reduce/select/render transaction, and no singleton cross-module state.
    - Validate/index once; render categories, accepted query, count, ordered catalog, no-results state, selected state, and details; then mount navigation, interactions, accessibility, and motion exactly once.
    - Enable controls, hide the fallback, and set readiness only after every required render/mount succeeds. On failure, unwind cleanup in reverse order, leave meaningful static content/fallback visible, and report one actionable root cause.
    - Remove every legacy dependency/behavior, avoid duplicate listeners and announcements, and ensure every user-visible action works from static assets without an application backend.
    - _Requirements: 1.4, 3.4, 3.5, 3.10, 3.11, 4.11, 4.12, 5.1–5.17, 6.1–6.10, 7.1–7.14, 8.15, 9.12, 10.9–10.18, 11.11–11.14, 12.1, 12.4, 13.1_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Add automated browser, accessibility, responsive, and motion validation
  - [x]* 10.1 Configure a finite browser-validation harness
    - Add the minimum browser/audit test tooling required by the approved design as exact-version development dependencies, update the root lockfile, and keep all configuration and outputs beneath Project_Root.
    - Create a reusable test harness under `tests/` that starts a short-lived static server inside the test process, captures `error` and `unhandledrejection` before bootstrap, allocates isolated ports/profiles, and always tears down; do not add a watch mode or persistent development server.
    - Add single-run package commands that can target supported desktop engines/channels and mobile viewport/touch profiles without adding a production dependency.
    - _Requirements: 1.1–1.4, 11.14, 12.8, 12.10, 13.1, 13.8_

  - [x]* 10.2 Add semantic-shell, source-order, and static-fallback browser tests
    - Create a focused browser test file that verifies exact primary-section source order, landmarks, one H1/sequential headings, five valid navigation destinations, metadata, labels, result/live hosts, context/disclaimer, footer identity, skip link, and no orphan navigation controls.
    - Block JavaScript and separately fail module initialization; assert title, purpose, educational context, and unavailable message remain readable with no dependency on an application backend.
    - Verify decorative graphics are hidden, authored strings render as text, and successful initialization removes fallback state only after controls become operable.
    - _Requirements: 1.4, 3.1–3.9, 10.2–10.5, 10.13, 11.11, 11.12, 12.1, 13.1_

  - [x]* 10.3 Add browser tests for search, details, navigation, and equivalent input modes
    - Create a focused browser test file covering term/alias/definition/category search, mixed case, normalized Unicode, whitespace, over-limit input/error recovery, all/each category, repeated filter/reset, both action orders, no results, and both reset controls.
    - Cover complete/optional detail content, related replacement, selected state, close control/Escape, original-opener focus, all section links, return-to-top, compact menu ARIA/Escape/close-before-navigation, and unavailable relationship defense.
    - Run keyboard-only and touch-emulated flows without hover, instrument semantic dispatch to assert exactly one action per activation, and verify fine-pointer hover changes visuals without changing state.
    - _Requirements: 3.10, 3.11, 5.1–5.17, 6.1–6.10, 7.1–7.14, 10.15–10.18, 13.3, 13.4_

  - [x]* 10.4 Add automated accessibility-state and focus validation
    - Create a focused accessibility browser test file for initial, filtered, no-results, compact-menu-open, and dialog-open states using accessibility-tree, keyboard, semantic, and contrast assertions.
    - Verify accessible names/descriptions, 3 px unobscured focus, result announcement singularity, radio/dialog/expanded/controlled relationships, modal focus containment in native and forced fallback paths, focus restoration, hidden decoration, and visible associated limit errors.
    - Add environment-gated automated accessibility-tree jobs for Safari/WebKit and Firefox-compatible paths used by the approved assistive-technology smoke scenarios; fail explicitly rather than reporting an unavailable target as passed.
    - _Requirements: 10.1–10.18, 11.2, 13.1, 13.3_

  - [x]* 10.5 Add responsive, zoom, orientation, and target-size browser tests
    - Create a focused browser test file for widths 320, 767, 768, 1024, 1199, 1200, 1440, 1599, 1600, and 2560 CSS pixels.
    - Assert no page-level horizontal overflow, exact grid tracks, reachable sections/controls, compact/expanded navigation, ≥44×44 primary targets, ≥16 px compact search text, ≤80ch explanations, long-token wrapping, and unclipped focus.
    - Test a 1280×1024 window at 200% zoom and portrait/landscape changes with nondefault query/filter/open-detail state; assert reflow within one second and exact business-state preservation.
    - _Requirements: 9.1–9.13, 10.6, 13.2_

  - [x]* 10.6 Add normal- and reduced-motion browser tests
    - Create a focused browser test file that inspects approved computed timings, source-order starts, 15% one-time reveal, ≤18 px translation, no replay, extreme pointer displacement, pointer return within 500 ms, and first control response within 100 ms.
    - Instrument animation-frame writes and assert zero ambient updates while hidden, reduced, coarse-pointer-only, or offscreen; test reduced motion active before load and toggled at runtime.
    - Inventory transitions/keyframes to reject `transition: all`, disallowed reduced-motion transforms/timing, or a sequence capable of more than two flashes per rolling second.
    - _Requirements: 8.1–8.16, 11.14, 13.5_

  - [x]* 10.7 Add compatibility, fallback, and runtime-resilience browser tests
    - Create a compatibility test file targeting the current and immediately previous desktop Chrome, Edge, Firefox, and Safari configurations plus current mobile Safari and Chrome profiles; report each target distinctly and never convert a skipped required target into success.
    - Force missing native dialog, `inert`, IntersectionObserver, matchMedia, and optional decorative-resource capabilities independently; assert equivalent behavior and exact query/filter/result/selection preservation.
    - Capture initial load, primary scenarios, 60 seconds of post-ready idle, and hide/show cleanup with no uncaught errors or unhandled rejections; confirm no web-font or runtime content request exists.
    - _Requirements: 11.12, 11.13, 11.14, 13.1, 13.2, 13.8, 13.9_

- [x] 11. Add performance, originality, boundary, and release gates
  - [x]* 11.1 Add deterministic interaction and idle performance tests
    - Create `tests/performance.test.mjs` with a deterministic 500-entry repository and measure from query/filter event receipt through count/no-results DOM commit on the defined Test_Device profile; require every acceptance sample to complete within 100 ms.
    - Exercise initial empty-cache behavior, repeated rendering, and 60 seconds of ready-state idle plus hide/show cleanup while capturing errors and outstanding animation work.
    - If any media is introduced, add assertions for dimensions, informative alternatives, and one-viewport lazy-request timing; otherwise assert the foundation remains media-asset free.
    - _Requirements: 5.9, 11.9, 11.10, 11.14_

  - [x]* 11.2 Implement compressed-transfer and repeatable Lighthouse release checks
    - Create a finite `scripts/release-check.mjs` command that serves the same static release candidate temporarily, cleans up on every exit, compresses/sums initially requested resources, and enforces JavaScript ≤100,000 bytes, CSS ≤75,000 bytes, and aggregate transfer ≤1,500,000 bytes.
    - Run three consecutive identical empty-cache mobile audits and fail unless every run reaches performance ≥90, accessibility ≥95, LCP ≤2.5 seconds, CLS ≤0.1, and TBT ≤200 ms.
    - Keep all transient profiles/reports beneath Project_Root during execution and remove them after summarized pass/fail output; never start a persistent server or watcher.
    - _Requirements: 1.1, 1.2, 11.1–11.8, 12.8, 12.10_

  - [x]* 11.3 Implement and execute the project-boundary, structure, originality, and license gate
    - Create `tests/release.test.mjs` to canonicalize and inventory project/spec paths, reject outside or unverifiable paths before mutation, enforce the approved modular files, reject empty asset branches, and verify no generated artifact escapes Project_Root.
    - Scan source, metadata, rendered copy, network requests, and asset inventory for reference-site/legacy branding, copied material indicators, remote fonts/runtime libraries, unexpected third-party media, missing license evidence, and missing attribution; the expected foundation asset inventory is “none.”
    - Generate temporary rendered visual and motion captures beneath Project_Root and review them against the approved Signal & Syntax palette, type, composition, motifs, and choreography—not reference implementation details. Fail the gate and remove/replace offending material rather than automatically adapting it or partially mutating files.
    - _Requirements: 1.1, 1.2, 1.3, 2.1–2.10, 12.1–12.12_

  - [x]* 11.4 Execute the complete release validation and resolve failures
    - Run all finite unit/property suites with the stored seed and at least 100 cases per property, then all browser, accessibility, responsive, motion, compatibility, resilience, performance, boundary, and originality gates against one unchanged release candidate.
    - Require all Browser_Matrix targets and three audit runs to report explicit passes, no serious accessibility issue, no runtime error/rejection, no transfer/timing budget failure, and no originality/license exception.
    - Fix only project-local source/test issues exposed by the gates, rerun affected checks followed by the complete gate, and leave no temporary server, profile, report, empty asset directory, or generated artifact behind. Do not deploy from this task.
    - _Requirements: 1.1–1.4, 2.10, 10.1, 11.1–11.14, 12.10, 13.1–13.9_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test/validation tasks and may be skipped for a faster MVP; core implementation tasks are not optional.
- JavaScript is the implementation language selected by the approved design; browser code uses native ES modules and the project remains a static site with no application backend.
- Every task must resolve all source, destination, generated-output, and configuration paths beneath `/Users/ankitkumar/Desktop/CODE/activity` before changing anything. An outside or unverifiable path cancels the complete operation.
- Each correctness property has one dedicated property-test task. All property tests use at least 100 generated cases, stored seed `0x51a1c0de`, and replayable shrink output.
- All commands are finite single runs. Do not use development servers, watch modes, interactive applications, or persistent browser processes during task execution.
- Implementation should not create `assets/` unless an approved nonempty asset class is actually used with license evidence and any required attribution inside Project_Root.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["1.5", "2.1"] },
    { "id": 5, "tasks": ["1.6", "2.2"] },
    { "id": 6, "tasks": ["1.7", "2.3", "4.1"] },
    { "id": 7, "tasks": ["1.8", "2.4", "4.2"] },
    { "id": 8, "tasks": ["1.9", "2.5", "4.3", "5.1"] },
    { "id": 9, "tasks": ["2.6", "4.4", "5.2"] },
    { "id": 10, "tasks": ["2.7", "5.3", "6.1"] },
    { "id": 11, "tasks": ["2.8", "5.4", "6.2"] },
    { "id": 12, "tasks": ["2.9", "5.5", "7.1"] },
    { "id": 13, "tasks": ["2.10", "5.6", "7.2"] },
    { "id": 14, "tasks": ["2.11", "5.7"] },
    { "id": 15, "tasks": ["5.8"] },
    { "id": 16, "tasks": ["6.3"] },
    { "id": 17, "tasks": ["7.3"] },
    { "id": 18, "tasks": ["7.4"] },
    { "id": 19, "tasks": ["8.1"] },
    { "id": 20, "tasks": ["10.1"] },
    { "id": 21, "tasks": ["10.2"] },
    { "id": 22, "tasks": ["10.3"] },
    { "id": 23, "tasks": ["10.4"] },
    { "id": 24, "tasks": ["10.5"] },
    { "id": 25, "tasks": ["10.6"] },
    { "id": 26, "tasks": ["10.7"] },
    { "id": 27, "tasks": ["11.1"] },
    { "id": 28, "tasks": ["11.2"] },
    { "id": 29, "tasks": ["11.3"] },
    { "id": 30, "tasks": ["11.4"] }
  ]
}
```
