import type { DefenseArchetype, VirusArchetype } from "./archetypes.js";
import type { MatchupResult } from "./run-matchup.js";

/** Matchups where the winrate is outside [25%, 75%] fail S1.7's acceptance bar (PLAN.md). */
export const WINRATE_FLOOR = 0.25;
export const WINRATE_CEILING = 0.75;

export function isFlagged(result: MatchupResult): boolean {
  return result.attackerWinrate > WINRATE_CEILING || result.attackerWinrate < WINRATE_FLOOR;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

export function renderMarkdownReport(
  virusArchetypes: readonly VirusArchetype[],
  defenseArchetypes: readonly DefenseArchetype[],
  results: readonly MatchupResult[],
  sampleSize: number,
): string {
  const resultFor = (virusName: string, defenseName: string): MatchupResult => {
    const found = results.find((result) => result.virus === virusName && result.defense === defenseName);
    if (!found) {
      throw new Error(`no result for ${virusName} vs ${defenseName}`);
    }
    return found;
  };

  const lines: string[] = [];
  lines.push("# Balance Lab — winrate report (ruleset v2)");
  lines.push("");
  lines.push(`${virusArchetypes.length} virus archetype x ${defenseArchetypes.length} defense archetype, ${sampleSize} seeds per matchup.`);
  lines.push(`Attacker winrate shown; flagged (**bold**) if outside [${formatPercent(WINRATE_FLOOR)}, ${formatPercent(WINRATE_CEILING)}] — PLAN.md's S1.7 bar.`);
  lines.push("");

  lines.push(`| Virus \\ Defense | ${defenseArchetypes.map((defense) => defense.name).join(" | ")} |`);
  lines.push(`|---|${defenseArchetypes.map(() => "---").join("|")}|`);
  for (const virus of virusArchetypes) {
    const cells = defenseArchetypes.map((defense) => {
      const result = resultFor(virus.name, defense.name);
      const text = formatPercent(result.attackerWinrate);
      return isFlagged(result) ? `**${text}**` : text;
    });
    lines.push(`| ${virus.name} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  const flagged = results.filter(isFlagged);
  lines.push("## Flagged matchups");
  lines.push("");
  if (flagged.length === 0) {
    lines.push("None — every matchup's attacker winrate is within the target band.");
  } else {
    for (const result of flagged) {
      lines.push(`- **${result.virus}** vs **${result.defense}**: ${formatPercent(result.attackerWinrate)} attacker winrate (${result.attackerWins}/${result.sampleSize}).`);
    }
  }
  lines.push("");

  lines.push("## Virus archetypes");
  lines.push("");
  for (const virus of virusArchetypes) {
    lines.push(`- **${virus.name}**: ${virus.description}`);
  }
  lines.push("");

  lines.push("## Defense archetypes");
  lines.push("");
  for (const defense of defenseArchetypes) {
    lines.push(`- **${defense.name}**: ${defense.description}`);
  }
  lines.push("");

  return lines.join("\n");
}
