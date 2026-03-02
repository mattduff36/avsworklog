#!/usr/bin/env tsx

/**
 * Test Date Normalization Logic
 * 
 * Verifies that the normalization logic correctly handles all edge cases
 */

// Mock formatDateForInput behavior
function formatDateForInput(date: string | null | undefined): string {
  if (!date) return '';
  try {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

// The normalization function from the fix
function normalizeDateValue(val: string | null | undefined): string | null {
  if (!val || val === '') return null;
  return val;
}

// Test cases
console.log('🧪 Testing Date Normalization Logic\n');

const testCases = [
  {
    name: 'Both null (no change)',
    dbValue: null,
    formValue: undefined,
    shouldCreateEntry: false
  },
  {
    name: 'Both have same date',
    dbValue: '2026-09-22',
    formValue: '2026-09-22',
    shouldCreateEntry: false
  },
  {
    name: 'Date added (null → value)',
    dbValue: null,
    formValue: '2026-09-22',
    shouldCreateEntry: true
  },
  {
    name: 'Date removed (value → null)',
    dbValue: '2026-09-22',
    formValue: undefined,
    shouldCreateEntry: true
  },
  {
    name: 'Date changed (value → different value)',
    dbValue: '2026-09-22',
    formValue: '2027-01-15',
    shouldCreateEntry: true
  },
  {
    name: 'Empty string from form (should be treated as null)',
    dbValue: null,
    formValue: '',
    shouldCreateEntry: false
  }
];

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  // Simulate the logic from EditPlantRecordDialog
  const formData = test.formValue;
  const plantValue = test.dbValue;
  
  const newValue = normalizeDateValue(formData);
  const oldValue = normalizeDateValue(formatDateForInput(plantValue));
  
  const wouldCreateEntry = newValue !== oldValue;
  const testPassed = wouldCreateEntry === test.shouldCreateEntry;
  
  const icon = testPassed ? '✅' : '❌';
  const status = testPassed ? 'PASS' : 'FAIL';
  
  console.log(`${index + 1}. ${icon} ${test.name}`);
  console.log(`   DB: ${plantValue ?? 'null'} → Form: ${formData ?? 'undefined'}`);
  console.log(`   Normalized: old="${oldValue}" new="${newValue}"`);
  console.log(`   Would create entry: ${wouldCreateEntry} (expected: ${test.shouldCreateEntry})`);
  console.log(`   ${status}\n`);
  
  if (testPassed) {
    passed++;
  } else {
    failed++;
  }
});

console.log('═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
