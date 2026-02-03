'use client';

import { useState, useEffect } from 'react';
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
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AddVehicleDialog } from './AddVehicleDialog';
import { EditMaintenanceDialog } from './EditMaintenanceDialog';

type PlantAsset = {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  year: number | null;
  weight_class: string | null;
  current_hours: number | null;
  status: string;
  vehicle_categories?: { name: string; id: string } | null;
};

type PlantMaintenanceWithStatus = {
  plant_id: string;
  plant: PlantAsset;
  current_hours: number | null;
  next_service_hours: number | null;
  overdue_count: number;
  due_soon_count: number;
};

interface PlantTableProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onVehicleAdded?: () => void;
}

type SortField = 'plant_id' | 'nickname' | 'current_hours' | 'next_service_hours';
type SortDirection = 'asc' | 'desc';

export function PlantTable({ 
  searchQuery, 
  onSearchChange,
  onVehicleAdded
}: PlantTableProps) {
  const router = useRouter();
  const supabase = createClient();
  const [sortField, setSortField] = useState<SortField>('plant_id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null);
  const [plantAssets, setPlantAssets] = useState<PlantMaintenanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch plant assets from the plant table
  useEffect(() => {
    fetchPlantAssets();
  }, []);

  const fetchPlantAssets = async () => {
    try {
      setLoading(true);
      
      // Fetch plant assets with maintenance data
      const { data: plantData, error: plantError } = await supabase
        .from('plant')
        .select(`
          *,
          vehicle_categories (
            id,
            name
          )
        `)
        .eq('status', 'active')
        .order('plant_id');

      if (plantError) throw plantError;

      // Fetch maintenance records for plant
      const { data: maintenanceData, error: maintenanceError } = await supabase
        .from('vehicle_maintenance')
        .select('*')
        .not('plant_id', 'is', null);

      if (maintenanceError) throw maintenanceError;

      // Combine plant data with maintenance data
      const combined: PlantMaintenanceWithStatus[] = (plantData || []).map((plant) => {
        const maintenance = maintenanceData?.find((m) => m.plant_id === plant.id);
        
        return {
          plant_id: plant.id,
          plant: plant as PlantAsset,
          current_hours: maintenance?.current_hours || plant.current_hours || null,
          next_service_hours: maintenance?.next_service_hours || null,
          overdue_count: 0, // TODO: Calculate based on maintenance items
          due_soon_count: 0, // TODO: Calculate based on maintenance items
        };
      });

      setPlantAssets(combined);
    } catch (error) {
      console.error('Error fetching plant assets:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter based on search
  const filteredPlant = plantAssets.filter(asset => {
    if (!searchQuery) return true;
    
    const searchLower = searchQuery.toLowerCase();
    const plantId = asset.plant?.plant_id?.toLowerCase() || '';
    const nickname = asset.plant?.nickname?.toLowerCase() || '';
    const make = asset.plant?.make?.toLowerCase() || '';
    const model = asset.plant?.model?.toLowerCase() || '';
    
    return plantId.includes(searchLower) || 
           nickname.includes(searchLower) ||
           make.includes(searchLower) ||
           model.includes(searchLower);
  });

  // Sort
  const sortedPlant = [...filteredPlant].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortField) {
      case 'plant_id':
        aValue = a.plant?.plant_id || '';
        bValue = b.plant?.plant_id || '';
        break;
      case 'nickname':
        aValue = a.plant?.nickname || '';
        bValue = b.plant?.nickname || '';
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

  const handleEdit = (vehicle: PlantMaintenanceWithStatus) => {
    setSelectedVehicle(vehicle);
    setEditDialogOpen(true);
  };

  const handleViewHistory = (plantId: string) => {
    router.push(`/fleet/plant/${plantId}/history`);
  };

  const getMaintenanceStatusBadge = (asset: PlantMaintenanceWithStatus) => {
    if (asset.overdue_count > 0) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {asset.overdue_count} Overdue
        </Badge>
      );
    }
    if (asset.due_soon_count > 0) {
      return (
        <Badge variant="secondary" className="gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30">
          <Clock className="h-3 w-3" />
          {asset.due_soon_count} Due Soon
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
              placeholder="Search by Plant ID, description, make, or model..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-input border-border text-white"
            />
          </div>

          {/* Loading State */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : (
            /* Table */
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
                      Make / Model
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
                    sortedPlant.map((asset) => (
                      <TableRow
                        key={asset.plant_id}
                        className="border-border hover:bg-slate-800/50 cursor-pointer"
                        onClick={() => handleViewHistory(asset.plant_id)}
                      >
                        <TableCell className="font-mono font-medium text-blue-400">
                          {asset.plant?.plant_id}
                        </TableCell>
                        <TableCell className="text-white">
                          {asset.plant?.nickname || <span className="text-muted-foreground italic">No description</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {asset.plant?.make && asset.plant?.model ? (
                            `${asset.plant.make} ${asset.plant.model}`
                          ) : asset.plant?.make || asset.plant?.model ? (
                            asset.plant.make || asset.plant.model
                          ) : (
                            <span className="italic">Not specified</span>
                          )}
                        </TableCell>
                        <TableCell className="text-white">
                          {asset.current_hours ? (
                            <span className="font-mono">{asset.current_hours.toLocaleString()}h</span>
                          ) : (
                            <span className="text-muted-foreground italic">Not set</span>
                          )}
                        </TableCell>
                        <TableCell className="text-white">
                          {asset.next_service_hours ? (
                            <span className="font-mono">{asset.next_service_hours.toLocaleString()}h</span>
                          ) : (
                            <span className="text-muted-foreground italic">Not set</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {getMaintenanceStatusBadge(asset)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(asset);
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
                                handleViewHistory(asset.plant_id);
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
          )}
        </CardContent>
      </Card>

      <AddVehicleDialog
        open={addVehicleDialogOpen}
        onOpenChange={setAddVehicleDialogOpen}
        onSuccess={() => {
          fetchPlantAssets();
          onVehicleAdded?.();
        }}
      />

      <EditMaintenanceDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        vehicle={selectedVehicle}
        onSuccess={() => {
          setEditDialogOpen(false);
          fetchPlantAssets();
          onVehicleAdded?.();
        }}
      />
    </>
  );
}
