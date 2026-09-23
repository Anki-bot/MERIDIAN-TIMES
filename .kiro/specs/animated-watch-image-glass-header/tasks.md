# Implementation Plan: Animated Watch Image and Glass Header

## Overview

Implement the approved TypeScript/React design incrementally. First preserve and preflight the exact archival PNG master outside `public`; then generate and verify a five-width AVIF primary/WebP fallback set with explicit transfer and decoded-memory budgets. Only after that gate passes may the single responsive `<picture>` hero replace the mounted canvas. Subsequent tasks apply transform-only motion and static glass, preserve existing application behavior, and extend finite browser validation. Every step leaves `components/canvas/WatchMovementCanvas.tsx`, integrity-protected watch CSS blocks, and historical specs unchanged.

## Tasks

- [x] 1. Establish the mandatory archival-master and derivative contract
  - [x] 1.1 Gate all implementation on the preflighted user-provided master
    - Require the exact user source at project-relative `source/assets/elite-watch-master.png`; treat `/Users/ankitkumar/Desktop/CODE/activity` as canonical project-root casing and do not move, copy, rewrite, re-encode, or expose the master under `public`.
    - Before any production UI/code change, verify PNG signature/MIME, SHA-256, byte length, dimensions, decoded pixel count and RGBA memory, aspect ratio, bit depth/color model, embedded color/profile chunks, alpha range/counts, interlace state, chunk CRCs, zlib/scanline decode, and native decode health.
    - Visually inspect the exact hashed bytes and require a single clean watch close-up with no baked header, search, MEN/WOMEN controls, graph nodes/labels, border, watermark, collage, or reference panel.
    - Record the exact source evidence, centered compact/expanded focal points, pending responsive derivative plan, transfer/decoded-memory budgets, and future 2.5D provenance fields in `data/watch-image-asset.json`.
    - Run the untouched finite baseline: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test -- tests/spec-integrity.test.ts`; account for current lifecycle scripts without weakening them.
    - Reconcile this feature’s `requirements.md`, `design.md`, and `tasks.md` from the rejected public single-WebP/6-MiB model to the immutable master plus responsive AVIF/WebP architecture. Format-validate every changed spec and preserve coherent task IDs/dependencies.
    - If source identity/decode/visual cleanliness, baseline health, spec format, or protected integrity fails, stop this task and all dependent tasks. Do not fabricate, download, optimize, or substitute an asset.
    - _Requirements: 1.1–1.7, 1.13, 1.16, 1.17_

  - [x] 1.2 Generate responsive derivatives and implement the blocking local verifier
    - Add `scripts/build-watch-image-assets.mjs` that reads only the hash-verified master and deterministically emits AVIF and WebP at 690×376, 1035×564, 1380×752, 2070×1128, and 2760×1504 under `public/assets/watch`, with no crop/upscale/overlay/segmentation and no master mutation.
    - Encode presentation outputs as sRGB RGB using the reviewed manifest settings: AVIF quality 72/effort 6/4:4:4 and WebP quality 86/effort 6/smart subsampling. Perform zero network requests.
    - Inspect finalized bytes, record each derivative’s path, MIME, SHA-256, byte length, dimensions, decoded pixels/memory, and encoder settings in `data/watch-image-asset.json`, then set contract status to `ready` only when all ten entries are complete.
    - Add `scripts/verify-watch-image-assets.mjs` with strict unknown-field, canonical-path, PNG/AVIF/WebP signature, MIME, hash, length, dimension/aspect, source-set completeness, encoder-contract, transfer-budget, decoded-memory-budget, aggregate-budget, provenance, and input-nonmutation validation.
    - Return deterministic failure codes, never regenerate during verification, and reject an absolute/remote/data/traversal/master-public path.
    - Add `build:watch-images`, `verify:watch-images`, and `predev`/`pretest`/`prebuild` wiring to `package.json`, ensuring verification completes before each lifecycle’s main command.
    - _Requirements: 1.5–1.15, 9.1_

  - [x]* 1.3 Write unit and boundary tests for the source/derivative contract
    - Create `tests/watch-image-asset-contract.test.ts` for missing/invalid source, pending/malformed manifests, invalid signatures/MIME, incomplete or altered derivatives, exact and one-unit-over transfer/decode/aggregate budgets, canonical paths, lifecycle ordering, zero network, input nonmutation, and the real checked-in set.
    - Add generator tests for exact dimensions/aspect, no upscale/crop, sRGB RGB output, stable manifest records, and immutable master bytes. Keep fixtures synthetic and clearly non-hero; no fixture may become a runtime fallback.
    - _Requirements: 1.1–1.17_

  - [x]* 1.4 Write the property test for source-and-derivative gate soundness
    - Create `tests/watch-image-asset.property.test.ts` with at least 100 deterministic fast-check runs over consistent contracts, invalid signatures/paths, source-set membership changes, one-byte/field mutations, boundary budgets, and input nonmutation.
    - **Property 1: Source-and-derivative gate soundness and nonmutation**
    - **Validates: Requirements 1.8–1.15**
    - Tag the test `Feature: animated-watch-image-glass-header, Property 1: Source-and-derivative gate soundness and nonmutation`.

- [x] 2. Checkpoint — verify the complete image-asset gate
  - Require manifest status `ready`, ten valid derivatives, `npm run verify:watch-images`, unit/property tests, and unchanged protected integrity before production UI implementation.
  - Stop if Task 1.1 is blocked, any derivative is absent/over budget, the master changed, or lifecycle ordering fails.

- [x] 3. Add and mount the single responsive image-backed hero
  - [x] 3.1 Create `WatchImageBackdrop`
    - Add `components/ui/WatchImageBackdrop.tsx` with typed `definitionOpen` and `reducedMotion` props and one-way loading/ready/error state.
    - Render exactly one decorative `<picture>` and one `<img>`: manifest-backed AVIF primary `srcset`, WebP fallback `src`/`srcset`, width descriptors, and `sizes="100vw"`. Never emit or request the archival PNG master.
    - Use empty alt text, high fetch priority, asynchronous decoding, and no focus/pointer behavior.
    - Render no placeholder or alternate source while loading; on failure expose a concise alert over a dark-neutral shell while keeping the rest of the experience mounted.
    - Expose deterministic state data attributes without pointer tracking, animation-frame callbacks, timers, intervals, or observers.
    - Keep future 2.5D compatibility metadata out of runtime rendering; no layer/depth segmentation is part of this task.
    - _Requirements: 2.1–2.9, 2.11, 4.1, 4.8–4.12, 8.1, 8.2, 8.9_

  - [x] 3.2 Replace only the landing-page canvas mount
    - In `components/EliteWatchesExperience.tsx`, replace the `WatchMovementCanvas` import/mount with one `WatchImageBackdrop` receiving existing selected-term and reduced-motion state.
    - Preserve every state variable, callback, semantic header element, link text/order/destination, child prop, and sibling order.
    - Do not edit, move, delete, copy, or conditionally retain `components/canvas/WatchMovementCanvas.tsx`; do not edit historical specs.
    - _Requirements: 2.10, 5.1–5.12, 7.1–7.13, 9.9, 9.11_

  - [x]* 3.3 Write the sole-responsive-hero property test
    - Create `tests/watch-image-sole-medium.property.test.tsx` with at least 100 deterministic combinations of load, dialog, reduced-motion, viewport, and AVIF-capability state.
    - **Property 2: Sole responsive hero-medium invariant**
    - **Validates: Requirements 2.1–2.5, 2.10, 9.2**
    - Tag the test `Feature: animated-watch-image-glass-header, Property 2: Sole responsive hero-medium invariant`.

  - [x]* 3.4 Write the static-mode and whole-image property test
    - Create `tests/watch-image-mode.property.test.tsx` with at least 100 generated load/preference/dialog combinations and assertions for the mode truth table, zero reduced-motion animation, and one shared image transform owner.
    - **Property 4: Static mode and whole-image transform invariant**
    - **Validates: Requirements 4.8, 4.11**
    - Tag the test `Feature: animated-watch-image-glass-header, Property 4: Static mode and whole-image transform invariant`.

  - [x]* 3.5 Write component examples and error-state tests
    - Create `tests/watch-image-backdrop.test.tsx` for one picture/img, exact AVIF/WebP sets and fallback, no master URL, decorative semantics, load transition, definition-open pause state, opacity state, runtime error alert, no substitute request, and continued control operability.
    - _Requirements: 2.1–2.9, 4.1, 4.8, 4.9, 4.12, 8.9_

- [x] 4. Implement responsive image motion, static glass, and readability styles
  - [x] 4.1 Apply one coordinated non-protected CSS change
    - In `app/globals.css`, add `.watch-image-backdrop`/picture/image styles, centered focal variables, `object-fit: cover`, the 28-second transform-only keyframes, declared limits, ready/error/static states, and reduced-motion defense.
    - Adjust `.cinematic-vignette` into one static pointer-transparent scrim with at least 0.62 dark alpha behind the complete masthead and restrained edge/bottom gradients.
    - Restyle `.site-masthead` as the centered inset rounded smoke bar while retaining 68/60-pixel heights, responsive link visibility, exact wordmark centering, 44-pixel targets, focus/hover, contrast fallbacks, and forced-colors behavior.
    - Remove both backdrop-filter spellings from every Audited_Overlay and replace them with static gradients, borders/highlights, and shadows without changing search/dialog geometry or content.
    - Add no background-position/filter/material animation, duplicate render tree, or per-layer watch styling.
    - Do not alter any protected `.watch-canvas-shell`, `.watch-static-fallback`, or `.static-*` block.
    - _Requirements: 3.1–3.9, 4.2–4.9, 5.6–5.12, 6.1–6.12, 7.13, 8.1–8.9, 9.2_

  - [x]* 4.2 Write the responsive source, focal, and cover-safe motion property test
    - Create `tests/watch-image-motion.property.test.ts` with at least 100 generated widths from 320–2560, format capabilities/candidate classes, and progress values across every keyframe segment.
    - **Property 3: Responsive source, focal point, and cover-safe motion**
    - **Validates: Requirements 3.1–3.6, 4.3–4.7**
    - Tag the test `Feature: animated-watch-image-glass-header, Property 3: Responsive source, focal point, and cover-safe motion`.

  - [x]* 4.3 Write the static-material source-safety property test
    - Create `tests/static-overlay-material.property.test.ts` to parse every masthead stop, Audited_Overlay block, and referenced animation with at least 100 generated rule-selection/order combinations.
    - **Property 5: Static material source safety**
    - **Validates: Requirements 6.1, 6.8, 6.9**
    - Tag the test `Feature: animated-watch-image-glass-header, Property 5: Static material source safety`.

  - [x]* 4.4 Write focused CSS, header, preference, and layout tests
    - Create `tests/animated-watch-glass-contract.test.ts` for motion timing/bounds, one-pixel edge/highlight, shadow budget, scrim alpha, inset/radius/height, no forbidden effects, and protected-selector exclusion.
    - Add compact/expanded browser-layout assertions for visible links, centered wordmark, target sizes, search clearance, overflow, contrast, focus, reduced transparency, increased contrast, and forced colors.
    - _Requirements: 3.7–3.9, 4.2, 4.6, 5.1–5.12, 6.2–6.12, 7.13, 8.5, 8.8_

- [x] 5. Checkpoint — verify hero and glass behavior
  - Ensure all component/property/CSS tests pass and confirm the protected integrity manifest before browser-smoke changes.
  - Confirm runtime markup has no archival-master URL and one responsive picture tree.

- [x] 6. Lock preserved application behavior
  - [x]* 6.1 Migrate the existing preservation test to the picture boundary
    - Update `tests/glass-header-hover-preservation.test.tsx` to mock `WatchImageBackdrop` and observe definition/reduced-motion data attributes instead of mocking the canvas.
    - Retain the exact header landmark/link table, one activation, geometry, focus, forced-colors, audience selection, term opening, close, and focus-restoration assertions.
    - _Requirements: 2.10, 5.1–5.12, 6.6–6.12, 7.1–7.10, 8.5–8.8_

  - [x]* 6.2 Write the graph and responsive-state preservation property test
    - Create `tests/animated-watch-preservation.property.test.tsx` with at least 100 deterministic audience/selection/preview/reduced-motion/width combinations, including 700-to-701 transitions and native candidate changes.
    - Compare edge IDs, emphasis, one-SVG/particle cardinality, control names/states, and retained application state with the existing graph model.
    - **Property 6: Graph and responsive-state preservation**
    - **Validates: Requirements 7.5, 7.11, 9.11**
    - Tag the test `Feature: animated-watch-image-glass-header, Property 6: Graph and responsive-state preservation`.

  - [x]* 6.3 Add cross-component integration and failure tests
    - Create `tests/animated-watch-experience.test.tsx` for search keyboard selection/clear, focus-over-hover, audience persistence, locked/enabled brand activation, dialog Escape/focus restoration, image-error operability, reduced-motion operability, and breakpoint state retention.
    - Assert dictionary, graph labels/relationships, search placeholder, browse instruction, and definition content remain unchanged.
    - _Requirements: 2.8–2.10, 7.1–7.13, 8.4–8.9_

- [x] 7. Extend finite production-browser validation
  - [x]* 7.1 Migrate and extend the atlas browser smoke
    - Update `scripts/atlas-visibility-smoke.mjs` readiness/layer observations from WebGL/fallback selectors to exact responsive image state, with no retained canvas readiness branch.
    - Verify one picture/img, zero hero canvas/video, zero master request, exactly one selected derivative request, HTTP 200 AVIF-or-WebP MIME, transfer/decode budgets, manifest dimensions, compact/expanded cover/focal geometry, and no unpainted motion edge.
    - Verify no audited computed backdrop filter, reduced-motion stasis, layer ordering, and all center-point hit tests.
    - Retain three warmed MEN interaction samples and per-sample 100-millisecond response/task/blocking limits.
    - Add the finite 120-frame probe, emit raw intervals before assertions, require at least 95 percent at or below 25 milliseconds, and cap every interval at 100 milliseconds.
    - Preserve finite timeouts, runtime/console/hydration/network evidence, cleanup, and local-browser-only execution.
    - _Requirements: 2.1–2.5, 3.1–3.9, 4.1–4.9, 5.6–5.12, 6.2–6.12, 8.1–8.9, 9.3–9.12_

  - [x]* 7.2 Update the browser-smoke source contract
    - Update `tests/atlas-smoke-contract.test.ts` to require responsive-image readiness, AVIF/WebP source sets, no master request, selected-resource budgets, compact/expanded checks, one hero tree, no canvas branch, preserved graph budgets, 120-frame algorithm, per-sample thresholds, raw failure evidence, and cleanup.
    - Reject arbitrary sleeps, averages, retries, background substitutions, eager downloading of all candidates, or weakened existing interaction assertions.
    - _Requirements: 1.12, 2.1–2.5, 4.10, 8.4, 9.2–9.12_

- [x] 8. Final checkpoint — validate the complete migration
  - Run `npm run verify:watch-images`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run smoke:atlas`, and the unchanged targeted integrity test only after manifest status is `ready`.
  - Confirm source/derivative hashes and budgets, one selected browser request, no archival-master request, no production code outside the approved map, and byte-for-byte Protected_Artifact preservation.

## Notes

- Tasks marked `*` are optional automated-test tasks only when explicitly choosing a faster MVP; the archival-source gate, derivative set, blocking verifier, and responsive runtime architecture are mandatory.
- Task 1.1 approves only the immutable source and architecture. Derivatives remain pending until Task 1.2; production UI tasks stay blocked until Task 2 passes.
- The archival master is intentionally not constrained to 6 MiB and is never served. Browser derivatives have explicit per-file, selected-resource, aggregate-transfer, pixel, and decoded-memory budgets.
- Property tests use at least 100 runs and a documented reproducible seed.
- Browser timing remains a finite integration test, not a property test.
- No task deploys, gathers production metrics, modifies the archival master, implements 2.5D segmentation, edits protected canvas/history, or performs user acceptance testing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4"] },
    { "id": 3, "tasks": ["2"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4", "6.1", "6.2", "6.3"] },
    { "id": 7, "tasks": ["5"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["7.2"] },
    { "id": 10, "tasks": ["8"] }
  ]
}
```
