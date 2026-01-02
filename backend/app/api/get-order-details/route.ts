import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import Stripe from 'stripe';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function safeParseJson(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isMissingColumnError(error: any): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  return code === '42703' || message.includes('column') || message.includes('does not exist');
}

function toDollarsString(value: any): string {
  if (value === null || value === undefined || value === '') return '0.00';

  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num)) return '0.00';

  // Heuristic: if it looks like cents (large integer), convert.
  const isInt = Number.isInteger(num);
  const dollars = isInt && num >= 10000 ? num / 100 : num;
  return dollars.toFixed(2);
}

function normalizeItemsFromOrder(order: any): any[] {
  const out: any[] = [];

  const meta = safeParseJson(order?.metadata_json ?? order?.metadata) || {};

  const candidates = [
    order?.items,
    order?.cart,
    order?.items_json,
    order?.cart_items,
    meta?.cart_items_parsed,
    meta?.cart_items,
    meta?.items,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    let parsed: any = candidate;
    if (typeof candidate === 'string') {
      const j = safeParseJson(candidate);
      if (j) parsed = j;
    }

    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        if (!raw) continue;
        if (typeof raw === 'string') {
          out.push({ name: raw, qty: 1, price: 0, unit_price: 0, line_total: 0, metadata: null });
          continue;
        }

        const qty = Number(raw.qty ?? raw.quantity ?? raw.count ?? 1) || 1;
        const name =
          String(
            raw.name ?? raw.title ?? raw.bundle_name ?? raw.bundle_id ?? raw.service_name ?? raw.service_id ?? raw.id ?? 'Item'
          ) || 'Item';

        const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : null;

        const priceCents =
          raw.price_cents ??
          raw.unit_price_cents ??
          raw.unit_amount ??
          raw.amount ??
          null;

        let price = raw.unit_price ?? raw.unitPrice ?? raw.price ?? null;
        if ((price === null || price === undefined || price === '') && priceCents !== null && priceCents !== undefined) {
          const centsNum = Number(priceCents);
          if (Number.isFinite(centsNum)) price = centsNum / 100;
        }

        const priceNum = Number(price ?? 0) || 0;
        out.push({
          name,
          qty,
          price: priceNum,
          unit_price: priceNum,
          line_total: priceNum * qty,
          metadata,
          line_type: raw.line_type ?? raw.type ?? null,
          ref_id: raw.ref_id ?? raw.id ?? raw.bundle_id ?? raw.service_id ?? null,
          bundle_id: raw.bundle_id ?? null,
          service_id: raw.service_id ?? null,
        });
      }

      if (out.length) return out;
    }
  }

  return out;
}

function maskId(value: string) {
  if (!value) return '';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function getStripeClient(): Stripe | null {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;

  try {
    // Pinning apiVersion is recommended; keep it flexible if types drift.
    return new Stripe(key, { apiVersion: '2024-06-20' as any });
  } catch {
    return null;
  }
}

async function tryStripeFallbackOrder(sessionId: string, debug: boolean, trace: string) {
  if (!sessionId || !sessionId.startsWith('cs_')) return null;

  const stripe = getStripeClient();
  if (!stripe) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      expand: ['data.price.product'],
    });

    const items = (lineItems.data || []).map((li: any) => {
      const qty = Number(li.quantity || 1) || 1;

      const amountSubtotalCents = typeof li.amount_subtotal === 'number' ? li.amount_subtotal : null;
      const amountTotalCents = typeof li.amount_total === 'number' ? li.amount_total : null;
      const priceUnitCents = typeof li?.price?.unit_amount === 'number' ? li.price.unit_amount : null;

      const unitCents = priceUnitCents ?? (amountSubtotalCents !== null ? Math.round(amountSubtotalCents / qty) : 0);
      const lineSubtotalCents = amountSubtotalCents ?? unitCents * qty;
      const lineTotalCents = amountTotalCents ?? lineSubtotalCents;

      const product = li?.price?.product;
      const productId = typeof product === 'string' ? product : product?.id;
      const productName = typeof product === 'string' ? null : product?.name;

      return {
        name: li.description || productName || 'Item',
        qty,
        price: unitCents / 100,
        unit_price: unitCents / 100,
        line_total: lineTotalCents / 100,
        metadata: {
          stripe_price_id: li?.price?.id || null,
          stripe_product_id: productId || null,
        },
      };
    });

    const currency = String(session?.currency || 'USD').toUpperCase();
    const amountTotal = typeof (session as any)?.amount_total === 'number' ? (session as any).amount_total / 100 : 0;
    const amountSubtotal =
      typeof (session as any)?.amount_subtotal === 'number'
        ? (session as any).amount_subtotal / 100
        : items.reduce((sum: number, it: any) => sum + (Number(it.unit_price || 0) || 0) * (Number(it.qty || 1) || 1), 0);

    const customerDetails: any = (session as any)?.customer_details || {};
    const status = String((session as any)?.payment_status || (session as any)?.status || '').trim();

    if (debug) {
      console.log('[get-order-details][stripe-fallback]', {
        trace,
        sessionId: maskId(sessionId),
        status,
        amountTotal,
        amountSubtotal,
        itemCount: items.length,
      });
    }

    const summary =
      items
        .map((it: any) => {
          const qty = Number(it.qty ?? 1) || 1;
          const name = String(it.name || 'Item');
          return `${qty}x ${name}`;
        })
        .join(' | ') || 'N/A';

    return {
      order_id: String((session as any)?.metadata?.order_id || ''),
      stripe_session_id: sessionId,
      customer_name: String(customerDetails?.name || ''),
      customer_email: String(customerDetails?.email || ''),
      customer_phone: String(customerDetails?.phone || ''),
      amount_total: toDollarsString(amountTotal),
      order_value: toDollarsString(amountSubtotal),
      currency,
      status,
      delivery_date: null,
      delivery_time: null,
      created_at: (session as any)?.created ? new Date((session as any).created * 1000).toISOString() : null,
      items,
      item_count: items.length,
      order_summary: summary,
      discount_code: '',
      metadata: (session as any)?.metadata || null,
      source: 'stripe',
    };
  } catch (e: any) {
    if (debug) {
      console.warn('[get-order-details][stripe-fallback] failed', {
        trace,
        sessionId: maskId(sessionId),
        error: e?.message || String(e),
      });
    }
    return null;
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = String(url.searchParams.get('session_id') || '').trim();
    const orderId = String(url.searchParams.get('order_id') || '').trim();
    const debug = url.searchParams.get('debug') === '1' || process.env.DEBUG_ORDER_DETAILS === '1';
    const trace = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    if (debug) {
      console.log('[get-order-details]', { trace, sessionId: maskId(sessionId), orderId: maskId(orderId) });
    }

    if (!sessionId && !orderId) {
      return NextResponse.json(
        { ok: false, error: 'Missing session_id or order_id parameter' },
        { status: 400, headers: corsHeaders() }
      );
    }

    let client: any;
    try {
      client = getSupabase();
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || 'Database not available' },
        { status: 503, headers: corsHeaders() }
      );
    }

    const tryLookup = async (column: string, value: string) => {
      const res = await client.from('h2s_orders').select('*').eq(column, value).maybeSingle();
      if (res?.error && isMissingColumnError(res.error)) return { data: null, error: null };
      return res;
    };

    let order: any = null;
    let matchedBy: string | null = null;

    if (orderId) {
      if (isUuid(orderId)) {
        const byId = await tryLookup('id', orderId);
        if (byId?.data) order = byId.data;
        if (order) matchedBy = 'id';
      }

      if (!order) {
        const byOrderId = await tryLookup('order_id', orderId);
        if (byOrderId?.data) order = byOrderId.data;
        if (order) matchedBy = 'order_id';
      }
    } else {
      // Prefer the canonical TS schema field first.
      const bySession = await tryLookup('session_id', sessionId);
      if (bySession?.data) order = bySession.data;
      if (order) matchedBy = 'session_id';

      if (!order) {
        // Compatibility: some older deployments store Stripe session in stripe_session_id.
        const byStripeSession = await tryLookup('stripe_session_id', sessionId);
        if (byStripeSession?.data) order = byStripeSession.data;
        if (order) matchedBy = 'stripe_session_id';
      }
    }

    if (!order) {
      const stripeOrder = await tryStripeFallbackOrder(sessionId, debug, trace);
      if (stripeOrder) {
        return NextResponse.json({ ok: true, order: stripeOrder }, { headers: corsHeaders() });
      }

      if (debug) console.log('[get-order-details]', { trace, result: 'not_found' });
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404, headers: corsHeaders() });
    }

    let items = normalizeItemsFromOrder(order);
    if (debug) {
      const keys = order ? Object.keys(order) : [];
      console.log('[get-order-details]', {
        trace,
        matchedBy,
        orderKeys: keys,
        hasItems: Array.isArray(order?.items),
        normalizedItemsCount: items.length,
        amountFields: {
          amount_total: order?.amount_total,
          total: order?.total,
          order_total: order?.order_total,
          total_paid: order?.total_paid,
          total_amount: order?.total_amount,
        },
      });
    }
    const summary =
      items
        .map((it) => {
          const qty = Number(it.qty ?? it.quantity ?? 1) || 1;
          const name = String(it.name || 'Item');
          return `${qty}x ${name}`;
        })
        .join(' | ') || 'N/A';

    const currency = String(order?.currency || 'USD').toUpperCase();

    const paidDollars =
      order?.amount_total ??
      order?.order_total ??
      order?.total ??
      order?.total_paid ??
      order?.total_amount ??
      0;

    // Pre-discount order value (subtotal). Prefer explicit columns if present, else compute from items.
    const subtotalDollarsRaw =
      order?.subtotal ??
      order?.amount_subtotal ??
      order?.order_value ??
      order?.order_subtotal ??
      null;

    const computedSubtotal = items.reduce((sum, it) => {
      const qty = Number(it.qty ?? it.quantity ?? 1) || 1;
      const price = Number(it.price ?? 0) || 0;
      return sum + price * qty;
    }, 0);

    let orderValueDollars = subtotalDollarsRaw ?? computedSubtotal;

    // If the DB write happened with price IDs and no cart, we can end up with subtotal/items missing.
    // In that case, enrich using Stripe (same session_id) instead of returning $0/blank items.
    const needsStripeEnrichment =
      Boolean(sessionId && sessionId.startsWith('cs_')) &&
      (items.length === 0 || Number(orderValueDollars || 0) === 0);

    if (needsStripeEnrichment) {
      const stripeOrder = await tryStripeFallbackOrder(sessionId, debug, trace);
      if (stripeOrder) {
        // Prefer Stripe-derived items/subtotal, but keep DB fields that Stripe doesn't know.
        items = Array.isArray(stripeOrder.items) && stripeOrder.items.length ? stripeOrder.items : items;
        const stripeSubtotal = Number(String(stripeOrder.order_value || '0').trim());
        if (Number.isFinite(stripeSubtotal) && stripeSubtotal > 0) {
          orderValueDollars = stripeSubtotal;
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        order: {
          order_id: order?.order_id ?? '',
          stripe_session_id: order?.stripe_session_id ?? order?.session_id ?? sessionId,
          customer_name: order?.customer_name ?? order?.name ?? '',
          customer_email: order?.customer_email ?? order?.email ?? '',
          customer_phone: order?.customer_phone ?? order?.phone ?? '',
          amount_total: Number(toDollarsString(paidDollars)),
          // Order Value (pre-discount)
          order_value: Number(toDollarsString(orderValueDollars)),
          currency,
          status: order?.status ?? '',
          delivery_date: order?.delivery_date ?? null,
          delivery_time: order?.delivery_time ?? null,
          created_at: order?.created_at ?? null,
          items,
          item_count: items.length,
          order_summary: summary,
          discount_code:
            (safeParseJson(order?.metadata_json ?? order?.metadata)?.promotion_code as string) ||
            (safeParseJson(order?.metadata_json ?? order?.metadata)?.discount_code as string) ||
            '',
          metadata: safeParseJson(order?.metadata_json ?? order?.metadata) ?? order?.metadata_json ?? order?.metadata ?? null,
        },
      },
      { headers: corsHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
