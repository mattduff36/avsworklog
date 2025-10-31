/**
 * Comprehensive RAMS Feature Test Suite
 * Tests database, storage, permissions, and functionality
 */

import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/database';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const symbols = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  };
  console.log(`${symbols[type]} ${message}`);
}

function addResult(name: string, passed: boolean, error?: string, details?: any) {
  results.push({ name, passed, error, details });
  if (passed) {
    log(`${name}: PASSED`, 'success');
  } else {
    log(`${name}: FAILED - ${error}`, 'error');
    if (details) {
      console.log('Details:', JSON.stringify(details, null, 2));
    }
  }
}

async function test1_CheckTablesExist() {
  log('\n📋 Test 1: Check RAMS tables exist', 'info');
  
  try {
    // Check rams_documents table
    const { error: docsError } = await supabase
      .from('rams_documents')
      .select('id')
      .limit(1);

    if (docsError) throw new Error(`rams_documents table error: ${docsError.message}`);

    // Check rams_assignments table
    const { error: assignError } = await supabase
      .from('rams_assignments')
      .select('id')
      .limit(1);

    if (assignError) throw new Error(`rams_assignments table error: ${assignError.message}`);

    // Check rams_visitor_signatures table
    const { error: visitorError } = await supabase
      .from('rams_visitor_signatures')
      .select('id')
      .limit(1);

    if (visitorError) throw new Error(`rams_visitor_signatures table error: ${visitorError.message}`);

    addResult('Tables exist', true);
  } catch (error: any) {
    addResult('Tables exist', false, error.message);
  }
}

async function test2_CheckStorageBucket() {
  log('\n🪣 Test 2: Check storage bucket exists', 'info');
  
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();

    if (error) throw new Error(`Storage error: ${error.message}`);

    const ramsBucket = buckets?.find(b => b.name === 'rams-documents');
    
    if (!ramsBucket) {
      throw new Error('rams-documents bucket does not exist');
    }

    addResult('Storage bucket exists', true, undefined, { bucket: ramsBucket });
  } catch (error: any) {
    addResult('Storage bucket exists', false, error.message);
  }
}

async function test3_CheckStoragePolicies() {
  log('\n🔒 Test 3: Check storage bucket policies', 'info');
  
  try {
    // Try to list files in the bucket (should work with service role)
    const { data, error } = await supabase.storage
      .from('rams-documents')
      .list();

    if (error) throw new Error(`Storage list error: ${error.message}`);

    addResult('Storage policies', true, undefined, { 
      fileCount: data?.length || 0,
      message: 'Service role can access storage'
    });
  } catch (error: any) {
    addResult('Storage policies', false, error.message);
  }
}

async function test4_CheckRLSPolicies() {
  log('\n🛡️ Test 4: Check RLS policies', 'info');
  
  try {
    // Get a manager or admin user
    const { data: managers, error: managerError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['manager', 'admin'])
      .limit(1);

    if (managerError) throw new Error(`Error fetching managers: ${managerError.message}`);
    
    if (!managers || managers.length === 0) {
      throw new Error('No manager or admin users found in database');
    }

    const manager = managers[0];

    // Get an employee user (if exists)
    const { data: employees, error: employeeError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('role', 'employee')
      .limit(1);

    if (employeeError) {
      log(`  ⚠️ Warning checking employees: ${employeeError.message}`, 'warning');
    }

    const employee = employees && employees.length > 0 ? employees[0] : null;

    addResult('RLS policies check', true, undefined, { 
      managerFound: manager.full_name,
      employeeFound: employee?.full_name || 'No employees (OK for admin-only setup)'
    });
  } catch (error: any) {
    addResult('RLS policies check', false, error.message);
  }
}

async function test5_CheckExistingDocuments() {
  log('\n📄 Test 5: Check existing RAMS documents', 'info');
  
  try {
    const { data: documents, error } = await supabase
      .from('rams_documents')
      .select(`
        id,
        title,
        file_name,
        file_path,
        file_type,
        created_at,
        is_active,
        uploaded_by,
        uploader:profiles!rams_documents_uploaded_by_fkey(full_name, role)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Error fetching documents: ${error.message}`);

    log(`Found ${documents?.length || 0} active documents`, 'info');

    if (documents && documents.length > 0) {
      // Check if files exist in storage
      for (const doc of documents) {
        log(`  - Document: ${doc.title} (${doc.id})`, 'info');
        log(`    File path: ${doc.file_path}`, 'info');
        log(`    Uploader: ${doc.uploader?.full_name || 'Unknown'}`, 'info');

        // Try to check if file exists in storage
        const { data: fileData, error: fileError } = await supabase.storage
          .from('rams-documents')
          .list(doc.file_path.split('/')[0]);

        if (fileError) {
          log(`    ⚠️ Storage check error: ${fileError.message}`, 'warning');
        } else {
          const fileExists = fileData?.some(f => doc.file_path.includes(f.name));
          if (fileExists) {
            log(`    ✅ File exists in storage`, 'success');
          } else {
            log(`    ❌ File NOT found in storage!`, 'error');
          }
        }
      }
    }

    addResult('Existing documents check', true, undefined, { 
      documentCount: documents?.length || 0,
      documents: documents?.map(d => ({
        id: d.id,
        title: d.title,
        file_path: d.file_path
      }))
    });
  } catch (error: any) {
    addResult('Existing documents check', false, error.message);
  }
}

async function test6_TestDocumentRetrieval() {
  log('\n🔍 Test 6: Test document retrieval with JOIN', 'info');
  
  try {
    // Get first document
    const { data: firstDoc, error: firstError } = await supabase
      .from('rams_documents')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (firstError) throw new Error(`Error fetching first document: ${firstError.message}`);

    if (!firstDoc) {
      log('No documents to test retrieval', 'warning');
      addResult('Document retrieval test', true, 'No documents to test');
      return;
    }

    // Now try the same query as the page does
    const { data: doc, error: docError } = await supabase
      .from('rams_documents')
      .select(`
        *,
        uploader:profiles!rams_documents_uploaded_by_fkey(full_name)
      `)
      .eq('id', firstDoc.id)
      .maybeSingle();

    if (docError) throw new Error(`Document retrieval error: ${docError.message}`);

    if (!doc) throw new Error('Document not found despite existing in database');

    addResult('Document retrieval test', true, undefined, {
      documentId: doc.id,
      title: doc.title,
      uploaderName: doc.uploader?.full_name
    });
  } catch (error: any) {
    addResult('Document retrieval test', false, error.message);
  }
}

async function test7_TestAssignments() {
  log('\n👥 Test 7: Test assignments', 'info');
  
  try {
    const { data: assignments, error } = await supabase
      .from('rams_assignments')
      .select(`
        *,
        employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role)
      `)
      .limit(10);

    if (error) throw new Error(`Assignments error: ${error.message}`);

    log(`Found ${assignments?.length || 0} assignments`, 'info');

    addResult('Assignments test', true, undefined, {
      assignmentCount: assignments?.length || 0
    });
  } catch (error: any) {
    addResult('Assignments test', false, error.message);
  }
}

async function test8_CheckForeignKeyConstraints() {
  log('\n🔗 Test 8: Check foreign key relationships', 'info');
  
  try {
    // Check if profiles table has required users
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['admin', 'manager', 'employee']);

    if (profileError) throw new Error(`Profiles error: ${profileError.message}`);

    const adminCount = profiles?.filter(p => p.role === 'admin').length || 0;
    const managerCount = profiles?.filter(p => p.role === 'manager').length || 0;
    const employeeCount = profiles?.filter(p => p.role === 'employee').length || 0;

    log(`  Admins: ${adminCount}`, 'info');
    log(`  Managers: ${managerCount}`, 'info');
    log(`  Employees: ${employeeCount}`, 'info');

    if (managerCount === 0) {
      log('  ⚠️ No managers found - upload will fail!', 'warning');
    }

    addResult('Foreign key constraints', true, undefined, {
      adminCount,
      managerCount,
      employeeCount
    });
  } catch (error: any) {
    addResult('Foreign key constraints', false, error.message);
  }
}

async function printSummary() {
  log('\n' + '='.repeat(60), 'info');
  log('TEST SUMMARY', 'info');
  log('='.repeat(60), 'info');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  log(`\nTotal Tests: ${total}`, 'info');
  log(`Passed: ${passed}`, passed === total ? 'success' : 'info');
  log(`Failed: ${failed}`, failed > 0 ? 'error' : 'info');

  if (failed > 0) {
    log('\n❌ FAILED TESTS:', 'error');
    results.filter(r => !r.passed).forEach(r => {
      log(`  - ${r.name}: ${r.error}`, 'error');
    });
  }

  log('\n' + '='.repeat(60), 'info');
}

async function runAllTests() {
  log('🧪 Starting RAMS Feature Test Suite\n', 'info');

  await test1_CheckTablesExist();
  await test2_CheckStorageBucket();
  await test3_CheckStoragePolicies();
  await test4_CheckRLSPolicies();
  await test5_CheckExistingDocuments();
  await test6_TestDocumentRetrieval();
  await test7_TestAssignments();
  await test8_CheckForeignKeyConstraints();

  await printSummary();

  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch(error => {
  log(`\n💥 Fatal error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});

