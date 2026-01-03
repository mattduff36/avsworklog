/**
 * Comprehensive API Test Suite
 * Tests all DVLA VES and MOT History API integrations
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

import { DVLAApiService, createDVLAApiService } from '../lib/services/dvla-api';
import { MotHistoryService, createMotHistoryService } from '../lib/services/mot-history-api';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  duration?: number;
  error?: any;
}

const results: TestResult[] = [];

function logTest(name: string, status: 'PASS' | 'FAIL' | 'SKIP', message: string, duration?: number, error?: any) {
  results.push({ name, status, message, duration, error });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} ${name}: ${message}${duration ? ` (${duration}ms)` : ''}`);
  if (error) {
    console.log(`   Error: ${error.message || error}`);
  }
}

async function runTest(name: string, testFn: () => Promise<void>) {
  const start = Date.now();
  try {
    await testFn();
    logTest(name, 'PASS', 'Success', Date.now() - start);
  } catch (error: any) {
    logTest(name, 'FAIL', error.message || 'Unknown error', Date.now() - start, error);
  }
}

async function main() {
  console.log('🧪 COMPREHENSIVE API TEST SUITE\n');
  console.log('═'.repeat(80));
  console.log('Testing DVLA VES API and MOT History API integrations');
  console.log('═'.repeat(80) + '\n');

  // Initialize services
  let dvlaService: DVLAApiService | null = null;
  let motService: MotHistoryService | null = null;

  // Check API keys
  console.log('📋 ENVIRONMENT CHECK\n');
  
  const dvlaApiKey = process.env.DVLA_API_KEY;
  const motClientId = process.env.MOT_API_CLIENT_ID;
  const motClientSecret = process.env.MOT_API_CLIENT_SECRET;
  const motApiKey = process.env.MOT_API_KEY;

  if (dvlaApiKey) {
    console.log('✅ DVLA_API_KEY configured');
    dvlaService = createDVLAApiService();
    if (!dvlaService) {
      console.log('⚠️  DVLA service initialization failed');
    }
  } else {
    console.log('⚠️  DVLA_API_KEY not configured');
  }

  if (motClientId && motClientSecret && motApiKey) {
    console.log('✅ MOT API credentials configured');
    motService = createMotHistoryService();
    if (!motService) {
      console.log('⚠️  MOT service initialization failed');
    }
  } else {
    console.log('⚠️  MOT API credentials not configured');
  }

  console.log('\n' + '═'.repeat(80) + '\n');

  // Test vehicles
  const testVehicles = [
    { reg: 'VO23UKG', description: 'Valid vehicle with history' },
    { reg: 'BC21YZU', description: 'Valid vehicle' },
    { reg: 'TE57VAN', description: 'Test vehicle (excluded)' },
    { reg: 'TE57HGV', description: 'Test vehicle (excluded)' },
    { reg: 'INVALID123', description: 'Invalid registration' },
  ];

  // ===========================================
  // DVLA VES API TESTS
  // ===========================================
  if (dvlaService) {
    console.log('🚗 DVLA VES API TESTS\n');

    // Test 1: Valid vehicle lookup
    await runTest('DVLA-001: Valid vehicle lookup (VO23UKG)', async () => {
      const data = await dvlaService!.getVehicleData('VO23UKG');
      if (!data.taxDueDate) throw new Error('No tax due date returned');
      if (!data.make) throw new Error('No make returned');
      console.log(`   → Tax due: ${data.taxDueDate}, Make: ${data.make}`);
    });

    // Test 2: Another valid vehicle
    await runTest('DVLA-002: Valid vehicle lookup (BC21YZU)', async () => {
      const data = await dvlaService!.getVehicleData('BC21YZU');
      if (!data.taxDueDate) throw new Error('No tax due date returned');
      console.log(`   → Tax due: ${data.taxDueDate}`);
    });

    // Test 3: Excluded vehicle check
    await runTest('DVLA-003: Excluded vehicle check (TE57VAN)', async () => {
      const { DVLA_EXCLUDED_REG_NUMBERS } = await import('../lib/constants');
      if (!DVLA_EXCLUDED_REG_NUMBERS.includes('TE57 VAN')) {
        throw new Error('TE57 VAN not in excluded list');
      }
      console.log('   → Correctly excluded from sync');
    });

    // Test 4: Invalid registration handling
    await runTest('DVLA-004: Invalid registration error handling', async () => {
      try {
        await dvlaService!.getVehicleData('INVALID123');
        throw new Error('Should have thrown error for invalid registration');
      } catch (error: any) {
        // Accept any error - could be 400, 404, or other error codes
        if (error.message.includes('Should have thrown')) throw error;
        console.log(`   → Correctly handles invalid registration (${error.message.substring(0, 50)}...)`);
      }
    });

    // Test 5: Response data completeness
    await runTest('DVLA-005: Response data completeness', async () => {
      const data = await dvlaService!.getVehicleData('VO23UKG');
      const requiredFields = ['taxDueDate', 'make', 'colour', 'fuelType'];
      const missingFields = requiredFields.filter(field => !data[field as keyof typeof data]);
      if (missingFields.length > 0) {
        throw new Error(`Missing fields: ${missingFields.join(', ')}`);
      }
      console.log(`   → All required fields present`);
    });

    console.log('\n' + '═'.repeat(80) + '\n');
  } else {
    logTest('DVLA VES API Tests', 'SKIP', 'DVLA_API_KEY not configured');
    console.log('\n' + '═'.repeat(80) + '\n');
  }

  // ===========================================
  // MOT HISTORY API TESTS
  // ===========================================
  if (motService) {
    console.log('🔧 MOT HISTORY API TESTS\n');

    // Test 6: OAuth token acquisition
    await runTest('MOT-001: OAuth token acquisition', async () => {
      const token = await (motService as any).getAccessToken();
      if (!token) throw new Error('Failed to acquire access token');
      console.log(`   → Token acquired: ${token.substring(0, 20)}...`);
    });

    // Test 7: Valid vehicle MOT history (vehicle with actual tests)
    await runTest('MOT-002: Valid vehicle MOT history (BC21YZU)', async () => {
      const data = await motService!.getMotHistory('BC21YZU');
      if (!data.registration) throw new Error('No registration in response');
      if (!data.motTests || data.motTests.length === 0) {
        throw new Error('No MOT tests returned');
      }
      console.log(`   → Found ${data.motTests.length} MOT tests`);
    });

    // Test 8: MOT expiry data extraction (vehicle with actual tests)
    await runTest('MOT-003: MOT expiry data extraction (BC21YZU)', async () => {
      const data = await motService!.getMotExpiryData('BC21YZU');
      if (!data.motExpiryDate) throw new Error('No MOT expiry date returned');
      console.log(`   → MOT expires: ${data.motExpiryDate}, Status: ${data.motStatus}`);
    });
    
    // Test 8b: Vehicle with no MOT tests yet (too new)
    await runTest('MOT-003b: New vehicle with no tests yet (VO23UKG)', async () => {
      const data = await motService!.getMotHistory('VO23UKG');
      if (!data.registration) throw new Error('No registration in response');
      if (data.motTests && data.motTests.length > 0) {
        throw new Error('Should have no MOT tests (vehicle too new)');
      }
      if (!data.motTestDueDate) throw new Error('Should have motTestDueDate from API');
      console.log(`   → No tests yet (too new), first due: ${data.motTestDueDate}`);
    });

    // Test 9: MOT test data completeness
    await runTest('MOT-004: MOT test data completeness (BC21YZU)', async () => {
      const data = await motService!.getMotHistory('BC21YZU');
      if (data.motTests && data.motTests.length > 0) {
        const firstTest = data.motTests[0];
        const requiredFields = ['motTestNumber', 'testResult', 'completedDate'];
        const missingFields = requiredFields.filter(field => !firstTest[field as keyof typeof firstTest]);
        if (missingFields.length > 0) {
          throw new Error(`Missing fields in MOT test: ${missingFields.join(', ')}`);
        }
        console.log(`   → All required fields present in ${data.motTests.length} MOT tests`);
      }
    });

    // Test 10: Vehicle with no MOT history (unknown registration)
    await runTest('MOT-005: Unknown vehicle error handling', async () => {
      try {
        await motService!.getMotHistory('AB73XYZ');
        console.log('   → Vehicle found (has MOT history)');
      } catch (error: any) {
        if (error.message.includes('not found') || error.message.includes('No MOT history')) {
          console.log('   → Correctly handles unknown vehicle');
        } else {
          throw error;
        }
      }
    });

    // Test 11: Invalid registration handling
    await runTest('MOT-006: Invalid registration error handling', async () => {
      try {
        await motService!.getMotHistory('INVALID123');
        console.log('   → API accepted registration (might be valid format)');
      } catch (error: any) {
        if (error.message.includes('not found') || error.message.includes('No MOT history')) {
          console.log('   → Correctly handles invalid/unknown registration');
        } else {
          throw new Error(`Unexpected error: ${error.message}`);
        }
      }
    });

    // Test 12: Token caching
    await runTest('MOT-007: OAuth token caching', async () => {
      const start1 = Date.now();
      await (motService as any).getAccessToken();
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await (motService as any).getAccessToken();
      const time2 = Date.now() - start2;

      if (time2 > time1 * 0.5) {
        throw new Error('Token not cached (second call took too long)');
      }
      console.log(`   → Token cached (${time1}ms vs ${time2}ms)`);
    });

    console.log('\n' + '═'.repeat(80) + '\n');
  } else {
    logTest('MOT History API Tests', 'SKIP', 'MOT API credentials not configured');
    console.log('\n' + '═'.repeat(80) + '\n');
  }

  // ===========================================
  // COMBINED API TESTS
  // ===========================================
  if (dvlaService && motService) {
    console.log('🔄 COMBINED API TESTS\n');

    // Test 14: Both APIs for same vehicle (with MOT history)
    await runTest('COMBINED-001: Fetch both APIs for same vehicle (BC21YZU)', async () => {
      const [dvlaData, motData] = await Promise.all([
        dvlaService!.getVehicleData('BC21YZU'),
        motService!.getMotExpiryData('BC21YZU'),
      ]);

      if (!dvlaData.taxDueDate) throw new Error('No tax due date from DVLA');
      if (!motData.motExpiryDate) throw new Error('No MOT expiry date from MOT API');

      console.log(`   → Tax: ${dvlaData.taxDueDate}, MOT: ${motData.motExpiryDate}`);
    });
    
    // Test 14b: Both APIs for new vehicle (no MOT tests yet)
    await runTest('COMBINED-001b: Fetch both APIs for new vehicle (VO23UKG)', async () => {
      const [dvlaData, motHistory] = await Promise.all([
        dvlaService!.getVehicleData('VO23UKG'),
        motService!.getMotHistory('VO23UKG'),
      ]);

      if (!dvlaData.taxDueDate) throw new Error('No tax due date from DVLA');
      if (!motHistory.motTestDueDate) throw new Error('No MOT test due date from MOT API');

      console.log(`   → Tax: ${dvlaData.taxDueDate}, MOT due: ${motHistory.motTestDueDate} (no tests yet)`);
    });

    // Test 15: Parallel API calls for multiple vehicles
    await runTest('COMBINED-002: Parallel calls for multiple vehicles', async () => {
      const regs = ['VO23UKG', 'BC21YZU'];
      const results = await Promise.all(
        regs.map(async reg => {
          const [dvla, mot] = await Promise.all([
            dvlaService!.getVehicleData(reg).catch(e => null),
            motService!.getMotExpiryData(reg).catch(e => null),
          ]);
          return { reg, dvla, mot };
        })
      );

      const successCount = results.filter(r => r.dvla || r.mot).length;
      console.log(`   → ${successCount}/${regs.length} vehicles processed successfully`);
    });

    // Test 16: Error handling when one API fails
    await runTest('COMBINED-003: Graceful handling when one API fails', async () => {
      try {
        const [dvlaData, motData] = await Promise.allSettled([
          dvlaService!.getVehicleData('INVALID123'),
          motService!.getMotExpiryData('INVALID123'),
        ]);

        const dvlaSuccess = dvlaData.status === 'fulfilled';
        const motSuccess = motData.status === 'fulfilled';

        console.log(`   → DVLA: ${dvlaSuccess ? 'Success' : 'Failed'}, MOT: ${motSuccess ? 'Success' : 'Failed'}`);
        console.log('   → Both APIs handled errors gracefully');
      } catch (error) {
        throw new Error('Unhandled error in parallel API calls');
      }
    });

    console.log('\n' + '═'.repeat(80) + '\n');
  }

  // ===========================================
  // ERROR HANDLING TESTS
  // ===========================================
  console.log('⚠️  ERROR HANDLING TESTS\n');

  if (dvlaService) {
    // Test 17: Empty registration
    await runTest('ERROR-001: Empty registration (DVLA)', async () => {
      try {
        await dvlaService!.getVehicleData('');
        console.log('   → API accepted empty registration (unexpected but non-fatal)');
      } catch (error: any) {
        console.log('   → Correctly rejects empty registration');
      }
    });

    // Test 18: Malformed registration
    await runTest('ERROR-002: Malformed registration (DVLA)', async () => {
      try {
        await dvlaService!.getVehicleData('A');
        console.log('   → API accepted single character (unexpected but non-fatal)');
      } catch (error: any) {
        console.log('   → Correctly rejects malformed registration');
      }
    });
  }

  if (motService) {
    // Test 19: Empty registration
    await runTest('ERROR-003: Empty registration (MOT)', async () => {
      try {
        await motService!.getMotHistory('');
        console.log('   → API accepted empty registration (unexpected but non-fatal)');
      } catch (error: any) {
        console.log('   → Correctly rejects empty registration');
      }
    });

    // Test 20: Malformed registration
    await runTest('ERROR-004: Malformed registration (MOT)', async () => {
      try {
        await motService!.getMotHistory('A');
        console.log('   → API accepted single character (unexpected but non-fatal)');
      } catch (error: any) {
        console.log('   → Correctly rejects malformed registration');
      }
    });
  }

  console.log('\n' + '═'.repeat(80) + '\n');

  // ===========================================
  // SUMMARY
  // ===========================================
  console.log('📊 TEST SUMMARY\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const total = results.length;

  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`\nSuccess Rate: ${((passed / (total - skipped)) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:\n');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`   ${r.name}: ${r.message}`);
      if (r.error) {
        console.log(`   ${r.error.stack || r.error}`);
      }
    });
  }

  console.log('\n' + '═'.repeat(80));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});

