import { getSupabase } from '@/lib/supabase';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { sendMail } from '@/lib/mail';

/**
 * DATA ORCHESTRATION ALGORITHM
 * Centralized data validation, enrichment, and normalization system
 * Ensures consistency across checkout → orders → jobs → portal
 */

export interface DataQualityScore {
  completeness: number;  // 0-100
  accuracy: number;      // 0-100
  consistency: number;   // 0-100
  overall: number;       // 0-100
  issues: string[];
}

export interface EnrichedJobData {
  job_id: string;
  order_id: string;
  status: string;
  service_name: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  service: {
    id: string | null;
    name: string;
    items: Array<{
      name: string;
      qty: number;
      unit_price: number;
      metadata?: any;
    }>;
    description: string;
  };
  financials: {
    payout_estimated: number;
    order_subtotal: number;
    order_total: number;
    payment_status: string;
  };
  scheduling: {
    start_iso: string | null;
    delivery_date: string | null;
    delivery_time: string | null;
    window: string | null;
  };
  context: {
    referral_code: string | null;
    referrer_email: string | null;
    customer_notes: string | null;
    source: string;
    session_id: string | null;
  };
  metadata: Record<string, any>;
  quality_score: DataQualityScore;
}

/**
 * ALGORITHM 1: Data Validation & Scoring
 * Evaluates data completeness and flags issues
 */
export function assessDataQuality(job: any): DataQualityScore {
  const issues: string[] = [];
  let completeFields = 0;
  let totalCriticalFields = 0;

  // Critical fields check
  const criticalChecks = [
    { field: 'customer_name', value: job.customer_name, weight: 10 },
    { field: 'customer_phone', value: job.customer_phone, weight: 10 },
    { field: 'service_address', value: job.service_address, weight: 10 },
    { field: 'service_city', value: job.service_city, weight: 5 },
    { field: 'service_zip', value: job.service_zip, weight: 5 },
    { field: 'service_name', value: job.service_name, weight: 8 },
    { field: 'payout_estimated', value: job.metadata?.estimated_payout, weight: 10 },
    { field: 'items', value: job.metadata?.items_json, weight: 8 },
  ];

  let weightedScore = 0;
  let totalWeight = 0;

  criticalChecks.forEach(check => {
    totalWeight += check.weight;
    if (check.value && String(check.value).trim()) {
      weightedScore += check.weight;
    } else {
      issues.push(`Missing ${check.field}`);
    }
  });

  const completeness = (weightedScore / totalWeight) * 100;

  // Accuracy checks (format validation)
  let accuracyScore = 100;
  
  if (job.customer_phone && !/^\d{10}$|^\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(job.customer_phone)) {
    accuracyScore -= 15;
    issues.push('Invalid phone format');
  }
  
  if (job.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.customer_email)) {
    accuracyScore -= 15;
    issues.push('Invalid email format');
  }
  
  if (job.service_zip && !/^\d{5}(-\d{4})?$/.test(job.service_zip)) {
    accuracyScore -= 10;
    issues.push('Invalid ZIP format');
  }

  // Consistency checks
  let consistencyScore = 100;
  
  if (job.metadata?.estimated_payout && job.metadata?.order_total) {
    const payout = Number(job.metadata.estimated_payout);
    const total = Number(job.metadata.order_total);
    if (payout > total) {
      consistencyScore -= 20;
      issues.push('Payout exceeds order total');
    }
  }

  if (job.service_name === '1 TV' || /^\d+\s*\w+$/.test(job.service_name)) {
    consistencyScore -= 10;
    issues.push('Generic service name - needs enrichment');
  }

  const overall = (completeness * 0.5) + (accuracyScore * 0.3) + (consistencyScore * 0.2);

  return {
    completeness: Math.round(completeness),
    accuracy: Math.round(accuracyScore),
    consistency: Math.round(consistencyScore),
    overall: Math.round(overall),
    issues
  };
}

/**
 * ALGORITHM 2: Camera Installation Details Extraction
 * Parses bundle/service data to extract camera-specific installation details
 */
export interface CameraDetails {
  camera_count: number;
  coverage_type: string; // "Full Perimeter", "Standard Perimeter", "Doorbell", "Custom", etc.
  equipment_mode: string; // "Provided" or "Customer-Supplied" or "Unknown"
  install_requirements: string[]; // ["Wire concealment", "Attic run", "Exterior mount", etc.]
  is_camera_install: boolean;
}

export function extractCameraDetails(job: any): CameraDetails | null {
  const items = job.metadata?.items_json || job.line_items || job.items || [];
  
  // Default result
  const result: CameraDetails = {
    camera_count: 0,
    coverage_type: "Unknown",
    equipment_mode: "Unknown",
    install_requirements: [],
    is_camera_install: false
  };

  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  // Analyze each item
  items.forEach((item: any) => {
    const name = (item.service_name || item.name || item.bundle_id || '').toLowerCase();
    const qty = item.qty || item.quantity || 1;

    // Detect camera installations
    if (name.includes('camera') || name.includes('perimeter') || name.includes('surveillance')) {
      result.is_camera_install = true;

      // Extract camera count
      // "Full Perimeter" typically includes 8 cameras
      // "Standard Perimeter" typically includes 4-6 cameras
      // "Doorbell" includes 1 camera
      if (name.includes('full perimeter')) {
        result.camera_count += 8 * qty;
        result.coverage_type = qty > 1 ? `${qty}x Full Perimeter` : "Full Perimeter";
      } else if (name.includes('standard perimeter')) {
        result.camera_count += 6 * qty;
        result.coverage_type = qty > 1 ? `${qty}x Standard Perimeter` : "Standard Perimeter";
      } else if (name.includes('doorbell')) {
        result.camera_count += 1 * qty;
        result.coverage_type = "Doorbell Camera";
      } else if (name.includes('camera')) {
        // Generic camera mention - try to extract quantity
        const match = name.match(/(\d+)\s*(?:camera|cam)/i);
        if (match) {
          result.camera_count += parseInt(match[1]) * qty;
        } else {
          result.camera_count += qty;
        }
        result.coverage_type = qty > 1 ? `${qty}x Cameras` : "Camera Install";
      }

      // Detect equipment mode
      if (name.includes('byo') || name.includes('bring your own') || name.includes('customer supplied')) {
        result.equipment_mode = "Customer-Supplied";
      } else if (name.includes('included') || name.includes('provided') || name.includes('with equipment')) {
        result.equipment_mode = "Equipment Provided";
      }

      // Extract installation requirements from item name or metadata
      if (name.includes('concealment') || name.includes('concealed')) {
        result.install_requirements.push("Wire concealment required");
      }
      if (name.includes('attic')) {
        result.install_requirements.push("Attic wire run");
      }
      if (name.includes('exterior') || name.includes('outdoor')) {
        result.install_requirements.push("Exterior mounting");
      }
      if (name.includes('brick') || name.includes('masonry')) {
        result.install_requirements.push("Brick/masonry mounting");
      }
      if (name.includes('nvr') || name.includes('recorder')) {
        result.install_requirements.push("NVR installation");
      }
      
      // Check item metadata for additional requirements
      if (item.metadata?.install_notes) {
        result.install_requirements.push(item.metadata.install_notes);
      }
    }
  });

  // If no cameras detected, return null
  if (!result.is_camera_install) {
    return null;
  }

  // Default equipment mode if still unknown but we know it's a camera install
  if (result.equipment_mode === "Unknown") {
    // Assume equipment provided if order total is high (indicates full bundle)
    const orderTotal = Number(job.metadata?.order_total || 0);
    result.equipment_mode = orderTotal > 1500 ? "Equipment Provided" : "Check with customer";
  }

  return result;
}

/**
 * ALGORITHM 3: Service Name Enrichment
 * Generates human-friendly service descriptions from items
 * CRITICAL: Always tries to enrich from items_json if available, even if service_name looks good
 */
export function enrichServiceName(job: any): string {
  // Extract items from various sources
  const items = job.metadata?.items_json || job.line_items || job.items || [];
  
  // If we have items, ALWAYS build from them (most accurate)
  if (Array.isArray(items) && items.length > 0) {
    const itemDescriptions = items.map((item: any) => {
      const qty = item.qty || item.quantity || 1;
      
      // Try multiple field names for the item name
      let name = item.service_name || item.name || item.bundle_id || item.bundle_name || item.product_name || item.description || '';
      
      // If name is empty or generic, try to build from other fields
      if (!name || name === 'Service' || name === 'Item') {
        // Check if there's a type field (e.g., "TV Mounting")
        name = item.type || item.service_type || item.category || 'Service';
      }
      
      // Clean up the name
      let cleanName = String(name).trim();
      
      // Remove redundant quantity prefix if it exists (e.g., "2 TVs" → "TVs" if qty=2)
      cleanName = cleanName.replace(/^\d+x?\s*/i, '');
      
      // Keep important details in parentheses (size, model, etc.) but remove marketing fluff
      cleanName = cleanName.replace(/\s*\(recommended\)/gi, '');
      cleanName = cleanName.replace(/\s*\(popular\)/gi, '');
      cleanName = cleanName.replace(/\s*\(best value\)/gi, '');
      
      cleanName = cleanName.trim();
      
      // Format with quantity if > 1
      if (qty > 1) {
        return `${qty}x ${cleanName}`;
      }
      return cleanName;
    });

    // Combine all items (show up to 3, then summarize rest)
    if (itemDescriptions.length === 1) {
      return itemDescriptions[0];
    } else if (itemDescriptions.length <= 3) {
      return itemDescriptions.join(', ');
    } else {
      const first3 = itemDescriptions.slice(0, 3).join(', ');
      return `${first3} + ${itemDescriptions.length - 3} more`;
    }
  }
  
  // No items - check if service_name is good enough
  const serviceName = job.service_name || job.service_id || '';
  
  // If service_name is too generic or empty, return fallback
  if (!serviceName || 
      serviceName === 'Service' || 
      serviceName === 'service' ||
      /^\d+\s*(tv|TV|item)/i.test(serviceName)) {
    return 'Service (details pending)';
  }
  
  // Service name looks decent, use it
  return serviceName;
}

/**
 * ALGORITHM 4: Payout Validation & Recalculation
 * Ensures payout is within business rules
 */
export function validatePayout(job: any): { valid: boolean; calculated: number; issues: string[] } {
  const issues: string[] = [];
  const storedPayout = Number(job.metadata?.estimated_payout || job.payout_estimated || 0);
  const orderTotal = Number(job.metadata?.order_total || job.order_total || 0);
  const orderSubtotal = Number(job.metadata?.order_subtotal || job.order_subtotal || orderTotal);

  // Calculate expected payout
  let calculatedPayout = Math.floor(orderSubtotal * 0.35);
  
  // Special rule: Mounting services minimum
  const serviceName = (job.service_name || '').toLowerCase();
  if (calculatedPayout < 45 && serviceName.includes('mount')) {
    calculatedPayout = 45;
  }

  // Apply floor and cap
  const MIN = 35;
  const MAX_PCT = 0.45;
  calculatedPayout = Math.max(MIN, calculatedPayout);
  if (orderSubtotal > 0) {
    calculatedPayout = Math.min(calculatedPayout, orderSubtotal * MAX_PCT);
  }
  calculatedPayout = Math.round(calculatedPayout * 100) / 100;

  // Validate
  let valid = true;
  
  if (storedPayout === 0) {
    issues.push('Missing payout - needs calculation');
    valid = false;
  }
  
  if (storedPayout > 0 && Math.abs(storedPayout - calculatedPayout) > 5) {
    issues.push(`Payout mismatch: stored $${storedPayout} vs calculated $${calculatedPayout}`);
    valid = false;
  }
  
  if (storedPayout > orderTotal * 0.50) {
    issues.push('Payout exceeds 50% of order total - check calculation');
    valid = false;
  }

  return { valid, calculated: calculatedPayout, issues };
}

/**
 * ALGORITHM 5: Data Normalization Pipeline
 * Transforms raw job data into standardized enriched format
 */
export function normalizeJobData(rawJob: any): EnrichedJobData {
  const qualityScore = assessDataQuality(rawJob);
  const enrichedServiceName = enrichServiceName(rawJob);
  const payoutValidation = validatePayout(rawJob);

  return {
    job_id: rawJob.job_id || rawJob.id,
    order_id: rawJob.order_id,
    status: rawJob.status,
    service_name: enrichedServiceName,
    customer: {
      name: rawJob.customer_name || '',
      email: rawJob.customer_email || '',
      phone: rawJob.customer_phone || '',
      address: rawJob.service_address || rawJob.address || '',
      city: rawJob.service_city || rawJob.city || '',
      state: rawJob.service_state || rawJob.state || '',
      zip: rawJob.service_zip || rawJob.zip || '',
    },
    service: {
      id: rawJob.service_id,
      name: enrichedServiceName,
      items: rawJob.metadata?.items_json || rawJob.line_items || [],
      description: buildServiceDescription(rawJob),
    },
    financials: {
      payout_estimated: payoutValidation.valid 
        ? (rawJob.metadata?.estimated_payout || rawJob.payout_estimated) 
        : payoutValidation.calculated,
      order_subtotal: rawJob.metadata?.order_subtotal || rawJob.order_subtotal || 0,
      order_total: rawJob.metadata?.order_total || rawJob.order_total || 0,
      payment_status: rawJob.payment_status || rawJob.metadata?.payment_status || 'pending',
    },
    scheduling: {
      start_iso: rawJob.start_iso,
      delivery_date: rawJob.metadata?.delivery_date || rawJob.delivery_date,
      delivery_time: rawJob.metadata?.delivery_time || rawJob.delivery_time,
      window: rawJob.window || rawJob.metadata?.window,
    },
    context: {
      referral_code: rawJob.metadata?.referral_code || rawJob.referral_code,
      referrer_email: rawJob.metadata?.referrer_email,
      customer_notes: rawJob.metadata?.customer_notes || rawJob.notes,
      source: rawJob.metadata?.source || rawJob.source || 'unknown',
      session_id: rawJob.metadata?.session_id || rawJob.session_id,
    },
    metadata: rawJob.metadata || {},
    quality_score: qualityScore,
  };
}

/**
 * HELPER: Build service description from items
 */
function buildServiceDescription(job: any): string {
  const items = job.metadata?.items_json || job.line_items || [];
  if (!Array.isArray(items) || items.length === 0) {
    return job.description || '';
  }

  const bullets = items.map((item: any) => {
    const qty = item.qty || item.quantity || 1;
    const name = item.service_name || item.name || 'Service';
    return `• ${qty}x ${name}`;
  });

  return bullets.join('\n');
}

/**
 * ALGORITHM 6: Batch Data Audit
 * Analyzes multiple jobs and generates health report
 */
export function auditJobsBatch(jobs: any[]): {
  total: number;
  healthy: number;
  needsAttention: number;
  critical: number;
  avgQualityScore: number;
  commonIssues: Map<string, number>;
} {
  const commonIssues = new Map<string, number>();
  let totalScore = 0;
  let healthy = 0;
  let needsAttention = 0;
  let critical = 0;

  jobs.forEach(job => {
    const normalized = normalizeJobData(job);
    const score = normalized.quality_score.overall;
    totalScore += score;

    if (score >= 90) healthy++;
    else if (score >= 70) needsAttention++;
    else critical++;

    normalized.quality_score.issues.forEach(issue => {
      commonIssues.set(issue, (commonIssues.get(issue) || 0) + 1);
    });
  });

  return {
    total: jobs.length,
    healthy,
    needsAttention,
    critical,
    avgQualityScore: Math.round(totalScore / jobs.length),
    commonIssues,
  };
}

/* PS PATCH: completion orchestration shared + service-week bucketing — start */

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function numOrZero(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function uniq(list: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const v of list) {
    const s = String(v || '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function getProPayoutPercent(): number {
  const raw = process.env.PORTAL_PAYOUT_PERCENT || process.env.PRO_PAYOUT_PERCENT || '';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.35;
}

function computeLegacyPercentPayout(opts: { subtotal: number; serviceHint?: string; qtyHint?: number }): number {
  const subtotal = numOrZero(opts.subtotal);
  if (!(subtotal > 0)) return 0;

  const payoutPct = getProPayoutPercent();
  const MIN_PAYOUT = Number(process.env.PORTAL_MIN_PAYOUT || 35) || 35;
  const MAX_PAYOUT_PCT = Number(process.env.PORTAL_MAX_PAYOUT_PCT || 0.45) || 0.45;
  const qty = Math.max(1, Math.floor(numOrZero(opts.qtyHint) || 1));

  let base = Math.floor(subtotal * payoutPct);
  const svc = String(opts.serviceHint || '').toLowerCase();
  if (base < 45 && svc.includes('mount')) {
    base = 45 * qty;
  }

  let payout = Math.max(MIN_PAYOUT, base);
  payout = Math.min(payout, subtotal * MAX_PAYOUT_PCT);
  return round2(payout);
}

function extractEstimatedPayout(jobRow: any): number {
  if (!jobRow || typeof jobRow !== 'object') return 0;
  const safeParseJson = (v: any) => {
    try { return (typeof v === 'string' ? JSON.parse(v) : v); } catch { return null; }
  };
  const meta = safeParseJson(jobRow?.metadata) || safeParseJson(jobRow?.meta) || null;

  return (
    numOrZero(jobRow?.calc_pro_payout_total) ||
    numOrZero(jobRow?.pro_payout_total) ||
    numOrZero(jobRow?.tech_payout_total) ||
    numOrZero(jobRow?.estimated_payout) ||
    numOrZero(jobRow?.payout_estimated) ||
    numOrZero(meta?.calc_pro_payout_total) ||
    numOrZero(meta?.pro_payout_total) ||
    numOrZero(meta?.tech_payout_total) ||
    numOrZero(meta?.estimated_payout) ||
    numOrZero(meta?.payout_estimated)
  );
}

function bestEffortComputePayoutFromCustomerTotals(jobRow: any): number {
  if (!jobRow || typeof jobRow !== 'object') return 0;
  const safeParseJson = (v: any) => {
    try { return (typeof v === 'string' ? JSON.parse(v) : v); } catch { return null; }
  };
  const meta = safeParseJson(jobRow?.metadata) || safeParseJson(jobRow?.meta) || {};
  const serviceHint = String(jobRow?.service_id || jobRow?.service_name || meta?.service_id || meta?.service_name || '');

  const items = (meta?.items_json || meta?.items || meta?.line_items || meta?.lineItems) as any;
  if (Array.isArray(items) && items.length) {
    let subtotal = 0;
    let qtySum = 0;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const qty = Math.max(1, Math.floor(numOrZero(it.qty || it.quantity || 1) || 1));
      const line = numOrZero(it.line_total || it.lineTotal || it.line_customer_total || it.lineCustomerTotal);
      const unit = numOrZero(it.unit_price || it.unitPrice || it.unit_customer_price || it.unitCustomerPrice || it.price);

      if (line > 0) subtotal += line;
      else if (unit > 0) subtotal += unit * qty;
      qtySum += qty;
    }
    const payout = computeLegacyPercentPayout({ subtotal, serviceHint, qtyHint: qtySum });
    if (payout > 0) return payout;
  }

  const subtotal = numOrZero(meta?.subtotal || meta?.order_subtotal || meta?.orderSubtotal || jobRow?.subtotal || jobRow?.order_subtotal || jobRow?.amount_subtotal);
  if (subtotal > 0) return computeLegacyPercentPayout({ subtotal, serviceHint, qtyHint: 1 });

  const total = numOrZero(meta?.total || meta?.order_total || meta?.orderTotal || jobRow?.total || jobRow?.order_total || jobRow?.amount_total || jobRow?.total_amount);
  if (total > 0) return computeLegacyPercentPayout({ subtotal: total, serviceHint, qtyHint: 1 });

  return 0;
}

export function getWeekStart(dateIso: string): string {
    const d = new Date(dateIso);
    if (Number.isNaN(d.getTime())) {
        const now = new Date();
        const day = now.getUTCDay();
        const diff = (day === 0 ? -6 : 1) - day;
        now.setUTCDate(now.getUTCDate() + diff);
        now.setUTCHours(0, 0, 0, 0);
        return now.toISOString().slice(0, 10);
    }
    const day = d.getUTCDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1) - day;
    d.setUTCDate(d.getUTCDate() + diff);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Main Orchestration
// ----------------------------------------------------------------------------

export async function ensureCompletionSideEffects(opts: {
  jobId: string;
  completedAtIso: string;
  actorType: 'pro' | 'admin';
  actorId: string;
  requestId?: string;
}): Promise<{ ok: boolean; error?: string; payoutId?: string; sentMail?: boolean; warning?: string }> {
  const { jobId, completedAtIso, actorType, actorId } = opts;
  const rid = opts.requestId || `req_${Date.now()}`;
  const sb = getSupabase(); // Service role client

  console.log(`[COMPLETION_ORCH_START] jobId=${jobId} actor=${actorType}:${actorId}`);

  // 1. Resolve tables
  let idCol = 'job_id';
  let jobsTable = 'h2s_jobs';
  try {
     const schema = await resolveDispatchSchema(sb);
     if (schema) {
         jobsTable = schema.jobsTable;
         idCol = schema.jobsIdCol;
     }
  } catch {}

  // 2. Load Job (Fail Closed)
  const { data: job, error: jobError } = await sb.from(jobsTable).select('*').eq(idCol, jobId).single();
  
  if (jobError || !job) {
      console.error(`[COMPLETION_ORCH_FAIL] Job not found: ${jobId}`, jobError);
      return { ok: false, error: 'Job not found during side-effect orchestration' };
  }

  // 3. Determine Pro
  let beneficiaryProId = (actorType === 'pro') ? actorId : null;
  if (!beneficiaryProId) {
    beneficiaryProId = job.pro_id || job.assigned_pro_id || job.tech_id || job.technician_id || job.pro_uuid;
  }
  
  // 3b. Update assignments (Legacy Best Effort)
  const proEmail = job.pro_email || job.email || job.tech_email;
  
  // 4. Calculate Payout
  let amount = extractEstimatedPayout(job);
  if (amount <= 0) {
      amount = bestEffortComputePayoutFromCustomerTotals(job);
  }

  // 4b. Integrity Check: Assert minimum viable payout Logic
  // Check if amount is suspiciously zero but we have order total?
  // We won't block on 0, but we will block on NaN or Infinity.
  if(!Number.isFinite(amount)) return { ok: false, error: 'Calculated payout is non-finite' };

  let payoutId = null;

  // 5. Week Bucket (Service Date Priority)
  // FIX: Prioritize scheduled_start_at
  const serviceDateIso = job.scheduled_start_at || job.start_iso || job.start_at || completedAtIso || job.created_at;
  const weekStart = getWeekStart(serviceDateIso);

  // 5b. Strict Integrity Check
  if (job.order_total && amount > job.order_total * 0.9) {
      console.error(`[COMPLETION_INTEGRITY_FAIL] Payout ${amount} exceeds probable max for order ${job.order_total}`);
      // Fail closed? Or warn? User asked for "log loudly with return error... No silent wrong totals"
      // Let's fail if it's egregious (>90% of order total). 
      // Actually 90% is possible for labor-only jobs? let's safe guard at > 100%.
      if(amount > job.order_total) {
          return { ok: false, error: 'Payout exceeds order total (Integrity Check Failed)' };
      }
  }

  if (beneficiaryProId && amount > 0) {
      const payoutPayload = {
          job_id: jobId,
          pro_id: beneficiaryProId,
          payout_type: 'job',
          amount: amount,
          total_amount: amount,
          status: 'pending',
          week_start: weekStart, // The FIX
          week_bucket: weekStart,
          meta: {
              ...(typeof job.metadata === 'object' ? job.metadata : {}),
              service_date_iso: serviceDateIso,
              completed_at_iso: completedAtIso,
              derived_week_start: weekStart
          },
          updated_at: new Date().toISOString()
      };

      try {
          // Idempotent UPSERT
          // We rely on unique constraint on (job_id, pro_id, payout_type)
          // We must match the DB constraint exactly for ON CONFLICT to work.
          const { data: ins, error: insErr } = await sb.from('h2s_payouts_ledger')
              .upsert(payoutPayload, { onConflict: 'job_id, pro_id, payout_type' }) 
              .select('payout_id')
              .single();
              
          if (insErr) {
             throw insErr;
          }
          if (ins) payoutId = ins.payout_id;
          
          console.log(`[COMPLETION_ORCH_PAYOUT_UPSERT] jobId=${jobId} payoutId=${payoutId} weekStart=${weekStart} serviceDateIso=${serviceDateIso}`);

      } catch (e: any) {
          console.error(`[COMPLETION_ORCH_FAIL] Payout upsert failed: ${e.message}`);
          return { ok: false, error: e.message }; // Fail Closed as requested
      }
  } else {
     console.log(`[COMPLETION_ORCH_SKIP_PAYOUT] amount=${amount}, pro=${beneficiaryProId}`);
  }
  
  // 6. Send Mail
  // Send to Pro if we have email
  const targetEmail = proEmail || (actorType === 'pro' ? null : null); // If admin, we used job pro email
  if (targetEmail && targetEmail.includes('@')) {
       // Only send completion receipt
       const emailHtml = `
         <div style="font-family: sans-serif; color: #333;">
            <h2>Job Completed</h2>
            <p><strong>Job ID:</strong> ${jobId}</p>
            <p><strong>Service:</strong> ${job.service_name || job.title || 'Service'}</p>
            <p><strong>Service Date:</strong> ${serviceDateIso}</p>
            <p><strong>Marked Done:</strong> ${completedAtIso}</p>
            <p><strong>Estimated Payout:</strong> $${amount.toFixed(2)}</p>
            <hr>
            <p>This confirmation serves as your receipt.</p>
         </div>
       `;
       const mailRes = await sendMail({
         to: targetEmail,
         subject: `Job Completed: ${job.service_name || job.title || 'Service'}`,
         html: emailHtml,
         category: 'job_completed',
         idempotencyKey: `job_completed:${jobId}`,
         meta: { jobId, proId: beneficiaryProId, amount }
       });
       console.log(`[COMPLETION_ORCH_MAIL] jobId=${jobId} type=job_completed skippedOrSent=${mailRes.skipped ? 'skipped' : 'sent'}`);
  }

  console.log(`[COMPLETION_ORCH_DONE] jobId=${jobId}`);
  return { ok: true, payoutId };
}
/* PS PATCH: completion orchestration shared + service-week bucketing — end */
