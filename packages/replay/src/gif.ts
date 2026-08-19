/**
 * gif.ts — a small, self-contained GIF89a encoder (R2.5's fallback export path for browsers/
 * webviews without `MediaRecorder`'s WebM support). Deliberately hand-rolled rather than an added
 * npm dependency, matching packages/replay's existing boundary (only `@payload/sim`'s TYPES) and
 * packages/sim's own "zero deps" precedent — the algorithm itself (LZW + a fixed quantized
 * palette) is small and fully unit-testable in plain Node, unlike WebM export's MediaRecorder path
 * which genuinely needs a browser.
 *
 * Honest limitation, documented rather than hidden (same spirit as RULESET.md §9's balance notes):
 * color reduction here is *uniform quantization* (each RGB channel rounded to one of
 * `LEVELS_PER_CHANNEL` levels), not a proper per-image adaptive palette (e.g. median-cut). This is
 * visibly coarser for gradient-heavy frames, but the scenes drawFrame produces are mostly flat
 * fills (a small, fixed set of node/virus/effect colors — see draw.ts's NODE_COLOR etc.) plus a
 * handful of alpha-blended overlays, which is exactly the case uniform quantization handles well.
 * GIF is the fallback path (WebM is preferred whenever supported), so this trade-off is scoped to
 * a rarely-hit code path rather than the primary export quality.
 */

export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface GifFrame {
  /** RGBA bytes, e.g. straight from `ImageData.data` — 4 bytes/pixel, `width * height * 4` long. */
  readonly rgba: Uint8ClampedArray | Uint8Array;
  readonly delayCentiseconds: number;
}

const LEVELS_PER_CHANNEL = 6;
const PALETTE_SIZE = LEVELS_PER_CHANNEL ** 3; // 216 — always a strict subset of a byte, so table size below is fixed at 256.
const GLOBAL_COLOR_TABLE_SIZE = 256;
const GLOBAL_COLOR_TABLE_BITS = 8;

function quantizeChannel(value: number): number {
  const level = Math.round((value / 255) * (LEVELS_PER_CHANNEL - 1));
  return Math.max(0, Math.min(LEVELS_PER_CHANNEL - 1, level));
}

/** Maps an arbitrary 24-bit color to one of the fixed palette's `PALETTE_SIZE` deterministic entries. */
export function paletteIndexFor(r: number, g: number, b: number): number {
  const rLevel = quantizeChannel(r);
  const gLevel = quantizeChannel(g);
  const bLevel = quantizeChannel(b);
  return rLevel * LEVELS_PER_CHANNEL * LEVELS_PER_CHANNEL + gLevel * LEVELS_PER_CHANNEL + bLevel;
}

/** The fixed global palette itself (216 real entries, padded to 256 with black for a valid 8-bit color table). */
export function buildGlobalPalette(): readonly RGB[] {
  const palette: RGB[] = [];
  for (let rLevel = 0; rLevel < LEVELS_PER_CHANNEL; rLevel += 1) {
    for (let gLevel = 0; gLevel < LEVELS_PER_CHANNEL; gLevel += 1) {
      for (let bLevel = 0; bLevel < LEVELS_PER_CHANNEL; bLevel += 1) {
        palette.push({
          r: Math.round((rLevel / (LEVELS_PER_CHANNEL - 1)) * 255),
          g: Math.round((gLevel / (LEVELS_PER_CHANNEL - 1)) * 255),
          b: Math.round((bLevel / (LEVELS_PER_CHANNEL - 1)) * 255),
        });
      }
    }
  }
  if (palette.length !== PALETTE_SIZE) {
    throw new Error(`buildGlobalPalette: expected ${PALETTE_SIZE} real entries, built ${palette.length}`);
  }
  while (palette.length < GLOBAL_COLOR_TABLE_SIZE) {
    palette.push({ r: 0, g: 0, b: 0 });
  }
  return palette;
}

/** Flattens one frame's RGBA pixels down to palette indices (alpha is ignored — GIF here has no transparency; drawFrame always paints an opaque background, see draw.ts). */
export function quantizeFrame(rgba: Uint8ClampedArray | Uint8Array, pixelCount: number): Uint8Array {
  const indices = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    indices[pixel] = paletteIndexFor(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!);
  }
  return indices;
}

class BitWriter {
  private readonly bytes: number[] = [];
  private accumulator = 0;
  private bitsInAccumulator = 0;

  writeCode(code: number, codeSize: number): void {
    this.accumulator |= code << this.bitsInAccumulator;
    this.bitsInAccumulator += codeSize;
    while (this.bitsInAccumulator >= 8) {
      this.bytes.push(this.accumulator & 0xff);
      this.accumulator >>= 8;
      this.bitsInAccumulator -= 8;
    }
  }

  finish(): Uint8Array {
    if (this.bitsInAccumulator > 0) {
      this.bytes.push(this.accumulator & 0xff);
      this.accumulator = 0;
      this.bitsInAccumulator = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

/** Variable-width LZW as GIF89a §"Table Based Image Data" specifies: codes packed LSB-first, code
 * width grows from `minCodeSize + 1` up to 12 bits, and the dictionary resets (emitting a Clear
 * code) once it would overflow 4096 entries. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endOfInformationCode = clearCode + 1;
  const writer = new BitWriter();

  let dict = new Map<string, number>();
  let nextCode = 0;
  let codeSize = 0;

  const resetDict = (): void => {
    dict = new Map<string, number>();
    for (let value = 0; value < clearCode; value += 1) {
      dict.set(String.fromCharCode(value), value);
    }
    nextCode = endOfInformationCode + 1;
    codeSize = minCodeSize + 1;
  };

  resetDict();
  writer.writeCode(clearCode, codeSize);

  let sequence = "";
  for (const index of indices) {
    const extended = sequence + String.fromCharCode(index);
    if (dict.has(extended)) {
      sequence = extended;
      continue;
    }
    writer.writeCode(dict.get(sequence)!, codeSize);
    dict.set(extended, nextCode);
    nextCode += 1;
    // GIF-LZW's well-known "early change": the code size grows one code sooner than the naive
    // `nextCode === 1 << codeSize` derivation would suggest, because the decoder only learns
    // about each new dictionary entry a step after the encoder does (it can't know `prefix+char`
    // until it has decoded `prefix`'s own code) — without this, encoder and decoder codeSize
    // diverge by exactly one entry the moment growth would otherwise trigger.
    if (nextCode === (1 << codeSize) - 1 && codeSize < 12) {
      codeSize += 1;
    }
    if (nextCode >= 4095) {
      writer.writeCode(clearCode, codeSize);
      resetDict();
    }
    sequence = String.fromCharCode(index);
  }
  if (sequence !== "") {
    writer.writeCode(dict.get(sequence)!, codeSize);
  }
  writer.writeCode(endOfInformationCode, codeSize);

  return writer.finish();
}

function pushString(out: number[], text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    out.push(text.charCodeAt(i));
  }
}

function pushUint16LE(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

/** Splits a raw LZW byte stream into GIF's length-prefixed sub-blocks (max 255 bytes each, terminated by a zero-length block). */
function pushSubBlocks(out: number[], data: Uint8Array): void {
  let offset = 0;
  while (offset < data.length) {
    const chunkSize = Math.min(255, data.length - offset);
    out.push(chunkSize);
    for (let i = 0; i < chunkSize; i += 1) {
      out.push(data[offset + i]!);
    }
    offset += chunkSize;
  }
  out.push(0);
}

/**
 * Encodes an animated GIF89a from RGBA frames, using one shared global color table (see module
 * doc) so every frame reuses the same palette instead of needing a local color table each time.
 */
export function encodeGif(frames: readonly GifFrame[], width: number, height: number): Uint8Array {
  if (frames.length === 0) {
    throw new Error("encodeGif: at least one frame is required");
  }
  const palette = buildGlobalPalette();
  const out: number[] = [];

  pushString(out, "GIF89a");
  pushUint16LE(out, width);
  pushUint16LE(out, height);
  // Global Color Table follows, flag set, color resolution + GCT size both = 8 bits, no sort/background/aspect concerns for this use case.
  out.push(0b1111_0_111);
  out.push(0); // background color index
  out.push(0); // pixel aspect ratio (unused)
  for (const { r, g, b } of palette) {
    out.push(r, g, b);
  }

  // Netscape Application Extension — loop forever.
  out.push(0x21, 0xff, 0x0b);
  pushString(out, "NETSCAPE2.0");
  out.push(3, 1, 0, 0, 0);

  for (const frame of frames) {
    const pixelCount = width * height;
    const indices = quantizeFrame(frame.rgba, pixelCount);

    // Graphic Control Extension: no transparency/disposal beyond "leave as is", frame delay in centiseconds.
    out.push(0x21, 0xf9, 4, 0b0000_0100);
    pushUint16LE(out, frame.delayCentiseconds);
    out.push(0, 0);

    // Image Descriptor: full-frame, no local color table.
    out.push(0x2c);
    pushUint16LE(out, 0);
    pushUint16LE(out, 0);
    pushUint16LE(out, width);
    pushUint16LE(out, height);
    out.push(0);

    const minCodeSize = GLOBAL_COLOR_TABLE_BITS;
    out.push(minCodeSize);
    pushSubBlocks(out, lzwEncode(indices, minCodeSize));
  }

  out.push(0x3b); // trailer
  return Uint8Array.from(out);
}
