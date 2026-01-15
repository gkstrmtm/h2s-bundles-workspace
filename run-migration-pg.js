import pkg from 'pg';
const { Client } = pkg;

const connectionString = 'postgresql://postgres.vqbrqzhzuzqjlhqqxahz:Greenbay!2024@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

const client = new Client({ connectionString });

try {
  await client.connect();
  console.log('✅ Connected to database\n');

  // Add metadata_json column
  console.log('Adding metadata_json column...');
  await client.query(`
    ALTER TABLE h2s_dispatch_jobs 
    ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;
  `);
  console.log('✅ Column added\n');

  // Create index
  console.log('Creating index...');
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_metadata 
    ON h2s_dispatch_jobs USING GIN (metadata_json);
  `);
  console.log('✅ Index created\n');

  // Add comment
  await client.query(`
    COMMENT ON COLUMN h2s_dispatch_jobs.metadata_json IS 'Job details payload including services, bonuses, technician tasks, pay level, equipment, etc.';
  `);

  console.log('✅ Migration completed successfully');
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
} finally {
  await client.end();
}
