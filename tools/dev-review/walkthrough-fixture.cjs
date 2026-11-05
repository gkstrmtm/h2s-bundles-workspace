'use strict';

// This module has no production clients: all evaluated handlers use the fixture's
// in-memory PostgreSQL, private byte stores and synthetic provider SDK.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createWorkflowFixture, id } = require('../../backend/tests/helpers/field_workflow_fixture.cjs');
const { evaluate } = require('../../backend/tests/helpers/commercial_operations_fixture.cjs');

const SCENARIOS = ['tv', 'camera', 'exception'];
const DISCLOSURE = 'SIMULATED ONLY — synthetic approved review prices, policies, provider captures and settlement evidence. Not production pricing, legal advice or a real payment.';
const PHOTO = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYs8AAAAASUVORK5CYII=';
const aliases = { admin: 'admin', sales: 'a', pro: 'pro', sales_other: 'b', pro_other: 'other',
  'local-review-admin': 'admin', 'local-review-sales': 'a', 'local-review-pro': 'pro' };
const safe = value => JSON.parse(JSON.stringify(value));
const unavailable = name => Response.json({ ok: false, unavailable: true, simulatedOnly: true,
  error: `Native action ${name} is unavailable in the isolated review. No application success is implied.`,
  error_code: 'walkthrough_unavailable' }, { status: 503 });

function catalog(f, scenario) {
  const offer = (offerId, label, unitCents, equipment = []) => ({
    id: offerId, label: 'SIMULATED ONLY — ' + label, enabled: true, unitCents, basis: 'per_unit',
    minimum: 1, maximum: 8, starting: false, equipment,
    scope: ['Synthetic reviewed standard installation; onsite access and sound mounting surface required'],
    exclusions: ['Structural repair', 'New electrical circuits', 'Unsurveyed cable paths'],
    questions: [{ id: 'size', label: 'Screen size (inches)', type: 'number', required: true, min: 19, max: 100 },
      { id: 'wall', label: 'Mounting surface', type: 'select', required: true, options: ['drywall', 'masonry'] }],
    options: [{ id: 'full_motion', label: 'SIMULATED ONLY full-motion mount', amountCents: 4900, perUnit: true,
      equipment: ['Synthetic full-motion mount'] }],
    qualifications: [{ question: 'wall', allowed: ['drywall'], reason: 'Masonry requires an actual management scope review' }]
  });
  const tv = offer('standard', 'TV mounting labor $129 + optional itemized mount', 12900);
  const camera = offer('package', 'Included camera $89 + installation $110 per camera', 19900,
    ['SIMULATED ONLY camera equipment $89/unit; included in the $199 unit price']);
  camera.questions = [{ id: 'installation', label: 'Installation type', type: 'select', required: true,
    options: ['wireless', 'poe'] }];
  camera.options = [{ id: 'weather_mount', label: 'SIMULATED ONLY weatherproof mounting kit',
    amountCents: 1500, perUnit: true, equipment: ['Synthetic weatherproof mounting kit'] }];
  camera.qualifications = [{ question: 'installation', allowed: ['wireless'], reason: 'PoE cable routing requires management review' }];
  const requirements = [
    { id: 'installed', label: 'Finished installation photo', type: 'photo', minimumCount: scenario === 'camera' ? 2 : 1 },
    { id: 'signoff', label: 'Customer installation signature', type: 'signature', minimumCount: 1 },
    { id: 'tested', label: 'Operation tested onsite', type: 'checklist', minimumCount: 1 }
  ];
  f.definition.currency = 'usd';
  f.definition.validForMinutes = 1440;
  f.definition.services = [
    { id: 'tv_mounting', label: 'SIMULATED ONLY TV installation', markets: ['residential', 'commercial'],
      offers: [tv], completionRequirements: requirements },
    { id: 'cameras_included', label: 'SIMULATED ONLY equipment-included cameras', markets: ['residential', 'commercial'],
      offers: [camera], completionRequirements: requirements }
  ];
}

async function nativeRoutes(f) {
  class AuthError extends Error { constructor(message, code, status) { super(message); this.code = code; this.status = status; } }
  const payload = token => ['pro', 'other'].includes(token)
    ? { sub: id(token === 'pro' ? 500 : 502), role: 'pro', email: 'synthetic-tech@example.invalid' } : null;
  const schema = { jobsTable: 'h2s_dispatch_jobs', jobsIdCol: 'job_id', jobsStatusCol: 'status',
    assignmentsTable: 'h2s_dispatch_job_assignments', assignmentsJobCol: 'job_id', assignmentsProCol: 'pro_id',
    assignmentsStateCol: 'state' };
  const imports = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@supabase/supabase-js': { createClient: () => f.client },
    '@/lib/supabase': { getSupabase: () => f.client, getSupabaseDispatch: () => f.client, getSupabaseMgmt: () => f.client },
    '@/lib/auth': { AuthError, verifyPortalToken: async token => {
      const pro = payload(token); return pro ? { ok: true, payload: pro } : { ok: false, error: 'Pro sign-in required' };
    }, requireAuth: async request => {
      const pro = payload(request.headers.get('authorization')?.replace('Bearer ', ''));
      if (!pro) throw new AuthError('Pro sign-in required', 'invalid_token', 401);
      return pro;
    } },
    '@/lib/config': { getConfig: () => ({ buildId: 'isolated-walkthrough' }) },
    '@/lib/dispatchSchema': { resolveDispatchSchema: async () => schema },
    '@/lib/mail': { sendMail: async () => { throw Error('External mail delivery unavailable in isolated review'); } }
  };
  const globals = { process: { env: f.env }, Buffer, Headers, Blob, crypto,
    fetch: async () => { throw Error('External network is forbidden in isolated review'); } };
  imports['@/lib/portalProProfile'] = evaluate('lib\\portalProProfile.ts', imports, globals);
  imports['@/lib/dataOrchestration'] = evaluate('lib\\dataOrchestration.ts', imports, globals);
  imports['@/lib/managedOfferResponse'] = evaluate('lib\\managedOfferResponse.ts', imports, globals);
  const rpc = f.client.rpc.bind(f.client);
  f.client.rpc = async (name, args) => {
    if (name !== 'h2s_management_respond_to_offer') return rpc(name, args);
    try {
      const out = await f.db.query('select h2s_management_respond_to_offer($1::uuid,$2::uuid,$3::text) result', Object.values(args));
      return { data: out.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  return Object.fromEntries(['portal_me', 'portal_jobs', 'portal_jobs_v2', 'portal_accept', 'portal_decline',
    'portal_payouts'].map(name => [name, evaluate(`app\\api\\${name}\\route.ts`, imports, globals)]));
}

function forecastRoute(f) {
  const globals = {
    process: { env: { ...f.env, H2S_FORECAST_RESEARCH_ENABLED: 'false', H2S_FORECAST_AI_ENABLED: 'false',
      H2S_FIELD_CATALOG_ADMIN_ENABLED: 'false', H2S_FIELD_SALES_ENABLED: 'false' } },
    AbortController, TextDecoder, Buffer, Headers,
    fetch: async () => { throw Error('External research is prohibited in the isolated Forecast preview'); }
  };
  const imports = { '@/lib/commercial_business': f.business };
  for (const name of ['forecast', 'forecastResearch', 'forecastService']) imports['@/lib/' + name] = evaluate('lib\\' + name + '.ts', imports, globals);
  imports.openai = class ForbiddenOpenAI { constructor() { throw Error('Paid AI is prohibited in the isolated Forecast preview'); } };
  imports['@/lib/forecastProviders'] = evaluate('lib\\forecastProviders.ts', imports, globals);
  Object.assign(imports, { '@/lib/adminAuth': { corsHeaders: () => ({}) }, '@/lib/fieldSales': f.sales,
    '@/lib/supabase': { getSupabase: () => f.client }, '@/lib/fieldQuote': f.engine });
  return evaluate('app\\api\\forecast\\route.ts', imports, globals);
}

async function initialize(origin, scenario) {
  const f = await createWorkflowFixture();
  try {
    // Remove the unrelated legacy paid orders/jobs seeded by the shared helper.
    // No walkthrough lead, quote, acceptance, order or completion is seeded.
    await f.db.exec(`delete from h2s_payouts_ledger; delete from h2s_job_artifacts;
      delete from h2s_dispatch_job_assignments; delete from h2s_dispatch_jobs;
      delete from h2s_jobs; delete from commercial_effects; delete from commercial_consultation_requests;
      delete from h2s_orders; delete from commercial_leads;`);
    await f.db.exec(`alter table h2s_pros
      add column vehicle_text text, add column service_radius_miles integer,
      add column max_jobs_per_day integer, add column photo_url text,
      add column bio_short text, add column phone text, add column zip text,
      add column city text, add column state text, add column geo_lat numeric, add column geo_lng numeric;`);
    await f.db.query(`update h2s_pros set name=$2,vehicle_text=$3,service_radius_miles=50,max_jobs_per_day=4,
      photo_url=$4,bio_short=$5,phone='+15550001111',zip='28202',city='Synthetic Review City',state='NC',
      geo_lat=35.2271,geo_lng=-80.8431 where pro_id=$1`, [id(500), 'SIMULATED ONLY Review Installer',
      'SIMULATED ONLY white installation van', origin + '/walkthrough/artifact?key=synthetic-profile-photo.png',
      'SIMULATED ONLY existing technician profile for isolated TV and camera installation review.']);
    catalog(f, scenario);
    f.env.H2S_FIELD_SALES_ORIGIN = origin;
    f.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-isolated-client-only';
    await f.enable();
    await f.db.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'migrations',
      '048_field_sales_catalog_administration.sql'), 'utf8'));
    await f.db.exec('update field_sales_catalog_admin_settings set enabled=true');
    f.env.H2S_FIELD_CATALOG_ADMIN_ENABLED = 'true';
    const rpc = f.client.rpc.bind(f.client);
    const catalogCasts = { field_sales_catalog_admin_read: ['uuid', 'uuid'],
      field_sales_catalog_admin_command: ['uuid', 'uuid', 'text', 'jsonb'] };
    f.client.rpc = async (name, args) => {
      if (!catalogCasts[name]) return rpc(name, args);
      try {
        const values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
        const out = await f.db.query(`select ${name}(${values.map((_, i) => '$' + (i + 1) + '::' + catalogCasts[name][i]).join(',')}) result`, values);
        return { data: out.rows[0].result, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    };
    const storage = f.client.storage;
    f.reviewArtifactMime = new Map();
    f.client.storage = { ...storage, from: bucket => {
      const store = storage.from(bucket);
      if (bucket === 'commercial-private-files') return store;
      return { ...store, upload: async (key, bytes, options) => {
        const result = await store.upload(key, bytes, options);
        if (!result.error) f.reviewArtifactMime.set(bucket + '/' + key, options?.contentType || 'application/octet-stream');
        return result;
      }, getPublicUrl: key => ({
        data: { publicUrl: origin + '/walkthrough/artifact?key=' + encodeURIComponent(bucket + '/' + key) }
      }) };
    } };
    // Use the original audited identity command rather than a success-shaped
    // workflow insert. Tenure is deterministic relative to this review's clock.
    await f.db.query(`select field_sales_identity_command($1::uuid,$2::uuid,$3::jsonb)`, [
      id(9), crypto.randomUUID(), JSON.stringify({ userId: id(20),
        commissionStartDate: new Date(Date.parse(f.earnings.zonedDate(new Date().toISOString(),
          'America/New_York') + 'T00:00:00Z') - 39 * 86400000).toISOString().slice(0, 10),
        commissionStartEvidence: 'SIMULATED ONLY audited representative start, day 40 review tenure', termsRevision: 0 })
    ]);
    const dashboardTokens = {};
    for (const [actor, userId, username] of [['admin', id(9), 'ADMIN_FIXTURE'], ['sales', id(20), 'SALESA']]) {
      const pin = crypto.randomBytes(32).toString('hex');
      const credentials = f.sales.newCredentials(pin);
      await f.db.query('update "Dashboard_Users" set "Pin_Salt"=$2,"Pin_Hash"=$3 where "User_ID"=$1',
        [userId, credentials.pinSalt, credentials.pinHash]);
      const login = await f.auth.dashboardLogin(new Request(origin), { username, pin, device: 'isolated-walkthrough' });
      if (login instanceof Response || !login.token) throw Error('Isolated native dashboard session unavailable');
      dashboardTokens[actor] = login.token;
    }
    const catalogRoute = evaluate('app\\api\\field-sales-catalog\\route.ts', {
      '@/lib/supabase': { getSupabase: () => f.client }, '@/lib/adminAuth': { corsHeaders: () => ({}) },
      '@/lib/fieldSales': f.sales, '@/lib/fieldQuote': f.engine
    }, { process: { env: f.env }, Buffer, Headers });
    const routes = { ...f.routes, ...await nativeRoutes(f), 'field-sales-catalog': catalogRoute, forecast: forecastRoute(f) };
    return { f, routes, scenario, dashboardTokens, agreementUrl: null, declined: new Set(), captures: new Map() };
  } catch (error) { await f.db.close(); throw error; }
}

async function createWalkthrough({ origin } = {}) {
  const location = new URL(origin);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    || !['http:', 'https:'].includes(location.protocol) || location.username || location.password
    || location.pathname !== '/' || location.search || location.hash) throw Error('A loopback-only review origin is required');
  origin = location.origin;
  let current = await initialize(origin, 'tv'), closed = false, pending = 0, tail = Promise.resolve();
  const exclusive = operation => {
    if (closed) return Promise.reject(Error('Walkthrough is closed'));
    pending++;
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result.finally(() => pending--);
  };
  const actorToken = actor => aliases[actor] || actor || '';

  async function requestInternal(name, method = 'GET', body, actor = 'admin', query = '') {
    const { f, routes } = current;
    name = String(name).replace(/^\/api\//, '');
    method = String(method).toUpperCase();
    const url = new URL('/api/' + name + (query || ''), origin);
    if (url.origin !== origin) throw Error('Request must remain on the isolated origin');
    const token = actorToken(actor);
    if (name === 'walkthrough-artifact' && method === 'GET') {
      const key = url.searchParams.get('key');
      if (key === 'synthetic-profile-photo.png') return new Response(Buffer.from(PHOTO, 'base64'), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
      const artifactUrl = origin + '/walkthrough/artifact?key=' + encodeURIComponent(key || '');
      const artifact = (await f.db.query('select job_id from h2s_dispatch_job_artifacts where url=$1', [artifactUrl])).rows[0];
      if (!artifact) return Response.json({ ok: false, error: 'Artifact not found' }, { status: 404 });
      const guard = await f.request('field-sales-installation', 'GET', null, token, '?job_id=' + encodeURIComponent(artifact.job_id));
      if (!guard.ok) return guard;
      const bytes = f.proofStorage.get(key);
      if (!bytes) return unavailable('native artifact bytes');
      return new Response(bytes, { headers: { 'Content-Type': f.reviewArtifactMime.get(key) || 'application/octet-stream', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff' } });
    }
    if (name === 'v1') {
      if (method !== 'GET' || url.searchParams.get('action') !== 'dashboardMe') return unavailable('v1:' + url.searchParams.get('action'));
      const sessionToken = current.dashboardTokens[actor] || token;
      const result = await f.auth.dashboardMe(new Request(url, { headers: { authorization: 'Bearer ' + sessionToken } }));
      return result instanceof Response ? result : Response.json({ ok: true, me: result });
    }
    if (name.startsWith('portal_')) {
      // Native portal controls send their token in body/query, unlike the sales
      // handlers' bearer contract. Never let a submitted token override actor.
      if (body && body.token && actorToken(body.token) !== token) return Response.json({ ok: false, error: 'Actor/token mismatch' }, { status: 403 });
      if (url.searchParams.has('token') && actorToken(url.searchParams.get('token')) !== token) return Response.json({ ok: false, error: 'Actor/token mismatch' }, { status: 403 });
      url.searchParams.set('token', token);
      if (method !== 'GET' && method !== 'HEAD') body = { ...body, token };
      // The legacy single-job handler is not assignment-scoped on its own.
      // Permit reading the current technician's pending offer, but never another
      // technician's job. The installation API separately requires acceptance.
      const jobId = body?.job_id || url.searchParams.get('job_id');
      if (['portal_jobs', 'portal_jobs_v2'].includes(name) && jobId) {
        if (!['pro', 'other'].includes(token)) return Response.json({ ok: false, error: 'Pro sign-in required' }, { status: 401 });
        const scoped = await f.db.query(`select w.job_id from field_sales_workflows w
          join h2s_dispatch_job_assignments a on a.job_id=w.job_id::text and a.pro_id=w.technician_id::text
          join h2s_pros p on p.pro_id=w.technician_id and p.is_active
          where w.job_id::text=$1 and w.technician_id=$2::uuid
          and a.state in ('pending','offered','accepted','assigned','done','completed') limit 1`,
        [jobId, id(token === 'pro' ? 500 : 502)]);
        if (!scoped.rows.length) return Response.json({ ok: false, error: 'Exact current technician offer required' }, { status: 403 });
      }
    }
    if (!routes[name]?.[method]) return unavailable(name + ':' + method);
    if (name === 'field-sales-stripe-webhook') return unavailable('unsigned direct webhook; use SIMULATED ONLY provider capture');
    const response = await routes[name][method](new Request(url, {
      method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body !== undefined && body !== null && method !== 'GET' ? { body: JSON.stringify(body) } : {})
    }));
    if (response.headers.get('content-type')?.includes('application/json')) {
      const result = await response.clone().json();
      if (result.ok && result.agreementUrl) current.agreementUrl = result.agreementUrl;
    }
    return response;
  }

  async function statusInternal() {
    const { f, scenario } = current;
    const read = async (name, query = '') => {
      const response = await requestInternal(name, 'GET', null, 'admin', query);
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(`${name} status unavailable: ${result.error}`);
      return result;
    };
    const sales = await read('field-sales');
    const owned = sales.opportunities.find(row => row.owner_user_id === id(20)) || null;
    const leadId = owned?.lead_id || null;
    const transactions = await read('field-sales-transactions', leadId ? '?leadId=' + leadId : '');
    const workflow = await read('field-sales-workflow', leadId ? '?lead_id=' + leadId : '');
    const earnings = await read('field-sales-earnings');
    const catalogs = await read('field-sales-catalog');
    const quote = transactions.quotes?.[0] || null;
    const w = workflow.workflows.find(row => row.leadId === leadId) || null;
    const technicianOffer = w?.jobId ? (await f.db.query(`select state,accepted_at as "acceptedAt"
      from h2s_dispatch_job_assignments where job_id=$1 and pro_id=$2 order by created_at desc limit 1`,
    [w.jobId, w.technicianId])).rows[0] || null : null;
    const agreement = transactions.agreements?.find(row => row.quote_id === w?.quoteId || row.quote_id === quote?.quote_id) || null;
    const entry = earnings.entries?.find(row => row.quoteId === w?.quoteId) || null;
    const runs = earnings.runs || [];
    const activeRun = runs.find(row => row.state !== 'abandoned') || null;
    const start = new Date(Date.now() + 2 * 86400000); start.setUTCHours(15, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600000);
    const settlementPolicy = workflow.policies.find(row => row.policyId === f.policyIds.settlement || row.policy_id === f.policyIds.settlement);
    const settlementDefinition = settlementPolicy?.definition || { timezone: 'America/New_York', cutoff: '12:00',
      holidayConvention: 'skip', holidays: [], method: 'reviewed_bank_transfer', classification: 'synthetic' };
    const sessions = [...f.sessions.values()].map(session => ({
      sessionId: session.id, checkoutUrl: `https://checkout.stripe.com/c/pay/${session.id}`,
      status: session.status, paymentStatus: session.payment_status, amountCents: session.amount_total,
      declined: current.declined.has(session.id), simulatedOnly: true
    }));
    const checkouts = (await f.db.query(`select session_id as "sessionId",checkout_url as url,kind,
      amount_cents::integer as "amountCents",state from field_sales_checkouts order by created_at,checkout_id`)).rows;
    const latestSession = sessions.at(-1) || null;
    let stage = !leadId ? 'prospect' : !quote || ['draft', 'rejected'].includes(quote.state) ? 'quote' : quote.state === 'pending_approval' ? 'approval'
      : !w ? 'enrollment' : !agreement ? 'documents_and_agreement' : !agreement.accepted_at ? 'customer_acceptance'
      : !w.gates.canSchedule && !w.jobId ? 'deposit' : !w.jobId ? 'calendar'
      : !w.technicianId ? 'preparation_and_assignment' : !w.completedAt && !['accepted','assigned'].includes(technicianOffer?.state) ? 'technician_offer'
      : !w.completedAt ? 'technician_installation'
      : w.netPaidCents < w.totalCents ? 'customer_balance' : !w.costsComplete ? 'actual_cost_review'
      : !entry ? 'earnings_review' : !activeRun ? 'friday_run' : activeRun.state;
    if (['cancelled', 'refund_review'].includes(w?.state)) stage = w.state;
    const serviceId = scenario === 'camera' ? 'cameras_included' : 'tv_mounting';
    const lines = [{ serviceId, offerId: scenario === 'camera' ? 'package' : 'standard',
      quantity: scenario === 'camera' ? 2 : 1, answers: scenario === 'camera' ? { installation: 'wireless' }
        : { size: 55, wall: scenario === 'exception' ? 'masonry' : 'drywall' },
      options: scenario === 'camera' ? [] : ['full_motion'] }];
    const enrollment = { representativeId: id(20),
      legalPolicyId: f.policyIds.legal, commissionPolicyId: f.policyIds.commission,
      settlementPolicyId: f.policyIds.settlement, creditEvidence: { reference: 'SIMULATED ONLY reviewed attribution' } };
    const runDate = f.earnings.fridayRunDate(new Date().toISOString(), settlementDefinition);
    const nextAction = {
      prospect: 'Sales: create the synthetic prospect in the actual form', quote: 'Sales: create and submit an itemized quote',
      approval: 'Admin: review and approve the exact exceptional scope', enrollment: 'Admin: enroll the approved quote',
      documents_and_agreement: 'Admin: publish exact approved documents; Sales: open the customer agreement link',
      customer_acceptance: 'Customer: read and affirm the original agreement controls', deposit: 'Customer: create the deposit checkout; simulate provider capture',
      calendar: 'Admin: confirm the customer-agreed installation window', preparation_and_assignment: 'Admin: review preparation and assign the scoped technician',
      technician_offer: 'Pro: view and accept the actual offer', technician_installation: 'Pro: upload and bind native proof, enter actual costs/hours and complete',
      customer_balance: 'Customer: create the balance checkout; simulate provider capture', actual_cost_review: 'Admin: review actual cost evidence',
      earnings_review: 'Admin: review authoritative earnings', friday_run: 'Admin: create the eligible Friday run',
      draft: 'Admin: review and approve the Friday run', approved: 'Admin: export the reviewed run',
      exported: 'Admin: record independently reconciled synthetic settlement proof',
      reconciled_paid: 'Synthetic walkthrough complete; no external payment was initiated'
    }[stage] || 'Review authoritative holds and original workflow controls';
    const expenses = [{ category: 'equipment', quantity: scenario === 'camera' ? 2 : 1,
      unitCents: scenario === 'camera' ? 8900 : 2900, amountCents: scenario === 'camera' ? 17800 : 2900,
      actual: true, evidence: { reference: 'SIMULATED ONLY itemized purchased equipment receipt' } },
    { category: 'materials', quantity: 1, unitCents: 500, amountCents: 500, actual: true,
      evidence: { reference: 'SIMULATED ONLY actual consumed fasteners receipt' } }];
    return safe({
      ok: true, isolated: true, simulatedOnly: true, disclosure: DISCLOSURE, scenario, scenarios: SCENARIOS, origin,
      sources: { handlers: 'Existing backend API TypeScript evaluated with blocked imports and isolated clients',
        database: 'PGlite in-memory PostgreSQL; existing migrations 032–048 as loaded by shared fixtures',
        nativeAuth: 'Synthetic pro aliases; dashboardMe uses actual extracted v1 login/session helpers',
        storage: 'In-memory private photos and native proof bytes; no external storage or mail delivery',
        provider: 'Synthetic SDK receipts verified by original signed webhook and reserved checkout identities' },
      stage, nextAction, nextActions: workflow.nextActions || [],
      leadId, quoteId: w?.quoteId || quote?.quote_id || null, orderId: w?.orderId || null, jobId: w?.jobId || null,
      customer: { name: owned?.full_name || 'SIMULATED ONLY review customer' },
      totalCents: w?.totalCents ?? quote?.snapshot?.totalCents ?? null, netPaidCents: w?.netPaidCents ?? 0,
      current: { leadId, quoteId: w?.quoteId || quote?.quote_id || null, orderId: w?.orderId || null, jobId: w?.jobId || null },
      lead: owned, quote, workflow: w, workflowRevision: w?.revision ?? null,
      agreementUrl: current.agreementUrl, customerToken: current.agreementUrl
        ? new URLSearchParams(new URL(current.agreementUrl).hash.slice(1)).get('token') : null,
      roles: { admin: { actor: 'admin', userId: id(9), role: 'ADMIN' },
        sales: { actor: 'sales', userId: id(20), role: 'SALES' }, pro: { actor: 'pro', userId: id(500), role: 'pro' },
        customer: { role: 'customer', authentication: 'actual scoped agreement handoff token' } },
      totals: { totalCents: w?.totalCents ?? quote?.snapshot?.totalCents ?? null, netPaidCents: w?.netPaidCents ?? 0,
        depositCents: w?.depositCents ?? null, balanceCents: w?.balanceCents ?? null,
        processingFeeCents: w?.processingFeeCents ?? null },
      flags: { accepted: Boolean(agreement?.accepted_at), completed: Boolean(w?.completedAt),
        offerAccepted: ['accepted', 'assigned', 'done', 'completed'].includes(technicianOffer?.state),
        proofComplete: Boolean(w?.proof?.complete), costsComplete: Boolean(w?.costsComplete), earned: Boolean(entry),
        settled: activeRun?.state === 'reconciled_paid' },
      checkouts,
      provider: { simulatedOnly: true, sessions, checkouts, sessionId: latestSession?.sessionId || null,
        checkoutUrl: latestSession?.checkoutUrl || null, landingPath: '/walkthrough/provider',
        controls: ['provider_capture', 'provider_decline'], evidence: [...current.captures.values()] },
      earnings, pricing: { catalogId: f.catalogId, definition: f.definition, catalogs: catalogs.catalogs, disclosure: DISCLOSURE },
      suggestions: {
        serviceId, catalogId: f.catalogId,
        lines, offerValue: serviceId + ':' + lines[0].offerId, quantity: lines[0].quantity,
        quoteAnswers: lines[0].answers, quoteOptions: lines[0].options,
        prospect: { fullName: 'SIMULATED ONLY ' + scenario + ' review customer', phone: '+15551112223',
          address: '100 Synthetic Review Lane', city: 'Review City', market: 'residential',
          services: [serviceId], notes: DISCLOSURE, followUpAt: null },
        assessmentServiceId: serviceId, assessment: scenario === 'camera'
          ? { quantity: 2, installation: 'Wireless', equipment: 'SIMULATED ONLY two included cameras',
            coverage: 'Synthetic front-door and driveway coverage with reviewed existing power and network' }
          : { quantity: 1, size: 55, surface: scenario === 'exception' ? 'Brick / masonry' : 'Drywall / studs', mount: 'Full-motion mount' },
        enrollment, enroll: { leadId, quoteId: w?.quoteId || quote?.quote_id || null, ...enrollment },
        artifacts: w?.requiredArtifacts || [], schedule: { start: start.toISOString(), end: end.toISOString(),
          timezone: 'America/New_York', customerAgreed: true, reservationRevision: w?.reservation?.revision || 0,
          reason: 'SIMULATED ONLY customer-agreed installation window' },
        preparation: { scopeReviewed: true, materials: 'ready', access: 'ready', blockers: '',
          preparationRevision: w?.preparation?.revision || 0, note: 'SIMULATED ONLY onsite scope, access and materials review' },
        assignment: { proId: id(500), context: w?.assignmentPreview?.job?.context || null,
          note: 'SIMULATED ONLY reviewed technician scope' },
        assign: { proId: id(500), context: w?.assignmentPreview?.job?.context || null,
          note: 'SIMULATED ONLY reviewed technician scope' },
        expenses, hours: 2, completionEvidence: { reference: 'SIMULATED ONLY onsite completion evidence' },
        costReviewEvidence: { reference: 'SIMULATED ONLY administrator reconciled actual receipts', actualCostsReviewed: true },
        settlement: { settlementPolicyId: f.policyIds.settlement,
          runDate, reference: 'SIMULATED-ONLY-independent-' + (activeRun?.runId || 'review-run'),
          settledAt: new Date().toISOString(), evidence: { statement: 'SIMULATED ONLY independent bank reconciliation fixture' },
          independentReconciliation: true,
          method: settlementDefinition.method, beneficiaries: entry ? [{ representativeId: id(20), amountCents: entry.amountCents }] : [],
          amountCents: entry?.amountCents || 0 },
        commissions: { settlementPolicyId: f.policyIds.settlement, runDate }
      },
      unsupported: ['Native sign-in/OTP/email delivery', 'External maps/geocoding', 'Native training and announcements hosting',
        'Native availability editing', 'Native on-my-way (legacy en_route status is not allowed by the isolated authoritative dispatch schema)',
        'External withdrawals/bank transfer (only original earnings reconciliation is available)',
        'Any legacy v1 action except dashboardMe'],
      supportedEndpoints: [...Object.entries(current.routes).filter(([name]) => name !== 'field-sales-stripe-webhook')
        .map(([name, route]) => ({ name, methods: Object.keys(route).filter(key => /^(GET|POST|OPTIONS|DELETE)$/.test(key)) })),
        { name: 'v1', methods: ['GET'], actions: ['dashboardMe'] }, { name: 'walkthrough-artifact', methods: ['GET'] }]
    });
  }

  async function controlInternal(action, payload = {}) {
    const { f } = current;
    if (action === 'source_status') return statusInternal();
    if (action === 'provider_capture' || action === 'provider_decline') {
      const sid = payload.sessionId || payload.session_id;
      const session = f.sessions.get(sid);
      if (!session) throw Error('An exact existing reserved provider session ID is required');
      if (action === 'provider_decline') {
        if (session.status !== 'open') throw Error('Only an open checkout can be declined');
        current.declined.add(sid);
        return { ok: true, simulatedOnly: true, paid: false, sessionId: sid, returnUrl: origin + '/field-agreement.html#checkout-cancelled' };
      }
      if (payload.amountCents !== undefined && payload.amountCents !== session.amount_total) throw Error('Capture amount must equal the actual reserved amount');
      const fee = payload.feeCents ?? current.captures.get(sid)?.feeCents ?? Math.round(session.amount_total * 0.029) + 30;
      if (!Number.isSafeInteger(fee) || fee < 0 || fee > session.amount_total) throw Error('Exact supported synthetic actual provider fee required');
      if (current.captures.has(sid)) {
        const recorded = current.captures.get(sid);
        if (recorded.feeCents !== fee) throw Error('Captured provider fee cannot be changed');
        return safe({ ...recorded, replayed: true });
      }
      if (session.status !== 'open') throw Error('Only an open checkout can be captured');
      const receipt = f.paid(sid);
      receipt.charge.balance_transaction = { id: 'txn_synthetic_' + sid, source: receipt.charge.id,
        amount: session.amount_total, fee, net: session.amount_total - fee, currency: 'usd', fee_details: [] };
      const response = await f.webhook('checkout.session.completed', receipt.session, 'evt_walkthrough_' + sid);
      const result = await response.json();
      if (!response.ok || result.received !== true) throw Error('Signed synthetic provider receipt failed: ' + JSON.stringify(result));
      const recorded = { ok: true, simulatedOnly: true, sessionId: sid, amountCents: session.amount_total, feeCents: fee,
        returnUrl: origin + '/field-agreement.html#checkout-returned', receipt: result };
      current.captures.set(sid, recorded);
      return safe(recorded);
    }
    if (action === 'placeholder_photo') {
      if (!payload.jobId) throw Error('An actual assigned job ID is required');
      const response = await requestInternal('portal_upload_artifact', 'POST', {
        job_id: payload.jobId, type: 'photo', data: PHOTO, filename: 'SIMULATED-ONLY-placeholder.png', mimetype: 'image/png'
      }, payload.actor || 'pro');
      const result = await response.json();
      return safe({ ...result, httpStatus: response.status, simulatedOnly: true });
    }
    throw Error('Unsupported environment control: ' + action);
  }

  return {
    request: (name, method, body, actor, query) => exclusive(() => requestInternal(name, method, body, actor, query)),
    status: () => exclusive(statusInternal),
    control: (action, payload = {}) => {
      if (action !== 'reset') return exclusive(() => controlInternal(action, payload));
      if (pending) return Promise.reject(Error('Review is busy; reset cannot race an in-flight request'));
      if (!SCENARIOS.includes(payload.scenario)) return Promise.reject(Error('Select tv, camera or exception'));
      return exclusive(async () => {
        const next = await initialize(origin, payload.scenario);
        const previous = current; current = next;
        await previous.f.db.close();
        return statusInternal();
      });
    },
    close: () => exclusive(async () => { closed = true; await current.f.db.close(); })
  };
}

module.exports = { createWalkthrough };
