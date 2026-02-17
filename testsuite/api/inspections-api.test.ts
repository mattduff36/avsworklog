/**
 * @tags @inspections @permissions
 * NEW TEST — not in original Testsprite set.
 *
 * Tests vehicle inspection API endpoints for access control.
 * NON-DESTRUCTIVE: only verifies auth guards.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:3000';

describe('@inspections Inspections API Access Control', () => {
  it('GET /api/inspections/fake-id/pdf returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/inspections/fake-id/pdf`);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/inspections/fake-id/delete returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/inspections/fake-id/delete`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/inspections/locked-defects returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/inspections/locked-defects`);
    expect(res.status).toBe(401);
  });

  it('POST /api/inspections/inform-workshop returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/inspections/inform-workshop`, {
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
