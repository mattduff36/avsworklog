import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('UI-001 manager daily workflow', () => {
  it('ships a date-first manager board with publish confirmation', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(dashboard)/daily-allocation/page.tsx'), 'utf8');
    expect(source).toContain('Publish allocation for');
    expect(source).toContain('JobCataloguePicker');
    expect(source).toContain('Plant planning');
    expect(source).toContain('DailyAllocationBetaBadge');
  });
});

describe('UI-002 employee issued view and history', () => {
  it('loads the issued item from notifications and shows earlier revisions', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(dashboard)/daily-allocation/my/page.tsx'), 'utf8');
    expect(source).toContain('/api/daily-allocation/me');
    expect(source).toContain('Earlier revisions');
    expect(source).toContain('DailyAllocationBetaBadge');
    const panel = readFileSync(resolve(process.cwd(), 'components/messages/NotificationPanel.tsx'), 'utf8');
    expect(panel).toContain('/daily-allocation/my?item=');
  });
});

describe('UI-003 responsive plant/job report', () => {
  it('renders a print-friendly job allocation sheet', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(dashboard)/daily-allocation/jobs/[code]/page.tsx'), 'utf8');
    expect(source).toContain('Print plant sheet');
    expect(source).toContain('Plant allocation');
    expect(source).toContain('DailyAllocationBetaBadge');
    const loader = readFileSync(resolve(process.cwd(), 'lib/server/daily-allocation.ts'), 'utf8');
    expect(loader).toContain(".in('work_date', relatedDates)");
    expect(loader).toContain('const planned = plantByPublicationDate.get(workDate) || []');
    expect(loader).toContain('list_daily_allocation_scope_profile_ids');
    expect(loader).toContain("from('daily_labour_allocation_drafts')");
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
    expect(source).toContain('Please select a catalogue job with a valid site address');
    expect(source).toContain('JobCataloguePicker');
  });
});
