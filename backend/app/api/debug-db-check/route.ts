
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = process.env.SUPABASE_URL || 'MISSING';
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'MISSING';
  
  const sb = createClient(url, key, {
    auth: { persistSession: false }
  });

  const diagnostics: any = {
    env: {
      VERSION: 'DEBUG_CHECK_V2',
      SUPABASE_URL: url,
      KEY_LENGTH: key.length,
      KEY_START: key.substring(0, 10) + '...',
      VERCEL_ENV: process.env.VERCEL_ENV || 'unknown'
    },
    tables: {}
  };

  try {
    const t1 = Date.now();
    const { count: jobsCount, error: jobsError } = await sb.from('h2s_dispatch_jobs').select('*', { count: 'exact', head: true });
    
    // FETCH SAMPLES TO ANSWER Q4 (Statuses)
                                                     const { data: samples, error: sampleErrorStatus } = await sb
                                                          .from('h2s_dispatch_jobs')
                                                          .select('job_id, status')
                                                          .limit(20);
                                                  
                                                      const statuses = Array.from(new Set((samples || []).map((j: any) => j.status)));
                                                  
                                                      diagnostics.tables.h2s_dispatch_jobs = { 
                                                          count: jobsCount, 
                                                          error: jobsError, 
                                                          distinct_statuses: statuses,
                                                          sample_error: sampleErrorStatus
                                                      };
    
    const { count: prosCount, error: prosError } = await sb.from('h2s_pros').select('*', { count: 'exact', head: true });
    diagnostics.tables.h2s_pros = { count: prosCount, error: prosError };

    // Try reading one job to see fields
    const { data: sampleJob, error: sampleError } = await sb.from('h2s_dispatch_jobs').select('*').limit(1);
    diagnostics.tables.sample_job = { 
        found: !!sampleJob?.length, 
        fields: sampleJob?.[0] ? Object.keys(sampleJob[0]) : [],
        error: sampleError 
    };

    diagnostics.latency = Date.now() - t1;
  } catch (err: any) {
    diagnostics.fatal_error = err.message;
  }

  return NextResponse.json(diagnostics);
}
