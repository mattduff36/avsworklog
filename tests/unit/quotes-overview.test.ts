import { describe, expect, it } from 'vitest';
import {
  buildAllocatedLabourRows,
  buildOverviewRecords,
  buildOverviewSummary,
  buildOverviewQuoteIds,
  buildQuoteLevelInvoiceFallback,
  getLatestLabourActivityDate,
  type LabourEntrySourceRow,
  type LabourJobCodeSourceRow,
  type LabourTimesheetSource,
  type OverviewSummaryRecord,
  type ProjectSourceRow,
} from '@/lib/server/quotes-overview';
import type { QuoteOverviewInvoice, QuoteOverviewItem } from '@/app/(dashboard)/quotes/overview-types';

function createEntry(
  id: string,
  status: LabourTimesheetSource['status'],
  dailyTotal: number,
  dayOfWeek = 1
): LabourEntrySourceRow {
  return {
    id,
    daily_total: dailyTotal,
    day_of_week: dayOfWeek,
    time_started: '08:00',
    time_finished: '16:00',
    remarks: null,
    job_number: null,
    operator_travel_hours: null,
    operator_yard_hours: null,
    operator_working_hours: null,
    machine_travel_hours: null,
    machine_start_time: null,
    machine_finish_time: null,
    machine_working_hours: null,
    machine_standing_hours: null,
    machine_operator_hours: null,
    maintenance_breakdown_hours: null,
    timesheet: {
      id: `timesheet-${id}`,
      week_ending: '2026-06-21',
      status,
      timesheet_type: 'civils',
      reg_number: null,
      site_address: null,
      hirer_name: null,
      is_hired_plant: null,
      hired_plant_id_serial: null,
      hired_plant_description: null,
      hired_plant_hiring_company: null,
      user_id: `user-${id}`,
      profile: {
        id: `user-${id}`,
        full_name: `User ${id}`,
        employee_id: `E-${id}`,
      },
    },
  };
}

function createJobCodes(entryId: string, jobNumbers: string[]): LabourJobCodeSourceRow[] {
  return jobNumbers.map((jobNumber, index) => ({
    timesheet_entry_id: entryId,
    job_number: jobNumber,
    display_order: index,
  }));
}

function createItem(reference: string): QuoteOverviewItem {
  return {
    id: reference,
    kind: 'quote',
    reference,
    title: 'Drainage works',
    customer_name: 'Acme Ltd',
    contact_name: null,
    manager_name: 'Manager',
    status: 'in_progress',
    commercial_status: 'open',
    quote_id: 'quote-1',
    project_number_id: null,
    quote_total: 1000,
    manual_cost_total: 0,
    invoice_total: 0,
    invoice_count: 0,
    worked_hours: 0,
    employee_count: 0,
    timesheet_count: 0,
    latest_activity_at: '2026-06-14',
    href: `/quotes/overview/${reference}`,
  };
}

describe('quotes overview labour allocation', () => {
  it('includes all non-rejected timesheet statuses', () => {
    const statuses: LabourTimesheetSource['status'][] = [
      'draft',
      'submitted',
      'approved',
      'processed',
      'adjusted',
      'rejected',
      null,
    ];
    const entries = statuses.map((status, index) => createEntry(`entry-${index}`, status, 1));
    const jobCodes = entries.flatMap(entry => createJobCodes(entry.id, ['01234-MD']));

    const rowsByReference = buildAllocatedLabourRows(entries, jobCodes, ['01234-MD']);
    const rows = rowsByReference.get('01234-MD') || [];

    expect(rows).toHaveLength(6);
    expect(rows.reduce((sum, row) => sum + row.allocated_hours, 0)).toBe(6);
    expect(rows.some(row => row.timesheet_status === 'rejected')).toBe(false);
  });

  it('splits a multi-job entry evenly across all selected job codes', () => {
    const entries = [createEntry('entry-1', 'approved', 10)];
    const jobCodes = createJobCodes('entry-1', ['01234-MD', '05678-JS']);

    const rowsByReference = buildAllocatedLabourRows(entries, jobCodes, ['01234-MD', '05678-JS']);

    expect(rowsByReference.get('01234-MD')?.[0]?.allocated_hours).toBe(5);
    expect(rowsByReference.get('05678-JS')?.[0]?.allocated_hours).toBe(5);
  });
});

describe('quotes overview merged project aliases', () => {
  function createProject(
    id: string,
    reference: string,
    amount: number,
    mergedIntoProjectNumberId: string | null,
  ): ProjectSourceRow {
    return {
      id,
      project_reference: reference,
      manager_profile_id: 'manager-1',
      requester_initials: 'MD',
      title: `${reference} works`,
      description: null,
      status: mergedIntoProjectNumberId ? 'merged' : 'converted',
      linked_quote_id: null,
      linked_at: null,
      converted_quote_id: 'quote-1',
      converted_at: '2026-07-27T10:00:00.000Z',
      cancelled_at: null,
      merged_into_project_number_id: mergedIntoProjectNumberId,
      merged_at: mergedIntoProjectNumberId ? '2026-07-27T10:00:00.000Z' : null,
      notes: null,
      created_by: 'user-1',
      updated_by: 'user-1',
      created_at: '2026-07-20T10:00:00.000Z',
      updated_at: '2026-07-27T10:00:00.000Z',
      costs: [{
        id: `cost-${id}`,
        project_number_id: id,
        cost_date: '2026-07-20',
        category: 'materials',
        supplier: null,
        description: 'Materials',
        amount,
        notes: null,
        linked_quote_id: 'quote-1',
        linked_quote_line_item_id: `line-${id}`,
        linked_at: '2026-07-27T10:00:00.000Z',
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: '2026-07-20T10:00:00.000Z',
        updated_at: '2026-07-27T10:00:00.000Z',
      }],
    };
  }

  it('folds merged aliases and their costs into the survivor record', () => {
    const records = buildOverviewRecords({
      quotes: [],
      projects: [
        createProject('project-1', '60001-MD', 100, null),
        createProject('project-2', '60002-LC', 50, 'project-1'),
      ],
      invoicesByQuoteId: new Map(),
      labourRowsByReference: new Map(),
    });

    expect(records).toHaveLength(1);
    expect(records[0].item.reference).toBe('60001-MD');
    expect(records[0].sourceReferences).toEqual(['60001-MD', '60002-LC']);
    expect(records[0].item.manual_cost_total).toBe(150);
  });
});

describe('quotes overview summary', () => {
  it('uses the newest matched timesheet entry date as labour activity', () => {
    const rowsByReference = buildAllocatedLabourRows(
      [
        createEntry('old-entry', 'approved', 8, 1),
        createEntry('new-entry', 'approved', 8, 5),
      ],
      [
        ...createJobCodes('old-entry', ['01234-MD']),
        ...createJobCodes('new-entry', ['01234-MD']),
      ],
      ['01234-MD']
    );

    expect(getLatestLabourActivityDate(rowsByReference.get('01234-MD') || [])).toBe('2026-06-19');
  });

  it('joins the 50008-LC invoice row to the stats-card summary without uppercasing quote IDs', () => {
    const quoteId = '8f1c2a4b-1234-4abc-9def-123456789abc';
    const quoteIds = buildOverviewQuoteIds(quoteId);
    const item = {
      ...createItem('50008-LC'),
      id: quoteId,
      quote_id: quoteId,
      quote_total: 1300,
    };
    const records: OverviewSummaryRecord[] = [{
      item,
      sourceReferences: ['50008-LC'],
      quoteIds,
    }];
    const invoicesByQuoteId = new Map<string, QuoteOverviewInvoice[]>([
      [quoteId, [
        {
          id: 'invoice-34376',
          quote_id: quoteId,
          invoice_number: '34376',
          invoice_date: '2026-05-31',
          amount: 1300,
          invoice_scope: 'full',
          comments: null,
          created_at: '2026-06-10T09:00:00.000Z',
        },
      ]],
    ]);

    const summary = buildOverviewSummary({
      records,
      invoicesByQuoteId,
      labourRowsByReference: new Map(),
      dateRange: { from: '2026-05-15', to: '2026-06-14' },
    });

    expect(quoteIds).toEqual([quoteId]);
    expect(summary.invoice_count).toBe(1);
    expect(summary.invoice_total).toBe(1300);
  });

  it('builds a fallback invoice from timestamped quote-level invoice details', () => {
    const fallbackInvoice = buildQuoteLevelInvoiceFallback({
      id: 'quote-1',
      invoice_number: ' INV-LEGACY ',
      last_invoice_at: '2026-05-30T00:00:00.000Z',
      invoiced_at: '2026-06-10T12:30:00.000Z',
      total: 750,
    });

    expect(fallbackInvoice).toEqual({
      id: 'quote-level-quote-1',
      quote_id: 'quote-1',
      invoice_number: 'INV-LEGACY',
      invoice_date: '2026-05-30',
      amount: 750,
      invoice_scope: 'full',
      comments: null,
      created_at: '2026-06-10T12:30:00.000Z',
    });
  });

  it('includes quote-level fallback invoices in the stats-card summary fields', () => {
    const item = createItem('01234-MD');
    const records: OverviewSummaryRecord[] = [{
      item,
      sourceReferences: ['01234-MD'],
      quoteIds: ['quote-1'],
    }];
    const fallbackInvoice = buildQuoteLevelInvoiceFallback({
      id: 'quote-1',
      invoice_number: 'INV-LEGACY',
      last_invoice_at: '2026-05-30T00:00:00.000Z',
      invoiced_at: '2026-06-10T12:30:00.000Z',
      total: 750,
    });
    expect(fallbackInvoice).not.toBeNull();

    const summary = buildOverviewSummary({
      records,
      invoicesByQuoteId: new Map([['quote-1', fallbackInvoice ? [fallbackInvoice] : []]]),
      labourRowsByReference: new Map(),
      dateRange: { from: '2026-05-15', to: '2026-06-14' },
    });

    expect(summary.invoice_count).toBe(1);
    expect(summary.invoice_total).toBe(750);
  });

  it('uses the accounts-added timestamp when calculating date-range invoice totals', () => {
    const item = createItem('01234-MD');
    const records: OverviewSummaryRecord[] = [{
      item,
      sourceReferences: ['01234-MD'],
      quoteIds: ['quote-1'],
    }];
    const invoicesByQuoteId = new Map<string, QuoteOverviewInvoice[]>([
      ['quote-1', [
        {
          id: 'invoice-1',
          quote_id: 'quote-1',
          invoice_number: 'INV-001',
          invoice_date: '2026-05-30',
          amount: 100,
          invoice_scope: 'partial',
          comments: null,
          created_at: '2026-06-10T12:30:00.000Z',
        },
        {
          id: 'invoice-2',
          quote_id: 'quote-1',
          invoice_number: 'INV-002',
          invoice_date: '2026-06-15',
          amount: 250,
          invoice_scope: 'partial',
          comments: null,
          created_at: '2026-07-01T09:00:00.000Z',
        },
      ]],
    ]);

    const summary = buildOverviewSummary({
      records,
      invoicesByQuoteId,
      labourRowsByReference: new Map(),
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
    });

    expect(summary.invoice_count).toBe(1);
    expect(summary.invoice_total).toBe(100);
  });
});
