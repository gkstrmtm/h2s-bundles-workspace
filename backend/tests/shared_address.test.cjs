const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const { createFixture } = require('./helpers/commercial_contact_fixture.cjs');
const { createResidentialFixture } = require('./helpers/residential_fixture.cjs');
const { createOperationsFixture, id } = require('./helpers/commercial_operations_fixture.cjs');
const frontend = path.resolve(__dirname, '..', '..', 'frontend');
const file = name => fs.readFileSync(path.join(frontend, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let count = 0; count < 300; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Expected fixture state did not settle');
}
function google(window) {
  class Widget extends window.HTMLElement {}
  window.customElements.define('gmp-place-autocomplete', Widget);
  window.google = { maps: { importLibrary: async () => ({ PlaceAutocompleteElement: Widget }) } };
  const component = (type, longText, shortText = longText) => ({ types: [type], longText, shortText });
  return widget => widget.dispatchEvent(Object.assign(new window.Event('gmp-select'), {
    placePrediction: { toPlace: () => ({ id: 'fixture-selected-place',
      addressComponents: [component('street_number', '200'), component('route', 'Selected Lane'),
        component('locality', 'Greenville'), component('administrative_area_level_1', 'South Carolina', 'SC'),
        component('postal_code', '29601')],
      fetchFields: async ({ fields }) => assert.deepEqual(Array.from(fields), ['id', 'addressComponents']),
    }) },
  }));
}

test('minimal residential contact persists without an address and leaves existing saved addresses available for owner reload', async t => {
  const f = await createResidentialFixture({ GOOGLE_MAPS_BROWSER_API_KEY: 'fixture-browser-key', RESIDENTIAL_SMS_ENABLED: 'false' }, { workspace: true, routing: true });
  t.after(() => f.close());
  const dom = new JSDOM(file('residential.html'), { url: 'http://localhost/residential', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const existing = await f.post('residential-intake', { publicToken: require('node:crypto').randomUUID(),
    submissionKey: require('node:crypto').randomUUID(), fullName: 'Saved Address Fixture', phone: '+15550000006',
    city: 'Taylors', serviceNeeds: ['TV Mounting'], smsOptIn: false,
    installationAddress: { street: '200 Selected Lane', unit: '4B', state: 'SC', postalCode: '29601', source: 'manual' } });
  assert.equal(existing.status, 201);
  const savedLead = (await f.db.query('select * from commercial_leads')).rows[0];
  const w = dom.window, form = w.document.getElementById('residential-form');
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w.crypto, 'subtle', { value: require('node:crypto').webcrypto.subtle });
  w.fetch = (input, options = {}) => {
    const url = new URL(input, w.location.href);
    if (url.pathname === '/api/residential-intake') return f.route('residential-intake')[options.method || 'GET'](new Request(url, options));
    assert.equal(url.pathname, '/api/owner-media/public');
    return Promise.resolve(Response.json({ ok: true, surface: 'residential', sections: {} }));
  };
  for (const name of ['media-placement-style.js', 'residential-media.js', 'residential.js']) w.eval(file(name));
  await until(() => !w.document.getElementById('residential-submit').disabled);
  assert.equal(w.document.getElementById('residential-address-details'), null);
  form.elements.fullName.value = 'Residential Address Fixture'; form.elements.phone.value = '+15550000005';
  form.querySelector('[name="service"]').checked = true;
  form.elements.city.value = 'Taylors'; form.elements.city.dispatchEvent(new w.Event('input', { bubbles: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => w.document.getElementById('residential-submit').textContent === 'Request received');
  const lead = (await f.db.query('select * from commercial_leads where phone=$1', ['+15550000005'])).rows[0];
  assert.equal(lead.project_address, null); assert.equal(lead.project_city, 'Taylors');
  assert.equal(lead.assessment_answers.installationAddress, undefined);
  assert.equal((await f.db.query('select project_address from commercial_leads where lead_id=$1',[savedLead.lead_id])).rows[0].project_address,'200 Selected Lane, Unit 4B');
  const request = (await f.db.query('select * from commercial_consultation_requests where lead_id=$1',[savedLead.lead_id])).rows[0];
  for (let reload = 0; reload < 2; reload++) {
    const review = await f.route('residential-review').GET(new Request('http://fixture.invalid/api/residential-review?token=' + request.response_token));
    assert.match((await review.json()).inquiry.address, /Unit 4B.*Taylors/);
  }
  assert.equal((await f.db.query('select * from commercial_reservations')).rows.length, 0);
  assert.equal(f.providerAttempts.length, 0);
});

test('manual-only commercial entry preserves existing values and unit when lookup is not configured', async t => {
  const dom = new JSDOM(file('commercial.html'), { url: 'http://localhost/commercial', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, form = w.document.getElementById('commercialIntakeForm');
  w.eval(file('address-autocomplete.js'));
  const controller = w.H2SAddressAutocomplete.create(form, {}, {
    fields: { street: 'projectAddress', unit: 'projectUnit', city: 'projectCity', state: 'projectState', postalCode: 'projectPostalCode' },
    holder: w.document.getElementById('commercial-address-search'), status: w.document.getElementById('commercial-address-status'),defer:true,
  });
  controller.restore({ street: '100 Manual Lane', unit: 'Suite 5', city: 'Greenville', state: 'SC', postalCode: '29601' });
  assert.doesNotMatch(w.document.getElementById('commercial-address-status').textContent,/unavailable/,'Deferred search waits for the Installation view');
  controller.activate();
  assert.match(w.document.getElementById('commercial-address-status').textContent, /unavailable/);
  assert.equal(controller.read().addressLine, '100 Manual Lane, Suite 5');
  assert.equal(controller.read().source, 'manual');
  assert.equal(form.elements.projectAddress.disabled, false);
  assert.equal(w.document.querySelector('gmp-place-autocomplete'), null);
});

test('commercial intake selection and manual correction persist through the actual form, API and reload without booking', async t => {
  const f = createFixture({ GOOGLE_MAPS_BROWSER_API_KEY: 'fixture-browser-key' });
  const response = await f.post('commercial-intake', { fullName: 'Address Fixture', companyName: 'Fixture Business',
    phone: '+15550000005', contactPreference: 'call', serviceNeeds: ['Security Cameras'], projectCity: 'Greenville',
    projectAddress: '100 Existing Lane', projectUnit: '4B' });
  assert.equal(response.status, 201);
  const lead = (await response.json()).lead;
  async function mount() {
    const dom = new JSDOM(file('commercial.html'), { url: 'http://localhost/commercial?lead=' + lead.publicToken,
      runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window, select = google(w), posts = [];
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
    w.fetch = async (input, options = {}) => {
      const url = new URL(input, w.location.href);
      if (url.pathname === '/api/commercial-intake') {
        if (options.method === 'POST') posts.push(JSON.parse(options.body));
        return f.route('commercial-intake')[options.method || 'GET'](new Request(url, options));
      }
      assert.ok(['/api/track', '/api/owner-media/public', '/api/proof-gallery'].includes(url.pathname));
      return Response.json({ ok: true, assets: [], items: [], photos: [] });
    };
    for (const name of ['commercial-labels.js', 'media-page-heroes.js', 'address-autocomplete.js', 'commercial.js']) w.eval(file(name));
    await until(() => w.document.querySelector('gmp-place-autocomplete'));
    await until(() => w.document.getElementById('projectUnit').value === '4B');
    return { w, select, posts };
  }
  const { w, select, posts } = await mount();
  select(w.document.querySelector('gmp-place-autocomplete')); await tick();
  assert.equal(w.document.getElementById('projectAddress').value, '200 Selected Lane');
  assert.equal(w.document.getElementById('projectUnit').value, '4B', 'Selection must not erase a separately entered unit');
  const draft = JSON.parse(w.localStorage.getItem('h2s_commercial_draft'));
  assert.equal(draft.payload.assessmentAnswers.installationAddress.placeId, 'fixture-selected-place');
  w.document.getElementById('fullName').dispatchEvent(new w.Event('blur'));
  await until(() => f.tables.commercial_leads[0].project_address === '200 Selected Lane, Unit 4B');
  assert.equal(f.tables.commercial_leads[0].assessment_answers.installationAddress.source, 'google_places');
  const city = w.document.getElementById('projectCity');
  city.value = 'Taylors'; city.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(JSON.parse(w.localStorage.getItem('h2s_commercial_draft')).payload.assessmentAnswers.installationAddress.source, 'manual');
  w.document.getElementById('fullName').dispatchEvent(new w.Event('blur'));
  await until(() => f.tables.commercial_leads[0].project_city === 'Taylors');
  assert.equal(posts.at(-1).assessmentAnswers.installationAddress.placeId, undefined);
  const reopened = await mount();
  assert.equal(reopened.w.document.getElementById('projectAddress').value, '200 Selected Lane');
  assert.equal(reopened.w.document.getElementById('projectCity').value, 'Taylors');
  assert.equal(f.tables.commercial_consultation_requests.length, 0);
  assert.equal(f.appointments.length, 0); assert.equal(f.sms.length, 0);
  const cityOnly = await f.post('commercial-intake', { fullName: 'City Only Fixture', phone: '+15550000006',
    contactPreference: 'call', projectCity: 'Greenville', projectUnit: '' });
  assert.equal(cityOnly.status, 201);
});

for (const market of ['commercial', 'residential']) {
  test(`${market} staff location search saves/reopens a separate unit and leaves the linked job address unchanged`, async t => {
    const f = await createOperationsFixture({ GOOGLE_MAPS_BROWSER_API_KEY: 'fixture-browser-key' });
    t.after(() => f.db.close());
    await f.db.exec(`alter table commercial_leads add column assessment_answers jsonb default '{}';`);
    await f.db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '040_residential_address_guards.sql'), 'utf8'));
    await f.db.query(`update commercial_leads set project_address='100 Saved Lane, Unit 4B', attribution=$1,
      assessment_answers='{"installationAddress":{"source":"google_places","placeId":"old-place"}}' where lead_id=$2`,
    [JSON.stringify({ market }), id(1)]);
    const linked = await f.request('POST', { leadId: id(1), action: 'link', revision: 0, operationId: id(700),
      payload: { orderId: id(100), jobId: id(101) } });
    assert.equal(linked.status, 200, await linked.clone().text());
    const original = (await f.db.query('select address,city,state,zip from h2s_orders where id=$1', [id(100)])).rows[0];
    const dom = new JSDOM('<section></section>', { url: 'http://fixture.invalid/dash.html',
      runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window, host = w.document.querySelector('section'), select = google(w), posts = [];
    w.scrollTo = () => {};
    w.fetch = async (url, options) => {
      if (options.method === 'POST') posts.push(JSON.parse(options.body));
      return f.route[options.method](new Request(url, options));
    };
    w.eval(file('address-autocomplete.js')); w.eval(file('commercial-operations.js'));
    await w.H2SCommercialOperations.mount(host, id(1), { apiBase: 'http://fixture.invalid', getToken: () => 'fixture-admin' });
    const form = host.querySelector('[data-action="location"]');
    assert.equal(form.elements.address.value, '100 Saved Lane'); assert.equal(form.elements.unit.value, '4B');
    host.querySelector('[data-operations-view-choice="installation"]').click();
    assert.equal(host.querySelector('gmp-place-autocomplete'),null,'Hidden work-location editor does not load search');
    host.querySelector('[data-location-toggle]').click();
    await until(() => host.querySelector('gmp-place-autocomplete'));
    select(host.querySelector('gmp-place-autocomplete')); await tick();
    form.elements.unit.value = '5C'; form.elements.unit.dispatchEvent(new w.Event('input', { bubbles: true }));
    form.elements.city.value = 'Taylors'; form.elements.city.dispatchEvent(new w.Event('input', { bubbles: true }));
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => host.querySelector('[data-operations-status]').textContent.startsWith('Saved.'));
    assert.equal(posts[0].payload.applyToJob, undefined);
    const reopened = host.querySelector('[data-action="location"]');
    assert.equal(reopened.elements.address.value, '200 Selected Lane');
    assert.equal(reopened.elements.unit.value, '5C'); assert.equal(reopened.elements.city.value, 'Taylors');
    assert.deepEqual((await f.db.query('select address,city,state,zip from h2s_orders where id=$1', [id(100)])).rows[0], original);
    const saved = (await f.db.query('select assessment_answers from commercial_leads where lead_id=$1', [id(1)])).rows[0];
    assert.equal(saved.assessment_answers.installationAddress.source, 'manual');
    assert.equal(saved.assessment_answers.installationAddress.placeId, null);
    assert.equal(f.calls.mail.length, 0);
    reopened.elements.unit.value = '6D';
    reopened.elements.applyToJob.checked = true;
    reopened.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => posts.length === 2 && host.querySelector('[data-operations-status]').textContent.startsWith('Saved.'));
    assert.equal(posts[1].payload.applyToJob, true);
    const applied = (await f.db.query('select address,city from h2s_orders where id=$1', [id(100)])).rows[0];
    assert.equal(applied.address, '200 Selected Lane, Unit 6D'); assert.equal(applied.city, 'Taylors');
  });
}
