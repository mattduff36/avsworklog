import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { validateAppSession } from '@/lib/server/app-auth/session';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { parseJobLabourFilters } from '@/lib/validation/job-labour-report';
import { loadJobLabourReport, jobLabourWorksheets } from '@/lib/server/job-labour-report';
import { generateExcelFile } from '@/lib/utils/excel';
import { buildSafeReportFilename } from '@/lib/server/report-date-range';
import { logServerError } from '@/lib/utils/server-error-logger';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const session = await validateAppSession();
  const finish = (response: NextResponse) => {
    response.headers.set('Cache-Control', 'private, no-store');
    applyValidationCookieIfNeeded(response, session);
    return response;
  };
  try {
    if (session.status !== 'active' || !session.profileId) return finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    if (!await canEffectiveRoleAccessModule('reports') || !await canEffectiveRoleAccessModule('timesheets')) {
      return finish(NextResponse.json({ error: 'Reports and Timesheets access is required.' }, { status: 403 }));
    }
    const format = request.nextUrl.searchParams.get('format') || 'json';
    if (format !== 'json' && format !== 'xlsx') return finish(NextResponse.json({ error: 'Invalid report format.' }, { status: 400 }));
    const filters = parseJobLabourFilters(request.nextUrl.searchParams);
    const report = await loadJobLabourReport(filters);
    if (format === 'json') return finish(NextResponse.json(report));
    const buffer = await generateExcelFile(jobLabourWorksheets(report));
    const filename = buildSafeReportFilename('Job_Labour', `${filters.dateFrom}_to_${filters.dateTo}`, 'xlsx');
    return finish(new NextResponse(new Uint8Array(buffer), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    } }));
  } catch (error) {
    if (error instanceof ZodError) return finish(NextResponse.json({ error: 'Choose valid dates (up to 366 days), job codes (up to 20), and hours per man-day (0.25–24).' }, { status: 400 }));
    await logServerError({ error: error instanceof Error ? error : new Error('Job labour report failed'), request, componentName: '/api/reports/timesheets/job-labour' });
    return finish(NextResponse.json({ error: 'Unable to generate a complete job labour report. Try a shorter date range or contact an administrator.' }, { status: 500 }));
  }
}
