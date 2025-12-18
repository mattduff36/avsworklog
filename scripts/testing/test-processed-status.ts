/**
 * Test Suite for Timesheet Processed Status Feature
 * Tests database constraints, status transitions, and business logic
 * 
 * Run with: npx tsx scripts/test-processed-status.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class TestRunner {
  private results: TestResult[] = [];
  private client: pg.Client;

  constructor(client: pg.Client) {
    this.client = client;
  }

  async test(name: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    try {
      await testFn();
      this.results.push({
        name,
        passed: true,
        duration: Date.now() - startTime,
      });
      console.log(`  ✅ ${name}`);
    } catch (error) {
      this.results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      console.log(`  ❌ ${name}`);
      console.log(`     Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  printSummary(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 TEST SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`Total Tests: ${this.results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏱️  Total Duration: ${totalDuration}ms\n`);

    if (failed > 0) {
      console.log('Failed Tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  - ${r.name}`);
          console.log(`    ${r.error}`);
        });
      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  hasFailures(): boolean {
    return this.results.some(r => !r.passed);
  }
}

async function runTests() {
  console.log('🧪 Running Processed Status Feature Test Suite\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
    console.log('📡 Connecting to database...\n');
    await client.connect();
    
    const runner = new TestRunner(client);

    // Test 1: Database Constraint
    console.log('🗄️  DATABASE TESTS\n');
    
    await runner.test('Status constraint includes "processed"', async () => {
      const { rows } = await client.query(`
        SELECT pg_get_constraintdef(oid) as definition
        FROM pg_constraint
        WHERE conname = 'timesheets_status_check'
      `);
      
      if (rows.length === 0) {
        throw new Error('Status constraint not found');
      }
      
      const definition = rows[0].definition;
      if (!definition.includes('processed')) {
        throw new Error('Constraint does not include "processed" status');
      }
    });

    // Test 2: Get existing employee user
    let testUserId: string;
    await runner.test('Get existing employee user', async () => {
      const { rows } = await client.query(`
        SELECT id FROM profiles 
        WHERE role = 'employee' 
        LIMIT 1
      `);
      
      if (rows.length === 0) {
        throw new Error('No employee users found in database. Please create a test employee first.');
      }
      
      testUserId = rows[0].id;
    });

    // Test 3: Get existing manager
    let testManagerId: string;
    await runner.test('Get existing manager user', async () => {
      const { rows } = await client.query(`
        SELECT id FROM profiles 
        WHERE role IN ('manager', 'admin')
        LIMIT 1
      `);
      
      if (rows.length === 0) {
        throw new Error('No manager/admin users found in database. Please create a test manager first.');
      }
      
      testManagerId = rows[0].id;
    });

    // Test 4: Create draft timesheet
    let testTimesheetId: string;
    await runner.test('Create draft timesheet', async () => {
      const { rows } = await client.query(`
        INSERT INTO timesheets (user_id, week_ending, status, reg_number)
        VALUES ($1, CURRENT_DATE, 'draft', 'TEST123')
        RETURNING id
      `, [testUserId]);
      testTimesheetId = rows[0].id;
    });

    // Test 5: Transition to submitted
    await runner.test('Transition draft → submitted', async () => {
      await client.query(`
        UPDATE timesheets 
        SET status = 'submitted', submitted_at = NOW()
        WHERE id = $1
      `, [testTimesheetId]);
      
      const { rows } = await client.query(`
        SELECT status FROM timesheets WHERE id = $1
      `, [testTimesheetId]);
      
      if (rows[0].status !== 'submitted') {
        throw new Error('Status not updated to submitted');
      }
    });

    // Test 6: Transition to approved
    await runner.test('Transition submitted → approved', async () => {
      await client.query(`
        UPDATE timesheets 
        SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
        WHERE id = $2
      `, [testManagerId, testTimesheetId]);
      
      const { rows } = await client.query(`
        SELECT status, reviewed_by FROM timesheets WHERE id = $1
      `, [testTimesheetId]);
      
      if (rows[0].status !== 'approved') {
        throw new Error('Status not updated to approved');
      }
      if (rows[0].reviewed_by !== testManagerId) {
        throw new Error('Reviewed_by not set correctly');
      }
    });

    // Test 7: Transition to processed
    await runner.test('Transition approved → processed', async () => {
      await client.query(`
        UPDATE timesheets 
        SET status = 'processed'
        WHERE id = $1
      `, [testTimesheetId]);
      
      const { rows } = await client.query(`
        SELECT status FROM timesheets WHERE id = $1
      `, [testTimesheetId]);
      
      if (rows[0].status !== 'processed') {
        throw new Error('Status not updated to processed');
      }
    });

    // Test 8: Invalid status should fail
    await runner.test('Invalid status should be rejected', async () => {
      try {
        await client.query(`
          UPDATE timesheets 
          SET status = 'invalid_status'
          WHERE id = $1
        `, [testTimesheetId]);
        throw new Error('Invalid status was accepted - constraint not working');
      } catch (error) {
        if (error instanceof Error && error.message.includes('constraint')) {
          // Expected behavior
          return;
        }
        throw error;
      }
    });

    // Test 9: Query by processed status
    await runner.test('Query timesheets by processed status', async () => {
      const { rows } = await client.query(`
        SELECT COUNT(*) as count
        FROM timesheets
        WHERE status = 'processed'
      `);
      
      const count = parseInt(rows[0].count);
      if (count < 1) {
        throw new Error('No processed timesheets found after creating one');
      }
    });

    // Test 10: Filter functionality
    console.log('\n📋 FILTER TESTS\n');
    
    await runner.test('Filter by each status type', async () => {
      const statuses = ['draft', 'submitted', 'approved', 'rejected', 'processed'];
      
      for (const status of statuses) {
        const { rows } = await client.query(`
          SELECT COUNT(*) as count
          FROM timesheets
          WHERE status = $1
        `, [status]);
        
        // Query should execute without error
        if (!rows || rows.length === 0) {
          throw new Error(`Query failed for status: ${status}`);
        }
      }
    });

    // Test 11: Status workflow validation
    console.log('\n🔄 WORKFLOW TESTS\n');
    
    await runner.test('Create complete workflow timesheet', async () => {
      // Create a new timesheet for workflow test
      const { rows } = await client.query(`
        INSERT INTO timesheets (user_id, week_ending, status, reg_number)
        VALUES ($1, CURRENT_DATE + INTERVAL '7 days', 'draft', 'WORKFLOW01')
        RETURNING id
      `, [testUserId]);
      
      const workflowTimesheetId = rows[0].id;
      
      // Test workflow: draft → submitted → approved → processed
      await client.query(`UPDATE timesheets SET status = 'submitted' WHERE id = $1`, [workflowTimesheetId]);
      await client.query(`UPDATE timesheets SET status = 'approved', reviewed_by = $1 WHERE id = $2`, [testManagerId, workflowTimesheetId]);
      await client.query(`UPDATE timesheets SET status = 'processed' WHERE id = $1`, [workflowTimesheetId]);
      
      const { rows: finalRows } = await client.query(`
        SELECT status FROM timesheets WHERE id = $1
      `, [workflowTimesheetId]);
      
      if (finalRows[0].status !== 'processed') {
        throw new Error('Workflow did not complete to processed status');
      }
      
      // Clean up workflow test timesheet
      await client.query(`DELETE FROM timesheets WHERE id = $1`, [workflowTimesheetId]);
    });

    // Test 12: Multiple status queries
    await runner.test('Query all statuses at once', async () => {
      const { rows } = await client.query(`
        SELECT status, COUNT(*) as count
        FROM timesheets
        GROUP BY status
        ORDER BY status
      `);
      
      if (!rows || rows.length === 0) {
        throw new Error('No timesheets found');
      }
      
      // Verify processed status exists in results
      const hasProcessed = rows.some(r => r.status === 'processed');
      if (!hasProcessed) {
        throw new Error('Processed status not found in grouped results');
      }
    });

    // Test 13: Data integrity
    console.log('\n🔒 DATA INTEGRITY TESTS\n');
    
    await runner.test('Processed timesheet retains all data', async () => {
      const { rows } = await client.query(`
        SELECT 
          user_id, 
          week_ending, 
          status, 
          reviewed_by,
          reg_number
        FROM timesheets 
        WHERE id = $1
      `, [testTimesheetId]);
      
      if (rows.length === 0) {
        throw new Error('Timesheet not found');
      }
      
      const timesheet = rows[0];
      if (!timesheet.user_id || !timesheet.week_ending || !timesheet.reviewed_by) {
        throw new Error('Processed timesheet missing required data');
      }
    });

    // Test 14: Status badge mapping exists for all statuses
    await runner.test('All status types are valid', async () => {
      const validStatuses = ['draft', 'submitted', 'approved', 'rejected', 'processed'];
      
      const { rows } = await client.query(`
        SELECT DISTINCT status
        FROM timesheets
      `);
      
      const dbStatuses = rows.map(r => r.status);
      const invalidStatuses = dbStatuses.filter(s => !validStatuses.includes(s));
      
      if (invalidStatuses.length > 0) {
        throw new Error(`Invalid statuses found in database: ${invalidStatuses.join(', ')}`);
      }
    });

    // Cleanup
    console.log('\n🧹 CLEANUP\n');
    
    await runner.test('Cleanup test data', async () => {
      // Delete test timesheet (with entries cascade)
      if (testTimesheetId) {
        await client.query(`DELETE FROM timesheets WHERE id = $1`, [testTimesheetId]);
      }
      
      // Clean up any other test timesheets
      await client.query(`
        DELETE FROM timesheets 
        WHERE reg_number IN ('TEST123', 'WORKFLOW01')
      `);
    });

    // Print results
    runner.printSummary();

    return runner.hasFailures() ? 1 : 0;

  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    return 1;
  } finally {
    await client.end();
  }
}

// Run tests
runTests()
  .then((exitCode) => {
    if (exitCode === 0) {
      console.log('✨ All tests passed! Feature is working correctly.\n');
    } else {
      console.log('⚠️  Some tests failed. Please review the errors above.\n');
    }
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

