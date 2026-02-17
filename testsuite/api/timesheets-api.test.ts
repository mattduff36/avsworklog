/**
 * @tags @timesheets @permissions
 * NEW TEST — not in original Testsprite set.
 *
 * Tests timesheet API endpoints for access control.
 * NON-DESTRUCTIVE: only verifies auth guards, no data mutation.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:3000';

describe('@timesheets Timesheets API Access Control', () => {
  describe('Timesheet management endpoints', () => {
    it('POST /api/timesheets/fake-id/reject returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/timesheets/fake-id/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: 'test' }),
      });
      expect(res.status).toBe(401);
    });

    it('POST /api/timesheets/fake-id/adjust returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/timesheets/fake-id/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it('DELETE /api/timesheets/fake-id/delete returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/timesheets/fake-id/delete`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });

    it('GET /api/timesheets/fake-id/pdf returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/timesheets/fake-id/pdf`);
      expect(res.status).toBe(401);
    });
  });

  describe('Manager endpoints', () => {
    it('GET /api/timesheets/managers returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/timesheets/managers`);
      expect(res.status).toBe(401);
    });
  });

  describe('Reports endpoints', () => {
    it('GET /api/reports/timesheets/summary returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/reports/timesheets/summary`);
      expect(res.status).toBe(401);
    });

    it('GET /api/reports/timesheets/payroll returns 401 without auth', async () => {
      const res = await fetch(`${BASE_URL}/api/reports/timesheets/payroll`);
      expect(res.status).toBe(401);
    });
  });
});
