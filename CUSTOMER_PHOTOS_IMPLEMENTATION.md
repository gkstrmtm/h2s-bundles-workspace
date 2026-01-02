# Customer Job Photos Feature - Implementation Guide

## Overview
This feature allows customers to upload planning photos for their jobs/orders, which technicians can view before arriving. Optional AI analysis validates photo quality and relevance.

---

## Phase 1: Database & Backend (✅ COMPLETE)

### Database Schema
**Location:** `backend/migrations/001_add_job_customer_uploads.sql`

**Table:** `job_customer_uploads`
- `upload_id` (UUID, PK)
- `job_id` (UUID, FK → h2s_dispatch_jobs)
- `customer_id` (UUID, FK → h2s_customers)
- `source` (customer/tech/admin)
- `kind` (planning/completion/other)
- `file_url` (TEXT)
- `file_mime`, `file_size`, `storage_path`
- `analysis_status` (NOT_RUN/PASS/NEEDS_REVIEW/FAIL)
- `analysis_notes` (JSONB)
- `visibility` (tech_only/customer+tech/admin_only)
- `created_at`, `updated_at`, `deleted_at`
- `uploader_ip` (audit trail)

**Indexes:**
- job_id (WHERE deleted_at IS NULL)
- customer_id (WHERE deleted_at IS NULL)
- created_at DESC
- analysis_status (WHERE deleted_at IS NULL)

**Feature Flags Table:**
```sql
CREATE TABLE feature_flags (
  flag_name VARCHAR(100) PRIMARY KEY,
  enabled BOOLEAN DEFAULT FALSE,
  config JSONB
);
```

### API Endpoints
**Location:** `backend/app/api/customer_photos/route.ts`

#### POST /api/customer_photos
Upload customer planning photo.

**Request:**
```json
{
  "customer_email": "jane@example.com",
  "job_id": "uuid",
  "data": "data:image/jpeg;base64,...",
  "filename": "photo.jpg",
  "mimetype": "image/jpeg"
}
```

**Response (201):**
```json
{
  "ok": true,
  "upload": {
    "upload_id": "uuid",
    "job_id": "uuid",
    "file_url": "https://...",
    "file_mime": "image/jpeg",
    "file_size": 1234567,
    "created_at": "2025-12-29T...",
    "analysis_status": "NOT_RUN"
  }
}
```

**Validations:**
- Feature flag `ENABLE_CUSTOMER_PHOTOS` must be true
- Customer must own the job (email match)
- Max 12 photos per job (configurable)
- Max 10MB per file (configurable)
- Allowed types: JPEG, PNG, WEBP, HEIC, PDF

**Error Codes:**
- `feature_disabled` (403) - Feature not enabled
- `job_not_found` (404) - Invalid job_id
- `forbidden` (403) - Customer doesn't own job
- `max_photos_exceeded` (400) - Too many photos
- `file_too_large` (400) - File exceeds size limit

#### GET /api/customer_photos?customer_email=...&job_id=...
List photos for a job.

**Query Parameters:**
- `customer_email` (customer access) OR
- `token` (tech/admin access)
- `job_id` (required)

**Response (200):**
```json
{
  "ok": true,
  "uploads": [
    {
      "upload_id": "uuid",
      "file_url": "https://...",
      "file_mime": "image/jpeg",
      "file_size": 1234567,
      "created_at": "2025-12-29T...",
      "analysis_status": "PASS",
      "analysis_notes": {"reason": "OK"}
    }
  ]
}
```

**Authorization:**
- Customer: Must match job's customer_email
- Tech: Must be assigned to job OR admin role
- Returns 403 if unauthorized

#### DELETE /api/customer_photos
Delete (soft delete) customer photo.

**Request:**
```json
{
  "customer_email": "jane@example.com",
  "upload_id": "uuid"
}
```

**Response (200):**
```json
{
  "ok": true,
  "message": "Upload deleted successfully"
}
```

**Restrictions:**
- Customer must own the job
- Job status must be `pending_assign` or `offer_sent`
- Cannot delete after job has started

---

## Phase 2: Customer UI (🔄 IN PROGRESS)

### Bundles/Orders Page
**Location:** `Home2Smart-Dashboard/bundles.html`

**Requirements:**
1. Add "Customer Photos" section to each upcoming order card
2. Show upload button when feature enabled
3. Display thumbnails grid (4 columns)
4. Show upload progress
5. Allow delete before job starts
6. Show "X/12 photos" counter

**UI Components:**
```html
<div class="customer-photos-section" style="display:none" data-job-id="...">
  <h4>Add Photos (Optional)</h4>
  <p>Upload photos to help your technician plan your install.</p>
  
  <input type="file" id="photoInput-..." accept="image/*" multiple style="display:none">
  <button onclick="openPhotoUpload('...')">Choose Photos</button>
  
  <div class="photo-thumbnails-grid" id="thumbnails-...">
    <!-- Populated dynamically -->
  </div>
  
  <div class="photo-counter">
    <span id="photoCount-...">0</span>/12 photos
  </div>
</div>
```

**JavaScript Functions:**
```javascript
async function uploadCustomerPhoto(jobId, file) {
  // Convert to base64
  // POST to /api/customer_photos
  // Update thumbnails
  // Handle errors
}

async function loadCustomerPhotos(jobId) {
  // GET /api/customer_photos?customer_email=...&job_id=...
  // Render thumbnails
}

async function deleteCustomerPhoto(uploadId) {
  // Confirm
  // DELETE /api/customer_photos
  // Remove thumbnail
}
```

---

## Phase 3: Tech Portal UI (⏳ NOT STARTED)

### Portal Job Detail Modal
**Location:** `Home2Smart-Dashboard/portal.html`

**Requirements:**
1. Add "Customer Photos" panel to job detail modal
2. Show photo count badge on job cards
3. Grid layout with lightbox capability
4. Show AI analysis status (if enabled)

**Job Card Badge:**
```html
<div class="job-card-badge" style="background:#10b981">
  📷 3 photos
</div>
```

**Job Detail Panel:**
```html
<div class="customer-photos-panel" id="customerPhotos">
  <h3>Customer Planning Photos</h3>
  
  <div class="photo-grid">
    <div class="photo-item" onclick="viewPhoto('...')">
      <img src="..." loading="lazy" alt="Customer photo">
      <div class="photo-meta">
        <span class="upload-date">Dec 29</span>
        <span class="ai-badge pass">✓ Clear</span>
      </div>
    </div>
  </div>
  
  <div class="empty-state" style="display:none">
    No customer photos for this job.
  </div>
</div>
```

**JavaScript Integration:**
```javascript
async function loadCustomerPhotosForTech(jobId, token) {
  const res = await fetch(`/api/customer_photos?token=${token}&job_id=${jobId}`);
  const data = await res.json();
  
  if (data.ok && data.uploads.length > 0) {
    renderCustomerPhotosPanel(data.uploads);
  }
}
```

---

## Phase 4: AI Analysis (⏳ NOT STARTED - OPTIONAL)

### Trigger
When photo uploaded → enqueue analysis job (if `ENABLE_AI_ANALYSIS=true`)

### Analysis Logic
**Service:** External (OpenAI GPT-4 Vision, AWS Rekognition, or custom)

**Input:** `file_url`

**Output:**
```json
{
  "status": "PASS" | "NEEDS_REVIEW" | "FAIL",
  "reason": "TOO_DARK" | "TOO_BLURRY" | "NOT_RELEVANT" | "DUPLICATE" | "OK",
  "confidence": 0.95,
  "details": "Image shows router location clearly"
}
```

**Implementation:**
```typescript
// backend/lib/analyzeCustomerPhoto.ts
export async function analyzeCustomerPhoto(uploadId: string) {
  // Fetch upload record
  // Download image
  // Call AI service
  // Update analysis_status and analysis_notes
  // Don't block anything - this is informational only
}
```

**Database Update:**
```sql
UPDATE job_customer_uploads
SET 
  analysis_status = 'PASS',
  analysis_notes = '{"reason": "OK", "confidence": 0.95}'::JSONB
WHERE upload_id = '...';
```

---

## Environment Variables

Add to `backend/.env.local` and Vercel environment:

```bash
# Feature Flags
ENABLE_CUSTOMER_PHOTOS=false
ENABLE_AI_ANALYSIS=false

# Limits
MAX_PHOTOS_PER_JOB=12
MAX_PHOTO_SIZE_MB=10

# AI Config (Phase 4)
OPENAI_API_KEY=sk-...
AI_ANALYSIS_MODEL=gpt-4-vision-preview
```

---

## Deployment Checklist

### Database Migration
1. Run SQL migration: `backend/migrations/001_add_job_customer_uploads.sql`
2. Verify table exists in Supabase
3. Check indexes created
4. Verify foreign key constraints

### Backend Deployment
1. Add environment variables to Vercel
2. Deploy backend to production
3. Test endpoints with Postman/curl:
   - POST /api/customer_photos (upload)
   - GET /api/customer_photos (list)
   - DELETE /api/customer_photos (delete)

### Frontend Deployment
1. Update bundles.html with upload UI
2. Update portal.html with viewing UI
3. Deploy to production
4. Test end-to-end flow:
   - Customer uploads photo
   - Tech views photo in portal

### Enable Feature
```bash
# Vercel Dashboard → Settings → Environment Variables
ENABLE_CUSTOMER_PHOTOS=true

# Then redeploy
```

---

## Testing Scenarios

### Customer Upload Flow
1. ✅ Customer with order can upload photo
2. ✅ Photo under 10MB uploads successfully
3. ✅ Photo over 10MB rejected
4. ✅ Invalid file type rejected
5. ✅ Max 12 photos enforced
6. ✅ Customer can delete own photo before job starts
7. ❌ Customer cannot delete after job accepted
8. ❌ Customer cannot upload for someone else's job

### Tech Viewing Flow
1. ✅ Tech assigned to job sees customer photos
2. ✅ Tech can download/view full resolution
3. ❌ Tech cannot delete customer photos
4. ❌ Tech not assigned to job cannot view photos
5. ✅ Admin can view all job photos

### AI Analysis (Phase 4)
1. ✅ Analysis runs automatically on upload
2. ✅ Status shows in tech portal
3. ✅ NEEDS_REVIEW flagged for human review
4. ✅ FAIL shows warning but doesn't block workflow
5. ✅ Analysis failure doesn't break upload

---

## Rollback Plan

If issues arise:

1. **Disable Feature:**
   ```bash
   ENABLE_CUSTOMER_PHOTOS=false
   ```
   Redeploy backend. Existing uploads remain but new uploads blocked.

2. **Database Rollback:**
   ```sql
   DROP TRIGGER IF EXISTS trigger_update_job_customer_uploads_updated_at ON job_customer_uploads;
   DROP FUNCTION IF EXISTS update_job_customer_uploads_updated_at();
   DROP TABLE IF EXISTS job_customer_uploads CASCADE;
   DELETE FROM feature_flags WHERE flag_name IN ('ENABLE_CUSTOMER_PHOTOS', 'ENABLE_AI_ANALYSIS');
   ```

3. **Revert Frontend:**
   - Remove customer upload UI from bundles.html
   - Remove tech viewing UI from portal.html

---

## Future Enhancements

### Phase 5: Completion Photo Gating (Not Implemented)
- Require tech to upload completion photos before marking job done
- Require customer signature
- AI validation of completion photos
- Human review queue for flagged photos

### Phase 6: Advanced Features
- Photo annotations (tech can mark up customer photos)
- Before/after comparison view
- Customer notification when tech views photos
- Photo sharing link for customer
- Integration with estimate/pricing (photo-based quotes)

---

## Support & Troubleshooting

### Common Issues

**Upload fails silently:**
- Check browser console for CORS errors
- Verify `ENABLE_CUSTOMER_PHOTOS=true` in environment
- Check Supabase storage bucket permissions

**Tech cannot see photos:**
- Verify job assignment (assigned_pro_id matches token payload.id)
- Check visibility field (should be 'tech_only' or 'customer+tech')
- Verify deleted_at IS NULL

**File size validation incorrect:**
- Base64 encoding adds ~33% overhead
- Adjust MAX_PHOTO_SIZE_MB accounting for encoding

### Monitoring Queries

```sql
-- Count uploads per job
SELECT job_id, COUNT(*) as photo_count
FROM job_customer_uploads
WHERE deleted_at IS NULL
GROUP BY job_id
ORDER BY photo_count DESC;

-- Photos pending AI analysis
SELECT upload_id, job_id, created_at
FROM job_customer_uploads
WHERE analysis_status = 'NOT_RUN' AND deleted_at IS NULL
ORDER BY created_at DESC;

-- Storage usage
SELECT 
  COUNT(*) as total_uploads,
  SUM(file_size) / (1024*1024*1024) as total_gb
FROM job_customer_uploads
WHERE deleted_at IS NULL;
```

---

## Contact
For questions about this feature:
- Backend: See `backend/app/api/customer_photos/route.ts`
- Database: See `backend/migrations/001_add_job_customer_uploads.sql`
- Docs: This file
