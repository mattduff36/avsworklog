import { describe, expect, it } from 'vitest';
import {
  calculateNextDueMeter,
  compactServiceLabel,
  getSuccessorStep,
  resolveStepForTemplateAfter,
  resolveStepForTemplateFirst,
  shouldShowServiceTypeBadge,
  type ServiceRotationStep,
} from '@/lib/utils/assetServiceRotation';

const HGV_STEPS: ServiceRotationStep[] = [
  { id: 's1', position: 1, attachmentTemplateId: 'basic-a', compactLabel: 'Basic A', templateName: 'Basic Service A (HGV)' },
  { id: 's2', position: 2, attachmentTemplateId: 'basic-b', compactLabel: 'Basic B', templateName: 'Basic Service B (HGV)' },
  { id: 's3', position: 3, attachmentTemplateId: 'basic-a', compactLabel: 'Basic A', templateName: 'Basic Service A (HGV)' },
  { id: 's4', position: 4, attachmentTemplateId: 'full', compactLabel: 'Full', templateName: 'Full Service (HGV)' },
];

describe('SVC-ROT-001 HGV rotation order', () => {
  it('advances A1 → B → A2 → Full → A1', () => {
    expect(getSuccessorStep(HGV_STEPS, 's1')?.id).toBe('s2');
    expect(getSuccessorStep(HGV_STEPS, 's2')?.id).toBe('s3');
    expect(getSuccessorStep(HGV_STEPS, 's3')?.id).toBe('s4');
    expect(getSuccessorStep(HGV_STEPS, 's4')?.id).toBe('s1');
  });
});

describe('SVC-ROT-002 duplicate Basic A resolution', () => {
  it('picks the first Basic A for asset creation', () => {
    expect(resolveStepForTemplateFirst(HGV_STEPS, 'basic-a')?.id).toBe('s1');
  });

  it('picks the next Basic A after Basic B', () => {
    expect(resolveStepForTemplateAfter(HGV_STEPS, 'basic-a', 's2')?.id).toBe('s3');
  });

  it('wraps to the first Basic A after Full', () => {
    expect(resolveStepForTemplateAfter(HGV_STEPS, 'basic-a', 's4')?.id).toBe('s1');
  });
});

describe('SVC-COMPLETE-002 due meter calculation', () => {
  it('uses actual completion meter plus interval', () => {
    expect(calculateNextDueMeter(275402, 25000)).toBe(300402);
    expect(calculateNextDueMeter(0, 10000)).toBe(10000);
  });

  it('rejects invalid meters or intervals', () => {
    expect(() => calculateNextDueMeter(-1, 25000)).toThrow();
    expect(() => calculateNextDueMeter(100, 0)).toThrow();
  });
});

describe('SVC-UI-001 service type badge visibility', () => {
  it('shows badge only when 2+ distinct linked templates exist', () => {
    expect(shouldShowServiceTypeBadge(1)).toBe(false);
    expect(shouldShowServiceTypeBadge(2)).toBe(true);
    expect(shouldShowServiceTypeBadge(3)).toBe(true);
  });

  it('compacts known HGV labels', () => {
    expect(compactServiceLabel(null, 'Basic Service A (HGV)')).toBe('Basic A');
    expect(compactServiceLabel(null, 'Basic Service B (HGV)')).toBe('Basic B');
    expect(compactServiceLabel(null, 'Full Service (HGV)')).toBe('Full');
    expect(compactServiceLabel('Basic A', 'Basic Service A (HGV)')).toBe('Basic A');
  });
});
