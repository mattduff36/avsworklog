/**
 * Check what the DVLA VES API returns for FE24 TYO
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkDvlaData() {
  const regNumber = 'FE24TYO';
  const apiKey = process.env.VES_API_KEY;
  
  if (!apiKey) {
    console.error('❌ VES_API_KEY not found in environment variables');
    process.exit(1);
  }
  
  console.log('\n🔍 Checking DVLA VES API for:', regNumber);
  console.log('='.repeat(70));
  
  try {
    console.log('\n🌐 Calling DVLA VES API...\n');
    
    const response = await fetch(`https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        registrationNumber: regNumber,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DVLA API request failed: ${response.status} - ${errorText}`);
    }
    
    const dvlaData = await response.json();
    
    console.log('📋 DVLA Vehicle Data:');
    console.log(JSON.stringify(dvlaData, null, 2));
    
    // Check the monthOfFirstRegistration field
    if (dvlaData.monthOfFirstRegistration) {
      console.log('\n🔍 Month of First Registration Analysis:');
      console.log('  Value:', dvlaData.monthOfFirstRegistration);
      
      // Parse it
      const [year, month] = dvlaData.monthOfFirstRegistration.split('.');
      if (year && month) {
        // Current calculation (uses first day of month)
        const firstDayOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
        const motDueFromFirstDay = new Date(firstDayOfMonth);
        motDueFromFirstDay.setFullYear(motDueFromFirstDay.getFullYear() + 3);
        
        console.log('\n  ❌ CURRENT BUGGY CALCULATION:');
        console.log('     Assumes registration:', firstDayOfMonth.toISOString().split('T')[0]);
        console.log('     MOT due:', motDueFromFirstDay.toISOString().split('T')[0]);
        
        // What it should be (last day of month to be safe)
        const lastDayOfMonth = new Date(parseInt(year), parseInt(month), 0);
        const motDueFromLastDay = new Date(lastDayOfMonth);
        motDueFromLastDay.setFullYear(motDueFromLastDay.getFullYear() + 3);
        
        console.log('\n  ⚠️  SAFER CALCULATION (last day of month):');
        console.log('     Assumes registration:', lastDayOfMonth.toISOString().split('T')[0]);
        console.log('     MOT due:', motDueFromLastDay.toISOString().split('T')[0]);
      }
    }
    
    // Check taxDueDate
    if (dvlaData.taxDueDate) {
      console.log('\n💷 Tax Due Date:', dvlaData.taxDueDate);
    }
    
    console.log('\n💡 RECOMMENDATION:');
    console.log('   The DVLA API only provides month/year, not the exact day.');
    console.log('   Our code should:');
    console.log('   1. PREFER the MOT API data (motTestDueDate) when available');
    console.log('   2. If MOT API has registrationDate, use that + 3 years');
    console.log('   3. Only fall back to DVLA monthOfFirstRegistration if nothing else available');
    console.log('   4. When using monthOfFirstRegistration, use LAST day of month (not first)');
    
    console.log('\n' + '='.repeat(70));
    
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

checkDvlaData();

