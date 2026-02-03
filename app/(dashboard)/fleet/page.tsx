'use client';

import { useEffect, useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Wrench, Truck, Settings, Tag, Plus, Edit, Trash2, AlertTriangle, HardHat, ChevronDown } from 'lucide-react';
import { logger } from '@/lib/utils/logger';

// Dynamic import for heavy component - loaded only when Maintenance tab is active
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

// Dynamic import for PlantOverview
const PlantOverview = dynamic(
  () => import('@/app/(dashboard)/maintenance/components/PlantOverview').then(mod => ({ default: mod.PlantOverview })),
  { 
    loading: () => (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    ),
    ssr: false
  }
);

// Dynamic import for PlantTable
const PlantTable = dynamic(
  () => import('@/app/(dashboard)/maintenance/components/PlantTable').then(mod => ({ default: mod.PlantTable })),
  { 
    loading: () => (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    ),
    ssr: false
  }
);

// Import existing components
import { MaintenanceTable } from '@/app/(dashboard)/maintenance/components/MaintenanceTable';
import { MaintenanceSettings } from '@/app/(dashboard)/maintenance/components/MaintenanceSettings';
import { VehicleCategoryDialog } from './components/VehicleCategoryDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

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
  
  const [activeTab, setActiveTab] = useState('maintenance'); // Default to maintenance, validate after auth loads
  const [hasModulePermission, setHasModulePermission] = useState<boolean | null>(null);
  const [maintenanceFilter, setMaintenanceFilter] = useState<'both' | 'vehicle' | 'plant'>('both'); // Filter for maintenance overview
  
  // Vehicle Category Dialog States
  const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false);
  const [editCategoryDialogOpen, setEditCategoryDialogOpen] = useState(false);
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  
  // Helper function to validate if user can access a tab
  const canAccessTab = (tab: string, canManage: boolean): boolean => {
    const restrictedTabs = ['vehicles', 'settings'];
    if (restrictedTabs.includes(tab)) {
      return canManage;
    }
    return true; // maintenance tab is always accessible
  };
  
  // Validate and set activeTab based on permissions and URL
  useEffect(() => {
    // Wait for auth to load
    if (authLoading) return;
    
    const canManage = isManager || isAdmin || isSuperAdmin;
    const requestedTab = searchParams.get('tab') || 'maintenance';
    
    // Validate requested tab against user permissions
    if (canAccessTab(requestedTab, canManage)) {
      setActiveTab(requestedTab);
    } else {
      // Redirect to maintenance tab if user doesn't have permission
      setActiveTab('maintenance');
      // Update URL to reflect the actual accessible tab
      router.push('/fleet?tab=maintenance', { scroll: false });
    }
  }, [searchParams, authLoading, isManager, isAdmin, isSuperAdmin, router]);
  // Fetch maintenance data
  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();
  
  // State for vehicles and categories
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [plantAssets, setPlantAssets] = useState<any[]>([]); // Separate state for plant assets
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  
  // State for collapsible category sections
  const [plantCategoriesExpanded, setPlantCategoriesExpanded] = useState(false);
  const [vehicleCategoriesExpanded, setVehicleCategoriesExpanded] = useState(false);
  
  // State for maintenance search
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch vehicles
  const fetchVehicles = async () => {
    try {
      const response = await fetch('/api/admin/vehicles');
      const data = await response.json();
      if (response.ok) {
        setVehicles(data.vehicles || []);
      }
    } catch (error) {
      logger.error('Failed to fetch vehicles', error, 'FleetPage');
    }
  };

  // Fetch plant assets
  const fetchPlantAssets = async () => {
    try {
      const { data, error } = await supabase
        .from('plant')
        .select('id, plant_id, nickname, status, category_id, vehicle_categories(name, id)')
        .eq('status', 'active');
      
      if (error) throw error;
      setPlantAssets(data || []);
    } catch (error) {
      logger.error('Failed to fetch plant assets', error, 'FleetPage');
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
    } else if (activeTab === 'settings') {
      if (categories.length === 0) fetchCategories();
      if (vehicles.length === 0) fetchVehicles(); // Need vehicles for category counts
      if (plantAssets.length === 0) fetchPlantAssets(); // Need plant assets for category counts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  
  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    const canManage = isManager || isAdmin || isSuperAdmin;
    
    // Validate tab access before changing
    if (!canAccessTab(value, canManage)) {
      logger.warn(`Attempted to access restricted tab: ${value}`, 'FleetPage');
      return;
    }
    
    setActiveTab(value);
    router.push(`/fleet?tab=${value}`, { scroll: false });
    
    // Fetch data when switching to tabs
    if (value === 'vehicles') {
      if (vehicles.length === 0) fetchVehicles();
      if (categories.length === 0) fetchCategories();
    } else if (value === 'settings') {
      if (categories.length === 0) fetchCategories();
      if (vehicles.length === 0) fetchVehicles(); // Need vehicles for category counts
      if (plantAssets.length === 0) fetchPlantAssets(); // Need plant assets for category counts
    }
  };
  
  // Handler for navigating to vehicle history
  const handleVehicleClick = (vehicle: VehicleMaintenanceWithStatus) => {
    const vehicleId = vehicle.vehicle_id || vehicle.id;
    // Pass the current active tab as fromTab
    router.push(`/fleet/vehicles/${vehicleId}/history?fromTab=${activeTab}`);
  };
  
  // Vehicle Category Dialog Handlers
  const openEditCategoryDialog = (category: Category) => {
    setSelectedCategory(category);
    setEditCategoryDialogOpen(true);
  };
  
  const openDeleteCategoryDialog = (category: Category) => {
    setSelectedCategory(category);
    setDeleteCategoryDialogOpen(true);
  };
  
  const handleDeleteCategory = async () => {
    if (!selectedCategory) return;
    
    setDeletingCategory(true);
    
    try {
      const response = await fetch(`/api/admin/categories/${selectedCategory.id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete category');
      }
      
      toast.success('Vehicle category deleted successfully');
      setDeleteCategoryDialogOpen(false);
      setSelectedCategory(null);
      fetchCategories(); // Refresh categories
    } catch (error: any) {
      console.error('Error deleting vehicle category:', error);
      toast.error(error.message || 'Failed to delete category');
    } finally {
      setDeletingCategory(false);
    }
  };
  
  const handleCategorySuccess = () => {
    fetchCategories(); // Refresh categories
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
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Fleet Management</h1>
            <p className="text-muted-foreground">
              Manage vehicles, maintenance schedules, and fleet operations
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="plant" className="gap-2">
            <HardHat className="h-4 w-4" />
            Plant
          </TabsTrigger>
          {canManageVehicles && (
            <>
              <TabsTrigger value="vehicles" className="gap-2">
                <Truck className="h-4 w-4" />
                Vehicles
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </TabsTrigger>
            </>
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
              {/* Filter Buttons - Using Tabs component for consistent styling */}
              <div className="flex items-center justify-end">
                <Tabs value={maintenanceFilter} onValueChange={(v) => setMaintenanceFilter(v as 'both' | 'vehicle' | 'plant')}>
                  <TabsList>
                    <TabsTrigger value="both" className="gap-2">
                      <Wrench className="h-4 w-4" />
                      All Assets
                    </TabsTrigger>
                    <TabsTrigger value="vehicle" className="gap-2">
                      <Truck className="h-4 w-4" />
                      Vehicles
                    </TabsTrigger>
                    <TabsTrigger value="plant" className="gap-2">
                      <HardHat className="h-4 w-4" />
                      Plant
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {(() => {
                // Filter vehicles based on maintenance filter selection
                const filteredVehicles = (maintenanceData?.vehicles || []).filter(v => {
                  if (maintenanceFilter === 'both') return true;
                  if (maintenanceFilter === 'vehicle') return v.vehicle?.asset_type !== 'plant';
                  if (maintenanceFilter === 'plant') return v.vehicle?.asset_type === 'plant';
                  return true;
                });
                
                // Calculate summary based on filtered vehicles
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
        </TabsContent>

        {/* Plant Tab */}
        <TabsContent value="plant" className="space-y-6">
          {maintenanceLoading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : maintenanceError ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <HardHat className="h-16 w-16 text-red-400 mb-4" />
                <h2 className="text-2xl font-semibold mb-2">Error Loading Plant Data</h2>
                <p className="text-gray-600 text-center max-w-md">
                  {maintenanceError?.message || 'Failed to load plant machinery records'}
                </p>
              </CardContent>
            </Card>
          ) : canManageVehicles ? (
            <PlantTable 
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onVehicleAdded={() => {}}
            />
          ) : (
            <PlantOverview 
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
                vehicles={(maintenanceData?.vehicles || []).filter(v => v.vehicle?.asset_type !== 'plant')}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onVehicleAdded={() => {}}
              />
            )}
          </TabsContent>
        )}

        {/* Settings Tab - Admin/Manager only */}
        {canManageVehicles && (
          <TabsContent value="settings" className="space-y-6">
            {/* Vehicle Categories Section - Admin Only */}
            {isAdmin && (
              <>
                {/* Plant Machinery Categories */}
                <Card className="border-border">
                  <CardHeader 
                    className="cursor-pointer hover:bg-slate-800/30 transition-colors"
                    onClick={() => setPlantCategoriesExpanded(!plantCategoriesExpanded)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <ChevronDown 
                          className={`h-5 w-5 text-muted-foreground transition-transform ${
                            plantCategoriesExpanded ? 'rotate-180' : ''
                          }`}
                        />
                        <div>
                          <CardTitle className="text-white flex items-center gap-2">
                            <HardHat className="h-5 w-5" />
                            Plant Machinery Categories
                          </CardTitle>
                          <CardDescription className="text-muted-foreground">
                            {(() => {
                              const plantCategoryNames = ['All plant'];
                              const plantCategories = categories.filter(c => plantCategoryNames.includes(c.name));
                              return `${plantCategories.length} ${plantCategories.length === 1 ? 'category' : 'categories'}`;
                            })()}
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddCategoryDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Category
                      </Button>
                    </div>
                  </CardHeader>
                  
                {plantCategoriesExpanded && (
                  <CardContent className="pt-6">
                      {categoriesLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                        </div>
                      ) : (() => {
                        // Plant category - single "All plant" category after migration
                        const plantCategoryNames = ['All plant'];
                        const plantCategories = categories.filter(c => plantCategoryNames.includes(c.name));
                        
                        return plantCategories.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            No plant machinery categories found
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {plantCategories.map((category) => (
                              <Card key={category.id} className="bg-slate-800/50 border-border">
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4 flex-1">
                                      <div className="bg-orange-500/10 p-3 rounded-lg">
                                        <HardHat className="h-5 w-5 text-orange-400" />
                                      </div>
                                      <div className="flex-1">
                                        <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                                        <p className="text-sm text-muted-foreground mt-1">
                                          {category.description || 'No description'}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                      <div className="text-right">
                                        <div className="text-2xl font-bold text-orange-400">
                                          {plantAssets.filter(p => p.vehicle_categories?.name === category.name).length}
                                        </div>
                                        <p className="text-xs text-muted-foreground">plant assets</p>
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => openEditCategoryDialog(category)}
                                          className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                          title="Edit Category"
                                        >
                                          <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => openDeleteCategoryDialog(category)}
                                          className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                          title="Delete Category"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        );
                      })()}
                    </CardContent>
                  )}
                </Card>

                {/* Vehicle Categories */}
                <Card className="border-border">
                  <CardHeader 
                    className="cursor-pointer hover:bg-slate-800/30 transition-colors"
                    onClick={() => setVehicleCategoriesExpanded(!vehicleCategoriesExpanded)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <ChevronDown 
                          className={`h-5 w-5 text-muted-foreground transition-transform ${
                            vehicleCategoriesExpanded ? 'rotate-180' : ''
                          }`}
                        />
                        <div>
                          <CardTitle className="text-white flex items-center gap-2">
                            <Truck className="h-5 w-5" />
                            Vehicle Categories
                          </CardTitle>
                          <CardDescription className="text-muted-foreground">
                            {(() => {
                              const plantCategoryNames = [
                                'Excavation & Earthmoving',
                                'Loading & Material Handling',
                                'Compaction, Crushing & Processing',
                                'Transport & Utility Vehicles',
                                'Access & Site Support',
                                'Unclassified'
                              ];
                              const vehicleCategories = categories.filter(c => !plantCategoryNames.includes(c.name));
                              return `${vehicleCategories.length} ${vehicleCategories.length === 1 ? 'category' : 'categories'}`;
                            })()}
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddCategoryDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Category
                      </Button>
                    </div>
                  </CardHeader>
                  
                {vehicleCategoriesExpanded && (
                  <CardContent className="pt-6">
                    {categoriesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      </div>
                    ) : (() => {
                      // Plant category names to exclude
                      const plantCategoryNames = [
                        'Excavation & Earthmoving',
                        'Loading & Material Handling',
                        'Compaction, Crushing & Processing',
                        'Transport & Utility Vehicles',
                        'Access & Site Support',
                        'Unclassified'
                      ];
                      const vehicleCategories = categories.filter(c => !plantCategoryNames.includes(c.name));
                      
                      return vehicleCategories.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No vehicle categories found
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {vehicleCategories.map((category) => (
                            <Card key={category.id} className="bg-slate-800/50 border-border">
                              <CardContent className="p-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-4 flex-1">
                                    <div className="bg-blue-500/10 p-3 rounded-lg">
                                      <Truck className="h-5 w-5 text-blue-400" />
                                    </div>
                                    <div className="flex-1">
                                      <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {category.description || 'No description'}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <div className="text-right">
                                      <div className="text-2xl font-bold text-blue-400">
                                        {vehicles.filter(v => v.vehicle_categories?.name === category.name).length}
                                      </div>
                                      <p className="text-xs text-muted-foreground">vehicles</p>
                                    </div>
                                    <div className="flex gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openEditCategoryDialog(category)}
                                        className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                        title="Edit Category"
                                      >
                                        <Edit className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openDeleteCategoryDialog(category)}
                                        className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                        title="Delete Category"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      );
                    })()}
                    </CardContent>
                  )}
                </Card>
              </>
            )}

            {/* Maintenance Categories Section */}
            <MaintenanceSettings isAdmin={isAdmin} isManager={isManager} />
          </TabsContent>
        )}
      </Tabs>
      
      {/* Vehicle Category Dialogs */}
      <VehicleCategoryDialog
        open={addCategoryDialogOpen}
        onOpenChange={setAddCategoryDialogOpen}
        mode="create"
        onSuccess={handleCategorySuccess}
      />
      
      <VehicleCategoryDialog
        open={editCategoryDialogOpen}
        onOpenChange={setEditCategoryDialogOpen}
        mode="edit"
        category={selectedCategory}
        onSuccess={handleCategorySuccess}
      />
      
      {/* Delete Category Confirmation Dialog */}
      <AlertDialog open={deleteCategoryDialogOpen} onOpenChange={setDeleteCategoryDialogOpen}>
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Vehicle Category
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete this vehicle category? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {selectedCategory && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedCategory.name}</span>
              </p>
              {selectedCategory.description && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Description:</span>{' '}
                  <span className="text-white">{selectedCategory.description}</span>
                </p>
              )}
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel 
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={deletingCategory}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              className="bg-red-600 hover:bg-red-700"
              disabled={deletingCategory}
            >
              {deletingCategory && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
