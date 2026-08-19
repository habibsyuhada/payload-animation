import type { BattleLog } from "@payload/sim";
import { simulate } from "@payload/sim";
import { create } from "zustand";
import { ONBOARDING_TUTORIALS, toBattleInput } from "../data/onboardingTutorials.js";

export interface OnboardingState {
  readonly stepIndex: number;
  readonly log: BattleLog | null;
  readonly hasScrubbedBackward: boolean;
  readonly completed: boolean;
  readonly startBattle: () => void;
  readonly markScrubbedBackward: () => void;
  readonly advance: () => void;
  readonly reset: () => void;
}

/** Only the FIRST tutorial's replay requires a backward scrub before continuing (GDD: "replay
 * tutorial pertama secara eksplisit mengajari scrub"). */
const FORCED_SCRUB_STEP_INDEX = 0;

export function requiresForcedScrub(stepIndex: number): boolean {
  return stepIndex === FORCED_SCRUB_STEP_INDEX;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  stepIndex: 0,
  log: null,
  hasScrubbedBackward: false,
  completed: false,

  startBattle: () => {
    const tutorial = ONBOARDING_TUTORIALS[get().stepIndex];
    if (!tutorial) return;
    set({ log: simulate(toBattleInput(tutorial)) });
  },

  markScrubbedBackward: () => set({ hasScrubbedBackward: true }),

  advance: () =>
    set((state) => {
      const nextIndex = state.stepIndex + 1;
      if (nextIndex >= ONBOARDING_TUTORIALS.length) {
        return { completed: true };
      }
      return { stepIndex: nextIndex, log: null, hasScrubbedBackward: false };
    }),

  reset: () => set({ stepIndex: 0, log: null, hasScrubbedBackward: false, completed: false }),
}));
