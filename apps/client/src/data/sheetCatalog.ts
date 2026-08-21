import {
  ACTION_SPECS_V2,
  CONDITION_SPECS_V2,
  FLAG_COUNT_V2,
  MIN_EVERY_N_TICKS_V2,
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

/**
 * A generic parameter control, replacing the `takesNodeTypes`/`takesThreshold` booleans (PLAN.md
 * 8.4): those two couldn't grow to cover `hops`/`ticks`/`flagIndex`/`count`/`flagValue` without a
 * boolean per param forever. `key` is the exact field name on `ConditionInstance`/`ActionInstance`
 * (virusLabStore.ts) the control reads and writes — never `SheetCondition`/`SheetAction`'s own field
 * name where the two differ (`targetNodeTypes` there is `targetNodeType`, singular, here; the picker
 * only ever offers one type at a time, same as `node-here-is`/`node-ahead-is` always have).
 */
export type ParamSpec =
  | { readonly key: "targetNodeType"; readonly kind: "node-types"; readonly label: string }
  | { readonly key: "integrityThresholdPermille" | "thresholdPermille"; readonly kind: "threshold"; readonly label: string }
  | { readonly key: "hops" | "ticks" | "flagIndex" | "count"; readonly kind: "int"; readonly min: number; readonly max: number; readonly step?: number; readonly label: string }
  | { readonly key: "flagValue"; readonly kind: "bool"; readonly label: string };

export interface ConditionCatalogEntry {
  readonly kind: ConditionKind;
  readonly label: string;
  readonly summary: string;
  /** Category colour: sensors read as Sensor blocks did in v1, everything else as a Condition. */
  readonly colorCategory: "sensor" | "condition";
  readonly tiers: readonly TierOption[] | null;
  readonly params: readonly ParamSpec[];
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
    params: [{ key: "targetNodeType", kind: "node-types", label: "Tipe node" }],
  },
  {
    kind: "node-ahead-is",
    label: "Node di depan =",
    summary: "Node tujuan berikutnya bertipe tertentu — bereaksi sebelum sampai.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "targetNodeType", kind: "node-types", label: "Tipe node" }],
  },
  {
    kind: "honeypot-near",
    label: "Ada Honeypot dekat",
    summary: "Honeypot yang belum terpicu ada dalam radius sensor.",
    colorCategory: "sensor",
    tiers: tierOptions("honeypot-near", { 1: "Radius 1 hop.", 2: "Radius 2 hop.", 3: "Radius 3 hop + tembus penyamaran sbg Core." }, true),
    params: [],
  },
  {
    kind: "trap-near",
    label: "Ada Trap dekat",
    summary: "Trap yang belum meledak ada dalam radius sensor.",
    colorCategory: "sensor",
    tiers: tierOptions("trap-near", { 1: "Radius 1 hop.", 2: "Radius 2 hop.", 3: "Radius 3 hop." }, true),
    params: [],
  },
  {
    kind: "integrity-below",
    label: "Integrity <",
    summary: "Sisa Integrity virus di bawah ambang yang kamu set.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "integrityThresholdPermille", kind: "threshold", label: "Ambang Integrity" }],
  },
  {
    kind: "is-scanned",
    label: 'Sedang "scanned"',
    summary: "Scanner lawan sedang mengunci virus — akurasi ICE naik.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "took-damage-last-tick",
    label: "Baru kena damage",
    summary: "Virus kehilangan Integrity pada tick yang baru saja selesai.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "on-breach-node",
    label: "Di atas Breach Node",
    summary: "Sedang menduduki Firewall hidup atau Core.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "at-node",
    label: "Sedang di node",
    summary: "Berdiri di sebuah node, bukan sedang menyeberang edge.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  // v2-only, PLAN.md 8.4 (RULESET.md §10.1 B.1).
  {
    kind: "ice-near",
    label: "Ada ICE Sentry dekat",
    summary: "ICE Sentry yang masih bisa menembak ada dalam radius.",
    colorCategory: "sensor",
    tiers: tierOptions("ice-near", { 1: "Radius 1 hop.", 2: "Radius 2 hop.", 3: "Radius 3 hop." }, true),
    params: [],
  },
  {
    kind: "scanner-near",
    label: "Ada Scanner dekat",
    summary: "Scanner hidup ada dalam radius.",
    colorCategory: "sensor",
    tiers: tierOptions("scanner-near", { 1: "Radius 1 hop.", 2: "Radius 2 hop.", 3: "Radius 3 hop." }, true),
    params: [],
  },
  {
    kind: "core-within-hops",
    label: "Core ≤ X hop",
    summary: "Jarak ke Core, dalam hop, di bawah atau sama dengan angka ini.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "hops", kind: "int", min: 1, max: 5, label: "Jarak (hop)" }],
  },
  {
    kind: "core-hp-below",
    label: "HP Core < X%",
    summary: "Sisa HP Core di bawah ambang yang kamu set.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "thresholdPermille", kind: "threshold", label: "Ambang HP Core" }],
  },
  {
    kind: "node-hp-below",
    label: "HP node ini < X%",
    summary: "Breach Node yang sedang diduduki punya sisa HP di bawah ambang ini. False kalau bukan Breach Node.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "thresholdPermille", kind: "threshold", label: "Ambang HP node" }],
  },
  {
    kind: "blocked-ahead",
    label: "Jalan di depan terhalang",
    summary: "Node di depan adalah Breach Node yang masih hidup.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "visited-here-before",
    label: "Pernah lewat sini",
    summary: "Virus ini sudah pernah meninggalkan node tempatnya berdiri sekarang, di kunjungan sebelumnya.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "cloak-ready",
    label: "Cloak siap",
    summary: "Cloak tidak sedang aktif dan tidak sedang cooldown.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "decoy-armed",
    label: "Decoy terpasang",
    summary: "Masih ada serapan Decoy tersisa.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "slowed",
    label: "Sedang diperlambat",
    summary: "Efek Tarpit atau Slow Crawl sedang aktif.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "jammed",
    label: "Sensor diacak",
    summary: "Sedang di dalam radius Jammer — kondisi sensor lain berbohong.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "alarm-active",
    label: "Jaringan siaga",
    summary: "Alarm Relay sedang aktif — semua ICE Sentry lebih akurat dan lebih cepat menembak.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "tick-after",
    label: "Sudah lewat X tick",
    summary: "Tick battle saat ini sudah melewati angka ini.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "ticks", kind: "int", min: 0, max: 1200, step: 10, label: "Tick" }],
  },
  {
    kind: "every-n-ticks",
    label: "Tiap X tick",
    summary: `Berdenyut tiap kelipatan tick ini (minimum ${MIN_EVERY_N_TICKS_V2}).`,
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "ticks", kind: "int", min: MIN_EVERY_N_TICKS_V2, max: 1200, step: 5, label: "Tiap X tick" }],
  },
  {
    kind: "flag-is",
    label: "Penanda N menyala",
    summary: "Membaca variabel yang ditulis aksi Nyalakan/matikan penanda.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "flagIndex", kind: "int", min: 0, max: FLAG_COUNT_V2 - 1, label: "Slot penanda" }],
  },
  {
    kind: "is-clone",
    label: "Aku cabang",
    summary: "Entitas ini lahir dari Worm Split, bukan entitas awal.",
    colorCategory: "condition",
    tiers: null,
    params: [],
  },
  {
    kind: "entity-count-below",
    label: "Jumlah cabang < X",
    summary: "Jumlah tubuh virus yang masih hidup di bawah angka ini.",
    colorCategory: "condition",
    tiers: null,
    params: [{ key: "count", kind: "int", min: 2, max: 3, label: "Jumlah tubuh" }],
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
  readonly params: readonly ParamSpec[];
}

function untiered(kind: ActionKind, label: string, summary: string, category: ActionCategory, params: readonly ParamSpec[] = []): ActionCatalogEntry {
  return { kind, label, summary, category, tiers: null, weightKb: getActionWeightKb(kind), isSlot: getActionSpec(kind).slot !== undefined, params };
}

function tiered(
  kind: ActionKind,
  label: string,
  summary: string,
  category: ActionCategory,
  details: Readonly<Record<BlockTier, string>>,
  params: readonly ParamSpec[] = [],
): ActionCatalogEntry {
  return { kind, label, summary, category, tiers: tierOptions(kind, details, false), weightKb: getActionWeightKb(kind, 1), isSlot: getActionSpec(kind).slot !== undefined, params };
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
  // v2-only, PLAN.md 8.4 (RULESET.md §10.2 B.2).
  untiered("move-toward-node-type", "Buru node bertipe…", "Jalur terpendek ke node hidup terdekat bertipe X. Speed 50 DU/tick. Fallback ke jalur Core kalau tak ada.", "movement", [
    { key: "targetNodeType", kind: "node-types", label: "Tipe node" },
  ]),
  tiered("sprint", "Lari", "Tick ini: lebih cepat, dengan biaya Integrity.", "utility", {
    1: "Speed ×130%, −6 Integrity/tick.",
    2: "Speed ×145%, −9 Integrity/tick.",
    3: "Speed ×160%, −12 Integrity/tick.",
  }),
  untiered("recall", "Balik ke Checkpoint", "Jalur terpendek ke node checkpoint terakhir. Diam kalau belum ada checkpoint. Speed 50 DU/tick.", "movement"),
  tiered("target-strike", "Serang node pendukung", "Damage per tick ke node pendukung hidup terdekat dalam 1 hop (ICE Sentry, Scanner, Patch Server, Jammer, Alarm Relay).", "attack", {
    1: "+90/tick.",
    2: "+130/tick.",
    3: "+180/tick.",
  }),
  tiered("emp-burst", "EMP", "Melumpuhkan semua node pendukung dalam radius untuk sementara.", "attack", {
    1: "Radius 1 hop, 20 tick, cooldown 120 tick.",
    2: "Radius 1 hop, 30 tick, cooldown 120 tick.",
    3: "Radius 2 hop, 40 tick, cooldown 120 tick.",
  }),
  tiered("overclock", "Overclock", "Selama 20 tick: semua damage serang naik, tapi ICE lebih akurat ke tubuh ini.", "attack", {
    1: "Damage ×140%, akurasi ICE +150‰.",
    2: "Damage ×155%, akurasi ICE +150‰.",
    3: "Damage ×170%, akurasi ICE +150‰.",
  }),
  tiered("spoof-signature", "Palsukan Tanda Tangan", "Menghapus status scanned seketika dan menolak scan baru untuk sementara.", "stealth", {
    1: "15 tick, cooldown 100 tick.",
    2: "25 tick, cooldown 100 tick.",
    3: "35 tick, cooldown 100 tick.",
  }),
  tiered("purge", "Bersihkan", "Menghapus status diperlambat (Tarpit & Slow Crawl) untuk sementara.", "stealth", {
    1: "10 tick.",
    2: "15 tick.",
    3: "20 tick.",
  }),
  tiered("siphon", "Sedot Data", "Memulihkan Integrity dari damage yang tubuh ini hasilkan tick ini.", "stealth", {
    1: "30% dari damage.",
    2: "40% dari damage.",
    3: "50% dari damage.",
  }),
  untiered("set-flag", "Nyalakan/matikan penanda", "Menulis sebuah penanda yang bisa dibaca kondisi lain — ingatan sheet ini.", "utility", [
    { key: "flagIndex", kind: "int", min: 0, max: FLAG_COUNT_V2 - 1, label: "Slot penanda" },
    { key: "flagValue", kind: "bool", label: "Nilai" },
  ]),
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
