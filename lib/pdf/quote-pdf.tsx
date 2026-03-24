import React from 'react';
import { Document, Page, Text, View, StyleSheet, Link } from '@react-pdf/renderer';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 80,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1e293b',
  },
  /* ---- Header block ---- */
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  contactCol: {
    fontSize: 8,
    color: '#475569',
    lineHeight: 1.4,
  },
  companyName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e293b',
    textAlign: 'right',
  },
  companySubtitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#64748b',
    textAlign: 'right',
    marginBottom: 2,
  },
  addressLine: {
    fontSize: 8,
    color: '#475569',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
  headerDivider: {
    borderBottom: '2pt solid #1e293b',
    marginBottom: 14,
  },

  /* ---- Quote meta row ---- */
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  quoteRef: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  quoteDate: {
    fontSize: 10,
    color: '#475569',
  },
  attentionBlock: {
    marginBottom: 16,
  },
  attentionBold: {
    fontWeight: 'bold',
    fontSize: 10,
  },
  emailLink: {
    fontSize: 9,
    color: '#2563eb',
    textDecoration: 'underline',
  },
  salutation: {
    marginTop: 14,
    marginBottom: 14,
    fontSize: 10,
  },
  introText: {
    fontSize: 10,
    marginBottom: 14,
    lineHeight: 1.4,
  },

  /* ---- Project/Subject ---- */
  subjectBlock: {
    marginBottom: 10,
  },
  subjectBold: {
    fontWeight: 'bold',
    fontSize: 10,
  },
  subjectNormal: {
    fontSize: 10,
    marginBottom: 2,
  },

  /* ---- Line items table ---- */
  table: {
    marginTop: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#cbd5e1',
  },
  tableRowLast: {
    flexDirection: 'row',
  },
  colItem: { width: '40%', padding: 6, fontWeight: 'bold', fontSize: 9 },
  colQty: { width: '15%', padding: 6, textAlign: 'right', fontSize: 9 },
  colRate: { width: '20%', padding: 6, textAlign: 'right', fontSize: 9 },
  colTotal: { width: '25%', padding: 6, textAlign: 'right', fontSize: 9 },
  colItemHeader: { width: '40%', padding: 6, fontWeight: 'bold', fontSize: 9 },
  colQtyHeader: { width: '15%', padding: 6, textAlign: 'right', fontWeight: 'bold', fontSize: 9 },
  colRateHeader: { width: '20%', padding: 6, textAlign: 'right', fontWeight: 'bold', fontSize: 9 },
  colTotalHeader: { width: '25%', padding: 6, textAlign: 'right', fontWeight: 'bold', fontSize: 9 },

  /* ---- Totals ---- */
  totalRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  totalLabel: {
    width: '75%',
    padding: 6,
    fontWeight: 'bold',
    fontSize: 10,
  },
  totalValue: {
    width: '25%',
    padding: 6,
    textAlign: 'right',
    fontWeight: 'bold',
    fontSize: 10,
  },

  /* ---- Footer text ---- */
  disclaimerText: {
    fontSize: 9,
    color: '#475569',
    marginTop: 14,
    lineHeight: 1.5,
  },
  signoff: {
    marginTop: 30,
  },
  signoffLine: {
    fontSize: 10,
    color: '#475569',
  },
  signoffName: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  signoffTitle: {
    fontSize: 10,
    color: '#475569',
  },
  eAndOe: {
    position: 'absolute',
    right: 40,
    fontSize: 10,
    color: '#475569',
  },

  /* ---- Page footer ---- */
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'right',
    fontSize: 8,
    color: '#94a3b8',
    lineHeight: 1.4,
  },
  footerServices: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1e293b',
    textAlign: 'right',
    marginBottom: 2,
  },
  footerRegNo: {
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'right',
  },
});

function gbp(value: number): string {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface LineItem {
  description: string;
  quantity: number;
  unit?: string | null;
  unit_rate: number;
  line_total: number;
}

interface QuotePDFProps {
  quoteReference: string;
  baseQuoteReference?: string;
  quoteDate: string;
  attentionName: string;
  attentionEmail: string;
  salutation: string;
  projectDescription: string;
  subjectLine: string;
  siteAddress?: string;
  managerEmail?: string;
  lineItems: LineItem[];
  total: number;
  validityDays: number;
  signoffName: string;
  signoffTitle: string;
  versionLabel?: string;
  customFooterText?: string;
}

export function QuotePDF({
  quoteReference,
  baseQuoteReference,
  quoteDate,
  attentionName,
  attentionEmail,
  salutation,
  projectDescription,
  subjectLine,
  siteAddress,
  managerEmail,
  lineItems,
  total,
  validityDays,
  signoffName,
  signoffTitle,
  versionLabel,
  customFooterText,
}: QuotePDFProps) {
  const formattedDate = (() => {
    try {
      const d = new Date(quoteDate);
      const day = d.getDate();
      const suffix = [11, 12, 13].includes(day) ? 'th'
        : day % 10 === 1 ? 'st'
        : day % 10 === 2 ? 'nd'
        : day % 10 === 3 ? 'rd'
        : 'th';
      return `${day}${suffix} ${format(d, 'MMMM yyyy')}`;
    } catch {
      return quoteDate;
    }
  })();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.contactCol}>
            <Text>01636 812227</Text>
            <Text>OFFICE@AVSQUIRES.CO.UK</Text>
            <Text>AVSQUIRES.CO.UK</Text>
          </View>
          <View>
            <Text style={styles.companyName}>A&V SQUIRES</Text>
            <Text style={styles.companySubtitle}>PLANT CO. LTD.</Text>
          </View>
        </View>
        <Text style={styles.addressLine}>
          VIVIENNE HOUSE   RACECOURSE ROAD   CREW LANE IND EST   SOUTHWELL   NOTTS   NG25 0TX
        </Text>
        <View style={styles.headerDivider} />

        {/* Quote reference + date */}
        <View style={styles.metaRow}>
          <View>
            <Text style={styles.quoteRef}>{quoteReference}</Text>
            {versionLabel && versionLabel !== 'Original' && (
              <Text style={styles.quoteDate}>Version: {versionLabel}</Text>
            )}
            {baseQuoteReference && baseQuoteReference !== quoteReference && (
              <Text style={styles.quoteDate}>Base Quote: {baseQuoteReference}</Text>
            )}
          </View>
          <Text style={styles.quoteDate}>{formattedDate}</Text>
        </View>

        {/* Attention */}
        <View style={styles.attentionBlock}>
          {attentionName && (
            <Text style={styles.attentionBold}>For the attention of {attentionName}</Text>
          )}
          {attentionEmail && (
            <Link src={`mailto:${attentionEmail}`} style={styles.emailLink}>
              {attentionEmail}
            </Link>
          )}
        </View>

        {/* Salutation */}
        <Text style={styles.salutation}>{salutation || 'Dear Sir/Madam,'}</Text>

        {/* Intro text */}
        <Text style={styles.introText}>
          Further to your request, we are pleased to provide our quotation as follows:
        </Text>

        {/* Subject / Project */}
        <View style={styles.subjectBlock}>
          {projectDescription && <Text style={styles.subjectBold}>{projectDescription}</Text>}
          {subjectLine && <Text style={styles.subjectNormal}>{subjectLine}</Text>}
          {siteAddress && <Text style={styles.subjectNormal}>Site address: {siteAddress}</Text>}
          {managerEmail && <Text style={styles.subjectNormal}>Manager email: {managerEmail}</Text>}
        </View>

        {/* Line items table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colItemHeader}>Item</Text>
            <Text style={styles.colQtyHeader}>Quantity</Text>
            <Text style={styles.colRateHeader}>Unit Rate</Text>
            <Text style={styles.colTotalHeader}>Total</Text>
          </View>
          {lineItems.map((item, idx) => (
            <View
              key={idx}
              style={idx < lineItems.length - 1 ? styles.tableRow : styles.tableRowLast}
            >
              <Text style={styles.colItem}>{item.description}</Text>
              <Text style={styles.colQty}>{item.quantity}</Text>
              <Text style={styles.colRate}>{gbp(item.unit_rate)}</Text>
              <Text style={styles.colTotal}>{gbp(item.line_total)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{gbp(total)}</Text>
          </View>
        </View>

        {/* Disclaimer */}
        <Text style={styles.disclaimerText}>
          {customFooterText ||
            `Quotation valid for ${validityDays} days.`}
        </Text>
        <Text style={styles.disclaimerText}>
          We trust you will find this of interest and assure you of our close attention to your requirements.
        </Text>

        {/* Sign-off */}
        <View style={styles.signoff}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={styles.signoffLine}>Yours faithfully</Text>
              {signoffName && <Text style={styles.signoffName}>{signoffName}</Text>}
              {signoffTitle && <Text style={styles.signoffTitle}>{signoffTitle}</Text>}
            </View>
            <Text style={{ fontSize: 10, color: '#475569' }}>E & OE</Text>
          </View>
        </View>

        {/* Page footer — services list + registration */}
        <View style={styles.footer}>
          <Text style={styles.footerServices}>PLANT HIRE</Text>
          <Text style={styles.footerServices}>TIPPER HIRE</Text>
          <Text style={styles.footerServices}>CIVIL ENGINEERING</Text>
          <Text style={styles.footerServices}>CONTRACT EARTH MOVING</Text>
          <Text style={styles.footerRegNo}>Registered in England. 1000918</Text>
        </View>
      </Page>
    </Document>
  );
}
