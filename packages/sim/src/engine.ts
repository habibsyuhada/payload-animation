import { BATTLE_TICK_LIMIT, ticksToCrossEdge } from "./fixed.js";
import { MOVEMENT_ALGORITHMS } from "./movement.js";
import { createRng } from "./rng.js";
import { getMovementBlockConfig } from "./ruleset.js";
import type { BattleEvent, BattleInput, BattleLog, DefenseGraph, DefenseNode, Score } from "./types.js";

/**
 * S1.3 scope: tick loop + movement blocks ONLY. Node combat (Firewall/ICE Sentry/Honeypot/
 * Scanner/Trap — S1.4) and logic blocks (Sensor/Condition/Attack/Stealth/Utility — S1.5) do not
 * exist yet, so every non-Core node the virus passes through is currently inert like a Router,
 * and reaching Core is a temporary INSTANT WIN with no HP tracking. See docs/ADR/0001 for the
 * timing model this loop implements and why. This stub is replaced once S1.4 gives Core real HP.
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

function findCoreNode(graph: DefenseGraph): DefenseNode {
  const core = graph.nodes.find((node) => node.id === graph.coreNodeId && node.type === "core");
  if (!core) {
    throw new Error("simulate(): defense graph has no valid core node — validate before simulating");
  }
  return core;
}

function findEdgeLength(graph: DefenseGraph, a: number, b: number): number {
  const edge = graph.edges.find((candidate) => (candidate.from === a && candidate.to === b) || (candidate.from === b && candidate.to === a));
  if (!edge) {
    throw new Error(`simulate(): no edge between node ${a} and node ${b}`);
  }
  return edge.lengthDu;
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
  const coreNode = findCoreNode(graph);
  const movementConfig = getMovementBlockConfig(input.virus.movement.kind);
  const algorithm = MOVEMENT_ALGORITHMS[input.virus.movement.kind];

  const rng = createRng(input.seed);
  const events: BattleEvent[] = [];
  const triedEdgesFromNode = new Map<number, Set<number>>();
  const knownHazardNodeIds = new Set<number>();

  // First RNG draw of the battle, RULESET.md §0/§6: entry point is chosen, not player-picked.
  const entryIndex = rng.nextInt(graph.entryNodeIds.length);
  const entryNodeId = graph.entryNodeIds[entryIndex]!;

  let location: VirusLocation = { kind: "node", nodeId: entryNodeId };
  events.push({ tick: 0, type: "virus-entered-node", actor: "virus", target: String(entryNodeId) });

  for (let tick = 0; tick < BATTLE_TICK_LIMIT; tick += 1) {
    if (location.kind === "edge") {
      const edge: EdgeLocation = location;
      const remainingTicks: number = edge.remainingTicks - 1;
      if (remainingTicks > 0) {
        location = { kind: "edge", from: edge.from, to: edge.to, remainingTicks };
        continue;
      }
      const arrivedNodeId = edge.to;
      location = { kind: "node", nodeId: arrivedNodeId };
      events.push({ tick, type: "virus-entered-node", actor: "virus", target: String(arrivedNodeId) });
      if (arrivedNodeId === coreNode.id) {
        events.push({ tick, type: "battle-won", actor: "virus" });
        return {
          input,
          events,
          result: {
            winner: "attacker",
            score: computeScore("attacker", {
              integrityRatioPermille: 1000,
              coreRatioPermille: 0,
              nodesDestroyed: 0,
              ticksElapsed: tick,
            }),
          },
        };
      }
      continue;
    }

    const decision = algorithm(location.nodeId, { graph, rng, triedEdgesFromNode, knownHazardNodeIds });
    if (!decision) {
      continue; // stuck (no outgoing edge) — should not happen on a validated topology
    }
    const edgeLength = findEdgeLength(graph, location.nodeId, decision.toNodeId);
    location = {
      kind: "edge",
      from: location.nodeId,
      to: decision.toNodeId,
      remainingTicks: ticksToCrossEdge(edgeLength, movementConfig.speedDuPerTick),
    };
  }

  events.push({ tick: BATTLE_TICK_LIMIT, type: "battle-timeout", actor: "core" });
  return {
    input,
    events,
    result: {
      winner: "defender",
      score: computeScore("defender", {
        integrityRatioPermille: 1000,
        coreRatioPermille: 1000,
        nodesDestroyed: 0,
        ticksElapsed: BATTLE_TICK_LIMIT,
      }),
    },
  };
}
