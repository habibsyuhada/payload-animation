import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefenseGrid } from "../src/screens/DefenseGrid.js";
import { useDefenseGridStore } from "../src/state/defenseGridStore.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useDefenseGridStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(<DefenseGrid />));
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

async function waitForNodeCount(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (page.getByTestId("grid-node").elements().length !== count) {
      throw new Error(`expected ${count} nodes`);
    }
  });
}

async function waitForEdgeCount(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (page.getByTestId("grid-edge").elements().length !== count) {
      throw new Error(`expected ${count} edges`);
    }
  });
}

const VIEWBOX_WIDTH = 560;
const VIEWBOX_HEIGHT = 500;

/** x/y are in the SVG's own viewBox units (matching the positions baked into defenseGridStore's
 * INITIAL_NODES) — converted to actual screen coordinates via the rendered/viewBox size ratio,
 * mirroring the DefenseGrid component's own clientToSvgPoint (see its comment: the rendered pixel
 * box is very unlikely to equal the viewBox 1:1, `preserveAspectRatio="none"` keeps this a simple
 * per-axis ratio with no letterboxing offset to account for). */
function clickCanvasAt(x: number, y: number): void {
  const canvas = page.getByTestId("grid-canvas").element() as SVGSVGElement;
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + x * (rect.width / VIEWBOX_WIDTH);
  const clientY = rect.top + y * (rect.height / VIEWBOX_HEIGHT);
  canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
}

function nodeGroup(id: number): SVGGElement {
  return document.querySelector(`[data-node-id="${id}"]`) as SVGGElement;
}

function tapNode(id: number): void {
  const group = nodeGroup(id);
  group.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1, pointerId: 1 }));
  group.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 1, clientY: 1, pointerId: 1 }));
}

function dragNode(id: number, dxClient: number, dyClient: number): void {
  const group = nodeGroup(id);
  const startX = 100;
  const startY = 100;
  group.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: startY, pointerId: 2 }));
  document.querySelector("[data-testid=grid-canvas]")!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 2 }));
  group.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 2 }));
}

describe("DefenseGrid", () => {
  it("starts with exactly 3 fixed nodes (2 Entry + 1 Core) and no edges", async () => {
    await waitForNodeCount(3);
    const edges = page.getByTestId("grid-edge").elements();
    expect(edges).toHaveLength(0);
  });

  it("reports an unreachable-entry validation error initially (no edges at all)", async () => {
    const panel = await findByTestId("validation-panel");
    expect(panel.textContent).toContain("has no path to core");
  });

  it("places a new node on the canvas after picking a palette type and clicking", async () => {
    await page.getByText("Router (1pt+)").click();
    clickCanvasAt(250, 250);
    await waitForNodeCount(4);
    const budgetText = await findByTestId("defense-budget-text");
    expect(budgetText.textContent).toContain("1 / 20 pt");
  });

  it("shows a tier selector for tiered node types but not for Router", async () => {
    await page.getByText("Router (1pt+)").click();
    expect(page.getByTestId("pending-tier-select").elements()).toHaveLength(0);
    await page.getByText("Router (1pt+)").click(); // toggle off
    await page.getByText("Firewall (3pt+)").click();
    await findByTestId("pending-tier-select");
  });

  it("removes a placed node via its remove marker, taking its edges with it", async () => {
    await page.getByText("Router (1pt+)").click();
    clickCanvasAt(250, 250);
    await waitForNodeCount(4);
    await page.getByTestId("grid-node-remove").click();
    await waitForNodeCount(3);
  });

  it("links two nodes into an edge on tap-tap, and un-links on tap-tap again", async () => {
    await page.getByText("Router (1pt+)").click();
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);

    tapNode(2); // entry 1
    tapNode(4); // the new router
    await waitForEdgeCount(1);

    tapNode(4);
    tapNode(2);
    await waitForEdgeCount(0);
  });

  it("moves a placed node when dragged, changing its rendered position", async () => {
    await page.getByText("Router (1pt+)").click();
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);
    const before = nodeGroup(4).querySelector("circle")!;
    const beforeCx = before.getAttribute("cx");

    dragNode(4, 60, 20);

    await vi.waitFor(() => {
      const after = nodeGroup(4).querySelector("circle")!;
      if (after.getAttribute("cx") === beforeCx) {
        throw new Error("node has not moved yet");
      }
    });
  });

  it("does not move or select fixed Core/Entry nodes when dragged", async () => {
    const before = nodeGroup(1).querySelector("circle")!; // core
    const beforeCx = before.getAttribute("cx");
    const beforeCy = before.getAttribute("cy");
    dragNode(1, 80, 80);
    // give any (incorrect) move a moment to have applied, then assert it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = nodeGroup(1).querySelector("circle")!;
    expect(after.getAttribute("cx")).toBe(beforeCx);
    expect(after.getAttribute("cy")).toBe(beforeCy);
  });

  it("zooms in and out via the zoom buttons", async () => {
    const level = await findByTestId("zoom-level");
    expect(level.textContent).toBe("100%");
    await page.getByTestId("zoom-in").click();
    expect((await findByTestId("zoom-level")).textContent).toBe("125%");
    await page.getByTestId("zoom-out").click();
    await page.getByTestId("zoom-out").click();
    expect((await findByTestId("zoom-level")).textContent).toBe("75%");
  });

  it("disables Save until the topology is valid, then saves once both entries reach Core", async () => {
    const saveButton = (await findByTestId("save-defense")) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await page.getByText("Router (1pt+)").click();
    clickCanvasAt(260, 250); // far enough from every fixed node to keep every edge within [200, 2000] DU
    await waitForNodeCount(4);

    tapNode(2);
    tapNode(4);
    await waitForEdgeCount(1);
    tapNode(3);
    tapNode(4);
    await waitForEdgeCount(2);
    tapNode(4);
    tapNode(1);
    await waitForEdgeCount(3);

    await vi.waitFor(() => {
      const status = page.getByTestId("validation-status").query();
      if (!status) {
        throw new Error("not valid yet");
      }
    });

    const button = (await findByTestId("save-defense")) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await page.getByTestId("save-defense").click();
    const confirmation = await findByTestId("save-confirmation");
    expect(confirmation.textContent).toContain("4 node, 3 edge");
  });
});
