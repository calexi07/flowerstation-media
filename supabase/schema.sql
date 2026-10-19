-- =====================================================================
--  The Flower Station · Media Library — schema Supabase
--  Rulează o singură dată în: Supabase → SQL Editor → New query → Run
-- =====================================================================

-- ---------- Categorii ----------
create table if not exists public.categories (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  slug       text not null unique,
  sort       smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into public.categories (name, slug, sort) values
  ('Produse',          'produse',          10),
  ('Branding & logo',  'branding',         20),
  ('Interior magazin', 'interior',         30),
  ('Exterior magazin', 'exterior',         40),
  ('Evenimente',       'evenimente',       50),
  ('Echipă',           'echipa',           60),
  ('Lifestyle & social','lifestyle',       70)
on conflict (slug) do nothing;

-- ---------- Asset-uri (poze) ----------
create table if not exists public.assets (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  alt_text       text,                         -- text alternativ (SEO / accesibilitate)
  credit         text,                         -- fotograf / sursă
  category_id    smallint references public.categories(id) on delete set null,
  tags           text[] not null default '{}',

  master_path    text not null,                -- versiunea web (JPG/PNG), link public
  thumb_path     text not null,                -- miniatură WebP
  original_path  text,                         -- originalul (opțional)

  mime           text not null,
  width          integer not null,
  height         integer not null,
  size_bytes     bigint  not null,             -- mărimea versiunii master
  original_name  text,
  original_bytes bigint,
  thumb_bytes    bigint,
  sha256         text unique,                  -- detectare duplicate
  color          text,                         -- culoare dominantă (#rrggbb) pt. placeholder
  focal_x        real not null default 0.5,    -- punct de focus pt. crop-uri (0..1)
  focal_y        real not null default 0.5,

  uploaded_by    uuid references auth.users(id) on delete set null default auth.uid(),
  uploader_email text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists assets_created_idx  on public.assets (created_at desc);
create index if not exists assets_category_idx on public.assets (category_id);
create index if not exists assets_tags_idx     on public.assets using gin (tags);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists assets_touch on public.assets;
create trigger assets_touch before update on public.assets
  for each row execute function public.touch_updated_at();

-- ---------- RLS: doar utilizatorii logați (echipa) ----------
alter table public.categories enable row level security;
alter table public.assets     enable row level security;

drop policy if exists "team read categories"  on public.categories;
drop policy if exists "team write categories" on public.categories;
create policy "team read categories"  on public.categories for select to authenticated using (true);
create policy "team write categories" on public.categories for all    to authenticated using (true) with check (true);

drop policy if exists "team read assets"   on public.assets;
drop policy if exists "team insert assets" on public.assets;
drop policy if exists "team update assets" on public.assets;
drop policy if exists "team delete assets" on public.assets;
create policy "team read assets"   on public.assets for select to authenticated using (true);
create policy "team insert assets" on public.assets for insert to authenticated with check (true);
create policy "team update assets" on public.assets for update to authenticated using (true) with check (true);
create policy "team delete assets" on public.assets for delete to authenticated using (true);

-- ---------- Storage: bucket public "media" ----------
-- Public = oricine are link-ul poate vedea poza (necesar pt. site, newsletter, social).
-- Listarea, încărcarea și ștergerea rămân doar pentru echipă.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/avif','image/heic','image/heif'])
on conflict (id) do update set public = true;

drop policy if exists "team upload media" on storage.objects;
drop policy if exists "team update media" on storage.objects;
drop policy if exists "team delete media" on storage.objects;
drop policy if exists "team list media"   on storage.objects;
create policy "team upload media" on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "team update media" on storage.objects for update to authenticated using (bucket_id = 'media');
create policy "team delete media" on storage.objects for delete to authenticated using (bucket_id = 'media');
create policy "team list media"   on storage.objects for select to authenticated using (bucket_id = 'media');
