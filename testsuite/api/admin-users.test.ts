/**
 * @tags @admin @permissions
 * NEW TEST — not in original Testsprite set.
 *
 * Tests admin user management API endpoints.
 * NON-DESTRUCTIVE: only verifies access control and validation,
 * does NOT create/modify real user accounts.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:3000';

describe('@admin Admin Users API', () => {
  describe('Unauthenticated access', () => {
    it('GET /api/admin/users returns 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/users`);
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/users returns 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', full_name: 'Test' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Reset password endpoint', () => {
    it('POST /api/admin/users/fake-id/reset-password returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/users/fake-id/reset-password`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Roles endpoint', () => {
    it('GET /api/admin/roles returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/roles`);
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/roles returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-role', display_name: 'Test Role' }),
      });
      expect(res.status).toBe(401);
    });
  });
});
