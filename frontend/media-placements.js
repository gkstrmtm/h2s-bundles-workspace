(function (root) {
  'use strict';

  const destinationPreviews = {
    bundles: {
      hero: { preview: { page: 'bundles.html', frame: 'section.hero', mediaClass: 'page-placement-hero', readyClass: 'has-page-placement' } },
      mid_proof_rail: { unavailableReason: 'Unavailable: this section was removed from the current Bundles layout. Historical placement settings are retained and are not applied to another area.' },
      pre_cta: { unavailableReason: 'Unavailable: this cart strip was removed from the current Bundles layout. Historical placement settings are retained and are not applied to another area.' },
    },
    commercial_intake: {
      commercial_hero: { preview: { page: 'commercial.html', frame: '#heroMediaStage', mediaClass: 'media-stage__media', readyClass: 'is-ready' } },
      commercial_security_rail: { preview: { page: 'commercial.html', frame: '#cameraProofRail', tileClass: 'proof-tile' } },
      commercial_display_rail: { preview: { page: 'commercial.html', frame: '#tvProofRail', tileClass: 'proof-tile' } },
    },
  };
  const bounded = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const { style } = typeof module === 'object' && module.exports
    ? require('./media-placement-style.js') : root.H2SMediaPlacements;

  function pan(settings, dx, dy, frame, media) {
    if (!frame.width || !frame.height || !media.width || !media.height) return { ...settings };
    const scale = Math[settings.fit === 'contain' ? 'min' : 'max'](frame.width / media.width, frame.height / media.height);
    // object-position plus the matching transform-origin gives this exact travel.
    const travelX = frame.width - media.width * scale * settings.zoom;
    const travelY = frame.height - media.height * scale * settings.zoom;
    return {
      ...settings,
      focal_x: Math.abs(travelX) < 0.01 ? settings.focal_x : bounded(settings.focal_x + dx * 100 / travelX, 0, 100, 50),
      focal_y: Math.abs(travelY) < 0.01 ? settings.focal_y : bounded(settings.focal_y + dy * 100 / travelY, 0, 100, 50),
    };
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function inertDestination(html, url) {
    const doc = new root.DOMParser().parseFromString(html, 'text/html');
    // Preview layout and overlays, never page startup, tracking, forms, or operational handlers.
    doc.querySelectorAll('script,noscript,iframe,object,embed,base,meta[http-equiv],link[as="fetch"],img[width="1"][height="1"]').forEach(node => node.remove());
    doc.querySelectorAll('*').forEach(node => {
      if (['LINK', 'STYLE'].includes(node.tagName) && node.media === 'print' && node.hasAttribute('onload')) node.media = 'all';
      for (const attribute of Array.from(node.attributes)) {
        if (/^on/i.test(attribute.name) || ['action', 'formaction', 'autofocus', 'srcdoc'].includes(attribute.name)) node.removeAttribute(attribute.name);
      }
    });
    const base = doc.createElement('base');
    base.href = url;
    doc.head.prepend(base);
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }

  function destinationFrame(doc, config, url, isVideo, settings) {
    const area = doc.querySelector(config.frame);
    if (!area) throw new Error('The registered destination is absent from the current page. Saved settings have not been changed.');
    const wrap = doc.createElement('div');
    wrap.className = config.tileClass || config.mediaClass || '';
    const media = doc.createElement(isVideo ? 'video' : 'img');
    media.src = url;
    media.setAttribute('alt', '');
    if (isVideo) { media.muted = true; media.playsInline = true; media.preload = 'auto'; }
    media.style.cssText = style(settings);
    wrap.appendChild(media);
    if (config.tileClass) area.replaceChildren(wrap);
    else if (config.mediaClass) {
      area.querySelectorAll('.' + config.mediaClass).forEach(node => node.remove());
      area.prepend(wrap);
    } else area.replaceChildren(media);
    area.classList.remove('is-loading', 'is-empty', 'has-proof-hero');
    if (config.readyClass) area.classList.add(config.readyClass);
    area.style.removeProperty('--hero-bg-url');
    return { frame: config.tileClass ? wrap : area, media };
  }

  function destinationPreview({ stage, config, url, isVideo, settings, viewport, onState }) {
    const iframe = root.document.createElement('iframe');
    iframe.title = 'Read-only destination framing preview';
    iframe.className = 'media-destination-preview';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.visibility = 'hidden';
    const abort = new root.AbortController();
    let closed = false;
    let target;
    let observer;
    let timeout;
    const resize = () => {
      if (!target || closed) return;
      const rect = target.frame.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error('The destination frame has no visible dimensions.');
      const box = stage.parentElement;
      const padding = root.getComputedStyle(box);
      const available = box.clientWidth - parseFloat(padding.paddingLeft || 0) - parseFloat(padding.paddingRight || 0);
      const height = root.visualViewport?.height || root.innerHeight;
      const scale = Math.min(available / rect.width, height * 0.58 / rect.height);
      stage.style.cssText = `position:relative;overflow:hidden;display:block;flex:none;width:${rect.width * scale}px;height:${rect.height * scale}px;max-width:100%;`;
      stage.dataset.frameWidth = rect.width;
      stage.dataset.frameHeight = rect.height;
      iframe.style.transform = `scale(${scale}) translate(${-rect.left}px, ${-rect.top}px)`;
      iframe.style.visibility = 'visible';
      onState({ ready: true, width: rect.width, height: rect.height, viewport });
    };
    const ready = (async () => {
      try {
        const page = new URL(config.page, root.location.href);
        if (page.origin !== root.location.origin) throw new Error('Destination previews must use a page on this frontend.');
        onState({ ready: false });
        const response = await root.fetch(page.href, { signal: abort.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Destination page failed to load (${response.status})`);
        const html = inertDestination(await response.text(), page.href);
        if (closed) return;
        const loaded = new Promise((resolve, reject) => {
          abort.signal.addEventListener('abort', resolve, { once: true });
          timeout = root.setTimeout(() => reject(new Error('Destination styles or media did not finish loading. Retry the preview.')), 20000);
          iframe.onload = async () => {
            try {
              const doc = iframe.contentDocument;
              if (!doc) throw new Error('Destination preview is inaccessible.');
              if (doc.fonts) await doc.fonts.ready;
              if (closed) return resolve();
              target = destinationFrame(doc, config, url, isVideo, settings);
              await new Promise((mediaReady, mediaFailed) => {
                target.media.addEventListener(isVideo ? 'loadeddata' : 'load', mediaReady, { once: true });
                target.media.addEventListener('error', () => mediaFailed(new Error('Destination media failed to load.')), { once: true });
                if ((!isVideo && target.media.complete && target.media.naturalWidth) || target.media.readyState >= 2) mediaReady();
              });
              if (closed) return resolve();
              const rect = target.frame.getBoundingClientRect();
              iframe.contentWindow.scrollTo({ left: 0, top: Math.max(0, rect.top - 120), behavior: 'instant' });
              resize();
              observer = new root.ResizeObserver(resize);
              observer.observe(stage.parentElement);
              root.addEventListener('resize', resize);
              root.visualViewport?.addEventListener('resize', resize);
              resolve();
            } catch (error) { reject(error); }
          };
        });
        iframe.style.width = `${viewport.width}px`;
        iframe.style.height = `${viewport.height}px`;
        iframe.srcdoc = html;
        stage.appendChild(iframe);
        await loaded;
      } catch (error) {
        if (!closed) {
          console.error('[Destination preview]', error);
          onState({ ready: false, error: error.message });
        }
      } finally { root.clearTimeout(timeout); }
    })();
    return {
      ready,
      update(next) { settings = next; if (target) target.media.style.cssText = style(next); },
      video() { return target?.media; },
      destroy() {
        closed = true; abort.abort(); observer?.disconnect(); root.clearTimeout(timeout);
        root.removeEventListener('resize', resize);
        root.visualViewport?.removeEventListener('resize', resize);
        iframe.onload = null; iframe.remove();
      },
    };
  }

  async function placementRequest(options, method, body) {
    const params = new URLSearchParams({ asset_source: options.source, asset_id: options.asset.asset_id });
    const response = await root.fetch(`${options.base}/api/admin/media-placements${method === 'GET' ? `?${params}` : ''}`, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${options.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load or save page placement');
    return result;
  }

  function chooseDestination(options) {
    const existing = root.document.querySelector('.media-destination-choice');
    if (existing) { existing.focus(); return; }
    const dialog = root.document.createElement('dialog');
    const previousFocus = root.document.activeElement;
    dialog.className = 'media-placement-decision media-destination-choice';
    dialog.setAttribute('aria-labelledby', 'mediaDestinationTitle');
    dialog.setAttribute('aria-describedby', 'mediaDestinationDescription');
    dialog.innerHTML = `<h3 id="mediaDestinationTitle" tabindex="-1">Choose destination</h3>
      <p id="mediaDestinationDescription">Candidate: ${escape(options.asset.original_filename || 'Selected media')}. Nothing is saved until you save framing.</p>
      <div data-destinations role="status" aria-busy="true">Loading destinations and saved uses...</div>
      <footer class="media-destination-actions"><button type="button" class="btn btn-tonal" data-close>Cancel</button></footer>`;
    const close = () => {
      dialog.close(); dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    root.document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('h3').focus({ preventScroll: true });
    const load = async () => {
      const host = dialog.querySelector('[data-destinations]');
      host.setAttribute('role', 'status');
      host.setAttribute('aria-busy', 'true');
      host.textContent = 'Loading destinations and saved uses...';
      try {
        const result = await placementRequest(options, 'GET');
        if (!dialog.isConnected) return;
        if (!result.pages || !Array.isArray(result.placements)) throw new Error('Invalid destination catalog or saved usage.');
        host.innerHTML = '';
        let count = 0;
        for (const [surface, page] of Object.entries(result.pages)) {
          const supported = page.areas.filter(area => {
            const config = { ...area, ...destinationPreviews[surface]?.[area.key] };
            return config.preview && !config.unavailableReason;
          });
          if (!supported.length) continue;
          const group = root.document.createElement('fieldset');
          group.innerHTML = `<legend>${escape(page.title)}</legend>`;
          for (const area of supported) {
            const row = result.placements.find(item => item.surface === surface && item.area === area.key);
            const current = options.currentHeroes?.[surface];
            const isCurrent = root.H2SPageHeroes?.usesForAsset(options.currentHeroes, options.source, options.asset.asset_id)
              .some(use => use.surface === surface && use.area === area.key);
            const button = root.document.createElement('button');
            button.type = 'button';
            button.className = 'media-destination-option';
            button.dataset.destinationSurface = surface;
            button.dataset.destinationArea = area.key;
            const mismatch = area.photoOnly && options.asset.media_kind !== 'photo'
              || area.service && area.service !== (options.asset.service || options.asset.service_type);
            button.disabled = !!mismatch;
            button.innerHTML = `<strong>${escape(area.title)}</strong><small>${row
              ? `${row.enabled ? 'Included here' : 'Excluded here'}; order ${row.display_order}`
              : 'No placement saved for this media'}${isCurrent ? ' · Shown here' : ''}${mismatch ? ' · Requires ' + escape(area.photoOnly && options.asset.media_kind !== 'photo' ? 'a photo' : area.service.replaceAll('_', ' ')) : ''}</small>
              <small>${current?.areas?.[area.key] ? `${current.areas[area.key].length} selected · ` : ''}${area.photoOnly ? '1 installation photo' : area.limit === 1 ? '1 photo or video' : `Up to ${area.limit} photos or videos`}</small>`;
            button.addEventListener('click', () => {
              close();
              options.onSelect({ surface, area: area.key });
            });
            group.appendChild(button); count++;
          }
          host.appendChild(group);
        }
        if (!count) throw new Error('No supported destinations are registered for this frontend.');
        host.removeAttribute('role');
      } catch (error) {
        console.error('[Destination chooser]', error);
        if (!dialog.isConnected) return;
        host.setAttribute('role', 'alert');
        host.textContent = error.message;
        const retry = root.document.createElement('button');
        retry.type = 'button'; retry.className = 'media-placement-secondary'; retry.textContent = 'Retry destinations';
        retry.addEventListener('click', load); host.appendChild(retry);
      } finally { if (dialog.isConnected) host.setAttribute('aria-busy', 'false'); }
    };
    const ready = load();
    return { close, ready };
  }

  function chooseReplacement(options) {
    const existing = root.document.querySelector('.media-replacement-picker');
    if (existing) { existing.focus(); return; }
    const previousFocus = root.document.activeElement;
    const previousOverflow = root.document.body.style.overflow;
    const dialog = root.document.createElement('dialog');
    dialog.className = 'media-placement-decision media-replacement-picker';
    dialog.setAttribute('aria-labelledby', 'mediaReplacementTitle');
    dialog.setAttribute('aria-describedby', 'mediaReplacementDescription');
    const thumbnail = (asset, current = false) => asset.media_kind === 'video'
      ? `<video muted playsinline preload="metadata" ${asset.video_thumbnail_url ? `poster="${escape(asset.video_thumbnail_url)}"` : ''} src="${escape(asset.media_url)}"></video>`
      : `<img ${current ? '' : 'loading="lazy"'} src="${escape(asset.media_url)}" alt="">`;
    dialog.innerHTML = `<header><h3 id="mediaReplacementTitle">Choose replacement media</h3>
      <p id="mediaReplacementDescription">${escape(options.title)}. Choose a photo or video, then adjust framing. Nothing changes until you save.</p>
      <div class="media-replacement-current">${thumbnail(options.current, true)}<span>Replacing<br><strong>${escape(options.current.original_filename || options.current.label || 'Current media')}</strong></span></div></header>
      <div class="media-replacement-filters"><input type="search" aria-label="Search replacement media" placeholder="Search media">
        <div role="group" aria-label="Media type"><button type="button" data-kind="all" aria-pressed="true">All</button><button type="button" data-kind="photo" aria-pressed="false">Photos</button><button type="button" data-kind="video" aria-pressed="false">Videos</button></div></div>
      <p class="media-replacement-count" role="status"></p><div class="media-replacement-grid"></div>
      <footer class="media-destination-actions"><button type="button" class="btn btn-tonal" data-close>Cancel</button></footer>`;
    let closed = false, kind = 'all';
    const cleanup = () => {
      if (closed) return;
      closed = true;
      dialog.remove();
      root.document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const close = () => { dialog.close(); cleanup(); };
    dialog.addEventListener('close', cleanup);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelector('[data-close]').onclick = close;
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom)) close();
    });
    const grid = dialog.querySelector('.media-replacement-grid');
    for (const asset of options.assets) {
      const name = asset.original_filename || asset.label || (asset.media_kind === 'video' ? 'Video' : 'Photo');
      const selected = options.selectedIds.includes(asset.asset_id);
      const button = root.document.createElement('button');
      button.type = 'button';
      button.className = 'media-replacement-option';
      button.dataset.assetId = asset.asset_id;
      button.dataset.kind = asset.media_kind;
      button.dataset.search = `${name} ${asset.city || ''}`.toLowerCase();
      button.disabled = selected;
      button.innerHTML = `<span class="media-replacement-thumbnail">${thumbnail(asset)}<span data-preview-error hidden>Preview unavailable</span></span>
        <strong>${escape(name)}</strong><small>${selected ? 'Already in this area' : asset.media_kind === 'video' ? 'Video' : 'Photo'}</small>`;
      button.querySelector('img,video').onerror = event => {
        event.target.hidden = true;
        button.querySelector('[data-preview-error]').hidden = false;
      };
      button.onclick = () => { close(); options.onSelect(asset); };
      grid.appendChild(button);
    }
    const filter = () => {
      const query = dialog.querySelector('input').value.trim().toLowerCase();
      let count = 0;
      grid.querySelectorAll('button').forEach(button => {
        button.hidden = (kind !== 'all' && button.dataset.kind !== kind) || !button.dataset.search.includes(query);
        if (!button.hidden && !button.disabled) count++;
      });
      dialog.querySelector('.media-replacement-count').textContent = count
        ? `${count} available choices from the loaded library. Media already in this area cannot be selected again.`
        : options.assets.length ? 'No available matches. Try another search or media type.' : 'No compatible media in the loaded library. Upload or load matching media first.';
    };
    dialog.querySelector('input').oninput = filter;
    dialog.querySelectorAll('.media-replacement-filters [data-kind]').forEach(button => {
      button.onclick = () => {
        kind = button.dataset.kind;
        dialog.querySelectorAll('.media-replacement-filters [data-kind]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        filter();
      };
    });
    root.document.body.appendChild(dialog);
    root.document.body.style.overflow = 'hidden';
    dialog.showModal();
    filter();
    dialog.querySelector('input').focus({ preventScroll: true });
    return { close };
  }

  function mount(options) {
    const host = options.host;
    const find = (selector) => host.querySelector(selector);
    const controls = find('[data-placement-controls]');
    const stage = find('#ppVideoStage');
    const media = find('#ppEditorVideo');
    const status = find('#ppEditStatus');
    const saveButton = find('#ppApplyEdits');
    const loadOverlay = find('#ppStageLoadOverlay');
    const errorOverlay = find('#ppStageErrorOverlay');
    saveButton.textContent = 'Save this placement';
    const scopeControls = root.document.createElement('div');
    scopeControls.className = 'media-placement-scope';
    find('#ppEditorScrollArea').prepend(scopeControls);
    stage.tabIndex = 0;
    stage.setAttribute('aria-label', 'Placement framing canvas. Drag to reposition; scroll to zoom.');
    media.draggable = false;
    let closed = false;
    let busy = false;
    let loaded = false;
    let previewReady = false;
    let surface = '';
    let area = '';
    let pages = {};
    let placements = [];
    let settings;
    let cleanSettings = '';
    let states = [];
    let index = 0;
    let drag = null;
    let zoomTimer;
    let invalidDraft = false;
    let decision = null;
    let destination = null;
    let destinationReady = false;
    let device = 'desktop';
    let replacement = options.replacement || null;
    let replacementSupported = false;
    const viewport = () => device === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const areaConfig = () => pages[surface]?.areas.find(entry => entry.key === area);
    const defaults = () => ({
      asset_source: options.source, asset_id: options.asset.asset_id, surface, area,
      enabled: true, display_order: 100, fit: 'cover', focal_x: 50, focal_y: 50, zoom: 1,
    });
    const saved = () => placements.find((row) => row.surface === surface && row.area === area);
    const dirty = () => invalidDraft || (settings && JSON.stringify(settings) !== cleanSettings);
    const scopeLabel = () => `${pages[surface].title} / ${pages[surface].areas.find((entry) => entry.key === area).title}`;
    const setStatus = (text, state = 'unsaved') => {
      status.textContent = text;
      status.dataset.state = state;
      status.setAttribute('role', state === 'failed' ? 'alert' : 'status');
    };
    const draftStatus = () => {
      if (replacement && !replacementSupported) {
        setStatus('Preview only. Saving this replacement requires the updated placement API. Nothing has been changed.', 'failed');
        return;
      }
      setStatus(replacement ? `Replacing ${replacement.name} in ${scopeLabel()}. Nothing changes until Save replacement. Explicit placements are shown before automatic selections.`
        : dirty() ? 'Unsaved changes to candidate framing'
        : saved() ? `Saved for this area: ${saved().enabled ? 'included' : 'excluded'}`
          : 'Preview only; no placement saved for this media.',
      dirty() ? 'unsaved' : saved() ? 'saved' : 'automatic');
    };
    const enableSave = () => {
      saveButton.disabled = busy || !loaded || !previewReady || !destinationReady || (!!replacement && !replacementSupported);
      saveButton.textContent = busy ? 'Saving placement...' : replacement ? 'Save replacement' : 'Save this placement';
      find('#ppUndoBtn').disabled = busy || index <= 0;
      find('#ppRedoBtn').disabled = busy || index >= states.length - 1;
      const form = find('form');
      if (form) form.querySelector('fieldset').disabled = busy || !loaded || !!areaConfig()?.unavailableReason;
      scopeControls.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
      if (decision) decision.element.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
    };
    const request = (method, body) => placementRequest(options, method, body);
    const applyPreview = () => {
      if (!settings) return;
      media.style.cssText = `display:block;width:100%;height:100%;max-width:none;margin:0;${style(settings)}`;
      if (destination) media.style.visibility = 'hidden';
      destination?.update(settings);
      find('#ppUndoBtn').disabled = busy || index <= 0;
      find('#ppRedoBtn').disabled = busy || index >= states.length - 1;
      for (const name of ['focal_x', 'focal_y', 'zoom', 'display_order']) {
        const field = find(`[name="${name}"]`);
        if (field) field.value = settings[name];
      }
      const zoom = find('[data-zoom-value]');
      if (zoom) zoom.textContent = `${Math.round(settings.zoom * 100)}%`;
      const indicator = find('#ppScaleIndicator');
      if (indicator) indicator.textContent = `${Math.round(settings.zoom * 100)}%`;
    };
    const record = () => {
      if (!settings || invalidDraft || JSON.stringify(states[index]) === JSON.stringify(settings)) return;
      states = states.slice(0, index + 1).concat({ ...settings });
      index = states.length - 1;
      applyPreview();
    };
    const finishZoom = () => { clearTimeout(zoomTimer); record(); };
    const undo = () => {
      if (busy || !loaded) return;
      finishZoom();
      invalidDraft = false;
      if (index > 0) settings = { ...states[--index] };
      renderValues();
    };
    const redo = () => {
      if (busy || !loaded) return;
      invalidDraft = false;
      if (index < states.length - 1) settings = { ...states[++index] };
      renderValues();
    };
    const renderValues = () => {
      if (!settings) return;
      find('[name="enabled"]').checked = settings.enabled;
      find(`[name="fit"][value="${settings.fit}"]`).checked = true;
      applyPreview();
      draftStatus();
    };
    const closeDecision = () => {
      if (!decision) return;
      const { element, previousFocus } = decision;
      decision = null;
      element.close();
      element.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    const destroy = () => {
      closed = true;
      clearTimeout(zoomTimer);
      destination?.destroy();
      closeDecision();
      if (media.tagName === 'VIDEO') media.pause();
    };
    const close = () => {
      destroy();
      options.onClose();
    };
    const transition = (action, destination = '') => {
      if (busy || closed) return false;
      if (!dirty()) { action(); return true; }
      if (decision) { decision.element.querySelector('[data-decision="keep"]').focus(); return false; }
      const element = root.document.createElement('dialog');
      element.className = 'media-placement-decision';
      element.setAttribute('aria-labelledby', 'mediaPlacementDecisionTitle');
      element.setAttribute('aria-describedby', 'mediaPlacementDecisionDescription');
      element.innerHTML = `
        <h3 id="mediaPlacementDecisionTitle">Unsaved changes: ${escape(scopeLabel())}</h3>
        <p id="mediaPlacementDecisionDescription">${destination
          ? `Save this placement before switching to ${escape(destination)}?`
          : 'Save this placement before closing the editor?'}</p>
        <p data-decision-error role="alert" hidden></p>
        <div class="media-placement-options">
          <button type="button" class="btn" data-decision="save">Save and ${destination ? 'switch' : 'close'}</button>
          <button type="button" class="btn btn-tonal" data-decision="discard">Discard and ${destination ? 'switch' : 'close'}</button>
          <button type="button" class="btn btn-tonal" data-decision="keep" autofocus>Keep editing</button>
        </div>`;
      decision = { element, previousFocus: root.document.activeElement };
      host.appendChild(element);
      element.querySelector('[data-decision="keep"]').addEventListener('click', closeDecision);
      element.addEventListener('cancel', (event) => { event.preventDefault(); if (!busy) closeDecision(); });
      element.querySelector('[data-decision="discard"]').addEventListener('click', () => { closeDecision(); action(); });
      element.querySelector('[data-decision="save"]').addEventListener('click', async () => {
        if (await save()) { closeDecision(); action(); }
        else if (decision) {
          const message = element.querySelector('[data-decision-error]');
          message.textContent = status.textContent;
          message.hidden = false;
          element.querySelector('[data-decision="keep"]').focus();
        }
      });
      element.showModal();
      return false;
    };
    const cancel = () => transition(close);
    const zoomBy = (delta, group = false) => {
      if (!loaded || busy || decision || invalidDraft || !previewReady || !destinationReady) return;
      settings.zoom = Math.round(bounded(settings.zoom + delta, 1, 3, 1) * 100) / 100;
      applyPreview();
      draftStatus();
      if (group) {
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(record, 180);
      } else record();
    };
    const loadScope = (nextSurface, nextArea) => {
      clearTimeout(zoomTimer);
      drag = null;
      stage.classList.remove('is-dragging');
      invalidDraft = false;
      surface = nextSurface;
      area = nextArea;
      const row = saved();
      settings = { ...defaults() };
      if (row) for (const key of Object.keys(settings)) settings[key] = row[key];
      if (replacement) { settings.display_order = replacement.display_order; settings.enabled = true; }
      cleanSettings = JSON.stringify(settings);
      states = [{ ...settings }];
      index = 0;
      render();
    };
    const changeScope = (nextSurface, nextArea) => {
      if (surface === nextSurface && area === nextArea) return;
      if (replacement) { setStatus('Save or cancel this replacement before changing destination.', 'failed'); return; }
      const title = `${pages[nextSurface].title} / ${pages[nextSurface].areas.find((entry) => entry.key === nextArea).title}`;
      return transition(() => loadScope(nextSurface, nextArea), title);
    };
    const render = () => {
      const config = pages[surface].areas.find((entry) => entry.key === area);
      scopeControls.innerHTML = `
        <fieldset><legend>Page</legend><div class="media-placement-options">
          ${Object.entries(pages).map(([key, page]) => `<button type="button" class="btn btn-tonal" data-page="${escape(key)}" aria-pressed="${surface === key}">${escape(page.title)}</button>`).join('')}
        </div></fieldset>
        ${pages[surface].areas.length > 1 ? `<fieldset><legend>Display area</legend><div class="media-placement-options">
          ${pages[surface].areas.map((entry) => `<button type="button" class="btn btn-tonal" data-area="${escape(entry.key)}" aria-pressed="${area === entry.key}">${escape(entry.title)}${entry.unavailableReason ? ' (unavailable)' : ''}</button>`).join('')}
        </div></fieldset>` : ''}
        <strong>${escape(pages[surface].title)} / ${escape(config.title)} - placement only</strong>
        <small>Framing preview only; customer-page controls are inactive.
          ${config.preview ? `<a class="media-placement-secondary" href="${escape(new URL(config.preview.page, root.location.href).href)}" target="_blank" rel="noopener" aria-label="View actual customer selection (opens a new tab)">View actual customer selection</a>` : ''}</small>
        <div class="media-placement-options" aria-label="Preview viewport">
          <button type="button" class="btn btn-tonal" data-device="desktop" aria-pressed="${device === 'desktop'}">Desktop 1440</button>
          <button type="button" class="btn btn-tonal" data-device="mobile" aria-pressed="${device === 'mobile'}">Mobile 390</button>
        </div>
        <small data-destination-status role="status" aria-live="polite"></small>
        <button type="button" class="media-placement-secondary" data-destination-retry hidden>Retry destination preview</button>`;
      scopeControls.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
        if (button.dataset.page !== surface) changeScope(button.dataset.page, pages[button.dataset.page].areas[0].key);
      }));
      scopeControls.querySelectorAll('[data-area]').forEach((button) => button.addEventListener('click', () => {
        if (button.dataset.area !== area) changeScope(surface, button.dataset.area);
      }));
      find('.editor-title').textContent = `Placement framing: ${pages[surface].title} / ${config.title}`;
      find('#ppEditorOverlayLabel').textContent = `${pages[surface].title} / ${config.title}`;
      controls.innerHTML = `
        <form class="media-placement-form"><fieldset>
          <label><input name="enabled" type="checkbox"> Include this asset in this area</label>
          <small>Uncheck to exclude only this asset here. Other placements and the shared file are unchanged.</small>
          <div class="media-placement-options">
            <label><input type="radio" name="fit" value="cover"> Fill frame</label>
            <label><input type="radio" name="fit" value="contain"> Fit whole photo</label>
            <button type="button" class="media-placement-secondary" data-center title="Center the image and reset zoom. Keeps fit mode, inclusion, order, and this page's settings. Save to persist.">Reset framing</button>
            ${media.tagName === 'VIDEO' ? '<button type="button" class="btn btn-tonal" data-playback>Play preview</button>' : ''}
          </div>
          <label>Zoom <output data-zoom-value></output><input aria-label="Placement zoom" name="zoom" type="range" min="1" max="3" step="0.01"></label>
          <details><summary>Advanced: precise framing and display order</summary>
            <div class="media-placement-fields">
              <label>Horizontal focus (%)<input name="focal_x" type="number" min="0" max="100" step="any" required></label>
              <label>Vertical focus (%)<input name="focal_y" type="number" min="0" max="100" step="any" required></label>
              <label>Display order<input name="display_order" type="number" min="0" max="999" step="1" required></label>
            </div>
            <small>Lower order appears first within the area's service group. Desktop and mobile use the same saved framing. Fit whole photo can leave space around the image.</small>
          </details>
          <div class="media-placement-options">
            <button type="button" class="media-placement-secondary" data-reset ${saved() ? '' : 'disabled'} title="Remove only this media's saved placement and let the page select media automatically.">Restore automatic selection</button>
            <small>Removes this page's saved settings, not the shared asset.</small>
          </div>
        </fieldset></form>`;
      const form = find('form');
      form.addEventListener('submit', (event) => { event.preventDefault(); save(); });
      form.addEventListener('input', (event) => {
        const field = event.target;
        if (!field.name || busy || decision) return;
        invalidDraft = !form.checkValidity();
        if (invalidDraft) { setStatus(`Unsaved changes: ${scopeLabel()}. Correct the highlighted framing or order values.`); return; }
        settings.enabled = find('[name="enabled"]').checked;
        settings.fit = find('[name="fit"]:checked').value;
        for (const name of ['focal_x', 'focal_y', 'zoom', 'display_order']) settings[name] = Number(find(`[name="${name}"]`).value);
        applyPreview();
        draftStatus();
      });
      form.addEventListener('change', record);
      find('[data-center]').addEventListener('click', () => {
        invalidDraft = false;
        settings = { ...settings, focal_x: 50, focal_y: 50, zoom: 1 };
        record(); renderValues();
      });
      find('[data-reset]').addEventListener('click', restore);
      const playback = find('[data-playback]');
      if (playback) playback.addEventListener('click', async () => {
        try {
          if (media.paused) { await media.play(); await destination?.video?.()?.play(); playback.textContent = 'Pause preview'; }
          else { media.pause(); destination?.video?.()?.pause(); playback.textContent = 'Play preview'; }
        } catch (error) {
          console.error('[Placement video preview]', error);
          setStatus('Video playback failed. Retry loading the preview.', 'failed');
        }
      });
      find('[data-destination-retry]').addEventListener('click', showDestination);
      findAllDevices().forEach(button => button.addEventListener('click', () => {
        device = button.dataset.device;
        findAllDevices().forEach(entry => entry.setAttribute('aria-pressed', String(entry.dataset.device === device)));
        showDestination();
      }));
      renderValues();
      showDestination();
      enableSave();
    };
    const findAllDevices = () => Array.from(host.querySelectorAll('[data-device]'));
    const showDestination = () => {
      destination?.destroy();
      destination = null;
      destinationReady = false;
      const config = areaConfig();
      const note = find('[data-destination-status]');
      const retry = find('[data-destination-retry]');
      retry.hidden = true;
      if (config.unavailableReason || !config.preview) {
        stage.style.display = 'none';
        note.textContent = config.unavailableReason || 'Destination preview is not connected. The developer must register the page and frame selector. Saved settings are retained.';
        enableSave();
        return;
      }
      stage.style.cssText = 'position:relative;overflow:hidden;width:100%;height:240px;';
      media.style.visibility = 'hidden';
      destination = (options.previewFactory || destinationPreview)({
        stage, config: config.preview, url: media.src, isVideo: media.tagName === 'VIDEO',
        settings, viewport: viewport(),
        onState(state) {
          if (closed) return;
          destinationReady = state.ready;
          note.setAttribute('role', state.error ? 'alert' : 'status');
          note.textContent = state.error ? `Preview unavailable: ${state.error} Your draft is retained.`
            : state.ready ? `${Math.round(state.width)} \u00d7 ${Math.round(state.height)} px destination frame at ${state.viewport.width} \u00d7 ${state.viewport.height}. Actual page layout and overlays; drag here to frame.`
            : 'Loading the destination page layout and media...';
          retry.hidden = !state.error;
          enableSave();
        },
      });
    };
    const save = async () => {
      if (replacement && !replacementSupported) { draftStatus(); return false; }
      if (!loaded || !previewReady || !destinationReady || busy || closed) {
        if (!busy && !closed) setStatus('Cannot save this placement until its saved settings and media preview have loaded.', 'failed');
        return false;
      }
      const form = find('form');
      if (!form.checkValidity()) {
        form.querySelector('details').open = true;
        form.reportValidity();
        setStatus('Cannot save this placement. Correct the highlighted framing or display order values.', 'failed');
        return false;
      }
      finishZoom();
      drag = null;
      stage.classList.remove('is-dragging');
      const draft = { ...settings };
      if (replacement && !draft.enabled) { setStatus('Include the replacement in this area before saving.', 'failed'); return false; }
      busy = true; enableSave();
      setStatus(`Saving placement: ${scopeLabel()}...`, 'saving');
      try {
        const result = await request('PUT', replacement ? { ...draft, replace: {
          asset_source: replacement.asset_source, asset_id: replacement.asset_id,
        } } : draft);
        if (!result.placement || Object.keys(draft).some((key) => result.placement[key] !== draft[key])) {
          throw new Error('The server did not confirm the requested placement settings. Retry saving before leaving.');
        }
        if (replacement && (result.replaced?.asset_source !== replacement.asset_source
          || result.replaced?.asset_id !== replacement.asset_id || result.replaced?.enabled !== false)) {
          throw new Error('The server did not confirm replacement. Reload saved settings before trying again.');
        }
        if (closed) return false;
        replacement = null;
        placements = placements.filter((row) => row.surface !== surface || row.area !== area).concat(result.placement);
        cleanSettings = JSON.stringify(draft);
        find('[data-reset]').disabled = false;
        draftStatus();
        options.onSaved?.();
        return true;
      } catch (error) {
        console.error('[Placement save]', error);
        if (!closed) setStatus(`Save failed for ${scopeLabel()}: ${error.message}. Your draft is still open.`, 'failed');
        return false;
      } finally { busy = false; enableSave(); }
    };
    const restore = async () => {
      if (replacement) { setStatus('Cancel this replacement before restoring automatic selection.', 'failed'); return; }
      if (busy || decision || !root.confirm(`Restore automatic selection for ${scopeLabel()}? This removes only this media's saved placement${dirty() ? ' and discards the current draft' : ''}. It does not change the shared asset or other placements.`)) return;
      busy = true; enableSave();
      setStatus(`Restoring automatic selection: ${scopeLabel()}...`, 'saving');
      try {
        await request('DELETE', { ...settings });
        placements = placements.filter((row) => row.surface !== surface || row.area !== area);
        busy = false;
        loadScope(surface, area);
        options.onSaved?.();
      } catch (error) {
        console.error('[Placement reset]', error);
        setStatus(`Could not restore automatic selection: ${error.message}. Your draft is still open.`, 'failed');
      } finally { busy = false; enableSave(); }
    };
    const previewState = (ready, failed = false) => {
      if (closed) return;
      previewReady = ready;
      loadOverlay.classList.toggle('is-visible', !ready && !failed);
      errorOverlay.classList.toggle('is-visible', failed);
      enableSave();
    };
    const intrinsic = () => ({ width: media.naturalWidth || media.videoWidth, height: media.naturalHeight || media.videoHeight });
    const onLoad = () => { if (intrinsic().width) previewState(true); };
    media.addEventListener('load', onLoad);
    media.addEventListener('loadeddata', onLoad);
    media.addEventListener('canplay', onLoad);
    media.addEventListener('error', () => previewState(false, true));
    errorOverlay.querySelector('.pp-error-subtitle').textContent = 'The media could not load. Check its storage path or retry.';
    const retry = root.document.createElement('button');
    retry.type = 'button'; retry.className = 'btn btn-tonal'; retry.textContent = 'Retry preview';
    retry.addEventListener('click', () => {
      const url = new URL(media.src, root.location.href);
      url.searchParams.set('v', Date.now());
      previewState(false);
      media.src = url.href;
      showDestination();
      if (media.tagName === 'VIDEO') media.load();
    });
    errorOverlay.querySelector('.pp-error-box').appendChild(retry);
    if ((media.tagName === 'IMG' && media.complete && media.naturalWidth) || media.readyState >= 2) onLoad();
    else if (media.tagName === 'IMG' && media.complete) previewState(false, true);
    stage.addEventListener('pointerdown', (event) => {
      if (busy || decision || invalidDraft || !loaded || !previewReady || !destinationReady || event.button !== 0) return;
      finishZoom();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...settings } };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging');
      event.preventDefault();
    });
    stage.addEventListener('pointermove', (event) => {
      if (busy || decision || !drag || event.pointerId !== drag.id) return;
      settings = pan(drag.start, event.clientX - drag.x, event.clientY - drag.y, stage.getBoundingClientRect(), intrinsic());
      applyPreview();
      draftStatus();
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (event.type === 'pointercancel') settings = drag.start;
      drag = null;
      stage.classList.remove('is-dragging');
      record();
      renderValues();
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('lostpointercapture', endDrag);
    stage.addEventListener('wheel', (event) => { event.preventDefault(); zoomBy(-Math.sign(event.deltaY) * 0.05, true); }, { passive: false });
    find('#ppUndoBtn').addEventListener('click', undo);
    find('#ppRedoBtn').addEventListener('click', redo);
    saveButton.addEventListener('click', save);
    const load = async () => {
      loaded = false; enableSave();
      setStatus('Loading saved placements...', 'loading');
      try {
        const result = await request('GET');
        if (closed) return;
        replacementSupported = result.capabilities?.replace === true;
        pages = result.pages && Object.fromEntries(Object.entries(result.pages).map(([key, page]) => [
          key, { ...page, areas: page.areas?.map(entry => ({ ...entry, ...destinationPreviews[key]?.[entry.key] })) },
        ]));
        if (!pages || !Object.values(pages).every((page) => page.title && page.areas?.length
          && page.areas.every((entry) => /^[0-9.]+ \/ [0-9.]+$/.test(entry.aspect)))) throw new Error('Invalid developer page catalog');
        placements = result.placements;
        loaded = true;
        const initial = options.initialPlacement;
        if (!initial || !pages[initial.surface]?.areas.some(entry => entry.key === initial.area)) {
          throw new Error('The requested page placement is not registered.');
        }
        surface = initial.surface;
        loadScope(surface, initial.area);
        await destination?.ready;
      } catch (error) {
        if (closed) return;
        console.error('[Placement load]', error);
        setStatus(error.message, 'failed');
        controls.innerHTML = '<button type="button" class="btn btn-tonal" data-reload>Retry loading saved placements</button>';
        find('[data-reload]').addEventListener('click', load);
      } finally { if (!closed) enableSave(); }
    };
    const controller = {
      cancel, destroy, save, undo, redo,
      handleKey(event) {
        if (decision) {
          if (event.key === 'Escape') { event.preventDefault(); if (!busy) closeDecision(); }
          return;
        }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
        const modifier = event.ctrlKey || event.metaKey;
        if (!modifier) return;
        const key = event.key.toLowerCase();
        if (key === 's') { event.preventDefault(); save(); return; }
        if (event.target.matches('input, textarea, [contenteditable="true"]')) return;
        if (['z', 'y'].includes(key)) event.preventDefault();
        if (key === 'z' && !event.shiftKey) undo();
        if (key === 'y' || (key === 'z' && event.shiftKey)) redo();
      },
    };
    controller.ready = load();
    return controller;
  }

  const api = { style, pan, mount, chooseDestination, chooseReplacement, inertDestination, destinationFrame, destinationPreview };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.H2SMediaPlacements = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
