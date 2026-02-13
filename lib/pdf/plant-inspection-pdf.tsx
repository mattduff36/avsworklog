import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';
import { formatDate } from '@/lib/utils/date';

// Styles for the Plant Inspection PDF
const styles = StyleSheet.create({
  page: {
    padding: 20,
    fontSize: 7,
    fontFamily: 'Helvetica',
  },
  header: {
    textAlign: 'center',
    marginBottom: 15,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 9,
    color: '#666',
  },
  infoSection: {
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 10,
  },
  infoBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000',
    padding: 6,
  },
  label: {
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 2,
    color: '#666',
  },
  value: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  hoursTable: {
    borderWidth: 1,
    borderColor: '#000',
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  dayHeader: {
    flex: 1,
    padding: 5,
    textAlign: 'center',
    fontSize: 7,
    fontWeight: 'bold',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  dayHeaderLast: {
    flex: 1,
    padding: 5,
    textAlign: 'center',
    fontSize: 7,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
  },
  hoursCell: {
    flex: 1,
    padding: 5,
    textAlign: 'center',
    fontSize: 8,
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  hoursCellLast: {
    flex: 1,
    padding: 5,
    textAlign: 'center',
    fontSize: 8,
  },
  checklist: {
    borderWidth: 1,
    borderColor: '#000',
    marginBottom: 10,
  },
  checklistHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    padding: 4,
  },
  checklistNumberHeader: {
    width: '5%',
    fontSize: 7,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  checklistItemHeader: {
    width: '30%',
    fontSize: 7,
    fontWeight: 'bold',
    paddingLeft: 4,
  },
  checklistDayHeader: {
    width: '9.29%', // 65% / 7 days
    fontSize: 6,
    fontWeight: 'bold',
    textAlign: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#000',
    paddingVertical: 2,
  },
  checklistRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    minHeight: 16,
  },
  checklistRowLast: {
    flexDirection: 'row',
    minHeight: 16,
  },
  itemNumber: {
    width: '5%',
    padding: 3,
    fontSize: 7,
    textAlign: 'center',
    justifyContent: 'center',
  },
  itemDescription: {
    width: '30%',
    padding: 3,
    fontSize: 6,
    justifyContent: 'center',
  },
  statusCell: {
    width: '9.29%',
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#000',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  okText: {
    color: '#22c55e',
  },
  failText: {
    color: '#ef4444',
  },
  naText: {
    color: '#999',
  },
  signatureSection: {
    marginTop: 15,
    marginBottom: 10,
  },
  signatureRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  signatureLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    marginRight: 10,
  },
  signatureLine: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 20,
  },
  commentsSection: {
    borderWidth: 1,
    borderColor: '#000',
    padding: 8,
    minHeight: 60,
  },
  commentsLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  commentsText: {
    fontSize: 7,
    lineHeight: 1.4,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    textAlign: 'center',
    fontSize: 6,
    color: '#666',
  },
});

interface PlantInspectionPDFProps {
  inspection: {
    id: string;
    inspection_date: string;
    inspection_end_date: string;
    inspector_comments: string | null;
    signature_data: string | null;
  };
  plant: {
    plant_id: string;
    nickname: string | null;
    serial_number: string | null;
    vehicle_categories: { name: string } | null;
  };
  operator: {
    full_name: string;
  };
  items: Array<{
    item_number: number;
    item_description: string;
    day_of_week: number;
    status: 'ok' | 'attention' | 'na';
    comments: string | null;
  }>;
  dailyHours: Array<{
    day_of_week: number;
    hours: number | null;
  }>;
}

export function PlantInspectionPDF({ 
  inspection, 
  plant, 
  operator, 
  items, 
  dailyHours 
}: PlantInspectionPDFProps) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>OPERATED PLANT INSPECTION PAD</Text>
          <Text style={styles.subtitle}>
            Week: {formatDate(inspection.inspection_date)} - {formatDate(inspection.inspection_end_date)}
          </Text>
        </View>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <View style={styles.infoBox}>
              <Text style={styles.label}>PLANT NUMBER</Text>
              <Text style={styles.value}>
                {plant.plant_id}
                {plant.nickname && ` (${plant.nickname})`}
                {plant.serial_number && ` (SN: ${plant.serial_number})`}
              </Text>
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.label}>OPERATOR'S NAME</Text>
              <Text style={styles.value}>{operator.full_name}</Text>
            </View>
          </View>
          {plant.vehicle_categories && (
            <View style={[styles.infoBox, { marginBottom: 8 }]}>
              <Text style={styles.label}>CATEGORY</Text>
              <Text style={styles.value}>{plant.vehicle_categories.name}</Text>
            </View>
          )}
        </View>

        {/* Hours Table */}
        <View style={styles.hoursTable}>
          <View style={styles.tableHeader}>
            {dayNames.map((day, idx) => (
              <Text 
                key={day} 
                style={idx === 6 ? styles.dayHeaderLast : styles.dayHeader}
              >
                {day}
              </Text>
            ))}
          </View>
          <View style={styles.tableRow}>
            {[1, 2, 3, 4, 5, 6, 7].map((dayOfWeek, idx) => {
              const hours = dailyHours.find(h => h.day_of_week === dayOfWeek);
              return (
                <Text 
                  key={dayOfWeek} 
                  style={idx === 6 ? styles.hoursCellLast : styles.hoursCell}
                >
                  {hours?.hours ?? '-'}
                </Text>
              );
            })}
          </View>
        </View>

        {/* Checklist */}
        <View style={styles.checklist}>
          {/* Header Row */}
          <View style={styles.checklistHeaderRow}>
            <Text style={styles.checklistNumberHeader}>#</Text>
            <Text style={styles.checklistItemHeader}>Item</Text>
            {dayNames.map((day) => (
              <Text key={day} style={styles.checklistDayHeader}>
                {day}
              </Text>
            ))}
          </View>

          {/* Checklist Rows */}
          {PLANT_INSPECTION_ITEMS.map((item, idx) => {
            const itemNumber = idx + 1;
            const isLast = idx === PLANT_INSPECTION_ITEMS.length - 1;
            
            return (
              <View 
                key={itemNumber} 
                style={isLast ? styles.checklistRowLast : styles.checklistRow}
              >
                <View style={styles.itemNumber}>
                  <Text>{itemNumber}</Text>
                </View>
                <View style={styles.itemDescription}>
                  <Text>{item}</Text>
                </View>
                {[1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => {
                  const itemStatus = items.find(
                    i => i.item_number === itemNumber && i.day_of_week === dayOfWeek
                  );
                  
                  return (
                    <View key={dayOfWeek} style={styles.statusCell}>
                      {itemStatus?.status === 'ok' && (
                        <Text style={[styles.statusText, styles.okText]}>✓</Text>
                      )}
                      {itemStatus?.status === 'attention' && (
                        <Text style={[styles.statusText, styles.failText]}>✗</Text>
                      )}
                      {itemStatus?.status === 'na' && (
                        <Text style={[styles.statusText, styles.naText]}>N/A</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>Checked By:</Text>
            <View style={styles.signatureLine} />
          </View>
        </View>

        {/* Defects/Comments Section */}
        <View style={styles.commentsSection}>
          <Text style={styles.commentsLabel}>Defects / Comments:</Text>
          <Text style={styles.commentsText}>
            {inspection.inspector_comments || 'None'}
          </Text>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Plant Inspection Report • Generated: {formatDate(new Date().toISOString())}
        </Text>
      </Page>
    </Document>
  );
}
