import type { BlockTier, LogicBlockKind, MovementBlockKind, VirusDesign } from "@payload/sim";
import { create } from "zustand";
import { findLogicBlockWeightKb, findMovementEntry } from "../data/blockCatalog.js";

export interface ChainBlockInstance {
  readonly id: string;
  readonly kind: LogicBlockKind;
  readonly tier: BlockTier;
}

export interface VirusLabState {
  readonly movementKind: MovementBlockKind;
  readonly chain: readonly ChainBlockInstance[];
  readonly setMovementKind: (kind: MovementBlockKind) => void;
  readonly addBlock: (kind: LogicBlockKind) => void;
  readonly removeBlock: (id: string) => void;
  readonly setBlockTier: (id: string, tier: BlockTier) => void;
  readonly moveBlock: (id: string, direction: "up" | "down") => void;
  readonly reorderTo: (id: string, targetIndex: number) => void;
  readonly reset: () => void;
}

let nextInstanceId = 0;
function newInstanceId(): string {
  nextInstanceId += 1;
  return `block-${nextInstanceId}`;
}

export const useVirusLabStore = create<VirusLabState>((set) => ({
  movementKind: "shortest-path",
  chain: [],

  setMovementKind: (kind) => set({ movementKind: kind }),

  addBlock: (kind) =>
    set((state) => ({
      chain: [...state.chain, { id: newInstanceId(), kind, tier: 1 }],
    })),

  removeBlock: (id) =>
    set((state) => ({
      chain: state.chain.filter((block) => block.id !== id),
    })),

  setBlockTier: (id, tier) =>
    set((state) => ({
      chain: state.chain.map((block) => (block.id === id ? { ...block, tier } : block)),
    })),

  moveBlock: (id, direction) =>
    set((state) => {
      const index = state.chain.findIndex((block) => block.id === id);
      if (index === -1) {
        return state;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= state.chain.length) {
        return state;
      }
      const chain = [...state.chain];
      const [moved] = chain.splice(index, 1);
      chain.splice(targetIndex, 0, moved!);
      return { chain };
    }),

  reorderTo: (id, targetIndex) =>
    set((state) => {
      const index = state.chain.findIndex((block) => block.id === id);
      if (index === -1) {
        return state;
      }
      const chain = [...state.chain];
      const [moved] = chain.splice(index, 1);
      const clampedTarget = Math.max(0, Math.min(chain.length, targetIndex));
      chain.splice(clampedTarget, 0, moved!);
      return { chain };
    }),

  reset: () => set({ movementKind: "shortest-path", chain: [] }),
}));

export function totalWeightKb(state: Pick<VirusLabState, "movementKind" | "chain">): number {
  const movementWeight = findMovementEntry(state.movementKind).weightKb;
  const blocksWeight = state.chain.reduce((sum, block) => sum + findLogicBlockWeightKb(block.kind, block.tier), 0);
  return movementWeight + blocksWeight;
}

export function toVirusDesign(state: Pick<VirusLabState, "movementKind" | "chain">): VirusDesign {
  return {
    movement: { kind: state.movementKind },
    blocks: state.chain.map((block) => ({ kind: block.kind, tier: block.tier })),
  };
}
