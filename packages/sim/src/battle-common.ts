import { hopDistance } from "./graph.js";
import type { BlockTier, DefenseGraph, DefenseNode } from "./types.js";

/**
 * Graph lookups both engines need. Pure functions of (graph, ids) only — anything that touches
 * battle state stays inside the engine that owns it, so the frozen v1 engine cannot be changed by
 * a v2 edit here.
 */

export interface NodeLocation {
  readonly kind: "node";
  readonly nodeId: number;
}

export interface EdgeLocation {
  readonly kind: "edge";
  readonly from: number;
  readonly to: number;
  readonly remainingTicks: number;
}

export type VirusLocation = NodeLocation | EdgeLocation;

export function findNode(graph: DefenseGraph, id: number): DefenseNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`simulate(): no node with id ${id}`);
  }
  return node;
}

export function requireTier(node: DefenseNode): BlockTier {
  if (node.tier === undefined) {
    throw new Error(`simulate(): node ${node.id} (${node.type}) has no tier — validate before simulating`);
  }
  return node.tier;
}

export function findEdgeLength(graph: DefenseGraph, a: number, b: number): number {
  const edge = graph.edges.find((candidate) => (candidate.from === a && candidate.to === b) || (candidate.from === b && candidate.to === a));
  if (!edge) {
    throw new Error(`simulate(): no edge between node ${a} and node ${b}`);
  }
  return edge.lengthDu;
}

/** A virus crossing an edge is in range of either endpoint's radius — it is physically between them. */
export function isVirusInRange(graph: DefenseGraph, fromNodeId: number, radiusHops: number, location: VirusLocation): boolean {
  if (location.kind === "node") {
    const distance = hopDistance(graph, fromNodeId, location.nodeId);
    return distance !== null && distance <= radiusHops;
  }
  const distanceFrom = hopDistance(graph, fromNodeId, location.from);
  const distanceTo = hopDistance(graph, fromNodeId, location.to);
  return (distanceFrom !== null && distanceFrom <= radiusHops) || (distanceTo !== null && distanceTo <= radiusHops);
}

export function neighborsOf(graph: DefenseGraph, nodeId: number): number[] {
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
