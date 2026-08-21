import type { BlockTier, DefenseNodeType } from "@payload/sim";

/**
 * defenseNodeCatalog.ts — C3.3: display data for Defense Grid's palette. Node COSTS themselves
 * come straight from `getDefenseNodeCost()` (@payload/sim/ruleset.ts) rather than being mirrored
 * here — unlike blockCatalog.ts's payload weights, sim already models defense-node cost (it's
 * part of `validateDefenseGraph`'s own budget check), so there's no reason to duplicate it. Per-
 * tier `description` text below is mirrored by hand from docs/RULESET.md §5.1's node table for
 * the same reason blockCatalog.ts mirrors its own block descriptions: sim only tracks the combat
 * math it actually needs for v1 (e.g. Firewall's HP/counter-damage — ruleset.ts's own comment
 * notes ICE Sentry/Scanner HP is display-only, not yet a real destructible stat), not flavor text.
 *
 * Colors intentionally echo packages/replay/src/draw.ts's NODE_COLOR palette (same GDD node
 * taxonomy, so same visual language makes sense) but are redeclared here rather than imported —
 * the boundaries rule (eslint.config.js) forbids `app`/`ui` code reaching into `replay`'s
 * internals, and `draw.ts`'s NODE_COLOR was never exported as public API anyway.
 */

/** A silhouette a node type renders as on the grid — distinct per type so nodes read apart by
 * shape alone, not just fill color (color still carries category/faction meaning on top). The
 * last five (added in Fase 8 for the v2-only node types) are chosen to read as their own thing at
 * a glance: a heal cross, a slow-down pentagon, a jamming burst, a gate bar, an alert ring. */
export type NodeShape = "circle" | "diamond" | "triangle" | "triangle-down" | "square" | "hexagon" | "octagon" | "star" | "plus" | "pentagon" | "burst" | "bar" | "ring";

export interface DefenseNodeTierEntry {
  readonly tier: BlockTier;
  readonly description: string;
}

export interface DefenseNodeCatalogEntry {
  readonly type: Exclude<DefenseNodeType, "entry" | "core">;
  readonly label: string;
  readonly tiered: boolean;
  readonly color: string;
  readonly shape: NodeShape;
  /** Untiered types (Router) carry exactly one entry (its `tier` field is meaningless — always
   * BlockTier 1 — and never shown); tiered types carry one per BlockTier 1-3. */
  readonly tiers: readonly DefenseNodeTierEntry[];
}

export const PLACEABLE_NODE_CATALOG: readonly DefenseNodeCatalogEntry[] = [
  {
    type: "router",
    label: "Router",
    tiered: false,
    color: "#5b6478",
    shape: "circle",
    tiers: [{ tier: 1, description: "Penghubung pasif, tanpa efek combat. Tidak bisa dihancurkan." }],
  },
  {
    type: "firewall",
    label: "Firewall",
    tiered: true,
    color: "#e0555a",
    shape: "square",
    tiers: [
      { tier: 1, description: "Breach node — memblokir jalur. Balas 20 damage/tick ke virus yang occupy." },
      { tier: 2, description: "Breach node — memblokir jalur. Balas 30 damage/tick ke virus yang occupy." },
      { tier: 3, description: "Breach node — memblokir jalur. Balas 45 damage/tick ke virus yang occupy." },
    ],
  },
  {
    type: "ice-sentry",
    label: "ICE Sentry",
    tiered: true,
    color: "#5ac8e6",
    shape: "hexagon",
    tiers: [
      { tier: 1, description: "Menembak virus dalam radius 1 hop tiap 4 tick — damage 60, akurasi dasar 85%." },
      { tier: 2, description: "Radius 1 hop tiap 3 tick — damage 85, akurasi dasar 88%." },
      { tier: 3, description: "Radius 2 hop tiap 3 tick — damage 115, akurasi dasar 90%." },
    ],
  },
  {
    type: "honeypot",
    label: "Honeypot",
    tiered: true,
    color: "#e0c15a",
    shape: "star",
    tiers: [
      { tier: 1, description: "Virus yang masuk tanpa Detect Honeypot aktif: Integrity langsung jatuh ke 0 tick berikutnya." },
      { tier: 2, description: "Sama seperti Tier I, plus menyamar sebagai Core di hasil Sensor/Scan Ahead." },
      { tier: 3, description: "Sama seperti Tier II, plus virus yang sempat men-scan node ini mendapat status \"scanned\" permanen." },
    ],
  },
  {
    type: "scanner",
    label: "Scanner",
    tiered: true,
    color: "#b05ae0",
    shape: "octagon",
    tiers: [
      { tier: 1, description: "Aura pasif radius 1 hop: virus yang lewat kena status \"scanned\" 6 tick (ICE accuracy +15%)." },
      { tier: 2, description: "Radius 2 hop, durasi status 8 tick, ICE accuracy +20%." },
      { tier: 3, description: "Radius 2 hop, durasi status 10 tick, ICE accuracy +25%, menetralkan bonus speed Slow Crawl." },
    ],
  },
  {
    type: "trap",
    label: "Trap Node",
    tiered: true,
    color: "#e05a9c",
    shape: "triangle-down",
    tiers: [
      { tier: 1, description: "Meledak sekali saat node pertama dimasuki: damage 180, lalu jadi Router kosong." },
      { tier: 2, description: "Meledak sekali saat pertama dimasuki: damage 260, lalu jadi Router kosong." },
      { tier: 3, description: "Meledak sekali saat pertama dimasuki: damage 350 + splash 100 ke node tetangga, lalu jadi Router kosong." },
    ],
  },
  // Five v2-only node types (RULESET.md §14, PLAN.md 8.2a). Defend.tsx's battle test already runs
  // ruleset v2 (logic/defenseTest.ts), so these become placeable there automatically — no separate
  // v1/v2 palette split needed.
  {
    type: "patch-server",
    label: "Patch Server",
    tiered: true,
    color: "#5ae08a",
    shape: "plus",
    tiers: [
      { tier: 1, description: "Aura support radius 1 hop: menyembuhkan Breach Node hidup di sekitarnya +8 HP/tick." },
      { tier: 2, description: "Radius 1 hop, +12 HP/tick." },
      { tier: 3, description: "Radius 2 hop, +18 HP/tick." },
    ],
  },
  {
    type: "tarpit",
    label: "Tarpit",
    tiered: true,
    color: "#8a6a3a",
    shape: "pentagon",
    tiers: [
      { tier: 1, description: "Aura radius 1 hop: virus di dalamnya melambat jadi 60% speed. Tidak menumpuk dengan Tarpit lain." },
      { tier: 2, description: "Radius 1 hop, speed 50%." },
      { tier: 3, description: "Radius 2 hop, speed 40%." },
    ],
  },
  {
    type: "jammer",
    label: "Jammer",
    tiered: true,
    color: "#7a5ae0",
    shape: "burst",
    tiers: [
      { tier: 1, description: "Aura radius 1 hop: semua kondisi sensor virus di dalamnya bernilai salah." },
      { tier: 2, description: "Radius 2 hop." },
      { tier: 3, description: "Radius 2 hop, juga memalsukan \"node di depan\"." },
    ],
  },
  {
    type: "turnstile",
    label: "Turnstile",
    tiered: true,
    color: "#5b6478",
    shape: "bar",
    tiers: [
      { tier: 1, description: "Struktural, tak bisa dihancurkan. Virus yang meninggalkan node ini tak bisa kembali selama 40 tick." },
      { tier: 2, description: "Lockout 70 tick." },
      { tier: 3, description: "Lockout 110 tick." },
    ],
  },
  {
    type: "alarm",
    label: "Alarm Relay",
    tiered: true,
    color: "#e07a2a",
    shape: "ring",
    tiers: [
      { tier: 1, description: "Sekali per battle: virus masuk radius 1 hop atau Breach Node di sekitar hancur → semua ICE Sentry siaga 120 tick (interval −1, akurasi +10%)." },
      { tier: 2, description: "Radius 2 hop, siaga 180 tick." },
      { tier: 3, description: "Radius 2 hop, siaga 240 tick." },
    ],
  },
];

export const ENTRY_COLOR = "#7fd8a0";
export const CORE_COLOR = "#ffd75a";
export const ENTRY_SHAPE: NodeShape = "triangle";
export const CORE_SHAPE: NodeShape = "diamond";
export const ENTRY_DESCRIPTION = "Titik masuk virus ke jaringan. Posisi tetap, tidak bisa dipindah atau dihapus.";
export const CORE_DESCRIPTION = "Objective — battle dimenangkan Attacker begitu HP Core mencapai 0. Tidak membalas damage.";

export function findPlaceableEntry(type: Exclude<DefenseNodeType, "entry" | "core">): DefenseNodeCatalogEntry {
  const entry = PLACEABLE_NODE_CATALOG.find((candidate) => candidate.type === type);
  if (!entry) {
    throw new Error(`defenseNodeCatalog: no catalog entry for ${type}`);
  }
  return entry;
}

export function findNodeTierDescription(entry: DefenseNodeCatalogEntry, tier: BlockTier | undefined): string {
  const tierEntry = entry.tiers.find((candidate) => candidate.tier === (tier ?? 1));
  return tierEntry?.description ?? entry.tiers[0]!.description;
}
