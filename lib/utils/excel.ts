import 'server-only';
import ExcelJS from 'exceljs';

/**
 * Excel utility functions for generating reports
 * SERVER-ONLY: This module must only be imported in Server Components or API routes
 */

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ExcelWorksheetData {
  sheetName: string;
  columns: ExcelColumn[];
  data: Array<Record<string, string | number | null>>;
}

/**
 * Generate Excel file from worksheet data
 */
export async function generateExcelFile(worksheets: ExcelWorksheetData[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  worksheets.forEach((worksheet) => {
    const sheet = workbook.addWorksheet(worksheet.sheetName);

    sheet.columns = worksheet.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width ?? 15,
    }));

    if (worksheet.data && worksheet.data.length > 0) {
      sheet.addRows(worksheet.data);
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/**
 * Format date for Excel display
 */
export function formatExcelDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Format time for Excel display
 */
export function formatExcelTime(time: string): string {
  if (!time) return '-';
  return time;
}

/**
 * Format hours for Excel display
 */
export function formatExcelHours(hours: number | null): string {
  if (hours === null || hours === undefined) return '-';
  return hours.toFixed(2);
}

/**
 * Format status for Excel display
 */
export function formatExcelStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Create summary row for Excel
 */
export function createSummaryRow<Row extends Record<string, string | number | null>>(
  row: Row
): Row & { isSummary: true } {
  return {
    isSummary: true,
    ...row,
  };
}

/**
 * Add totals row to worksheet data
 */
export function addTotalsRow<Row extends Record<string, string | number | null>>(
  data: Row[],
  totalLabel: string,
  sumColumns: Array<keyof Row & string>
): Row[] {
  if (data.length === 0) {
    return data;
  }

  const firstKey = Object.keys(data[0])[0];
  const totals: Record<string, string> = { [firstKey]: totalLabel };

  sumColumns.forEach((col) => {
    totals[col] = data
      .reduce((sum, row) => {
        const rawValue = row[col];
        const value = parseFloat(String(rawValue ?? 0)) || 0;
        return sum + value;
      }, 0)
      .toFixed(2);
  });

  return [...data, totals as Row];
}

/**
 * Convert Supabase timestamp to Excel-friendly format
 */
export function supabaseToExcelDate(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-GB') + ' ' + date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

