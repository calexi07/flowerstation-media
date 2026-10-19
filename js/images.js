// =============================================================
//  Procesare imagini în browser: decodare (inclusiv HEIC),
//  versiune master, miniatură, culoare dominantă, exporturi.
// =============================================================
import { MASTER_MAX, MASTER_JPEG_QUALITY, THUMB_MAX } from './config.js';

const HEIC_LIB = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
let heicLoading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Nu am putut încărca ' + src));
    document.head.appendChild(s);
  });
}

export function isHeic(file) {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}
export function isSvg(file) {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}
export function isGif(file) {
  return file.type === 'image/gif' || /\.gif$/i.test(file.name);
}

export async function sha256(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Transformă HEIC (poze iPhone) în JPEG, doar când e nevoie. */
async function heicToJpeg(file) {
  if (!heicLoading) heicLoading = loadScript(HEIC_LIB);
  await heicLoading;
  const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
  return Array.isArray(out) ? out[0] : out;
}

function loadImgElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imaginea nu poate fi citită')); };
    img.src = url;
  });
}

/** Returnează o sursă desenabilă { source, width, height } pentru orice fișier imagine. */
export async function decode(file) {
  let blob = file;
  if (isHeic(file)) {
    try {
      const bmp = await createImageBitmap(file);           // Safari decodează nativ HEIC
      return { source: bmp, width: bmp.width, height: bmp.height, blob: file };
    } catch { blob = await heicToJpeg(file); }
  }
  if (isSvg(file)) {
    const img = await loadImgElement(file);
    let w = img.naturalWidth || 1200, h = img.naturalHeight || 1200;
    if (w < 1200) { const k = 1200 / w; w = Math.round(w * k); h = Math.round(h * k); }
    return { source: img, width: w, height: h, blob };
  }
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { source: bmp, width: bmp.width, height: bmp.height, blob };
  } catch {
    const img = await loadImgElement(blob);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, blob };
  }
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export eșuat'))), type, quality));
}

function fitWithin(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

/** Verifică dacă imaginea are transparență (logo-uri PNG etc.). */
export function hasAlpha(dec) {
  const [w, h] = fitWithin(dec.width, dec.height, 96);
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(dec.source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

export function dominantColor(dec) {
  const c = canvasOf(8, 8);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(dec.source, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return '#efe9e1';
  const hex = v => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Versiunea master (cea publică): JPG pentru fotografii, PNG pentru imagini cu transparență.
 * SVG și GIF (posibil animat) se păstrează ca atare.
 */
export async function makeMaster(file, dec, alpha) {
  if (isSvg(file)) return { blob: file, mime: 'image/svg+xml', ext: 'svg', width: dec.width, height: dec.height };
  if (isGif(file) && file.size < 15 * 1024 * 1024)
    return { blob: file, mime: 'image/gif', ext: 'gif', width: dec.width, height: dec.height };

  const [w, h] = fitWithin(dec.width, dec.height, MASTER_MAX);
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (!alpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(dec.source, 0, 0, w, h);
  const blob = alpha ? await toBlob(c, 'image/png') : await toBlob(c, 'image/jpeg', MASTER_JPEG_QUALITY);
  return { blob, mime: blob.type, ext: alpha ? 'png' : 'jpg', width: w, height: h };
}

export async function makeThumb(dec, alpha) {
  const [w, h] = fitWithin(dec.width, dec.height, THUMB_MAX);
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (!alpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(dec.source, 0, 0, w, h);
  let blob = await toBlob(c, 'image/webp', 0.8);
  if (blob.type !== 'image/webp') blob = alpha ? await toBlob(c, 'image/png') : await toBlob(c, 'image/jpeg', 0.8);
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  return { blob, ext };
}

/**
 * Export într-un format anume.
 * fit 'contain' = doar micșorare; fit 'cover' = crop centrat pe punctul de focus (fx, fy ∈ 0..1).
 */
export async function exportFormat(dec, fmt, fx = 0.5, fy = 0.5, transparent = false) {
  const W = dec.width, H = dec.height;
  let c;
  if (fmt.fit === 'contain') {
    const [w, h] = fitWithin(W, H, Math.max(fmt.w, fmt.h));
    c = canvasOf(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(dec.source, 0, 0, w, h);
  } else {
    const s = Math.max(fmt.w / W, fmt.h / H);
    const cw = fmt.w / s, ch = fmt.h / s;
    const cx = Math.min(Math.max(fx * W - cw / 2, 0), W - cw);
    const cy = Math.min(Math.max(fy * H - ch / 2, 0), H - ch);
    c = canvasOf(fmt.w, fmt.h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fmt.w, fmt.h); }
    ctx.drawImage(dec.source, cx, cy, cw, ch, 0, 0, fmt.w, fmt.h);
  }
  return transparent ? toBlob(c, 'image/png') : toBlob(c, 'image/jpeg', 0.9);
}

/** Decodează o imagine de la un URL public (pentru exporturi). */
export async function decodeUrl(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('Nu am putut descărca imaginea');
  const blob = await res.blob();
  const name = url.split('/').pop().split('?')[0];
  return decode(new File([blob], name, { type: blob.type }));
}
