import { MAX_SHEET_DEPTH_V2, type ActionKind, type BlockTier, type ConditionKind, type DefenseNodeType, type OnceScope, type SheetEvent, type VirusProgram } from "@payload/sim";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { highestIdSuffix, persistStorage, storageKey } from "./localPersist.js";
import { conditionIsTiered } from "../data/sheetCatalog.js";

/**
 * virusLabStore.ts — V7.3: the editable form of a ruleset v2 event sheet.
 *
 * The stored tree is deliberately NOT a `VirusProgram`: every row, condition and action carries a
 * stable instance id so React keys and "which row did I just tap" survive edits, and optional
 * params are always present rather than absent. `toVirusProgram()` is the one place that strips
 * that back down to the sim's contract, so an id can never leak into a BattleLog and change a
 * replay's bytes.
 *
 * v1's drag-to-reorder chain does not survive (ADR 0006 §9): everything here is tap-driven, and
 * order is changed with explicit up/down buttons that work the same under a thumb.
 *
 * The sheet is persisted to the device (localPersist.ts): a virus somebody spent ten minutes
 * writing has to still be there after a refresh.
 */

export interface ConditionInstance {
  readonly id: string;
  readonly kind: ConditionKind;
  readonly negate: boolean;
  readonly tier: BlockTier;
  readonly targetNodeType: DefenseNodeType;
  readonly integrityThresholdPermille: number;
}

export interface ActionInstance {
  readonly id: string;
  readonly kind: ActionKind;
  readonly tier: BlockTier;
}

export interface RowInstance {
  readonly id: string;
  readonly conditions: readonly ConditionInstance[];
  readonly actions: readonly ActionInstance[];
  readonly children: readonly RowInstance[];
  readonly once: OnceScope | null;
}

export interface VirusLabState {
  readonly rows: readonly RowInstance[];
  readonly addRow: (parentId: string | null) => void;
  readonly removeRow: (rowId: string) => void;
  readonly moveRow: (rowId: string, direction: "up" | "down") => void;
  readonly setRowOnce: (rowId: string, once: OnceScope | null) => void;
  readonly addCondition: (rowId: string, kind: ConditionKind) => void;
  readonly removeCondition: (rowId: string, conditionId: string) => void;
  readonly updateCondition: (rowId: string, conditionId: string, patch: Partial<Omit<ConditionInstance, "id" | "kind">>) => void;
  readonly addAction: (rowId: string, kind: ActionKind) => void;
  readonly removeAction: (rowId: string, actionId: string) => void;
  readonly moveAction: (rowId: string, actionId: string, direction: "up" | "down") => void;
  readonly setActionTier: (rowId: string, actionId: string, tier: BlockTier) => void;
  readonly reset: () => void;
}

let nextInstanceId = 0;
function newInstanceId(prefix: string): string {
  nextInstanceId += 1;
  return `${prefix}-${nextInstanceId}`;
}

/** See localPersist.ts: a restored sheet's ids must not be handed out a second time. */
function adoptRestoredIds(rows: readonly RowInstance[]): void {
  nextInstanceId = Math.max(nextInstanceId, highestIdSuffix(allInstanceIds(rows)));
}

export function newRow(partial: Partial<Omit<RowInstance, "id">> = {}): RowInstance {
  return { id: newInstanceId("row"), conditions: [], actions: [], children: [], once: null, ...partial };
}

export function newCondition(kind: ConditionKind): ConditionInstance {
  return { id: newInstanceId("cond"), kind, negate: false, tier: 1, targetNodeType: "firewall", integrityThresholdPermille: 500 };
}

export function newAction(kind: ActionKind): ActionInstance {
  return { id: newInstanceId("act"), kind, tier: 1 };
}

/**
 * ADR 0006's answer to the "sheet with no movement action" beginner trap: a new lab starts with
 * the fallback row already written, so the first thing a player sees is a virus that at least
 * walks — and the shape of a rule.
 */
function starterSheet(): RowInstance[] {
  return [newRow({ actions: [newAction("move-toward-core")] })];
}

/** Depth-first map over the tree; `mutate` returns the replacement for the row it matched. */
function mapRow(rows: readonly RowInstance[], rowId: string, mutate: (row: RowInstance) => RowInstance): RowInstance[] {
  return rows.map((row) => (row.id === rowId ? mutate(row) : { ...row, children: mapRow(row.children, rowId, mutate) }));
}

function removeRowFrom(rows: readonly RowInstance[], rowId: string): RowInstance[] {
  return rows.filter((row) => row.id !== rowId).map((row) => ({ ...row, children: removeRowFrom(row.children, rowId) }));
}

/** Sibling-only reorder: a row never changes parent by moving, which keeps indent stable while a thumb taps ↑/↓. */
function moveWithinSiblings<T extends { readonly id: string }>(items: readonly T[], id: string, direction: "up" | "down"): T[] | null {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) {
    return items as T[];
  }
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

function moveRowIn(rows: readonly RowInstance[], rowId: string, direction: "up" | "down"): RowInstance[] {
  const reordered = moveWithinSiblings(rows, rowId, direction);
  if (reordered) {
    return reordered;
  }
  return rows.map((row) => ({ ...row, children: moveRowIn(row.children, rowId, direction) }));
}

export function rowDepth(rows: readonly RowInstance[], rowId: string, depth = 0): number | null {
  for (const row of rows) {
    if (row.id === rowId) {
      return depth;
    }
    const found = rowDepth(row.children, rowId, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** True when a child row may still be nested under this one (ADR 0006 §2: root + 2 levels). */
export function canNestUnder(rows: readonly RowInstance[], rowId: string): boolean {
  const depth = rowDepth(rows, rowId);
  return depth !== null && depth + 2 <= MAX_SHEET_DEPTH_V2;
}

function addRowUnder(rows: readonly RowInstance[], parentId: string): RowInstance[] {
  return mapRow(rows, parentId, (row) => ({ ...row, children: [...row.children, newRow()] }));
}

/** Every instance id in a sheet, so a restored sheet can push the id counter past all of them. */
function allInstanceIds(rows: readonly RowInstance[]): string[] {
  return rows.flatMap((row) => [row.id, ...row.conditions.map((condition) => condition.id), ...row.actions.map((action) => action.id), ...allInstanceIds(row.children)]);
}

export const useVirusLabStore = create<VirusLabState>()(
  persist(
    (set) => ({
      rows: starterSheet(),

      addRow: (parentId) =>
        set((state) => {
          if (parentId === null) {
            return { rows: [...state.rows, newRow()] };
          }
          if (!canNestUnder(state.rows, parentId)) {
            return state;
          }
          return { rows: addRowUnder(state.rows, parentId) };
        }),

      removeRow: (rowId) => set((state) => ({ rows: removeRowFrom(state.rows, rowId) })),

      moveRow: (rowId, direction) => set((state) => ({ rows: moveRowIn(state.rows, rowId, direction) })),

      setRowOnce: (rowId, once) => set((state) => ({ rows: mapRow(state.rows, rowId, (row) => ({ ...row, once })) })),

      addCondition: (rowId, kind) => set((state) => ({ rows: mapRow(state.rows, rowId, (row) => ({ ...row, conditions: [...row.conditions, newCondition(kind)] })) })),

      removeCondition: (rowId, conditionId) =>
        set((state) => ({ rows: mapRow(state.rows, rowId, (row) => ({ ...row, conditions: row.conditions.filter((condition) => condition.id !== conditionId) })) })),

      updateCondition: (rowId, conditionId, patch) =>
        set((state) => ({
          rows: mapRow(state.rows, rowId, (row) => ({
            ...row,
            conditions: row.conditions.map((condition) => (condition.id === conditionId ? { ...condition, ...patch } : condition)),
          })),
        })),

      addAction: (rowId, kind) => set((state) => ({ rows: mapRow(state.rows, rowId, (row) => ({ ...row, actions: [...row.actions, newAction(kind)] })) })),

      removeAction: (rowId, actionId) => set((state) => ({ rows: mapRow(state.rows, rowId, (row) => ({ ...row, actions: row.actions.filter((action) => action.id !== actionId) })) })),

      moveAction: (rowId, actionId, direction) =>
        set((state) => ({ rows: mapRow(state.rows, rowId, (row) => ({ ...row, actions: moveWithinSiblings(row.actions, actionId, direction) ?? row.actions })) })),

      setActionTier: (rowId, actionId, tier) =>
        set((state) => ({ rows: mapRow(state.rows, rowId, (row) => ({ ...row, actions: row.actions.map((action) => (action.id === actionId ? { ...action, tier } : action)) })) })),

      reset: () => set({ rows: starterSheet() }),
    }),
    {
      name: storageKey("virus-lab"),
      version: 1,
      storage: persistStorage,
      /** Nothing to migrate from yet. When the row shape changes, the real conversion goes here —
       * falling back to the starter sheet is the safety net for a version we cannot read, which
       * beats rehydrating a shape the editor will crash on. */
      migrate: () => ({ rows: starterSheet() }),
      /** Only the authored sheet. The actions are rebuilt on every load, and persisting them
       * would serialise functions to `null` and quietly break the store on the next launch. */
      partialize: (state) => ({ rows: state.rows }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          adoptRestoredIds(state.rows);
        }
      },
    },
  ),
);

function toSheetCondition(condition: ConditionInstance): SheetEvent["conditions"][number] {
  return {
    kind: condition.kind,
    ...(condition.negate ? { negate: true } : {}),
    ...(conditionIsTiered(condition.kind) ? { tier: condition.tier } : {}),
    ...(condition.kind === "node-here-is" || condition.kind === "node-ahead-is" ? { targetNodeTypes: [condition.targetNodeType] } : {}),
    ...(condition.kind === "integrity-below" ? { integrityThresholdPermille: condition.integrityThresholdPermille } : {}),
  };
}

function toSheetEvent(row: RowInstance): SheetEvent {
  return {
    conditions: row.conditions.map(toSheetCondition),
    actions: row.actions.map((action) => ({ kind: action.kind, tier: action.tier })),
    children: row.children.map(toSheetEvent),
    ...(row.once !== null ? { once: row.once } : {}),
  };
}

/**
 * The editor tree, stripped of everything the sim doesn't need. Notably it does NOT emit a
 * `SheetEvent.id`: instance ids are counter-based and would differ between two sessions that
 * built the identical sheet, which would show up as differing bytes in a BattleLog whose whole
 * value is being reproducible. The engine falls back to the row's path, and `rowIdByRulePath()`
 * maps that back for highlighting.
 */
export function toVirusProgram(rows: readonly RowInstance[]): VirusProgram {
  return { events: rows.map(toSheetEvent) };
}

/**
 * Row path ("1.0") -> editor row id, in the same depth-first order the engine addresses rows by.
 * This is what turns a `rule-fired` log event back into "light up THIS card".
 */
export function rowIdByRulePath(rows: readonly RowInstance[], prefix = "", into = new Map<string, string>()): Map<string, string> {
  rows.forEach((row, index) => {
    const path = prefix === "" ? String(index) : `${prefix}.${index}`;
    into.set(path, row.id);
    rowIdByRulePath(row.children, path, into);
  });
  return into;
}
