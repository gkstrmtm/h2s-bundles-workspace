import { createHash } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { admin, BusinessError, checked, identifier, readJson, text } from '@/lib/commercial_business';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bucketName = 'commercial-private-files';
export async function OPTIONS(request: Request) { return Response.json({}, { headers: corsHeaders(request) }); }
export async function POST(request: Request) {
  try {
    const actor = await admin(request), body = await readJson(request, 4.25 * 1024 * 1024);
    const leadId = identifier(body.leadId), id = identifier(body.operationId), purpose = text(body.purpose, 30);
    if (!['contact_note','installation_proof','quote_document','payment_evidence'].includes(purpose)) {
      throw new BusinessError('Select an attachment purpose.');
    }
    const filename = text(body.filename, 180), note = text(body.note ?? '', 2000, false);
    if (/[/\\]/.test(filename)) throw new BusinessError('Use a filename, not a filesystem path.');
    const data = text(body.data, 4194400);
    const match = /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(data);
    if (!match) throw new BusinessError('Upload a JPEG, PNG, WebP or PDF with valid file contents.');
    const bytes = Buffer.from(match[2], 'base64'), mime = match[1];
    if (!bytes.length || bytes.length > 3145728) throw new BusinessError('File must be between 1 byte and 3 MB.', 413);
    const valid = mime === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))
      : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : mime === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          : bytes.toString('ascii', 0, 5) === '%PDF-';
    if (!valid) throw new BusinessError('File contents do not match the declared type.');
    const db = getSupabase(), bucket = db.storage.from(bucketName);
    const access = checked(await db.storage.getBucket(bucketName));
    if (!access || access.public !== false) throw new BusinessError('Private attachment storage is not ready. No public fallback is used.', 503);
    const file = { purpose, filename, contentType: mime, byteSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), note, contactId: body.contactId ? identifier(body.contactId) : null };
    const reservation = checked(await db.rpc('commercial_file_record', {
      p_id: id, p_lead_id: leadId, p_actor: actor, p_file: file, p_complete: false,
    }));
    if (reservation.state !== 'ready') {
      const upload = await bucket.upload(reservation.object_path, bytes, { contentType: mime, upsert: false });
      if (upload.error) {
        // A retry can encounter its own previous upload after an interrupted response.
        const existing = await bucket.download(reservation.object_path);
        if (existing.error || !existing.data ||
          createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex') !== file.sha256) {
          console.error('Commercial private upload pending; explicit retry/review required', { fileId: id });
          throw new BusinessError('Upload is not verified. The pending attachment is retained for a safe retry; no proof is claimed.', 503);
        }
      }
      checked(await db.rpc('commercial_file_record', {
        p_id: id, p_lead_id: leadId, p_actor: actor, p_file: file, p_complete: true,
      }));
    }
    return Response.json({ ok: true, fileId: id, state: 'ready' }, { status: 201, headers: corsHeaders(request) });
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('Commercial private attachment request failed.');
    return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Attachment storage unavailable; review pending uploads before retrying.' },
      { status: error instanceof BusinessError ? error.status : 503, headers: corsHeaders(request) });
  }
}
