import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(<App />));
  // HashRouter starts wherever the browser's location hash already is (a prior test may have left
  // it on #/scan) — reset to the hub so every test starts from the same place.
  window.location.hash = "#/";
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

/**
 * Every spoke reachable from the hub: the card that opens it, and how you know you arrived.
 * "Defense" is the one screen that brings its own full-screen shell instead of going through
 * `Screen`, so it has its own test id.
 */
const SPOKES: readonly { card: string; arrivedAt: string; header: string }[] = [
  { card: "hq-virus-card", arrivedAt: "screen-Virus Lab", header: "Virus Lab" },
  { card: "hq-defense-card", arrivedAt: "defend-page", header: "Defense" },
  { card: "hq-scan-card", arrivedAt: "screen-Scan / Attack", header: "Scan / Attack" },
  { card: "hq-research-card", arrivedAt: "screen-Research", header: "Research" },
];

describe("App — hub and spoke", () => {
  it("starts on the hub, showing the brand rather than a back link", async () => {
    await findByTestId("screen-HQ");
    const header = await findByTestId("app-header");
    expect(header.textContent).toContain("PAYLOAD");
    expect(page.getByTestId("back-to-hub").query()).toBeNull();
  });

  it("has no bottom nav at all — the hub's cards are the navigation", async () => {
    await findByTestId("app-header");
    expect(document.querySelectorAll("nav")).toHaveLength(0);
  });

  for (const spoke of SPOKES) {
    it(`opens ${spoke.header} from its hub card and names it in the header`, async () => {
      await findByTestId("screen-HQ");
      (page.getByTestId(spoke.card).element() as HTMLElement).click();

      await findByTestId(spoke.arrivedAt);
      const header = await findByTestId("app-header");
      expect(header.textContent).toContain(spoke.header);
    });
  }

  it("returns to the hub from a spoke's back link", async () => {
    await findByTestId("screen-HQ");
    (page.getByTestId("hq-scan-card").element() as HTMLElement).click();
    await findByTestId("screen-Scan / Attack");

    (await findByTestId("back-to-hub")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await findByTestId("screen-HQ");
    expect(page.getByTestId("back-to-hub").query()).toBeNull();
  });

  it("keeps the tutorial reachable from the hub", async () => {
    await findByTestId("screen-HQ");
    (page.getByTestId("home-start-onboarding").element() as HTMLElement).click();
    await findByTestId("screen-Onboarding");
  });
});
