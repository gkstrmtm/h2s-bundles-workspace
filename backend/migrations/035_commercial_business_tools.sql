-- Additive staff-controlled business records and commercial email evidence.
create table public.commercial_business_records (
  lead_id uuid primary key references public.commercial_leads(lead_id),
  revision integer not null default 0 check (revision >= 0),
  quote jsonb,
  payments jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array'),
  updated_at timestamptz not null default now()
);
create table public.commercial_business_activity (
  operation_id uuid primary key,
  lead_id uuid not null references public.commercial_leads(lead_id),
  revision integer not null,
  actor jsonb not null,
  action text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(lead_id, revision)
);
create table public.commercial_emails (
  email_id uuid primary key,
  lead_id uuid not null references public.commercial_leads(lead_id),
  request_id uuid references public.commercial_consultation_requests(request_id),
  purpose text not null check (purpose in ('receipt','staff_follow_up')),
  recipient text not null,
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  sender text not null,
  reply_to text not null,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=3),
  actor jsonb not null,
  send_state text not null default 'processing' check (send_state in ('processing','accepted','failed','uncertain')),
  delivery_state text not null default 'pending' check (delivery_state in ('pending','delivered','failed','needs_review')),
  provider_id text,
  error_code text,
  retry_safe boolean not null default false,
  attempt integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  delivery_at timestamptz,
  delivery_reason text,
  unique(provider_id)
);
create unique index commercial_email_one_receipt on public.commercial_emails(request_id)
  where purpose = 'receipt';
create index commercial_emails_lead on public.commercial_emails(lead_id, created_at desc);
create table public.commercial_email_events (
  event_id text primary key,
  email_id uuid not null references public.commercial_emails(email_id),
  event text not null,
  occurred_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now()
);
create table public.commercial_email_suppressions (
  recipient text primary key,
  reason text not null,
  updated_at timestamptz not null default now()
);
create table public.commercial_business_files (
  file_id uuid primary key,
  lead_id uuid not null references public.commercial_leads(lead_id),
  job_id uuid references public.h2s_dispatch_jobs(job_id),
  contact_operation_id uuid references public.commercial_lead_activity(operation_id),
  purpose text not null check (purpose in ('contact_note','installation_proof','quote_document','payment_evidence')),
  filename text not null,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size integer not null check (byte_size between 1 and 3145728),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  object_path text not null unique,
  note text not null default '',
  actor jsonb not null,
  state text not null default 'pending' check (state in ('pending','ready')),
  created_at timestamptz not null default now()
);

create function public.commercial_business_record(
  p_lead_id uuid, p_revision integer, p_operation_id uuid, p_actor jsonb, p_action text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  s public.commercial_business_records;
  e public.commercial_business_activity;
  payment jsonb;
  total bigint;
begin
  perform 1 from public.commercial_leads where lead_id = p_lead_id for update;
  if not found then raise exception using errcode='22023', message='Lead not found.'; end if;
  select * into e from public.commercial_business_activity where operation_id=p_operation_id;
  if found then
    if e.lead_id<>p_lead_id or e.action<>p_action or e.payload<>p_payload or e.actor<>p_actor then
      raise exception using errcode='22023', message='Operation identifier was already used for different information.';
    end if;
    return jsonb_build_object('replayed',true);
  end if;
  if coalesce(p_actor->>'role','')<>'ADMIN' or coalesce(p_actor->>'id','')='' then
    raise exception using errcode='42501', message='Administrator identity required.';
  end if;
  insert into public.commercial_business_records(lead_id) values(p_lead_id) on conflict do nothing;
  select * into s from public.commercial_business_records where lead_id=p_lead_id for update;
  if s.revision<>p_revision then
    raise exception using errcode='40001', message='Business records changed. Review the latest record; your draft is retained.';
  end if;
  if p_action='quote' then
    if not(p_payload ?& array['currency','amountCents','status','terms','depositCents','approvalNote','note'])
      or p_payload->>'currency'<>'usd' or (p_payload->>'amountCents')::bigint not between 1 and 100000000
      or p_payload->>'status' not in ('draft','sent','accepted','declined')
      or p_payload->>'terms' not in ('full','deposit')
      or (p_payload->>'depositCents')::bigint not between 0 and (p_payload->>'amountCents')::bigint
      or (p_payload->>'terms'='deposit' and (p_payload->>'depositCents')::bigint=0)
      or (p_payload->>'status'='accepted' and length(coalesce(p_payload->>'approvalNote',''))<3) then
      raise exception using errcode='22023', message='Review the quote amount, terms and recorded approval.';
    end if;
    select coalesce(sum((x->>'amountCents')::bigint),0) into total from jsonb_array_elements(s.payments) x
      where x->>'state'<>'voided';
    if total>0 and (s.quote->>'amountCents'<>p_payload->>'amountCents'
      or s.quote->>'terms'<>p_payload->>'terms' or s.quote->>'depositCents'<>p_payload->>'depositCents') then
      raise exception using errcode='22023', message='A quote with payment records cannot be silently repriced. Record an adjustment separately.';
    end if;
    update public.commercial_business_records set quote=p_payload where lead_id=p_lead_id;
  elsif p_action='payment' then
    if not(p_payload ?& array['amountCents','state','method','note','receivedAt','reference'])
      or s.quote is null or (p_payload->>'amountCents')::bigint not between 1 and 100000000
      or p_payload->>'state' not in ('reported','confirmed')
      or p_payload->>'method' not in ('cash','check','bank_transfer','external_card','stripe_reference','other')
      or length(coalesce(p_payload->>'note',''))<3
      or (p_payload->>'receivedAt')::timestamptz > now()+interval '5 minutes' then
      raise exception using errcode='22023', message='Record a quote and valid payment facts, including how receipt was checked.';
    end if;
    payment=p_payload||jsonb_build_object('id',p_operation_id,'recordedBy',p_actor);
    update public.commercial_business_records set payments=payments||jsonb_build_array(payment) where lead_id=p_lead_id;
  elsif p_action='payment_void' then
    if length(coalesce(p_payload->>'reason',''))<3
      or not exists(select 1 from jsonb_array_elements(s.payments) x where x->>'id'=p_payload->>'paymentId'
        and x->>'state'<>'voided') then
      raise exception using errcode='22023', message='Select an active payment record and explain the correction. This does not refund money.';
    end if;
    update public.commercial_business_records set payments=(select jsonb_agg(case
      when x->>'id'=p_payload->>'paymentId' then x||jsonb_build_object('state','voided','voidReason',p_payload->>'reason',
        'voidedAt',now(),'voidedBy',p_actor) else x end) from jsonb_array_elements(s.payments) x) where lead_id=p_lead_id;
  else
    raise exception using errcode='22023', message='Unsupported business operation.';
  end if;
  update public.commercial_business_records set revision=revision+1,updated_at=now() where lead_id=p_lead_id returning * into s;
  insert into public.commercial_business_activity values(p_operation_id,p_lead_id,s.revision,p_actor,p_action,p_payload,now());
  return jsonb_build_object('replayed',false);
end $$;

create function public.commercial_email_contact(p_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare m public.commercial_emails; revision_value integer;
begin
  select * into m from public.commercial_emails where email_id=p_id;
  if not found or m.purpose<>'staff_follow_up' or not(m.send_state='accepted' or m.delivery_state='delivered') then
    return jsonb_build_object('recorded',false);
  end if;
  perform 1 from public.commercial_leads where lead_id=m.lead_id for update;
  if exists(select 1 from public.commercial_lead_activity where operation_id=p_id) then
    if not exists(select 1 from public.commercial_lead_activity where operation_id=p_id and lead_id=m.lead_id and action='email') then
      raise exception using errcode='22023', message='Email activity identifier belongs to another operation.';
    end if;
    return jsonb_build_object('recorded',true);
  end if;
  insert into public.commercial_lead_operations(lead_id) values(m.lead_id) on conflict do nothing;
  update public.commercial_lead_operations set revision=revision+1,updated_at=now() where lead_id=m.lead_id returning revision into revision_value;
  insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
    values(p_id,m.lead_id,revision_value,m.actor->>'id',m.actor->>'name','email',jsonb_build_object('emailId',p_id,
      'contact',jsonb_build_object('channel','email','outcome','email_submitted',
        'note','Staff email submitted to SendGrid. See recorded email delivery evidence. Subject: '||m.subject)));
  return jsonb_build_object('recorded',true);
end $$;

create function public.commercial_email_claim(p_id uuid, p_lead_id uuid, p_request_id uuid, p_purpose text,
  p_content jsonb, p_actor jsonb, p_retry boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare l public.commercial_leads; m public.commercial_emails; blocked boolean;
begin
  if p_purpose='staff_follow_up' and (coalesce(p_actor->>'role','')<>'ADMIN'
    or coalesce(p_actor->>'id','')='' or coalesce(p_actor->>'name','')='') then
    raise exception using errcode='42501', message='Administrator identity required.';
  end if;
  select * into l from public.commercial_leads where lead_id=p_lead_id for update;
  if not found then raise exception using errcode='22023', message='Lead not found.'; end if;
  if lower(trim(coalesce(l.email,'')))<>lower(p_content->>'recipient') or coalesce(l.email,'')='' then
    raise exception using errcode='22023', message='The saved customer email changed. Review it before sending.';
  end if;
  if p_purpose='receipt' and not exists(select 1 from public.commercial_consultation_requests r where
    r.request_id=p_request_id and r.lead_id=p_lead_id and r.metadata->>'request_kind'='manual_follow_up'
    and r.metadata->>'contact_preference'='email') then
    raise exception using errcode='22023', message='Automatic receipts are restricted to submitted Email-first requests.';
  end if;
  select * into m from public.commercial_emails where email_id=p_id or
    (p_purpose='receipt' and request_id=p_request_id and purpose='receipt') for update;
  if found then
    if m.lead_id<>p_lead_id or m.purpose<>p_purpose or m.recipient<>p_content->>'recipient'
      or m.subject<>p_content->>'subject' or m.body<>p_content->>'body'
      or m.attachments<>coalesce(p_content->'attachments','[]'::jsonb) then
      raise exception using errcode='22023', message='This send identifier belongs to a different email. Review before sending.';
    end if;
    if not(p_retry and m.send_state='failed' and m.retry_safe) then
      return jsonb_build_object('claimed',false,'email',to_jsonb(m));
    end if;
  end if;
  select exists(select 1 from public.commercial_email_suppressions where recipient=lower(p_content->>'recipient')) into blocked;
  if blocked then raise exception using errcode='22023', message='Email is suppressed after a bounce or opt-out. Staff must resolve consent/address before sending.'; end if;
  if m.email_id is null then
    insert into public.commercial_emails(email_id,lead_id,request_id,purpose,recipient,subject,body,sender,reply_to,attachments,actor)
    values(p_id,p_lead_id,p_request_id,p_purpose,p_content->>'recipient',p_content->>'subject',p_content->>'body',
      p_content->>'sender',p_content->>'replyTo',coalesce(p_content->'attachments','[]'::jsonb),p_actor) returning * into m;
  else
    update public.commercial_emails set send_state='processing',retry_safe=false,error_code=null,
      sender=p_content->>'sender',reply_to=p_content->>'replyTo',attempt=attempt+1,updated_at=now()
      where email_id=m.email_id returning * into m;
  end if;
  return jsonb_build_object('claimed',true,'email',to_jsonb(m));
end $$;

create function public.commercial_email_finish(p_id uuid,p_state text,p_provider_id text,p_error text,p_retry_safe boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare m public.commercial_emails;
begin
  select * into m from public.commercial_emails where email_id=p_id;
  if found then perform 1 from public.commercial_leads where lead_id=m.lead_id for update; end if;
  select * into m from public.commercial_emails where email_id=p_id for update;
  if not found or p_state not in ('accepted','failed','uncertain') then
    raise exception using errcode='22023', message='Invalid email result.';
  end if;
  if m.provider_id is not null and p_provider_id is not null and split_part(m.provider_id,'.',1)<>split_part(p_provider_id,'.',1) then
    raise exception using errcode='22023', message='Provider email correlation mismatch.';
  end if;
  if m.send_state<>'processing' then return to_jsonb(m); end if;
  update public.commercial_emails set send_state=p_state,provider_id=coalesce(provider_id,p_provider_id),
    error_code=p_error,retry_safe=p_retry_safe and p_state='failed',updated_at=now(),
    accepted_at=case when p_state='accepted' then now() else accepted_at end where email_id=p_id returning * into m;
  if m.purpose='receipt' then
    update public.commercial_consultation_requests set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),
      '{customer_email_receipt}',jsonb_build_object('state',m.send_state,'deliveryState',m.delivery_state,
        'updatedAt',m.updated_at),true) where request_id=m.request_id;
  end if;
  perform public.commercial_email_contact(p_id);
  return to_jsonb(m);
end $$;

create function public.commercial_email_event(p_id uuid,p_event jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare m public.commercial_emails; kind text=p_event->>'event'; occurred timestamptz;
  next_state text; event_id text=p_event->>'eventId'; inserted integer;
begin
  select * into m from public.commercial_emails where email_id=p_id;
  if found then perform 1 from public.commercial_leads where lead_id=m.lead_id for update; end if;
  select * into m from public.commercial_emails where email_id=p_id for update;
  if not found then return jsonb_build_object('correlated',false); end if;
  if lower(m.recipient)<>lower(p_event->>'recipient') or
    (m.provider_id is not null and split_part(m.provider_id,'.',1)<>split_part(p_event->>'providerId','.',1)) then
    raise exception using errcode='22023', message='Email callback correlation mismatch.';
  end if;
  occurred=(p_event->>'occurredAt')::timestamptz;
  insert into public.commercial_email_events(event_id,email_id,event,occurred_at,reason)
    values(event_id,p_id,kind,occurred,left(p_event->>'reason',500)) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then
    if not exists(select 1 from public.commercial_email_events e where e.event_id=p_event->>'eventId'
      and e.email_id=p_id and e.event=kind and e.occurred_at=occurred) then
      raise exception using errcode='22023', message='Email event identifier correlation mismatch.';
    end if;
    return jsonb_build_object('correlated',true,'replayed',true);
  end if;
  if kind in ('processed','deferred','delivered','bounce','dropped') then
    update public.commercial_emails set send_state='accepted',provider_id=coalesce(provider_id,p_event->>'providerId'),
      accepted_at=coalesce(accepted_at,occurred),retry_safe=false,updated_at=now() where email_id=p_id returning * into m;
  end if;
  next_state=case when kind='delivered' then 'delivered'
    when kind in ('bounce','dropped') then 'failed' else null end;
  if kind in ('bounce','spamreport','unsubscribe','group_unsubscribe') then
    insert into public.commercial_email_suppressions values(lower(m.recipient),kind,now())
      on conflict(recipient) do update set reason=excluded.reason,updated_at=excluded.updated_at;
  end if;
  if next_state is not null and (m.delivery_at is null or occurred>=m.delivery_at) then
    update public.commercial_emails set delivery_state=case
      when (delivery_state='failed' and next_state='delivered') or
        (delivery_state='delivered' and next_state='failed') then 'needs_review'
      when delivery_state='needs_review' then 'needs_review' else next_state end,
      delivery_at=occurred,delivered_at=case when kind='delivered' then occurred else delivered_at end,
      provider_id=coalesce(provider_id,p_event->>'providerId'),
      delivery_reason=case when next_state='failed' then left(p_event->>'reason',500) else delivery_reason end,
      updated_at=now() where email_id=p_id returning * into m;
  end if;
  if m.purpose='receipt' then
    update public.commercial_consultation_requests set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),
      '{customer_email_receipt}',jsonb_build_object('state',m.send_state,'deliveryState',m.delivery_state,
        'updatedAt',m.updated_at),true) where request_id=m.request_id;
  end if;
  perform public.commercial_email_contact(p_id);
  return jsonb_build_object('correlated',true,'replayed',false);
end $$;

create function public.commercial_file_record(p_id uuid,p_lead_id uuid,p_actor jsonb,p_file jsonb,p_complete boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare f public.commercial_business_files; s public.commercial_business_records; job uuid;
begin
  if coalesce(p_actor->>'role','')<>'ADMIN' or coalesce(p_actor->>'id','')='' then
    raise exception using errcode='42501', message='Administrator identity required.';
  end if;
  perform 1 from public.commercial_leads where lead_id=p_lead_id for update;
  if not found then raise exception using errcode='22023', message='Lead not found.'; end if;
  select * into f from public.commercial_business_files where file_id=p_id for update;
  if found then
    if f.lead_id<>p_lead_id or f.sha256<>p_file->>'sha256' or f.purpose<>p_file->>'purpose'
      or f.filename<>p_file->>'filename' or f.note<>p_file->>'note'
      or f.contact_operation_id is distinct from nullif(p_file->>'contactId','')::uuid then
      raise exception using errcode='22023', message='Upload identifier belongs to another attachment.';
    end if;
  elsif p_complete then
    raise exception using errcode='22023', message='Upload reservation not found.';
  else
    select installation_job_id into job from public.commercial_lead_operations where lead_id=p_lead_id;
    if p_file->>'purpose'='installation_proof' and job is null then
      raise exception using errcode='22023', message='Link the installation before uploading its proof.';
    end if;
    if nullif(p_file->>'contactId','') is not null and (p_file->>'purpose'<>'contact_note' or not exists(
      select 1 from public.commercial_lead_activity where operation_id=(p_file->>'contactId')::uuid
        and lead_id=p_lead_id and payload ? 'contact')) then
      raise exception using errcode='22023', message='Select a contact attempt belonging to this lead.';
    end if;
    if p_file->>'purpose'='contact_note' and nullif(p_file->>'contactId','') is null
      and length(coalesce(p_file->>'note',''))<3 then
      raise exception using errcode='22023', message='Write a contact note or choose its recorded contact attempt.';
    end if;
    insert into public.commercial_business_files(file_id,lead_id,job_id,contact_operation_id,purpose,filename,content_type,byte_size,sha256,object_path,note,actor)
      values(p_id,p_lead_id,case when p_file->>'purpose'='installation_proof' then job else null end,
        nullif(p_file->>'contactId','')::uuid,
        p_file->>'purpose',p_file->>'filename',p_file->>'contentType',(p_file->>'byteSize')::integer,
        p_file->>'sha256',p_lead_id::text||'/'||p_id::text,p_file->>'note',p_actor) returning * into f;
  end if;
  if p_complete and f.state='pending' then
    update public.commercial_business_files set state='ready' where file_id=p_id returning * into f;
    insert into public.commercial_business_records(lead_id) values(p_lead_id) on conflict do nothing;
    update public.commercial_business_records set revision=revision+1,updated_at=now() where lead_id=p_lead_id returning * into s;
    insert into public.commercial_business_activity values(p_id,p_lead_id,s.revision,p_actor,'attachment',
      jsonb_build_object('fileId',p_id,'filename',f.filename,'purpose',f.purpose,'note',f.note,
        'jobId',f.job_id,'contactId',f.contact_operation_id),now());
  end if;
  return to_jsonb(f);
end $$;

alter table public.commercial_business_records enable row level security;
alter table public.commercial_business_activity enable row level security;
alter table public.commercial_emails enable row level security;
alter table public.commercial_email_events enable row level security;
alter table public.commercial_email_suppressions enable row level security;
alter table public.commercial_business_files enable row level security;
revoke all on public.commercial_business_records,public.commercial_business_activity,public.commercial_emails,
  public.commercial_email_events,public.commercial_email_suppressions,public.commercial_business_files from public,anon,authenticated,service_role;
grant select on public.commercial_business_records,public.commercial_business_activity,public.commercial_emails,
  public.commercial_email_events,public.commercial_email_suppressions,public.commercial_business_files to service_role;
revoke all on function public.commercial_business_record(uuid,integer,uuid,jsonb,text,jsonb),
  public.commercial_email_contact(uuid),
  public.commercial_email_claim(uuid,uuid,uuid,text,jsonb,jsonb,boolean),
  public.commercial_email_finish(uuid,text,text,text,boolean),public.commercial_email_event(uuid,jsonb),
  public.commercial_file_record(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.commercial_business_record(uuid,integer,uuid,jsonb,text,jsonb),
  public.commercial_email_contact(uuid),
  public.commercial_email_claim(uuid,uuid,uuid,text,jsonb,jsonb,boolean),
  public.commercial_email_finish(uuid,text,text,text,boolean),public.commercial_email_event(uuid,jsonb),
  public.commercial_file_record(uuid,uuid,jsonb,jsonb,boolean) to service_role;

do $$
begin
  if to_regclass('storage.buckets') is null then raise exception 'Supabase Storage prerequisites missing.'; end if;
  if not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity)
    or exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polpermissive
      and (0=any(polroles) or exists(select 1 from unnest(polroles) role_id where role_id<>0
        and (pg_has_role('anon',role_id,'USAGE') or pg_has_role('authenticated',role_id,'USAGE'))))) then
    raise exception 'Private Storage requires verified default-deny object policies for browser roles; reconcile policies first.';
  end if;
  if exists(select 1 from storage.buckets where id='commercial-private-files') then
    raise exception 'commercial-private-files already exists; reconcile its privacy and limits before migration.';
  end if;
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('commercial-private-files','commercial-private-files',false,3145728,
      array['image/jpeg','image/png','image/webp','application/pdf']);
end $$;
