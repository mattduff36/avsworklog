export type WorkflowVerificationProperty =
  | 'browser-ui'
  | 'postgres-concurrency'
  | 'ordinary-unit';

export type WorkflowVerificationCapability =
  | 'local-next-playwright'
  | 'docker-postgres'
  | 'native-local-postgres'
  | 'disposable-remote-postgres'
  | 'pglite'
  | 'unit-test';

export interface WorkflowCapabilityAssessment {
  satisfied: boolean;
  selectedCapability: WorkflowVerificationCapability | null;
  reason: string;
}

export interface WorkflowVerificationRequirement {
  property: WorkflowVerificationProperty;
  available: WorkflowVerificationCapability[];
  /** Successful canonical command/ledger rows that prove this capability was exercised. */
  evidenceCommandNames: string[];
  /** Required for PostgreSQL concurrency so proof is bound to validated ledger output. */
  evidenceLedgerContentHashes?: string[];
  substitution?: {
    replacementProperty: WorkflowVerificationProperty;
    deterministic: boolean;
    coverage: 'weaker' | 'equal' | 'stronger';
    recorded: boolean;
  };
}

export interface WorkflowCapabilityEvidence extends WorkflowVerificationRequirement {
  assessment: WorkflowCapabilityAssessment;
  substitutionAssessment?: { allowed: boolean; reason: string };
}

export function assessAcceptanceCommandSubstitution(params: {
  originalProperty: WorkflowVerificationProperty;
  replacementProperty: WorkflowVerificationProperty;
  deterministic: boolean;
  coverage: 'weaker' | 'equal' | 'stronger';
  recorded: boolean;
}): { allowed: boolean; reason: string } {
  const allowed =
    params.originalProperty === params.replacementProperty &&
    params.deterministic &&
    params.coverage !== 'weaker' &&
    params.recorded;
  return {
    allowed,
    reason: allowed
      ? 'deterministic-equivalent-or-stronger-substitution-recorded'
      : 'substitution-does-not-prove-the-same-property',
  };
}

export function assessWorkflowVerificationRequirements(
  requirements: WorkflowVerificationRequirement[]
): WorkflowCapabilityEvidence[] {
  return requirements.map((requirement) => ({
    ...requirement,
    assessment: assessWorkflowVerificationCapability(requirement),
    substitutionAssessment: requirement.substitution
      ? assessAcceptanceCommandSubstitution({
          originalProperty: requirement.property,
          replacementProperty: requirement.substitution.replacementProperty,
          deterministic: requirement.substitution.deterministic,
          coverage: requirement.substitution.coverage,
          recorded: requirement.substitution.recorded,
        })
      : undefined,
  }));
}

const REAL_POSTGRES_CAPABILITIES = new Set<WorkflowVerificationCapability>([
  'docker-postgres',
  'native-local-postgres',
  'disposable-remote-postgres',
]);

/**
 * TEE V2.5 binds acceptance to the property being proved, not a tool brand.
 * Production databases are intentionally not representable as a test capability.
 */
export function assessWorkflowVerificationCapability(params: {
  property: WorkflowVerificationProperty;
  available: WorkflowVerificationCapability[];
}): WorkflowCapabilityAssessment {
  const available = new Set(params.available);
  if (params.property === 'browser-ui') {
    return available.has('local-next-playwright')
      ? {
          satisfied: true,
          selectedCapability: 'local-next-playwright',
          reason: 'local-nextjs-playwright-proves-browser-property',
        }
      : {
          satisfied: false,
          selectedCapability: null,
          reason: 'browser-verification-capability-unavailable',
        };
  }

  if (params.property === 'postgres-concurrency') {
    const selected = params.available.find((capability) =>
      REAL_POSTGRES_CAPABILITIES.has(capability)
    );
    return selected
      ? {
          satisfied: true,
          selectedCapability: selected,
          reason: 'disposable-real-postgres-capability-available',
        }
      : {
          satisfied: false,
          selectedCapability: null,
          reason: 'real-postgres-concurrency-capability-required',
        };
  }

  return available.has('unit-test')
    ? {
        satisfied: true,
        selectedCapability: 'unit-test',
        reason: 'ordinary-unit-capability-available',
      }
    : {
        satisfied: false,
        selectedCapability: null,
        reason: 'ordinary-unit-capability-unavailable',
      };
}
