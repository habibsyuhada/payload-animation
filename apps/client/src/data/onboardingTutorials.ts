import type { BattleInput, DefenseGraph, DefenseNode, VirusDesign } from "@payload/sim";
import type { Layout } from "@payload/replay";
/**
 * Onboarding's own colour buckets. They used to be v1's `BlockCategory`, which died with the block
 * chain (V7.3) — the tutorials still speak in categories, so they now own the type rather than
 * keeping a 200-line v1 catalog alive for one import.
 */
export type BlockCategory = "movement" | "sensor" | "condition" | "attack" | "stealth" | "utility";

/**
 * onboardingTutorials.ts — C3.4: 5 fixed battles vs a static AI defense, each built around one
 * non-Movement block category (GDD's onboarding spec: "5 battle tutorial... masing-masing
 * memperkenalkan 1 kategori blok"). Movement itself isn't its own tutorial since every virus
 * needs one regardless — these 5 cover Sensor/Condition/Attack/Stealth/Utility.
 *
 * Every fixture here was run through `simulate()` directly while writing this file (not just
 * hand-derived) to confirm the category actually mattered for the outcome — same "don't trust
 * hand math, run it" discipline as packages/sim's own golden logs.
 */
export interface OnboardingTutorial {
  readonly id: string;
  readonly title: string;
  readonly category: BlockCategory;
  readonly narrative: string;
  readonly virus: VirusDesign;
  readonly defense: DefenseGraph;
  readonly layout: Layout;
  readonly seed: number;
  /** PLAN.md §C.4: "tiap tutorial menyelesaikan satu simpul depth-1 di cabang yang ia ajarkan" —
   * the research node this tutorial's completion grants for free, alongside its Data reward. */
  readonly rewardResearchNodeId: string;
}

const TIER_1_CORE_HP = 1800;

export const ONBOARDING_TUTORIALS: readonly OnboardingTutorial[] = [
  {
    id: "sensor",
    title: "Tutorial 1 — Sensor",
    category: "sensor",
    narrative:
      "Rute terpendek ke Core lewat sebuah Honeypot yang tersamar sebagai jalan aman. Tanpa Detect Honeypot, virus akan mengambil rute pendek itu dan mati seketika. Dengan Detect Honeypot + Backtrack, virus mengendus perangkap itu dari jauh dan memutar lewat rute yang lebih panjang tapi selamat.",
    virus: { movement: { kind: "backtrack" }, blocks: [{ kind: "detect-honeypot", tier: 1 }] },
    defense: {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
        { id: 4, type: "honeypot", tier: 1 },
        { id: 5, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 3, lengthDu: 300 },
        { from: 3, to: 4, lengthDu: 200 },
        { from: 4, to: 5, lengthDu: 200 },
        { from: 3, to: 5, lengthDu: 900 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 5,
      coreHp: TIER_1_CORE_HP,
    },
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 260 }, 3: { x: 200, y: 150 }, 4: { x: 350, y: 60 }, 5: { x: 500, y: 150 } } },
    seed: 1001,
    rewardResearchNodeId: "pengintaian.honeypot-near",
  },
  {
    id: "condition",
    title: "Tutorial 2 — Condition",
    category: "condition",
    narrative:
      "Satu-satunya jalan ke Core lewat sebuah Firewall. Blok Condition \"IF Node = Firewall\" mengaktifkan Exploit hanya saat dibutuhkan — tanpa Condition, Exploit tetap terpasang tapi caranya sama; yang berubah di sini adalah bagaimana rantai blok bereaksi terhadap node di depan.",
    virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "if-node-type", tier: 1, targetNodeTypes: ["firewall"] }, { kind: "exploit", tier: 2 }] },
    defense: {
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
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 260 }, 3: { x: 250, y: 150 }, 4: { x: 470, y: 150 } } },
    seed: 1002,
    rewardResearchNodeId: "serbuan.core-within-hops",
  },
  {
    id: "attack",
    title: "Tutorial 3 — Attack",
    category: "attack",
    narrative:
      "Firewall tier tinggi butuh damage sungguhan untuk ditembus, bukan cuma waktu. Brute Force menambah damage per-tick di atas passive drain — bandingkan kecepatan tembus dengan Tutorial 2 yang cuma mengandalkan drain pasif.",
    virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 2 }] },
    defense: {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 3 },
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
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 260 }, 3: { x: 250, y: 150 }, 4: { x: 470, y: 150 } } },
    seed: 1003,
    rewardResearchNodeId: "serbuan.exploit.1",
  },
  {
    id: "stealth",
    title: "Tutorial 4 — Stealth",
    category: "stealth",
    narrative:
      "Dua ICE Sentry menjaga koridor menuju Core. Cloak membuat 3 node pertama yang dilalui virus bukan target valid ICE Sentry — cukup untuk melewati penjagaan ini tanpa baku tembak.",
    virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "cloak", tier: 2 }] },
    defense: {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
        { id: 5, type: "ice-sentry", tier: 2 },
        { id: 6, type: "ice-sentry", tier: 2 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 3, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 150 },
        { from: 3, to: 6, lengthDu: 150 },
        { from: 3, to: 4, lengthDu: 400 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: TIER_1_CORE_HP,
    },
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 300 }, 3: { x: 220, y: 170 }, 5: { x: 350, y: 60 }, 6: { x: 350, y: 300 }, 4: { x: 470, y: 170 } } },
    seed: 1004,
    rewardResearchNodeId: "bayangan.cloak.1",
  },
  {
    id: "utility",
    title: "Tutorial 5 — Utility",
    category: "utility",
    narrative:
      "Firewall ini membalas damage tiap tick selagi ditembus. Self Repair menyembuhkan Integrity virus di antara serangan, memperpanjang napas untuk menembus lebih dalam sebelum Integrity habis.",
    virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 1 }, { kind: "self-repair", tier: 2 }] },
    defense: {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 3 },
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
    layout: { positions: { 1: { x: 20, y: 40 }, 2: { x: 20, y: 260 }, 3: { x: 250, y: 150 }, 4: { x: 470, y: 150 } } },
    seed: 1005,
    rewardResearchNodeId: "replikasi.self-repair.1",
  },
];

export function toBattleInput(tutorial: OnboardingTutorial): BattleInput {
  return { rulesetVersion: "v1", seed: tutorial.seed, virus: tutorial.virus, defense: tutorial.defense };
}
