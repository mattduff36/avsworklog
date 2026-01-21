/**
 * Lint Script: Detect High-Risk Contrast Patterns
 * Focuses on combinations that cause dark-on-dark or light-on-light issues
 */

import * as fs from 'fs';
import { execSync } from 'child_process';

// High-risk patterns (combinations that cause contrast issues)
const HIGH_RISK_PATTERNS = [
  {
    name: 'Dual-mode card without tokens',
    pattern: /className="bg-white dark:bg-slate-900(?! border-border)/,
    risk: 'Using raw palette instead of bg-card token',
  },
  {
    name: 'Dark text without dark mode variant',
    pattern: /text-slate-900(?! dark:)/,
    risk: 'Dark text may be invisible on dark backgrounds',
  },
  {
    name: 'Light text without proper contrast',
    pattern: /text-slate-600(?! dark:)/,
    risk: 'May have insufficient contrast on dark backgrounds',
  },
  {
    name: 'Raw slate backgrounds in components',
    pattern: /className="(?:.*\s)?bg-slate-[789]00(?!\s*border-border)/,
    risk: 'Raw palette backgrounds should use semantic tokens',
  },
];

// Files allowed to use these patterns
const ALLOWLIST = [
  'components/ui/',
  'scripts/',
  'tests/',
  'docs/',
  'app/globals.css',
];

function isAllowlisted(filePath: string): boolean {
  return ALLOWLIST.some(allowed => filePath.includes(allowed));
}

interface Violation {
  file: string;
  line: number;
  pattern: string;
  risk: string;
  context: string;
}

function lintFiles(): Violation[] {
  const violations: Violation[] = [];
  
  const files = execSync('git ls-files -- "app/**/*.tsx" "components/**/*.tsx"', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f && !isAllowlisted(f));

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, idx) => {
      for (const { name, pattern, risk } of HIGH_RISK_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file,
            line: idx + 1,
            pattern: name,
            risk,
            context: line.trim().substring(0, 100),
          });
        }
      }
    });
  }
  
  return violations;
}

console.log('🔍 Linting for high-risk contrast patterns...\n');

const violations = lintFiles();

if (violations.length === 0) {
  console.log('✅ No high-risk patterns found!\n');
  process.exit(0);
} else {
  console.log(`⚠️  Found ${violations.length} high-risk pattern(s):\n`);
  
  // Group by file and show first 20 files
  const byFile = violations.reduce((acc, v) => {
    if (!acc[v.file]) acc[v.file] = [];
    acc[v.file].push(v);
    return acc;
  }, {} as Record<string, Violation[]>);
  
  let fileCount = 0;
  for (const [file, fileViolations] of Object.entries(byFile)) {
    if (fileCount++ >= 20) {
      console.log(`\n... and ${Object.keys(byFile).length - 20} more files\n`);
      break;
    }
    console.log(`\n📄 ${file} (${fileViolations.length} pattern(s)):`);
    fileViolations.slice(0, 3).forEach(v => {
      console.log(`   Line ${v.line}: ${v.pattern}`);
      console.log(`   Risk: ${v.risk}`);
      console.log(`   → ${v.context}...`);
    });
    if (fileViolations.length > 3) {
      console.log(`   ... and ${fileViolations.length - 3} more in this file`);
    }
  }
  
  console.log('\n💡 Recommended fixes:');
  console.log('   - Use semantic tokens: bg-card, text-foreground, text-muted-foreground');
  console.log('   - Add dark: variants when using raw palette colors');
  console.log('   - Review Workshop Tasks settings for any remaining issues\n');
  
  process.exit(1);
}
