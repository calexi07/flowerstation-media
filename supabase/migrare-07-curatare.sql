-- =====================================================================
--  Actualizare 07 — Aplicația devine doar pentru produse Shopify
--  Rulează O SINGURĂ DATĂ în: Supabase → SQL Editor → New query → Run
--  Nu șterge nimic: doar adaugă florile și culorile pe produs.
-- =====================================================================

alter table public.products add column if not exists flowers       text[]  not null default '{}';
alter table public.products add column if not exists colors        text[]  not null default '{}';
alter table public.products add column if not exists colors_manual boolean not null default false;

-- Lista de sugestii de flori (dacă nu există deja)
create table if not exists public.flowers (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  created_at timestamptz not null default now()
);
alter table public.flowers enable row level security;
drop policy if exists "team read flowers"  on public.flowers;
drop policy if exists "team write flowers" on public.flowers;
create policy "team read flowers"  on public.flowers for select to authenticated using (true);
create policy "team write flowers" on public.flowers for all    to authenticated using (true) with check (true);

-- Florile completate deja pe poze trec pe produsele lor (o singură dată, dacă există)
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'assets' and column_name = 'flowers') then
    update public.products p
    set flowers = sub.fl
    from (
      select product_id, array_agg(distinct f) as fl
      from public.assets, unnest(flowers) as f
      where product_id is not null
      group by product_id
    ) sub
    where sub.product_id = p.id and p.flowers = '{}';
  end if;
end $$;
