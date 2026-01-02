import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getSupabase();
    
    // Direct query to h2s_reviews
    const { data, error } = await client
      .from('h2s_reviews')
      .select('*')
      .limit(10);

    return NextResponse.json({
      ok: true,
      found: data?.length || 0,
      error: error?.message || null,
      data: data,
      columns: data?.[0] ? Object.keys(data[0]) : []
    });

  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error.message
    }, { status: 500 });
  }
}
