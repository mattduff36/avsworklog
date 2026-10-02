export interface InventoryItemDetailsUpdateInput {
  item_number: string;
  name: string;
  category: string;
  location_id: string;
  last_checked_at: string | null;
  check_interval_days: number | null;
  hasCheckHistory: boolean;
  serial_number?: string | null;
}

export function buildInventoryItemDetailsUpdatePayload(
  input: InventoryItemDetailsUpdateInput,
): Record<string, unknown> {
  return {
    item_number: input.item_number,
    name: input.name,
    category: input.category,
    location_id: input.location_id,
    ...(input.hasCheckHistory
      ? {}
      : { last_checked_at: input.last_checked_at }),
    check_interval_days: input.check_interval_days,
    ...(input.serial_number !== undefined ? { serial_number: input.serial_number } : {}),
  };
}
