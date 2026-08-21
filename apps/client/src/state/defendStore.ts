import { EDGE_LENGTH_MIN_DU, getAccountTierConfig, getDefenseNodeCostV2, RULESET_V2, type BlockTier, type DefenseNodeType } from "@payload/sim";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistStorage, storageKey } from "./localPersist.js";

/**
 * defendStore — state for the full-screen Defend page (screens/Defend.tsx).
 *
 * Camera model: a node at world point p renders at screen point `p * zoom + offset`, where
 * `offset` is in the canvas's own CSS pixels. One uniform `zoom` on both axes (no per-axis
 * viewBox ratio like Defense Grid's) is what keeps node silhouettes from stretching on any
 * screen shape — a phone in portrait renders the exact same circle a desktop does, just less
 * of the world around it.
 *
 * The node layout is persisted to the device (localPersist.ts); the camera is not, on purpose —
 * see the persist options at the bottom of this file.
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
const FIRST_PLACEABLE_ID = 3;

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 3;
/** Breathing room (screen px) left around the content by fitToBounds. */
const FIT_PADDING_PX = 40;

/** 240 DU apart — inside Defend.tsx's LINK_RANGE_DU, so the pair opens already wired together and
 * the connector is something the player breaks by dragging them apart, not something they have to
 * discover exists. */
const INITIAL_NODES: readonly DefendNode[] = [
  { id: ENTRY_ID, type: "entry", x: -120, y: 0 },
  { id: CORE_ID, type: "core", x: 120, y: 0 },
];

/** Every node type the player can place — on this page that includes extra Entries and Cores. */
export type PlaceableNodeType = DefenseNodeType;

/**
 * What an Entry or a Core costs out of the defense budget.
 *
 * @payload/sim prices both at 0 ("structural, never purchased" — RULESET.md §5.1), which works
 * when the graph always has exactly 2 Entries and 1 Core handed to the player. This page lets
 * them add more, so free Entries/Cores would be an unpriced decision. These two numbers are
 * therefore page-level game design, not ruleset values: an extra Entry is cheap because it opens
 * another way in (it mostly helps the attacker), while an extra Core is expensive because it is
 * another thing that has to be defended. The sim still prices them at 0 when the test window
 * validates the graph — it is the page's own budget that these feed.
 */
export const ENTRY_COST_PT = 1;
export const CORE_COST_PT = 3;

/** The whole build allowance, straight from the ruleset's account-tier table (no account system
 * yet — Fase 4/5 — so tier 1, the same placeholder the other screens use). RULESET_V2 because the
 * page's actual battle test (logic/defenseTest.ts) already runs ruleset v2 — the number itself is
 * identical to v1's (RULESET.md's v2 preamble: budgets are unchanged), only the provenance differs. */
export const DEFENSE_BUDGET_PT = getAccountTierConfig(RULESET_V2, 1).defenseBudgetPoints;

/** A graph always needs a way in and something to defend, so the last of either can't be deleted. */
export const MIN_ENTRY_COUNT = 1;
export const MIN_CORE_COUNT = 1;

/**
 * How far a node reaches to link up with another, in world units — the radius of the range ring
 * Defend.tsx draws around the selected node. Two nodes wire themselves together the moment each
 * sits inside the other's ring, so "how close do these have to be?" is answered by looking.
 *
 * A page-scale number, deliberately not @payload/sim's EDGE_LENGTH_MAX_DU: this page's world is
 * roughly an order of magnitude smaller than the DU distances the ruleset's [200, 2000] band is
 * written for (Entry and Core start 240 apart here), so the ruleset's own max would put every
 * node in range of every other and the ring would say nothing.
 */
export const LINK_RANGE_DU = 260;

export interface NodeLink {
  readonly from: DefendNode;
  readonly to: DefendNode;
  readonly distanceDu: number;
}

/** Every pair of nodes currently within reach of each other. Links are derived from positions
 * rather than stored: drag a node out of range and its connector simply stops existing, with no
 * separate edge list to keep in step. */
export function linksFor(nodes: readonly DefendNode[]): readonly NodeLink[] {
  const links: NodeLink[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const from = nodes[i]!;
      const to = nodes[j]!;
      const distanceDu = Math.round(Math.hypot(from.x - to.x, from.y - to.y));
      if (distanceDu <= LINK_RANGE_DU) {
        links.push({ from, to, distanceDu });
      }
    }
  }
  return links;
}

/** What this node costs out of the defense budget. Entry/Core use the page's own prices (see
 * ENTRY_COST_PT); everything else is priced by the ruleset itself. getDefenseNodeCostV2 (not the
 * v1 function) because this page's node types include the five v2-only ones (RULESET.md §14) that
 * v1's table has never heard of. */
export function nodeCostPt(node: Pick<DefendNode, "type" | "tier">): number {
  if (node.type === "entry") return ENTRY_COST_PT;
  if (node.type === "core") return CORE_COST_PT;
  return getDefenseNodeCostV2(node.type, node.tier);
}

export function spentPt(nodes: readonly DefendNode[]): number {
  return nodes.reduce((total, node) => total + nodeCostPt(node), 0);
}

export function remainingPt(nodes: readonly DefendNode[]): number {
  return DEFENSE_BUDGET_PT - spentPt(nodes);
}

/** Deletable unless it's the last way in or the last thing to defend — a graph without either
 * isn't a defense at all. Everything else the player placed, they can take back. */
export function isRemovable(node: DefendNode, nodes: readonly DefendNode[]): boolean {
  if (node.type === "entry") {
    return nodes.filter((candidate) => candidate.type === "entry").length > MIN_ENTRY_COUNT;
  }
  if (node.type === "core") {
    return nodes.filter((candidate) => candidate.type === "core").length > MIN_CORE_COUNT;
  }
  return true;
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
  /** Drops a new node at the given world point and selects it, so its action buttons are already
   * showing where the player is looking. */
  readonly addNode: (type: PlaceableNodeType, x: number, y: number, tier?: BlockTier) => void;
  readonly moveNode: (id: number, x: number, y: number) => void;
  readonly removeNode: (id: number) => void;
  readonly panBy: (screenDx: number, screenDy: number) => void;
  readonly zoomAtPoint: (factor: number, screenX: number, screenY: number) => void;
  readonly fitToBounds: (bounds: WorldBounds, canvasWidth: number, canvasHeight: number) => void;
  readonly centerOnWorldPoint: (worldX: number, worldY: number, canvasWidth: number, canvasHeight: number) => void;
  readonly reset: () => void;
}

/** Closest two nodes may be placed automatically. The ruleset's own minimum edge length, so a
 * layout the page built by itself never produces an edge the sim would reject as too short —
 * and it comfortably clears the largest node silhouette, so nothing lands on top of anything.
 * Dragging past it afterwards is still the player's call; this only governs `addNode`. */
const MIN_PLACEMENT_GAP_DU = EDGE_LENGTH_MIN_DU;

/** The requested point if it's clear, otherwise the nearest free point on a widening spiral around
 * it. Without this, adding several nodes in a row stacks them all on the exact same spot (each one
 * lands at the centre of the screen) and the player has to drag them apart before they can even
 * tell how many they added. */
function freeSpotNear(nodes: readonly DefendNode[], x: number, y: number): { x: number; y: number } {
  const isClear = (candidateX: number, candidateY: number): boolean => nodes.every((node) => Math.hypot(node.x - candidateX, node.y - candidateY) >= MIN_PLACEMENT_GAP_DU);
  if (isClear(x, y)) {
    return { x, y };
  }
  for (let ring = 1; ring <= 6; ring += 1) {
    const radius = MIN_PLACEMENT_GAP_DU * ring;
    const steps = 6 * ring;
    for (let step = 0; step < steps; step += 1) {
      // Start each ring a little rotated (the +ring) so successive rings don't all place their
      // first candidate due east, which would line new nodes up in a row.
      const angle = ((step + ring * 0.5) / steps) * Math.PI * 2;
      const candidateX = Math.round(x + Math.cos(angle) * radius);
      const candidateY = Math.round(y + Math.sin(angle) * radius);
      if (isClear(candidateX, candidateY)) {
        return { x: candidateX, y: candidateY };
      }
    }
  }
  return { x, y };
}

let nextNodeId = FIRST_PLACEABLE_ID;

/** See localPersist.ts: a restored layout's node ids must not be handed out a second time. */
function adoptRestoredIds(nodes: readonly DefendNode[]): void {
  nextNodeId = Math.max(nextNodeId, ...nodes.map((node) => node.id + 1));
}

export const useDefendStore = create<DefendState>()(
  persist(
    (set) => ({
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

      /** Refuses outright when the budget can't cover it, rather than letting the player overspend and
       * then telling them off — the picker already disables what they can't afford, so reaching here
       * broke means something else got out of step. */
      addNode: (type, x, y, tier) => {
        set((state) => {
          if (nodeCostPt({ type, ...(tier !== undefined ? { tier } : {}) }) > remainingPt(state.nodes)) {
            return state;
          }
          const id = nextNodeId;
          nextNodeId += 1;
          const spot = freeSpotNear(state.nodes, x, y);
          return { nodes: [...state.nodes, { id, type, ...(tier !== undefined ? { tier } : {}), x: spot.x, y: spot.y }], selectedNodeId: id };
        });
      },

      moveNode: (id, x, y) => set((state) => ({ nodes: state.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)) })),

      removeNode: (id) =>
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id);
          if (!node || !isRemovable(node, state.nodes)) {
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

      /** Slides the camera (zoom untouched) until `worldX/worldY` sits in the middle of the canvas —
       * how an off-screen node's direction marker brings that node back into view. */
      centerOnWorldPoint: (worldX, worldY, canvasWidth, canvasHeight) =>
        set((state) => ({ offsetX: canvasWidth / 2 - worldX * state.zoom, offsetY: canvasHeight / 2 - worldY * state.zoom })),

      reset: () => {
        nextNodeId = FIRST_PLACEABLE_ID;
        set({ nodes: INITIAL_NODES, zoom: 1, offsetX: 0, offsetY: 0, selectedNodeId: null, detailNodeId: null });
      },
    }),
    {
      name: storageKey("defend"),
      version: 1,
      storage: persistStorage,
      /** Same as the Virus Lab's: a layout we cannot read degrades to the starting pair rather
       * than crashing the editor. A real conversion replaces this the first time the shape moves. */
      migrate: () => ({ nodes: INITIAL_NODES }),
      /**
       * The layout only. Camera and selection are deliberately left out: the page frames the
       * whole graph on its first layout (see Defend.tsx's fit effect), so a restored zoom/pan
       * would fight that and could open on empty space beside the layout the player saved.
       * Reopening to "here is your defense, all of it" is the better default.
       */
      partialize: (state) => ({ nodes: state.nodes }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          adoptRestoredIds(state.nodes);
        }
      },
    },
  ),
);
