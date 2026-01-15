'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Wrench, Truck, Tag, Settings as SettingsIcon, Plus } from 'lucide-react';
import { logger } from '@/lib/utils/logger';

// Import existing components
import { MaintenanceOverview } from '@/app/(dashboard)/maintenance/components/MaintenanceOverview';
import { MaintenanceTable } from '@/app/(dashboard)/maintenance/components/MaintenanceTable';
import { MaintenanceSettings } from '@/app/(dashboard)/maintenance/components/MaintenanceSettings';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { createClient } from '@/lib/supabase/client';

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
  category_id: string;
  vehicle_categories?: { name: string; id: string } | null;
};

type Category = {
  id: string;
  name: string;
  description: string | null;
};

function FleetContent() {
  const searchParams = useSearchParams();
  const router = useNextRouter();
  const { profile, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const supabase = createClient();
  
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'maintenance');
  const [hasModulePermission, setHasModulePermission] = useState<boolean | null>(null);
  
  // Sync activeTab with URL changes (browser back/forward)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab') || 'maintenance';
    setActiveTab(tabFromUrl);
  }, [searchParams]);
  // Fetch maintenance data
  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();
  
  // State for vehicles and categories
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  
  // State for maintenance search
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch vehicles
  const fetchVehicles = async () => {
    try {
      setVehiclesLoading(true);
      const response = await fetch('/api/admin/vehicles');
      const data = await response.json();
      if (response.ok) {
        setVehicles(data.vehicles || []);
      }
    } catch (error) {
      logger.error('Failed to fetch vehicles', error, 'FleetPage');
    } finally {
      setVehiclesLoading(false);
    }
  };

  // Fetch categories
  const fetchCategories = async () => {
    try {
      setCategoriesLoading(true);
      const response = await fetch('/api/admin/categories');
      const data = await response.json();
      if (response.ok) {
        setCategories(data.categories || []);
      }
    } catch (error) {
      logger.error('Failed to fetch categories', error, 'FleetPage');
    } finally {
      setCategoriesLoading(false);
    }
  };

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
  
  // Fetch data on initial load based on active tab from URL
  useEffect(() => {
    if (activeTab === 'vehicles') {
      if (vehicles.length === 0) fetchVehicles();
      if (categories.length === 0) fetchCategories();
    } else if (activeTab === 'categories' && categories.length === 0) {
      fetchCategories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  
  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    router.push(`/fleet?tab=${value}`, { scroll: false });
    
    // Fetch data when switching to tabs
    if (value === 'vehicles') {
      if (vehicles.length === 0) fetchVehicles();
      if (categories.length === 0) fetchCategories();
    } else if (value === 'categories' && categories.length === 0) {
      fetchCategories();
    }
  };
  
  // Handler for navigating to vehicle history
  const handleVehicleClick = (vehicle: VehicleMaintenanceWithStatus) => {
    router.push(`/fleet/vehicles/${vehicle.id}/history`);
  };
  
  // Check access
  const hasAccess = hasModulePermission;
  const canManageVehicles = isManager || isAdmin || isSuperAdmin;
  
  // Show loading while auth or permissions are being checked
  if (authLoading || hasModulePermission === null) {
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
            <MaintenanceOverview 
              vehicles={maintenanceData?.vehicles || []}
              summary={maintenanceData?.summary || {
                total: 0,
                overdue: 0,
                due_soon: 0,
              }}
              onVehicleClick={handleVehicleClick}
            />
          )}
        </TabsContent>

        {/* Vehicles Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="vehicles" className="space-y-6">
            {maintenanceLoading ? (
              <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : maintenanceError ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Wrench className="h-16 w-16 text-red-400 mb-4" />
                  <h2 className="text-2xl font-semibold mb-2">Error Loading Vehicle Data</h2>
                  <p className="text-gray-600 text-center max-w-md">
                    {maintenanceError?.message || 'Failed to load vehicle records'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <MaintenanceTable 
                vehicles={maintenanceData?.vehicles || []}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onVehicleAdded={() => {}}
              />
            )}
          </TabsContent>
        )}

        {/* Categories Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="categories" className="space-y-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Vehicle Categories</h2>
                <p className="text-muted-foreground mt-1">
                  Manage vehicle categories and classifications
                </p>
              </div>
              <Button size="sm" disabled>
                <Plus className="h-4 w-4 mr-2" />
                Add Category
              </Button>
            </div>

            {categoriesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : categories.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Tag className="h-16 w-16 text-gray-400 mb-4" />
                  <p className="text-gray-400">No categories found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {categories.map((category) => (
                  <Card key={category.id} className="bg-slate-800/50 border-slate-700">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <div className="bg-blue-500/10 p-3 rounded-lg">
                            <Tag className="h-5 w-5 text-blue-400" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                            <p className="text-sm text-slate-400 mt-1">
                              {category.description || 'No description'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-blue-400">
                            {vehicles.filter(v => v.vehicle_categories?.name === category.name).length}
                          </div>
                          <p className="text-xs text-muted-foreground">vehicles</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
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
