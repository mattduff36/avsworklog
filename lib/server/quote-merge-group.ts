import type {
  QuoteInvoice,
  QuoteLineItem,
  QuoteMergeGroupMember,
  QuotePdfSnapshot,
  QuotePurchaseOrder,
  QuoteThreadFinancialSummary,
} from '@/app/(dashboard)/quotes/types';

export interface QuoteMergeGroupSource {
  quote_thread_id: string;
  source_latest_quote_id: string;
  base_quote_reference: string;
  is_survivor: boolean;
}

export interface QuoteMergeGroupVersion {
  id: string;
  quote_thread_id: string;
  is_latest_version: boolean;
  base_quote_reference: string;
  subject_line: string | null;
  project_description: string | null;
  customer_id: string | null;
  sage_posted_at: string | null;
}

interface QuoteMergeLineSource {
  id?: string;
  quote_id?: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_rate: number;
  line_total: number;
  sort_order: number;
  source_quote_reference?: string | null;
  source_quote_thread_id?: string | null;
}

function asQuoteLineItem(item: QuoteMergeLineSource): QuoteLineItem {
  return {
    ...item,
    unit: item.unit || '',
  };
}

interface BuildQuoteMergeGroupMembersInput {
  mergeMode: 'consolidated' | 'grouped';
  openedThreadId: string;
  customerName: string | null;
  members: QuoteMergeGroupSource[];
  versions: QuoteMergeGroupVersion[];
  survivorLineItems: QuoteMergeLineSource[];
  memberLineItems: QuoteMergeLineSource[];
  financialSummaries: Record<string, QuoteThreadFinancialSummary>;
  invoices: QuoteInvoice[];
  invoiceSourceThreadIds: Record<string, string[]>;
  purchaseOrders: QuotePurchaseOrder[];
  pdfSnapshots: QuotePdfSnapshot[];
  canViewCustomers: boolean;
  canViewQuoteFinancials: boolean;
}

function latestVersion(
  versions: QuoteMergeGroupVersion[],
  member: QuoteMergeGroupSource,
): QuoteMergeGroupVersion | undefined {
  return versions.find(version => (
    version.quote_thread_id === member.quote_thread_id && version.is_latest_version
  )) || versions.find(version => version.id === member.source_latest_quote_id);
}

export function buildQuoteMergeGroupMembers(
  input: BuildQuoteMergeGroupMembersInput,
): QuoteMergeGroupMember[] {
  const versionIdsByThread = new Map<string, Set<string>>();
  for (const version of input.versions) {
    const ids = versionIdsByThread.get(version.quote_thread_id) || new Set<string>();
    ids.add(version.id);
    versionIdsByThread.set(version.quote_thread_id, ids);
  }

  return input.members.map((member) => {
    const latest = latestVersion(input.versions, member);
    const threadVersionIds = versionIdsByThread.get(member.quote_thread_id) || new Set<string>();
    const lineItems = (input.mergeMode === 'consolidated'
      ? input.survivorLineItems.filter(item => (
        (item.source_quote_thread_id || input.openedThreadId) === member.quote_thread_id
      ))
      : input.memberLineItems.filter(item => item.quote_id === latest?.id)
    ).map(asQuoteLineItem);
    return {
      quote_thread_id: member.quote_thread_id,
      quote_id: latest?.id || member.source_latest_quote_id,
      reference: latest?.base_quote_reference || member.base_quote_reference,
      is_survivor: member.is_survivor,
      subject_line: latest?.subject_line || null,
      project_description: latest?.project_description || null,
      customer_id: input.canViewCustomers ? latest?.customer_id || null : null,
      customer_name: input.canViewCustomers ? input.customerName : null,
      show_financial_link: input.canViewQuoteFinancials,
      sage_posted: Boolean(latest?.sage_posted_at),
      line_items: lineItems,
      financial_summary: input.canViewQuoteFinancials
        ? input.financialSummaries[member.quote_thread_id] || null
        : null,
      invoices: input.invoices
        .filter(invoice => {
          const allocatedThreads = input.invoiceSourceThreadIds[invoice.id];
          if (allocatedThreads && allocatedThreads.length > 0) {
            return allocatedThreads.includes(member.quote_thread_id);
          }
          return threadVersionIds.has(invoice.quote_id);
        })
        .map(invoice => ({
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          amount: invoice.amount,
          merge_billing_scope: invoice.merge_billing_scope,
        })),
      purchase_orders: input.purchaseOrders
        .filter(order => order.quote_thread_id === member.quote_thread_id)
        .map(order => ({
          id: order.id,
          po_number: order.po_number,
          po_value: order.po_value,
        })),
      pdf_snapshots: input.pdfSnapshots.filter(snapshot => threadVersionIds.has(snapshot.quote_id)),
    };
  });
}
