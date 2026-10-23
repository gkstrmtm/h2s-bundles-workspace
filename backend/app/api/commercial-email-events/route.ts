import { getSupabase } from '@/lib/supabase';
import { BusinessError, checked, identifier, readBody, text } from '@/lib/commercial_business';
import { verifyEmailSignature } from '@/lib/commercial_email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const bytes = await readBody(request, 524288);
    verifyEmailSignature(bytes, request.headers);
    let events: unknown;
    try { events = JSON.parse(bytes.toString('utf8')); } catch { throw new BusinessError('Invalid email event JSON.'); }
    if (!Array.isArray(events) || !events.length || events.length > 1000) throw new BusinessError('Invalid email event batch.');
    let correlated = 0;
    for (const event of events) {
      if (!event || typeof event !== 'object') throw new BusinessError('Invalid email event.');
      if (!event.commercial_email_id) continue; // Existing non-commercial SendGrid traffic is not ours.
      const emailId = identifier(event.commercial_email_id), kind = text(event.event, 40);
      if (!['processed','deferred','delivered','bounce','dropped','spamreport','unsubscribe','group_unsubscribe','open','click'].includes(kind)) continue;
      const stamp = Number(event.timestamp);
      if (!Number.isFinite(stamp) || stamp < 0 || stamp * 1000 > Date.now() + 300000) throw new BusinessError('Invalid event timestamp.');
      const result = checked(await getSupabase().rpc('commercial_email_event', {
        p_id: emailId, p_event: { eventId: text(event.sg_event_id, 500), event: kind,
          providerId: text(event.sg_message_id, 500), recipient: text(event.email, 254),
          occurredAt: new Date(stamp * 1000).toISOString(),
          reason: text(typeof event.reason === 'string' ? event.reason.slice(0, 500) : '', 500, false) },
      }));
      if (result.correlated) correlated++;
    }
    return Response.json({ ok: true, correlated }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('Commercial email callback persistence failed.');
    return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Email callback storage unavailable.' },
      { status: error instanceof BusinessError ? error.status : 503 });
  }
}
