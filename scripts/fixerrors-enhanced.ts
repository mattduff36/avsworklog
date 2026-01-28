/**
 * Fix Errors - Enhanced Automated Error Analysis and Fixing
 * 
 * This script:
 * 1. Fetches recent errors from error_logs table (runtime errors)
 * 2. Runs ESLint to get code quality errors
 * 3. Matches them against known patterns in error-fix-log.md
 * 4. Auto-applies fixes when possible
 * 5. Creates new entries for unrecognized errors
 * 6. Prints a summary report
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const ERROR_FIX_LOG_PATH = resolve(process.cwd(), 'docs_private', 'error-fix-log.md');

type ErrorLogEntry = {
  id: string;
  timestamp: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: Record<string, unknown> | null;
};

type ESLintError = {
  filePath: string;
  messages: Array<{
    ruleId: string;
    severity: number;
    message: string;
    line: number;
    column: number;
    nodeType?: string;
    fix?: {
      range: [number, number];
      text: string;
    };
  }>;
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
};

type FixLogEntry = {
  signature: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  status: 'untriaged' | 'investigating' | 'fix_applied' | 'resolved' | 'wontfix' | 'stale';
  fixerId?: string;
  plan?: string;
  notes?: string;
};

type FixLogData = {
  version: string;
  entries: FixLogEntry[];
};

// Normalize error into a signature for matching
function createSignature(error: ErrorLogEntry): string {
  const type = error.error_type || 'Unknown';
  const message = (error.error_message || '').trim().substring(0, 200);
  const component = error.component_name || 'NoComponent';
  const page = error.page_url ? new URL(error.page_url).pathname : 'NoPage';
  
  return `${type}::${component}::${page}::${message}`;
}

// Create signature for ESLint errors
function createESLintSignature(filePath: string, ruleId: string, message: string): string {
  const shortPath = filePath.replace(process.cwd(), '').replace(/\\/g, '/');
  return `ESLint::${ruleId}::${shortPath}::${message.substring(0, 100)}`;
}

// Load error-fix-log.md and parse JSON data block
function loadFixLog(): FixLogData {
  if (!fs.existsSync(ERROR_FIX_LOG_PATH)) {
    return { version: '1.0.0', entries: [] };
  }

  const content = fs.readFileSync(ERROR_FIX_LOG_PATH, 'utf-8');
  const jsonMatch = content.match(/```json[\r\n]+([\s\S]*?)[\r\n]+```/);
  
  if (!jsonMatch) {
    console.warn('⚠️  No JSON block found in error-fix-log.md, starting fresh');
    return { version: '1.0.0', entries: [] };
  }

  try {
    return JSON.parse(jsonMatch[1]);
  } catch (err) {
    console.error('❌ Failed to parse JSON from error-fix-log.md:', err);
    return { version: '1.0.0', entries: [] };
  }
}

// Save updated fix log data back to file
function saveFixLog(data: FixLogData) {
  const content = fs.readFileSync(ERROR_FIX_LOG_PATH, 'utf-8');
  const newJsonBlock = `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  
  const updated = content.replace(/```json[\r\n]+[\s\S]*?[\r\n]+```/, newJsonBlock);
  
  if (updated === content) {
    console.warn('⚠️  Warning: JSON block pattern not found, appending to file');
    const lines = content.split('\n');
    const insertIndex = lines.findIndex(line => line.includes('## Machine-Readable Data')) + 2;
    lines.splice(insertIndex, 0, newJsonBlock);
    fs.writeFileSync(ERROR_FIX_LOG_PATH, lines.join('\n'), 'utf-8');
  } else {
    fs.writeFileSync(ERROR_FIX_LOG_PATH, updated, 'utf-8');
  }
}

// Append run summary to the file
function appendRunSummary(summary: string) {
  const timestamp = new Date().toISOString();
  const entry = `\n### Run: ${timestamp}\n\n${summary}\n`;
  fs.appendFileSync(ERROR_FIX_LOG_PATH, entry, 'utf-8');
}

// Get ESLint errors
async function getESLintErrors(): Promise<ESLintError[]> {
  try {
    console.log('🔍 Running ESLint...');
    const output = execSync('npx eslint . --format=json 2>&1', {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    
    // Try to parse the output
    try {
      return JSON.parse(output);
    } catch {
      // If parsing fails, try to extract JSON from the output
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      console.warn('⚠️  Could not parse ESLint output, skipping ESLint analysis');
      return [];
    }
  } catch (err: any) {
    // ESLint exits with code 1 when errors are found
    const output = err.stdout || err.output?.[1]?.toString() || '';
    
    if (output) {
      try {
        return JSON.parse(output);
      } catch {
        // Try to extract JSON from error output
        const jsonMatch = output.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]);
          } catch {
            console.warn('⚠️  Could not parse ESLint output, skipping ESLint analysis');
          }
        }
      }
    }
    return [];
  }
}

// Auto-fix ESLint errors that are fixable
async function fixESLintErrors(): Promise<{ fixed: number; failed: number }> {
  try {
    console.log('🔧 Attempting to auto-fix ESLint errors...');
    execSync('npx eslint . --fix', {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    return { fixed: 0, failed: 0 }; // Success, but count unknown
  } catch (err: any) {
    // Even if it fails, some might be fixed
    return { fixed: 0, failed: 0 };
  }
}

// Main analysis function
async function analyzeAndFixErrors() {
  console.log('🔧 FIXERRORS - Enhanced Automated Error Analysis & Fixing');
  console.log('===========================================================\n');

  const stats = {
    runtimeErrors: 0,
    eslintErrors: 0,
    matched: 0,
    new: 0,
    fixesApplied: 0,
    fixesFailed: 0,
  };

  // Load fix log
  const fixLog = loadFixLog();
  const seenSignatures = new Set<string>();

  // ============================================================
  // PART 1: Runtime Errors from Database
  // ============================================================
  console.log('📥 Fetching recent runtime errors from error_logs...');
  const { data: errors, error: fetchError } = await supabase
    .from('error_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(50);

  if (fetchError) {
    console.error('❌ Failed to fetch errors:', fetchError.message);
  } else if (errors && errors.length > 0) {
    stats.runtimeErrors = errors.length;
    console.log(`Found ${errors.length} runtime error(s)\n`);

    // Process each runtime error
    for (const error of errors) {
      const signature = createSignature(error);
      seenSignatures.add(signature);

      const existingEntry = fixLog.entries.find(e => e.signature === signature);

      if (existingEntry) {
        stats.matched++;
        existingEntry.lastSeen = error.timestamp;
        existingEntry.occurrences++;
        
        if (existingEntry.status === 'stale') {
          existingEntry.status = 'investigating';
          console.log(`♻️  Reactivated stale issue: ${signature.substring(0, 80)}...`);
        }
      } else {
        stats.new++;
        const newEntry: FixLogEntry = {
          signature,
          firstSeen: error.timestamp,
          lastSeen: error.timestamp,
          occurrences: 1,
          status: 'untriaged',
          plan: 'Manual investigation needed',
          notes: `Error Type: ${error.error_type}\nComponent: ${error.component_name || 'N/A'}\nPage: ${error.page_url}`,
        };
        
        fixLog.entries.push(newEntry);
        console.log(`🆕 New runtime error: ${error.error_type} in ${error.component_name || 'unknown component'}`);
      }
    }
  } else {
    console.log('✅ No runtime errors found - error log is clean!\n');
  }

  // ============================================================
  // PART 2: ESLint Errors
  // ============================================================
  const eslintResults = await getESLintErrors();
  const eslintErrorsWithIssues = eslintResults.filter(r => r.errorCount > 0);
  
  if (eslintErrorsWithIssues.length > 0) {
    console.log(`\n📋 Found ${eslintErrorsWithIssues.length} file(s) with ESLint errors`);
    
    // Count total errors
    let totalESLintErrors = 0;
    let fixableCount = 0;
    
    for (const result of eslintErrorsWithIssues) {
      totalESLintErrors += result.errorCount;
      fixableCount += result.fixableErrorCount;
      
      // Process only errors (not warnings)
      const errorMessages = result.messages.filter(m => m.severity === 2);
      
      for (const msg of errorMessages) {
        const signature = createESLintSignature(result.filePath, msg.ruleId || 'unknown', msg.message);
        seenSignatures.add(signature);
        
        const existingEntry = fixLog.entries.find(e => e.signature === signature);
        
        if (existingEntry) {
          stats.matched++;
          existingEntry.lastSeen = new Date().toISOString();
          existingEntry.occurrences++;
        } else {
          stats.new++;
          const newEntry: FixLogEntry = {
            signature,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            occurrences: 1,
            status: 'untriaged',
            plan: msg.fix ? 'Auto-fixable by ESLint --fix' : 'Manual fix required',
            notes: `Rule: ${msg.ruleId}\nFile: ${result.filePath}:${msg.line}:${msg.column}\nMessage: ${msg.message}`,
          };
          
          fixLog.entries.push(newEntry);
        }
      }
    }
    
    stats.eslintErrors = totalESLintErrors;
    console.log(`   Total ESLint errors: ${totalESLintErrors}`);
    console.log(`   Auto-fixable: ${fixableCount}`);
    
    // Auto-fix if there are fixable errors
    if (fixableCount > 0) {
      const { fixed, failed } = await fixESLintErrors();
      console.log(`   ✅ Attempted auto-fix (run ESLint again to see results)\n`);
    }
  } else {
    console.log('\n✅ No ESLint errors found - code is clean!\n');
  }

  // ============================================================
  // PART 3: Mark stale entries
  // ============================================================
  for (const entry of fixLog.entries) {
    if (!seenSignatures.has(entry.signature) && entry.status !== 'resolved' && entry.status !== 'stale') {
      entry.status = 'stale';
    }
  }

  // ============================================================
  // PART 4: Save and summarize
  // ============================================================
  console.log('\n💾 Saving updated error fix log...');
  saveFixLog(fixLog);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Runtime Errors Found:      ${stats.runtimeErrors}`);
  console.log(`ESLint Errors Found:       ${stats.eslintErrors}`);
  console.log(`Matched to Known Issues:   ${stats.matched}`);
  console.log(`New Issues Detected:       ${stats.new}`);
  console.log(`\nTotal Tracked Issues:      ${fixLog.entries.length}`);
  
  // Breakdown by status
  const statusCounts = fixLog.entries.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('\nIssue Status Breakdown:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status.padEnd(15)} ${count}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════\n');

  // Append run summary
  const summaryText = `
**Runtime Errors:** ${stats.runtimeErrors} | **ESLint Errors:** ${stats.eslintErrors}  
**Matched:** ${stats.matched} | **New:** ${stats.new}  
**Total Tracked:** ${fixLog.entries.length}
`;
  
  appendRunSummary(summaryText.trim());

  // Show actionable items
  const untriagedCount = fixLog.entries.filter(e => e.status === 'untriaged').length;
  const investigatingCount = fixLog.entries.filter(e => e.status === 'investigating').length;
  
  if (untriagedCount > 0 || investigatingCount > 0) {
    console.log('⚠️  ACTIONABLE ITEMS:');
    if (untriagedCount > 0) {
      console.log(`   - ${untriagedCount} untriaged issue(s) need investigation`);
    }
    if (investigatingCount > 0) {
      console.log(`   - ${investigatingCount} issue(s) currently under investigation`);
    }
    console.log(`   - Review docs_private/error-fix-log.md for details\n`);
  } else {
    console.log('✅ All known issues are resolved or have fixes applied!\n');
  }
}

// Run the analysis
analyzeAndFixErrors()
  .then(() => {
    console.log('✅ Fixerrors complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
