import { create } from "zustand";

/**
 * appShellStore — C3.1's first real zustand store (PLAN.md commits to "state via zustand" for
 * C3.1). Deliberately small: just the chrome-level state the shell itself needs (the active
 * screen's display title, for the header). Per-screen state (virus loadouts, defense graphs,
 * player profile) belongs to its own store once that screen is built (C3.2+) — this store isn't
 * meant to become a dumping ground for everything.
 */
export interface AppShellState {
  readonly activeScreenTitle: string;
  readonly setActiveScreenTitle: (title: string) => void;
}

export const useAppShellStore = create<AppShellState>((set) => ({
  activeScreenTitle: "",
  setActiveScreenTitle: (title) => set({ activeScreenTitle: title }),
}));
