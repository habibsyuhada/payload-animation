import { createJSONStorage, type StateStorage } from "zustand/middleware";

/**
 * localPersist.ts — the one place this app writes to the device.
 *
 * Step 1 of going offline-first, and the smallest one that changes how the app feels: until now a
 * refresh threw away everything the player built. Nothing here talks to a network, and nothing
 * here needs to: `packages/sim` is deterministic and runs in the browser, so the app is already
 * fully playable with the radio off — it just had no memory.
 *
 * **What is saved is the input, never the outcome.** A `BattleLog` is large (hundreds of events)
 * and is exactly reproducible from `(rulesetVersion, seed, virus, defense)`, so storing logs would
 * be paying kilobytes for something the sim regenerates in under a millisecond. Saved state is
 * therefore only what a player authored: their sheet, their layout.
 */

/**
 * Survives a `localStorage` that throws. Safari's private mode, a full quota, and an embedded
 * webview with storage disabled all raise on `setItem` — and a game that crashes on every edit
 * because it could not save is worse than one that quietly forgets. The in-memory map keeps the
 * session working; only the *next* launch loses anything.
 */
const memoryFallback = new Map<string, string>();

const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? memoryFallback.get(name) ?? null;
    } catch {
      return memoryFallback.get(name) ?? null;
    }
  },
  setItem: (name, value) => {
    memoryFallback.set(name, value);
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      // Kept in memory above; nothing else to do without making an edit fail.
    }
  },
  removeItem: (name) => {
    memoryFallback.delete(name);
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      // Same.
    }
  },
};

export const persistStorage = createJSONStorage(() => safeLocalStorage);

/** Namespaced so a key collision with another app on the same origin is impossible, and so
 * clearing this game's data is one prefix scan. */
export function storageKey(name: string): string {
  return `payload:${name}`;
}

/**
 * Bumps a module-level instance-id counter past everything a restored state already uses.
 *
 * Both stores hand out ids from a counter that starts at a fixed number on page load. Restore a
 * layout whose nodes are 3..9 without this and the very next node the player adds is another 3 —
 * two nodes with one id, which React keys and every `findIndex` in the store then disagree about.
 * The bug only appears after a reload, which is exactly when nobody is looking for it.
 */
export function highestIdSuffix(ids: readonly string[]): number {
  let highest = 0;
  for (const id of ids) {
    const suffix = Number(id.slice(id.lastIndexOf("-") + 1));
    if (Number.isInteger(suffix) && suffix > highest) {
      highest = suffix;
    }
  }
  return highest;
}
