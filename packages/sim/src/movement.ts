import { shortestPath } from "./graph.js";
import type { Rng } from "./rng.js";
import type { DefenseGraph, MovementBlockKind } from "./types.js";

/**
 * Movement algorithms, docs/RULESET.md §3. All three target the graph's Core node —
 * "where to go" is fixed, only "which edge next" differs per algorithm.
 */

export interface MovementContext {
  readonly graph: DefenseGraph;
  readonly rng: Rng;
  /** Random Walk's per-node "already tried from here" memory, mutated across the battle. */
  readonly triedEdgesFromNode: Map<number, Set<number>>;
  /**
   * Nodes Backtrack currently knows to route around (populated by Sensor blocks — Scan Ahead /
   * Detect Honeypot — which don't exist until S1.5). Always empty in S1.3: Backtrack degrades to
   * Shortest Path exactly as RULESET.md §3 implies for a virus with no detection info.
   */
  readonly knownHazardNodeIds: ReadonlySet<number>;
}

export interface MovementDecision {
  readonly toNodeId: number;
}

export type MovementAlgorithm = (currentNodeId: number, ctx: MovementContext) => MovementDecision | null;

function neighborsOf(graph: DefenseGraph, nodeId: number): number[] {
  const neighbors = new Set<number>();
  for (const edge of graph.edges) {
    if (edge.from === nodeId) {
      neighbors.add(edge.to);
    } else if (edge.to === nodeId) {
      neighbors.add(edge.from);
    }
  }
  return [...neighbors].sort((a, b) => a - b);
}

const shortestPathMovement: MovementAlgorithm = (currentNodeId, { graph }) => {
  const path = shortestPath(graph, currentNodeId, graph.coreNodeId);
  if (!path || path.length < 2) {
    return null;
  }
  return { toNodeId: path[1]! };
};

const backtrackMovement: MovementAlgorithm = (currentNodeId, { graph, knownHazardNodeIds }) => {
  const avoiding = shortestPath(graph, currentNodeId, graph.coreNodeId, { avoid: knownHazardNodeIds });
  const path = avoiding ?? shortestPath(graph, currentNodeId, graph.coreNodeId);
  if (!path || path.length < 2) {
    return null;
  }
  return { toNodeId: path[1]! };
};

const randomWalkMovement: MovementAlgorithm = (currentNodeId, { graph, rng, triedEdgesFromNode }) => {
  const neighbors = neighborsOf(graph, currentNodeId);
  if (neighbors.length === 0) {
    return null;
  }

  let tried = triedEdgesFromNode.get(currentNodeId);
  if (!tried) {
    tried = new Set<number>();
    triedEdgesFromNode.set(currentNodeId, tried);
  }

  let candidates = neighbors.filter((neighbor) => !tried!.has(neighbor));
  if (candidates.length === 0) {
    // Buntu: every edge out of this node has been tried already — reset and allow revisiting.
    tried.clear();
    candidates = neighbors;
  }

  const pick = candidates[rng.nextInt(candidates.length)]!;
  tried.add(pick);
  return { toNodeId: pick };
};

export const MOVEMENT_ALGORITHMS: Record<MovementBlockKind, MovementAlgorithm> = {
  "shortest-path": shortestPathMovement,
  backtrack: backtrackMovement,
  "random-walk": randomWalkMovement,
};
