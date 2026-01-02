import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getSupabase();
    
    // Query the information_schema to get all tables
    const { data: tables, error } = await client
      .rpc('exec', { 
        query: `
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
          ORDER BY table_name;
        `
      })
      .select();

    if (error) {
      // Fallback: Try to query tables by attempting queries
      const tablesToTry = [
        'customer_reviews',
        'h2s_reviews', 
        'reviews',
        'reviews_table',
        // Storefront / orders
        'h2s_orders',
        'h2s_users',
        'h2s_services',
        'h2s_bundles',
        'h2s_bundle_items',
        // Portal announcements (known tables in legacy backend)
        'h2s_announcements',
        'h2s_announcement_views',
        'h2s_sessions',
        'h2s_admin_sessions',
        // Dispatch / portal (guessing common names)
        'h2s_dispatch_jobs',
        'h2s_dispatch_job_assignments',
        'h2s_dispatch_announcements',
        'h2s_dispatch_job_artifacts',
        'h2s_dispatch_job_photos',
        'h2s_dispatch_payouts',
        'h2s_dispatch_pros',
        'h2s_pros',
        'h2s_pro_profiles',
        'h2s_techs',
        'h2s_technicians',
        'h2s_pro_tokens',
        'Candidate_Master',
        'Tasks',
        'Meetings'
      ];

      const results: any = {};
      
      for (const tableName of tablesToTry) {
        try {
          const { data, error: tableError } = await client
            .from(tableName)
            .select('*')
            .limit(1);
          
          if (tableError) {
            results[tableName] = { exists: false, error: tableError.message };
          } else {
            results[tableName] = { 
              exists: true, 
              sampleCount: data?.length || 0,
              sampleRecord: data?.[0] ? Object.keys(data[0]) : []
            };
          }
        } catch (e: any) {
          results[tableName] = { exists: false, error: e.message };
        }
      }

      return NextResponse.json({
        ok: true,
        method: 'fallback_query',
        tables: results
      });
    }

    return NextResponse.json({
      ok: true,
      method: 'information_schema',
      tables: tables
    });

  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error.message
    }, { status: 500 });
  }
}
