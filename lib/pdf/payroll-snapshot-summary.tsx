import React from 'react';
import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { minutesToHours } from '@/lib/payroll/calculate';

export interface PayrollSnapshotPdfData {
  revision: number;
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

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#666',
    padding: 6,
  },
  title: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  item: {
    width: '25%',
    fontSize: 7.5,
    marginBottom: 2,
  },
});

export function PayrollSnapshotSummary({ snapshot }: { snapshot: PayrollSnapshotPdfData }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Payroll Breakdown — {snapshot.rule_set?.name || 'Configured Rule'} — Revision {snapshot.revision}
      </Text>
      <View style={styles.row}>
        <Text style={styles.item}>Basic: {minutesToHours(snapshot.basic_minutes).toFixed(2)}h</Text>
        <Text style={styles.item}>Overtime: {minutesToHours(snapshot.overtime_minutes).toFixed(2)}h</Text>
        <Text style={styles.item}>Double Time: {minutesToHours(snapshot.double_time_minutes).toFixed(2)}h</Text>
        <Text style={styles.item}>Travel: {minutesToHours(snapshot.operator_travel_minutes).toFixed(2)}h</Text>
        <Text style={styles.item}>Paid leave: {Number(snapshot.paid_leave_units).toFixed(1)} days</Text>
        <Text style={styles.item}>Unpaid leave: {Number(snapshot.unpaid_leave_units).toFixed(1)} days</Text>
        <Text style={styles.item}>IPR: {Number(snapshot.ipr_units).toFixed(1)}</Text>
        <Text style={styles.item}>
          Subsistence: {snapshot.subsistence_days} {snapshot.subsistence_day_names.join(', ')}
        </Text>
      </View>
    </View>
  );
}
