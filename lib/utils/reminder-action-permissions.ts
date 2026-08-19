import {
  INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
  PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY,
} from '@/lib/config/reminder-workflows';
import type { ModuleName } from '@/types/roles';

export function getReminderActionRequiredModule(assetType: string | null | undefined): ModuleName {
  if (assetType === 'van') return 'inspections';
  if (assetType === 'plant') return 'plant-inspections';
  if (assetType === 'hgv') return 'hgv-inspections';
  return 'reminders';
}

export function canIgnoreReminderAction(workflowKey: string | null | undefined): boolean {
  return workflowKey !== PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY
    && workflowKey !== INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY;
}
