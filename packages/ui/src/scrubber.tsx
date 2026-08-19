/**
 * Scrubber — PLAN.md R2.4: bar + markers + speed control + "critical moment" shortcut.
 *
 * A fully controlled component (ADR 0003): it owns no state of its own, only plain data props and
 * callbacks. It never imports @payload/replay's `Timeline`/`TimelineMarker` types directly — the
 * boundaries rule in eslint.config.js already forbids `ui` importing `replay`, and keeping the
 * marker shape local (`ScrubberMarker`) means this component isn't tied to BattleLog replays
 * specifically, just anything with a duration and some labeled instants along it.
 */
export interface ScrubberMarker {
  readonly t: number;
  readonly kind: string;
  readonly label: string;
}

export interface ScrubberProps {
  readonly durationSeconds: number;
  readonly currentSeconds: number;
  readonly markers: readonly ScrubberMarker[];
  readonly speed: number;
  readonly speedOptions?: readonly number[];
  readonly onSeek: (seconds: number) => void;
  readonly onSpeedChange: (speed: number) => void;
  /** The GDD's "Kenapa aku kalah?" shortcut (ADR-adjacent: packages/replay's `deathMoment()` computes the target, this just renders the button). Omit to hide it entirely. */
  readonly onJumpToCriticalMoment?: () => void;
}

const DEFAULT_SPEED_OPTIONS: readonly number[] = [0.5, 1, 1.5, 2];

function clampSeconds(value: number, durationSeconds: number): number {
  return Math.max(0, Math.min(durationSeconds, value));
}

export function Scrubber(props: ScrubberProps): JSX.Element {
  const speedOptions = props.speedOptions ?? DEFAULT_SPEED_OPTIONS;
  const duration = Math.max(props.durationSeconds, 0);

  return (
    <div className="payload-scrubber" data-testid="scrubber">
      <div className="payload-scrubber-track" style={{ position: "relative" }}>
        <input
          type="range"
          data-testid="scrubber-range"
          min={0}
          max={duration}
          step={0.01}
          value={clampSeconds(props.currentSeconds, duration)}
          onChange={(event) => props.onSeek(clampSeconds(Number(event.target.value), duration))}
          style={{ width: "100%" }}
        />
        {duration > 0 &&
          props.markers.map((marker, index) => (
            <button
              key={`${marker.kind}-${marker.t}-${index}`}
              type="button"
              data-testid="scrubber-marker"
              data-marker-kind={marker.kind}
              title={marker.label}
              aria-label={marker.label}
              onClick={() => props.onSeek(clampSeconds(marker.t, duration))}
              className="payload-scrubber-marker"
              style={{
                position: "absolute",
                top: 0,
                left: `${(clampSeconds(marker.t, duration) / duration) * 100}%`,
                transform: "translateX(-50%)",
              }}
            />
          ))}
      </div>

      <div className="payload-scrubber-controls">
        <div className="payload-scrubber-speeds" role="group" aria-label="Playback speed">
          {speedOptions.map((option) => (
            <button
              key={option}
              type="button"
              data-testid="scrubber-speed"
              data-speed={option}
              aria-pressed={option === props.speed}
              disabled={option === props.speed}
              onClick={() => props.onSpeedChange(option)}
            >
              {option}x
            </button>
          ))}
        </div>

        {props.onJumpToCriticalMoment && (
          <button type="button" data-testid="scrubber-critical-moment" onClick={props.onJumpToCriticalMoment}>
            Kenapa aku kalah?
          </button>
        )}
      </div>
    </div>
  );
}
