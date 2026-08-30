import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { createReferralToken, escapePartnerText, normalizeSlug, partnerProgramUrl, PARTNER_STATUSES, publicPartner } from '@/lib/partnerProgram';
import { sendMail } from '@/lib/mail';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const id = Number(body.partner_id);
    const nextStatus = String(body.status || '');
    if (!Number.isSafeInteger(id) || id <= 0 || !PARTNER_STATUSES.includes(nextStatus as any) || nextStatus === 'pending') {
      return NextResponse.json({ ok: false, error: 'Valid partner_id and status are required' }, { status: 400, headers: corsHeaders(request) });
    }
    const client = getSupabase();
    const auth = await requireAdmin({ request, body, supabaseClient: client });
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders(request) });
    const { data: existing, error: readError } = await client.from('h2s_realtor_partners').select('*').eq('id', id).single();
    if (readError || !existing) return NextResponse.json({ ok: false, error: 'Partner not found' }, { status: 404, headers: corsHeaders(request) });
    if (existing.status === nextStatus) {
      return NextResponse.json({ ok: true, partner: publicPartner(existing), unchanged: true }, { headers: corsHeaders(request) });
    }

    const now = new Date().toISOString();
    const update: Record<string, any> = { status: nextStatus, updated_at: now };
    if (nextStatus === 'approved') {
      const baseSlug = normalizeSlug(`${existing.first_name}-${existing.last_name}`) || `partner-${id}`;
      let publicSlug = existing.public_slug || baseSlug;
      if (!existing.public_slug) {
        const { data: slugOwner } = await client.from('h2s_realtor_partners').select('id').eq('public_slug', baseSlug).neq('id', id).maybeSingle();
        if (slugOwner) publicSlug = `${baseSlug}-${id}`;
      }
      update.public_slug = publicSlug;
      update.referral_token = existing.referral_token || createReferralToken();
      update.approved_at = now;
      update.approved_by = auth.adminEmail;
      update.rejected_at = null;
      update.suspended_at = null;
    } else if (nextStatus === 'rejected') update.rejected_at = now;
    else if (nextStatus === 'suspended') update.suspended_at = now;

    const { data, error } = await client.from('h2s_realtor_partners').update(update).eq('id', id).select('*').single();
    if (error) throw error;
    await client.from('h2s_partner_status_events').insert({ partner_id: id, previous_status: existing.status, next_status: nextStatus, actor_email: auth.adminEmail, note: body.note ? String(body.note).slice(0, 1000) : null });
    const statusCopy = nextStatus === 'approved'
      ? `<p>Your Home2Smart partner account is approved. Your referral page and sharing tools are ready.</p><p><a href="${partnerProgramUrl('/account')}">Open your partner account</a></p>`
      : nextStatus === 'rejected'
        ? '<p>Home2Smart has completed its review and is not activating partner access at this time.</p>'
        : '<p>Your Home2Smart partner access has been paused. Contact Home2Smart if you believe this was unexpected.</p>';
    await sendMail({
      to: existing.email,
      subject: nextStatus === 'approved' ? 'Your Home2Smart partner access is approved' : `Home2Smart partner account update: ${nextStatus}`,
      category: `partner_status_${nextStatus}`,
      idempotencyKey: `partner_status:${id}:${nextStatus}:${now}`,
      html: `<h2>Partner account update</h2><p>Hi ${escapePartnerText(existing.first_name)},</p>${statusCopy}<p>Home2Smart Realtor Partners</p>`,
      meta: { partnerId: id, previousStatus: existing.status, nextStatus, actorEmail: auth.adminEmail },
    }).catch(error => console.warn('[Partner Status] Partner notification failed:', error));
    return NextResponse.json({ ok: true, partner: publicPartner(data) }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to update partner', error_code: 'admin_partner_status_failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
