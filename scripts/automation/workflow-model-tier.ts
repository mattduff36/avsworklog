import type {
  WorkflowParentTier,
  WorkflowRoutingDecision,
} from './types';

export const WORKFLOW_MODEL_TIER_REGISTRY_VERSION = '1';

export interface WorkflowRoutingContext {
  parentTier: WorkflowParentTier;
  risk: 'high' | 'routine';
  substantive: boolean;
  explicitPremiumRequested: boolean;
  premiumTaskDecision?: 'pause_to_switch' | 'continue_premium';
}

export type WorkflowRoutingAction = 'ask_switch' | 'pause_for_switch' | 'continue';

export interface WorkflowRoutingEvidence {
  initialParentTier: WorkflowParentTier;
  executionParentTier: WorkflowParentTier;
  routingDecision: WorkflowRoutingDecision;
}

const PREMIUM_MODEL_IDS = new Set([
  'gpt-5.6-sol',
  'gpt-5.4',
  'gpt-5.6-sol-high',
  'gpt-5.6-sol[effort=high]',
  'gpt-5.4-medium',
  'claude-opus',
  'claude-sonnet',
  'claude-fable',
  'claude-opus-5-thinking-high',
  'claude-sonnet-5-thinking-high',
  'claude-fable-5-thinking-high',
]);

const ECONOMICAL_MODEL_IDS = new Set([
  'cursor-grok-4.5',
  'cursor-grok-4.5-high-fast',
  'grok-4.5',
  'grok-4.5-high-fast',
  'composer-2.5-fast',
  'composer-2.5',
]);

export function classifyWorkflowModelTier(model: string | null | undefined): WorkflowParentTier {
  if (!model?.trim()) return 'unknown';
  const normalized = model.trim().toLowerCase();
  if (PREMIUM_MODEL_IDS.has(normalized)) return 'premium';
  if (ECONOMICAL_MODEL_IDS.has(normalized)) return 'economical';
  return 'unknown';
}

export function getWorkflowRoutingAction(context: WorkflowRoutingContext): WorkflowRoutingAction {
  if (
    !context.substantive ||
    context.parentTier !== 'premium' ||
    context.risk !== 'routine' ||
    context.explicitPremiumRequested
  ) {
    return 'continue';
  }
  if (context.premiumTaskDecision === 'pause_to_switch') return 'pause_for_switch';
  if (context.premiumTaskDecision === 'continue_premium') return 'continue';
  return 'ask_switch';
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
