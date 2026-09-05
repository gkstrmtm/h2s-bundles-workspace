import type { SupabaseClient } from '@supabase/supabase-js';

export type PartnerEventType =
  | 'link_opened'
  | 'checkout_started'
  | 'booking_created'
  | 'job_completed'
  | 'satisfaction_confirmed'
  | 'partner_notified'
  | 'follow_up_completed';

type RecordPartnerEventInput = {
  eventType: PartnerEventType;
  idempotencyKey: string;
  partnerSlug?: string | null;
  orderId?: string | null;
  jobId?: string | null;
  sessionId?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
};

const safeSlug = (value?: string | null) => String(value || '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 100);

const isMissingPartnerSchema = (error: any) => {
  const message = String(error?.message || '');
  return error?.code === '42P01' || message.includes('h2s_partner_');
};

export async function recordPartnerEvent(client: SupabaseClient, input: RecordPartnerEventInput) {
  const orderId = String(input.orderId || '').trim() || null;
  const jobId = String(input.jobId || '').trim() || null;
  const slug = safeSlug(input.partnerSlug);

  try {
    let attribution: any = null;
    if (orderId || jobId) {
      let attributionQuery = client.from('h2s_partner_attributions').select('id, partner_id, order_id, job_id');
      attributionQuery = orderId ? attributionQuery.eq('order_id', orderId) : attributionQuery.eq('job_id', jobId);
      const existing = await attributionQuery.maybeSingle();
      if (existing.error) throw existing.error;
      attribution = existing.data;
    } else if (!slug) return { ok: true, skipped: 'no_partner_context' };

    if (!attribution) {
      if (!slug) return { ok: true, skipped: 'attribution_not_found' };
      const { data: partner, error: partnerError } = await client
        .from('h2s_realtor_partners')
        .select('id, referral_token')
        .eq('public_slug', slug)
        .eq('status', 'approved')
        .maybeSingle();
      if (partnerError) throw partnerError;
      if (!partner) return { ok: true, skipped: 'partner_not_found' };

      const now = new Date().toISOString();
      const { data: created, error: createError } = await client
        .from('h2s_partner_attributions')
        .insert({
          partner_id: partner.id,
          referral_token: partner.referral_token,
          source: input.source === 'sms' ? 'sms' : 'partner_page',
          channel: input.source || 'realtor_partner',
          order_id: orderId,
          job_id: jobId,
          session_id: input.sessionId || null,
          status: input.eventType === 'booking_created' ? 'converted' : 'captured',
          converted_at: input.eventType === 'booking_created' ? now : null,
          last_event_at: now,
          metadata: input.metadata || {},
        })
        .select('id, partner_id, order_id, job_id')
        .single();
      if (createError) {
        if (createError.code === '23505' && orderId) {
          const retry = await client.from('h2s_partner_attributions').select('id, partner_id, order_id, job_id').eq('order_id', orderId).single();
          if (retry.error) throw retry.error;
          attribution = retry.data;
        } else throw createError;
      } else attribution = created;
    }

    if (!attribution) return { ok: true, skipped: 'attribution_not_found' };
    const now = new Date().toISOString();
    const attributionUpdate: Record<string, unknown> = {
      updated_at: now,
      last_event_at: now,
      order_id: orderId || attribution.order_id,
      job_id: jobId || attribution.job_id,
    };
    if (input.eventType === 'booking_created') {
      attributionUpdate.status = 'converted';
      attributionUpdate.converted_at = now;
    }
    if (input.eventType === 'job_completed') {
      attributionUpdate.completed_at = now;
    }
    if (input.eventType === 'partner_notified') attributionUpdate.partner_notified_at = now;
    if (input.eventType === 'follow_up_completed') {
      attributionUpdate.follow_up_status = 'completed';
      attributionUpdate.follow_up_completed_at = now;
    }
    if (input.eventType === 'satisfaction_confirmed') {
      const needsAttention = input.metadata?.satisfaction_status === 'needs_attention';
      attributionUpdate.satisfaction_status = needsAttention ? 'needs_attention' : 'satisfied';
      attributionUpdate.follow_up_status = needsAttention ? 'suppressed' : 'ready';
      attributionUpdate.follow_up_ready_at = needsAttention ? null : now;
    }

    const { error: updateError } = await client.from('h2s_partner_attributions').update(attributionUpdate).eq('id', attribution.id);
    if (updateError) throw updateError;

    const { error: eventError } = await client.from('h2s_partner_attribution_events').insert({
      attribution_id: attribution.id,
      partner_id: attribution.partner_id,
      event_type: input.eventType,
      idempotency_key: input.idempotencyKey.slice(0, 240),
      order_id: orderId || attribution.order_id,
      job_id: jobId || attribution.job_id,
      occurred_at: now,
      metadata: input.metadata || {},
    });
    if (eventError && eventError.code !== '23505') throw eventError;
    return { ok: true, attributionId: attribution.id, duplicate: eventError?.code === '23505' };
  } catch (error: any) {
    if (isMissingPartnerSchema(error)) {
      console.warn('[Partner Attribution] Migration is not installed; event skipped');
      return { ok: false, skipped: 'schema_missing' };
    }
    console.error('[Partner Attribution] Failed to record event:', error?.message || error);
    return { ok: false, error: error?.message || 'partner_event_failed' };
  }
}
