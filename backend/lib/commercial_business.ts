import { getSupabase } from '@/lib/supabase';
import { getDashboardAuthUserFromSession } from '@/lib/dashboardAuth';

export class BusinessError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function text(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new BusinessError('Invalid business record input.');
  }
  const clean = value.trim();
  if (required && !clean) throw new BusinessError('Required information is missing.');
  return clean;
}
export function identifier(value: unknown): string {
  const clean = text(value, 36);
  if (!uuid.test(clean)) throw new BusinessError('Invalid record identifier.');
  return clean;
}
export function checked<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (!result.error) return result.data;
  if (['22023','23514','22P02','22007','22008'].includes(result.error.code || '')) {
    throw new BusinessError(result.error.code === '22023' ? result.error.message : 'Review the business record values.');
  }
  if (['40001','23505'].includes(result.error.code || '')) throw new BusinessError('Record changed. Review latest; your draft is retained.', 409);
  console.error('Commercial business storage unavailable', { code: result.error.code });
  throw new BusinessError('Commercial business setup/storage is unavailable. Records are retained; no send is implied.', 503);
}
export async function admin(request: Request) {
  const actor = await getDashboardAuthUserFromSession(request);
  if (!actor) throw new BusinessError('Administrator session required.', 401);
  if (actor.role !== 'ADMIN') throw new BusinessError('Administrator access required.', 403);
  return { id: actor.userId, name: actor.displayName || actor.username, role: actor.role };
}
export async function readBody(request: Request, limit = 32768): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new BusinessError('Missing request body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new BusinessError('Request exceeds its size limit.', 413); }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request, limit = 32768): Promise<Record<string, unknown>> {
  let body: unknown;
  const bytes = await readBody(request, limit);
  try { body = JSON.parse(bytes.toString('utf8')); }
  catch { throw new BusinessError('Invalid request JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BusinessError('Request must be a JSON object.');
  return body as Record<string, unknown>;
}
export async function leadRecord(leadId: string) {
  const lead = checked(await getSupabase().from('commercial_leads').select('*').eq('lead_id', leadId).maybeSingle());
  if (!lead) throw new BusinessError('Lead not found.', 404);
  return lead;
}
export function cents(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100000000) {
    throw new BusinessError('Enter an amount between $0.01 and $1,000,000, with no more than two decimal places.');
  }
  return Number(value);
}
export function recordPayload(body: Record<string, unknown>) {
  const action = text(body.action, 30);
  if (action === 'quote') {
    const amountCents = cents(body.amountCents), terms = text(body.terms, 20);
    const depositCents = terms === 'full' ? 0 : cents(body.depositCents);
    const status = text(body.status, 20), approvalNote = text(body.approvalNote ?? '', 2000, false);
    if (!['full','deposit'].includes(terms) || depositCents > amountCents ||
      !['draft','sent','accepted','declined'].includes(status) || (status === 'accepted' && approvalNote.length < 3)) {
      throw new BusinessError('Review quote terms and explain any staff-recorded customer approval.');
    }
    return { action, payload: { amountCents, currency: 'usd', terms, depositCents, status, approvalNote,
      reference: text(body.reference ?? '', 160, false), note: text(body.note, 6000) } };
  }
  if (action === 'payment') {
    const receivedAt = text(body.receivedAt, 50), method = text(body.method, 30), state = text(body.state, 20);
    const note = text(body.note, 2000), reference = text(body.reference ?? '', 160, false);
    if (!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(receivedAt)
      || !Number.isFinite(Date.parse(receivedAt)) || Date.parse(receivedAt) > Date.now() + 300000
      || !['reported','confirmed'].includes(state) || !['cash','check','bank_transfer','external_card','stripe_reference','other'].includes(method)
      || note.length < 3 || (state === 'confirmed' && method !== 'cash' && !reference)) {
      throw new BusinessError('Record valid payment facts, receipt time and how payment was checked. Non-cash receipt requires a reference.');
    }
    return { action, payload: { amountCents: cents(body.amountCents), receivedAt, method, state, reference, note } };
  }
  if (action === 'payment_void') {
    const reason = text(body.reason, 2000);
    if (reason.length < 3) throw new BusinessError('Explain the record correction. It does not refund a payment.');
    return { action, payload: { paymentId: identifier(body.paymentId), reason } };
  }
  throw new BusinessError('Unsupported business operation.');
}
