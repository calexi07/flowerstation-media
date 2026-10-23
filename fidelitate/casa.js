// =============================================================
//  Ecranul de la casă: caută clientul, adaugă bonul, folosește recompensa, înscrie client nou.
// =============================================================
import { $, $$, api, esc, lei, zi, ziScurt, azi, toast, confirma, initAuth, logout } from './fid.js';

const app = $('#app');
let eu = null;          // angajatul logat
let texte = null;       // textele de acord (versiunea curentă)

initAuth(app, async staff => { eu = staff; ecranCautare(); }, { titlu: 'Casa · Fidelitate' });

// ------------------------------------------------------------ antet
const antet = (inapoi = false) => `
  <header class="sticky top-0 z-10 bg-ink text-white px-4 py-3 flex items-center gap-3">
    ${inapoi ? '<button id="back" class="text-2xl leading-none px-1" aria-label="Înapoi">←</button>' : ''}
    <div class="flex-1"><p class="text-[11px] uppercase tracking-[.14em] text-pink">The Flower Station</p><p class="h text-sm">Card de fidelitate</p></div>
    ${eu.role === 'admin' ? '<a href="admin.html" class="text-xs uppercase tracking-wider underline">Panou</a>' : ''}
    <button id="iesi" class="text-xs uppercase tracking-wider underline">Ieși (${esc(eu.name)})</button>
  </header>`;
const legaAntet = (inapoi) => {
  $('#iesi').onclick = logout;
  if (inapoi) $('#back').onclick = inapoi;
};

// ------------------------------------------------------------ căutare
function ecranCautare(q = '') {
  app.innerHTML = `${antet()}
  <section class="p-4 space-y-4">
    <label class="block"><span class="lbl">Caută clientul după telefon sau email</span>
      <input id="q" class="inp text-lg" inputmode="search" autocomplete="off" placeholder="ex. 0722 123 456 sau ana@…" value="${esc(q)}"></label>
    <div id="rez" aria-live="polite"></div>
    <button id="nou" class="btn-pink w-full">+ Înscrie client nou</button>
  </section>`;
  legaAntet();
  $('#nou').onclick = () => ecranInscriere({ telefon: /\d{6,}/.test($('#q').value.replace(/\D/g, '')) ? $('#q').value : '', email: $('#q').value.includes('@') ? $('#q').value : '' });
  let t, ultim = 0;
  const cauta = async () => {
    const v = $('#q').value.trim(), id = ++ultim;
    const rez = $('#rez');
    if (v.replace(/\D/g, '').length < 4 && !(v.includes('@') || v.length >= 3)) { rez.innerHTML = '<p class="text-sm text-muted">Scrie cel puțin 4 cifre din telefon sau începutul emailului.</p>'; return; }
    rez.innerHTML = '<p class="text-sm text-muted">Caut…</p>';
    const r = await api('cauta', { q: v });
    if (id !== ultim) return;
    if (!r.ok) { rez.innerHTML = `<p class="text-sm text-[#B4232A]">${esc(r.error)}</p>`; return; }
    if (!r.data.length) { rez.innerHTML = '<p class="text-sm text-muted p-3 card">Niciun client găsit. Îl poți înscrie mai jos.</p>'; return; }
    rez.innerHTML = `<ul class="card divide-y divide-line">${r.data.map(c => `
      <li><button data-id="${c.id}" class="w-full text-left p-4 flex items-center gap-3 hover:bg-cream">
        <span class="flex-1"><span class="block font-semibold text-lg">${esc(c.first_name || '—')}</span>
          <span class="block text-sm text-muted">${esc(c.telefon || '')} · ${esc(c.email || '')}</span></span>
        <span class="text-right text-sm"><span class="block">${c.stampile} ștampile</span>${c.recompense ? `<span class="pill ok">${c.recompense} recompens${c.recompense > 1 ? 'e' : 'ă'}</span>` : ''}</span>
      </button></li>`).join('')}</ul>`;
    $$('#rez [data-id]').forEach(b => b.onclick = () => ecranCard(b.dataset.id, v));
  };
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cauta, 300); });
  $('#q').focus();
  if (q) cauta();
}

// ------------------------------------------------------------ cardul clientului
async function ecranCard(id, qInapoi = '', evidentiaza = null) {
  app.innerHTML = `${antet(true)}<p class="p-6 text-muted">Se încarcă…</p>`;
  legaAntet(() => ecranCautare(qInapoi));
  const r = await api('card', { member_id: id });
  if (!r.ok) { toast(r.error, 'err'); return ecranCautare(qInapoi); }
  const c = r.data, per = Number(c.stampile_per_recompensa), prag = Number(c.lei_per_stampila);
  const pline = Math.min(c.stampile, per);
  const panaLa = Math.max(0, prag - Number(c.rest_lei));
  const inscris = c.stare === 'inscris';

  app.innerHTML = `${antet(true)}
  <section class="p-4 space-y-4">
    <div class="card p-5">
      <p class="eyebrow">Client</p>
      <h1 class="text-2xl font-semibold">${esc(c.prenume || '—')}</h1>
      <p class="text-sm text-muted">${esc(c.telefon || '')} · ${esc(c.email || '')}</p>
      ${inscris ? '' : '<p class="mt-2 pill bad">Nu mai e înscris în program</p>'}
      <div class="mt-5 flex flex-wrap gap-2" aria-label="${c.stampile} din ${per} ștampile">
        ${Array.from({ length: per }, (_, i) => `<span class="stamp ${i < pline ? 'on' : ''}">${i < pline ? '✿' : ''}</span>`).join('')}
      </div>
      <p class="mt-3 text-sm"><b>${c.stampile} din ${per} ștampile</b>${Number(c.rest_lei) > 0 ? ` · are ${lei(c.rest_lei)} strânși, mai trebuie ${lei(panaLa)} pentru următoarea ștampilă` : ''}</p>
      ${c.deficit > 0 ? `<p class="mt-2 text-sm pill warn">Datorează ${c.deficit} ștampil${c.deficit > 1 ? 'e' : 'ă'} (comandă anulată după folosirea recompensei)</p>` : ''}
      ${c.stampile_care_expira > 0 ? `<p class="mt-2 text-xs text-muted">${c.stampile_care_expira} ștampil${c.stampile_care_expira > 1 ? 'e expiră' : 'ă expiră'} pe ${zi(c.urmatoarea_expirare)}.</p>` : ''}
    </div>

    ${c.recompense.length ? `<div class="space-y-2">${c.recompense.map(rw => `
      <div class="card p-4 flex items-center gap-3 ${evidentiaza === 'recompensa' ? 'ring-2 ring-rose' : ''}">
        <div class="flex-1"><p class="text-xl font-semibold">${lei(rw.valoare)} reducere</p>
          <p class="text-xs text-muted">Valabilă până pe ${zi(rw.expira)}</p></div>
        <button class="btn-pink" data-rw="${rw.id}" data-val="${rw.valoare}">Folosește acum</button>
      </div>`).join('')}</div>` : ''}

    ${inscris ? `<form id="bon" class="card p-5 space-y-3" novalidate>
      <p class="h text-sm">Adaugă bonul</p>
      <div class="grid grid-cols-2 gap-3">
        <label class="col-span-2"><span class="lbl">Suma plătită (lei)</span><input name="suma" class="inp text-2xl font-semibold" inputmode="decimal" autocomplete="off" required placeholder="0,00"></label>
        <label><span class="lbl">Nr. bon</span><input name="numar" class="inp" autocomplete="off" required maxlength="30"></label>
        <label><span class="lbl">Data bonului</span><input name="data" type="date" class="inp" value="${azi()}" max="${azi()}" required></label>
      </div>
      <p id="previz" class="text-sm text-muted min-h-[1.25rem]"></p>
      <button class="btn w-full">Adaugă bonul</button>
    </form>` : ''}

    ${c.ultimele_bonuri.length ? `<div class="card p-4"><p class="eyebrow mb-2">Ultimele bonuri</p>
      <ul class="text-sm divide-y divide-line">${c.ultimele_bonuri.map(b => `<li class="py-2 flex justify-between gap-2">
        <span>Nr. ${esc(b.numar)} · ${ziScurt(b.data)}</span><span>${lei(b.suma)} ${stareBon(b.stare)}</span></li>`).join('')}</ul></div>` : ''}
  </section>`;
  legaAntet(() => ecranCautare(qInapoi));

  $$('[data-rw]').forEach(b => b.onclick = () => folosesteRecompensa(b.dataset.rw, b.dataset.val, id, qInapoi));

  const f = $('#bon');
  if (!f) return;
  const previz = () => {
    const s = Number(f.suma.value.replace(',', '.'));
    if (!(s > 0)) { $('#previz').textContent = ''; return; }
    const total = Number(c.rest_lei) + s, n = Math.floor(total / prag);
    $('#previz').textContent = n > 0 ? `Primește ${n} ștampil${n > 1 ? 'e' : 'ă'}.` : `Nu ajunge la o ștampilă încă (${lei(total)} din ${lei(prag)}).`;
  };
  f.suma.addEventListener('input', previz);
  f.suma.focus();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const suma = f.suma.value.trim(), numar = f.numar.value.trim(), data = f.data.value;
    if (!(Number(suma.replace(',', '.')) > 0)) return toast('Scrie suma de pe bon.', 'err');
    if (!numar) return toast('Scrie numărul bonului.', 'err');
    const ok = await confirma({ titlu: `Bon nr. ${numar} · ${lei(suma.replace(',', '.'))}`, text: `Din data de ${zi(data)}. Verifică suma înainte să confirmi.`, da: 'Confirm' });
    if (!ok) return;
    const b = f.querySelector('.btn'); b.disabled = true;
    const r = await api('bon', { member_id: id, numar, data, suma });
    b.disabled = false;
    if (!r.ok) {
      if (r.cod === 'bon_dublu' && r.detaliu) return toast(`${r.error} ${r.detaliu}`, 'err', 6000);
      return toast(r.error, 'err', 5000);
    }
    const inainte = c.recompense.length;
    if (r.data.status === 'asteapta_aprobare') toast('Bonul e peste limită: așteaptă confirmarea administratorului. Ștampilele apar după.', 'ok', 6000);
    else toast(r.data.stampile > 0 ? `Gata! +${r.data.stampile} ștampil${r.data.stampile > 1 ? 'e' : 'ă'}.` : 'Gata! Bonul a fost adăugat.');
    const nou = await api('card', { member_id: id });
    if (nou.ok && nou.data.recompense.length > inainte) toast('🎉 Clientul a câștigat o recompensă de 50 lei!', 'ok', 6000);
    ecranCard(id, qInapoi, nou.ok && nou.data.recompense.length > inainte ? 'recompensa' : null);
  });
}

const stareBon = s => ({ valid: '<span class="pill ok">ok</span>', asteapta_aprobare: '<span class="pill warn">de aprobat</span>', anulat: '<span class="pill bad">anulat</span>', respins: '<span class="pill bad">respins</span>' }[s] || '');

async function folosesteRecompensa(rid, val, memberId, q) {
  const ok = await confirma({ titlu: `Folosești reducerea de ${lei(val)}?`, text: 'Scazi suma din nota de plată la casă. Recompensa nu se mai poate folosi după aceea. Nu se dă rest.', da: 'Da, o folosesc' });
  if (!ok) return;
  const r = await api('foloseste', { reward_id: rid, ref: 'la casă' });
  if (!r.ok) return toast(r.detaliu ? `${r.error} ${r.detaliu}` : r.error, 'err', 6000);
  toast(`Recompensa de ${lei(r.data.valoare)} a fost folosită. Scade-o din nota de plată.`, 'ok', 6000);
  ecranCard(memberId, q);
}

// ------------------------------------------------------------ înscriere
async function ecranInscriere(pre = {}) {
  app.innerHTML = `${antet(true)}
  <form id="ins" class="p-4 space-y-4" novalidate>
    <h1 class="h text-lg">Client nou</h1>
    <label class="block"><span class="lbl">Prenume</span><input name="prenume" class="inp" autocomplete="off" required maxlength="60"></label>
    <label class="block"><span class="lbl">Telefon</span><input name="telefon" class="inp" type="tel" inputmode="tel" autocomplete="off" required value="${esc(pre.telefon || '')}" placeholder="07xx xxx xxx"></label>
    <label class="block"><span class="lbl">Email</span><input name="email" class="inp" type="email" inputmode="email" autocomplete="off" required value="${esc(pre.email || '')}"></label>
    <p class="text-sm text-muted">Clientul trebuie să aibă cel puțin 18 ani. La pasul următor îi dai telefonul să citească și să bifeze singur.</p>
    <button class="btn w-full">Mai departe</button>
  </form>`;
  legaAntet(() => ecranCautare());
  $('#ins').prenume.focus();
  $('#ins').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, d = { prenume: f.prenume.value.trim(), telefon: f.telefon.value.trim(), email: f.email.value.trim() };
    if (!d.prenume) return toast('Scrie prenumele.', 'err');
    if (d.telefon.replace(/\D/g, '').length < 9) return toast('Numărul de telefon pare incomplet.', 'err');
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d.email)) return toast('Adresa de email nu pare corectă.', 'err');
    if (!texte) { const t = await api('texte'); if (!t.ok) return toast(t.error, 'err'); texte = Object.fromEntries(t.data.map(x => [x.kind, x])); }
    ecranAcord(d);
  });
}

function ecranAcord(d) {
  const p = texte.program, m = texte.marketing_email;
  app.innerHTML = `
  <form id="acord" class="min-h-screen bg-paper p-5 space-y-5 max-w-xl mx-auto">
    <p class="eyebrow">The Flower Station · Card de fidelitate</p>
    <h1 class="text-2xl font-semibold">Bună, ${esc(d.prenume)}!</h1>
    <p class="text-muted">La fiecare 100 lei primești o ștampilă. La 6 ștampile ai 50 lei reducere.</p>
    <div class="card p-4 text-sm"><p><b>Telefon:</b> ${esc(d.telefon)}</p><p><b>Email:</b> ${esc(d.email)}</p></div>
    <label class="flex gap-3 items-start card p-4"><input type="checkbox" name="program" class="chk mt-1">
      <span class="consent-text">${esc(p.body)} <a href="https://theflowerstation.ro/pages/regulament-fidelitate" target="_blank" rel="noopener" class="underline">Citește regulamentul</a></span></label>
    <label class="flex gap-3 items-start card p-4"><input type="checkbox" name="marketing" class="chk mt-1">
      <span class="consent-text">${esc(m.body)} <span class="text-muted text-sm">(opțional)</span></span></label>
    <p class="text-xs text-muted">Cum folosim datele: <a href="https://theflowerstation.ro/pages/confidentialitate-fidelitate" target="_blank" rel="noopener" class="underline">informarea privind datele personale</a>.</p>
    <button class="btn w-full text-base" disabled>Mă înscriu</button>
    <button type="button" id="renunta" class="btn-ghost w-full">Renunță</button>
  </form>`;
  const f = $('#acord'), b = f.querySelector('.btn');
  f.program.onchange = () => { b.disabled = !f.program.checked; };
  $('#renunta').onclick = () => ecranInscriere(d);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!f.program.checked) return;
    b.disabled = true;
    const r = await api('inscrie', { ...d, marketing: f.marketing.checked, versiune_program: p.version, versiune_marketing: m.version });
    b.disabled = false;
    if (!r.ok) { toast(r.error, 'err', 6000); if (r.cod === 'versiune_text_invalida') texte = null; return; }
    if (r.data.rezultat === 'existent') toast(`Clientul era deja înscris (${r.data.prenume}). Am deschis cardul lui.${r.data.posibil_duplicat ? ' Datele nu se potrivesc complet: administratorul va verifica.' : ''}`, 'ok', 7000);
    else toast(`${r.data.prenume} a fost înscris(ă). Primește un email de confirmare.`, 'ok', 5000);
    ecranCard(r.data.member_id);
  });
}
