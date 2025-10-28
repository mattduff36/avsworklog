import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { Timesheet, TimesheetEntry, DAY_NAMES } from '@/types/timesheet';
import { formatDate } from '@/lib/utils/date';

// Create styles for the PDF matching the scanned form
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },
  // Form number in top right
  formNumber: {
    position: 'absolute',
    top: 40,
    right: 40,
    border: '2px solid #dc2626',
    padding: 8,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666',
  },
  // Company header
  companyHeader: {
    textAlign: 'center',
    marginBottom: 30,
  },
  companyName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  companyDetails: {
    fontSize: 8,
    marginBottom: 2,
  },
  companyPhone: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 3,
  },
  // Top info section
  topInfo: {
    flexDirection: 'row',
    marginBottom: 20,
    marginTop: 10,
  },
  infoField: {
    flex: 1,
    flexDirection: 'row',
  },
  infoLabel: {
    fontSize: 9,
    marginRight: 5,
  },
  infoDots: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#666',
    borderBottomStyle: 'dotted',
    marginRight: 10,
  },
  // Table
  table: {
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#000',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 35,
  },
  tableTotalRow: {
    flexDirection: 'row',
    minHeight: 35,
  },
  // Column styles
  colDay: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colTimeStarted: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colWorkingYard: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colTimeFinished: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colDailyTotal: {
    width: '10%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colRemarks: {
    width: '42%',
    padding: 6,
    justifyContent: 'center',
  },
  headerText: {
    fontSize: 8,
    textAlign: 'center',
  },
  cellText: {
    fontSize: 8,
    textAlign: 'center',
  },
  // Footer section
  footer: {
    marginTop: 30,
  },
  footerText: {
    fontSize: 8,
    marginBottom: 20,
  },
  signatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  signatureLabel: {
    fontSize: 9,
    marginRight: 10,
  },
  signatureDots: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    borderBottomStyle: 'dotted',
    height: 40,
  },
  signatureImage: {
    width: 180,
    height: 40,
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

  // Get form number (last 5 digits of ID or full ID if shorter)
  const formNumber = timesheet.id 
    ? timesheet.id.slice(-5).toUpperCase() 
    : '00000';

  // Create an array with all 7 days
  const allDays = [1, 2, 3, 4, 5, 6, 7].map(dayNum => {
    const entry = sortedEntries.find(e => e.day_of_week === dayNum);
    return entry || {
      day_of_week: dayNum,
      time_started: '',
      time_finished: '',
      working_in_yard: false,
      daily_total: 0,
      remarks: '',
      did_not_work: false,
    };
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Form Number in top right */}
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        {/* Company Header */}
        <View style={styles.companyHeader}>
          <Text style={styles.companyName}>A&V SQUIRES Plant Co. Ltd.</Text>
          <Text style={styles.companyDetails}>
            REGISTERED OFFICE: VIVIENNE HOUSE, RACECOURSE ROAD, CREW LANE INDUSTRIAL ESTATE, SOUTHWELL, NOTTS. NG25 0TX
          </Text>
          <Text style={styles.companyPhone}>Telephone: SOUTHWELL (01636) 812227</Text>
        </View>

        {/* Top Info Section */}
        <View style={styles.topInfo}>
          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Reg No.</Text>
            <View style={styles.infoDots}>
              <Text style={{ fontSize: 9, paddingLeft: 5 }}>{timesheet.reg_number || ''}</Text>
            </View>
          </View>
          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>W/E Sunday</Text>
            <View style={styles.infoDots}>
              <Text style={{ fontSize: 9, paddingLeft: 5 }}>{formatDate(new Date(timesheet.week_ending))}</Text>
            </View>
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Driver</Text>
            <View style={styles.infoDots}>
              <Text style={{ fontSize: 9, paddingLeft: 5 }}>{employeeName || ''}</Text>
            </View>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Header Row */}
          <View style={styles.tableHeaderRow}>
            <View style={styles.colDay}>
              <Text style={styles.headerText}></Text>
            </View>
            <View style={styles.colTimeStarted}>
              <Text style={styles.headerText}>Time{'\n'}Started</Text>
            </View>
            <View style={styles.colWorkingYard}>
              <Text style={styles.headerText}>Working{'\n'}in Yard</Text>
            </View>
            <View style={styles.colTimeFinished}>
              <Text style={styles.headerText}>Time{'\n'}Finished</Text>
            </View>
            <View style={styles.colDailyTotal}>
              <Text style={styles.headerText}>Daily{'\n'}Total</Text>
            </View>
            <View style={styles.colRemarks}>
              <Text style={styles.headerText}>Remarks{'\n'}(Type of work, reason for delay etc.)</Text>
            </View>
          </View>

          {/* Data Rows - All 7 days */}
          {allDays.map((entry, index) => (
            <View key={index} style={styles.tableRow}>
              <View style={styles.colDay}>
                <Text style={[styles.cellText, { textAlign: 'left' }]}>{DAY_NAMES[entry.day_of_week - 1]}</Text>
              </View>
              <View style={styles.colTimeStarted}>
                <Text style={styles.cellText}>
                  {entry.did_not_work ? '' : (entry.time_started || '')}
                </Text>
              </View>
              <View style={styles.colWorkingYard}>
                <Text style={styles.cellText}>
                  {entry.did_not_work ? '' : (entry.working_in_yard ? 'Yes' : '')}
                </Text>
              </View>
              <View style={styles.colTimeFinished}>
                <Text style={styles.cellText}>
                  {entry.did_not_work ? '' : (entry.time_finished || '')}
                </Text>
              </View>
              <View style={styles.colDailyTotal}>
                <Text style={styles.cellText}>
                  {entry.did_not_work ? '' : (entry.daily_total ? entry.daily_total.toFixed(2) : '')}
                </Text>
              </View>
              <View style={styles.colRemarks}>
                <Text style={[styles.cellText, { textAlign: 'left' }]}>
                  {entry.did_not_work ? 'DID NOT WORK' : (entry.remarks || '')}
                </Text>
              </View>
            </View>
          ))}

          {/* Total Row */}
          <View style={styles.tableTotalRow}>
            <View style={styles.colDay}>
              <Text style={[styles.cellText, { textAlign: 'left', fontWeight: 'bold' }]}>TOTAL</Text>
            </View>
            <View style={styles.colTimeStarted}>
              <Text style={styles.cellText}></Text>
            </View>
            <View style={styles.colWorkingYard}>
              <Text style={styles.cellText}></Text>
            </View>
            <View style={styles.colTimeFinished}>
              <Text style={styles.cellText}></Text>
            </View>
            <View style={styles.colDailyTotal}>
              <Text style={[styles.cellText, { fontWeight: 'bold' }]}>{totalHours.toFixed(2)}</Text>
            </View>
            <View style={styles.colRemarks}>
              <Text style={styles.cellText}></Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            All time and other details are correct and should{'\n'}be used as a basis for wages etc.
          </Text>

          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>Driver</Text>
            {timesheet.signature_data ? (
              <Image style={styles.signatureImage} src={timesheet.signature_data} alt="Driver signature" />
            ) : (
              <View style={styles.signatureDots} />
            )}
            <Text style={[styles.signatureLabel, { marginLeft: 10 }]}>Signature</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
