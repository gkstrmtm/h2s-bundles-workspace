const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createFixture, queuePage } = require('./helpers/commercial_contact_fixture.cjs');
const utils = require('../lib/commercial_consultation.js');
const labels = require('../../frontend/commercial-labels.js');

const id = number => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
const params = values => new URLSearchParams({ limit: '25', filter: 'all', ...values });
const leadIds = snapshot => Array.from(snapshot.queue, item => item.leadId);
function seed(fixture, count) {
  const now = Date.now();
  for (let index = 1; index <= count; index++) {
    const timestamp = new Date(now - index * 1000).toISOString();
    fixture.tables.commercial_leads.push({
      lead_id: id(index), public_token: `bearer-must-not-leak-${index}`,
      company_name: `Fixture Company ${index}`, full_name: `Fixture Contact ${index}`,
      email: `fixture${index}@example.invalid`, phone: '+15550000005', contact_preference: 'call',
      scope_summary: `Scope ${index}`, notes: `Additional note ${index}`, service_needs: ['Cameras'],
      project_photo_urls: ['https://fixture.invalid/project.jpg'],
      last_submitted_at: timestamp, created_at: timestamp, updated_at: timestamp,
    });
  }
  return fixture.tables.commercial_leads;
}
function request(fixture, number, status, patch = {}) {
  const timestamp = new Date(Date.now() - 100).toISOString();
  const row = {
    request_id: id(10000 + fixture.tables.commercial_consultation_requests.length),
    lead_id: id(number), status, created_at: timestamp, updated_at: timestamp,
    related_order_id: status === 'approved' ? id(20000 + number) : null, metadata: {}, ...patch,
  };
  fixture.tables.commercial_consultation_requests.push(row);
  return row;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('shared labels format supported and legacy identifiers without changing stored values', () => {
  for (const [value, expected] of [
    ['5k_10k', '$5,000\u2013$10,000'], ['10k_25k', '$10,000\u2013$25,000'],
    ['under_5k', 'Under $5,000'], ['10k_plus', '$10,000+'], ['25k_plus', '$25,000+'],
    ['enterprise', 'Enterprise / phased rollout'], ['not_sure', 'Not sure yet'],
    ['5000_10000', '$5,000\u2013$10,000'], ['custom_legacy_band', 'Custom legacy band'],
  ]) assert.equal(labels.budget(value), expected);
  for (const [value, expected] of [
    ['asap', 'As soon as possible'], ['ASAP', 'As soon as possible'], ['2_weeks', 'Within 2 weeks'],
    ['this_week', 'This week'], ['this_month', 'This month'], ['this_quarter', 'This quarter'],
    ['planning', 'Planning ahead'], ['custom_legacy_window', 'Custom legacy window'],
  ]) assert.equal(labels.timeline(value), expected);
  assert.equal(labels.budget(''), 'Not provided');
  assert.equal(labels.timeline('', 'Not added yet'), 'Not added yet');
});

test('technician routing reports current-window provider acceptance, not an invented assignment or completed follow-up', async () => {
  const fixture = createFixture();
  const leads = seed(fixture, 1);
  leads[0].timeline = 'asap';
  leads[0].budget_band = '5k_10k';
  leads[0].contact_preference = 'sms';
  const selected = '2099-01-01T15:00:00.000Z';
  const consultation = request(fixture, 1, 'pending', {
    selected_slot_start: selected, metadata: { last_reschedule_key: 'current', workflow: {
      [`dispatch:${selected}:current:+15550000005`]: { state: 'accepted' },
      [`dispatch:${selected}:old:+15550000006`]: { state: 'failed' },
      'customer_confirmation': { state: 'accepted' },
    } },
  });
  let item = (await fixture.queue(params())).queue[0];
  assert.deepEqual(JSON.parse(JSON.stringify(item.consultation.technicianRouting)), { acceptedCount: 1, failedCount: 0, pendingCount: 0 });
  assert.equal(item.consultation.assignedTechnicianName, null);
  assert.match(labels.technician(item.consultation).label, /accepted by SMS provider/);
  assert.match(labels.technician(item.consultation).detail, /Delivery and reading are unverified/);
  assert.equal(item.timeline, 'asap');
  assert.equal(item.budgetBand, '5k_10k');
  assert.match(item.followUp.nextAction, /Awaiting technician YES\/NO/);
  consultation.metadata.workflow[`dispatch:${selected}:current:+15550000005`].state = 'uncertain';
  item = (await fixture.queue(params())).queue[0];
  assert.match(labels.technician(item.consultation).label, /needs review/);
  assert.match(labels.technician({ status: 'pending' }).label, /No named assignment recorded/);
});
test('server search and cursors reach every intake beyond the old 150 cap without leaking bearer tokens', async () => {
  const fixture = createFixture();
  seed(fixture, 201);
  const found = [];
  let cursor = '';
  do {
    const snapshot = await fixture.queue(params({ cursor }));
    assert.equal(snapshot.pagination.totalMatches, 201);
    assert.equal(snapshot.pagination.summaryScope, 'page');
    assert.equal(snapshot.summary.totalLeads, snapshot.queue.length);
    assert.doesNotMatch(JSON.stringify(snapshot), /bearer-must-not-leak|publicToken|response_token/);
    found.push(...snapshot.queue.map(item => item.leadId));
    cursor = snapshot.pagination.nextCursor;
  } while (cursor);
  assert.deepEqual(found, Array.from({ length: 201 }, (_, index) => id(index + 1)));
  assert.equal(new Set(found).size, 201);
  assert.ok(fixture.calls.every(call => call.mode === 'select'));
  assert.ok(fixture.calls.filter(call => call.select?.includes('commercial_consultation_requests('))
    .every(call => call.limit === 100 && call.embeddedLimit === 1 && !/public_token|response_token/.test(call.select)));
  const older = await fixture.queue(params({ q: 'Fixture Company 201' }));
  assert.equal(older.queue.length, 1);
  assert.equal(older.queue[0].leadId, id(201));
});

test('cursor ordering is deterministic at timestamp ties and survives a new intake before the current page', async () => {
  const fixture = createFixture();
  const leads = seed(fixture, 50);
  leads.forEach(row => { row.last_submitted_at = leads[0].last_submitted_at; row.created_at = leads[0].created_at; });
  const first = await fixture.queue(params());
  assert.deepEqual(leadIds(first), Array.from({ length: 25 }, (_, index) => id(50 - index)));
  leads.push({ ...leads[0], lead_id: id(100), last_submitted_at: new Date(Date.now() + 1000).toISOString() });
  const second = await fixture.queue(params({ cursor: first.pagination.nextCursor }));
  assert.deepEqual(leadIds(second), Array.from({ length: 25 }, (_, index) => id(25 - index)));
  assert.equal(second.pagination.hasMore, false);
});

test('workflow filtering uses each intake latest request, including after more than 1000 historical requests', async () => {
  const fixture = createFixture();
  seed(fixture, 3);
  for (let index = 0; index < 1001; index++) request(fixture, 1, 'pending', { created_at: '2020-01-01T00:00:00.000Z' });
  request(fixture, 1, 'approved');
  request(fixture, 2, 'escalated');
  assert.deepEqual(leadIds(await fixture.queue(params({ filter: 'approved' }))), [id(1)]);
  assert.equal((await fixture.queue(params({ filter: 'pending' }))).queue.length, 0);
  assert.deepEqual(leadIds(await fixture.queue(params({ filter: 'escalated' }))), [id(2)]);
  assert.deepEqual(leadIds(await fixture.queue(params({ filter: 'no_consultation' }))), [id(3)]);
});

test('sparse workflow search is bounded and continues past an empty 1000-candidate segment', async () => {
  const fixture = createFixture();
  seed(fixture, 1010);
  request(fixture, 1005, 'pending');
  const first = await fixture.queue(params({ filter: 'pending' }));
  assert.equal(first.queue.length, 0);
  assert.equal(first.pagination.scanned, 1000);
  assert.equal(first.pagination.scanLimitReached, true);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(first.pagination.totalMatches, null);
  assert.equal(first.pagination.totalCandidates, 1010);
  const second = await fixture.queue(params({ filter: 'pending', cursor: first.pagination.nextCursor }));
  assert.deepEqual(leadIds(second), [id(1005)]);
  assert.equal(second.pagination.hasMore, false);
});

test('attention preserves uncertain provider, failed appointment, manual and high-priority semantics', async () => {
  const fixture = createFixture();
  const leads = seed(fixture, 5);
  request(fixture, 1, 'approved', { related_order_id: null });
  request(fixture, 2, 'approved', { metadata: { workflow: { customer_sms: { state: 'uncertain' } } } });
  request(fixture, 3, 'pending');
  request(fixture, 4, 'approved');
  request(fixture, 5, 'approved');
  leads[4].priority_tier = 'high';
  const result = await fixture.queue(params({ filter: 'attention' }));
  assert.deepEqual(leadIds(result), [id(1), id(2), id(3), id(5)]);
  assert.equal(result.queue[1].followUp.recoveryAllowed, false);
  assert.match(result.queue[2].followUp.nextAction, /Manually call/);
});

test('search quotes punctuation and LIKE wildcards literally and includes notes, all service slots and formatted phones', async () => {
  const fixture = createFixture();
  const leads = seed(fixture, 2);
  leads[0].company_name = '100%_legal, (HQ) "office" \\ north';
  leads[1].company_name = '100xalegal';
  leads[0].service_needs = Array(7).fill('Other').concat('Network Cabling');
  for (const q of ['100%_legal', '(HQ) "office" \\ north', 'additional NOTE 1', 'network cabling', '(555) 000-0005']) {
    const result = await fixture.queue(params({ q }));
    assert.ok(result.queue.some(item => item.leadId === id(1)), q);
    if (!q.includes('555')) assert.equal(result.queue.length, 1, q);
  }
  assert.equal((await fixture.queue(params({ q: 'x",phone.ilike."%' }))).queue.length, 0);
});

test('invalid queue parameters fail explicitly before database access', async () => {
  const fixture = createFixture();
  for (const invalid of [{ limit: '0' }, { limit: '251' }, { limit: 'abc' }, { filter: 'unknown' },
    { q: 'a'.repeat(121) }, { q: '*' }, { q: 'line\nbreak' }, { cursor: 'not-a-cursor' }]) {
    await assert.rejects(fixture.queue(params(invalid)), error => error.status === 400);
  }
  assert.equal(fixture.calls.length, 0);
});

test('database failures are explicit, not empty successful pages', async () => {
  const fixture = createFixture();
  seed(fixture, 1);
  fixture.faults.commercial_leads = 'Fixture read unavailable';
  await assert.rejects(fixture.queue(params()), /Fixture read unavailable/);
  delete fixture.faults.commercial_leads;
  fixture.faults.commercial_consultation_requests = 'Fixture relation unavailable';
  await assert.rejects(fixture.queue(params()), /Fixture relation unavailable/);
});

test('actual Supabase SDK emits the bounded embedded-latest query and escaped server search', async () => {
  const { createClient } = require('../node_modules/@supabase/supabase-js');
  const fixture = createFixture();
  const [lead] = seed(fixture, 1);
  const calls = [];
  const client = createClient('http://fixture.invalid', 'fixture-only-not-a-real-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.hostname, 'fixture.invalid');
      assert.equal(url.pathname, '/rest/v1/commercial_leads');
      assert.ok(['GET', 'HEAD'].includes(options.method));
      calls.push({ url, options });
      return new Response(options.method === 'HEAD' ? null : JSON.stringify([{ ...lead, commercial_consultation_requests: [] }]), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' },
      });
    } },
  });
  fixture.database.from = table => client.from(table);
  const result = await fixture.queue(params({ q: '100%_legal, (HQ) "office"' }));
  assert.equal(result.pagination.totalMatches, 1);
  const query = calls.find(call => call.options.method === 'GET').url.searchParams;
  assert.equal(query.get('limit'), '100');
  assert.equal(query.get('commercial_consultation_requests.limit'), '1');
  assert.equal(query.get('commercial_consultation_requests.order'), 'created_at.desc,request_id.desc');
  assert.equal(query.get('order'), 'last_submitted_at.desc.nullslast,created_at.desc.nullslast,lead_id.desc');
  assert.ok(query.get('or').startsWith('(and(or('));
  assert.ok(query.get('or').includes('company_name.ilike."%100\\\\%\\\\_legal, (HQ) \\"office\\"%"'));
});

for (const decision of ['approve', 'decline']) {
  test(`new customer pending and ${decision} SMS use exact Home2Smart branding through fixture submission`, async () => {
    const fixture = createFixture();
    const save = await fixture.post('commercial-intake', {
      fullName: 'Branding Fixture', contactPreference: 'sms', phone: '+15550000005',
      smsOptIn: true, serviceNeeds: ['Cameras'],
    });
    const lead = (await save.json()).lead;
    const slot = utils.buildSlotSuggestions()[0];
    const submission = await fixture.post('commercial-consultation', {
      publicToken: lead.publicToken, selectedSlotStart: slot.startIso, selectedSlotEnd: slot.endIso,
    });
    assert.equal(submission.status, 201);
    const result = await fixture.post('commercial-consultation-response', {
      token: fixture.tables.commercial_consultation_requests[0].response_token, action: decision,
    });
    assert.equal(result.status, 200);
    const messages = fixture.sms.filter(message => message.to === '+15550000005').map(message => message.body);
    assert.ok(messages.some(body => body.includes('Thanks for contacting Home2Smart.')));
    assert.ok(messages.some(body => body.includes(decision === 'approve' ? 'Home2Smart confirmed' : 'Home2Smart is reviewing another')));
    messages.forEach(body => assert.doesNotMatch(body, /Home (?:Too|Two|2) Smart/i));
  });
}

async function mount(fixture) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const calls = [];
  const media = { matches: false };
  let interval;
  const dom = new JSDOM(queuePage(), {
    url: 'http://fixture.invalid/queue', runScripts: 'dangerously', virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => media;
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.setInterval = (callback, delay) => { assert.equal(delay, 60000); interval = callback; return 1; };
      Object.defineProperty(window.document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
      window.fetch = async (url, options) => {
        calls.push({ url, options });
        assert.equal(options.method, 'GET', 'Unexpected mutation; only fixture GET is allowed');
        const target = new URL(url, 'http://fixture.invalid');
        assert.equal(target.pathname, '/api/v1');
        assert.equal(target.searchParams.get('action'), 'commercialQueue');
        return { ok: true, json: async () => ({ ok: true, commercialQueue: await fixture.queue(target.searchParams) }) };
      };
    },
  });
  const ui = dom.window.commercialQueueUI;
  await ui.inFlight.promise;
  assert.deepEqual(errors, []);
  return { dom, ui, calls, media, interval: () => interval(), errors };
}

test('queue hierarchy exposes usable contact links, separate scope/notes, page counts and no lead token', async () => {
  const fixture = createFixture();
  seed(fixture, 30);
  const { dom, ui } = await mount(fixture);
  try {
    const document = dom.window.document;
    const detail = document.getElementById('commercialQueueDetail');
    assert.match(detail.textContent, /Next action/);
    assert.match(detail.textContent, /Scope 1/);
    assert.match(detail.textContent, /Additional note 1/);
    assert.equal(detail.querySelector('a[href^="tel:"]').getAttribute('href'), 'tel:+15550000005');
    assert.equal(detail.querySelector('a[href^="mailto:"]').getAttribute('href'), 'mailto:fixture1@example.invalid');
    assert.doesNotMatch(detail.textContent, /Lead token|bearer-must-not-leak|Appointment link/);
    assert.match(document.getElementById('commercialQueueSummary').textContent, /On this page\s+25/);
    assert.match(document.getElementById('commercialQueueListMeta').textContent, /25 on this page of 30 matches/);
    await ui.goToPage(1);
    assert.equal(ui.state.items[0].leadId, id(26));
    await ui.goToPage(0);
    assert.equal(ui.state.items[0].leadId, id(1));
  } finally { dom.window.close(); }
});

test('pagination hides a single first page and an exhausted empty search without changing selection', async () => {
  const fixture = createFixture();
  seed(fixture, 3);
  const { dom, ui } = await mount(fixture);
  try {
    const footer = dom.window.document.getElementById('commercialQueuePagination');
    assert.equal(footer.hidden, true);
    assert.equal(footer.textContent, '');
    ui.selectLead(id(2));
    const selected = ui.state.selectedLeadId;
    ui.renderPagination();
    assert.equal(ui.state.selectedLeadId, selected);
    ui.state.query = 'no matching company';
    ui.resetSearch();
    await ui.refresh();
    assert.equal(ui.state.items.length, 0);
    assert.equal(footer.hidden, true);
    assert.equal(footer.textContent, '');
    assert.equal(footer.getAttribute('aria-busy'), 'false');
  } finally { dom.window.close(); }
});

test('pagination keeps stable compact controls, disables loading and restores focus without moving a refreshed list', async () => {
  const fixture = createFixture();
  seed(fixture, 30);
  const { dom, ui } = await mount(fixture);
  try {
    const w = dom.window, doc = w.document, footer = doc.getElementById('commercialQueuePagination');
    const previous = footer.querySelector('[data-page-direction="previous"]');
    const next = footer.querySelector('[data-page-direction="next"]');
    assert.equal(footer.hidden, false);
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, false);
    const gate = deferred(), fetch = w.fetch;
    w.fetch = async (...args) => { await gate.promise; return fetch(...args); };
    next.focus();
    const pending = ui.goToPage(1);
    assert.equal(footer.getAttribute('aria-busy'), 'true');
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, true);
    assert.equal(footer.querySelector('[data-page-status]').textContent, 'Loading...');
    assert.equal(footer.querySelector('[data-page-direction="next"]'), next);
    gate.resolve();
    await pending;
    assert.equal(ui.state.items[0].leadId, id(26));
    assert.equal(footer.hidden, false);
    assert.equal(footer.getAttribute('aria-busy'), 'false');
    assert.equal(previous.disabled, false);
    assert.equal(next.disabled, true);
    assert.equal(doc.activeElement, previous);
    assert.equal(footer.querySelector('[data-page-status]').textContent, 'Page 2');
    ui.selectLead(id(29));
    doc.getElementById('commercialQueueList').scrollTop = 55;
    previous.focus();
    const cursors = Array.from(ui.state.cursors);
    await ui.refresh({ silent: true });
    assert.equal(doc.activeElement, previous);
    assert.equal(doc.getElementById('commercialQueueList').scrollTop, 55);
    assert.equal(ui.state.selectedLeadId, id(29));
    assert.deepEqual(Array.from(ui.state.cursors), cursors);
    assert.equal(ui.state.filter, 'all');
    assert.equal(ui.state.query, '');
    await ui.goToPage(0);
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, false);
    assert.equal(doc.activeElement, next);
    assert.equal(footer.querySelector('[data-page-direction="previous"]'), previous);
  } finally { dom.window.close(); }
});

test('pagination preserves sparse filtered-search continuation across an empty first segment and previous history', async () => {
  const fixture = createFixture();
  seed(fixture, 1010);
  request(fixture, 1005, 'pending');
  const { dom, ui } = await mount(fixture);
  try {
    ui.state.filter = 'pending';
    ui.state.query = 'Fixture';
    ui.resetSearch();
    await ui.refresh();
    const footer = dom.window.document.getElementById('commercialQueuePagination');
    const previous = footer.querySelector('[data-page-direction="previous"]');
    const next = footer.querySelector('[data-page-direction="next"]');
    assert.equal(ui.state.items.length, 0);
    assert.equal(ui.state.pagination.scanLimitReached, true);
    assert.equal(footer.hidden, false);
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, false);
    assert.equal(next.textContent, 'Continue search');
    await ui.goToPage(1);
    assert.deepEqual(Array.from(ui.state.items, item => item.leadId), [id(1005)]);
    assert.equal(footer.hidden, false);
    assert.equal(previous.disabled, false);
    assert.equal(next.disabled, true);
    assert.equal(ui.state.filter, 'pending');
    assert.equal(ui.state.query, 'Fixture');
    await ui.goToPage(0);
    assert.equal(ui.state.items.length, 0);
    assert.equal(next.disabled, false);
    assert.equal(next.textContent, 'Continue search');
    assert.equal(ui.state.pagination.totalMatches, null);
  } finally { dom.window.close(); }
});

test('mobile Back to queue preserves query, filter, page, focus and scroll across refresh', async () => {
  const fixture = createFixture();
  seed(fixture, 30);
  const { dom, ui, media } = await mount(fixture);
  try {
    media.matches = true;
    const window = dom.window, document = window.document;
    ui.state.query = 'Fixture';
    document.getElementById('commercialQueueSearch').value = 'Fixture';
    await ui.refresh();
    await ui.goToPage(1);
    let scroll = 240;
    Object.defineProperty(window, 'scrollY', { get: () => scroll });
    window.scrollTo = options => { assert.equal(options.behavior, 'instant'); scroll = options.top; };
    document.getElementById('commercialQueueList').scrollTop = 55;
    ui.selectLead(id(28));
    assert.equal(document.getElementById('commercialqueue-pane').dataset.queueView, 'detail');
    assert.equal(document.activeElement.id, 'commercialQueueDetail');
    scroll = 0;
    await ui.refresh({ silent: true });
    ui.backToQueue();
    assert.equal(document.getElementById('commercialqueue-pane').dataset.queueView, 'list');
    assert.equal(scroll, 240);
    assert.equal(document.getElementById('commercialQueueList').scrollTop, 55);
    assert.equal(document.activeElement.dataset.leadId, id(28));
    assert.equal(ui.state.query, 'Fixture');
    assert.equal(ui.state.filter, 'all');
    assert.equal(ui.state.pageIndex, 1);
  } finally { dom.window.close(); }
});

test('detail hierarchy is action then Requested work then supporting rows, with diagnostics secondary', async () => {
  const fixture = createFixture();
  const leads = seed(fixture, 2);
  leads[0].contact_preference = 'email';
  request(fixture, 1, 'pending');
  const { dom, ui } = await mount(fixture);
  try {
    const detail = dom.window.document.getElementById('commercialQueueDetail');
    assert.deepEqual(Array.from(detail.querySelectorAll('h4'), element => element.textContent), ['Requested work', 'Details']);
    const next = detail.querySelector('.commercial-queue-next');
    assert.match(next.textContent, /Next action/);
    assert.ok(next.compareDocumentPosition(detail.querySelector('[aria-label="Requested work"]')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.match(next.textContent, /Prefers email/);
    assert.doesNotMatch(next.textContent, /first \(manual\)|not tracked here/);
    assert.equal(next.querySelector('a').getAttribute('href'), 'mailto:fixture1@example.invalid');
    assert.match(detail.querySelector('[aria-label="Requested work"]').textContent, /Scope 1.*Additional notes.*Additional note 1/s);
    assert.equal(detail.querySelectorAll('.commercial-queue-detail__card,.commercial-queue-detail__grid').length, 0);
    assert.ok(detail.querySelector('dl .commercial-queue-detail__field dt'));
    assert.equal(detail.querySelector('details').open, false);
    assert.equal(dom.window.document.getElementById('commercialQueueFilter').dataset.customSelect, 'off');
    assert.match(detail.querySelector('details').textContent, /Contact routing.*Email first \(manual\)/s);
    assert.match(detail.querySelector('[aria-label="Supporting information"]').textContent, /Viewing unavailable/);
    assert.equal(detail.querySelectorAll('input,textarea,[contenteditable]').length, 0);
    leads[0].notes = '';
    await ui.refresh();
    assert.equal(detail.querySelector('.commercial-queue-detail__notes'), null);
    assert.equal(Array.from(dom.window.document.querySelectorAll('#commercialqueue-pane button')).some(button => /^(Refresh|Reset)$/i.test(button.textContent.trim())), false);
  } finally { dom.window.close(); }
});

test('actionable status labels do not mistake provider acceptance or technician approval for a confirmed appointment', async () => {
  const fixture = createFixture();
  seed(fixture, 1);
  const { dom, ui } = await mount(fixture);
  try {
    const item = (status, patch = {}) => ({ consultation: { status, workflow: {}, ...patch }, contactPreference: 'sms' });
    assert.equal(ui.statusForItem({}), 'Saved draft - not submitted');
    assert.equal(ui.statusForItem({ ...item('pending'), followUp: { kind: 'manual_follow_up', requestedContactMethod: 'email' } }), 'Needs email follow-up');
    assert.equal(ui.statusForItem({ ...item('escalated'), followUp: { kind: 'manual_follow_up', requestedContactMethod: 'call' } }), 'Needs call follow-up');
    assert.equal(ui.statusForItem(item('pending')), 'Awaiting technician response');
    assert.equal(ui.statusForItem(item('escalated')), 'Management review needed');
    assert.equal(ui.statusForItem(item('reschedule_requested')), 'Review requested time');
    assert.equal(ui.statusForItem(item('approved')), 'Technician approved - appointment needs review');
    assert.equal(ui.statusForItem(item('customer_confirmed', { relatedOrderId: id(50), customerConfirmationSentAt: new Date().toISOString() })), 'Appointment created');
    assert.equal(ui.statusForItem(item('approved', { relatedOrderId: id(50) })), 'Appointment created - confirmation pending');
    assert.equal(ui.statusForItem(item('approved', { relatedOrderId: id(50), workflow: { customer_confirmation: { state: 'failed' } } })), 'Appointment created - confirmation failed');
    assert.equal(ui.statusForItem(item('approved', { relatedOrderId: id(50), workflow: { customer_confirmation: { state: 'uncertain' } } })), 'Appointment created - review confirmation');
    assert.equal(ui.statusForItem(item('declined', { workflow: { customer_decline: { state: 'failed' } } })), 'Technician declined - arrange a new time');
    assert.equal(ui.technicianResponseForItem(item('approved', { responseChannel: 'sms' })), 'Approved via SMS');
    assert.equal(ui.technicianResponseForItem(item('declined', { responseChannel: 'sms' })), 'Declined via SMS - alternate window required');
    assert.equal(ui.technicianResponseForItem(item('escalated')), 'No response recorded - escalated to management');
    assert.match(ui.confirmationForItem(item('approved')), /no appointment created/);
    assert.match(ui.confirmationForItem(item('approved', { relatedOrderId: id(50), customerConfirmationSentAt: new Date().toISOString() })), /acknowledgement unverified/);
    assert.equal(ui.statusForItem(item('pending', { workflow: { sms: { state: 'uncertain' } } })), 'Review notification attempt');
    assert.equal(ui.statusForItem(item('pending', { workflow: { sms: { state: 'failed' } } })), 'Notification needs review');
    assert.equal(ui.statusForItem(item('pending', { selectedSlotStart: '2000-01-01T00:00:00Z' })), 'Arrange a new time');
    assert.equal(ui.statusForItem(item('cancelled')), 'Request cancelled');
    assert.equal(ui.statusForItem(item('unknown')), 'Review request status');
  } finally { dom.window.close(); }
});

test('the rendered queue preserves technician decisions and processing results without claiming completed customer follow-up', async () => {
  const fixture = createFixture();
  const leads = seed(fixture, 1);
  leads[0].contact_preference = 'sms';
  const row = request(fixture, 1, 'declined', {
    response_channel: 'sms', response_at: new Date().toISOString(),
    metadata: { workflow: { customer_decline: { state: 'failed' } } },
  });
  const { dom, ui } = await mount(fixture);
  try {
    const detail = dom.window.document.getElementById('commercialQueueDetail');
    assert.match(detail.textContent, /Technician declined - arrange a new time/);
    assert.match(detail.textContent, /Declined via SMS/);
    assert.match(detail.querySelector('.commercial-queue-next').textContent, /Technician declined.*arrange another window.*provider rejected/s);
    assert.match(detail.textContent, /Technician approval does not complete customer follow-up/);
    Object.assign(row, { status: 'approved', related_order_id: id(50), metadata: { workflow: { customer_confirmation: { state: 'failed' } } } });
    await ui.refresh();
    assert.match(detail.textContent, /Approved via SMS/);
    assert.match(detail.textContent, /Appointment created - confirmation failed/);
    assert.match(detail.textContent, /Provider rejected or could not accept confirmation/);
    row.customer_confirmation_sent_at = new Date().toISOString();
    row.metadata.workflow.customer_confirmation.state = 'accepted';
    await ui.refresh();
    assert.match(detail.textContent, /SMS provider accepted; delivery and customer acknowledgement unverified/);
    assert.match(detail.textContent, /Technician approval does not complete customer follow-up/);
  } finally { dom.window.close(); }
});

test('automatic updates leave the search value, caret, selection and editable focus intact', async () => {
  const fixture = createFixture();
  seed(fixture, 2);
  const { dom, ui, calls, interval } = await mount(fixture);
  try {
    const input = dom.window.document.getElementById('commercialQueueSearch');
    input.value = ' Fixture ';
    input.focus();
    input.setSelectionRange(2, 5);
    input.dispatchEvent(new dom.window.Event('input'));
    ui.state.lastSuccessAt = 0;
    interval();
    assert.equal(calls.length, 1, 'Automatic refresh must wait for the active search debounce');
    await new Promise(resolve => setTimeout(resolve, 350));
    if (ui.inFlight) await ui.inFlight.promise;
    const selected = ui.state.selectedLeadId;
    ui.state.lastSuccessAt = 0;
    interval();
    await ui.inFlight.promise;
    assert.equal(input.value, ' Fixture ');
    assert.equal(input.selectionStart, 2);
    assert.equal(input.selectionEnd, 5);
    assert.equal(dom.window.document.activeElement, input);
    assert.equal(ui.state.selectedLeadId, selected);
  } finally { dom.window.close(); }
});

test('failed refresh keeps last good results and focus; Retry restores freshness', async () => {
  const fixture = createFixture();
  seed(fixture, 2);
  const { dom, ui } = await mount(fixture);
  try {
    const document = dom.window.document;
    const detail = document.getElementById('commercialQueueDetail');
    const link = detail.querySelector('a');
    const diagnostics = detail.querySelector('details');
    diagnostics.open = true;
    link.focus();
    const transport = dom.window.fetch;
    dom.window.fetch = async () => { throw new Error('Fixture offline'); };
    await ui.refresh({ silent: true });
    assert.equal(document.activeElement, link);
    assert.equal(detail.querySelector('details'), diagnostics);
    assert.equal(ui.state.items.length, 2);
    assert.match(document.getElementById('commercialQueueStatus').textContent, /Update failed; showing earlier data.*Fixture offline/);
    dom.window.fetch = transport;
    document.querySelector('#commercialQueueStatus button').click();
    await ui.inFlight.promise;
    assert.equal(document.getElementById('commercialQueueStatus').hidden, true);
    assert.equal(document.activeElement, link);
    assert.equal(diagnostics.open, true);
    fixture.tables.commercial_leads[0].notes = 'Updated note';
    await ui.refresh();
    assert.equal(detail.querySelector('details').open, true);
    assert.equal(document.activeElement.getAttribute('href'), link.getAttribute('href'));
    assert.match(detail.textContent, /Updated note/);
  } finally { dom.window.close(); }
});

test('concurrent refreshes deduplicate and superseded responses cannot replace a newer search', async () => {
  const fixture = createFixture();
  seed(fixture, 3);
  const { dom, ui } = await mount(fixture);
  try {
    const original = await fixture.queue(params());
    const old = deferred(), current = deferred();
    let calls = 0;
    dom.window.fetch = () => (++calls === 1 ? old.promise : current.promise);
    const first = ui.refresh();
    const duplicate = ui.refresh();
    assert.equal(calls, 1);
    ui.state.query = 'Company 3';
    ui.resetSearch();
    const latest = ui.refresh();
    assert.equal(calls, 2);
    current.resolve({ ok: true, json: async () => ({ ok: true, commercialQueue: await fixture.queue(params({ q: 'Company 3' })) }) });
    await latest;
    old.resolve({ ok: true, json: async () => ({ ok: true, commercialQueue: original }) });
    await Promise.all([first, duplicate]);
    assert.equal(ui.state.appliedQuery, 'Company 3');
    assert.equal(ui.state.items.length, 1);
    assert.equal(ui.state.items[0].leadId, id(3));
  } finally { dom.window.close(); }
});

test('a stalled queue request times out visibly and releases refresh deduplication for Retry', async () => {
  const fixture = createFixture();
  seed(fixture, 1);
  const { dom, ui } = await mount(fixture);
  try {
    let expire;
    const nativeTimeout = dom.window.setTimeout.bind(dom.window);
    dom.window.setTimeout = (callback, delay) => {
      if (delay === 20000) expire = callback;
      return nativeTimeout(callback, delay);
    };
    const transport = dom.window.fetch;
    dom.window.fetch = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Fixture aborted')), { once: true });
    });
    const pending = ui.refresh({ silent: true });
    expire();
    await pending;
    assert.equal(ui.state.loading, false);
    assert.equal(ui.inFlight, null);
    assert.equal(ui.state.items.length, 1);
    assert.match(ui.state.error, /timed out/);
    assert.match(dom.window.document.getElementById('commercialQueueStatus').textContent, /showing earlier data/);
    dom.window.fetch = transport;
    await ui.refresh();
    assert.equal(ui.state.error, '');
  } finally { dom.window.close(); }
});

test('search is debounced and failure labels earlier result scope rather than claiming new matches', async () => {
  const fixture = createFixture();
  seed(fixture, 3);
  const { dom, ui, calls } = await mount(fixture);
  try {
    const input = dom.window.document.getElementById('commercialQueueSearch');
    input.value = 'Company 3';
    input.dispatchEvent(new dom.window.Event('input'));
    input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(calls.length, 1);
    await new Promise(resolve => setTimeout(resolve, 350));
    if (ui.inFlight) await ui.inFlight.promise;
    assert.equal(calls.length, 2);
    assert.equal(ui.state.items[0].leadId, id(3));
    dom.window.fetch = async () => { throw new Error('Fixture search unavailable'); };
    input.value = 'New search';
    input.dispatchEvent(new dom.window.Event('input'));
    await new Promise(resolve => setTimeout(resolve, 350));
    await settle();
    assert.match(dom.window.document.getElementById('commercialQueueListMeta').textContent, /Company 3/);
    assert.match(dom.window.document.getElementById('commercialQueueStatus').textContent, /showing earlier data/);
    assert.ok(Array.from(dom.window.document.querySelectorAll('#commercialQueuePagination button')).every(button => button.disabled));
  } finally { dom.window.close(); }
});

test('empty results can repopulate and a disappeared selected intake is never silently replaced', async () => {
  const fixture = createFixture();
  seed(fixture, 2);
  const { dom, ui } = await mount(fixture);
  try {
    ui.selectLead(id(1));
    fixture.tables.commercial_leads.shift();
    await ui.refresh();
    assert.equal(ui.state.selectedLeadId, id(1));
    assert.match(dom.window.document.getElementById('commercialQueueDetail').textContent, /Selected lead is no longer/);
    fixture.tables.commercial_leads.length = 0;
    await ui.refresh();
    assert.equal(dom.window.document.querySelectorAll('.commercial-queue-row').length, 0);
    seed(fixture, 2);
    await ui.refresh();
    assert.equal(dom.window.document.querySelectorAll('.commercial-queue-row').length, 2);
  } finally { dom.window.close(); }
});
test('visible interval, stale focus and reconnect refresh; hidden and inactive views do not', async () => {
  const fixture = createFixture();
  seed(fixture, 1);
  const { dom, ui, calls, interval } = await mount(fixture);
  try {
    const pane = dom.window.document.getElementById('commercialqueue-pane');
    interval();
    assert.equal(calls.length, 1);
    ui.state.lastSuccessAt = 0;
    dom.window.document.visibilityState = 'hidden';
    interval();
    assert.equal(calls.length, 1);
    dom.window.document.visibilityState = 'visible';
    pane.classList.remove('active');
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    assert.equal(calls.length, 1);
    pane.classList.add('active');
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await ui.inFlight.promise;
    assert.equal(calls.length, 2);
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await ui.inFlight.promise;
    assert.equal(calls.length, 3);
    ui.state.lastSuccessAt = 0;
    interval();
    await ui.inFlight.promise;
    assert.equal(calls.length, 4);
  } finally { dom.window.close(); }
});

test('legacy backend is clearly limited and cannot imply complete server search', async () => {
  const fixture = createFixture();
  seed(fixture, 2);
  const { dom, ui } = await mount(fixture);
  try {
    dom.window.fetch = async () => ({ ok: true, json: async () => {
      const snapshot = await fixture.queue(params());
      delete snapshot.pagination;
      return { ok: true, commercialQueue: snapshot };
    } });
    await ui.refresh();
    assert.equal(ui.state.legacy, true);
    assert.match(dom.window.document.getElementById('commercialQueueStatus').textContent, /limited newest-25 snapshot, not a complete search/);
    assert.equal(dom.window.document.getElementById('commercialQueueSearch').disabled, true);
    assert.equal(dom.window.document.getElementById('commercialQueuePagination').textContent, '');
  } finally { dom.window.close(); }
});

test('legacy initial attention selection comes from visible results, not an excluded first record', async () => {
  const fixture = createFixture();
  seed(fixture, 2);
  request(fixture, 1, 'approved');
  request(fixture, 2, 'pending');
  const { dom, ui } = await mount(fixture);
  try {
    dom.window.fetch = async () => ({ ok: true, json: async () => {
      const snapshot = await fixture.queue(params());
      delete snapshot.pagination;
      return { ok: true, commercialQueue: snapshot };
    } });
    ui.state.filter = 'attention';
    ui.resetSearch();
    await ui.refresh();
    assert.equal(ui.state.selectedLeadId, id(2));
    assert.equal(dom.window.document.querySelectorAll('.commercial-queue-row').length, 1);
    assert.match(dom.window.document.getElementById('commercialQueueDetail').textContent, /Fixture Company 2/);
  } finally { dom.window.close(); }
});

test('fixture-only recovery deduplicates double clicks and refreshes after the mutation', async () => {
  const fixture = createFixture();
  seed(fixture, 1);
  request(fixture, 1, 'approved', { related_order_id: null });
  const { dom, ui } = await mount(fixture);
  try {
    const get = dom.window.fetch;
    const gate = deferred();
    let posts = 0;
    dom.window.fetch = (url, options) => {
      if (options.method === 'GET') return get(url, options);
      assert.match(url, /action=commercialRecovery$/);
      assert.equal(options.method, 'POST');
      posts++;
      return gate.promise;
    };
    const first = ui.retryProcessing(id(10000));
    const duplicate = ui.retryProcessing(id(10000));
    assert.equal(posts, 1);
    gate.resolve({ ok: true, json: async () => ({ ok: true }) });
    await Promise.all([first, duplicate]);
    assert.equal(ui.recoveryPending, false);
    assert.equal(ui.state.error, '');
  } finally { dom.window.close(); }
});
