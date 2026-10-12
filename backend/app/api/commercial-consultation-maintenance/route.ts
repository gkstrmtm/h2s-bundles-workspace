import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  corsHeaders,
  ensureCommercialConsultationTables,
  getLeadById,
  getMaxReminderCount,
  nextReminderIso,
  notifyManagementEscalation,
  sendTechnicianConsultationRequest,
} from '@/lib/commercial_consultation_runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: Request) {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-maintenance-token') || '';
  const expected = String(process.env.COMMERCIAL_MAINTENANCE_TOKEN || process.env.NOTIFY_DRAIN_TOKEN || process.env.DISPATCH_ADMIN_TOKEN || '').trim();
  return Boolean(expected && token === expected);
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

async function processMaintenance(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders(request) });
  }

  await ensureCommercialConsultationTables();
  const sb = getSupabase();
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('commercial_consultation_requests')
    .select('*')
    .in('status', ['pending', 'escalated', 'reschedule_requested'])
    .lte('next_reminder_at', nowIso)
    .order('next_reminder_at', { ascending: true })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }

  const processed: any[] = [];

  for (const consultation of data || []) {
    const lead = await getLeadById(consultation.lead_id);
    if (!lead) continue;

    const maxReminders = getMaxReminderCount();
    if ((consultation.reminder_count || 0) >= maxReminders) {
      const management = await notifyManagementEscalation(consultation, lead);
      await sb
        .from('commercial_consultation_requests')
        .update({
          status: 'escalated',
          escalated_at: new Date().toISOString(),
          management_notified_at: new Date().toISOString(),
          next_reminder_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', consultation.request_id);
      processed.push({ requestId: consultation.request_id, action: 'escalated', notifications: management });
      continue;
    }

    const sent = await sendTechnicianConsultationRequest(request, consultation, lead);
    await sb
      .from('commercial_consultation_requests')
      .update({
        reminder_count: Number(consultation.reminder_count || 0) + 1,
        last_reminder_at: new Date().toISOString(),
        next_reminder_at: nextReminderIso(),
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', consultation.request_id);

    processed.push({ requestId: consultation.request_id, action: 'reminded', notifications: sent.results });
  }

  return NextResponse.json({ ok: true, processed }, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  return processMaintenance(request);
}

export async function POST(request: Request) {
  return processMaintenance(request);
}