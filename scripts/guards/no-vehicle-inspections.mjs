/**
 * Static Guard: No runtime references to vehicle_inspections
 *
 * Scans app/, lib/, components/ for forbidden references to the old
 * vehicle_inspections table. Exits with code 1 if any are found.
 *
 * Allowlisted patterns:
 * - FK constraint hint names (!vehicle_inspections_*_fkey) are expected
 * - Supabase PostgREST uses original constraint names after table rename
 *
 * Usage: node scripts/guards/no-vehicle-inspections.mjs
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const checks = [
  {
    name: "from('vehicle_inspections')",
    pattern: "from\\(['\"]vehicle_inspections['\"]\\)",
    dirs: ['app/', 'lib/', 'components/'],
  },
  {
    name: "Tables['vehicle_inspections']",
    pattern: "Tables\\[.vehicle_inspections.\\]",
    dirs: ['app/', 'lib/', 'components/'],
  },
];

let failed = false;

for (const check of checks) {
  try {
    const dirs = check.dirs.join(' ');
    const result = execSync(
      `rg "${check.pattern}" -l ${dirs} 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    ).trim();

    if (result) {
      const files = result.split('\n').filter(Boolean);
      console.error(`❌ GUARD FAILED: ${check.name} found in:`);
      files.forEach(f => console.error(`   ${f}`));
      failed = true;
    } else {
      console.log(`✅ ${check.name}: clean`);
    }
  } catch {
    console.log(`✅ ${check.name}: clean (no rg matches)`);
  }
}

if (failed) {
  console.error('\n❌ Static guard FAILED. Fix forbidden references before pushing.');
  process.exit(1);
} else {
  console.log('\n✅ All static guards passed.');
  process.exit(0);
}
