import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSupabase, getSupabaseDb1 } from '@/lib/supabase';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper to handle CORS
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // Debug: Log action parameter
  console.log('[API_V1_GET]', { action, url: request.url });

  try {
    let result;

    switch (action) {
      case 'candidates':
        result = await prisma.candidate.findMany({
          orderBy: { updatedAt: 'desc' },
          include: { aiProfile: true }
        });
        break;

      case 'tasks':
        result = await prisma.task.findMany({
          where: { status: { not: 'ARCHIVED' } },
          orderBy: { priority: 'asc' } // High (1) -> Low (3)
        });
        break;

      case 'hours':
        // Support vaName filtering
        const hoursVaName = searchParams.get('vaName');
        const hoursWhere = hoursVaName && hoursVaName !== 'DEMO' 
          ? { loggedBy: hoursVaName }
          : {};
        
        result = await prisma.vaHoursLog.findMany({
          where: hoursWhere,
          orderBy: { date: 'desc' },
          take: 50
        });
        break;

      case 'training':
        result = await prisma.trainingResource.findMany({
          orderBy: { order: 'asc' }
        });
        break;
        
      case 'updateTaskStatus':
        const taskId = searchParams.get('taskId');
        const status = searchParams.get('status');
        if (taskId && status) {
          result = await prisma.task.update({
            where: { id: taskId },
            data: { 
              status, 
              completedAt: status === 'COMPLETED' ? new Date() : null 
            }
          });
        }
        break;

      case 'refineTask':
        const title = searchParams.get('title');
        const description = searchParams.get('description');
        if (title && description) {
          // Call OpenAI
          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert SOP writer. Convert rough notes into a clear, step-by-step Standard Operating Procedure." },
              { role: "user", content: `Task: ${title}\nNotes: ${description}` }
            ],
            model: "gpt-4",
          });
          result = { refinedDescription: completion.choices[0].message.content };
        }
        break;

      case 'refineExistingTask':
        const refineTaskId = searchParams.get('taskId');
        const feedback = searchParams.get('feedback');
        
        if (refineTaskId && feedback) {
          const task = await prisma.task.findUnique({ where: { id: refineTaskId } });
          if (!task) throw new Error('Task not found');

          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are a Revenue Operations Director. Clarify tasks to ensure high performance." },
              { role: "user", content: `CURRENT TASK:\nTitle: ${task.title}\nDescription: ${task.description}\n\nFEEDBACK: ${feedback}\n\nRewrite the description.` }
            ],
            model: "gpt-4",
          });
          
          const newDescription = completion.choices[0].message.content;
          await prisma.task.update({
            where: { id: refineTaskId },
            data: { description: newDescription }
          });
          
          result = { newDescription };
        }
        break;

      case 'archiveCandidate':
        const candidateId = searchParams.get('candidateId');
        // In a real DB, we might just set a status flag instead of moving tables
        if (candidateId) {
          result = await prisma.candidate.update({
            where: { id: candidateId },
            data: { currentStage: 'ARCHIVED' }
          });
        }
        break;

      // === TRACKING ANALYTICS ENDPOINTS ===
      case 'revenue':
        // Get revenue stats from h2s_tracking_events (purchase events with revenue_amount)
        // Adapted from backend/app/api/v1/route.ts - using event_ts instead of occurred_at
        const revenueClient = getSupabaseDb1() || getSupabase();
        if (!revenueClient) {
          result = { total_revenue: 0, total_orders: 0, average_order_value: 0, revenue_last_30_days: 0, revenue_by_source: {} };
          break;
        }
        
        const { data: purchaseEventsRevenue } = await revenueClient
          .from('h2s_tracking_events')
          .select('revenue_amount, event_ts, order_id, utm_source, utm_campaign, properties')
          .not('revenue_amount', 'is', null)
          .or('event_type.eq.purchase,event_name.eq.purchase');
        
        const totalRevenue = purchaseEventsRevenue?.reduce((sum, e) => sum + (parseFloat(e.revenue_amount) || 0), 0) || 0;
        const transactionCount = purchaseEventsRevenue?.length || 0;
        const avgTransaction = transactionCount > 0 ? totalRevenue / transactionCount : 0;
        
        // Last 30 days revenue
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentPurchases = purchaseEventsRevenue?.filter(e => 
          new Date(e.event_ts) >= thirtyDaysAgo
        ) || [];
        const revenueLast30Days = recentPurchases.reduce((sum, e) => sum + (parseFloat(e.revenue_amount) || 0), 0);
        
        // Revenue by source
        const revenueBySource: Record<string, number> = {};
        purchaseEventsRevenue?.forEach(e => {
          const source = e.utm_source || 'direct';
          revenueBySource[source] = (revenueBySource[source] || 0) + (parseFloat(e.revenue_amount) || 0);
        });
        
        result = {
          total_revenue: totalRevenue,
          total_orders: transactionCount,
          average_order_value: avgTransaction,
          revenue_last_30_days: revenueLast30Days,
          revenue_by_source: revenueBySource
        };
        break;

      case 'cohorts':
        // Calculate user cohorts from h2s_tracking_events
        // Adapted from backend/app/api/v1/route.ts - using event_ts and properties JSONB
        const cohortClient = getSupabaseDb1() || getSupabase();
        if (!cohortClient) {
          result = { total_users: 0, user_cohorts: { visitor: 0, browser: 0, engaged: 0, lead: 0, customer: 0 }, cohorts: [] };
          break;
        }
        
        const { data: cohortEvents } = await cohortClient
          .from('h2s_tracking_events')
          .select('visitor_id, event_type, event_ts, properties')
          .order('event_ts', { ascending: false })
          .limit(10000);
        
        // Group by visitor and determine their stage
        const visitorCohorts = new Map<string, any>();
        
        cohortEvents?.forEach(event => {
          // Extract customer_email from properties JSONB
          const properties = typeof event.properties === 'string' 
            ? JSON.parse(event.properties) 
            : event.properties || {};
          const customerEmail = properties.customer_email || null;
          
          // Use email as canonical identifier if available, else visitor_id
          const canonicalUserId = customerEmail 
            ? `email:${customerEmail.toLowerCase().trim()}` 
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!canonicalUserId) return;
          
          if (!visitorCohorts.has(canonicalUserId)) {
            visitorCohorts.set(canonicalUserId, {
              visitor_id: event.visitor_id,
              customer_email: customerEmail || null,
              first_seen: event.event_ts,
              last_seen: event.event_ts,
              stage: 'visitor',
              event_count: 0
            });
          }
          
          const cohort = visitorCohorts.get(canonicalUserId);
          cohort.event_count += 1;
          
          // Update stage based on event type
          if (event.event_type === 'purchase') {
            cohort.stage = 'customer';
          } else if ((event.event_type === 'lead' || event.event_type === 'complete_registration') && cohort.stage !== 'customer') {
            cohort.stage = 'lead';
          } else if (event.event_type === 'view_content' && cohort.stage === 'visitor') {
            cohort.stage = 'browser';
          }
          
          const eventDate = new Date(event.event_ts);
          if (eventDate > new Date(cohort.last_seen)) {
            cohort.last_seen = event.event_ts;
          }
          if (eventDate < new Date(cohort.first_seen)) {
            cohort.first_seen = event.event_ts;
          }
        });
        
        // Aggregate by stage
        const userCohorts: Record<string, number> = {
          visitor: 0,
          browser: 0,
          engaged: 0,
          lead: 0,
          customer: 0
        };
        
        visitorCohorts.forEach(cohort => {
          const stage = cohort.stage || 'visitor';
          if (userCohorts.hasOwnProperty(stage)) {
            userCohorts[stage] += 1;
          }
        });
        
        result = {
          total_users: visitorCohorts.size,
          user_cohorts: userCohorts,
          cohorts: Array.from(visitorCohorts.values()).slice(0, 100)
        };
        break;

      case 'meta_pixel_events':
        // Query Database 1 directly (h2s_tracking_events table)
        // Adapted from backend/app/api/v1/route.ts - using event_ts instead of occurred_at
        let allEvents;
        const db1Client = getSupabaseDb1();
        
        if (db1Client) {
          // Query Database 1 directly
          const { data: events, error } = await db1Client
            .from('h2s_tracking_events')
            .select('*')
            .order('event_ts', { ascending: false })
            .limit(5000);
          
          if (!error && events) {
            allEvents = events;
          } else if (error) {
            console.error('Error querying Database 1:', error);
          }
        } else {
          console.warn('Database 1 client not available - cannot query h2s_tracking_events');
        }
        
        // If Database 1 query failed or unavailable, return empty result (don't fall back to Database 2)
        if (!allEvents) {
          allEvents = [];
          console.warn('No events found from Database 1 - returning empty result');
        }
        
        const eventTypes: Record<string, any> = {};
        let totalValue = 0;
        const uniqueSessionsSet = new Set<string>();
        const uniqueUsersSet = new Set<string>();
        const pagePaths: Record<string, number> = {};
        const referrers: Record<string, number> = {};
        const clickedElements: Record<string, number> = {};
        const byPageType: Record<string, number> = {};
        const byUtmSource: Record<string, number> = {};
        const byUtmMedium: Record<string, number> = {};
        const byUtmCampaign: Record<string, number> = {};
        const customerEmails = new Set<string>();
        const customerPhones = new Set<string>();
        
        allEvents?.forEach((event: any) => {
          // Event type breakdown (support both event_type and event_name fields)
          const rawEventType = event.event_type || event.event_name || 'unknown';
          const eventType = typeof rawEventType === 'string' ? rawEventType.toLowerCase() : 'unknown';
          if (!eventTypes[eventType]) {
            eventTypes[eventType] = { count: 0, revenue: 0 };
          }
          eventTypes[eventType].count++;
          if (event.revenue_amount) {
            const rev = parseFloat(event.revenue_amount) || 0;
            eventTypes[eventType].revenue += rev;
            totalValue += rev;
          }
          
          // Sessions and users
          if (event.session_id) uniqueSessionsSet.add(event.session_id);
          if (event.visitor_id) uniqueUsersSet.add(event.visitor_id);
          
          // Page path analysis
          if (event.page_path) {
            pagePaths[event.page_path] = (pagePaths[event.page_path] || 0) + 1;
          }
          
          // Referrer tracking
          if (event.referrer && event.referrer !== '(direct)') {
            try {
              const referrerDomain = new URL(event.referrer).hostname;
              referrers[referrerDomain] = (referrers[referrerDomain] || 0) + 1;
            } catch {
              referrers[event.referrer] = (referrers[event.referrer] || 0) + 1;
            }
          } else if (event.referrer === '(direct)') {
            referrers['direct'] = (referrers['direct'] || 0) + 1;
          }
          
          // Click tracking (element_id/element_text from properties)
          const properties = typeof event.properties === 'string' 
            ? JSON.parse(event.properties) 
            : event.properties || {};
          if (properties.element_id || properties.element_text) {
            const elementKey = properties.element_id || properties.element_text;
            clickedElements[elementKey] = (clickedElements[elementKey] || 0) + 1;
          }
          
          // Extract page_type from properties
          const pageType = properties.page_type || properties.pageType;
          if (pageType) {
            byPageType[pageType] = (byPageType[pageType] || 0) + 1;
          }
          
          // UTM tracking
          if (event.utm_source) {
            byUtmSource[event.utm_source] = (byUtmSource[event.utm_source] || 0) + 1;
          }
          if (event.utm_medium) {
            byUtmMedium[event.utm_medium] = (byUtmMedium[event.utm_medium] || 0) + 1;
          }
          if (event.utm_campaign) {
            byUtmCampaign[event.utm_campaign] = (byUtmCampaign[event.utm_campaign] || 0) + 1;
          }
          
          // Customer identification from properties
          if (properties.customer_email) customerEmails.add(properties.customer_email);
          if (properties.customer_phone) customerPhones.add(properties.customer_phone);
        });
        
        // Calculate page path performance scores
        const pagePathScores: Record<string, any> = {};
        allEvents?.forEach((event: any) => {
          if (event.page_path) {
            const rawEventType = event.event_type || event.event_name || '';
            const eventType = typeof rawEventType === 'string' ? rawEventType.toLowerCase() : '';
            
            if (!pagePathScores[event.page_path]) {
              pagePathScores[event.page_path] = {
                views: 0, engagement: 0, leads: 0, purchases: 0, revenue: 0
              };
            }
            
            if (eventType === 'page_view' || eventType === 'pageview') {
              pagePathScores[event.page_path].views += 1;
            }
            if (eventType === 'view_content' || eventType === 'viewcontent') {
              pagePathScores[event.page_path].engagement += 1;
            }
            if (eventType === 'lead' || eventType === 'complete_registration') {
              pagePathScores[event.page_path].leads += 1;
            }
            if (eventType === 'purchase') {
              pagePathScores[event.page_path].purchases += 1;
              const rev = parseFloat(event.revenue_amount) || 0;
              pagePathScores[event.page_path].revenue += rev;
            }
          }
        });
        
        // Score pages
        const scoredPages = Object.entries(pagePathScores).map(([path, metrics]: [string, any]) => {
          const score = (metrics.views * 1) + (metrics.engagement * 2) + (metrics.leads * 5) + (metrics.purchases * 10) + (metrics.revenue / 10);
          const conversionRate = metrics.views > 0 ? ((metrics.leads + metrics.purchases) / metrics.views * 100) : 0;
          return {
            path, score: Math.round(score), views: metrics.views, engagement: metrics.engagement,
            leads: metrics.leads, purchases: metrics.purchases, revenue: metrics.revenue,
            conversion_rate: Number(conversionRate.toFixed(2))
          };
        }).sort((a, b) => b.score - a.score);
        
        // Get latest event timestamp (using event_ts)
        const latestEventTimestamp = allEvents && allEvents.length > 0 
          ? (allEvents[0].event_ts || allEvents[0].created_at) 
          : null;
        
        // Calculate canonical unique users
        const canonicalUsers = new Set<string>();
        allEvents?.forEach((event: any) => {
          const properties = typeof event.properties === 'string' 
            ? JSON.parse(event.properties) 
            : event.properties || {};
          if (properties.customer_email) {
            canonicalUsers.add(`email:${properties.customer_email.toLowerCase().trim()}`);
          } else if (event.visitor_id) {
            canonicalUsers.add(`visitor:${event.visitor_id}`);
          }
        });
        
        const topPagePaths = Object.entries(pagePaths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [path, count]) => ({ ...acc, [path]: count }), {});
        
        const topReferrers = Object.entries(referrers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [ref, count]) => ({ ...acc, [ref]: count }), {});
        
        const topClickedElements = Object.entries(clickedElements)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [elem, count]) => ({ ...acc, [elem]: count }), {});
        
        result = {
          summary: {
            total_events: allEvents?.length || 0,
            unique_sessions: uniqueSessionsSet.size,
            unique_users: canonicalUsers.size,
            unique_users_by_visitor_id: uniqueUsersSet.size,
            unique_customers_with_email: customerEmails.size,
            unique_customers_with_phone: customerPhones.size,
            total_revenue: totalValue,
            by_event_type: eventTypes,
            latest_event_at: latestEventTimestamp
          },
          by_page_path: topPagePaths,
          by_referrer: topReferrers,
          by_page_type: byPageType,
          by_utm_source: byUtmSource,
          by_utm_medium: byUtmMedium,
          by_utm_campaign: byUtmCampaign,
          top_clicked_elements: topClickedElements,
          page_performance: scoredPages.slice(0, 10),
          events: allEvents?.slice(0, 100) || []
        };
        break;

      case 'funnel':
        // Calculate funnel stages from h2s_tracking_events
        const funnelClient = getSupabaseDb1() || getSupabase();
        if (!funnelClient) {
          result = { stage_distribution: { visitor: 0, browser: 0, engaged: 0, lead: 0, customer: 0 }, totals: { leads: 0, customers: 0 }, conversion_rates: {} };
          break;
        }
        
        const { data: funnelEvents } = await funnelClient
          .from('h2s_tracking_events')
          .select('event_type, event_name, visitor_id, session_id, event_ts, properties');
        
        const uniqueVisitors = new Set<string>();
        const visitorsWithViewContent = new Set<string>();
        const engagedVisitors = new Set<string>();
        const leadVisitors = new Set<string>();
        const customerVisitors = new Set<string>();
        const sessionEventCounts: Record<string, number> = {};
        
        funnelEvents?.forEach(event => {
          // Extract customer_email from properties JSONB
          const properties = typeof event.properties === 'string' 
            ? JSON.parse(event.properties) 
            : event.properties || {};
          const customerEmail = properties.customer_email || null;
          
          const canonicalUserId = customerEmail 
            ? `email:${customerEmail.toLowerCase().trim()}` 
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!canonicalUserId) return;
          
          const sessionId = event.session_id;
          const eventType = ((event as any).event_type || (event as any).event_name || '').toLowerCase();
          
          if (eventType === 'page_view' || eventType === 'pageview') {
            uniqueVisitors.add(canonicalUserId);
            sessionEventCounts[sessionId] = (sessionEventCounts[sessionId] || 0) + 1;
          }
          
          if (eventType === 'view_content' || eventType === 'viewcontent') {
            visitorsWithViewContent.add(canonicalUserId);
          }
          
          const interactionEvents = ['add_to_cart', 'addtocart', 'initiate_checkout', 'initiatecheckout', 'click'];
          if (sessionEventCounts[sessionId] >= 2 || interactionEvents.includes(eventType)) {
            engagedVisitors.add(canonicalUserId);
          }
          
          if (eventType === 'lead' || eventType === 'completeregistration') {
            leadVisitors.add(canonicalUserId);
          }
          
          if (eventType === 'purchase') {
            customerVisitors.add(canonicalUserId);
          }
        });
        
        const visitorCount = uniqueVisitors.size;
        const browserCount = visitorsWithViewContent.size;
        const engagedCount = engagedVisitors.size;
        const leadCount = leadVisitors.size;
        const customerCount = customerVisitors.size;
        
        result = {
          stage_distribution: {
            visitor: visitorCount,
            browser: browserCount,
            engaged: engagedCount,
            lead: leadCount,
            customer: customerCount
          },
          totals: {
            leads: leadCount,
            customers: customerCount
          },
          conversion_rates: {
            visitor_to_browser: visitorCount > 0 ? `${((browserCount / visitorCount) * 100).toFixed(1)}%` : '0%',
            browser_to_engaged: browserCount > 0 ? `${((engagedCount / browserCount) * 100).toFixed(1)}%` : '0%',
            engaged_to_lead: engagedCount > 0 ? `${((leadCount / engagedCount) * 100).toFixed(1)}%` : '0%',
            lead_to_customer: leadCount > 0 ? `${((customerCount / leadCount) * 100).toFixed(1)}%` : '0%'
          }
        };
        break;

      case 'users':
        // Get top users from h2s_tracking_events based on purchase events
        const usersLimit = parseInt(searchParams.get('limit') || '10');
        const usersClient = getSupabaseDb1() || getSupabase();
        if (!usersClient) {
          result = { top_users: [], total_customers: 0 };
          break;
        }
        
        const { data: userEvents } = await usersClient
          .from('h2s_tracking_events')
          .select('visitor_id, revenue_amount, event_ts, order_id, properties')
          .eq('event_type', 'purchase')
          .not('revenue_amount', 'is', null)
          .order('event_ts', { ascending: false });
        
        const userMap = new Map<string, any>();
        
        userEvents?.forEach(event => {
          // Extract customer_email and customer_phone from properties JSONB
          const properties = typeof event.properties === 'string' 
            ? JSON.parse(event.properties) 
            : event.properties || {};
          const customerEmail = properties.customer_email || null;
          const customerPhone = properties.customer_phone || null;
          
          const userKey = customerEmail 
            ? `email:${customerEmail.toLowerCase().trim()}` 
            : customerPhone
            ? `phone:${customerPhone}`
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!userKey) return;
          
          if (!userMap.has(userKey)) {
            userMap.set(userKey, {
              Email: customerEmail || null,
              Phone: customerPhone || null,
              Visitor_ID: event.visitor_id,
              Total_Orders: 0,
              Lifetime_Revenue: 0,
              Last_Purchase_Date: null,
              Current_Funnel_Stage: 'customer'
            });
          }
          
          const user = userMap.get(userKey);
          user.Total_Orders += 1;
          user.Lifetime_Revenue += parseFloat(event.revenue_amount) || 0;
          
          if (customerEmail && !user.Email) {
            user.Email = customerEmail;
          }
          if (customerPhone && !user.Phone) {
            user.Phone = customerPhone;
          }
          
          const eventDate = new Date(event.event_ts);
          if (!user.Last_Purchase_Date || eventDate > new Date(user.Last_Purchase_Date)) {
            user.Last_Purchase_Date = event.event_ts;
          }
        });
        
        const topUsers = Array.from(userMap.values())
          .sort((a, b) => b.Lifetime_Revenue - a.Lifetime_Revenue)
          .slice(0, usersLimit);
        
        result = {
          top_users: topUsers,
          total_customers: userMap.size
        };
        break;

      case 'ai-insights':
      case 'ai_report':
        // Generate AI report from tracking data
        if (!openai) {
          result = { status: 'error', message: 'OpenAI not configured' };
          break;
        }
        
        const insightsClient = getSupabaseDb1() || getSupabase();
        if (!insightsClient) {
          result = { status: 'error', message: 'Database not available' };
          break;
        }
        
        const thirtyDaysAgoAI = new Date();
        thirtyDaysAgoAI.setDate(thirtyDaysAgoAI.getDate() - 30);
        
        const { data: reportEvents } = await insightsClient
          .from('h2s_tracking_events')
          .select('*')
          .gte('event_ts', thirtyDaysAgoAI.toISOString())
          .order('event_ts', { ascending: false })
          .limit(1000);
        
        const uniqueVisitorsAI = new Set(reportEvents?.map(e => e.visitor_id).filter(Boolean) || []).size;
        const uniqueSessionsAI = new Set(reportEvents?.map(e => e.session_id).filter(Boolean) || []).size;
        const purchaseEventsAI = reportEvents?.filter(e => e.event_type === 'purchase') || [];
        const totalRevenueAI = purchaseEventsAI.reduce((sum, e) => sum + (parseFloat(e.revenue_amount) || 0), 0);
        const leadEvents = reportEvents?.filter(e => e.event_type === 'lead' || e.event_type === 'complete_registration') || [];
        
        const reportPrompt = `Analyze this marketing funnel data from the last 30 days:

Total Events: ${reportEvents?.length || 0}
Unique Visitors: ${uniqueVisitorsAI}
Unique Sessions: ${uniqueSessionsAI}
Leads Generated: ${leadEvents.length}
Purchases: ${purchaseEventsAI.length}
Total Revenue: $${totalRevenueAI.toFixed(2)}

Provide actionable insights in HTML format with clear sections and recommendations.`;
        
        const completion = await openai.chat.completions.create({
          messages: [
            { role: "system", content: "You are a marketing analytics expert. Provide detailed, actionable insights in HTML format." },
            { role: "user", content: reportPrompt }
          ],
          model: "gpt-4o",
        });
        
        result = {
          status: 'success',
          report: completion.choices[0].message.content || 'No report generated',
          timestamp: new Date().toISOString()
        };
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders() });
    }

    return NextResponse.json({ ok: true, [action === 'candidates' ? 'data' : action]: result }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders() });
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    let result;

    switch (action) {
      case 'logHours':
        // body: { date, hours, tasks, vaName, analysisPrompt }
        // AI Analysis
        const systemPrompt = body.analysisPrompt 
          ? "You are a Revenue Operations Director. " + body.analysisPrompt
          : "You are a Revenue Operations Director. Analyze this work log.";
        
        const analysis = await openai.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: body.tasks }
          ],
          model: "gpt-4",
        });
        
        const aiSummary = analysis.choices[0].message.content;

        // Use vaName from body, fallback to 'ROSEL' if not provided
        const loggedBy = body.vaName || 'ROSEL';

        result = await prisma.vaHoursLog.create({
          data: {
            date: new Date(body.date),
            hours: parseFloat(body.hours),
            tasks: body.tasks,
            loggedBy: loggedBy,
            aiSummary: aiSummary
          }
        });
        break;

      case 'addTask':
        result = await prisma.task.create({
          data: {
            title: body.title,
            description: body.description,
            priority: body.priority,
            dueDate: body.dueDate ? new Date(body.dueDate) : null,
            status: 'PENDING'
          }
        });
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders() });
    }

    return NextResponse.json({ ok: true, result }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders() });
  }
}
