'use client';

import { useEffect, useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Wrench, Truck, Settings, Plus, Edit, Trash2, AlertTriangle, HardHat, ChevronDown } from 'lucide-react';
import { logger } from '@/lib/utils/logger';

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
import { VehicleCategoryDialog } from './components/VehicleCategoryDialog';
import { HgvCategoryDialog } from './components/HgvCategoryDialog';
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
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
  category_id: string;
  van_categories?: { name: string; id: string } | null;
};

type Category = {
  id: string;
  name: string;
  description: string | null;
  applies_to?: string[];
};

type HgvCategory = {
  id: string;
  name: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
};

type HgvAsset = {
  id: string;
  reg_number: string | null;
  nickname: string | null;
  status: string;
  category_id: string | null;
  hgv_categories?: { name: string; id: string } | null;
};

type PlantAsset = {
  id: string;
  plant_id: string;
  nickname: string | null;
  status: string;
  category_id: string | null;
  van_categories?: { name: string; id: string } | null;
};

function FleetContent() {
  const searchParams = useSearchParams();
  const router = useNextRouter();
  const { profile, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const supabase = createClient();
  
  // Initialize to default - useEffect will sync with URL to prevent hydration mismatch
  const [activeTab, setActiveTab] = useState('vans');
  const [hasModulePermission, setHasModulePermission] = useState<boolean | null>(null);
  
  // Vehicle Category Dialog States
  const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false);
  const [editCategoryDialogOpen, setEditCategoryDialogOpen] = useState(false);
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  
  // HGV Category Dialog States
  const [addHgvCategoryDialogOpen, setAddHgvCategoryDialogOpen] = useState(false);
  const [editHgvCategoryDialogOpen, setEditHgvCategoryDialogOpen] = useState(false);
  const [deleteHgvCategoryDialogOpen, setDeleteHgvCategoryDialogOpen] = useState(false);
  const [selectedHgvCategory, setSelectedHgvCategory] = useState<HgvCategory | null>(null);
  const [deletingHgvCategory, setDeletingHgvCategory] = useState(false);
  
  // Helper function to validate if user can access a tab
  const canAccessTab = (tab: string): boolean => {
    const fleetTabs = ['vans', 'plant', 'hgvs', 'settings'];
    return fleetTabs.includes(tab);
  };
  
  // Validate and set activeTab based on permissions and URL
  useEffect(() => {
    if (authLoading) return;
    
    const defaultTab = 'vans';
    const requestedTab = searchParams.get('tab') || defaultTab;
    
    // Legacy redirect: tab=maintenance now lives on /maintenance
    if (requestedTab === 'maintenance') {
      router.replace('/maintenance');
      return;
    }

    // Legacy redirect: tab=vehicles was renamed to tab=vans
    if (requestedTab === 'vehicles') {
      router.replace('/fleet?tab=vans', { scroll: false });
      return;
    }
    
    if (canAccessTab(requestedTab)) {
      setActiveTab(requestedTab);
    } else {
      const fallbackTab = defaultTab;
      setActiveTab(fallbackTab);
      router.push(`/fleet?tab=${fallbackTab}`, { scroll: false });
    }
  }, [searchParams, authLoading, isManager, isAdmin, isSuperAdmin, router]);
  // Fetch maintenance data
  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();
  
  // State for vehicles and categories
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [plantAssets, setPlantAssets] = useState<PlantAsset[]>([]); // Separate state for plant assets
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  
  // State for collapsible category sections
  const [plantCategoriesExpanded, setPlantCategoriesExpanded] = useState(false);
  const [vanCategoriesExpanded, setVanCategoriesExpanded] = useState(false);
  const [hgvCategoriesExpanded, setHgvCategoriesExpanded] = useState(false);
  
  // HGV categories and assets state
  const [hgvCategories, setHgvCategories] = useState<HgvCategory[]>([]);
  const [hgvCategoriesLoading, setHgvCategoriesLoading] = useState(false);
  const [hgvAssets, setHgvAssets] = useState<HgvAsset[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch vehicles
  const fetchVehicles = async () => {
    try {
      const response = await fetch('/api/admin/vans');
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
        .select('id, plant_id, nickname, status, category_id, van_categories(name, id)')
        .eq('status', 'active');
      
      if (error) throw error;
      setPlantAssets(data || []);
    } catch (error) {
      logger.error('Failed to fetch plant assets', error, 'FleetPage');
    }
  };

  // Fetch HGV categories
  const fetchHgvCategories = async () => {
    try {
      setHgvCategoriesLoading(true);
      const response = await fetch('/api/admin/hgv-categories');
      const data = await response.json();
      if (response.ok) {
        setHgvCategories(data.categories || []);
      }
    } catch (error) {
      logger.error('Failed to fetch HGV categories', error, 'FleetPage');
    } finally {
      setHgvCategoriesLoading(false);
    }
  };

  // Fetch HGV assets
  const fetchHgvAssets = async () => {
    try {
      const { data, error } = await supabase
        .from('hgvs')
        .select('id, reg_number, nickname, status, category_id, hgv_categories(name, id)')
        .eq('status', 'active')
        .order('reg_number', { ascending: true });

      if (error) throw error;
      setHgvAssets(data || []);
    } catch (error) {
      logger.error('Failed to fetch HGV assets', error, 'FleetPage');
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
    if (activeTab === 'plant') {
      if (plantAssets.length === 0) fetchPlantAssets();
    } else if (activeTab === 'vans') {
      if (vehicles.length === 0) fetchVehicles();
      if (categories.length === 0) fetchCategories();
    } else if (activeTab === 'hgvs') {
      if (hgvAssets.length === 0) fetchHgvAssets();
    } else if (activeTab === 'settings') {
      if (categories.length === 0) fetchCategories();
      if (vehicles.length === 0) fetchVehicles();
      if (plantAssets.length === 0) fetchPlantAssets();
      if (hgvCategories.length === 0) fetchHgvCategories();
      if (hgvAssets.length === 0) fetchHgvAssets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  
  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    // Validate tab access before changing
    if (!canAccessTab(value)) {
      logger.warn(`Attempted to access restricted tab: ${value}`, 'FleetPage');
      return;
    }
    
    setActiveTab(value);
    router.push(`/fleet?tab=${value}`, { scroll: false });
    
    // Fetch data when switching to tabs
    if (value === 'plant') {
      if (plantAssets.length === 0) fetchPlantAssets();
    } else if (value === 'vans') {
      if (vehicles.length === 0) fetchVehicles();
      if (categories.length === 0) fetchCategories();
    } else if (value === 'hgvs') {
      if (hgvAssets.length === 0) fetchHgvAssets();
    } else if (value === 'settings') {
      if (categories.length === 0) fetchCategories();
      if (vehicles.length === 0) fetchVehicles();
      if (plantAssets.length === 0) fetchPlantAssets();
      if (hgvCategories.length === 0) fetchHgvCategories();
      if (hgvAssets.length === 0) fetchHgvAssets();
    }
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
      
      toast.success('Category deleted successfully');
      setDeleteCategoryDialogOpen(false);
      setSelectedCategory(null);
      fetchCategories(); // Refresh categories
    } catch (error: unknown) {
      console.error('Error deleting category:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete category');
    } finally {
      setDeletingCategory(false);
    }
  };
  
  const handleCategorySuccess = () => {
    fetchCategories();
  };
  
  // HGV Category Dialog Handlers
  const openEditHgvCategoryDialog = (category: HgvCategory) => {
    setSelectedHgvCategory(category);
    setEditHgvCategoryDialogOpen(true);
  };
  
  const openDeleteHgvCategoryDialog = (category: HgvCategory) => {
    setSelectedHgvCategory(category);
    setDeleteHgvCategoryDialogOpen(true);
  };
  
  const handleDeleteHgvCategory = async () => {
    if (!selectedHgvCategory) return;
    
    setDeletingHgvCategory(true);
    
    try {
      const response = await fetch(`/api/admin/hgv-categories/${selectedHgvCategory.id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete HGV category');
      }
      
      toast.success('HGV category deleted successfully');
      setDeleteHgvCategoryDialogOpen(false);
      setSelectedHgvCategory(null);
      fetchHgvCategories();
    } catch (error: unknown) {
      console.error('Error deleting HGV category:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete HGV category');
    } finally {
      setDeletingHgvCategory(false);
    }
  };
  
  const handleHgvCategorySuccess = () => {
    fetchHgvCategories();
  };
  
  // Check access
  const hasAccess = hasModulePermission;
  
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
              Manage vans, HGVs, plant machinery, and fleet operations
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full lg:w-auto lg:inline-grid grid-cols-4">
          <TabsTrigger value="vans" className="gap-2">
            <Truck className="h-4 w-4" />
            Vans
          </TabsTrigger>
          <TabsTrigger value="plant" className="gap-2">
            <HardHat className="h-4 w-4" />
            Plant
          </TabsTrigger>
          <TabsTrigger value="hgvs" className="gap-2">
            <Truck className="h-4 w-4" />
            HGVs
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

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
          ) : (
            <PlantTable 
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onVehicleAdded={fetchPlantAssets}
            />
          )}
        </TabsContent>

        {/* Vans Tab - Admin/Manager only */}
        <TabsContent value="vans" className="space-y-6">
            {maintenanceLoading ? (
              <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : maintenanceError ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Wrench className="h-16 w-16 text-red-400 mb-4" />
                  <h2 className="text-2xl font-semibold mb-2">Error Loading Van Data</h2>
                  <p className="text-gray-600 text-center max-w-md">
                    {maintenanceError?.message || 'Failed to load van records'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <MaintenanceTable 
                vehicles={(maintenanceData?.vehicles || []).filter(v => v.vehicle?.asset_type === 'van')}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onVehicleAdded={() => {}}
              />
            )}
        </TabsContent>

        {/* HGVs Tab - Admin/Manager only */}
        <TabsContent value="hgvs" className="space-y-6">
            {maintenanceLoading ? (
              <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : maintenanceError ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Truck className="h-16 w-16 text-red-400 mb-4" />
                  <h2 className="text-2xl font-semibold mb-2">Error Loading HGV Data</h2>
                  <p className="text-gray-600 text-center max-w-md">
                    {maintenanceError?.message || 'Failed to load HGV records'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <MaintenanceTable 
                vehicles={(maintenanceData?.vehicles || []).filter(v => v.vehicle?.asset_type === 'hgv')}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onVehicleAdded={() => {}}
                assetLabel="HGV"
              />
            )}
        </TabsContent>

        {/* Settings Tab - Admin/Manager only */}
        <TabsContent value="settings" className="space-y-6">
            {/* Van Categories Section - Admin Only */}
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
                              const plantCategories = categories.filter(c => 
                                (c.applies_to || []).includes('plant')
                              );
                              return `${plantCategories.length} ${plantCategories.length === 1 ? 'category' : 'categories'}`;
                            })()}
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-fleet hover:bg-fleet-dark"
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
                        const plantCategories = categories.filter(c => 
                          (c.applies_to || []).includes('plant')
                        );
                        
                        return plantCategories.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            No plant machinery categories found
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {plantCategories.map((category) => {
                              const plantCount = plantAssets.filter(p => p.category_id === category.id).length;
                              return (
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
                                          {plantCount}
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
                            )})}
                          </div>
                        );
                      })()}
                    </CardContent>
                  )}
                </Card>

                {/* Van Categories */}
                <Card className="border-border">
                  <CardHeader 
                    className="cursor-pointer hover:bg-slate-800/30 transition-colors"
                    onClick={() => setVanCategoriesExpanded(!vanCategoriesExpanded)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <ChevronDown 
                          className={`h-5 w-5 text-muted-foreground transition-transform ${
                            vanCategoriesExpanded ? 'rotate-180' : ''
                          }`}
                        />
                        <div>
                          <CardTitle className="text-white flex items-center gap-2">
                            <Truck className="h-5 w-5" />
                            Van Categories
                          </CardTitle>
                          <CardDescription className="text-muted-foreground">
                            {(() => {
                              const vanCategories = categories.filter(c => 
                                (c.applies_to || ['van']).includes('van')
                              );
                              return `${vanCategories.length} ${vanCategories.length === 1 ? 'category' : 'categories'}`;
                            })()}
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-fleet hover:bg-fleet-dark"
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
                  
                {vanCategoriesExpanded && (
                  <CardContent className="pt-6">
                    {categoriesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      </div>
                    ) : (() => {
                      const vanCategories = categories.filter(c => {
                        return (c.applies_to || ['van']).includes('van');
                      });
                      
                      return vanCategories.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No van categories found
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {vanCategories.map((category) => (
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
                                        {vehicles.filter(v => v.category_id === category.id).length}
                                      </div>
                                      <p className="text-xs text-muted-foreground">vans</p>
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

                {/* HGV Categories */}
                <Card className="border-border">
                  <CardHeader 
                    className="cursor-pointer hover:bg-slate-800/30 transition-colors"
                    onClick={() => setHgvCategoriesExpanded(!hgvCategoriesExpanded)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <ChevronDown 
                          className={`h-5 w-5 text-muted-foreground transition-transform ${
                            hgvCategoriesExpanded ? 'rotate-180' : ''
                          }`}
                        />
                        <div>
                          <CardTitle className="text-white flex items-center gap-2">
                            <Truck className="h-5 w-5" />
                            HGV Categories
                          </CardTitle>
                          <CardDescription className="text-muted-foreground">
                            {`${hgvCategories.length} ${hgvCategories.length === 1 ? 'category' : 'categories'}`}
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-fleet hover:bg-fleet-dark"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddHgvCategoryDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Category
                      </Button>
                    </div>
                  </CardHeader>
                  
                  {hgvCategoriesExpanded && (
                    <CardContent className="pt-6">
                      {hgvCategoriesLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                        </div>
                      ) : hgvCategories.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No HGV categories found
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {hgvCategories.map((category) => {
                            const hgvCount = hgvAssets.filter(h => h.category_id === category.id).length;
                            return (
                              <Card key={category.id} className="bg-slate-800/50 border-border">
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4 flex-1">
                                      <div className="bg-emerald-500/10 p-3 rounded-lg">
                                        <Truck className="h-5 w-5 text-emerald-400" />
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
                                        <div className="text-2xl font-bold text-emerald-400">
                                          {hgvCount}
                                        </div>
                                        <p className="text-xs text-muted-foreground">HGVs</p>
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => openEditHgvCategoryDialog(category)}
                                          className="text-emerald-400 hover:text-emerald-300 hover:bg-slate-800"
                                          title="Edit Category"
                                        >
                                          <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => openDeleteHgvCategoryDialog(category)}
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
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              </>
            )}

        </TabsContent>
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
      
      {/* HGV Category Dialogs */}
      <HgvCategoryDialog
        open={addHgvCategoryDialogOpen}
        onOpenChange={setAddHgvCategoryDialogOpen}
        mode="create"
        onSuccess={handleHgvCategorySuccess}
      />
      
      <HgvCategoryDialog
        open={editHgvCategoryDialogOpen}
        onOpenChange={setEditHgvCategoryDialogOpen}
        mode="edit"
        category={selectedHgvCategory}
        onSuccess={handleHgvCategorySuccess}
      />
      
      {/* Delete HGV Category Confirmation Dialog */}
      <AlertDialog open={deleteHgvCategoryDialogOpen} onOpenChange={setDeleteHgvCategoryDialogOpen}>
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete HGV Category
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete this HGV category? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {selectedHgvCategory && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedHgvCategory.name}</span>
              </p>
              {selectedHgvCategory.description && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Description:</span>{' '}
                  <span className="text-white">{selectedHgvCategory.description}</span>
                </p>
              )}
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel 
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={deletingHgvCategory}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteHgvCategory}
              className="bg-red-600 hover:bg-red-700"
              disabled={deletingHgvCategory}
            >
              {deletingHgvCategory && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Category Confirmation Dialog */}
      <AlertDialog open={deleteCategoryDialogOpen} onOpenChange={setDeleteCategoryDialogOpen}>
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Category
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete this category? This action cannot be undone.
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
