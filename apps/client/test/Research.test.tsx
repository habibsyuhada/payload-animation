import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Research } from "../src/screens/Research.js";
import { useResearchStore } from "../src/state/researchStore.js";
import "../src/theme.css";

let container: HTMLDivElement;
let root: Root;

function renderAt(path: string): void {
  flushSync(() =>
    root.render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Research />
      </MemoryRouter>,
    ),
  );
}

beforeEach(() => {
  useResearchStore.getState().reset(); // Inti-only baseline, 0 Data.
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

function nodeRow(nodeId: string): HTMLElement {
  return document.querySelector(`[data-testid=research-node][data-node-id="${nodeId}"]`) as HTMLElement;
}

describe("Research screen", () => {
  it("shows the Data balance and a completed/available summary", async () => {
    renderAt("/research");
    expect((await findByTestId("research-data-balance")).textContent).toBe("0");
    expect((await findByTestId("research-summary")).textContent).toMatch(/\d+ \/ \d+ riset selesai/);
  });

  it("opens on the Inti tab by default, with the starter set already selesai", async () => {
    renderAt("/research");
    await findByTestId("research-node-list");
    const activeTab = page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(activeTab.getAttribute("data-branch")).toBe("inti");
    expect(nodeRow("inti.move-toward-core").getAttribute("data-status")).toBe("selesai");
  });

  it("switches branch tabs on tap", async () => {
    renderAt("/research");
    await findByTestId("research-node-list");
    (page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("data-branch") === "serbuan")! as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (!nodeRow("serbuan.exploit.1")) {
        throw new Error("serbuan branch not shown yet");
      }
    });
  });

  it("a depth-1 node with no Data is terkunci, not bisa — the Riset button only appears once affordable", async () => {
    renderAt("/research");
    await findByTestId("research-node-list");
    (page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("data-branch") === "serbuan")! as HTMLButtonElement).click();
    await vi.waitFor(() => nodeRow("serbuan.exploit.1"));
    expect(nodeRow("serbuan.exploit.1").getAttribute("data-status")).toBe("terkunci");
    expect(nodeRow("serbuan.exploit.1").querySelector('[data-testid="research-node-button"]')).toBeNull();
  });

  it("researching a node spends Data, marks it selesai, and unlocks its own children", async () => {
    useResearchStore.getState().grantData(1000);
    renderAt("/research");
    await findByTestId("research-node-list");
    (page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("data-branch") === "serbuan")! as HTMLButtonElement).click();
    await vi.waitFor(() => nodeRow("serbuan.exploit.1"));

    expect(nodeRow("serbuan.exploit.1").getAttribute("data-status")).toBe("bisa");
    // serbuan.exploit.2 requires serbuan.exploit.1 — still locked before the parent is researched.
    expect(nodeRow("serbuan.exploit.2").getAttribute("data-status")).toBe("terkunci");

    (nodeRow("serbuan.exploit.1").querySelector('[data-testid="research-node-button"]') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      if (nodeRow("serbuan.exploit.1").getAttribute("data-status") !== "selesai") {
        throw new Error("not completed yet");
      }
    });
    expect(useResearchStore.getState().data).toBe(1000 - 150); // serbuan.exploit.1 costs 150.
    await vi.waitFor(() => {
      if (nodeRow("serbuan.exploit.2").getAttribute("data-status") !== "bisa") {
        throw new Error("child not unlocked yet");
      }
    });
  });

  it("a locked node's missing-prerequisite link jumps focus to that prerequisite's branch", async () => {
    useResearchStore.getState().grantData(2000);
    // Clear every same-branch prerequisite of serbuan.detonate.3 except its cross-branch one
    // (bayangan.purge.1), so exactly one locked-reason link renders and it's the one under test.
    useResearchStore.getState().research("serbuan.exploit.1");
    useResearchStore.getState().research("serbuan.target-strike.1");
    useResearchStore.getState().research("serbuan.detonate.1");
    renderAt("/research");
    await findByTestId("research-node-list");
    (page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("data-branch") === "serbuan")! as HTMLButtonElement).click();
    await vi.waitFor(() => nodeRow("serbuan.detonate.3")); // capstone, requires bayangan.purge.1 too.
    expect(nodeRow("serbuan.detonate.3").getAttribute("data-status")).toBe("terkunci");

    const link = nodeRow("serbuan.detonate.3").querySelector('[data-testid="research-node-locked-reason"] button') as HTMLButtonElement;
    expect(link.textContent).toContain("Bersihkan");
    link.click();

    await vi.waitFor(() => {
      const activeTab = page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("aria-selected") === "true");
      if (activeTab?.getAttribute("data-branch") !== "bayangan") {
        throw new Error("did not jump to bayangan yet");
      }
    });
  });

  it("deep-links via ?focus= to the right branch", async () => {
    renderAt("/research?focus=replikasi.worm-split.1");
    await findByTestId("research-node-list");
    const activeTab = page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(activeTab.getAttribute("data-branch")).toBe("replikasi");
  });
});
