/**
 * Core data contract (PLAN.md §2), typed against the block/node vocabulary fixed
 * in docs/RULESET.md. Zero runtime deps — packages/sim stays pure.
 */

export type RulesetVersion = "v1" | "v2";

export type BlockTier = 1 | 2 | 3;

export type MovementBlockKind = "shortest-path" | "random-walk" | "backtrack";

export type LogicBlockKind =
  | "scan-ahead"
  | "detect-honeypot"
  | "if-integrity-below"
  | "if-node-type"
  | "if-scanned"
  | "brute-force"
  | "exploit"
  | "overload"
  | "cloak"
  | "slow-crawl"
  | "self-repair"
  | "sacrifice-decoy";

export interface MovementBlock {
  readonly kind: MovementBlockKind;
}

export interface LogicBlock {
  readonly kind: LogicBlockKind;
  readonly tier: BlockTier;
  /**
   * "if-integrity-below" only — permille threshold (RULESET.md §4.2: tier I fixed 500‰/50%,
   * tier II/III player-configurable). Defaults to 500 if omitted.
   */
  readonly integrityThresholdPermille?: number;
  /** "if-node-type" only — node types this condition matches. Defaults to ["firewall"] if omitted. */
  readonly targetNodeTypes?: readonly DefenseNodeType[];
}

export interface VirusDesign {
  readonly movement: MovementBlock;
  readonly blocks: readonly LogicBlock[];
}

/*
 * --- Ruleset v2: the virus as a nested event sheet (docs/ADR/0006) ---
 * v1's LogicBlock chain above is FROZEN, not replaced: old BattleLogs must stay replayable
 * (PLAN.md DoD #3), so every v1 type keeps its exact shape and `simulate()` dispatches on
 * BattleInput["rulesetVersion"] instead.
 */

/** Conditions are ANDed within an event; OR is two sibling events (ADR 0006 §1). */
export type ConditionKind =
  /** The node the virus is standing on right now — "node saat ini". Never true mid-transit. */
  | "node-here-is"
  /** The node the virus would travel to next — "node di depan" (ADR 0006 open question 2). */
  | "node-ahead-is"
  /** A Honeypot is within this condition's detection radius (the Detect Honeypot sensor, as a condition). */
  | "honeypot-near"
  /** An unspent Trap is within this condition's detection radius (Scan Ahead III, as a condition). */
  | "trap-near"
  | "integrity-below"
  /** The virus currently carries a Scanner's "scanned" status. */
  | "is-scanned"
  /** The virus lost Integrity during the tick just resolved — Self Repair's v1 hidden gate, made
   * visible. Named for the tick it can actually see: the sheet is evaluated before this tick's
   * damage lands, so "this tick" would be a lie. */
  | "took-damage-last-tick"
  /** The virus is occupying a Breach Node (Firewall/Core) — Self Repair's other v1 hidden gate. */
  | "on-breach-node"
  /** The virus is standing on a node rather than crossing an edge. */
  | "at-node";

export type ActionKind =
  // Movement — all four write the same movement slot (first writer this tick wins).
  | "move-toward-core"
  | "move-avoiding-hazards"
  | "move-random"
  | "move-back"
  | "hold-position"
  // Attack — cumulative.
  | "brute-force"
  | "exploit"
  | "overload"
  // Stealth — status slots.
  | "cloak"
  | "slow-crawl"
  // Utility.
  | "self-repair"
  | "arm-decoy"
  // v2-only, multi-entity (RULESET.md §14, PLAN.md 8.3c/8.3d).
  | "worm-split"
  | "detonate"
  | "set-checkpoint";

/**
 * How often an event may fire.
 * - "battle": once per battle.
 * - "node": once per node id the virus stands on (v1's `exploitedNodeIds` bookkeeping, generalized).
 * - "arrival": once per arrival, so revisiting the same node re-arms it.
 */
export type OnceScope = "battle" | "node" | "arrival";

export interface SheetCondition {
  readonly kind: ConditionKind;
  /** NOT, per condition — v2 has no OR/NOT groups (ADR 0006 §1). */
  readonly negate?: boolean;
  /** "node-here-is" / "node-ahead-is" only. Defaults to ["firewall"]. */
  readonly targetNodeTypes?: readonly DefenseNodeType[];
  /** "integrity-below" only — permille of starting Integrity. Defaults to 500. */
  readonly integrityThresholdPermille?: number;
  /** "honeypot-near" / "trap-near" only — detection radius tier. Defaults to 1. */
  readonly tier?: BlockTier;
}

export interface SheetAction {
  readonly kind: ActionKind;
  /** Tiered actions only (attack/stealth/utility). Defaults to 1. */
  readonly tier?: BlockTier;
}

export interface SheetEvent {
  /** Stable id for `rule-fired` log events. Optional: the engine falls back to the row's path (e.g. "2.0"). */
  readonly id?: string;
  /** ANDed. An empty list means "always". */
  readonly conditions: readonly SheetCondition[];
  /** Run in order, top to bottom. */
  readonly actions: readonly SheetAction[];
  /** Only evaluated when this event's own conditions hold. */
  readonly children: readonly SheetEvent[];
  readonly once?: OnceScope;
}

/** The v2 replacement for VirusDesign: movement is an action inside the sheet, not a separate slot. */
export interface VirusProgram {
  readonly events: readonly SheetEvent[];
}

/**
 * v1's node types, as a runtime array (not just a type) — `validateDefenseGraph` needs a `Set` it
 * can check an untyped `DefenseGraph` (from `localStorage`, or a future server) against, not just
 * a compile-time guarantee. (ADR 0007 §"Memisah tabel node v2 dari v1 yang beku".)
 */
export const DEFENSE_NODE_TYPES_V1 = ["router", "firewall", "ice-sentry", "honeypot", "scanner", "trap", "core", "entry"] as const;
export type DefenseNodeTypeV1 = (typeof DEFENSE_NODE_TYPES_V1)[number];

/**
 * v2 adds five node types (RULESET.md §14, ADR 0007 §A) on top of everything v1 has. `DefenseGraph`
 * is shared by `BattleInputV1` and `BattleInputV2`, so the type is one superset rather than two
 * unrelated unions — splitting it would cascade into `battle-common.ts`, `graph.ts`, `score.ts`,
 * and both engines for no benefit, since a v1 graph containing a v2-only node type is a *runtime*
 * validation failure (`unsupported-node-type`, `graph.ts`), not a type error.
 */
export const DEFENSE_NODE_TYPES_V2 = [...DEFENSE_NODE_TYPES_V1, "patch-server", "tarpit", "jammer", "turnstile", "alarm"] as const;
export type DefenseNodeType = (typeof DEFENSE_NODE_TYPES_V2)[number];

/** Router/Entry/Core are untiered (RULESET.md §5.1); firewall/ice-sentry/honeypot/scanner/trap carry a tier. */
export interface DefenseNode {
  readonly id: number;
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
}

export interface DefenseEdge {
  readonly from: number;
  readonly to: number;
  readonly lengthDu: number;
}

export interface DefenseGraph {
  readonly nodes: readonly DefenseNode[];
  readonly edges: readonly DefenseEdge[];
  readonly entryNodeIds: readonly number[];
  readonly coreNodeId: number;
  /** Core's starting HP (RULESET.md §5.2) — account-tier-dependent, so it's baked in here rather than derived, keeping BattleInput self-contained/replayable. */
  readonly coreHp: number;
}

/**
 * Discriminated on `rulesetVersion` (ADR 0006 §7): a v1 log carries a block chain, a v2 log
 * carries an event sheet, and neither can be silently fed to the other engine.
 */
export interface BattleInputV1 {
  readonly rulesetVersion: "v1";
  readonly seed: number;
  readonly virus: VirusDesign;
  readonly defense: DefenseGraph;
}

export interface BattleInputV2 {
  readonly rulesetVersion: "v2";
  readonly seed: number;
  readonly virus: VirusProgram;
  readonly defense: DefenseGraph;
}

export type BattleInput = BattleInputV1 | BattleInputV2;

export type BattleEventType =
  | "virus-entered-node"
  | "virus-departed-node"
  | "virus-damaged"
  | "virus-repaired"
  /**
   * Two roles (PLAN.md 8.3d): the BATTLE-ending death — no entity survives, `actor: "virus"`, never
   * `entityId` — is still pushed exactly once, by `finalize()`, at the very end of the log. A body
   * that dies WITH a `set-checkpoint` charge and respawns instead pushes this same type first (its
   * own individual death, carrying `entityId` under the same `sheetCanSplit()` gate as everything
   * else) immediately followed by `virus-respawned` — "it died, then it came back" is the readable
   * story the log tells, never a silent jump from 0 Integrity to positive.
   */
  | "virus-died"
  /** v2 only (PLAN.md 8.3d): a body just consumed a `set-checkpoint` charge to come back from 0
   * Integrity — always preceded, same tick, by that body's own `virus-died`. `target` is the
   * checkpoint node's id, `delta` the Integrity it woke up with. The ONLY event type allowed to
   * mark Integrity rising from 0 (RULESET.md §13's invariant) — no other code path may do it. */
  | "virus-respawned"
  | "node-damaged"
  | "node-destroyed"
  /** v2 only (RULESET.md §14, ADR 0007 §A): Patch Server healing a Breach Node — deliberately its
   * own type rather than a positive-delta "node-damaged", which would read as a contradiction. */
  | "node-repaired"
  | "status-applied"
  | "status-expired"
  | "decoy-absorbed"
  | "battle-timeout"
  | "battle-won"
  /** v2 only (ADR 0006 §6): an event whose actions actually had an effect this tick. `actor` is
   * the event's id or path, which is what lets a replay light up the rule that fired. */
  | "rule-fired"
  /** v2 only, multi-entity (PLAN.md 8.3c): a `worm-split` action resolved. `entityId` is the body
   * that split (always present — this event can only exist when its sheet's `sheetCanSplit()` is
   * true), `target` is the new body's id. Reuses no other event type because "one body is now two,
   * both possibly at reduced Integrity" isn't a damage/repair/move on any single body. */
  | "virus-split";

export interface BattleEvent {
  readonly tick: number;
  readonly type: BattleEventType;
  readonly actor: string;
  readonly target?: string;
  readonly delta?: number;
  /**
   * v2 multi-entity only (ADR 0008, PLAN.md 8.3b): which VirusEntity this event is about, when it
   * is about one body specifically (movement, damage/heal to that body, its own rule-fired, its
   * own status changes, its own death-then-respawn) — absent for defense-side and battle-level
   * events (node-repaired by a Patch Server, battle-won/battle-timeout, the BATTLE-ending
   * `virus-died` pushed once by `finalize()`, an Alarm's network-wide status-applied). A body's own
   * `virus-died` (the one immediately followed by `virus-respawned`, PLAN.md 8.3d) is entity-specific
   * and follows the same gate as everything else here — see that type's own doc for the distinction.
   *
   * ABSENT (not 0) for every battle whose sheet contains no `worm-split` action — decided once,
   * before tick 0, by `sheetCanSplit()`, so a log's event shape never depends on whether a split
   * actually happened later. Every log that exists today has no split action anywhere, so this
   * field is byte-for-byte absent from all of them: `entityId: undefined` is NOT the same bytes as
   * an absent key (determinism.test.ts's stableStringify uses Object.keys), so every write site
   * uses the `...(canSplit ? { entityId } : {})` idiom, never a literal `entityId: undefined`.
   */
  readonly entityId?: number;
}

export interface Score {
  readonly value: number;
  readonly integrityRatioPermille: number;
  readonly coreRatioPermille: number;
  readonly nodesDestroyed: number;
  readonly timeBonus: number;
}

export interface BattleResult {
  readonly winner: "attacker" | "defender";
  readonly score: Score;
}

export interface BattleLog {
  readonly input: BattleInput;
  readonly events: readonly BattleEvent[];
  readonly result: BattleResult;
}

export interface AccountTierConfig {
  readonly tier: 1 | 2 | 3 | 4 | 5;
  readonly payloadBudgetKb: number;
  readonly defenseBudgetPoints: number;
  readonly coreHp: number;
  /**
   * v2 only: hard cap on how many event rows a sheet may contain, counting nested rows
   * (RULESET v2 §4.0). Bounds the server's per-tick work regardless of how cheap the rows are.
   * Undefined on the frozen v1 tiers, which have no sheets.
   */
  readonly maxSheetEvents?: number;
}

export interface Ruleset {
  readonly version: RulesetVersion;
  readonly tickLimit: number;
  readonly accountTiers: readonly AccountTierConfig[];
}
