const { Client } = require('pg');

const connectionString = 'postgresql://postgres.ulbzmgmxrqyipclrbohi:Greenbay!2024@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

async function migrate() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected\n');

    console.log('Adding metadata_json column...');
    await client.query(`ALTER TABLE h2s_dispatch_jobs ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;`);
    console.log('✅ Column added\n');

    console.log('Creating index...');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_metadata ON h2s_dispatch_jobs USING GIN (metadata_json);`);
    console.log('✅ Index created\n');

    console.log('✅ Migration completed');
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
