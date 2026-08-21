export const SHARED_PACKAGE_VERSION = "0.0.0";

export type { ResearchBranch, ResearchNode, ResearchState, Unlock } from "./research.js";
export { RESEARCH_TREE } from "./research-tree.js";
export { canResearch, isActionUnlocked, isConditionUnlocked, isDefenseNodeUnlocked, researchNodeFor, unlockedSet, type UnlockedSet } from "./unlocks.js";
