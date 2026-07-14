/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { webcrypto } = require('crypto');

const dashJsPath = path.join(__dirname, '..', 'frontend', 'dash.js');
const dashJs = fs.readFileSync(dashJsPath, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const OFFER_STORAGE_KEY = 'h2s_offer_builder_offers_v1';

function expectMatch(pattern, source, message) {
  assert(pattern.test(source), message);
}

function extractByRegex(regex, label) {
  const match = dashJs.match(regex);
  assert(match && match[1], `Missing method body for ${label}`);
  return match[1];
}

class MemoryStorage {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(String(key), String(value));
  }

  removeItem(key) {
    this.store.delete(String(key));
  }

  clear() {
    this.store.clear();
  }
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

function parseSavedOffers(storage) {
  return JSON.parse(storage.getItem(OFFER_STORAGE_KEY) || '[]');
}

async function withMutedConsole(fn) {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

function createHarness(config = {}) {
  const toastCalls = [];
  const fetchCalls = [];
  const trackCalls = [];
  const storage = new MemoryStorage(config.storage || {});

  const uuidv4 = new Function(extractByRegex(/_uuidv4\(\) \{([\s\S]*?)\r?\n\s*\},\r?\n\r?\n\s*ensureOfferId\(\) \{/, '_uuidv4'));
  const ensureOfferId = new Function(extractByRegex(/ensureOfferId\(\) \{([\s\S]*?)\r?\n\s*\},\r?\n\r?\n\s*_draftStorageKey\(\) \{/, 'ensureOfferId'));
  const saveOffer = new AsyncFunction('opts', extractByRegex(/async saveOffer\(opts = \{\}\) \{([\s\S]*?)\r?\n\s*\},\r?\n\s*\r?\n\s*async markReady\(\) \{/, 'saveOffer'));

  const builder = {
    offer: {
      name: 'Save Loop Offer',
      lineItems: [{ service: 'TV Mounting' }],
      offerFrameworks: null,
      ...(config.offer || {})
    },
    offerLibraryState: { ...(config.offerLibraryState || {}) },
    _afterNextSaveReturnToLibrary: !!config.startedFromLibraryCreate,
    _afterNextSaveSelectOfferId: config.afterNextSaveSelectOfferId || '',
    validateOffer() {
      return Array.isArray(config.warnings) ? config.warnings.slice() : [];
    },
    _safeTrim(value) {
      return String(value || '').trim();
    },
    _computeOfferNameFallback() {
      return 'Fallback Offer';
    },
    _isWeakOfferTitle() {
      return false;
    },
    async suggestOfferTitle() {
      this._suggestOfferTitleCalls = (this._suggestOfferTitleCalls || 0) + 1;
    },
    applyDirectPriceIfPresent() {},
    calculateTotals() {
      return { finalCustomerPrice: 1200, profit: 500, margin: 41.67 };
    },
    evaluateStandards() {
      return { status: 'Up to Standard', score: 94, hardFails: [] };
    },
    _uuidv4() {
      return uuidv4.call(this);
    },
    ensureOfferId() {
      return ensureOfferId.call(this);
    },
    _markOfferAsServerKnown() {
      this._serverKnown = true;
    },
    setActiveOffer(offerId, offerName) {
      this._activeOffer = { offerId, offerName };
      this.offerLibraryState = this.offerLibraryState || {};
      this.offerLibraryState.selectedId = offerId;
    },
    _extractFrameworks(row) {
      return row && row.AI_Analysis ? row.AI_Analysis : null;
    },
    _hasFrameworksSnapshot(frameworks) {
      if (!frameworks || typeof frameworks !== 'object') return false;
      if (Array.isArray(frameworks)) return frameworks.length > 0;
      return Object.keys(frameworks).length > 0;
    },
    async generateOfferFrameworks() {
      this._generateFrameworkCalls = (this._generateFrameworkCalls || 0) + 1;
      this.offer.offerFrameworks = { angles: [{ title: 'Angle A' }] };
    },
    async refreshOfferLibrary() {
      this._refreshOfferLibraryCalls = (this._refreshOfferLibraryCalls || 0) + 1;
    },
    setSubTab(tab) {
      this._subTab = tab;
    }
  };

  return {
    builder,
    storage,
    toastCalls,
    fetchCalls,
    trackCalls,
    async runSave(opts = {}) {
      return withGlobals({
        API_URL: 'https://example.test/api/v1',
        currentUser: 'ROSEL',
        crypto: webcrypto,
        localStorage: storage,
        showConfirm: async () => true,
        showToast: (message, type) => {
          toastCalls.push({ message: String(message), type: String(type) });
        },
        trackEvent: async (...args) => {
          trackCalls.push(args);
          if (config.trackEventThrows) throw new Error('tracking failed');
        },
        fetch: async (url, init) => {
          fetchCalls.push({ url, init });
          if (typeof config.fetchImpl === 'function') {
            return config.fetchImpl(url, init);
          }
          return {
            ok: true,
            json: async () => ({ ok: true, saveOffer: { Offer_ID: builder.offer.offer_id || 'server-offer-id', AI_Analysis: null } })
          };
        }
      }, async () => saveOffer.call(builder, opts));
    }
  };
}

async function testNewOfferSaveReconcilesCanonicalId() {
  const harness = createHarness({
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body);
      assert.match(payload.offerData.offer_id, /^[0-9a-f-]{36}$/i, 'New offer must carry a generated offer_id in the first save payload');
      return {
        ok: true,
        json: async () => ({ ok: true, saveOffer: { Offer_ID: 'backend-offer-123', AI_Analysis: null } })
      };
    }
  });

  const result = await harness.runSave();
  const saved = parseSavedOffers(harness.storage);

  assert.equal(result.ok, true, 'New-offer save should report backend success');
  assert.equal(result.backendSaveStatus, 'saved', 'New-offer save should report saved backend status');
  assert.equal(result.offerId, 'backend-offer-123', 'Result should expose the reconciled backend offer ID');
  assert.equal(harness.builder.offer.offer_id, 'backend-offer-123', 'Builder offer should reconcile to the backend offer ID');
  assert.deepStrictEqual(harness.builder._activeOffer, { offerId: 'backend-offer-123', offerName: 'Save Loop Offer' }, 'Active-offer state should reconcile to the backend offer ID');
  assert.equal(harness.builder.offerLibraryState.selectedId, 'backend-offer-123', 'Offer Library selection should reconcile to the backend offer ID');
  assert.equal(saved.length, 1, 'New-offer save should persist exactly one local cache row');
  assert.equal(saved[0].offer_id, 'backend-offer-123', 'Local cache should persist the reconciled backend offer ID');
  assert.equal(result.frameworksGenerated, true, 'New-offer save should generate frameworks when none exist');
  assert.equal(harness.builder._generateFrameworkCalls, 1, 'New-offer save should generate frameworks exactly once when missing');
  assert.deepStrictEqual(harness.toastCalls, [
    { message: 'Offer saved successfully. Frameworks generated.', type: 'success' }
  ], 'New-offer save should show one coherent success toast');
}

async function testExistingOfferSaveUpdatesWithoutDuplicateAndSkipsFrameworkGeneration() {
  const existingId = 'existing-offer-1';
  const harness = createHarness({
    offer: {
      offer_id: existingId,
      name: 'Updated Offer Name',
      lineItems: [{ service: 'Cameras' }],
      offerFrameworks: { angles: [{ title: 'Existing Angle' }] }
    },
    storage: {
      [OFFER_STORAGE_KEY]: JSON.stringify([{ offer_id: existingId, name: 'Old Name', lineItems: [{ service: 'Old' }] }])
    },
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body);
      assert.equal(payload.offerData.offer_id, existingId, 'Existing-offer save must keep the existing offer_id in the payload');
      return {
        ok: true,
        json: async () => ({ ok: true, saveOffer: { Offer_ID: existingId, AI_Analysis: { angles: [{ title: 'Existing Angle' }] } } })
      };
    }
  });

  const result = await harness.runSave();
  const saved = parseSavedOffers(harness.storage);

  assert.equal(result.ok, true, 'Existing-offer save should report backend success');
  assert.equal(saved.length, 1, 'Existing-offer save should update in place instead of duplicating the local cache row');
  assert.equal(saved[0].offer_id, existingId, 'Existing-offer save should preserve the existing offer_id');
  assert.equal(saved[0].name, 'Updated Offer Name', 'Existing-offer save should update the cached row content');
  assert.equal(result.frameworksGenerated, false, 'Existing-offer save should not regenerate frameworks when they already exist');
  assert.equal(harness.builder._generateFrameworkCalls || 0, 0, 'Existing-offer save should not call framework generation when frameworks already exist');
  assert.deepStrictEqual(harness.toastCalls, [
    { message: 'Offer saved successfully.', type: 'success' }
  ], 'Existing-offer save should show one success toast with no duplicate or framework toast');
}

async function testApiFailureShowsOnlyLocalWarning() {
  const harness = createHarness({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: false, error: 'save failed' })
    })
  });

  const result = await withMutedConsole(() => harness.runSave());

  assert.equal(result.ok, false, 'API failure should report a non-success result');
  assert.equal(result.backendSaveStatus, 'api-error', 'API failure should report api-error status');
  assert.deepStrictEqual(harness.toastCalls, [
    { message: 'Offer saved locally (backend save failed)', type: 'warning' }
  ], 'API failure should show only the local-save warning toast');
}

async function testNetworkFailureShowsUnavailableWarning() {
  const harness = createHarness({
    fetchImpl: async () => {
      throw new Error('network down');
    }
  });

  const result = await withMutedConsole(() => harness.runSave());

  assert.equal(result.ok, false, 'Network failure should report a non-success result');
  assert.equal(result.backendSaveStatus, 'network-error', 'Network failure should report network-error status');
  assert.deepStrictEqual(harness.toastCalls, [
    { message: 'Offer saved locally (backend unavailable)', type: 'warning' }
  ], 'Network failure should show only the unavailable warning toast');
}

async function testTrackingFailureDoesNotMasqueradeAsSaveFailure() {
  const harness = createHarness({
    offer: {
      offer_id: 'existing-offer-2',
      name: 'Tracked Offer',
      lineItems: [{ service: 'Alarm' }],
      offerFrameworks: { angles: [{ title: 'Existing Angle' }] }
    },
    trackEventThrows: true,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: true, saveOffer: { Offer_ID: 'existing-offer-2', AI_Analysis: { angles: [{ title: 'Existing Angle' }] } } })
    })
  });

  const result = await withMutedConsole(() => harness.runSave());

  assert.equal(result.ok, true, 'Tracking failure should not flip a successful backend save into failure');
  assert.equal(result.backendSaveStatus, 'saved', 'Tracking failure should still report a saved backend status');
  assert.deepStrictEqual(harness.toastCalls, [
    { message: 'Offer saved successfully.', type: 'success' }
  ], 'Tracking failure should still end with one success toast');
}

async function main() {
  expectMatch(/backendSaveStatus = 'saved';/, dashJs, 'saveOffer should record successful backend saves explicitly');
  expectMatch(/localStorage\.setItem\('h2s_offer_builder_offers_v1', JSON\.stringify\(saved\)\);/, dashJs, 'saveOffer must reconcile the local offer cache after backend save');
  expectMatch(/this\.setActiveOffer\(offerData\.offer_id, offerData\.name\);/, dashJs, 'saveOffer must reconcile active-offer state after backend save');
  expectMatch(/async openOfferInBuilder\(offerId, opts = \{\}\) \{/, dashJs, 'Offer Library open path should exist');
  expectMatch(/ob\.offer_id = id;/, dashJs, 'Offer Library open path must pin the loaded builder snapshot to the selected offer ID');
  expectMatch(/this\.loadOfferData\(ob, fw\);/, dashJs, 'Offer Library open path must hydrate Builder through loadOfferData');
  expectMatch(/this\.setActiveOffer\(next\.offer_id, next\.name\);/, dashJs, 'loadOfferData must update canonical active-offer state from the loaded offer ID');
  assert(!/Offer saved successfully to backend!/.test(dashJs), 'Legacy duplicate backend success toast should be removed');
  assert(!/if \(!silent\) showToast\('Offer saved successfully!', 'success'\);/.test(dashJs), 'Legacy unconditional success toast should be removed');

  await testNewOfferSaveReconcilesCanonicalId();
  await testExistingOfferSaveUpdatesWithoutDuplicateAndSkipsFrameworkGeneration();
  await testApiFailureShowsOnlyLocalWarning();
  await testNetworkFailureShowsUnavailableWarning();
  await testTrackingFailureDoesNotMasqueradeAsSaveFailure();

  console.log('PASS validate-offer-builder-save-loop');
  console.log('Verified new-offer ID creation, backend ID reconciliation, existing-offer update behavior, Offer Library load-path ID pinning, single-source save toasts, backend failure handling, and framework generation guard.');
}

main().catch((error) => {
  console.error('FAIL validate-offer-builder-save-loop');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});