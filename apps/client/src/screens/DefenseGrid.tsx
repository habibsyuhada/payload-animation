import { getAccountTierConfig, getDefenseNodeCost, RULESET_V1, validateDefenseGraph, type BlockTier } from "@payload/sim";
import { useEffect, useRef, useState } from "react";
import { CORE_COLOR, CORE_SHAPE, ENTRY_COLOR, ENTRY_SHAPE, findPlaceableEntry, PLACEABLE_NODE_CATALOG, type NodeShape } from "../data/defenseNodeCatalog.js";
import { theme } from "../theme.js";
import { CORE_ID, toDefenseGraph, useDefenseGridStore, type GridNode } from "../state/defenseGridStore.js";
import { Screen } from "./Screen.js";

/** No account-tier system yet (Fase 4/5) — Defense Grid always validates against tier 1, same placeholder Virus Lab uses. */
const ACCOUNT_TIER = 1;
const TIER_CONFIG = getAccountTierConfig(RULESET_V1, ACCOUNT_TIER);
const TIER_OPTIONS: readonly BlockTier[] = [1, 2, 3];
const DRAG_THRESHOLD_PX = 4;
const VIEWBOX_WIDTH = 560;
const VIEWBOX_HEIGHT = 500;
/** Converts a wheel `deltaY` into a multiplicative zoom step: negative deltaY (scroll/pinch out)
 * zooms in, positive zooms out. Exponential rather than linear so equal-magnitude scroll ticks
 * feel like equal-magnitude zoom steps at any zoom level, not just near 1x. */
function zoomFactorFromWheelDelta(deltaY: number): number {
  return Math.exp(-deltaY * 0.001);
}

function nodeColor(node: GridNode): string {
  if (node.type === "core") return CORE_COLOR;
  if (node.type === "entry") return ENTRY_COLOR;
  return findPlaceableEntry(node.type).color;
}

function nodeShapeOf(node: GridNode): NodeShape {
  if (node.type === "core") return CORE_SHAPE;
  if (node.type === "entry") return ENTRY_SHAPE;
  return findPlaceableEntry(node.type).shape;
}

function nodeRadius(node: GridNode): number {
  return node.type === "core" ? 22 : node.type === "entry" ? 12 : 14;
}

function nodeCost(node: GridNode): number {
  return getDefenseNodeCost(node.type, node.tier);
}

/** Vertices of a regular polygon centered at (cx,cy) — `rotationDeg` of 0 puts the first vertex
 * due right (standard math angle convention); e.g. -90 puts it pointing straight up. */
function regularPolygonPoints(cx: number, cy: number, r: number, sides: number, rotationDeg: number): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

/** Vertices of a `spikes`-pointed star, alternating between `outerR` and `innerR`. */
function starPoints(cx: number, cy: number, outerR: number, innerR: number, spikes: number, rotationDeg: number): string {
  const step = 360 / (spikes * 2);
  const points: string[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = ((rotationDeg + step * i) * Math.PI) / 180;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

/** Renders a node's silhouette — distinct per type (see NodeShape) so nodes read apart by shape,
 * not just fill color: Core is a diamond, Entry a triangle, and each placeable type below gets
 * its own polygon (Router stays a plain circle — the untiered, "default" node). */
function NodeGlyph({ shape, cx, cy, r, fill, stroke, strokeWidth }: { shape: NodeShape; cx: number; cy: number; r: number; fill: string; stroke: string; strokeWidth: number }): JSX.Element {
  const common = { fill, stroke, strokeWidth };
  switch (shape) {
    case "diamond":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.15, 4, -90)} {...common} />;
    case "triangle":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.2, 3, 0)} {...common} />;
    case "triangle-down":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.2, 3, 90)} {...common} />;
    case "square": {
      const half = r * 0.85;
      return <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2} rx={3} {...common} />;
    }
    case "hexagon":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.05, 6, -90)} {...common} />;
    case "octagon":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.05, 8, -67.5)} {...common} />;
    case "star":
      return <polygon points={starPoints(cx, cy, r * 1.3, r * 0.55, 6, -90)} {...common} />;
    case "circle":
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}

interface DragState {
  readonly id: number;
  readonly pointerStartX: number;
  readonly pointerStartY: number;
  readonly nodeStartX: number;
  readonly nodeStartY: number;
  moved: boolean;
}

interface PanDragState {
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startPanX: number;
  readonly startPanY: number;
  moved: boolean;
}

export function DefenseGrid(): JSX.Element {
  const nodes = useDefenseGridStore((state) => state.nodes);
  const edges = useDefenseGridStore((state) => state.edges);
  const activeTool = useDefenseGridStore((state) => state.activeTool);
  const pendingPlacementType = useDefenseGridStore((state) => state.pendingPlacementType);
  const pendingPlacementTier = useDefenseGridStore((state) => state.pendingPlacementTier);
  const selectedForEdgeId = useDefenseGridStore((state) => state.selectedForEdgeId);
  const zoom = useDefenseGridStore((state) => state.zoom);
  const panX = useDefenseGridStore((state) => state.panX);
  const panY = useDefenseGridStore((state) => state.panY);
  const setActiveTool = useDefenseGridStore((state) => state.setActiveTool);
  const armNodeType = useDefenseGridStore((state) => state.armNodeType);
  const setPendingPlacementTier = useDefenseGridStore((state) => state.setPendingPlacementTier);
  const placeNodeAt = useDefenseGridStore((state) => state.placeNodeAt);
  const moveNode = useDefenseGridStore((state) => state.moveNode);
  const removeNode = useDefenseGridStore((state) => state.removeNode);
  const tapNodeForEdge = useDefenseGridStore((state) => state.tapNodeForEdge);
  const setPan = useDefenseGridStore((state) => state.setPan);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panDragRef = useRef<PanDragState | null>(null);
  const [savedGraphJson, setSavedGraphJson] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isNodeModalOpen, setNodeModalOpen] = useState(false);

  /** Mouse-wheel / trackpad-pinch zoom, centered on nothing fancier than "zoom in place" (GDD
   * doesn't call for cursor-anchored zoom). Wired via a native, non-passive listener rather than
   * React's onWheel — React attaches wheel listeners passively by default, so `preventDefault()`
   * inside a React handler would silently fail to stop the page itself from scrolling underneath
   * the canvas while the player zooms. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const store = useDefenseGridStore.getState();
      store.setZoom(store.zoom * zoomFactorFromWheelDelta(event.deltaY));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    if (!isNodeModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setNodeModalOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isNodeModalOpen]);

  const totalCost = nodes.reduce((sum, node) => sum + nodeCost(node), 0);
  const overBudget = totalCost > TIER_CONFIG.defenseBudgetPoints;
  const defenseGraph = toDefenseGraph({ nodes, edges }, TIER_CONFIG.coreHp);
  const validation = validateDefenseGraph(defenseGraph, RULESET_V1, ACCOUNT_TIER);

  /** The SVG's actual rendered pixel box (fluid width, fluid height) is very unlikely to equal
   * VIEWBOX_WIDTH x VIEWBOX_HEIGHT 1:1 — client coordinates have to go through this ratio before
   * the `zoom` factor (which scales *within* the viewBox's own coordinate space, via the inner
   * `<g transform="scale(zoom) translate(...)">`) applies, or every click/drag lands off by the
   * render/viewBox size mismatch. `preserveAspectRatio="none"` on the <svg> keeps this a simple
   * per-axis ratio (no aspect-fit letterboxing offset to account for too). */
  function clientDeltaToSvgUnits(clientDx: number, clientDy: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (clientDx * (VIEWBOX_WIDTH / rect.width)) / zoom, y: (clientDy * (VIEWBOX_HEIGHT / rect.height)) / zoom };
  }

  /** Converts a screen point to a *world* point (the same DU space as node x/y) — the inverse of
   * the canvas's own render transform `scale(zoom) translate(-panX, -panY)`: a world point p
   * renders on screen at zoom*(p - pan), so screen point v is world point v/zoom + pan. */
  function clientToSvgPoint(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const { x: dx, y: dy } = clientDeltaToSvgUnits(clientX - rect.left, clientY - rect.top);
    return { x: dx + panX, y: dy + panY };
  }

  function handleBackgroundClick(event: React.MouseEvent<SVGSVGElement>): void {
    if (!pendingPlacementType || event.target !== svgRef.current) {
      return;
    }
    const point = clientToSvgPoint(event.clientX, event.clientY);
    placeNodeAt(Math.round(point.x), Math.round(point.y));
  }

  /** Panning the camera works no matter which tool is active — a Hand-tool-only restriction would
   * mean switching tools just to look around, which defeats the point of a persistent camera. Only
   * genuine background presses start it (a press on a node never reaches here: node pointerdown
   * always stops propagation, tool-gated or not — see handleNodePointerDown). */
  function handleBackgroundPointerDown(event: React.PointerEvent<SVGSVGElement>): void {
    if (event.target !== svgRef.current) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic PointerEvent in tests, or an already-released capture — panning still tracks via
      // the pointermove/pointerup listeners below, capture is just an extra reliability layer.
    }
    panDragRef.current = { startClientX: event.clientX, startClientY: event.clientY, startPanX: panX, startPanY: panY, moved: false };
    setIsPanning(true);
  }

  function handleBackgroundPointerUp(event: React.PointerEvent<SVGSVGElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panDragRef.current = null;
    setIsPanning(false);
  }

  /** Node dragging (repositioning) is a Hand-tool-only gesture — under Line, a press-and-move on a
   * node must stay a clean tap-to-link (see handleNodePointerUp) instead of relocating it, and
   * under Node it's irrelevant (tapping an existing node while armed doesn't place on top of it —
   * handleBackgroundClick already requires the *background* itself as the click target). */
  function handleNodePointerDown(node: GridNode, event: React.PointerEvent<SVGGElement>): void {
    event.stopPropagation();
    if (activeTool !== "hand") {
      return;
    }
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      // No real active pointer session to capture (e.g. a synthetically dispatched PointerEvent
      // in tests, or a browser that's already released it) — dragging still works via the
      // pointermove/pointerup listeners below, capture is just an extra reliability layer.
    }
    dragRef.current = { id: node.id, pointerStartX: event.clientX, pointerStartY: event.clientY, nodeStartX: node.x, nodeStartY: node.y, moved: false };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>): void {
    const drag = dragRef.current;
    if (drag) {
      const node = nodes.find((candidate) => candidate.id === drag.id);
      if (!node || node.fixed) return;
      const { x: dx, y: dy } = clientDeltaToSvgUnits(event.clientX - drag.pointerStartX, event.clientY - drag.pointerStartY);
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      drag.moved = true;
      moveNode(drag.id, Math.round(drag.nodeStartX + dx), Math.round(drag.nodeStartY + dy));
      return;
    }

    const pan = panDragRef.current;
    if (!pan) return;
    const { x: dx, y: dy } = clientDeltaToSvgUnits(event.clientX - pan.startClientX, event.clientY - pan.startClientY);
    if (!pan.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }
    pan.moved = true;
    // Grab-and-drag semantics (like dragging a node): moving the pointer right should reveal
    // content that was off-screen to the left, so the camera itself moves left — pan decreases.
    setPan(pan.startPanX - dx, pan.startPanY - dy);
  }

  function handleNodePointerUp(node: GridNode, event: React.PointerEvent<SVGGElement>): void {
    const target = event.target as Element;
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    if (activeTool === "line") {
      tapNodeForEdge(node.id);
      return;
    }
    // Hand tool: dragging already relocated the node live in handlePointerMove — a clean
    // (non-drag) tap on Hand has no separate effect, unlike the old always-on tap-to-link.
    dragRef.current = null;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const armedEntry = pendingPlacementType ? findPlaceableEntry(pendingPlacementType) : null;

  return (
    <Screen title="Defense Grid" fullBleed>
      <div className="payload-grid-editor">
        <div className="payload-grid-toolbar" data-testid="toolbar" role="toolbar" aria-label="Tool grid">
          <button
            type="button"
            data-testid="tool-hand"
            aria-pressed={activeTool === "hand"}
            className={`payload-tool-btn${activeTool === "hand" ? " payload-tool-btn--active" : ""}`}
            title="Hand — geser kamera & pindah node"
            onClick={() => setActiveTool("hand")}
          >
            🖐️
          </button>
          <button
            type="button"
            data-testid="tool-line"
            aria-pressed={activeTool === "line"}
            className={`payload-tool-btn${activeTool === "line" ? " payload-tool-btn--active" : ""}`}
            title="Garis — hubungkan / putuskan node"
            onClick={() => setActiveTool("line")}
          >
            🔗
          </button>
          <button
            type="button"
            data-testid="tool-node"
            aria-pressed={activeTool === "node"}
            className={`payload-tool-btn${activeTool === "node" ? " payload-tool-btn--active" : ""}`}
            title="Tambah node"
            onClick={() => setNodeModalOpen(true)}
          >
            ➕
          </button>
        </div>

        {activeTool === "line" && (
          <p className="payload-tool-hint" data-testid="line-hint">
            Tap 2 node untuk menghubungkan atau memutus.
          </p>
        )}

        {activeTool === "node" && armedEntry && (
          <div className="payload-armed-strip" data-testid="armed-strip">
            <span className="payload-armed-swatch" style={{ background: armedEntry.color }} />
            <span>{armedEntry.label}</span>
            {armedEntry.tiered && (
              <select data-testid="pending-tier-select" value={pendingPlacementTier} onChange={(event) => setPendingPlacementTier(Number(event.target.value) as BlockTier)}>
                {TIER_OPTIONS.map((tier) => (
                  <option key={tier} value={tier}>
                    Tier {tier}
                  </option>
                ))}
              </select>
            )}
            <span data-testid="placement-hint" className="payload-armed-hint">
              Tap grid untuk menempatkan.
            </span>
          </div>
        )}

        <div className="payload-grid-canvas-wrap">
          <svg
            ref={svgRef}
            data-testid="grid-canvas"
            className={activeTool === "node" && pendingPlacementType ? "payload-grid-canvas payload-grid-canvas--armed" : "payload-grid-canvas"}
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            width="100%"
            height="100%"
            style={{ background: theme.backgroundPanel, cursor: activeTool === "node" && pendingPlacementType ? "crosshair" : activeTool === "line" ? "pointer" : isPanning ? "grabbing" : "grab", touchAction: "none" }}
            onClick={handleBackgroundClick}
            onPointerDown={handleBackgroundPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handleBackgroundPointerUp}
          >
            <g transform={`scale(${zoom}) translate(${-panX} ${-panY})`}>
              {edges.map((edge) => {
                const from = nodesById.get(edge.from);
                const to = nodesById.get(edge.to);
                if (!from || !to) return null;
                return <line key={`${edge.from}-${edge.to}`} data-testid="grid-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={theme.border} strokeWidth={2} />;
              })}
              {nodes.map((node) => (
                <g
                  key={node.id}
                  data-testid="grid-node"
                  data-node-type={node.type}
                  data-node-id={node.id}
                  data-node-x={node.x}
                  data-node-y={node.y}
                  onPointerDown={(event) => handleNodePointerDown(node, event)}
                  onPointerUp={(event) => handleNodePointerUp(node, event)}
                  style={{ cursor: activeTool === "line" ? "pointer" : node.fixed ? "default" : "grab" }}
                >
                  <NodeGlyph shape={nodeShapeOf(node)} cx={node.x} cy={node.y} r={nodeRadius(node)} fill={nodeColor(node)} stroke={selectedForEdgeId === node.id ? theme.text : "none"} strokeWidth={3} />
                  {!node.fixed && (
                    <text data-testid="grid-node-remove" x={node.x + nodeRadius(node)} y={node.y - nodeRadius(node)} fontSize={14} fill={theme.faction.attack} onClick={(event) => { event.stopPropagation(); removeNode(node.id); }} style={{ cursor: "pointer" }}>
                      ✕
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
          <div className="payload-zoom-badge" data-testid="zoom-level">
            {Math.round(zoom * 100)}%
          </div>
        </div>

        <div className="payload-grid-hud">
          <section data-testid="budget-bar" className="payload-grid-hud-item">
            <p data-testid="defense-budget-text" style={overBudget ? { color: theme.faction.attack } : undefined}>
              {totalCost} / {TIER_CONFIG.defenseBudgetPoints} pt{overBudget ? " — melebihi budget!" : ""}
            </p>
          </section>

          <section data-testid="validation-panel" className="payload-grid-hud-item">
            {validation.valid ? (
              <p data-testid="validation-status">Valid — siap disimpan.</p>
            ) : (
              <ul data-testid="validation-errors" className="payload-grid-hud-errors">
                {validation.errors.map((error, index) => (
                  <li key={index} data-testid="validation-error">
                    {error.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button type="button" data-testid="save-defense" className="payload-btn-primary" disabled={!validation.valid} onClick={() => setSavedGraphJson(JSON.stringify(defenseGraph))}>
            Simpan
          </button>
        </div>
        {savedGraphJson && (
          <p className="payload-save-confirmation" data-testid="save-confirmation">
            Tersimpan (lokal, {nodes.length} node, {edges.length} edge, Core id {CORE_ID}).
          </p>
        )}
      </div>

      {isNodeModalOpen && (
        <div className="payload-modal-backdrop" data-testid="node-modal-backdrop" onClick={() => setNodeModalOpen(false)}>
          <div className="payload-modal" role="dialog" aria-label="Pilih node" data-testid="node-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Pilih Node</h2>
            <div className="payload-modal-grid">
              {PLACEABLE_NODE_CATALOG.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  data-testid="node-modal-entry"
                  className="payload-modal-card"
                  style={{ borderColor: entry.color }}
                  onClick={() => {
                    armNodeType(entry.type);
                    setNodeModalOpen(false);
                  }}
                >
                  <svg className="payload-modal-card-glyph" viewBox="0 0 40 40" aria-hidden="true">
                    <NodeGlyph shape={entry.shape} cx={20} cy={20} r={14} fill={entry.color} stroke="none" strokeWidth={0} />
                  </svg>
                  <span>{entry.label}</span>
                  <small>{getDefenseNodeCost(entry.type, entry.tiered ? 1 : undefined)}pt+</small>
                </button>
              ))}
            </div>
            <button type="button" data-testid="node-modal-close" onClick={() => setNodeModalOpen(false)}>
              Batal
            </button>
          </div>
        </div>
      )}
    </Screen>
  );
}
