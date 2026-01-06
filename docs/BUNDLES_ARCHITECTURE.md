# Home2Smart Bundles Page - Complete Architecture Analysis

## 📋 Overview

The bundles page is a comprehensive e-commerce frontend for Home2Smart's smart home installation packages. It connects to a Vercel-hosted backend with multiple API endpoints for data, checkout, tracking, and scheduling.

## 🗂️ File Structure

```
/tmp/h2s-backend-analysis/
├── bundles.html              # Main HTML file (714KB)
├── bundles-app.js            # JavaScript application (191KB)
├── backend/
│   └── app/
│       └── api/
│           ├── bundles-data-route.ts    # Bundles & services data
│           ├── reviews-route.ts         # Customer reviews
│           ├── promo-validate-route.ts  # Promo code validation
│           └── shop/
│               └── route.ts             # Shop operations (cart, checkout)
```

## 🌐 API Endpoints Architecture

### Primary Backend: `https://h2s-backend.vercel.app`

#### Core Data Endpoints
1. **`GET /api/bundles-data`** ⭐ Main data aggregator
   - Returns: bundles, services, reviews in one call
   - Used by: Initial page load (high priority fetch)
   - Status: Active and optimized

2. **`GET /api/shop?action=catalog`** 
   - Fallback catalog endpoint
   - Returns: services, bundles, recommendations, memberships
   - Used when: bundles-data fails or incomplete

3. **`GET /api/reviews`**
   - Query params: `?limit=5&onlyVerified=true`
   - Returns: Customer testimonials with ratings
   - Fields: rating, display_name, review_text, verified, timestamp

#### Checkout & Commerce
4. **`POST /api/shop`** (action: create_checkout_session)
   - Creates Stripe checkout session
   - Payload: line_items, promotion_code, metadata
   - Returns: Stripe session URL

5. **`GET /api/shop?action=orderpack&session_id=xxx`**
   - Retrieves order details after checkout
   - Used on: Success page after Stripe redirect

6. **`GET /api/promo_validate?code=PROMO`**
   - Validates promo code
   - Returns: discount details, eligibility

7. **`POST /api/shop`** (action: promo_check_cart)
   - Validates promo against cart contents
   - Payload: promotion_code, line_items
   - Returns: Applied discount, final total

#### Scheduling & Appointments
8. **`POST /api/schedule-appointment`**
   - Books installation appointments
   - Payload: customer info, selected services, date/time

9. **`GET /api/get-availability`**
   - Returns available appointment slots
   - Powers native calendar scheduling UI

#### Analytics & Tracking
10. **`POST /api/track`**
    - Tracks user events and page views
    - Integrated with Meta Pixel
    - Payload: event name, visitor_id, session_id, metadata

## 🔧 Variables & Configuration

### API Configuration (bundles-app.js lines 34-50)

```javascript
// Core Endpoints
const BUNDLES_DATA_API = 'https://h2s-backend.vercel.app/api/bundles-data';
const API = 'https://h2s-backend.vercel.app/api/shop';
const APIV1 = 'https://h2s-backend.vercel.app/api/schedule-appointment';
const DASH_URL = 'https://h2s-backend.vercel.app/api/track';

// External Integrations
const PIXEL_ID = '2384221445259822'; // Meta Pixel for tracking

// Environment Detection
const IS_LOCAL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
```

### Global Variables Exposed
```javascript
window.H2S_TRACKING_ENDPOINT = DASH_URL;
window.H2S_META_ENDPOINT = DASH_URL;
window.h2sTrack = function(event, data) { /* tracking function */ };
```

## 📦 Data Models

### Bundle Object Structure
```typescript
interface Bundle {
  bundle_id: string;
  name: string;
  bundle_price: number;  // in cents
  blurb: string;
  active: boolean;
  sort: number;
  // Additional fields for display
  includes?: string[];
  services?: string[];
}
```

### Service Object Structure
```typescript
interface Service {
  service_id: string;
  name: string;
  active: boolean;
  price?: number;
  description?: string;
}
```

### Review Object Structure
```typescript
interface Review {
  rating: number;          // 1-5
  display_name: string;
  review_text: string;
  verified: boolean;
  timestamp_iso: string;
  services_selected?: string;
  // Aliases for compatibility
  text: string;
  name: string;
  stars: number;
}
```

### Cart Line Item Structure (Stripe-compatible)
```typescript
interface LineItem {
  price_data: {
    currency: 'usd';
    product_data: {
      name: string;
      description?: string;
    };
    unit_amount: number;  // cents
  };
  quantity: number;
}
```

## 🔄 Data Flow

### Page Load Sequence
1. **HTML loads** - Critical CSS and fonts loaded
2. **bundles-app.js executes** - Starts high-priority fetch
3. **Fetch `/api/bundles-data`** - Aggregated data request
4. **Render static content** - Hero, packages (from HTML)
5. **Process API response** - Update with live data
6. **Load reviews** - Carousel population
7. **Initialize tracking** - Meta Pixel, backend events

### Checkout Flow
1. User adds items to cart → localStorage
2. User clicks "Checkout"
3. Validate promo code (if any) → `/api/promo_validate`
4. Create Stripe session → `POST /api/shop` (create_checkout_session)
5. Redirect to Stripe hosted checkout
6. Stripe redirects back with `?session_id=xxx`
7. Fetch order details → `/api/shop?action=orderpack`
8. Display success page with order info

### Tracking Events
- `ViewContent` - Page load (after 3s)
- `AddToCart` - Item added to cart
- `InitiateCheckout` - Checkout button clicked
- `Purchase` - Order completed (from success page)
- Custom events via `h2sTrack(eventName, data)`

## 🎨 Frontend Features

### Key UI Components
- **Hero Section** - Reviews carousel, CTA buttons
- **Package Grid** - Bundle cards with pricing
- **Cart Drawer** - Slide-out cart with totals
- **Checkout Modal** - Inline checkout form
- **Success Page** - Order confirmation with details
- **Account System** - Sign in/up, order history

### State Management
- LocalStorage for cart, user session
- In-memory catalog cache
- Session IDs for tracking continuity

## 🔐 Security & Performance

### Security Features
- Content Security Policy headers
- CORS headers on all API endpoints
- Promo code server-side validation
- Stripe-hosted checkout (PCI compliant)

### Performance Optimizations
- Aggregated data endpoint (reduces waterfalls)
- Deferred JavaScript loading
- Font preloading with fallbacks
- Lazy loading for images
- Critical CSS inline

## 🚀 Deployment Details

### Current Deployment
- **Backend**: Vercel (`h2s-backend.vercel.app`)
- **Database**: Supabase (h2s_bundles, h2s_services, h2s_reviews tables)
- **Payments**: Stripe
- **Analytics**: Meta Pixel + custom backend
- **Scheduling**: Native calendar + backend APIs

### Environment Variables (Backend)
```
SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<public-anon-key>
STRIPE_SECRET_KEY=<stripe-secret>
STRIPE_WEBHOOK_SECRET=<webhook-secret>
```

## 📊 Key Metrics & Monitoring

### Lighthouse Targets
- Performance: 85+
- Accessibility: 90+
- Best Practices: 90+
- SEO: 100

### Critical User Paths
1. ✅ Homepage loads without errors
2. ✅ Package cards display correctly
3. ✅ Add to cart works
4. ✅ Checkout flow completes
5. ✅ Success page shows order details
6. ✅ Tracking fires correctly

## 🛠️ Development Workflow

### Testing Locally
```bash
# Start local dev server (bundles.html + bundles-app.js)
# Use VS Code Live Preview or similar

# Test API endpoints
curl https://h2s-backend.vercel.app/api/bundles-data
curl https://h2s-backend.vercel.app/api/reviews?limit=5
```

### Debugging
- Add `?debug=tracking` to URL for tracking debug panel
- Browser console shows detailed logs in development
- Network tab shows all API calls

## 📝 Important Notes

### Critical Dependencies
- All API calls route to `h2s-backend.vercel.app`
- Stripe integration requires correct publishable key
- Meta Pixel ID: 2384221445259822
- Scheduling UI is native; no third-party booking widget required

### Known Patterns
- Date parsing uses local timezone (noon) for date-only strings
- Promo codes validated both client and server-side
- Cart persists in localStorage across sessions
- Reviews load from both aggregated and dedicated endpoints

## 🔗 Related Documentation
- BUNDLES_LIGHTHOUSE_ANALYSIS.md
- PERFORMANCE_OPTIMIZATION_DEPLOY.md
- PHOTO_FLOW_COMPLETE.md
- CONGRUENCE_CHECKLIST.md

---

**Last Updated**: January 2, 2026
**Status**: ✅ Active and production-ready
**Maintainer**: Home2Smart Development Team
