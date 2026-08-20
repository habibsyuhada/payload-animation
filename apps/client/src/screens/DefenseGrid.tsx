import { getAccountTierConfig, getDefenseNodeCost, RULESET_V1, validateDefenseGraph, type BlockTier } from "@payload/sim";
import { useEffect, useRef, useState } from "react";
import { CORE_COLOR, ENTRY_COLOR, findPlaceableEntry, PLACEABLE_NODE_CATALOG } from "../data/defenseNodeCatalog.js";
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

function nodeRadius(node: GridNode): number {
  return node.type === "core" ? 22 : node.type === "entry" ? 12 : 14;
}

function nodeCost(node: GridNode): number {
  return getDefenseNodeCost(node.type, node.tier);
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

/** Tracks a palette button's own pointer session across the drag: whether that node type was
 * already armed *before* this press started, so pointerup can tell "drag onto the canvas" (place
 * immediately) apart from "a plain tap that should toggle arming" (see the palette button's
 * onPointerDown/onPointerUp below) without the two paths fighting over pendingPlacementType. */
interface PaletteDragState {
  readonly wasArmedForThisType: boolean;
}

export function DefenseGrid(): JSX.Element {
  const nodes = useDefenseGridStore((state) => state.nodes);
  const edges = useDefenseGridStore((state) => state.edges);
  const pendingPlacementType = useDefenseGridStore((state) => state.pendingPlacementType);
  const pendingPlacementTier = useDefenseGridStore((state) => state.pendingPlacementTier);
  const selectedForEdgeId = useDefenseGridStore((state) => state.selectedForEdgeId);
  const zoom = useDefenseGridStore((state) => state.zoom);
  const panX = useDefenseGridStore((state) => state.panX);
  const panY = useDefenseGridStore((state) => state.panY);
  const setPendingPlacement = useDefenseGridStore((state) => state.setPendingPlacement);
  const setPendingPlacementTier = useDefenseGridStore((state) => state.setPendingPlacementTier);
  const placeNodeAt = useDefenseGridStore((state) => state.placeNodeAt);
  const moveNode = useDefenseGridStore((state) => state.moveNode);
  const removeNode = useDefenseGridStore((state) => state.removeNode);
  const tapNodeForEdge = useDefenseGridStore((state) => state.tapNodeForEdge);
  const setPan = useDefenseGridStore((state) => state.setPan);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panDragRef = useRef<PanDragState | null>(null);
  const paletteDragRef = useRef<PaletteDragState | null>(null);
  const [savedGraphJson, setSavedGraphJson] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

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

  const totalCost = nodes.reduce((sum, node) => sum + nodeCost(node), 0);
  const overBudget = totalCost > TIER_CONFIG.defenseBudgetPoints;
  const defenseGraph = toDefenseGraph({ nodes, edges }, TIER_CONFIG.coreHp);
  const validation = validateDefenseGraph(defenseGraph, RULESET_V1, ACCOUNT_TIER);

  /** The SVG's actual rendered pixel box (fluid width, fixed height) is very unlikely to equal
   * VIEWBOX_WIDTH x VIEWBOX_HEIGHT 1:1 — client coordinates have to go through this ratio before
   * the `zoom` factor (which scales *within* the viewBox's own coordinate space, via the inner
   * `<g transform="scale(zoom)">`) applies, or every click/drag lands off by the render/viewBox
   * size mismatch. `preserveAspectRatio="none"` on the <svg> keeps this a simple per-axis ratio
   * (no aspect-fit letterboxing offset to account for too). */
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

  function isPointOverCanvas(clientX: number, clientY: number): boolean {
    const svg = svgRef.current;
    if (!svg) return false;
    const rect = svg.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function handleBackgroundClick(event: React.MouseEvent<SVGSVGElement>): void {
    if (!pendingPlacementType || event.target !== svgRef.current) {
      return;
    }
    const point = clientToSvgPoint(event.clientX, event.clientY);
    placeNodeAt(Math.round(point.x), Math.round(point.y));
  }

  /** Starts panning the camera when the player presses down on empty canvas background (not a
   * node, not while a node type is armed for placement — that keeps the existing tap-to-place
   * flow exactly as it was). Shares handlePointerMove/its DRAG_THRESHOLD_PX below with node
   * dragging so a plain tap still reaches handleBackgroundClick's placement/tapNodeForEdge paths
   * undisturbed. */
  function handleBackgroundPointerDown(event: React.PointerEvent<SVGSVGElement>): void {
    if (pendingPlacementType || event.target !== svgRef.current) {
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

  function handleNodePointerDown(node: GridNode, event: React.PointerEvent<SVGGElement>): void {
    if (pendingPlacementType) {
      return;
    }
    event.stopPropagation();
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
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.id !== node.id) return;
    if (!drag.moved) {
      tapNodeForEdge(node.id);
    }
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <Screen title="Defense Grid">
      <section data-testid="palette">
        <h2>Tambah Node</h2>
        <p className="payload-screen-hint">Seret node ke grid, atau klik lalu tap area kosong.</p>
        {PLACEABLE_NODE_CATALOG.map((entry) => (
          <button
            key={entry.type}
            type="button"
            data-testid="palette-node"
            className="payload-palette-block"
            aria-pressed={pendingPlacementType === entry.type}
            style={{ borderColor: entry.color }}
            onPointerDown={(event) => {
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Synthetic PointerEvent in tests — pointerup below still fires on this element.
              }
              paletteDragRef.current = { wasArmedForThisType: pendingPlacementType === entry.type };
              setPendingPlacement(entry.type);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              const dragState = paletteDragRef.current;
              paletteDragRef.current = null;
              if (isPointOverCanvas(event.clientX, event.clientY)) {
                // Released over the grid — treat the whole press as a drag-and-drop placement.
                const point = clientToSvgPoint(event.clientX, event.clientY);
                placeNodeAt(Math.round(point.x), Math.round(point.y));
              } else if (dragState?.wasArmedForThisType) {
                // A plain tap on an already-armed type disarms it (toggle-off), matching the old
                // click behavior. A tap that newly armed it leaves it armed, waiting for a tap on
                // the grid — the click-to-place fallback.
                setPendingPlacement(null);
              }
            }}
            onClick={(event) => {
              // Keyboard activation (Enter/Space) fires "click" with no pointer event behind it
              // (detail === 0) — pointerdown/up above already handles every real mouse/touch/pen
              // press, so only keyboard needs this fallback toggle.
              if (event.detail !== 0) return;
              setPendingPlacement(pendingPlacementType === entry.type ? null : entry.type);
            }}
          >
            {entry.label} ({getDefenseNodeCost(entry.type, entry.tiered ? 1 : undefined)}pt+)
          </button>
        ))}
        {pendingPlacementType && findPlaceableEntry(pendingPlacementType).tiered && (
          <select data-testid="pending-tier-select" value={pendingPlacementTier} onChange={(event) => setPendingPlacementTier(Number(event.target.value) as BlockTier)}>
            {TIER_OPTIONS.map((tier) => (
              <option key={tier} value={tier}>
                Tier {tier}
              </option>
            ))}
          </select>
        )}
        {pendingPlacementType && <p data-testid="placement-hint">Lepaskan di grid, atau tap area kosong, untuk menempatkan {findPlaceableEntry(pendingPlacementType).label}.</p>}
      </section>

      <div className="payload-grid-canvas-wrap">
        <svg
          ref={svgRef}
          data-testid="grid-canvas"
          className={pendingPlacementType ? "payload-grid-canvas payload-grid-canvas--armed" : "payload-grid-canvas"}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height="420"
          style={{ background: theme.backgroundPanel, cursor: pendingPlacementType ? "crosshair" : isPanning ? "grabbing" : "grab", touchAction: "none" }}
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
                onPointerDown={(event) => handleNodePointerDown(node, event)}
                onPointerUp={(event) => handleNodePointerUp(node, event)}
                style={{ cursor: node.fixed ? "default" : "grab" }}
              >
                <circle cx={node.x} cy={node.y} r={nodeRadius(node)} fill={nodeColor(node)} stroke={selectedForEdgeId === node.id ? theme.text : "none"} strokeWidth={3} />
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

      <section data-testid="budget-bar">
        <h2>Defense Budget</h2>
        <p data-testid="defense-budget-text" style={overBudget ? { color: theme.faction.attack } : undefined}>
          {totalCost} / {TIER_CONFIG.defenseBudgetPoints} pt{overBudget ? " — melebihi budget!" : ""}
        </p>
      </section>

      <section data-testid="validation-panel">
        <h2>Validasi</h2>
        {validation.valid ? (
          <p data-testid="validation-status">Topologi valid — siap disimpan.</p>
        ) : (
          <ul data-testid="validation-errors">
            {validation.errors.map((error, index) => (
              <li key={index} data-testid="validation-error">
                {error.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" data-testid="save-defense" className="payload-btn-primary" disabled={!validation.valid} onClick={() => setSavedGraphJson(JSON.stringify(defenseGraph))}>
        Simpan Topologi
      </button>
      {savedGraphJson && <p data-testid="save-confirmation">Tersimpan (lokal, {nodes.length} node, {edges.length} edge, Core id {CORE_ID}).</p>}
    </Screen>
  );
}
