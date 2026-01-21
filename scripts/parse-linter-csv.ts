import { readFileSync } from 'fs';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: npx tsx scripts/parse-linter-csv.ts <csv-file>');
  process.exit(1);
}

const csv = readFileSync(csvPath, 'utf-8');
const lines = csv.split('\n');

// Skip header
const data = lines.slice(1).filter(line => line.trim());

const affectedPolicies = new Map<string, Set<string>>();

for (const line of data) {
  // Extract table and policy from the detail column
  // Format: Table `public.tablename` has a row level security policy `policy name` that re-evaluates...
  const tableMatch = line.match(/Table \\`public\.([^\\`]+)\\`/);
  const policyMatch = line.match(/policy \\`([^\\`]+)\\`/);
  
  if (tableMatch && policyMatch) {
    const tableName = tableMatch[1];
    const policyName = policyMatch[1];
    
    if (!affectedPolicies.has(tableName)) {
      affectedPolicies.set(tableName, new Set());
    }
    affectedPolicies.get(tableName)!.add(policyName);
  }
}

console.log(`\n📊 Performance Issues Summary`);
console.log(`Total affected policies: ${Array.from(affectedPolicies.values()).reduce((sum, set) => sum + set.size, 0)}`);
console.log(`Affected tables: ${affectedPolicies.size}\n`);

console.log(`Tables and Policies:\n`);
for (const [table, policies] of Array.from(affectedPolicies.entries()).sort()) {
  console.log(`📋 ${table} (${policies.size} policies):`);
  for (const policy of Array.from(policies).sort()) {
    console.log(`   - ${policy}`);
  }
  console.log('');
}
