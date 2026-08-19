import type { DefenseGraph, DefenseNode } from "@payload/sim";
import type { Layout } from "@payload/replay";

/**
 * practiceDefenses.ts — C3.2's "3 pertahanan latihan" for Virus Lab's dry-run simulation.
 * account-tier-1 coreHp (1800, RULESET.md §5.2/ruleset.ts's ACCOUNT_TIERS_V1) throughout, since
 * there's no real account-tier system yet (Fase 4/5) — these are fixed local fixtures, not
 * player-authored topologies, so they don't need to pass validateDefenseGraph's defense-budget
 * check either.
 */

export interface PracticeDefense {
  readonly id: string;
  readonly label: string;
  readonly difficulty: "mudah" | "sedang" | "sulit";
  readonly graph: DefenseGraph;
  readonly layout: Layout;
}

const TIER_1_CORE_HP = 1800;

export const PRACTICE_DEFENSES: readonly PracticeDefense[] = [
  {
    id: "router-only",
    label: "Latihan I — Koridor Terbuka",
    difficulty: "mudah",
    graph: {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 500 },
        { from: 2, to: 3, lengthDu: 500 },
        { from: 3, to: 4, lengthDu: 700 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: TIER_1_CORE_HP,
    },
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 200 }, 3: { x: 220, y: 120 }, 4: { x: 420, y: 120 } } },
  },
  {
    id: "single-firewall",
    label: "Latihan II — Firewall Tunggal",
    difficulty: "sedang",
    graph: {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 2 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 400 },
        { from: 2, to: 3, lengthDu: 400 },
        { from: 3, to: 4, lengthDu: 500 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: TIER_1_CORE_HP,
    },
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 200 }, 3: { x: 220, y: 120 }, 4: { x: 420, y: 120 } } },
  },
  {
    id: "firewall-and-ice",
    label: "Latihan III — Firewall + ICE Sentry",
    difficulty: "sulit",
    graph: {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 2 },
        { id: 5, type: "ice-sentry", tier: 2 },
        { id: 6, type: "scanner", tier: 1 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 400 },
        { from: 2, to: 3, lengthDu: 400 },
        { from: 3, to: 6, lengthDu: 200 },
        { from: 6, to: 5, lengthDu: 200 },
        { from: 3, to: 4, lengthDu: 500 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: TIER_1_CORE_HP,
    },
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 260 }, 3: { x: 220, y: 150 }, 6: { x: 340, y: 60 }, 5: { x: 460, y: 60 }, 4: { x: 420, y: 220 } } },
  },
];
