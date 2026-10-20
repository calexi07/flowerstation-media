# The Flower Station · Produse Shopify

Aplicație internă pentru adăugarea de produse noi în magazinul Shopify, în bloc. Adresa: **media.theflowerstation.ro**.

**Fluxul:** încarci pozele → le grupezi pe produse → completezi fiecare produs → descarci CSV-ul → îl imporți în Shopify.

**Stack:** HTML + vanilla JS (ES modules) + Tailwind CDN, fără build · Supabase (login, bază de date, stocare poze) · GitHub Pages.

## Cum se folosește

1. **Grupează pozele.** Apeși **⬆ Încarcă poze** (sau tragi pozele pe pagină). Merg JPG, PNG și HEIC de pe iPhone; pozele sunt optimizate automat și dublurile ignorate. Selectezi pozele unui buchet → **+ Produs din selecție**. Le poți trage între produse, reordona (prima e poza principală) sau șterge. **⚡ Grupează automat** pune împreună pozele făcute la mai puțin de 5 minute una de alta.
2. **Completează**, câte un produs: nume, preț (sau variante cu prețuri diferite), tip produs, colecție, primul paragraf din descriere, flori, culori (detectate automat, se pot schimba), tag-uri, SEO. Click pe o poză → alegi decupajul pătrat (sus/jos, zoom). **✓ Validează și continuă** verifică ce lipsește și trece la următorul.
3. **Descarcă CSV.** Alegi Draft sau Activ (pe fiecare sau pe toate), apoi descarci fișierul.
4. **În Shopify:** Produse → Importă → fișierul → Importă produsele. Apoi Editare în bloc → coloana Template → `template-tfs`.
5. **＋ Produse noi** pornește următorul lot. Produsele trimise rămân la **🕘 Exportate**, unde pot fi modificate și exportate din nou.

## Ce se completează automat la export

- Paragrafele standard de la finalul descrierii (livrare, contact, produs perisabil)
- Furnizor *The Flower Station* și categoria Shopify după tip (Fresh Cut Flowers / Plants / Candles)
- Tag-uri: colecția, florile și culorile, pe lângă cele scrise de mână
- Titlu și descriere SEO, text alternativ pentru poze, link produs unic
- Poze pătrate, max. 2048 × 2048, decupate cum ai ales

## Setări

Tot ce ține de magazin e în **`js/config.js`**: tipurile de produs, colecțiile, paragrafele standard, variantele propuse (S/M/L). Modifici acolo și urci fișierul în GitHub.

## Instalare de la zero

1. **Supabase:** proiect nou → SQL Editor → rulează `supabase/schema.sql`. La Authentication dezactivează înregistrarea publică și adaugă utilizatorii (Auto Confirm). La URL Configuration: Site URL `https://media.theflowerstation.ro` și Redirect URL `https://media.theflowerstation.ro/**`.
2. Pune URL-ul proiectului și cheia publishable în `js/config.js`.
3. **GitHub Pages:** urcă fișierele în rădăcina repo-ului → Settings → Pages → branch `main` / root. `CNAME` setează domeniul.
4. **DNS (web365 → Zone Editor):** CNAME `media` → `calexi07.github.io`.

## Fișiere

```
index.html                     interfața
js/app.js                      logica aplicației
js/images.js                   procesarea pozelor în browser (HEIC, optimizare, culori)
js/config.js                   chei Supabase + setările magazinului
supabase/schema.sql            schema completă (instalare nouă)
supabase/migrare-07-curatare.sql  actualizare pentru instalarea existentă
CNAME                          domeniul pentru GitHub Pages
```
