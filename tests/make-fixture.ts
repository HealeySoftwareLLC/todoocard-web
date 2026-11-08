/**
 * Generates tests/fixtures/upright.png: a deterministic 528x792 test image with
 * gradients, hard edges and pseudo-random noise. The vendor converter was run
 * on this file to produce the expected bitmaps committed next to it.
 */
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

const W = 528;
const H = 792;
const png = new PNG({ width: W, height: H, colorType: 2 });
let seed = 0x12345678;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 10000) / 10000;
};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    let r = (x / W) * 255;
    let g = (y / H) * 255;
    let b = 255 - ((x + y) / (W + H)) * 255;
    if (x > 60 && x < 200 && y > 80 && y < 300) [r, g, b] = [230, 40, 30];
    if (x > 300 && x < 480 && y > 120 && y < 260) [r, g, b] = [20, 60, 220];
    if (y > 500 && y < 560) [r, g, b] = [250, 210, 20];
    if ((x >> 4) % 2 === 0 && y > 620 && y < 700) [r, g, b] = [0, 0, 0];
    if (y > 720) {
      const n = rnd() * 255;
      [r, g, b] = [n, n, n];
    }
    png.data[o] = Math.max(0, Math.min(255, Math.round(r + (rnd() - 0.5) * 12)));
    png.data[o + 1] = Math.max(0, Math.min(255, Math.round(g + (rnd() - 0.5) * 12)));
    png.data[o + 2] = Math.max(0, Math.min(255, Math.round(b + (rnd() - 0.5) * 12)));
    png.data[o + 3] = 255;
  }
}
writeFileSync(new URL('./fixtures/upright.png', import.meta.url), PNG.sync.write(png));
console.log('wrote tests/fixtures/upright.png');
