/**
 * Job Management Helper Functions
 * Implements standardized job logic for pain flags, equipment lanes, and ordering
 */

/**
 * Determine equipment lane based on items
 * @param {Array} items - Parsed items from order
 * @returns {string} - 'BYO', 'COMPANY_SUPPLIED', or 'HYBRID'
 */
export function determineEquipmentLane(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'COMPANY_SUPPLIED'; // Default assumption
  }

  const hasBYO = items.some(item => 
    item.metadata?.mount_type === 'customer_provided' ||
    item.metadata?.mount_provider === 'customer' ||
    item.metadata?.equipment_provided_by === 'customer' ||
    (item.service_name || '').toLowerCase().includes('customer mount')
  );
  
  const hasCompanySupplied = items.some(item =>
    (item.metadata?.mount_type && item.metadata?.mount_type !== 'customer_provided') ||
    item.metadata?.mount_provider === 'h2s' ||
    item.metadata?.mount_provider === 'company'
  );
  
  if (hasBYO && hasCompanySupplied) return 'HYBRID';
  if (hasBYO) return 'BYO';
  return 'COMPANY_SUPPLIED';
}

/**
 * Check if ordering is required for this job
 * @param {Array} items - Parsed items from order  
 * @returns {boolean}
 */
export function requiresOrdering(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return false;
  }

  return items.some(item => 
    // Has mount type that needs ordering
    (item.metadata?.mount_type && 
     item.metadata?.mount_type !== 'customer_provided' &&
     item.metadata?.mount_type !== 'none') ||
    // Explicitly marked as needs ordering
    item.metadata?.requires_ordering === true ||
    item.metadata?.order_required === true
  );
}

/**
 * Evaluate pain flags for a job
 * @param {Object} job - Job object with metadata
 * @returns {Array} - Array of pain flag objects
 */
export function evaluatePainFlags(job) {
  const flags = [];
  const metadata = job.metadata || {};
  const now = new Date().toISOString();
  
  // Wire management unknown
  if (!metadata.wire_management_required || metadata.wire_management_required === 'UNKNOWN') {
    flags.push({
      flag: 'WIRE_MANAGEMENT_UNKNOWN',
      severity: 'HIGH',
      message: 'Wire management level not determined - may require additional materials or time',
      added_at: now
    });
  }
  
  // Wall type unknown
  if (!metadata.wall_type || metadata.wall_type === 'UNKNOWN') {
    flags.push({
      flag: 'WALL_TYPE_UNKNOWN',
      severity: 'MEDIUM',
      message: 'Wall type not confirmed - mounting approach uncertain',
      added_at: now
    });
  }
  
  // Equipment lane not confirmed
  if (!metadata.equipment_lane) {
    flags.push({
      flag: 'EQUIPMENT_LANE_MISSING',
      severity: 'MEDIUM',
      message: 'Equipment lane not determined - clarify who provides mounts',
      added_at: now
    });
  }
  
  // Ordering required but no plan
  if (metadata.order_required && !metadata.order_plan) {
    flags.push({
      flag: 'ORDERING_AMBIGUOUS',
      severity: 'HIGH',
      message: 'Ordering required but no order plan created - parts may not be available',
      added_at: now
    });
  }
  
  // No address
  if (!job.service_address && !job.address) {
    flags.push({
      flag: 'ACCESS_DETAILS_MISSING',
      severity: 'CRITICAL',
      message: 'Service address missing - cannot dispatch job',
      added_at: now
    });
  }
  
  // No customer contact
  if (!job.customer_email && !job.customer_phone) {
    flags.push({
      flag: 'CUSTOMER_CONTACT_MISSING',
      severity: 'HIGH',
      message: 'No customer contact information - cannot coordinate',
      added_at: now
    });
  }
  
  // No schedule for non-pending jobs
  if (job.status !== 'pending' && job.status !== 'pending_scheduling' && !job.start_iso) {
    flags.push({
      flag: 'SCHEDULE_CONFLICT',
      severity: 'MEDIUM',
      message: 'Job accepted/dispatched but no schedule set',
      added_at: now
    });
  }
  
  return flags;
}

/**
 * Get default metadata for new jobs
 * @param {Array} items - Parsed items from order
 * @param {Object} order - Order object
 * @returns {Object} - Metadata object with standardized fields
 */
export function getDefaultJobMetadata(items, order = {}) {
  const equipmentLane = determineEquipmentLane(items);
  const orderRequired = requiresOrdering(items);
  
  const metadata = {
    // Existing fields (preserve)
    source: order.source || 'stripe_webhook',
    order_id: order.order_id || null,
    estimated_payout: order.estimated_payout || 0,
    items_json: Array.isArray(items) ? items : [],
    
    // New standardization fields
    wire_management_required: 'UNKNOWN', // To be confirmed by customer or tech
    wall_type: 'UNKNOWN', // To be confirmed
    equipment_lane: equipmentLane,
    order_required: orderRequired,
    order_stage: orderRequired ? 'PENDING_REVIEW' : 'NOT_NEEDED',
    order_plan: null, // Will be generated later if needed
    pain_flags: [], // Will be evaluated after job creation
    audit_log: [
      {
        timestamp: new Date().toISOString(),
        user_id: 'system',
        user_name: 'System',
        action: 'job_created',
        notes: `Created from ${order.source || 'stripe_webhook'}`
      }
    ]
  };
  
  return metadata;
}

/**
 * Add audit log entry to job metadata
 * @param {Object} metadata - Current metadata
 * @param {Object} entry - Audit entry { action, user_id, user_name, notes, field, old_value, new_value }
 * @returns {Object} - Updated metadata
 */
export function addAuditEntry(metadata, entry) {
  const auditLog = metadata.audit_log || [];
  
  auditLog.push({
    timestamp: new Date().toISOString(),
    user_id: entry.user_id || 'system',
    user_name: entry.user_name || 'System',
    action: entry.action,
    field: entry.field || null,
    old_value: entry.old_value || null,
    new_value: entry.new_value || null,
    notes: entry.notes || null
  });
  
  return {
    ...metadata,
    audit_log: auditLog
  };
}

/**
 * Resolve a pain flag
 * @param {Array} painFlags - Current pain flags
 * @param {string} flagType - Flag to resolve
 * @param {string} resolutionNotes - Why it was resolved
 * @returns {Array} - Updated pain flags
 */
export function resolvePainFlag(painFlags, flagType, resolutionNotes) {
  if (!Array.isArray(painFlags)) return [];
  
  return painFlags.map(f => 
    f.flag === flagType 
      ? { 
          ...f, 
          resolved_at: new Date().toISOString(), 
          resolution_notes: resolutionNotes 
        }
      : f
  );
}

/**
 * Check if job can transition to new status
 * @param {Object} job - Current job object
 * @param {string} newStatus - Target status
 * @returns {Object} - { ok: boolean, error?: string }
 */
export function canTransitionTo(job, newStatus) {
  const currentStatus = job.status;
  const metadata = job.metadata || {};
  
  // Define allowed transitions
  const validTransitions = {
    'pending': ['pending_scheduling', 'accepted', 'scheduled', 'cancelled'],
    'pending_scheduling': ['accepted', 'scheduled', 'cancelled'],
    'accepted': ['scheduled', 'in_progress', 'cancelled'],
    'scheduled': ['in_progress', 'on_my_way', 'cancelled'],
    'on_my_way': ['in_progress', 'cancelled'],
    'in_progress': ['completed', 'cancelled'],
    'completed': ['pending_payment', 'paid'],
    'pending_payment': ['paid', 'payment_issue'],
    'paid': [],
    'cancelled': [],
    'payment_issue': ['paid', 'cancelled']
  };
  
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    return { 
      ok: false, 
      error: `Cannot transition from ${currentStatus} to ${newStatus}` 
    };
  }
  
  // Special guards for specific transitions
  if (newStatus === 'in_progress') {
    if (!job.assigned_pro_id && !job.assigned_to) {
      return { 
        ok: false, 
        error: 'Job must be assigned to a tech before starting' 
      };
    }
    
    if (metadata.order_required && metadata.order_stage !== 'DELIVERED' && metadata.order_stage !== 'NOT_NEEDED') {
      return { 
        ok: false, 
        error: 'Equipment must be delivered before starting job' 
      };
    }
  }
  
  if (newStatus === 'completed') {
    const criticalFlags = (metadata.pain_flags || []).filter(
      f => f.severity === 'CRITICAL' && !f.resolved_at
    );
    
    if (criticalFlags.length > 0) {
      return { 
        ok: false, 
        error: `Cannot complete job with ${criticalFlags.length} unresolved critical pain flags` 
      };
    }
  }
  
  return { ok: true };
}
