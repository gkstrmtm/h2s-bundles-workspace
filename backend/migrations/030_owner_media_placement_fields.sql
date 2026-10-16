-- Existing table and missing columns were inspected before adopting versioned tracking.
-- Do not recreate the upload store or change its existing rights, policies, or rows.
alter table public.owner_media_uploads
  add column frontend_destinations text[] not null default '{}'::text[],
  add column display_order integer not null default 100,
  add column psychological_weight integer not null default 20;

create index owner_media_uploads_frontend_destinations_idx
  on public.owner_media_uploads using gin (frontend_destinations);

create index owner_media_uploads_display_order_idx
  on public.owner_media_uploads (display_order asc, updated_at desc);
