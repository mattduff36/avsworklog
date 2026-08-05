import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { minutesToHours } from '@/lib/payroll/calculate';

export interface PayrollSnapshotView {
  id?: string;
  revision: number;
  approved_at?: string;
  basic_minutes: number;
  overtime_minutes: number;
  double_time_minutes: number;
  paid_leave_units: number | string;
  unpaid_leave_units: number | string;
  operator_travel_minutes: number;
  ipr_units: number | string;
  subsistence_days: number;
  subsistence_day_names: string[];
  rule_set?: { name?: string | null } | null;
}

export function PayrollSnapshotCard({
  snapshot,
  title,
}: {
  snapshot: PayrollSnapshotView;
  title?: string;
}) {
  const values = [
    ['Basic', `${minutesToHours(snapshot.basic_minutes).toFixed(2)}h`],
    ['Overtime', `${minutesToHours(snapshot.overtime_minutes).toFixed(2)}h`],
    ['Double Time', `${minutesToHours(snapshot.double_time_minutes).toFixed(2)}h`],
    ['Paid leave', `${Number(snapshot.paid_leave_units).toFixed(1)} days`],
    ['Unpaid leave', `${Number(snapshot.unpaid_leave_units).toFixed(1)} days`],
    ['Operator travel', `${minutesToHours(snapshot.operator_travel_minutes).toFixed(2)}h`],
    ['IPR', Number(snapshot.ipr_units).toFixed(1)],
    ['Subsistence', `${snapshot.subsistence_days} ${snapshot.subsistence_day_names.join(', ')}`.trim()],
  ];

  return (
    <Card className="border-timesheet/40 bg-timesheet/10">
      <CardHeader>
        <CardTitle className="text-lg">
          {title || `Payroll Breakdown — ${snapshot.rule_set?.name || 'Configured Rule'} — Revision ${snapshot.revision}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {values.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-semibold text-foreground">{value || '-'}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
