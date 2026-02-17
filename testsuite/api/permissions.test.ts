/**
 * @tags @permissions
 * Converted from: TC018_Role_based_permission_checks_on_API_endpoints.py
 *
 * Vitest integration tests for API endpoint role-based access control.
 * NON-DESTRUCTIVE: only makes GET requests to verify access control.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:3000';

interface TestUsers {
  admin: { email: string; password: string; userId: string };
  manager: { email: string; password: string; userId: string };
  employee: { email: string; password: string; userId: string };
}

function loadTestUsers(): TestUsers | null {
  const stateFile = resolve(process.cwd(), 'testsuite', '.state', 'test-users.json');
  if (!existsSync(stateFile)) return null;
  return JSON.parse(readFileSync(stateFile, 'utf-8'));
}

describe('@permissions API Endpoint Access Control', () => {
  let employeeClient: SupabaseClient;
  let testUsers: TestUsers | null;

  beforeAll(async () => {
    testUsers = loadTestUsers();
    if (!testUsers) {
      console.warn('Test users not provisioned. Skipping authenticated tests.');
      return;
    }

    // Create an employee-authenticated client
    employeeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error } = await employeeClient.auth.signInWithPassword({
      email: testUsers.employee.email,
      password: testUsers.employee.password,
    });
    if (error) {
      console.warn('Could not authenticate employee for API tests:', error.message);
    }
  });

  describe('Unauthenticated requests return 401', () => {
    const protectedEndpoints = [
      '/api/admin/users',
      '/api/admin/roles',
      '/api/admin/vehicles',
      '/api/admin/categories',
      '/api/reports/stats',
    ];

    for (const endpoint of protectedEndpoints) {
      it(`GET ${endpoint} returns 401 without auth`, async () => {
        const res = await fetch(`${BASE_URL}${endpoint}`);
        expect(res.status).toBe(401);
      });
    }
  });

  describe('Employee cannot access admin-only endpoints', () => {
    it('employee cannot list users via API', async () => {
      if (!testUsers || !employeeClient) return;

      const { data: session } = await employeeClient.auth.getSession();
      if (!session?.session?.access_token) return;

      const res = await fetch(`${BASE_URL}/api/admin/users`, {
        headers: {
          'Authorization': `Bearer ${session.session.access_token}`,
        },
      });
      // Should be 401 or 403
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThanOrEqual(403);
    });
  });

  describe('Public endpoints', () => {
    it('login page is accessible', async () => {
      const res = await fetch(`${BASE_URL}/login`);
      expect(res.status).toBe(200);
    });
  });
});
