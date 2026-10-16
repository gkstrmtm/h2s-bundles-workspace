-- Run after PROOF_PACK_SCHEMA.sql and initialization of owner_media_uploads.
create table public.media_placements (
  proof_asset_id uuid references public.proof_assets(asset_id) on delete cascade,
  owner_asset_id text references public.owner_media_uploads(asset_id) on delete cascade,
  asset_source text generated always as (
    case when proof_asset_id is not null then 'proof_asset' else 'owner_media' end
  ) stored,
  asset_id text generated always as (coalesce(proof_asset_id::text, owner_asset_id)) stored,
  surface text not null,
  area text not null,
  enabled boolean not null default true,
  display_order integer not null default 100 check (display_order between 0 and 999),
  fit text not null default 'cover' check (fit in ('cover', 'contain')),
  focal_x numeric not null default 50 check (focal_x between 0 and 100),
  focal_y numeric not null default 50 check (focal_y between 0 and 100),
  zoom numeric not null default 1 check (zoom between 1 and 3),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (asset_source, asset_id, surface, area),
  constraint media_placements_one_asset check (
    (proof_asset_id is not null)::integer + (owner_asset_id is not null)::integer = 1
  ),
  constraint media_placements_area check (
    surface ~ '^[a-z][a-z0-9_]{0,79}$' and area ~ '^[a-z][a-z0-9_]{0,79}$'
  )
);

create index media_placements_surface_area_idx
  on public.media_placements (surface, area, display_order, asset_id);

alter table public.media_placements enable row level security;
revoke all on public.media_placements from public, anon, authenticated;
grant select, insert, update, delete on public.media_placements to service_role;
comment on table public.media_placements is
  'Non-destructive per-page/display-area overrides. Absence inherits legacy selection; disabled excludes only this asset in this area.';
