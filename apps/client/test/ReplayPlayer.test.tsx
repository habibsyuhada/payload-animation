import type { Layout } from "@payload/replay";
import { simulate, type BattleInput, type DefenseGraph, type DefenseNode } from "@payload/sim";
import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplayPlayer } from "../src/components/ReplayPlayer.js";

const GRAPH: DefenseGraph = {
  nodes: [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 4, type: "core" },
  ] satisfies DefenseNode[],
  edges: [
    { from: 1, to: 3, lengthDu: 400 },
    { from: 2, to: 3, lengthDu: 400 },
    { from: 3, to: 4, lengthDu: 600 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 100,
};
const LAYOUT: Layout = { positions: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 100 }, 3: { x: 200, y: 50 }, 4: { x: 500, y: 50 } } };
const INPUT: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: GRAPH };
const LOG = simulate(INPUT);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function setRangeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ReplayPlayer", () => {
  it("renders a canvas and the battle's real outcome", async () => {
    flushSync(() => root.render(<ReplayPlayer log={LOG} layout={LAYOUT} />));
    const canvas = await findByTestId("replay-canvas");
    expect(canvas).toBeDefined();
    const outcome = await findByTestId("replay-outcome");
    expect(outcome.textContent).toContain(LOG.result.winner === "attacker" ? "Menang" : "Kalah");
    expect(outcome.textContent).toContain(String(LOG.result.score.value));
  });

  it("starts at T=0 on the scrubber", async () => {
    flushSync(() => root.render(<ReplayPlayer log={LOG} layout={LAYOUT} />));
    const range = (await findByTestId("scrubber-range")) as HTMLInputElement;
    expect(range.value).toBe("0");
  });

  it("toggles Play/Pause label when clicked", async () => {
    flushSync(() => root.render(<ReplayPlayer log={LOG} layout={LAYOUT} />));
    const button = (await findByTestId("replay-play-pause")) as HTMLButtonElement;
    expect(button.textContent).toBe("Play");
    await page.getByTestId("replay-play-pause").click();
    await vi.waitFor(() => {
      if ((page.getByTestId("replay-play-pause").element() as HTMLButtonElement).textContent !== "Pause") {
        throw new Error("still says Play");
      }
    });
  });

  it("calls onScrubBackward the first time the scrubber moves to an earlier T, not on forward moves", async () => {
    const onScrubBackward = vi.fn();
    flushSync(() => root.render(<ReplayPlayer log={LOG} layout={LAYOUT} onScrubBackward={onScrubBackward} />));
    const range = (await findByTestId("scrubber-range")) as HTMLInputElement;

    setRangeValue(range, "0.5");
    expect(onScrubBackward).not.toHaveBeenCalled();

    setRangeValue(range, "0.1");
    expect(onScrubBackward).toHaveBeenCalledOnce();

    setRangeValue(range, "0.05");
    expect(onScrubBackward).toHaveBeenCalledOnce(); // fires once, not every subsequent backward move
  });
});
