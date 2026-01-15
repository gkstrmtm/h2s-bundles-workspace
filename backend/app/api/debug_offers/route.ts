import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

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

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = getSupabase();
  const PRO_ID = 'afd3c72c-2712-4a6c-8ab6-7580c57e3f2e';

  //Get pro profile
  const { data: proData } = await sb.from('h2s_pros').select('*').eq('pro_id', PRO_ID).single();
  
  // Get all jobs
  const { data: jobsData } = await sb.from('h2s_dispatch_jobs').select('*').eq('status', 'queued');
  
  // Get all orders
  const { data: ordersData } = await sb.from('h2s_orders').select('*');
  
  // Map orders by job_id
  const orderByJobId = new Map();
  ordersData?.forEach((o: any) => {
    const meta = safeParseJson(o.metadata_json) || safeParseJson(o.metadata) || {};
    const jid = meta.dispatch_job_id || meta.job_id;
    if (jid) orderByJobId.set(jid, o);
  });
  
  // Enrich jobs with orders
  const enrichedJobs = (jobsData || []).map((j: any) => {
    const order = orderByJobId.get(j.job_id);
    if (!order) return { ...j, _enriched: false };
    
    const meta = safeParseJson(order.metadata_json) || safeParseJson(order.metadata) || {};
    return {
      job_id: j.job_id,
      _enriched: true,
      service_address: order.address,
      service_city: order.city,
      service_state: order.state,
      service_zip: order.zip,
      geo_lat: order.geo_lat,
      geo_lng: order.geo_lng,
    };
  });
  
  return NextResponse.json({
    pro: {
      pro_id: proData?.pro_id,
      home_zip: proData?.home_zip,
      zip: proData?.zip,
      geo_lat: proData?.geo_lat,
      geo_lng: proData?.geo_lng,
    },
    jobs_total: jobsData?.length || 0,
    orders_total: ordersData?.length || 0,
    jobs_mapped_to_orders: enrichedJobs.filter((j: any) => j._enriched).length,
    enriched_jobs: enrichedJobs,
  });
}
