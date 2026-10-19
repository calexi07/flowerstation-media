# The Flower Station · Media Library

Bibliotecă internă de imagini (produse, branding, interior/exterior magazin, evenimente…) pentru echipa TheFlowerStation.ro. Găzduită pe **media.theflowerstation.ro**.

**Stack:** HTML + vanilla JS (ES modules) + Tailwind CDN, fără build · Supabase (Auth + Postgres + Storage) · GitHub Pages.

## Ce face

- **Login** pentru echipă (email + parolă sau link magic). Fără înregistrare publică.
- **Upload în masă** prin drag & drop oriunde pe pagină. Categorie, tag-uri și credit se aplică întregului lot; titlul se editează per fișier.
- **Optimizare automată în browser:** se salvează o versiune master de max. 2400 px (JPG, sau PNG dacă are transparență) + miniatură WebP. Originalul se păstrează doar dacă bifezi opțiunea. Poze iPhone (HEIC) sunt convertite automat. SVG și GIF rămân neschimbate.
- **Detectare duplicate** (amprentă SHA-256 a fișierului).
- **Căutare** după titlu, tag-uri, text alternativ, descriere, credit, categorie — funcționează cu sau fără diacritice („vitrina” găsește „vitrină”).
- **Filtre:** categorie, orientare, tag-uri (cumulative). Sortare.
- **Link public direct** pentru site/Shopify/newsletter, plus snippet HTML (`<img>` cu alt, width, height) și Markdown — util și pentru blog.
- **Download în formate:** Web 1600, Instagram 1:1 și 4:5, Story 9:16, Facebook/link 1200×630, Banner 1920×800. Crop-ul se face în jurul **punctului de focus** (click pe imagine în fereastra de detaliu).
- **Produse — flori și culori:** la categoria *Produse* alegi florile din imagine (listă care crește singură când adaugi flori noi), iar culorile buchetului se detectează automat la upload (fundalul și verdeața sunt ignorate). Le poți corecta manual din fereastra de detaliu; „↻ Detectează automat” revine la sugestia automată. Filtre pe culori și flori în sidebar; căutarea găsește și după flori/culori.
- **Selecție multiplă:** adaugă tag, mută în categorie, descarcă ZIP, șterge.
- Link direct către o imagine pentru colegi: `media.theflowerstation.ro/#a=<id>`.
- Indicator de spațiu folosit în sidebar.

## Instalare (≈15 minute)

### 1. Supabase
1. Creează un proiect nou pe [supabase.com](https://supabase.com) (regiune: Frankfurt `eu-central-1`).
2. **SQL Editor → New query** → lipește tot din `supabase/schema.sql` → **Run**. Creează tabelele, categoriile inițiale, politicile RLS și bucket-ul public `media`.
3. **Authentication → Sign In / Providers → Email:** dezactivează **Allow new users to sign up** (doar tu adaugi conturi).
4. **Authentication → URL Configuration:**
   - Site URL: `https://media.theflowerstation.ro`
   - Redirect URLs: adaugă `https://media.theflowerstation.ro/**` (și `http://localhost:*/**` pentru test local).
5. **Authentication → Users → Add user / Invite user** pentru fiecare coleg.
6. **Project Settings → API:** copiază *Project URL* și cheia *anon / publishable* în `js/config.js`.

### 2. GitHub Pages
1. Repo nou (ex. `flowerstation-media`), urcă toate fișierele din acest folder.
2. **Settings → Pages:** Source = *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Fișierul `CNAME` setează deja domeniul `media.theflowerstation.ro`.

### 3. DNS (la registrarul domeniului theflowerstation.ro)
Adaugă un record:

| Tip   | Nume / Host | Valoare                      |
|-------|-------------|------------------------------|
| CNAME | `media`     | `<user-github>.github.io`    |

Atenție: dacă domeniul e gestionat prin Shopify (Shopify → Settings → Domains), adaugă recordul din **Domains → theflowerstation.ro → DNS settings**. Nu atinge recordurile existente pentru `@` și `www` — acelea țin site-ul Shopify.

După propagare (de la câteva minute la câteva ore): GitHub → Settings → Pages → bifează **Enforce HTTPS**.

### 4. Test local (opțional)
```bash
npx serve .        # sau: python3 -m http.server 8080
```
Deschide `http://localhost:3000` (sau portul afișat). Fișierele nu merg deschise direct cu dublu-click (ES modules au nevoie de un server).

## Spațiu & costuri

Planul **Free** Supabase: 1 GB storage, 5 GB trafic/lună, iar proiectul se **pune pe pauză după o săptămână fără activitate** (se reactivează din dashboard). Cu optimizarea automată, o fotografie ocupă ~0,4–0,9 MB → aproximativ 1.200–2.000 de imagini în 1 GB.

Când crește biblioteca sau vrei să nu se mai pună pe pauză: **Pro, $25/lună** — 100 GB storage, 250 GB trafic. Schimbă apoi `STORAGE_QUOTA_BYTES` din `js/config.js`.

**Recomandare pentru site:** linkurile publice merg perfect în Shopify, newsletter și blog. Pentru imaginile *permanente* din tema Shopify (hero, colecții), urcă-le totuși în Shopify (Content → Files) — trec prin CDN-ul Shopify, cu redimensionare automată, și nu consumă traficul Supabase.

## Structură

```
index.html          UI (login, bibliotecă, detaliu, upload)
js/config.js        chei Supabase + formate de export
js/images.js        procesare imagini în browser (master, miniatură, HEIC, crop-uri)
js/app.js           logica aplicației
supabase/schema.sql tabele, RLS, bucket
CNAME               domeniul custom pentru GitHub Pages
```

Fișierele din storage: `media/AAAA/LL/<id>/<titlu-slug>.jpg` (nume prietenoase SEO) + `thumb.webp` + opțional `original-<titlu>.<ext>`.
