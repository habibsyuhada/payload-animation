import type { DefenseNodeType } from "@payload/sim";

/**
 * defenseNodeCatalog.ts — C3.3: display data for Defense Grid's palette. Node COSTS themselves
 * come straight from `getDefenseNodeCost()` (@payload/sim/ruleset.ts) rather than being mirrored
 * here — unlike blockCatalog.ts's payload weights, sim already models defense-node cost (it's
 * part of `validateDefenseGraph`'s own budget check), so there's no reason to duplicate it.
 *
 * Colors intentionally echo packages/replay/src/draw.ts's NODE_COLOR palette (same GDD node
 * taxonomy, so same visual language makes sense) but are redeclared here rather than imported —
 * the boundaries rule (eslint.config.js) forbids `app`/`ui` code reaching into `replay`'s
 * internals, and `draw.ts`'s NODE_COLOR was never exported as public API anyway.
 */
/** A silhouette a node type renders as on the grid — distinct per type so nodes read apart by
 * shape alone, not just fill color (color still carries category/faction meaning on top). */
export type NodeShape = "circle" | "diamond" | "triangle" | "triangle-down" | "square" | "hexagon" | "octagon" | "star";

export interface DefenseNodeCatalogEntry {
  readonly type: Exclude<DefenseNodeType, "entry" | "core">;
  readonly label: string;
  readonly tiered: boolean;
  readonly color: string;
  readonly shape: NodeShape;
}

export const PLACEABLE_NODE_CATALOG: readonly DefenseNodeCatalogEntry[] = [
  { type: "router", label: "Router", tiered: false, color: "#5b6478", shape: "circle" },
  { type: "firewall", label: "Firewall", tiered: true, color: "#e0555a", shape: "square" },
  { type: "ice-sentry", label: "ICE Sentry", tiered: true, color: "#5ac8e6", shape: "hexagon" },
  { type: "honeypot", label: "Honeypot", tiered: true, color: "#e0c15a", shape: "star" },
  { type: "scanner", label: "Scanner", tiered: true, color: "#b05ae0", shape: "octagon" },
  { type: "trap", label: "Trap Node", tiered: true, color: "#e05a9c", shape: "triangle-down" },
];

export const ENTRY_COLOR = "#7fd8a0";
export const CORE_COLOR = "#ffd75a";
export const ENTRY_SHAPE: NodeShape = "triangle";
export const CORE_SHAPE: NodeShape = "diamond";

export function findPlaceableEntry(type: Exclude<DefenseNodeType, "entry" | "core">): DefenseNodeCatalogEntry {
  const entry = PLACEABLE_NODE_CATALOG.find((candidate) => candidate.type === type);
  if (!entry) {
    throw new Error(`defenseNodeCatalog: no catalog entry for ${type}`);
  }
  return entry;
}
