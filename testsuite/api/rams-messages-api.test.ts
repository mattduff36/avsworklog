/**
 * @tags @rams @messages @permissions
 * NEW TEST — not in original Testsprite set.
 *
 * Tests RAMS and messages API endpoints for access control.
 * NON-DESTRUCTIVE: only verifies auth guards.
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:3000';

describe('@rams RAMS API Access Control', () => {
  it('GET /api/rams returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/rams`);
    expect(res.status).toBe(401);
  });

  it('POST /api/rams/upload returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/rams/upload`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/rams/sign returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/rams/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/rams/visitor-sign returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/rams/visitor-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('@messages Messages API Access Control', () => {
  it('GET /api/messages returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/messages`);
    expect(res.status).toBe(401);
  });

  it('GET /api/messages/pending returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/messages/pending`);
    expect(res.status).toBe(401);
  });

  it('POST /api/messages/clear-all returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/messages/clear-all`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/messages/fake-id/dismiss returns 401 without auth', async () => {
    const res = await fetch(`${BASE_URL}/api/messages/fake-id/dismiss`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});
