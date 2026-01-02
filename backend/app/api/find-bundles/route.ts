import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getSupabase();
    
    // Try all possible bundles/services table name variations
    const tablesToTry = [
      'bundles',
      'h2s_bundles',
      'bundles_data',
      'service_bundles',
      'services',
      'h2s_services',
      'service_catalog',
      'bundle_items',
      'h2s_bundle_items',
      'product_bundles',
      'shop_bundles',
      'shop_services',
      'catalog',
      'h2s_catalog',
      'h2s_shop',
      'shop_catalog'
    ];

    const results: any = {};
    
    for (const tableName of tablesToTry) {
      try {
        const { data, error: tableError } = await client
          .from(tableName)
          .select('*')
          .limit(3);
        
        if (tableError) {
          results[tableName] = { exists: false };
        } else {
          results[tableName] = { 
            exists: true, 
            count: data?.length || 0,
            columns: data?.[0] ? Object.keys(data[0]) : [],
            sample: data?.[0] || null
          };
        }
      } catch (e: any) {
        results[tableName] = { exists: false };
      }
    }

    return NextResponse.json({
      ok: true,
      tables: results
    });

  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error.message
    }, { status: 500 });
  }
}
