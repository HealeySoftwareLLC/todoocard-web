/**
 * Compose a source image onto the 528x792 panel canvas and run the device
 * pipeline. Uses createImageBitmap, which honours EXIF orientation in Chrome.
 */
import { PANEL_HEIGHT, PANEL_WIDTH } from '@shared/protocol';
import { buildT3Bitmaps, codesToRgba, colorUsage, type T3Bitmaps } from '@shared/image';

export type FitMode = 'cover' | 'contain';

export interface ComposeOptions {
  fit: FitMode;
  rotate: 0 | 90 | 180 | 270;
  background: string;
  zoom: number; // 1 = fit exactly
  panX: number; // -1..1 of the overflow
  panY: number;
  brightness: number; // 1 = unchanged
  contrast: number;
  saturation: number;
}

export const defaultCompose: ComposeOptions = {
  fit: 'cover',
  rotate: 0,
  background: '#ffffff',
  zoom: 1,
  panX: 0,
  panY: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1.15,
};

export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch (e) {
    throw new Error(`Could not decode image (${blob.type || 'unknown type'}). HEIC/HEIF is not supported by Chrome; convert to JPEG or PNG first. ${(e as Error).message ?? ''}`.trim());
  }
}

/** Draw the composed image at panel size and return RGBA pixels. */
export function composeToPanel(bitmap: ImageBitmap, o: ComposeOptions, canvas?: HTMLCanvasElement | OffscreenCanvas): ImageData {
  const c = canvas ?? new OffscreenCanvas(PANEL_WIDTH, PANEL_HEIGHT);
  c.width = PANEL_WIDTH;
  c.height = PANEL_HEIGHT;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.save();
  ctx.filter = 'none';
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
  const rotated = o.rotate === 90 || o.rotate === 270;
  const sw = rotated ? bitmap.height : bitmap.width;
  const sh = rotated ? bitmap.width : bitmap.height;
  const base = o.fit === 'cover' ? Math.max(PANEL_WIDTH / sw, PANEL_HEIGHT / sh) : Math.min(PANEL_WIDTH / sw, PANEL_HEIGHT / sh);
  const scale = base * o.zoom;
  const dw = sw * scale;
  const dh = sh * scale;
  const overflowX = Math.max(0, dw - PANEL_WIDTH) / 2;
  const overflowY = Math.max(0, dh - PANEL_HEIGHT) / 2;
  const cx = PANEL_WIDTH / 2 - o.panX * overflowX;
  const cy = PANEL_HEIGHT / 2 - o.panY * overflowY;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const filters: string[] = [];
  if (o.brightness !== 1) filters.push(`brightness(${o.brightness})`);
  if (o.contrast !== 1) filters.push(`contrast(${o.contrast})`);
  if (o.saturation !== 1) filters.push(`saturate(${o.saturation})`);
  ctx.filter = filters.length ? filters.join(' ') : 'none';
  ctx.translate(cx, cy);
  ctx.rotate((o.rotate * Math.PI) / 180);
  const bw = bitmap.width * scale;
  const bh = bitmap.height * scale;
  ctx.drawImage(bitmap, -bw / 2, -bh / 2, bw, bh);
  ctx.restore();
  return ctx.getImageData(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
}

export interface Prepared {
  bitmaps: T3Bitmaps;
  previewRgba: Uint8ClampedArray;
  usage: Record<string, number>;
}

export function prepareFromImageData(img: ImageData): Prepared {
  const bitmaps = buildT3Bitmaps(img.data);
  return { bitmaps, previewRgba: codesToRgba(bitmaps.uprightCodes), usage: colorUsage(bitmaps.uprightCodes) };
}

export function drawRgbaToCanvas(canvas: HTMLCanvasElement, rgba: Uint8ClampedArray, width: number, height: number) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}
