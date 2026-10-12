const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.production.local') });

const DEFAULT_BASE_URL = process.env.COMMERCIAL_VALIDATION_BASE_URL || 'http://127.0.0.1:3001';

function safeTrim(value) {
  return String(value || '').trim();
}

function isLocalBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return {
    status: response.status,
    ok: response.ok,
    payload,
  };
}

async function supabaseSelect(table, query) {
  const base = safeTrim(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const key = safeTrim(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
  if (!base || !key) {
    throw new Error('Missing SUPABASE_URL or service role key for verification query');
  }
  const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return {
    status: response.status,
    ok: response.ok,
    payload,
  };
}

async function lookupConsultationByLead(leadId) {
  const query = [
    'select=request_id,lead_id,reference_code,response_token,status,selected_slot_start,selected_slot_end,created_at,updated_at,management_notified_at,customer_confirmation_sent_at,response_channel,response_note',
    `lead_id=eq.${encodeURIComponent(leadId)}`,
    'order=created_at.desc',
    'limit=1',
  ].join('&');
  return supabaseSelect('commercial_consultation_requests', query);
}

function summarize(label, result) {
  return {
    label,
    status: result.status,
    ok: result.ok,
    payload: result.payload,
  };
}

async function createLead(baseUrl, suffix) {
  const payload = {
    fullName: `Commercial Test ${suffix}`,
    companyName: `Persistence Test ${suffix}`,
    email: `commercial-${suffix}@example.com`,
    phone: '+18645550123',
    contactPreference: 'sms',
    businessType: 'office',
    projectAddress: '100 Test Way',
    projectCity: 'Greenville',
    projectState: 'SC',
    projectPostalCode: '29601',
    scopeSummary: 'Persistence verification lead save.',
    timeline: '2_weeks',
    budgetBand: '10k_plus',
    siteCount: 1,
    serviceNeeds: ['Security Cameras'],
    assessmentAnswers: { decisionMaker: 'yes', existingSystem: 'legacy' },
    attribution: { source: 'exercise-commercial-persistence' },
  };

  return fetchJson(`${baseUrl}/api/commercial-intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function main() {
  const baseUrl = safeTrim(process.argv[2]) || DEFAULT_BASE_URL;
  const allowRemote = process.argv.includes('--allow-remote') || safeTrim(process.env.ALLOW_REMOTE_COMMERCIAL_PERSISTENCE_TEST) === '1';

  if (!isLocalBaseUrl(baseUrl) && !allowRemote) {
    throw new Error(`Refusing to run against non-local base URL without --allow-remote: ${baseUrl}`);
  }

  const now = Date.now();
  const leadOneSuffix = `a-${now}`;
  const leadTwoSuffix = `b-${now}`;
  const out = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    safeMode: !allowRemote,
    steps: [],
  };

  const config = await fetchJson(`${baseUrl}/api/commercial-intake`);
  out.steps.push(summarize('load-config', config));
  const slots = Array.isArray(config.payload?.config?.suggestedSlots) ? config.payload.config.suggestedSlots : [];
  const firstSlot = slots[0] || null;
  if (!firstSlot) {
    throw new Error('No suggested consultation slot available from intake config');
  }

  const createOne = await createLead(baseUrl, leadOneSuffix);
  out.steps.push(summarize('create-lead-1', createOne));
  if (!createOne.ok || !createOne.payload?.lead?.publicToken || !createOne.payload?.lead?.leadId) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const updateOne = await fetchJson(`${baseUrl}/api/commercial-intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicToken: createOne.payload.lead.publicToken,
      fullName: `Commercial Test ${leadOneSuffix}`,
      companyName: `Persistence Test ${leadOneSuffix}`,
      email: `commercial-${leadOneSuffix}@example.com`,
      phone: '+18645550123',
      contactPreference: 'sms',
      businessType: 'church',
      projectAddress: '100 Test Way',
      projectCity: 'Greenville',
      projectState: 'SC',
      projectPostalCode: '29601',
      scopeSummary: 'Updated persistence verification lead save.',
      timeline: 'asap',
      budgetBand: '25k_plus',
      siteCount: 2,
      serviceNeeds: ['Security Cameras', 'Structured Cabling'],
      assessmentAnswers: { decisionMaker: 'multiple', existingSystem: 'legacy', buildingType: 'campus' },
      attribution: { source: 'exercise-commercial-persistence', revision: 2 },
    }),
  });
  out.steps.push(summarize('update-lead-1', updateOne));

  const loadOne = await fetchJson(`${baseUrl}/api/commercial-intake?token=${encodeURIComponent(createOne.payload.lead.publicToken)}`);
  out.steps.push(summarize('load-lead-1', loadOne));

  const consultationOne = await fetchJson(`${baseUrl}/api/commercial-consultation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicToken: createOne.payload.lead.publicToken,
      selectedSlotStart: firstSlot.startIso,
      selectedSlotEnd: firstSlot.endIso,
      preferredSlots: [firstSlot],
    }),
  });
  out.steps.push(summarize('create-consultation-1', consultationOne));

  const duplicateConsultation = await fetchJson(`${baseUrl}/api/commercial-consultation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicToken: createOne.payload.lead.publicToken,
      selectedSlotStart: firstSlot.startIso,
      selectedSlotEnd: firstSlot.endIso,
      preferredSlots: [firstSlot],
    }),
  });
  out.steps.push(summarize('duplicate-consultation-1', duplicateConsultation));

  const lookupOne = await lookupConsultationByLead(createOne.payload.lead.leadId);
  out.steps.push(summarize('lookup-consultation-1', lookupOne));

  const responseTokenOne = Array.isArray(lookupOne.payload) && lookupOne.payload[0] ? lookupOne.payload[0].response_token : '';
  if (responseTokenOne) {
    const approveOne = await fetchJson(`${baseUrl}/api/commercial-consultation-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: responseTokenOne, action: 'approve', note: 'Automated local persistence verification.' }),
    });
    out.steps.push(summarize('approve-consultation-1', approveOne));

    const approveAgain = await fetchJson(`${baseUrl}/api/commercial-consultation-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: responseTokenOne, action: 'approve', note: 'Duplicate transition check.' }),
    });
    out.steps.push(summarize('duplicate-approve-consultation-1', approveAgain));
  }

  const createTwo = await createLead(baseUrl, leadTwoSuffix);
  out.steps.push(summarize('create-lead-2', createTwo));
  if (createTwo.ok && createTwo.payload?.lead?.publicToken && createTwo.payload?.lead?.leadId) {
    const consultationTwo = await fetchJson(`${baseUrl}/api/commercial-consultation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicToken: createTwo.payload.lead.publicToken,
        selectedSlotStart: firstSlot.startIso,
        selectedSlotEnd: firstSlot.endIso,
        preferredSlots: [firstSlot],
      }),
    });
    out.steps.push(summarize('create-consultation-2', consultationTwo));

    const lookupTwo = await lookupConsultationByLead(createTwo.payload.lead.leadId);
    out.steps.push(summarize('lookup-consultation-2', lookupTwo));

    const responseTokenTwo = Array.isArray(lookupTwo.payload) && lookupTwo.payload[0] ? lookupTwo.payload[0].response_token : '';
    if (responseTokenTwo) {
      const declineTwo = await fetchJson(`${baseUrl}/api/commercial-consultation-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: responseTokenTwo, action: 'decline', note: 'Automated local persistence verification.' }),
      });
      out.steps.push(summarize('decline-consultation-2', declineTwo));
    }
  }

  const invalidToken = await fetchJson(`${baseUrl}/api/commercial-consultation-response?token=invalid-${now}`);
  out.steps.push(summarize('invalid-token-read', invalidToken));

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});