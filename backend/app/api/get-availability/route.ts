import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month'); // Format: YYYY-MM
  const date = searchParams.get('date'); // Format: YYYY-MM-DD

  try {
    const client = getSupabase();
    
    if (!client) {
      return NextResponse.json({
        success: false,
        availability: [],
        booked: [],
        error: 'Database not available'
      }, { status: 503, headers: corsHeaders() });
    }

    // Query h2s_orders for appointments (orders with APPT prefix)
    let query = client
      .from('h2s_orders')
      .select('order_id, items, created_at')
      .like('order_id', 'APPT%')
      .order('created_at', { ascending: true });

    // Filter by month or specific date if provided
    if (date) {
      query = query.gte('created_at', date).lt('created_at', `${date}T23:59:59`);
    } else if (month) {
      query = query.gte('created_at', `${month}-01`).lt('created_at', `${month}-32`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Get Availability] Error:', error);
      return NextResponse.json({
        success: false,
        availability: [],
        booked: [],
        error: error.message
      }, { status: 500, headers: corsHeaders() });
    }

    // Parse appointments from orders
    const bookedSlots = [];
    for (const order of data || []) {
      let items = order.items;
      
      // Parse items if stored as JSON string
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (e) {
          continue;
        }
      }
      
      // Extract appointment details
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.type === 'appointment' && item.date && item.time) {
            bookedSlots.push({
              order_id: order.order_id,
              date: item.date,
              time: item.time,
              service: item.service || 'Consultation',
              created_at: order.created_at
            });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      booked: bookedSlots,
      total: bookedSlots.length
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Get Availability] Error:', error);
    return NextResponse.json({
      success: false,
      booked: [],
      error: error.message
    }, { status: 500, headers: corsHeaders() });
  }
}
