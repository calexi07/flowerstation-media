// =============================================================
//  Planul de lucru: ce trebuie făcut, când și pe ce canal,
//  pentru fiecare articol și pentru fiecare campanie (ocazie mare).
//  Datele vin din „Calendarul de conținut și promovare”.
// =============================================================

/** 'YYYY-MM-DD' + n zile */
export const addDays = (d, n) => {
  if (!d) return null;
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};
export const today = () => { const x = new Date(); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
export const fmtDay = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) : '';
export const fmtDayLong = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
export const dayDiff = d => Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);

/** Câte ceva despre textul unui articol, fără editor deschis. */
export function bodyStats(p) {
  const doc = new DOMParser().parseFromString(`<div>${p.body_html || ''}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  const links = [...root.querySelectorAll('a[href^="/"]')].filter(a => !a.closest('.tfs-produs')).length;
  root.querySelectorAll('.tfs-produs, .tfs-loc-poza, figure').forEach(x => x.remove());
  const words = (root.textContent || '').split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
  const faq = (p.faq || []).filter(f => f?.q?.trim() && f?.a?.trim()).length;
  return { words, links, faq };
}
const isOnSite = p => p.status === 'published' || p.status === 'scheduled';

// ---------------------------------------------------------------- campanie (ocazie mare)
// off = zile față de ziua ocaziei (D). {limita} = ultima zi de comandă.
export const CAMPAIGN_TASKS = [
  // pregătire
  { key: 'c-col', off: -28, ch: 'Shopify', text: 'Colecția ocaziei e gata: 8–12 produse și textul de sus scris' },
  { key: 'c-foto', off: -28, ch: 'Poze', text: 'Pozele produselor noi + 2–3 poze „din atelier” pentru rețele' },
  { key: 'c-furn', off: -28, ch: 'Furnizori', text: 'Comanda către furnizori plasată (flori, materiale de ambalat)' },
  { key: 'c-art', off: -28, ch: 'Site', text: 'Articolele ocaziei sunt pe site și au linkuri spre colecție', auto: 'articles' },
  { key: 'p-fb1', off: -21, ch: 'Facebook', text: 'Linkul articolului, cu o întrebare la început' },
  { key: 'p-ig1', off: -20, ch: 'Instagram', text: 'Carusel cu 5–7 idei din articol, linkul în bio' },
  { key: 'c-livr', off: -14, ch: 'Livrări', text: 'Câte livrări poți face pe zi; zilele pline închise în calendarul de livrare' },
  { key: 'c-cod', off: -14, ch: 'Shopify', text: 'Codul de reducere sau cadou creat și testat în coș (dacă faci)' },
  { key: 'c-buget', off: -14, ch: 'Reclame', text: 'Bugetul de reclame stabilit (Meta și Google), cu început și sfârșit' },
  { key: 'c-banner', off: -14, ch: 'Site', text: 'Banner pe prima pagină a site-ului' },
  { key: 'p-tt1', off: -14, ch: 'TikTok', text: 'Clip din atelier: „Am început pregătirile pentru…”' },
  { key: 'p-nl1', off: -14, ch: 'Newsletter', text: 'Ghid de cadouri pentru ocazie, cu produsele și articolul' },
  { key: 'p-gbp1', off: -14, ch: 'Google Business', text: 'Postare cu buchetele ocaziei' },
  { key: 'p-meta', off: -12, ch: 'Reclame Meta', text: 'Pornesc reclamele cu produsele ocaziei (București și Ilfov)' },
  { key: 'p-gads', off: -10, ch: 'Reclame Google', text: 'Pornesc reclamele pe căutări „flori [ocazie] livrare”' },
  { key: 'c-limita', off: -7, ch: 'Site', text: 'Ultima zi de comandă ({limita}) anunțată pe site' },
  { key: 'c-echipa', off: -7, ch: 'Echipă', text: 'Echipa știe programul extins și cine face livrările' },
  { key: 'p-ig2', off: -7, ch: 'Instagram', text: 'Reel cu buchetele ocaziei' },
  { key: 'p-wa', off: -7, ch: 'WhatsApp', text: 'Mesaj către clienții de anul trecut: 3 buchete + „comandă până pe {limita}”' },
  { key: 'p-tt2', off: -5, ch: 'TikTok', text: 'Clip „cum se face” unul dintre buchete' },
  { key: 'p-nl2', off: -4, ch: 'Newsletter', text: '„Ultimele zile de comenzi” (până pe {limita})' },
  { key: 'p-fbig', off: -3, ch: 'Facebook + Instagram', text: '„Comandă până pe {limita}”, cu numărătoare inversă în story' },
  { key: 'p-gbp2', off: -3, ch: 'Google Business', text: 'Ofertă cu data-limită ({limita})' },
  { key: 'p-st1', off: -1, ch: 'Story + TikTok', text: 'Agitația din atelier și „mai livrăm și mâine”' },
  { key: 'p-st2', off: 0, ch: 'Story', text: 'Buchetele care pleacă, toată ziua' },
  // după
  { key: 'a-mult', off: 1, ch: 'Facebook + Instagram', text: 'Mulțumire + pozele clienților (cu acordul lor)' },
  { key: 'a-off', off: 2, ch: 'Site', text: 'Banner și reduceri scoase de pe site; reclamele oprite' },
  { key: 'a-rec', off: 2, ch: 'Google', text: 'Cerere de recenzie către clienții din ziua respectivă' },
  { key: 'a-nota', off: 7, ch: 'Notă', text: 'Ce s-a vândut, ce a lipsit, ce schimbi la anul (scrie la „Notițe”)' },
];

/** Sarcinile unei campanii, cu date și stare. posts = articolele legate de campanie. */
export function campaignTasks(c, posts = []) {
  const lim = fmtDay(c.order_by || addDays(c.occasion_date, -3));
  return CAMPAIGN_TASKS.map(t => {
    const date = c.occasion_date ? addDays(c.occasion_date, t.off) : null;
    let auto = null;
    if (t.auto === 'articles' && posts.length) auto = posts.every(isOnSite);   // fără articole legate: bifezi tu
    const text = t.text.replaceAll('{limita}', lim || '…');
    return { ...t, text, date, auto, done: auto ?? !!c.tasks?.[t.key], src: { type: 'camp', id: c.id, name: c.name } };
  });
}

// ---------------------------------------------------------------- articol
/**
 * Sarcinile unui articol: scrisul, publicarea, apoi promovarea.
 * Dacă articolul face parte dintr-o campanie, promovarea e în campanie.
 */
export function articleTasks(p, camp = null) {
  const due = p.due_date || null;
  const st = bodyStats(p);
  const T = [];
  const add = (key, date, ch, text, auto = null) => T.push({ key, date, ch, text, auto, done: auto ?? !!p.tasks?.[key], src: { type: 'post', id: p.id, name: p.title || p.keyword } });
  add('w-draft', due && addDays(due, -14), 'Articol', 'Ciorna e scrisă (minim 800 de cuvinte)', isOnSite(p) || st.words >= 800);
  add('w-seo', due && addDays(due, -3), 'Articol', 'Linkuri interne (3+), întrebări frecvente (4+) și poze în text', isOnSite(p) || (st.links >= 3 && st.faq >= 4));
  add('w-pub', due, 'Site', 'Articolul e publicat (sau programat) pe site', isOnSite(p));
  if (camp) return T;   // restul promovării e în campanie

  const occ = (p.occasions || []).filter(o => o?.date).sort((a, b) => a.date.localeCompare(b.date));
  if (occ.length) {
    for (const o of occ) {
      const n = o.label || fmtDay(o.date);
      add(`o:${o.date}:gbp`, addDays(o.date, -5), 'Google Business', `Postare pentru ${n}, cu linkul articolului`);
      add(`o:${o.date}:fbig`, addDays(o.date, -3), 'Facebook + Instagram', `Postare: ${n} (${fmtDay(o.date)}) + buchetul recomandat`);
      add(`o:${o.date}:st1`, addDays(o.date, -1), 'Story', `${n}: „Mai prinzi livrarea de mâine”`);
      add(`o:${o.date}:st2`, o.date, 'Story', `${n}: „La mulți ani! Livrăm și azi”`);
    }
  } else {
    add('e-ig', due && addDays(due, 3), 'Instagram', 'Carusel din articol, linkul în bio');
    add('e-fb', due && addDays(due, 4), 'Facebook', 'Linkul articolului, cu o întrebare la început');
    add('e-gbp', due && addDays(due, 7), 'Google Business', 'Postare cu linkul articolului');
  }
  add('g-check', due && addDays(due, 30), 'Google', 'Verifică în „Rezultate Google” cum a pornit articolul');
  return T.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
}

export const progress = tasks => { const n = tasks.length, d = tasks.filter(t => t.done).length; return { n, d, pct: n ? Math.round(d / n * 100) : 0 }; };
