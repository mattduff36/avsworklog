import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  calculateQuoteTotals,
  getQuoteManagerOption,
} from '@/lib/server/quote-workflow';
import type { Database, Json } from '@/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;
type ProjectRow = Database['public']['Tables']['quote_project_numbers']['Row'];
type ProjectCostRow = Database['public']['Tables']['quote_project_costs']['Row'];

interface ProjectWithCosts extends ProjectRow {
  costs?: ProjectCostRow[];
}

interface CustomerRow {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  default_validity_days: number | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
}

interface ConversionLineItem {
  id: string;
  cost_id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_rate: number;
  line_total: number;
  sort_order: number;
}

export interface ProjectNumberConversionResult extends Record<string, unknown> {
  project: ProjectRow;
  projects: ProjectRow[];
  quote_id: string;
  aliases: string[];
}

export interface ProjectNumberConversionFieldErrors extends Record<string, unknown> {
  fieldErrors: Record<string, string>;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0
  ))));
}

function buildAddress(customer: {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string | null;
} | null): string {
  if (!customer) return '';
  return [
    customer.address_line_1,
    customer.address_line_2,
    [customer.city, customer.county].filter(Boolean).join(', ') || null,
    customer.postcode,
  ].filter(Boolean).join('\n');
}

function buildLineItems(
  selectedCosts: ProjectCostRow[],
  projectsById: Map<string, ProjectWithCosts>,
): ConversionLineItem[] {
  return selectedCosts.map((cost, index) => {
    const sourceReference = projectsById.get(cost.project_number_id)?.project_reference || 'Project';
    const amount = Number(cost.amount || 0);
    return {
      id: crypto.randomUUID(),
      cost_id: cost.id,
      description: `[${sourceReference}] ${cost.description}`,
      quantity: 1,
      unit: cost.category,
      unit_rate: amount,
      line_total: amount,
      sort_order: index,
    };
  });
}

export async function convertProjectNumbersToQuote(
  admin: AdminClient,
  body: Record<string, unknown>,
  userId: string,
): Promise<ProjectNumberConversionResult | ProjectNumberConversionFieldErrors> {
  const fallbackProjectId = normalizeOptionalString(body.project_number_id);
  const projectNumberIds = normalizeIdList(body.project_number_ids);
  if (projectNumberIds.length === 0 && fallbackProjectId) {
    projectNumberIds.push(fallbackProjectId);
  }

  const survivorProjectNumberId = normalizeOptionalString(body.survivor_project_number_id)
    || fallbackProjectId
    || projectNumberIds[0]
    || null;
  const customerId = normalizeOptionalString(body.customer_id);
  const siteAddress = normalizeOptionalString(body.site_address);
  const fieldErrors: Record<string, string> = {};

  if (projectNumberIds.length === 0) {
    fieldErrors.project_number_ids = 'Select at least one project number.';
  }
  if (!survivorProjectNumberId || !projectNumberIds.includes(survivorProjectNumberId)) {
    fieldErrors.survivor_project_number_id = 'Choose which selected project number to keep.';
  }
  if (!customerId) fieldErrors.customer_id = 'Select a customer.';
  if (!siteAddress) fieldErrors.site_address = 'Enter the site address.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const { data: projectData, error: projectError } = await admin
    .from('quote_project_numbers')
    .select('*, costs:quote_project_costs(*)')
    .in('id', projectNumberIds);
  if (projectError) throw projectError;

  const projects = (projectData || []) as ProjectWithCosts[];
  if (projects.length !== projectNumberIds.length) {
    return { fieldErrors: { project_number_ids: 'One or more selected project numbers no longer exist.' } };
  }
  if (projects.some(project => project.status !== 'open')) {
    return { fieldErrors: { project_number_ids: 'All selected project numbers must still be open.' } };
  }

  const survivor = projects.find(project => project.id === survivorProjectNumberId);
  if (!survivor) {
    return { fieldErrors: { survivor_project_number_id: 'Choose which selected project number to keep.' } };
  }

  const projectsById = new Map(projects.map(project => [project.id, project]));
  const availableCosts = projects.flatMap(project => (
    (project.costs || []).filter(cost => !cost.linked_quote_id)
  ));
  const requestedCostIds = normalizeIdList(body.cost_ids);
  const selectedCosts = requestedCostIds.length > 0
    ? availableCosts.filter(cost => requestedCostIds.includes(cost.id))
    : availableCosts;

  if (selectedCosts.length === 0) {
    return { fieldErrors: { cost_ids: 'Select at least one unlinked project cost.' } };
  }
  if (requestedCostIds.length > 0 && selectedCosts.length !== requestedCostIds.length) {
    return { fieldErrors: { cost_ids: 'One or more selected costs are invalid or already linked.' } };
  }

  const [
    { data: customerData, error: customerError },
    { data: managerData, error: managerError },
    managerOption,
  ] = await Promise.all([
    admin.from('customers').select('*').eq('id', customerId).single(),
    admin.from('profiles').select('id, full_name').eq('id', survivor.manager_profile_id).single(),
    getQuoteManagerOption(survivor.manager_profile_id),
  ]);
  if (customerError || !customerData) throw customerError || new Error('Unable to load customer');
  if (managerError || !managerData) throw managerError || new Error('Unable to load manager profile');

  const customer = customerData as CustomerRow & {
    address_line_1?: string | null;
    address_line_2?: string | null;
    city?: string | null;
    county?: string | null;
    postcode?: string | null;
  };
  const manager = managerData as ProfileRow;
  const quoteId = crypto.randomUUID();
  const lineItems = buildLineItems(selectedCosts, projectsById);
  const totals = calculateQuoteTotals(lineItems);
  const today = new Date().toISOString().slice(0, 10);
  const subjectLine = normalizeOptionalString(body.subject_line) || survivor.title;
  const summary = normalizeOptionalString(body.project_description)
    || survivor.description
    || `Costs converted from project number ${survivor.project_reference}.`;
  const scope = normalizeOptionalString(body.scope)
    || selectedCosts.map(cost => `- ${cost.description}`).join('\n');

  const quotePayload: Json = {
    id: quoteId,
    quote_reference: survivor.project_reference,
    base_quote_reference: survivor.project_reference,
    customer_id: customerId,
    quote_date: normalizeOptionalString(body.quote_date) || today,
    attention_name: normalizeOptionalString(body.attention_name)
      || customer.contact_name
      || customer.company_name,
    attention_email: normalizeOptionalString(body.attention_email)
      || customer.contact_email
      || '',
    site_address: siteAddress || buildAddress(customer),
    subject_line: subjectLine,
    project_description: summary,
    scope,
    salutation: customer.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : '',
    validity_days: Number(body.validity_days || customer.default_validity_days || 30),
    subtotal: totals.subtotal,
    total: totals.total,
    manager_name: managerOption?.profile?.full_name
      || managerOption?.signoff_name
      || manager.full_name,
    manager_email: managerOption?.manager_email || null,
    approver_profile_id: managerOption?.approver_profile_id || survivor.manager_profile_id,
    signoff_name: managerOption?.signoff_name || manager.full_name,
    signoff_title: managerOption?.signoff_title || null,
  };

  const { error: rpcError } = await admin.rpc('convert_quote_project_numbers', {
    p_project_number_ids: projectNumberIds,
    p_survivor_project_number_id: survivor.id,
    p_cost_ids: selectedCosts.map(cost => cost.id),
    p_quote: quotePayload,
    p_line_items: lineItems,
    p_actor_user_id: userId,
  });
  if (rpcError) throw rpcError;

  const convertedAt = new Date().toISOString();
  const rows: ProjectRow[] = projects.map((project) => {
    const row = { ...project };
    delete row.costs;
    return {
      ...row,
      status: project.id === survivor.id ? 'converted' : 'merged',
      converted_quote_id: quoteId,
      converted_at: convertedAt,
      merged_into_project_number_id: project.id === survivor.id ? null : survivor.id,
      merged_at: project.id === survivor.id ? null : convertedAt,
      updated_by: userId,
    };
  });
  const updatedSurvivor = rows.find(project => project.id === survivor.id);
  if (!updatedSurvivor) throw new Error('Retained project number was not selected.');

  return {
    project: updatedSurvivor,
    projects: rows,
    quote_id: quoteId,
    aliases: projects
      .filter(project => project.id !== survivor.id)
      .map(project => project.project_reference),
  };
}

const PROJECT_CONVERSION_CONFLICT_MESSAGES = [
  'must still be open',
  'already used by a live quote',
  'invalid or already linked',
  'no longer exist',
];

export function getProjectConversionConflictMessage(error: unknown): string | null {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : '';
  return PROJECT_CONVERSION_CONFLICT_MESSAGES.some(fragment => message.includes(fragment))
    ? message
    : null;
}
