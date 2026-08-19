import { describe, expect, it } from "vitest";
import type { DefenseArchetype, VirusArchetype } from "../src/archetypes.js";
import { isFlagged, renderMarkdownReport, WINRATE_CEILING, WINRATE_FLOOR } from "../src/report.js";
import type { MatchupResult } from "../src/run-matchup.js";

const VIRUSES: VirusArchetype[] = [{ name: "V1", description: "desc-v1", virus: { movement: { kind: "shortest-path" }, blocks: [] } }];
const DEFENSES: DefenseArchetype[] = [
  {
    name: "D1",
    description: "desc-d1",
    graph: { nodes: [], edges: [], entryNodeIds: [1, 2], coreNodeId: 3, coreHp: 100 },
  },
];

function result(attackerWinrate: number): MatchupResult {
  return { virus: "V1", defense: "D1", sampleSize: 100, attackerWins: Math.round(attackerWinrate * 100), attackerWinrate };
}

describe("isFlagged", () => {
  it("flags anything outside [floor, ceiling]", () => {
    expect(isFlagged(result(0.5))).toBe(false);
    expect(isFlagged(result(WINRATE_FLOOR))).toBe(false);
    expect(isFlagged(result(WINRATE_CEILING))).toBe(false);
    expect(isFlagged(result(WINRATE_CEILING + 0.01))).toBe(true);
    expect(isFlagged(result(WINRATE_FLOOR - 0.01))).toBe(true);
  });
});

describe("renderMarkdownReport", () => {
  it("renders a table row per virus and lists flagged matchups", () => {
    const markdown = renderMarkdownReport(VIRUSES, DEFENSES, [result(0.9)], 100);
    expect(markdown).toContain("| V1 | **90%** |");
    expect(markdown).toContain("**V1** vs **D1**: 90% attacker winrate (90/100).");
    expect(markdown).toContain("desc-v1");
    expect(markdown).toContain("desc-d1");
  });

  it("reports no flagged matchups when every result is in range", () => {
    const markdown = renderMarkdownReport(VIRUSES, DEFENSES, [result(0.5)], 100);
    expect(markdown).toContain("None — every matchup's attacker winrate is within the target band.");
    expect(markdown).not.toContain("**50%**"); // unflagged cells aren't bolded
  });

  it("throws if a result is missing for a virus x defense pair", () => {
    expect(() => renderMarkdownReport(VIRUSES, DEFENSES, [], 100)).toThrow();
  });
});
