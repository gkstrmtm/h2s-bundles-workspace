// Query the actual database schema
const https = require('https');

console.log('\n========== QUERYING h2s_dispatch_jobs ACTUAL SCHEMA ==========\n');

https.get('https://h2s-backend.vercel.app/api/get_table_schema', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    
    if (!result.ok) {
      console.error('❌ Error:', result.error);
      return;
    }
    
    console.log(`Table: ${result.table}`);
    console.log(`Sample Count: ${result.sample_count}`);
    console.log('\n✅ ACTUAL COLUMNS IN DATABASE:\n');
    
    result.columns.forEach((col, i) => {
      console.log(`  ${i + 1}. ${col}`);
    });
    
    if (result.sample_data) {
      console.log('\n📋 Sample Data Structure:');
      console.log(JSON.stringify(result.sample_data, null, 2));
    }
    
    console.log('\n========================================\n');
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});
