import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { workflowActor } from '@/lib/fieldWorkflow';
import { salesChecked, BusinessError, identifier, readJson, text } from '@/lib/fieldSales';
import { addArtifact } from '@/lib/portalArtifacts';
import { FIELD_COMPLETION_PROOF_MAX_BYTES } from '@/lib/fieldQuote';

export const dynamic = 'force-dynamic';
const headers = (request: Request) => ({...corsHeaders(request),'Cache-Control':'private, no-store',Vary:'Authorization, Origin'});
function failure(request: Request, error: unknown) {
  console.error('Company installation request failed', {type:error instanceof Error ? error.name : 'Unknown'});
  return Response.json({ok:false,error:error instanceof BusinessError ? error.message : 'Company installation authority unavailable. No success is implied.'},
    {status:error instanceof BusinessError ? error.status : 503,headers:headers(request)});
}
async function actor(request: Request) {
  const result = await workflowActor(request);
  if (result.role !== 'ADMIN') throw new BusinessError('Authorized company management required.',403);
  return result;
}
export async function OPTIONS(request: Request) {return Response.json({}, {headers:headers(request)});}
export async function GET(request: Request) {
  try {
    const user=await actor(request),query=new URL(request.url).searchParams;
    for (const key of query.keys()) if (key!=='job_id' || query.getAll(key).length!==1) throw new BusinessError('Exact installation required.');
    const context=salesChecked(await getSupabase().rpc('field_sales_company_context',{
      p_actor:user.userId,p_job:query.has('job_id')?identifier(query.get('job_id')):null}));
    return Response.json({ok:true,enabled:true,...context},{headers:headers(request)});
  } catch(error) {return failure(request,error);}
}
export async function POST(request: Request) {
  try {
    const user=await actor(request),body=await readJson(request,FIELD_COMPLETION_PROOF_MAX_BYTES);
    const job=body.job_id===undefined?null:identifier(body.job_id),action=text(body.action ?? 'complete',40);
    const allowed:Record<string,string[]>={
      authorize_self:['proId','evidence'],claim:['evidence'],proof_record:['bindings','checklists'],
      complete:['expenses','hours','evidence','performedAt'],upload:['type','data','filename','mimetype']};
    if (!allowed[action] || Object.keys(body).some(key=>!['action','job_id','operationId','workflowRevision','token',...allowed[action]].includes(key))) {
      throw new BusinessError('Unsupported company installation field.');
    }
    if(action==='upload'){
      if(!job)throw new BusinessError('Exact installation required.');
      const context=salesChecked(await getSupabase().rpc('field_sales_company_context',{p_actor:user.userId,p_job:job}));
      if(!context.enrolled || !context.proId || context.workflow?.completedAt)throw new BusinessError('Personally accepted open company installation required.',403);
      const type=text(body.type,20);
      if(!['photo','signature'].includes(type))throw new BusinessError('Installation photograph or customer signature required.');
      const data=text(body.data,FIELD_COMPLETION_PROOF_MAX_BYTES),bytes=Buffer.from(data,'base64');
      const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(!png&&!jpeg)throw new BusinessError('Upload an actual PNG or JPEG image.');
      const result=await addArtifact(getSupabase(),{role:'pro',sub:identifier(context.proId)},
        {job_id:job,type:type==='photo'?'photo':'signature',data,filename:text(body.filename,120),mimetype:png?'image/png':'image/jpeg'});
      if(!result.ok)throw new BusinessError(result.error,503);
      const persisted=salesChecked(await getSupabase().from('h2s_dispatch_job_artifacts').select('artifact_id,job_id,pro_id')
        .eq('artifact_id',result.artifact.artifact_id).eq('job_id',job).eq('pro_id',context.proId).maybeSingle());
      if(!persisted)throw new BusinessError('Native proof was not retained. Upload is not confirmed.',503);
      return Response.json({ok:true,artifact:result.artifact},{headers:headers(request)});
    }
    if(action!=='authorize_self'&&(!job||!Number.isSafeInteger(body.workflowRevision)))throw new BusinessError('Exact installation revision required.');
    const payload=Object.fromEntries(allowed[action].filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
    const result=salesChecked(await getSupabase().rpc('field_sales_company_command',{
      p_actor:user.userId,p_job:job,p_operation:identifier(body.operationId),
      p_revision:action==='authorize_self'?null:body.workflowRevision,p_action:action,p_payload:payload}));
    return Response.json({ok:true,...result},{headers:headers(request)});
  } catch(error) {return failure(request,error);}
}
