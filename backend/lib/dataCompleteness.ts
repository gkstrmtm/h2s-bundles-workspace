/**
 * Data Completeness Utilities
 * Ensures dispatch jobs and portal views never show missing/weak data
 */

interface CartItem {
  name?: string;
  service_name?: string;
  id?: string;
  qty?: number;
  price?: number;
  metadata?: any;
}

interface Customer {
  name?: string;
  email: string;
  phone?: string;
}

/**
 * Generate normalized job details summary from cart/order data
 * NEVER returns empty string or "None specified"
 */
export function generateJobDetailsSummary(
  cart: CartItem[],
  customer: Customer,
  metadata?: any
): string {
  const parts: string[] = [];

  // Service summary
  if (cart && cart.length > 0) {
    const serviceNames = cart.map(item => 
      `${item.name || item.service_name || 'Service'} (x${item.qty || 1})`
    );
    parts.push(serviceNames.join(', '));
  } else {
    parts.push('Service requested');
  }

  // Customer
  parts.push(`Customer: ${customer.name || customer.email}`);
  
  // Address
  const address = metadata?.service_address || metadata?.address;
  const city = metadata?.service_city || metadata?.city;
  const state = metadata?.service_state || metadata?.state;
  const zip = metadata?.service_zip || metadata?.zip;
  
  if (address || city || state || zip) {
    const addressParts = [address, city, state, zip].filter(Boolean);
    parts.push(`Location: ${addressParts.join(', ')}`);
  }

  // Promo code
  if (metadata?.offer_code || metadata?.promo_code) {
    parts.push(`Promo: ${metadata.offer_code || metadata.promo_code}`);
  }

  // Free items
  if (metadata?.free_roku) {
    const qty = metadata.free_roku_qty || 1;
    parts.push(`Free Roku (x${qty})`);
  }

  return parts.join(' • ');
}

/**
 * Generate normalized equipment provided summary
 * NEVER returns "?" or empty string
 */
export function generateEquipmentProvided(
  cart: CartItem[],
  metadata?: any
): string {
  const equipment: string[] = [];

  // Check cart items for equipment metadata
  if (cart && cart.length > 0) {
    cart.forEach(item => {
      const meta = item.metadata || {};
      
      // TV mounts
      if (meta.mount_type) {
        equipment.push(`${meta.mount_type} mount`);
      }
      if (meta.tv_size) {
        equipment.push(`${meta.tv_size}" TV bracket`);
      }
      
      // Cameras
      if (meta.camera_type) {
        equipment.push(`${meta.camera_type} camera`);
      }
      
      // Generic equipment
      if (meta.equipment) {
        equipment.push(meta.equipment);
      }
    });
  }

  // Check order-level metadata
  if (metadata?.equipment_list) {
    if (Array.isArray(metadata.equipment_list)) {
      equipment.push(...metadata.equipment_list);
    } else if (typeof metadata.equipment_list === 'string') {
      equipment.push(metadata.equipment_list);
    }
  }

  // Free Roku
  if (metadata?.free_roku) {
    const qty = metadata.free_roku_qty || 1;
    equipment.push(`Roku Express (x${qty}) - FREE`);
  }

  if (equipment.length > 0) {
    return equipment.join(', ');
  }

  // Fallback: derive from service names
  if (cart && cart.length > 0) {
    const serviceTypes = cart.map(item => {
      const name = (item.name || item.service_name || '').toLowerCase();
      if (name.includes('tv') && name.includes('mount')) return 'TV mounting hardware';
      if (name.includes('camera')) return 'Camera mounting hardware';
      if (name.includes('doorbell')) return 'Doorbell mounting hardware';
      return 'Installation hardware';
    });
    const uniqueTypes = Array.from(new Set(serviceTypes));
    return uniqueTypes.join(', ');
  }

  return 'Standard installation equipment';
}

/**
 * Get schedule status string
 */
export function getScheduleStatus(scheduledDate?: string | null): string {
  if (!scheduledDate) {
    return 'Scheduling Pending';
  }
  
  try {
    const date = new Date(scheduledDate);
    if (isNaN(date.getTime())) {
      return 'Scheduling Pending';
    }
    
    const now = new Date();
    if (date < now) {
      return 'Past Scheduled Date';
    }
    
    return 'Scheduled';
  } catch {
    return 'Scheduling Pending';
  }
}

/**
 * Format schedule date for display
 */
export function formatScheduledDate(scheduledDate?: string | null): string {
  if (!scheduledDate) {
    return 'Not scheduled';
  }
  
  try {
    const date = new Date(scheduledDate);
    if (isNaN(date.getTime())) {
      return 'Not scheduled';
    }
    
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return 'Not scheduled';
  }
}
