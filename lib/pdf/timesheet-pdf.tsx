import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { Timesheet, TimesheetEntry, DAY_NAMES } from '@/types/timesheet';
import { formatDate } from '@/lib/utils/date';

// Create styles for the PDF
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#F1D64A',
    borderBottomStyle: 'solid',
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  label: {
    fontWeight: 'bold',
    width: 100,
  },
  value: {
    flex: 1,
  },
  table: {
    marginTop: 15,
    marginBottom: 15,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F1D64A',
    padding: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    padding: 8,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    padding: 8,
    backgroundColor: '#f9f9f9',
  },
  colDay: {
    width: '12%',
  },
  colStart: {
    width: '11%',
  },
  colFinish: {
    width: '11%',
  },
  colJob: {
    width: '12%',
  },
  colYard: {
    width: '8%',
  },
  colHours: {
    width: '10%',
  },
  colRemarks: {
    width: '36%',
  },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: '#F1D64A',
    padding: 8,
    fontWeight: 'bold',
    marginTop: 5,
  },
  signatureSection: {
    marginTop: 30,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    borderTopStyle: 'solid',
    paddingTop: 15,
  },
  signatureRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  signatureBox: {
    flex: 1,
    marginRight: 20,
  },
  signatureLabel: {
    fontSize: 9,
    color: '#666',
    marginBottom: 5,
  },
  signatureImage: {
    width: 200,
    height: 60,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderStyle: 'solid',
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    borderBottomStyle: 'solid',
    marginBottom: 5,
    height: 60,
  },
  statusBadge: {
    padding: 5,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    fontSize: 9,
    textAlign: 'center',
    width: 80,
  },
  statusApproved: {
    backgroundColor: '#4ade80',
    color: '#fff',
  },
  statusRejected: {
    backgroundColor: '#f87171',
    color: '#fff',
  },
  statusSubmitted: {
    backgroundColor: '#60a5fa',
    color: '#fff',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 8,
    color: '#666',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    borderTopStyle: 'solid',
    paddingTop: 10,
  },
  commentsSection: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#fff3cd',
    borderLeftWidth: 3,
    borderLeftColor: '#ffc107',
    borderLeftStyle: 'solid',
  },
  commentsLabel: {
    fontWeight: 'bold',
    marginBottom: 5,
  },
});

interface TimesheetPDFProps {
  timesheet: Timesheet;
  employeeName?: string;
  employeeEmail?: string;
}

export function TimesheetPDF({ timesheet, employeeName, employeeEmail }: TimesheetPDFProps) {
  // Sort entries by day of week
  const sortedEntries = (timesheet.entries || []).sort((a, b) => a.day_of_week - b.day_of_week);
  
  // Calculate total hours
  const totalHours = sortedEntries.reduce((sum, entry) => sum + (entry.daily_total || 0), 0);

  // Get status style
  const getStatusStyle = () => {
    switch (timesheet.status) {
      case 'approved':
        return [styles.statusBadge, styles.statusApproved];
      case 'rejected':
        return [styles.statusBadge, styles.statusRejected];
      case 'submitted':
        return [styles.statusBadge, styles.statusSubmitted];
      default:
        return styles.statusBadge;
    }
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>SQUIRES</Text>
          <Text style={styles.subtitle}>Weekly Timesheet</Text>
        </View>

        {/* Employee Information */}
        <View style={{ marginBottom: 15 }}>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Employee:</Text>
            <Text style={styles.value}>{employeeName || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Email:</Text>
            <Text style={styles.value}>{employeeEmail || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Reg Number:</Text>
            <Text style={styles.value}>{timesheet.reg_number || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Week Ending:</Text>
            <Text style={styles.value}>{formatDate(new Date(timesheet.week_ending))}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Status:</Text>
            <Text style={getStatusStyle()}>{timesheet.status.toUpperCase()}</Text>
          </View>
        </View>

        {/* Timesheet Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={styles.colDay}>Day</Text>
            <Text style={styles.colStart}>Start</Text>
            <Text style={styles.colFinish}>Finish</Text>
            <Text style={styles.colJob}>Job No.</Text>
            <Text style={styles.colYard}>Yard</Text>
            <Text style={styles.colHours}>Hours</Text>
            <Text style={styles.colRemarks}>Remarks</Text>
          </View>

          {/* Table Rows */}
          {sortedEntries.map((entry: TimesheetEntry, index: number) => (
            <View key={entry.id || index} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={styles.colDay}>{DAY_NAMES[entry.day_of_week - 1]}</Text>
              <Text style={styles.colStart}>
                {entry.did_not_work ? 'N/A' : (entry.time_started || '-')}
              </Text>
              <Text style={styles.colFinish}>
                {entry.did_not_work ? 'N/A' : (entry.time_finished || '-')}
              </Text>
              <Text style={styles.colJob}>
                {entry.did_not_work ? 'N/A' : ((entry as any).job_number || (entry.working_in_yard ? 'YARD' : '-'))}
              </Text>
              <Text style={styles.colYard}>
                {entry.did_not_work ? 'N/A' : (entry.working_in_yard ? 'Yes' : 'No')}
              </Text>
              <Text style={styles.colHours}>
                {entry.did_not_work ? 'DID NOT WORK' : (entry.daily_total ? entry.daily_total.toFixed(2) : '0.00')}
              </Text>
              <Text style={styles.colRemarks}>
                {entry.did_not_work ? 'Day off' : (entry.remarks || '-')}
              </Text>
            </View>
          ))}

          {/* Total Row */}
          <View style={styles.totalRow}>
            <Text style={{ width: '49%' }}>TOTAL HOURS:</Text>
            <Text style={styles.colJob}></Text>
            <Text style={styles.colYard}></Text>
            <Text style={styles.colHours}>{totalHours.toFixed(2)}</Text>
            <Text style={styles.colRemarks}></Text>
          </View>
        </View>

        {/* Manager Comments (if rejected) */}
        {timesheet.manager_comments && (
          <View style={styles.commentsSection}>
            <Text style={styles.commentsLabel}>Manager Comments:</Text>
            <Text>{timesheet.manager_comments}</Text>
          </View>
        )}

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Employee Signature:</Text>
              {timesheet.signature_data ? (
                <Image style={styles.signatureImage} src={timesheet.signature_data} alt="Employee signature" />
              ) : (
                <View style={styles.signatureLine} />
              )}
              {timesheet.signed_at && (
                <Text style={{ fontSize: 8, marginTop: 5 }}>
                  Signed: {formatDate(new Date(timesheet.signed_at))}
                </Text>
              )}
            </View>
          </View>

          {timesheet.reviewed_at && (
            <View style={styles.signatureRow}>
              <View style={styles.signatureBox}>
                <Text style={styles.signatureLabel}>Reviewed By:</Text>
                <View style={styles.signatureLine} />
                <Text style={{ fontSize: 8, marginTop: 5 }}>
                  Date: {formatDate(new Date(timesheet.reviewed_at))}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>A&V Squires Plant Company Ltd. | Generated: {formatDate(new Date())}</Text>
        </View>
      </Page>
    </Document>
  );
}

