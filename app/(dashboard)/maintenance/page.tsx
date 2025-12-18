'use client';

import { useState, Suspense } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { Loader2, Wrench, AlertTriangle, Settings } from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { MaintenanceOverview } from './components/MaintenanceOverview';
import { MaintenanceTable } from './components/MaintenanceTable';

function MaintenanceContent() {
  // 1. Hooks
  const { profile, isManager, isAdmin } = useAuth();
  const { isOnline } = useOfflineSync();
  
  // 2. State
  const [searchQuery, setSearchQuery] = useState('');
  
  // 3. Data - fetch all maintenance records
  const { data: maintenanceData, isLoading, error } = useMaintenance();
  
  // 4. Check permissions - using RBAC
  // For now, only managers and admins have access
  // TODO: Check role_permissions for 'maintenance' module
  const hasAccess = isManager || isAdmin;
  
  // 5. Guards
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
  
  // 7. Render
  return (
    <div className="space-y-6 max-w-7xl">
      {!isOnline && <OfflineBanner />}
      
      {/* Header */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-white text-3xl">
                <Wrench className="h-8 w-8" />
                Vehicle Maintenance & Service
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400 mt-2">
                Track and manage all vehicle maintenance schedules
              </CardDescription>
            </div>
            {(isAdmin || isManager) && (
              <Button
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
                disabled
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            )}
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
        <>
          {/* Alert Overview */}
          <MaintenanceOverview 
            vehicles={maintenanceData?.vehicles || []}
            summary={maintenanceData?.summary || { total: 0, overdue: 0, due_soon: 0 }}
          />
          
          {/* Main Table */}
          <MaintenanceTable
            vehicles={filteredVehicles}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isLoading={isLoading}
          />
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
