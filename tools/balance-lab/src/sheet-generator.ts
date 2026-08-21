import {
  ACTION_SPECS_V2,
  CONDITION_SPECS_V2,
  FLAG_COUNT_V2,
  MIN_EVERY_N_TICKS_V2,
  RULESET_V2,
  SHEET_EVENT_ROW_KB_V2,
  createRng,
  getAccountTierConfig,
  getActionWeightKb,
  getConditionWeightKb,
  sheetWeightKb,
  validateVirusProgram,
} from "@payload/sim";
import type { AccountTierConfig, ActionKind, BlockTier, ConditionKind, DefenseNodeType, Rng, SheetAction, SheetCondition, SheetEvent, VirusProgram } from "@payload/sim";
import type { VirusArchetype } from "./archetypes.js";

/**
 * V7.4: a seeded random-sheet generator.
 *
 * ADR 0006 §10 makes this a release prerequisite, and the reason is arithmetic: v1 had 12 blocks
 * in a flat chain, v2 has 9 conditions x 12 actions x 3 tiers x nesting, which is far past what
 * five hand-written archetypes can cover. The point of generating builds is not to find good
 * ones — it is to find the build nobody thought to write, before a player does (RULESET.md §9's
 * "ICE Nest" was exactly that, found by a tool and not by a designer).
 *
 * Two deliberate biases, both documented because they narrow what the search can find:
 *
 * 1. **Every generated sheet ends with a movement fallback row.** A sheet with no movement action
 *    parks the virus until timeout — legal, and already covered by an explicit engine test, but a
 *    generator that produced them at random would spend most of its budget re-measuring "a virus
 *    that never moves loses".
 * 2. **Generation is budget-greedy, not uniform.** Rows are added while the payload budget has
 *    room, so the population skews toward builds that actually spend their KB — which is where
 *    dominance lives.
 */

const CONDITION_KINDS: readonly ConditionKind[] = CONDITION_SPECS_V2.map((spec) => spec.kind);
const ACTION_KINDS: readonly ActionKind[] = ACTION_SPECS_V2.map((spec) => spec.kind);
const MOVEMENT_KINDS: readonly ActionKind[] = ACTION_SPECS_V2.filter((spec) => spec.category === "movement" && spec.kind !== "hold-position").map((spec) => spec.kind);
// PLAN.md 8.8: the full v2 target-able set (RULESET.md §14) — everything a sheet might name in
// `node-here-is`/`node-ahead-is`/`move-toward-node-type`, minus `entry` (never a useful target).
const NODE_TYPES: readonly DefenseNodeType[] = ["firewall", "ice-sentry", "honeypot", "scanner", "trap", "router", "core", "patch-server", "tarpit", "jammer", "turnstile", "alarm"];
const TIERS: readonly BlockTier[] = [1, 2, 3];
const ONCE_SCOPES: readonly (SheetEvent["once"] | undefined)[] = [undefined, undefined, undefined, "battle", "node", "arrival"];

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.nextInt(items.length)]!;
}

function randomCondition(rng: Rng): SheetCondition {
  const kind = pick(rng, CONDITION_KINDS);
  return {
    kind,
    // NOT on roughly a quarter of conditions — common enough to be explored, rare enough that
    // most generated rules still read the obvious way round.
    ...(rng.nextInt(4) === 0 ? { negate: true } : {}),
    ...(kind === "honeypot-near" || kind === "trap-near" || kind === "ice-near" || kind === "scanner-near" ? { tier: pick(rng, TIERS) } : {}),
    ...(kind === "node-here-is" || kind === "node-ahead-is" ? { targetNodeTypes: [pick(rng, NODE_TYPES)] } : {}),
    ...(kind === "integrity-below" ? { integrityThresholdPermille: (rng.nextInt(17) + 2) * 50 } : {}),
    // PLAN.md 8.4/8.8 — parameters the v1-era generator never had to cover.
    ...(kind === "core-within-hops" ? { hops: rng.nextInt(5) + 1 } : {}),
    ...(kind === "core-hp-below" || kind === "node-hp-below" ? { thresholdPermille: (rng.nextInt(17) + 2) * 50 } : {}),
    ...(kind === "tick-after" ? { ticks: (rng.nextInt(20) + 1) * 25 } : {}),
    ...(kind === "every-n-ticks" ? { ticks: MIN_EVERY_N_TICKS_V2 + rng.nextInt(20) * 5 } : {}),
    ...(kind === "flag-is" ? { flagIndex: rng.nextInt(FLAG_COUNT_V2) } : {}),
    ...(kind === "entity-count-below" ? { count: rng.nextInt(2) + 2 } : {}),
  };
}

function randomAction(rng: Rng): SheetAction {
  const kind = pick(rng, ACTION_KINDS);
  return {
    kind,
    tier: pick(rng, TIERS),
    ...(kind === "move-toward-node-type" ? { targetNodeTypes: [pick(rng, NODE_TYPES)] } : {}),
    ...(kind === "set-flag" ? { flagIndex: rng.nextInt(FLAG_COUNT_V2), flagValue: rng.nextInt(2) === 0 } : {}),
  };
}

function conditionCost(condition: SheetCondition): number {
  return getConditionWeightKb(condition.kind, condition.tier ?? 1);
}

function actionCost(action: SheetAction): number {
  return getActionWeightKb(action.kind, action.tier ?? 1);
}

interface GeneratorLimits {
  readonly budgetKb: number;
  readonly maxEvents: number;
}

/** Fills one row, spending only what's left of the budget. Returns null if even an empty row doesn't fit. */
function randomRow(rng: Rng, remainingKb: number): { readonly row: SheetEvent; readonly costKb: number } | null {
  if (remainingKb < SHEET_EVENT_ROW_KB_V2) {
    return null;
  }
  let spent = SHEET_EVENT_ROW_KB_V2;
  const conditions: SheetCondition[] = [];
  const actions: SheetAction[] = [];

  const conditionCount = rng.nextInt(3);
  for (let i = 0; i < conditionCount; i += 1) {
    const condition = randomCondition(rng);
    const cost = conditionCost(condition);
    if (spent + cost > remainingKb) {
      break;
    }
    spent += cost;
    conditions.push(condition);
  }

  const actionCount = rng.nextInt(3) + 1;
  for (let i = 0; i < actionCount; i += 1) {
    const action = randomAction(rng);
    const cost = actionCost(action);
    if (spent + cost > remainingKb) {
      break;
    }
    spent += cost;
    actions.push(action);
  }

  const once = pick(rng, ONCE_SCOPES);
  return {
    row: { conditions, actions, children: [], ...(once !== undefined ? { once } : {}) },
    costKb: spent,
  };
}

/** The fallback row every generated sheet ends with — see bias 1 in this module's docstring. */
function movementFallbackRow(rng: Rng): { readonly row: SheetEvent; readonly costKb: number } {
  const kind = pick(rng, MOVEMENT_KINDS);
  return { row: { conditions: [], actions: [{ kind }], children: [] }, costKb: SHEET_EVENT_ROW_KB_V2 + getActionWeightKb(kind) };
}

/**
 * One random sheet within the tier's payload budget and event cap. Rows nest under the previous
 * row about a third of the time (never past the depth cap), so the population contains real trees
 * and not just flat lists.
 */
export function generateSheet(rng: Rng, limits: GeneratorLimits): VirusProgram {
  const fallback = movementFallbackRow(rng);
  let remaining = limits.budgetKb - fallback.costKb;
  const roots: SheetEvent[] = [];
  // The path of ancestors we may still nest under, deepest last.
  let openBranch: SheetEvent[] = [];
  let rowCount = 1;

  while (rowCount < limits.maxEvents) {
    const generated = randomRow(rng, remaining);
    if (!generated) {
      break;
    }
    remaining -= generated.costKb;
    rowCount += 1;

    const parent = openBranch.length > 0 && openBranch.length < 3 && rng.nextInt(3) === 0 ? openBranch[openBranch.length - 1] : undefined;
    if (parent) {
      (parent.children as SheetEvent[]).push(generated.row);
      openBranch = [...openBranch, generated.row];
    } else {
      roots.push(generated.row);
      openBranch = [generated.row];
    }
  }

  return { events: [...roots, fallback.row] };
}

export interface GeneratedVirus extends VirusArchetype {
  readonly weightKb: number;
}

/**
 * A population of `count` generated sheets, named by their generation index so a flagged build in
 * the report can be reproduced exactly from (seed, index). Any sheet the v2 validator rejects is
 * discarded rather than silently repaired — the generator has to respect the same rules the
 * editor enforces, or the search would report dominance a player cannot actually build.
 */
export function generatePopulation(seed: number, count: number, accountTier: AccountTierConfig["tier"] = 1): GeneratedVirus[] {
  const rng = createRng(seed);
  const tierConfig = getAccountTierConfig(RULESET_V2, accountTier);
  const limits: GeneratorLimits = { budgetKb: tierConfig.payloadBudgetKb, maxEvents: tierConfig.maxSheetEvents ?? 12 };
  const population: GeneratedVirus[] = [];
  let attempts = 0;
  // A generous attempt ceiling rather than a while(true): a validator change that started
  // rejecting everything must fail loudly and finitely, not hang CI.
  while (population.length < count && attempts < count * 20) {
    attempts += 1;
    const virus = generateSheet(rng, limits);
    if (!validateVirusProgram(virus, RULESET_V2, accountTier).valid) {
      continue;
    }
    population.push({
      name: `Gen#${population.length + 1}`,
      description: describeSheet(virus),
      virus,
      weightKb: sheetWeightKb(virus),
    });
  }
  if (population.length < count) {
    throw new Error(`generatePopulation: only ${population.length}/${count} generated sheets passed validation in ${attempts} attempts`);
  }
  return population;
}

/** A one-line rendering of a sheet, so a flagged generated build is readable in the report. */
export function describeSheet(virus: VirusProgram, indent = ""): string {
  return virus.events
    .map((event) => {
      const conditions = event.conditions.length === 0 ? "selalu" : event.conditions.map((condition) => `${condition.negate ? "!" : ""}${condition.kind}`).join(" & ");
      const actions = event.actions.map((action) => `${action.kind}${action.tier && action.tier > 1 ? `.${action.tier}` : ""}`).join(", ") || "-";
      const once = event.once ? ` (once:${event.once})` : "";
      const children = event.children.length > 0 ? ` { ${describeSheet({ events: event.children }, `${indent}  `)} }` : "";
      return `[${conditions}] -> ${actions}${once}${children}`;
    })
    .join("; ");
}
