import { NextResponse } from 'next/server';

/**
 * Build verification endpoint
 * This helps verify that routes are being built and deployed correctly
 */
export async function GET() {
  const buildInfo = {
    ok: true,
    timestamp: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    branch: process.env.VERCEL_GIT_COMMIT_REF || 'local',
    deployment: process.env.VERCEL_DEPLOYMENT_ID || 'local',
    environment: process.env.VERCEL_ENV || 'development',
    routes: {
      track: '/api/track',
      test: '/api/test',
      v1: '/api/v1',
      buildInfo: '/api/build-info'
    },
    message: 'If you see this, Next.js API routes are working correctly'
  };

  return NextResponse.json(buildInfo, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

