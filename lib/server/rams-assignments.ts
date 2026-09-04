import { isUuid } from '@/lib/utils/uuid';

export function normalizeAssignmentIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string' || !isUuid(item)) {
      return null;
    }
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    ids.push(item);
  }

  return ids;
}

export function findAssignmentIdOverlap(assignedIds: string[], unassignIds: string[]): string[] {
  const assigned = new Set(assignedIds);
  return unassignIds.filter((id) => assigned.has(id));
}

export function assignmentIdSetsEqual(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  const expectedSet = new Set(expected);
  if (expectedSet.size !== expected.length) {
    return false;
  }

  return actual.every((id) => expectedSet.has(id));
}
