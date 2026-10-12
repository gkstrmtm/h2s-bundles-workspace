(function () {
  const API_BASE = (function () {
    const host = String(location.hostname || '').toLowerCase();
    if (location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') {
      return 'https://h2s-backend.vercel.app/api';
    }
    return '/api';
  })();

  const RESPONSE_ENDPOINT = `${API_BASE}/commercial-consultation-response`;

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

    const response = await fetch(`${RESPONSE_ENDPOINT}?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setMessage(payload.error || 'Failed to load consultation request.', 'error');
      return null;
    }
    renderContext(payload);
    setMessage('Approve or decline the request. The backend will handle customer confirmation or internal escalation.', '');
    return payload;
  }

  async function submitDecision(action) {
    const token = tokenFromUrl();
    if (!token) {
      setMessage('Missing consultation token.', 'error');
      return;
    }

    const note = byId('approvalNote') ? byId('approvalNote').value.trim() : '';
    setMessage(`Submitting ${action}...`, '');
    const response = await fetch(RESPONSE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, note })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setMessage(payload.error || 'Failed to record consultation response.', 'error');
      return;
    }
    renderContext(payload);
    setMessage(action === 'approve'
      ? 'Consultation approved. Customer confirmation has been triggered.'
      : 'Consultation declined. Management follow-up has been triggered.', 'success');
  }

  async function init() {
    const context = await loadContext();
    if (!context) return;

    const approveBtn = byId('approveBtn');
    const declineBtn = byId('declineBtn');
    if (approveBtn) approveBtn.addEventListener('click', function () { submitDecision('approve'); });
    if (declineBtn) declineBtn.addEventListener('click', function () { submitDecision('decline'); });

    const urlAction = actionFromUrl();
    if (urlAction === 'approve' || urlAction === 'decline') {
      setMessage(`Ready to ${urlAction} this consultation request.`, '');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();