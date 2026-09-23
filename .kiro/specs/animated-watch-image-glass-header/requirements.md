# Requirements Document

## Introduction

The Animated Watch Image and Glass Header feature replaces the mounted procedural watch canvas in the ELITE WATCHES landing experience with responsive browser derivatives generated from one immutable, user-supplied archival PNG master. The lossless master remains outside `public` at `source/assets/elite-watch-master.png`; it is never served directly, moved, overwritten, or treated as a browser transfer asset. A checked-in AVIF primary source set and WebP fallback source set are generated from that exact master, integrity-recorded, and rendered through one decorative `<picture>` tree.

The feature gives the selected derivative restrained cinematic movement through a bounded whole-image transform, supplies a static reduced-motion presentation, and blocks development, tests, and production builds unless both the exact master and every required derivative pass a local integrity contract. It also presents the existing masthead as an inset rounded smoke-glass bar without changing information architecture or application behavior. Protected historical canvas source, watch-specific CSS, and historical specifications remain byte-for-byte unchanged.

## Glossary

- **ELITE_WATCHES_Application**: The Next.js application rooted at `/Users/ankitkumar/Desktop/CODE/activity`.
- **Canonical_Master**: The exact user-supplied archival PNG at project-relative path `source/assets/elite-watch-master.png`, SHA-256 `7480bd94014cf1c5219f9abdcd0206b6848e2d353ede4e276d6e9a1001f8c66b`. It is source material, not a public resource.
- **Asset_Manifest**: `data/watch-image-asset.json`, containing exact Canonical_Master identity and preflight evidence, derivative policy, focal points, budgets, future-layer compatibility, and—after generation—exact identity metadata for every browser derivative.
- **Derivative_Set**: Ten checked-in presentation files under `public/assets/watch`: AVIF and WebP at 690×376, 1035×564, 1380×752, 2070×1128, and 2760×1504.
- **AVIF_Source_Set**: The five AVIF members of Derivative_Set, used as the primary `<source type="image/avif">` candidates.
- **WebP_Fallback_Set**: The five WebP members of Derivative_Set, used by the single fallback `<img>`.
- **Browser_Selected_Resource**: The one Derivative_Set member selected by `<picture>`, `srcset`, `sizes`, browser format support, viewport, and device-pixel ratio.
- **Valid_Source_State**: Canonical_Master exists at the exact project-relative path and matches every manifest identity, structure, decode, profile, alpha, and preflight field.
- **Valid_Derivative_State**: Derivative_Set is complete, uses only canonical public paths and approved formats/dimensions/encoder settings, matches all manifest hashes and byte lengths, decodes successfully, and satisfies all transfer and decoded-memory budgets.
- **Asset_Gate**: The finite local verifier that requires Valid_Source_State and Valid_Derivative_State before development, tests, or production builds.
- **Source_Preflight**: Byte/container/decode inspection plus human visual inspection tied to Canonical_Master SHA-256.
- **Hero_Backdrop**: The image-backed component mounted behind the existing interface.
- **Hero_Picture**: The sole responsive `<picture>` element rendered by Hero_Backdrop.
- **Hero_Image**: The sole decorative `<img>` inside Hero_Picture; its current source resolves to Browser_Selected_Resource.
- **Hero_Loading_State**: The interval before Hero_Image reports load success or failure.
- **Hero_Error_State**: The runtime state entered when Browser_Selected_Resource cannot load or decode.
- **Normal_Motion_Mode**: Hero_Image is ready, reduced motion is inactive, and the definition dialog is closed.
- **Static_Motion_Mode**: Hero_Image is ready and either reduced motion is active or the definition dialog is open.
- **Compact_Viewport**: A viewport no wider than 700 CSS pixels.
- **Expanded_Viewport**: A viewport wider than 700 CSS pixels.
- **Supported_Viewport_Range**: Viewport widths from 320 through 2560 CSS pixels at 100 percent zoom.
- **Compact_Focal_Point**: The Asset_Manifest compact focal point, initially 50 percent horizontal and vertical.
- **Expanded_Focal_Point**: The Asset_Manifest expanded focal point, initially 50 percent horizontal and vertical.
- **Motion_Frame**: One Hero_Image transform point defined by scale and two-dimensional translation.
- **Cover_Guard**: The per-edge margin produced by scale is at least the absolute translation on both axes.
- **Selected_Transfer_Budget**: At most 1,572,864 bytes for Browser_Selected_Resource; each AVIF is additionally capped at 1,048,576 bytes.
- **Selected_Decode_Budget**: At most 4,151,040 decoded pixels and 16,604,160 RGBA bytes for Browser_Selected_Resource.
- **Aggregate_Derivative_Budget**: At most 12,582,912 bytes for all ten derivative files.
- **Layer_Compatibility_Record**: Manifest data tying any future 2.5D layer manifest to Canonical_Master SHA-256 while confirming that this feature performs no segmentation.
- **Site_Masthead**: The existing `.site-masthead` header in `components/EliteWatchesExperience.tsx`.
- **Glass_Header**: The inset rounded visual presentation applied to Site_Masthead.
- **Primary_Navigation**: The existing “Primary navigation” landmark containing COLLECTION and ABOUT.
- **Account_Navigation**: The existing “Account navigation” landmark containing CONTACT and LOGIN.
- **Brand_Link**: The centered ELITE WATCHES link named “ELITE WATCHES home”.
- **Header_Link**: Any existing Site_Masthead link, including Brand_Link.
- **Header_Readability_Scrim**: The static dark gradient below Site_Masthead and above Hero_Backdrop.
- **Audited_Overlay**: Any of `.site-masthead`, `.search-pill`, `.search-results`, `.definition-layer`, `.definition-panel`, or `.definition-panel__footer`.
- **Backdrop_Filter**: Either `backdrop-filter` or `-webkit-backdrop-filter`.
- **Reduced_Motion**: The user preference reported through `prefers-reduced-motion` and the existing Framer Motion hook.
- **Reduced_Transparency**: The `prefers-reduced-transparency` preference where supported.
- **Increased_Contrast**: The `prefers-contrast: more` preference where supported.
- **Forced_Colors_Mode**: Active browser forced-colors presentation.
- **Watch_Explorer**: The existing `#watch-explorer` main landmark.
- **Graph_Control**: One of the 13 existing native `NodeGraph` buttons.
- **Graph_Relationship**: An edge ID and emphasis state produced by the existing graph model.
- **Definition_Dialog**: The existing modal definition panel.
- **Preserved_Application_State**: Current audience, selected term, definition opener, search query, graph preview, focus, and dialog state.
- **Protected_Artifact**: `components/canvas/WatchMovementCanvas.tsx`, every watch-specific CSS block in `tests/helpers/integrity-manifest.ts`, and every file under `.kiro/specs/ai-coding-dictionary-inspired-site/`.
- **Reference_Browser**: The local Chrome or Chromium instance used by `scripts/atlas-visibility-smoke.mjs` at device-pixel ratio 1.
- **Frame_Interval**: Browser performance time between consecutive animation frames in the finite hero probe.
- **Project_Validation_Command**: A finite asset verifier, Vitest, TypeScript, ESLint, Next.js build, or atlas browser-smoke invocation.

## Requirements

### Requirement 1: Enforce the Archival Master and Responsive Derivative Contract

**User Story:** As a project maintainer, I want the supplied archival master and every browser derivative to have a blocking identity and budget contract, so the application cannot silently serve a missing, changed, oversized, remote, or substitute visual.

#### Acceptance Criteria

1. THE Asset_Manifest SHALL identify `source/assets/elite-watch-master.png` as the only Canonical_Master source path.
2. THE Canonical_Master SHALL remain outside `public`, SHALL NOT be served by the application, and SHALL NOT be moved, overwritten, re-encoded, or optimized in place.
3. THE Asset_Manifest SHALL record Canonical_Master SHA-256, byte length, genuine media type and magic signature, width, height, decoded pixel count, aspect ratio, bit depth, color model/profile metadata, alpha facts, interlace state, decoded RGBA byte length, and decode-validation results.
4. THE Source_Preflight SHALL be tied to the inspected SHA-256 and SHALL confirm watch-only content with no baked header, search, MEN/WOMEN controls, graph nodes or labels, border, watermark, collage, or reference panel.
5. THE Asset_Manifest SHALL define exactly five aspect-preserving candidate dimensions—690×376, 1035×564, 1380×752, 2070×1128, and 2760×1504—for each of AVIF and WebP.
6. WHEN Derivative_Set is generated, THE Asset_Manifest SHALL record for every file its canonical public path, media type, SHA-256, byte length, width, height, decoded pixel count, decoded RGBA byte length, and approved encoder settings.
7. THE Derivative_Set SHALL be produced from Canonical_Master only, SHALL normalize presentation outputs to sRGB, SHALL never upscale, and SHALL contain no crop, overlay, watermark, segmentation, or independently reconstructed mechanism.
8. WHEN Valid_Source_State and Valid_Derivative_State are present, THE Asset_Gate SHALL exit with status zero.
9. IF Canonical_Master, Asset_Manifest, or any required derivative is absent, THEN THE Asset_Gate SHALL exit nonzero with a deterministic missing-file error code.
10. IF any source or derivative signature, MIME, hash, length, dimension, decoded-pixel count, profile requirement, encoder contract, path, or source-set membership differs from Asset_Manifest, THEN THE Asset_Gate SHALL exit nonzero with a deterministic format, manifest, or mismatch error code.
11. IF a manifest source/output path is absolute, traverses outside the project, uses HTTP, HTTPS, or data schemes, places Canonical_Master under `public`, or names an unapproved public file, THEN THE Asset_Gate SHALL reject it.
12. THE Asset_Gate SHALL enforce Selected_Transfer_Budget, Selected_Decode_Budget, the per-AVIF transfer cap, and Aggregate_Derivative_Budget.
13. THE Asset_Gate SHALL NOT reject Canonical_Master merely because its archival byte length exceeds 6 MiB; exact identity and decode validation govern the master while browser budgets govern Derivative_Set.
14. WHEN an npm predevelopment, pretest, or prebuild lifecycle starts, THE Asset_Gate SHALL complete before the requested lifecycle command begins.
15. THE generator and Asset_Gate SHALL perform zero network requests and SHALL leave Canonical_Master, Asset_Manifest, and verified derivative bytes unchanged during verification.
16. IF Canonical_Master cannot decode, fails visual cleanliness review, or the preimplementation project baseline fails, THEN all production implementation tasks SHALL remain blocked.
17. THE Layer_Compatibility_Record SHALL preserve Canonical_Master SHA-256 as the future 2.5D provenance anchor while this feature keeps `segmentationApplied` false.

### Requirement 2: Render Responsive Derivatives as the Sole Hero Medium

**User Story:** As a visitor, I want the supplied watch master represented by responsive high-quality browser assets, so the page is efficient without replacing or fabricating the referenced watch.

#### Acceptance Criteria

1. THE Hero_Backdrop SHALL render exactly one Hero_Picture containing source elements and exactly one Hero_Image.
2. THE Hero_Picture SHALL expose AVIF_Source_Set as primary and WebP_Fallback_Set on Hero_Image, using only Asset_Manifest paths, width descriptors, and `sizes="100vw"`.
3. THE browser SHALL select no more than one Browser_Selected_Resource for a hero presentation; responsive markup SHALL NOT mount duplicate image trees.
4. THE ELITE_WATCHES_Application SHALL make zero browser requests for Canonical_Master.
5. THE Animated_Watch_Feature SHALL mount zero hero `<canvas>` and zero hero `<video>` elements and SHALL expose no alternate remote, generated, PNG-master, or low-quality placeholder source.
6. THE Hero_Image SHALL have empty alternative text and zero keyboard focus stops.
7. WHILE Hero_Loading_State is active, THE Hero_Backdrop SHALL render a dark-neutral non-image surface without a placeholder visual.
8. IF Hero_Image reports a load or decode failure, THEN Hero_Backdrop SHALL enter Hero_Error_State without requesting a substitute source.
9. WHILE Hero_Error_State is active, THE Hero_Backdrop SHALL expose a concise live error status and keep Header_Link, search, Graph_Control, and Definition_Dialog operations available.
10. THE Animated_Watch_Feature SHALL leave `components/canvas/WatchMovementCanvas.tsx` unmounted from `EliteWatchesExperience` and byte-for-byte unchanged.
11. THE initial Animated_Watch_Feature SHALL apply no segmentation, depth map, per-part image layer, or 2.5D effect; future work may use Layer_Compatibility_Record without changing master provenance.

### Requirement 3: Preserve Responsive Cover and Focal Composition

**User Story:** As a visitor on any supported display, I want the selected responsive derivative to remain full-bleed and intentionally framed without wasting transfer or exposing gaps.

#### Acceptance Criteria

1. WHILE Supported_Viewport_Range is active, THE Hero_Image SHALL fill Hero_Backdrop with `object-fit: cover`.
2. WHILE Compact_Viewport is active, THE Hero_Image SHALL use Compact_Focal_Point.
3. WHILE Expanded_Viewport is active, THE Hero_Image SHALL use Expanded_Focal_Point.
4. FOR every supported viewport and browser format capability, Browser_Selected_Resource SHALL belong to the corresponding manifest-backed AVIF_Source_Set or WebP_Fallback_Set and SHALL never be Canonical_Master.
5. WHEN an authored Motion_Frame is evaluated, THE Hero_Backdrop SHALL satisfy Cover_Guard.
6. WHEN viewport orientation or the 700-pixel breakpoint changes, THE application SHALL retain one Hero_Picture tree and allow native source selection without changing application state.
7. WHILE Supported_Viewport_Range is active, THE Animated_Watch_Feature SHALL produce zero page-level horizontal overflow.
8. WHILE Supported_Viewport_Range is active, THE Hero_Backdrop SHALL reserve its final viewport-sized layout before Hero_Image load completion.
9. THE Derivative_Set SHALL preserve the Canonical_Master aspect ratio exactly and SHALL include no upscaled candidate.

### Requirement 4: Animate Only the Whole Selected Image Within Bounded Motion

**User Story:** As a visitor, I want the still watch to feel subtly alive without pretending individual mechanisms move.

#### Acceptance Criteria

1. WHEN Hero_Image reaches load success in Normal_Motion_Mode, THE Hero_Backdrop SHALL start one whole-image transform animation.
2. WHILE Normal_Motion_Mode is active, THE motion cycle SHALL be 28 seconds.
3. THE animation SHALL keep scale in the inclusive range 1.06 through 1.10.
4. THE animation SHALL keep horizontal translation in the inclusive range -1.25 through 1.25 percent.
5. THE animation SHALL keep vertical translation in the inclusive range -0.50 through 0.75 percent.
6. THE animation SHALL continuously change only `transform`.
7. THE cycle endpoint transform SHALL equal its starting transform.
8. WHILE Reduced_Motion is active, THE Hero_Image SHALL have zero animation.
9. WHILE Definition_Dialog is open, THE Hero_Image animation SHALL pause at its current transform and use static opacity `0.72`.
10. THE Hero_Backdrop SHALL add zero pointer-tracking listeners, animation-frame callbacks, intervals, timers, or observers.
11. THE Hero_Backdrop SHALL apply one shared transform to every pixel of Browser_Selected_Resource.
12. IF CSS animation is unavailable, THEN Hero_Image SHALL retain a static cover presentation.

### Requirement 5: Preserve Header Information Architecture in an Inset Geometry

**User Story:** As a visitor, I want the current navigation to gain a floating luxury-glass form without changing any destination or control.

#### Acceptance Criteria

1. THE Glass_Header SHALL use Site_Masthead as the single top-level header landmark.
2. THE Glass_Header SHALL preserve Primary_Navigation and Account_Navigation accessible names.
3. THE Header_Link DOM order SHALL remain COLLECTION, ABOUT, ELITE WATCHES, CONTACT, LOGIN.
4. THE Header_Link destinations SHALL remain `#watch-atlas`, `/about`, `#watch-explorer`, `/contact`, `/login` in that order.
5. THE Glass_Header SHALL add or rename zero header labels.
6. WHILE Expanded_Viewport is active, COLLECTION, ABOUT, CONTACT, and LOGIN SHALL be visible.
7. WHILE Compact_Viewport is active, COLLECTION and LOGIN SHALL be visible and ABOUT and CONTACT omitted from visual layout.
8. WHILE Expanded_Viewport is active, Site_Masthead SHALL use 68-pixel height, 12-pixel top inset, and at least 16-pixel inline inset.
9. WHILE Compact_Viewport is active, Site_Masthead SHALL use 60-pixel height, 8-pixel top inset, and 8-pixel inline inset.
10. WHILE Supported_Viewport_Range is active, Brand_Link horizontal center SHALL stay within one CSS pixel of viewport center.
11. EACH visible Header_Link target SHALL be at least 44 by 44 CSS pixels.
12. Header_Link activation SHALL retain native single activation and existing focus order.

### Requirement 6: Render Static Smoke Glass with Measurable Readability

**User Story:** As a visitor, I want a precise smoke-glass header that stays readable without expensive live filtering.

#### Acceptance Criteria

1. THE Glass_Header SHALL use a static dark-neutral gradient whose authored stop alpha values are each no greater than 0.22.
2. Expanded and Compact corner radii SHALL be 22 and 18 CSS pixels respectively.
3. THE Glass_Header SHALL render a one-pixel light edge and one-pixel inset top highlight.
4. THE exterior shadow alpha SHALL be no greater than 0.18 and blur no greater than 28 CSS pixels.
5. Header_Readability_Scrim SHALL provide at least 0.62 dark-neutral alpha behind the complete Site_Masthead box.
6. Navigation labels and Brand_Link SHALL maintain at least 4.5:1 contrast; keyboard focus indicators SHALL maintain at least 3:1.
7. Focused Header_Link SHALL show an unclipped indicator at least two CSS pixels thick.
8. EVERY Audited_Overlay rule SHALL declare zero Backdrop_Filter properties.
9. Audited_Overlay SHALL use no filter, background-position, shimmer, noise, or specular-sweep animation.
10. Reduced_Transparency or Increased_Contrast SHALL select a solid dark-neutral surface.
11. Forced_Colors_Mode SHALL use system background, text, link, border, and focus colors.
12. Pointer-enabled Glass_Header descendants SHALL be limited to existing Header_Link elements.

### Requirement 7: Preserve Search, Graph, Dialog, and State Behavior

**User Story:** As a visitor, I want the visual migration to leave the watch explorer behavior intact.

#### Acceptance Criteria

1. Search ArrowDown and ArrowUp SHALL preserve cyclic active-result navigation.
2. Search Enter on an active result SHALL open the corresponding existing term.
3. Clear search SHALL clear the query and restore focus to the search input.
4. Watch_Explorer SHALL render exactly 13 existing Graph_Control elements with current names and presentation IDs.
5. Valid audience, selected-term, and preview combinations SHALL preserve existing Graph_Relationship IDs and emphasis states.
6. Keyboard focus SHALL retain preview precedence over pointer hover.
7. MEN or WOMEN selection SHALL persist after pointer leave and blur.
8. A locked brand Graph_Control SHALL preserve focus and preview without opening Definition_Dialog.
9. An enabled brand Graph_Control SHALL open existing term content.
10. Escape SHALL close Definition_Dialog and restore focus to the connected opener or search fallback.
11. Crossing the 700-pixel breakpoint SHALL retain Preserved_Application_State.
12. Existing dictionary terms, graph labels, relationship data, search placeholder, browse instruction, and definition content SHALL remain unchanged.
13. Compact Glass_Header SHALL leave the search control unobscured.

### Requirement 8: Preserve Layering, Hit-Testing, and Accessible Operation

**User Story:** As a visitor using pointer, touch, keyboard, or assistive technology, I want every current control reachable above the decorative hero.

#### Acceptance Criteria

1. Hero_Backdrop SHALL paint below Header_Readability_Scrim, Watch_Explorer, search, Site_Masthead, Definition_Dialog, and skip link.
2. Hero_Backdrop, Hero_Picture, Hero_Image, and Header_Readability_Scrim SHALL accept zero pointer events.
3. The existing graph SVG relationship layer SHALL accept zero pointer events.
4. ALL 13 Graph_Control center points SHALL hit-test to their corresponding controls throughout Supported_Viewport_Range.
5. EVERY visible Header_Link SHALL remain pointer-operable.
6. Existing skip-link destination and focus reveal behavior SHALL remain unchanged.
7. Reduced_Motion SHALL preserve all Header_Link, search, Graph_Control, and Definition_Dialog operations.
8. Forced_Colors_Mode SHALL preserve visible Header_Link boundaries and keyboard focus.
9. Hero_Loading_State transitions and responsive source selection SHALL cause zero layout shift in Watch_Explorer.

### Requirement 9: Meet Performance, Compatibility, and Integrity Gates

**User Story:** As a project maintainer, I want the responsive image and glass presentation finite, measurable, efficient, and isolated.

#### Acceptance Criteria

1. THE Animated_Watch_Feature SHALL add zero production or development package dependencies.
2. THE feature SHALL use one responsive Hero_Backdrop and Hero_Picture render tree across Compact_Viewport and Expanded_Viewport.
3. WHEN Reference_Browser loads a production build, Browser_Selected_Resource SHALL return HTTP 200 with `image/avif` when supported or `image/webp` as fallback, and SHALL satisfy Selected_Transfer_Budget.
4. Browser_Selected_Resource natural dimensions SHALL equal one manifest derivative entry and decoded memory SHALL satisfy Selected_Decode_Budget.
5. ONE hero navigation SHALL request one selected derivative rather than every source-set candidate or Canonical_Master.
6. EACH warmed graph interaction sample SHALL complete visual response within 100 milliseconds, longest overlapping main-thread task within 100 milliseconds, and cumulative blocking within 100 milliseconds.
7. A finite 120-Frame_Interval probe SHALL keep at least 95 percent of intervals at or below 25 milliseconds and every interval at or below 100 milliseconds.
8. Compact and expanded smoke checks SHALL report zero runtime errors, console errors, hydration recoveries, and failed network responses.
9. EVERY Protected_Artifact SHALL remain byte-for-byte unchanged.
10. Project_Validation_Command SHALL complete without feature-caused failure after Valid_Source_State and Valid_Derivative_State are established.
11. Existing graph responsive-SVG cardinality and active-edge effect cardinality SHALL remain unchanged.
12. Existing 13-control graph hit-testing SHALL remain unchanged during the finite performance probe.
