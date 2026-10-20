// =============================================================
//  The Flower Station · Blog SEO
//  Planul de articole → ciornă scrisă de AI → editezi → verificare SEO → publici în Shopify
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as CFG from './config.js';
import { decode, hasAlpha, makeMaster } from './images.js';

const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const AUTHOR = CFG.BLOG_AUTHOR ?? 'The Flower Station';
const BASE_THEMES = CFG.BLOG_THEMES ?? ['Ocazii', 'Semnificații', 'Îngrijire', 'Local'];
/** Temele: cele din config.js + cele create de tine sau de AI pe articole. */
const themes = () => [...new Set([...BASE_THEMES, ...state.posts.map(p => p.theme).filter(Boolean)])];
const NEW_THEME = '__nou';
const themeOptions = cur => themes().map(t => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('') + `<option value="${NEW_THEME}">+ Temă nouă…</option>`;
async function askNewTheme() {
  const t = await ask({
    title: 'Temă nouă', ok: 'Adaugă',
    body: field('Numele temei', `<input name="t" maxlength="30" class="${inputCls}" placeholder="Ex: Nunți, Plante, Cadouri" />`),
    onOpen: b => $('[name=t]', b).focus(),
    collect: b => $('[name=t]', b).value.trim().replace(/\s+/g, ' '),
  });
  return t ? t[0].toUpperCase() + t.slice(1) : null;
}
const COLLECTIONS = CFG.SHOPIFY_COLLECTIONS ?? [];
const TEMPLATE = CFG.BLOG_TEMPLATE_SUFFIX ?? '';

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slugify = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
const publicUrl = p => p ? `${CFG.SUPABASE_URL}/storage/v1/object/public/${CFG.BUCKET}/${p}` : '';
const fmtDate = d => new Date(d).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const monthLabel = m => {
  const x = /^(\d{4})-(\d{2})$/.exec(m || '');
  const n = x && MONTHS[Number(x[2]) - 1];
  return n ? n[0].toUpperCase() + n.slice(1) + ' ' + x[1] : 'Fără lună';
};
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const nextMonths = n => { const d = new Date(); d.setDate(1); return Array.from({ length: n }, (_, i) => monthKey(new Date(d.getFullYear(), d.getMonth() + i, 1))); };
const kwWords = kw => norm(kw).split(/[^a-z0-9]+/).filter(w => w.length > 2);
const hasAllWords = (text, kw) => { const t = norm(text); const w = kwWords(kw); return w.length > 0 && w.every(x => t.includes(x)); };
const fmtLei = v => v === null || v === undefined ? '' : `${Number.isInteger(+v) ? +v : (+v).toFixed(2).replace('.', ',')} lei`;
const sizedImg = (url, w) => url && /cdn\.shopify\.com/.test(url) ? url + (url.includes('?') ? '&' : '?') + 'width=' + w : url;

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `max-w-sm rounded-xl px-4 py-3 text-sm shadow-card border ${
    type === 'err' ? 'bg-blush-soft border-blush text-blush-dark' : 'bg-ink text-white border-ink'}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  const t = type === 'err' ? 7000 : 3000;
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, t);
  setTimeout(() => el.remove(), t + 400);
}

function ask({ title, body = '', ok = 'OK', danger = false, collect = () => true, onOpen, hideOk = false }) {
  const dlg = $('#prompt-dialog');
  $('#prompt-title').textContent = title;
  $('#prompt-body').innerHTML = body;
  const okBtn = $('#prompt-ok');
  okBtn.textContent = ok;
  okBtn.hidden = hideOk;
  okBtn.className = `px-4 py-2 rounded-full text-sm text-white ${danger ? 'bg-blush-dark' : 'bg-moss'}`;
  dlg.returnValue = '';
  dlg.showModal();
  onOpen?.($('#prompt-body'), dlg);
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? collect($('#prompt-body')) : null), { once: true });
  });
}

async function callFn(name, body) {
  try {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message || 'eroare';
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch {}
      if (/failed to send|not found|404|fetch/i.test(msg)) msg = `Funcția „${name}” nu răspunde. Verifică dacă e publicată în Supabase.`;
      return { ok: false, error: msg };
    }
    return data ?? { ok: false, error: 'Răspuns gol de la server' };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

const spinner = '<svg class="spin inline-block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.2-8.56" stroke-linecap="round"/></svg>';
const sparkle = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/></svg>';

// ---------------------------------------------------------------- state
const state = {
  user: null,
  posts: [],
  missingTable: false,
  filter: 'Toate',
  view: 'plan',
  cur: null,
  catalog: null,       // { domain, blogs, collections } din Shopify
  catalogErr: '',
  assets: null,        // pozele de produs din aplicație (pentru poza principală)
  generating: false,
  publishing: false,
  thinkingIdeas: false,
  saveTimer: null,
  range: null,         // ultima poziție a cursorului în editor
};

// ---------------------------------------------------------------- auth
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  await onSession(session);
  sb.auth.onAuthStateChange((_e, s) => { if ((s?.user?.id ?? null) !== (state.user?.id ?? null)) onSession(s); });
}
async function onSession(session) {
  state.user = session?.user ?? null;
  $('#auth-view').hidden = !!state.user;
  $('#app-view').hidden = !state.user;
  if (!state.user) return;
  $('#user-btn').textContent = (state.user.email?.[0] || '?').toUpperCase();
  $('#user-email').textContent = state.user.email || '';
  await loadPosts();
  route();
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
async function loadPosts() {
  const { data, error } = await sb.from('blog_posts').select('*').order('created_at', { ascending: true });
  state.missingTable = !!error && /blog_posts|relation|schema cache|42P01|PGRST205/i.test(`${error.code} ${error.message}`);
  if (error && !state.missingTable) toast('Nu am putut încărca articolele.', 'err');
  state.posts = data || [];
  if (!state.missingTable) {
    const probe = await sb.from('blog_posts').select('scheduled_at').limit(1);
    state.canSchedule = !probe.error;
  }
  // articolele programate a căror oră a trecut sunt acum publicate
  for (const p of state.posts) if (p.status === 'scheduled' && p.scheduled_at && new Date(p.scheduled_at) <= new Date()) p.status = 'published';
}

const SAVE_FIELDS = ['title', 'keyword', 'theme', 'month', 'collection', 'status', 'notes', 'body_html', 'summary', 'handle',
  'seo_title', 'seo_description', 'products', 'link_collection', 'image_url', 'image_alt', 'publish_live', 'blog_id',
  'shopify_article_id', 'shopify_admin_url', 'shopify_url', 'shopify_image_key', 'published_at'];
const saveFields = () => state.canSchedule ? [...SAVE_FIELDS, 'scheduled_at'] : SAVE_FIELDS;

async function savePost(p) {
  const row = Object.fromEntries(saveFields().map(k => [k, p[k] ?? null]));
  for (const k of ['title', 'keyword', 'body_html', 'summary', 'handle', 'seo_title', 'seo_description', 'image_alt']) row[k] ??= '';
  row.products ??= [];
  row.publish_live = !!row.publish_live;
  row.theme ||= BASE_THEMES[0];
  row.status ||= 'idea';
  const { data, error } = await sb.from('blog_posts').update(row).eq('id', p.id).select().single();
  if (error) { setSaveState('Nu s-a salvat', true); toast('Nu am putut salva articolul.', 'err'); return false; }
  if (data) p.updated_at = data.updated_at;
  setSaveState('Salvat');
  return true;
}
function queueSave() {
  setSaveState('Se salvează…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    state.saveTimer = null; syncBody();
    const p = state.cur;
    if (await savePost(p) && p.shopify_article_id && state.cur === p && $('#pub-box') && !state.publishing) $('#pub-box').innerHTML = pubHtml();
  }, 800);
}
async function flushSave() {
  if (!state.cur) return;
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; syncBody(); await savePost(state.cur); }
}
function setSaveState(t, err = false) { const el = $('#save-state'); if (el) { el.textContent = t; el.className = `text-xs ${err ? 'text-blush-dark' : 'text-muted'}`; } }

async function createPost(fields) {
  const row = { title: '', keyword: '', theme: BASE_THEMES[0], status: 'idea', ...fields };
  const { data, error } = await sb.from('blog_posts').insert(row).select().single();
  if (error) { toast('Nu am putut adăuga articolul.', 'err'); return null; }
  state.posts.push(data);
  return data;
}

// ---------------------------------------------------------------- rutare
function route() {
  const m = location.hash.match(/^#post\/(.+)$/);
  const p = m && state.posts.find(x => x.id === m[1]);
  if (p) { state.view = 'edit'; state.cur = p; renderEditor(); }
  else if (location.hash === '#google') { state.view = 'google'; state.cur = null; renderGoogle(); }
  else { state.view = 'plan'; state.cur = null; renderPlan(); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', async () => { await flushSave(); route(); });

// ================================================================ PLANUL
const STATUS = {
  idea: { label: 'Idee', cls: 'bg-[#EFE9DF] text-[#4F4840]', action: 'Scrie →' },
  draft: { label: 'Ciornă', cls: 'bg-[#F8E7D2] text-[#7A4510]', action: 'Continuă →' },
  published: { label: 'Publicat', cls: 'bg-moss-soft text-moss-dark', action: 'Deschide →' },
  scheduled: { label: 'Programat', cls: 'bg-[#E3E8F4] text-[#2C3E6B]', action: 'Deschide →' },
};
const fmtWhen = d => new Date(d).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** valoare pentru <input type="datetime-local"> în ora locală */
const toLocalInput = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const modeOf = p => state.canSchedule && p.scheduled_at && (p.status !== 'published' || new Date(p.scheduled_at) > new Date()) ? 'scheduled' : p.publish_live ? 'live' : 'draft';
const statusOf = p => {
  const s = STATUS[p.status] || STATUS.idea;
  if (p.status === 'draft' && p.shopify_article_id) return { ...s, label: 'Draft în Shopify' };
  if (p.status === 'scheduled' && p.scheduled_at) return { ...s, label: `Programat · ${fmtWhen(p.scheduled_at)}` };
  return s;
};

function renderPlan() {
  const v = $('#view');
  if (state.missingTable) {
    v.innerHTML = `<div class="max-w-xl bg-paper border border-line rounded-2xl p-6">
      <h1 class="font-serif text-2xl mb-2">Mai e un pas</h1>
      <p class="text-sm text-muted">Tabelul pentru articole nu există încă. Rulează fișierul <b>supabase/migrare-09-blog.sql</b> în Supabase → SQL Editor, apoi reîncarcă pagina.</p></div>`;
    return;
  }
  const list = state.posts.filter(p => state.filter === 'Toate' || p.theme === state.filter);
  const groups = new Map();
  for (const p of [...list].sort((a, b) => (a.month || '9999').localeCompare(b.month || '9999'))) {
    const k = p.month || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const counts = { idea: 0, draft: 0, scheduled: 0, published: 0 };
  state.posts.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });

  v.innerHTML = `${tabsHtml('plan')}
  <div class="flex flex-wrap items-end gap-3 mb-5">
    <div class="flex-[1_1_380px]">
      <h1 class="font-serif text-3xl tracking-tight mb-1">Planul de articole</h1>
      <p class="text-sm text-muted max-w-2xl">Fiecare articol pornește de la o expresie pe care oamenii o caută pe Google. Articolele de sezon se publică cu 4–6 săptămâni înainte de ocazie.</p>
      <p class="text-xs text-muted mt-2">${counts.idea} idei · ${counts.draft} ciorne${counts.scheduled ? ` · ${counts.scheduled} programate` : ''} · ${counts.published} publicate</p>
    </div>
    <button data-act="new-idea" class="rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-medium hover:bg-cream">+ Idee nouă</button>
    <button data-act="ai-ideas" ${state.thinkingIdeas ? 'disabled' : ''} class="inline-flex items-center gap-2 rounded-full bg-moss hover:bg-moss-dark text-white px-4 py-2.5 text-sm font-medium disabled:opacity-60">
      ${state.thinkingIdeas ? spinner + ' Caut idei…' : sparkle + ' Propune 10 idei cu AI'}</button>
  </div>
  <div class="flex flex-wrap gap-2 mb-6" role="group" aria-label="Filtru temă">
    ${['Toate', ...themes()].map(t => `<button data-filter="${esc(t)}" aria-pressed="${state.filter === t}" class="rounded-full px-3.5 py-2 text-sm ${state.filter === t ? 'bg-ink text-white' : 'bg-paper border border-line hover:bg-cream'}">${esc(t)}</button>`).join('')}
  </div>
  ${groups.size ? [...groups].map(([m, rows]) => `
    <section class="mb-6">
      <h2 class="text-xs uppercase tracking-[.12em] text-muted font-semibold mb-2">${esc(monthLabel(m))}</h2>
      <div class="bg-paper border border-line rounded-2xl overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm">
          <thead><tr class="text-left text-xs text-muted">
            <th class="px-4 py-3 font-semibold w-[40%]">Articol</th><th class="px-3 py-3 font-semibold">Expresia căutată</th>
            <th class="px-3 py-3 font-semibold">Temă</th><th class="px-3 py-3 font-semibold">Duce spre</th>
            <th class="px-4 py-3 font-semibold text-right">Stare</th></tr></thead>
          <tbody>${rows.map(p => { const s = statusOf(p); return `
            <tr class="border-t border-line hover:bg-cream/60 cursor-pointer" data-open="${p.id}">
              <td class="px-4 py-3 font-medium">${esc(p.title) || '<span class="text-muted">(fără titlu)</span>'}</td>
              <td class="px-3 py-3 text-muted">${esc(p.keyword)}</td>
              <td class="px-3 py-3">${esc(p.theme)}</td>
              <td class="px-3 py-3 text-muted">${esc(p.collection || p.link_collection?.title || '')}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${s.cls}">${s.label}</span>
                <a href="#post/${p.id}" class="ml-2 font-semibold text-moss hover:underline">${s.action}</a>
                <button data-del="${p.id}" class="ml-1 w-8 h-8 rounded-full text-muted hover:text-blush-dark hover:bg-blush-soft" aria-label="Șterge articolul">×</button>
              </td></tr>`; }).join('')}</tbody>
        </table>
      </div>
    </section>`).join('') : `
    <div class="bg-paper border border-line rounded-2xl p-10 text-center">
      <p class="font-serif text-2xl mb-2">${state.posts.length ? 'Nimic la tema asta' : 'Planul e gol'}</p>
      <p class="text-sm text-muted">Adaugă o idee sau cere 10 idei de la AI. Fiecare devine un articol pe care îl scrii când vrei.</p>
    </div>`}`;
}

$('#view').addEventListener('click', async e => {
  if (state.view !== 'plan') return;
  const t = e.target;
  const f = t.closest('[data-filter]');
  if (f) { state.filter = f.dataset.filter; return renderPlan(); }
  const del = t.closest('[data-del]');
  if (del) { e.stopPropagation(); return deletePost(state.posts.find(p => p.id === del.dataset.del)); }
  if (t.closest('a')) return;
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'new-idea') return newIdea();
  if (act === 'ai-ideas') return aiIdeas();
  const row = t.closest('[data-open]');
  if (row) location.hash = `#post/${row.dataset.open}`;
});

const tabsHtml = cur => `<nav class="flex gap-1 mb-6 border-b border-line" aria-label="Blog">
  ${[['plan', '#plan', 'Planul de articole'], ['google', '#google', 'Rezultate Google']].map(([k, h, l]) =>
    `<a href="${h}" ${k === cur ? 'aria-current="page"' : ''} class="px-4 py-2.5 -mb-px text-sm border-b-2 ${k === cur ? 'border-ink text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'}">${l}</a>`).join('')}</nav>`;

// ================================================================ REZULTATE GOOGLE (Search Console)
const fmtN = n => Math.round(n || 0).toLocaleString('ro-RO');
const fmtPct = x => `${((x || 0) * 100).toFixed(1).replace('.', ',')}%`;
const fmtPos = x => x ? String(x).replace('.', ',') : '–';
const urlPath = u => { try { return new URL(u).pathname; } catch { return u; } };
const postForUrl = u => { const path = urlPath(u).replace(/\/$/, ''); return state.posts.find(p => p.handle && path.endsWith('/' + p.handle) && path.includes('/blogs/')); };
const titleFromUrl = u => { const h = urlPath(u).split('/').filter(Boolean).pop() || u; return h.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()); };

/** Ce poți face cu un articol, după cifre. */
function gscHint(r) {
  if (r.position && r.position > 7 && r.position <= 20 && r.impressions >= 20)
    return { cls: 'bg-[#F8E7D2] text-[#7A4510]', text: 'Aproape de prima pagină', tip: 'Apare pe pagina 1–2 din Google. Extinde articolul, adaugă poze și linkuri spre el din alte articole ca să urce.' };
  if (r.position && r.position <= 7 && r.impressions >= 100 && r.ctr < 0.02)
    return { cls: 'bg-blush-soft text-blush-dark', text: 'Titlu de îmbunătățit', tip: 'Mulți îl văd în Google, puțini dau click. Fă titlul și descrierea pentru Google mai atractive.' };
  if (r.prev && r.prev.clicks >= 5 && r.clicks < r.prev.clicks * 0.7)
    return { cls: 'bg-blush-soft text-blush-dark', text: 'În scădere', tip: 'Are mai puține click-uri decât în perioada anterioară. Merită actualizat.' };
  if (r.clicks >= 10 && (!r.prev || r.clicks >= r.prev.clicks))
    return { cls: 'bg-moss-soft text-moss-dark', text: 'Merge bine', tip: 'Adaugă linkuri spre el din articolele noi.' };
  return null;
}
const trend = (cur, prev, lowerIsBetter = false) => {
  if (!prev) return '';
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.05) return '';
  const good = lowerIsBetter ? d < 0 : d > 0;
  return `<span class="ml-1 text-xs ${good ? 'text-moss' : 'text-blush-dark'}">${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d * 100))}%</span>`;
};

async function renderGoogle() {
  const v = $('#view');
  const days = state.gscDays || 28;
  const g = state.gsc?.[days];
  const tiles = t => [['Click-uri', fmtN(t.clicks)], ['Afișări în Google', fmtN(t.impressions)], ['Rata de click', fmtPct(t.ctr)], ['Poziția medie', fmtPos(t.position)]]
    .map(([l, val]) => `<div class="bg-paper border border-line rounded-2xl p-4"><p class="text-xs text-muted mb-1">${l}</p><p class="font-serif text-2xl">${val}</p></div>`).join('');
  v.innerHTML = `${tabsHtml('google')}
  <div class="flex flex-wrap items-end gap-3 mb-5">
    <div class="flex-[1_1_380px]">
      <h1 class="font-serif text-3xl tracking-tight mb-1">Rezultate Google</h1>
      <p class="text-sm text-muted max-w-2xl">Cum apar articolele blogului în căutările Google: de câte ori au fost văzute, câte click-uri au primit și pe ce poziție apar. Datele vin din Google Search Console, cu 2–3 zile întârziere.</p>
    </div>
    <label class="text-sm">Perioada
      <select id="gsc-days" class="ml-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
        ${[[7, 'ultimele 7 zile'], [28, 'ultimele 28 de zile'], [90, 'ultimele 3 luni'], [180, 'ultimele 6 luni']].map(([d, l]) => `<option value="${d}" ${d === days ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
  </div>
  <div id="gsc-body">${g ? '' : `<p class="text-sm text-muted">${spinner} Aduc datele din Google…</p>`}</div>`;
  if (!g) {
    const r = await callFn('gsc', { action: 'pages', days });
    if (state.view !== 'google') return;
    if (!r.ok) {
      $('#gsc-body').innerHTML = `<div class="max-w-2xl bg-paper border border-line rounded-2xl p-6">
        <h2 class="font-serif text-xl mb-2">Search Console nu e conectat încă</h2>
        <p class="text-sm text-blush-dark mb-3">${esc(r.error || 'Eroare necunoscută')}</p>
        <p class="text-sm text-muted">După ce faci pașii de conectare, reîncarcă pagina.</p></div>`;
      return;
    }
    state.gsc = { ...(state.gsc || {}), [days]: r };
    return renderGoogle();
  }
  const rows = [...g.pages].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  const published = state.posts.filter(p => p.status === 'published' && p.handle);
  const missing = published.filter(p => !rows.some(r => postForUrl(r.url) === p));
  $('#gsc-body').innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">${tiles(g.total)}</div>
    ${rows.length ? `<div class="bg-paper border border-line rounded-2xl overflow-x-auto">
      <table class="w-full min-w-[820px] text-sm">
        <thead><tr class="text-left text-xs text-muted">
          <th class="px-4 py-3 font-semibold w-[42%]">Articol</th><th class="px-3 py-3 font-semibold text-right">Click-uri</th>
          <th class="px-3 py-3 font-semibold text-right">Afișări</th><th class="px-3 py-3 font-semibold text-right">Rata de click</th>
          <th class="px-3 py-3 font-semibold text-right">Poziția</th><th class="px-4 py-3 font-semibold">Ce poți face</th></tr></thead>
        <tbody>${rows.map((r, i) => { const p = postForUrl(r.url), h = gscHint(r); return `
          <tr class="border-t border-line hover:bg-cream/60 cursor-pointer" data-gsc="${i}">
            <td class="px-4 py-3"><span class="font-medium">${esc(p?.title || titleFromUrl(r.url))}</span>
              <span class="block text-xs text-muted truncate max-w-[420px]">${esc(urlPath(r.url))}</span></td>
            <td class="px-3 py-3 text-right whitespace-nowrap">${fmtN(r.clicks)}${trend(r.clicks, r.prev?.clicks)}</td>
            <td class="px-3 py-3 text-right whitespace-nowrap">${fmtN(r.impressions)}${trend(r.impressions, r.prev?.impressions)}</td>
            <td class="px-3 py-3 text-right">${fmtPct(r.ctr)}</td>
            <td class="px-3 py-3 text-right whitespace-nowrap">${fmtPos(r.position)}${trend(r.position, r.prev?.position, true)}</td>
            <td class="px-4 py-3">${h ? `<span class="px-2.5 py-1 rounded-full text-xs font-semibold ${h.cls}" title="${esc(h.tip)}">${h.text}</span>` : ''}</td>
          </tr>
          <tr hidden data-gsc-detail="${i}"><td colspan="6" class="px-4 pb-4"></td></tr>`; }).join('')}</tbody>
      </table></div>`
    : `<div class="bg-paper border border-line rounded-2xl p-8 text-center"><p class="font-serif text-xl mb-1">Încă nu sunt date pentru blog</p>
        <p class="text-sm text-muted">Google are nevoie de câteva zile sau săptămâni ca să găsească articolele noi. Revino după ce ai publicat câteva.</p></div>`}
    ${missing.length ? `<p class="text-xs text-muted mt-4">Fără date încă (prea noi sau negăsite de Google): ${missing.map(p => esc(p.title)).join(' · ')}</p>` : ''}
    <p class="text-xs text-muted mt-2">Perioada: ${esc(g.range.startDate)} – ${esc(g.range.endDate)}, comparat cu cele ${g.days} zile dinainte. Click pe un rând pentru căutările care îl aduc.</p>`;
}

function queriesHtml(d) {
  if (!d.queries?.length) return '<p class="text-sm text-muted py-2">Google nu arată încă după ce căutări apare (puține afișări).</p>';
  return `<div class="bg-cream rounded-xl p-3"><p class="text-xs text-muted mb-2">Căutările din Google care au afișat articolul</p>
    <table class="w-full text-sm"><thead><tr class="text-left text-xs text-muted"><th class="py-1 font-semibold">Căutare</th><th class="py-1 font-semibold text-right">Click-uri</th><th class="py-1 font-semibold text-right">Afișări</th><th class="py-1 font-semibold text-right">Poziția</th></tr></thead>
    <tbody>${d.queries.slice(0, 15).map(q => `<tr class="border-t border-line/70"><td class="py-1.5">${esc(q.query)}</td><td class="py-1.5 text-right">${fmtN(q.clicks)}</td><td class="py-1.5 text-right">${fmtN(q.impressions)}</td><td class="py-1.5 text-right">${fmtPos(q.position)}</td></tr>`).join('')}</tbody></table></div>`;
}

$('#view').addEventListener('change', e => {
  if (state.view !== 'google' || e.target.id !== 'gsc-days') return;
  state.gscDays = Number(e.target.value);
  renderGoogle();
});
$('#view').addEventListener('click', async e => {
  if (state.view !== 'google') return;
  const row = e.target.closest('[data-gsc]');
  if (!row) return;
  const i = row.dataset.gsc, det = $(`[data-gsc-detail="${i}"]`);
  if (!det.hidden) { det.hidden = true; return; }
  det.hidden = false;
  const g = state.gsc[state.gscDays || 28];
  const r = [...g.pages].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)[Number(i)];
  const p = postForUrl(r.url), h = gscHint(r);
  const cell = det.firstElementChild;
  const head = `${h ? `<p class="text-sm mb-2"><b>${h.text}:</b> ${esc(h.tip)}</p>` : ''}${p ? `<a href="#post/${p.id}" class="inline-block text-sm text-moss font-semibold hover:underline mb-2">Deschide articolul în editor →</a>` : ''}`;
  cell.innerHTML = head + `<p class="text-sm text-muted">${spinner} Aduc căutările…</p>`;
  r._q ??= await callFn('gsc', { action: 'page', url: r.url, days: state.gscDays || 28 });
  cell.innerHTML = head + (r._q.ok ? queriesHtml(r._q) : `<p class="text-sm text-blush-dark">${esc(r._q.error)}</p>`);
});

/** Panoul din editor: cum merge articolul în Google. */
async function loadPostGsc() {
  const p = state.cur, box = $('#gsc-box');
  if (!box) return;
  if (!p.shopify_url || p.status !== 'published') { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<h2 class="font-semibold mb-2">În Google (28 de zile)</h2><p class="text-sm text-muted">${spinner} Aduc datele…</p>`;
  let pageUrl = p.shopify_url;
  const all = state.gsc?.[28]?.pages?.find(r => postForUrl(r.url) === p);
  if (all) pageUrl = all.url;
  const r = await callFn('gsc', { action: 'page', url: pageUrl, days: 28 });
  if (state.cur !== p || !$('#gsc-box')) return;
  if (!r.ok) { box.innerHTML = `<h2 class="font-semibold mb-1">În Google</h2><p class="text-xs text-muted">${/GSC_|Search Console|cont de serviciu/i.test(r.error || '') ? 'Conectează Google Search Console ca să vezi aici cum merge articolul.' : esc(r.error)}</p>`; return; }
  const t = r.total || { clicks: 0, impressions: 0 };
  box.innerHTML = `<h2 class="font-semibold mb-3">În Google (28 de zile)</h2>
    <div class="grid grid-cols-2 gap-2 mb-3">
      <div class="rounded-xl bg-cream p-3"><p class="text-xs text-muted">Click-uri</p><p class="font-serif text-xl">${fmtN(t.clicks)}</p></div>
      <div class="rounded-xl bg-cream p-3"><p class="text-xs text-muted">Afișări</p><p class="font-serif text-xl">${fmtN(t.impressions)}</p></div>
      ${t.position ? `<div class="rounded-xl bg-cream p-3 col-span-2 flex justify-between text-sm"><span class="text-muted">Poziția medie</span><span class="font-semibold">${fmtPos(t.position)}</span></div>` : ''}
    </div>
    ${r.queries.length ? `<p class="text-xs text-muted mb-1">Căutările care îl aduc</p><ul class="text-sm space-y-1">${r.queries.slice(0, 6).map(q => `<li class="flex justify-between gap-2"><span class="truncate">${esc(q.query)}</span><span class="text-muted whitespace-nowrap">poz. ${fmtPos(q.position)}</span></li>`).join('')}</ul>`
      : '<p class="text-xs text-muted">Încă nu sunt date — Google are nevoie de câteva zile sau săptămâni pentru articolele noi.</p>'}`;
}

const field = (label, inner) => `<label class="block"><span class="text-sm font-medium">${label}</span>${inner}</label>`;
const inputCls = 'mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-moss/30';

async function newIdea() {
  const months = nextMonths(8);
  const r = await ask({
    title: 'Idee nouă de articol', ok: 'Adaugă',
    body: `<div class="space-y-3">
      ${field('Titlul propus', `<input name="title" class="${inputCls}" placeholder="Ex: Ce flori dăruiești de 8 Martie" />`)}
      ${field('Expresia căutată pe Google', `<input name="keyword" class="${inputCls}" placeholder="Ex: flori 8 martie" />`)}
      <div class="grid grid-cols-2 gap-3">
        ${field('Temă', `<select name="theme" class="${inputCls}">${themeOptions(BASE_THEMES[0])}</select>`)}
        ${field('Luna', `<select name="month" class="${inputCls}"><option value="">fără lună</option>${months.map(m => `<option value="${m}">${esc(monthLabel(m))}</option>`).join('')}</select>`)}
      </div>
      ${field('Duce spre (produse)', `<input name="collection" list="dl-col" class="${inputCls}" placeholder="Ex: Buchete flori" /><datalist id="dl-col">${COLLECTIONS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`)}
    </div>`,
    onOpen: b => $('[name=title]', b).focus(),
    collect: b => Object.fromEntries(['title', 'keyword', 'theme', 'month', 'collection'].map(k => [k, $(`[name=${k}]`, b).value.trim() || null])),
  });
  if (!r) return;
  if (r.theme === NEW_THEME) r.theme = (await askNewTheme()) || BASE_THEMES[0];
  if (!r.title && !r.keyword) return toast('Scrie măcar titlul sau expresia căutată.', 'err');
  if (await createPost({ ...r, title: r.title || '', keyword: r.keyword || '' })) { renderPlan(); toast('Ideea a fost adăugată în plan.'); }
}

async function aiIdeas() {
  state.thinkingIdeas = true; renderPlan();
  const months = nextMonths(6);
  const r = await callFn('blog-ai', { action: 'ideas', count: 10, months, themes: themes(), existing: state.posts.map(p => p.title || p.keyword).filter(Boolean) });
  state.thinkingIdeas = false; renderPlan();
  if (!r.ok) return toast(r.error || 'AI-ul nu a răspuns.', 'err');
  const ideas = (r.ideas || []).filter(i => i.title);
  if (!ideas.length) return toast('Nu am primit idei. Încearcă din nou.', 'err');
  const picked = await ask({
    title: `${ideas.length} idei propuse`, ok: 'Adaugă în plan',
    body: `<p class="text-sm text-muted mb-3">Debifează ce nu vrei. Le poți modifica oricând după aceea.</p>
      <div class="max-h-[55vh] overflow-y-auto space-y-2 pr-1">${ideas.map((i, n) => `
        <label class="flex gap-3 items-start p-3 rounded-xl border border-line hover:bg-cream cursor-pointer">
          <input type="checkbox" checked data-i="${n}" class="mt-1 w-4 h-4 accent-moss" />
          <span class="text-sm"><span class="font-medium block">${esc(i.title)}</span>
            <span class="text-muted">${esc(i.keyword)} · ${esc(i.theme)} · ${esc(monthLabel(i.month))}${i.collection ? ' · ' + esc(i.collection) : ''}</span></span>
        </label>`).join('')}</div>`,
    collect: b => $$('input[data-i]:checked', b).map(x => ideas[Number(x.dataset.i)]),
  });
  if (!picked?.length) return;
  for (const i of picked) {
    await createPost({ title: i.title, keyword: i.keyword, theme: (i.theme || '').trim().slice(0, 30) || BASE_THEMES[0], month: /^\d{4}-\d{2}$/.test(i.month) ? i.month : null, collection: i.collection || null });
  }
  renderPlan();
  toast(`${picked.length} ${picked.length === 1 ? 'idee adăugată' : 'idei adăugate'} în plan.`);
}

async function deletePost(p) {
  if (!p) return;
  const ok = await ask({
    title: 'Ștergi articolul?', ok: 'Șterge', danger: true,
    body: `<p class="text-sm text-muted">„${esc(p.title || p.keyword || 'fără titlu')}” se șterge din aplicație.${p.shopify_article_id ? ' <b class="text-ink">Pe blogul din Shopify rămâne</b>; dacă vrei să dispară și de acolo, îl ștergi din Shopify.' : ''}</p>`,
  });
  if (!ok) return;
  const { error } = await sb.from('blog_posts').delete().eq('id', p.id);
  if (error) return toast('Nu am putut șterge articolul.', 'err');
  state.posts = state.posts.filter(x => x.id !== p.id);
  if (state.view === 'edit') { state.cur = null; location.hash = '#plan'; } else renderPlan();
}

// ================================================================ EDITORUL
function productCard(p) {
  const url = `/products/${p.handle}`;
  return `<div class="tfs-produs" data-handle="${esc(p.handle)}" contenteditable="false" style="display:flex;gap:16px;align-items:center;padding:14px;border:1px solid #E9E2D8;border-radius:14px;margin:24px 0;">`
    + (p.image ? `<a href="${url}" style="flex:none;"><img src="${esc(sizedImg(p.image, 240))}" alt="${esc(p.title)}" width="96" height="96" style="width:96px;height:96px;object-fit:cover;border-radius:10px;display:block;margin:0;"></a>` : '')
    + `<div style="flex:1;min-width:0;"><p style="margin:0 0 4px;font-weight:600;"><a href="${url}" style="text-decoration:none;color:inherit;">${esc(p.title)}</a></p>`
    + (p.price ? `<p style="margin:0 0 10px;opacity:.75;">de la ${esc(fmtLei(p.price))}</p>` : '')
    + `<a href="${url}" style="display:inline-block;padding:8px 18px;border-radius:999px;background:#1F2A24;color:#ffffff;text-decoration:none;font-size:14px;">Vezi produsul</a></div></div>`;
}

const ALLOWED = new Set(['H2', 'H3', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I', 'A', 'BR', 'BLOCKQUOTE']);
/** Curăță HTML-ul primit de la AI: doar etichetele permise, fără stiluri sau scripturi. */
function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const walk = node => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 8) { if (!/^\s*(PRODUS:[a-z0-9-]+|POZA:[^>]*)\s*$/i.test(ch.data)) ch.remove(); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = ch.tagName;
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'FORM'].includes(tag)) { ch.remove(); continue; }
      walk(ch);
      if (tag === 'H1') { const h = doc.createElement('h2'); h.append(...ch.childNodes); ch.replaceWith(h); continue; }
      if (!ALLOWED.has(tag)) { ch.replaceWith(...ch.childNodes); continue; }
      for (const a of [...ch.attributes]) {
        const keep = tag === 'A' && a.name === 'href' && /^(https?:\/\/|\/)/i.test(a.value.trim());
        if (!keep) ch.removeAttribute(a.name);
      }
    }
  };
  const root = doc.body.firstChild;
  walk(root);
  return root.innerHTML;
}
const placeholderHtml = desc => `<div class="tfs-loc-poza" contenteditable="false" data-desc="${esc(desc)}">Aici merge o poză: ${esc(desc || 'alege una potrivită')}</div>`;
function injectProducts(html, products) {
  const byHandle = new Map((products || []).map(p => [p.handle, p]));
  const used = new Set();
  const rep = (_m, h) => { const p = byHandle.get(h); if (!p || used.has(h)) return ''; used.add(h); return productCard(p); };
  const spot = (_m, d) => placeholderHtml(d.trim());
  return html
    .replace(/<p>\s*<!--\s*PRODUS:([a-z0-9-]+)\s*-->\s*<\/p>/gi, rep)
    .replace(/<!--\s*PRODUS:([a-z0-9-]+)\s*-->/gi, rep)
    .replace(/<p>\s*<!--\s*POZA:([^>]*?)-->\s*<\/p>/gi, spot)
    .replace(/<!--\s*POZA:([^>]*?)-->/gi, spot);
}

/** HTML-ul curat al articolului, așa cum ajunge în Shopify. */
function cleanBody(forPublish = false) {
  const ed = $('#ed');
  if (!ed) return state.cur?.body_html ?? '';
  const c = ed.cloneNode(true);
  if (forPublish) $$('.tfs-loc-poza', c).forEach(x => x.remove());
  $$('[contenteditable]', c).forEach(x => x.removeAttribute('contenteditable'));
  $$('p', c).forEach(p => { if (!p.textContent.trim() && !p.querySelector('img')) p.remove(); });
  $$('figure', c).forEach(f => f.removeAttribute('contenteditable'));
  return c.innerHTML.trim();
}
function syncBody() {
  if (!state.cur || !$('#ed')) return;
  state.cur.body_html = cleanBody();
  if (state.cur.status === 'idea' && wordCount() >= 30) state.cur.status = 'draft';
}
function wordCount() {
  const ed = $('#ed');
  if (!ed) return 0;
  const c = ed.cloneNode(true);
  $$('.tfs-produs, .tfs-loc-poza, figure', c).forEach(x => x.remove());
  return (c.innerText || c.textContent || '').split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
}

// ---------------------------------------------------------------- verificarea SEO
function seoChecks() {
  const p = state.cur, ed = $('#ed');
  const kw = p.keyword || '';
  const seoT = (p.seo_title || p.title || '').trim(), seoD = (p.seo_description || '').trim();
  const firstP = ed ? [...ed.querySelectorAll('p')].find(x => !x.closest('.tfs-produs') && x.textContent.trim().length > 20) : null;
  const h2 = ed ? ed.querySelectorAll('h2').length : 0;
  const words = wordCount();
  const links = ed ? ed.querySelectorAll('.tfs-produs').length
    + [...ed.querySelectorAll('a[href*="/products/"], a[href*="/collections/"]')].filter(a => !a.closest('.tfs-produs')).length : 0;
  const lvl = (ok, warn) => ok ? 'ok' : warn ? 'warn' : 'bad';
  return [
    { s: !kw ? 'bad' : lvl(hasAllWords(p.title, kw)), label: 'Expresia în titlu', hint: !kw ? 'completează expresia căutată' : hasAllWords(p.title, kw) ? 'da' : `adaugă „${kw}” în titlu` },
    { s: lvl(seoT.length >= 45 && seoT.length <= 62, seoT.length >= 30 && seoT.length <= 70), label: 'Titlu pentru Google de 50–60 de caractere', hint: `${seoT.length} caractere` },
    { s: lvl(seoD.length >= 120 && seoD.length <= 158, seoD.length >= 70 && seoD.length <= 175), label: 'Descriere de 120–155 de caractere', hint: seoD ? `${seoD.length} caractere` : 'lipsește' },
    { s: !kw ? 'bad' : lvl(firstP && hasAllWords(firstP.textContent, kw), false), label: 'Expresia în primul paragraf', hint: firstP && kw && hasAllWords(firstP.textContent, kw) ? 'da' : 'pune expresia în prima frază' },
    { s: lvl(h2 >= 3, h2 >= 1), label: 'Cel puțin 3 subtitluri (H2)', hint: `${h2} ${h2 === 1 ? 'subtitlu' : 'subtitluri'}` },
    { s: lvl(words >= 800, words >= 500), label: 'Minim 800 de cuvinte', hint: `${words} cuvinte` },
    { s: lvl(links >= 1, false), label: 'Link spre produse sau colecții', hint: links ? `${links} ${links === 1 ? 'link' : 'linkuri'}` : 'adaugă un produs din magazin' },
    (() => { const imgs = ed ? [...ed.querySelectorAll('figure img')] : []; const noAlt = imgs.filter(i => !i.alt.trim()).length;
      return { s: lvl(imgs.length >= 2 && !noAlt, imgs.length >= 1), label: 'Cel puțin 2 poze în text', hint: imgs.length ? `${imgs.length} ${imgs.length === 1 ? 'poză' : 'poze'}${noAlt ? `, ${noAlt} fără text alternativ` : ''}` : (ed?.querySelector('.tfs-loc-poza') ? 'completează locurile marcate' : 'butonul „Poză” din bara editorului') }; })(),
    { s: lvl(p.image_url && p.image_alt?.trim(), p.image_url), label: 'Poză principală cu text alternativ', hint: !p.image_url ? 'alege poza' : p.image_alt?.trim() ? 'da' : 'scrie textul alternativ' },
    { s: lvl(p.handle && p.handle.length <= 60 && /^[a-z0-9-]+$/.test(p.handle), !!p.handle), label: 'Link scurt și curat', hint: p.handle ? `/${p.handle}` : 'se face din titlu' },
  ];
}

function seoHtml() {
  const C = seoChecks();
  const pts = C.reduce((s, c) => s + (c.s === 'ok' ? 1 : c.s === 'warn' ? 0.5 : 0), 0);
  const pct = Math.round(pts / C.length * 100);
  const col = pct >= 80 ? '#2F5D4A' : pct >= 50 ? '#C27A2C' : '#B4473A';
  const DOT = { ok: ['#2F5D4A', '✓'], warn: ['#C27A2C', '!'], bad: ['#B4473A', '×'] };
  const txt = pct >= 90 ? 'Foarte bine — gata de publicat.' : pct >= 70 ? 'Aproape gata.' : pct >= 40 ? 'Mai sunt câteva lucruri de completat.' : 'Abia începe. Generează ciorna sau scrie textul.';
  return `
    <div class="flex items-center gap-4 mb-4">
      <div class="w-16 h-16 rounded-full grid place-items-center shrink-0" style="background:conic-gradient(${col} ${pct}%,#EFE9DF 0)">
        <span class="w-[52px] h-[52px] rounded-full bg-paper grid place-items-center font-semibold">${pct}%</span></div>
      <div><h2 class="font-semibold">Verificare SEO</h2><p class="text-sm text-muted">${txt}</p></div>
    </div>
    <ul class="space-y-2.5">${C.map(c => `
      <li class="flex gap-2.5 items-start text-sm leading-snug">
        <span class="shrink-0 w-5 h-5 mt-px rounded-full grid place-items-center text-white text-xs font-bold" style="background:${DOT[c.s][0]}">${DOT[c.s][1]}</span>
        <span><span class="block">${esc(c.label)}</span><span class="block text-xs text-muted">${esc(c.hint)}</span></span></li>`).join('')}</ul>`;
}

function googleHtml() {
  const p = state.cur;
  const blog = state.catalog?.blogs?.find(b => b.id === p.blog_id);
  const host = (state.catalog?.domain || 'https://theflowerstation.ro').replace(/^https?:\/\//, '');
  return `
    <p class="text-xs text-[#4D5156] truncate">${esc(host)} › blogs › ${esc(blog?.handle || 'blog')} › ${esc(p.handle || '…')}</p>
    <p class="text-lg leading-snug text-[#1A0DAB] my-0.5">${esc((p.seo_title || p.title || 'Titlul articolului').slice(0, 70))}</p>
    <p class="text-[13px] leading-normal text-[#4D5156]">${esc((p.seo_description || 'Descrierea apare aici.').slice(0, 170))}</p>`;
}

function chipsHtml() {
  const prods = state.cur.products || [];
  return prods.map(p => `<span class="inline-flex items-center gap-1.5 rounded-full bg-moss-soft text-moss-dark text-xs pl-1 pr-2 py-1">
      ${p.image ? `<img src="${esc(sizedImg(p.image, 60))}" alt="" class="w-5 h-5 rounded-full object-cover" />` : ''}${esc(p.title)}
      <button type="button" data-unprod="${esc(p.handle)}" class="hover:text-ink" aria-label="Scoate ${esc(p.title)}">×</button></span>`).join('')
    + `<button type="button" data-act="find-prod" class="rounded-full border border-dashed border-[#B9B0A2] text-muted text-xs px-3 py-1.5 hover:bg-cream">+ caută în magazin</button>`;
}

function imgHtml() {
  const p = state.cur;
  return `
    <h2 class="font-semibold mb-3">Poza principală</h2>
    <div class="flex gap-3 items-start">
      <button type="button" data-act="pick-img" class="w-24 h-24 shrink-0 rounded-xl border border-line overflow-hidden grid place-items-center bg-cream text-xs text-muted hover:ring-2 hover:ring-moss/30">
        ${p.image_url ? `<img src="${esc(sizedImg(p.image_url, 200))}" alt="" class="w-full h-full object-cover" />` : 'Alege poza'}</button>
      <div class="flex-1 min-w-0">
        <label class="block text-xs font-medium mb-1" for="f-alt">Text alternativ (ce se vede în poză)</label>
        <textarea id="f-alt" rows="3" maxlength="140" class="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-moss/30">${esc(p.image_alt)}</textarea>
      </div>
    </div>`;
}

function pubHtml() {
  const p = state.cur, cat = state.catalog;
  if (state.catalogErr) return `<h2 class="font-semibold mb-2">Publicare</h2>
    <p class="text-sm text-blush-dark mb-3">${esc(state.catalogErr)}</p>
    <button data-act="retry-cat" class="rounded-full border border-line px-4 py-2 text-sm hover:bg-cream">Încearcă din nou</button>`;
  if (!cat) return `<h2 class="font-semibold mb-2">Publicare</h2><p class="text-sm text-muted">${spinner} Mă conectez la Shopify…</p>`;
  const changed = p.published_at && p.updated_at && new Date(p.updated_at) - new Date(p.published_at) > 5000;
  const mode = modeOf(p);
  const seg = on => `flex-1 min-h-[40px] rounded-full text-sm font-medium ${on ? 'bg-paper shadow-sm' : 'text-muted'}`;
  return `
    <h2 class="font-semibold mb-3">Publicare</h2>
    <label class="flex items-center justify-between gap-3 text-sm mb-3"><span class="text-muted">Blog</span>
      <select id="f-blog" class="rounded-lg border border-line px-2 py-1.5 text-sm max-w-[60%]">${cat.blogs.map(b => `<option value="${esc(b.id)}" ${b.id === p.blog_id ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>
    <div class="flex bg-[#F3EFE8] rounded-full p-1 mb-3" role="group" aria-label="Stare">
      <button type="button" data-mode="draft" aria-pressed="${mode === 'draft'}" class="${seg(mode === 'draft')}">Draft</button>
      <button type="button" data-mode="live" aria-pressed="${mode === 'live'}" class="${seg(mode === 'live')}">Publicat</button>
      ${state.canSchedule ? `<button type="button" data-mode="scheduled" aria-pressed="${mode === 'scheduled'}" class="${seg(mode === 'scheduled')}">Programat</button>` : ''}
    </div>
    ${mode === 'scheduled' ? `<label class="block mb-3"><span class="text-xs font-medium">Data și ora publicării</span>
      <input id="f-when" type="datetime-local" class="${inputCls}" min="${toLocalInput(Date.now() + 5 * 60e3)}" value="${p.scheduled_at ? toLocalInput(p.scheduled_at) : ''}" /></label>` : ''}
    <button data-act="publish" ${state.publishing ? 'disabled' : ''} class="w-full min-h-[48px] rounded-full bg-ink text-white font-semibold text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2">
      ${state.publishing ? spinner + ' Trimit în Shopify…' : { draft: p.shopify_article_id ? 'Actualizează draftul în Shopify' : 'Trimite ca draft în Shopify', live: p.shopify_article_id ? 'Actualizează pe blog' : 'Publică pe blog', scheduled: p.shopify_article_id ? 'Actualizează programarea' : 'Programează articolul' }[mode]}</button>
    <p class="text-xs text-muted mt-2">${{ draft: 'Articolul ajunge în Shopify ascuns; îl publici mai târziu.', live: 'Articolul apare imediat pe site.', scheduled: 'Articolul apare singur pe site la data și ora alese (ora României).' }[mode]}${!state.canSchedule ? ' Pentru programare rulează migrare-10-blog-programare.sql.' : ''}</p>
    ${p.shopify_article_id ? `<div class="mt-3 p-3 rounded-xl bg-moss-soft text-sm">
      <p class="text-moss-dark">${p.status === 'published' ? 'Publicat pe blog' : p.status === 'scheduled' ? `Programat pentru ${esc(fmtWhen(p.scheduled_at))}` : 'Draft în Shopify'} · trimis ${esc(fmtDate(p.published_at))}
        ${changed ? '<span class="ml-1 px-2 py-0.5 rounded-full bg-blush-soft text-blush-dark text-xs">modificat după trimitere</span>' : ''}</p>
      <p class="mt-1 flex flex-wrap gap-x-4"><a class="text-moss font-medium hover:underline" href="${esc(p.shopify_admin_url)}" target="_blank" rel="noopener">Deschide în Shopify ↗</a>
        ${p.status === 'published' && p.shopify_url ? `<a class="text-moss font-medium hover:underline" href="${esc(p.shopify_url)}" target="_blank" rel="noopener">Vezi pe site ↗</a>` : ''}</p></div>` : ''}`;
}

function collOptions() {
  const p = state.cur;
  // colecțiile din Shopify; până se încarcă (sau dacă Shopify nu răspunde) — lista din config.js
  const cols = state.catalog?.collections?.length ? state.catalog.collections : COLLECTIONS.map(t => ({ title: t, handle: slugify(t) }));
  const cur = p.link_collection?.handle || '';
  const opts = cols.map(c => `<option value="${esc(c.handle)}" ${c.handle === cur ? 'selected' : ''}>${esc(c.title)}</option>`).join('');
  return `<option value="">— niciuna —</option>${opts}${cur && !cols.some(c => c.handle === cur) ? `<option value="${esc(cur)}" selected>${esc(p.link_collection.title)}</option>` : ''}`;
}

function renderEditor() {
  const p = state.cur;
  if (!p.handle && p.title && !p.shopify_article_id) p.handle = slugify(p.title);
  p._prevTitle = p.title;
  const tb = (cmd, label, extra = '') => `<button type="button" data-cmd="${cmd}" class="min-w-[40px] min-h-[40px] px-2 rounded-lg hover:bg-cream text-sm ${extra}">${label}</button>`;
  $('#view').innerHTML = `
  <div class="flex flex-wrap items-center gap-3 mb-4">
    <a href="#plan" class="text-sm text-muted hover:text-ink">← Planul de articole</a>
    <span id="save-state" class="text-xs text-muted"></span>
    <button data-act="del-post" class="ml-auto text-sm text-muted hover:text-blush-dark">Șterge articolul</button>
  </div>
  <div class="flex flex-wrap gap-6 items-start">
    <div class="flex-[999_1_600px] min-w-0 space-y-4">
      <section class="bg-paper border border-line rounded-2xl p-5 space-y-4">
        <div class="grid sm:grid-cols-[1fr_auto_auto] gap-3">
          ${field('Expresia căutată pe Google', `<input id="f-keyword" class="${inputCls}" value="${esc(p.keyword)}" placeholder="Ex: flori aniversare" />`)}
          ${field('Temă', `<select id="f-theme" class="${inputCls}">${themeOptions(p.theme)}</select>`)}
          ${field('Luna', `<select id="f-month" class="${inputCls}"><option value="">fără lună</option>${[...new Set([...(p.month ? [p.month] : []), ...nextMonths(8)])].sort().map(m => `<option value="${m}" ${m === p.month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}</select>`)}
        </div>
        ${field('Titlul articolului', `<input id="f-title" class="${inputCls} !text-lg font-serif" value="${esc(p.title)}" placeholder="Ex: Flori de aniversare: cum alegi buchetul potrivit" />`)}
        <div class="grid sm:grid-cols-2 gap-4">
          <div><p class="text-sm font-medium mb-1.5">Produse de recomandat în articol</p><div id="prod-chips" class="flex flex-wrap gap-1.5">${chipsHtml()}</div></div>
          ${field('Colecția legată în text', `<select id="f-coll" class="${inputCls}">${collOptions()}</select>`)}
        </div>
        <details class="text-sm" ${p.notes ? 'open' : ''}><summary class="cursor-pointer text-muted">Indicații pentru AI (opțional)</summary>
          <textarea id="f-notes" rows="2" class="${inputCls}" placeholder="Ex: menționează că facem buchete și din flori de sezon; ton mai jucăuș">${esc(p.notes)}</textarea></details>
        <div class="flex flex-wrap items-center gap-3">
          <button data-act="generate" id="gen-btn" class="inline-flex items-center gap-2 rounded-full bg-moss hover:bg-moss-dark text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-60"></button>
          <p class="text-xs text-muted">AI-ul scrie prima variantă. O citești și o ajustezi înainte să publici.</p>
        </div>
      </section>

      <section class="bg-paper border border-line rounded-2xl">
        <div id="tb" class="sticky top-16 z-10 flex flex-wrap items-center gap-1 px-3 py-2 border-b border-line bg-[#FDFBF8] rounded-t-2xl" role="toolbar" aria-label="Formatare">
          ${tb('h2', 'H2', 'font-semibold')}${tb('h3', 'H3', 'font-semibold')}${tb('p', 'Text')}
          <span class="w-px h-6 bg-line mx-1"></span>
          ${tb('bold', 'B', 'font-bold')}${tb('italic', 'I', 'italic font-serif')}${tb('ul', '• Listă')}${tb('ol', '1. Listă')}${tb('link', 'Link')}
          <span class="w-px h-6 bg-line mx-1"></span>
          <button type="button" data-act="insert-img" class="min-h-[40px] px-3 rounded-lg border border-line bg-paper text-sm font-semibold hover:bg-cream">+ Poză</button>
          <button type="button" data-act="insert-prod" class="min-h-[40px] px-3 rounded-lg border border-moss/30 bg-moss-soft text-moss-dark text-sm font-semibold">+ Produs din magazin</button>
          <span id="words" class="ml-auto text-xs text-muted"></span>
        </div>
        <div id="ed" class="prose-ed px-6 sm:px-10 py-8" contenteditable="true" spellcheck="true" data-placeholder="Scrie aici articolul sau apasă „Generează ciornă”. Titlul de mai sus apare separat, ca titlu principal."></div>
      </section>
    </div>

    <aside class="flex-[1_1_340px] min-w-0 space-y-4">
      <section id="seo-box" class="bg-paper border border-line rounded-2xl p-5"></section>
      <section class="bg-paper border border-line rounded-2xl p-5 space-y-3">
        <h2 class="font-semibold">Cum apare în Google</h2>
        <div id="gprev" class="border border-line rounded-xl p-3 font-[Arial,sans-serif]"></div>
        <label class="block"><span class="flex justify-between text-xs font-medium"><span>Titlu pentru Google</span><span id="c-seot" class="text-muted"></span></span>
          <input id="f-seot" class="${inputCls}" value="${esc(p.seo_title)}" placeholder="dacă e gol, se folosește titlul" /></label>
        <label class="block"><span class="flex justify-between text-xs font-medium"><span>Descriere pentru Google</span><span id="c-seod" class="text-muted"></span></span>
          <textarea id="f-seod" rows="3" class="${inputCls}">${esc(p.seo_description)}</textarea></label>
        <label class="block"><span class="text-xs font-medium">Link</span>
          <input id="f-handle" class="${inputCls}" value="${esc(p.handle)}" placeholder="se face din titlu" /></label>
        <label class="block"><span class="text-xs font-medium">Rezumat (apare în lista de articole a blogului)</span>
          <textarea id="f-summary" rows="2" class="${inputCls}">${esc(p.summary)}</textarea></label>
      </section>
      <section id="gsc-box" class="bg-paper border border-line rounded-2xl p-5" hidden></section>
      <section id="img-box" class="bg-paper border border-line rounded-2xl p-5"></section>
      <section id="pub-box" class="bg-paper border border-line rounded-2xl p-5"></section>
    </aside>
  </div>`;
  $('#ed').innerHTML = p.body_html || '';
  $$('#ed .tfs-produs, #ed .tfs-loc-poza, #ed figure').forEach(x => x.setAttribute('contenteditable', 'false'));
  renderGenBtn();
  $('#img-box').innerHTML = imgHtml();
  updateSide();
  loadCatalog();
  loadPostGsc();
}

function renderGenBtn() {
  const b = $('#gen-btn');
  if (!b) return;
  b.disabled = state.generating;
  b.innerHTML = state.generating ? `${spinner} Scriu ciorna… (până la un minut)` : `${sparkle} ${wordCount() > 30 ? 'Generează din nou' : 'Generează ciornă'}`;
}

function updateSide() {
  if (state.view !== 'edit' || !state.cur) return;
  $('#seo-box').innerHTML = seoHtml();
  $('#gprev').innerHTML = googleHtml();
  $('#pub-box').innerHTML = pubHtml();
  const w = wordCount();
  $('#words').textContent = `${w} cuvinte · ${Math.max(1, Math.round(w / 220))} min de citit`;
  const st = (state.cur.seo_title || state.cur.title || '').length, sd = (state.cur.seo_description || '').length;
  $('#c-seot').textContent = `${st}/60`;
  $('#c-seod').textContent = `${sd}/155`;
}

async function loadCatalog(force = false) {
  if (state.catalog && !force) { ensureBlog(); return updateSide(); }
  state.catalogErr = '';
  updateSide();
  const r = await callFn('shopify-publish', { action: 'catalog' });
  if (!r.ok) {
    state.catalogErr = /permisiuni|access denied|scope/i.test(r.error || '')
      ? 'Aplicației Shopify îi lipsesc permisiunile pentru blog (write_content și read_content). Adaugă-le în Dev Dashboard → aplicația → versiune nouă, apoi acceptă actualizarea în magazin.'
      : (r.error || 'Nu m-am putut conecta la Shopify.');
  } else {
    state.catalog = { domain: r.domain, blogs: r.blogs || [], collections: r.collections || [] };
    if (r.blogsError) state.catalogErr = /permisiuni/.test(r.blogsError)
      ? 'Aplicației Shopify îi lipsesc permisiunile pentru blog (write_content și read_content). Adaugă-le în Dev Dashboard → aplicația → versiune nouă → Release, apoi acceptă actualizarea în magazin.'
      : r.blogsError;
    else if (!state.catalog.blogs.length) state.catalogErr = 'Magazinul nu are niciun blog. Creează unul în Shopify → Online Store → Blog posts → Manage blogs.';
  }
  if (state.view === 'edit') {
    ensureBlog();
    const sel = $('#f-coll'); if (sel && state.catalog?.collections?.length) sel.innerHTML = collOptions();
    updateSide();
  }
}
function ensureBlog() {
  const p = state.cur, blogs = state.catalog?.blogs || [];
  if (!p || !blogs.length || blogs.some(b => b.id === p.blog_id)) return;
  p.blog_id = (blogs.find(b => /ghid|blog|articol/i.test(b.title)) || blogs[0]).id;
  queueSave();
}

// ---------------------------------------------------------------- evenimente editor
const FIELD_MAP = { 'f-keyword': 'keyword', 'f-title': 'title', 'f-notes': 'notes', 'f-seot': 'seo_title', 'f-seod': 'seo_description', 'f-summary': 'summary', 'f-alt': 'image_alt' };

$('#view').addEventListener('input', e => {
  if (state.view !== 'edit') return;
  const p = state.cur, id = e.target.id;
  if (FIELD_MAP[id]) {
    p[FIELD_MAP[id]] = e.target.value;
    if (id === 'f-title' && !p.shopify_article_id && (!p.handle || p.handle === slugify(p._prevTitle || ''))) {
      p.handle = slugify(p.title); $('#f-handle').value = p.handle;
    }
    if (id === 'f-title') p._prevTitle = p.title;
  } else if (id === 'f-handle') {
    p.handle = slugify(e.target.value);
  } else if (e.target.closest('#ed')) {
    renderGenBtn();
  } else return;
  queueSave();
  updateSide();
});

$('#view').addEventListener('change', e => {
  if (state.view !== 'edit') return;
  const p = state.cur, id = e.target.id;
  if (id === 'f-theme') {
    if (e.target.value === NEW_THEME) {
      askNewTheme().then(t => { if (t) { p.theme = t; queueSave(); } e.target.innerHTML = themeOptions(p.theme); });
      return;
    }
    p.theme = e.target.value;
  }
  else if (id === 'f-month') p.month = e.target.value || null;
  else if (id === 'f-blog') p.blog_id = e.target.value;
  else if (id === 'f-when') p.scheduled_at = e.target.value ? new Date(e.target.value).toISOString() : null;
  else if (id === 'f-handle') { e.target.value = p.handle; }
  else if (id === 'f-coll') {
    const list = state.catalog?.collections?.length ? state.catalog.collections : COLLECTIONS.map(t => ({ title: t, handle: slugify(t) }));
    const c = list.find(x => x.handle === e.target.value);
    p.link_collection = c ? { title: c.title, handle: c.handle } : null;
  } else return;
  queueSave();
  updateSide();
});

// cursorul din editor, ca produsul să se insereze acolo unde ai rămas
document.addEventListener('selectionchange', () => {
  const ed = $('#ed'), sel = getSelection();
  if (ed && sel.rangeCount && ed.contains(sel.anchorNode)) state.range = sel.getRangeAt(0).cloneRange();
});
$('#view').addEventListener('mousedown', e => { if (e.target.closest('[data-cmd]')) e.preventDefault(); });
$('#view').addEventListener('paste', e => {
  if (!e.target.closest('#ed')) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

$('#view').addEventListener('click', async e => {
  if (state.view !== 'edit') return;
  const t = e.target, p = state.cur;
  const cmd = t.closest('[data-cmd]')?.dataset.cmd;
  if (cmd) return runCmd(cmd);
  const spotEl = t.closest('#ed .tfs-loc-poza');
  if (spotEl) { e.preventDefault(); return insertImage(spotEl); }
  const fig = t.closest('#ed figure');
  if (fig) { e.preventDefault(); return editFigure(fig); }
  const card = t.closest('#ed .tfs-produs');
  if (card) {
    e.preventDefault();
    const ok = await ask({ title: 'Scoți produsul din articol?', ok: 'Scoate', danger: true, body: '<p class="text-sm text-muted">Cardul dispare din text. Produsul rămâne în magazin.</p>' });
    if (ok) { card.remove(); queueSave(); updateSide(); }
    return;
  }
  if (t.closest('#ed a')) { e.preventDefault(); return; }
  const modeBtn = t.closest('[data-mode]');
  if (modeBtn) {
    const m = modeBtn.dataset.mode;
    p.publish_live = m !== 'draft';
    if (m === 'scheduled') p.scheduled_at = p.scheduled_at && new Date(p.scheduled_at) > new Date() ? p.scheduled_at : new Date(Date.now() + 864e5).toISOString().replace(/T.*/, 'T07:00:00.000Z');
    else p.scheduled_at = null;
    queueSave(); return updateSide();
  }
  const un = t.closest('[data-unprod]');
  if (un) { p.products = (p.products || []).filter(x => x.handle !== un.dataset.unprod); $('#prod-chips').innerHTML = chipsHtml(); return queueSave(); }
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'del-post') return deletePost(p);
  if (act === 'find-prod') { const pr = await findProduct('Produse de recomandat'); if (pr) addProduct(pr); return; }
  if (act === 'insert-prod') return insertProduct();
  if (act === 'insert-img') return insertImage();
  if (act === 'pick-img') return pickImage();
  if (act === 'generate') return generate();
  if (act === 'publish') return publish();
  if (act === 'retry-cat') return loadCatalog(true);
});

async function runCmd(cmd) {
  const ed = $('#ed');
  ed.focus();
  if (state.range && !ed.contains(getSelection().anchorNode)) { const s = getSelection(); s.removeAllRanges(); s.addRange(state.range); }
  if (cmd === 'h2' || cmd === 'h3' || cmd === 'p') document.execCommand('formatBlock', false, cmd.toUpperCase());
  else if (cmd === 'ul') document.execCommand('insertUnorderedList');
  else if (cmd === 'ol') document.execCommand('insertOrderedList');
  else if (cmd === 'bold' || cmd === 'italic') document.execCommand(cmd);
  else if (cmd === 'link') {
    const range = state.range;
    const sel = getSelection().toString();
    if (!sel) return toast('Selectează întâi textul pe care pui linkul.', 'err');
    const url = await ask({
      title: 'Adaugă link', ok: 'Pune linkul',
      body: `${field('Adresa', `<input name="url" class="${inputCls}" placeholder="/collections/buchete-flori sau https://…" />`)}
        <p class="text-xs text-muted mt-2">Pentru pagini din magazin scrie doar ce vine după domeniu, ex. /collections/plante. Lasă gol ca să scoți linkul.</p>`,
      onOpen: b => $('[name=url]', b).focus(),
      collect: b => $('[name=url]', b).value.trim(),
    });
    if (url === null) return;
    ed.focus();
    const s = getSelection(); s.removeAllRanges(); if (range) s.addRange(range);
    if (!url) document.execCommand('unlink');
    else if (/^(https?:\/\/|\/)/i.test(url)) document.execCommand('createLink', false, url);
    else document.execCommand('createLink', false, '/' + url.replace(/^\/+/, ''));
  }
  queueSave(); updateSide();
}

function addProduct(pr) {
  const p = state.cur;
  p.products = p.products || [];
  if (!p.products.some(x => x.handle === pr.handle)) p.products.push({ title: pr.title, handle: pr.handle, image: pr.image, price: pr.price });
  $('#prod-chips').innerHTML = chipsHtml();
  queueSave();
}

/** Dialog de căutare în produsele din Shopify. Întoarce produsul ales. */
async function findProduct(title) {
  let results = [], timer = null, chosen = null;
  const mine = state.cur.products || [];
  return ask({
    title, ok: 'Închide', hideOk: true,
    body: `<input name="q" class="${inputCls}" placeholder="Caută după nume: trandafiri, bujori, Mara…" autocomplete="off" />
      <div id="pr-res" class="mt-3 max-h-[50vh] overflow-y-auto space-y-1.5"></div>`,
    onOpen: (b, dlg) => {
      const box = $('#pr-res', b), input = $('[name=q]', b);
      const show = (list, note = '') => {
        box.innerHTML = (note ? `<p class="text-xs text-muted mb-1">${note}</p>` : '') + (list.length ? list.map((r, i) => `
          <button type="button" data-i="${i}" class="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-cream text-left">
            ${r.image ? `<img src="${esc(sizedImg(r.image, 96))}" alt="" class="w-12 h-12 rounded-lg object-cover" />` : '<span class="w-12 h-12 rounded-lg bg-cream"></span>'}
            <span class="flex-1 min-w-0"><span class="block text-sm font-medium truncate">${esc(r.title)}</span>
              <span class="block text-xs text-muted">${r.price ? 'de la ' + esc(fmtLei(r.price)) : ''}${r.status && r.status !== 'ACTIVE' ? ' · ' + esc(r.status === 'DRAFT' ? 'draft' : r.status.toLowerCase()) : ''}</span></span>
          </button>`).join('') : '<p class="text-sm text-muted p-2">Niciun produs găsit.</p>');
        results = list;
      };
      if (mine.length) show(mine, 'Produsele alese pentru articol'); else box.innerHTML = '<p class="text-sm text-muted p-2">Scrie numele produsului.</p>';
      const search = async () => {
        const q = input.value.trim();
        if (!q) { if (mine.length) show(mine, 'Produsele alese pentru articol'); return; }
        box.innerHTML = `<p class="text-sm text-muted p-2">${spinner} Caut…</p>`;
        const r = await callFn('shopify-publish', { action: 'products', q });
        if (input.value.trim() !== q) return;
        if (!r.ok) { box.innerHTML = `<p class="text-sm text-blush-dark p-2">${esc(r.error)}</p>`; return; }
        show(r.products || []);
      };
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 350); });
      box.addEventListener('click', e => {
        const b2 = e.target.closest('[data-i]');
        if (b2) { chosen = results[Number(b2.dataset.i)]; dlg.close('ok'); }
      });
      input.focus();
    },
    collect: () => chosen,
  });
}

async function insertProduct() {
  const range = state.range;
  const pr = await findProduct('Pune un produs în articol');
  if (!pr) return;
  addProduct(pr);
  state.range = range;
  placeAfterCursor(nodeFrom(productCard(pr)));
  queueSave(); updateSide();
  toast('Produsul a fost pus în articol.');
}

/** Încarcă o poză de pe calculator/telefon (inclusiv HEIC) în Supabase și întoarce adresa publică. */
async function uploadImage(file) {
  const dec = await decode(file);
  const alpha = hasAlpha(dec);
  const m = await makeMaster(file, dec, alpha);
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'poza';
  const path = `blog/${monthKey(new Date())}/${base}-${Math.random().toString(36).slice(2, 7)}.${m.ext}`;
  const { error } = await sb.storage.from(CFG.BUCKET).upload(path, m.blob, { contentType: m.mime, upsert: false });
  if (error) throw new Error('Nu am putut încărca poza.');
  return { url: publicUrl(path), label: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') };
}

/** Alegerea unei poze: din produsele articolului, din pozele aplicației sau încărcată acum. */
async function chooseImage({ title, removable = false }) {
  if (!state.assets) {
    const { data } = await sb.from('assets').select('id,title,thumb_path,master_path,created_at').order('created_at', { ascending: false }).limit(80);
    state.assets = data || [];
  }
  const fromProducts = (state.cur.products || []).filter(p => p.image).map(p => ({ thumb: sizedImg(p.image, 300), url: p.image, label: p.title }));
  const fromAssets = state.assets.filter(a => a.master_path).map(a => ({ thumb: publicUrl(a.thumb_path || a.master_path), url: publicUrl(a.master_path), label: a.title || '' }));
  const all = [...fromProducts, ...fromAssets];
  const tile = (x, i) => `<button type="button" data-i="${i}" class="aspect-square rounded-xl overflow-hidden border border-line hover:ring-2 hover:ring-moss/40" title="${esc(x.label)}"><img src="${esc(x.thumb)}" alt="${esc(x.label)}" loading="lazy" class="w-full h-full object-cover" /></button>`;
  let chosen = null;
  return ask({
    title, ok: 'Închide', hideOk: true,
    body: `<label class="flex items-center justify-center gap-2 w-full min-h-[48px] rounded-xl border-2 border-dashed border-moss/40 bg-moss-soft text-moss-dark text-sm font-semibold cursor-pointer hover:bg-moss-soft/70 mb-4">
        <input type="file" accept="image/*,.heic,.heif" class="sr-only" data-upload />
        <span data-up-label>⬆ Încarcă o poză de pe calculator sau telefon</span></label>
      <div class="max-h-[52vh] overflow-y-auto pr-1">
        ${fromProducts.length ? `<p class="text-xs text-muted mb-2">Din produsele alese pentru articol</p><div class="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">${fromProducts.map((x, i) => tile(x, i)).join('')}</div>` : ''}
        ${fromAssets.length ? `<p class="text-xs text-muted mb-2">Pozele încărcate în aplicație</p><div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${fromAssets.map((x, i) => tile(x, i + fromProducts.length)).join('')}</div>` : ''}
        ${!all.length ? '<p class="text-sm text-muted">Încă nu ai poze aici. Încarcă una sau alege un produs de recomandat (pozele lui apar aici).</p>' : ''}
        ${removable ? '<button type="button" data-none class="mt-4 text-sm text-blush-dark hover:underline">Scoate poza</button>' : ''}</div>`,
    onOpen: (b, dlg) => {
      b.addEventListener('click', e => {
        const t = e.target.closest('[data-i]');
        if (t) { chosen = all[Number(t.dataset.i)]; dlg.close('ok'); }
        if (e.target.closest('[data-none]')) { chosen = { url: null }; dlg.close('ok'); }
      });
      $('[data-upload]', b).addEventListener('change', async e => {
        const f = e.target.files?.[0];
        if (!f) return;
        const lab = $('[data-up-label]', b);
        lab.innerHTML = `${spinner} Încarc poza…`;
        try { chosen = await uploadImage(f); dlg.close('ok'); }
        catch (err) { lab.textContent = err.message || 'Nu am putut încărca poza.'; }
      });
    },
    collect: () => chosen,
  });
}

async function pickImage() {
  const r = await chooseImage({ title: 'Alege poza principală', removable: !!state.cur.image_url });
  if (!r) return;
  state.cur.image_url = r.url;
  if (r.url && !state.cur.image_alt?.trim() && r.label) state.cur.image_alt = r.label;
  $('#img-box').innerHTML = imgHtml();
  queueSave(); updateSide();
}

// ---------------------------------------------------------------- poze în text
function figureHtml({ url, alt, caption }) {
  return `<figure class="tfs-poza" contenteditable="false" style="margin:28px 0;">`
    + `<img src="${esc(sizedImg(url, 1600))}" alt="${esc(alt)}" loading="lazy" style="display:block;width:auto;max-width:100%;height:auto;max-height:720px;margin:0 auto;border-radius:12px;">`
    + (caption ? `<figcaption style="margin-top:8px;font-size:14px;opacity:.7;text-align:center;">${esc(caption)}</figcaption>` : '')
    + `</figure>`;
}
/** Text alternativ + legendă pentru o poză din text. */
async function askImageDetails({ alt = '', caption = '', editing = false }) {
  let removed = false;
  const r = await ask({
    title: editing ? 'Poza din text' : 'Detalii poză', ok: editing ? 'Salvează' : 'Pune în articol',
    body: `<div class="space-y-3">
      ${field('Text alternativ — ce se vede în poză (ajută la Google)', `<input name="alt" class="${inputCls}" maxlength="140" value="${esc(alt)}" placeholder="Ex: buchet de trandafiri roz în ambalaj kraft" />`)}
      ${field('Legendă sub poză (opțional)', `<input name="caption" class="${inputCls}" maxlength="160" value="${esc(caption)}" />`)}
      ${editing ? '<div class="flex gap-4 pt-1"><button type="button" data-swap class="text-sm text-moss hover:underline">Schimbă poza</button><button type="button" data-remove class="text-sm text-blush-dark hover:underline">Scoate poza</button></div>' : ''}</div>`,
    onOpen: (b, dlg) => {
      $('[name=alt]', b).focus();
      b.addEventListener('click', e => {
        if (e.target.closest('[data-remove]')) { removed = 'remove'; dlg.close('ok'); }
        if (e.target.closest('[data-swap]')) { removed = 'swap'; dlg.close('ok'); }
      });
    },
    collect: b => ({ alt: $('[name=alt]', b).value.trim(), caption: $('[name=caption]', b).value.trim(), action: removed }),
  });
  return r;
}
function placeAfterCursor(node) {
  const ed = $('#ed'), range = state.range;
  let block = range && ed.contains(range.startContainer) ? range.startContainer : null;
  while (block && block.parentNode !== ed) block = block.parentNode;
  if (block) block.after(node); else ed.appendChild(node);
  if (!node.nextSibling) { const p = document.createElement('p'); p.innerHTML = '<br>'; node.after(p); }
}
const nodeFrom = html => { const t = document.createElement('div'); t.innerHTML = html; return t.firstChild; };

async function insertImage(target = null) {
  const img = await chooseImage({ title: target ? 'Alege poza pentru acest loc' : 'Pune o poză în articol' });
  if (!img?.url) return;
  const d = await askImageDetails({ alt: target?.dataset.desc || img.label || '' });
  if (!d) return;
  const fig = nodeFrom(figureHtml({ url: img.url, alt: d.alt || state.cur.title, caption: d.caption }));
  if (target) target.replaceWith(fig); else placeAfterCursor(fig);
  queueSave(); updateSide();
}
async function editFigure(fig) {
  const img = fig.querySelector('img');
  const d = await askImageDetails({ alt: img?.alt || '', caption: fig.querySelector('figcaption')?.textContent || '', editing: true });
  if (!d) return;
  if (d.action === 'remove') { fig.remove(); }
  else if (d.action === 'swap') {
    const n = await chooseImage({ title: 'Alege altă poză' });
    if (n?.url) fig.replaceWith(nodeFrom(figureHtml({ url: n.url, alt: img?.alt || n.label || '', caption: fig.querySelector('figcaption')?.textContent || '' })));
  } else {
    fig.replaceWith(nodeFrom(figureHtml({ url: img.getAttribute('src'), alt: d.alt || state.cur.title, caption: d.caption })));
  }
  queueSave(); updateSide();
}

// ---------------------------------------------------------------- ciorna AI
async function generate() {
  const p = state.cur;
  if (!p.keyword?.trim()) { toast('Completează întâi expresia căutată pe Google.', 'err'); $('#f-keyword').focus(); return; }
  if (wordCount() > 30) {
    const ok = await ask({ title: 'Înlocuiești textul actual?', ok: 'Generează din nou', danger: true, body: '<p class="text-sm text-muted">Ciorna nouă înlocuiește textul, titlul și câmpurile SEO. Poza și produsele alese rămân.</p>' });
    if (!ok) return;
  }
  state.generating = true; renderGenBtn();
  await autoPick(p);
  const firstGen = p.status === 'idea' || wordCount() <= 30;
  const r = await callFn('blog-ai', { action: 'draft', post: { themes: themes(), keyword: p.keyword, title: p.title, theme: p.theme, notes: p.notes, products: p.products || [], collection: p.link_collection } });
  state.generating = false;
  if (state.cur !== p || state.view !== 'edit') return;
  if (!r.ok) { renderGenBtn(); return toast(r.error || 'AI-ul nu a răspuns.', 'err'); }
  Object.assign(p, {
    title: r.title || p.title,
    seo_title: r.seo_title || '',
    seo_description: r.seo_description || '',
    summary: r.summary || '',
    handle: p.shopify_article_id && p.handle ? p.handle : (slugify(r.handle || r.title) || p.handle),
    image_alt: p.image_alt?.trim() ? p.image_alt : (r.image_alt || ''),
    image_url: p.image_url || (p.products || []).find(x => x.image)?.image || null,
    body_html: injectProducts(sanitize(r.body_html || ''), p.products),
    status: p.status === 'published' ? 'published' : 'draft',
  });
  p._prevTitle = p.title;
  if (firstGen && r.theme?.trim() && r.theme.trim() !== p.theme) {
    p.theme = r.theme.trim().slice(0, 30);
    $('#f-theme').innerHTML = themeOptions(p.theme);
  }
  for (const [id, k] of Object.entries({ 'f-title': 'title', 'f-seot': 'seo_title', 'f-seod': 'seo_description', 'f-summary': 'summary', 'f-handle': 'handle' })) $('#' + id).value = p[k] || '';
  $('#ed').innerHTML = p.body_html;
  $('#img-box').innerHTML = imgHtml();
  renderGenBtn(); updateSide();
  clearTimeout(state.saveTimer); state.saveTimer = null;
  await savePost(p);
  const left = seoChecks().filter(c => c.s !== 'ok').map(c => c.label);
  toast(left.length ? `Ciorna e gata. Mai ai de completat: ${left.join(', ').toLowerCase()}.` : 'Ciorna e gata și bifează tot. Citește-o și ajustează ce vrei.');
}

/** Dacă n-ai ales produse sau colecție, le alege din magazin după expresia căutată (le poți schimba). */
async function autoPick(p) {
  const words = kwWords(p.keyword);
  if (!(p.products || []).length && words.length) {
    const r = await callFn('shopify-publish', { action: 'products', q: words.slice(0, 3).join(' ') });
    let list = r.ok ? (r.products || []).filter(x => x.status === 'ACTIVE') : [];
    if (!list.length && words.length > 1) {
      const r2 = await callFn('shopify-publish', { action: 'products', q: words[words.length - 1] });
      list = r2.ok ? (r2.products || []).filter(x => x.status === 'ACTIVE') : [];
    }
    list.slice(0, 2).forEach(addProduct);
    if (list.length) toast(`Am ales ${list.length === 1 ? 'un produs' : list.length + ' produse'} din magazin pentru articol. Le poți schimba.`);
  }
  if (!p.link_collection && state.catalog?.collections?.length && words.length) {
    const score = c => kwWords(c.title).filter(w => words.some(k => k.startsWith(w.slice(0, 5)) || w.startsWith(k.slice(0, 5)))).length;
    const best = [...state.catalog.collections].sort((a, b) => score(b) - score(a))[0];
    if (best && score(best) > 0) {
      p.link_collection = { title: best.title, handle: best.handle };
      const sel = $('#f-coll'); if (sel) sel.innerHTML = collOptions();
    }
  }
}

// ---------------------------------------------------------------- publicare
async function publish() {
  const p = state.cur;
  syncBody();
  if (!p.title?.trim()) return toast('Articolul nu are titlu.', 'err');
  if (wordCount() < 50) return toast('Articolul e aproape gol. Scrie sau generează textul întâi.', 'err');
  if (!p.blog_id) return toast('Alege blogul.', 'err');
  if (!p.handle) p.handle = slugify(p.title);
  const mode = modeOf(p);
  if (mode === 'scheduled') {
    if (!p.scheduled_at) return toast('Alege data și ora publicării.', 'err');
    if (new Date(p.scheduled_at) < new Date(Date.now() + 3 * 60e3)) return toast('Alege o dată din viitor (cel puțin peste câteva minute).', 'err');
  }
  if (p.publish_live) {
    const bad = seoChecks().filter(c => c.s === 'bad');
    if (bad.length) {
      const ok = await ask({
        title: 'Publici oricum?', ok: 'Publică',
        body: `<p class="text-sm text-muted mb-2">Verificarea SEO mai are puncte roșii:</p><ul class="text-sm list-disc pl-5">${bad.map(c => `<li>${esc(c.label)}</li>`).join('')}</ul>`,
      });
      if (!ok) return;
    }
  }
  const spots = $$('#ed .tfs-loc-poza').length;
  if (spots) {
    const ok = await ask({ title: `Mai ai ${spots} ${spots === 1 ? 'loc de poză necompletat' : 'locuri de poze necompletate'}`, ok: 'Trimite fără ele',
      body: '<p class="text-sm text-muted">Locurile marcate „Aici merge o poză” nu apar pe site — se scot la trimitere. Poți să le completezi acum (click pe ele) sau să trimiți așa.</p>' });
    if (!ok) return;
  }
  state.publishing = true; updateSide();
  clearTimeout(state.saveTimer); state.saveTimer = null;
  await savePost(p);
  const r = await callFn('shopify-publish', { action: 'article', article: {
    articleId: p.shopify_article_id, blogId: p.blog_id, title: p.title.trim(), handle: p.handle,
    bodyHtml: cleanBody(true), summaryHtml: p.summary?.trim() ? `<p>${esc(p.summary.trim())}</p>` : '',
    author: AUTHOR, tags: [p.theme].filter(Boolean), isPublished: !!p.publish_live,
    publishDate: mode === 'scheduled' ? p.scheduled_at : null,
    templateSuffix: TEMPLATE || null,
    seoTitle: p.seo_title || p.title, seoDescription: p.seo_description,
    image: p.image_url ? { url: p.image_url, alt: p.image_alt || p.title } : null,
    imageKey: p.image_url || null, previousImageKey: p.shopify_image_key || null,
  } });
  state.publishing = false;
  if (!r.ok) { updateSide(); return toast(r.error || 'Shopify a refuzat articolul.', 'err'); }
  Object.assign(p, {
    shopify_article_id: r.articleId, shopify_admin_url: r.adminUrl, shopify_url: r.storeUrl, handle: r.handle || p.handle,
    shopify_image_key: p.image_url || null, published_at: new Date().toISOString(),
    status: r.scheduled ? 'scheduled' : r.isPublished ? 'published' : 'draft',
  });
  if (r.scheduled && r.publishedAt) p.scheduled_at = r.publishedAt;
  if (!r.scheduled && mode === 'scheduled') p.scheduled_at = null;
  $('#f-handle').value = p.handle;
  await savePost(p);
  updateSide();
  toast(r.scheduled ? `Articolul e programat pentru ${fmtWhen(p.scheduled_at)}.` : r.isPublished ? (r.created ? 'Articolul e publicat pe blog.' : 'Articolul a fost actualizat pe blog.') : 'Articolul e în Shopify, ca draft.');
  for (const w of r.warnings || []) toast(w, 'err');
}

window.addEventListener('beforeunload', e => { if (state.saveTimer) { syncBody(); savePost(state.cur); e.preventDefault(); } });

initAuth();
