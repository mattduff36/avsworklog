import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';
import { formatDate } from '@/lib/utils/date';

const styles = StyleSheet.create({
  page: { padding: 20, fontSize: 8, fontFamily: 'Helvetica' },
  header: { textAlign: 'center', marginBottom: 12 },
  title: { fontSize: 13, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 9, color: '#444' },
  infoRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  infoBox: { flex: 1, borderWidth: 1, borderColor: '#000', padding: 6 },
  label: { fontSize: 7, fontWeight: 'bold', marginBottom: 2, color: '#666' },
  value: { fontSize: 9, fontWeight: 'bold' },
  checklist: { borderWidth: 1, borderColor: '#000', marginTop: 4 },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', backgroundColor: '#f0f0f0' },
  cellNum: { width: '7%', padding: 4, borderRightWidth: 1, borderRightColor: '#000', textAlign: 'center' },
  cellItem: { width: '56%', padding: 4, borderRightWidth: 1, borderRightColor: '#000' },
  cellStatus: { width: '12%', padding: 4, borderRightWidth: 1, borderRightColor: '#000', textAlign: 'center' },
  cellComments: { width: '25%', padding: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  rowLast: { flexDirection: 'row' },
  commentsSection: { borderWidth: 1, borderColor: '#000', marginTop: 10, padding: 6, minHeight: 50 },
  commentsLabel: { fontSize: 8, fontWeight: 'bold', marginBottom: 3 },
  footer: { marginTop: 8, fontSize: 6, textAlign: 'center', color: '#666' },
});

interface HgvInspectionPDFProps {
  inspection: {
    id: string;
    inspection_date: string;
    current_mileage: number | null;
    inspector_comments: string | null;
  };
  hgv: {
    reg_number: string;
    nickname: string | null;
    hgv_categories: { name: string } | null;
  };
  operator: { full_name: string };
  items: Array<{
    item_number: number;
    item_description: string;
    status: 'ok' | 'attention' | 'na';
    comments: string | null;
  }>;
}

export function HgvInspectionPDF({ inspection, hgv, operator, items }: HgvInspectionPDFProps) {
  const itemMap = new Map(items.map(item => [item.item_number, item]));

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>HGV INSPECTION PAD</Text>
          <Text style={styles.subtitle}>Date: {formatDate(inspection.inspection_date)}</Text>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text style={styles.label}>REG NO.</Text>
            <Text style={styles.value}>{hgv.reg_number}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.label}>MILEAGE</Text>
            <Text style={styles.value}>{inspection.current_mileage ?? '-'}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.label}>DRIVER</Text>
            <Text style={styles.value}>{operator.full_name}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text style={styles.label}>CATEGORY</Text>
            <Text style={styles.value}>{hgv.hgv_categories?.name || 'Uncategorised'}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.label}>NICKNAME</Text>
            <Text style={styles.value}>{hgv.nickname || '-'}</Text>
          </View>
        </View>

        <View style={styles.checklist}>
          <View style={styles.headerRow}>
            <Text style={styles.cellNum}>#</Text>
            <Text style={styles.cellItem}>Item</Text>
            <Text style={styles.cellStatus}>Status</Text>
            <Text style={styles.cellComments}>Comments</Text>
          </View>
          {TRUCK_CHECKLIST_ITEMS.map((label, index) => {
            const itemNumber = index + 1;
            const item = itemMap.get(itemNumber);
            const rowStyle = index === TRUCK_CHECKLIST_ITEMS.length - 1 ? styles.rowLast : styles.row;
            const statusLabel = item?.status === 'ok' ? 'PASS' : item?.status === 'attention' ? 'FAIL' : item?.status === 'na' ? 'N/A' : '-';

            return (
              <View key={itemNumber} style={rowStyle}>
                <Text style={styles.cellNum}>{itemNumber}</Text>
                <Text style={styles.cellItem}>{label}</Text>
                <Text style={styles.cellStatus}>{statusLabel}</Text>
                <Text style={styles.cellComments}>{item?.comments || ''}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.commentsSection}>
          <Text style={styles.commentsLabel}>Inspector Notes</Text>
          <Text>{inspection.inspector_comments || 'None'}</Text>
        </View>

        <Text style={styles.footer}>
          Generated: {formatDate(new Date().toISOString())}
        </Text>
      </Page>
    </Document>
  );
}
