
import { getSupabase } from './supabase';

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  category: string; // 'job_completed', 'payout_approved', 'job_accepted', 'payout_requested'
  idempotencyKey: string;
  meta?: any;
}) {
  const sb = getSupabase();
  const now = new Date().toISOString();
  
  // Log start
  console.log(`[MAIL_SEND_START] Category: ${opts.category}, Key: ${opts.idempotencyKey}, To: ${opts.to}`);

  // 1. Check Idempotency (if table exists)
  try {
      const { data: existing } = await sb.from('h2s_mail_log')
        .select('*')
        .eq('idempotency_key', opts.idempotencyKey)
        .eq('status', 'sent')
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[MAIL] Skipping ${opts.category} - already sent (key: ${opts.idempotencyKey})`);
        return { ok: true, skipped: true };
      }
  } catch (e) {
      console.warn('[MAIL] Idempotency check failed (table might be missing), proceeding carefully:', e);
  }

  // 2. Prepare Payload
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.warn(`[MAIL] Missing SENDGRID_API_KEY. Would have sent: ${opts.subject} to ${opts.to}`);
    return { ok: false, error: 'Configuration missing' };
  }

  // 3. Environment Guard
  let recipient = opts.to;
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  
  // Safety override for non-prod environments to prevent leaking to real customers
  // We allow @home2smart.com emails to pass through in all envs
  if (!isProd && !recipient.includes('@home2smart.com')) {
     const safety = process.env.MAIL_SAFETY_OVERRIDE || 'dev@home2smart.com';
     console.log(`[MAIL] Non-prod redirect: ${recipient} -> ${safety}`);
     recipient = safety;
  }

  const payload = {
    personalizations: [{ to: [{ email: recipient }] }],
    from: { email: process.env.SENDGRID_FROM_EMAIL || 'noreply@home2smart.com', name: 'Home2Smart Portal' },
    subject: opts.subject,
    content: [{ type: 'text/html', value: opts.html }]
  };

  // 4. Send
  try {
    const res = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
        let errText = '';
        try { errText = await res.text(); } catch {}
        throw new Error(`SendGrid ${res.status}: ${errText}`);
    }

    // 5. Log Success
    try {
        await sb.from('h2s_mail_log').insert({
            category: opts.category,
            idempotency_key: opts.idempotencyKey,
            recipient: opts.to, // Log INTENDED recipient
            sent_to: recipient, // Log ACTUAL recipient (safety override)
            subject: opts.subject,
            status: 'sent',
            provider_response: { status: res.status },
            meta: opts.meta,
            created_at: now
        });
    } catch (e) {
        console.warn('[MAIL] Failed to write audit log:', e);
    }

    console.log(`[MAIL_SEND_OK] Sent ${opts.category} to ${recipient}`);
    return { ok: true };

  } catch (err: any) {
    console.error('[MAIL] Send failed:', err);
    // 6. Log Failure
    try {
        await sb.from('h2s_mail_log').insert({
        category: opts.category,
        idempotency_key: opts.idempotencyKey,
        recipient: opts.to,
        subject: opts.subject,
        status: 'failed',
        error: err.message,
        created_at: now
        });
    } catch (e) { console.warn('[MAIL] Failed to write failure log'); }
    
    return { ok: false, error: err.message };
  }
}
