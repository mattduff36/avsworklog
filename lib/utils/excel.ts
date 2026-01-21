import 'server-only';
import * as XLSX from 'xlsx';

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
  data: any[];
}

/**
 * Generate Excel file from worksheet data
 */
export function generateExcelFile(worksheets: ExcelWorksheetData[]): Buffer {
  const workbook = XLSX.utils.book_new();

  worksheets.forEach((worksheet) => {
    // Guard against empty data - create minimal worksheet with just headers
    if (!worksheet.data || worksheet.data.length === 0) {
      const headerRow: any = {};
      worksheet.columns.forEach((col) => {
        headerRow[col.key] = col.header;
      });
      const ws = XLSX.utils.json_to_sheet([headerRow]);
      
      // Set column widths
      ws['!cols'] = worksheet.columns.map((col) => ({
        wch: col.width || 15,
      }));
      
      XLSX.utils.book_append_sheet(workbook, ws, worksheet.sheetName);
      return; // Skip to next worksheet
    }
    
    // Create worksheet from data
    const ws = XLSX.utils.json_to_sheet(worksheet.data, {
      header: worksheet.columns.map((col) => col.key),
    });

    // Set column headers
    const headerRow: any = {};
    worksheet.columns.forEach((col) => {
      headerRow[col.key] = col.header;
    });
    XLSX.utils.sheet_add_json(ws, [headerRow], {
      skipHeader: true,
      origin: 0,
    });

    // Set column widths
    ws['!cols'] = worksheet.columns.map((col) => ({
      wch: col.width || 15,
    }));

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, ws, worksheet.sheetName);
  });

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
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
export function createSummaryRow(data: any[]): any {
  return {
    isSummary: true,
    ...data,
  };
}

/**
 * Add totals row to worksheet data
 */
export function addTotalsRow(
  data: any[],
  totalLabel: string,
  sumColumns: string[]
): any[] {
  const totals: any = { [Object.keys(data[0])[0]]: totalLabel };

  sumColumns.forEach((col) => {
    totals[col] = data.reduce((sum, row) => {
      const value = parseFloat(row[col]) || 0;
      return sum + value;
    }, 0).toFixed(2);
  });

  return [...data, totals];
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

