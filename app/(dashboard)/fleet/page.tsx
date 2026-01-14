'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Wrench, Truck, Tag, Settings as SettingsIcon } from 'lucide-react';
import { logger } from '@/lib/utils/logger';

// Import existing components
import { MaintenanceOverview } from '@/app/(dashboard)/maintenance/components/MaintenanceOverview';
import { MaintenanceTable } from '@/app/(dashboard)/maintenance/components/MaintenanceTable';
import { MaintenanceSettings } from '@/app/(dashboard)/maintenance/components/MaintenanceSettings';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { createClient } from '@/lib/supabase/client';

// Vehicles Admin Component (will be extracted later)
// For now, we'll import the full page and use it as a component
// TODO: Extract vehicle management into reusable components

function FleetContent() {
  const searchParams = useSearchParams();
  const router = useNextRouter();
  const { profile, isManager, isAdmin, isSuperAdmin } = useAuth();
  const supabase = createClient();
  
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'maintenance');
  const [hasModulePermission, setHasModulePermission] = useState<boolean | null>(null);
  // Fetch maintenance data
  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();
  
  // Check maintenance module permission
  useEffect(() => {
    async function checkPermission() {
      if (!profile?.id) {
        setHasModulePermission(false);
        return;
      }
      
      // Managers and admins have full access
      if (isManager || isAdmin || isSuperAdmin) {
        setHasModulePermission(true);
        return;
      }
      
      try {
        // Check if employee has 'maintenance' module permission
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
        logger.error('Failed to check maintenance permission', err, 'FleetPage');
        setHasModulePermission(false);
      }
    }
    
    checkPermission();
  }, [profile?.id, isManager, isAdmin, isSuperAdmin, supabase]);
  
  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    router.push(`/fleet?tab=${value}`, { scroll: false });
  };
  
  // Handler for navigating to vehicle history
  const handleVehicleClick = (vehicle: VehicleMaintenanceWithStatus) => {
    router.push(`/fleet/vehicles/${vehicle.id}/history`);
  };
  
  // Check access
  const hasAccess = hasModulePermission;
  const canManageVehicles = isManager || isAdmin || isSuperAdmin;
  
  // Show loading while checking permissions
  if (hasModulePermission === null) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  // Show access denied if no permission
  if (!hasAccess) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-gray-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
            <p className="text-gray-600 text-center max-w-md">
              You don&apos;t have permission to access the Fleet module. Please contact your manager.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fleet Management</h1>
          <p className="text-muted-foreground mt-1">
            Manage vehicles, maintenance schedules, and fleet operations
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            Maintenance
          </TabsTrigger>
          {canManageVehicles && (
            <>
              <TabsTrigger value="vehicles" className="gap-2">
                <Truck className="h-4 w-4" />
                Vehicles
              </TabsTrigger>
              <TabsTrigger value="categories" className="gap-2">
                <Tag className="h-4 w-4" />
                Categories
              </TabsTrigger>
            </>
          )}
          {canManageVehicles && (
            <TabsTrigger value="settings" className="gap-2">
              <SettingsIcon className="h-4 w-4" />
              Settings
            </TabsTrigger>
          )}
        </TabsList>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-6">
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
              <MaintenanceOverview data={maintenanceData || []} />
              <MaintenanceTable 
                data={maintenanceData || []} 
                onVehicleClick={handleVehicleClick}
              />
            </>
          )}
        </TabsContent>

        {/* Vehicles Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="vehicles" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <Truck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Vehicles Management</h3>
                  <p className="text-gray-600 mb-4">
                    Vehicle master data management (add/edit/archive)
                  </p>
                  <p className="text-sm text-muted-foreground">
                    This will be implemented in the component extraction phase
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Categories Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="categories" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <Tag className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Vehicle Categories</h3>
                  <p className="text-gray-600 mb-4">
                    Manage vehicle categories and classifications
                  </p>
                  <p className="text-sm text-muted-foreground">
                    This will be implemented in the component extraction phase
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Settings Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="settings" className="space-y-6">
            <MaintenanceSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function FleetPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    }>
      <FleetContent />
    </Suspense>
  );
}
