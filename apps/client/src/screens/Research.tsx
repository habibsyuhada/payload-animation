import { RESEARCH_TREE, canResearch, researchNodeFor, type ResearchBranch, type ResearchNode, type Unlock } from "@payload/shared";
import type { BlockTier } from "@payload/sim";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { findActionEntry, findConditionEntry } from "../data/sheetCatalog.js";
import { findPlaceableEntry } from "../data/defenseNodeCatalog.js";
import { useResearchStore } from "../state/researchStore.js";
import { theme } from "../theme.js";
import { Screen } from "./Screen.js";

/**
 * Research — PLAN.md 8.7: replaces the placeholder. Tap-driven, no drag, phone-first (390px) — the
 * same convention V7.3's Virus Lab and the Defend picker already settled on (HANDOFF §5 no.14).
 *
 * Renders as an actual tree diagram: one horizontally-scrollable column per depth, SVG bezier
 * lines drawn from each node's same-branch prerequisites to itself. Cross-branch requires (only
 * the depth-4 capstones have those, per research-tree.ts's doc comment) have nothing to connect to
 * within the active branch, so they fall back to the existing "Terkunci: butuh <link>" text.
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
const DEPTH_LABEL = ["Dasar", "Tahap I", "Tahap II", "Tahap III", "Tahap IV"];

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

/** One bezier line from a same-branch prerequisite's right edge to a node's left edge, in
 * coordinates relative to the tree container — see the connector-measuring effect below. */
interface TreeLine {
  readonly id: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly done: boolean;
}

function connectorPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

function ResearchNodeCard({ node, status, missingRequires, onFocusRequire, cardRef }: { node: ResearchNode; status: NodeStatus; missingRequires: readonly ResearchNode[]; onFocusRequire: (id: string) => void; cardRef: (el: HTMLLIElement | null) => void }): JSX.Element {
  const research = useResearchStore((state) => state.research);
  const data = useResearchStore((state) => state.data);
  const canAfford = data >= node.costData;

  return (
    <li ref={cardRef} className="payload-research-node" data-testid="research-node" data-node-id={node.id} data-status={status} style={{ borderColor: status === "selesai" ? BRANCH_COLOR[node.branch] : theme.border }}>
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

  const treeRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const [lines, setLines] = useState<readonly TreeLine[]>([]);

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

  const columns = useMemo(() => {
    const byDepth = new Map<number, ResearchNode[]>();
    for (const node of branchNodes) {
      const existing = byDepth.get(node.depth);
      if (existing) {
        existing.push(node);
      } else {
        byDepth.set(node.depth, [node]);
      }
    }
    return [...byDepth.entries()].sort(([a], [b]) => a - b);
  }, [branchNodes]);

  useLayoutEffect(() => {
    const container = treeRef.current;
    if (!container) {
      return;
    }
    function recompute(): void {
      if (!container) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const next: TreeLine[] = [];
      for (const node of branchNodes) {
        const childEl = nodeRefs.current.get(node.id);
        if (!childEl) {
          continue;
        }
        for (const requireId of node.requires) {
          const parentEl = nodeRefs.current.get(requireId); // undefined for cross-branch requires — no line to draw.
          if (!parentEl) {
            continue;
          }
          const parentRect = parentEl.getBoundingClientRect();
          const childRect = childEl.getBoundingClientRect();
          next.push({
            id: `${requireId}->${node.id}`,
            x1: parentRect.right - containerRect.left,
            y1: parentRect.top + parentRect.height / 2 - containerRect.top,
            x2: childRect.left - containerRect.left,
            y2: childRect.top + childRect.height / 2 - containerRect.top,
            done: completed.includes(requireId) && completed.includes(node.id),
          });
        }
      }
      setLines(next);
    }
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    window.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [branchNodes, completed, data]);

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

      <div className="payload-research-tree-scroll" data-testid="research-node-list">
        <div className="payload-research-tree" ref={treeRef}>
          <svg className="payload-research-tree-lines" aria-hidden="true">
            {lines.map((line) => (
              <path key={line.id} d={connectorPath(line.x1, line.y1, line.x2, line.y2)} className="payload-research-tree-line" style={{ stroke: line.done ? BRANCH_COLOR[activeBranch] : theme.textMuted, opacity: line.done ? 1 : 0.4 }} />
            ))}
          </svg>
          <div className="payload-research-tree-columns">
            {columns.map(([depth, nodes]) => (
              <div key={depth} className="payload-research-tree-column">
                <span className="payload-research-tree-column-label">{DEPTH_LABEL[depth] ?? `Tahap ${depth}`}</span>
                <ul className="payload-research-list">
                  {nodes.map((node) => {
                    const status = statusOf(node, completed, data);
                    const missingRequires = node.requires.map((id) => researchNodeFor(RESEARCH_TREE, id)!).filter((required) => !completed.includes(required.id));
                    return (
                      <ResearchNodeCard
                        key={node.id}
                        node={node}
                        status={status}
                        missingRequires={missingRequires}
                        onFocusRequire={focusOn}
                        cardRef={(el) => {
                          if (el) {
                            nodeRefs.current.set(node.id, el);
                          } else {
                            nodeRefs.current.delete(node.id);
                          }
                        }}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}
