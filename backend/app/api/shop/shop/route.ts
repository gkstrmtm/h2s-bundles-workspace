import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseMgmt } from '@/lib/supabase';
import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'catalog':
        // Return catalog structure expected by bundles.html
        // This should match the structure: { services, serviceOptions, priceTiers, bundles, bundleItems, recommendations, memberships, membershipPrices }
        const catalog: {
          services: any[];
          serviceOptions: any[];
          priceTiers: any[];
          bundles: any[];
          bundleItems: any[];
          recommendations: any[];
          memberships: any[];
          membershipPrices: any[];
        } = {
          services: [],
          serviceOptions: [],
          priceTiers: [],
          bundles: [],
          bundleItems: [],
          recommendations: [],
          memberships: [],
          membershipPrices: []
        };

        // Try to fetch from database if available
        const client = getSupabase();
        if (client) {
          try {
            // Query catalog data from database (adjust table names as needed)
            const [servicesRes, bundlesRes, priceTiersRes] = await Promise.all([
              client.from('services').select('*').eq('active', true),
              client.from('bundles').select('*').eq('active', true),
              client.from('price_tiers').select('*')
            ]);

            catalog.services = servicesRes.data || [];
            catalog.bundles = bundlesRes.data || [];
            catalog.priceTiers = priceTiersRes.data || [];
          } catch (dbError) {
            console.warn('[Shop API] Database query failed, using empty catalog:', dbError);
          }
        }

        return NextResponse.json({
          ok: true,
          catalog
        }, { headers: corsHeaders() });

      case 'ai_sales':
        const email = searchParams.get('email');
        const mode = searchParams.get('mode') || 'recommendations';

        if (!email) {
          return NextResponse.json({
            success: false,
            error: 'Email parameter required'
          }, { status: 400, headers: corsHeaders() });
        }

        if (!openai) {
          return NextResponse.json({
            success: false,
            error: 'AI service not configured'
          }, { status: 503, headers: corsHeaders() });
        }

        // Get user's purchase history and preferences
        const trackingClient = getSupabase();
        let userHistory: any[] = [];
        
        if (trackingClient) {
          try {
            const { data: events } = await trackingClient
              .from('h2s_tracking_events')
              .select('event_type, page_path, metadata, event_ts')
              .eq('customer_email', email)
              .order('event_ts', { ascending: false })
              .limit(50);

            userHistory = events || [];
          } catch (err) {
            console.warn('[Shop API] Failed to fetch user history:', err);
          }
        }

        // Generate AI recommendations
        const prompt = `You are a smart home services sales assistant. Based on the user's browsing history and preferences, provide personalized product recommendations.

User Email: ${email}
Browsing History: ${JSON.stringify(userHistory.slice(0, 10))}

Provide 3-5 product recommendations in JSON format:
{
  "recommendations": [
    {
      "bundle_id": "string",
      "title": "Product name",
      "description": "Why this is recommended",
      "match_score": 0.85
    }
  ],
  "reasoning": "Brief explanation of recommendations"
}`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a smart home services sales assistant. Always return valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 500,
          response_format: { type: 'json_object' }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');

        return NextResponse.json({
          success: true,
          ai_analysis: {
            recommendations: aiResponse.recommendations || [],
            reasoning: aiResponse.reasoning || ''
          }
        }, { headers: corsHeaders() });

      default:
        return NextResponse.json({
          ok: false,
          error: 'Invalid action. Supported: catalog, ai_sales'
        }, { status: 400, headers: corsHeaders() });
    }

  } catch (error: any) {
    console.error('[Shop API] Error:', error);
    return NextResponse.json({
      ok: false,
      success: false,
      error: error.message || 'Internal server error'
    }, { status: 500, headers: corsHeaders() });
  }
}

