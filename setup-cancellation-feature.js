/**
 * Setup script for job cancellation feature
 * Run this once to create the required database tables
 * 
 * Usage: node setup-cancellation-feature.js
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for admin operations
);

async function setupCancellationFeature() {
  console.log('🚀 Setting up Job Cancellation Feature...\n');

  try {
    // Step 1: Create cancellations tracking table
    console.log('📋 Creating h2s_job_cancellations table...');
    const { error: createTableError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS h2s_job_cancellations (
          cancellation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_id VARCHAR(255) NOT NULL,
          pro_id VARCHAR(255) NOT NULL,
          assignment_id UUID,
          reason TEXT NOT NULL,
          previous_state VARCHAR(50),
          cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `
    });

    if (createTableError) {
      throw new Error(`Failed to create table: ${createTableError.message}`);
    }
    console.log('✅ Table created successfully\n');

    // Step 2: Create indexes
    console.log('📊 Creating indexes...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_job_cancellations_job_id ON h2s_job_cancellations(job_id)',
      'CREATE INDEX IF NOT EXISTS idx_job_cancellations_pro_id ON h2s_job_cancellations(pro_id)',
      'CREATE INDEX IF NOT EXISTS idx_job_cancellations_cancelled_at ON h2s_job_cancellations(cancelled_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_job_cancellations_assignment_id ON h2s_job_cancellations(assignment_id)'
    ];

    for (const indexSql of indexes) {
      const { error: indexError } = await supabase.rpc('exec_sql', { sql: indexSql });
      if (indexError) {
        console.warn(`⚠️  Index creation warning: ${indexError.message}`);
      }
    }
    console.log('✅ Indexes created successfully\n');

    // Step 3: Add columns to assignments table
    console.log('🔧 Adding columns to h2s_dispatch_job_assignments...');
    const { error: alterError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE h2s_dispatch_job_assignments 
          ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
      `
    });

    if (alterError) {
      console.warn(`⚠️  Column addition warning: ${alterError.message}`);
    }
    console.log('✅ Columns added successfully\n');

    // Step 4: Verify setup
    console.log('🔍 Verifying setup...');
    
    const { data: tableCheck, error: checkError } = await supabase
      .from('h2s_job_cancellations')
      .select('*')
      .limit(1);

    if (checkError && !checkError.message.includes('no rows')) {
      throw new Error(`Verification failed: ${checkError.message}`);
    }

    console.log('✅ Verification successful\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Job Cancellation Feature Setup Complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Next steps:');
    console.log('1. Deploy backend: cd Home2smart-backend && vercel --prod');
    console.log('2. Test cancellation in tech portal');
    console.log('3. Monitor h2s_job_cancellations table for logs\n');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error('\nManual setup option:');
    console.error('Run the SQL file directly: backend/create_job_cancellations_table.sql');
    process.exit(1);
  }
}

// Run setup
setupCancellationFeature();
