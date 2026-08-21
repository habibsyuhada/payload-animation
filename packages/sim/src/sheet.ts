import {
  getActionSpec,
  getActionWeightKb,
  getConditionWeightKb,
  MAX_SHEET_DEPTH_V2,
  SHEET_EVENT_ROW_KB_V2,
} from "./ruleset-v2.js";
import { getAccountTierConfig } from "./ruleset.js";
import type { AccountTierConfig, Ruleset, SheetEvent, VirusProgram } from "./types.js";

/**
 * Sheet shape: walking it, pricing it, and validating it. Deliberately separate from the engine —
 * the Virus Lab needs every one of these before a battle exists, and the engine needs none of the
 * pricing.
 */

export interface SheetEventVisit {
  readonly event: SheetEvent;
  /** Row address in the sheet, "2.0.1" style. The engine logs this as `rule-fired`'s actor when
   * an event carries no explicit id, so a row can always be pointed at without the author naming it. */
  readonly path: string;
  /** 0 for a root row. */
  readonly depth: number;
}

/** Depth-first, top to bottom — the order the engine evaluates in, so anything built on this walk (pricing, validation, the editor's row list) agrees with what actually runs. */
export function walkSheet(events: readonly SheetEvent[], prefix = ""): SheetEventVisit[] {
  const visits: SheetEventVisit[] = [];
  events.forEach((event, index) => {
    const path = prefix === "" ? String(index) : `${prefix}.${index}`;
    const depth = path.split(".").length - 1;
    visits.push({ event, path, depth });
    visits.push(...walkSheet(event.children, path));
  });
  return visits;
}

/** The id a `rule-fired` event carries for this row: the author's own id when they set one, else the row's path. */
export function sheetEventId(visit: SheetEventVisit): string {
  return visit.event.id ?? visit.path;
}

/** Every row, nested rows included — what the per-tier event cap counts. */
export function countSheetEvents(program: VirusProgram): number {
  return walkSheet(program.events).length;
}

/** 1 for a flat sheet, 3 for the deepest one v2 allows. 0 for an empty sheet. */
export function sheetDepth(program: VirusProgram): number {
  return walkSheet(program.events).reduce((deepest, visit) => Math.max(deepest, visit.depth + 1), 0);
}

/**
 * Payload cost in KB: every condition, every action, plus a structural weight per row
 * (ADR 0006 §5). Nesting is free — indent is a readability tool, not a resource.
 */
export function sheetWeightKb(program: VirusProgram): number {
  let total = 0;
  for (const { event } of walkSheet(program.events)) {
    total += SHEET_EVENT_ROW_KB_V2;
    for (const condition of event.conditions) {
      total += getConditionWeightKb(condition.kind, condition.tier ?? 1);
    }
    for (const action of event.actions) {
      total += getActionWeightKb(action.kind, action.tier ?? 1);
    }
  }
  return total;
}

/** True if any row can write the movement slot — the sheet moves at all. */
export function sheetHasMovementAction(program: VirusProgram): boolean {
  return walkSheet(program.events).some(({ event }) => event.actions.some((action) => getActionSpec(action.kind).slot === "movement"));
}

/**
 * True if any row anywhere in the sheet contains a `worm-split` action — decided once, before
 * tick 0 (PLAN.md 8.3b, ADR 0008), and used as the static gate for whether `BattleEvent.entityId`
 * is written at all. A sheet's event shape must not depend on whether a split actually happens
 * later in a given battle, only on whether the sheet *can* split.
 */
export function sheetCanSplit(program: VirusProgram): boolean {
  return walkSheet(program.events).some(({ event }) => event.actions.some((action) => action.kind === "worm-split"));
}

export type ProgramValidationErrorCode = "too-deep" | "too-many-events" | "payload-budget-exceeded" | "unknown-kind" | "invalid-threshold";
export type ProgramValidationWarningCode = "no-movement-action" | "empty-sheet" | "unreachable-row";

export interface ProgramValidationIssue {
  readonly code: ProgramValidationErrorCode | ProgramValidationWarningCode;
  readonly message: string;
  /** The offending row's path, when the issue is about one row. */
  readonly path?: string;
}

export interface ProgramValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ProgramValidationIssue[];
  /** Things the editor should say out loud without refusing to save — ADR 0006's "beginner trap" list. */
  readonly warnings: readonly ProgramValidationIssue[];
  readonly weightKb: number;
  readonly eventCount: number;
}

/**
 * Enforces the three v2 caps (nesting depth, event count per account tier, payload KB budget) and
 * reports the traps ADR 0006 asks the editor to warn about rather than block: a sheet that never
 * moves is legal and parks the virus until timeout, and a child row under a parent that can never
 * hold is dead weight the player is still paying for.
 */
export function validateVirusProgram(program: VirusProgram, ruleset: Ruleset, accountTier: AccountTierConfig["tier"]): ProgramValidationResult {
  const errors: ProgramValidationIssue[] = [];
  const warnings: ProgramValidationIssue[] = [];
  const visits = walkSheet(program.events);
  const tierConfig = getAccountTierConfig(ruleset, accountTier);

  for (const visit of visits) {
    if (visit.depth + 1 > MAX_SHEET_DEPTH_V2) {
      errors.push({ code: "too-deep", message: `baris ${visit.path} bersarang ${visit.depth + 1} level, maksimum ${MAX_SHEET_DEPTH_V2}`, path: visit.path });
    }
    for (const condition of visit.event.conditions) {
      const threshold = condition.integrityThresholdPermille;
      if (threshold !== undefined && (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000)) {
        errors.push({ code: "invalid-threshold", message: `baris ${visit.path}: threshold ${threshold}‰ di luar 0–1000‰`, path: visit.path });
      }
    }
    if (visit.event.conditions.length === 0 && visit.event.actions.length === 0 && visit.event.children.length === 0) {
      warnings.push({ code: "unreachable-row", message: `baris ${visit.path} kosong — tidak melakukan apa pun tapi tetap dihitung`, path: visit.path });
    }
  }

  const maxEvents = tierConfig.maxSheetEvents;
  if (maxEvents !== undefined && visits.length > maxEvents) {
    errors.push({ code: "too-many-events", message: `${visits.length} baris melebihi batas ${maxEvents} baris untuk account tier ${accountTier}` });
  }

  const weightKb = sheetWeightKb(program);
  if (weightKb > tierConfig.payloadBudgetKb) {
    errors.push({ code: "payload-budget-exceeded", message: `payload ${weightKb} KB melebihi budget ${tierConfig.payloadBudgetKb} KB (account tier ${accountTier})` });
  }

  if (visits.length === 0) {
    warnings.push({ code: "empty-sheet", message: "sheet kosong — virus tidak akan melakukan apa pun" });
  } else if (!sheetHasMovementAction(program)) {
    warnings.push({ code: "no-movement-action", message: "tidak ada aksi gerak — virus diam di Entry sampai battle timeout" });
  }

  return { valid: errors.length === 0, errors, warnings, weightKb, eventCount: visits.length };
}
