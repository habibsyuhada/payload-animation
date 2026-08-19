import { describe, expect, it } from "vitest";
import { DEFENSE_ARCHETYPES, VIRUS_ARCHETYPES } from "../src/archetypes.js";
import { runMatchup } from "../src/run-matchup.js";

describe("runMatchup", () => {
  it("returns a winrate in [0, 1] consistent with attackerWins/sampleSize", () => {
    const result = runMatchup(VIRUS_ARCHETYPES[0]!, DEFENSE_ARCHETYPES[0]!, 20, 0);
    expect(result.sampleSize).toBe(20);
    expect(result.attackerWins).toBeGreaterThanOrEqual(0);
    expect(result.attackerWins).toBeLessThanOrEqual(20);
    expect(result.attackerWinrate).toBe(result.attackerWins / 20);
  });

  it("is deterministic — same seedOffset produces the same result", () => {
    const a = runMatchup(VIRUS_ARCHETYPES[1]!, DEFENSE_ARCHETYPES[1]!, 15, 100);
    const b = runMatchup(VIRUS_ARCHETYPES[1]!, DEFENSE_ARCHETYPES[1]!, 15, 100);
    expect(a).toEqual(b);
  });

  it("a genuinely mixed matchup produces a mixed result, not a clean sweep", () => {
    // Survivor vs Firewall Wall is ~75-77% attacker winrate (per REPORT.md) — over 50 samples
    // the chance of an all-win or all-loss sweep is astronomically small if the matchup is
    // really mixed, so a sweep here would indicate seedOffset isn't actually varying the seed.
    const result = runMatchup(VIRUS_ARCHETYPES[3]!, DEFENSE_ARCHETYPES[0]!, 50, 5000);
    expect(result.attackerWins).toBeGreaterThan(0);
    expect(result.attackerWins).toBeLessThan(50);
  });
});
