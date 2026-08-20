import { DEFENSE_ARCHETYPES, VIRUS_ARCHETYPES } from "./archetypes.js";
import { isDominanceClean, renderDominanceSection, searchDominance } from "./dominance.js";
import { isFlagged, renderMarkdownReport } from "./report.js";
import { runMatchup } from "./run-matchup.js";
import { generatePopulation, describeSheet, type GeneratedVirus } from "./sheet-generator.js";
import type { VirusArchetype } from "./archetypes.js";
import { sheetWeightKb } from "@payload/sim";

const SAMPLE_SIZE = 200;
/**
 * The dominance search runs a much larger cast over fewer seeds each: it is looking for builds
 * that win *everything*, and a build that does that shows it inside a few dozen battles. The
 * hand-written matrix above keeps the deeper per-matchup sample, because that one is measuring
 * where in the band a matchup sits, not just which side of it.
 */
const POPULATION_SIZE = 40;
const DOMINANCE_SAMPLE_SIZE = 40;
/** Fixed so the report is reproducible run to run — a diff between two runs means the ruleset moved, not the dice. */
const GENERATOR_SEED = 20_260_820;
const DOMINANCE_SEED_BASE = 700_000;

function asGenerated(archetype: VirusArchetype): GeneratedVirus {
  return { ...archetype, description: describeSheet(archetype.virus), weightKb: sheetWeightKb(archetype.virus) };
}

function main(): void {
  const results = VIRUS_ARCHETYPES.flatMap((virus, virusIndex) =>
    DEFENSE_ARCHETYPES.map((defense, defenseIndex) => runMatchup(virus, defense, SAMPLE_SIZE, (virusIndex * DEFENSE_ARCHETYPES.length + defenseIndex) * SAMPLE_SIZE)),
  );

  // The hand-written five are part of the cast, not a separate experiment: "is there a defense
  // nothing can beat?" is only answerable against everything we have, and a designed archetype
  // that dominates is exactly as much of a problem as a generated one.
  const population = [...VIRUS_ARCHETYPES.map(asGenerated), ...generatePopulation(GENERATOR_SEED, POPULATION_SIZE)];
  const dominance = searchDominance(population, DEFENSE_ARCHETYPES, DOMINANCE_SAMPLE_SIZE, DOMINANCE_SEED_BASE);

  const report = `${renderMarkdownReport(VIRUS_ARCHETYPES, DEFENSE_ARCHETYPES, results, SAMPLE_SIZE)}\n${renderDominanceSection(dominance)}`;
  process.stdout.write(`${report}\n`);

  if (results.filter(isFlagged).length > 0 || !isDominanceClean(dominance)) {
    process.exitCode = 1;
  }
}

main();
