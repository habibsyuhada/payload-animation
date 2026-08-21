import { useNavigate } from "react-router-dom";
import { ReplayPlayer } from "../components/ReplayPlayer.js";
import { ONBOARDING_TUTORIALS } from "../data/onboardingTutorials.js";
import { requiresForcedScrub, useOnboardingStore } from "../state/onboardingStore.js";
import { useResearchStore } from "../state/researchStore.js";
import { Screen } from "./Screen.js";

/** PLAN.md §C.3: 120 Data per tutorial, ×5 tutorials = 600 — the "sudah ada onboardingStore;
 * tinggal dipanggil" source. */
const TUTORIAL_REWARD_DATA = 120;

export function Onboarding(): JSX.Element {
  const navigate = useNavigate();
  const stepIndex = useOnboardingStore((state) => state.stepIndex);
  const log = useOnboardingStore((state) => state.log);
  const hasScrubbedBackward = useOnboardingStore((state) => state.hasScrubbedBackward);
  const completed = useOnboardingStore((state) => state.completed);
  const startBattle = useOnboardingStore((state) => state.startBattle);
  const markScrubbedBackward = useOnboardingStore((state) => state.markScrubbedBackward);
  const advance = useOnboardingStore((state) => state.advance);
  const claimOnce = useResearchStore((state) => state.claimOnce);
  const unlockNode = useResearchStore((state) => state.unlockNode);

  if (completed) {
    return (
      <Screen title="Tutorial Selesai">
        <p data-testid="onboarding-complete">Semua 5 tutorial selesai — Sensor, Condition, Attack, Stealth, Utility sudah dikenalkan. Siap ke Virus Lab untuk merakit virus sendiri.</p>
        <button type="button" data-testid="onboarding-go-home" onClick={() => navigate("/")}>
          Kembali ke HQ
        </button>
      </Screen>
    );
  }

  const tutorial = ONBOARDING_TUTORIALS[stepIndex]!;
  const forceScrub = requiresForcedScrub(stepIndex);
  const canAdvance = log !== null && (!forceScrub || hasScrubbedBackward);

  /** Rewards this step's Data + research-node grant (idempotent — `claimOnce` guards against a
   * double-credit if this ever fires twice for the same tutorial) before moving on. */
  function handleAdvance(): void {
    if (claimOnce(`tutorial:${tutorial.id}`, TUTORIAL_REWARD_DATA)) {
      unlockNode(tutorial.rewardResearchNodeId);
    }
    advance();
  }

  return (
    <Screen title="Onboarding">
      <p data-testid="onboarding-progress">
        Tutorial {stepIndex + 1} / {ONBOARDING_TUTORIALS.length}
      </p>
      <h2 data-testid="onboarding-tutorial-title">{tutorial.title}</h2>
      <p data-testid="onboarding-narrative">{tutorial.narrative}</p>

      {!log && (
        <button type="button" data-testid="onboarding-start-battle" onClick={startBattle}>
          Mulai Battle
        </button>
      )}

      {log && (
        <>
          <ReplayPlayer log={log} layout={tutorial.layout} onScrubBackward={markScrubbedBackward} />
          {forceScrub && !hasScrubbedBackward && <p data-testid="onboarding-scrub-hint">Geser scrubber mundur untuk lihat kenapa virusmu menang/kalah, sebelum lanjut.</p>}
          <button type="button" data-testid="onboarding-advance" disabled={!canAdvance} onClick={handleAdvance}>
            {stepIndex + 1 === ONBOARDING_TUTORIALS.length ? "Selesai" : "Lanjut ke Tutorial Berikutnya"}
          </button>
        </>
      )}
    </Screen>
  );
}
