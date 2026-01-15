import { NextRequest, NextResponse } from 'next/server';
import { issuePortalToken, verifyPortalToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const testSub = 'test-123';
  
  // Create a token
  const token = issuePortalToken({ sub: testSub, role: 'pro' });
  
  // Try to verify it
  let verifyResult;
  let verifyError;
  try {
    verifyResult = verifyPortalToken(token);
  } catch (err: any) {
    verifyError = err.message;
  }
  
  return NextResponse.json({
    envVars: {
      hasPortalSecret: !!process.env.PORTAL_TOKEN_SECRET,
      hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      serviceKeyPrefix: process.env.SUPABASE_SERVICE_KEY?.substring(0, 20) || 'NONE'
    },
    token: {
      created: token.substring(0, 50) + '...',
      verified: verifyResult ? 'SUCCESS' : 'FAILED',
      error: verifyError || null,
      payload: verifyResult || null
    }
  });
}
