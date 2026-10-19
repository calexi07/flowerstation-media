// =============================================================
//  Video în browser: citire informații, compresie la 1080p (H.264),
//  cadru de copertă. Folosește Mediabunny (WebCodecs), încărcat doar
//  când e nevoie.
// =============================================================
import * as CFG from './config.js';

// Setări opționale în config.js (dacă lipsesc, se folosesc valorile de aici)
const VIDEO_MAX_EDGE = CFG.VIDEO_MAX_EDGE ?? 1920;   // 1920 = 1080p

const MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';
let mbLoading = null;
const mb = () => (mbLoading ??= import(MB_URL).catch(err => { mbLoading = null; throw err; }));

export const isVideo = f =>
  /^video\//.test(f.type || '') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name || '');

const even = n => Math.max(2, Math.round(n / 2) * 2);
const fmtMB = b => `${Math.round(b / 1024 / 1024)} MB`;

async function openInput(blob) {
  const M = await mb();
  const input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('Fișierul nu conține video.');
  return { M, input, track };
}

/** Durată, dimensiuni (ținând cont de rotație) și codec. */
export async function probeVideo(blob) {
  const { input, track } = await openInput(blob);
  return {
    duration: await input.computeDuration(),
    width: track.displayWidth, height: track.displayHeight,
    codec: track.codec,
  };
}

/**
 * Pregătește videoul pentru bibliotecă:
 * - H.264 + MP4 (merge peste tot: browsere, Instagram, Facebook, TikTok)
 * - latura lungă max. VIDEO_MAX_EDGE (implicit 1920 = 1080p)
 * - dacă iese peste maxBytes, mai încearcă o dată la calitate/rezoluție mai mică
 * Un video care e deja H.264, mic și la rezoluție OK e doar reîmpachetat (rapid, fără pierdere).
 */
export async function prepareVideo(file, { maxBytes, onProgress } = {}) {
  const M = await mb();
  const info = await probeVideo(file);
  const vcodec = await M.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1']);
  const acodec = await M.getFirstEncodableAudioCodec(['aac', 'opus']);
  if (!vcodec) throw new Error('Browserul nu poate comprima video. Folosește Chrome, Edge sau Safari actualizat.');

  const attempts = [
    { edge: VIDEO_MAX_EDGE, quality: M.QUALITY_MEDIUM },
    { edge: Math.min(VIDEO_MAX_EDGE, 1280), quality: M.QUALITY_LOW },
  ];
  const long = Math.max(info.width, info.height);

  for (let i = 0; i < attempts.length; i++) {
    const { edge, quality } = attempts[i];
    const scale = Math.min(1, edge / long);
    const copyOnly = i === 0 && info.codec === 'avc' && scale === 1 && (!maxBytes || file.size <= maxBytes);
    const w = even(info.width * scale), h = even(info.height * scale);

    const { input } = await openInput(file);
    const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    const video = copyOnly ? {} : {
      codec: vcodec, quality, forceTranscode: true,
      ...(scale < 1 ? (info.width >= info.height ? { width: w } : { height: h }) : {}),
    };
    const audioTrack = await input.getPrimaryAudioTrack();
    const audio = !audioTrack ? {} : (copyOnly && audioTrack.codec === 'aac') ? {} : acodec ? { codec: acodec } : { discard: true };

    const conv = await M.Conversion.init({ input, output, video, audio });
    if (!conv.isValid) {
      throw new Error('Video nesuportat: ' + conv.discardedTracks.map(t => t.reason).join(', '));
    }
    conv.onProgress = p => onProgress?.(p, i);
    await conv.execute();
    const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    if (!maxBytes || blob.size <= maxBytes) {
      return { blob, width: w, height: h, duration: info.duration, codec: copyOnly ? info.codec : vcodec, transcoded: !copyOnly };
    }
  }
  throw new Error(`Video prea mare (limita e ${fmtMB(maxBytes)} pe fișier). Scurtează clipul sau treci pe Supabase Pro.`);
}

/** Cadrul de copertă (implicit la 10% din durată, max. 1 s), ca sursă desenabilă pentru canvas. */
export async function videoFrame(blob, at = null) {
  try {
    const { input, track } = await openInput(blob);
    const duration = await input.computeDuration();
    const t = at ?? Math.min(1, duration * 0.1);
    const M = await mb();
    const sink = new M.CanvasSink(track, { width: Math.min(track.displayWidth, 1920) });
    const frame = (await sink.getCanvas(t)) ?? (await sink.getCanvas(0));
    if (!frame) throw new Error('fără cadru');
    const c = frame.canvas;
    return { source: c, width: c.width, height: c.height, blob: null, duration };
  } catch (err) {
    // varianta de rezervă: elementul <video> al browserului
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      v.onloadedmetadata = () => { v.currentTime = at ?? Math.min(1, (v.duration || 1) * 0.1); };
      v.onseeked = () => {
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        URL.revokeObjectURL(url);
        resolve({ source: c, width: c.width, height: c.height, blob: null, duration: v.duration });
      };
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nu am putut citi videoul în acest browser.')); };
    });
  }
}

export const fmtDuration = s => {
  if (!s && s !== 0) return '';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
