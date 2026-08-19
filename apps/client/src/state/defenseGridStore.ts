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

export interface DefenseGridState {
  readonly nodes: readonly GridNode[];
  readonly edges: readonly GridEdge[];
  readonly pendingPlacementType: Exclude<DefenseNodeType, "entry" | "core"> | null;
  readonly pendingPlacementTier: BlockTier;
  readonly selectedForEdgeId: number | null;
  readonly zoom: number;
  readonly setPendingPlacement: (type: Exclude<DefenseNodeType, "entry" | "core"> | null) => void;
  readonly setPendingPlacementTier: (tier: BlockTier) => void;
  readonly placeNodeAt: (x: number, y: number) => void;
  readonly moveNode: (id: number, x: number, y: number) => void;
  readonly removeNode: (id: number) => void;
  readonly tapNodeForEdge: (id: number) => void;
  readonly setZoom: (zoom: number) => void;
  readonly reset: () => void;
}

let nextPlaceableId = FIRST_PLACEABLE_ID;

export const useDefenseGridStore = create<DefenseGridState>((set, get) => ({
  nodes: INITIAL_NODES,
  edges: [],
  pendingPlacementType: null,
  pendingPlacementTier: 1,
  selectedForEdgeId: null,
  zoom: 1,

  setPendingPlacement: (type) => set({ pendingPlacementType: type, selectedForEdgeId: null }),
  setPendingPlacementTier: (tier) => set({ pendingPlacementTier: tier }),

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
      pendingPlacementType: null,
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
      if (state.pendingPlacementType) {
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

  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(2, zoom)) }),

  reset: () => {
    nextPlaceableId = FIRST_PLACEABLE_ID;
    set({ nodes: INITIAL_NODES, edges: [], pendingPlacementType: null, pendingPlacementTier: 1, selectedForEdgeId: null, zoom: 1 });
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
