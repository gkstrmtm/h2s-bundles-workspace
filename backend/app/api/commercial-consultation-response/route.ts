import { NextResponse } from 'next/server';
import {
  applyConsultationDecision,
  corsHeaders,
  getConsultationByToken,
  serializeConsultation,
  serializeLead,
} from '@/lib/commercial_consultation_runtime';

const commercialUtils = require('@/lib/commercial_consultation.js') as any;
const { normalizeText } = commercialUtils;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = normalizeText(url.searchParams.get('token') || '', 160);
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token' }, { status: 400, headers: corsHeaders(request) });
    }

    const context = await getConsultationByToken(token);
    if (!context?.consultation || !context?.lead) {
      return NextResponse.json({ ok: false, error: 'Consultation not found' }, { status: 404, headers: corsHeaders(request) });
    }

    return NextResponse.json(
      {
        ok: true,
        consultation: serializeConsultation(context.consultation),
        lead: serializeLead(context.lead),
      },
      { headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load consultation response data' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = normalizeText(body.token || '', 160);
    const action = normalizeText(body.action || '', 32).toLowerCase();
    const note = normalizeText(body.note || '', 500);

    if (!token || !['approve', 'decline'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'token and approve/decline action are required' }, { status: 400, headers: corsHeaders(request) });
    }

    const context = await getConsultationByToken(token);
    if (!context?.consultation || !context?.lead) {
      return NextResponse.json({ ok: false, error: 'Consultation not found' }, { status: 404, headers: corsHeaders(request) });
    }

    const result = await applyConsultationDecision({
      request,
      consultation: context.consultation,
      lead: context.lead,
      action: action as 'approve' | 'decline',
      channel: 'web',
      note,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error || 'Failed to record consultation response' }, { status: 409, headers: corsHeaders(request) });
    }

    return NextResponse.json(
      {
        ok: true,
        consultation: serializeConsultation(result.consultation),
        lead: serializeLead(context.lead),
        notifications: {
          customer: result.customerSms || null,
          management: result.managementSms || null,
        },
        appointment: result.appointment || null,
      },
      { headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to submit consultation response' }, { status: 500, headers: corsHeaders(request) });
  }
}