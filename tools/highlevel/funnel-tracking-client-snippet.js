(function () {
  'use strict';

  const TRACK_API = 'https://h2s-backend.vercel.app/api/track';
  const VISITOR_KEY = 'h2s_visitor_id';
  const SESSION_KEY = 'h2s_session_id';

  function getVisitorId() {
    let vid = localStorage.getItem(VISITOR_KEY);
    if (!vid) {
      vid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
      localStorage.setItem(VISITOR_KEY, vid);
    }
    return vid;
  }

  function getSessionId() {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function extractUTM() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_term: params.get('utm_term') || null,
      utm_content: params.get('utm_content') || null,
    };
  }

  const eventQueue = [];
  let isSending = false;

  function sendEvent(payload, retries = 1) {
    const useBeacon = false; // we intentionally do not track page unload

    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      if (navigator.sendBeacon(TRACK_API, blob)) {
        return Promise.resolve();
      }
    }

    return fetch(TRACK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        if (retries > 0) {
          return new Promise((resolve) => {
            setTimeout(() => {
              sendEvent(payload, retries - 1)
                .then(resolve)
                .catch(() => resolve());
            }, 500);
          });
        }
        console.warn('[Tracking] Event failed:', err);
      });
  }

  function track(eventType, data = {}) {
    const payload = {
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      ...extractUTM(),
      ...data,
    };

    if (data.element_id) payload.element_id = data.element_id;
    if (data.element_text) payload.element_text = data.element_text;

    if (isSending) {
      eventQueue.push(payload);
    } else {
      isSending = true;
      sendEvent(payload).finally(() => {
        isSending = false;
        if (eventQueue.length > 0) {
          const next = eventQueue.shift();
          track(next.event_type, next);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      track('page_view');
    });
  } else {
    track('page_view');
  }

  document.addEventListener('click', function (e) {
    const target = e.target.closest('[data-track]');
    if (target) {
      const eventType = target.getAttribute('data-track') || 'click';
      const elementId = target.id || target.getAttribute('data-track-id') || null;
      const elementText = target.textContent?.trim().substring(0, 100) || null;

      track(eventType, {
        element_id: elementId,
        element_text: elementText,
      });
    }
  });

  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (form && form.tagName === 'FORM') {
      const formId = form.id || form.getAttribute('data-track-id') || 'unknown_form';

      let customerEmail = null;
      let customerPhone = null;

      const emailInput = form.querySelector(
        'input[type="email"], input[name*="email" i], input[name*="Email"], input[id*="email" i], input[id*="Email"]'
      );
      if (emailInput && emailInput.value) customerEmail = emailInput.value.trim().toLowerCase();

      const phoneInput = form.querySelector(
        'input[type="tel"], input[name*="phone" i], input[name*="Phone"], input[id*="phone" i], input[id*="Phone"], input[name*="mobile" i], input[name*="Mobile"]'
      );
      if (phoneInput && phoneInput.value) customerPhone = phoneInput.value.trim();

      const trackData = { element_id: formId, element_text: formId };
      if (customerEmail) trackData.customer_email = customerEmail;
      if (customerPhone) trackData.customer_phone = customerPhone;

      track('form_submit', trackData);
    }
  });

  document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href]');
    if (link && link.hostname !== window.location.hostname) {
      track('outbound', {
        element_id: link.id || null,
        element_text: link.textContent?.trim().substring(0, 100) || null,
        metadata: { url: link.href },
      });
    }
  });

  window.h2sTrack = track;

  // Intentionally do not track page unload.
})();
