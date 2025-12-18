/**
 * Fix remaining light theme class issues across the codebase
 * Replaces problematic dark: variant patterns with explicit dark colors
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { globSync } from 'glob';

// Patterns to fix (find → replace)
const patterns = [
  // Hover states
  { find: /hover:bg-slate-50 dark:hover:bg-slate-800\/50/g, replace: 'hover:bg-slate-800/50', desc: 'hover:bg-slate-50 dark:' },
  { find: /hover:bg-slate-50 dark:hover:bg-slate-800/g, replace: 'hover:bg-slate-800/50', desc: 'hover:bg-slate-50 dark:' },
  { find: /hover:bg-slate-100 dark:hover:bg-slate-800\/50/g, replace: 'hover:bg-slate-800/50', desc: 'hover:bg-slate-100 dark:' },
  { find: /hover:bg-slate-100 dark:hover:bg-slate-800/g, replace: 'hover:bg-slate-800', desc: 'hover:bg-slate-100 dark:' },
  { find: /hover:bg-slate-100 dark:hover:bg-slate-700/g, replace: 'hover:bg-slate-700/50', desc: 'hover:bg-slate-100 dark:' },
  
  // Backgrounds
  { find: /bg-white dark:bg-slate-900/g, replace: 'bg-slate-900', desc: 'bg-white dark:bg-slate-900' },
  { find: /bg-white dark:bg-slate-800/g, replace: 'bg-slate-800', desc: 'bg-white dark:bg-slate-800' },
  
  // Borders
  { find: /border-slate-200 dark:border-slate-700/g, replace: 'border-slate-700', desc: 'border-slate-200 dark:' },
  { find: /border-slate-300 dark:border-slate-600/g, replace: 'border-slate-600', desc: 'border-slate-300 dark:' },
  
  // Text colors
  { find: /text-slate-900 dark:text-white/g, replace: 'text-white', desc: 'text-slate-900 dark:text-white' },
  { find: /text-slate-800 dark:text-white/g, replace: 'text-white', desc: 'text-slate-800 dark:text-white' },
  { find: /text-slate-700 dark:text-slate-300/g, replace: 'text-slate-300', desc: 'text-slate-700 dark:' },
  { find: /text-slate-600 dark:text-slate-400/g, replace: 'text-slate-400', desc: 'text-slate-600 dark:' },
];

function fixFile(filePath: string): { modified: boolean; changesCount: number } {
  let content = readFileSync(filePath, 'utf-8');
  const originalContent = content;
  let changesCount = 0;

  for (const pattern of patterns) {
    const matches = content.match(pattern.find);
    if (matches) {
      changesCount += matches.length;
      content = content.replace(pattern.find, pattern.replace);
    }
  }

  if (content !== originalContent) {
    writeFileSync(filePath, content, 'utf-8');
    return { modified: true, changesCount };
  }

  return { modified: false, changesCount: 0 };
}

async function main() {
  console.log('🔍 Scanning for light theme issues...\n');

  // Find all TSX files
  const files = globSync('**/*.tsx', {
    cwd: process.cwd(),
    ignore: ['node_modules/**', '.next/**', 'dist/**', 'build/**'],
    absolute: true
  });

  console.log(`Found ${files.length} TSX files to check\n`);

  let filesModified = 0;
  let totalChanges = 0;
  const modifiedFiles: string[] = [];

  for (const file of files) {
    const relativePath = file.replace(process.cwd() + '/', '');
    const result = fixFile(file);

    if (result.modified) {
      filesModified++;
      totalChanges += result.changesCount;
      modifiedFiles.push(relativePath);
      console.log(`✅ ${relativePath} (${result.changesCount} changes)`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✨ FIX COMPLETED!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Files modified: ${filesModified}`);
  console.log(`📝 Total changes: ${totalChanges}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (filesModified === 0) {
    console.log('✅ No issues found! All files are already using dark-only classes.\n');
  } else {
    console.log('Modified files:');
    modifiedFiles.forEach(f => console.log(`  - ${f}`));
    console.log('');
  }
}

main();
