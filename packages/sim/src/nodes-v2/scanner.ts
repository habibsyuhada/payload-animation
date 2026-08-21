import { getScannerConfigV2 } from "../ruleset-v2.js";
import type { DefenseNodeType } from "../types.js";

/** Scanner — Aura class: while a virus is within radius, it holds "scanned" status for a duration, boosting ICE Sentry accuracy against it (RULESET.md §5.1). */
export const NODE_TYPE: DefenseNodeType = "scanner";

export { getScannerConfigV2 };
