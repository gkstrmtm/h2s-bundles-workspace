# Bundles Page - Quick Reference Guide

## 🔑 Key API Endpoints

### Production Base URL
```
https://h2s-backend.vercel.app
```

### Endpoints Quick List
| Endpoint | Method | Purpose | Key Variables |
|----------|--------|---------|---------------|
| `/api/bundles-data` | GET | Fetch all bundles, services & reviews | - |
| `/api/shop?action=catalog` | GET | Fallback catalog | - |
| `/api/reviews` | GET | Customer reviews | `limit`, `onlyVerified` |
| `/api/shop` | POST | Create checkout session | `__action`, `line_items`, `promotion_code` |
| `/api/shop?action=orderpack` | GET | Get order details | `session_id` |
| `/api/promo_validate` | GET | Validate promo | `code` |
| `/api/shop` | POST | Check promo on cart | `__action: 'promo_check_cart'`, `line_items` |
| `/api/schedule-appointment` | POST | Book appointment | Customer info, date/time |
| `/api/track` | POST | Track events | `event`, `visitor_id`, `session_id` |

## 📍 JavaScript Constants (bundles-app.js)

```javascript
// Lines 34-50 in bundles-app.js

// === Primary Endpoints ===
BUNDLES_DATA_API = 'https://h2s-backend.vercel.app/api/bundles-data'
API = 'https://h2s-backend.vercel.app/api/shop'
APIV1 = 'https://h2s-backend.vercel.app/api/schedule-appointment'
DASH_URL = 'https://h2s-backend.vercel.app/api/track'

// === External Services ===
PIXEL_ID = '2384221445259822'

// === Environment ===
IS_LOCAL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
```

## 🔍 Key Functions

### Tracking
```javascript
h2sTrack(eventName, data)  // Global tracking function
// Example: h2sTrack('AddToCart', { item_id: 'bundle_123', value: 299 })
```

### Cart Operations
```javascript
addToCart(item)          // Add item to cart
removeFromCart(index)    // Remove by index
updateCartBadge()        // Update cart count display
paintCart()              // Re-render cart drawer
```

### Checkout
```javascript
showCheckout()           // Open checkout modal
createCheckoutSession()  // POST to /api/shop (Stripe)
```

### Data Loading
```javascript
fetchCatalogFromAPI(cacheBust = false)  // Load catalog
loadAIRecommendations()                  // Load personalized recs
```

## 💾 LocalStorage Keys

```javascript
'h2s_cart'           // Cart contents (JSON array)
'h2s_user'           // User session data
'h2s_session_id'     // Tracking session ID
'h2s_visitor_id'     // Unique visitor ID
```

## 📦 Data Structure Examples

### Adding to Cart
```javascript
{
  id: 'bundle_123',
  name: 'Security Essentials',
  price: 59900,  // cents (599.00)
  quantity: 1,
  type: 'bundle'
}
```

### Checkout Payload
```javascript
{
  __action: 'create_checkout_session',
  line_items: [
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Security Essentials',
          description: 'Front door camera + installation'
        },
        unit_amount: 59900
      },
      quantity: 1
    }
  ],
  promotion_code: 'PROMO20',  // optional
  success_url: window.location.origin + '/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
  cancel_url: window.location.origin + '/bundles'
}
```

### Review Object
```javascript
{
  rating: 5,
  display_name: 'Sarah M.',
  review_text: 'Amazing service! Professional and quick.',
  verified: true,
  timestamp_iso: '2025-12-15T10:30:00Z',
  services_selected: 'TV Mounting, Camera Installation'
}
```

## 🎯 Testing Commands

### Test Endpoints
```bash
# Test bundles data
curl https://h2s-backend.vercel.app/api/bundles-data

# Test reviews
curl "https://h2s-backend.vercel.app/api/reviews?limit=5&onlyVerified=true"

# Test promo validation
curl "https://h2s-backend.vercel.app/api/promo_validate?code=SAVE20"

# Test catalog fallback
curl "https://h2s-backend.vercel.app/api/shop?action=catalog"
```

### Browser Console Commands
```javascript
// View current cart
console.log(JSON.parse(localStorage.getItem('h2s_cart')))

// View session ID
console.log(localStorage.getItem('h2s_session_id'))

// Test tracking
h2sTrack('TestEvent', { source: 'console', test: true })

// Enable debug mode
// Add ?debug=tracking to URL and reload
```

## 🚦 URL Parameters

```
?view=shop           # Main shop view (default)
?view=signin         # Sign in page
?view=signup         # Sign up page
?view=account        # Account dashboard
?view=shopsuccess    # Success page after checkout
?session_id=xxx      # Stripe session ID (on success page)
?debug=tracking      # Enable tracking debug panel
```

## 🔐 Environment Variables (Backend)

Required in Vercel deployment:

```bash
SUPABASE_URL              # Supabase project URL
SUPABASE_ANON_KEY         # Public anonymous key
SUPABASE_SERVICE_KEY      # Service role key (for admin)
STRIPE_SECRET_KEY         # Stripe secret key
STRIPE_WEBHOOK_SECRET     # Stripe webhook signing secret
STRIPE_PUBLISHABLE_KEY    # Stripe publishable key (frontend)
```

## 📊 Database Tables

### h2s_bundles
- `bundle_id` (text, primary key)
- `name` (text)
- `bundle_price` (integer, cents)
- `blurb` (text)
- `active` (boolean)
- `sort` (integer)

### h2s_services
- `service_id` (text, primary key)
- `name` (text)
- `price` (integer, cents)
- `active` (boolean)
- `sort` (integer)

### h2s_reviews
- `id` (uuid, primary key)
- `rating` (integer, 1-5)
- `display_name` (text)
- `review_text` (text)
- `is_visible` (boolean)
- `verified` (boolean)
- `created_at` (timestamp)

## 🐛 Common Issues & Solutions

### Issue: Bundles not loading
**Check:** Network tab for `/api/bundles-data` response
**Solution:** Verify SUPABASE_URL and keys are set

### Issue: Checkout not working
**Check:** Console for Stripe errors
**Solution:** Verify STRIPE_SECRET_KEY in backend env

### Issue: Tracking not firing
**Check:** Add `?debug=tracking` to URL
**Solution:** Verify DASH_URL is correct, check CORS

### Issue: Promo code invalid
**Check:** `/api/promo_validate?code=XXX` response
**Solution:** Verify promo exists in database

## 📝 File Locations

```
Frontend:
  /tmp/h2s-backend-analysis/bundles.html
  /tmp/h2s-backend-analysis/bundles-app.js

Backend API Routes:
  /tmp/h2s-backend-analysis/backend/app/api/bundles-data-route.ts
  /tmp/h2s-backend-analysis/backend/app/api/reviews-route.ts
  /tmp/h2s-backend-analysis/backend/app/api/promo-validate-route.ts
  /tmp/h2s-backend-analysis/backend/app/api/shop/route.ts

Documentation:
  /tmp/h2s-backend-analysis/BUNDLES_ARCHITECTURE.md (Full architecture)
  /tmp/h2s-backend-analysis/OVERVIEW.md (High-level overview)
  /tmp/h2s-backend-analysis/QUICK_REFERENCE.md (This file)
```

---

**Quick Start:** Open bundles.html in browser, check Network tab for API calls, use Console for debugging.

**Last Updated:** January 2, 2026
