/**
 * Check which API routes have error logging implemented
 * Reports on progress and identifies routes that need updating
 */

import * as fs from 'fs';
import * as path from 'path';

const API_DIR = path.join(process.cwd(), 'app/api');

interface RouteStatus {
  file: string;
  relativePath: string;
  hasErrorLogging: boolean;
  hasCatchBlock: boolean;
  hasTryBlock: boolean;
}

function findAPIRoutesRecursive(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (file !== 'node_modules') {
        findAPIRoutesRecursive(filePath, fileList);
      }
    } else if (file.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

async function findAPIRoutes(): Promise<string[]> {
  return findAPIRoutesRecursive(API_DIR);
}

function analyzeRoute(content: string): {
  hasTryBlock: boolean;
  hasCatchBlock: boolean;
  hasErrorLogging: boolean;
} {
  const hasTryBlock = content.includes('try {') || content.includes('try{');
  const hasCatchBlock = /catch\s*\(/g.test(content);
  const hasErrorLogging = content.includes('logServerError') || content.includes('withErrorHandler');
  
  return {
    hasTryBlock,
    hasCatchBlock,
    hasErrorLogging,
  };
}

async function checkRoute(filePath: string): Promise<RouteStatus> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const analysis = analyzeRoute(content);
  const relativePath = filePath.replace(API_DIR, '').replace(/\\/g, '/');
  
  return {
    file: filePath,
    relativePath,
    hasErrorLogging: analysis.hasErrorLogging,
    hasCatchBlock: analysis.hasCatchBlock,
    hasTryBlock: analysis.hasTryBlock,
  };
}

async function main() {
  console.log('🔍 Checking API Routes for Error Logging\n');
  console.log('=' .repeat(60) + '\n');
  
  const apiFiles = await findAPIRoutes();
  const statuses: RouteStatus[] = [];
  
  for (const file of apiFiles) {
    const status = await checkRoute(file);
    statuses.push(status);
  }
  
  // Categorize routes
  const withLogging = statuses.filter(s => s.hasErrorLogging);
  const withCatchNoLogging = statuses.filter(s => s.hasCatchBlock && !s.hasErrorLogging);
  const noCatchBlock = statuses.filter(s => !s.hasCatchBlock && !s.hasErrorLogging);
  
  // Summary
  console.log('📊 Summary\n');
  console.log(`Total API Routes: ${statuses.length}`);
  console.log(`✅ With Error Logging: ${withLogging.length} (${Math.round(withLogging.length / statuses.length * 100)}%)`);
  console.log(`🔨 Need Error Logging: ${withCatchNoLogging.length} (${Math.round(withCatchNoLogging.length / statuses.length * 100)}%)`);
  console.log(`⚠️  No Error Handling: ${noCatchBlock.length} (${Math.round(noCatchBlock.length / statuses.length * 100)}%)\n`);
  console.log('=' .repeat(60) + '\n');
  
  // Routes with logging
  if (withLogging.length > 0) {
    console.log('✅ Routes WITH Error Logging:\n');
    withLogging.forEach(s => {
      console.log(`   ${s.relativePath}`);
    });
    console.log();
  }
  
  // Routes needing logging
  if (withCatchNoLogging.length > 0) {
    console.log('🔨 Routes NEEDING Error Logging (have catch blocks):\n');
    withCatchNoLogging.forEach(s => {
      console.log(`   ${s.relativePath}`);
    });
    console.log('\n💡 Add this to each catch block:');
    console.log(`
    await logServerError({
      error: error as Error,
      request,
      componentName: '<route-name>',
    });
    `);
    console.log();
  }
  
  // Routes without error handling
  if (noCatchBlock.length > 0) {
    console.log('⚠️  Routes WITHOUT Error Handling:\n');
    noCatchBlock.forEach(s => {
      console.log(`   ${s.relativePath}`);
    });
    console.log('\n💡 Consider wrapping with try-catch or using withErrorHandler()');
    console.log();
  }
  
  // Progress bar
  const progress = Math.round(withLogging.length / statuses.length * 100);
  const barLength = 50;
  const filled = Math.round(barLength * progress / 100);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  console.log('=' .repeat(60));
  console.log(`\nProgress: [${bar}] ${progress}%\n`);
  
  // Exit code
  if (withCatchNoLogging.length > 0) {
    console.log('⚠️  Warning: Some routes need error logging\n');
    process.exit(1);
  } else {
    console.log('✨ All routes have proper error logging!\n');
    process.exit(0);
  }
}

main().catch(console.error);
