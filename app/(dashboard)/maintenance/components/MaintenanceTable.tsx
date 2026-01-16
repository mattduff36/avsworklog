'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Settings2,
  Monitor,
  ChevronDown,
  ChevronUp,
  Loader2,
  FolderClock,
  XCircle,
  Archive,
  Undo2
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
import { useDeletedVehicles, usePermanentlyDeleteArchivedVehicle, useRestoreArchivedVehicle } from '@/lib/hooks/useMaintenance';
import { useAuth } from '@/lib/hooks/useAuth';

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
  const router = useRouter();
  const { isAdmin, isManager } = useAuth();
  const [sortField, setSortField] = useState<SortField>('reg_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMaintenanceWithStatus | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [retiredSearchQuery, setRetiredSearchQuery] = useState('');
  
  // Track pending operations per vehicle ID
  const [pendingRestore, setPendingRestore] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());
  
  // Fetch retired vehicles
  const { data: retiredData, isLoading: retiredLoading } = useDeletedVehicles();
  const permanentlyDelete = usePermanentlyDeleteArchivedVehicle();
  const restoreVehicle = useRestoreArchivedVehicle();
  
  // Handlers with per-vehicle loading state
  const handleRestore = (vehicleId: string, regNumber: string) => {
    if (confirm(`Restore ${regNumber} to active vehicles?\n\nThis will:\n• Move vehicle back to Active Vehicles tab\n• Restore all maintenance data\n\nContinue?`)) {
      setPendingRestore(prev => new Set(prev).add(vehicleId));
      restoreVehicle.mutate(vehicleId, {
        onSettled: () => {
          setPendingRestore(prev => {
            const next = new Set(prev);
            next.delete(vehicleId);
            return next;
          });
        },
      });
    }
  };
  
  const handlePermanentDelete = (vehicleId: string, regNumber: string) => {
    if (confirm(`⚠️ Permanently remove ${regNumber}?\n\nThis will:\n• Remove from Retired Vehicles tab\n• Preserve all inspection history\n• Cannot be undone\n\nContinue?`)) {
      setPendingDelete(prev => new Set(prev).add(vehicleId));
      permanentlyDelete.mutate(vehicleId, {
        onSettled: () => {
          setPendingDelete(prev => {
            const next = new Set(prev);
            next.delete(vehicleId);
            return next;
          });
        },
      });
    }
  };
  
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
          
          {/* Internal Tabs for Active vs Retired Vehicles */}
          <Tabs defaultValue="active" className="w-full">
            <TabsList className="bg-slate-800 border-slate-700">
              <TabsTrigger value="active" className="data-[state=active]:bg-slate-700">
                Active Vehicles ({vehicles.length})
              </TabsTrigger>
              <TabsTrigger value="deleted" className="data-[state=active]:bg-slate-700 flex items-center gap-2">
                <FolderClock className="h-4 w-4" />
                Retired Vehicles ({retiredData?.count || 0})
              </TabsTrigger>
            </TabsList>
            
            {/* Active Vehicles Tab */}
            <TabsContent value="active" className="space-y-4 mt-4">
              {/* Search Bar and Column Filter */}
              <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by registration number..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-11 bg-slate-900/50 border-slate-600 text-white"
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedVehicles.map((vehicle) => (
                      <TableRow 
                        key={vehicle.id || vehicle.vehicle_id || vehicle.vehicle?.id}
                        onClick={() => {
                          const vehicleId = vehicle.vehicle_id || vehicle.id;
                          if (vehicleId) {
                            router.push(`/fleet/vehicles/${vehicleId}/history`);
                          }
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </div>
          )}

          {/* Mobile Card View */}
          {vehicles.length > 0 && (
            <div className="md:hidden space-y-3">
              {sortedVehicles.map((vehicle) => {
                const isExpanded = expandedCardId === vehicle.vehicle_id;
                
                return (
                  <Card 
                    key={vehicle.vehicle_id} 
                    id={`vehicle-card-${vehicle.vehicle_id}`}
                    className="bg-slate-800 border-slate-700 transition-all duration-200"
                  >
                    <CardContent className="p-4">
                      {/* Collapsed View - Click to Expand */}
                      <div 
                        onClick={() => {
                          if (!isExpanded) {
                            setExpandedCardId(vehicle.vehicle_id);
                            // Scroll to top of card after expansion
                            setTimeout(() => {
                              const card = document.getElementById(`vehicle-card-${vehicle.vehicle_id}`);
                              if (card) {
                                const navbarHeight = 68; // Approximate navbar height
                                const padding = 16;
                                const yOffset = -(navbarHeight + padding);
                                const y = card.getBoundingClientRect().top + window.pageYOffset + yOffset;
                                window.scrollTo({ top: y, behavior: 'smooth' });
                              }
                            }, 100);
                          } else {
                            setExpandedCardId(null);
                          }
                        }}
                        className="cursor-pointer"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex-1">
                            <h3 className="font-semibold text-white text-lg">{vehicle.vehicle?.reg_number}</h3>
                            {vehicle.vehicle?.nickname && (
                              <p className="text-xs text-slate-400">{vehicle.vehicle.nickname}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Most Critical Status Badge */}
                            <Badge className={`text-xs ${getStatusColorClass(
                              vehicle.tax_status?.status === 'overdue' || vehicle.mot_status?.status === 'overdue' 
                                ? 'overdue' 
                                : vehicle.tax_status?.status === 'due_soon' || vehicle.mot_status?.status === 'due_soon'
                                ? 'due_soon'
                                : 'ok'
                            )}`}>
                              {vehicle.tax_status?.status === 'overdue' || vehicle.mot_status?.status === 'overdue' 
                                ? 'OVERDUE' 
                                : vehicle.tax_status?.status === 'due_soon' || vehicle.mot_status?.status === 'due_soon'
                                ? 'DUE SOON'
                                : 'OK'}
                            </Badge>
                            {isExpanded ? (
                              <ChevronUp className="h-5 w-5 text-slate-400" />
                            ) : (
                              <ChevronDown className="h-5 w-5 text-slate-400" />
                            )}
                          </div>
                        </div>

                        {/* Collapsed View - Essential Info Only */}
                        {!isExpanded && (
                          <div className="text-xs text-slate-400 space-y-0.5">
                            <div className="flex justify-between">
                              <span>Tax:</span>
                              <span className="text-white">{formatMaintenanceDate(vehicle.tax_due_date)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>MOT:</span>
                              <span className="text-white">{formatMaintenanceDate(vehicle.mot_due_date)}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Expanded View - All Fields */}
                      {isExpanded && (
                        <div className="space-y-3 pt-3 border-t border-slate-700">
                          {/* All Status Fields */}
                          <div className="space-y-2">
                            {columnVisibility.current_mileage && vehicle.current_mileage && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-400">Current Mileage:</span>
                                <span className="text-white font-medium">{formatMileage(vehicle.current_mileage)}</span>
                              </div>
                            )}
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
                            {columnVisibility.service_due && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-400">Next Service:</span>
                                <Badge className={`font-medium ${getStatusColorClass(vehicle.next_service_status?.status || 'not_set')}`}>
                                  {formatMileage(vehicle.next_service_mileage)}
                                </Badge>
                              </div>
                            )}
                            {columnVisibility.cambelt_due && vehicle.cambelt_due_mileage && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-400">Cambelt Due:</span>
                                <Badge className={`font-medium ${getStatusColorClass(vehicle.cambelt_status?.status || 'not_set')}`}>
                                  {formatMileage(vehicle.cambelt_due_mileage)}
                                </Badge>
                              </div>
                            )}
                            {columnVisibility.first_aid_expiry && vehicle.first_aid_kit_expiry && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-400">First Aid Expiry:</span>
                                <Badge className={`font-medium ${getStatusColorClass(vehicle.first_aid_status?.status || 'not_set')}`}>
                                  {formatMaintenanceDate(vehicle.first_aid_kit_expiry)}
                                </Badge>
                              </div>
                            )}
                          </div>

                          {/* Actions - All on One Line */}
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-700">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                const vehicleId = vehicle.vehicle_id || vehicle.id;
                                if (vehicleId) {
                                  router.push(`/fleet/vehicles/${vehicleId}/history`);
                                }
                              }}
                              className="h-10 w-10 p-0"
                            >
                              <History className="h-5 w-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVehicle(vehicle);
                                setEditDialogOpen(true);
                              }}
                              className="h-10 w-10 p-0"
                            >
                              <Edit className="h-5 w-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVehicle(vehicle);
                                setDeleteDialogOpen(true);
                              }}
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 ml-auto h-10 w-10 p-0"
                            >
                              <Archive className="h-5 w-5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
            </TabsContent>
            
            {/* Retired Vehicles Tab */}
            <TabsContent value="deleted" className="space-y-4 mt-4">
              {/* Search Bar for Retired Vehicles */}
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search retired vehicles by registration..."
                  value={retiredSearchQuery}
                  onChange={(e) => setRetiredSearchQuery(e.target.value)}
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>
              
              {retiredLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-3" />
                  <p className="text-slate-400">Loading retired vehicles...</p>
                </div>
              ) : !retiredData || retiredData.vehicles.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <FolderClock className="h-12 w-12 mx-auto mb-3 text-slate-600" />
                  <p>No retired vehicles found.</p>
                </div>
              ) : (
                <>
                  {/* Desktop Table View for Retired Vehicles */}
                  <div className="hidden md:block border border-slate-700 rounded-lg">
                    <Table className="min-w-full">
                      <TableHeader>
                        <TableRow className="border-slate-700">
                          <TableHead className="bg-slate-900 text-slate-300 border-b-2 border-slate-700">
                            Registration
                          </TableHead>
                          <TableHead className="bg-slate-900 text-slate-300 border-b-2 border-slate-700">
                            Nickname
                          </TableHead>
                          <TableHead className="bg-slate-900 text-slate-300 border-b-2 border-slate-700">
                            Mileage
                          </TableHead>
                          <TableHead className="bg-slate-900 text-slate-300 border-b-2 border-slate-700">
                            Tax Due
                          </TableHead>
                          <TableHead className="bg-slate-900 text-slate-300 border-b-2 border-slate-700">
                            MOT Due
                          </TableHead>
                          <TableHead className="bg-slate-900 text-slate-300 border-b-2 border-slate-700">
                            Retired Date
                          </TableHead>
                          <TableHead className="bg-slate-900 text-slate-300 border-b-2 border-slate-700">
                            Reason
                          </TableHead>
                          <TableHead className="bg-slate-900 text-right text-slate-300 border-b-2 border-slate-700">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {retiredData.vehicles
                          .filter(vehicle => 
                            vehicle.reg_number.toLowerCase().includes(retiredSearchQuery.toLowerCase())
                          )
                          .map((vehicle) => (
                          <TableRow 
                            key={vehicle.id}
                            className="border-slate-700 hover:bg-slate-800/30"
                          >
                            {/* Registration */}
                            <TableCell className="font-medium text-white">
                              {vehicle.reg_number}
                            </TableCell>
                            
                            {/* Nickname */}
                            <TableCell className="text-slate-300">
                              {vehicle.nickname || (
                                <span className="text-slate-400 italic">No nickname</span>
                              )}
                            </TableCell>
                            
                            {/* Mileage */}
                            <TableCell className="text-slate-300">
                              {formatMileage(vehicle.current_mileage)}
                            </TableCell>
                            
                            {/* Tax Due */}
                            <TableCell>
                              <span className="text-slate-300">
                                {formatMaintenanceDate(vehicle.tax_due_date)}
                              </span>
                            </TableCell>
                            
                            {/* MOT Due */}
                            <TableCell>
                              <span className="text-slate-300">
                                {formatMaintenanceDate(vehicle.mot_due_date)}
                              </span>
                            </TableCell>
                            
                            {/* Deleted Date */}
                            <TableCell className="text-slate-300">
                              {new Date(vehicle.archived_at).toLocaleDateString()}
                            </TableCell>
                            
                            {/* Reason */}
                            <TableCell>
                              <Badge 
                                variant="outline" 
                                className={
                                  vehicle.archive_reason === 'Sold' 
                                    ? 'border-blue-500 text-blue-400' 
                                    : vehicle.archive_reason === 'Scrapped'
                                    ? 'border-red-500 text-red-400'
                                    : 'border-slate-500 text-slate-400'
                                }
                              >
                                {vehicle.archive_reason}
                              </Badge>
                            </TableCell>
                            
                            {/* Actions */}
                            <TableCell className="text-right">
                              {(isAdmin || isManager) && (
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRestore(vehicle.id, vehicle.reg_number)}
                                    disabled={pendingRestore.has(vehicle.id)}
                                    className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                                    title="Restore to Active"
                                  >
                                    {pendingRestore.has(vehicle.id) ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Undo2 className="h-3 w-3" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handlePermanentDelete(vehicle.id, vehicle.reg_number)}
                                    disabled={pendingDelete.has(vehicle.id)}
                                    className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                    title="Permanently Remove"
                                  >
                                    {pendingDelete.has(vehicle.id) ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <XCircle className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  
                  {/* Mobile Card View for Retired Vehicles */}
                  <div className="md:hidden space-y-3">
                    {retiredData.vehicles
                      .filter(vehicle => 
                        vehicle.reg_number.toLowerCase().includes(retiredSearchQuery.toLowerCase())
                      )
                      .map((vehicle) => (
                      <Card 
                        key={vehicle.id}
                        className="bg-slate-800 border-slate-700"
                      >
                        <CardContent className="p-4">
                          {/* Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h3 className="font-semibold text-white text-lg">{vehicle.reg_number}</h3>
                              {vehicle.nickname && (
                                <p className="text-xs text-slate-400">{vehicle.nickname}</p>
                              )}
                            </div>
                            <Badge 
                              variant="outline"
                              className={
                                vehicle.archive_reason === 'Sold' 
                                  ? 'border-blue-500 text-blue-400' 
                                  : vehicle.archive_reason === 'Scrapped'
                                  ? 'border-red-500 text-red-400'
                                  : 'border-slate-500 text-slate-400'
                              }
                            >
                              {vehicle.archive_reason}
                            </Badge>
                          </div>
                          
                          {/* Details */}
                          <div className="space-y-2 text-sm">
                            {vehicle.current_mileage && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Mileage:</span>
                                <span className="text-white">{formatMileage(vehicle.current_mileage)}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-slate-400">Tax Due:</span>
                              <span className="text-white">{formatMaintenanceDate(vehicle.tax_due_date)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">MOT Due:</span>
                              <span className="text-white">{formatMaintenanceDate(vehicle.mot_due_date)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Retired:</span>
                              <span className="text-white">{new Date(vehicle.archived_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          
                          {/* Actions */}
                          {(isAdmin || isManager) && (
                            <div className="mt-4 pt-3 border-t border-slate-700 space-y-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRestore(vehicle.id, vehicle.reg_number)}
                                disabled={pendingRestore.has(vehicle.id)}
                                className="w-full text-green-400 hover:text-green-300 hover:bg-green-900/20"
                              >
                                {pendingRestore.has(vehicle.id) ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Restoring...
                                  </>
                                ) : (
                                  <>
                                    <Undo2 className="h-4 w-4 mr-2" />
                                    Restore to Active
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handlePermanentDelete(vehicle.id, vehicle.reg_number)}
                                disabled={pendingDelete.has(vehicle.id)}
                                className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20"
                              >
                                {pendingDelete.has(vehicle.id) ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Removing...
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="h-4 w-4 mr-2" />
                                    Permanently Remove
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
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
        onRetire={() => {
          setDeleteDialogOpen(true);
        }}
      />
      
      {/* History Dialog */}
      
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
