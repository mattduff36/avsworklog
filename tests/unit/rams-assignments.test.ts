import { describe, expect, it } from 'vitest';
import {
  assignmentIdSetsEqual,
  findAssignmentIdOverlap,
  normalizeAssignmentIds,
} from '@/lib/server/rams-assignments';

const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';

describe('rams assignment ID helpers', () => {
  it('normalizes and deduplicates valid UUID arrays', () => {
    expect(normalizeAssignmentIds([USER_A, USER_B, USER_A])).toEqual([USER_A, USER_B]);
    expect(normalizeAssignmentIds([])).toEqual([]);
  });

  it('rejects missing or invalid ID arrays', () => {
    expect(normalizeAssignmentIds(undefined)).toBeNull();
    expect(normalizeAssignmentIds('not-an-array')).toBeNull();
    expect(normalizeAssignmentIds([USER_A, 'not-a-uuid'])).toBeNull();
  });

  it('detects overlapping assign and unassign IDs', () => {
    expect(findAssignmentIdOverlap([USER_A, USER_B], [USER_B])).toEqual([USER_B]);
    expect(findAssignmentIdOverlap([USER_A], [USER_B])).toEqual([]);
  });

  it('compares delete results with exact set equality', () => {
    expect(assignmentIdSetsEqual([USER_B, USER_A], [USER_A, USER_B])).toBe(true);
    expect(assignmentIdSetsEqual([USER_A], [USER_A, USER_B])).toBe(false);
    expect(assignmentIdSetsEqual([USER_A, USER_A], [USER_A])).toBe(false);
    expect(assignmentIdSetsEqual([], [])).toBe(true);
  });
});
