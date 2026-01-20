#!/usr/bin/env tsx
/**
 * Static audit script for input/textarea/select contrast issues
 * Scans TSX files for form components with risky class combinations
 */

import * as fs from 'fs';
import * as path from 'path';

interface ContrastIssue {
  file: string;
  line: number;
  component: string;
  issue: string;
  className: string;
  severity: 'high' | 'medium' | 'low';
}

interface AuditReport {
  timestamp: string;
  totalFiles: number;
  issuesFound: number;
  issues: ContrastIssue[];
}

const COMPONENTS_TO_CHECK = ['Input', 'Textarea', 'SelectTrigger', 'SelectContent', 'SelectItem', 'SelectLabel', 'DialogContent'];

// Patterns that indicate dark backgrounds
const DARK_BG_PATTERNS = [
  /dark:bg-slate-[89]\d{2}/,
  /dark:bg-slate-900/,
  /dark:bg-slate-800/,
  /dark:bg-slate-700/,
  /bg-slate-900/,
  /bg-slate-800/,
  /dark:bg-gray-[89]\d{2}/,
];

// Patterns that indicate explicit text color
const TEXT_COLOR_PATTERNS = [
  /dark:text-/,
  /text-slate-[0-9]/,
  /text-white/,
  /text-gray-[0-9]/,
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

function extractClassName(jsxAttribute: string): string | null {
  // Match className="..." or className={'...'}
  const match = jsxAttribute.match(/className\s*=\s*(?:"([^"]*)"|{["']([^"']*)["']}|{`([^`]*)`})/);
  if (match) {
    return match[1] || match[2] || match[3] || null;
  }
  return null;
}

function scanFile(filePath: string): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Check for component usage
    for (const component of COMPONENTS_TO_CHECK) {
      const componentRegex = new RegExp(`<${component}[^>]*>`, 'g');
      const matches = line.match(componentRegex);

      if (matches) {
        for (const match of matches) {
          const className = extractClassName(match);
          
          if (className) {
            // Skip if has ui-component class (opted out of global rules)
            if (hasUiComponentClass(className)) {
              continue;
            }

            // Check for dark background without explicit text color
            if (hasDarkBackground(className) && !hasExplicitTextColor(className)) {
              issues.push({
                file: filePath,
                line: lineNumber,
                component,
                issue: 'Dark background without explicit text color',
                className,
                severity: 'high',
              });
            }

            // Check for potential inheritance issues
            if (!hasExplicitTextColor(className) && !className.includes('bg-')) {
              // Might inherit from parent - medium severity
              issues.push({
                file: filePath,
                line: lineNumber,
                component,
                issue: 'No explicit text color (may inherit problematic color)',
                className,
                severity: 'medium',
              });
            }
          }
        }
      }
    }
  }

  return issues;
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

function generateReport(issues: ContrastIssue[], totalFiles: number): AuditReport {
  return {
    timestamp: new Date().toISOString(),
    totalFiles,
    issuesFound: issues.length,
    issues: issues.sort((a, b) => {
      // Sort by severity first, then by file
      const severityOrder = { high: 0, medium: 1, low: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return a.file.localeCompare(b.file);
    }),
  };
}

function printReport(report: AuditReport) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('              UI CONTRAST AUDIT REPORT');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Files scanned: ${report.totalFiles}`);
  console.log(`Issues found: ${report.issuesFound}\n`);

  if (report.issuesFound === 0) {
    console.log('✅ No contrast issues found!\n');
    return;
  }

  const highSeverity = report.issues.filter(i => i.severity === 'high');
  const mediumSeverity = report.issues.filter(i => i.severity === 'medium');
  const lowSeverity = report.issues.filter(i => i.severity === 'low');

  if (highSeverity.length > 0) {
    console.log(`\n🔴 HIGH SEVERITY (${highSeverity.length}):`);
    console.log('───────────────────────────────────────────────────────────\n');
    highSeverity.forEach(issue => {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Component: <${issue.component}>`);
      console.log(`  Issue: ${issue.issue}`);
      console.log(`  ClassName: ${issue.className}`);
      console.log('');
    });
  }

  if (mediumSeverity.length > 0) {
    console.log(`\n🟡 MEDIUM SEVERITY (${mediumSeverity.length}):`);
    console.log('───────────────────────────────────────────────────────────\n');
    mediumSeverity.forEach(issue => {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Component: <${issue.component}>`);
      console.log(`  Issue: ${issue.issue}`);
      console.log(`  ClassName: ${issue.className}`);
      console.log('');
    });
  }

  if (lowSeverity.length > 0) {
    console.log(`\n🟢 LOW SEVERITY (${lowSeverity.length}):`);
    console.log('───────────────────────────────────────────────────────────\n');
    lowSeverity.forEach(issue => {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Component: <${issue.component}>`);
      console.log(`  Issue: ${issue.issue}`);
      console.log(`  ClassName: ${issue.className}`);
      console.log('');
    });
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  
  console.log('🔍 Scanning codebase for contrast issues...\n');

  const rootDir = process.cwd();
  const files = scanDirectory(rootDir);
  
  console.log(`Found ${files.length} TSX files to analyze\n`);

  let allIssues: ContrastIssue[] = [];
  
  for (const file of files) {
    const issues = scanFile(file);
    allIssues = allIssues.concat(issues);
  }

  const report = generateReport(allIssues, files.length);
  
  // Save report to file
  const reportsDir = path.join(rootDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  const reportPath = path.join(reportsDir, 'ui-contrast-audit.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to: ${reportPath}\n`);

  printReport(report);

  if (fix) {
    console.log('🔧 Fix mode enabled - this will be implemented in the next step\n');
    process.exit(0);
  }

  // Exit with error code if high severity issues found
  if (report.issues.some(i => i.severity === 'high')) {
    process.exit(1);
  }
}

main();
