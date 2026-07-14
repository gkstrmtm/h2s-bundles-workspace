/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { validateCreateTrainingPayload } = require('../backend/lib/training_admin_create.js');

const HARD_TIMEOUT_MS = Number(process.env.TRAINING_INTEGRATED_TIMEOUT_MS || 30000);

function hardFail(code, message, extra) {
  if (message) console.error(message);
  if (extra) console.error(extra);
  process.exit(code);
}

function makeDom() {
  const html = `<!doctype html>
<html>
  <head></head>
  <body>
    <div id="trainingAdminPanel" style="display:block;">
      <form id="newTrainingForm">
        <input type="hidden" id="editResourceId" value="">
        <div id="trainingFormTitle">Create Training</div>
        <div id="trainingFormIntro">Set the type first.</div>
        <span id="trainingFormModeBadge">Create mode</span>
        <div id="trainingFormModeSummary">Creating a VIDEO training.</div>
        <div id="trainingFormValidation" class="training-admin-inline-state training-admin-inline-state--hidden"></div>

        <input id="newTrainingTitle" type="text" value="">
        <p id="trainingTitleHelpText"></p>

        <select id="newTrainingType">
          <option value="VIDEO" selected>VIDEO</option>
          <option value="PDF">PDF</option>
          <option value="SOP">SOP</option>
        </select>
        <p id="trainingTypeHelpText"></p>

        <select id="newTrainingCategory">
          <option value="AUTO" selected>AUTO</option>
          <option value="Operations &amp; Fulfillment">Operations &amp; Fulfillment</option>
          <option value="Home2Smart Systems">Home2Smart Systems</option>
        </select>

        <input id="newTrainingDuration" type="number" value="">
        <div id="trainingModeNoteCopy"></div>

        <div id="newTrainingUrls" class="training-admin-assets-list">
          <div class="training-url-row" draggable="true">
            <button type="button" class="btn-icon training-drag-handle">=</button>
            <div class="training-url-row__main">
              <div class="training-admin-field-shell training-admin-field-shell--video-title">
                <label class="training-admin-mini-label training-admin-title-label">Video title override</label>
                <input type="hidden" class="training-title-cleared" value="0">
                <input type="text" class="training-title-input training-admin-input" value="">
              </div>
              <div class="training-admin-field-shell">
                <label class="training-admin-mini-label training-admin-url-label">Video link</label>
                <input type="url" class="training-url-input training-admin-input training-admin-input--mono" value="" required>
              </div>
            </div>
            <div class="training-url-row__actions">
              <button type="button" class="btn-icon training-title-reset">↴</button>
              <button type="button" class="btn-icon btn-danger training-url-remove">×</button>
            </div>
          </div>
        </div>

        <button type="button" id="addTrainingUrlBtn">+ Add video</button>

        <div id="trainingFileUploadWrap" hidden>
          <div id="trainingFileUploadLabel">Select file</div>
          <div id="trainingFileUploadStatus" data-default-text="No file selected. Upload a file or use the optional link field below.">No file selected. Upload a file or use the optional link field below.</div>
          <input id="newTrainingFileInput" type="file" class="training-admin-hidden-input">
          <button type="button" id="trainingFileChooseBtn">Choose file</button>
          <button type="button" id="trainingFileClearBtn" hidden>Clear</button>
        </div>

        <p id="trainingAssetsHelpText"></p>
        <textarea id="newTrainingDescription"></textarea>

        <button type="button" id="resetTrainingFormBtn">Reset Draft</button>
        <button type="button" id="cancelEditBtn" hidden>Cancel Edit</button>
        <button type="submit" id="trainingFormSubmitBtn">Create VIDEO</button>
      </form>
      <div id="adminTrainingList"></div>
    </div>

    <div id="trainingContainer"></div>
    <span id="allCount"></span>
    <span id="inprogressCount"></span>
  </body>
</html>`;

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (error) => console.error('[jsdom:error]', error));
  virtualConsole.on('warn', (error) => console.warn('[jsdom:warn]', error));

  return new JSDOM(html, {
    url: 'https://training-integrated.local/dash',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
}

function loadDashHtmlTrainingScript() {
  const dashHtmlPath = path.join(__dirname, '..', 'frontend', 'dash.html');
  const source = fs.readFileSync(dashHtmlPath, 'utf8');
  const marker = '// Training upload: compatibility fallback for multi-video rows.';
  const start = source.indexOf(marker);
  if (start === -1) throw new Error('Could not find Training admin helper script in dash.html');
  const scriptStart = source.lastIndexOf('<script>', start);
  const scriptEnd = source.indexOf('</script>', start);
  if (scriptStart === -1 || scriptEnd === -1) throw new Error('Could not isolate Training admin helper script block');
  return source.slice(scriptStart + '<script>'.length, scriptEnd);
}

function collectAdminState(window) {
  const doc = window.document;
  const row = doc.querySelector('#newTrainingUrls .training-url-row');
  const urlInput = row ? row.querySelector('.training-url-input') : null;
  const titleWrap = row ? row.querySelector('.training-admin-field-shell--video-title') : null;
  const removeBtn = row ? row.querySelector('.training-url-remove') : null;
  const validation = doc.getElementById('trainingFormValidation');

  return {
    badge: doc.getElementById('trainingFormModeBadge')?.textContent?.trim() || '',
    summary: doc.getElementById('trainingFormModeSummary')?.textContent?.trim() || '',
    intro: doc.getElementById('trainingFormIntro')?.textContent?.trim() || '',
    titleHelp: doc.getElementById('trainingTitleHelpText')?.textContent?.trim() || '',
    typeHelp: doc.getElementById('trainingTypeHelpText')?.textContent?.trim() || '',
    assetsHelp: doc.getElementById('trainingAssetsHelpText')?.textContent?.trim() || '',
    modeNote: doc.getElementById('trainingModeNoteCopy')?.textContent?.trim() || '',
    addHidden: !!doc.getElementById('addTrainingUrlBtn')?.hidden,
    cancelHidden: !!doc.getElementById('cancelEditBtn')?.hidden,
    submit: doc.getElementById('trainingFormSubmitBtn')?.textContent?.trim() || '',
    titleHidden: !!titleWrap?.hidden,
    urlPlaceholder: urlInput?.getAttribute('placeholder') || '',
    validation: validation?.textContent?.trim() || '',
    validationHidden: !!validation?.classList.contains('training-admin-inline-state--hidden'),
    rowCount: doc.querySelectorAll('#newTrainingUrls .training-url-row').length,
    removeHidden: !!removeBtn?.hidden,
    editResourceId: doc.getElementById('editResourceId')?.value || ''
  };
}

function collectViewerState(window) {
  const doc = window.document;
  return {
    rowLabels: Array.from(doc.querySelectorAll('.training-row')).map((row) => row.textContent.replace(/\s+/g, ' ').trim()),
    activeResourceId: doc.querySelector('.training-row.active')?.getAttribute('data-resource-id') || '',
    progressSummary: doc.querySelector('.training-stage-progress__summary')?.textContent?.trim() || '',
    progressChips: Array.from(doc.querySelectorAll('.training-stage-progress__chip')).map((node) => node.textContent.trim()),
    actionLabels: Array.from(doc.querySelectorAll('.training-stage-actions .training-stage-btn, .training-stage-actions a.training-stage-btn')).map((node) => ({
      text: node.textContent.replace(/\s+/g, ' ').trim(),
      disabled: node.hasAttribute('disabled')
    })),
    resourceNote: doc.querySelector('.training-stage-resource-note')?.textContent?.trim() || '',
    noticeTitle: doc.querySelector('.training-stage-notice__title')?.textContent?.trim() || '',
    noticeCopy: doc.querySelector('.training-stage-notice__copy')?.textContent?.trim() || '',
    fallbackTitle: doc.querySelector('.training-stage-pdf-fallback__title')?.textContent?.trim() || '',
    fallbackCopy: doc.querySelector('.training-stage-pdf-fallback__copy')?.textContent?.trim() || ''
  };
}

async function main() {
  const startedAt = Date.now();
  const hardTimeout = setTimeout(() => hardFail(2, `TIMEOUT: exceeded ${HARD_TIMEOUT_MS}ms`), HARD_TIMEOUT_MS);
  if (hardTimeout && typeof hardTimeout.unref === 'function') hardTimeout.unref();

  const dom = makeDom();
  const { window } = dom;
  const requests = [];
  const toasts = [];

  if (window.HTMLElement && !window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }

  const cleanup = () => {
    try { clearTimeout(hardTimeout); } catch (_) {}
    try { window.close(); } catch (_) {}
  };

  process.on('unhandledRejection', (reason) => {
    cleanup();
    hardFail(3, 'UNHANDLED REJECTION', reason);
  });

  process.on('uncaughtException', (error) => {
    cleanup();
    hardFail(4, 'UNCAUGHT EXCEPTION', error);
  });

  const realSetTimeout = window.setTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    const handle = realSetTimeout(fn, ms, ...rest);
    if (handle && typeof handle.unref === 'function') handle.unref();
    return handle;
  };
  window.setInterval = (fn, ms, ...rest) => {
    const handle = realSetInterval(fn, ms, ...rest);
    if (handle && typeof handle.unref === 'function') handle.unref();
    return handle;
  };
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);

  window.API_URL = 'https://training-integrated.local/api/v1';
  window.DEFAULT_API_HOST = 'https://training-integrated.local';
  window.currentUser = 'TABARIR';
  window.currentRole = 'ADMIN';

  window.showToast = (message, type = 'info') => {
    toasts.push({ message: String(message), type: String(type) });
  };

  window.loadAdminTrainingList = () => {};
  window.loadTrainingResources = () => {};
  window.loadRecommendationsForFilter = async () => [];
  window.filterTrainingResources = () => {};

  window.localStorage.setItem('h2s_proof_admin_key', 'test-admin');
  window.sessionStorage.setItem('h2s_admin_authenticated', 'true');

  window.fetch = async (url, options = {}) => {
    const requestUrl = String(url || '');
    const body = options && options.body ? JSON.parse(String(options.body)) : null;
    requests.push({ url: requestUrl, body });

    if (requestUrl.includes('action=linkPreview')) {
      return {
        ok: true,
        status: 200,
        async json() {
          const parsed = new URL(requestUrl);
          const requestedUrl = String(parsed.searchParams.get('url') || '');
          return {
            ok: true,
            linkPreview: {
              url: requestedUrl,
              provider: requestedUrl.includes('loom.com') ? 'Loom' : 'YouTube',
              title: requestedUrl.includes('loom.com') ? 'Part 2 QA closeout' : 'Part 1 Intake review'
            }
          };
        }
      };
    }

    if (requestUrl.includes('action=createTraining') || requestUrl.includes('action=updateTraining')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, result: { Resource_ID: body && body.resourceId ? body.resourceId : 'TRAINING_RESOURCE' } };
        }
      };
    }

    if (requestUrl.includes('action=setTrainingVideoProgress')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            result: {
              Resource_ID: body.resourceId,
              Completed_By: body.completedBy,
              Asset_URL: body.assetUrl,
              Video_ID: body.videoId || 'video-id',
              Completion_Percent: body.completionPercent == null ? 100 : body.completionPercent,
              Last_Position_Seconds: body.lastPositionSeconds == null ? 0 : body.lastPositionSeconds,
              Completed_At: body.markCompleted ? new Date().toISOString() : null,
              Watched: true,
              Watched_At: new Date().toISOString()
            }
          };
        }
      };
    }

    if (requestUrl.includes('action=training')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, training: [] };
        }
      };
    }

    return {
      ok: false,
      status: 404,
      async json() {
        return { ok: false, error: 'Unhandled request' };
      }
    };
  };

  const dashJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'dash.js'), 'utf8');
  const dashHtmlTrainingScript = loadDashHtmlTrainingScript();

  window.eval(dashJs);
  window.eval(dashHtmlTrainingScript);
  window.eval("currentUser = 'TABARIR'; currentRole = 'ADMIN';");

  window.showToast = (message, type = 'info') => {
    toasts.push({ message: String(message), type: String(type) });
  };
  window.loadAdminTrainingList = () => {};
  window.loadTrainingResources = () => {};
  window.loadRecommendationsForFilter = async () => [];
  window.filterTrainingResources = () => {};

  const typeEl = window.document.getElementById('newTrainingType');
  const titleEl = window.document.getElementById('newTrainingTitle');
  const descEl = window.document.getElementById('newTrainingDescription');
  const durationEl = window.document.getElementById('newTrainingDuration');

  const setType = (value) => {
    typeEl.value = value;
    window.onNewTrainingTypeChange();
  };

  const getFirstRow = () => window.document.querySelector('#newTrainingUrls .training-url-row');
  const getRowInputs = (row) => ({
    urlInput: row.querySelector('.training-url-input'),
    titleInput: row.querySelector('.training-title-input')
  });

  window.resetTrainingForm();
  setType('VIDEO');
  titleEl.value = 'QA Walkthrough Series';
  descEl.value = 'Review each QA walkthrough part and capture the main failure patterns plus the fixes that matter in production.';
  durationEl.value = '15';
  let firstRow = getFirstRow();
  let firstRowInputs = getRowInputs(firstRow);
  firstRowInputs.urlInput.value = 'https://www.youtube.com/watch?v=abc123DEF45';
  window.addTrainingUrlInput('https://www.loom.com/share/9f4a1e3b2c4d4a6bbf3f2d1c0a9e8b7c', 'Part 2 QA closeout');
  const videoAdminState = collectAdminState(window);
  await window.submitNewTraining({ preventDefault() {} });
  const videoRequest = requests.find((request) => request.url.includes('action=createTraining') && request.body && request.body.type === 'VIDEO');

  window.resetTrainingForm();
  setType('PDF');
  titleEl.value = 'Claims Handbook';
  descEl.value = 'Reference guide for the current claims handling workflow.';
  durationEl.value = '8';
  firstRow = getFirstRow();
  firstRowInputs = getRowInputs(firstRow);
  firstRowInputs.urlInput.value = 'https://example.com/training.pdf';
  const pdfAdminState = collectAdminState(window);
  await window.submitNewTraining({ preventDefault() {} });
  const pdfRequest = requests.find((request) => request.url.includes('action=createTraining') && request.body && request.body.type === 'PDF');

  window.resetTrainingForm();
  setType('SOP');
  titleEl.value = 'Escalation SOP';
  descEl.value = 'Use this SOP when an escalation spans fulfillment, claims, and scheduling.';
  durationEl.value = '12';
  firstRow = getFirstRow();
  firstRowInputs = getRowInputs(firstRow);
  firstRowInputs.urlInput.value = 'https://example.com/process/sop';
  const sopAdminState = collectAdminState(window);
  await window.submitNewTraining({ preventDefault() {} });
  const sopRequest = requests.find((request) => request.url.includes('action=createTraining') && request.body && request.body.type === 'SOP');

  window.resetTrainingForm();
  setType('VIDEO');
  firstRow = getFirstRow();
  firstRowInputs = getRowInputs(firstRow);
  firstRowInputs.urlInput.value = 'https://example.com/not-video';
  await window.submitNewTraining({ preventDefault() {} });
  const invalidVideoState = collectAdminState(window);

  window.resetTrainingForm();
  setType('PDF');
  firstRow = getFirstRow();
  firstRowInputs = getRowInputs(firstRow);
  firstRowInputs.urlInput.value = 'http://example.com/not-secure.pdf';
  await window.submitNewTraining({ preventDefault() {} });
  const invalidPdfState = collectAdminState(window);

  window.resetTrainingForm();
  setType('SOP');
  firstRow = getFirstRow();
  firstRowInputs = getRowInputs(firstRow);
  firstRowInputs.urlInput.value = '';
  await window.submitNewTraining({ preventDefault() {} });
  const invalidSopState = collectAdminState(window);

  const editResources = [{
    Resource_ID: 'edit-pdf-1',
    Title: 'Existing PDF',
    Description: 'Existing PDF description',
    Estimated_Minutes: 9,
    Type: 'PDF',
    Category: 'Operations & Fulfillment',
    URL: 'https://example.com/existing.pdf',
    completions: []
  }];
  window.__editResources = editResources;
  window.eval('allTrainingResources = window.__editResources;');
  window.renderTrainingResources(editResources);
  await window.editTraining('edit-pdf-1');
  const editAdminState = collectAdminState(window);

  window.addTrainingUrlInput('https://www.youtube.com/watch?v=def456GHI78', 'Extra row');
  window.setTrainingAdminValidationState('Stale validation', 'error');
  window.document.getElementById('editResourceId').value = 'stale-id';
  window.resetTrainingForm();
  const resetAdminState = collectAdminState(window);
  const resetRow = getFirstRow();
  const resetRowInputs = getRowInputs(resetRow);

  assert(videoRequest && videoRequest.body, 'Expected VIDEO create request');
  assert(pdfRequest && pdfRequest.body, 'Expected PDF create request');
  assert(sopRequest && sopRequest.body, 'Expected SOP create request');

  const videoContract = validateCreateTrainingPayload(videoRequest.body);
  const pdfContract = validateCreateTrainingPayload(pdfRequest.body);
  const sopContract = validateCreateTrainingPayload(sopRequest.body);
  const invalidVideoContract = validateCreateTrainingPayload({ type: 'VIDEO', assets: ['https://example.com/not-video'] });
  const invalidPdfContract = validateCreateTrainingPayload({ type: 'PDF', url: 'http://example.com/not-secure.pdf' });
  const invalidSopContract = validateCreateTrainingPayload({ type: 'SOP', url: '' });

  assert.equal(videoContract.ok, true, 'VIDEO payload should satisfy backend validation');
  assert.equal(pdfContract.ok, true, 'PDF payload should satisfy backend validation');
  assert.equal(sopContract.ok, true, 'SOP payload should satisfy backend validation');
  assert.equal(invalidVideoContract.ok, false, 'Invalid VIDEO payload should fail backend validation');
  assert.equal(invalidPdfContract.ok, false, 'Invalid PDF payload should fail backend validation');
  assert.equal(invalidSopContract.ok, false, 'Invalid SOP payload should fail backend validation');

  assert.deepEqual(videoRequest.body.assets, [
    'https://www.youtube.com/watch?v=abc123DEF45',
    'https://www.loom.com/share/9f4a1e3b2c4d4a6bbf3f2d1c0a9e8b7c'
  ], 'VIDEO payload should preserve canonical multi-video assets');
  assert.equal(videoRequest.body.url, 'https://www.youtube.com/watch?v=abc123DEF45', 'VIDEO payload should keep top-level url compatibility field');
  assert.equal(Array.isArray(pdfRequest.body.assets), false, 'PDF payload should not send assets array');
  assert.equal(Array.isArray(sopRequest.body.assets), false, 'SOP payload should not send assets array');
  assert.equal(pdfRequest.body.url, 'https://example.com/training.pdf', 'PDF payload should send exactly one HTTPS url');
  assert.equal(sopRequest.body.url, 'https://example.com/process/sop', 'SOP payload should send exactly one HTTPS url');

  assert.equal(videoAdminState.badge, 'Create mode', 'VIDEO form should show create mode');
  assert.equal(videoAdminState.submit, 'Create VIDEO', 'VIDEO form should show create label');
  assert.equal(videoAdminState.rowCount, 2, 'VIDEO should allow multiple source rows');
  assert.equal(videoAdminState.addHidden, false, 'VIDEO should keep add-row action visible');
  assert.equal(videoAdminState.titleHidden, false, 'VIDEO should show video title override row');
  assert.equal(videoAdminState.validationHidden, true, 'VIDEO happy path should not show inline validation');

  assert.equal(pdfAdminState.submit, 'Create PDF', 'PDF form should update submit label');
  assert.equal(pdfAdminState.addHidden, true, 'PDF should hide add-row action');
  assert.equal(pdfAdminState.titleHidden, true, 'PDF should hide video title override');
  assert.equal(pdfAdminState.urlPlaceholder, 'https://example.com/training.pdf', 'PDF should update placeholder');

  assert.equal(sopAdminState.submit, 'Create SOP', 'SOP form should update submit label');
  assert.equal(sopAdminState.addHidden, true, 'SOP should hide add-row action');
  assert.equal(sopAdminState.titleHidden, true, 'SOP should hide video title override');
  assert.equal(sopAdminState.urlPlaceholder, 'https://example.com/process/sop-training', 'SOP should update placeholder');

  assert.equal(invalidVideoState.validation, 'VIDEO row 1 must be a valid YouTube or Loom link.', 'VIDEO invalid state should be type-specific');
  assert.equal(invalidPdfState.validation, 'PDF training requires exactly one HTTPS document link.', 'PDF invalid state should be type-specific');
  assert.equal(invalidSopState.validation, 'SOP training requires exactly one HTTPS process or document link.', 'SOP invalid state should be type-specific');

  assert.equal(editAdminState.badge, 'Edit mode', 'Edit mode should be visible');
  assert.equal(editAdminState.submit, 'Update PDF', 'Edit mode should update submit label');
  assert.equal(editAdminState.cancelHidden, false, 'Edit mode should reveal cancel button');
  assert.equal(editAdminState.editResourceId, 'edit-pdf-1', 'Edit mode should keep resource id');

  assert.equal(resetAdminState.badge, 'Create mode', 'Reset should return to create mode');
  assert.equal(resetAdminState.submit, 'Create VIDEO', 'Reset should restore VIDEO submit label');
  assert.equal(resetAdminState.editResourceId, '', 'Reset should clear edit resource id');
  assert.equal(resetAdminState.validationHidden, true, 'Reset should clear validation message');
  assert.equal(resetAdminState.rowCount, 1, 'Reset should collapse back to a single source row');
  assert.equal(resetRowInputs.urlInput.value, '', 'Reset should clear first source url');
  assert.equal(resetRowInputs.titleInput.value, '', 'Reset should clear first source title override');
  assert.equal(resetRow.querySelector('.training-title-cleared').value, '0', 'Reset should clear hidden title state');

  const viewerResources = [
    {
      Resource_ID: 'video-1',
      Title: videoRequest.body.title,
      Description: videoRequest.body.description,
      Category: 'Home2Smart Systems',
      Type: 'VIDEO',
      Assets: videoRequest.body.assets,
      Assets_Meta: {
        'https://www.youtube.com/watch?v=abc123DEF45': { title: 'Part 1 Intake review', provider: 'YouTube' },
        'https://www.loom.com/share/9f4a1e3b2c4d4a6bbf3f2d1c0a9e8b7c': { title: 'Part 2 QA closeout', provider: 'Loom' }
      },
      completions: [],
      assetProgress: [
        {
          Resource_ID: 'video-1',
          Video_ID: 'abc123DEF45',
          Asset_URL: 'https://www.youtube.com/watch?v=abc123DEF45',
          Completion_Percent: 42,
          Last_Position_Seconds: 318,
          Watched: true,
          Watched_At: new Date().toISOString()
        }
      ]
    },
    {
      Resource_ID: 'pdf-1',
      Title: pdfRequest.body.title,
      Description: pdfRequest.body.description,
      Category: 'Operations & Fulfillment',
      Type: 'PDF',
      URL: pdfRequest.body.url,
      completions: []
    },
    {
      Resource_ID: 'sop-1',
      Title: sopRequest.body.title,
      Description: sopRequest.body.description,
      Category: 'Operations & Fulfillment',
      Type: 'SOP',
      URL: sopRequest.body.url,
      completions: []
    }
  ];

  window.__viewerResources = viewerResources;
  window.eval('allTrainingResources = window.__viewerResources;');
  window.renderTrainingResources(viewerResources);
  window.trainingSelectResource('video-1');
  const viewerVideoState = collectViewerState(window);

  const videoRow = window.document.querySelector('.training-row[data-resource-id="video-1"]');
  videoRow.focus();
  videoRow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const afterRowArrow = window.document.querySelector('.training-row.active')?.getAttribute('data-resource-id') || '';

  window.trainingSelectResource('video-1');
  const partButtons = Array.from(window.document.querySelectorAll('.training-stage-part[data-resource-id="video-1"]'));
  const firstPartButton = partButtons[0];
  firstPartButton.focus();
  firstPartButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const activePartIndexAfterArrow = Array.from(window.document.querySelectorAll('.training-stage-part[data-resource-id="video-1"]')).findIndex((node) => node.classList.contains('is-active'));

  window.trainingSelectResource('pdf-1');
  const viewerPdfState = collectViewerState(window);

  window.trainingSelectResource('sop-1');
  const viewerSopState = collectViewerState(window);

  assert(viewerVideoState.rowLabels.some((text) => text.includes('In Progress')), 'Viewer should show row progress/status cues');
  assert.equal(viewerVideoState.progressSummary, '1 of 2 parts watched', 'Viewer should show progress summary for active video');
  assert(viewerVideoState.actionLabels.some((action) => action.text === 'Mark Part Watched'), 'Viewer should offer watched-state update control');
  assert.equal(afterRowArrow, 'pdf-1', 'Viewer row keyboard navigation should move selection to the next row');
  assert.equal(activePartIndexAfterArrow, 1, 'Viewer part keyboard navigation should move to the next part');
  assert(viewerPdfState.actionLabels.some((action) => action.text === 'Open PDF'), 'PDF viewer should expose Open PDF action');
  assert(viewerPdfState.resourceNote.includes('Preview the PDF inline when possible.'), 'PDF viewer should explain inline preview and fallback behavior');
  assert(viewerSopState.actionLabels.some((action) => action.text === 'Open SOP'), 'SOP viewer should expose Open SOP action');
  assert(viewerSopState.fallbackTitle === 'Inline preview is not available for this SOP.', 'SOP viewer should use clear fallback copy when inline preview is unavailable');

  const result = {
    admin: {
      video: { state: videoAdminState, payload: videoRequest.body },
      pdf: { state: pdfAdminState, payload: pdfRequest.body },
      sop: { state: sopAdminState, payload: sopRequest.body },
      invalid: {
        video: invalidVideoState,
        pdf: invalidPdfState,
        sop: invalidSopState
      },
      edit: editAdminState,
      reset: {
        state: resetAdminState,
        firstUrl: resetRowInputs.urlInput.value,
        firstTitle: resetRowInputs.titleInput.value,
        titleCleared: resetRow.querySelector('.training-title-cleared').value
      }
    },
    viewer: {
      beforeProgress: viewerVideoState,
      pdf: viewerPdfState,
      sop: viewerSopState,
      keyboard: {
        rowAfterArrowDown: afterRowArrow,
        activePartIndexAfterArrowRight: activePartIndexAfterArrow
      }
    },
    contracts: {
      video: videoContract,
      pdf: pdfContract,
      sop: sopContract,
      invalidVideo: invalidVideoContract,
      invalidPdf: invalidPdfContract,
      invalidSop: invalidSopContract
    },
    toastCount: toasts.length,
    durationMs: Date.now() - startedAt
  };

  console.log(JSON.stringify(result, null, 2));
  cleanup();
}

main().catch((error) => {
  hardFail(1, 'Fatal error running integrated Training validation', error);
});