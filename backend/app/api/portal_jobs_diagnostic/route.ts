import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';

function safeParseJson(value: any): any {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    try {
      const inner = JSON.parse(s);
      if (typeof inner === 'string') return JSON.parse(inner);
      return inner;
    } catch {
      return null;
    }
  }
}

// Force dynamic rendering (uses request.headers)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const logs: string[] = [];
  const log = (msg: string) => { console.log(msg); logs.push(msg); };
  
  try {
    log('=== PORTAL JOBS DIAGNOSTIC ===');
    
    // Test database connections
    log('\n1. Testing database connections...');
    let main: any | null = null;
    let dispatch: any | null = null;
    
    try {
      main = getSupabase();
      log('✅ Main database client: CONNECTED');
    } catch (err) {
      log(`❌ Main database client: ERROR - ${err instanceof Error ? err.message : String(err)}`);
    }
    
    try {
      dispatch = getSupabaseDispatch();
      log('✅ Dispatch database client: CONNECTED');
    } catch (err) {
      log(`❌ Dispatch database client: ERROR - ${err instanceof Error ? err.message : String(err)}`);
    }
    
    log(`\n Main and Dispatch are same client: ${main === dispatch}`);
    
    // Test jobs query
    log('\n2. Testing h2s_dispatch_jobs query...');
    if (dispatch) {
      const { data: jobs, error } = await dispatch
        .from('h2s_dispatch_jobs')
        .select('*')
        .limit(5);
      
      if (error) {
        log(`❌ Jobs query ERROR: ${error.message}`);
      } else {
        log(`✅ Jobs query SUCCESS: ${jobs?.length || 0} jobs found`);
        if (jobs && jobs.length > 0) {
          log(`   Sample job: ${JSON.stringify(jobs[0], null, 2)}`);
        }
      }
    }
    
    // Test orders query
    log('\n3. Testing h2s_orders query...');
    if (main) {
      const { data: orders, error } = await main
        .from('h2s_orders')
        .select('*')
        .limit(5);
      
      if (error) {
        log(`❌ Orders query ERROR: ${error.message}`);
      } else {
        log(`✅ Orders query SUCCESS: ${orders?.length || 0} orders found`);
        if (orders && orders.length > 0) {
          const sample = orders[0];
          const meta = safeParseJson(sample.metadata_json) || safeParseJson(sample.metadata) || {};
          log(`   Sample order:`);
          log(`     - dispatch_job_id: ${meta.dispatch_job_id || 'MISSING'}`);
          log(`     - address: ${sample.address || 'MISSING'}`);
          log(`     - geo: ${meta.geo_lat}, ${meta.geo_lng}`);
        }
      }
    }
    
    // Test enrichment
    log('\n4. Testing enrichment logic...');
    if (dispatch && main) {
      const { data: jobs } = await dispatch
        .from('h2s_dispatch_jobs')
        .select('*')
        .eq('status', 'queued')
        .limit(10);
        
      const { data: orders } = await main
        .from('h2s_orders')
        .select('*')
        .limit(100);
      
      const orderMap = new Map();
      (orders || []).forEach((o: any) => {
        const meta = safeParseJson(o.metadata_json) || safeParseJson(o.metadata) || {};
        const jid = meta.dispatch_job_id || meta.job_id;
        if (jid) orderMap.set(jid, o);
      });
      
      log(`   Jobs with 'queued' status: ${jobs?.length || 0}`);
      log(`   Orders mapped to jobs: ${orderMap.size}`);
      
      let enrichedCount = 0;
      (jobs || []).forEach((j: any) => {
        const order = orderMap.get(j.job_id);
        if (order) {
          enrichedCount++;
          const meta = safeParseJson(order.metadata_json) || safeParseJson(order.metadata) || {};
          log(`   ✅ Job ${j.job_id}: ${order.address}, ${order.city} ${order.zip} (${meta.geo_lat}, ${meta.geo_lng})`);
        } else {
          log(`   ❌ Job ${j.job_id}: NO MATCHING ORDER`);
        }
      });
      
      log(`\n   Enriched ${enrichedCount}/${jobs?.length || 0} jobs`);
    }
    
    // Test pro query
    log('\n5. Testing pro profile query...');
    const proId = 'afd3c72c-2712-4a6c-8ab6-7580c57e3f2e';
    if (dispatch) {
      const tablesToTry = ['h2s_pros', 'h2s_dispatch_pros', 'H2S_Pros'];
      for (const table of tablesToTry) {
        try {
          const { data, error } = await dispatch
            .from(table)
            .select('*')
            .eq('pro_id', proId)
            .limit(1);
          
          if (!error && data && data.length > 0) {
            const pro = data[0];
            log(`✅ Found pro in ${table}:`);
            log(`     - geo: ${pro.geo_lat}, ${pro.geo_lng}`);
            log(`     - zip: ${pro.zip_code || pro.zip || pro.postal_code}`);
            break;
          }
        } catch (err) {
          log(`   ${table}: ${err instanceof Error ? err.message : 'error'}`);
        }
      }
    }
    
    log('\n=== END DIAGNOSTIC ===');
    
    return NextResponse.json(
      {
        ok: true,
        logs,
        summary: {
          mainClient: main ? 'connected' : 'null',
          dispatchClient: dispatch ? 'connected' : 'null',
          sameClient: main === dispatch
        }
      },
      { headers: corsHeaders(request) }
    );
    
  } catch (err) {
    log(`\n❌ FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`);
    log(`Stack: ${err instanceof Error ? err.stack : 'No stack'}`);
    
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        logs
      },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
