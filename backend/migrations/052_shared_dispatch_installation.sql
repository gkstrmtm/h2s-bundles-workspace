-- REVIEW ONLY. Native shared-dispatch compatibility; requires 046.
-- Apply only to an explicitly authorized target. Does not enable any workflow.
begin;
do $$
declare status_column smallint; existing record; expected integer;
begin
  select count(*) into expected from information_schema.columns
    where table_schema='public' and table_name='h2s_dispatch_jobs'
      and column_name in ('job_id','order_id','status','recipient_id','sequence_id','step_id','due_at');
  if expected<>7 then
    raise exception 'Verified native shared-dispatch baseline is required' using errcode='55000';
  end if;
  alter table public.h2s_dispatch_jobs add column job_kind text not null default 'sequence';
  alter table public.h2s_dispatch_jobs add constraint h2s_dispatch_job_kind
    check(job_kind in('sequence','installation'));
  select attnum into status_column from pg_attribute
    where attrelid='public.h2s_dispatch_jobs'::regclass and attname='status';
  for existing in select conname,pg_get_expr(conbin,conrelid) as expression
    from pg_constraint where conrelid='public.h2s_dispatch_jobs'::regclass
      and contype='c' and conkey=array[status_column]::smallint[]
  loop
    execute format('alter table public.h2s_dispatch_jobs drop constraint %I',existing.conname);
    execute format('alter table public.h2s_dispatch_jobs add constraint %I check(job_kind=''installation'' or (%s))',
      existing.conname,existing.expression);
  end loop;
  alter table public.h2s_dispatch_jobs alter column recipient_id drop not null,
    alter column sequence_id drop not null,alter column step_id drop not null,alter column due_at drop not null;
  alter table public.h2s_dispatch_jobs add constraint h2s_dispatch_sequence_requirements
    check(job_kind<>'sequence' or
      (recipient_id is not null and sequence_id is not null and step_id is not null and due_at is not null));
  alter table public.h2s_dispatch_jobs add constraint h2s_dispatch_installation_requirements
    check(job_kind<>'installation' or
      (nullif(trim(order_id),'') is not null and recipient_id is null and sequence_id is null and step_id is null
        and status in('queued','assigned','in_progress','completed','done','cancelled')));
end $$;
commit;
