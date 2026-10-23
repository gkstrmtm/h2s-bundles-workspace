import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { admin, BusinessError, checked, identifier, leadRecord, readJson, recordPayload, text } from '@/lib/commercial_business';
import { emailConfiguration, emailView, sendCommercialEmail } from '@/lib/commercial_email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function OPTIONS(request: Request) { return Response.json({}, { headers: corsHeaders(request) }); }
function failure(error: unknown, request: Request) {
  if (!(error instanceof BusinessError)) console.error('Commercial business request failed.');
  return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Business records temporarily unavailable.' },
    { status: error instanceof BusinessError ? error.status : 503, headers: corsHeaders(request) });
}
export async function GET(request: Request) {
  try {
    await admin(request);
    const leadId = identifier(new URL(request.url).searchParams.get('leadId'));
    const lead = await leadRecord(leadId), db = getSupabase();
    const [stateResult, emailResult, historyResult, fileResult, suppressionResult, contactsResult] = await Promise.all([
      db.from('commercial_business_records').select('*').eq('lead_id', leadId).maybeSingle(),
      db.from('commercial_emails').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(100),
      db.from('commercial_business_activity').select('*').eq('lead_id', leadId).order('revision', { ascending: false }).limit(100),
      db.from('commercial_business_files').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(100),
      db.from('commercial_email_suppressions').select('reason').eq('recipient', String(lead.email || '').trim().toLowerCase()).maybeSingle(),
      db.from('commercial_lead_activity').select('operation_id,payload,actor_name,created_at').eq('lead_id', leadId)
        .order('revision', { ascending: false }).limit(100),
    ]);
    const state = checked(stateResult) || { revision: 0, quote: null, payments: [] };
    const files = await Promise.all((checked(fileResult) || []).map(async file => {
      const signed = file.state === 'ready'
        ? checked(await db.storage.from('commercial-private-files').createSignedUrl(file.object_path, 300)) : null;
      return { id: file.file_id, purpose: file.purpose, jobId: file.job_id, contactId: file.contact_operation_id, filename: file.filename,
        note: file.note, state: file.state, createdAt: file.created_at, actor: file.actor,
        url: signed?.signedUrl || null };
    }));
    return Response.json({ ok: true, revision: state.revision, quote: state.quote, payments: state.payments,
      lead: { id: lead.lead_id, email: lead.email, contactPreference: lead.contact_preference },
      emailConfiguration: emailConfiguration(), emailSuppression: checked(suppressionResult)?.reason || null,
      emails: (checked(emailResult) || []).map(emailView), history: checked(historyResult) || [], files,
      contactAttempts: (checked(contactsResult) || []).filter(event => event.payload?.contact).map(event => ({
        id: event.operation_id, channel: event.payload.contact.channel, note: event.payload.contact.note,
        actor: event.actor_name, createdAt: event.created_at })),
      recentLimit: 100 },
    { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, request); }
}
export async function POST(request: Request) {
  try {
    const actor = await admin(request), body = await readJson(request);
    const leadId = identifier(body.leadId), operationId = identifier(body.operationId);
    if (body.action === 'email') {
      const lead = await leadRecord(leadId);
      const retry = body.retryEmailId ? checked(await getSupabase().from('commercial_emails').select('*')
        .eq('email_id', identifier(body.retryEmailId)).eq('lead_id', leadId).maybeSingle()) : null;
      if (body.retryEmailId && (!retry || retry.send_state !== 'failed' || !retry.retry_safe)) {
        throw new BusinessError('Only a definitely rejected email can be retried. Review uncertain sends before composing another.');
      }
      const email = await sendCommercialEmail({
        id: retry?.email_id || operationId, leadId, requestId: retry?.request_id || null,
        purpose: retry?.purpose || 'staff_follow_up', recipient: String(lead.email || ''),
        subject: retry?.subject || text(body.subject, 200), body: retry?.body || text(body.body, 20000),
        attachmentIds: retry ? (retry.attachments || []).map((file: { id: string }) => identifier(file.id))
          : body.attachmentIds === undefined ? [] : Array.isArray(body.attachmentIds) ? body.attachmentIds.map(identifier)
            : (() => { throw new BusinessError('Invalid email attachments.'); })(),
        actor, retry: !!retry,
      });
      const accepted = email.sendState === 'accepted' || email.deliveryState === 'delivered';
      return Response.json({ ok: accepted, email,
        ...(!accepted ? { error: email.sendState === 'processing' || email.sendState === 'uncertain'
          ? 'This email may have been accepted. Do not resend blindly; review its recorded outcome.'
          : 'Email was rejected. Review configuration/address and explicitly retry the recorded email.' } : {}) },
      { status: accepted ? 202 : 409, headers: corsHeaders(request) });
    }
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new BusinessError('A current record revision is required.');
    const { action, payload } = recordPayload(body);
    const saved = checked(await getSupabase().rpc('commercial_business_record', { p_lead_id: leadId,
      p_revision: body.revision, p_operation_id: operationId, p_actor: actor, p_action: action, p_payload: payload }));
    return Response.json({ ok: true, replayed: saved.replayed }, { headers: corsHeaders(request) });
  } catch (error) { return failure(error, request); }
}
