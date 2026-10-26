import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getDashboardAuthUserFromSession } from '@/lib/dashboardAuth';
import { corsHeaders } from '@/lib/adminAuth';
import { processResidentialNotices } from '@/lib/residential_workspace';

export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
class CalendarError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function instant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new CalendarError('Use a valid date and time with a time zone.');
  return value;
}
function checked<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (!result.error && result.data != null) return result.data;
  if (!result.error) {
    console.error('Commercial calendar returned no result');
    throw new CalendarError('Calendar result unavailable. Reload before retrying.',503);
  }
  const { code, message } = result.error;
  if (['42P01','42703','42883','PGRST202','PGRST204','PGRST205'].includes(code || '')) {
    throw new CalendarError('Commercial calendar setup requires reviewed migration 036.', 503);
  }
  if (code === '23P01') throw new CalendarError('That time is reserved on the shared Home2Smart calendar. Choose another window.', 409);
  if (code === '40001' || code === '40P01') throw new CalendarError('The calendar changed. Reload and review before saving.', 409);
  if (code === '22023' || code === '22007' || code === '22008') throw new CalendarError(message);
  console.error('Commercial calendar storage unavailable', { code });
  throw new CalendarError('Commercial calendar unavailable. Your changes have not been confirmed.', 503);
}
async function handle(request: Request, write: boolean) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  try {
    const actor = await getDashboardAuthUserFromSession(request);
    if (!actor) throw new CalendarError('Authentication required.', 401);
    if (actor.role !== 'ADMIN') throw new CalendarError('Administrator access required.', 403);
    const url = new URL(request.url), db = getSupabase();
    if (!write) {
      const lead = url.searchParams.get('leadId');
      if (lead && !uuid.test(lead)) throw new CalendarError('Valid lead required.');
      const result = checked(await db.rpc('commercial_calendar_snapshot', {
        p_start: instant(url.searchParams.get('start')), p_end: instant(url.searchParams.get('end')), p_lead_id: lead || null,
      }));
      if (!Array.isArray(result.entries)) throw new CalendarError('Calendar returned invalid entries.',503);
      const ids = Array.from(new Set<string>(result.entries.map((entry: {lead_id: string}) => entry.lead_id)));
      if (ids.length) {
        const leads = checked(await db.from('commercial_leads').select('lead_id,attribution').in('lead_id',ids));
        if (!Array.isArray(leads)) throw new CalendarError('Calendar customer identities could not be loaded.',503);
        const markets = new Map(leads.map(row=>[row.lead_id,row.attribution?.market==='residential'?'residential':'commercial']));
        result.entries = result.entries.map((entry: {lead_id: string}) => {
          if (!markets.has(entry.lead_id)) throw new CalendarError('A calendar customer could not be loaded. Reload before planning.',503);
          return {...entry,market:markets.get(entry.lead_id)};
        });
      }
      return NextResponse.json({ ok: true, calendar: result }, { headers });
    }
    const body = await request.json().catch(() => { throw new CalendarError('Invalid JSON request.'); });
    if (!body || !uuid.test(body.leadId || '') || !uuid.test(body.operationId || '')
      || !Number.isSafeInteger(body.revision) || body.revision < 0
      || !['hold','confirm','reschedule','cancel'].includes(body.action)) throw new CalendarError('Valid lead, revision and calendar action required.');
    const input = body.payload;
    if (!input || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) {
      throw new CalendarError('A short reason is required.');
    }
    const payload: Record<string, unknown> = { reason: input.reason.trim() };
    if (body.action !== 'cancel') {
      if (typeof input.timezone !== 'string' || input.timezone.length > 100) throw new CalendarError('Valid time zone required.');
      try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }); }
      catch { throw new CalendarError('Valid time zone required.'); }
      Object.assign(payload, { start: instant(input.start), end: instant(input.end), timezone: input.timezone,
        expiresAt: input.expiresAt ? instant(input.expiresAt) : '', customerAgreed: input.customerAgreed === true });
    }
    const booking = checked(await db.rpc('commercial_record_reservation', {
      p_lead_id: body.leadId, p_revision: body.revision, p_operation_id: body.operationId,
      p_actor: { id: actor.userId, name: actor.displayName || actor.username }, p_action: body.action, p_payload: payload,
    }));
    let notifications;
    try { notifications = await processResidentialNotices({ leadId: body.leadId }); }
    catch (error) {
      console.error('Calendar saved but residential notifications need review', error);
      notifications = { enabled: true, needsReview: true, processed: [] };
    }
    return NextResponse.json({ ok: true, booking, notifications }, { headers });
  } catch (error) {
    if (!(error instanceof CalendarError)) console.error('Commercial calendar request failed', error);
    return NextResponse.json({ ok: false, error: error instanceof CalendarError ? error.message : 'Commercial calendar request failed.' },
      { status: error instanceof CalendarError ? error.status : 500, headers });
  }
}
export function GET(request: Request) { return handle(request, false); }
export function POST(request: Request) { return handle(request, true); }
export function OPTIONS(request: Request) { return new NextResponse(null, { status: 204, headers: corsHeaders(request) }); }
