const { Client } = require('pg');

const connectionString = 'postgresql://postgres.ulbzmgmxrqyipclrbohi:Greenbay!2024@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

async function runMigration() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Drop bad constraint
    console.log('Dropping recipient+step uniqueness constraint...');
    await client.query(`
      ALTER TABLE h2s_dispatch_jobs 
      DROP CONSTRAINT IF EXISTS h2s_dispatch_jobs_recipient_step_uq
    `);
    console.log('✅ Dropped h2s_dispatch_jobs_recipient_step_uq\n');

    // Add order_id column if needed
    console.log('Checking for order_id column...');
    const colCheck = await client.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'h2s_dispatch_jobs' 
      AND column_name = 'order_id'
    `);
    
    if (colCheck.rows.length === 0) {
      console.log('Adding order_id column...');
      await client.query('ALTER TABLE h2s_dispatch_jobs ADD COLUMN order_id TEXT');
      console.log('✅ Added order_id column\n');
    } else {
      console.log('✓ order_id column already exists\n');
    }

    // Create unique index on order_id
    console.log('Creating unique index on order_id...');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS h2s_dispatch_jobs_order_id_uq 
      ON h2s_dispatch_jobs(order_id)
    `);
    console.log('✅ Created h2s_dispatch_jobs_order_id_uq\n');

    // Add index for recipient lookups
    console.log('Creating recipient_id index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS h2s_dispatch_jobs_recipient_id_idx 
      ON h2s_dispatch_jobs(recipient_id)
    `);
    console.log('✅ Created recipient_id index\n');

    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Details:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
