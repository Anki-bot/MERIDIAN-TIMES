import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const smokePath = resolve(process.cwd(), "scripts/atlas-visibility-smoke.mjs");
const source = readFileSync(smokePath, "utf8");

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `Missing source marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `Missing source marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectInOrder(haystack: string, markers: readonly string[]): void {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = haystack.indexOf(marker, previousIndex + 1);
    expect(index, `Expected marker after prior contract step: ${marker}`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

describe("atlas visibility smoke source contract", () => {
  it("accounts for one desktop graph and bounded MEN/Patek native effects", () => {
    expect(source).toContain("const VIEWPORT = Object.freeze({ width: 1024, height: 576 });");
    expect(source).toContain("deviceScaleFactor: 1");
    expect(source).toContain("const EXPECTED_NODE_COUNT = 13;");
    expect(source).toContain("const EXPECTED_MEN_EDGE_COUNT = 12;");
    expect(source).toContain("const EXPECTED_PATEK_EDGE_COUNT = 2;");
    expect(source).toContain("report.graphSvgCount, 1");
    expect(source).toContain("report.graphVariants, [\"desktop\"]");
    expect(source).toContain("state.graphSvgCount, 1");
    expect(source).toContain("state.graphVariants, [\"desktop\"]");
    expect(source).toContain("state.activeEdgeCount, expectedEdgeCount");
    expect(source).toContain("state.activePathCount, expectedEdgeCount");
    expect(source).toContain("state.particleCount, expectedEdgeCount");
    expect(source).toContain("state.animateMotionCount, expectedEdgeCount");
    expect(source).toContain("assertInteractionState(hoverState, \"preview-men\", EXPECTED_MEN_EDGE_COUNT");
    expect(source).toContain("EXPECTED_PATEK_EDGE_COUNT");
    expect(source).toContain("'.graph-connections .graph-connections__active > g'");
    expect(source).toContain("'.graph-connections .connection-particle'");
    expect(source).toContain("'.graph-connections .graph-connections__active animateMotion'");
    expect(source).not.toMatch(
      /\.graph-connections--desktop\s+\.(?:graph-connections__(?:active|rest)|connection-particle)/,
    );
    expect(source).not.toContain("particleCount, 36");
    expect(source).not.toContain("particleCount, 6");
  });

  it("keeps headless Chromium foreground-scheduled without bypassing frame budgets", () => {
    const launch = sourceBetween(
      "chromeProcess = spawn(chromePath, [",
      '], { stdio: ["ignore", "ignore", "pipe"] });',
    );
    const activationFlow = sourceBetween(
      "client = await createProtocolClient(pageTarget);",
      "const pausedHeroRequest = await pausedHeroRequestPromise;",
    );

    for (const flag of [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-gpu-vsync",
    ]) {
      expect(launch).toContain(`"${flag}"`);
    }
    expect(launch).not.toContain('"--disable-frame-rate-limit"');
    expect(launch).not.toMatch(/["']--disable-gpu["']/);
    expect(launch).not.toContain('"--disable-software-rasterizer"');
    expectInOrder(activationFlow, [
      'client.send("Page.bringToFront")',
      'client.send("Emulation.setFocusEmulationEnabled", { enabled: true })',
      'client.send("Page.navigate", { url: baseUrl })',
    ]);
  });

  it("requires long-task support and installs the observer before any runtime interaction", () => {
    const setup = sourceBetween(
      "const performanceSetupExpression = String.raw`",
      "const inspectionExpression = String.raw`",
    );
    const runtimeFlow = sourceBetween(
      "performanceSupport = await client.evaluate(performanceSetupExpression);",
      "const result = {",
    );

    expect(setup).toContain("PerformanceObserver.supportedEntryTypes");
    expect(setup).toContain("supportedEntryTypes.includes('longtask')");
    expect(setup).toContain("return { supported: false, supportedEntryTypes };");
    expect(setup).toContain("new PerformanceObserver((list) =>");
    expect(setup).toContain("observer.observe({ type: 'longtask', buffered: true });");
    expect(setup).toContain(
      "state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });",
    );
    expect(setup).toContain("appendLongTasks(state.observer.takeRecords());");
    expect(runtimeFlow).toContain("assert.equal(\n    performanceSupport.supported,\n    true");
    expectInOrder(runtimeFlow, [
      "performanceSupport = await client.evaluate(performanceSetupExpression);",
      "performanceSupport.supported",
      "// Exactly one complete warm-up",
      "client.send(\"Input.dispatchMouseEvent\"",
    ]);
  });

  it("measures event.timeStamp to the first complete ready frame and finalizes one frame later", () => {
    const setup = sourceBetween(
      "const performanceSetupExpression = String.raw`",
      "const inspectionExpression = String.raw`",
    );

    expect(setup).toContain("men.addEventListener('pointerover', onPointerStart, { capture: true, once: true });");
    expect(setup).toContain("sample.eventTimeStamp = event.timeStamp;");
    expect(setup).toContain("sample.visualResponseLatencyMs = frameTime - event.timeStamp;");
    expect(setup).toContain("requestAnimationFrame(inspectReadyFrame);");
    expect(setup).toContain("requestAnimationFrame(() => finalize());");
    expect(setup).toContain("const sampleEnd = performance.now();");
    expect(setup).toContain("mode === 'preview-men'");
    expect(setup).toContain("graphSvgs.length === 1");
    expect(setup).toContain("activeGroups.length === ${EXPECTED_MEN_EDGE_COUNT}");
    expect(setup).toContain("activePaths.length === ${EXPECTED_MEN_EDGE_COUNT}");
    expect(setup).toContain("particles.length === ${EXPECTED_MEN_EDGE_COUNT}");
    expect(setup).toContain("animateMotionCount === ${EXPECTED_MEN_EDGE_COUNT}");
    expect(setup).toContain("activePaths.every((path) => path.visible)");
    expect(setup).toContain("particles.every((particle) => particle.visible)");
    expect(setup).toContain("numeric(style.strokeWidth) > 0");
    expect(setup).toContain("radius > 0");
    expect(setup).not.toContain("Date.now()");
  });

  it("excludes one warm-up and runs exactly three independently prepared samples", () => {
    const measuredInteraction = sourceBetween(
      "async function runMeasuredMenInteraction",
      "let chromeProcess;",
    );
    const runtimeFlow = sourceBetween(
      "// Exactly one complete warm-up",
      "const result = {",
    );

    expect(source).toContain("const MEASURED_INTERACTION_COUNT = 3;");
    expect(source.match(/Exactly one complete warm-up/g)).toHaveLength(1);
    expectInOrder(runtimeFlow, [
      "// Exactly one complete warm-up",
      "complete MEN warm-up fan",
      "resting network after the excluded warm-up",
      "window.__atlasPerformance.clearLongTasks(); true",
      "for (let sampleIndex = 0; sampleIndex < MEASURED_INTERACTION_COUNT; sampleIndex += 1)",
      "performanceSamples.push(await runMeasuredMenInteraction",
    ]);
    expectInOrder(measuredInteraction, [
      "waitForRestingAndTwoFrames",
      "instrumentation.clearLongTasks();",
      "instrumentation.armSample(${sampleIndex})",
      "Input.dispatchMouseEvent",
    ]);
    expect(source).toContain(
      "requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))",
    );
    expect(measuredInteraction).not.toContain("delay(");
    expect(measuredInteraction).not.toContain("Date.now()");
    expect(measuredInteraction.toLowerCase()).not.toContain("average");
    expect(measuredInteraction.toLowerCase()).not.toContain("retry");
  });

  it("uses overlap-aware task math, per-sample limits, and 13-control hit-testing", () => {
    const setup = sourceBetween(
      "const performanceSetupExpression = String.raw`",
      "const inspectionExpression = String.raw`",
    );
    const assertions = sourceBetween(
      "function assertPerformanceSamples",
      "async function runMeasuredMenInteraction",
    );

    expect(source).toContain("const LONG_TASK_BOUNDARY_MS = 50;");
    expect(source).toContain("const VISUAL_RESPONSE_LIMIT_MS = 100;");
    expect(source).toContain("const MAIN_THREAD_TASK_LIMIT_MS = 100;");
    expect(source).toContain("const CUMULATIVE_BLOCKING_LIMIT_MS = 100;");
    expect(setup).toContain("task.startTime <= sampleEnd");
    expect(setup).toContain("task.startTime + task.duration >= sample.eventTimeStamp");
    expect(setup).toContain("Math.max(longest, task.duration)");
    expect(setup).toContain(
      "blocking + Math.max(0, task.duration - ${LONG_TASK_BOUNDARY_MS})",
    );
    expect(setup).toContain("document.elementsFromPoint(center.x, center.y)");
    expect(setup).toContain("controls.length === ${EXPECTED_NODE_COUNT}");
    expect(setup).toContain("records.every((record) => record.hit)");
    expect(assertions).toContain("for (const sample of samples)");
    expect(assertions).toContain("sample.visualResponseLatencyMs <= VISUAL_RESPONSE_LIMIT_MS");
    expect(assertions).toContain("sample.longestTaskMs <= MAIN_THREAD_TASK_LIMIT_MS");
    expect(assertions).toContain(
      "sample.cumulativeBlockingTimeMs <= CUMULATIVE_BLOCKING_LIMIT_MS",
    );
    expect(assertions).toContain("sample.hitTesting?.controlCount");
    expect(assertions).toContain("sample.hitTesting?.allControlsHitTestable");
    expect(assertions).toContain("record.id === record.resolvedId");
    expect(assertions).toContain("sample.runtimeErrors, []");
    expect(assertions).toContain("sample.failedResponses, []");
    expect(assertions.toLowerCase()).not.toContain("average");
  });

  it("preserves finite guards, raw failure evidence, regression assertions, and cleanup", () => {
    const outputIndex = source.indexOf(
      "console.log(JSON.stringify(process.env.ATLAS_VERBOSE === \"1\" ? result : evidence",
    );
    const assertionIndex = source.indexOf("assertPerformanceSamples(performanceSamples);");
    const failureBlock = sourceBetween("} catch (error) {", "} finally {");
    const cleanupBlock = source.slice(source.indexOf("} finally {"));

    expect(source).toContain("const PERFORMANCE_PROBE_TIMEOUT_MS = 5_000;");
    expect(source).toContain("const deadline = Date.now() + timeout;");
    expect(source).toContain("const readinessDeadline = performance.now() + ${PERFORMANCE_PROBE_TIMEOUT_MS}");
    expect(source).toContain("Runtime.exceptionThrown");
    expect(source).toContain("Runtime.consoleAPICalled");
    expect(source).toContain("Log.entryAdded");
    expect(source).toContain("Network.responseReceived");
    expect(source).toContain("hydrated");
    expect(source).toContain("report.restingPaths.every");
    expect(source).toContain("the dedicated controls plane must paint above SVG rays");
    expect(source).toContain("node.topAtlasId, node.id");
    expect(source).toContain("assert.deepEqual(runtimeErrors, []");
    expect(source).toContain("assert.deepEqual(failedResponses, []");
    expect(outputIndex).toBeGreaterThanOrEqual(0);
    expect(outputIndex).toBeLessThan(assertionIndex);
    expect(failureBlock).toContain("performanceSamples");
    expect(failureBlock).toContain("console.error(JSON.stringify");
    expect(cleanupBlock).toContain("observer?.disconnect()");
    expect(cleanupBlock).toContain("await client.close().catch");
    expect(cleanupBlock).toContain("await stopChild(chromeProcess);");
    expect(cleanupBlock).toContain("await stopChild(serverProcess);");
    expect(cleanupBlock).toContain("await rm(temporaryRoot, { recursive: true, force: true });");
  });

  it("requires one exact manifest-backed responsive picture tree and rejects legacy hero readiness", () => {
    const manifestContract = sourceBetween(
      "const assetManifest = JSON.parse(",
      "let baseUrl = process.env.ATLAS_BASE_URL",
    );
    const readiness = sourceBetween(
      "const readinessExpression = String.raw`",
      "const heroFrameProbeExpression = String.raw`",
    );
    const reportAssertions = sourceBetween(
      "function assertReport",
      "function assertSelectedResource",
    );
    const finalAssertions = sourceBetween("if (shouldAssert) {", "} catch (error) {");

    expect(manifestContract).toContain("assetManifest.derivativePolicy.derivatives.map");
    expect(manifestContract).toContain(".filter((entry) => entry.mediaType === mediaType)");
    expect(manifestContract).toContain(".sort((left, right) => left.intrinsicWidth - right.intrinsicWidth)");
    expect(manifestContract).toContain(
      ".map((entry) => `${entry.publicPath} ${entry.intrinsicWidth}w`)",
    );
    expect(manifestContract).toContain('entry.mediaType === "image/webp"');
    expect(manifestContract).toContain("entry.intrinsicWidth === 1380");
    expect(manifestContract).toContain("avifSourceSet: sourceSetFor(\"image/avif\")");
    expect(manifestContract).toContain("webpSourceSet: sourceSetFor(\"image/webp\")");
    expect(manifestContract).toContain("sizes: assetManifest.derivativePolicy.sizes");

    expect(readiness).toContain("document.querySelectorAll('.watch-image-backdrop')");
    expect(readiness).toContain("document.querySelectorAll('.watch-image-backdrop picture')");
    expect(readiness).toContain("document.querySelectorAll('.watch-image-backdrop img')");
    expect(readiness).toContain("picture?.querySelector('source[type=\"image/avif\"]')");
    expect(readiness).toContain("new URL(image.currentSrc, location.href).pathname");
    expect(readiness).toContain("entry.publicPath === currentPath");
    expect(readiness).toContain("picture?.querySelectorAll('source').length === 1");
    expect(readiness).toContain("avifSource.getAttribute('srcset') === contract.avifSourceSet");
    expect(readiness).toContain("avifSource.getAttribute('sizes') === contract.sizes");
    expect(readiness).toContain("image?.getAttribute('src') === contract.fallbackPath");
    expect(readiness).toContain("image?.getAttribute('srcset') === contract.webpSourceSet");
    expect(readiness).toContain("image?.getAttribute('sizes') === contract.sizes");
    expect(readiness).toContain("backdrops.length === 1");
    expect(readiness).toContain("pictures.length === 1");
    expect(readiness).toContain("images.length === 1");
    expect(readiness).toContain("backdrop?.dataset.imageState === 'ready'");
    expect(readiness).toContain("image?.complete");
    expect(readiness).toContain("image.naturalWidth > 0");
    expect(readiness).toContain("heroCanvasCount === 0");
    expect(readiness).toContain("heroVideoCount === 0");
    expect(readiness).toContain("responsiveImageReady");

    expect(reportAssertions).toContain("report.hero.backdropCount, 1");
    expect(reportAssertions).toContain("report.hero.pictureCount, 1");
    expect(reportAssertions).toContain("report.hero.imageCount, 1");
    expect(reportAssertions).toContain("report.hero.sourceCount, 1");
    expect(reportAssertions).toContain("report.hero.avifSourceSet, heroContract.avifSourceSet");
    expect(reportAssertions).toContain("report.hero.webpSourceSet, heroContract.webpSourceSet");
    expect(reportAssertions).toContain("report.hero.fallbackPath, heroContract.fallbackPath");
    expect(reportAssertions).toContain("report.hero.heroCanvasCount, 0");
    expect(reportAssertions).toContain("report.hero.heroVideoCount, 0");
    expect(reportAssertions).toContain("report.hero.masterUrlPresentInMarkup, false");
    expect(reportAssertions).toContain("report.hero.derivativeResourceEntries.length, 1");
    expect(reportAssertions).toContain(
      "report.hero.derivativeResourceEntries[0].path, report.hero.currentPath",
    );
    expect(finalAssertions).toContain("derivativeRequestEvents.length,\n      1");
    expect(finalAssertions).toContain("assert.deepEqual(masterRequests, []");

    for (const staleMarker of [
      ".watch-canvas-shell",
      ".watch-static-fallback",
      "WatchMovementCanvas",
      "canvasReady",
      "fallbackVisible",
      "webglAvailable",
      "data-webgl",
    ]) {
      expect(source).not.toContain(staleMarker);
    }
    expect(readiness.toLowerCase()).not.toContain("webgl");
    expect(readiness).not.toContain("backgroundImage");
  });

  it("locks the selected response identity, HTTP contract, dimensions, and transfer/decode budgets", () => {
    const resourceAssertions = sourceBetween(
      "function assertSelectedResource",
      "function assertHeroFrameProbe",
    );
    const responseCapture = sourceBetween(
      'client.on("Network.responseReceived"',
      'client.on("Network.loadingFinished"',
    );
    const selectedResourceCapture = sourceBetween(
      "const selectedRequestRecord =",
      "performanceSupport = await client.evaluate(performanceSetupExpression);",
    );

    expect(responseCapture).toContain("response.status");
    expect(responseCapture).toContain("response.mimeType");
    expect(responseCapture).toContain("content-type");
    expect(responseCapture).toContain("encodedDataLengthAtHeaders");
    expect(selectedResourceCapture).toContain("record.request.path === readiness.currentPath");
    expect(selectedResourceCapture).toContain("manifestDerivativeByPath.get(readiness.currentPath)");
    expect(selectedResourceCapture).toContain('client.send("Network.getResponseBody"');
    expect(selectedResourceCapture).toContain("Buffer.from(");
    expect(selectedResourceCapture).toContain("bodyByteLength: selectedBody.byteLength");
    expect(selectedResourceCapture).toContain("bodySha256: sha256(selectedBody)");
    expect(selectedResourceCapture).toContain("requestCount: derivativeRequestEvents.length");

    expect(resourceAssertions).toContain("resource.requestCount, 1");
    expect(resourceAssertions).toContain('resource.request.method, "GET"');
    expect(resourceAssertions).toContain('resource.request.type, "Image"');
    expect(resourceAssertions).toContain("resource.request.path, readiness.currentPath");
    expect(resourceAssertions).toContain("resource.response.status, 200");
    expect(resourceAssertions).toContain("resource.response.mimeType,\n    resource.manifest.mediaType");
    expect(resourceAssertions).toContain(
      "resource.response.contentType.toLowerCase().startsWith(resource.manifest.mediaType)",
    );
    expect(resourceAssertions).toContain('resource.manifest.mediaType === "image/avif"');
    expect(resourceAssertions).toContain('resource.manifest.mediaType === "image/webp"');
    expect(resourceAssertions).toContain("resource.bodyByteLength, resource.manifest.byteLength");
    expect(resourceAssertions).toContain("resource.bodySha256, resource.manifest.sha256");
    expect(resourceAssertions).toContain(
      "resource.resourceIntrinsicWidth, resource.manifest.intrinsicWidth",
    );
    expect(resourceAssertions).toContain(
      "resource.resourceIntrinsicHeight, resource.manifest.intrinsicHeight",
    );
    expect(resourceAssertions).toContain("resource.reportedNaturalDimensionsValid,\n    true");
    expect(resourceAssertions).toContain(
      "resource.decodedPixelCount,\n    resource.manifest.decodedPixelCount",
    );
    expect(resourceAssertions).toContain(
      "resource.decodedRgbaByteLength,\n    resource.manifest.decodedRgbaByteLength",
    );
    expect(resourceAssertions).toContain(
      "resource.bodyByteLength <= heroContract.budgets.maxBrowserSelectedTransferBytes",
    );
    expect(resourceAssertions).toContain("resource.bodyByteLength <= 1_048_576");
    expect(resourceAssertions).toContain(
      "resource.decodedPixelCount <= heroContract.budgets.maxBrowserSelectedDecodedPixels",
    );
    expect(resourceAssertions).toContain(
      "resource.decodedRgbaByteLength <= heroContract.budgets.maxBrowserSelectedDecodedRgbaBytes",
    );
  });

  it("locks compact and expanded focal, cover, reserved geometry, no-edge, and hit-testing checks", () => {
    const layoutSetup = sourceBetween(
      "const LAYOUT_VIEWPORTS = Object.freeze({",
      "const layoutInspectionExpression = String.raw`",
    );
    const layoutInspection = sourceBetween(
      "const layoutInspectionExpression = String.raw`",
      "const inspectLayout = async",
    );
    const layoutAssertions = sourceBetween(
      "const assertLayoutReport = (layout, expectation) => {",
      "const assertPreferenceReport = (layout, preference) => {",
    );
    const finalAssertions = sourceBetween("if (shouldAssert) {", "} catch (error) {");

    expect(layoutSetup).toContain("compact: Object.freeze({ width: 390, height: 844 })");
    expect(layoutSetup).toContain("expanded: VIEWPORT");
    expect(layoutInspection).toContain("const currentPath = image.currentSrc");
    expect(layoutInspection).toContain("entry.publicPath === currentPath");
    expect(layoutInspection).toContain("const naturalDimensionsValid = Boolean(");
    expect(layoutInspection).toContain("const coverWidth = Math.max(");
    expect(layoutInspection).toContain("const coverHeight = Math.max(");
    expect(layoutInspection).toContain("'translate3d(-1.25%, -0.5%, 0) scale(1.06)'");
    expect(layoutInspection).toContain("'translate3d(1.25%, 0.75%, 0) scale(1.10)'");
    expect(layoutInspection).toContain("coversBackdrop: box.left <= backdropRect.left + 0.5");
    expect(layoutInspection).toContain("box.right >= backdropRect.right - 0.5");
    expect(layoutInspection).toContain("box.bottom >= backdropRect.bottom - 0.5");
    expect(layoutInspection).toContain("Math.abs(shellRect.left - backdropRect.left) <= 0.5");
    expect(layoutInspection).toContain("Math.abs(shellRect.width - backdropRect.width) <= 0.5");
    expect(layoutInspection).toContain("document.elementsFromPoint(center.x, center.y)");
    expect(layoutInspection).toContain("controls.length === ${EXPECTED_NODE_COUNT}");
    expect(layoutInspection).toContain("centerHitRecords.every((record) => record.hit)");

    expect(layoutAssertions).toContain("layout.hero.backdropCount, 1");
    expect(layoutAssertions).toContain("layout.hero.pictureCount, 1");
    expect(layoutAssertions).toContain("layout.hero.imageCount, 1");
    expect(layoutAssertions).toContain("layout.hero.avifSourceSet, heroContract.avifSourceSet");
    expect(layoutAssertions).toContain("layout.hero.webpSourceSet, heroContract.webpSourceSet");
    expect(layoutAssertions).toContain("layout.hero.naturalDimensionsValid,\n      true");
    expect(layoutAssertions).toContain('layout.hero.objectFit, "cover"');
    expect(layoutAssertions).toContain(
      "`${expectation.focalPoint.xPercent}% ${expectation.focalPoint.yPercent}%`",
    );
    expect(layoutAssertions).toContain("layout.hero.reservedGeometry, true");
    expect(layoutAssertions).toContain("layout.hero.coverGeometry.fillsBackdrop, true");
    expect(layoutAssertions).toContain(
      "layout.hero.motionExtrema.every((extremum) => extremum.coversBackdrop)",
    );
    expect(layoutAssertions).toContain("layout.hitTesting.controlCount,\n      EXPECTED_NODE_COUNT");
    expect(layoutAssertions).toContain("layout.hitTesting.allControlsHitTestable,\n      true");
    expect(layoutAssertions).toContain("record.id === record.resolvedId");
    expect(layoutAssertions).toContain("layout.overflow.scrollWidth <= layout.overflow.clientWidth");
    expect(layoutAssertions).toContain("layout.wordmark.centerDelta <= 1");
    expect(layoutAssertions).toContain("link.box.width >= 44 && link.box.height >= 44");

    expect(finalAssertions).toContain("assertLayoutReport(layoutReports.expanded");
    expect(finalAssertions).toContain("focalPoint: heroContract.focalPoints.expanded");
    expect(finalAssertions).toContain("height: 68");
    expect(finalAssertions).toContain("radius: 22");
    expect(finalAssertions).toContain("assertLayoutReport(layoutReports.compact");
    expect(finalAssertions).toContain("focalPoint: heroContract.focalPoints.compact");
    expect(finalAssertions).toContain("height: 60");
    expect(finalAssertions).toContain("radius: 18");
    expect(finalAssertions).toContain(
      'visibleLinks: ["COLLECTION", "ABOUT", "MERIDIAN WATCHES home", "CONTACT", "LOGIN"]',
    );
    expect(finalAssertions).toContain(
      'visibleLinks: ["COLLECTION", "MERIDIAN WATCHES home", "LOGIN"]',
    );
  });

  it("requires static audited overlays, reduced-motion stasis, and preference fallbacks", () => {
    const inspection = sourceBetween(
      "const inspectionExpression = String.raw`",
      "const interactionStateExpression = String.raw`",
    );
    const reportAssertions = sourceBetween(
      "function assertReport",
      "function assertSelectedResource",
    );
    const stasisAssertions = sourceBetween(
      "function assertReducedMotionStasis",
      "function assertPerformanceSamples",
    );
    const preferenceAssertions = sourceBetween(
      "const assertPreferenceReport = (layout, preference) => {",
      "const layoutReports = {",
    );
    const preferenceRuns = sourceBetween("const layoutReports = {", "const result = {");
    const finalAssertions = sourceBetween("if (shouldAssert) {", "} catch (error) {");

    for (const selector of [
      ".site-masthead",
      ".search-pill",
      ".search-results",
      ".definition-layer",
      ".definition-panel",
      ".definition-panel__footer",
    ]) {
      expect(inspection).toContain(`'${selector}'`);
    }
    expect(inspection).toContain("animationName: style.animationName");
    expect(inspection).toContain("backdropFilter: style.backdropFilter || style.webkitBackdropFilter");
    expect(inspection).toContain("backgroundPosition: style.backgroundPosition");
    expect(inspection).toContain("filter: style.filter");
    expect(reportAssertions).toContain(
      'report.auditedOverlays.every((overlay) => overlay.backdropFilter === "none")',
    );
    expect(reportAssertions).toContain(
      'report.auditedOverlays.every((overlay) => overlay.filter === "none")',
    );
    expect(reportAssertions).toContain(
      'report.auditedOverlays.every((overlay) => overlay.animationName === "none")',
    );

    expect(preferenceRuns).toContain("reducedTransparency: await inspectLayout");
    expect(preferenceRuns).toContain("prefers-reduced-transparency");
    expect(preferenceRuns).toContain("increasedContrast: await inspectLayout");
    expect(preferenceRuns).toContain("prefers-contrast");
    expect(preferenceRuns).toContain("forcedColors: await inspectLayout");
    expect(preferenceRuns).toContain("forced-colors");
    expect(preferenceRuns).toContain("reducedMotion: await inspectLayout");
    expect(preferenceRuns).toContain("prefers-reduced-motion");
    expect(preferenceRuns).toContain("animationNameBefore");
    expect(preferenceRuns).toContain("transformBefore");
    expect(preferenceRuns).toContain("requestAnimationFrame(() => requestAnimationFrame(() =>");

    expect(stasisAssertions).toContain("stasis.mediaReducedMotion, true");
    expect(stasisAssertions).toContain('stasis.animationNameBefore, "none"');
    expect(stasisAssertions).toContain('stasis.animationNameAfter, "none"');
    expect(stasisAssertions).toContain("stasis.transformBefore, stasis.transformAfter");
    expect(preferenceAssertions).toContain('layout.header.backdropFilter, "none"');
    expect(preferenceAssertions).toContain('layout.header.backgroundImage, "none"');
    expect(preferenceAssertions).toContain('layout.header.backgroundColor, "rgb(16, 20, 22)"');
    expect(preferenceAssertions).toContain('layout.header.backgroundColor, "rgb(8, 11, 12)"');
    expect(preferenceAssertions).toContain("layout.media.forcedColors, true");
    expect(finalAssertions).toContain(
      'assertPreferenceReport(layoutReports.reducedTransparency, "reduced transparency")',
    );
    expect(finalAssertions).toContain(
      'assertPreferenceReport(layoutReports.increasedContrast, "increased contrast")',
    );
    expect(finalAssertions).toContain(
      'assertPreferenceReport(layoutReports.forcedColors, "forced colors")',
    );
    expect(finalAssertions).toContain("assertReducedMotionStasis(reducedMotionStasis)");
  });

  it("locks the exact finite 120-frame algorithm and emits raw intervals before thresholds", () => {
    const frameProbe = sourceBetween(
      "const heroFrameProbeExpression = String.raw`",
      "const performanceSetupExpression = String.raw`",
    );
    const frameAssertions = sourceBetween(
      "function assertHeroFrameProbe",
      "function assertReducedMotionStasis",
    );
    const evidence = sourceBetween("const evidence = {", "if (shouldAssert) {");
    const outputIndex = source.indexOf(
      'console.log(JSON.stringify(process.env.ATLAS_VERBOSE === "1" ? result : evidence',
    );
    const assertionIndex = source.indexOf("assertHeroFrameProbe(heroFrameProbe);");

    expect(source).toContain("const HERO_FRAME_INTERVAL_COUNT = 120;");
    expect(source).toContain("const HERO_FRAME_INTERVAL_BUDGET_MS = 25;");
    expect(source).toContain("const HERO_FRAME_INTERVAL_LIMIT_MS = 100;");
    expect(source).toContain("const HERO_FRAME_PROBE_TIMEOUT_MS = 10_000;");
    expectInOrder(frameProbe, [
      "const intervals = [];",
      "let previousTimestamp = null;",
      "window.setTimeout(() =>",
      "window.cancelAnimationFrame(frameRequest);",
      "const sample = (timestamp) =>",
      "intervals.push(timestamp - previousTimestamp)",
      "if (intervals.length === ${HERO_FRAME_INTERVAL_COUNT})",
      "window.clearTimeout(timeout);",
      "completed: true",
      "frameRequest = window.requestAnimationFrame(sample);",
    ]);
    expect(frameAssertions).toContain("probe.intervals.length,\n    HERO_FRAME_INTERVAL_COUNT");
    expect(frameAssertions).toContain(
      "probe.intervals.every((interval) => Number.isFinite(interval) && interval > 0)",
    );
    expect(frameAssertions).toContain("interval <= HERO_FRAME_INTERVAL_BUDGET_MS");
    expect(frameAssertions).toContain(
      "withinBudgetCount >= Math.ceil(HERO_FRAME_INTERVAL_COUNT * 0.95)",
    );
    expect(frameAssertions).toContain(
      "probe.intervals.every((interval) => interval <= HERO_FRAME_INTERVAL_LIMIT_MS)",
    );
    expect(evidence).toContain("heroFrameProbe,");
    expect(source).toContain(
      "// Raw interaction records and all 120 frame intervals are emitted before threshold assertions.",
    );
    expect(outputIndex).toBeGreaterThanOrEqual(0);
    expect(outputIndex).toBeLessThan(assertionIndex);

    for (const forbiddenShortcut of ["delay(", "setInterval", "average", "retry", ".sort(", ".slice("]) {
      expect(frameProbe.toLowerCase()).not.toContain(forbiddenShortcut.toLowerCase());
      expect(frameAssertions.toLowerCase()).not.toContain(forbiddenShortcut.toLowerCase());
    }
  });

  it("rejects arbitrary interaction waits, background substitutions, and eager candidate loading", () => {
    const readiness = sourceBetween(
      "const readinessExpression = String.raw`",
      "const heroFrameProbeExpression = String.raw`",
    );
    const measuredInteraction = sourceBetween(
      "async function runMeasuredMenInteraction",
      "let chromeProcess;",
    );
    const reportAssertions = sourceBetween(
      "function assertReport",
      "function assertSelectedResource",
    );
    const finalAssertions = sourceBetween("if (shouldAssert) {", "} catch (error) {");

    expect(measuredInteraction).not.toContain("delay(");
    expect(measuredInteraction).not.toContain("setTimeout(");
    expect(measuredInteraction).not.toContain("Date.now()");
    expect(measuredInteraction.toLowerCase()).not.toContain("average");
    expect(measuredInteraction.toLowerCase()).not.toContain("retry");
    expect(readiness).not.toContain("backgroundImage");
    expect(readiness).not.toContain("getContext(");
    expect(readiness.toLowerCase()).not.toContain("webgl");
    expect(source).not.toMatch(
      /Promise\.all\(\s*(?:manifestDerivatives|contract\.derivatives)\.map/,
    );
    expect(reportAssertions).toContain("report.hero.derivativeResourceEntries.length, 1");
    expect(finalAssertions).toContain("derivativeRequestEvents.length,\n      1");
    expect(finalAssertions).toContain("assert.deepEqual(masterRequests, []");
    expect(finalAssertions).toContain("assert.deepEqual(externalRequests, []");
    expect(source).toContain("Network.setCacheDisabled");
    expect(source).toContain("Network.setBypassServiceWorker");
  });

  it("locks complete runtime, console, hydration, network, failure, and finite cleanup evidence", () => {
    const runtimeCapture = sourceBetween(
      'client.on("Runtime.exceptionThrown"',
      "await Promise.all([\n    client.send(\"Page.enable\")",
    );
    const evidence = sourceBetween("const evidence = {", "if (shouldAssert) {");
    const finalAssertions = sourceBetween("if (shouldAssert) {", "} catch (error) {");
    const failureBlock = sourceBetween("} catch (error) {", "} finally {");
    const cleanupBlock = source.slice(source.indexOf("} finally {"));

    expect(source).toContain("assertLocalApplicationUrl(baseUrl)");
    expect(runtimeCapture).toContain('client.on("Runtime.exceptionThrown"');
    expect(runtimeCapture).toContain('client.on("Runtime.consoleAPICalled"');
    expect(runtimeCapture).toContain('client.on("Log.entryAdded"');
    expect(runtimeCapture).toContain('client.on("Network.requestWillBeSent"');
    expect(runtimeCapture).toContain('client.on("Network.responseReceived"');
    expect(runtimeCapture).toContain('client.on("Network.loadingFinished"');
    expect(runtimeCapture).toContain('client.on("Network.loadingFailed"');
    expect(source).toContain("hydrationRecoveries.push(record)");
    expect(runtimeCapture).toContain("externalRequests.push");
    expect(runtimeCapture).toContain("masterRequests.push");
    expect(runtimeCapture).toContain("derivativeRequestEvents.push");

    for (const evidenceField of [
      "runtimeErrors,",
      "consoleErrors,",
      "hydrationRecoveries,",
      "failedResponses,",
      "derivativeRequestEvents,",
      "masterRequests,",
      "externalRequests,",
      "performanceSamples:",
      "heroFrameProbe,",
      "selectedResource,",
      "reducedMotionStasis,",
    ]) {
      expect(evidence).toContain(evidenceField);
    }
    expect(finalAssertions).toContain("assert.deepEqual(runtimeErrors, []");
    expect(finalAssertions).toContain("assert.deepEqual(consoleErrors, []");
    expect(finalAssertions).toContain("assert.deepEqual(hydrationRecoveries, []");
    expect(finalAssertions).toContain("assert.deepEqual(failedResponses, []");
    expect(finalAssertions).toContain("assert.deepEqual(masterRequests, []");
    expect(finalAssertions).toContain("assert.deepEqual(externalRequests, []");
    expect(failureBlock).toContain("performanceSamples");
    expect(failureBlock).toContain("heroFrameProbe");
    expect(failureBlock).toContain("selectedResource");
    expect(failureBlock).toContain("runtimeErrors");
    expect(failureBlock).toContain("consoleErrors");
    expect(failureBlock).toContain("hydrationRecoveries");
    expect(failureBlock).toContain("failedResponses");
    expect(failureBlock).toContain("console.error(JSON.stringify");
    expect(cleanupBlock).toContain("observer?.disconnect()");
    expect(cleanupBlock).toContain("await client.close().catch");
    expect(cleanupBlock).toContain("await stopChild(chromeProcess);");
    expect(cleanupBlock).toContain("await stopChild(serverProcess);");
    expect(cleanupBlock).toContain("await rm(temporaryRoot, { recursive: true, force: true });");
  });
});
