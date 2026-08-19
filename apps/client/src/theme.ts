/**
 * theme.ts — C3.1: the client shell's visual palette (GDD §11 "gelap, near-black biru" + §4.2's
 * per-faction block colors). Single source of truth: `applyTheme()` writes these as CSS custom
 * properties on the document root, and `theme.css` consumes them via `var(--color-*)` — so a
 * future palette tweak only ever happens here, not in two places that can drift.
 *
 * These are independent of packages/replay/src/draw.ts's own color constants (NODE_COLOR,
 * BACKGROUND_COLOR etc.) even where hues coincide — the boundaries rule (eslint.config.js) forbids
 * `ui`/`app` code sharing a module with `replay`'s internals, and the two are conceptually
 * different anyway (defense-node rendering colors vs. UI chrome/block-category colors).
 */
export const theme = {
  background: "#12141c",
  backgroundPanel: "#1a1e2a",
  backgroundPanelRaised: "#232838",
  text: "#eaf6ff",
  textMuted: "#8892a6",
  border: "#2a3040",
  /** GDD §4.2 — logic block category colors. */
  faction: {
    movement: "#4d8dff",
    sensor: "#f5d547",
    condition: "#b479f0",
    attack: "#ff5a5a",
    stealth: "#4ade80",
    utility: "#9aa3b2",
  },
} as const;

export type Theme = typeof theme;

function toCssVar(name: string): string {
  return `--color-${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

/** Writes every palette entry as a `--color-*` custom property on `root` (defaults to the document root). Flat entries become `--color-background`; nested faction entries become `--color-faction-movement`, etc. */
export function applyTheme(root: HTMLElement = document.documentElement, source: Theme = theme): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      root.style.setProperty(toCssVar(key), value);
    } else {
      for (const [factionKey, factionValue] of Object.entries(value)) {
        root.style.setProperty(toCssVar(`faction-${factionKey}`), factionValue);
      }
    }
  }
}
