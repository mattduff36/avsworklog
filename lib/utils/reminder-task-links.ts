import type { ReminderAssetType } from '@/types/reminders';

export interface ReminderTaskLink {
  href: string;
  label: string;
}

const TASK_LINKS_BY_ASSET_TYPE: Record<ReminderAssetType, ReminderTaskLink> = {
  van: {
    href: '/van-inspections/new',
    label: 'Start van daily check',
  },
  plant: {
    href: '/plant-inspections/new',
    label: 'Start plant daily check',
  },
  hgv: {
    href: '/hgv-inspections/new',
    label: 'Start HGV daily check',
  },
};

export function getReminderTaskLink(assetType: ReminderAssetType | null | undefined): ReminderTaskLink | null {
  if (!assetType) return null;

  return TASK_LINKS_BY_ASSET_TYPE[assetType] || null;
}

export function getReminderTaskName(assetType: ReminderAssetType | null | undefined): string {
  if (assetType === 'van') return 'van daily check';
  if (assetType === 'plant') return 'plant daily check';
  if (assetType === 'hgv') return 'HGV daily check';

  return 'assigned task';
}
