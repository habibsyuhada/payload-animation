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
  getCloakConfigV2,
  getConditionRadiusHops,
  getConditionSpec,
  getDecoyConfigV2,
  getExploitDamageV2,
  getOverloadConfigV2,
  getSelfRepairHealPerTickV2,
  getSlowCrawlConfigV2,
} from "./ruleset-v2.js";
import { walkSheet } from "./sheet.js";
import type { ActionKind, BattleEvent, BattleInputV2, BattleLog, BlockTier, DefenseGraph, DefenseNode, SheetAction, SheetCondition, SheetEvent } from "./types.js";

/**
 * Ruleset v2 engine — the virus as a nested event sheet (docs/ADR/0006).
 *
 * The v1 engine in engine.ts is untouched and stays the specification of every log that says
 * "v1"; this is a second, parallel interpreter that `simulate()` dispatches to. What changed is
 * not the physics but *who decides*: in v1 a fixed movement block plus a chain of blocks gated by
 * array position, in v2 an ordered tree of rules evaluated fresh every tick.
 *
 * ### Tick order (RULESET.md v2 §11)
 *
 * 1. **Sensor sweep** — the hazards the sheet's sensor conditions can see this tick. A Jammer in
 *    range (RULESET.md §14) makes this see nothing, sheet-side, regardless of what's actually
 *    near — checked once, ahead of the sweep, so it can't half-apply within a tick.
 * 2. **Sheet evaluation** — depth-first, top to bottom, producing a plan of intents. Never
 *    consumes RNG (ADR 0006 §2), so reading the sheet can't change the dice.
 * 3. **Statuses** — Cloak / Slow Crawl take effect *before* anything shoots, so a rule that
 *    cloaks in reaction to being scanned is protected on the same tick it fires.
 * 4. **Node effects** — the virus's Attack actions against the Breach Node it occupies, the
 *    node's counter-damage (destroying a Breach Node can arm an Alarm Relay in range) → Alarm
 *    Relay proximity trigger → ICE Sentry fire (boosted while an alert is active) → Trap/Honeypot
 *    triggers → Scanner aura → Patch Server heal, LAST, so this tick's damage is still visible
 *    before any of it gets healed back.
 * 5. **Utility** — Self Repair, decoy arming.
 * 6. **Movement** — the winning movement intent is consumed here, at the END of the tick, so a
 *    virus that arrives somewhere always gets one full tick of acting there before it can leave.
 *    This is the same net behaviour as v1's move-then-resolve, expressed the way the sheet reads.
 *    Tarpit and Turnstile apply here: speed is reduced by the strongest Tarpit in range, and a
 *    node the virus departed under a live Turnstile lockout can't be re-entered.
 * 7. **`rule-fired`** for every rule whose actions actually did something, then win/loss.
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

/** One tick's worth of decided-but-not-yet-applied intent. */
interface TickPlan {
  movement: SlotWrite<MovementActionKind> | null;
  cloak: SlotWrite<BlockTier> | null;
  slowCrawl: SlotWrite<BlockTier> | null;
  decoy: SlotWrite<BlockTier> | null;
  readonly bruteForce: Contribution[];
  readonly exploit: Contribution[];
  readonly overload: OverloadContribution[];
  readonly selfRepair: Contribution[];
  actionsRun: number;
}

function emptyPlan(): TickPlan {
  return { movement: null, cloak: null, slowCrawl: null, decoy: null, bruteForce: [], exploit: [], overload: [], selfRepair: [], actionsRun: 0 };
}

interface DecoyState {
  activationsUsed: number;
  absorbsRemaining: number;
}

interface BattleStateV2 {
  virusIntegrity: number;
  coreHp: number;
  readonly firewallHp: Map<number, number>;
  readonly destroyedFirewallIds: Set<number>;
  readonly spentTrapIds: Set<number>;
  readonly triggeredHoneypotIds: Set<number>;
  honeypotPendingDeathTick: number | null;
  scannedUntilTick: number | null;
  scannedAccuracyBonusPermille: number;
  readonly iceNextFireTick: Map<number, number>;
  firewallsDestroyed: number;
  damageTakenThisTick: number;
  damageTakenLastTick: number;
  /**
   * Latched the moment Integrity reaches 0. The death check only runs at the end of a tick, and
   * Self Repair is no longer gated on "took no damage this tick" (ADR 0006 §8) — without this
   * latch a repair later in the same tick would quietly resurrect a virus that was already dead,
   * which no rule in RULESET §7/§11 allows. v1 never needed it because its hardcoded gate made
   * the case unreachable.
   */
  died: boolean;
  cloakUntilTick: number;
  cloakReadyAtTick: number;
  readonly decoy: DecoyState;
  /** Once-scope bookkeeping, one generic set instead of v1's per-block special cases (ADR 0006 §4). */
  readonly firedOnceKeys: Set<string>;
  arrivalCount: number;
  previousNodeId: number | null;
  /** True on the first tick the virus stands on the node it just reached — Exploit's window. */
  freshArrival: boolean;
  /** ADR 0006 open question 1, resolved: an intent written mid-transit is kept (last one wins) and
   * applied on arrival only if the sheet writes nothing on the arrival tick itself. */
  queuedMovement: MovementActionKind | null;
  readonly triedEdgesFromNode: Map<number, Set<number>>;
  /** Turnstile (RULESET.md §14): node id -> the tick before which re-entering it is forbidden.
   * Keyed by node, not edge, so it blocks every movement kind equally, not just move-back. */
  readonly turnstileLockouts: Map<number, number>;
  /** Alarm Relay (RULESET.md §14): each relay is a one-shot trigger (like Honeypot/Trap), but the
   * alert it raises is one shared window — a second relay firing while one is already active
   * extends to the longer remaining duration rather than stacking a second window on top. */
  readonly alarmTriggeredIds: Set<number>;
  alarmActiveUntilTick: number;
}

/* --- Conditions ------------------------------------------------------------------------- */

interface ConditionContextV2 {
  readonly graph: DefenseGraph;
  readonly state: BattleStateV2;
  readonly location: VirusLocation;
  readonly tick: number;
}

/**
 * "node di depan" (ADR 0006 open question 2, resolved): the node the virus is heading for. In
 * transit that is unambiguous — it's the edge's far end. Standing on a node it is the next hop of
 * the DU-shortest path to Core, i.e. where the virus goes if nothing intervenes. Computing it from
 * the graph rather than from the movement intent keeps conditions readable in isolation and keeps
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

/** Jammer nodes (RULESET.md §14) currently within range of the virus — a pure function of graph
 * position, unlike every other status here, so it needs no BattleStateV2 bookkeeping at all. */
function activeJammerNodes(ctx: Pick<ConditionContextV2, "graph" | "location">): DefenseNode[] {
  return ctx.graph.nodes.filter((node) => node.type === "jammer" && isVirusInRange(ctx.graph, node.id, getJammerConfigV2(requireTier(node)).radiusHops, ctx.location));
}

function isJammed(ctx: Pick<ConditionContextV2, "graph" | "location">): boolean {
  return activeJammerNodes(ctx).length > 0;
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

function sensedHazardNodeIds(condition: SheetCondition, ctx: Pick<ConditionContextV2, "graph" | "state" | "location">): number[] {
  // A Jammer in range makes every sensor condition read false (ADR 0006 §8-adjacent: this is a
  // visible, explainable blind spot, not hidden RNG — the `jammed` condition, 8.4, tells the sheet
  // why). Gating here covers BOTH callers at once: the sensor sweep (phase 1) and
  // evaluateConditionPositively's "honeypot-near"/"trap-near" case route through this function.
  if (isJammed(ctx)) {
    return [];
  }
  const tier = condition.tier ?? 1;
  const spec = getConditionSpec(condition.kind);
  const radiusHops = getConditionRadiusHops(condition.kind, tier);
  const found: number[] = [];
  for (const node of ctx.graph.nodes) {
    if (!isVirusInRange(ctx.graph, node.id, radiusHops, ctx.location)) {
      continue;
    }
    if (condition.kind === "honeypot-near" && node.type === "honeypot" && !ctx.state.triggeredHoneypotIds.has(node.id) && honeypotIsVisible(requireTier(node), tier, spec.seesDisguiseFromTier)) {
      found.push(node.id);
    } else if (condition.kind === "trap-near" && node.type === "trap" && !ctx.state.spentTrapIds.has(node.id)) {
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
  switch (condition.kind) {
    case "node-here-is": {
      const here = currentNodeId(ctx.location);
      return here !== null && targets.includes(findNode(ctx.graph, here).type);
    }
    case "node-ahead-is": {
      // Tier III Jammer also falsifies this one (RULESET.md §14) — seeing round a corner is
      // exactly what Scan Ahead used to sell, and a strong-enough Jammer un-sells it.
      if (activeJammerNodes(ctx).some((node) => getJammerConfigV2(requireTier(node)).jamsNodeAhead)) {
        return false;
      }
      const ahead = nodeAheadId(ctx.graph, ctx.location);
      return ahead !== null && targets.includes(findNode(ctx.graph, ahead).type);
    }
    case "honeypot-near":
    case "trap-near":
      return sensedHazardNodeIds(condition, ctx).length > 0;
    case "integrity-below":
      return ctx.state.virusIntegrity < (condition.integrityThresholdPermille ?? DEFAULT_INTEGRITY_THRESHOLD_PERMILLE_V2);
    case "is-scanned":
      return ctx.state.scannedUntilTick !== null && ctx.tick < ctx.state.scannedUntilTick;
    case "took-damage-last-tick":
      return ctx.state.damageTakenLastTick > 0;
    case "on-breach-node": {
      const here = currentNodeId(ctx.location);
      return here !== null && isBreachNode(ctx.graph, ctx.state, here);
    }
    case "at-node":
      return ctx.location.kind === "node";
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
    return `${ruleId}@a${ctx.state.arrivalCount}`;
  }
  const location = ctx.location;
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
 * Walks the sheet once, depth-first, top to bottom. A parent whose conditions fail skips its
 * actions *and* its whole subtree — that is what nesting means here. `once` is consumed the moment
 * a row runs, not when its effects land, so a spent one-shot can't quietly re-arm itself.
 */
function evaluateSheet(events: readonly SheetEvent[], ctx: ConditionContextV2, plan: TickPlan, prefix = ""): void {
  events.forEach((event, index) => {
    const path = prefix === "" ? String(index) : `${prefix}.${index}`;
    const ruleId = event.id ?? path;
    if (event.once !== undefined && ctx.state.firedOnceKeys.has(onceKey(ruleId, event.once, ctx))) {
      return;
    }
    if (!event.conditions.every((condition) => evaluateCondition(condition, ctx))) {
      return;
    }
    if (event.once !== undefined) {
      ctx.state.firedOnceKeys.add(onceKey(ruleId, event.once, ctx));
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

function resolveMovementTarget(kind: MovementActionKind, fromNodeId: number, graph: DefenseGraph, state: BattleStateV2, rng: Rng, knownHazardNodeIds: ReadonlySet<number>): number | null {
  if (kind === "hold-position") {
    return null;
  }
  if (kind === "move-back") {
    const previous = state.previousNodeId;
    return previous !== null && previous !== fromNodeId && neighborsOf(graph, fromNodeId).includes(previous) ? previous : null;
  }
  if (kind === "move-random") {
    const neighbors = neighborsOf(graph, fromNodeId);
    if (neighbors.length === 0) {
      return null;
    }
    let tried = state.triedEdgesFromNode.get(fromNodeId);
    if (!tried) {
      tried = new Set<number>();
      state.triedEdgesFromNode.set(fromNodeId, tried);
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

/** A virus standing on an intact Firewall/Core is pinned there; a sprung Honeypot holds it for the tick it kills. */
function isBlockingNodeV2(nodeId: number, graph: DefenseGraph, state: BattleStateV2): boolean {
  const node = findNode(graph, nodeId);
  if (node.type === "firewall") {
    return !state.destroyedFirewallIds.has(nodeId);
  }
  if (node.type === "core") {
    return state.coreHp > 0;
  }
  if (node.type === "honeypot") {
    return state.honeypotPendingDeathTick !== null;
  }
  return false;
}

/* --- The battle -------------------------------------------------------------------------- */

export function simulateV2(input: BattleInputV2): BattleLog {
  const graph = input.defense;
  const coreNode = findNode(graph, graph.coreNodeId);
  if (coreNode.type !== "core") {
    throw new Error("simulate(): defense graph has no valid core node — validate before simulating");
  }

  const rng = createRng(input.seed);
  const events: BattleEvent[] = [];
  const state: BattleStateV2 = {
    virusIntegrity: VIRUS_START_INTEGRITY,
    coreHp: graph.coreHp,
    firewallHp: new Map(),
    destroyedFirewallIds: new Set(),
    spentTrapIds: new Set(),
    triggeredHoneypotIds: new Set(),
    honeypotPendingDeathTick: null,
    scannedUntilTick: null,
    scannedAccuracyBonusPermille: 0,
    iceNextFireTick: new Map(),
    firewallsDestroyed: 0,
    damageTakenThisTick: 0,
    damageTakenLastTick: 0,
    died: false,
    cloakUntilTick: 0,
    cloakReadyAtTick: 0,
    decoy: { activationsUsed: 0, absorbsRemaining: 0 },
    firedOnceKeys: new Set(),
    arrivalCount: 0,
    previousNodeId: null,
    freshArrival: true,
    queuedMovement: null,
    triedEdgesFromNode: new Map(),
    turnstileLockouts: new Map(),
    alarmTriggeredIds: new Set(),
    alarmActiveUntilTick: 0,
  };

  const iceSentryNodes = graph.nodes.filter((node) => node.type === "ice-sentry").sort((a, b) => a.id - b.id);
  const scannerNodes = graph.nodes.filter((node) => node.type === "scanner").sort((a, b) => a.id - b.id);
  const patchServerNodes = graph.nodes.filter((node) => node.type === "patch-server").sort((a, b) => a.id - b.id);
  const alarmNodes = graph.nodes.filter((node) => node.type === "alarm").sort((a, b) => a.id - b.id);

  /** Sensor conditions the sheet actually contains, so the hazard sweep costs nothing for a sheet that never asks. */
  const sensorConditions = walkSheet(input.virus.events)
    .flatMap((visit) => visit.event.conditions)
    .filter((condition) => condition.kind === "honeypot-near" || condition.kind === "trap-near");

  const entryIndex = rng.nextInt(graph.entryNodeIds.length);
  let location: VirusLocation = { kind: "node", nodeId: graph.entryNodeIds[entryIndex]! };
  events.push({ tick: 0, type: "virus-entered-node", actor: "virus", target: String(location.nodeId) });

  function damageVirus(amount: number): number {
    const before = state.virusIntegrity;
    state.virusIntegrity = Math.max(0, state.virusIntegrity - amount);
    const dealt = before - state.virusIntegrity;
    state.damageTakenThisTick += dealt;
    if (state.virusIntegrity <= 0) {
      state.died = true;
    }
    return dealt;
  }

  /** Firewall counter-damage is never absorbable — same carve-out v1 makes (RULESET.md §4.2). */
  function tryAbsorbWithDecoy(): boolean {
    if (state.decoy.absorbsRemaining > 0) {
      state.decoy.absorbsRemaining -= 1;
      return true;
    }
    return false;
  }

  function finalize(tick: number): BattleLog | null {
    if (state.coreHp <= 0) {
      events.push({ tick, type: "battle-won", actor: "virus" });
      return {
        input,
        events,
        result: {
          winner: "attacker",
          score: computeScore("attacker", { integrityRatioPermille: state.virusIntegrity, coreRatioPermille: 0, nodesDestroyed: state.firewallsDestroyed, ticksElapsed: tick }),
        },
      };
    }
    if (state.died || state.virusIntegrity <= 0) {
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
    state.damageTakenLastTick = state.damageTakenThisTick;
    state.damageTakenThisTick = 0;
    const firedRuleIds = new Set<string>();

    // --- 1. Sensor sweep ---
    const knownHazardNodeIds = new Set<number>();
    for (const condition of sensorConditions) {
      for (const nodeId of sensedHazardNodeIds(condition, { graph, state, location })) {
        knownHazardNodeIds.add(nodeId);
      }
    }

    // --- 2. Sheet evaluation ---
    const plan = emptyPlan();
    const ctx: ConditionContextV2 = { graph, state, location, tick };
    evaluateSheet(input.virus.events, ctx, plan);

    // --- 3. Statuses ---
    if (plan.cloak && tick >= state.cloakReadyAtTick && tick >= state.cloakUntilTick) {
      const config = getCloakConfigV2(plan.cloak.value);
      state.cloakUntilTick = tick + config.durationTicks;
      // Cooldown runs from expiry, so `[always] -> Cloak` buys a window, never permanent invisibility.
      state.cloakReadyAtTick = state.cloakUntilTick + config.cooldownTicks;
      firedRuleIds.add(plan.cloak.ruleId);
      events.push({ tick, type: "status-applied", actor: "cloak", target: "virus" });
    }
    const cloakActive = tick < state.cloakUntilTick;
    const slowCrawl = plan.slowCrawl ? getSlowCrawlConfigV2(plan.slowCrawl.value) : null;
    if (plan.slowCrawl && slowCrawl) {
      firedRuleIds.add(plan.slowCrawl.ruleId);
    }

    // --- 4. Node effects ---
    const bruteForceDamage = plan.bruteForce.reduce((sum, contribution) => sum + contribution.amount, 0);
    const exploitDamage = state.freshArrival ? plan.exploit.reduce((sum, contribution) => sum + contribution.amount, 0) : 0;

    const creditAttack = (dealt: number): void => {
      if (dealt <= 0) {
        return;
      }
      for (const contribution of plan.bruteForce) {
        firedRuleIds.add(contribution.ruleId);
      }
      if (exploitDamage > 0) {
        for (const contribution of plan.exploit) {
          firedRuleIds.add(contribution.ruleId);
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
            events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - newHp) });
            firedRuleIds.add(contribution.ruleId);
            if (newHp <= 0) {
              state.destroyedFirewallIds.add(node.id);
              state.firewallsDestroyed += 1;
              events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id) });
              triggerAlarmsNear(node.id);
            }
          } else if (node.type === "core" && state.coreHp > 0) {
            const newHp = Math.max(0, state.coreHp - contribution.splashDamage);
            const drained = state.coreHp - newHp;
            state.coreHp = newHp;
            if (drained > 0) {
              events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained });
              firedRuleIds.add(contribution.ruleId);
            }
          }
        }
      }
    };

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

    if (location.kind === "node") {
      const node = findNode(graph, location.nodeId);
      if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
        const tier = requireTier(node);
        const currentHp = state.firewallHp.get(node.id) ?? firewallMaxHpV2(tier);
        const passive = resolveFirewallTickV2(currentHp, tier);
        const newHp = Math.max(0, passive.remainingHp - bruteForceDamage - exploitDamage);
        state.firewallHp.set(node.id, newHp);
        events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - newHp) });
        creditAttack(bruteForceDamage + exploitDamage);
        const dealt = damageVirus(passive.counterDamageToVirus);
        if (dealt > 0) {
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
        if (newHp <= 0) {
          state.destroyedFirewallIds.add(node.id);
          state.firewallsDestroyed += 1;
          events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id) });
          applyOverloadSplash(node.id);
          triggerAlarmsNear(node.id);
        }
      } else if (node.type === "core") {
        const passive = resolveCoreTickV2(state.coreHp);
        const newHp = Math.max(0, passive.remainingHp - bruteForceDamage - exploitDamage);
        const drained = state.coreHp - newHp;
        state.coreHp = newHp;
        if (drained > 0) {
          events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained });
        }
        creditAttack(bruteForceDamage + exploitDamage);
      }
    }

    // Alarm Relay proximity trigger — a virus that comes within radius arms the relay immediately,
    // ahead of the ICE loop below, so the alert (if this is the tick that raises it) already
    // boosts this tick's shots. A destroy-triggered alarm (triggerAlarmsNear above) already ran
    // earlier in this same phase, so both trigger paths take effect the tick they fire, not the next.
    for (const alarmNode of alarmNodes) {
      if (state.alarmTriggeredIds.has(alarmNode.id)) {
        continue;
      }
      const config = getAlarmConfigV2(requireTier(alarmNode));
      if (isVirusInRange(graph, alarmNode.id, config.radiusHops, location)) {
        triggerAlarm(alarmNode);
      }
    }
    const alarmActive = tick < state.alarmActiveUntilTick;

    for (const iceNode of iceSentryNodes) {
      if (cloakActive) {
        continue;
      }
      const config = getIceSentryConfigV2(requireTier(iceNode));
      if (!isVirusInRange(graph, iceNode.id, config.radiusHops, location)) {
        continue;
      }
      if (tick < (state.iceNextFireTick.get(iceNode.id) ?? 0)) {
        continue;
      }
      const scannedActive = state.scannedUntilTick !== null && tick < state.scannedUntilTick;
      const baseAccuracy = config.accuracyPermille + (alarmActive ? ALARM_ICE_ACCURACY_BONUS_PERMILLE : 0);
      const accuracy = effectiveAccuracyPermilleV2(baseAccuracy, scannedActive ? state.scannedAccuracyBonusPermille : 0, slowCrawl?.iceAccuracyReductionPermille ?? 0);
      const hit = rollIceSentryHitV2(rng, accuracy);
      const fireInterval = alarmActive ? Math.max(1, config.fireIntervalTicks - ALARM_ICE_FIRE_INTERVAL_REDUCTION_TICKS) : config.fireIntervalTicks;
      state.iceNextFireTick.set(iceNode.id, tick + fireInterval);
      if (!hit) {
        continue;
      }
      if (tryAbsorbWithDecoy()) {
        events.push({ tick, type: "decoy-absorbed", actor: String(iceNode.id), target: "virus" });
      } else {
        const dealt = damageVirus(config.damage);
        events.push({ tick, type: "virus-damaged", actor: String(iceNode.id), target: "virus", delta: -dealt });
      }
    }

    if (location.kind === "node") {
      const node = findNode(graph, location.nodeId);
      if (node.type === "honeypot") {
        // v2 drops v1's automatic Detect-Honeypot immunity: the sensor is a condition now, so
        // surviving a Honeypot means the sheet routed around it (ADR 0006 §8).
        if (state.freshArrival && !state.triggeredHoneypotIds.has(node.id)) {
          state.triggeredHoneypotIds.add(node.id);
          if (tryAbsorbWithDecoy()) {
            events.push({ tick, type: "decoy-absorbed", actor: String(node.id), target: "virus" });
          } else {
            state.honeypotPendingDeathTick = tick + 1;
          }
        } else if (state.honeypotPendingDeathTick === tick) {
          const dealt = damageVirus(state.virusIntegrity);
          state.honeypotPendingDeathTick = null;
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
      } else if (node.type === "trap" && state.freshArrival && !state.spentTrapIds.has(node.id)) {
        state.spentTrapIds.add(node.id);
        if (tryAbsorbWithDecoy()) {
          events.push({ tick, type: "decoy-absorbed", actor: String(node.id), target: "virus" });
        } else {
          const dealt = damageVirus(trapTriggerDamageV2(requireTier(node)));
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
      }
    }

    for (const scannerNode of scannerNodes) {
      if (cloakActive) {
        continue;
      }
      const config = getScannerConfigV2(requireTier(scannerNode));
      if (!isVirusInRange(graph, scannerNode.id, config.radiusHops, location)) {
        continue;
      }
      const statusExpired = state.scannedUntilTick === null || tick >= state.scannedUntilTick;
      if (statusExpired || config.iceAccuracyBonusPermille >= state.scannedAccuracyBonusPermille) {
        state.scannedUntilTick = tick + config.durationTicks;
        state.scannedAccuracyBonusPermille = config.iceAccuracyBonusPermille;
        events.push({ tick, type: "status-applied", actor: String(scannerNode.id), target: "virus" });
      }
    }

    // Patch Server heal — runs LAST among node effects (RULESET.md §14) so this tick's damage is
    // still visible as its own event before any of it gets healed back, rather than the two
    // deltas silently cancelling before either is logged. Cumulative across multiple servers in
    // range (unlike Tarpit/Alarm, nothing in the table says Patch Server doesn't stack).
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

    // --- 5. Utility ---
    const healAmount = plan.selfRepair.reduce((sum, contribution) => sum + contribution.amount, 0);
    if (healAmount > 0 && !state.died) {
      const before = state.virusIntegrity;
      state.virusIntegrity = Math.min(VIRUS_START_INTEGRITY, state.virusIntegrity + healAmount);
      if (state.virusIntegrity > before) {
        events.push({ tick, type: "virus-repaired", actor: "self-repair", target: "virus", delta: state.virusIntegrity - before });
        for (const contribution of plan.selfRepair) {
          firedRuleIds.add(contribution.ruleId);
        }
      }
    }
    if (plan.decoy) {
      const config = getDecoyConfigV2(plan.decoy.value);
      if (state.decoy.absorbsRemaining === 0 && state.decoy.activationsUsed < config.chargesTotal) {
        state.decoy.activationsUsed += 1;
        state.decoy.absorbsRemaining = config.absorbsPerActivation;
        firedRuleIds.add(plan.decoy.ruleId);
        events.push({ tick, type: "status-applied", actor: "sacrifice-decoy", target: "virus" });
      }
    }

    // --- 6. Movement ---
    state.freshArrival = false;
    if (location.kind === "edge") {
      if (plan.movement) {
        state.queuedMovement = plan.movement.value;
      }
      const edge: EdgeLocation = location;
      const remainingTicks = edge.remainingTicks - 1;
      if (remainingTicks > 0) {
        location = { kind: "edge", from: edge.from, to: edge.to, remainingTicks };
      } else {
        state.previousNodeId = edge.from;
        state.arrivalCount += 1;
        state.freshArrival = true;
        location = { kind: "node", nodeId: edge.to };
        events.push({ tick, type: "virus-entered-node", actor: "virus", target: String(edge.to) });
      }
    } else {
      const fromNodeId: number = location.nodeId;
      const intentKind = plan.movement?.value ?? state.queuedMovement;
      state.queuedMovement = null;
      if (intentKind !== null && intentKind !== undefined && !isBlockingNodeV2(fromNodeId, graph, state)) {
        const rawTarget = resolveMovementTarget(intentKind, fromNodeId, graph, state, rng, knownHazardNodeIds);
        // Turnstile (RULESET.md §14): a node the virus departed recently forbids re-entry — this
        // is a post-filter rather than an `avoid` set threaded into every movement kind, so it
        // blocks move-back/move-random/pathfinding equally instead of only the one action that
        // names it. A blocked target means the virus simply doesn't move this tick.
        const target = rawTarget !== null && (state.turnstileLockouts.get(rawTarget) ?? 0) > tick ? null : rawTarget;
        if (plan.movement) {
          // Holding position is a decision the rule made, so the rule fired even when nothing moved.
          firedRuleIds.add(plan.movement.ruleId);
        }
        if (target !== null) {
          const baseSpeed = getActionSpec(intentKind).speedDuPerTick ?? 50;
          const tarpitMultiplier = activeTarpitMultiplierPermille(graph, fromNodeId);
          let speed = tarpitMultiplier < 1000 ? Math.max(1, applyPermille(baseSpeed, tarpitMultiplier)) : baseSpeed;
          if (slowCrawl) {
            speed = Math.max(1, applyPermille(speed, slowCrawl.speedMultiplierPermille));
          }
          events.push({ tick, type: "virus-departed-node", actor: "virus", target: String(fromNodeId) });
          if (findNode(graph, fromNodeId).type === "turnstile") {
            state.turnstileLockouts.set(fromNodeId, tick + getTurnstileConfigV2(requireTier(findNode(graph, fromNodeId))).lockoutTicks);
          }
          state.previousNodeId = fromNodeId;
          location = { kind: "edge", from: fromNodeId, to: target, remainingTicks: ticksToCrossEdge(findEdgeLength(graph, fromNodeId, target), speed) };
        }
      }
    }

    // --- 7. rule-fired, then the win/loss check ---
    for (const ruleId of [...firedRuleIds].sort()) {
      events.push({ tick, type: "rule-fired", actor: ruleId });
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
        integrityRatioPermille: state.virusIntegrity,
        coreRatioPermille: Math.floor((state.coreHp * 1000) / graph.coreHp),
        nodesDestroyed: state.firewallsDestroyed,
        ticksElapsed: BATTLE_TICK_LIMIT,
      }),
    },
  };
}
