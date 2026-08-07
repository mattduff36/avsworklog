import { createHash, randomBytes } from 'crypto';
import { existsSync, lstatSync, realpathSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type {
  WorkflowCommitStatus,
  WorkflowGateDecision,
  WorkflowHandoffStatus,
  WorkflowParentTier,
  WorkflowPlanContract,
  WorkflowRecommendedBuildModel,
  WorkflowRequiredTest,
  WorkflowReviewSource,
  WorkflowRisk,
  WorkflowRoutingDecision,
  WorkflowSwitchTiming,
  WorkflowTaskType,
  WorkflowUnresolvedRisk,
} from './types';
import {
  WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
  getWorkflowModelRole,
} from './workflow-model-tier';
import { hashIdentifier } from './workflow-privacy';

export const PLAN_CONTRACT_MARKER_PREFIX = '<!-- plan-contract-marker:v1';
export const PLAN_CONTRACT_MARKER_SUFFIX = '-->';
export const PLAN_CONTRACT_MAX_BYTES = 512_000;

const TASK_TYPES = new Set<WorkflowTaskType>(['change', 'planning', 'review']);
const RISKS = new Set<WorkflowRisk>(['high', 'routine']);
const PARENT_TIERS = new Set<WorkflowParentTier>(['premium', 'economical', 'unknown']);
const ROUTING_DECISIONS = new Set<WorkflowRoutingDecision>([
  'switched_to_economical',
  'continued_premium',
  'economical_default',
  'explicit_premium',
  'not_applicable',
  'unknown',
]);
const GATE_DECISIONS = new Set<WorkflowGateDecision>([
  'approved',
  'approved_with_conditions',
  'blocked',
  'skipped',
  'not_applicable',
  'unknown',
]);
const REVIEW_SOURCES = new Set<WorkflowReviewSource>([
  'independent_subagent',
  'parent_structured',
  'local',
  'not_applicable',
  'unknown',
]);
const COMMIT_STATES = new Set<WorkflowCommitStatus>([
  'completed',
  'not_applicable',
  'pending',
  'unknown',
]);
const HANDOFF_STATES = new Set<WorkflowHandoffStatus>(['completed', 'pending', 'unknown']);
const SWITCH_TIMINGS = new Set<WorkflowSwitchTiming>([
  'before_substantive_implementation',
  'after_plan_approval',
  'not_applicable',
]);

const REQUIRED_HEADINGS = [
  '## Classification',
  '## Recommended build model',
  '## Architecture gate',
  '## Implementation contract',
  '## Required tests',
  '## Final review',
  '## Commit and handoff',
];

export interface ParsedPlanContract {
  status: 'present' | 'missing' | 'malformed';
  contract: WorkflowPlanContract | null;
  errors: string[];
  raw?: string;
}

export interface PlanPathResolution {
  status: 'ok' | 'rejected';
  absolutePath: string | null;
  source: 'repo_relative' | 'external_hashed' | 'unavailable';
  pathRef: string | null;
  errors: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseOptionalStringArray(
  value: unknown,
  fieldName: string
): { values: string[] | undefined; errors: string[] } {
  if (value === undefined) return { values: undefined, errors: [] };
  if (!Array.isArray(value)) {
    return { values: undefined, errors: [`${fieldName} must be an array when provided`] };
  }
  const values = value.map(asString).filter((entry): entry is string => Boolean(entry));
  if (values.length !== value.length) {
    return {
      values: undefined,
      errors: [`${fieldName} must contain only non-empty strings`],
    };
  }
  return { values: [...new Set(values)], errors: [] };
}

export function createWorkflowWorkstreamId(prefix = 'ws'): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function parseRequiredTests(value: unknown): { tests: WorkflowRequiredTest[]; errors: string[] } {
  if (!Array.isArray(value)) return { tests: [], errors: ['requiredTests must be an array'] };
  const tests: WorkflowRequiredTest[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      errors.push(`requiredTests[${index}] must be an object`);
      continue;
    }
    const id = asString(entry.id);
    const status = asString(entry.status);
    if (!id || (status !== 'completed' && status !== 'unresolved')) {
      errors.push(`requiredTests[${index}] requires id and status completed|unresolved`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`requiredTests[${index}] duplicates id ${id}`);
      continue;
    }
    ids.add(id);
    tests.push({ id, status, note: asString(entry.note) ?? undefined });
  }
  return { tests, errors };
}

function parseUnresolvedRisks(value: unknown): {
  risks: WorkflowUnresolvedRisk[];
  errors: string[];
} {
  if (value === undefined) return { risks: [], errors: [] };
  if (!Array.isArray(value)) return { risks: [], errors: ['unresolvedRisks must be an array'] };
  const risks: WorkflowUnresolvedRisk[] = [];
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      errors.push(`unresolvedRisks[${index}] must be an object`);
      continue;
    }
    const id = asString(entry.id);
    const note = asString(entry.note);
    if (!id || !note) {
      errors.push(`unresolvedRisks[${index}] requires id and note`);
      continue;
    }
    risks.push({ id, note });
  }
  return { risks, errors };
}

function parseRecommendedBuildModel(value: unknown): {
  model: WorkflowRecommendedBuildModel | null;
  errors: string[];
} {
  if (!isObject(value)) {
    return { model: null, errors: ['recommendedBuildModel must be an object'] };
  }
  const errors: string[] = [];
  const implementation = isObject(value.implementation) ? value.implementation : null;
  const implRole = implementation ? asString(implementation.role) : null;
  const implTier = implementation
    ? (asString(implementation.tier) as WorkflowParentTier | null)
    : null;
  const implFamily = implementation ? asString(implementation.family) : null;
  if (!implRole || !getWorkflowModelRole(implRole)) {
    errors.push('recommendedBuildModel.implementation.role must be a known registry role');
  }
  if (!implTier || !PARENT_TIERS.has(implTier)) {
    errors.push('recommendedBuildModel.implementation.tier is invalid');
  } else if (implRole) {
    const role = getWorkflowModelRole(implRole);
    if (role && role.tier !== implTier && implTier !== 'unknown') {
      errors.push(
        `recommendedBuildModel.implementation.tier ${implTier} conflicts with role ${implRole}`
      );
    }
  }

  if (!Array.isArray(value.premiumGates)) {
    errors.push('recommendedBuildModel.premiumGates must be an array');
  }
  const premiumGates: WorkflowRecommendedBuildModel['premiumGates'] = [];
  if (Array.isArray(value.premiumGates)) {
    for (const [index, gate] of value.premiumGates.entries()) {
      if (!isObject(gate)) {
        errors.push(`recommendedBuildModel.premiumGates[${index}] must be an object`);
        continue;
      }
      const phase = asString(gate.phase);
      const role = asString(gate.role);
      const tier = asString(gate.tier) as WorkflowParentTier | null;
      const mandatory = asBoolean(gate.mandatory);
      if (!phase || !role || !tier || !PARENT_TIERS.has(tier) || mandatory === null) {
        errors.push(
          `recommendedBuildModel.premiumGates[${index}] requires phase, role, tier, mandatory`
        );
        continue;
      }
      if (!getWorkflowModelRole(role)) {
        errors.push(`recommendedBuildModel.premiumGates[${index}].role is unknown: ${role}`);
        continue;
      }
      premiumGates.push({ phase, role, tier, mandatory });
    }
  }

  const switchTiming = asString(value.switchTiming) as WorkflowSwitchTiming | null;
  const rationale = asString(value.rationale);
  const fallbackEscalation = asString(value.fallbackEscalation);
  if (!switchTiming || !SWITCH_TIMINGS.has(switchTiming)) {
    errors.push('recommendedBuildModel.switchTiming is invalid');
  }
  if (!rationale) errors.push('recommendedBuildModel.rationale is required');
  if (!fallbackEscalation) errors.push('recommendedBuildModel.fallbackEscalation is required');

  if (errors.length > 0 || !implRole || !implTier || !switchTiming || !rationale || !fallbackEscalation) {
    return { model: null, errors };
  }

  return {
    model: {
      implementation: {
        role: implRole,
        tier: implTier,
        family: implFamily ?? undefined,
      },
      premiumGates,
      switchTiming,
      rationale,
      fallbackEscalation,
    },
    errors: [],
  };
}

export function validatePlanContractObject(value: unknown): ParsedPlanContract {
  if (!isObject(value)) {
    return { status: 'malformed', contract: null, errors: ['plan contract must be a JSON object'] };
  }

  const errors: string[] = [];
  const schemaVersion = asString(value.schemaVersion);
  const registryVersion = asString(value.registryVersion);
  const workstreamId = asString(value.workstreamId);
  const sourceWorkstreamIds = parseOptionalStringArray(
    value.sourceWorkstreamIds,
    'sourceWorkstreamIds'
  );
  const taskId = asString(value.taskId);
  const taskType = asString(value.taskType) as WorkflowTaskType | null;
  const risk = asString(value.risk) as WorkflowRisk | null;
  const initialParentTier = asString(value.initialParentTier) as WorkflowParentTier | null;
  const routingDecision = asString(value.routingDecision) as WorkflowRoutingDecision | null;
  const architectureGate = asString(value.architectureGate) as WorkflowGateDecision | null;
  const architectureReviewSource = asString(
    value.architectureReviewSource
  ) as WorkflowReviewSource | null;
  const independentReviewRequired = asBoolean(value.independentReviewRequired);
  const finalReviewRequired = asBoolean(value.finalReviewRequired);
  const finalReviewSource = asString(value.finalReviewSource) as WorkflowReviewSource | null;
  const commit = asString(value.commit) as WorkflowCommitStatus | null;
  const handoff = asString(value.handoff) as WorkflowHandoffStatus | null;

  if (schemaVersion !== '1') errors.push('schemaVersion must be "1"');
  if (!registryVersion) errors.push('registryVersion is required');
  if (!workstreamId) errors.push('workstreamId is required');
  errors.push(...sourceWorkstreamIds.errors);
  if (!taskId) errors.push('taskId is required');
  if (!taskType || !TASK_TYPES.has(taskType)) errors.push('taskType must be change|planning|review');
  if (!risk || !RISKS.has(risk)) errors.push('risk must be high|routine');
  if (!initialParentTier || !PARENT_TIERS.has(initialParentTier)) {
    errors.push('initialParentTier is invalid');
  }
  if (!routingDecision || !ROUTING_DECISIONS.has(routingDecision)) {
    errors.push('routingDecision is invalid');
  }
  if (!architectureGate || !GATE_DECISIONS.has(architectureGate)) {
    errors.push('architectureGate is invalid');
  }
  if (!architectureReviewSource || !REVIEW_SOURCES.has(architectureReviewSource)) {
    errors.push('architectureReviewSource is invalid');
  }
  if (independentReviewRequired === null) {
    errors.push('independentReviewRequired must be boolean');
  }
  if (finalReviewRequired === null) {
    errors.push('finalReviewRequired must be boolean');
  }
  if (!finalReviewSource || !REVIEW_SOURCES.has(finalReviewSource)) {
    errors.push('finalReviewSource is invalid');
  }
  if (!commit || !COMMIT_STATES.has(commit)) errors.push('commit is invalid');
  if (!handoff || !HANDOFF_STATES.has(handoff)) errors.push('handoff is invalid');

  const independentReviewReasons = Array.isArray(value.independentReviewReasons)
    ? value.independentReviewReasons
        .map(asString)
        .filter((reason): reason is string => Boolean(reason))
    : [];
  if (!Array.isArray(value.independentReviewReasons)) {
    errors.push('independentReviewReasons must be an array');
  }
  if (independentReviewRequired === true && independentReviewReasons.length === 0) {
    errors.push('independentReviewReasons is required when independentReviewRequired is true');
  }

  const recommended = parseRecommendedBuildModel(value.recommendedBuildModel);
  errors.push(...recommended.errors);
  const requiredTests = parseRequiredTests(value.requiredTests);
  const unresolvedRisks = parseUnresolvedRisks(value.unresolvedRisks);
  errors.push(...requiredTests.errors, ...unresolvedRisks.errors);

  if (risk === 'high' && requiredTests.tests.length === 0) {
    errors.push('high-risk plans require stable requiredTests IDs');
  }
  if (
    risk === 'high' &&
    recommended.model &&
    recommended.model.premiumGates.filter((gate) => gate.mandatory).length === 0
  ) {
    errors.push('high-risk plans require at least one mandatory premium gate');
  }
  if (
    recommended.model &&
    recommended.model.implementation.tier === 'economical' &&
    recommended.model.switchTiming === 'not_applicable' &&
    initialParentTier === 'premium'
  ) {
    errors.push(
      'switchTiming cannot be not_applicable when premium parent should switch to economical implementation'
    );
  }

  let implementationContract: WorkflowPlanContract['implementationContract'];
  if (value.implementationContract !== undefined) {
    if (!isObject(value.implementationContract)) {
      errors.push('implementationContract must be an object when provided');
    } else {
      const invariants = Array.isArray(value.implementationContract.invariants)
        ? value.implementationContract.invariants
            .map(asString)
            .filter((entry): entry is string => Boolean(entry))
        : undefined;
      const boundaries = Array.isArray(value.implementationContract.boundaries)
        ? value.implementationContract.boundaries
            .map(asString)
            .filter((entry): entry is string => Boolean(entry))
        : undefined;
      const rollback = asString(value.implementationContract.rollback) ?? undefined;
      implementationContract = { invariants, boundaries, rollback };
    }
  }

  if (risk === 'high') {
    const invariants = implementationContract?.invariants ?? [];
    const boundaries = implementationContract?.boundaries ?? [];
    const rollback = implementationContract?.rollback?.trim() ?? '';
    if (invariants.length === 0 || boundaries.length === 0 || !rollback) {
      errors.push(
        'high-risk plans require implementationContract.invariants, boundaries, and rollback'
      );
    }
  }

  if (errors.length > 0 || !recommended.model) {
    return { status: 'malformed', contract: null, errors };
  }

  return {
    status: 'present',
    contract: {
      schemaVersion: '1',
      registryVersion: registryVersion!,
      workstreamId: workstreamId!,
      sourceWorkstreamIds: sourceWorkstreamIds.values,
      taskId: taskId!,
      taskType: taskType!,
      risk: risk!,
      initialParentTier: initialParentTier!,
      routingDecision: routingDecision!,
      recommendedBuildModel: recommended.model,
      architectureGate: architectureGate!,
      architectureReviewSource: architectureReviewSource!,
      independentReviewRequired: independentReviewRequired!,
      independentReviewReasons,
      requiredTests: requiredTests.tests,
      unresolvedRisks: unresolvedRisks.risks,
      finalReviewRequired: finalReviewRequired!,
      finalReviewSource: finalReviewSource!,
      commit: commit!,
      handoff: handoff!,
      implementationContract,
      reviewClosureProtocol:
        asString(value.reviewClosureProtocol) === 'two-pass-v1' ? 'two-pass-v1' : undefined,
    },
    errors: [],
  };
}

export function extractPlanContractMarker(text: string): ParsedPlanContract {
  const start = text.lastIndexOf(PLAN_CONTRACT_MARKER_PREFIX);
  if (start < 0) {
    return { status: 'missing', contract: null, errors: ['plan-contract-marker:v1 not found'] };
  }
  const afterPrefix = text.slice(start + PLAN_CONTRACT_MARKER_PREFIX.length);
  const end = afterPrefix.indexOf(PLAN_CONTRACT_MARKER_SUFFIX);
  if (end < 0) {
    return { status: 'malformed', contract: null, errors: ['plan-contract-marker is not closed'] };
  }
  const raw = afterPrefix.slice(0, end).trim();
  try {
    const parsed = validatePlanContractObject(JSON.parse(raw));
    return { ...parsed, raw };
  } catch (error) {
    return {
      status: 'malformed',
      contract: null,
      errors: [error instanceof Error ? error.message : 'plan contract JSON parse failed'],
      raw,
    };
  }
}

export function renderPlanContractMarker(contract: WorkflowPlanContract): string {
  return `${PLAN_CONTRACT_MARKER_PREFIX}\n${JSON.stringify(contract, null, 2)}\n${PLAN_CONTRACT_MARKER_SUFFIX}`;
}

export function hasRequiredPlanHeadings(planMarkdown: string): string[] {
  const normalized = planMarkdown.replace(/\r\n/g, '\n');
  return REQUIRED_HEADINGS.filter((heading) => {
    const pattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im');
    return !pattern.test(normalized);
  });
}

export function humanMachineContradictionErrors(
  planMarkdown: string,
  contract: WorkflowPlanContract
): string[] {
  const errors: string[] = [];
  const humanMarkdown = planMarkdown.replace(
    /<!--\s*plan-contract-marker:v1[\s\S]*?-->/giu,
    ''
  );
  const section = (heading: string): string => {
    const match = humanMarkdown.match(
      new RegExp(
        `^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`,
        'imu'
      )
    );
    return match?.[1] ?? '';
  };
  const classification = section('Classification');
  const recommended = section('Recommended build model');
  const requiredTests = section('Required tests');
  const implRole = contract.recommendedBuildModel.implementation.role;
  const role = getWorkflowModelRole(implRole);
  if (role && !recommended.toLowerCase().includes(role.displayName.toLowerCase().split(' ')[0]!)) {
    // Soft check: require at least the family keyword in the human section.
    const familyToken = role.family.split('-')[0]!;
    if (!recommended.toLowerCase().includes(familyToken)) {
      errors.push(
        `human Recommended build model section should mention family/display for role ${implRole}`
      );
    }
  }
  const statedRisk =
    classification.match(/\brisk\s*[:=-]?\s*(high|routine)\b/iu)?.[1]?.toLowerCase() ??
    classification.match(/\b(high|routine)[ -]risk\b/iu)?.[1]?.toLowerCase();
  if (statedRisk && statedRisk !== contract.risk) {
    errors.push(`human risk ${statedRisk} contradicts machine risk ${contract.risk}`);
  }

  const statedRouting = classification.match(
    /\broutingDecision\s*:\s*([a-z_]+)\b/iu
  )?.[1];
  if (statedRouting && statedRouting !== contract.routingDecision) {
    errors.push(
      `human routingDecision ${statedRouting} contradicts machine routingDecision ${contract.routingDecision}`
    );
  }
  const statedImplementationTier =
    recommended.match(/\bimplementation\s*:\s*[^.\n]*(economical|premium)\b/iu)?.[1]?.toLowerCase() ??
    recommended.match(/\b(economical|premium)\s+implementation\b/iu)?.[1]?.toLowerCase();
  const machineImplementationTier = contract.recommendedBuildModel.implementation.tier;
  if (
    statedImplementationTier &&
    machineImplementationTier !== 'unknown' &&
    statedImplementationTier !== machineImplementationTier
  ) {
    errors.push(
      `human implementation tier ${statedImplementationTier} contradicts machine implementation tier ${machineImplementationTier}`
    );
  }
  for (const test of contract.requiredTests) {
    if (!requiredTests.includes(test.id)) {
      errors.push(`human Required tests section is missing machine test ID ${test.id}`);
    }
  }
  if (
    contract.risk === 'high' &&
    !/architecture gate|architecture-gate/i.test(humanMarkdown)
  ) {
    errors.push('human Architecture gate section is missing expected architecture wording');
  }
  return errors;
}

function candidateHasTraversalSegment(candidatePath: string): boolean {
  const normalized = candidatePath.replace(/\\/g, '/');
  return normalized.split('/').some((segment) => segment === '..');
}

/** Reject leaf or intermediate symlink components before trusting realpath. */
export function pathHasSymlinkComponent(absolutePath: string): boolean {
  const normalized = path.normalize(absolutePath);
  const { root } = path.parse(normalized);
  const relative = path.relative(root, normalized);
  if (!relative) return false;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function resolvePlanPath(params: {
  candidatePath: string;
  repoRoot: string;
  approvedRoots?: string[];
}): PlanPathResolution {
  const repoRoot = path.resolve(params.repoRoot);
  const approvedRoots = (params.approvedRoots ?? [repoRoot, path.join(repoRoot, 'plans')]).map(
    (root) => path.resolve(root)
  );
  const candidateIsAbsolute = path.isAbsolute(params.candidatePath);

  // Relative traversal must never be reinterpreted as an external hashed plan.
  if (!candidateIsAbsolute && candidateHasTraversalSegment(params.candidatePath)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['plan path traversal is not allowed'],
    };
  }

  let absolute: string;
  try {
    absolute = candidateIsAbsolute
      ? path.normalize(params.candidatePath)
      : path.resolve(repoRoot, params.candidatePath);
  } catch {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['unable to resolve candidate path'],
    };
  }

  if (!existsSync(absolute)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['plan path does not exist'],
    };
  }

  if (pathHasSymlinkComponent(absolute)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['symbolic links are not allowed for plan paths'],
    };
  }

  let realPath: string;
  try {
    realPath = realpathSync(absolute);
  } catch {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['unable to realpath plan candidate'],
    };
  }

  if (pathHasSymlinkComponent(realPath)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['symbolic links are not allowed for plan paths'],
    };
  }

  const underApproved = approvedRoots.some(
    (root) => realPath === root || realPath.startsWith(root + path.sep)
  );
  const underRepo = realPath === repoRoot || realPath.startsWith(repoRoot + path.sep);

  if (!underApproved && !underRepo) {
    // Absolute external Cursor plan paths may be hashed; relative escapes already rejected.
    if (!candidateIsAbsolute) {
      return {
        status: 'rejected',
        absolutePath: null,
        source: 'unavailable',
        pathRef: null,
        errors: ['plan path escapes approved roots'],
      };
    }
    try {
      const size = statSync(realPath).size;
      if (size > PLAN_CONTRACT_MAX_BYTES) {
        return {
          status: 'rejected',
          absolutePath: null,
          source: 'unavailable',
          pathRef: null,
          errors: [`plan exceeds ${PLAN_CONTRACT_MAX_BYTES} bytes`],
        };
      }
    } catch {
      return {
        status: 'rejected',
        absolutePath: null,
        source: 'unavailable',
        pathRef: null,
        errors: ['unable to read external plan size'],
      };
    }
    return {
      status: 'ok',
      absolutePath: realPath,
      source: 'external_hashed',
      pathRef: hashIdentifier(realPath),
      errors: [],
    };
  }

  try {
    const size = statSync(realPath).size;
    if (size > PLAN_CONTRACT_MAX_BYTES) {
      return {
        status: 'rejected',
        absolutePath: null,
        source: 'unavailable',
        pathRef: null,
        errors: [`plan exceeds ${PLAN_CONTRACT_MAX_BYTES} bytes`],
      };
    }
  } catch {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['unable to read plan size'],
    };
  }

  return {
    status: 'ok',
    absolutePath: realPath,
    source: 'repo_relative',
    pathRef: path.relative(repoRoot, realPath).split(path.sep).join('/'),
    errors: [],
  };
}

export function validatePlanMarkdown(
  planMarkdown: string,
  options?: { enforceHeadings?: boolean; expectRegistryVersion?: string }
): ParsedPlanContract & { headingErrors: string[]; contradictionErrors: string[] } {
  const extracted = extractPlanContractMarker(planMarkdown);
  const headingErrors =
    options?.enforceHeadings === false ? [] : hasRequiredPlanHeadings(planMarkdown);
  const contradictionErrors =
    extracted.contract && options?.enforceHeadings !== false
      ? humanMachineContradictionErrors(planMarkdown, extracted.contract)
      : [];
  const errors = [...extracted.errors];
  if (headingErrors.length > 0) {
    errors.push(`missing required headings: ${headingErrors.join(', ')}`);
  }
  errors.push(...contradictionErrors);
  if (
    extracted.contract &&
    options?.expectRegistryVersion &&
    extracted.contract.registryVersion !== options.expectRegistryVersion
  ) {
    errors.push(
      `registryVersion ${extracted.contract.registryVersion} differs from current ${options.expectRegistryVersion}`
    );
  }

  if (extracted.status === 'missing') {
    return { ...extracted, headingErrors, contradictionErrors, errors };
  }
  if (errors.length > 0) {
    return {
      status: 'malformed',
      contract: extracted.contract,
      errors,
      raw: extracted.raw,
      headingErrors,
      contradictionErrors,
    };
  }
  return { ...extracted, headingErrors, contradictionErrors, errors: [] };
}

export function validatePlanFile(params: {
  candidatePath: string;
  repoRoot: string;
  approvedRoots?: string[];
  enforceHeadings?: boolean;
}): ParsedPlanContract & {
  pathResolution: PlanPathResolution;
  headingErrors: string[];
  contradictionErrors: string[];
} {
  const pathResolution = resolvePlanPath({
    candidatePath: params.candidatePath,
    repoRoot: params.repoRoot,
    approvedRoots: params.approvedRoots,
  });
  if (pathResolution.status === 'rejected' || !pathResolution.absolutePath) {
    return {
      status: 'malformed',
      contract: null,
      errors: pathResolution.errors,
      pathResolution,
      headingErrors: [],
      contradictionErrors: [],
    };
  }
  const markdown = readFileSync(pathResolution.absolutePath, 'utf8');
  const validated = validatePlanMarkdown(markdown, {
    enforceHeadings: params.enforceHeadings,
    expectRegistryVersion: WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
  });
  return { ...validated, pathResolution };
}

export function createDefaultPlanContract(params: {
  workstreamId?: string;
  sourceWorkstreamIds?: string[];
  taskId: string;
  taskType: WorkflowTaskType;
  risk: WorkflowRisk;
  initialParentTier?: WorkflowParentTier;
  routingDecision?: WorkflowRoutingDecision;
  rationale: string;
  fallbackEscalation: string;
  requiredTests: WorkflowRequiredTest[];
  independentReviewReasons?: string[];
}): WorkflowPlanContract {
  const highRisk = params.risk === 'high';
  return {
    schemaVersion: '1',
    registryVersion: WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
    workstreamId: params.workstreamId ?? createWorkflowWorkstreamId(),
    sourceWorkstreamIds: params.sourceWorkstreamIds
      ? [...new Set(params.sourceWorkstreamIds.filter((id) => id.trim()))]
      : undefined,
    taskId: params.taskId,
    taskType: params.taskType,
    risk: params.risk,
    initialParentTier: params.initialParentTier ?? 'unknown',
    routingDecision: params.routingDecision ?? 'unknown',
    recommendedBuildModel: {
      implementation: {
        role: 'economical-default',
        tier: 'economical',
        family: 'cursor-grok',
      },
      premiumGates: highRisk
        ? [
            {
              phase: 'architecture-gate',
              role: 'premium-architecture-gate',
              tier: 'premium',
              mandatory: true,
            },
            {
              phase: 'final-diff-reviewer',
              role: 'premium-final-review',
              tier: 'premium',
              mandatory: true,
            },
          ]
        : [],
      switchTiming: 'after_plan_approval',
      rationale: params.rationale,
      fallbackEscalation: params.fallbackEscalation,
    },
    architectureGate: highRisk ? 'approved_with_conditions' : 'skipped',
    architectureReviewSource: highRisk ? 'independent_subagent' : 'not_applicable',
    independentReviewRequired: highRisk,
    independentReviewReasons: params.independentReviewReasons ?? (highRisk ? ['user-request'] : []),
    requiredTests: params.requiredTests,
    unresolvedRisks: [],
    finalReviewRequired: highRisk,
    finalReviewSource: highRisk ? 'independent_subagent' : 'local',
    commit: params.taskType === 'change' ? 'pending' : 'not_applicable',
    handoff: 'pending',
    reviewClosureProtocol: highRisk ? 'two-pass-v1' : undefined,
    implementationContract: highRisk
      ? {
          invariants: [
            'Preserve fail-open stop-hook topology and mixed-version readers.',
            'Persist hashes, opaque IDs, and derived evidence only.',
            'Bound premium final review to two-pass-v1 with consolidated fix routing after two failures.',
          ],
          boundaries: [
            'Do not rewrite immutable workflow events.',
            'Do not change user-facing finalise command phrases.',
            'Do not launch a third premium review without routing or split.',
          ],
          rollback:
            'Revert new writers/rules or switch plan validation to observation-only; keep mixed-version readers accepting already-written records.',
        }
      : {
          invariants: ['Follow the approved automation suggestion scope.'],
          boundaries: ['Do not expand into unrelated workflow architecture.'],
          rollback: 'Revert the automation upgrade commit if verification fails.',
        },
  };
}

export function fingerprintPlanContract(contract: WorkflowPlanContract): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex').slice(0, 16);
}
