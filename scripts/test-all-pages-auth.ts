/**
 * Comprehensive Authentication Test
 * Tests ALL dashboard pages to ensure they require authentication
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

interface TestResult {
  route: string;
  passed: boolean;
  status: number;
  redirectsToLogin: boolean;
  error?: string;
}

const PROTECTED_ROUTES = [
  // Main dashboard
  '/dashboard',
  
  // Employee pages
  '/timesheets',
  '/timesheets/new',
  '/inspections',
  '/inspections/new',
  '/absence',
  '/absence/manage',
  '/absence/manage/reasons',
  '/absence/manage/allowances',
  
  // Manager/Admin pages
  '/approvals',
  '/actions',
  '/reports',
  '/toolbox-talks',
  '/rams',
  
  // Admin pages
  '/admin/users',
  '/admin/vehicles',
];

const PUBLIC_ROUTES = [
  '/login',
];

// Root redirects to /dashboard (expected behavior)
const REDIRECT_ROUTES = [
  {
    route: '/',
    expectedRedirect: '/dashboard',
    description: 'Root should redirect to dashboard'
  }
];

async function testRoute(route: string, shouldBeProtected: boolean): Promise<TestResult> {
  try {
    const response = await fetch(`${BASE_URL}${route}`, {
      redirect: 'manual', // Don't follow redirects automatically
      headers: {
        'User-Agent': 'Auth-Test-Script'
      }
    });

    const status = response.status;
    const location = response.headers.get('location') || '';
    const redirectsToLogin = location.includes('/login');

    if (shouldBeProtected) {
      // Protected route should redirect to login (302/307) or return unauthorized (401/403)
      const passed = (status === 302 || status === 307) && redirectsToLogin;
      
      return {
        route,
        passed,
        status,
        redirectsToLogin,
        error: passed ? undefined : `Expected redirect to /login, got status ${status} → ${location || 'no redirect'}`
      };
    } else {
      // Public route should be accessible (200)
      const passed = status === 200;
      
      return {
        route,
        passed,
        status,
        redirectsToLogin: false,
        error: passed ? undefined : `Expected status 200, got ${status}`
      };
    }
  } catch (error: any) {
    return {
      route,
      passed: false,
      status: 0,
      redirectsToLogin: false,
      error: `Request failed: ${error.message}`
    };
  }
}

async function runTests() {
  console.log('🔒 COMPREHENSIVE AUTHENTICATION TEST\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results: TestResult[] = [];

  // Test protected routes
  console.log('🛡️  TESTING PROTECTED ROUTES (should redirect to /login):\n');
  for (const route of PROTECTED_ROUTES) {
    const result = await testRoute(route, true);
    results.push(result);
    
    const icon = result.passed ? '✅' : '❌';
    const statusText = result.redirectsToLogin ? `${result.status} → /login` : `${result.status}`;
    console.log(`   ${icon} ${route.padEnd(40)} [${statusText}]`);
    
    if (!result.passed && result.error) {
      console.log(`      ⚠️  ${result.error}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test redirect routes
  console.log('🔀 TESTING REDIRECT ROUTES (should redirect as expected):\n');
  for (const { route, expectedRedirect, description } of REDIRECT_ROUTES) {
    try {
      const response = await fetch(`${BASE_URL}${route}`, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Auth-Test-Script' }
      });
      
      const status = response.status;
      const location = response.headers.get('location') || '';
      const passed = (status === 307 || status === 302) && location.includes(expectedRedirect);
      
      results.push({ route, passed, status, redirectsToLogin: false });
      
      const icon = passed ? '✅' : '❌';
      console.log(`   ${icon} ${route.padEnd(40)} [${status} → ${location || 'nowhere'}]`);
      console.log(`      ${description}`);
      
      if (!passed) {
        results[results.length - 1].error = `Expected redirect to ${expectedRedirect}, got ${location}`;
      }
    } catch (error: any) {
      results.push({
        route,
        passed: false,
        status: 0,
        redirectsToLogin: false,
        error: error.message
      });
      console.log(`   ❌ ${route.padEnd(40)} [ERROR]`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test public routes
  console.log('🌐 TESTING PUBLIC ROUTES (should be accessible):\n');
  for (const route of PUBLIC_ROUTES) {
    const result = await testRoute(route, false);
    results.push(result);
    
    const icon = result.passed ? '✅' : '❌';
    console.log(`   ${icon} ${route.padEnd(40)} [${result.status}]`);
    
    if (!result.passed && result.error) {
      console.log(`      ⚠️  ${result.error}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Summary
  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;

  console.log('📊 TEST RESULTS:\n');
  console.log(`   Total Tests:  ${totalTests}`);
  console.log(`   ✅ Passed:     ${passedTests}`);
  console.log(`   ❌ Failed:     ${failedTests}`);
  console.log(`   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

  if (failedTests > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('❌ FAILED TESTS:\n');
    results.filter(r => !r.passed).forEach(result => {
      console.log(`   Route: ${result.route}`);
      console.log(`   Error: ${result.error}`);
      console.log('');
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔧 RECOMMENDED FIXES:\n');
    
    const unprotectedRoutes = results.filter(r => !r.passed && r.status === 200 && r.route.startsWith('/'));
    if (unprotectedRoutes.length > 0) {
      console.log('   These routes are NOT protected by middleware:');
      unprotectedRoutes.forEach(r => console.log(`   - ${r.route}`));
      console.log('\n   → Add them to protectedPaths in lib/supabase/middleware.ts\n');
    }

    process.exit(1);
  } else {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ ALL TESTS PASSED!\n');
    console.log('   🔒 All protected routes require authentication');
    console.log('   🌐 All public routes are accessible');
    console.log('   🎯 Security validation complete\n');
    
    process.exit(0);
  }
}

// Check if dev server is running
async function checkServer() {
  try {
    await fetch(BASE_URL);
    return true;
  } catch (error) {
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.error('❌ Error: Development server is not running!\n');
    console.log('Please start the dev server first:');
    console.log('   npm run dev\n');
    console.log('Then run this test again.');
    process.exit(1);
  }

  await runTests();
}

main().catch(console.error);

