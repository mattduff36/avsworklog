import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 20,
    borderBottom: '2pt solid #1e3a5f',
    paddingBottom: 15,
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e3a5f',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 3,
  },
  section: {
    marginTop: 15,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#ffffff',
    backgroundColor: '#1e3a5f',
    padding: 8,
    borderRadius: 3,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 5,
    paddingVertical: 2,
  },
  label: {
    fontWeight: 'bold',
    width: 130,
    color: '#64748b',
    fontSize: 10,
  },
  value: {
    flex: 1,
    color: '#1e293b',
    fontSize: 10,
  },
  questionCard: {
    marginBottom: 8,
    padding: 10,
    border: '1pt solid #e2e8f0',
    borderRadius: 4,
    backgroundColor: '#f8fafc',
  },
  questionCardCompleted: {
    marginBottom: 8,
    padding: 10,
    border: '1pt solid #bbf7d0',
    borderRadius: 4,
    backgroundColor: '#f0fdf4',
  },
  questionText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 4,
  },
  responseText: {
    fontSize: 10,
    color: '#334155',
    paddingLeft: 8,
    borderLeft: '2pt solid #3b82f6',
    paddingVertical: 2,
  },
  noResponse: {
    fontSize: 9,
    color: '#94a3b8',
    fontStyle: 'italic',
    paddingLeft: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkboxChecked: {
    width: 14,
    height: 14,
    border: '1.5pt solid #16a34a',
    borderRadius: 2,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxUnchecked: {
    width: 14,
    height: 14,
    border: '1.5pt solid #94a3b8',
    borderRadius: 2,
    backgroundColor: '#ffffff',
  },
  checkMark: {
    fontSize: 9,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  statusBadge: {
    padding: '3pt 8pt',
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 'bold',
  },
  statusCompleted: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
  },
  statusPending: {
    backgroundColor: '#f59e0b',
    color: '#ffffff',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#f1f5f9',
    border: '1pt solid #e2e8f0',
    borderRadius: 4,
    marginBottom: 15,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e3a5f',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 8,
    color: '#64748b',
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
  requiredMarker: {
    color: '#ef4444',
    fontSize: 10,
  },
});

interface QuestionData {
  id: string;
  question_text: string;
  question_type: string;
  is_required: boolean;
  sort_order: number;
}

interface ResponseData {
  question_id: string;
  response_value: string | null;
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
  questions: QuestionData[];
  responses: ResponseData[];
  assetName: string | null;
  assetType: 'vehicle' | 'plant' | null;
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
  questions,
  responses,
  assetName,
  assetType,
}: WorkshopAttachmentPDFProps) {
  const responsesMap = new Map(responses.map(r => [r.question_id, r.response_value]));

  const answeredCount = questions.filter(q => {
    const val = responsesMap.get(q.id);
    if (!val) return false;
    if (q.question_type === 'checkbox') return val === 'true';
    return val.trim() !== '';
  }).length;

  // Sort so completed/answered items appear first, preserving relative order within each group
  const sortedQuestions = [...questions].sort((a, b) => {
    const aDone = isItemCompleted(a);
    const bDone = isItemCompleted(b);
    if (aDone === bDone) return 0;
    return aDone ? -1 : 1;
  });

  function isItemCompleted(q: QuestionData): boolean {
    const val = responsesMap.get(q.id);
    if (!val) return false;
    if (q.question_type === 'checkbox') return val === 'true';
    return val.trim() !== '';
  }

  function formatResponseValue(question: QuestionData, value: string | null): string {
    if (!value || value.trim() === '') return '';
    if (question.question_type === 'date') {
      try {
        return format(new Date(value), 'PPP');
      } catch {
        return value;
      }
    }
    return value;
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.companyName}>A&V SQUIRES Plant Co. Ltd.</Text>
          <Text style={styles.title}>{templateName}</Text>
          {templateDescription && (
            <Text style={styles.subtitle}>{templateDescription}</Text>
          )}
          <Text style={styles.subtitle}>
            Workshop Task Attachment Report
          </Text>
        </View>

        {/* Document Information */}
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
              <Text style={styles.label}>{assetType === 'plant' ? 'Plant:' : 'Vehicle:'}</Text>
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
              {format(new Date(createdAt), 'PPP')}
            </Text>
          </View>
          {completedAt && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Completed:</Text>
              <Text style={styles.value}>
                {format(new Date(completedAt), 'PPP p')}
              </Text>
            </View>
          )}
        </View>

        {/* Summary Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{questions.length}</Text>
            <Text style={styles.statLabel}>Total Items</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{answeredCount}</Text>
            <Text style={styles.statLabel}>Answered</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 100}%
            </Text>
            <Text style={styles.statLabel}>Completion</Text>
          </View>
        </View>

        {/* Questions & Responses – completed/answered items first */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Checklist Items</Text>
          {sortedQuestions.map((question) => {
            const responseValue = responsesMap.get(question.id);
            const hasResponse = responseValue && responseValue.trim() !== '';
            const isCheckbox = question.question_type === 'checkbox';
            const isChecked = responseValue === 'true';

            return (
              <View
                key={question.id}
                style={isCheckbox && isChecked ? styles.questionCardCompleted : styles.questionCard}
                wrap={false}
              >
                {isCheckbox ? (
                  <View style={styles.checkboxRow}>
                    <View style={isChecked ? styles.checkboxChecked : styles.checkboxUnchecked}>
                      {isChecked && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <Text style={styles.questionText}>
                      {question.question_text}
                      {question.is_required && (
                        <Text style={styles.requiredMarker}> *</Text>
                      )}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.questionText}>
                      {question.question_text}
                      {question.is_required && (
                        <Text style={styles.requiredMarker}> *</Text>
                      )}
                    </Text>
                    {hasResponse ? (
                      <Text style={styles.responseText}>
                        {formatResponseValue(question, responseValue ?? null)}
                      </Text>
                    ) : (
                      <Text style={styles.noResponse}>No response</Text>
                    )}
                  </>
                )}
              </View>
            );
          })}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>
            Generated by AVS Worklog System • {format(new Date(), 'PPP p')}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
