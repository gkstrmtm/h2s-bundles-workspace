import { createHash, randomBytes, pbkdf2Sync } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { getDashboardAuthUserFromSession } from '@/lib/dashboardAuth';
import { BusinessError, checked, identifier, readJson, text } from '@/lib/commercial_business';

export { BusinessError, checked, identifier, readJson, text };
export type SalesQuestion = { id: string; label: string; type: 'text' | 'number' | 'select'; required: boolean;
  options?: string[]; min?: number; max?: number };
export type SalesService = { service_id: string; version: number; definition: {
  label: string; queueLabel: string; markets: string[]; questions: SalesQuestion[]; photos: string[];
}; enabled: boolean };
export async function salesActor(request: Request) {
  const actor = await getDashboardAuthUserFromSession(request, { touchSession: false, allowSales: true });
  if (!actor) throw new BusinessError('Dashboard sign-in required.', 401);
  if (actor.role !== 'ADMIN' && actor.role !== 'SALES') throw new BusinessError('Field Sales access required.', 403);
  return actor;
}
export async function salesAccess(actorId: string) {
  if (process.env.H2S_FIELD_SALES_ENABLED !== 'true') throw new BusinessError('Field Sales is disabled. No records were changed.', 503);
  const main = process.env.SUPABASE_URL?.trim(), mgmt = process.env.SUPABASE_URL_MGMT?.trim();
  if (mgmt && main && mgmt.replace(/\/$/, '') !== main.replace(/\/$/, '')) {
    throw new BusinessError('Field Sales requires verified co-located dashboard and lead records.', 503);
  }
  return salesChecked(await getSupabase().rpc('field_sales_access', { p_actor: actorId }));
}
export function salesChecked<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (result.error?.code === '42501') throw new BusinessError('Field Sales record access denied.', 403);
  if (result.error?.code === 'P0002') throw new BusinessError('Record not found or not assigned to you.', 404);
  return checked(result);
}
export async function serviceDefinitions() {
  const rows = salesChecked(await getSupabase().from('field_sales_services').select('service_id,version,definition,enabled')
    .eq('enabled', true).order('service_id').returns<SalesService[]>());
  if (!rows || !rows.length || rows.length > 100 || rows.some(row => !row || !Number.isSafeInteger(row.version) || row.version < 1
    || !/^[a-z][a-z0-9_]{1,79}$/.test(row.service_id)
    || typeof row.definition?.label !== 'string' || !row.definition.label.trim()
    || typeof row.definition.queueLabel !== 'string' || !row.definition.queueLabel.trim()
    || !Array.isArray(row.definition.markets) || !Array.isArray(row.definition.questions) || !Array.isArray(row.definition.photos)
    || !row.definition.markets.length || row.definition.markets.some(market => !['residential','commercial'].includes(market))
    || row.definition.photos.some(label => typeof label !== 'string' || !label.trim())
    || row.definition.questions.some(q => !q || !/^[a-z][a-z0-9_]*$/.test(q.id) || typeof q.label !== 'string' || !q.label.trim() || typeof q.required !== 'boolean'
      || !['text', 'number', 'select'].includes(q.type)
      || (q.type === 'number' && ((q.min !== undefined && !Number.isFinite(q.min)) || (q.max !== undefined && !Number.isFinite(q.max)) || (q.min ?? 0) > (q.max ?? 100000)))
      || (q.type === 'select' && (!Array.isArray(q.options) || !q.options.length || q.options.some(value => typeof value !== 'string' || !value.trim()))))
    || new Set(row.definition.questions.map(q => q.id)).size !== row.definition.questions.length)) {
    throw new BusinessError('Service definitions are invalid or incomplete. Management must review configuration.', 503);
  }
  return rows;
}
export function assessment(body: Record<string, unknown>, definitions: SalesService[], market: string) {
  if (!Array.isArray(body.services) || !body.services.length || body.services.length > 20 || new Set(body.services).size !== body.services.length) {
    throw new BusinessError('Select one or more distinct services.');
  }
  const answers = body.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new BusinessError('Assessment answers must be an object.');
  const input = answers as Record<string, unknown>, output: Record<string, unknown> = {};
  const selected = body.services;
  if (Object.keys(input).some(key => !selected.includes(key))) throw new BusinessError('Unselected service answers are not accepted.');
  for (const id of body.services) {
    const service = definitions.find(entry => entry.service_id === id && entry.enabled && entry.definition.markets.includes(market));
    if (!service) throw new BusinessError('A selected service is unavailable for this property. Reload service definitions.');
    const supplied = input[String(id)] ?? {};
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new BusinessError('Review service answers.');
    const values = supplied as Record<string, unknown>, clean: Record<string, unknown> = {};
    if (Object.keys(values).some(key => !service.definition.questions.some(question => question.id === key))) throw new BusinessError('Unknown assessment question.');
    for (const question of service.definition.questions) {
      const value = values[question.id];
      if (value === undefined || value === '') {
        if (body.submit === true && question.required) throw new BusinessError(`Complete ${service.definition.label}: ${question.label}.`);
        continue;
      }
      if (question.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < (question.min ?? 0) || value > (question.max ?? 100000)) throw new BusinessError(`Review ${question.label}.`);
        clean[question.id] = value;
      } else {
        const answer = text(value, 2000);
        if (question.type === 'select' && !question.options?.includes(answer)) throw new BusinessError(`Review ${question.label}.`);
        clean[question.id] = answer;
      }
    }
    output[service.service_id] = { version: service.version, answers: clean };
  }
  return { services: body.services as string[], assessments: output };
}
export function followUp(value: unknown) {
  if (value === null || value === '') return null;
  const result = text(value, 50);
  if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) throw new BusinessError('Follow-up requires an explicit timezone.');
  return new Date(result).toISOString();
}
export function representativeTerms(body: Record<string, unknown>) {
  const date = body.commissionStartDate;
  if (date !== null && (typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)
    || date.startsWith('0000-') || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))
    || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) {
    throw new BusinessError('Enter a valid commission start date or explicitly mark it unknown.');
  }
  if (!Number.isSafeInteger(body.termsRevision) || Number(body.termsRevision) < 0 || Number(body.termsRevision) > 2147483646) {
    throw new BusinessError('Current representative terms revision required.');
  }
  const evidence = text(body.commissionStartEvidence, 2000);
  if (evidence.length < 3) throw new BusinessError('Management evidence is required for commission identity changes.');
  return { userId: identifier(body.userId), commissionStartDate: date, commissionStartEvidence: evidence,
    termsRevision: body.termsRevision };
}
export function newCredentials(pin: unknown) {
  const value = text(pin, 128);
  if (value.length < 16) throw new BusinessError('Use a temporary credential of at least 16 characters.');
  const salt = randomBytes(16);
  return { pinSalt: salt.toString('base64url'), pinHash: pbkdf2Sync(value, salt, 120000, 32, 'sha256').toString('base64url'),
    credentialFingerprint: createHash('sha256').update(value).digest('hex') };
}
export async function ownedOpportunity(actorId: string, leadId: string) {
  return salesChecked(await getSupabase().rpc('field_sales_read', { p_actor: actorId, p_lead_id: leadId }));
}
export async function opportunityPage(actorId: string, query: URLSearchParams) {
  const search = text(query.get('search') ?? '', 120, false).trim();
  const owner = query.has('ownerId') ? identifier(query.get('ownerId')) : null;
  const customer = query.has('customerId') ? identifier(query.get('customerId')) : null;
  const due = query.get('due') === 'true';
  if (query.has('due') && !['true','false'].includes(query.get('due')!)) throw new BusinessError('Invalid follow-up filter.');
  const rawLimit = query.get('limit') ?? '25';
  if (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) throw new BusinessError('Page size must be 1-100.');
  const limit = Number(rawLimit);
  const fingerprint = createHash('sha256').update(JSON.stringify({search,owner,customer,due,limit})).digest('hex');
  let after: string | null = null, afterId: string | null = null, asOf = new Date().toISOString();
  if (query.has('cursor')) {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(query.get('cursor')!)) throw new BusinessError('Invalid page cursor. Start from the first page.');
    let cursor: unknown;
    try { cursor = JSON.parse(Buffer.from(query.get('cursor')!, 'base64url').toString('utf8')); }
    catch { throw new BusinessError('Invalid page cursor. Start from the first page.'); }
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) throw new BusinessError('Invalid page cursor.');
    const value = cursor as Record<string, unknown>;
    if (value.fingerprint !== fingerprint || typeof value.at !== 'string' || typeof value.asOf !== 'string'
      || !Number.isFinite(Date.parse(value.at)) || !Number.isFinite(Date.parse(value.asOf))) throw new BusinessError('Page filters changed. Start from the first page.');
    after = value.at; afterId = identifier(value.id); asOf = value.asOf;
  }
  const result = salesChecked(await getSupabase().rpc('field_sales_page', {
    p_actor: actorId,p_search:search,p_owner:owner,p_customer:customer,p_due:due,p_limit:limit,
    p_after:after,p_after_id:afterId,p_as_of:asOf,
  }));
  return {...result, nextCursor: result.nextCursor
    ? Buffer.from(JSON.stringify({...result.nextCursor,asOf,fingerprint})).toString('base64url') : null};
}
export function photoContent(body: Record<string, unknown>) {
  const match = /^data:(image\/jpeg|image\/png|image\/webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(text(body.data, 4194400));
  if (!match) throw new BusinessError('Use a JPEG, PNG or WebP photograph.');
  const bytes = Buffer.from(match[2], 'base64'), mime = match[1];
  if (!bytes.length || bytes.length > 3145728) throw new BusinessError('Photo exceeds 3 MB.', 413);
  const valid = mime === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new BusinessError('Photo contents do not match the declared format.');
  return { bytes, mime, sha256: createHash('sha256').update(bytes).digest('hex') };
}
