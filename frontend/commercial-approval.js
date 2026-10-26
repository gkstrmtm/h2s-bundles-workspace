(function () {
  const API_BASE = (function () {
    const host = String(location.hostname || '').toLowerCase();
    if (location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') {
      return '/api';
    }
    return '/api';
  })();

  const RESPONSE_ENDPOINT = `${API_BASE}/commercial-consultation-response`;
  let ready = false, submitting = false;

  function syncControls() {
    ['approveBtn', 'declineBtn', 'approvalNote'].forEach(function (id) {
      const node = byId(id);
      if (node) node.disabled = !ready || submitting;
    });
  }

  async function request(url, options) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'The request service is unavailable.');
      return payload;
    } finally { clearTimeout(timer); }
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tokenFromUrl() {
    return String(new URL(location.href).searchParams.get('token') || '').trim();
  }

  function actionFromUrl() {
    return String(new URL(location.href).searchParams.get('action') || '').trim().toLowerCase();
  }

  function setMessage(text, tone) {
    const node = byId('approvalMessage');
    if (!node) return;
    node.textContent = text;
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
  }

  function renderContext(payload) {
    const consultation = payload.consultation || {};
    const lead = payload.lead || {};
    byId('approvalHeading').textContent = `Review ${consultation.referenceCode || 'consultation request'}`;
    byId('approvalReference').textContent = consultation.referenceCode || '--';
    byId('approvalCompany').textContent = lead.companyName || lead.fullName || '--';
    byId('approvalSlot').textContent = consultation.slotLabel || '--';
    byId('approvalStatus').textContent = consultation.status || '--';
    const services = Array.isArray(lead.serviceNeeds) ? lead.serviceNeeds : [];
    const target = byId('approvalServices');
    target.innerHTML = services.map(function (service) {
      return `<span class="status-pill">${escapeHtml(service)}</span>`;
    }).join('');
  }

  async function loadContext() {
    const token = tokenFromUrl();
    if (!token) {
      setMessage('Missing consultation token.', 'error');
      return null;
    }

    try {
      const payload = await request(`${RESPONSE_ENDPOINT}?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      renderContext(payload);
      ready = ['pending', 'escalated'].includes(payload.consultation.status);
      syncControls();
      setMessage(ready
        ? 'Approval records the technician decision. Appointment creation and customer notification are separate results.'
        : 'This request is no longer awaiting a decision. Check Commercial Queue for appointment and text-update results.', '');
      return payload;
    } catch (error) {
      setMessage(`Could not load this request: ${error.message} Check your connection and reload this link.`, 'error');
      return null;
    }
  }

  async function submitDecision(action) {
    if (!ready || submitting) return;
    const token = tokenFromUrl();
    if (!token) {
      setMessage('Missing consultation token.', 'error');
      return;
    }

    const note = byId('approvalNote') ? byId('approvalNote').value.trim() : '';
    submitting = true;
    syncControls();
    setMessage(`Submitting ${action}...`, '');
    try {
      const payload = await request(RESPONSE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action, note })
      });
      renderContext(payload);
      ready = false;
      const appointment = payload.appointment;
      const customer = payload.notifications && payload.notifications.customer;
      setMessage(action === 'approve'
        ? appointment && appointment.ok
          ? customer && customer.ok
            ? 'Appointment exists. The SMS provider accepted the customer confirmation; delivery and customer acknowledgement are not verified.'
            : 'Appointment exists, but customer communication needs review in Commercial Queue. Do not resend an uncertain provider attempt.'
          : 'Technician approval recorded. Appointment creation needs review in Commercial Queue. No booking confirmation was sent.'
        : 'Decline recorded. Review the management notification result in Commercial Queue.', 'success');
    } catch (error) {
      ready = false;
      setMessage(`Could not verify the result: ${error.message} Your decision may have been saved. Reload this link to check its status before trying again.`, 'error');
    } finally {
      submitting = false;
      syncControls();
    }
  }

  async function init() {
    syncControls();
    const context = await loadContext();
    if (!context) return;

    const approveBtn = byId('approveBtn');
    const declineBtn = byId('declineBtn');
    if (approveBtn) approveBtn.addEventListener('click', function () { submitDecision('approve'); });
    if (declineBtn) declineBtn.addEventListener('click', function () { submitDecision('decline'); });

    const urlAction = actionFromUrl();
    if (ready && (urlAction === 'approve' || urlAction === 'decline')) {
      setMessage(`Ready to ${urlAction} this consultation request.`, '');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();