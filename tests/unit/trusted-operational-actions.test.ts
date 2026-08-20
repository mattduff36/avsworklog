import {
  ERROR_LOG_RETENTION_PREDICATE,
  TRUSTED_OPERATIONAL_ACTIONS,
  classifyOperationalAction,
  type OperationalClassificationInput,
  type OperationalMutation,
} from '@/scripts/automation/trusted-operational-actions';
import { describe, expect, it } from 'vitest';

const ARCHIVE_MUTATION = TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations.find(
  (mutation) => mutation.operation === 'update'
)!;
const RETENTION_MUTATION = TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations.find(
  (mutation) => mutation.purpose === 'expired-archived-retention'
)!;

function trustedExecution(
  overrides: Partial<OperationalClassificationInput> = {}
): OperationalClassificationInput {
  return {
    commandId: 'fixerrors',
    safetyContract: 'fixerrors-exact-snapshot-v4',
    intent: 'execute',
    explicitlyRequested: true,
    confirmationBoundToSnapshot: true,
    runtimeSafetyChecksPassed: true,
    requestedMutations: [ARCHIVE_MUTATION],
    ...overrides,
  };
}

describe('TEE V2.2 trusted operational action policy', () => {
  it('FE-TRUST-001 treats registered snapshot-bound archive execution as operational', () => {
    expect(TRUSTED_OPERATIONAL_ACTIONS.fixerrors.safetyContract).toBe(
      'fixerrors-exact-snapshot-v4'
    );
    expect(ARCHIVE_MUTATION).toMatchObject({
      operation: 'update',
      updatedColumns: ['status', 'archived_at'],
      targetPredicate: "status = 'active'",
    });
    expect(classifyOperationalAction(trustedExecution())).toMatchObject({
      kind: 'operational_execution',
      trusted: true,
      safetyContract: 'fixerrors-exact-snapshot-v4',
    });
  });

  it('FE-TRUST-002 registers exact v4 update plus 12-month retention delete', () => {
    expect(TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations).toEqual([
      ARCHIVE_MUTATION,
      RETENTION_MUTATION,
    ]);
    expect(RETENTION_MUTATION).toMatchObject({
      schema: 'public',
      table: 'error_logs',
      operation: 'delete',
      purpose: 'expired-archived-retention',
      targetPredicate: ERROR_LOG_RETENTION_PREDICATE,
    });
    expect(
      classifyOperationalAction(
        trustedExecution({
          confirmationBoundToSnapshot: false,
          retentionBoundToCandidateSet: true,
          requestedMutations: [RETENTION_MUTATION],
        })
      )
    ).toMatchObject({
      kind: 'operational_execution',
      trusted: true,
    });
  });

  it('keeps modification of fixerrors archive logic CRITICAL', () => {
    expect(
      classifyOperationalAction(trustedExecution({ intent: 'modify' }))
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
      reason: 'trusted-command-safety-contract-modification',
    });
  });

  it('does not trust unregistered destructive commands or natural-language trust claims', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ commandId: 'delete-all-error-logs' })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
      safetyContract: null,
    });
  });

  it('suspends trust when snapshot or retention binding is missing', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ confirmationBoundToSnapshot: false })
      )
    ).toMatchObject({
      trustSuspended: true,
      reason: 'trusted-operational-precondition-failed',
    });
    expect(
      classifyOperationalAction(
        trustedExecution({
          confirmationBoundToSnapshot: false,
          requestedMutations: [RETENTION_MUTATION],
        })
      )
    ).toMatchObject({
      trustSuspended: true,
      reason: 'trusted-operational-precondition-failed',
    });
    expect(
      classifyOperationalAction(
        trustedExecution({ runtimeSafetyChecksPassed: false })
      )
    ).toMatchObject({
      trustSuspended: true,
    });
  });

  it('FE-TRUST-002 suspends trust for v3, delete-all, extra tables, and predicate changes', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ safetyContract: 'fixerrors-exact-snapshot-v3' })
      )
    ).toMatchObject({
      trustSuspended: true,
      reason: 'trusted-operational-contract-mismatch',
    });
    expect(
      classifyOperationalAction(
        trustedExecution({
          requestedMutations: [
            {
              schema: 'public',
              table: 'error_logs',
              operation: 'delete',
              identityColumn: 'id',
              purpose: 'primary-diagnostic',
            },
          ],
        })
      )
    ).toMatchObject({
      trustSuspended: true,
      reason: 'trusted-operational-scope-mismatch',
    });
    expect(
      classifyOperationalAction(
        trustedExecution({
          requestedMutations: [
            RETENTION_MUTATION,
            {
              schema: 'public',
              table: 'error_log_alerts',
              operation: 'delete',
              identityColumn: 'error_log_id',
              purpose: 'dependent-diagnostic',
            },
          ],
        })
      )
    ).toMatchObject({
      trustSuspended: true,
      reason: 'trusted-operational-scope-mismatch',
    });
    const widened: OperationalMutation = {
      ...RETENTION_MUTATION,
      targetPredicate: "status = 'archived'",
    };
    expect(
      classifyOperationalAction(
        trustedExecution({
          confirmationBoundToSnapshot: false,
          retentionBoundToCandidateSet: true,
          requestedMutations: [widened],
        })
      )
    ).toMatchObject({
      trustSuspended: true,
      reason: 'trusted-operational-scope-mismatch',
    });
  });
});
