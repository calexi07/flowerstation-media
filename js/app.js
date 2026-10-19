// =============================================================
//  The Flower Station · Media Library
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET, STORAGE_QUOTA_BYTES, EXPORT_FORMATS, MASTER_MAX,
} from './config.js';
import {
  sha256, decode, decodeUrl, hasAlpha, dominantColor, makeMaster, makeThumb, exportFormat,
  isHeic, isSvg, detectColors, COLOR_PALETTE,
} from './images.js';
import { isVideo, prepareVideo, videoFrame, probeVideo, fmtDuration } from './video.js';
import * as CFG from './config.js';

// Limita pe fișier a planului Supabase (Free: 50 MB). Pe Pro pune MAX_FILE_MB în config.js.
const MAX_FILE_BYTES = (CFG.MAX_FILE_MB ?? 50) * 1024 * 1024;

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const store = () => sb.storage.from(BUCKET);

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slugify = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const cleanTag = t => norm(t).trim().replace(/\s+/g, ' ').replace(/^#/, '').slice(0, 40);
const publicUrl = p => p ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}` : '';
const fmtBytes = b => {
  if (!b) return '0 KB';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 1 ? 1 : 0)} ${u[i]}`;
};
const fmtDate = d => new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
const cleanFlower = t => {
  const s = String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};
const colorById = id => COLOR_PALETTE.find(c => c.id === id);
const swatchStyle = c => c.hex.startsWith('conic') ? `background:${c.hex}` : `background-color:${c.hex}`;
const orientationOf = a => {
  const r = a.width / a.height;
  return r > 1.1 ? 'landscape' : r < 0.9 ? 'portrait' : 'square';
};

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `max-w-sm rounded-xl px-4 py-3 text-sm shadow-card border ${
    type === 'err' ? 'bg-blush-soft border-blush text-blush-dark' : 'bg-ink text-white border-ink'}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, type === 'err' ? 5000 : 2600);
  setTimeout(() => el.remove(), type === 'err' ? 5400 : 3000);
}

async function copyText(text, label = 'Copiat') {
  try { await navigator.clipboard.writeText(text); toast(`${label} ✓`); }
  catch { window.prompt('Copiază manual:', text); }
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function downloadUrl(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Descărcare eșuată');
  saveBlob(await res.blob(), filename);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = Object.assign(document.createElement('script'), { src, async: true, onload: res, onerror: rej });
    document.head.appendChild(s);
  });
}

/** Dialog generic. body = HTML; collect(form) = valoarea returnată la OK. */
function ask({ title, body = '', ok = 'OK', danger = false, collect = () => true, onOpen }) {
  const dlg = $('#prompt-dialog');
  $('#prompt-title').textContent = title;
  $('#prompt-body').innerHTML = body;
  const okBtn = $('#prompt-ok');
  okBtn.textContent = ok;
  okBtn.className = `px-4 py-2 rounded-full text-sm text-white ${danger ? 'bg-blush-dark' : 'bg-moss'}`;
  onOpen?.($('#prompt-body'));
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(resolve => {
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok' ? collect($('#prompt-body')) : null);
    }, { once: true });
  });
}

// ---------------------------------------------------------------- state
const state = {
  user: null,
  categories: [],
  flowers: [],          // lista de flori din DB
  productFields: false, // true după ce s-a rulat migrarea 02 (flori + culori)
  assets: [],
  filter: { q: '', cat: null, orient: null, kind: null, tags: new Set(), flowers: new Set(), colors: new Set(), sort: 'new' },
  view: 'library',     // 'library' | 'review' (De revizuit) | 'products' (Produse Shopify)
  products: [],
  productsReady: false,
  selectMode: false,
  selected: new Set(),
  list: [],           // rezultatul filtrat curent
  shown: 0,           // câte carduri sunt randate
  detailId: null,
  detailDecoded: null,
  queue: [],
  uploading: false,
};
const PAGE = 120;

// ---------------------------------------------------------------- tag input
/**
 * Câmp cu chip-uri (tag-uri, flori).
 * opts.list = id-ul datalist-ului cu sugestii; opts.clean = normalizare;
 * opts.quick = () => listă de sugestii rapide afișate sub câmp (click = adaugă).
 */
function tagInput(container, initial = [], onChange = () => {}, opts = {}) {
  const clean = opts.clean || cleanTag;
  const same = (a, b) => norm(a) === norm(b);
  const dedupe = arr => arr.map(clean).filter(Boolean).filter((t, i, all) => all.findIndex(x => same(x, t)) === i);
  let tags = dedupe(initial);
  const chipCls = opts.chipClass || 'bg-moss-soft text-moss';
  container.innerHTML = `
    <div class="flex flex-wrap gap-1.5 rounded-lg border border-line bg-paper px-2 py-1.5 focus-within:ring-2 focus-within:ring-moss/30">
      <span class="chips contents"></span>
      <input list="${opts.list || 'tag-suggestions'}" placeholder="${opts.placeholder || 'adaugă tag + Enter'}" class="flex-1 min-w-[110px] outline-none text-sm py-0.5 bg-transparent" />
    </div>
    ${opts.quick ? '<div class="quick flex flex-wrap gap-1 mt-1.5"></div>' : ''}`;
  const chips = $('.chips', container);
  const input = $('input', container);
  const quick = $('.quick', container);
  const render = () => {
    chips.innerHTML = tags.map(t => `
      <span class="inline-flex items-center gap-1 rounded-full ${chipCls} text-xs px-2 py-1">
        ${esc(t)}<button type="button" data-t="${esc(t)}" class="hover:text-ink" aria-label="Șterge">×</button></span>`).join('');
    if (quick) {
      const left = opts.quick().filter(q => !tags.some(t => same(t, q))).slice(0, 14);
      quick.innerHTML = left.map(q => `<button type="button" data-q="${esc(q)}"
        class="text-[11px] px-2 py-0.5 rounded-full border border-line bg-paper hover:bg-cream text-muted">+ ${esc(q)}</button>`).join('');
    }
  };
  const add = raw => {
    const parts = raw.split(',').map(clean).filter(Boolean);
    let changed = false;
    for (const p of parts) if (!tags.some(t => same(t, p))) { tags.push(p); changed = true; }
    input.value = '';
    if (changed) { render(); onChange(tags); }
  };
  quick?.addEventListener('click', e => {
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (q) add(q);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); render(); onChange(tags); }
  });
  input.addEventListener('change', () => { if (input.value.trim()) add(input.value); });
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
  chips.addEventListener('click', e => {
    const t = e.target.closest('button')?.dataset.t;
    if (t) { tags = tags.filter(x => x !== t); render(); onChange(tags); }
  });
  render();
  return {
    get: () => { if (input.value.trim()) add(input.value); return [...tags]; },
    set: v => { tags = dedupe(v); render(); },
    refresh: render,
  };
}

// ---------------------------------------------------------------- flori & culori
const isProduct = catId => state.categories.find(c => c.id === catId)?.slug === 'produse';

/** Florile cele mai folosite primele, apoi restul listei. */
function flowerSuggestions() {
  const freq = new Map();
  for (const a of state.assets) for (const f of a.flowers || []) freq.set(f, (freq.get(f) || 0) + 1);
  const names = state.flowers.map(f => f.name);
  return [...new Set([...[...freq].sort((a, b) => b[1] - a[1]).map(([f]) => f), ...names])];
}

const flowerInput = (container, initial, onChange) => tagInput(container, initial, onChange, {
  list: 'flower-suggestions', clean: cleanFlower, placeholder: 'ex. Trandafiri + Enter',
  chipClass: 'bg-blush-soft text-blush-dark', quick: flowerSuggestions,
});

/** Salvează în lista de flori numele noi folosite la o poză. */
async function rememberFlowers(names) {
  const known = new Set(state.flowers.map(f => norm(f.name)));
  const fresh = names.filter(n => !known.has(norm(n)));
  if (!fresh.length) return;
  const { data, error } = await sb.from('flowers')
    .upsert(fresh.map(name => ({ name })), { onConflict: 'name', ignoreDuplicates: true }).select();
  if (!error && data) { state.flowers.push(...data); renderFlowerDatalist(); }
}

function renderFlowerDatalist() {
  $('#flower-suggestions').innerHTML = flowerSuggestions().map(f => `<option value="${esc(f)}">`).join('');
}

function colorSwatches(selected, { size = 'w-7 h-7', counts = null } = {}) {
  return COLOR_PALETTE.map(c => {
    const on = selected.includes(c.id);
    const n = counts ? counts.get(c.id) || 0 : null;
    if (counts && !n && !on) return '';
    return `<button type="button" data-color="${c.id}" title="${c.label}${n !== null ? ` (${n})` : ''}"
      class="relative ${size} rounded-full border ${c.id === 'alb' ? 'border-line' : 'border-transparent'} ${on ? 'ring-2 ring-offset-2 ring-moss' : 'opacity-80 hover:opacity-100'}"
      style="${swatchStyle(c)}" aria-pressed="${on}"><span class="sr-only">${c.label}</span></button>`;
  }).join('');
}

// ---------------------------------------------------------------- auth
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  await onSession(session);
  sb.auth.onAuthStateChange((_e, s) => {
    if ((s?.user?.id ?? null) !== (state.user?.id ?? null)) onSession(s);
  });
}

async function onSession(session) {
  state.user = session?.user ?? null;
  $('#auth-view').hidden = !!state.user;
  $('#app-view').hidden = !state.user;
  if (!state.user) return;
  const email = state.user.email || '';
  $('#user-btn').textContent = (email[0] || '?').toUpperCase();
  $('#user-email').textContent = email;
  await loadAll();
  const m = location.hash.match(/a=([0-9a-f-]{36})/);
  if (m) openDetail(m[1]);
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = $('#login-msg');
  msg.hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
  if (error) { msg.hidden = false; msg.className = 'text-sm text-center text-blush-dark'; msg.textContent = 'Email sau parolă greșită.'; }
});

$('#magic-link-btn').addEventListener('click', async () => {
  const email = $('#login-form [name=email]').value.trim();
  const msg = $('#login-msg');
  msg.hidden = false;
  if (!email) { msg.className = 'text-sm text-center text-blush-dark'; msg.textContent = 'Scrie întâi adresa de email.'; return; }
  const { error } = await sb.auth.signInWithOtp({
    email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
  });
  msg.className = `text-sm text-center ${error ? 'text-blush-dark' : 'text-moss'}`;
  msg.textContent = error ? 'Nu am putut trimite linkul. Contul există?' : 'Verifică emailul — ți-am trimis un link.';
});

$('#user-btn').addEventListener('click', e => { e.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; });
document.addEventListener('click', () => { $('#user-menu').hidden = true; });
$('#logout-btn').addEventListener('click', () => sb.auth.signOut());

// ---------------------------------------------------------------- data
async function loadCategories() {
  const { data, error } = await sb.from('categories').select('*').order('sort').order('name');
  if (error) throw error;
  state.categories = data;
  const opts = data.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const up = $('#up-category');
  const upVal = up.value;
  up.innerHTML = '<option value="" disabled>Alege categoria…</option>' + opts;
  up.value = upVal || '';
  const dsel = $('#detail-form').elements.category_id;
  const dVal = dsel.value;
  dsel.innerHTML = '<option value="">— fără categorie —</option>' + opts;
  dsel.value = dVal || '';
}

async function loadAssets() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('assets').select('*')
      .order('created_at', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  state.assets = all;
}

async function loadFlowers() {
  const { data, error } = await sb.from('flowers').select('*').order('name');
  state.productFields = !error;
  if (error) {
    console.warn('Lista de flori lipsește — rulează supabase/migrare-02-flori-culori.sql', error);
    state.flowers = [];
    return;
  }
  state.flowers = data;
}

async function loadAll() {
  $('#loading').hidden = false;
  try {
    await Promise.all([loadCategories(), loadAssets(), loadFlowers(), loadProducts()]);
    refreshProductDatalists();
    renderFlowerDatalist();
    upFlowers?.refresh();
  } catch (err) {
    console.error(err);
    toast('Nu am putut încărca datele. Verifică configurarea Supabase.', 'err');
  }
  $('#loading').hidden = true;
  render();
  const n = reviewAssets().length;
  if (n && state.view !== 'review') toast(`📱 ${n} ${n === 1 ? 'poză nouă' : 'poze noi'} de pe telefon în „De revizuit”`);
  processPending();
}

const catName = id => state.categories.find(c => c.id === id)?.name ?? '—';
const inReview = a => a.status === 'review';
const libraryAssets = () => state.assets.filter(a => !inReview(a));
const reviewAssets = () => state.assets.filter(inReview);

// ---------------------------------------------------------------- filter + render
function applyFilter() {
  const f = state.filter;
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  const review = state.view === 'review';
  let list = state.assets.filter(a => {
    if (review !== inReview(a)) return false;
    if (!review && f.cat && a.category_id !== f.cat) return false;
    if (f.orient && orientationOf(a) !== f.orient) return false;
    if (f.kind && (a.kind || 'image') !== f.kind) return false;
    for (const t of f.tags) if (!a.tags.includes(t)) return false;
    for (const fl of f.flowers) if (!(a.flowers || []).includes(fl)) return false;
    for (const c of f.colors) if (!(a.colors || []).includes(c)) return false;
    if (terms.length) {
      const hay = norm([a.title, a.description, a.alt_text, a.credit, a.original_name, catName(a.category_id), ...a.tags,
        ...(a.flowers || []), ...(a.colors || []).map(c => colorById(c)?.label)].join(' '));
      return terms.every(t => hay.includes(t));
    }
    return true;
  });
  const by = {
    new: (a, b) => (b.taken_at || b.created_at).localeCompare(a.taken_at || a.created_at),
    old: (a, b) => a.created_at.localeCompare(b.created_at),
    az:  (a, b) => a.title.localeCompare(b.title, 'ro'),
    big: (a, b) => b.width * b.height - a.width * a.height,
  }[f.sort];
  state.list = list.sort(by);
}

function render() {
  const productsView = state.view === 'products';
  $('#pv') && ($('#pv').hidden = !productsView);
  $('#grid').hidden = productsView;
  $('#select-mode-btn').hidden = productsView;
  $('#sort').hidden = productsView;
  if (productsView) {
    $('#empty').hidden = true;
    sentinelObs?.disconnect(); $('#grid-sentinel')?.remove();
    state.selectMode = false; renderBulkBar();
    renderSidebar(); renderToolbar(); renderProducts();
    $('#pv').hidden = false;
    return;
  }
  applyFilter();
  renderSidebar();
  renderToolbar();
  state.shown = 0;
  $('#grid').innerHTML = '';
  appendCards();
  const none = state.list.length === 0;
  $('#empty').hidden = !none || !$('#loading').hidden;
  if (none && state.view === 'review') {
    $('#empty-title').textContent = 'Nimic de revizuit';
    $('#empty-sub').textContent = 'Pozele trimise de pe iPhone apar aici până decizi dacă le păstrezi.';
  } else if (none) {
    const anyAssets = state.assets.length > 0;
    $('#empty-title').textContent = anyAssets ? 'Niciun rezultat' : 'Nicio imagine încă';
    $('#empty-sub').textContent = anyAssets ? 'Încearcă alți termeni sau scoate din filtre.' : 'Trage poze oriunde pe pagină sau apasă „Încarcă”.';
  }
  renderBulkBar();
}

function cardHtml(a) {
  const sel = state.selected.has(a.id);
  const transparent = /png|svg|gif/.test(a.mime);
  return `
  <div class="card relative rounded-[14px] overflow-hidden bg-paper shadow-card ${sel ? 'selected' : ''}" data-id="${a.id}">
    <button class="open block w-full ${transparent ? 'checker' : ''}" style="aspect-ratio:${a.width}/${a.height};background-color:${transparent ? '' : esc(a.color || '#efe9e1')}" aria-label="${esc(a.title)}">
      ${a.kind === 'video' && (!a.thumb_path || a.thumb_path === a.master_path)
        ? `<span class="w-full h-full min-h-[160px] grid place-items-center text-muted bg-cream"><span class="text-center"><span class="text-3xl block">▶</span><span class="text-xs">${a.processed === false ? 'Pregătesc coperta…' : 'Video'}</span></span></span>`
        : a.processed === false && /heic/.test(a.mime)
        ? '<span class="w-full h-full min-h-[160px] grid place-items-center text-xs text-muted"><span><span class="spin inline-block">◌</span> Pregătesc…</span></span>'
        : `<img src="${publicUrl(a.thumb_path)}" alt="${esc(a.alt_text || a.title)}" loading="lazy" decoding="async" class="w-full h-full object-cover" />`}
    </button>
    ${inReview(a) ? `
    <div class="absolute bottom-0 inset-x-0 p-2 flex gap-1.5 bg-gradient-to-t from-ink/80 to-transparent pt-8">
      <button class="rv-keep flex-1 rounded-full bg-moss hover:bg-moss-dark text-white text-xs font-medium py-1.5">✓ Păstrează</button>
      <button class="rv-drop rounded-full bg-white/90 hover:bg-white text-blush-dark text-xs font-medium px-3 py-1.5">✕ Șterge</button>
    </div>` : ''}
    <div class="overlay pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-ink/10"></div>
    ${a.kind === 'video' && a.duration ? `<span class="pointer-events-none absolute ${inReview(a) ? 'top-2 right-2' : 'top-11 right-2'} text-[11px] font-medium px-2 py-0.5 rounded-full bg-ink/75 text-white">▶ ${fmtDuration(a.duration)}</span>` : ''}
    <button class="sel overlay absolute top-2 left-2 w-7 h-7 rounded-full grid place-items-center text-xs border-2 ${sel ? 'bg-moss border-moss text-white' : 'bg-white/80 border-white text-transparent hover:text-moss'}" aria-label="Selectează">✓</button>
    <button class="cp overlay absolute top-2 right-2 h-7 px-2.5 rounded-full bg-white/90 text-ink text-xs font-medium hover:bg-white" title="Copiază link public">Link</button>
    <div class="overlay pointer-events-none absolute bottom-0 inset-x-0 p-3 text-white ${inReview(a) ? 'hidden' : ''}">
      <p class="text-sm font-medium leading-tight line-clamp-2">${esc(a.title)}</p>
      <p class="text-[11px] opacity-80 mt-0.5">${esc((a.flowers || []).length ? a.flowers.join(', ') : catName(a.category_id))} · ${a.width}×${a.height}</p>
      ${(a.colors || []).length ? `<div class="flex gap-1 mt-1.5">${a.colors.map(id => colorById(id)).filter(Boolean)
        .map(c => `<span class="w-3.5 h-3.5 rounded-full border border-white/70" style="${swatchStyle(c)}" title="${c.label}"></span>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

let sentinelObs;
function appendCards() {
  const next = state.list.slice(state.shown, state.shown + PAGE);
  $('#grid').insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
  state.shown += next.length;
  sentinelObs?.disconnect();
  $('#grid-sentinel')?.remove();
  if (state.shown < state.list.length) {
    $('#grid').insertAdjacentHTML('afterend', '<div id="grid-sentinel" class="h-10"></div>');
    sentinelObs ??= new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) appendCards(); }, { rootMargin: '800px' });
    sentinelObs.observe($('#grid-sentinel'));
  }
}

function renderSidebar() {
  const lib = libraryAssets();
  const counts = new Map();
  for (const a of lib) counts.set(a.category_id, (counts.get(a.category_id) || 0) + 1);
  const nReview = state.assets.length - lib.length;
  const isLib = state.view === 'library';
  const item = (id, name, n) => `
    <button data-cat="${id ?? ''}" class="w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm ${
      isLib && state.filter.cat === id ? 'bg-moss text-white' : 'hover:bg-line/50'}">
      <span class="truncate">${esc(name)}</span><span class="text-xs ${isLib && state.filter.cat === id ? 'text-white/80' : 'text-muted'}">${n}</span></button>`;
  const reviewItem = nReview || state.view === 'review' ? `
    <button data-review class="w-full flex justify-between items-center px-3 py-2 mb-2 rounded-lg text-sm font-medium ${
      state.view === 'review' ? 'bg-blush-dark text-white' : 'bg-blush-soft text-blush-dark hover:bg-blush/40'}">
      <span>📱 De revizuit</span><span class="text-xs min-w-[22px] text-center rounded-full px-1.5 py-0.5 ${state.view === 'review' ? 'bg-white/25' : 'bg-blush-dark text-white'}">${nReview}</span></button>` : '';
  const pvActive = state.view === 'products';
  const productsItem = state.productsReady ? `
    <button data-products class="w-full flex justify-between items-center px-3 py-2 mb-2 rounded-lg text-sm font-medium ${
      pvActive ? 'bg-ink text-white' : 'bg-cream border border-line hover:bg-line/50'}">
      <span>🛍️ Produse Shopify</span><span class="text-xs ${pvActive ? 'text-white/80' : 'text-muted'}">${batchProducts().length}</span></button>` : '';
  $('#cat-list').innerHTML = reviewItem + productsItem + item(null, 'Toate', lib.length) +
    state.categories.map(c => item(c.id, c.name, counts.get(c.id) || 0)).join('');

  const orients = [[null, 'Toate'], ['landscape', 'Peisaj'], ['portrait', 'Portret'], ['square', 'Pătrat']];
  $('#orient-list').innerHTML = orients.map(([v, l]) => `
    <button data-orient="${v ?? ''}" class="text-xs px-2.5 py-1 rounded-full border ${
      state.filter.orient === v ? 'bg-ink text-white border-ink' : 'border-line bg-paper hover:bg-cream'}">${l}</button>`).join('') +
    (lib.some(a => a.kind === 'video') ? '<span class="basis-full h-0"></span>' + [[null, 'Poze + video'], ['image', 'Poze'], ['video', '▶ Video']].map(([v, l]) => `
    <button data-kind="${v ?? ''}" class="text-xs px-2.5 py-1 rounded-full border ${
      state.filter.kind === v ? 'bg-ink text-white border-ink' : 'border-line bg-paper hover:bg-cream'}">${l}</button>`).join('') : '');

  const freq = new Map();
  for (const a of lib) for (const t of a.tags) freq.set(t, (freq.get(t) || 0) + 1);
  const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 40);
  $('#tag-cloud').innerHTML = top.length ? top.map(([t, n]) => `
    <button data-tag="${esc(t)}" class="text-xs px-2.5 py-1 rounded-full ${
      state.filter.tags.has(t) ? 'bg-moss text-white' : 'bg-moss-soft text-moss hover:bg-moss/20'}">${esc(t)} <span class="opacity-60">${n}</span></button>`).join('')
    : '<p class="text-xs text-muted">Tag-urile apar aici după primele încărcări.</p>';
  $('#tag-suggestions').innerHTML = [...freq.keys()].sort().map(t => `<option value="${esc(t)}">`).join('');

  // culori & flori (din pozele care le au)
  const colorCounts = new Map(), flowerCounts = new Map();
  for (const a of lib) {
    for (const c of a.colors || []) colorCounts.set(c, (colorCounts.get(c) || 0) + 1);
    for (const fl of a.flowers || []) flowerCounts.set(fl, (flowerCounts.get(fl) || 0) + 1);
  }
  $('#color-filter-wrap').hidden = !colorCounts.size || !isLib;
  $('#color-filter').innerHTML = colorSwatches([...state.filter.colors], { size: 'w-6 h-6', counts: colorCounts });
  $('#flower-filter-wrap').hidden = !flowerCounts.size || !isLib;
  $('#flower-filter').innerHTML = [...flowerCounts].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([fl, n]) => `
    <button data-flower="${esc(fl)}" class="text-xs px-2.5 py-1 rounded-full ${
      state.filter.flowers.has(fl) ? 'bg-blush-dark text-white' : 'bg-blush-soft text-blush-dark hover:bg-blush/40'}">${esc(fl)} <span class="opacity-60">${n}</span></button>`).join('');

  const used = state.assets.reduce((s, a) => s + (a.size_bytes || 0) + (a.original_bytes || 0) + (a.thumb_bytes || 0), 0);
  const pct = Math.min(100, (used / STORAGE_QUOTA_BYTES) * 100);
  $('#storage-label').textContent = `${fmtBytes(used)} / ${fmtBytes(STORAGE_QUOTA_BYTES)}`;
  $('#storage-bar').style.width = `${pct}%`;
  $('#storage-bar').className = `h-full rounded-full ${pct > 85 ? 'bg-blush-dark' : 'bg-moss'}`;
}

function renderToolbar() {
  const f = state.filter;
  if (state.view === 'products') {
    $('#view-title').textContent = 'Produse Shopify';
    $('#result-count').textContent = `${state.products.length} ${state.products.length === 1 ? 'produs' : 'produse'}`;
    $('#active-filters').innerHTML = '';
    return;
  }
  $('#view-title').textContent = state.view === 'review' ? 'De revizuit' : f.cat ? catName(f.cat) : 'Toate imaginile';
  $('#result-count').textContent = `${state.list.length} ${state.list.length === 1 ? 'imagine' : 'imagini'}`;
  const chips = [];
  if (f.q) chips.push(['q', `„${f.q}”`]);
  if (f.kind) chips.push(['kind', f.kind === 'video' ? '▶ Video' : 'Poze']);
  if (f.orient) chips.push(['orient', { landscape: 'Peisaj', portrait: 'Portret', square: 'Pătrat' }[f.orient]]);
  for (const t of f.tags) chips.push(['tag:' + t, '#' + t]);
  for (const fl of f.flowers) chips.push(['flower:' + fl, '🌸 ' + fl]);
  for (const c of f.colors) chips.push(['color:' + c, '● ' + (colorById(c)?.label || c)]);
  $('#active-filters').innerHTML = chips.map(([k, l]) => `
    <button data-clear="${esc(k)}" class="text-xs px-2.5 py-1 rounded-full bg-blush-soft text-blush-dark hover:bg-blush/40">${esc(l)} ×</button>`).join('');
}

// sidebar & toolbar events
$('#cat-list').addEventListener('click', e => {
  if (e.target.closest('[data-review]')) {
    state.view = 'review'; state.selected.clear(); closeSidebar(); return render();
  }
  if (e.target.closest('[data-products]')) {
    state.view = 'products'; state.selected.clear(); pvState.step = pickStep(); if (pvState.step === 'fill') goStep('fill');
    closeSidebar(); return render();
  }
  const b = e.target.closest('[data-cat]'); if (!b) return;
  if (state.view !== 'library') { state.view = 'library'; state.selected.clear(); }
  state.filter.cat = b.dataset.cat ? Number(b.dataset.cat) : null;
  closeSidebar(); render();
});
$('#orient-list').addEventListener('click', e => {
  const k = e.target.closest('[data-kind]');
  if (k) { state.filter.kind = k.dataset.kind || null; return render(); }
  const b = e.target.closest('[data-orient]'); if (!b) return;
  state.filter.orient = b.dataset.orient || null; render();
});
$('#tag-cloud').addEventListener('click', e => {
  const t = e.target.closest('[data-tag]')?.dataset.tag; if (!t) return;
  state.filter.tags.has(t) ? state.filter.tags.delete(t) : state.filter.tags.add(t); render();
});
$('#active-filters').addEventListener('click', e => {
  const k = e.target.closest('[data-clear]')?.dataset.clear; if (!k) return;
  if (k === 'q') { state.filter.q = ''; $('#search').value = ''; }
  else if (k === 'orient') state.filter.orient = null;
  else if (k === 'kind') state.filter.kind = null;
  else if (k.startsWith('tag:')) state.filter.tags.delete(k.slice(4));
  else if (k.startsWith('flower:')) state.filter.flowers.delete(k.slice(7));
  else if (k.startsWith('color:')) state.filter.colors.delete(k.slice(6));
  render();
});
$('#color-filter').addEventListener('click', e => {
  const c = e.target.closest('[data-color]')?.dataset.color; if (!c) return;
  state.filter.colors.has(c) ? state.filter.colors.delete(c) : state.filter.colors.add(c); render();
});
$('#flower-filter').addEventListener('click', e => {
  const fl = e.target.closest('[data-flower]')?.dataset.flower; if (!fl) return;
  state.filter.flowers.has(fl) ? state.filter.flowers.delete(fl) : state.filter.flowers.add(fl); render();
});
let searchT;
$('#search').addEventListener('input', e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { state.filter.q = e.target.value.trim(); if (state.view === 'products') state.view = 'library'; render(); }, 150);
});
$('#sort').addEventListener('change', e => { state.filter.sort = e.target.value; render(); });
$('#home-link').addEventListener('click', e => {
  e.preventDefault();
  state.view = 'library';
  Object.assign(state.filter, { q: '', cat: null, orient: null, kind: null, tags: new Set(), flowers: new Set(), colors: new Set() });
  $('#search').value = ''; render();
});

function openSidebar() { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebar-scrim').hidden = false; }
function closeSidebar() { $('#sidebar').classList.add('-translate-x-full'); $('#sidebar-scrim').hidden = true; }
$('#filters-toggle').addEventListener('click', () =>
  $('#sidebar').classList.contains('-translate-x-full') ? openSidebar() : closeSidebar());
$('#sidebar-scrim').addEventListener('click', closeSidebar);

$('#add-cat-btn').addEventListener('click', async () => {
  const name = await ask({
    title: 'Categorie nouă', ok: 'Adaugă',
    body: '<input name="n" class="w-full rounded-lg border border-line px-3 py-2" placeholder="Ex: Plante de apartament" />',
    onOpen: b => setTimeout(() => $('input', b).focus(), 50),
    collect: b => $('input', b).value.trim(),
  });
  if (!name) return;
  const sort = Math.max(0, ...state.categories.map(c => c.sort)) + 10;
  const { error } = await sb.from('categories').insert({ name, slug: slugify(name), sort });
  if (error) return toast(error.code === '23505' ? 'Categoria există deja.' : 'Nu am putut adăuga categoria.', 'err');
  await loadCategories(); render(); toast('Categorie adăugată');
});

// ---------------------------------------------------------------- grid events & selection
$('#grid').addEventListener('click', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const id = card.dataset.id;
  const a = state.assets.find(x => x.id === id);
  if (e.target.closest('.rv-keep')) return approveAssets([a]);
  if (e.target.closest('.rv-drop')) return rejectAssets([a]);
  if (e.target.closest('.cp')) return copyText(publicUrl(a.master_path), 'Link copiat');
  if (e.target.closest('.sel') || state.selectMode || e.metaKey || e.ctrlKey || e.shiftKey) return toggleSelect(id, card);
  openDetail(id);
});

function toggleSelect(id, card) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  if (state.selected.size) state.selectMode = true;
  card = card || $(`.card[data-id="${id}"]`);
  if (card) card.outerHTML = cardHtml(state.assets.find(a => a.id === id));
  renderBulkBar();
}

function renderBulkBar() {
  const n = state.selected.size;
  $('#bulk-bar').hidden = !state.selectMode;
  $('#bulk-count').textContent = n ? `${n} ${n === 1 ? 'selectată' : 'selectate'}` : 'Alege imagini';
  $('#select-mode-btn').textContent = state.selectMode ? 'Gata' : 'Selectează';
  if (!$('#bulk-bar [data-bulk="approve"]')) {
    $('#bulk-count').insertAdjacentHTML('afterend', '<button data-bulk="approve" class="px-3 py-1.5 rounded-full bg-moss hover:bg-moss-dark">✓ Păstrează</button>');
  }
  const review = state.view === 'review';
  $$('#bulk-bar [data-bulk]').forEach(b => {
    if (!['all', 'cancel'].includes(b.dataset.bulk)) b.disabled = !n, b.style.opacity = n ? '' : '.4';
    const k = b.dataset.bulk;
    b.hidden = review ? ['tag', 'category'].includes(k) : k === 'approve';
  });
}

function exitSelect() { state.selectMode = false; state.selected.clear(); render(); }
$('#select-mode-btn').addEventListener('click', () => {
  if (state.selectMode) exitSelect(); else { state.selectMode = true; renderBulkBar(); }
});

$('#bulk-bar').addEventListener('click', async e => {
  const act = e.target.closest('[data-bulk]')?.dataset.bulk; if (!act) return;
  const ids = [...state.selected];
  const items = ids.map(id => state.assets.find(a => a.id === id)).filter(Boolean);

  if (act === 'cancel') return exitSelect();
  if (act === 'approve') return approveAssets(items);
  if (act === 'delete' && state.view === 'review') return rejectAssets(items);
  if (act === 'all') { state.list.forEach(a => state.selected.add(a.id)); return render(); }

  if (act === 'tag') {
    let ti;
    const tags = await ask({
      title: `Adaugă tag-uri la ${items.length} imagini`, ok: 'Adaugă',
      body: '<div id="bulk-tags"></div>',
      onOpen: b => { ti = tagInput($('#bulk-tags', b)); },
      collect: () => ti.get(),
    });
    if (!tags?.length) return;
    let fail = 0;
    await Promise.all(items.map(async a => {
      const merged = [...new Set([...a.tags, ...tags])];
      const { error } = await sb.from('assets').update({ tags: merged }).eq('id', a.id);
      if (error) fail++; else a.tags = merged;
    }));
    toast(fail ? `${fail} actualizări au eșuat` : 'Tag-uri adăugate', fail ? 'err' : 'ok');
    return render();
  }

  if (act === 'category') {
    const opts = state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const cat = await ask({
      title: `Mută ${items.length} imagini în…`, ok: 'Mută',
      body: `<select class="w-full rounded-lg border border-line px-3 py-2">${opts}</select>`,
      collect: b => Number($('select', b).value),
    });
    if (!cat) return;
    const { error } = await sb.from('assets').update({ category_id: cat }).in('id', ids);
    if (error) return toast('Nu am putut muta imaginile.', 'err');
    items.forEach(a => { a.category_id = cat; });
    toast('Categorie schimbată'); return render();
  }

  if (act === 'download') {
    if (items.length === 1) {
      const a = items[0];
      return downloadUrl(publicUrl(a.master_path), a.master_path.split('/').pop()).catch(() => toast('Descărcare eșuată', 'err'));
    }
    toast(`Pregătesc arhiva (${items.length} imagini)…`);
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      const zip = new window.JSZip();
      const used = new Set();
      await Promise.all(items.map(async a => {
        const blob = await (await fetch(publicUrl(a.master_path))).blob();
        let name = a.master_path.split('/').pop();
        if (used.has(name)) name = `${a.id.slice(0, 6)}-${name}`;
        used.add(name);
        zip.file(name, blob);
      }));
      const out = await zip.generateAsync({ type: 'blob' });
      saveBlob(out, `flowerstation-media-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) { console.error(err); toast('Nu am putut crea arhiva.', 'err'); }
    return;
  }

  if (act === 'delete') {
    const ok = await ask({
      title: `Ștergi ${items.length} imagini?`, ok: 'Șterge definitiv', danger: true,
      body: '<p class="text-sm text-muted">Linkurile publice nu vor mai funcționa (inclusiv pe site sau în newslettere).</p>',
    });
    if (!ok) return;
    const ok2 = await deleteAssets(items);
    if (ok2) { toast(`${items.length} imagini șterse`); exitSelect(); }
  }
});

async function deleteAssets(items) {
  const paths = [...new Set(items.flatMap(a => [a.master_path, a.thumb_path, a.original_path, a.poster_path]).filter(Boolean))];
  const { error: e1 } = await sb.from('assets').delete().in('id', items.map(a => a.id));
  if (e1) { toast('Nu am putut șterge.', 'err'); return false; }
  const { error: e2 } = await store().remove(paths);
  if (e2) console.warn('Fișiere rămase în storage:', e2);
  const gone = new Set(items.map(a => a.id));
  state.assets = state.assets.filter(a => !gone.has(a.id));
  items.forEach(a => state.selected.delete(a.id));
  return true;
}

// ---------------------------------------------------------------- detail
const detail = $('#detail-dialog');
let detailTags;

function openDetail(id) {
  const a = state.assets.find(x => x.id === id);
  if (!a) return;
  state.detailId = id;
  state.detailDecoded = null;
  history.replaceState(null, '', `#a=${id}`);

  const img = $('#detail-img');
  const isVid = a.kind === 'video';
  let player = $('#detail-video');
  if (!player) {
    img.insertAdjacentHTML('afterend', '<video id="detail-video" controls playsinline preload="metadata" class="block max-w-full max-h-[50vh] lg:max-h-[86vh] bg-ink" hidden></video>');
    player = $('#detail-video');
  }
  player.pause();
  player.hidden = !isVid;
  img.hidden = isVid;
  $('#focal-dot').hidden = true;
  $('#detail-frame').nextElementSibling.hidden = isVid;   // indicația cu punctul de focus
  if (isVid) {
    player.poster = a.poster_path ? publicUrl(a.poster_path) : '';
    player.src = publicUrl(a.master_path);
    img.removeAttribute('src');
  } else {
    player.removeAttribute('src'); player.load();
    img.src = publicUrl(a.master_path);
    img.alt = a.alt_text || a.title;
    img.classList.toggle('checker', /png|svg|gif/.test(a.mime));
    img.onload = () => placeFocal(a);
  }

  const f = $('#detail-form');
  const el = f.elements;
  el.title.value = a.title;
  el.category_id.value = a.category_id ?? '';
  el.alt_text.value = a.alt_text ?? '';
  el.description.value = a.description ?? '';
  el.credit.value = a.credit ?? '';
  detailTags = tagInput($('.tag-input', f), a.tags, () => { $('#detail-save').hidden = false; });
  detailFlowers = flowerInput($('#detail-flowers'), a.flowers || [], () => { $('#detail-save').hidden = false; });
  detailColors = [...(a.colors || [])];
  detailColorsManual = !!a.colors_manual;
  renderDetailColors();
  toggleDetailProduct();
  $('#detail-save').hidden = true;
  // produs fără culori încă (ex. încărcat înainte de actualizare) → detectăm automat
  if (state.productFields && isProduct(a.category_id) && !detailColors.length && !a.colors_manual && (a.kind !== 'video' || a.poster_path)) autoColors(a, true);

  ensureRenameUi();
  ensureReviewBar();
  $('#review-bar').hidden = !inReview(a);
  $('#detail-filename').textContent = a.master_path.split('/').pop();
  const ext = a.master_path.split('.').pop().toUpperCase();
  $('#detail-meta').textContent = `${a.width} × ${a.height} px · ${ext} · ${fmtBytes(a.size_bytes)}`;
  $('#detail-uploader').textContent = `Încărcată ${fmtDate(a.created_at)}${a.uploader_email ? ' de ' + a.uploader_email : ''}`;

  renderDownloads(a);
  const idx = state.list.findIndex(x => x.id === id);
  $('#detail-prev').hidden = idx <= 0;
  $('#detail-next').hidden = idx < 0 || idx >= state.list.length - 1;
  if (!detail.open) detail.showModal();
}

let detailFlowers, detailColors = [], detailColorsManual = false;

// ---------------------------------------------------------------- redenumire
/** Adaugă (o singură dată) sub titlu numele fișierului + butonul „Redenumește”. */
function ensureRenameUi() {
  if ($('#rename-btn')) return;
  const title = $('#detail-form').elements.title;
  title.insertAdjacentHTML('afterend', `
    <div class="flex items-center gap-2 text-xs text-muted -mt-1">
      <span class="shrink-0">Fișier:</span>
      <span id="detail-filename" class="truncate font-mono"></span>
      <button type="button" id="rename-btn" class="ml-auto shrink-0 text-moss hover:underline">✎ Redenumește</button>
    </div>`);
  $('#rename-btn').addEventListener('click', () => {
    const a = state.assets.find(x => x.id === state.detailId);
    if (a) renameAsset(a);
  });
}

async function renameAsset(a) {
  const res = await ask({
    title: 'Redenumește imaginea', ok: 'Redenumește',
    body: `
      <label class="block text-sm"><span class="text-muted">Nume nou</span>
        <input name="t" class="mt-1 w-full rounded-lg border border-line px-3 py-2" value="${esc(a.title)}" /></label>
      <p class="text-xs text-muted mt-2">Fișierul va deveni: <span class="fn font-mono text-ink"></span></p>
      <label class="flex items-start gap-2 mt-3 text-sm cursor-pointer">
        <input type="checkbox" name="f" class="mt-1 accent-moss" checked />
        <span>Redenumește și fișierul (bun pentru SEO)<br>
          <span class="text-xs text-blush-dark">Linkul public se schimbă. Dacă poza e deja folosită pe site sau în newsletter, acolo trebuie pus linkul nou.</span></span>
      </label>`,
    onOpen: b => {
      const inp = $('input[name=t]', b), fn = $('.fn', b), ext = a.master_path.split('.').pop();
      const upd = () => { fn.textContent = `${slugify(inp.value) || 'imagine'}.${ext}`; };
      inp.addEventListener('input', upd); upd();
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
    },
    collect: b => ({ title: $('input[name=t]', b).value.trim(), moveFile: $('input[name=f]', b).checked }),
  });
  if (!res || !res.title) return;

  const patch = { title: res.title };
  const moved = [];
  try {
    if (res.moveFile) {
      const slug = slugify(res.title) || 'imagine';
      const dir = a.master_path.slice(0, a.master_path.lastIndexOf('/'));
      const newMaster = `${dir}/${slug}.${a.master_path.split('.').pop()}`;
      if (newMaster !== a.master_path) {
        const { error } = await store().move(a.master_path, newMaster);
        if (error) throw error;
        moved.push([newMaster, a.master_path]);
        patch.master_path = newMaster;
      }
      if (a.original_path) {
        const newOrig = `${dir}/original-${slug}.${a.original_path.split('.').pop()}`;
        if (newOrig !== a.original_path) {
          const { error } = await store().move(a.original_path, newOrig);
          if (error) throw error;
          moved.push([newOrig, a.original_path]);
          patch.original_path = newOrig;
        }
      }
    }
    const { error } = await sb.from('assets').update(patch).eq('id', a.id);
    if (error) throw error;
  } catch (err) {
    console.error(err);
    for (const [to, from] of moved.reverse()) await store().move(to, from); // anulăm mutările
    return toast('Nu am putut redenumi imaginea.', 'err');
  }

  Object.assign(a, patch);
  const f = $('#detail-form').elements;
  f.title.value = a.title;
  $('#detail-filename').textContent = a.master_path.split('/').pop();
  if (patch.master_path) $('#detail-img').src = publicUrl(a.master_path);
  renderDownloads(a);
  render();
  toast(patch.master_path ? 'Redenumită ✓ — linkul public s-a schimbat' : 'Redenumită ✓');
}

function toggleDetailProduct() {
  const catId = Number($('#detail-form').elements.category_id.value) || null;
  $('#detail-product').hidden = !(state.productFields && isProduct(catId));
}

function renderDetailColors() {
  $('#detail-colors').innerHTML = colorSwatches(detailColors);
  const mode = $('#colors-mode');
  if (!detailColors.length) { mode.textContent = ''; mode.className = ''; return; }
  mode.textContent = detailColorsManual ? 'setate manual' : 'automat';
  mode.className = `ml-1 text-[11px] px-1.5 py-0.5 rounded-full ${detailColorsManual ? 'bg-ink text-white' : 'bg-moss-soft text-moss'}`;
}

/** Detectează culorile din versiunea master; cu save=true le salvează direct. */
async function autoColors(a, save = false) {
  const btn = $('#colors-detect');
  btn.textContent = 'Analizez…'; btn.disabled = true;
  try {
    if (!state.detailDecoded || state.detailDecoded.id !== a.id) {
      state.detailDecoded = { id: a.id, dec: await decodeUrl(publicUrl(a.kind === 'video' ? a.poster_path : a.master_path)) };
    }
    const colors = detectColors(state.detailDecoded.dec);
    if (state.detailId !== a.id) return;
    detailColors = colors; detailColorsManual = false;
    renderDetailColors();
    if (save) {
      const { error } = await sb.from('assets').update({ colors, colors_manual: false }).eq('id', a.id);
      if (!error) { a.colors = colors; a.colors_manual = false; render(); }
    } else {
      $('#detail-save').hidden = false;
    }
  } catch (err) { console.error(err); toast('Nu am putut analiza culorile', 'err'); }
  btn.textContent = '↻ Detectează automat'; btn.disabled = false;
}

$('#detail-colors').addEventListener('click', e => {
  const id = e.target.closest('[data-color]')?.dataset.color; if (!id) return;
  if (id === 'multicolor') detailColors = detailColors.includes('multicolor') ? [] : ['multicolor'];
  else {
    detailColors = detailColors.filter(c => c !== 'multicolor');
    detailColors = detailColors.includes(id) ? detailColors.filter(c => c !== id) : [...detailColors, id];
  }
  detailColorsManual = true;
  renderDetailColors();
  $('#detail-save').hidden = false;
});
$('#colors-detect').addEventListener('click', () => {
  const a = state.assets.find(x => x.id === state.detailId);
  if (a) autoColors(a, false);
});
$('#detail-form').elements.category_id.addEventListener('change', toggleDetailProduct);

function placeFocal(a) {
  const dot = $('#focal-dot');
  dot.style.left = `${a.focal_x * 100}%`;
  dot.style.top = `${a.focal_y * 100}%`;
  dot.hidden = false;
}

function renderDownloads(a) {
  const base = slugify(a.title) || 'imagine';
  const rows = [];
  if (a.original_path) rows.push(`<button data-dl="original" class="dl-row">
    <span>Original</span><span class="text-muted text-xs">${fmtBytes(a.original_bytes)}</span></button>`);
  if (a.kind === 'video') {
    rows.push(`<button data-dl="master" class="dl-row">
      <span>Video ${esc(a.master_path.split('.').pop().toUpperCase())}</span><span class="text-muted text-xs">${a.width}×${a.height} · ${fmtDuration(a.duration)} · ${fmtBytes(a.size_bytes)}</span></button>`);
    if (a.poster_path) rows.push(`<button data-dl="poster" class="dl-row">
      <span>Copertă (JPG)</span><span class="text-muted text-xs">cadru din video</span></button>`);
  } else rows.push(`<button data-dl="master" class="dl-row">
    <span>Rezoluție maximă</span><span class="text-muted text-xs">${a.width}×${a.height}</span></button>`);
  if (a.kind !== 'video' && a.mime !== 'image/svg+xml' && a.mime !== 'image/gif') {
    for (const f of EXPORT_FORMATS) rows.push(`<button data-dl="${f.id}" class="dl-row">
      <span>${esc(f.label)}</span><span class="text-muted text-xs">${esc(f.hint)}</span></button>`);
  }
  const list = $('#download-list');
  list.innerHTML = rows.join('');
  $$('.dl-row', list).forEach(b => {
    b.className = 'dl-row w-full flex justify-between items-center rounded-lg border border-line px-3 py-2 text-sm hover:bg-cream disabled:opacity-50';
  });
  list.dataset.base = base;
}

$('#download-list').addEventListener('click', async e => {
  const btn = e.target.closest('[data-dl]'); if (!btn) return;
  const a = state.assets.find(x => x.id === state.detailId);
  const base = $('#download-list').dataset.base;
  const kind = btn.dataset.dl;
  btn.disabled = true;
  const label = btn.firstElementChild.textContent;
  btn.firstElementChild.textContent = 'Se pregătește…';
  try {
    if (kind === 'original') await downloadUrl(publicUrl(a.original_path), a.original_path.split('/').pop());
    else if (kind === 'master') await downloadUrl(publicUrl(a.master_path), a.master_path.split('/').pop());
    else if (kind === 'poster') await downloadUrl(publicUrl(a.poster_path), `${base}-coperta.jpg`);
    else {
      const fmt = EXPORT_FORMATS.find(f => f.id === kind);
      if (!state.detailDecoded || state.detailDecoded.id !== a.id) {
        state.detailDecoded = { id: a.id, dec: await decodeUrl(publicUrl(a.original_path || a.master_path)) };
      }
      const transparent = a.mime === 'image/png';
      const blob = await exportFormat(state.detailDecoded.dec, fmt, a.focal_x, a.focal_y, transparent);
      const img = await createImageBitmap(blob);
      saveBlob(blob, `${base}-${fmt.id}-${img.width}x${img.height}.${transparent ? 'png' : 'jpg'}`);
      img.close?.();
    }
  } catch (err) { console.error(err); toast('Descărcare eșuată', 'err'); }
  btn.disabled = false;
  btn.firstElementChild.textContent = label;
});

$('#detail-img').addEventListener('click', async e => {
  const a = state.assets.find(x => x.id === state.detailId); if (!a) return;
  const r = e.currentTarget.getBoundingClientRect();
  const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  a.focal_x = +fx.toFixed(3); a.focal_y = +fy.toFixed(3);
  placeFocal(a);
  const { error } = await sb.from('assets').update({ focal_x: a.focal_x, focal_y: a.focal_y }).eq('id', a.id);
  toast(error ? 'Nu am putut salva punctul de focus' : 'Punct de focus salvat', error ? 'err' : 'ok');
});

$('#detail-form').addEventListener('input', () => { $('#detail-save').hidden = false; });
$('#detail-form').addEventListener('submit', async e => {
  e.preventDefault();
  const a = state.assets.find(x => x.id === state.detailId);
  const f = e.target.elements;
  const patch = {
    title: f.title.value.trim() || a.title,
    category_id: f.category_id.value ? Number(f.category_id.value) : null,
    alt_text: f.alt_text.value.trim() || null,
    description: f.description.value.trim() || null,
    credit: f.credit.value.trim() || null,
    tags: detailTags.get(),
  };
  const product = state.productFields && isProduct(patch.category_id);
  if (product) {
    patch.flowers = detailFlowers.get();
    patch.colors = detailColors;
    patch.colors_manual = detailColorsManual;
  }
  const { error } = await sb.from('assets').update(patch).eq('id', a.id);
  if (error) return toast('Nu am putut salva.', 'err');
  Object.assign(a, patch);
  if (product) rememberFlowers(patch.flowers);
  $('#detail-save').hidden = true;
  renderDownloads(a);
  toast('Salvat ✓');
  render();
  // a devenit produs și nu are culori → le detectăm
  if (product && !a.colors.length && !a.colors_manual) autoColors(a, true);
});

$$('[data-copy]').forEach(b => b.addEventListener('click', () => {
  const a = state.assets.find(x => x.id === state.detailId);
  const url = publicUrl(a.master_path);
  const alt = a.alt_text || a.title;
  const text = {
    url,
    html: a.kind === 'video'
      ? `<video src="${url}"${a.poster_path ? ` poster="${publicUrl(a.poster_path)}"` : ''} width="${a.width}" height="${a.height}" controls playsinline preload="metadata"></video>`
      : `<img src="${url}" alt="${esc(alt)}" width="${a.width}" height="${a.height}" loading="lazy" />`,
    md: `![${alt.replace(/[[\]]/g, '')}](${url})`,
  }[b.dataset.copy];
  copyText(text, b.dataset.copy === 'url' ? 'Link copiat' : `${b.textContent} copiat`);
}));

$('#detail-delete').addEventListener('click', async () => {
  const a = state.assets.find(x => x.id === state.detailId);
  const ok = await ask({
    title: 'Ștergi imaginea?', ok: 'Șterge definitiv', danger: true,
    body: `<p class="text-sm text-muted">„${esc(a.title)}” — linkul public nu va mai funcționa.</p>`,
  });
  if (!ok) return;
  if (await deleteAssets([a])) { detail.close(); toast('Imagine ștearsă'); render(); }
});

function stepDetail(d) {
  const idx = state.list.findIndex(x => x.id === state.detailId);
  const next = state.list[idx + d];
  if (next) openDetail(next.id);
}
$('#detail-prev').addEventListener('click', () => stepDetail(-1));
$('#detail-next').addEventListener('click', () => stepDetail(1));
detail.addEventListener('close', () => {
  $('#detail-video')?.pause();
  state.detailId = null; state.detailDecoded = null;
  history.replaceState(null, '', location.pathname + location.search);
});
detail.addEventListener('click', e => { if (e.target === detail) detail.close(); });

// ---------------------------------------------------------------- upload
const upDlg = $('#upload-dialog');
const upTags = tagInput($('#up-tags'));
let upFlowers = flowerInput($('#up-flowers'), []);
function toggleUpProduct() {
  const hint = $('#up-product p');
  if (hint) hint.textContent = 'Culorile se detectează automat imediat ce adaugi pozele. Le poți schimba din „Detalii ▾” la fiecare poză.';
  $('#up-product').hidden = !(state.productFields && isProduct(Number($('#up-category').value)));
}
$('#up-category').addEventListener('change', e => { e.target.dataset.touched = '1'; toggleUpProduct(); renderQueue(); });

const titleFromName = n => {
  const t = n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Imagine';
};
const looksImage = f => f.type.startsWith('image/') || isVideo(f) || /\.(heic|heif|jpe?g|png|webp|gif|svg|avif)$/i.test(f.name);

function addFiles(fileList) {
  const files = [...fileList].filter(looksImage);
  const skipped = fileList.length - files.length;
  const firstNew = state.queue.length;
  for (const file of files) {
    const tooBig = isVideo(file) ? file.size > 4 * 1024 ** 3 : file.size > MAX_FILE_BYTES;
    state.queue.push({
      key: crypto.randomUUID(), file, title: titleFromName(file.name),
      description: '', alt: '', flowers: [], tags: [],
      colors: null, colorsManual: false, analyzing: !tooBig,
      open: false,
      status: tooBig ? 'error' : 'pending',
      msg: tooBig ? (isVideo(file) ? 'Peste 4 GB' : `Peste ${Math.round(MAX_FILE_BYTES / 1048576)} MB`) : '',
      video: isVideo(file), duration: null,
      preview: isHeic(file) || isVideo(file) ? null : URL.createObjectURL(file),
    });
  }
  // o singură poză → panoul de detalii deschis direct
  if (state.queue.length === 1) state.queue[0].open = true;
  if (skipped) toast(`${skipped} fișiere ignorate (nu sunt imagini)`, 'err');
  renderQueue();
  analyzeQueue(state.queue.slice(firstNew));
}

/** Analizează pozele imediat ce sunt adăugate: culori + previzualizare pentru HEIC. */
async function analyzeQueue(items) {
  for (const it of items) {
    if (it.status !== 'pending') continue;
    try {
      if (it.video) {
        try {
          const fr = await videoFrame(it.file);
          it.duration = fr.duration;
          if (!it.colorsManual) it.colors = detectColors(fr);
          const pv = await makeThumb(fr, false);
          it.preview = URL.createObjectURL(pv.blob);
        } catch {
          it.msg = 'previzualizare indisponibilă în acest browser';
          try { it.duration = (await probeVideo(it.file)).duration; } catch {}
        }
        it.analyzing = false;
        if (state.queue.includes(it)) refreshQueueItem(it);
        continue;
      }
      const dec = await decode(it.file);
      if (!it.colorsManual) it.colors = detectColors(dec);
      if (dec.blob !== it.file) {                   // HEIC convertit → păstrăm JPG-ul, nu mai convertim la upload
        it.converted = dec.blob;
        it.preview = URL.createObjectURL(dec.blob);
      }
      dec.source.close?.();
    } catch (err) {
      console.error(err);
      it.status = 'error'; it.msg = err.message || 'nu am putut citi poza';
    }
    it.analyzing = false;
    if (state.queue.includes(it)) refreshQueueItem(it);
  }
}

const STATUS = {
  pending:   ['În așteptare', 'bg-line text-muted'],
  working:   ['Procesez…', 'bg-blush-soft text-blush-dark'],
  uploading: ['Încarc…', 'bg-blush-soft text-blush-dark'],
  done:      ['Gata ✓', 'bg-moss-soft text-moss'],
  duplicate: ['Există deja', 'bg-line text-ink'],
  error:     ['Eroare', 'bg-blush-soft text-blush-dark'],
};

const upIsProduct = () => state.productFields && isProduct(Number($('#up-category').value));

function queueItemHtml(it) {
  const [label, cls] = STATUS[it.status];
  const editable = it.status === 'pending' && !state.uploading;
  const product = upIsProduct();
  const dots = product && it.colors?.length
    ? `<span class="flex gap-0.5">${it.colors.map(id => colorById(id)).filter(Boolean)
        .map(c => `<span class="w-3 h-3 rounded-full border border-line" style="${swatchStyle(c)}" title="${c.label}"></span>`).join('')}</span>` : '';
  const field = 'mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/30';
  return `
  <li class="rounded-xl border ${it.open ? 'border-moss/40 bg-cream/40' : 'border-line'}" data-key="${it.key}">
    <div class="flex items-center gap-3 p-2 pr-3">
      <div class="w-14 h-14 rounded-lg bg-cream overflow-hidden shrink-0 grid place-items-center text-xs text-muted">
        ${it.preview ? `<img src="${it.preview}" class="w-full h-full object-cover" alt="" />` : (it.analyzing ? '<span class="spin inline-block">◌</span>' : it.video ? '▶' : 'HEIC')}
      </div>
      <div class="flex-1 min-w-0">
        <input class="q-title w-full text-sm font-medium bg-transparent outline-none border-b border-dashed border-line hover:border-muted focus:border-moss disabled:border-transparent disabled:opacity-80"
          value="${esc(it.title)}" placeholder="Titlu" ${editable ? '' : 'disabled'} />
        <p class="q-meta text-xs text-muted truncate mt-0.5">${it.video ? '🎬 ' : ''}${esc(it.file.name)} · ${fmtBytes(it.file.size)}${it.duration ? ' · ' + fmtDuration(it.duration) : ''}${it.msg ? ' · ' + esc(it.msg) : ''}</p>
      </div>
      ${it.analyzing && product ? '<span class="text-[11px] text-muted whitespace-nowrap">analizez culorile…</span>' : dots}
      ${editable ? `<button type="button" class="q-toggle text-xs px-2.5 py-1 rounded-full border border-line bg-paper hover:bg-cream whitespace-nowrap">${it.open ? 'Ascunde ▴' : 'Detalii ▾'}</button>` : ''}
      <span class="q-pill text-xs px-2 py-1 rounded-full whitespace-nowrap ${cls}">${it.status === 'working' || it.status === 'uploading' ? '<span class="inline-block spin">◌</span> ' : ''}${label}</span>
      ${editable || ['error', 'duplicate', 'done'].includes(it.status) ? `<button type="button" class="q-remove w-7 h-7 rounded-full hover:bg-cream text-muted" aria-label="Scoate">✕</button>` : ''}
    </div>
    ${it.open && editable ? `
    <div class="grid sm:grid-cols-2 gap-3 px-3 pb-3 text-sm">
      <label class="block sm:col-span-2"><span class="text-muted">Descriere / note</span>
        <textarea data-f="description" rows="2" class="${field}" placeholder="Ex: buchet pentru Ziua Mamei, ambalaj kraft">${esc(it.description)}</textarea></label>
      <label class="block sm:col-span-2"><span class="text-muted">Text alternativ (SEO)</span>
        <input data-f="alt" class="${field}" value="${esc(it.alt)}" placeholder="Implicit: titlul pozei" /></label>
      ${product ? `
      <div><span class="text-muted">Flori în această poză</span>
        <div class="q-flowers mt-1"></div>
        <p class="text-[11px] text-muted mt-1">Se adaugă la florile alese pentru tot lotul.</p></div>
      <div><div class="flex items-center justify-between"><span class="text-muted">Culori
          ${it.colors?.length ? `<span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full ${it.colorsManual ? 'bg-ink text-white' : 'bg-moss-soft text-moss'}">${it.colorsManual ? 'manual' : 'automat'}</span>` : ''}</span>
          ${it.colorsManual ? '<button type="button" class="q-redetect text-xs text-moss hover:underline">↻ automat</button>' : ''}</div>
        <div class="q-colors mt-1.5 flex flex-wrap gap-1.5">${it.analyzing ? '<span class="text-xs text-muted">Analizez…</span>' : colorSwatches(it.colors || [], { size: 'w-6 h-6' })}</div></div>` : ''}
      <div class="sm:col-span-2"><span class="text-muted">Tag-uri în plus pentru această poză</span>
        <div class="q-tags mt-1"></div></div>
    </div>` : ''}
  </li>`;
}

/** Leagă câmpurile cu chip-uri (flori, tag-uri) din panoul unei poze. */
function mountQueueItem(li, it) {
  const fl = $('.q-flowers', li), tg = $('.q-tags', li);
  if (fl) flowerInput(fl, it.flowers, v => { it.flowers = [...v]; });
  if (tg) tagInput(tg, it.tags, v => { it.tags = [...v]; });
}

function refreshQueueItem(it) {
  const li = $(`#queue li[data-key="${it.key}"]`);
  if (!li) return;
  const ae = document.activeElement;
  const focused = li.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName);
  if (focused && it.open) {                        // nu stricăm ce scrie utilizatorul; actualizăm doar culorile
    const box = $('.q-colors', li);
    if (box) box.innerHTML = colorSwatches(it.colors || [], { size: 'w-6 h-6' });
    return;
  }
  li.outerHTML = queueItemHtml(it);
  const fresh = $(`#queue li[data-key="${it.key}"]`);
  if (fresh) mountQueueItem(fresh, it);
}

function renderQueue() {
  const q = state.queue;
  $('#queue').innerHTML = q.map(queueItemHtml).join('');
  for (const it of q) {
    const li = $(`#queue li[data-key="${it.key}"]`);
    if (li) mountQueueItem(li, it);
  }
  const pending = q.filter(i => i.status === 'pending').length;
  const done = q.filter(i => i.status === 'done').length;
  $('#queue-summary').textContent = q.length ? `${q.length} fișiere · ${done} încărcate · ${pending} în așteptare` : '';
  $('#start-upload').disabled = !pending || state.uploading;
  $('#start-upload').textContent = state.uploading ? 'Se încarcă…' : pending ? `Încarcă ${pending}` : 'Încarcă';
}

function updateQueueItem(it) {
  const li = $(`#queue li[data-key="${it.key}"]`);
  if (!li) return renderQueue();
  const [label, cls] = STATUS[it.status];
  const pill = $('.q-pill', li);
  pill.className = `q-pill text-xs px-2 py-1 rounded-full whitespace-nowrap ${cls}`;
  pill.innerHTML = `${it.status === 'working' || it.status === 'uploading' ? '<span class="inline-block spin">◌</span> ' : ''}${label}`;
  if (it.msg) $('.q-meta', li).textContent = `${it.video ? '🎬 ' : ''}${it.file.name} · ${fmtBytes(it.file.size)} · ${it.msg}`;
}

const queueItemOf = el => state.queue.find(i => i.key === el.closest('li[data-key]')?.dataset.key);

$('#queue').addEventListener('input', e => {
  const it = queueItemOf(e.target); if (!it) return;
  if (e.target.classList.contains('q-title')) it.title = e.target.value;
  else if (e.target.dataset.f) it[e.target.dataset.f] = e.target.value;
});
$('#queue').addEventListener('click', e => {
  const it = queueItemOf(e.target); if (!it) return;
  if (e.target.closest('.q-remove')) {
    if (it.preview) URL.revokeObjectURL(it.preview);
    state.queue = state.queue.filter(i => i !== it);
    return renderQueue();
  }
  if (e.target.closest('.q-toggle')) { it.open = !it.open; return refreshQueueItem(it); }
  if (e.target.closest('.q-redetect')) {
    it.colorsManual = false; it.analyzing = true; refreshQueueItem(it);
    return analyzeQueue([it]);
  }
  const sw = e.target.closest('.q-colors [data-color]');
  if (sw) {
    const id = sw.dataset.color;
    let c = it.colors || [];
    if (id === 'multicolor') c = c.includes('multicolor') ? [] : ['multicolor'];
    else { c = c.filter(x => x !== 'multicolor'); c = c.includes(id) ? c.filter(x => x !== id) : [...c, id]; }
    it.colors = c; it.colorsManual = true;
    refreshQueueItem(it);
  }
});
$('#queue-clear').addEventListener('click', () => {
  if (state.uploading) return;
  state.queue.forEach(i => i.preview && URL.revokeObjectURL(i.preview));
  state.queue = []; renderQueue();
});
$('#file-input').accept = 'image/*,video/*,.heic,.heif,.mov,.mp4,.m4v';
{ const hint = $('#dropzone p.text-xs'); if (hint) hint.textContent = `Poze: JPG, PNG, WebP, HEIC, SVG, GIF · Video: MP4, MOV (iPhone) — comprimat automat la 1080p, max ${Math.round(MAX_FILE_BYTES / 1048576)} MB după compresie`; }
$('#file-input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

function openUpload() { if (!upDlg.open) upDlg.showModal(); toggleUpProduct(); upFlowers.refresh(); renderQueue(); }
$('#upload-btn').addEventListener('click', openUpload);
upDlg.addEventListener('cancel', e => { if (state.uploading) e.preventDefault(); });
upDlg.addEventListener('close', () => {
  state.queue = state.queue.filter(i => i.status === 'pending' || i.status === 'error');
});

$('#start-upload').addEventListener('click', async () => {
  const cat = Number($('#up-category').value);
  if (!cat) { $('#up-category').focus(); return toast('Alege o categorie pentru acest lot.', 'err'); }
  const batch = {
    category_id: cat, tags: upTags.get(),
    credit: $('#up-credit').value.trim() || null,
    keepOriginal: $('#up-original').checked,
    product: state.productFields && isProduct(cat),
  };
  batch.flowers = batch.product ? upFlowers.get() : [];
  if (batch.flowers.length) rememberFlowers(batch.flowers);
  state.uploading = true;
  renderQueue();
  const todo = state.queue.filter(i => i.status === 'pending');
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const it = todo[cursor++];
      try { await processItem(it, batch); }
      catch (err) {
        console.error(err);
        it.status = 'error'; it.msg = err.message || 'necunoscută';
        updateQueueItem(it);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  state.uploading = false;
  renderQueue();
  render();
  const ok = todo.filter(i => i.status === 'done').length;
  const dup = todo.filter(i => i.status === 'duplicate').length;
  const err = todo.filter(i => i.status === 'error').length;
  toast(`${ok} încărcate${dup ? ` · ${dup} duplicate` : ''}${err ? ` · ${err} erori` : ''}`, err ? 'err' : 'ok');
});

/** Amprentă rapidă pentru video (fișierele pot fi foarte mari): primii 4 MB + mărimea. */
async function videoFingerprint(file) {
  return `v${file.size}-` + await sha256(file.slice(0, 4 * 1024 * 1024));
}

/** Copertă JPG (max. 1920 px) dintr-un cadru video. */
const makePoster = frame => makeMaster(new File([], 'poster.jpg', { type: 'image/jpeg' }), frame, false);

/** Compresie + copertă + culori pentru un video din coada de upload. */
async function prepareVideoItem(it, batch) {
  const { file } = it;
  let out, processed = true;
  try {
    out = await prepareVideo(file, {
      maxBytes: MAX_FILE_BYTES,
      onProgress: (p, attempt) => { it.msg = `${attempt ? 'recomprim (calitate mai mică)' : 'comprim'} ${Math.round(p * 100)}%`; updateQueueItem(it); },
    });
  } catch (err) {
    // browserul nu poate citi formatul (ex. HEVC pe unele PC-uri) → îl încărcăm ca atare, coperta se face mai târziu
    if (file.size <= MAX_FILE_BYTES && /nesuportat|citi|undecodable|decod/i.test(err.message)) {
      out = { blob: file, width: 0, height: 0, duration: it.duration, raw: true };
      processed = false;
    } else throw err;
  }
  let frame = null;
  if (!out.raw) { try { frame = await videoFrame(out.blob); } catch { processed = false; } }
  const ext = out.raw ? ((file.name.split('.').pop() || 'mp4').toLowerCase()) : 'mp4';
  const master = {
    blob: out.blob, ext,
    mime: out.raw ? (file.type || (ext === 'mov' ? 'video/quicktime' : 'video/mp4')) : 'video/mp4',
    width: out.width || frame?.width || 0, height: out.height || frame?.height || 0,
  };
  let thumb = null, poster = null, color = null, colors = [];
  if (frame) {
    thumb = await makeThumb(frame, false);
    poster = await makePoster(frame);
    color = dominantColor(frame);
    colors = !batch.product ? [] : (it.colorsManual || it.colors) ? (it.colors || []) : detectColors(frame);
  }
  return { master, thumb, poster, color, colors, extra: { duration: out.duration ?? null, processed } };
}

async function processItem(it, batch) {
  const { file } = it;
  it.status = 'working'; updateQueueItem(it);

  const hash = it.video ? await videoFingerprint(file) : await sha256(file);
  const dupe = state.assets.find(a => a.sha256 === hash);
  if (dupe) { it.status = 'duplicate'; it.msg = `„${dupe.title}”`; return updateQueueItem(it); }

  let master, thumb, color, colors, poster = null, extra = {};
  if (it.video) {
    ({ master, thumb, poster, color, colors, extra } = await prepareVideoItem(it, batch));
  } else {
    const dec = await decode(it.converted ? new File([it.converted], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file);
    const mayAlpha = isSvg(file) || /png|webp|gif|avif/i.test(file.type || file.name);
    const alpha = mayAlpha ? hasAlpha(dec) : false;
    master = await makeMaster(file, dec, alpha);
    thumb = await makeThumb(dec, alpha);
    color = alpha ? null : dominantColor(dec);
    colors = !batch.product ? [] : (it.colorsManual || it.colors) ? (it.colors || []) : detectColors(dec);
    dec.source.close?.();
  }
  it.msg = '';

  it.status = 'uploading'; updateQueueItem(it);
  const id = crypto.randomUUID();
  const d = new Date();
  const dir = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${id}`;
  const slug = slugify(it.title) || 'imagine';
  const paths = {
    master: `${dir}/${slug}.${master.ext}`,
    thumb: thumb ? `${dir}/thumb.${thumb.ext}` : null,
    poster: poster ? `${dir}/poster.jpg` : null,
    original: batch.keepOriginal ? `${dir}/original-${slug}.${(file.name.split('.').pop() || 'bin').toLowerCase()}` : null,
  };
  const uploaded = [];
  const put = async (path, blob, type) => {
    const { error } = await store().upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
    if (error) throw new Error(error.message);
    uploaded.push(path);
  };
  try {
    if (it.video) { it.msg = 'încarc videoul…'; updateQueueItem(it); }
    await put(paths.master, master.blob, master.mime);
    if (thumb) await put(paths.thumb, thumb.blob, thumb.blob.type);
    if (poster) await put(paths.poster, poster.blob, 'image/jpeg');
    if (paths.original) await put(paths.original, file, file.type || 'application/octet-stream');

    const row = {
      id, title: it.title.trim() || titleFromName(file.name),
      category_id: batch.category_id, credit: batch.credit,
      tags: [...new Set([...batch.tags, ...it.tags])],
      description: it.description.trim() || null, alt_text: it.alt.trim() || null,
      master_path: paths.master, thumb_path: paths.thumb || paths.master, original_path: paths.original,
      mime: master.mime, width: master.width, height: master.height,
      size_bytes: master.blob.size, thumb_bytes: thumb ? thumb.blob.size : 0,
      ...(it.video ? { kind: 'video', poster_path: paths.poster, ...extra } : {}),
      original_name: file.name, original_bytes: paths.original ? file.size : null,
      sha256: hash, color, uploader_email: state.user.email,
      ...(state.productsReady && file.lastModified ? { taken_at: new Date(file.lastModified).toISOString() } : {}),
    };
    if (batch.product) {
      const flowers = [...batch.flowers];
      for (const f of it.flowers) if (!flowers.some(x => norm(x) === norm(f))) flowers.push(f);
      Object.assign(row, { flowers, colors, colors_manual: !!it.colorsManual });
      if (it.flowers.length) rememberFlowers(it.flowers);
    }
    const { data, error } = await sb.from('assets').insert(row).select().single();
    if (error) {
      if (error.code === '23505') { it.status = 'duplicate'; it.msg = 'încărcată deja de altcineva'; }
      throw new Error(error.message);
    }
    state.assets.unshift(data);
    it.status = 'done';
    it.msg = [it.video ? 'comprimat la ' + fmtBytes(master.blob.size) : '',
      colors.length ? 'culori: ' + colors.map(c => colorById(c)?.label).join(', ') : ''].filter(Boolean).join(' · ');
    updateQueueItem(it);
    if (data.processed === false) processPending();
  } catch (err) {
    if (uploaded.length) await store().remove(uploaded);
    if (it.status === 'duplicate') return updateQueueItem(it);
    throw err;
  }
}

// drag & drop pe toată pagina
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => {
  if (!hasFiles(e) || !state.user) return;
  dragDepth++;
  if (upDlg.open) $('#dropzone').classList.add('drop-active');
  else $('#page-drop').hidden = false;
});
window.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; $('#page-drop').hidden = true; $('#dropzone').classList.remove('drop-active'); }
});
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; $('#page-drop').hidden = true; $('#dropzone').classList.remove('drop-active');
  if (!state.user || state.uploading) return;
  openUpload();
  addFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------- dialogs & keyboard
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (detail.open && !typing) {
    if (e.key === 'ArrowRight') stepDetail(1);
    if (e.key === 'ArrowLeft') stepDetail(-1);
    return;
  }
  if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#search').focus(); }
  if (e.key === 'Escape' && state.selectMode && !document.querySelector('dialog[open]')) exitSelect();
});


// ---------------------------------------------------------------- De revizuit (poze de pe iPhone)
/** Mută fișierele unei poze la un nume nou bazat pe titlu; întoarce câmpurile de actualizat. */
async function moveFilesForTitle(a, title) {
  const slug = slugify(title) || 'imagine';
  const dir = a.master_path.slice(0, a.master_path.lastIndexOf('/'));
  const target = `${dir}/${slug}.${a.master_path.split('.').pop()}`;
  if (target === a.master_path) return {};
  const { error } = await store().move(a.master_path, target);
  if (error) throw error;
  return a.thumb_path === a.master_path ? { master_path: target, thumb_path: target } : { master_path: target };
}

/**
 * Poze venite de pe telefon: generează miniatura, culorile și (pentru HEIC / poze foarte mari)
 * versiunea master optimizată. Rulează în fundal, câte una.
 */
let processing = false;
async function processPending() {
  if (processing) return;
  processing = true;
  try {
    const skipKey = id => `tfs-skip-${id}`;
    const skipped = id => { try { return Date.now() - Number(localStorage.getItem(skipKey(id)) || 0) < 6 * 3600e3; } catch { return false; } };
    for (const a of state.assets.filter(x => x.processed === false && !skipped(x.id))) {
      try {
        if (a.kind === 'video') { await processPendingVideo(a); continue; }
        const dec = await decodeUrl(publicUrl(a.master_path));
        const patch = { processed: true };
        const dir = a.master_path.slice(0, a.master_path.lastIndexOf('/'));
        const heic = /heic|heif/.test(a.mime);
        const toRemove = [];
        if (heic || Math.max(dec.width, dec.height) > MASTER_MAX) {
          const master = await makeMaster(new File([], 'x.jpg', { type: 'image/jpeg' }), dec, false);
          const path = `${a.master_path.replace(/\.[^.]+$/, '')}.jpg`;
          const { error } = await store().upload(path, master.blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
          if (error) throw error;
          if (path !== a.master_path) toRemove.push(a.master_path);
          Object.assign(patch, { master_path: path, mime: 'image/jpeg', width: master.width, height: master.height, size_bytes: master.blob.size });
        } else {
          Object.assign(patch, { width: dec.width, height: dec.height });
        }
        const thumb = await makeThumb(dec, false);
        const thumbPath = `${dir}/thumb.${thumb.ext}`;
        const { error: te } = await store().upload(thumbPath, thumb.blob, { contentType: thumb.blob.type, cacheControl: '31536000', upsert: true });
        if (te) throw te;
        Object.assign(patch, { thumb_path: thumbPath, thumb_bytes: thumb.blob.size, color: dominantColor(dec) });
        if (state.productFields) Object.assign(patch, { colors: detectColors(dec), colors_manual: false });
        dec.source.close?.();
        const { error: ue } = await sb.from('assets').update(patch).eq('id', a.id);
        if (ue) throw ue;
        if (toRemove.length) await store().remove(toRemove);
        Object.assign(a, patch);
        const card = $(`.card[data-id="${a.id}"]`);
        if (card) card.outerHTML = cardHtml(a);
      } catch (err) {
        console.error('Procesare eșuată pentru', a.title, err);
        try { localStorage.setItem(skipKey(a.id), String(Date.now())); } catch {}
      }
    }
  } finally { processing = false; }
}

/** Video venit de pe telefon (sau pe care alt browser nu l-a putut citi): H.264 1080p + copertă. */
async function processPendingVideo(a) {
  const res = await fetch(publicUrl(a.master_path));
  if (!res.ok) throw new Error('Nu am putut descărca videoul');
  const src = new File([await res.blob()], a.master_path.split('/').pop(), { type: a.mime });
  const dir = a.master_path.slice(0, a.master_path.lastIndexOf('/'));
  const out = await prepareVideo(src, { maxBytes: MAX_FILE_BYTES });   // aruncă eroare dacă browserul nu-l poate citi → rămâne pentru alt dispozitiv
  const patch = { processed: true, duration: out.duration, width: out.width, height: out.height };
  const toRemove = [];
  if (out.transcoded || !/\.mp4$/.test(a.master_path)) {
    const path = a.master_path.replace(/\.[^.]+$/, '') + '.mp4';
    const { error } = await store().upload(path, out.blob, { contentType: 'video/mp4', cacheControl: '31536000', upsert: true });
    if (error) throw error;
    if (path !== a.master_path) toRemove.push(a.master_path);
    Object.assign(patch, { master_path: path, mime: 'video/mp4', size_bytes: out.blob.size });
  }
  const frame = await videoFrame(out.blob);
  const thumb = await makeThumb(frame, false);
  const poster = await makePoster(frame);
  const tp = `${dir}/thumb.${thumb.ext}`, pp = `${dir}/poster.jpg`;
  for (const [path, blob, type] of [[tp, thumb.blob, thumb.blob.type], [pp, poster.blob, 'image/jpeg']]) {
    const { error } = await store().upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: true });
    if (error) throw error;
  }
  Object.assign(patch, { thumb_path: tp, poster_path: pp, thumb_bytes: thumb.blob.size, color: dominantColor(frame) });
  if (state.productFields) Object.assign(patch, { colors: detectColors(frame), colors_manual: false });
  const { error: ue } = await sb.from('assets').update(patch).eq('id', a.id);
  if (ue) throw ue;
  if (toRemove.length) await store().remove(toRemove);
  Object.assign(a, patch);
  const card = $(`.card[data-id="${a.id}"]`);
  if (card) card.outerHTML = cardHtml(a);
}

/** Păstrează pozele în bibliotecă: alegi categoria (+ titlu, flori, tag-uri). */
async function approveAssets(items) {
  if (!items.length) return;
  const single = items.length === 1 ? items[0] : null;
  const opts = state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  let flowersBox, tagsBox;
  const res = await ask({
    title: single ? 'Păstrează în bibliotecă' : `Păstrează ${items.length} poze în bibliotecă`,
    ok: '✓ Păstrează',
    body: `
      <div class="space-y-3 text-sm">
        ${single ? `<label class="block"><span class="text-muted">Titlu</span>
          <input name="t" class="mt-1 w-full rounded-lg border border-line px-3 py-2" value="${esc(single.title.replace(/\s*\(.*\)$/, ''))}" /></label>` : ''}
        <label class="block"><span class="text-muted">Categorie *</span>
          <select name="c" class="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2">
            <option value="" disabled selected>Alege categoria…</option>${opts}</select></label>
        <div class="ap-flowers" hidden><span class="text-muted">Flori în imagine</span><div class="mt-1 fl"></div></div>
        <div><span class="text-muted">Tag-uri</span><div class="mt-1 tg"></div></div>
      </div>`,
    onOpen: b => {
      flowersBox = flowerInput($('.fl', b), []);
      tagsBox = tagInput($('.tg', b), []);
      const sel = $('select', b);
      const sync = () => { $('.ap-flowers', b).hidden = !(state.productFields && isProduct(Number(sel.value))); };
      sel.addEventListener('change', sync);
      setTimeout(() => (single ? $('input[name=t]', b) : sel).focus(), 50);
    },
    collect: b => ({
      title: single ? $('input[name=t]', b).value.trim() : null,
      cat: Number($('select', b).value) || null,
      flowers: flowersBox.get(), tags: tagsBox.get(),
    }),
  });
  if (!res) return;
  if (!res.cat) return toast('Alege o categorie ca să păstrezi poza.', 'err');

  const product = state.productFields && isProduct(res.cat);
  if (product && res.flowers.length) rememberFlowers(res.flowers);
  let ok = 0;
  for (const a of items) {
    try {
      const patch = { status: 'approved', category_id: res.cat, tags: [...new Set([...a.tags, ...res.tags])] };
      if (state.productFields) {
        patch.flowers = product ? [...new Set([...(a.flowers || []), ...res.flowers])] : [];
        if (!product) patch.colors = [];
      }
      if (single && res.title && res.title !== a.title) {
        patch.title = res.title;
        Object.assign(patch, await moveFilesForTitle(a, res.title));
      }
      const { error } = await sb.from('assets').update(patch).eq('id', a.id);
      if (error) throw error;
      Object.assign(a, patch);
      state.selected.delete(a.id);
      ok++;
    } catch (err) { console.error(err); }
  }
  toast(ok === items.length ? `✓ ${ok} ${ok === 1 ? 'poză păstrată' : 'poze păstrate'} în bibliotecă` : `${items.length - ok} nu au putut fi salvate`, ok === items.length ? 'ok' : 'err');
  if (detail.open && items.some(a => a.id === state.detailId)) detail.close();
  if (state.view === 'review' && !reviewAssets().length) { state.view = 'library'; state.selectMode = false; }
  render();
}

async function rejectAssets(items) {
  if (!items.length) return;
  const ok = await ask({
    title: items.length === 1 ? 'Ștergi poza?' : `Ștergi ${items.length} poze?`, ok: 'Șterge', danger: true,
    body: '<p class="text-sm text-muted">Pozele se șterg din bibliotecă. Pe telefon rămân neatinse.</p>',
  });
  if (!ok) return;
  if (await deleteAssets(items)) {
    toast(items.length === 1 ? 'Poză ștearsă' : `${items.length} poze șterse`);
    if (detail.open && items.some(a => a.id === state.detailId)) detail.close();
    if (state.view === 'review' && !reviewAssets().length) { state.view = 'library'; state.selectMode = false; }
    render();
  }
}

/** Banda din fereastra de detaliu pentru pozele în revizuire. */
function ensureReviewBar() {
  if (!$('#review-bar')) {
    $('#detail-form').insertAdjacentHTML('beforebegin', `
      <div id="review-bar" class="rounded-xl bg-blush-soft border border-blush/50 p-3 text-sm" hidden>
        <p class="font-medium text-blush-dark">📱 Poză de pe telefon — de revizuit</p>
        <p class="text-xs text-muted mt-0.5">Alege dacă intră în bibliotecă sau se șterge.</p>
        <div class="flex gap-2 mt-2.5">
          <button type="button" id="rv-keep" class="flex-1 rounded-full bg-moss hover:bg-moss-dark text-white text-sm py-2">✓ Păstrează</button>
          <button type="button" id="rv-drop" class="rounded-full border border-blush text-blush-dark text-sm px-4 py-2 hover:bg-white">✕ Șterge</button>
        </div>
      </div>`);
    $('#rv-keep').addEventListener('click', () => { const a = state.assets.find(x => x.id === state.detailId); if (a) approveAssets([a]); });
    $('#rv-drop').addEventListener('click', () => { const a = state.assets.find(x => x.id === state.detailId); if (a) rejectAssets([a]); });
  }
}


// ---------------------------------------------------------------- 🛍️ Produse Shopify (grupare + fișă + export CSV)
const VENDOR_DEFAULT = CFG.SHOPIFY_VENDOR ?? 'The Flower Station';

// Valorile din magazinul Shopify (se pot schimba din config.js fără să atingi codul)
const SHOPIFY_TYPES = CFG.SHOPIFY_TYPES ?? [
  'Buchet flori', 'Aranjamente florale', 'Buchet de mireasă', 'Cadouri', 'Coroane Funerare',
  'Decorare Cristelniță', 'Lumânare Botez', 'Lumânare Nuntă', 'Plante',
];
const SHOPIFY_COLLECTIONS = CFG.SHOPIFY_COLLECTIONS ?? [
  'Buchete flori', 'Aranjamente florale', 'Buchet Mireasă', 'Cadouri', 'Plante', 'Coroane Funerare', 'Coronițe',
  'Ziua Mamei', 'Ziua iubitei', "Valentine's Day", 'Aniversare', 'Primăvara mea', 'Back to school',
  'Evenimente', 'Lumânare Botez', 'Lumânare Nuntă', 'Decorare Cristelniță', 'Best selling', 'Abonamente', 'Home page',
];
// Textul standard adăugat automat după primul paragraf al descrierii
const SHOPIFY_DESC_FOOTER = CFG.SHOPIFY_DESC_FOOTER ?? [
  'Buchetele noastre sunt livrate proaspete și sunt protejate de un ambalaj elegant și de calitate, conceput să le păstreze prospețimea și frumusețea pe tot parcursul transportului.',
  'Ne dedicăm satisfacției clienților noștri, așadar nu ezita să ne contactezi la numărul afișat pentru a găsi varianta care să se potrivească cel mai bine nevoilor tale.',
  'Produs perisabil – nu se returnează.',
];
// Categoria Shopify (taxonomia standard) după tipul produsului
const SHOPIFY_CATEGORY = type => {
  if (/plant/i.test(type || '')) return { id: 'hg-17-3', label: 'Indoor & Outdoor Plants' };
  if (/lum[aâ]n/i.test(type || '')) return { id: 'hg-3-40-2', label: 'Candles' };
  return { id: 'ae-3-1-3', label: 'Fresh Cut Flowers' };
};
const SQUARE_MAX = 2048;   // pozele produselor se exportă pătrate, max. 2048 × 2048
const pvState = { step: null, idx: 0, problems: null, lastExport: null, traySel: new Set(), exportSel: new Set(), saveTimers: new Map() };

async function loadProducts() {
  const { data, error } = await sb.from('products').select('*').order('created_at', { ascending: false });
  state.productsReady = !error;
  state.products = error ? [] : data;
  if (error) console.warn('Tabelul products lipsește — rulează supabase/migrare-05-produse-shopify.sql', error);
}

const productImages = p => state.assets
  .filter(a => a.product_id === p.id && (a.kind || 'image') === 'image')
  .sort((a, b) => (a.product_position ?? 0) - (b.product_position ?? 0));

/** Poze de produs (categoria Produse, aprobate, imagini) care nu aparțin încă unui produs. */
const trayAssets = () => state.assets
  .filter(a => !inReview(a) && (a.kind || 'image') === 'image' && !a.product_id && isProduct(a.category_id))
  .sort((a, b) => (a.taken_at || a.created_at).localeCompare(b.taken_at || b.created_at));

const fmtPrice = v => (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(2);
const productAutoTags = p => {
  const imgs = productImages(p);
  const fl = [...new Set(imgs.flatMap(a => a.flowers || []))];
  const co = [...new Set(imgs.flatMap(a => a.colors || []))].map(c => colorById(c)?.label).filter(Boolean);
  return [...fl, ...co];
};
const productState = p => !p.exported_at ? 'new'
  : (new Date(p.updated_at) - new Date(p.exported_at) > 5000 ? 'changed' : 'exported');

async function uniqueHandle(base, exceptId) {
  let h = slugify(base) || 'produs', n = 1;
  const taken = new Set(state.products.filter(p => p.id !== exceptId).map(p => p.handle));
  while (taken.has(n === 1 ? h : `${h}-${n}`)) n++;
  return n === 1 ? h : `${h}-${n}`;
}

// ---------- creare / grupare
async function createProductFrom(assetIds) {
  if (!assetIds.length) return null;
  const { data, error } = await sb.from('products').insert({
    title: '', handle: await uniqueHandle('produs'), vendor: VENDOR_DEFAULT, status: 'draft',
  }).select().single();
  if (error) { toast('Nu am putut crea produsul.', 'err'); return null; }
  state.products.unshift(data);
  await assignToProduct(assetIds, data.id);
  return data;
}

async function assignToProduct(assetIds, productId) {
  const p = state.products.find(x => x.id === productId);
  let pos = p ? productImages(p).length : 0;
  for (const id of assetIds) {
    const a = state.assets.find(x => x.id === id);
    if (!a) continue;
    const patch = { product_id: productId, product_position: productId ? pos++ : null };
    const { error } = await sb.from('assets').update(patch).eq('id', id);
    if (!error) Object.assign(a, patch);
    pvState.traySel.delete(id);
  }
  if (p) touchProduct(p);
}

async function touchProduct(p) {
  const { data } = await sb.from('products').update({ title: p.title }).eq('id', p.id).select().single();
  if (data) Object.assign(p, data); else p.updated_at = new Date().toISOString();
}

async function reorderImages(p, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    const a = state.assets.find(x => x.id === orderedIds[i]);
    if (a && a.product_position !== i) {
      a.product_position = i;
      await sb.from('assets').update({ product_position: i }).eq('id', a.id);
    }
  }
  touchProduct(p);
}

/** Grupare automată: poze făcute la mai puțin de `gapMin` minute una de alta = același produs. */
async function autoGroup() {
  const items = trayAssets();
  if (!items.length) return toast('Nu sunt poze fără produs.');
  const gapMin = 5;
  const groups = [];
  for (const a of items) {
    const t = new Date(a.taken_at || a.created_at).getTime();
    const g = groups[groups.length - 1];
    if (g && t - g.last <= gapMin * 60e3) { g.ids.push(a.id); g.last = t; }
    else groups.push({ ids: [a.id], last: t });
  }
  const ok = await ask({
    title: `Grupez ${items.length} poze în ${groups.length} produse?`, ok: 'Grupează',
    body: `<p class="text-sm text-muted">Pozele făcute la mai puțin de ${gapMin} minute una de alta intră în același produs.
      După aceea poți muta pozele între produse prin tragere.</p>`,
  });
  if (!ok) return;
  for (const g of groups) await createProductFrom(g.ids);
  toast(`${groups.length} produse create`);
  renderProducts();
}

async function deleteProduct(p) {
  const ok = await ask({
    title: 'Ștergi produsul?', ok: 'Șterge', danger: true,
    body: '<p class="text-sm text-muted">Pozele rămân în bibliotecă și revin la „Poze fără produs”. Din Shopify nu se șterge nimic.</p>',
  });
  if (!ok) return;
  const { error } = await sb.from('products').delete().eq('id', p.id);
  if (error) return toast('Nu am putut șterge produsul.', 'err');
  state.assets.forEach(a => { if (a.product_id === p.id) { a.product_id = null; a.product_position = null; } });
  state.products = state.products.filter(x => x !== p);
  pvState.exportSel.delete(p.id);
  renderProducts();
}

// ---------- salvare automată a fișei
function queueSave(p, patch) {
  Object.assign(p, patch);
  clearTimeout(pvState.saveTimers.get(p.id));
  pvState.saveTimers.set(p.id, setTimeout(() => { pvState.saveTimers.delete(p.id); saveProduct(p); }, 600));
}

async function saveProduct(p) {
  {
    const fields = ['title', 'handle', 'description', 'vendor', 'product_type', 'collection', 'tags', 'price', 'compare_at_price',
      'status', 'has_variants', 'option_name', 'variants', 'seo_title', 'seo_description'];
    const row = Object.fromEntries(fields.map(k => [k, p[k]]));
    const { data, error } = await sb.from('products').update(row).eq('id', p.id).select().single();
    if (error) {
      toast(error.code === '23505' ? 'Există deja un produs cu acest URL handle.' : 'Nu am putut salva produsul.', 'err');
      return;
    }
    Object.assign(p, data);
    const badge = $(`#pv-list [data-pid="${p.id}"] .pv-state`);
    if (badge) badge.outerHTML = stateBadge(p);
  }
}

const stateBadge = p => {
  const s = productState(p);
  const map = {
    new: ['Neexportat', 'bg-line text-muted'],
    exported: [`Exportat ${fmtDate(p.exported_at)}`, 'bg-moss-soft text-moss'],
    changed: ['Modificat după export', 'bg-blush-soft text-blush-dark'],
  }[s];
  return `<span class="pv-state text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${map[1]}">${map[0]}</span>`;
};

function productCardHtml(p, mode = 'history') {
  const imgs = productImages(p);
  const field = 'mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/30';
  const auto = productAutoTags(p);
  const variants = Array.isArray(p.variants) ? p.variants : [];
  return `
  <article data-pid="${p.id}" class="pv-card rounded-2xl border border-line bg-paper p-4 shadow-card">
    <div class="flex items-start gap-3">
      ${mode === 'history' ? `<input type="checkbox" class="pv-pick mt-2.5 w-4 h-4 accent-moss" title="Include la export" ${pvState.exportSel.has(p.id) ? 'checked' : ''} />` : ''}
      <input data-k="title" value="${esc(p.title)}" placeholder="Numele produsului (ex. Buchet 25 trandafiri roz)"
        class="flex-1 min-w-0 font-serif text-xl bg-transparent border-b border-dashed border-line hover:border-muted focus:border-moss outline-none py-1" />
      <div class="flex items-center gap-2 shrink-0 pt-1.5">
        ${mode === 'history' ? stateBadge(p) : ''}
        <div class="inline-flex rounded-full border border-line overflow-hidden text-xs" role="group" aria-label="Stare în Shopify">
          <button type="button" data-status="draft" class="px-2.5 py-1 ${p.status === 'draft' ? 'bg-ink text-white' : 'bg-paper hover:bg-cream'}">Draft</button>
          <button type="button" data-status="active" class="px-2.5 py-1 ${p.status === 'active' ? 'bg-moss text-white' : 'bg-paper hover:bg-cream'}">Activ</button>
        </div>
        <button type="button" class="pv-del w-8 h-8 rounded-full hover:bg-cream text-muted" title="Șterge produsul">🗑</button>
      </div>
    </div>

    <div class="pv-strip mt-3 flex gap-2 overflow-x-auto scrollbar-thin rounded-xl border-2 border-dashed border-transparent p-1 -m-1 min-h-[96px]">
      ${imgs.map((a, i) => `
        <div draggable="true" data-aid="${a.id}" title="Click: alege decupajul pătrat · Trage: mută / reordonează" class="pv-img relative shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-cream cursor-pointer">
          ${squarePreview(a, publicUrl(a.thumb_path))}
          <span class="absolute top-1 left-1 text-[10px] px-1 rounded bg-white/85 text-ink">✂</span>
          ${i === 0 ? '<span class="absolute bottom-1 left-1 text-[10px] px-1.5 rounded bg-ink/80 text-white">principală</span>' : ''}
          <button type="button" class="pv-unlink absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 text-xs text-ink hover:bg-white" title="Scoate din produs">×</button>
        </div>`).join('')}
      <div class="shrink-0 w-24 h-24 rounded-lg border border-dashed border-line grid place-items-center text-[11px] text-muted text-center px-1">Trage poze aici</div>
    </div>
    ${imgs.length ? '<p class="text-[11px] text-muted mt-1.5">Se exportă pătrate, exact cum le vezi aici. Click pe o poză ca să muți floarea mai sus / mai jos sau să faci zoom.</p>' : ''}

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
      <label class="block ${p.has_variants ? 'opacity-40' : ''}"><span class="text-muted">Preț (lei)</span>
        <input data-k="price" type="number" step="0.01" min="0" inputmode="decimal" value="${fmtPrice(p.price)}" class="${field}" ${p.has_variants ? 'disabled' : ''} /></label>
      <label class="block ${p.has_variants ? 'opacity-40' : ''}"><span class="text-muted">Preț vechi</span>
        <input data-k="compare_at_price" type="number" step="0.01" min="0" inputmode="decimal" value="${fmtPrice(p.compare_at_price)}" placeholder="opțional" class="${field}" ${p.has_variants ? 'disabled' : ''} /></label>
      <label class="block"><span class="text-muted">Tip produs</span>
        ${optionSelect('product_type', p.product_type, SHOPIFY_TYPES, 'Alege tipul…', field)}
        <span class="block text-[11px] text-muted mt-1">Categorie Shopify: ${SHOPIFY_CATEGORY(p.product_type).label}</span></label>
      <label class="block"><span class="text-muted">Colecție</span>
        ${optionSelect('collection', p.collection, SHOPIFY_COLLECTIONS, '— fără colecție —', field)}
        <span class="block text-[11px] text-muted mt-1">Importul permite o singură colecție</span></label>
    </div>

    <label class="block mt-3 text-sm"><span class="text-muted">Descriere — primul paragraf</span>
      <textarea data-k="description" rows="3" class="${field}" placeholder="Ex: Oferă o surpriză florală deosebită alegând acest buchet cu trandafiri, protea, mattiola…">${esc(p.description || '')}</textarea></label>
    <details class="mt-1 text-[11px] text-muted">
      <summary class="cursor-pointer select-none">+ ${SHOPIFY_DESC_FOOTER.length} paragrafe standard adăugate automat la export</summary>
      <div class="mt-1 space-y-1 pl-3 border-l-2 border-line">${SHOPIFY_DESC_FOOTER.map(t => `<p>${esc(t)}</p>`).join('')}</div>
    </details>

    <div class="mt-3 text-sm">
      <label class="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" class="pv-hasvar accent-moss" ${p.has_variants ? 'checked' : ''} />
        <span>Are variante <span class="text-muted">(ex. mărimi cu prețuri diferite)</span></span></label>
      ${p.has_variants ? `
      <div class="mt-2 rounded-xl bg-cream/60 border border-line p-3 space-y-2">
        <label class="flex items-center gap-2"><span class="text-muted shrink-0">Nume opțiune</span>
          <input data-k="option_name" value="${esc(p.option_name || 'Mărime')}" class="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" /></label>
        <div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted px-0.5"><span>Valoare</span><span>Preț (lei)</span><span>Preț vechi</span><span class="w-7"></span></div>
        ${variants.map((v, i) => `
        <div class="pv-var grid grid-cols-[1fr_1fr_1fr_auto] gap-2" data-i="${i}">
          <input data-v="value" value="${esc(v.value || '')}" placeholder="ex. M / 25 fire" class="min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" />
          <input data-v="price" type="number" step="0.01" min="0" value="${fmtPrice(v.price)}" class="min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" />
          <input data-v="compare_at_price" type="number" step="0.01" min="0" value="${fmtPrice(v.compare_at_price)}" placeholder="opțional" class="min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" />
          <button type="button" class="pv-delvar w-7 h-7 rounded-full hover:bg-paper text-muted" title="Șterge varianta">×</button>
        </div>`).join('')}
        <button type="button" class="pv-addvar text-xs text-moss hover:underline">+ Adaugă variantă</button>
      </div>` : ''}
    </div>

    <div class="mt-3 text-sm"><span class="text-muted">Tag-uri</span>
      <div class="pv-tags mt-1"></div>
      ${auto.length ? `<p class="text-[11px] text-muted mt-1">Se adaugă automat din poze: ${auto.map(esc).join(', ')}</p>` : ''}</div>

    <details class="mt-3 text-sm group">
      <summary class="cursor-pointer text-muted hover:text-ink select-none">SEO și link produs</summary>
      <div class="grid gap-3 mt-2">
        <label class="block"><span class="text-muted">URL handle</span>
          <div class="flex items-center gap-1 mt-1"><span class="text-xs text-muted whitespace-nowrap">theflowerstation.ro/products/</span>
          <input data-k="handle" value="${esc(p.handle || '')}" class="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-xs" /></div></label>
        <label class="block"><span class="text-muted">Titlu SEO</span>
          <input data-k="seo_title" value="${esc(p.seo_title || '')}" placeholder="Implicit: numele produsului" maxlength="70" class="${field}" /></label>
        <label class="block"><span class="text-muted">Descriere SEO</span>
          <textarea data-k="seo_description" rows="2" maxlength="320" placeholder="Implicit: începutul descrierii" class="${field}">${esc(p.seo_description || '')}</textarea></label>
      </div>
    </details>
  </article>`;
}

/** <select> cu valorile din magazin; păstrează și o valoare veche care nu e în listă; „Altă valoare…” la final. */
function optionSelect(key, value, list, placeholder, cls) {
  const opts = [...list];
  if (value && !opts.includes(value)) opts.unshift(value);
  return `<select data-k="${key}" class="${cls}">
    <option value="">${esc(placeholder)}</option>
    ${opts.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    <option value="__other">+ Altă valoare…</option></select>`;
}

function mountProductCard(p) {
  const card = $(`#pv-list [data-pid="${p.id}"]`);
  if (!card) return;
  tagInput($('.pv-tags', card), p.tags || [], v => queueSave(p, { tags: [...v] }));
}

// datalist-uri pentru colecții / tipuri folosite deja
function refreshProductDatalists() {
  const uniq = k => [...new Set(state.products.map(p => p[k]).filter(Boolean))].sort();
  for (const [id, k, extra] of [['pv-collections', 'collection', ['Buchete', 'Aranjamente', 'Cutii cu flori', 'Plante', 'Nunți']],
                                ['pv-types', 'product_type', ['Buchet', 'Aranjament', 'Cutie cu flori', 'Plantă']]]) {
    let dl = $('#' + id);
    if (!dl) { document.body.insertAdjacentHTML('beforeend', `<datalist id="${id}"></datalist>`); dl = $('#' + id); }
    dl.innerHTML = [...new Set([...uniq(k), ...extra])].map(v => `<option value="${esc(v)}">`).join('');
  }
}

// ---------- evenimente
// ---------- export CSV
const SHOPIFY_COLUMNS = ['Title', 'URL handle', 'Description', 'Vendor', 'Product category', 'Type', 'Tags', 'Published on online store', 'Status',
  'Option1 name', 'Option1 value', 'Price', 'Compare-at price', 'Product image URL', 'Image position', 'Image alt text',
  'SEO title', 'SEO description', 'Collection'];

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const textToHtml = t => (t || '').trim().split(/\n{2,}/).filter(Boolean)
  .map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('');

function productProblems(p) {
  const out = [];
  if (!p.title?.trim()) out.push('lipsește numele');
  if (!productImages(p).length) out.push('nu are poze');
  if (p.has_variants) {
    const v = (p.variants || []).filter(x => x.value?.trim());
    if (!v.length) out.push('nu are variante completate');
    else if (v.some(x => x.price === null || x.price === undefined || x.price === '')) out.push('o variantă nu are preț');
  } else if (p.price === null || p.price === undefined || p.price === '') out.push('lipsește prețul');
  return out;
}

/** Rândurile CSV ale unui produs: rândul 1 are fișa completă, restul doar variante / poze. */
function productCsvRows(p, statusOverride, squareUrls = {}) {
  const status = statusOverride || p.status;
  const imgs = productImages(p);
  const tags = [...new Set([...(p.tags || []), ...(p.collection ? [p.collection] : []), ...productAutoTags(p)].map(t => String(t).trim()).filter(Boolean))];
  const variants = p.has_variants
    ? (p.variants || []).filter(v => v.value?.trim())
    : [{ value: 'Default Title', price: p.price, compare_at_price: p.compare_at_price }];
  const optionName = p.has_variants ? (p.option_name || 'Mărime') : 'Title';
  const plainDesc = (p.description || '').replace(/\s+/g, ' ').trim();
  const rows = [];
  const n = Math.max(variants.length, imgs.length);
  for (let i = 0; i < n; i++) {
    const v = variants[i], img = imgs[i];
    const r = Object.fromEntries(SHOPIFY_COLUMNS.map(c => [c, '']));
    r['URL handle'] = p.handle;
    if (i === 0) Object.assign(r, {
      'Title': p.title.trim(),
      'Description': textToHtml(p.description) + SHOPIFY_DESC_FOOTER.map(t => `<p>${esc(t)}</p>`).join(''),
      'Vendor': p.vendor || VENDOR_DEFAULT,
      'Product category': SHOPIFY_CATEGORY(p.product_type).id,
      'Type': p.product_type || '',
      'Tags': tags.join(', '),
      'Published on online store': status === 'active' ? 'TRUE' : 'FALSE',
      'Status': status,
      'Option1 name': optionName,
      'SEO title': p.seo_title || p.title.trim(),
      'SEO description': p.seo_description || plainDesc.slice(0, 300),
      'Collection': p.collection || '',
    });
    if (v) Object.assign(r, {
      'Option1 value': v.value.trim(),
      'Price': fmtPrice(v.price),
      'Compare-at price': fmtPrice(v.compare_at_price),
    });
    if (img) Object.assign(r, {
      'Product image URL': squareUrls[img.id] || publicUrl(img.master_path),
      'Image position': i + 1,
      'Image alt text': img.alt_text || p.title.trim(),
    });
    rows.push(r);
  }
  return rows;
}

/** Zona pătrată decupată dintr-o poză (în pixelii pozei): centrată pe punctul de focus, micșorată de zoom. */
function cropRect(a, W = a.width, H = a.height) {
  const zoom = Math.max(1, a.crop_zoom || 1);
  const side = Math.min(W, H) / zoom;
  const fx = a.focal_x ?? 0.5, fy = a.focal_y ?? 0.5;
  const x = Math.min(Math.max(fx * W - side / 2, 0), W - side);
  const y = Math.min(Math.max(fy * H - side / 2, 0), H - side);
  return { x, y, side, zoom };
}

/** Miniatură pătrată care arată exact decupajul exportat. */
function squarePreview(a, src) {
  const W = a.width || 1, H = a.height || 1, r = cropRect(a, W, H);
  return `<img src="${src}" alt="" draggable="false" class="absolute max-w-none pointer-events-none select-none"
    style="width:${(W / r.side) * 100}%;height:${(H / r.side) * 100}%;left:${(-r.x / r.side) * 100}%;top:${(-r.y / r.side) * 100}%" />`;
}

/** Editor de decupaj pătrat: tragi poza în cadru (sus/jos/stânga/dreapta) + zoom. */
async function openCropEditor(a, product) {
  const W = a.width, H = a.height;
  if (!W || !H) return toast('Poza încă se procesează, încearcă peste câteva secunde.', 'err');
  const st = { fx: a.focal_x ?? 0.5, fy: a.focal_y ?? 0.5, zoom: Math.max(1, a.crop_zoom || 1) };
  const portrait = H > W * 1.02, landscape = W > H * 1.02;
  let apply;
  const res = await ask({
    title: 'Decupaj pătrat pentru Shopify', ok: 'Salvează decupajul',
    body: `
      <p class="text-xs text-muted -mt-2 mb-3">Trage poza ${portrait ? 'în sus sau în jos' : landscape ? 'stânga sau dreapta' : 'în orice direcție (după zoom)'} ca floarea să stea unde vrei în pătrat.</p>
      <div class="crop-vp relative mx-auto aspect-square w-full max-w-[340px] overflow-hidden rounded-xl bg-cream touch-none cursor-grab select-none">
        <img src="${publicUrl(a.master_path)}" alt="" draggable="false" class="crop-img absolute max-w-none pointer-events-none select-none" />
        <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          ${'<div class="border border-white/40"></div>'.repeat(9)}</div>
        <div class="pointer-events-none absolute left-1/2 top-1/2 w-5 h-5 -translate-x-1/2 -translate-y-1/2">
          <div class="absolute left-1/2 top-0 bottom-0 w-px bg-white/90 -translate-x-1/2"></div>
          <div class="absolute top-1/2 left-0 right-0 h-px bg-white/90 -translate-y-1/2"></div></div>
      </div>
      <label class="flex items-center gap-3 mt-4 text-sm"><span class="text-muted shrink-0">Zoom</span>
        <input type="range" class="crop-zoom flex-1 accent-moss" min="1" max="3" step="0.01" value="${st.zoom}" />
        <span class="crop-zoom-val w-10 text-right text-xs tabular-nums text-muted"></span></label>
      <div class="flex justify-between mt-3 text-xs">
        <button type="button" class="crop-center text-moss hover:underline">⊕ Centrează</button>
        <button type="button" class="crop-open text-muted hover:text-ink">Detalii poză ↗</button>
      </div>`,
    onOpen: b => {
      const vp = $('.crop-vp', b), img = $('.crop-img', b), zoomIn = $('.crop-zoom', b);
      apply = () => {
        const r = cropRect({ width: W, height: H, focal_x: st.fx, focal_y: st.fy, crop_zoom: st.zoom });
        st.fx = (r.x + r.side / 2) / W; st.fy = (r.y + r.side / 2) / H;   // după limitare la margini
        Object.assign(img.style, {
          width: `${(W / r.side) * 100}%`, height: `${(H / r.side) * 100}%`,
          left: `${(-r.x / r.side) * 100}%`, top: `${(-r.y / r.side) * 100}%`,
        });
        $('.crop-zoom-val', b).textContent = `${st.zoom.toFixed(1)}×`;
      };
      apply();
      let drag = null;
      vp.addEventListener('pointerdown', e => {
        drag = { x: e.clientX, y: e.clientY, fx: st.fx, fy: st.fy };
        vp.setPointerCapture(e.pointerId); vp.classList.replace('cursor-grab', 'cursor-grabbing');
      });
      vp.addEventListener('pointermove', e => {
        if (!drag) return;
        const r = cropRect({ width: W, height: H, focal_x: drag.fx, focal_y: drag.fy, crop_zoom: st.zoom });
        const pxPerImg = vp.clientWidth / r.side;                      // pixeli ecran per pixel de poză
        st.fx = drag.fx - (e.clientX - drag.x) / pxPerImg / W;          // tragi poza în sus → decupajul coboară
        st.fy = drag.fy - (e.clientY - drag.y) / pxPerImg / H;
        apply();
      });
      const end = () => { drag = null; vp.classList.replace('cursor-grabbing', 'cursor-grab'); };
      vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
      zoomIn.addEventListener('input', () => { st.zoom = Number(zoomIn.value); apply(); });
      $('.crop-center', b).addEventListener('click', () => { st.fx = 0.5; st.fy = 0.5; st.zoom = 1; zoomIn.value = 1; apply(); });
      $('.crop-open', b).addEventListener('click', () => { $('#prompt-dialog').close(); openDetail(a.id); });
    },
    collect: () => ({ ...st }),
  });
  if (!res) return;
  const patch = { focal_x: +res.fx.toFixed(4), focal_y: +res.fy.toFixed(4), crop_zoom: +res.zoom.toFixed(3) };
  let { error } = await sb.from('assets').update(patch).eq('id', a.id);
  if (error && /crop_zoom/.test(error.message || '')) {
    delete patch.crop_zoom;
    ({ error } = await sb.from('assets').update(patch).eq('id', a.id));
    if (!error) toast('Zoom-ul nu s-a salvat: rulează migrarea 06 în Supabase.', 'err');
  }
  if (error) return toast('Nu am putut salva decupajul.', 'err');
  Object.assign(a, patch);
  if (product) touchProduct(product);
  renderProducts();
}

/**
 * Versiunea pătrată a unei poze pentru Shopify (decupată în jurul punctului de focus).
 * Calea conține punctul de focus, deci o poză deja pregătită nu se reface,
 * iar una cu decupaj schimbat primește un link nou (Shopify nu ia o versiune veche din cache).
 */
async function ensureSquare(a, handle, index) {
  const fx = a.focal_x ?? 0.5, fy = a.focal_y ?? 0.5, zoom = Math.max(1, a.crop_zoom || 1);
  const dir = `shopify/${a.id}/${Math.round(fx * 100)}-${Math.round(fy * 100)}${zoom > 1.001 ? '-z' + Math.round(zoom * 100) : ''}`;
  const name = `${handle}-${index + 1}.jpg`;
  const { data: existing } = await store().list(dir, { limit: 100 });
  if (existing?.some(f => f.name === name)) return publicUrl(`${dir}/${name}`);
  const dec = await decodeUrl(publicUrl(a.master_path));
  const r = cropRect(a, dec.width, dec.height);
  const size = Math.round(Math.min(SQUARE_MAX, r.side));
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(dec.source, r.x, r.y, r.side, r.side, 0, 0, size, size);
  const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Export eșuat')), 'image/jpeg', 0.9));
  dec.source.close?.();
  const { error } = await store().upload(`${dir}/${name}`, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
  if (error) throw error;
  return publicUrl(`${dir}/${name}`);
}

// ---------- asistent în 3 pași: ① Grupează → ② Completează → ③ Export
const batchProducts = () => state.products.filter(p => !p.exported_at)
  .sort((a, b) => a.created_at.localeCompare(b.created_at));
const historyProducts = () => state.products.filter(p => p.exported_at)
  .sort((a, b) => b.exported_at.localeCompare(a.exported_at));
const isComplete = p => !productProblems(p).length;
const productLabel = (p, i) => p.title?.trim() || `Produs ${i + 1}`;

/** Pasul potrivit când intri în secțiune. */
function pickStep() {
  const b = batchProducts();
  if (!b.length || trayAssets().length) return 'group';
  if (b.some(p => !isComplete(p))) return 'fill';
  return 'export';
}
function goStep(step, idx) {
  pvState.step = step;
  if (idx !== undefined) pvState.idx = idx;
  if (step === 'fill') {
    const b = batchProducts();
    if (idx === undefined) { const first = b.findIndex(p => !isComplete(p)); pvState.idx = first < 0 ? 0 : first; }
    pvState.idx = Math.max(0, Math.min(pvState.idx, b.length - 1));
  }
  pvState.problems = null;
  renderProducts();
  $('main')?.scrollIntoView({ block: 'start' });
  window.scrollTo({ top: 0 });
}

function ensureProductsView() {
  if ($('#pv')) return;
  $('#grid').insertAdjacentHTML('beforebegin', `
    <div id="pv" hidden>
      <nav id="pv-steps" class="flex flex-wrap items-center gap-2"></nav>
      <div id="pv-body" class="mt-5"></div>
    </div>`);
  bindProductsView();
}

function stepsHtml() {
  const b = batchProducts(), n = b.length, done = b.filter(isComplete).length;
  const steps = [
    ['group', '1', 'Grupează pozele', n ? `${n} ${n === 1 ? 'produs' : 'produse'}` : ''],
    ['fill', '2', 'Completează', n ? `${done}/${n} gata` : ''],
    ['export', '3', 'Descarcă CSV', ''],
  ];
  const order = ['group', 'fill', 'export', 'done'];
  const cur = order.indexOf(pvState.step === 'history' ? 'group' : pvState.step);
  return steps.map(([k, num, label, sub], i) => {
    const active = pvState.step === k || (k === 'export' && pvState.step === 'done');
    const past = i < cur && pvState.step !== 'history';
    const enabled = k === 'group' || n > 0;
    return `${i ? '<span class="w-6 h-px bg-line hidden sm:block"></span>' : ''}
      <button data-step="${k}" ${enabled ? '' : 'disabled'} class="flex items-center gap-2 rounded-full pl-1.5 pr-3.5 py-1.5 text-sm border transition
        ${active ? 'bg-ink text-white border-ink' : past ? 'bg-moss-soft text-moss border-moss-soft' : 'bg-paper border-line text-muted'} disabled:opacity-40">
        <span class="w-6 h-6 rounded-full grid place-items-center text-xs font-semibold ${active ? 'bg-white text-ink' : past ? 'bg-moss text-white' : 'bg-cream'}">${past ? '✓' : num}</span>
        <span class="font-medium">${label}</span>${sub ? `<span class="text-xs opacity-70">${sub}</span>` : ''}
      </button>`;
  }).join('') + `
    <button data-step="history" class="ml-auto text-sm ${pvState.step === 'history' ? 'text-ink font-medium' : 'text-muted hover:text-ink'}">
      🕘 Exportate (${historyProducts().length})</button>`;
}

function renderProducts() {
  ensureProductsView();
  if (!pvState.step) pvState.step = pickStep();
  $('#pv-steps').innerHTML = stepsHtml();
  const body = $('#pv-body');
  body.innerHTML = {
    group: groupStepHtml, fill: fillStepHtml, export: exportStepHtml, done: doneStepHtml, history: historyStepHtml,
  }[pvState.step]();
  // câmpurile cu chip-uri (tag-uri) din fișele afișate
  $$('#pv-body [data-pid] .pv-tags').forEach(el => {
    const p = state.products.find(x => x.id === el.closest('[data-pid]').dataset.pid);
    if (p) tagInput(el, p.tags || [], v => queueSave(p, { tags: [...v] }));
  });
  const nB = batchProducts().length;
  $('#result-count').textContent = `${nB} ${nB === 1 ? 'produs' : 'produse'} în lucru`;
  const side = $('#cat-list [data-products] span:last-child');
  if (side) side.textContent = nB;
}

// ----- ① Grupare
function groupStepHtml() {
  const tray = trayAssets(), b = batchProducts(), nSel = pvState.traySel.size;
  return `
  <div class="grid lg:grid-cols-2 gap-5 items-start">
    <section class="rounded-2xl border border-line bg-paper p-4 min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-serif text-lg">Poze de produs <span class="text-muted text-base">(${tray.length})</span></h3>
        <div class="ml-auto flex gap-2">
          <button data-act="upload" class="text-sm px-3 py-1.5 rounded-full border border-line hover:bg-cream">⬆ Încarcă poze</button>
          ${tray.length ? '<button data-act="auto" class="text-sm px-3 py-1.5 rounded-full border border-line hover:bg-cream">⚡ Grupează automat</button>' : ''}
        </div>
      </div>
      <p class="text-xs text-muted mt-1">Selectează pozele aceluiași buchet → <b>+ Produs din selecție</b>. Sau trage-le pe un produs din dreapta.</p>
      <div id="pv-tray" class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
        ${tray.length ? tray.map(a => `
          <button type="button" draggable="true" data-aid="${a.id}" title="${esc(a.title)}"
            class="pv-thumb relative aspect-square rounded-lg overflow-hidden bg-cream ${pvState.traySel.has(a.id) ? 'ring-[3px] ring-moss ring-offset-2' : 'hover:opacity-90'}">
            <img src="${publicUrl(a.thumb_path)}" alt="" loading="lazy" class="w-full h-full object-cover pointer-events-none" />
            ${pvState.traySel.has(a.id) ? '<span class="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-moss text-white text-xs grid place-items-center shadow">✓</span>' : ''}
          </button>`).join('') : `
          <div class="col-span-full text-center py-10 rounded-xl bg-cream/60">
            <div class="text-3xl mb-1">🌸</div>
            <p class="text-sm">${b.length ? 'Toate pozele sunt grupate.' : 'Nicio poză de produs nouă.'}</p>
            <p class="text-xs text-muted mt-1">Apasă <b>⬆ Încarcă poze</b> — se pun direct în categoria Produse.</p>
          </div>`}
      </div>
      ${tray.length ? `
      <div class="sticky bottom-3 mt-3 grid sm:grid-cols-2 gap-2 bg-paper/95 backdrop-blur rounded-xl">
        <button data-act="new" ${nSel ? '' : 'disabled'} class="rounded-full bg-ink text-white text-sm py-2.5 disabled:opacity-40">
          ${nSel ? `+ Produs din ${nSel} ${nSel === 1 ? 'poză' : 'poze'}` : '+ Produs din selecție'}</button>
        <select id="pv-addto" ${nSel && b.length ? '' : 'disabled'} class="rounded-full border border-line bg-paper text-sm px-3 py-2.5 disabled:opacity-40">
          <option value="">Adaugă la produs…</option>
          ${b.map((p, i) => `<option value="${p.id}">${esc(productLabel(p, i))}</option>`).join('')}
        </select>
      </div>` : ''}
    </section>

    <section class="min-w-0">
      <h3 class="font-serif text-lg mb-3">Produse noi <span class="text-muted text-base">(${b.length})</span></h3>
      <div class="space-y-3">
        ${b.length ? b.map((p, i) => {
          const imgs = productImages(p);
          return `
          <article data-pid="${p.id}" class="rounded-2xl border border-line bg-paper p-3">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-cream text-xs grid place-items-center font-semibold">${i + 1}</span>
              <span class="font-medium truncate">${esc(productLabel(p, i))}</span>
              <span class="text-xs text-muted">${imgs.length} ${imgs.length === 1 ? 'poză' : 'poze'}</span>
              <button type="button" class="pv-del ml-auto w-8 h-8 rounded-full hover:bg-cream text-muted" title="Desface produsul (pozele revin în stânga)">🗑</button>
            </div>
            <div class="pv-strip mt-2 flex gap-2 overflow-x-auto scrollbar-thin rounded-xl border-2 border-dashed border-transparent p-1 -m-1 min-h-[80px]">
              ${imgs.map((a, j) => `
                <div draggable="true" data-aid="${a.id}" title="Click: decupaj pătrat · Trage: mută / reordonează" class="pv-img relative shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-cream cursor-pointer">
                  ${squarePreview(a, publicUrl(a.thumb_path))}
                  ${j === 0 ? '<span class="absolute bottom-1 left-1 text-[10px] px-1.5 rounded bg-ink/80 text-white">principală</span>' : ''}
                  <button type="button" class="pv-unlink absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 text-xs text-ink hover:bg-white" title="Scoate din produs">×</button>
                </div>`).join('')}
              <div class="shrink-0 w-20 h-20 rounded-lg border border-dashed border-line grid place-items-center text-[10px] text-muted text-center px-1">Trage poze aici</div>
            </div>
          </article>`;
        }).join('') : `
          <div class="text-center py-12 rounded-2xl border border-dashed border-line text-sm text-muted">
            Produsele create din poze apar aici.</div>`}
      </div>
    </section>
  </div>
  ${b.length ? `
  <div class="sticky bottom-4 mt-6 flex justify-end">
    <button data-step="fill" class="rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-3 font-medium shadow-card">
      Continuă: completează ${b.length} ${b.length === 1 ? 'produs' : 'produse'} →</button>
  </div>` : ''}`;
}

// ----- ② Completare, câte un produs
function fillStepHtml() {
  const b = batchProducts();
  if (!b.length) return '<p class="text-muted">Nu ai produse de completat. Mergi la pasul 1.</p>';
  const i = pvState.idx, p = b[i], last = i === b.length - 1;
  const probs = pvState.problems;
  return `
  <div class="flex gap-2 overflow-x-auto scrollbar-thin pb-2">
    ${b.map((q, j) => {
      const ok = isComplete(q), cur = j === i, img = productImages(q)[0];
      return `<button data-go="${j}" title="${esc(productLabel(q, j))}" class="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2
        ${cur ? 'border-ink' : ok ? 'border-moss' : 'border-line'} bg-cream">
        ${img ? squarePreview(img, publicUrl(img.thumb_path)) : ''}
        <span class="absolute bottom-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold grid place-items-center
          ${ok ? 'bg-moss text-white' : 'bg-white text-ink'}">${ok ? '✓' : j + 1}</span>
      </button>`;
    }).join('')}
  </div>
  <div class="flex items-baseline justify-between mt-3 mb-3">
    <p class="font-serif text-xl">Produsul ${i + 1} <span class="text-muted">din ${b.length}</span></p>
    <p class="text-sm text-muted">${b.filter(isComplete).length} gata</p>
  </div>
  <div id="pv-list" class="max-w-3xl">${productCardHtml(p, 'fill')}</div>
  ${probs?.length ? `
  <div id="pv-problems" class="max-w-3xl mt-3 rounded-xl border border-blush bg-blush-soft text-blush-dark text-sm px-4 py-3">
    <b>Mai trebuie completat:</b> ${probs.join(', ')}.</div>` : ''}
  <div class="max-w-3xl sticky bottom-4 mt-4 flex items-center gap-2 bg-cream/90 backdrop-blur rounded-full p-1.5 shadow-card">
    <button data-act="prev" ${i ? '' : 'disabled'} class="rounded-full px-4 py-2.5 text-sm hover:bg-paper disabled:opacity-30">← Înapoi</button>
    <button data-act="skip" class="rounded-full px-4 py-2.5 text-sm text-muted hover:bg-paper">${last ? 'Sari la export' : 'Sari peste'}</button>
    <button data-act="validate" class="ml-auto rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-2.5 font-medium">
      ✓ Validează ${last ? 'și mergi la export' : 'și continuă'} →</button>
  </div>`;
}

// ----- ③ Export
function exportStepHtml() {
  const b = batchProducts(), ready = b.filter(isComplete), todo = b.filter(p => !isComplete(p));
  return `
  <div class="max-w-3xl">
    <div class="rounded-2xl border border-line bg-paper p-4">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="font-serif text-lg">${ready.length} ${ready.length === 1 ? 'produs gata' : 'produse gata'} de export</h3>
        <div class="ml-auto flex items-center gap-2 text-sm"><span class="text-muted">Toate ca:</span>
          <button data-all="draft" class="px-3 py-1 rounded-full border border-line hover:bg-cream">Draft</button>
          <button data-all="active" class="px-3 py-1 rounded-full border border-line hover:bg-cream">Activ</button></div>
      </div>
      <ul class="mt-3 divide-y divide-line">
        ${b.map((p, i) => {
          const img = productImages(p)[0], pr = productProblems(p);
          const price = p.has_variants ? `${(p.variants || []).filter(v => v.value?.trim()).length} variante` : (p.price != null ? `${fmtPrice(p.price)} lei` : '—');
          return `<li data-pid="${p.id}" class="flex items-center gap-3 py-2.5">
            <span class="relative w-12 h-12 rounded-lg overflow-hidden bg-cream shrink-0">${img ? squarePreview(img, publicUrl(img.thumb_path)) : ''}</span>
            <div class="min-w-0 flex-1">
              <p class="font-medium truncate">${esc(productLabel(p, i))}</p>
              <p class="text-xs ${pr.length ? 'text-blush-dark' : 'text-muted'} truncate">${pr.length ? '⚠ ' + pr.join(', ') : `${price} · ${esc(p.collection || 'fără colecție')} · ${productImages(p).length} poze`}</p>
            </div>
            ${pr.length ? `<button data-go="${i}" class="text-xs px-3 py-1.5 rounded-full bg-blush-soft text-blush-dark">Completează</button>` : `
            <div class="inline-flex rounded-full border border-line overflow-hidden text-xs shrink-0">
              <button type="button" data-status="draft" class="px-2.5 py-1 ${p.status === 'draft' ? 'bg-ink text-white' : 'bg-paper hover:bg-cream'}">Draft</button>
              <button type="button" data-status="active" class="px-2.5 py-1 ${p.status === 'active' ? 'bg-moss text-white' : 'bg-paper hover:bg-cream'}">Activ</button>
            </div>`}
          </li>`;
        }).join('')}
      </ul>
      ${todo.length ? `<p class="text-xs text-muted mt-2">${todo.length} ${todo.length === 1 ? 'produs incomplet nu va fi inclus' : 'produse incomplete nu vor fi incluse'} — rămân în lucru pentru data viitoare.</p>` : ''}
    </div>
    <div class="flex flex-wrap items-center gap-3 mt-5">
      <button data-step="fill" class="rounded-full px-4 py-2.5 text-sm hover:bg-paper">← Înapoi la completare</button>
      <button data-act="download" ${ready.length ? '' : 'disabled'} class="ml-auto rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-3 font-medium shadow-card disabled:opacity-40">
        ⬇ Descarcă CSV pentru Shopify (${ready.length})</button>
    </div>
  </div>`;
}

const importStepsHtml = `
  <ol class="text-sm space-y-2 list-decimal pl-5">
    <li>În Shopify: <b>Produse → Importă</b> → alegi fișierul descărcat → <b>Încarcă și continuă</b> → <b>Importă produsele</b>.</li>
    <li>Template <b>template-tfs</b>: bifezi produsele noi → <b>Editare în bloc</b> → coloana <b>Template</b> → alegi template-tfs la primul și tragi în jos → <b>Salvează</b>.</li>
    <li>Dacă reimporți produse deja existente, bifează <b>„Suprascrie produsele cu același URL handle”</b>.</li>
  </ol>`;

function doneStepHtml() {
  const le = pvState.lastExport;
  return `
  <div class="max-w-2xl mx-auto text-center py-6">
    <div class="w-16 h-16 rounded-full bg-moss text-white text-3xl grid place-items-center mx-auto">✓</div>
    <h3 class="font-serif text-2xl mt-4">${le ? `${le.count} ${le.count === 1 ? 'produs exportat' : 'produse exportate'}` : 'Export gata'}</h3>
    <p class="text-muted text-sm mt-1">Fișierul <b>${esc(le?.name || '')}</b> e în Descărcări.</p>
    <div class="text-left rounded-2xl border border-line bg-paper p-5 mt-6">${importStepsHtml}
      <p class="text-xs text-muted mt-3">Shopify descarcă singur pozele (poate dura câteva minute).</p></div>
    <div class="flex flex-wrap justify-center gap-3 mt-6">
      ${le ? '<button data-act="redownload" class="rounded-full border border-line px-5 py-3 text-sm hover:bg-paper">⬇ Descarcă din nou</button>' : ''}
      <button data-act="newbatch" class="rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-3 font-medium shadow-card">＋ Produse noi</button>
    </div>
  </div>`;
}

// ----- Istoric (exportate) — editare + re-export
function historyStepHtml() {
  const h = historyProducts(), nSel = [...pvState.exportSel].filter(id => h.some(p => p.id === id)).length;
  return `
  <div class="flex flex-wrap items-center gap-3 mb-4">
    <button data-act="newbatch" class="rounded-full px-4 py-2 text-sm border border-line hover:bg-paper">← Produse noi</button>
    <p class="text-sm text-muted">Produse deja exportate. Le poți modifica și exporta din nou (bifează-le).</p>
    <button data-act="reexport" ${nSel ? '' : 'disabled'} class="ml-auto rounded-full bg-moss text-white px-5 py-2.5 text-sm font-medium disabled:opacity-40">⬇ Exportă din nou (${nSel})</button>
  </div>
  <div id="pv-list" class="space-y-4 max-w-3xl">
    ${h.length ? h.map(p => productCardHtml(p, 'history')).join('') : '<p class="text-muted text-sm">Nimic exportat încă.</p>'}
  </div>`;
}

// ---------- evenimente (delegate pe #pv, ca să supraviețuiască re-randărilor)
async function flushSave(p) {
  const t = pvState.saveTimers.get(p.id);
  if (t) { clearTimeout(t); pvState.saveTimers.delete(p.id); await saveProduct(p); }
}

function bindProductsView() {
  const pv = $('#pv');
  const productOf = el => state.products.find(p => p.id === el.closest('[data-pid]')?.dataset.pid);
  const selectedTray = () => trayAssets().filter(a => pvState.traySel.has(a.id)).map(a => a.id);

  pv.addEventListener('click', async e => {
    const t = e.target;
    const step = t.closest('[data-step]')?.dataset.step;
    if (step && !t.closest('[data-step]').disabled) return goStep(step);
    const go = t.closest('[data-go]')?.dataset.go;
    if (go !== undefined) {
      const cur = batchProducts()[pvState.idx]; if (cur) await flushSave(cur);
      return goStep('fill', Number(go));
    }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'upload') {
      openUpload();
      const prod = state.categories.find(c => c.slug === 'produse');
      if (prod) { $('#up-category').value = String(prod.id); toggleUpProduct(); renderQueue(); }
      return;
    }
    if (act === 'auto') return autoGroup();
    if (act === 'new') {
      const p = await createProductFrom(selectedTray());
      if (p) { refreshProductDatalists(); renderProducts(); }
      return;
    }
    if (act === 'prev' || act === 'skip' || act === 'validate') {
      const b = batchProducts(), p = b[pvState.idx];
      if (p) await flushSave(p);
      if (act === 'prev') return goStep('fill', pvState.idx - 1);
      if (act === 'validate') {
        const pr = productProblems(p);
        if (pr.length) { pvState.problems = pr; renderProducts(); markProblemFields(p); return; }
      }
      if (pvState.idx >= b.length - 1) return goStep('export');
      return goStep('fill', pvState.idx + 1);
    }
    if (act === 'download') return downloadBatch(t.closest('[data-act]'));
    if (act === 'redownload' && pvState.lastExport) return saveBlob(pvState.lastExport.blob, pvState.lastExport.name);
    if (act === 'newbatch') { pvState.traySel.clear(); return goStep('group'); }
    if (act === 'reexport') {
      const items = historyProducts().filter(p => pvState.exportSel.has(p.id));
      const r = await doExport(items, t.closest('[data-act]'));
      if (r) { pvState.exportSel.clear(); pvState.lastExport = r; goStep('done'); }
      return;
    }
    const all = t.closest('[data-all]')?.dataset.all;
    if (all) { batchProducts().filter(isComplete).forEach(p => queueSave(p, { status: all })); return renderProducts(); }

    // tava de poze
    const trayBtn = t.closest('#pv-tray [data-aid]');
    if (trayBtn) {
      const id = trayBtn.dataset.aid;
      pvState.traySel.has(id) ? pvState.traySel.delete(id) : pvState.traySel.add(id);
      return renderProducts();
    }

    // acțiuni pe un produs
    const p = productOf(t); if (!p) return;
    const st = t.closest('[data-status]')?.dataset.status;
    if (st) { queueSave(p, { status: st }); return renderProducts(); }
    if (t.closest('.pv-del')) return deleteProduct(p);
    if (t.closest('.pv-addvar')) { queueSave(p, { variants: [...(p.variants || []), { value: '', price: null, compare_at_price: null }] }); return renderProducts(); }
    if (t.closest('.pv-delvar')) {
      const i = Number(t.closest('.pv-var').dataset.i);
      queueSave(p, { variants: (p.variants || []).filter((_, j) => j !== i) }); return renderProducts();
    }
    if (t.closest('.pv-unlink')) {
      const id = t.closest('[data-aid]').dataset.aid;
      await assignToProduct([id], null);
      await reorderImages(p, productImages(p).map(a => a.id));
      return renderProducts();
    }
    const img = t.closest('.pv-img');
    if (img) { const a = state.assets.find(x => x.id === img.dataset.aid); if (a) openCropEditor(a, p); }
  });

  pv.addEventListener('input', e => {
    const p = productOf(e.target); if (!p) return;
    if (pvState.problems) { pvState.problems = null; $('#pv-problems')?.remove(); }
    const k = e.target.dataset.k, vk = e.target.dataset.v;
    if (k && e.target.value === '__other') {
      e.target.value = p[k] || '';
      ask({
        title: k === 'collection' ? 'Altă colecție' : 'Alt tip de produs', ok: 'Folosește',
        body: `<input class="w-full rounded-lg border border-line px-3 py-2" placeholder="Exact ca în Shopify" />
          <p class="text-xs text-muted mt-2">Scrie numele exact ca în Shopify. ${k === 'collection' ? 'O colecție care nu există va fi creată la import.' : ''}</p>`,
        onOpen: b => setTimeout(() => $('input', b).focus(), 50),
        collect: b => $('input', b).value.trim(),
      }).then(v => { if (v) { queueSave(p, { [k]: v }); renderProducts(); } });
      return;
    }
    if (k) {
      let val = e.target.value;
      if (k === 'price' || k === 'compare_at_price') val = val === '' ? null : Number(val);
      if (k === 'handle') val = slugify(val) || null;
      queueSave(p, { [k]: val || (k === 'collection' || k === 'product_type' ? null : val) });
      if (k === 'product_type') { const hint = e.target.parentElement.querySelector('span.block'); if (hint) hint.textContent = 'Categorie Shopify: ' + SHOPIFY_CATEGORY(val).label; }
      e.target.classList.remove('ring-2', 'ring-blush-dark');
    } else if (vk) {
      const i = Number(e.target.closest('.pv-var').dataset.i);
      const variants = [...(p.variants || [])];
      variants[i] = { ...variants[i], [vk]: vk === 'value' ? e.target.value : (e.target.value === '' ? null : Number(e.target.value)) };
      queueSave(p, { variants });
    }
  });

  pv.addEventListener('change', async e => {
    if (e.target.id === 'pv-addto') {
      const pid = e.target.value; if (!pid) return;
      await assignToProduct(selectedTray(), pid);
      return renderProducts();
    }
    const p = productOf(e.target); if (!p) return;
    if (e.target.dataset.k === 'title' && (!p.handle || productState(p) === 'new')) {
      const handle = await uniqueHandle(p.title, p.id);
      queueSave(p, { handle });
      const h = $(`[data-pid="${p.id}"] [data-k="handle"]`); if (h) h.value = handle;
      if (pvState.step === 'fill') renderStepsOnly();
    }
    if (e.target.classList.contains('pv-pick')) {
      e.target.checked ? pvState.exportSel.add(p.id) : pvState.exportSel.delete(p.id);
      return renderProducts();
    }
    if (e.target.classList.contains('pv-hasvar')) {
      const on = e.target.checked;
      const variants = on && !(p.variants || []).length
        ? [{ value: 'S', price: p.price ?? null, compare_at_price: null }, { value: 'M', price: null, compare_at_price: null }, { value: 'L', price: null, compare_at_price: null }]
        : p.variants;
      queueSave(p, { has_variants: on, variants });
      renderProducts();
    }
  });

  // drag & drop: din tavă pe produs, între produse, reordonare în produs
  pv.addEventListener('dragstart', e => {
    const el = e.target.closest('[data-aid]'); if (!el) return;
    const id = el.dataset.aid;
    const ids = el.closest('#pv-tray') && pvState.traySel.has(id) ? [...pvState.traySel] : [id];
    e.dataTransfer.setData('text/x-tfs-assets', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  });
  pv.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/x-tfs-assets')) return;
    const strip = e.target.closest('.pv-strip'); if (!strip) return;
    e.preventDefault();
    $$('.pv-strip', pv).forEach(s => s.classList.toggle('border-moss', s === strip));
  });
  pv.addEventListener('dragleave', e => { if (!e.relatedTarget || !pv.contains(e.relatedTarget)) $$('.pv-strip', pv).forEach(s => s.classList.remove('border-moss')); });
  pv.addEventListener('drop', async e => {
    const strip = e.target.closest('.pv-strip'); if (!strip) return;
    e.preventDefault();
    $$('.pv-strip', pv).forEach(s => s.classList.remove('border-moss'));
    const ids = JSON.parse(e.dataTransfer.getData('text/x-tfs-assets') || '[]');
    const p = productOf(strip); if (!p || !ids.length) return;
    const beforeId = e.target.closest('.pv-img')?.dataset.aid;
    const moving = ids.filter(id => state.assets.find(a => a.id === id)?.product_id !== p.id);
    if (moving.length) {
      const olds = new Set(moving.map(id => state.assets.find(a => a.id === id)?.product_id).filter(Boolean));
      await assignToProduct(moving, p.id);
      for (const oid of olds) { const op = state.products.find(x => x.id === oid); if (op) await reorderImages(op, productImages(op).map(a => a.id)); }
    }
    let order = productImages(p).map(a => a.id).filter(id => !ids.includes(id));
    const at = beforeId && !ids.includes(beforeId) ? order.indexOf(beforeId) : order.length;
    order.splice(at < 0 ? order.length : at, 0, ...ids);
    await reorderImages(p, order);
    renderProducts();
  });
}

/** Actualizează doar bara de pași + miniaturile (fără să pierzi focusul din fișă). */
function renderStepsOnly() { $('#pv-steps').innerHTML = stepsHtml(); }

/** Evidențiază câmpurile care lipsesc la validare. */
function markProblemFields(p) {
  const card = $(`#pv-body [data-pid="${p.id}"]`); if (!card) return;
  const mark = sel => { const el = $(sel, card); if (el) el.classList.add('ring-2', 'ring-blush-dark'); return el; };
  const first = [
    !p.title?.trim() && mark('[data-k="title"]'),
    !p.has_variants && (p.price === null || p.price === undefined || p.price === '') && mark('[data-k="price"]'),
    ...(p.has_variants ? $$('.pv-var', card).map(row => {
      const v = (p.variants || [])[Number(row.dataset.i)];
      return v?.value?.trim() && (v.price === null || v.price === undefined || v.price === '') && mark(`.pv-var[data-i="${row.dataset.i}"] [data-v="price"]`);
    }) : []),
  ].find(Boolean);
  (first || card).scrollIntoView({ behavior: 'smooth', block: 'center' });
  first?.focus?.();
}

// ---------- export
async function downloadBatch(btn) {
  const ready = batchProducts().filter(isComplete);
  const r = await doExport(ready, btn);
  if (!r) return;
  pvState.lastExport = r;
  goStep('done');
}

/** Pregătește pozele pătrate, generează CSV-ul, îl descarcă și marchează produsele ca exportate. */
async function doExport(items, btn) {
  if (!items.length) { toast('Nu e niciun produs complet de exportat.', 'err'); return null; }
  for (const p of items) await flushSave(p);
  const label = btn?.textContent;
  const squareUrls = {};
  const allImgs = items.flatMap(p => productImages(p).map((a, i) => [p, a, i]));
  try {
    if (btn) btn.disabled = true;
    for (let k = 0; k < allImgs.length; k++) {
      const [p, a, i] = allImgs[k];
      if (btn) btn.textContent = `Pregătesc pozele pătrate ${k + 1}/${allImgs.length}…`;
      squareUrls[a.id] = await ensureSquare(a, p.handle, i);
    }
  } catch (err) {
    console.error(err);
    if (btn) { btn.textContent = label; btn.disabled = false; }
    toast('Nu am putut pregăti pozele pătrate: ' + (err.message || err), 'err');
    return null;
  }
  const rows = items.flatMap(p => productCsvRows(p, null, squareUrls));
  const csv = [SHOPIFY_COLUMNS.map(csvCell).join(','), ...rows.map(r => SHOPIFY_COLUMNS.map(c => csvCell(r[c])).join(','))].join('\r\n');
  const name = `shopify-produse-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, name);
  const now = new Date().toISOString();
  for (const p of items) {
    const { data } = await sb.from('products').update({ exported_at: now }).eq('id', p.id).select().single();
    Object.assign(p, data || { exported_at: now });
  }
  return { blob, name, count: items.length };
}

initAuth();
