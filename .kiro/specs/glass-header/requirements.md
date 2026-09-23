# Requirements Document

## Introduction

The `glass-header` feature will refine the existing ELITE WATCHES masthead into a premium frosted-glass navigation surface. The header will transmit a subdued view of the WebGL or static watch movement, apply bounded blur and saturation where supported, preserve a subtle illuminated edge and restrained shadow, and maintain readable dark navigation labels with a centered burnished-gold brand.

The feature is a presentation enhancement to the current Next.js application. Existing header landmarks, navigation labels, destinations, application state, watch rendering, search, graph, and definition-panel behavior remain in place. CSS progressive enhancement supplies an opaque fallback where backdrop filtering is unavailable or where user accessibility preferences favor reduced transparency or increased contrast.

## Glossary

- **ELITE_WATCHES_Application**: The current Next.js watch-atlas application rooted at `/Users/ankitkumar/Desktop/CODE/activity`.
- **Glass_Header**: The enhanced visual and interaction behavior of the top navigation header delivered by this feature.
- **Site_Masthead**: The existing `.site-masthead` header element rendered by `components/EliteWatchesExperience.tsx`.
- **Primary_Navigation**: The existing named navigation landmark containing COLLECTION and ABOUT links.
- **Account_Navigation**: The existing named navigation landmark containing CONTACT and LOGIN links.
- **Navigation_Label**: Visible text belonging to a link in Primary_Navigation or Account_Navigation.
- **Brand_Link**: The existing centered ELITE WATCHES home link with class `.wordmark`.
- **Header_Surface**: The visual background, border, highlight, and shadow painted by Site_Masthead.
- **Watch_Backdrop**: The composited WebGL_Movement or Static_Movement and other existing visual layers painted behind Site_Masthead.
- **WebGL_Movement**: The animated watch movement rendered by `WatchMovementCanvas` when WebGL is available.
- **Static_Movement**: The existing CSS watch movement rendered when WebGL is unavailable or fails.
- **Backdrop_Filter_Support**: Browser support for either the standard `backdrop-filter` property or the WebKit-prefixed `-webkit-backdrop-filter` property.
- **Enhanced_Glass_Mode**: The Header_Surface mode that uses a translucent warm-neutral background with backdrop blur and saturation.
- **Opaque_Fallback_Mode**: The Header_Surface mode that uses a high-opacity warm-neutral background without requiring backdrop filtering.
- **Forced_Colors_Mode**: The browser display mode in which system colors replace authored colors.
- **Reduced_Transparency**: A user or operating-system preference requesting less transparent interface material when the browser exposes that preference.
- **Increased_Contrast**: A user or operating-system preference requesting stronger visual contrast when the browser exposes that preference.
- **Final_Composited_Surface**: The visible Header_Surface after the browser combines the authored background, Watch_Backdrop, filter, border, highlight, and shadow.
- **Burnished_Gold**: An opaque dark-gold foreground color whose luminance supports required text contrast on Final_Composited_Surface.
- **Focus_Indicator**: The visible outline identifying the currently keyboard-focused link.
- **Touch_Target**: The interactive bounding box that accepts pointer or touch activation for one link.
- **Compact_Viewport**: A viewport no wider than 700 CSS pixels.
- **Expanded_Viewport**: A viewport wider than 700 CSS pixels.
- **Supported_Viewport_Range**: Viewport widths from 320 through 2560 CSS pixels at 100 percent browser zoom.
- **Browser_Matrix**: The current and immediately previous major desktop versions of Chrome, Edge, Firefox, and Safari, plus current mobile Safari and current mobile Chrome.
- **Material_Effect**: The combination of Header_Surface tint, backdrop blur, backdrop saturation, divider, inset highlight, and exterior shadow.
- **Project_Test_Command**: A finite non-watch command defined by the project, including `npm test`, `npm run typecheck`, `npm run lint`, or `npm run build`.
- **Historical_Spec**: The existing `.kiro/specs/ai-coding-dictionary-inspired-site` specification and every file contained in that directory.

## Requirements

### Requirement 1: Preserve Header Architecture and Navigation

**User Story:** As a visitor, I want the refined header to retain the current navigation structure, so that the visual upgrade does not change how I move through ELITE WATCHES.

#### Acceptance Criteria

1. THE Glass_Header SHALL use Site_Masthead as the single top-level header landmark.
2. THE Glass_Header SHALL preserve Primary_Navigation as a navigation landmark named "Primary navigation".
3. THE Glass_Header SHALL preserve Account_Navigation as a navigation landmark named "Account navigation".
4. THE Glass_Header SHALL preserve the visible text and destination of each existing navigation link.
5. THE Glass_Header SHALL preserve the accessible name and destination of Brand_Link.
6. THE Site_Masthead SHALL remain visually above Watch_Backdrop and all explorer controls.
7. THE Header_Surface SHALL limit pointer interaction to the existing links within Site_Masthead.
8. WHEN a visitor activates an existing header link, THE ELITE_WATCHES_Application SHALL perform the existing link navigation exactly once.
9. THE Glass_Header SHALL leave ELITE_WATCHES_Application search, graph, audience selection, term selection, and definition-panel state behavior unchanged.
10. THE Glass_Header SHALL keep every Historical_Spec file unchanged.

### Requirement 2: Render the Premium Frosted-Glass Material

**User Story:** As a visitor, I want the header to resemble refined frosted glass, so that the watch movement remains part of the luxury presentation without distracting from navigation.

#### Acceptance Criteria

1. WHERE Backdrop_Filter_Support is available and Reduced_Transparency, Increased_Contrast, and Forced_Colors_Mode are inactive, THE Header_Surface SHALL use Enhanced_Glass_Mode.
2. WHILE Enhanced_Glass_Mode is active, THE Header_Surface SHALL use a warm-neutral background alpha from 0.64 through 0.72.
3. WHILE Enhanced_Glass_Mode is active, THE Header_Surface SHALL apply backdrop blur from 18 through 24 CSS pixels.
4. WHILE Enhanced_Glass_Mode is active, THE Header_Surface SHALL apply backdrop saturation from 110 through 125 percent.
5. WHILE Enhanced_Glass_Mode is active, THE Header_Surface SHALL composite the translucent warm-neutral background directly over Watch_Backdrop.
6. THE Header_Surface SHALL render a one-CSS-pixel light bottom divider with alpha from 0.30 through 0.55.
7. THE Header_Surface SHALL render a one-CSS-pixel inset top highlight with alpha no greater than 0.65.
8. THE Header_Surface SHALL render an exterior shadow with alpha no greater than 0.14 and blur from 18 through 30 CSS pixels.
9. THE Material_Effect SHALL keep tint, blur, saturation, divider, highlight, and shadow values static after browser style resolution.
10. THE Material_Effect SHALL exclude animated shimmer, animated noise, specular sweeps, and pulsing glow.

### Requirement 3: Maintain Premium Foreground Legibility

**User Story:** As a visitor, I want crisp dark navigation and a clearly centered gold brand, so that the header remains readable over the moving watch backdrop.

#### Acceptance Criteria

1. THE Navigation_Label SHALL use a fully opaque dark-charcoal foreground.
2. THE Brand_Link SHALL use a fully opaque Burnished_Gold foreground.
3. THE Navigation_Label SHALL maintain a contrast ratio of at least 4.5:1 against Final_Composited_Surface.
4. THE Brand_Link SHALL maintain a contrast ratio of at least 4.5:1 against Final_Composited_Surface.
5. THE Focus_Indicator SHALL maintain a contrast ratio of at least 3:1 against adjacent Header_Surface colors.
6. WHILE an existing header link has keyboard focus, THE Glass_Header SHALL display an unobscured Focus_Indicator at least two CSS pixels thick.
7. WHERE a fine pointer supports hover, WHEN the pointer enters an existing navigation link, THE Glass_Header SHALL display the existing underline response without activating the link.
8. WHEN keyboard focus enters an existing navigation link, THE Glass_Header SHALL display both the existing underline response and Focus_Indicator.
9. THE Brand_Link SHALL place the horizontal center of the ELITE WATCHES wordmark within one CSS pixel of the viewport horizontal center.
10. THE Navigation_Label SHALL render each glyph through one opaque foreground layer.

### Requirement 4: Provide Progressive Compatibility and Preference Fallbacks

**User Story:** As a visitor using a browser or display mode without translucent backdrop support, I want a coherent readable header, so that navigation quality does not depend on one rendering capability.

#### Acceptance Criteria

1. IF Backdrop_Filter_Support is unavailable, THEN THE Header_Surface SHALL use Opaque_Fallback_Mode.
2. WHILE Opaque_Fallback_Mode is active, THE Header_Surface SHALL use a warm-neutral background alpha from 0.92 through 0.98.
3. WHILE Opaque_Fallback_Mode is active, THE Glass_Header SHALL preserve the divider, inset highlight, restrained shadow, Navigation_Label, Brand_Link, and Focus_Indicator.
4. WHERE only `-webkit-backdrop-filter` is supported, THE Header_Surface SHALL provide Enhanced_Glass_Mode through the prefixed property.
5. WHILE Reduced_Transparency is active, THE Header_Surface SHALL use Opaque_Fallback_Mode.
6. WHILE Increased_Contrast is active, THE Header_Surface SHALL use Opaque_Fallback_Mode with a bottom divider that maintains at least 3:1 contrast against adjacent colors.
7. WHILE Forced_Colors_Mode is active, THE Glass_Header SHALL use system background, text, link, border, and focus colors.
8. WHEN Static_Movement replaces WebGL_Movement, THE Header_Surface SHALL preserve the mode selected by browser support and accessibility preferences.
9. THE Opaque_Fallback_Mode SHALL maintain at least 4.5:1 contrast for Navigation_Label and Brand_Link.
10. THE Glass_Header SHALL provide all navigation content and operations without Backdrop_Filter_Support.

### Requirement 5: Adapt Across Viewports and Zoom

**User Story:** As a visitor on a phone, tablet, laptop, or wide display, I want the glass header to retain its hierarchy and controls, so that the luxury finish does not compromise responsive navigation.

#### Acceptance Criteria

1. WHILE Expanded_Viewport is active, THE Site_Masthead SHALL have a height of 68 CSS pixels.
2. WHILE Expanded_Viewport is active, THE Glass_Header SHALL display COLLECTION, ABOUT, CONTACT, and LOGIN navigation links.
3. WHILE Compact_Viewport is active, THE Site_Masthead SHALL have a height of 60 CSS pixels.
4. WHILE Compact_Viewport is active, THE Glass_Header SHALL display COLLECTION and LOGIN navigation links.
5. WHILE Compact_Viewport is active, THE Glass_Header SHALL omit ABOUT and CONTACT navigation links from visual layout.
6. WHILE Supported_Viewport_Range is active, THE Glass_Header SHALL produce no page-level horizontal overflow.
7. WHILE Supported_Viewport_Range is active, THE Brand_Link SHALL remain horizontally centered without overlapping a visible Navigation_Label.
8. WHILE Compact_Viewport is active, THE Glass_Header SHALL keep each visible Touch_Target at least 44 by 44 CSS pixels.
9. WHILE Expanded_Viewport is active, THE Glass_Header SHALL keep each visible Touch_Target at least 44 by 44 CSS pixels.
10. WHILE Compact_Viewport is active, THE Glass_Header SHALL leave the search control below Site_Masthead unobscured.
11. WHILE browser zoom is 200 percent in a 1280-by-1024 CSS-pixel window, THE Glass_Header SHALL retain every visible link without text clipping or page-level horizontal overflow.
12. WHEN viewport orientation changes, THE Glass_Header SHALL preserve current ELITE_WATCHES_Application interaction state.

### Requirement 6: Preserve Accessible Operation

**User Story:** As a visitor using assistive technology, keyboard navigation, touch, or visual preferences, I want the glass header to remain perceivable and operable, so that the decorative material does not create an access barrier.

#### Acceptance Criteria

1. THE Glass_Header SHALL preserve the document focus order of all existing header links.
2. WHEN a keyboard user presses Enter on a focused existing header link, THE ELITE_WATCHES_Application SHALL perform the corresponding link navigation exactly once.
3. WHEN a touch user taps an existing header link, THE ELITE_WATCHES_Application SHALL perform the corresponding link navigation exactly once without requiring hover.
4. THE Glass_Header SHALL preserve every existing header link accessible name.
5. THE Glass_Header SHALL expose no decorative Header_Surface layer to the accessibility tree.
6. THE Header_Surface SHALL allow pointer events to reach every visible header link.
7. THE Glass_Header SHALL communicate keyboard focus through Focus_Indicator in addition to color.
8. WHILE reduced motion is active, THE Glass_Header SHALL preserve the same static Material_Effect selected by browser support and transparency preferences.
9. THE Glass_Header SHALL introduce no automatic motion, flashing, or timed content.
10. WHILE Forced_Colors_Mode is active, THE Glass_Header SHALL preserve visible link boundaries and keyboard focus.

### Requirement 7: Bound Rendering Cost and Project Impact

**User Story:** As a project maintainer, I want the material upgrade to remain isolated and inexpensive, so that the existing watch experience and build remain stable.

#### Acceptance Criteria

1. THE Material_Effect SHALL apply backdrop filtering to Site_Masthead only.
2. THE Glass_Header SHALL add no production runtime dependency.
3. THE Glass_Header SHALL add no animation-frame callback, timer, observer, or React state.
4. THE Glass_Header SHALL leave WebGL_Movement and Static_Movement render logic unchanged.
5. THE Glass_Header SHALL leave current Next.js metadata and viewport configuration unchanged.
6. THE Material_Effect SHALL avoid `will-change`, duplicated backdrop layers, SVG filters, and canvas copies.
7. WHEN a Project_Test_Command completes against the implementation, THE ELITE_WATCHES_Application SHALL report no new test, type, lint, or build failure caused by Glass_Header.
8. WHILE Browser_Matrix is used, THE Glass_Header SHALL provide either Enhanced_Glass_Mode or Opaque_Fallback_Mode with operable navigation.
9. WHEN Site_Masthead first renders with project styles, THE Site_Masthead SHALL occupy its final responsive height without a material-induced layout shift.
