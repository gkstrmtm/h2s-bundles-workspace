import { NextResponse } from 'next/server';
import {
  CommercialConfigurationError,
  commercialRpc,
  corsHeaders,
  findActiveConsultationForLead,
  getLeadByToken,
  getPublicBaseUrl,
  serializeLead,
  serializeConsultation,
} from '@/lib/commercial_consultation_runtime';

const commercialUtils = require('@/lib/commercial_consultation.js') as any;

const {
  buildSlotSuggestions,
  computeAssessmentCompletion,
  computeLeadPriority,
  generateResponseToken,
  normalizeCommercialLeadInput,
  normalizeText,
  validateCommercialContact,
} = commercialUtils;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function publicConfig() {
  return {
    publicBaseUrl: getPublicBaseUrl(),
    callNumber: String(process.env.COMMERCIAL_CALL_NUMBER || process.env.PUBLIC_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim(),
    smsNumber: String(process.env.COMMERCIAL_SMS_NUMBER || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim(),
    suggestedSlots: buildSlotSuggestions({ count: 4 }),
    timeZone: 'America/New_York',
    photoMaxBytes: 3 * 1024 * 1024,
    photoMaxCount: 8,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = normalizeText(url.searchParams.get('token') || '', 120);
    const config = publicConfig();
    const lead = token ? await getLeadByToken(token) : null;
    const submission = lead ? await findActiveConsultationForLead(lead.lead_id) : null;

    return NextResponse.json(
      {
        ok: true,
        config,
        lead: serializeLead(lead),
        submission: serializeConsultation(submission),
      },
      { headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load commercial intake config' },
      { status: error instanceof CommercialConfigurationError ? 503 : 500, headers: corsHeaders(request) }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const contactError = validateCommercialContact(body);
    if (contactError) {
      return NextResponse.json(
        { ok: false, error: contactError.message, field: contactError.field },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    const normalized = normalizeCommercialLeadInput(body);
    if (!normalized.isContactable) {
      return NextResponse.json(
        { ok: false, error: 'A valid phone number or email address is required before we can save this commercial lead.' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const config = publicConfig();
    const completeness = computeAssessmentCompletion(normalized);
    const priorityTier = computeLeadPriority(normalized);
    const publicToken = normalizeText(body.publicToken || '', 120) || generateResponseToken();

    const existing = publicToken ? await getLeadByToken(publicToken) : null;
    const mergedPhotoUrls = Array.from(
      new Set([
        ...((existing?.project_photo_urls || []) as string[]),
      ])
    ).slice(0, 8);

    const patch = {
      public_token: publicToken,
      full_name: normalized.fullName || null,
      company_name: normalized.companyName || null,
      email: normalized.email || null,
      phone: normalized.phone || null,
      contact_preference: normalized.contactPreference,
      business_type: normalized.businessType || null,
      project_address: normalized.projectAddress || null,
      project_city: normalized.projectCity || null,
      project_state: normalized.projectState || null,
      project_postal_code: normalized.projectPostalCode || null,
      scope_summary: normalized.scopeSummary || null,
      timeline: normalized.timeline || null,
      budget_band: normalized.budgetBand || null,
      site_count: normalized.siteCount,
      service_needs: normalized.serviceNeeds,
      project_photo_urls: mergedPhotoUrls,
      assessment_answers: normalized.assessmentAnswers,
      attribution: normalized.attribution,
      notes: normalized.notes || null,
      completeness_score: completeness.score,
      completeness_bucket: completeness.bucket,
      priority_tier: priorityTier,
      last_submitted_at: existing?.last_submitted_at || null,
      updated_at: new Date().toISOString(),
    };

    const revision = Number(body.revision ?? 0);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      return NextResponse.json({ ok: false, error: 'Invalid draft revision.' }, { status: 400, headers: corsHeaders(request) });
    }
    const result = await commercialRpc('commercial_save_lead', {
      p_token: publicToken, p_revision: revision,
      p_save_key: normalizeText(body.saveKey || '', 120) || generateResponseToken(),
      p_patch: { ...patch, created_at: new Date().toISOString() },
    });
    if (result.conflict) return NextResponse.json({
      ok: false, conflict: true, error: 'A newer saved draft exists. Review the server version before saving again.',
      lead: serializeLead(result.lead),
    }, { status: 409, headers: corsHeaders(request) });
    const data = result.lead;

    return NextResponse.json(
      {
        ok: true,
        lead: serializeLead(data),
        assessment: completeness,
        priorityTier,
        config,
      },
      { status: existing ? 200 : 201, headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to save commercial lead' },
      { status: error instanceof CommercialConfigurationError ? 503 : 500, headers: corsHeaders(request) }
    );
  }
}