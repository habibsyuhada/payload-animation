import { RULESET_V2, getAccountTierConfig } from "@payload/sim";
import type { DefenseGraph, DefenseNode, SheetEvent, VirusProgram } from "@payload/sim";

/**
 * 5 virus x 4 defense archetypes, all sized for account tier 1 (RULESET.md §1: 2400 KB payload /
 * 20pt defense budget / 1800 Core HP).
 *
 * V7.5: the virus side is re-authored as ruleset v2 event sheets. The five keep their old names
 * and their old *strategies* — pure aggression, pure evasion, conditional, tanky, pure scouting —
 * so the v1 report they replace stays a meaningful comparison, but each one now has to fit the
 * sheet's own economy: every row costs 40 KB on top of its conditions and actions, which is why a
 * couple of them run one tier lower than their v1 namesake. The KB figure in each description is
 * the sheet's real cost, asserted against 2400 KB in archetypes.test.ts rather than trusted.
 *
 * Defense archetypes are graphs and carry no ruleset version at all — they are unchanged.
 */

const TIER_1 = getAccountTierConfig(RULESET_V2, 1);

export interface VirusArchetype {
  readonly name: string;
  readonly description: string;
  readonly virus: VirusProgram;
  /** The account tier this sheet's payload budget is checked against (`archetypes.test.ts`).
   * Defaults to 1 when omitted. PLAN.md 8.8: `worm-split`+`detonate` are both depth-3 research
   * (capstone-adjacent) — a player who has them is nowhere near account tier 1, so "Swarm Bomber"
   * is deliberately checked at tier 2 rather than squeezed to fit a budget its own mechanics
   * outgrew. Nothing about *simulating* a battle reads this field — `simulate()` takes no account
   * tier at all, so it only matters to this one legality check. */
  readonly accountTier?: 1 | 2 | 3 | 4 | 5;
}

/** Terse row builder — the archetypes below read as rules, not as object literals. */
function rule(partial: Partial<SheetEvent>): SheetEvent {
  return { conditions: [], actions: [], children: [], ...partial };
}

export const VIRUS_ARCHETYPES: readonly VirusArchetype[] = [
  {
    name: "Brute Rush",
    description: "Satu baris: Brute Force I + Exploit I + jalan ke Core (2190 KB) — agresi murni, tanpa evasi atau sustain.",
    virus: {
      events: [rule({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "exploit", tier: 1 }, { kind: "move-toward-core" }] })],
    },
  },
  {
    name: "Ghost Crawler",
    description: "Memutari Honeypot yang terdeteksi, lalu merayap sambil memperbaiki diri (2280 KB) — nol blok serang.",
    virus: {
      events: [
        rule({ conditions: [{ kind: "honeypot-near", tier: 1 }], actions: [{ kind: "move-avoiding-hazards" }] }),
        rule({ actions: [{ kind: "slow-crawl", tier: 1 }, { kind: "self-repair", tier: 1 }, { kind: "move-random" }] }),
      ],
    },
  },
  {
    name: "Scanner Hunter",
    description: 'Exploit hanya saat berdiri di Firewall, Brute Force selalu (2350 KB) — kombo contoh GDD §4.2, sekarang bisa ditulis apa adanya.',
    virus: {
      events: [
        rule({ conditions: [{ kind: "node-here-is", targetNodeTypes: ["firewall"] }], actions: [{ kind: "exploit", tier: 1 }] }),
        rule({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "move-toward-core" }] }),
      ],
    },
  },
  {
    name: "Survivor",
    description: "Self Repair II + Decoy I yang menyala di bawah 50% Integrity, agresi konstan di bawahnya (2380 KB).",
    virus: {
      events: [
        rule({
          conditions: [{ kind: "integrity-below", integrityThresholdPermille: 500 }],
          actions: [{ kind: "self-repair", tier: 2 }, { kind: "arm-decoy", tier: 1 }],
        }),
        rule({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "move-random" }] }),
      ],
    },
  },
  {
    name: "Ghost Scout",
    description: "Sensor maksimal, tempur nol (2370 KB): selalu memutari bahaya, dan merayap begitu ada Honeypot/Trap dalam radius.",
    virus: {
      events: [
        rule({ actions: [{ kind: "move-avoiding-hazards" }] }),
        rule({ conditions: [{ kind: "honeypot-near", tier: 3 }], actions: [{ kind: "slow-crawl", tier: 1 }] }),
        rule({ conditions: [{ kind: "trap-near", tier: 2 }], actions: [{ kind: "slow-crawl", tier: 1 }] }),
      ],
    },
  },
  // --- PLAN.md 8.8: three archetypes for the mechanics 8.3/8.4 added that the original five never exercise. ---
  {
    name: "Swarm Bomber",
    description:
      "Selalu: pecah jadi 2 tubuh + jalan ke Core; begitu salah satu tubuh menduduki Breach Node, ia meledakkan diri (2970 KB, account tier 3) — worm-split + detonate, GDD §4.2's deferred combo.",
    accountTier: 3,
    virus: {
      events: [
        rule({ actions: [{ kind: "worm-split", tier: 1 }, { kind: "move-toward-core" }] }),
        rule({ conditions: [{ kind: "on-breach-node" }], actions: [{ kind: "detonate", tier: 1 }] }),
      ],
    },
  },
  {
    name: "Ghost Memory",
    description:
      "Menyalakan penanda begitu Honeypot terdeteksi, lalu SELAMANYA jalan acak alih-alih menuju Core sampai battle berakhir (2360 KB) — set-flag/flag-is, PLAN.md B.3's \"sheet yang punya ingatan\".",
    virus: {
      events: [
        rule({ conditions: [{ kind: "honeypot-near", tier: 1 }], actions: [{ kind: "set-flag", flagIndex: 0, flagValue: true }] }),
        rule({ conditions: [{ kind: "flag-is", flagIndex: 0 }], actions: [{ kind: "move-random" }] }),
        rule({ actions: [{ kind: "move-toward-core" }, { kind: "self-repair", tier: 1 }] }),
      ],
    },
  },
  {
    name: "Support Hunter",
    description: "Satu baris: jalan ke Core + Serang Node Pendukung I + Brute Force I (2290 KB) — target-strike, RULESET §5.1's damage-yang-ditunda-sejak-v1.",
    virus: {
      events: [rule({ actions: [{ kind: "move-toward-core" }, { kind: "target-strike", tier: 1 }, { kind: "brute-force", tier: 1 }] })],
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
    description:
      "Both entries converge onto ONE line: Trap I (2pt), Firewall II (5pt), ICE I riding the gap right after it (4pt) — 11pt total, every attacker takes the whole gauntlet, not just one branch of it.",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(8, "trap", 1),
        node(5, "firewall", 2),
        node(6, "ice-sentry", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 8, lengthDu: 300 },
        { from: 4, to: 8, lengthDu: 300 },
        { from: 8, to: 5, lengthDu: 300 },
        { from: 5, to: 6, lengthDu: 300 },
        { from: 6, to: 9, lengthDu: 300 },
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
  // --- PLAN.md 8.8: one archetype per node RULESET.md §14/PLAN.md A.1 added, each named for the
  // node it's built to test rather than for its shape (matching the plan's own naming). ---
  {
    name: "Patch Wall",
    description: "2x Firewall II (10pt) healed by a Patch Server II adjacent to both (4pt) + ICE I on the entry choke (4pt) — 18pt total. Tests grind vs sustain.",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "firewall", 2),
        node(6, "firewall", 2),
        node(7, "patch-server", 2),
        node(8, "ice-sentry", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 300 },
        { from: 4, to: 6, lengthDu: 300 },
        { from: 5, to: 9, lengthDu: 300 },
        { from: 6, to: 9, lengthDu: 300 },
        { from: 5, to: 7, lengthDu: 300 }, // patch-server, 1 hop from both firewalls
        { from: 6, to: 7, lengthDu: 300 },
        { from: 3, to: 8, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
  {
    name: "Tarpit Maze",
    description: "Tarpit II then Tarpit I (5pt) into Firewall I + Trap I (5pt) + ICE I riding the firewall's own radius (4pt) — 14pt total. Punishes Sprint/Exploit rushes that assume full speed all the way in.",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "tarpit", 2),
        node(6, "tarpit", 1),
        node(7, "firewall", 1),
        node(8, "trap", 1),
        node(10, "ice-sentry", 1),
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
        { from: 7, to: 10, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
  {
    name: "Jam Corridor",
    description: "Both entries converge through a Jammer II (4pt) before an ICE II (6pt) and Firewall I (3pt), with a Honeypot I decoy off to the side (3pt) — 16pt total. Sensor-reliant sheets can't see the ICE coming.",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "jammer", 2),
        node(6, "ice-sentry", 2),
        node(7, "firewall", 1),
        node(8, "honeypot", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 300 },
        { from: 4, to: 5, lengthDu: 300 },
        { from: 5, to: 6, lengthDu: 300 },
        { from: 6, to: 7, lengthDu: 300 },
        { from: 7, to: 9, lengthDu: 300 },
        { from: 3, to: 8, lengthDu: 300 }, // decoy dead-end
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
  {
    name: "Turnstile Spiral",
    description:
      "Turnstile II (3pt) -> Honeypot I ON THE ONLY ROUTE, not a decoy (3pt) -> Firewall I (3pt) -> Turnstile I (2pt) -> Core — 11pt total. v2 Honeypot is lethal on entry regardless of detection (only an armed Decoy saves you), and there is no second path around it to detect your way past; a body that survives still can't backtrack off the firewall to try again.",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "turnstile", 2),
        node(8, "honeypot", 1),
        node(6, "firewall", 1),
        node(7, "turnstile", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 300 },
        { from: 4, to: 5, lengthDu: 300 },
        { from: 5, to: 8, lengthDu: 300 }, // the only way through — no decoy branch to walk around it
        { from: 8, to: 6, lengthDu: 300 },
        { from: 6, to: 7, lengthDu: 300 },
        { from: 7, to: 9, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
  {
    name: "Alarm Nest",
    description: "Alarm Relay II (5pt) sitting right before two ICE I (4pt each) and a Firewall I (3pt) — 16pt total. Echoes RULESET §9's ICE Nest, but via network-wide escalation rather than overlapping radius.",
    graph: {
      nodes: [
        node(1, "entry"),
        node(2, "entry"),
        node(3, "router"),
        node(4, "router"),
        node(5, "alarm", 2),
        node(6, "ice-sentry", 1),
        node(7, "ice-sentry", 1),
        node(8, "firewall", 1),
        node(9, "core"),
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 300 },
        { from: 4, to: 5, lengthDu: 300 },
        { from: 5, to: 6, lengthDu: 300 },
        { from: 5, to: 7, lengthDu: 300 },
        { from: 6, to: 8, lengthDu: 300 },
        { from: 7, to: 8, lengthDu: 300 },
        { from: 8, to: 9, lengthDu: 300 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 9,
      coreHp: TIER_1.coreHp,
    },
  },
];
