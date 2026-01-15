// Known promo codes (cached to avoid Stripe API timeouts from Vercel)
// This cache enables deterministic checkout without Stripe API lookups
export const KNOWN_PROMO_CODES: Record<string, {
  id: string; // Stripe promotion_code ID (promo_...)
  code: string;
  active: boolean;
  coupon: {
    id: string;
    percent_off: number | null;
    amount_off: number | null;
    currency: string | null;
  };
}> = {
  'h2sqa-e2e-2025': {
    id: 'promo_1SZWVsLuMP6aPhGZGhct6nRT', // Stripe promotion_code ID
    code: 'h2sqa-e2e-2025',
    active: true,
    coupon: {
      id: 'qa-e2e-100off',
      percent_off: 100,
      amount_off: null,
      currency: null
    }
  },
  'newyear50': {
    id: 'promo_placeholder', // TODO: Get real Stripe promotion_code ID
    code: 'NEWYEAR50',
    active: true,
    coupon: {
      id: 'newyear50-coupon',
      percent_off: null,
      amount_off: 5000, // $50 in cents
      currency: 'usd'
    }
  }
};
