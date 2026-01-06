# Home2Smart Backend - Architecture Overview

## 📁 Repository Structure
- **Frontend**: `frontend/` directory contains bundles.html and bundles.js
- **Backend**: Vercel-hosted Next.js API routes
- **Deployment**: Hosted on Vercel (h2s-backend.vercel.app)

## 🔄 Key Components

### 1. Frontend Files
- **bundles.html**: Main frontend page (82.7 KB)
- **bundles.js**: Extracted JavaScript logic (183.9 KB)

### 2. Backend API Routes (Vercel)
- **Primary Domain**: `https://h2s-backend.vercel.app`
- **Main Endpoints**:
  - `/api/shop` - Checkout, cart, orders
  - `/api/bundles-data` - Aggregated bundles, services, reviews
  - `/api/track` - Analytics tracking
  - `/api/schedule-appointment` - Booking system
  - `/api/reviews` - Customer reviews
  - `/api/quote` - Custom quote requests
  - `/api/promo_validate` - Promo code validation

## 🎯 Critical Concepts

### Variables & Data Flow

#### 1. **Cart Structure**
```javascript
cart = [
  {
    type: 'package',      // or 'bundle', 'service'
    id: 'tv_single',      // bundle_id or service_id
    name: '1 TV',
    price: 249,           // Stored price (includes any upcharges)
    qty: 1,
    metadata: {           // CRITICAL for configured items
      tv_size: '55-64',
      mount_type: 'tilt',
      mount_provider: 'h2s',
      mount_upcharge: 25,
      items_json: [...], // Detailed breakdown for multi-item configs
      requires_team: false,
      team_recommended: false
    }
  }
]
```

#### 2. **Catalog Structure**
```javascript
catalog = {
  services: [],          // Individual services
  serviceOptions: [],    // Service configuration options  
  priceTiers: [],       // Pricing tiers for services
  bundles: [],          // Package bundles with pricing
  bundleItems: [],      // Bundle composition (not used in h2s)
  recommendations: [],   // AI/rule-based recommendations
  memberships: [],       // Membership tiers
  membershipPrices: []   // Membership pricing
}
```

#### 3. **User Object**
```javascript
user = {
  name: '',
  email: '',
  phone: '',
  referral_code: '',
  credits: 0,
  total_spent: 0
}
```

### Important Variable Interactions

#### Cart → Checkout Flow
```
1. User adds items to cart (selectPackage, addPackageDirectToCart)
2. Cart stored in localStorage ('h2s_cart')
3. Checkout button triggers checkout() function
4. showCheckoutModal() collects customer details
5. handleCheckoutSubmit() sends to /api/shop with __action: 'create_checkout_session'
6. Backend creates Stripe session + database order
7. User redirected to Stripe checkout
8. On success: Stripe redirects to ?view=shopsuccess&session_id={...}
9. renderShopSuccess() loads order details and shows calendar
```

#### Promo Code Flow
```
1. User enters code in cart drawer
2. applyPromo button triggers validation:
   - GET /api/promo_validate?code={code}
3. If valid, check applicability:
   - POST /api/shop with __action: 'promo_check_cart'
   - Sends line_items array with Stripe price IDs
4. Backend calculates discount using Stripe API
5. Frontend updates cart UI with discount preview
6. During checkout, promo code sent in discounts array
7. Stripe applies discount, webhook updates order
```

#### TV Configuration Variables
```javascript
// When user configures TV mounting
metadata = {
  tv_count: 2,                    // Number of TVs
  mount_provider: 'h2s',          // 'h2s' or 'customer'
  items_json: [                   // Detailed per-TV config
    {
      bundle_id: 'tv_multi',
      service_name: '2 TVs',
      qty: 1,
      unit_price: 349.5,          // Base price / tv_count
      line_total: 374.5,          // With mount upcharge
      metadata: {
        tv_size: '55-64',
        mount_type: 'tilt',
        mount_provider: 'h2s',
        mount_upcharge: 25,
        mounts_needed: 1,
        requires_team: false,
        tv_number: 1,
        total_tvs: 2
      }
    },
    // ... TV #2
  ],
  total_mount_upcharges: 50,      // Sum of all mount upcharges
  original_price: 699,            // Tier-adjusted base
  final_price: 749                // Total with upcharges
}
```

### Database Tables (Supabase)

#### h2s_bundles
- `bundle_id` (PK)
- `name`, `blurb`, `bundle_price`
- `stripe_price_id`
- `active`, `sort`
- `image_url`

#### h2s_services
- `service_id` (PK)
- `name`, `description`
- `active`, `sort`

#### h2s_orders
- `order_id` (PK)
- `session_id` (Stripe)
- `customer_email`, `customer_name`, `customer_phone`
- `items` (JSONB)
- `subtotal`, `total`, `currency`
- `status` ('pending', 'paid', 'completed', 'canceled')
- `delivery_date`, `delivery_time`
- `address`, `city`, `state`, `zip`

#### h2s_reviews
- `rating`, `review_text`
- `display_name`, `verified`
- `services_selected`
- `timestamp_iso`, `is_visible`

## 🔧 Critical Environment Variables

### Backend (Vercel)
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# OpenAI (for AI recommendations)
OPENAI_API_KEY=sk-...

# GHL Calendar (for scheduling)
GHL_API_KEY=your-ghl-key
```

### Frontend (bundles.js)
```javascript
const BUNDLES_DATA_API = 'https://h2s-backend.vercel.app/api/bundles-data';
const API = 'https://h2s-backend.vercel.app/api/shop';
const APIV1 = 'https://h2s-backend.vercel.app/api/schedule-appointment';
const DASH_URL = 'https://h2s-backend.vercel.app/api/track';
const PIXEL_ID = '2384221445259822'; // Facebook Pixel
```

## 🚨 Critical Issues to Understand

### 1. Price Storage
**CRITICAL**: Always use `item.price` from cart, NEVER lookup catalog prices!
- Cart items store their configured price including any upcharges
- Catalog lookups will show wrong totals for TV mounts with upgrades
- Example: TV with full motion mount = base $349 + $75 = $424 (stored in cart.price)

### 2. Metadata Preservation
**CRITICAL**: TV configurations require metadata to survive checkout
- Without metadata, tech doesn't know TV sizes, mount types, etc.
- Metadata flows: Frontend → Cart → Checkout Payload → Stripe Session → Database Order

### 3. Stripe Integration Points
```
Frontend                    Backend                     Stripe
--------                    -------                     ------
selectPackage()      →      
addToCart()          →      
checkout()           →      POST /api/shop             
                            create_checkout_session → session.create()
                            Insert to h2s_orders
                            ← session.url
Redirect to Stripe   →                              → Stripe Checkout
User pays            →                              → Webhook triggered
                            stripe_webhook()        ← payment_intent.succeeded
                            Update h2s_orders
                            ← Success redirect
?view=shopsuccess    →      
renderShopSuccess()  →      GET /api/shop?action=orderpack
                            ← Order details
Show calendar        →      POST /api/schedule-appointment
                            ← Appointment created
```

## 📝 Common Operations

### Adding a New Bundle
1. Add to `h2s_bundles` table in Supabase
2. Create Stripe Price in Stripe Dashboard
3. Copy `stripe_price_id` to database
4. Set `active: true`, assign `sort` order
5. Frontend automatically picks it up via `/api/bundles-data`

### Adding a Promo Code
1. Create Coupon in Stripe Dashboard (% off or fixed amount)
2. Create Promotion Code linked to Coupon
3. Set expiration, usage limits, restrictions
4. Code works automatically - frontend validates via `/api/promo_validate`

### Testing Checkout Locally
```bash
# 1. Start Vercel dev server
cd backend
vercel dev

# 2. Update frontend endpoints temporarily
# In bundles.js, change:
const API = 'http://localhost:3000/api/shop';
# ... etc

# 3. Use Stripe test mode
# Use test card: 4242 4242 4242 4242

# 4. Test webhook locally with Stripe CLI
stripe listen --forward-to localhost:3000/api/stripe_webhook
```

## 🎨 Frontend Architecture

### Performance Optimizations
1. **Deferred Loading**: Heavy logic split into bundles-deferred.js
2. **Static Content**: HTML preloaded, JavaScript hydrates
3. **Fetch Priority**: Bundles data fetched immediately at script load
4. **Lazy Loading**: Calendar, reviews carousel load on idle/interaction

### Mobile Considerations
- Touch-friendly: All buttons min 44px tap target
- Scroll handling: Modal backdrop doesn't interfere with page scroll
- Keyboard aware: Calendar modal repositions when keyboard appears
- Input zoom prevention: Font-size min 16px on inputs

## 🔐 Security Notes

### CORS Configuration
Backend allows specific origins:
- https://home2smart.com
- https://www.home2smart.com  
- http://localhost:3000 (dev)
- http://localhost:3001 (dev)

### API Key Protection
- All sensitive keys in Vercel environment variables
- Frontend only uses public keys (Stripe publishable, Supabase anon)
- Service role keys NEVER exposed to frontend

### Data Sanitization
- All user inputs escaped with `escapeHtml()`
- SQL injection prevented by Supabase parameterized queries
- XSS prevention via Content-Security-Policy header

---

## 📚 Next Steps
1. Review endpoint details in `api-endpoints.md`
2. Understand cart flow in `cart-system.md`
3. Study TV configuration logic in `tv-mounting-logic.md`
