import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { QuoteFinancialAdjustment } from '@/app/(dashboard)/quotes/types';

interface QuoteAdjustmentPDFProps {
  adjustment: QuoteFinancialAdjustment;
  logoSrc?: string | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#111827',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottom: '2pt solid #f2cc0c',
    paddingBottom: 14,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  reference: {
    marginTop: 6,
    color: '#475569',
  },
  logo: {
    width: 150,
    height: 70,
    objectFit: 'contain',
  },
  warning: {
    padding: 10,
    backgroundColor: '#fff6cc',
    border: '1pt solid #f2cc0c',
    marginBottom: 18,
    lineHeight: 1.4,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottom: '0.5pt solid #e2e8f0',
  },
  label: {
    width: '35%',
    color: '#475569',
  },
  value: {
    width: '65%',
    fontWeight: 'bold',
  },
  note: {
    lineHeight: 1.5,
    color: '#334155',
  },
  footer: {
    position: 'absolute',
    left: 40,
    right: 40,
    bottom: 28,
    borderTop: '0.5pt solid #cbd5e1',
    paddingTop: 8,
    fontSize: 8,
    color: '#64748b',
  },
});

function formatMoney(value: unknown) {
  return `£${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatType(value: string) {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function QuoteAdjustmentPDF({
  adjustment,
  logoSrc,
}: QuoteAdjustmentPDFProps) {
  const snapshot = adjustment.document_snapshot || {};
  const customer =
    snapshot.customer && typeof snapshot.customer === 'object'
      ? (snapshot.customer as Record<string, unknown>)
      : {};
  const before =
    snapshot.before_summary && typeof snapshot.before_summary === 'object'
      ? (snapshot.before_summary as Record<string, unknown>)
      : {};
  const after =
    snapshot.after_summary && typeof snapshot.after_summary === 'object'
      ? (snapshot.after_summary as Record<string, unknown>)
      : {};

  return (
    <Document
      title={`Adjustment Record ${adjustment.adjustment_number}`}
      author="A.V. Squires"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Adjustment Record</Text>
            <Text style={styles.reference}>{adjustment.adjustment_number}</Text>
          </View>
          {/* react-pdf Image is not an HTML image and has no alt prop. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logoSrc ? <Image src={logoSrc} style={styles.logo} /> : null}
        </View>

        <Text style={styles.warning}>
          Reconciliation reference only. This document is not an official invoice,
          credit note, refund receipt, or VAT document. Sage remains the accounting
          source of truth.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Adjustment</Text>
          <DetailRow
            label="Type"
            value={formatType(adjustment.adjustment_type)}
          />
          <DetailRow label="Effective date" value={adjustment.effective_date} />
          <DetailRow
            label="Amount"
            value={
              adjustment.amount > 0
                ? formatMoney(adjustment.amount)
                : 'Metadata only'
            }
          />
          <DetailRow
            label="Quote"
            value={String(
              snapshot.quote_reference || snapshot.base_quote_reference || '—',
            )}
          />
          <DetailRow
            label="Customer"
            value={String(customer.company_name || '—')}
          />
          <DetailRow
            label="External / Sage reference"
            value={adjustment.external_reference || '—'}
          />
          <DetailRow
            label="Entered by"
            value={adjustment.actor?.full_name || String(snapshot.created_by || '—')}
          />
          <DetailRow label="Recorded at" value={adjustment.created_at} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reason</Text>
          <Text style={styles.note}>{adjustment.reason}</Text>
          {adjustment.notes ? (
            <Text style={[styles.note, { marginTop: 8 }]}>{adjustment.notes}</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Thread reconciliation</Text>
          <DetailRow
            label="Adjusted quote value before"
            value={formatMoney(before.adjusted_quote_value)}
          />
          <DetailRow
            label="Adjusted quote value after"
            value={formatMoney(after.adjusted_quote_value)}
          />
          <DetailRow
            label="Net invoiced before"
            value={formatMoney(before.net_invoiced)}
          />
          <DetailRow
            label="Net invoiced after"
            value={formatMoney(after.net_invoiced)}
          />
          <DetailRow
            label="Remaining to invoice after"
            value={formatMoney(after.remaining_to_invoice)}
          />
        </View>

        <Text style={styles.footer}>
          Generated from the immutable quote financial adjustment ledger.
        </Text>
      </Page>
    </Document>
  );
}
