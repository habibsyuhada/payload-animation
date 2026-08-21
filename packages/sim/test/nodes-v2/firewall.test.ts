import { describe, expect, it } from "vitest";
import { firewallMaxHpV2, resolveFirewallTickV2 } from "../../src/nodes-v2/firewall.js";

/** Seeded as an exact copy of nodes/firewall.test.ts's pure-function cases (8.1b: numbers unchanged from v1). */
describe("firewallMaxHpV2", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(firewallMaxHpV2(1)).toBe(500);
    expect(firewallMaxHpV2(2)).toBe(800);
    expect(firewallMaxHpV2(3)).toBe(1200);
  });
});

describe("resolveFirewallTickV2", () => {
  it("drains 15 HP passively and still counters even while far from destroyed", () => {
    const result = resolveFirewallTickV2(500, 1);
    expect(result).toEqual({ remainingHp: 485, counterDamageToVirus: 20, destroyed: false });
  });

  it("floors at 0 HP and reports destroyed once drained past zero", () => {
    const result = resolveFirewallTickV2(5, 1);
    expect(result).toEqual({ remainingHp: 0, counterDamageToVirus: 20, destroyed: true });
  });

  it("uses the tier's own counter-damage figure", () => {
    expect(resolveFirewallTickV2(1200, 3).counterDamageToVirus).toBe(45);
  });
});
