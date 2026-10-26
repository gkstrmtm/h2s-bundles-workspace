-- Review-only: shared leads/requests/calendar; no orders, dispatch, or outbound sends.
do $$
begin
  if exists(select 1 from public.commercial_leads where attribution->>'market'='residential'
    or coalesce(attribution->>'market','commercial') not in ('residential','commercial')) then
    raise exception 'Reconcile existing residential or unknown-market records before migration 037; no automatic conversion is authorized';
  end if;
end $$;
create function public.h2s_guard_lead_market() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  market text:=coalesce(new.attribution->>'market','commercial');
  availability jsonb:=coalesce(new.assessment_answers->'availabilityPreferences','[]'::jsonb);
  item jsonb;
begin
  if market not in ('residential','commercial') or
    (tg_op='UPDATE' and market is distinct from coalesce(old.attribution->>'market','commercial')) then
    raise exception 'Lead market cannot be changed or omitted on an existing residential lead' using errcode='22023';
  end if;
  if market='residential' then
    if jsonb_typeof(new.service_needs) is distinct from 'array' or jsonb_array_length(new.service_needs) not between 1 and 2
      or exists(select 1 from jsonb_array_elements_text(new.service_needs) s where s not in ('TV Mounting','Security Cameras'))
      or jsonb_typeof(availability) is distinct from 'array' or jsonb_array_length(availability)>3 then
      raise exception 'Residential services or availability are invalid' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(availability) loop
      if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'period','') not in ('morning','afternoon','evening','flexible')
        or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
        or ((item->>'date')::date)::text<>item->>'date' then
        raise exception 'Availability is a day preference, not a confirmed booking' using errcode='22023';
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger h2s_lead_market_guard before insert or update on public.commercial_leads
  for each row execute function public.h2s_guard_lead_market();
create index h2s_lead_market_submitted on public.commercial_leads
  ((coalesce(attribution->>'market','commercial')),last_submitted_at desc);

create function public.h2s_residential_intake_ready() returns text
language sql stable security invoker set search_path=public,pg_temp as $$ select '037'::text $$;
create function public.h2s_submit_residential_inquiry(p_token text,p_key text,p_lead_patch jsonb,p_request_patch jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare lead public.commercial_leads; req public.commercial_consultation_requests; saved jsonb; submitted jsonb;
begin
  if coalesce(p_lead_patch#>>'{attribution,market}','')<>'residential'
    or coalesce(p_request_patch#>>'{metadata,request_kind}','')<>'residential_inquiry'
    or coalesce(p_request_patch#>>'{metadata,submission_fingerprint}','') !~ '^[a-f0-9]{64}$' then
    raise exception 'Residential intake identity is required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('commercial-lead:'||p_token,0));
  select * into lead from public.commercial_leads where public_token=p_token for update;
  if found then
    if coalesce(lead.attribution->>'market','commercial')<>'residential' then
      raise exception 'This form cannot change a commercial inquiry' using errcode='22023';
    end if;
    select * into req from public.commercial_consultation_requests where lead_id=lead.lead_id
      and (submission_key=p_key or status in ('pending','approved','customer_confirmed','escalated','reschedule_requested'))
      order by created_at desc limit 1;
    if found then
      if req.submission_key<>p_key or req.metadata->>'submission_fingerprint' is distinct from p_request_patch#>>'{metadata,submission_fingerprint}' then
        raise exception 'This inquiry was already submitted; staff must review changes' using errcode='40001';
      end if;
      return jsonb_build_object('lead',to_jsonb(lead),'request',to_jsonb(req),'replayed',true);
    end if;
  end if;
  saved:=public.commercial_save_lead(p_token,coalesce(lead.revision,0),p_key,p_lead_patch);
  submitted:=public.commercial_submit_request((saved#>>'{lead,lead_id}')::uuid,p_key,p_request_patch);
  return jsonb_build_object('lead',saved->'lead','request',submitted->'request','replayed',not (submitted->>'created')::boolean);
end $$;

create function public.h2s_guard_inquiry_request() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare market text;
begin
  select coalesce(attribution->>'market','commercial') into market from public.commercial_leads where lead_id=new.lead_id;
  if market='residential' then
    if coalesce(new.metadata->>'request_kind','')<>'residential_inquiry'
      or new.selected_slot_start is not null or new.selected_slot_end is not null
      or new.related_order_id is not null or new.next_reminder_at is not null
      or new.status not in ('pending','approved','declined','cancelled','expired')
      or new.preferred_slots is distinct from '[]'::jsonb then
      raise exception 'A homeowner inquiry cannot create an appointment or enroll consultation automation' using errcode='22023';
    end if;
  elsif new.metadata->>'request_kind'='residential_inquiry' then
    raise exception 'Homeowner review requires a residential lead' using errcode='22023';
  end if;
  return new;
end $$;
create trigger h2s_inquiry_request_guard before insert or update on public.commercial_consultation_requests
  for each row execute function public.h2s_guard_inquiry_request();

create function public.h2s_review_residential_inquiry(p_token text,p_action text,p_note text,p_reviewer_phone text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.commercial_consultation_requests; op public.commercial_lead_operations; owner_lead uuid;
begin
  if p_action not in ('approve','decline') or p_action is null or length(p_token)<20
    or length(coalesce(p_note,''))>500 or coalesce(p_reviewer_phone,'') !~ '^\+[0-9]{7,15}$' then
    raise exception 'Valid inquiry review details required' using errcode='22023';
  end if;
  select lead_id into owner_lead from public.commercial_consultation_requests where response_token=p_token;
  perform 1 from public.commercial_leads where lead_id=owner_lead and attribution->>'market'='residential' for update;
  if not found then raise exception 'Homeowner inquiry not found' using errcode='P0002'; end if;
  select * into req from public.commercial_consultation_requests where response_token=p_token for update;
  if req.metadata->>'request_kind' is distinct from 'residential_inquiry'
    or req.assigned_technician_phone is distinct from p_reviewer_phone then
    raise exception 'This review link is not assigned to the configured residential reviewer' using errcode='22023';
  end if;
  insert into public.commercial_lead_operations(lead_id) values(owner_lead) on conflict do nothing;
  select * into op from public.commercial_lead_operations where lead_id=owner_lead for update;
  if op.disposition='closed' then raise exception 'Lead is closed; staff must review and reopen it first' using errcode='40001'; end if;
  if req.status=(case when p_action='approve' then 'approved' else 'declined' end) then
    return jsonb_build_object('request',to_jsonb(req),'replayed',true);
  end if;
  if req.status<>'pending' then raise exception 'Inquiry already changed; reload its current decision' using errcode='40001'; end if;
  update public.commercial_consultation_requests set
    status=case when p_action='approve' then 'approved' else 'declined' end,
    response_channel='web',response_at=clock_timestamp(),response_note=nullif(trim(p_note),''),updated_at=clock_timestamp()
    where request_id=req.request_id returning * into req;
  update public.commercial_lead_operations set revision=revision+1,updated_at=clock_timestamp()
    where lead_id=owner_lead returning * into op;
  insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
    values(gen_random_uuid(),owner_lead,op.revision,'review-link:'||p_reviewer_phone,'Residential inquiry reviewer',
      'residential_inquiry_'||p_action,jsonb_build_object('requestId',req.request_id,'note',coalesce(p_note,''),
        'authentication','unique_review_link','reviewerPhone',p_reviewer_phone,'bookingConfirmed',false));
  return jsonb_build_object('request',to_jsonb(req),'replayed',false);
end $$;
revoke all on function public.h2s_guard_lead_market(),public.h2s_guard_inquiry_request(),
  public.h2s_review_residential_inquiry(text,text,text,text),
  public.h2s_residential_intake_ready(),public.h2s_submit_residential_inquiry(text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.h2s_review_residential_inquiry(text,text,text,text),
  public.h2s_residential_intake_ready(),public.h2s_submit_residential_inquiry(text,text,jsonb,jsonb) to service_role;
