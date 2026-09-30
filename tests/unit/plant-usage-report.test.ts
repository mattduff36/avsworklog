import { describe, expect, it } from 'vitest';
import { summarizePlantUsage, type PlantUsageRow } from '@/lib/server/plant-usage-report';

function row(date: string, status: string): PlantUsageRow {
  return {
    date,
    plant: 'Excavator',
    plant_type: 'Registered',
    job_code: 'Q-100',
    job_title: 'Site',
    site: 'Yard',
    customer: 'Acme',
    session: 'Full day',
    publication_revision: 2,
    planned_source: 'Q-100',
    check_evidence: 'submitted plant check',
    actual_job_code: 'Q-100',
    status,
    plant_history_url: '/fleet/plant/plant-1/history',
    job_sheet_url: '/daily-allocation/jobs/Q-100',
    inspection_url: '',
  };
}

describe('summarizePlantUsage', () => {
  it('splits a plant and job into contiguous date runs', () => {
    const summary = summarizePlantUsage([
      row('2026-09-01', 'matched'),
      row('2026-09-02', 'matched'),
      row('2026-09-04', 'planned only'),
    ]);

    expect(summary).toEqual([
      expect.objectContaining({ first_date: '2026-09-01', last_date: '2026-09-02', days: 2 }),
      expect.objectContaining({ first_date: '2026-09-04', last_date: '2026-09-04', days: 1 }),
    ]);
    expect(summary[0].statuses).toContain('matched');
    expect(summary[1].statuses).toContain('planned only');
  });
});
