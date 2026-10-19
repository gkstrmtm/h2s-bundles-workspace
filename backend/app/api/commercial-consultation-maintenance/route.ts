import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
const { isManualCommercialFollowUp } = require('@/lib/commercial_consultation.js');
import {
  CommercialConfigurationError,
  commercialDatabaseErrorMessage,
  corsHeaders,
  getLeadById,
  getMaxReminderCount,
  getPublicBaseUrl,
  getTechnicianPhones,
  nextReminderIso,
  notifyManagementEscalation,
  sendTechnicianConsultationRequest,
} from '@/lib/commercial_consultation_runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: Request) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const manualSecret = String(process.env.COMMERCIAL_MAINTENANCE_TOKEN || '').trim();
  if (!cronSecret && !manualSecret) {
    throw new CommercialConfigurationError('Configure CRON_SECRET for scheduled commercial maintenance or COMMERCIAL_MAINTENANCE_TOKEN for manual maintenance.');
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
  const manualToken = String(request.headers.get('x-maintenance-token') || '').trim();
  const matches = (provided: string, expected: string) => {
    if (!provided || !expected) return false;
    const left = Buffer.from(provided, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
  };
  return matches(bearer, cronSecret) || matches(bearer, manualSecret) || matches(manualToken, manualSecret);
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Maintenance-Token' } });
}

async function processMaintenance(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders(request) });
  }

  getPublicBaseUrl();
  getTechnicianPhones();
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
    return NextResponse.json({ ok: false, error: commercialDatabaseErrorMessage(error) }, { status: 500, headers: corsHeaders(request) });
  }

  const processed: any[] = [];

  for (const consultation of data || []) {
    if (consultation.metadata?.request_kind === 'manual_follow_up') continue;
    const lead = await getLeadById(consultation.lead_id);
    if (!lead) continue;
    if (isManualCommercialFollowUp(consultation, lead)) continue;

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

    const sent = await sendTechnicianConsultationRequest(consultation, lead);
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
  return handleMaintenance(request);
}

export async function POST(request: Request) {
  return handleMaintenance(request);
}

async function handleMaintenance(request: Request) {
  try {
    return await processMaintenance(request);
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Commercial maintenance failed' },
      { status: error instanceof CommercialConfigurationError ? 503 : 500, headers: corsHeaders(request) }
    );
  }
}