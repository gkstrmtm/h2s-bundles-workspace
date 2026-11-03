import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { salesActor, salesAccess, salesChecked, ownedOpportunity, photoContent, identifier, text, readJson, BusinessError } from '@/lib/fieldSales';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const bucketName = 'commercial-private-files';
const headers = (r: Request) => ({ ...corsHeaders(r), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' });
function failure(r: Request, e: unknown) {
  console.error('Field photo request failed', { type: e instanceof Error ? e.name : 'Unknown' });
  return Response.json({ ok: false, error: e instanceof BusinessError ? e.message : 'Private photo is unavailable. Review pending uploads before retrying.' },
    { status: e instanceof BusinessError ? e.status : 503, headers: headers(r) });
}
async function bucket() {
  const db = getSupabase(), access = salesChecked(await db.storage.getBucket(bucketName));
  if (!access || access.public !== false) throw new BusinessError('Private photo storage is not configured. No public fallback.', 503);
  return db.storage.from(bucketName);
}
export async function OPTIONS(r: Request) { return Response.json({}, { headers: headers(r) }); }
export async function GET(r: Request) {
  try {
    const actor = await salesActor(r); await salesAccess(actor.userId);
    const q = new URL(r.url).searchParams;
    for (const key of q.keys()) if (!['leadId', 'photoId'].includes(key) || q.getAll(key).length !== 1) throw new BusinessError('Unsupported photo parameter.');
    const leadId = identifier(q.get('leadId')), photoId = identifier(q.get('photoId'));
    const record = await ownedOpportunity(actor.userId, leadId);
    const file = record.photos.find((entry: { file_id: string; state: string }) => entry.file_id === photoId && entry.state === 'ready');
    if (!record.opportunity.photo_consent || !file) throw new BusinessError('Photo not available with current customer permission.', 403);
    const storage = await bucket(), result = salesChecked(await storage.download(file.object_path));
    const latest = await ownedOpportunity(actor.userId, leadId);
    if (!latest.opportunity.photo_consent || latest.opportunity.revision !== record.opportunity.revision) throw new BusinessError('Photo access changed; reload.', 409);
    return new Response(result, { headers: { ...headers(r), 'Content-Type': file.content_type, 'Content-Disposition': 'inline' } });
  } catch (e) { return failure(r, e); }
}
export async function POST(r: Request) {
  try {
    const actor = await salesActor(r); await salesAccess(actor.userId);
    const body = await readJson(r, 4.25 * 1024 * 1024), leadId = identifier(body.leadId), operationId = identifier(body.operationId);
    await ownedOpportunity(actor.userId, leadId);
    const photo = photoContent(body), filename = text(body.filename, 180);
    if (/[/\\]/.test(filename)) throw new BusinessError('Use a filename, not a path.');
    const file = { filename, serviceId: text(body.serviceId, 80), label: text(body.label, 120), contentType: photo.mime,
      sha256: photo.sha256, byteSize: photo.bytes.length };
    const args = { p_actor: actor.userId, p_operation: operationId, p_lead_id: leadId, p_file: file };
    const storage = await bucket(), db = getSupabase();
    const reserved = salesChecked(await db.rpc('field_sales_photo', { ...args, p_complete: false }));
    if (reserved.state !== 'ready') {
      const upload = await storage.upload(reserved.object_path, photo.bytes, { contentType: photo.mime, upsert: false });
      if (upload.error) {
        const old = await storage.download(reserved.object_path);
        const { createHash } = await import('node:crypto');
        if (old.error || !old.data || createHash('sha256').update(Buffer.from(await old.data.arrayBuffer())).digest('hex') !== photo.sha256) {
          throw new BusinessError('Upload remains pending. Retry the identical photo operation; no photo is marked ready.', 503);
        }
      }
      salesChecked(await db.rpc('field_sales_photo', { ...args, p_complete: true }));
    }
    return Response.json({ ok: true, fileId: operationId }, { headers: headers(r) });
  } catch (e) { return failure(r, e); }
}
