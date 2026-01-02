// Query Supabase to get ALL table names and structures
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getAllTables() {
  console.log('\n🔍 QUERYING SUPABASE FOR ALL TABLES\n');
  console.log('='.repeat(70));

  try {
    // Query information_schema to get all tables
    const { data, error } = await supabase.rpc('get_all_tables', {});
    
    if (error) {
      // If RPC doesn't exist, try direct query
      console.log('Direct SQL query for tables...\n');
      
      // Get list of tables by trying to select from each known prefix
      const knownPrefixes = ['h2s_', 'public.'];
      const tables = [];
      
      // Try common table patterns
      const testTables = [
        'h2s_orders',
        'h2s_customers',
        'h2s_tracking_events',
        'h2s_visitors',
        'h2s_appointments',
        'h2s_availability',
        'h2s_calendar',
        'h2s_schedule',
        'h2s_technicians',
        'h2s_bookings',
        'availability_calendar',
        'appointments',
        'orders',
        'customers',
        'tracking_events'
      ];
      
      console.log('📋 TESTING TABLE EXISTENCE:\n');
      
      for (const tableName of testTables) {
        try {
          const { data, error } = await supabase
            .from(tableName)
            .select('*', { count: 'exact', head: true })
            .limit(0);
          
          if (!error) {
            console.log(`✅ ${tableName} - EXISTS`);
            tables.push(tableName);
          } else if (error.code !== 'PGRST116') { // Not "table not found"
            console.log(`⚠️  ${tableName} - ${error.message}`);
          }
        } catch (e) {
          // Silent fail
        }
      }
      
      console.log(`\n📊 FOUND ${tables.length} TABLES\n`);
      console.log('='.repeat(70));
      
      return tables;
    }
    
    return data;
    
  } catch (err) {
    console.error('❌ Error querying tables:', err.message);
    return [];
  }
}

async function getTableStructure(tableName) {
  try {
    // Get first row to see structure
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    if (!error && data && data.length > 0) {
      return Object.keys(data[0]);
    }
    
    // If no data, try to infer from error messages
    const { error: structError } = await supabase
      .from(tableName)
      .select('*')
      .limit(0);
    
    return null;
  } catch (err) {
    return null;
  }
}

async function main() {
  const tables = await getAllTables();
  
  console.log('\n📝 TABLE STRUCTURES:\n');
  
  for (const table of tables) {
    const columns = await getTableStructure(table);
    if (columns) {
      console.log(`\n${table}:`);
      console.log(`  Columns: ${columns.join(', ')}`);
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n✅ Database scan complete\n');
}

main();
