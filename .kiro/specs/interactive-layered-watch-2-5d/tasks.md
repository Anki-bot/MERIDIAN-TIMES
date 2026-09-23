# Implementation Plan: Interactive Layered Watch 2.5D

## Overview

Implement the approved TypeScript/React and Node ESM design as a fail-closed enhancement over the completed responsive-image predecessor. Work proceeds through immutable-baseline, authored-asset, source-space, runtime, and release gates. The existing `WatchImageBackdrop` fallback remains authoritative until a complete profile passes every objective check and every required hash-bound approval record. A `fallback-only` package and a package with zero approved moving parts are valid outcomes; no task may infer, fabricate, or enable motion merely to populate the enhancement.

## Tasks

- [x] 1. Lock the predecessor baseline and successor extension boundary
  - [x] 1.1 Create immutable-boundary contract helpers
    - Add `scripts/watch-2-5d/contract.mjs` exports for canonical project-relative paths, the approved master identity, predecessor manifest identity, dependency-field snapshots, protected artifact membership, safe regular-file checks, pre/post hashing, and deterministic failure objects.
    - Reject absolute, remote, data-scheme, traversal, symlink, unapproved-public, and out-of-root paths without modifying any inspected input; keep `source/assets/elite-watch-master.png` outside `public`.
    - Complete when repeated snapshots are byte-identical, a mutated fixture returns the expected stable identity/path failure, and no helper performs network or filesystem writes.
    - _Requirements: 1.1–1.7, 1.10–1.12, 2.1, 2.6, 2.7, 2.13, 2.15, 13.12, 13.13_

  - [x] 1.2 Extend protected integrity coverage without changing protected files
    - Update `tests/helpers/integrity-manifest.ts`, the explicitly reviewed integrity fixture in `tests/fixtures/`, and `tests/spec-integrity.test.ts` so every file under `.kiro/specs/animated-watch-image-glass-header/`, `components/canvas/WatchMovementCanvas.tsx`, all existing protected CSS blocks, the canonical master identity, predecessor asset contract, and dependency fields are checked.
    - Preserve all existing integrity entries and assertions; add the predecessor spec as a protected set rather than replacing or weakening historical coverage.
    - Complete when `npm test -- tests/spec-integrity.test.ts` passes against the approved bytes and fails deterministically after a one-byte fixture mutation.
    - _Requirements: 1.3, 1.7–1.9, 1.12, 13.11, 13.15_

  - [x] 1.3 Add focused baseline and scope-boundary tests
    - Create `tests/watch-2-5d/baseline-contract.test.ts` for canonical-master identity/nonmutation, predecessor manifest field/hash equality, `segmentationApplied: false` preservation, dependency equality, safe-path rejection, protected-set completeness, and successor-directory isolation.
    - Instrument network and filesystem mutators so contract inspection fails the test on any network request or input write.
    - Complete when the real checked-in baseline passes and each one-field, one-path, and one-byte mutation returns its documented first-failure code.
    - _Requirements: 1.1–1.12, 2.6, 2.7, 2.13, 2.15, 13.12, 13.13, 13.15_

  - [x] 1.4 Write the property test for immutable predecessor and isolated successor boundaries
    - Create `tests/watch-2-5d/property-01-immutable-boundary.property.test.ts` with one fast-check property over successful and failing pipeline/gate operations, successor mutations, unsafe paths, and protected-input mutations.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 1: Immutable predecessor and isolated successor boundary`.
    - Complete when generated operations leave every protected byte unchanged and every out-of-bound mutation is rejected without side effects.
    - **Property 1: Immutable predecessor and isolated successor boundary**
    - **Validates: Requirements 1.2, 1.3, 1.6, 1.7, 1.8, 1.10, 1.11, 1.12, 2.6, 2.7, 2.13, 2.15, 13.12, 13.13, 13.15**

- [x] 2. Establish strict authored schemas and a safe fallback-only seed
  - [x] 2.1 Implement canonical schemas and serialization
    - Extend `scripts/watch-2-5d/contract.mjs` and add `scripts/watch-2-5d/canonical-json.mjs` with strict unknown-field-rejecting schemas for authoring data, masks, layers, reconstruction, provenance, approvals, motion, depth, phases, complete package manifests, public assets, runtime manifests, and release pointers.
    - Enforce stable unique IDs, canonical 2760×1504 coordinates, half-open bounded rectangles, finite numeric values, strict UTC timestamps, lowercase SHA-256 values, canonical JSON key ordering, and the approved semantic/method/failure-code enumerations.
    - Complete when canonical serialization is byte-stable and malformed, extra-field, duplicate-ID, nonfinite, out-of-bounds, or unsupported-class fixtures fail with deterministic schema codes.
    - _Requirements: 2.1–2.5, 2.8–2.12, 3.1–3.6, 4.2–4.6, 5.2–5.10, 6.1, 6.12, 6.13, 7.2–7.5, 13.2–13.4, 13.17, 14.5, 14.10_

  - [x] 2.2 Create the fallback-only authored and release records
    - Create `source/assets/watch-2-5d/v1/authoring.json` with source identity, phase records, an empty approved-moving set, depth disabled, and explicit authored-interpretation language; create `data/watch-layer-release.json` as the discriminated `fallback-only` form with no successor URL.
    - Create approved non-public directories for masks, reconstruction, approvals, and review artifacts without copying the canonical master or generating public successor imagery.
    - Complete when the strict schema accepts the records, the release contains no runtime-manifest path, and a source scan proves zero claim that hidden pixels, geometry, depth, or mechanisms came from the flat source.
    - _Requirements: 2.1, 2.2, 2.7, 2.11, 2.12, 5.11, 7.1, 10.13–10.15, 14.1, 14.2, 14.5, 14.6, 14.9, 15.13, 15.14_

  - [x] 2.3 Implement provenance and approval-record input tooling
    - Add `scripts/watch-2-5d/approval-records.mjs` and `scripts/generate-watch-layer-approval-template.mjs` to compute exact artifact/evidence hashes, emit canonical pending templates, and validate reviewer-supplied segmentation, reconstruction, pivot, motion, depth, fidelity, and release decisions.
    - Require reviewer, UTC review time, exact artifact hashes, layer IDs, pose IDs, 100%/200% zoom evidence where applicable, decision scope, and notes; template generation must never convert `pending` to `approved` or make a visual decision.
    - Invalidate approval closure whenever any bound artifact or evidence hash changes, and keep absent/rejected approvals static or fallback-only.
    - Complete when a hash-matching approved fixture closes, stale/partial/pending/rejected fixtures remain non-releasable, and empty approved-moving data remains valid.
    - _Requirements: 2.3–2.5, 2.14, 3.14, 4.4–4.6, 4.10, 5.10, 6.12, 6.13, 7.5, 13.4, 14.5, 14.10_

  - [x] 2.4 Add schema, fallback-only, provenance, and approval examples
    - Create `tests/watch-2-5d/authored-contract.test.ts` covering exact canonical serialization, unknown fields, all unsafe path classes, provenance ancestry, synthetic labeling, approval invalidation, fallback-only zero-resource shape, phase hashes, and empty approved-moving behavior.
    - Include synthetic fixtures only; no fixture may be promoted to a production watch mask, fill, approval, or runtime asset.
    - Complete when valid examples round-trip byte-identically and every malformed relationship fails at the expected code without changing a fixture.
    - _Requirements: 2.1–2.14, 3.9–3.14, 4.3–4.6, 4.10–4.12, 5.10, 5.11, 13.2–13.4, 14.5, 14.10_

  - [x] 2.5 Write the property test for manifest, provenance, approval, and release closure
    - Create `tests/watch-2-5d/property-02-manifest-closure.property.test.ts` with one fast-check property over generated artifact DAGs, IDs, hashes, parent links, classifications, approvals, relationships, phase projections, and release references.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 2: Manifest, provenance, approval, and release closure`.
    - Complete when eligibility is equivalent to full referential/hash closure and any generated broken edge makes the package ineligible.
    - **Property 2: Manifest, provenance, approval, and release closure**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.9, 2.10, 2.11, 2.14, 3.14, 4.3, 4.4, 4.5, 4.6, 4.10, 5.10, 6.12, 6.13, 14.5, 14.10**

- [x] 3. Checkpoint — validate the immutable and fallback-only foundation
  - Run the targeted integrity, baseline-contract, authored-contract, and Properties 1–2 tests; validate `authoring.json` and `data/watch-layer-release.json` directly with the strict modules.
  - Proceed only when predecessor bytes and dependency fields are unchanged, the canonical master remains non-public, and fallback-only produces no successor URL or resource request. A fallback-only result is a successful checkpoint.
  - _Requirements: 1.1–1.12, 2.1–2.15, 10.13–10.15, 13.12–13.15, 14.1, 14.2, 14.9_

- [x] 4. Build local candidate inspection and deterministic review evidence
  - [x] 4.1 Implement the finite local candidate inspector
    - Create `scripts/inspect-watch-layer-candidates.mjs` and `scripts/watch-2-5d/review-evidence.mjs` to validate the canonical source before/after execution, read only reviewer-authored candidate rectangles, and generate deterministic 100%/200% crops, contact sheets, alpha/edge overlays, and a canonical hash index under `source/assets/watch-2-5d/v1/review/`.
    - Disable network access, reject unsafe or non-regular inputs, bound decode dimensions and output paths, and label edge/contrast output as reviewer aids rather than semantic inference.
    - Complete when two runs from identical inputs produce identical evidence hashes, source bytes remain unchanged, and no candidate status or approval is changed by the tool.
    - _Requirements: 1.2, 2.4–2.7, 2.10, 2.13–2.15, 3.9–3.11, 13.12, 13.13_

  - [x] 4.2 Encode the initial static candidate inventory and generate evidence
    - Extend `source/assets/watch-2-5d/v1/authoring.json` with stable review-zone IDs for the upper-right spoked wheel, left copper wheel, center-right copper wheel, lower-left balance/spring-like assembly, and right-edge train described by the design.
    - Record every zone as proposed-but-static with possible classes and uncertainty notes; do not create central/subdial hands, pivots, tooth counts, relationships, masks, fills, or approvals not supplied by reviewed authored inputs.
    - Run the inspector to materialize the hash-indexed evidence and verify all outputs are outside `public` and trace back only to the canonical master plus authored rectangles.
    - Complete when every initial zone has reproducible evidence while the approved-moving list remains empty and the release remains fallback-only.
    - _Requirements: 2.3–2.7, 2.10–2.12, 3.9–3.11, 5.2, 5.7–5.11, 6.12, 6.13_

  - [x] 4.3 Add inspector isolation and reproducibility tests
    - Create `tests/watch-2-5d/candidate-inspector.test.ts` for source identity, path confinement, zero network, input nonmutation, deterministic crop/overlay/index bytes, bounded decoding, duplicate IDs, out-of-bounds rectangles, and static-default behavior.
    - Assert that generated evidence cannot satisfy an approval scope by itself and that missing candidate files leave the fallback-only package valid.
    - Complete when synthetic image fixtures cover success and each deterministic failure path and the real source inspection reproduces its committed index.
    - _Requirements: 1.2, 2.6, 2.7, 2.10, 2.13–2.15, 3.9–3.11, 5.7, 5.11, 13.12, 13.13_

- [x] 5. Integrate canonical masks, reconstruction inputs, and hash-bound review records
  - [x] 5.1 Implement source-space mask and compositing primitives
    - Create `scripts/watch-2-5d/image-operations.mjs` for strict 8-bit canonical mask decoding, alpha-preserving extraction, tight bounds, edge bands, ordered overlap, source-visible/synthetic counts, swept boundaries, mask union/intersection/difference, reconstructed-background composition, and small-raster oracle output.
    - Keep all coordinates in the 2760×1504 master space and classify every non-source pixel as synthetic.
    - Complete when deterministic synthetic fixtures prove antialias retention, half-open bounds, z-order, count accuracy, footprint replacement, and no write outside a supplied staging directory.
    - _Requirements: 3.1–3.7, 3.12, 3.13, 4.1–4.4, 4.7–4.9, 4.13, 4.14, 8.5, 13.3_

  - [x] 5.2 Implement the authored mask/reconstruction loader
    - Add `scripts/watch-2-5d/authoring-loader.mjs` to ingest zero or more reviewer-authored canonical masks, reconstruction masks, RGBA fills, pivots, motion declarations, provenance records, and approvals from `source/assets/watch-2-5d/v1/`.
    - Validate media signatures, dimensions, alpha, source rectangles, four-pixel reconstruction feather limit, regular-file paths, parent hashes, classification, and scope-specific approval closure before exposing normalized records to the builder.
    - Downgrade ambiguous, incomplete, stale, or unapproved candidates to static; never generate production masks, fills, pivots, or approvals as substitutes.
    - Complete when the empty authored set normalizes successfully and every incomplete nonempty candidate is excluded from `approved-moving` with a stable reason.
    - _Requirements: 2.3–2.14, 3.1–3.14, 4.2–4.6, 4.9–4.11, 5.1–5.11, 6.1, 6.12, 6.13_

  - [x] 5.3 Generate hash-bound segmentation, reconstruction, pivot, and extreme-pose evidence
    - Extend `scripts/watch-2-5d/review-evidence.mjs` to render exact mask edges, source/reconstructed comparisons, residual-silhouette diagnostics, approved-change overlays, pivot markers, reference pose, and every declared motion/depth extreme at required zooms.
    - Feed the evidence index into `generate-watch-layer-approval-template.mjs`; emit pending templates only and require separately supplied decisions to match every current hash and pose ID.
    - Complete when any changed mask/fill/pivot/profile regenerates a different evidence hash and invalidates the corresponding approval record.
    - _Requirements: 3.8, 3.10, 3.11, 3.14, 3.15, 4.5, 4.6, 4.10, 4.11, 5.3–5.10, 8.3, 8.13, 13.4, 13.6, 13.7_

  - [x] 5.4 Wire the production authored package through the evidence/approval boundary
    - Connect `authoring.json` to any explicitly supplied regular mask, fill, and approval files; regenerate the canonical evidence index and normalized package inputs without synthesizing missing visual data.
    - Require exact approved records before changing a candidate from static to `approved-moving`; if no candidate closes every required scope, retain an empty moving set and fallback/reference pose as a passing result.
    - Complete when normalized output contains only hash-closed reviewed artifacts, all unapproved candidates remain static, and no public/runtime asset has yet been published.
    - _Requirements: 3.7–3.15, 4.1–4.14, 5.1–5.12, 6.12, 6.13, 13.4, 14.2–14.5_

  - [x] 5.5 Write the property test for canonical segmentation and reference composition
    - Create `tests/watch-2-5d/property-03-segmentation-composition.property.test.ts` with one fast-check property over bounded small-raster masks, semantic classes, source rectangles, alpha values, overlaps, z-orders, reviewed owners, and immutable regions.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 3: Canonical segmentation and reference composition`.
    - Complete when valid generated compositions preserve every immutable pixel and any invalid bound, count, owner, or compositing order is rejected.
    - **Property 3: Canonical segmentation and reference composition**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.12, 3.13, 3.15, 8.5**

  - [x] 5.6 Write the property test for reconstruction containment and opaque coverage
    - Create `tests/watch-2-5d/property-04-reconstruction-coverage.property.test.ts` with one fast-check property over small-raster footprints, sweep masks, feather bounds, fills, approved-change regions, z-order, and reference/motion/depth samples.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 4: Reconstruction containment, change confinement, and opaque coverage`.
    - Complete when all valid samples have opaque coverage and confined changes, while any hole, residual footprint, or out-of-bound synthetic pixel disables the candidate.
    - **Property 4: Reconstruction containment, change confinement, and opaque coverage**
    - **Validates: Requirements 4.1, 4.2, 4.7, 4.8, 4.9, 4.13, 4.14, 5.9, 7.10, 8.6, 13.7**

  - [x] 5.7 Add real-source mask, reconstruction, and approval integration tests
    - Create `tests/watch-2-5d/source-composition.integration.test.ts` to run the normalized authored set against the exact canonical source, verify source pre/post hashes, immutable-region bytes, approved-change confinement, footprint replacement, alpha coverage at every declared extreme, and evidence/approval hash closure.
    - Make the empty approved-moving set an explicit passing case that produces reference/fallback output without synthetic production artifacts.
    - Complete when the finite real-source pass emits deterministic diagnostics and any stale approval, seam-mask violation, transparent pixel, or residual silhouette blocks motion eligibility.
    - _Requirements: 1.2, 3.8, 3.14, 3.15, 4.1–4.14, 5.9–5.11, 8.3, 8.5, 8.6, 8.13, 13.6, 13.7, 13.13_

- [x] 6. Implement the deterministic builder, fidelity checks, and read-only Layer Asset Gate
  - [x] 6.1 Build canonical package manifests in an isolated staging directory
    - Create `scripts/build-watch-layer-assets.mjs` to run predecessor verification first, snapshot immutable inputs, load normalized authored records, construct canonical phase projections, and stage `data/watch-layer-package.json` plus review/build metadata without touching the current release.
    - Use `sourceDateEpoch` and canonical JSON rather than wall-clock output; clean failed staging and leave prior package/release/public files intact.
    - Complete when identical inputs produce identical staged manifest bytes, an input mutation aborts publication, and fallback-only succeeds with no runtime/public assets.
    - _Requirements: 1.2, 1.3, 1.7, 1.10, 2.1–2.12, 13.1–13.4, 13.13, 14.1–14.6, 14.9, 14.10_

  - [x] 6.2 Generate deterministic compact and expanded presentation profiles
    - Extend `build-watch-layer-assets.mjs` to render a full reconstructed background plus no more than six cropped approved layer/occluder images, using canonical rectangles and the approved `sharp` settings, into staged compact 1380×752 and expanded 2760×1504 WebP profiles.
    - Record finalized signatures, MIME, SHA-256, lengths, dimensions, decoded RGBA bytes, source rectangles, z-order, color metadata, and encoder settings; keep runtime manifest plus profile images at no more than eight requests.
    - Generate no successor profile when the selected phase is fallback-only, and never create a moving layer for an unapproved/static candidate.
    - Complete when deterministic re-encoding is byte-identical in the supported local environment and every staged asset matches its recorded identity and budgets.
    - _Requirements: 2.8, 2.9, 3.4–3.8, 4.13, 5.1, 5.7, 5.11, 8.2, 8.11, 12.1–12.5, 12.12, 12.13, 13.2, 13.5_

  - [x] 6.3 Implement source-space fidelity, change, alignment, and alpha gates
    - Add `scripts/watch-2-5d/fidelity.mjs` to compare lossless reference composition against the canonical source, derive segmentation edge/approved-change bands, check immutable bytes, validate complete alpha coverage, and render deterministic reference/motion/depth sample reports.
    - Implement the documented SSIM and per-pixel screenshot comparator plus canonical-to-viewport alignment checks for 320, 390, 700, 701, 1024, 1440, and 2560 CSS-pixel widths; keep browser capture separate from source-space truth.
    - Complete when exact/reference fixtures pass, one-pixel immutable/coverage/alignment violations fail, and every report names the exact input hashes and pose IDs.
    - _Requirements: 3.8, 3.15, 4.7, 4.8, 4.13, 4.14, 7.10, 8.2–8.6, 8.12, 8.13, 13.6, 13.7_

  - [x] 6.4 Implement the fixed-order, read-only successor verifier
    - Create `scripts/verify-watch-layer-assets.mjs` with the approved precedence: predecessor, protected integrity, schema/path, identities, provenance/approvals, segmentation, reconstruction, fidelity/coverage, motion, depth, public assets/runtime manifest, budgets, and pre/post input hashes.
    - Sandbox network APIs and filesystem mutators, enforce deterministic first-failure codes, accept a valid fallback-only or empty-approved-moving package, and reject any ready phase whose approval or objective gate is incomplete.
    - Complete when the verifier exits zero for valid fallback-only/current package data, performs zero writes/network requests, and each fault class produces its documented first code.
    - _Requirements: 1.9–1.12, 2.13, 2.14, 4.9, 4.10, 5.9, 6.13, 7.11, 8.12, 13.1–13.7, 13.12–13.17, 14.1–14.7_

  - [x] 6.5 Add atomic publication and monotonic release selection
    - Finish `build-watch-layer-assets.mjs` so a passing staged package is atomically renamed into `data/` and `public/assets/watch-2-5d/v1/`, then compile `data/watch-layer-release.json` to the latest contiguous approved phase only after rerunning the read-only verifier.
    - Preserve earlier approved assets byte-for-byte when a later phase is disabled; publish `fallback-only` with no runtime URL when source/static gates or required approvals are absent.
    - Complete when injected failures at every publication step preserve the prior release, a successful publish closes all hashes, and rollback changes only the release pointer/approved phase metadata.
    - _Requirements: 10.3–10.8, 10.15, 13.14, 14.1–14.10_

  - [x] 6.6 Add deterministic builder/verifier integration and mutation tests
    - Create `tests/watch-2-5d/layer-builder-verifier.integration.test.ts` for reproducible staging, atomic rename/rollback, fallback-only output, empty moving sets, real signatures/MIME/dimensions/color, input nonmutation, side-effect sandboxing, approval closure, failure precedence, request budgets, and corrupted public/runtime artifacts.
    - Use temporary synthetic assets for destructive cases and one finite read-only pass over the real authored package.
    - Complete when identical builds match byte-for-byte and every single mutation blocks ready publication while preserving the prior release.
    - _Requirements: 1.2, 1.9–1.12, 2.6–2.14, 12.1–12.5, 12.13, 13.1–13.17, 14.1–14.10_

  - [x] 6.7 Write the property test for profile budgets and request membership
    - Create `tests/watch-2-5d/property-12-profile-budgets.property.test.ts` with one fast-check property over canonical local profile members, finalized byte lengths, decoded dimensions, manifest sizes, duplicate/foreign requests, and exact/one-unit-over budget boundaries.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 12: Profile budgets and request membership`.
    - Complete when gate acceptance is equivalent to membership, request-count, transfer, and decoded-memory limits for both profiles.
    - **Property 12: Profile budgets and request membership**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.13, 13.5**

  - [x] 6.8 Write the property test for failure precedence and delivery phases
    - Create `tests/watch-2-5d/property-13-gate-phases.property.test.ts` with one fast-check state/model property over simultaneous faults, phase vectors, approvals, artifact hashes, publication failures, and rollback selections.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 13: Deterministic gate precedence and monotonic delivery phases`.
    - Complete when the first documented code wins, approved phases form one contiguous prefix, no failing package becomes ready, and later-phase changes cannot mutate earlier assets.
    - **Property 13: Deterministic gate precedence and monotonic delivery phases**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.8, 13.9, 13.14, 13.17, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10**

- [x] 7. Checkpoint — enforce the objective asset and approval gate before motion work
  - Run the predecessor verifier, integrity suite, authored/source integration, builder/verifier integration, Properties 1–4 and 12–13, and `node scripts/verify-watch-layer-assets.mjs`.
  - Proceed to runtime and motion modules only if the package is either valid fallback-only, valid reference/static with an empty approved-moving set, or contains only moving parts whose segmentation, reconstruction, pivot, motion, fidelity, and release approvals resolve to current evidence hashes. Do not treat absent approvals as a blocker to the valid static/fallback outcome.
  - _Requirements: 3.8–3.15, 4.1–4.14, 5.1–5.11, 13.1–13.17, 14.1–14.10_

- [x] 8. Implement runtime contracts, browser gating, and atomic resource loading
  - [x] 8.1 Create TypeScript runtime types and strict public schema validation
    - Add `lib/watch-2-5d/types.ts` and `lib/watch-2-5d/runtime-schema.ts` for branded IDs/hashes, source coordinates, public assets, compact/expanded profiles, motion/depth records, release-pointer variants, prepared profiles, support/failure codes, and exact unknown-field-rejecting runtime validation.
    - Accept only same-origin `/assets/watch-2-5d/v1/` members bound to the compiled release; keep `fallback-only` structurally URL-free and depth false.
    - Complete when TypeScript exhaustiveness checks pass and malformed or future-3D runtime payloads cannot enter a ready state.
    - _Requirements: 2.9–2.13, 6.1, 7.1–7.5, 10.7–10.15, 12.5, 12.13–12.16, 15.13_

  - [x] 8.2 Implement conservative browser and capability classification
    - Add `lib/watch-2-5d/browser-support.ts` with explicit Chrome/Edge 120+, Firefox 121+, Safari/iOS Safari 17.2+, and Android Chrome 120+ parsing plus checks for fetch, abort, digest, image decode, animation frames, resize observation, media queries, page visibility, CSS transforms, and custom properties.
    - Reject unknown/malformed/below-floor agents before any successor request and distinguish iOS Safari from alternative iOS tokens.
    - Complete when fixed boundary examples and capability permutations classify deterministically and every unsupported case invokes no loader.
    - _Requirements: 10.13, 10.14, 12.14, 12.15, 12.17_

  - [x] 8.3 Implement the pure enhancement state machine
    - Add `lib/watch-2-5d/runtime-state.ts` for fallback-only, unsupported, loading-manifest, loading-assets, mounting-hidden, ready, profile-switch-loading, and error transitions.
    - Model manifest/asset completion in arbitrary order, one atomic ready event, one terminal error per navigation, no retry/substitution, fallback visibility, and Active Elapsed Time preservation across profile switching.
    - Complete when transition-table examples reject impossible/partial states and any error sequence ends in terminal fallback with a stable decorative code.
    - _Requirements: 8.7, 8.8, 8.12, 10.1–10.10, 10.13–10.15, 14.7, 14.9_

  - [x] 8.4 Implement the hash-verifying same-origin runtime loader
    - Add `lib/watch-2-5d/runtime-loader.ts` to fetch the runtime manifest as bytes, verify status/MIME/length/SHA-256/schema/release identity, fetch only the active allowlisted profile, verify every image, create object URLs from verified bytes, and decode off-screen before returning `PreparedProfile`.
    - Abort and revoke all staged resources on failure/unmount/profile change, request no alternate format or remote/generated source, and expose no reviewer/local-path details.
    - Complete when arbitrary completion order returns one complete prepared profile and every injected fetch/hash/media/dimension/decode failure cleans up once with no retry.
    - _Requirements: 10.1–10.10, 10.13–10.15, 12.5, 12.13–12.15, 13.9, 14.7, 14.9_

  - [x] 8.5 Write the property test for atomic enhancement loading and fail-once fallback
    - Create `tests/watch-2-5d/property-11-atomic-loader.property.test.ts` with one fast-check command/model property over capability tuples and arbitrary manifest, asset, decode, mount, switch, cleanup, and failure event orderings.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 11: Atomic enhancement loader and fail-once fallback`.
    - Complete when the model and implementation agree that partial composition is never visible, unsupported means zero requests, and every failure causes one no-retry fallback.
    - **Property 11: Atomic enhancement loader and fail-once fallback**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 10.13, 10.14, 10.15, 8.12, 12.14, 12.15, 14.7, 14.9**

  - [x] 8.6 Add runtime schema, browser, loader, and cleanup examples
    - Create `tests/watch-2-5d/runtime-loader.test.ts` for fallback-only zero invocation, browser version floors, same-origin allowlists, exact release serialization, each diagnostic code, all completion permutations, object URL/abort cleanup, profile-switch failure, and no automatic retry.
    - Mock bytes and decode deterministically without a development server or external request.
    - Complete when the focused suite covers every runtime failure code and leaves no pending listener, object URL, request, or timer.
    - _Requirements: 10.1–10.15, 12.13–12.17, 13.9, 14.7, 14.9_

  - [x] 8.7 Write the property test for the separate, non-destructive future-3D handoff
    - Create `tests/watch-2-5d/property-15-future-3d-boundary.property.test.ts` with one fast-check property over future package declarations, canonical hashes, additional-source provenance/licenses, authored-reconstruction labels, optional semantic correspondences, migration-gate outcomes, and current runtime payloads.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 15: Future full-3D handoff is separate and non-destructive`.
    - Complete when no generated 3D declaration activates through the current schema, valid handoff metadata leaves 2.5D bytes unchanged, and any failed future gate selects the prior approved presentation.
    - **Property 15: Future full-3D handoff is separate and non-destructive**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.10, 15.11, 15.12, 15.13, 15.14**

- [x] 9. Implement canonical mapping, deterministic motion, and active-time semantics after the asset gate
  - [x] 9.1 Implement canonical cover mapping
    - Add `lib/watch-2-5d/cover-transform.ts` for the approved centered `object-fit: cover` scale/offset equations, canonical point/rectangle mapping, compact encoding-scale independence, pivot/boundary alignment checks, and fail-closed nonfinite/coverage results.
    - Complete when fixed 320/390/700/701/1024/1440/2560 examples match the predecessor cover model within 0.5 CSS pixel and profile changes do not alter canonical geometry.
    - _Requirements: 8.1–8.4, 8.7, 8.8, 8.12_

  - [x] 9.2 Write the property test for cover equivalence and responsive phase preservation
    - Create `tests/watch-2-5d/property-08-cover-mapping.property.test.ts` with one fast-check property over supported viewports, canonical points/rectangles, both profile scales, profile crossings, alignment errors, and preserved elapsed times.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 8: Cover mapping equivalence and responsive phase preservation`.
    - Complete when mapping equals the predecessor oracle within tolerance and invalid alignment/coverage selects fallback without changing time.
    - **Property 8: Cover mapping equivalence and responsive phase preservation**
    - **Validates: Requirements 8.2, 8.4, 8.7, 8.8, 8.12**

  - [x] 9.3 Implement pure approved-motion and inherited-global sampling
    - Add `lib/watch-2-5d/motion.ts` for continuous/discrete rotation, bounded zero-mean oscillation, explicitly approved linked-gear ratios, pivot-centered matrices, cycle normalization, and the predecessor 28-second cubic-Bezier outward/return transform.
    - Apply identity to every static/unapproved layer, use only Active Elapsed Time and manifest data, contain no random/wall-clock/frame-count input, and compose global → cover → depth → part transforms in the approved order.
    - Complete when fixed examples satisfy periods, direction, bounds, pivot drift, cycle continuity, reference phase, and empty-approved-set Reference Pose.
    - _Requirements: 5.1–5.12, 6.1–6.18, 8.4, 13.8_

  - [x] 9.4 Write the property test for approved-motion eligibility and static default
    - Create `tests/watch-2-5d/property-05-motion-eligibility.property.test.ts` with one fast-check property over layer classes, masks, pivots, reconstruction, profiles, provenance, approvals, and elapsed time.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 5: Approved-motion eligibility and static default`.
    - Complete when only fully approved moving IDs can receive a nonidentity relative transform and empty/incomplete sets remain entirely at Reference Pose.
    - **Property 5: Approved-motion eligibility and static default**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11**

  - [x] 9.5 Write the property test for elapsed-time deterministic transform composition
    - Create `tests/watch-2-5d/property-06-deterministic-transforms.property.test.ts` with one fast-check property over manifests, application states, viewports, elapsed times, and different frame partitions.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 6: Elapsed-time deterministic transform composition`.
    - Complete when equal manifest/state/time inputs produce equal matrices, all layers share one global phase, and frame schedules cannot change the result.
    - **Property 6: Elapsed-time deterministic transform composition**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.10, 6.11, 6.14, 6.15, 6.16, 6.17, 6.18**

  - [x] 9.6 Write the property test for kinematic bounds, ratios, pivots, and continuity
    - Create `tests/watch-2-5d/property-07-kinematics.property.test.ts` with one fast-check property over valid periods/cadences, hand ratios, tooth counts, oscillator amplitudes/phases, elapsed times, pivots, and projection scales.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 7: Kinematic profile bounds, ratios, pivots, and continuity`.
    - Complete when all generated profiles stay bounded/continuous, linked gears obey declared inverse opposite motion, oscillators have zero cycle mean, and projected pivots stay within tolerance.
    - **Property 7: Kinematic profile bounds, ratios, pivots, and continuity**
    - **Validates: Requirements 6.1, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11**

  - [x] 9.7 Implement the active-time model and animation clock hook
    - Add `lib/watch-2-5d/active-time.ts` and `components/ui/watch-2-5d/useAnimationClock.ts` with monotonic accumulated time, fresh baselines after resume, one animation-frame callback, and composable pause reasons for reduced motion, dialog, hidden page, profile loading, unsupported capability, and error.
    - Advance only while ready with no pause reason; cancel callbacks and listeners on every pause/unmount; expose reference-phase transforms immediately for reduced motion.
    - Complete when fake-clock examples exclude all paused intervals, preserve time across nested reasons, and resume without phase jumps or duplicate callbacks.
    - _Requirements: 6.2, 6.3, 6.14–6.18, 8.7, 8.8, 9.1–9.5, 9.7–9.14_

  - [x] 9.8 Write the property test for active-time pause and resume semantics
    - Create `tests/watch-2-5d/property-09-active-time.property.test.ts` with one fast-check command/model property over arbitrary monotonic timestamps and ready/reduced/dialog/visibility/profile/unsupported/error transitions.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 9: Active-time pause and resume semantics`.
    - Complete when accumulated time equals only active intervals, paused transforms are stable, and reduced motion yields Reference Pose for part, depth, and global transforms.
    - **Property 9: Active-time pause and resume semantics**
    - **Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.7, 9.8, 9.9, 9.13, 9.14**

- [x] 10. Mount the atomic decorative React enhancement and preserve static/application behavior
  - [x] 10.1 Create the decorative layer renderer
    - Add `components/ui/watch-2-5d/LayeredWatchLayer.tsx` with canonical source-rectangle geometry, verified object URLs, z-order, transform custom properties, empty alt text, `aria-hidden`, `tabIndex={-1}`, `draggable={false}`, and no event handlers or independent global transform.
    - Complete when component tests show no accessible/focusable node, no pointer participation, and geometry/transform output derived only from validated props.
    - _Requirements: 6.16, 6.17, 7.6–7.9, 11.1, 11.2, 11.13_

  - [x] 10.2 Create the enhancement controller and atomic profile lifecycle
    - Add `components/ui/watch-2-5d/LayeredWatchEnhancement.tsx` to classify support in a client effect, run the verified loader/state machine, mount complete profiles hidden, verify mounted intrinsic dimensions/decode, and expose one atomic ready/error/profile-switch transition.
    - Wire cover mapping, one animation clock, inherited/part transforms, reduced-motion reference pose, dialog pause/opacity, visibility pause, resize/profile switching, cleanup, and stable decorative diagnostics; never set React state per frame or read layout in the frame loop.
    - Keep depth disabled unless the separately approved optional task is implemented and the exact release opts in.
    - Complete when fallback remains visible through all partial/failure states and a complete profile activates once without changing application state.
    - _Requirements: 6.15–6.18, 7.1, 7.6–7.9, 8.2, 8.7–8.12, 9.1–9.14, 10.1–10.15, 11.1–11.4, 11.9, 11.13, 11.14_

  - [x] 10.3 Integrate the controller inside the existing fallback facade
    - Modify only the internals of `components/ui/WatchImageBackdrop.tsx` to retain its public props and exact predecessor `<picture>`/decorative `<img>` tree while mounting `LayeredWatchEnhancement` as a sibling decorative layer.
    - Keep the predecessor image selected as the fallback, preserve loading/error behavior and reserved geometry, and switch fallback/enhanced visibility in the same commit; do not modify `components/EliteWatchesExperience.tsx` unless a compile-only type adaptation is strictly required by the unchanged facade.
    - Complete when fallback-only server/hydration markup equals the predecessor contract and unsupported/error paths never request or reveal successor layers.
    - _Requirements: 1.4, 1.5, 8.1, 8.11, 9.3, 9.6, 10.1, 10.5, 10.11, 10.12, 11.3–11.15, 14.6, 14.7, 14.9_

  - [x] 10.4 Add successor styles outside all protected CSS blocks
    - Append isolated `.watch-layer-*` rules in `app/globals.css` for absolute cover geometry, hidden/ready atomic visibility, shared outer inherited transform, per-layer relative transforms, opacity `0.72` while the definition dialog is open, `pointer-events: none`, z-index below the scrim/controls, and reduced-motion defense.
    - Do not edit any integrity-protected predecessor selector/block or add canvas, WebGL, filter animation, pointer parallax, layout-affecting transition, or input listener.
    - Complete when CSS source tests prove protected block hashes unchanged, zero horizontal overflow/layout shift rules, and successor layers remain below every existing control/dialog.
    - _Requirements: 1.8, 7.6–7.9, 8.9, 8.10, 9.3, 9.6, 9.13, 11.11–11.14, 12.11, 12.16_

  - [x] 10.5 Add atomic loading, activation, failure, and cleanup component tests
    - Create `tests/watch-2-5d/layered-watch-enhancement.test.tsx` for fallback-only, unsupported, manifest loading, arbitrary asset completion, hidden complete mount, one atomic activation, every diagnostic failure, no retry, profile switch, object URL/observer/listener/frame cleanup, and predecessor hero-error independence.
    - Complete when no test can observe a partial visible layer tree and every failure leaves only the exact fallback presentation operable.
    - _Requirements: 8.7, 8.8, 8.12, 10.1–10.15, 12.14, 12.15, 14.7, 14.9_

  - [x] 10.6 Add reduced-motion, dialog, visibility, and mapping component tests
    - Create `tests/watch-2-5d/layered-watch-static-modes.test.tsx` with fake animation frames, visibility events, media-query changes, resize/profile boundaries, and dialog transitions.
    - Assert next-frame reduced-motion stasis, Reference Pose, paused/resumed elapsed time, dialog opacity `0.72`, shared inherited transform, no phase loss at 700/701, and fallback on invalid mapping.
    - Complete when nested pause reasons and all cleanup paths pass without timer/frame leaks.
    - _Requirements: 6.14–6.18, 8.2, 8.4, 8.7, 8.8, 8.12, 9.1–9.14_

  - [x] 10.7 Add accessibility and preserved-application integration tests
    - Create `tests/watch-2-5d/layered-watch-experience.integration.test.tsx` to compare fallback/loading/ready/static/error states against existing header, search, 13 graph controls, audience, dialog, skip link, focus order/restoration, hit targets, relationships, labels, and dictionary content.
    - Scan production source for forbidden pointer/touch/wheel/drag/camera/microphone/orientation handlers and canvas/WebGL/3D runtime imports.
    - Complete when existing interactions and accessibility snapshots are equal before/after activation and successor content adds no accessible or focusable node.
    - _Requirements: 7.6–7.9, 9.11, 11.1–11.15, 12.16_

  - [x] 10.8 Write the property test for enhancement-state application preservation
    - Create `tests/watch-2-5d/property-14-application-state.property.test.tsx` with one fast-check property over audience, selected term, preview, search query, focus owner, dialog state, viewport profile, 13-control model, and enhancement transitions.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 14: Enhancement transitions preserve existing application state`.
    - Complete when no generated enhancement/profile event changes application values, control identities/relationships, focus model, or predecessor content.
    - **Property 14: Enhancement transitions preserve existing application state**
    - **Validates: Requirements 8.7, 11.3, 11.4, 11.5, 11.9, 11.13, 11.14, 11.15**

- [x] 11. Add separately approved optional depth without weakening the core release
  - [x] 11.1 Implement approved depth sampling and guarded runtime wiring
    - Add `lib/watch-2-5d/depth.ts` and extend runtime schema/controller wiring only after exact compact/expanded depth approvals exist; keep `depthEnabled: false` as the checked-in/default release and make skipped depth code resolve to identity transforms.
    - Drive depth only from Active Elapsed Time and approved layer/z-order values; clamp aggregate displacement to `0.006` of the shorter axis, scale delta to `0.015`, and rotation to 1 degree, with no new assets or input listeners.
    - Complete when enabled fixtures require exact approval/fidelity/coverage/performance closure and any missing/failing condition leaves earlier motion/static assets byte-identical with depth disabled.
    - _Requirements: 7.1–7.5, 7.8–7.12, 9.2, 10.15, 14.4, 14.8_

  - [x] 11.2 Write the property test for approved, bounded, fail-closed depth
    - Create `tests/watch-2-5d/property-10-depth.property.test.ts` with one fast-check property over viewport sizes, compact/expanded values, z-orders, elapsed times, approvals, prerequisite outcomes, and exact/over-bound transforms.
    - Run at least 100 cases with a recorded seed and tag the test `Feature: interactive-layered-watch-2-5d, Property 10: Depth is approved, bounded, deterministic, and fail-closed`.
    - Complete when unapproved depth is identity, approved depth is deterministic and bounded, and any gate failure disables depth without changing prior assets.
    - **Property 10: Depth is approved, bounded, deterministic, and fail-closed**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.10, 7.11, 7.12, 14.4, 14.8**

  - [x] 11.3 Add depth extreme source, component, and browser evidence tests
    - Create `tests/watch-2-5d/depth.integration.test.tsx` to exercise both profiles at every declared extreme, Alpha Coverage Gate, fidelity/change confinement, dialog/reduced-motion stasis, profile switching, request neutrality, and performance budgets.
    - Generate hash-bound depth review evidence/templates through the existing pipeline; do not enable the release unless a matching approved record is supplied and all tests pass.
    - Complete when default-off is proven, approved-depth fixtures pass every bound, and injected failures retain the prior approved non-depth release.
    - _Requirements: 7.1–7.12, 8.13, 9.2, 12.1–12.11, 13.3–13.7, 14.4, 14.8_

- [x] 12. Checkpoint — validate runtime, static modes, and the default-off depth boundary
  - Run runtime, mapping, motion, clock, React, accessibility, and Properties 5–11 plus 14–15. Confirm `data/watch-layer-release.json` remains fallback-only or points only to the latest fully approved phase.
  - Proceed when empty approved-moving data renders Reference Pose/fallback successfully, approved motion cannot bypass the asset gate, reduced motion/dialog/visibility preserve behavior, and skipped optional depth remains identity/default-off.
  - _Requirements: 5.1–5.12, 6.1–6.18, 7.1–7.12, 8.1–8.12, 9.1–9.14, 10.1–10.15, 11.1–11.15, 14.1–14.10_

- [x] 13. Extend finite browser, fidelity, performance, and accessibility evidence
  - [x] 13.1 Implement a common finite browser-evidence schema and local adapter boundary
    - Add `scripts/watch-2-5d/browser-evidence.mjs` for exact browser/version, viewport/DPR, release/profile hashes, requests, console/runtime/hydration errors, geometry, accessibility, focus/hit tests, raw frame intervals, interactions, long tasks, layout shifts, screenshots, cleanup, and deterministic failure records.
    - Define local CDP/WebDriver/platform adapter interfaces without adding application dependencies or transmitting project data; require missing matrix evidence to block ready release but not fallback-only operation.
    - Complete when evidence canonicalizes deterministically, rejects unknown/partial records, and binds every artifact to one finite run ID.
    - _Requirements: 8.13, 11.3–11.14, 12.6–12.10, 12.14, 12.17, 13.10, 13.11, 13.18_

  - [x] 13.2 Extend the finite atlas browser smoke for layered enhancement
    - Update `scripts/atlas-visibility-smoke.mjs` to record fallback-first loading, zero-request fallback/unsupported states, exact manifest/profile membership, hidden partial composition, atomic activation/failure, intrinsic geometry, cover/pivot alignment, reference/motion/depth captures, reduced motion, dialog/visibility pause, orientation/700px switching, all existing center hit tests, and cleanup.
    - Retain finite server/process lifetime and raw 120-frame plus three warmed-interaction samples; write evidence under `artifacts/watch-2-5d/<run-id>/` and terminate every local process.
    - Complete when one finite Chromium run produces the common evidence schema with no arbitrary sleep, retry, background substitute, or leaked process.
    - _Requirements: 8.2–8.13, 9.1–9.14, 10.1–10.15, 11.1–11.15, 12.5–12.11, 12.17, 13.9, 13.10, 13.18_

  - [x] 13.3 Update the browser-smoke source contract
    - Extend `tests/atlas-smoke-contract.test.ts` to require successor request allowlisting, fallback/partial/atomic states, profile dimensions and budgets, canonical mapping, fidelity/coverage captures, reduced/static states, accessibility/hit tests, raw timing arrays, evidence retention, deterministic cleanup, and no retry/substitution.
    - Preserve every predecessor smoke assertion and reject weakened thresholds, averages replacing individual limits, unbounded waits, remote services, or a production canvas/WebGL branch.
    - Complete when the contract test fails on removal or weakening of every required probe and passes the finite harness source.
    - _Requirements: 1.9, 8.13, 10.1–10.15, 11.3–11.14, 12.5–12.17, 13.9–13.11, 13.18_

  - [x] 13.4 Generate and validate hash-bound browser fidelity fixtures
    - Add/update `tests/fixtures/watch-2-5d/fidelity/` metadata and capture tooling for predecessor references at 390×844, 1024×576, and 1440×900 DPR 1 plus 320×568 and 2560×1440 boundaries, recording currentSrc/source hashes, browser/version, viewport, screenshot hash, and pose.
    - Feed reference and every declared extreme into the SSIM/per-pixel/change-region comparator and approval-template pipeline; accept fidelity approval only when exact capture/report hashes match.
    - Complete when reference thresholds and immutable/change confinement pass, stale captures invalidate approval, and no approval is inferred from the score alone.
    - _Requirements: 1.1, 3.8, 3.15, 4.5, 4.6, 8.3, 8.6, 8.13, 13.6, 13.18_

  - [x] 13.5 Add browser accessibility and preserved-behavior assertions
    - Create `tests/watch-2-5d/browser-accessibility-evidence.test.ts` to validate evidence for decorative semantics, unchanged accessibility tree/focus order, header/search/13 graph controls/audience/dialog/skip-link behavior, responsive state preservation, forced colors, and center-point hit testing before and after activation/fallback.
    - Complete when any changed name, role, relationship, focus target, hit result, content value, or successor focusable node rejects the evidence.
    - _Requirements: 7.6–7.9, 9.11, 11.1–11.15, 12.17, 13.10_

  - [x] 13.6 Add finite performance and budget evidence assertions
    - Create `tests/watch-2-5d/browser-performance-evidence.test.ts` for exact request/transfer/decode totals, zero successor layout shift, at least 114 of 120 intervals at or below 25 ms, every interval at or below 100 ms, and each warmed interaction response/overlapping task/cumulative blocking value at or below 100 ms.
    - Require raw samples before assertions and preserve individual failures rather than averages; allow fallback-only evidence to report zero successor costs.
    - Complete when exact and one-unit-over synthetic evidence proves each boundary and the local finite run passes without hiding outliers.
    - _Requirements: 8.10, 12.1–12.11, 12.17, 13.5, 13.18_

  - [x] 13.7 Implement matrix-adapter validation and evidence completeness gating
    - Add local adapter/configuration support for Chrome/Edge 120+, Firefox 121+, Safari/iOS Safari 17.2+, and Android Chrome 120+ using environment-supplied endpoints, all producing the common schema without a third-party service or new runtime dependency.
    - Add `tests/watch-2-5d/browser-matrix-evidence.test.ts` to require the complete supported matrix for a ready release, while accepting deterministic fallback evidence for unavailable enhanced capability and fallback-only releases.
    - Complete when missing/stale/wrong-version evidence blocks ready publication, each supplied adapter terminates cleanly, and no project source or user data leaves the local environment.
    - _Requirements: 10.13, 10.14, 12.14, 12.15, 12.17, 13.10, 13.18_

- [x] 14. Wire lifecycle gates and execute the complete inherited/successor validation
  - [x] 14.1 Add build, verify, and lifecycle script ordering without dependency changes
    - Update only `package.json` scripts to add `build:watch-layers` and `verify:watch-layers`, and compose `predev`, `pretest`, and `prebuild` so `verify:watch-images` completes before the read-only layer verifier and before the requested lifecycle command.
    - Preserve `dependencies` and `devDependencies` fields byte-for-byte and avoid recursive lifecycle invocation; keep Vitest single-run and add no watcher/development-server command.
    - Complete when script-order tests pass, a layer-gate failure blocks each lifecycle, fallback-only exits zero, and dependency snapshots remain identical.
    - _Requirements: 1.9, 1.12, 12.12, 13.1, 13.11, 13.16_

  - [x] 14.2 Add lifecycle, inherited-suite, and release-readiness contract tests
    - Create `tests/watch-2-5d/lifecycle-release-contract.test.ts` to assert predecessor-first ordering, all inherited assertions unchanged, read-only verification, phase/fidelity/approval/browser-evidence prerequisites, deterministic first failures, and no ready pointer after any gate failure.
    - Verify that optional depth can be skipped without weakening core release checks and that fallback-only/empty-moving results remain successful.
    - Complete when every lifecycle and release branch is exercised and the targeted integrity suite still passes independently.
    - _Requirements: 1.9–1.12, 7.11, 12.12–12.17, 13.1–13.18, 14.1–14.10_

  - [x] 14.3 Run the finite full validation and emit a release evidence index
    - Run, in order, `npm run verify:watch-images`, `npm run verify:watch-layers`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run smoke:atlas`, and `npm test -- tests/spec-integrity.test.ts`; use only finite single-run commands.
    - Have the finite harness write an index that binds raw visual/timing/network/console/accessibility evidence to the exact release/package/assets, without modifying source inputs or protected artifacts.
    - Complete when every required command exits zero, all 15 property tests have run with at least 100 cases, protected/dependency hashes match, and the final release is either approved ready or explicitly fallback-only with zero successor requests.
    - _Requirements: 1.8–1.12, 3.8, 4.8, 6.3, 8.3, 10.1–10.15, 11.1–11.15, 12.1–12.17, 13.1–13.18, 14.1–14.10, 15.13_

- [x] 15. Final checkpoint — confirm a reversible, truthful release
  - Confirm the release pointer selects only the latest contiguous approved phase, every enabled asset/effect resolves through objective gates and exact approval records, fallback remains continuously available, and no protected artifact, predecessor spec, dependency field, canonical byte, or unrelated application behavior changed.
  - Treat fallback-only or an empty approved-moving set as a complete valid implementation result. Optional depth remains disabled unless Tasks 11.1–11.3 and every required depth approval/evidence gate pass.
  - _Requirements: 1.1–1.12, 5.11, 7.1, 7.11, 10.1–10.15, 13.1–13.18, 14.1–14.10, 15.1–15.14_

## Notes

- Tasks 11.1–11.3 are the only optional tasks. They may be skipped; doing so must leave depth disabled and all core static/motion/fallback gates intact.
- All other tests are required because they protect source truth, accessibility, application behavior, atomic fallback, or release integrity.
- Property tasks implement exactly one fast-check property per design property, use at least 100 runs with a reproducible seed, and carry the required feature/property tag.
- Review is represented by deterministic code-generated evidence plus strict validation of separately supplied hash-bound approval records. Tooling may emit pending templates but may not make or infer a visual approval.
- No approved moving parts is a valid result. An implementation must not invent a mask, fill, pivot, relationship, or motion profile to make a ready animation package.
- Checkpoints 3, 7, 12, and 15 are explicit stop/go gates. In particular, motion code is downstream of the objective asset/approval gate in Checkpoint 7.
- No task deploys the application, starts an interactive development server/watcher, gathers production telemetry, adds dependencies, modifies predecessor specs, or implements full 3D.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "5.1"] },
    { "id": 6, "tasks": ["5.2"] },
    { "id": 7, "tasks": ["5.3"] },
    { "id": 8, "tasks": ["5.4"] },
    { "id": 9, "tasks": ["5.5", "5.6", "5.7"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2", "6.3"] },
    { "id": 12, "tasks": ["6.4"] },
    { "id": 13, "tasks": ["6.5"] },
    { "id": 14, "tasks": ["6.6", "6.7", "6.8"] },
    { "id": 15, "tasks": ["8.1", "9.1"] },
    { "id": 16, "tasks": ["8.2", "8.3", "9.2", "9.3"] },
    { "id": 17, "tasks": ["8.4", "8.7", "9.4", "9.5", "9.6", "9.7"] },
    { "id": 18, "tasks": ["8.5", "8.6", "9.8"] },
    { "id": 19, "tasks": ["10.1"] },
    { "id": 20, "tasks": ["10.2"] },
    { "id": 21, "tasks": ["10.3", "10.4"] },
    { "id": 22, "tasks": ["10.5", "10.6", "10.7", "10.8"] },
    { "id": 23, "tasks": ["11.1", "13.1"] },
    { "id": 24, "tasks": ["11.2", "13.2"] },
    { "id": 25, "tasks": ["11.3", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 26, "tasks": ["13.7"] },
    { "id": 27, "tasks": ["14.1"] },
    { "id": 28, "tasks": ["14.2"] },
    { "id": 29, "tasks": ["14.3"] }
  ]
}
```
