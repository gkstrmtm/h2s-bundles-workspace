export interface AdminAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  geo_lat?: number;
  geo_lng?: number;
  formatted?: string;
}

export interface AdminCustomer {
  name: string;
  id?: string;
  email: string;
  phone: string;
  notes?: string;
}

export interface AdminServiceScope {
  items: any[]; // Parsed equipment list
  item_count: number;
  special_instructions: string;
  access_codes?: string;
  complexity?: 'low' | 'medium' | 'high';
}

export interface AdminJobFinancials {
  total_price: number; // Customer price in cents
  payout_estimated: number; // Pro base pay in cents
  payout_actual?: number;
  payout_id?: string;
  payout_status?: 'pending' | 'approved' | 'paid' | 'rejected' | 'none';
  bonuses: number;
  tip: number;
}

export interface AdminProAssignment {
  pro_id?: string;
  name?: string;
  phone?: string;
  email?: string;
  status: 'unassigned' | 'offered' | 'accepted' | 'declined' | 'completed';
  assigned_at?: string;
  viewed_at?: string;
}

export interface AdminJobDTO {
  job_id: string;
  display_id: string; // e.g. "JOB-1234"
  status: string; // Normalized status
  created_at: string;
  updated_at: string;
  
  // Primary Sections
  customer: AdminCustomer;
  address: AdminAddress;
  scope: AdminServiceScope;
  financials: AdminJobFinancials;
  assignment: AdminProAssignment;
  
  // Scheduling
  schedule: {
    requested_date?: string;
    requested_time?: string;
    scheduled_start?: string;
    scheduled_end?: string;
    duration_minutes: number;
    confirmed: boolean;
  };

  // Workflow
  flags: {
    pain_flags: string[]; // ['high_value', 'repeat_customer', 'bad_address']
    actions_required: string[]; // ['approve_payout', 'verify_completion']
  };
  
  // Raw Metadata (for backward compact)
  metadata: Record<string, any>;
}

export interface AdminPayoutDTO {
  payout_id: string;
  job_id: string;
  pro_id: string;
  amount_cents: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  created_at: string;
  approved_at?: string;
  paid_at?: string;
  
  // Context
  job_title: string;
  customer_name: string;
  completion_date?: string;
}
