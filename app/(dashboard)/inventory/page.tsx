'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { AlertTriangle, CheckCircle2, MapPin, PackageSearch, Plus, Settings, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { ChangeInventoryLocationDialog } from './components/ChangeInventoryLocationDialog';
import { InventoryCategoriesPanel } from './components/InventoryCategoriesPanel';
import { InventoryItemDialog } from './components/InventoryItemDialog';
import { InventoryEmployeeView } from './components/InventoryEmployeeView';
import { InventoryGroupsPanel } from './components/InventoryGroupsPanel';
import { InventoryLocationDialog } from './components/InventoryLocationDialog';
import { InventoryLocationsPanel } from './components/InventoryLocationsPanel';
import { InventoryTable } from './components/InventoryTable';
import { MoveInventoryDialog } from './components/MoveInventoryDialog';
import { checkIntervalMonthsToDays, getInventoryCheckStatus } from './utils';
import type {
  FleetAssetOption,
  InventoryContext,
  InventoryItemGroup,
  InventoryItem,
  InventoryItemCategory,
  InventoryItemCategoryFormData,
  InventoryItemFormData,
  InventoryLocation,
  InventoryLocationFormData,
  InventoryMovePayload,
} from './types';

export default function InventoryPage() {
  const { hasPermission: canViewInventory, loading: permissionLoading } = usePermissionCheck('inventory', false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [fleetAssets, setFleetAssets] = useState<FleetAssetOption[]>([]);
  const [inventoryContext, setInventoryContext] = useState<InventoryContext | null>(null);
  const [groups, setGroups] = useState<InventoryItemGroup[]>([]);
  const [categories, setCategories] = useState<InventoryItemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageTab, setPageTab] = useState<'overview' | 'locations' | 'settings'>('overview');
  const [overviewTab, setOverviewTab] = useState<'small_tools' | 'minor_plant'>('small_tools');
  const [settingsTab, setSettingsTab] = useState<'categories' | 'groups'>('categories');
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [changeLocationDialogOpen, setChangeLocationDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editingLocation, setEditingLocation] = useState<InventoryLocation | null>(null);
  const [movingItems, setMovingItems] = useState<InventoryItem[]>([]);
  const [restoringMinorPlantItems, setRestoringMinorPlantItems] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const fetchInventoryData = useCallback(async () => {
    try {
      const contextResponse = await fetch('/api/inventory/context', { cache: 'no-store' });
      const contextPayload = await contextResponse.json();
      if (!contextResponse.ok) {
        throw new Error(contextPayload.error || 'Failed to fetch inventory context');
      }

      const isManagerOrAdmin = contextPayload.is_manager_or_admin === true;
      const [{ items: inventoryItems }, locationsResponse, fleetAssetsResponse, categoriesResponse, groupsResponse] = await Promise.all([
        fetchAllPaginatedItems<InventoryItem>('/api/inventory', 'inventory', {
          limit: 500,
          errorMessage: 'Failed to fetch inventory items',
        }),
        fetch('/api/inventory/locations', { cache: 'no-store' }),
        fetch('/api/inventory/fleet-assets', { cache: 'no-store' }),
        fetch('/api/inventory/categories', { cache: 'no-store' }),
        isManagerOrAdmin ? fetch('/api/inventory/groups', { cache: 'no-store' }) : Promise.resolve(null),
      ]);

      const locationsPayload = await locationsResponse.json();
      if (!locationsResponse.ok) {
        throw new Error(locationsPayload.error || 'Failed to fetch inventory locations');
      }

      const fleetAssetsPayload = await fleetAssetsResponse.json();
      if (!fleetAssetsResponse.ok) {
        throw new Error(fleetAssetsPayload.error || 'Failed to fetch fleet assets');
      }

      const categoriesPayload = await categoriesResponse.json();
      if (!categoriesResponse.ok) {
        throw new Error(categoriesPayload.error || 'Failed to fetch inventory categories');
      }

      const groupsPayload = groupsResponse ? await groupsResponse.json() : { groups: [] };
      if (groupsResponse && !groupsResponse.ok) {
        throw new Error(groupsPayload.error || 'Failed to fetch inventory groups');
      }

      setInventoryContext(contextPayload);
      setItems(inventoryItems);
      setLocations(locationsPayload.locations || []);
      setFleetAssets(fleetAssetsPayload.assets || []);
      setCategories(categoriesPayload.categories || []);
      setGroups(groupsPayload.groups || []);
    } catch (error) {
      console.error('Error fetching inventory data:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permissionLoading) return;
    if (!canViewInventory) {
      toast.error('Access denied', { id: 'inventory-access-denied' });
      router.push('/dashboard');
      return;
    }
    fetchInventoryData();
  }, [canViewInventory, fetchInventoryData, permissionLoading, router]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    const requestedSettings = searchParams.get('settings');
    const requestedOverview = searchParams.get('overview');

    if (requestedTab === 'locations') {
      setPageTab('locations');
      return;
    }

    if (requestedTab === 'groups' || requestedTab === 'categories') {
      setPageTab('settings');
      setSettingsTab(requestedTab);
      return;
    }

    if (requestedTab === 'settings') {
      if (requestedSettings === 'locations') {
        setPageTab('locations');
        return;
      }
      setPageTab('settings');
      if (requestedSettings === 'groups' || requestedSettings === 'categories') {
        setSettingsTab(requestedSettings);
      }
      return;
    }

    setPageTab('overview');
    setOverviewTab(requestedOverview === 'minor-plant' ? 'minor_plant' : 'small_tools');
  }, [searchParams]);

  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        if (item.status !== 'active') return acc;

        acc.total += 1;
        const status = getInventoryCheckStatus(item);
        if (status === 'overdue') acc.overdue += 1;
        if (status === 'due_soon') acc.dueSoon += 1;
        if (status === 'needs_check') acc.needsCheck += 1;
        if (!item.location_id) acc.noLocation += 1;
        return acc;
      },
      {
        total: 0,
        overdue: 0,
        dueSoon: 0,
        needsCheck: 0,
        noLocation: 0,
      }
    );
  }, [items]);

  const categoryLabels = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.slug, category.name])),
    [categories]
  );

  const smallToolsItems = useMemo(
    () => items.filter((item) => item.category !== 'minor_plant'),
    [items]
  );

  const minorPlantItems = useMemo(
    () => items.filter((item) => item.category === 'minor_plant'),
    [items]
  );

  async function parseJsonResponse(response: Response, fallbackMessage: string) {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || fallbackMessage);
    }
    return payload;
  }

  function buildInventoryItemPayload(data: InventoryItemFormData) {
    const { check_interval_months: checkIntervalMonths, ...payload } = data;
    const intervalMonths = Number.parseInt(checkIntervalMonths, 10);
    return {
      ...payload,
      check_interval_days: checkIntervalMonthsToDays(
        Number.isFinite(intervalMonths) && intervalMonths > 0 ? intervalMonths : null
      ),
    };
  }

  async function handleCreateItem(data: InventoryItemFormData) {
    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInventoryItemPayload(data)),
    });
    await parseJsonResponse(response, 'Failed to create inventory item');
    toast.success('Inventory item added');
    await fetchInventoryData();
  }

  async function handleUpdateItem(data: InventoryItemFormData) {
    if (!editingItem) return;
    const response = await fetch(`/api/inventory/${editingItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInventoryItemPayload(data)),
    });
    await parseJsonResponse(response, 'Failed to update inventory item');
    toast.success('Inventory item updated');
    setEditingItem(null);
    await fetchInventoryData();
  }

  async function handleRemoveItem(item: InventoryItem) {
    if (!window.confirm(`Delete inventory item ${item.item_number} - ${item.name}?`)) return;

    const response = await fetch(`/api/inventory/${item.id}`, {
      method: 'DELETE',
    });
    await parseJsonResponse(response, 'Failed to delete inventory item');
    toast.success('Inventory item deleted');
    setSelectedItemIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    await fetchInventoryData();
  }

  async function handleCreateLocation(data: InventoryLocationFormData) {
    const response = await fetch('/api/inventory/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to create inventory location');
    toast.success('Location added');
    await fetchInventoryData();
  }

  async function handleUpdateLocation(data: InventoryLocationFormData) {
    if (!editingLocation) return;
    const response = await fetch(`/api/inventory/locations/${editingLocation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to update inventory location');
    toast.success('Location updated');
    setEditingLocation(null);
    await fetchInventoryData();
  }

  async function handleRemoveLocation(location: InventoryLocation) {
    if (!window.confirm(`Remove ${location.name}? Locations with active items cannot be removed.`)) return;

    const response = await fetch(`/api/inventory/locations/${location.id}`, {
      method: 'DELETE',
    });
    await parseJsonResponse(response, 'Failed to remove inventory location');
    toast.success('Location removed');
    await fetchInventoryData();
  }

  async function handleMoveItems(payload: InventoryMovePayload) {
    await moveInventoryItems(movingItems, payload);
    setMovingItems([]);
    setSelectedItemIds(new Set());
  }

  async function moveInventoryItems(itemsToMove: InventoryItem[], payload: InventoryMovePayload) {
    const response = await fetch('/api/inventory/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_ids: itemsToMove.map((item) => item.id),
        location_id: payload.location_id,
        note: payload.note,
        scope: payload.scope || (itemsToMove.length > 1 ? 'bulk' : 'single'),
        group_id: payload.group_id || null,
      }),
    });
    const result = await parseJsonResponse(response, 'Failed to move inventory items');
    toast.success(result.moved_count === 1 ? 'Item moved' : `${result.moved_count} items moved`);
    await fetchInventoryData();
  }

  async function handleRestoreMinorPlantToPlant(itemsToRestore: InventoryItem[]) {
    if (itemsToRestore.length === 0) return;
    if (!window.confirm(`Move ${itemsToRestore.length} Minor Plant item${itemsToRestore.length === 1 ? '' : 's'} back to the Plant asset table?`)) return;

    setRestoringMinorPlantItems(true);
    try {
      const response = await fetch('/api/inventory/minor-plant/restore-to-plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: itemsToRestore.map((item) => item.id) }),
      });
      const result = await parseJsonResponse(response, 'Failed to move Minor Plant items back to Plant assets');
      toast.success('Minor Plant items moved to Plant assets', {
        description: `${result.restored_count || 0} moved${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}.`,
      });
      if (result.skipped_count) {
        toast.warning('Some Minor Plant items were skipped', {
          description: 'Only items linked to a source Plant asset can be restored automatically.',
        });
      }
      setSelectedItemIds(new Set());
      await fetchInventoryData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to move Minor Plant items back to Plant assets');
    } finally {
      setRestoringMinorPlantItems(false);
    }
  }

  async function handleSetUserLocation(locationId: string, changeReason?: string) {
    const response = await fetch('/api/inventory/me/location', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: locationId, change_reason: changeReason || null }),
    });
    await parseJsonResponse(response, 'Failed to update your inventory location');
    toast.success('Inventory location updated');
    await fetchInventoryData();
  }

  async function handleUnsetUserLocation() {
    const response = await fetch('/api/inventory/me/location', {
      method: 'DELETE',
    });
    await parseJsonResponse(response, 'Failed to unset your inventory location');
    toast.success('Inventory location unset');
    await fetchInventoryData();
  }

  async function handleRequestLocation(data: { suggested_name: string; note: string }) {
    const response = await fetch('/api/inventory/location-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to request inventory location');
    toast.success('Location request sent');
  }

  function buildInventoryCategoryPayload(data: InventoryItemCategoryFormData) {
    const sortOrder = Number.parseInt(data.sort_order, 10);
    return {
      name: data.name,
      slug: data.slug,
      description: data.description,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    };
  }

  async function handleCreateCategory(data: InventoryItemCategoryFormData) {
    const response = await fetch('/api/inventory/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInventoryCategoryPayload(data)),
    });
    await parseJsonResponse(response, 'Failed to create inventory category');
    toast.success('Inventory category created');
    await fetchInventoryData();
  }

  async function handleUpdateCategory(category: InventoryItemCategory, data: InventoryItemCategoryFormData) {
    const response = await fetch(`/api/inventory/categories/${category.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInventoryCategoryPayload(data)),
    });
    await parseJsonResponse(response, 'Failed to update inventory category');
    toast.success('Inventory category updated');
    await fetchInventoryData();
  }

  async function handleRemoveCategory(category: InventoryItemCategory) {
    if ((category.item_count || 0) > 0) {
      toast.error('Move items to another category before deleting this category');
      return;
    }
    if (!window.confirm(`Delete category ${category.name}?`)) return;

    const response = await fetch(`/api/inventory/categories/${category.id}`, {
      method: 'DELETE',
    });
    await parseJsonResponse(response, 'Failed to delete inventory category');
    toast.success('Inventory category deleted');
    await fetchInventoryData();
  }

  async function handleCreateGroup(data: { name: string; description: string; item_ids: string[] }) {
    const response = await fetch('/api/inventory/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to create inventory group');
    toast.success('Inventory group created');
    await fetchInventoryData();
  }

  async function handleUpdateGroup(group: InventoryItemGroup, data: { name: string; description: string; item_ids: string[] }) {
    const response = await fetch(`/api/inventory/groups/${group.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to update inventory group');
    toast.success('Inventory group updated');
    await fetchInventoryData();
  }

  async function handleRemoveGroup(group: InventoryItemGroup) {
    if (!window.confirm(`Remove group ${group.name}? Items will stay in their current locations.`)) return;

    const response = await fetch(`/api/inventory/groups/${group.id}`, {
      method: 'DELETE',
    });
    await parseJsonResponse(response, 'Failed to remove inventory group');
    toast.success('Inventory group removed');
    await fetchInventoryData();
  }

  if (permissionLoading || loading) {
    return <PageLoader message="Loading inventory..." />;
  }

  const isManagerOrAdmin = inventoryContext?.is_manager_or_admin === true;
  const employeeLocationName = inventoryContext?.user_location?.location?.is_active === false
    ? null
    : inventoryContext?.user_location?.location?.name || null;

  if (!isManagerOrAdmin) {
    return (
      <AppPageShell width="wide">
        <AppPageHeader
          title="Inventory"
          description={employeeLocationName ? `Current location: ${employeeLocationName}` : 'Set your location, view assigned inventory, and claim or move items.'}
          icon={<PackageSearch className="h-5 w-5" />}
          actions={employeeLocationName ? (
            <Button variant="outline" onClick={() => setChangeLocationDialogOpen(true)} className="border-slate-600">
              Change My Location
            </Button>
          ) : null}
        />

        <InventoryEmployeeView
          items={items}
          locations={locations}
          categoryLabels={categoryLabels}
          userLocation={inventoryContext?.user_location || null}
          onSetUserLocation={handleSetUserLocation}
          onRequestLocation={handleRequestLocation}
          onMoveItems={moveInventoryItems}
          onOpenMoveDialog={setMovingItems}
        />

        <MoveInventoryDialog
          open={movingItems.length > 0}
          items={movingItems}
          locations={locations}
          onClose={() => setMovingItems([])}
          onSubmit={handleMoveItems}
        />

        <ChangeInventoryLocationDialog
          open={changeLocationDialogOpen}
          locations={locations}
          userLocation={inventoryContext?.user_location || null}
          onClose={() => setChangeLocationDialogOpen(false)}
          onSubmit={({ locationId, reason }) => handleSetUserLocation(locationId, reason)}
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="Inventory"
        description={employeeLocationName
          ? `Current location: ${employeeLocationName}`
          : 'Track small tools, plant, signs, equipment, locations, and check status.'
        }
        icon={<PackageSearch className="h-5 w-5" />}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setChangeLocationDialogOpen(true)}
              className="border-slate-600"
            >
              {employeeLocationName ? 'Change My Location' : 'Set My Location'}
            </Button>
            <Button
              onClick={() => { setEditingItem(null); setItemDialogOpen(true); }}
              className="bg-inventory text-white hover:bg-inventory-dark"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        )}
      />

      <div className="hidden grid-cols-5 gap-2 min-[430px]:grid lg:gap-4">
        <SummaryCard label="Active Items" value={summary.total} icon={<PackageSearch className="h-5 w-5" />} />
        <SummaryCard label="Overdue" value={summary.overdue} icon={<AlertTriangle className="h-5 w-5" />} tone="danger" />
        <SummaryCard label="Due Soon" value={summary.dueSoon} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
        <SummaryCard label="Needs Check" value={summary.needsCheck} icon={<CheckCircle2 className="h-5 w-5" />} tone="info" />
        <SummaryCard label="No Location" value={summary.noLocation} icon={<Truck className="h-5 w-5" />} />
      </div>

      <Tabs
        value={pageTab}
        onValueChange={(value) => {
          if (value === 'settings') {
            setPageTab('settings');
            router.push(`/inventory?tab=settings&settings=${settingsTab}`, { scroll: false });
            return;
          }
          if (value === 'locations') {
            setPageTab('locations');
            router.push('/inventory?tab=locations', { scroll: false });
            return;
          }
          setPageTab('overview');
          router.push(overviewTab === 'minor_plant' ? '/inventory?overview=minor-plant' : '/inventory', { scroll: false });
        }}
      >
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <PackageSearch className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-2">
            <MapPin className="h-4 w-4" />
            Locations
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {pageTab === 'settings' ? (
          <div className="mt-3 flex justify-end">
            <Tabs
              value={settingsTab}
              onValueChange={(value) => {
                const nextSettingsTab = value as 'categories' | 'groups';
                setSettingsTab(nextSettingsTab);
                router.push(`/inventory?tab=settings&settings=${nextSettingsTab}`, { scroll: false });
              }}
            >
              <TabsList>
                <TabsTrigger value="categories" className="gap-2">
                  <PackageSearch className="h-4 w-4" />
                  Categories
                </TabsTrigger>
                <TabsTrigger value="groups" className="gap-2">
                  <PackageSearch className="h-4 w-4" />
                  Groups
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <TabsContent value="overview" className="mt-0 space-y-6">
          <Tabs
            value={overviewTab}
            onValueChange={(value) => {
              const nextOverviewTab = value as 'small_tools' | 'minor_plant';
              setOverviewTab(nextOverviewTab);
              router.push(nextOverviewTab === 'minor_plant' ? '/inventory?overview=minor-plant' : '/inventory', { scroll: false });
            }}
          >
            <div className="flex justify-end">
              <TabsList>
                <TabsTrigger value="small_tools" className="gap-2">
                  <PackageSearch className="h-4 w-4" />
                  Small Tools
                </TabsTrigger>
                <TabsTrigger value="minor_plant" className="gap-2">
                  <Truck className="h-4 w-4" />
                  Minor Plant
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="small_tools" className="mt-4">
              <InventoryTable
                items={smallToolsItems}
                selectedItemIds={selectedItemIds}
                onSelectedItemIdsChange={setSelectedItemIds}
                onEdit={(item) => { setEditingItem(item); setItemDialogOpen(true); }}
                onDelete={handleRemoveItem}
                onMove={setMovingItems}
                onOpenDetails={(item) => router.push('/inventory/items/' + item.id + '?fromTab=overview')}
                locationFilterLocations={locations}
                categoryLabels={categoryLabels}
                tableLabel="small tools"
              />
            </TabsContent>

            <TabsContent value="minor_plant" className="mt-4">
              <InventoryTable
                items={minorPlantItems}
                selectedItemIds={selectedItemIds}
                onSelectedItemIdsChange={setSelectedItemIds}
                onEdit={(item) => { setEditingItem(item); setItemDialogOpen(true); }}
                onDelete={handleRemoveItem}
                onMove={setMovingItems}
                onBulkAction={handleRestoreMinorPlantToPlant}
                bulkActionLabel={restoringMinorPlantItems ? 'Moving to Plant Assets...' : 'Move to Plant Assets'}
                onOpenDetails={(item) => router.push('/inventory/items/' + item.id + '?fromTab=overview&overview=minor-plant')}
                locationFilterLocations={locations}
                categoryLabels={categoryLabels}
                tableLabel="minor plant"
                showMinorPlantDetails
              />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="locations" className="mt-0 space-y-6">
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => { setEditingLocation(null); setLocationDialogOpen(true); }}
              className="border-slate-600"
            >
              <MapPin className="mr-2 h-4 w-4" />
              Add Location
            </Button>
          </div>
          <InventoryLocationsPanel
            locations={locations}
            fleetAssets={fleetAssets}
            onEdit={(location) => { setEditingLocation(location); setLocationDialogOpen(true); }}
            onRemove={handleRemoveLocation}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 space-y-6">
          {settingsTab === 'categories' ? (
            <InventoryCategoriesPanel
              categories={categories}
              onCreate={handleCreateCategory}
              onUpdate={handleUpdateCategory}
              onRemove={handleRemoveCategory}
            />
          ) : null}

          {settingsTab === 'groups' ? (
            <InventoryGroupsPanel
              groups={groups}
              items={items}
              onCreate={handleCreateGroup}
              onUpdate={handleUpdateGroup}
              onRemove={handleRemoveGroup}
            />
          ) : null}
        </TabsContent>
      </Tabs>

      <InventoryItemDialog
        open={itemDialogOpen}
        item={editingItem}
        locations={locations}
        categories={categories}
        onClose={() => { setItemDialogOpen(false); setEditingItem(null); }}
        onSubmit={editingItem ? handleUpdateItem : handleCreateItem}
      />

      <InventoryLocationDialog
        open={locationDialogOpen}
        location={editingLocation}
        fleetAssets={fleetAssets}
        onClose={() => { setLocationDialogOpen(false); setEditingLocation(null); }}
        onSubmit={editingLocation ? handleUpdateLocation : handleCreateLocation}
      />

      <MoveInventoryDialog
        open={movingItems.length > 0}
        items={movingItems}
        locations={locations}
        onClose={() => setMovingItems([])}
        onSubmit={handleMoveItems}
      />

      <ChangeInventoryLocationDialog
        open={changeLocationDialogOpen}
        locations={locations}
        userLocation={inventoryContext?.user_location || null}
        allowUnset
        onClose={() => setChangeLocationDialogOpen(false)}
        onSubmit={({ locationId, reason }) => handleSetUserLocation(locationId, reason)}
        onUnset={handleUnsetUserLocation}
      />
    </AppPageShell>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'info';
}

function SummaryCard({ label, value, icon, tone = 'default' }: SummaryCardProps) {
  const toneClassName = {
    default: 'text-inventory bg-inventory-soft',
    danger: 'text-red-300 bg-red-500/10',
    warning: 'text-amber-300 bg-amber-500/10',
    info: 'text-blue-300 bg-blue-500/10',
  }[tone];

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardContent className="flex min-h-[88px] flex-col items-start justify-center gap-2 p-2 min-[900px]:min-h-0 min-[900px]:flex-row min-[900px]:items-center min-[900px]:gap-3 min-[900px]:p-4">
        <div className={`rounded-lg p-1.5 min-[900px]:p-2 [&_svg]:h-4 [&_svg]:w-4 min-[900px]:[&_svg]:h-5 min-[900px]:[&_svg]:w-5 ${toneClassName}`}>
          {icon}
        </div>
        <div>
          <div className="text-xl font-bold text-white min-[900px]:text-2xl">{value}</div>
          <div className="text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground min-[900px]:text-xs">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
