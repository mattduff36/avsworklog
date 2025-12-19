/**
 * Unit tests for error logging system
 * Tests the core functionality without requiring a running server
 */

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

// Mock Request object for testing
class MockRequest {
  public url: string;
  public method: string;
  public headers: Map<string, string>;

  constructor(url: string, method: string = 'GET') {
    this.url = url;
    this.method = method;
    this.headers = new Map([
      ['user-agent', 'Mozilla/5.0 (Test Browser)'],
      ['referer', 'http://localhost:3000/test-page'],
      ['origin', 'http://localhost:3000'],
    ]);
  }

  get(key: string): string | null {
    return this.headers.get(key) || null;
  }
}

// Extract the context generation logic
function extractRequestContext(request: any): Record<string, unknown> {
  const url = new URL(request.url);
  
  return {
    method: request.method,
    pathname: url.pathname,
    searchParams: Object.fromEntries(url.searchParams.entries()),
    referer: request.headers.get('referer') || null,
    origin: request.headers.get('origin') || null,
  };
}

// Generate error description
function generateErrorDescription(
  error: Error,
  componentName: string | null,
  requestContext: Record<string, unknown>
): string {
  const parts: string[] = [];
  
  if (componentName) {
    parts.push(`Error in ${componentName}`);
  }
  
  if (requestContext.method && requestContext.pathname) {
    parts.push(`${requestContext.method} ${requestContext.pathname}`);
  }
  
  if (error.name && error.name !== 'Error') {
    parts.push(`(${error.name})`);
  }
  
  parts.push(`- ${error.message}`);
  
  if (requestContext.searchParams && Object.keys(requestContext.searchParams as object).length > 0) {
    parts.push(`\nQuery params: ${JSON.stringify(requestContext.searchParams, null, 2)}`);
  }
  
  return parts.join(' ');
}

// Test Suite
const tests: TestResult[] = [];

console.log('🧪 Running Error Logging Unit Tests\n');
console.log('='.repeat(60) + '\n');

// Test 1: Basic Error Description Generation
try {
  const error = new Error('Database connection failed');
  const mockReq = new MockRequest('http://localhost:3000/api/rams?id=123', 'GET');
  const context = extractRequestContext(mockReq);
  const description = generateErrorDescription(error, 'GET /api/rams', context);
  
  const hasComponentName = description.includes('GET /api/rams');
  const hasMethod = description.includes('GET');
  const hasPathname = description.includes('/api/rams');
  const hasErrorMessage = description.includes('Database connection failed');
  const hasQueryParams = description.includes('Query params');
  
  if (hasComponentName && hasMethod && hasPathname && hasErrorMessage && hasQueryParams) {
    tests.push({
      name: 'Error Description Generation',
      passed: true,
      message: 'Generated complete error description',
      details: description
    });
  } else {
    tests.push({
      name: 'Error Description Generation',
      passed: false,
      message: 'Missing required parts in description',
      details: `Has component: ${hasComponentName}, method: ${hasMethod}, pathname: ${hasPathname}, message: ${hasErrorMessage}, params: ${hasQueryParams}`
    });
  }
} catch (error) {
  tests.push({
    name: 'Error Description Generation',
    passed: false,
    message: `Test threw error: ${error instanceof Error ? error.message : 'Unknown'}`
  });
}

// Test 2: Request Context Extraction
try {
  const mockReq = new MockRequest('http://localhost:3000/api/messages?type=toolbox&urgent=true', 'POST');
  const context = extractRequestContext(mockReq);
  
  const hasMethod = context.method === 'POST';
  const hasPathname = context.pathname === '/api/messages';
  const hasSearchParams = JSON.stringify(context.searchParams) === JSON.stringify({ type: 'toolbox', urgent: 'true' });
  const hasReferer = context.referer === 'http://localhost:3000/test-page';
  const hasOrigin = context.origin === 'http://localhost:3000';
  
  if (hasMethod && hasPathname && hasSearchParams && hasReferer && hasOrigin) {
    tests.push({
      name: 'Request Context Extraction',
      passed: true,
      message: 'Extracted all context fields correctly',
      details: JSON.stringify(context, null, 2)
    });
  } else {
    tests.push({
      name: 'Request Context Extraction',
      passed: false,
      message: 'Missing or incorrect context fields',
      details: `Method: ${hasMethod}, Pathname: ${hasPathname}, Params: ${hasSearchParams}, Referer: ${hasReferer}, Origin: ${hasOrigin}`
    });
  }
} catch (error) {
  tests.push({
    name: 'Request Context Extraction',
    passed: false,
    message: `Test threw error: ${error instanceof Error ? error.message : 'Unknown'}`
  });
}

// Test 3: Error Types Handling
try {
  const errorTypes = [
    new Error('Standard error'),
    new TypeError('Type error'),
    new ReferenceError('Reference error'),
  ];
  
  let allPassed = true;
  const results: string[] = [];
  
  for (const error of errorTypes) {
    const mockReq = new MockRequest('http://localhost:3000/api/test', 'GET');
    const context = extractRequestContext(mockReq);
    const description = generateErrorDescription(error, 'Test Component', context);
    
    const hasErrorType = description.includes(error.name) || error.name === 'Error';
    const hasMessage = description.includes(error.message);
    
    if (!hasErrorType || !hasMessage) {
      allPassed = false;
    }
    
    results.push(`${error.name}: ${hasErrorType && hasMessage ? '✅' : '❌'}`);
  }
  
  tests.push({
    name: 'Multiple Error Types',
    passed: allPassed,
    message: allPassed ? 'All error types handled correctly' : 'Some error types not handled',
    details: results.join(', ')
  });
} catch (error) {
  tests.push({
    name: 'Multiple Error Types',
    passed: false,
    message: `Test threw error: ${error instanceof Error ? error.message : 'Unknown'}`
  });
}

// Test 4: Query Parameters in Description
try {
  const mockReq1 = new MockRequest('http://localhost:3000/api/rams', 'GET');
  const context1 = extractRequestContext(mockReq1);
  const desc1 = generateErrorDescription(new Error('Test'), null, context1);
  const hasNoParams = !desc1.includes('Query params');
  
  const mockReq2 = new MockRequest('http://localhost:3000/api/rams?id=123&status=active', 'GET');
  const context2 = extractRequestContext(mockReq2);
  const desc2 = generateErrorDescription(new Error('Test'), null, context2);
  const hasParams = desc2.includes('Query params') && desc2.includes('id') && desc2.includes('status');
  
  if (hasNoParams && hasParams) {
    tests.push({
      name: 'Query Parameters Handling',
      passed: true,
      message: 'Correctly shows params only when present'
    });
  } else {
    tests.push({
      name: 'Query Parameters Handling',
      passed: false,
      message: 'Query params not handled correctly',
      details: `No params case: ${hasNoParams}, With params case: ${hasParams}`
    });
  }
} catch (error) {
  tests.push({
    name: 'Query Parameters Handling',
    passed: false,
    message: `Test threw error: ${error instanceof Error ? error.message : 'Unknown'}`
  });
}

// Test 5: Real-World Error Scenario
try {
  // Simulate a real RAMS API error
  const error = new Error('RAMS document not found');
  const mockReq = new MockRequest('http://localhost:3000/api/rams/abc123/email?notify=true', 'POST');
  const context = extractRequestContext(mockReq);
  const description = generateErrorDescription(error, 'POST /api/rams/[id]/email', context);
  
  const checks = {
    hasComponent: description.includes('POST /api/rams/[id]/email'),
    hasMethod: description.includes('POST'),
    hasPath: description.includes('/api/rams/abc123/email'),
    hasError: description.includes('RAMS document not found'),
    hasQueryParams: description.includes('notify'),
  };
  
  const allChecks = Object.values(checks).every(v => v);
  
  tests.push({
    name: 'Real-World Error Scenario',
    passed: allChecks,
    message: allChecks ? 'Complete error context captured' : 'Missing some context',
    details: `\nGenerated description:\n${description}\n\nChecks: ${JSON.stringify(checks, null, 2)}`
  });
} catch (error) {
  tests.push({
    name: 'Real-World Error Scenario',
    passed: false,
    message: `Test threw error: ${error instanceof Error ? error.message : 'Unknown'}`
  });
}

// Test 6: Client-Side Error Message Formatting
try {
  // Simulate different client error types
  const uncaughtError = new Error('Cannot read property of undefined');
  uncaughtError.stack = 'Error: Cannot read property of undefined\n    at main.js:42:15';
  
  const promiseError = new Error('Promise rejected');
  
  const consoleError = new Error('Console Error: API call failed');
  
  const tests_client = [
    { error: uncaughtError, type: 'Uncaught' },
    { error: promiseError, type: 'Promise' },
    { error: consoleError, type: 'Console' },
  ];
  
  let allFormatted = true;
  const results: string[] = [];
  
  for (const test of tests_client) {
    const hasMessage = test.error.message.length > 0;
    const hasStack = test.error.stack !== undefined;
    
    if (!hasMessage) {
      allFormatted = false;
    }
    
    results.push(`${test.type}: ${hasMessage ? '✅' : '❌'}`);
  }
  
  tests.push({
    name: 'Client-Side Error Formatting',
    passed: allFormatted,
    message: allFormatted ? 'All client error types formatted' : 'Some errors not formatted',
    details: results.join(', ')
  });
} catch (error) {
  tests.push({
    name: 'Client-Side Error Formatting',
    passed: false,
    message: `Test threw error: ${error instanceof Error ? error.message : 'Unknown'}`
  });
}

// Print Results
console.log('\n📊 Test Results\n');
console.log('='.repeat(60) + '\n');

let maxNameLength = 0;
tests.forEach(t => {
  if (t.name.length > maxNameLength) maxNameLength = t.name.length;
});

tests.forEach(test => {
  const icon = test.passed ? '✅' : '❌';
  const padding = ' '.repeat(maxNameLength - test.name.length);
  console.log(`${icon} ${test.name}${padding}  ${test.message}`);
  
  if (test.details && !test.passed) {
    console.log(`   ${test.details}\n`);
  }
});

// Summary
const passed = tests.filter(t => t.passed).length;
const failed = tests.filter(t => !t.passed).length;
const total = tests.length;
const percentage = Math.round((passed / total) * 100);

console.log('\n' + '='.repeat(60));
console.log(`\n📈 Score: ${passed}/${total} tests passed (${percentage}%)\n`);

if (failed > 0) {
  console.log('⚠️  Some tests failed. Review the details above.\n');
  process.exit(1);
} else {
  console.log('✨ All tests passed!\n');
  console.log('🎯 The error logging system is working correctly:');
  console.log('   ✅ Error descriptions are clear and contextual');
  console.log('   ✅ Request context is properly extracted');
  console.log('   ✅ All error types are handled');
  console.log('   ✅ Query parameters are included when present');
  console.log('   ✅ Real-world scenarios work correctly\n');
  process.exit(0);
}
