export interface QuoteLineItem {
  id?: string;
  description: string;
  quantity: number;
  unit: string;
  unit_rate: number;
  line_total: number;
  sort_order: number;
}

export interface Quote {
  id: string;
  quote_reference: string;
  customer_id: string;
  requester_id: string | null;
  requester_initials: string | null;
  quote_date: string;
  attention_name: string | null;
  attention_email: string | null;
  subject_line: string | null;
  project_description: string | null;
  salutation: string | null;
  validity_days: number;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  status: QuoteStatus;
  accepted: boolean;
  po_number: string | null;
  started: boolean;
  invoice_number: string | null;
  invoice_notes: string | null;
  signoff_name: string | null;
  signoff_title: string | null;
  custom_footer_text: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  invoiced_at: string | null;
  // Joined
  customer?: { id: string; company_name: string; short_name: string | null };
  line_items?: QuoteLineItem[];
}

export type QuoteStatus =
  | 'draft'
  | 'pending_internal_approval'
  | 'sent'
  | 'won'
  | 'lost'
  | 'ready_to_invoice'
  | 'invoiced';

export const QUOTE_STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'border-slate-500/30 text-slate-400 bg-slate-500/10' },
  pending_internal_approval: { label: 'Pending Approval', color: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
  sent: { label: 'Sent', color: 'border-blue-500/30 text-blue-400 bg-blue-500/10' },
  won: { label: 'Won', color: 'border-green-500/30 text-green-400 bg-green-500/10' },
  lost: { label: 'Lost', color: 'border-red-500/30 text-red-400 bg-red-500/10' },
  ready_to_invoice: { label: 'Ready to Invoice', color: 'border-purple-500/30 text-purple-400 bg-purple-500/10' },
  invoiced: { label: 'Invoiced', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
};

export interface QuoteFormData {
  customer_id: string;
  requester_initials: string;
  quote_date: string;
  attention_name: string;
  attention_email: string;
  subject_line: string;
  project_description: string;
  salutation: string;
  validity_days: number;
  signoff_name: string;
  signoff_title: string;
  custom_footer_text: string;
  line_items: QuoteLineItem[];
}
