import type { SheetEvent, VirusProgram } from "@payload/sim";

/**
 * gauntletViruses.ts — the reference attackers the Defend page throws at a player's own defense
 * ("Uji" button, see logic/defenseTest.ts).
 *
 * Why the defense has to be *simulated* rather than merely validated: validateDefenseGraph only
 * checks shape (entry/core counts, edge lengths, budget, that a path to Core exists at all). A
 * path guarded by two overlapping ICE Sentries is still a path — RULESET.md §9/§13 records exactly
 * that composition ("ICE Nest") beating everything we can throw at it, in v1 and still in v2. The
 * only way to know a defense can be breached is to watch something breach it.
 *
 * V7.5: re-authored as ruleset v2 event sheets. These five mirror tools/balance-lab's own
 * VIRUS_ARCHETYPES (all sized for account tier 1) and are deliberately spread across strategies —
 * pure aggression, pure evasion, conditional, tanky, pure scouting — so a defense that stops all
 * five is stopping genuinely different attacks, not one attack five times. They are re-declared
 * here rather than imported because the boundaries rule (eslint.config.js) forbids an `app`
 * importing a `tool`: balance-lab is an offline CLI over fixed archetypes, this is a runtime check
 * against a live player graph. If balance-lab's roster changes, this list is worth revisiting.
 *
 * A sheet here carries no `SheetEvent.id`, so the engine addresses each row by its path ("1.0")
 * and the Defend page's rule chips can be keyed by the same walk — see logic/attackPlayback.ts.
 */

function rule(partial: Partial<SheetEvent>): SheetEvent {
  return { conditions: [], actions: [], children: [], ...partial };
}

export interface GauntletVirus {
  readonly id: string;
  readonly name: string;
  /** One line, shown to the player next to the result — why this attacker is in the line-up. */
  readonly description: string;
  readonly virus: VirusProgram;
}

export const GAUNTLET_VIRUSES: readonly GauntletVirus[] = [
  {
    id: "brute-rush",
    name: "Brute Rush",
    description: "Satu aturan, jalur terpendek, dua aksi serang. Uji kekuatan mentah pertahananmu.",
    virus: {
      events: [rule({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "exploit", tier: 1 }, { kind: "move-toward-core" }] })],
    },
  },
  {
    id: "ghost-crawler",
    name: "Ghost Crawler",
    description: "Tanpa aksi serang sama sekali — memutari Honeypot yang terdeteksi, lalu merayap sambil memperbaiki diri.",
    virus: {
      events: [
        rule({ conditions: [{ kind: "honeypot-near", tier: 1 }], actions: [{ kind: "move-avoiding-hazards" }] }),
        rule({ actions: [{ kind: "slow-crawl", tier: 1 }, { kind: "self-repair", tier: 1 }, { kind: "move-random" }] }),
      ],
    },
  },
  {
    id: "scanner-hunter",
    name: "Scanner Hunter",
    description: "Exploit hanya saat berdiri di Firewall, Brute Force tetap jalan di bawahnya.",
    virus: {
      events: [
        rule({ conditions: [{ kind: "node-here-is", targetNodeTypes: ["firewall"] }], actions: [{ kind: "exploit", tier: 1 }] }),
        rule({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "move-toward-core" }] }),
      ],
    },
  },
  {
    id: "survivor",
    name: "Survivor",
    description: "Tebal dan reaktif: Self Repair II + Decoy menyala di bawah 50% Integrity, menyerang terus di bawahnya.",
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
    id: "ghost-scout",
    name: "Ghost Scout",
    description: "Sensor maksimal, tempur nol. Uji apakah pertahananmu bisa dilewati tanpa dilawan.",
    virus: {
      events: [
        rule({ actions: [{ kind: "move-avoiding-hazards" }] }),
        rule({ conditions: [{ kind: "honeypot-near", tier: 3 }], actions: [{ kind: "slow-crawl", tier: 1 }] }),
        rule({ conditions: [{ kind: "trap-near", tier: 2 }], actions: [{ kind: "slow-crawl", tier: 1 }] }),
      ],
    },
  },
];
