import { describe, expect, it } from "vitest";
import { DEFENSE_NODE_TYPES_V2 } from "../../src/types.js";
import { V2_NODE_MODULE_TYPES } from "../../src/nodes-v2/index.js";

/**
 * ADR 0007's "1:1" invariant, made checkable instead of comment-only: nodes-v2/ must have exactly
 * one module per v2 node type. "entry" is the one deliberate exception — it has no combat-effect
 * module in v1's nodes/ either (see nodes/router.ts's docstring for why router still gets an empty
 * file but entry gets none: entry is never dispatched to by the engine's node-effect phase at all).
 */
describe("nodes-v2/ module coverage", () => {
  const behavioralTypes = DEFENSE_NODE_TYPES_V2.filter((type) => type !== "entry");

  it("has exactly one module per behavioral v2 node type, no more, no fewer", () => {
    expect([...V2_NODE_MODULE_TYPES].sort()).toEqual([...behavioralTypes].sort());
  });

  it("carries no duplicate NODE_TYPE markers", () => {
    expect(new Set(V2_NODE_MODULE_TYPES).size).toBe(V2_NODE_MODULE_TYPES.length);
  });
});
