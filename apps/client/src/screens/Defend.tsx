import { getDefenseNodeCost } from "@payload/sim";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NodeGlyph } from "../components/NodeGlyph.js";
import {
  CORE_COLOR,
  CORE_DESCRIPTION,
  CORE_SHAPE,
  ENTRY_COLOR,
  ENTRY_DESCRIPTION,
  ENTRY_SHAPE,
  findNodeTierDescription,
  findPlaceableEntry,
  type NodeShape,
} from "../data/defenseNodeCatalog.js";
import { isRemovable, useDefendStore, type DefendNode, type WorldBounds } from "../state/defendStore.js";
import { theme } from "../theme.js";

/** Raw CSS-pixel movement below which a press-and-release still counts as a tap, not a drag. */
const DRAG_THRESHOLD_PX = 6;
/** Spacing (screen px) between a node's silhouette and the action buttons that pop up under it. */
const ACTION_BAR_GAP_PX = 12;
/** How close to the viewport edge the action bar is allowed to get. */
const EDGE_MARGIN_PX = 8;
/** World-space size of one background grid cell — drawn via an SVG pattern so it pans and zooms
 * with the camera, giving the eye something to track while dragging an otherwise empty canvas. */
const GRID_CELL_DU = 40;

function zoomFactorFromWheelDelta(deltaY: number): number {
  return Math.exp(-deltaY * 0.001);
}

function nodeColor(node: DefendNode): string {
  if (node.type === "core") return CORE_COLOR;
  if (node.type === "entry") return ENTRY_COLOR;
  return findPlaceableEntry(node.type).color;
}

function nodeShapeOf(node: DefendNode): NodeShape {
  if (node.type === "core") return CORE_SHAPE;
  if (node.type === "entry") return ENTRY_SHAPE;
  return findPlaceableEntry(node.type).shape;
}

/** World-space radius. Bigger than Defense Grid's equivalents: this page is built for a thumb on
 * a phone, so every node has to stay a comfortable tap target at the default zoom. */
function nodeRadius(node: DefendNode): number {
  if (node.type === "core") return 34;
  if (node.type === "entry") return 26;
  return 24;
}

function nodeLabel(node: DefendNode): string {
  if (node.type === "core") return "Core";
  if (node.type === "entry") return "Entry";
  return findPlaceableEntry(node.type).label;
}

function nodeDescription(node: DefendNode): string {
  if (node.type === "core") return CORE_DESCRIPTION;
  if (node.type === "entry") return ENTRY_DESCRIPTION;
  return findNodeTierDescription(findPlaceableEntry(node.type), node.tier);
}

/** The world rectangle every node's silhouette fits inside — what the opening camera frames. */
function worldBoundsOf(nodes: readonly DefendNode[]): WorldBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return {
    minX: Math.min(...nodes.map((node) => node.x - nodeRadius(node))),
    minY: Math.min(...nodes.map((node) => node.y - nodeRadius(node))),
    maxX: Math.max(...nodes.map((node) => node.x + nodeRadius(node))),
    maxY: Math.max(...nodes.map((node) => node.y + nodeRadius(node))),
  };
}

/** Where the action bar sits: centered under the node, flipped above it when the node is near the
 * bottom edge, and always kept fully inside the viewport so a node parked against the right edge
 * doesn't push its own buttons off-screen. */
function actionBarPositionFor(
  node: DefendNode,
  camera: { zoom: number; offsetX: number; offsetY: number },
  viewport: { width: number; height: number },
  bar: { width: number; height: number },
): { left: number; top: number } {
  const screenX = node.x * camera.zoom + camera.offsetX;
  const screenY = node.y * camera.zoom + camera.offsetY;
  const radius = nodeRadius(node) * camera.zoom;
  let top = screenY + radius + ACTION_BAR_GAP_PX;
  if (viewport.height > 0 && bar.height > 0 && top + bar.height > viewport.height - EDGE_MARGIN_PX) {
    top = screenY - radius - ACTION_BAR_GAP_PX - bar.height;
  }
  let left = screenX;
  if (viewport.width > 0 && bar.width > 0) {
    const half = bar.width / 2;
    left = Math.min(Math.max(screenX, half + EDGE_MARGIN_PX), Math.max(half + EDGE_MARGIN_PX, viewport.width - half - EDGE_MARGIN_PX));
  }
  return { left, top };
}

interface NodeDragState {
  readonly id: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly nodeStartX: number;
  readonly nodeStartY: number;
}

interface CameraGestureState {
  /** Last seen client position per active background pointer, keyed by pointerId — one entry is a
   * one-finger pan, two are a pinch (zoom around the midpoint + pan by how the midpoint moved). */
  readonly pointers: Map<number, { x: number; y: number }>;
  moved: boolean;
}

export function Defend(): JSX.Element {
  const nodes = useDefendStore((state) => state.nodes);
  const zoom = useDefendStore((state) => state.zoom);
  const offsetX = useDefendStore((state) => state.offsetX);
  const offsetY = useDefendStore((state) => state.offsetY);
  const selectedNodeId = useDefendStore((state) => state.selectedNodeId);
  const detailNodeId = useDefendStore((state) => state.detailNodeId);
  const selectNode = useDefendStore((state) => state.selectNode);
  const clearSelection = useDefendStore((state) => state.clearSelection);
  const openDetail = useDefendStore((state) => state.openDetail);
  const closeDetail = useDefendStore((state) => state.closeDetail);
  const moveNode = useDefendStore((state) => state.moveNode);
  const removeNode = useDefendStore((state) => state.removeNode);

  const wrapRef = useRef<HTMLDivElement>(null);
  const actionBarRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<CameraGestureState>({ pointers: new Map(), moved: false });
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const nodeTapRef = useRef<{ id: number; clientX: number; clientY: number } | null>(null);
  const didFitRef = useRef(false);
  const [isDraggingNode, setDraggingNode] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [actionBarSize, setActionBarSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const apply = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return;
      setViewportSize({ width, height });
      // Frame the whole graph on first layout only: a later resize (rotating the phone, the
      // browser chrome collapsing) must not yank the camera back from wherever it's been panned.
      if (!didFitRef.current) {
        didFitRef.current = true;
        useDefendStore.getState().fitToBounds(worldBoundsOf(useDefendStore.getState().nodes), width, height);
      }
    };
    const rect = wrap.getBoundingClientRect();
    apply(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) apply(box.width, box.height);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /** The bar's own size decides how far it has to be nudged back from a viewport edge — measured
   * rather than assumed because it has two buttons on Entry/Core and three on every other node.
   * Layout effect, so the corrected position is the first one painted. */
  useLayoutEffect(() => {
    const bar = actionBarRef.current;
    setActionBarSize(bar ? { width: bar.offsetWidth, height: bar.offsetHeight } : { width: 0, height: 0 });
  }, [selectedNodeId]);

  /** Wheel/trackpad zoom, anchored on the cursor. Wired as a native non-passive listener rather
   * than React's onWheel: React attaches wheel listeners passively, so preventDefault() inside a
   * React handler silently fails and the page scrolls underneath the canvas while zooming. */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      useDefendStore.getState().zoomAtPoint(zoomFactorFromWheelDelta(event.deltaY), event.clientX - rect.left, event.clientY - rect.top);
    };
    wrap.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    if (detailNodeId === null) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detailNodeId, closeDetail]);

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    const camera = cameraRef.current;
    camera.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    camera.moved = false;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = nodeDragRef.current;
    if (drag) {
      const dx = (event.clientX - drag.startClientX) / zoom;
      const dy = (event.clientY - drag.startClientY) / zoom;
      moveNode(drag.id, Math.round(drag.nodeStartX + dx), Math.round(drag.nodeStartY + dy));
      return;
    }

    const camera = cameraRef.current;
    const previous = camera.pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    const store = useDefendStore.getState();

    if (camera.pointers.size === 1) {
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      if (!camera.moved && Math.hypot(current.x - previous.x, current.y - previous.y) < DRAG_THRESHOLD_PX) {
        // Below the threshold the press is still a candidate tap — don't consume it as a pan, and
        // don't update `previous` either, so the jitter can't accumulate into a drift.
        return;
      }
      camera.moved = true;
      camera.pointers.set(event.pointerId, current);
      store.panBy(dx, dy);
      return;
    }

    // Two or more fingers down: pinch. Measured between the first two, which are the two the
    // player is actually pinching with — a third stray finger just rides along.
    const [idA, idB] = [...camera.pointers.keys()];
    if (idA === undefined || idB === undefined) return;
    const beforeA = camera.pointers.get(idA)!;
    const beforeB = camera.pointers.get(idB)!;
    camera.pointers.set(event.pointerId, current);
    const afterA = camera.pointers.get(idA)!;
    const afterB = camera.pointers.get(idB)!;
    camera.moved = true;

    const beforeDistance = Math.hypot(beforeA.x - beforeB.x, beforeA.y - beforeB.y);
    const afterDistance = Math.hypot(afterA.x - afterB.x, afterA.y - afterB.y);
    const rect = event.currentTarget.getBoundingClientRect();
    const midpointX = (afterA.x + afterB.x) / 2 - rect.left;
    const midpointY = (afterA.y + afterB.y) / 2 - rect.top;
    if (beforeDistance > 0 && afterDistance > 0) {
      store.zoomAtPoint(afterDistance / beforeDistance, midpointX, midpointY);
    }
    store.panBy((afterA.x + afterB.x) / 2 - (beforeA.x + beforeB.x) / 2, (afterA.y + afterB.y) / 2 - (beforeA.y + beforeB.y) / 2);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (nodeDragRef.current) {
      nodeDragRef.current = null;
      setDraggingNode(false);
      cameraRef.current.pointers.delete(event.pointerId);
      return;
    }

    const tap = nodeTapRef.current;
    nodeTapRef.current = null;
    const camera = cameraRef.current;
    const hadPointer = camera.pointers.delete(event.pointerId);
    if (tap) {
      if (Math.hypot(event.clientX - tap.clientX, event.clientY - tap.clientY) < DRAG_THRESHOLD_PX) {
        // Tapping the node whose buttons are already showing puts them away again.
        if (useDefendStore.getState().selectedNodeId === tap.id) clearSelection();
        else selectNode(tap.id);
      }
      return;
    }
    // A clean tap on empty canvas puts away whichever node's action buttons were showing.
    if (hadPointer && !camera.moved && camera.pointers.size === 0) {
      clearSelection();
    }
  }

  /** A press on a node never becomes a camera gesture — the node is a tap target (tap to reveal
   * its action buttons), and moving it is the move button's job, not the node's. */
  function handleNodePointerDown(node: DefendNode, event: React.PointerEvent<SVGGElement>): void {
    event.stopPropagation();
    nodeTapRef.current = { id: node.id, clientX: event.clientX, clientY: event.clientY };
  }

  function handleMoveHandlePointerDown(node: DefendNode, event: React.PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic PointerEvent (tests) or an already-released capture — the drag still tracks via
      // the wrapper's pointermove/pointerup handlers, capture is only an extra reliability layer.
    }
    nodeDragRef.current = { id: node.id, startClientX: event.clientX, startClientY: event.clientY, nodeStartX: node.x, nodeStartY: node.y };
    setDraggingNode(true);
  }

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const detailNode = nodes.find((node) => node.id === detailNodeId) ?? null;
  const actionBarPosition = selectedNode ? actionBarPositionFor(selectedNode, { zoom, offsetX, offsetY }, viewportSize, actionBarSize) : null;

  return (
    <div className="payload-defend" data-testid="defend-page">
      <div
        ref={wrapRef}
        className="payload-defend-viewport"
        data-testid="defend-viewport"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg className="payload-defend-canvas" data-testid="defend-canvas" width="100%" height="100%" aria-label="Peta pertahanan">
          <defs>
            {/* patternTransform carries the camera, so the grid pans and zooms with the world it
            sits under — the pattern tile itself stays in screen pixels. */}
            <pattern id="payload-defend-grid" patternUnits="userSpaceOnUse" width={GRID_CELL_DU * zoom} height={GRID_CELL_DU * zoom} patternTransform={`translate(${offsetX} ${offsetY})`}>
              <circle cx={(GRID_CELL_DU * zoom) / 2} cy={(GRID_CELL_DU * zoom) / 2} r={1} fill={theme.border} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={theme.background} />
          <rect width="100%" height="100%" fill="url(#payload-defend-grid)" />
          {/* One uniform scale on both axes — no viewBox ratio to distort silhouettes when the
          canvas is a tall phone screen instead of a wide one. */}
          <g transform={`translate(${offsetX} ${offsetY}) scale(${zoom})`}>
            {nodes.map((node) => (
              <g
                key={node.id}
                data-testid="defend-node"
                data-node-id={node.id}
                data-node-type={node.type}
                data-node-x={node.x}
                data-node-y={node.y}
                onPointerDown={(event) => handleNodePointerDown(node, event)}
                style={{ cursor: "pointer" }}
              >
                <NodeGlyph shape={nodeShapeOf(node)} cx={node.x} cy={node.y} r={nodeRadius(node)} fill={nodeColor(node)} stroke={selectedNodeId === node.id ? theme.text : "none"} strokeWidth={3} />
                {/* Above the silhouette, not below — below is where the action buttons pop up. */}
                <text x={node.x} y={node.y - nodeRadius(node) - 10} textAnchor="middle" fontSize={13} fill={theme.textMuted} style={{ pointerEvents: "none", userSelect: "none" }}>
                  {nodeLabel(node)}
                </text>
              </g>
            ))}
          </g>
        </svg>

        {selectedNode && actionBarPosition && (
          // Positioned in screen pixels rather than inside the zoomed <g>: the buttons stay the
          // same thumb-sized target whether the player is zoomed all the way in or out.
          <div ref={actionBarRef} className="payload-defend-actions" data-testid="defend-node-actions" style={{ left: actionBarPosition.left, top: actionBarPosition.top }}>
            <button
              type="button"
              data-testid="defend-action-move"
              className="payload-defend-action-btn"
              title="Geser node — tahan tombol ini lalu tarik"
              aria-label={`Geser ${nodeLabel(selectedNode)}`}
              onPointerDown={(event) => handleMoveHandlePointerDown(selectedNode, event)}
              onClick={(event) => event.stopPropagation()}
            >
              ✥
            </button>
            {isRemovable(selectedNode) && (
              <button
                type="button"
                data-testid="defend-action-remove"
                className="payload-defend-action-btn payload-defend-action-btn--danger"
                title="Hapus node"
                aria-label={`Hapus ${nodeLabel(selectedNode)}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => removeNode(selectedNode.id)}
              >
                🗑
              </button>
            )}
            <button
              type="button"
              data-testid="defend-action-detail"
              className="payload-defend-action-btn"
              title="Detail node"
              aria-label={`Detail ${nodeLabel(selectedNode)}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => openDetail(selectedNode.id)}
            >
              ℹ
            </button>
          </div>
        )}

        <div className="payload-defend-topbar">
          <Link to="/" className="payload-defend-exit" data-testid="defend-exit">
            ← Keluar
          </Link>
          <span className="payload-defend-zoom" data-testid="defend-zoom-level">
            {Math.round(zoom * 100)}%
          </span>
        </div>

        <p className="payload-defend-hint" data-testid="defend-hint">
          {isDraggingNode ? "Tarik untuk memindahkan node." : "Geser untuk menggerakkan kamera · cubit untuk zoom · tap node untuk aksinya."}
        </p>
      </div>

      {detailNode && (
        <div className="payload-modal-backdrop" data-testid="defend-detail-backdrop" onClick={closeDetail}>
          <div className="payload-modal" role="dialog" aria-label={`Detail ${nodeLabel(detailNode)}`} data-testid="defend-detail" onClick={(event) => event.stopPropagation()}>
            <h2>
              {nodeLabel(detailNode)}
              {detailNode.tier ? ` · Tier ${detailNode.tier}` : ""}
            </h2>
            <p className="payload-defend-detail-body">{nodeDescription(detailNode)}</p>
            <dl className="payload-defend-detail-stats">
              <div>
                <dt>Biaya</dt>
                <dd data-testid="defend-detail-cost">{getDefenseNodeCost(detailNode.type, detailNode.tier)} pt</dd>
              </div>
              <div>
                <dt>Posisi</dt>
                <dd data-testid="defend-detail-position">
                  {detailNode.x}, {detailNode.y} DU
                </dd>
              </div>
            </dl>
            <button type="button" data-testid="defend-detail-close" onClick={closeDetail}>
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
