import { describe, expect, it } from "vitest";
import { RULESET_V2, SHEET_EVENT_ROW_KB_V2, getActionWeightKb, getConditionWeightKb } from "../src/ruleset-v2.js";
import { countSheetEvents, sheetDepth, sheetHasMovementAction, sheetWeightKb, validateVirusProgram, walkSheet } from "../src/sheet.js";
import type { SheetEvent, VirusProgram } from "../src/types.js";

function row(partial: Partial<SheetEvent> = {}): SheetEvent {
  return { conditions: [], actions: [], children: [], ...partial };
}

const MOVER: VirusProgram = { events: [row({ actions: [{ kind: "move-toward-core" }] })] };

describe("walkSheet", () => {
  it("visits depth-first, top to bottom — the same order the engine evaluates in", () => {
    const program: VirusProgram = {
      events: [row({ children: [row(), row({ children: [row()] })] }), row()],
    };
    expect(walkSheet(program.events).map((visit) => visit.path)).toEqual(["0", "0.0", "0.1", "0.1.0", "1"]);
  });

  it("reports depth as the indent level, counting from 0 at the root", () => {
    const program: VirusProgram = { events: [row({ children: [row({ children: [row()] })] })] };
    expect(walkSheet(program.events).map((visit) => visit.depth)).toEqual([0, 1, 2]);
    expect(sheetDepth(program)).toBe(3);
    expect(countSheetEvents(program)).toBe(3);
  });
});

describe("sheetWeightKb", () => {
  it("charges every condition, every action, and one structural weight per row", () => {
    const program: VirusProgram = {
      events: [row({ conditions: [{ kind: "node-here-is" }], actions: [{ kind: "brute-force", tier: 1 }] })],
    };
    expect(sheetWeightKb(program)).toBe(SHEET_EVENT_ROW_KB_V2 + getConditionWeightKb("node-here-is") + getActionWeightKb("brute-force", 1));
  });

  it("charges nested rows the same as root rows — nesting itself is free (ADR 0006 §5)", () => {
    const nested: VirusProgram = { events: [row({ children: [row({ actions: [{ kind: "hold-position" }] })] })] };
    const flat: VirusProgram = { events: [row(), row({ actions: [{ kind: "hold-position" }] })] };
    expect(sheetWeightKb(nested)).toBe(sheetWeightKb(flat));
  });

  it("prices ten one-line rules above one rule with ten actions", () => {
    const spread: VirusProgram = { events: Array.from({ length: 10 }, () => row({ actions: [{ kind: "brute-force", tier: 1 }] })) };
    const packed: VirusProgram = { events: [row({ actions: Array.from({ length: 10 }, () => ({ kind: "brute-force" as const, tier: 1 as const })) })] };
    expect(sheetWeightKb(spread)).toBeGreaterThan(sheetWeightKb(packed));
  });
});

describe("validateVirusProgram", () => {
  it("accepts a plain mover and reports its cost", () => {
    const result = validateVirusProgram(MOVER, RULESET_V2, 1);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.eventCount).toBe(1);
    expect(result.weightKb).toBe(SHEET_EVENT_ROW_KB_V2 + getActionWeightKb("move-toward-core"));
  });

  it("rejects a sheet nested deeper than 3 levels", () => {
    const tooDeep: VirusProgram = { events: [row({ children: [row({ children: [row({ children: [row()] })] })] })] };
    const result = validateVirusProgram(tooDeep, RULESET_V2, 1);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("too-deep");
    expect(result.errors.find((error) => error.code === "too-deep")?.path).toBe("0.0.0.0");
  });

  it("rejects more rows than the account tier allows, counting nested rows", () => {
    const many: VirusProgram = { events: Array.from({ length: 13 }, () => row()) };
    expect(validateVirusProgram(many, RULESET_V2, 1).errors.map((error) => error.code)).toContain("too-many-events");
    // Tier 2 pays for the headroom.
    expect(validateVirusProgram(many, RULESET_V2, 2).errors.map((error) => error.code)).not.toContain("too-many-events");
  });

  it("rejects a sheet over the payload budget", () => {
    const heavy: VirusProgram = { events: Array.from({ length: 4 }, () => row({ actions: [{ kind: "brute-force", tier: 3 }] })) };
    expect(validateVirusProgram(heavy, RULESET_V2, 1).errors.map((error) => error.code)).toContain("payload-budget-exceeded");
  });

  it("rejects an out-of-range integrity threshold", () => {
    const bad: VirusProgram = { events: [row({ conditions: [{ kind: "integrity-below", integrityThresholdPermille: 1500 }] })] };
    expect(validateVirusProgram(bad, RULESET_V2, 1).errors.map((error) => error.code)).toContain("invalid-threshold");
  });

  it("warns — but does not block — a sheet that never moves (ADR 0006's beginner trap)", () => {
    const parked: VirusProgram = { events: [row({ actions: [{ kind: "brute-force", tier: 1 }] })] };
    const result = validateVirusProgram(parked, RULESET_V2, 1);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("no-movement-action");
    expect(sheetHasMovementAction(parked)).toBe(false);
  });

  it("warns on an empty sheet and on a row that does nothing at all", () => {
    expect(validateVirusProgram({ events: [] }, RULESET_V2, 1).warnings.map((warning) => warning.code)).toContain("empty-sheet");
    const withDeadRow: VirusProgram = { events: [row({ actions: [{ kind: "move-toward-core" }] }), row()] };
    expect(validateVirusProgram(withDeadRow, RULESET_V2, 1).warnings.map((warning) => warning.code)).toContain("unreachable-row");
  });
});
