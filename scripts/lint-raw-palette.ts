/**
 * Lint Script: Ban Raw Palette Utilities
 * Prevents usage of raw palette utilities in feature code
 */

import * as fs from 'fs';
import { execSync } from 'child_process';

// Disallowed patterns (raw palette utilities)
const DISALLOWED_PATTERNS = [
  'bg-white',
  'bg-slate-50',
  'bg-slate-100',
  'bg-slate-200',
  'bg-slate-300',
  'bg-slate-700',
  'bg-slate-800',
  'bg-slate-900',
  'text-slate-900',
  'text-slate-800',
  'text-slate-700',
  'text-slate-600',
  'text-slate-500',
  'text-slate-400',
  'text-slate-300',
  'text-gray-900',
  'text-gray-800',
  'text-gray-700',
  'text-gray-600',
  'border-slate-200',
  'border-slate-300',
  'border-slate-600',
  'border-slate-700',
];

// Files allowed to use raw palette (base UI primitives only)
const ALLOWLIST = [
  'components/ui/input.tsx',
  'components/ui/textarea.tsx',
  'components/ui/select.tsx',
  'components/ui/button.tsx',
  'components/ui/card.tsx',
  'components/ui/dialog.tsx',
  'components/ui/tabs.tsx',
  'components/ui/badge.tsx',
  'components/ui/label.tsx',
  'app/globals.css',
  'scripts/', // Allow in scripts
  'tests/', // Allow in tests
  'docs/', // Allow in documentation
];

function isAllowlisted(filePath: string): boolean {
  return ALLOWLIST.some(allowed => filePath.includes(allowed));
}

interface Violation {
  file: string;
  line: number;
  pattern: string;
  context: string;
}

function lintFiles(): Violation[] {
  const violations: Violation[] = [];
  
  // Get all TSX/TS files
  const files = execSync('git ls-files -- "*.tsx" "*.ts"', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f && !isAllowlisted(f));

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, idx) => {
      for (const pattern of DISALLOWED_PATTERNS) {
        // Skip if pattern is part of dark: variant (e.g., "dark:bg-slate-900")
        if (line.includes(`dark:${pattern}`)) continue;
        
        // Check if pattern appears as standalone class
        const regex = new RegExp(`\\b${pattern}\\b`);
        if (regex.test(line) && line.includes('className')) {
          violations.push({
            file,
            line: idx + 1,
            pattern,
            context: line.trim().substring(0, 80),
          });
        }
      }
    });
  }
  
  return violations;
}

console.log('🔍 Linting for raw palette utilities...\n');

const violations = lintFiles();

if (violations.length === 0) {
  console.log('✅ No violations found! All files use semantic tokens.\n');
  process.exit(0);
} else {
  console.log(`❌ Found ${violations.length} violation(s):\n`);
  
  // Group by file
  const byFile = violations.reduce((acc, v) => {
    if (!acc[v.file]) acc[v.file] = [];
    acc[v.file].push(v);
    return acc;
  }, {} as Record<string, Violation[]>);
  
  for (const [file, fileViolations] of Object.entries(byFile)) {
    console.log(`\n📄 ${file} (${fileViolations.length} violation(s)):`);
    fileViolations.forEach(v => {
      console.log(`   Line ${v.line}: ${v.pattern}`);
      console.log(`   → ${v.context}...`);
    });
  }
  
  console.log('\n\n💡 Fix: Replace raw palette utilities with semantic tokens:');
  console.log('   bg-white → bg-card');
  console.log('   text-slate-900 → text-foreground');
  console.log('   text-slate-600 → text-muted-foreground');
  console.log('   border-slate-200 → border-border');
  console.log('   (etc.)\n');
  
  process.exit(1);
}
