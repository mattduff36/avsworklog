import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { format } from 'date-fns';

const BRAND_YELLOW = '#f2cc0c';
const BRAND_YELLOW_LIGHT = '#fff6cc';
const BRAND_TEXT = '#111827';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 18,
    borderBottom: `2pt solid ${BRAND_YELLOW}`,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  logo: {
    width: 120,
    height: 64,
    objectFit: 'contain',
  },
  companyName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginBottom: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: '#64748b',
    marginBottom: 3,
  },
  section: {
    marginTop: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 6,
    color: BRAND_TEXT,
    backgroundColor: BRAND_YELLOW,
    padding: 6,
    borderRadius: 2,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingVertical: 1,
  },
  label: {
    fontWeight: 'bold',
    width: 140,
    color: '#64748b',
    fontSize: 9,
  },
  value: {
    flex: 1,
    color: '#1e293b',
    fontSize: 9.5,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: BRAND_YELLOW_LIGHT,
    border: `1pt solid ${BRAND_YELLOW}`,
    borderRadius: 3,
    marginBottom: 10,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: BRAND_TEXT,
  },
  statLabel: {
    fontSize: 8,
    color: '#64748b',
  },
  checklistSectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  checklistSectionDescription: {
    fontSize: 8.5,
    color: '#64748b',
    marginBottom: 5,
  },
  checklistTableHeader: {
    flexDirection: 'row',
    border: '1pt solid #d1d5db',
    borderBottom: '0pt solid transparent',
    backgroundColor: BRAND_YELLOW_LIGHT,
  },
  checklistTableHeaderCellLabel: {
    width: '46%',
    borderRight: '1pt solid #d1d5db',
    padding: 5,
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#334155',
  },
  checklistTableHeaderCellValue: {
    width: '54%',
    padding: 5,
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#334155',
  },
  checklistRow: {
    flexDirection: 'row',
    border: '1pt solid #e2e8f0',
    borderTop: '0pt solid transparent',
  },
  checklistLabelCell: {
    width: '46%',
    borderRight: '1pt solid #e2e8f0',
    padding: 5,
    fontSize: 8.5,
    color: '#1f2937',
    lineHeight: 1.35,
  },
  checklistValueCell: {
    width: '54%',
    padding: 5,
    fontSize: 8.5,
    color: '#0f172a',
    lineHeight: 1.35,
  },
  requiredMarker: {
    color: '#dc2626',
  },
  emptyValue: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  signatureMeta: {
    fontSize: 8.5,
    color: '#0f172a',
  },
  signatureImage: {
    marginTop: 4,
    width: 150,
    height: 45,
    objectFit: 'contain',
    border: '1pt solid #e2e8f0',
    padding: 2,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    padding: '2pt 7pt',
    borderRadius: 4,
    fontSize: 8,
    fontWeight: 'bold',
  },
  statusCompleted: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
  },
  statusPending: {
    backgroundColor: BRAND_YELLOW,
    color: BRAND_TEXT,
  },
  valueBadge: {
    alignSelf: 'flex-start',
    borderRadius: 3,
    padding: '2pt 6pt',
    fontSize: 8,
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 8,
    borderTop: '1pt solid #e2e8f0',
    paddingTop: 10,
  },
});

export interface V2PdfFieldData {
  field_key: string;
  label: string;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature';
  is_required: boolean;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

export interface V2PdfSectionData {
  section_key: string;
  title: string;
  description: string | null;
  fields: V2PdfFieldData[];
}

interface WorkshopAttachmentPDFProps {
  templateName: string;
  templateDescription: string | null;
  taskTitle: string;
  taskCategory: string;
  taskStatus: string;
  attachmentStatus: 'pending' | 'completed';
  completedAt: string | null;
  createdAt: string;
  v2Sections: V2PdfSectionData[];
  assetName: string | null;
  assetType: 'van' | 'plant' | 'hgv' | null;
  logoSrc?: string | null;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isSignatureComplete(responseJson: Record<string, unknown> | null | undefined): boolean {
  if (!responseJson) return false;
  const dataUrl = normalizeValue(responseJson.data_url);
  const signedBy = normalizeValue(responseJson.signed_by_name);
  const signedAt = normalizeValue(responseJson.signed_at);
  return dataUrl.length > 0 && signedBy.length > 0 && signedAt.length > 0;
}

function formatDateSafe(value: string): string {
  try {
    return format(new Date(value), 'PPP');
  } catch {
    return value;
  }
}

function formatDateTimeSafe(value: string): string {
  try {
    return format(new Date(value), 'PPP p');
  } catch {
    return value;
  }
}

function getMarkingCodeLabel(value: string): string {
  const lookup = new Map([
    ['serviceable', 'Pass'],
    ['attention', 'Fail'],
    ['not_checked', 'N/A'],
    ['not_applicable', 'N/A'],
    ['monitor', 'Monitor'],
  ]);
  return lookup.get(value) || value;
}

function getYesNoLabel(value: string): string {
  const lookup = new Map([
    ['yes', 'Yes'],
    ['no', 'No'],
    ['na', 'N/A'],
  ]);
  return lookup.get(value) || value;
}

function isV2FieldAnswered(field: V2PdfFieldData): boolean {
  if (field.field_type === 'signature') return isSignatureComplete(field.response_json);
  return normalizeValue(field.response_value).length > 0;
}

function displayValue(field: V2PdfFieldData): string {
  const value = normalizeValue(field.response_value);
  if (!value) return '';
  if (field.field_type === 'marking_code') return getMarkingCodeLabel(value);
  if (field.field_type === 'yes_no') return getYesNoLabel(value);
  if (field.field_type === 'date') return formatDateSafe(value);
  return value;
}

interface BadgeAppearance {
  label: string;
  backgroundColor: string;
  textColor: string;
}

function getBadgeAppearance(field: V2PdfFieldData): BadgeAppearance | null {
  const value = normalizeValue(field.response_value).toLowerCase();
  if (!value) return null;

  if (field.field_type === 'marking_code') {
    if (value === 'serviceable') return { label: 'Pass', backgroundColor: '#16a34a', textColor: '#ffffff' };
    if (value === 'monitor') return { label: 'Monitor', backgroundColor: '#f59e0b', textColor: BRAND_TEXT };
    if (value === 'attention') return { label: 'Fail', backgroundColor: '#dc2626', textColor: '#ffffff' };
    if (value === 'not_checked') return { label: 'N/A', backgroundColor: '#9ca3af', textColor: BRAND_TEXT };
    if (value === 'not_applicable') return { label: 'N/A', backgroundColor: '#9ca3af', textColor: BRAND_TEXT };
    return { label: getMarkingCodeLabel(value), backgroundColor: '#9ca3af', textColor: BRAND_TEXT };
  }

  if (field.field_type === 'yes_no') {
    if (value === 'yes') return { label: 'Yes', backgroundColor: '#16a34a', textColor: '#ffffff' };
    if (value === 'no') return { label: 'No', backgroundColor: '#dc2626', textColor: '#ffffff' };
    if (value === 'na') return { label: 'N/A', backgroundColor: '#9ca3af', textColor: BRAND_TEXT };
  }

  return null;
}

export function WorkshopAttachmentPDF({
  templateName,
  templateDescription,
  taskTitle,
  taskCategory,
  taskStatus,
  attachmentStatus,
  completedAt,
  createdAt,
  v2Sections,
  assetName,
  assetType,
  logoSrc = null,
}: WorkshopAttachmentPDFProps) {
  const itemCount = v2Sections.reduce((count, section) => count + section.fields.length, 0);
  const displayedAnsweredCount = v2Sections.reduce((count, section) => (
    count + section.fields.filter((field) => isV2FieldAnswered(field)).length
  ), 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.companyName}>A&V SQUIRES Plant Co. Ltd.</Text>
              <Text style={styles.title}>{templateName}</Text>
              {templateDescription && (
                <Text style={styles.subtitle}>{templateDescription}</Text>
              )}
              <Text style={styles.subtitle}>
                Workshop Task Attachment Report
              </Text>
            </View>
            {logoSrc ? <Image src={logoSrc} style={styles.logo} /> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Task Category:</Text>
            <Text style={styles.value}>{taskCategory}</Text>
          </View>
          {taskTitle && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Task Description:</Text>
              <Text style={styles.value}>{taskTitle}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.label}>Task Status:</Text>
            <Text style={styles.value}>
              {taskStatus === 'completed' ? 'Completed' : 'In Progress'}
            </Text>
          </View>
          {assetName && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>
                {assetType === 'plant' ? 'Plant:' : assetType === 'hgv' ? 'HGV:' : 'Van:'}
              </Text>
              <Text style={styles.value}>{assetName}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.label}>Attachment Status:</Text>
            <Text style={styles.value}>
              {attachmentStatus === 'completed' ? 'Completed' : 'Pending'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Created:</Text>
            <Text style={styles.value}>
              {formatDateSafe(createdAt)}
            </Text>
          </View>
          {completedAt && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Completed:</Text>
              <Text style={styles.value}>
                {formatDateTimeSafe(completedAt)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{itemCount}</Text>
            <Text style={styles.statLabel}>Total Items</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{displayedAnsweredCount}</Text>
            <Text style={styles.statLabel}>Answered</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {itemCount > 0 ? Math.round((displayedAnsweredCount / itemCount) * 100) : 100}%
            </Text>
            <Text style={styles.statLabel}>Completion</Text>
          </View>
        </View>

        <View style={styles.section}>
          {v2Sections.map((section) => (
            <View key={section.section_key} style={{ marginBottom: 10 }}>
              <Text style={styles.checklistSectionTitle}>{section.title}</Text>
              {section.description && (
                <Text style={styles.checklistSectionDescription}>{section.description}</Text>
              )}

              <View style={styles.checklistTableHeader}>
                <Text style={styles.checklistTableHeaderCellLabel}>Checklist Item</Text>
                <Text style={styles.checklistTableHeaderCellValue}>Result / Response</Text>
              </View>

              {section.fields.map((field) => {
                const renderedValue = displayValue(field);
                const badge = getBadgeAppearance(field);
                const hasValue = renderedValue.length > 0;
                const signatureName = normalizeValue(field.response_json?.signed_by_name);
                const signatureAt = normalizeValue(field.response_json?.signed_at);
                const signatureDataUrl = normalizeValue(field.response_json?.data_url);

                return (
                  <View key={`${section.section_key}::${field.field_key}`} style={styles.checklistRow} wrap={false}>
                    <Text style={styles.checklistLabelCell}>
                      {field.label}
                      {field.is_required && <Text style={styles.requiredMarker}> *</Text>}
                    </Text>

                    <View style={styles.checklistValueCell}>
                      {field.field_type === 'signature' ? (
                        <>
                          <Text style={styles.signatureMeta}>
                            {isSignatureComplete(field.response_json)
                              ? `Signed by ${signatureName} on ${formatDateTimeSafe(signatureAt)}`
                              : 'No signature captured'}
                          </Text>
                          {signatureDataUrl && (
                            <Image src={signatureDataUrl} style={styles.signatureImage} />
                          )}
                        </>
                      ) : hasValue ? (
                        badge ? (
                          <Text style={{ ...styles.valueBadge, backgroundColor: badge.backgroundColor, color: badge.textColor }}>
                            {badge.label}
                          </Text>
                        ) : (
                          <Text>{renderedValue}</Text>
                        )
                      ) : (
                        <Text style={styles.emptyValue}>No response</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <Text style={attachmentStatus === 'completed' ? { ...styles.statusBadge, ...styles.statusCompleted } : { ...styles.statusBadge, ...styles.statusPending }}>
          {attachmentStatus === 'completed' ? 'Attachment Completed' : 'Attachment In Progress'}
        </Text>

        <View style={styles.footer}>
          <Text>
            Generated by SquireApp • {format(new Date(), 'PPP p')}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
