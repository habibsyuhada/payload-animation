import { describe, expect, it } from "vitest";
import { simulate } from "../src/engine.js";
import type { BattleInput, BattleLog, DefenseGraph, DefenseNode } from "../src/types.js";

/**
 * S1.6: this file runs under BOTH the Node project and the browser (Chromium/Playwright)
 * project (see vitest.config.ts) — the whole point is that the exact same BattleInput produces
 * a byte-identical BattleLog on both platforms. Hashing (not just re-running simulate() and
 * diffing) makes a silent divergence loud: any drift in event order, a stray float, or a
 * platform-specific API leaking into packages/sim would change the hash.
 *
 * The hash itself is hand-rolled (djb2 variant) and uses ONLY integer bitwise ops — no Node
 * `crypto`/`Buffer` (unavailable in the browser project) and no reliance on any host API whose
 * behavior could differ between a browser's V8 and Node's V8.
 */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function djb2Hash(input: string): string {
  let hash = 5381 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function hashBattleLog(log: BattleLog): string {
  return djb2Hash(stableStringify(log));
}

function node(id: number, type: DefenseNode["type"], tier?: 1 | 2 | 3): DefenseNode {
  return tier === undefined ? { id, type } : { id, type, tier };
}

/** Straight line, pure movement, no combat. */
const SCENARIO_MOVEMENT_ONLY: BattleInput = {
  rulesetVersion: "v1",
  seed: 1,
  virus: { movement: { kind: "shortest-path" }, blocks: [] },
  defense: {
    nodes: [node(1, "entry"), node(2, "entry"), node(3, "router"), node(4, "core")],
    edges: [
      { from: 1, to: 3, lengthDu: 400 },
      { from: 2, to: 3, lengthDu: 400 },
      { from: 3, to: 4, lengthDu: 600 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
    coreHp: 100,
  } satisfies DefenseGraph,
};

/** Branching + cyclic graph, exercises Random Walk's RNG-driven pathing. */
const SCENARIO_RANDOM_WALK: BattleInput = {
  rulesetVersion: "v1",
  seed: 7,
  virus: { movement: { kind: "random-walk" }, blocks: [] },
  defense: {
    nodes: [node(1, "entry"), node(2, "entry"), node(3, "router"), node(4, "router"), node(5, "router"), node(6, "core")],
    edges: [
      { from: 1, to: 3, lengthDu: 300 },
      { from: 2, to: 4, lengthDu: 300 },
      { from: 3, to: 4, lengthDu: 300 },
      { from: 3, to: 5, lengthDu: 300 },
      { from: 4, to: 5, lengthDu: 300 },
      { from: 5, to: 6, lengthDu: 300 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 6,
    coreHp: 100,
  } satisfies DefenseGraph,
};

/** Every node class + several logic blocks in one battle: the broadest single code-path exerciser. */
const SCENARIO_FULL_COMBAT: BattleInput = {
  rulesetVersion: "v1",
  seed: 11,
  virus: {
    movement: { kind: "backtrack" },
    blocks: [
      { kind: "scan-ahead", tier: 3 },
      { kind: "detect-honeypot", tier: 2 },
      { kind: "if-node-type", tier: 1, targetNodeTypes: ["firewall"] },
      { kind: "brute-force", tier: 2 },
      { kind: "cloak", tier: 2 },
      { kind: "self-repair", tier: 2 },
      { kind: "sacrifice-decoy", tier: 2 },
    ],
  },
  defense: {
    nodes: [
      node(1, "entry"),
      node(2, "entry"),
      node(3, "router"),
      node(4, "firewall", 1),
      node(5, "ice-sentry", 1),
      node(6, "scanner", 1),
      node(7, "trap", 1),
      node(8, "honeypot", 1),
      node(9, "core"),
    ],
    edges: [
      { from: 1, to: 3, lengthDu: 300 },
      { from: 2, to: 3, lengthDu: 300 },
      { from: 3, to: 4, lengthDu: 300 },
      { from: 3, to: 5, lengthDu: 300 },
      { from: 4, to: 6, lengthDu: 300 },
      { from: 4, to: 7, lengthDu: 300 },
      { from: 6, to: 8, lengthDu: 300 },
      { from: 7, to: 9, lengthDu: 300 },
      { from: 8, to: 9, lengthDu: 300 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 9,
    coreHp: 200,
  } satisfies DefenseGraph,
};

/** Core unreachable — exercises the 1200-tick timeout path. */
const SCENARIO_TIMEOUT: BattleInput = {
  rulesetVersion: "v1",
  seed: 1,
  virus: { movement: { kind: "shortest-path" }, blocks: [] },
  defense: {
    nodes: [node(1, "entry"), node(2, "entry"), node(3, "core")],
    edges: [],
    entryNodeIds: [1, 2],
    coreNodeId: 3,
    coreHp: 1800,
  } satisfies DefenseGraph,
};

describe("cross-platform determinism (S1.6)", () => {
  it.each([
    ["movement-only", SCENARIO_MOVEMENT_ONLY, "67c3151a"],
    ["random-walk", SCENARIO_RANDOM_WALK, "4cf75c6a"],
    ["full-combat", SCENARIO_FULL_COMBAT, "030c3fd7"],
    ["timeout", SCENARIO_TIMEOUT, "552300e8"],
  ])("BattleLog hash for %s matches the frozen cross-platform value", (_name, input, expectedHash) => {
    expect(hashBattleLog(simulate(input))).toBe(expectedHash);
  });

  it("is a pure function of the input — hashing the same BattleInput twice in this same run agrees", () => {
    expect(hashBattleLog(simulate(SCENARIO_FULL_COMBAT))).toBe(hashBattleLog(simulate(SCENARIO_FULL_COMBAT)));
  });
});
