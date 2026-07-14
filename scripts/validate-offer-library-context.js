/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dashJsPath = path.join(__dirname, '..', 'frontend', 'dash.js');
const dashJs = fs.readFileSync(dashJsPath, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function expectMatch(pattern, source, message) {
  assert(pattern.test(source), message);
}

function extractBetween(startMarker, endMarker, label) {
  const start = dashJs.indexOf(startMarker);
  assert(start >= 0, `Missing start marker for ${label}`);
  const from = start + startMarker.length;
  const end = dashJs.indexOf(endMarker, from);
  assert(end >= 0, `Missing end marker for ${label}`);
  return dashJs.slice(from, end).replace(/\r?\n\s*\},\s*$/, '');
}

function withGlobals(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
    globalThis[key] = value;
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = value;
      }
    }
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function createHarness(config = {}) {
  const getState = new Function('offerId', extractBetween(
    '_getOfferLibraryContextState(offerId) {',
    '            _setOfferLibraryContextState(offerId, nextState = {}) {',
    '_getOfferLibraryContextState'
  ));
  const setState = new Function('offerId', 'nextState', extractBetween(
    '_setOfferLibraryContextState(offerId, nextState = {}) {',
    '            _renderOfferLibraryStateCard(opts = {}) {',
    '_setOfferLibraryContextState'
  ));
  const queueContextFetch = new AsyncFunction('offerId', 'opts', extractBetween(
    'async _queueOfferLibraryContextFetch(offerId, opts = {}) {',
    '            _hasOfferLibraryAuth() {',
    '_queueOfferLibraryContextFetch'
  ));

  const fetchCalls = [];

  const builder = {
    _offerLibraryDeliverablesByOffer: new Map(),
    _offerLibraryCreativesByOffer: new Map(),
    _offerLibraryCreativeLinksByOffer: new Map(),
    _offerLibraryContextStateByOffer: new Map(),
    _safeTrim(value) {
      return String(value == null ? '' : value).trim();
    },
    _getOfferLibraryContextState(offerId) {
      return getState.call(this, offerId);
    },
    _setOfferLibraryContextState(offerId, nextState = {}) {
      return setState.call(this, offerId, nextState);
    },
    _hasOfferLibraryAuth() {
      return !!config.hasAuth;
    },
    _renderOfferLibraryFromCache() {
      this._renderCalls = (this._renderCalls || 0) + 1;
    },
    _rerenderOfferLibraryModuleModalIfOpen() {
      this._modalRenderCalls = (this._modalRenderCalls || 0) + 1;
    }
  };

  return {
    builder,
    fetchCalls,
    async run(offerId = 'offer-123', opts = {}) {
      return withGlobals({
        API_URL: 'https://example.test/api/v1',
        safeParseJSONLenient: (value, fallback) => {
          try {
            return JSON.parse(value);
          } catch (_) {
            return fallback;
          }
        },
        fetch: async (url) => {
          fetchCalls.push(url);
          if (typeof config.fetchImpl === 'function') {
            return config.fetchImpl(url);
          }
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true })
          };
        }
      }, async () => queueContextFetch.call(builder, offerId, opts));
    }
  };
}

async function testSuccessfulFetchPreservesReadyState() {
  const harness = createHarness({
    hasAuth: true,
    fetchImpl: async (url) => {
      if (url.includes('action=deliverables')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, deliverables: [{ Deliverable_ID: 'd1' }] })
        };
      }
      if (url.includes('action=adCreatives')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, creatives: [{ creative_id: 'c1', title: 'Creative One' }] })
        };
      }
      if (url.includes('action=adCreativeLinks')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, links: [{ creative_id: 'c1', resource_id: 'r1' }] })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  await harness.run('offer-ready');

  const state = harness.builder._getOfferLibraryContextState('offer-ready');
  assert.equal(state.deliverables.status, 'ready', 'Deliverables should end in ready state');
  assert.equal(state.creatives.status, 'ready', 'Creatives should end in ready state');
  assert.equal(state.links.status, 'ready', 'Creative links should end in ready state');
  assert.equal(harness.builder._offerLibraryDeliverablesByOffer.get('offer-ready').length, 1, 'Deliverable rows should be stored');
  assert.equal(harness.builder._offerLibraryCreativesByOffer.get('offer-ready').length, 1, 'Creative rows should be stored');
  assert.equal(harness.builder._offerLibraryCreativeLinksByOffer.get('offer-ready').length, 1, 'Creative link rows should be stored');
}

async function testDeliverableFailureIsNotCollapsedIntoEmptyState() {
  const harness = createHarness({
    hasAuth: true,
    fetchImpl: async (url) => {
      if (url.includes('action=deliverables')) {
        throw new Error('deliverables unavailable');
      }
      if (url.includes('action=adCreatives')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, creatives: [] })
        };
      }
      if (url.includes('action=adCreativeLinks')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, links: [] })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  await harness.run('offer-error');

  const state = harness.builder._getOfferLibraryContextState('offer-error');
  assert.equal(state.deliverables.status, 'error', 'Deliverables failure must remain an error state');
  assert.match(state.deliverables.error, /deliverables unavailable/i, 'Deliverables error message should be preserved');
  assert.equal(state.creatives.status, 'ready', 'Other context fetches should still resolve independently');
  assert.equal(state.links.status, 'ready', 'Other context fetches should still resolve independently');
}

async function testAuthlessCreativeFetchesStayExplicit() {
  const harness = createHarness({
    hasAuth: false,
    fetchImpl: async (url) => {
      if (url.includes('action=deliverables')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, deliverables: [] })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  await harness.run('offer-authless');

  const state = harness.builder._getOfferLibraryContextState('offer-authless');
  assert.equal(state.deliverables.status, 'ready', 'Deliverables should still load without auth');
  assert.equal(state.creatives.status, 'auth', 'Creatives should keep an auth-required state when auth is missing');
  assert.equal(state.links.status, 'auth', 'Creative links should keep an auth-required state when auth is missing');
  assert.equal(harness.fetchCalls.length, 1, 'Authless context fetch should skip creative endpoints entirely');
}

function testRequiredRenderStringsPresent() {
  expectMatch(/Offer-Scoped Deliverables/, dashJs, 'Offer detail should render a deliverables section');
  expectMatch(/Ad Creatives and Resources/, dashJs, 'Offer detail should render a creatives/resources section');
  expectMatch(/Couldn't load offer deliverables\./, dashJs, 'Deliverable errors should be explicit in the detail pane');
  expectMatch(/Couldn't load ad creatives and resources\./, dashJs, 'Creative/resource errors should be explicit in the detail pane');
  expectMatch(/No offer is selected because the current filters returned nothing\./, dashJs, 'No-match state should clear the detail pane with explicit copy');
  expectMatch(/Couldn't load Offer Library\./, dashJs, 'Offer Library load failures should render an explicit retry state');
}

async function main() {
  testRequiredRenderStringsPresent();
  await testSuccessfulFetchPreservesReadyState();
  await testDeliverableFailureIsNotCollapsedIntoEmptyState();
  await testAuthlessCreativeFetchesStayExplicit();
  console.log('PASS validate-offer-library-context');
}

main().catch((error) => {
  console.error('FAIL validate-offer-library-context');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});