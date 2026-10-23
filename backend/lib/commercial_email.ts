import { randomUUID, createHash, createPublicKey, verify } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { BusinessError, checked, identifier, text } from '@/lib/commercial_business';

type Actor = { id: string; name: string; role: string };
type EmailInput = {
  id: string; leadId: string; requestId: string | null; purpose: 'receipt' | 'staff_follow_up';
  recipient: string; subject: string; body: string; actor: Actor; retry?: boolean; attachmentIds?: string[];
};
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
function address(value: unknown): string {
  const clean = text(value, 254);
  if (!emailPattern.test(clean) || /[\r\n]/.test(clean)) throw new BusinessError('A valid saved email address is required.');
  return clean.toLowerCase();
}
export function emailConfiguration() {
  const enabled = process.env.COMMERCIAL_EMAIL_ENABLED === 'true';
  const sender = process.env.SENDGRID_FROM_EMAIL || '';
  const replyTo = process.env.COMMERCIAL_EMAIL_REPLY_TO || process.env.SENDGRID_REPLY_TO_EMAIL || '';
  return { enabled, configured: !!(enabled && process.env.SENDGRID_API_KEY && emailPattern.test(sender) && emailPattern.test(replyTo)),
    deliveryTracking: !!process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY };
}
export function emailView(row: Record<string, unknown>) {
  const delivery = row.delivery_state;
  const state = delivery === 'delivered' ? 'delivered' : delivery === 'failed' || row.send_state === 'failed' ? 'failed'
    : delivery === 'needs_review' || row.send_state === 'uncertain' ? 'needs_review'
      : row.send_state === 'accepted' ? 'accepted'
        : Date.parse(String(row.updated_at || row.created_at)) < Date.now() - 15 * 60000 ? 'needs_review' : 'pending';
  return { id: row.email_id, purpose: row.purpose, recipient: row.recipient, subject: row.subject, body: row.body,
    actor: row.actor, state, sendState: row.send_state, deliveryState: delivery, errorCode: row.error_code,
    retrySafe: row.send_state === 'failed' && row.retry_safe === true, timestamp: row.delivery_at || row.accepted_at || row.created_at,
    createdAt: row.created_at, acceptedAt: row.accepted_at, deliveredAt: row.delivered_at,
    replyTo: row.reply_to, attachments: row.attachments || [], deliveryReason: row.delivery_reason };
}
export async function sendCommercialEmail(input: EmailInput) {
  const config = emailConfiguration();
  if (!config.configured) throw new BusinessError('Commercial email is not enabled/configured. The request remains saved; no email was sent.', 503);
  const content = { recipient: address(input.recipient), subject: text(input.subject, 200), body: text(input.body, 20000),
    sender: address(process.env.SENDGRID_FROM_EMAIL), replyTo: address(process.env.COMMERCIAL_EMAIL_REPLY_TO || process.env.SENDGRID_REPLY_TO_EMAIL) };
  if (/[\r\n]/.test(content.subject)) throw new BusinessError('Email subject must be a single line.');
  const db = getSupabase();
  const ids = input.attachmentIds || [];
  if (ids.length > 3 || new Set(ids).size !== ids.length) throw new BusinessError('Choose up to three different attachments, no more than 3 MB in total.');
  ids.forEach(identifier);
  const rows = ids.length ? checked(await db.from('commercial_business_files').select('*').eq('lead_id', input.leadId)
    .eq('state', 'ready').in('file_id', ids)) || [] : [];
  if (rows.length !== ids.length || rows.reduce((sum, file) => sum + Number(file.byte_size), 0) > 3145728) {
    throw new BusinessError('Select verified attachments belonging to this request, no more than 3 MB in total.');
  }
  const attachments = ids.map(id => {
    const file = rows.find(row => row.file_id === id);
    return { id, filename: file.filename, contentType: file.content_type, sha256: file.sha256 };
  });
  const claim = checked(await db.rpc('commercial_email_claim', { p_id: identifier(input.id), p_lead_id: identifier(input.leadId),
    p_request_id: input.requestId ? identifier(input.requestId) : null, p_purpose: input.purpose, p_content: { ...content, attachments },
    p_actor: input.actor, p_retry: input.retry === true }));
  if (!claim.claimed) return { ...emailView(claim.email), replayed: true };
  const id = claim.email.email_id;
  let state = 'uncertain', providerId: string | null = null, errorCode: string | null = null, retrySafe = false;
  let sending = false;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const encoded = [];
    if (attachments.length) {
      const bucket = checked(await db.storage.getBucket('commercial-private-files'));
      if (!bucket || bucket.public !== false) throw new BusinessError('Private storage is not ready.');
      for (const attachment of attachments) {
        const row = rows.find(file => file.file_id === attachment.id);
        const downloaded = checked(await db.storage.from('commercial-private-files').download(row.object_path));
        if (!downloaded) throw new BusinessError('Attachment unavailable.');
        const bytes = Buffer.from(await downloaded.arrayBuffer());
        if (createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) throw new BusinessError('Attachment integrity check failed.');
        encoded.push({ content: bytes.toString('base64'), filename: attachment.filename,
          type: attachment.contentType, disposition: 'attachment' });
      }
    }
    sending = true;
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: content.recipient }], custom_args: { commercial_email_id: id } }],
        from: { email: content.sender, name: 'Home2Smart' }, reply_to: { email: content.replyTo, name: 'Home2Smart' },
        subject: content.subject, content: [{ type: 'text/plain', value: content.body }],
        categories: ['commercial', input.purpose],
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
        ...(encoded.length ? { attachments: encoded } : {}),
      }),
    });
    if (response.ok) {
      state = 'accepted';
      providerId = response.headers.get('x-message-id')?.slice(0, 500) || null;
    } else {
      retrySafe = [400,401,403,413,429].includes(response.status);
      state = retrySafe ? 'failed' : 'uncertain';
      errorCode = `SENDGRID_HTTP_${response.status}`;
    }
  } catch (error) {
    if (!sending) { state = 'failed'; retrySafe = true; errorCode = 'ATTACHMENT_PREPARATION_FAILED'; }
    else errorCode = error instanceof Error && error.name === 'AbortError' ? 'SENDGRID_TIMEOUT_UNCERTAIN' : 'SENDGRID_NETWORK_UNCERTAIN';
    console.error('Commercial email outcome needs review', { emailId: id, code: errorCode });
  } finally { clearTimeout(timer); }
  // Never retry a possibly accepted send after a database/network failure.
  const result = checked(await db.rpc('commercial_email_finish', {
    p_id: id, p_state: state, p_provider_id: providerId, p_error: errorCode, p_retry_safe: retrySafe,
  }));
  return { ...emailView(result), replayed: false };
}
export async function sendInitialCommercialEmail(
  consultation: { request_id: string; reference_code?: string; metadata?: Record<string, unknown> },
  lead: { lead_id: string; contact_preference?: string; email?: string },
) {
  if (lead.contact_preference !== 'email') return { state: 'not_applicable' };
  try {
    return await sendCommercialEmail({ id: randomUUID(), leadId: lead.lead_id, requestId: consultation.request_id,
      purpose: 'receipt', recipient: lead.email || '', subject: 'Home2Smart received your request',
      body: `Thank you for contacting Home2Smart.\n\nWe received your commercial request${consultation.reference_code ? ` (${consultation.reference_code})` : ''}. Our team will follow up by email to discuss your project and next steps.\n\nAny consultation window you requested is a preference, not a confirmed appointment. No payment is being collected by this email.\n\nYou can reply to this email to reach the Home2Smart team.\n\nHome2Smart`,
      actor: { id: 'commercial-intake', name: 'Home2Smart', role: 'SYSTEM' } });
  } catch (error) {
    console.error('Commercial initial email unavailable; saved request requires staff review', {
      requestId: consultation.request_id, category: error instanceof BusinessError ? 'setup_or_storage' : 'unexpected',
    });
    return { state: 'unavailable' };
  }
}
export function verifyEmailSignature(body: Buffer, headers: Headers, now = Date.now()) {
  const key = process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
  if (!key) throw new BusinessError('Signed email webhook is not configured.', 503);
  const timestamp = headers.get('x-twilio-email-event-webhook-timestamp') || '';
  const signature = headers.get('x-twilio-email-event-webhook-signature') || '';
  if (!/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
    || Number(timestamp) * 1000 > now + 300000 || Number(timestamp) * 1000 < now - 7 * 86400000) {
    throw new BusinessError('Invalid email webhook signature.', 403);
  }
  let valid = false;
  try {
    const publicKey = key.includes('BEGIN PUBLIC KEY') ? createPublicKey(key.replace(/\\n/g, '\n'))
      : createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    valid = verify('sha256', Buffer.concat([Buffer.from(timestamp), body]), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    console.error('Commercial email webhook verification key/signature is invalid.');
  }
  if (!valid) throw new BusinessError('Invalid email webhook signature.', 403);
}
