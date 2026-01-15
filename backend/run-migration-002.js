const { Client } = require('pg');

const connectionString = 'postgresql://postgres.ulbzmgmxrqyipclrbohi:0KO53vJoF4iOtzf7@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

async function runMigration() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    console.log('1. INSPECT CONSTRAINT (Before)');
    const resBefore = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'public.h2s_dispatch_jobs'::regclass 
      AND conname = 'h2s_dispatch_jobs_status_check';
    `);
    console.log(resBefore.rows);

    console.log('\n2. DROPPING CONSTRAINT...');
    await client.query(`
      ALTER TABLE public.h2s_dispatch_jobs
      DROP CONSTRAINT IF EXISTS h2s_dispatch_jobs_status_check;
    `);
    console.log('✅ Dropped h2s_dispatch_jobs_status_check');

    console.log('\n3. RE-CREATING CONSTRAINT (With completed/done)...');
    await client.query(`
      ALTER TABLE public.h2s_dispatch_jobs
      ADD CONSTRAINT h2s_dispatch_jobs_status_check
      CHECK (status IN ('queued', 'assigned', 'in_progress', 'completed', 'cancelled', 'done'));
    `);
    console.log('✅ Created new constraint');

    console.log('\n4. VERIFYING...');
    const resAfter = await client.query(`
        SELECT conname, pg_get_constraintdef(oid) 
        FROM pg_constraint 
        WHERE conrelid = 'public.h2s_dispatch_jobs'::regclass 
        AND conname = 'h2s_dispatch_jobs_status_check';
      `);
    console.log(resAfter.rows);

  } catch (err) {
    console.error('❌ Migration Failed:', err);
  } finally {
    await client.end();
  }
}

runMigration();
