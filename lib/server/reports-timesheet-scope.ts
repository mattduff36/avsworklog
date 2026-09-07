import { createAdminClient } from '@/lib/supabase/admin';
import { getReportHiddenProfileIds } from '@/lib/server/system-accounts';
import { isDeletedUserName } from '@/lib/users/deleted-user';
import {
  filterRowsForReportProfileScope,
  getReportScopeContext,
  getScopedProfileIdsForModule,
} from '@/lib/server/report-scope';

interface TimesheetScopeRow {
  user_id: string;
  employee?: {
    team_id?: string | null;
    full_name?: string | null;
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
    getReportHiddenProfileIds(createAdminClient()),
  ]);

  return filterRowsForReportProfileScope(
    rows,
    moduleScopedProfileIds,
    hiddenProfileIds,
    (row) => row.user_id
  ).filter((row) => !isDeletedUserName(row.employee?.full_name));
}
