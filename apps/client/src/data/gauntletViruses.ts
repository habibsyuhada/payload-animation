import type { VirusDesign } from "@payload/sim";

/**
 * gauntletViruses.ts — the reference attackers the Defend page throws at a player's own defense
 * ("Uji" button, see logic/defenseTest.ts).
 *
 * Why the defense has to be *simulated* rather than merely validated: validateDefenseGraph only
 * checks shape (entry/core counts, edge lengths, budget, that a path to Core exists at all). A
 * path guarded by two overlapping ICE Sentries is still a path — RULESET.md §9 records exactly
 * that composition ("ICE Nest") beating all five virus archetypes 100% of the time. The only way
 * to know a defense can be breached is to watch something breach it.
 *
 * These five mirror tools/balance-lab's own VIRUS_ARCHETYPES (RULESET.md §9's cast, all sized for
 * account tier 1) and are deliberately spread across strategies — pure aggression, pure evasion,
 * conditional, tanky — so a defense that stops all five is stopping genuinely different attacks,
 * not one attack five times. They are re-declared here rather than imported because the boundaries
 * rule (eslint.config.js) forbids an `app` importing a `tool`: balance-lab is an offline CLI over
 * fixed archetypes, this is a runtime check against a live player graph. If balance-lab's roster
 * changes, this list is worth revisiting — the numbers themselves come from @payload/sim either
 * way, so the two can't disagree about what a block *does*, only about which builds get tried.
 */

export interface GauntletVirus {
  readonly id: string;
  readonly name: string;
  /** One line, shown to the player next to the result — why this attacker is in the line-up. */
  readonly description: string;
  readonly virus: VirusDesign;
}

export const GAUNTLET_VIRUSES: readonly GauntletVirus[] = [
  {
    id: "brute-rush",
    name: "Brute Rush",
    description: "Jalur terpendek, dua blok serang. Uji kekuatan mentah pertahananmu.",
    virus: {
      movement: { kind: "shortest-path" },
      blocks: [
        { kind: "brute-force", tier: 1 },
        { kind: "exploit", tier: 1 },
      ],
    },
  },
  {
    id: "ghost-crawler",
    name: "Ghost Crawler",
    description: "Tanpa blok serang sama sekali — menyelinap, memperbaiki diri, menghindari Honeypot.",
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
    id: "scanner-hunter",
    name: "Scanner Hunter",
    description: "Exploit yang hanya menyala saat menghadapi Firewall, plus Brute Force tetap.",
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
    id: "survivor",
    name: "Survivor",
    description: "Tebal dan reaktif: Self Repair II + Sacrifice Decoy II, menyerang saat terdesak.",
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
    id: "ghost-scout",
    name: "Ghost Scout",
    description: "Deteksi maksimal, tempur nol. Uji apakah pertahananmu bisa dilewati tanpa dilawan.",
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
