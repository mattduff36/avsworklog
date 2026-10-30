import { describe, expect, it } from 'vitest';
import {
  fullInventoryRefreshPlan,
  inventoryAccessScopeChanged,
  inventoryRefreshPlanForMutation,
  mergeInventoryRefreshPlans,
  readInventoryAccessScope,
  type InventoryRefreshCollection,
  type InventoryRefreshPlan,
} from '@/lib/client/inventory-refresh-plan';

function collections(plan: InventoryRefreshPlan): InventoryRefreshCollection[] {
  return [...plan.collections].sort();
}

const accessContext = {
  user_id: 'manager-1',
  role_name: 'Manager',
  role_class: 'manager',
  team_id: 'team-1',
  team_name: 'Yard',
  is_manager_or_admin: true,
  can_manage_site_locations: true,
  user_location: { location_id: 'loc-1' },
};

describe('inventory refresh plan', () => {
  it('maps mutations to the collections their API reads actually depend on', () => {
    const locationLabels: InventoryRefreshCollection[] = ['groups', 'hardware', 'items', 'retired', 'siteAssignments'];
    expect(collections(inventoryRefreshPlanForMutation('hardware'))).toEqual(['hardware']);
    expect(collections(inventoryRefreshPlanForMutation('item_create'))).toEqual(['categories', ...locationLabels]);
    expect(collections(inventoryRefreshPlanForMutation('item_retire'))).toEqual(locationLabels);
    expect(collections(inventoryRefreshPlanForMutation('item_restore'))).toEqual(locationLabels);
    expect(collections(inventoryRefreshPlanForMutation('minor_plant_restore'))).toEqual([
      'fleet',
      'groups',
      'hardware',
      'items',
      'retired',
      'siteAssignments',
    ]);
    expect(collections(inventoryRefreshPlanForMutation('move'))).toEqual(locationLabels);
    expect(collections(inventoryRefreshPlanForMutation('group'))).toEqual(['groups', 'items', 'retired']);
    expect(collections(inventoryRefreshPlanForMutation('category'))).toEqual(['categories', 'items', 'retired']);
    expect(collections(inventoryRefreshPlanForMutation('user_location'))).toEqual(locationLabels);
    expect(collections(inventoryRefreshPlanForMutation('site_assignment'))).toEqual(locationLabels);
    expect(collections(inventoryRefreshPlanForMutation('location'))).toEqual([
      'groups',
      'hardware',
      'items',
      'retired',
      'siteAssignments',
    ]);
    expect(inventoryRefreshPlanForMutation('hardware').mode).toBe('targeted');
    expect(fullInventoryRefreshPlan().mode).toBe('full');
  });

  it('coalesces a queued targeted refresh into a full bundle', () => {
    const merged = mergeInventoryRefreshPlans(
      inventoryRefreshPlanForMutation('hardware'),
      fullInventoryRefreshPlan(),
    );
    expect(merged.mode).toBe('full');
    expect(merged.collections.has('items')).toBe(true);
    expect(merged.collections.has('hardware')).toBe(true);
  });

  it('treats actor, role, team and access flags as the scope boundary', () => {
    const scope = readInventoryAccessScope(accessContext);
    const movedContext = {
      ...accessContext,
      user_location: { location_id: 'somewhere-else' },
    };
    expect(inventoryAccessScopeChanged(scope, readInventoryAccessScope(movedContext))).toBe(false);
    expect(inventoryAccessScopeChanged(scope, readInventoryAccessScope({
      ...accessContext,
      team_id: 'team-2',
    }))).toBe(true);
    expect(inventoryAccessScopeChanged(scope, readInventoryAccessScope({
      ...accessContext,
      user_id: 'manager-2',
    }))).toBe(true);
    expect(inventoryAccessScopeChanged(scope, readInventoryAccessScope({
      ...accessContext,
      is_manager_or_admin: false,
    }))).toBe(true);
    expect(inventoryAccessScopeChanged(null, scope)).toBe(true);
  });
});
