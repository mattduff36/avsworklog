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
import { InventoryItemDialog } from './components/InventoryItemDialog';
import { InventoryLocationDialog } from './components/InventoryLocationDialog';
import { InventoryLocationsPanel } from './components/InventoryLocationsPanel';
import { InventoryTable } from './components/InventoryTable';
import { MoveInventoryDialog } from './components/MoveInventoryDialog';
import { getInventoryCheckStatus } from './utils';
import type {
  FleetAssetOption,
  InventoryItem,
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
  const [loading, setLoading] = useState(true);
  const [pageTab, setPageTab] = useState<'overview' | 'locations'>('overview');
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editingLocation, setEditingLocation] = useState<InventoryLocation | null>(null);
  const [movingItems, setMovingItems] = useState<InventoryItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const fetchInventoryData = useCallback(async () => {
    try {
      const [{ items: inventoryItems }, locationsResponse, fleetAssetsResponse] = await Promise.all([
        fetchAllPaginatedItems<InventoryItem>('/api/inventory', 'inventory', {
          limit: 500,
          errorMessage: 'Failed to fetch inventory items',
        }),
        fetch('/api/inventory/locations', { cache: 'no-store' }),
        fetch('/api/inventory/fleet-assets', { cache: 'no-store' }),
      ]);

      const locationsPayload = await locationsResponse.json();
      if (!locationsResponse.ok) {
        throw new Error(locationsPayload.error || 'Failed to fetch inventory locations');
      }

      const fleetAssetsPayload = await fleetAssetsResponse.json();
      if (!fleetAssetsResponse.ok) {
        throw new Error(fleetAssetsPayload.error || 'Failed to fetch fleet assets');
      }

      setItems(inventoryItems);
      setLocations(locationsPayload.locations || []);
      setFleetAssets(fleetAssetsPayload.assets || []);
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
    if (requestedTab === 'locations') setPageTab('locations');
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
        if (item.location?.name?.toLowerCase() === 'nolocation') acc.noLocation += 1;
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

  async function parseJsonResponse(response: Response, fallbackMessage: string) {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || fallbackMessage);
    }
    return payload;
  }

  async function handleCreateItem(data: InventoryItemFormData) {
    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
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
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to update inventory item');
    toast.success('Inventory item updated');
    setEditingItem(null);
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
    for (const item of movingItems) {
      const response = await fetch(`/api/inventory/${item.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await parseJsonResponse(response, `Failed to move ${item.name}`);
    }

    toast.success(movingItems.length === 1 ? 'Item moved' : `${movingItems.length} items moved`);
    setMovingItems([]);
    setSelectedItemIds(new Set());
    await fetchInventoryData();
  }

  if (permissionLoading || loading) {
    return <PageLoader message="Loading inventory..." />;
  }

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="Inventory"
        description="Track small tools, plant, signs, equipment, locations, and six-week check status."
        icon={<PackageSearch className="h-5 w-5" />}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => { setEditingLocation(null); setLocationDialogOpen(true); }}
              className="border-slate-600"
            >
              <MapPin className="mr-2 h-4 w-4" />
              Add Location
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Active Items" value={summary.total} icon={<PackageSearch className="h-5 w-5" />} />
        <SummaryCard label="Overdue" value={summary.overdue} icon={<AlertTriangle className="h-5 w-5" />} tone="danger" />
        <SummaryCard label="Due Soon" value={summary.dueSoon} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
        <SummaryCard label="Needs Check" value={summary.needsCheck} icon={<CheckCircle2 className="h-5 w-5" />} tone="info" />
        <SummaryCard label="NoLocation" value={summary.noLocation} icon={<Truck className="h-5 w-5" />} />
      </div>

      <Tabs
        value={pageTab}
        onValueChange={(value) => {
          const nextTab = value as 'overview' | 'locations';
          setPageTab(nextTab);
          router.push(nextTab === 'locations' ? '/inventory?tab=locations' : '/inventory', { scroll: false });
        }}
      >
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <PackageSearch className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-2">
            <Settings className="h-4 w-4" />
            Locations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-6">
          <InventoryTable
            items={items}
            selectedItemIds={selectedItemIds}
            onSelectedItemIdsChange={setSelectedItemIds}
            onEdit={(item) => { setEditingItem(item); setItemDialogOpen(true); }}
            onMove={setMovingItems}
          />
        </TabsContent>

        <TabsContent value="locations" className="mt-0 space-y-6">
          <InventoryLocationsPanel
            locations={locations}
            fleetAssets={fleetAssets}
            onEdit={(location) => { setEditingLocation(location); setLocationDialogOpen(true); }}
            onRemove={handleRemoveLocation}
          />
        </TabsContent>
      </Tabs>

      <InventoryItemDialog
        open={itemDialogOpen}
        item={editingItem}
        locations={locations}
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
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg p-2 ${toneClassName}`}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-white">{value}</div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
