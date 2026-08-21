import {
  CORE_NODE_COUNT_V1,
  EDGE_LENGTH_MAX_DU,
  EDGE_LENGTH_MIN_DU,
  ENTRY_NODE_COUNT_V1,
  getAccountTierConfig,
  getDefenseNodeCost,
} from "./ruleset.js";
import { getDefenseNodeCostV2 } from "./ruleset-v2.js";
import type { AccountTierConfig, BlockTier, DefenseGraph, DefenseNodeType, Ruleset } from "./types.js";

/** Undirected adjacency list — virus movement (incl. Backtrack) can traverse edges both ways. */
export function buildAdjacency(graph: DefenseGraph): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) {
      continue;
    }
    adjacency.get(edge.from)!.push(edge.to);
    adjacency.get(edge.to)!.push(edge.from);
  }
  return adjacency;
}

export interface ShortestPathOptions {
  /** Nodes to route around (e.g. Backtrack avoiding a detected Trap/Honeypot) — never excludes toId itself. */
  readonly avoid?: ReadonlySet<number>;
}

interface WeightedEdge {
  readonly to: number;
  readonly weight: number;
}

function buildWeightedAdjacency(graph: DefenseGraph): Map<number, WeightedEdge[]> {
  const adjacency = new Map<number, WeightedEdge[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) {
      continue;
    }
    adjacency.get(edge.from)!.push({ to: edge.to, weight: edge.lengthDu });
    adjacency.get(edge.to)!.push({ to: edge.from, weight: edge.lengthDu });
  }
  return adjacency;
}

/** Sentinel for "no known finite distance yet" — kept a real integer, never a float, per PLAN §0. */
const UNREACHABLE_DISTANCE = Number.MAX_SAFE_INTEGER;

/**
 * Dijkstra shortest path weighted by edge.lengthDu (total DU distance, not hop count) — DU length
 * is a deliberate defensive design lever (GDD §5.2, "jarak adalah sumber daya desain"), so the
 * Shortest Path movement block has to actually respond to it. Null if unreachable.
 */
export function shortestPath(
  graph: DefenseGraph,
  fromId: number,
  toId: number,
  options?: ShortestPathOptions,
): number[] | null {
  if (fromId === toId) {
    return [fromId];
  }
  const adjacency = buildWeightedAdjacency(graph);
  if (!adjacency.has(fromId) || !adjacency.has(toId)) {
    return null;
  }
  const avoid = options?.avoid;

  const dist = new Map<number, number>([[fromId, 0]]);
  const cameFrom = new Map<number, number>();
  const visited = new Set<number>();

  for (;;) {
    let current: number | undefined;
    let currentDist = UNREACHABLE_DISTANCE;
    for (const [nodeId, nodeDist] of dist) {
      if (!visited.has(nodeId) && nodeDist < currentDist) {
        current = nodeId;
        currentDist = nodeDist;
      }
    }
    if (current === undefined || current === toId) {
      break;
    }
    visited.add(current);
    for (const { to, weight } of adjacency.get(current) ?? []) {
      if (visited.has(to) || (avoid?.has(to) && to !== toId)) {
        continue;
      }
      const candidateDist = currentDist + weight;
      if (candidateDist < (dist.get(to) ?? UNREACHABLE_DISTANCE)) {
        dist.set(to, candidateDist);
        cameFrom.set(to, current);
      }
    }
  }

  if (!dist.has(toId)) {
    return null;
  }

  const path: number[] = [toId];
  let cursor = toId;
  while (cursor !== fromId) {
    const previous = cameFrom.get(cursor);
    if (previous === undefined) {
      return null;
    }
    path.push(previous);
    cursor = previous;
  }
  return path.reverse();
}

export function isReachable(graph: DefenseGraph, fromId: number, toId: number): boolean {
  return shortestPath(graph, fromId, toId) !== null;
}

/**
 * Hop count (unweighted BFS) between two nodes — used for ICE Sentry/Scanner radius (RULESET.md
 * §5.1 "radius R hop"), deliberately NOT the DU-weighted distance `shortestPath` uses for
 * movement.
 */
export function hopDistance(graph: DefenseGraph, fromId: number, toId: number): number | null {
  if (fromId === toId) {
    return 0;
  }
  const adjacency = buildAdjacency(graph);
  if (!adjacency.has(fromId) || !adjacency.has(toId)) {
    return null;
  }

  const visited = new Set<number>([fromId]);
  const queue: number[] = [fromId];
  const distance = new Map<number, number>([[fromId, 0]]);
  let head = 0;

  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    if (current === toId) {
      return distance.get(current)!;
    }
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      distance.set(neighbor, distance.get(current)! + 1);
      queue.push(neighbor);
    }
  }

  return null;
}

export type GraphValidationErrorCode =
  | "duplicate-node-id"
  | "wrong-core-count"
  | "core-id-mismatch"
  | "wrong-entry-count"
  | "entry-id-mismatch"
  | "invalid-edge-reference"
  | "self-loop-edge"
  | "edge-length-out-of-range"
  | "unreachable-entry"
  | "unsupported-node-type"
  | "budget-exceeded"
  | "core-hp-mismatch";

export interface GraphValidationError {
  readonly code: GraphValidationErrorCode;
  readonly message: string;
  readonly nodeId?: number;
}

export interface GraphValidationResult {
  readonly valid: boolean;
  readonly errors: readonly GraphValidationError[];
}

interface DefenseTopologyRules {
  readonly entryNodeCount: number;
  readonly coreNodeCount: number;
  readonly edgeLengthMinDu: number;
  readonly edgeLengthMaxDu: number;
  /** Throws for a type (or type/tier combo) this ruleset version has no price for — the ONE source
   * of truth for "does this ruleset know this node", rather than a separately maintained Set that
   * could drift out of sync with the cost table itself. */
  readonly nodeCost: (type: DefenseNodeType, tier?: BlockTier) => number;
}

/**
 * The version-aware seam `validateDefenseGraph` was missing (ADR 0007): it already took a
 * `Ruleset` parameter but every constant inside the function ignored it and read straight from
 * v1's frozen `ruleset.ts`. Topology itself (entry/core counts, edge length bounds) is unchanged
 * between v1 and v2 by design (RULESET.md §10 preamble: "yang tidak berubah dari v1 ... §6" is
 * implied by omission — nothing in §10-§13 revises it), so the v2 branch deliberately reuses v1's
 * topology constants rather than duplicating numbers that were never meant to diverge. Node costs
 * DO diverge (v2 adds five node types over 8.2a/8.2b), so those come from the v2 table.
 */
function topologyRulesFor(ruleset: Ruleset): DefenseTopologyRules {
  return {
    entryNodeCount: ENTRY_NODE_COUNT_V1,
    coreNodeCount: CORE_NODE_COUNT_V1,
    edgeLengthMinDu: EDGE_LENGTH_MIN_DU,
    edgeLengthMaxDu: EDGE_LENGTH_MAX_DU,
    nodeCost: ruleset.version === "v2" ? getDefenseNodeCostV2 : getDefenseNodeCost,
  };
}

/**
 * Enforces docs/RULESET.md §6: exactly 1 Core, exactly 2 Entry nodes each reachable to Core,
 * edge lengths within [200, 2000] DU, every node a type the ruleset version actually knows, and
 * total placed-node cost within the account's Defense Budget. Structurally-broken edges (dangling
 * refs, self-loops) are reported but excluded from the adjacency graph used for reachability, and
 * unsupported-type nodes are reported but excluded from the cost sum — one bad node doesn't mask
 * every other check (same philosophy as the edge handling below).
 */
export function validateDefenseGraph(
  graph: DefenseGraph,
  ruleset: Ruleset,
  accountTier: AccountTierConfig["tier"],
): GraphValidationResult {
  const topology = topologyRulesFor(ruleset);
  const errors: GraphValidationError[] = [];
  const nodeIds = new Set<number>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ code: "duplicate-node-id", message: `duplicate node id ${node.id}`, nodeId: node.id });
      continue;
    }
    nodeIds.add(node.id);
  }

  const coreNodes = graph.nodes.filter((node) => node.type === "core");
  if (coreNodes.length !== topology.coreNodeCount) {
    errors.push({
      code: "wrong-core-count",
      message: `expected exactly ${topology.coreNodeCount} core node, found ${coreNodes.length}`,
    });
  } else if (coreNodes[0]!.id !== graph.coreNodeId) {
    errors.push({
      code: "core-id-mismatch",
      message: `coreNodeId ${graph.coreNodeId} does not reference the graph's core-type node`,
      nodeId: graph.coreNodeId,
    });
  }

  const entryNodes = graph.nodes.filter((node) => node.type === "entry");
  if (entryNodes.length !== topology.entryNodeCount || graph.entryNodeIds.length !== topology.entryNodeCount) {
    errors.push({
      code: "wrong-entry-count",
      message: `expected exactly ${topology.entryNodeCount} entry nodes, found ${entryNodes.length} node(s) of type "entry" and ${graph.entryNodeIds.length} id(s) in entryNodeIds`,
    });
  } else {
    const entryNodeIdSet = new Set(entryNodes.map((node) => node.id));
    for (const id of graph.entryNodeIds) {
      if (!entryNodeIdSet.has(id)) {
        errors.push({ code: "entry-id-mismatch", message: `entryNodeIds contains ${id}, which is not an entry-type node`, nodeId: id });
      }
    }
  }

  for (const edge of graph.edges) {
    if (edge.from === edge.to) {
      errors.push({ code: "self-loop-edge", message: `edge ${edge.from}->${edge.to} is a self-loop`, nodeId: edge.from });
      continue;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      errors.push({ code: "invalid-edge-reference", message: `edge ${edge.from}->${edge.to} references a node that does not exist` });
      continue;
    }
    if (!Number.isInteger(edge.lengthDu) || edge.lengthDu < topology.edgeLengthMinDu || edge.lengthDu > topology.edgeLengthMaxDu) {
      errors.push({
        code: "edge-length-out-of-range",
        message: `edge ${edge.from}->${edge.to} length ${edge.lengthDu} DU is outside [${topology.edgeLengthMinDu}, ${topology.edgeLengthMaxDu}]`,
      });
    }
  }

  if (coreNodes.length === topology.coreNodeCount) {
    for (const entry of entryNodes) {
      if (!isReachable(graph, entry.id, graph.coreNodeId)) {
        errors.push({ code: "unreachable-entry", message: `entry node ${entry.id} has no path to core`, nodeId: entry.id });
      }
    }
  }

  const tierConfig = getAccountTierConfig(ruleset, accountTier);
  let totalCost = 0;
  for (const node of graph.nodes) {
    try {
      totalCost += topology.nodeCost(node.type, node.tier);
    } catch {
      // getDefenseNodeCost(V2) throws for a type/tier this ruleset version has no price for — this
      // used to crash validateDefenseGraph outright (ADR 0007's "bug laten"); reported instead, and
      // excluded from the sum below, so it doesn't mask every other check on the same graph.
      errors.push({
        code: "unsupported-node-type",
        message: `node ${node.id} has type "${node.type}"${node.tier !== undefined ? ` tier ${node.tier}` : ""}, which ruleset ${ruleset.version} does not know how to cost`,
        nodeId: node.id,
      });
    }
  }
  if (totalCost > tierConfig.defenseBudgetPoints) {
    errors.push({
      code: "budget-exceeded",
      message: `defense node cost ${totalCost} exceeds account tier ${accountTier} budget of ${tierConfig.defenseBudgetPoints}`,
    });
  }

  if (graph.coreHp !== tierConfig.coreHp) {
    errors.push({
      code: "core-hp-mismatch",
      message: `coreHp ${graph.coreHp} does not match account tier ${accountTier}'s fixed Core HP of ${tierConfig.coreHp} (RULESET.md §5.2 — not player-adjustable)`,
    });
  }

  return { valid: errors.length === 0, errors };
}
