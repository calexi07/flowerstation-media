// =============================================================
//  Panoul de administrare: sumar, clienți, bonuri de aprobat, duplicate, echipă, jurnal, setări.
// =============================================================
import { $, $$, api, esc, lei, zi, ziScurt, ora, toast, confirma, initAuth, logout } from './fid.js';

const app = $('#app');
let eu = null;

const TABURI = [
  ['sumar', 'Sumar'], ['clienti', 'Clienți'], ['aprobare', 'De aprobat'], ['duplicate', 'Duplicate'],
  ['echipa', 'Echipa'], ['jurnal', 'Jurnal'], ['setari', 'Setări'],
];

initAuth(app, staff => {
  if (staff.role !== 'admin') { location.href = 'casa.html'; return; }
  eu = staff; cadru(); deschide(location.hash.slice(1) || 'sumar');
}, { titlu: 'Administrare · Fidelitate' });

function cadru() {
  app.innerHTML = `
  <header class="bg-ink text-white px-4 py-3 flex items-center gap-3">
    <div class="flex-1"><p class="text-[11px] uppercase tracking-[.14em] text-pink">The Flower Station</p><p class="h text-sm">Fidelitate · Administrare</p></div>
    <a href="casa.html" class="text-xs uppercase tracking-wider underline">Casa</a>
    <button id="iesi" class="text-xs uppercase tracking-wider underline">Ieși (${esc(eu.name)})</button>
  </header>
  <nav class="bg-paper border-b border-line overflow-x-auto"><div class="max-w-6xl mx-auto flex px-2" role="tablist">
    ${TABURI.map(([k, t]) => `<button class="tab" role="tab" data-tab="${k}">${t}<span class="ml-1 text-rose" data-badge="${k}"></span></button>`).join('')}
  </div></nav>
  <section id="pagina" class="max-w-6xl mx-auto p-4"></section>`;
  $('#iesi').onclick = logout;
  $$('[data-tab]').forEach(b => b.onclick = () => deschide(b.dataset.tab));
  window.addEventListener('hashchange', () => deschide(location.hash.slice(1) || 'sumar', false));
}

const P = () => $('#pagina');
const incarca = () => { P().innerHTML = '<p class="text-muted py-6">Se încarcă…</p>'; };
const eroare = r => { P().innerHTML = `<p class="text-[#B4232A] py-6">${esc(r.error)}</p>`; };

function deschide(tab, push = true) {
  if (!TABURI.some(([k]) => k === tab)) tab = 'sumar';
  if (push && location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ({ sumar, clienti, aprobare, duplicate, echipa, jurnal, setari })[tab]();
}

const descarca = (nume, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = nume; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/** Fereastră cu formular. campuri: [{ name, label, type, value, required, min, max, step, hint }] → obiect sau null */
function formular({ titlu, text = '', campuri, da = 'Salvează', pericol = false }) {
  return new Promise(res => {
    const d = document.createElement('dialog');
    d.className = 'p-0 w-[min(480px,94vw)] bg-paper text-ink';
    d.innerHTML = `<form method="dialog" class="p-6 space-y-4"><h2 class="text-lg font-semibold">${esc(titlu)}</h2>${text ? `<p class="text-sm text-muted">${text}</p>` : ''}
      ${campuri.map(c => c.type === 'select'
        ? `<label class="block"><span class="lbl">${esc(c.label)}</span><select name="${c.name}" class="inp">${c.options.map(([v, t]) => `<option value="${v}" ${v === c.value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`
        : c.type === 'checkbox'
        ? `<label class="flex gap-3 items-center"><input type="checkbox" name="${c.name}" class="chk" ${c.value ? 'checked' : ''}><span>${esc(c.label)}</span></label>`
        : `<label class="block"><span class="lbl">${esc(c.label)}</span><input name="${c.name}" class="inp" type="${c.type || 'text'}" value="${esc(c.value ?? '')}"
            ${c.required ? 'required' : ''} ${c.min != null ? `min="${c.min}"` : ''} ${c.max != null ? `max="${c.max}"` : ''} ${c.step ? `step="${c.step}"` : ''} autocomplete="off">
            ${c.hint ? `<span class="text-xs text-muted">${esc(c.hint)}</span>` : ''}</label>`).join('')}
      <div class="flex gap-2 justify-end pt-2"><button value="0" formnovalidate class="btn-ghost">Renunță</button><button value="1" class="${pericol ? 'btn-danger' : 'btn'}">${esc(da)}</button></div></form>`;
    document.body.append(d);
    const f = d.querySelector('form');
    d.addEventListener('close', () => {
      const ok = d.returnValue === '1';
      const out = ok ? Object.fromEntries(campuri.map(c => [c.name, c.type === 'checkbox' ? f[c.name].checked : f[c.name].value.trim()])) : null;
      d.remove(); res(out);
    });
    d.showModal();
  });
}

// ------------------------------------------------------------ sumar
async function sumar() {
  incarca();
  const r = await api('sumar');
  if (!r.ok) return eroare(r);
  const s = r.data;
  $('[data-badge=aprobare]').textContent = s.bonuri_de_aprobat ? `(${s.bonuri_de_aprobat})` : '';
  $('[data-badge=duplicate]').textContent = s.duplicate_deschise ? `(${s.duplicate_deschise})` : '';
  const k = (n, t, tab) => `<button ${tab ? `data-go="${tab}"` : 'disabled'} class="card p-5 text-left ${tab ? 'hover:border-ink' : ''}"><p class="text-3xl font-semibold">${n}</p><p class="eyebrow mt-1">${t}</p></button>`;
  P().innerHTML = `
    ${s.bonuri_de_aprobat || s.duplicate_deschise || s.outbox_esuat ? `<div class="card p-4 mb-4 border-rose space-y-1">
      ${s.bonuri_de_aprobat ? `<p>⚠️ <button data-go="aprobare" class="underline">${s.bonuri_de_aprobat} bon(uri) așteaptă aprobarea ta</button></p>` : ''}
      ${s.duplicate_deschise ? `<p>⚠️ <button data-go="duplicate" class="underline">${s.duplicate_deschise} posibil(e) duplicat(e) de verificat</button></p>` : ''}
      ${s.outbox_esuat ? `<p>⚠️ ${s.outbox_esuat} operații automate (coduri / emailuri) au eșuat. Spune-mi și verificăm.</p>` : ''}</div>` : ''}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${k(s.membri, 'Membri înscriși', 'clienti')}${k(s.membri_noi_30z, 'Noi în 30 de zile', 'clienti')}${k(s.activi_90z, 'Activi în 90 de zile')}
      ${k(s.recompense_disponibile, 'Recompense nefolosite')}${k(s.recompense_folosite_30z, 'Recompense folosite (30 z)')}
      ${k(s.bonuri_de_aprobat, 'Bonuri de aprobat', 'aprobare')}${k(s.duplicate_deschise, 'Duplicate deschise', 'duplicate')}
    </div>
    <div class="mt-6 flex flex-wrap gap-2">
      <button id="exp-m" class="btn-ghost">Exportă membrii (CSV)</button>
      <button id="exp-r" class="btn-ghost">Exportă registrul (CSV)</button>
    </div>`;
  $$('[data-go]').forEach(b => b.onclick = () => deschide(b.dataset.go));
  const exp = async (tip, nume) => { const r = await api('export', { tip }); if (!r.ok) return toast(r.error, 'err'); descarca(nume, r.data.csv); toast('Exportul a fost descărcat și notat în jurnal.'); };
  $('#exp-m').onclick = () => exp('membri', `fidelitate-membri-${new Date().toISOString().slice(0, 10)}.csv`);
  $('#exp-r').onclick = () => exp('registru', `fidelitate-registru-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ------------------------------------------------------------ clienți
const CANAL = { site_multumire: 'Site · după comandă', site_cont: 'Site · cont', magazin_qr: 'Magazin · QR', magazin_angajat: 'Magazin · casă' };
const STARE_M = { inscris: '<span class="pill ok">înscris</span>', retras: '<span class="pill bad">retras</span>', anonimizat: '<span class="pill">anonimizat</span>' };

async function clienti(q = '', offset = 0) {
  if (!$('#cq')) {
    P().innerHTML = `<div class="flex gap-2 mb-4"><input id="cq" class="inp" placeholder="Caută după nume, telefon sau email" value="${esc(q)}"></div><div id="lista"></div>`;
    let t; $('#cq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => clienti($('#cq').value.trim(), 0), 300); });
  }
  $('#lista').innerHTML = '<p class="text-muted">Se încarcă…</p>';
  const r = await api('clienti', { q, offset });
  if (!r.ok) return ($('#lista').innerHTML = `<p class="text-[#B4232A]">${esc(r.error)}</p>`);
  if (!r.data.length) return ($('#lista').innerHTML = '<p class="text-muted card p-4">Niciun client.</p>');
  $('#lista').innerHTML = `<div class="card overflow-x-auto"><table class="t"><thead><tr><th>Client</th><th>Contact</th><th>Ștampile</th><th>Recompense</th><th>Înscris</th><th>Ultima activitate</th><th>Stare</th></tr></thead><tbody>
    ${r.data.map(m => `<tr class="cursor-pointer hover:bg-cream" data-id="${m.id}"><td class="font-semibold">${esc(m.prenume || '—')}</td>
      <td>${esc(m.telefon || '')}<br><span class="text-muted">${esc(m.email || '')}</span>${m.marketing ? ' <span class="pill">newsletter</span>' : ''}</td>
      <td>${m.stampile}${Number(m.rest_lei) ? ` <span class="text-muted">+ ${lei(m.rest_lei)}</span>` : ''}</td><td>${m.recompense_disponibile || ''}</td>
      <td>${ziScurt(m.inscris)}<br><span class="text-xs text-muted">${CANAL[m.canal] || m.canal}</span></td><td>${ziScurt(m.ultima_activitate)}</td><td>${STARE_M[m.stare] || m.stare}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="flex gap-2 mt-3">${offset > 0 ? '<button id="prev" class="btn-ghost">← Înapoi</button>' : ''}${r.data.length === 100 ? '<button id="next" class="btn-ghost">Următorii 100 →</button>' : ''}</div>`;
  $$('#lista [data-id]').forEach(tr => tr.onclick = () => profil(tr.dataset.id));
  $('#prev')?.addEventListener('click', () => clienti(q, Math.max(0, offset - 100)));
  $('#next')?.addEventListener('click', () => clienti(q, offset + 100));
}

const TIP_L = { stampile: 'Ștampile câștigate', rest: 'Cumpărătură', consum: 'Folosite pentru recompensă', restituire: 'Ștampile restituite', retragere: 'Ștampile retrase',
  expirare: 'Expirate', deficit: 'Datorie de ștampile', corectie: 'Corecție' };
const STARE_R = { in_pregatire: '<span class="pill warn">se pregătește</span>', disponibila: '<span class="pill ok">disponibilă</span>', folosita: '<span class="pill">folosită</span>',
  expirata: '<span class="pill bad">expirată</span>', anulata: '<span class="pill bad">anulată</span>' };
const STARE_B = { valid: '<span class="pill ok">valid</span>', asteapta_aprobare: '<span class="pill warn">de aprobat</span>', anulat: '<span class="pill bad">anulat</span>', respins: '<span class="pill bad">respins</span>' };
const semn = n => (Number(n) > 0 ? '+' : '') + n;

async function profil(id) {
  incarca();
  const r = await api('client', { member_id: id });
  if (!r.ok) return eroare(r);
  const { membru: m, sold: s, acorduri, recompense, bonuri, istoric } = r.data;
  const activ = m.status === 'inscris';
  const ultimMk = acorduri.find(a => a.kind === 'marketing_email');
  P().innerHTML = `
    <button id="inapoi" class="text-sm underline mb-3">← Toți clienții</button>
    <div class="grid md:grid-cols-3 gap-4">
      <div class="card p-5 space-y-2 md:col-span-1">
        <p class="eyebrow">Client</p><h1 class="text-2xl font-semibold">${esc(m.first_name || '—')}</h1>${STARE_M[m.status] || ''}
        <p class="text-sm">${esc(m.phone || '')}<br>${esc(m.email || '')}</p>
        <p class="text-xs text-muted">Înscris pe ${zi(m.enrolled_at)} · ${CANAL[m.enroll_channel] || m.enroll_channel}</p>
        <p class="text-xs text-muted">Emailuri de marketing: ${ultimMk?.granted ? 'da' : 'nu'}</p>
        <hr class="border-line">
        <p class="text-3xl font-semibold">${s.stampile} <span class="text-base font-normal">ștampile</span></p>
        <p class="text-sm">${lei(s.rest_lei)} strânși spre următoarea ștampilă</p>
        ${s.deficit ? `<p class="pill warn">Datorie: ${s.deficit} ștampile</p>` : ''}
        ${s.stampile_care_expira ? `<p class="text-xs text-muted">${s.stampile_care_expira} expiră pe ${zi(s.urmatoarea_expirare)}</p>` : ''}
        ${activ ? `<div class="flex flex-col gap-2 pt-3">
          <button id="corectie" class="btn-ghost">Corecție de sold</button>
          <button id="contact" class="btn-ghost">Modifică datele de contact</button>
          <button id="retrage" class="btn-ghost text-[#B4232A] border-[#B4232A]">Scoate din program</button></div>` : ''}
      </div>
      <div class="md:col-span-2 space-y-4">
        <div class="card p-4"><p class="h text-sm mb-2">Recompense</p>${recompense.length ? `<table class="t"><tbody>${recompense.map(x => `<tr>
          <td>${lei(x.value)}</td><td>${STARE_R[x.status] || x.status}</td><td class="text-sm">emisă ${ziScurt(x.issued_at)} · expiră ${ziScurt(x.expires_at)}${x.used_at ? `<br>folosită ${ora(x.used_at)} (${x.used_channel === 'online' ? 'online' : 'magazin'})` : ''}${x.closed_reason ? `<br><span class="text-muted">${esc(x.closed_reason)}</span>` : ''}</td>
          <td class="text-xs text-muted">${esc(x.code || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="text-sm text-muted">Încă nicio recompensă.</p>'}</div>
        <div class="card p-4"><p class="h text-sm mb-2">Bonuri din magazin</p>${bonuri.length ? `<table class="t"><tbody>${bonuri.map(b => `<tr>
          <td>Nr. ${esc(b.number)}<br><span class="text-xs text-muted">${ziScurt(b.receipt_date)}</span></td><td>${lei(b.amount)}</td><td>${STARE_B[b.status] || b.status}${b.cancel_reason ? `<br><span class="text-xs text-muted">${esc(b.cancel_reason)}</span>` : ''}</td>
          <td class="text-right">${b.status === 'valid' ? `<button class="text-sm underline text-[#B4232A]" data-anuleaza="${b.id}" data-nr="${esc(b.number)}">Anulează</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="text-sm text-muted">Niciun bon.</p>'}</div>
        <div class="card p-4"><p class="h text-sm mb-2">Istoric complet</p><div class="overflow-x-auto"><table class="t"><thead><tr><th>Data</th><th>Ce</th><th>Ștampile</th><th>Lei</th><th>Sursa</th><th>De cine</th></tr></thead><tbody>
          ${istoric.map(l => `<tr><td class="whitespace-nowrap">${ora(l.data)}</td><td>${TIP_L[l.tip] || l.tip}${l.motiv ? `<br><span class="text-xs text-muted">${esc(l.motiv)}</span>` : ''}</td>
            <td>${l.stampile ? semn(l.stampile) : ''}</td><td>${Number(l.lei) ? semn(Number(l.lei)) : ''}</td><td class="text-sm">${esc(l.sursa || '')} ${esc(l.ref || '')}</td><td class="text-sm">${esc(l.autor || 'sistem')}</td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="card p-4"><p class="h text-sm mb-2">Acorduri</p><table class="t"><tbody>${acorduri.map(a => `<tr><td>${a.kind === 'program' ? 'Program' : 'Marketing email'}</td>
          <td>${a.granted ? '<span class="pill ok">da</span>' : '<span class="pill">nu</span>'}</td><td class="text-sm">v${esc(a.text_version)} · ${esc(a.channel)}</td><td class="text-sm whitespace-nowrap">${ora(a.created_at)}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>`;
  $('#inapoi').onclick = () => deschide('clienti');
  $$('[data-anuleaza]').forEach(b => b.onclick = async () => {
    const f = await formular({ titlu: `Anulezi bonul nr. ${b.dataset.nr}?`, text: 'Ștampilele lui se retrag. Dacă erau deja într-o recompensă: recompensa nefolosită se anulează, iar la una folosită clientul rămâne cu o datorie de ștampile.',
      campuri: [{ name: 'motiv', label: 'Motivul (obligatoriu)', required: true }], da: 'Anulează bonul', pericol: true });
    if (!f) return;
    const r = await api('anuleaza_bon', { id: Number(b.dataset.anuleaza), motiv: f.motiv });
    if (!r.ok) return toast(r.error, 'err'); toast('Bonul a fost anulat.'); profil(id);
  });
  if (!activ) return;
  $('#corectie').onclick = async () => {
    const f = await formular({ titlu: 'Corecție de sold', text: 'Folosește numere negative ca să scazi. Corecția apare în istoricul clientului și în jurnal.',
      campuri: [{ name: 'stampile', label: 'Ștampile (+/−)', type: 'number', value: '0', min: -60, max: 60, step: 1 },
        { name: 'lei', label: 'Lei strânși (+/−)', type: 'number', value: '0', min: -10000, max: 10000, step: '0.01' },
        { name: 'motiv', label: 'Motivul (obligatoriu)', required: true }] });
    if (!f) return;
    if (!Number(f.stampile) && !Number(f.lei)) return toast('Nu ai schimbat nimic.', 'err');
    const r = await api('corectie', { member_id: id, stampile: Number(f.stampile), lei: Number(f.lei), motiv: f.motiv });
    if (!r.ok) return toast(r.error, 'err'); toast('Corecția a fost salvată.'); profil(id);
  };
  $('#contact').onclick = async () => {
    const f = await formular({ titlu: 'Datele de contact', campuri: [
      { name: 'prenume', label: 'Prenume', value: m.first_name }, { name: 'telefon', label: 'Telefon', value: m.phone, type: 'tel' },
      { name: 'email', label: 'Email', value: m.email, type: 'email' }, { name: 'motiv', label: 'Motivul (obligatoriu)', required: true }] });
    if (!f) return;
    const r = await api('contact', { member_id: id, ...f });
    if (!r.ok) return toast(r.error, 'err'); toast('Datele au fost actualizate.'); profil(id);
  };
  $('#retrage').onclick = async () => {
    const f = await formular({ titlu: `Scoți pe ${m.first_name || 'client'} din program?`, text: 'Ștampilele și recompensele nefolosite se pierd. Folosește doar la cererea clientului. Datele rămân pentru evidență până la anonimizare.',
      campuri: [{ name: 'motiv', label: 'Motivul (obligatoriu)', required: true, value: 'la cererea clientului' }], da: 'Scoate din program', pericol: true });
    if (!f) return;
    const r = await api('retrage', { member_id: id, motiv: f.motiv });
    if (!r.ok) return toast(r.error, 'err'); toast('Clientul a fost scos din program.'); profil(id);
  };
}

// ------------------------------------------------------------ bonuri de aprobat
async function aprobare() {
  incarca();
  const r = await api('de_aprobat');
  if (!r.ok) return eroare(r);
  $('[data-badge=aprobare]').textContent = r.data.length ? `(${r.data.length})` : '';
  if (!r.data.length) return (P().innerHTML = '<p class="card p-4 text-muted">Niciun bon nu așteaptă aprobarea.</p>');
  P().innerHTML = `<p class="text-sm text-muted mb-3">Bonurile peste limita setată primesc ștampile doar după ce le aprobi. Verifică în casa de marcat că bonul există și suma e corectă.</p>
    <div class="space-y-2">${r.data.map(b => `<div class="card p-4 flex flex-wrap items-center gap-3">
      <div class="flex-1 min-w-[200px]"><p class="text-xl font-semibold">${lei(b.suma)}</p><p class="text-sm">Bon nr. ${esc(b.numar)} din ${zi(b.data)}</p>
        <p class="text-xs text-muted">Client: <button class="underline" data-client="${b.member_id}">${esc(b.client || '—')}</button> · adăugat de ${esc(b.angajat)} pe ${ora(b.adaugat)}</p></div>
      <button class="btn" data-ok="${b.id}">Aprobă</button><button class="btn-ghost" data-nu="${b.id}">Respinge</button></div>`).join('')}</div>`;
  $$('[data-client]').forEach(b => b.onclick = () => { deschide('clienti'); profil(b.dataset.client); });
  $$('[data-ok]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const r = await api('aproba', { id: Number(b.dataset.ok), aproba: true });
    if (!r.ok) { b.disabled = false; return toast(r.error, 'err'); }
    toast(`Aprobat. Clientul a primit ${r.data.stampile} ștampile.`); aprobare();
  });
  $$('[data-nu]').forEach(b => b.onclick = async () => {
    const f = await formular({ titlu: 'Respingi bonul?', campuri: [{ name: 'motiv', label: 'Motivul (obligatoriu)', required: true }], da: 'Respinge', pericol: true });
    if (!f) return;
    const r = await api('aproba', { id: Number(b.dataset.nu), aproba: false, motiv: f.motiv });
    if (!r.ok) return toast(r.error, 'err'); toast('Bonul a fost respins.'); aprobare();
  });
}

// ------------------------------------------------------------ duplicate
async function duplicate() {
  incarca();
  const r = await api('duplicate');
  if (!r.ok) return eroare(r);
  $('[data-badge=duplicate]').textContent = r.data.length ? `(${r.data.length})` : '';
  if (!r.data.length) return (P().innerHTML = '<p class="card p-4 text-muted">Nimic de verificat.</p>');
  const om = x => x ? `<button class="text-left underline-offset-2 hover:underline" data-client="${x.id}"><b>${esc(x.prenume || '—')}</b><br><span class="text-sm">${esc(x.telefon || '')}<br>${esc(x.email || '')}</span></button>` : '<span class="text-muted">—</span>';
  P().innerHTML = `<p class="text-sm text-muted mb-3">Cineva s-a înscris cu un telefon al unui membru și emailul altuia (sau invers). Nu s-a creat un profil nou. Verifică și, dacă e nevoie, corectează datele din profil, apoi marchează ca rezolvat.</p>
    <div class="space-y-2">${r.data.map(d => `<div class="card p-4 grid md:grid-cols-4 gap-3 items-start">
      <div class="text-sm"><p class="eyebrow">${ora(d.data)}</p><p>${esc(d.motiv)}</p>${d.detalii ? `<p class="text-xs text-muted">Introdus: ${esc(d.detalii.telefon_introdus || '')} · ${esc(d.detalii.email_introdus || '')}</p>` : ''}</div>
      <div>${om(d.a)}</div><div>${om(d.b)}</div>
      <div class="md:text-right"><button class="btn-ghost" data-rez="${d.id}">Rezolvat</button></div></div>`).join('')}</div>`;
  $$('[data-client]').forEach(b => b.onclick = () => { deschide('clienti'); profil(b.dataset.client); });
  $$('[data-rez]').forEach(b => b.onclick = async () => {
    const f = await formular({ titlu: 'Marchezi ca rezolvat?', campuri: [{ name: 'nota', label: 'Ce ai făcut (obligatoriu)', required: true }], da: 'Rezolvat' });
    if (!f) return;
    const r = await api('rezolva_duplicat', { id: Number(b.dataset.rez), nota: f.nota });
    if (!r.ok) return toast(r.error, 'err'); duplicate();
  });
}

// ------------------------------------------------------------ echipa
async function echipa() {
  incarca();
  const r = await api('echipa');
  if (!r.ok) return eroare(r);
  P().innerHTML = `<div class="card overflow-x-auto"><table class="t"><thead><tr><th>Nume</th><th>Rol</th><th>Stare</th><th>Din</th><th></th></tr></thead><tbody>
    ${r.data.map(s => `<tr><td class="font-semibold">${esc(s.name)}${s.id === eu.id ? ' <span class="text-muted font-normal">(tu)</span>' : ''}</td>
      <td>${s.role === 'admin' ? 'Administrator' : 'Angajat'}</td><td>${s.active ? '<span class="pill ok">activ</span>' : '<span class="pill bad">dezactivat</span>'}</td>
      <td>${ziScurt(s.created_at)}</td><td class="text-right"><button class="underline text-sm" data-ed="${s.id}">Modifică</button></td></tr>`).join('')}
    </tbody></table></div>
    <button id="invita" class="btn mt-4">+ Invită un angajat</button>
    <p class="text-sm text-muted mt-2">Primește un email cu un link unde își alege parola. Apoi intră pe pagina casei, de pe telefon sau tabletă.</p>`;
  $$('[data-ed]').forEach(b => b.onclick = async () => {
    const s = r.data.find(x => x.id === b.dataset.ed);
    const f = await formular({ titlu: `Modifică: ${s.name}`, campuri: [{ name: 'nume', label: 'Nume', value: s.name, required: true },
      { name: 'rol', label: 'Rol', type: 'select', value: s.role, options: [['angajat', 'Angajat (doar casa)'], ['admin', 'Administrator']] },
      { name: 'activ', label: 'Contul e activ (debifează când persoana nu mai lucrează la voi)', type: 'checkbox', value: s.active }] });
    if (!f) return;
    const x = await api('modifica_membru_echipa', { id: s.id, nume: f.nume, rol: f.rol, activ: f.activ });
    if (!x.ok) return toast(x.error, 'err'); toast('Salvat.'); echipa();
  });
  $('#invita').onclick = async () => {
    const f = await formular({ titlu: 'Invită un angajat', campuri: [{ name: 'nume', label: 'Nume', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'rol', label: 'Rol', type: 'select', value: 'angajat', options: [['angajat', 'Angajat (doar casa)'], ['admin', 'Administrator']] }], da: 'Trimite invitația' });
    if (!f) return;
    const x = await api('invita', f);
    if (!x.ok) return toast(x.error + (x.detaliu ? ` (${x.detaliu})` : ''), 'err', 6000);
    toast(`Invitația a fost trimisă la ${f.email}.`); echipa();
  };
}

// ------------------------------------------------------------ jurnal
const ACT = { inscriere: 'Înscriere', inscriere_existenta: 'Înscriere (exista deja)', bon_adaugat: 'Bon adăugat', bon_aprobat: 'Bon aprobat', bon_respins: 'Bon respins', bon_anulat: 'Bon anulat',
  recompensa_folosita: 'Recompensă folosită', recompensa_restituita: 'Recompensă restituită', corectie: 'Corecție de sold', date_contact_modificate: 'Date de contact modificate',
  retragere_program: 'Scos din program', duplicat_rezolvat: 'Duplicat rezolvat', setare_modificata: 'Setare modificată', echipa_modificata: 'Echipă modificată', export: 'Export date' };
async function jurnal() {
  incarca();
  const r = await api('jurnal');
  if (!r.ok) return eroare(r);
  P().innerHTML = `<p class="text-sm text-muted mb-3">Tot ce s-a făcut în program, cine și când. Nu se poate șterge sau modifica. Ultimele 300 de operații.</p>
    <div class="card overflow-x-auto"><table class="t"><thead><tr><th>Când</th><th>Cine</th><th>Ce</th><th>Motiv / detalii</th></tr></thead><tbody>
    ${r.data.map(a => `<tr><td class="whitespace-nowrap">${ora(a.data)}</td><td>${esc(a.cine)}</td><td>${esc(ACT[a.actiune] || a.actiune)}<br><span class="text-xs text-muted">${esc(a.entitate)} ${esc(a.id || '')}</span></td>
      <td class="text-sm">${esc(a.motiv || '')}${a.dupa ? `<details><summary class="text-xs text-muted cursor-pointer">detalii</summary><pre class="text-xs whitespace-pre-wrap">${esc(JSON.stringify({ inainte: a.inainte, dupa: a.dupa }, null, 1))}</pre></details>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// ------------------------------------------------------------ setări
async function setari() {
  incarca();
  const r = await api('setari');
  if (!r.ok) return eroare(r);
  const NUME = { lei_per_stampila: 'Lei pentru o ștampilă', stampile_per_recompensa: 'Ștampile pentru o recompensă', valoare_recompensa: 'Valoarea recompensei (lei)',
    valabilitate_stampila_luni: 'Valabilitatea ștampilei (luni)', valabilitate_rest_luni: 'Valabilitatea restului de lei (luni)', valabilitate_recompensa_zile: 'Valabilitatea recompensei (zile)',
    prag_aprobare_bon: 'Bonurile peste această sumă cer aprobarea ta (lei)', bon_vechime_max_zile: 'Un bon uitat se poate adăuga în (zile)', anonimizare_inactivitate_luni: 'Anonimizare după inactivitate (luni)' };
  P().innerHTML = `<p class="text-sm text-muted mb-3">Regulile programului sunt cele din regulament și se schimbă doar împreună cu el (anunț clienților). Din panou se poate schimba doar limita de aprobare a bonurilor.</p>
    <div class="card"><table class="t"><tbody>${r.data.map(s => `<tr><td>${esc(NUME[s.key] || s.key)}</td><td class="font-semibold">${Number(s.value).toLocaleString('ro-RO')}</td>
      <td class="text-right">${s.key === 'prag_aprobare_bon' ? `<button class="underline text-sm" data-k="${s.key}" data-v="${s.value}">Modifică</button>` : '<span class="text-xs text-muted">din regulament</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-k]').forEach(b => b.onclick = async () => {
    const f = await formular({ titlu: 'Limita de aprobare', campuri: [{ name: 'v', label: 'Lei (între 100 și 100.000)', type: 'number', value: b.dataset.v, min: 100, max: 100000, required: true }] });
    if (!f) return;
    const x = await api('seteaza', { key: b.dataset.k, value: Number(f.v) });
    if (!x.ok) return toast(x.error, 'err'); toast('Salvat.'); setari();
  });
}
