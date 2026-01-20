#!/usr/bin/env tsx
/**
 * Auto-fix script for input/textarea/select contrast issues
 * Uses ts-morph for safe AST-based transformations
 */

import { Project, SyntaxKind } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

interface FixReport {
  file: string;
  line: number;
  component: string;
  originalClass: string;
  fixedClass: string;
}

const COMPONENTS_TO_FIX = ['Input', 'Textarea', 'SelectTrigger', 'SelectContent', 'SelectItem', 'SelectLabel'];

// Patterns that indicate dark backgrounds
const DARK_BG_PATTERNS = [
  /dark:bg-slate-[89]\d{2}/,
  /dark:bg-slate-900/,
  /dark:bg-slate-800/,
  /dark:bg-slate-700/,
  /bg-slate-900/,
  /bg-slate-800/,
];

// Patterns that indicate explicit text color
const TEXT_COLOR_PATTERNS = [
  /dark:text-/,
  /text-slate-[0-9]/,
  /text-white/,
];

function hasUiComponentClass(className: string): boolean {
  return /\bui-component\b/.test(className);
}

function hasDarkBackground(className: string): boolean {
  return DARK_BG_PATTERNS.some(pattern => pattern.test(className));
}

function hasExplicitTextColor(className: string): boolean {
  return TEXT_COLOR_PATTERNS.some(pattern => pattern.test(className));
}

function hasLightTextColor(className: string): boolean {
  return /text-slate-9\d{2}/.test(className) || /text-gray-9\d{2}/.test(className);
}

function fixClassName(className: string): string | null {
  // Don't fix if already has ui-component (uses base component defaults)
  if (hasUiComponentClass(className)) {
    return null;
  }

  let needsFix = false;
  let fixed = className;

  // Check if has dark background but no dark text color
  if (hasDarkBackground(className) && !hasExplicitTextColor(className)) {
    // Remove any conflicting light text colors first
    fixed = fixed.replace(/text-slate-900\s*/g, '').replace(/text-gray-900\s*/g, '');
    // Append dark mode text color
    fixed = `${fixed} dark:text-slate-100`.trim();
    needsFix = true;
  }

  // Ensure light mode text color exists
  if (!hasLightTextColor(fixed) && !fixed.includes('text-slate-9') && !fixed.includes('text-white')) {
    fixed = `${fixed} text-slate-900`.trim();
    needsFix = true;
  }

  // Clean up multiple spaces
  fixed = fixed.replace(/\s+/g, ' ').trim();

  return needsFix ? fixed : null;
}

function fixFile(filePath: string): FixReport[] {
  const fixes: FixReport[] = [];
  
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  });
  
  const sourceFile = project.addSourceFileAtPath(filePath);
  let modified = false;

  // Find all JSX elements
  const jsxElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
  
  for (const element of jsxElements) {
    const tagName = element.getTagNameNode().getText();
    
    if (!COMPONENTS_TO_FIX.includes(tagName)) {
      continue;
    }

    // Find className attribute
    const classNameAttr = element.getAttribute('className');
    
    if (!classNameAttr || !classNameAttr.isKind(SyntaxKind.JsxAttribute)) {
      continue;
    }

    const initializer = classNameAttr.getInitializer();
    if (!initializer) {
      continue;
    }

    // Only handle string literal classNames for safety
    if (initializer.isKind(SyntaxKind.StringLiteral)) {
      const originalClass = initializer.getLiteralText();
      const fixedClass = fixClassName(originalClass);

      if (fixedClass) {
        initializer.setLiteralValue(fixedClass);
        modified = true;
        
        fixes.push({
          file: filePath,
          line: element.getStartLineNumber(),
          component: tagName,
          originalClass,
          fixedClass,
        });
      }
    }
  }

  // Also check JSX opening elements (for non-self-closing tags)
  const jsxOpenElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
  
  for (const element of jsxOpenElements) {
    const tagName = element.getTagNameNode().getText();
    
    if (!COMPONENTS_TO_FIX.includes(tagName)) {
      continue;
    }

    const classNameAttr = element.getAttribute('className');
    
    if (!classNameAttr || !classNameAttr.isKind(SyntaxKind.JsxAttribute)) {
      continue;
    }

    const initializer = classNameAttr.getInitializer();
    if (!initializer) {
      continue;
    }

    if (initializer.isKind(SyntaxKind.StringLiteral)) {
      const originalClass = initializer.getLiteralText();
      const fixedClass = fixClassName(originalClass);

      if (fixedClass) {
        initializer.setLiteralValue(fixedClass);
        modified = true;
        
        fixes.push({
          file: filePath,
          line: element.getStartLineNumber(),
          component: tagName,
          originalClass,
          fixedClass,
        });
      }
    }
  }

  if (modified) {
    sourceFile.saveSync();
  }

  return fixes;
}

function scanDirectory(dir: string, extensions: string[] = ['.tsx']): string[] {
  let files: string[] = [];
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    // Skip node_modules, .next, etc.
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    
    if (entry.isDirectory()) {
      files = files.concat(scanDirectory(fullPath, extensions));
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function main() {
  console.log('🔧 Auto-fixing contrast issues...\n');

  const rootDir = process.cwd();
  const files = scanDirectory(rootDir);
  
  console.log(`Found ${files.length} TSX files to process\n`);

  let allFixes: FixReport[] = [];
  
  for (const file of files) {
    try {
      const fixes = fixFile(file);
      if (fixes.length > 0) {
        allFixes = allFixes.concat(fixes);
        console.log(`✅ Fixed ${fixes.length} issue(s) in ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`                 FIX SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
  console.log(`Total fixes applied: ${allFixes.length}\n`);

  if (allFixes.length > 0) {
    console.log('Detailed changes:\n');
    allFixes.forEach(fix => {
      console.log(`  File: ${fix.file}:${fix.line}`);
      console.log(`  Component: <${fix.component}>`);
      console.log(`  Before: ${fix.originalClass}`);
      console.log(`  After:  ${fix.fixedClass}`);
      console.log('');
    });
  }

  // Save fix report
  const reportsDir = path.join(rootDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  const reportPath = path.join(reportsDir, 'ui-contrast-fixes.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    fixesApplied: allFixes.length,
    fixes: allFixes,
  }, null, 2));
  
  console.log(`📄 Fix report saved to: ${reportPath}\n`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
}

main();
