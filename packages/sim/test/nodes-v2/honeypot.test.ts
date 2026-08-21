import { describe, expect, it } from "vitest";
import { honeypotIsLethalV2 } from "../../src/nodes-v2/honeypot.js";

/**
 * Unlike v1's honeypotIsLethal, v2's predicate takes only a decoy flag — detection no longer
 * grants immunity (ADR 0006 §8): `honeypot-near` is a condition the sheet reads and reacts to,
 * not an automatic save.
 */
describe("honeypotIsLethalV2", () => {
  it("is lethal with no decoy charge available", () => {
    expect(honeypotIsLethalV2(false)).toBe(true);
  });

  it("is not lethal with a Sacrifice Decoy charge available", () => {
    expect(honeypotIsLethalV2(true)).toBe(false);
  });
});
