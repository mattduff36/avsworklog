'use client';

import { useEffect, useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Wrench, Truck, HardHat } from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { createClient } from '@/lib/supabase/client';

const MaintenanceOverview = dynamic(
  () => import('@/app/(dashboard)/maintenance/components/MaintenanceOverview').then(mod => ({ default: mod.MaintenanceOverview })),
  { 
    loading: () => (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    ),
    ssr: false
  }
);

function MaintenanceContent() {
  const router = useRouter();
  const { profile, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const supabase = createClient();

  const [hasModulePermission, setHasModulePermission] = useState<boolean | null>(null);
  const [maintenanceFilter, setMaintenanceFilter] = useState<'both' | 'van' | 'plant'>('both');

  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();

  useEffect(() => {
    async function checkPermission() {
      if (!profile?.id) {
        setHasModulePermission(false);
        return;
      }

      if (isManager || isAdmin || isSuperAdmin) {
        setHasModulePermission(true);
        return;
      }

      try {
        const { data } = await supabase
          .from('profiles')
          .select(`
            role_id,
            roles!inner(
              role_permissions!inner(
                module_name,
                enabled
              )
            )
          `)
          .eq('id', profile.id)
          .eq('roles.role_permissions.module_name', 'maintenance')
          .single();

        const maintenancePerm = data?.roles?.role_permissions?.find(
          (p: { module_name: string; enabled: boolean }) =>
            p.module_name === 'maintenance'
        );

        setHasModulePermission(maintenancePerm?.enabled || false);
      } catch (err) {
        logger.error('Failed to check maintenance permission', err, 'MaintenancePage');
        setHasModulePermission(false);
      }
    }

    checkPermission();
  }, [profile?.id, isManager, isAdmin, isSuperAdmin, supabase]);

  const handleVehicleClick = (vehicle: VehicleMaintenanceWithStatus) => {
    const isPlant = vehicle.is_plant === true;
    const assetId = vehicle.vehicle?.id || vehicle.vehicle_id || vehicle.id;

    if (isPlant) {
      router.push(`/fleet/plant/${assetId}/history?fromTab=maintenance`);
    } else {
      router.push(`/fleet/vans/${assetId}/history?fromTab=maintenance`);
    }
  };

  if (authLoading || hasModulePermission === null) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!hasModulePermission) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-gray-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
            <p className="text-gray-600 text-center max-w-md">
              You don&apos;t have permission to access Maintenance. Please contact your manager.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Maintenance &amp; Service</h1>
            <p className="text-muted-foreground">
              Track maintenance schedules, MOT, tax, and service status across all fleet assets
            </p>
          </div>
        </div>
      </div>

      {maintenanceLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : maintenanceError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-red-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Error Loading Maintenance Data</h2>
            <p className="text-gray-600 text-center max-w-md">
              {maintenanceError?.message || 'Failed to load maintenance records'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filter Buttons */}
          <div className="flex items-center justify-end">
            <Tabs value={maintenanceFilter} onValueChange={(v) => setMaintenanceFilter(v as 'both' | 'van' | 'plant')}>
              <TabsList>
                <TabsTrigger value="both" className="gap-2">
                  <Wrench className="h-4 w-4" />
                  All Assets
                </TabsTrigger>
                <TabsTrigger value="van" className="gap-2">
                  <Truck className="h-4 w-4" />
                  Vans
                </TabsTrigger>
                <TabsTrigger value="plant" className="gap-2">
                  <HardHat className="h-4 w-4" />
                  Plant
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {(() => {
            const filteredVehicles = (maintenanceData?.vehicles || []).filter(v => {
              if (maintenanceFilter === 'both') return true;
              if (maintenanceFilter === 'van') return v.vehicle?.asset_type !== 'plant';
              if (maintenanceFilter === 'plant') return v.vehicle?.asset_type === 'plant';
              return true;
            });

            const filteredSummary = {
              total: filteredVehicles.length,
              overdue: filteredVehicles.filter(v => v.overdue_count > 0).length,
              due_soon: filteredVehicles.filter(v => v.due_soon_count > 0 && v.overdue_count === 0).length,
            };

            return (
              <MaintenanceOverview
                vehicles={filteredVehicles}
                summary={filteredSummary}
                onVehicleClick={handleVehicleClick}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    }>
      <MaintenanceContent />
    </Suspense>
  );
}
