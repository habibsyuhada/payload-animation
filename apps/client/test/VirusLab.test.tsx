import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirusLab } from "../src/screens/VirusLab.js";
import { rowIdByRulePath, toVirusProgram, useVirusLabStore } from "../src/state/virusLabStore.js";

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

async function waitForCount(testId: string, count: number): Promise<Element[]> {
  return vi.waitFor(() => {
    const found = page.getByTestId(testId).elements();
    if (found.length !== count) {
      throw new Error(`expected ${count} ${testId}, saw ${found.length}`);
    }
    return found;
  });
}

/** Opens the `+ kondisi` / `+ aksi` picker on the nth row and taps one entry by its kind. */
async function pickInto(rowIndex: number, mode: "condition" | "action", kind: string): Promise<void> {
  const opener = page.getByTestId(mode === "condition" ? "add-condition" : "add-action").elements()[rowIndex]!;
  (opener as HTMLButtonElement).click();
  await findByTestId("sheet-picker");
  const entry = page.getByTestId("sheet-picker-entry").elements().find((element) => element.getAttribute("data-kind") === kind);
  if (!entry) {
    throw new Error(`picker has no entry for ${kind}`);
  }
  (entry as HTMLButtonElement).click();
  await vi.waitFor(() => {
    if (page.getByTestId("sheet-picker").query()) {
      throw new Error("picker still open");
    }
  });
}

describe("VirusLab — event sheet editor (V7.3)", () => {
  it("starts from the movement fallback template, so a fresh sheet already walks", async () => {
    const rows = await waitForCount("sheet-row", 1);
    expect(rows[0]!.textContent).toContain("SELALU");
    expect(rows[0]!.textContent).toContain("Jalan ke Core");
    const budgetText = await findByTestId("budget-text");
    // 40 KB row weight + 800 KB "Jalan ke Core".
    expect(budgetText.textContent).toContain("840 / 2400 KB");
  });

  it("adds a condition by tapping `+ kondisi` and picking from the sheet", async () => {
    await waitForCount("sheet-row", 1);
    await pickInto(0, "condition", "node-here-is");

    const conditions = await waitForCount("sheet-condition", 1);
    expect(conditions[0]!.textContent).toContain("Node saat ini");
    const row = page.getByTestId("sheet-row").elements()[0]!;
    expect(row.textContent).toContain("JIKA");
    const budgetText = await findByTestId("budget-text");
    // + 120 KB for the condition.
    expect(budgetText.textContent).toContain("960 / 2400 KB");
  });

  it("adds an action by tapping `+ aksi`, and charges its tier", async () => {
    await waitForCount("sheet-row", 1);
    await pickInto(0, "action", "brute-force");
    await waitForCount("sheet-action", 2);

    const tierSelect = page.getByTestId("sheet-action-tier").elements()[0]! as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    setter.call(tierSelect, "3");
    tierSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const budgetText = await findByTestId("budget-text");
    // 40 + 800 + 1100 (Brute Force III).
    expect(budgetText.textContent).toContain("1940 / 2400 KB");
  });

  it("negates a condition in place rather than offering a separate NOT block", async () => {
    await pickInto(0, "condition", "at-node");
    await waitForCount("sheet-condition", 1);
    const toggle = page.getByTestId("sheet-condition-negate").elements()[0]! as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    await vi.waitFor(() => {
      if (page.getByTestId("sheet-condition-negate").elements()[0]!.getAttribute("aria-pressed") !== "true") {
        throw new Error("negate not applied");
      }
    });
    expect(toVirusProgram(useVirusLabStore.getState().rows).events[0]!.conditions[0]!.negate).toBe(true);
  });

  it("nests a child row one indent step and refuses a fourth level", async () => {
    await waitForCount("sheet-row", 1);
    (page.getByTestId("add-child-row").elements()[0]! as HTMLButtonElement).click();
    await waitForCount("sheet-row", 2);
    (page.getByTestId("add-child-row").elements()[1]! as HTMLButtonElement).click();
    const rows = await waitForCount("sheet-row", 3);
    expect(rows.map((row) => row.getAttribute("data-depth"))).toEqual(["0", "1", "2"]);

    // The deepest row may not nest any further — the cap is a readability limit, so it is shown
    // as a disabled control rather than a rejected tap.
    const deepest = page.getByTestId("add-child-row").elements()[2]! as HTMLButtonElement;
    expect(deepest.disabled).toBe(true);
  });

  it("reorders sibling rows with ↑/↓ — no drag anywhere in the editor", async () => {
    (await findByTestId("add-root-row")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForCount("sheet-row", 2);
    await pickInto(1, "action", "hold-position");

    let rows = page.getByTestId("sheet-row").elements();
    expect(rows[0]!.textContent).toContain("Jalan ke Core");
    expect(rows[1]!.textContent).toContain("Diam di tempat");

    (page.getByTestId("sheet-row-down").elements()[0]! as HTMLButtonElement).click();
    await vi.waitFor(() => {
      rows = page.getByTestId("sheet-row").elements();
      if (!rows[0]!.textContent?.includes("Diam di tempat")) {
        throw new Error("rows not reordered yet");
      }
    });
    expect(rows[1]!.textContent).toContain("Jalan ke Core");
  });

  it("removes a row and gives its weight back", async () => {
    await waitForCount("sheet-row", 1);
    (page.getByTestId("sheet-row-remove").elements()[0]! as HTMLButtonElement).click();
    await findByTestId("sheet-empty");
    const budgetText = await findByTestId("budget-text");
    expect(budgetText.textContent).toContain("0 / 2400 KB");
  });

  it("warns about a sheet that never moves without blocking the run", async () => {
    await waitForCount("sheet-row", 1);
    (page.getByTestId("sheet-action-remove").elements()[0]! as HTMLButtonElement).click();
    await waitForCount("sheet-action", 0);

    const warnings = await vi.waitFor(() => {
      const found = page.getByTestId("sheet-warning").elements();
      if (found.length === 0) {
        throw new Error("no warning yet");
      }
      return found;
    });
    expect(warnings.map((warning) => warning.textContent).join(" ")).toContain("tidak ada aksi gerak");
    const runButton = (await findByTestId("run-dry-simulation")) as HTMLButtonElement;
    expect(runButton.disabled).toBe(false);
  });

  it("blocks the run when the sheet is over budget", async () => {
    for (let i = 0; i < 3; i += 1) {
      await pickInto(0, "action", "overload");
    }
    await waitForCount("sheet-action", 4);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    for (const select of page.getByTestId("sheet-action-tier").elements() as HTMLSelectElement[]) {
      setter.call(select, "3");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const budgetText = await findByTestId("budget-text");
    expect(budgetText.textContent).toContain("melebihi budget");
    expect((await findByTestId("sheet-error")).textContent).toContain("melebihi budget");
    expect(((await findByTestId("run-dry-simulation")) as HTMLButtonElement).disabled).toBe(true);
  });

  it("counts rows against the account tier's event cap", async () => {
    const eventCount = await findByTestId("event-count-text");
    expect(eventCount.textContent).toContain("1 / 12 baris");
    (await findByTestId("add-root-row")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForCount("sheet-row", 2);
    expect((await findByTestId("event-count-text")).textContent).toContain("2 / 12 baris");
  });

  it("runs the dry simulation against all 3 practice defenses", async () => {
    await pickInto(0, "action", "brute-force");
    await waitForCount("sheet-action", 2);
    (await findByTestId("run-dry-simulation")).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const results = await waitForCount("dry-run-result", 3);
    expect(results[0]!.textContent).toContain("Latihan I");
    expect(results[2]!.textContent).toContain("Latihan III");
    for (const result of results) {
      expect(result.textContent).toMatch(/Menang|Kalah/);
    }
  });
});

describe("virusLabStore — compiling to a VirusProgram", () => {
  it("strips editor instance ids so two identically-built sheets compile to identical bytes", () => {
    const { addRow, addAction } = useVirusLabStore.getState();
    addRow(null);
    addAction(useVirusLabStore.getState().rows[1]!.id, "brute-force");
    const first = JSON.stringify(toVirusProgram(useVirusLabStore.getState().rows));

    useVirusLabStore.getState().reset();
    useVirusLabStore.getState().addRow(null);
    useVirusLabStore.getState().addAction(useVirusLabStore.getState().rows[1]!.id, "brute-force");
    expect(JSON.stringify(toVirusProgram(useVirusLabStore.getState().rows))).toBe(first);
  });

  it("maps a rule path back to the row that produced it, in engine order", () => {
    const { addRow } = useVirusLabStore.getState();
    addRow(null);
    const rows = useVirusLabStore.getState().rows;
    addRow(rows[0]!.id);
    const updated = useVirusLabStore.getState().rows;
    const paths = rowIdByRulePath(updated);
    expect(paths.get("0")).toBe(updated[0]!.id);
    expect(paths.get("0.0")).toBe(updated[0]!.children[0]!.id);
    expect(paths.get("1")).toBe(updated[1]!.id);
  });
});
