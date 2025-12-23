'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Search, 
  Edit, 
  History,
  ArrowUpDown,
  Plus,
  AlertTriangle,
  Trash2,
  Settings2,
  User,
  Info,
  Monitor
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { AddVehicleDialog } from './AddVehicleDialog';
import { DeleteVehicleDialog } from './DeleteVehicleDialog';
import { 
  getStatusColorClass,
  formatMileage,
  formatMaintenanceDate
} from '@/lib/utils/maintenanceCalculations';
import { EditMaintenanceDialog } from './EditMaintenanceDialog';
import { MaintenanceHistoryDialog } from './MaintenanceHistoryDialog';
import { DVLASyncButton } from './DVLASyncButton';
import { DVLA_EXCLUDED_REG_NUMBERS } from '@/lib/constants';

interface MaintenanceTableProps {
  vehicles: VehicleMaintenanceWithStatus[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onVehicleAdded?: () => void;
}

type SortField = 
  | 'reg_number'
  | 'nickname'
  | 'current_mileage' 
  | 'tax_due' 
  | 'mot_due' 
  | 'service_due' 
  | 'cambelt_due'
  | 'first_aid_expiry';

type SortDirection = 'asc' | 'desc';

interface ColumnVisibility {
  nickname: boolean;
  current_mileage: boolean;
  tax_due: boolean;
  mot_due: boolean;
  service_due: boolean;
  cambelt_due: boolean;
  first_aid_expiry: boolean;
}

export function MaintenanceTable({ 
  vehicles, 
  searchQuery, 
  onSearchChange,
  onVehicleAdded
}: MaintenanceTableProps) {
  const [sortField, setSortField] = useState<SortField>('reg_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMaintenanceWithStatus | null>(null);
  
  // Column visibility state - all columns visible by default
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>({
    nickname: true,
    current_mileage: true,
    tax_due: true,
    mot_due: true,
    service_due: true,
    cambelt_due: true,
    first_aid_expiry: true,
  });
  
  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };
  
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
      
      case 'nickname':
        return multiplier * (a.vehicle?.nickname || '').localeCompare(b.vehicle?.nickname || '');
      
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
  
  return (
    <>
      {/* Mobile Info Banner */}
      <Alert className="md:hidden bg-blue-900/20 border-blue-700/50 mb-4">
        <Monitor className="h-4 w-4 text-blue-400" />
        <AlertDescription className="text-blue-200 text-sm">
          Mobile view shows essential information only. Desktop recommended for complete data and advanced features.
        </AlertDescription>
      </Alert>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">
                All Vehicles
              </CardTitle>
              <CardDescription className="text-slate-400">
                {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} • Click column headers to sort
              </CardDescription>
            </div>
            <Button 
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setAddVehicleDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2 hidden md:inline" />
              <span className="hidden md:inline">Add Vehicle</span>
              <Plus className="h-4 w-4 md:hidden" />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          
          {/* Search Bar and Column Filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by registration number..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9 bg-slate-900/50 border-slate-600 text-white"
              />
            </div>
            
            {/* Column Visibility Dropdown - Hidden on Mobile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="border-slate-600 hidden md:flex">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Show columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-slate-900 border border-slate-700">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.nickname}
                  onCheckedChange={() => toggleColumn('nickname')}
                >
                  Nickname
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.current_mileage}
                  onCheckedChange={() => toggleColumn('current_mileage')}
                >
                  Mileage
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.tax_due}
                  onCheckedChange={() => toggleColumn('tax_due')}
                >
                  Tax Due
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.mot_due}
                  onCheckedChange={() => toggleColumn('mot_due')}
                >
                  MOT Due
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.service_due}
                  onCheckedChange={() => toggleColumn('service_due')}
                >
                  Service Due
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.cambelt_due}
                  onCheckedChange={() => toggleColumn('cambelt_due')}
                >
                  Cambelt Due
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.first_aid_expiry}
                  onCheckedChange={() => toggleColumn('first_aid_expiry')}
                >
                  First Aid
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop Table View */}
          {vehicles.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              {searchQuery ? 'No vehicles found matching your search.' : 'No vehicles with maintenance records yet.'}
            </div>
          ) : (
            <div className="hidden md:block border border-slate-700 rounded-lg">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead 
                        className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                        style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                        onClick={() => handleSort('reg_number')}
                      >
                        <div className="flex items-center gap-2">
                          Registration
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      {columnVisibility.nickname && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('nickname')}
                        >
                          <div className="flex items-center gap-2">
                            Nickname
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.current_mileage && (
                      <TableHead 
                          className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('current_mileage')}
                        >
                          <div className="flex items-center gap-2">
                            Mileage
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.tax_due && (
                      <TableHead 
                          className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('tax_due')}
                        >
                          <div className="flex items-center gap-2">
                            Tax Due
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.mot_due && (
                      <TableHead 
                          className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('mot_due')}
                        >
                          <div className="flex items-center gap-2">
                            MOT Due
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.service_due && (
                      <TableHead 
                          className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('service_due')}
                        >
                          <div className="flex items-center gap-2">
                            Service Due
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.cambelt_due && (
                      <TableHead 
                          className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('cambelt_due')}
                        >
                          <div className="flex items-center gap-2">
                            Cambelt Due
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.first_aid_expiry && (
                      <TableHead 
                          className="sticky z-30 bg-slate-900 text-slate-300 cursor-pointer hover:bg-slate-800 border-b-2 border-slate-700"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('first_aid_expiry')}
                        >
                          <div className="flex items-center gap-2">
                            First Aid
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      <TableHead 
                        className="sticky z-30 bg-slate-900 text-right text-slate-300 border-b-2 border-slate-700"
                        style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                      >
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedVehicles.map((vehicle) => (
                      <TableRow 
                        key={vehicle.id || vehicle.vehicle_id || vehicle.vehicle?.id}
                        onClick={() => {
                          setSelectedVehicle(vehicle);
                          setHistoryDialogOpen(true);
                        }}
                        className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                      >
                        {/* Registration */}
                        <TableCell className="font-medium text-white">
                          {vehicle.vehicle?.reg_number || 'Unknown'}
                        </TableCell>
                        
                        {/* Nickname */}
                        {columnVisibility.nickname && (
                          <TableCell className="text-slate-300">
                            {vehicle.vehicle?.nickname || (
                              <span className="text-slate-400 italic">No nickname</span>
                            )}
                          </TableCell>
                        )}
                        
                        {/* Current Mileage */}
                        {columnVisibility.current_mileage && (
                          <TableCell className="text-slate-300">
                            {formatMileage(vehicle.current_mileage)}
                          </TableCell>
                        )}
                        
                        {/* Tax Due */}
                        {columnVisibility.tax_due && (
                          <TableCell>
                            <Badge className={`font-medium ${getStatusColorClass(vehicle.tax_status?.status || 'not_set')}`}>
                              {formatMaintenanceDate(vehicle.tax_due_date)}
                            </Badge>
                          </TableCell>
                        )}
                        
                        {/* MOT Due */}
                        {columnVisibility.mot_due && (
                          <TableCell>
                            <Badge className={`font-medium ${getStatusColorClass(vehicle.mot_status?.status || 'not_set')}`}>
                              {formatMaintenanceDate(vehicle.mot_due_date)}
                            </Badge>
                          </TableCell>
                        )}
                        
                        {/* Service Due */}
                        {columnVisibility.service_due && (
                          <TableCell>
                            <Badge className={`font-medium ${getStatusColorClass(vehicle.service_status?.status || 'not_set')}`}>
                              {formatMileage(vehicle.next_service_mileage)}
                            </Badge>
                          </TableCell>
                        )}
                        
                        {/* Cambelt Due */}
                        {columnVisibility.cambelt_due && (
                          <TableCell>
                            <Badge className={`font-medium ${getStatusColorClass(vehicle.cambelt_status?.status || 'not_set')}`}>
                              {formatMileage(vehicle.cambelt_due_mileage)}
                            </Badge>
                          </TableCell>
                        )}
                        
                        {/* First Aid */}
                        {columnVisibility.first_aid_expiry && (
                          <TableCell>
                            <Badge className={`font-medium ${getStatusColorClass(vehicle.first_aid_status?.status || 'not_set')}`}>
                              {formatMaintenanceDate(vehicle.first_aid_kit_expiry)}
                            </Badge>
                          </TableCell>
                        )}
                        
                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {!DVLA_EXCLUDED_REG_NUMBERS.includes(vehicle.vehicle?.reg_number || '') && (
                              <DVLASyncButton
                                vehicleId={vehicle.vehicle_id}
                                registrationNumber={vehicle.vehicle?.reg_number || 'Unknown'}
                                lastSync={vehicle.last_dvla_sync}
                                syncStatus={vehicle.dvla_sync_status}
                                onSyncComplete={onVehicleAdded}
                              />
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent row click
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
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent row click
                                setSelectedVehicle(vehicle);
                                setDeleteDialogOpen(true);
                              }}
                              className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                              title="Delete Vehicle"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </div>
          )}

          {/* Mobile Card View */}
          {vehicles.length > 0 && (
            <div className="md:hidden space-y-3">
              {sortedVehicles.map((vehicle) => (
                <Card key={vehicle.vehicle_id} className="bg-slate-800 border-slate-700">
                  <CardContent className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-white text-lg">{vehicle.vehicle?.reg_number}</h3>
                        {vehicle.vehicle?.nickname && (
                          <p className="text-sm text-slate-400">{vehicle.vehicle.nickname}</p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedVehicle(vehicle);
                            setHistoryDialogOpen(true);
                          }}
                          className="h-8 w-8 p-0"
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedVehicle(vehicle);
                            setEditDialogOpen(true);
                          }}
                          className="h-8 w-8 p-0"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Status Grid */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">Tax Due:</span>
                        <Badge className={`font-medium ${getStatusColorClass(vehicle.tax_status?.status || 'not_set')}`}>
                          {formatMaintenanceDate(vehicle.tax_due_date)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">MOT Due:</span>
                        <Badge className={`font-medium ${getStatusColorClass(vehicle.mot_status?.status || 'not_set')}`}>
                          {formatMaintenanceDate(vehicle.mot_due_date)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">Next Service:</span>
                        <Badge className={`font-medium ${getStatusColorClass(vehicle.next_service_status?.status || 'not_set')}`}>
                          {formatMileage(vehicle.next_service_mileage)}
                        </Badge>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2 border-t border-slate-700">
                      {!DVLA_EXCLUDED_REG_NUMBERS.includes(vehicle.vehicle?.reg_number || '') && (
                        <DVLASyncButton
                          vehicleId={vehicle.vehicle_id}
                          registrationNumber={vehicle.vehicle?.reg_number || 'Unknown'}
                          lastSync={vehicle.last_dvla_sync}
                          syncStatus={vehicle.dvla_sync_status}
                          onSyncComplete={onVehicleAdded}
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedVehicle(vehicle);
                          setDeleteDialogOpen(true);
                        }}
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/20 ml-auto"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
        onEditClick={() => {
          setHistoryDialogOpen(false);
          setEditDialogOpen(true);
        }}
      />
      
      {/* Add Vehicle Dialog */}
      <AddVehicleDialog
        open={addVehicleDialogOpen}
        onOpenChange={setAddVehicleDialogOpen}
        onSuccess={() => {
          setAddVehicleDialogOpen(false);
          onVehicleAdded?.();
        }}
      />
      
      {/* Delete Vehicle Dialog */}
      <DeleteVehicleDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        vehicle={selectedVehicle ? {
          id: selectedVehicle.vehicle_id,
          reg_number: selectedVehicle.vehicle?.reg_number || 'Unknown',
          category: selectedVehicle.vehicle?.category_id ? { name: 'Vehicle' } : null
        } : null}
        onSuccess={() => {
          setDeleteDialogOpen(false);
          setSelectedVehicle(null);
          onVehicleAdded?.(); // Refresh the list
        }}
      />
    </>
  );
}
