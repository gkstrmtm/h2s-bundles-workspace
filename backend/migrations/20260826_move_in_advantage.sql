-- Home2Smart Move-In Advantage MVP
-- Service-role API access only. No partner compensation or payout tables.

create table if not exists public.h2s_realtor_partners (
  id bigint generated always as identity primary key,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'suspended', 'rejected')),
  first_name text not null,
  last_name text not null,
  brokerage text not null,
  market text not null,
  email text not null,
  phone text not null,
  instagram text,
  headshot_url text,
  public_slug text,
  referral_token text,
  brokerage_approval_confirmed boolean not null default false,
  terms_version text not null default 'pilot-2026-08-26',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  rejected_at timestamptz,
  suspended_at timestamptz,
  constraint h2s_realtor_partners_email_key unique (email),
  constraint h2s_realtor_partners_public_slug_key unique (public_slug),
  constraint h2s_realtor_partners_referral_token_key unique (referral_token),
  constraint h2s_realtor_partners_approved_identity_check check (
    status <> 'approved' or (public_slug is not null and referral_token is not null and approved_at is not null)
  )
);

create table if not exists public.h2s_partner_attributions (
  id bigint generated always as identity primary key,
  partner_id bigint not null references public.h2s_realtor_partners(id) on delete restrict,
  referral_token text not null,
  source text not null check (source in ('partner_page', 'sms', 'web', 'manual_admin')),
  channel text,
  originating_url text,
  session_id text,
  lead_id text,
  customer_id text,
  job_id text,
  status text not null default 'captured'
    check (status in ('captured', 'validated', 'matched', 'converted', 'invalidated')),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  converted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.h2s_partner_status_events (
  id bigint generated always as identity primary key,
  partner_id bigint not null references public.h2s_realtor_partners(id) on delete cascade,
  previous_status text,
  next_status text not null,
  actor_email text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists h2s_realtor_partners_pending_idx
  on public.h2s_realtor_partners (created_at)
  where status = 'pending';
create index if not exists h2s_realtor_partners_status_created_idx
  on public.h2s_realtor_partners (status, created_at desc);
create index if not exists h2s_partner_attributions_partner_id_idx
  on public.h2s_partner_attributions (partner_id, created_at desc);
create index if not exists h2s_partner_attributions_job_id_idx
  on public.h2s_partner_attributions (job_id)
  where job_id is not null;
create index if not exists h2s_partner_attributions_lead_id_idx
  on public.h2s_partner_attributions (lead_id)
  where lead_id is not null;
create index if not exists h2s_partner_status_events_partner_id_idx
  on public.h2s_partner_status_events (partner_id, created_at desc);

alter table public.h2s_realtor_partners enable row level security;
alter table public.h2s_partner_attributions enable row level security;
alter table public.h2s_partner_status_events enable row level security;

revoke all on table public.h2s_realtor_partners from anon, authenticated;
revoke all on table public.h2s_partner_attributions from anon, authenticated;
revoke all on table public.h2s_partner_status_events from anon, authenticated;
revoke all on sequence public.h2s_realtor_partners_id_seq from anon, authenticated;
revoke all on sequence public.h2s_partner_attributions_id_seq from anon, authenticated;
revoke all on sequence public.h2s_partner_status_events_id_seq from anon, authenticated;

comment on table public.h2s_realtor_partners is
  'Approved customer-benefit partners. Initial pilot has no referral compensation.';
comment on table public.h2s_partner_attributions is
  'Inspectable attribution chain from partner token to existing lead, customer, and job identifiers.';
