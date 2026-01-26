/**
 * Fix Errors - Automated Error Analysis and Fixing
 * 
 * This script:
 * 1. Fetches recent errors from error_logs table
 * 2. Matches them against known patterns in error-fix-log.md
 * 3. Auto-applies fixes when a fixerId exists
 * 4. Creates new entries for unrecognized errors
 * 5. Prints a summary report
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

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

// Load error-fix-log.md and parse JSON data block
function loadFixLog(): FixLogData {
  if (!fs.existsSync(ERROR_FIX_LOG_PATH)) {
    return { version: '1.0.0', entries: [] };
  }

  const content = fs.readFileSync(ERROR_FIX_LOG_PATH, 'utf-8');
  // More flexible regex to handle different line endings
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
  
  // More flexible regex to handle different line endings
  const updated = content.replace(/```json[\r\n]+[\s\S]*?[\r\n]+```/, newJsonBlock);
  
  if (updated === content) {
    console.warn('⚠️  Warning: JSON block pattern not found, appending to file');
    // If no match, append the JSON block after the header
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

// Auto-fix functions registry
const fixers: Record<string, (error: ErrorLogEntry) => Promise<string>> = {
  // Example fixer - add more as patterns emerge
  fix_example: async (error: ErrorLogEntry) => {
    // Placeholder for actual fix logic
    return 'Example fix applied';
  },
};

// Apply a fix if a fixerId exists
async function applyFix(fixerId: string, error: ErrorLogEntry): Promise<string | null> {
  if (!fixers[fixerId]) {
    return `Fix function '${fixerId}' not found`;
  }

  try {
    const result = await fixers[fixerId](error);
    return result;
  } catch (err) {
    return `Fix failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Main analysis function
async function analyzeAndFixErrors() {
  console.log('🔧 FIXERRORS - Automated Error Analysis & Fixing');
  console.log('================================================\n');

  // 1. Fetch recent errors
  console.log('📥 Fetching recent errors from error_logs...');
  const { data: errors, error: fetchError } = await supabase
    .from('error_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100);

  if (fetchError) {
    console.error('❌ Failed to fetch errors:', fetchError.message);
    return;
  }

  if (!errors || errors.length === 0) {
    console.log('✅ No errors found - error log is clean!\n');
    return;
  }

  console.log(`Found ${errors.length} error(s)\n`);

  // 2. Load fix log
  const fixLog = loadFixLog();
  const seenSignatures = new Set<string>();
  const stats = {
    total: errors.length,
    matched: 0,
    new: 0,
    fixesApplied: 0,
    fixesFailed: 0,
  };

  // 3. Process each error
  for (const error of errors) {
    const signature = createSignature(error);
    seenSignatures.add(signature);

    const existingEntry = fixLog.entries.find(e => e.signature === signature);

    if (existingEntry) {
      // Update existing entry
      stats.matched++;
      existingEntry.lastSeen = error.timestamp;
      existingEntry.occurrences++;
      
      // If marked as stale, reactivate
      if (existingEntry.status === 'stale') {
        existingEntry.status = 'investigating';
        console.log(`♻️  Reactivated stale issue: ${signature.substring(0, 80)}...`);
      }

      // Apply fix if fixerId exists and not already resolved
      if (existingEntry.fixerId && existingEntry.status !== 'resolved') {
        console.log(`🔧 Applying fix '${existingEntry.fixerId}'...`);
        const result = await applyFix(existingEntry.fixerId, error);
        
        if (result && !result.includes('failed')) {
          stats.fixesApplied++;
          existingEntry.status = 'fix_applied';
          existingEntry.notes = (existingEntry.notes || '') + `\n[${new Date().toISOString()}] ${result}`;
          console.log(`   ✅ ${result}`);
        } else {
          stats.fixesFailed++;
          console.log(`   ❌ ${result}`);
        }
      }
    } else {
      // New error - create entry
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
      console.log(`🆕 New error detected: ${error.error_type} in ${error.component_name || 'unknown component'}`);
    }
  }

  // 4. Mark stale entries (not seen in this run)
  for (const entry of fixLog.entries) {
    if (!seenSignatures.has(entry.signature) && entry.status !== 'resolved' && entry.status !== 'stale') {
      entry.status = 'stale';
    }
  }

  // 5. Save updated log (before appending run summary)
  console.log('\n💾 Saving updated error fix log...');
  saveFixLog(fixLog);

  // 6. Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total Errors Analyzed:    ${stats.total}`);
  console.log(`Matched to Known Issues:  ${stats.matched}`);
  console.log(`New Issues Detected:      ${stats.new}`);
  console.log(`Fixes Applied:            ${stats.fixesApplied}`);
  console.log(`Fixes Failed:             ${stats.fixesFailed}`);
  console.log(`\nTotal Tracked Issues:     ${fixLog.entries.length}`);
  
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

  // 7. Append run summary to log file
  const summaryText = `
**Total Errors:** ${stats.total}  
**Matched:** ${stats.matched} | **New:** ${stats.new}  
**Fixes Applied:** ${stats.fixesApplied} | **Failed:** ${stats.fixesFailed}  
**Total Tracked:** ${fixLog.entries.length}
`;
  
  appendRunSummary(summaryText.trim());

  // 8. Show actionable items
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
