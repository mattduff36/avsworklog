import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { VehicleInspection, InspectionItem, INSPECTION_ITEMS } from '@/types/inspection';
import { formatDate } from '@/lib/utils/date';

// Create styles for the PDF matching the scanned form
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 8,
    fontFamily: 'Helvetica',
  },
  // Form number in top right
  formNumber: {
    position: 'absolute',
    top: 30,
    right: 30,
    border: '2px solid #dc2626',
    padding: 8,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666',
  },
  // Company header
  companyHeader: {
    textAlign: 'center',
    marginBottom: 15,
  },
  companyName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 2,
    letterSpacing: 1,
  },
  companyDetails: {
    fontSize: 7,
    marginBottom: 1,
  },
  companyPhone: {
    fontSize: 9,
    fontWeight: 'bold',
    marginTop: 2,
  },
  registeredNo: {
    fontSize: 7,
    fontStyle: 'italic',
    marginTop: 2,
    marginBottom: 3,
  },
  pageTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  // Top info table
  topTable: {
    borderWidth: 1,
    borderColor: '#000',
    marginBottom: 0,
  },
  topRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 30,
  },
  topCell: {
    padding: 4,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  topCellLast: {
    padding: 4,
    justifyContent: 'center',
  },
  topLabel: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  topValue: {
    fontSize: 8,
    marginTop: 2,
  },
  // Week ending row with day columns
  weekRow: {
    flexDirection: 'row',
    minHeight: 25,
  },
  weekLabel: {
    width: '40%',
    padding: 4,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  dayCell: {
    width: '8.57%', // 60% / 7 days
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  dayCellLast: {
    width: '8.57%',
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayText: {
    fontSize: 7,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  // Checklist table
  checklistTable: {
    borderWidth: 1,
    borderColor: '#000',
    borderTopWidth: 0,
  },
  checklistRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 20,
  },
  checklistRowLast: {
    flexDirection: 'row',
    minHeight: 20,
  },
  numberCell: {
    width: '6%',
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  itemCell: {
    width: '34%',
    padding: 3,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  checkCell: {
    width: '8.57%',
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  checkCellLast: {
    width: '8.57%',
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  itemText: {
    fontSize: 7,
  },
  checkText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  // Section header
  sectionHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    backgroundColor: '#e0e0e0',
    padding: 4,
    justifyContent: 'center',
  },
  sectionHeaderText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  // Checked by section
  checkedBySection: {
    borderWidth: 1,
    borderColor: '#000',
    borderTopWidth: 0,
    padding: 8,
    minHeight: 25,
  },
  checkedByText: {
    fontSize: 8,
  },
  // Comments sections
  commentsBox: {
    borderWidth: 1,
    borderColor: '#000',
    marginTop: 10,
    padding: 8,
    minHeight: 60,
  },
  commentsTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  commentsText: {
    fontSize: 7,
    lineHeight: 1.4,
  },
  // Legend section
  legendSection: {
    marginTop: 10,
    textAlign: 'center',
  },
  legendText: {
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  legendNote: {
    fontSize: 6,
    marginBottom: 1,
  },
  distributionText: {
    fontSize: 6,
    fontStyle: 'italic',
  },
});

interface InspectionPDFProps {
  inspection: VehicleInspection;
  items: InspectionItem[];
  vehicleReg?: string;
  employeeName?: string;
  employeeEmail?: string;
}

export function InspectionPDF({ inspection, items, vehicleReg, employeeName, employeeEmail }: InspectionPDFProps) {
  // Get form number (last 5 digits of ID or full ID if shorter)
  const formNumber = inspection.id 
    ? inspection.id.slice(-5).toUpperCase() 
    : '00000';

  // Define the inspection items as they appear on the form
  const formItems = [
    'Fuel - and ad-blu',
    'Mirrors - includes Class V & Class VI',
    'Safety Equipment - Cameras & Audible Alerts',
    'Warning Signage - VRU Sign',
    'FORS Stickers',
    'Oil',
    'Water',
    'Battery',
    'Tyres',
    'Brakes',
    'Steering',
    'Lights',
    'Reflectors',
    'Indicators',
    'Wipers',
    'Washers',
    'Horn',
    'Markers',
    'Sheets / Ropes / Chains',
    'Security of Load',
    'Side underbar/Rails',
  ];

  const trailerItems = [
    'Brake Hoses',
    'Couplings Secure',
    'Electrical Connections',
    'Trailer No. Plate',
    'Nil Defects',
  ];

  // Helper to get check mark for an item
  const getCheckMark = (itemNumber: number) => {
    const item = items.find(i => i.item_number === itemNumber);
    if (!item) return '';
    return item.status === 'ok' ? '✓' : item.status === 'defect' ? '✗' : '0';
  };

  // Collect all defects and comments
  const defectsAndComments = items
    .filter(item => item.comments || item.status === 'defect')
    .map(item => {
      const itemName = INSPECTION_ITEMS[item.item_number - 1] || formItems[item.item_number - 1];
      const status = item.status === 'ok' ? '✓' : item.status === 'defect' ? '✗' : '0';
      return `${item.item_number}. ${itemName} [${status}]${item.comments ? ': ' + item.comments : ''}`;
    })
    .join('\n');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Form Number in top right */}
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        {/* Company Header */}
        <View style={styles.companyHeader}>
          <Text style={styles.companyName}>A. & V. SQUIRES PLANT COMPANY LTD</Text>
          <Text style={styles.companyDetails}>
            REGISTERED OFFICE: VIVIENNE HOUSE, RACECOURSE ROAD, CREW LANE INDUSTRIAL ESTATE, SOUTHWELL, NOTTS. NG25 0TX
          </Text>
          <Text style={styles.companyPhone}>Telephone: SOUTHWELL (01636) 812227</Text>
          <Text style={styles.registeredNo}>Registered in England No. 1000918</Text>
          <Text style={styles.pageTitle}>VEHICLE INSPECTION PAD</Text>
        </View>

        {/* Top Info Table */}
        <View style={styles.topTable}>
          <View style={styles.topRow}>
            <View style={[styles.topCell, { width: '30%' }]}>
              <Text style={styles.topLabel}>REG NO.</Text>
              <Text style={styles.topValue}>{vehicleReg || ''}</Text>
            </View>
            <View style={[styles.topCell, { width: '30%' }]}>
              <Text style={styles.topLabel}>MILEAGE.</Text>
              <Text style={styles.topValue}>{inspection.mileage || ''}</Text>
            </View>
            <View style={[styles.topCellLast, { width: '40%' }]}>
              <Text style={styles.topLabel}>DRIVER NAME.</Text>
              <Text style={styles.topValue}>{employeeName || ''}</Text>
            </View>
          </View>

          {/* Week Ending Row with Day Columns */}
          <View style={styles.weekRow}>
            <View style={styles.weekLabel}>
              <Text style={styles.topLabel}>WEEK ENDING.</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>MON</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>TUE</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>WED</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>THUR</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>FRI</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>SAT</Text>
            </View>
            <View style={styles.dayCellLast}>
              <Text style={styles.dayText}>SUN</Text>
            </View>
          </View>
        </View>

        {/* Checklist Table */}
        <View style={styles.checklistTable}>
          {formItems.map((item, index) => (
            <View key={index} style={styles.checklistRow}>
              <View style={styles.numberCell}>
                <Text style={styles.numberText}>{String(index + 1).padStart(2, '0')}</Text>
              </View>
              <View style={styles.itemCell}>
                <Text style={styles.itemText}>{item}</Text>
              </View>
              {/* 7 day columns */}
              {[0, 1, 2, 3, 4, 5].map((day) => (
                <View key={day} style={styles.checkCell}>
                  <Text style={styles.checkText}>{getCheckMark(index + 1)}</Text>
                </View>
              ))}
              <View style={styles.checkCellLast}>
                <Text style={styles.checkText}>{getCheckMark(index + 1)}</Text>
              </View>
            </View>
          ))}

          {/* Section Header for Trailer */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>ARTIC / TRAILER COMBINATIONS</Text>
          </View>

          {/* Trailer Items */}
          {trailerItems.map((item, index) => (
            <View key={index + 22} style={index === trailerItems.length - 1 ? styles.checklistRowLast : styles.checklistRow}>
              <View style={styles.numberCell}>
                <Text style={styles.numberText}>{String(index + 22).padStart(2, '0')}</Text>
              </View>
              <View style={styles.itemCell}>
                <Text style={styles.itemText}>{item}</Text>
              </View>
              {/* 7 day columns */}
              {[0, 1, 2, 3, 4, 5].map((day) => (
                <View key={day} style={styles.checkCell}>
                  <Text style={styles.checkText}>{getCheckMark(index + 22)}</Text>
                </View>
              ))}
              <View style={styles.checkCellLast}>
                <Text style={styles.checkText}>{getCheckMark(index + 22)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Checked By Section */}
        <View style={styles.checkedBySection}>
          <Text style={styles.checkedByText}>Checked By: {employeeName || ''}</Text>
        </View>

        {/* Defects / Comments Section */}
        <View style={styles.commentsBox}>
          <Text style={styles.commentsTitle}>DEFECTS / COMMENTS</Text>
          <Text style={styles.commentsText}>
            {defectsAndComments || '...........................................................................................................................................................'}
          </Text>
        </View>

        {/* Action Taken Section */}
        <View style={styles.commentsBox}>
          <Text style={styles.commentsTitle}>ACTION TAKEN (office use only)</Text>
          <Text style={styles.commentsText}>
            {inspection.manager_comments || '...........................................................................................................................................................'}
          </Text>
        </View>

        {/* Legend */}
        <View style={styles.legendSection}>
          <Text style={styles.legendText}>
            USE THE FOLLOWING:-  ✓ = IN ORDER    ✗ = REQUIRES ATTENTION    0 = N/A
          </Text>
          <Text style={styles.legendNote}>
            Any apparent defect which may effect safe operation of the vehicle or may lead to damage or imminent
          </Text>
          <Text style={styles.legendNote}>
            breakdown must be reported to your supervisor/workshop immediately
          </Text>
          <Text style={[styles.distributionText, { marginTop: 5 }]}>
            Distribution: White - Workshop Manager.    Yellow - Retained in Vehicle
          </Text>
        </View>
      </Page>
    </Document>
  );
}
