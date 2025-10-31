import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 20,
    borderBottom: '2pt solid #e11d48',
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#e11d48',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 3,
  },
  section: {
    marginTop: 15,
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#1e293b',
    borderBottom: '1pt solid #e2e8f0',
    paddingBottom: 5,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  label: {
    fontWeight: 'bold',
    width: 120,
    color: '#475569',
  },
  value: {
    flex: 1,
    color: '#1e293b',
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    padding: 8,
    fontWeight: 'bold',
    borderBottom: '1pt solid #cbd5e1',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottom: '0.5pt solid #e2e8f0',
  },
  tableCell: {
    flex: 1,
  },
  signatureBox: {
    marginTop: 10,
    padding: 10,
    border: '1pt solid #cbd5e1',
    borderRadius: 4,
  },
  signatureImage: {
    width: 200,
    height: 60,
    objectFit: 'contain',
    marginTop: 5,
  },
  badge: {
    padding: '3pt 8pt',
    borderRadius: 4,
    fontSize: 9,
  },
  badgeSigned: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
  },
  badgePending: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 8,
    borderTop: '0.5pt solid #e2e8f0',
    paddingTop: 10,
  },
});

interface RAMSExportDocumentProps {
  document: {
    id: string;
    title: string;
    description: string | null;
    file_name: string;
    file_size: number;
    file_type: string;
    created_at: string;
    uploader_name: string;
  };
  assignments: Array<{
    id: string;
    status: 'pending' | 'read' | 'signed';
    signed_at: string | null;
    signature_data: string | null;
    employee: {
      full_name: string;
      role: string;
    };
  }>;
  visitorSignatures: Array<{
    id: string;
    visitor_name: string;
    visitor_company: string | null;
    visitor_role: string | null;
    signed_at: string;
    signature_data: string;
    recorder: {
      full_name: string;
    };
  }>;
}

export function RAMSExportDocument({
  document,
  assignments,
  visitorSignatures,
}: RAMSExportDocumentProps) {
  const signedAssignments = assignments.filter(a => a.status === 'signed');
  const totalSigned = signedAssignments.length;
  const complianceRate =
    assignments.length > 0 ? Math.round((totalSigned / assignments.length) * 100) : 0;

  return (
    <Document>
      {/* Cover Page */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{document.title}</Text>
          <Text style={styles.subtitle}>Risk Assessment & Method Statement - Signature Record</Text>
          <Text style={styles.subtitle}>
            Exported on {format(new Date(), 'PPP')} at {format(new Date(), 'p')}
          </Text>
        </View>

        {/* Document Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Document Information</Text>
          {document.description && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Description:</Text>
              <Text style={styles.value}>{document.description}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.label}>File Name:</Text>
            <Text style={styles.value}>{document.file_name}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>File Type:</Text>
            <Text style={styles.value}>{document.file_type.toUpperCase()}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Uploaded By:</Text>
            <Text style={styles.value}>{document.uploader_name}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Upload Date:</Text>
            <Text style={styles.value}>
              {format(new Date(document.created_at), 'PPP')}
            </Text>
          </View>
        </View>

        {/* Compliance Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compliance Summary</Text>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Total Assigned:</Text>
            <Text style={styles.value}>{assignments.length} employees</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Total Signed:</Text>
            <Text style={styles.value}>{totalSigned} employees</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Compliance Rate:</Text>
            <Text style={styles.value}>{complianceRate}%</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Visitor Signatures:</Text>
            <Text style={styles.value}>{visitorSignatures.length}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>
            This document is a certified record of RAMS acknowledgment and signature compliance
          </Text>
          <Text>Generated by AVS Worklog System • {format(new Date(), 'PPP')}</Text>
        </View>
      </Page>

      {/* Employee Signatures */}
      {signedAssignments.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.title}>Employee Signatures</Text>
            <Text style={styles.subtitle}>{document.title}</Text>
          </View>

          {signedAssignments.map((assignment, index) => (
            <View key={assignment.id} style={styles.section}>
              <View style={styles.signatureBox}>
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Employee Name:</Text>
                  <Text style={styles.value}>{assignment.employee.full_name}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Role:</Text>
                  <Text style={styles.value}>{assignment.employee.role}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Signed Date:</Text>
                  <Text style={styles.value}>
                    {assignment.signed_at
                      ? format(new Date(assignment.signed_at), 'PPP p')
                      : 'N/A'}
                  </Text>
                </View>
                {assignment.signature_data && (
                  <View>
                    <Text style={{ ...styles.label, marginTop: 10, marginBottom: 5 }}>
                      Signature:
                    </Text>
                    <Image src={assignment.signature_data} style={styles.signatureImage} />
                  </View>
                )}
              </View>
            </View>
          ))}

          <View style={styles.footer}>
            <Text>Employee Signatures • {format(new Date(), 'PPP')}</Text>
          </View>
        </Page>
      )}

      {/* Visitor Signatures */}
      {visitorSignatures.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.title}>Visitor Signatures</Text>
            <Text style={styles.subtitle}>{document.title}</Text>
          </View>

          {visitorSignatures.map((signature, index) => (
            <View key={signature.id} style={styles.section}>
              <View style={styles.signatureBox}>
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Visitor Name:</Text>
                  <Text style={styles.value}>{signature.visitor_name}</Text>
                </View>
                {signature.visitor_company && (
                  <View style={styles.infoRow}>
                    <Text style={styles.label}>Company:</Text>
                    <Text style={styles.value}>{signature.visitor_company}</Text>
                  </View>
                )}
                {signature.visitor_role && (
                  <View style={styles.infoRow}>
                    <Text style={styles.label}>Role:</Text>
                    <Text style={styles.value}>{signature.visitor_role}</Text>
                  </View>
                )}
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Signed Date:</Text>
                  <Text style={styles.value}>
                    {format(new Date(signature.signed_at), 'PPP p')}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.label}>Recorded By:</Text>
                  <Text style={styles.value}>{signature.recorder.full_name}</Text>
                </View>
                <View>
                  <Text style={{ ...styles.label, marginTop: 10, marginBottom: 5 }}>
                    Signature:
                  </Text>
                  <Image src={signature.signature_data} style={styles.signatureImage} />
                </View>
              </View>
            </View>
          ))}

          <View style={styles.footer}>
            <Text>Page {signedAssignments.length > 0 ? '3+' : '2+'} • Visitor Signatures</Text>
          </View>
        </Page>
      )}
    </Document>
  );
}

