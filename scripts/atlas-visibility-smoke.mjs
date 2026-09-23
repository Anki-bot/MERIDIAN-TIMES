import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VIEWPORT = Object.freeze({ width: 1024, height: 576 });
const EXPECTED_NODE_COUNT = 13;
const EXPECTED_AUDIENCE_COUNT = 2;
const EXPECTED_BRAND_COUNT = 11;
const EXPECTED_MEN_EDGE_COUNT = 12;
const EXPECTED_PATEK_EDGE_COUNT = 2;
const MEASURED_INTERACTION_COUNT = 3;
const VISUAL_RESPONSE_LIMIT_MS = 100;
const MAIN_THREAD_TASK_LIMIT_MS = 100;
const CUMULATIVE_BLOCKING_LIMIT_MS = 100;
const LONG_TASK_BOUNDARY_MS = 50;
const PERFORMANCE_PROBE_TIMEOUT_MS = 5_000;
const HERO_FRAME_INTERVAL_COUNT = 120;
const HERO_FRAME_INTERVAL_BUDGET_MS = 25;
const HERO_FRAME_INTERVAL_LIMIT_MS = 100;
const HERO_FRAME_PROBE_TIMEOUT_MS = 10_000;
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetManifest = JSON.parse(
  await readFile(path.join(projectRoot, "data", "watch-image-asset.json"), "utf8"),
);
const manifestDerivatives = Object.freeze(assetManifest.derivativePolicy.derivatives.map((entry) => (
  Object.freeze({ ...entry })
)));
const manifestDerivativeByPath = new Map(
  manifestDerivatives.map((entry) => [entry.publicPath, entry]),
);
const sourceSetFor = (mediaType) => manifestDerivatives
  .filter((entry) => entry.mediaType === mediaType)
  .sort((left, right) => left.intrinsicWidth - right.intrinsicWidth)
  .map((entry) => `${entry.publicPath} ${entry.intrinsicWidth}w`)
  .join(", ");
const fallbackDerivative = manifestDerivatives.find((entry) => (
  entry.mediaType === "image/webp" && entry.intrinsicWidth === 1380
));
assert.ok(fallbackDerivative, "The manifest must contain the 1380px WebP runtime fallback.");
const heroContract = Object.freeze({
  avifSourceSet: sourceSetFor("image/avif"),
  budgets: Object.freeze({ ...assetManifest.derivativePolicy.budgets }),
  derivatives: manifestDerivatives.map((entry) => Object.freeze({
    byteLength: entry.byteLength,
    decodedPixelCount: entry.decodedPixelCount,
    decodedRgbaByteLength: entry.decodedRgbaByteLength,
    intrinsicHeight: entry.intrinsicHeight,
    intrinsicWidth: entry.intrinsicWidth,
    mediaType: entry.mediaType,
    publicPath: entry.publicPath,
    sha256: entry.sha256,
  })),
  fallbackPath: fallbackDerivative.publicPath,
  focalPoints: Object.freeze({
    compact: Object.freeze({ ...assetManifest.presentation.focalPoints.compact }),
    expanded: Object.freeze({ ...assetManifest.presentation.focalPoints.expanded }),
  }),
  masterSourceFile: assetManifest.master.sourceFile,
  sizes: assetManifest.derivativePolicy.sizes,
  webpSourceSet: sourceSetFor("image/webp"),
});
let baseUrl = process.env.ATLAS_BASE_URL ?? null;
const screenshotPath = process.env.ATLAS_SCREENSHOT
  ? path.resolve(projectRoot, process.env.ATLAS_SCREENSHOT)
  : null;
const shouldAssert = process.env.ATLAS_ASSERT !== "0";
const temporaryRoot = path.join(projectRoot, ".next", `atlas-smoke-${process.pid}`);
const profilePath = path.join(temporaryRoot, "chrome-profile");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathnameFor(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function assertLocalApplicationUrl(url) {
  const parsed = new URL(url);
  assert.ok(
    (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1"),
    `Atlas smoke requires a local application URL, received ${url}`,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Could not allocate a local port for the finite atlas smoke server.");
  return port;
}

async function waitForServer(url, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The finite production server is still starting.
    }
    await delay(100);
  }
  throw new Error(`The finite atlas server did not become ready.\n${output()}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next supported local browser path.
    }
  }

  throw new Error("A local Chrome or Chromium executable is required for the atlas smoke test.");
}

async function waitForDebuggerPort() {
  const activePortFile = path.join(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const [portLine] = (await readFile(activePortFile, "utf8")).trim().split("\n");
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chrome creates the file only after the debugging endpoint is ready.
    }
    await delay(50);
  }

  throw new Error("Chrome did not expose its debugging endpoint within 10 seconds.");
}

async function waitForPageTarget(port) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const page = targets.find((target) => target.type === "page");
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    await delay(50);
  }

  throw new Error("Chrome did not create a page target within 10 seconds.");
}

async function createProtocolClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }

    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  function on(method, listener) {
    const methodListeners = listeners.get(method) ?? new Set();
    methodListeners.add(listener);
    listeners.set(method, methodListeners);
    return () => methodListeners.delete(listener);
  }

  function once(method, timeout = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        remove();
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeout);
      const remove = on(method, (params) => {
        clearTimeout(timer);
        remove();
        resolve(params);
      });
    });
  }

  async function evaluate(expression, awaitPromise = false) {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? "Browser evaluation failed.");
    }
    return response.result.value;
  }

  async function close() {
    if (socket.readyState === WebSocket.OPEN) socket.close();
    await Promise.race([
      new Promise((resolve) => socket.addEventListener("close", resolve, { once: true })),
      delay(500),
    ]);
  }

  return { close, evaluate, once, on, send };
}

async function poll(evaluate, expression, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await evaluate(expression, true);
    if (lastValue?.ready ?? lastValue === true) return lastValue;
    await delay(50);
  }

  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

async function waitForRestingGraph(evaluate, description) {
  return poll(
    evaluate,
    "({ ready: document.querySelector('.node-graph')?.dataset.networkMode === 'resting' })",
    description,
  );
}

async function waitForRestingAndTwoFrames(evaluate, description) {
  await waitForRestingGraph(evaluate, description);
  await evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
    true,
  );
}

const readinessExpression = String.raw`
  (async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const contract = ${JSON.stringify(heroContract)};
    const firstNode = document.querySelector('.atlas-node');
    const backdrops = Array.from(document.querySelectorAll('.watch-image-backdrop'));
    const pictures = Array.from(document.querySelectorAll('.watch-image-backdrop picture'));
    const images = Array.from(document.querySelectorAll('.watch-image-backdrop img'));
    const backdrop = backdrops[0] ?? null;
    const picture = pictures[0] ?? null;
    const image = images[0] ?? null;
    const avifSource = picture?.querySelector('source[type="image/avif"]') ?? null;
    const currentPath = image?.currentSrc
      ? new URL(image.currentSrc, location.href).pathname
      : null;
    const selectedManifest = contract.derivatives.find(
      (entry) => entry.publicPath === currentPath
    ) ?? null;
    const hydrated = Boolean(firstNode && Object.keys(firstNode).some(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$')
    ));
    const backdropRect = backdrop?.getBoundingClientRect() ?? null;
    const pictureRect = picture?.getBoundingClientRect() ?? null;
    const sourceSetsValid = Boolean(
      avifSource
        && picture?.querySelectorAll('source').length === 1
        && avifSource.getAttribute('srcset') === contract.avifSourceSet
        && avifSource.getAttribute('sizes') === contract.sizes
        && image?.getAttribute('src') === contract.fallbackPath
        && image?.getAttribute('srcset') === contract.webpSourceSet
        && image?.getAttribute('sizes') === contract.sizes
    );
    const candidateDensity = selectedManifest && innerWidth > 0
      ? selectedManifest.intrinsicWidth / innerWidth
      : null;
    const expectedReportedNaturalWidth = candidateDensity
      ? Math.round(selectedManifest.intrinsicWidth / candidateDensity)
      : null;
    const expectedReportedNaturalHeight = candidateDensity
      ? Math.round(selectedManifest.intrinsicHeight / candidateDensity)
      : null;
    const naturalDimensionsValid = Boolean(
      selectedManifest
        && candidateDensity
        && Math.abs(image?.naturalWidth - expectedReportedNaturalWidth) <= 1
        && Math.abs(image?.naturalHeight - expectedReportedNaturalHeight) <= 1
    );
    const reservedGeometry = Boolean(
      backdropRect
        && pictureRect
        && backdropRect.width > 0
        && backdropRect.height > 0
        && Math.abs(backdropRect.left - pictureRect.left) <= 0.5
        && Math.abs(backdropRect.top - pictureRect.top) <= 0.5
        && Math.abs(backdropRect.width - pictureRect.width) <= 0.5
        && Math.abs(backdropRect.height - pictureRect.height) <= 0.5
    );
    const derivativeResourceEntries = performance.getEntriesByType('resource')
      .filter((entry) => contract.derivatives.some(
        (candidate) => new URL(entry.name, location.href).pathname === candidate.publicPath
      ))
      .map((entry) => ({
        initiatorType: entry.initiatorType,
        name: entry.name,
        path: new URL(entry.name, location.href).pathname,
        transferSize: entry.transferSize,
      }));
    const heroCanvasCount = document.querySelectorAll('.elite-shell canvas').length;
    const heroVideoCount = document.querySelectorAll('.elite-shell video').length;
    const responsiveImageReady = Boolean(
      backdrops.length === 1
        && pictures.length === 1
        && images.length === 1
        && backdrop?.dataset.imageState === 'ready'
        && image?.complete
        && image.naturalWidth > 0
        && sourceSetsValid
        && naturalDimensionsValid
        && reservedGeometry
        && heroCanvasCount === 0
        && heroVideoCount === 0
    );
    return {
      ready: document.readyState === 'complete'
        && (!document.fonts || document.fonts.status === 'loaded')
        && hydrated
        && document.querySelectorAll('.atlas-node').length === ${EXPECTED_NODE_COUNT}
        && responsiveImageReady,
      readyState: document.readyState,
      fontStatus: document.fonts?.status ?? 'unsupported',
      hydrated,
      nodeCount: document.querySelectorAll('.atlas-node').length,
      backdropCount: backdrops.length,
      pictureCount: pictures.length,
      imageCount: images.length,
      imageState: backdrop?.dataset.imageState ?? null,
      currentPath,
      selectedManifest,
      sourceSetsValid,
      naturalDimensionsValid,
      candidateDensity,
      expectedReportedNaturalWidth,
      expectedReportedNaturalHeight,
      naturalWidth: image?.naturalWidth ?? 0,
      naturalHeight: image?.naturalHeight ?? 0,
      reservedGeometry,
      heroCanvasCount,
      heroVideoCount,
      derivativeResourceEntries,
      responsiveImageReady,
    };
  })()
`;

const heroFrameProbeExpression = String.raw`
  new Promise((resolve) => {
    const intervals = [];
    const startedAt = performance.now();
    let previousTimestamp = null;
    let frameRequest = 0;
    const timeout = window.setTimeout(() => {
      window.cancelAnimationFrame(frameRequest);
      resolve({
        completed: false,
        error: 'Timed out before collecting ${HERO_FRAME_INTERVAL_COUNT} hero frame intervals.',
        intervals,
        startedAt,
        finishedAt: performance.now(),
      });
    }, ${HERO_FRAME_PROBE_TIMEOUT_MS});
    const sample = (timestamp) => {
      if (previousTimestamp !== null) intervals.push(timestamp - previousTimestamp);
      previousTimestamp = timestamp;
      if (intervals.length === ${HERO_FRAME_INTERVAL_COUNT}) {
        window.clearTimeout(timeout);
        resolve({
          completed: true,
          error: null,
          intervals,
          startedAt,
          finishedAt: performance.now(),
        });
        return;
      }
      frameRequest = window.requestAnimationFrame(sample);
    };
    frameRequest = window.requestAnimationFrame(sample);
  })
`;

const performanceSetupExpression = String.raw`
  (() => {
    const supportedEntryTypes = typeof PerformanceObserver === 'function'
      ? Array.from(PerformanceObserver.supportedEntryTypes ?? [])
      : [];
    if (!supportedEntryTypes.includes('longtask')) {
      return { supported: false, supportedEntryTypes };
    }

    window.__atlasPerformance?.observer?.disconnect();

    const numeric = (value) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const state = {
      observer: null,
      longTasks: [],
      samples: [],
      activeSample: null,
      samplePromise: null,
    };

    const appendLongTasks = (entries) => {
      for (const entry of entries) {
        if (entry.entryType !== 'longtask') continue;
        state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    };

    const readActiveGraphState = () => {
      const graphSvgs = Array.from(document.querySelectorAll('.graph-connections'));
      const activeGroups = Array.from(
        document.querySelectorAll('.graph-connections .graph-connections__active > g')
      );
      const activePaths = Array.from(
        document.querySelectorAll('.graph-connections .graph-connections__active path'),
        (path) => {
          const style = getComputedStyle(path);
          return {
            edgeId: path.closest('g')?.dataset.edgeId ?? null,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
            visible: style.display !== 'none'
              && style.visibility === 'visible'
              && numeric(style.opacity) > 0
              && numeric(style.strokeWidth) > 0
              && style.stroke !== 'none',
          };
        }
      );
      const particles = Array.from(
        document.querySelectorAll('.graph-connections .connection-particle'),
        (particle) => {
          const style = getComputedStyle(particle);
          const radius = numeric(particle.getAttribute('r') ?? '0');
          return {
            edgeId: particle.closest('g')?.dataset.edgeId ?? null,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            fill: style.fill,
            radius,
            visible: style.display !== 'none'
              && style.visibility === 'visible'
              && numeric(style.opacity) > 0
              && radius > 0
              && style.fill !== 'none',
          };
        }
      );
      const graphVariants = graphSvgs.map((svg) => (
        svg.classList.contains('graph-connections--mobile') ? 'mobile'
          : svg.classList.contains('graph-connections--desktop') ? 'desktop'
            : 'unknown'
      ));
      const animateMotionCount = document.querySelectorAll(
        '.graph-connections .graph-connections__active animateMotion'
      ).length;
      const mode = document.querySelector('.node-graph')?.dataset.networkMode ?? null;
      const menReady = mode === 'preview-men'
        && graphSvgs.length === 1
        && activeGroups.length === ${EXPECTED_MEN_EDGE_COUNT}
        && activePaths.length === ${EXPECTED_MEN_EDGE_COUNT}
        && particles.length === ${EXPECTED_MEN_EDGE_COUNT}
        && animateMotionCount === ${EXPECTED_MEN_EDGE_COUNT}
        && activePaths.every((path) => path.visible)
        && particles.every((particle) => particle.visible);

      return {
        mode,
        graphSvgCount: graphSvgs.length,
        graphVariants,
        activeEdgeCount: activeGroups.length,
        activePathCount: activePaths.length,
        particleCount: particles.length,
        animateMotionCount,
        activePaths,
        particles,
        menReady,
      };
    };

    const hitTestControls = () => {
      const controls = Array.from(document.querySelectorAll('.atlas-node'));
      const records = controls.map((control) => {
        const rect = control.getBoundingClientRect();
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const stack = document.elementsFromPoint(center.x, center.y);
        const resolvedControl = stack
          .map((element) => element.closest?.('.atlas-node') ?? null)
          .find(Boolean) ?? null;
        return {
          id: control.dataset.presentationId ?? null,
          resolvedId: resolvedControl?.dataset.presentationId ?? null,
          center,
          hit: resolvedControl === control,
        };
      });
      return {
        controlCount: controls.length,
        records,
        allControlsHitTestable: controls.length === ${EXPECTED_NODE_COUNT}
          && records.every((record) => record.hit),
      };
    };

    state.readActiveGraphState = readActiveGraphState;
    state.hitTestControls = hitTestControls;
    state.clearLongTasks = () => {
      state.observer.takeRecords();
      state.longTasks.length = 0;
    };
    state.armSample = (sampleIndex) => {
      if (state.activeSample) {
        return { armed: false, error: 'A performance sample is already active.' };
      }

      const men = document.querySelector('[data-presentation-id="men"]');
      if (!men) return { armed: false, error: 'The MEN control is unavailable.' };

      const sample = {
        sampleNumber: sampleIndex + 1,
        eventType: null,
        eventTimeStamp: null,
        readyFrameTime: null,
        sampleEnd: null,
        visualResponseLatencyMs: null,
        longestTaskMs: null,
        cumulativeBlockingTimeMs: null,
        longTasks: [],
        hitTesting: null,
        readyFanState: null,
        finalFanState: null,
        error: null,
      };

      let resolveSample;
      let finished = false;
      let eventGuard;
      const samplePromise = new Promise((resolve) => {
        resolveSample = resolve;
      });

      const finalize = (error = null) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(eventGuard);
        men.removeEventListener('pointerover', onPointerStart, true);
        appendLongTasks(state.observer.takeRecords());

        const sampleEnd = performance.now();
        const overlappingLongTasks = sample.eventTimeStamp === null
          ? []
          : state.longTasks.filter((task) => (
            task.startTime <= sampleEnd
              && task.startTime + task.duration >= sample.eventTimeStamp
          ));
        const longestTaskMs = overlappingLongTasks.reduce(
          (longest, task) => Math.max(longest, task.duration),
          0
        );
        const cumulativeBlockingTimeMs = overlappingLongTasks.reduce(
          (blocking, task) => blocking + Math.max(0, task.duration - ${LONG_TASK_BOUNDARY_MS}),
          0
        );

        Object.assign(sample, {
          sampleEnd,
          longestTaskMs,
          cumulativeBlockingTimeMs,
          longTasks: overlappingLongTasks,
          hitTesting: hitTestControls(),
          finalFanState: readActiveGraphState(),
          error,
        });
        state.samples[sampleIndex] = sample;
        state.activeSample = null;
        resolveSample(sample);
      };

      const onPointerStart = (event) => {
        window.clearTimeout(eventGuard);
        sample.eventType = event.type;
        sample.eventTimeStamp = event.timeStamp;
        const readinessDeadline = performance.now() + ${PERFORMANCE_PROBE_TIMEOUT_MS};

        const inspectReadyFrame = () => {
          const fanState = readActiveGraphState();
          const frameTime = performance.now();
          if (fanState.menReady) {
            sample.readyFanState = fanState;
            sample.readyFrameTime = frameTime;
            sample.visualResponseLatencyMs = frameTime - event.timeStamp;
            requestAnimationFrame(() => finalize());
            return;
          }
          if (frameTime >= readinessDeadline) {
            requestAnimationFrame(() => finalize(
              'Timed out waiting for the complete MEN fan visual-readiness predicate.'
            ));
            return;
          }
          requestAnimationFrame(inspectReadyFrame);
        };

        requestAnimationFrame(inspectReadyFrame);
      };

      eventGuard = window.setTimeout(() => {
        finalize('Timed out waiting for the MEN pointer event.');
      }, ${PERFORMANCE_PROBE_TIMEOUT_MS});
      men.addEventListener('pointerover', onPointerStart, { capture: true, once: true });
      state.activeSample = sample;
      state.samplePromise = samplePromise;
      return { armed: true, sampleNumber: sample.sampleNumber };
    };

    const observer = new PerformanceObserver((list) => {
      appendLongTasks(list.getEntries());
    });
    state.observer = observer;
    observer.observe({ type: 'longtask', buffered: true });
    window.__atlasPerformance = state;

    return { supported: true, supportedEntryTypes };
  })()
`;

const inspectionExpression = String.raw`
  (() => {
    const contract = ${JSON.stringify(heroContract)};
    const backdrops = Array.from(document.querySelectorAll('.watch-image-backdrop'));
    const pictures = Array.from(document.querySelectorAll('.watch-image-backdrop picture'));
    const images = Array.from(document.querySelectorAll('.watch-image-backdrop img'));
    const backdrop = backdrops[0] ?? null;
    const picture = pictures[0] ?? null;
    const image = images[0] ?? null;
    const avifSource = picture?.querySelector('source[type="image/avif"]') ?? null;
    const currentPath = image?.currentSrc
      ? new URL(image.currentSrc, location.href).pathname
      : null;
    const selectedManifest = contract.derivatives.find(
      (entry) => entry.publicPath === currentPath
    ) ?? null;
    const derivativeResourceEntries = performance.getEntriesByType('resource')
      .filter((entry) => contract.derivatives.some(
        (candidate) => new URL(entry.name, location.href).pathname === candidate.publicPath
      ))
      .map((entry) => ({
        decodedBodySize: entry.decodedBodySize,
        encodedBodySize: entry.encodedBodySize,
        initiatorType: entry.initiatorType,
        name: entry.name,
        path: new URL(entry.name, location.href).pathname,
        transferSize: entry.transferSize,
      }));

    const describeElement = (element, pseudo = null) => {
      if (!element) return null;
      const style = getComputedStyle(element, pseudo);
      const rect = element.getBoundingClientRect();
      return {
        selector: element.matches?.('[data-presentation-id]')
          ? '[data-presentation-id="' + element.dataset.presentationId + '"]'
          : element.tagName.toLowerCase() + (element.className ? '.' + String(element.className).trim().replace(/\s+/g, '.') : ''),
        pseudo,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        color: style.color,
        position: style.position,
        zIndex: style.zIndex,
        transform: style.transform,
        filter: style.filter,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        isolation: style.isolation,
        mixBlendMode: style.mixBlendMode,
        maskImage: style.maskImage || style.webkitMaskImage,
        overflow: style.overflow,
        pointerEvents: style.pointerEvents,
        contain: style.contain,
        willChange: style.willChange,
        box: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
      };
    };

    const stackLabel = (element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className : element.className?.baseVal ?? null,
      presentationId: element.closest?.('.atlas-node')?.dataset.presentationId ?? null,
    });

    const nodes = Array.from(document.querySelectorAll('.atlas-node'), (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const stack = document.elementsFromPoint(center.x, center.y).map(stackLabel);
      const label = node.querySelector('.atlas-node__label');
      const marker = node.querySelector('.atlas-node__sphere, .atlas-node__dot');
      const markerStyle = marker ? getComputedStyle(marker) : null;
      const markerRect = marker?.getBoundingClientRect();
      const labelStyle = label ? getComputedStyle(label) : null;
      const labelRect = label?.getBoundingClientRect();
      return {
        id: node.dataset.presentationId,
        kind: node.classList.contains('atlas-node--audience') ? 'audience' : 'brand',
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        color: style.color,
        zIndex: style.zIndex,
        transform: style.transform,
        pointerEvents: style.pointerEvents,
        customProperties: {
          x: style.getPropertyValue('--node-x').trim(),
          y: style.getPropertyValue('--node-y').trim(),
          mobileX: style.getPropertyValue('--node-mobile-x').trim(),
          mobileY: style.getPropertyValue('--node-mobile-y').trim(),
        },
        box: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        center,
        centerInViewport: center.x >= 0 && center.x <= innerWidth && center.y >= 0 && center.y <= innerHeight,
        topHit: stack[0] ?? null,
        topAtlasId: stack.find((item) => item.presentationId)?.presentationId ?? null,
        stack: stack.slice(0, 8),
        marker: marker && markerStyle && markerRect ? {
          className: marker.className,
          display: markerStyle.display,
          visibility: markerStyle.visibility,
          opacity: markerStyle.opacity,
          color: markerStyle.color,
          backgroundImage: markerStyle.backgroundImage,
          backgroundColor: markerStyle.backgroundColor,
          zIndex: markerStyle.zIndex,
          transform: markerStyle.transform,
          filter: markerStyle.filter,
          box: { x: markerRect.x, y: markerRect.y, width: markerRect.width, height: markerRect.height },
        } : null,
        label: label && labelStyle && labelRect ? {
          text: label.textContent,
          display: labelStyle.display,
          visibility: labelStyle.visibility,
          opacity: labelStyle.opacity,
          color: labelStyle.color,
          zIndex: labelStyle.zIndex,
          transform: labelStyle.transform,
          fontSize: labelStyle.fontSize,
          box: { x: labelRect.x, y: labelRect.y, width: labelRect.width, height: labelRect.height },
        } : null,
      };
    });

    const layerSelectors = [
      '.watch-image-backdrop',
      '.watch-image-backdrop__picture',
      '.watch-image-backdrop__image',
      '.cinematic-vignette',
      '.watch-explorer',
      '.node-graph',
      '.graph-connections',
      '.atlas-controls',
      '.search-stage',
      '.site-masthead',
      '.definition-layer',
      '.skip-link',
    ];
    const layers = layerSelectors.map((selector) => ({
      selector,
      elements: Array.from(document.querySelectorAll(selector), (element) => describeElement(element)),
    }));

    const auditedOverlays = [
      '.site-masthead',
      '.search-pill',
      '.search-results',
      '.definition-layer',
      '.definition-panel',
      '.definition-panel__footer',
    ].map((selector) => {
      let element = document.querySelector(selector);
      const mounted = Boolean(element);
      if (!element) {
        element = document.createElement('div');
        element.className = selector.slice(1);
        element.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;visibility:hidden;pointer-events:none';
        document.body.append(element);
      }
      const style = getComputedStyle(element);
      const record = {
        selector,
        mounted,
        animationName: style.animationName,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        backgroundPosition: style.backgroundPosition,
        filter: style.filter,
        zIndex: style.zIndex,
      };
      if (!mounted) element.remove();
      return record;
    });

    const graphSvgs = Array.from(document.querySelectorAll('.graph-connections'));
    const graphVariants = graphSvgs.map((svg) => (
      svg.classList.contains('graph-connections--mobile') ? 'mobile'
        : svg.classList.contains('graph-connections--desktop') ? 'desktop'
          : 'unknown'
    ));
    const restingPaths = Array.from(
      document.querySelectorAll('.graph-connections .graph-connections__rest path'),
      (path) => {
        const style = getComputedStyle(path);
        return {
          id: path.dataset.edgeId,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          strokeDasharray: style.strokeDasharray,
        };
      },
    );

    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      document: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      hero: {
        backdropCount: backdrops.length,
        pictureCount: pictures.length,
        imageCount: images.length,
        sourceCount: picture?.querySelectorAll('source').length ?? 0,
        imageState: backdrop?.dataset.imageState ?? null,
        reducedMotion: backdrop?.dataset.reducedMotion ?? null,
        definitionOpen: backdrop?.dataset.definitionOpen ?? null,
        avifSourceSet: avifSource?.getAttribute('srcset') ?? null,
        avifSizes: avifSource?.getAttribute('sizes') ?? null,
        webpSourceSet: image?.getAttribute('srcset') ?? null,
        webpSizes: image?.getAttribute('sizes') ?? null,
        fallbackPath: image?.getAttribute('src') ?? null,
        currentPath,
        selectedManifest,
        naturalWidth: image?.naturalWidth ?? 0,
        naturalHeight: image?.naturalHeight ?? 0,
        complete: image?.complete ?? false,
        alt: image?.getAttribute('alt') ?? null,
        ariaHidden: image?.getAttribute('aria-hidden') ?? null,
        tabIndex: image?.tabIndex ?? null,
        objectFit: image ? getComputedStyle(image).objectFit : null,
        objectPosition: image ? getComputedStyle(image).objectPosition : null,
        backdrop: describeElement(backdrop),
        picture: describeElement(picture),
        image: describeElement(image),
        heroCanvasCount: document.querySelectorAll('.elite-shell canvas').length,
        heroVideoCount: document.querySelectorAll('.elite-shell video').length,
        masterUrlPresentInMarkup: document.documentElement.innerHTML.includes('elite-watch-master.png')
          || document.documentElement.innerHTML.includes(contract.masterSourceFile),
        derivativeResourceEntries,
      },
      auditedOverlays,
      networkMode: document.querySelector('.node-graph')?.dataset.networkMode ?? null,
      nodeCount: nodes.length,
      audienceCount: nodes.filter((node) => node.kind === 'audience').length,
      brandCount: nodes.filter((node) => node.kind === 'brand').length,
      nodes,
      layers,
      graphSvgCount: graphSvgs.length,
      graphVariants,
      restingPaths,
      activeEdgeCount: document.querySelectorAll(
        '.graph-connections .graph-connections__active > g'
      ).length,
      particleCount: document.querySelectorAll(
        '.graph-connections .connection-particle'
      ).length,
      animateMotionCount: document.querySelectorAll(
        '.graph-connections .graph-connections__active animateMotion'
      ).length,
    };
  })()
`;

const interactionStateExpression = String.raw`
  (() => {
    const state = window.__atlasPerformance?.readActiveGraphState?.();
    return state ? { ...state, ready: true } : { ready: false };
  })()
`;

function numericCss(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertInteractionState(state, expectedMode, expectedEdgeCount, description) {
  assert.equal(state.mode, expectedMode, `${description} must expose the expected network mode`);
  assert.equal(state.graphSvgCount, 1, `${description} must keep exactly one graph SVG mounted`);
  assert.deepEqual(state.graphVariants, ["desktop"], `${description} must use the desktop graph at 1024px`);
  assert.equal(state.activeEdgeCount, expectedEdgeCount, `${description} must expose exactly N active groups`);
  assert.equal(state.activePathCount, expectedEdgeCount, `${description} must expose exactly N active paths`);
  assert.equal(state.particleCount, expectedEdgeCount, `${description} must expose one particle per edge`);
  assert.equal(state.animateMotionCount, expectedEdgeCount, `${description} must expose one animateMotion per edge`);
  assert.ok(
    state.activePaths.every((activePath) => activePath.visible),
    `${description} active rays must be immediately visible with nonzero strokes`,
  );
  assert.ok(
    state.particles.every((particle) => particle.visible),
    `${description} particles must have positive radii and visible computed styles`,
  );
}

function assertReport(report, hoverState, focusState) {
  const layer = (selector) => report.layers.find((entry) => entry.selector === selector)?.elements[0];
  const auditedOverlay = (selector) => report.auditedOverlays.find((entry) => entry.selector === selector);

  assert.deepEqual(report.viewport, { width: VIEWPORT.width, height: VIEWPORT.height, devicePixelRatio: 1 });
  assert.equal(report.nodeCount, EXPECTED_NODE_COUNT, "all atlas presentations must render");
  assert.equal(report.audienceCount, EXPECTED_AUDIENCE_COUNT, "both audience controls must render");
  assert.equal(report.brandCount, EXPECTED_BRAND_COUNT, "all brand presentations must render");
  assert.equal(report.graphSvgCount, 1, "exactly one responsive graph SVG must be mounted");
  assert.deepEqual(report.graphVariants, ["desktop"], "the sole graph SVG must be desktop at 1024px");
  assert.equal(report.hero.backdropCount, 1, "exactly one responsive hero backdrop must be mounted");
  assert.equal(report.hero.pictureCount, 1, "exactly one responsive hero picture must be mounted");
  assert.equal(report.hero.imageCount, 1, "exactly one responsive hero image must be mounted");
  assert.equal(report.hero.sourceCount, 1, "the hero picture must expose one AVIF source");
  assert.equal(report.hero.imageState, "ready", "the responsive hero image must be ready");
  assert.equal(report.hero.avifSourceSet, heroContract.avifSourceSet, "the AVIF source set must match the manifest");
  assert.equal(report.hero.avifSizes, heroContract.sizes, "the AVIF source must use the manifest sizes contract");
  assert.equal(report.hero.webpSourceSet, heroContract.webpSourceSet, "the WebP source set must match the manifest");
  assert.equal(report.hero.webpSizes, heroContract.sizes, "the WebP fallback must use the manifest sizes contract");
  assert.equal(report.hero.fallbackPath, heroContract.fallbackPath, "the fallback src must be the manifest 1380px WebP");
  assert.ok(report.hero.selectedManifest, "the selected currentSrc must match a manifest derivative");
  assert.equal(report.hero.currentPath, report.hero.selectedManifest.publicPath);
  assert.ok(report.hero.naturalWidth > 0 && report.hero.naturalHeight > 0);
  assert.equal(report.hero.complete, true, "the selected image must finish decoding");
  assert.equal(report.hero.alt, "", "the hero image must remain decorative");
  assert.equal(report.hero.ariaHidden, "true", "the hero image must remain hidden from assistive technology");
  assert.equal(report.hero.tabIndex, -1, "the hero image must not create a focus stop");
  assert.equal(report.hero.objectFit, "cover", "the hero image must use object-fit cover");
  assert.equal(report.hero.heroCanvasCount, 0, "the hero must mount no canvas");
  assert.equal(report.hero.heroVideoCount, 0, "the hero must mount no video");
  assert.equal(report.hero.masterUrlPresentInMarkup, false, "the archival master must not appear in runtime markup");
  assert.equal(report.hero.derivativeResourceEntries.length, 1, "one navigation must select one hero derivative resource");
  assert.equal(report.hero.derivativeResourceEntries[0].path, report.hero.currentPath);
  assert.ok(
    report.document.scrollWidth <= report.document.width,
    "the initial expanded presentation must have no horizontal overflow",
  );
  assert.equal(layer(".node-graph")?.isolation, "isolate", "the graph must own an isolated stacking context");
  assert.ok(
    numericCss(layer(".atlas-controls")?.zIndex) > numericCss(layer(".graph-connections")?.zIndex),
    "the dedicated controls plane must paint above SVG rays",
  );
  assert.ok(
    numericCss(layer(".cinematic-vignette")?.zIndex) > numericCss(layer(".watch-image-backdrop")?.zIndex),
    "the static readability scrim must paint above the responsive image",
  );
  assert.ok(
    numericCss(layer(".watch-explorer")?.zIndex) > numericCss(layer(".cinematic-vignette")?.zIndex),
    "the experience plane must paint above the responsive image scrim",
  );
  assert.ok(
    numericCss(layer(".search-stage")?.zIndex) > numericCss(layer(".watch-explorer")?.zIndex),
    "search must paint above the explorer plane",
  );
  assert.ok(
    numericCss(layer(".site-masthead")?.zIndex) > numericCss(layer(".search-stage")?.zIndex),
    "the masthead must paint above search",
  );
  assert.ok(
    numericCss(auditedOverlay(".definition-layer")?.zIndex) > numericCss(layer(".site-masthead")?.zIndex),
    "the definition dialog layer must paint above the masthead",
  );
  assert.ok(
    numericCss(layer(".skip-link")?.zIndex) > numericCss(layer(".site-masthead")?.zIndex),
    "the skip link must remain the highest persistent interaction layer",
  );
  for (const selector of [
    ".watch-image-backdrop",
    ".watch-image-backdrop__picture",
    ".watch-image-backdrop__image",
    ".cinematic-vignette",
  ]) {
    assert.equal(layer(selector)?.pointerEvents, "none", `${selector} must not accept pointer events`);
  }
  assert.ok(
    report.auditedOverlays.every((overlay) => overlay.backdropFilter === "none"),
    "every audited overlay must compute to no backdrop filter",
  );
  assert.ok(
    report.auditedOverlays.every((overlay) => overlay.filter === "none"),
    "every audited overlay must compute to no foreground filter",
  );
  assert.ok(
    report.auditedOverlays.every((overlay) => overlay.animationName === "none"),
    "every audited overlay must remain free of material animation",
  );
  assert.ok(report.restingPaths.length > 0, "the resting network must render");
  assert.ok(
    report.restingPaths.every((restingPath) => restingPath.display !== "none"
      && restingPath.visibility === "visible"
      && numericCss(restingPath.opacity) > 0
      && numericCss(restingPath.strokeWidth) > 0
      && restingPath.stroke !== "none"),
    "every resting path must have a visible nonzero stroke",
  );

  for (const node of report.nodes) {
    assert.notEqual(node.display, "none", `${node.id} must be displayed`);
    assert.equal(node.visibility, "visible", `${node.id} must be visible`);
    assert.equal(numericCss(node.opacity), 1, `${node.id} must be fully opaque`);
    assert.equal(node.transform, "none", `${node.id} must not depend on an initial motion transform`);
    assert.ok(node.box.width > 0 && node.box.height > 0, `${node.id} must have a nonzero box`);
    assert.ok(node.centerInViewport, `${node.id} center must be inside the viewport`);
    assert.equal(node.topAtlasId, node.id, `${node.id} must win hit-testing at its center`);
    assert.ok(node.customProperties.x && node.customProperties.y, `${node.id} must have desktop coordinates`);
    assert.equal(node.marker?.display, "block", `${node.id} marker must be displayed`);
    assert.equal(node.marker?.visibility, "visible", `${node.id} marker must be visible`);
    assert.equal(numericCss(node.marker?.opacity ?? "0"), 1, `${node.id} marker must be fully opaque`);
    assert.ok((node.marker?.box.width ?? 0) > 0 && (node.marker?.box.height ?? 0) > 0, `${node.id} marker must have geometry`);
    assert.notEqual(node.label?.display, "none", `${node.id} label must be displayed`);
    assert.equal(node.label?.visibility, "visible", `${node.id} label must be visible`);
    assert.equal(numericCss(node.label?.opacity ?? "0"), 1, `${node.id} label must be fully opaque`);
    assert.ok((node.label?.box.width ?? 0) > 0 && (node.label?.box.height ?? 0) > 0, `${node.id} label must have geometry`);
  }

  const audiences = report.nodes.filter((node) => node.kind === "audience");
  assert.ok(
    audiences.every((node) => node.marker.box.width >= 88 && node.marker.box.width <= 104),
    "visible audience spheres must be 88–104 CSS pixels",
  );
  assert.ok(audiences.every((node) => node.marker.filter === "none"), "audience visibility must not depend on filters");

  assertInteractionState(hoverState, "preview-men", EXPECTED_MEN_EDGE_COUNT, "MEN hover");
  assert.ok(
    hoverState.activePaths.every((activePath) => (
      numericCss(activePath.strokeWidth) > numericCss(report.restingPaths[0].strokeWidth)
    )),
    "active MEN rays must be wider than resting rays",
  );
  assertInteractionState(
    focusState,
    "preview-patek-philippe",
    EXPECTED_PATEK_EDGE_COUNT,
    "Patek focus",
  );
}

function assertSelectedResource(resource, readiness) {
  assert.ok(resource, "the browser must expose the selected derivative response");
  assert.equal(resource.requestCount, 1, "one navigation must issue exactly one canonical derivative request");
  assert.equal(resource.request.method, "GET", "the selected derivative must use GET");
  assert.equal(resource.request.type, "Image", "the selected derivative must be initiated as an image");
  assert.equal(resource.request.path, readiness.currentPath, "the requested path must equal the rendered currentSrc");
  assert.equal(resource.response.status, 200, "the selected derivative response must return HTTP 200");
  assert.equal(
    resource.response.mimeType,
    resource.manifest.mediaType,
    "the browser-reported MIME must match the selected manifest format",
  );
  assert.ok(
    resource.response.contentType.toLowerCase().startsWith(resource.manifest.mediaType),
    "the HTTP Content-Type must match the selected manifest format",
  );
  assert.ok(
    resource.manifest.mediaType === "image/avif" || resource.manifest.mediaType === "image/webp",
    "the browser must select AVIF primary or WebP fallback",
  );
  assert.equal(resource.bodyByteLength, resource.manifest.byteLength, "response bytes must match manifest length");
  assert.equal(resource.bodySha256, resource.manifest.sha256, "response bytes must match the manifest SHA-256");
  assert.equal(resource.resourceIntrinsicWidth, resource.manifest.intrinsicWidth);
  assert.equal(resource.resourceIntrinsicHeight, resource.manifest.intrinsicHeight);
  assert.equal(
    resource.reportedNaturalDimensionsValid,
    true,
    "the image natural dimensions must correspond to the selected width-descriptor density",
  );
  assert.ok(resource.reportedNaturalWidth > 0 && resource.reportedNaturalHeight > 0);
  assert.equal(
    resource.decodedPixelCount,
    resource.manifest.decodedPixelCount,
    "selected decoded pixels must match the manifest",
  );
  assert.equal(
    resource.decodedRgbaByteLength,
    resource.manifest.decodedRgbaByteLength,
    "selected decoded RGBA bytes must match the manifest",
  );
  assert.ok(
    resource.bodyByteLength <= heroContract.budgets.maxBrowserSelectedTransferBytes,
    "selected response must remain within the browser transfer budget",
  );
  if (resource.manifest.mediaType === "image/avif") {
    assert.ok(resource.bodyByteLength <= 1_048_576, "selected AVIF must remain within its per-format budget");
  }
  assert.ok(
    resource.decodedPixelCount <= heroContract.budgets.maxBrowserSelectedDecodedPixels,
    "selected response must remain within the decoded-pixel budget",
  );
  assert.ok(
    resource.decodedRgbaByteLength <= heroContract.budgets.maxBrowserSelectedDecodedRgbaBytes,
    "selected response must remain within the decoded-memory budget",
  );
}

function assertHeroFrameProbe(probe) {
  assert.equal(probe.completed, true, probe.error ?? "the finite hero frame probe must complete");
  assert.equal(probe.error, null, "the finite hero frame probe must not time out");
  assert.equal(
    probe.intervals.length,
    HERO_FRAME_INTERVAL_COUNT,
    `the hero probe must emit exactly ${HERO_FRAME_INTERVAL_COUNT} raw frame intervals`,
  );
  assert.ok(
    probe.intervals.every((interval) => Number.isFinite(interval) && interval > 0),
    "every hero frame interval must be finite and positive",
  );
  const withinBudgetCount = probe.intervals.filter(
    (interval) => interval <= HERO_FRAME_INTERVAL_BUDGET_MS,
  ).length;
  assert.ok(
    withinBudgetCount >= Math.ceil(HERO_FRAME_INTERVAL_COUNT * 0.95),
    `at least 95% of hero intervals must be <= ${HERO_FRAME_INTERVAL_BUDGET_MS}ms: ${withinBudgetCount}/${HERO_FRAME_INTERVAL_COUNT}`,
  );
  assert.ok(
    probe.intervals.every((interval) => interval <= HERO_FRAME_INTERVAL_LIMIT_MS),
    `every hero interval must be <= ${HERO_FRAME_INTERVAL_LIMIT_MS}ms; max=${Math.max(...probe.intervals)}`,
  );
}

function assertReducedMotionStasis(stasis) {
  assert.equal(stasis.ready, true, stasis.error ?? "reduced-motion image state must be inspectable");
  assert.equal(stasis.mediaReducedMotion, true, "the browser must apply the reduced-motion media preference");
  assert.equal(stasis.animationNameBefore, "none", "reduced motion must disable image animation");
  assert.equal(stasis.animationNameAfter, "none", "reduced motion must keep image animation disabled");
  assert.equal(stasis.transformBefore, stasis.transformAfter, "reduced-motion transform must remain static");
}

function assertPerformanceSamples(samples) {
  assert.equal(
    samples.length,
    MEASURED_INTERACTION_COUNT,
    `exactly ${MEASURED_INTERACTION_COUNT} measured MEN interactions are required`,
  );

  for (const sample of samples) {
    const description = `MEN performance sample ${sample.sampleNumber}`;
    assert.equal(sample.error, null, `${description} must complete its visual-readiness probe`);
    assert.equal(sample.eventType, "pointerover", `${description} must start from the captured pointer event`);
    assert.ok(Number.isFinite(sample.eventTimeStamp), `${description} must record event.timeStamp`);
    assert.ok(Number.isFinite(sample.readyFrameTime), `${description} must record its first ready animation frame`);
    assert.ok(Number.isFinite(sample.sampleEnd), `${description} must record finalization on the following frame`);
    assert.ok(
      sample.sampleEnd >= sample.readyFrameTime,
      `${description} finalization must not precede visual readiness`,
    );
    assert.ok(
      sample.visualResponseLatencyMs >= 0
        && sample.visualResponseLatencyMs <= VISUAL_RESPONSE_LIMIT_MS,
      `${description} visual response must be <= ${VISUAL_RESPONSE_LIMIT_MS}ms: ${sample.visualResponseLatencyMs}`,
    );
    assert.ok(
      sample.longestTaskMs <= MAIN_THREAD_TASK_LIMIT_MS,
      `${description} longest task must be <= ${MAIN_THREAD_TASK_LIMIT_MS}ms: ${sample.longestTaskMs}`,
    );
    assert.ok(
      sample.cumulativeBlockingTimeMs <= CUMULATIVE_BLOCKING_LIMIT_MS,
      `${description} blocking time must be <= ${CUMULATIVE_BLOCKING_LIMIT_MS}ms: ${sample.cumulativeBlockingTimeMs}`,
    );
    assertInteractionState(
      sample.readyFanState,
      "preview-men",
      EXPECTED_MEN_EDGE_COUNT,
      `${description} ready frame`,
    );
    assert.equal(
      sample.hitTesting?.controlCount,
      EXPECTED_NODE_COUNT,
      `${description} must hit-test every atlas control`,
    );
    assert.equal(
      sample.hitTesting?.allControlsHitTestable,
      true,
      `${description} must keep all controls hit-testable while the fan is active`,
    );
    assert.ok(
      sample.hitTesting?.records.every((record) => record.id === record.resolvedId),
      `${description} must resolve each center to its corresponding .atlas-node`,
    );
    assert.deepEqual(sample.runtimeErrors, [], `${description} must not produce runtime or console errors`);
    assert.deepEqual(sample.failedResponses, [], `${description} must not produce failed application responses`);
  }
}

async function runMeasuredMenInteraction({
  client,
  men,
  sampleIndex,
  runtimeErrors,
  failedResponses,
}) {
  await waitForRestingAndTwoFrames(
    client.evaluate,
    `resting graph and two animation frames before sample ${sampleIndex + 1}`,
  );

  const runtimeErrorStart = runtimeErrors.length;
  const failedResponseStart = failedResponses.length;
  const armResult = await client.evaluate(`
    (() => {
      const instrumentation = window.__atlasPerformance;
      if (!instrumentation) return { armed: false, error: 'Performance instrumentation is unavailable.' };
      instrumentation.clearLongTasks();
      return instrumentation.armSample(${sampleIndex});
    })()
  `);
  assert.equal(armResult.armed, true, armResult.error ?? "The performance sample could not be armed.");

  let measuredSample;
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: men.center.x,
      y: men.center.y,
      pointerType: "mouse",
    });
    const sampled = await poll(
      client.evaluate,
      `(() => {
        const sample = window.__atlasPerformance?.samples?.[${sampleIndex}] ?? null;
        return { ready: Boolean(sample), sample };
      })()`,
      `in-page MEN performance sample ${sampleIndex + 1}`,
      PERFORMANCE_PROBE_TIMEOUT_MS + 5_000,
    );
    measuredSample = {
      ...sampled.sample,
      runtimeErrors: runtimeErrors.slice(runtimeErrorStart),
      failedResponses: failedResponses.slice(failedResponseStart),
    };
  } finally {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 2,
      y: 2,
      pointerType: "mouse",
    });
    await waitForRestingGraph(
      client.evaluate,
      `resting network after measured sample ${sampleIndex + 1}`,
    );
  }

  return measuredSample;
}

let chromeProcess;
let serverProcess;
let client;
let browserStderr = "";
let serverOutput = "";
const runtimeErrors = [];
const consoleErrors = [];
const hydrationRecoveries = [];
const failedResponses = [];
const externalRequests = [];
const masterRequests = [];
const derivativeRequestEvents = [];
const derivativeRequestsById = new Map();
const applicationRequestUrlsById = new Map();
const performanceSamples = [];
let performanceSupport = null;
let heroFrameProbe = null;
let selectedResource = null;
let reducedMotionStasis = null;
let hydrationBeforeHeroRelease = null;

try {
  if (!baseUrl) {
    const serverPort = await findAvailablePort();
    baseUrl = `http://127.0.0.1:${serverPort}`;
    const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
    serverProcess = spawn(process.execPath, [
      nextCli,
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(serverPort),
    ], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.setEncoding("utf8");
    serverProcess.stderr.setEncoding("utf8");
    serverProcess.stdout.on("data", (chunk) => {
      serverOutput += chunk;
    });
    serverProcess.stderr.on("data", (chunk) => {
      serverOutput += chunk;
    });
    await waitForServer(baseUrl, () => serverOutput);
  }

  assertLocalApplicationUrl(baseUrl);
  const applicationOrigin = new URL(baseUrl).origin;

  await mkdir(profilePath, { recursive: true });
  const chromePath = await findChrome();
  chromeProcess = spawn(chromePath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-crash-reporter",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=Translate,MediaRouter",
    "--disable-gpu-vsync",
    "--disable-renderer-backgrounding",
    "--disable-sync",
    "--hide-scrollbars",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profilePath}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chromeProcess.stderr.setEncoding("utf8");
  chromeProcess.stderr.on("data", (chunk) => {
    browserStderr += chunk;
  });

  const port = await waitForDebuggerPort();
  const pageTarget = await waitForPageTarget(port);
  client = await createProtocolClient(pageTarget);
  await client.send("Page.bringToFront");
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const recordConsoleFailure = (message, source) => {
    const record = { message, source };
    consoleErrors.push(record);
    runtimeErrors.push(message);
    if (/hydration|hydrating|server rendered html|recoverable error/iu.test(message)) {
      hydrationRecoveries.push(record);
    }
  };
  client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    runtimeErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  client.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type !== "error") return;
    recordConsoleFailure(args.map((argument) => (
      argument.value ?? argument.description ?? argument.type
    )).join(" "), "Runtime.consoleAPICalled");
  });
  client.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error" && entry.source !== "network") {
      recordConsoleFailure(entry.text, `Log.entryAdded:${entry.source}`);
    }
  });
  client.on("Network.requestWillBeSent", ({ initiator, redirectResponse, request, requestId, type }) => {
    const requestPath = pathnameFor(request.url);
    let parsed;
    try {
      parsed = new URL(request.url);
    } catch {
      parsed = null;
    }
    if (
      parsed
      && (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.origin !== applicationOrigin
    ) {
      externalRequests.push({ initiatorType: initiator?.type ?? null, type, url: request.url });
    }
    if (parsed?.origin === applicationOrigin) {
      applicationRequestUrlsById.set(requestId, request.url);
    }
    if (requestPath?.endsWith("/elite-watch-master.png")) {
      masterRequests.push({ requestId, type, url: request.url });
    }
    if (requestPath && manifestDerivativeByPath.has(requestPath)) {
      const requestRecord = {
        initiatorType: initiator?.type ?? null,
        method: request.method,
        path: requestPath,
        redirectStatus: redirectResponse?.status ?? null,
        requestId,
        type,
        url: request.url,
      };
      derivativeRequestEvents.push(requestRecord);
      derivativeRequestsById.set(requestId, { request: requestRecord });
    }
  });
  client.on("Network.responseReceived", ({ requestId, response, type }) => {
    const chromeProbe = response.url.endsWith("/.well-known/appspecific/com.chrome.devtools.json");
    const derivativeRecord = derivativeRequestsById.get(requestId);
    if (derivativeRecord) {
      const contentTypeEntry = Object.entries(response.headers ?? {}).find(
        ([name]) => name.toLowerCase() === "content-type",
      );
      derivativeRecord.response = {
        contentType: contentTypeEntry ? String(contentTypeEntry[1]) : "",
        encodedDataLengthAtHeaders: response.encodedDataLength,
        fromDiskCache: response.fromDiskCache ?? false,
        fromPrefetchCache: response.fromPrefetchCache ?? false,
        fromServiceWorker: response.fromServiceWorker ?? false,
        mimeType: response.mimeType,
        protocol: response.protocol,
        status: response.status,
        type,
        url: response.url,
      };
    }
    if (response.status >= 400 && response.url.startsWith(baseUrl) && !chromeProbe) {
      failedResponses.push({ phase: "response", status: response.status, url: response.url });
    }
  });
  client.on("Network.loadingFinished", ({ encodedDataLength, requestId }) => {
    const derivativeRecord = derivativeRequestsById.get(requestId);
    if (derivativeRecord) derivativeRecord.encodedDataLength = encodedDataLength;
  });
  client.on("Network.loadingFailed", ({ blockedReason, canceled, errorText, requestId, type }) => {
    const derivativeRecord = derivativeRequestsById.get(requestId);
    if (derivativeRecord) {
      derivativeRecord.loadingFailure = { blockedReason, canceled, errorText, type };
    }
    const failedUrl = applicationRequestUrlsById.get(requestId) ?? derivativeRecord?.request.url ?? null;
    const chromeProbe = failedUrl?.endsWith("/.well-known/appspecific/com.chrome.devtools.json");
    if (failedUrl && !chromeProbe) {
      failedResponses.push({
        blockedReason,
        canceled,
        errorText,
        phase: "loading",
        type,
        url: failedUrl,
      });
    }
  });

  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Log.enable"),
    client.send("Network.enable"),
  ]);
  await Promise.all([
    client.send("Network.setCacheDisabled", { cacheDisabled: true }),
    client.send("Network.setBypassServiceWorker", { bypass: true }),
    client.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/assets/watch/elite-watch-*", requestStage: "Request" }],
    }),
  ]);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: VIEWPORT.width,
    screenHeight: VIEWPORT.height,
  });

  const pausedHeroRequestPromise = client.once("Fetch.requestPaused", 10_000);
  const loaded = client.once("Page.loadEventFired", 20_000);
  await client.send("Page.navigate", { url: baseUrl });
  const pausedHeroRequest = await pausedHeroRequestPromise;
  const pausedHeroPath = pathnameFor(pausedHeroRequest.request.url);
  if (!pausedHeroPath || !manifestDerivativeByPath.has(pausedHeroPath)) {
    await client.send("Fetch.continueRequest", { requestId: pausedHeroRequest.requestId });
    throw new Error(`Fetch interception paused an unexpected resource: ${pausedHeroRequest.request.url}`);
  }
  hydrationBeforeHeroRelease = await poll(
    client.evaluate,
    String.raw`(() => {
      const firstNode = document.querySelector('.atlas-node');
      const hydrated = Boolean(firstNode && Object.keys(firstNode).some(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$')
      ));
      return {
        ready: hydrated && document.querySelectorAll('.atlas-node').length === ${EXPECTED_NODE_COUNT},
        hydrated,
        nodeCount: document.querySelectorAll('.atlas-node').length,
        imageState: document.querySelector('.watch-image-backdrop')?.dataset.imageState ?? null,
      };
    })()`,
    "React hydration before releasing the selected hero response",
    10_000,
  );
  await client.send("Fetch.continueRequest", { requestId: pausedHeroRequest.requestId });
  await loaded;
  await client.send("Fetch.disable");
  const readiness = await poll(
    client.evaluate,
    readinessExpression,
    "Next hydration, fonts, and responsive-image readiness",
    30_000,
  );
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);

  const selectedRequestRecord = Array.from(derivativeRequestsById.values()).find(
    (record) => record.request.path === readiness.currentPath,
  );
  if (!selectedRequestRecord?.response) {
    throw new Error(`No completed browser response was captured for ${readiness.currentPath}.`);
  }
  const selectedManifest = manifestDerivativeByPath.get(readiness.currentPath);
  if (!selectedManifest) {
    throw new Error(`Browser currentSrc is not a manifest derivative: ${readiness.currentPath}.`);
  }
  const responseBody = await client.send("Network.getResponseBody", {
    requestId: selectedRequestRecord.request.requestId,
  });
  const selectedBody = Buffer.from(
    responseBody.body,
    responseBody.base64Encoded ? "base64" : "utf8",
  );
  selectedResource = {
    bodyByteLength: selectedBody.byteLength,
    bodySha256: sha256(selectedBody),
    decodedPixelCount: selectedManifest.decodedPixelCount,
    decodedRgbaByteLength: selectedManifest.decodedRgbaByteLength,
    encodedDataLength: selectedRequestRecord.encodedDataLength ?? null,
    manifest: selectedManifest,
    resourceIntrinsicHeight: selectedManifest.intrinsicHeight,
    resourceIntrinsicWidth: selectedManifest.intrinsicWidth,
    reportedNaturalHeight: readiness.naturalHeight,
    reportedNaturalWidth: readiness.naturalWidth,
    reportedNaturalDimensionsValid: readiness.naturalDimensionsValid,
    performanceResourceEntries: readiness.derivativeResourceEntries,
    request: selectedRequestRecord.request,
    requestCount: derivativeRequestEvents.length,
    response: selectedRequestRecord.response,
  };

  performanceSupport = await client.evaluate(performanceSetupExpression);
  assert.equal(
    performanceSupport.supported,
    true,
    `PerformanceObserver longtask support is required. Supported entries: ${JSON.stringify(performanceSupport.supportedEntryTypes)}`,
  );

  const report = await client.evaluate(inspectionExpression);
  await waitForRestingAndTwoFrames(client.evaluate, "resting graph before the finite hero frame probe");
  heroFrameProbe = await client.evaluate(heroFrameProbeExpression, true);

  if (screenshotPath) {
    const screenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }

  const men = report.nodes.find((node) => node.id === "men");
  assert.ok(men, "MEN control must exist before interaction checks");

  // Exactly one complete warm-up is intentionally excluded from measured samples.
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: men.center.x,
    y: men.center.y,
    pointerType: "mouse",
  });
  const hoverState = await poll(
    client.evaluate,
    `(() => {
      const state = window.__atlasPerformance?.readActiveGraphState?.();
      return state ? { ...state, ready: state.menReady } : { ready: false };
    })()`,
    "complete MEN warm-up fan",
  );
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 2,
    y: 2,
    pointerType: "mouse",
  });
  await waitForRestingGraph(client.evaluate, "resting network after the excluded warm-up");
  await client.evaluate("window.__atlasPerformance.clearLongTasks(); true");

  for (let sampleIndex = 0; sampleIndex < MEASURED_INTERACTION_COUNT; sampleIndex += 1) {
    performanceSamples.push(await runMeasuredMenInteraction({
      client,
      men,
      sampleIndex,
      runtimeErrors,
      failedResponses,
    }));
  }

  await client.evaluate("document.querySelector('[data-presentation-id=\"patek-philippe\"]')?.focus()", true);
  const focusState = await poll(
    client.evaluate,
    `(() => {
      const state = (${interactionStateExpression});
      return {
        ...state,
        ready: state.mode === 'preview-patek-philippe'
          && state.graphSvgCount === 1
          && state.activeEdgeCount === ${EXPECTED_PATEK_EDGE_COUNT}
          && state.activePathCount === ${EXPECTED_PATEK_EDGE_COUNT}
          && state.particleCount === ${EXPECTED_PATEK_EDGE_COUNT}
          && state.animateMotionCount === ${EXPECTED_PATEK_EDGE_COUNT}
          && state.activePaths.every((activePath) => activePath.visible)
          && state.particles.every((particle) => particle.visible),
      };
    })()`,
    "brand focus network",
  );

  const LAYOUT_VIEWPORTS = Object.freeze({
    compact: Object.freeze({ width: 390, height: 844 }),
    expanded: VIEWPORT,
  });
  const CONSERVATIVE_HEADER_SURFACE = "rgb(89, 91, 92)";
  const layoutInspectionExpression = String.raw`
    (() => {
      const numeric = (value) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const rectValue = (rect) => ({
        x: rect.x,
        y: rect.y,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
      const parseRgb = (value) => {
        const match = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
      };
      const relativeLuminance = (rgb) => {
        if (!rgb) return null;
        const channels = rgb.map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const contrastRatio = (foreground, background) => {
        const foregroundLuminance = relativeLuminance(parseRgb(foreground));
        const backgroundLuminance = relativeLuminance(parseRgb(background));
        if (foregroundLuminance === null || backgroundLuminance === null) return 0;
        const lighter = Math.max(foregroundLuminance, backgroundLuminance);
        const darker = Math.min(foregroundLuminance, backgroundLuminance);
        return (lighter + 0.05) / (darker + 0.05);
      };
      const visible = (element, style, rect) => Boolean(
        element
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && numeric(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0
      );
      const contract = ${JSON.stringify(heroContract)};
      const header = document.querySelector('.site-masthead');
      const wordmark = document.querySelector('.wordmark');
      const search = document.querySelector('.search-stage');
      const shell = document.querySelector('.elite-shell');
      const backdrops = Array.from(document.querySelectorAll('.watch-image-backdrop'));
      const pictures = Array.from(document.querySelectorAll('.watch-image-backdrop picture'));
      const images = Array.from(document.querySelectorAll('.watch-image-backdrop img'));
      const backdrop = backdrops[0] ?? null;
      const picture = pictures[0] ?? null;
      const image = images[0] ?? null;
      const avifSource = picture?.querySelector('source[type="image/avif"]') ?? null;
      if (!header || !wordmark || !search || !shell || !backdrop || !picture || !image || !avifSource) {
        return { ready: false, error: 'Header, wordmark, search, or responsive hero layout target is missing.' };
      }

      const backdropRect = backdrop.getBoundingClientRect();
      const pictureRect = picture.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const imageStyle = getComputedStyle(image);
      const currentPath = image.currentSrc
        ? new URL(image.currentSrc, location.href).pathname
        : null;
      const selectedManifest = contract.derivatives.find(
        (entry) => entry.publicPath === currentPath
      ) ?? null;
      const candidateDensity = selectedManifest && innerWidth > 0
        ? selectedManifest.intrinsicWidth / innerWidth
        : null;
      const expectedReportedNaturalWidth = candidateDensity
        ? Math.round(selectedManifest.intrinsicWidth / candidateDensity)
        : null;
      const expectedReportedNaturalHeight = candidateDensity
        ? Math.round(selectedManifest.intrinsicHeight / candidateDensity)
        : null;
      const naturalDimensionsValid = Boolean(
        selectedManifest
          && candidateDensity
          && Math.abs(image.naturalWidth - expectedReportedNaturalWidth) <= 1
          && Math.abs(image.naturalHeight - expectedReportedNaturalHeight) <= 1
      );
      const naturalRatio = image.naturalWidth / image.naturalHeight;
      const coverWidth = Math.max(backdropRect.width, backdropRect.height * naturalRatio);
      const coverHeight = Math.max(backdropRect.height, backdropRect.width / naturalRatio);
      const originalImageStyle = image.getAttribute('style');
      image.style.setProperty('animation', 'none', 'important');
      const motionExtrema = [
        'translate3d(-1.25%, -0.5%, 0) scale(1.06)',
        'translate3d(1.25%, 0.75%, 0) scale(1.10)',
      ].map((transform) => {
        image.style.setProperty('transform', transform, 'important');
        const box = image.getBoundingClientRect();
        return {
          transform,
          box: rectValue(box),
          coversBackdrop: box.left <= backdropRect.left + 0.5
            && box.top <= backdropRect.top + 0.5
            && box.right >= backdropRect.right - 0.5
            && box.bottom >= backdropRect.bottom - 0.5,
        };
      });
      if (originalImageStyle === null) image.removeAttribute('style');
      else image.setAttribute('style', originalImageStyle);

      const previousFocus = document.activeElement;
      const headerStyle = getComputedStyle(header);
      const headerRect = header.getBoundingClientRect();
      const wordmarkStyle = getComputedStyle(wordmark);
      const wordmarkRect = wordmark.getBoundingClientRect();
      const searchStyle = getComputedStyle(search);
      const searchRect = search.getBoundingClientRect();
      const links = Array.from(header.querySelectorAll('a'), (link) => {
        const style = getComputedStyle(link);
        const rect = link.getBoundingClientRect();
        return {
          name: link.getAttribute('aria-label') || link.textContent?.trim() || '',
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          color: style.color,
          pointerEvents: style.pointerEvents,
          visible: visible(link, style, rect),
          contrastRatio: contrastRatio(style.color, '${CONSERVATIVE_HEADER_SURFACE}'),
          box: rectValue(rect),
        };
      });
      const focus = [];
      for (const link of Array.from(header.querySelectorAll('a'))) {
        const baseStyle = getComputedStyle(link);
        const baseRect = link.getBoundingClientRect();
        if (!visible(link, baseStyle, baseRect)) continue;
        link.focus({ preventScroll: true });
        const style = getComputedStyle(link);
        const rect = link.getBoundingClientRect();
        const expansion = numeric(style.outlineWidth) + Math.max(0, numeric(style.outlineOffset));
        const outlineRect = {
          top: rect.top - expansion,
          right: rect.right + expansion,
          bottom: rect.bottom + expansion,
          left: rect.left - expansion,
        };
        let clipped = false;
        for (let ancestor = link.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          const ancestorRect = ancestor.getBoundingClientRect();
          const clipsX = /^(?:hidden|clip)$/.test(ancestorStyle.overflowX);
          const clipsY = /^(?:hidden|clip)$/.test(ancestorStyle.overflowY);
          if ((clipsX && (outlineRect.left < ancestorRect.left || outlineRect.right > ancestorRect.right))
            || (clipsY && (outlineRect.top < ancestorRect.top || outlineRect.bottom > ancestorRect.bottom))) {
            clipped = true;
            break;
          }
        }
        focus.push({
          name: link.getAttribute('aria-label') || link.textContent?.trim() || '',
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          contrastRatio: contrastRatio(style.outlineColor, '${CONSERVATIVE_HEADER_SURFACE}'),
          clipped,
        });
      }
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }

      const controls = Array.from(document.querySelectorAll('.atlas-node'));
      const centerHitRecords = controls.map((control) => {
        const rect = control.getBoundingClientRect();
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const resolvedControl = document.elementsFromPoint(center.x, center.y)
          .map((element) => element.closest?.('.atlas-node') ?? null)
          .find(Boolean) ?? null;
        return {
          id: control.dataset.presentationId ?? null,
          resolvedId: resolvedControl?.dataset.presentationId ?? null,
          center,
          hit: resolvedControl === control,
        };
      });
      const hitTesting = {
        controlCount: controls.length,
        records: centerHitRecords,
        allControlsHitTestable: controls.length === ${EXPECTED_NODE_COUNT}
          && centerHitRecords.every((record) => record.hit),
      };

      const documentWidth = document.documentElement.clientWidth;
      const scrollWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      );
      return {
        ready: true,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        media: {
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
          increasedContrast: matchMedia('(prefers-contrast: more)').matches,
          forcedColors: matchMedia('(forced-colors: active)').matches,
        },
        hero: {
          backdropCount: backdrops.length,
          pictureCount: pictures.length,
          imageCount: images.length,
          sourceCount: picture.querySelectorAll('source').length,
          imageState: backdrop.dataset.imageState ?? null,
          reducedMotion: backdrop.dataset.reducedMotion ?? null,
          currentPath,
          selectedManifest,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          naturalDimensionsValid,
          candidateDensity,
          expectedReportedNaturalWidth,
          expectedReportedNaturalHeight,
          objectFit: imageStyle.objectFit,
          objectPosition: imageStyle.objectPosition,
          animationName: imageStyle.animationName,
          pointerEvents: imageStyle.pointerEvents,
          avifSourceSet: avifSource.getAttribute('srcset'),
          webpSourceSet: image.getAttribute('srcset'),
          sizes: image.getAttribute('sizes'),
          fallbackPath: image.getAttribute('src'),
          shellBox: rectValue(shellRect),
          backdropBox: rectValue(backdropRect),
          pictureBox: rectValue(pictureRect),
          reservedGeometry: backdropRect.width > 0
            && backdropRect.height > 0
            && Math.abs(backdropRect.left - pictureRect.left) <= 0.5
            && Math.abs(backdropRect.top - pictureRect.top) <= 0.5
            && Math.abs(backdropRect.width - pictureRect.width) <= 0.5
            && Math.abs(backdropRect.height - pictureRect.height) <= 0.5
            && Math.abs(shellRect.left - backdropRect.left) <= 0.5
            && Math.abs(shellRect.top - backdropRect.top) <= 0.5
            && Math.abs(shellRect.width - backdropRect.width) <= 0.5
            && Math.abs(shellRect.height - backdropRect.height) <= 0.5,
          coverGeometry: {
            width: coverWidth,
            height: coverHeight,
            fillsBackdrop: coverWidth + 0.5 >= backdropRect.width
              && coverHeight + 0.5 >= backdropRect.height,
          },
          motionExtrema,
        },
        header: {
          backdropFilter: headerStyle.backdropFilter || headerStyle.webkitBackdropFilter,
          backgroundColor: headerStyle.backgroundColor,
          backgroundImage: headerStyle.backgroundImage,
          borderRadius: headerStyle.borderRadius,
          borderTopColor: headerStyle.borderTopColor,
          borderTopStyle: headerStyle.borderTopStyle,
          borderTopWidth: headerStyle.borderTopWidth,
          boxShadow: headerStyle.boxShadow,
          color: headerStyle.color,
          height: headerStyle.height,
          box: rectValue(headerRect),
        },
        links,
        wordmark: {
          visible: visible(wordmark, wordmarkStyle, wordmarkRect),
          centerDelta: Math.abs((wordmarkRect.left + wordmarkRect.width / 2) - innerWidth / 2),
          box: rectValue(wordmarkRect),
        },
        search: {
          display: searchStyle.display,
          visibility: searchStyle.visibility,
          clearance: searchRect.top - headerRect.bottom,
          box: rectValue(searchRect),
        },
        hitTesting,
        focus,
        overflow: { clientWidth: documentWidth, scrollWidth },
      };
    })()
  `;

  const inspectLayout = async (viewport, mediaFeatures = []) => {
    const expectsReducedMotion = mediaFeatures.some(
      (feature) => feature.name === "prefers-reduced-motion" && feature.value === "reduce",
    );
    await Promise.all([
      client.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      }),
      client.send("Emulation.setEmulatedMedia", { media: "screen", features: mediaFeatures }),
    ]);
    await client.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      true,
    );
    await poll(
      client.evaluate,
      `(() => {
        const backdrop = document.querySelector('.watch-image-backdrop');
        const image = backdrop?.querySelector('img');
        const mediaReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        return {
          ready: backdrop?.dataset.imageState === 'ready'
            && mediaReducedMotion === ${expectsReducedMotion}
            && Boolean(image?.complete && image.naturalWidth > 0),
          imageState: backdrop?.dataset.imageState ?? null,
          reducedMotion: backdrop?.dataset.reducedMotion ?? null,
          mediaReducedMotion,
        };
      })()`,
      `${viewport.width}px responsive image and preference state`,
    );
    return client.evaluate(layoutInspectionExpression);
  };

  const assertLayoutReport = (layout, expectation) => {
    assert.equal(layout.ready, true, layout.error ?? `${expectation.name} layout must be inspectable`);
    assert.deepEqual(
      layout.viewport,
      { width: expectation.viewport.width, height: expectation.viewport.height, devicePixelRatio: 1 },
      `${expectation.name} must use its finite DPR-1 viewport`,
    );
    assert.equal(layout.hero.backdropCount, 1, `${expectation.name} must keep one hero backdrop`);
    assert.equal(layout.hero.pictureCount, 1, `${expectation.name} must keep one hero picture`);
    assert.equal(layout.hero.imageCount, 1, `${expectation.name} must keep one hero image`);
    assert.equal(layout.hero.sourceCount, 1, `${expectation.name} must keep one AVIF source`);
    assert.equal(layout.hero.imageState, "ready", `${expectation.name} hero must remain ready`);
    assert.equal(layout.hero.avifSourceSet, heroContract.avifSourceSet);
    assert.equal(layout.hero.webpSourceSet, heroContract.webpSourceSet);
    assert.equal(layout.hero.sizes, heroContract.sizes);
    assert.equal(layout.hero.fallbackPath, heroContract.fallbackPath);
    assert.ok(layout.hero.selectedManifest, `${expectation.name} currentSrc must remain manifest-backed`);
    assert.equal(layout.hero.currentPath, layout.hero.selectedManifest.publicPath);
    assert.ok(layout.hero.naturalWidth > 0 && layout.hero.naturalHeight > 0);
    assert.equal(
      layout.hero.naturalDimensionsValid,
      true,
      `${expectation.name} natural dimensions must correspond to the selected width descriptor`,
    );
    assert.equal(layout.hero.objectFit, "cover", `${expectation.name} hero must use object-fit cover`);
    assert.equal(
      layout.hero.objectPosition,
      `${expectation.focalPoint.xPercent}% ${expectation.focalPoint.yPercent}%`,
      `${expectation.name} hero must use the manifest focal point`,
    );
    assert.equal(layout.hero.pointerEvents, "none", `${expectation.name} hero image must not intercept input`);
    assert.equal(layout.hero.reservedGeometry, true, `${expectation.name} hero must reserve its final shell geometry`);
    assert.equal(layout.hero.coverGeometry.fillsBackdrop, true, `${expectation.name} cover geometry must fill the backdrop`);
    assert.ok(
      layout.hero.motionExtrema.every((extremum) => extremum.coversBackdrop),
      `${expectation.name} authored motion extrema must expose no unpainted edge`,
    );
    assert.equal(
      layout.hitTesting.controlCount,
      EXPECTED_NODE_COUNT,
      `${expectation.name} must expose all 13 graph controls for center hit-testing`,
    );
    assert.equal(
      layout.hitTesting.allControlsHitTestable,
      true,
      `${expectation.name} must resolve every graph-control center to its control`,
    );
    assert.ok(
      layout.hitTesting.records.every((record) => record.id === record.resolvedId),
      `${expectation.name} center hit-test IDs must remain stable`,
    );
    assert.ok(
      Math.abs(layout.header.box.top - expectation.topInset) <= 1,
      `${expectation.name} masthead must preserve its top inset`,
    );
    assert.ok(
      layout.header.box.left >= expectation.inlineInset - 1
        && expectation.viewport.width - layout.header.box.right >= expectation.inlineInset - 1,
      `${expectation.name} masthead must preserve both inline insets`,
    );
    assert.equal(numericCss(layout.header.height), expectation.height, `${expectation.name} masthead height`);
    assert.equal(
      numericCss(layout.header.borderRadius),
      expectation.radius,
      `${expectation.name} masthead corner radius`,
    );
    assert.deepEqual(
      layout.links.filter((link) => link.visible).map((link) => link.name),
      expectation.visibleLinks,
      `${expectation.name} visible header links`,
    );
    assert.deepEqual(
      layout.links.filter((link) => !link.visible).map((link) => link.name),
      expectation.hiddenLinks,
      `${expectation.name} hidden header links`,
    );
    assert.equal(layout.wordmark.visible, true, `${expectation.name} wordmark must remain visible`);
    assert.ok(layout.wordmark.centerDelta <= 1, `${expectation.name} wordmark must stay within 1px of center`);
    assert.ok(
      layout.links.filter((link) => link.visible).every((link) => (
        link.box.width >= 44 && link.box.height >= 44 && link.pointerEvents !== "none"
      )),
      `${expectation.name} visible links must remain pointer-enabled 44px targets`,
    );
    assert.ok(
      layout.search.clearance >= expectation.minimumSearchClearance,
      `${expectation.name} search must clear the masthead`,
    );
    assert.ok(
      layout.overflow.scrollWidth <= layout.overflow.clientWidth,
      `${expectation.name} must have no horizontal document overflow`,
    );
    assert.ok(
      layout.links.filter((link) => link.visible).every((link) => link.contrastRatio >= 4.5),
      `${expectation.name} labels must meet 4.5:1 against the conservative header surface`,
    );
    assert.ok(
      layout.focus.length === expectation.visibleLinks.length
        && layout.focus.every((entry) => (
          numericCss(entry.outlineWidth) >= 2
            && entry.outlineStyle !== "none"
            && entry.contrastRatio >= 3
            && !entry.clipped
        )),
      `${expectation.name} focus rings must be >=2px, >=3:1, and unclipped`,
    );
  };

  const assertPreferenceReport = (layout, preference) => {
    assert.equal(layout.ready, true, layout.error ?? `${preference} layout must be inspectable`);
    assert.equal(layout.header.backdropFilter, "none", `${preference} must not enable backdrop filtering`);
    if (preference === "reduced transparency") {
      assert.equal(layout.media.reducedTransparency, true);
      assert.equal(layout.header.backgroundImage, "none");
      assert.equal(layout.header.backgroundColor, "rgb(16, 20, 22)");
    } else if (preference === "increased contrast") {
      assert.equal(layout.media.increasedContrast, true);
      assert.equal(layout.header.backgroundImage, "none");
      assert.equal(layout.header.backgroundColor, "rgb(8, 11, 12)");
      assert.equal(layout.header.borderTopColor, "rgb(248, 245, 238)");
    } else {
      assert.equal(layout.media.forcedColors, true);
      assert.equal(layout.header.backgroundImage, "none");
      assert.notEqual(layout.header.backgroundColor, "rgba(0, 0, 0, 0)");
      assert.equal(layout.header.borderTopStyle, "solid");
      assert.ok(numericCss(layout.header.borderTopWidth) >= 1);
      assert.equal(layout.header.boxShadow, "none");
      assert.ok(layout.links.filter((link) => link.visible).every((link) => link.color !== "transparent"));
      assert.ok(layout.focus.every((entry) => (
        numericCss(entry.outlineWidth) >= 2 && entry.outlineStyle !== "none" && !entry.clipped
      )));
    }
  };

  const layoutReports = {
    expanded: await inspectLayout(LAYOUT_VIEWPORTS.expanded),
    compact: await inspectLayout(LAYOUT_VIEWPORTS.compact),
    reducedTransparency: await inspectLayout(LAYOUT_VIEWPORTS.expanded, [
      { name: "prefers-reduced-transparency", value: "reduce" },
    ]),
    increasedContrast: await inspectLayout(LAYOUT_VIEWPORTS.expanded, [
      { name: "prefers-contrast", value: "more" },
    ]),
    forcedColors: await inspectLayout(LAYOUT_VIEWPORTS.expanded, [
      { name: "forced-colors", value: "active" },
    ]),
    reducedMotion: await inspectLayout(LAYOUT_VIEWPORTS.expanded, [
      { name: "prefers-reduced-motion", value: "reduce" },
    ]),
  };
  reducedMotionStasis = await client.evaluate(String.raw`
    new Promise((resolve) => {
      const image = document.querySelector('.watch-image-backdrop__image');
      const backdrop = document.querySelector('.watch-image-backdrop');
      if (!image || !backdrop) {
        resolve({ ready: false, error: 'Reduced-motion hero image is unavailable.' });
        return;
      }
      const before = getComputedStyle(image);
      const transformBefore = before.transform;
      const animationNameBefore = before.animationName;
      const timeout = window.setTimeout(() => {
        resolve({ ready: false, error: 'Reduced-motion stasis probe timed out.' });
      }, 2_000);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.clearTimeout(timeout);
        const after = getComputedStyle(image);
        resolve({
          ready: true,
          error: null,
          reducedMotion: backdrop.dataset.reducedMotion ?? null,
          mediaReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          transformBefore,
          transformAfter: after.transform,
          animationNameBefore,
          animationNameAfter: after.animationName,
        });
      }));
    })
  `, true);
  await Promise.all([
    client.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: VIEWPORT.width,
      screenHeight: VIEWPORT.height,
    }),
    client.send("Emulation.setEmulatedMedia", { media: "screen", features: [] }),
  ]);
  await poll(
    client.evaluate,
    "({ ready: document.querySelector('.watch-image-backdrop')?.dataset.reducedMotion === 'false' && !matchMedia('(prefers-reduced-motion: reduce)').matches })",
    "normal motion restoration after preference probes",
  );

  const result = {
    readiness,
    hydrationBeforeHeroRelease,
    screenshotPath,
    report,
    selectedResource,
    heroFrameProbe,
    reducedMotionStasis,
    layoutReports,
    interactions: { hoverState, focusState },
    performanceSupport,
    performanceSamples,
    derivativeRequestEvents,
    masterRequests,
    externalRequests,
    runtimeErrors,
    consoleErrors,
    hydrationRecoveries,
    failedResponses,
  };
  const layoutEvidence = Object.fromEntries(
    Object.entries(layoutReports).map(([name, layout]) => [name, {
      ready: layout.ready,
      viewport: layout.viewport,
      media: layout.media,
      hero: {
        currentPath: layout.hero.currentPath,
        selectedManifest: layout.hero.selectedManifest,
        naturalWidth: layout.hero.naturalWidth,
        naturalHeight: layout.hero.naturalHeight,
        naturalDimensionsValid: layout.hero.naturalDimensionsValid,
        objectFit: layout.hero.objectFit,
        objectPosition: layout.hero.objectPosition,
        animationName: layout.hero.animationName,
        reducedMotion: layout.hero.reducedMotion,
        reservedGeometry: layout.hero.reservedGeometry,
        coverGeometry: layout.hero.coverGeometry,
        motionExtrema: layout.hero.motionExtrema,
      },
      header: {
        backdropFilter: layout.header.backdropFilter,
        backgroundColor: layout.header.backgroundColor,
        backgroundImage: layout.header.backgroundImage,
        borderRadius: layout.header.borderRadius,
        borderTopColor: layout.header.borderTopColor,
        borderTopStyle: layout.header.borderTopStyle,
        borderTopWidth: layout.header.borderTopWidth,
        boxShadow: layout.header.boxShadow,
        height: layout.header.height,
        box: layout.header.box,
      },
      links: layout.links.map((link) => ({
        name: link.name,
        visible: link.visible,
        pointerEvents: link.pointerEvents,
        contrastRatio: link.contrastRatio,
        box: link.box,
      })),
      wordmark: layout.wordmark,
      search: layout.search,
      focus: layout.focus.map((entry) => ({
        name: entry.name,
        outlineStyle: entry.outlineStyle,
        outlineWidth: entry.outlineWidth,
        contrastRatio: entry.contrastRatio,
        clipped: entry.clipped,
      })),
      overflow: layout.overflow,
      hitTesting: {
        controlCount: layout.hitTesting.controlCount,
        allControlsHitTestable: layout.hitTesting.allControlsHitTestable,
        records: layout.hitTesting.records.map(({ id, resolvedId, hit }) => ({ id, resolvedId, hit })),
      },
    }]),
  );
  const performanceEvidence = performanceSamples.map((sample) => ({
    sampleNumber: sample.sampleNumber,
    eventType: sample.eventType,
    eventTimeStamp: sample.eventTimeStamp,
    readyFrameTime: sample.readyFrameTime,
    sampleEnd: sample.sampleEnd,
    visualResponseLatencyMs: sample.visualResponseLatencyMs,
    longestTaskMs: sample.longestTaskMs,
    cumulativeBlockingTimeMs: sample.cumulativeBlockingTimeMs,
    longTasks: sample.longTasks,
    hitTesting: {
      controlCount: sample.hitTesting?.controlCount ?? null,
      allControlsHitTestable: sample.hitTesting?.allControlsHitTestable ?? false,
    },
    readyFanState: sample.readyFanState ? {
      mode: sample.readyFanState.mode,
      graphSvgCount: sample.readyFanState.graphSvgCount,
      activeEdgeCount: sample.readyFanState.activeEdgeCount,
      activePathCount: sample.readyFanState.activePathCount,
      particleCount: sample.readyFanState.particleCount,
      animateMotionCount: sample.readyFanState.animateMotionCount,
    } : null,
    error: sample.error,
    runtimeErrors: sample.runtimeErrors,
    failedResponses: sample.failedResponses,
  }));
  const evidence = {
    readiness,
    hydrationBeforeHeroRelease,
    screenshotPath,
    viewport: report.viewport,
    hero: report.hero,
    selectedResource,
    heroFrameProbe,
    reducedMotionStasis,
    layoutReports: layoutEvidence,
    graph: {
      mountedCount: report.graphSvgCount,
      variants: report.graphVariants,
    },
    nodes: report.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      display: node.display,
      visibility: node.visibility,
      opacity: node.opacity,
      transform: node.transform,
      box: node.box,
      markerBox: node.marker?.box,
      markerOpacity: node.marker?.opacity,
      labelBox: node.label?.box,
      labelOpacity: node.label?.opacity,
      topAtlasId: node.topAtlasId,
    })),
    layers: report.layers.map((entry) => ({
      selector: entry.selector,
      present: entry.elements.length,
      zIndex: entry.elements[0]?.zIndex ?? null,
      isolation: entry.elements[0]?.isolation ?? null,
      pointerEvents: entry.elements[0]?.pointerEvents ?? null,
    })),
    restingNetwork: {
      edgeCount: report.restingPaths.length,
      stroke: report.restingPaths[0]?.stroke,
      strokeWidth: report.restingPaths[0]?.strokeWidth,
    },
    interactions: {
      menHover: {
        mode: hoverState.mode,
        activeEdgeCount: hoverState.activeEdgeCount,
        particleCount: hoverState.particleCount,
        animateMotionCount: hoverState.animateMotionCount,
        pathOpacity: hoverState.activePaths[0]?.opacity,
        pathStrokeWidth: hoverState.activePaths[0]?.strokeWidth,
      },
      brandFocus: {
        mode: focusState.mode,
        activeEdgeCount: focusState.activeEdgeCount,
        particleCount: focusState.particleCount,
        animateMotionCount: focusState.animateMotionCount,
        pathOpacity: focusState.activePaths[0]?.opacity,
        pathStrokeWidth: focusState.activePaths[0]?.strokeWidth,
      },
    },
    performanceSupport,
    performanceSamples: performanceEvidence,
    network: {
      derivativeRequestEvents,
      masterRequests,
      externalRequests,
    },
    auditedOverlays: report.auditedOverlays,
    runtimeErrors,
    consoleErrors,
    hydrationRecoveries,
    failedResponses,
  };

  // Raw interaction records and all 120 frame intervals are emitted before threshold assertions.
  console.log(JSON.stringify(process.env.ATLAS_VERBOSE === "1" ? result : evidence, null, 2));

  if (shouldAssert) {
    assertReport(report, hoverState, focusState);
    assertSelectedResource(selectedResource, readiness);
    assertHeroFrameProbe(heroFrameProbe);
    assertReducedMotionStasis(reducedMotionStasis);
    assertPerformanceSamples(performanceSamples);
    assertLayoutReport(layoutReports.expanded, {
      name: "expanded",
      viewport: LAYOUT_VIEWPORTS.expanded,
      focalPoint: heroContract.focalPoints.expanded,
      topInset: 12,
      inlineInset: 16,
      height: 68,
      radius: 22,
      minimumSearchClearance: 20,
      visibleLinks: ["COLLECTION", "ABOUT", "MERIDIAN WATCHES home", "CONTACT", "LOGIN"],
      hiddenLinks: [],
    });
    assertLayoutReport(layoutReports.compact, {
      name: "compact",
      viewport: LAYOUT_VIEWPORTS.compact,
      focalPoint: heroContract.focalPoints.compact,
      topInset: 8,
      inlineInset: 8,
      height: 60,
      radius: 18,
      minimumSearchClearance: 8,
      visibleLinks: ["COLLECTION", "MERIDIAN WATCHES home", "LOGIN"],
      hiddenLinks: ["ABOUT", "CONTACT"],
    });
    assertPreferenceReport(layoutReports.reducedTransparency, "reduced transparency");
    assertPreferenceReport(layoutReports.increasedContrast, "increased contrast");
    assertPreferenceReport(layoutReports.forcedColors, "forced colors");
    assert.equal(
      derivativeRequestEvents.length,
      1,
      "one complete navigation and all responsive probes must issue one selected derivative request",
    );
    assert.deepEqual(masterRequests, [], "the browser must never request the archival PNG master");
    assert.deepEqual(externalRequests, [], "the smoke page must make no external network requests");
    assert.deepEqual(runtimeErrors, [], "the browser run must not produce runtime or console errors");
    assert.deepEqual(consoleErrors, [], "the browser run must not produce console errors");
    assert.deepEqual(hydrationRecoveries, [], "the browser run must not recover from hydration errors");
    assert.deepEqual(failedResponses, [], "all application resources must load successfully");
    console.log("Atlas responsive-image visibility, layout, and performance smoke assertions passed.");
  }
} catch (error) {
  if (client && performanceSamples.length < MEASURED_INTERACTION_COUNT) {
    const pageSamples = await client.evaluate(
      "window.__atlasPerformance?.samples?.filter(Boolean) ?? []",
      true,
    ).catch(() => []);
    for (const sample of pageSamples) {
      if (!performanceSamples.some((candidate) => candidate.sampleNumber === sample.sampleNumber)) {
        performanceSamples.push(sample);
      }
    }
    performanceSamples.sort((left, right) => left.sampleNumber - right.sampleNumber);
  }
  console.error(JSON.stringify({
    performanceSupport,
    performanceSamples,
    heroFrameProbe,
    selectedResource,
    reducedMotionStasis,
    hydrationBeforeHeroRelease,
    derivativeRequestEvents,
    masterRequests,
    externalRequests,
    runtimeErrors,
    consoleErrors,
    hydrationRecoveries,
    failedResponses,
    browserStderr,
    serverOutput,
  }, null, 2));
  throw error;
} finally {
  if (client) {
    await client.evaluate(
      "window.__atlasPerformance?.observer?.disconnect(); true",
      true,
    ).catch(() => undefined);
    await client.close().catch(() => undefined);
  }
  await stopChild(chromeProcess);
  await stopChild(serverProcess);
  await rm(temporaryRoot, { recursive: true, force: true });
  if (browserStderr && process.env.ATLAS_DEBUG === "1") process.stderr.write(browserStderr);
}
