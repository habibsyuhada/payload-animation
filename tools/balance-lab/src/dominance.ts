import type { DefenseArchetype } from "./archetypes.js";
import { KNOWN_DOMINANCE, type KnownDominance } from "./known-dominance.js";
import { WINRATE_CEILING, WINRATE_FLOOR } from "./report.js";
import { runMatchup, type MatchupResult } from "./run-matchup.js";
import type { GeneratedVirus } from "./sheet-generator.js";

/**
 * V7.4: the dominance search that has to be clean before ruleset v2 ships to players.
 *
 * "Dominant" here means something narrower than "strong": a build that beats **every** opponent it
 * was measured against. That is the shape of the failure RULESET.md §9 records — the "ICE Nest"
 * defense went 100% against all five virus archetypes, which is not a hard matchup, it is the
 * absence of a matchup. GDD §2's own promise ("tidak ada satu strategi yang mendominasi") is what
 * this checks, and it is checked in both directions because either side can break it.
 */

export interface DominantVirus {
  readonly name: string;
  readonly description: string;
  readonly weightKb: number;
  /** Winrate against the defense that resisted it best — the whole point is that even this is high. */
  readonly worstCaseWinrate: number;
}

export interface DominantDefense {
  readonly name: string;
  /** Attacker winrate against this defense from the attacker that did best — even the best is low. */
  readonly bestCaseAttackerWinrate: number;
}

export interface DominanceReport {
  readonly populationSize: number;
  readonly sampleSize: number;
  readonly seed: number;
  readonly results: readonly MatchupResult[];
  /** Generated sheets that beat every defense archetype above the ceiling. */
  readonly dominantViruses: readonly DominantVirus[];
  /** Defense archetypes no generated sheet could breach above the floor. */
  readonly dominantDefenses: readonly DominantDefense[];
}

/**
 * Runs every generated sheet against every defense archetype and reports both directions of
 * dominance. Seeds are derived from (population index, defense index) so the whole search is
 * reproducible from the single `seed` argument — a flagged build can be replayed exactly.
 */
export function searchDominance(population: readonly GeneratedVirus[], defenses: readonly DefenseArchetype[], sampleSize: number, seed: number): DominanceReport {
  const results: MatchupResult[] = [];
  for (const [virusIndex, virus] of population.entries()) {
    for (const [defenseIndex, defense] of defenses.entries()) {
      results.push(runMatchup(virus, defense, sampleSize, seed + (virusIndex * defenses.length + defenseIndex) * sampleSize));
    }
  }

  const dominantViruses: DominantVirus[] = [];
  for (const virus of population) {
    const own = results.filter((result) => result.virus === virus.name);
    const worstCaseWinrate = Math.min(...own.map((result) => result.attackerWinrate));
    if (own.length === defenses.length && worstCaseWinrate > WINRATE_CEILING) {
      dominantViruses.push({ name: virus.name, description: virus.description, weightKb: virus.weightKb, worstCaseWinrate });
    }
  }

  const dominantDefenses: DominantDefense[] = [];
  for (const defense of defenses) {
    const own = results.filter((result) => result.defense === defense.name);
    const bestCaseAttackerWinrate = Math.max(...own.map((result) => result.attackerWinrate));
    if (own.length === population.length && bestCaseAttackerWinrate < WINRATE_FLOOR) {
      dominantDefenses.push({ name: defense.name, bestCaseAttackerWinrate });
    }
  }

  return { populationSize: population.length, sampleSize, seed, results, dominantViruses, dominantDefenses };
}

/** Every flagged build, regardless of whether it is already known. A clean search here is the release prerequisite for v2 (PLAN.md V7.4). */
export function isDominanceClean(report: DominanceReport): boolean {
  return report.dominantViruses.length === 0 && report.dominantDefenses.length === 0;
}

export interface UnexpectedFindings {
  readonly viruses: readonly DominantVirus[];
  readonly defenses: readonly DominantDefense[];
}

/**
 * What the CI job keys off: findings that are NOT already recorded in known-dominance.ts. The
 * distinction matters — a search that re-reports a documented, undecided balance question every
 * run trains everyone to ignore it, and then the genuinely new finding scrolls past with it.
 */
export function unexpectedFindings(report: DominanceReport, known: KnownDominance = KNOWN_DOMINANCE): UnexpectedFindings {
  const knownViruses = new Set(known.viruses.map((entry) => entry.name));
  const knownDefenses = new Set(known.defenses.map((entry) => entry.name));
  return {
    viruses: report.dominantViruses.filter((virus) => !knownViruses.has(virus.name)),
    defenses: report.dominantDefenses.filter((defense) => !knownDefenses.has(defense.name)),
  };
}

export function hasUnexpectedFindings(findings: UnexpectedFindings): boolean {
  return findings.viruses.length > 0 || findings.defenses.length > 0;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

export function renderDominanceSection(report: DominanceReport): string {
  const lines: string[] = [];
  lines.push("## Dominance search (V7.4, ruleset v2)");
  lines.push("");
  lines.push(
    `${report.populationSize} generated sheets x ${report.results.length / report.populationSize} defense archetypes, ${report.sampleSize} seeds per matchup, generator seed \`${report.seed}\`.`,
  );
  lines.push("");
  lines.push(`A build is flagged as **dominant** only when it beats *every* opponent it met: a virus above ${formatPercent(WINRATE_CEILING)} against all defenses, or a defense holding every attacker below ${formatPercent(WINRATE_FLOOR)}.`);
  lines.push("");

  if (report.dominantViruses.length === 0) {
    lines.push("- No generated sheet beat every defense archetype.");
  } else {
    for (const virus of report.dominantViruses) {
      lines.push(`- **${virus.name}** (${virus.weightKb} KB) wins at least ${formatPercent(virus.worstCaseWinrate)} against *every* defense: \`${virus.description}\``);
    }
  }

  if (report.dominantDefenses.length === 0) {
    lines.push("- No defense archetype held every generated sheet below the floor.");
  } else {
    for (const defense of report.dominantDefenses) {
      lines.push(`- **${defense.name}** holds every generated sheet to at most ${formatPercent(defense.bestCaseAttackerWinrate)} — the RULESET §9 "ICE Nest" shape.`);
    }
  }
  lines.push("");

  const known = KNOWN_DOMINANCE.defenses.concat(KNOWN_DOMINANCE.viruses);
  if (known.length > 0) {
    lines.push("Known and already tracked (CI does not fail on these — see `src/known-dominance.ts`):");
    lines.push("");
    for (const entry of known) {
      lines.push(`- **${entry.name}** — ${entry.reason}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
