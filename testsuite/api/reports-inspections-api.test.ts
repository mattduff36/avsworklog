/**
 * Reports Inspections API Integration Tests
 *
 * Tests report API routes that depend on the inspections refactor:
 * - /api/reports/inspections/compliance
 * - /api/reports/inspections/defects
 * - /api/reports/inspections/bulk-pdf
 * - /api/reports/stats
 *
 * Auth enforcement and no 500 errors.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';

describe('Reports Inspections — Auth Guards', () => {
  it('GET /api/reports/inspections/compliance returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/inspections/compliance`);
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/reports/inspections/defects returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/inspections/defects`);
    expect([401, 403]).toContain(res.status);
  });

  it('POST /api/reports/inspections/bulk-pdf returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/inspections/bulk-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/reports/stats returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/stats`);
    expect([401, 403]).toContain(res.status);
  });
});

describe('Reports Inspections — No 500 Errors', () => {
  const routes = [
    { method: 'GET', path: '/api/reports/inspections/compliance' },
    { method: 'GET', path: '/api/reports/inspections/defects' },
    { method: 'GET', path: '/api/reports/stats' },
  ];

  for (const route of routes) {
    it(`${route.method} ${route.path} does not return 500`, async () => {
      const res = await fetch(`${BASE_URL}${route.path}`);
      expect(res.status).not.toBe(500);
    });
  }
});
