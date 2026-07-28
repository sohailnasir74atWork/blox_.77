-- Value-change log: written by the value-alerts Edge Function every time a
-- manually-uploaded values file differs from the previous snapshot.
-- Powers: push alerts (already sent by the function), a future in-app
-- "Value Changes" feed, and per-item price-history charts.
-- Purely additive — no existing table, path, or shape is touched, so live
-- app versions are unaffected.

create table if not exists public.value_changes (
  id bigint generated always as identity primary key,
  game text not null,                -- 'mm2' | 'blox' | 'adoptme'
  item_slug text not null,           -- slugged item name; matches FCM topic suffix
  item_name text not null,           -- display name as it appears in the values file
  old_value numeric,
  new_value numeric,
  delta numeric generated always as (new_value - old_value) stored,
  changed_at timestamptz not null default now()
);

create index if not exists idx_value_changes_game_time
  on public.value_changes (game, changed_at desc);
create index if not exists idx_value_changes_item
  on public.value_changes (game, item_slug, changed_at desc);

alter table public.value_changes enable row level security;

-- Anyone may read (the in-app changes feed uses the anon key).
drop policy if exists value_changes_public_read on public.value_changes;
create policy value_changes_public_read
  on public.value_changes for select using (true);

-- No insert/update/delete policies: only the Edge Function's service-role
-- key can write.
