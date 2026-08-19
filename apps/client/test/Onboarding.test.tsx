import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ONBOARDING_TUTORIALS } from "../src/data/onboardingTutorials.js";
import { Onboarding } from "../src/screens/Onboarding.js";
import { useOnboardingStore } from "../src/state/onboardingStore.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useOnboardingStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
});

async function findByTestId(testId: string): Promise<Element> {
  return vi.waitFor(() => {
    const element = page.getByTestId(testId).query();
    if (!element) {
      throw new Error(`element not yet in the DOM: ${testId}`);
    }
    return element;
  });
}

function setRangeValue(value: string): void {
  const input = page.getByTestId("scrubber-range").element() as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Renders Onboarding inside a router — react-router hooks (useNavigate, used by the completion screen) throw outside a Router context. */
function renderOnboarding(): void {
  flushSync(() =>
    root.render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Onboarding />
      </MemoryRouter>,
    ),
  );
}

describe("Onboarding", () => {
  it("starts on Tutorial 1 (Sensor) with a Mulai Battle button and no replay yet", async () => {
    renderOnboarding();
    const title = await findByTestId("onboarding-tutorial-title");
    expect(title.textContent).toContain("Sensor");
    expect(page.getByTestId("replay-player").elements()).toHaveLength(0);
  });

  it("runs the tutorial's real battle and shows a replay once Mulai Battle is clicked", async () => {
    renderOnboarding();
    await page.getByTestId("onboarding-start-battle").click();
    const outcome = await findByTestId("replay-outcome");
    expect(outcome.textContent).toMatch(/Menang|Kalah/);
  });

  it("keeps Lanjut disabled on Tutorial 1 until the player scrubs backward", async () => {
    renderOnboarding();
    await page.getByTestId("onboarding-start-battle").click();
    await findByTestId("replay-player");
    const advance = (await findByTestId("onboarding-advance")) as HTMLButtonElement;
    expect(advance.disabled).toBe(true);
    expect((await findByTestId("onboarding-scrub-hint")).textContent).toContain("Geser scrubber mundur");

    setRangeValue("1.0");
    setRangeValue("0.2");

    await vi.waitFor(() => {
      if ((page.getByTestId("onboarding-advance").element() as HTMLButtonElement).disabled) {
        throw new Error("still disabled");
      }
    });
  });

  it("does not require a forced scrub on Tutorial 2 onward", async () => {
    renderOnboarding();
    // clear tutorial 1's gate first.
    await page.getByTestId("onboarding-start-battle").click();
    await findByTestId("replay-player");
    setRangeValue("1.0");
    setRangeValue("0.2");
    await vi.waitFor(() => {
      if ((page.getByTestId("onboarding-advance").element() as HTMLButtonElement).disabled) throw new Error("still disabled");
    });
    await page.getByTestId("onboarding-advance").click();

    await vi.waitFor(() => {
      if (!page.getByTestId("onboarding-tutorial-title").query()?.textContent?.includes("Condition")) {
        throw new Error("not on tutorial 2 yet");
      }
    });

    await page.getByTestId("onboarding-start-battle").click();
    await findByTestId("replay-player");
    const advance = (await findByTestId("onboarding-advance")) as HTMLButtonElement;
    expect(advance.disabled).toBe(false); // no scrub needed this time
  });

  it("walks through all 5 tutorials and shows the completion screen", async () => {
    renderOnboarding();

    for (let index = 0; index < ONBOARDING_TUTORIALS.length; index += 1) {
      await page.getByTestId("onboarding-start-battle").click();
      await findByTestId("replay-player");
      if (index === 0) {
        setRangeValue("1.0");
        setRangeValue("0.2");
      }
      await vi.waitFor(() => {
        if ((page.getByTestId("onboarding-advance").element() as HTMLButtonElement).disabled) {
          throw new Error("advance still disabled");
        }
      });
      await page.getByTestId("onboarding-advance").click();
    }

    const complete = await findByTestId("onboarding-complete");
    expect(complete).toBeDefined();
    expect(page.getByTestId("onboarding-go-home").elements()).toHaveLength(1);
  });
});
