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

const COMMERCIAL_TIME_ZONE = 'America/New_York';

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

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value, 16).toLowerCase();
  if (!normalized) return false;
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y' || normalized === 'on';
}

function hasCommercialSmsConsent(source) {
  const attribution = source?.attribution || {};
  return (source?.smsOptIn ?? source?.smsConsent ?? attribution.smsOptIn ?? attribution.communicationConsent?.smsOptIn) === true;
}

function validateCommercialContact(source) {
  const method = source?.contactPreference ?? source?.contact_preference ?? 'sms';
  const email = String(source?.email || '').trim();
  const phone = String(source?.phone || '').trim();
  if (!CONTACT_PREFERENCES.has(method)) return { field: 'contactPreference', message: 'Choose Text first, Call first, or Email first.' };
  if (email && !normalizeEmail(email)) return { field: 'email', message: 'Enter a valid email address.' };
  if (phone && (!/^[+\d\s().-]+$/.test(phone) || !normalizePhone(phone))) return { field: 'phone', message: 'Enter a valid phone number, including the area code.' };
  if (method === 'email' && !email) return { field: 'email', message: 'Email first requires a valid email address. A phone number is optional.' };
  if (method !== 'email' && !phone) return { field: 'phone', message: `${method === 'call' ? 'Call' : 'Text'} first requires a valid phone number.` };
  if (method === 'sms' && !hasCommercialSmsConsent(source)) return { field: 'smsConsent', message: 'To choose Text first, explicitly agree to project texts, or choose Call first or Email first.' };
  return null;
}

function isManualCommercialFollowUp(consultation, lead) {
  return consultation?.metadata?.request_kind === 'manual_follow_up'
    || ['call', 'email'].includes(lead?.contact_preference ?? lead?.contactPreference);
}

function buildManualFollowUpMessage(consultation, lead, slotLabel) {
  const method = lead.contact_preference === 'email' ? 'email' : 'phone';
  const detail = method === 'email' ? lead.email : lead.phone;
  return `${consultation.reference_code}: manual follow-up requested for ${lead.company_name || lead.full_name || 'Commercial lead'}. Contact by ${method}: ${detail || 'details need review'}. Preferred window (pending review): ${consultation.selected_slot_start ? slotLabel : 'none requested'}. Review Commercial Queue and contact the customer manually. No appointment is confirmed.`;
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
  const rawAttribution = sanitizeJson(source.attribution || {}, 0) || {};
  const existingConsent = rawAttribution.communicationConsent && typeof rawAttribution.communicationConsent === 'object'
    ? rawAttribution.communicationConsent
    : {};
  const smsOptIn = hasCommercialSmsConsent(source);
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
    attribution: {
      ...rawAttribution,
      communicationConsent: {
        smsOptIn,
        smsOptInText: normalizeText(source.smsOptInText || existingConsent.smsOptInText || 'I agree to receive text messages from Home2Smart about my estimate and project updates, including automated reminders. Consent is not a condition of purchase. Reply STOP to opt out.', 400),
        smsOptInSource: normalizeText(source.smsOptInSource || existingConsent.smsOptInSource || 'commercial-intake-form', 120),
        ...(smsOptIn ? {
          smsOptInAt: normalizeText(source.smsOptInAt || existingConsent.smsOptInAt, 64) || new Date().toISOString(),
        } : {}),
      },
    },
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

function getTimeZoneParts(date, timeZone = COMMERCIAL_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  return formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
}

function getTimeZoneOffsetMinutes(date, timeZone = COMMERCIAL_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  const zonedUtc = Date.UTC(
    Number(parts.year || 0),
    Math.max(0, Number(parts.month || 1) - 1),
    Number(parts.day || 1),
    Number(parts.hour || 0),
    Number(parts.minute || 0),
    Number(parts.second || 0)
  );
  return Math.round((zonedUtc - date.getTime()) / 60000);
}

function zonedLocalToUtc(year, month, day, hours, minutes, timeZone = COMMERCIAL_TIME_ZONE) {
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  const firstOffset = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  const firstPass = utcGuess - (firstOffset * 60000);
  const secondOffset = getTimeZoneOffsetMinutes(new Date(firstPass), timeZone);
  return new Date(utcGuess - (secondOffset * 60000));
}

function buildSlotSuggestions(options = {}) {
  const count = clampInt(options.count, 3, 1, 8);
  const durationMinutes = 30;
  const now = options.now instanceof Date ? new Date(options.now.getTime()) : new Date(options.now || Date.now());
  const timeZone = COMMERCIAL_TIME_ZONE;
  const nowParts = getTimeZoneParts(now, timeZone);
  const suggestions = [];
  const slotTemplates = [
    [9, 0],
    [11, 0],
    [13, 30],
    [15, 30]
  ];

  for (let dayOffset = 0; dayOffset < 14 && suggestions.length < count; dayOffset += 1) {
    const localDaySeed = new Date(Date.UTC(
      Number(nowParts.year || 0),
      Math.max(0, Number(nowParts.month || 1) - 1),
      Number(nowParts.day || 1) + dayOffset,
      12,
      0,
      0,
      0
    ));
    const year = localDaySeed.getUTCFullYear();
    const month = localDaySeed.getUTCMonth() + 1;
    const day = localDaySeed.getUTCDate();
    const noonUtc = zonedLocalToUtc(year, month, day, 12, 0, timeZone);
    const weekday = String(getTimeZoneParts(noonUtc, timeZone).weekday || '').toLowerCase();
    if (weekday === 'sun' || weekday === 'sat') continue;

    for (const [hours, minutes] of slotTemplates) {
      const start = zonedLocalToUtc(year, month, day, hours, minutes, timeZone);
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

function validateConsultationWindow(start, end, now = new Date()) {
  if (!start && !end) return null;
  if (!start || !end || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(end)) {
    return 'Choose a complete suggested window with an explicit timezone.';
  }
  const first = new Date(start);
  const last = new Date(end);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return 'Invalid consultation window.';
  if (first.getTime() - now.getTime() < 2 * 60 * 60 * 1000) return 'Choose a window at least two hours in the future.';
  if (first.getTime() - now.getTime() > 14 * 86400000) return 'Choose a window within the next fourteen days.';
  if (last.getTime() - first.getTime() !== 30 * 60000) return 'Choose a supported thirty-minute window.';
  const parts = getTimeZoneParts(first);
  if (['sat', 'sun'].includes(parts.weekday.toLowerCase()) ||
      !['9:0', '11:0', '13:30', '15:30'].includes(`${Number(parts.hour)}:${Number(parts.minute)}`) ||
      first.getUTCSeconds() || first.getUTCMilliseconds()) return 'Choose a suggested weekday window in Eastern Time.';
  return null;
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
  return `Thanks for contacting Home Too Smart. We received ${reference} for review. Your preferred window is a request, not a confirmed appointment. Project follow-up may be sent by text using your texting choice.`;
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
  COMMERCIAL_TIME_ZONE,
  validateConsultationWindow,
  hasCommercialSmsConsent,
  validateCommercialContact,
  isManualCommercialFollowUp,
  buildManualFollowUpMessage,
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