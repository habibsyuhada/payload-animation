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
export interface DefenseNodeCatalogEntry {
  readonly type: Exclude<DefenseNodeType, "entry" | "core">;
  readonly label: string;
  readonly tiered: boolean;
  readonly color: string;
}

export const PLACEABLE_NODE_CATALOG: readonly DefenseNodeCatalogEntry[] = [
  { type: "router", label: "Router", tiered: false, color: "#5b6478" },
  { type: "firewall", label: "Firewall", tiered: true, color: "#e0555a" },
  { type: "ice-sentry", label: "ICE Sentry", tiered: true, color: "#5ac8e6" },
  { type: "honeypot", label: "Honeypot", tiered: true, color: "#e0c15a" },
  { type: "scanner", label: "Scanner", tiered: true, color: "#b05ae0" },
  { type: "trap", label: "Trap Node", tiered: true, color: "#e05a9c" },
];

export const ENTRY_COLOR = "#7fd8a0";
export const CORE_COLOR = "#ffd75a";

export function findPlaceableEntry(type: Exclude<DefenseNodeType, "entry" | "core">): DefenseNodeCatalogEntry {
  const entry = PLACEABLE_NODE_CATALOG.find((candidate) => candidate.type === type);
  if (!entry) {
    throw new Error(`defenseNodeCatalog: no catalog entry for ${type}`);
  }
  return entry;
}
