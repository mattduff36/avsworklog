'use client';

import { useState, Suspense } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { Loader2, Wrench, AlertTriangle } from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { MaintenanceOverview } from './components/MaintenanceOverview';
import { MaintenanceTable } from './components/MaintenanceTable';
import { MaintenanceSettings } from './components/MaintenanceSettings';
import { EditMaintenanceDialog } from './components/EditMaintenanceDialog';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';

function MaintenanceContent() {
  // 1. Hooks
  const { isManager, isAdmin, isSuperAdmin } = useAuth();
  const { isOnline } = useOfflineSync();
  
  // 2. State
  const [searchQuery, setSearchQuery] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMaintenanceWithStatus | null>(null);
  
  // 3. Data - fetch all maintenance records
  const { data: maintenanceData, isLoading, error } = useMaintenance();
  
  // 4. Handler for opening edit dialog
  const handleVehicleClick = (vehicle: VehicleMaintenanceWithStatus) => {
    setSelectedVehicle(vehicle);
    setEditDialogOpen(true);
  };
  
  // 5. Check permissions - using RBAC via has_maintenance_permission() function
  // SuperAdmin/Managers/Admins have full access, employees need 'maintenance' module permission
  // RLS also enforces this at database level
  const hasAccess = isSuperAdmin || isManager || isAdmin;
  
  // 6. Guards
  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have permission to access vehicle maintenance & service.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }
  
  if (error) {
    logger.error('Failed to load maintenance data', error, 'MaintenancePage');
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Error Loading Data
            </CardTitle>
            <CardDescription>
              Failed to load maintenance records. Please try refreshing the page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.reload()} variant="outline">
              Refresh Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  // 6. Filter vehicles based on search
  const filteredVehicles = maintenanceData?.vehicles.filter(vehicle => 
    vehicle.vehicle?.reg_number?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];
  
  // 8. Render
  return (
    <div className="space-y-6 max-w-7xl">
      {!isOnline && <OfflineBanner />}
      
      {/* Header */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wrench className="h-8 w-8 text-red-500" />
            <div>
              <CardTitle className="text-slate-900 dark:text-white text-3xl">
                Vehicle Maintenance & Service
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400 mt-2">
                Track and manage all vehicle maintenance schedules
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
      
      {/* Loading State */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-3" />
              <p className="text-slate-600 dark:text-slate-400">Loading maintenance records...</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="maintenance" className="space-y-4">
          <TabsList className="bg-slate-100 dark:bg-slate-800">
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            <TabsTrigger value="settings" disabled={!isSuperAdmin && !isAdmin && !isManager}>
              Settings {!isSuperAdmin && !isAdmin && !isManager && '(Admin Only)'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="maintenance" className="space-y-6">
            {/* Alert Overview */}
            <MaintenanceOverview 
              vehicles={maintenanceData?.vehicles || []}
              summary={maintenanceData?.summary || { total: 0, overdue: 0, due_soon: 0 }}
              onVehicleClick={handleVehicleClick}
            />
            
            {/* Main Table */}
            <MaintenanceTable
              vehicles={filteredVehicles}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
            />
            
            {/* Edit Dialog */}
            <EditMaintenanceDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              vehicle={selectedVehicle}
              onSuccess={() => {
                setEditDialogOpen(false);
                setSelectedVehicle(null);
              }}
            />
          </TabsContent>

          <TabsContent value="settings">
            <MaintenanceSettings
              isAdmin={isAdmin || isSuperAdmin}
              isManager={isManager}
            />
          </TabsContent>
        </Tabs>
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
