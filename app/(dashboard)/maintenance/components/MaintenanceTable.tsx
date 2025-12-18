'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Search, 
  Edit, 
  History,
  ArrowUpDown,
  Plus,
  AlertTriangle
} from 'lucide-react';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { 
  getStatusColorClass,
  formatMileage,
  formatMaintenanceDate
} from '@/lib/utils/maintenanceCalculations';
import { EditMaintenanceDialog } from './EditMaintenanceDialog';
import { MaintenanceHistoryDialog } from './MaintenanceHistoryDialog';

interface MaintenanceTableProps {
  vehicles: VehicleMaintenanceWithStatus[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

type SortField = 
  | 'reg_number' 
  | 'current_mileage' 
  | 'tax_due' 
  | 'mot_due' 
  | 'service_due' 
  | 'cambelt_due'
  | 'first_aid_expiry';

type SortDirection = 'asc' | 'desc';

export function MaintenanceTable({ 
  vehicles, 
  searchQuery, 
  onSearchChange
}: MaintenanceTableProps) {
  const [sortField, setSortField] = useState<SortField>('reg_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMaintenanceWithStatus | null>(null);
  
  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  // Sort vehicles
  const sortedVehicles = [...vehicles].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    
    switch (sortField) {
      case 'reg_number':
        return multiplier * (a.vehicle?.reg_number || '').localeCompare(b.vehicle?.reg_number || '');
      
      case 'current_mileage':
        return multiplier * ((a.current_mileage || 0) - (b.current_mileage || 0));
      
      case 'tax_due':
        if (!a.tax_due_date && !b.tax_due_date) return 0;
        if (!a.tax_due_date) return 1;
        if (!b.tax_due_date) return -1;
        return multiplier * (new Date(a.tax_due_date).getTime() - new Date(b.tax_due_date).getTime());
      
      case 'mot_due':
        if (!a.mot_due_date && !b.mot_due_date) return 0;
        if (!a.mot_due_date) return 1;
        if (!b.mot_due_date) return -1;
        return multiplier * (new Date(a.mot_due_date).getTime() - new Date(b.mot_due_date).getTime());
      
      case 'service_due':
        return multiplier * ((a.next_service_mileage || 0) - (b.next_service_mileage || 0));
      
      case 'cambelt_due':
        return multiplier * ((a.cambelt_due_mileage || 0) - (b.cambelt_due_mileage || 0));
      
      case 'first_aid_expiry':
        if (!a.first_aid_kit_expiry && !b.first_aid_kit_expiry) return 0;
        if (!a.first_aid_kit_expiry) return 1;
        if (!b.first_aid_kit_expiry) return -1;
        return multiplier * (new Date(a.first_aid_kit_expiry).getTime() - new Date(b.first_aid_kit_expiry).getTime());
      
      default:
        return 0;
    }
  });
  
  // Count vehicles with missing data
  const missingDataCount = vehicles.filter(v => 
    !v.tax_due_date || !v.mot_due_date || !v.next_service_mileage || !v.first_aid_kit_expiry
  ).length;
  
  return (
    <>
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-slate-900 dark:text-white">
                All Vehicles
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400">
                {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} • Click column headers to sort
              </CardDescription>
            </div>
            <Button 
              className="bg-blue-600 hover:bg-blue-700"
              disabled
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Vehicle
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Warning Banner for Missing Data */}
          {missingDataCount > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">
                    Missing Maintenance Dates
                  </h4>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {missingDataCount} vehicle{missingDataCount !== 1 ? 's have' : ' has'} incomplete maintenance records. 
                    Vehicles without scheduled due dates will not be monitored and may miss critical deadlines. 
                    Please review and update these records.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by registration number..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 bg-white dark:bg-slate-900/50 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
            />
          </div>

          {/* Table */}
          {vehicles.length === 0 ? (
            <div className="text-center py-12 text-slate-600 dark:text-slate-400">
              {searchQuery ? 'No vehicles found matching your search.' : 'No vehicles with maintenance records yet.'}
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50">
                      <TableHead 
                        className="text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => handleSort('reg_number')}
                      >
                        <div className="flex items-center gap-2">
                          Registration
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => handleSort('current_mileage')}
                      >
                        <div className="flex items-center gap-2">
                          Mileage
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => handleSort('tax_due')}
                      >
                        <div className="flex items-center gap-2">
                          Tax Due
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => handleSort('mot_due')}
                      >
                        <div className="flex items-center gap-2">
                          MOT Due
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => handleSort('service_due')}
                      >
                        <div className="flex items-center gap-2">
                          Service Due
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => handleSort('cambelt_due')}
                      >
                        <div className="flex items-center gap-2">
                          Cambelt Due
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => handleSort('first_aid_expiry')}
                      >
                        <div className="flex items-center gap-2">
                          First Aid
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead className="text-right text-slate-700 dark:text-slate-300">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedVehicles.map((vehicle) => (
                      <TableRow 
                        key={vehicle.id}
                        className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        {/* Registration */}
                        <TableCell className="font-medium text-slate-900 dark:text-white">
                          {vehicle.vehicle?.reg_number || 'Unknown'}
                        </TableCell>
                        
                        {/* Current Mileage */}
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          {formatMileage(vehicle.current_mileage)}
                        </TableCell>
                        
                        {/* Tax Due */}
                        <TableCell>
                          <Badge className={`font-medium ${getStatusColorClass(vehicle.tax_status?.status || 'not_set')}`}>
                            {formatMaintenanceDate(vehicle.tax_due_date)}
                          </Badge>
                        </TableCell>
                        
                        {/* MOT Due */}
                        <TableCell>
                          <Badge className={`font-medium ${getStatusColorClass(vehicle.mot_status?.status || 'not_set')}`}>
                            {formatMaintenanceDate(vehicle.mot_due_date)}
                          </Badge>
                        </TableCell>
                        
                        {/* Service Due */}
                        <TableCell>
                          <Badge className={`font-medium ${getStatusColorClass(vehicle.service_status?.status || 'not_set')}`}>
                            {formatMileage(vehicle.next_service_mileage)}
                          </Badge>
                        </TableCell>
                        
                        {/* Cambelt Due */}
                        <TableCell>
                          <Badge className={`font-medium ${getStatusColorClass(vehicle.cambelt_status?.status || 'not_set')}`}>
                            {formatMileage(vehicle.cambelt_due_mileage)}
                          </Badge>
                        </TableCell>
                        
                        {/* First Aid */}
                        <TableCell>
                          <Badge className={`font-medium ${getStatusColorClass(vehicle.first_aid_status?.status || 'not_set')}`}>
                            {formatMaintenanceDate(vehicle.first_aid_kit_expiry)}
                          </Badge>
                        </TableCell>
                        
                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedVehicle(vehicle);
                                setEditDialogOpen(true);
                              }}
                              className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                              title="Edit Maintenance"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedVehicle(vehicle);
                                setHistoryDialogOpen(true);
                              }}
                              className="text-slate-400 hover:text-slate-300 hover:bg-slate-800"
                              title="View History"
                            >
                              <History className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
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
      
      {/* History Dialog */}
      <MaintenanceHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        vehicleId={selectedVehicle?.vehicle_id || null}
        vehicleReg={selectedVehicle?.vehicle?.reg_number}
      />
    </>
  );
}
