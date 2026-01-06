// Quick DB table inspector for schema verification
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const client = createClient(supabaseUrl, supabaseKey);

async function inspectTables() {
  console.log('\n📊 DATABASE SCHEMA INSPECTION\n');
  console.log('=' .repeat(80));

  const tables = ['h2s_orders', 'h2s_dispatch_jobs', 'h2s_recipients', 'h2s_pros'];

  for (const table of tables) {
    console.log(`\n📋 Table: ${table}`);
    console.log('-'.repeat(80));

    try {
      // Get sample row to infer schema
      const { data, error } = await client
        .from(table)
        .select('*')
        .limit(1);

      if (error) {
        console.error(`   ❌ Error: ${error.message}`);
        if (error.code === '42P01') {
          console.error(`   🔴 Table does NOT exist`);
        }
        continue;
      }

      if (!data || data.length === 0) {
        console.log(`   ⚠️  Table exists but is EMPTY`);
        continue;
      }

      const row = data[0];
      const columns = Object.keys(row);
      
      console.log(`   ✅ Columns (${columns.length}):`);
      columns.forEach(col => {
        const val = row[col];
        const type = val === null ? 'NULL' : typeof val;
        console.log(`      - ${col}: ${type}`);
      });

      // Get row count
      const { count, error: countError } = await client
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (!countError) {
        console.log(`   📊 Total rows: ${count || 0}`);
      }
    } catch (err) {
      console.error(`   ❌ Exception: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Inspection complete\n');
}

inspectTables().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
