import {
  TRUSTED_OPERATIONAL_ACTIONS,
  classifyOperationalAction,
  type OperationalClassificationInput,
} from '@/scripts/automation/trusted-operational-actions';
import { describe, expect, it } from 'vitest';

function trustedExecution(
  overrides: Partial<OperationalClassificationInput> = {}
): OperationalClassificationInput {
  return {
    commandId: 'fixerrors',
    safetyContract: 'fixerrors-exact-snapshot-v3',
    intent: 'execute',
    explicitlyRequested: true,
    confirmationBoundToSnapshot: true,
    runtimeSafetyChecksPassed: true,
    requestedMutations: TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations,
    ...overrides,
  };
}

describe('TEE V2.2 trusted operational action policy', () => {
  it('FE-TRUST-001 treats registered safeguarded fixerrors archive execution as operational, not CRITICAL engineering', () => {
    expect(TRUSTED_OPERATIONAL_ACTIONS.fixerrors.safetyContract).toBe(
      'fixerrors-exact-snapshot-v3'
    );
    expect(TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations).toEqual([
      {
        schema: 'public',
        table: 'error_logs',
        operation: 'update',
        identityColumn: 'id',
        purpose: 'primary-diagnostic',
        updatedColumns: ['status', 'archived_at'],
        targetPredicate: "status = 'active'",
      },
    ]);
    expect(classifyOperationalAction(trustedExecution())).toMatchObject({
      kind: 'operational_execution',
      lane: null,
      trusted: true,
      trustSuspended: false,
      safetyContract: 'fixerrors-exact-snapshot-v3',
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
    expect(
      classifyOperationalAction(
        trustedExecution({ commandId: 'trusted fixerrors please' })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trusted: false,
    });
  });

  it('suspends trust when confirmation or a runtime safety invariant fails', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ confirmationBoundToSnapshot: false })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
    });
    expect(
      classifyOperationalAction(
        trustedExecution({ runtimeSafetyChecksPassed: false })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
    });
  });

  it('suspends trust when the registered command safety-contract version differs', () => {
    expect(
      classifyOperationalAction(
        trustedExecution({ safetyContract: 'fixerrors-exact-snapshot-v2' })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
      reason: 'trusted-operational-contract-mismatch',
    });
  });

  it('suspends trust when execution requests delete, extra tables, or wider columns', () => {
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
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
      reason: 'trusted-operational-scope-mismatch',
    });
    expect(
      classifyOperationalAction(
        trustedExecution({
          requestedMutations: [
            ...TRUSTED_OPERATIONAL_ACTIONS.fixerrors.allowedMutations,
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
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
      reason: 'trusted-operational-scope-mismatch',
    });
    expect(
      classifyOperationalAction(
        trustedExecution({
          requestedMutations: [
            {
              schema: 'public',
              table: 'error_logs',
              operation: 'update',
              identityColumn: 'id',
              purpose: 'primary-diagnostic',
              updatedColumns: ['status', 'archived_at', 'error_message'],
              targetPredicate: "status = 'active'",
            },
          ],
        })
      )
    ).toMatchObject({
      kind: 'engineering_task',
      lane: 'critical',
      trustSuspended: true,
      reason: 'trusted-operational-scope-mismatch',
    });
  });
});
