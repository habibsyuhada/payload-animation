# ADR 0004 — Export pipeline: opaque background, in-house GIF encoder (R2.5)

**Status:** accepted
**Context:** `packages/replay/src/export.ts`, `packages/replay/src/gif.ts`, `packages/replay/src/draw.ts`

## Problem

R2.5 needs `drawFrame`'s output turned into an actual shareable file — WebM preferred,
GIF as a fallback for a webview without `MediaRecorder` support (PLAN.md). Three concrete
decisions came up that PLAN.md doesn't already settle.

## Decisions

1. **`drawFrame` now paints an opaque background instead of `clearRect`-ing to transparency.**
   `ctx.clearRect` leaves untouched pixels fully transparent (alpha 0); a video/GIF encoder reading
   those pixels back has no "transparent" concept to fall back on, so they'd encode as black holes
   instead of GDD §11's intended "gelap (near-black biru)" background. Rather than have `export.ts`
   work around this externally (e.g. compositing a second canvas underneath), `drawFrame` itself
   now fills `#12141c` every frame — simpler, and arguably more correct for the live-preview case
   too (GDD §11 explicitly calls out that the palette needs to stay "readable... saat di-export ke
   video terkompresi," i.e. this was already an intended constraint on the renderer, not export-only).
   `drawFrame`'s pure-(timeline, T)-function contract and scrub-safety are unaffected — this only
   changes what color the erased pixels are, not the logic.

2. **GIF encoding is hand-rolled (`gif.ts`), not an added npm dependency.** Consistent with
   `packages/sim`'s zero-dependency stance and ADR 0003's boundary (only `packages/ui`/`apps/client`
   take on real runtime dependencies) — `packages/replay` still only depends on `@payload/sim`'s
   types. A GIF89a encoder (LZW + a fixed global color table) is a genuinely small, fully
   unit-testable algorithm (see `gif.test.ts`'s round-trip tests, including a from-scratch decoder
   written purely to verify the encoder), unlike WebM export, which realistically requires a real
   browser's `MediaRecorder`/VP8 encoder — hand-rolling a video codec is out of scope, so that path
   stays a thin wrapper over the platform API instead.
   - **Honest simplification:** color reduction is *uniform quantization* (each RGB channel rounded
     to one of 6 levels, 216 total colors), not a proper adaptive palette. Documented in `gif.ts`'s
     module comment rather than silently shipped — acceptable because GIF is explicitly the
     fallback path (WebM is preferred whenever supported) and drawFrame's actual palette is mostly
     flat fills, the case uniform quantization handles well.
   - **Implementation note for future readers:** GIF-LZW's "early change" quirk (the code-size grows
     one code sooner on the encode side than a naive derivation suggests, and the decoder's own
     dictionary permanently trails the encoder's by exactly one entry) cost real debugging time to
     get right — see the comments at each threshold check in `gif.ts`/`gif.test.ts` before touching
     either.

3. **`packages/replay`'s `tsconfig.json` now includes the `DOM` lib**, scoped to this package only.
   `export.ts` is unapologetically browser-only (`HTMLCanvasElement`, `MediaRecorder`,
   `captureStream`) — there's no portable way to encode video without a real browser. This doesn't
   weaken `draw.ts`/`compile.ts`'s own DOM-independence (ADR-adjacent design note already in
   `draw.ts`'s doc comment): `DrawContext2D` stays a hand-rolled interface rather than
   `CanvasRenderingContext2D`, so those files remain testable without a DOM regardless of what the
   package's `tsconfig` now permits elsewhere.

## Consequences

- `packages/replay`'s test suite is now split Node/browser (mirroring `packages/sim`'s S1.6
  pattern): `pnpm test` (Node, fast) covers `ease`/`compile`/`camera`/`draw`/`gif`; `pnpm
  test:browser` covers `export.ts` against a real Chromium (verifies an actual WebM Blob with the
  correct EBML container magic bytes, not just "didn't throw"). CI's existing
  `determinism-cross-platform` job picks this up for free since it already runs `pnpm test:browser`
  at the repo root.
- `draw.test.ts`'s first assertion changed from checking a `clearRect` call to a `fillRect` with
  `#12141c` — a visible, deliberate behavior change, not a test-only rename.
