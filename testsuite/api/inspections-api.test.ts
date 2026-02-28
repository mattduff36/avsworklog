/**
 * @tags @inspections @permissions
 * NEW TEST — not in original Testsprite set.
 *
 * Tests van inspection API endpoints for access control.
 * NON-DESTRUCTIVE: only verifies auth guards.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';

describe('@inspections Inspections API Access Control', () => {
  it('GET /api/van-inspections/fake-id/pdf returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/pdf`);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/van-inspections/fake-id/delete returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/delete`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/van-inspections/locked-defects returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/locked-defects`);
    expect(res.status).toBe(401);
  });

  it('POST /api/van-inspections/inform-workshop returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/inform-workshop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('@inspections Plant Inspections API', () => {
  it('GET /api/plant-inspections/locked-defects returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/plant-inspections/locked-defects`);
    expect(res.status).toBe(401);
  });

  it('POST /api/plant-inspections/inform-workshop returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/plant-inspections/inform-workshop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});
