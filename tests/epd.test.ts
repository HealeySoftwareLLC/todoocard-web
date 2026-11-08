import { describe, expect, it } from 'vitest';
import {
  PALETTES,
  clampByte,
  rgbToLab,
  compressedDisplayRgb,
  optimizeToCodes,
  previewRgbForPalette,
  defaultEpdOptions,
  resolveOptions,
  type EpdOptions,
} from '../shared/epd';

describe('colour maths', () => {
  it('clampByte rounds half away from zero and clamps', () => {
    expect(clampByte(0.5)).toBe(1);
    expect(clampByte(0.49)).toBe(0);
    expect(clampByte(254.5)).toBe(255);
    expect(clampByte(-3)).toBe(0);
    expect(clampByte(999)).toBe(255);
  });

  it('rgbToLab matches sRGB D65 reference points', () => {
    const [kl, ka, kb] = rgbToLab(0, 0, 0);
    expect(kl).toBeCloseTo(0, 5);
    expect(ka).toBeCloseTo(0, 5);
    expect(kb).toBeCloseTo(0, 5);
    const [wl] = rgbToLab(255, 255, 255);
    expect(wl).toBeCloseTo(100, 3);
    const [rl, ra, rb] = rgbToLab(255, 0, 0);
    expect(rl).toBeCloseTo(53.24, 1);
    expect(ra).toBeGreaterThan(70); // red is strongly +a
    expect(rb).toBeGreaterThan(50); // and +b
  });

  it('compressedDisplayRgb returns a valid packed colour and is identity at full source/target range', () => {
    const packed = compressedDisplayRgb(128, 64, 200, 0, 100, 0, 100, 1);
    const r = (packed >> 16) & 255;
    const g = (packed >> 8) & 255;
    const b = packed & 255;
    // Mapping L [0,100] -> [0,100] by strength 1 is (near-)identity.
    expect(r).toBeCloseTo(128, -1);
    expect(g).toBeCloseTo(64, -1);
    expect(b).toBeCloseTo(200, -1);
  });
});

describe('palettes', () => {
  it('AITJCIZE Spectra6 uses measured inks mapped to primary codes', () => {
    const p = PALETTES['spectra6-aitjcize'];
    const white = p.find((e) => e.name === 'white')!;
    expect([white.cr, white.cg, white.cb]).toEqual([0xbe, 0xc8, 0xc8]);
    expect([white.dr, white.dg, white.db]).toEqual([255, 255, 255]);
    expect(white.code).toBe(1);
    const red = p.find((e) => e.name === 'red')!;
    expect([red.cr, red.cg, red.cb]).toEqual([0x87, 0x13, 0x00]);
    expect(red.code).toBe(3);
    // Codes cover the six device inks.
    expect(new Set(p.map((e) => e.code))).toEqual(new Set([0, 1, 2, 3, 5, 6]));
  });

  it('previewRgbForPalette exposes the measured appearance by code', () => {
    const preview = previewRgbForPalette('spectra6-aitjcize');
    expect(preview[1]).toEqual([0xbe, 0xc8, 0xc8]);
    expect(preview[3]).toEqual([0x87, 0x13, 0x00]);
  });
});

describe('optimizeToCodes', () => {
  const quantOpts: EpdOptions = {
    ...defaultEpdOptions,
    ditheringType: 'quantize',
    preset: null,
    toneMapping: null,
    drc: null,
  };

  it('quantises exact measured inks to their device codes', () => {
    const p = PALETTES['spectra6-aitjcize'];
    const w = p.length;
    const h = 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    p.forEach((e, i) => rgba.set([e.cr, e.cg, e.cb, 255], i * 4));
    const codes = optimizeToCodes(rgba, w, h, quantOpts);
    p.forEach((e, i) => expect(codes[i]).toBe(e.code));
  });

  it('error diffusion is deterministic and only emits valid codes', () => {
    const w = 32;
    const h = 32;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        rgba.set([(x * 255) / w, (y * 255) / h, 128, 255], o);
      }
    const a = optimizeToCodes(rgba, w, h, defaultEpdOptions);
    const b = optimizeToCodes(rgba, w, h, defaultEpdOptions);
    expect(a).toEqual(b);
    const valid = new Set([0, 1, 2, 3, 5, 6]);
    expect(a.every((c) => valid.has(c))).toBe(true);
  });

  it('a pure-white field renders as white ink', () => {
    const w = 16;
    const h = 16;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
    const codes = optimizeToCodes(rgba, w, h, defaultEpdOptions);
    // White (code 1) must dominate an all-white input.
    const whites = codes.filter((c) => c === 1).length;
    expect(whites / codes.length).toBeGreaterThan(0.9);
  });

  it('resolveOptions fills tone/DRC from the preset (balanced => DISPLAY DRC)', () => {
    const r = resolveOptions(defaultEpdOptions);
    expect(r.drc?.mode).toBe('display');
    expect(r.toneMapping?.mode).toBe('contrast');
  });
});
