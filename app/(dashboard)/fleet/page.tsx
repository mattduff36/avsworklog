'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wrench, Truck, Tag, Settings as SettingsIcon, Plus } from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import Link from 'next/link';

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
  vehicle_categories?: { name: string } | null;
};

type Category = {
  id: string;
  name: string;
  description: string | null;
};

function FleetContent() {
  const searchParams = useSearchParams();
  const router = useNextRouter();
  const { profile, isManager, isAdmin, isSuperAdmin } = useAuth();
  const supabase = createClient();
  
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'maintenance');
  const [hasModulePermission, setHasModulePermission] = useState<boolean | null>(null);
  // Fetch maintenance data
  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();
  
  // State for vehicles and categories
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  
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
  
  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    router.push(`/fleet?tab=${value}`, { scroll: false });
    
    // Fetch data when switching to tabs
    if (value === 'vehicles' && vehicles.length === 0) {
      fetchVehicles();
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
              <MaintenanceOverview 
                vehicles={maintenanceData || []}
                summary={{
                  total: maintenanceData?.length || 0,
                  overdue: maintenanceData?.filter(v => 
                    v.tax_status?.status === 'overdue' || 
                    v.mot_status?.status === 'overdue' || 
                    v.service_status?.status === 'overdue'
                  ).length || 0,
                  due_soon: maintenanceData?.filter(v => 
                    v.tax_status?.status === 'due_soon' || 
                    v.mot_status?.status === 'due_soon' || 
                    v.service_status?.status === 'due_soon'
                  ).length || 0,
                }}
                onVehicleClick={handleVehicleClick}
              />
              <MaintenanceTable 
                vehicles={maintenanceData || []}
                searchQuery=""
                onSearchChange={() => {}}
                onVehicleAdded={() => {}}
              />
            </>
          )}
        </TabsContent>

        {/* Vehicles Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="vehicles" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Vehicles</CardTitle>
                  <CardDescription>Manage vehicle master data</CardDescription>
                </div>
                <Button size="sm" disabled>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Vehicle
                </Button>
              </CardHeader>
              <CardContent>
                {vehiclesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  </div>
                ) : vehicles.length === 0 ? (
                  <div className="text-center py-12">
                    <Truck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No vehicles found</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Registration</TableHead>
                        <TableHead>Nickname</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vehicles.map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-medium">{vehicle.reg_number}</TableCell>
                          <TableCell>{vehicle.nickname || '-'}</TableCell>
                          <TableCell>{vehicle.vehicle_categories?.name || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={vehicle.status === 'active' ? 'default' : 'secondary'}>
                              {vehicle.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/fleet/vehicles/${vehicle.id}/history`}>
                              <Button variant="ghost" size="sm">
                                View History
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Categories Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="categories" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Vehicle Categories</CardTitle>
                  <CardDescription>Manage vehicle categories and classifications</CardDescription>
                </div>
                <Button size="sm" disabled>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </CardHeader>
              <CardContent>
                {categoriesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  </div>
                ) : categories.length === 0 ? (
                  <div className="text-center py-12">
                    <Tag className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No categories found</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Vehicles</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((category) => (
                        <TableRow key={category.id}>
                          <TableCell className="font-medium">{category.name}</TableCell>
                          <TableCell>{category.description || '-'}</TableCell>
                          <TableCell className="text-right">
                            {vehicles.filter(v => v.vehicle_categories?.name === category.name).length}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
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
