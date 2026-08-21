import { RESEARCH_TREE, canResearch, researchNodeFor, type ResearchState } from "@payload/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { intiStarterIds, starterCompletedIds } from "../logic/unlocks.js";
import { persistStorage, storageKey } from "./localPersist.js";
import { useDefendStore } from "./defendStore.js";
import { useVirusLabStore } from "./virusLabStore.js";

/**
 * researchStore.ts — PLAN.md 8.7: the client's copy of `@payload/shared`'s `ResearchState`, plus
 * the actions that mutate it. Same persist shape as `virusLabStore`/`defendStore`
 * (name/version/storage/migrate/partialize) — see those files for the convention this follows.
 *
 * `ResearchState` itself (data/completed/claimed) is `@payload/shared`'s contract, unchanged here —
 * this file only adds the mutating actions a UI needs, same split `virusLabStore.ts` draws between
 * `RowInstance` (shared-shaped data) and the store around it.
 */

export interface ResearchClientState extends ResearchState {
  /** Spends `Data` and marks a node completed. No-ops (returns `false`) if `canResearch` disagrees
   * — the screen is expected to already disable the button, so reaching here false means something
   * upstream got out of step, not a normal user path. */
  readonly research: (nodeId: string) => boolean;
  readonly grantData: (amount: number) => void;
  /**
   * A `Data` source that may only ever pay out once per `sourceId` — the tutorial-completion,
   * gauntlet-verdict, and dry-simulation sources PLAN.md's economy table describes as "sekali per
   * X". Returns whether this call actually paid out (`false` means already claimed).
   */
  readonly claimOnce: (sourceId: string, amount: number) => boolean;
  /**
   * Marks a node completed directly, without spending `Data` or checking `canResearch` — the
   * onboarding reward (PLAN.md §C.4: "tiap tutorial menyelesaikan satu simpul depth-1") is a gift,
   * not a purchase. Idempotent: a node already in `completed` is left alone.
   */
  readonly unlockNode: (nodeId: string) => void;
  readonly reset: () => void;
}

function currentResearchState(get: () => ResearchClientState): ResearchState {
  const { version, data, completed, claimed } = get();
  return { version, data, completed, claimed };
}

export const useResearchStore = create<ResearchClientState>()(
  persist(
    (set, get) => ({
      version: 1,
      data: 0,
      completed: [],
      claimed: {},

      research: (nodeId) => {
        const node = researchNodeFor(RESEARCH_TREE, nodeId);
        if (!node || !canResearch(node, currentResearchState(get))) {
          return false;
        }
        set((state) => ({ data: state.data - node.costData, completed: [...state.completed, nodeId] }));
        return true;
      },

      grantData: (amount) => set((state) => ({ data: state.data + amount })),

      claimOnce: (sourceId, amount) => {
        if (get().claimed[sourceId] !== undefined) {
          return false;
        }
        set((state) => ({ data: state.data + amount, claimed: { ...state.claimed, [sourceId]: Date.now() } }));
        return true;
      },

      unlockNode: (nodeId) =>
        set((state) => (state.completed.includes(nodeId) ? state : { completed: [...state.completed, nodeId] })),

      reset: () => set({ data: 0, completed: [...intiStarterIds()], claimed: {} }),
    }),
    {
      name: storageKey("research"),
      version: 1,
      storage: persistStorage,
      /** Same shrug as virusLabStore/defendStore's own `migrate`: a state we cannot read degrades
       * to the empty starting shape — `onRehydrateStorage` below is what turns that into the real
       * ADR 0009 §D migration, since it (unlike this) can see the OTHER stores' already-rehydrated
       * state. */
      migrate: () => ({ version: 1, data: 0, completed: [], claimed: {} }),
      partialize: (state) => ({ version: state.version, data: state.data, completed: state.completed, claimed: state.claimed }),
      /**
       * ADR 0009 §D: a player whose `completed` list is still empty has either never opened this
       * device before OR opened it before research existed at all — either way, gating must not
       * make their own already-saved sheet/layout read as illegal. `completed` never returns to
       * empty after this runs once (it always gains at least the Inti starter set), so this is a
       * true one-time migration, not a per-load reset.
       */
      onRehydrateStorage: () => (state) => {
        if (!state || state.completed.length > 0) {
          return;
        }
        // Deferred a tick: zustand can finish this callback before `create()` itself has returned
        // and assigned `useResearchStore`, and this same callback is what needs to call it back.
        queueMicrotask(() => {
          const ids = starterCompletedIds(useVirusLabStore.getState().rows, useDefendStore.getState().nodes);
          if (ids.length > 0) {
            useResearchStore.setState({ completed: ids });
          }
        });
      },
    },
  ),
);
