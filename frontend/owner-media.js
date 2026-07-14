(function () {
  const DASH_SESSION_TOKEN_KEY = 'h2s_dashboard_session_token_v1';
  const OWNER_SELECTED_FILES_KEY = 'h2s_owner_media_selected_files_v1';
  const DEFAULT_REMOTE_API_ORIGIN = 'https://h2s-backend.vercel.app';
  const API_ORIGIN = resolveApiOrigin();
  const OWNER_SESSION_API = '/api/owner-media/session';
  const OWNER_UPLOADS_API = '/api/owner-media/uploads';
  const LARGE_UPLOAD_BYTES = 4 * 1024 * 1024;
  const MIN_REFRESH_INTERVAL_MS = 1200;
  const OWNER_GALLERY_PAGE_SIZE = 12;
  const OWNER_GALLERY_LIMIT = 500;
  const RECENT_SKELETON_COUNT = 3;

  const state = {
    me: null,
    localUploads: [],
    recentUploads: [],
    removingAssetIds: new Set(),
    captureContext: null,
    captureContextPromise: null,
    refreshTimer: null,
    refreshPromise: null,
    pendingRefreshOptions: null,
    lastRefreshAt: 0,
    savedFingerprints: loadSavedFingerprints(),
    renderedUploadKeys: new Set(),
    readyPreviewKeys: new Set(),
    lastRenderedSignature: '',
    activeStageView: 'boot',
    remoteVisibleCount: OWNER_GALLERY_PAGE_SIZE,
  };

  const elements = {
    ownerStage: document.getElementById('ownerStage'),
    bootPanel: document.getElementById('bootPanel'),
    authPanel: document.getElementById('authPanel'),
    workbench: document.getElementById('workbench'),
    sessionBadge: document.getElementById('sessionBadge'),
    syncStripMeta: document.getElementById('syncStripMeta'),
    userDisplay: document.getElementById('userDisplay'),
    sessionMeta: document.getElementById('sessionMeta'),
    loginForm: document.getElementById('loginForm'),
    loginPin: document.getElementById('loginPin'),
    loginSubmit: document.getElementById('loginSubmit'),
    loginStatus: document.getElementById('loginStatus'),
    logoutButton: document.getElementById('logoutButton'),
    dropzone: document.getElementById('dropzone'),
    browseButton: document.getElementById('browseButton'),
    photoCaptureButton: document.getElementById('photoCaptureButton'),
    videoCaptureButton: document.getElementById('videoCaptureButton'),
    fileInput: document.getElementById('fileInput'),
    cameraPhotoInput: document.getElementById('cameraPhotoInput'),
    cameraVideoInput: document.getElementById('cameraVideoInput'),
    uploadStatus: document.getElementById('uploadStatus'),
    recentUploadsList: document.getElementById('recentUploadsList'),
    recentSyncStatus: document.getElementById('recentSyncStatus'),
    galleryMeta: document.getElementById('ownerGalleryMeta'),
    galleryLoadMoreButton: document.getElementById('ownerGalleryLoadMore'),
  };

  function resolveApiOrigin() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const queryOrigin = String(params.get('apiOrigin') || '').trim();
      const globalOrigin = String(window.H2S_OWNER_MEDIA_API_ORIGIN || '').trim();
      const candidate = queryOrigin || globalOrigin;
      if (candidate) return candidate.replace(/\/+$/, '');
    } catch {
      // ignore query parsing failures
    }

    if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return DEFAULT_REMOTE_API_ORIGIN;
    }

    return '';
  }

  function buildApiUrl(url) {
    const value = String(url || '').trim();
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    if (!value.startsWith('/')) return value;
    return API_ORIGIN ? `${API_ORIGIN}${value}` : value;
  }

  function fingerprintFile(file) {
    return [
      String(file && file.name || '').trim().toLowerCase(),
      Number(file && file.size || 0),
      Number(file && file.lastModified || 0),
      String(file && file.type || '').trim().toLowerCase(),
    ].join(':');
  }

  function loadSavedFingerprints() {
    try {
      const raw = localStorage.getItem(OWNER_SELECTED_FILES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((value) => typeof value === 'string' && value));
    } catch {
      return new Set();
    }
  }

  function persistSavedFingerprints() {
    try {
      const values = Array.from(state.savedFingerprints).slice(-250);
      localStorage.setItem(OWNER_SELECTED_FILES_KEY, JSON.stringify(values));
    } catch {
      // ignore storage failures
    }
  }

  function rememberUploadedEntries(entries) {
    entries.forEach((entry) => {
      if (entry && entry.fingerprint) state.savedFingerprints.add(entry.fingerprint);
    });
    persistSavedFingerprints();
  }

  function clearRememberedUploads() {
    state.savedFingerprints.clear();
    persistSavedFingerprints();
  }

  function resolveCaptureContextFromPosition(position) {
    const coords = position && position.coords ? position.coords : null;
    const latitude = coords ? Number(coords.latitude) : NaN;
    const longitude = coords ? Number(coords.longitude) : NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      lat: Number(latitude.toFixed(6)),
      lng: Number(longitude.toFixed(6)),
      captured_at: new Date().toISOString(),
    };
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timerId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, Math.max(0, Number(timeoutMs || 0)));

      Promise.resolve(promise)
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timerId);
          resolve(value || null);
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timerId);
          resolve(null);
        });
    });
  }

  function getUploadCaptureContext() {
    const cached = state.captureContext;
    if (cached && (Date.now() - Number(cached.resolvedAt || 0)) < 10 * 60 * 1000) {
      return Promise.resolve(cached.value || null);
    }
    if (state.captureContextPromise) return state.captureContextPromise;
    if (!window.isSecureContext || !navigator.geolocation) {
      return Promise.resolve(null);
    }

    state.captureContextPromise = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(resolveCaptureContextFromPosition(position)),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 2500, maximumAge: 5 * 60 * 1000 },
      );
    }).then((value) => {
      state.captureContext = { value: value || null, resolvedAt: Date.now() };
      state.captureContextPromise = null;
      return value || null;
    }).catch(() => {
      state.captureContext = { value: null, resolvedAt: Date.now() };
      state.captureContextPromise = null;
      return null;
    });

    return state.captureContextPromise;
  }

  function setSyncStatus(message, mode) {
    if (elements.syncStripMeta) {
      elements.syncStripMeta.textContent = String(message || '');
      elements.syncStripMeta.className = '';
      if (mode === 'ok') elements.syncStripMeta.classList.add('owner-sync-strip__ok');
      if (mode === 'warn') elements.syncStripMeta.classList.add('owner-sync-strip__warn');
    }
    if (elements.recentSyncStatus) elements.recentSyncStatus.textContent = String(message || '');
  }

  function readToken() {
    try {
      return String(localStorage.getItem(DASH_SESSION_TOKEN_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function writeToken(token) {
    try {
      const value = String(token || '').trim();
      if (!value) localStorage.removeItem(DASH_SESSION_TOKEN_KEY);
      else localStorage.setItem(DASH_SESSION_TOKEN_KEY, value);
    } catch {
      // ignore
    }
  }

  function revokeLocalPreviews() {
    state.localUploads.forEach((entry) => {
      try {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      } catch {
        // ignore preview cleanup failures
      }
    });
  }

  async function fetchJson(url, init, options) {
    const requestInit = Object.assign({}, init || {});
    const headers = new Headers(requestInit.headers || {});
    const requireAuth = !options || options.auth !== false;
    if (requireAuth) {
      const token = readToken();
      if (token && !headers.get('authorization')) headers.set('authorization', `Bearer ${token}`);
    }
    requestInit.headers = headers;

    let response;
    try {
      response = await fetch(buildApiUrl(url), requestInit);
    } catch {
      throw new Error('Could not reach the upload service right now.');
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const message = data && data.error ? String(data.error) : `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTimestamp(value) {
    if (!value) return 'Just now';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function formatFileSize(kbValue) {
    const kb = Number(kbValue || 0);
    if (!Number.isFinite(kb) || kb <= 0) return '';
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${Math.round(kb)} KB`;
  }

  function isVideoKind(value) {
    return String(value || '').trim().toLowerCase() === 'video';
  }

  function getUploadKey(bucket, path) {
    const safeBucket = String(bucket || '').trim();
    const safePath = String(path || '').trim();
    return safeBucket && safePath ? `${safeBucket}:${safePath}` : '';
  }

  function toUserMessage(error, fallback) {
    const raw = String(error && error.message ? error.message : fallback || '').trim();
    const lower = raw.toLowerCase();
    if (!raw) return fallback || 'Something went wrong.';
    if (lower.includes('invalid input syntax for type uuid')) return fallback || 'Recent uploads are temporarily unavailable.';
    if (lower.includes('proof_assets')) return fallback || 'Recent uploads are temporarily unavailable.';
    if (lower.includes('exceed_cached_egress_quota')) return 'Gallery is temporarily unavailable. New uploads can still be sent.';
    if (lower.includes('service for this project is restricted')) return 'Gallery is temporarily unavailable. New uploads can still be sent.';
    if (lower.includes('request failed (500)')) return fallback || 'Couldn’t send right now. Try again.';
    return raw;
  }

  function resetFileInputs() {
    if (elements.fileInput) elements.fileInput.value = '';
    if (elements.cameraPhotoInput) elements.cameraPhotoInput.value = '';
    if (elements.cameraVideoInput) elements.cameraVideoInput.value = '';
  }

  function removeLocalUpload(uploadId) {
    const retained = [];
    state.localUploads.forEach((entry) => {
      if (entry.id === uploadId) {
        try {
          if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
        } catch {
          // ignore preview cleanup failures
        }
        return;
      }
      retained.push(entry);
    });
    state.localUploads = retained;
  }

  function pruneSyncedLocalUploads() {
    const remoteKeys = new Set(state.recentUploads.map((upload) => getUploadKey(upload.storage_bucket, upload.storage_path)).filter(Boolean));
    const retained = [];
    state.localUploads.forEach((entry) => {
      const key = getUploadKey(entry.storageBucket, entry.storagePath);
      if (entry.status === 'saved' && key && remoteKeys.has(key)) {
        try {
          if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
        } catch {
          // ignore preview cleanup failures
        }
        return;
      }
      retained.push(entry);
    });
    state.localUploads = retained;
  }

  function updateUploadStatusLine() {
    if (!elements.uploadStatus) return;
    const activeCount = state.localUploads.filter((entry) => entry.status === 'sending').length;
    if (activeCount > 0) {
      elements.uploadStatus.textContent = activeCount === 1 ? '1 upload is still sending.' : `${activeCount} uploads are still sending.`;
      return;
    }
    const hasError = state.localUploads.some((entry) => entry.status === 'error');
    if (hasError) {
      elements.uploadStatus.textContent = 'Some uploads need another try.';
      return;
    }
    elements.uploadStatus.textContent = '';
  }

  function updateGalleryPagingUi(totalUploads) {
    const total = Math.max(0, Number(totalUploads || 0));
    const shown = Math.max(0, Number(state.recentUploads.length || 0));
    if (elements.galleryMeta) {
      if (!total) elements.galleryMeta.textContent = 'No uploads in your gallery yet.';
      else if (shown >= total) elements.galleryMeta.textContent = `All ${total} uploads shown.`;
      else elements.galleryMeta.textContent = `Showing ${shown} of ${total} uploads.`;
    }

    if (elements.galleryLoadMoreButton) {
      const remaining = Math.max(0, total - shown);
      const nextCount = Math.min(OWNER_GALLERY_PAGE_SIZE, remaining);
      elements.galleryLoadMoreButton.classList.toggle('is-hidden', nextCount <= 0);
      elements.galleryLoadMoreButton.disabled = nextCount <= 0;
      elements.galleryLoadMoreButton.textContent = nextCount > 0 ? `Load ${nextCount} more` : 'All uploads shown';
    }
  }

  function getRenderItemKey(item) {
    if (item && item.local) return `local:${String(item.id || '').trim()}`;
    const assetId = String(item && item.asset_id || '').trim();
    if (assetId) return `remote:${assetId}`;
    return `remote:${getUploadKey(item && item.storage_bucket, item && item.storage_path)}`;
  }

  function buildItemsSignature(items) {
    if (!Array.isArray(items) || !items.length) return '__empty__';
    return items.map((item) => {
      const removeFlag = item && item.asset_id && state.removingAssetIds.has(item.asset_id) ? 'removing' : 'steady';
      return [
        getRenderItemKey(item),
        item && item.local ? String(item.status || '') : String(item && item.review_state || ''),
        String(item && item.note || ''),
        removeFlag,
      ].join('|');
    }).join('||');
  }

  function renderRecentSkeleton(count) {
    if (!elements.recentUploadsList) return;
    const total = Math.max(1, Number(count || RECENT_SKELETON_COUNT));
    elements.recentUploadsList.innerHTML = Array.from({ length: total }).map(() => `
      <article class="owner-upload-card owner-upload-card--skeleton">
        <div class="owner-upload-card__preview"></div>
        <div class="owner-upload-card__body">
          <div class="owner-skeleton owner-skeleton--line owner-skeleton--line-strong"></div>
          <div class="owner-skeleton owner-skeleton--line"></div>
          <div class="owner-skeleton owner-skeleton--chip-row"></div>
        </div>
      </article>
    `).join('');
    state.lastRenderedSignature = `__skeleton__:${total}`;
    updateUploadStatusLine();
  }

  function setStageView(view, options) {
    const safeView = view === 'workbench' || view === 'auth' ? view : 'boot';
    if (state.activeStageView === safeView && !(options && options.force)) return;
    state.activeStageView = safeView;
    if (elements.ownerStage) elements.ownerStage.dataset.view = safeView;

    const panels = {
      boot: elements.bootPanel,
      auth: elements.authPanel,
      workbench: elements.workbench,
    };

    Object.keys(panels).forEach((key) => {
      const panel = panels[key];
      if (!panel) return;
      const isActive = key === safeView;
      panel.classList.toggle('is-active', isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    if (safeView === 'auth' && options && options.focusLogin && elements.loginPin) {
      window.requestAnimationFrame(() => {
        try {
          elements.loginPin.focus({ preventScroll: true });
        } catch {
          elements.loginPin.focus();
        }
      });
    }
  }

  function renderLocalUploadCard(entry, isNew) {
    const title = isVideoKind(entry.kind) ? 'Video upload' : 'Photo upload';
    const previewReadyKey = getPreviewReadyKey(entry, true);
    const previewClass = `owner-upload-card__preview${state.readyPreviewKeys.has(previewReadyKey) ? ' is-ready' : ''}`;
    const preview = isVideoKind(entry.kind)
      ? `<video src="${escapeHtml(entry.previewUrl)}" muted playsinline preload="metadata"></video>`
      : `<img src="${escapeHtml(entry.previewUrl)}" alt="${escapeHtml(title)}">`;
    const meta = [formatTimestamp(entry.createdAt), entry.file ? entry.file.name : ''].filter(Boolean).join(' · ');
    const detail = [isVideoKind(entry.kind) ? 'Video' : 'Photo', formatFileSize(entry.fileSizeKb)].filter(Boolean).join(' · ');
    const isRemoving = entry.assetId && state.removingAssetIds.has(entry.assetId);
    const badgeState = isRemoving ? 'removing' : (entry.status === 'error' ? 'error' : (entry.status === 'saved' ? 'saved' : 'sending'));
    const badgeText = isRemoving ? 'Removing' : (entry.status === 'error' ? 'Try again' : (entry.status === 'saved' ? 'Saved' : 'Sending'));
    const badgeInner = entry.status === 'sending' && !isRemoving
      ? '<span class="owner-upload-card__badge-dot" aria-hidden="true"></span><span>Sending</span>'
      : escapeHtml(badgeText);
    const noteText = isRemoving
      ? 'Removing now.'
      : (entry.status === 'error' ? 'Couldn’t send. Try again.' : (entry.status === 'saved' ? 'Saved. Take a quick look and remove anything that should not stay here.' : 'Still sending. Larger files can take a moment.'));
    const action = entry.status === 'error'
      ? `<div class="owner-upload-card__actions"><button class="owner-text-btn" type="button" onclick="window.ownerMediaRetryUpload('${escapeHtml(entry.id)}')">Try again</button></div>`
      : ((entry.status === 'saved' && entry.assetId && !isRemoving)
        ? `<div class="owner-upload-card__actions"><button class="owner-text-btn" type="button" onclick="window.ownerMediaDeleteUpload('${escapeHtml(entry.assetId)}')">Remove</button></div>`
        : '');

    return `
      <article class="owner-upload-card">
        <div class="${previewClass}" data-preview-key="${escapeHtml(previewReadyKey)}">${preview}</div>
        <div class="owner-upload-card__body">
          <div class="owner-upload-card__row">
            <div>
              <p class="owner-upload-card__title">${escapeHtml(title)}</p>
              <p class="owner-upload-card__meta">${escapeHtml(meta)}</p>
            </div>
            <span class="owner-upload-card__badge" data-state="${escapeHtml(badgeState)}">${badgeInner}</span>
          </div>
          <div class="owner-upload-card__chips">
            ${detail ? `<span class="owner-chip">${escapeHtml(detail)}</span>` : ''}
          </div>
          <p class="owner-upload-card__note">${escapeHtml(noteText)}</p>
          ${action}
        </div>
      </article>
    `;
  }

  function renderRemoteUploadCard(upload, isNew) {
    const title = isVideoKind(upload.media_kind) ? 'Video upload' : 'Photo upload';
    const previewUrl = buildApiUrl(upload.preview_url || upload.direct_url || '');
    const posterUrl = buildApiUrl(upload.poster_url || '');
    const previewReadyKey = getPreviewReadyKey(upload, false);
    const previewClass = `owner-upload-card__preview${state.readyPreviewKeys.has(previewReadyKey) ? ' is-ready' : ''}`;
    const preview = isVideoKind(upload.media_kind)
      ? `<video src="${escapeHtml(previewUrl)}" ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ''} muted playsinline preload="metadata"></video>`
      : `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(title)}">`;
    const meta = [formatTimestamp(upload.submitted_at)].filter(Boolean).join(' · ');
    const detail = [isVideoKind(upload.media_kind) ? 'Video' : 'Photo', formatFileSize(upload.file_size_kb)].filter(Boolean).join(' · ');
    const isRemoving = state.removingAssetIds.has(upload.asset_id);
    const isPublished = !!upload.is_visible || upload.review_state === 'published';
    const badgeState = isRemoving ? 'removing' : (isPublished ? 'published' : 'saved');
    const badgeText = isRemoving ? 'Removing' : (isPublished ? 'Live' : 'Saved');
    const noteText = isRemoving
      ? 'Removing now.'
      : (isPublished ? 'Live on customer page.' : 'Saved. Remove anything that should not stay here.');
    const action = !isRemoving
      ? `<div class="owner-upload-card__actions"><button class="owner-text-btn" type="button" onclick="window.ownerMediaDeleteUpload('${escapeHtml(upload.asset_id)}')">Remove</button></div>`
      : '';

    return `
      <article class="owner-upload-card">
        <div class="${previewClass}" data-preview-key="${escapeHtml(previewReadyKey)}">${preview}</div>
        <div class="owner-upload-card__body">
          <div class="owner-upload-card__row">
            <div>
              <p class="owner-upload-card__title">${escapeHtml(title)}</p>
              <p class="owner-upload-card__meta">${escapeHtml(meta)}</p>
            </div>
            <span class="owner-upload-card__badge" data-state="${escapeHtml(badgeState)}">${escapeHtml(badgeText)}</span>
          </div>
          <div class="owner-upload-card__chips">
            ${detail ? `<span class="owner-chip">${escapeHtml(detail)}</span>` : ''}
          </div>
          <p class="owner-upload-card__note">${escapeHtml(noteText)}</p>
          ${upload.note ? `<p class="owner-upload-card__note">${escapeHtml(upload.note)}</p>` : ''}
          ${action}
        </div>
      </article>
    `;
  }

  function renderUploads(items, options) {
    const signature = buildItemsSignature(items);
    const forceRender = !!(options && options.force);
    if (!forceRender && signature === state.lastRenderedSignature) {
      updateUploadStatusLine();
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      elements.recentUploadsList.innerHTML = '<div class="owner-empty-state">No uploads yet.</div>';
      state.lastRenderedSignature = signature;
      updateUploadStatusLine();
      return;
    }

    elements.recentUploadsList.innerHTML = items
      .map((item) => {
        const key = getRenderItemKey(item);
        const isNew = !state.renderedUploadKeys.has(key);
        state.renderedUploadKeys.add(key);
        return item.local ? renderLocalUploadCard(item, isNew) : renderRemoteUploadCard(item, isNew);
      })
      .join('');
    state.lastRenderedSignature = signature;
    updateUploadStatusLine();
  }

  function getPreviewReadyKey(item, isLocal) {
    if (!item) return '';
    const assetId = String(item.assetId || item.asset_id || '').trim();
    if (assetId) return `asset:${assetId}`;
    const storageBucket = String(item.storageBucket || item.storage_bucket || '').trim();
    const storagePath = String(item.storagePath || item.storage_path || '').trim();
    if (storageBucket && storagePath) return `storage:${storageBucket}:${storagePath}`;
    const previewUrl = String(item.previewUrl || item.preview_url || item.direct_url || '').trim();
    if (previewUrl) return `url:${previewUrl}`;
    const localId = isLocal ? String(item.id || '').trim() : '';
    return localId ? `local:${localId}` : '';
  }

  function renderVisibleUploads(options) {
    const localKeys = new Set(state.localUploads.map((entry) => getUploadKey(entry.storageBucket, entry.storagePath)).filter(Boolean));
    const remoteItems = state.recentUploads.filter((upload) => !localKeys.has(getUploadKey(upload.storage_bucket, upload.storage_path)));
    renderUploads([
      ...state.localUploads.map((entry) => ({ ...entry, local: true })),
      ...remoteItems,
    ], options);
    hydratePreviewReadiness();
  }

  function markPreviewReady(node) {
    const preview = node && node.closest ? node.closest('.owner-upload-card__preview') : null;
    if (!preview) return;
    const previewKey = String(preview.getAttribute('data-preview-key') || '').trim();
    if (previewKey) state.readyPreviewKeys.add(previewKey);
    preview.classList.add('is-ready');
  }

  function hydratePreviewReadiness() {
    if (!elements.recentUploadsList) return;
    const mediaNodes = elements.recentUploadsList.querySelectorAll('.owner-upload-card__preview img, .owner-upload-card__preview video');
    mediaNodes.forEach((node) => {
      if (node.dataset.previewReady === '1') return;
      node.dataset.previewReady = '1';

      if (node.tagName === 'IMG') {
        if (node.complete) {
          markPreviewReady(node);
          return;
        }
        node.addEventListener('load', () => markPreviewReady(node), { once: true });
        node.addEventListener('error', () => markPreviewReady(node), { once: true });
        if (typeof node.decode === 'function') {
          node.decode().then(() => markPreviewReady(node)).catch(() => {
            // load/error listeners handle fallback
          });
        }
        return;
      }

      if (node.readyState >= 2) {
        markPreviewReady(node);
        return;
      }
      node.addEventListener('loadeddata', () => markPreviewReady(node), { once: true });
      node.addEventListener('error', () => markPreviewReady(node), { once: true });
    });
  }

  function setLoggedOutUi(options) {
    state.me = null;
    elements.sessionBadge.textContent = 'Signed out';
    if (elements.logoutButton) elements.logoutButton.classList.add('is-hidden');
    setStageView('auth', { focusLogin: !(options && options.skipFocus) });
    revokeLocalPreviews();
    state.localUploads = [];
    state.recentUploads = [];
    state.removingAssetIds.clear();
    state.captureContext = null;
    state.captureContextPromise = null;
    state.pendingRefreshOptions = null;
    state.lastRenderedSignature = '';
    state.renderedUploadKeys.clear();
    state.readyPreviewKeys.clear();
    state.remoteVisibleCount = OWNER_GALLERY_PAGE_SIZE;
    if (elements.sessionMeta) elements.sessionMeta.textContent = 'Your gallery is empty.';
    if (elements.loginStatus) elements.loginStatus.textContent = '';
    if (elements.uploadStatus) elements.uploadStatus.textContent = '';
    setRefreshLoop(false);
    setSyncStatus('Enter the owner PIN to open the shared upload gallery.', 'warn');
    renderUploads([], { force: true });
    updateGalleryPagingUi(0);
  }

  function setLoggedInUi(me, options) {
    state.me = me;
    elements.sessionBadge.textContent = 'Owner session active';
    if (elements.logoutButton) elements.logoutButton.classList.remove('is-hidden');
    elements.userDisplay.textContent = 'Add photos or videos';
    setStageView('workbench', { force: !!(options && options.force) });
    setRefreshLoop(true);
    if (elements.sessionMeta) elements.sessionMeta.textContent = 'Shared gallery. New uploads land here after they finish sending.';
    setSyncStatus('Everything sent with this PIN stays here until it is removed.', 'ok');
    updateGalleryPagingUi(state.recentUploads.length);
    if (options && options.showSkeleton && !state.localUploads.length && !state.recentUploads.length) {
      renderRecentSkeleton(RECENT_SKELETON_COUNT);
    }
  }

  function setRefreshLoop(enabled) {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (!enabled) return;
    state.refreshTimer = window.setInterval(() => {
      if (!document.hidden && state.me) refreshUploads({ silent: true, preserveStatus: true });
    }, 45000);
  }

  async function restoreSession() {
    setStageView('boot', { force: true });
    const token = readToken();
    if (!token) {
      setLoggedOutUi({ skipFocus: true });
      return;
    }

    setSyncStatus('Checking owner access...', 'warn');

    try {
      const data = await fetchJson(OWNER_SESSION_API, { method: 'GET', cache: 'no-store' });
      if (data && data.me) {
        setLoggedInUi(data.me, { force: true, showSkeleton: true });
        await refreshUploads({ silent: true, preserveStatus: true, force: true });
        return;
      }
    } catch {
      writeToken('');
    }

    setLoggedOutUi({ skipFocus: true });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const pin = String(elements.loginPin.value || '').trim();
    if (!pin) {
      elements.loginStatus.textContent = 'PIN is required.';
      return;
    }

    elements.loginSubmit.disabled = true;
    elements.loginStatus.textContent = 'Opening uploads...';
    try {
      const data = await fetchJson(OWNER_SESSION_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      }, { auth: false });
      writeToken(data.token || '');
      elements.loginPin.value = '';
      elements.loginStatus.textContent = '';
      setLoggedInUi(data.me || {}, { force: true, showSkeleton: true });
      await refreshUploads({ silent: true, preserveStatus: true, force: true });
    } catch (error) {
      elements.loginStatus.textContent = toUserMessage(error, 'Could not open uploads');
      setSyncStatus('Could not open the gallery. Re-enter the owner PIN.', 'warn');
    } finally {
      elements.loginSubmit.disabled = false;
    }
  }

  async function handleLogout() {
    try {
      await fetchJson(OWNER_SESSION_API, { method: 'DELETE' });
    } catch {
      // ignore logout failures
    }
    writeToken('');
    setLoggedOutUi();
  }

  function buildLocalUploadEntry(file) {
    return {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      kind: file.type && file.type.startsWith('video/') ? 'video' : 'image',
      fingerprint: fingerprintFile(file),
      previewUrl: URL.createObjectURL(file),
      status: 'sending',
      error: '',
      fileSizeKb: Math.round((file.size || 0) / 1024),
      createdAt: new Date().toISOString(),
      storageBucket: '',
      storagePath: '',
    };
  }

  function startSelectedFiles(fileList) {
    if (!state.me) {
      elements.uploadStatus.textContent = 'Sign in first.';
      return;
    }

    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const seen = new Set(state.localUploads.filter((entry) => entry.status !== 'error').map((entry) => entry.fingerprint));
    const freshEntries = [];
    let skippedCount = 0;

    incoming.forEach((file) => {
      const fingerprint = fingerprintFile(file);
      if (seen.has(fingerprint) || state.savedFingerprints.has(fingerprint)) {
        skippedCount += 1;
        return;
      }
      const entry = buildLocalUploadEntry(file);
      freshEntries.push(entry);
      seen.add(fingerprint);
    });

    resetFileInputs();

    if (!freshEntries.length) {
      if (skippedCount) setSyncStatus('Those uploads were already sent from this device.', 'warn');
      return;
    }

    state.localUploads = [...freshEntries, ...state.localUploads];
    const captureContextPromise = getUploadCaptureContext();
    freshEntries.forEach((entry) => {
      entry.captureContextPromise = captureContextPromise;
    });
    renderVisibleUploads({ force: true });
    setSyncStatus('Sending now. New uploads land in the shared gallery below.', 'warn');
    freshEntries.forEach((entry) => {
      void uploadLocalEntry(entry);
    });
  }

  function wireFileInput(input) {
    if (!input) return;
    input.addEventListener('change', () => {
      startSelectedFiles(input.files || []);
    });
  }

  async function uploadFileToStorage(file, entry) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('surface', 'owner_media');
    formData.append('week_of', '');
    formData.append('bucket', 'owner-media-db');
    formData.append('media_kind', entry.kind || 'image');
    formData.append('convert_to_mp4', '0');

    return fetchJson('/api/admin/proof-upload', {
      method: 'POST',
      body: formData,
    });
  }

  async function uploadLocalEntry(entry) {
    entry.status = 'sending';
    entry.error = '';
    renderVisibleUploads({ force: true });
    setSyncStatus('Sending now. New uploads land in the shared gallery below.', 'warn');

    try {
      const upload = await uploadFileToStorage(entry.file, entry);
      entry.storageBucket = String(upload.bucket || '').trim();
      entry.storagePath = String(upload.path || '').trim();
      const captureContext = entry.captureContextPromise
        ? await withTimeout(entry.captureContextPromise, 1200)
        : null;

      const data = await fetchJson(OWNER_UPLOADS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_kind: entry.kind,
          storage_bucket: upload.bucket,
          storage_path: upload.path,
          content_type: upload.content_type || entry.file.type || null,
          file_size_kb: upload.file_size_kb || entry.fileSizeKb || null,
          thumbnail_storage_path: upload.thumbnail_storage_path || null,
          capture_source: entry.kind === 'video' ? 'owner_video' : 'owner_photo',
          capture_context: captureContext,
        }),
      });

      rememberUploadedEntries([entry]);
      entry.status = 'saved';
      if (data && data.upload) {
        entry.assetId = String(data.upload.asset_id || '').trim();
        entry.storageBucket = String(data.upload.storage_bucket || entry.storageBucket || '').trim();
        entry.storagePath = String(data.upload.storage_path || entry.storagePath || '').trim();
      }

      renderVisibleUploads({ force: true });
      await refreshUploads({ silent: true, preserveStatus: true, force: true });
      setSyncStatus('Added to the shared gallery. Remove anything that should not stay here.', 'ok');
    } catch (error) {
      entry.status = 'error';
      entry.error = toUserMessage(error, 'Couldn’t send. Try again.');
      renderVisibleUploads({ force: true });
      setSyncStatus('Upload paused. Check your connection and try again.', 'warn');
    }
  }

  async function deleteUpload(assetId) {
    const id = String(assetId || '').trim();
    if (!id) return;
    if (!window.confirm('Remove this upload?')) return;

    state.removingAssetIds.add(id);
    renderVisibleUploads({ force: true });
    setSyncStatus('Removing upload now.', 'warn');

    try {
      await fetchJson(`${OWNER_UPLOADS_API}?asset_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.removingAssetIds.delete(id);
      state.recentUploads = state.recentUploads.filter((upload) => String(upload.asset_id || '') !== id);
      const localEntry = state.localUploads.find((entry) => String(entry.assetId || '') === id);
      if (localEntry) removeLocalUpload(localEntry.id);
      clearRememberedUploads();
      renderVisibleUploads({ force: true });
      await refreshUploads({ silent: true, preserveStatus: true, force: true });
      setSyncStatus('Upload removed. You stay in control of what is kept.', 'ok');
    } catch (error) {
      state.removingAssetIds.delete(id);
      renderVisibleUploads({ force: true });
      setSyncStatus(toUserMessage(error, 'Could not remove upload.'), 'warn');
    }
  }

  async function refreshUploads(options) {
    if (!state.me) return;

    const settings = Object.assign({ force: false, preserveStatus: false, silent: false }, options || {});
    const now = Date.now();
    if (!settings.force && state.refreshPromise) {
      state.pendingRefreshOptions = settings;
      return state.refreshPromise;
    }
    if (!settings.force && state.lastRefreshAt && (now - state.lastRefreshAt) < MIN_REFRESH_INTERVAL_MS) {
      return null;
    }

    if (!state.localUploads.length && !state.recentUploads.length && settings.force) {
      renderRecentSkeleton(RECENT_SKELETON_COUNT);
    }

    state.refreshPromise = (async () => {
      try {
          const appendMode = !!settings.append;
          const requestLimit = appendMode
            ? Math.min(OWNER_GALLERY_PAGE_SIZE, OWNER_GALLERY_LIMIT)
            : Math.min(OWNER_GALLERY_LIMIT, Math.max(OWNER_GALLERY_PAGE_SIZE, Number(state.remoteVisibleCount || OWNER_GALLERY_PAGE_SIZE)));
          const requestOffset = appendMode ? Math.max(0, Number(state.recentUploads.length || 0)) : 0;
          const data = await fetchJson(`${OWNER_UPLOADS_API}?scope=mine&limit=${requestLimit}&offset=${requestOffset}`, { method: 'GET', cache: 'no-store' });
        const uploads = Array.isArray(data.uploads) ? data.uploads : [];
          if (appendMode) {
            const seen = new Set(state.recentUploads.map((upload) => String(upload && upload.asset_id || '').trim()).filter(Boolean));
            state.recentUploads = state.recentUploads.concat(uploads.filter((upload) => {
              const assetId = String(upload && upload.asset_id || '').trim();
              if (!assetId) return true;
              if (seen.has(assetId)) return false;
              seen.add(assetId);
              return true;
            }));
          } else {
            state.recentUploads = uploads;
          }
          state.remoteVisibleCount = Math.max(OWNER_GALLERY_PAGE_SIZE, Number(state.recentUploads.length || 0));
        pruneSyncedLocalUploads();
        const totalUploads = Number((data.summary && data.summary.total) || uploads.length || 0);
        if (elements.sessionMeta) {
            elements.sessionMeta.textContent = totalUploads > uploads.length
            ? `Showing the newest ${uploads.length} of ${totalUploads} uploads in the shared gallery.`
            : (totalUploads === 1 ? '1 upload in the shared gallery.' : `${totalUploads} uploads in the shared gallery.`);
        }
          updateGalleryPagingUi(totalUploads);
        renderVisibleUploads();
        if (!settings.preserveStatus) {
            setSyncStatus('Everything sent with this PIN stays here until it is removed.', 'ok');
        }
      } catch (error) {
        const friendlyMessage = toUserMessage(error, 'Could not load uploads.');
        if (!state.localUploads.length) {
          elements.recentUploadsList.innerHTML = `<div class="owner-empty-state">${escapeHtml(friendlyMessage)}</div>`;
          state.lastRenderedSignature = `__error__:${friendlyMessage}`;
        }
        if (elements.sessionMeta) elements.sessionMeta.textContent = 'Gallery is temporarily unavailable. New uploads can still be sent.';
        if (!settings.silent) {
          setSyncStatus(friendlyMessage, 'warn');
        }
        updateGalleryPagingUi(0);
        if (elements.galleryMeta) elements.galleryMeta.textContent = 'Gallery is temporarily unavailable.';
        updateUploadStatusLine();
      } finally {
        state.lastRefreshAt = Date.now();
        state.refreshPromise = null;
        const pendingOptions = state.pendingRefreshOptions;
        state.pendingRefreshOptions = null;
        if (pendingOptions && state.me) {
          void refreshUploads(pendingOptions);
        }
      }
    })();

    return state.refreshPromise;
  }

  function bindDropzone() {
    const openBrowse = () => {
      if (elements.fileInput) elements.fileInput.click();
    };

    elements.browseButton.addEventListener('click', openBrowse);
    elements.photoCaptureButton.addEventListener('click', () => elements.cameraPhotoInput && elements.cameraPhotoInput.click());
    elements.videoCaptureButton.addEventListener('click', () => elements.cameraVideoInput && elements.cameraVideoInput.click());
    elements.dropzone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      openBrowse();
    });
    elements.dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openBrowse();
      }
    });
    elements.dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      elements.dropzone.classList.add('is-dragover');
    });
    elements.dropzone.addEventListener('dragleave', () => {
      elements.dropzone.classList.remove('is-dragover');
    });
    elements.dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove('is-dragover');
      if (event.dataTransfer && event.dataTransfer.files) startSelectedFiles(event.dataTransfer.files);
    });
  }

  function bindEvents() {
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.logoutButton.addEventListener('click', handleLogout);
    bindDropzone();
    wireFileInput(elements.fileInput);
    wireFileInput(elements.cameraPhotoInput);
    wireFileInput(elements.cameraVideoInput);

    window.addEventListener('focus', () => {
      if (state.me) refreshUploads({ silent: true, preserveStatus: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.me) refreshUploads({ silent: true, preserveStatus: true });
    });
    window.addEventListener('online', () => {
      if (state.me) refreshUploads({ silent: true, preserveStatus: true });
    });

    window.ownerMediaRetryUpload = (uploadId) => {
      const entry = state.localUploads.find((item) => item.id === uploadId);
      if (!entry) return;
      void uploadLocalEntry(entry);
    };
    window.ownerMediaDeleteUpload = (assetId) => {
      void deleteUpload(assetId);
    };
    if (elements.galleryLoadMoreButton) {
      elements.galleryLoadMoreButton.addEventListener('click', () => {
        void refreshUploads({ append: true, silent: true, preserveStatus: true, force: true });
      });
    }
  }

  bindEvents();
  restoreSession();
})();