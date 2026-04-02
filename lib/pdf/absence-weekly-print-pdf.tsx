import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { PrintableAbsenceWeeklyReport, PrintableAbsenceDay } from '@/lib/server/absence-weekly-print-report';

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#111111',
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
    paddingBottom: 6,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
  },
  subtitle: {
    fontSize: 8,
    marginTop: 1,
  },
  monthContext: {
    fontSize: 8,
    textAlign: 'right',
  },
  dayGrid: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: '32.7%',
  },
  dayCard: {
    width: '49%',
    height: '100%',
    borderWidth: 1,
    borderColor: '#111111',
  },
  dayCardHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  dayCardHeaderText: {
    fontSize: 8,
    fontWeight: 700,
  },
  holidayTag: {
    borderWidth: 1,
    borderColor: '#111111',
    borderRadius: 8,
    fontSize: 7,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  dayBody: {
    paddingHorizontal: 6,
    paddingVertical: 5,
    flexDirection: 'column',
    flex: 1,
  },
  entriesArea: {
    flex: 1,
  },
  emptyText: {
    fontSize: 8,
    color: '#4b5563',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  entryMainText: {
    fontSize: 6.9,
    lineHeight: 1.2,
    marginRight: 3,
    maxWidth: '83%',
  },
  denseColumns: {
    flexDirection: 'row',
    width: '100%',
    height: '100%',
  },
  denseColumn: {
    flexGrow: 1,
    flexBasis: 0,
    paddingRight: 2,
    height: '100%',
  },
  denseColumnSpread: {
    justifyContent: 'space-between',
  },
  denseEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  denseEntryNameWeekday: {
    fontSize: 6.5,
    lineHeight: 1.16,
    marginRight: 2,
    maxWidth: '82%',
  },
  denseEntryNameWeekend: {
    fontSize: 6.2,
    lineHeight: 1.12,
    marginRight: 2,
    maxWidth: '80%',
  },
  reasonBadge: {
    borderWidth: 1,
    borderColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 0.8,
    minWidth: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonBadgePaid: {
    backgroundColor: '#ffffff',
  },
  reasonBadgeUnpaid: {
    backgroundColor: '#111111',
  },
  reasonBadgeText: {
    fontSize: 5.6,
    lineHeight: 1,
    fontWeight: 700,
  },
  reasonBadgeTextPaid: {
    color: '#111111',
  },
  reasonBadgeTextUnpaid: {
    color: '#ffffff',
  },
  weekendSingleColumnSpread: {
    height: '100%',
    justifyContent: 'space-between',
  },
  writeInSpace: {
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
    height: 16,
    flexShrink: 0,
  },
  weekendBody: {
    flex: 1,
    flexDirection: 'column',
  },
  weekendHalf: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  weekendDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
  },
  weekendHalfHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  weekendHalfTitle: {
    fontSize: 8,
    fontWeight: 700,
  },
});

interface AbsenceWeeklyPrintPdfProps {
  report: PrintableAbsenceWeeklyReport;
}

function chunkEntries<T>(items: T[], columnCount: number): T[][] {
  if (columnCount <= 1) return [items];
  const perColumn = Math.ceil(items.length / columnCount);
  const columns: T[][] = [];
  for (let index = 0; index < items.length; index += perColumn) {
    columns.push(items.slice(index, index + perColumn));
  }
  return columns;
}

function getDayColumnCount(entryCount: number, isWeekendHalf: boolean): number {
  // Weekend halves have substantially less vertical room than weekday cards.
  const singleColumnCapacity = isWeekendHalf ? 8 : 12;
  if (entryCount <= singleColumnCapacity) {
    return 1;
  }
  // Weekday cards are much taller than weekend halves, so keep fewer columns
  // and allow more rows per column to use vertical space naturally.
  const maxRowsPerColumn = isWeekendHalf ? 12 : 22;
  const maxColumns = isWeekendHalf ? 3 : 4;
  const neededColumns = Math.ceil(entryCount / maxRowsPerColumn);
  return Math.max(1, Math.min(maxColumns, neededColumns));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatStandardLabel(day: PrintableAbsenceDay['entries'][number]): string {
  const sessionPart = day.isHalfDay ? ` ${day.halfDaySession || 'Half'}` : '';
  return `${day.employeeName}${day.employeeId ? ` (${day.employeeId})` : ''}${sessionPart}`;
}

function getDenseMaxChars(columnCount: number): number {
  if (columnCount <= 2) return 38;
  if (columnCount === 3) return 26;
  return 20;
}

function formatDenseLabel(day: PrintableAbsenceDay['entries'][number], columnCount: number): string {
  const maxLength = getDenseMaxChars(columnCount);
  return truncateText(day.employeeName, maxLength);
}

function formatReasonBadge(reasonName: string): string {
  const normalized = reasonName.trim().toLowerCase();
  if (normalized === 'annual leave') return 'AL';
  if (normalized === 'unpaid leave') return 'UL';

  const firstWord = reasonName.trim().split(/\s+/)[0] || reasonName.trim();
  const cleaned = firstWord.replace(/[^a-zA-Z]/g, '');
  return cleaned || 'N/A';
}

function renderDayEntries(day: PrintableAbsenceDay, isWeekendHalf = false) {
  if (day.entries.length === 0) {
    return <Text style={styles.emptyText}>No employees off</Text>;
  }

  const columnCount = getDayColumnCount(day.entries.length, isWeekendHalf);
  if (columnCount === 1) {
    const rows = day.entries.map((entry) => (
      <View key={`${entry.absenceId}-${day.isoDate}`} style={styles.entryRow}>
        <Text style={styles.entryMainText}>{formatStandardLabel(entry)}</Text>
        <View style={[styles.reasonBadge, entry.isPaid ? styles.reasonBadgePaid : styles.reasonBadgeUnpaid]}>
          <Text style={[styles.reasonBadgeText, entry.isPaid ? styles.reasonBadgeTextPaid : styles.reasonBadgeTextUnpaid]}>
            {formatReasonBadge(entry.reasonName)}
          </Text>
        </View>
      </View>
    ));

    if (isWeekendHalf) {
      return <View style={styles.weekendSingleColumnSpread}>{rows}</View>;
    }

    return rows;
  }

  const columns = chunkEntries(day.entries, columnCount);
  const shouldSpreadRows = true;
  return (
    <View style={styles.denseColumns}>
      {columns.map((entries, columnIndex) => (
        <View
          key={`${day.isoDate}-col-${columnIndex}`}
          style={shouldSpreadRows ? [styles.denseColumn, styles.denseColumnSpread] : styles.denseColumn}
        >
          {entries.map((entry) => (
            <View key={`${entry.absenceId}-${entry.profileId}-${columnIndex}`} style={styles.denseEntryRow}>
              <Text style={isWeekendHalf ? styles.denseEntryNameWeekend : styles.denseEntryNameWeekday}>
                {formatDenseLabel(entry, columnCount)}
              </Text>
              <View style={[styles.reasonBadge, entry.isPaid ? styles.reasonBadgePaid : styles.reasonBadgeUnpaid]}>
                <Text style={[styles.reasonBadgeText, entry.isPaid ? styles.reasonBadgeTextPaid : styles.reasonBadgeTextUnpaid]}>
                  {formatReasonBadge(entry.reasonName)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderStandardDayCard(day: PrintableAbsenceDay) {
  return (
    <View key={day.isoDate} style={styles.dayCard}>
      <View style={styles.dayCardHeader}>
        <Text style={styles.dayCardHeaderText}>{day.displayDate}</Text>
        {day.isNationalHoliday ? <Text style={styles.holidayTag}>National Holiday</Text> : null}
      </View>
      <View style={styles.dayBody}>
        <View style={styles.entriesArea}>{renderDayEntries(day)}</View>
        <View style={styles.writeInSpace} />
      </View>
    </View>
  );
}

function renderWeekendCard(saturday: PrintableAbsenceDay, sunday: PrintableAbsenceDay) {
  return (
    <View style={styles.dayCard}>
      <View style={styles.dayCardHeader}>
        <Text style={styles.dayCardHeaderText}>Weekend</Text>
        {saturday.isNationalHoliday || sunday.isNationalHoliday ? (
          <Text style={styles.holidayTag}>National Holiday</Text>
        ) : null}
      </View>
      <View style={styles.weekendBody}>
        <View style={[styles.weekendHalf, styles.weekendDivider]}>
          <View style={styles.weekendHalfHeader}>
            <Text style={styles.weekendHalfTitle}>{saturday.displayDate}</Text>
            {saturday.isNationalHoliday ? <Text style={styles.holidayTag}>Holiday</Text> : null}
          </View>
          <View style={styles.entriesArea}>{renderDayEntries(saturday, true)}</View>
          <View style={styles.writeInSpace} />
        </View>
        <View style={styles.weekendHalf}>
          <View style={styles.weekendHalfHeader}>
            <Text style={styles.weekendHalfTitle}>{sunday.displayDate}</Text>
            {sunday.isNationalHoliday ? <Text style={styles.holidayTag}>Holiday</Text> : null}
          </View>
          <View style={styles.entriesArea}>{renderDayEntries(sunday, true)}</View>
          <View style={styles.writeInSpace} />
        </View>
      </View>
    </View>
  );
}

export function AbsenceWeeklyPrintPdf({ report }: AbsenceWeeklyPrintPdfProps) {
  return (
    <Document>
      {report.weeks.map((week) => {
        const [monday, tuesday, wednesday, thursday, friday, saturday, sunday] = week.days;
        return (
          <Page key={`${week.weekStartIso}-${week.weekEndIso}`} size="A4" style={styles.page}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>{week.weekLabel}</Text>
                <Text style={styles.subtitle}>
                  Requested range: {report.requestedDateFrom} to {report.requestedDateTo}
                </Text>
                <Text style={styles.subtitle}>
                  Employees: {report.employeeCount}  Bookings: {report.bookingCount}
                </Text>
              </View>
              <View>
                <Text style={styles.monthContext}>{week.monthContextLabel}</Text>
              </View>
            </View>

            <View style={styles.dayGrid}>
              <View style={styles.dayRow}>
                {renderStandardDayCard(monday)}
                {renderStandardDayCard(tuesday)}
              </View>
              <View style={styles.dayRow}>
                {renderStandardDayCard(wednesday)}
                {renderStandardDayCard(thursday)}
              </View>
              <View style={styles.dayRow}>
                {renderStandardDayCard(friday)}
                {renderWeekendCard(saturday, sunday)}
              </View>
            </View>
          </Page>
        );
      })}
    </Document>
  );
}
