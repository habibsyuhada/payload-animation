import { getDefenseNodeCost, getIceSentryConfig, type BattleLog, type BlockTier, type SheetEvent } from "@payload/sim";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NodeGlyph } from "../components/NodeGlyph.js";
import { findActionEntry, findConditionEntry } from "../data/sheetCatalog.js";
import { compileForMap, frameAt, playbackDurationSeconds } from "../logic/attackPlayback.js";
import { runDefenseTest, type DefenseTestReport, type DefenseVerdict } from "../logic/defenseTest.js";
import { useAppShellStore } from "../state/appShellStore.js";
import {
  CORE_COLOR,
  CORE_DESCRIPTION,
  CORE_SHAPE,
  ENTRY_COLOR,
  ENTRY_DESCRIPTION,
  ENTRY_SHAPE,
  findNodeTierDescription,
  findPlaceableEntry,
  PLACEABLE_NODE_CATALOG,
  type NodeShape,
} from "../data/defenseNodeCatalog.js";
import { DEFENSE_BUDGET_PT, isRemovable, linksFor, LINK_RANGE_DU, nodeCostPt, remainingPt, spentPt, useDefendStore, type DefendNode, type NodeLink, type PlaceableNodeType, type WorldBounds } from "../state/defendStore.js";
import { theme } from "../theme.js";

/** Raw CSS-pixel movement below which a press-and-release still counts as a tap, not a drag. */
const DRAG_THRESHOLD_PX = 6;
/** Spacing (screen px) between a node's silhouette and the action buttons that pop up under it. */
const ACTION_BAR_GAP_PX = 12;
/** How close to the viewport edge the action bar is allowed to get. */
const EDGE_MARGIN_PX = 8;
/** Height of the strip along the bottom held by the hint text and the add-node button. */
const BOTTOM_UI_BAND_PX = 84;
/** World-space band above a node taken by its name label — its baseline offset plus its font size
 * (see the <text> under each node), so a flipped action bar can be lifted clear of it. */
const NODE_LABEL_BAND_DU = 10 + 13;
/** World-space size of one background grid cell — drawn via an SVG pattern so it pans and zooms
 * with the camera, giving the eye something to track while dragging an otherwise empty canvas. */
const GRID_CELL_DU = 40;
/** Roughly how much of the bottom of the screen the results sheet takes up — the camera fit that
 * runs when a battle starts aims at the strip above it. */
const RESULT_SHEET_BAND_PX = 220;
/** How far in from the viewport edge an off-screen node's direction marker sits. */
const OFFSCREEN_INSET_PX = 34;
/** Connector colours: a wide, soft halo in the app's accent blue with a near-white core, which is
 * what reads as "glowing" against this page's near-black background. */
const LINK_COLOR = theme.faction.movement;
const LINK_CORE_COLOR = "#cfe4ff";
/** ICE Sentry's own colour (defenseNodeCatalog) — the fire-range ring belongs to the sentry, so it
 * is drawn in the sentry's colour rather than the link blue. */
const FIRE_RANGE_COLOR = "#5ac8e6";

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

/** What the node picker offers: the ruleset's placeable catalog plus Entry and Core, which this
 * page lets the player add too (a second way in, a second thing to defend) — priced by the page,
 * see ENTRY_COST_PT. Entry/Core go first: they're structural, so they read as a different class
 * of thing than the defensive hardware below them. */
const PICKER_CATALOG: readonly { type: PlaceableNodeType; label: string; color: string; shape: NodeShape; tiered: boolean }[] = [
  { type: "entry", label: "Entry", color: ENTRY_COLOR, shape: ENTRY_SHAPE, tiered: false },
  { type: "core", label: "Core", color: CORE_COLOR, shape: CORE_SHAPE, tiered: false },
  ...PLACEABLE_NODE_CATALOG.map((entry) => ({ type: entry.type as PlaceableNodeType, label: entry.label, color: entry.color, shape: entry.shape, tiered: entry.tiered })),
];

const ROMAN_TIER: Record<BlockTier, string> = { 1: "I", 2: "II", 3: "III" };

/** One attacker rule rendered as a line of plain language: what it checks, then what it does. */
function describeRule(event: SheetEvent): string {
  const conditions =
    event.conditions.length === 0
      ? "SELALU"
      : event.conditions.map((condition) => `${condition.negate ? "TIDAK " : ""}${findConditionEntry(condition.kind).label}${condition.targetNodeTypes ? ` ${condition.targetNodeTypes.join("/")}` : ""}`).join(" & ");
  const actions = event.actions.map((action) => `${findActionEntry(action.kind).label}${action.tier && action.tier > 1 ? ` ${ROMAN_TIER[action.tier]}` : ""}`).join(", ");
  return `${conditions} → ${actions || "—"}`;
}

/** Colour a rule by the first action it takes — what the rule is *for*, at a glance. */
function ruleColor(event: SheetEvent): string {
  const first = event.actions[0];
  if (!first) {
    return theme.border;
  }
  const category = findActionEntry(first.kind).category;
  return category === "movement" ? theme.faction.movement : theme.faction[category];
}

/** The attacker's sheet, flattened in the same depth-first order the engine addresses rows by, so
 * a `rule-fired` event's row path ("1.0") points at exactly one chip. */
function flattenRules(events: readonly SheetEvent[], prefix = ""): { readonly path: string; readonly depth: number; readonly event: SheetEvent }[] {
  return events.flatMap((event, index) => {
    const path = prefix === "" ? String(index) : `${prefix}.${index}`;
    return [{ path, depth: path.split(".").length - 1, event }, ...flattenRules(event.children, path)];
  });
}

const VERDICT_COPY: Record<DefenseVerdict, string> = {
  impenetrable: "❌ Tidak ada satu pun penyerang yang tembus. Pertahanan seperti ini tidak adil dan akan ditolak saat publish.",
  breachable: "✅ Bisa ditembus, tapi tidak gratis — sebagian penyerang lolos, sebagian gagal. Ini yang kita mau.",
  "too-easy": "⚠️ Semua penyerang masuk hampir selalu. Sah, tapi kamu akan kalah terus.",
};

export interface FireCoverage {
  /** Every node the sentry can shoot a virus on. */
  readonly nodeIds: ReadonlySet<number>;
  readonly radiusHops: number;
  /** How far that reach extends on the map, in world units — the distance to the furthest node it
   * covers, so the ring drawn at this radius is a true picture of the graph the player built. */
  readonly radiusDu: number;
}

/**
 * What an ICE Sentry can actually shoot. The ruleset measures its reach in HOPS along the graph
 * (RULESET.md §5.1: radius 1-2 hops per tier), not in map distance — so the honest picture is
 * "which nodes are within N links", walked here with a breadth-first search over the same derived
 * links the map draws. The ring Defend renders from this is sized to the furthest node actually
 * covered rather than to some invented distance, and the covered nodes are marked individually,
 * because two nodes the same distance away can differ in whether the sentry reaches them at all.
 */
function fireCoverageFor(sentry: DefendNode, links: readonly NodeLink[]): FireCoverage | null {
  if (sentry.type !== "ice-sentry") {
    return null;
  }
  const radiusHops = getIceSentryConfig(sentry.tier ?? 1).radiusHops;
  const neighbours = new Map<number, { id: number; x: number; y: number }[]>();
  for (const link of links) {
    if (!neighbours.has(link.from.id)) neighbours.set(link.from.id, []);
    if (!neighbours.has(link.to.id)) neighbours.set(link.to.id, []);
    neighbours.get(link.from.id)!.push(link.to);
    neighbours.get(link.to.id)!.push(link.from);
  }

  const covered = new Set<number>();
  let radiusDu = 0;
  let frontier: { id: number; x: number; y: number }[] = [sentry];
  const seen = new Set<number>([sentry.id]);
  for (let hop = 0; hop < radiusHops; hop += 1) {
    const next: { id: number; x: number; y: number }[] = [];
    for (const node of frontier) {
      for (const neighbour of neighbours.get(node.id) ?? []) {
        if (seen.has(neighbour.id)) {
          continue;
        }
        seen.add(neighbour.id);
        covered.add(neighbour.id);
        radiusDu = Math.max(radiusDu, Math.hypot(neighbour.x - sentry.x, neighbour.y - sentry.y));
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return { nodeIds: covered, radiusHops, radiusDu: Math.round(radiusDu) };
}

export interface OffscreenMarker {
  readonly node: DefendNode;
  /** Screen position of the marker itself, pinned just inside the viewport edge. */
  readonly left: number;
  readonly top: number;
  /** Direction from the middle of the viewport towards the node, in degrees (0 = right). */
  readonly angleDeg: number;
}

/** One marker per node the camera has left behind, pinned to the edge of the viewport in the
 * node's direction — so panning away from the Core never loses it, and the player can always see
 * which way to go back (tapping a marker does exactly that). Nodes on screen get no marker. */
function offscreenMarkersFor(nodes: readonly DefendNode[], camera: { zoom: number; offsetX: number; offsetY: number }, viewport: { width: number; height: number }): readonly OffscreenMarker[] {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return [];
  }
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const halfWidth = Math.max(1, centerX - OFFSCREEN_INSET_PX);
  const halfHeight = Math.max(1, centerY - OFFSCREEN_INSET_PX);

  const markers: OffscreenMarker[] = [];
  for (const node of nodes) {
    const screenX = node.x * camera.zoom + camera.offsetX;
    const screenY = node.y * camera.zoom + camera.offsetY;
    const radius = nodeRadius(node) * camera.zoom;
    const onScreen = screenX + radius >= 0 && screenX - radius <= viewport.width && screenY + radius >= 0 && screenY - radius <= viewport.height;
    if (onScreen) {
      continue;
    }
    // Walk out from the middle of the viewport along the direction of the node until the ray hits
    // the inset rectangle — whichever axis runs out of room first decides where it lands.
    const dx = screenX - centerX;
    const dy = screenY - centerY;
    const travel = Math.min(Math.abs(dx) > 0.001 ? halfWidth / Math.abs(dx) : Infinity, Math.abs(dy) > 0.001 ? halfHeight / Math.abs(dy) : Infinity);
    if (!Number.isFinite(travel)) {
      continue;
    }
    markers.push({ node, left: centerX + dx * travel, top: centerY + dy * travel, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI });
  }
  return markers;
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
  // Flip above the node when the bar would otherwise land in the strip the hint and the add-node
  // button occupy, not merely when it would leave the viewport.
  if (viewport.height > 0 && bar.height > 0 && top + bar.height > viewport.height - BOTTOM_UI_BAND_PX) {
    // Clear the node's name label too, which sits in exactly this space above the silhouette.
    top = screenY - radius - ACTION_BAR_GAP_PX - bar.height - NODE_LABEL_BAND_DU * camera.zoom;
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
  const addNode = useDefendStore((state) => state.addNode);
  const moveNode = useDefendStore((state) => state.moveNode);
  const removeNode = useDefendStore((state) => state.removeNode);

  const wrapRef = useRef<HTMLDivElement>(null);
  const actionBarRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<CameraGestureState>({ pointers: new Map(), moved: false });
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const nodeTapRef = useRef<{ id: number; clientX: number; clientY: number } | null>(null);
  const didFitRef = useRef(false);
  const [isDraggingNode, setDraggingNode] = useState(false);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [isTesting, setTesting] = useState(false);
  const [testReport, setTestReport] = useState<DefenseTestReport | null>(null);
  const [playbackLog, setPlaybackLog] = useState<BattleLog | null>(null);
  /** Which attacker's battle is on screen — the rule chips only light for the sheet being played. */
  const [playbackTrialId, setPlaybackTrialId] = useState<string | null>(null);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackStartRef = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [actionBarSize, setActionBarSize] = useState({ width: 0, height: 0 });

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const detailNode = nodes.find((node) => node.id === detailNodeId) ?? null;
  const links = linksFor(nodes);
  const offscreenMarkers = offscreenMarkersFor(nodes, { zoom, offsetX, offsetY }, viewportSize);
  /** A selected node the camera has left behind: its buttons would otherwise float over empty
   * canvas pointing at nothing. The selection itself survives, so panning back brings them back. */
  const selectionIsOffscreen = offscreenMarkers.some((marker) => marker.node.id === selectedNodeId);
  const actionBarPosition = selectedNode ? actionBarPositionFor(selectedNode, { zoom, offsetX, offsetY }, viewportSize, actionBarSize) : null;
  const budgetRemaining = remainingPt(nodes);
  const fireCoverage = selectedNode ? fireCoverageFor(selectedNode, links) : null;
  /** The battle runs against the layout as it was when the test ran, so the timeline is compiled
   * from the log's own node ids against current world positions — dragging a node mid-playback
   * moves the attack with it, which is exactly the "what if I moved this?" the page is for. */
  const playbackTimeline = useMemo(() => (playbackLog ? compileForMap(playbackLog, nodes) : null), [playbackLog, nodes]);
  const playbackFrame = playbackTimeline ? frameAt(playbackTimeline, playbackSeconds) : null;
  const playbackDuration = playbackTimeline ? playbackDurationSeconds(playbackTimeline) : 0;

  /** Drives the battle clock off requestAnimationFrame rather than a fixed interval, so playback
   * runs at the display's own refresh rate and a dropped frame costs smoothness, not sync: the
   * time shown is always measured from the wall clock, never accumulated tick by tick. */
  useEffect(() => {
    if (!isPlaying || playbackDuration <= 0) {
      return;
    }
    let frameId = 0;
    const step = (timestampMs: number): void => {
      if (playbackStartRef.current === null) {
        playbackStartRef.current = timestampMs;
      }
      const elapsed = ((timestampMs - playbackStartRef.current) / 1000) * playbackSpeed;
      if (elapsed >= playbackDuration) {
        setPlaybackSeconds(playbackDuration);
        setPlaying(false);
        return;
      }
      setPlaybackSeconds(elapsed);
      frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, playbackDuration, playbackSpeed]);

  /* Defend covers the header and nav entirely (it is `position: fixed`), so the title it
   * registers is never visible behind it. It registers anyway because it is a nav destination
   * now: the shell's header has to be showing the right screen the moment the page is closed. */
  const setActiveScreenTitle = useAppShellStore((state) => state.setActiveScreenTitle);
  useEffect(() => {
    setActiveScreenTitle("Defense");
  }, [setActiveScreenTitle]);

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
    // Re-measured when the bar comes back after its node was panned off-screen and back, too.
  }, [selectedNodeId, selectionIsOffscreen]);

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
    try {
      // Not just belt-and-braces: without capture, dragging across the SVG lets the browser start
      // its own native drag, which fires pointercancel and kills the pan halfway through the
      // gesture. Capturing to the viewport keeps every move coming to us.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic PointerEvent (tests) or an already-released capture — the pan still tracks via
      // the pointermove/pointerup handlers below.
    }
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
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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

  /** Runs the gauntlet against the layout as it stands. Deferred by one frame rather than run
   * inline: the whole thing is ~30ms of straight-line simulation, which would otherwise block the
   * paint that shows the player anything is happening at all. */
  function handleTestDefense(): void {
    setTesting(true);
    setTestReport(null);
    clearSelection();
    requestAnimationFrame(() => {
      const report = runDefenseTest(useDefendStore.getState().nodes);
      setTestReport(report);
      setTesting(false);
      // Straight into the battle on the map — the numbers alone don't show how they got in.
      startPlayback(report);
    });
  }

  function startPlayback(report: DefenseTestReport): void {
    playbackStartRef.current = null;
    setPlaybackSeconds(0);
    setPlaying(true);
    setPlaybackLog(report.showcase.showcase);
    setPlaybackTrialId(report.showcase.virus.id);
    // Frame the whole graph before the battle starts — an attack happening off-screen is the one
    // way this feature can silently fail. The results sheet owns the bottom of the screen, so the
    // fit targets the strip above it rather than the full viewport.
    if (viewportSize.width > 0 && viewportSize.height > 0) {
      useDefendStore.getState().fitToBounds(worldBoundsOf(useDefendStore.getState().nodes), viewportSize.width, Math.max(120, viewportSize.height - RESULT_SHEET_BAND_PX));
    }
  }

  function stopPlayback(): void {
    setPlaying(false);
    setPlaybackLog(null);
    setPlaybackTrialId(null);
    setPlaybackSeconds(0);
    playbackStartRef.current = null;
  }

  /** Drops the picked type in the middle of whatever the camera is currently looking at — the
   * screen centre converted back into world coordinates. */
  function handlePickNodeType(type: PlaceableNodeType, tiered: boolean): void {
    setPickerOpen(false);
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    const worldX = Math.round((viewportSize.width / 2 - offsetX) / zoom);
    const worldY = Math.round((viewportSize.height / 2 - offsetY) / zoom);
    addNode(type, worldX, worldY, tiered ? 1 : undefined);
  }

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
            {/* The selected node's reach, under both the connectors and the nodes. Only the
            selected one: these circles are an order of magnitude wider than a node, so drawing
            every node's at once turns the map into overlapping dashes — and "how close does this
            have to be?" is a question about the node in your hand, which is the selected one. */}
            {selectedNode && (
              <circle
                data-testid="defend-node-range"
                data-node-id={selectedNode.id}
                cx={selectedNode.x}
                cy={selectedNode.y}
                r={LINK_RANGE_DU}
                fill={nodeColor(selectedNode)}
                fillOpacity={0.04}
                stroke={nodeColor(selectedNode)}
                strokeWidth={1.5}
                strokeDasharray="10 8"
                opacity={0.6}
                style={{ pointerEvents: "none" }}
              />
            )}
            {/* An ICE Sentry's reach, drawn only when it's the selected node. Sized to the
            furthest node it actually covers (its reach is counted in hops, see fireCoverageFor),
            with each covered node ringed so the two ideas can't be confused. */}
            {selectedNode && fireCoverage && (
              <g data-testid="defend-fire-range" data-node-id={selectedNode.id} data-hops={fireCoverage.radiusHops} data-covered={fireCoverage.nodeIds.size} style={{ pointerEvents: "none" }}>
                <circle cx={selectedNode.x} cy={selectedNode.y} r={Math.max(fireCoverage.radiusDu, nodeRadius(selectedNode) + 24)} fill={FIRE_RANGE_COLOR} fillOpacity={0.06} stroke={FIRE_RANGE_COLOR} strokeWidth={2} strokeDasharray="3 7" opacity={0.85} />
                {nodes
                  .filter((node) => fireCoverage.nodeIds.has(node.id))
                  .map((node) => (
                    <circle key={`covered-${node.id}`} data-testid="defend-fire-target" data-node-id={node.id} cx={node.x} cy={node.y} r={nodeRadius(node) + 8} fill="none" stroke={FIRE_RANGE_COLOR} strokeWidth={2} opacity={0.75} />
                  ))}
                {/* Pinned just above the sentry rather than to the ring's edge: the ring can be
                wider than the screen, and a caption nobody can see explains nothing. */}
                <text x={selectedNode.x} y={selectedNode.y - nodeRadius(selectedNode) - 27} textAnchor="middle" fontSize={12} fill={FIRE_RANGE_COLOR} opacity={0.95}>
                  jangkauan tembak · {fireCoverage.radiusHops} hop
                </text>
              </g>
            )}
            {links.map((link) => (
              <g key={`link-${link.from.id}-${link.to.id}`} data-testid="defend-link" data-from={link.from.id} data-to={link.to.id} data-distance={link.distanceDu} style={{ pointerEvents: "none" }}>
                {/* Three stacked strokes rather than an SVG blur filter: same bloom, a fraction of
                the per-frame cost while a node is being dragged around on a phone. */}
                <line className="payload-defend-link-halo" x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y} stroke={LINK_COLOR} strokeWidth={14} strokeLinecap="round" opacity={0.16} />
                <line x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y} stroke={LINK_COLOR} strokeWidth={6} strokeLinecap="round" opacity={0.3} />
                <line x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y} stroke={LINK_CORE_COLOR} strokeWidth={2} strokeLinecap="round" />
              </g>
            ))}
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

            {/* The attack itself, drawn inside the same camera transform as the map — the battle
            happens on the layout the player built, at whatever zoom they're looking at it. */}
            {playbackFrame && (
              <g data-testid="defend-playback" data-integrity={Math.round(playbackFrame.integrity * 100)} style={{ pointerEvents: "none" }}>
                {playbackFrame.flashes.map((flash, index) => {
                  const node = nodes.find((candidate) => candidate.id === flash.nodeId);
                  if (!node) return null;
                  // A node being hit BY the virus flashes in the attacker's red, not its own
                  // colour — it's taking damage, not dealing it.
                  const stroke = flash.kind === "destroyed" || flash.kind === "node-hit" ? theme.faction.attack : nodeColor(node);
                  return <circle key={`flash-${index}`} cx={node.x} cy={node.y} r={nodeRadius(node) + 6 + flash.progress * 26} fill="none" stroke={stroke} strokeWidth={3} opacity={1 - flash.progress} />;
                })}

                {/* Every node the virus is currently chewing on gets the damage it's taking,
                floating off it — the Core draining tick by tick is the whole battle. */}
                {playbackFrame.nodeHits
                  .filter((hit) => hit.damage > 0)
                  .map((hit, index) => {
                    const node = nodes.find((candidate) => candidate.id === hit.nodeId);
                    if (!node) return null;
                    return (
                      <text key={`nodehit-${index}`} data-testid="defend-playback-node-damage" data-node-id={node.id} x={node.x + nodeRadius(node) + 6} y={node.y - nodeRadius(node) - hit.progress * 18} fontSize={14} fontWeight={700} fill={theme.faction.attack} opacity={1 - hit.progress}>
                        -{hit.damage}
                      </text>
                    );
                  })}

                {/* The defender's own health bar: one per Core, sitting under it for the whole
                battle (not just while it's being hit) so "how close am I to losing?" is always
                answerable at a glance. */}
                {nodes
                  .filter((node) => node.type === "core")
                  .map((core) => (
                    <g key={`corehp-${core.id}`} data-testid="defend-playback-core-hp" data-node-id={core.id} data-core-hp={Math.round(playbackFrame.coreHp * 100)}>
                      <rect x={core.x - 30} y={core.y + nodeRadius(core) + 26} width={60} height={10} rx={5} fill="#000" opacity={0.6} />
                      <rect
                        x={core.x - 28.5}
                        y={core.y + nodeRadius(core) + 27.5}
                        width={57 * playbackFrame.coreHp}
                        height={7}
                        rx={3.5}
                        fill={playbackFrame.coreHp > 0.5 ? CORE_COLOR : playbackFrame.coreHp > 0.25 ? theme.faction.sensor : theme.faction.attack}
                      />
                      <text x={core.x} y={core.y + nodeRadius(core) + 50} textAnchor="middle" fontSize={12} fontWeight={700} fill={playbackFrame.coreHp > 0.25 ? theme.textMuted : theme.faction.attack}>
                        Core {Math.round(playbackFrame.coreHp * 100)}%
                      </text>
                    </g>
                  ))}

                {/* ICE Sentry fire: a tracer snapping from the sentry to wherever the virus is,
                plus a muzzle flare, so a hit is something you see rather than infer. */}
                {playbackFrame.shots.map((shot, index) => (
                  <g key={`shot-${index}`} data-testid="defend-playback-shot">
                    <line x1={shot.from.x} y1={shot.from.y} x2={playbackFrame.virusPosition.x} y2={playbackFrame.virusPosition.y} stroke={FIRE_RANGE_COLOR} strokeWidth={6} strokeLinecap="round" opacity={(1 - shot.progress) * 0.35} />
                    <line x1={shot.from.x} y1={shot.from.y} x2={playbackFrame.virusPosition.x} y2={playbackFrame.virusPosition.y} stroke="#eaf6ff" strokeWidth={2} strokeLinecap="round" opacity={1 - shot.progress} />
                    <circle cx={shot.from.x} cy={shot.from.y} r={10 + shot.progress * 10} fill="none" stroke={FIRE_RANGE_COLOR} strokeWidth={3} opacity={1 - shot.progress} />
                  </g>
                ))}

                {playbackFrame.virusAlive ? (
                  <g data-testid="defend-playback-virus">
                    {/* Impact flash: the virus itself flares red the moment it's hit. */}
                    {playbackFrame.recentHits.map((hit, index) => (
                      <circle key={`hit-${index}`} cx={playbackFrame.virusPosition.x} cy={playbackFrame.virusPosition.y} r={16 + hit.progress * 18} fill="none" stroke={theme.faction.attack} strokeWidth={3} opacity={1 - hit.progress} />
                    ))}
                    <circle cx={playbackFrame.virusPosition.x} cy={playbackFrame.virusPosition.y} r={16} fill={theme.faction.attack} opacity={0.18} />
                    <circle cx={playbackFrame.virusPosition.x} cy={playbackFrame.virusPosition.y} r={9} fill="#eaf6ff" />

                    {/* Health bar rides BELOW the virus, in world units so it scales with the map —
                    above is where each node prints its own name, and the two collided there. */}
                    <rect x={playbackFrame.virusPosition.x - 26} y={playbackFrame.virusPosition.y + 16} width={52} height={9} rx={4.5} fill="#000" opacity={0.6} />
                    <rect
                      data-testid="defend-playback-hp"
                      data-integrity={Math.round(playbackFrame.integrity * 100)}
                      x={playbackFrame.virusPosition.x - 24.5}
                      y={playbackFrame.virusPosition.y + 17.5}
                      width={49 * playbackFrame.integrity}
                      height={6}
                      rx={3}
                      fill={playbackFrame.integrity > 0.5 ? theme.faction.stealth : playbackFrame.integrity > 0.25 ? theme.faction.sensor : theme.faction.attack}
                    />
                    {/* Labelled because the virus parks ON the Core for most of a battle, where an
                    unlabelled bar is indistinguishable from the Core's own. */}
                    <text x={playbackFrame.virusPosition.x} y={playbackFrame.virusPosition.y + 36} textAnchor="middle" fontSize={11} fontWeight={700} fill={theme.textMuted}>
                      Virus {Math.round(playbackFrame.integrity * 100)}%
                    </text>

                    {/* Floating damage numbers, drifting up as they fade. */}
                    {playbackFrame.recentHits
                      .filter((hit) => hit.damage > 0)
                      .map((hit, index) => (
                        <text key={`dmg-${index}`} data-testid="defend-playback-damage" x={playbackFrame.virusPosition.x + 22} y={playbackFrame.virusPosition.y - 8 - hit.progress * 22} fontSize={14} fontWeight={700} fill={theme.faction.attack} opacity={1 - hit.progress}>
                          -{hit.damage}
                        </text>
                      ))}
                  </g>
                ) : (
                  <text x={playbackFrame.virusPosition.x} y={playbackFrame.virusPosition.y} textAnchor="middle" fontSize={20} fill={theme.faction.attack}>
                    ✖
                  </text>
                )}
              </g>
            )}
          </g>
        </svg>

        {selectedNode && actionBarPosition && !selectionIsOffscreen && (
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
            {isRemovable(selectedNode, nodes) && (
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

        {offscreenMarkers.map((marker) => (
          <button
            key={marker.node.id}
            type="button"
            className="payload-defend-offscreen"
            data-testid="defend-offscreen-marker"
            data-node-id={marker.node.id}
            data-angle={Math.round(marker.angleDeg)}
            title={`${nodeLabel(marker.node)} di luar layar — tap untuk ke sana`}
            aria-label={`${nodeLabel(marker.node)} di luar layar — tap untuk ke sana`}
            style={{ left: marker.left, top: marker.top, borderColor: nodeColor(marker.node) }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => useDefendStore.getState().centerOnWorldPoint(marker.node.x, marker.node.y, viewportSize.width, viewportSize.height)}
          >
            {/* Only the arrow spins towards the node; the silhouette next to it says which node it
            is, in the same shape language the map itself uses. A text label would be wider than
            the inset the marker sits at, so it would hang off the edge of the screen. */}
            <span className="payload-defend-offscreen-arrow" style={{ transform: `rotate(${marker.angleDeg}deg)`, color: nodeColor(marker.node) }} aria-hidden="true">
              ➤
            </span>
            <svg className="payload-defend-offscreen-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <NodeGlyph shape={nodeShapeOf(marker.node)} cx={12} cy={12} r={9} fill={nodeColor(marker.node)} stroke="none" strokeWidth={0} />
            </svg>
          </button>
        ))}

        <div className="payload-defend-topbar">
          <Link to="/" className="payload-defend-exit" data-testid="defend-exit">
            ← Keluar
          </Link>
          <button type="button" className="payload-defend-test-btn" data-testid="defend-test" onPointerDown={(event) => event.stopPropagation()} onClick={handleTestDefense} disabled={isTesting}>
            {isTesting ? "Menguji…" : "🧪 Uji pertahanan"}
          </button>
          <span className="payload-defend-meter">
            <strong data-testid="defend-budget" data-remaining={budgetRemaining} className={budgetRemaining === 0 ? "payload-defend-budget--empty" : undefined}>
              {spentPt(nodes)}/{DEFENSE_BUDGET_PT} pt
            </strong>
            <span className="payload-defend-zoom" data-testid="defend-zoom-level">
              {Math.round(zoom * 100)}%
            </span>
          </span>
        </div>

        {/* The results sheet owns the bottom of the screen while it's open, and the editing
        affordances have nothing to say during a battle — both step aside for it. */}
        {!testReport && (
          <p className="payload-defend-hint" data-testid="defend-hint">
            {isDraggingNode ? "Node yang masuk lingkaran langsung tersambung." : "Geser & cubit untuk kamera · tap node untuk aksinya · node dalam lingkaran otomatis tersambung."}
          </p>
        )}

        {!testReport && (
        <button
          type="button"
          className="payload-defend-add-btn"
          data-testid="defend-add-node"
          title="Tambah node"
          aria-label="Tambah node"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPickerOpen(true)}
        >
          ＋
        </button>
        )}
      </div>

      {/* Results live in a sheet along the bottom rather than a modal over the map: the battle
      plays on the map itself, so covering the map would hide the very thing being reported. */}
      {testReport && (
        <div className="payload-defend-sheet" data-testid="defend-test-result" role="region" aria-label="Hasil uji pertahanan">
          <div className="payload-defend-sheet-head">
            <p className={`payload-defend-verdict payload-defend-verdict--${testReport.verdict}`} data-testid="defend-test-verdict" data-verdict={testReport.verdict}>
              {VERDICT_COPY[testReport.verdict]}
            </p>
            <button
              type="button"
              data-testid="defend-test-close"
              className="payload-defend-sheet-close"
              aria-label="Tutup hasil uji"
              onClick={() => {
                stopPlayback();
                setTestReport(null);
              }}
            >
              ✕
            </button>
          </div>

          {playbackTimeline && (
            <div className="payload-defend-playback-bar" data-testid="defend-playback-controls">
              <button
                type="button"
                data-testid="defend-playback-toggle"
                className="payload-defend-playback-btn"
                onClick={() => {
                  // Restarting from the end rewinds first, so the button never looks inert.
                  if (!isPlaying && playbackSeconds >= playbackDuration) {
                    setPlaybackSeconds(0);
                  }
                  playbackStartRef.current = null;
                  setPlaying((playing) => !playing);
                }}
              >
                {isPlaying ? "⏸" : playbackSeconds >= playbackDuration ? "↻" : "▶"}
              </button>
              <input
                type="range"
                data-testid="defend-playback-scrub"
                className="payload-defend-playback-scrub"
                min={0}
                max={Math.max(0.01, playbackDuration)}
                step={0.01}
                value={Math.min(playbackSeconds, playbackDuration)}
                aria-label="Waktu pertempuran"
                onChange={(event) => {
                  setPlaying(false);
                  playbackStartRef.current = null;
                  setPlaybackSeconds(Number(event.target.value));
                }}
              />
              <select data-testid="defend-playback-speed" className="payload-defend-playback-speed" value={playbackSpeed} aria-label="Kecepatan" onChange={(event) => { playbackStartRef.current = null; setPlaybackSpeed(Number(event.target.value)); }}>
                {[0.5, 1, 2, 4].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="payload-defend-showcase-caption" data-testid="defend-test-showcase-caption">
            {testReport.showcase.showcaseWon ? "Begini cara mereka masuk" : "Serangan yang paling nyaris"} — <strong>{testReport.showcase.virus.name}</strong>, seed {testReport.showcase.showcase.input.seed}, sisa Core{" "}
            {Math.round(testReport.showcase.showcase.result.score.coreRatioPermille / 10)}%
          </p>

          <details className="payload-defend-sheet-details">
            <summary>Rincian {testReport.trials.length} penyerang</summary>
            <ul className="payload-defend-trials" data-testid="defend-test-trials">
              {testReport.trials.map((trial) => (
                <li key={trial.virus.id} data-testid="defend-test-trial" data-virus={trial.virus.id} data-wins={trial.wins}>
                  <div className="payload-defend-trial-head">
                    <strong>{trial.virus.name}</strong>
                    <span className={trial.wins > 0 ? "payload-defend-trial-win" : "payload-defend-trial-loss"}>
                      {trial.wins > 0 ? `tembus ${trial.wins}/${trial.runs}` : `gagal ${trial.runs}×`}
                    </span>
                    <button type="button" data-testid="defend-trial-watch" className="payload-defend-trial-watch" onClick={() => { playbackStartRef.current = null; setPlaybackSeconds(0); setPlaying(true); setPlaybackLog(trial.showcase); setPlaybackTrialId(trial.virus.id); }}>
                      Tonton
                    </button>
                  </div>
                  <div className="payload-defend-trial-track">
                    <span className="payload-defend-trial-fill" style={{ width: `${Math.round(trial.winrate * 100)}%`, background: trial.wins > 0 ? theme.faction.stealth : theme.faction.attack }} />
                  </div>
                  <small>{trial.virus.description}</small>
                  {/* The attacker's actual event sheet, in the same vocabulary Virus Lab builds
                  from, so "why did this one get through?" is answerable by reading it. While its
                  battle is playing back, the rule that just fired lights up (ADR 0006 §6) — which
                  is what turns a sheet from a list into an explanation. */}
                  <ul className="payload-defend-loadout" data-testid="defend-trial-loadout" data-virus={trial.virus.id}>
                    {flattenRules(trial.virus.virus.events).map(({ path, depth, event }) => {
                      const isFiring = playbackTrialId === trial.virus.id && playbackFrame?.firedRuleIds.has(path) === true;
                      return (
                        <li
                          key={path}
                          className={`payload-defend-block${isFiring ? " payload-defend-block--firing" : ""}`}
                          data-testid="defend-trial-rule"
                          data-rule-path={path}
                          data-firing={isFiring}
                          style={{ borderColor: ruleColor(event), marginLeft: depth * 10 }}
                        >
                          {describeRule(event)}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>

            {!testReport.validation.valid && (
              <div className="payload-defend-structural" data-testid="defend-test-structural">
                <strong>Catatan struktur ({testReport.validation.errors.length})</strong>
                <ul>
                  {testReport.validation.errors.map((error, index) => (
                    <li key={index}>{error.message}</li>
                  ))}
                </ul>
                <small>Aturan topologi @payload/sim — halaman ini sandbox, jadi ini catatan, bukan penghalang uji.</small>
              </div>
            )}
          </details>
        </div>
      )}

      {isPickerOpen && (
        <div className="payload-modal-backdrop" data-testid="defend-picker-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="payload-modal" role="dialog" aria-label="Pilih node" data-testid="defend-picker" onClick={(event) => event.stopPropagation()}>
            <h2>Pilih Node</h2>
            <p className="payload-defend-budget-note" data-testid="defend-picker-budget">
              Sisa <strong>{budgetRemaining} pt</strong> dari {DEFENSE_BUDGET_PT} pt
            </p>
            <div className="payload-modal-grid">
              {PICKER_CATALOG.map((entry) => {
                const cost = nodeCostPt({ type: entry.type, ...(entry.tiered ? { tier: 1 as const } : {}) });
                const affordable = cost <= budgetRemaining;
                return (
                  <button
                    key={entry.type}
                    type="button"
                    data-testid="defend-picker-entry"
                    data-node-type={entry.type}
                    data-affordable={affordable}
                    className="payload-modal-card"
                    style={{ borderColor: entry.color }}
                    disabled={!affordable}
                    title={affordable ? undefined : `Butuh ${cost} pt, sisa ${budgetRemaining} pt`}
                    onClick={() => handlePickNodeType(entry.type, entry.tiered)}
                  >
                    <svg className="payload-modal-card-glyph" viewBox="0 0 40 40" aria-hidden="true">
                      <NodeGlyph shape={entry.shape} cx={20} cy={20} r={14} fill={entry.color} stroke="none" strokeWidth={0} />
                    </svg>
                    <span>{entry.label}</span>
                    <small>{cost}pt</small>
                  </button>
                );
              })}
            </div>
            <button type="button" data-testid="defend-picker-close" onClick={() => setPickerOpen(false)}>
              Batal
            </button>
          </div>
        </div>
      )}

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
              <div>
                <dt>Jangkauan</dt>
                <dd data-testid="defend-detail-range">{LINK_RANGE_DU} DU</dd>
              </div>
              <div>
                <dt>Terhubung</dt>
                <dd data-testid="defend-detail-links">{links.filter((link) => link.from.id === detailNode.id || link.to.id === detailNode.id).length} node</dd>
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
