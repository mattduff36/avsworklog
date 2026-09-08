import type {
  WorkflowLane,
  WorkflowParentTier,
  WorkflowRoutingDecision,
  WorkflowTeeMode,
} from './types';

export const WORKFLOW_MODEL_TIER_REGISTRY_VERSION = '3';
export const WORKFLOW_COMPATIBLE_MODEL_TIER_REGISTRY_VERSIONS = ['2', '3'] as const;

export type WorkflowModelRoleKey =
  | 'economical-default'
  | 'premium-architecture-gate'
  | 'premium-final-review'
  | 'premium-fix-routing'
  | 'premium-planning';

export type WorkflowModelFamily =
  | 'cursor-grok'
  | 'gpt-sol'
  | 'composer'
  | 'claude'
  | 'unknown';

export interface WorkflowModelRole {
  role: WorkflowModelRoleKey;
  tier: Exclude<WorkflowParentTier, 'unknown'>;
  family: WorkflowModelFamily;
  displayName: string;
  modelIds: string[];
  defaultModelId: string;
}

export interface WorkflowRoutingContext {
  parentTier: WorkflowParentTier;
  /** Legacy fallback when lane is not yet available. */
  risk?: 'high' | 'routine';
  lane?: WorkflowLane;
  substantive: boolean;
  /** STANDARD only: switching is offered only when the implementation is materially large. */
  substantialImplementation?: boolean;
  explicitPremiumRequested: boolean;
  premiumTaskDecision?: 'pause_to_switch' | 'continue_premium';
}

export type WorkflowRoutingAction = 'ask_switch' | 'pause_for_switch' | 'continue';

export interface WorkflowTeeModeContext {
  parentTier: WorkflowParentTier;
  lane: WorkflowLane;
  complexity: 'small' | 'medium' | 'exceptional';
  ambiguity: 'low' | 'high';
  blastRadius: 'local' | 'broad' | 'production';
  reversible: boolean;
  testQuality: 'strong' | 'limited' | 'unknown';
  productionDataImpact: 'none' | 'read-only' | 'write' | 'destructive';
  securityConsequences: 'none' | 'contained' | 'material';
  independentReviewValue: 'low' | 'material';
  userOverride?: WorkflowTeeMode;
}

export interface WorkflowTeeModeDecision {
  mode: WorkflowTeeMode;
  source: 'premium_model' | 'owner_override' | 'automatic_tee';
  reason: string;
}

export const WORKFLOW_UNBYPASSABLE_SAFETY_REQUIREMENTS = [
  'production-data-authorization',
  'secret-protection',
  'deployment-authorization',
  'no-force-push-without-authorization',
  'truthful-verification-reporting',
] as const;

export interface WorkflowRoutingEvidence {
  initialParentTier: WorkflowParentTier;
  executionParentTier: WorkflowParentTier;
  routingDecision: WorkflowRoutingDecision;
}

export const WORKFLOW_MODEL_REGISTRY: WorkflowModelRole[] = [
  {
    role: 'economical-default',
    tier: 'economical',
    family: 'cursor-grok',
    displayName: 'Cursor Grok 4.5',
    modelIds: [
      'cursor-grok-4.5',
      'cursor-grok-4.5-high-fast',
      'grok-4.5',
      'grok-4.5-high-fast',
      'composer-2.5',
      'composer-2.5-fast',
    ],
    defaultModelId: 'cursor-grok-4.5',
  },
  {
    role: 'premium-architecture-gate',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol (high reasoning)',
    modelIds: [
      'gpt-5.6-sol',
      'gpt-5.6-sol-high',
      'gpt-5.6-sol[effort=high]',
      'gpt-5.5-high',
      'gpt-5.4',
      'gpt-5.4-medium',
      'gpt-5.3-codex',
      'claude-opus-5-thinking-high',
    ],
    defaultModelId: 'gpt-5.6-sol-high',
  },
  {
    role: 'premium-final-review',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol (high reasoning)',
    modelIds: [
      'gpt-5.6-sol',
      'gpt-5.6-sol-high',
      'gpt-5.6-sol[effort=high]',
      'gpt-5.5-high',
      'gpt-5.4',
      'gpt-5.4-medium',
      'gpt-5.3-codex',
      'claude-opus-5-thinking-high',
    ],
    defaultModelId: 'gpt-5.6-sol-high',
  },
  {
    role: 'premium-fix-routing',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol (high)',
    modelIds: ['gpt-5.6-sol', 'gpt-5.6-sol-high', 'gpt-5.6-sol[effort=high]'],
    defaultModelId: 'gpt-5.6-sol-high',
  },
  {
    role: 'premium-planning',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol',
    modelIds: [
      'gpt-5.6-sol',
      'gpt-5.6-sol-high',
      'gpt-5.6-sol[effort=high]',
      'gpt-5.4',
      'gpt-5.4-medium',
      'claude-opus',
      'claude-sonnet',
      'claude-fable',
      'claude-opus-5-thinking-high',
      'claude-sonnet-5-thinking-high',
      'claude-fable-5-thinking-high',
    ],
    defaultModelId: 'gpt-5.6-sol',
  },
];

const PREMIUM_MODEL_IDS = new Set(
  WORKFLOW_MODEL_REGISTRY.filter((role) => role.tier === 'premium').flatMap((role) =>
    role.modelIds.map((id) => id.toLowerCase())
  )
);

const ECONOMICAL_MODEL_IDS = new Set(
  WORKFLOW_MODEL_REGISTRY.filter((role) => role.tier === 'economical').flatMap((role) =>
    role.modelIds.map((id) => id.toLowerCase())
  )
);

const ROLE_BY_KEY = new Map(WORKFLOW_MODEL_REGISTRY.map((role) => [role.role, role]));

export function getWorkflowModelRole(role: string | null | undefined): WorkflowModelRole | null {
  if (!role?.trim()) return null;
  return ROLE_BY_KEY.get(role.trim() as WorkflowModelRoleKey) ?? null;
}

export function resolveWorkflowModelRoleKey(
  model: string | null | undefined
): WorkflowModelRoleKey | 'unknown' {
  if (!model?.trim()) return 'unknown';
  const normalized = model.trim().toLowerCase();
  for (const role of WORKFLOW_MODEL_REGISTRY) {
    if (role.modelIds.some((id) => id.toLowerCase() === normalized)) {
      return role.role;
    }
  }
  return 'unknown';
}

export function classifyWorkflowModelTier(model: string | null | undefined): WorkflowParentTier {
  if (!model?.trim()) return 'unknown';
  const normalized = model.trim().toLowerCase();
  if (PREMIUM_MODEL_IDS.has(normalized)) return 'premium';
  if (ECONOMICAL_MODEL_IDS.has(normalized)) return 'economical';
  return 'unknown';
}

export function isWorkflowModelRegistryVersionCompatible(
  version: string | null | undefined
): boolean {
  return Boolean(
    version &&
      (WORKFLOW_COMPATIBLE_MODEL_TIER_REGISTRY_VERSIONS as readonly string[]).includes(version)
  );
}

export function isRecognizedPremiumModel(model: string | null | undefined): boolean {
  return classifyWorkflowModelTier(model) === 'premium';
}

/**
 * V2.5 separates task risk from workflow ceremony. CRITICAL is an objective risk
 * fact, while a recognised premium model may still select DIRECT or TEE-LIGHT.
 */
export function selectWorkflowTeeMode(
  context: WorkflowTeeModeContext
): WorkflowTeeModeDecision {
  if (context.userOverride) {
    return {
      mode: context.userOverride,
      source: 'owner_override',
      reason: 'explicit-owner-workflow-choice',
    };
  }

  if (context.parentTier !== 'premium') {
    return {
      mode: 'tee-full',
      source: 'automatic_tee',
      reason: 'economy-or-unknown-model-uses-lane-scaffolding',
    };
  }

  const fullMateriallyUseful =
    context.complexity === 'exceptional' ||
    context.productionDataImpact === 'destructive' ||
    (context.ambiguity === 'high' &&
      context.blastRadius !== 'local' &&
      context.independentReviewValue === 'material');
  if (fullMateriallyUseful) {
    return {
      mode: 'tee-full',
      source: 'premium_model',
      reason: 'structured-protocol-materially-reduces-risk',
    };
  }

  const selectedSafeguardsUseful =
    context.complexity === 'medium' ||
    context.securityConsequences !== 'none' ||
    context.productionDataImpact === 'write' ||
    context.testQuality !== 'strong' ||
    context.independentReviewValue === 'material' ||
    (!context.reversible && context.blastRadius !== 'local');
  if (selectedSafeguardsUseful) {
    return {
      mode: 'tee-light',
      source: 'premium_model',
      reason: 'selected-safeguards-materially-improve-confidence',
    };
  }

  return {
    mode: 'direct',
    source: 'premium_model',
    reason: 'expert-direct-execution-is-proportionate',
  };
}

export function getWorkflowRoutingAction(context: WorkflowRoutingContext): WorkflowRoutingAction {
  // V2.5 premium models choose DIRECT/TEE-LIGHT/TEE-FULL themselves. The
  // legacy cost-routing API remains readable but must not interrupt the user
  // merely to switch a capable model to an economical one.
  void context;
  return 'continue';
}

export function isWorkflowRoutingDecisionCoherent(evidence: WorkflowRoutingEvidence): boolean {
  switch (evidence.routingDecision) {
    case 'switched_to_economical':
      return evidence.initialParentTier === 'premium' && evidence.executionParentTier === 'economical';
    case 'continued_premium':
    case 'explicit_premium':
      return evidence.initialParentTier === 'premium' && evidence.executionParentTier === 'premium';
    case 'economical_default':
      return evidence.initialParentTier === 'economical' && evidence.executionParentTier === 'economical';
    case 'not_applicable':
      return evidence.initialParentTier === 'unknown' && evidence.executionParentTier === 'unknown';
    case 'unknown':
      return evidence.initialParentTier === 'unknown' || evidence.executionParentTier === 'unknown';
  }
}
