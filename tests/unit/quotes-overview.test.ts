import { describe, expect, it } from 'vitest';
import {
  OVERVIEW_IN_FILTER_CHUNK_SIZE,
  buildAllocatedLabourRows,
  buildOverviewRecords,
  buildOverviewSummary,
  buildOverviewQuoteIds,
  buildQuoteLevelInvoiceFallback,
  getLatestLabourActivityDate,
  loadInvoices,
  loadLabourRowsByReference,
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

describe('quotes overview PostgREST .in() chunking', () => {
  interface InCall {
    table: string;
    column: string;
    ids: string[];
  }

  function createInTrackingAdmin() {
    const inCalls: InCall[] = [];
    const admin = {
      from(table: string) {
        return {
          select() {
            return {
              async in(column: string, ids: string[]) {
                inCalls.push({ table, column, ids: [...ids] });
                if (table === 'timesheet_entry_job_codes' && column === 'job_number') {
                  return {
                    data: ids.map((jobNumber) => ({
                      timesheet_entry_id: `entry-${jobNumber}`,
                      job_number: jobNumber,
                      display_order: 0,
                    })),
                    error: null,
                  };
                }
                return { data: [], error: null };
              },
            };
          },
        };
      },
    };

    return { admin, inCalls };
  }

  it('OV-001: chunks labour and invoice .in() filters when ID lists exceed the chunk size', async () => {
    const oversizedCount = 651;
    const quoteIds = Array.from({ length: oversizedCount }, (_, index) => `quote-${index}`);
    const jobNumbers = Array.from({ length: oversizedCount }, (_, index) => (
      `J${String(index).padStart(5, '0')}-MD`
    ));
    const { admin, inCalls } = createInTrackingAdmin();

    await loadInvoices(admin, quoteIds, []);
    await loadLabourRowsByReference(admin, jobNumbers);

    expect(inCalls.length).toBeGreaterThan(0);
    expect(inCalls.every(call => call.ids.length > 0 && call.ids.length <= OVERVIEW_IN_FILTER_CHUNK_SIZE)).toBe(true);

    const invoiceQuoteIds = inCalls
      .filter(call => call.table === 'quote_invoices' && call.column === 'quote_id')
      .flatMap(call => call.ids);
    expect(invoiceQuoteIds).toEqual(quoteIds);
    expect(invoiceQuoteIds).toHaveLength(oversizedCount);

    const jobNumberIds = inCalls
      .filter(call => call.table === 'timesheet_entry_job_codes' && call.column === 'job_number')
      .flatMap(call => call.ids);
    expect(jobNumberIds).toEqual(jobNumbers);
    expect(jobNumberIds).toHaveLength(oversizedCount);

    const expectedEntryIds = jobNumbers.map(jobNumber => `entry-${jobNumber}`);
    const timesheetEntryIds = inCalls
      .filter(call => call.table === 'timesheet_entry_job_codes' && call.column === 'timesheet_entry_id')
      .flatMap(call => call.ids);
    const timesheetIds = inCalls
      .filter(call => call.table === 'timesheet_entries' && call.column === 'id')
      .flatMap(call => call.ids);

    expect(timesheetEntryIds).toEqual(expectedEntryIds);
    expect(timesheetIds).toEqual(expectedEntryIds);
    expect(Math.ceil(oversizedCount / OVERVIEW_IN_FILTER_CHUNK_SIZE)).toBe(7);
  });

  it('OV-002: labour and invoice totals match when the same rows arrive in two chunks vs one array', () => {
    const entries = [
      createEntry('entry-1', 'approved', 8),
      createEntry('entry-2', 'approved', 6),
      createEntry('entry-3', 'processed', 4),
    ];
    const jobCodes = entries.flatMap(entry => createJobCodes(entry.id, ['01234-MD']));

    const unchunkedRows = buildAllocatedLabourRows(entries, jobCodes, ['01234-MD']);
    const chunkedRows = buildAllocatedLabourRows(
      [...entries.slice(0, 2), ...entries.slice(2)],
      [...jobCodes.slice(0, 2), ...jobCodes.slice(2)],
      ['01234-MD'],
    );

    expect(chunkedRows.get('01234-MD')).toEqual(unchunkedRows.get('01234-MD'));
    expect((chunkedRows.get('01234-MD') || []).reduce((sum, row) => sum + row.allocated_hours, 0)).toBe(18);

    const invoices: QuoteOverviewInvoice[] = [
      {
        id: 'inv-1',
        quote_id: 'quote-1',
        invoice_number: '1',
        invoice_date: '2026-05-20',
        amount: 100,
        invoice_scope: 'partial',
        comments: null,
        created_at: '2026-05-21T00:00:00.000Z',
      },
      {
        id: 'inv-2',
        quote_id: 'quote-1',
        invoice_number: '2',
        invoice_date: '2026-05-25',
        amount: 250,
        invoice_scope: 'partial',
        comments: null,
        created_at: '2026-05-26T00:00:00.000Z',
      },
      {
        id: 'inv-3',
        quote_id: 'quote-1',
        invoice_number: '3',
        invoice_date: '2026-06-02',
        amount: 50,
        invoice_scope: 'partial',
        comments: null,
        created_at: '2026-06-03T00:00:00.000Z',
      },
    ];
    const unchunkedInvoices = new Map<string, QuoteOverviewInvoice[]>([['quote-1', invoices]]);
    const chunkedInvoices = new Map<string, QuoteOverviewInvoice[]>([[
      'quote-1',
      [...invoices.slice(0, 2), ...invoices.slice(2)],
    ]]);

    const records: OverviewSummaryRecord[] = [{
      item: {
        ...createItem('01234-MD'),
        quote_id: 'quote-1',
        invoice_total: 400,
        worked_hours: 18,
      },
      sourceReferences: ['01234-MD'],
      quoteIds: ['quote-1'],
    }];
    const dateRange = { from: '2026-05-15', to: '2026-06-21' };

    const unchunkedSummary = buildOverviewSummary({
      records,
      invoicesByQuoteId: unchunkedInvoices,
      labourRowsByReference: unchunkedRows,
      dateRange,
    });
    const chunkedSummary = buildOverviewSummary({
      records,
      invoicesByQuoteId: chunkedInvoices,
      labourRowsByReference: chunkedRows,
      dateRange,
    });

    expect(chunkedSummary).toEqual(unchunkedSummary);
    expect(chunkedSummary.invoice_total).toBe(400);
    expect(chunkedSummary.invoice_count).toBe(3);
    expect(chunkedSummary.worked_hours).toBe(18);
  });
});
