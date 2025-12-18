import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const excelFilePath = 'data/VAN SERVICE SHEETS/ALL VANS.xlsx';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface ExcelRow {
  'Registration number': string;
  'PRESENT MILEAGE': number;
  'MILES NEXT SERVICE': number;
  'MILES LAST SERVICE': number;
  'MILES DUE CAMBELT'?: number;
  'TRACKER No.'?: string;
  'FIRST AID CHECK'?: string;
  'Comments'?: string;
  'MOT Date Due'?: string;
  'Tax Date Due'?: string;
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
function parseExcelDate(dateStr: string | number): string | null {
  if (!dateStr || dateStr === '-' || dateStr === 'N/A') return null;
  
  // Handle both string and Excel serial number formats
  if (typeof dateStr === 'number') {
    // Excel serial date
    const date = XLSX.SSF.parse_date_code(dateStr);
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
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
function parseMileage(value: any): number | null {
  if (!value || value === '-' || value === 'N/A') return null;
  const num = parseInt(String(value).replace(/,/g, ''));
  return isNaN(num) || num < 0 ? null : num;
}

/**
 * Parse boolean from Yes/No string
 */
function parseBoolean(value: any): boolean {
  return String(value).toLowerCase().trim() === 'yes';
}

// ============================================================================
// Main Import Function
// ============================================================================

async function importMaintenanceData() {
  console.log('📊 Vehicle Maintenance Data Import');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const result: ImportResult = {
    success: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  // Parse connection string
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // ========================================================================
    // Step 1: Read Excel file
    // ========================================================================
    console.log('📂 Reading Excel file...');
    const filePath = resolve(process.cwd(), excelFilePath);
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: ExcelRow[] = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Found ${data.length} vehicles in spreadsheet\n`);

    // ========================================================================
    // Step 2: Connect to database
    // ========================================================================
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // ========================================================================
    // Step 3: Process each row
    // ========================================================================
    console.log('⚙️  Processing vehicles...\n');
    
    for (const row of data) {
      const reg = String(row['Registration number'] || '').trim().toUpperCase();
      
      if (!reg) {
        result.skipped++;
        result.details.push({
          reg: '(empty)',
          status: 'skipped',
          reason: 'No registration number'
        });
        continue;
      }
      
      // Format registration (e.g., "Y207GAU" -> "Y207 GAU")
      const formattedReg = reg.replace(/^([A-Z]+)(\d+)([A-Z]+)$/, '$1$2 $3');

      try {
        // Check if vehicle exists (try both formats)
        const vehicleQuery = await client.query(
          'SELECT id, reg_number FROM vehicles WHERE reg_number = $1 OR reg_number = $2',
          [reg, formattedReg]
        );

        if (vehicleQuery.rows.length === 0) {
          result.skipped++;
          result.details.push({
            reg,
            status: 'skipped',
            reason: 'Vehicle not found in database'
          });
          console.log(`  ⚠️  ${reg}: Not in vehicle database (skipped)`);
          continue;
        }

        const vehicleId = vehicleQuery.rows[0].id;

        // Parse all maintenance data (handle optional fields)
        const maintenanceData = {
          vehicle_id: vehicleId,
          current_mileage: parseMileage(row['PRESENT MILEAGE']),
          last_service_mileage: parseMileage(row['MILES LAST SERVICE']),
          next_service_mileage: parseMileage(row['MILES NEXT SERVICE']),
          cambelt_due_mileage: parseMileage(row['MILES DUE CAMBELT']),
          tracker_id: row['TRACKER No.'] ? String(row['TRACKER No.']).trim() : null,
          tax_due_date: row['Tax Date Due'] ? parseExcelDate(row['Tax Date Due']) : null,
          mot_due_date: row['MOT Date Due'] ? parseExcelDate(row['MOT Date Due']) : null,
          first_aid_kit_expiry: row['FIRST AID CHECK'] ? parseExcelDate(row['FIRST AID CHECK']) : null,
          notes: row['Comments'] || null,
          last_mileage_update: new Date().toISOString(),
        };

        // Insert or update maintenance record
        const insertQuery = `
          INSERT INTO vehicle_maintenance (
            vehicle_id,
            current_mileage,
            last_service_mileage,
            next_service_mileage,
            cambelt_due_mileage,
            tracker_id,
            tax_due_date,
            mot_due_date,
            first_aid_kit_expiry,
            notes,
            last_mileage_update
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

        await client.query(insertQuery, [
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

        // Create history entry
        const historyQuery = `
          INSERT INTO maintenance_history (
            vehicle_id,
            field_name,
            new_value,
            value_type,
            comment,
            updated_by_name
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `;

        await client.query(historyQuery, [
          vehicleId,
          'all_fields',
          'Initial import',
          'text',
          `Imported from ALL VANS.xlsx spreadsheet on ${new Date().toISOString()}`,
          'System (Excel Import)'
        ]);

        result.success++;
        const matchedReg = vehicleQuery.rows[0].reg_number;
        result.details.push({
          reg: matchedReg,
          status: 'success'
        });
        console.log(`  ✅ ${matchedReg}: Imported successfully`);

      } catch (error: any) {
        result.failed++;
        result.details.push({
          reg,
          status: 'failed',
          reason: error.message
        });
        console.error(`  ❌ ${reg}: ${error.message}`);
      }
    }

    // ========================================================================
    // Step 4: Print summary report
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 IMPORT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log(`✅ Successfully imported: ${result.success} vehicles`);
    console.log(`⚠️  Skipped: ${result.skipped} vehicles`);
    console.log(`❌ Failed: ${result.failed} vehicles`);
    console.log(`📊 Total processed: ${data.length} vehicles\n`);

    if (result.skipped > 0) {
      console.log('⚠️  Skipped vehicles:');
      result.details
        .filter(d => d.status === 'skipped')
        .forEach(d => console.log(`   • ${d.reg}: ${d.reason}`));
      console.log();
    }

    if (result.failed > 0) {
      console.log('❌ Failed vehicles:');
      result.details
        .filter(d => d.status === 'failed')
        .forEach(d => console.log(`   • ${d.reg}: ${d.reason}`));
      console.log();
    }

    // ========================================================================
    // Step 5: Database verification
    // ========================================================================
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

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ IMPORT COMPLETED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (result.success > 0) {
      console.log('📝 Next steps:');
      console.log('   1. Build API endpoints for maintenance data');
      console.log('   2. Build UI components');
      console.log('   3. Test the system\n');
    }

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ IMPORT FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    console.error('\n💡 Troubleshooting:');
    console.error(`   1. Check Excel file exists: ${excelFilePath}`);
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
