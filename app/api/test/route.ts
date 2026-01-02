import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ 
    test: 'new route works', 
    time: new Date().toISOString(),
    message: 'If you see this, routing is working but /api/track is cached'
  });
}

