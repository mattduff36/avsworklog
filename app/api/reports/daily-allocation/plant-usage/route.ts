import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule, canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import { generateExcelFile } from '@/lib/utils/excel';
import {
  buildSafeReportFilename,
  parseReportDateRange,
  validateRequiredReportDateRange,
} from '@/lib/server/report-date-range';
import { DailyAllocationError } from '@/lib/server/daily-allocation';
import { buildPlantUsageRows, summarizePlantUsage } from '@/lib/server/plant-usage-report';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!await canEffectiveRoleAccessModule('reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!await canEffectiveRoleUseModuleLevel('daily-allocation', 4)) {
      return NextResponse.json({ error: 'Daily Allocation manager access is required.' }, { status: 403 });
    }
    const [canOpenFleet, canOpenInspections] = await Promise.all([
      canEffectiveRoleAccessModule('admin-vans'),
      canEffectiveRoleAccessModule('plant-inspections'),
    ]);

    const parsed = parseReportDateRange(request.nextUrl.searchParams);
    const rangeError = validateRequiredReportDateRange(parsed.range, 62);
    if (!parsed.range || rangeError) {
      return NextResponse.json({ error: rangeError || parsed.error }, { status: 400 });
    }

    const rows = await buildPlantUsageRows(parsed.range, {
      fleet: canOpenFleet,
      inspections: canOpenInspections,
    });
    const buffer = await generateExcelFile([
      {
        sheetName: 'Daily evidence',
        columns: [
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Plant', key: 'plant', width: 24 },
          { header: 'Type', key: 'plant_type', width: 14 },
          { header: 'Job', key: 'job_code', width: 16 },
          { header: 'Title', key: 'job_title', width: 32 },
          { header: 'Site', key: 'site', width: 32 },
          { header: 'Customer', key: 'customer', width: 28 },
          { header: 'Session', key: 'session', width: 12 },
          { header: 'Revision', key: 'publication_revision', width: 12 },
          { header: 'Planned job', key: 'planned_source', width: 16 },
          { header: 'Check evidence', key: 'check_evidence', width: 24 },
          { header: 'Actual job', key: 'actual_job_code', width: 16 },
          { header: 'Status', key: 'status', width: 20 },
          { header: 'Plant history', key: 'plant_history_url', width: 42, hyperlink: true },
          { header: 'Job sheet', key: 'job_sheet_url', width: 42, hyperlink: true },
          { header: 'Inspection', key: 'inspection_url', width: 42, hyperlink: true },
        ],
        data: rows.map((row) => ({ ...row })),
      },
      {
        sheetName: 'Accounts summary',
        columns: [
          { header: 'Plant', key: 'plant', width: 24 },
          { header: 'Job', key: 'job_code', width: 16 },
          { header: 'First date', key: 'first_date', width: 14 },
          { header: 'Last date', key: 'last_date', width: 14 },
          { header: 'Days', key: 'days', width: 10 },
          { header: 'Statuses', key: 'statuses', width: 32 },
        ],
        data: summarizePlantUsage(rows),
      },
    ]);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${buildSafeReportFilename('Plant_Usage', parsed.range.filenameDateRange, 'xlsx')}"`,
      },
    });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Plant usage report failed', error);
    return NextResponse.json({ error: 'Unable to build the plant usage report.' }, { status: 500 });
  }
}
