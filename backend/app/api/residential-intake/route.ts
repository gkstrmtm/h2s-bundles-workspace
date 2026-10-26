import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/commercial_consultation_runtime';
import { BusinessError } from '@/lib/commercial_business';
import { submitResidential, residentialSetup } from '@/lib/residential_inquiry';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const headers={...corsHeaders(request),'Cache-Control':'no-store'};
  try {
    const enabled=process.env.RESIDENTIAL_INTAKE_ENABLED==='true';
    if(enabled)await residentialSetup();
    return NextResponse.json({ok:true,enabled,timeZone:'America/New_York'},{headers});
  } catch(error) {
    if(!(error instanceof BusinessError))console.error('Residential intake configuration failed',error);
    return NextResponse.json({ok:false,error:error instanceof BusinessError?error.message:'Homeowner request setup is unavailable.'},
      {status:error instanceof BusinessError?error.status:503,headers});
  }
}
export async function POST(request: Request) {
  try {
    const result = await submitResidential(request);
    const summary = (value: {ok: boolean; skipped?: boolean; persistenceError?: string | null} | null) => value
      ? {ok:value.ok,skipped:value.skipped===true,needsReview:!value.ok || !!value.persistenceError} : null;
    return NextResponse.json({ok:true,reference:result.request.reference_code,replayed:result.replayed,
      bookingConfirmed:false,notifications:{enabled:result.notifications.enabled,
        staff:summary(result.notifications.staff),customer:summary(result.notifications.customer)}},
    {status:result.replayed?200:201,headers:{...corsHeaders(request),'Cache-Control':'no-store'}});
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('Residential intake failed',error);
    return NextResponse.json({ok:false,error:error instanceof BusinessError?error.message:'Homeowner request could not be saved. Your form is retained.'},
      {status:error instanceof BusinessError?error.status:503,headers:corsHeaders(request)});
  }
}
export function OPTIONS(request: Request) { return new NextResponse(null,{status:204,headers:corsHeaders(request)}); }
