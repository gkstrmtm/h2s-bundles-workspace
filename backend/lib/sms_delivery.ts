export const deliveryStatuses = ['scheduled','accepted','queued','sending','sent','delivered','read','failed','undelivered','canceled'] as const;
export function smsStatusCallbackUrl() {
  const raw = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
    || url.pathname !== '/api/twilio/message-status') throw new Error('Configure a canonical HTTPS TWILIO_STATUS_CALLBACK_URL ending /api/twilio/message-status');
  return url.href;
}
export const communicationLabels: Record<string, string> = {
  pending: 'Pending', provider_accepted: 'Accepted by Twilio — delivery not confirmed',
  delivered: 'Delivered', failed: 'Delivery failed', uncertain: 'Status unavailable / needs review',
};
