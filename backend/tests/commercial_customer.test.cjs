const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const { createFixture } = require('./helpers/commercial_contact_fixture.cjs');

const frontend = path.resolve(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(frontend, 'commercial.html'), 'utf8');
const css = fs.readFileSync(path.join(frontend, 'commercial.css'), 'utf8');
const source = fs.readFileSync(path.join(frontend, 'commercial.js'), 'utf8');
const ast = ts.createSourceFile('commercial.js', source, ts.ScriptTarget.Latest, true);
const functions = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && (
    /^commercial.*CustomSelect|^commercialGetSelectLabel$|^ensureCommercialCustomSelectBindings$/.test(node.name?.text)
    || ['byId', 'setText', 'showContactError', 'commercialSubmissionCopy', 'renderSubmission',
      'syncFollowUpCopy', 'getFollowUpCopy', 'businessTypeLabel', 'humanizeToken'].includes(node.name?.text))) {
    functions.push(node.getText(ast));
  } else ts.forEachChild(node, visit);
}
visit(ast);
function setup(t) {
  const dom = new JSDOM(html, { url: 'http://fixture.invalid/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  const style = w.document.createElement('style');
  style.textContent = css;
  w.document.head.appendChild(style);
  w.eval(`let commercialCustomSelectBound = false, commercialCustomSelectSyncQueued = false, commercialCustomSelectIdCounter = 0;
    const state = { currentStep: 1, submission: null, lead: null, submitting: false };
    function showStep(step) { state.currentStep = step; }
    function setStatus(message) { document.getElementById('formStatus').textContent = message; }
    ${functions.join('\n')}
    window.testState = state;`);
  w.commercialSyncAllCustomSelects(w.document);
  return w;
}
const ids = ['businessType', 'timeline', 'budgetBand', 'contactPreference', 'decisionMaker', 'existingSystem', 'securityIncident'];

test('every Commercial dropdown cancels label activation, synchronizes once and retains focus', async t => {
  for (const id of ids) await t.test(id, t => {
    const w = setup(t), select = w.document.getElementById(id), shell = select.nextElementSibling;
    const trigger = shell.querySelector('.commercial-custom-select-trigger');
    const events = { click: 0, focus: 0, input: 0, change: 0 };
    for (const type of Object.keys(events)) select.addEventListener(type, () => events[type]++);
    assert.equal(w.getComputedStyle(select).display, 'none');
    assert.equal(select.tabIndex, -1);
    const labelClick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    select.closest('label').querySelector('span').dispatchEvent(labelClick);
    assert.equal(labelClick.defaultPrevented, true);
    assert.equal(w.document.activeElement, trigger);
    trigger.click();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const focused = w.document.activeElement;
    w.commercialSyncAllCustomSelects(w.document);
    assert.equal(w.document.activeElement, focused, 'Unchanged synchronization must not destroy the active option');
    const option = Array.from(shell.querySelectorAll('[role=option]')).find(option => option.dataset.value !== select.value && !option.disabled);
    assert.ok(option);
    const value = option.dataset.value, text = option.textContent;
    const selection = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    option.dispatchEvent(selection);
    assert.equal(selection.defaultPrevented, true, 'Cancel default before synchronous option replacement');
    assert.equal(select.value, value);
    assert.equal(trigger.textContent, text);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(w.document.activeElement, trigger);
    assert.deepEqual(events, { click: 0, focus: 0, input: 1, change: 1 });
    trigger.click();
    shell.querySelector('[role=option].is-selected').click();
    assert.deepEqual(events, { click: 0, focus: 0, input: 1, change: 1 });
  });
});

test('Commercial dropdown keyboard, dismissal, disabled and explicit native controls remain usable', t => {
  const w = setup(t), select = w.document.getElementById('businessType'), shell = select.nextElementSibling;
  const trigger = shell.querySelector('button');
  const key = value => w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  trigger.focus(); key('ArrowDown'); key('End');
  assert.equal(w.document.activeElement.dataset.value, 'other');
  key('Home'); assert.equal(w.document.activeElement.dataset.value, '');
  key('Escape'); assert.equal(w.document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click(); key('Tab');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click(); w.document.body.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  select.options[1].disabled = true;
  w.commercialSyncCustomSelect(select);
  assert.equal(shell.querySelector('[data-value=office]').disabled, true);
  select.disabled = true; w.commercialSyncCustomSelect(select);
  assert.equal(trigger.disabled, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  for (const attributes of ['data-custom-select="off"', 'multiple', 'size="3"']) {
    const holder = w.document.createElement('label');
    holder.innerHTML = `<span>Native</span><select ${attributes}><option>Native option</option></select>`;
    w.document.body.appendChild(holder);
    const field = holder.querySelector('select');
    w.commercialSyncCustomSelect(field);
    assert.equal(w.commercialGetCustomSelectShell(field), null);
    const click = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    holder.querySelector('span').dispatchEvent(click);
    assert.equal(click.defaultPrevented, false);
    assert.equal(field.getAttribute('aria-hidden'), null);
  }
  const file = w.document.getElementById('projectPhotosInput');
  assert.equal(file.type, 'file');
  const fileClick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  file.dispatchEvent(fileClick);
  assert.equal(fileClick.defaultPrevented, false);
});

test('validation and accessible descriptions focus the visible Commercial trigger, not the hidden select', t => {
  const w = setup(t), select = w.document.getElementById('businessType');
  select.required = true;
  select.setAttribute('aria-label', 'Business property type');
  select.setAttribute('aria-labelledby', 'propertyHeading');
  w.testState.currentStep = 5;
  assert.equal(select.reportValidity(), false);
  const trigger = select.nextElementSibling.querySelector('button');
  assert.equal(w.testState.currentStep, 1);
  assert.equal(w.document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-invalid'), 'true');
  assert.equal(trigger.getAttribute('aria-required'), 'true');
  assert.equal(trigger.getAttribute('aria-describedby'), 'formStatus');
  assert.equal(trigger.getAttribute('aria-label'), 'Business property type');
  assert.equal(trigger.getAttribute('aria-labelledby'), 'propertyHeading');
  assert.ok(w.document.getElementById('formStatus').textContent);
  select.value = 'retail'; select.removeAttribute('aria-invalid');
  w.commercialSyncCustomSelect(select);
  assert.equal(select.checkValidity(), true);
  assert.equal(trigger.hasAttribute('aria-invalid'), false);
});

test('plain business labels preserve option values and the displayed saved selection', t => {
  const w = setup(t), select = w.document.getElementById('businessType');
  const labels = { retail: 'Retail / store', church: 'Church / place of worship',
    hospitality: 'Hotel / hospitality', multifamily: 'Apartments / property management' };
  assert.deepEqual(Array.from(select.options, option => option.value), ['', 'office', 'retail', 'church', 'hospitality', 'multifamily', 'warehouse', 'other']);
  for (const [value, label] of Object.entries(labels)) {
    select.value = value; w.commercialSyncCustomSelect(select);
    assert.equal(select.nextElementSibling.querySelector('button').textContent, label);
    assert.equal(w.businessTypeLabel(value, ''), label);
  }
  assert.equal(w.businessTypeLabel('', 'Not added yet'), 'Not added yet');
});

const now = Date.parse('2030-06-01T10:00:00Z');
function request(patch = {}) {
  return { status: 'pending', selectedSlotStart: '2030-06-01T10:05:00Z',
    selectedSlotEnd: '2030-06-01T11:00:00Z', metadata: { contact_preference: 'sms' }, ...patch };
}
test('receipt uses saved preference, not an unsaved custom-dropdown choice', t => {
  const w = setup(t), record = request({ metadata: { request_kind: 'manual_follow_up', contact_preference: 'email' } });
  w.document.getElementById('contactPreference').value = 'sms';
  w.testState.lead = { contactPreference: 'email' };
  w.renderSubmission(record);
  assert.match(w.document.getElementById('successCopy').textContent, /We'll follow up by email/);
  assert.match(w.commercialSubmissionCopy(record, null, now).copy, /We'll follow up by email/);
  assert.match(w.commercialSubmissionCopy(record, { contactPreference: 'call' }, now).copy, /staff member will call/);
  const text = w.commercialSubmissionCopy(request(), { contactPreference: 'sms' }, now);
  assert.match(text.copy, /Check your texts/);
  assert.doesNotMatch(text.copy, /(?:text|message) (?:was |is )?delivered|appointment (?:is )?confirmed\b/i);
  assert.equal(w.document.getElementById('consultationSuccessPanel').classList.contains('hidden'), false);
  assert.equal(w.document.getElementById('requestConsultationBtn').disabled, true);
  assert.equal(w.document.getElementById('clearDraftBtn').textContent, 'Start a separate project');
});

test('receipt proximity and expired windows never invent acceptance, contact or appointments', t => {
  const w = setup(t);
  for (const time of [now, now + 5 * 60000, now + 59 * 60000]) {
    assert.match(w.commercialSubmissionCopy(request(), null, time).status, /awaiting technician review.*No appointment is confirmed/);
  }
  const expired = w.commercialSubmissionCopy(request(), null, now + 60 * 60000);
  assert.match(expired.status, /window has passed.*Staff follow-up is needed/);
  assert.match(expired.copy, /does not mean the request was accepted/);
  const invalid = w.commercialSubmissionCopy(request({ selectedSlotStart: 'bad', selectedSlotEnd: 'bad' }), null, now);
  assert.match(invalid.status, /awaiting technician review/);
  for (const status of ['declined', 'escalated', 'reschedule_requested', 'expired']) {
    const receipt = w.commercialSubmissionCopy(request({ status }), null, now);
    assert.match(receipt.status, /(?:review|follow-up)/);
    assert.doesNotMatch(receipt.status, /Appointment created/);
  }
});

test('receipt separates technician approval, recorded appointments and communication evidence', t => {
  const w = setup(t);
  assert.match(w.commercialSubmissionCopy(request({ status: 'approved' }), null, now).status, /booking still needs review.*No appointment is confirmed/);
  const booked = request({ status: 'approved', relatedOrderId: 'fixture-appointment' });
  assert.match(w.commercialSubmissionCopy(booked, null, now).copy, /appointment is recorded.*delivery and customer acknowledgement are not confirmed/);
  for (const state of ['processing', 'uncertain', 'failed', 'accepted']) {
    const record = { ...booked, metadata: { contact_preference: 'sms', workflow: { customer_confirmation: { state, details: { error: 'PRIVATE_PROVIDER_DETAIL' } } } } };
    const receipt = w.commercialSubmissionCopy(record, null, now);
    assert.match(receipt.status, /Appointment created/);
    assert.doesNotMatch(receipt.copy, /PRIVATE_PROVIDER_DETAIL/);
    assert.match(receipt.copy, state === 'accepted' ? /provider accepted.*not confirmed/
      : state === 'failed' ? /could not be sent.*Staff follow-up/
      : /needs staff review.*not confirmed/);
  }
  const accepted = w.commercialSubmissionCopy({ ...booked, customerConfirmationSentAt: '2030-06-01T09:00:00Z' }, null, now);
  assert.match(accepted.copy, /provider accepted.*delivery and customer acknowledgement are not confirmed/);
});

test('Commercial footer owns an opaque matching bottom background and safe-area space, not browser chrome', () => {
  assert.match(html, /<html[^>]+class="commercial-page"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /html\.commercial-page\s*\{[^}]*background-color:\s*var\(--commercial-footer-bottom\)/);
  assert.match(css, /\.commercial-page body\.commercial-body\s*\{[^}]*background-color:\s*var\(--commercial-footer-bottom\)/);
  assert.match(css, /linear-gradient\(180deg,[^\n]+var\(--commercial-footer-bottom\) 100%\)/);
  assert.match(css, /padding-bottom:\s*calc\(28px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.doesNotMatch(css, /overscroll-behavior(?:-y)?:\s*none/);
});

test('token-authorized reload preserves resolved receipts without changing the active submission guard', async () => {
  const fixture = createFixture();
  const saved = await fixture.post('commercial-intake', { fullName: 'Receipt Fixture', companyName: 'Fixture Store',
    email: 'receipt@example.invalid', contactPreference: 'email', serviceNeeds: ['Security Cameras'] });
  assert.equal(saved.status, 201);
  const lead = (await saved.json()).lead;
  const submitted = await fixture.post('commercial-consultation', { publicToken: lead.publicToken });
  assert.equal(submitted.status, 201);
  const request = fixture.tables.commercial_consultation_requests[0];
  const before = { sends: fixture.sms.length, appointments: fixture.appointments.length };
  for (const status of ['declined', 'expired', 'pending', 'escalated']) {
    request.status = status;
    const response = await fixture.route('commercial-intake').GET(new Request(`http://fixture.invalid/api/commercial-intake?token=${lead.publicToken}`));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.submission.requestId, request.request_id);
    assert.equal(payload.submission.status, status);
    const active = await fixture.runtime.findActiveConsultationForLead(request.lead_id);
    assert.equal(!!active, ['pending', 'escalated'].includes(status));
  }
  const unrelated = await fixture.route('commercial-intake').GET(new Request('http://fixture.invalid/api/commercial-intake?token=unrelated-token'));
  assert.equal((await unrelated.json()).submission, null);
  assert.deepEqual({ sends: fixture.sms.length, appointments: fixture.appointments.length }, before);
});
