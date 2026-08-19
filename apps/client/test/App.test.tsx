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
  // it on #/league) — reset to the root screen so every test starts from the same place.
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

const SCREENS: readonly { label: string; title: string }[] = [
  { label: "HQ", title: "HQ / Home" },
  { label: "Virus Lab", title: "Virus Lab" },
  { label: "Defense", title: "Defense Grid" },
  { label: "Scan", title: "Scan / Attack" },
  { label: "Replay", title: "Replay Player" },
  { label: "Research", title: "Research" },
  { label: "League", title: "League" },
];

describe("App navigation", () => {
  it("starts on the HQ / Home screen", async () => {
    const screen = await findByTestId("screen-HQ / Home");
    expect(screen).toBeDefined();
  });

  it("renders all 7 nav links", async () => {
    const nav = await findByTestId("app-header"); // wait for first render to land
    expect(nav).toBeDefined();
    const links = page.getByRole("link").elements();
    expect(links).toHaveLength(SCREENS.length);
  });

  for (const target of SCREENS) {
    it(`navigates to the ${target.title} screen and updates the header`, async () => {
      await findByTestId("app-header");
      await page.getByRole("link", { name: target.label }).click();
      const screen = await findByTestId(`screen-${target.title}`);
      expect(screen.textContent).toContain(target.title);
      const header = await findByTestId("app-header");
      expect(header.textContent).toBe(target.title);
    });
  }

  it("marks only the active screen's nav link as active", async () => {
    await findByTestId("app-header");
    await page.getByRole("link", { name: "Research" }).click();
    await findByTestId("screen-Research");
    const activeLinks = page.getByTestId("app-header").element().ownerDocument.querySelectorAll(".payload-nav-link.active");
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]!.textContent).toBe("Research");
  });
});
