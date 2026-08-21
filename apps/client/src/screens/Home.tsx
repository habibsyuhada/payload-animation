import { RULESET_V2, getAccountTierConfig, validateVirusProgram, type ProgramValidationResult } from "@payload/sim";
import { RESEARCH_TREE, canResearch } from "@payload/shared";
import { Link } from "react-router-dom";
import { DEFENSE_BUDGET_PT, spentPt, useDefendStore } from "../state/defendStore.js";
import { useResearchStore } from "../state/researchStore.js";
import { toVirusProgram, useVirusLabStore } from "../state/virusLabStore.js";
import { Screen } from "./Screen.js";

/**
 * HQ — what the player currently has, read straight from the two stores that now persist to the
 * device. It was a placeholder paragraph until local persistence landed; before that there was
 * nothing to summarise, because nothing survived a refresh.
 *
 * Deliberately does NOT run the gauntlet to show a verdict here. That is ~120 simulations, and
 * running them on every visit to the home screen would spend a phone's battery to restate
 * something the Defend page says better, next to the map it is about.
 */

const ACCOUNT_TIER = 1;
const PAYLOAD_BUDGET_KB = getAccountTierConfig(RULESET_V2, ACCOUNT_TIER).payloadBudgetKb;

/**
 * One line for the state of the sheet. Only the first issue is spelled out — the card is a
 * summary, and the Virus Lab lists all of them next to the rows they are about — but the count of
 * the rest is carried along, because "one small warning" and "six things wrong" should not read
 * identically from the home screen.
 */
function describeSheetHealth(validation: ProgramValidationResult): string {
  const issues = validation.errors.length > 0 ? validation.errors : validation.warnings;
  if (issues.length === 0) {
    return "Siap dijalankan.";
  }
  return `⚠ ${issues[0]!.message}${issues.length > 1 ? ` (+${issues.length - 1} lagi)` : ""}`;
}

export function Home(): JSX.Element {
  const rows = useVirusLabStore((state) => state.rows);
  const nodes = useDefendStore((state) => state.nodes);
  const researchData = useResearchStore((state) => state.data);
  const researchCompleted = useResearchStore((state) => state.completed);

  const validation = validateVirusProgram(toVirusProgram(rows), RULESET_V2, ACCOUNT_TIER);
  const defenseSpent = spentPt(nodes);
  const entryCount = nodes.filter((node) => node.type === "entry").length;
  const coreCount = nodes.filter((node) => node.type === "core").length;
  const defensiveCount = nodes.length - entryCount - coreCount;
  const researchableCount = RESEARCH_TREE.filter((node) => canResearch(node, { version: 1, data: researchData, completed: researchCompleted, claimed: {} })).length;

  return (
    <Screen title="HQ">
      <Link to="/virus-lab" className="payload-card" data-testid="hq-virus-card">
        <h2>Virus</h2>
        <p className="payload-card-stat">
          <strong data-testid="hq-virus-rules">{validation.eventCount}</strong> baris aturan
          <span>
            · {validation.weightKb} / {PAYLOAD_BUDGET_KB} KB
          </span>
        </p>
        <p className="payload-card-note" data-testid="hq-virus-status">
          {describeSheetHealth(validation)}
        </p>
      </Link>

      <Link to="/defend" className="payload-card" data-testid="hq-defense-card">
        <h2>Pertahanan</h2>
        <p className="payload-card-stat">
          <strong data-testid="hq-defense-nodes">{defensiveCount}</strong> node bertahan
          <span>
            · {defenseSpent} / {DEFENSE_BUDGET_PT} pt
          </span>
        </p>
        <p className="payload-card-note" data-testid="hq-defense-status">
          {entryCount} Entry · {coreCount} Core — buka untuk mengatur dan mengujinya.
        </p>
      </Link>

      {/* The two screens whose feature does not exist yet sit together, half-width and quieter:
      still reachable — each one explains what it is waiting on — without pretending they are
      destinations worth the same weight as the two above. */}
      <div className="payload-card-row">
        <Link to="/scan" className="payload-card payload-card--minor" data-testid="hq-scan-card">
          <h2>Scan</h2>
          <p className="payload-card-note">Cari lawan · belum ada</p>
        </Link>
        <Link to="/research" className="payload-card payload-card--minor" data-testid="hq-research-card">
          <h2>Riset</h2>
          <p className="payload-card-note" data-testid="hq-research-status">
            <strong data-testid="hq-research-data">{researchData}</strong> Data · {researchableCount} riset bisa diambil
          </p>
        </Link>
      </div>

      <div className="payload-card">
        <h2>Baru pertama kali?</h2>
        <p>Lima battle tutorial, masing-masing memperkenalkan satu kategori aturan.</p>
        <p className="payload-card-note">
          <Link to="/onboarding" data-testid="home-start-onboarding">
            Mulai Tutorial →
          </Link>
        </p>
      </div>

      <p className="payload-card-note" data-testid="hq-offline-note">
        Virus dan pertahananmu tersimpan di perangkat ini. Tidak ada akun, tidak ada server — battle
        dihitung di HP-mu sendiri, jadi semuanya tetap jalan tanpa internet.
      </p>
    </Screen>
  );
}
