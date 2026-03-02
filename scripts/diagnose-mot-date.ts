/**
 * Diagnostic script to check MOT API data for a specific vehicle
 * This will show us what the MOT API is actually returning
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface MotTest {
  completedDate: string;
  testResult: string;
  expiryDate: string | null;
}

interface MotHistoryResponse {
  registration: string;
  make: string;
  model: string;
  firstUsedDate: string;
  fuelType: string;
  primaryColour: string;
  motTests?: MotTest[];
  motTestDueDate?: string;
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.MOT_API_CLIENT_ID;
  const clientSecret = process.env.MOT_API_CLIENT_SECRET;
  const scope = process.env.MOT_API_SCOPE;
  const accessTokenUrl = process.env.MOT_API_ACCESS_TOKEN_URL;

  if (!clientId || !clientSecret || !scope || !accessTokenUrl) {
    throw new Error('Missing MOT API credentials in environment variables');
  }

  const response = await fetch(accessTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function getMotHistory(registration: string): Promise<MotHistoryResponse> {
  const apiKey = process.env.MOT_API_KEY;
  const baseUrl = process.env.MOT_API_BASE_URL || 'https://history.mot.api.gov.uk';

  if (!apiKey) {
    throw new Error('Missing MOT_API_KEY in environment variables');
  }

  const accessToken = await getAccessToken();

  const response = await fetch(`${baseUrl}/v1/trade/vehicles/registration/${registration}`, {
    headers: {
      'x-api-key': apiKey,
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json+v6',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MOT API request failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

async function diagnoseMotDate() {
  const regNumber = 'FE24TYO'; // Vehicle from the screenshot
  
  console.log('\n🔍 Diagnosing MOT Date for:', regNumber);
  console.log('='.repeat(70));
  
  try {
    console.log('\n🌐 Calling MOT History API...\n');
    const motData = await getMotHistory(regNumber);
    
    console.log('📋 Vehicle Details:');
    console.log('  Registration:', motData.registration);
    console.log('  Make:', motData.make);
    console.log('  Model:', motData.model);
    console.log('  First Used Date:', motData.firstUsedDate);
    console.log('  MOT Test Due Date:', motData.motTestDueDate);
    console.log('  Number of MOT Tests:', motData.motTests?.length || 0);
    
    console.log('\n📄 Full Raw Response:');
    console.log(JSON.stringify(motData, null, 2));
    
    if (!motData.firstUsedDate) {
      console.log('\n❌ No firstUsedDate available - cannot calculate correct MOT due date');
      return;
    }
    
    // Calculate correct date (firstUsedDate + 3 years)
    const firstUsed = new Date(motData.firstUsedDate);
    const correctMotDue = new Date(firstUsed);
    correctMotDue.setFullYear(correctMotDue.getFullYear() + 3);
    const correctDateStr = correctMotDue.toISOString().split('T')[0];
    
    console.log('\n✅ CORRECT MOT Due Date (calculated):');
    console.log('  ', correctDateStr);
    console.log('   (3 years from first used date:', motData.firstUsedDate, ')');
    
    // Check if API provided motTestDueDate
    if (motData.motTestDueDate) {
      console.log('\n📅 MOT API Returned Date (motTestDueDate):');
      console.log('  ', motData.motTestDueDate);
      
      const apiDate = new Date(motData.motTestDueDate);
      const correctDate = new Date(correctMotDue);
      const daysDifference = Math.round((correctDate.getTime() - apiDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDifference !== 0) {
        console.log('\n⚠️  🚨 PROBLEM IDENTIFIED! 🚨');
        console.log('   The GOV.UK MOT API returned date is INCORRECT!');
        console.log('   Discrepancy:', Math.abs(daysDifference), 'days', daysDifference > 0 ? 'too early' : 'too late');
        
        // Calculate expected MOT date based on registration plate
        const plateYear = parseInt(regNumber.substring(2, 4));
        const plateDate = plateYear >= 50 ? 
          new Date(2000 + (plateYear - 50), 8, 1) : // Sept-Feb format (e.g., 74 = Sept 2024)
          new Date(2000 + plateYear, 2, 1);          // Mar-Aug format (e.g., 24 = Mar 2024)
        
        const expectedMotDue = new Date(plateDate);
        expectedMotDue.setFullYear(expectedMotDue.getFullYear() + 3);
        
        console.log('\n📊 Date Analysis:');
        console.log('   Registration Plate:', regNumber);
        console.log('   Plate indicates:', plateYear >= 50 ? 'Sept-Feb period' : 'Mar-Aug period', 'of', 2000 + (plateYear >= 50 ? plateYear - 50 : plateYear));
        console.log('   Expected MOT due:', expectedMotDue.toISOString().split('T')[0], 'or later');
        console.log('   API says MOT due:', motData.motTestDueDate, '❌');
        console.log('   Correct MOT due:', correctDateStr, '✅');
        
        console.log('\n💡 SOLUTION:');
        console.log('   Our code should IGNORE the motTestDueDate field from the API');
        console.log('   and ALWAYS calculate: firstUsedDate + 3 years');
        console.log('\n   Files to fix:');
        console.log('   • lib/services/mot-history-api.ts (lines 196-198)');
        console.log('   • app/api/maintenance/sync-dvla/route.ts');
        console.log('   • app/api/maintenance/sync-dvla-scheduled/route.ts');
      } else {
        console.log('\n✅ MOT API date matches calculated date - no issue!');
      }
    } else {
      console.log('\n⚠️  No motTestDueDate returned by API');
      console.log('   This is actually good - we calculate it ourselves');
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

diagnoseMotDate();
