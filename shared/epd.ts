/**
 * EPD image-optimisation engine, ported from the TodooCard vendor Android app
 * package `com.sunbelife.epdoptimize` (classes Dither, ImageProcessor, ColorMath,
 * PaletteMatcher, DefaultPalettes, ProcessingPresets). It converts a full-colour
 * RGBA buffer to six-ink device colour codes with:
 *
 *   - measured "Spectra 6" palettes: the image is matched against the *real* ink
 *     appearance (e.g. white ink is a grey #bec8c8, red is a dark #871300), then
 *     mapped to the pure-primary device code the panel expects;
 *   - a choice of error-diffusion matrices (Floyd–Steinberg … Stucki) with
 *     serpentine scanning, plus ordered (Bayer) and plain quantisation;
 *   - RGB or perceptual CIELAB colour matching;
 *   - tone mapping (exposure / saturation / contrast / S-curve) and dynamic-range
 *     compression into the palette's achievable lightness range.
 *
 * This is a faithful re-implementation of the vendor pipeline (the app runs
 * ImageProcessor then Dither then maps to device colours); all constants are
 * transcribed from the decompiled source. Pure functions, usable in the browser
 * and in Node tests.
 */

export type PaletteName = 'spectra6-aitjcize' | 'spectra6' | 'spectra6-legacy' | 'acep7';
export type DiffusionMatrix =
  | 'floyd-steinberg'
  | 'false-floyd-steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'stucki'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra2-4a';
export type DitheringType = 'error-diffusion' | 'quantize' | 'ordered';
export type ColorMatching = 'rgb' | 'lab';
export type ToneMode = 'off' | 'contrast' | 's-curve';
export type DrcMode = 'off' | 'automatic' | 'display';
export type PresetName = 'balanced' | 'dynamic' | 'vivid' | 'soft' | 'grayscale';

export interface PaletteEntry {
  name: string;
  /** Measured ink appearance, used for colour matching. */
  cr: number;
  cg: number;
  cb: number;
  /** Device colour the panel maps this ink to (pure primary). */
  dr: number;
  dg: number;
  db: number;
  /** Device colour code packed into the bitmap. */
  code: number;
  /** Precomputed CIELAB of the measured appearance. */
  lab: [number, number, number];
}

export interface ToneMapping {
  mode: ToneMode;
  exposure: number;
  saturation: number;
  contrast: number;
  strength: number;
  shadowBoost: number;
  highlightCompress: number;
  midpoint: number;
}

export interface Drc {
  mode: DrcMode;
  strength: number;
  lowPercentile: number;
  highPercentile: number;
}

export interface EpdOptions {
  palette: PaletteName;
  ditheringType: DitheringType;
  matrix: DiffusionMatrix;
  matching: ColorMatching;
  serpentine: boolean;
  orderedSize: number; // bayer matrix size (<=8)
  toneMapping: ToneMapping | null;
  drc: Drc | null;
  /** When set, fills a null toneMapping/drc from this preset. */
  preset: PresetName | null;
}

// ---------------------------------------------------------------------------
// Colour maths (ColorMath.kt). sRGB D65.
// ---------------------------------------------------------------------------

/** Round half away from zero, clamp to 0..255 (ColorMath.clampByte). */
export function clampByte(v: number): number {
  if (!(Math.abs(v) <= Number.MAX_VALUE)) return 0;
  const r = v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

export function luma709(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function srgbLinear(i: number): number {
  const d = i / 255;
  return d > 0.04045 ? Math.pow((d + 0.055) / 1.055, 2.4) : d / 12.92;
}
function labPivot(d: number): number {
  return d > 0.008856 ? Math.cbrt(d) : d * 7.787 + 0.13793103448275862;
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbLinear(r);
  const lg = srgbLinear(g);
  const lb = srgbLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) * 100;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) * 100;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) * 100;
  const px = labPivot(x / 95.047);
  const py = labPivot(y / 100);
  const pz = labPivot(z / 108.883);
  return [116 * py - 16, 500 * (px - py), 200 * (py - pz)];
}

/**
 * Dynamic-range compression of one sRGB colour: maps its CIELAB L from
 * [sourceBlackL, sourceBlackL+sourceRange] into [targetBlackL,
 * targetBlackL+targetRange] by `strength`, preserving a/b. (ColorMath.compressedDisplayRgb)
 * Returns a packed 0xRRGGBB int.
 */
export function compressedDisplayRgb(
  red: number,
  green: number,
  blue: number,
  sourceBlackL: number,
  sourceRange: number,
  targetBlackL: number,
  targetRange: number,
  strength: number,
): number {
  const lr = srgbLinear(red);
  const lg = srgbLinear(green);
  const lb = srgbLinear(blue);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) * 100;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) * 100;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) * 100;
  const px = labPivot(x / 95.047);
  const py = labPivot(y / 100);
  const pz = labPivot(z / 108.883);
  const L = 116 * py - 16;
  const A = (px - py) * 500;
  const B = (py - pz) * 200;
  const t = Math.min(1, Math.max(0, (L - sourceBlackL) / sourceRange));
  const newL = L + (targetBlackL + t * targetRange - L) * strength;
  const fy = (newL + 16) / 116;
  const fx = A / 500 + fy;
  const fz = fy - B / 200;
  const xr = (unpivot(fx) * 95.047) / 100;
  const yr = (unpivot(fy) * 100) / 100;
  const zr = (unpivot(fz) * 108.883) / 100;
  const rr = clampByte(gamma(3.2404542 * xr - 1.5371385 * yr - 0.4985314 * zr) * 255);
  const gg = clampByte(gamma(-0.969266 * xr + 1.8760108 * yr + 0.041556 * zr) * 255);
  const bb = clampByte(gamma(xr * 0.0556434 + yr * -0.2040259 + zr * 1.0572252) * 255);
  return (rr << 16) | (gg << 8) | bb;
}
function unpivot(d: number): number {
  return d > 0.206897 ? d * d * d : (d - 0.13793103448275862) / 7.787;
}
function gamma(d: number): number {
  return d > 0.0031308 ? Math.pow(d, 0.4166666666666667) * 1.055 - 0.055 : d * 12.92;
}

// ---------------------------------------------------------------------------
// Palettes (DefaultPalettes.kt). Measured appearance + device primary.
// ---------------------------------------------------------------------------

const DEVICE_CODE: Record<string, number> = {
  '000000': 0,
  ffffff: 1,
  ffff00: 2,
  ff0000: 3,
  '0000ff': 5,
  '00ff00': 6,
};

function hx(h: string): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function entry(name: string, appearance: string, device: string): PaletteEntry {
  const [cr, cg, cb] = hx(appearance);
  const [dr, dg, db] = hx(device);
  const key = device.replace('#', '').toLowerCase();
  // Pure-primary device colours carry a code; non-primary inks (e.g. ACEP orange)
  // fall back to nearest primary, which never happens on the 6-ink T3 panel.
  const code = DEVICE_CODE[key] ?? nearestPrimaryCode(dr, dg, db);
  return { name, cr, cg, cb, dr, dg, db, code, lab: rgbToLab(cr, cg, cb) };
}
function nearestPrimaryCode(r: number, g: number, b: number): number {
  let best = 1;
  let bestD = Infinity;
  for (const [hex, code] of Object.entries(DEVICE_CODE)) {
    const [pr, pg, pb] = hx(hex);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = code;
    }
  }
  return best;
}

export const PALETTES: Record<PaletteName, PaletteEntry[]> = {
  // DefaultPalettes.palette(AITJCIZE_SPECTRA6) — the vendor default.
  'spectra6-aitjcize': [
    entry('black', '#020202', '#000000'),
    entry('white', '#bec8c8', '#ffffff'),
    entry('blue', '#05409e', '#0000ff'),
    entry('green', '#27663c', '#00ff00'),
    entry('red', '#871300', '#ff0000'),
    entry('yellow', '#cdca00', '#ffff00'),
  ],
  // DefaultPalettes.palette(SPECTRA6)
  spectra6: [
    entry('black', '#1f2226', '#000000'),
    entry('white', '#b9c7c9', '#ffffff'),
    entry('blue', '#233f8e', '#0000ff'),
    entry('green', '#35563a', '#00ff00'),
    entry('red', '#62201e', '#ff0000'),
    entry('yellow', '#c1bb1e', '#ffff00'),
  ],
  // DefaultPalettes.palette(SPECTRA6_LEGACY)
  'spectra6-legacy': [
    entry('black', '#191e21', '#000000'),
    entry('white', '#e8e8e8', '#ffffff'),
    entry('blue', '#2157ba', '#0000ff'),
    entry('green', '#125f20', '#00ff00'),
    entry('red', '#b21318', '#ff0000'),
    entry('yellow', '#efde44', '#ffff00'),
  ],
  // DefaultPalettes.palette(ACEP) — 7 inks incl. orange (not used by the 6-ink T3).
  acep7: [
    entry('black', '#191e21', '#000000'),
    entry('white', '#f1f1f1', '#ffffff'),
    entry('blue', '#31318f', '#0000ff'),
    entry('green', '#53a428', '#00ff00'),
    entry('red', '#d20e13', '#ff0000'),
    entry('orange', '#b85e1c', '#ff8000'),
    entry('yellow', '#f3cf11', '#ffff00'),
  ],
};

/** Approximate ink appearance keyed by device code, for on-screen previews. */
export function previewRgbForPalette(name: PaletteName): Record<number, [number, number, number]> {
  const out: Record<number, [number, number, number]> = {};
  for (const e of PALETTES[name]) out[e.code] = [e.cr, e.cg, e.cb];
  return out;
}

// ---------------------------------------------------------------------------
// Error-diffusion matrices (Dither.diffusionMap). [dx, dy, numerator, denominator]
// ---------------------------------------------------------------------------

const MATRICES: Record<DiffusionMatrix, ReadonlyArray<readonly [number, number, number, number]>> = {
  'floyd-steinberg': [
    [1, 0, 7, 16],
    [-1, 1, 3, 16],
    [0, 1, 5, 16],
    [1, 1, 1, 16],
  ],
  'false-floyd-steinberg': [
    [1, 0, 3, 8],
    [0, 1, 3, 8],
    [1, 1, 2, 8],
  ],
  atkinson: [
    [1, 0, 1, 8],
    [2, 0, 1, 8],
    [-1, 1, 1, 8],
    [0, 1, 1, 8],
    [1, 1, 1, 8],
    [0, 2, 1, 8],
  ],
  jarvis: [
    [1, 0, 7, 48],
    [2, 0, 5, 48],
    [-2, 1, 3, 48],
    [-1, 1, 5, 48],
    [0, 1, 7, 48],
    [1, 1, 5, 48],
    [2, 1, 3, 48],
    [-2, 2, 1, 48],
    [-1, 2, 3, 48],
    [0, 2, 4, 48],
    [1, 2, 3, 48],
    [2, 2, 1, 48],
  ],
  stucki: [
    [1, 0, 8, 42],
    [2, 0, 4, 42],
    [-2, 1, 2, 42],
    [-1, 1, 4, 42],
    [0, 1, 8, 42],
    [1, 1, 4, 42],
    [2, 1, 2, 42],
    [-2, 2, 1, 42],
    [-1, 2, 2, 42],
    [0, 2, 4, 42],
    [1, 2, 2, 42],
    [2, 2, 1, 42],
  ],
  burkes: [
    [1, 0, 8, 32],
    [2, 0, 4, 32],
    [-2, 1, 2, 32],
    [-1, 1, 4, 32],
    [0, 1, 8, 32],
    [1, 1, 4, 32],
    [2, 1, 2, 32],
  ],
  sierra3: [
    [1, 0, 5, 32],
    [2, 0, 3, 32],
    [-2, 1, 2, 32],
    [-1, 1, 4, 32],
    [0, 1, 5, 32],
    [1, 1, 4, 32],
    [2, 1, 2, 32],
    [-1, 2, 2, 32],
    [0, 2, 3, 32],
    [1, 2, 2, 32],
  ],
  sierra2: [
    [1, 0, 4, 16],
    [2, 0, 3, 16],
    [-2, 1, 1, 16],
    [-1, 1, 2, 16],
    [0, 1, 3, 16],
    [1, 1, 2, 16],
    [2, 1, 1, 16],
  ],
  'sierra2-4a': [
    [1, 0, 2, 4],
    [-2, 1, 1, 4],
    [-1, 1, 1, 4],
  ],
};

// Bayer 8x8 base matrix (Dither.bayerMatrix), transcribed verbatim.
const BAYER8: number[][] = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 32],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

function bayerMatrix(width: number, height: number): number[][] {
  const w = Math.min(8, Math.max(1, width));
  const h = Math.min(8, Math.max(1, height));
  if (w === 8 && h === 8) return BAYER8;
  // Sub-sample columns/rows then rank the values 0..n-1 (matches the vendor).
  const sub: number[][] = [];
  for (let i = 0; i < h; i++) {
    const row: number[] = [];
    for (let j = 0; j < w; j++) row.push(BAYER8[j][i]);
    sub.push(row);
  }
  const flat = sub.flat().slice().sort((a, b) => a - b);
  const rank = new Map<number, number>();
  flat.forEach((v, i) => rank.set(v, i));
  return sub.map((row) => row.map((v) => rank.get(v) ?? v));
}

// ---------------------------------------------------------------------------
// Presets (ProcessingPresets.preset). Resolved tone-mapping / DRC values.
// ---------------------------------------------------------------------------

function tone(
  mode: ToneMode,
  o: Partial<Omit<ToneMapping, 'mode'>> = {},
): ToneMapping {
  return {
    mode,
    exposure: o.exposure ?? 1,
    saturation: o.saturation ?? 1,
    contrast: o.contrast ?? 1,
    strength: o.strength ?? 0.9,
    shadowBoost: o.shadowBoost ?? 0,
    highlightCompress: o.highlightCompress ?? 1.5,
    midpoint: o.midpoint ?? 0.5,
  };
}
function drc(mode: DrcMode): Drc {
  return { mode, strength: 1, lowPercentile: 0.01, highPercentile: 0.99 };
}

export interface Preset {
  toneMapping: ToneMapping;
  drc: Drc;
  matching: ColorMatching;
  matrix: DiffusionMatrix;
}

export const PRESETS: Record<PresetName, Preset> = {
  // Faithful default: neutral tone, DISPLAY dynamic-range compression, FS + RGB.
  balanced: { toneMapping: tone('contrast'), drc: drc('display'), matching: 'rgb', matrix: 'floyd-steinberg' },
  dynamic: {
    toneMapping: tone('s-curve', { exposure: 1.0, saturation: 1.3, strength: 0.9, highlightCompress: 1.5 }),
    drc: drc('off'),
    matching: 'rgb',
    matrix: 'floyd-steinberg',
  },
  vivid: {
    toneMapping: tone('s-curve', { exposure: 1.1, saturation: 1.6, strength: 0.7, shadowBoost: 0.1, highlightCompress: 1.3 }),
    drc: drc('off'),
    matching: 'rgb',
    matrix: 'floyd-steinberg',
  },
  soft: {
    toneMapping: tone('contrast', { saturation: 1.1, contrast: 0.9 }),
    drc: drc('display'),
    matching: 'rgb',
    matrix: 'stucki',
  },
  grayscale: {
    toneMapping: tone('s-curve', { saturation: 0, strength: 0.8, shadowBoost: 0.1, highlightCompress: 1.4 }),
    drc: drc('display'),
    matching: 'lab',
    matrix: 'floyd-steinberg',
  },
};

/** Faithful default = vendor "AutoFaithful Spectra6" (BALANCED preset, FS, serpentine, RGB). */
export const defaultEpdOptions: EpdOptions = {
  palette: 'spectra6-aitjcize',
  ditheringType: 'error-diffusion',
  matrix: 'floyd-steinberg',
  matching: 'rgb',
  serpentine: true,
  orderedSize: 4,
  toneMapping: null,
  drc: null,
  preset: 'balanced',
};

export function resolveOptions(o: EpdOptions): EpdOptions {
  if (!o.preset) return o;
  const p = PRESETS[o.preset];
  return {
    ...o,
    toneMapping: o.toneMapping ?? p.toneMapping,
    drc: o.drc ?? p.drc,
  };
}

// ---------------------------------------------------------------------------
// Image processing (ImageProcessor.kt): tone mapping + DRC on a float RGBA buffer.
// ---------------------------------------------------------------------------

function applyExposure(px: Float64Array, exposure: number): void {
  if (exposure === 1) return;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = clampByte(px[i] * exposure);
    px[i + 1] = clampByte(px[i + 1] * exposure);
    px[i + 2] = clampByte(px[i + 2] * exposure);
  }
}

function applyContrast(px: Float64Array, contrast: number): void {
  if (contrast === 1) return;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = clampByte((px[i] - 128) * contrast + 128);
    px[i + 1] = clampByte((px[i + 1] - 128) * contrast + 128);
    px[i + 2] = clampByte((px[i + 2] - 128) * contrast + 128);
  }
}

function applySaturation(px: Float64Array, saturation: number): void {
  if (saturation === 1) return;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sum = max + min;
    const l = sum / 2;
    if (max === min) continue;
    const chroma = max - min;
    const s = chroma / (l > 0.5 ? 2 - max - min : Math.max(sum, 1e-6));
    let h: number;
    if (max === r) h = ((g - b) / chroma + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / chroma + 2) / 6;
    else h = ((r - g) / chroma + 4) / 6;
    const c = (1 - Math.abs(2 * l - 1)) * Math.min(1, Math.max(0, s * saturation));
    const h6 = h * 6;
    const xx = c * (1 - Math.abs((h6 % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(h6);
    let rr: number, gg: number, bb: number;
    if (seg === 0) [rr, gg, bb] = [c, xx, 0];
    else if (seg === 1) [rr, gg, bb] = [xx, c, 0];
    else if (seg === 2) [rr, gg, bb] = [0, c, xx];
    else if (seg === 3) [rr, gg, bb] = [0, xx, c];
    else if (seg === 4) [rr, gg, bb] = [xx, 0, c];
    else [rr, gg, bb] = [c, 0, xx];
    px[i] = clampByte((rr + m) * 255);
    px[i + 1] = clampByte((gg + m) * 255);
    px[i + 2] = clampByte((bb + m) * 255);
  }
}

function applySCurve(px: Float64Array, strength: number, shadowBoost: number, highlightCompress: number, midpoint: number): void {
  if (strength === 0) return;
  const mid = Math.min(0.99, Math.max(0.01, midpoint));
  for (let i = 0; i < px.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const d = px[i + k] / 255;
      let out: number;
      if (d <= mid) out = Math.pow(d / mid, 1 - strength * shadowBoost) * mid;
      else {
        const span = 1 - mid;
        out = Math.pow((d - mid) / span, 1 + strength * highlightCompress) * span + mid;
      }
      px[i + k] = clampByte(out * 255);
    }
  }
}

function applyToneMapping(px: Float64Array, t: ToneMapping): void {
  applyExposure(px, t.exposure);
  applySaturation(px, t.saturation);
  if (t.mode === 'contrast') applyContrast(px, t.contrast);
  else if (t.mode === 's-curve') applySCurve(px, t.strength, t.shadowBoost, t.highlightCompress, t.midpoint);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const last = sorted.length - 1;
  const idx = last * p;
  const i = idx >= 0 ? Math.floor(idx + 0.5) : Math.ceil(idx - 0.5);
  return sorted[Math.min(last, Math.max(0, i))];
}

function applyDrc(px: Float64Array, palette: PaletteEntry[], o: Drc): void {
  if (o.mode === 'off') return;
  const strength = Math.min(1, Math.max(0, o.strength));
  if (strength <= 0) return;
  // Endpoints = darkest/lightest palette inks by luma709.
  let black = palette[0];
  let white = palette[0];
  for (const e of palette) {
    const y = luma709(e.cr, e.cg, e.cb);
    if (y < luma709(black.cr, black.cg, black.cb)) black = e;
    if (y > luma709(white.cr, white.cg, white.cb)) white = e;
  }
  const targetBlackL = rgbToLab(black.cr, black.cg, black.cb)[0];
  const targetRange = rgbToLab(white.cr, white.cg, white.cb)[0] - targetBlackL;
  if (targetRange <= 0) return;

  let srcBlackL: number;
  let srcRange: number;
  if (o.mode === 'automatic') {
    const ls: number[] = [];
    for (let i = 0; i < px.length; i += 4) ls.push(rgbToLab(clampByte(px[i]), clampByte(px[i + 1]), clampByte(px[i + 2]))[0]);
    const lo = percentile(ls, o.lowPercentile);
    const hi = percentile(ls, o.highPercentile);
    srcBlackL = lo;
    srcRange = hi - lo;
  } else {
    srcBlackL = 0;
    srcRange = 100;
  }
  if (srcRange <= 1e-4) return;

  const cache = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    const r = clampByte(px[i]);
    const g = clampByte(px[i + 1]);
    const b = clampByte(px[i + 2]);
    const key = (r << 16) | (g << 8) | b;
    let out = cache.get(key);
    if (out === undefined) {
      out = compressedDisplayRgb(r, g, b, srcBlackL, srcRange, targetBlackL, targetRange, strength);
      cache.set(key, out);
    }
    px[i] = (out >> 16) & 255;
    px[i + 1] = (out >> 8) & 255;
    px[i + 2] = out & 255;
  }
}

// ---------------------------------------------------------------------------
// Dithering → device colour codes.
// ---------------------------------------------------------------------------

function matcherClosest(palette: PaletteEntry[], matching: ColorMatching, r: number, g: number, b: number): number {
  const cr = clampByte(r);
  const cg = clampByte(g);
  const cb = clampByte(b);
  let best = 0;
  let bestD = Infinity;
  if (matching === 'lab') {
    const [L, A, B] = rgbToLab(cr, cg, cb);
    for (let i = 0; i < palette.length; i++) {
      const e = palette[i];
      const dl = L - e.lab[0];
      const da = A - e.lab[1];
      const db2 = B - e.lab[2];
      const d = dl * dl + da * da + db2 * db2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  } else {
    for (let i = 0; i < palette.length; i++) {
      const e = palette[i];
      const dr = cr - e.cr;
      const dg = cg - e.cg;
      const dbb = cb - e.cb;
      const d = dr * dr + dg * dg + dbb * dbb;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

/**
 * Optimise an RGBA buffer (width*height*4, top-left origin) to per-pixel device
 * colour codes. Mirrors the vendor Optimizer: ImageProcessor (tone + DRC) then
 * Dither, matching against measured inks and emitting device codes.
 */
export function optimizeToCodes(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: EpdOptions = defaultEpdOptions,
): Uint8Array {
  if (rgba.length < width * height * 4) throw new Error('RGBA buffer too small');
  const o = resolveOptions(options);
  const palette = PALETTES[o.palette];
  const n = width * height;
  const px = new Float64Array(n * 4);
  for (let i = 0; i < n * 4; i++) px[i] = rgba[i];

  if (o.toneMapping) applyToneMapping(px, o.toneMapping);
  if (o.drc) applyDrc(px, palette, o.drc);

  const codes = new Uint8Array(n);

  if (o.ditheringType === 'quantize') {
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      codes[i] = palette[matcherClosest(palette, o.matching, px[j], px[j + 1], px[j + 2])].code;
    }
    return codes;
  }

  if (o.ditheringType === 'ordered') {
    const bayer = bayerMatrix(o.orderedSize, o.orderedSize);
    const bh = bayer.length;
    const bw = bayer[0].length;
    const scale = bh * bw;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const j = (y * width + x) * 4;
        const bias = (bayer[y % bh][x % bw] / scale) * 64;
        codes[y * width + x] = palette[matcherClosest(palette, o.matching, px[j] + bias, px[j + 1] + bias, px[j + 2] + bias)].code;
      }
    }
    return codes;
  }

  // Error diffusion (default). Serpentine scan; error computed against the
  // measured ink appearance and clamped on every accumulation (ImageData.addError).
  const matrix = MATRICES[o.matrix];
  const factors = matrix.map(([, , num, den]) => num / den);
  for (let y = 0; y < height; y++) {
    const reverse = o.serpentine && y % 2 === 1;
    const xStart = reverse ? width - 1 : 0;
    const xEnd = reverse ? -1 : width;
    const step = reverse ? -1 : 1;
    for (let x = xStart; x !== xEnd; x += step) {
      const j = (y * width + x) * 4;
      const r = px[j];
      const g = px[j + 1];
      const b = px[j + 2];
      const idx = matcherClosest(palette, o.matching, r, g, b);
      const e = palette[idx];
      codes[y * width + x] = e.code;
      const er = r - e.cr;
      const eg = g - e.cg;
      const eb = b - e.cb;
      for (let m = 0; m < matrix.length; m++) {
        let dx = matrix[m][0];
        if (reverse) dx = -dx;
        const nx = x + dx;
        const ny = y + matrix[m][1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const f = factors[m];
        const o2 = (ny * width + nx) * 4;
        px[o2] = clampByte(px[o2] + er * f);
        px[o2 + 1] = clampByte(px[o2 + 1] + eg * f);
        px[o2 + 2] = clampByte(px[o2 + 2] + eb * f);
      }
    }
  }
  return codes;
}
