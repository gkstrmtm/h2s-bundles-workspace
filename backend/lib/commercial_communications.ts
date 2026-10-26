import { communicationLabels } from '@/lib/sms_delivery';
type Effect = { kind: string; state: string; details?: { sid?: string; status?: string; to?: string; persistenceError?: string }; updated_at?: string | null };
type Receipt = { twilio_sid: string; status?: string | null; created_at?: string | null };
type Delivery = { message_sid: string; to_phone: string; status: string; received_at: string;
  last_error_code?: string | null; last_error_message?: string | null; conflicting_terminal?: boolean };
const purposes: Record<string, string> = {
  dispatch: 'Technician request', reminder: 'Technician reminder', escalation: 'Staff escalation',
  customer_confirmation: 'Customer confirmation', customer_acknowledgement: 'Customer acknowledgement notice',
  customer_call: 'Customer consultation call reminder',
  owner_reply: 'Owner response confirmation', owner_call: 'Owner consultation call reminder',
  owner_inquiry: 'Homeowner follow-up review',
  customer_inquiry_ack: 'Homeowner inquiry received',
  customer_inquiry_acceptance: 'Homeowner follow-up accepted (not a booking)',
};
export function commercialCommunicationSummary(effects: Effect[], receipts: Receipt[], deliveries: Delivery[] = []) {
  const messages = new Map(receipts.map(row => [row.twilio_sid, row]));
  const updates = new Map(deliveries.map(row => [row.message_sid, row]));
  return effects.filter(row => purposes[row.kind.split(':')[0]]).map(row => {
    const purpose = row.kind.split(':')[0], sid = row.details?.sid;
    const recipient = row.details?.to || (['dispatch','reminder','escalation'].includes(purpose) ? row.kind.split(':').pop() : '');
    const candidate = sid ? updates.get(sid) : undefined;
    const mismatch = !!candidate && !!recipient && candidate.to_phone !== recipient;
    const delivery = mismatch ? undefined : candidate;
    const message = sid ? messages.get(sid) : undefined;
    const providerStatus = String(delivery?.status || message?.status || row.details?.status || '').toLowerCase();
    const result = mismatch || delivery?.conflicting_terminal ? 'uncertain'
      : ['delivered','read'].includes(providerStatus) ? 'delivered'
        : ['failed','undelivered','canceled','cancelled'].includes(providerStatus) || row.state === 'failed' ? 'failed'
          : row.state === 'uncertain' && !delivery ? 'uncertain'
            : row.state === 'accepted' || ['queued','accepted','sending','sent','scheduled'].includes(providerStatus) ? 'provider_accepted' : 'pending';
    return {
      purpose: purpose === 'owner_call' ? row.kind.split(':')[1] === 'before'
        ? 'Owner call reminder (15 minutes before)' : 'Owner call reminder (window start)' : purposes[purpose],
      role: purpose === 'owner_inquiry' ? 'Residential reviewer' : purpose.startsWith('owner_') ? 'Consultation owner' : purpose === 'escalation' ? 'Staff notification'
        : purpose.startsWith('customer_') ? 'Customer' : 'Technician notification',
      recipient: /^\+?\d{7,15}$/.test(recipient || delivery?.to_phone || '') ? recipient || delivery?.to_phone : null,
      result, statusLabel: communicationLabels[result],
      at: delivery?.received_at || row.updated_at || message?.created_at || null,
      timeLabel: delivery ? 'Delivery update received' : row.updated_at ? 'Application attempt updated' : 'Attempt recorded',
      processingIssue: mismatch ? 'Receipt recipient does not match the recorded send; correlation needs review.'
        : delivery?.conflicting_terminal ? 'Conflicting terminal receipts retained; review provider evidence.'
          : row.details?.persistenceError ? 'Accepted send has a message-history persistence issue; do not resend automatically.'
            : ['delivered','provider_accepted'].includes(result) && ['failed','uncertain'].includes(row.state)
              ? 'Application processing still needs review; delivery evidence does not resolve that issue.' : null,
      errorCode: delivery?.last_error_code || null, errorMessage: delivery?.last_error_message || null,
      receipt: delivery ? 'Signed provider update received. Not proof of reading, approval or customer acknowledgement.'
        : result === 'delivered' ? 'Delivery recorded; receipt timestamp unavailable.'
          : result === 'failed' ? 'Recorded failure; delivery is not confirmed.' : 'No delivery receipt recorded; this does not establish failure.',
    };
  }).sort((a, b) => Number(!!b.processingIssue || ['failed','uncertain'].includes(b.result)) - Number(!!a.processingIssue || ['failed','uncertain'].includes(a.result))
    || (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0));
}
