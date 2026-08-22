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

/** Taps a map node's round glyph and waits for its detail modal to open (matched by node id, since
 * only one detail modal is ever open at a time). Returns the modal element. */
async function openDetail(nodeId: string): Promise<HTMLElement> {
  (nodeRow(nodeId).querySelector('[data-testid="research-node-open"]') as HTMLButtonElement).click();
  return vi.waitFor(() => {
    const modal = document.querySelector('[data-testid="research-detail"]') as HTMLElement | null;
    if (!modal || modal.getAttribute("data-node-id") !== nodeId) {
      throw new Error("detail modal for this node not open yet");
    }
    return modal;
  });
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

  it("tapping a map node opens its detail; Tutup closes back to the map without changing anything", async () => {
    renderAt("/research");
    await findByTestId("research-node-list");
    const modal = await openDetail("inti.move-toward-core");
    expect(modal.textContent).toContain("Jalan ke Core");
    expect(modal.querySelector('[data-testid="research-node-status"]')!.textContent).toBe("Selesai");

    (modal.querySelector('[data-testid="research-detail-close"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="research-detail"]')) {
        throw new Error("detail modal still open");
      }
    });
    // The map is unaffected — the node row is still right where it was.
    expect(nodeRow("inti.move-toward-core").getAttribute("data-status")).toBe("selesai");
  });

  it("a depth-1 node with no Data is terkunci, not bisa — the Riset button only appears once affordable", async () => {
    renderAt("/research");
    await findByTestId("research-node-list");
    (page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("data-branch") === "serbuan")! as HTMLButtonElement).click();
    await vi.waitFor(() => nodeRow("serbuan.exploit.1"));
    expect(nodeRow("serbuan.exploit.1").getAttribute("data-status")).toBe("terkunci");

    const modal = await openDetail("serbuan.exploit.1");
    expect(modal.querySelector('[data-testid="research-node-button"]')).toBeNull();
  });

  it("researching a node from its detail spends Data, marks it selesai, closes the detail, and unlocks its children", async () => {
    useResearchStore.getState().grantData(1000);
    renderAt("/research");
    await findByTestId("research-node-list");
    (page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("data-branch") === "serbuan")! as HTMLButtonElement).click();
    await vi.waitFor(() => nodeRow("serbuan.exploit.1"));

    expect(nodeRow("serbuan.exploit.1").getAttribute("data-status")).toBe("bisa");
    // serbuan.exploit.2 requires serbuan.exploit.1 — still locked before the parent is researched.
    expect(nodeRow("serbuan.exploit.2").getAttribute("data-status")).toBe("terkunci");

    const modal = await openDetail("serbuan.exploit.1");
    (modal.querySelector('[data-testid="research-node-button"]') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="research-detail"]')) {
        throw new Error("detail did not close after buying");
      }
    });
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

  it("a locked node's missing-prerequisite link jumps focus to that prerequisite's branch and opens its detail", async () => {
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

    const modal = await openDetail("serbuan.detonate.3");
    const link = modal.querySelector('[data-testid="research-node-locked-reason"] button') as HTMLButtonElement;
    expect(link.textContent).toContain("Bersihkan");
    link.click();

    await vi.waitFor(() => {
      const activeTab = page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("aria-selected") === "true");
      if (activeTab?.getAttribute("data-branch") !== "bayangan") {
        throw new Error("did not jump to bayangan yet");
      }
    });
    // The jump also swaps the open detail to the prerequisite itself, not just the tab.
    await vi.waitFor(() => {
      const newModal = document.querySelector('[data-testid="research-detail"]');
      if (newModal?.getAttribute("data-node-id") !== "bayangan.purge.1") {
        throw new Error("detail did not follow the jump yet");
      }
    });
  });

  it("deep-links via ?focus= to the right branch and opens that node's detail", async () => {
    renderAt("/research?focus=replikasi.worm-split.1");
    await findByTestId("research-node-list");
    const activeTab = page.getByTestId("research-branch-tab").elements().find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(activeTab.getAttribute("data-branch")).toBe("replikasi");
    const modal = await vi.waitFor(() => {
      const el = document.querySelector('[data-testid="research-detail"]') as HTMLElement | null;
      if (!el) {
        throw new Error("deep-link detail not open yet");
      }
      return el;
    });
    expect(modal.getAttribute("data-node-id")).toBe("replikasi.worm-split.1");
  });
});
