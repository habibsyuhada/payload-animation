import { describe, expect, it } from "vitest";
import { buildGlobalPalette, encodeGif, lzwEncode, paletteIndexFor, quantizeFrame, type GifFrame } from "../src/gif.js";

/**
 * gif.ts ships an ENCODER only (R2.5 doesn't need GIF decoding at runtime), so these tests
 * round-trip through a small decoder written here, purely to verify the encoder's own output is
 * spec-correct — the same "don't trust hand math, run it" discipline used for packages/sim's
 * golden logs all session, just applied to a byte format instead of tick numbers.
 */
function lzwDecode(bytes: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endOfInformationCode = clearCode + 1;

  let bitPosition = 0;
  const readCode = (codeSize: number): number => {
    let code = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      const byteIndex = bitPosition >> 3;
      const bitIndex = bitPosition & 7;
      const byte = bytes[byteIndex] ?? 0;
      const bitValue = (byte >> bitIndex) & 1;
      code |= bitValue << bit;
      bitPosition += 1;
    }
    return code;
  };

  let dict: number[][] = [];
  let codeSize = 0;
  const resetDict = (): void => {
    dict = [];
    for (let value = 0; value < clearCode; value += 1) {
      dict.push([value]);
    }
    dict.push([]); // clear code placeholder
    dict.push([]); // end-of-information placeholder
    codeSize = minCodeSize + 1;
  };
  resetDict();

  const output: number[] = [];
  let previous: number[] | null = null;

  for (;;) {
    const code = readCode(codeSize);
    if (code === clearCode) {
      resetDict();
      previous = null;
      continue;
    }
    if (code === endOfInformationCode) {
      break;
    }

    let entry: number[];
    if (code < dict.length && dict[code]!.length > 0) {
      entry = dict[code]!;
    } else if (previous) {
      entry = [...previous, previous[0]!];
    } else {
      throw new Error("lzwDecode: corrupt stream (unknown code with no prior entry)");
    }

    output.push(...entry);

    if (previous) {
      dict.push([...previous, entry[0]!]);
      // A GIF-LZW decoder's dictionary permanently trails the encoder's by exactly one entry: it
      // never adds one for the very first code after a Clear (there's no `previous` yet), while
      // the encoder adds one on every single emission, including its first. Combined with
      // lzwEncode's own "early change" (grows one code sooner than the naive threshold, see its
      // comment), the decoder's growth check needs a *two*-early threshold — not a matching
      // one-early — to land on the exact same code position the encoder grew at.
      if (dict.length === (1 << codeSize) - 2 && codeSize < 12) {
        codeSize += 1;
      }
    }
    previous = entry;
  }

  return output;
}

describe("paletteIndexFor / buildGlobalPalette", () => {
  it("maps pure black to index 0 and pure white to the last real palette entry", () => {
    expect(paletteIndexFor(0, 0, 0)).toBe(0);
    const palette = buildGlobalPalette();
    const whiteIndex = paletteIndexFor(255, 255, 255);
    expect(palette[whiteIndex]).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("builds exactly 256 entries (a valid power-of-two global color table)", () => {
    expect(buildGlobalPalette()).toHaveLength(256);
  });

  it("is deterministic and monotonic per channel", () => {
    const darker = paletteIndexFor(10, 10, 10);
    const lighter = paletteIndexFor(200, 10, 10);
    expect(paletteIndexFor(10, 10, 10)).toBe(darker);
    expect(lighter).not.toBe(darker);
  });

  it("quantizes a frame's RGBA bytes to one palette index per pixel", () => {
    // 2 pixels: pure black, pure white.
    const rgba = Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255]);
    const indices = quantizeFrame(rgba, 2);
    expect(indices).toHaveLength(2);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(paletteIndexFor(255, 255, 255));
  });
});

describe("lzwEncode", () => {
  const MIN_CODE_SIZE = 8;

  it("round-trips a short, varied index sequence", () => {
    const indices = Uint8Array.from([0, 0, 0, 1, 2, 1, 2, 1, 2, 3, 3, 3, 3]);
    const encoded = lzwEncode(indices, MIN_CODE_SIZE);
    expect(lzwDecode(encoded, MIN_CODE_SIZE)).toEqual(Array.from(indices));
  });

  it("round-trips a single-value run", () => {
    const indices = new Uint8Array(50).fill(42);
    const encoded = lzwEncode(indices, MIN_CODE_SIZE);
    expect(lzwDecode(encoded, MIN_CODE_SIZE)).toEqual(Array.from(indices));
  });

  it("round-trips a sequence long enough to force a dictionary reset (>4096 entries)", () => {
    // a deterministic pseudo-varied sequence — repeating a long non-trivial pattern keeps growing
    // the dictionary past 4096 distinct substrings, exercising the Clear-code reset path.
    const pattern = Array.from({ length: 37 }, (_, i) => (i * 13) % 216);
    const indices = Uint8Array.from(Array.from({ length: 6000 }, (_, i) => pattern[i % pattern.length]!));
    const encoded = lzwEncode(indices, MIN_CODE_SIZE);
    expect(lzwDecode(encoded, MIN_CODE_SIZE)).toEqual(Array.from(indices));
  });

  it("round-trips a single-pixel sequence", () => {
    const indices = Uint8Array.from([7]);
    const encoded = lzwEncode(indices, MIN_CODE_SIZE);
    expect(lzwDecode(encoded, MIN_CODE_SIZE)).toEqual([7]);
  });
});

describe("encodeGif", () => {
  const WIDTH = 4;
  const HEIGHT = 2;
  const PIXELS = WIDTH * HEIGHT;

  function solidFrame(r: number, g: number, b: number, delayCentiseconds = 10): GifFrame {
    const rgba = new Uint8ClampedArray(PIXELS * 4);
    for (let pixel = 0; pixel < PIXELS; pixel += 1) {
      rgba.set([r, g, b, 255], pixel * 4);
    }
    return { rgba, delayCentiseconds };
  }

  it("starts with the GIF89a header and ends with the trailer byte", () => {
    const bytes = encodeGif([solidFrame(255, 0, 0)], WIDTH, HEIGHT);
    const header = String.fromCharCode(...bytes.slice(0, 6));
    expect(header).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it("encodes the logical screen size as given", () => {
    const bytes = encodeGif([solidFrame(0, 255, 0)], WIDTH, HEIGHT);
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(WIDTH);
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(HEIGHT);
  });

  it("rejects an empty frame list", () => {
    expect(() => encodeGif([], WIDTH, HEIGHT)).toThrow();
  });

  it("contains exactly one Image Descriptor (0x2C) per frame", () => {
    const bytes = encodeGif([solidFrame(255, 0, 0), solidFrame(0, 255, 0), solidFrame(0, 0, 255)], WIDTH, HEIGHT);
    const imageDescriptorCount = Array.from(bytes).filter((byte) => byte === 0x2c).length;
    expect(imageDescriptorCount).toBe(3);
  });

  it("round-trips a solid-color frame's pixel indices through the actual LZW stream it wrote", () => {
    const frame = solidFrame(0, 128, 255);
    const bytes = encodeGif([frame], WIDTH, HEIGHT);

    // walk straight to the image data: header(13) + global color table(256*3) + Netscape ext(19)
    // + Graphic Control Extension(8) + Image Descriptor(10) = fixed offset for this single-frame case.
    let offset = 13 + 256 * 3 + 19 + 8 + 10;
    const minCodeSize = bytes[offset]!;
    offset += 1;
    const subBlocks: number[] = [];
    for (;;) {
      const blockSize = bytes[offset]!;
      offset += 1;
      if (blockSize === 0) {
        break;
      }
      for (let i = 0; i < blockSize; i += 1) {
        subBlocks.push(bytes[offset + i]!);
      }
      offset += blockSize;
    }

    const decodedIndices = lzwDecode(Uint8Array.from(subBlocks), minCodeSize);
    const expectedIndex = paletteIndexFor(0, 128, 255);
    expect(decodedIndices).toEqual(new Array(PIXELS).fill(expectedIndex));
  });
});
