import type {
  InventoryCheckStatus,
  InventoryLocation,
  InventoryLocationType,
} from '@/app/(dashboard)/inventory/types';

export type YardKioskDirection = 'take' | 'return';

export interface YardKioskCategory {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
}

export interface YardKioskLocation extends Pick<
  InventoryLocation,
  | 'id'
  | 'name'
  | 'description'
  | 'location_type'
  | 'source_type'
  | 'external_reference'
  | 'linked_asset_label'
  | 'linked_asset_nickname'
> {
  location_type: InventoryLocationType;
}

export interface YardKioskSerializedStockItem {
  kind: 'serialized';
  id: string;
  item_number: string;
  name: string;
  category: string;
  check_status: InventoryCheckStatus;
  is_check_blocked: boolean;
}

export interface YardKioskHardwareStockItem {
  kind: 'hardware';
  id: string;
  name: string;
  category: 'hardware';
  available_quantity: number;
}

export type YardKioskStockItem =
  | YardKioskSerializedStockItem
  | YardKioskHardwareStockItem;

export interface YardKioskBlockedItem {
  id: string;
  item_number: string;
  name: string;
  check_status: InventoryCheckStatus;
}

export interface YardKioskBootstrapResponse {
  configured: true;
  yard: YardKioskLocation;
  locations: YardKioskLocation[];
  categories: YardKioskCategory[];
}

export interface YardKioskSerializedBasketLine {
  kind: 'serialized';
  item_id: string;
  item_number: string;
  name: string;
  category: string;
}

export interface YardKioskHardwareBasketLine {
  kind: 'hardware';
  item_id: string;
  name: string;
  quantity: number;
  available_quantity: number;
}

export type YardKioskBasketLine =
  | YardKioskSerializedBasketLine
  | YardKioskHardwareBasketLine;

export interface YardKioskSubmitPayload {
  direction: YardKioskDirection;
  counterpart_location_id: string;
  serialized_item_ids: string[];
  hardware_lines: Array<{
    item_id: string;
    quantity: number;
  }>;
  note?: string;
}

export interface YardKioskReceipt {
  kiosk_batch_id: string;
  movement_batch_id: string | null;
  hardware_batch_id: string | null;
  serialized_count: number;
  hardware_line_count: number;
}
