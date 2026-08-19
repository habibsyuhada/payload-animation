import { simulate } from "@payload/sim";
import type { BattleInput } from "@payload/sim";
import type { DefenseArchetype, VirusArchetype } from "./archetypes.js";

export interface MatchupResult {
  readonly virus: string;
  readonly defense: string;
  readonly sampleSize: number;
  readonly attackerWins: number;
  readonly attackerWinrate: number;
}

/** Runs the same matchup across `sampleSize` distinct seeds and tallies the attacker winrate. */
export function runMatchup(virus: VirusArchetype, defense: DefenseArchetype, sampleSize: number, seedOffset: number): MatchupResult {
  let attackerWins = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: seedOffset + i,
      virus: virus.virus,
      defense: defense.graph,
    };
    if (simulate(input).result.winner === "attacker") {
      attackerWins += 1;
    }
  }
  return {
    virus: virus.name,
    defense: defense.name,
    sampleSize,
    attackerWins,
    attackerWinrate: attackerWins / sampleSize,
  };
}
