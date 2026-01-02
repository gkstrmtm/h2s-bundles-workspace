import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';

export async function GET() {
  const result: any = {
    timestamp: new Date().toISOString(),
    tests: []
  };

  try {
    const main = getSupabase();
    const dispatch = getSupabaseDispatch() || main;

    result.config = {
      has_main: !!main,
      has_dispatch: !!dispatch,
      dispatch_is_main: dispatch === main
    };

    // Test 1: Can we read from h2s_dispatch_jobs?
    const { data: jobs, error: readError } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('job_id, order_id, status')
      .limit(3);

    result.tests.push({
      test: 'read_jobs',
      status: readError ? 'FAIL' : 'PASS',
      error: readError?.message,
      count: jobs?.length || 0
    });

    // Test 2: Can we insert a job?
    const testOrderId = `TEST_${Date.now()}`;
    const { data: insertData, error: insertError } = await dispatch
      .from('h2s_dispatch_jobs')
      .insert({
        status: 'test',
        order_id: testOrderId,
        created_at: new Date().toISOString(),
        metadata: { test: true, purpose: 'diagnostic' }
      })
      .select('job_id')
      .single();

    result.tests.push({
      test: 'insert_job',
      status: insertError ? 'FAIL' : 'PASS',
      job_id: insertData?.job_id || null,
      error: insertError?.message,
      error_code: insertError?.code,
      error_hint: insertError?.hint,
      error_details: insertError?.details
    });

    // Clean up test job
    if (insertData?.job_id) {
      await dispatch.from('h2s_dispatch_jobs').delete().eq('job_id', insertData.job_id);
      result.tests.push({
        test: 'cleanup_test_job',
        status: 'PASS'
      });
    }

  } catch (err: any) {
    result.tests.push({
      test: 'overall',
      status: 'ERROR',
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5)
    });
  }

  return NextResponse.json(result, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
