import { describe, expect, it } from "vitest";
import { getScannerConfigV2 } from "../../src/nodes-v2/scanner.js";

/** Seeded as an exact copy of v1's scanner config (8.1b: numbers unchanged). */
describe("getScannerConfigV2", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(getScannerConfigV2(1)).toEqual({ tier: 1, radiusHops: 1, durationTicks: 6, iceAccuracyBonusPermille: 150 });
    expect(getScannerConfigV2(3)).toEqual({ tier: 3, radiusHops: 2, durationTicks: 10, iceAccuracyBonusPermille: 250 });
  });
});
