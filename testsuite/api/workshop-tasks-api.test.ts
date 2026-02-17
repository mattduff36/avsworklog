/**
 * @tags @workshop @permissions
 * NEW TEST — not in original Testsprite set.
 *
 * Tests workshop task API endpoints for access control.
 * NON-DESTRUCTIVE: only verifies auth guards on API endpoints.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:3000';

describe('@workshop Workshop Tasks API Access Control', () => {
  describe('Subcategories endpoints', () => {
    it('GET /api/workshop-tasks/subcategories returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/workshop-tasks/subcategories`);
      expect(res.status).toBe(401);
    });

    it('POST /api/workshop-tasks/subcategories returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/workshop-tasks/subcategories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', category_id: 'fake' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Comments endpoints', () => {
    it('GET /api/workshop-tasks/tasks/fake-id/comments returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/workshop-tasks/tasks/fake-id/comments`);
      expect(res.status).toBe(401);
    });

    it('POST /api/workshop-tasks/tasks/fake-id/comments returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/workshop-tasks/tasks/fake-id/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test comment' }),
      });
      expect(res.status).toBe(401);
    });

    it('DELETE /api/workshop-tasks/comments/fake-id returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/workshop-tasks/comments/fake-id`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Attachments endpoints', () => {
    it('GET /api/workshop-tasks/attachments/templates returns auth error', async () => {
      const res = await fetch(`${BASE_URL}/api/workshop-tasks/attachments/templates`);
      // Should require auth
      expect(res.status).toBeGreaterThanOrEqual(401);
    });
  });
});
