import { sheetWeightKb } from "@payload/sim";
import { DEFENSE_ARCHETYPES, VIRUS_ARCHETYPES, type VirusArchetype } from "./archetypes.js";
import { hasUnexpectedFindings, renderBandedDominanceSection, searchDominanceByBand, unexpectedFindingsByBand } from "./dominance.js";
import { describeSheet, generatePopulation, type GeneratedVirus } from "./sheet-generator.js";

/**
 * The CI half of V7.4 (`pnpm --filter @payload/balance-lab dominance`). Deliberately narrower than
 * `report`: it runs only the dominance search and fails only on findings that are not already
 * recorded in known-dominance.ts, so it can gate every push without being permanently red over a
 * design question that is already written down.
 *
 * `report` stays the human-facing command, and still exits non-zero while individual matchups sit
 * outside the [25%, 75%] band — that has been true since v1 (see REPORT.md) and is a calibration
 * backlog, not a merge gate.
 */

const POPULATION_SIZE = 40;
const SAMPLE_SIZE = 40;
const GENERATOR_SEED = 20_260_820;
const SEED_BASE = 700_000;

function asGenerated(archetype: VirusArchetype): GeneratedVirus {
  return { ...archetype, description: describeSheet(archetype.virus), weightKb: sheetWeightKb(archetype.virus) };
}

function main(): void {
  const population = [...VIRUS_ARCHETYPES.map(asGenerated), ...generatePopulation(GENERATOR_SEED, POPULATION_SIZE)];
  const bands = searchDominanceByBand(population, DEFENSE_ARCHETYPES, SAMPLE_SIZE, SEED_BASE);
  process.stdout.write(`${renderBandedDominanceSection(bands)}\n`);

  const unexpected = unexpectedFindingsByBand(bands);
  if (hasUnexpectedFindings(unexpected)) {
    for (const virus of unexpected.viruses) {
      process.stdout.write(`NEW dominant virus: ${virus.name} (${virus.weightKb} KB) — ${virus.description}\n`);
    }
    for (const defense of unexpected.defenses) {
      process.stdout.write(`NEW dominant defense: ${defense.name}\n`);
    }
    process.stdout.write("\nAdd a fix, or record it in src/known-dominance.ts with the decision it is waiting on.\n");
    process.exitCode = 1;
  }
}

main();
