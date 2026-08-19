import { drawFrame, type DrawContext2D } from "./draw.js";
import { encodeGif, type GifFrame } from "./gif.js";
import type { Timeline } from "./compile.js";

/**
 * export.ts — PLAN.md R2.5: render a Timeline offscreen, frame by frame, into a shareable file.
 * WebM (via the browser's own `MediaRecorder`) is the preferred path; GIF (gif.ts, in-house — see
 * its module doc) is the fallback for a webview without WebM support. Unlike draw.ts/camera.ts,
 * this module is unapologetically browser-only (`HTMLCanvasElement`, `MediaRecorder`) — there's no
 * portable way to encode video/GIF without one, so it's the one file in packages/replay allowed to
 * assume DOM types are available.
 */

export interface ExportOptions {
  readonly width: number;
  readonly height: number;
  /** Frames per second to sample the Timeline at. WebM default (24) favors smoothness; GIF's own default (12) favors file size, since GIF has no inter-frame compression. */
  readonly fps?: number;
}

const DEFAULT_WEBM_FPS = 24;
const DEFAULT_GIF_FPS = 12;

function frameTimes(durationSeconds: number, fps: number): number[] {
  const frameCount = Math.max(1, Math.ceil(durationSeconds * fps));
  const times: number[] = [];
  for (let i = 0; i <= frameCount; i += 1) {
    times.push(Math.min(durationSeconds, i / fps));
  }
  return times;
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("export: canvas has no 2D context");
  }
  return ctx;
}

/** Feature-detects the WebM path — callers should check this before offering it, and fall back to `exportToGif` otherwise (webviews on some mobile platforms lack `MediaRecorder` entirely, per PLAN.md R2.5's "fallback GIF"). */
export function isWebMExportSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("video/webm");
}

/** `captureStream()` and `CanvasCaptureMediaStreamTrack.requestFrame()` are both real, widely
 * supported browser APIs, but the manual-frame-mode signatures aren't in lib.dom.d.ts — declared
 * narrowly here rather than pulling in a whole extra lib.
 */
interface CaptureStreamCanvas extends HTMLCanvasElement {
  captureStream(frameRate?: number): MediaStream;
}
interface ManualFrameTrack extends MediaStreamTrack {
  requestFrame(): void;
}

/**
 * Renders the Timeline onto `canvas` and encodes it to WebM. Uses `captureStream(0)` (manual
 * frame mode) plus `track.requestFrame()` so every encoded frame corresponds to an exact,
 * intentional `drawFrame` call rather than whatever the stream happens to sample off wall-clock
 * timing — the same "don't let real-time jitter leak into the output" instinct as the sim's own
 * determinism work, applied to video capture instead of tick math.
 */
export async function exportToWebM(timeline: Timeline, canvas: HTMLCanvasElement, options: ExportOptions): Promise<Blob> {
  if (!isWebMExportSupported()) {
    throw new Error("export: WebM is not supported in this environment — use exportToGif instead");
  }
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = get2dContext(canvas);
  const fps = options.fps ?? DEFAULT_WEBM_FPS;

  const captureCanvas = canvas as CaptureStreamCanvas;
  const stream = captureCanvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as ManualFrameTrack | undefined;
  if (!track) {
    throw new Error("export: canvas.captureStream() produced no video track");
  }

  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => reject((event as unknown as { error?: Error }).error ?? new Error("export: MediaRecorder error"));
  });

  recorder.start();
  for (const t of frameTimes(timeline.durationSeconds, fps)) {
    drawFrame(timeline, t, ctx as unknown as DrawContext2D);
    track.requestFrame();
    // yield to the event loop so MediaRecorder actually ingests the requested frame before the next draw overwrites the canvas.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  recorder.stop();
  await stopped;

  return new Blob(chunks, { type: "video/webm" });
}

/** Renders the Timeline onto `canvas` and encodes it to an animated GIF (gif.ts) — the fallback path when `isWebMExportSupported()` is false. Synchronous: unlike WebM, there's no realtime media pipeline to wait on, just draw-then-read-pixels per frame. */
export function exportToGif(timeline: Timeline, canvas: HTMLCanvasElement, options: ExportOptions): Uint8Array {
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = get2dContext(canvas);
  const fps = options.fps ?? DEFAULT_GIF_FPS;
  const delayCentiseconds = Math.max(1, Math.round(100 / fps));

  const frames: GifFrame[] = [];
  for (const t of frameTimes(timeline.durationSeconds, fps)) {
    drawFrame(timeline, t, ctx as unknown as DrawContext2D);
    const imageData = ctx.getImageData(0, 0, options.width, options.height);
    frames.push({ rgba: imageData.data, delayCentiseconds });
  }

  return encodeGif(frames, options.width, options.height);
}

/** Picks WebM when supported, GIF otherwise — the one-call convenience PLAN.md's "WebM + fallback GIF" describes. */
export async function exportReplay(timeline: Timeline, canvas: HTMLCanvasElement, options: ExportOptions): Promise<{ format: "webm"; blob: Blob } | { format: "gif"; bytes: Uint8Array }> {
  if (isWebMExportSupported()) {
    return { format: "webm", blob: await exportToWebM(timeline, canvas, options) };
  }
  return { format: "gif", bytes: exportToGif(timeline, canvas, options) };
}
