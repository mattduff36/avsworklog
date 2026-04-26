export type InventoryCategory = 'hired_plant' | 'signs' | 'minor_plant' | 'tools' | 'equipment' | 'unknown';

export type InventoryStatus = 'active' | 'inactive';

export type InventoryCheckStatus = 'ok' | 'due_soon' | 'overdue' | 'needs_check';

export type FleetAssetLinkType = 'van' | 'hgv' | 'plant';

export interface InventoryLocation {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  linked_van_id: string | null;
  linked_hgv_id: string | null;
  linked_plant_id: string | null;
  item_count?: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface InventoryItem {
  id: string;
  item_number: string;
  item_number_normalized: string;
  name: string;
  category: InventoryCategory;
  location_id: string;
  location?: InventoryLocation | null;
  last_checked_at: string | null;
  status: InventoryStatus;
  source: string | null;
  source_reference: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface InventoryItemFormData {
  item_number: string;
  name: string;
  category: InventoryCategory;
  location_id: string;
  last_checked_at: string;
  status: InventoryStatus;
}

export interface InventoryLocationFormData {
  name: string;
  description: string;
  linked_asset_type: FleetAssetLinkType | 'none';
  linked_asset_id: string;
}

export interface FleetAssetOption {
  id: string;
  type: FleetAssetLinkType;
  label: string;
  description: string | null;
}

export interface InventoryMovePayload {
  location_id: string;
  note: string;
}

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
  hired_plant: 'Hired Plant',
  signs: 'Signs',
  minor_plant: 'Minor Plant',
  tools: 'Tools',
  equipment: 'Equipment',
  unknown: 'Unknown',
};

export const EMPTY_INVENTORY_ITEM_FORM: InventoryItemFormData = {
  item_number: '',
  name: '',
  category: 'minor_plant',
  location_id: '',
  last_checked_at: '',
  status: 'active',
};

export const EMPTY_INVENTORY_LOCATION_FORM: InventoryLocationFormData = {
  name: '',
  description: '',
  linked_asset_type: 'none',
  linked_asset_id: '',
};
