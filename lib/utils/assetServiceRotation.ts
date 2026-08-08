/**
 * Pure helpers for unified asset service rotation.
 * Service types are attachment templates linked to workshop Service categories.
 */

export type ServiceMeterUnit = 'miles' | 'km' | 'hours';
export type ServiceAssetType = 'van' | 'hgv' | 'plant';

export interface ServiceRotationStep {
  id: string;
  position: number;
  attachmentTemplateId: string;
  compactLabel?: string | null;
  templateName?: string | null;
}

export interface ServiceConfig {
  maintenanceCategoryId: string;
  configKey: 'service_van' | 'service_hgv' | 'service_plant';
  intervalValue: number;
  intervalUnit: ServiceMeterUnit;
  workshopCategoryId: string | null;
  steps: ServiceRotationStep[];
}

export function getServiceConfigKey(assetType: ServiceAssetType): ServiceConfig['configKey'] {
  if (assetType === 'hgv') return 'service_hgv';
  if (assetType === 'plant') return 'service_plant';
  return 'service_van';
}

export function getDefaultMeterUnit(assetType: ServiceAssetType): ServiceMeterUnit {
  if (assetType === 'hgv') return 'km';
  if (assetType === 'plant') return 'hours';
  return 'miles';
}

/** Next due = actual completion meter + configured interval. */
export function calculateNextDueMeter(completionMeter: number, intervalValue: number): number {
  if (!Number.isFinite(completionMeter) || completionMeter < 0) {
    throw new Error('Completion meter must be a non-negative number');
  }
  if (!Number.isFinite(intervalValue) || intervalValue <= 0) {
    throw new Error('Interval must be a positive number');
  }
  return Math.trunc(completionMeter) + Math.trunc(intervalValue);
}

/**
 * Resolve the successor step after a completed step.
 * Steps are ordered by position and wrap around.
 */
export function getSuccessorStep(
  steps: readonly ServiceRotationStep[],
  completedStepId: string | null | undefined,
): ServiceRotationStep | null {
  if (steps.length === 0) return null;
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  if (!completedStepId) return ordered[0] ?? null;
  const index = ordered.findIndex((step) => step.id === completedStepId);
  if (index < 0) return ordered[0] ?? null;
  return ordered[(index + 1) % ordered.length] ?? null;
}

/**
 * When creating an asset or manually selecting a template that appears more than once,
 * pick the first matching rotation occurrence.
 */
export function resolveStepForTemplateFirst(
  steps: readonly ServiceRotationStep[],
  templateId: string,
): ServiceRotationStep | null {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  return ordered.find((step) => step.attachmentTemplateId === templateId) ?? null;
}

/**
 * When overriding after a completed step, pick the next matching occurrence
 * after that step (wrapping), falling back to the first match.
 */
export function resolveStepForTemplateAfter(
  steps: readonly ServiceRotationStep[],
  templateId: string,
  afterStepId: string | null | undefined,
): ServiceRotationStep | null {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return null;

  if (!afterStepId) {
    return resolveStepForTemplateFirst(ordered, templateId);
  }

  const afterIndex = ordered.findIndex((step) => step.id === afterStepId);
  if (afterIndex < 0) {
    return resolveStepForTemplateFirst(ordered, templateId);
  }

  for (let offset = 1; offset <= ordered.length; offset += 1) {
    const candidate = ordered[(afterIndex + offset) % ordered.length];
    if (candidate.attachmentTemplateId === templateId) {
      return candidate;
    }
  }

  return null;
}

export function shouldShowServiceTypeBadge(distinctLinkedTemplateCount: number): boolean {
  return distinctLinkedTemplateCount >= 2;
}

export function compactServiceLabel(
  label: string | null | undefined,
  templateName: string | null | undefined,
): string {
  if (label && label.trim()) return label.trim();
  if (!templateName) return 'Service';

  const name = templateName.trim();
  if (/full service/i.test(name)) return 'Full';
  if (/basic service a/i.test(name)) return 'Basic A';
  if (/basic service b/i.test(name)) return 'Basic B';
  if (/basic service/i.test(name)) return 'Basic';
  return name
    .replace(/\s*\((HGV|Van|Plant)\)\s*$/i, '')
    .replace(/\s*Service\s*/i, ' ')
    .trim() || name;
}
