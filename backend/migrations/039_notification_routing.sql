-- Review-only. No recipients are seeded, reassigned, contacted or verified.
create table public.notification_routing (
  route_key text primary key check (route_key='residential_owner'),
  phone text not null check (phone ~ '^\+[1-9][0-9]{10,14}$'),
  revision integer not null check (revision>0),
  updated_at timestamptz not null default now(),
  updated_by jsonb not null check (jsonb_typeof(updated_by)='object')
);
create table public.notification_routing_activity (
  activity_id uuid primary key default gen_random_uuid(),
  route_key text not null references public.notification_routing(route_key),
  revision integer not null check (revision>0),
  previous_phone text,
  phone text not null,
  previous_source text not null check (previous_source in ('environment','saved')),
  actor jsonb not null,
  changed_at timestamptz not null default now(),
  unique (route_key,revision)
);
alter table public.notification_routing enable row level security;
alter table public.notification_routing_activity enable row level security;
revoke all on public.notification_routing,public.notification_routing_activity from public,anon,authenticated,service_role;
grant select on public.notification_routing,public.notification_routing_activity to service_role;

create function public.h2s_save_notification_routing(p_phone text,p_revision integer,p_actor jsonb,p_fallback_phone text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare current_route public.notification_routing; saved public.notification_routing;
begin
  if coalesce(p_phone,'') !~ '^\+[1-9][0-9]{10,14}$' or p_revision is null or p_revision<0
    or coalesce(p_actor->>'role','')<>'ADMIN' or coalesce(trim(p_actor->>'id'),'')=''
    or coalesce(trim(p_actor->>'name'),'')=''
    or (p_fallback_phone is not null and p_fallback_phone !~ '^\+[1-9][0-9]{10,14}$') then
    raise exception 'Valid administrator, phone and routing revision required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('h2s/notification-routing/residential-owner'));
  select * into current_route from public.notification_routing where route_key='residential_owner' for update;
  if coalesce(current_route.revision,0)<>p_revision then
    raise exception 'Notification routing changed; reload saved routing before retrying' using errcode='40001';
  end if;
  insert into public.notification_routing(route_key,phone,revision,updated_by)
    values('residential_owner',p_phone,p_revision+1,p_actor)
    on conflict(route_key) do update set phone=excluded.phone,revision=excluded.revision,
      updated_at=now(),updated_by=excluded.updated_by
    returning * into saved;
  insert into public.notification_routing_activity(route_key,revision,previous_phone,phone,previous_source,actor)
    values(saved.route_key,saved.revision,coalesce(current_route.phone,p_fallback_phone),saved.phone,
      case when current_route.revision is null then 'environment' else 'saved' end,p_actor);
  return jsonb_build_object('phone',saved.phone,'revision',saved.revision,'source','saved',
    'updatedAt',saved.updated_at,'updatedBy',saved.updated_by);
end $$;
revoke all on function public.h2s_save_notification_routing(text,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.h2s_save_notification_routing(text,integer,jsonb,text) to service_role;
