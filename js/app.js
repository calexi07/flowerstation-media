// =============================================================
//  The Flower Station · Media Library
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET, STORAGE_QUOTA_BYTES, EXPORT_FORMATS,
} from './config.js';
import {
  sha256, decode, decodeUrl, hasAlpha, dominantColor, makeMaster, makeThumb, exportFormat,
  isHeic, isSvg, detectColors, COLOR_PALETTE,
} from './images.js';

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
  filter: { q: '', cat: null, orient: null, tags: new Set(), flowers: new Set(), colors: new Set(), sort: 'new' },
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
    await Promise.all([loadCategories(), loadAssets(), loadFlowers()]);
    renderFlowerDatalist();
    upFlowers?.refresh();
  } catch (err) {
    console.error(err);
    toast('Nu am putut încărca datele. Verifică configurarea Supabase.', 'err');
  }
  $('#loading').hidden = true;
  render();
}

const catName = id => state.categories.find(c => c.id === id)?.name ?? '—';

// ---------------------------------------------------------------- filter + render
function applyFilter() {
  const f = state.filter;
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  let list = state.assets.filter(a => {
    if (f.cat && a.category_id !== f.cat) return false;
    if (f.orient && orientationOf(a) !== f.orient) return false;
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
    new: (a, b) => b.created_at.localeCompare(a.created_at),
    old: (a, b) => a.created_at.localeCompare(b.created_at),
    az:  (a, b) => a.title.localeCompare(b.title, 'ro'),
    big: (a, b) => b.width * b.height - a.width * a.height,
  }[f.sort];
  state.list = list.sort(by);
}

function render() {
  applyFilter();
  renderSidebar();
  renderToolbar();
  state.shown = 0;
  $('#grid').innerHTML = '';
  appendCards();
  const none = state.list.length === 0;
  $('#empty').hidden = !none || !$('#loading').hidden;
  if (none) {
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
      <img src="${publicUrl(a.thumb_path)}" alt="${esc(a.alt_text || a.title)}" loading="lazy" decoding="async" class="w-full h-full object-cover" />
    </button>
    <div class="overlay pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-ink/10"></div>
    <button class="sel overlay absolute top-2 left-2 w-7 h-7 rounded-full grid place-items-center text-xs border-2 ${sel ? 'bg-moss border-moss text-white' : 'bg-white/80 border-white text-transparent hover:text-moss'}" aria-label="Selectează">✓</button>
    <button class="cp overlay absolute top-2 right-2 h-7 px-2.5 rounded-full bg-white/90 text-ink text-xs font-medium hover:bg-white" title="Copiază link public">Link</button>
    <div class="overlay pointer-events-none absolute bottom-0 inset-x-0 p-3 text-white">
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
  const counts = new Map();
  for (const a of state.assets) counts.set(a.category_id, (counts.get(a.category_id) || 0) + 1);
  const item = (id, name, n) => `
    <button data-cat="${id ?? ''}" class="w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm ${
      state.filter.cat === id ? 'bg-moss text-white' : 'hover:bg-line/50'}">
      <span class="truncate">${esc(name)}</span><span class="text-xs ${state.filter.cat === id ? 'text-white/80' : 'text-muted'}">${n}</span></button>`;
  $('#cat-list').innerHTML = item(null, 'Toate', state.assets.length) +
    state.categories.map(c => item(c.id, c.name, counts.get(c.id) || 0)).join('');

  const orients = [[null, 'Toate'], ['landscape', 'Peisaj'], ['portrait', 'Portret'], ['square', 'Pătrat']];
  $('#orient-list').innerHTML = orients.map(([v, l]) => `
    <button data-orient="${v ?? ''}" class="text-xs px-2.5 py-1 rounded-full border ${
      state.filter.orient === v ? 'bg-ink text-white border-ink' : 'border-line bg-paper hover:bg-cream'}">${l}</button>`).join('');

  const freq = new Map();
  for (const a of state.assets) for (const t of a.tags) freq.set(t, (freq.get(t) || 0) + 1);
  const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 40);
  $('#tag-cloud').innerHTML = top.length ? top.map(([t, n]) => `
    <button data-tag="${esc(t)}" class="text-xs px-2.5 py-1 rounded-full ${
      state.filter.tags.has(t) ? 'bg-moss text-white' : 'bg-moss-soft text-moss hover:bg-moss/20'}">${esc(t)} <span class="opacity-60">${n}</span></button>`).join('')
    : '<p class="text-xs text-muted">Tag-urile apar aici după primele încărcări.</p>';
  $('#tag-suggestions').innerHTML = [...freq.keys()].sort().map(t => `<option value="${esc(t)}">`).join('');

  // culori & flori (din pozele care le au)
  const colorCounts = new Map(), flowerCounts = new Map();
  for (const a of state.assets) {
    for (const c of a.colors || []) colorCounts.set(c, (colorCounts.get(c) || 0) + 1);
    for (const fl of a.flowers || []) flowerCounts.set(fl, (flowerCounts.get(fl) || 0) + 1);
  }
  $('#color-filter-wrap').hidden = !colorCounts.size;
  $('#color-filter').innerHTML = colorSwatches([...state.filter.colors], { size: 'w-6 h-6', counts: colorCounts });
  $('#flower-filter-wrap').hidden = !flowerCounts.size;
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
  $('#view-title').textContent = f.cat ? catName(f.cat) : 'Toate imaginile';
  $('#result-count').textContent = `${state.list.length} ${state.list.length === 1 ? 'imagine' : 'imagini'}`;
  const chips = [];
  if (f.q) chips.push(['q', `„${f.q}”`]);
  if (f.orient) chips.push(['orient', { landscape: 'Peisaj', portrait: 'Portret', square: 'Pătrat' }[f.orient]]);
  for (const t of f.tags) chips.push(['tag:' + t, '#' + t]);
  for (const fl of f.flowers) chips.push(['flower:' + fl, '🌸 ' + fl]);
  for (const c of f.colors) chips.push(['color:' + c, '● ' + (colorById(c)?.label || c)]);
  $('#active-filters').innerHTML = chips.map(([k, l]) => `
    <button data-clear="${esc(k)}" class="text-xs px-2.5 py-1 rounded-full bg-blush-soft text-blush-dark hover:bg-blush/40">${esc(l)} ×</button>`).join('');
}

// sidebar & toolbar events
$('#cat-list').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  state.filter.cat = b.dataset.cat ? Number(b.dataset.cat) : null;
  closeSidebar(); render();
});
$('#orient-list').addEventListener('click', e => {
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
  searchT = setTimeout(() => { state.filter.q = e.target.value.trim(); render(); }, 150);
});
$('#sort').addEventListener('change', e => { state.filter.sort = e.target.value; render(); });
$('#home-link').addEventListener('click', e => {
  e.preventDefault();
  Object.assign(state.filter, { q: '', cat: null, orient: null, tags: new Set(), flowers: new Set(), colors: new Set() });
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
  $$('#bulk-bar [data-bulk]').forEach(b => {
    if (!['all', 'cancel'].includes(b.dataset.bulk)) b.disabled = !n, b.style.opacity = n ? '' : '.4';
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
  const paths = items.flatMap(a => [a.master_path, a.thumb_path, a.original_path]).filter(Boolean);
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
  img.src = publicUrl(a.master_path);
  img.alt = a.alt_text || a.title;
  img.classList.toggle('checker', /png|svg|gif/.test(a.mime));
  $('#focal-dot').hidden = true;
  img.onload = () => placeFocal(a);

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
  if (state.productFields && isProduct(a.category_id) && !detailColors.length && !a.colors_manual) autoColors(a, true);

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
      state.detailDecoded = { id: a.id, dec: await decodeUrl(publicUrl(a.master_path)) };
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
  rows.push(`<button data-dl="master" class="dl-row">
    <span>Rezoluție maximă</span><span class="text-muted text-xs">${a.width}×${a.height}</span></button>`);
  if (a.mime !== 'image/svg+xml' && a.mime !== 'image/gif') {
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
    html: `<img src="${url}" alt="${esc(alt)}" width="${a.width}" height="${a.height}" loading="lazy" />`,
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
  state.detailId = null; state.detailDecoded = null;
  history.replaceState(null, '', location.pathname + location.search);
});
detail.addEventListener('click', e => { if (e.target === detail) detail.close(); });

// ---------------------------------------------------------------- upload
const upDlg = $('#upload-dialog');
const upTags = tagInput($('#up-tags'));
let upFlowers = flowerInput($('#up-flowers'), []);
function toggleUpProduct() {
  $('#up-product').hidden = !(state.productFields && isProduct(Number($('#up-category').value)));
}
$('#up-category').addEventListener('change', e => { e.target.dataset.touched = '1'; toggleUpProduct(); });

const titleFromName = n => {
  const t = n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Imagine';
};
const looksImage = f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|svg|avif)$/i.test(f.name);

function addFiles(fileList) {
  const files = [...fileList].filter(looksImage);
  const skipped = fileList.length - files.length;
  for (const file of files) {
    state.queue.push({
      key: crypto.randomUUID(), file, title: titleFromName(file.name),
      status: file.size > 50 * 1024 * 1024 ? 'error' : 'pending',
      msg: file.size > 50 * 1024 * 1024 ? 'Peste 50 MB' : '',
      preview: isHeic(file) ? null : URL.createObjectURL(file),
    });
  }
  if (skipped) toast(`${skipped} fișiere ignorate (nu sunt imagini)`, 'err');
  renderQueue();
}

const STATUS = {
  pending:   ['În așteptare', 'bg-line text-muted'],
  working:   ['Procesez…', 'bg-blush-soft text-blush-dark'],
  uploading: ['Încarc…', 'bg-blush-soft text-blush-dark'],
  done:      ['Gata ✓', 'bg-moss-soft text-moss'],
  duplicate: ['Există deja', 'bg-line text-ink'],
  error:     ['Eroare', 'bg-blush-soft text-blush-dark'],
};

function renderQueue() {
  const q = state.queue;
  $('#queue').innerHTML = q.map(it => {
    const [label, cls] = STATUS[it.status];
    const editable = it.status === 'pending' && !state.uploading;
    return `
    <li class="flex items-center gap-3 rounded-xl border border-line p-2 pr-3" data-key="${it.key}">
      <div class="w-14 h-14 rounded-lg bg-cream overflow-hidden shrink-0 grid place-items-center text-xs text-muted">
        ${it.preview ? `<img src="${it.preview}" class="w-full h-full object-cover" alt="" />` : 'HEIC'}
      </div>
      <div class="flex-1 min-w-0">
        <input class="q-title w-full text-sm font-medium bg-transparent outline-none border-b border-transparent focus:border-moss disabled:opacity-80"
          value="${esc(it.title)}" ${editable ? '' : 'disabled'} />
        <p class="text-xs text-muted truncate">${esc(it.file.name)} · ${fmtBytes(it.file.size)}${it.msg ? ' · ' + esc(it.msg) : ''}</p>
      </div>
      <span class="text-xs px-2 py-1 rounded-full whitespace-nowrap ${cls}">${it.status === 'working' || it.status === 'uploading' ? '<span class="inline-block spin">◌</span> ' : ''}${label}</span>
      ${editable || ['error', 'duplicate', 'done'].includes(it.status) ? `<button class="q-remove w-7 h-7 rounded-full hover:bg-cream text-muted" aria-label="Scoate">✕</button>` : ''}
    </li>`;
  }).join('');
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
  const pill = li.querySelector('span.rounded-full');
  pill.className = `text-xs px-2 py-1 rounded-full whitespace-nowrap ${cls}`;
  pill.innerHTML = `${it.status === 'working' || it.status === 'uploading' ? '<span class="inline-block spin">◌</span> ' : ''}${label}`;
  if (it.msg) li.querySelector('p').textContent = `${it.file.name} · ${fmtBytes(it.file.size)} · ${it.msg}`;
}

$('#queue').addEventListener('input', e => {
  if (!e.target.classList.contains('q-title')) return;
  const it = state.queue.find(i => i.key === e.target.closest('li').dataset.key);
  if (it) it.title = e.target.value;
});
$('#queue').addEventListener('click', e => {
  if (!e.target.closest('.q-remove')) return;
  const key = e.target.closest('li').dataset.key;
  const it = state.queue.find(i => i.key === key);
  if (it?.preview) URL.revokeObjectURL(it.preview);
  state.queue = state.queue.filter(i => i.key !== key);
  renderQueue();
});
$('#queue-clear').addEventListener('click', () => {
  if (state.uploading) return;
  state.queue.forEach(i => i.preview && URL.revokeObjectURL(i.preview));
  state.queue = []; renderQueue();
});
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

async function processItem(it, batch) {
  const { file } = it;
  it.status = 'working'; updateQueueItem(it);

  const hash = await sha256(file);
  const dupe = state.assets.find(a => a.sha256 === hash);
  if (dupe) { it.status = 'duplicate'; it.msg = `„${dupe.title}”`; return updateQueueItem(it); }

  const dec = await decode(file);
  const mayAlpha = isSvg(file) || /png|webp|gif|avif/i.test(file.type || file.name);
  const alpha = mayAlpha ? hasAlpha(dec) : false;
  const master = await makeMaster(file, dec, alpha);
  const thumb = await makeThumb(dec, alpha);
  const color = alpha ? null : dominantColor(dec);
  const colors = batch.product ? detectColors(dec) : [];
  dec.source.close?.();

  it.status = 'uploading'; updateQueueItem(it);
  const id = crypto.randomUUID();
  const d = new Date();
  const dir = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${id}`;
  const slug = slugify(it.title) || 'imagine';
  const paths = {
    master: `${dir}/${slug}.${master.ext}`,
    thumb: `${dir}/thumb.${thumb.ext}`,
    original: batch.keepOriginal ? `${dir}/original-${slug}.${(file.name.split('.').pop() || 'bin').toLowerCase()}` : null,
  };
  const uploaded = [];
  const put = async (path, blob, type) => {
    const { error } = await store().upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
    if (error) throw new Error(error.message);
    uploaded.push(path);
  };
  try {
    await put(paths.master, master.blob, master.mime);
    await put(paths.thumb, thumb.blob, thumb.blob.type);
    if (paths.original) await put(paths.original, file, file.type || 'application/octet-stream');

    const row = {
      id, title: it.title.trim() || titleFromName(file.name),
      category_id: batch.category_id, tags: batch.tags, credit: batch.credit,
      master_path: paths.master, thumb_path: paths.thumb, original_path: paths.original,
      mime: master.mime, width: master.width, height: master.height,
      size_bytes: master.blob.size, thumb_bytes: thumb.blob.size,
      original_name: file.name, original_bytes: paths.original ? file.size : null,
      sha256: hash, color, uploader_email: state.user.email,
    };
    if (batch.product) Object.assign(row, { flowers: batch.flowers, colors, colors_manual: false });
    const { data, error } = await sb.from('assets').insert(row).select().single();
    if (error) {
      if (error.code === '23505') { it.status = 'duplicate'; it.msg = 'încărcată deja de altcineva'; }
      throw new Error(error.message);
    }
    state.assets.unshift(data);
    it.status = 'done';
    it.msg = colors.length ? 'culori: ' + colors.map(c => colorById(c)?.label).join(', ') : '';
    updateQueueItem(it);
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

initAuth();
