# Implementation Plan: Premium Frosted-Glass Header

## Overview

Implement the approved glass-header design as an isolated CSS enhancement to the existing Next.js ELITE WATCHES masthead. Preserve the current JSX semantics, destinations, paint-plane architecture, watch rendering, and application state; progressively enhance the base opaque surface when backdrop filtering is available, then validate fixed semantics, responsive geometry, browser fallbacks, contrast, and project integration. The implementation language remains the project's existing TypeScript/TSX and CSS.

## Tasks

- [x] 1. Implement the premium glass-header material and responsive foreground
  - [x] 1.1 Update the existing masthead styles in `app/globals.css`
    - Add named header material tokens for the high-opacity fallback, enhanced translucent tint, light divider, inset highlight, restrained shadow, dark navigation foreground, burnished-gold brand foreground, blur, and saturation.
    - Make the high-opacity neutral surface the base `.site-masthead` style, then add one `@supports` branch accepting standard or WebKit-prefixed backdrop filtering and apply the bounded enhanced values from the design.
    - Add reduced-transparency, increased-contrast, and forced-colors branches that restore readable opaque or system-color presentation without changing header content or geometry.
    - Preserve the current z-index, absolute positioning, 68 px expanded height, 60 px compact height, link destinations, hover underline, and viewport-centered wordmark.
    - Refine navigation and wordmark foregrounds for the required 4.5:1 contrast, preserve the global focus indicator, and prevent glow or blurred text treatment.
    - Correct compact target sizing so every visible COLLECTION and LOGIN link remains at least 44 by 44 CSS pixels at 390 px and narrower widths; tune compact spacing/type only as needed to prevent wordmark overlap and horizontal overflow at 320 px.
    - Keep the Material_Effect static and scoped to `.site-masthead`; do not add JavaScript, React state, animation, `will-change`, duplicate backdrop layers, SVG filters, canvas copies, or a production dependency.
    - Leave `components/EliteWatchesExperience.tsx`, watch movement files, `app/layout.tsx`, and `.kiro/specs/ai-coding-dictionary-inspired-site/` unchanged.
    - _Requirements: 1.1–1.10, 2.1–2.10, 3.1–3.10, 4.1–4.10, 5.1–5.12, 6.1–6.10, 7.1–7.6, 7.8–7.9_

  - [x]* 1.2 Add finite structural and semantic regression tests
    - Create `tests/glass-header.test.tsx` using the existing Vitest, JSDOM, and Testing Library configuration.
    - Render `EliteWatchesExperience` and assert the single header, two named navigation landmarks, exact existing labels/destinations, centered Brand_Link accessible name, focus order, and lack of duplicate interactive elements.
    - Read the authored stylesheet as test fixture data and assert fallback-before-enhancement ordering, standard and prefixed filter declarations, bounded material values, static material behavior, preference/forced-color branches, 44 px compact targets, and masthead-only filter scope.
    - Add WCAG contrast calculations for opaque navigation/brand tokens against the opaque fallback token; reserve final enhanced composite contrast for browser tests.
    - Assert package runtime dependencies, watch movement source, layout metadata, and Historical_Spec hashes are unchanged by the implementation change set.
    - _Requirements: 1.1–1.5, 1.7–1.10, 2.2–2.4, 2.6–2.10, 3.1–3.2, 3.10, 4.2, 6.1–6.5, 6.7, 6.9, 7.1–7.6_

- [x] 2. Add finite browser validation for compositing and responsive modes
  - [x]* 2.1 Configure a development-only browser test harness
    - Add a finite, non-watch browser test command and minimal configuration under `tests/browser/`; reuse an approved existing harness if one is present at implementation time, otherwise add the chosen harness as an exact-version development dependency with lockfile coverage.
    - Start and stop the Next.js test server inside the harness lifecycle, use isolated ports, and guarantee teardown after success or failure; do not add a persistent development-server or watch command.
    - Provide deterministic switches or fixtures for WebGL/static movement and enhanced/opaque fallback presentation without changing production behavior.
    - _Requirements: 4.1, 4.4–4.8, 7.7–7.9_

  - [x]* 2.2 Write glass-header browser, visual, responsive, and accessibility tests
    - Create `tests/browser/glass-header.spec.ts` with representative widths 320, 390, 700, 701, 1440, and 2560 CSS pixels plus a 1280-by-1024 window at 200 percent zoom.
    - Assert 68/60 px height contracts, exact visible link sets, full-width coverage, viewport-centered brand within one pixel, no label/brand overlap, no page-level horizontal overflow, unobscured search placement, and minimum 44-by-44 target boxes.
    - Exercise enhanced, unsupported-filter/opaque, WebKit-prefixed, reduced-transparency, increased-contrast, forced-colors, WebGL, and Static_Movement scenarios available to the harness.
    - Verify direct backdrop transmission in enhanced mode, fixed material values over time, bounded divider/highlight/shadow styles, and readable opaque fallback presentation.
    - Sample final composited states or use approved image/contrast assertions to enforce 4.5:1 Navigation_Label and Brand_Link contrast plus 3:1 divider/Focus_Indicator contrast.
    - Keyboard-focus, fine-pointer hover, click, and touch-activate visible links; assert unclipped focus, underline behavior without hover activation, one navigation action per activation, and unchanged application state after orientation changes.
    - Record deterministic visual snapshots for compact, expanded, static movement, opaque fallback, and accessibility preference states without relying on manual acceptance steps.
    - _Requirements: 1.6–1.9, 2.1–2.9, 3.3–3.9, 4.1–4.10, 5.1–5.12, 6.2–6.3, 6.6, 6.8, 6.10, 7.7–7.9_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional automated-test enhancements and can be skipped for a faster visual MVP.
- No property-based test tasks are included because the approved correctness analysis classifies this declarative UI feature as finite example, edge-case, smoke, and browser-integration behavior.
- The core implementation is one localized stylesheet task; no JSX, watch-rendering, metadata, runtime dependency, or historical-spec change is expected.
- Browser commands must be finite single runs. Development servers and watch processes are not implementation tasks.
- Every task references specific acceptance criteria for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] }
  ]
}
```
