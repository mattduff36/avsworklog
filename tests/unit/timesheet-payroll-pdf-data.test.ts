import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { payrollSnapshotPdfTitle } from '@/lib/pdf/payroll-snapshot-summary';
import {
  formatGenericPdfRemarks,
  formatJobNumberOrYard,
} from '@/lib/pdf/timesheet-pdf-cells';
import {
  buildTimesheetPayrollPreviewDays,
  toPayrollSnapshotPdfData,
} from '@/lib/pdf/timesheet-payroll-pdf-data';
import type { PayrollWeekBreakdown } from '@/lib/payroll/types';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';
import type { Timesheet } from '@/types/timesheet';

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const breakdown: PayrollWeekBreakdown = {
  ruleSetKey: 'plant',
  weekEnding: '2026-08-16',
  basicMinutes: 1920,
  overtimeMinutes: 180,
  doubleTimeMinutes: 60,
  payableMinutes: 2160,
  paidLeaveUnits: 1,
  unpaidLeaveUnits: 0.5,
  operatorTravelMinutes: 90,
  iprUnits: 0.8,
  subsistenceDays: 2,
  subsistenceDayNames: ['Mon', 'Tue'],
  days: [],
};

describe('timesheet payroll PDF data', () => {
  it('PAY-PDF-PREVIEW-DAYS-001 maps a full week including plant travel hours', () => {
    const timesheet = {
      timesheet_type: 'plant',
      template_version: 2,
      entries: [
        {
          timesheet_id: 'ts-1',
          day_of_week: 1,
          time_started: '07:00',
          time_finished: '16:00',
          daily_total: 8.5,
          operator_travel_hours: 1.25,
          night_shift: false,
          bank_holiday: false,
          did_not_work: false,
          subsistence_payment_required: true,
          job_number: null,
          working_in_yard: false,
        },
      ],
    } as Pick<Timesheet, 'timesheet_type' | 'template_version' | 'entries'>;

    const days = buildTimesheetPayrollPreviewDays(timesheet, [
      { day_of_week: 2, paidLeaveUnits: 1, unpaidLeaveUnits: 0 } as TimesheetOffDayState,
    ]);

    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({
      dayOfWeek: 1,
      timeStarted: '07:00',
      operatorTravelHours: 1.25,
      subsistence: true,
    });
    expect(days[1]).toMatchObject({
      dayOfWeek: 2,
      paidLeaveUnits: 1,
      workedMinutesOverride: 0,
    });
  });

  it('PAY-PDF-PREVIEW-LABEL-001 labels provisional and frozen snapshots separately', () => {
    const provisional = toPayrollSnapshotPdfData(breakdown, 'provisional');
    const frozen = toPayrollSnapshotPdfData(breakdown, 'snapshot', 2);

    expect(payrollSnapshotPdfTitle(provisional)).toBe('Provisional Payroll Breakdown — Plant');
    expect(payrollSnapshotPdfTitle(frozen)).toBe('Payroll Breakdown — Plant — Revision 2');
    expect(provisional.basic_minutes).toBe(1920);
    expect(provisional.operator_travel_minutes).toBe(90);
  });

  it('PAY-PDF-PLANT-PLACEMENT-001 keeps the plant breakdown with the hours table', () => {
    const plant = readProjectFile('lib/pdf/plant-timesheet-v2-pdf.tsx');
    const standard = readProjectFile('lib/pdf/timesheet-pdf.tsx');
    const summary = readProjectFile('lib/pdf/payroll-snapshot-summary.tsx');
    const route = readProjectFile('app/api/timesheets/[id]/pdf/route.ts');

    expect(summary).toContain('wrap={false}');
    expect(standard).toContain('<PayrollSnapshotSummary snapshot={payrollSnapshot} />');
    expect(plant).toContain('<PayrollSnapshotSummary snapshot={payrollSnapshot} />');
    expect(plant.indexOf('{payrollSnapshot ? <PayrollSnapshotSummary')).toBeLessThan(
      plant.indexOf('<View style={styles.footer}>')
    );
    expect(route).toContain('previewTimesheetPayroll');
    expect(route).toContain('allowsSnapshotlessPayrollPreview');
    expect(route).toContain('shouldPrintLivePayrollPreview');
    expect(route).toContain("typedTimesheet.status === 'adjusted' ? 'reapproval' : 'provisional'");
  });

  it('PAY-PDF-JOB-YARD-001 renders job numbers or Yard in the generic Job number / Yard column', () => {
    const generic = readProjectFile('lib/pdf/timesheet-pdf.tsx');
    expect(generic).toContain("Job number{'\\n'}/ Yard");
    expect(formatJobNumberOrYard({ job_number: '3485-LC' })).toBe('3485-LC');
    expect(formatJobNumberOrYard({ working_in_yard: true })).toBe('Yard');
    expect(formatJobNumberOrYard({ job_number: null, working_in_yard: false })).toBe('');
  });

  it('PAY-PDF-REMARKS-001 keeps generic remarks as comments, leave and subsistence only', () => {
    expect(formatGenericPdfRemarks({ remarks: 'holiday (annual leave)' })).toBe('holiday (annual leave)');
    expect(formatGenericPdfRemarks({ remarks: 'Site delay' })).not.toMatch(/Job number/);
    expect(formatGenericPdfRemarks({ remarks: 'Site delay' })).toBe('Site delay');
  });
});
