// =============================================================
//  TFS Fidelitate · cod comun pentru ecranul de la casă și panoul de administrare
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTION_URL } from './config.js';

// linkul din emailul de invitație sau de resetare: îl citim înainte ca Supabase să-l consume
const HASH = new URLSearchParams(location.hash.slice(1));
export const LINK_TYPE = HASH.get('type'); // invite | recovery | null

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const lei = n => `${Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} lei`;
export const zi = d => d ? new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const ziScurt = d => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const ora = d => d ? new Date(d).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const azi = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

/** Apel către funcția de server. Întoarce { ok, data } sau { ok:false, error, detaliu }. */
export async function api(action, body = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { ok: false, error: 'Intră din nou în cont.' };
  try {
    const r = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json().catch(() => ({ ok: false, error: 'Răspuns neașteptat de la server.' }));
    if (r.status === 401) { await sb.auth.signOut(); location.reload(); }
    return j;
  } catch {
    return { ok: false, error: 'Nu e conexiune la internet. Notează bonul pe hârtie și adaugă-l după.' };
  }
}

export function toast(msg, type = 'ok', ms = 3500) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none'; document.body.append(box); }
  const t = document.createElement('div');
  t.setAttribute('role', type === 'err' ? 'alert' : 'status');
  t.className = `pointer-events-auto max-w-md w-full px-4 py-3 text-sm font-medium shadow-lg ${type === 'err' ? 'bg-[#B4232A] text-white' : 'bg-ink text-white'}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Fereastră de confirmare simplă. Întoarce true/false. */
export function confirma({ titlu, text = '', da = 'Da', nu = 'Nu', pericol = false }) {
  return new Promise(res => {
    const d = document.createElement('dialog');
    d.className = 'p-0 w-[min(440px,92vw)] bg-paper text-ink backdrop:bg-black/40';
    d.innerHTML = `<div class="p-6"><h2 class="text-lg font-semibold mb-2">${esc(titlu)}</h2>${text ? `<p class="text-sm text-muted mb-5">${text}</p>` : ''}
      <div class="flex gap-2 justify-end"><button value="0" class="btn-ghost">${esc(nu)}</button><button value="1" class="${pericol ? 'btn-danger' : 'btn'}">${esc(da)}</button></div></div>`;
    document.body.append(d);
    d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { d.close(); res(b.value === '1'); } });
    d.addEventListener('close', () => { setTimeout(() => d.remove(), 0); res(false); });
    d.showModal();
  });
}

/**
 * Autentificarea: formular de login, setarea parolei din invitație / resetare.
 * onReady(staff) e chemat cu angajatul logat ({ id, name, role }).
 */
export async function initAuth(root, onReady, { titlu }) {
  const showLogin = (msg = '') => {
    root.innerHTML = `
    <div class="min-h-[80vh] grid place-items-center px-4"><form id="login" class="w-full max-w-sm bg-paper border border-line p-6 space-y-4">
      <p class="eyebrow">The Flower Station</p><h1 class="text-2xl font-semibold">${esc(titlu)}</h1>
      <label class="block"><span class="lbl">Email</span><input name="email" type="email" required autocomplete="username" class="inp"></label>
      <label class="block"><span class="lbl">Parola</span><input name="pass" type="password" required autocomplete="current-password" class="inp"></label>
      <p id="login-msg" class="text-sm ${msg ? 'text-[#B4232A]' : 'hidden'}">${esc(msg)}</p>
      <button class="btn w-full">Intră</button>
      <button type="button" id="forgot" class="text-sm underline text-muted">Am uitat parola</button>
    </form></div>`;
    $('#login').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, b = f.querySelector('.btn'); b.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.pass.value });
      b.disabled = false;
      if (error) { const m = $('#login-msg'); m.textContent = 'Email sau parolă greșită.'; m.className = 'text-sm text-[#B4232A]'; }
    });
    $('#forgot').addEventListener('click', async () => {
      const email = $('#login [name=email]').value.trim();
      if (!email) return toast('Scrie întâi emailul.', 'err');
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
      toast('Dacă adresa are cont, ai primit un link pe email.');
    });
  };

  const showSetPassword = () => {
    root.innerHTML = `
    <div class="min-h-[80vh] grid place-items-center px-4"><form id="setpass" class="w-full max-w-sm bg-paper border border-line p-6 space-y-4">
      <p class="eyebrow">The Flower Station</p><h1 class="text-2xl font-semibold">Alege parola</h1>
      <p class="text-sm text-muted">Minim 10 caractere. O folosești de fiecare dată când intri.</p>
      <input name="p1" type="password" minlength="10" required autocomplete="new-password" class="inp" placeholder="Parola nouă">
      <input name="p2" type="password" minlength="10" required autocomplete="new-password" class="inp" placeholder="Repetă parola">
      <button class="btn w-full">Salvează parola</button></form></div>`;
    $('#setpass').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (f.p1.value !== f.p2.value) return toast('Parolele nu sunt la fel.', 'err');
      const { error } = await sb.auth.updateUser({ password: f.p1.value });
      if (error) return toast('Nu am putut salva parola: ' + error.message, 'err');
      history.replaceState(null, '', location.pathname);
      toast('Parola a fost salvată.');
      start();
    });
  };

  let ready = false, busy = false, linkFolosit = false;
  const start = async () => {
    if (ready || busy) return;
    busy = true;
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return showLogin();
      if (!linkFolosit && (LINK_TYPE === 'invite' || LINK_TYPE === 'recovery')) { linkFolosit = true; return showSetPassword(); }
      const r = await api('me');
      if (!r.ok) { await sb.auth.signOut(); return showLogin(r.error || 'Contul nu are acces la program.'); }
      ready = true;
      onReady(r.data);
    } finally { busy = false; }
  };

  sb.auth.onAuthStateChange((ev) => {
    if (ev === 'PASSWORD_RECOVERY') { linkFolosit = true; return showSetPassword(); }
    if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') setTimeout(start, 0);
    if (ev === 'SIGNED_OUT') { ready = false; showLogin(); }
  });
}

export const logout = () => sb.auth.signOut();
