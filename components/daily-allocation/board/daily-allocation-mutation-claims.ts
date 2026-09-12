export type DailyAllocationClaimMode = 'shared' | 'exclusive';

export interface DailyAllocationMutationClaim {
  scope: string;
  id: string;
  mode: DailyAllocationClaimMode;
}

export function claimsConflict(
  left: readonly DailyAllocationMutationClaim[],
  right: readonly DailyAllocationMutationClaim[]
): boolean {
  return left.some((a) =>
    right.some((b) =>
      a.scope === b.scope
      && a.id === b.id
      && (a.mode === 'exclusive' || b.mode === 'exclusive')
    )
  );
}

export function claimsToLockKeys(
  claims: readonly DailyAllocationMutationClaim[]
): string[] {
  return claims.map((claim) => `${claim.scope}:${claim.id}`);
}

export function planDayClaim(planDayId: string): DailyAllocationMutationClaim {
  return { scope: 'plan-day', id: planDayId, mode: 'exclusive' };
}

export function visitClaim(
  visitId: string,
  mode: DailyAllocationClaimMode = 'exclusive'
): DailyAllocationMutationClaim {
  return { scope: 'visit-tree', id: visitId, mode };
}

export function assignmentClaim(assignmentId: string): DailyAllocationMutationClaim {
  return { scope: 'assignment', id: assignmentId, mode: 'exclusive' };
}

export function resourceDayClaim(
  resourceKind: 'labour' | 'plant',
  resourceId: string,
  workDate: string
): DailyAllocationMutationClaim {
  return {
    scope: 'resource-day',
    id: `${resourceKind}:${resourceId}:${workDate}`,
    mode: 'exclusive',
  };
}

export function authorityClaim(
  teamId: string,
  workDate: string
): DailyAllocationMutationClaim {
  return {
    scope: 'plan-authority',
    id: `${teamId}:${workDate}`,
    mode: 'exclusive',
  };
}

export function visitTimesCoalesceGroup(visitId: string): string {
  return `visit-times:${visitId}`;
}

export function assignmentDuplicateKey(
  kind: 'labour' | 'plant',
  resourceId: string,
  visitId: string
): string {
  return `assign:${kind}:${resourceId}:${visitId}`;
}
