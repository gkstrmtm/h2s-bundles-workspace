import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const tableName = body.table_name || 'h2s_dispatch_jobs';
    
    // Determine which client to use
    const isDispatchTable = tableName === 'h2s_dispatch_jobs';
    const client = isDispatchTable 
      ? (getSupabaseDispatch() || getSupabase())
      : getSupabase();
    
    if (!client) {
      return NextResponse.json({ ok: false, error: 'No database client' });
    }
    
    // Get sample rows to see actual structure
    const { data: sample, error: sampleError } = await client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3);
    
    if (sampleError) {
      return NextResponse.json({
        ok: false,
        error: sampleError.message,
        table: tableName
      });
    }
    
    const sampleKeys = sample && sample.length > 0 ? Object.keys(sample[0]) : [];
    
    return NextResponse.json({
      ok: true,
      table: tableName,
      columns: sampleKeys,
      sample_count: sample?.length || 0,
      sample_data: sample || [],
      error: null
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message,
      stack: err.stack
    });
  }
}

// Keep GET for backwards compatibility
export async function GET() {
  try {
    const dispatch = getSupabaseDispatch() || getSupabase();
    
    if (!dispatch) {
      return NextResponse.json({ ok: false, error: 'No database client' });
    }
    
    const { data: sample, error: sampleError } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    const sampleKeys = sample && sample.length > 0 ? Object.keys(sample[0]) : [];
    
    return NextResponse.json({
      ok: true,
      table: 'h2s_dispatch_jobs',
      columns: sampleKeys,
      sample_count: sample?.length || 0,
      recent_jobs: sample || [],
      error: sampleError?.message || null
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message,
      stack: err.stack
    });
  }
}
