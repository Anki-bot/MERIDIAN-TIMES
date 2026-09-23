# Bugfix Requirements Document

## Introduction

This bugfix addresses two regressions in the ELITE WATCHES experience: the header reads as an opaque white slab instead of transparent glass, and network-node hover or focus causes visible rendering slowdown. The correction must remove the unnecessary compositing and duplicated effect work while preserving the header’s established layout and accessibility contracts and retaining the graph’s interactive rays and moving dots.

The fix is limited to the glass-header presentation and network-effect workload. Watch geometry and content remain outside the initial fix scope, and the historical `ai-coding-dictionary-inspired-site` specification must remain unchanged.

## Bug Analysis

### Current Behavior (Defect)

The header obscures too much of the watch scene and continuously incurs backdrop-compositing work. Dense node previews also perform substantially more animation and filter work than the visible interaction requires.

1.1 WHEN the default header is presented over the animated or static watch scene THEN the system renders a light surface that is perceived as a white slab and does not visibly transmit enough of the scene to read as transparent glass.

1.2 WHEN the animated WebGL watch scene runs behind the header THEN the system continuously samples and filters that moving backdrop, causing expensive recompositing even when the visitor is not interacting with the header.

1.3 WHEN a visitor hovers or focuses a network node and an active edge fan is displayed THEN the system exhibits visible rendering slowdown while drawing the required rays and moving dots.

1.4 WHEN only one responsive graph variant is visible and active edges exist THEN the system also runs equivalent edge and particle effects for the hidden responsive variant.

1.5 WHEN a dense preview produces 12 active edges THEN the system can create up to 72 indefinitely animated particle circles across the responsive variants and apply expensive blur or shadow filters despite only one graph variant being visible.

1.6 WHEN a warmed browser repeatedly activates a dense hover fan THEN the system can incur long rendering or main-thread stalls that delay visible interaction feedback.

### Expected Behavior (Correct)

The corrected header must use a static, low-alpha glass surface that visibly transmits the watch scene without backdrop sampling. The corrected graph must retain its interactive visual language while bounding all active effect work to the visible responsive graph.

2.1 WHEN the default header is presented over the animated or static watch scene THEN the system SHALL visibly transmit the scene and read as transparent glass by using a static translucent neutral color or subtle gradient whose authored color-stop alpha does not exceed 0.22.

2.2 WHEN the animated WebGL watch scene runs behind the header THEN the system SHALL render the header without standard or prefixed backdrop filtering so that header styling does not sample the animated canvas on every frame.

2.3 WHEN a visitor hovers or focuses a network node and an active edge fan is displayed THEN the system SHALL keep the resting rays, hover or focus fan, selected-network persistence, and clearly visible moving dots while responding without visible rendering slowdown.

2.4 WHEN only one responsive graph variant is visible and active edges exist THEN the system SHALL render and run active edge effects only for that responsive variant, with no equivalent animated work retained for the hidden variant.

2.5 WHEN a preview produces N active edges THEN the system SHALL render no more than one clearly visible traveling particle per active edge in the active responsive graph, for a total no greater than N traveling particles, and SHALL apply neither an SVG Gaussian-blur filter to active rays nor a per-particle drop-shadow filter.

2.6 WHEN a supported reference browser has completed one warm-up interaction and then activates a dense 12-edge hover fan three times THEN the system SHALL show the active rays and dots within 100 milliseconds of each hover, keep controls hit-testable, produce no console or runtime error, record no individual main-thread task longer than 100 milliseconds, and keep cumulative blocking time above the 50-millisecond long-task boundary at or below 100 milliseconds per interaction.

### Unchanged Behavior (Regression Prevention)

The fix must preserve all established header, graph, accessibility, and application behavior that is independent of the two bug conditions.

3.1 WHEN the viewport is wider than 700 CSS pixels THEN the system SHALL CONTINUE TO render the header at 68 CSS pixels high, and WHEN the viewport is 700 CSS pixels wide or narrower THEN the system SHALL CONTINUE TO render it at 60 CSS pixels high.

3.2 WHEN the header is rendered at any supported viewport THEN the system SHALL CONTINUE TO keep the ELITE WATCHES wordmark horizontally centered and preserve the existing navigation labels, destinations, landmarks, accessible names, focus order, and single-activation behavior.

3.3 WHEN header content is displayed or focused THEN the system SHALL CONTINUE TO meet the established 4.5:1 text-contrast and 3:1 focus-indicator contrast targets, preserve an unobscured focus indicator, and keep every visible compact navigation target at least 44 by 44 CSS pixels.

3.4 WHEN forced-colors mode is active THEN the system SHALL CONTINUE TO use system colors and expose visible links, boundaries, and keyboard focus without depending on transparency.

3.5 WHEN the transparent header surface is rendered THEN the system SHALL CONTINUE TO provide a crisp one-CSS-pixel highlight or divider and a restrained static shadow without adding animated material effects.

3.6 WHEN no network node is previewed, a node is hovered or focused, or a network selection persists THEN the system SHALL CONTINUE TO show the corresponding resting rays, preview fan, or selected network with the same graph relationships and interaction meaning.

3.7 WHEN reduced-motion mode is active THEN the system SHALL CONTINUE TO present the graph relationships without traveling-particle motion and without removing operable controls or selection feedback.

3.8 WHEN a visitor uses pointer, keyboard, or touch input on the graph THEN the system SHALL CONTINUE TO keep controls hit-testable, preserve node activation and accessible names, and prevent decorative rays or particles from intercepting input.

3.9 WHEN the post-fix browser performance check satisfies clause 2.6 THEN the system SHALL CONTINUE TO leave watch geometry, watch content, camera behavior, and WebGL or static-fallback rendering logic unchanged.

3.10 WHEN the header or graph interaction changes application state THEN the system SHALL CONTINUE TO preserve existing audience selection, term selection, definition-panel, search, and navigation behavior and SHALL CONTINUE TO produce no runtime or console errors.

3.11 WHEN this bugfix specification and its implementation are created THEN the system SHALL CONTINUE TO leave every file in `.kiro/specs/ai-coding-dictionary-inspired-site/` unchanged.

3.12 WHEN the finite regression suite runs THEN the system SHALL CONTINUE TO satisfy all existing smoke expectations that are not superseded solely by the bounded particle-count contract in clause 2.5.
