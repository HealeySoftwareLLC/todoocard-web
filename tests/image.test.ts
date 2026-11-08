import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  PALETTE,
  buildT3Bitmaps,
  calibrateT3,
  ditherToCodes,
  packCodes,
  toControllerOrder,
  unpackCodes,
} from '../shared/image';
import { CONTROLLER_BYTES, PANEL_HEIGHT, PANEL_PIXELS, PANEL_WIDTH } from '../shared/protocol';
import { buildLegacyStoredStream, selectPayload } from '../shared/payload';

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

describe('pixel packing', () => {
  it('round-trips codes through pack/unpack', () => {
    const codes = new Uint8Array(PANEL_PIXELS);
    for (let i = 0; i < codes.length; i++) codes[i] = PALETTE[i % PALETTE.length].code;
    const packed = packCodes(codes);
    expect(packed.length).toBe(CONTROLLER_BYTES);
    expect(packed[0]).toBe((0 << 4) | 1); // black, white
    expect(unpackCodes(packed, PANEL_PIXELS)).toEqual(codes);
  });
});

describe('transforms', () => {
  it('calibrateT3 is a vertical flip and an involution', () => {
    const codes = new Uint8Array(PANEL_PIXELS).map((_, i) => i % 7);
    const once = calibrateT3(codes);
    expect(once[0]).toBe(codes[(PANEL_HEIGHT - 1) * PANEL_WIDTH]);
    expect(calibrateT3(once)).toEqual(codes);
  });
  it('toControllerOrder is a bijection with the documented mapping', () => {
    const codes = new Uint8Array(PANEL_PIXELS).map((_, i) => i % 13);
    const ctrl = toControllerOrder(codes);
    // destination (dx,dy) in 792-wide raster <- source (W-1-dy, H-1-dx)
    const dx = 5;
    const dy = 7;
    expect(ctrl[dy * PANEL_HEIGHT + dx]).toBe(codes[(PANEL_HEIGHT - 1 - dx) * PANEL_WIDTH + (PANEL_WIDTH - 1 - dy)]);
    const seen = new Uint8Array(PANEL_PIXELS);
    for (let di = 0; di < PANEL_PIXELS; di++) {
      const ddx = di % PANEL_HEIGHT;
      const ddy = (di / PANEL_HEIGHT) | 0;
      seen[(PANEL_HEIGHT - 1 - ddx) * PANEL_WIDTH + (PANEL_WIDTH - 1 - ddy)]++;
    }
    expect(seen.every((n) => n === 1)).toBe(true);
  });
});

describe('dithering', () => {
  it('maps flat palette colours to themselves', () => {
    const w = 8;
    const h = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const c = PALETTE[i % PALETTE.length];
      rgba.set([c.r, c.g, c.b, 255], i * 4);
    }
    const codes = ditherToCodes(rgba, w, h);
    for (let i = 0; i < w * h; i++) expect(codes[i]).toBe(PALETTE[i % PALETTE.length].code);
  });
});

describe('legacy stored stream', () => {
  it('has the QuickLZ stored-block framing', () => {
    const controller = new Uint8Array(CONTROLLER_BYTES).map((_, i) => i & 0xff);
    const s = buildLegacyStoredStream(controller);
    expect(s.length).toBe(4 + (CONTROLLER_BYTES / 64) * 67);
    expect(Array.from(s.subarray(0, 7))).toEqual([0, 0, 0, 0, 0x74, 0x43, 0x40]);
    expect(Array.from(s.subarray(7, 7 + 64))).toEqual(Array.from(controller.subarray(0, 64)));
    expect(s[4 + 67]).toBe(0x74);
  });
  it('selects raw for v157+ and legacy before', () => {
    const controller = new Uint8Array(CONTROLLER_BYTES);
    expect(selectPayload(controller, 0xbb).profile).toBe('raw');
    expect(selectPayload(controller, 0x9d).profile).toBe('raw');
    expect(selectPayload(controller, 0x9c).profile).toBe('legacy-stored');
  });
});

describe('parity with the vendor converter', () => {
  const have = existsSync(fixture('upright.png')) && existsSync(fixture('expected.bin')) && existsSync(fixture('expected.controller.bin'));
  it.skipIf(!have)('produces byte-identical calibrated and controller bitmaps', () => {
    const png = PNG.sync.read(readFileSync(fixture('upright.png')));
    expect(png.width).toBe(PANEL_WIDTH);
    expect(png.height).toBe(PANEL_HEIGHT);
    const bitmaps = buildT3Bitmaps(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength));
    const expectedBin = new Uint8Array(readFileSync(fixture('expected.bin')));
    const expectedCtrl = new Uint8Array(readFileSync(fixture('expected.controller.bin')));
    expect(bitmaps.calibrated.length).toBe(expectedBin.length);
    let diff = 0;
    for (let i = 0; i < expectedBin.length; i++) if (bitmaps.calibrated[i] !== expectedBin[i]) diff++;
    expect(diff, `calibrated bitmap differs in ${diff} bytes`).toBe(0);
    expect(Buffer.from(bitmaps.controller).equals(Buffer.from(expectedCtrl))).toBe(true);
  });
});
