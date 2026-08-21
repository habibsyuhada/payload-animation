import { BATTLE_TICK_LIMIT } from "./fixed.js";
import type { AccountTierConfig, ActionKind, BlockTier, ConditionKind, DefenseNodeType, Ruleset } from "./types.js";

/**
 * Numeric source of truth for ruleset v2 — the event-sheet virus (docs/ADR/0006, mirrored in
 * docs/RULESET.md §10-§12). v1's numbers live in ruleset.ts and are frozen: a v2 rebalance must
 * never reach into that file, because logs referencing "v1" have to keep replaying byte-identical
 * (PLAN.md DoD #3).
 *
 * Two deliberate departures from a straight copy of v1's tables, both flagged as mechanic fixes
 * in RULESET.md §9 / ADR 0006 §8:
 *   - Cloak is measured in TICKS, not nodes, and carries a cooldown, so it can neither cover a
 *     whole 4-node map nor be held open forever by an `[always] -> Cloak` row.
 *   - Detection stops granting immunity. A sensor is a CONDITION now: it tells the sheet a
 *     Honeypot is there, and the sheet decides what to do about it. That is the whole point of
 *     the rewrite ("IF Honeypot -> Backtrack", GDD §4.2).
 */

const ACCOUNT_TIERS_V2: readonly AccountTierConfig[] = [
  { tier: 1, payloadBudgetKb: 2400, defenseBudgetPoints: 20, coreHp: 1800, maxSheetEvents: 12 },
  { tier: 2, payloadBudgetKb: 2700, defenseBudgetPoints: 24, coreHp: 2000, maxSheetEvents: 16 },
  { tier: 3, payloadBudgetKb: 3000, defenseBudgetPoints: 28, coreHp: 2200, maxSheetEvents: 20 },
  { tier: 4, payloadBudgetKb: 3300, defenseBudgetPoints: 32, coreHp: 2400, maxSheetEvents: 24 },
  { tier: 5, payloadBudgetKb: 3600, defenseBudgetPoints: 36, coreHp: 2600, maxSheetEvents: 28 },
];

export const RULESET_V2: Ruleset = {
  version: "v2",
  tickLimit: BATTLE_TICK_LIMIT,
  accountTiers: ACCOUNT_TIERS_V2,
};

/** ADR 0006 §2: root + 2 levels. A readability limit (390px portrait, GDD §3), not a technical one. */
export const MAX_SHEET_DEPTH_V2 = 3;

/**
 * Backstop for the event-count cap: however the rows are arranged, one tick may not run more
 * actions than this. Bounds worst-case server work even if a future tier raises maxSheetEvents.
 */
export const MAX_ACTIONS_PER_TICK_V2 = 32;

/** Structural weight of one event row (ADR 0006 §5) — ten one-line rules cost more than one rule with ten actions. Nesting itself stays free. */
export const SHEET_EVENT_ROW_KB_V2 = 40;

/** Integrity every virus starts with, shared with v1 (RULESET.md §2). */
export const VIRUS_START_INTEGRITY = 1000;

export type ConditionCategory = "sensor" | "state" | "position";
export type ActionCategory = "movement" | "attack" | "stealth" | "utility";

export interface ConditionSpec {
  readonly kind: ConditionKind;
  readonly category: ConditionCategory;
  /** Tiered conditions carry one weight per tier; untiered ones carry a single weight. */
  readonly weightKbByTier?: Readonly<Record<BlockTier, number>>;
  readonly weightKb?: number;
  /** Sensor conditions only — detection radius in graph hops, per tier. */
  readonly radiusHopsByTier?: Readonly<Record<BlockTier, number>>;
  /** "honeypot-near" only — the tier at which a Honeypot disguised as Core (RULESET.md §5.1) is still seen. */
  readonly seesDisguiseFromTier?: BlockTier;
  readonly takesNodeTypes?: boolean;
  readonly takesThreshold?: boolean;
}

/**
 * Condition weights are the condition half of the v1 block they came from (RULESET.md §4):
 * "IF Node = Firewall" I was 120 KB and stays 120 KB, Detect Honeypot / Scan Ahead keep their own
 * per-tier tables because they are now conditions in their own right. Tiers that only bought
 * CONFIGURABILITY in v1 (e.g. "IF Integrity < X%" II/III widening the threshold range) collapse to
 * one flat price: in v2 the threshold is a number the player types, and charging for a number is
 * charging for nothing.
 */
export const CONDITION_SPECS_V2: readonly ConditionSpec[] = [
  { kind: "node-here-is", category: "position", weightKb: 120, takesNodeTypes: true },
  // Costs more than "node saat ini" because it needs the Scan Ahead half too (120 + 200).
  { kind: "node-ahead-is", category: "position", weightKb: 320, takesNodeTypes: true },
  {
    kind: "honeypot-near",
    category: "sensor",
    weightKbByTier: { 1: 350, 2: 450, 3: 550 },
    radiusHopsByTier: { 1: 1, 2: 2, 3: 3 },
    seesDisguiseFromTier: 3,
  },
  { kind: "trap-near", category: "sensor", weightKbByTier: { 1: 400, 2: 500, 3: 600 }, radiusHopsByTier: { 1: 1, 2: 2, 3: 3 } },
  { kind: "integrity-below", category: "state", weightKb: 150, takesThreshold: true },
  { kind: "is-scanned", category: "state", weightKb: 130 },
  { kind: "took-damage-last-tick", category: "state", weightKb: 90 },
  { kind: "on-breach-node", category: "position", weightKb: 90 },
  { kind: "at-node", category: "position", weightKb: 60 },
];

/**
 * Which slot an action writes, if any (ADR 0006 §3). Slot actions take the FIRST writer in a
 * tick — the sheet reads top-down as a priority list, so a generic `[always] -> Move toward Core`
 * at the bottom must not overwrite the reaction above it.
 */
export type ActionSlot = "movement" | "cloak" | "slow-crawl" | "decoy" | "split";

export interface ActionSpec {
  readonly kind: ActionKind;
  readonly category: ActionCategory;
  readonly weightKbByTier?: Readonly<Record<BlockTier, number>>;
  readonly weightKb?: number;
  /** Undefined = cumulative: every copy that runs this tick applies. */
  readonly slot?: ActionSlot;
  /** Movement actions only — the speed the virus crosses the edge it departs on, in DU/tick. */
  readonly speedDuPerTick?: number;
}

/** Action weights carry over the v1 block weights verbatim (RULESET.md §3-§4); the two new movement actions are priced below Random Walk because they decide strictly less. */
export const ACTION_SPECS_V2: readonly ActionSpec[] = [
  { kind: "move-toward-core", category: "movement", weightKb: 800, slot: "movement", speedDuPerTick: 50 },
  { kind: "move-avoiding-hazards", category: "movement", weightKb: 600, slot: "movement", speedDuPerTick: 50 },
  { kind: "move-random", category: "movement", weightKb: 500, slot: "movement", speedDuPerTick: 55 },
  { kind: "move-back", category: "movement", weightKb: 300, slot: "movement", speedDuPerTick: 50 },
  { kind: "hold-position", category: "movement", weightKb: 100, slot: "movement" },
  { kind: "brute-force", category: "attack", weightKbByTier: { 1: 700, 2: 900, 3: 1100 } },
  { kind: "exploit", category: "attack", weightKbByTier: { 1: 650, 2: 800, 3: 950 } },
  { kind: "overload", category: "attack", weightKbByTier: { 1: 750, 2: 950, 3: 1150 } },
  { kind: "cloak", category: "stealth", weightKbByTier: { 1: 500, 2: 650, 3: 800 }, slot: "cloak" },
  { kind: "slow-crawl", category: "stealth", weightKbByTier: { 1: 300, 2: 380, 3: 460 }, slot: "slow-crawl" },
  { kind: "self-repair", category: "utility", weightKbByTier: { 1: 450, 2: 550, 3: 650 } },
  { kind: "arm-decoy", category: "utility", weightKbByTier: { 1: 400, 2: 500, 3: 600 }, slot: "decoy" },
  // v2-only, multi-entity (RULESET.md §14, PLAN.md 8.3c): splits the virus into 2 (tier III: up to
  // 3) bodies sharing the same sheet. Slot "split" — only the first split row to fire in a tick
  // takes effect, same first-writer-wins rule as every other slot (ADR 0006 §3).
  { kind: "worm-split", category: "utility", weightKbByTier: { 1: 1100, 2: 1300, 3: 1500 }, slot: "split" },
];

export function getConditionSpec(kind: ConditionKind): ConditionSpec {
  const spec = CONDITION_SPECS_V2.find((candidate) => candidate.kind === kind);
  if (!spec) {
    throw new Error(`no v2 condition spec for kind "${kind}"`);
  }
  return spec;
}

export function getActionSpec(kind: ActionKind): ActionSpec {
  const spec = ACTION_SPECS_V2.find((candidate) => candidate.kind === kind);
  if (!spec) {
    throw new Error(`no v2 action spec for kind "${kind}"`);
  }
  return spec;
}

function weightOf(spec: { readonly weightKb?: number; readonly weightKbByTier?: Readonly<Record<BlockTier, number>> }, tier: BlockTier): number {
  if (spec.weightKb !== undefined) {
    return spec.weightKb;
  }
  return spec.weightKbByTier![tier];
}

export function getConditionWeightKb(kind: ConditionKind, tier: BlockTier = 1): number {
  return weightOf(getConditionSpec(kind), tier);
}

export function getActionWeightKb(kind: ActionKind, tier: BlockTier = 1): number {
  return weightOf(getActionSpec(kind), tier);
}

/** Sensor radius in hops for the two sensor conditions; 0 for anything that isn't one. */
export function getConditionRadiusHops(kind: ConditionKind, tier: BlockTier = 1): number {
  return getConditionSpec(kind).radiusHopsByTier?.[tier] ?? 0;
}

/* --- Effect tables (v2). Damage/heal numbers carry over from v1 unchanged so the two rulesets
 * stay comparable in balance-lab; only the two mechanics ADR 0006 §8 calls out actually move. --- */

const BRUTE_FORCE_DAMAGE_V2: Readonly<Record<BlockTier, number>> = { 1: 40, 2: 60, 3: 85 };
const EXPLOIT_DAMAGE_V2: Readonly<Record<BlockTier, number>> = { 1: 250, 2: 380, 3: 520 };
const SELF_REPAIR_HEAL_V2: Readonly<Record<BlockTier, number>> = { 1: 5, 2: 8, 3: 12 };

export function getBruteForceDamagePerTickV2(tier: BlockTier): number {
  return BRUTE_FORCE_DAMAGE_V2[tier];
}

export function getExploitDamageV2(tier: BlockTier): number {
  return EXPLOIT_DAMAGE_V2[tier];
}

export function getSelfRepairHealPerTickV2(tier: BlockTier): number {
  return SELF_REPAIR_HEAL_V2[tier];
}

interface OverloadConfigV2 {
  readonly splashDamage: number;
  readonly radiusHops: number;
}

const OVERLOAD_CONFIG_V2: Readonly<Record<BlockTier, OverloadConfigV2>> = {
  1: { splashDamage: 150, radiusHops: 1 },
  2: { splashDamage: 230, radiusHops: 1 },
  3: { splashDamage: 320, radiusHops: 2 },
};

export function getOverloadConfigV2(tier: BlockTier): OverloadConfigV2 {
  return OVERLOAD_CONFIG_V2[tier];
}

interface CloakConfigV2 {
  /** ADR 0006 §8: ticks, not nodes. ~30 ticks is 1.5s, about three 300 DU edges at 50 DU/tick. */
  readonly durationTicks: number;
  /** Measured from the moment the status EXPIRES. Without it, `[always] -> Cloak` is permanent invisibility for 500 KB. */
  readonly cooldownTicks: number;
}

const CLOAK_CONFIG_V2: Readonly<Record<BlockTier, CloakConfigV2>> = {
  1: { durationTicks: 30, cooldownTicks: 90 },
  2: { durationTicks: 45, cooldownTicks: 90 },
  3: { durationTicks: 60, cooldownTicks: 90 },
};

export function getCloakConfigV2(tier: BlockTier): CloakConfigV2 {
  return CLOAK_CONFIG_V2[tier];
}

interface SlowCrawlConfigV2 {
  readonly speedMultiplierPermille: number;
  readonly iceAccuracyReductionPermille: number;
}

const SLOW_CRAWL_CONFIG_V2: Readonly<Record<BlockTier, SlowCrawlConfigV2>> = {
  1: { speedMultiplierPermille: 700, iceAccuracyReductionPermille: 300 },
  2: { speedMultiplierPermille: 750, iceAccuracyReductionPermille: 400 },
  3: { speedMultiplierPermille: 800, iceAccuracyReductionPermille: 500 },
};

export function getSlowCrawlConfigV2(tier: BlockTier): SlowCrawlConfigV2 {
  return SLOW_CRAWL_CONFIG_V2[tier];
}

interface DecoyConfigV2 {
  readonly chargesTotal: number;
  readonly absorbsPerActivation: number;
}

const DECOY_CONFIG_V2: Readonly<Record<BlockTier, DecoyConfigV2>> = {
  1: { chargesTotal: 1, absorbsPerActivation: 1 },
  2: { chargesTotal: 2, absorbsPerActivation: 1 },
  3: { chargesTotal: 3, absorbsPerActivation: 2 },
};

export function getDecoyConfigV2(tier: BlockTier): DecoyConfigV2 {
  return DECOY_CONFIG_V2[tier];
}

/** Default threshold for "integrity-below" when a row doesn't carry one (matches v1's tier I). */
export const DEFAULT_INTEGRITY_THRESHOLD_PERMILLE_V2 = 500;

/** Default target for the two node-type conditions when a row doesn't carry one. */
export const DEFAULT_CONDITION_TARGET_NODE_TYPES_V2: readonly DefenseNodeType[] = ["firewall"];

/*
 * --- Defense node tables (v2), ADR 0007 §"Memisah tabel node v2 dari v1 yang beku" ---
 *
 * engine-v2.ts used to read these numbers straight out of ruleset.ts (v1, frozen) via nodes/ —
 * which meant no v2-only node type could ever be added, because the tables it would need to live
 * in must never change once a "v1" BattleLog depends on them. These tables exist so v2 has numbers
 * of its own to rebalance (RULESET.md §9's still-open "ICE Nest" fix, PLAN.md 8.2b) without
 * touching a single byte of ruleset.ts.
 *
 * Fase 8 (8.1b) seeds every table below as an EXACT copy of the v1 numbers — this step is pure
 * plumbing, not a rebalance, so v2 golden log hashes must not move. The five v2-only node types
 * (patch-server, tarpit, jammer, turnstile, alarm) get their real entries in 8.2a, alongside the
 * nodes-v2/ modules that read them.
 */

interface DefenseNodeCostEntryV2 {
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
  readonly costPoints: number;
}

/** Node costs, seeded from RULESET.md §5.1 (same as v1's DEFENSE_NODE_COSTS_V1). */
const DEFENSE_NODE_COSTS_V2: readonly DefenseNodeCostEntryV2[] = [
  { type: "router", costPoints: 1 },
  { type: "entry", costPoints: 0 },
  { type: "core", costPoints: 0 },
  { type: "firewall", tier: 1, costPoints: 3 },
  { type: "firewall", tier: 2, costPoints: 5 },
  { type: "firewall", tier: 3, costPoints: 8 },
  { type: "ice-sentry", tier: 1, costPoints: 4 },
  { type: "ice-sentry", tier: 2, costPoints: 6 },
  { type: "ice-sentry", tier: 3, costPoints: 9 },
  { type: "honeypot", tier: 1, costPoints: 3 },
  { type: "honeypot", tier: 2, costPoints: 5 },
  { type: "honeypot", tier: 3, costPoints: 8 },
  { type: "scanner", tier: 1, costPoints: 2 },
  { type: "scanner", tier: 2, costPoints: 3 },
  { type: "scanner", tier: 3, costPoints: 5 },
  { type: "trap", tier: 1, costPoints: 2 },
  { type: "trap", tier: 2, costPoints: 3 },
  { type: "trap", tier: 3, costPoints: 5 },
  // Five v2-only node types (RULESET.md §14, ADR 0007 §A) — 8.2a.
  { type: "patch-server", tier: 1, costPoints: 3 },
  { type: "patch-server", tier: 2, costPoints: 4 },
  { type: "patch-server", tier: 3, costPoints: 6 },
  { type: "tarpit", tier: 1, costPoints: 2 },
  { type: "tarpit", tier: 2, costPoints: 3 },
  { type: "tarpit", tier: 3, costPoints: 4 },
  { type: "jammer", tier: 1, costPoints: 3 },
  { type: "jammer", tier: 2, costPoints: 4 },
  { type: "jammer", tier: 3, costPoints: 6 },
  { type: "turnstile", tier: 1, costPoints: 2 },
  { type: "turnstile", tier: 2, costPoints: 3 },
  { type: "turnstile", tier: 3, costPoints: 4 },
  { type: "alarm", tier: 1, costPoints: 4 },
  { type: "alarm", tier: 2, costPoints: 5 },
  { type: "alarm", tier: 3, costPoints: 7 },
];

export function getDefenseNodeCostV2(type: DefenseNodeType, tier?: BlockTier): number {
  const entry = DEFENSE_NODE_COSTS_V2.find((candidate) => candidate.type === type && candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 defense node cost for type "${type}" tier ${tier ?? "(untiered)"}`);
  }
  return entry.costPoints;
}

/** All Breach nodes (Firewall, Core) take this much HP loss per tick from mere occupancy — seeded from BREACH_PASSIVE_DRAIN_V1 (RULESET.md §5.0). */
export const BREACH_PASSIVE_DRAIN_V2 = 15;

interface FirewallConfigV2 {
  readonly tier: BlockTier;
  readonly hp: number;
  readonly counterDamagePerTick: number;
}

const FIREWALL_CONFIG_V2: readonly FirewallConfigV2[] = [
  { tier: 1, hp: 500, counterDamagePerTick: 20 },
  { tier: 2, hp: 800, counterDamagePerTick: 30 },
  { tier: 3, hp: 1200, counterDamagePerTick: 45 },
];

export function getFirewallConfigV2(tier: BlockTier): FirewallConfigV2 {
  const entry = FIREWALL_CONFIG_V2.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 firewall config for tier ${tier}`);
  }
  return entry;
}

interface IceSentryConfigV2 {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly fireIntervalTicks: number;
  readonly damage: number;
  readonly accuracyPermille: number;
}

const ICE_SENTRY_CONFIG_V2: readonly IceSentryConfigV2[] = [
  { tier: 1, radiusHops: 1, fireIntervalTicks: 4, damage: 60, accuracyPermille: 850 },
  { tier: 2, radiusHops: 1, fireIntervalTicks: 3, damage: 85, accuracyPermille: 880 },
  { tier: 3, radiusHops: 2, fireIntervalTicks: 3, damage: 115, accuracyPermille: 900 },
];

export function getIceSentryConfigV2(tier: BlockTier): IceSentryConfigV2 {
  const entry = ICE_SENTRY_CONFIG_V2.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 ICE Sentry config for tier ${tier}`);
  }
  return entry;
}

interface ScannerConfigV2 {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly durationTicks: number;
  readonly iceAccuracyBonusPermille: number;
}

const SCANNER_CONFIG_V2: readonly ScannerConfigV2[] = [
  { tier: 1, radiusHops: 1, durationTicks: 6, iceAccuracyBonusPermille: 150 },
  { tier: 2, radiusHops: 2, durationTicks: 8, iceAccuracyBonusPermille: 200 },
  { tier: 3, radiusHops: 2, durationTicks: 10, iceAccuracyBonusPermille: 250 },
];

export function getScannerConfigV2(tier: BlockTier): ScannerConfigV2 {
  const entry = SCANNER_CONFIG_V2.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 scanner config for tier ${tier}`);
  }
  return entry;
}

const TRAP_DAMAGE_V2: Readonly<Record<BlockTier, number>> = { 1: 180, 2: 260, 3: 350 };

export function getTrapDamageV2(tier: BlockTier): number {
  return TRAP_DAMAGE_V2[tier];
}

/*
 * --- Five v2-only node types (RULESET.md §14, ADR 0007 §A) — 8.2a ---
 * Each answers an attacker archetype the six v1 node types don't: grind (Patch Server heals
 * through it), slow-crawl-immune sprinting (Tarpit), sensor-reliant sheets (Jammer), backtracking
 * (Turnstile), and escalation the sheet can't out-scan (Alarm Relay).
 */

interface PatchServerConfigV2 {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly healPerTick: number;
}

const PATCH_SERVER_CONFIG_V2: readonly PatchServerConfigV2[] = [
  { tier: 1, radiusHops: 1, healPerTick: 8 },
  { tier: 2, radiusHops: 1, healPerTick: 12 },
  { tier: 3, radiusHops: 2, healPerTick: 18 },
];

export function getPatchServerConfigV2(tier: BlockTier): PatchServerConfigV2 {
  const entry = PATCH_SERVER_CONFIG_V2.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 patch-server config for tier ${tier}`);
  }
  return entry;
}

interface TarpitConfigV2 {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  /** Not additive with a second Tarpit in range — the strongest (lowest ‰) active one applies. */
  readonly speedMultiplierPermille: number;
}

const TARPIT_CONFIG_V2: readonly TarpitConfigV2[] = [
  { tier: 1, radiusHops: 1, speedMultiplierPermille: 600 },
  { tier: 2, radiusHops: 1, speedMultiplierPermille: 500 },
  { tier: 3, radiusHops: 2, speedMultiplierPermille: 400 },
];

export function getTarpitConfigV2(tier: BlockTier): TarpitConfigV2 {
  const entry = TARPIT_CONFIG_V2.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 tarpit config for tier ${tier}`);
  }
  return entry;
}

interface JammerConfigV2 {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  /** Tier III also falsifies `node-ahead-is` while jammed — not just the two sensor conditions. */
  readonly jamsNodeAhead: boolean;
}

const JAMMER_CONFIG_V2: readonly JammerConfigV2[] = [
  { tier: 1, radiusHops: 1, jamsNodeAhead: false },
  { tier: 2, radiusHops: 2, jamsNodeAhead: false },
  { tier: 3, radiusHops: 2, jamsNodeAhead: true },
];

export function getJammerConfigV2(tier: BlockTier): JammerConfigV2 {
  const entry = JAMMER_CONFIG_V2.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 jammer config for tier ${tier}`);
  }
  return entry;
}

interface TurnstileConfigV2 {
  readonly lockoutTicks: number;
}

const TURNSTILE_CONFIG_V2: Readonly<Record<BlockTier, TurnstileConfigV2>> = {
  1: { lockoutTicks: 40 },
  2: { lockoutTicks: 70 },
  3: { lockoutTicks: 110 },
};

export function getTurnstileConfigV2(tier: BlockTier): TurnstileConfigV2 {
  return TURNSTILE_CONFIG_V2[tier];
}

interface AlarmConfigV2 {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly alertDurationTicks: number;
}

const ALARM_CONFIG_V2: readonly AlarmConfigV2[] = [
  { tier: 1, radiusHops: 1, alertDurationTicks: 120 },
  { tier: 2, radiusHops: 2, alertDurationTicks: 180 },
  { tier: 3, radiusHops: 2, alertDurationTicks: 240 },
];

export function getAlarmConfigV2(tier: BlockTier): AlarmConfigV2 {
  const entry = ALARM_CONFIG_V2.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v2 alarm config for tier ${tier}`);
  }
  return entry;
}

/** The alert's boost to every ICE Sentry on the map, RULESET.md §14 — flat across tiers; only
 * radius and duration scale with Alarm Relay's own tier. */
export const ALARM_ICE_FIRE_INTERVAL_REDUCTION_TICKS = 1;
export const ALARM_ICE_ACCURACY_BONUS_PERMILLE = 100;
