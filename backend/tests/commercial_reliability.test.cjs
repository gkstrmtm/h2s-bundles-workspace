const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createFixture } = require('./helpers/commercial_contact_fixture.cjs');
const { buildSlotSuggestions, validateConsultationWindow } = require('../lib/commercial_consultation.js');

const contact = {
  fullName: 'Reliability Fixture', contactPreference: 'sms', phone: '+15550000005',
  smsOptIn: true, serviceNeeds: ['Security Cameras'],
};
const windowInput = () => {
  const slot = buildSlotSuggestions()[0];
  return { selectedSlotStart: slot.startIso, selectedSlotEnd: slot.endIso };
};
async function lead(f, patch = {}) {
  const response = await f.post('commercial-intake', { ...contact, ...patch });
  assert.equal(response.status, 201);
  return (await response.json()).lead;
}
async function submit(f) {
  const saved = await lead(f);
  const response = await f.post('commercial-consultation', { publicToken: saved.publicToken, ...windowInput(), submissionKey: 'fixture-submission-key-0001' });
  assert.equal(response.status, 201);
  return f.tables.commercial_consultation_requests[0];
}
const decision = (f, row, action = 'approve') => f.post('commercial-consultation-response', { token: row.response_token, action });

test('commercial maintenance is scheduled without replacing the existing owner-media reminder', () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf8'));
  assert.deepEqual(config.crons, [
    { path: '/api/owner-media-reminder', schedule: '0 15 * * *' },
    { path: '/api/commercial-consultation-maintenance', schedule: '*/15 * * * *' },
  ]);
});

test('production commercial routes and approval assets remain reachable from the canonical shop origin', () => {
  const frontend = path.resolve(__dirname, '../../frontend');
  const config = JSON.parse(fs.readFileSync(path.join(frontend, 'vercel.json'), 'utf8'));
  for (const route of ['/commercial', '/commercial-approval']) {
    const first = config.rewrites.find(entry =>
      (entry.source === route || entry.source === '/:path*') &&
      (!entry.has || entry.has.every(condition => condition.type === 'host' && condition.value === 'shop.home2smart.com'))
    );
    assert.equal(first?.destination, `${route}.html`);
  }
  const approval = fs.readFileSync(path.join(frontend, 'commercial-approval.html'), 'utf8');
  assert.match(approval, /src="\/commercial-approval\.js"/);
  assert.doesNotMatch(approval, /src="\/frontend\/commercial-approval\.js"/);
});

test('initial save replay, concurrent saves and stale revisions retain one authoritative lead', async () => {
  const f = createFixture();
  const input = { ...contact, publicToken: 'fixture-public-token-000001', revision: 0, saveKey: 'fixture-save-key-000001' };
  const responses = await Promise.all([f.post('commercial-intake', input), f.post('commercial-intake', input)]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(f.tables.commercial_leads.length, 1);
  assert.equal(f.tables.commercial_leads[0].revision, 1);
  const changed = await f.post('commercial-intake', { ...input, revision: 1, saveKey: 'fixture-save-key-000002', notes: 'Newest' });
  assert.equal(changed.status, 200);
  const stale = await f.post('commercial-intake', { ...input, saveKey: 'fixture-save-key-000003', notes: 'Stale' });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).lead.notes, 'Newest');
  assert.equal(f.tables.commercial_leads[0].notes, 'Newest');
});

test('simultaneous submissions and a lost-response retry create one request and one set of notifications', async () => {
  const f = createFixture();
  const saved = await lead(f);
  const input = { publicToken: saved.publicToken, ...windowInput(), submissionKey: 'fixture-submission-key-0001' };
  const responses = await Promise.all([f.post('commercial-consultation', input), f.post('commercial-consultation', input)]);
  assert.ok(responses.every(response => response.ok));
  const ids = await Promise.all(responses.map(async response => (await response.json()).consultation.requestId));
  assert.equal(ids[0], ids[1]);
  assert.equal(f.tables.commercial_consultation_requests.length, 1);
  assert.equal(f.sms.length, 2);
  assert.equal((await f.post('commercial-consultation', input)).status, 200);
  assert.equal(f.sms.length, 2);
});

test('appointment failures send no booking confirmation and admin retry creates exactly one appointment', async () => {
  const f = createFixture();
  const row = await submit(f);
  f.faults.commercial_create_appointment = 'Fixture appointment insert failed';
  const response = await decision(f, row);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.appointment.ok, false);
  assert.equal(f.appointments.length, 0);
  assert.equal(f.sms.length, 2);
  const queued = (await f.queue()).queue[0];
  assert.equal(queued.followUp.recoveryAllowed, true);
  assert.match(queued.followUp.nextAction, /appointment is not created/i);
  delete f.faults.commercial_create_appointment;
  assert.equal((await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id)).ok, true);
  assert.equal(f.appointments.length, 1);
  assert.equal(f.sms.length, 3);
  assert.equal(row.status, 'approved', 'Provider acceptance is not customer acknowledgement');
  await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id);
  assert.equal(f.appointments.length, 1);
  assert.equal(f.sms.length, 3);
});

test('known rejection can be retried without recreating an appointment; uncertain sends cannot be resent', async () => {
  for (const failure of ['rejected', 'timeout']) {
    const f = createFixture();
    const row = await submit(f);
    f.faults.sms = failure;
    assert.equal((await decision(f, row)).status, 200);
    assert.equal(f.appointments.length, 1);
    const queue = (await f.queue()).queue[0];
    assert.equal(queue.followUp.recoveryAllowed, failure === 'rejected');
    assert.match(queue.followUp.nextAction, failure === 'rejected' ? /provider rejected/i : /uncertain provider/i);
    const attempts = f.providerAttempts.length;
    delete f.faults.sms;
    await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id);
    assert.equal(f.providerAttempts.length, attempts + (failure === 'rejected' ? 1 : 0));
    assert.equal(f.appointments.length, 1);
  }
});

test('provider acceptance survives local message-persistence failure and is never resent', async () => {
  const f = createFixture();
  const row = await submit(f);
  f.faults.sms_messages = 'Fixture message history write failed';
  const result = await (await decision(f, row)).json();
  assert.equal(result.notifications.customer.accepted, true);
  assert.match(result.notifications.customer.persistenceError, /history write failed/);
  assert.equal((await f.queue()).queue[0].followUp.needsAttention, true);
  delete f.faults.sms_messages;
  const before = f.providerAttempts.length;
  await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id);
  assert.equal(f.providerAttempts.length, before);
});

test('declined requests retain a manual next action and safely retry rejected notifications', async () => {
  const f = createFixture();
  const row = await submit(f);
  f.faults.sms = 'rejected';
  assert.equal((await decision(f, row, 'decline')).status, 200);
  assert.equal((await f.queue()).queue[0].followUp.recoveryAllowed, true);
  delete f.faults.sms;
  assert.equal((await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id)).ok, true);
  assert.equal(f.appointments.length, 0);
  const queued = (await f.queue()).queue[0];
  assert.equal(queued.followUp.needsAttention, true);
  assert.match(queued.followUp.nextAction, /Technician declined/);
  const attempts = f.providerAttempts.length;
  await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id);
  assert.equal(f.providerAttempts.length, attempts);
});

test('simultaneous approvals create one appointment; stale approval authority is rejected after reschedule', async () => {
  const f = createFixture();
  const row = await submit(f);
  const responses = await Promise.all([decision(f, row), decision(f, row)]);
  assert.ok(responses.some(response => response.ok));
  assert.equal(f.appointments.length, 1);
  assert.equal(f.sms.length, 3);
  assert.equal((await decision(f, row, 'decline')).status, 409);
  const g = createFixture();
  const pending = await submit(g);
  const old = structuredClone(pending);
  const rescheduled = await g.post('commercial-consultation', {
    publicToken: g.tables.commercial_leads[0].public_token, mode: 'reschedule', requestId: pending.request_id,
    ...windowInput(), submissionKey: 'fixture-reschedule-key-0001',
  });
  assert.equal(rescheduled.status, 200);
  assert.notEqual(pending.response_token, old.response_token);
  const stale = await g.runtime.applyConsultationDecision({ request: new Request('http://localhost'), consultation: old,
    lead: g.tables.commercial_leads[0], action: 'approve', channel: 'web' });
  assert.equal(stale.ok, false);
  assert.equal(g.appointments.length, 0);
  const delayedReply = await g.runtime.handleTechnicianReply(new Request('http://localhost'), '+15550000001', `YES ${pending.reference_code}`);
  assert.equal(delayedReply.ok, false);
  assert.match(delayedReply.replyText, /current approval link/);
  assert.equal(g.appointments.length, 0);
});

test('Eastern windows remain consistent across browser/server zones, DST and unsupported input', () => {
  for (const nowText of ['2026-03-06T22:00:00Z', '2026-10-30T22:00:00Z']) {
    const now = new Date(nowText);
    const slots = buildSlotSuggestions({ now, count: 8, timeZone: 'Asia/Tokyo', durationMinutes: 45 });
    assert.equal(slots.length, 8);
    for (const slot of slots) {
      assert.equal(validateConsultationWindow(slot.startIso, slot.endIso, now), null);
      assert.equal(slot.durationMinutes, 30);
    }
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(slots[0].startIso));
    assert.equal(day, 'Mon');
    assert.ok(slots[0].startIso.includes(nowText.includes('03-06') ? 'T13:00:' : 'T14:00:'));
  }
  const now = new Date('2026-03-09T00:00:00Z');
  for (const [start, end] of [
    ['broken', 'broken'], ['2026-03-09T09:00:00', '2026-03-09T09:30:00'],
    ['2026-03-08T13:00:00Z', '2026-03-08T13:30:00Z'],
    ['2026-03-09T13:00:00Z', '2026-03-09T12:30:00Z'],
    ['2026-03-09T13:00:00Z', '2026-03-09T13:45:00Z'],
    ['2026-03-09T14:00:00Z', '2026-03-09T14:30:00Z'],
    ['2026-04-09T13:00:00Z', '2026-04-09T13:30:00Z'],
  ]) assert.ok(validateConsultationWindow(start, end, now), `${start} must be rejected`);
});

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
test('uploads reject malformed, unsupported and oversized content; ninth concurrent upload is cleaned up', async () => {
  const f = createFixture();
  const saved = await lead(f);
  const upload = patch => f.post('commercial-intake/photo', { publicToken: saved.publicToken,
    data: `data:image/png;base64,${png.toString('base64')}`, ...patch });
  for (const data of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,!!!!', 'data:image/png;base64,aGVsbG8=',
    `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64')}`]) {
    assert.equal((await upload({ data })).status, 400);
  }
  assert.equal((await upload({ data: 'A'.repeat(5 * 1024 * 1024) })).status, 413);
  assert.equal((await f.post('commercial-intake/photo', null)).status, 400);
  f.tables.commercial_leads[0].project_photo_urls = Array.from({ length: 7 }, (_, i) => `https://fixture.invalid/existing-${i}`);
  const concurrent = await Promise.all([upload(), upload()]);
  assert.equal(concurrent.filter(response => response.ok).length, 1);
  assert.equal(f.tables.commercial_leads[0].project_photo_urls.length, 8);
  assert.equal(f.objects.size, 1, 'The losing concurrent object must be removed');
  assert.equal((await upload()).status, 409);
  assert.equal(f.objects.size, 1);
});

test('upload persistence failure removes storage objects; failed cleanup and private buckets are explicit', async () => {
  for (const failure of ['persistence', 'cleanup', 'private']) {
    const f = createFixture();
    const saved = await lead(f);
    if (failure === 'private') f.faults.privateBucket = true;
    else f.faults.commercial_attach_photo = 'Fixture attachment persistence failed';
    if (failure === 'cleanup') f.faults.cleanup = true;
    const response = await f.post('commercial-intake/photo', { publicToken: saved.publicToken, data: `data:image/png;base64,${png.toString('base64')}` });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, failure === 'cleanup' ? /cleanup needs operator review/ : failure === 'private' ? /public-read access/ : /persistence failed/);
    assert.equal(f.objects.size, failure === 'cleanup' ? 1 : 0);
  }
});

async function frontend(f, options = {}) {
  const root = path.resolve(__dirname, '..', '..', 'frontend');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'commercial.html'), 'utf8'), {
    url: options.url || 'http://localhost:3002/commercial', runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.scrollTo = () => {};
  w.confirm = () => false;
  for (const [key, value] of Object.entries(options.storage || {})) w.localStorage.setItem(key, value);
  w.fetch = async (input, init = {}) => {
    const url = new URL(String(input), w.location.href);
    if (options.intercept) {
      const response = await options.intercept(url, init);
      if (response) return response;
    }
    if (url.pathname === '/api/commercial-intake') return init.method === 'POST'
      ? f.post('commercial-intake', JSON.parse(init.body)) : f.route('commercial-intake').GET(new Request(url));
    if (url.pathname === '/api/commercial-consultation') return f.post('commercial-consultation', JSON.parse(init.body));
    assert.ok(['/api/track', '/api/owner-media/public', '/api/proof-gallery'].includes(url.pathname), url.pathname);
    return Response.json({ ok: true, assets: [], items: [], photos: [] });
  };
  const source = fs.readFileSync(path.join(root, 'commercial.js'), 'utf8');
  w.eval(source.replace(/\}\)\(\);\s*$/, 'window.fixture = {state,saveLead,requestConsultation,persistDraft,hydrateForm,showStep};})();'));
  await new Promise(resolve => setImmediate(resolve));
  return dom;
}
function edit(w, id, value) {
  const field = w.document.getElementById(id);
  field.value = value;
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function storageSnapshot(w) {
  return Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => w.localStorage.key(i))
    .map(key => [key, w.localStorage.getItem(key)]));
}
test('full frontend serializes delayed saves and flushes newer edits without duplicates', async () => {
  const f = createFixture();
  let release;
  let started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  let count = 0;
  const dom = await frontend(f, { intercept: async (url, init) => {
    if (url.pathname !== '/api/commercial-intake' || init.method !== 'POST' || ++count !== 1) return;
    const response = await f.post('commercial-intake', JSON.parse(init.body));
    started();
    await new Promise(resolve => { release = resolve; });
    return response;
  } });
  try {
    const w = dom.window;
    w.fixture.hydrateForm(contact);
    const first = w.fixture.saveLead('fixture');
    await firstStarted;
    edit(w, 'notes', 'Newest edit while response is delayed');
    const second = w.fixture.saveLead('fixture');
    assert.equal(count, 1, 'No overlapping saves from this browser');
    release();
    await Promise.all([first, second]);
    assert.equal(f.tables.commercial_leads.length, 1);
    assert.equal(f.tables.commercial_leads[0].notes, 'Newest edit while response is delayed');
    assert.equal(w.fixture.state.dirty, false);
  } finally { dom.window.close(); }
});

test('full frontend restores pending identity and newer unsaved edits after a lost response, offline reload and retry', async () => {
  const f = createFixture();
  let lose = true;
  const first = await frontend(f, { intercept: async (url, init) => {
    if (url.pathname !== '/api/commercial-intake' || init.method !== 'POST' || !lose) return;
    lose = false;
    await f.post('commercial-intake', JSON.parse(init.body));
    throw new Error('Fixture lost response');
  } });
  let savedStorage;
  try {
    first.window.fixture.hydrateForm(contact);
    await assert.rejects(() => first.window.fixture.saveLead('fixture'), /lost response/);
    edit(first.window, 'notes', 'Must survive an offline reload');
    savedStorage = storageSnapshot(first.window);
  } finally { first.window.close(); }
  const offline = await frontend(f, { storage: savedStorage, intercept: async url => {
    if (url.pathname === '/api/commercial-intake') throw new Error('Fixture offline');
  } });
  try {
    assert.equal(offline.window.document.getElementById('notes').value, 'Must survive an offline reload');
    assert.ok(offline.window.fixture.state.pendingSave);
    savedStorage = storageSnapshot(offline.window);
  } finally { offline.window.close(); }
  const reopened = await frontend(f, { storage: savedStorage });
  try {
    assert.equal(reopened.window.document.getElementById('notes').value, 'Must survive an offline reload');
    await reopened.window.fixture.saveLead('fixture');
    assert.equal(f.tables.commercial_leads.length, 1);
    assert.equal(f.tables.commercial_leads[0].notes, 'Must survive an offline reload');
  } finally { reopened.window.close(); }
});

test('full frontend exposes active-step errors and prevents double submission; another tab cannot overwrite newer data', async () => {
  const f = createFixture();
  const dom = await frontend(f);
  try {
    const w = dom.window;
    w.fixture.showStep(5);
    await w.fixture.requestConsultation({ preventDefault() {} });
    assert.ok(!w.document.querySelector('.wizard-card[data-step="2"]').classList.contains('hidden'));
    assert.equal(w.document.getElementById('formStatus').getAttribute('data-tone'), 'error');
    w.fixture.hydrateForm(contact);
    const stored = await w.fixture.saveLead('fixture');
    await f.post('commercial-intake', { ...contact, publicToken: stored.lead.publicToken,
      revision: stored.lead.revision, notes: 'Other tab is authoritative' });
    edit(w, 'notes', 'Stale tab edit');
    await assert.rejects(() => w.fixture.saveLead('fixture'), /newer saved draft/);
    assert.equal(f.tables.commercial_leads[0].notes, 'Other tab is authoritative');
    assert.equal(w.fixture.state.conflict, true);
  } finally { dom.window.close(); }
  const g = createFixture();
  const fresh = await frontend(g);
  try {
    fresh.window.fixture.hydrateForm(contact);
    const slot = windowInput();
    fresh.window.fixture.state.selectedSlotStart = slot.selectedSlotStart;
    await Promise.all([fresh.window.fixture.requestConsultation({ preventDefault() {} }),
      fresh.window.fixture.requestConsultation({ preventDefault() {} })]);
    assert.equal(g.tables.commercial_consultation_requests.length, 1);
    assert.equal(g.sms.length, 2);
  } finally { fresh.window.close(); }
});
