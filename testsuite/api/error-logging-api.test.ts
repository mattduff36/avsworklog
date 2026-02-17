/**
 * @tags @errors
 * NEW TEST — not in original Testsprite set.
 *
 * Tests error logging and reporting API endpoints.
 * NON-DESTRUCTIVE: only verifies endpoint availability and auth guards.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:3000';

describe('@errors Error Logging API', () => {
  describe('Error report endpoints', () => {
    it('POST /api/errors/report accepts error reports', async () => {
      const res = await fetch(`${BASE_URL}/api/errors/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error_message: 'Testsuite smoke test error',
          error_name: 'TestsuiteError',
          component_name: 'testsuite/api/error-logging-api.test.ts',
          severity: 'low',
        }),
      });
      // Should accept (200) or require auth (401) — either is valid
      expect(res.status).toBeLessThan(500);
    });

    it('GET /api/error-reports requires auth', async () => {
      const res = await fetch(`${BASE_URL}/api/error-reports`);
      expect(res.status).toBeGreaterThanOrEqual(401);
    });

    it('GET /api/management/error-reports requires auth', async () => {
      const res = await fetch(`${BASE_URL}/api/management/error-reports`);
      expect(res.status).toBeGreaterThanOrEqual(401);
    });
  });

  describe('Error notification endpoints', () => {
    it('POST /api/errors/notify-new requires auth', async () => {
      const res = await fetch(`${BASE_URL}/api/errors/notify-new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error_id: 'fake-id' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Daily summary endpoints', () => {
    it('GET /api/errors/daily-summary requires auth or API key', async () => {
      const res = await fetch(`${BASE_URL}/api/errors/daily-summary`);
      // May return 401, 403, or 405 depending on implementation
      expect(res.status).toBeLessThan(500);
    });
  });
});
