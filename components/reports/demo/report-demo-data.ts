import { CalendarDays, ClipboardCheck, HardHat, ReceiptText, Timer } from 'lucide-react';

export const demoModules = [
  { id: 'timesheets', name: 'Timesheets', colour: '#80b7fa', icon: Timer, description: 'Hours, overtime & payroll', short: 'Review the working week.' },
  { id: 'allocation', name: 'Daily Allocation', colour: '#75cbd7', icon: HardHat, description: 'Plant usage & job labour', short: 'Understand the work on each job.' },
  { id: 'checks', name: 'Daily Checks', colour: '#f2b078', icon: ClipboardCheck, description: 'Compliance, defects & records', short: 'Keep checks and follow-ups in view.' },
  { id: 'absence', name: 'Absence & Leave', colour: '#c4a2ef', icon: CalendarDays, description: 'Bookings, balances & weekly plans', short: 'Plan around who is away.' },
  { id: 'quotes', name: 'Quotes', colour: '#e5cd70', icon: ReceiptText, description: 'Conversions & sales pipeline', short: 'See how enquiries become work.' },
] as const;

export type DemoModuleId = typeof demoModules[number]['id'];
export interface DemoReport { id: string; module: DemoModuleId; title: string; description: string; format: string; note: string; columns: string[]; rows: string[][] }

export const demoReports: DemoReport[] = [
  { id: 'weekly', module: 'timesheets', title: 'Weekly Timesheet Summary', description: 'A daily breakdown of worked hours, leave and non-working days.', format: 'Excel', note: 'Uses the selected date range.', columns: ['Employee', 'Worked hours', 'Leave days'], rows: [['Sample employee A', '40.00', '0'], ['Sample employee B', '32.00', '1'], ['Sample employee C', '37.50', '0']] },
  { id: 'payroll', module: 'timesheets', title: 'Payroll Export', description: 'Approved worked hours with overtime and leave, ready for payroll review.', format: 'Excel', note: 'Approved worked hours only.', columns: ['Employee', 'Standard hours', 'Overtime'], rows: [['Sample employee A', '40.00', '2.00'], ['Sample employee B', '32.00', '0.00']] },
  { id: 'plant', module: 'allocation', title: 'Plant Usage', description: 'Published plant allocations checked against daily inspections, for manual Sage entry.', format: 'Excel', note: 'Maximum 62 days. Does not post anything to Sage.', columns: ['Plant', 'Job', 'Allocated days'], rows: [['Sample excavator', 'DEMO-01', '4'], ['Sample dumper', 'DEMO-02', '3']] },
  { id: 'labour', module: 'allocation', title: 'Job Labour', description: 'Worked hours and man-day equivalents by job, from approved timesheets.', format: 'Excel + preview', note: 'Maximum 366 days. Timesheet-derived, not live allocation data.', columns: ['Job', 'Worked hours', 'Man-days'], rows: [['DEMO-01', '80.00', '10.00'], ['DEMO-02', '48.00', '6.00']] },
  { id: 'compliance', module: 'checks', title: 'Compliance Summary', description: 'Daily check completion across vans, plant and HGVs.', format: 'Excel', note: 'Covers all three daily-check modules.', columns: ['Asset type', 'Expected', 'Completed'], rows: [['Sample vans', '20', '20'], ['Sample plant', '15', '14'], ['Sample HGVs', '10', '10']] },
  { id: 'defects', module: 'checks', title: 'Defects Log', description: 'Reported defects that need review and follow-up.', format: 'Excel', note: 'Defects reported within the selected period.', columns: ['Asset', 'Defect', 'Status'], rows: [['Sample van', 'Lamp fault', 'Open'], ['Sample plant', 'Mirror damage', 'Resolved']] },
  { id: 'pdfs', module: 'checks', title: 'Daily Check PDFs', description: 'A combined PDF or ZIP of completed daily-check records.', format: 'PDF / ZIP', note: 'Large downloads split into multiple files.', columns: ['Record', 'Asset type', 'Date'], rows: [['Sample check 001', 'Van', '19 Oct'], ['Sample check 002', 'Plant', '20 Oct']] },
  { id: 'bookings', module: 'absence', title: 'Absence & Leave Bookings', description: 'Approved bookings that overlap your reporting period.', format: 'Excel', note: 'Includes active and archived approved bookings.', columns: ['Employee', 'From', 'To'], rows: [['Sample employee A', '19 Oct', '23 Oct'], ['Sample employee B', '22 Oct', '22 Oct']] },
  { id: 'allowance', module: 'absence', title: 'Allowance Snapshot', description: 'Annual leave allowance and booking totals at one point in time.', format: 'Excel', note: 'Uses the start date only. The end date is ignored.', columns: ['Employee', 'Allowance', 'Booked'], rows: [['Sample employee A', '25 days', '16 days'], ['Sample employee B', '25 days', '12 days']] },
  { id: 'absence-print', module: 'absence', title: 'Weekly Print Sheet', description: 'A printable week showing who is away and national holidays.', format: 'PDF', note: 'Longer ranges are split into weekly pages.', columns: ['Day', 'Away', 'Holiday'], rows: [['Monday', 'Sample employee A', '—'], ['Tuesday', 'Sample employee B', '—']] },
  { id: 'conversion', module: 'quotes', title: 'Conversion Funnel', description: 'Created, accepted and declined quotes, with the outstanding pipeline.', format: 'Excel', note: 'Quotes created within the reporting period.', columns: ['Stage', 'Sample quotes', 'Sample value'], rows: [['Created', '12', '£48,000'], ['Accepted', '7', '£29,000'], ['Declined', '2', '£6,000']] },
];
