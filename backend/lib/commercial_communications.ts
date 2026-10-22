type Effect = { kind: string; state: string; details?: { sid?: string; status?: string; to?: string }; updated_at?: string | null };
type Receipt = { twilio_sid: string; status?: string | null; created_at?: string | null };
const purposes: Record<string, string> = {
  dispatch: 'Technician request', reminder: 'Technician reminder', escalation: 'Staff escalation',
  customer_confirmation: 'Customer confirmation', customer_acknowledgement: 'Customer acknowledgement notice',
};

export function commercialCommunicationSummary(effects: Effect[], receipts: Receipt[]) {
  const evidence = new Map(receipts.slice().sort((a, b) =>
    (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0)
      || String(a.status).localeCompare(String(b.status))).map(row => [row.twilio_sid, row]));
  return effects.filter(row => purposes[row.kind.split(':')[0]]).map(row => {
    const purpose = row.kind.split(':')[0];
    const receipt = row.details?.sid ? evidence.get(row.details.sid) : undefined;
    const providerStatus = String(receipt?.status || row.details?.status || '').toLowerCase();
    const result = ['delivered','read'].includes(providerStatus) ? 'delivered'
      : ['failed','undelivered','canceled','cancelled'].includes(providerStatus) || row.state === 'failed' ? 'failed'
        : row.state === 'uncertain' ? 'uncertain'
          : row.state === 'accepted' || ['queued','accepted','sending','sent'].includes(providerStatus) ? 'provider_accepted' : 'pending';
    const recipient = row.details?.to || (['dispatch','reminder','escalation'].includes(purpose) ? row.kind.split(':').pop() : '');
    return {
      purpose: purposes[purpose], role: purpose === 'escalation' ? 'Staff notification'
        : purpose.startsWith('customer_') ? 'Customer' : 'Technician notification',
      recipient: /^\+?\d{7,15}$/.test(recipient || '') ? recipient : null,
      result, at: receipt?.created_at || row.updated_at || null,
      processingIssue: result === 'delivered' && ['failed','uncertain'].includes(row.state)
        ? 'Application processing still needs review; delivery evidence does not resolve that issue.' : null,
      timeLabel: receipt?.created_at ? 'Attempt recorded' : 'Processing record updated',
      receipt: result === 'delivered' ? 'Delivery recorded; receipt timestamp unavailable.'
        : result === 'failed' ? 'Recorded failure; delivery is not confirmed.'
          : 'Delivery receipt unavailable.',
    };
  }).sort((a, b) => Number(!!b.processingIssue || ['failed','uncertain'].includes(b.result)) - Number(!!a.processingIssue || ['failed','uncertain'].includes(a.result))
    || (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0));
}
