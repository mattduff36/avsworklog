export interface QuoteLineItem {
  id?: string;
  description: string;
  quantity: number;
  unit: string;
  unit_rate: number;
  line_total: number;
  sort_order: number;
}

export interface QuoteAttachment {
  id: string;
  quote_id: string;
  file_name: string;
  file_path: string;
  content_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface QuoteInvoiceAllocation {
  id: string;
  quote_invoice_id: string;
  quote_line_item_id: string | null;
  quantity_invoiced: number | null;
  amount_invoiced: number;
  comments: string | null;
  created_at: string;
}

export interface QuoteInvoice {
  id: string;
  quote_id: string;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  invoice_scope: 'full' | 'partial';
  comments: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  allocations?: QuoteInvoiceAllocation[];
}

export interface QuoteManagerOption {
  profile_id: string;
  initials: string;
  next_number: number;
  number_start: number;
  signoff_name: string | null;
  signoff_title: string | null;
  manager_email: string | null;
  approver_profile_id: string | null;
  is_active: boolean;
  profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  approver?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
}

export interface Quote {
  id: string;
  quote_reference: string;
  base_quote_reference: string;
  quote_thread_id: string;
  parent_quote_id: string | null;
  customer_id: string;
  requester_id: string | null;
  requester_initials: string | null;
  quote_date: string;
  attention_name: string | null;
  attention_email: string | null;
  subject_line: string | null;
  project_description: string | null;
  salutation: string | null;
  site_address: string | null;
  validity_days: number;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  status: QuoteStatus;
  accepted: boolean;
  po_number: string | null;
  po_received_at: string | null;
  po_value: number | null;
  started: boolean;
  start_date: string | null;
  start_alert_days: number | null;
  start_alert_sent_at: string | null;
  invoice_number: string | null;
  invoice_notes: string | null;
  last_invoice_at: string | null;
  signoff_name: string | null;
  signoff_title: string | null;
  custom_footer_text: string | null;
  revision_number: number;
  revision_type: QuoteRevisionType;
  version_label: string | null;
  version_notes: string | null;
  is_latest_version: boolean;
  duplicate_source_quote_id: string | null;
  manager_name: string | null;
  manager_email: string | null;
  approver_profile_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  returned_at: string | null;
  return_comments: string | null;
  customer_sent_at: string | null;
  customer_sent_by: string | null;
  completion_status: QuoteCompletionStatus;
  completion_comments: string | null;
  commercial_status: QuoteCommercialStatus;
  closed_at: string | null;
  rams_requested_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  invoiced_at: string | null;
  // Joined
  customer?: {
    id: string;
    company_name: string;
    short_name: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    address_line_1?: string | null;
    address_line_2?: string | null;
    city?: string | null;
    county?: string | null;
    postcode?: string | null;
  };
  line_items?: QuoteLineItem[];
  attachments?: QuoteAttachment[];
  invoices?: QuoteInvoice[];
  versions?: Quote[];
  invoice_summary?: {
    invoicedTotal: number;
    remainingBalance: number;
    lastInvoiceAt: string | null;
    status: 'not_invoiced' | 'partially_invoiced' | 'invoiced';
  };
}

export interface QuoteListSummary {
  total_quotes: number;
  status_counts: Record<QuoteStatus | 'all', number>;
  won_quotes: number;
  won_value: number;
}

export type QuoteRevisionType =
  | 'original'
  | 'revision'
  | 'extra'
  | 'variation'
  | 'future_work'
  | 'duplicate';

export type QuoteCompletionStatus =
  | 'not_completed'
  | 'approved_in_full'
  | 'approved_in_part';

export type QuoteCommercialStatus = 'open' | 'closed';

export type QuoteStatus =
  | 'draft'
  | 'pending_internal_approval'
  | 'changes_requested'
  | 'approved'
  | 'sent'
  | 'won'
  | 'lost'
  | 'ready_to_invoice'
  | 'po_received'
  | 'in_progress'
  | 'completed_part'
  | 'completed_full'
  | 'partially_invoiced'
  | 'invoiced'
  | 'closed';

export const QUOTE_STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'border-slate-500/30 text-slate-400 bg-slate-500/10' },
  pending_internal_approval: { label: 'Pending Approval', color: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
  changes_requested: { label: 'Changes Requested', color: 'border-orange-500/30 text-orange-400 bg-orange-500/10' },
  approved: { label: 'Approved', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
  sent: { label: 'Sent', color: 'border-blue-500/30 text-blue-400 bg-blue-500/10' },
  won: { label: 'Won', color: 'border-green-500/30 text-green-400 bg-green-500/10' },
  lost: { label: 'Lost', color: 'border-red-500/30 text-red-400 bg-red-500/10' },
  ready_to_invoice: { label: 'Ready to Invoice', color: 'border-purple-500/30 text-purple-400 bg-purple-500/10' },
  po_received: { label: 'Accepted', color: 'border-sky-500/30 text-sky-400 bg-sky-500/10' },
  in_progress: { label: 'In Progress', color: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10' },
  completed_part: { label: 'Completed In Part', color: 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10' },
  completed_full: { label: 'Completed In Full', color: 'border-lime-500/30 text-lime-400 bg-lime-500/10' },
  partially_invoiced: { label: 'Partially Invoiced', color: 'border-fuchsia-500/30 text-fuchsia-400 bg-fuchsia-500/10' },
  invoiced: { label: 'Invoiced', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
  closed: { label: 'Closed', color: 'border-slate-300/30 text-slate-200 bg-slate-400/10' },
};

export interface QuoteFormData {
  customer_id: string;
  manager_profile_id: string;
  requester_initials: string;
  quote_date: string;
  attention_name: string;
  attention_email: string;
  site_address: string;
  subject_line: string;
  project_description: string;
  salutation: string;
  validity_days: number;
  manager_name: string;
  manager_email: string;
  approver_profile_id: string;
  signoff_name: string;
  signoff_title: string;
  custom_footer_text: string;
  version_notes: string;
  start_date: string;
  start_alert_days: number | '';
  line_items: QuoteLineItem[];
}
