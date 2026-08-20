import {
  RULESET_V2,
  getAccountTierConfig,
  simulate,
  validateVirusProgram,
  type ActionKind,
  type BattleResult,
  type BlockTier,
  type ConditionKind,
  type DefenseNodeType,
  type OnceScope,
} from "@payload/sim";
import { useMemo, useState } from "react";
import {
  ACTION_CATALOG,
  CONDITION_CATALOG,
  CONDITION_NODE_TYPE_OPTIONS,
  actionWeightKb,
  conditionIsTiered,
  conditionWeightKb,
  findActionEntry,
  findConditionEntry,
} from "../data/sheetCatalog.js";
import { PRACTICE_DEFENSES } from "../data/practiceDefenses.js";
import { canNestUnder, toVirusProgram, useVirusLabStore, type ActionInstance, type ConditionInstance, type RowInstance } from "../state/virusLabStore.js";
import { theme } from "../theme.js";
import { Screen } from "./Screen.js";

/**
 * VirusLab — V7.3: a tap-driven event-sheet editor (ADR 0006 §9). Every edit is a tap: `+ kondisi`
 * and `+ aksi` open a picker sheet listing what's available with its KB cost, order changes with
 * explicit ↑/↓ buttons, and children indent one step. There is no free drag anywhere — v1's
 * drag-to-reorder chain is gone, because a drag is the one gesture a thumb on a 390px screen is
 * worst at (GDD §3).
 *
 * The picker is modelled on the Defend page's "Pilih Node" modal so the two screens teach the same
 * interaction once.
 */

/** No account-tier system yet (Fase 4/5) — the lab validates against tier 1, same placeholder the other screens use. */
const ACCOUNT_TIER = 1;
const TIER_CONFIG = getAccountTierConfig(RULESET_V2, ACCOUNT_TIER);
const TIER_OPTIONS: readonly BlockTier[] = [1, 2, 3];
const ROMAN_TIER: Record<BlockTier, string> = { 1: "I", 2: "II", 3: "III" };
/** A fixed seed per practice defense keeps "Simulasi Kering" reproducible run-to-run — not a real per-battle seed (that's server-assigned in Fase 4). */
const PRACTICE_SEED_BY_DEFENSE_INDEX = [101, 202, 303] as const;

const ONCE_LABEL: Record<OnceScope, string> = {
  battle: "sekali per battle",
  node: "sekali per node",
  arrival: "sekali per kedatangan",
};

/** Threshold choices for "Integrity < X%", in whole 5% steps — the range v1's tier III sold, now free. */
const THRESHOLD_OPTIONS: readonly number[] = Array.from({ length: 17 }, (_, index) => (index + 2) * 50);

function actionColor(kind: ActionKind): string {
  const category = findActionEntry(kind).category;
  return category === "movement" ? theme.faction.movement : theme.faction[category];
}

function conditionColor(kind: ConditionKind): string {
  return findConditionEntry(kind).colorCategory === "sensor" ? theme.faction.sensor : theme.faction.condition;
}

interface PickerRequest {
  readonly rowId: string;
  readonly mode: "condition" | "action";
}

function ConditionChip({ rowId, condition }: { rowId: string; condition: ConditionInstance }): JSX.Element {
  const entry = findConditionEntry(condition.kind);
  const removeCondition = useVirusLabStore((state) => state.removeCondition);
  const updateCondition = useVirusLabStore((state) => state.updateCondition);

  return (
    <li className="payload-sheet-chip" data-testid="sheet-condition" data-kind={condition.kind} style={{ borderColor: conditionColor(condition.kind) }} title={entry.summary}>
      <button
        type="button"
        className={`payload-sheet-negate${condition.negate ? " payload-sheet-negate--on" : ""}`}
        data-testid="sheet-condition-negate"
        aria-pressed={condition.negate}
        aria-label={`Balik kondisi ${entry.label}`}
        onClick={() => updateCondition(rowId, condition.id, { negate: !condition.negate })}
      >
        TIDAK
      </button>
      <span className="payload-sheet-chip-label">{entry.label}</span>
      {entry.takesNodeTypes && (
        <select
          data-testid="sheet-condition-node-type"
          aria-label={`Tipe node untuk ${entry.label}`}
          value={condition.targetNodeType}
          onChange={(event) => updateCondition(rowId, condition.id, { targetNodeType: event.target.value as DefenseNodeType })}
        >
          {CONDITION_NODE_TYPE_OPTIONS.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {entry.takesThreshold && (
        <select
          data-testid="sheet-condition-threshold"
          aria-label={`Ambang untuk ${entry.label}`}
          value={condition.integrityThresholdPermille}
          onChange={(event) => updateCondition(rowId, condition.id, { integrityThresholdPermille: Number(event.target.value) })}
        >
          {THRESHOLD_OPTIONS.map((permille) => (
            <option key={permille} value={permille}>
              {permille / 10}%
            </option>
          ))}
        </select>
      )}
      {conditionIsTiered(condition.kind) && (
        <select
          data-testid="sheet-condition-tier"
          aria-label={`Tier untuk ${entry.label}`}
          value={condition.tier}
          onChange={(event) => updateCondition(rowId, condition.id, { tier: Number(event.target.value) as BlockTier })}
        >
          {TIER_OPTIONS.map((tier) => (
            <option key={tier} value={tier}>
              Tier {ROMAN_TIER[tier]}
            </option>
          ))}
        </select>
      )}
      <span className="payload-sheet-chip-weight">{conditionWeightKb(condition.kind, condition.tier)} KB</span>
      <button type="button" data-testid="sheet-condition-remove" aria-label={`Hapus kondisi ${entry.label}`} onClick={() => removeCondition(rowId, condition.id)}>
        ✕
      </button>
    </li>
  );
}

function ActionChip({ rowId, action, index, total }: { rowId: string; action: ActionInstance; index: number; total: number }): JSX.Element {
  const entry = findActionEntry(action.kind);
  const removeAction = useVirusLabStore((state) => state.removeAction);
  const moveAction = useVirusLabStore((state) => state.moveAction);
  const setActionTier = useVirusLabStore((state) => state.setActionTier);
  const tierDetail = entry.tiers?.find((option) => option.tier === action.tier)?.detail;

  return (
    <li className="payload-sheet-chip" data-testid="sheet-action" data-kind={action.kind} style={{ borderColor: actionColor(action.kind) }} title={tierDetail ?? entry.summary}>
      <span className="payload-sheet-chip-label">{entry.label}</span>
      {entry.tiers && (
        <select data-testid="sheet-action-tier" aria-label={`Tier untuk ${entry.label}`} value={action.tier} onChange={(event) => setActionTier(rowId, action.id, Number(event.target.value) as BlockTier)}>
          {entry.tiers.map((option) => (
            <option key={option.tier} value={option.tier}>
              Tier {ROMAN_TIER[option.tier]}
            </option>
          ))}
        </select>
      )}
      <span className="payload-sheet-chip-weight">{actionWeightKb(action.kind, action.tier)} KB</span>
      <button type="button" data-testid="sheet-action-up" disabled={index === 0} aria-label={`Naikkan ${entry.label}`} onClick={() => moveAction(rowId, action.id, "up")}>
        ↑
      </button>
      <button type="button" data-testid="sheet-action-down" disabled={index === total - 1} aria-label={`Turunkan ${entry.label}`} onClick={() => moveAction(rowId, action.id, "down")}>
        ↓
      </button>
      <button type="button" data-testid="sheet-action-remove" aria-label={`Hapus aksi ${entry.label}`} onClick={() => removeAction(rowId, action.id)}>
        ✕
      </button>
    </li>
  );
}

function SheetRowCard({ row, depth, index, siblingCount, onPick }: { row: RowInstance; depth: number; index: number; siblingCount: number; onPick: (request: PickerRequest) => void }): JSX.Element {
  const rows = useVirusLabStore((state) => state.rows);
  const addRow = useVirusLabStore((state) => state.addRow);
  const removeRow = useVirusLabStore((state) => state.removeRow);
  const moveRow = useVirusLabStore((state) => state.moveRow);
  const setRowOnce = useVirusLabStore((state) => state.setRowOnce);
  const canNest = canNestUnder(rows, row.id);

  return (
    <li className="payload-sheet-row" data-testid="sheet-row" data-depth={depth} style={{ marginLeft: depth * 16 }}>
      <div className="payload-sheet-card">
        <div className="payload-sheet-conditions">
          <span className="payload-sheet-keyword">{row.conditions.length === 0 ? "SELALU" : "JIKA"}</span>
          <ul className="payload-sheet-chip-list">
            {row.conditions.map((condition) => (
              <ConditionChip key={condition.id} rowId={row.id} condition={condition} />
            ))}
          </ul>
          <button type="button" className="payload-sheet-add" data-testid="add-condition" onClick={() => onPick({ rowId: row.id, mode: "condition" })}>
            + kondisi
          </button>
        </div>

        <div className="payload-sheet-actions">
          <span className="payload-sheet-keyword">MAKA</span>
          <ul className="payload-sheet-chip-list">
            {row.actions.map((action, actionIndex) => (
              <ActionChip key={action.id} rowId={row.id} action={action} index={actionIndex} total={row.actions.length} />
            ))}
          </ul>
          <button type="button" className="payload-sheet-add" data-testid="add-action" onClick={() => onPick({ rowId: row.id, mode: "action" })}>
            + aksi
          </button>
        </div>

        <div className="payload-sheet-row-controls">
          <select data-testid="sheet-row-once" aria-label="Sekali-jalan" value={row.once ?? ""} onChange={(event) => setRowOnce(row.id, event.target.value === "" ? null : (event.target.value as OnceScope))}>
            <option value="">tiap tick</option>
            {(["battle", "node", "arrival"] as const).map((scope) => (
              <option key={scope} value={scope}>
                {ONCE_LABEL[scope]}
              </option>
            ))}
          </select>
          <button type="button" data-testid="add-child-row" disabled={!canNest} title={canNest ? undefined : "Maksimum 3 level nesting"} onClick={() => addRow(row.id)}>
            + baris anak
          </button>
          <button type="button" data-testid="sheet-row-up" disabled={index === 0} aria-label="Naikkan baris" onClick={() => moveRow(row.id, "up")}>
            ↑
          </button>
          <button type="button" data-testid="sheet-row-down" disabled={index === siblingCount - 1} aria-label="Turunkan baris" onClick={() => moveRow(row.id, "down")}>
            ↓
          </button>
          <button type="button" data-testid="sheet-row-remove" aria-label="Hapus baris" onClick={() => removeRow(row.id)}>
            ✕
          </button>
        </div>
      </div>

      {row.children.length > 0 && (
        <ul className="payload-sheet-children">
          {row.children.map((child, childIndex) => (
            <SheetRowCard key={child.id} row={child} depth={depth + 1} index={childIndex} siblingCount={row.children.length} onPick={onPick} />
          ))}
        </ul>
      )}
    </li>
  );
}

function describeResult(result: BattleResult): string {
  return result.winner === "attacker" ? `Menang — score ${result.score.value}` : `Kalah (bertahan/timeout) — score ${result.score.value}`;
}

export function VirusLab(): JSX.Element {
  const rows = useVirusLabStore((state) => state.rows);
  const addRow = useVirusLabStore((state) => state.addRow);
  const addCondition = useVirusLabStore((state) => state.addCondition);
  const addAction = useVirusLabStore((state) => state.addAction);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [results, setResults] = useState<readonly { defenseId: string; label: string; result: BattleResult }[] | null>(null);

  const program = useMemo(() => toVirusProgram(rows), [rows]);
  const validation = useMemo(() => validateVirusProgram(program, RULESET_V2, ACCOUNT_TIER), [program]);
  const overBudget = validation.weightKb > TIER_CONFIG.payloadBudgetKb;

  const runDrySimulation = (): void => {
    setResults(
      PRACTICE_DEFENSES.map((practice, index) => ({
        defenseId: practice.id,
        label: practice.label,
        result: simulate({ rulesetVersion: "v2", seed: PRACTICE_SEED_BY_DEFENSE_INDEX[index]!, virus: program, defense: practice.graph }).result,
      })),
    );
  };

  return (
    <Screen title="Virus Lab">
      <section data-testid="budget-bar">
        <h2>Payload Budget</h2>
        <div className="payload-budget-track">
          <div
            className="payload-budget-fill"
            style={{ width: `${Math.min(100, (validation.weightKb / TIER_CONFIG.payloadBudgetKb) * 100)}%`, background: overBudget ? theme.faction.attack : theme.faction.movement }}
          />
        </div>
        <p data-testid="budget-text" style={overBudget ? { color: theme.faction.attack } : undefined}>
          {validation.weightKb} / {TIER_CONFIG.payloadBudgetKb} KB{overBudget ? " — melebihi budget!" : ""}
        </p>
        <p data-testid="event-count-text">
          {validation.eventCount} / {TIER_CONFIG.maxSheetEvents} baris aturan
        </p>
      </section>

      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <section data-testid="sheet-issues">
          <ul>
            {validation.errors.map((error) => (
              <li key={`${error.code}-${error.path ?? ""}`} data-testid="sheet-error" style={{ color: theme.faction.attack }}>
                {error.message}
              </li>
            ))}
            {validation.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.path ?? ""}`} data-testid="sheet-warning" style={{ color: theme.faction.sensor }}>
                {warning.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-testid="sheet-editor">
        <h2>Event Sheet</h2>
        {/* The slot rule stated in plain language, as ADR 0006 §3 requires — it is the one
        semantic a player cannot guess from looking at the rows. */}
        <p className="payload-sheet-hint">
          Dibaca dari atas ke bawah tiap tick. Untuk gerak dan status, <strong>aturan paling atas yang menang</strong>; damage dan heal menumpuk semua.
        </p>
        {rows.length === 0 ? (
          <p data-testid="sheet-empty">Belum ada baris aturan. Tambah satu untuk mulai.</p>
        ) : (
          <ul className="payload-sheet-list">
            {rows.map((row, index) => (
              <SheetRowCard key={row.id} row={row} depth={0} index={index} siblingCount={rows.length} onPick={setPicker} />
            ))}
          </ul>
        )}
        <button type="button" className="payload-btn-primary" data-testid="add-root-row" onClick={() => addRow(null)}>
          + Baris aturan
        </button>
      </section>

      <section data-testid="dry-run">
        <button type="button" data-testid="run-dry-simulation" className="payload-btn-primary" disabled={!validation.valid} onClick={runDrySimulation}>
          Simulasi Kering vs 3 Latihan
        </button>
        {results && (
          <ul data-testid="dry-run-results">
            {results.map((run) => (
              <li key={run.defenseId} data-testid="dry-run-result">
                {run.label}: {describeResult(run.result)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {picker && (
        <div className="payload-modal-backdrop" data-testid="sheet-picker-backdrop" onClick={() => setPicker(null)}>
          <div className="payload-modal" role="dialog" aria-label={picker.mode === "condition" ? "Pilih kondisi" : "Pilih aksi"} data-testid="sheet-picker" onClick={(event) => event.stopPropagation()}>
            <h2>{picker.mode === "condition" ? "Pilih Kondisi" : "Pilih Aksi"}</h2>
            <div className="payload-modal-grid">
              {picker.mode === "condition"
                ? CONDITION_CATALOG.map((entry) => (
                    <button
                      key={entry.kind}
                      type="button"
                      className="payload-modal-card"
                      data-testid="sheet-picker-entry"
                      data-kind={entry.kind}
                      style={{ borderColor: conditionColor(entry.kind) }}
                      onClick={() => {
                        addCondition(picker.rowId, entry.kind);
                        setPicker(null);
                      }}
                    >
                      <span>{entry.label}</span>
                      <small>{entry.tiers ? `${entry.tiers[0]!.weightKb}+ KB` : `${conditionWeightKb(entry.kind, 1)} KB`}</small>
                      <small className="payload-sheet-picker-summary">{entry.summary}</small>
                    </button>
                  ))
                : ACTION_CATALOG.map((entry) => (
                    <button
                      key={entry.kind}
                      type="button"
                      className="payload-modal-card"
                      data-testid="sheet-picker-entry"
                      data-kind={entry.kind}
                      style={{ borderColor: actionColor(entry.kind) }}
                      onClick={() => {
                        addAction(picker.rowId, entry.kind);
                        setPicker(null);
                      }}
                    >
                      <span>{entry.label}</span>
                      <small>
                        {entry.weightKb} KB{entry.isSlot ? " · slot" : ""}
                      </small>
                      <small className="payload-sheet-picker-summary">{entry.summary}</small>
                    </button>
                  ))}
            </div>
            <button type="button" data-testid="sheet-picker-close" onClick={() => setPicker(null)}>
              Tutup
            </button>
          </div>
        </div>
      )}
    </Screen>
  );
}
