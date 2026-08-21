import { describe, expect, it } from "vitest";
import { trapTriggerDamageV2 } from "../../src/nodes-v2/trap.js";

/** Seeded as an exact copy of v1's trap damage table (8.1b: numbers unchanged). */
describe("trapTriggerDamageV2", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(trapTriggerDamageV2(1)).toBe(180);
    expect(trapTriggerDamageV2(2)).toBe(260);
    expect(trapTriggerDamageV2(3)).toBe(350);
  });
});
