import {
  evaluateIfIntegrityBelow,
  evaluateIfNodeType,
  evaluateIfScanned,
  getBruteForceDamagePerTick,
  getCloakDurationNodes,
  getDetectHoneypotConfig,
  getExploitDamage,
  getOverloadConfig,
  getSacrificeDecoyConfig,
  getScanAheadConfig,
  getSelfRepairHealPerTick,
  getSlowCrawlConfig,
  nextSacrificeDecoyThreshold,
  shouldArmSacrificeDecoy,
} from "./blocks/index.js";
import { BATTLE_TICK_LIMIT, ticksToCrossEdge } from "./fixed.js";
import { hopDistance } from "./graph.js";
import { MOVEMENT_ALGORITHMS } from "./movement.js";
import {
  effectiveAccuracyPermille,
  firewallMaxHp,
  getIceSentryConfig,
  getScannerConfig,
  resolveCoreTick,
  resolveFirewallTick,
  rollIceSentryHit,
  trapTriggerDamage,
} from "./nodes/index.js";
import { createRng } from "./rng.js";
import { getMovementBlockConfig } from "./ruleset.js";
import type { BattleEvent, BattleInput, BattleLog, BlockTier, DefenseGraph, DefenseNode, DefenseNodeType, LogicBlock, Score } from "./types.js";

/**
 * S1.5 scope: the 12 v1 logic blocks (RULESET.md §4) are now wired into the tick loop built by
 * S1.3/S1.4. See docs/ADR/0001 for the movement timing model, and the block modules under
 * blocks/ for per-block RULESET-sourced numbers. Two interpretation calls worth knowing about:
 * "IF Node = Firewall" gates against the CURRENTLY OCCUPIED node (see blocks/if-node-type.ts's
 * docstring), and Cloak's tier-III Scanner-radius sub-clause is skipped as redundant (see
 * ruleset.ts's getCloakDurationNodes docstring) — both documented at their source.
 */

interface NodeLocation {
  readonly kind: "node";
  readonly nodeId: number;
}

interface EdgeLocation {
  readonly kind: "edge";
  readonly from: number;
  readonly to: number;
  readonly remainingTicks: number;
}

type VirusLocation = NodeLocation | EdgeLocation;

interface DecoyState {
  chargesRemaining: number;
  absorbsRemainingThisActivation: number;
  readonly absorbsPerActivation: number;
  nextThresholdPermille: number;
}

interface BattleState {
  virusIntegrity: number;
  coreHp: number;
  readonly firewallHp: Map<number, number>;
  readonly destroyedFirewallIds: Set<number>;
  readonly spentTrapIds: Set<number>;
  readonly triggeredHoneypotIds: Set<number>;
  readonly exploitedNodeIds: Set<number>;
  honeypotPendingDeathTick: number | null;
  scannedUntilTick: number | null;
  scannedAccuracyBonusPermille: number;
  readonly iceNextFireTick: Map<number, number>;
  firewallsDestroyed: number;
  nodesVisitedCount: number;
  damageTakenThisTick: number;
  readonly decoy: DecoyState;
}

interface EquippedBlocks {
  readonly detectHoneypot: LogicBlock | null;
  readonly scanAhead: LogicBlock | null;
  readonly cloak: LogicBlock | null;
  readonly slowCrawl: LogicBlock | null;
  readonly selfRepairHealPerTick: number;
  readonly sacrificeDecoy: LogicBlock | null;
}

function summarizeEquippedBlocks(blocks: readonly LogicBlock[]): EquippedBlocks {
  let detectHoneypot: LogicBlock | null = null;
  let scanAhead: LogicBlock | null = null;
  let cloak: LogicBlock | null = null;
  let slowCrawl: LogicBlock | null = null;
  let selfRepairHealPerTick = 0;
  let sacrificeDecoy: LogicBlock | null = null;
  for (const block of blocks) {
    if (block.kind === "detect-honeypot") detectHoneypot ??= block;
    else if (block.kind === "scan-ahead") scanAhead ??= block;
    else if (block.kind === "cloak") cloak ??= block;
    else if (block.kind === "slow-crawl") slowCrawl ??= block;
    else if (block.kind === "self-repair") selfRepairHealPerTick += getSelfRepairHealPerTick(block.tier);
    else if (block.kind === "sacrifice-decoy") sacrificeDecoy ??= block;
  }
  return { detectHoneypot, scanAhead, cloak, slowCrawl, selfRepairHealPerTick, sacrificeDecoy };
}

interface ConditionContext {
  readonly virusIntegrityPermille: number;
  readonly currentNodeType: DefenseNodeType | null;
  readonly scannedUntilTick: number | null;
  readonly tick: number;
}

function isConditionSatisfied(condition: LogicBlock, ctx: ConditionContext): boolean {
  if (condition.kind === "if-integrity-below") {
    return evaluateIfIntegrityBelow(ctx.virusIntegrityPermille, condition.integrityThresholdPermille);
  }
  if (condition.kind === "if-node-type") {
    return evaluateIfNodeType(ctx.currentNodeType, condition.targetNodeTypes);
  }
  if (condition.kind === "if-scanned") {
    return evaluateIfScanned(ctx.scannedUntilTick, ctx.tick);
  }
  return true;
}

const CONDITION_KINDS = new Set(["if-integrity-below", "if-node-type", "if-scanned"]);

/** An Attack/Overload block is gated only if the block immediately before it in the chain is a Condition (RULESET.md §4.2-4.3). */
function isBlockActive(blocks: readonly LogicBlock[], index: number, ctx: ConditionContext): boolean {
  const preceding = blocks[index - 1];
  if (!preceding || !CONDITION_KINDS.has(preceding.kind)) {
    return true;
  }
  return isConditionSatisfied(preceding, ctx);
}

function findNode(graph: DefenseGraph, id: number): DefenseNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`simulate(): no node with id ${id}`);
  }
  return node;
}

function requireTier(node: DefenseNode): BlockTier {
  if (node.tier === undefined) {
    throw new Error(`simulate(): node ${node.id} (${node.type}) has no tier — validate before simulating`);
  }
  return node.tier;
}

function findEdgeLength(graph: DefenseGraph, a: number, b: number): number {
  const edge = graph.edges.find((candidate) => (candidate.from === a && candidate.to === b) || (candidate.from === b && candidate.to === a));
  if (!edge) {
    throw new Error(`simulate(): no edge between node ${a} and node ${b}`);
  }
  return edge.lengthDu;
}

function isBlockingNode(nodeId: number, graph: DefenseGraph, state: BattleState): boolean {
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

function isVirusInRange(graph: DefenseGraph, fromNodeId: number, radiusHops: number, location: VirusLocation): boolean {
  if (location.kind === "node") {
    const distance = hopDistance(graph, fromNodeId, location.nodeId);
    return distance !== null && distance <= radiusHops;
  }
  const distanceFrom = hopDistance(graph, fromNodeId, location.from);
  const distanceTo = hopDistance(graph, fromNodeId, location.to);
  return (distanceFrom !== null && distanceFrom <= radiusHops) || (distanceTo !== null && distanceTo <= radiusHops);
}

function damageVirus(state: BattleState, amount: number): number {
  const before = state.virusIntegrity;
  state.virusIntegrity = Math.max(0, state.virusIntegrity - amount);
  const dealt = before - state.virusIntegrity;
  state.damageTakenThisTick += dealt;
  return dealt;
}

/** Sacrifice Decoy absorbs the trigger instead, if a charge is armed. Firewall counter-damage is NOT absorbable (RULESET.md §4.2). */
function tryAbsorbWithDecoy(state: BattleState): boolean {
  if (state.decoy.absorbsRemainingThisActivation > 0) {
    state.decoy.absorbsRemainingThisActivation -= 1;
    return true;
  }
  return false;
}

interface AttackContribution {
  readonly perTickDamage: number;
  readonly oneShotDamage: number;
  readonly exploitFired: boolean;
}

function computeAttackContribution(
  virusBlocks: readonly LogicBlock[],
  ctx: ConditionContext,
  nodeId: number,
  justArrivedNodeId: number | null,
  exploitedNodeIds: ReadonlySet<number>,
): AttackContribution {
  let perTickDamage = 0;
  let oneShotDamage = 0;
  let exploitFired = false;
  virusBlocks.forEach((block, index) => {
    if (!isBlockActive(virusBlocks, index, ctx)) {
      return;
    }
    if (block.kind === "brute-force") {
      perTickDamage += getBruteForceDamagePerTick(block.tier);
    } else if (block.kind === "exploit" && justArrivedNodeId === nodeId && !exploitedNodeIds.has(nodeId)) {
      oneShotDamage += getExploitDamage(block.tier);
      exploitFired = true;
    }
  });
  return { perTickDamage, oneShotDamage, exploitFired };
}

function applyOverloadSplash(
  graph: DefenseGraph,
  destroyedFirewallId: number,
  virusBlocks: readonly LogicBlock[],
  ctx: ConditionContext,
  state: BattleState,
  tick: number,
  events: BattleEvent[],
): void {
  virusBlocks.forEach((block, index) => {
    if (block.kind !== "overload" || !isBlockActive(virusBlocks, index, ctx)) {
      return;
    }
    const config = getOverloadConfig(block.tier);
    for (const node of graph.nodes) {
      if (node.id === destroyedFirewallId || (node.type !== "firewall" && node.type !== "core")) {
        continue;
      }
      const distance = hopDistance(graph, destroyedFirewallId, node.id);
      if (distance === null || distance > config.radiusHops) {
        continue;
      }
      if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
        const tier = requireTier(node);
        const currentHp = state.firewallHp.get(node.id) ?? firewallMaxHp(tier);
        const newHp = Math.max(0, currentHp - config.splashDamage);
        state.firewallHp.set(node.id, newHp);
        events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - newHp) });
        if (newHp <= 0) {
          state.destroyedFirewallIds.add(node.id);
          state.firewallsDestroyed += 1;
          events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id) });
        }
      } else if (node.type === "core") {
        const newHp = Math.max(0, state.coreHp - config.splashDamage);
        const drained = state.coreHp - newHp;
        state.coreHp = newHp;
        if (drained > 0) {
          events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained });
        }
      }
    }
  });
}

interface ScoreParams {
  readonly integrityRatioPermille: number;
  readonly coreRatioPermille: number;
  readonly nodesDestroyed: number;
  readonly ticksElapsed: number;
}

/** docs/RULESET.md §8. */
export function computeScore(winner: "attacker" | "defender", params: ScoreParams): Score {
  const timeBonus = Math.max(0, Math.floor((BATTLE_TICK_LIMIT - params.ticksElapsed) / 4));
  const base = winner === "attacker" ? 500 : 300;
  const ratio = winner === "attacker" ? params.integrityRatioPermille : params.coreRatioPermille;
  const value = base + Math.floor((ratio * 300) / 1000) + params.nodesDestroyed * 40 + timeBonus;
  return {
    value,
    integrityRatioPermille: params.integrityRatioPermille,
    coreRatioPermille: params.coreRatioPermille,
    nodesDestroyed: params.nodesDestroyed,
    timeBonus,
  };
}

export function simulate(input: BattleInput): BattleLog {
  const graph = input.defense;
  const coreNode = findNode(graph, graph.coreNodeId);
  if (coreNode.type !== "core") {
    throw new Error("simulate(): defense graph has no valid core node — validate before simulating");
  }
  const movementConfig = getMovementBlockConfig(input.virus.movement.kind);
  const algorithm = MOVEMENT_ALGORITHMS[input.virus.movement.kind];
  const equipped = summarizeEquippedBlocks(input.virus.blocks);

  const rng = createRng(input.seed);
  const events: BattleEvent[] = [];
  const triedEdgesFromNode = new Map<number, Set<number>>();
  const knownHazardNodeIds = new Set<number>();

  const decoyConfig = equipped.sacrificeDecoy ? getSacrificeDecoyConfig(equipped.sacrificeDecoy.tier) : null;
  const state: BattleState = {
    virusIntegrity: 1000,
    coreHp: graph.coreHp,
    firewallHp: new Map(),
    destroyedFirewallIds: new Set(),
    spentTrapIds: new Set(),
    triggeredHoneypotIds: new Set(),
    exploitedNodeIds: new Set(),
    honeypotPendingDeathTick: null,
    scannedUntilTick: null,
    scannedAccuracyBonusPermille: 0,
    iceNextFireTick: new Map(),
    firewallsDestroyed: 0,
    nodesVisitedCount: 0,
    damageTakenThisTick: 0,
    decoy: {
      chargesRemaining: decoyConfig?.chargesTotal ?? 0,
      absorbsRemainingThisActivation: 0,
      absorbsPerActivation: decoyConfig?.absorbsPerActivation ?? 0,
      nextThresholdPermille: 200,
    },
  };

  const iceSentryNodes = graph.nodes.filter((node) => node.type === "ice-sentry").sort((a, b) => a.id - b.id);
  const scannerNodes = graph.nodes.filter((node) => node.type === "scanner").sort((a, b) => a.id - b.id);
  const slowCrawlReduction = equipped.slowCrawl ? getSlowCrawlConfig(equipped.slowCrawl.tier).iceAccuracyReductionPermille : 0;
  const effectiveSpeed = equipped.slowCrawl
    ? Math.floor((movementConfig.speedDuPerTick * getSlowCrawlConfig(equipped.slowCrawl.tier).speedMultiplierPermille) / 1000)
    : movementConfig.speedDuPerTick;

  const entryIndex = rng.nextInt(graph.entryNodeIds.length);
  const entryNodeId = graph.entryNodeIds[entryIndex]!;

  let location: VirusLocation = { kind: "node", nodeId: entryNodeId };
  state.nodesVisitedCount += 1;
  events.push({ tick: 0, type: "virus-entered-node", actor: "virus", target: String(entryNodeId) });

  function finalize(tick: number): BattleLog | null {
    if (state.coreHp <= 0) {
      events.push({ tick, type: "battle-won", actor: "virus" });
      return {
        input,
        events,
        result: {
          winner: "attacker",
          score: computeScore("attacker", {
            integrityRatioPermille: state.virusIntegrity,
            coreRatioPermille: 0,
            nodesDestroyed: state.firewallsDestroyed,
            ticksElapsed: tick,
          }),
        },
      };
    }
    if (state.virusIntegrity <= 0) {
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
    state.damageTakenThisTick = 0;

    // --- Phase 0: Sensor (RULESET.md §7 step 1) — feeds Backtrack's knownHazardNodeIds ---
    if (equipped.detectHoneypot) {
      const config = getDetectHoneypotConfig(equipped.detectHoneypot.tier);
      for (const node of graph.nodes) {
        if (node.type === "honeypot" && isVirusInRange(graph, node.id, config.radiusHops, location)) {
          knownHazardNodeIds.add(node.id);
        }
      }
    }
    if (equipped.scanAhead && getScanAheadConfig(equipped.scanAhead.tier).revealsTraps) {
      const config = getScanAheadConfig(equipped.scanAhead.tier);
      for (const node of graph.nodes) {
        if (node.type === "trap" && !state.spentTrapIds.has(node.id) && isVirusInRange(graph, node.id, config.radiusHops, location)) {
          knownHazardNodeIds.add(node.id);
        }
      }
    }

    // --- Phase A: Movement (RULESET.md §7 step 3) ---
    let justArrivedNodeId: number | null = null;
    if (location.kind === "edge") {
      const edge: EdgeLocation = location;
      const remainingTicks = edge.remainingTicks - 1;
      if (remainingTicks > 0) {
        location = { kind: "edge", from: edge.from, to: edge.to, remainingTicks };
      } else {
        location = { kind: "node", nodeId: edge.to };
        state.nodesVisitedCount += 1;
        justArrivedNodeId = edge.to;
        events.push({ tick, type: "virus-entered-node", actor: "virus", target: String(edge.to) });
      }
    } else if (!isBlockingNode(location.nodeId, graph, state)) {
      const decision = algorithm(location.nodeId, { graph, rng, triedEdgesFromNode, knownHazardNodeIds });
      if (decision) {
        const edgeLength = findEdgeLength(graph, location.nodeId, decision.toNodeId);
        location = {
          kind: "edge",
          from: location.nodeId,
          to: decision.toNodeId,
          remainingTicks: ticksToCrossEdge(edgeLength, effectiveSpeed),
        };
      }
    }

    const cloakActive = equipped.cloak !== null && state.nodesVisitedCount <= getCloakDurationNodes(equipped.cloak.tier);
    let isOccupyingBreachNode = false;

    // --- Phase B: Node effects (RULESET.md §7 step 5 — Breach, Shoot, Trigger, Aura) ---
    if (location.kind === "node") {
      const node = findNode(graph, location.nodeId);
      const conditionCtx: ConditionContext = {
        virusIntegrityPermille: state.virusIntegrity,
        currentNodeType: node.type,
        scannedUntilTick: state.scannedUntilTick,
        tick,
      };

      if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
        isOccupyingBreachNode = true;
        const tier = requireTier(node);
        const currentHp = state.firewallHp.get(node.id) ?? firewallMaxHp(tier);
        const passive = resolveFirewallTick(currentHp, tier);
        const attack = computeAttackContribution(input.virus.blocks, conditionCtx, node.id, justArrivedNodeId, state.exploitedNodeIds);
        const newHp = Math.max(0, passive.remainingHp - attack.perTickDamage - attack.oneShotDamage);
        state.firewallHp.set(node.id, newHp);
        if (attack.exploitFired) {
          state.exploitedNodeIds.add(node.id);
        }
        events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - newHp) });
        const dealt = damageVirus(state, passive.counterDamageToVirus);
        if (dealt > 0) {
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
        if (newHp <= 0) {
          state.destroyedFirewallIds.add(node.id);
          state.firewallsDestroyed += 1;
          events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id) });
          applyOverloadSplash(graph, node.id, input.virus.blocks, conditionCtx, state, tick, events);
        }
      } else if (node.type === "core") {
        isOccupyingBreachNode = true;
        const passive = resolveCoreTick(state.coreHp);
        const attack = computeAttackContribution(input.virus.blocks, conditionCtx, node.id, justArrivedNodeId, state.exploitedNodeIds);
        const newHp = Math.max(0, passive.remainingHp - attack.perTickDamage - attack.oneShotDamage);
        if (attack.exploitFired) {
          state.exploitedNodeIds.add(node.id);
        }
        const drained = state.coreHp - newHp;
        state.coreHp = newHp;
        if (drained > 0) {
          events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained });
        }
      }
    }

    for (const iceNode of iceSentryNodes) {
      if (cloakActive) {
        continue;
      }
      const tier = requireTier(iceNode);
      const config = getIceSentryConfig(tier);
      if (!isVirusInRange(graph, iceNode.id, config.radiusHops, location)) {
        continue;
      }
      const nextFireTick = state.iceNextFireTick.get(iceNode.id) ?? 0;
      if (tick < nextFireTick) {
        continue;
      }
      const scannedActive = state.scannedUntilTick !== null && tick < state.scannedUntilTick;
      const accuracy = effectiveAccuracyPermille(config.accuracyPermille, scannedActive ? state.scannedAccuracyBonusPermille : 0, slowCrawlReduction);
      const hit = rollIceSentryHit(rng, accuracy);
      state.iceNextFireTick.set(iceNode.id, tick + config.fireIntervalTicks);
      if (hit) {
        if (tryAbsorbWithDecoy(state)) {
          events.push({ tick, type: "decoy-absorbed", actor: String(iceNode.id), target: "virus" });
        } else {
          const dealt = damageVirus(state, config.damage);
          events.push({ tick, type: "virus-damaged", actor: String(iceNode.id), target: "virus", delta: -dealt });
        }
      }
    }

    if (location.kind === "node") {
      const node = findNode(graph, location.nodeId);
      if (node.type === "honeypot") {
        if (justArrivedNodeId === node.id && !state.triggeredHoneypotIds.has(node.id)) {
          state.triggeredHoneypotIds.add(node.id);
          const honeypotTier = requireTier(node);
          const disguised = honeypotTier >= 2;
          const detected = equipped.detectHoneypot !== null && (!disguised || getDetectHoneypotConfig(equipped.detectHoneypot.tier).seesDisguise);
          if (!detected) {
            if (tryAbsorbWithDecoy(state)) {
              events.push({ tick, type: "decoy-absorbed", actor: String(node.id), target: "virus" });
            } else {
              state.honeypotPendingDeathTick = tick + 1;
            }
          }
        } else if (state.honeypotPendingDeathTick === tick) {
          const dealt = damageVirus(state, state.virusIntegrity);
          state.honeypotPendingDeathTick = null;
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
      } else if (node.type === "trap" && justArrivedNodeId === node.id && !state.spentTrapIds.has(node.id)) {
        state.spentTrapIds.add(node.id);
        const tier = requireTier(node);
        if (tryAbsorbWithDecoy(state)) {
          events.push({ tick, type: "decoy-absorbed", actor: String(node.id), target: "virus" });
        } else {
          const dealt = damageVirus(state, trapTriggerDamage(tier));
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
      }
    }

    for (const scannerNode of scannerNodes) {
      if (cloakActive) {
        continue;
      }
      const tier = requireTier(scannerNode);
      const config = getScannerConfig(tier);
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

    // --- Utility: Self Repair, Sacrifice Decoy re-arm (RULESET.md §7 step 6) ---
    if (equipped.selfRepairHealPerTick > 0 && state.damageTakenThisTick === 0 && !isOccupyingBreachNode) {
      const before = state.virusIntegrity;
      state.virusIntegrity = Math.min(1000, state.virusIntegrity + equipped.selfRepairHealPerTick);
      if (state.virusIntegrity > before) {
        events.push({ tick, type: "virus-repaired", actor: "self-repair", target: "virus", delta: state.virusIntegrity - before });
      }
    }
    if (state.decoy.absorbsRemainingThisActivation === 0 && shouldArmSacrificeDecoy(state.virusIntegrity, state.decoy.nextThresholdPermille, state.decoy.chargesRemaining)) {
      state.decoy.chargesRemaining -= 1;
      state.decoy.absorbsRemainingThisActivation = state.decoy.absorbsPerActivation;
      state.decoy.nextThresholdPermille = nextSacrificeDecoyThreshold(state.decoy.nextThresholdPermille);
      events.push({ tick, type: "status-applied", actor: "sacrifice-decoy", target: "virus" });
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
