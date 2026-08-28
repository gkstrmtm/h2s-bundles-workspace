-- Public partner headshots. Uploads remain server-only through the service client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'h2s-partner-headshots',
  'h2s-partner-headshots',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
