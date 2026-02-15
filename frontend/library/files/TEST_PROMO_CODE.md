# PROMO CODE END-TO-END TEST PLAN

## Test Environment
- **Frontend:** https://shop.home2smart.com/bundles.html
- **Backend:** https://h2s-backend.vercel.app
- **Test Code:** h2sqa-e2e-2025 (100% off)

## Test Steps

### STEP 1: Validate Promo Code UI (Cart Modal)

1. Open https://shop.home2smart.com/bundles.html
2. Add a TV Mount package to cart ($599)
3. Open cart modal
4. In promo code field, enter: `h2sqa-e2e-2025`
5. Click "Apply"

**Expected Results:**
- ✓ Message shows: "✓ Discount applied! You save $599.00"
- ✓ Cart displays:
  - Subtotal: $599.00
  - Promo (H2SQA-E2E-2025): -$599.00
  - Grand Total: $0.00 (in green)
- ✓ No errors in console
- ✓ No "Invalid or expired code" message

**Browser Console Check:**
```javascript
// Check localStorage
localStorage.getItem('h2s_promo_code')
// Should return: "h2sqa-e2e-2025"
```

### STEP 2: Validate API Calls

Open DevTools → Network tab and verify:

**Request 1:** GET /api/promo_validate?code=h2sqa-e2e-2025
- Status: 200 OK
- Response: `{"ok":true,"valid":true,"code":"h2sqa-e2e-2025",...}`

**Request 2:** POST /api/shop (action=promo_check_cart)
- Status: 200 OK
- Body contains: `{"__action":"promo_check_cart","promotion_code":"h2sqa-e2e-2025","line_items":[...]}`
- Response: `{"ok":true,"applicable":true,"estimate":{"savings_cents":59900,"total_cents":0}}`

**Should NOT see:**
- ❌ GET /api/shop?action=ai_sales (this is unrelated to promo codes)
- ❌ Any 500 Internal Server Errors
- ❌ Stripe timeout errors

### STEP 3: Test Checkout Flow

1. With promo applied, click "Proceed to Checkout"
2. Fill in:
   - Email: test@home2smart.com
   - Name: Test User
   - Phone: (555) 123-4567
   - Address: 123 Main St, Greenwood, SC 29646
3. Click "Continue to Payment"

**Expected Results:**
- ✓ Redirects to Stripe Checkout
- ✓ Stripe shows $0.00 total OR discount applied
- ✓ Promo code visible in Stripe UI
- ✓ Can complete checkout (no payment required for $0.00)

**Backend Check:**
Check POST /api/shop (action=create_checkout_session)
- Should include: `"promotion_code":"h2sqa-e2e-2025"`
- Response should contain: `"url":"https://checkout.stripe.com/..."`

### STEP 4: Verify Order Creation

After checkout completes:
1. Check Stripe dashboard: https://dashboard.stripe.com/payments
2. Verify order shows 100% discount applied
3. Check dispatch system for created job

### STEP 5: Test Invalid Code

1. Open cart, remove any existing promo
2. Enter invalid code: `INVALID999`
3. Click "Apply"

**Expected Results:**
- ✓ Shows: "Invalid or expired code"
- ✓ No discount applied
- ✓ Total remains $599.00
- ✓ Returns 200 OK with `valid: false` (not 500 error)

### STEP 6: Test Other Valid Codes

Test with other cached codes:
- `NEWYEAR50` - should apply $50 discount

## Automated Verification Script

Run this in browser console on shop.home2smart.com/bundles.html:

```javascript
// Test promo code validation
async function testPromoCode() {
  console.log('Testing h2sqa-e2e-2025...');
  
  const API = 'https://h2s-backend.vercel.app/api/shop';
  
  // Test 1: Validate
  const resp1 = await fetch('https://h2s-backend.vercel.app/api/promo_validate?code=h2sqa-e2e-2025');
  const data1 = await resp1.json();
  console.log('✓ Validation:', data1.ok && data1.valid ? 'PASS' : 'FAIL', data1);
  
  // Test 2: Check cart
  const resp2 = await fetch(API, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      __action: 'promo_check_cart',
      promotion_code: 'h2sqa-e2e-2025',
      line_items: [{ price: 'test', unit_amount: 59900, quantity: 1 }]
    })
  });
  const data2 = await resp2.json();
  console.log('✓ Cart check:', data2.ok && data2.applicable ? 'PASS' : 'FAIL', data2);
  
  // Test 3: Invalid code
  const resp3 = await fetch('https://h2s-backend.vercel.app/api/promo_validate?code=INVALID999');
  const data3 = await resp3.json();
  console.log('✓ Invalid code:', !data3.valid ? 'PASS' : 'FAIL', data3);
  
  console.log('All tests completed!');
}

testPromoCode();
```

## Success Criteria

All of the following must be true:
- [✓] Promo code validates successfully (no 500 errors)
- [✓] Cart totals update correctly with discount
- [✓] Checkout session creates with promo applied
- [✓] Invalid codes show appropriate error (not 500)
- [✓] No console errors related to promo validation
- [✓] Frontend calls correct endpoints (not ai_sales)

## Known Issues / Limitations

1. **Cache-based validation:** Only codes in `promoCache.ts` work without Stripe timeout
2. **Vercel-Stripe connectivity:** Direct Stripe API calls may timeout (fallback to cache)
3. **Adding new codes:** Requires updating cache in code (until Stripe connectivity fixed)

## Next Steps if Tests Fail

1. Check browser console for errors
2. Check Network tab for 500/4xx responses
3. Verify backend deployment: `curl https://h2s-backend.vercel.app/api/promo_validate?code=h2sqa-e2e-2025`
4. Clear localStorage and try again
5. Check Vercel logs for backend errors
