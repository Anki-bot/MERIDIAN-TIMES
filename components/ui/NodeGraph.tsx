"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, MouseEvent } from "react";
import {
  GRAPH_NODES,
  WATCH_NODES,
  isGraphNodeEnabled,
  type GraphEdge,
  type GraphNodeDefinition,
} from "@/lib/graph";
import type { DictionaryTerm, WatchAudience } from "@/lib/types";
import { useRouter } from "next/navigation"; // FIXED: Correct App Router import

// 1. Categorize the 37 brand IDs
const MEN_ONLY_BRANDS = [
  "diesel",
  "edifice",
  "g-shock",
  "hublot",
  "maserati",
  "richard-mille",
  "sevenfriday",
  "tag-heuer",
  "bentley",
  "hugo-boss",
  "emporio-armani",
  "lacoste",
  "rolex",
  "armani-exchange",
  "omega",
  "patek-philippe",
  "guess",
  "audemars-piguet",
  "citizen",
  "tissot",
  "tommy-hilfiger",
  "seiko",
  "jacob-co",
  "movado",
  "vacheron-constantin",
  "franck-muller",
];

const WOMEN_ONLY_BRANDS = [
  "swarovski",
  "burberry",
  "versace",
  "longines",
  "gucci",
  "calvin-klein",
];

const UNISEX_BRANDS = ["cartier", "fossil", "rado", "orient", "michael-kors"];

interface NodeGraphProps {
  readonly terms: readonly DictionaryTerm[];
  readonly activeAudience: WatchAudience | null;
  readonly activeBrand?: string | null;
  readonly selectedTermId: string | null;
  readonly onAudienceSelect: (audience: WatchAudience) => void;
  readonly onBrandSelect?: (brandId: string) => void;
  readonly onTermSelect: (
    term: DictionaryTerm,
    opener?: HTMLElement | null,
  ) => void;
  readonly onBackdropBack?: () => void;
}

type NodeStyle = CSSProperties & {
  "--node-x": string;
  "--node-y": string;
  "--node-mobile-x": string;
  "--node-mobile-y": string;
};

const MOBILE_GRAPH_QUERY = "(max-width: 700px)";

function subscribeToGraphViewport(onStoreChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }
  const mediaQuery = window.matchMedia(MOBILE_GRAPH_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getGraphViewportSnapshot(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(MOBILE_GRAPH_QUERY).matches
    : false;
}

function getServerGraphViewportSnapshot(): boolean {
  return false;
}

function gridJitterPosition(
  index: number,
  total: number,
  nodeId?: string,
): { x: number; y: number } {
  void total;

  // 1. Check for manual overrides first
  const manualPositions: Record<string, { x: number; y: number }> = {
    seiko: { x: 42, y: 69 },
    omega: { x: 42, y: 39 },
    citizen: { x: 13, y: 37 },
    fossil: { x: 51, y: 66 },
    rolex: { x: 34, y: 73 },
    movado: { x: 26, y: 74 },
    "jacob-co": { x: 20, y: 56 },
    "franck-muller": { x: 24, y: 37 },
    sevenfriday: { x: 63, y: 79 },
    "vacheron-constantin": { x: 73, y: 84 },
    "tommy-hilfiger": { x: 42, y: 85 },
    "tag-heuer": { x: 6, y: 80 },
    "michael-kors": { x: 5, y: 53 },
    hublot: { x: 11, y: 63 },
    "richard-mille": { x: 16, y: 72 },
    lacoste: { x: 45, y: 53 },
    tissot: { x: 30, y: 85 },
    "audemars-piguet": { x: 11, y: 21 },
    "g-shock": { x: 57, y: 46 },
    orient: { x: 58, y: 63 },
    "emporio-armani": { x: 65, y: 33 },
    gucci: { x: 75, y: 37 },
    "patek-philippe": { x: 72, y: 70 },
    swarovski: { x: 85, y: 69 },
  };

  if (nodeId && manualPositions[nodeId]) {
    return manualPositions[nodeId];
  }

  // 2. Fallback to Safe Zone Grid for unmapped nodes
  const layoutMap = [
    { x: 10, y: 18 },
    { x: 26, y: 18 },
    { x: 42, y: 18 },
    { x: 58, y: 18 },
    { x: 74, y: 18 },
    { x: 90, y: 18 },
    { x: 17, y: 29 },
    { x: 34, y: 29 },
    { x: 50, y: 29 },
    { x: 66, y: 29 },
    { x: 83, y: 29 },
    { x: 10, y: 41 },
    { x: 22, y: 41 },
    { x: 50, y: 41 },
    { x: 78, y: 41 },
    { x: 90, y: 41 },
    { x: 12, y: 54 },
    { x: 24, y: 54 },
    { x: 50, y: 54 },
    { x: 76, y: 54 },
    { x: 88, y: 54 },
    { x: 8, y: 66 },
    { x: 20, y: 66 },
    { x: 40, y: 66 },
    { x: 60, y: 66 },
    { x: 80, y: 66 },
    { x: 92, y: 66 },
    { x: 15, y: 77 },
    { x: 32, y: 77 },
    { x: 50, y: 77 },
    { x: 68, y: 77 },
    { x: 85, y: 77 },
    { x: 10, y: 87 },
    { x: 28, y: 87 },
    { x: 50, y: 87 },
    { x: 72, y: 87 },
    { x: 90, y: 87 },
  ];

  const pos = layoutMap[index % layoutMap.length];
  return { x: pos.x, y: pos.y };
}

function GraphPaths({
  mobile,
  idPrefix,
  activeEdges,
  activeGender,
}: {
  mobile: boolean;
  idPrefix: string;
  activeEdges?: readonly GraphEdge[];
  reducedMotion?: boolean;
  activeAudience?: string | null;
  activeBrand?: string | null;
  activeGender: string | null;
}) {
  const nodeMap = new Map(
    [...GRAPH_NODES, ...WATCH_NODES].map((n) => [n.id, n]),
  );
  const prefix = `${idPrefix}-${mobile ? "mobile" : "desktop"}`;

  return (
    <svg
      className={`graph-connections graph-connections--${mobile ? "mobile" : "desktop"}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <defs>
        <linearGradient id={`${prefix}-gold`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffb44d" />
          <stop offset="0.48" stopColor="#fff7d6" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id={`${prefix}-ruby`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ff3158" />
          <stop offset="0.48" stopColor="#ffd6cf" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>

      <style>{`
        @keyframes flowAnts { to { stroke-dashoffset: -24; } }
        .animate-flow { animation: flowAnts 1.2s linear infinite; }
      `}</style>

      <g>
        {(activeEdges || []).map((edge: GraphEdge) => {
          const origin = nodeMap.get(edge.fromId);
          const dest = nodeMap.get(edge.toId);
          if (!origin || !dest) return null;

          const brandNodes = GRAPH_NODES.filter((n) => n.kind === "brand");

          const getPos = (node: GraphNodeDefinition) => {
            if (activeGender !== null) {
              if (node.termId === "men" || node.termId === "women") {
                return activeGender.toLowerCase() === node.termId
                  ? { x: 50, y: 50 }
                  : { x: -100, y: -100 };
              }
              if (node.kind === "brand") {
                const brands = brandNodes.filter(
                  (n: GraphNodeDefinition) =>
                    n.termId !== "men" &&
                    n.termId !== "women" &&
                    n.termId !== "watches",
                );
                const idx = Math.max(
                  0,
                  brands.findIndex((n) => n.id === node.id),
                );
                const angle =
                  (idx / brands.length) * (2 * Math.PI) - Math.PI / 2;
                const radius = idx % 2 === 0 ? 25 : 40;
                return {
                  x: 50 + radius * Math.cos(angle),
                  y: 50 + radius * Math.sin(angle),
                };
              }
            }
            if (node.kind === "brand") {
              const idx = brandNodes.findIndex(
                (n: GraphNodeDefinition) => n.id === node.id,
              );
              const pos = gridJitterPosition(idx, brandNodes.length, node.id);
              return pos ? pos : mobile ? node.mobile : node.desktop;
            }
            return mobile ? node.mobile : node.desktop;
          };

          const p1 = getPos(origin);
          const p2 = getPos(dest);
          if (!p1 || !p2) return null;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const nx = -dy / dist;
          const ny = dx / dist;
          const dir = (origin.id.length + dest.id.length) % 2 === 0 ? 1 : -1;
          const bend = Math.min(6.5, dist * 0.15) * dir;
          const path = `M ${p1.x} ${p1.y} C ${p1.x + dx * 0.34 + nx * bend} ${p1.y + dy * 0.34 + ny * bend}, ${p1.x + dx * 0.72 + nx * bend} ${p1.y + dy * 0.72 + ny * bend}, ${p2.x} ${p2.y}`;

          const menId =
            GRAPH_NODES.find((n) => n.termId === "men")?.id || "men";
          const isMen = edge.fromId === menId;
          const strokeColor = isMen ? "#003366" : "#800020";

          return (
            <g key={edge.id}>
              <path
                d={path}
                className="animate-flow"
                stroke="rgba(255, 255, 255, 0.85)"
                strokeOpacity={1}
                strokeWidth={6}
                strokeDasharray="8 6"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d={path}
                className="animate-flow"
                stroke={strokeColor}
                strokeOpacity={1}
                strokeWidth={3}
                strokeDasharray="8 6"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function NodeGraph({
  terms,
  activeAudience,
  activeBrand = null,
  selectedTermId,
  onAudienceSelect,
  onTermSelect,
  onBackdropBack = () => {},
}: NodeGraphProps) {
  const router = useRouter();

  const reducedMotion = Boolean(useReducedMotion());
  const mobile = useSyncExternalStore(
    subscribeToGraphViewport,
    getGraphViewportSnapshot,
    getServerGraphViewportSnapshot,
  );
  const rawId = useId();
  const graphId = `watch-network-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const previewNodeId = focusedNodeId ?? hoveredNodeId;
  const [activeGender, setActiveGender] = useState<string | null>(null);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);

  useEffect(() => {
    if (activeAudience) {
      const expectedGender = activeAudience === "men" ? "Men" : "Women";
      if (activeGender !== expectedGender) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveGender(expectedGender);
      }
    } else if (activeAudience === null && activeGender !== null) {
      setActiveGender(null);
    }
  }, [activeAudience, activeGender]);

  useEffect(() => {
    if (activeBrand && activeBrand !== activeBrandId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveBrandId(activeBrand);
    } else if (activeBrand === null && activeBrandId !== null) {
      setActiveBrandId(null);
    }
  }, [activeBrand, activeBrandId]);

  const termMap = useMemo(
    () => new Map(terms.map((term) => [term.id, term])),
    [terms],
  );

  const augmentedEdges = useMemo(() => {
    const edges: { id: string; fromId: string; toId: string }[] = [];
    MEN_ONLY_BRANDS.forEach((brandId) => {
      edges.push({ id: `e-m-${brandId}`, fromId: "men", toId: brandId });
    });
    WOMEN_ONLY_BRANDS.forEach((brandId) => {
      edges.push({ id: `e-w-${brandId}`, fromId: "women", toId: brandId });
    });
    UNISEX_BRANDS.forEach((brandId) => {
      edges.push({ id: `e-m-${brandId}`, fromId: "men", toId: brandId });
      edges.push({ id: `e-w-${brandId}`, fromId: "women", toId: brandId });
    });
    return edges;
  }, []);

  const activeEdges = augmentedEdges
    .filter((edge: { fromId: string; toId: string }) => {
      const isGenderActive = activeGender
        ? (activeGender === "Men" && edge.fromId === "men") ||
          (activeGender === "Women" && edge.fromId === "women")
        : false;
      const isPreviewActive = previewNodeId
        ? edge.fromId === previewNodeId || edge.toId === previewNodeId
        : false;
      return isGenderActive || isPreviewActive;
    })
    .map((edge) => ({ ...edge, emphasized: true }));

  const connectedNodeIds = new Set(
    activeEdges.flatMap((edge) => [edge.fromId, edge.toId]),
  );

  const presentationCountByTerm = GRAPH_NODES.reduce((counts, node) => {
    counts.set(node.termId, (counts.get(node.termId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  function handleNodeClick(
    node: GraphNodeDefinition,
    term: DictionaryTerm,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    // Strict audience vs brand separation - audience allows zoom/filter, brand always routes
    if (node.id === "men" || node.id === "women") {
      const genderName = node.id === "men" ? "Men" : "Women";
      setActiveGender((prev) => (prev === genderName ? null : genderName));
      onAudienceSelect(node.id);
      return;
    }
    if (node.kind === "brand") {
      // Intercept brand clicks and forcefully route to shop, bypassing old definition-panel logic
      // Works consistently whether in default view or zoomed-in gender view
      router.push(`/shop/${node.id}`);
      return;
    }
    if (node.kind === "watch") {
      if (!isGraphNodeEnabled(term, activeAudience, activeBrand)) return;
      onTermSelect(term, event.currentTarget);
      return;
    }
    if (!isGraphNodeEnabled(term, activeAudience, activeBrand)) return;
    onTermSelect(term, event.currentTarget);
  }

  const networkMode = previewNodeId
    ? `preview-${previewNodeId}`
    : activeBrand
      ? `active-brand-${activeBrand}`
      : activeAudience
        ? `active-${activeAudience}`
        : "resting";

  const levelKey = activeBrand
    ? `level3-${activeBrand}`
    : activeAudience
      ? `level2-${activeAudience}`
      : "level1";

  const diveEasing = [0.7, 0, 0.3, 1] as const;
  const diveDuration = 1.0;
  const siblingDuration = 0.6;
  const childDuration = 0.9;

  return (
    <motion.section
      id="watch-atlas"
      className="node-graph"
      aria-labelledby="atlas-heading"
      data-network-mode={networkMode}
      data-level={levelKey}
      initial={false}
      animate={{
        scale: activeBrand
          ? 1.08
          : activeGender !== null
            ? 1
            : activeAudience
              ? 1.06
              : 1,
      }}
      transition={{
        duration: reducedMotion ? 0 : 0.75,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <h2 id="atlas-heading" className="sr-only">
        Interactive watch brand network
      </h2>

      <GraphPaths
        mobile={mobile}
        idPrefix={graphId}
        activeEdges={activeEdges as unknown as GraphEdge[]}
        reducedMotion={reducedMotion}
        activeAudience={activeAudience}
        activeBrand={activeBrand ?? null}
        activeGender={activeGender}
      />

      <AnimatePresence>
        {activeBrand ? (
          <motion.div
            key={`focus-brand-${activeBrand}`}
            className="audience-focus-backdrop audience-focus-backdrop--brand"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{
              duration: reducedMotion ? 0 : 0.6,
              ease: [0.22, 1, 0.36, 1],
            }}
            aria-hidden="true"
            onClick={() => {
              setActiveGender(null);
              onBackdropBack();
            }}
          />
        ) : activeAudience ? (
          <motion.div
            key={`focus-${activeAudience}`}
            className="audience-focus-backdrop"
            initial={
              reducedMotion
                ? false
                : { opacity: 0, backdropFilter: "blur(0px)" }
            }
            animate={{ opacity: 1, backdropFilter: "blur(0px)" }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{
              duration: reducedMotion ? 0 : 0.6,
              ease: [0.22, 1, 0.36, 1],
            }}
            aria-hidden="true"
            onClick={() => {
              setActiveGender(null);
              onBackdropBack();
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {activeBrandId ? (
          <motion.div
            key={`brand-panel-${activeBrandId}`}
            className="brand-details-panel"
            initial={{ x: "100%" }}
            animate={{ x: "0%" }}
            exit={{ x: "100%" }}
            transition={{
              duration: reducedMotion ? 0 : 0.5,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={
              {
                position: "absolute",
                right: 0,
                top: 0,
                width: "40vw",
                height: "100vh",
                background:
                  "linear-gradient(135deg, rgba(15,15,15,0.9) 0%, rgba(5,5,5,0.95) 100%)",
                backdropFilter: "blur(12px)",
                borderLeft: "1px solid rgba(255, 215, 0, 0.3)",
                padding: "40px",
                color: "#fff",
                zIndex: 1000,
              } as unknown as React.CSSProperties
            }
          >
            <button
              onClick={() => {
                setActiveBrandId(null);
                onBackdropBack();
              }}
              aria-label="Close brand details"
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: "1.5rem",
                cursor: "pointer",
              }}
            >
              X
            </button>
            <h3
              style={{ marginTop: "60px", fontSize: "1.5rem", fontWeight: 600 }}
            >
              {activeBrandId}
            </h3>
            <p style={{ marginTop: "20px", opacity: 0.8 }}>
              Placeholder watch title for {activeBrandId}
            </p>
            <p style={{ marginTop: "10px", opacity: 0.6, fontSize: "0.9rem" }}>
              Discover the exquisite craftsmanship and heritage of{" "}
              {activeBrandId}. Select a watch from the micro-orbit to view
              details.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div
        className="atlas-controls"
        data-atlas-control-count={
          GRAPH_NODES.filter(
            (n) =>
              n.kind !== "watch" ||
              (activeBrand &&
                termMap.get(n.termId)?.parentIds.includes(activeBrand)),
          ).length
        }
      >
        {GRAPH_NODES.filter((n) => n.kind === "audience").map((node) => {
          const term = termMap.get(node.termId)!;
          const enabled = isGraphNodeEnabled(term, activeAudience, activeBrand);
          const audienceSelected = activeAudience === term.id;
          const selected = selectedTermId === term.id;
          const previewed = previewNodeId === node.id;
          const connected = connectedNodeIds.has(node.id);
          const genderName = term.id === "men" ? "Men" : "Women";
          const isDivingParent =
            (activeAudience === term.id || activeGender === genderName) &&
            !activeBrand;
          const isSibling =
            (activeAudience !== null &&
              activeAudience !== term.id &&
              !activeBrand) ||
            (activeGender !== null &&
              activeGender !== genderName &&
              !activeBrand);
          const isOrbitMode = activeGender !== null;
          let audienceTargetX = node.desktop.x;
          let audienceTargetY = node.desktop.y;
          if (isOrbitMode && isDivingParent) {
            audienceTargetX = 50;
            audienceTargetY = 50;
          } else if (isDivingParent) {
            audienceTargetX = 35;
            audienceTargetY = 48;
          }
          const style: NodeStyle = {
            "--node-x": `${audienceTargetX}%`,
            "--node-y": `${audienceTargetY}%`,
            "--node-mobile-x": `${audienceTargetX}%`,
            "--node-mobile-y": `${audienceTargetY}%`,
          };
          const diveState = isDivingParent
            ? "diving"
            : isSibling
              ? "sibling"
              : "resting";
          return (
            <motion.button
              key={node.id}
              layout={isDivingParent || isSibling}
              type="button"
              data-presentation-id={node.id}
              data-dive-state={diveState}
              data-level={levelKey}
              className={[
                "atlas-node",
                `atlas-node--audience`,
                `atlas-node--${term.id}`,
                enabled ? "is-enabled" : "is-locked",
                selected ? "is-selected" : "",
                audienceSelected ? "is-audience-selected" : "",
                previewed ? "is-previewed" : "",
                connected ? "is-connected" : "",
                isDivingParent ? "is-diving" : "",
                isSibling ? "is-sibling-exit" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-disabled={!enabled}
              aria-pressed={audienceSelected}
              aria-label={`${term.nodeLabel}, activate ${term.term}`}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(e) => handleNodeClick(node, term, e as any)}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() =>
                setHoveredNodeId((c) => (c === node.id ? null : c))
              }
              onPointerEnter={() => setHoveredNodeId(node.id)}
              onPointerLeave={() =>
                setHoveredNodeId((c) => (c === node.id ? null : c))
              }
              onFocus={() => setFocusedNodeId(node.id)}
              onBlur={() => setFocusedNodeId((c) => (c === node.id ? null : c))}
              initial={false}
              animate={
                reducedMotion
                  ? {
                      scale: 1,
                      opacity: 1,
                      left: `${audienceTargetX}%`,
                      top: `${audienceTargetY}%`,
                    }
                  : isOrbitMode
                    ? term.id !== activeGender!.toLowerCase()
                      ? {
                          scale: 0,
                          opacity: 0,
                          left: `${audienceTargetX}%`,
                          top: `${audienceTargetY}%`,
                        }
                      : {
                          scale: 1.1,
                          opacity: 1,
                          left: `${audienceTargetX}%`,
                          top: `${audienceTargetY}%`,
                        }
                    : isDivingParent
                      ? {
                          scale: 1,
                          opacity: 1,
                          left: `${audienceTargetX}%`,
                          top: `${audienceTargetY}%`,
                        }
                      : isSibling
                        ? {
                            scale: 0.3,
                            opacity: 0.15,
                            left: `${audienceTargetX}%`,
                            top: `${audienceTargetY}%`,
                          }
                        : {
                            scale: 1,
                            opacity: 1,
                            left: `${audienceTargetX}%`,
                            top: `${audienceTargetY}%`,
                          }
              }
              transition={
                isOrbitMode
                  ? {
                      duration: 1.2,
                      ease: [0.25, 0.1, 0.25, 1] as const,
                    }
                  : isDivingParent
                    ? {
                        duration: diveDuration,
                        ease: diveEasing,
                        layout: {
                          duration: 0.9,
                          ease: [0.32, 0.72, 0, 1] as const,
                        },
                      }
                    : isSibling
                      ? { duration: siblingDuration, ease: "easeIn" as const }
                      : { duration: 0.35, ease: "easeInOut" as const }
              }
              style={{
                ...style,
                pointerEvents:
                  isSibling ||
                  (activeGender !== null &&
                    term.id !== activeGender.toLowerCase())
                    ? "none"
                    : "auto",
                zIndex: 9999,
              }}
            >
              <div className="atlas-node__float">
                <span className="atlas-node__sphere" aria-hidden="true" />
                <span className="atlas-node__label">{term.nodeLabel}</span>
              </div>
            </motion.button>
          );
        })}
        <AnimatePresence mode="popLayout" initial={false}>
          {GRAPH_NODES.filter((node) => {
            const term = termMap.get(node.termId);
            if (!term) return false;
            if (node.kind === "audience") return false;
            if (node.kind === "watch") {
              return (
                activeBrand !== null && term.parentIds.includes(activeBrand)
              );
            }
            return true;
          }).map((node, index, arr) => {
            const term = termMap.get(node.termId);
            if (!term) return null;
            const audienceNode = node.kind === "audience";
            const brandNode = node.kind === "brand";
            const watchNode = node.kind === "watch";
            const enabled = isGraphNodeEnabled(
              term,
              activeAudience,
              activeBrand,
            );
            const selected = selectedTermId === term.id;
            const audienceSelected = audienceNode && activeAudience === term.id;
            const previewed = previewNodeId === node.id;
            const connected = connectedNodeIds.has(node.id);
            const duplicatedTerm =
              (presentationCountByTerm.get(node.termId) ?? 0) > 1;
            const brandNodes = GRAPH_NODES.filter((n) => n.kind === "brand");
            const brandIndex = brandNodes.findIndex((n) => n.id === node.id);
            const watchNodesForBrand = activeBrand
              ? GRAPH_NODES.filter(
                  (n) =>
                    n.kind === "watch" &&
                    termMap.get(n.termId)?.parentIds.includes(activeBrand),
                )
              : [];
            const watchIndex = watchNodesForBrand.findIndex(
              (n) => n.id === node.id,
            );
            const isDivingParent =
              (audienceNode && activeAudience === term.id && !activeBrand) ||
              (brandNode && activeBrand === term.id);
            const isSiblingAudience =
              audienceNode &&
              activeAudience !== null &&
              activeAudience !== term.id &&
              !activeBrand;
            const isSiblingBrand =
              brandNode && activeBrand !== null && activeBrand !== term.id;
            const isSibling = isSiblingAudience || isSiblingBrand;
            const isWatchForActiveBrand =
              watchNode &&
              activeBrand !== null &&
              term.parentIds.includes(activeBrand);
            const isWatchHidden = watchNode && !isWatchForActiveBrand;
            const isEnteringBrand =
              brandNode && activeAudience !== null && !activeBrand;
            const isEnteringWatch = isWatchForActiveBrand;
            const brandCategories = (
              node as unknown as { categories?: string[] }
            ).categories as string[] | undefined;
            const isBrandMatchingGender =
              !brandNode ||
              activeGender === null ||
              (brandCategories ? brandCategories.includes(activeGender) : true);
            const isBrandFilteredOut =
              brandNode && activeGender !== null && !isBrandMatchingGender;
            const isConnectedPreview =
              brandNode &&
              previewNodeId !== null &&
              augmentedEdges.some(
                (edge) =>
                  (edge.fromId === previewNodeId && edge.toId === node.id) ||
                  (edge.toId === previewNodeId && edge.fromId === node.id),
              );

            if (activeGender && node.kind === "brand") {
              const isConnectedToClicked = augmentedEdges.some(
                (e) =>
                  (activeGender === "Men" &&
                    e.fromId === "men" &&
                    e.toId === node.id) ||
                  (activeGender === "Women" &&
                    e.fromId === "women" &&
                    e.toId === node.id),
              );

              if (!isConnectedToClicked) return null;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let initial: any = false;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let animate: any = {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let exit: any = {};

            if (reducedMotion) {
              initial = false;
              animate = { opacity: isWatchHidden ? 0 : 1, scale: 1 };
              exit = { opacity: 0 };
            } else {
              if (isDivingParent) {
                const divingScale = brandNode ? 2.4 : 1;
                initial = { scale: 1, opacity: 1 };
                animate = {
                  scale: divingScale,
                  opacity: 1,
                  transition: { duration: diveDuration, ease: diveEasing },
                };
                exit = {
                  scale: divingScale,
                  opacity: 1,
                  transition: {
                    duration: diveDuration,
                    ease: "easeInOut" as const,
                  },
                };
              } else if (isSibling) {
                const isBrandSiblingForActiveBrand =
                  brandNode && activeBrand !== null;
                initial = { scale: 1, opacity: 1 };
                animate = {
                  scale: 0.3,
                  opacity: isBrandSiblingForActiveBrand ? 0.05 : 0.15,
                  transition: {
                    duration: siblingDuration,
                    ease: "easeIn" as const,
                  },
                };
                exit = {
                  scale: 0.3,
                  opacity: isBrandSiblingForActiveBrand ? 0.05 : 0.15,
                  transition: {
                    duration: siblingDuration,
                    ease: "easeIn" as const,
                  },
                };
              } else if (isBrandFilteredOut) {
                initial = { scale: 1, opacity: 1 };
                animate = {
                  scale: 0.8,
                  opacity: 0.1,
                  transition: { duration: 0.3, ease: "easeInOut" as const },
                };
                exit = {
                  scale: 0.8,
                  opacity: 0.1,
                  transition: { duration: 0.3, ease: "easeInOut" as const },
                };
              } else if (isEnteringBrand) {
                initial = { scale: 0.2, opacity: 0 };
                animate = {
                  scale: 1,
                  opacity: 1,
                  transition: {
                    duration: childDuration,
                    ease: "easeInOut" as const,
                    delay: brandIndex * 0.07,
                  },
                };
                exit = {
                  scale: 0,
                  opacity: 0,
                  transition: { duration: 0.9, ease: "easeInOut" as const },
                };
              } else if (isEnteringWatch) {
                initial = { scale: 0.2, opacity: 0 };
                animate = {
                  scale: 1,
                  opacity: 1,
                  transition: {
                    duration: childDuration,
                    ease: "easeInOut" as const,
                    delay: watchIndex * 0.07,
                  },
                };
                exit = {
                  scale: 0,
                  opacity: 0,
                  transition: { duration: 0.9, ease: "easeInOut" as const },
                };
              } else {
                const isRestingBrand =
                  brandNode &&
                  activeAudience === null &&
                  activeBrand === null &&
                  activeGender === null;
                const isGenderActiveBrand =
                  brandNode && activeGender !== null && isBrandMatchingGender;
                initial = false;
                animate = {
                  scale: 1,
                  opacity: isRestingBrand
                    ? 0.15
                    : isGenderActiveBrand
                      ? 1
                      : isWatchHidden
                        ? 0
                        : 1,
                };
                exit = { scale: 0, opacity: 0 };
              }
            }
            void animate;

            let targetX = 50;
            let targetY = 50;
            let finalDesktopPos: { x: number; y: number } | null = null;
            let finalMobilePos: { x: number; y: number } | null = null;
            if (isDivingParent) {
              if (brandNode) {
                targetX = 25;
                targetY = 50;
              } else {
                targetX = 35;
                targetY = 48;
              }
              finalDesktopPos = { x: targetX, y: targetY };
              finalMobilePos = { x: targetX, y: targetY };
            } else if (isWatchForActiveBrand) {
              const tightRadius = 10;
              const angle =
                (watchIndex / Math.max(1, watchNodesForBrand.length)) *
                  Math.PI *
                  2 -
                Math.PI / 2;
              targetX = 25 + Math.cos(angle) * tightRadius;
              targetY = 50 + Math.sin(angle) * tightRadius;
              finalDesktopPos = { x: targetX, y: targetY };
              finalMobilePos = { x: targetX, y: targetY };
            } else {
              if (activeGender !== null) {
                if (
                  node.termId !== "men" &&
                  node.termId !== "women" &&
                  node.termId !== "watches"
                ) {
                  const brandsOnly = arr.filter(
                    (n) =>
                      n.termId !== "men" &&
                      n.termId !== "women" &&
                      n.termId !== "watches",
                  );
                  const bIndex = brandsOnly.findIndex((n) => n.id === node.id);
                  const validIndex = bIndex >= 0 ? bIndex : index;
                  const angle =
                    (validIndex / brandsOnly.length) * (2 * Math.PI) -
                    Math.PI / 2;
                  const radius = validIndex % 2 === 0 ? 25 : 40;
                  targetX = 50 + radius * Math.cos(angle);
                  targetY = 50 + radius * Math.sin(angle);
                }
              } else {
                const pos = gridJitterPosition(index, arr.length, node.id);
                targetX = pos.x;
                targetY = pos.y;
              }
              finalDesktopPos = { x: targetX, y: targetY };
              finalMobilePos = { x: targetX, y: targetY };
            }

            const style: NodeStyle = {
              "--node-x": `${finalDesktopPos.x}%`,
              "--node-y": `${finalDesktopPos.y}%`,
              "--node-mobile-x": `${finalMobilePos.x}%`,
              "--node-mobile-y": `${finalMobilePos.y}%`,
            };

            const activationLabel = enabled
              ? "open definition"
              : "choose a gender to unlock; focus or hover to preview connections";
            const duplicateLabel = duplicatedTerm
              ? `, ${node.id.includes("upper") ? "upper" : "lower"} network node`
              : "";

            const diveState = isDivingParent
              ? "diving"
              : isSibling
                ? "sibling"
                : isEnteringBrand || isEnteringWatch
                  ? "entering"
                  : "resting";

            return (
              <motion.button
                id={`node-${node.id}`}
                key={node.id}
                layout={
                  isDivingParent ||
                  isSibling ||
                  isEnteringBrand ||
                  isEnteringWatch
                }
                type="button"
                data-presentation-id={node.id}
                data-dive-state={diveState}
                data-level={levelKey}
                className={[
                  "atlas-node",
                  audienceNode
                    ? "atlas-node--audience"
                    : watchNode
                      ? "atlas-node--watch"
                      : "atlas-node--brand",
                  audienceNode ? `atlas-node--${term.id}` : "",
                  brandNode
                    ? // FIXED: Valid Tailwind syntax (! prefix) to force interactions and ultra-high z-index
                      "group !pointer-events-auto !cursor-pointer bg-white opacity-50 border border-gray-300/50 !z-[99999] transition-all duration-300 ease-out hover:!opacity-100 hover:!scale-110 hover:!border-[#D4AF37]/80 hover:!shadow-[0_0_20px_4px_rgba(212,175,55,0.8)]"
                    : "",
                  isConnectedPreview
                    ? "!opacity-100 !scale-110 !border-[#D4AF37] !shadow-[0_0_20px_4px_rgba(212,175,55,0.8)]"
                    : "",
                  enabled ? "is-enabled" : "is-locked",
                  selected ? "is-selected" : "",
                  audienceSelected ? "is-audience-selected" : "",
                  previewed ? "is-previewed" : "",
                  connected ? "is-connected" : "",
                  isDivingParent ? "is-diving" : "",
                  isSibling ? "is-sibling-exit" : "",
                  isEnteringBrand || isEnteringWatch ? "is-entering" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-disabled={!enabled}
                aria-pressed={audienceNode ? audienceSelected : undefined}
                aria-label={
                  audienceNode
                    ? `${term.nodeLabel}, activate ${term.term}`
                    : `${term.term}${duplicateLabel}, ${activationLabel}`
                }
                // FIXED: Instant navigation that stops the backdrop from stealing the click
                onPointerDown={(e) => {
                  if (brandNode) {
                    e.stopPropagation();
                  }
                }}
                onClick={(e) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  handleNodeClick(node, term, e as any);
                }}
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() =>
                  setHoveredNodeId((current) =>
                    current === node.id ? null : current,
                  )
                }
                onFocus={() => setFocusedNodeId(node.id)}
                onBlur={() =>
                  setFocusedNodeId((current) =>
                    current === node.id ? null : current,
                  )
                }
                initial={reducedMotion ? false : initial}
                animate={{
                  left: `${targetX}%`,
                  top: `${targetY}%`,
                  opacity:
                    node.id === "men" || node.id === "women"
                      ? 1
                      : isConnectedPreview
                        ? 1
                        : brandNode && activeGender === null
                          ? 0.5
                          : 1,
                }}
                exit={exit}
                transition={{
                  duration: 1.2,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
                style={{
                  ...style,
                  opacity:
                    node.id === "men" || node.id === "women" ? 1 : undefined,
                  // Ensure React inline styles also force pointer events
                  pointerEvents: brandNode
                    ? ("auto" as const)
                    : isSibling ||
                        (activeGender !== null && !isConnectedPreview)
                      ? "none"
                      : "auto",
                  zIndex: brandNode ? 99999 : undefined,
                }}
              >
                <div className="atlas-node__float">
                  {audienceNode ? (
                    <>
                      <span className="atlas-node__sphere" aria-hidden="true" />
                      <span className="atlas-node__label">
                        {term.nodeLabel}
                      </span>
                    </>
                  ) : brandNode && node.logo ? (
                    <>
                      <div
                        className="atlas-node__brand-logo-wrap"
                        style={{
                          backgroundColor: "#ffffff",
                          borderRadius: "50%",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={node.logo}
                          alt=""
                          className="atlas-node__logo"
                          decoding="async"
                          draggable={false}
                        />
                      </div>
                      <span
                        className={`atlas-node__label transition-all duration-200 ease-out pointer-events-none ${node.id === "men" || node.id === "women" || isConnectedPreview ? "opacity-100! translate-y-0!" : "opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"}`}
                      >
                        {
                          ((node as unknown as { name?: string }).name ||
                            node.id ||
                            term.nodeLabel ||
                            "Unknown Brand") as string
                        }
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="atlas-node__dot" aria-hidden="true" />
                      <span className="atlas-node__label">
                        {term.nodeLabel}
                      </span>
                    </>
                  )}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
