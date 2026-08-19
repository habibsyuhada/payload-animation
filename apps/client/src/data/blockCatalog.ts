import type { BlockTier, LogicBlockKind, MovementBlockKind } from "@payload/sim";

/**
 * blockCatalog.ts — C3.2: display/weight data for Virus Lab's builder, mirrored by hand from
 * docs/RULESET.md §3 (Movement) and §4 (12 logic blocks). packages/sim deliberately does NOT
 * model payload weight (see its ruleset.ts comment: "belongs to virus-budget validation, not
 * battle physics") — this is that validation layer's own data, so it lives here rather than in
 * sim. If RULESET.md's weight numbers ever change, this table needs a matching edit; there's no
 * way to derive it from sim automatically without sim starting to care about a concern that isn't
 * its job.
 */

export type BlockCategory = "movement" | "sensor" | "condition" | "attack" | "stealth" | "utility";

export interface MovementCatalogEntry {
  readonly kind: MovementBlockKind;
  readonly label: string;
  readonly weightKb: number;
  readonly speedDuPerTick: number;
  readonly description: string;
}

export const MOVEMENT_CATALOG: readonly MovementCatalogEntry[] = [
  { kind: "shortest-path", label: "Shortest Path", weightKb: 800, speedDuPerTick: 50, description: "Dijkstra deterministik ke Core, dibobot total jarak DU." },
  { kind: "random-walk", label: "Random Walk", weightKb: 500, speedDuPerTick: 55, description: "Pilih edge acak (seeded) dari node saat ini; tak revisit kecuali buntu." },
  { kind: "backtrack", label: "Backtrack", weightKb: 600, speedDuPerTick: 50, description: "Seperti Shortest Path, tapi mundur dari Trap/Honeypot yang terdeteksi Sensor." },
];

export interface LogicBlockTierEntry {
  readonly tier: BlockTier;
  readonly weightKb: number;
  readonly description: string;
}

export interface LogicBlockCatalogEntry {
  readonly kind: LogicBlockKind;
  readonly category: BlockCategory;
  readonly label: string;
  readonly tiers: readonly LogicBlockTierEntry[];
}

export const LOGIC_BLOCK_CATALOG: readonly LogicBlockCatalogEntry[] = [
  {
    kind: "scan-ahead",
    category: "sensor",
    label: "Scan Ahead",
    tiers: [
      { tier: 1, weightKb: 400, description: "Ungkap tipe node 1 di depan." },
      { tier: 2, weightKb: 500, description: "Radius 2 node di depan." },
      { tier: 3, weightKb: 600, description: "Radius 2 + ungkap Trap tersembunyi." },
    ],
  },
  {
    kind: "detect-honeypot",
    category: "sensor",
    label: "Detect Honeypot",
    tiers: [
      { tier: 1, weightKb: 350, description: "Deteksi Honeypot radius 1 node." },
      { tier: 2, weightKb: 450, description: "Radius 2 node." },
      { tier: 3, weightKb: 550, description: "Radius 2 + tembus penyamaran sbg Core." },
    ],
  },
  {
    kind: "if-integrity-below",
    category: "condition",
    label: "IF Integrity < X%",
    tiers: [
      { tier: 1, weightKb: 150, description: "Threshold tetap 50%." },
      { tier: 2, weightKb: 180, description: "Threshold 25–75% (kelipatan 5)." },
      { tier: 3, weightKb: 220, description: "Threshold 10–90% + trigger sekunder di 15%." },
    ],
  },
  {
    kind: "if-node-type",
    category: "condition",
    label: "IF Node = Firewall",
    tiers: [
      { tier: 1, weightKb: 120, description: "True jika node tujuan langsung Firewall." },
      { tier: 2, weightKb: 150, description: "Juga true untuk node 2 langkah (butuh Sensor)." },
      { tier: 3, weightKb: 180, description: "Bisa target Firewall ATAU ICE Sentry." },
    ],
  },
  {
    kind: "if-scanned",
    category: "condition",
    label: "IF Scanned",
    tiers: [
      { tier: 1, weightKb: 130, description: "True jika status \"scanned\" aktif." },
      { tier: 2, weightKb: 160, description: "Juga true 2 tick sebelum status berakhir." },
      { tier: 3, weightKb: 200, description: "Juga true jika sedang target-lock ICE Sentry." },
    ],
  },
  {
    kind: "brute-force",
    category: "attack",
    label: "Brute Force",
    tiers: [
      { tier: 1, weightKb: 700, description: "+40 damage/tick ke Breach Node yang di-occupy." },
      { tier: 2, weightKb: 900, description: "+60/tick." },
      { tier: 3, weightKb: 1100, description: "+85/tick." },
    ],
  },
  {
    kind: "exploit",
    category: "attack",
    label: "Exploit",
    tiers: [
      { tier: 1, weightKb: 650, description: "Damage one-shot 250 saat masuk Breach Node." },
      { tier: 2, weightKb: 800, description: "380." },
      { tier: 3, weightKb: 950, description: "520." },
    ],
  },
  {
    kind: "overload",
    category: "attack",
    label: "Overload",
    tiers: [
      { tier: 1, weightKb: 750, description: "Node hancur → splash 150 ke Breach Node tetangga (1 hop)." },
      { tier: 2, weightKb: 950, description: "Splash 230, radius tetap 1." },
      { tier: 3, weightKb: 1150, description: "Splash 320, radius 2 hop." },
    ],
  },
  {
    kind: "cloak",
    category: "stealth",
    label: "Cloak",
    tiers: [
      { tier: 1, weightKb: 500, description: "3 node pertama: kebal \"scanned\" & ICE Sentry." },
      { tier: 2, weightKb: 650, description: "Durasi 4 node." },
      { tier: 3, weightKb: 800, description: "Durasi 5 node + radius deteksi Scanner −50%." },
    ],
  },
  {
    kind: "slow-crawl",
    category: "stealth",
    label: "Slow Crawl",
    tiers: [
      { tier: 1, weightKb: 300, description: "Speed ×70%, akurasi ICE Sentry −30%." },
      { tier: 2, weightKb: 380, description: "Speed ×75%, akurasi −40%." },
      { tier: 3, weightKb: 460, description: "Speed ×80%, akurasi −50%." },
    ],
  },
  {
    kind: "self-repair",
    category: "utility",
    label: "Self Repair",
    tiers: [
      { tier: 1, weightKb: 450, description: "+5 Integrity/tick di luar Breach Node." },
      { tier: 2, weightKb: 550, description: "+8/tick." },
      { tier: 3, weightKb: 650, description: "+12/tick." },
    ],
  },
  {
    kind: "sacrifice-decoy",
    category: "utility",
    label: "Sacrifice Decoy",
    tiers: [
      { tier: 1, weightKb: 400, description: "1x per battle, arm di ≤20% Integrity." },
      { tier: 2, weightKb: 500, description: "2x per battle (re-arm tiap -20%)." },
      { tier: 3, weightKb: 600, description: "3x per battle, tiap aktivasi serap 2 trigger." },
    ],
  },
];

export function findLogicBlockEntry(kind: LogicBlockKind): LogicBlockCatalogEntry {
  const entry = LOGIC_BLOCK_CATALOG.find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new Error(`blockCatalog: no catalog entry for logic block kind ${kind}`);
  }
  return entry;
}

export function findLogicBlockWeightKb(kind: LogicBlockKind, tier: BlockTier): number {
  const entry = findLogicBlockEntry(kind);
  const tierEntry = entry.tiers.find((candidate) => candidate.tier === tier);
  if (!tierEntry) {
    throw new Error(`blockCatalog: no tier ${tier} for logic block ${kind}`);
  }
  return tierEntry.weightKb;
}

export function findMovementEntry(kind: MovementBlockKind): MovementCatalogEntry {
  const entry = MOVEMENT_CATALOG.find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new Error(`blockCatalog: no catalog entry for movement kind ${kind}`);
  }
  return entry;
}
