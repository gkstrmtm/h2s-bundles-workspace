create table if not exists commercial_leads (
  lead_id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  full_name text null,
  company_name text null,
  email text null,
  phone text null,
  contact_preference text not null default 'sms' check (contact_preference in ('sms', 'call', 'email')),
  business_type text null,
  project_address text null,
  project_city text null,
  project_state text null,
  project_postal_code text null,
  scope_summary text null,
  timeline text null,
  budget_band text null,
  site_count int not null default 1,
  service_needs jsonb not null default '[]'::jsonb,
  project_photo_urls jsonb not null default '[]'::jsonb,
  assessment_answers jsonb not null default '{}'::jsonb,
  attribution jsonb not null default '{}'::jsonb,
  notes text null,
  completeness_score int not null default 0,
  completeness_bucket text not null default 'empty' check (completeness_bucket in ('empty', 'contact_only', 'partial', 'qualified')),
  priority_tier text not null default 'normal' check (priority_tier in ('low', 'normal', 'high', 'urgent')),
  last_submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_commercial_leads_created_at on commercial_leads (created_at desc);
create index if not exists idx_commercial_leads_last_submitted_at on commercial_leads (last_submitted_at desc);
create index if not exists idx_commercial_leads_priority_tier on commercial_leads (priority_tier);
create index if not exists idx_commercial_leads_phone on commercial_leads (phone);
create index if not exists idx_commercial_leads_email on commercial_leads (email);

create table if not exists commercial_consultation_requests (
  request_id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references commercial_leads(lead_id) on delete cascade,
  reference_code text not null unique,
  response_token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'reschedule_requested', 'customer_confirmed', 'escalated', 'expired', 'cancelled')),
  preferred_slots jsonb not null default '[]'::jsonb,
  selected_slot_start timestamptz null,
  selected_slot_end timestamptz null,
  assigned_technician_name text null,
  assigned_technician_phone text null,
  response_channel text null check (response_channel in ('sms', 'web', 'manual')),
  response_note text null,
  response_at timestamptz null,
  reminder_count int not null default 0,
  last_reminder_at timestamptz null,
  next_reminder_at timestamptz null,
  escalated_at timestamptz null,
  management_notified_at timestamptz null,
  customer_confirmation_sent_at timestamptz null,
  customer_reminder_sent_at timestamptz null,
  related_order_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_commercial_consultation_requests_lead_id on commercial_consultation_requests (lead_id);
create index if not exists idx_commercial_consultation_requests_status on commercial_consultation_requests (status);
create index if not exists idx_commercial_consultation_requests_next_reminder_at on commercial_consultation_requests (next_reminder_at);
create index if not exists idx_commercial_consultation_requests_assigned_phone on commercial_consultation_requests (assigned_technician_phone);

alter table commercial_leads enable row level security;
alter table commercial_consultation_requests enable row level security;

drop policy if exists "Service role has full access to commercial leads" on commercial_leads;
create policy "Service role has full access to commercial leads" on commercial_leads
  for all using (true);

drop policy if exists "Service role has full access to commercial consultation requests" on commercial_consultation_requests;
create policy "Service role has full access to commercial consultation requests" on commercial_consultation_requests
  for all using (true);

create or replace function commercial_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_commercial_leads_touch_updated_at on commercial_leads;
create trigger trg_commercial_leads_touch_updated_at
before update on commercial_leads
for each row execute procedure commercial_touch_updated_at();

drop trigger if exists trg_commercial_consultation_requests_touch_updated_at on commercial_consultation_requests;
create trigger trg_commercial_consultation_requests_touch_updated_at
before update on commercial_consultation_requests
for each row execute procedure commercial_touch_updated_at();