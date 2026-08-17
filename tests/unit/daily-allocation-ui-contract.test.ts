import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('DA2-UI-001 manager board contract', () => {
  it('keeps manager routing and explicit v2 publish confirmation on the FFTS-style board', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'app/(dashboard)/daily-allocation/page.tsx'),
      'utf8'
    );
    expect(page).toMatch(/export default function/);
    expect(page).toContain('fetchDailyAllocationRuntime');
    expect(page).toContain('LegacyDailyAllocationManager');
    expect(page).toContain('board_enabled');
    expect(page).toContain('DailyAllocationBoardStateProvider');
    expect(page).toContain('DailyAllocationManagerBoard');

    const board = readFileSync(
      resolve(process.cwd(), 'components/daily-allocation/board/DailyAllocationManagerBoard.tsx'),
      'utf8'
    );
    expect(board).toContain('confirm_unallocated');
    expect(board).toContain('CONFIRM_UNALLOCATED_REQUIRED');
    expect(board).toContain('Convert this date to timed visits');
    expect(board).toContain('Add visit');
    expect(board).toContain('Assign resources');
    expect(board).toContain('Publication history');

    const toolbar = readFileSync(
      resolve(process.cwd(), 'components/daily-allocation/board/BoardToolbar.tsx'),
      'utf8'
    );
    expect(toolbar).toContain('Daily');
    expect(toolbar).toContain('Weekly');
    expect(toolbar).toContain('Publish');
    expect(toolbar).toContain('Active team');

    expect(board).toContain('dailyTimelineRangeLeft');
    expect(board).toContain("type: 'move-visit'");
    expect(board).toContain('mutations.moveVisit.mutateAsync');
    expect(board).toContain('expected_source_plan_version');
    expect(board).toContain('expected_target_plan_version');
    expect(board).toContain('planDay.plan_version + 1');
    expect(board).not.toMatch(/openAddVisit\(`\$\{visit\.job_source_type\}:\$\{visit\.job_source_id\}`/);

    const timeline = readFileSync(
      resolve(process.cwd(), 'components/daily-allocation/board/DailyTimeline.tsx'),
      'utf8'
    );
    expect(timeline).toContain('pointercancel');
    expect(timeline).toContain('finish(false)');

    const publish = readFileSync(
      resolve(process.cwd(), 'app/api/daily-allocation/publish/route.ts'),
      'utf8'
    );
    expect(publish).toContain('export async function POST');
    expect(publish).toMatch(/idempotency/i);

    const v2Sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260813_zzz_daily_allocation_v2_visit_model.sql'),
      'utf8'
    );
    expect(v2Sql).toContain('confirm_unallocated');
    expect(v2Sql).toContain('CONFIRM_UNALLOCATED_REQUIRED');
    expect(v2Sql).toContain('publish_daily_allocation_plan_v2');
  });
});

describe('UI-002 employee issued view and history', () => {
  it('loads the issued item from notifications and shows earlier revisions', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(dashboard)/daily-allocation/my/page.tsx'), 'utf8');
    expect(source).toContain('/api/daily-allocation/me');
    expect(source).toContain('Earlier revisions');
    expect(source).toContain('DailyAllocationBetaBadge');
    expect(source).toContain('publication');
    const panel = readFileSync(resolve(process.cwd(), 'components/messages/NotificationPanel.tsx'), 'utf8');
    expect(panel).toContain('dailyAllocationNotificationHref');
    const links = readFileSync(resolve(process.cwd(), 'lib/utils/notification-helpers.ts'), 'utf8');
    expect(links).toContain('/daily-allocation/my?item=');
    expect(links).toContain('/daily-allocation/my?publication=');
  });
});

describe('UI-003 responsive plant/job report', () => {
  it('renders a print-friendly job allocation sheet', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(dashboard)/daily-allocation/jobs/[code]/page.tsx'), 'utf8');
    expect(source).toContain('Print plant sheet');
    expect(source).toContain('Plant allocation');
    expect(source).toContain('DailyAllocationBetaBadge');
    const reconciliation = readFileSync(
      resolve(process.cwd(), 'lib/server/daily-allocation/reconciliation.ts'),
      'utf8'
    );
    const auth = readFileSync(resolve(process.cwd(), 'lib/server/daily-allocation/auth.ts'), 'utf8');
    const board = readFileSync(resolve(process.cwd(), 'lib/server/daily-allocation/board.ts'), 'utf8');
    expect(reconciliation).toContain(".in('work_date', relatedDates)");
    expect(reconciliation).toContain('const planned = plantByPublicationDate.get(workDate) || []');
    expect(auth).toContain('list_daily_allocation_scope_profile_ids');
    expect(board).toContain("from('daily_labour_allocation_drafts')");
  });
});

describe('UI-004 beta badges', () => {
  it('marks dashboard tiles and employee form config as beta', () => {
    const dashboard = readFileSync(resolve(process.cwd(), 'app/(dashboard)/dashboard/page.tsx'), 'utf8');
    const forms = readFileSync(resolve(process.cwd(), 'lib/config/forms.ts'), 'utf8');
    expect(dashboard).toContain("formType.id === 'daily-allocation'");
    expect(dashboard).toContain("link.href === '/daily-allocation'");
    expect(dashboard).toContain('DailyAllocationBetaBadge');
    expect(forms).toContain("id: 'daily-allocation'");
    expect(forms).toContain("href: '/daily-allocation/my'");
  });
});

describe('PLANT-001 catalogue enforcement on Daily Checks', () => {
  it('persists server-owned job fields and requires a job on submit', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(dashboard)/plant-inspections/new/page.tsx'), 'utf8');
    expect(source).toContain('job_source_type');
    expect(source).toContain('Please select a catalogue job');
    expect(source).toContain('JobCataloguePicker');
    expect(source).toContain('variant="plant-modal"');
    expect(source).not.toContain("Site: {jobSiteAddress || 'Derived from the selected catalogue job'}");
  });

  it('PDC-JOB-005 keeps catalogue access independent of the quotes module and surfaces load failures', () => {
    const route = readFileSync(resolve(process.cwd(), 'app/api/job-codes/route.ts'), 'utf8');
    const picker = readFileSync(
      resolve(process.cwd(), 'components/daily-allocation/JobCataloguePicker.tsx'),
      'utf8'
    );

    expect(route).toContain("canEffectiveRoleAccessModule('plant-inspections')");
    expect(route).not.toContain("canEffectiveRoleAccessModule('quotes')");
    expect(picker).toContain('useJobCatalogueOptions');
    expect(picker).toContain('role="alert"');
    expect(picker).toContain('Retry');
  });
});
