import { describe, expect, it } from "vitest";
import { resolveCoreTickV2 } from "../../src/nodes-v2/core.js";

/** Seeded as an exact copy of nodes/core.test.ts's pure-function cases (8.1b: numbers unchanged from v1). */
describe("resolveCoreTickV2", () => {
  it("drains 15 HP passively, never counters back", () => {
    expect(resolveCoreTickV2(100)).toEqual({ remainingHp: 85, destroyed: false });
  });

  it("floors at 0 and reports destroyed", () => {
    expect(resolveCoreTickV2(5)).toEqual({ remainingHp: 0, destroyed: true });
  });

  it("is a pure function of currentHp — same input always drains the same amount", () => {
    expect(resolveCoreTickV2(1800)).toEqual(resolveCoreTickV2(1800));
  });
});
