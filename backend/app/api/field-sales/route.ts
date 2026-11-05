import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { salesActor, salesAccess, salesChecked, serviceDefinitions, ownedOpportunity, assessment, followUp,
  newCredentials, representativeTerms, BusinessError, identifier, readJson, text } from '@/lib/fieldSales';
export const dynamic = 'force-dynamic';
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' });
function failure(request: Request, error: unknown) {
  console.error('Field Sales request failed', { type: error instanceof Error ? error.name : 'Unknown' });
  return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Field Sales storage is unavailable. No success is implied.' },
    { status: error instanceof BusinessError ? error.status : 503, headers: headers(request) });
}
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
export async function GET(request: Request) {
  try {
    const actor = await salesActor(request);
    if (process.env.H2S_FIELD_SALES_ENABLED !== 'true') return Response.json({ ok: true, enabled: false, actor: { role: actor.role, userId: actor.userId } }, { headers: headers(request) });
    await salesAccess(actor.userId);
    const query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (key !== 'leadId' || query.getAll(key).length !== 1) throw new BusinessError('Unsupported Field Sales parameter.');
    const leadId = query.has('leadId') ? identifier(query.get('leadId')) : null;
    const records = leadId ? await ownedOpportunity(actor.userId, leadId)
      : salesChecked(await getSupabase().rpc('field_sales_read', { p_actor: actor.userId, p_lead_id: null }));
    return Response.json({ ok: true, enabled: true, actor: { role: actor.role, userId: actor.userId }, services: await serviceDefinitions(), ...records }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try {
    const actor = await salesActor(request); await salesAccess(actor.userId);
    const body = await readJson(request), action = text(body.action, 30), operationId = identifier(body.operationId);
    const db = getSupabase();
    if (action === 'representative_terms') {
      if (actor.role !== 'ADMIN') throw new BusinessError('Administrator required.', 403);
      const result = salesChecked(await db.rpc('field_sales_identity_command', {
        p_actor: actor.userId, p_operation: operationId, p_payload: representativeTerms(body),
      }));
      return Response.json({ ok: true, ...result }, { headers: headers(request) });
    }
    let payload: Record<string, unknown>;
    if (action === 'account_create') {
      if (actor.role !== 'ADMIN') throw new BusinessError('Administrator required.', 403);
      const username = text(body.username, 32).toUpperCase();
      if (!/^[A-Z][A-Z0-9]{2,31}$/.test(username)) throw new BusinessError('Use 3-32 letters/digits, beginning with a letter.');
      payload = { username, displayName: text(body.displayName, 120), ...newCredentials(body.pin) };
    } else if (action === 'account_state') {
      if (actor.role !== 'ADMIN' || typeof body.active !== 'boolean') throw new BusinessError('Administrator and explicit active state required.', 403);
      payload = { userId: identifier(body.userId), active: body.active };
    } else if (action === 'create' || action === 'attach') {
      if (action === 'attach' && actor.role !== 'ADMIN') throw new BusinessError('Only management may verify an existing inquiry.', 403);
      const ownerId = actor.role === 'SALES' ? actor.userId : identifier(body.ownerId);
      if (action === 'attach') payload = { leadId: identifier(body.leadId), ownerId, evidence: text(body.evidence, 2000) };
      else {
        const market = text(body.market, 20);
        if (!['residential', 'commercial'].includes(market)) throw new BusinessError('Choose residential or commercial.');
        const phone = text(body.phone, 40).replace(/[().\s-]/g, '');
        const normalized = /^\d{10}$/.test(phone) ? '+1' + phone : /^\+?[1-9]\d{6,14}$/.test(phone) ? '+' + phone.replace(/^\+/, '') : '';
        if (!normalized) throw new BusinessError('Enter a valid phone including country code.');
        const interests = assessment({ ...body, answers: {}, submit: false }, await serviceDefinitions(), market);
        payload = { ownerId, market, fullName: text(body.fullName, 120), phone: normalized,
          address: text(body.address, 500), city: text(body.city, 120), notes: text(body.notes ?? '', 2000, false),
          followUpAt: followUp(body.followUpAt ?? null), ...interests };
      }
    } else {
      const leadId = identifier(body.leadId), snapshot = await ownedOpportunity(actor.userId, leadId);
      if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new BusinessError('Record revision required.');
      if (action === 'save') {
        if (typeof body.photoConsent !== 'boolean' || typeof body.submit !== 'boolean') throw new BusinessError('Explicit photo permission and assessment state required.');
        payload = { leadId, revision: body.revision, ...assessment(body, await serviceDefinitions(), snapshot.lead.attribution?.market || 'commercial'),
          notes: text(body.notes ?? '', 2000, false), followUpAt: followUp(body.followUpAt ?? null),
          photoConsent: body.photoConsent, consentNote: text(body.consentNote ?? '', 1000, body.photoConsent), submit: body.submit };
      } else if (action === 'assign' || action === 'review') {
        if (actor.role !== 'ADMIN') throw new BusinessError('Administrator required.', 403);
        payload = { leadId, revision: body.revision, note: text(body.note, 2000),
          ...(action === 'assign' ? { ownerId: identifier(body.ownerId) } : { status: text(body.status, 30) }) };
      } else throw new BusinessError('Unsupported Field Sales action.');
    }
    const result = salesChecked(await db.rpc('field_sales_command', { p_actor: actor.userId, p_operation: operationId, p_action: action, p_payload: payload }));
    return Response.json({ ok: true, ...result }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
