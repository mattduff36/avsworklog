import { describe, expect, it } from 'vitest';
import { classifyAbsence, reconcilePlant } from '@/lib/server/daily-allocation';

describe('ABS-001 configurable absence behaviour', () => {
  it('blocks, reduces, ignores, and warns on pending absences', () => {
    expect(classifyAbsence({
      status: 'approved',
      is_half_day: false,
      allocation_behaviour: 'block',
    })).toBe('full_day_absence');
    expect(classifyAbsence({
      status: 'processed',
      is_half_day: true,
      allocation_behaviour: 'reduce',
    })).toBe('half_day_absence');
    expect(classifyAbsence({
      status: 'approved',
      is_half_day: true,
      allocation_behaviour: 'block',
    })).toBe('full_day_absence');
    expect(classifyAbsence({
      status: 'approved',
      is_half_day: false,
      allocation_behaviour: 'ignore',
    })).toBeNull();
    expect(classifyAbsence({
      status: 'pending',
      is_half_day: false,
      allocation_behaviour: 'block',
    })).toBe('pending');
  });
});

describe('RECON-001 registered planned versus actual', () => {
  it('matches registered plant by asset/day and flags job conflicts', () => {
    const rows = reconcilePlant(
      [{
        id: 'plan-1',
        publication_id: 'pub-1',
        plant_kind: 'registered',
        plant_id: 'plant-1',
        hired_serial: null,
        hired_description: null,
        hired_company: null,
        hired_serial_normalized: null,
        owner_team_id: null,
        job_source_type: 'live_quote',
        job_source_id: 'quote-1',
        job_code: '60001-MD',
        site_address: '12 High Street, Southwell',
        notes: null,
        created_at: '2026-08-13T00:00:00Z',
      }],
      [{
        id: 'insp-1',
        inspection_date: '2026-08-14',
        plant_id: 'plant-1',
        is_hired_plant: false,
        hired_plant_id_serial: null,
        hired_plant_hiring_company: null,
        hired_plant_description: null,
        job_code: '60002-MD',
        status: 'submitted',
      }],
      new Map([['plant-1', { plant_id: '574', nickname: 'Loader' }]]),
      '2026-08-14'
    );

    expect(rows[0].status).toBe('job_conflict');
    expect(rows[0].actual_job_code).toBe('60002-MD');
  });
});

describe('RECON-002 hired plant and unclassified actuals', () => {
  it('matches hired serial/company and keeps unmatched inspections visible', () => {
    const rows = reconcilePlant(
      [{
        id: 'plan-2',
        publication_id: 'pub-1',
        plant_kind: 'hired',
        plant_id: null,
        hired_serial: 'HX-1',
        hired_description: '20T excavator',
        hired_company: 'Hire Co',
        hired_serial_normalized: 'HX-1',
        owner_team_id: null,
        job_source_type: 'live_quote',
        job_source_id: 'quote-1',
        job_code: '60001-MD',
        site_address: '12 High Street, Southwell',
        notes: null,
        created_at: '2026-08-13T00:00:00Z',
      }],
      [{
        id: 'insp-2',
        inspection_date: '2026-08-14',
        plant_id: null,
        is_hired_plant: true,
        hired_plant_id_serial: 'hx-1',
        hired_plant_hiring_company: 'Hire Co',
        hired_plant_description: '20T excavator',
        job_code: '60001-MD',
        status: 'submitted',
      }, {
        id: 'insp-3',
        inspection_date: '2026-08-14',
        plant_id: 'plant-9',
        is_hired_plant: false,
        hired_plant_id_serial: null,
        hired_plant_hiring_company: null,
        hired_plant_description: null,
        job_code: null,
        status: 'submitted',
      }],
      new Map([['plant-9', { plant_id: '900', nickname: 'Spare' }]]),
      '2026-08-14'
    );

    expect(rows.find((row) => row.plant_kind === 'hired')?.status).toBe('matched');
    expect(rows.find((row) => row.status === 'unclassified_actual')?.inspection_id).toBe('insp-3');
  });

  it('does not match inspections from another work date', () => {
    const rows = reconcilePlant(
      [{
        id: 'plan-3',
        publication_id: 'pub-1',
        plant_kind: 'registered',
        plant_id: 'plant-1',
        hired_serial: null,
        hired_description: null,
        hired_company: null,
        hired_serial_normalized: null,
        owner_team_id: null,
        job_source_type: 'live_quote',
        job_source_id: 'quote-1',
        job_code: '60001-MD',
        site_address: '12 High Street, Southwell',
        notes: null,
        created_at: '2026-08-13T00:00:00Z',
      }],
      [{
        id: 'insp-old',
        inspection_date: '2026-08-13',
        plant_id: 'plant-1',
        is_hired_plant: false,
        hired_plant_id_serial: null,
        hired_plant_hiring_company: null,
        hired_plant_description: null,
        job_code: '60001-MD',
        status: 'submitted',
      }],
      new Map([['plant-1', { plant_id: '574', nickname: 'Loader' }]]),
      '2026-08-14'
    );

    expect(rows[0].status).toBe('planned_only');
    expect(rows).toHaveLength(1);
  });
});
