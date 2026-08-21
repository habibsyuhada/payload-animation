import { RESEARCH_TREE, canResearch, researchNodeFor, type ResearchBranch, type ResearchNode, type Unlock } from "@payload/shared";
import type { BlockTier } from "@payload/sim";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { findActionEntry, findConditionEntry } from "../data/sheetCatalog.js";
import { findPlaceableEntry } from "../data/defenseNodeCatalog.js";
import { useResearchStore } from "../state/researchStore.js";
import { theme } from "../theme.js";
import { Screen } from "./Screen.js";

/**
 * Research — PLAN.md 8.7: replaces the placeholder. Tap-driven, no drag, phone-first (390px) — the
 * same convention V7.3's Virus Lab and the Defend picker already settled on (HANDOFF §5 no.14).
 */

const BRANCH_LABEL: Record<ResearchBranch, string> = {
  inti: "Inti",
  serbuan: "Serbuan",
  bayangan: "Bayangan",
  pengintaian: "Pengintaian",
  replikasi: "Replikasi",
};

/** Reuses the app's existing faction palette (theme.ts) rather than inventing a second one —
 * PLAN.md's own branch colours (abu/merah/hijau/kuning/biru) already line up with it one-to-one. */
const BRANCH_COLOR: Record<ResearchBranch, string> = {
  inti: theme.faction.utility,
  serbuan: theme.faction.attack,
  bayangan: theme.faction.stealth,
  pengintaian: theme.faction.sensor,
  replikasi: theme.faction.movement,
};

const BRANCH_ORDER: readonly ResearchBranch[] = ["inti", "serbuan", "bayangan", "pengintaian", "replikasi"];
const ROMAN_TIER: Record<BlockTier, string> = { 1: "I", 2: "II", 3: "III" };

function describeUnlock(unlock: Unlock): string {
  if (unlock.kind === "condition") {
    return findConditionEntry(unlock.condition).label;
  }
  if (unlock.kind === "action") {
    const label = findActionEntry(unlock.action).label;
    return unlock.tier ? `${label} Tier ${ROMAN_TIER[unlock.tier]}` : label;
  }
  // "entry"/"core" never actually appear in RESEARCH_TREE (they're structural and page-priced,
  // never gated — defendStore.ts) — this branch only exists to satisfy DefenseNodeType's full union.
  const label = unlock.node === "entry" || unlock.node === "core" ? unlock.node : findPlaceableEntry(unlock.node).label;
  return unlock.tier ? `${label} Tier ${ROMAN_TIER[unlock.tier]}` : label;
}

type NodeStatus = "selesai" | "bisa" | "terkunci";

function statusOf(node: ResearchNode, completed: readonly string[], data: number): NodeStatus {
  if (completed.includes(node.id)) {
    return "selesai";
  }
  return canResearch(node, { version: 1, data, completed, claimed: {} }) ? "bisa" : "terkunci";
}

const STATUS_LABEL: Record<NodeStatus, string> = { selesai: "Selesai", bisa: "Bisa diriset", terkunci: "Terkunci" };

function ResearchNodeRow({ node, status, missingRequires, onFocusRequire }: { node: ResearchNode; status: NodeStatus; missingRequires: readonly ResearchNode[]; onFocusRequire: (id: string) => void }): JSX.Element {
  const research = useResearchStore((state) => state.research);
  const data = useResearchStore((state) => state.data);
  const canAfford = data >= node.costData;

  return (
    <li
      className="payload-research-node"
      data-testid="research-node"
      data-node-id={node.id}
      data-status={status}
      style={{ marginLeft: (node.depth === 0 ? 0 : node.depth - 1) * 14, borderColor: status === "selesai" ? BRANCH_COLOR[node.branch] : theme.border }}
    >
      <div className="payload-research-node-main">
        <span className="payload-research-node-name">{node.name}</span>
        <span className="payload-research-node-cost">{node.costData === 0 ? "gratis" : `${node.costData} Data`}</span>
      </div>
      <p className="payload-card-note">{node.summary}</p>
      <ul className="payload-research-unlocks">
        {node.unlocks.map((unlock, index) => (
          <li key={index}>{describeUnlock(unlock)}</li>
        ))}
      </ul>
      {status === "terkunci" && missingRequires.length > 0 && (
        <p className="payload-card-note" data-testid="research-node-locked-reason">
          Terkunci: butuh{" "}
          {missingRequires.map((required, index) => (
            <span key={required.id}>
              {index > 0 ? ", " : ""}
              <button type="button" className="payload-link-button" onClick={() => onFocusRequire(required.id)}>
                {required.name}
              </button>
            </span>
          ))}
        </p>
      )}
      <div className="payload-research-node-footer">
        <span className="payload-research-node-status" data-testid="research-node-status">
          {STATUS_LABEL[status]}
        </span>
        {status === "bisa" && (
          <button type="button" className="payload-btn-primary" data-testid="research-node-button" disabled={!canAfford} onClick={() => research(node.id)}>
            Riset
          </button>
        )}
      </div>
    </li>
  );
}

export function Research(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const data = useResearchStore((state) => state.data);
  const completed = useResearchStore((state) => state.completed);
  const focusId = searchParams.get("focus");
  const focusedNode = focusId ? researchNodeFor(RESEARCH_TREE, focusId) : undefined;
  const [activeBranch, setActiveBranch] = useState<ResearchBranch>(focusedNode?.branch ?? "inti");

  const completedCount = completed.length;
  const totalCount = RESEARCH_TREE.length;
  const availableCount = useMemo(() => RESEARCH_TREE.filter((node) => statusOf(node, completed, data) === "bisa").length, [completed, data]);

  const branchNodes = useMemo(
    () =>
      RESEARCH_TREE.filter((node) => node.branch === activeBranch)
        .slice()
        .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)),
    [activeBranch],
  );

  function focusOn(nodeId: string): void {
    const node = researchNodeFor(RESEARCH_TREE, nodeId);
    if (node) {
      setActiveBranch(node.branch);
      setSearchParams({ focus: nodeId });
    }
  }

  return (
    <Screen title="Research">
      <section data-testid="research-header">
        <p className="payload-card-stat">
          <strong data-testid="research-data-balance">{data}</strong> Data
        </p>
        <p className="payload-card-note" data-testid="research-summary">
          {completedCount} / {totalCount} riset selesai · {availableCount} bisa diambil sekarang
        </p>
      </section>

      <div className="payload-research-tabs" role="tablist" aria-label="Cabang riset">
        {BRANCH_ORDER.map((branch) => (
          <button
            key={branch}
            type="button"
            role="tab"
            aria-selected={activeBranch === branch}
            data-testid="research-branch-tab"
            data-branch={branch}
            className="payload-research-tab"
            style={{ borderColor: BRANCH_COLOR[branch], background: activeBranch === branch ? BRANCH_COLOR[branch] : "transparent", color: activeBranch === branch ? theme.background : BRANCH_COLOR[branch] }}
            onClick={() => setActiveBranch(branch)}
          >
            {BRANCH_LABEL[branch]}
          </button>
        ))}
      </div>

      <ul className="payload-research-list" data-testid="research-node-list">
        {branchNodes.map((node) => {
          const status = statusOf(node, completed, data);
          const missingRequires = node.requires.map((id) => researchNodeFor(RESEARCH_TREE, id)!).filter((required) => !completed.includes(required.id));
          return <ResearchNodeRow key={node.id} node={node} status={status} missingRequires={missingRequires} onFocusRequire={focusOn} />;
        })}
      </ul>
    </Screen>
  );
}
