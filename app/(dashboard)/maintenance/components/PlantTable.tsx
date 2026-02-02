'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { 
  Search, 
  Edit, 
  History,
  HardHat,
  Clock,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { AddVehicleDialog } from './AddVehicleDialog';
import { 
  getStatusColorClass
} from '@/lib/utils/maintenanceCalculations';
import { EditMaintenanceDialog } from './EditMaintenanceDialog';

interface PlantTableProps {
  vehicles: VehicleMaintenanceWithStatus[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onVehicleAdded?: () => void;
}

type SortField = 'plant_id' | 'nickname' | 'current_hours' | 'next_service_hours';
type SortDirection = 'asc' | 'desc';

export function PlantTable({ 
  vehicles, 
  searchQuery, 
  onSearchChange,
  onVehicleAdded
}: PlantTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('plant_id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMaintenanceWithStatus | null>(null);

  // Filter only plant assets
  const plantAssets = vehicles.filter(v => v.vehicle?.asset_type === 'plant');

  // Filter based on search
  const filteredPlant = plantAssets.filter(vehicle => {
    if (!searchQuery) return true;
    
    const searchLower = searchQuery.toLowerCase();
    const plantId = vehicle.vehicle?.plant_id?.toLowerCase() || '';
    const nickname = vehicle.vehicle?.nickname?.toLowerCase() || '';
    const vehicleType = vehicle.vehicle?.vehicle_type?.toLowerCase() || '';
    
    return plantId.includes(searchLower) || 
           nickname.includes(searchLower) ||
           vehicleType.includes(searchLower);
  });

  // Sort
  const sortedPlant = [...filteredPlant].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortField) {
      case 'plant_id':
        aValue = a.vehicle?.plant_id || '';
        bValue = b.vehicle?.plant_id || '';
        break;
      case 'nickname':
        aValue = a.vehicle?.nickname || '';
        bValue = b.vehicle?.nickname || '';
        break;
      case 'current_hours':
        aValue = a.current_hours || 0;
        bValue = b.current_hours || 0;
        break;
      case 'next_service_hours':
        aValue = a.next_service_hours || 0;
        bValue = b.next_service_hours || 0;
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleEdit = (vehicle: VehicleMaintenanceWithStatus) => {
    setSelectedVehicle(vehicle);
    setEditDialogOpen(true);
  };

  const handleViewHistory = (vehicleId: string) => {
    router.push(`/fleet/vehicles/${vehicleId}/history`);
  };

  const getMaintenanceStatusBadge = (vehicle: VehicleMaintenanceWithStatus) => {
    if (vehicle.overdue_count > 0) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {vehicle.overdue_count} Overdue
        </Badge>
      );
    }
    if (vehicle.due_soon_count > 0) {
      return (
        <Badge variant="secondary" className="gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30">
          <Clock className="h-3 w-3" />
          {vehicle.due_soon_count} Due Soon
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1 bg-green-500/20 text-green-400 border-green-500/30">
        <CheckCircle2 className="h-3 w-3" />
        Up to Date
      </Badge>
    );
  };

  return (
    <>
      <Card className="border-border">
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <HardHat className="h-5 w-5" />
                Plant Machinery Management
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {sortedPlant.length} plant asset{sortedPlant.length !== 1 ? 's' : ''}
              </p>
            </div>
            <Button
              onClick={() => setAddVehicleDialogOpen(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <HardHat className="h-4 w-4 mr-2" />
              Add Plant
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Plant ID, description, or type..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-input border-border text-white"
            />
          </div>

          {/* Table */}
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead 
                    className="text-white cursor-pointer hover:text-blue-400"
                    onClick={() => handleSort('plant_id')}
                  >
                    Plant ID
                  </TableHead>
                  <TableHead 
                    className="text-white cursor-pointer hover:text-blue-400"
                    onClick={() => handleSort('nickname')}
                  >
                    Description
                  </TableHead>
                  <TableHead className="text-white">
                    Type
                  </TableHead>
                  <TableHead 
                    className="text-white cursor-pointer hover:text-blue-400"
                    onClick={() => handleSort('current_hours')}
                  >
                    Current Hours
                  </TableHead>
                  <TableHead 
                    className="text-white cursor-pointer hover:text-blue-400"
                    onClick={() => handleSort('next_service_hours')}
                  >
                    Next Service
                  </TableHead>
                  <TableHead className="text-white">
                    Status
                  </TableHead>
                  <TableHead className="text-white text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPlant.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {searchQuery ? 'No plant machinery found matching your search' : 'No plant machinery added yet'}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedPlant.map((vehicle) => (
                    <TableRow
                      key={vehicle.id}
                      className="border-border hover:bg-slate-800/50 cursor-pointer"
                      onClick={() => handleViewHistory(vehicle.vehicle_id)}
                    >
                      <TableCell className="font-mono font-medium text-blue-400">
                        {vehicle.vehicle?.plant_id}
                      </TableCell>
                      <TableCell className="text-white">
                        {vehicle.vehicle?.nickname || <span className="text-muted-foreground italic">No description</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {vehicle.vehicle?.vehicle_type || <span className="italic">Unclassified</span>}
                      </TableCell>
                      <TableCell className="text-white">
                        {vehicle.current_hours ? (
                          <span className="font-mono">{vehicle.current_hours.toLocaleString()}h</span>
                        ) : (
                          <span className="text-muted-foreground italic">Not set</span>
                        )}
                      </TableCell>
                      <TableCell className="text-white">
                        {vehicle.next_service_hours ? (
                          <span className="font-mono">{vehicle.next_service_hours.toLocaleString()}h</span>
                        ) : (
                          <span className="text-muted-foreground italic">Not set</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {getMaintenanceStatusBadge(vehicle)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(vehicle);
                            }}
                            className="hover:bg-blue-500/20 hover:text-blue-400"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewHistory(vehicle.vehicle_id);
                            }}
                            className="hover:bg-green-500/20 hover:text-green-400"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AddVehicleDialog
        open={addVehicleDialogOpen}
        onOpenChange={setAddVehicleDialogOpen}
        onSuccess={() => {
          onVehicleAdded?.();
        }}
      />

      <EditMaintenanceDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        vehicle={selectedVehicle}
        onSuccess={() => {
          setEditDialogOpen(false);
          onVehicleAdded?.();
        }}
      />
    </>
  );
}
