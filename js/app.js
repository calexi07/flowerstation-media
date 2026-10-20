// =============================================================
//  The Flower Station · Produse Shopify
//  Încarci poze → le grupezi pe produse → completezi fișele → CSV pentru Shopify
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as CFG from './config.js';
import {
  sha256, decode, decodeUrl, hasAlpha, makeMaster, makeThumb, detectColors, COLOR_PALETTE,
} from './images.js';

const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const store = () => sb.storage.from(CFG.BUCKET);

const VENDOR = CFG.SHOPIFY_VENDOR ?? 'The Flower Station';
const TYPES = CFG.SHOPIFY_TYPES ?? [];
const COLLECTIONS = CFG.SHOPIFY_COLLECTIONS ?? [];
const DESC_FOOTER = CFG.SHOPIFY_DESC_FOOTER ?? [];
const DEFAULT_VARIANTS = CFG.DEFAULT_VARIANTS ?? ['S', 'M', 'L'];
const SQUARE_MAX = CFG.SQUARE_MAX ?? 2048;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const GROUP_GAP_MIN = 5;   // grupare automată: poze făcute la < 5 minute una de alta

/** Categoria din taxonomia standard Shopify, după tipul produsului. */
const shopifyCategory = type => {
  if (/plant/i.test(type || '')) return { id: 'hg-17-3', label: 'Indoor & Outdoor Plants' };
  if (/lum[aâ]n/i.test(type || '')) return { id: 'hg-3-40-2', label: 'Candles' };
  return { id: 'ae-3-1-3', label: 'Fresh Cut Flowers' };
};

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slugify = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const cleanTag = t => String(t ?? '').trim().replace(/\s+/g, ' ').replace(/^#/, '').slice(0, 40);
const cleanFlower = t => { const s = cleanTag(t); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
const publicUrl = p => p ? `${CFG.SUPABASE_URL}/storage/v1/object/public/${CFG.BUCKET}/${p}` : '';
const fmtDate = d => new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtPrice = v => (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(2);
const isEmpty = v => v === null || v === undefined || v === '';
const colorById = id => COLOR_PALETTE.find(c => c.id === id);
const swatchStyle = c => c.hex.startsWith('conic') ? `background:${c.hex}` : `background-color:${c.hex}`;

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `max-w-sm rounded-xl px-4 py-3 text-sm shadow-card border ${
    type === 'err' ? 'bg-blush-soft border-blush text-blush-dark' : 'bg-ink text-white border-ink'}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, type === 'err' ? 5000 : 2600);
  setTimeout(() => el.remove(), type === 'err' ? 5400 : 3000);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Dialog generic. body = HTML; collect(body) = valoarea întoarsă la OK. */
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
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? collect($('#prompt-body')) : null), { once: true });
  });
}

/** Câmp cu chip-uri (tag-uri, flori). */
function chipInput(container, initial = [], onChange = () => {}, opts = {}) {
  const clean = opts.clean || cleanTag;
  const same = (a, b) => norm(a) === norm(b);
  const dedupe = arr => arr.map(clean).filter(Boolean).filter((t, i, all) => all.findIndex(x => same(x, t)) === i);
  let tags = dedupe(initial);
  container.innerHTML = `
    <div class="flex flex-wrap gap-1.5 rounded-lg border border-line bg-paper px-2 py-1.5 focus-within:ring-2 focus-within:ring-moss/30">
      <span class="chips contents"></span>
      <input list="${opts.list || 'tag-suggestions'}" placeholder="${opts.placeholder || 'adaugă + Enter'}" class="flex-1 min-w-[110px] outline-none text-sm py-0.5 bg-transparent" />
    </div>
    ${opts.quick ? '<div class="quick flex flex-wrap gap-1 mt-1.5"></div>' : ''}`;
  const chips = $('.chips', container), input = $('input', container), quick = $('.quick', container);
  const render = () => {
    chips.innerHTML = tags.map(t => `
      <span class="inline-flex items-center gap-1 rounded-full ${opts.chipClass || 'bg-moss-soft text-moss'} text-xs px-2 py-1">
        ${esc(t)}<button type="button" data-t="${esc(t)}" class="hover:text-ink" aria-label="Șterge">×</button></span>`).join('');
    if (quick) {
      quick.innerHTML = opts.quick().filter(q => !tags.some(t => same(t, q))).slice(0, 12).map(q =>
        `<button type="button" data-q="${esc(q)}" class="text-[11px] px-2 py-0.5 rounded-full border border-line bg-paper hover:bg-cream text-muted">+ ${esc(q)}</button>`).join('');
    }
  };
  const add = raw => {
    let changed = false;
    for (const p of raw.split(',').map(clean).filter(Boolean)) if (!tags.some(t => same(t, p))) { tags.push(p); changed = true; }
    input.value = '';
    if (changed) { render(); onChange(tags); }
  };
  quick?.addEventListener('click', e => { const q = e.target.closest('[data-q]')?.dataset.q; if (q) add(q); });
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
}

// ---------------------------------------------------------------- state
const state = {
  user: null,
  catId: null,          // categoria „Produse” (pozele încărcate aici)
  extras: false,        // coloanele flori/culori pe produs există (migrarea 07)
  assets: [],           // poze de produs
  products: [],
  flowers: [],          // sugestii de flori
  step: null,           // 'group' | 'fill' | 'export' | 'done' | 'history'
  idx: 0,
  problems: null,
  lastExport: null,
  traySel: new Set(),
  exportSel: new Set(),
  saveTimers: new Map(),
  uploads: [],          // { key, file, status, msg }
  shop: { checked: false, ok: false, name: '', error: '' },   // conexiunea cu Shopify
  publishing: null,     // Map productId → { status: 'wait'|'busy'|'ok'|'err', msg }
  lastPublish: null,    // rezultatele ultimei publicări (ecranul final)
};

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
  $('#user-btn').textContent = (state.user.email?.[0] || '?').toUpperCase();
  $('#user-email').textContent = state.user.email || '';
  await loadAll();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target), msg = $('#login-msg');
  msg.hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
  if (error) { msg.hidden = false; msg.className = 'text-sm text-center text-blush-dark'; msg.textContent = 'Email sau parolă greșită.'; }
});
$('#magic-link-btn').addEventListener('click', async () => {
  const email = $('#login-form [name=email]').value.trim(), msg = $('#login-msg');
  msg.hidden = false;
  if (!email) { msg.className = 'text-sm text-center text-blush-dark'; msg.textContent = 'Scrie întâi adresa de email.'; return; }
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
  msg.className = `text-sm text-center ${error ? 'text-blush-dark' : 'text-moss'}`;
  msg.textContent = error ? 'Nu am putut trimite linkul. Contul există?' : 'Verifică emailul — ți-am trimis un link.';
});
$('#user-btn').addEventListener('click', e => { e.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; });
document.addEventListener('click', () => { $('#user-menu').hidden = true; });
$('#logout-btn').addEventListener('click', () => sb.auth.signOut());

// ---------------------------------------------------------------- date
async function ensureCategory() {
  const { data, error } = await sb.from('categories').select('id,slug').eq('slug', 'produse');
  if (error) throw error;
  if (data.length) { state.catId = data[0].id; return; }
  const { data: made, error: e2 } = await sb.from('categories').insert({ name: 'Produse', slug: 'produse', sort: 10 }).select().single();
  if (e2) throw e2;
  state.catId = made.id;
}

async function loadAssets() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('assets').select('*').eq('category_id', state.catId)
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  state.assets = all.filter(a => (a.kind || 'image') === 'image' && a.status !== 'review');
}

async function loadAll() {
  $('#body').innerHTML = '<p class="text-muted py-16 text-center">Se încarcă…</p>';
  try {
    await ensureCategory();
    const [, prods, fl, probe] = await Promise.all([
      loadAssets(),
      sb.from('products').select('*').order('created_at', { ascending: true }),
      sb.from('flowers').select('name').order('name'),
      sb.from('products').select('flowers,colors,colors_manual').limit(1),
    ]);
    if (prods.error) throw prods.error;
    state.products = prods.data;
    state.flowers = fl.error ? [] : fl.data.map(f => f.name);
    state.extras = !probe.error;
    if (!state.extras) console.warn('Rulează supabase/migrare-07-curatare.sql pentru flori și culori pe produs.');
  } catch (err) {
    console.error(err);
    $('#body').innerHTML = `<div class="max-w-lg mx-auto text-center py-16">
      <p class="font-serif text-xl">Nu am putut încărca datele</p>
      <p class="text-muted text-sm mt-2">Verifică dacă scripturile SQL au fost rulate în Supabase și dacă proiectul nu e oprit (limita planului gratuit).</p></div>`;
    return;
  }
  renderSuggestions();
  state.step = pickStep();
  if (state.step === 'fill') state.idx = Math.max(0, batch().findIndex(p => !isComplete(p)));
  render();
  checkShopify();
}

// ---------------------------------------------------------------- selectori
const batch = () => state.products.filter(p => !p.exported_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
const history = () => state.products.filter(p => p.exported_at).sort((a, b) => b.exported_at.localeCompare(a.exported_at));
const tray = () => state.assets.filter(a => !a.product_id)
  .sort((a, b) => (a.taken_at || a.created_at).localeCompare(b.taken_at || b.created_at));
const productImages = p => state.assets.filter(a => a.product_id === p.id)
  .sort((a, b) => (a.product_position ?? 0) - (b.product_position ?? 0));
const label = (p, i) => p.title?.trim() || `Produs ${i + 1}`;

/** Culorile produsului: setate manual sau detectate din poza principală. */
const productColors = p => (state.extras && p.colors_manual) ? (p.colors || []) : (productImages(p)[0]?.colors || []);

function productProblems(p) {
  const out = [];
  if (!p.title?.trim()) out.push('numele');
  if (!productImages(p).length) out.push('cel puțin o poză');
  if (p.has_variants) {
    const v = (p.variants || []).filter(x => x.value?.trim());
    if (!v.length) out.push('variantele');
    else if (v.some(x => isEmpty(x.price))) out.push('prețul fiecărei variante');
  } else if (isEmpty(p.price)) out.push('prețul');
  return out;
}
const isComplete = p => !productProblems(p).length;

function pickStep() {
  const b = batch();
  if (!b.length || tray().length) return 'group';
  return b.some(p => !isComplete(p)) ? 'fill' : 'export';
}

function renderSuggestions() {
  const used = state.products.flatMap(p => p.flowers || []);
  const all = [...new Set([...used, ...state.flowers])].sort((a, b) => a.localeCompare(b, 'ro'));
  $('#flower-suggestions').innerHTML = all.map(f => `<option value="${esc(f)}">`).join('');
  const tags = [...new Set(state.products.flatMap(p => p.tags || []))].sort();
  $('#tag-suggestions').innerHTML = tags.map(t => `<option value="${esc(t)}">`).join('');
}
async function rememberFlowers(names) {
  const known = new Set(state.flowers.map(norm));
  const fresh = names.filter(n => !known.has(norm(n)));
  if (!fresh.length) return;
  const { error } = await sb.from('flowers').upsert(fresh.map(name => ({ name })), { onConflict: 'name', ignoreDuplicates: true });
  if (!error) { state.flowers.push(...fresh); renderSuggestions(); }
}

// ---------------------------------------------------------------- upload poze
const titleFromName = n => {
  const t = n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Poză';
};
const looksImage = f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|avif)$/i.test(f.name);

function addFiles(list) {
  const files = [...list].filter(looksImage);
  if (list.length > files.length) toast(`${list.length - files.length} fișiere ignorate (nu sunt poze)`, 'err');
  if (!files.length) return;
  for (const file of files) {
    const big = file.size > MAX_FILE_BYTES;
    state.uploads.push({ key: crypto.randomUUID(), file, status: big ? 'error' : 'pending', msg: big ? 'peste 50 MB' : '' });
  }
  state.step = 'group';
  render();
  runUploads();
}

let uploading = false;
async function runUploads() {
  if (uploading) return;
  uploading = true;
  const worker = async () => {
    for (;;) {
      const u = state.uploads.find(x => x.status === 'pending');
      if (!u) return;
      u.status = 'working';
      try { await uploadOne(u); } catch (err) { if (err) { console.error(err); u.status = 'error'; u.msg = err.message || 'eroare'; } }
      refreshUploads();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  uploading = false;
  const done = state.uploads.filter(u => u.status === 'done').length;
  const dup = state.uploads.filter(u => u.status === 'duplicate').length;
  const errs = state.uploads.filter(u => u.status === 'error');
  toast(`${done} ${done === 1 ? 'poză încărcată' : 'poze încărcate'}${dup ? ` · ${dup} existau deja` : ''}${errs.length ? ` · ${errs.length} erori` : ''}`, errs.length ? 'err' : 'ok');
  state.uploads = errs;   // rămân vizibile doar erorile
  if (state.step === 'group') render(); else $('#steps').innerHTML = stepsHtml();
}

async function uploadOne(u) {
  const { file } = u;
  const hash = await sha256(file);
  if (state.assets.some(a => a.sha256 === hash)) { u.status = 'duplicate'; return; }
  const dec = await decode(file);
  const alpha = /png|webp|avif/i.test(file.type || file.name) ? hasAlpha(dec) : false;
  const master = await makeMaster(file, dec, alpha);
  const thumb = await makeThumb(dec, alpha);
  const colors = detectColors(dec);
  dec.source.close?.();

  const id = crypto.randomUUID();
  const d = new Date();
  const dir = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${id}`;
  const slug = slugify(file.name.replace(/\.[^.]+$/, '')) || 'poza';
  const paths = { master: `${dir}/${slug}.${master.ext}`, thumb: `${dir}/thumb.${thumb.ext}` };
  const uploaded = [];
  try {
    for (const [path, blob, type] of [[paths.master, master.blob, master.mime], [paths.thumb, thumb.blob, thumb.blob.type]]) {
      const { error } = await store().upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
      if (error) throw new Error(error.message);
      uploaded.push(path);
    }
    const { data, error } = await sb.from('assets').insert({
      id, title: titleFromName(file.name), category_id: state.catId,
      master_path: paths.master, thumb_path: paths.thumb, mime: master.mime,
      width: master.width, height: master.height, size_bytes: master.blob.size, thumb_bytes: thumb.blob.size,
      original_name: file.name, sha256: hash, colors, colors_manual: false,
      taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      uploader_email: state.user.email,
    }).select().single();
    if (error) {
      if (error.code === '23505') { u.status = 'duplicate'; }
      throw new Error(error.message);
    }
    state.assets.push(data);
    u.status = 'done';
  } catch (err) {
    if (uploaded.length) await store().remove(uploaded);
    if (u.status === 'duplicate') return;
    throw err;
  }
}

function refreshUploads() {
  const box = $('#uploads');
  if (box) box.outerHTML = uploadsHtml();
  if (state.step === 'group') {
    const g = $('#tray-grid'); if (g) g.outerHTML = trayGridHtml();
    const c = $('#tray-count'); if (c) c.textContent = `(${tray().length})`;
  }
}

function uploadsHtml() {
  const u = state.uploads;
  if (!u.length) return '<div id="uploads"></div>';
  const total = u.length, finished = u.filter(x => !['pending', 'working'].includes(x.status)).length;
  const errs = u.filter(x => x.status === 'error'), busy = finished < total;
  return `<div id="uploads" class="mt-3 rounded-xl ${errs.length && !busy ? 'bg-blush-soft text-blush-dark' : 'bg-cream'} px-3 py-2 text-sm">
    ${busy ? `<div class="flex items-center gap-2"><span class="spin inline-block">◌</span> Se încarcă ${finished}/${total} poze…</div>
      <div class="h-1 rounded-full bg-line mt-2 overflow-hidden"><div class="h-full bg-moss" style="width:${(finished / total) * 100}%"></div></div>` : ''}
    ${errs.length ? `<p class="${busy ? 'mt-2' : ''} text-xs">${errs.length} ${errs.length === 1 ? 'poză nu s-a putut încărca' : 'poze nu s-au putut încărca'}: ${errs.map(x => `${esc(x.file.name)} (${esc(x.msg)})`).join(', ')}
      ${busy ? '' : '<button data-act="clear-errors" class="underline ml-1">ascunde</button>'}</p>` : ''}
  </div>`;
}

$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (hasFiles(e) && state.user) { dragDepth++; $('#page-drop').hidden = false; } });
window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#page-drop').hidden = true; } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#page-drop').hidden = true;
  if (state.user) addFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------- produse: creare / grupare
async function uniqueHandle(base, exceptId) {
  const h = slugify(base) || 'produs';
  const taken = new Set(state.products.filter(p => p.id !== exceptId).map(p => p.handle));
  let n = 1;
  while (taken.has(n === 1 ? h : `${h}-${n}`)) n++;
  return n === 1 ? h : `${h}-${n}`;
}

async function createProduct(assetIds) {
  if (!assetIds.length) return null;
  const { data, error } = await sb.from('products').insert({
    title: '', handle: await uniqueHandle(`produs-${Date.now().toString(36)}`), vendor: VENDOR, status: 'draft',
  }).select().single();
  if (error) { toast('Nu am putut crea produsul.', 'err'); return null; }
  state.products.push(data);
  await assign(assetIds, data.id);
  return data;
}

async function assign(assetIds, productId) {
  const p = state.products.find(x => x.id === productId);
  let pos = p ? productImages(p).length : 0;
  for (const id of assetIds) {
    const a = state.assets.find(x => x.id === id);
    if (!a) continue;
    const patch = { product_id: productId, product_position: productId ? pos++ : null };
    const { error } = await sb.from('assets').update(patch).eq('id', id);
    if (!error) Object.assign(a, patch);
    state.traySel.delete(id);
  }
}

async function reorder(p, ids) {
  for (let i = 0; i < ids.length; i++) {
    const a = state.assets.find(x => x.id === ids[i]);
    if (a && a.product_position !== i) { a.product_position = i; await sb.from('assets').update({ product_position: i }).eq('id', a.id); }
  }
}

async function autoGroup() {
  const items = tray();
  if (!items.length) return;
  const groups = [];
  for (const a of items) {
    const t = new Date(a.taken_at || a.created_at).getTime();
    const g = groups[groups.length - 1];
    if (g && t - g.last <= GROUP_GAP_MIN * 60e3) { g.ids.push(a.id); g.last = t; } else groups.push({ ids: [a.id], last: t });
  }
  const ok = await ask({
    title: `Grupez ${items.length} poze în ${groups.length} produse?`, ok: 'Grupează',
    body: `<p class="text-sm text-muted">Pozele făcute la mai puțin de ${GROUP_GAP_MIN} minute una de alta intră în același produs. După aceea poți muta pozele între produse prin tragere.</p>`,
  });
  if (!ok) return;
  for (const g of groups) await createProduct(g.ids);
  render();
}

async function deleteProduct(p) {
  const ok = await ask({
    title: 'Desfaci produsul?', ok: 'Desface', danger: true,
    body: '<p class="text-sm text-muted">Fișa se șterge, iar pozele revin în lista din stânga. Din Shopify nu se șterge nimic.</p>',
  });
  if (!ok) return;
  const { error } = await sb.from('products').delete().eq('id', p.id);
  if (error) return toast('Nu am putut șterge produsul.', 'err');
  state.assets.forEach(a => { if (a.product_id === p.id) { a.product_id = null; a.product_position = null; } });
  state.products = state.products.filter(x => x !== p);
  render();
}

async function deletePhotos(ids) {
  const items = state.assets.filter(a => ids.includes(a.id));
  if (!items.length) return;
  const ok = await ask({
    title: `Ștergi ${items.length} ${items.length === 1 ? 'poză' : 'poze'}?`, ok: 'Șterge', danger: true,
    body: '<p class="text-sm text-muted">Pozele se șterg din aplicație. Pe telefon sau în calculator rămân neatinse.</p>',
  });
  if (!ok) return;
  const { error } = await sb.from('assets').delete().in('id', ids);
  if (error) return toast('Nu am putut șterge pozele.', 'err');
  await store().remove(items.flatMap(a => [a.master_path, a.thumb_path]).filter(Boolean));
  state.assets = state.assets.filter(a => !ids.includes(a.id));
  ids.forEach(id => state.traySel.delete(id));
  render();
}

// ---------------------------------------------------------------- salvare fișă
const SAVE_FIELDS = ['title', 'handle', 'description', 'vendor', 'product_type', 'collection', 'tags', 'price',
  'compare_at_price', 'status', 'has_variants', 'option_name', 'variants', 'seo_title', 'seo_description'];

function queueSave(p, patch) {
  Object.assign(p, patch);
  clearTimeout(state.saveTimers.get(p.id));
  state.saveTimers.set(p.id, setTimeout(() => { state.saveTimers.delete(p.id); saveProduct(p); }, 600));
}
async function saveProduct(p) {
  const fields = state.extras ? [...SAVE_FIELDS, 'flowers', 'colors', 'colors_manual'] : SAVE_FIELDS;
  const row = Object.fromEntries(fields.map(k => [k, p[k] ?? null]));
  for (const k of ['tags', 'flowers', 'colors', 'variants']) if (k in row && row[k] === null) row[k] = [];
  if ('colors_manual' in row) row.colors_manual = !!row.colors_manual;
  const { data, error } = await sb.from('products').update(row).eq('id', p.id).select().single();
  if (error) { toast(error.code === '23505' ? 'Există deja un produs cu acest link.' : 'Nu am putut salva produsul.', 'err'); return; }
  Object.assign(p, data);
}
async function flushSave(p) {
  if (!p) return;
  const t = state.saveTimers.get(p.id);
  if (t) { clearTimeout(t); state.saveTimers.delete(p.id); await saveProduct(p); }
}

// ---------------------------------------------------------------- decupaj pătrat
function cropRect(a, W = a.width, H = a.height) {
  const zoom = Math.max(1, a.crop_zoom || 1);
  const side = Math.min(W, H) / zoom;
  const fx = a.focal_x ?? 0.5, fy = a.focal_y ?? 0.5;
  return {
    x: Math.min(Math.max(fx * W - side / 2, 0), W - side),
    y: Math.min(Math.max(fy * H - side / 2, 0), H - side),
    side, zoom,
  };
}
function squarePreview(a, src = publicUrl(a.thumb_path)) {
  const W = a.width || 1, H = a.height || 1, r = cropRect(a, W, H);
  return `<img src="${src}" alt="" draggable="false" class="absolute max-w-none pointer-events-none select-none"
    style="width:${(W / r.side) * 100}%;height:${(H / r.side) * 100}%;left:${(-r.x / r.side) * 100}%;top:${(-r.y / r.side) * 100}%" />`;
}

async function openCropEditor(a) {
  const W = a.width, H = a.height;
  const st = { fx: a.focal_x ?? 0.5, fy: a.focal_y ?? 0.5, zoom: Math.max(1, a.crop_zoom || 1) };
  const portrait = H > W * 1.02, landscape = W > H * 1.02;
  const res = await ask({
    title: 'Decupaj pătrat', ok: 'Salvează decupajul',
    body: `
      <p class="text-xs text-muted -mt-2 mb-3">Trage poza ${portrait ? 'în sus sau în jos' : landscape ? 'stânga sau dreapta' : 'în orice direcție (după zoom)'} ca floarea să stea unde vrei în pătrat.</p>
      <div class="crop-vp relative mx-auto aspect-square w-full max-w-[340px] overflow-hidden rounded-xl bg-cream touch-none cursor-grab select-none">
        <img src="${publicUrl(a.master_path)}" alt="" draggable="false" class="crop-img absolute max-w-none pointer-events-none select-none" />
        <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">${'<div class="border border-white/40"></div>'.repeat(9)}</div>
        <div class="pointer-events-none absolute left-1/2 top-1/2 w-5 h-5 -translate-x-1/2 -translate-y-1/2">
          <div class="absolute left-1/2 top-0 bottom-0 w-px bg-white/90 -translate-x-1/2"></div>
          <div class="absolute top-1/2 left-0 right-0 h-px bg-white/90 -translate-y-1/2"></div></div>
      </div>
      <label class="flex items-center gap-3 mt-4 text-sm"><span class="text-muted shrink-0">Zoom</span>
        <input type="range" class="crop-zoom flex-1 accent-moss" min="1" max="3" step="0.01" value="${st.zoom}" />
        <span class="crop-zoom-val w-10 text-right text-xs tabular-nums text-muted"></span></label>
      <button type="button" class="crop-center mt-3 text-xs text-moss hover:underline">⊕ Centrează</button>`,
    onOpen: b => {
      const vp = $('.crop-vp', b), img = $('.crop-img', b), zoomIn = $('.crop-zoom', b);
      const apply = () => {
        const r = cropRect({ width: W, height: H, focal_x: st.fx, focal_y: st.fy, crop_zoom: st.zoom });
        st.fx = (r.x + r.side / 2) / W; st.fy = (r.y + r.side / 2) / H;
        Object.assign(img.style, { width: `${(W / r.side) * 100}%`, height: `${(H / r.side) * 100}%`, left: `${(-r.x / r.side) * 100}%`, top: `${(-r.y / r.side) * 100}%` });
        $('.crop-zoom-val', b).textContent = `${st.zoom.toFixed(1)}×`;
      };
      apply();
      let drag = null;
      vp.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, fx: st.fx, fy: st.fy }; vp.setPointerCapture(e.pointerId); });
      vp.addEventListener('pointermove', e => {
        if (!drag) return;
        const r = cropRect({ width: W, height: H, focal_x: drag.fx, focal_y: drag.fy, crop_zoom: st.zoom });
        const k = vp.clientWidth / r.side;
        st.fx = drag.fx - (e.clientX - drag.x) / k / W;
        st.fy = drag.fy - (e.clientY - drag.y) / k / H;
        apply();
      });
      vp.addEventListener('pointerup', () => { drag = null; });
      vp.addEventListener('pointercancel', () => { drag = null; });
      zoomIn.addEventListener('input', () => { st.zoom = Number(zoomIn.value); apply(); });
      $('.crop-center', b).addEventListener('click', () => { st.fx = 0.5; st.fy = 0.5; st.zoom = 1; zoomIn.value = 1; apply(); });
    },
    collect: () => ({ ...st }),
  });
  if (!res) return;
  const patch = { focal_x: +res.fx.toFixed(4), focal_y: +res.fy.toFixed(4), crop_zoom: +res.zoom.toFixed(3) };
  let { error } = await sb.from('assets').update(patch).eq('id', a.id);
  if (error && /crop_zoom/.test(error.message || '')) {
    delete patch.crop_zoom;
    ({ error } = await sb.from('assets').update(patch).eq('id', a.id));
  }
  if (error) return toast('Nu am putut salva decupajul.', 'err');
  Object.assign(a, patch);
  render();
}

// ---------------------------------------------------------------- randare
function render() {
  $('#steps').innerHTML = stepsHtml();
  $('#body').innerHTML = { group: groupHtml, fill: fillHtml, export: exportHtml, done: doneHtml, history: historyHtml }[state.step]();
  $$('#body article[data-pid]').forEach(card => {
    const p = state.products.find(x => x.id === card.dataset.pid);
    if (!p) return;
    const tg = $('.f-tags', card);
    if (tg) chipInput(tg, p.tags || [], v => queueSave(p, { tags: [...v] }));
    const fl = $('.f-flowers', card);
    if (fl) chipInput(fl, p.flowers || [], v => { queueSave(p, { flowers: [...v] }); rememberFlowers(v); }, {
      list: 'flower-suggestions', clean: cleanFlower, placeholder: 'ex. Trandafiri + Enter', chipClass: 'bg-blush-soft text-blush-dark',
      quick: () => [...new Set([...state.products.flatMap(x => x.flowers || []), ...state.flowers])],
    });
  });
}

function go(step, idx) {
  state.step = step;
  if (['export', 'history'].includes(step)) checkShopify();
  state.problems = null;
  if (step === 'fill') {
    const b = batch();
    state.idx = idx ?? Math.max(0, b.findIndex(p => !isComplete(p)));
    state.idx = Math.max(0, Math.min(state.idx, b.length - 1));
  }
  render();
  window.scrollTo({ top: 0 });
}

function stepsHtml() {
  const b = batch(), n = b.length, done = b.filter(isComplete).length;
  const order = ['group', 'fill', 'export'];
  const cur = state.step === 'done' ? 3 : order.indexOf(state.step);
  const steps = [
    ['group', 'Grupează pozele', n ? `${n} ${n === 1 ? 'produs' : 'produse'}` : ''],
    ['fill', 'Completează', n ? `${done}/${n} gata` : ''],
    ['export', 'Publică', ''],
  ];
  return steps.map(([k, name, sub], i) => {
    const active = i === cur || (k === 'export' && state.step === 'done');
    const past = state.step !== 'history' && i < cur;
    const enabled = k === 'group' || n > 0;
    return `${i ? '<span class="w-6 h-px bg-line hidden sm:block"></span>' : ''}
      <button data-step="${k}" ${enabled ? '' : 'disabled'} class="flex items-center gap-2 rounded-full pl-1.5 pr-3.5 py-1.5 text-sm border transition disabled:opacity-40
        ${active ? 'bg-ink text-white border-ink' : past ? 'bg-moss-soft text-moss border-moss-soft' : 'bg-paper border-line text-muted'}">
        <span class="w-6 h-6 rounded-full grid place-items-center text-xs font-semibold ${active ? 'bg-white text-ink' : past ? 'bg-moss text-white' : 'bg-cream'}">${past ? '✓' : i + 1}</span>
        <span class="font-medium">${name}</span>${sub ? `<span class="text-xs opacity-70">${sub}</span>` : ''}
      </button>`;
  }).join('') + `
    <button data-step="history" class="ml-auto text-sm ${state.step === 'history' ? 'text-ink font-medium' : 'text-muted hover:text-ink'}">🕘 Exportate (${history().length})</button>`;
}

// ----- ① Grupare
function trayGridHtml() {
  const t = tray();
  return `<div id="tray-grid" class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
    ${t.length ? t.map(a => `
      <button type="button" draggable="true" data-aid="${a.id}" title="${esc(a.original_name || a.title)}"
        class="tray-item relative aspect-square rounded-lg overflow-hidden bg-cream ${state.traySel.has(a.id) ? 'ring-[3px] ring-moss ring-offset-2' : 'hover:opacity-90'}">
        <img src="${publicUrl(a.thumb_path)}" alt="" loading="lazy" class="w-full h-full object-cover pointer-events-none" />
        ${state.traySel.has(a.id) ? '<span class="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-moss text-white text-xs grid place-items-center shadow">✓</span>' : ''}
      </button>`).join('') : `
      <button type="button" data-act="pick" class="col-span-full text-center py-12 rounded-xl border-2 border-dashed border-line hover:border-moss hover:bg-moss-soft/40 transition">
        <div class="text-3xl mb-1">🌸</div>
        <p class="text-sm font-medium">${batch().length ? 'Toate pozele sunt grupate' : 'Încarcă pozele produselor noi'}</p>
        <p class="text-xs text-muted mt-1">Click aici sau trage pozele oriunde pe pagină · JPG, PNG, HEIC (iPhone)</p>
      </button>`}
  </div>`;
}

function groupHtml() {
  const t = tray(), b = batch(), nSel = state.traySel.size;
  return `
  <div class="grid lg:grid-cols-2 gap-5 items-start">
    <section class="rounded-2xl border border-line bg-paper p-4 min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-serif text-lg">Poze <span id="tray-count" class="text-muted text-base">(${t.length})</span></h3>
        <div class="ml-auto flex gap-2">
          <button data-act="pick" class="text-sm px-3 py-1.5 rounded-full border border-line hover:bg-cream">⬆ Adaugă poze</button>
          ${t.length > 1 ? '<button data-act="auto" class="text-sm px-3 py-1.5 rounded-full border border-line hover:bg-cream">⚡ Grupează automat</button>' : ''}
        </div>
      </div>
      ${t.length ? '<p class="text-xs text-muted mt-1">Selectează pozele aceluiași buchet → <b>+ Produs din selecție</b>. Sau trage-le pe un produs din dreapta.</p>' : ''}
      ${uploadsHtml()}
      ${trayGridHtml()}
      ${t.length ? `
      <div class="sticky bottom-3 mt-3 grid sm:grid-cols-[1fr_1fr_auto] gap-2 bg-paper/95 backdrop-blur rounded-xl">
        <button data-act="new" ${nSel ? '' : 'disabled'} class="rounded-full bg-ink text-white text-sm py-2.5 disabled:opacity-40">
          ${nSel ? `+ Produs din ${nSel} ${nSel === 1 ? 'poză' : 'poze'}` : '+ Produs din selecție'}</button>
        <select id="add-to" ${nSel && b.length ? '' : 'disabled'} class="rounded-full border border-line bg-paper text-sm px-3 py-2.5 disabled:opacity-40">
          <option value="">Adaugă la produs…</option>
          ${b.map((p, i) => `<option value="${p.id}">${esc(label(p, i))}</option>`).join('')}
        </select>
        <button data-act="del-photos" ${nSel ? '' : 'disabled'} title="Șterge pozele selectate" class="rounded-full border border-line px-3 py-2.5 text-sm text-blush-dark hover:bg-blush-soft disabled:opacity-40">🗑</button>
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
              <span class="w-6 h-6 rounded-full ${isComplete(p) ? 'bg-moss text-white' : 'bg-cream'} text-xs grid place-items-center font-semibold">${isComplete(p) ? '✓' : i + 1}</span>
              <span class="font-medium truncate">${esc(label(p, i))}</span>
              <span class="text-xs text-muted">${imgs.length} ${imgs.length === 1 ? 'poză' : 'poze'}</span>
              <button type="button" data-act="del-product" class="ml-auto w-8 h-8 rounded-full hover:bg-cream text-muted" title="Desface produsul">🗑</button>
            </div>
            ${stripHtml(imgs, 'w-20 h-20')}
          </article>`;
        }).join('') : '<div class="text-center py-12 rounded-2xl border border-dashed border-line text-sm text-muted">Produsele create din poze apar aici.</div>'}
      </div>
    </section>
  </div>
  ${b.length ? `
  <div class="sticky bottom-4 mt-6 flex justify-end">
    <button data-step="fill" class="rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-3 font-medium shadow-card">
      Continuă: completează ${b.length} ${b.length === 1 ? 'produs' : 'produse'} →</button>
  </div>` : ''}`;
}

function stripHtml(imgs, size) {
  return `<div class="strip mt-2 flex gap-2 overflow-x-auto scrollbar-thin rounded-xl border-2 border-dashed border-transparent p-1 -m-1">
    ${imgs.map((a, j) => `
      <div draggable="true" data-aid="${a.id}" title="Click: decupaj pătrat · Trage: mută sau reordonează" class="p-img relative shrink-0 ${size} rounded-lg overflow-hidden bg-cream cursor-pointer">
        ${squarePreview(a)}
        <span class="absolute top-1 left-1 text-[10px] px-1 rounded bg-white/85 text-ink">✂</span>
        ${j === 0 ? '<span class="absolute bottom-1 left-1 text-[10px] px-1.5 rounded bg-ink/80 text-white">principală</span>' : ''}
        <button type="button" data-act="unlink" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 text-xs text-ink hover:bg-white" title="Scoate din produs">×</button>
      </div>`).join('')}
    <div class="shrink-0 ${size} rounded-lg border border-dashed border-line grid place-items-center text-[10px] text-muted text-center px-1">Trage poze aici</div>
  </div>`;
}

// ----- ② Completare, câte un produs
const FIELD = 'mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/30';

function optionSelect(key, value, list, placeholder) {
  const opts = [...list];
  if (value && !opts.includes(value)) opts.unshift(value);
  return `<select data-k="${key}" class="${FIELD}">
    <option value="">${esc(placeholder)}</option>
    ${opts.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    <option value="__other">+ Altă valoare…</option></select>`;
}

function colorSwatches(selected) {
  return COLOR_PALETTE.map(c => {
    const on = selected.includes(c.id);
    return `<button type="button" data-color="${c.id}" title="${c.label}" aria-pressed="${on}"
      class="w-7 h-7 rounded-full border ${c.id === 'alb' ? 'border-line' : 'border-transparent'} ${on ? 'ring-2 ring-offset-2 ring-moss' : 'opacity-70 hover:opacity-100'}"
      style="${swatchStyle(c)}"><span class="sr-only">${c.label}</span></button>`;
  }).join('');
}

function productCardHtml(p, { pick = false } = {}) {
  const imgs = productImages(p), variants = Array.isArray(p.variants) ? p.variants : [];
  const colors = productColors(p);
  return `
  <article data-pid="${p.id}" class="rounded-2xl border border-line bg-paper p-4 sm:p-5 shadow-card">
    <div class="flex items-start gap-3">
      ${pick ? `<input type="checkbox" data-act="pick-export" class="mt-2.5 w-4 h-4 accent-moss" ${state.exportSel.has(p.id) ? 'checked' : ''} title="Include la export" />` : ''}
      <input data-k="title" value="${esc(p.title)}" placeholder="Numele produsului (ex. Buchet „Mara” cu protea și trandafiri)"
        class="flex-1 min-w-0 font-serif text-xl bg-transparent border-b border-dashed border-line hover:border-muted focus:border-moss outline-none py-1" />
      <div class="inline-flex rounded-full border border-line overflow-hidden text-xs shrink-0 mt-1.5" role="group" aria-label="Stare în Shopify">
        <button type="button" data-status="draft" class="px-2.5 py-1 ${p.status === 'draft' ? 'bg-ink text-white' : 'bg-paper hover:bg-cream'}">Draft</button>
        <button type="button" data-status="active" class="px-2.5 py-1 ${p.status === 'active' ? 'bg-moss text-white' : 'bg-paper hover:bg-cream'}">Activ</button>
      </div>
    </div>

    ${stripHtml(imgs, 'w-24 h-24')}
    <p class="text-[11px] text-muted mt-1.5">Se trimit pătrate, exact cum le vezi aici. Click pe o poză ca să muți floarea mai sus / mai jos sau să faci zoom. Prima e poza principală.</p>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
      <label class="block ${p.has_variants ? 'opacity-40' : ''}"><span class="text-muted">Preț (lei)</span>
        <input data-k="price" type="number" step="0.01" min="0" inputmode="decimal" value="${fmtPrice(p.price)}" class="${FIELD}" ${p.has_variants ? 'disabled' : ''} /></label>
      <label class="block ${p.has_variants ? 'opacity-40' : ''}"><span class="text-muted">Preț vechi</span>
        <input data-k="compare_at_price" type="number" step="0.01" min="0" inputmode="decimal" value="${fmtPrice(p.compare_at_price)}" placeholder="opțional" class="${FIELD}" ${p.has_variants ? 'disabled' : ''} /></label>
      <label class="block"><span class="text-muted">Tip produs</span>
        ${optionSelect('product_type', p.product_type, TYPES, 'Alege tipul…')}
        <span class="cat-hint block text-[11px] text-muted mt-1">Categorie Shopify: ${shopifyCategory(p.product_type).label}</span></label>
      <label class="block"><span class="text-muted">Colecție</span>
        ${optionSelect('collection', p.collection, COLLECTIONS, '— fără colecție —')}</label>
    </div>

    <label class="block mt-4 text-sm"><span class="text-muted">Descriere — primul paragraf</span>
      <textarea data-k="description" rows="3" class="${FIELD}" placeholder="Ex: Oferă o surpriză florală deosebită alegând acest buchet cu trandafiri, protea, mattiola…">${esc(p.description || '')}</textarea></label>
    <details class="mt-1 text-[11px] text-muted">
      <summary class="cursor-pointer select-none">+ ${DESC_FOOTER.length} paragrafe standard adăugate automat</summary>
      <div class="mt-1 space-y-1 pl-3 border-l-2 border-line">${DESC_FOOTER.map(t => `<p>${esc(t)}</p>`).join('')}</div>
    </details>

    <div class="mt-4 text-sm">
      <label class="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" data-act="has-variants" class="accent-moss" ${p.has_variants ? 'checked' : ''} />
        <span>Are variante <span class="text-muted">(ex. mărimi cu prețuri diferite)</span></span></label>
      ${p.has_variants ? `
      <div class="mt-2 rounded-xl bg-cream/60 border border-line p-3 space-y-2">
        <label class="flex items-center gap-2"><span class="text-muted shrink-0">Nume opțiune</span>
          <input data-k="option_name" value="${esc(p.option_name || 'Mărime')}" class="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" /></label>
        <div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted px-0.5"><span>Valoare</span><span>Preț (lei)</span><span>Preț vechi</span><span class="w-7"></span></div>
        ${variants.map((v, i) => `
        <div class="var grid grid-cols-[1fr_1fr_1fr_auto] gap-2" data-i="${i}">
          <input data-v="value" value="${esc(v.value || '')}" placeholder="ex. M / 25 fire" class="min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" />
          <input data-v="price" type="number" step="0.01" min="0" value="${fmtPrice(v.price)}" class="min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" />
          <input data-v="compare_at_price" type="number" step="0.01" min="0" value="${fmtPrice(v.compare_at_price)}" placeholder="opțional" class="min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5" />
          <button type="button" data-act="del-variant" class="w-7 h-7 rounded-full hover:bg-paper text-muted" title="Șterge varianta">×</button>
        </div>`).join('')}
        <button type="button" data-act="add-variant" class="text-xs text-moss hover:underline">+ Adaugă variantă</button>
      </div>` : ''}
    </div>

    ${state.extras ? `
    <div class="grid sm:grid-cols-2 gap-4 mt-4 text-sm">
      <div><span class="text-muted">Flori</span><div class="f-flowers mt-1"></div></div>
      <div><div class="flex items-center justify-between"><span class="text-muted">Culori
          <span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full ${p.colors_manual ? 'bg-ink text-white' : 'bg-moss-soft text-moss'}">${p.colors_manual ? 'manual' : 'automat'}</span></span>
          ${p.colors_manual ? '<button type="button" data-act="colors-auto" class="text-xs text-moss hover:underline">↻ automat</button>' : ''}</div>
        <div class="flex flex-wrap gap-1.5 mt-1.5">${colorSwatches(colors)}</div></div>
    </div>` : ''}

    <div class="mt-4 text-sm"><span class="text-muted">Tag-uri în plus</span><div class="f-tags mt-1"></div>
      <p class="text-[11px] text-muted mt-1">La export se adaugă automat: colecția${state.extras ? ', florile și culorile' : ''}.</p></div>

    <details class="mt-4 text-sm">
      <summary class="cursor-pointer text-muted hover:text-ink select-none">SEO și link produs</summary>
      <div class="grid gap-3 mt-2">
        <label class="block"><span class="text-muted">Link produs</span>
          <div class="flex items-center gap-1 mt-1"><span class="text-xs text-muted whitespace-nowrap">theflowerstation.ro/products/</span>
          <input data-k="handle" value="${esc(p.handle || '')}" class="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-xs" /></div></label>
        <label class="block"><span class="text-muted">Titlu SEO</span>
          <input data-k="seo_title" value="${esc(p.seo_title || '')}" placeholder="Implicit: numele produsului" maxlength="70" class="${FIELD}" /></label>
        <label class="block"><span class="text-muted">Descriere SEO</span>
          <textarea data-k="seo_description" rows="2" maxlength="320" placeholder="Implicit: primul paragraf al descrierii" class="${FIELD}">${esc(p.seo_description || '')}</textarea></label>
      </div>
    </details>
  </article>`;
}

function fillHtml() {
  const b = batch();
  if (!b.length) return '<p class="text-muted">Nu ai produse de completat. Mergi la pasul 1.</p>';
  const i = state.idx, p = b[i], last = i === b.length - 1;
  return `
  <div class="flex gap-2 overflow-x-auto scrollbar-thin pb-2">
    ${b.map((q, j) => {
      const ok = isComplete(q), img = productImages(q)[0];
      return `<button data-go="${j}" title="${esc(label(q, j))}" class="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 ${j === i ? 'border-ink' : ok ? 'border-moss' : 'border-line'} bg-cream">
        ${img ? squarePreview(img) : ''}
        <span class="absolute bottom-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold grid place-items-center ${ok ? 'bg-moss text-white' : 'bg-white text-ink'}">${ok ? '✓' : j + 1}</span>
      </button>`;
    }).join('')}
  </div>
  <div class="flex items-baseline justify-between mt-3 mb-3 max-w-3xl">
    <p class="font-serif text-xl">Produsul ${i + 1} <span class="text-muted">din ${b.length}</span></p>
    <p class="text-sm text-muted">${b.filter(isComplete).length} gata</p>
  </div>
  <div class="max-w-3xl">${productCardHtml(p)}</div>
  ${state.problems?.length ? `<div id="problems" class="max-w-3xl mt-3 rounded-xl border border-blush bg-blush-soft text-blush-dark text-sm px-4 py-3">
    <b>Mai trebuie completat:</b> ${state.problems.join(', ')}.</div>` : ''}
  <div class="max-w-3xl sticky bottom-4 mt-4 flex items-center gap-2 bg-cream/90 backdrop-blur rounded-full p-1.5 shadow-card">
    <button data-act="prev" ${i ? '' : 'disabled'} class="rounded-full px-4 py-2.5 text-sm hover:bg-paper disabled:opacity-30">← Înapoi</button>
    <button data-act="skip" class="rounded-full px-4 py-2.5 text-sm text-muted hover:bg-paper">${last ? 'Sari la export' : 'Sari peste'}</button>
    <button data-act="validate" class="ml-auto rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-2.5 font-medium">
      ✓ Validează ${last ? 'și mergi la export' : 'și continuă'} →</button>
  </div>`;
}

// ----- ③ Export
function exportHtml() {
  const busy = !!state.publishing;
  const b = busy ? [...state.publishing.keys()].map(id => state.products.find(p => p.id === id)).filter(Boolean) : batch();
  const ready = b.filter(isComplete), todo = b.length - ready.length;
  return `
  <div class="max-w-3xl">
    ${shopBanner()}
    <div class="rounded-2xl border border-line bg-paper p-4 mt-3">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="font-serif text-lg">${busy ? `Se trimit ${b.length} ${b.length === 1 ? 'produs' : 'produse'}…` : `${ready.length} ${ready.length === 1 ? 'produs gata' : 'produse gata'} de publicat`}</h3>
        <div class="ml-auto flex items-center gap-2 text-sm ${busy ? 'hidden' : ''}"><span class="text-muted">Toate ca:</span>
          <button data-all="draft" class="px-3 py-1 rounded-full border border-line hover:bg-cream">Draft</button>
          <button data-all="active" class="px-3 py-1 rounded-full border border-line hover:bg-cream">Activ</button></div>
      </div>
      <ul class="mt-3 divide-y divide-line">
        ${b.map((p, i) => {
          const img = productImages(p)[0], pr = productProblems(p);
          const price = p.has_variants ? `${(p.variants || []).filter(v => v.value?.trim()).length} variante` : `${fmtPrice(p.price)} lei`;
          return `<li data-pid="${p.id}" class="flex items-center gap-3 py-2.5">
            <span class="relative w-12 h-12 rounded-lg overflow-hidden bg-cream shrink-0">${img ? squarePreview(img) : ''}</span>
            <div class="min-w-0 flex-1">
              <p class="font-medium truncate">${esc(label(p, i))}</p>
              <p class="text-xs ${pr.length ? 'text-blush-dark' : 'text-muted'} truncate">${pr.length ? '⚠ lipsește ' + pr.join(', ') : `${price} · ${esc(p.collection || 'fără colecție')} · ${productImages(p).length} poze`}</p>
            </div>
            ${busy ? pubBadge(p) : pr.length ? `<button data-go="${i}" class="text-xs px-3 py-1.5 rounded-full bg-blush-soft text-blush-dark shrink-0">Completează</button>` : `
            <div class="inline-flex rounded-full border border-line overflow-hidden text-xs shrink-0">
              <button type="button" data-status="draft" class="px-2.5 py-1 ${p.status === 'draft' ? 'bg-ink text-white' : 'bg-paper hover:bg-cream'}">Draft</button>
              <button type="button" data-status="active" class="px-2.5 py-1 ${p.status === 'active' ? 'bg-moss text-white' : 'bg-paper hover:bg-cream'}">Activ</button>
            </div>`}
          </li>`;
        }).join('')}
      </ul>
      ${todo ? `<p class="text-xs text-muted mt-2">${todo} ${todo === 1 ? 'produs incomplet nu va fi inclus — rămâne' : 'produse incomplete nu vor fi incluse — rămân'} în lucru pentru data viitoare.</p>` : ''}
    </div>
    <div class="flex flex-wrap items-center gap-3 mt-5">
      <button data-step="fill" ${busy ? 'disabled' : ''} class="rounded-full px-4 py-2.5 text-sm hover:bg-paper disabled:opacity-30">← Înapoi la completare</button>
      <div class="ml-auto flex flex-col items-end gap-1.5">
        <button data-act="publish" ${ready.length && state.shop.ok && !busy ? '' : 'disabled'} class="rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-3 font-medium shadow-card disabled:opacity-40">
          ${busy ? '<span class="spin inline-block">◌</span> Se trimit în Shopify…' : `🚀 Publică în Shopify (${ready.length})`}</button>
        <button data-act="download" ${ready.length && !busy ? '' : 'disabled'} class="text-xs text-muted hover:text-ink underline disabled:opacity-40">sau descarcă CSV (${ready.length})</button>
      </div>
    </div>
  </div>`;
}

const IMPORT_STEPS = `
  <ol class="text-sm space-y-2 list-decimal pl-5">
    <li>În Shopify: <b>Produse → Importă</b> → alegi fișierul descărcat → <b>Încarcă și continuă</b> → <b>Importă produsele</b>.</li>
    <li>Template <b>template-tfs</b>: bifezi produsele noi → <b>Editare în bloc</b> → coloana <b>Template</b> → alegi template-tfs la primul și tragi în jos → <b>Salvează</b>.</li>
    <li>Dacă reimporți produse existente, bifează <b>„Suprascrie produsele cu același URL handle”</b>.</li>
  </ol>`;

function publishDoneHtml() {
  const res = state.lastPublish, ok = res.filter(r => r.ok), bad = res.filter(r => !r.ok);
  return `
  <div class="max-w-2xl mx-auto py-6">
    <div class="text-center">
      <div class="w-16 h-16 rounded-full ${bad.length ? 'bg-blush-dark' : 'bg-moss'} text-white text-3xl grid place-items-center mx-auto">${bad.length && !ok.length ? '!' : '✓'}</div>
      <h3 class="font-serif text-2xl mt-4">${ok.length} ${ok.length === 1 ? 'produs trimis' : 'produse trimise'} în Shopify</h3>
      ${bad.length ? `<p class="text-blush-dark text-sm mt-1">${bad.length} ${bad.length === 1 ? 'produs nu a putut fi trimis — a rămas' : 'produse nu au putut fi trimise — au rămas'} în lucru.</p>` : ''}
    </div>
    <ul class="mt-6 rounded-2xl border border-line bg-paper divide-y divide-line">
      ${res.map(r => {
        const img = productImages(r.p)[0];
        return `<li class="flex items-start gap-3 p-3">
          <span class="relative w-12 h-12 rounded-lg overflow-hidden bg-cream shrink-0">${img ? squarePreview(img) : ''}</span>
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">${esc(r.p.title || 'Produs')}</p>
            ${r.ok ? `<p class="text-xs text-moss">${r.created ? 'Creat' : 'Actualizat'} · ${r.p.status === 'active' ? 'Activ pe site' : 'Draft'}</p>
              ${r.warnings.map(w => `<p class="text-xs text-blush-dark mt-0.5">⚠ ${esc(w)}</p>`).join('')}`
              : `<p class="text-xs text-blush-dark">⚠ ${esc(r.error)}</p>`}
          </div>
          ${r.ok && r.adminUrl ? `<a href="${esc(r.adminUrl)}" target="_blank" rel="noopener" class="text-xs px-3 py-1.5 rounded-full border border-line hover:bg-cream shrink-0">Deschide în Shopify ↗</a>` : ''}
        </li>`;
      }).join('')}
    </ul>
    ${ok.some(r => r.p.status !== 'active') ? '<p class="text-xs text-muted mt-3 text-center">Produsele Draft nu apar pe site până nu le activezi în Shopify (sau le retrimiți ca Activ din 🕘 Exportate).</p>' : ''}
    <div class="flex flex-wrap justify-center gap-3 mt-6">
      ${bad.length ? '<button data-step="export" class="rounded-full border border-line px-5 py-3 text-sm hover:bg-paper">↻ Încearcă din nou</button>' : ''}
      <button data-act="new-batch" class="rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-3 font-medium shadow-card">＋ Produse noi</button>
    </div>
  </div>`;
}

function doneHtml() {
  if (state.lastPublish) return publishDoneHtml();
  const le = state.lastExport;
  return `
  <div class="max-w-2xl mx-auto text-center py-6">
    <div class="w-16 h-16 rounded-full bg-moss text-white text-3xl grid place-items-center mx-auto">✓</div>
    <h3 class="font-serif text-2xl mt-4">${le ? `${le.count} ${le.count === 1 ? 'produs exportat' : 'produse exportate'}` : 'Export gata'}</h3>
    ${le ? `<p class="text-muted text-sm mt-1">Fișierul <b>${esc(le.name)}</b> e în Descărcări.</p>` : ''}
    <div class="text-left rounded-2xl border border-line bg-paper p-5 mt-6">${IMPORT_STEPS}
      <p class="text-xs text-muted mt-3">Shopify descarcă singur pozele (poate dura câteva minute).</p></div>
    <div class="flex flex-wrap justify-center gap-3 mt-6">
      ${le ? '<button data-act="redownload" class="rounded-full border border-line px-5 py-3 text-sm hover:bg-paper">⬇ Descarcă din nou</button>' : ''}
      <button data-act="new-batch" class="rounded-full bg-moss hover:bg-moss-dark text-white px-6 py-3 font-medium shadow-card">＋ Produse noi</button>
    </div>
  </div>`;
}

function historyHtml() {
  const h = history(), nSel = h.filter(p => state.exportSel.has(p.id)).length;
  return `
  <div class="flex flex-wrap items-center gap-3 mb-4 max-w-3xl">
    <button data-act="new-batch" class="rounded-full px-4 py-2 text-sm border border-line hover:bg-paper">← Produse noi</button>
    <p class="text-sm text-muted">Produse exportate. Le poți modifica și exporta din nou.</p>
    <div class="ml-auto flex items-center gap-2">
      <button data-act="reexport" ${nSel ? '' : 'disabled'} class="rounded-full border border-line px-4 py-2.5 text-sm disabled:opacity-40">⬇ CSV (${nSel})</button>
      <button data-act="republish" ${nSel && state.shop.ok ? '' : 'disabled'} class="rounded-full bg-moss text-white px-5 py-2.5 text-sm font-medium disabled:opacity-40">🚀 Retrimite în Shopify (${nSel})</button>
    </div>
  </div>
  ${state.shop.checked && !state.shop.ok ? `<div class="max-w-3xl mb-4">${shopBanner()}</div>` : ''}
  <div class="space-y-4 max-w-3xl">
    ${h.length ? h.map(p => {
      const changed = new Date(p.updated_at) - new Date(p.exported_at) > 5000;
      return `<div class="flex items-center gap-2 text-xs text-muted -mb-3">
        <span>${p.shopify_id ? 'Trimis în Shopify' : 'Exportat CSV'} · ${fmtDate(p.exported_at)}</span>
        ${changed ? '<span class="px-2 py-0.5 rounded-full bg-blush-soft text-blush-dark">modificat după trimitere</span>' : ''}
        ${p.shopify_admin_url ? `<a href="${esc(p.shopify_admin_url)}" target="_blank" rel="noopener" class="ml-auto text-moss hover:underline">Deschide în Shopify ↗</a>` : ''}
      </div>${productCardHtml(p, { pick: true })}`;
    }).join('') : '<p class="text-muted text-sm">Nimic exportat încă.</p>'}
  </div>`;
}

// ---------------------------------------------------------------- evenimente
const body = $('#body');
const productOf = el => state.products.find(p => p.id === el.closest('[data-pid]')?.dataset.pid);
const selectedTray = () => tray().filter(a => state.traySel.has(a.id)).map(a => a.id);

$('#steps').addEventListener('click', async e => {
  const b = e.target.closest('[data-step]');
  if (!b || b.disabled) return;
  await flushSave(batch()[state.idx]);
  go(b.dataset.step);
});

body.addEventListener('click', async e => {
  const t = e.target;
  const stepBtn = t.closest('[data-step]');
  if (stepBtn) return go(stepBtn.dataset.step);
  const goBtn = t.closest('[data-go]');
  if (goBtn) { await flushSave(batch()[state.idx]); return go('fill', Number(goBtn.dataset.go)); }

  const act = t.closest('[data-act]')?.dataset.act;
  const p = productOf(t);
  switch (act) {
    case 'pick': return $('#file-input').click();
    case 'auto': return autoGroup();
    case 'clear-errors': state.uploads = []; return render();
    case 'new': { if (await createProduct(selectedTray())) render(); return; }
    case 'del-photos': return deletePhotos(selectedTray());
    case 'del-product': return p && deleteProduct(p);
    case 'unlink': {
      const id = t.closest('[data-aid]').dataset.aid;
      await assign([id], null);
      if (p) await reorder(p, productImages(p).map(a => a.id));
      return render();
    }
    case 'prev': case 'skip': case 'validate': {
      const cur = batch()[state.idx];
      await flushSave(cur);
      if (act === 'prev') return go('fill', state.idx - 1);
      if (act === 'validate') {
        const pr = productProblems(cur);
        if (pr.length) { state.problems = pr; render(); markMissing(cur); return; }
      }
      return state.idx >= batch().length - 1 ? go('export') : go('fill', state.idx + 1);
    }
    case 'download': {
      const r = await doExport(batch().filter(isComplete), t.closest('[data-act]'));
      if (r) { state.lastExport = r; state.lastPublish = null; go('done'); }
      return;
    }
    case 'publish': return publishItems(batch().filter(isComplete));
    case 'republish': {
      const items = history().filter(x => state.exportSel.has(x.id));
      state.exportSel.clear();
      return publishItems(items);
    }
    case 'shop-retry': await checkShopify(true); return render();
    case 'redownload': return state.lastExport && saveBlob(state.lastExport.blob, state.lastExport.name);
    case 'new-batch': state.traySel.clear(); state.exportSel.clear(); state.lastPublish = null; state.lastExport = null; return go('group');
    case 'reexport': {
      const r = await doExport(history().filter(x => state.exportSel.has(x.id)), t.closest('[data-act]'));
      if (r) { state.exportSel.clear(); state.lastExport = r; state.lastPublish = null; go('done'); }
      return;
    }
    case 'add-variant': queueSave(p, { variants: [...(p.variants || []), { value: '', price: null, compare_at_price: null }] }); return render();
    case 'del-variant': {
      const i = Number(t.closest('.var').dataset.i);
      queueSave(p, { variants: (p.variants || []).filter((_, j) => j !== i) });
      return render();
    }
    case 'colors-auto': queueSave(p, { colors_manual: false, colors: [] }); return render();
  }

  const all = t.closest('[data-all]')?.dataset.all;
  if (all) { batch().filter(isComplete).forEach(x => queueSave(x, { status: all })); return render(); }

  const trayItem = t.closest('.tray-item');
  if (trayItem) {
    const id = trayItem.dataset.aid;
    state.traySel.has(id) ? state.traySel.delete(id) : state.traySel.add(id);
    return render();
  }
  if (!p) return;
  const st = t.closest('[data-status]')?.dataset.status;
  if (st) { queueSave(p, { status: st }); return render(); }
  const color = t.closest('[data-color]')?.dataset.color;
  if (color) {
    let c = [...productColors(p)];
    if (color === 'multicolor') c = c.includes('multicolor') ? [] : ['multicolor'];
    else { c = c.filter(x => x !== 'multicolor'); c = c.includes(color) ? c.filter(x => x !== color) : [...c, color]; }
    queueSave(p, { colors: c, colors_manual: true });
    return render();
  }
  const img = t.closest('.p-img');
  if (img) { const a = state.assets.find(x => x.id === img.dataset.aid); if (a) openCropEditor(a); }
});

body.addEventListener('input', e => {
  const p = productOf(e.target); if (!p) return;
  if (state.problems) { state.problems = null; $('#problems')?.remove(); }
  e.target.classList.remove('ring-2', 'ring-blush-dark');
  const k = e.target.dataset.k, vk = e.target.dataset.v;
  if (k && e.target.value === '__other') {
    e.target.value = p[k] || '';
    ask({
      title: k === 'collection' ? 'Altă colecție' : 'Alt tip de produs', ok: 'Folosește',
      body: `<input class="w-full rounded-lg border border-line px-3 py-2" placeholder="Exact ca în Shopify" />
        <p class="text-xs text-muted mt-2">Scrie numele exact ca în Shopify.${k === 'collection' ? ' O colecție care nu există va fi creată la import.' : ''}</p>`,
      onOpen: b => setTimeout(() => $('input', b).focus(), 50),
      collect: b => $('input', b).value.trim(),
    }).then(v => { if (v) { queueSave(p, { [k]: v }); render(); } });
    return;
  }
  if (k) {
    let val = e.target.value;
    if (k === 'price' || k === 'compare_at_price') val = val === '' ? null : Number(val);
    else if (k === 'handle') val = slugify(val) || null;
    else if (k === 'collection' || k === 'product_type') val = val || null;
    queueSave(p, { [k]: val });
    if (k === 'product_type') { const h = e.target.parentElement.querySelector('.cat-hint'); if (h) h.textContent = 'Categorie Shopify: ' + shopifyCategory(val).label; }
  } else if (vk) {
    const i = Number(e.target.closest('.var').dataset.i);
    const variants = [...(p.variants || [])];
    variants[i] = { ...variants[i], [vk]: vk === 'value' ? e.target.value : (e.target.value === '' ? null : Number(e.target.value)) };
    queueSave(p, { variants });
  }
});

body.addEventListener('change', async e => {
  if (e.target.id === 'add-to') {
    if (e.target.value) { await assign(selectedTray(), e.target.value); render(); }
    return;
  }
  const p = productOf(e.target); if (!p) return;
  const act = e.target.dataset.act;
  if (e.target.dataset.k === 'title' && !p.exported_at && p.title.trim()) {
    const handle = await uniqueHandle(p.title, p.id);
    queueSave(p, { handle });
    const h = $(`[data-pid="${p.id}"] [data-k="handle"]`); if (h) h.value = handle;
    $('#steps').innerHTML = stepsHtml();
  }
  if (act === 'pick-export') { e.target.checked ? state.exportSel.add(p.id) : state.exportSel.delete(p.id); render(); }
  if (act === 'has-variants') {
    const on = e.target.checked;
    const variants = on && !(p.variants || []).length
      ? DEFAULT_VARIANTS.map((value, i) => ({ value, price: i === 0 ? (p.price ?? null) : null, compare_at_price: null }))
      : p.variants;
    queueSave(p, { has_variants: on, variants });
    render();
  }
});

// drag & drop: din listă pe produs, între produse, reordonare
body.addEventListener('dragstart', e => {
  const el = e.target.closest('[data-aid]'); if (!el) return;
  const id = el.dataset.aid;
  const ids = el.classList.contains('tray-item') && state.traySel.has(id) ? selectedTray() : [id];
  e.dataTransfer.setData('text/x-tfs-assets', JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'move';
});
body.addEventListener('dragover', e => {
  if (![...e.dataTransfer.types].includes('text/x-tfs-assets')) return;
  const strip = e.target.closest('.strip'); if (!strip) return;
  e.preventDefault();
  $$('.strip', body).forEach(s => s.classList.toggle('border-moss', s === strip));
});
body.addEventListener('dragleave', e => { if (!e.relatedTarget || !body.contains(e.relatedTarget)) $$('.strip', body).forEach(s => s.classList.remove('border-moss')); });
body.addEventListener('drop', async e => {
  const strip = e.target.closest('.strip');
  if (!strip || ![...e.dataTransfer.types].includes('text/x-tfs-assets')) return;
  e.preventDefault(); e.stopPropagation();
  $$('.strip', body).forEach(s => s.classList.remove('border-moss'));
  const ids = JSON.parse(e.dataTransfer.getData('text/x-tfs-assets') || '[]');
  const p = productOf(strip); if (!p || !ids.length) return;
  const before = e.target.closest('.p-img')?.dataset.aid;
  const moving = ids.filter(id => state.assets.find(a => a.id === id)?.product_id !== p.id);
  if (moving.length) {
    const olds = new Set(moving.map(id => state.assets.find(a => a.id === id)?.product_id).filter(Boolean));
    await assign(moving, p.id);
    for (const oid of olds) { const op = state.products.find(x => x.id === oid); if (op) await reorder(op, productImages(op).map(a => a.id)); }
  }
  const order = productImages(p).map(a => a.id).filter(id => !ids.includes(id));
  const at = before && !ids.includes(before) ? order.indexOf(before) : order.length;
  order.splice(at < 0 ? order.length : at, 0, ...ids);
  await reorder(p, order);
  render();
});

/** Evidențiază câmpurile care lipsesc. */
function markMissing(p) {
  const card = $(`#body article[data-pid="${p.id}"]`); if (!card) return;
  const mark = sel => { const el = $(sel, card); if (el) el.classList.add('ring-2', 'ring-blush-dark'); return el; };
  const marked = [
    !p.title?.trim() && mark('[data-k="title"]'),
    !p.has_variants && isEmpty(p.price) && mark('[data-k="price"]'),
    ...(p.has_variants ? (p.variants || []).map((v, i) => v.value?.trim() && isEmpty(v.price) && mark(`.var[data-i="${i}"] [data-v="price"]`)) : []),
  ].filter(Boolean);
  (marked[0] || card).scrollIntoView({ behavior: 'smooth', block: 'center' });
  marked[0]?.focus?.();
}

// ---------------------------------------------------------------- export CSV
const COLUMNS = ['Title', 'URL handle', 'Description', 'Vendor', 'Product category', 'Type', 'Tags', 'Published on online store', 'Status',
  'Option1 name', 'Option1 value', 'Price', 'Compare-at price', 'Product image URL', 'Image position', 'Image alt text',
  'SEO title', 'SEO description', 'Collection'];
const csvCell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toHtml = t => (t || '').trim().split(/\n{2,}/).filter(Boolean).map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('');

/** Poza pătrată pentru Shopify (decupată după punctul de focus + zoom). Calea include decupajul, deci se refolosește. */
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
  dec.source.close?.();
  const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Export eșuat')), 'image/jpeg', 0.9));
  const { error } = await store().upload(`${dir}/${name}`, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
  if (error) throw error;
  return publicUrl(`${dir}/${name}`);
}

const productTags = p => {
  const colorLabels = state.extras ? productColors(p).map(c => colorById(c)?.label).filter(Boolean) : [];
  return [...new Set([...(p.tags || []), ...(p.collection ? [p.collection] : []), ...(p.flowers || []), ...colorLabels]
    .map(x => String(x).trim()).filter(Boolean))];
};
const productDescHtml = p => toHtml(p.description) + DESC_FOOTER.map(t => `<p>${esc(t)}</p>`).join('');
const productSeoDesc = p => p.seo_description || (p.description || '').replace(/\s+/g, ' ').trim().slice(0, 300);

function csvRows(p, squares) {
  const imgs = productImages(p);
  const tags = productTags(p);
  const variants = p.has_variants
    ? (p.variants || []).filter(v => v.value?.trim())
    : [{ value: 'Default Title', price: p.price, compare_at_price: p.compare_at_price }];
  const rows = [];
  for (let i = 0; i < Math.max(variants.length, imgs.length); i++) {
    const v = variants[i], img = imgs[i];
    const r = Object.fromEntries(COLUMNS.map(c => [c, '']));
    r['URL handle'] = p.handle;
    if (i === 0) Object.assign(r, {
      'Title': p.title.trim(),
      'Description': productDescHtml(p),
      'Vendor': p.vendor || VENDOR,
      'Product category': shopifyCategory(p.product_type).id,
      'Type': p.product_type || '',
      'Tags': tags.join(', '),
      'Published on online store': p.status === 'active' ? 'TRUE' : 'FALSE',
      'Status': p.status,
      'Option1 name': p.has_variants ? (p.option_name || 'Mărime') : 'Title',
      'SEO title': p.seo_title || p.title.trim(),
      'SEO description': productSeoDesc(p),
      'Collection': p.collection || '',
    });
    if (v) Object.assign(r, { 'Option1 value': v.value.trim(), 'Price': fmtPrice(v.price), 'Compare-at price': fmtPrice(v.compare_at_price) });
    if (img) Object.assign(r, { 'Product image URL': squares[img.id], 'Image position': i + 1, 'Image alt text': img.alt_text || p.title.trim() });
    rows.push(r);
  }
  return rows;
}

/** Link provizoriu (produs-xxxx) sau gol → îl refacem din nume înainte de trimitere. */
const isAutoHandle = h => !h || /^produs(-[a-z0-9]+)?(-\d+)?$/.test(h);
async function fixHandles(items) {
  for (const p of items) {
    if (p.title?.trim() && isAutoHandle(p.handle)) {
      p.handle = await uniqueHandle(p.title, p.id);
      clearTimeout(state.saveTimers.get(p.id)); state.saveTimers.delete(p.id);
      await saveProduct(p);
    }
  }
}

async function squaresFor(items, onStep) {
  const squares = {};
  const jobs = items.flatMap(p => productImages(p).map((a, i) => [p, a, i]));
  for (let k = 0; k < jobs.length; k++) {
    const [p, a, i] = jobs[k];
    onStep?.(k + 1, jobs.length, p);
    squares[a.id] = await ensureSquare(a, p.handle, i);
  }
  return squares;
}

async function doExport(items, btn) {
  items = items.filter(isComplete);
  if (!items.length) { toast('Nu e niciun produs complet de exportat.', 'err'); return null; }
  for (const p of items) await flushSave(p);
  await fixHandles(items);
  const btnLabel = btn?.textContent;
  let squares;
  try {
    if (btn) btn.disabled = true;
    squares = await squaresFor(items, (k, n) => { if (btn) btn.textContent = `Pregătesc pozele pătrate ${k}/${n}…`; });
  } catch (err) {
    console.error(err);
    if (btn) { btn.textContent = btnLabel; btn.disabled = false; }
    toast('Nu am putut pregăti pozele: ' + (err.message || err), 'err');
    return null;
  }
  const rows = items.flatMap(p => csvRows(p, squares));
  const csv = [COLUMNS.map(csvCell).join(','), ...rows.map(r => COLUMNS.map(c => csvCell(r[c])).join(','))].join('\r\n');
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


// ---------------------------------------------------------------- publicare directă în Shopify
const TEMPLATE_SUFFIX = CFG.SHOPIFY_TEMPLATE_SUFFIX ?? '';

/** Apelează funcția din Supabase; întoarce mereu un obiect { ok, error?, … }. */
async function callShopify(body) {
  try {
    const { data, error } = await sb.functions.invoke('shopify-publish', { body });
    if (error) {
      let msg = error.message || 'eroare';
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch {}
      if (/failed to send|not found|404|fetch/i.test(msg)) msg = 'Funcția „shopify-publish” nu răspunde. Verifică dacă e publicată în Supabase.';
      return { ok: false, error: msg };
    }
    return data ?? { ok: false, error: 'Răspuns gol de la server' };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function checkShopify(force = false) {
  if (state.shop.checked && !force) return state.shop;
  state.shop = { checked: true, ok: false, name: '', error: '', loading: true };
  const r = await callShopify({ action: 'status' });
  state.shop = r.ok
    ? { checked: true, ok: true, name: r.shop, domain: r.domain }
    : { checked: true, ok: false, error: r.error || (r.missingScopes?.length ? `Lipsesc permisiunile: ${r.missingScopes.join(', ')}` : 'Conexiune eșuată') };
  if (['export', 'history', 'done'].includes(state.step)) render();
  return state.shop;
}

function shopifyPayload(p, squares) {
  const num = v => isEmpty(v) ? null : Number(v);
  const variants = p.has_variants
    ? (p.variants || []).filter(v => v.value?.trim()).map(v => ({ value: v.value.trim(), price: num(v.price), compareAtPrice: num(v.compare_at_price) }))
    : [{ value: 'Default Title', price: num(p.price), compareAtPrice: num(p.compare_at_price) }];
  const images = productImages(p).map(a => ({ url: squares[a.id], alt: a.alt_text || p.title.trim() }));
  return {
    shopifyId: p.shopify_id || null,
    previousMediaKey: p.shopify_media_key || null,
    mediaKey: images.map(i => i.url).join('|'),
    title: p.title.trim(),
    handle: p.handle,
    descriptionHtml: productDescHtml(p),
    vendor: p.vendor || VENDOR,
    productType: p.product_type || '',
    category: shopifyCategory(p.product_type).id,
    tags: productTags(p),
    status: p.status,
    templateSuffix: TEMPLATE_SUFFIX,
    seoTitle: p.seo_title || p.title.trim(),
    seoDescription: productSeoDesc(p),
    collection: p.collection || null,
    optionName: p.has_variants ? (p.option_name || 'Mărime') : 'Title',
    variants,
    images,
  };
}

/** Trimite produsele pe rând. Cele reușite primesc exported_at; cele cu eroare rămân în lucru. */
async function publishItems(items) {
  items = items.filter(isComplete);
  if (!items.length) return toast('Nu e niciun produs complet de trimis.', 'err');
  state.publishing = new Map(items.map(p => [p.id, { status: 'wait', msg: 'în așteptare' }]));
  state.step = 'export';
  render();
  const results = [];
  for (const p of items) {
    const st = state.publishing.get(p.id);
    const show = () => { const el = $(`[data-pub="${p.id}"]`); if (el) el.outerHTML = pubBadge(p); };
    st.status = 'busy'; st.msg = 'pregătesc pozele…'; show();
    await flushSave(p);
    await fixHandles([p]);
    let squares;
    try {
      squares = await squaresFor([p], (k, n) => { st.msg = `pregătesc pozele ${k}/${n}…`; show(); });
    } catch (err) {
      Object.assign(st, { status: 'err', msg: 'pozele nu au putut fi pregătite' });
      results.push({ p, ok: false, error: err.message || String(err) }); show(); continue;
    }
    st.msg = p.shopify_id ? 'actualizez în Shopify…' : 'creez în Shopify…'; show();
    const r = await callShopify({ action: 'publish', product: shopifyPayload(p, squares) });
    if (!r.ok) {
      Object.assign(st, { status: 'err', msg: r.error });
      results.push({ p, ok: false, error: r.error }); show();
      if (/funcția|refuzat conectarea|lipsesc secretele|permisiuni/i.test(r.error || '')) {
        for (const q of items) { const s2 = state.publishing.get(q.id); if (s2.status === 'wait') Object.assign(s2, { status: 'err', msg: 'oprit — vezi eroarea de mai sus' }); }
        break;
      }
      continue;
    }
    const now = new Date().toISOString();
    const patch = { exported_at: now, shopify_id: r.shopifyId, shopify_admin_url: r.adminUrl, shopify_media_key: shopifyPayload(p, squares).mediaKey };
    let { data, error } = await sb.from('products').update(patch).eq('id', p.id).select().single();
    if (error && /shopify_/.test(error.message || '')) ({ data, error } = await sb.from('products').update({ exported_at: now }).eq('id', p.id).select().single());
    Object.assign(p, data || patch);
    Object.assign(st, { status: 'ok', msg: r.created ? 'creat' : 'actualizat' });
    results.push({ p, ok: true, created: r.created, adminUrl: r.adminUrl, warnings: r.warnings || [] });
    show();
  }
  state.publishing = null;
  state.lastPublish = results;
  state.lastExport = null;
  const ok = results.filter(x => x.ok).length;
  toast(`${ok} din ${results.length} ${results.length === 1 ? 'produs trimis' : 'produse trimise'} în Shopify`, ok === results.length ? 'ok' : 'err');
  go('done');
}

function pubBadge(p) {
  const st = state.publishing?.get(p.id);
  if (!st) return '';
  const cls = { wait: 'bg-line text-muted', busy: 'bg-blush-soft text-blush-dark', ok: 'bg-moss-soft text-moss', err: 'bg-blush-soft text-blush-dark' }[st.status];
  const icon = { wait: '·', busy: '<span class="spin inline-block">◌</span>', ok: '✓', err: '⚠' }[st.status];
  return `<span data-pub="${p.id}" class="text-xs px-2.5 py-1 rounded-full max-w-[220px] truncate shrink-0 ${cls}" title="${esc(st.msg)}">${icon} ${esc(st.msg)}</span>`;
}

function shopBanner() {
  const s = state.shop;
  if (!s.checked || s.loading) return '<div class="rounded-xl bg-cream px-4 py-3 text-sm text-muted"><span class="spin inline-block">◌</span> Verific conexiunea cu Shopify…</div>';
  if (s.ok) return `<div class="rounded-xl bg-moss-soft text-moss px-4 py-2.5 text-sm">✓ Conectat la <b>${esc(s.name)}</b></div>`;
  return `<div class="rounded-xl border border-blush bg-blush-soft text-blush-dark px-4 py-3 text-sm">
    <b>Shopify nu e conectat.</b> ${esc(s.error)}
    <button data-act="shop-retry" class="underline ml-1">Reîncearcă</button>
    <p class="text-xs mt-1 opacity-80">Până se rezolvă poți descărca CSV-ul și să-l imporți manual.</p></div>`;
}

initAuth();
