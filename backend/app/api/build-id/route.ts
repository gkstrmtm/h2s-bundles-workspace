import { NextResponse } from 'next/server';
import { BUILD_ID } from '@/lib/buildInfo';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    buildId: BUILD_ID,
    timestamp: new Date().toISOString()
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
}
