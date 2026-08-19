import { DEFENSE_ARCHETYPES, VIRUS_ARCHETYPES } from "./archetypes.js";
import { isFlagged, renderMarkdownReport } from "./report.js";
import { runMatchup } from "./run-matchup.js";

const SAMPLE_SIZE = 200;

function main(): void {
  const results = VIRUS_ARCHETYPES.flatMap((virus, virusIndex) =>
    DEFENSE_ARCHETYPES.map((defense, defenseIndex) => runMatchup(virus, defense, SAMPLE_SIZE, (virusIndex * DEFENSE_ARCHETYPES.length + defenseIndex) * SAMPLE_SIZE)),
  );

  const report = renderMarkdownReport(VIRUS_ARCHETYPES, DEFENSE_ARCHETYPES, results, SAMPLE_SIZE);
  process.stdout.write(`${report}\n`);

  const flaggedCount = results.filter(isFlagged).length;
  if (flaggedCount > 0) {
    process.exitCode = 1;
  }
}

main();
