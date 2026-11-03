export function isFieldSalesStripeObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('metadata' in value)) return false;
  const metadata = value.metadata;
  return !!metadata && typeof metadata === 'object' && 'h2s_flow' in metadata && metadata.h2s_flow === 'field_sales_v1';
}
