-- REVIEW ONLY. Extends the existing immutable agreement/artifact/delivery authorities.
-- No policy approval, customer acceptance, data backfill or payment is performed by this migration.
begin;
do $$ begin
  if not public.field_sales_native_staging_scope() then
    raise exception '056 requires the verified UUID-owned native sandbox' using errcode='42501';
  end if;
end $$;
alter table public.field_sales_agreement_policies add column customer_document jsonb
  check(customer_document is null or jsonb_typeof(customer_document)='object');

create function public.field_sales_signature_holidays(p_year integer) returns setof date
language sql immutable set search_path=pg_catalog,public as $$
  with fixed(day) as (
    select make_date(p_year,m,d) from (values(1,1),(6,19),(7,4),(11,11),(12,25)) f(m,d)
  ), floating(day) as (
    select first_day+((weekday-extract(isodow from first_day)::integer+7)%7)+7*(ordinal-1)
    from (values(make_date(p_year,1,1),1,3),(make_date(p_year,2,1),1,3),
      (make_date(p_year,9,1),1,1),(make_date(p_year,10,1),1,2),
      (make_date(p_year,11,1),4,4)) f(first_day,weekday,ordinal)
    union all select make_date(p_year,6,1)-1-
      ((extract(isodow from make_date(p_year,6,1)-1)::integer-1+7)%7)
  )
  select day from fixed union select day from floating
  union select day+case extract(isodow from day)::integer when 6 then -1 when 7 then 1 else 0 end from fixed
$$;

create function public.field_sales_signature_calendar(p_quote uuid,p_from timestamptz) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c jsonb; day date:=(p_from at time zone 'America/New_York')::date;
begin
  select p.definition->'cancellationCalendar' into c from public.field_sales_workflows w
    join public.field_sales_workflow_policies p on p.policy_id=w.legal_policy_id
    where w.quote_id=p_quote and public.field_sales_configuration_usable(p.status,'approved');
  return coalesce(c->>'timezone'='America/New_York' and c->'businessDays'='3'::jsonb
    and c->>'startEvent'='acceptance' and c->>'deadlineLocalTime'='23:59'
    and c->'excludedWeekdays'='[7]'::jsonb and jsonb_typeof(c->'holidays')='array'
    and not exists(select 1 from generate_series(extract(year from day)::integer-1,
      extract(year from day)::integer+2) y cross join lateral public.field_sales_signature_holidays(y) h
      where h between make_date(extract(year from day)::integer,1,1)
        and make_date(extract(year from day)::integer+1,12,31)
        and not (c->'holidays' @> jsonb_build_array(h::text))),false);
end $$;

alter function public.field_sales_workflow_deadline(uuid,timestamptz) rename to field_sales_workflow_deadline_pre_signature;
create function public.field_sales_workflow_deadline(p_quote uuid,p_from timestamptz) returns timestamptz
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  return public.field_sales_workflow_deadline_pre_signature(p_quote,p_from)+case when exists(
    select 1 from public.field_sales_workflow_artifacts where quote_id=p_quote and kind='agreement'
      and coalesce(content#>>'{customer_document,protocol}',content->>'protocol')='h2s-customer-service-v1')
    and not exists(select 1 from public.field_sales_agreements where quote_id=p_quote and accepted_at is not null
      and acceptance->>'protocol' is distinct from 'h2s-customer-service-v1')
    then interval '1 minute' else interval '0' end;
end $$;

alter function public.field_sales_workflow_document_gate(uuid,boolean) rename to field_sales_workflow_document_gate_pre_signature;
create function public.field_sales_workflow_document_gate(p_quote uuid,p_retrieval boolean default false) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.field_sales_agreements; hashes jsonb; source jsonb;
begin
  select * into a from public.field_sales_agreements where quote_id=p_quote;
  if a.accepted_at is not null and a.acceptance->>'protocol'='h2s-customer-service-v1' then
    hashes:=a.acceptance->'fullArtifactHashes';
    if not public.field_sales_workflow_document_gate_pre_signature(p_quote,false)
      or jsonb_typeof(hashes) is distinct from 'array'
      or exists(select 1 from jsonb_array_elements_text(hashes) h where not exists(
        select 1 from public.field_sales_workflow_artifacts f where f.quote_id=p_quote and f.content_hash=h))
      or jsonb_array_length(a.acceptance->'retainedDocuments')<>4 then return false; end if;
    return not p_retrieval or exists(select 1 from public.field_sales_workflow_delivery
      where quote_id=p_quote and method='customer_retrieval' and artifact_hashes=hashes);
  end if;
  -- Previously signed legacy agreements remain governed by their existing financial/legal gates.
  if a.accepted_at is not null then return public.field_sales_workflow_document_gate_pre_signature(p_quote,p_retrieval); end if;
  if not exists(select 1 from public.field_sales_workflow_artifacts where quote_id=p_quote and kind='agreement'
    and coalesce(content#>>'{customer_document,protocol}',content->>'protocol')='h2s-customer-service-v1') then return false; end if;
  select coalesce(content->'customer_document',content) into source from public.field_sales_workflow_artifacts
    where quote_id=p_quote and kind='agreement'
      and coalesce(content#>>'{customer_document,protocol}',content->>'protocol')='h2s-customer-service-v1';
  if source#>>'{sale,oralPresentationLanguage}' is distinct from 'en'
    or source#>>'{sale,cancellationEligibility}' is distinct from 'covered'
    or jsonb_typeof(source#>'{sale,oralNoticeEvidence}') is distinct from 'string'
    or length(btrim(source#>>'{sale,oralNoticeEvidence}')) not between 3 and 40000 then return false; end if;
  return public.field_sales_signature_calendar(p_quote,now())
    and public.field_sales_workflow_document_gate_pre_signature(p_quote,p_retrieval);
end $$;

create function public.field_sales_signature_normalize(p_quote uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.field_sales_agreements; q public.field_sales_quotes; w public.field_sales_workflows;
  stamp timestamptz:=statement_timestamp(); hashes jsonb; doc jsonb; ack jsonb; final_html text; escaped_name text;
  bundle text; retained jsonb:='[]'; events jsonb:='[]'; full_hashes jsonb; source public.field_sales_workflow_artifacts;
  inserted public.field_sales_workflow_artifacts; seen_labels text[]:='{}'; op uuid; normalized jsonb; published jsonb; protocol_source jsonb;
begin
  select * into a from public.field_sales_agreements where quote_id=p_quote;
  perform 1 from public.commercial_leads where lead_id=a.lead_id for update;
  select * into a from public.field_sales_agreements where quote_id=p_quote for update;
  select * into q from public.field_sales_quotes where quote_id=p_quote;
  select * into w from public.field_sales_workflows where quote_id=p_quote;
  if a.accepted_at is not null then
    if a.acceptance->>'protocol'='h2s-customer-service-v1' then
      if (a.acceptance->'submittedEvidence' is distinct from p_input-'requestMetadata'
        and a.acceptance-'requestMetadata' is distinct from p_input-'requestMetadata')
        or q.quote_hash is distinct from a.quote_hash or q.state<>'approved'
        or q.opportunity_revision<>(select revision from public.field_sales_opportunities where lead_id=a.lead_id)
        or q.revision<>(select max(revision) from public.field_sales_quotes where lead_id=a.lead_id) then
        raise exception 'Signature retry changed customer evidence or quote' using errcode='40001'; end if;
      return a.acceptance;
    end if;
    return p_input;
  end if;
  if w.quote_id is null or w.state in ('cancelled','refund_review')
    or not public.field_sales_workflow_document_gate(p_quote,true) then
    raise exception 'Published customer signature protocol and prior customer retrieval required' using errcode='55000'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or not p_input ?& array[
    'operationId','name','email','quoteHash','policyVersion','accepted','electronicDelivery','acceptanceMethod',
    'agreementAccepted','cancellationNoticeReceived','electronicRecordsConsent','signatureIntent','signatureIntentText',
    'reviewedBundleHash','reviewDate','accessCode','acknowledgments','requestMetadata','acceptedDocuments','artifactHashes']
    or p_input-array['operationId','name','email','quoteHash','policyVersion','accepted','electronicDelivery','acceptanceMethod',
    'agreementAccepted','cancellationNoticeReceived','electronicRecordsConsent','signatureIntent','signatureIntentText',
    'reviewedBundleHash','reviewDate','accessCode','acknowledgments','requestMetadata','acceptedDocuments','artifactHashes']<>'{}'::jsonb
    or coalesce(p_input->>'operationId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(p_input->'name') is distinct from 'string'
    or length(btrim(p_input->>'name')) not between 3 and 120
    or (select count(*) from unnest(regexp_split_to_array(p_input->>'name','[[:space:]]+')) n where n<>'')<2
    or coalesce(p_input->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_input->>'quoteHash' is distinct from a.quote_hash
    or p_input->>'policyVersion' is distinct from a.policy_snapshot->>'version'
    or jsonb_typeof(p_input->'acceptanceMethod') is distinct from 'string'
    or length(btrim(p_input->>'acceptanceMethod')) not between 1 and 100
    or p_input->>'signatureIntentText' is distinct from 'I intend to electronically sign this exact Home2Smart service agreement.'
    or exists(select 1 from unnest(array['accepted','electronicDelivery','agreementAccepted',
      'cancellationNoticeReceived','electronicRecordsConsent','signatureIntent']) k where p_input->k is distinct from 'true'::jsonb)
    or jsonb_typeof(p_input->'requestMetadata') is distinct from 'object'
    or jsonb_typeof(p_input->'acknowledgments') is distinct from 'array'
    or jsonb_typeof(p_input->'acceptedDocuments') is distinct from 'array' then
    raise exception 'Exact customer identity, electronic consent, signature intent and evidence required' using errcode='22023'; end if;
  if (p_input->'requestMetadata')-array['userAgent','origin','authenticatedCustomerLink']<>'{}'::jsonb
    or p_input#>'{requestMetadata,authenticatedCustomerLink}' is distinct from 'true'::jsonb
    or exists(select 1 from jsonb_each(p_input->'requestMetadata') m
      where m.key<>'authenticatedCustomerLink' and (jsonb_typeof(m.value) is distinct from 'string'
        or length(m.value#>>'{}')>case when m.key='userAgent' then 300 else 200 end)) then
    raise exception 'Only authenticated-link marker and sanitized bounded userAgent/origin request metadata allowed' using errcode='22023'; end if;
  op:=(p_input->>'operationId')::uuid;
  if jsonb_array_length(p_input->'acknowledgments')<>4 or exists(
    select 1 from jsonb_array_elements(p_input->'acknowledgments') e
    where jsonb_typeof(e) is distinct from 'object' or e-array['kind','affirmed']<>'{}'
      or not e ?& array['kind','affirmed'] or e->'affirmed' is distinct from 'true'::jsonb
      or e->>'kind' not in ('agreement','cancellation_notice','electronic_records','signature_intent'))
    or (select count(distinct e->>'kind') from jsonb_array_elements(p_input->'acknowledgments') e)<>4 then
    raise exception 'Four distinct explicit acknowledgment events required' using errcode='22023'; end if;
  if jsonb_array_length(p_input->'acceptedDocuments')<>4
    or (select count(*) from jsonb_array_elements(p_input->'acceptedDocuments') e where e->>'kind'='agreement')<>1
    or (select count(*) from jsonb_array_elements(p_input->'acceptedDocuments') e where e->>'kind'='notice')<>2
    or (select count(*) from jsonb_array_elements(p_input->'acceptedDocuments') e where e->>'kind'='electronic_consent')<>1 then
    raise exception 'Agreement, two distinct cancellation notice copies and electronic consent required' using errcode='22023'; end if;
  select * into source from public.field_sales_workflow_artifacts
    where quote_id=p_quote and kind='agreement'
      and coalesce(content#>>'{customer_document,protocol}',content->>'protocol')='h2s-customer-service-v1';
  protocol_source:=coalesce(source.content->'customer_document',source.content);
  if protocol_source->>'version' is distinct from 'customer-service-v1'
    or protocol_source#>>'{sale,jurisdiction}' is distinct from 'SC'
    or protocol_source#>>'{sale,location}' is distinct from 'residence'
    or protocol_source#>'{sale,personalSolicitation}' is distinct from 'true'::jsonb
    or protocol_source#>>'{sale,cancellationEligibility}' is distinct from 'covered'
    or protocol_source#>>'{sale,oralPresentationLanguage}' is distinct from 'en'
    or jsonb_typeof(protocol_source#>'{sale,oralNoticeEvidence}') is distinct from 'string'
    or length(btrim(protocol_source#>>'{sale,oralNoticeEvidence}')) not between 3 and 40000
    or exists(select 1 from unnest(array['name','mailingAddress','phone']) k
      where coalesce(length(btrim(protocol_source->'seller'->>k)),0)=0)
    or coalesce(length(btrim(protocol_source->>'text')),0)=0 then
    raise exception 'Approved covered South Carolina service agreement and seller identity required' using errcode='55000'; end if;
  select jsonb_agg(content_hash order by kind,label) into hashes from public.field_sales_workflow_artifacts where quote_id=p_quote;
  if p_input->'artifactHashes' is distinct from hashes
    or exists(select 1 from public.field_sales_workflow_artifacts f where f.quote_id=p_quote
      and f.content_hash is distinct from encode(sha256(convert_to(f.content::text,'UTF8')),'hex'))
    or not exists(
    select 1 from public.field_sales_workflow_delivery where quote_id=p_quote and method='customer_retrieval'
      and artifact_hashes=hashes and created_at<=stamp) then
    raise exception 'Exact immutable published artifact hashes and actual prior retrieval required' using errcode='22023'; end if;
  for doc in select value from jsonb_array_elements(p_input->'acceptedDocuments') loop
    if jsonb_typeof(doc) is distinct from 'object' or doc-array['kind','version','label','html','contentHash']<>'{}'
      or not doc ?& array['kind','version','label','html','contentHash']
      or jsonb_typeof(doc->'version') is distinct from 'string' or length(btrim(doc->>'version')) not between 1 and 200
      or jsonb_typeof(doc->'label') is distinct from 'string' or length(btrim(doc->>'label')) not between 1 and 200
      or doc->>'label'=any(seen_labels) or jsonb_typeof(doc->'html') is distinct from 'string'
      or length(btrim(doc->>'html')) not between 1 and 2000000
      or coalesce(doc->>'contentHash','') !~ '^[a-f0-9]{64}$'
      or doc->>'contentHash' is distinct from encode(sha256(convert_to(doc->>'html','UTF8')),'hex') then
      raise exception 'Distinct versioned reviewed HTML and exact SHA256 required' using errcode='22023'; end if;
    select coalesce(f.content->'customer_document',f.content) into published from public.field_sales_workflow_artifacts f
      where f.quote_id=p_quote and (doc->>'kind'<>'notice' or f.label=doc->>'label')
        and coalesce(f.content#>>'{customer_document,protocol}',f.content->>'protocol')='h2s-customer-service-v1'
        and coalesce(f.content#>>'{customer_document,version}',f.content->>'version')=doc->>'version'
        and ((doc->>'kind'='agreement' and f.kind='agreement')
          or (doc->>'kind'='notice' and f.kind='notice' and f.content->>'version'='sc-ftc-cancellation-v1'
            and f.content->'copy' in ('1'::jsonb,'2'::jsonb))
          or (doc->>'kind'='electronic_consent' and f.kind='notice' and f.content->>'version'='electronic-records-v1'));
    if not found or coalesce(length(btrim(published->>'text')),0)=0 then
      raise exception 'Reviewed document label and version must match its exact published protocol copy' using errcode='22023'; end if;
    seen_labels:=array_append(seen_labels,doc->>'label');
  end loop;
  if (select count(distinct e->>'contentHash') from jsonb_array_elements(p_input->'acceptedDocuments') e where e->>'kind'='notice')<>2 then
    raise exception 'Cancellation notice copies must have distinct retained copy identities' using errcode='22023'; end if;
  select encode(sha256(convert_to(string_agg(e->>'contentHash','|' order by ordinal)||'|'||a.quote_hash||'|'||
    (p_input->>'reviewDate'),'UTF8')),'hex') into bundle
    from jsonb_array_elements(p_input->'acceptedDocuments') with ordinality d(e,ordinal);
  if p_input->>'reviewDate' is distinct from (stamp at time zone 'America/New_York')::date::text
    or p_input->>'reviewedBundleHash' is distinct from bundle
    or p_input->>'accessCode' is distinct from upper(left(bundle,8))
    or not public.field_sales_signature_calendar(p_quote,stamp) then
    raise exception 'Current New York review date, exact bundle access code and three-day legal calendar required' using errcode='22023'; end if;
  escaped_name:=replace(replace(replace(replace(replace(p_input->>'name','&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;');
  for doc in select value from jsonb_array_elements(p_input->'acceptedDocuments') loop
    final_html:=(doc->>'html')||'<footer data-h2s-signature-evidence="h2s-customer-service-v1"><p>Electronically signed by '||
      escaped_name||' at '||stamp::text||'.</p><p>I intend to electronically sign this exact Home2Smart service agreement.</p><p>Quote '||
      a.quote_hash||'; reviewed document SHA256 '||(doc->>'contentHash')||'; access code '||upper(left(bundle,8))||'.</p></footer>';
    insert into public.field_sales_workflow_artifacts(quote_id,kind,label,content,content_hash,approved_by,approved_at,approval_evidence)
      values(p_quote,case when doc->>'kind'='agreement' then 'agreement' else 'notice' end,
        'Signed '||(doc->>'label')||' ['||op::text||']',
        jsonb_build_object('protocol','h2s-customer-service-v1','operationId',op,'documentKind',doc->>'kind',
          'version',doc->>'version','html',final_html,'reviewedHtml',doc->>'html','reviewedContentHash',doc->>'contentHash',
          'signedName',p_input->>'name','signedAt',stamp,'signatureIntentText',p_input->>'signatureIntentText',
          'quoteHash',a.quote_hash,'reviewedBundleHash',bundle,'accessCode',upper(left(bundle,8))),
        encode(sha256(convert_to(final_html,'UTF8')),'hex'),source.approved_by,stamp,
        jsonb_build_object('sourceArtifactId',source.artifact_id,'sourceApprovalEvidence',source.approval_evidence,
          'customerSignature',true,'operationId',op))
      returning * into inserted;
    retained:=retained||jsonb_build_array(jsonb_build_object('artifactId',inserted.artifact_id,'kind',doc->>'kind',
      'version',doc->>'version','label',inserted.label,'contentHash',inserted.content_hash,'reviewedContentHash',doc->>'contentHash'));
  end loop;
  select jsonb_agg(content_hash order by kind,label) into full_hashes from public.field_sales_workflow_artifacts where quote_id=p_quote;
  for ack in select value from jsonb_array_elements(p_input->'acknowledgments') loop
    events:=events||jsonb_build_array(ack||jsonb_build_object('acknowledgedAt',stamp,'name',p_input->>'name',
      'quoteHash',a.quote_hash,'reviewedBundleHash',bundle,'operationId',op));
  end loop;
  normalized:=p_input||jsonb_build_object('protocol','h2s-customer-service-v1','submittedEvidence',p_input-'requestMetadata',
    'signedAt',stamp,'acknowledgmentEvents',events,'retainedDocuments',retained,'fullArtifactHashes',full_hashes,
    'electronicConsent',jsonb_build_object('affirmed',true,'consentedAt',stamp,'name',p_input->>'name'),
    'signature',jsonb_build_object('name',p_input->>'name','email',p_input->>'email','signedAt',stamp,
      'intent',p_input->>'signatureIntentText','quoteHash',a.quote_hash,'policyVersion',p_input->>'policyVersion'));
  insert into public.field_sales_workflow_delivery(quote_id,actor_reference,method,artifact_hashes,evidence,created_at)
    values(p_quote,'customer-handoff','recorded_delivery',full_hashes,
      jsonb_build_object('atSigning',true,'operationId',op,'deliveredAt',stamp,'recipient',p_input->>'email','accessCode',upper(left(bundle,8))),stamp),
    (p_quote,'customer-handoff','customer_retrieval',full_hashes,
      jsonb_build_object('atSigning',true,'operationId',op,'retrievedAt',stamp,'reviewedArtifactHashes',hashes,'accessCode',upper(left(bundle,8))),stamp);
  return normalized;
end $$;

-- The oldest callable acceptance path performs the same normalization, never a legacy bypass.
do $patch$
declare src text;
begin
  src:=pg_get_functiondef('public.field_sales_customer_agreement_legacy(text,jsonb)'::regprocedure);
  if (length(src)-length(replace(src,'  if p_accept is not null then','')))/length('  if p_accept is not null then')<>1 then
    raise exception '056 legacy acceptance source differs'; end if;
  src:=replace(src,'  if p_accept is not null then',$new$  if p_accept is not null then
    p_accept:=public.field_sales_signature_normalize(a.quote_id,p_accept);$new$); execute src;
end $patch$;

create function public.field_sales_signature_admission() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if (tg_op='INSERT' or old.accepted_at is null) and new.accepted_at is not null and (
    new.acceptance->>'protocol' is distinct from 'h2s-customer-service-v1'
    or (new.acceptance->>'signedAt')::timestamptz is distinct from new.accepted_at
    or jsonb_array_length(new.acceptance->'retainedDocuments') is distinct from 4
    or not exists(select 1 from public.field_sales_workflow_delivery where quote_id=new.quote_id
      and method='recorded_delivery' and artifact_hashes=new.acceptance->'fullArtifactHashes'
      and evidence->>'operationId'=new.acceptance->>'operationId')) then
    raise exception 'New agreement acceptance requires retained customer signature evidence' using errcode='42501'; end if;
  return new;
end $$;
create trigger field_sales_signature_admission before insert or update on public.field_sales_agreements
  for each row execute function public.field_sales_signature_admission();

-- Use the normalized server signing timestamp in the original immutable transition.
do $patch$
declare src text;
begin
  src:=pg_get_functiondef('public.field_sales_customer_agreement_legacy(text,jsonb)'::regprocedure);
  if (length(src)-length(replace(src,'set accepted_at=now(),acceptance=p_accept','')))/length('set accepted_at=now(),acceptance=p_accept')<>1 then
    raise exception '056 timestamp transition source differs'; end if;
  src:=replace(src,'set accepted_at=now(),acceptance=p_accept','set accepted_at=(p_accept->>''signedAt'')::timestamptz,acceptance=p_accept'); execute src;
end $patch$;

alter function public.field_sales_customer_agreement(text,jsonb) rename to field_sales_customer_agreement_pre_signature;
do $patch$
declare src text;
begin
  src:=pg_get_functiondef('public.field_sales_customer_agreement_pre_signature(text,jsonb)'::regprocedure);
  if (length(src)-length(replace(src,'into docs,hashes from public.field_sales_workflow_artifacts where quote_id=q;','')))/
    length('into docs,hashes from public.field_sales_workflow_artifacts where quote_id=q;')<>1 then
    raise exception '056 served document set source differs'; end if;
  src:=replace(src,'into docs,hashes from public.field_sales_workflow_artifacts where quote_id=q;',
    $new$into docs,hashes from public.field_sales_workflow_artifacts where quote_id=q
      and (not exists(select 1 from public.field_sales_agreements a where a.quote_id=q
        and a.accepted_at is not null and a.acceptance->>'protocol'='h2s-customer-service-v1')
      or (select a.acceptance->'fullArtifactHashes' from public.field_sales_agreements a where a.quote_id=q)
        @> jsonb_build_array(content_hash));$new$); execute src;
end $patch$;
create function public.field_sales_customer_agreement(p_token_hash text,p_accept jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.field_sales_agreements; result jsonb; docs jsonb; pinned jsonb;
begin
  select * into a from public.field_sales_agreements where token_hash=p_token_hash and expires_at>now();
  if not found then
    select ag.* into a from public.field_sales_workflow_handoffs h join public.field_sales_agreements ag using(quote_id)
      where h.token_hash=p_token_hash and h.expires_at>now() and h.scope='accepted_documents_balance' and ag.accepted_at is not null;
  end if;
  if a.agreement_id is null then raise exception 'Customer capability unavailable or expired' using errcode='P0002'; end if;
  perform 1 from public.commercial_leads where lead_id=a.lead_id for update;
  select * into a from public.field_sales_agreements where agreement_id=a.agreement_id for update;
  if p_accept is not null and a.accepted_at is not null and a.acceptance->>'protocol'='h2s-customer-service-v1' then
    perform public.field_sales_signature_normalize(a.quote_id,p_accept);
    if exists(select 1 from public.field_sales_workflows where quote_id=a.quote_id and state in ('cancelled','refund_review')) then
      raise exception 'Cancelled agreement cannot be signed' using errcode='55000'; end if;
    result:=public.field_sales_customer_agreement_pre_signature(p_token_hash,null);
  else
    result:=public.field_sales_customer_agreement_pre_signature(p_token_hash,p_accept);
  end if;
  select * into a from public.field_sales_agreements where agreement_id=a.agreement_id;
  if a.accepted_at is not null then
    result:=jsonb_set(result,'{agreement}',jsonb_build_object('agreement_id',a.agreement_id,'accepted_at',a.accepted_at,
      'acceptance',a.acceptance,'policy_snapshot',a.policy_snapshot-array['approved_by','approval_evidence']));
    if a.acceptance->>'protocol'='h2s-customer-service-v1' then
      pinned:=a.acceptance->'fullArtifactHashes';
    else
      select artifact_hashes into pinned from public.field_sales_workflow_delivery
        where quote_id=a.quote_id and method='customer_retrieval' and created_at<=a.accepted_at order by created_at desc limit 1;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('artifactId',artifact_id,'kind',kind,'label',label,'content',content,
      'contentHash',content_hash,'approvedAt',approved_at) order by kind,label),'[]') into docs
      from public.field_sales_workflow_artifacts where quote_id=a.quote_id
        and (pinned is null or pinned @> jsonb_build_array(content_hash));
    if result ? 'workflow' then result:=jsonb_set(result,'{workflow,documents}',docs); end if;
    if a.acceptance->>'protocol'='h2s-customer-service-v1' then
      select coalesce(jsonb_agg(d order by d->>'label'),'[]') into docs from jsonb_array_elements(docs) d
        where exists(select 1 from jsonb_array_elements(a.acceptance->'retainedDocuments') r where r->>'artifactId'=d->>'artifactId');
      result:=jsonb_set(result,'{workflow,acceptedDocuments}',docs);
    end if;
  end if;
  if result ? 'workflow' then
    select jsonb_agg(content_hash order by kind,label) into pinned from public.field_sales_workflow_artifacts
      where quote_id=a.quote_id and not (content ? 'operationId' and content ? 'signedAt');
    result:=jsonb_set(result,'{workflow,originalArtifactHashes}',coalesce(a.acceptance->'artifactHashes',pinned,'[]'::jsonb));
    result:=jsonb_set(result,'{workflow,reviewDate}',to_jsonb((statement_timestamp() at time zone 'America/New_York')::date::text));
    if exists(select 1 from public.field_sales_workflow_artifacts where quote_id=a.quote_id
      and kind='agreement' and coalesce(content#>>'{customer_document,protocol}',content->>'protocol')='h2s-customer-service-v1') then
      result:=jsonb_set(result,'{workflow,cancellationPreviewDeadline}',
        to_jsonb(public.field_sales_workflow_deadline(a.quote_id,statement_timestamp())));
    end if;
  end if;
  return result;
end $$;

-- POST obtains trusted construction inputs without manufacturing a customer retrieval.
create function public.field_sales_customer_signature_context(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.field_sales_agreements; q public.field_sales_quotes; w public.field_sales_workflows; docs jsonb; hashes jsonb; accepted_docs jsonb;
begin
  if not exists(select 1 from public.field_sales_transaction_settings where enabled) then
    raise exception 'Field transactions disabled' using errcode='55000'; end if;
  select * into a from public.field_sales_agreements where token_hash=p_token_hash and expires_at>now();
  if not found then
    select ag.* into a from public.field_sales_workflow_handoffs h join public.field_sales_agreements ag using(quote_id)
      where h.token_hash=p_token_hash and h.expires_at>now() and h.scope='accepted_documents_balance' and ag.accepted_at is not null;
  end if;
  if a.agreement_id is null then raise exception 'Customer capability unavailable or expired' using errcode='P0002'; end if;
  select * into q from public.field_sales_quotes where quote_id=a.quote_id;
  select * into w from public.field_sales_workflows where quote_id=a.quote_id;
  if (a.policy_snapshot->>'stagingOnly'='true' or q.snapshot->>'stagingOnly'='true')
    and not public.field_sales_native_staging_scope() then
    raise exception 'Staging agreement requires its verified native test run' using errcode='42501'; end if;
  if a.accepted_at is null and (q.state<>'approved' or q.quote_hash<>a.quote_hash or q.expires_at<=now()
    or q.opportunity_revision<>(select revision from public.field_sales_opportunities where lead_id=a.lead_id)
    or exists(select 1 from public.field_sales_opportunities where lead_id=a.lead_id and status='closed')
    or q.revision<>(select max(revision) from public.field_sales_quotes where lead_id=a.lead_id)) then
    raise exception 'Quote changed or unavailable; management review required' using errcode='40001'; end if;
  if w.quote_id is not null and (not exists(select 1 from public.field_sales_workflow_settings where enabled)
    or not public.field_sales_workflow_document_gate(a.quote_id,false)) then
    raise exception 'Approved customer document protocol required' using errcode='55000'; end if;
  select jsonb_agg(content_hash order by kind,label) into hashes from public.field_sales_workflow_artifacts
    where quote_id=a.quote_id and not (content ? 'operationId' and content ? 'signedAt');
  if a.accepted_at is not null and a.acceptance->>'protocol' is distinct from 'h2s-customer-service-v1' then
    select artifact_hashes into hashes from public.field_sales_workflow_delivery
      where quote_id=a.quote_id and method='customer_retrieval' and created_at<=a.accepted_at order by created_at desc limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('artifactId',artifact_id,'kind',kind,'label',label,'content',content,
    'contentHash',content_hash,'approvedAt',approved_at) order by kind,label),'[]') into docs
    from public.field_sales_workflow_artifacts where quote_id=a.quote_id
      and (a.accepted_at is null or coalesce(a.acceptance->'fullArtifactHashes',hashes)
        @> jsonb_build_array(content_hash));
  select coalesce(jsonb_agg(d order by d->>'label'),'[]') into accepted_docs from jsonb_array_elements(docs) d
    where exists(select 1 from jsonb_array_elements(a.acceptance->'retainedDocuments') r
      where r->>'artifactId'=d->>'artifactId');
  return jsonb_build_object('agreement',jsonb_build_object('agreement_id',a.agreement_id,'accepted_at',a.accepted_at,
      'acceptance',a.acceptance,'policy_snapshot',a.policy_snapshot-array['approved_by','approval_evidence']),
    'quote',jsonb_build_object('quote_id',q.quote_id,'quote_hash',q.quote_hash,'revision',q.revision,
      'snapshot',q.snapshot-'managementReview','expires_at',q.expires_at),
    'workflow',jsonb_build_object('quoteId',a.quote_id,'documents',docs,'acceptedDocuments',accepted_docs,
      'originalArtifactHashes',coalesce(a.acceptance->'artifactHashes',hashes,'[]'::jsonb),
      'reviewDate',(statement_timestamp() at time zone 'America/New_York')::date::text,
      'cancellationPreviewDeadline',case when exists(select 1 from public.field_sales_workflow_artifacts
        where quote_id=a.quote_id and kind='agreement'
          and coalesce(content#>>'{customer_document,protocol}',content->>'protocol')='h2s-customer-service-v1')
        then public.field_sales_workflow_deadline(a.quote_id,statement_timestamp()) end));
end $$;

do $permissions$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'field_sales_signature_%'
      or p.proname in ('field_sales_customer_agreement','field_sales_customer_agreement_pre_signature',
        'field_sales_customer_signature_context','field_sales_workflow_deadline','field_sales_workflow_deadline_pre_signature',
        'field_sales_workflow_document_gate','field_sales_workflow_document_gate_pre_signature')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    if f::text like '%field_sales_customer_agreement(%' or f::text like '%field_sales_workflow_document_gate(%'
      or f::text like '%field_sales_customer_signature_context(%' or f::text like '%field_sales_workflow_deadline(%'
      then execute format('grant execute on function %s to service_role',f); end if;
  end loop;
end $permissions$;
commit;
