// =============================================================
//  Procesare imagini în browser: decodare (inclusiv HEIC),
//  versiune master, miniatură, culoare dominantă, exporturi.
// =============================================================
import { MASTER_MAX, MASTER_JPEG_QUALITY, THUMB_MAX } from './config.js';

// Decodor HEIC (poze iPhone) — libheif recent, încărcat doar când e nevoie (~3 MB)
const HEIC_LIB = 'https://cdn.jsdelivr.net/npm/heic-to@1.5.2/dist/heic-to.js';
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
  if (!heicLoading) heicLoading = import(HEIC_LIB).catch(err => { heicLoading = null; throw err; });
  const { heicTo } = await heicLoading;
  try {
    return await heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
  } catch (err) {
    console.error('HEIC', err);
    throw new Error('Fișierul HEIC nu a putut fi citit. Exportă poza ca JPG și încearcă din nou.');
  }
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

// ---------------------------------------------------------------- culori flori
/** Paleta de culori folosită pentru produse (id stocat în DB → etichetă + swatch). */
export const COLOR_PALETTE = [
  { id: 'rosu',       label: 'Roșu',       hex: '#C62828' },
  { id: 'roz',        label: 'Roz',        hex: '#EC8FB0' },
  { id: 'alb',        label: 'Alb',        hex: '#FFFFFF' },
  { id: 'galben',     label: 'Galben',     hex: '#F5C518' },
  { id: 'portocaliu', label: 'Portocaliu', hex: '#EE7A2B' },
  { id: 'piersica',   label: 'Piersică',   hex: '#F6B89A' },
  { id: 'mov',        label: 'Mov',        hex: '#8E5BB5' },
  { id: 'albastru',   label: 'Albastru',   hex: '#4A78C2' },
  { id: 'verde',      label: 'Verde',      hex: '#5E8C4A' },
  { id: 'multicolor', label: 'Multicolor', hex: 'conic-gradient(#C62828,#F5C518,#5E8C4A,#4A78C2,#8E5BB5,#EC8FB0,#C62828)' },
];

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Numele culorii unui pixel sau null (umbre, gri, maro/hârtie kraft). */
function colorName(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (l < 0.13) return null;                                  // umbre
  if (l > 0.82 && s < 0.35) return 'alb';
  if (s < 0.2) return l > 0.72 ? 'alb' : null;                // gri / neutru
  if (h >= 15 && h < 45 && s < 0.5 && l < 0.68) return null;   // maro, kraft, lemn
  if (h < 12 || h >= 345) return l > 0.62 ? 'roz' : 'rosu';
  if (h < 42) return l > 0.68 ? 'piersica' : 'portocaliu';
  if (h < 68) return 'galben';
  if (h < 165) return 'verde';
  if (h < 255) return 'albastru';
  if (h < 290) return 'mov';
  return 'roz';
}

/**
 * Detectează culorile florilor dintr-o imagine.
 * - estimează fundalul din marginea pozei și îl ignoră
 * - numără mai mult zona centrală (acolo e de obicei buchetul)
 * - verdeața contează doar dacă domină (aranjamente verzi, plante)
 * Rezultatul e o sugestie; se poate corecta manual.
 */
export function detectColors(dec) {
  const [w, h] = fitWithin(dec.width, dec.height, 120);
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(dec.source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const q = (i) => ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
  const bw = Math.max(2, Math.round(Math.min(w, h) * 0.07));

  // 1. Fundal: culorile frecvente pe marginea pozei
  const border = new Map(); let nb = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= bw && x < w - bw && y >= bw && y < h - bw) continue;
    const k = q((y * w + x) * 4); border.set(k, (border.get(k) || 0) + 1); nb++;
  }
  const bg = new Set([...border].filter(([, n]) => n / nb > 0.06).map(([k]) => k));

  // 2. Numărăm culorile din interior, ponderat spre centru
  const score = {}; let total = 0;
  const cx = w / 2, cy = h / 2, rmax = Math.hypot(cx, cy);
  for (let y = bw; y < h - bw; y++) for (let x = bw; x < w - bw; x++) {
    const i = (y * w + x) * 4;
    if (bg.has(q(i))) continue;
    const name = colorName(d[i], d[i + 1], d[i + 2]);
    if (!name) continue;
    const wgt = 1.4 - Math.hypot(x - cx, y - cy) / rmax;
    score[name] = (score[name] || 0) + wgt;
    total += wgt;
  }
  if (!total) return [];

  const green = score.verde || 0;
  const flowerTotal = total - green;
  if (flowerTotal / total < 0.12) return green ? ['verde'] : [];

  const ranked = Object.entries(score)
    .filter(([k]) => k !== 'verde')
    .map(([k, v]) => [k, v / flowerTotal])
    .sort((a, b) => b[1] - a[1]);
  const strong = ranked.filter(([, p]) => p >= 0.12);
  if (strong.length >= 4) return ['multicolor'];
  return ranked.filter(([, p], i) => i === 0 || p >= 0.18).slice(0, 3).map(([k]) => k);
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
