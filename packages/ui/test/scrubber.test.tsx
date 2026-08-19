import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scrubber, type ScrubberMarker, type ScrubberProps } from "../src/scrubber.js";

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

const MARKERS: ScrubberMarker[] = [
  { t: 2, kind: "damage", label: "Firewall deals 20 damage" },
  { t: 8, kind: "died", label: "virus died" },
];

function renderScrubber(overrides: Partial<ScrubberProps> = {}): ScrubberProps {
  const props: ScrubberProps = {
    durationSeconds: 10,
    currentSeconds: 0,
    markers: MARKERS,
    speed: 1,
    onSeek: vi.fn(),
    onSpeedChange: vi.fn(),
    ...overrides,
  };
  flushSync(() => root.render(<Scrubber {...props} />));
  return props;
}

/** input[type=range] is a React-controlled input — set the native value then fire the same
 * 'input' event React listens for, rather than relying on a text-input-shaped `.fill()`. */
function setRangeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Locator#element()/#all() read the DOM synchronously with no retry, unlike interaction methods
 * (click/fill), which poll until the target shows up. React's commit can land a tick after
 * `flushSync` returns in this browser runtime, so every direct DOM read here goes through
 * `vi.waitFor` to poll for it instead of racing the very first paint. */
async function findElement(testId: string): Promise<Element> {
  return vi.waitFor(() => {
    const element = page.getByTestId(testId).query();
    if (!element) {
      throw new Error(`element not yet in the DOM: ${testId}`);
    }
    return element;
  });
}

async function findAllElements(testId: string): Promise<Element[]> {
  return vi.waitFor(() => {
    const elements = page.getByTestId(testId).elements();
    if (elements.length === 0) {
      throw new Error(`no elements yet in the DOM: ${testId}`);
    }
    return elements;
  });
}

describe("Scrubber", () => {
  it("renders a range input spanning [0, durationSeconds] at the current position", async () => {
    renderScrubber({ durationSeconds: 12.5, currentSeconds: 4 });
    const input = (await findElement("scrubber-range")) as HTMLInputElement;
    expect(input.min).toBe("0");
    expect(input.max).toBe("12.5");
    expect(input.value).toBe("4");
  });

  it("calls onSeek with the dragged value when the range input changes", async () => {
    const props = renderScrubber({ durationSeconds: 10, currentSeconds: 0 });
    const input = (await findElement("scrubber-range")) as HTMLInputElement;
    setRangeValue(input, "6.5");
    expect(props.onSeek).toHaveBeenCalledWith(6.5);
  });

  it("never forwards a seek beyond the duration, even for a raw out-of-range input value", async () => {
    const props = renderScrubber({ durationSeconds: 10, currentSeconds: 0 });
    const input = (await findElement("scrubber-range")) as HTMLInputElement;
    setRangeValue(input, "999");
    expect(props.onSeek).toHaveBeenCalledWith(10);
  });

  it("renders one marker button per event, positioned along the track", async () => {
    renderScrubber({ durationSeconds: 10, markers: MARKERS });
    const markerButtons = await findAllElements("scrubber-marker");
    expect(markerButtons).toHaveLength(2);
  });

  it("seeks to a marker's own time when its button is clicked", async () => {
    const props = renderScrubber({ durationSeconds: 10, markers: MARKERS });
    const diedMarker = page.getByRole("button", { name: "virus died" });
    await diedMarker.click();
    expect(props.onSeek).toHaveBeenCalledWith(8);
  });

  it("highlights the active speed and disables re-selecting it", async () => {
    renderScrubber({ speed: 1.5, speedOptions: [0.5, 1, 1.5, 2] });
    const speedButtons = await findAllElements("scrubber-speed");
    const active = speedButtons[2] as HTMLButtonElement;
    expect(active.textContent).toBe("1.5x");
    expect(active.disabled).toBe(true);
    expect(active.getAttribute("aria-pressed")).toBe("true");
  });

  it("calls onSpeedChange when a different speed is clicked", async () => {
    const props = renderScrubber({ speed: 1, speedOptions: [0.5, 1, 2] });
    await page.getByRole("button", { name: "2x" }).click();
    expect(props.onSpeedChange).toHaveBeenCalledWith(2);
  });

  it("omits the critical-moment button when no handler is given", async () => {
    renderScrubber({});
    await findElement("scrubber-range"); // wait for this render to have actually landed...
    const buttons = page.getByTestId("scrubber-critical-moment").elements();
    expect(buttons).toHaveLength(0); // ...then confirm the optional button really is absent, not just not-yet-painted.
  });

  it("calls onJumpToCriticalMoment when the shortcut button is present and clicked", async () => {
    const onJumpToCriticalMoment = vi.fn();
    renderScrubber({ onJumpToCriticalMoment });
    await page.getByTestId("scrubber-critical-moment").click();
    expect(onJumpToCriticalMoment).toHaveBeenCalledOnce();
  });
});
