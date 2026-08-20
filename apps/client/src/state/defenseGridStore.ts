import type { BlockTier, DefenseGraph, DefenseNodeType } from "@payload/sim";
import { create } from "zustand";

export interface GridNode {
  readonly id: number;
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
  readonly x: number;
  readonly y: number;
  /** Entry/Core positions are system-determined (GDD §5) — the player can't drag or delete them. */
  readonly fixed: boolean;
}

export interface GridEdge {
  readonly from: number;
  readonly to: number;
}

export const CORE_ID = 1;
export const ENTRY_1_ID = 2;
export const ENTRY_2_ID = 3;
const FIRST_PLACEABLE_ID = 4;

const INITIAL_NODES: readonly GridNode[] = [
  { id: CORE_ID, type: "core", x: 480, y: 250, fixed: true },
  { id: ENTRY_1_ID, type: "entry", x: 40, y: 100, fixed: true },
  { id: ENTRY_2_ID, type: "entry", x: 40, y: 400, fixed: true },
];

/** Which mouse/touch gesture on the canvas means right now — like a drawing app's toolbar: "Hand"
 * pans the camera and drags existing nodes around, "Line" taps two nodes to link/unlink an edge,
 * "Node" (armed via the node-picker modal, see pendingPlacementType) taps the grid to stamp down
 * a new node of the chosen type. */
export type GridTool = "hand" | "line" | "node";

export interface DefenseGridState {
  readonly nodes: readonly GridNode[];
  readonly edges: readonly GridEdge[];
  readonly activeTool: GridTool;
  readonly pendingPlacementType: Exclude<DefenseNodeType, "entry" | "core"> | null;
  readonly pendingPlacementTier: BlockTier;
  readonly selectedForEdgeId: number | null;
  readonly zoom: number;
  /** World-space point (in the same DU coordinate space as node x/y) that the canvas's top-left
   * corner is currently showing — i.e. the camera's position. Panning the canvas moves this;
   * zooming does not. */
  readonly panX: number;
  readonly panY: number;
  readonly setActiveTool: (tool: Exclude<GridTool, "node">) => void;
  readonly armNodeType: (type: Exclude<DefenseNodeType, "entry" | "core">) => void;
  readonly setPendingPlacementTier: (tier: BlockTier) => void;
  readonly placeNodeAt: (x: number, y: number) => void;
  readonly moveNode: (id: number, x: number, y: number) => void;
  readonly removeNode: (id: number) => void;
  readonly tapNodeForEdge: (id: number) => void;
  readonly removeEdge: (from: number, to: number) => void;
  readonly setZoom: (zoom: number) => void;
  readonly setPan: (x: number, y: number) => void;
  readonly reset: () => void;
}

let nextPlaceableId = FIRST_PLACEABLE_ID;

export const useDefenseGridStore = create<DefenseGridState>((set, get) => ({
  nodes: INITIAL_NODES,
  edges: [],
  activeTool: "hand",
  pendingPlacementType: null,
  pendingPlacementTier: 1,
  selectedForEdgeId: null,
  zoom: 1,
  panX: 0,
  panY: 0,

  /** Switches to Hand or Line — always disarms whatever node type was staged for the Node tool,
   * so leaving Node (for either other tool) can't leave a stale "tap to place" armed behind it. */
  setActiveTool: (tool) => set({ activeTool: tool, pendingPlacementType: null, selectedForEdgeId: null }),

  /** Arms the Node tool with a type picked from the node-picker modal — tapping the grid now
   * stamps down that type (see placeNodeAt) until the player switches to Hand or Line, or reopens
   * the modal to arm a different type. */
  armNodeType: (type) => set({ activeTool: "node", pendingPlacementType: type, pendingPlacementTier: 1, selectedForEdgeId: null }),

  setPendingPlacementTier: (tier) => set({ pendingPlacementTier: tier }),

  /** Deliberately leaves pendingPlacementType armed after placing — "stamp mode" — so the Node
   * tool can drop several of the same type without reopening the picker for each one. */
  placeNodeAt: (x, y) => {
    const { pendingPlacementType, pendingPlacementTier } = get();
    if (!pendingPlacementType) {
      return;
    }
    const id = nextPlaceableId;
    nextPlaceableId += 1;
    const catalogIsTiered = pendingPlacementType !== "router";
    set((state) => ({
      nodes: [...state.nodes, { id, type: pendingPlacementType, ...(catalogIsTiered ? { tier: pendingPlacementTier } : {}), x, y, fixed: false }],
    }));
  },

  moveNode: (id, x, y) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === id && !node.fixed ? { ...node, x, y } : node)),
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id || node.fixed),
      edges: state.edges.filter((edge) => edge.from !== id && edge.to !== id),
      selectedForEdgeId: state.selectedForEdgeId === id ? null : state.selectedForEdgeId,
    })),

  tapNodeForEdge: (id) =>
    set((state) => {
      if (state.activeTool !== "line") {
        return state;
      }
      if (state.selectedForEdgeId === null) {
        return { selectedForEdgeId: id };
      }
      if (state.selectedForEdgeId === id) {
        return { selectedForEdgeId: null };
      }
      const from = state.selectedForEdgeId;
      const to = id;
      const existingIndex = state.edges.findIndex((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from));
      const edges = existingIndex === -1 ? [...state.edges, { from, to }] : state.edges.filter((_, index) => index !== existingIndex);
      return { edges, selectedForEdgeId: null };
    }),

  /** Direct delete — tapping the edge's own line on the grid (see grid-edge's onClick in
   * DefenseGrid.tsx), independent of the Line tool's link/unlink-by-tapping-two-nodes gesture. */
  removeEdge: (from, to) =>
    set((state) => ({
      edges: state.edges.filter((edge) => !((edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))),
    })),

  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(2, zoom)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),

  reset: () => {
    nextPlaceableId = FIRST_PLACEABLE_ID;
    set({ nodes: INITIAL_NODES, edges: [], activeTool: "hand", pendingPlacementType: null, pendingPlacementTier: 1, selectedForEdgeId: null, zoom: 1, panX: 0, panY: 0 });
  },
}));

function edgeLengthDu(a: GridNode, b: GridNode): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y));
}

/** Compiles the editor's node/edge state into the DefenseGraph shape @payload/sim's validateDefenseGraph expects — edge lengthDu is derived from actual placed pixel distance (1px = 1 DU at zoom 1), not authored separately. */
export function toDefenseGraph(state: Pick<DefenseGridState, "nodes" | "edges">, coreHp: number): DefenseGraph {
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  return {
    nodes: state.nodes.map((node) => ({ id: node.id, type: node.type, ...(node.tier !== undefined ? { tier: node.tier } : {}) })),
    edges: state.edges.map((edge) => ({ from: edge.from, to: edge.to, lengthDu: edgeLengthDu(nodesById.get(edge.from)!, nodesById.get(edge.to)!) })),
    entryNodeIds: [ENTRY_1_ID, ENTRY_2_ID],
    coreNodeId: CORE_ID,
    coreHp,
  };
}
