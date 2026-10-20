-- =====================================================================
--  The Flower Station · Produse Shopify — schema completă
--  Doar pentru o INSTALARE NOUĂ (proiect Supabase gol).
--  Dacă aplicația merge deja, rulează doar migrare-07-curatare.sql.
--  Supabase → SQL Editor → New query → lipește tot → Run
-- =====================================================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- Categorii (aplicația folosește doar „Produse”) ----------
create table if not exists public.categories (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  slug       text not null unique,
  sort       smallint not null default 0,
  created_at timestamptz not null default now()
);
insert into public.categories (name, slug, sort) values ('Produse', 'produse', 10)
on conflict (slug) do nothing;

-- ---------- Produse ----------
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  title            text not null default '',
  handle           text unique,
  description      text,
  vendor           text default 'The Flower Station',
  product_type     text,
  collection       text,
  tags             text[]  not null default '{}',
  flowers          text[]  not null default '{}',
  colors           text[]  not null default '{}',
  colors_manual    boolean not null default false,
  price            numeric(10,2),
  compare_at_price numeric(10,2),
  status           text not null default 'draft' check (status in ('draft', 'active')),
  has_variants     boolean not null default false,
  option_name      text default 'Mărime',
  variants         jsonb not null default '[]',
  seo_title        text,
  seo_description  text,
  exported_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------- Poze ----------
create table if not exists public.assets (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  alt_text         text,
  category_id      smallint references public.categories(id) on delete set null,
  product_id       uuid references public.products(id) on delete set null,
  product_position integer,
  master_path      text not null,
  thumb_path       text not null,
  mime             text not null,
  width            integer not null,
  height           integer not null,
  size_bytes       bigint  not null,
  thumb_bytes      bigint,
  original_name    text,
  sha256           text unique,
  colors           text[]  not null default '{}',
  colors_manual    boolean not null default false,
  focal_x          real not null default 0.5,
  focal_y          real not null default 0.5,
  crop_zoom        real not null default 1,
  taken_at         timestamptz,
  kind             text not null default 'image',
  status           text not null default 'approved',
  uploaded_by      uuid references auth.users(id) on delete set null default auth.uid(),
  uploader_email   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists assets_category_idx on public.assets (category_id);
create index if not exists assets_product_idx  on public.assets (product_id, product_position);
drop trigger if exists assets_touch on public.assets;
create trigger assets_touch before update on public.assets
  for each row execute function public.touch_updated_at();

-- ---------- Sugestii de flori ----------
create table if not exists public.flowers (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  created_at timestamptz not null default now()
);
insert into public.flowers (name) values
  ('Trandafiri'), ('Trandafiri pitici'), ('Bujori'), ('Lalele'), ('Hortensii'), ('Crini'), ('Orhidee'),
  ('Gerbera'), ('Crizanteme'), ('Garoafe'), ('Frezii'), ('Lisianthus'), ('Ranunculus'), ('Alstroemeria'),
  ('Floarea-soarelui'), ('Gypsophila'), ('Eucalipt'), ('Anemone'), ('Iriși'), ('Cale'), ('Mimoza'),
  ('Matthiola'), ('Protea'), ('Clematis'), ('Viburnum'), ('Delphinium'), ('Lavandă'), ('Flori uscate'),
  ('Ruscus'), ('Pistachio'), ('Zambile'), ('Narcise')
on conflict (name) do nothing;

-- ---------- Acces: doar utilizatorii logați ----------
alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.assets     enable row level security;
alter table public.flowers    enable row level security;

do $$ declare t text; begin
  foreach t in array array['categories', 'products', 'assets', 'flowers'] loop
    execute format('drop policy if exists "team all %1$s" on public.%1$I', t);
    execute format('create policy "team all %1$s" on public.%1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Stocare: bucket public „media” (Shopify descarcă pozele de aici) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'])
on conflict (id) do update set public = true;

drop policy if exists "team upload media" on storage.objects;
drop policy if exists "team update media" on storage.objects;
drop policy if exists "team delete media" on storage.objects;
drop policy if exists "team list media"   on storage.objects;
create policy "team upload media" on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "team update media" on storage.objects for update to authenticated using (bucket_id = 'media');
create policy "team delete media" on storage.objects for delete to authenticated using (bucket_id = 'media');
create policy "team list media"   on storage.objects for select to authenticated using (bucket_id = 'media');
