/**
 * Script to automatically add server-side error logging to all API routes
 * This ensures all API errors are captured in the error_logs table
 */

import * as fs from 'fs';
import * as path from 'path';

const API_DIR = path.join(process.cwd(), 'app/api');

interface FileUpdate {
  file: string;
  needsImport: boolean;
  needsLogging: boolean;
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

function analyzeFile(content: string): { needsImport: boolean; needsLogging: boolean } {
  const hasImport = content.includes('logServerError');
  const hasCatchWithoutLogging = /catch\s*\([^)]*\)\s*\{[^}]*console\.error[^}]*\}/s.test(content) &&
                                  !content.includes('logServerError');
  
  return {
    needsImport: !hasImport && hasCatchWithoutLogging,
    needsLogging: hasCatchWithoutLogging,
  };
}

function addImport(content: string): string {
  // Find the last import statement
  const importRegex = /import\s+.*?from\s+['"][^'"]+['"]\s*;/g;
  const imports = content.match(importRegex);
  
  if (!imports || imports.length === 0) {
    // No imports found, add at the top
    return `import { logServerError } from '@/lib/utils/server-error-logger';\n\n${content}`;
  }
  
  // Check if we already have a similar import
  const lastImport = imports[imports.length - 1];
  const lastImportIndex = content.lastIndexOf(lastImport);
  const insertPosition = lastImportIndex + lastImport.length;
  
  const newImport = "\nimport { logServerError } from '@/lib/utils/server-error-logger';";
  
  return (
    content.slice(0, insertPosition) +
    newImport +
    content.slice(insertPosition)
  );
}

function addErrorLogging(content: string, filePath: string): string {
  // Find catch blocks that have console.error but no logServerError
  const catchRegex = /catch\s*\(([^)]*)\)\s*\{([^}]*console\.error[^}]*)\}/gs;
  
  let result = content;
  const matches = Array.from(content.matchAll(catchRegex));
  
  for (const match of matches) {
    const fullMatch = match[0];
    const errorParam = match[1].trim() || 'error';
    const catchBody = match[2];
    
    // Skip if already has logServerError
    if (catchBody.includes('logServerError')) {
      continue;
    }
    
    // Find the return statement or closing brace
    const lines = catchBody.split('\n');
    let insertIndex = -1;
    
    // Find where to insert (after console.error, before return)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('console.error')) {
        insertIndex = i + 1;
        break;
      }
    }
    
    if (insertIndex === -1) continue;
    
    // Extract endpoint name from file path
    const relativePath = filePath.replace(API_DIR, '').replace(/\\/g, '/');
    const endpointName = relativePath.replace('/route.ts', '').replace(/\[([^\]]+)\]/g, ':$1');
    
    // Add logging code
    const indent = '    '; // 4 spaces
    const loggingCode = `
${indent}
${indent}// Log error to database
${indent}await logServerError({
${indent}  error: ${errorParam} as Error,
${indent}  request,
${indent}  componentName: '${endpointName}',
${indent}  additionalData: {
${indent}    endpoint: '${endpointName}',
${indent}  },
${indent});`;
    
    // Insert the logging code
    lines.splice(insertIndex, 0, loggingCode);
    
    const newCatchBody = lines.join('\n');
    const newCatch = `catch (${errorParam}) {${newCatchBody}}`;
    
    result = result.replace(fullMatch, newCatch);
  }
  
  return result;
}

async function updateFile(filePath: string): Promise<FileUpdate> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const analysis = analyzeFile(content);
  
  if (!analysis.needsImport && !analysis.needsLogging) {
    return { file: filePath, needsImport: false, needsLogging: false };
  }
  
  let updatedContent = content;
  
  if (analysis.needsImport) {
    updatedContent = addImport(updatedContent);
  }
  
  if (analysis.needsLogging) {
    updatedContent = addErrorLogging(updatedContent, filePath);
  }
  
  // Write back to file
  fs.writeFileSync(filePath, updatedContent, 'utf-8');
  
  return {
    file: filePath,
    needsImport: analysis.needsImport,
    needsLogging: analysis.needsLogging,
  };
}

async function main() {
  console.log('🔍 Finding API routes...\n');
  
  const apiFiles = await findAPIRoutes();
  console.log(`Found ${apiFiles.length} API route files\n`);
  
  console.log('📝 Adding error logging...\n');
  
  const updates: FileUpdate[] = [];
  
  for (const file of apiFiles) {
    try {
      const update = await updateFile(file);
      if (update.needsImport || update.needsLogging) {
        updates.push(update);
        console.log(`✅ Updated: ${file.replace(API_DIR, '')}`);
      }
    } catch (error) {
      console.error(`❌ Error updating ${file}:`, error);
    }
  }
  
  console.log(`\n✨ Complete! Updated ${updates.length} files\n`);
  
  if (updates.length > 0) {
    console.log('Updated files:');
    updates.forEach(u => {
      console.log(`  - ${u.file.replace(API_DIR, '')}`);
    });
  }
}

main().catch(console.error);
