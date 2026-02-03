'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { 
  Search, 
  History,
  HardHat,
  Loader2,
  ArrowUpDown,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AddVehicleDialog } from './AddVehicleDialog';
import { formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';

type PlantAsset = {
  id: string;
  plant_id: string;
  reg_number: string | null;
  nickname: string | null;
  loler_due_date: string | null;
  current_hours: number | null;
  status: string;
  vehicle_categories?: { name: string; id: string } | null;
};

type PlantMaintenanceWithStatus = {
  plant_id: string;
  plant: PlantAsset;
  current_hours: number | null;
  next_service_hours: number | null;
};

interface PlantTableProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onVehicleAdded?: () => void;
}

type SortField = 'plant_id' | 'nickname' | 'category' | 'current_hours' | 'next_service_hours' | 'loler_due';
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
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [plantAssets, setPlantAssets] = useState<PlantMaintenanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

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
    const regNumber = asset.plant?.reg_number?.toLowerCase() || '';
    const nickname = asset.plant?.nickname?.toLowerCase() || '';
    
    return plantId.includes(searchLower) || 
           regNumber.includes(searchLower) ||
           nickname.includes(searchLower);
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
      case 'category':
        aValue = a.plant?.vehicle_categories?.name || '';
        bValue = b.plant?.vehicle_categories?.name || '';
        break;
      case 'current_hours':
        aValue = a.current_hours || 0;
        bValue = b.current_hours || 0;
        break;
      case 'next_service_hours':
        aValue = a.next_service_hours || 0;
        bValue = b.next_service_hours || 0;
        break;
      case 'loler_due':
        if (!a.plant?.loler_due_date && !b.plant?.loler_due_date) return 0;
        if (!a.plant?.loler_due_date) return 1;
        if (!b.plant?.loler_due_date) return -1;
        return new Date(a.plant.loler_due_date).getTime() - new Date(b.plant.loler_due_date).getTime();
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

  const handleViewHistory = (plantId: string) => {
    router.push(`/fleet/plant/${plantId}/history`);
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
              placeholder="Search by Plant ID, registration, or description..."
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
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                      <TableHead 
                        className="text-white cursor-pointer hover:text-blue-400"
                        onClick={() => handleSort('plant_id')}
                      >
                        <div className="flex items-center gap-2">
                          Plant ID
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white cursor-pointer hover:text-blue-400"
                        onClick={() => handleSort('nickname')}
                      >
                        <div className="flex items-center gap-2">
                          Nickname
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white cursor-pointer hover:text-blue-400"
                        onClick={() => handleSort('category')}
                      >
                        <div className="flex items-center gap-2">
                          Category
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white cursor-pointer hover:text-blue-400"
                        onClick={() => handleSort('current_hours')}
                      >
                        <div className="flex items-center gap-2">
                          Hours
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white cursor-pointer hover:text-blue-400"
                        onClick={() => handleSort('next_service_hours')}
                      >
                        <div className="flex items-center gap-2">
                          Service Due
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white cursor-pointer hover:text-blue-400"
                        onClick={() => handleSort('loler_due')}
                      >
                        <div className="flex items-center gap-2">
                          LOLER Due
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPlant.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
                          <TableCell className="text-muted-foreground">
                            {asset.plant?.nickname || (
                              <span className="text-slate-400 italic">No nickname</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {asset.plant?.vehicle_categories?.name || 'All plant'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {asset.current_hours ? (
                              <span className="font-mono">{asset.current_hours.toLocaleString()}h</span>
                            ) : (
                              <span className="text-slate-400 italic">Not set</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {asset.next_service_hours ? (
                              <span className="font-mono">{asset.next_service_hours.toLocaleString()}h</span>
                            ) : (
                              <span className="text-slate-400 italic">Not set</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatMaintenanceDate(asset.plant?.loler_due_date || null)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card View */}
              {sortedPlant.length > 0 && (
                <div className="md:hidden space-y-3">
                  {sortedPlant.map((asset) => {
                    const isExpanded = expandedCardId === asset.plant_id;
                    
                    return (
                      <Card 
                        key={asset.plant_id} 
                        id={`plant-card-${asset.plant_id}`}
                        className="bg-slate-800 border-slate-700 transition-all duration-200"
                      >
                        <CardContent className="p-4">
                          {/* Collapsed View - Click to Expand */}
                          <div 
                            onClick={() => {
                              if (!isExpanded) {
                                setExpandedCardId(asset.plant_id);
                                // Scroll to top of card after expansion
                                setTimeout(() => {
                                  const card = document.getElementById(`plant-card-${asset.plant_id}`);
                                  if (card) {
                                    const navbarHeight = 68;
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
                                <h3 className="font-semibold text-white text-lg">{asset.plant?.plant_id}</h3>
                                {asset.plant?.nickname && (
                                  <p className="text-xs text-muted-foreground">{asset.plant.nickname}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronUp className="h-5 w-5 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                )}
                              </div>
                            </div>

                            {/* Collapsed View - Essential Info Only */}
                            {!isExpanded && (
                              <div className="text-xs text-slate-400 space-y-0.5">
                                <div className="flex justify-between">
                                  <span>Hours:</span>
                                  <span className="text-white">
                                    {asset.current_hours ? `${asset.current_hours.toLocaleString()}h` : 'Not set'}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>LOLER Due:</span>
                                  <span className="text-white">{formatMaintenanceDate(asset.plant?.loler_due_date || null)}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Expanded View - All Fields */}
                          {isExpanded && (
                            <div className="space-y-3 pt-3 border-t border-border">
                              {/* All Status Fields */}
                              <div className="space-y-2">
                                {asset.plant?.reg_number && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Registration:</span>
                                    <span className="text-white font-medium">{asset.plant.reg_number}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">Category:</span>
                                  <span className="text-white">{asset.plant?.vehicle_categories?.name || 'All plant'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">Current Hours:</span>
                                  <span className="text-white font-medium">
                                    {asset.current_hours ? `${asset.current_hours.toLocaleString()}h` : 'Not set'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">Service Due:</span>
                                  <span className="text-white">
                                    {asset.next_service_hours ? `${asset.next_service_hours.toLocaleString()}h` : 'Not set'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">LOLER Due:</span>
                                  <span className="text-white">{formatMaintenanceDate(asset.plant?.loler_due_date || null)}</span>
                                </div>
                              </div>

                              {/* Actions - Single History Button */}
                              <div className="flex items-center gap-2 pt-2 border-t border-border">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleViewHistory(asset.plant_id);
                                  }}
                                  className="h-10 w-10 p-0"
                                >
                                  <History className="h-5 w-5" />
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
            </>
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
    </>
  );
}
