import { compileTimeline, drawFrame, type DrawContext2D, type Layout, type Timeline } from "@payload/replay";
import type { BattleLog } from "@payload/sim";
import { Scrubber } from "@payload/ui";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * ReplayPlayer — wires packages/replay's pure (timeline, T) renderer and packages/ui's Scrubber
 * into an actual playable screen component. Lives in apps/client (not packages/ui) because it
 * needs both @payload/replay and @payload/ui together, and `ui` may only import `shared`
 * (eslint.config.js boundaries) — only an `app` is allowed to reach across both.
 */
export interface ReplayPlayerProps {
  readonly log: BattleLog;
  readonly layout: Layout;
  readonly width?: number;
  readonly height?: number;
  /** Fires the first time the user drags the scrubber to an earlier T than it was previously at — C3.4's onboarding uses this to require a backward scrub before continuing. */
  readonly onScrubBackward?: () => void;
}

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 360;

function outcomeLabel(log: BattleLog): string {
  return log.result.winner === "attacker" ? "Menang" : "Kalah (bertahan/timeout)";
}

export function ReplayPlayer({ log, layout, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, onScrubBackward }: ReplayPlayerProps): JSX.Element {
  const timeline: Timeline = useMemo(() => compileTimeline(log, layout), [log, layout]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const hasScrubbedBackward = useRef(false);

  useEffect(() => {
    setCurrentSeconds(0);
    hasScrubbedBackward.current = false;
    setIsPlaying(false);
  }, [timeline]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    // CanvasRenderingContext2D's fillStyle/strokeStyle accept CanvasGradient/CanvasPattern too;
    // DrawContext2D only ever assigns plain color strings to them (see draw.ts), so a real 2D
    // context always structurally satisfies the narrower interface at runtime.
    drawFrame(timeline, currentSeconds, ctx as unknown as DrawContext2D);
  }, [timeline, currentSeconds]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId: number;
    let lastTimestampMs: number | null = null;
    const tick = (timestampMs: number): void => {
      if (lastTimestampMs !== null) {
        const deltaSeconds = ((timestampMs - lastTimestampMs) / 1000) * speed;
        setCurrentSeconds((previous) => {
          const next = previous + deltaSeconds;
          if (next >= timeline.durationSeconds) {
            setIsPlaying(false);
            return timeline.durationSeconds;
          }
          return next;
        });
      }
      lastTimestampMs = timestampMs;
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, speed, timeline.durationSeconds]);

  function handleSeek(seconds: number): void {
    if (seconds < currentSeconds - 0.01 && !hasScrubbedBackward.current) {
      hasScrubbedBackward.current = true;
      onScrubBackward?.();
    }
    setCurrentSeconds(seconds);
  }

  return (
    <div className="payload-replay-player" data-testid="replay-player">
      <canvas ref={canvasRef} width={width} height={height} data-testid="replay-canvas" />
      <p data-testid="replay-outcome">{outcomeLabel(log)} — score {log.result.score.value}</p>
      <button type="button" data-testid="replay-play-pause" onClick={() => setIsPlaying((playing) => !playing)}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <Scrubber durationSeconds={timeline.durationSeconds} currentSeconds={currentSeconds} markers={timeline.markers} speed={speed} onSeek={handleSeek} onSpeedChange={setSpeed} />
    </div>
  );
}
