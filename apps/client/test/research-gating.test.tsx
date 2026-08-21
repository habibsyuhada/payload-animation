import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Defend } from "../src/screens/Defend.js";
import { VirusLab } from "../src/screens/VirusLab.js";
import { useDefendStore } from "../src/state/defendStore.js";
import { useResearchStore } from "../src/state/researchStore.js";
import { useVirusLabStore } from "../src/state/virusLabStore.js";
import "../src/theme.css";

/**
 * research-gating.test.tsx — PLAN.md 8.7's own acceptance criteria: "riset sebuah simpul benar-
 * benar membuka item di picker; item terkunci tidak bisa ditambahkan". Deliberately a separate file
 * from VirusLab.test.tsx/Defend.test.tsx (which unlock everything up front to stay focused on the
 * editor/gauntlet, not on research) — here the fixture is the real baseline: `reset()`'s Inti-only
 * starter set, so locked-vs-unlocked is the thing under test.
 */

let container: HTMLDivElement;
let root: Root;

/** Renders inside a router with a real `/research` destination, so a picker's locked-item redirect
 * is observable — a bare `<MemoryRouter>` with no `<Routes>` never actually swaps what's on screen. */
function LocationProbe(): JSX.Element {
  const location = useLocation();
  return (
    <div data-testid="research-route-marker" data-pathname={location.pathname} data-search={location.search}>
      Research
    </div>
  );
}

function renderAt(path: string): void {
  flushSync(() =>
    root.render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/virus-lab" element={<VirusLab />} />
          <Route path="/defend" element={<Defend />} />
          <Route path="/research" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

beforeEach(() => {
  useVirusLabStore.getState().reset();
  useDefendStore.getState().reset();
  useResearchStore.getState().reset(); // Inti-only baseline — everything else starts locked.
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

describe("Virus Lab picker — research gating", () => {
  it("shows a not-yet-researched action locked, and tapping it jumps to Research focused on its node", async () => {
    renderAt("/virus-lab");
    (await findByTestId("add-action")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await findByTestId("sheet-picker");

    const entry = page.getByTestId("sheet-picker-entry").elements().find((element) => element.getAttribute("data-kind") === "exploit")!;
    expect(entry.getAttribute("data-locked")).toBe("true");
    expect(entry.textContent).toContain("🔒");

    entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const marker = await findByTestId("research-route-marker");
    expect(marker.getAttribute("data-search")).toBe("?focus=serbuan.exploit.1");
    // The picker closed rather than adding the locked action to the row.
    expect(useVirusLabStore.getState().rows[0]!.actions.map((action) => action.kind)).not.toContain("exploit");
  });

  it("researching a node's prerequisite unlocks it in the picker, addable like any other action", async () => {
    useResearchStore.setState({ data: 1000, completed: useResearchStore.getState().completed, claimed: {} });
    useResearchStore.getState().research("serbuan.exploit.1");

    renderAt("/virus-lab");
    (await findByTestId("add-action")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await findByTestId("sheet-picker");

    const entry = page.getByTestId("sheet-picker-entry").elements().find((element) => element.getAttribute("data-kind") === "exploit")!;
    expect(entry.getAttribute("data-locked")).toBe("false");
    entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.waitFor(() => {
      if (!useVirusLabStore.getState().rows[0]!.actions.some((action) => action.kind === "exploit")) {
        throw new Error("exploit not added yet");
      }
    });
  });

  it("a legacy sheet already using a not-yet-researched kind still shows it and lets the row be edited (validateAgainstUnlocks flags it, doesn't hide it)", async () => {
    // A sheet authored before research existed for this device — exactly what the migration
    // (starterCompletedIds) exists to reconcile; here it's simulated directly by writing the row.
    const rowId = useVirusLabStore.getState().rows[0]!.id;
    useVirusLabStore.getState().addAction(rowId, "exploit");

    renderAt("/virus-lab");
    const row = await findByTestId("sheet-row");
    expect(row.textContent).toContain("Exploit");
    // Flagged as an unlock issue (not a structural sim error) rather than silently dropped.
    const errors = await vi.waitFor(() => {
      const found = page.getByTestId("sheet-error").elements();
      if (found.length === 0) {
        throw new Error("no unlock issue reported yet");
      }
      return found;
    });
    expect(errors.map((error) => error.textContent).join(" ")).toContain("belum diriset");
  });
});

describe("Defend picker — research gating", () => {
  it("shows a not-yet-researched node type locked, and tapping it jumps to Research focused on its node", async () => {
    renderAt("/defend");
    (await findByTestId("defend-add-node")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await findByTestId("defend-picker");

    const entry = page.getByTestId("defend-picker-entry").elements().find((element) => element.getAttribute("data-node-type") === "ice-sentry")!;
    expect(entry.getAttribute("data-locked")).toBe("true");

    entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const marker = await findByTestId("research-route-marker");
    expect(marker.getAttribute("data-search")).toBe("?focus=pengintaian.ice-sentry.1");
    expect(useDefendStore.getState().nodes.some((node) => node.type === "ice-sentry")).toBe(false);
  });

  it("researching a defense node's tier 1 unlocks it in the picker, placeable like any other node", async () => {
    useResearchStore.setState({ data: 1000, completed: useResearchStore.getState().completed, claimed: {} });
    useResearchStore.getState().research("pengintaian.ice-sentry.1");

    renderAt("/defend");
    (await findByTestId("defend-add-node")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await findByTestId("defend-picker");

    const entry = page.getByTestId("defend-picker-entry").elements().find((element) => element.getAttribute("data-node-type") === "ice-sentry")!;
    expect(entry.getAttribute("data-locked")).toBe("false");
  });
});
