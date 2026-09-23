# Requirements Document

## Introduction

The Interactive Layered Watch 2.5D feature is the gated successor to the completed `animated-watch-image-glass-header` feature. The successor keeps the exact approved watch/reference presentation, responsive base image, smoke-glass header, explorer behavior, accessibility behavior, integrity controls, loading behavior, and static fallback supplied by the predecessor. The successor adds a separately versioned layered-image package that may animate only explicitly approved visible parts and may optionally create a restrained depth impression.

The source is one flat PNG. The source records visible color and opacity only; the source does not contain hidden surfaces, depth, mechanical dimensions, pivots, tooth counts, or kinematic relationships. Segmentation boundaries, reconstructed pixels behind moving parts, depth assignments, pivots, and motion semantics are authored interpretations. Every authored interpretation must be identified as such and must not be described as recovered source truth.

This successor does not rewrite the predecessor’s `segmentationApplied: false` record. That record remains correct for the predecessor’s immutable master and responsive derivative set. The new layer package has its own provenance, review state, integrity gate, and rollback boundary. Until every successor gate passes, the predecessor presentation remains the production result.

The initial production path is phased 2.5D composition: source preparation, reference-pose reconstruction, approved part motion, and then optional restrained depth. A true modeled Blender/WebGL watch is outside this feature and requires a separately approved migration specification and independently provenance-recorded geometry.

## Glossary

- **ELITE_WATCHES_Application**: The Next.js application rooted at `/Users/ankitkumar/Desktop/CODE/activity`.
- **Layered_Watch_System**: The successor feature specified by this document, including local layer preparation, integrity validation, layered runtime presentation, deterministic motion, optional depth, and fallback behavior.
- **Predecessor_Spec**: The completed specification at `.kiro/specs/animated-watch-image-glass-header/`.
- **Predecessor_Baseline**: The approved application state produced by Predecessor_Spec, including the responsive watch image, static glass header, explorer, application behavior, accessibility behavior, budgets, and validation evidence.
- **Predecessor_Contract**: The acceptance criteria, manifest contract, validation commands, and protected-integrity expectations defined by Predecessor_Spec.
- **Successor_Extension_Boundary**: The additional Layer_Asset_Package and per-part transforms permitted only in Enhanced_Ready_State; the boundary does not mutate predecessor assets or predecessor records.
- **Canonical_Master**: The immutable PNG at `source/assets/elite-watch-master.png` with SHA-256 `7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b`, as approved by Predecessor_Spec.
- **Reference_Asset_Contract**: The predecessor manifest, five AVIF candidates, five WebP candidates, canonical public paths, hashes, dimensions, source-selection behavior, transfer budgets, and decoded-memory budgets.
- **Static_Fallback_Surface**: The predecessor’s single responsive `<picture>` and decorative `<img>` presentation, without successor layers.
- **Fidelity_Reference**: Pixel-aligned captures of Static_Fallback_Surface plus the source-space Canonical_Master, recorded before successor implementation.
- **Inherited_Global_Transform**: The predecessor’s approved 28-second whole-image transform, including scale, translation, endpoint, reduced-motion, and dialog-pause behavior.
- **Reference_Pose**: The authored pose in which every approved moving layer uses the transform needed to reproduce the current flat reference, Optional_Depth_Mode contributes zero relative displacement, and Inherited_Global_Transform uses its starting frame.
- **Reference_Viewports**: Viewports of 390×844, 1024×576, and 1440×900 CSS pixels at device-pixel ratio 1, plus 320×568 and 2560×1440 boundary checks.
- **Layered_2_5D_Mode**: A composition of flat source-derived layers at authored z-order and transforms; Layered_2_5D_Mode is not geometric reconstruction.
- **Preparation_Pipeline**: The finite local process that derives reviewed masks, layers, fills, metadata, and presentation assets from Canonical_Master without modifying Canonical_Master.
- **Layer_Asset_Package**: The complete versioned set of successor presentation layers, masks, reconstructed fills, manifests, hashes, and review records.
- **Layer_Asset_Manifest**: The strict local manifest that identifies Canonical_Master, every layer and mask, every reconstructed region, every motion record, every depth record, every public asset, every budget, and every approval state.
- **Layer_Record**: One manifest entry containing a stable layer ID, semantic class, source rectangle, source-coordinate mask, z-order, public asset identity, source-visible coverage, reconstructed coverage, reference transform, motion eligibility, and provenance references.
- **Source_Visible_Pixel**: A Canonical_Master pixel whose recorded color contributes directly to a layer or static background.
- **Segmentation_Mask**: A source-coordinate alpha mask that assigns visible source content to a Layer_Record.
- **Segmentation_Edge_Band**: The region extending two Canonical_Master pixels on each side of an approved Segmentation_Mask boundary.
- **Immutable_Region**: Every Canonical_Master pixel outside Segmentation_Edge_Band and outside an approved Reconstruction_Region.
- **Approved_Change_Region**: The union of approved moving-part sweep masks, Segmentation_Edge_Band, and Reconstruction_Region masks.
- **Reconstruction_Region**: A source-coordinate region that can become visible after an approved part leaves Reference_Pose but is occluded in Canonical_Master.
- **Reconstructed_Background**: The approved static layer in which each Approved_Moving_Part footprint is replaced by source-visible background pixels or Synthetic_Occlusion_Fill before the moving part is composited above the static layer.
- **Synthetic_Occlusion_Fill**: Authored pixels for a Reconstruction_Region; Synthetic_Occlusion_Fill is explicitly synthetic and is not claimed to reveal original hidden pixels.
- **Reconstruction_Boundary**: The swept area of an Approved_Moving_Part plus a maximum four-Canonical_Master-pixel feather used to avoid an exposed seam.
- **Provenance_Record**: Hash-bound metadata that records source identities, asset ancestry, authoring tool and version, settings, operator, creation time, method classification, and review status.
- **Approval_Record**: A dated record that identifies the exact asset hashes, reviewer, decision, and decision scope for segmentation, reconstruction, pivots, motion, depth, or fidelity.
- **Motion_Candidate**: A visually separable source region proposed for motion but not permitted to move until all approval criteria pass.
- **Approved_Moving_Part**: A Motion_Candidate with approved mask, pivot, sweep range, Reconstruction_Region coverage, semantic class, Motion_Profile, provenance, and visual review.
- **Static_Part**: A source region with no approved independent transform.
- **Allowed_Motion_Class**: One of `central-hand`, `subdial-hand`, `exposed-rotor`, `exposed-gear`, or `visible-oscillator`.
- **Static_Semantic_Class**: One of `dial-face`, `subdial-face`, `index`, `text`, `logo`, `bridge`, `plate`, `screw`, `jewel`, `case`, `crystal`, `background`, or `unclassified`.
- **Motion_Profile**: One Motion_Manifest entry containing a moving part’s pivot, direction, phase, period or cadence, angular bounds, Reference_Pose transform, and relationship evidence.
- **Motion_Manifest**: The complete set of approved Motion_Profile records in Layer_Asset_Manifest.
- **Rotation_Pivot**: The approved source-coordinate center around which a rotating or oscillating layer transforms.
- **Animation_Clock**: A monotonic, frame-rate-independent timeline that advances only during active enhanced motion.
- **Active_Elapsed_Time**: Animation_Clock duration excluding Enhanced_Loading_State, Static_Motion_Mode, page-hidden intervals, and Enhanced_Error_State.
- **Deterministic_Motion**: Motion for which identical manifest version, Reference_Pose, Active_Elapsed_Time, and application state produce identical transforms.
- **Kinematic_Rule_Set**: The measurable motion rules: timekeeping hands use declared constant sweep or declared discrete cadence; linked visible gears use declared opposite direction and inverse tooth-count ratio; visible oscillators use a bounded zero-mean periodic profile; rotation-only pivots move no more than 0.5 CSS pixel after projection.
- **Optional_Depth_Mode**: A separately gated, default-off 2.5D presentation that adds relative layer displacement or scale without creating or claiming geometry.
- **Depth_Profile**: A Layer_Asset_Manifest record containing approved per-layer depth values and bounded compact or expanded transforms.
- **Subtle_Depth_Bounds**: Relative foreground-to-background displacement no greater than 0.6 percent of the shorter viewport dimension, relative scale difference no greater than 1.5 percent, and perspective rotation no greater than 1 degree.
- **Interaction_Exclusion_Plane**: The decorative watch presentation area that accepts zero pointer, touch, keyboard, wheel, camera, microphone, or device-orientation input.
- **Header_Link**: Any existing predecessor Site_Masthead link, including the centered brand link.
- **Graph_Control**: One of the 13 existing native predecessor graph buttons.
- **Existing_Interactive_Control**: Any predecessor Header_Link, search control, Graph_Control, Definition_Dialog control, audience control, or skip link.
- **Existing_Control_Set**: The complete collection of Existing_Interactive_Control elements supplied by Predecessor_Baseline.
- **Enhancement_Profile**: The exact manifest-declared successor assets and enabled 2.5D capabilities required for the active viewport and Delivery_Phase.
- **Runtime_Readiness_Check**: Browser verification that every Enhancement_Profile asset returned a successful local response with expected media type and intrinsic dimensions and completed decode.
- **Enhanced_Loading_State**: The interval after Static_Fallback_Surface is available and before every Enhancement_Profile asset passes Runtime_Readiness_Check.
- **Enhanced_Ready_State**: The state entered atomically after every Enhancement_Profile asset passes Runtime_Readiness_Check.
- **Enhanced_Error_State**: The state entered when any required successor layer or successor manifest cannot load, decode, or validate.
- **Hero_Error_State**: The predecessor runtime state used when Static_Fallback_Surface cannot load or decode.
- **Static_Motion_Mode**: The state in which successor part motion and Optional_Depth_Mode are stopped because Reduced_Motion is active, Definition_Dialog is open, the page is hidden, animation support is unavailable, or enhanced presentation is unavailable.
- **Reduced_Motion**: The user preference reported through `prefers-reduced-motion` and the application’s existing reduced-motion state.
- **Definition_Dialog**: The predecessor modal definition panel.
- **Compact_Viewport**: A viewport no wider than 700 CSS pixels.
- **Expanded_Viewport**: A viewport wider than 700 CSS pixels.
- **Supported_Viewport_Range**: Viewport widths from 320 through 2560 CSS pixels at 100 percent zoom.
- **Visual_Fidelity_Threshold**: Source-space Reference_Pose equality for Immutable_Region; screenshot structural similarity of at least 0.995; and at least 99.5 percent of compared screenshot pixels having a maximum 8-bit per-channel difference no greater than 8 at Reference_Viewports.
- **Visual_Fidelity_Gate**: The automated comparison plus hash-bound human review that evaluates Reference_Pose, motion extremes, masks, seams, reconstruction, focal composition, and visual artifacts against Fidelity_Reference.
- **Alpha_Coverage_Gate**: A check requiring every visible pixel inside the watch presentation to receive opaque composed coverage at every approved motion and depth extreme.
- **Layer_Asset_Gate**: The finite local verifier that requires a valid Reference_Asset_Contract, complete Layer_Asset_Package, valid provenance and approvals, valid source-space composition, and all successor budgets before enhanced assets can be used.
- **Supported_Browser_Matrix**: Desktop Chrome and Edge version 120 or newer, Firefox version 121 or newer, Safari version 17.2 or newer, iOS Safari version 17.2 or newer, and Android Chrome version 120 or newer.
- **Enhancement_Performance_Budget**: No more than 1,572,864 added transfer bytes and 25,165,824 added decoded RGBA bytes for Compact_Viewport; no more than 3,145,728 added transfer bytes and 50,331,648 added decoded RGBA bytes for Expanded_Viewport; no more than eight added layer requests; zero layout shift; at least 95 percent of a finite 120-frame sample at or below 25 milliseconds; every sampled frame interval at or below 100 milliseconds; and each warmed existing interaction response, longest overlapping task, and cumulative blocking interval at or below 100 milliseconds.
- **UI_Behavior_Baseline**: The predecessor header names/order/destinations, search keyboard contract, 13 graph controls and relationships, audience behavior, dialog behavior, focus restoration, state preservation, hit-testing, layering, content, and accessible operation.
- **Dependency_Contract**: The predecessor `dependencies` and `devDependencies` sets and versions, which remain unchanged for this 2.5D feature.
- **Protected_Artifact_Set**: `components/canvas/WatchMovementCanvas.tsx`; every protected watch-specific CSS block identified by `tests/helpers/integrity-manifest.ts`; every file under `.kiro/specs/ai-coding-dictionary-inspired-site/`; and every file under `.kiro/specs/animated-watch-image-glass-header/`.
- **Inherited_Validation_Suite**: The predecessor asset verifier, unit/property tests, TypeScript check, ESLint check, production build, atlas browser smoke, and protected-integrity test.
- **Successor_Validation_Suite**: The Layer_Asset_Gate, source-space composition checks, motion checks, visual comparisons, component/integration tests, browser-matrix checks, performance probes, accessibility checks, and Inherited_Validation_Suite.
- **Delivery_Phase**: One ordered stage: source preparation, static layered reconstruction, approved part motion, Optional_Depth_Mode, or future full 3D.
- **Full_3D_Asset_Package**: A future independently modeled set of geometry, materials, rigging, camera, lighting, measurements, uncertainties, licenses, and provenance records.
- **Full_3D_Migration_Gate**: A future gate that requires a separately approved specification, fidelity parity, behavior parity, accessibility parity, browser compatibility, performance compliance, provenance, and atomic fallback before Full_3D_Asset_Package activation.

## Assumptions and Decisions for Review

1. Canonical_Master is the only visual source of truth for current appearance; Canonical_Master is not evidence of hidden geometry or hidden pixels.
2. The first enhanced release uses Layered_2_5D_Mode. Full 3D is a separate future project.
3. Allowed_Motion_Class defines eligibility only. The source may contain zero eligible parts after segmentation review.
4. Complete dial faces, subdial faces, markings, logos, bridges, plates, screws, jewels, case, crystal, background, and unclassified regions remain static unless a later approved requirement changes the relevant classification.
5. Motion uses a deterministic demonstration timeline by default rather than claiming real watch time or authentic movement calibration.
6. Optional_Depth_Mode is disabled by default and is time-driven. Direct pointer-following, drag, gyroscope, camera, and scroll parallax remain outside scope because the predecessor decorative layer accepts no input.
7. Synthetic_Occlusion_Fill may be manually painted or generated by a finite local tool, but the result remains labeled synthetic and requires hash-bound human approval.
8. Visual_Fidelity_Threshold, Supported_Browser_Matrix, and Enhancement_Performance_Budget are proposed initial acceptance bounds and require user confirmation during requirements review.
9. The only predecessor structural behavior extended in Enhanced_Ready_State is layered composition and approved per-part transforms. Static_Fallback_Surface and all user-facing predecessor behavior remain unchanged.

## Requirements

### Requirement 1: Preserve the Completed Predecessor as the Authoritative Baseline

**User Story:** As a project maintainer, I want the completed predecessor to remain immutable and available, so that the enhanced watch cannot regress the approved experience.

#### Acceptance Criteria

1. THE Layered_Watch_System SHALL use Predecessor_Baseline as Fidelity_Reference.
2. THE Preparation_Pipeline SHALL preserve Canonical_Master bytes before and after every pipeline run.
3. THE Layered_Watch_System SHALL preserve Predecessor_Baseline values for every Reference_Asset_Contract manifest field and asset hash.
4. THE Static_Fallback_Surface SHALL preserve the predecessor responsive `<picture>` and decorative `<img>` tree.
5. WHILE Enhanced_Ready_State is inactive, THE ELITE_WATCHES_Application SHALL render Static_Fallback_Surface.
6. THE Successor_Extension_Boundary SHALL confine successor assets and transforms to Layer_Asset_Package.
7. THE Layer_Asset_Manifest SHALL preserve the predecessor `segmentationApplied: false` record as metadata belonging to Reference_Asset_Contract.
8. THE Protected_Artifact_Set SHALL remain byte-for-byte equal to the recorded predecessor hashes.
9. WHEN Inherited_Validation_Suite runs, THE Inherited_Validation_Suite SHALL exit with status zero and every predecessor assertion passing.
10. IF a successor artifact changes Reference_Asset_Contract, THEN THE Layer_Asset_Gate SHALL reject Layer_Asset_Package.
11. IF a successor behavior falls outside Successor_Extension_Boundary, THEN THE Successor_Validation_Suite SHALL report a blocking scope-boundary failure.
12. THE Dependency_Contract SHALL remain byte-for-byte equal to the predecessor dependency fields.

### Requirement 2: Establish Local, Hash-Bound Layer Asset Provenance

**User Story:** As a project maintainer, I want every layered asset tied to the exact approved source and authoring history, so that no substitute image or untraceable interpretation enters the experience.

#### Acceptance Criteria

1. THE Layer_Asset_Manifest SHALL identify Canonical_Master by canonical project-relative path, SHA-256, byte length, dimensions, media type, and color metadata.
2. THE Layer_Asset_Manifest SHALL identify Predecessor_Spec as the completed parent specification.
3. THE Layer_Asset_Manifest SHALL assign a stable unique ID to every Layer_Record, Segmentation_Mask, Reconstruction_Region, Synthetic_Occlusion_Fill, and public presentation asset.
4. THE Provenance_Record SHALL record the immediate parent hashes for every derived asset.
5. THE Provenance_Record SHALL record authoring tool name, tool version, settings, operator, creation time, and method classification for every derived asset.
6. THE Preparation_Pipeline SHALL perform zero network requests.
7. THE Preparation_Pipeline SHALL use only Canonical_Master and explicitly recorded local authored data as visual inputs.
8. THE Preparation_Pipeline SHALL normalize browser presentation assets to a documented color space supported by Supported_Browser_Matrix.
9. THE Layer_Asset_Manifest SHALL record media type, magic signature, SHA-256, byte length, dimensions, decoded pixels, decoded RGBA bytes, and color metadata for every public presentation asset.
10. THE Layer_Asset_Manifest SHALL use Canonical_Master coordinates for masks, pivots, source rectangles, and reconstruction regions.
11. THE Layer_Asset_Manifest SHALL classify every non-source pixel as synthetic.
12. THE Layer_Asset_Manifest SHALL contain zero claim that Canonical_Master supplies hidden geometry, depth, or occluded source pixels.
13. IF an asset path is absolute, remote, data-scheme, traversal-based, outside an approved local directory, or under an unapproved public path, THEN THE Layer_Asset_Gate SHALL reject Layer_Asset_Package.
14. IF a derived asset lacks complete Provenance_Record metadata, THEN THE Layer_Asset_Gate SHALL reject the derived asset.
15. THE Preparation_Pipeline SHALL keep Canonical_Master outside `public`.

### Requirement 3: Segment Only Visible, Reviewable Source Regions

**User Story:** As a visual reviewer, I want segmentation to describe visible source regions precisely, so that moving layers preserve the existing watch rather than inventing a replacement.

#### Acceptance Criteria

1. THE Layer_Record SHALL identify one Allowed_Motion_Class or one Static_Semantic_Class.
2. THE Layer_Record SHALL contain a source rectangle bounded by Canonical_Master dimensions.
3. THE Segmentation_Mask SHALL use the same pixel coordinate space as Canonical_Master.
4. THE Layer_Record SHALL record an explicit z-order.
5. THE Layer_Record SHALL record the count of Source_Visible_Pixel values assigned to the layer.
6. THE Layer_Record SHALL distinguish Source_Visible_Pixel coverage from Synthetic_Occlusion_Fill coverage.
7. THE Layer_Asset_Manifest SHALL assign every visible source region to a reviewed static background or reviewed Layer_Record.
8. WHEN all layers use Reference_Pose, THE Layered_Watch_System SHALL satisfy Visual_Fidelity_Threshold.
9. THE Layer_Asset_Manifest SHALL classify every unreviewed region as Static_Part.
10. IF a proposed boundary cannot be distinguished from adjacent source content at 200 percent source zoom, THEN THE Layer_Asset_Manifest SHALL classify the proposed region as Static_Part.
11. IF a Motion_Candidate lacks a reviewable full visible outline or approved occlusion plan, THEN THE Layer_Asset_Manifest SHALL classify the Motion_Candidate as Static_Part.
12. THE Segmentation_Mask SHALL preserve antialiased edge pixels through recorded alpha values.
13. THE Layer_Asset_Manifest SHALL record the compositing order for every overlapping mask.
14. THE Approval_Record SHALL identify the exact hashes reviewed for every approved Segmentation_Mask.
15. IF a Reference_Pose composition changes Immutable_Region, THEN THE Visual_Fidelity_Gate SHALL reject Layer_Asset_Package.

### Requirement 4: Reconstruct Disoccluded Pixels Without Claiming Hidden Source Truth

**User Story:** As a visual reviewer, I want newly exposed areas filled and provenance-labeled, so that moving parts do not reveal holes or misrepresent synthetic pixels as original detail.

#### Acceptance Criteria

1. WHEN an Approved_Moving_Part leaves Reference_Pose, THE Layered_Watch_System SHALL provide composed coverage for every exposed Reconstruction_Region pixel.
2. THE Synthetic_Occlusion_Fill SHALL remain inside Reconstruction_Boundary.
3. THE Layer_Asset_Manifest SHALL label every Synthetic_Occlusion_Fill pixel as synthetic.
4. THE Provenance_Record SHALL identify the method used to create every Synthetic_Occlusion_Fill.
5. THE Approval_Record SHALL identify the exact Synthetic_Occlusion_Fill hash reviewed at 100 percent and 200 percent source zoom.
6. THE Approval_Record SHALL include review of every declared motion extreme.
7. THE Preparation_Pipeline SHALL preserve Immutable_Region byte-for-byte in source-space Reference_Pose composition.
8. WHEN Alpha_Coverage_Gate evaluates a motion or depth extreme, THE Alpha_Coverage_Gate SHALL report zero transparent or unpainted presentation pixels.
9. IF a Reconstruction_Region extends outside Reconstruction_Boundary, THEN THE Layer_Asset_Gate SHALL reject the Reconstruction_Region.
10. IF a Synthetic_Occlusion_Fill lacks Approval_Record, THEN THE Layer_Asset_Gate SHALL reject the related Motion_Candidate.
11. IF a reconstruction review identifies a seam, duplicate edge, texture discontinuity, or unrelated fabricated object, THEN THE Layer_Asset_Manifest SHALL classify the related Motion_Candidate as Static_Part.
12. THE Layered_Watch_System SHALL expose zero description of Synthetic_Occlusion_Fill as recovered, original, measured, or source-visible content.
13. THE Reconstructed_Background SHALL replace the complete Reference_Pose footprint of every Approved_Moving_Part with approved background coverage.
14. WHEN an Approved_Moving_Part leaves Reference_Pose, THE Reconstructed_Background SHALL expose zero residual source silhouette of the Approved_Moving_Part.

### Requirement 5: Restrict Motion to Explicitly Approved Visible Parts

**User Story:** As a visitor, I want only credible visible parts to move, so that animation adds life without changing the identity of the reference watch.

#### Acceptance Criteria

1. THE Layered_Watch_System SHALL apply an independent transform only to Approved_Moving_Part.
2. THE Motion_Manifest SHALL limit moving-part classifications to Allowed_Motion_Class.
3. IF a visible central hand has an approved mask, Rotation_Pivot, Reconstruction_Region coverage, Motion_Profile, and Approval_Record, THEN THE Motion_Manifest SHALL permit `central-hand` classification.
4. IF a visible subdial hand has an approved mask, Rotation_Pivot, Reconstruction_Region coverage, Motion_Profile, and Approval_Record, THEN THE Motion_Manifest SHALL permit `subdial-hand` classification.
5. IF a visible rotor or gear has an approved rotational boundary, Rotation_Pivot, Reconstruction_Region coverage, Motion_Profile, and Approval_Record, THEN THE Motion_Manifest SHALL permit `exposed-rotor` or `exposed-gear` classification.
6. IF a visible oscillator has an approved pivot, angular range, Reconstruction_Region coverage, Motion_Profile, and Approval_Record, THEN THE Motion_Manifest SHALL permit `visible-oscillator` classification.
7. THE Layered_Watch_System SHALL apply zero independent transform to every Static_Part.
8. IF a complete subdial face lacks source evidence and explicit approval for rotating-disc behavior, THEN THE Layer_Asset_Manifest SHALL classify the subdial face as Static_Part.
9. IF a candidate motion exposes an unapproved Reconstruction_Region, THEN THE Motion_Manifest SHALL disable the candidate motion.
10. THE Approval_Record SHALL list every Approved_Moving_Part ID permitted in a release.
11. IF the approved moving-part list is empty, THEN THE Layered_Watch_System SHALL remain in Reference_Pose.
12. THE Layered_Watch_System SHALL keep a moving part’s source-derived highlights attached to the same part layer.

### Requirement 6: Produce Deterministic and Measurably Plausible Motion

**User Story:** As a visitor, I want watch motion to remain coherent across frame rates and sessions, so that the movement appears intentional rather than random or mechanically contradictory.

#### Acceptance Criteria

1. THE Motion_Manifest SHALL record Rotation_Pivot, direction, phase, period or cadence, angular bounds, Reference_Pose transform, and motion class for every Approved_Moving_Part.
2. THE Animation_Clock SHALL derive transforms from Active_Elapsed_Time rather than rendered frame count.
3. WHEN Layer_Asset_Manifest hash, Active_Elapsed_Time, and application state are equal, THE Layered_Watch_System SHALL produce equal layer transforms.
4. THE Layered_Watch_System SHALL use zero unrecorded random input for motion.
5. WHERE an Approved_Moving_Part is a timekeeping hand, THE Motion_Manifest SHALL select declared constant sweep or declared discrete cadence.
6. WHERE central hands are approved as hour, minute, and second indicators, THE Motion_Manifest SHALL use an hour-to-minute period ratio of 12:1 and a minute-to-second period ratio of 60:1.
7. WHERE two visible gears are approved as mechanically linked and tooth counts are recorded, THE Motion_Manifest SHALL assign opposite directions and inverse tooth-count angular-speed ratios.
8. WHERE an Approved_Moving_Part is a visible oscillator, THE Motion_Manifest SHALL define a bounded zero-mean periodic angular profile.
9. WHEN a rotation-only part transforms, THE Layered_Watch_System SHALL keep the projected Rotation_Pivot within 0.5 CSS pixel of the approved pivot.
10. WHEN a periodic motion reaches a cycle boundary, THE Layered_Watch_System SHALL preserve transform continuity modulo complete rotation.
11. THE Layered_Watch_System SHALL keep every transform within Motion_Manifest bounds.
12. THE Motion_Manifest SHALL record evidence or authored-assumption status for every kinematic relationship.
13. IF a claimed relationship lacks visible evidence or authored-assumption labeling, THEN THE Layer_Asset_Gate SHALL reject the relationship.
14. WHEN the runtime frame rate changes, THE Layered_Watch_System SHALL preserve the transform associated with Active_Elapsed_Time.
15. WHEN Enhanced_Ready_State begins, THE Animation_Clock SHALL start from the approved Reference_Pose phase.
16. WHILE Enhanced_Ready_State is active and Static_Motion_Mode is inactive, THE Layered_Watch_System SHALL apply Inherited_Global_Transform uniformly to Reconstructed_Background and every successor layer.
17. THE Layered_Watch_System SHALL compose each Motion_Profile transform after Inherited_Global_Transform.
18. WHILE Enhanced_Ready_State is active, THE Layered_Watch_System SHALL derive Inherited_Global_Transform phase from Animation_Clock.

### Requirement 7: Bound Optional Depth and Preserve the Noninteractive Plane

**User Story:** As a visitor, I want an optional restrained sense of depth without losing control access or being subjected to invasive input tracking.

#### Acceptance Criteria

1. THE Optional_Depth_Mode SHALL be disabled by default.
2. WHERE Optional_Depth_Mode is enabled, THE Layered_Watch_System SHALL use only approved Layer_Record z-order and depth values.
3. WHERE Optional_Depth_Mode is enabled, THE Layered_Watch_System SHALL keep relative transforms within Subtle_Depth_Bounds.
4. WHERE Optional_Depth_Mode is enabled, THE Animation_Clock SHALL drive depth transforms deterministically.
5. WHERE Optional_Depth_Mode is enabled, THE Layered_Watch_System SHALL label depth values as authored interpretations in Layer_Asset_Manifest.
6. THE Interaction_Exclusion_Plane SHALL accept zero pointer or touch events.
7. THE Interaction_Exclusion_Plane SHALL expose zero keyboard focus stops.
8. THE Layered_Watch_System SHALL add zero pointer-tracking, wheel-tracking, drag, camera, microphone, or device-orientation input.
9. THE Layered_Watch_System SHALL add zero control that changes Existing_Interactive_Control focus order.
10. WHEN Optional_Depth_Mode reaches any declared extreme, THE Layered_Watch_System SHALL satisfy Alpha_Coverage_Gate.
11. IF Optional_Depth_Mode cannot satisfy Visual_Fidelity_Threshold or Enhancement_Performance_Budget, THEN THE Layered_Watch_System SHALL keep Optional_Depth_Mode disabled.
12. WHILE Compact_Viewport is active, THE Layered_Watch_System SHALL use an approved compact Depth_Profile bounded by Subtle_Depth_Bounds.

### Requirement 8: Preserve Responsive Composition and Reference Fidelity

**User Story:** As a visitor on any supported display, I want the layered watch to retain the exact framing and identity of the approved flat reference.

#### Acceptance Criteria

1. WHILE Supported_Viewport_Range is active, THE Static_Fallback_Surface SHALL retain predecessor cover sizing and focal-point behavior.
2. WHILE Supported_Viewport_Range is active, THE Layered_Watch_System SHALL map every layer through the same source-to-viewport cover transform as Static_Fallback_Surface.
3. WHEN all parts use Reference_Pose, THE Layered_Watch_System SHALL satisfy Visual_Fidelity_Threshold at Reference_Viewports.
4. WHEN all parts use Reference_Pose, THE Layered_Watch_System SHALL keep layer alignment error at or below 0.5 CSS pixel at approved pivots and mask boundaries.
5. THE Preparation_Pipeline SHALL keep Immutable_Region byte-for-byte equal to Canonical_Master in source-space Reference_Pose composition.
6. THE Visual_Fidelity_Gate SHALL confine permitted moving-pose visual differences to Approved_Change_Region.
7. WHEN viewport width crosses 700 CSS pixels, THE Layered_Watch_System SHALL preserve the active motion phase and UI_Behavior_Baseline state.
8. WHEN viewport orientation changes, THE Layered_Watch_System SHALL preserve Active_Elapsed_Time while recomputing layer mapping.
9. WHILE Supported_Viewport_Range is active, THE Layered_Watch_System SHALL produce zero page-level horizontal overflow.
10. WHILE Supported_Viewport_Range is active, THE Layered_Watch_System SHALL produce zero layout shift attributable to successor layers.
11. THE Layered_Watch_System SHALL preserve the browser-selected predecessor derivative as Static_Fallback_Surface.
12. IF a viewport cannot satisfy layer alignment and Alpha_Coverage_Gate, THEN THE Layered_Watch_System SHALL render only Static_Fallback_Surface.
13. THE Visual_Fidelity_Gate SHALL compare Reference_Pose, every motion extreme, and every depth extreme at Reference_Viewports.

### Requirement 9: Honor Reduced Motion, Dialog, Visibility, and Static States

**User Story:** As a visitor who requests reduced motion or opens the definition dialog, I want a stable watch presentation without losing the approved reference appearance.

#### Acceptance Criteria

1. WHILE Reduced_Motion is active, THE Layered_Watch_System SHALL apply zero part animation.
2. WHILE Reduced_Motion is active, THE Layered_Watch_System SHALL apply zero depth animation.
3. WHEN Reduced_Motion is active before Enhanced_Ready_State, THE Layered_Watch_System SHALL keep Static_Fallback_Surface visible in its predecessor reduced-motion state.
4. WHEN Definition_Dialog opens, THE Animation_Clock SHALL pause at the current Active_Elapsed_Time.
5. WHILE Definition_Dialog is open, THE Layered_Watch_System SHALL preserve the paused layer transforms.
6. WHILE Definition_Dialog is open, THE Layered_Watch_System SHALL preserve the predecessor static watch opacity of `0.72` across the composed watch presentation.
7. WHEN Definition_Dialog closes and Reduced_Motion is inactive, THE Animation_Clock SHALL resume from the paused Active_Elapsed_Time.
8. WHEN the page becomes hidden, THE Animation_Clock SHALL pause.
9. WHEN the page becomes visible and Static_Motion_Mode is inactive, THE Animation_Clock SHALL resume from the Active_Elapsed_Time recorded when the page became hidden.
10. IF required animation support is unavailable, THEN THE Layered_Watch_System SHALL render Reference_Pose over Static_Fallback_Surface.
11. WHILE Static_Motion_Mode is active, THE Existing_Control_Set SHALL retain UI_Behavior_Baseline operation.
12. WHEN Reduced_Motion preference changes, THE Layered_Watch_System SHALL apply the corresponding static or active mode by the next rendered frame.
13. WHILE Reduced_Motion is active, THE Layered_Watch_System SHALL apply zero Inherited_Global_Transform animation.
14. WHEN Definition_Dialog opens, THE Layered_Watch_System SHALL pause Inherited_Global_Transform at the current transform.

### Requirement 10: Keep Loading and Failure Atomic over the Existing Fallback

**User Story:** As a visitor, I want the approved watch to remain visible while enhancement assets load or fail, so that layered motion never leaves a blank or partially assembled hero.

#### Acceptance Criteria

1. WHILE Enhanced_Loading_State is active, THE ELITE_WATCHES_Application SHALL keep Static_Fallback_Surface visible.
2. WHILE Enhanced_Loading_State is active, THE Layered_Watch_System SHALL expose zero partially assembled layer composition.
3. WHEN every Enhancement_Profile asset passes Runtime_Readiness_Check, THE Layered_Watch_System SHALL enter Enhanced_Ready_State atomically.
4. IF any Enhancement_Profile asset fails to load or decode, THEN THE Layered_Watch_System SHALL enter Enhanced_Error_State.
5. WHILE Enhanced_Error_State is active, THE ELITE_WATCHES_Application SHALL render Static_Fallback_Surface.
6. WHILE Enhanced_Error_State is active, THE Existing_Control_Set SHALL retain UI_Behavior_Baseline operation.
7. WHILE Enhanced_Error_State is active, THE Layered_Watch_System SHALL request zero substitute, remote, or generated runtime source.
8. THE Layered_Watch_System SHALL perform zero automatic retry after Enhanced_Error_State during the same navigation.
9. THE Layered_Watch_System SHALL expose Enhanced_Error_State through a deterministic diagnostic attribute.
10. THE Layered_Watch_System SHALL keep successor diagnostics outside the accessibility tree.
11. IF Static_Fallback_Surface fails, THEN THE ELITE_WATCHES_Application SHALL retain Hero_Error_State behavior.
12. THE Layered_Watch_System SHALL reserve final hero layout before successor asset completion.
13. IF the browser is outside Supported_Browser_Matrix, THEN THE ELITE_WATCHES_Application SHALL render only Static_Fallback_Surface.
14. WHILE the browser is outside Supported_Browser_Matrix, THE Layered_Watch_System SHALL request zero Layer_Asset_Package resources.
15. THE Layered_Watch_System SHALL request only assets listed by Enhancement_Profile.

### Requirement 11: Preserve Accessibility and Existing Application Behavior

**User Story:** As a visitor using pointer, touch, keyboard, reduced-motion settings, or assistive technology, I want the enhanced visual to leave every existing operation unchanged.

#### Acceptance Criteria

1. THE Layered_Watch_System SHALL expose successor visual layers as decorative content.
2. THE Layered_Watch_System SHALL add zero accessible name, role, live region, or focus stop for successor visual layers.
3. THE Layered_Watch_System SHALL preserve UI_Behavior_Baseline accessible tree for Existing_Interactive_Control elements.
4. THE Layered_Watch_System SHALL preserve UI_Behavior_Baseline focus order.
5. THE Layered_Watch_System SHALL preserve all 13 existing Graph_Control names, presentation IDs, hit targets, and relationship states.
6. THE Layered_Watch_System SHALL preserve predecessor header labels, DOM order, destinations, responsive visibility, and target sizes.
7. THE Layered_Watch_System SHALL preserve predecessor search keyboard navigation, selection, clearing, and focus restoration.
8. THE Layered_Watch_System SHALL preserve predecessor Definition_Dialog opening, Escape closing, focus trap, and opener restoration.
9. WHEN viewport width crosses 700 CSS pixels, THE ELITE_WATCHES_Application SHALL preserve audience, selected term, preview, search query, focus, and dialog state.
10. THE Layered_Watch_System SHALL preserve predecessor skip-link destination and focus reveal behavior.
11. THE Layered_Watch_System SHALL preserve forced-colors boundaries and focus indicators for Existing_Interactive_Control elements.
12. WHILE Reduced_Motion is active, THE Existing_Control_Set SHALL remain operable.
13. THE Layered_Watch_System SHALL keep every decorative successor layer below Existing_Interactive_Control elements and Definition_Dialog.
14. WHEN an Existing_Interactive_Control center point is hit-tested, THE ELITE_WATCHES_Application SHALL return the same control as Predecessor_Baseline.
15. THE Layered_Watch_System SHALL preserve predecessor dictionary content, graph labels, relationship data, search placeholder, browse instruction, and definition content.

### Requirement 12: Enforce Performance and Browser Compatibility Budgets

**User Story:** As a visitor, I want layered motion to remain responsive and bounded on supported browsers, so that visual depth does not degrade the explorer.

#### Acceptance Criteria

1. WHILE Compact_Viewport is active, THE Layered_Watch_System SHALL keep added transfer bytes at or below 1,572,864.
2. WHILE Expanded_Viewport is active, THE Layered_Watch_System SHALL keep added transfer bytes at or below 3,145,728.
3. WHILE Compact_Viewport is active, THE Layered_Watch_System SHALL keep added decoded RGBA bytes at or below 25,165,824.
4. WHILE Expanded_Viewport is active, THE Layered_Watch_System SHALL keep added decoded RGBA bytes at or below 50,331,648.
5. THE Layered_Watch_System SHALL request no more than eight successor layer resources during one navigation.
6. WHEN a finite 120-frame enhanced-motion sample runs, THE Layered_Watch_System SHALL keep at least 95 percent of frame intervals at or below 25 milliseconds.
7. WHEN a finite 120-frame enhanced-motion sample runs, THE Layered_Watch_System SHALL keep every frame interval at or below 100 milliseconds.
8. WHEN a warmed Existing_Interactive_Control sample runs, THE ELITE_WATCHES_Application SHALL complete visual response within 100 milliseconds.
9. WHEN a warmed Existing_Interactive_Control sample runs, THE ELITE_WATCHES_Application SHALL keep the longest overlapping main-thread task at or below 100 milliseconds.
10. WHEN a warmed Existing_Interactive_Control sample runs, THE ELITE_WATCHES_Application SHALL keep cumulative blocking at or below 100 milliseconds.
11. THE Layered_Watch_System SHALL add zero layout shift.
12. THE Layered_Watch_System SHALL add zero production runtime package dependency.
13. THE Layered_Watch_System SHALL use locally served successor assets only.
14. WHILE a browser belongs to Supported_Browser_Matrix, THE Layered_Watch_System SHALL provide Enhanced_Ready_State or deterministic Static_Fallback_Surface.
15. IF a required enhanced capability is absent, THEN THE Layered_Watch_System SHALL use Static_Fallback_Surface.
16. THE Layered_Watch_System SHALL add zero Blender model, WebGL renderer, production hero canvas, or runtime 3D engine in this feature.
17. WHEN Reference_Viewports are tested in Supported_Browser_Matrix, THE ELITE_WATCHES_Application SHALL report zero successor-caused runtime error, console error, hydration recovery, or failed baseline request.

### Requirement 13: Block Invalid Assets, Motion, Fidelity, and Regressions

**User Story:** As a project maintainer, I want finite automated and visual gates, so that incomplete layers or regressions cannot enter development, tests, or production builds.

#### Acceptance Criteria

1. THE Layer_Asset_Gate SHALL verify Reference_Asset_Contract before verifying Layer_Asset_Package.
2. THE Layer_Asset_Gate SHALL verify manifest schema, canonical paths, media signatures, MIME types, hashes, lengths, dimensions, decoded memory, and package completeness.
3. THE Layer_Asset_Gate SHALL verify mask bounds, source-coordinate consistency, z-order completeness, pivot bounds, motion bounds, and depth bounds.
4. THE Layer_Asset_Gate SHALL verify complete Provenance_Record and Approval_Record references.
5. THE Layer_Asset_Gate SHALL verify Enhancement_Performance_Budget transfer, decoded-memory, and request-count limits.
6. THE Visual_Fidelity_Gate SHALL verify Visual_Fidelity_Threshold before approved part motion can be enabled.
7. THE Alpha_Coverage_Gate SHALL verify Reference_Pose and every declared motion and depth extreme.
8. THE Successor_Validation_Suite SHALL verify Deterministic_Motion across generated Active_Elapsed_Time samples and supported state combinations.
9. THE Successor_Validation_Suite SHALL verify Static_Motion_Mode, Enhanced_Loading_State, Enhanced_Error_State, and unsupported-browser fallback.
10. THE Successor_Validation_Suite SHALL verify UI_Behavior_Baseline before and after enhanced activation.
11. THE Successor_Validation_Suite SHALL execute every Inherited_Validation_Suite assertion unchanged.
12. THE Layer_Asset_Gate SHALL perform zero network requests and zero input writes.
13. THE Layer_Asset_Gate SHALL verify pre-inspection and post-inspection hashes for Canonical_Master, Reference_Asset_Contract, and Layer_Asset_Package inputs.
14. IF any gate fails, THEN THE Layered_Watch_System SHALL remain blocked from Enhanced_Ready_State.
15. IF any protected hash differs, THEN THE Successor_Validation_Suite SHALL fail with a deterministic protected-artifact code.
16. WHEN an npm predevelopment, pretest, or prebuild lifecycle starts, THE Layer_Asset_Gate SHALL complete after Reference_Asset_Contract verification and before the requested lifecycle command.
17. THE Layer_Asset_Gate SHALL report deterministic first-failure codes for missing, schema, path, provenance, identity, segmentation, reconstruction, motion, depth, fidelity, budget, and protected-integrity failures.
18. THE Successor_Validation_Suite SHALL retain raw visual, timing, network, console, and failure evidence for each finite browser run.

### Requirement 14: Deliver the 2.5D Feature Through Ordered, Reversible Phases

**User Story:** As a project maintainer, I want each visual capability independently gated, so that motion and depth cannot bypass source or fidelity approval.

#### Acceptance Criteria

1. THE Layered_Watch_System SHALL enforce Delivery_Phase order as source preparation, static layered reconstruction, approved part motion, Optional_Depth_Mode, and future full 3D.
2. WHEN source preparation is incomplete, THE Layered_Watch_System SHALL keep every later Delivery_Phase disabled.
3. WHEN static layered reconstruction fails Visual_Fidelity_Gate, THE Layered_Watch_System SHALL keep approved part motion disabled.
4. WHEN approved part motion fails motion, reconstruction, performance, or accessibility validation, THE Layered_Watch_System SHALL keep Optional_Depth_Mode disabled.
5. THE Layer_Asset_Manifest SHALL record an independent approval status for every Delivery_Phase in this feature.
6. WHILE a Delivery_Phase is disabled, THE ELITE_WATCHES_Application SHALL use the latest earlier approved Delivery_Phase.
7. IF an enabled Delivery_Phase fails at runtime, THEN THE Layered_Watch_System SHALL return atomically to Static_Fallback_Surface for the navigation.
8. WHEN Optional_Depth_Mode is disabled, THE Layered_Watch_System SHALL preserve approved part motion assets byte-for-byte.
9. THE Layered_Watch_System SHALL keep Static_Fallback_Surface available through every 2.5D Delivery_Phase.
10. THE Layer_Asset_Manifest SHALL identify the exact manifest and asset hashes approved for every released Delivery_Phase.

### Requirement 15: Preserve a Truthful, Separately Gated Full-3D Migration Path

**User Story:** As a future maintainer, I want the 2.5D work to support a later full-3D replacement without presenting inferred geometry as source fact.

#### Acceptance Criteria

1. THE Full_3D_Migration_Gate SHALL require a separate approved requirements, design, and tasks specification before runtime 3D activation.
2. THE Full_3D_Asset_Package SHALL reference Canonical_Master SHA-256 as appearance provenance.
3. THE Full_3D_Asset_Package SHALL record every additional photograph, measurement, drawing, model source, license, and authored assumption used for geometry or materials.
4. THE Full_3D_Asset_Package SHALL label geometry not established by measured evidence as authored reconstruction.
5. THE Full_3D_Asset_Package SHALL map approved semantic part IDs to corresponding Layer_Record IDs where a correspondence exists.
6. THE Full_3D_Asset_Package SHALL preserve Reference_Pose camera framing against Fidelity_Reference.
7. THE Full_3D_Migration_Gate SHALL require Visual_Fidelity_Threshold at Reference_Viewports.
8. THE Full_3D_Migration_Gate SHALL require UI_Behavior_Baseline parity.
9. THE Full_3D_Migration_Gate SHALL require reduced-motion, static-dialog, loading, error, accessibility, browser, and performance acceptance bounds defined by the future specification.
10. THE Full_3D_Migration_Gate SHALL require an atomic Static_Fallback_Surface path.
11. THE Layer_Asset_Package SHALL remain independently valid after a future Full_3D_Asset_Package is created.
12. IF Full_3D_Migration_Gate fails, THEN THE ELITE_WATCHES_Application SHALL keep the approved 2.5D or Static_Fallback_Surface presentation.
13. THE Layered_Watch_System SHALL activate zero Full_3D_Asset_Package within this feature scope.
14. THE Full_3D_Asset_Package SHALL contain zero claim that Canonical_Master alone supplied hidden geometry, dimensions, materials, or mechanisms.
