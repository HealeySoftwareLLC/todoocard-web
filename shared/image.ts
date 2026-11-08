/**
 * Image pipeline: six-colour Floyd–Steinberg dithering, nibble packing,
 * panel calibration and controller byte order for the 528x792 T3 panel.
 * Pure functions, usable in the browser and in Node tests.
 */
import { CONTROLLER_BYTES, PANEL_HEIGHT, PANEL_PIXELS, PANEL_WIDTH } from './protocol.js';

export interface NativeColor {
  name: string;
  r: number;
  g: number;
  b: number;
  code: number;
}

/** Device colour codes. 4 and 7 are unused by the panel. */
export const PALETTE: readonly NativeColor[] = [
  { name: 'black', r: 0, g: 0, b: 0, code: 0 },
  { name: 'white', r: 255, g: 255, b: 255, code: 1 },
  { name: 'yellow', r: 255, g: 255, b: 0, code: 2 },
  { name: 'red', r: 255, g: 0, b: 0, code: 3 },
  { name: 'blue', r: 0, g: 0, b: 255, code: 5 },
  { name: 'green', r: 0, g: 255, b: 0, code: 6 },
];

const CODE_TO_RGB: Record<number, [number, number, number]> = {};
for (const c of PALETTE) CODE_TO_RGB[c.code] = [c.r, c.g, c.b];

/** Approximate ink appearance for on-screen previews (e-paper inks are not pure RGB). */
export const PREVIEW_RGB: Record<number, [number, number, number]> = {
  0: [20, 20, 20],
  1: [245, 243, 236],
  2: [240, 200, 30],
  3: [200, 40, 40],
  5: [40, 70, 180],
  6: [40, 150, 70],
};

function nearest(r: number, g: number, b: number): NativeColor {
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const c of PALETTE) {
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Floyd–Steinberg dither of an RGBA buffer (width*height*4, row-major, top-left
 * origin) to device colour codes (one code per pixel). Alpha is ignored; callers
 * must flatten transparency first.
 */
export function ditherToCodes(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.length < width * height * 4) throw new Error('RGBA buffer too small');
  const work = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    work[i * 3] = rgba[j];
    work[i * 3 + 1] = rgba[j + 1];
    work[i * 3 + 2] = rgba[j + 2];
  }
  const codes = new Uint8Array(width * height);
  const add = (x: number, y: number, er: number, eg: number, eb: number, w: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const o = (y * width + x) * 3;
    work[o] += er * w;
    work[o + 1] += eg * w;
    work[o + 2] += eb * w;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 3;
      const r = Math.min(255, Math.max(0, work[o]));
      const g = Math.min(255, Math.max(0, work[o + 1]));
      const b = Math.min(255, Math.max(0, work[o + 2]));
      const c = nearest(r, g, b);
      codes[i] = c.code;
      const er = r - c.r;
      const eg = g - c.g;
      const eb = b - c.b;
      add(x + 1, y, er, eg, eb, 7 / 16);
      add(x - 1, y + 1, er, eg, eb, 3 / 16);
      add(x, y + 1, er, eg, eb, 5 / 16);
      add(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return codes;
}

/** Pack colour codes two per byte, first pixel in the high nibble. */
export function packCodes(codes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(codes.length / 2));
  for (let i = 0; i < codes.length; i++) {
    if ((i & 1) === 0) out[i >> 1] = (codes[i] & 0x0f) << 4;
    else out[i >> 1] |= codes[i] & 0x0f;
  }
  return out;
}

export function unpackCodes(packed: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const b = packed[i >> 1];
    out[i] = (i & 1) === 0 ? b >> 4 : b & 0x0f;
  }
  return out;
}

/**
 * Panel calibration for TodooCard/T3: the panel is mounted so that an upright
 * image must be rotated 180° and then mirrored horizontally, which together is
 * a vertical flip. Operates on per-pixel codes.
 */
export function calibrateT3(codes: Uint8Array, width = PANEL_WIDTH, height = PANEL_HEIGHT): Uint8Array {
  const out = new Uint8Array(codes.length);
  for (let y = 0; y < height; y++) {
    const srcRow = y * width;
    const dstRow = (height - 1 - y) * width;
    out.set(codes.subarray(srcRow, srcRow + width), dstRow);
  }
  return out;
}

/**
 * Controller byte order: the SE0368-class controller scans the panel as a
 * 792x528 landscape raster. Destination pixel (dx, dy) in the 792-wide raster
 * reads source (width-1-dy, height-1-dx) of the calibrated 528x792 bitmap.
 */
export function toControllerOrder(codes: Uint8Array, width = PANEL_WIDTH, height = PANEL_HEIGHT): Uint8Array {
  const out = new Uint8Array(codes.length);
  const dstWidth = height; // 792
  for (let di = 0; di < codes.length; di++) {
    const dx = di % dstWidth;
    const dy = (di / dstWidth) | 0;
    const sx = width - 1 - dy;
    const sy = height - 1 - dx;
    out[di] = codes[sy * width + sx];
  }
  return out;
}

export interface T3Bitmaps {
  /** Calibrated 528x792 bitmap, 2 px/byte (what the vendor tool writes as image.bin). */
  calibrated: Uint8Array;
  /** Controller-ordered bitmap sent to the device (image.controller.bin). */
  controller: Uint8Array;
  /** Per-pixel codes of the *upright* image for previews. */
  uprightCodes: Uint8Array;
}

/** Full pipeline from an upright 528x792 RGBA buffer to device bitmaps. */
export function buildT3Bitmaps(rgba: Uint8ClampedArray | Uint8Array): T3Bitmaps {
  if (rgba.length !== PANEL_PIXELS * 4) {
    throw new Error(`Expected ${PANEL_WIDTH}x${PANEL_HEIGHT} RGBA (${PANEL_PIXELS * 4} bytes), got ${rgba.length}`);
  }
  const uprightCodes = ditherToCodes(rgba, PANEL_WIDTH, PANEL_HEIGHT);
  const calibratedCodes = calibrateT3(uprightCodes);
  const calibrated = packCodes(calibratedCodes);
  const controller = packCodes(toControllerOrder(calibratedCodes));
  if (controller.length !== CONTROLLER_BYTES) throw new Error('controller bitmap size mismatch');
  return { calibrated, controller, uprightCodes };
}

/** Render colour codes to RGBA for display. */
export function codesToRgba(codes: Uint8Array, palette: Record<number, [number, number, number]> = PREVIEW_RGB): Uint8ClampedArray {
  const out = new Uint8ClampedArray(codes.length * 4);
  for (let i = 0; i < codes.length; i++) {
    const [r, g, b] = palette[codes[i]] ?? [255, 0, 255];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function colorUsage(codes: Uint8Array): Record<string, number> {
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const out: Record<string, number> = {};
  for (const p of PALETTE) out[p.name] = Math.round(((counts.get(p.code) ?? 0) / codes.length) * 1000) / 10;
  return out;
}

export { CODE_TO_RGB };
