/**
 * Asset generator, run locally with `npm run gen-icons`.
 *
 * Produces, from the source CFC logos:
 *   public/brand/cfc-wordmark-white.png   trimmed white lockup for dark UI
 *   public/brand/cfc-wordmark-color.png   trimmed color lockup
 *   public/icons/icon-192.png             PWA icon (white logo on CFC navy)
 *   public/icons/icon-512.png
 *   public/icons/icon-512-maskable.png    full bleed navy, safe zone padding
 *   public/icons/apple-touch-icon.png     iOS home screen icon
 *   public/icons/favicon-32.png
 *
 * The outputs are committed so Vercel does not need to run this at build time.
 */
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

const NAVY = [15, 28, 49]; // #0f1c31

function readPng(p) {
  return PNG.sync.read(fs.readFileSync(p));
}
function writePng(p, png) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PNG.sync.write(png));
}
function bufToPng(buf, w, h) {
  const png = new PNG({ width: w, height: h });
  buf.copy(png.data);
  return png;
}

// Tight bounding box of non-transparent pixels, with padding as a fraction of
// the larger artwork side.
function crop(png, padFrac = 0.05, aThresh = 24) {
  const { width, height, data } = png;
  let minx = width, miny = height, maxx = 0, maxy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > aThresh) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  const pad = Math.round(Math.max(maxx - minx, maxy - miny) * padFrac);
  minx = Math.max(0, minx - pad);
  miny = Math.max(0, miny - pad);
  maxx = Math.min(width - 1, maxx + pad);
  maxy = Math.min(height - 1, maxy + pad);
  const w = maxx - minx + 1;
  const h = maxy - miny + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + miny) * width + (x + minx)) * 4;
      const d = (y * w + x) * 4;
      data.copy(out, d, s, s + 4);
    }
  }
  return { buf: out, w, h };
}

// Area-average downscale with premultiplied alpha, good enough for icons.
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor((dy * sh) / dh);
    const sy1 = Math.max(sy0 + 1, Math.ceil(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor((dx * sw) / dw);
      const sx1 = Math.max(sx0 + 1, Math.ceil(((dx + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, sumA = 0, sumAlpha = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < sh; sy++) {
        for (let sx = sx0; sx < sx1 && sx < sw; sx++) {
          const i = (sy * sw + sx) * 4;
          const a = src[i + 3] / 255;
          r += src[i] * a;
          g += src[i + 1] * a;
          b += src[i + 2] * a;
          sumA += a;
          sumAlpha += src[i + 3];
          n++;
        }
      }
      const o = (dy * dw + dx) * 4;
      out[o + 3] = Math.round(sumAlpha / n);
      if (sumA > 0) {
        out[o] = Math.round(r / sumA);
        out[o + 1] = Math.round(g / sumA);
        out[o + 2] = Math.round(b / sumA);
      }
    }
  }
  return out;
}

// White logo (trimmed) centered on a navy square.
function iconOnNavy(logo, size, innerFrac) {
  const inner = Math.round(size * innerFrac);
  const scale = Math.min(inner / logo.w, inner / logo.h);
  const tw = Math.max(1, Math.round(logo.w * scale));
  const th = Math.max(1, Math.round(logo.h * scale));
  const scaled = resize(logo.buf, logo.w, logo.h, tw, th);

  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = NAVY[0];
    out[i * 4 + 1] = NAVY[1];
    out[i * 4 + 2] = NAVY[2];
    out[i * 4 + 3] = 255;
  }
  const ox = Math.round((size - tw) / 2);
  const oy = Math.round((size - th) / 2);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const s = (y * tw + x) * 4;
      const a = scaled[s + 3] / 255;
      if (a <= 0) continue;
      const d = ((y + oy) * size + (x + ox)) * 4;
      out[d] = Math.round(scaled[s] * a + out[d] * (1 - a));
      out[d + 1] = Math.round(scaled[s + 1] * a + out[d + 1] * (1 - a));
      out[d + 2] = Math.round(scaled[s + 2] * a + out[d + 2] * (1 - a));
      out[d + 3] = 255;
    }
  }
  return bufToPng(out, size, size);
}

const root = process.cwd();
const white = readPng(path.join(root, 'public/brand/cfc-logo-white.png'));
const color = readPng(path.join(root, 'public/brand/cfc-logo-color.png'));

// Trimmed wordmarks for the UI.
const whiteCrop = crop(white, 0.05);
const colorCrop = crop(color, 0.05);
writePng(path.join(root, 'public/brand/cfc-wordmark-white.png'), bufToPng(whiteCrop.buf, whiteCrop.w, whiteCrop.h));
writePng(path.join(root, 'public/brand/cfc-wordmark-color.png'), bufToPng(colorCrop.buf, colorCrop.w, colorCrop.h));

// App icons, from the trimmed white lockup on navy.
writePng(path.join(root, 'public/icons/icon-192.png'), iconOnNavy(whiteCrop, 192, 0.8));
writePng(path.join(root, 'public/icons/icon-512.png'), iconOnNavy(whiteCrop, 512, 0.8));
writePng(path.join(root, 'public/icons/icon-512-maskable.png'), iconOnNavy(whiteCrop, 512, 0.62));
writePng(path.join(root, 'public/icons/apple-touch-icon.png'), iconOnNavy(whiteCrop, 180, 0.78));
writePng(path.join(root, 'public/icons/favicon-32.png'), iconOnNavy(whiteCrop, 32, 0.86));

console.log('Wordmarks:', `${whiteCrop.w}x${whiteCrop.h} white,`, `${colorCrop.w}x${colorCrop.h} color`);
console.log('Icons written to public/icons/.');
