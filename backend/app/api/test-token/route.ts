import { NextRequest, NextResponse } from 'next/server';
import { issuePortalToken, verifyPortalToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const testSub = 'test-123';
  
  // Create a token
  const token = await issuePortalToken({ proId: testSub, email: 'fixture@example.invalid', zip: '' });
  
  // Try to verify it
  let verifyResult;
  let verifyError;
  try {
    verifyResult = await verifyPortalToken(token);
  } catch (err: any) {
    verifyError = err.message;
  }
  
  return NextResponse.json({
    envVars: {
      hasPortalSecret: !!process.env.PORTAL_TOKEN_SECRET,
      hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    token: {
      created: !!token,
      verified: verifyResult?.ok ? 'SUCCESS' : 'FAILED',
      error: verifyError || null,
      payload: verifyResult || null
    }
  });
}
