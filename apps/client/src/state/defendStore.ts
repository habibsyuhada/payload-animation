import type { BlockTier, DefenseNodeType } from "@payload/sim";
import { create } from "zustand";

/**
 * defendStore — state for the full-screen Defend page (screens/Defend.tsx).
 *
 * Camera model: a node at world point p renders at screen point `p * zoom + offset`, where
 * `offset` is in the canvas's own CSS pixels. One uniform `zoom` on both axes (no per-axis
 * viewBox ratio like Defense Grid's) is what keeps node silhouettes from stretching on any
 * screen shape — a phone in portrait renders the exact same circle a desktop does, just less
 * of the world around it.
 */

export interface DefendNode {
  readonly id: number;
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
  /** World coordinates (DU) — independent of camera and of the canvas's pixel size. */
  readonly x: number;
  readonly y: number;
}

export const CORE_ID = 1;
export const ENTRY_ID = 2;

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 3;
/** Breathing room (screen px) left around the content by fitToBounds. */
const FIT_PADDING_PX = 40;

const INITIAL_NODES: readonly DefendNode[] = [
  { id: ENTRY_ID, type: "entry", x: -170, y: 0 },
  { id: CORE_ID, type: "core", x: 170, y: 0 },
];

/** Entry and Core are system-owned (GDD §5): the player may reposition them but never delete
 * them — a graph without either has no attack path at all. */
export function isRemovable(node: DefendNode): boolean {
  return node.type !== "entry" && node.type !== "core";
}

export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface DefendState {
  readonly nodes: readonly DefendNode[];
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** The node whose action buttons (move / delete / detail) are showing, if any. */
  readonly selectedNodeId: number | null;
  /** The node whose detail window is open, if any — independent of selection so closing the
   * window leaves the action buttons where they were. */
  readonly detailNodeId: number | null;
  readonly selectNode: (id: number) => void;
  readonly clearSelection: () => void;
  readonly openDetail: (id: number) => void;
  readonly closeDetail: () => void;
  readonly moveNode: (id: number, x: number, y: number) => void;
  readonly removeNode: (id: number) => void;
  readonly panBy: (screenDx: number, screenDy: number) => void;
  readonly zoomAtPoint: (factor: number, screenX: number, screenY: number) => void;
  readonly fitToBounds: (bounds: WorldBounds, canvasWidth: number, canvasHeight: number) => void;
  readonly reset: () => void;
}

export const useDefendStore = create<DefendState>((set) => ({
  nodes: INITIAL_NODES,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  selectedNodeId: null,
  detailNodeId: null,

  selectNode: (id) => set({ selectedNodeId: id }),
  clearSelection: () => set({ selectedNodeId: null }),
  openDetail: (id) => set({ detailNodeId: id }),
  closeDetail: () => set({ detailNodeId: null }),

  moveNode: (id, x, y) => set((state) => ({ nodes: state.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)) })),

  removeNode: (id) =>
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === id);
      if (!node || !isRemovable(node)) {
        return state;
      }
      return {
        nodes: state.nodes.filter((candidate) => candidate.id !== id),
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
        detailNodeId: state.detailNodeId === id ? null : state.detailNodeId,
      };
    }),

  panBy: (screenDx, screenDy) => set((state) => ({ offsetX: state.offsetX + screenDx, offsetY: state.offsetY + screenDy })),

  /** Multiplies zoom by `factor` while pinning the world point currently under (screenX, screenY)
   * to that same screen pixel — what makes a pinch feel like it's stretching the map itself
   * rather than the camera jumping to the middle of it. */
  zoomAtPoint: (factor, screenX, screenY) =>
    set((state) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
      const applied = zoom / state.zoom;
      return {
        zoom,
        offsetX: screenX - (screenX - state.offsetX) * applied,
        offsetY: screenY - (screenY - state.offsetY) * applied,
      };
    }),

  /** Frames `bounds` in a canvas of the given pixel size: the widest zoom that still fits it with
   * padding (never magnifying past 1:1), centered. What makes the page open with both nodes in
   * view on a narrow phone instead of the Core sitting half off the right edge. */
  fitToBounds: (bounds, canvasWidth, canvasHeight) =>
    set(() => {
      const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
      const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
      const fitZoom = Math.min((canvasWidth - FIT_PADDING_PX * 2) / contentWidth, (canvasHeight - FIT_PADDING_PX * 2) / contentHeight, 1);
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom));
      return {
        zoom,
        offsetX: canvasWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
        offsetY: canvasHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
      };
    }),

  reset: () => set({ nodes: INITIAL_NODES, zoom: 1, offsetX: 0, offsetY: 0, selectedNodeId: null, detailNodeId: null }),
}));
