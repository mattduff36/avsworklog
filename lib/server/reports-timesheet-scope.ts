import { createAdminClient } from '@/lib/supabase/admin';
import { getSystemAccountIds } from '@/lib/server/system-accounts';
import {
  filterRowsForReportProfileScope,
  getReportScopeContext,
  getScopedProfileIdsForModule,
} from '@/lib/server/report-scope';

interface TimesheetScopeRow {
  user_id: string;
  employee?: {
    team_id?: string | null;
  } | null;
}

export async function getTimesheetReportScopedProfileIds(): Promise<Set<string> | null> {
  const scopeContext = await getReportScopeContext();
  if (!scopeContext.effectiveRole.user_id) {
    return new Set<string>();
  }

  return getScopedProfileIdsForModule('timesheets', scopeContext);
}

export async function filterTimesheetRowsForReportScope<T extends TimesheetScopeRow>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) {
    return rows;
  }

  const [moduleScopedProfileIds, hiddenProfileIds] = await Promise.all([
    getTimesheetReportScopedProfileIds(),
    getSystemAccountIds(createAdminClient()),
  ]);

  return filterRowsForReportProfileScope(
    rows,
    moduleScopedProfileIds,
    hiddenProfileIds,
    (row) => row.user_id
  );
}
