(function () {
  const API_BASE = (function () {
    const host = String(location.hostname || '').toLowerCase();
    if (location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') {
      return '/api';
    }
    return '/api';
  })();

  const TRACK_ENDPOINT = `${API_BASE}/track`;
  const INTAKE_ENDPOINT = `${API_BASE}/commercial-intake`;
  const PHOTO_ENDPOINT = `${API_BASE}/commercial-intake/photo`;
  const CONSULTATION_ENDPOINT = `${API_BASE}/commercial-consultation`;
  const COMMERCIAL_MEDIA_ENDPOINT = `${API_BASE}/owner-media/public?surface=commercial_intake&limit=4`;
  const PROOF_ENDPOINT = `${API_BASE}/proof-gallery`;
  const STORAGE_KEY = 'h2s_commercial_lead';
  const DRAFT_KEY = 'h2s_commercial_draft';
  const DEFAULT_PHONE = '864-387-8413';
  const MEDIA_REQUEST_TIMEOUT_MS = 4500;

  const SMS_CONSENT_COPY = 'I agree to receive text messages from Home2Smart about my estimate and project updates, including automated reminders. Consent is not a condition of purchase. Reply STOP to opt out.';

  const WIZARD_STEPS = [
    { number: 1, title: 'Project focus', message: 'Choose the project type and site details.' },
    { number: 2, title: 'Contact and site', message: 'Add the main contact and site information.' },
    { number: 3, title: 'Planning details', message: 'Add any details that affect the visit.' },
    { number: 4, title: 'Photos', message: 'Add photos only if they help explain the site.' },
    { number: 5, title: 'Consultation window', message: 'Review the details and choose a time.' }
  ];

  const state = {
    leadToken: '',
    lead: null,
    config: null,
    slots: [],
    selectedSlotStart: '',
    uploadedPhotos: [],
    firstLeadTracked: false,
    currentStep: 1,
    maxStepVisited: 1,
    heroMediaApplied: false,
    submission: null,
    revision: 0,
    dirty: false,
    localVersion: 0,
    pendingSave: null,
    submissionKey: '',
    submitting: false,
    hydrating: true,
    conflict: false,
  };
  let saveChain = Promise.resolve();
  let uploadChain = Promise.resolve();

  function newIdentity() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    return Array.from(window.crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  let commercialCustomSelectIdCounter = 0;
  let commercialCustomSelectSyncQueued = false;
  let commercialCustomSelectBound = false;
  let heroMediaPreloadHref = '';
  let heroMediaRequestId = 0;
  const DEFAULT_LOCAL_DRAFT_MESSAGE = 'Saved automatically as you go.';

  function byId(id) {
    return document.getElementById(id);
  }

  function qsa(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  function safeStorage() {
    try {
      return window.localStorage;
    } catch (_) {
      return {
        getItem: function () { return null; },
        setItem: function () {},
        removeItem: function () {},
      };
    }
  }

  const storage = safeStorage();

  function uuidFallback() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      const random = Math.random() * 16 | 0;
      const value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function getOrCreateId(key) {
    let value = storage.getItem(key);
    if (!value) {
      value = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : uuidFallback();
      storage.setItem(key, value);
    }
    return value;
  }

  async function track(eventType, params) {
    try {
      const payload = {
        event_type: eventType,
        visitor_id: getOrCreateId('h2s_visitor_id'),
        session_id: getOrCreateId('h2s_session_id'),
        occurred_at: new Date().toISOString(),
        page_url: location.href,
        page_path: location.pathname,
        referrer: document.referrer || '(direct)',
        user_agent: navigator.userAgent,
        ...(params || {})
      };

      await fetch(TRACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        cache: 'no-store'
      }).catch(function () {});
    } catch (_) {}
  }

  function setStatus(message, tone) {
    const node = byId('formStatus');
    if (!node) return;
    node.textContent = message;
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  function setSaveState(message, tone, note) {
    const saveText = byId('saveStateText');
    const saveNote = byId('saveStateNote');
    if (saveText) saveText.textContent = message;
    if (saveText) {
      if (tone) saveText.setAttribute('data-tone', tone);
      else saveText.removeAttribute('data-tone');
    }
    if (saveNote && note) saveNote.textContent = note;
  }

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = value;
  }

  function normalizePhoneDigits(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function phoneHref(number) {
    return `tel:${normalizePhoneDigits(number)}`;
  }

  function smsHref(number, message) {
    const digits = normalizePhoneDigits(number);
    const body = encodeURIComponent(message || 'Hi, I need help with a commercial Home2Smart project.');
    return `sms:${digits}?body=${body}`;
  }

  function hasMessagingConsent(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.smsOptIn != null) return payload.smsOptIn === true;
    if (payload.smsConsent != null) return payload.smsConsent === true;
    const attribution = payload.attribution && typeof payload.attribution === 'object' ? payload.attribution : {};
    if (attribution.smsOptIn != null) return attribution.smsOptIn === true;
    const communicationConsent = attribution.communicationConsent && typeof attribution.communicationConsent === 'object'
      ? attribution.communicationConsent
      : {};
    return communicationConsent.smsOptIn === true;
  }

  function requiresMessagingConsent(payload) {
    return payload && payload.contactPreference === 'sms';
  }

  function validateContact(payload) {
    const method = payload.contactPreference;
    const phone = String(payload.phone || '').trim();
    const email = String(payload.email || '').trim();
    const digits = normalizePhoneDigits(phone);
    if (['sms', 'call', 'email'].indexOf(method) < 0) return { field: 'contactPreference', message: 'Choose Text first, Call first, or Email first.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { field: 'email', message: 'Enter a valid email address.' };
    if (phone && (!/^[+\d\s().-]+$/.test(phone) || digits.length < 10 || digits.length > 15)) return { field: 'phone', message: 'Enter a valid phone number, including the area code.' };
    if (method === 'email' && !email) return { field: 'email', message: 'Email first requires a valid email address. A phone number is optional.' };
    if (method !== 'email' && !phone) return { field: 'phone', message: `${method === 'call' ? 'Call' : 'Text'} first requires a valid phone number.` };
    if (requiresMessagingConsent(payload) && !hasMessagingConsent(payload)) return { field: 'smsConsent', message: 'To choose Text first, explicitly agree to project texts, or choose Call first or Email first.' };
    return null;
  }

  function showContactError(error, focus) {
    const step = error.field === 'slotGrid' ? 5 : error.field === 'serviceNeeds' ? 1 : 2;
    if (focus && state.currentStep !== step) showStep(step);
    setStatus(error.message, 'error');
    const field = byId(error.field) || (error.field === 'serviceNeeds' ? document.querySelector('input[name="serviceNeeds"]') : null);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', 'formStatus');
      if (focus) {
        if (!field.matches('input,select,textarea,button')) field.setAttribute('tabindex', '-1');
        field.focus();
      }
    }
  }

  function getFollowUpCopy() {
    const preference = String(byId('contactPreference') ? byId('contactPreference').value : 'sms').toLowerCase();
    const manual = preference === 'email' || preference === 'call';
    const channel = preference === 'email' ? 'email' : 'phone';
    const manualCopy = `Your request is submitted for manual follow-up by ${channel}. No automated customer texts or emails are sent for this request. Any preferred window is pending review; no appointment is confirmed.`;
    return {
      preference,
      cta: manual ? 'Request manual follow-up' : 'Submit estimate request',
      helper: manual
        ? `Submit for manual follow-up by ${channel}. A preferred window is optional and pending review, not a confirmed consultation.`
        : 'Submit your requested window for technician review. Project texts require your explicit texting choice. No appointment is confirmed by this submission.',
      sending: 'Submitting follow-up request...',
      successTitle: 'Follow-up request submitted.',
      successCopy: manual ? manualCopy : 'Your request is submitted for technician review. The requested window is not a confirmed appointment.',
      manualReviewCopy: manual ? manualCopy : 'Your request is submitted for manual review. No appointment is confirmed.',
      status: manual ? `Follow-up request submitted for manual ${channel} review.` : 'Request submitted. Requested window pending review.'
    };
  }

  function syncFollowUpCopy() {
    const copy = getFollowUpCopy();
    const submitButton = byId('requestConsultationBtn');
    const submitCopy = byId('submitCopy');
    if (submitButton) {
      submitButton.textContent = state.submission ? 'Follow-up request submitted' : copy.cta;
      submitButton.disabled = !!state.submission || state.submitting;
    }
    if (submitCopy) submitCopy.textContent = copy.helper;
    const texting = copy.preference === 'sms';
    if (byId('smsConsentField')) byId('smsConsentField').classList.toggle('hidden', !texting);
    if (byId('smsConsent')) byId('smsConsent').disabled = !texting;
    setText('contactMethodHint', texting
      ? 'Text first requires a valid phone number and your explicit agreement below. You can choose manual call or email follow-up instead.'
      : 'Call and email follow-up are manual. We do not send automated customer texts for these choices.');
    setText('phoneLabel', copy.preference === 'email' ? 'Phone (optional)' : 'Phone (required)');
    setText('emailLabel', copy.preference === 'email' ? 'Email (required)' : 'Email (optional)');
    return copy;
  }

  function renderSubmission(consultation, manualReviewRequired) {
    if (!consultation) return;
    state.submission = consultation;
    const copy = syncFollowUpCopy();
    const manual = consultation.metadata && consultation.metadata.request_kind === 'manual_follow_up';
    const successPanel = byId('consultationSuccessPanel');
    if (successPanel) successPanel.classList.remove('hidden');
    setText('successReference', consultation.referenceCode || '--');
    setText('successTitle', 'Follow-up request submitted.');
    setText('successStatus', manual ? 'Manual follow-up pending review. No appointment is confirmed.' : 'Request submitted; check the request status with our team before making appointment plans.');
    setText('successSlot', consultation.selectedSlotStart ? consultation.slotLabel : 'No preferred window requested');
    setText('successCopy', manualReviewRequired ? copy.manualReviewCopy : copy.successCopy);
    if (!manual && ['approved', 'customer_confirmed'].indexOf(consultation.status) >= 0) {
      const booked = !!consultation.relatedOrderId;
      setText('successStatus', booked ? 'Appointment created. Contact the team if you need to change this window.' : 'Technician approved; booking still needs review. No appointment is confirmed.');
      setText('successCopy', booked
        ? 'Your appointment is recorded. SMS provider acceptance, message delivery and customer acknowledgement are separate; contact the team if you have not received the details.'
        : 'The team needs to resolve appointment creation before sending a booking confirmation.');
    }
  }

  function mediaAssetOrigin() {
    try {
      return new URL(API_BASE, location.href).origin;
    } catch (_) {
      return location.origin;
    }
  }

  function absolutizeMediaUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(data:|blob:|https?:)/i.test(raw)) return raw;
    try {
      if (raw.startsWith('/api/')) {
        return new URL(raw, `${mediaAssetOrigin()}/`).toString();
      }
      return new URL(raw, location.href).toString();
    } catch (_) {
      return raw;
    }
  }

  function recordMediaDiagnostic(level, eventName, details) {
    try {
      const entry = {
        at: new Date().toISOString(),
        level: level || 'info',
        event: eventName,
        ...(details || {}),
      };
      const bucket = Array.isArray(window.__h2sCommercialMediaDebug) ? window.__h2sCommercialMediaDebug : [];
      bucket.push(entry);
      window.__h2sCommercialMediaDebug = bucket.slice(-30);
      const logger = typeof console !== 'undefined' && typeof console[level] === 'function'
        ? console[level]
        : console.info;
      logger.call(console, '[commercial-media]', eventName, details || {});
    } catch (_) {}
  }

  function truncateText(value, maxLength) {
    const text = String(value || '').trim();
    const limit = Number(maxLength || 0);
    if (!text || !limit || text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  }

  function getQueryLeadToken() {
    const url = new URL(location.href);
    return String(url.searchParams.get('lead') || '').trim();
  }

  function updateLeadUrl(token) {
    const url = new URL(location.href);
    if (token) url.searchParams.set('lead', token);
    else url.searchParams.delete('lead');
    history.replaceState({}, '', url.toString());
  }

  function setLocalDraftState(message) {
    const node = byId('localDraftState');
    if (node) node.textContent = String(message || DEFAULT_LOCAL_DRAFT_MESSAGE);
  }

  function formatSlot(startIso, endIso) {
    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : null;
    if (Number.isNaN(start.getTime())) return 'Requested time';
    const startText = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(start);
    if (!end || Number.isNaN(end.getTime())) return startText;
    const endText = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit'
    }).format(end);
    return `${startText} to ${endText} Eastern Time`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function mediaUrlFor(item) {
    if (!item || typeof item !== 'object') return '';
    return absolutizeMediaUrl(item.media_url || item.public_url || item.direct_url || '');
  }

  function mediaPosterFor(item) {
    if (!item || typeof item !== 'object') return '';
    return absolutizeMediaUrl(item.video_thumbnail_url || '');
  }

  function normalizeMediaItems(items, limit) {
    const maxItems = Number.isFinite(Number(limit)) ? Number(limit) : 4;
    return (Array.isArray(items) ? items : [])
      .map(function (item) {
        return {
          ...(item || {}),
          media_url: mediaUrlFor(item),
        };
      })
      .filter(function (item) {
        return !!item.media_url;
      })
      .slice(0, maxItems);
  }

  function setHeroStatus(message) {
    setText('heroMediaStatus', message || 'Loading recent installation photo...');
  }

  function ensureHeroMediaPreload(mediaUrl) {
    const href = String(mediaUrl || '').trim();
    const existing = document.querySelector('link[data-hero-media-preload="true"]');
    if (!href || /^(blob:|data:)/i.test(href)) {
      if (existing) existing.remove();
      heroMediaPreloadHref = '';
      return;
    }
    if (heroMediaPreloadHref === href && existing) return;

    const link = existing || document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = href;
    link.crossOrigin = 'anonymous';
    link.setAttribute('fetchpriority', 'high');
    link.setAttribute('data-hero-media-preload', 'true');
    if (!existing) document.head.appendChild(link);
    heroMediaPreloadHref = href;
  }

  function clearHeroMediaPreload() {
    const existing = document.querySelector('link[data-hero-media-preload="true"]');
    if (existing) existing.remove();
    heroMediaPreloadHref = '';
  }

  function renderHeroEmpty(message) {
    const stage = byId('heroMediaStage');
    if (!stage) return;
    heroMediaRequestId += 1;
    clearHeroMediaPreload();
    stage.classList.remove('is-loading', 'is-ready');
    stage.classList.add('is-empty');
    stage.innerHTML = `<div class="media-stage__empty">${escapeHtml(message || 'Recent installation media is unavailable right now.')}</div><span class="sr-only" id="heroMediaStatus">Recent installation media is unavailable right now.</span>`;
    state.heroMediaApplied = false;
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId = null;
    if (controller && Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
      timeoutId = window.setTimeout(function () {
        try { controller.abort(); } catch (_) {}
      }, Number(timeoutMs));
    }

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
      const payload = await response.json();
      return { response, payload };
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  function readDraft() {
    try {
      const raw = storage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function normalizeDraft(rawDraft) {
    if (!rawDraft || typeof rawDraft !== 'object') return null;
    const payload = rawDraft.payload && typeof rawDraft.payload === 'object'
      ? rawDraft.payload
      : rawDraft;
    const currentStep = Math.max(1, Math.min(WIZARD_STEPS.length, Number(rawDraft.currentStep || 1)));
    const maxStepVisited = Math.max(currentStep, Math.min(WIZARD_STEPS.length, Number(rawDraft.maxStepVisited || currentStep)));
    const selectedSlotStart = String(rawDraft.selectedSlotStart || '').trim();
    const uploadedPhotos = Array.isArray(rawDraft.uploadedPhotos)
      ? rawDraft.uploadedPhotos.slice(0, 8)
      : (Array.isArray(payload.projectPhotoUrls) ? payload.projectPhotoUrls.slice(0, 8) : []);
    const leadToken = String(rawDraft.leadToken || rawDraft.publicToken || payload.publicToken || '').trim();

    return {
      version: Number(rawDraft.version || 1),
      savedAt: String(rawDraft.savedAt || '').trim(),
      leadToken,
      currentStep,
      maxStepVisited,
      selectedSlotStart,
      uploadedPhotos,
      payload,
      dirty: rawDraft.dirty === true,
      localVersion: Number(rawDraft.localVersion || 0),
      revision: Number(rawDraft.revision || 0),
      pendingSave: rawDraft.pendingSave || null,
      submissionKey: String(rawDraft.submissionKey || ''),
    };
  }

  function draftMatchesLead(draft, leadToken) {
    const normalized = draft && draft.leadToken ? String(draft.leadToken).trim() : '';
    const current = String(leadToken || '').trim();
    if (!normalized || !current) return true;
    return normalized === current;
  }

  function commercialShouldUseCustomSelect(selectEl) {
    if (!selectEl || !selectEl.matches || !selectEl.matches('select')) return false;
    if (selectEl.multiple) return false;
    const size = parseInt(selectEl.getAttribute('size') || '1', 10);
    if (Number.isFinite(size) && size > 1) return false;
    if (selectEl.hidden) return false;
    if (String(selectEl.dataset.customSelect || '').toLowerCase() === 'off') return false;
    return true;
  }

  function commercialEnsureCustomSelectId(selectEl) {
    if (!selectEl) return '';
    if (!selectEl.id) {
      commercialCustomSelectIdCounter += 1;
      selectEl.id = `commercialCustomSelect${commercialCustomSelectIdCounter}`;
    }
    return String(selectEl.id || '');
  }

  function commercialGetCustomSelects(container) {
    const scope = container && container.querySelectorAll ? container : document;
    return Array.from(scope.querySelectorAll('select')).filter(commercialShouldUseCustomSelect);
  }

  function commercialGetCustomSelectShell(selectEl) {
    const shell = selectEl && selectEl.nextElementSibling;
    return shell && shell.classList && shell.classList.contains('commercial-custom-select-shell')
      ? shell
      : null;
  }

  function commercialRemoveCustomSelect(selectEl) {
    if (!selectEl) return;
    const shell = commercialGetCustomSelectShell(selectEl);
    if (shell) {
      try { shell.remove(); } catch (_) {}
    }
    selectEl.classList.remove('commercial-custom-select-native');
    selectEl.removeAttribute('tabindex');
    selectEl.removeAttribute('aria-hidden');
  }

  function commercialQueueCustomSelectSync() {
    if (commercialCustomSelectSyncQueued) return;
    commercialCustomSelectSyncQueued = true;
    const run = function () {
      commercialCustomSelectSyncQueued = false;
      commercialSyncAllCustomSelects(document);
    };
    try {
      window.requestAnimationFrame(run);
    } catch (_) {
      window.setTimeout(run, 0);
    }
  }

  function commercialCloseCustomSelects(exceptSelect) {
    commercialGetCustomSelects(document).forEach(function (selectEl) {
      if (!selectEl || selectEl === exceptSelect) return;
      const shell = commercialGetCustomSelectShell(selectEl);
      if (!shell) return;
      const trigger = shell.querySelector('.commercial-custom-select-trigger');
      const menu = shell.querySelector('.commercial-custom-select-menu');
      shell.classList.remove('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (menu) menu.hidden = true;
    });
  }

  function commercialSetCustomSelectOpen(selectEl, shouldOpen) {
    if (!selectEl) return;
    const shell = commercialGetCustomSelectShell(selectEl);
    if (!shell) return;
    const trigger = shell.querySelector('.commercial-custom-select-trigger');
    const menu = shell.querySelector('.commercial-custom-select-menu');
    if (!trigger || !menu) return;

    if (shouldOpen && selectEl.disabled) return;
    if (shouldOpen) commercialCloseCustomSelects(selectEl);

    shell.classList.toggle('is-open', !!shouldOpen);
    trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    menu.hidden = !shouldOpen;

    if (shouldOpen) {
      const activeOption = menu.querySelector('.commercial-custom-select-option.is-selected:not([disabled])')
        || menu.querySelector('.commercial-custom-select-option:not([disabled])');
      if (activeOption) {
        try { activeOption.focus(); } catch (_) {}
      }
    }
  }

  function commercialGetSelectLabel(selectEl) {
    const field = selectEl && selectEl.closest ? selectEl.closest('.field') : null;
    const label = field ? field.querySelector(':scope > span') : null;
    return label ? String(label.textContent || '').trim() : 'Select';
  }

  function ensureCommercialCustomSelectBindings() {
    if (commercialCustomSelectBound) return;
    commercialCustomSelectBound = true;

    document.addEventListener('click', function (event) {
      const target = event && event.target && event.target.closest
        ? event.target.closest('.commercial-custom-select-shell')
        : null;
      if (!target) commercialCloseCustomSelects();
    }, true);

    document.addEventListener('keydown', function (event) {
      if (event && event.key === 'Escape') commercialCloseCustomSelects();
    }, true);

    document.addEventListener('change', function (event) {
      const target = event && event.target;
      if (target && target.matches && target.matches('select')) commercialSyncCustomSelect(target);
    }, true);

    document.addEventListener('input', function (event) {
      const target = event && event.target;
      if (target && target.matches && target.matches('select')) commercialSyncCustomSelect(target);
    }, true);

    window.addEventListener('resize', function () {
      commercialCloseCustomSelects();
      commercialQueueCustomSelectSync();
    }, { passive: true });

  }

  function commercialSyncCustomSelect(selectEl) {
    if (!selectEl) return;

    ensureCommercialCustomSelectBindings();

    if (!commercialShouldUseCustomSelect(selectEl)) {
      commercialRemoveCustomSelect(selectEl);
      return;
    }

    const selectId = commercialEnsureCustomSelectId(selectEl);
    if (!selectEl.dataset.customSelectBound) {
      selectEl.dataset.customSelectBound = 'true';
      selectEl.addEventListener('change', function () { commercialSyncCustomSelect(selectEl); });
      selectEl.addEventListener('input', function () { commercialSyncCustomSelect(selectEl); });
    }

    selectEl.classList.add('commercial-custom-select-native');
    selectEl.setAttribute('tabindex', '-1');
    selectEl.setAttribute('aria-hidden', 'true');

    let shell = commercialGetCustomSelectShell(selectEl);
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'commercial-custom-select-shell';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'commercial-custom-select-trigger';
      trigger.id = `${selectId}CustomTrigger`;
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', `${selectId}CustomMenu`);
      trigger.setAttribute('aria-label', commercialGetSelectLabel(selectEl));

      const textEl = document.createElement('span');
      textEl.className = 'commercial-custom-select-trigger__text';
      trigger.appendChild(textEl);

      const iconEl = document.createElement('span');
      iconEl.className = 'commercial-custom-select-trigger__icon';
      iconEl.setAttribute('aria-hidden', 'true');
      trigger.appendChild(iconEl);

      const menu = document.createElement('div');
      menu.className = 'commercial-custom-select-menu';
      menu.id = `${selectId}CustomMenu`;
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-labelledby', trigger.id);
      menu.hidden = true;

      trigger.addEventListener('click', function () {
        commercialSetCustomSelectOpen(selectEl, !shell.classList.contains('is-open'));
      });

      trigger.addEventListener('keydown', function (event) {
        if (!event) return;
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          commercialSetCustomSelectOpen(selectEl, true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          commercialSetCustomSelectOpen(selectEl, false);
        }
      });

      menu.addEventListener('keydown', function (event) {
        if (!event) return;
        const items = Array.from(menu.querySelectorAll('.commercial-custom-select-option:not([disabled])'));
        const currentIndex = items.indexOf(document.activeElement);

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1);
          if (items[nextIndex]) items[nextIndex].focus();
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
          if (items[nextIndex]) items[nextIndex].focus();
        }

        if (event.key === 'Home') {
          event.preventDefault();
          if (items[0]) items[0].focus();
        }

        if (event.key === 'End') {
          event.preventDefault();
          if (items.length) items[items.length - 1].focus();
        }

        if (event.key === 'Tab' || event.key === 'Escape') {
          commercialSetCustomSelectOpen(selectEl, false);
          if (event.key === 'Escape') {
            event.preventDefault();
            try { trigger.focus(); } catch (_) {}
          }
        }
      });

      shell.appendChild(trigger);
      shell.appendChild(menu);
      selectEl.insertAdjacentElement('afterend', shell);
    }

    const trigger = shell.querySelector('.commercial-custom-select-trigger');
    const textEl = shell.querySelector('.commercial-custom-select-trigger__text');
    const menu = shell.querySelector('.commercial-custom-select-menu');
    if (!trigger || !textEl || !menu) return;

    const selectedOption = selectEl.options && selectEl.selectedIndex >= 0
      ? selectEl.options[selectEl.selectedIndex]
      : (selectEl.options && selectEl.options.length ? selectEl.options[0] : null);
    const selectedValue = selectedOption ? String(selectedOption.value || '') : '';
    const selectedLabel = selectedOption ? String(selectedOption.text || '').trim() : '';
    const isPlaceholder = !selectedValue && /select|choose/i.test(selectedLabel);

    textEl.textContent = selectedLabel || 'Select...';
    textEl.classList.toggle('is-placeholder', isPlaceholder);
    trigger.disabled = !!selectEl.disabled;
    trigger.title = selectedLabel || 'Select';
    trigger.setAttribute('aria-label', commercialGetSelectLabel(selectEl));
    shell.classList.toggle('is-disabled', !!selectEl.disabled);

    menu.innerHTML = '';
    Array.from(selectEl.options || []).forEach(function (option) {
      const optionBtn = document.createElement('button');
      optionBtn.type = 'button';
      optionBtn.className = 'commercial-custom-select-option';
      optionBtn.setAttribute('role', 'option');
      optionBtn.dataset.value = String(option.value || '');
      optionBtn.textContent = String(option.text || '');
      optionBtn.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      optionBtn.classList.toggle('is-selected', !!option.selected);
      if (option.disabled) optionBtn.disabled = true;

      optionBtn.addEventListener('click', function () {
        if (option.disabled) return;
        const previousValue = String(selectEl.value || '');
        selectEl.value = String(option.value || '');
        commercialSyncCustomSelect(selectEl);
        commercialSetCustomSelectOpen(selectEl, false);
        if (previousValue !== String(selectEl.value || '')) {
          try { selectEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
          try { selectEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        }
        try { trigger.focus(); } catch (_) {}
      });

      menu.appendChild(optionBtn);
    });

    if (selectEl.disabled) commercialSetCustomSelectOpen(selectEl, false);
  }

  function commercialSyncAllCustomSelects(container) {
    commercialGetCustomSelects(container).forEach(commercialSyncCustomSelect);
  }

  function selectedServices() {
    return qsa('input[name="serviceNeeds"]:checked').map(function (input) {
      return input.value;
    });
  }

  function collectLeadPayload() {
    const smsOptIn = !!(byId('smsConsent') && byId('smsConsent').checked);
    return {
      publicToken: state.leadToken || '',
      fullName: byId('fullName') ? byId('fullName').value.trim() : '',
      companyName: byId('companyName') ? byId('companyName').value.trim() : '',
      phone: byId('phone') ? byId('phone').value.trim() : '',
      email: byId('email') ? byId('email').value.trim() : '',
      contactPreference: byId('contactPreference') ? byId('contactPreference').value : 'sms',
      smsOptIn,
      businessType: byId('businessType') ? byId('businessType').value : '',
      siteCount: byId('siteCount') ? byId('siteCount').value : '1',
      timeline: byId('timeline') ? byId('timeline').value : '',
      budgetBand: byId('budgetBand') ? byId('budgetBand').value : '',
      projectAddress: byId('projectAddress') ? byId('projectAddress').value.trim() : '',
      projectCity: byId('projectCity') ? byId('projectCity').value.trim() : '',
      projectState: byId('projectState') ? byId('projectState').value.trim() : '',
      projectPostalCode: byId('projectPostalCode') ? byId('projectPostalCode').value.trim() : '',
      scopeSummary: byId('scopeSummary') ? byId('scopeSummary').value.trim() : '',
      notes: byId('notes') ? byId('notes').value.trim() : '',
      serviceNeeds: selectedServices(),
      projectPhotoUrls: state.uploadedPhotos.slice(),
      assessmentAnswers: {
        decisionMaker: byId('decisionMaker') ? byId('decisionMaker').value : '',
        existingSystem: byId('existingSystem') ? byId('existingSystem').value : '',
        securityIncident: byId('securityIncident') ? byId('securityIncident').value : '',
        cameraCount: byId('cameraCount') ? byId('cameraCount').value : '',
        cameraPriority: byId('cameraPriority') ? byId('cameraPriority').value.trim() : '',
        displayCount: byId('displayCount') ? byId('displayCount').value : '',
        displayEnvironment: byId('displayEnvironment') ? byId('displayEnvironment').value.trim() : '',
        networkDrops: byId('networkDrops') ? byId('networkDrops').value : '',
        accessConstraints: byId('accessConstraints') ? byId('accessConstraints').value.trim() : '',
        churchSpaces: byId('churchSpaces') ? byId('churchSpaces').value.trim() : '',
        churchSchedule: byId('churchSchedule') ? byId('churchSchedule').value.trim() : ''
      },
      attribution: {
        utm_source: new URL(location.href).searchParams.get('utm_source') || '',
        utm_medium: new URL(location.href).searchParams.get('utm_medium') || '',
        utm_campaign: new URL(location.href).searchParams.get('utm_campaign') || '',
        referrer: document.referrer || '(direct)',
        surface: 'commercial-intake',
        communicationConsent: {
          smsOptIn,
          smsOptInText: SMS_CONSENT_COPY,
          smsOptInSource: 'commercial-intake-form'
        }
      }
    };
  }

  function persistDraft() {
    if (state.hydrating) return;
    if (!state.leadToken) {
      state.leadToken = getQueryLeadToken() || storage.getItem(STORAGE_KEY) || newIdentity();
      storage.setItem(STORAGE_KEY, state.leadToken);
    }
    const payload = collectLeadPayload();
    payload.publicToken = state.leadToken || '';
    const draft = {
      version: 2,
      savedAt: new Date().toISOString(),
      leadToken: state.leadToken || '',
      currentStep: state.currentStep,
      maxStepVisited: state.maxStepVisited,
      selectedSlotStart: state.selectedSlotStart || '',
      uploadedPhotos: state.uploadedPhotos.slice(0, 8),
      payload,
      dirty: state.dirty,
      localVersion: state.localVersion,
      revision: state.revision,
      pendingSave: state.pendingSave,
      submissionKey: state.submissionKey,
    };
    storage.setItem(DRAFT_KEY, JSON.stringify(draft));
    setLocalDraftState(DEFAULT_LOCAL_DRAFT_MESSAGE);
  }

  function hydrateForm(payload) {
    if (!payload) return;
    Object.entries(payload).forEach(function (entry) {
      const key = entry[0];
      const value = entry[1];
      if (key === 'serviceNeeds' && Array.isArray(value)) {
        qsa('input[name="serviceNeeds"]').forEach(function (input) {
          input.checked = value.indexOf(input.value) >= 0;
        });
        return;
      }
      if (key === 'assessmentAnswers' && value && typeof value === 'object') {
        Object.entries(value).forEach(function (nestedEntry) {
          const nestedKey = nestedEntry[0];
          const nestedValue = nestedEntry[1];
          const nestedField = byId(nestedKey);
          if (!nestedField) return;
          if (typeof nestedValue === 'string' || typeof nestedValue === 'number') {
            nestedField.value = String(nestedValue);
          }
        });
        return;
      }
      if (key === 'attribution' && value && typeof value === 'object') {
        const consentField = byId('smsConsent');
        if (consentField) consentField.checked = hasMessagingConsent({ attribution: value });
        return;
      }
      if (key === 'smsOptIn') {
        const consentField = byId('smsConsent');
        if (consentField) consentField.checked = hasMessagingConsent({ smsOptIn: value });
        return;
      }
      const field = byId(key);
      if (!field) return;
      if (typeof value === 'string' || typeof value === 'number') {
        field.value = String(value);
      }
    });
  }

  function applyDraft(rawDraft, options) {
    const draft = normalizeDraft(rawDraft);
    if (!draft) return false;
    if (options && options.requireTokenMatch && !draftMatchesLead(draft, state.leadToken)) {
      return false;
    }

    hydrateForm(draft.payload);
    state.selectedSlotStart = draft.selectedSlotStart || state.selectedSlotStart || '';
    if (draft.uploadedPhotos.length) {
      state.uploadedPhotos = draft.uploadedPhotos.slice();
    }
    state.maxStepVisited = Math.max(1, Math.min(WIZARD_STEPS.length, draft.maxStepVisited || 1));

    if (state.slots.length) {
      renderSlots(state.slots);
    }
    renderUploadedPhotos();
    renderConditionalCards();
    renderSelectedServices();
    syncChoicePills();
    renderAssessmentSnapshot();
    syncFollowUpCopy();
    showStep(Math.max(1, Math.min(state.maxStepVisited, draft.currentStep || 1)));
    return true;
  }

  function humanizeToken(value, fallback) {
    const normalized = String(value || '').trim();
    if (!normalized) return fallback;
    return normalized
      .split(/[_-]+/)
      .filter(Boolean)
      .map(function (piece) {
        return piece.charAt(0).toUpperCase() + piece.slice(1);
      })
      .join(' ');
  }

  function summarizeServicesForMessage(services) {
    const list = Array.isArray(services) ? services.filter(Boolean) : [];
    if (!list.length) return '';
    if (list.length <= 2) return list.join(' + ');
    return `${list.slice(0, 2).join(' + ')} +${list.length - 2} more`;
  }

  function buildCommercialSmsMessage() {
    const payload = collectLeadPayload();
    const lines = ['Hi, I need help with a commercial Home2Smart project.'];
    const services = summarizeServicesForMessage(payload.serviceNeeds);
    const siteType = payload.businessType ? humanizeToken(payload.businessType, '') : '';
    const timeline = window.H2SCommercialLabels.timeline(payload.timeline, '');
    const nameOrCompany = [payload.fullName, payload.companyName].filter(Boolean).join(' / ');
    const locationBits = [payload.projectCity, payload.projectState].filter(Boolean);
    const location = locationBits.length ? locationBits.join(', ') : payload.projectAddress;
    const slot = state.slots.find(function (item) {
      return item && item.startIso === state.selectedSlotStart;
    });

    if (services) lines.push(`Project: ${services}`);
    if (siteType) lines.push(`Site: ${siteType}`);
    if (timeline) lines.push(`Timeline: ${timeline}`);
    if (location) lines.push(`Location: ${truncateText(location, 80)}`);
    if (payload.scopeSummary) lines.push(`Scope: ${truncateText(payload.scopeSummary, 160)}`);
    if (nameOrCompany) lines.push(`Name: ${truncateText(nameOrCompany, 80)}`);
    if (slot) lines.push(`Requested window: ${formatSlot(slot.startIso, slot.endIso)}`);

    return lines.join('\n');
  }

  function syncChoicePills() {
    qsa('.choice-pill').forEach(function (pill) {
      const input = pill.querySelector('input[type="checkbox"]');
      pill.classList.toggle('is-selected', !!(input && input.checked));
    });
  }

  function renderSelectedServices() {
    const target = byId('selectedServicesRail');
    if (!target) return;
    const services = selectedServices();
    if (!services.length) {
      target.innerHTML = '<span class="status-pill status-pill--muted">Select at least one project focus</span>';
      return;
    }
    target.innerHTML = services.map(function (service) {
      return `<span class="status-pill">${escapeHtml(service)}</span>`;
    }).join('');
  }

  function toggleCard(id, show) {
    const node = byId(id);
    if (!node) return;
    node.classList.toggle('hidden', !show);
  }

  function renderConditionalCards() {
    const services = selectedServices();
    toggleCard('cameraDetailsCard', services.indexOf('Security Cameras') >= 0);
    toggleCard('displayDetailsCard', services.indexOf('Commercial Displays') >= 0);
    toggleCard('cablingDetailsCard', services.indexOf('Structured Cabling') >= 0 || services.indexOf('Wi-Fi Upgrades') >= 0);
    toggleCard('churchDetailsCard', byId('businessType') && byId('businessType').value === 'church');
  }

  function renderAssessmentSnapshot() {
    const payload = collectLeadPayload();
    const contact = payload.phone || payload.email
      ? [payload.phone, payload.email].filter(Boolean).join(' / ')
      : 'Add a phone or email';
    const locationBits = [payload.projectCity, payload.projectState].filter(Boolean);
    const locationText = locationBits.length ? locationBits.join(', ') : (payload.projectAddress || 'Add site details');
    const scopeText = payload.scopeSummary || (payload.serviceNeeds.length ? payload.serviceNeeds.join(', ') : 'Add a short scope summary');

    setText('assessmentBusinessType', humanizeToken(payload.businessType, 'Not selected'));
    setText('assessmentTimeline', window.H2SCommercialLabels.timeline(payload.timeline, 'Not selected'));
    setText('assessmentContact', contact);
    setText('assessmentPhotos', state.uploadedPhotos.length ? `${state.uploadedPhotos.length} file${state.uploadedPhotos.length === 1 ? '' : 's'}` : 'No files yet');

    setText('reviewServices', payload.serviceNeeds.length ? payload.serviceNeeds.join(', ') : 'Select a project focus');
    setText('reviewLocation', locationText);
    setText('reviewContact', contact);
    setText('reviewScope', scopeText);
  }

  function updateInternalMetrics(lead) {
    if (!lead) return;
    setText('completenessText', `${lead.completenessBucket || 'partial'} ${lead.completenessScore || 0}%`);
    setText('priorityText', String(lead.priorityTier || 'normal').replace(/_/g, ' '));
  }

  function wizardMeta(step) {
    const config = WIZARD_STEPS.find(function (item) { return item.number === step; }) || WIZARD_STEPS[0];
    setText('stepCounterText', `Step ${config.number} of ${WIZARD_STEPS.length}`);
    setText('wizardStatusText', config.message);
  }

  function showStep(step) {
    const nextStep = Math.max(1, Math.min(WIZARD_STEPS.length, Number(step || 1)));
    state.currentStep = nextStep;
    state.maxStepVisited = Math.max(state.maxStepVisited, nextStep);

    qsa('.wizard-card').forEach(function (card) {
      const cardStep = Number(card.getAttribute('data-step') || '0');
      card.classList.toggle('hidden', cardStep !== nextStep);
    });

    qsa('.wizard-step').forEach(function (button) {
      const targetStep = Number(button.getAttribute('data-step-target') || '0');
      button.classList.toggle('is-active', targetStep === nextStep);
      button.classList.toggle('is-complete', targetStep < nextStep || targetStep <= state.maxStepVisited - 1);
      if (targetStep > state.maxStepVisited) {
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.removeAttribute('aria-disabled');
      }
    });

    wizardMeta(nextStep);
    commercialQueueCustomSelectSync();
  }

  function scrollWizardStepIntoView(step) {
    const card = document.querySelector(`.wizard-card[data-step="${Math.max(1, Math.min(WIZARD_STEPS.length, Number(step || 1)))}"]`);
    if (!card || !card.scrollIntoView) return;
    const behavior = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
    const run = function () {
      try {
        card.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
      } catch (_) {}
    };
    try {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(run);
      });
    } catch (_) {
      window.setTimeout(run, 0);
    }
  }

  function validateStep(step) {
    const payload = collectLeadPayload();
    if (step === 1 && !payload.serviceNeeds.length) {
      showContactError({ field: 'serviceNeeds', message: 'Choose at least one service before continuing.' }, true);
      return false;
    }
    if (step === 2) {
      if (!payload.fullName && !payload.companyName) {
        showContactError({ field: 'fullName', message: 'Add a contact name or company name before continuing.' }, true);
        return false;
      }
      const contactError = validateContact(payload);
      if (contactError) {
        showContactError(contactError, true);
        return false;
      }
    }
    setStatus('', '');
    return true;
  }

  function moveToStep(targetStep) {
    const numericTarget = Math.max(1, Math.min(WIZARD_STEPS.length, Number(targetStep || 1)));
    if (numericTarget > state.currentStep && !validateStep(state.currentStep)) {
      return;
    }
    if (numericTarget > state.maxStepVisited + 1) {
      return;
    }
    showStep(numericTarget);
    scrollWizardStepIntoView(numericTarget);
    persistDraft();
  }

  function renderSlots(slots) {
    const target = byId('slotGrid');
    if (!target) return;
    state.slots = Array.isArray(slots) ? slots : [];

    if (!state.slots.length) {
      target.innerHTML = '<div class="slot-empty">No suggested times are available right now. Call us and we will help schedule the next step.</div>';
      return;
    }

    const manual = collectLeadPayload().contactPreference !== 'sms';
    const noWindow = manual ? `<label class="slot-option ${!state.selectedSlotStart ? 'is-selected' : ''}" data-slot-start=""><input type="radio" name="consultationSlot" value="" ${!state.selectedSlotStart ? 'checked' : ''}><strong>No preferred window</strong><span>Manual follow-up; timing pending review</span></label>` : '';
    target.innerHTML = noWindow + state.slots.map(function (slot, index) {
      const checked = state.selectedSlotStart ? state.selectedSlotStart === slot.startIso : !manual && index === 0;
      if (checked) state.selectedSlotStart = slot.startIso;
      return `
        <label class="slot-option ${checked ? 'is-selected' : ''}" data-slot-start="${escapeAttr(slot.startIso)}">
          <input type="radio" name="consultationSlot" value="${escapeAttr(slot.startIso)}" ${checked ? 'checked' : ''}>
          <strong>${escapeHtml(formatSlot(slot.startIso, slot.endIso))}</strong>
          <span>${escapeHtml(slot.durationMinutes ? `${slot.durationMinutes}-minute time window` : 'Time review required')}</span>
        </label>
      `;
    }).join('');

    qsa('input[name="consultationSlot"]').forEach(function (input) {
      input.addEventListener('change', function () {
        state.selectedSlotStart = input.value;
        qsa('.slot-option').forEach(function (card) {
          card.classList.toggle('is-selected', card.getAttribute('data-slot-start') === input.value);
        });
        persistDraft();
      });
    });
  }

  function applyConfig(config) {
    state.config = config || {};
    const callNumber = config.callNumber || DEFAULT_PHONE;
    const smsNumber = config.smsNumber || callNumber;
    ['headerCallLink', 'heroCallLink', 'footerCallLink', 'footerPhoneText'].forEach(function (id) {
      const node = byId(id);
      if (!node) return;
      node.setAttribute('href', phoneHref(callNumber));
    });

    setText('headerCallText', callNumber);
    setText('heroCallText', callNumber);
    setText('footerPhoneText', callNumber);

    [byId('heroSmsBtn'), byId('footerSmsBtn'), byId('stepSmsBtn')].forEach(function (button) {
      if (!button) return;
      button.onclick = function () {
        track('outbound_click', { target: 'sms', source: button.id });
        location.href = smsHref(smsNumber, buildCommercialSmsMessage());
      };
    });

    renderSlots(config.suggestedSlots || []);
    syncFollowUpCopy();
  }

  function getFriendlyLoadMessage(message) {
    const text = String(message || '').trim();
    if (!text) return 'Unable to load the live commercial intake right now.';
    if (text.toLowerCase().includes('not implemented')) {
      return 'This preview can be reviewed visually, but the live commercial routing service is unavailable in the current local environment.';
    }
    return text;
  }

  async function fetchIntakeConfig() {
    const token = state.leadToken || getQueryLeadToken() || storage.getItem(STORAGE_KEY) || '';
    const storedDraft = normalizeDraft(readDraft());
    const draft = storedDraft && (!token || draftMatchesLead(storedDraft, token)) ? storedDraft : null;
    state.pendingSave = draft && draft.pendingSave;
    state.localVersion = draft && draft.localVersion || 0;
    state.revision = draft && draft.revision || 0;
    state.submissionKey = draft && draft.submissionKey || newIdentity();
    if (token) state.leadToken = token;
    const url = token ? `${INTAKE_ENDPOINT}?token=${encodeURIComponent(token)}` : INTAKE_ENDPOINT;
    let payload;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to load commercial intake');
    } catch (error) {
      applyDraft(draft);
      state.dirty = !!(draft && draft.dirty);
      throw error;
    }
    applyConfig(payload.config || {});
    if (payload.lead) {
      state.lead = payload.lead;
      state.leadToken = payload.lead.publicToken || state.leadToken;
      storage.setItem(STORAGE_KEY, state.leadToken);
      updateLeadUrl(state.leadToken);
      hydrateForm(payload.lead);
      state.uploadedPhotos = Array.isArray(payload.lead.projectPhotoUrls) ? payload.lead.projectPhotoUrls.slice() : [];
      renderUploadedPhotos();
      updateInternalMetrics(payload.lead);
      state.revision = Number(payload.lead.revision || 0);
    }
    state.pendingSave = draft && draft.pendingSave;
    state.submissionKey = draft && draft.submissionKey || newIdentity();
    let restore = draft && (!payload.lead || draft.dirty);
    if (restore && payload.lead && draft.revision < state.revision) {
      if (draft.pendingSave && draft.pendingSave.saveKey === payload.lead.lastSaveKey) {
        state.pendingSave = null;
      } else if (window.confirm('A newer version was saved elsewhere. OK loads that server version. Cancel keeps your local edits without overwriting the server.')) {
        restore = false;
        state.pendingSave = null;
      } else {
        state.conflict = true;
      }
    }
    if (payload.submission) {
      restore = false;
      state.pendingSave = null;
    }
    state.dirty = !!restore;
    if (!restore || !applyDraft(draft, { requireTokenMatch: !!payload.lead })) {
      if (!payload.lead) hydrateForm(draft && draft.payload ? draft.payload : readDraft());
      renderConditionalCards();
      renderSelectedServices();
      syncChoicePills();
      renderAssessmentSnapshot();
      syncFollowUpCopy();
    }
    if (payload.lead) {
      setSaveState(state.dirty ? 'Unsaved local changes' : payload.submission ? 'Request submitted' : 'Draft saved', state.dirty ? '' : 'success', payload.submission
        ? 'Your follow-up request is submitted for review.'
        : state.dirty ? 'Local edits are not yet saved to the server. No follow-up request has been submitted.'
        : 'Project details saved. No follow-up request has been submitted yet.');
    }
    renderSubmission(payload.submission, !!(payload.submission && payload.submission.metadata && payload.submission.metadata.request_kind === 'manual_follow_up'));
  }

  async function saveLead(source) {
    const run = () => saveCurrentLead(source);
    saveChain = saveChain.then(run, run);
    return saveChain;
  }

  async function saveCurrentLead(source) {
    if (state.conflict) throw new Error('A newer saved draft exists. Reload to review it; your local edits are preserved.');
    persistDraft();
    const pending = state.pendingSave;
    const payload = pending ? pending.payload : collectLeadPayload();
    const contactError = validateContact(payload);
    if (contactError) {
      setSaveState('Draft on this device', 'error', 'No follow-up request has been submitted.');
      showContactError(contactError, source !== 'autosave');
      throw new Error(contactError.message);
    }

    setSaveState('Saving project', '', 'Saving your project details.');
    const snapshot = pending || { payload, revision: state.revision, saveKey: newIdentity(), version: state.localVersion };
    state.pendingSave = snapshot;
    persistDraft();
    let response;
    try {
      response = await fetch(INTAKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, revision: snapshot.revision, saveKey: snapshot.saveKey }),
      });
    } catch (error) {
      setSaveState('Save failed', 'error', 'Your edits remain on this device. Retry when the connection is available.');
      setStatus('Server save failed. Local edits are preserved; retry before submitting.', 'error');
      throw error;
    }
    const result = await response.json();
    if (!response.ok || !result.ok) {
      if (result.conflict) state.conflict = true;
      setSaveState('Save failed', 'error', result.error || 'We could not save your project details.');
      setStatus(result.error || 'We could not save your project details.', 'error');
      throw new Error(result.error || 'Failed to save lead');
    }

    if (payload.publicToken !== state.leadToken) {
      console.info('Discarded save response for a cleared device draft.');
      throw new Error('The previous device draft was cleared.');
    }
    state.lead = result.lead;
    state.revision = Number(result.lead.revision || 0);
    state.pendingSave = null;
    state.dirty = state.localVersion !== snapshot.version;
    state.leadToken = result.lead.publicToken;
    storage.setItem(STORAGE_KEY, state.leadToken);
    updateLeadUrl(state.leadToken);
    persistDraft();
    state.uploadedPhotos = Array.isArray(result.lead.projectPhotoUrls) ? result.lead.projectPhotoUrls.slice() : state.uploadedPhotos;
    renderUploadedPhotos();
    updateInternalMetrics(result.lead);
    renderAssessmentSnapshot();
    setLocalDraftState(DEFAULT_LOCAL_DRAFT_MESSAGE);
    setSaveState(state.submission ? 'Project changes saved' : 'Draft saved', 'success', state.submission ? 'Your existing request remains submitted.' : 'Project details saved. No follow-up request has been submitted yet.');
    setStatus(state.submission ? 'Project changes saved. Your existing request remains submitted.' : 'Draft saved. Submit your follow-up request when you are ready.', 'success');
    if (state.dirty) setSaveState('Unsaved changes', '', 'Saving the latest local changes next.');
    persistDraft();
    if (state.dirty) return saveCurrentLead(source);

    if (!state.firstLeadTracked) {
      state.firstLeadTracked = true;
      track('lead', { form_name: 'commercial_intake', source: source || 'autosave' });
    } else {
      track('form_submit', { form_name: 'commercial_intake_update', source: source || 'autosave' });
    }

    return result;
  }

  function renderUploadedPhotos() {
    const target = byId('uploadedPhotoList');
    if (!target) return;
    if (!state.uploadedPhotos.length) {
      target.innerHTML = '';
      renderAssessmentSnapshot();
      return;
    }
    target.innerHTML = state.uploadedPhotos.map(function (url, index) {
      return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Uploaded file ${index + 1}</a>`;
    }).join('');
    renderAssessmentSnapshot();
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhotos(files) {
    const run = () => uploadPhotoBatch(files);
    uploadChain = uploadChain.then(run, run);
    return uploadChain;
  }

  async function uploadPhotoBatch(files) {
    if (!files.length) return;
    if (state.uploadedPhotos.length + files.length > 8) throw new Error('A maximum of eight attachments is allowed.');
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) throw new Error('Use JPEG, PNG, WebP or PDF files.');
      if (file.size > 3 * 1024 * 1024) throw new Error('Each file must be 3 MB or smaller.');
    }
    const status = byId('photoUploadStatus');
    if (status) {
      status.textContent = 'Saving project before upload...';
      status.removeAttribute('data-tone');
    }

    if (!state.leadToken) {
      await saveLead('photo_upload');
    }

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (status) status.textContent = `Uploading ${file.name} (${index + 1}/${files.length})...`;
      const data = await fileToDataUrl(file);
      const response = await fetch(PHOTO_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicToken: state.leadToken,
          filename: file.name,
          mimetype: file.type,
          data,
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (status) {
          status.textContent = result.error || 'Upload failed.';
          status.setAttribute('data-tone', 'error');
        }
        throw new Error(result.error || 'Upload failed');
      }
      state.uploadedPhotos = Array.isArray(result.lead.projectPhotoUrls) ? result.lead.projectPhotoUrls.slice() : state.uploadedPhotos;
      renderUploadedPhotos();
      persistDraft();
    }

    if (status) {
      status.textContent = `${files.length} file${files.length === 1 ? '' : 's'} uploaded.`;
      status.setAttribute('data-tone', 'success');
    }
  }

  async function requestConsultation(event) {
    event.preventDefault();
    if (state.submitting || state.submission) return;
    state.submitting = true;
    try {
    const payload = collectLeadPayload();
    const followUpCopy = syncFollowUpCopy();
    const contactError = validateContact(payload);
    if (contactError) {
      showContactError(contactError, true);
      return;
    }
    if (!payload.fullName && !payload.companyName) {
      showContactError({ field: 'fullName', message: 'Add a contact name or business name before requesting your estimate.' }, true);
      return;
    }
    if (!payload.serviceNeeds.length) {
      showContactError({ field: 'serviceNeeds', message: 'Choose at least one service before requesting your estimate.' }, true);
      return;
    }
    if (!state.selectedSlotStart && payload.contactPreference === 'sms') {
      showContactError({ field: 'slotGrid', message: 'Choose a time before submitting.' }, true);
      return;
    }

    try {
      await uploadChain;
    } catch (error) {
      if (!window.confirm('Some attachments were not saved. Submit without the failed attachments? Cancel to return and retry them.')) {
        showStep(4);
        setStatus(error.message || 'Retry the failed attachments before submitting.', 'error');
        return;
      }
      uploadChain = Promise.resolve();
    }
    const saved = await saveLead('consultation_request');
    if (!state.submissionKey) state.submissionKey = newIdentity();
    persistDraft();
    setStatus(followUpCopy.sending, '');
    const selectedSlot = state.slots.find(function (slot) {
      return slot.startIso === state.selectedSlotStart;
    });
    const response = await fetch(CONSULTATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicToken: saved.lead.publicToken,
        submissionKey: state.submissionKey,
        selectedSlotStart: selectedSlot ? selectedSlot.startIso : state.selectedSlotStart,
        selectedSlotEnd: selectedSlot ? selectedSlot.endIso : '',
        preferredSlots: selectedSlot ? [selectedSlot] : [],
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      if (result.field) {
        showContactError({ field: result.field, message: result.error }, true);
        return;
      }
      setStatus(result.error || 'Consultation request failed.', 'error');
      return;
    }

    renderSubmission(result.consultation, result.notifications.manualReviewRequired);

    setStatus(followUpCopy.status, 'success');
    track('form_submit', {
      form_name: 'commercial_consultation_request',
      consultation_reference: result.consultation.referenceCode,
      manual_review_required: result.notifications.manualReviewRequired,
    });
    const successPanel = byId('consultationSuccessPanel');
    if (successPanel) successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    state.dirty = false;
    persistDraft();
    } catch (error) {
      setStatus(error && error.message || 'Request could not be confirmed. Your saved details and submission identity are preserved; retry safely.', 'error');
    } finally {
      state.submitting = false;
      syncFollowUpCopy();
    }
  }

  function renderHeroMedia(item, fallbackItems) {
    const stage = byId('heroMediaStage');
    const mediaUrl = mediaUrlFor(item);
    if (!stage || !item || !mediaUrl) return false;
    const requestId = ++heroMediaRequestId;
    const remainingFallbacks = Array.isArray(fallbackItems) ? fallbackItems.slice() : [];
    const nextFallback = remainingFallbacks.shift() || null;
    const poster = mediaPosterFor(item);
    const isVideo = String(item.media_kind || 'photo') === 'video';

    if (!isVideo) ensureHeroMediaPreload(mediaUrl);
    else clearHeroMediaPreload();

    stage.classList.remove('is-empty', 'is-ready');
    stage.classList.add('is-loading');
    stage.innerHTML = '<div class="media-stage__media"></div><span class="sr-only" id="heroMediaStatus">Loading recent installation photo...</span>';
    state.heroMediaApplied = true;
    const mediaWrap = stage.querySelector('.media-stage__media');
    if (!mediaWrap) return false;

    let mediaEl;
    if (isVideo) {
      mediaEl = document.createElement('video');
      mediaEl.autoplay = true;
      mediaEl.muted = true;
      mediaEl.loop = true;
      mediaEl.playsInline = true;
      mediaEl.preload = 'metadata';
      if (poster) mediaEl.poster = poster;
      mediaEl.setAttribute('aria-label', 'Approved commercial installation video');
      mediaEl.src = mediaUrl;
    } else {
      mediaEl = document.createElement('img');
      mediaEl.loading = 'eager';
      mediaEl.decoding = 'async';
      mediaEl.fetchPriority = 'high';
      mediaEl.sizes = '(max-width: 720px) calc(100vw - 24px), (max-width: 1100px) min(100vw - 40px, 1180px), 42vw';
      mediaEl.alt = 'Approved commercial installation photo';
      mediaEl.src = mediaUrl;
    }

    if (item.media_placement) mediaEl.style.cssText = window.H2SMediaPlacements.style(item.media_placement);
    mediaWrap.appendChild(mediaEl);
    setHeroStatus(isVideo ? 'Loading recent installation video...' : 'Loading recent installation photo...');

    let settled = false;
    const markReady = function () {
      if (settled || requestId !== heroMediaRequestId) return;
      settled = true;
      stage.classList.remove('is-loading', 'is-empty');
      stage.classList.add('is-ready');
      setHeroStatus(isVideo ? 'Recent installation video ready.' : 'Recent installation photo ready.');
    };

    const onError = function () {
      if (settled || requestId !== heroMediaRequestId) return;
      settled = true;
      recordMediaDiagnostic('warn', 'hero-media-error', {
        mediaKind: item.media_kind || 'photo',
        mediaUrl,
        hasNextFallback: Boolean(nextFallback),
      });
      if (nextFallback) {
        renderHeroMedia(nextFallback, remainingFallbacks);
        return;
      }
      renderHeroEmpty('Recent installation media is unavailable right now.');
    };

    if (mediaEl) {
      if (mediaEl.tagName === 'IMG' && mediaEl.complete && mediaEl.naturalWidth > 0) {
        markReady();
        return true;
      }
      mediaEl.addEventListener(mediaEl.tagName === 'IMG' ? 'load' : 'loadeddata', markReady, { once: true });
      mediaEl.addEventListener('error', onError, { once: true });
      if (mediaEl.tagName === 'IMG' && typeof mediaEl.decode === 'function') {
        mediaEl.decode().then(markReady).catch(function () {});
      }
    }
    return true;
  }

  function selectHeroMedia(cameraItems, tvItems) {
    if (state.heroMediaApplied) return true;
    const allCandidates = normalizeMediaItems([].concat(cameraItems || [], tvItems || []), 6);
    const photoCandidates = allCandidates.filter(function (item) {
      return String(item.media_kind || 'photo') !== 'video';
    });
    const videoCandidates = allCandidates.filter(function (item) {
      return String(item.media_kind || 'photo') === 'video';
    });
    const candidates = photoCandidates.concat(videoCandidates);
    if (!candidates.length) return false;
    return renderHeroMedia(candidates[0], candidates.slice(1));
  }

  function bindProofTileState(target) {
    if (!target) return;
    qsa('img, video', target).forEach(function (mediaEl) {
      const tile = mediaEl.closest('.proof-tile');
      if (!tile) return;
      const markReady = function () {
        tile.classList.remove('is-pending');
        tile.classList.add('is-ready');
      };

      if (mediaEl.tagName === 'IMG' && mediaEl.complete && mediaEl.naturalWidth > 0) {
        markReady();
        return;
      }

      mediaEl.addEventListener('load', markReady, { once: true });
      mediaEl.addEventListener('loadeddata', markReady, { once: true });
      mediaEl.addEventListener('error', function () {
        tile.classList.remove('is-pending');
      }, { once: true });
    });
  }

  function renderProofRail(target, items, emptyMessage) {
    const list = normalizeMediaItems(items, 4);
    if (!list.length) {
      target.innerHTML = `<div class="proof-empty">${escapeHtml(emptyMessage || 'Recent installation media is unavailable right now.')}</div>`;
      return;
    }
    target.innerHTML = list.map(function (item, index) {
      const mediaUrl = item.media_url;
      const poster = mediaPosterFor(item);
      const placementStyle = item.media_placement
        ? ` style="${escapeAttr(window.H2SMediaPlacements.style(item.media_placement))}"` : '';
      if (String(item.media_kind || 'photo') === 'video') {
        return `<div class="proof-tile is-pending"><video controls muted playsinline preload="none" ${poster ? `poster="${escapeAttr(poster)}" ` : ''}aria-label="Approved commercial installation video"${placementStyle} src="${escapeAttr(mediaUrl)}"></video></div>`;
      }
      const loading = index < 2 ? 'eager' : 'lazy';
      const fetchPriority = index < 2 ? 'auto' : 'low';
      return `<div class="proof-tile is-pending"><img loading="${loading}" fetchpriority="${fetchPriority}" decoding="async" sizes="(max-width: 720px) calc((100vw - 48px) / 2), (max-width: 1100px) 22vw, 18vw"${placementStyle} src="${escapeAttr(mediaUrl)}" alt="Approved commercial installation photo"></div>`;
    }).join('');
    bindProofTileState(target);
  }

  async function fetchProofGalleryMedia() {
    const result = await fetchJsonWithTimeout(PROOF_ENDPOINT, MEDIA_REQUEST_TIMEOUT_MS);
    const response = result.response;
    const payload = result.payload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to load proof gallery');
    }
    const cameraItems = normalizeMediaItems(payload.categories && payload.categories.cameras && payload.categories.cameras.items, 4);
    const tvItems = normalizeMediaItems(payload.categories && payload.categories.tv_mounting && payload.categories.tv_mounting.items, 4);
    recordMediaDiagnostic('info', 'proof-gallery-result', {
      status: response.status,
      cameraCount: cameraItems.length,
      displayCount: tvItems.length,
    });
    return { cameraItems, tvItems };
  }

  function applyProofGalleryMedia(cameraRail, tvRail, cameraItems, tvItems) {
    renderProofRail(cameraRail, cameraItems, 'No approved camera installs are available yet.');
    renderProofRail(tvRail, tvItems, 'No approved display installs are available yet.');
    if (!selectHeroMedia(cameraItems, tvItems)) {
      renderHeroEmpty('Recent installation media is unavailable right now.');
    }
  }

  async function loadProofGalleryFallback() {
    const cameraRail = byId('cameraProofRail');
    const tvRail = byId('tvProofRail');
    if (!cameraRail || !tvRail) return;

    try {
      const { cameraItems, tvItems } = await fetchProofGalleryMedia();
      applyProofGalleryMedia(cameraRail, tvRail, cameraItems, tvItems);
    } catch (error) {
      recordMediaDiagnostic('warn', 'proof-gallery-failed', {
        message: error && error.message ? error.message : 'Unknown proof gallery error',
      });
      cameraRail.innerHTML = '<div class="proof-empty">Proof gallery unavailable right now.</div>';
      tvRail.innerHTML = '<div class="proof-empty">Proof gallery unavailable right now.</div>';
      if (!state.heroMediaApplied) renderHeroEmpty('Recent installation media is unavailable right now.');
    }
  }

  async function loadCommercialMedia() {
    const cameraRail = byId('cameraProofRail');
    const tvRail = byId('tvProofRail');
    if (!cameraRail || !tvRail) return;

    const proofGalleryPromise = fetchProofGalleryMedia().catch(function (error) {
      recordMediaDiagnostic('warn', 'proof-gallery-prefetch-failed', {
        message: error && error.message ? error.message : 'Unknown proof gallery error',
      });
      return null;
    });

    try {
      const result = await fetchJsonWithTimeout(COMMERCIAL_MEDIA_ENDPOINT, MEDIA_REQUEST_TIMEOUT_MS);
      const response = result.response;
      const payload = result.payload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to load commercial media');

      const sections = payload.sections || {};
      const cameraItems = normalizeMediaItems(sections.commercial_security_rail && sections.commercial_security_rail.items, 4);
      const tvItems = normalizeMediaItems(sections.commercial_display_rail && sections.commercial_display_rail.items, 4);
      const hasHeroSelection = !!sections.commercial_hero;
      const heroItems = normalizeMediaItems(sections.commercial_hero && sections.commercial_hero.items, 6);
      recordMediaDiagnostic('info', 'owner-media-result', {
        status: response.status,
        cameraCount: cameraItems.length,
        displayCount: tvItems.length,
      });
      if (!cameraItems.length && !tvItems.length && !hasHeroSelection) {
        const fallback = await proofGalleryPromise;
        if (fallback) {
          applyProofGalleryMedia(cameraRail, tvRail, fallback.cameraItems, fallback.tvItems);
          return;
        }
        await loadProofGalleryFallback();
        return;
      }
      renderProofRail(cameraRail, cameraItems, 'No approved camera installs are available yet.');
      renderProofRail(tvRail, tvItems, 'No approved display installs are available yet.');
      if (hasHeroSelection) {
        if (heroItems.length) renderHeroMedia(heroItems[0], heroItems.slice(1));
        else renderHeroEmpty('No installation media is selected for this area.');
      } else if (!selectHeroMedia(cameraItems, tvItems)) {
        const fallback = await proofGalleryPromise;
        if (fallback) {
          applyProofGalleryMedia(cameraRail, tvRail, fallback.cameraItems, fallback.tvItems);
          return;
        }
        await loadProofGalleryFallback();
      }
    } catch (error) {
      recordMediaDiagnostic('warn', 'owner-media-failed', {
        endpoint: COMMERCIAL_MEDIA_ENDPOINT,
        message: error && error.message ? error.message : 'Unknown owner-media error',
      });
      const fallback = await proofGalleryPromise;
      if (fallback) {
        applyProofGalleryMedia(cameraRail, tvRail, fallback.cameraItems, fallback.tvItems);
        return;
      }
      await loadProofGalleryFallback();
    }
  }

  function bindEventTracking() {
    qsa('[data-phone-link]').forEach(function (link) {
      link.addEventListener('click', function () {
        track('click', { click_type: 'phone', source: link.getAttribute('data-track-source') || 'phone-link' });
      });
    });
    const heroStartBtn = byId('heroStartBtn');
    if (heroStartBtn) {
      heroStartBtn.addEventListener('click', function () {
        track('click', { click_type: 'cta', source: 'hero-start-assessment' });
      });
    }
  }

  function maybeAutosave() {
    const payload = collectLeadPayload();
    persistDraft();
    const error = validateContact(payload);
    if (error) {
      showContactError(error, false);
      return;
    }
    saveLead('autosave').catch(function () {});
  }

  async function refreshSlots() {
    try {
      const token = state.leadToken || getQueryLeadToken() || '';
      const response = await fetch(token ? `${INTAKE_ENDPOINT}?token=${encodeURIComponent(token)}` : INTAKE_ENDPOINT, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to refresh slots');
      applyConfig(payload.config || {});
      setStatus('Suggested consultation windows refreshed.', 'success');
    } catch (error) {
      setStatus(error.message || 'Failed to refresh slots.', 'error');
    }
  }

  function bindWizard() {
    qsa('.wizard-step').forEach(function (button) {
      button.addEventListener('click', function () {
        const targetStep = Number(button.getAttribute('data-step-target') || '1');
        if (targetStep <= state.maxStepVisited) moveToStep(targetStep);
      });
    });

    qsa('[data-step-action="next"]').forEach(function (button) {
      button.addEventListener('click', function () {
        moveToStep(state.currentStep + 1);
      });
    });

    qsa('[data-step-action="prev"]').forEach(function (button) {
      button.addEventListener('click', function () {
        moveToStep(state.currentStep - 1);
      });
    });
  }

  function bindForm() {
    const form = byId('commercialIntakeForm');
    if (form) {
      form.addEventListener('submit', function (event) {
        requestConsultation(event).catch(function (error) {
          setStatus(error.message || 'Consultation request failed.', 'error');
        });
      });
    }

    const syncFieldState = function () {
      if (!state.hydrating) {
        state.dirty = true;
        state.localVersion += 1;
      }
      persistDraft();
      syncChoicePills();
      renderSelectedServices();
      renderConditionalCards();
      renderAssessmentSnapshot();
      syncFollowUpCopy();
    };

    qsa('input, select, textarea').forEach(function (field) {
      field.addEventListener('input', function () {
        field.removeAttribute('aria-invalid');
        syncFieldState();
      });
      field.addEventListener('change', function () {
        syncFieldState();
      });
    });

    ['fullName', 'companyName', 'phone', 'email', 'contactPreference', 'smsConsent'].forEach(function (id) {
      const field = byId(id);
      if (field) field.addEventListener('blur', maybeAutosave);
    });

    ['contactPreference', 'smsConsent'].forEach(function (id) {
      const field = byId(id);
      if (field) field.addEventListener('change', maybeAutosave);
    });
    if (byId('contactPreference')) byId('contactPreference').addEventListener('change', function () {
      renderSlots(state.slots);
    });

    const saveProgressBtn = byId('saveProgressBtn');
    if (saveProgressBtn) {
      saveProgressBtn.addEventListener('click', function () {
        saveLead('manual_save').catch(function () {});
      });
    }

    const projectPhotosInput = byId('projectPhotosInput');
    if (projectPhotosInput) {
      projectPhotosInput.addEventListener('change', function () {
        const files = Array.from(projectPhotosInput.files || []);
        uploadPhotos(files).catch(function (error) {
          const status = byId('photoUploadStatus');
          if (status) {
            status.textContent = error.message || 'Upload failed.';
            status.setAttribute('data-tone', 'error');
            status.setAttribute('role', 'alert');
          }
        }).finally(function () {
          projectPhotosInput.value = '';
        });
      });
    }

    const refreshSlotsBtn = byId('refreshSlotsBtn');
    if (refreshSlotsBtn) {
      refreshSlotsBtn.addEventListener('click', function () {
        refreshSlots();
      });
    }
  }

  async function init() {
    setLocalDraftState(DEFAULT_LOCAL_DRAFT_MESSAGE);
    renderSelectedServices();
    syncChoicePills();
    renderConditionalCards();
    renderAssessmentSnapshot();
    syncFollowUpCopy();
    commercialSyncAllCustomSelects(document);
    bindWizard();
    bindForm();
    bindEventTracking();
    showStep(1);
    setStatus('Loading commercial assessment...', '');

    try {
      await fetchIntakeConfig();
      commercialSyncAllCustomSelects(document);
      setStatus('Review your project details and submit your follow-up request when ready.', '');
    } catch (error) {
      setStatus(getFriendlyLoadMessage(error.message || 'Failed to load commercial intake.'), 'error');
    }

    state.hydrating = false;
    persistDraft();
    loadCommercialMedia();
    track('page_view', { page_type: 'commercial_intake' });
    track('view_content', { content_name: 'Commercial Intake', content_type: 'service' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
