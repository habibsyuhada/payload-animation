import { getAccountTierConfig, RULESET_V1, simulate, type BattleResult, type BlockTier, type LogicBlockKind } from "@payload/sim";
import { useState } from "react";
import { findLogicBlockEntry, findLogicBlockWeightKb, LOGIC_BLOCK_CATALOG, MOVEMENT_CATALOG, type BlockCategory } from "../data/blockCatalog.js";
import { PRACTICE_DEFENSES } from "../data/practiceDefenses.js";
import { theme } from "../theme.js";
import { toVirusDesign, totalWeightKb, useVirusLabStore, type ChainBlockInstance } from "../state/virusLabStore.js";
import { Screen } from "./Screen.js";

/** No real account-tier system yet (Fase 4/5) — Virus Lab always validates against tier 1's budget, same placeholder tier practiceDefenses.ts uses for coreHp. */
const PAYLOAD_BUDGET_KB = getAccountTierConfig(RULESET_V1, 1).payloadBudgetKb;
const TIER_OPTIONS: readonly BlockTier[] = [1, 2, 3];
/** A fixed seed per practice defense keeps "Run" reproducible run-to-run, matching the sim's own determinism guarantee — not meant to be a real per-battle seed (that's server-assigned in Fase 4). */
const PRACTICE_SEED_BY_DEFENSE_INDEX = [101, 202, 303] as const;

function categoryColor(category: BlockCategory): string {
  return category === "movement" ? theme.faction.movement : theme.faction[category];
}

/** Custom drag mime type carrying a palette block's kind — distinct from the plain-text mime the chain rows themselves use to carry their instance id (see BlockChainRow's own onDragStart), so a row's onDrop can tell "new block from the palette" apart from "reorder an existing block" without ambiguity. */
const NEW_BLOCK_MIME = "application/x-block-kind";

function BlockChainRow({ block, index, total }: { block: ChainBlockInstance; index: number; total: number }): JSX.Element {
  const entry = findLogicBlockEntry(block.kind);
  const moveBlock = useVirusLabStore((state) => state.moveBlock);
  const removeBlock = useVirusLabStore((state) => state.removeBlock);
  const setBlockTier = useVirusLabStore((state) => state.setBlockTier);
  const [isDropTarget, setIsDropTarget] = useState(false);

  return (
    <li
      className={`payload-chain-row${isDropTarget ? " payload-chain-row--drop-target" : ""}`}
      data-testid="chain-row"
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", block.id)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDropTarget(false);
        const newBlockKind = event.dataTransfer.getData(NEW_BLOCK_MIME);
        if (newBlockKind) {
          useVirusLabStore.getState().insertBlockAt(newBlockKind as LogicBlockKind, index);
          return;
        }
        const draggedId = event.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== block.id) {
          useVirusLabStore.getState().reorderTo(draggedId, index);
        }
      }}
      style={{ borderLeft: `3px solid ${categoryColor(entry.category)}` }}
    >
      <span className="payload-chain-label">{entry.label}</span>
      <select data-testid="chain-tier-select" value={block.tier} onChange={(event) => setBlockTier(block.id, Number(event.target.value) as BlockTier)}>
        {TIER_OPTIONS.map((tier) => (
          <option key={tier} value={tier}>
            Tier {tier}
          </option>
        ))}
      </select>
      <span className="payload-chain-weight">{findLogicBlockWeightKb(block.kind, block.tier)} KB</span>
      <button type="button" data-testid="chain-move-up" disabled={index === 0} onClick={() => moveBlock(block.id, "up")} aria-label={`Naikkan ${entry.label}`}>
        ↑
      </button>
      <button type="button" data-testid="chain-move-down" disabled={index === total - 1} onClick={() => moveBlock(block.id, "down")} aria-label={`Turunkan ${entry.label}`}>
        ↓
      </button>
      <button type="button" data-testid="chain-remove" onClick={() => removeBlock(block.id)} aria-label={`Hapus ${entry.label}`}>
        ✕
      </button>
    </li>
  );
}

function describeResult(result: BattleResult): string {
  return result.winner === "attacker" ? `Menang — score ${result.score.value}` : `Kalah (bertahan/timeout) — score ${result.score.value}`;
}

export function VirusLab(): JSX.Element {
  const movementKind = useVirusLabStore((state) => state.movementKind);
  const setMovementKind = useVirusLabStore((state) => state.setMovementKind);
  const chain = useVirusLabStore((state) => state.chain);
  const addBlock = useVirusLabStore((state) => state.addBlock);
  const insertBlockAt = useVirusLabStore((state) => state.insertBlockAt);
  const [results, setResults] = useState<readonly { defenseId: string; label: string; result: BattleResult }[] | null>(null);
  const [isDraggingPaletteBlock, setIsDraggingPaletteBlock] = useState(false);

  const weightKb = totalWeightKb({ movementKind, chain });
  const overBudget = weightKb > PAYLOAD_BUDGET_KB;

  const runDrySimulation = (): void => {
    const virus = toVirusDesign({ movementKind, chain });
    const runs = PRACTICE_DEFENSES.map((practice, index) => ({
      defenseId: practice.id,
      label: practice.label,
      result: simulate({ rulesetVersion: "v1", seed: PRACTICE_SEED_BY_DEFENSE_INDEX[index]!, virus, defense: practice.graph }).result,
    }));
    setResults(runs);
  };

  return (
    <Screen title="Virus Lab">
      <section data-testid="movement-picker">
        <h2>Movement (wajib pilih 1)</h2>
        <div role="radiogroup" aria-label="Movement block">
          {MOVEMENT_CATALOG.map((entry) => (
            <label key={entry.kind} className="payload-movement-option">
              <input type="radio" name="movement" value={entry.kind} checked={movementKind === entry.kind} onChange={() => setMovementKind(entry.kind)} />
              {entry.label} ({entry.weightKb} KB)
            </label>
          ))}
        </div>
      </section>

      <section data-testid="budget-bar">
        <h2>Payload Budget</h2>
        <div className="payload-budget-track">
          <div
            className="payload-budget-fill"
            style={{ width: `${Math.min(100, (weightKb / PAYLOAD_BUDGET_KB) * 100)}%`, background: overBudget ? theme.faction.attack : theme.faction.movement }}
          />
        </div>
        <p data-testid="budget-text" style={overBudget ? { color: theme.faction.attack } : undefined}>
          {weightKb} / {PAYLOAD_BUDGET_KB} KB{overBudget ? " — melebihi budget!" : ""}
        </p>
      </section>

      <section data-testid="block-palette">
        <h2>Tambah Blok Logika</h2>
        {(["sensor", "condition", "attack", "stealth", "utility"] as const).map((category) => (
          <div key={category}>
            <h3 style={{ color: categoryColor(category) }}>{category}</h3>
            {LOGIC_BLOCK_CATALOG.filter((entry) => entry.category === category).map((entry) => (
              <button
                key={entry.kind}
                type="button"
                data-testid="add-block"
                className="payload-palette-block"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(NEW_BLOCK_MIME, entry.kind);
                  event.dataTransfer.setData("text/plain", `new-block:${entry.kind}`);
                  event.dataTransfer.effectAllowed = "copy";
                  setIsDraggingPaletteBlock(true);
                }}
                onDragEnd={() => setIsDraggingPaletteBlock(false)}
                onClick={() => addBlock(entry.kind)}
                style={{ borderLeft: `3px solid ${categoryColor(category)}` }}
              >
                + {entry.label}
              </button>
            ))}
          </div>
        ))}
      </section>

      <section
        data-testid="chain-builder"
        className={`payload-chain-builder${isDraggingPaletteBlock ? " payload-chain-builder--drop-active" : ""}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(NEW_BLOCK_MIME)) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          const newBlockKind = event.dataTransfer.getData(NEW_BLOCK_MIME);
          if (newBlockKind) {
            event.preventDefault();
            insertBlockAt(newBlockKind as LogicBlockKind, chain.length);
          }
          setIsDraggingPaletteBlock(false);
        }}
      >
        <h2>Rantai Blok ({chain.length})</h2>
        {chain.length === 0 ? (
          <p>Belum ada blok logika ditambahkan. Seret blok dari atas ke sini, atau klik untuk menambahkan.</p>
        ) : (
          <ol className="payload-chain-list">
            {chain.map((block, index) => (
              <BlockChainRow key={block.id} block={block} index={index} total={chain.length} />
            ))}
          </ol>
        )}
      </section>

      <section data-testid="dry-run">
        <button type="button" data-testid="run-dry-simulation" className="payload-btn-primary" disabled={overBudget} onClick={runDrySimulation}>
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
    </Screen>
  );
}
