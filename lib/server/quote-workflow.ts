import pg from 'pg';
import { renderToStream } from '@react-pdf/renderer';
import { QuotePDF } from '@/lib/pdf/quote-pdf';
import { loadSquiresLogoDataUrl } from '@/lib/pdf/squires-logo';
import { getQuotesCustomersEmailConfig } from '@/lib/server/quotes-customers-email-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';
import { getHiddenSystemTestAccountIds } from '@/lib/server/system-test-accounts';
import type { Database } from '@/types/database';
import type { CustomerContactRow } from '@/lib/server/customer-contacts';
import { fetchQuoteSelectedSecondaryContacts } from '@/lib/server/quote-recipient-contacts';
import type { NotificationModuleKey } from '@/types/notifications';
import {
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  getInvoiceSummary,
  type InvoiceSummary,
} from '@/lib/utils/quote-workflow';

const { Client } = pg;
const QUOTE_NOTIFICATION_MODULE_KEY: NotificationModuleKey = 'quotes';

export type QuoteRow = Database['public']['Tables']['quotes']['Row'];
export type QuoteLineItemRow = Database['public']['Tables']['quote_line_items']['Row'];
export type QuoteAttachmentRow = Database['public']['Tables']['quote_attachments']['Row'];
export type QuoteInvoiceRow = Database['public']['Tables']['quote_invoices']['Row'];
export type QuoteInvoiceRequestRow = Database['public']['Tables']['quote_invoice_requests']['Row'];
export type QuoteInvoiceAllocationRow = Database['public']['Tables']['quote_invoice_allocations']['Row'];
export type QuoteManagerSeriesRow = Database['public']['Tables']['quote_manager_series']['Row'];
export type QuoteTimelineEventRow = Database['public']['Tables']['quote_timeline_events']['Row'];
export type QuoteCustomerContactRecipientRow = Database['public']['Tables']['quote_customer_contact_recipients']['Row'];
export type RamsDocumentRow = Database['public']['Tables']['rams_documents']['Row'];

export interface QuoteNotificationRecipientOption {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  team_id: string | null;
}

export type QuoteInvoiceNotificationType =
  | 'invoice_request'
  | 'invoice_added'
  | 'quote_sent_copy'
  | 'start_alert_copy';

export const QUOTE_INVOICE_NOTIFICATION_TYPES: QuoteInvoiceNotificationType[] = [
  'invoice_request',
  'invoice_added',
  'quote_sent_copy',
  'start_alert_copy',
];

export interface QuoteModuleSettings {
  default_start_alert_days: number | null;
  default_estimated_duration_days: number | null;
}

interface QuoteManagerOption {
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
    email?: string | null;
  } | null;
  approver?: {
    id: string;
    full_name: string | null;
    email?: string | null;
  } | null;
}

export interface QuoteBundle {
  quote: QuoteRow & {
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
      secondary_contacts?: CustomerContactRow[];
    } | null;
    selected_secondary_contact_ids?: string[];
    selected_secondary_contacts?: CustomerContactRow[];
  };
  lineItems: QuoteLineItemRow[];
  attachments: QuoteAttachmentRow[];
  ramsDocuments: RamsDocumentRow[];
  invoices: Array<QuoteInvoiceRow & { allocations: QuoteInvoiceAllocationRow[] }>;
  invoiceRequests: QuoteInvoiceRequestRow[];
  versions: QuoteRow[];
  timeline: Array<QuoteTimelineEventRow & { actor?: { id: string; full_name: string | null } | null }>;
  selectedSecondaryContacts: CustomerContactRow[];
  invoiceSummary: InvoiceSummary;
}

export async function appendQuoteTimelineEvent(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    quoteId: string;
    quoteThreadId: string;
    quoteReference: string;
    eventType: string;
    title: string;
    description?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    actorUserId?: string | null;
    createdAt?: string;
  }
) {
  const { error } = await supabase.from('quote_timeline_events').insert({
    quote_id: input.quoteId,
    quote_thread_id: input.quoteThreadId,
    quote_reference: input.quoteReference,
    event_type: input.eventType,
    title: input.title,
    description: input.description ?? null,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    actor_user_id: input.actorUserId ?? null,
    created_at: input.createdAt ?? new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to append quote timeline event:', error);
  }
}

function getConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for quote number generation');
  }
  return connectionString;
}

function createPgClient(): pg.Client {
  const url = new URL(getConnectionString());
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
}

export async function listQuoteManagerOptions(): Promise<QuoteManagerOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('quote_manager_series')
    .select(`
      *,
      profile:profiles!quote_manager_series_profile_id_fkey(id, full_name),
      approver:profiles!quote_manager_series_approver_profile_id_fkey(id, full_name)
    `)
    .order('initials');

  if (error) {
    throw error;
  }

  const hiddenIds = await getHiddenSystemTestAccountIds(admin);
  return ((data || []) as QuoteManagerOption[]).filter(
    (option) => !hiddenIds.has(option.profile_id) && (!option.approver_profile_id || !hiddenIds.has(option.approver_profile_id))
  );
}

export async function getQuoteManagerOption(profileId: string): Promise<QuoteManagerOption | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('quote_manager_series')
    .select(`
      *,
      profile:profiles!quote_manager_series_profile_id_fkey(id, full_name),
      approver:profiles!quote_manager_series_approver_profile_id_fkey(id, full_name)
    `)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as QuoteManagerOption | null) || null;
}

export async function generateQuoteReferenceForManager(params: {
  managerProfileId: string;
  fallbackInitials?: string | null;
}): Promise<{ quoteReference: string; initials: string }> {
  const admin = createAdminClient();
  const { data: config, error } = await admin
    .from('quote_manager_series')
    .select('*')
    .eq('profile_id', params.managerProfileId)
    .single();

  if (error || !config) {
    const fallbackInitials = (params.fallbackInitials || 'XX').toUpperCase().slice(0, 10);
    const legacyReference = await generateLegacyQuoteReference(fallbackInitials);
    return { quoteReference: legacyReference, initials: fallbackInitials };
  }

  const client = createPgClient();
  await client.connect();

  try {
    const result = await client.query<{ issued_number: number }>(
      `
      UPDATE quote_manager_series
      SET
        next_number = next_number + 1,
        updated_at = NOW()
      WHERE profile_id = $1
      RETURNING next_number - 1 AS issued_number
      `,
      [params.managerProfileId]
    );

    const issued = result.rows[0]?.issued_number;
    if (typeof issued !== 'number') {
      throw new Error('Failed to allocate manager quote number');
    }

    return {
      quoteReference: `${issued}-${config.initials}`,
      initials: config.initials,
    };
  } finally {
    await client.end();
  }
}

async function generateLegacyQuoteReference(initials: string): Promise<string> {
  const key = initials.toUpperCase().slice(0, 10);
  const client = createPgClient();
  await client.connect();

  try {
    const result = await client.query<{ issued_number: number }>(
      `
      WITH upsert AS (
        INSERT INTO quote_sequences (requester_initials, next_number)
        VALUES ($1, 6001)
        ON CONFLICT (requester_initials)
        DO UPDATE
        SET
          next_number = quote_sequences.next_number + 1,
          updated_at = NOW()
        RETURNING next_number
      )
      SELECT
        CASE
          WHEN next_number = 6001 THEN 6000
          ELSE next_number - 1
        END AS issued_number
      FROM upsert
      `,
      [key]
    );

    const issued = result.rows[0]?.issued_number;
    if (typeof issued !== 'number') {
      throw new Error('Failed to allocate quote sequence number');
    }

    return `${issued}-${key}`;
  } finally {
    await client.end();
  }
}

export function getInitialsFromName(fullName: string): string {
  const normalizedName = fullName.trim();
  if (!normalizedName) return 'XX';
  const parts = normalizedName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XX';
  return `${parts[0]?.[0] || ''}${parts[parts.length - 1]?.[0] || ''}`.toUpperCase();
}

export async function fetchQuoteBundle(supabase: ReturnType<typeof createAdminClient>, quoteId: string): Promise<QuoteBundle> {
  const { data: quote, error } = await supabase
    .from('quotes')
    .select(`
      *,
      customer:customers(
        id,
        company_name,
        short_name,
        contact_name,
        contact_email,
        address_line_1,
        address_line_2,
        city,
        county,
        postcode,
        secondary_contacts:customer_contacts(*)
      )
    `)
    .eq('id', quoteId)
    .single();

  if (error || !quote) {
    throw error || new Error('Quote not found');
  }

  const typedQuote = quote as QuoteBundle['quote'];

  const [lineItemsResult, attachmentsResult, ramsDocumentsResult, versionsResult, invoicesResult, invoiceRequestsResult, timelineResult, selectedContacts] = await Promise.all([
    supabase.from('quote_line_items').select('*').eq('quote_id', quoteId).order('sort_order', { ascending: true }),
    supabase.from('quote_attachments').select('*').eq('quote_id', quoteId).order('created_at', { ascending: false }),
    supabase.from('rams_documents').select('*').eq('quote_id', quoteId).order('created_at', { ascending: false }),
    supabase.from('quotes').select('*').eq('quote_thread_id', typedQuote.quote_thread_id).order('created_at', { ascending: false }),
    supabase.from('quote_invoices').select('*').eq('quote_id', quoteId).order('invoice_date', { ascending: false }),
    supabase.from('quote_invoice_requests').select('*').eq('quote_id', quoteId).order('requested_at', { ascending: false }),
    supabase
      .from('quote_timeline_events')
      .select(`
        *,
        actor:profiles!quote_timeline_events_actor_user_id_fkey(id, full_name)
      `)
      .eq('quote_thread_id', typedQuote.quote_thread_id)
      .order('created_at', { ascending: false }),
    fetchQuoteSelectedSecondaryContacts(supabase, quoteId),
  ]);

  if (lineItemsResult.error) throw lineItemsResult.error;
  if (attachmentsResult.error) throw attachmentsResult.error;
  if (ramsDocumentsResult.error) throw ramsDocumentsResult.error;
  if (versionsResult.error) throw versionsResult.error;
  if (invoicesResult.error) throw invoicesResult.error;
  if (invoiceRequestsResult.error) throw invoiceRequestsResult.error;
  if (timelineResult.error) throw timelineResult.error;

  const invoices = (invoicesResult.data || []) as QuoteInvoiceRow[];
  const invoiceRequests = (invoiceRequestsResult.data || []) as QuoteInvoiceRequestRow[];
  const invoiceIds = invoices.map(invoice => invoice.id);
  const allocationsByInvoice = new Map<string, QuoteInvoiceAllocationRow[]>();

  if (invoiceIds.length > 0) {
    const { data: allocations, error: allocationsError } = await supabase
      .from('quote_invoice_allocations')
      .select('*')
      .in('quote_invoice_id', invoiceIds);

    if (allocationsError) throw allocationsError;

    for (const allocation of (allocations || []) as QuoteInvoiceAllocationRow[]) {
      const list = allocationsByInvoice.get(allocation.quote_invoice_id) || [];
      list.push(allocation);
      allocationsByInvoice.set(allocation.quote_invoice_id, list);
    }
  }

  const invoiceSummary = getInvoiceSummary({
    total: Number(typedQuote.total || 0),
    invoices,
    invoiceRequests,
  });

  return {
    quote: {
      ...typedQuote,
      selected_secondary_contact_ids: selectedContacts.map(contact => contact.id),
      selected_secondary_contacts: selectedContacts,
    },
    lineItems: (lineItemsResult.data || []) as QuoteLineItemRow[],
    attachments: (attachmentsResult.data || []) as QuoteAttachmentRow[],
    ramsDocuments: (ramsDocumentsResult.data || []) as RamsDocumentRow[],
    versions: (versionsResult.data || []) as QuoteRow[],
    timeline: (timelineResult.data || []) as QuoteBundle['timeline'],
    selectedSecondaryContacts: selectedContacts,
    invoices: invoices.map(invoice => ({
      ...invoice,
      allocations: allocationsByInvoice.get(invoice.id) || [],
    })),
    invoiceRequests,
    invoiceSummary,
  };
}

interface EmailAttachment {
  filename: string;
  content: string;
}

async function sendEmail(params: {
  from?: string;
  to: string[];
  cc?: string[];
  replyTo?: string | null;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<{ success: boolean; error?: string }> {
  const { apiKey, fromEmail } = getQuotesCustomersEmailConfig();
  if (!apiKey) {
    return { success: false, error: 'Email service not configured' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from || fromEmail,
      to: params.to,
      cc: params.cc,
      reply_to: params.replyTo || undefined,
      subject: params.subject,
      html: params.html,
      attachments: params.attachments,
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    return { success: false, error: error.message || 'Failed to send email' };
  }

  return { success: true };
}

function getDefaultFromEmail(): string {
  return getQuotesCustomersEmailConfig().fromEmail;
}

function normalizeEmailAddress(value?: string | null): string | null {
  const email = value?.trim();
  return email && email.includes('@') ? email : null;
}

function uniqueEmailAddresses(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];

  values.forEach((value) => {
    const email = normalizeEmailAddress(value);
    if (!email) return;

    const key = email.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    emails.push(email);
  });

  return emails;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export async function renderQuotePdfAttachment(
  bundle: QuoteBundle,
  managerEmailOverride?: string | null
): Promise<EmailAttachment> {
  const logoSrc = await loadSquiresLogoDataUrl();
  const managerEmail = normalizeEmailAddress(managerEmailOverride) || bundle.quote.manager_email || '';

  const pdfDocument = QuotePDF({
    quoteReference: bundle.quote.quote_reference,
    baseQuoteReference: bundle.quote.base_quote_reference,
    quoteDate: bundle.quote.quote_date,
    attentionName: bundle.quote.attention_name || '',
    attentionEmail: bundle.quote.attention_email || '',
    salutation: bundle.quote.salutation || '',
    projectDescription: bundle.quote.project_description || '',
    subjectLine: bundle.quote.subject_line || '',
    scope: bundle.quote.scope || '',
    siteAddress: bundle.quote.site_address || '',
    managerEmail,
    lineItems: bundle.lineItems.map(item => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      unit_rate: Number(item.unit_rate),
      line_total: Number(item.line_total),
    })),
    total: Number(bundle.quote.total),
    pricingMode: bundle.quote.pricing_mode || 'itemized',
    validityDays: bundle.quote.validity_days || 30,
    signoffName: bundle.quote.signoff_name || '',
    signoffTitle: bundle.quote.signoff_title || '',
    versionLabel: bundle.quote.version_label || buildVersionLabel(bundle.quote.revision_type, bundle.quote.revision_number),
    customFooterText: bundle.quote.custom_footer_text || undefined,
    logoSrc,
  });

  const stream = await renderToStream(pdfDocument);
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return {
    filename: `Quote_${bundle.quote.quote_reference.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`,
    content: Buffer.concat(chunks).toString('base64'),
  };
}

async function renderClientVisibleQuoteAttachments(bundle: QuoteBundle): Promise<EmailAttachment[]> {
  const admin = createAdminClient();
  const clientVisibleAttachments = bundle.attachments.filter(attachment => attachment.is_client_visible);

  const attachments = await Promise.all(clientVisibleAttachments.map(async (attachment) => {
    const { data, error } = await admin.storage
      .from('quote-attachments')
      .download(attachment.file_path);

    if (error || !data) {
      throw error || new Error(`Unable to download attachment ${attachment.file_name}`);
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return {
      filename: attachment.file_name,
      content: buffer.toString('base64'),
    };
  }));

  return attachments;
}

export async function sendQuoteToCustomerEmail(
  bundle: QuoteBundle,
  cc: string[],
  senderEmail?: string | null
) {
  const replyToEmail = normalizeEmailAddress(senderEmail) || normalizeEmailAddress(bundle.quote.manager_email);
  const quotePdfAttachment = await renderQuotePdfAttachment(bundle, replyToEmail);
  const clientAttachments = await renderClientVisibleQuoteAttachments(bundle);
  const customerEmail = bundle.quote.attention_email?.trim() || bundle.quote.customer?.contact_email?.trim() || '';
  if (!customerEmail) {
    return { success: false, error: 'Quote cannot be sent because the customer does not have a contact email.' };
  }
  const customerCcEmails = bundle.selectedSecondaryContacts.map(contact => contact.email);
  const ccEmails = uniqueEmailAddresses([
    ...customerCcEmails,
    ...cc,
  ]).filter(email => email.toLowerCase() !== customerEmail.toLowerCase());

  const customerName = bundle.quote.attention_name || bundle.quote.customer?.contact_name || 'there';
  const subject = `Quotation ${bundle.quote.quote_reference} - ${bundle.quote.subject_line || bundle.quote.customer?.company_name || 'A&V Squires'}`;
  const pricingCopy = bundle.quote.pricing_mode === 'attachments_only'
    ? '<p>Pricing and supporting details are included in the attached documents.</p>'
    : '';
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Quotation ${bundle.quote.quote_reference}</h2>
        <p>Hello ${customerName},</p>
        <p>Please find attached our quotation for <strong>${bundle.quote.subject_line || 'the requested works'}</strong>.</p>
        ${pricingCopy}
        <p>If you have any queries, please reply to this email and we will be happy to help.</p>
        <p>Kind regards,<br>${bundle.quote.signoff_name || 'A&V Squires'}${bundle.quote.signoff_title ? `<br>${bundle.quote.signoff_title}` : ''}</p>
      </body>
    </html>
  `;

  return sendEmail({
    from: getDefaultFromEmail(),
    to: [customerEmail],
    cc: ccEmails,
    subject,
    html,
    replyTo: replyToEmail,
    attachments: [quotePdfAttachment, ...clientAttachments],
  });
}

export async function sendQuoteApprovalRequestEmail(params: {
  approverEmail: string;
  managerName: string;
  quoteReference: string;
  customerName: string;
  subjectLine: string;
}) {
  return sendEmail({
    to: [params.approverEmail],
    subject: `Quote approval required: ${params.quoteReference}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
          <h2>Quote approval required</h2>
          <p>${params.managerName} has submitted quote <strong>${params.quoteReference}</strong> for approval.</p>
          <p><strong>Customer:</strong> ${params.customerName}</p>
          <p><strong>Scope:</strong> ${params.subjectLine}</p>
        </body>
      </html>
    `,
  });
}

export async function sendQuoteRamsRequestEmail(params: {
  quoteReference: string;
  customerName: string;
  subjectLine: string;
  scope?: string | null;
  poNumber: string;
  managerName: string;
  internalNotes?: string | null;
  completionComments?: string | null;
  siteAddress?: string | null;
  startDate?: string | null;
  estimatedDurationDays?: number | null;
  ramsComments?: string | null;
}) {
  return sendEmail({
    to: ['conway@avsquires.co.uk'],
    subject: `RAMS required for ${params.quoteReference}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
          <h2>RAMS requested</h2>
          <p>The following job now requires RAMS to be produced.</p>
          <p><strong>Quote:</strong> ${params.quoteReference}</p>
          <p><strong>Customer:</strong> ${params.customerName}</p>
          <p><strong>PO Number:</strong> ${params.poNumber}</p>
          <p><strong>Title:</strong> ${params.subjectLine}</p>
          ${params.scope ? `<p><strong>Scope:</strong><br>${params.scope.replace(/\n/g, '<br>')}</p>` : ''}
          <p><strong>Manager:</strong> ${params.managerName}</p>
          ${params.siteAddress ? `<p><strong>Site Address:</strong><br>${params.siteAddress.replace(/\n/g, '<br>')}</p>` : ''}
          ${params.startDate ? `<p><strong>Start Date:</strong> ${params.startDate}</p>` : ''}
          ${params.estimatedDurationDays !== null && typeof params.estimatedDurationDays !== 'undefined' ? `<p><strong>Estimated Duration:</strong> ${params.estimatedDurationDays} day(s)</p>` : ''}
          ${params.internalNotes ? `<p><strong>Internal Notes:</strong><br>${params.internalNotes.replace(/\n/g, '<br>')}</p>` : ''}
          ${params.completionComments ? `<p><strong>Completion Notes:</strong><br>${params.completionComments.replace(/\n/g, '<br>')}</p>` : ''}
          ${params.ramsComments ? `<p><strong>Additional RAMS Comments:</strong><br>${params.ramsComments.replace(/\n/g, '<br>')}</p>` : ''}
        </body>
      </html>
    `,
  });
}

export async function sendQuoteStartAlertEmail(params: {
  to: string;
  managerName: string;
  quoteReference: string;
  customerName: string;
  subjectLine: string;
  startDate: string;
}) {
  return sendEmail({
    to: [params.to],
    subject: `Upcoming job start: ${params.quoteReference}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
          <h2>Job start reminder</h2>
          <p>Hello ${params.managerName},</p>
          <p>This is a reminder that quote <strong>${params.quoteReference}</strong> is due to start on <strong>${params.startDate}</strong>.</p>
          <p><strong>Customer:</strong> ${params.customerName}</p>
          <p><strong>Scope:</strong> ${params.subjectLine}</p>
        </body>
      </html>
    `,
  });
}

export async function createQuoteNotification(params: {
  senderId: string;
  recipientIds: string[];
  subject: string;
  body: string;
  createdVia?: string;
  moduleKey?: NotificationModuleKey;
  sendEmail?: boolean;
}) {
  const recipientIds = Array.from(new Set(params.recipientIds.filter(Boolean)));
  if (recipientIds.length === 0) {
    return;
  }

  const admin = createAdminClient();
  const moduleKey = params.moduleKey || QUOTE_NOTIFICATION_MODULE_KEY;
  const { data: preferences, error: preferenceError } = await admin
    .from('notification_preferences')
    .select('user_id, enabled, notify_in_app, notify_email')
    .eq('module_key', moduleKey)
    .in('user_id', recipientIds);

  if (preferenceError) {
    throw preferenceError;
  }

  const preferenceByUserId = new Map((preferences || []).map(preference => [preference.user_id, preference]));
  const shouldNotifyInApp = (recipientId: string) => {
    const preference = preferenceByUserId.get(recipientId);
    return preference?.enabled !== false && preference?.notify_in_app !== false;
  };
  const shouldNotifyByEmail = (recipientId: string) => {
    const preference = preferenceByUserId.get(recipientId);
    return preference?.enabled !== false && preference?.notify_email !== false;
  };

  const inAppRecipientIds = recipientIds.filter(shouldNotifyInApp);
  if (inAppRecipientIds.length > 0) {
    const { data: message, error: messageError } = await admin
      .from('messages')
      .insert({
        type: 'NOTIFICATION',
        priority: 'HIGH',
        subject: params.subject,
        body: params.body,
        sender_id: params.senderId,
        created_via: params.createdVia || 'quote_invoice_workflow',
      })
      .select()
      .single();

    if (messageError || !message) {
      throw messageError || new Error('Failed to create notification');
    }

    const { error: recipientsError } = await admin
      .from('message_recipients')
      .insert(inAppRecipientIds.map(recipientId => ({
        message_id: message.id,
        user_id: recipientId,
        status: 'PENDING',
      })));

    if (recipientsError) {
      throw recipientsError;
    }
  }

  if (!params.sendEmail) {
    return;
  }

  const emailRecipientIds = recipientIds.filter(shouldNotifyByEmail);
  if (emailRecipientIds.length === 0) {
    return;
  }

  const emails = await Promise.all(emailRecipientIds.map(async recipientId => {
    const { data } = await admin.auth.admin.getUserById(recipientId);
    return normalizeEmailAddress(data.user?.email);
  }));

  const emailTo = Array.from(new Set(emails.filter((email): email is string => Boolean(email))));
  if (emailTo.length === 0) {
    return;
  }

  const emailResult = await sendEmail({
    to: emailTo,
    subject: params.subject,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
          <h2>${escapeHtml(params.subject)}</h2>
          <p>${plainTextToHtml(params.body)}</p>
        </body>
      </html>
    `,
  });

  if (!emailResult.success) {
    console.error('Failed to send quote notification email:', emailResult.error || 'Unknown email error');
  }
}

export async function listQuoteNotificationRecipientOptions(
  supabase: ReturnType<typeof createAdminClient>,
  teamFilter: 'accounts' | 'additional' | 'all' = 'all'
): Promise<QuoteNotificationRecipientOption[]> {
  const quoteUserIds = Array.from(await getUsersWithModuleAccess('quotes', undefined, supabase));
  if (quoteUserIds.length === 0) {
    return [];
  }

  const hiddenIds = await getHiddenSystemTestAccountIds(supabase);
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, employee_id, team_id')
    .in('id', quoteUserIds)
    .order('full_name', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data || []) as QuoteNotificationRecipientOption[])
    .filter(profile => !hiddenIds.has(profile.id))
    .filter(profile => {
      if (teamFilter === 'all') return true;
      return teamFilter === 'accounts' ? profile.team_id === 'accounts' : profile.team_id !== 'accounts';
    });
}

export async function listQuoteAccountsNotificationRecipientOptions(
  supabase: ReturnType<typeof createAdminClient>
): Promise<QuoteNotificationRecipientOption[]> {
  return listQuoteNotificationRecipientOptions(supabase, 'accounts');
}

export async function listQuoteAdditionalNotificationRecipientOptions(
  supabase: ReturnType<typeof createAdminClient>
): Promise<QuoteNotificationRecipientOption[]> {
  return listQuoteNotificationRecipientOptions(supabase, 'additional');
}

export async function listQuoteUserNotificationRecipientOptions(
  supabase: ReturnType<typeof createAdminClient>
): Promise<QuoteNotificationRecipientOption[]> {
  return listQuoteNotificationRecipientOptions(supabase, 'all');
}

export async function replaceQuoteNotificationRecipients(
  supabase: ReturnType<typeof createAdminClient>,
  selections: Partial<Record<QuoteInvoiceNotificationType, string[]>>,
  actorUserId: string
) {
  const notificationTypes = QUOTE_INVOICE_NOTIFICATION_TYPES.filter(type => Object.prototype.hasOwnProperty.call(selections, type));
  if (notificationTypes.length === 0) return;

  const rows = notificationTypes.flatMap(notificationType => {
    const profileIds = Array.from(new Set((selections[notificationType] || []).filter(Boolean)));
    return profileIds.map(profileId => ({
      profile_id: profileId,
      notification_type: notificationType,
      created_by: actorUserId,
      updated_by: actorUserId,
    }));
  });

  const { error: deleteError } = await supabase
    .from('quote_invoice_notification_recipients')
    .delete()
    .in('notification_type', notificationTypes);

  if (deleteError) throw deleteError;

  if (rows.length === 0) return;

  const { error: insertError } = await supabase
    .from('quote_invoice_notification_recipients')
    .insert(rows);

  if (insertError) throw insertError;
}

export async function getSelectedQuoteInvoiceNotificationRecipientIds(
  supabase: ReturnType<typeof createAdminClient>,
  notificationType?: QuoteInvoiceNotificationType
): Promise<Record<QuoteInvoiceNotificationType, string[]> | string[]> {
  let query = supabase
    .from('quote_invoice_notification_recipients')
    .select('profile_id, notification_type');

  if (notificationType) {
    query = query.eq('notification_type', notificationType);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  if (notificationType) {
    return (data || []).map(row => row.profile_id);
  }

  const selections: Record<QuoteInvoiceNotificationType, string[]> = {
    invoice_request: [],
    invoice_added: [],
    quote_sent_copy: [],
    start_alert_copy: [],
  };

  for (const row of data || []) {
    const notificationType = (row.notification_type || 'invoice_request') as QuoteInvoiceNotificationType;
    if (QUOTE_INVOICE_NOTIFICATION_TYPES.includes(notificationType)) {
      selections[notificationType].push(row.profile_id);
    }
  }

  return selections;
}

export async function getQuoteInvoiceNotificationRecipientIds(
  supabase: ReturnType<typeof createAdminClient>,
  notificationType: QuoteInvoiceNotificationType,
  excludeUserIds: Array<string | null | undefined> = []
): Promise<string[]> {
  const [accountsRecipients, additionalRecipients, selectedRecipientIds] = await Promise.all([
    listQuoteAccountsNotificationRecipientOptions(supabase),
    listQuoteAdditionalNotificationRecipientOptions(supabase),
    getSelectedQuoteInvoiceNotificationRecipientIds(supabase, notificationType),
  ]);

  const eligibleIds = new Set([...accountsRecipients, ...additionalRecipients].map(profile => profile.id));
  const excludedIds = new Set(excludeUserIds.filter((id): id is string => Boolean(id)));

  return (selectedRecipientIds as string[])
    .filter(profileId => eligibleIds.has(profileId))
    .filter(profileId => !excludedIds.has(profileId));
}

export async function getQuoteNotificationRecipientEmails(
  supabase: ReturnType<typeof createAdminClient>,
  notificationType: QuoteInvoiceNotificationType,
  excludeUserIds: Array<string | null | undefined> = []
): Promise<string[]> {
  const recipientIds = await getQuoteInvoiceNotificationRecipientIds(supabase, notificationType, excludeUserIds);
  const emails = await Promise.all(recipientIds.map(async recipientId => {
    const { data } = await supabase.auth.admin.getUserById(recipientId);
    return normalizeEmailAddress(data.user?.email);
  }));

  return Array.from(new Set(emails.filter((email): email is string => Boolean(email))));
}

export async function getQuoteAccountsRecipientIds(
  supabase: ReturnType<typeof createAdminClient>,
  excludeUserId?: string | null
): Promise<string[]> {
  return getQuoteInvoiceNotificationRecipientIds(supabase, 'invoice_request', [excludeUserId]);
}

export async function loadQuoteModuleSettings(
  supabase: ReturnType<typeof createAdminClient>
): Promise<QuoteModuleSettings> {
  const { data, error } = await supabase
    .from('quote_module_settings')
    .select('default_start_alert_days, default_estimated_duration_days')
    .eq('id', true)
    .maybeSingle();

  if (error) throw error;

  return {
    default_start_alert_days: data?.default_start_alert_days ?? null,
    default_estimated_duration_days: data?.default_estimated_duration_days ?? null,
  };
}

export async function upsertQuoteModuleSettings(
  supabase: ReturnType<typeof createAdminClient>,
  settings: QuoteModuleSettings,
  actorUserId: string
): Promise<QuoteModuleSettings> {
  const { data, error } = await supabase
    .from('quote_module_settings')
    .upsert({
      id: true,
      default_start_alert_days: settings.default_start_alert_days,
      default_estimated_duration_days: settings.default_estimated_duration_days,
      updated_by: actorUserId,
    })
    .select('default_start_alert_days, default_estimated_duration_days')
    .single();

  if (error) throw error;

  return {
    default_start_alert_days: data.default_start_alert_days ?? null,
    default_estimated_duration_days: data.default_estimated_duration_days ?? null,
  };
}

export {
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  getInvoiceSummary,
};
