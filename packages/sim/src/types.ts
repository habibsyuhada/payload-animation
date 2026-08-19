/**
 * Core data contract (PLAN.md §2), typed against the block/node vocabulary fixed
 * in docs/RULESET.md. Zero runtime deps — packages/sim stays pure.
 */

export type RulesetVersion = "v1";

export type BlockTier = 1 | 2 | 3;

export type MovementBlockKind = "shortest-path" | "random-walk" | "backtrack";

export type LogicBlockKind =
  | "scan-ahead"
  | "detect-honeypot"
  | "if-integrity-below"
  | "if-node-type"
  | "if-scanned"
  | "brute-force"
  | "exploit"
  | "overload"
  | "cloak"
  | "slow-crawl"
  | "self-repair"
  | "sacrifice-decoy";

export interface MovementBlock {
  readonly kind: MovementBlockKind;
}

export interface LogicBlock {
  readonly kind: LogicBlockKind;
  readonly tier: BlockTier;
  /**
   * "if-integrity-below" only — permille threshold (RULESET.md §4.2: tier I fixed 500‰/50%,
   * tier II/III player-configurable). Defaults to 500 if omitted.
   */
  readonly integrityThresholdPermille?: number;
  /** "if-node-type" only — node types this condition matches. Defaults to ["firewall"] if omitted. */
  readonly targetNodeTypes?: readonly DefenseNodeType[];
}

export interface VirusDesign {
  readonly movement: MovementBlock;
  readonly blocks: readonly LogicBlock[];
}

export type DefenseNodeType =
  | "router"
  | "firewall"
  | "ice-sentry"
  | "honeypot"
  | "scanner"
  | "trap"
  | "core"
  | "entry";

/** Router/Entry/Core are untiered (RULESET.md §5.1); firewall/ice-sentry/honeypot/scanner/trap carry a tier. */
export interface DefenseNode {
  readonly id: number;
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
}

export interface DefenseEdge {
  readonly from: number;
  readonly to: number;
  readonly lengthDu: number;
}

export interface DefenseGraph {
  readonly nodes: readonly DefenseNode[];
  readonly edges: readonly DefenseEdge[];
  readonly entryNodeIds: readonly number[];
  readonly coreNodeId: number;
  /** Core's starting HP (RULESET.md §5.2) — account-tier-dependent, so it's baked in here rather than derived, keeping BattleInput self-contained/replayable. */
  readonly coreHp: number;
}

export interface BattleInput {
  readonly rulesetVersion: RulesetVersion;
  readonly seed: number;
  readonly virus: VirusDesign;
  readonly defense: DefenseGraph;
}

export type BattleEventType =
  | "virus-entered-node"
  | "virus-damaged"
  | "virus-repaired"
  | "virus-died"
  | "node-damaged"
  | "node-destroyed"
  | "status-applied"
  | "status-expired"
  | "decoy-absorbed"
  | "battle-timeout"
  | "battle-won";

export interface BattleEvent {
  readonly tick: number;
  readonly type: BattleEventType;
  readonly actor: string;
  readonly target?: string;
  readonly delta?: number;
}

export interface Score {
  readonly value: number;
  readonly integrityRatioPermille: number;
  readonly coreRatioPermille: number;
  readonly nodesDestroyed: number;
  readonly timeBonus: number;
}

export interface BattleResult {
  readonly winner: "attacker" | "defender";
  readonly score: Score;
}

export interface BattleLog {
  readonly input: BattleInput;
  readonly events: readonly BattleEvent[];
  readonly result: BattleResult;
}

export interface AccountTierConfig {
  readonly tier: 1 | 2 | 3 | 4 | 5;
  readonly payloadBudgetKb: number;
  readonly defenseBudgetPoints: number;
  readonly coreHp: number;
}

export interface Ruleset {
  readonly version: RulesetVersion;
  readonly tickLimit: number;
  readonly accountTiers: readonly AccountTierConfig[];
}
