// Test that mimics EXACTLY what the backend does
const { createClient } = require('@supabase/supabase-js');

// Use the same credentials the backend uses
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ulbzmgmxrqyipclrbohi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_KEY environment variable');
  console.error('   Set it in your .env file or pass it as an environment variable');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testExactBackendInsert() {
  console.log('🔍 Testing EXACT backend insert logic...\n');
  console.log('='.repeat(60));
  console.log('Supabase URL:', SUPABASE_URL);
  console.log('Service Key:', SUPABASE_SERVICE_KEY.substring(0, 20) + '...');
  console.log('='.repeat(60) + '\n');

  // Generate a test UUID (same format as frontend)
  const testVisitorId = 'a3753242-f021-4c2a-a48d-970523f123cd';
  const testTime = new Date().toISOString();

  // This is EXACTLY what the backend does (lines 450-467)
  const insertData = {
    visitor_id: testVisitorId,
    first_seen_at: testTime,
    last_seen_at: testTime,
    first_utm_source: null,
    first_utm_medium: null,
    first_utm_campaign: null,
    first_utm_term: null,
    first_utm_content: null,
    first_referrer: null,
    last_utm_source: null,
    last_utm_medium: null,
    last_utm_campaign: null,
    last_utm_term: null,
    last_utm_content: null,
    last_referrer: '(direct)',
    device_type: null
  };

  console.log('📋 Insert data (exactly as backend sends):');
  console.log(JSON.stringify(insertData, null, 2));
  console.log('\n');

  try {
    console.log('🔄 Attempting insert...\n');
    const { data, error } = await supabase
      .from('h2s_tracking_visitors')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('❌ INSERT FAILED!');
      console.error('Error Code:', error.code);
      console.error('Error Message:', error.message);
      console.error('Error Details:', error.details);
      console.error('Error Hint:', error.hint);
      console.error('\nFull Error Object:');
      console.error(JSON.stringify(error, null, 2));
      
      // Check for specific error types
      if (error.code === '42501') {
        console.error('\n💡 This is a PERMISSION error - RLS policy is blocking the insert');
      } else if (error.code === '23505') {
        console.error('\n💡 This is a DUPLICATE KEY error - visitor already exists');
      } else if (error.code === '42P01') {
        console.error('\n💡 This is a TABLE NOT FOUND error - table does not exist');
      } else if (error.message?.includes('column')) {
        console.error('\n💡 This is a COLUMN error - column name mismatch');
      }
      
      return false;
    } else {
      console.log('✅ INSERT SUCCESS!');
      console.log('Inserted visitor:', JSON.stringify(data, null, 2));
      
      // Clean up
      console.log('\n🧹 Cleaning up test visitor...');
      const { error: deleteError } = await supabase
        .from('h2s_tracking_visitors')
        .delete()
        .eq('visitor_id', testVisitorId);
      
      if (deleteError) {
        console.warn('⚠️  Cleanup warning:', deleteError.message);
      } else {
        console.log('✅ Cleanup successful');
      }
      
      return true;
    }
  } catch (err) {
    console.error('❌ EXCEPTION during insert:');
    console.error(err);
    return false;
  }
}

testExactBackendInsert()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    if (success) {
      console.log('✅ TEST PASSED: Backend insert logic works!');
    } else {
      console.log('❌ TEST FAILED: Backend insert logic has issues');
      console.log('\n💡 NEXT STEPS:');
      console.log('1. Check the error message above');
      console.log('2. If RLS error → check RLS policies in Supabase');
      console.log('3. If column error → check column names match');
      console.log('4. If permission error → check service key has INSERT permission');
    }
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('❌ Test script error:', err);
    process.exit(1);
  });

