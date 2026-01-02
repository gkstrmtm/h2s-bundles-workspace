// List ALL tables in Supabase database
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://ulbzmgmxrqyipclrbohi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsYnptZ214cnF5aXBjbHJib2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzA1MDE3OSwiZXhwIjoyMDc4NjI2MTc5fQ.LdMPrz04SRxAJgin-vAgABi4vd8uUiKqjWZ6ZJ1t9B4';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ALL tables we use in the codebase based on grep search
const ALL_TABLES = [
  // H2S tables (shop/customer facing)
  'h2s_orders',
  'h2s_customers',
  'h2s_tracking_events',
  'h2s_tracking_visitors',
  'h2s_customer_identities',
  'h2s_reviews',
  
  // Dashboard tables (hiring/VA management)
  'Candidate_Master',
  'AI_Candidate_Profiles',
  'Tasks',
  'VA_Hours_Log',
  'Training_Resources',
  'Training_Completions',
  'Training_Analytics',
  'VA_Knowledge_Profiles',
  'VaKnowledgeProfile', // Note: different casing
  'Deliverables',
  'Meetings',
  'Offers',
  
  // Possible appointment/availability tables
  'availability_calendar',
  'h2s_appointments',
  'h2s_availability',
  'h2s_calendar',
  'h2s_schedule',
  'h2s_technicians',
  'h2s_bookings',
  'appointment_bookings',
  'technician_schedule',
  'tech_availability'
];

async function checkTable(tableName) {
  try {
    const { data, error, count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true })
      .limit(0);
    
    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
        return { name: tableName, exists: false, error: 'Table not found' };
      }
      return { name: tableName, exists: false, error: error.message };
    }
    
    return { name: tableName, exists: true, rowCount: count };
  } catch (err) {
    return { name: tableName, exists: false, error: err.message };
  }
}

async function getTableColumns(tableName) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    if (data && data.length > 0) {
      return Object.keys(data[0]);
    }
    
    // No rows, but table exists - try to get schema another way
    return ['(no data to infer columns)'];
  } catch (err) {
    return [];
  }
}

async function main() {
  console.log('\n🔍 SUPABASE DATABASE SCAN\n');
  console.log('='.repeat(80));
  console.log(`Database: ${supabaseUrl}\n`);
  
  const results = await Promise.all(ALL_TABLES.map(checkTable));
  
  const existing = results.filter(r => r.exists);
  const missing = results.filter(r => !r.exists);
  
  console.log(`\n✅ EXISTING TABLES (${existing.length}):\n`);
  
  for (const table of existing) {
    console.log(`   ${table.name}`);
    console.log(`      Rows: ${table.rowCount !== null ? table.rowCount : 'unknown'}`);
    
    // Get columns
    const columns = await getTableColumns(table.name);
    if (columns.length > 0 && columns[0] !== '(no data to infer columns)') {
      console.log(`      Columns: ${columns.join(', ')}`);
    }
    console.log('');
  }
  
  console.log(`\n❌ MISSING/INACCESSIBLE TABLES (${missing.length}):\n`);
  
  for (const table of missing) {
    console.log(`   ${table.name} - ${table.error}`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 SUMMARY: ${existing.length} exist, ${missing.length} missing\n`);
  
  // Group by prefix
  console.log('📁 TABLES BY CATEGORY:\n');
  const h2sTables = existing.filter(t => t.name.startsWith('h2s_'));
  const dashTables = existing.filter(t => !t.name.startsWith('h2s_'));
  
  console.log(`   h2s_* (shop/customer): ${h2sTables.length} tables`);
  h2sTables.forEach(t => console.log(`      - ${t.name}`));
  
  console.log(`\n   Other (dashboard/VA): ${dashTables.length} tables`);
  dashTables.forEach(t => console.log(`      - ${t.name}`));
  
  console.log('\n');
}

main().catch(console.error);
