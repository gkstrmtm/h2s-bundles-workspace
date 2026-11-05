-- REVIEW ONLY. Requires 046. Empty roster; existing workflow/assignment gates unchanged.
begin;
create table public.field_sales_company_installers(
  user_id uuid primary key references public."Dashboard_Users"("User_ID"),
  pro_id uuid not null unique references public.h2s_pros(pro_id),
  authorized_by uuid not null references public."Dashboard_Users"("User_ID"),
  authorized_at timestamptz not null default now(),
  evidence jsonb not null check(jsonb_typeof(evidence)='object' and length(evidence->>'reference')>=3)
);
alter table public.field_sales_company_installers enable row level security;
revoke all on public.field_sales_company_installers from public,anon,authenticated,service_role;
grant select on public.field_sales_company_installers to service_role;

create function public.field_sales_company_context(p_actor uuid,p_job uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pro uuid; candidates jsonb; result jsonb; w public.field_sales_workflows;
begin
  if public.field_sales_workflow_access(p_actor,null)<>'ADMIN' then
    raise exception 'Authorized company management required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('proId',p.pro_id,'email',p.email)),'[]') into candidates
    from public.h2s_pros p join public."Dashboard_Users" u on lower(btrim(u."Email"))=lower(btrim(p.email))
    where u."User_ID"=p_actor and length(btrim(u."Email"))>3 and p.is_active;
  select c.pro_id into pro from public.field_sales_company_installers c
    join public.h2s_pros p on p.pro_id=c.pro_id and p.is_active
    join public."Dashboard_Users" u on u."User_ID"=c.user_id and not u."Is_Disabled"
      and lower(btrim(u."Email"))=lower(btrim(p.email))
    where c.user_id=p_actor;
  result:=jsonb_build_object('authorized',pro is not null,'proId',pro,'candidates',candidates,'enrolled',false);
  if p_job is not null then
    select * into w from public.field_sales_workflows where job_id=p_job;
    if not found then raise exception 'Exact enrolled company installation required' using errcode='P0002'; end if;
    if pro is not null and w.technician_id=pro then
      result:=result||public.field_sales_workflow_installation(pro,p_job);
      result:=jsonb_set(result,'{workflow,canComplete}',to_jsonb(
        (result#>>'{workflow,canComplete}')::boolean and (public.field_sales_workflow_gates(w.quote_id)->>'canAssign')::boolean));
    end if;
  end if;
  return result;
end $$;

create function public.field_sales_company_command(p_actor uuid,p_job uuid,p_operation uuid,p_revision integer,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare context jsonb; pro uuid; w public.field_sales_workflows; result jsonb; previous public.field_sales_workflow_commands;
  performed timestamptz; accepted timestamptz; native_payload jsonb;
begin
  context:=public.field_sales_company_context(p_actor,null);
  if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Explicit company operation required' using errcode='22023'; end if;
  if p_action='authorize_self' then
    if length(btrim(coalesce(p_payload#>>'{evidence,reference}','')))<3
      or not(context->'candidates' @> jsonb_build_array(jsonb_build_object('proId',p_payload->>'proId'))) then
      raise exception 'Existing active installer with matching management account email and verified company evidence required' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended('field-company:'||p_actor,0));
    select * into previous from public.field_sales_workflow_commands where operation_id=p_operation;
    if found then
      if previous.actor_reference<>p_actor::text or previous.action<>'company_authorize' or previous.payload<>p_payload then
        raise exception 'Company authorization retry changed' using errcode='40001'; end if;
      return previous.result;
    end if;
    if exists(select 1 from public.field_sales_company_installers where user_id=p_actor) then
      raise exception 'Company identity already authorized; no identity substitution' using errcode='40001'; end if;
    insert into public.field_sales_company_installers(user_id,pro_id,authorized_by,evidence)
      values(p_actor,(p_payload->>'proId')::uuid,p_actor,p_payload->'evidence');
    result:=jsonb_build_object('authorized',true,'proId',p_payload->>'proId');
    insert into public.field_sales_workflow_commands(operation_id,actor_reference,action,payload,result)
      values(p_operation,p_actor::text,'company_authorize',p_payload,result);
    return result;
  end if;
  pro:=(context->>'proId')::uuid;
  if pro is null then raise exception 'Your verified company installer identity is required' using errcode='42501'; end if;
  select * into w from public.field_sales_workflows where job_id=p_job for update;
  if not found then raise exception 'Exact enrolled installation required' using errcode='P0002'; end if;
  if p_action='claim' then
    if length(btrim(coalesce(p_payload#>>'{evidence,reference}','')))<3 then
      raise exception 'Personal company installation confirmation required' using errcode='22023'; end if;
    select * into previous from public.field_sales_workflow_commands where operation_id=p_operation;
    if found then
      if previous.actor_reference<>p_actor::text or previous.action<>'assign' or previous.quote_id<>w.quote_id
        or previous.payload->>'pro_id'<>pro::text or previous.payload->>'note' is distinct from
          'Company installation personally accepted by authenticated company member: '||coalesce(p_payload#>>'{evidence,reference}','') then
        raise exception 'Company acceptance retry changed' using errcode='40001'; end if;
      perform public.h2s_management_respond_to_offer(p_job,pro,'accept');
      return previous.result||jsonb_build_object('claimed',true,'proId',pro,'replayed',true);
    end if;
    if w.technician_id is not null and w.technician_id<>pro then
      raise exception 'Another installer is assigned; no impersonation or reassignment here' using errcode='42501'; end if;
    result:=public.field_sales_workflow_command(p_actor,p_operation,w.lead_id,w.quote_id,p_revision,'assign',
      jsonb_build_object('pro_id',pro,'context',public.h2s_management_assignment_preview(p_job)#>'{job,context}',
        'note','Company installation personally accepted by authenticated company member: '||coalesce(p_payload#>>'{evidence,reference}','')));
    perform public.h2s_management_respond_to_offer(p_job,pro,'accept');
    return result||jsonb_build_object('claimed',true,'proId',pro);
  end if;
  perform public.field_sales_company_context(p_actor,p_job);
  if w.technician_id is distinct from pro then raise exception 'Only your own company installation may be recorded' using errcode='42501'; end if;
  if p_action='proof_record' then
    return public.field_sales_workflow_record_proof(pro,p_job,p_operation,p_revision,p_payload);
  elsif p_action='complete' then
    select * into previous from public.field_sales_workflow_commands where operation_id=p_operation;
    if not found and not (public.field_sales_workflow_gates(w.quote_id)->>'canAssign')::boolean then
      raise exception 'Payment, cancellation, legal or readiness controls prevent completion' using errcode='55000'; end if;
    performed:=(p_payload->>'performedAt')::timestamptz;
    select max(accepted_at) into accepted from public.h2s_dispatch_job_assignments
      where job_id=p_job::text and pro_id=pro::text and state in ('accepted','assigned','completed','done');
    if accepted is null or performed is null or performed>clock_timestamp() or performed<accepted then
      raise exception 'Actual installation date must follow personal acceptance and cannot be in the future' using errcode='22023'; end if;
    native_payload:=(p_payload-'performedAt')||jsonb_build_object('evidence',(p_payload->'evidence')||
      jsonb_build_object('performedAt',performed,'companyActorId',p_actor,'companyInstallerId',pro));
    return public.field_sales_workflow_complete(pro,p_job,p_operation,p_revision,native_payload);
  end if;
  raise exception 'Unsupported company installation action' using errcode='22023';
end $$;
revoke all on function public.field_sales_company_context(uuid,uuid),
  public.field_sales_company_command(uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.field_sales_company_context(uuid,uuid),
  public.field_sales_company_command(uuid,uuid,uuid,integer,text,jsonb) to service_role;
commit;
