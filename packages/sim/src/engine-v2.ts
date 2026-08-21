import { findEdgeLength, findNode, isVirusInRange, neighborsOf, requireTier, type EdgeLocation, type VirusLocation } from "./battle-common.js";
import { computeScore } from "./score.js";
import { BATTLE_TICK_LIMIT, applyPermille, ticksToCrossEdge } from "./fixed.js";
import { hopDistance, shortestPath } from "./graph.js";
import {
  effectiveAccuracyPermilleV2,
  firewallMaxHpV2,
  getAlarmConfigV2,
  getIceSentryConfigV2,
  getJammerConfigV2,
  getPatchServerConfigV2,
  getScannerConfigV2,
  getTarpitConfigV2,
  getTurnstileConfigV2,
  resolveCoreTickV2,
  resolveFirewallTickV2,
  rollIceSentryHitV2,
  trapTriggerDamageV2,
} from "./nodes-v2/index.js";
import { createRng, type Rng } from "./rng.js";
import {
  ALARM_ICE_ACCURACY_BONUS_PERMILLE,
  ALARM_ICE_FIRE_INTERVAL_REDUCTION_TICKS,
  DEFAULT_CONDITION_TARGET_NODE_TYPES_V2,
  DEFAULT_INTEGRITY_THRESHOLD_PERMILLE_V2,
  MAX_ACTIONS_PER_TICK_V2,
  VIRUS_START_INTEGRITY,
  getActionSpec,
  getBruteForceDamagePerTickV2,
  getCheckpointConfigV2,
  getCloakConfigV2,
  getConditionRadiusHops,
  getConditionSpec,
  getDecoyConfigV2,
  getDetonateConfigV2,
  getExploitDamageV2,
  getOverloadConfigV2,
  getSelfRepairHealPerTickV2,
  getSlowCrawlConfigV2,
  getWormSplitConfigV2,
  WORM_SPLIT_MIN_INTEGRITY_V2,
  DEFAULT_CORE_WITHIN_HOPS_V2,
  DEFAULT_ENTITY_COUNT_V2,
  DEFAULT_FLAG_INDEX_V2,
  DEFAULT_HP_THRESHOLD_PERMILLE_V2,
  DEFAULT_TICKS_PARAM_V2,
  MIN_EVERY_N_TICKS_V2,
  FLAG_COUNT_V2,
} from "./ruleset-v2.js";
import { sheetCanSplit, walkSheet } from "./sheet.js";
import type { ActionKind, BattleEvent, BattleInputV2, BattleLog, BlockTier, DefenseGraph, DefenseNode, SheetAction, SheetCondition, SheetEvent } from "./types.js";

/**
 * Ruleset v2 engine — the virus as a nested event sheet (docs/ADR/0006).
 *
 * The v1 engine in engine.ts is untouched and stays the specification of every log that says
 * "v1"; this is a second, parallel interpreter that `simulate()` dispatches to. What changed is
 * not the physics but *who decides*: in v1 a fixed movement block plus a chain of blocks gated by
 * array position, in v2 an ordered tree of rules evaluated fresh every tick.
 *
 * ### Multi-entity (PLAN.md 8.3, ADR 0008)
 *
 * A battle is one or more `VirusEntity` bodies sharing one sheet (`worm-split`, 8.3c). 8.3a keeps
 * `state.entities` at exactly one element — no split action exists yet — but every phase below
 * already loops over entities so 8.3c only has to add the split itself. The partition that matters:
 * anything describing the DEFENSE lives on `BattleStateV2` (`coreHp`, `firewallHp`,
 * `destroyedFirewallIds`, `spentTrapIds`, `triggeredHoneypotIds`, `iceNextFireTick`,
 * `firewallsDestroyed`, `turnstileLockouts`, `alarmTriggeredIds`, `alarmActiveUntilTick` — a
 * Turnstile lockout and a network alert are properties of the MAP, not of whichever body triggered
 * them); anything describing an attacker's BODY lives on `VirusEntity`.
 *
 * `work` (built fresh each tick from entities alive at the tick's start) is what every phase after
 * sensor-sweep iterates — never `state.entities` directly and never a live `entity.died` check
 * mid-tick. That is deliberate: a body that takes lethal counter-damage in phase C still finishes
 * out the tick's remaining phases exactly as the pre-8.3 single-entity code did (nothing gated on
 * death mid-tick there either — death was, and still is, only checked at `finalize()`). Using a
 * snapshot instead of a live filter is what makes N=1 byte-identical to the code this replaced.
 *
 * ### Tick order (RULESET.md v2 §11 / §11a)
 *
 * 1. **Sensor sweep** — per entity, ascending id. A Jammer in range (RULESET.md §14) makes this
 *    see nothing, sheet-side, regardless of what's actually near.
 * 2. **Sheet evaluation** — per entity, depth-first, top to bottom, producing that entity's own
 *    plan of intents. Never consumes RNG (ADR 0006 §2).
 * 3. **Statuses** — per entity. Cloak / Slow Crawl take effect *before* anything shoots.
 * 4. **Node effects** — per entity: `detonate` resolves first (PLAN.md 8.3c) and, if it fires,
 *    replaces the rest of this phase for that body entirely — it sacrifices its whole remaining
 *    Integrity as one-shot damage to the occupied Breach Node and dies on the spot. Otherwise:
 *    Attack actions against the Breach Node it occupies, the node's counter-damage (destroying a
 *    Breach Node can arm an Alarm Relay in range) → Alarm Relay proximity trigger (any entity) →
 *    ICE Sentry fire (sentries outer, ascending node id; each off-cooldown sentry targets the
 *    lowest-id living, uncloaked, in-range entity and takes exactly one draw — RNG) → Trap/Honeypot
 *    triggers (per entity) → Scanner aura (per entity) → Patch Server heal, LAST and
 *    entity-independent (it heals nodes, not bodies), so this tick's damage is still visible before
 *    any of it gets healed back.
 * 5. **Utility** — per entity: Self Repair, decoy arming, `set-checkpoint` (PLAN.md 8.3d, only while
 *    standing on a node and still alive — a body already dead this tick can't mark one).
 * 6. **Movement** — per entity, ascending id; move-random draws here. The winning intent is
 *    consumed at the END of the tick, so a body that arrives somewhere always gets one full tick
 *    of acting there before it can leave. Tarpit/Turnstile apply here.
 * H. **`worm-split` resolution** (PLAN.md 8.3c) — per entity, AFTER movement, so a new body never
 *    acts on the tick it's born. Appended with a fresh, monotonically increasing id; never spliced
 *    in. Refused below `WORM_SPLIT_MIN_INTEGRITY_V2` Integrity or at the tier's living-entity cap.
 * I. **Checkpoint respawn** (PLAN.md 8.3d) — per entity, reading `entity.died` LIVE (the one phase
 *    that deliberately reacts to a death from anywhere earlier this same tick, rather than working
 *    from a tick-start snapshot of it). A dead body with an armed checkpoint, respawns remaining,
 *    and no `noRespawn` (`detonate`) comes back here: `virus-died` → `virus-respawned` →
 *    `virus-entered-node`, in that order, at the checkpoint node.
 * 7. **`rule-fired`** — per entity ascending id (the tick-start snapshot — a body born this tick via
 *    H does not appear here until next tick), then that entity's own fired rule ids sorted — for
 *    every rule whose actions actually did something, then win/loss.
 *
 * Win/lose: attacker wins the instant `coreHp <= 0`, whichever body did it. Defender wins once
 * every entity has died. Score's `integrityRatioPermille` uses the MAXIMUM integrity among living
 * entities (0 if none) rather than a sum, so it stays in computeScore's expected 0..1000 range.
 */

type MovementActionKind = "move-toward-core" | "move-avoiding-hazards" | "move-random" | "move-back" | "hold-position";

interface SlotWrite<T> {
  /** The rule that won the slot — the first writer this tick (ADR 0006 §3). */
  readonly ruleId: string;
  readonly value: T;
}

interface Contribution {
  readonly ruleId: string;
  readonly amount: number;
}

interface OverloadContribution {
  readonly ruleId: string;
  readonly splashDamage: number;
  readonly radiusHops: number;
}

/** One tick's worth of decided-but-not-yet-applied intent, for one entity. */
interface TickPlan {
  movement: SlotWrite<MovementActionKind> | null;
  cloak: SlotWrite<BlockTier> | null;
  slowCrawl: SlotWrite<BlockTier> | null;
  decoy: SlotWrite<BlockTier> | null;
  /** Written by `worm-split`; resolved after movement (phase H, PLAN.md 8.3c). */
  split: SlotWrite<BlockTier> | null;
  /** Written by `detonate`; resolved in node effects (phase 4a) before the regular occupancy attack. */
  detonate: SlotWrite<BlockTier> | null;
  /** Written by `set-checkpoint`; resolved in utility (phase 5, PLAN.md 8.3d), alongside Self Repair. */
  checkpoint: SlotWrite<BlockTier> | null;
  readonly bruteForce: Contribution[];
  readonly exploit: Contribution[];
  readonly overload: OverloadContribution[];
  readonly selfRepair: Contribution[];
  actionsRun: number;
}

function emptyPlan(): TickPlan {
  return { movement: null, cloak: null, slowCrawl: null, decoy: null, split: null, detonate: null, checkpoint: null, bruteForce: [], exploit: [], overload: [], selfRepair: [], actionsRun: 0 };
}

interface DecoyState {
  activationsUsed: number;
  absorbsRemaining: number;
}

/** One attacker body. See the module docstring for the global/per-entity split rationale. */
interface VirusEntity {
  readonly id: number;
  location: VirusLocation;
  integrity: number;
  /**
   * Latched the moment Integrity reaches 0. The death check only runs at `finalize()`, and Self
   * Repair is no longer gated on "took no damage this tick" (ADR 0006 §8) — without this latch a
   * repair later in the same tick would quietly resurrect a body that was already dead, which no
   * rule in RULESET §7/§11 allows. v1 never needed it because its hardcoded gate made the case
   * unreachable.
   */
  died: boolean;
  damageTakenThisTick: number;
  damageTakenLastTick: number;
  cloakUntilTick: number;
  cloakReadyAtTick: number;
  readonly decoy: DecoyState;
  /** Once-scope bookkeeping, one generic set instead of v1's per-block special cases (ADR 0006 §4). */
  readonly firedOnceKeys: Set<string>;
  arrivalCount: number;
  previousNodeId: number | null;
  /** True on the first tick this body stands on the node it just reached — Exploit's window. */
  freshArrival: boolean;
  /** ADR 0006 open question 1, resolved: an intent written mid-transit is kept (last one wins) and
   * applied on arrival only if the sheet writes nothing on the arrival tick itself. */
  queuedMovement: MovementActionKind | null;
  readonly triedEdgesFromNode: Map<number, Set<number>>;
  scannedUntilTick: number | null;
  scannedAccuracyBonusPermille: number;
  honeypotPendingDeathTick: number | null;
  /** Set by `detonate` (PLAN.md 8.3c): this body's death is a deliberate sacrifice, so `set-checkpoint`
   * respawn (8.3d) must never bring it back. */
  noRespawn: boolean;
  /** `set-checkpoint`'s recorded node, or null if none is armed (never set, or already consumed by
   * a respawn — PLAN.md 8.3d). Re-setting overwrites both this and the two fields below with the
   * NEW tier's config; it does not stack with whatever was recorded before. */
  checkpointNodeId: number | null;
  /** Absolute Integrity this body wakes up with, from the tier of whichever `set-checkpoint` last fired. */
  respawnIntegrity: number;
  /** Total respawns this body may use for the rest of the battle, from that same tier. */
  respawnsTotal: number;
  /** Never decreases, never reset by re-setting the checkpoint — a whole-battle budget. */
  respawnsUsed: number;
  /** `set-flag`/`flag-is` (PLAN.md 8.4, RULESET.md §12) — program memory, copied to a split clone
   * like `firedOnceKeys`, never reset by anything else this body does. */
  readonly flags: boolean[];
  /** `visited-here-before` (PLAN.md 8.4) — nodes this body has DEPARTED at least once (added on
   * departure, not arrival, so the dwell a node was first reached on never reads as "visited
   * before" — only a genuine, later return does). Copied to a split clone like `firedOnceKeys`. */
  readonly visitedNodeIds: Set<number>;
}

interface BattleStateV2 {
  readonly entities: VirusEntity[];
  coreHp: number;
  readonly firewallHp: Map<number, number>;
  readonly destroyedFirewallIds: Set<number>;
  readonly spentTrapIds: Set<number>;
  /** GLOBAL, same as `spentTrapIds` (PLAN.md 8.3c decision, worth stating explicitly now that a
   * second body can reach the same node): a Honeypot that has already sprung on one body is spent
   * for everyone, so a second body arriving later walks through safely — consistent with Trap, and
   * meaning one body's honeypot kill no longer also pins down every OTHER body that visits it. */
  readonly triggeredHoneypotIds: Set<number>;
  readonly iceNextFireTick: Map<number, number>;
  firewallsDestroyed: number;
  /** Turnstile (RULESET.md §14): node id -> the tick before which re-entering it is forbidden.
   * Global, not per-entity — the gate slams shut for anyone once a body departs it, not just the
   * one that left. Keyed by node, not edge, so it blocks every movement kind equally. */
  readonly turnstileLockouts: Map<number, number>;
  /** Alarm Relay (RULESET.md §14): each relay is a one-shot trigger (like Honeypot/Trap), but the
   * alert it raises is one shared, network-wide window — a second relay firing while one is
   * already active extends to the longer remaining duration rather than stacking a second on top. */
  readonly alarmTriggeredIds: Set<number>;
  alarmActiveUntilTick: number;
}

function damageVirus(entity: VirusEntity, amount: number): number {
  const before = entity.integrity;
  entity.integrity = Math.max(0, entity.integrity - amount);
  const dealt = before - entity.integrity;
  entity.damageTakenThisTick += dealt;
  if (entity.integrity <= 0) {
    entity.died = true;
  }
  return dealt;
}

/** Firewall counter-damage is never absorbable — same carve-out v1 makes (RULESET.md §4.2). */
function tryAbsorbWithDecoy(entity: VirusEntity): boolean {
  if (entity.decoy.absorbsRemaining > 0) {
    entity.decoy.absorbsRemaining -= 1;
    return true;
  }
  return false;
}

/* --- Conditions ------------------------------------------------------------------------- */

interface ConditionContextV2 {
  readonly graph: DefenseGraph;
  readonly state: BattleStateV2;
  readonly entity: VirusEntity;
  readonly tick: number;
}

/**
 * "node di depan" (ADR 0006 open question 2, resolved): the node the body is heading for. In
 * transit that is unambiguous — it's the edge's far end. Standing on a node it is the next hop of
 * the DU-shortest path to Core, i.e. where it goes if nothing intervenes. Computing it from the
 * graph rather than from the movement intent keeps conditions readable in isolation and keeps
 * evaluation free of RNG.
 */
function nodeAheadId(graph: DefenseGraph, location: VirusLocation): number | null {
  if (location.kind === "edge") {
    return location.to;
  }
  const path = shortestPath(graph, location.nodeId, graph.coreNodeId);
  return path && path.length >= 2 ? path[1]! : null;
}

function currentNodeId(location: VirusLocation): number | null {
  return location.kind === "node" ? location.nodeId : null;
}

function isBreachNode(graph: DefenseGraph, state: BattleStateV2, nodeId: number): boolean {
  const node = findNode(graph, nodeId);
  if (node.type === "core") {
    return true;
  }
  return node.type === "firewall" && !state.destroyedFirewallIds.has(nodeId);
}

/** A Honeypot disguised as Core (RULESET.md §5.1, tier II+) is invisible to all but the top sensor tier. */
function honeypotIsVisible(honeypotTier: BlockTier, conditionTier: BlockTier, seesDisguiseFromTier: BlockTier | undefined): boolean {
  if (honeypotTier < 2) {
    return true;
  }
  return seesDisguiseFromTier !== undefined && conditionTier >= seesDisguiseFromTier;
}

/** Jammer nodes (RULESET.md §14) currently within range of a location — a pure function of graph
 * position, unlike every other status here, so it needs no BattleStateV2 bookkeeping at all. */
function activeJammerNodes(graph: DefenseGraph, location: VirusLocation): DefenseNode[] {
  return graph.nodes.filter((node) => node.type === "jammer" && isVirusInRange(graph, node.id, getJammerConfigV2(requireTier(node)).radiusHops, location));
}

function isJammed(graph: DefenseGraph, location: VirusLocation): boolean {
  return activeJammerNodes(graph, location).length > 0;
}

/** Strongest (lowest ‰) Tarpit multiplier active at a node — a second Tarpit in range never
 * multiplies on top of the first (RULESET.md §14: "tidak menumpuk"). 1000‰ (no effect) if none. */
function activeTarpitMultiplierPermille(graph: DefenseGraph, nodeId: number): number {
  let strongest = 1000;
  for (const node of graph.nodes) {
    if (node.type !== "tarpit") {
      continue;
    }
    const config = getTarpitConfigV2(requireTier(node));
    const distance = hopDistance(graph, node.id, nodeId);
    if (distance !== null && distance <= config.radiusHops && config.speedMultiplierPermille < strongest) {
      strongest = config.speedMultiplierPermille;
    }
  }
  return strongest;
}

function sensedHazardNodeIds(condition: SheetCondition, graph: DefenseGraph, state: BattleStateV2, location: VirusLocation): number[] {
  // A Jammer in range makes every sensor condition read false (ADR 0006 §8-adjacent: this is a
  // visible, explainable blind spot, not hidden RNG — the `jammed` condition, 8.4, tells the sheet
  // why). Gating here covers BOTH callers at once: the sensor sweep (phase 1) and
  // evaluateConditionPositively's "honeypot-near"/"trap-near" case route through this function.
  if (isJammed(graph, location)) {
    return [];
  }
  const tier = condition.tier ?? 1;
  const spec = getConditionSpec(condition.kind);
  const radiusHops = getConditionRadiusHops(condition.kind, tier);
  const found: number[] = [];
  for (const node of graph.nodes) {
    if (!isVirusInRange(graph, node.id, radiusHops, location)) {
      continue;
    }
    if (condition.kind === "honeypot-near" && node.type === "honeypot" && !state.triggeredHoneypotIds.has(node.id) && honeypotIsVisible(requireTier(node), tier, spec.seesDisguiseFromTier)) {
      found.push(node.id);
    } else if (condition.kind === "trap-near" && node.type === "trap" && !state.spentTrapIds.has(node.id)) {
      found.push(node.id);
    }
  }
  return found;
}

function evaluateCondition(condition: SheetCondition, ctx: ConditionContextV2): boolean {
  const result = evaluateConditionPositively(condition, ctx);
  return condition.negate === true ? !result : result;
}

function evaluateConditionPositively(condition: SheetCondition, ctx: ConditionContextV2): boolean {
  const targets = condition.targetNodeTypes ?? DEFAULT_CONDITION_TARGET_NODE_TYPES_V2;
  const location = ctx.entity.location;
  switch (condition.kind) {
    case "node-here-is": {
      const here = currentNodeId(location);
      return here !== null && targets.includes(findNode(ctx.graph, here).type);
    }
    case "node-ahead-is": {
      // Tier III Jammer also falsifies this one (RULESET.md §14) — seeing round a corner is
      // exactly what Scan Ahead used to sell, and a strong-enough Jammer un-sells it.
      if (activeJammerNodes(ctx.graph, location).some((node) => getJammerConfigV2(requireTier(node)).jamsNodeAhead)) {
        return false;
      }
      const ahead = nodeAheadId(ctx.graph, location);
      return ahead !== null && targets.includes(findNode(ctx.graph, ahead).type);
    }
    case "honeypot-near":
    case "trap-near":
      return sensedHazardNodeIds(condition, ctx.graph, ctx.state, location).length > 0;
    case "integrity-below":
      return ctx.entity.integrity < (condition.integrityThresholdPermille ?? DEFAULT_INTEGRITY_THRESHOLD_PERMILLE_V2);
    case "is-scanned":
      return ctx.entity.scannedUntilTick !== null && ctx.tick < ctx.entity.scannedUntilTick;
    case "took-damage-last-tick":
      return ctx.entity.damageTakenLastTick > 0;
    case "on-breach-node": {
      const here = currentNodeId(location);
      return here !== null && isBreachNode(ctx.graph, ctx.state, here);
    }
    case "at-node":
      return location.kind === "node";
    // --- v2-only, PLAN.md 8.4 ---
    case "ice-near": {
      if (isJammed(ctx.graph, location)) {
        return false;
      }
      const radius = getConditionRadiusHops("ice-near", condition.tier ?? 1);
      return ctx.graph.nodes.some(
        (node) => node.type === "ice-sentry" && isVirusInRange(ctx.graph, node.id, radius, location) && ctx.tick >= (ctx.state.iceNextFireTick.get(node.id) ?? 0),
      );
    }
    case "scanner-near": {
      if (isJammed(ctx.graph, location)) {
        return false;
      }
      const radius = getConditionRadiusHops("scanner-near", condition.tier ?? 1);
      return ctx.graph.nodes.some((node) => node.type === "scanner" && isVirusInRange(ctx.graph, node.id, radius, location));
    }
    case "core-within-hops": {
      const hops = condition.hops ?? DEFAULT_CORE_WITHIN_HOPS_V2;
      const fromNodeId = location.kind === "node" ? location.nodeId : location.to;
      const distance = hopDistance(ctx.graph, fromNodeId, ctx.graph.coreNodeId);
      return distance !== null && distance <= hops;
    }
    case "core-hp-below": {
      if (ctx.graph.coreHp <= 0) {
        return false;
      }
      const threshold = condition.thresholdPermille ?? DEFAULT_HP_THRESHOLD_PERMILLE_V2;
      return (ctx.state.coreHp * 1000) / ctx.graph.coreHp < threshold;
    }
    case "node-hp-below": {
      const here = currentNodeId(location);
      if (here === null) {
        return false;
      }
      const node = findNode(ctx.graph, here);
      const threshold = condition.thresholdPermille ?? DEFAULT_HP_THRESHOLD_PERMILLE_V2;
      if (node.type === "core") {
        return ctx.graph.coreHp > 0 && (ctx.state.coreHp * 1000) / ctx.graph.coreHp < threshold;
      }
      if (node.type === "firewall" && !ctx.state.destroyedFirewallIds.has(node.id)) {
        const maxHp = firewallMaxHpV2(requireTier(node));
        const currentHp = ctx.state.firewallHp.get(node.id) ?? maxHp;
        return (currentHp * 1000) / maxHp < threshold;
      }
      return false;
    }
    case "blocked-ahead": {
      const ahead = nodeAheadId(ctx.graph, location);
      return ahead !== null && isBreachNode(ctx.graph, ctx.state, ahead);
    }
    case "visited-here-before": {
      const here = currentNodeId(location);
      return here !== null && ctx.entity.visitedNodeIds.has(here);
    }
    case "cloak-ready":
      return ctx.tick >= ctx.entity.cloakUntilTick && ctx.tick >= ctx.entity.cloakReadyAtTick;
    case "decoy-armed":
      return ctx.entity.decoy.absorbsRemaining > 0;
    case "slowed": {
      const here = currentNodeId(location);
      return here !== null && activeTarpitMultiplierPermille(ctx.graph, here) < 1000;
    }
    case "jammed":
      return isJammed(ctx.graph, location);
    case "alarm-active":
      return ctx.tick < ctx.state.alarmActiveUntilTick;
    case "tick-after":
      return ctx.tick >= (condition.ticks ?? DEFAULT_TICKS_PARAM_V2);
    case "every-n-ticks": {
      const ticks = Math.max(MIN_EVERY_N_TICKS_V2, condition.ticks ?? DEFAULT_TICKS_PARAM_V2);
      return ctx.tick % ticks === 0;
    }
    case "flag-is": {
      const flagIndex = condition.flagIndex ?? DEFAULT_FLAG_INDEX_V2;
      return ctx.entity.flags[flagIndex] === true;
    }
    case "is-clone":
      return ctx.entity.id !== 0;
    case "entity-count-below": {
      const count = condition.count ?? DEFAULT_ENTITY_COUNT_V2;
      return ctx.state.entities.filter((candidate) => !candidate.died).length < count;
    }
    default:
      return false;
  }
}

/* --- Sheet evaluation ------------------------------------------------------------------- */

function onceKey(ruleId: string, scope: SheetEvent["once"], ctx: ConditionContextV2): string {
  if (scope === "battle") {
    return ruleId;
  }
  if (scope === "arrival") {
    return `${ruleId}@a${ctx.entity.arrivalCount}`;
  }
  const location = ctx.entity.location;
  return location.kind === "node" ? `${ruleId}@n${location.nodeId}` : `${ruleId}@t${location.from}-${location.to}`;
}

function writeSlot<T>(current: SlotWrite<T> | null, ruleId: string, value: T): SlotWrite<T> {
  // First writer wins — the deliberate deviation from GDevelop's last-wins (ADR 0006 §3).
  return current ?? { ruleId, value };
}

function applyAction(action: SheetAction, ruleId: string, plan: TickPlan): void {
  const tier = action.tier ?? 1;
  const kind: ActionKind = action.kind;
  const spec = getActionSpec(kind);
  if (spec.slot === "movement") {
    plan.movement = writeSlot(plan.movement, ruleId, kind as MovementActionKind);
    return;
  }
  if (spec.slot === "cloak") {
    plan.cloak = writeSlot(plan.cloak, ruleId, tier);
    return;
  }
  if (spec.slot === "slow-crawl") {
    plan.slowCrawl = writeSlot(plan.slowCrawl, ruleId, tier);
    return;
  }
  if (spec.slot === "decoy") {
    plan.decoy = writeSlot(plan.decoy, ruleId, tier);
    return;
  }
  if (spec.slot === "split") {
    plan.split = writeSlot(plan.split, ruleId, tier);
    return;
  }
  if (spec.slot === "detonate") {
    plan.detonate = writeSlot(plan.detonate, ruleId, tier);
    return;
  }
  if (spec.slot === "checkpoint") {
    plan.checkpoint = writeSlot(plan.checkpoint, ruleId, tier);
    return;
  }
  if (kind === "brute-force") {
    plan.bruteForce.push({ ruleId, amount: getBruteForceDamagePerTickV2(tier) });
  } else if (kind === "exploit") {
    plan.exploit.push({ ruleId, amount: getExploitDamageV2(tier) });
  } else if (kind === "overload") {
    const config = getOverloadConfigV2(tier);
    plan.overload.push({ ruleId, splashDamage: config.splashDamage, radiusHops: config.radiusHops });
  } else if (kind === "self-repair") {
    plan.selfRepair.push({ ruleId, amount: getSelfRepairHealPerTickV2(tier) });
  }
}

/**
 * Walks the sheet once, depth-first, top to bottom, for one entity. A parent whose conditions fail
 * skips its actions *and* its whole subtree — that is what nesting means here. `once` is consumed
 * the moment a row runs, not when its effects land, so a spent one-shot can't quietly re-arm itself.
 */
function evaluateSheet(events: readonly SheetEvent[], ctx: ConditionContextV2, plan: TickPlan, prefix = ""): void {
  events.forEach((event, index) => {
    const path = prefix === "" ? String(index) : `${prefix}.${index}`;
    const ruleId = event.id ?? path;
    if (event.once !== undefined && ctx.entity.firedOnceKeys.has(onceKey(ruleId, event.once, ctx))) {
      return;
    }
    if (!event.conditions.every((condition) => evaluateCondition(condition, ctx))) {
      return;
    }
    if (event.once !== undefined) {
      ctx.entity.firedOnceKeys.add(onceKey(ruleId, event.once, ctx));
    }
    for (const action of event.actions) {
      if (plan.actionsRun >= MAX_ACTIONS_PER_TICK_V2) {
        return;
      }
      plan.actionsRun += 1;
      applyAction(action, ruleId, plan);
    }
    evaluateSheet(event.children, ctx, plan, path);
  });
}

/* --- Movement ---------------------------------------------------------------------------- */

function resolveMovementTarget(kind: MovementActionKind, fromNodeId: number, graph: DefenseGraph, entity: VirusEntity, rng: Rng, knownHazardNodeIds: ReadonlySet<number>): number | null {
  if (kind === "hold-position") {
    return null;
  }
  if (kind === "move-back") {
    const previous = entity.previousNodeId;
    return previous !== null && previous !== fromNodeId && neighborsOf(graph, fromNodeId).includes(previous) ? previous : null;
  }
  if (kind === "move-random") {
    const neighbors = neighborsOf(graph, fromNodeId);
    if (neighbors.length === 0) {
      return null;
    }
    let tried = entity.triedEdgesFromNode.get(fromNodeId);
    if (!tried) {
      tried = new Set<number>();
      entity.triedEdgesFromNode.set(fromNodeId, tried);
    }
    let candidates = neighbors.filter((neighbor) => !tried!.has(neighbor));
    if (candidates.length === 0) {
      tried.clear();
      candidates = neighbors;
    }
    const pick = candidates[rng.nextInt(candidates.length)]!;
    tried.add(pick);
    return pick;
  }
  const avoiding = kind === "move-avoiding-hazards" ? shortestPath(graph, fromNodeId, graph.coreNodeId, { avoid: knownHazardNodeIds }) : null;
  const path = avoiding ?? shortestPath(graph, fromNodeId, graph.coreNodeId);
  return path && path.length >= 2 ? path[1]! : null;
}

/** A body standing on an intact Firewall/Core is pinned there; a sprung Honeypot holds it for the tick it kills. */
function isBlockingNodeV2(nodeId: number, graph: DefenseGraph, state: BattleStateV2, entity: VirusEntity): boolean {
  const node = findNode(graph, nodeId);
  if (node.type === "firewall") {
    return !state.destroyedFirewallIds.has(nodeId);
  }
  if (node.type === "core") {
    return state.coreHp > 0;
  }
  if (node.type === "honeypot") {
    return entity.honeypotPendingDeathTick !== null;
  }
  return false;
}

/* --- The battle -------------------------------------------------------------------------- */

/** Per-entity working state for one tick — built in phase A/B, read by every later phase. */
interface EntityTickWork {
  readonly entity: VirusEntity;
  readonly plan: TickPlan;
  readonly knownHazardNodeIds: ReadonlySet<number>;
  readonly firedRuleIds: Set<string>;
  cloakActive: boolean;
  slowCrawl: ReturnType<typeof getSlowCrawlConfigV2> | null;
  bruteForceDamage: number;
  exploitDamage: number;
}

export function simulateV2(input: BattleInputV2): BattleLog {
  const graph = input.defense;
  const coreNode = findNode(graph, graph.coreNodeId);
  if (coreNode.type !== "core") {
    throw new Error("simulate(): defense graph has no valid core node — validate before simulating");
  }

  const rng = createRng(input.seed);
  const events: BattleEvent[] = [];

  /**
   * Decided once, before tick 0 (ADR 0008, PLAN.md 8.3b) — a sheet that can never write the split
   * slot never emits `entityId`, so a log's event shape depends only on the sheet, never on
   * whether a split actually happened later in this particular battle.
   */
  const canSplit = sheetCanSplit(input.virus);

  const entryIndex = rng.nextInt(graph.entryNodeIds.length);
  const firstEntity: VirusEntity = {
    id: 0,
    location: { kind: "node", nodeId: graph.entryNodeIds[entryIndex]! },
    integrity: VIRUS_START_INTEGRITY,
    died: false,
    damageTakenThisTick: 0,
    damageTakenLastTick: 0,
    cloakUntilTick: 0,
    cloakReadyAtTick: 0,
    decoy: { activationsUsed: 0, absorbsRemaining: 0 },
    firedOnceKeys: new Set(),
    arrivalCount: 0,
    previousNodeId: null,
    freshArrival: true,
    queuedMovement: null,
    triedEdgesFromNode: new Map(),
    scannedUntilTick: null,
    scannedAccuracyBonusPermille: 0,
    honeypotPendingDeathTick: null,
    noRespawn: false,
    checkpointNodeId: null,
    respawnIntegrity: 0,
    respawnsTotal: 0,
    respawnsUsed: 0,
    flags: new Array(FLAG_COUNT_V2).fill(false),
    visitedNodeIds: new Set(),
  };
  /** Append-only, ascending, never reused (PLAN.md 8.3a: entities are never spliced). */
  let nextEntityId = 1;

  const state: BattleStateV2 = {
    entities: [firstEntity],
    coreHp: graph.coreHp,
    firewallHp: new Map(),
    destroyedFirewallIds: new Set(),
    spentTrapIds: new Set(),
    triggeredHoneypotIds: new Set(),
    iceNextFireTick: new Map(),
    firewallsDestroyed: 0,
    turnstileLockouts: new Map(),
    alarmTriggeredIds: new Set(),
    alarmActiveUntilTick: 0,
  };

  events.push({ tick: 0, type: "virus-entered-node", actor: "virus", target: String(graph.entryNodeIds[entryIndex]!), ...(canSplit ? { entityId: firstEntity.id } : {}) });

  const iceSentryNodes = graph.nodes.filter((node) => node.type === "ice-sentry").sort((a, b) => a.id - b.id);
  const scannerNodes = graph.nodes.filter((node) => node.type === "scanner").sort((a, b) => a.id - b.id);
  const patchServerNodes = graph.nodes.filter((node) => node.type === "patch-server").sort((a, b) => a.id - b.id);
  const alarmNodes = graph.nodes.filter((node) => node.type === "alarm").sort((a, b) => a.id - b.id);

  /** Sensor conditions the sheet actually contains, so the hazard sweep costs nothing for a sheet that never asks. */
  const sensorConditions = walkSheet(input.virus.events)
    .flatMap((visit) => visit.event.conditions)
    .filter((condition) => condition.kind === "honeypot-near" || condition.kind === "trap-near");

  function livingEntities(): VirusEntity[] {
    return state.entities.filter((entity) => !entity.died);
  }

  /** 0..1000‰, the range computeScore expects — the MAXIMUM among living entities, not a sum
   * (RULESET.md §11a's multi-entity scoring rule): summing would break that range the instant
   * there is more than one body, and "how healthy is the strongest survivor" is the readable
   * analogue of what a single Integrity number meant before splitting existed. */
  function bestLivingIntegrityPermille(): number {
    const living = livingEntities();
    if (living.length === 0) {
      return 0;
    }
    return Math.max(...living.map((entity) => entity.integrity));
  }

  function finalize(tick: number): BattleLog | null {
    if (state.coreHp <= 0) {
      events.push({ tick, type: "battle-won", actor: "virus" });
      return {
        input,
        events,
        result: {
          winner: "attacker",
          score: computeScore("attacker", { integrityRatioPermille: bestLivingIntegrityPermille(), coreRatioPermille: 0, nodesDestroyed: state.firewallsDestroyed, ticksElapsed: tick }),
        },
      };
    }
    if (livingEntities().length === 0) {
      events.push({ tick, type: "virus-died", actor: "virus" });
      return {
        input,
        events,
        result: {
          winner: "defender",
          score: computeScore("defender", {
            integrityRatioPermille: 0,
            coreRatioPermille: Math.floor((state.coreHp * 1000) / graph.coreHp),
            nodesDestroyed: state.firewallsDestroyed,
            ticksElapsed: tick,
          }),
        },
      };
    }
    return null;
  }

  for (let tick = 0; tick < BATTLE_TICK_LIMIT; tick += 1) {
    // --- 1/2. Sensor sweep + sheet evaluation, per entity (ascending id — entities is append-only) ---
    // `work` snapshots which entities are alive AT TICK START; every later phase reads from it
    // rather than filtering state.entities live, so a body that dies mid-tick (e.g. to a Firewall's
    // counter-damage in phase C) still finishes out this tick's remaining phases — see module
    // docstring for why that's required for byte-identical N=1 behavior.
    const work: EntityTickWork[] = [];
    for (const entity of state.entities) {
      if (entity.died) {
        continue;
      }
      entity.damageTakenLastTick = entity.damageTakenThisTick;
      entity.damageTakenThisTick = 0;
      const knownHazardNodeIds = new Set<number>();
      for (const condition of sensorConditions) {
        for (const nodeId of sensedHazardNodeIds(condition, graph, state, entity.location)) {
          knownHazardNodeIds.add(nodeId);
        }
      }
      const plan = emptyPlan();
      const ctx: ConditionContextV2 = { graph, state, entity, tick };
      evaluateSheet(input.virus.events, ctx, plan);
      work.push({ entity, plan, knownHazardNodeIds, firedRuleIds: new Set(), cloakActive: false, slowCrawl: null, bruteForceDamage: 0, exploitDamage: 0 });
    }

    // --- 3. Statuses, per entity ---
    for (const w of work) {
      const { entity, plan } = w;
      if (plan.cloak && tick >= entity.cloakReadyAtTick && tick >= entity.cloakUntilTick) {
        const config = getCloakConfigV2(plan.cloak.value);
        entity.cloakUntilTick = tick + config.durationTicks;
        // Cooldown runs from expiry, so `[always] -> Cloak` buys a window, never permanent invisibility.
        entity.cloakReadyAtTick = entity.cloakUntilTick + config.cooldownTicks;
        w.firedRuleIds.add(plan.cloak.ruleId);
        events.push({ tick, type: "status-applied", actor: "cloak", target: "virus", ...(canSplit ? { entityId: entity.id } : {}) });
      }
      w.cloakActive = tick < entity.cloakUntilTick;
      w.slowCrawl = plan.slowCrawl ? getSlowCrawlConfigV2(plan.slowCrawl.value) : null;
      if (plan.slowCrawl && w.slowCrawl) {
        w.firedRuleIds.add(plan.slowCrawl.ruleId);
      }
    }

    /** Alarm Relay (RULESET.md §14): one-shot per relay, arms the shared alert window, extending
     * it to whichever is longer rather than stacking. `target: "core"` stands in for "the defense
     * network as a whole" — there's no per-network actor in BattleEvent, and this is the closest
     * existing convention (`status-applied`) gets. */
    const triggerAlarm = (alarmNode: DefenseNode): void => {
      if (state.alarmTriggeredIds.has(alarmNode.id)) {
        return;
      }
      state.alarmTriggeredIds.add(alarmNode.id);
      const config = getAlarmConfigV2(requireTier(alarmNode));
      state.alarmActiveUntilTick = Math.max(state.alarmActiveUntilTick, tick + config.alertDurationTicks);
      events.push({ tick, type: "status-applied", actor: String(alarmNode.id), target: "core" });
    };

    const triggerAlarmsNear = (destroyedNodeId: number): void => {
      for (const alarmNode of alarmNodes) {
        if (state.alarmTriggeredIds.has(alarmNode.id)) {
          continue;
        }
        const config = getAlarmConfigV2(requireTier(alarmNode));
        const distance = hopDistance(graph, destroyedNodeId, alarmNode.id);
        if (distance !== null && distance <= config.radiusHops) {
          triggerAlarm(alarmNode);
        }
      }
    };

    // --- 4a. Node effects: occupancy (attack/counter/destroy/splash), per entity ---
    for (const w of work) {
      const { entity, plan } = w;

      // Detonate (PLAN.md 8.3c): a one-shot sacrifice, resolved before this body's own occupancy
      // attack/counter-damage — the body is deliberately gone this tick, so nothing else it would
      // have done this tick (brute-force, exploit, taking counter-damage) still applies.
      if (plan.detonate && !entity.died) {
        const config = getDetonateConfigV2(plan.detonate.value);
        const damage = applyPermille(entity.integrity, config.damageMultiplierPermille);
        if (entity.location.kind === "node") {
          const node = findNode(graph, entity.location.nodeId);
          if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
            const currentHp = state.firewallHp.get(node.id) ?? firewallMaxHpV2(requireTier(node));
            const newHp = Math.max(0, currentHp - damage);
            state.firewallHp.set(node.id, newHp);
            events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - newHp), ...(canSplit ? { entityId: entity.id } : {}) });
            if (newHp <= 0) {
              state.destroyedFirewallIds.add(node.id);
              state.firewallsDestroyed += 1;
              events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id), ...(canSplit ? { entityId: entity.id } : {}) });
              triggerAlarmsNear(node.id);
            }
          } else if (node.type === "core" && state.coreHp > 0) {
            const newHp = Math.max(0, state.coreHp - damage);
            const drained = state.coreHp - newHp;
            state.coreHp = newHp;
            if (drained > 0) {
              events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained, ...(canSplit ? { entityId: entity.id } : {}) });
            }
          }
        }
        w.firedRuleIds.add(plan.detonate.ruleId);
        const dealt = damageVirus(entity, entity.integrity);
        if (dealt > 0) {
          events.push({ tick, type: "virus-damaged", actor: "detonate", target: "virus", delta: -dealt, ...(canSplit ? { entityId: entity.id } : {}) });
        }
        entity.noRespawn = true;
        continue;
      }

      w.bruteForceDamage = plan.bruteForce.reduce((sum, contribution) => sum + contribution.amount, 0);
      w.exploitDamage = entity.freshArrival ? plan.exploit.reduce((sum, contribution) => sum + contribution.amount, 0) : 0;
      const bruteForceDamage = w.bruteForceDamage;
      const exploitDamage = w.exploitDamage;

      const creditAttack = (dealt: number): void => {
        if (dealt <= 0) {
          return;
        }
        for (const contribution of plan.bruteForce) {
          w.firedRuleIds.add(contribution.ruleId);
        }
        if (exploitDamage > 0) {
          for (const contribution of plan.exploit) {
            w.firedRuleIds.add(contribution.ruleId);
          }
        }
      };

      const applyOverloadSplash = (destroyedNodeId: number): void => {
        for (const contribution of plan.overload) {
          for (const node of graph.nodes) {
            if (node.id === destroyedNodeId || (node.type !== "firewall" && node.type !== "core")) {
              continue;
            }
            const distance = hopDistance(graph, destroyedNodeId, node.id);
            if (distance === null || distance > contribution.radiusHops) {
              continue;
            }
            if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
              const currentHp = state.firewallHp.get(node.id) ?? firewallMaxHpV2(requireTier(node));
              const newHp = Math.max(0, currentHp - contribution.splashDamage);
              state.firewallHp.set(node.id, newHp);
              events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - newHp), ...(canSplit ? { entityId: entity.id } : {}) });
              w.firedRuleIds.add(contribution.ruleId);
              if (newHp <= 0) {
                state.destroyedFirewallIds.add(node.id);
                state.firewallsDestroyed += 1;
                events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id), ...(canSplit ? { entityId: entity.id } : {}) });
                triggerAlarmsNear(node.id);
              }
            } else if (node.type === "core" && state.coreHp > 0) {
              const newHp = Math.max(0, state.coreHp - contribution.splashDamage);
              const drained = state.coreHp - newHp;
              state.coreHp = newHp;
              if (drained > 0) {
                events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained, ...(canSplit ? { entityId: entity.id } : {}) });
                w.firedRuleIds.add(contribution.ruleId);
              }
            }
          }
        }
      };

      if (entity.location.kind === "node") {
        const node = findNode(graph, entity.location.nodeId);
        if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
          const tier = requireTier(node);
          const currentHp = state.firewallHp.get(node.id) ?? firewallMaxHpV2(tier);
          const passive = resolveFirewallTickV2(currentHp, tier);
          const newHp = Math.max(0, passive.remainingHp - bruteForceDamage - exploitDamage);
          state.firewallHp.set(node.id, newHp);
          events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - newHp), ...(canSplit ? { entityId: entity.id } : {}) });
          creditAttack(bruteForceDamage + exploitDamage);
          const dealt = damageVirus(entity, passive.counterDamageToVirus);
          if (dealt > 0) {
            events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt, ...(canSplit ? { entityId: entity.id } : {}) });
          }
          if (newHp <= 0) {
            state.destroyedFirewallIds.add(node.id);
            state.firewallsDestroyed += 1;
            events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id), ...(canSplit ? { entityId: entity.id } : {}) });
            applyOverloadSplash(node.id);
            triggerAlarmsNear(node.id);
          }
        } else if (node.type === "core") {
          const passive = resolveCoreTickV2(state.coreHp);
          const newHp = Math.max(0, passive.remainingHp - bruteForceDamage - exploitDamage);
          const drained = state.coreHp - newHp;
          state.coreHp = newHp;
          if (drained > 0) {
            events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained, ...(canSplit ? { entityId: entity.id } : {}) });
          }
          creditAttack(bruteForceDamage + exploitDamage);
        }
      }
    }

    // --- 4b. Alarm Relay proximity trigger — any entity within radius arms it immediately, ahead
    // of the ICE loop below, so the alert (if this is the tick that raises it) already boosts this
    // tick's shots. A destroy-triggered alarm (triggerAlarmsNear above) already ran earlier in this
    // same phase, so both trigger paths take effect the tick they fire, not the next. ---
    for (const alarmNode of alarmNodes) {
      if (state.alarmTriggeredIds.has(alarmNode.id)) {
        continue;
      }
      const config = getAlarmConfigV2(requireTier(alarmNode));
      for (const w of work) {
        if (isVirusInRange(graph, alarmNode.id, config.radiusHops, w.entity.location)) {
          triggerAlarm(alarmNode);
          break;
        }
      }
    }
    const alarmActive = tick < state.alarmActiveUntilTick;

    // --- 4c. ICE Sentry fire — sentries OUTER (ascending node id), one draw per off-cooldown
    // sentry that has a valid target. Target = lowest-id living (in `work`), uncloaked, in-range
    // entity, chosen BEFORE the roll so targeting itself never consumes RNG. The ICE Nest fix
    // (RULESET.md §9/§13, HANDOFF §2a): a body can only be hit once per tick — a sentry that rolls
    // a hit against a body some earlier (lower-id) sentry already hit this tick still consumes its
    // cooldown, it just doesn't land a second hit. For exactly one entity this reduces to: every
    // off-cooldown, in-range, uncloaked sentry rolls once, only the first hit lands — identical to
    // the single-entity 8.2b behavior this replaces. ---
    const entitiesHitByIceThisTick = new Set<number>();
    for (const iceNode of iceSentryNodes) {
      if (tick < (state.iceNextFireTick.get(iceNode.id) ?? 0)) {
        continue;
      }
      const config = getIceSentryConfigV2(requireTier(iceNode));
      let targetWork: EntityTickWork | null = null;
      for (const w of work) {
        if (w.cloakActive) {
          continue;
        }
        if (!isVirusInRange(graph, iceNode.id, config.radiusHops, w.entity.location)) {
          continue;
        }
        targetWork = w;
        break;
      }
      if (!targetWork) {
        continue;
      }
      const target = targetWork.entity;
      const scannedActive = target.scannedUntilTick !== null && tick < target.scannedUntilTick;
      const baseAccuracy = config.accuracyPermille + (alarmActive ? ALARM_ICE_ACCURACY_BONUS_PERMILLE : 0);
      const accuracy = effectiveAccuracyPermilleV2(baseAccuracy, scannedActive ? target.scannedAccuracyBonusPermille : 0, targetWork.slowCrawl?.iceAccuracyReductionPermille ?? 0);
      const hit = rollIceSentryHitV2(rng, accuracy);
      const fireInterval = alarmActive ? Math.max(1, config.fireIntervalTicks - ALARM_ICE_FIRE_INTERVAL_REDUCTION_TICKS) : config.fireIntervalTicks;
      state.iceNextFireTick.set(iceNode.id, tick + fireInterval);
      if (!hit || entitiesHitByIceThisTick.has(target.id)) {
        continue;
      }
      entitiesHitByIceThisTick.add(target.id);
      if (tryAbsorbWithDecoy(target)) {
        events.push({ tick, type: "decoy-absorbed", actor: String(iceNode.id), target: "virus", ...(canSplit ? { entityId: target.id } : {}) });
      } else {
        const dealt = damageVirus(target, config.damage);
        events.push({ tick, type: "virus-damaged", actor: String(iceNode.id), target: "virus", delta: -dealt, ...(canSplit ? { entityId: target.id } : {}) });
      }
    }

    // --- 4d. Trap/Honeypot triggers, per entity ---
    for (const w of work) {
      const entity = w.entity;
      if (entity.location.kind !== "node") {
        continue;
      }
      const node = findNode(graph, entity.location.nodeId);
      if (node.type === "honeypot") {
        // v2 drops v1's automatic Detect-Honeypot immunity: the sensor is a condition now, so
        // surviving a Honeypot means the sheet routed around it (ADR 0006 §8).
        if (entity.freshArrival && !state.triggeredHoneypotIds.has(node.id)) {
          state.triggeredHoneypotIds.add(node.id);
          if (tryAbsorbWithDecoy(entity)) {
            events.push({ tick, type: "decoy-absorbed", actor: String(node.id), target: "virus", ...(canSplit ? { entityId: entity.id } : {}) });
          } else {
            entity.honeypotPendingDeathTick = tick + 1;
          }
        } else if (entity.honeypotPendingDeathTick === tick) {
          const dealt = damageVirus(entity, entity.integrity);
          entity.honeypotPendingDeathTick = null;
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt, ...(canSplit ? { entityId: entity.id } : {}) });
        }
      } else if (node.type === "trap" && entity.freshArrival && !state.spentTrapIds.has(node.id)) {
        state.spentTrapIds.add(node.id);
        if (tryAbsorbWithDecoy(entity)) {
          events.push({ tick, type: "decoy-absorbed", actor: String(node.id), target: "virus", ...(canSplit ? { entityId: entity.id } : {}) });
        } else {
          const dealt = damageVirus(entity, trapTriggerDamageV2(requireTier(node)));
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt, ...(canSplit ? { entityId: entity.id } : {}) });
        }
      }
    }

    // --- 4e. Scanner aura — sentries outer (ascending id), entities inner (ascending id) ---
    for (const scannerNode of scannerNodes) {
      const config = getScannerConfigV2(requireTier(scannerNode));
      for (const w of work) {
        if (w.cloakActive) {
          continue;
        }
        const entity = w.entity;
        if (!isVirusInRange(graph, scannerNode.id, config.radiusHops, entity.location)) {
          continue;
        }
        const statusExpired = entity.scannedUntilTick === null || tick >= entity.scannedUntilTick;
        if (statusExpired || config.iceAccuracyBonusPermille >= entity.scannedAccuracyBonusPermille) {
          entity.scannedUntilTick = tick + config.durationTicks;
          entity.scannedAccuracyBonusPermille = config.iceAccuracyBonusPermille;
          events.push({ tick, type: "status-applied", actor: String(scannerNode.id), target: "virus", ...(canSplit ? { entityId: entity.id } : {}) });
        }
      }
    }

    // --- 4f. Patch Server heal — entity-INDEPENDENT (it heals nodes, not bodies), runs LAST among
    // node effects (RULESET.md §14) so this tick's damage is still visible as its own event before
    // any of it gets healed back. Cumulative across multiple servers in range (unlike Tarpit/Alarm,
    // nothing in the table says Patch Server doesn't stack). ---
    for (const patchServerNode of patchServerNodes) {
      const config = getPatchServerConfigV2(requireTier(patchServerNode));
      for (const node of graph.nodes) {
        if (node.id === patchServerNode.id) {
          continue;
        }
        const distance = hopDistance(graph, patchServerNode.id, node.id);
        if (distance === null || distance > config.radiusHops) {
          continue;
        }
        if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
          const tier = requireTier(node);
          const maxHp = firewallMaxHpV2(tier);
          const currentHp = state.firewallHp.get(node.id) ?? maxHp;
          const healedHp = Math.min(maxHp, currentHp + config.healPerTick);
          if (healedHp > currentHp) {
            state.firewallHp.set(node.id, healedHp);
            events.push({ tick, type: "node-repaired", actor: String(patchServerNode.id), target: String(node.id), delta: healedHp - currentHp });
          }
        } else if (node.type === "core" && state.coreHp > 0) {
          const healedHp = Math.min(graph.coreHp, state.coreHp + config.healPerTick);
          if (healedHp > state.coreHp) {
            const delta = healedHp - state.coreHp;
            state.coreHp = healedHp;
            events.push({ tick, type: "node-repaired", actor: String(patchServerNode.id), target: String(node.id), delta });
          }
        }
      }
    }

    // --- 5. Utility, per entity ---
    for (const w of work) {
      const { entity, plan } = w;
      const healAmount = plan.selfRepair.reduce((sum, contribution) => sum + contribution.amount, 0);
      if (healAmount > 0 && !entity.died) {
        const before = entity.integrity;
        entity.integrity = Math.min(VIRUS_START_INTEGRITY, entity.integrity + healAmount);
        if (entity.integrity > before) {
          events.push({ tick, type: "virus-repaired", actor: "self-repair", target: "virus", delta: entity.integrity - before, ...(canSplit ? { entityId: entity.id } : {}) });
          for (const contribution of plan.selfRepair) {
            w.firedRuleIds.add(contribution.ruleId);
          }
        }
      }
      if (plan.decoy) {
        const config = getDecoyConfigV2(plan.decoy.value);
        if (entity.decoy.absorbsRemaining === 0 && entity.decoy.activationsUsed < config.chargesTotal) {
          entity.decoy.activationsUsed += 1;
          entity.decoy.absorbsRemaining = config.absorbsPerActivation;
          w.firedRuleIds.add(plan.decoy.ruleId);
          events.push({ tick, type: "status-applied", actor: "sacrifice-decoy", target: "virus", ...(canSplit ? { entityId: entity.id } : {}) });
        }
      }
      if (plan.checkpoint && !entity.died && entity.location.kind === "node") {
        const config = getCheckpointConfigV2(plan.checkpoint.value);
        entity.checkpointNodeId = entity.location.nodeId;
        entity.respawnIntegrity = config.respawnIntegrity;
        entity.respawnsTotal = config.respawnsTotal;
        w.firedRuleIds.add(plan.checkpoint.ruleId);
        events.push({ tick, type: "status-applied", actor: "set-checkpoint", target: "virus", ...(canSplit ? { entityId: entity.id } : {}) });
      }
    }

    // --- 6. Movement, per entity (ascending id) ---
    for (const w of work) {
      const { entity, plan, knownHazardNodeIds, slowCrawl } = w;
      entity.freshArrival = false;
      if (entity.location.kind === "edge") {
        if (plan.movement) {
          entity.queuedMovement = plan.movement.value;
        }
        const edge: EdgeLocation = entity.location;
        const remainingTicks = edge.remainingTicks - 1;
        if (remainingTicks > 0) {
          entity.location = { kind: "edge", from: edge.from, to: edge.to, remainingTicks };
        } else {
          entity.previousNodeId = edge.from;
          entity.arrivalCount += 1;
          entity.freshArrival = true;
          entity.location = { kind: "node", nodeId: edge.to };
          events.push({ tick, type: "virus-entered-node", actor: "virus", target: String(edge.to), ...(canSplit ? { entityId: entity.id } : {}) });
        }
      } else {
        const fromNodeId: number = entity.location.nodeId;
        const intentKind = plan.movement?.value ?? entity.queuedMovement;
        entity.queuedMovement = null;
        if (intentKind !== null && intentKind !== undefined && !isBlockingNodeV2(fromNodeId, graph, state, entity)) {
          const rawTarget = resolveMovementTarget(intentKind, fromNodeId, graph, entity, rng, knownHazardNodeIds);
          // Turnstile (RULESET.md §14): a node departed recently forbids re-entry — this is a
          // post-filter rather than an `avoid` set threaded into every movement kind, so it blocks
          // move-back/move-random/pathfinding equally instead of only the one action that names it.
          // A blocked target means the body simply doesn't move this tick.
          const target = rawTarget !== null && (state.turnstileLockouts.get(rawTarget) ?? 0) > tick ? null : rawTarget;
          if (plan.movement) {
            // Holding position is a decision the rule made, so the rule fired even when nothing moved.
            w.firedRuleIds.add(plan.movement.ruleId);
          }
          if (target !== null) {
            const baseSpeed = getActionSpec(intentKind).speedDuPerTick ?? 50;
            const tarpitMultiplier = activeTarpitMultiplierPermille(graph, fromNodeId);
            let speed = tarpitMultiplier < 1000 ? Math.max(1, applyPermille(baseSpeed, tarpitMultiplier)) : baseSpeed;
            if (slowCrawl) {
              speed = Math.max(1, applyPermille(speed, slowCrawl.speedMultiplierPermille));
            }
            events.push({ tick, type: "virus-departed-node", actor: "virus", target: String(fromNodeId), ...(canSplit ? { entityId: entity.id } : {}) });
            if (findNode(graph, fromNodeId).type === "turnstile") {
              state.turnstileLockouts.set(fromNodeId, tick + getTurnstileConfigV2(requireTier(findNode(graph, fromNodeId))).lockoutTicks);
            }
            entity.previousNodeId = fromNodeId;
            // "visited-here-before" (PLAN.md 8.4): marked on DEPARTURE, not arrival — the dwell a
            // node was first reached on must never read as a previous visit to itself.
            entity.visitedNodeIds.add(fromNodeId);
            entity.location = { kind: "edge", from: fromNodeId, to: target, remainingTicks: ticksToCrossEdge(findEdgeLength(graph, fromNodeId, target), speed) };
          }
        }
      }
    }

    // --- H. Worm Split resolution, per entity (work's own ascending-id order), AFTER movement so a
    // new body never acts on the tick it's born (RULESET.md §11a, PLAN.md 8.3c) — it joins `work`
    // for the first time next tick. New bodies get monotonically increasing ids, appended (never
    // spliced in, per 8.3a), and their own fresh physical status (no inherited cloak/scan window,
    // no inherited decoy shield): only "program memory" carries over — `firedOnceKeys` (a copy, not
    // the same Set, so each body's `once` bookkeeping is independent from here on) and
    // `decoy.activationsUsed` (so a body can't dodge its own charge limit by splitting), never
    // `decoy.absorbsRemaining` (an armed shield protects the body it's armed on). The split entity's
    // own Integrity is reduced to the same share the new body gets — "masing-masing", not "the
    // leftover after the new body's cut".
    for (const w of work) {
      const { entity, plan } = w;
      if (!plan.split || entity.died) {
        continue;
      }
      const config = getWormSplitConfigV2(plan.split.value);
      if (entity.integrity < WORM_SPLIT_MIN_INTEGRITY_V2 || livingEntities().length >= config.maxLivingEntities) {
        continue;
      }
      const sharedIntegrity = applyPermille(entity.integrity, config.integritySharePermille);
      entity.integrity = sharedIntegrity;
      const clone: VirusEntity = {
        id: nextEntityId,
        location: entity.location,
        integrity: sharedIntegrity,
        died: false,
        damageTakenThisTick: 0,
        damageTakenLastTick: 0,
        cloakUntilTick: 0,
        cloakReadyAtTick: 0,
        decoy: { activationsUsed: entity.decoy.activationsUsed, absorbsRemaining: 0 },
        firedOnceKeys: new Set(entity.firedOnceKeys),
        arrivalCount: 0,
        previousNodeId: null,
        freshArrival: true,
        queuedMovement: null,
        triedEdgesFromNode: new Map(),
        scannedUntilTick: null,
        scannedAccuracyBonusPermille: 0,
        honeypotPendingDeathTick: null,
        noRespawn: false,
        // A checkpoint is a place THIS body marked, not program memory — a fresh body hasn't
        // marked anything itself, so it starts with none (same "physical, not carried over" bucket
        // as cloak/scan status above), even if the parent had one armed.
        checkpointNodeId: null,
        respawnIntegrity: 0,
        respawnsTotal: 0,
        respawnsUsed: 0,
        flags: [...entity.flags],
        visitedNodeIds: new Set(entity.visitedNodeIds),
      };
      state.entities.push(clone);
      w.firedRuleIds.add(plan.split.ruleId);
      // `delta` here is the resulting Integrity itself (both bodies land on the same number,
      // "masing-masing"), not an amount lost — the same absolute-value convention `virus-respawned`
      // uses (PLAN.md 8.3d), so a replay compiler can read one body's post-split Integrity off this
      // single event instead of needing to notice a `virus-damaged` that was never logged.
      events.push({ tick, type: "virus-split", actor: String(entity.id), target: String(clone.id), delta: sharedIntegrity, ...(canSplit ? { entityId: entity.id } : {}) });
      nextEntityId += 1;
    }

    // --- I. Checkpoint respawn, per entity (work's own ascending-id order) — PLAN.md 8.3d. Consumes
    // `died` as its trigger rather than avoiding it: a body reaching here IS dead (checked live —
    // deliberately the one phase allowed to react to a death from anywhere earlier THIS tick), and
    // respawning is the explicit transition out of that, never a silent bypass of the death latch
    // above. RULESET.md §13's invariant: Integrity only ever rises from 0 via the `virus-died` →
    // `virus-respawned` → `virus-entered-node` triple below — no other code path may do it. A body
    // that dies without an armed checkpoint, with `noRespawn` set (`detonate`, PLAN.md 8.3c), or out
    // of respawns stays dead here exactly as it did before this phase existed. ---
    for (const w of work) {
      const { entity } = w;
      if (!entity.died || entity.noRespawn || entity.checkpointNodeId === null || entity.respawnsUsed >= entity.respawnsTotal) {
        continue;
      }
      events.push({ tick, type: "virus-died", actor: "virus", ...(canSplit ? { entityId: entity.id } : {}) });
      const respawnNodeId = entity.checkpointNodeId;
      entity.died = false;
      entity.integrity = entity.respawnIntegrity;
      entity.location = { kind: "node", nodeId: respawnNodeId };
      entity.respawnsUsed += 1;
      entity.freshArrival = true;
      entity.previousNodeId = null;
      entity.queuedMovement = null;
      entity.checkpointNodeId = null; // Consumed — another set-checkpoint is needed to arm a next one.
      events.push({ tick, type: "virus-respawned", actor: "virus", target: String(respawnNodeId), delta: entity.integrity, ...(canSplit ? { entityId: entity.id } : {}) });
      events.push({ tick, type: "virus-entered-node", actor: "virus", target: String(respawnNodeId), ...(canSplit ? { entityId: entity.id } : {}) });
    }

    // --- 7. rule-fired (entity ascending id, then that entity's own fired rule ids sorted), then win/loss ---
    for (const w of work) {
      for (const ruleId of [...w.firedRuleIds].sort()) {
        events.push({ tick, type: "rule-fired", actor: ruleId, ...(canSplit ? { entityId: w.entity.id } : {}) });
      }
    }

    const outcome = finalize(tick);
    if (outcome) {
      return outcome;
    }
  }

  events.push({ tick: BATTLE_TICK_LIMIT, type: "battle-timeout", actor: "core" });
  return {
    input,
    events,
    result: {
      winner: "defender",
      score: computeScore("defender", {
        integrityRatioPermille: bestLivingIntegrityPermille(),
        coreRatioPermille: Math.floor((state.coreHp * 1000) / graph.coreHp),
        nodesDestroyed: state.firewallsDestroyed,
        ticksElapsed: BATTLE_TICK_LIMIT,
      }),
    },
  };
}
