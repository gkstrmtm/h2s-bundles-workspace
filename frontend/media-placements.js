(function (root) {
  'use strict';

  const bounded = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  function style(settings) {
    if (!settings) return '';
    const x = bounded(settings.focal_x, 0, 100, 50);
    const y = bounded(settings.focal_y, 0, 100, 50);
    const zoom = bounded(settings.zoom, 1, 3, 1);
    const fit = settings.fit === 'contain' ? 'contain' : 'cover';
    return `object-fit:${fit};object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${zoom});`;
  }

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
      setStatus(dirty() ? `Unsaved changes: ${scopeLabel()}`
        : saved() ? `Saved placement: ${scopeLabel()}` : `Automatic selection: ${scopeLabel()} (no override)`,
      dirty() ? 'unsaved' : saved() ? 'saved' : 'automatic');
    };
    const enableSave = () => {
      saveButton.disabled = busy || !loaded || !previewReady;
      saveButton.textContent = busy ? 'Saving placement...' : 'Save this placement';
      find('#ppUndoBtn').disabled = busy || index <= 0;
      find('#ppRedoBtn').disabled = busy || index >= states.length - 1;
      const form = find('form');
      if (form) form.querySelector('fieldset').disabled = busy || !loaded;
      scopeControls.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
      if (decision) decision.element.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
    };
    const request = async (method, body) => {
      const params = new URLSearchParams({ asset_source: options.source, asset_id: options.asset.asset_id });
      const response = await root.fetch(`${options.base}/api/admin/media-placements${method === 'GET' ? `?${params}` : ''}`, {
        method, cache: 'no-store',
        headers: { Authorization: `Bearer ${options.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load or save page placement');
      return result;
    };
    const applyPreview = () => {
      if (!settings) return;
      media.style.cssText = `display:block;width:100%;height:100%;max-width:none;margin:0;${style(settings)}`;
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
      if (!loaded || busy || decision || invalidDraft || !previewReady) return;
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
      cleanSettings = JSON.stringify(settings);
      states = [{ ...settings }];
      index = 0;
      render();
    };
    const changeScope = (nextSurface, nextArea) => {
      if (surface === nextSurface && area === nextArea) return;
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
          ${pages[surface].areas.map((entry) => `<button type="button" class="btn btn-tonal" data-area="${escape(entry.key)}" aria-pressed="${area === entry.key}">${escape(entry.title)}</button>`).join('')}
        </div></fieldset>` : ''}
        <strong>${escape(pages[surface].title)} / ${escape(config.title)} - placement only</strong>`;
      scopeControls.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
        if (button.dataset.page !== surface) changeScope(button.dataset.page, pages[button.dataset.page].areas[0].key);
      }));
      scopeControls.querySelectorAll('[data-area]').forEach((button) => button.addEventListener('click', () => {
        if (button.dataset.area !== area) changeScope(surface, button.dataset.area);
      }));
      stage.style.cssText = `position:relative;overflow:hidden;aspect-ratio:${config.aspect};width:min(100%, 50vh * (${config.aspect}));height:auto;max-height:50vh;background:var(--cobalt);`;
      find('.editor-title').textContent = `Placement framing: ${pages[surface].title} / ${config.title}`;
      find('#ppEditorOverlayLabel').textContent = `${pages[surface].title} / ${config.title}`;
      controls.innerHTML = `
        <form class="media-placement-form"><fieldset>
          <label><input name="enabled" type="checkbox"> Include this asset in this area</label>
          <small>Uncheck to exclude only this asset here. Other placements and the shared file are unchanged.</small>
          <div class="media-placement-options">
            <label><input type="radio" name="fit" value="cover"> Fill frame</label>
            <label><input type="radio" name="fit" value="contain"> Fit whole photo</label>
            <button type="button" class="media-placement-secondary" data-center title="Center the image and reset zoom. Keeps fit mode, inclusion, order, and the placement override. Save to persist.">Reset framing</button>
            ${media.tagName === 'VIDEO' ? '<button type="button" class="btn btn-tonal" data-playback>Play preview</button>' : ''}
          </div>
          <label>Zoom <output data-zoom-value></output><input aria-label="Placement zoom" name="zoom" type="range" min="1" max="3" step="0.01"></label>
          <details><summary>Advanced: precise framing and display order</summary>
            <div class="media-placement-fields">
              <label>Horizontal focus (%)<input name="focal_x" type="number" min="0" max="100" step="any" required></label>
              <label>Vertical focus (%)<input name="focal_y" type="number" min="0" max="100" step="any" required></label>
              <label>Display order<input name="display_order" type="number" min="0" max="999" step="1" required></label>
            </div>
            <small>Lower order appears first within the area's service group. Preview uses the registered frame ratio; responsive sizes can vary.</small>
          </details>
          <div class="media-placement-options">
            <button type="button" class="media-placement-secondary" data-reset ${saved() ? '' : 'disabled'} title="Remove only this saved placement override and let the page select media automatically.">Restore automatic selection</button>
            <small>Removes this override, not the shared asset.</small>
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
          if (media.paused) { await media.play(); playback.textContent = 'Pause preview'; }
          else { media.pause(); playback.textContent = 'Play preview'; }
        } catch (error) {
          console.error('[Placement video preview]', error);
          setStatus('Video playback failed. Retry loading the preview.', 'failed');
        }
      });
      renderValues();
      enableSave();
    };
    const save = async () => {
      if (!loaded || !previewReady || busy || closed) {
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
      busy = true; enableSave();
      setStatus(`Saving placement: ${scopeLabel()}...`, 'saving');
      try {
        const result = await request('PUT', draft);
        if (!result.placement || Object.keys(draft).some((key) => result.placement[key] !== draft[key])) {
          throw new Error('The server did not confirm the requested placement settings. Retry saving before leaving.');
        }
        if (closed) return false;
        placements = placements.filter((row) => row.surface !== surface || row.area !== area).concat(result.placement);
        cleanSettings = JSON.stringify(draft);
        find('[data-reset]').disabled = false;
        draftStatus();
        return true;
      } catch (error) {
        console.error('[Placement save]', error);
        if (!closed) setStatus(`Save failed for ${scopeLabel()}: ${error.message}. Your draft is still open.`, 'failed');
        return false;
      } finally { busy = false; enableSave(); }
    };
    const restore = async () => {
      if (busy || decision || !root.confirm(`Restore automatic selection for ${scopeLabel()}? This removes only its saved override${dirty() ? ' and discards the current draft' : ''}. It does not change the shared asset or other placements.`)) return;
      busy = true; enableSave();
      setStatus(`Removing placement override: ${scopeLabel()}...`, 'saving');
      try {
        await request('DELETE', { ...settings });
        placements = placements.filter((row) => row.surface !== surface || row.area !== area);
        busy = false;
        loadScope(surface, area);
      } catch (error) {
        console.error('[Placement reset]', error);
        setStatus(`Could not remove this placement override: ${error.message}. Your draft is still open.`, 'failed');
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
      if (media.tagName === 'VIDEO') media.load();
    });
    errorOverlay.querySelector('.pp-error-box').appendChild(retry);
    if ((media.tagName === 'IMG' && media.complete && media.naturalWidth) || media.readyState >= 2) onLoad();
    else if (media.tagName === 'IMG' && media.complete) previewState(false, true);
    stage.addEventListener('pointerdown', (event) => {
      if (busy || decision || invalidDraft || !loaded || !previewReady || event.button !== 0) return;
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
        pages = result.pages;
        if (!pages || !Object.values(pages).every((page) => page.title && page.areas?.length
          && page.areas.every((entry) => /^[0-9.]+ \/ [0-9.]+$/.test(entry.aspect)))) throw new Error('Invalid developer page catalog');
        placements = result.placements;
        loaded = true;
        surface = Object.keys(pages)[0];
        loadScope(surface, pages[surface].areas[0].key);
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

  const api = { style, pan, mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.H2SMediaPlacements = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
