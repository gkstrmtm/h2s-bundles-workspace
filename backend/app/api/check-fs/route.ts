import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Try multiple paths to find where we are
  const pathsToCheck = [
    path.join(process.cwd(), 'app', 'api'),
    path.join(process.cwd(), 'src', 'app', 'api'),
    path.join(process.cwd(), '.next', 'server', 'app', 'api')
  ];
  
  const results: any = {};
  
  for (const p of pathsToCheck) {
    try {
        if (fs.existsSync(p)) {
             results[p] = fs.readdirSync(p);
        } else {
             results[p] = 'NOT_FOUND';
        }
    } catch (e: any) {
        results[p] = e.message;
    }
  }

  return NextResponse.json({ 
    cwd: process.cwd(),
    results 
  });
}
