import { RULESET_V1, getAccountTierConfig } from "@payload/sim";
import type { DefenseGraph, DefenseNode, VirusDesign } from "@payload/sim";

/**
 * 5 virus x 4 defense archetypes, all sized for account tier 1 (RULESET.md §1: 2400 KB
 * payload / 20pt defense budget / 1800 Core HP). Weights are tracked in comments for reviewers
 * even though simulate() itself doesn't enforce virus payload budget (S1.7 tests battle
 * outcomes, not the builder's own validation — that's C3.2's job) — every archetype here still
 * fits within 2400 KB for realism.
 */

const TIER_1 = getAccountTierConfig(RULESET_V1, 1);

export interface VirusArchetype {
  readonly name: string;
  readonly description: string;
  readonly virus: VirusDesign;
}

export const VIRUS_ARCHETYPES: readonly VirusArchetype[] = [
  {
    name: "Brute Rush",
    description: "Shortest Path + Brute Force I + Exploit I (2150 KB) — pure aggression, no evasion or sustain.",
    virus: {
      movement: { kind: "shortest-path" },
      blocks: [
        { kind: "brute-force", tier: 1 },
        { kind: "exploit", tier: 1 },
      ],
    },
  },
  {
    name: "Ghost Crawler",
    description: "Backtrack + Cloak I + Slow Crawl I + Detect Honeypot I + Self Repair I (2200 KB) — pure evasion, no Attack blocks at all.",
    virus: {
      movement: { kind: "backtrack" },
      blocks: [
        { kind: "cloak", tier: 1 },
        { kind: "slow-crawl", tier: 1 },
        { kind: "detect-honeypot", tier: 1 },
        { kind: "self-repair", tier: 1 },
      ],
    },
  },
  {
    name: "Scanner Hunter",
    description: 'Shortest Path + "IF Node=Firewall" I gating Exploit I, plus unconditional Brute Force I (2270 KB) — GDD\'s own example combo.',
    virus: {
      movement: { kind: "shortest-path" },
      blocks: [
        { kind: "if-node-type", tier: 1, targetNodeTypes: ["firewall"] },
        { kind: "exploit", tier: 1 },
        { kind: "brute-force", tier: 1 },
      ],
    },
  },
  {
    name: "Survivor",
    description: '"IF Integrity<50%" I gating Brute Force I, plus Self Repair II and Sacrifice Decoy II (2400 KB, exact budget) — tanky, reactive aggression.',
    virus: {
      movement: { kind: "random-walk" },
      blocks: [
        { kind: "self-repair", tier: 2 },
        { kind: "sacrifice-decoy", tier: 2 },
        { kind: "if-integrity-below", tier: 1 },
        { kind: "brute-force", tier: 1 },
      ],
    },
  },
  {
    name: "Ghost Scout",
    description: "Backtrack + Scan Ahead III + Detect Honeypot III + Cloak I (2250 KB) — maximum detection/evasion, zero combat capability.",
    virus: {
      movement: { kind: "backtrack" },
      blocks: [
        { kind: "scan-ahead", tier: 3 },
        { kind: "detect-honeypot", tier: 3 },
        { kind: "cloak", tier: 1 },
      ],
    },
  },
];

export interface DefenseArchetype {
  readonly name: string;
  readonly description: string;
  readonly graph: DefenseGraph;
}

function node(id: number, type: DefenseNode["type"], tier?: 1 | 2 | 3): DefenseNode {
  return tier === undefined ? { id, type } : { id, type, tier };
}

export const DEFENSE_ARCHETYPES: readonly DefenseArchetype[] = [
  {
    name: "Firewall Wall",
    description: "2x Firewall II (10pt) + ICE I + Trap I (18pt total) — brute-force resistance on both entry paths.",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "firewall", 2),
        node(6, "firewall", 2),
        node(7, "ice-sentry", 1),
        node(8, "trap", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 300 },
        { from: 4, to: 6, lengthDu: 300 },
        { from: 5, to: 9, lengthDu: 300 },
        { from: 6, to: 9, lengthDu: 300 },
        { from: 3, to: 7, lengthDu: 300 },
        { from: 4, to: 8, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
  {
    name: "ICE Nest",
    description: "2x ICE II (12pt) covering a shared Firewall I + Scanner I choke point (19pt total).",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "ice-sentry", 2),
        node(6, "ice-sentry", 2),
        node(7, "firewall", 1),
        node(8, "scanner", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 300 },
        { from: 4, to: 6, lengthDu: 300 },
        { from: 5, to: 7, lengthDu: 300 },
        { from: 6, to: 7, lengthDu: 300 },
        { from: 7, to: 8, lengthDu: 300 },
        { from: 8, to: 9, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
  {
    name: "Honeypot Maze",
    description: "Dead-end Honeypot I decoys off each entry router (lures Random Walk), real path guarded by Firewall I + Trap I (16pt total).",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "honeypot", 1),
        node(6, "firewall", 1),
        node(7, "firewall", 1),
        node(8, "honeypot", 1),
        node(10, "trap", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 300 }, // decoy dead-end
        { from: 4, to: 8, lengthDu: 300 }, // decoy dead-end
        { from: 3, to: 6, lengthDu: 300 },
        { from: 4, to: 7, lengthDu: 300 },
        { from: 6, to: 10, lengthDu: 300 },
        { from: 7, to: 10, lengthDu: 300 },
        { from: 10, to: 9, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
  {
    name: "Balanced Gauntlet",
    description: "One of every non-structural node type in a single line: Scanner I, ICE I, Honeypot I decoy, Firewall I, Trap I (15pt total).",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(5, "scanner", 1),
        node(6, "ice-sentry", 1),
        node(8, "honeypot", 1),
        node(7, "firewall", 1),
        node(10, "trap", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 3, lengthDu: 300 },
        { from: 3, to: 8, lengthDu: 300 }, // decoy dead-end
        { from: 3, to: 5, lengthDu: 300 },
        { from: 5, to: 6, lengthDu: 300 },
        { from: 6, to: 7, lengthDu: 300 },
        { from: 7, to: 10, lengthDu: 300 },
        { from: 10, to: 9, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
];
