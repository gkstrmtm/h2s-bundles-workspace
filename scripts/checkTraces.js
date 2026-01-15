// Check trace tables to see what failed during checkout
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL_DB1 || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTraces() {
  console.log('=== RECENT CHECKOUT TRACES ===\n');
  
  // Get recent trace IDs
  const { data: traces, error: tracesErr } = await supabase
    .from('h2s_checkout_traces')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
    
  if (tracesErr) {
    console.error('Traces query error:', tracesErr);
    return;
  }
  
  console.log(`Found ${traces?.length || 0} trace entries\n`);
  
  if (traces && traces.length > 0) {
    // Group by trace_id
    const byTraceId = {};
    traces.forEach(t => {
      const tid = t.checkout_trace_id;
      if (!byTraceId[tid]) byTraceId[tid] = [];
      byTraceId[tid].push(t);
    });
    
    // Show each checkout flow
    Object.keys(byTraceId).slice(0, 3).forEach((traceId, idx) => {
      const steps = byTraceId[traceId].sort((a, b) => 
        new Date(a.created_at) - new Date(b.created_at)
      );
      
      console.log(`\n[${idx + 1}] Trace ID: ${traceId.substring(0, 8)}...`);
      console.log(`    Started: ${steps[0].created_at}`);
      
      steps.forEach(s => {
        console.log(`    - ${s.stage}`);
        if (s.order_id) console.log(`      order_id: ${s.order_id}`);
        if (s.job_id) console.log(`      job_id: ${s.job_id}`);
        if (s.stripe_session_id) console.log(`      session: ${s.stripe_session_id.substring(0, 20)}...`);
      });
    });
  }
  
  // Check failures
  console.log('\n\n=== CHECKOUT FAILURES ===\n');
  
  const { data: failures, error: failErr } = await supabase
    .from('h2s_checkout_failures')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (failErr) {
    console.error('Failures query error:', failErr);
    return;
  }
  
  console.log(`Found ${failures?.length || 0} failures\n`);
  
  if (failures && failures.length > 0) {
    failures.forEach((f, idx) => {
      console.log(`\n[${idx + 1}] ${f.stage} - ${f.created_at}`);
      console.log(`    Trace: ${f.checkout_trace_id.substring(0, 8)}...`);
      console.log(`    Error: ${f.error_message}`);
      if (f.context_json) {
        console.log(`    Context:`, JSON.stringify(f.context_json, null, 2));
      }
    });
  }
}

checkTraces().catch(console.error);
