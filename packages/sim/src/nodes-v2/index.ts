import { NODE_TYPE as ALARM_TYPE, getAlarmConfigV2 } from "./alarm.js";
import { NODE_TYPE as CORE_TYPE, resolveCoreTickV2, type CoreTickResultV2 } from "./core.js";
import { NODE_TYPE as FIREWALL_TYPE, firewallMaxHpV2, resolveFirewallTickV2, type FirewallTickResultV2 } from "./firewall.js";
import { NODE_TYPE as HONEYPOT_TYPE, honeypotIsLethalV2 } from "./honeypot.js";
import { NODE_TYPE as ICE_SENTRY_TYPE, effectiveAccuracyPermilleV2, getIceSentryConfigV2, iceSentryDamageV2, rollIceSentryHitV2 } from "./ice-sentry.js";
import { NODE_TYPE as JAMMER_TYPE, getJammerConfigV2 } from "./jammer.js";
import { NODE_TYPE as PATCH_SERVER_TYPE, getPatchServerConfigV2 } from "./patch-server.js";
import { NODE_TYPE as ROUTER_TYPE } from "./router.js";
import { NODE_TYPE as SCANNER_TYPE, getScannerConfigV2 } from "./scanner.js";
import { NODE_TYPE as TARPIT_TYPE, getTarpitConfigV2 } from "./tarpit.js";
import { NODE_TYPE as TRAP_TYPE, trapTriggerDamageV2 } from "./trap.js";
import { NODE_TYPE as TURNSTILE_TYPE, getTurnstileConfigV2 } from "./turnstile.js";
import type { DefenseNodeType } from "../types.js";

/**
 * Every module below exports its own `NODE_TYPE` binding, so a blanket `export * from "./x.js"`
 * for all twelve would be an ambiguous re-export (TS2308) — hence the explicit named re-exports
 * here instead of a wildcard barrel, exactly as nodes/index.ts's `export *` style can't do once a
 * name repeats across modules.
 */
export { getAlarmConfigV2 };
export { resolveCoreTickV2, type CoreTickResultV2 };
export { firewallMaxHpV2, resolveFirewallTickV2, type FirewallTickResultV2 };
export { honeypotIsLethalV2 };
export { effectiveAccuracyPermilleV2, getIceSentryConfigV2, iceSentryDamageV2, rollIceSentryHitV2 };
export { getJammerConfigV2 };
export { getPatchServerConfigV2 };
export { getScannerConfigV2 };
export { getTarpitConfigV2 };
export { trapTriggerDamageV2 };
export { getTurnstileConfigV2 };
// router.ts has nothing beyond NODE_TYPE to re-export, and never will (RULESET.md §5.0, no combat effect).

/**
 * Every nodes-v2/ module's type marker, collected in one place. Each module exports its own
 * `NODE_TYPE` (including e.g. router.ts, whose only other content is a docstring), which makes
 * "does nodes-v2/ have a module per v2 node type" a checkable invariant (test/nodes-v2/index.test.ts)
 * instead of a comment someone has to remember to update — this is what ADR 0007 asks for.
 */
export const V2_NODE_MODULE_TYPES: readonly DefenseNodeType[] = [
  ALARM_TYPE,
  CORE_TYPE,
  FIREWALL_TYPE,
  HONEYPOT_TYPE,
  ICE_SENTRY_TYPE,
  JAMMER_TYPE,
  PATCH_SERVER_TYPE,
  ROUTER_TYPE,
  SCANNER_TYPE,
  TARPIT_TYPE,
  TRAP_TYPE,
  TURNSTILE_TYPE,
];
