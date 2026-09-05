-- Home2Smart Move-In Advantage relationship pipeline.
-- Backend service access only. The pilot does not include partner compensation.

alter table public.h2s_partner_attributions
  add column if not exists order_id text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_event_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists satisfaction_status text,
  add column if not exists partner_notified_at timestamptz,
  add column if not exists follow_up_status text not null default 'not_ready',
  add column if not exists follow_up_ready_at timestamptz,
  add column if not exists follow_up_completed_at timestamptz;

alter table public.h2s_realtor_partners
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists profile_completed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'h2s_partner_attributions_satisfaction_check'
  ) then
    alter table public.h2s_partner_attributions
      add constraint h2s_partner_attributions_satisfaction_check
      check (satisfaction_status is null or satisfaction_status in ('unknown', 'satisfied', 'needs_attention'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'h2s_partner_attributions_follow_up_check'
  ) then
    alter table public.h2s_partner_attributions
      add constraint h2s_partner_attributions_follow_up_check
      check (follow_up_status in ('not_ready', 'ready', 'completed', 'suppressed'));
  end if;
end $$;

create unique index if not exists h2s_partner_attributions_order_id_uq
  on public.h2s_partner_attributions (order_id)
  where order_id is not null;

create unique index if not exists h2s_realtor_partners_auth_user_id_uq
  on public.h2s_realtor_partners (auth_user_id)
  where auth_user_id is not null;

create index if not exists h2s_partner_attributions_follow_up_queue_idx
  on public.h2s_partner_attributions (follow_up_ready_at, partner_id)
  where follow_up_status = 'ready';

create table if not exists public.h2s_partner_attribution_events (
  id bigint generated always as identity primary key,
  attribution_id bigint not null references public.h2s_partner_attributions(id) on delete cascade,
  partner_id bigint not null references public.h2s_realtor_partners(id) on delete restrict,
  event_type text not null check (event_type in (
    'link_opened',
    'checkout_started',
    'booking_created',
    'job_completed',
    'satisfaction_confirmed',
    'partner_notified',
    'follow_up_completed'
  )),
  idempotency_key text not null,
  order_id text,
  job_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint h2s_partner_attribution_events_idempotency_key_key unique (idempotency_key)
);

create index if not exists h2s_partner_attribution_events_attribution_idx
  on public.h2s_partner_attribution_events (attribution_id, occurred_at desc);

create index if not exists h2s_partner_attribution_events_partner_idx
  on public.h2s_partner_attribution_events (partner_id, occurred_at desc);

alter table public.h2s_partner_attribution_events enable row level security;

revoke all on table public.h2s_partner_attribution_events from anon, authenticated;
revoke all on sequence public.h2s_partner_attribution_events_id_seq from anon, authenticated;

comment on table public.h2s_partner_attribution_events is
  'Append-only lifecycle events for post-closing partner attribution and follow-up.';
