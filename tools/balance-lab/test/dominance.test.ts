import { describe, expect, it } from "vitest";
import { DEFENSE_ARCHETYPES } from "../src/archetypes.js";
import { hasUnexpectedFindings, isDominanceClean, renderDominanceSection, searchDominance, unexpectedFindings, type DominanceReport } from "../src/dominance.js";
import { KNOWN_DOMINANCE } from "../src/known-dominance.js";
import { generatePopulation } from "../src/sheet-generator.js";

/** A report shaped by hand, so the flagging logic is tested without paying for 7000 battles. */
function reportWith(overrides: Partial<DominanceReport>): DominanceReport {
  return { populationSize: 1, sampleSize: 10, seed: 1, results: [], dominantViruses: [], dominantDefenses: [], ...overrides };
}

// Locally these run in well under a second each (searchDominance is thousands of simulate() calls,
// each sub-millisecond) — but CI runs this alongside every other package's suite via turbo, and
// under that shared-runner contention they've measured 5s+, past vitest's 5000ms default. A wider
// budget accounts for that contention without hiding an actual hang (30s is still generous headroom
// short of "never times out").
const CI_CONTENTION_TIMEOUT_MS = 30_000;

describe("searchDominance", () => {
  it(
    "runs every population member against every defense",
    () => {
      const population = generatePopulation(11, 3);
      const report = searchDominance(population, DEFENSE_ARCHETYPES, 2, 1);
      expect(report.results).toHaveLength(population.length * DEFENSE_ARCHETYPES.length);
      expect(report.populationSize).toBe(3);
    },
    CI_CONTENTION_TIMEOUT_MS,
  );

  it(
    "is reproducible from its seed",
    () => {
      const population = generatePopulation(11, 2);
      const first = searchDominance(population, DEFENSE_ARCHETYPES, 3, 500);
      const second = searchDominance(population, DEFENSE_ARCHETYPES, 3, 500);
      expect(JSON.stringify(first.results)).toBe(JSON.stringify(second.results));
    },
    CI_CONTENTION_TIMEOUT_MS,
  );
});

describe("dominance flagging", () => {
  it("treats a clean report as clean", () => {
    expect(isDominanceClean(reportWith({}))).toBe(true);
  });

  it("fails a report with any dominant build", () => {
    expect(isDominanceClean(reportWith({ dominantViruses: [{ name: "Gen#1", description: "x", weightKb: 1, worstCaseWinrate: 0.9 }] }))).toBe(false);
    expect(isDominanceClean(reportWith({ dominantDefenses: [{ name: "ICE Nest", bestCaseAttackerWinrate: 0 }] }))).toBe(false);
  });

  it("lets CI pass on a finding already recorded in known-dominance.ts, but never on a new one", () => {
    // An explicit fixture rather than the real KNOWN_DOMINANCE — that list is meant to be empty
    // (PLAN.md 8.8's own acceptance bar), so this test can't depend on it holding anything.
    const hypotheticallyKnown = { viruses: [], defenses: [{ name: "ICE Nest", reason: "hypothetical fixture for this test only" }] };
    const known = reportWith({ dominantDefenses: [{ name: "ICE Nest", bestCaseAttackerWinrate: 0 }] });
    expect(hasUnexpectedFindings(unexpectedFindings(known, hypotheticallyKnown))).toBe(false);

    const fresh = reportWith({ dominantDefenses: [{ name: "Firewall Wall", bestCaseAttackerWinrate: 0.1 }] });
    const findings = unexpectedFindings(fresh, hypotheticallyKnown);
    expect(hasUnexpectedFindings(findings)).toBe(true);
    expect(findings.defenses.map((defense) => defense.name)).toEqual(["Firewall Wall"]);
  });

  it("never lets a generated build be silently baselined — the known list only names hand-written archetypes", () => {
    for (const entry of [...KNOWN_DOMINANCE.viruses, ...KNOWN_DOMINANCE.defenses]) {
      expect(entry.name.startsWith("Gen#")).toBe(false);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

describe("renderDominanceSection", () => {
  it("says plainly when nothing was found", () => {
    const rendered = renderDominanceSection(reportWith({ results: new Array(4).fill(null) }));
    expect(rendered).toContain("No generated sheet beat every defense archetype.");
    expect(rendered).toContain("No defense archetype held every generated sheet below the floor.");
    // known-dominance.ts is empty as of PLAN.md 8.8 (the last entry, ICE Nest, is resolved — see
    // known-dominance.ts's own doc comment) — nothing for the "known and tracked" footer to show.
    expect(rendered).not.toContain("known-dominance.ts");
  });

  it("names a flagged build and quotes its sheet, so the finding is actionable without a re-run", () => {
    const rendered = renderDominanceSection(
      reportWith({ results: new Array(4).fill(null), dominantViruses: [{ name: "Gen#7", description: "[selalu] -> brute-force", weightKb: 1234, worstCaseWinrate: 0.9 }] }),
    );
    expect(rendered).toContain("**Gen#7** (1234 KB)");
    expect(rendered).toContain("[selalu] -> brute-force");
  });
});
