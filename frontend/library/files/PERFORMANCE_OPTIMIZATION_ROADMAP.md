# 🎯 Performance Optimization Roadmap

## Current Status
✅ Backend deployed: https://h2s-backend.vercel.app
✅ Management notifications working (SMS to 4 numbers)
✅ Analytics dashboard with intelligent insights
✅ Time-based filtering (7/14/30/60/90 days)

## Next: Loading Time Improvements

### Phase 1: Frontend Optimization

#### bundles.html
**Current Issues:**
- Large inline JavaScript (~2000+ lines)
- No lazy loading for images
- All CSS loaded upfront
- No code splitting

**Improvements:**
1. **Extract JavaScript to separate file** (caching)
   ```html
   <!-- Instead of <script> inline -->
   <script src="bundles-app.js" defer></script>
   ```

2. **Lazy load images**
   ```html
   <img src="placeholder.jpg" data-src="actual-image.jpg" loading="lazy" />
   ```

3. **Critical CSS only**
   - Inline critical above-the-fold CSS
   - Load rest asynchronously
   ```html
   <link rel="preload" href="bundles.css" as="style" onload="this.rel='stylesheet'">
   ```

4. **Service Worker for caching**
   ```javascript
   // Cache API responses and static assets
   navigator.serviceWorker.register('/sw.js');
   ```

#### funnel-track.html
**Current Issues:**
- 3200+ lines (analytics dashboard)
- Heavy API calls on load
- No progressive enhancement

**Improvements:**
1. **Skeleton screens while loading**
   ```html
   <div class="skeleton-loading">Loading analytics...</div>
   ```

2. **Debounce API calls**
   ```javascript
   const debouncedRefresh = debounce(loadData, 500);
   ```

3. **Virtual scrolling for large tables**
   - Only render visible rows
   - Improves performance with 1000+ events

4. **Web Workers for heavy computations**
   ```javascript
   // Move analytics calculations to background thread
   const worker = new Worker('analytics-worker.js');
   ```

### Phase 2: Backend Optimization

#### API Response Times
**Current:**
- `/api/v1?action=meta_pixel_events` - ~2-3 seconds
- Large payload (97KB+)

**Improvements:**
1. **Database query optimization**
   ```typescript
   // Add indexes
   CREATE INDEX idx_occurred_at ON h2s_tracking_events(occurred_at);
   CREATE INDEX idx_event_name ON h2s_tracking_events(event_name);
   ```

2. **Response caching (Redis or Vercel KV)**
   ```typescript
   const cached = await kv.get(`analytics:${dateRange}`);
   if (cached) return cached;
   ```

3. **Pagination for large datasets**
   ```typescript
   // Instead of returning 1000 events
   // Return 100 per page with cursor
   ?limit=100&cursor=abc123
   ```

4. **GraphQL for selective field loading**
   - Let frontend request only needed fields
   - Reduces payload size

### Phase 3: Infrastructure

1. **CDN for static assets**
   - Use Cloudflare/Vercel Edge for images
   - Reduce latency globally

2. **Image optimization**
   ```bash
   # Convert to WebP
   # Serve responsive images
   <picture>
     <source srcset="image.webp" type="image/webp">
     <img src="image.jpg" alt="...">
   </picture>
   ```

3. **HTTP/2 Server Push**
   - Push critical assets before requested

4. **Compression**
   - Enable gzip/brotli on Vercel
   - Already enabled by default

## 📊 Performance Metrics to Track

### Before Optimization (Baseline)
```
bundles.html:
- First Contentful Paint: ?ms
- Time to Interactive: ?ms
- Total Bundle Size: ?KB

funnel-track.html:
- Load Time: ?s
- API Response Time: 2-3s
- Render Time: ?ms
```

### Target Goals
```
bundles.html:
- FCP: < 1.8s
- TTI: < 3.5s
- Bundle Size: < 500KB

funnel-track.html:
- Load Time: < 2s
- API Response: < 1s
- Render Time: < 500ms
```

## 🛠️ Tools to Use

1. **Lighthouse** (Chrome DevTools)
   ```bash
   # Run audit
   lighthouse https://home2smart.com/bundles.html --view
   ```

2. **WebPageTest**
   - Test from multiple locations
   - See waterfall charts

3. **Bundle Analyzer**
   ```bash
   npm install --save-dev webpack-bundle-analyzer
   ```

4. **Performance Monitor** (Chrome DevTools)
   - Track FPS, CPU, Network in real-time

## 📝 Implementation Order

1. **Quick Wins** (1-2 hours)
   - Add `loading="lazy"` to images
   - Defer non-critical JavaScript
   - Enable compression

2. **Medium Effort** (2-4 hours)
   - Extract inline JS to files
   - Add service worker caching
   - Implement skeleton screens

3. **Heavy Lift** (1-2 days)
   - Database query optimization
   - Virtual scrolling
   - GraphQL/API redesign

## 🚀 Ready to Start?

Focus on **Quick Wins** first for immediate impact. Test each change with Lighthouse before/after.

**Files to edit:**
- `frontend/bundles.html` - Extract JS, lazy load images
- `frontend/funnel-track.html` - Skeleton screens, debounce
- `backend/app/api/v1/route.ts` - Query optimization, caching
