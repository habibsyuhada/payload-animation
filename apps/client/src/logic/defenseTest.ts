import type { Layout } from "@payload/replay";
import { getAccountTierConfig, RULESET_V2, simulate, validateDefenseGraph, type BattleLog, type DefenseGraph, type GraphValidationResult } from "@payload/sim";
import { GAUNTLET_VIRUSES, type GauntletVirus } from "../data/gauntletViruses.js";
import { linksFor, type DefendNode } from "../state/defendStore.js";

/**
 * defenseTest.ts — "can anyone actually break through this?", answered by running the sim rather
 * than by inspecting the graph (see gauntletViruses.ts for why the distinction matters).
 *
 * Every attacker in the gauntlet is run over SEEDS_PER_VIRUS distinct seeds, because a single
 * battle's outcome depends on the seed (ICE accuracy rolls, random-walk movement). One win is
 * enough to prove breachability, and because the sim is deterministic that win is reproducible
 * forever from (rulesetVersion, seed, virus) — which is exactly what makes it worth showing the
 * player as a replay instead of just a percentage.
 *
 * V7.5: the gauntlet now runs on ruleset v2, so every showcase log carries `rule-fired` events and
 * the result window can light up the exact rule that got an attacker through.
 */

/** No account-tier system yet (Fase 4/5) — same tier-1 placeholder the other screens use. */
const ACCOUNT_TIER = 1;
const TIER_CONFIG = getAccountTierConfig(RULESET_V2, ACCOUNT_TIER);
/** Enough seeds to separate "impossible" from "unlucky once" without making the run feel slow:
 * 5 viruses x 24 seeds is ~120 simulations, a few tens of milliseconds on a phone. */
export const SEEDS_PER_VIRUS = 24;
/** Fixed base so the same defense always faces the same 24 battles — a re-test after an edit
 * shows what the edit changed, not what a different set of dice rolled. */
const SEED_BASE = 9_000;
/** Winrate above which the gauntlet is walking in unopposed — the ceiling tools/balance-lab
 * flags matchups at (its WINRATE_CEILING), reused here for the player-facing verdict. */
const TOO_EASY_WINRATE = 0.75;

export interface VirusTrial {
  readonly virus: GauntletVirus;
  readonly runs: number;
  readonly wins: number;
  readonly winrate: number;
  /** The battle worth showing for this attacker: its first win, or — if it never won — the run
   * that came closest, i.e. left the Core with the least HP. */
  readonly showcase: BattleLog;
  readonly showcaseWon: boolean;
}

export type DefenseVerdict =
  /** Nothing in the gauntlet ever got through: unfair to attackers, and the one result that
   * should block publishing a defense. */
  | "impenetrable"
  /** At least one attacker breached it, and at least one failed — a real fight. */
  | "breachable"
  /** Everything walked straight in. Legal, but the player is going to lose every battle. */
  | "too-easy";

export interface DefenseTestReport {
  readonly verdict: DefenseVerdict;
  readonly trials: readonly VirusTrial[];
  readonly breachCount: number;
  /** Structural check, reported alongside but deliberately NOT gating the simulation: this page
   * is a sandbox that (for one) carries a single Entry where the ruleset wants two, and the
   * player still deserves to see how their layout actually fights. */
  readonly validation: GraphValidationResult;
  readonly graph: DefenseGraph;
  /** The single battle the result window plays back — the most informative one across all
   * attackers (see pickShowcase). */
  readonly showcase: VirusTrial;
}

/** Compiles the Defend page's nodes plus their derived links into the DefenseGraph shape the sim
 * consumes. Edge length comes from the actual on-screen distance (1 world unit = 1 DU), same rule
 * Defense Grid uses, so what the player laid out is what gets simulated. */
export function toDefenseGraph(nodes: readonly DefendNode[]): DefenseGraph {
  const core = nodes.find((node) => node.type === "core");
  return {
    nodes: nodes.map((node) => ({ id: node.id, type: node.type, ...(node.tier !== undefined ? { tier: node.tier } : {}) })),
    edges: linksFor(nodes).map((link) => ({ from: link.from.id, to: link.to.id, lengthDu: link.distanceDu })),
    entryNodeIds: nodes.filter((node) => node.type === "entry").map((node) => node.id),
    coreNodeId: core?.id ?? -1,
    coreHp: TIER_CONFIG.coreHp,
  };
}

/** Maps world positions into the replay canvas's pixel box, preserving aspect ratio and centring —
 * the replay renderer draws wherever the layout says, so an un-fitted layout would put nodes off
 * the edge of the canvas. */
export function replayLayoutFor(nodes: readonly DefendNode[], width: number, height: number, paddingPx = 34): Layout {
  const positions: Record<number, { x: number; y: number }> = {};
  if (nodes.length === 0) {
    return { positions };
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const scale = Math.min((width - paddingPx * 2) / Math.max(1, maxX - minX), (height - paddingPx * 2) / Math.max(1, maxY - minY));
  // Centre whatever's left over once the content is scaled, so a wide-but-short graph doesn't
  // hug the top edge.
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  for (const node of nodes) {
    positions[node.id] = { x: (node.x - minX) * scale + offsetX, y: (node.y - minY) * scale + offsetY };
  }
  return { positions };
}

function runTrial(virus: GauntletVirus, graph: DefenseGraph): VirusTrial {
  let wins = 0;
  let firstWin: BattleLog | null = null;
  let closestLoss: BattleLog | null = null;
  for (let i = 0; i < SEEDS_PER_VIRUS; i += 1) {
    const log = simulate({ rulesetVersion: "v2", seed: SEED_BASE + i, virus: virus.virus, defense: graph });
    if (log.result.winner === "attacker") {
      wins += 1;
      firstWin ??= log;
      continue;
    }
    // coreRatioPermille is how much Core HP survived, so the smallest one is the closest call.
    if (!closestLoss || log.result.score.coreRatioPermille < closestLoss.result.score.coreRatioPermille) {
      closestLoss = log;
    }
  }
  const showcase = firstWin ?? closestLoss!;
  return { virus, runs: SEEDS_PER_VIRUS, wins, winrate: wins / SEEDS_PER_VIRUS, showcase, showcaseWon: firstWin !== null };
}

/** The battle the player should watch: the narrowest win if the defense can be breached (the most
 * instructive "this is how they get in"), otherwise the attacker that came closest to breaking
 * through (the most instructive "this is why nobody can"). */
function pickShowcase(trials: readonly VirusTrial[]): VirusTrial {
  const winners = trials.filter((trial) => trial.showcaseWon);
  if (winners.length > 0) {
    return winners.reduce((best, trial) => (trial.winrate < best.winrate ? trial : best));
  }
  return trials.reduce((best, trial) => (trial.showcase.result.score.coreRatioPermille < best.showcase.result.score.coreRatioPermille ? trial : best));
}

/** Runs the whole gauntlet against `nodes` as laid out right now. Pure and synchronous: ~120
 * simulations at roughly a third of a millisecond each. */
export function runDefenseTest(nodes: readonly DefendNode[]): DefenseTestReport {
  const graph = toDefenseGraph(nodes);
  const validation = validateDefenseGraph(graph, RULESET_V2, ACCOUNT_TIER);
  const trials = GAUNTLET_VIRUSES.map((virus) => runTrial(virus, graph));
  const breachCount = trials.filter((trial) => trial.wins > 0).length;
  const verdict: DefenseVerdict = breachCount === 0 ? "impenetrable" : trials.every((trial) => trial.winrate >= TOO_EASY_WINRATE) ? "too-easy" : "breachable";
  return { verdict, trials, breachCount, validation, graph, showcase: pickShowcase(trials) };
}
