import { describe, it, expect } from 'vitest';
import { parseClosureManifest, assertClosureConfirmation, hashBytes, CONTRACT } from '@/scripts/fixerrors-close-stale';
const now = new Date('2026-10-21T12:00:00.000Z');
export const valid = () => ({ schemaVersion: 1, commandId: 'fixerrors-close-stale', safetyContract: CONTRACT, targetProjectRef: 'example-ref', createdAt: now.toISOString(), expiresAt: '2026-10-21T13:00:00.000Z', rows: [{ id: '00000000-0000-4000-8000-000000000001', expectedRecordHash: 'a'.repeat(64), reason: 'insufficient_evidence', summary: 'Historical evidence cannot identify a defect.', evidence: 'Current source and focused tests were reviewed.' }] });
describe('exact-ID non-actionable closure manifest', () => {
  it('accepts bounded reviewed rows and binds exact confirmations', () => {
    const bytes = JSON.stringify(valid()), manifest = parseClosureManifest(bytes, now), hash = hashBytes(bytes);
    expect(() => assertClosureConfirmation(manifest, hash, 'example-ref', hash)).not.toThrow();
    expect(() => assertClosureConfirmation(manifest, hash, 'different', hash)).toThrow();
    expect(() => assertClosureConfirmation(manifest, hash, 'example-ref', 'b'.repeat(64))).toThrow();
  });
  it.each(['extra', 'duplicate', 'expired', 'future', 'unbounded', 'sensitive', 'empty', 'reason', 'hash', 'malformed'])('rejects %s input', mode => {
    const data = valid();
    if (mode === 'extra') Object.assign(data, { surprise: true });
    if (mode === 'duplicate') data.rows.push(data.rows[0]);
    if (mode === 'expired') data.expiresAt = now.toISOString();
    if (mode === 'future') data.createdAt = '2026-10-21T12:01:00.000Z';
    if (mode === 'unbounded') data.expiresAt = '2026-10-23T12:00:00.000Z';
    if (mode === 'sensitive') data.rows[0].summary = 'Contact person@example.com for the full evidence.';
    if (mode === 'empty') data.rows = [];
    if (mode === 'reason') data.rows[0].reason = 'fixed_live';
    if (mode === 'hash') data.rows[0].expectedRecordHash = 'oops';
    expect(() => parseClosureManifest(mode === 'malformed' ? '{' : JSON.stringify(data), now)).toThrow();
  });
});
