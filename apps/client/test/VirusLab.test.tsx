import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirusLab } from "../src/screens/VirusLab.js";
import { useVirusLabStore } from "../src/state/virusLabStore.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useVirusLabStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(<VirusLab />));
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

describe("VirusLab", () => {
  it("defaults to Shortest Path and shows its weight against the account-tier-1 budget", async () => {
    const budgetText = await findByTestId("budget-text");
    expect(budgetText.textContent).toContain("800 / 2400 KB");
  });

  it("updates the budget when a different movement block is picked", async () => {
    await findByTestId("budget-text");
    await page.getByText("Random Walk").click();
    const budgetText = await findByTestId("budget-text");
    expect(budgetText.textContent).toContain("500 / 2400 KB");
  });

  it("adds a block to the chain and its weight to the budget", async () => {
    await findByTestId("budget-text");
    await page.getByText("+ Brute Force").click();
    const rows = await vi.waitFor(() => {
      const found = page.getByTestId("chain-row").elements();
      if (found.length === 0) {
        throw new Error("no chain row yet");
      }
      return found;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Brute Force");
    const budgetText = await findByTestId("budget-text");
    // 800 (shortest-path) + 700 (brute-force tier 1) = 1500
    expect(budgetText.textContent).toContain("1500 / 2400 KB");
  });

  it("removes a block from the chain", async () => {
    await page.getByText("+ Self Repair").click();
    await findByTestId("chain-row");
    await page.getByRole("button", { name: "Hapus Self Repair" }).click();
    await vi.waitFor(() => {
      if (page.getByTestId("chain-row").elements().length !== 0) {
        throw new Error("row still present");
      }
    });
    const budgetText = await findByTestId("budget-text");
    expect(budgetText.textContent).toContain("800 / 2400 KB");
  });

  it("changing a block's tier updates its weight", async () => {
    await page.getByText("+ Exploit").click();
    await findByTestId("chain-row");
    const tierSelect = page.getByTestId("chain-tier-select");
    await tierSelect.selectOptions("3");
    const budgetText = await findByTestId("budget-text");
    // 800 (shortest-path) + 950 (exploit tier 3) = 1750
    expect(budgetText.textContent).toContain("1750 / 2400 KB");
  });

  it("reorders the chain with the move-up/move-down buttons", async () => {
    await page.getByText("+ Scan Ahead").click();
    await findByTestId("chain-row");
    await page.getByText("+ Detect Honeypot").click();
    await vi.waitFor(() => {
      if (page.getByTestId("chain-row").elements().length !== 2) {
        throw new Error("expected 2 rows");
      }
    });

    let rows = page.getByTestId("chain-row").elements();
    expect(rows[0]!.textContent).toContain("Scan Ahead");
    expect(rows[1]!.textContent).toContain("Detect Honeypot");

    await page.getByTestId("chain-move-down").first().click();

    rows = page.getByTestId("chain-row").elements();
    expect(rows[0]!.textContent).toContain("Detect Honeypot");
    expect(rows[1]!.textContent).toContain("Scan Ahead");
  });

  it("disables the dry-run button and shows a warning once weight exceeds the budget", async () => {
    // stack enough heavy Attack-tier-3 blocks to blow past 2400 KB.
    for (let i = 0; i < 3; i += 1) {
      await page.getByText("+ Brute Force").click();
    }
    await vi.waitFor(() => {
      if (page.getByTestId("chain-row").elements().length !== 3) {
        throw new Error("expected 3 rows");
      }
    });
    const tierSelects = page.getByTestId("chain-tier-select").elements() as HTMLSelectElement[];
    for (const select of tierSelects) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "3");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const budgetText = await findByTestId("budget-text");
    expect(budgetText.textContent).toContain("melebihi budget");
    const runButton = (await findByTestId("run-dry-simulation")) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
  });

  it("runs the dry simulation against all 3 practice defenses and shows a result for each", async () => {
    await page.getByText("+ Brute Force").click();
    await page.getByText("+ Exploit").click();
    await vi.waitFor(() => {
      if (page.getByTestId("chain-row").elements().length !== 2) {
        throw new Error("expected 2 chain rows before running the simulation");
      }
    });
    await page.getByTestId("run-dry-simulation").click();

    const results = await vi.waitFor(() => {
      const found = page.getByTestId("dry-run-result").elements();
      if (found.length === 0) {
        throw new Error("no results yet");
      }
      return found;
    });
    expect(results).toHaveLength(3);
    expect(results[0]!.textContent).toContain("Latihan I");
    expect(results[1]!.textContent).toContain("Latihan II");
    expect(results[2]!.textContent).toContain("Latihan III");
    for (const result of results) {
      expect(result.textContent).toMatch(/Menang|Kalah/);
    }
  });
});
