import {
  ACTION_SPECS_V2,
  CONDITION_SPECS_V2,
  getActionSpec,
  getActionWeightKb,
  getConditionSpec,
  getConditionWeightKb,
  type ActionCategory,
  type ActionKind,
  type BlockTier,
  type ConditionKind,
  type DefenseNodeType,
} from "@payload/sim";

/**
 * sheetCatalog.ts — V7.3: the display half of ruleset v2's condition/action catalog.
 *
 * Unlike v1's blockCatalog.ts, this file does NOT re-type a single weight. v1 had to mirror
 * RULESET.md by hand because packages/sim deliberately didn't model payload weight; v2's sim owns
 * the KB tables (ruleset-v2.ts) because the sheet validator lives there, so the only thing left
 * for the client is language: what a row says in Indonesian, and which colour it wears. If a
 * weight changes, this file needs no edit at all.
 */

export interface TierOption {
  readonly tier: BlockTier;
  readonly weightKb: number;
  readonly detail: string;
}

export interface ConditionCatalogEntry {
  readonly kind: ConditionKind;
  readonly label: string;
  readonly summary: string;
  /** Category colour: sensors read as Sensor blocks did in v1, everything else as a Condition. */
  readonly colorCategory: "sensor" | "condition";
  readonly tiers: readonly TierOption[] | null;
  readonly takesNodeTypes: boolean;
  readonly takesThreshold: boolean;
}

function tierOptions(kind: ConditionKind | ActionKind, details: Readonly<Record<BlockTier, string>>, isCondition: boolean): readonly TierOption[] {
  return ([1, 2, 3] as const).map((tier) => ({
    tier,
    weightKb: isCondition ? getConditionWeightKb(kind as ConditionKind, tier) : getActionWeightKb(kind as ActionKind, tier),
    detail: details[tier],
  }));
}

export const CONDITION_CATALOG: readonly ConditionCatalogEntry[] = [
  {
    kind: "node-here-is",
    label: "Node saat ini =",
    summary: "Virus sedang berdiri di node bertipe tertentu.",
    colorCategory: "condition",
    tiers: null,
    takesNodeTypes: true,
    takesThreshold: false,
  },
  {
    kind: "node-ahead-is",
    label: "Node di depan =",
    summary: "Node tujuan berikutnya bertipe tertentu — bereaksi sebelum sampai.",
    colorCategory: "condition",
    tiers: null,
    takesNodeTypes: true,
    takesThreshold: false,
  },
  {
    kind: "honeypot-near",
    label: "Ada Honeypot dekat",
    summary: "Honeypot yang belum terpicu ada dalam radius sensor.",
    colorCategory: "sensor",
    tiers: tierOptions("honeypot-near", { 1: "Radius 1 hop.", 2: "Radius 2 hop.", 3: "Radius 3 hop + tembus penyamaran sbg Core." }, true),
    takesNodeTypes: false,
    takesThreshold: false,
  },
  {
    kind: "trap-near",
    label: "Ada Trap dekat",
    summary: "Trap yang belum meledak ada dalam radius sensor.",
    colorCategory: "sensor",
    tiers: tierOptions("trap-near", { 1: "Radius 1 hop.", 2: "Radius 2 hop.", 3: "Radius 3 hop." }, true),
    takesNodeTypes: false,
    takesThreshold: false,
  },
  {
    kind: "integrity-below",
    label: "Integrity <",
    summary: "Sisa Integrity virus di bawah ambang yang kamu set.",
    colorCategory: "condition",
    tiers: null,
    takesNodeTypes: false,
    takesThreshold: true,
  },
  {
    kind: "is-scanned",
    label: 'Sedang "scanned"',
    summary: "Scanner lawan sedang mengunci virus — akurasi ICE naik.",
    colorCategory: "condition",
    tiers: null,
    takesNodeTypes: false,
    takesThreshold: false,
  },
  {
    kind: "took-damage-last-tick",
    label: "Baru kena damage",
    summary: "Virus kehilangan Integrity pada tick yang baru saja selesai.",
    colorCategory: "condition",
    tiers: null,
    takesNodeTypes: false,
    takesThreshold: false,
  },
  {
    kind: "on-breach-node",
    label: "Di atas Breach Node",
    summary: "Sedang menduduki Firewall hidup atau Core.",
    colorCategory: "condition",
    tiers: null,
    takesNodeTypes: false,
    takesThreshold: false,
  },
  {
    kind: "at-node",
    label: "Sedang di node",
    summary: "Berdiri di sebuah node, bukan sedang menyeberang edge.",
    colorCategory: "condition",
    tiers: null,
    takesNodeTypes: false,
    takesThreshold: false,
  },
];

export interface ActionCatalogEntry {
  readonly kind: ActionKind;
  readonly label: string;
  readonly summary: string;
  readonly category: ActionCategory;
  readonly tiers: readonly TierOption[] | null;
  readonly weightKb: number;
  /** Slot actions need the "aturan paling atas yang menang" line in the UI (ADR 0006 §3). */
  readonly isSlot: boolean;
}

function untiered(kind: ActionKind, label: string, summary: string, category: ActionCategory): ActionCatalogEntry {
  return { kind, label, summary, category, tiers: null, weightKb: getActionWeightKb(kind), isSlot: getActionSpec(kind).slot !== undefined };
}

function tiered(kind: ActionKind, label: string, summary: string, category: ActionCategory, details: Readonly<Record<BlockTier, string>>): ActionCatalogEntry {
  return { kind, label, summary, category, tiers: tierOptions(kind, details, false), weightKb: getActionWeightKb(kind, 1), isSlot: getActionSpec(kind).slot !== undefined };
}

export const ACTION_CATALOG: readonly ActionCatalogEntry[] = [
  untiered("move-toward-core", "Jalan ke Core", "Jalur terpendek berbobot jarak. Speed 50 DU/tick.", "movement"),
  untiered("move-avoiding-hazards", "Jalan memutari bahaya", "Jalur terpendek yang menghindari bahaya yang terlihat kondisi sensor di sheet ini.", "movement"),
  untiered("move-random", "Jalan acak", "Edge acak dari node saat ini. Speed 55 DU/tick.", "movement"),
  untiered("move-back", "Mundur", "Balik ke node yang barusan ditinggalkan.", "movement"),
  untiered("hold-position", "Diam di tempat", "Menahan slot gerak — baris di bawah tidak bisa memindahkan virus tick ini.", "movement"),
  tiered("brute-force", "Brute Force", "Damage per tick ke Breach Node yang sedang diduduki.", "attack", { 1: "+40/tick.", 2: "+60/tick.", 3: "+85/tick." }),
  tiered("exploit", "Exploit", "One-shot, hanya pada tick pertama di sebuah node.", "attack", { 1: "250 damage.", 2: "380 damage.", 3: "520 damage." }),
  tiered("overload", "Overload", "Splash saat sebuah Breach Node hancur tick ini.", "attack", { 1: "Splash 150, radius 1 hop.", 2: "Splash 230, radius 1 hop.", 3: "Splash 320, radius 2 hop." }),
  tiered("cloak", "Cloak", "Kebal Scanner & ICE Sentry sementara, lalu cooldown 90 tick.", "stealth", { 1: "30 tick.", 2: "45 tick.", 3: "60 tick." }),
  tiered("slow-crawl", "Slow Crawl", "Tick ini: lebih pelan, lebih sulit ditembak ICE.", "stealth", { 1: "Speed ×70%, akurasi ICE −30%.", 2: "Speed ×75%, akurasi −40%.", 3: "Speed ×80%, akurasi −50%." }),
  tiered("self-repair", "Self Repair", "Menambah Integrity. Syaratnya baris yang kamu tulis sendiri.", "utility", { 1: "+5/tick.", 2: "+8/tick.", 3: "+12/tick." }),
  tiered("arm-decoy", "Pasang Decoy", "Menyerap trigger berikutnya (ICE/Honeypot/Trap).", "utility", { 1: "1 aktivasi, serap 1.", 2: "2 aktivasi, serap 1.", 3: "3 aktivasi, serap 2." }),
  tiered("worm-split", "Worm Split", "Memecah virus jadi beberapa tubuh yang berbagi sheet ini.", "utility", {
    1: "2 tubuh, masing-masing 50% sisa Integrity.",
    2: "2 tubuh, masing-masing 60% sisa Integrity.",
    3: "Sampai 3 tubuh, masing-masing 65% sisa Integrity.",
  }),
  tiered("detonate", "Detonasi", "Mengorbankan seluruh sisa Integrity sebagai damage ke Breach Node yang diduduki, lalu mati.", "attack", {
    1: "Damage = 200% sisa Integrity.",
    2: "Damage = 250% sisa Integrity.",
    3: "Damage = 300% sisa Integrity.",
  }),
  tiered("set-checkpoint", "Pasang Checkpoint", "Merekam node saat ini. Saat mati, hidup lagi di sana.", "utility", {
    1: "300 Integrity, 1 jatah respawn.",
    2: "400 Integrity, 1 jatah respawn.",
    3: "500 Integrity, 2 jatah respawn.",
  }),
];

export function findConditionEntry(kind: ConditionKind): ConditionCatalogEntry {
  const entry = CONDITION_CATALOG.find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new Error(`sheetCatalog: no condition entry for ${kind}`);
  }
  return entry;
}

export function findActionEntry(kind: ActionKind): ActionCatalogEntry {
  const entry = ACTION_CATALOG.find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new Error(`sheetCatalog: no action entry for ${kind}`);
  }
  return entry;
}

/** The node types worth naming in a condition — Router and Entry are included because "jangan
 * berhenti di Router" is a real rule a player writes. */
export const CONDITION_NODE_TYPE_OPTIONS: readonly { readonly type: DefenseNodeType; readonly label: string }[] = [
  { type: "firewall", label: "Firewall" },
  { type: "ice-sentry", label: "ICE Sentry" },
  { type: "honeypot", label: "Honeypot" },
  { type: "scanner", label: "Scanner" },
  { type: "trap", label: "Trap" },
  { type: "router", label: "Router" },
  { type: "core", label: "Core" },
  { type: "entry", label: "Entry" },
];

/** Sanity net for the two catalogs above: every kind the sim prices must have something to say. */
export const CATALOG_COVERS_EVERY_KIND =
  CONDITION_SPECS_V2.every((spec) => CONDITION_CATALOG.some((entry) => entry.kind === spec.kind)) &&
  ACTION_SPECS_V2.every((spec) => ACTION_CATALOG.some((entry) => entry.kind === spec.kind));

export function conditionWeightKb(kind: ConditionKind, tier: BlockTier | undefined): number {
  return getConditionWeightKb(kind, tier ?? 1);
}

export function actionWeightKb(kind: ActionKind, tier: BlockTier | undefined): number {
  return getActionWeightKb(kind, tier ?? 1);
}

/** True when this condition kind reads a tier at all (only the two sensors do). */
export function conditionIsTiered(kind: ConditionKind): boolean {
  return getConditionSpec(kind).radiusHopsByTier !== undefined;
}
