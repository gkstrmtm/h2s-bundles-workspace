const { randomBytes } = require('node:crypto');

const CONTACT_PREFERENCES = new Set(['sms', 'call', 'email']);
const COMPLETENESS_BUCKETS = ['empty', 'contact_only', 'partial', 'qualified'];
const PRIORITY_TIERS = ['low', 'normal', 'high', 'urgent'];
const CONSULTATION_STATUSES = new Set([
  'pending',
  'approved',
  'declined',
  'reschedule_requested',
  'customer_confirmed',
  'escalated',
  'expired',
  'cancelled'
]);

const CONSULTATION_TRANSITIONS = {
  pending: new Set(['approved', 'declined', 'reschedule_requested', 'escalated', 'expired', 'cancelled']),
  approved: new Set(['customer_confirmed', 'cancelled', 'reschedule_requested']),
  declined: new Set(['reschedule_requested', 'cancelled']),
  reschedule_requested: new Set(['pending', 'cancelled', 'expired']),
  customer_confirmed: new Set(['reschedule_requested', 'cancelled']),
  escalated: new Set(['approved', 'declined', 'cancelled', 'expired']),
  expired: new Set(['pending', 'cancelled']),
  cancelled: new Set([])
};

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeText(value, maxLength = 2000) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
}

function normalizeEmail(value) {
  const normalized = normalizeText(value, 320).toLowerCase();
  if (!normalized) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return '';
  return normalized;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return '';
}

function normalizeUrl(value) {
  const normalized = normalizeText(value, 1000);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:') return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function uniqueStrings(values, maxItems = 12, maxLength = 120) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const normalized = normalizeText(raw, maxLength);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function toStringArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|,|\u2022|\u2023|\u25E6/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeJson(value, depth = 0) {
  if (depth > 3) return null;
  if (value == null) return null;
  if (typeof value === 'string') return normalizeText(value, 1200) || null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map(item => sanitizeJson(item, depth + 1))
      .filter(item => item !== null);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 40);
    const out = {};
    for (const [key, item] of entries) {
      const normalizedKey = normalizeText(key, 80);
      const sanitized = sanitizeJson(item, depth + 1);
      if (!normalizedKey || sanitized === null) continue;
      out[normalizedKey] = sanitized;
    }
    return out;
  }
  return null;
}

function normalizeContactPreference(value) {
  const normalized = normalizeText(value, 16).toLowerCase();
  if (!CONTACT_PREFERENCES.has(normalized)) return 'sms';
  return normalized;
}

function normalizeProjectPhotoUrls(value) {
  const urls = [];
  const seen = new Set();
  for (const candidate of toStringArray(value)) {
    const normalized = normalizeUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= 8) break;
  }
  return urls;
}

function normalizeServiceNeeds(value) {
  return uniqueStrings(toStringArray(value), 8, 80);
}

function normalizeCommercialLeadInput(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const normalized = {
    fullName: normalizeText(source.fullName || source.name, 160),
    companyName: normalizeText(source.companyName, 160),
    email: normalizeEmail(source.email),
    phone: normalizePhone(source.phone),
    contactPreference: normalizeContactPreference(source.contactPreference),
    businessType: normalizeText(source.businessType, 120),
    projectAddress: normalizeText(source.projectAddress, 220),
    projectCity: normalizeText(source.projectCity, 120),
    projectState: normalizeText(source.projectState, 80),
    projectPostalCode: normalizeText(source.projectPostalCode, 32),
    scopeSummary: normalizeText(source.scopeSummary, 2000),
    timeline: normalizeText(source.timeline, 80),
    budgetBand: normalizeText(source.budgetBand, 80),
    serviceNeeds: normalizeServiceNeeds(source.serviceNeeds),
    projectPhotoUrls: normalizeProjectPhotoUrls(source.projectPhotoUrls),
    siteCount: clampInt(source.siteCount, 1, 1, 99),
    assessmentAnswers: sanitizeJson(source.assessmentAnswers || {}, 0) || {},
    attribution: sanitizeJson(source.attribution || {}, 0) || {},
    notes: normalizeText(source.notes, 2000)
  };

  normalized.isContactable = Boolean(normalized.phone || normalized.email);
  return normalized;
}

function computeAssessmentCompletion(lead) {
  const normalized = normalizeCommercialLeadInput(lead);
  const checks = [
    normalized.isContactable,
    Boolean(normalized.fullName),
    Boolean(normalized.companyName),
    normalized.serviceNeeds.length > 0,
    Boolean(normalized.scopeSummary),
    Boolean(normalized.timeline),
    Boolean(normalized.projectCity || normalized.projectAddress),
    normalized.siteCount > 0,
    Object.keys(normalized.assessmentAnswers || {}).length >= 2,
    Boolean(normalized.budgetBand)
  ];

  const completedSteps = checks.filter(Boolean).length;
  const totalSteps = checks.length;
  const score = Math.round((completedSteps / totalSteps) * 100);
  let bucket = 'empty';

  if (normalized.isContactable && score < 40) bucket = 'contact_only';
  if (score >= 40) bucket = 'partial';
  if (score >= 75) bucket = 'qualified';

  return {
    score,
    bucket: COMPLETENESS_BUCKETS.includes(bucket) ? bucket : 'partial',
    completedSteps,
    totalSteps,
    isContactable: normalized.isContactable
  };
}

function computeLeadPriority(lead) {
  const normalized = normalizeCommercialLeadInput(lead);
  const assessment = normalized.assessmentAnswers || {};
  let score = 0;

  const timeline = normalized.timeline.toLowerCase();
  const budgetBand = normalized.budgetBand.toLowerCase();
  const scopeSummary = normalized.scopeSummary.toLowerCase();

  if (timeline === 'asap' || timeline === 'this_week') score += 3;
  else if (timeline === '2_weeks' || timeline === 'this_month') score += 2;
  else if (timeline) score += 1;

  if (normalized.siteCount >= 3) score += 2;
  else if (normalized.siteCount >= 2) score += 1;

  if (normalized.serviceNeeds.length >= 3) score += 2;
  else if (normalized.serviceNeeds.length >= 2) score += 1;

  if (budgetBand === '25k_plus' || budgetBand === 'enterprise') score += 3;
  else if (budgetBand === '10k_plus' || budgetBand === '10k_25k') score += 2;
  else if (budgetBand === '5k_10k') score += 1;

  if (assessment.decisionMaker === true || assessment.decisionMaker === 'yes') score += 1;
  if (assessment.securityIncident === true || assessment.securityIncident === 'yes') score += 2;
  if (/urgent|emergency|offline|break-?in|theft|down/.test(scopeSummary)) score += 2;

  if (score >= 8) return 'urgent';
  if (score >= 5) return 'high';
  if (score <= 1) return 'low';
  return 'normal';
}

function buildSlotSuggestions(options = {}) {
  const count = clampInt(options.count, 3, 1, 8);
  const durationMinutes = clampInt(options.durationMinutes, 30, 15, 120);
  const now = options.now instanceof Date ? new Date(options.now.getTime()) : new Date(options.now || Date.now());
  const suggestions = [];
  const slotTemplates = [
    [9, 30],
    [11, 0],
    [13, 30],
    [15, 30]
  ];

  for (let dayOffset = 0; dayOffset < 14 && suggestions.length < count; dayOffset += 1) {
    const day = new Date(now.getTime());
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + dayOffset);

    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) continue;

    for (const [hours, minutes] of slotTemplates) {
      const start = new Date(day.getTime());
      start.setHours(hours, minutes, 0, 0);
      if (start.getTime() - now.getTime() < 2 * 60 * 60 * 1000) continue;

      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      suggestions.push({
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        durationMinutes
      });
      if (suggestions.length >= count) break;
    }
  }

  return suggestions;
}

function generateConsultationReference(prefix = 'COM') {
  return `${normalizeText(prefix, 8).toUpperCase() || 'COM'}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function generateResponseToken() {
  return randomBytes(24).toString('base64url');
}

function normalizeConsultationStatus(value, fallback = 'pending') {
  const normalized = normalizeText(value, 32).toLowerCase();
  if (!CONSULTATION_STATUSES.has(normalized)) return fallback;
  return normalized;
}

function canTransitionConsultationStatus(currentStatus, nextStatus) {
  const current = normalizeConsultationStatus(currentStatus);
  const next = normalizeConsultationStatus(nextStatus, '');
  if (!current || !next) return false;
  if (current === next) return true;
  return CONSULTATION_TRANSITIONS[current] ? CONSULTATION_TRANSITIONS[current].has(next) : false;
}

function buildApprovalLinks(baseUrl, responseToken) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const token = encodeURIComponent(String(responseToken || ''));
  return {
    approveUrl: `${base}/commercial-approval?token=${token}&action=approve`,
    declineUrl: `${base}/commercial-approval?token=${token}&action=decline`
  };
}

function summarizeServices(serviceNeeds) {
  const services = normalizeServiceNeeds(serviceNeeds);
  if (!services.length) return 'commercial project';
  if (services.length === 1) return services[0];
  if (services.length === 2) return `${services[0]} and ${services[1]}`;
  return `${services.slice(0, 2).join(', ')}, and ${services.length - 2} more`;
}

function buildTechnicianRequestMessage(input) {
  const reference = normalizeText(input.referenceCode, 32) || 'COM';
  const leadName = normalizeText(input.customerName || input.companyName, 120) || 'New commercial lead';
  const slotLabel = normalizeText(input.slotLabel, 120) || 'requested consultation slot';
  const links = buildApprovalLinks(input.baseUrl, input.responseToken);
  const services = summarizeServices(input.serviceNeeds);
  return `${reference}: ${leadName} requested ${services} consultation for ${slotLabel}. Approve: ${links.approveUrl} Decline: ${links.declineUrl}`;
}

function buildCustomerPendingMessage(input) {
  const reference = normalizeText(input.referenceCode, 32) || 'your request';
  return `Thanks for contacting Home Too Smart. We received ${reference} and are confirming technician availability now. We will text you as soon as the consultation slot is approved.`;
}

function buildCustomerConfirmedMessage(input) {
  const slotLabel = normalizeText(input.slotLabel, 120) || 'your consultation time';
  const reference = normalizeText(input.referenceCode, 32) || 'your request';
  return `Home Too Smart confirmed ${reference} for ${slotLabel}. Reply to this text if you need to reschedule or add project details before the consultation.`;
}

function buildEscalationMessage(input) {
  const reference = normalizeText(input.referenceCode, 32) || 'COM';
  const companyName = normalizeText(input.companyName, 120) || 'Commercial lead';
  const ageMinutes = clampInt(input.ageMinutes, 0, 0, 100000);
  return `${reference} needs review. ${companyName} has no technician response after ${ageMinutes} minutes.`;
}

module.exports = {
  buildApprovalLinks,
  buildCustomerConfirmedMessage,
  buildCustomerPendingMessage,
  buildEscalationMessage,
  buildSlotSuggestions,
  buildTechnicianRequestMessage,
  canTransitionConsultationStatus,
  computeAssessmentCompletion,
  computeLeadPriority,
  generateConsultationReference,
  generateResponseToken,
  normalizeCommercialLeadInput,
  normalizeConsultationStatus,
  normalizeEmail,
  normalizePhone,
  normalizeProjectPhotoUrls,
  normalizeServiceNeeds,
  normalizeText,
  PRIORITY_TIERS,
  COMPLETENESS_BUCKETS,
  CONSULTATION_STATUSES
};

module.exports.default = module.exports;