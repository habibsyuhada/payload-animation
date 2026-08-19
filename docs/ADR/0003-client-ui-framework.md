# ADR 0003 — Client UI framework: React (packages/ui, apps/client) (R2.4)

**Status:** accepted
**Context:** `packages/ui/`, `apps/client/` (PLAN.md Fase 2/3)

## Problem

PLAN.md commits to a stack in a few places — Vite, Capacitor, "state via zustand" (C3.1),
"komponen scrubber (packages/ui)" with Playwright interaction tests (R2.4) — but never actually
names a UI framework. `packages/ui` and `apps/client` were still empty scaffolds (F0.1) with no
DOM library, no JSX config, nothing rendering. R2.4 needs one concrete component that survives
into C3.1's shell app, so this can't stay implicit any longer.

## Decision

**React 18, function components + hooks, no framework-specific state library beyond zustand for
app-level state (as PLAN.md already names).** Reasons:

1. **Zustand's decision is already made in PLAN.md** ("state via zustand", C3.1) — zustand is
   framework-agnostic but its docs, ecosystem, and the vast majority of real-world usage assume
   React; picking anything else for the view layer would make that line of PLAN.md need its own
   follow-up decision instead of just working.
2. **Capacitor's own docs and starter templates are React/Vue/Angular-first** — React has the
   most direct path from "Vite web app" to "Capacitor Android wrap" (C3.5) with the fewest
   surprises, and the widest pool of Canvas-2D-in-React patterns for wrapping `packages/replay`'s
   `drawFrame` in a component (the replay viewer screen embeds a `<canvas>` and drives it with a
   `requestAnimationFrame` loop calling `drawFrame`, not a React-managed DOM tree — React only
   owns the chrome around it: scrubber, HUD, screens).
3. **Testability matches the rest of the repo's pattern.** `packages/sim`'s S1.6 already
   established real-browser testing via `@vitest/browser` + the Playwright provider (chromium) for
   determinism; `packages/ui` reuses the identical `vitest.config.ts` shape for its browser project,
   so R2.4's "Playwright test interaksi" requirement is satisfied with no new test runner.

## Consequences

- `packages/ui` gains real runtime dependencies for the first time: `react`, `react-dom`. This is
  a deliberate boundary: `packages/sim` and `packages/replay` stay framework-free (sim is
  literally zero-dep; replay only depends on sim's types) — only `packages/ui` and `apps/client`
  ever import React, matching `eslint.config.js`'s existing `boundaries/element-types` (`ui` may
  only import `shared`; nothing in `sim`/`replay` may import `ui`).
- Components in `packages/ui` take **plain data props**, never `@payload/replay`'s or
  `@payload/sim`'s types directly (the scrubber's `ScrubberMarker` is its own local shape, not
  `TimelineMarker`) — this is already enforced by the boundaries rule (`ui` can't import `replay`
  or `sim`), and keeps `packages/ui` reusable outside the replay viewer if a future screen needs a
  scrubber-shaped control for something else.
- `packages/ui`'s `tsconfig.json` diverges from the rest of the monorepo's Node/browser-portable
  `lib: ["ES2022"]` base by adding `"DOM"` and `"jsx": "react-jsx"` — scoped to this one package,
  since it's the only one whose code actually runs against a DOM.
- No CSS framework/styling library decision is made here — R2.4's scrubber uses plain inline
  styles / a `<style>` tag scoped by class name, deferred properly to C3.1's "tema visual (palet
  GDD §11)" once there's an actual design system to apply consistently.
