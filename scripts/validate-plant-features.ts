/**
 * Plant Maintenance Feature Validation Script
 * Comprehensive checks for all plant parity features
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ValidationResult {
  category: string;
  checks: Array<{
    name: string;
    status: 'PASS' | 'FAIL' | 'SKIP';
    message: string;
  }>;
}

const results: ValidationResult[] = [];

function addResult(category: string, name: string, status: 'PASS' | 'FAIL' | 'SKIP', message: string) {
  let categoryResult = results.find(r => r.category === category);
  if (!categoryResult) {
    categoryResult = { category, checks: [] };
    results.push(categoryResult);
  }
  categoryResult.checks.push({ name, status, message });
}

async function validateFileExists(filePath: string, description: string): Promise<boolean> {
  const fullPath = path.resolve(process.cwd(), filePath);
  const exists = existsSync(fullPath);
  addResult(
    'File Structure',
    description,
    exists ? 'PASS' : 'FAIL',
    exists ? `✓ ${filePath}` : `✗ Missing: ${filePath}`
  );
  return exists;
}

async function validateDatabaseSchema() {
  if (!supabaseUrl || !supabaseKey) {
    addResult('Database Schema', 'Connection', 'SKIP', 'Credentials not available');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Check plant_id column in maintenance_history
    const { error } = await supabase
      .from('maintenance_history')
      .select('plant_id, van_id')
      .limit(1);

    if (error) {
      addResult('Database Schema', 'maintenance_history.plant_id', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
    } else {
      addResult('Database Schema', 'maintenance_history.plant_id', 'PASS', '✓ Column exists and queryable');
    }

    // Check hours-based fields in vehicle_maintenance
    const { error: maintenanceError } = await supabase
      .from('vehicle_maintenance')
      .select('current_hours, last_service_hours, next_service_hours, plant_id')
      .limit(1);

    if (maintenanceError) {
      addResult('Database Schema', 'vehicle_maintenance hours fields', 'FAIL', `Error: ${maintenanceError.message}`);
    } else {
      addResult('Database Schema', 'vehicle_maintenance hours fields', 'PASS', '✓ Hours-based fields exist');
    }

    // Check plant table structure
    const { error: plantError } = await supabase
      .from('plant')
      .select('loler_due_date, loler_last_inspection_date, loler_certificate_number, current_hours')
      .limit(1);

    if (plantError) {
      addResult('Database Schema', 'plant LOLER fields', 'FAIL', `Error: ${plantError.message}`);
    } else {
      addResult('Database Schema', 'plant LOLER fields', 'PASS', '✓ LOLER fields accessible');
    }

  } catch (error: unknown) {
    addResult('Database Schema', 'General', 'FAIL', `Validation error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateComponents() {
  // Check EditPlantRecordDialog
  await validateFileExists(
    'app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx',
    'EditPlantRecordDialog component'
  );

  // Check DeletePlantDialog
  await validateFileExists(
    'app/(dashboard)/maintenance/components/DeletePlantDialog.tsx',
    'DeletePlantDialog component'
  );

  // Check plant history page
  await validateFileExists(
    'app/(dashboard)/fleet/plant/[plantId]/history/page.tsx',
    'Plant history page'
  );

  // Check if components can be imported
  try {
    const editDialogPath = path.resolve(process.cwd(), 'app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx');
    const content = readFileSync(editDialogPath, 'utf-8');
    
    const hasCommentValidation = content.includes('min(10,') || content.includes('minimum 10 characters');
    const hasUnsavedChanges = content.includes('isDirty') && content.includes('triggerShakeAnimation');
    const hasLolerFields = content.includes('loler_due_date') && content.includes('loler_last_inspection_date');
    const hasHoursFields = content.includes('current_hours') && content.includes('next_service_hours');

    addResult('Component Logic', 'EditPlantRecordDialog comment validation', hasCommentValidation ? 'PASS' : 'FAIL', 
      hasCommentValidation ? '✓ Mandatory comment validation present' : '✗ Comment validation missing');
    
    addResult('Component Logic', 'EditPlantRecordDialog unsaved changes', hasUnsavedChanges ? 'PASS' : 'FAIL',
      hasUnsavedChanges ? '✓ Unsaved changes handling present' : '✗ Unsaved changes handling missing');
    
    addResult('Component Logic', 'EditPlantRecordDialog LOLER fields', hasLolerFields ? 'PASS' : 'FAIL',
      hasLolerFields ? '✓ LOLER fields included' : '✗ LOLER fields missing');
    
    addResult('Component Logic', 'EditPlantRecordDialog hours fields', hasHoursFields ? 'PASS' : 'FAIL',
      hasHoursFields ? '✓ Hours-based fields included' : '✗ Hours fields missing');

  } catch (error: unknown) {
    addResult('Component Logic', 'File reading', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateAPI() {
  // Check API route files
  await validateFileExists(
    'app/api/maintenance/history/plant/[plantId]/route.ts',
    'Plant history API endpoint'
  );

  // Validate API logic
  try {
    const apiPath = path.resolve(process.cwd(), 'app/api/maintenance/history/plant/[plantId]/route.ts');
    const content = readFileSync(apiPath, 'utf-8');
    
    const hasPlantIdQuery = content.includes('plant_id');
    const hasWorkshopTasks = content.includes('workshop_tasks') || content.includes('workshopTasks');
    const hasHistory = content.includes('maintenance_history');

    addResult('API Implementation', 'Plant history endpoint structure', hasPlantIdQuery ? 'PASS' : 'FAIL',
      hasPlantIdQuery ? '✓ Uses plant_id for queries' : '✗ plant_id queries missing');
    
    addResult('API Implementation', 'Workshop tasks integration', hasWorkshopTasks ? 'PASS' : 'FAIL',
      hasWorkshopTasks ? '✓ Workshop tasks included' : '✗ Workshop tasks missing');
    
    addResult('API Implementation', 'History retrieval', hasHistory ? 'PASS' : 'FAIL',
      hasHistory ? '✓ Maintenance history included' : '✗ History retrieval missing');

  } catch (error: unknown) {
    addResult('API Implementation', 'File reading', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Check maintenance API update endpoint
  try {
    const maintenanceApiPath = path.resolve(process.cwd(), 'app/api/maintenance/[id]/route.ts');
    const content = readFileSync(maintenanceApiPath, 'utf-8');
    
    const hasPlantIdHistory = content.includes('plant_id:') && content.includes('maintenance_history');
    const hasHoursFields = content.includes('current_hours') && content.includes('last_service_hours');

    addResult('API Implementation', 'Maintenance update supports plant_id', hasPlantIdHistory ? 'PASS' : 'FAIL',
      hasPlantIdHistory ? '✓ plant_id written to history' : '✗ plant_id not in history writes');
    
    addResult('API Implementation', 'Maintenance update supports hours', hasHoursFields ? 'PASS' : 'FAIL',
      hasHoursFields ? '✓ Hours-based fields handled' : '✗ Hours fields not handled');

  } catch (error: unknown) {
    addResult('API Implementation', 'Maintenance API', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateHooks() {
  try {
    const hooksPath = path.resolve(process.cwd(), 'lib/hooks/useMaintenance.ts');
    const content = readFileSync(hooksPath, 'utf-8');
    
    const hasPlantHook = content.includes('usePlantMaintenanceHistory');
    const hasPlantApiCall = content.includes('/api/maintenance/history/plant/');

    addResult('React Hooks', 'usePlantMaintenanceHistory exists', hasPlantHook ? 'PASS' : 'FAIL',
      hasPlantHook ? '✓ Hook exported' : '✗ Hook not found');
    
    addResult('React Hooks', 'Plant API integration', hasPlantApiCall ? 'PASS' : 'FAIL',
      hasPlantApiCall ? '✓ Calls plant history endpoint' : '✗ API call missing');

  } catch (error: unknown) {
    addResult('React Hooks', 'Validation', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateTypes() {
  // Check maintenance types
  try {
    const typesPath = path.resolve(process.cwd(), 'types/maintenance.ts');
    const content = readFileSync(typesPath, 'utf-8');
    
    const hasPlantIdInHistory = content.includes('MaintenanceHistory') && content.includes('plant_id');
    const hasHoursInUpdate = content.includes('UpdateMaintenanceRequest') && 
                             (content.includes('current_hours') || content.includes('hours'));

    addResult('Type Definitions', 'MaintenanceHistory.plant_id', hasPlantIdInHistory ? 'PASS' : 'FAIL',
      hasPlantIdInHistory ? '✓ plant_id in MaintenanceHistory type' : '✗ plant_id missing from type');
    
    addResult('Type Definitions', 'UpdateMaintenanceRequest hours', hasHoursInUpdate ? 'PASS' : 'FAIL',
      hasHoursInUpdate ? '✓ Hours fields in update type' : '✗ Hours fields missing');

  } catch (error: unknown) {
    addResult('Type Definitions', 'Maintenance types', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Check database types
  try {
    const dbTypesPath = path.resolve(process.cwd(), 'types/database.ts');
    const content = readFileSync(dbTypesPath, 'utf-8');
    
    const hasPlantIdInDbTypes = content.includes('maintenance_history') && content.includes('plant_id');

    addResult('Type Definitions', 'Database types.maintenance_history', hasPlantIdInDbTypes ? 'PASS' : 'FAIL',
      hasPlantIdInDbTypes ? '✓ plant_id in DB types' : '✗ plant_id missing from DB types');

  } catch (error: unknown) {
    addResult('Type Definitions', 'Database types', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateMigration() {
  // Check migration files exist
  await validateFileExists(
    'supabase/20260203_add_plant_id_to_maintenance_history.sql',
    'Database migration SQL'
  );

  await validateFileExists(
    'scripts/run-plant-maintenance-history-migration.ts',
    'Migration runner script'
  );

  // Validate migration content
  try {
    const migrationPath = path.resolve(process.cwd(), 'supabase/20260203_add_plant_id_to_maintenance_history.sql');
    const content = readFileSync(migrationPath, 'utf-8');
    
    const hasPlantIdColumn = content.includes('ADD COLUMN plant_id');
    const hasIndex = content.includes('CREATE INDEX') && content.includes('plant_id');
    const hasConstraint = content.includes('CHECK') && content.includes('van_id') && content.includes('plant_id');

    addResult('Database Migration', 'Add plant_id column', hasPlantIdColumn ? 'PASS' : 'FAIL',
      hasPlantIdColumn ? '✓ Column addition present' : '✗ Column addition missing');
    
    addResult('Database Migration', 'Index creation', hasIndex ? 'PASS' : 'FAIL',
      hasIndex ? '✓ Index for plant_id' : '✗ Index missing');
    
    addResult('Database Migration', 'Constraint', hasConstraint ? 'PASS' : 'FAIL',
      hasConstraint ? '✓ Either van_id OR plant_id constraint' : '✗ Constraint missing');

  } catch (error: unknown) {
    addResult('Database Migration', 'SQL validation', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateTests() {
  await validateFileExists(
    'tests/integration/plant-history-workflows.test.ts',
    'Plant history integration tests'
  );

  // Validate test coverage
  try {
    const testPath = path.resolve(process.cwd(), 'tests/integration/plant-history-workflows.test.ts');
    const content = readFileSync(testPath, 'utf-8');
    
    const hasDataTests = content.includes('Plant Data Display');
    const hasHistoryTests = content.includes('Plant Maintenance History') || content.includes('maintenance history');
    const hasRetirementTests = content.includes('Plant Retirement') || content.includes('retirement');
    const hasDocumentTests = content.includes('Documents') || content.includes('attachments');

    addResult('Test Coverage', 'Plant data display tests', hasDataTests ? 'PASS' : 'FAIL',
      hasDataTests ? '✓ Data display tests present' : '✗ Data tests missing');
    
    addResult('Test Coverage', 'History workflow tests', hasHistoryTests ? 'PASS' : 'FAIL',
      hasHistoryTests ? '✓ History tests present' : '✗ History tests missing');
    
    addResult('Test Coverage', 'Retirement flow tests', hasRetirementTests ? 'PASS' : 'FAIL',
      hasRetirementTests ? '✓ Retirement tests present' : '✗ Retirement tests missing');
    
    addResult('Test Coverage', 'Document/attachment tests', hasDocumentTests ? 'PASS' : 'FAIL',
      hasDocumentTests ? '✓ Document tests present' : '✗ Document tests missing');

  } catch (error: unknown) {
    addResult('Test Coverage', 'Validation', 'FAIL', `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printResults() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║   PLANT MAINTENANCE FEATURE VALIDATION REPORT                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;
  let skippedChecks = 0;

  results.forEach(category => {
    console.log(`\n📋 ${category.category}`);
    console.log('─'.repeat(65));
    
    category.checks.forEach(check => {
      totalChecks++;
      const icon = check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '✗' : '⊘';
      const color = check.status === 'PASS' ? '\x1b[32m' : check.status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
      const reset = '\x1b[0m';
      
      console.log(`  ${color}${icon}${reset} ${check.name}`);
      console.log(`    ${check.message}`);
      
      if (check.status === 'PASS') passedChecks++;
      else if (check.status === 'FAIL') failedChecks++;
      else skippedChecks++;
    });
  });

  console.log('\n' + '═'.repeat(65));
  console.log('\n📊 SUMMARY');
  console.log('─'.repeat(65));
  console.log(`  Total Checks:   ${totalChecks}`);
  console.log(`  \x1b[32m✓ Passed:\x1b[0m       ${passedChecks}`);
  console.log(`  \x1b[31m✗ Failed:\x1b[0m       ${failedChecks}`);
  console.log(`  \x1b[33m⊘ Skipped:\x1b[0m      ${skippedChecks}`);
  
  const successRate = totalChecks > 0 ? ((passedChecks / totalChecks) * 100).toFixed(1) : 0;
  console.log(`  \nSuccess Rate:   ${successRate}%`);
  
  if (failedChecks === 0 && skippedChecks === 0) {
    console.log('\n  🎉 ALL CHECKS PASSED! Plant maintenance feature is fully implemented.');
  } else if (failedChecks === 0) {
    console.log('\n  ✓ All required checks passed. Some checks were skipped.');
  } else {
    console.log('\n  ⚠️  Some checks failed. Review the failures above.');
  }
  
  console.log('\n' + '═'.repeat(65) + '\n');
}

async function main() {
  console.log('Starting validation...\n');

  await validateFileExists('', ''); // Initialize
  await validateComponents();
  await validateAPI();
  await validateHooks();
  await validateTypes();
  await validateMigration();
  await validateTests();
  await validateDatabaseSchema();

  printResults();
}

main().catch(console.error);
