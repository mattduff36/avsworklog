/**
 * Test the complete sync flow for FE24 TYO to identify where the wrong date comes from
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { createMotHistoryService } from '../lib/services/mot-history-api';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testSyncFlow() {
  const regNumber = 'FE24TYO';
  
  console.log('\n🧪 Testing Complete Sync Flow for:', regNumber);
  console.log('='.repeat(70));
  
  try {
    // Step 1: Call MOT API through the service
    console.log('\n📡 STEP 1: Calling MOT API through service layer...\n');
    const motService = createMotHistoryService();
    
    if (!motService) {
      console.log('❌ MOT service not configured');
      return;
    }
    
    const motExpiryData = await motService.getMotExpiryData(regNumber);
    
    console.log('Service returned:');
    console.log('  registration:', motExpiryData.registration);
    console.log('  motExpiryDate:', motExpiryData.motExpiryDate);
    console.log('  motStatus:', motExpiryData.motStatus);
    console.log('  lastTestDate:', motExpiryData.lastTestDate);
    console.log('  lastTestResult:', motExpiryData.lastTestResult);
    
    console.log('\n  Raw Data Fields:');
    console.log('    registrationDate:', motExpiryData.rawData.registrationDate);
    console.log('    manufactureDate:', motExpiryData.rawData.manufactureDate);
    console.log('    motTestDueDate:', motExpiryData.rawData.motTestDueDate);
    console.log('    firstUsedDate:', motExpiryData.rawData.firstUsedDate);
    console.log('    motTests:', motExpiryData.rawData.motTests?.length || 0);
    
    // Step 2: Simulate what the sync route would do
    console.log('\n\n🔄 STEP 2: Simulating sync route logic...\n');
    
    const motRawData = motExpiryData.rawData;
    let motDueDate: string | null = null;
    let calculationMethod = '';
    
    // This is the logic from app/api/admin/vehicles/route.ts lines 349-365
    if (motExpiryData.motExpiryDate) {
      motDueDate = motExpiryData.motExpiryDate;
      calculationMethod = 'Using motExpiryData.motExpiryDate (from motTestDueDate)';
      console.log('✅ Branch A: motExpiryData.motExpiryDate EXISTS');
      console.log('   Value:', motExpiryData.motExpiryDate);
    } else if (motRawData?.firstUsedDate) {
      const firstUsedDate = new Date(motRawData.firstUsedDate);
      const firstMotDue = new Date(firstUsedDate);
      firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
      motDueDate = firstMotDue.toISOString().split('T')[0];
      calculationMethod = 'Calculated from firstUsedDate + 3 years';
      console.log('⚠️  Branch B: Calculating from firstUsedDate');
      console.log('   firstUsedDate:', motRawData.firstUsedDate);
      console.log('   Calculated:', motDueDate);
    } else if (motRawData?.registrationDate) {
      // This branch doesn't exist in the code, but maybe it should?
      const regDate = new Date(motRawData.registrationDate);
      const firstMotDue = new Date(regDate);
      firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
      motDueDate = firstMotDue.toISOString().split('T')[0];
      calculationMethod = 'Calculated from registrationDate + 3 years (NOT IN CODE)';
      console.log('❓ Branch C: Would calculate from registrationDate');
      console.log('   registrationDate:', motRawData.registrationDate);
      console.log('   Calculated:', motDueDate);
    } else {
      console.log('❌ No MOT due date could be determined');
      calculationMethod = 'NONE - No data available';
    }
    
    // Step 3: Show final result
    console.log('\n\n📊 STEP 3: Final Result\n');
    console.log('Calculation Method:', calculationMethod);
    console.log('MOT Due Date that would be saved:', motDueDate || 'NULL');
    
    if (motDueDate === '2027-03-20') {
      console.log('\n✅ CORRECT! This matches the expected date.');
    } else if (motDueDate === '2026-02-28') {
      console.log('\n❌ WRONG! This is the incorrect date the user is seeing.');
      console.log('   Something else is calculating this date.');
    } else {
      console.log('\n⚠️  Different date than expected.');
      console.log('   Expected: 2027-03-20');
      console.log('   Got:', motDueDate);
    }
    
    console.log('\n' + '='.repeat(70));
    
    // Step 4: Check if registrationDate exists and could be used
    if (motRawData.registrationDate) {
      console.log('\n💡 ADDITIONAL INSIGHT:');
      console.log('   The MOT API provides registrationDate:', motRawData.registrationDate);
      console.log('   This could be used as a fallback if firstUsedDate is missing.');
      console.log('   registrationDate + 3 years =', new Date(new Date(motRawData.registrationDate).setFullYear(new Date(motRawData.registrationDate).getFullYear() + 3)).toISOString().split('T')[0]);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:', error.stack);
    }
  }
}

testSyncFlow();

