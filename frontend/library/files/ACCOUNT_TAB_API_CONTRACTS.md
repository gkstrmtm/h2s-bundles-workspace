# Account Tab API Contracts

## Overview
Three bulletproof endpoints for customer self-service on the bundles Account tab:
1. **`/api/customer_orders`** - Retrieve recent orders
2. **`/api/customer_reschedule`** - Update scheduled date/time
3. **`/api/customer_photos`** - Upload planning photos

All endpoints include:
- Request ID tracking (`request_id`)
- Performance timing (`duration_ms`)
- Server timestamps (`server_timestamp`)
- Structured error responses with error codes
- CORS support for frontend

---

## 1. GET Recent Orders

### Endpoint
```
POST /api/customer_orders
```

### Purpose
Retrieve customer's recent orders with enriched data (dispatch job info, schedule status, photos count).

### Request Body
```json
{
  "customer_email": "customer@example.com"
}
```
**OR**
```json
{
  "session_id": "cs_test_abc123..."
}
```

### Success Response (200)
```json
{
  "ok": true,
  "orders": [
    {
      "order_id": "ord_abc123",
      "session_id": "cs_test_abc123...",
      "customer_name": "John Smith",
      "total": 499.99,
      "status": "completed",
      "created_at": "2026-01-09T10:30:00Z",
      "service_summary": "TV Mount Installation (55-inch) + Router Setup",
      "service_address": "123 Main St",
      "service_city": "Austin",
      "service_state": "TX",
      "service_zip": "78701",
      "schedule_status": "Scheduled",
      "scheduled_date": "2026-01-15",
      "time_window": "9am - 12pm",
      "job_id": "job_xyz789",
      "job_status": "scheduled",
      "photos_count": 3,
      "photos_uploaded": true,
      "promo_code": "SAVE20",
      "discount": 50.00,
      "equipment_provided": "Yes",
      "job_details": "TV Mount: 55-inch, wall type: drywall. Router Setup: WiFi 6."
    }
  ],
  "count": 1,
  "request_id": "orders-1736421234567-abc123",
  "duration_ms": 245,
  "server_timestamp": "2026-01-09T10:35:00.000Z"
}
```

### Error Responses

#### 400 - Missing Identifier
```json
{
  "ok": false,
  "error": "Missing customer_email or session_id",
  "error_code": "MISSING_IDENTIFIER",
  "request_id": "orders-1736421234567-abc123",
  "duration_ms": 12,
  "server_timestamp": "2026-01-09T10:35:00.000Z"
}
```

#### 503 - Database Not Configured
```json
{
  "ok": false,
  "error": "Orders database not configured",
  "error_code": "DB_NOT_CONFIGURED",
  "request_id": "orders-1736421234567-abc123",
  "duration_ms": 8,
  "server_timestamp": "2026-01-09T10:35:00.000Z"
}
```

#### 500 - Query Error
```json
{
  "ok": false,
  "error": "Failed to fetch orders: [error details]",
  "error_code": "QUERY_ERROR",
  "request_id": "orders-1736421234567-abc123",
  "duration_ms": 156,
  "server_timestamp": "2026-01-09T10:35:00.000Z"
}
```

### Validation Rules
- Must provide either `customer_email` OR `session_id`
- Email is case-insensitive
- Returns empty array if no orders found (not an error)
- Enriches with:
  - Dispatch job data (job_id, job_status)
  - Photos count from h2s_customer_uploads
  - Service summary built from items_json
  - Schedule info (status, date, time_window)
  - Promo code and discount amount

### Performance SLA
- Target: < 300ms for 10 orders
- Warning: > 500ms
- Timeout: 5s

---

## 2. Reschedule Order

### Endpoint
```
POST /api/customer_reschedule
```

### Purpose
Update scheduled date and time window for an order. Updates both h2s_orders and h2s_dispatch_jobs for portal congruency.

### Request Body
```json
{
  "session_id": "cs_test_abc123...",
  "scheduled_iso": "2026-01-20",
  "timezone": "America/Chicago",
  "time_window": "12pm - 3pm"
}
```
**OR**
```json
{
  "order_id": "ord_abc123",
  "scheduled_iso": "2026-01-20",
  "timezone": "America/Chicago",
  "time_window": "9am - 12pm"
}
```

### Success Response (200)
```json
{
  "ok": true,
  "updated_order_id": "ord_abc123",
  "updated_job_id": "job_xyz789",
  "scheduled_date": "2026-01-20",
  "timezone": "America/Chicago",
  "time_window": "12pm - 3pm",
  "was_rescheduled": true,
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 187,
  "server_timestamp": "2026-01-09T10:40:00.000Z"
}
```

### Error Responses

#### 400 - Missing Identifier
```json
{
  "ok": false,
  "error": "Missing session_id or order_id",
  "error_code": "MISSING_IDENTIFIER",
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 8
}
```

#### 400 - Missing Date
```json
{
  "ok": false,
  "error": "Missing scheduled_iso, timezone, or time_window",
  "error_code": "MISSING_DATE",
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 10
}
```

#### 400 - Invalid Date Format
```json
{
  "ok": false,
  "error": "Invalid date format. Use ISO 8601: YYYY-MM-DD",
  "error_code": "INVALID_DATE_FORMAT",
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 12
}
```

#### 400 - Date in Past
```json
{
  "ok": false,
  "error": "Scheduled date must be in the future",
  "error_code": "INVALID_DATE_PAST",
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 15
}
```

#### 400 - Invalid Time Window
```json
{
  "ok": false,
  "error": "Invalid time window. Must be: 9am - 12pm, 12pm - 3pm, or 3pm - 6pm",
  "error_code": "INVALID_TIME_WINDOW",
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 14
}
```

#### 404 - Order Not Found
```json
{
  "ok": false,
  "error": "Order not found",
  "error_code": "ORDER_NOT_FOUND",
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 89
}
```

#### 500 - Update Failed
```json
{
  "ok": false,
  "error": "Failed to update order: [error details]",
  "error_code": "UPDATE_FAILED",
  "request_id": "reschedule-1736421234567-abc123",
  "duration_ms": 201
}
```

### Validation Rules
- Must provide either `session_id` OR `order_id`
- `scheduled_iso` must be valid ISO 8601 date (YYYY-MM-DD)
- Date must be in the future (validated against server time)
- `time_window` must match exactly (case-sensitive):
  - "9am - 12pm"
  - "12pm - 3pm"
  - "3pm - 6pm"
- Updates both tables atomically:
  - `h2s_orders.metadata_json`: scheduled_date, timezone, time_window, schedule_status: 'Scheduled'
  - `h2s_dispatch_jobs`: status: 'scheduled', due_at (ISO timestamp)
- Tracks rescheduling history:
  - Sets `rescheduled: true` if date changes
  - Saves `previous_scheduled_date`
  - Records `rescheduled_at` timestamp

### Performance SLA
- Target: < 200ms
- Warning: > 400ms
- Timeout: 5s

---

## 3. Upload Customer Photos

### Endpoint
```
POST /api/customer_photos
```

### Purpose
Upload planning photos (before installation) to help technician prepare. Photos are linked to job/order and visible in dispatch portal.

### Request Body
```json
{
  "customer_email": "customer@example.com",
  "job_id": "job_xyz789",
  "data": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "filename": "tv_wall.jpg",
  "mimetype": "image/jpeg"
}
```
**OR (lookup job by order_id)**
```json
{
  "customer_email": "customer@example.com",
  "order_id": "ord_abc123",
  "data": "data:image/png;base64,iVBORw0KGgo...",
  "filename": "router_location.png",
  "mimetype": "image/png"
}
```

### Success Response (201)
```json
{
  "ok": true,
  "upload": {
    "upload_id": "upl_def456",
    "job_id": "job_xyz789",
    "file_url": "https://storage.supabase.co/h2s-job-artifacts/customer-uploads/job_xyz789/1736421234567-tv_wall.jpg",
    "file_mime": "image/jpeg",
    "file_size": 2458624,
    "created_at": "2026-01-09T10:45:00.000Z",
    "analysis_status": "NOT_RUN"
  }
}
```

### Error Responses

#### 400 - Missing Required Fields
```json
{
  "ok": false,
  "error": "Missing required fields: customer_email, (job_id or order_id), data"
}
```

#### 400 - Feature Disabled
```json
{
  "ok": false,
  "error": "Customer photo uploads not enabled",
  "error_code": "feature_disabled"
}
```

#### 400 - Invalid MIME Type
```json
{
  "ok": false,
  "error": "Invalid file type. Allowed: image/jpeg, image/jpg, image/png, image/webp, image/heic, application/pdf"
}
```

#### 400 - Max Photos Exceeded
```json
{
  "ok": false,
  "error": "Maximum 12 photos per job",
  "error_code": "max_photos_exceeded"
}
```

#### 400 - File Too Large
```json
{
  "ok": false,
  "error": "File too large. Maximum 10MB",
  "error_code": "file_too_large"
}
```

#### 403 - Unauthorized
```json
{
  "ok": false,
  "error": "Unauthorized: This job belongs to a different customer",
  "error_code": "forbidden"
}
```

#### 404 - Job Not Found
```json
{
  "ok": false,
  "error": "Job not found",
  "error_code": "job_not_found"
}
```

#### 500 - Upload Failed
```json
{
  "ok": false,
  "error": "Upload failed: [storage error details]"
}
```

#### 500 - Database Insert Failed
```json
{
  "ok": false,
  "error": "Failed to save upload record"
}
```

### Validation Rules
- Feature flag: `ENABLE_CUSTOMER_PHOTOS=true` required
- Must provide `customer_email` and (`job_id` OR `order_id`)
- Allowed MIME types:
  - image/jpeg
  - image/jpg
  - image/png
  - image/webp
  - image/heic
  - application/pdf
- File size limit: 10MB (configurable via `MAX_PHOTO_SIZE_MB`)
- Max photos per job: 12 (configurable via `MAX_PHOTOS_PER_JOB`)
- Verifies customer owns the job (email match)
- Uploads to Supabase Storage: `h2s-job-artifacts/customer-uploads/{job_id}/{timestamp}-{filename}`
- Creates record in `job_customer_uploads` table
- Base64 data format: `data:image/jpeg;base64,{base64data}` OR raw base64 string

### Performance SLA
- Target: < 2s for 5MB file
- Warning: > 4s
- Timeout: 10s

### Additional Endpoints

#### GET - List Photos
```
GET /api/customer_photos?customer_email=...&job_id=...
GET /api/customer_photos?customer_email=...&order_id=...
```

**Response:**
```json
{
  "ok": true,
  "uploads": [
    {
      "upload_id": "upl_def456",
      "file_url": "https://...",
      "file_mime": "image/jpeg",
      "file_size": 2458624,
      "created_at": "2026-01-09T10:45:00.000Z",
      "analysis_status": "NOT_RUN",
      "analysis_notes": null
    }
  ]
}
```

#### DELETE - Remove Photo
```
DELETE /api/customer_photos
Body: { "customer_email": "...", "upload_id": "upl_def456" }
```

**Response:**
```json
{
  "ok": true,
  "message": "Upload deleted successfully"
}
```

**Restrictions:**
- Can only delete if job status is `pending_assign` or `offer_sent`
- Once job has started, photos cannot be deleted (technician may rely on them)

---

## Environment Variables

### Required
```bash
# Database connections (already configured)
SUPABASE_ORDERS_URL=...
SUPABASE_ORDERS_ANON_KEY=...
SUPABASE_DISPATCH_URL=...
SUPABASE_DISPATCH_SERVICE_KEY=...
```

### Optional (Customer Photos)
```bash
# Feature flag for photo uploads
ENABLE_CUSTOMER_PHOTOS=true

# File limits (defaults shown)
MAX_PHOTO_SIZE_MB=10
MAX_PHOTOS_PER_JOB=12
```

---

## Portal Congruency

### Data Flow
```
Customer Action → API Endpoint → Database Update → Portal Reflects Change
```

### Tables Updated

#### customer_orders
- Reads: `h2s_orders`, `h2s_dispatch_jobs`, `job_customer_uploads`
- Enriches order data with job status and photos count
- No writes

#### customer_reschedule
- Writes: `h2s_orders.metadata_json`, `h2s_dispatch_jobs.status`, `h2s_dispatch_jobs.due_at`
- Dispatch portal immediately shows new scheduled date
- Technician sees updated time window

#### customer_photos
- Writes: `job_customer_uploads`, Supabase Storage
- Dispatch portal shows photo thumbnails and count
- Technician can view full-size photos before accepting job

### Single Source of Truth
- **Schedule**: `h2s_orders.metadata_json.scheduled_date` + `h2s_dispatch_jobs.due_at`
- **Job Details**: `h2s_dispatch_jobs.job_details` (from checkout)
- **Photos**: `job_customer_uploads` table + Supabase Storage

---

## Security

### Authentication
- Customer email verification (matches job's customer_email)
- Session ID verification (matches order's session_id)
- No passwords required (magic link + session)

### Authorization
- Customers can only access their own orders/jobs
- Photos require customer_email match
- Reschedule requires session_id or order_id match
- Technicians can view photos via portal token (separate auth)

### Data Protection
- CORS restricted to allowed origins
- Input validation on all fields
- SQL injection prevention (Supabase client handles parameterization)
- Base64 validation for file uploads
- File type whitelist (no arbitrary uploads)

---

## Testing Requirements

### Image Upload Test Matrix (6 scenarios)
1. ✅ Upload 1 image (jpg) → PASS
2. ✅ Upload 5 images (mixed jpg/png) → PASS
3. ❌ Upload invalid file type → FAIL with error code
4. ❌ Upload oversized file (>10MB) → FAIL with error code
5. ❌ Upload with missing linkage → FAIL with error code
6. ✅ Refresh page test → Images persist

### Rescheduling Test Matrix (4 scenarios)
1. ✅ Reschedule Pending order → becomes Scheduled
2. ✅ Reschedule Scheduled order → date changes
3. ❌ Invalid date input → blocked with error
4. ✅ Persistence test → date persists after refresh

### Performance Benchmarks
- customer_orders: < 300ms
- customer_reschedule: < 200ms
- customer_photos: < 2s (5MB file)

---

## Error Code Reference

### customer_orders
- `MISSING_IDENTIFIER` - No customer_email or session_id provided
- `DB_NOT_CONFIGURED` - Orders database not configured
- `QUERY_ERROR` - Database query failed

### customer_reschedule
- `MISSING_IDENTIFIER` - No session_id or order_id provided
- `MISSING_DATE` - No scheduled_iso, timezone, or time_window provided
- `INVALID_DATE_FORMAT` - Date not in ISO 8601 format (YYYY-MM-DD)
- `INVALID_DATE_PAST` - Date is not in the future
- `INVALID_TIME_WINDOW` - Time window doesn't match allowed values
- `ORDER_NOT_FOUND` - Order/session not found in database
- `UPDATE_FAILED` - Database update failed

### customer_photos
- `feature_disabled` - ENABLE_CUSTOMER_PHOTOS not set to 'true'
- `job_not_found` - Job ID doesn't exist or order has no job yet
- `forbidden` - Customer email doesn't match job's customer email
- `max_photos_exceeded` - Job already has maximum allowed photos
- `file_too_large` - File exceeds MAX_PHOTO_SIZE_MB limit
- `upload_not_found` - Upload ID doesn't exist (DELETE operation)
- `job_in_progress` - Cannot delete photos after job has started

---

## Deployment Checklist

### Pre-Deploy
- [ ] Environment variables set (ENABLE_CUSTOMER_PHOTOS=true)
- [ ] Backend tests pass (all 3 endpoints)
- [ ] Frontend integrates correctly
- [ ] CORS origins configured

### Deploy
```bash
cd backend
vercel --prod --yes
```

### Post-Deploy Validation (< 2 minutes)
1. Test customer_orders: `curl -X POST https://h2s-backend.vercel.app/api/customer_orders -H "Content-Type: application/json" -d '{"session_id":"cs_test_..."}'`
2. Test customer_reschedule: `curl -X POST https://h2s-backend.vercel.app/api/customer_reschedule -H "Content-Type: application/json" -d '{"session_id":"cs_test_...","scheduled_iso":"2026-02-01","timezone":"America/Chicago","time_window":"9am - 12pm"}'`
3. Test customer_photos: `curl -X POST https://h2s-backend.vercel.app/api/customer_photos -H "Content-Type: application/json" -d '{"customer_email":"test@example.com","job_id":"job_...","data":"...","filename":"test.jpg","mimetype":"image/jpeg"}'`

### Rollback
```bash
vercel rollback
```
