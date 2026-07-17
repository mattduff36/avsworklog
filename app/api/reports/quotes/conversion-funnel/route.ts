import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { generateExcelFile, formatExcelDate } from '@/lib/utils/excel';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import {
  buildQuoteConversionSummaryRows,
  buildQuoteDetailRows,
  buildQuoteStatusSummaryRows,
  type QuoteConversionReportRow,
} from '@/lib/server/quote-conversion-report';
import type {
  QuoteFinancialAdjustment,
  QuoteInvoice,
  QuoteInvoiceRequest,
} from '@/app/(dashboard)/quotes/types';
import { calculateQuoteFinancials } from '@/lib/utils/quote-financial-adjustments';

function formatReportDate(value: string | null): string {
  return value ? formatExcelDate(value) : '-';
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessReports = await canEffectiveRoleAccessModule('reports');
    if (!canAccessReports) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    let query = supabase
      .from('quotes')
      .select(`
        id,
        quote_thread_id,
        quote_reference,
        quote_date,
        status,
        total,
        accepted,
        created_at,
        updated_at,
        sent_at,
        accepted_at,
        customer_sent_at,
        po_received_at,
        closed_at,
        commercial_status,
        customer:customers(
          company_name,
          short_name
        ),
        manager:profiles!quotes_requester_id_fkey(
          full_name,
          employee_id,
          team:org_teams(
            name,
            code
          )
        )
      `)
      .eq('is_latest_version', true)
      .order('quote_date', { ascending: false });

    if (dateFrom) query = query.gte('quote_date', dateFrom);
    if (dateTo) query = query.lte('quote_date', dateTo);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rawReportRows = (data || []) as Array<QuoteConversionReportRow & {
      quote_thread_id: string;
    }>;
    if (rawReportRows.length === 0) {
      return NextResponse.json({ error: 'No quotes found for the specified criteria' }, { status: 404 });
    }
    const threadIds = rawReportRows.map(row => row.quote_thread_id);
    const { data: versions, error: versionsError } = await supabase
      .from('quotes')
      .select('id, quote_thread_id, total, revision_type, revision_number, created_at')
      .in('quote_thread_id', threadIds);
    if (versionsError) throw versionsError;

    const versionIds = (versions || []).map(version => version.id);
    const [invoiceResult, requestResult, adjustmentResult] = await Promise.all([
      supabase.from('quote_invoices').select('*').in('quote_id', versionIds),
      supabase.from('quote_invoice_requests').select('*').in('quote_id', versionIds),
      supabase.from('quote_financial_adjustments').select('*').in('quote_thread_id', threadIds),
    ]);
    if (invoiceResult.error) throw invoiceResult.error;
    if (requestResult.error) throw requestResult.error;
    if (adjustmentResult.error) throw adjustmentResult.error;

    const reportRows = rawReportRows.map(row => {
      const threadVersions = (versions || []).filter(
        version => version.quote_thread_id === row.quote_thread_id,
      );
      const ids = new Set(threadVersions.map(version => version.id));
      const calculation = calculateQuoteFinancials({
        versions: threadVersions.map(version => ({
          id: version.id,
          quote_thread_id: version.quote_thread_id,
          total: Number(version.total || 0),
          revision_type: version.revision_type,
          revision_number: Number(version.revision_number || 0),
          created_at: version.created_at,
        })),
        invoices: (invoiceResult.data || [])
          .filter(invoice => ids.has(invoice.quote_id))
          .map(invoice => ({ ...invoice, amount: Number(invoice.amount || 0) } as QuoteInvoice)),
        requests: (requestResult.data || [])
          .filter(invoiceRequest => ids.has(invoiceRequest.quote_id))
          .map(invoiceRequest => ({
            ...invoiceRequest,
            requested_amount: Number(invoiceRequest.requested_amount || 0),
          } as QuoteInvoiceRequest)),
        adjustments: (adjustmentResult.data || [])
          .filter(adjustment => adjustment.quote_thread_id === row.quote_thread_id)
          .map(adjustment => ({
            ...adjustment,
            amount: Number(adjustment.amount || 0),
            metadata_before: (adjustment.metadata_before || {}) as Record<string, unknown>,
            metadata_after: (adjustment.metadata_after || {}) as Record<string, unknown>,
            document_snapshot: (adjustment.document_snapshot || {}) as Record<string, unknown>,
          } as QuoteFinancialAdjustment)),
      });
      return {
        ...row,
        total: calculation.threadSummary.adjusted_quote_value,
      };
    });
    if (reportRows.length === 0) {
      return NextResponse.json({ error: 'No quotes found for the specified criteria' }, { status: 404 });
    }

    const summaryRows = buildQuoteConversionSummaryRows(reportRows);
    const statusRows = buildQuoteStatusSummaryRows(reportRows);
    const detailRows = buildQuoteDetailRows(reportRows);

    const summaryData = summaryRows.map((row) => ({
      Customer: row.customerName,
      Owner: row.ownerName,
      Team: row.teamName,
      Created: row.createdCount,
      Accepted: row.acceptedCount,
      Declined: row.declinedCount,
      'Aging Pipeline': row.agingCount,
      'Created Value': row.createdValue,
      'Accepted Value': row.acceptedValue,
      'Declined Value': row.declinedValue,
      'Aging Value': row.agingValue,
      'Conversion Rate %': row.conversionRatePercent,
      'Avg Open Age Days': row.averageOpenAgeDays ?? '-',
    }));

    const statusData = statusRows.map((row) => ({
      Status: row.label,
      'Raw Status': row.status,
      Count: row.count,
      Value: row.value,
    }));

    const detailData = detailRows.map((row) => ({
      'Quote Reference': row.quoteReference,
      Customer: row.customerName,
      Owner: row.ownerName,
      Team: row.teamName,
      Status: row.statusLabel,
      'Pipeline Stage': row.pipelineStage,
      'Quote Date': formatReportDate(row.quoteDate),
      Sent: formatReportDate(row.sentAt),
      Accepted: formatReportDate(row.acceptedAt),
      Value: row.total,
      'Open Age Days': row.openAgeDays ?? '-',
    }));

    const buffer = await generateExcelFile([
      {
        sheetName: 'Funnel Summary',
        columns: [
          { header: 'Customer', key: 'Customer', width: 26 },
          { header: 'Owner', key: 'Owner', width: 22 },
          { header: 'Team', key: 'Team', width: 18 },
          { header: 'Created', key: 'Created', width: 10 },
          { header: 'Accepted', key: 'Accepted', width: 10 },
          { header: 'Declined', key: 'Declined', width: 10 },
          { header: 'Aging Pipeline', key: 'Aging Pipeline', width: 15 },
          { header: 'Created Value', key: 'Created Value', width: 14 },
          { header: 'Accepted Value', key: 'Accepted Value', width: 15 },
          { header: 'Declined Value', key: 'Declined Value', width: 15 },
          { header: 'Aging Value', key: 'Aging Value', width: 14 },
          { header: 'Conversion Rate %', key: 'Conversion Rate %', width: 18 },
          { header: 'Avg Open Age Days', key: 'Avg Open Age Days', width: 18 },
        ],
        data: summaryData,
      },
      {
        sheetName: 'Status Breakdown',
        columns: [
          { header: 'Status', key: 'Status', width: 24 },
          { header: 'Raw Status', key: 'Raw Status', width: 24 },
          { header: 'Count', key: 'Count', width: 10 },
          { header: 'Value', key: 'Value', width: 14 },
        ],
        data: statusData,
      },
      {
        sheetName: 'Quote Details',
        columns: [
          { header: 'Quote Reference', key: 'Quote Reference', width: 18 },
          { header: 'Customer', key: 'Customer', width: 26 },
          { header: 'Owner', key: 'Owner', width: 22 },
          { header: 'Team', key: 'Team', width: 18 },
          { header: 'Status', key: 'Status', width: 20 },
          { header: 'Pipeline Stage', key: 'Pipeline Stage', width: 16 },
          { header: 'Quote Date', key: 'Quote Date', width: 14 },
          { header: 'Sent', key: 'Sent', width: 14 },
          { header: 'Accepted', key: 'Accepted', width: 14 },
          { header: 'Value', key: 'Value', width: 14 },
          { header: 'Open Age Days', key: 'Open Age Days', width: 15 },
        ],
        data: detailData,
      },
    ]);

    const dateRange = dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : new Date().toISOString().split('T')[0];
    const filename = `Quotes_Conversion_Funnel_${dateRange}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating quotes conversion funnel report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/quotes/conversion-funnel',
      additionalData: { endpoint: '/api/reports/quotes/conversion-funnel' },
    });

    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
