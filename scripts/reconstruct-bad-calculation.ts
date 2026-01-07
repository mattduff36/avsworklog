/**
 * Reconstruct how the incorrect date 2026-02-28 was calculated
 */

console.log('\n🔍 Reconstructing the Bad Calculation');
console.log('='.repeat(70));

console.log('\nVehicle: FE24 TYO');
console.log('Stored MOT Due Date: 2026-02-28');
console.log('Correct MOT Due Date: 2027-03-20 (or 2027-03-21)');

console.log('\n📅 Testing Different Scenarios:\n');

// Scenario 1: What date + 3 years gives us 2026-02-28?
const wrongDate = new Date('2026-02-28');
const threeYearsEarlier = new Date(wrongDate);
threeYearsEarlier.setFullYear(threeYearsEarlier.getFullYear() - 3);

console.log('Scenario 1: Working backwards from 2026-02-28');
console.log('  If we subtract 3 years: ', threeYearsEarlier.toISOString().split('T')[0]);
console.log('  This suggests the code used: February 28 (or 29), 2023 as the base');

// Scenario 2: What if DVLA returned "2023.02"?
console.log('\nScenario 2: DVLA returned monthOfFirstRegistration "2023.02"');
const dvlaDate2023_02 = new Date(2023, 1, 1); // Feb 1, 2023
const dvlaPlus3_2023_02 = new Date(dvlaDate2023_02);
dvlaPlus3_2023_02.setFullYear(dvlaPlus3_2023_02.getFullYear() + 3);
console.log('  Base: ', dvlaDate2023_02.toISOString().split('T')[0]);
console.log('  + 3 years:', dvlaPlus3_2023_02.toISOString().split('T')[0]);
console.log('  ❌ This gives 2026-02-01, not 2026-02-28');

// Scenario 3: What if there's a timezone issue?
console.log('\nScenario 3: Timezone/Date parsing issue');
const feb28_2023 = new Date('2023-02-28');
const feb28Plus3 = new Date(feb28_2023);
feb28Plus3.setFullYear(feb28Plus3.getFullYear() + 3);
console.log('  Base: 2023-02-28');
console.log('  + 3 years:', feb28Plus3.toISOString().split('T')[0]);
console.log('  ✅ This matches! 2026-02-28');

// Scenario 4: Parse the registration plate
console.log('\nScenario 4: Registration Plate Analysis');
const regNumber = 'FE24 TYO';
const plateNumber = parseInt(regNumber.substring(2, 4));
console.log('  Plate: ', regNumber);
console.log('  Plate number:', plateNumber);

if (plateNumber >= 0 && plateNumber <= 49) {
  console.log('  Format: March-August registration');
  console.log('  24 = March 2024 onwards');
} else if (plateNumber >= 50) {
  console.log('  Format: September-February registration');
  console.log('  Plate year:', 2000 + (plateNumber - 50));
}

console.log('\n🎯 CONCLUSION:');
console.log('  The wrong date 2026-02-28 comes from: February 28, 2023 + 3 years');
console.log('  But FE24 is a March 2024 plate!');
console.log('  Someone/something used the wrong base year (2023 instead of 2024)');

console.log('\n💡 LIKELY CAUSE:');
console.log('  When the vehicle was added on Oct 30, 2024:');
console.log('  1. The MOT API call FAILED (vehicle too new)');
console.log('  2. The DVLA API returned bad data OR');
console.log('  3. There was a bug in the initial sync code OR');
console.log('  4. The MOT API returned a bad motTestDueDate initially');

console.log('\n🔧 FIX:');
console.log('  Run a manual sync NOW to update with correct data from MOT API');
console.log('  The MOT API now returns the correct date: 2027-03-20');

console.log('\n' + '='.repeat(70));

