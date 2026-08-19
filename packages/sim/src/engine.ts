import { BATTLE_TICK_LIMIT, ticksToCrossEdge } from "./fixed.js";
import { hopDistance } from "./graph.js";
import { MOVEMENT_ALGORITHMS } from "./movement.js";
import {
  effectiveAccuracyPermille,
  firewallMaxHp,
  getIceSentryConfig,
  getScannerConfig,
  honeypotIsLethal,
  resolveCoreTick,
  resolveFirewallTick,
  rollIceSentryHit,
  trapTriggerDamage,
} from "./nodes/index.js";
import { createRng } from "./rng.js";
import { getMovementBlockConfig } from "./ruleset.js";
import type { BattleEvent, BattleInput, BattleLog, BlockTier, DefenseGraph, DefenseNode, Score } from "./types.js";

/**
 * S1.4 scope: real node combat (Router/Firewall/ICE Sentry/Honeypot/Scanner/Trap/Core) replaces
 * the S1.3 Core-instant-win stub. Logic blocks (Sensor/Condition/Attack/Stealth/Utility, S1.5)
 * still don't exist — Honeypot is unconditionally lethal (no Detect Honeypot / Sacrifice Decoy
 * yet), and Breach nodes only take RULESET.md §5.0's passive drain (no Attack-block damage yet).
 * See docs/ADR/0001 for the movement timing model this loop still follows.
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

interface BattleState {
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
  return before - state.virusIntegrity;
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

  const rng = createRng(input.seed);
  const events: BattleEvent[] = [];
  const triedEdgesFromNode = new Map<number, Set<number>>();
  const knownHazardNodeIds = new Set<number>();

  const state: BattleState = {
    virusIntegrity: 1000,
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
  };

  const iceSentryNodes = graph.nodes.filter((node) => node.type === "ice-sentry").sort((a, b) => a.id - b.id);
  const scannerNodes = graph.nodes.filter((node) => node.type === "scanner").sort((a, b) => a.id - b.id);

  const entryIndex = rng.nextInt(graph.entryNodeIds.length);
  const entryNodeId = graph.entryNodeIds[entryIndex]!;

  let location: VirusLocation = { kind: "node", nodeId: entryNodeId };
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
    // --- Phase A: Movement (RULESET.md §7 step 3) ---
    let justArrivedNodeId: number | null = null;
    if (location.kind === "edge") {
      const edge: EdgeLocation = location;
      const remainingTicks = edge.remainingTicks - 1;
      if (remainingTicks > 0) {
        location = { kind: "edge", from: edge.from, to: edge.to, remainingTicks };
      } else {
        location = { kind: "node", nodeId: edge.to };
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
          remainingTicks: ticksToCrossEdge(edgeLength, movementConfig.speedDuPerTick),
        };
      }
    }

    // --- Phase B: Node effects (RULESET.md §7 step 5 — Breach, Shoot, Trigger, Aura) ---
    if (location.kind === "node") {
      const node = findNode(graph, location.nodeId);

      if (node.type === "firewall" && !state.destroyedFirewallIds.has(node.id)) {
        const tier = requireTier(node);
        const currentHp = state.firewallHp.get(node.id) ?? firewallMaxHp(tier);
        const result = resolveFirewallTick(currentHp, tier);
        state.firewallHp.set(node.id, result.remainingHp);
        events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -(currentHp - result.remainingHp) });
        const dealt = damageVirus(state, result.counterDamageToVirus);
        if (dealt > 0) {
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
        if (result.destroyed) {
          state.destroyedFirewallIds.add(node.id);
          state.firewallsDestroyed += 1;
          events.push({ tick, type: "node-destroyed", actor: "virus", target: String(node.id) });
        }
      } else if (node.type === "core") {
        const result = resolveCoreTick(state.coreHp);
        const drained = state.coreHp - result.remainingHp;
        state.coreHp = result.remainingHp;
        if (drained > 0) {
          events.push({ tick, type: "node-damaged", actor: "virus", target: String(node.id), delta: -drained });
        }
      }
    }

    for (const iceNode of iceSentryNodes) {
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
      const accuracy = effectiveAccuracyPermille(config.accuracyPermille, scannedActive ? state.scannedAccuracyBonusPermille : 0);
      const hit = rollIceSentryHit(rng, accuracy);
      state.iceNextFireTick.set(iceNode.id, tick + config.fireIntervalTicks);
      if (hit) {
        const dealt = damageVirus(state, config.damage);
        events.push({ tick, type: "virus-damaged", actor: String(iceNode.id), target: "virus", delta: -dealt });
      }
    }

    if (location.kind === "node") {
      const node = findNode(graph, location.nodeId);
      if (node.type === "honeypot") {
        if (justArrivedNodeId === node.id && !state.triggeredHoneypotIds.has(node.id)) {
          state.triggeredHoneypotIds.add(node.id);
          if (honeypotIsLethal(false, false)) {
            state.honeypotPendingDeathTick = tick + 1;
          }
        } else if (state.honeypotPendingDeathTick === tick) {
          const dealt = damageVirus(state, state.virusIntegrity);
          state.honeypotPendingDeathTick = null;
          events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
        }
      } else if (node.type === "trap" && justArrivedNodeId === node.id && !state.spentTrapIds.has(node.id)) {
        const tier = requireTier(node);
        state.spentTrapIds.add(node.id);
        const dealt = damageVirus(state, trapTriggerDamage(tier));
        events.push({ tick, type: "virus-damaged", actor: String(node.id), target: "virus", delta: -dealt });
      }
    }

    for (const scannerNode of scannerNodes) {
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
