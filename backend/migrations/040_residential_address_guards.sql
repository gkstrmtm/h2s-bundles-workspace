-- Review-only. No address backfill, reservation changes, job updates or messages.
create function public.h2s_residential_address_metadata_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if (new.project_address is distinct from old.project_address
      or new.project_city is distinct from old.project_city
      or new.project_state is distinct from old.project_state
      or new.project_postal_code is distinct from old.project_postal_code)
    and new.assessment_answers->'installationAddress' is not distinct from old.assessment_answers->'installationAddress' then
    new.assessment_answers:=coalesce(new.assessment_answers,'{}'::jsonb) ||
      jsonb_build_object('installationAddress',jsonb_build_object(
        'source','manual','placeId',null,'addressLine',new.project_address,
        'city',new.project_city,'state',new.project_state,'postalCode',new.project_postal_code));
  end if;
  return new;
end $$;
create trigger h2s_residential_address_metadata_guard
  before update of project_address,project_city,project_state,project_postal_code on public.commercial_leads
  for each row execute function public.h2s_residential_address_metadata_guard();

create function public.h2s_residential_booking_address_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.commercial_leads;
begin
  if new.state<>'confirmed' then return new; end if;
  if tg_op='UPDATE' and new.state=old.state and new.starts_at=old.starts_at and new.ends_at=old.ends_at then return new; end if;
  select * into customer from public.commercial_leads where lead_id=new.lead_id for update;
  if customer.attribution->>'market'='residential' and (
    coalesce(trim(customer.project_address),'')='' or coalesce(trim(customer.project_city),'')=''
    or coalesce(trim(customer.project_state),'')='' or coalesce(trim(customer.project_postal_code),'')='') then
    raise exception 'Complete the installation street, city, state and postal code in Customer Queue before confirming installation'
      using errcode='22023';
  end if;
  return new;
end $$;
create trigger h2s_residential_booking_address_guard before insert or update on public.commercial_reservations
  for each row execute function public.h2s_residential_booking_address_guard();
revoke all on function public.h2s_residential_address_metadata_guard() from public,anon,authenticated,service_role;
revoke all on function public.h2s_residential_booking_address_guard() from public,anon,authenticated,service_role;
