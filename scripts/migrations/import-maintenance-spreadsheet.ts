import { config } from 'dotenv';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

// Constants
const CONNECTION_STRING = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const EXCEL_FILE_PATH = 'data/VAN SERVICE SHEETS/ALL VANS.xlsx';
const COLUMN_REGISTRATION = 'Registration number';
const COLUMN_PRESENT_MILEAGE = 'PRESENT MILEAGE';
const COLUMN_MILES_NEXT_SERVICE = 'MILES NEXT SERVICE';
const COLUMN_MILES_LAST_SERVICE = 'MILES LAST SERVICE';
const COLUMN_MILES_DUE_CAMBELT = 'MILES DUE CAMBELT';
const COLUMN_TRACKER_NUMBER = 'Tracker Number';
const COLUMN_FIRST_AID_CHECK = 'FIRST AID CHECK';
const COLUMN_COMMENTS = 'Comments';
const COLUMN_MOT_DATE_DUE = 'MOT Date Due';
const COLUMN_TAX_DATE_DUE = 'Tax Date Due';

if (!CONNECTION_STRING) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface ExcelRow {
  [COLUMN_REGISTRATION]: string;
  [COLUMN_PRESENT_MILEAGE]: number;
  [COLUMN_MILES_NEXT_SERVICE]: number;
  [COLUMN_MILES_LAST_SERVICE]: number;
  [COLUMN_MILES_DUE_CAMBELT]?: number;
  [COLUMN_TRACKER_NUMBER]?: string | number;
  [COLUMN_FIRST_AID_CHECK]?: string;
  [COLUMN_COMMENTS]?: string;
  [COLUMN_MOT_DATE_DUE]?: string;
  [COLUMN_TAX_DATE_DUE]?: string;
}

interface ImportResult {
  success: number;
  skipped: number;
  failed: number;
  details: {
    reg: string;
    status: 'success' | 'skipped' | 'failed';
    reason?: string;
  }[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse Excel date format (mmm-yy) to PostgreSQL date
 * Example: "Jan-26" → "2026-01-01"
 */
function parseExcelDate(dateStr: string | number | Date | null): string | null {
  if (!dateStr || dateStr === '-' || dateStr === 'N/A') return null;
  
  if (dateStr instanceof Date) {
    return dateStr.toISOString().slice(0, 10);
  }

  // Handle Excel serial number formats
  if (typeof dateStr === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + dateStr * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }
  
  // String format: "mmm-yy" or "Jan-26"
  const str = String(dateStr).trim();
  const monthMap: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  
  const parts = str.split('-');
  if (parts.length !== 2) return null;
  
  const [monthAbbr, yearAbbr] = parts;
  const month = monthMap[monthAbbr];
  
  if (!month) return null;
  
  // Assume 20XX for 2-digit years
  const fullYear = `20${yearAbbr}`;
  
  // Return first day of the month
  return `${fullYear}-${month}-01`;
}

/**
 * Clean and validate mileage value
 */
function parseMileage(value: unknown): number | null {
  if (!value || value === '-' || value === 'N/A') return null;
  const num = parseInt(String(value).replace(/,/g, ''));
  return isNaN(num) || num < 0 ? null : num;
}

/**
 * Parse boolean from Yes/No string
 */
function normalizeCellValue(value: ExcelJS.CellValue): string | number | Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }

    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }

    if ('result' in value) {
      return value.result as string | number | Date | null;
    }
  }

  return value as string | number;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// Helper to read Excel file and extract data
async function readExcelFile(filePath: string): Promise<ExcelRow[]> {
  console.log('📂 Reading Excel file...');
  const fullPath = resolve(process.cwd(), filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fullPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheets found in the Excel file');
  }

  const headerRow = worksheet.getRow(1);
  const headers = (headerRow.values as Array<ExcelJS.CellValue | undefined>)
    .slice(1)
    .map((header) => String(header ?? '').trim());

  const data: ExcelRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const rowData = {} as ExcelRow;
    headers.forEach((header, index) => {
      if (!header) return;
      const cellValue = normalizeCellValue(row.getCell(index + 1).value);
      (rowData as Record<string, string | number | Date | null>)[header] = cellValue;
    });

    data.push(rowData);
  });
  
  console.log(`✅ Found ${data.length} vehicles in spreadsheet\n`);
  return data;
}

// Helper to find vehicle in database
async function findVehicle(client: pg.Client, reg: string, formattedReg: string) {
  return await client.query(
    'SELECT id, reg_number FROM vehicles WHERE reg_number = $1 OR reg_number = $2',
    [reg, formattedReg]
  );
}

// Helper to insert/update maintenance record
async function upsertMaintenanceRecord(client: pg.Client, maintenanceData: Record<string, unknown>) {
  const query = `
    INSERT INTO vehicle_maintenance (
      vehicle_id, current_mileage, last_service_mileage, next_service_mileage,
      cambelt_due_mileage, tracker_id, tax_due_date, mot_due_date,
      first_aid_kit_expiry, notes, last_mileage_update
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET
      current_mileage = EXCLUDED.current_mileage,
      last_service_mileage = EXCLUDED.last_service_mileage,
      next_service_mileage = EXCLUDED.next_service_mileage,
      cambelt_due_mileage = EXCLUDED.cambelt_due_mileage,
      tracker_id = EXCLUDED.tracker_id,
      tax_due_date = EXCLUDED.tax_due_date,
      mot_due_date = EXCLUDED.mot_due_date,
      first_aid_kit_expiry = EXCLUDED.first_aid_kit_expiry,
      notes = EXCLUDED.notes,
      last_mileage_update = EXCLUDED.last_mileage_update,
      updated_at = NOW()
    RETURNING id
  `;

  return await client.query(query, [
    maintenanceData.vehicle_id,
    maintenanceData.current_mileage,
    maintenanceData.last_service_mileage,
    maintenanceData.next_service_mileage,
    maintenanceData.cambelt_due_mileage,
    maintenanceData.tracker_id,
    maintenanceData.tax_due_date,
    maintenanceData.mot_due_date,
    maintenanceData.first_aid_kit_expiry,
    maintenanceData.notes,
    maintenanceData.last_mileage_update,
  ]);
}

// Helper to create history entry
async function createHistoryEntry(client: pg.Client, vehicleId: string) {
  const query = `
    INSERT INTO maintenance_history (
      vehicle_id, field_name, new_value, value_type, comment, updated_by_name
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `;

  await client.query(query, [
    vehicleId,
    'all_fields',
    'Initial import',
    'text',
    `Imported from ALL VANS.xlsx spreadsheet on ${new Date().toISOString()}`,
    'System (Excel Import)'
  ]);
}

// Helper to process a single row
async function processVehicleRow(client: pg.Client, row: ExcelRow, result: ImportResult) {
  const reg = String(row[COLUMN_REGISTRATION] || '').trim().toUpperCase();
  
  if (!reg) {
    result.skipped++;
    result.details.push({ reg: '(empty)', status: 'skipped', reason: 'No registration number' });
    return;
  }
  
  const formattedReg = reg.replace(/^([A-Z]+)(\d+)([A-Z]+)$/, '$1$2 $3');

  try {
    const vehicleQuery = await findVehicle(client, reg, formattedReg);

    if (vehicleQuery.rows.length === 0) {
      result.skipped++;
      result.details.push({ reg, status: 'skipped', reason: 'Vehicle not found in database' });
      console.log(`  ⚠️  ${reg}: Not in vehicle database (skipped)`);
      return;
    }

    const vehicleId = vehicleQuery.rows[0].id;

    const maintenanceData = {
      vehicle_id: vehicleId,
      current_mileage: parseMileage(row[COLUMN_PRESENT_MILEAGE]),
      last_service_mileage: parseMileage(row[COLUMN_MILES_LAST_SERVICE]),
      next_service_mileage: parseMileage(row[COLUMN_MILES_NEXT_SERVICE]),
      cambelt_due_mileage: parseMileage(row[COLUMN_MILES_DUE_CAMBELT]),
      tracker_id: row[COLUMN_TRACKER_NUMBER] ? String(row[COLUMN_TRACKER_NUMBER]).trim() : null,
      tax_due_date: row[COLUMN_TAX_DATE_DUE] ? parseExcelDate(row[COLUMN_TAX_DATE_DUE]) : null,
      mot_due_date: row[COLUMN_MOT_DATE_DUE] ? parseExcelDate(row[COLUMN_MOT_DATE_DUE]) : null,
      first_aid_kit_expiry: row[COLUMN_FIRST_AID_CHECK] ? parseExcelDate(row[COLUMN_FIRST_AID_CHECK]) : null,
      notes: row[COLUMN_COMMENTS] || null,
      last_mileage_update: new Date().toISOString(),
    };

    await upsertMaintenanceRecord(client, maintenanceData);
    await createHistoryEntry(client, vehicleId);

    result.success++;
    const matchedReg = vehicleQuery.rows[0].reg_number;
    result.details.push({ reg: matchedReg, status: 'success' });
    console.log(`  ✅ ${matchedReg}: Imported successfully`);

  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    result.failed++;
    result.details.push({ reg, status: 'failed', reason: errorMessage });
    console.error(`  ❌ ${reg}: ${errorMessage}`);
  }
}

// Helper to print summary
function printSummary(result: ImportResult, totalProcessed: number) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 IMPORT SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`✅ Successfully imported: ${result.success} vehicles`);
  console.log(`⚠️  Skipped: ${result.skipped} vehicles`);
  console.log(`❌ Failed: ${result.failed} vehicles`);
  console.log(`📊 Total processed: ${totalProcessed} vehicles\n`);

  if (result.skipped > 0) {
    console.log('⚠️  Skipped vehicles:');
    result.details.filter(d => d.status === 'skipped').forEach(d => console.log(`   • ${d.reg}: ${d.reason}`));
    console.log();
  }

  if (result.failed > 0) {
    console.log('❌ Failed vehicles:');
    result.details.filter(d => d.status === 'failed').forEach(d => console.log(`   • ${d.reg}: ${d.reason}`));
    console.log();
  }
}

// Helper to verify import
async function verifyImport(client: pg.Client) {
  console.log('🔍 Verifying import...');
  const verifyQuery = await client.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(current_mileage) as with_mileage,
      COUNT(tax_due_date) as with_tax,
      COUNT(mot_due_date) as with_mot,
      COUNT(next_service_mileage) as with_service
    FROM vehicle_maintenance
  `);
  
  const stats = verifyQuery.rows[0];
  console.log(`   • Total maintenance records: ${stats.total}`);
  console.log(`   • With current mileage: ${stats.with_mileage}`);
  console.log(`   • With tax date: ${stats.with_tax}`);
  console.log(`   • With MOT date: ${stats.with_mot}`);
  console.log(`   • With service schedule: ${stats.with_service}`);
}

// ============================================================================
// Main Import Function
// ============================================================================

async function importMaintenanceData() {
  console.log('📊 Vehicle Maintenance Data Import');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const result: ImportResult = { success: 0, skipped: 0, failed: 0, details: [] };

  // Parse connection string
  const url = new URL(CONNECTION_STRING);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Read Excel file
    const data = await readExcelFile(EXCEL_FILE_PATH);

    // Connect to database
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Process each row
    console.log('⚙️  Processing vehicles...\n');
    for (const row of data) {
      await processVehicleRow(client, row, result);
    }

    // Print summary
    printSummary(result, data.length);

    // Verify import
    await verifyImport(client);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ IMPORT COMPLETED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (result.success > 0) {
      console.log('📝 Next steps:');
      console.log('   1. Build API endpoints for maintenance data');
      console.log('   2. Build UI components');
      console.log('   3. Test the system\n');
    }

  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ IMPORT FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    console.error('\n💡 Troubleshooting:');
    console.error(`   1. Check Excel file exists: ${EXCEL_FILE_PATH}`);
    console.error('   2. Verify database connection');
    console.error('   3. Ensure migration was run first');
    console.error('   4. Check vehicles exist in database\n');
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('📡 Database connection closed.\n');
  }
}

// ============================================================================
// Run Import
// ============================================================================

importMaintenanceData().catch(console.error);
