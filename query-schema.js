// Query database to get actual h2s_dispatch_jobs schema
const https = require('https');

const query = `
-- Create a diagnostic endpoint that returns actual table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'h2s_dispatch_jobs'
ORDER BY ordinal_position;
`;

console.log('\n========== QUERYING h2s_dispatch_jobs SCHEMA ==========\n');

// Create a diagnostic API endpoint first
const diagnosticEndpoint = `
import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';

export async function GET() {
  try {
    const dispatch = getSupabaseDispatch() || getSupabase();
    
    // Get table schema from information_schema
    const { data: columns, error } = await dispatch
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'h2s_dispatch_jobs')
      .order('ordinal_position');
    
    if (error) {
      return NextResponse.json({ 
        ok: false, 
        error: error.message,
        fallback: 'Trying sample query...'
      });
    }
    
    // Also try to get a sample row to see actual structure
    const { data: sample, error: sampleError } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('*')
      .limit(1)
      .single();
    
    return NextResponse.json({
      ok: true,
      columns: columns,
      sample_keys: sample ? Object.keys(sample) : [],
      sample_error: sampleError?.message || null
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message
    });
  }
}
`;

console.log('Creating endpoint to query schema...\n');
require('fs').writeFileSync(
  'C:\\Users\\tabar\\h2s-bundles-workspace\\backend\\app\\api\\get_table_schema\\route.ts',
  diagnosticEndpoint
);

console.log('✅ Created: backend/app/api/get_table_schema/route.ts');
console.log('\nNext steps:');
console.log('1. cd backend && npm run build');
console.log('2. vercel --prod --yes');
console.log('3. vercel alias set [new-deployment] h2s-backend.vercel.app');
console.log('4. curl https://h2s-backend.vercel.app/api/get_table_schema');
console.log('\n========================================\n');
