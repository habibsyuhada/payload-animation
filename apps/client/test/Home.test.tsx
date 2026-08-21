import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Home } from "../src/screens/Home.js";
import { useDefendStore } from "../src/state/defendStore.js";
import { useResearchStore } from "../src/state/researchStore.js";
import { useVirusLabStore } from "../src/state/virusLabStore.js";

/**
 * HQ summarises the two stores that persist to the device, so these assert the summary tracks the
 * real state rather than that the words render — the whole point of the screen is that it tells
 * you what you already have, before you go looking for it.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useVirusLabStore.getState().reset();
  useDefendStore.getState().reset();
  useResearchStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() =>
    root.render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Home />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  root.unmount();
  container.remove();
});

async function textOf(testId: string): Promise<string> {
  return vi.waitFor(() => {
    const element = page.getByTestId(testId).query();
    if (!element) {
      throw new Error(`element not yet in the DOM: ${testId}`);
    }
    return element.textContent ?? "";
  });
}

describe("HQ", () => {
  it("summarises the starter sheet: one rule, its weight, and no complaints", async () => {
    expect(await textOf("hq-virus-rules")).toBe("1");
    expect(await textOf("hq-virus-card")).toContain("840 / 2400 KB");
    expect(await textOf("hq-virus-status")).toBe("Siap dijalankan.");
  });

  it("surfaces a sheet's warning instead of claiming it is ready", async () => {
    // Swap the starter's movement action for an attack one: the sheet is still a real sheet, it
    // just can no longer go anywhere — the trap ADR 0006 asks the editor to warn about.
    const rowId = useVirusLabStore.getState().rows[0]!.id;
    useVirusLabStore.getState().removeAction(rowId, useVirusLabStore.getState().rows[0]!.actions[0]!.id);
    useVirusLabStore.getState().addAction(rowId, "brute-force");

    await vi.waitFor(async () => {
      expect(await textOf("hq-virus-status")).toContain("tidak ada aksi gerak");
    });
  });

  it("counts the issues it did not spell out, so one nit does not read like six problems", async () => {
    const rowId = useVirusLabStore.getState().rows[0]!.id;
    useVirusLabStore.getState().removeAction(rowId, useVirusLabStore.getState().rows[0]!.actions[0]!.id);

    // An empty row AND no movement anywhere: two warnings, one line.
    await vi.waitFor(async () => {
      expect(await textOf("hq-virus-status")).toContain("(+1 lagi)");
    });
  });

  it("counts defensive nodes without counting the structural Entry and Core", async () => {
    expect(await textOf("hq-defense-nodes")).toBe("0");
    expect(await textOf("hq-defense-status")).toContain("1 Entry · 1 Core");

    useDefendStore.getState().addNode("firewall", 400, 0, 1);
    await vi.waitFor(async () => {
      expect(await textOf("hq-defense-nodes")).toBe("1");
    });
    expect(await textOf("hq-defense-card")).toContain("/ 20 pt");
  });

  it("says plainly that everything lives on the device", async () => {
    expect(await textOf("hq-offline-note")).toContain("tersimpan di perangkat ini");
  });

  it("tracks the Data balance and how much is researchable right now", async () => {
    expect(await textOf("hq-research-data")).toBe("0");
    // With 0 Data, nothing costs 0 outside the already-completed Inti set — canResearch needs
    // `data >= costData`, so a broke player sees nothing researchable yet.
    expect(await textOf("hq-research-status")).toContain("0 riset bisa diambil");

    useResearchStore.getState().grantData(500);
    await vi.waitFor(async () => {
      expect(await textOf("hq-research-data")).toBe("500");
    });
    // Every branch's depth-1 node is `requires: []` and costs 150 — affordable now, so the count
    // moves off zero.
    await vi.waitFor(async () => {
      expect(await textOf("hq-research-status")).not.toContain("0 riset bisa diambil");
    });
  });
});
