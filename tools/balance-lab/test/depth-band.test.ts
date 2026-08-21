import { describe, expect, it } from "vitest";
import { defenseDepthBand, virusDepthBand } from "../src/depth-band.js";

describe("virusDepthBand", () => {
  it("is 0 for an Inti-only sheet", () => {
    expect(
      virusDepthBand({
        events: [{ conditions: [{ kind: "at-node" }], actions: [{ kind: "move-toward-core" }], children: [] }],
      }),
    ).toBe(0);
  });

  it("reads the deepest condition or action used, tier-independent for conditions", () => {
    // core-within-hops is serbuan depth 1, regardless of `hops`.
    expect(
      virusDepthBand({
        events: [{ conditions: [{ kind: "core-within-hops", hops: 5 }], actions: [{ kind: "move-toward-core" }], children: [] }],
      }),
    ).toBe(1);
  });

  it("charges the tier ceiling for a tiered action, not just its base unlock", () => {
    // exploit is a full I->II->III chain: tier 3 needs serbuan.exploit.3 (depth 3).
    expect(virusDepthBand({ events: [{ conditions: [], actions: [{ kind: "exploit", tier: 3 }], children: [] }] })).toBe(3);
    expect(virusDepthBand({ events: [{ conditions: [], actions: [{ kind: "exploit", tier: 1 }], children: [] }] })).toBe(1);
  });

  it("walks nested children too", () => {
    expect(
      virusDepthBand({
        events: [{ conditions: [], actions: [{ kind: "move-toward-core" }], children: [{ conditions: [], actions: [{ kind: "worm-split", tier: 3 }], children: [] }] }],
      }),
    ).toBe(4); // replikasi.worm-split.3 is the depth-4 capstone.
  });
});

describe("defenseDepthBand", () => {
  it("is 0 for entry/core/router alone", () => {
    expect(
      defenseDepthBand({
        nodes: [
          { id: 1, type: "entry" },
          { id: 2, type: "core" },
          { id: 3, type: "router" },
        ],
        edges: [],
        entryNodeIds: [1],
        coreNodeId: 2,
        coreHp: 1800,
      }),
    ).toBe(0);
  });

  it("charges the tier ceiling for a tiered node", () => {
    expect(
      defenseDepthBand({
        nodes: [
          { id: 1, type: "entry" },
          { id: 2, type: "core" },
          { id: 3, type: "ice-sentry", tier: 3 },
        ],
        edges: [],
        entryNodeIds: [1],
        coreNodeId: 2,
        coreHp: 1800,
      }),
    ).toBe(3); // pengintaian.ice-sentry.3
  });
});
