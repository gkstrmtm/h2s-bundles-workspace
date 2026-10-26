import { NextResponse } from 'next/server';
import { corsHeaders, findLatestConsultationForLead, getLeadById, getPublicBaseUrl } from '@/lib/commercial_consultation_runtime';
import { BusinessError, admin, identifier } from '@/lib/commercial_business';
import { residentialContext, reviewResidential, availabilityLabel } from '@/lib/residential_inquiry';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function publicReview(context: Awaited<ReturnType<typeof residentialContext>>) {
  return {reference:context.consultation.reference_code,status:context.consultation.status,
    name:context.lead.full_name,phone:context.lead.phone,city:context.lead.project_city,
    services:context.lead.service_needs,notes:context.lead.notes,availability:availabilityLabel(context.lead),bookingConfirmed:false};
}
async function handle(request: Request,write: boolean) {
  try {
    const leadId=new URL(request.url).searchParams.get('leadId');
    if(!write && leadId) {
      await admin(request);
      const lead=await getLeadById(identifier(leadId));
      const inquiry=lead?.attribution?.market==='residential' ? await findLatestConsultationForLead(lead.lead_id) : null;
      if(inquiry?.metadata?.request_kind!=='residential_inquiry')throw new BusinessError('Homeowner inquiry not found.',404);
      return NextResponse.json({ok:true,reviewLink:`${getPublicBaseUrl()}/residential-review?token=${encodeURIComponent(inquiry.response_token)}`},
        {headers:{...corsHeaders(request),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    }
    const result = write ? await reviewResidential(request) : null;
    const context = write ? null : await residentialContext(new URL(request.url).searchParams.get('token') || '');
    return NextResponse.json({ok:true,...(context?{inquiry:publicReview(context)}:
      {status:result!.request.status,replayed:result!.replayed,customer:result!.customer,bookingConfirmed:false})},
    {headers:{...corsHeaders(request),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('Residential review failed',error);
    return NextResponse.json({ok:false,error:error instanceof BusinessError?error.message:'Inquiry review is unavailable. Reload its latest state before retrying.'},
      {status:error instanceof BusinessError?error.status:503,headers:corsHeaders(request)});
  }
}
export function GET(request: Request) { return handle(request,false); }
export function POST(request: Request) { return handle(request,true); }
export function OPTIONS(request: Request) { return new NextResponse(null,{status:204,headers:corsHeaders(request)}); }
