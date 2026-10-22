(function (root) {
  'use strict';
  const humanize = (value, fallback = 'Not provided') => {
    const text = String(value || '').trim();
    if (!text) return fallback;
    return text.replace(/[_-]+/g, ' ').replace(/^\w/, letter => letter.toUpperCase());
  };
  const currency = value => '$' + Number(String(value).replace(/k$/i, '') * (/k$/i.test(value) ? 1000 : 1)).toLocaleString('en-US');
  function budget(value, fallback = 'Not provided') {
    const text = String(value || '').trim();
    const key = text.toLowerCase().replace(/[\s-]+/g, '_');
    const labels = { enterprise: 'Enterprise / phased rollout', not_sure: 'Not sure yet' };
    if (labels[key]) return labels[key];
    const range = /^(\d+(?:\.\d+)?k?)_(\d+(?:\.\d+)?k?)$/.exec(key);
    if (range) return `${currency(range[1])}\u2013${currency(range[2])}`;
    const under = /^under_(\d+(?:\.\d+)?k?)$/.exec(key);
    if (under) return `Under ${currency(under[1])}`;
    const plus = /^(\d+(?:\.\d+)?k?)_plus$/.exec(key);
    if (plus) return `${currency(plus[1])}+`;
    return humanize(text, fallback);
  }
  function timeline(value, fallback = 'Not provided') {
    const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ({
      asap: 'As soon as possible', this_week: 'This week', '2_weeks': 'Within 2 weeks',
      this_month: 'This month', this_quarter: 'This quarter', planning: 'Planning ahead',
      flexible: 'Flexible timing', not_sure: 'Not sure yet',
    })[key] || humanize(value, fallback);
  }
  function technician(consultation) {
    if (!consultation) return { label: 'Request not submitted', detail: 'No technician request has been submitted.' };
    const assigned = [consultation.assignedTechnicianName, consultation.assignedTechnicianPhone].filter(Boolean).join(' \u00b7 ');
    const routing = consultation.technicianRouting;
    let label = 'No named assignment recorded';
    let detail = 'Technician requests use configured SMS routing; notification delivery is not verified by this snapshot.';
    if (routing?.pendingCount) {
      label = 'Technician notification needs review';
      detail = 'A provider attempt is pending or uncertain. Reconcile it before retrying; delivery is unverified.';
    } else if (routing?.failedCount) {
      label = 'Technician notification failed';
      detail = 'At least one configured recipient notification failed. Review processing before retrying.';
    } else if (routing?.acceptedCount) {
      label = 'Technician request accepted by SMS provider';
      detail = `Accepted for ${routing.acceptedCount} configured technician recipient${routing.acceptedCount === 1 ? '' : 's'}. Delivery and reading are unverified.`;
    } else if (consultation.responseAt || ['approved', 'customer_confirmed', 'declined'].includes(consultation.status)) {
      label = 'Technician response recorded';
      detail = 'See the separate technician decision, appointment, and customer confirmation results.';
    }
    if (assigned) return { label: assigned, detail: `${label}. ${detail}` };
    return { label, detail: `${detail} No named assignment is recorded; this does not mean no technician was notified.` };
  }
  const api = { budget, timeline, technician };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.H2SCommercialLabels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
