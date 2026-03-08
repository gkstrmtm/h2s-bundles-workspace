export function normalizePhone(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Keep leading + if present; strip everything else non-digit.
  const plus = s.startsWith('+') ? '+' : '';
  const digits = s.replace(/\D+/g, '');
  return plus ? `+${digits}` : digits;
}

export function isLikelyPhone(value: string): boolean {
  const s = normalizePhone(value);
  return s.length >= 10;
}
