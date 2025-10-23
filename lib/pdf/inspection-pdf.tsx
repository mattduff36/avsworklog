import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { VehicleInspection, InspectionItem, INSPECTION_ITEMS } from '@/types/inspection';
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
  tableRowDefect: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    padding: 8,
    backgroundColor: '#fee2e2',
  },
  colNumber: {
    width: '8%',
  },
  colItem: {
    width: '40%',
  },
  colStatus: {
    width: '15%',
  },
  colComments: {
    width: '37%',
  },
  statusPass: {
    color: '#16a34a',
    fontWeight: 'bold',
  },
  statusFail: {
    color: '#dc2626',
    fontWeight: 'bold',
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
  summarySection: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#f0f9ff',
    borderLeftWidth: 3,
    borderLeftColor: '#0ea5e9',
    borderLeftStyle: 'solid',
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  defectSection: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#fef2f2',
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
    borderLeftStyle: 'solid',
  },
  defectTitle: {
    fontWeight: 'bold',
    marginBottom: 10,
    fontSize: 12,
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
});

interface InspectionPDFProps {
  inspection: VehicleInspection;
  items: InspectionItem[];
  vehicleReg?: string;
  employeeName?: string;
  employeeEmail?: string;
}

export function InspectionPDF({ inspection, items, vehicleReg, employeeName, employeeEmail }: InspectionPDFProps) {
  // Sort items by item number
  const sortedItems = items.sort((a, b) => a.item_number - b.item_number);
  
  // Calculate summary stats
  const passCount = sortedItems.filter(item => item.status === 'ok').length;
  const failCount = sortedItems.filter(item => item.status === 'defect').length;
  const defects = sortedItems.filter(item => item.status === 'defect');

  // Get status style
  const getStatusStyle = () => {
    switch (inspection.status) {
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

  // Get row style based on status
  const getRowStyle = (item: InspectionItem, index: number) => {
    if (item.status === 'defect') {
      return styles.tableRowDefect;
    }
    return index % 2 === 0 ? styles.tableRow : styles.tableRowAlt;
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>SQUIRES</Text>
          <Text style={styles.subtitle}>Vehicle Safety Inspection</Text>
        </View>

        {/* Inspection Information */}
        <View style={{ marginBottom: 15 }}>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Vehicle Reg:</Text>
            <Text style={styles.value}>{vehicleReg || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Inspector:</Text>
            <Text style={styles.value}>{employeeName || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Email:</Text>
            <Text style={styles.value}>{employeeEmail || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Inspection Date:</Text>
            <Text style={styles.value}>
              {inspection.inspection_end_date && inspection.inspection_end_date !== inspection.inspection_date
                ? `${formatDate(new Date(inspection.inspection_date))} - ${formatDate(new Date(inspection.inspection_end_date))}`
                : formatDate(new Date(inspection.inspection_date))
              }
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Status:</Text>
            <Text style={getStatusStyle()}>{inspection.status.toUpperCase()}</Text>
          </View>
        </View>

        {/* Summary */}
        <View style={styles.summarySection}>
          <View style={styles.summaryRow}>
            <Text style={styles.label}>Total Items:</Text>
            <Text>{sortedItems.length}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.label}>Passed:</Text>
            <Text style={styles.statusPass}>{passCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.label}>Failed:</Text>
            <Text style={styles.statusFail}>{failCount}</Text>
          </View>
        </View>

        {/* Inspection Items Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={styles.colNumber}>#</Text>
            <Text style={styles.colItem}>Inspection Item</Text>
            <Text style={styles.colStatus}>Status</Text>
            <Text style={styles.colComments}>Comments</Text>
          </View>

          {/* Table Rows */}
          {sortedItems.map((item: InspectionItem, index: number) => (
            <View key={item.id} style={getRowStyle(item, index)}>
              <Text style={styles.colNumber}>{item.item_number}</Text>
              <Text style={styles.colItem}>{INSPECTION_ITEMS[item.item_number - 1]}</Text>
              <Text style={[styles.colStatus, item.status === 'ok' ? styles.statusPass : styles.statusFail]}>
                {item.status === 'ok' ? 'PASS ✓' : 'FAIL ✗'}
              </Text>
              <Text style={styles.colComments}>{item.comments || '-'}</Text>
            </View>
          ))}
        </View>

        {/* Defects Section (if any) */}
        {defects.length > 0 && (
          <View style={styles.defectSection}>
            <Text style={styles.defectTitle}>⚠ DEFECTS REQUIRING ATTENTION ({defects.length})</Text>
            {defects.map((item, index) => (
              <View key={item.id} style={{ marginBottom: 8 }}>
                <Text style={{ fontWeight: 'bold' }}>
                  #{item.item_number} - {INSPECTION_ITEMS[item.item_number - 1]}
                </Text>
                {item.comments && (
                  <Text style={{ marginTop: 2, fontSize: 9 }}>
                    → {item.comments}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Manager Comments (if rejected) */}
        {inspection.manager_comments && (
          <View style={styles.commentsSection}>
            <Text style={styles.commentsLabel}>Manager Comments:</Text>
            <Text>{inspection.manager_comments}</Text>
          </View>
        )}

        {/* Review Information */}
        {inspection.reviewed_at && (
          <View style={{ marginTop: 15 }}>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Reviewed:</Text>
              <Text style={styles.value}>{formatDate(new Date(inspection.reviewed_at))}</Text>
            </View>
          </View>
        )}

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Inspector Signature:</Text>
              {inspection.signature_data ? (
                <Image style={styles.signatureImage} src={inspection.signature_data} alt="Inspector signature" />
              ) : (
                <View style={styles.signatureLine} />
              )}
              {inspection.signed_at && (
                <Text style={{ fontSize: 8, marginTop: 5 }}>
                  Signed: {formatDate(new Date(inspection.signed_at))}
                </Text>
              )}
            </View>
          </View>

          {inspection.reviewed_at && (
            <View style={styles.signatureRow}>
              <View style={styles.signatureBox}>
                <Text style={styles.signatureLabel}>Reviewed By:</Text>
                <View style={styles.signatureLine} />
                <Text style={{ fontSize: 8, marginTop: 5 }}>
                  Date: {formatDate(new Date(inspection.reviewed_at))}
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

