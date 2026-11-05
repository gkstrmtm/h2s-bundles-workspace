import { requireAuth, AuthError } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { salesChecked, BusinessError, identifier, readJson } from '@/lib/fieldSales';
import { requireWorkflow, workflowEnabled, completeEnrolledJob, recordInstallationProof } from '@/lib/fieldWorkflow';
import { FIELD_COMPLETION_PROOF_MAX_BYTES } from '@/lib/fieldQuote';
export const dynamic = 'force-dynamic';
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' });
function failure(request: Request, error: unknown) {
  return Response.json({ ok: false, error: error instanceof AuthError || error instanceof BusinessError ? error.message : 'Exact enrolled installation authority unavailable.' },
    { status: error instanceof AuthError || error instanceof BusinessError ? error.status : 503, headers: headers(request) });
}
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
export async function GET(request: Request) {
  try {
    const actor = await requireAuth(request);
    if (!workflowEnabled()) return Response.json({ ok: true, enabled: false }, { headers: headers(request) });
    requireWorkflow();
    const query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (key !== 'job_id' || query.getAll(key).length !== 1) throw new BusinessError('Exact job identifier required.');
    const result = salesChecked(await getSupabase().rpc('field_sales_workflow_installation', { p_pro: identifier(actor.sub), p_job: identifier(query.get('job_id')) }));
    return Response.json({ ok: true, enabled: true, ...result }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try {
    const body = await readJson(request, FIELD_COMPLETION_PROOF_MAX_BYTES), actor = await requireAuth(request, body);
    requireWorkflow();
    if (body.action === 'proof_record') {
      if (Object.keys(body).some(key => !['job_id','operationId','workflowRevision','action','bindings','checklists','token'].includes(key))) throw new BusinessError('Unsupported proof recording field.');
      const result = await recordInstallationProof(actor.sub, identifier(body.job_id), body);
      if (!result.enrolled) throw new BusinessError('This endpoint records proof only for enrolled installations.', 404);
      return Response.json({ ok: true, ...result }, { headers: headers(request) });
    }
    if (Object.keys(body).some(key => !['job_id','operationId','workflowRevision','expenses','hours','evidence','token'].includes(key))) throw new BusinessError('Unsupported installation completion field.');
    const result = await completeEnrolledJob(actor.sub, identifier(body.job_id), body);
    if (!result.enrolled) throw new BusinessError('This endpoint completes only enrolled installations.', 404);
    return Response.json({ ok: true, ...result }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
