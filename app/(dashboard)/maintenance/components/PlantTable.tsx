'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
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
  History,
  Loader2,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Settings2,
  Plus,
  Monitor,
  FolderClock
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AddVehicleDialog } from './AddVehicleDialog';
import { formatMaintenanceDate, getStatusColorClass } from '@/lib/utils/maintenanceCalculations';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
  plant_id: string; // Human-readable identifier (P001, P002, etc.)
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

interface ColumnVisibility {
  nickname: boolean;
  category: boolean;
  current_hours: boolean;
  service_due: boolean;
  loler_due: boolean;
}

export function PlantTable({ 
  searchQuery, 
  onSearchChange,
  onVehicleAdded
}: PlantTableProps) {
  const router = useRouter();
  // ✅ Create supabase client using useMemo to avoid recreating on every render
  const supabase = useMemo(() => createClient(), []);
  const [sortField, setSortField] = useState<SortField>('plant_id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [activePlantAssets, setActivePlantAssets] = useState<PlantMaintenanceWithStatus[]>([]);
  const [retiredPlantCount, setRetiredPlantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  
  // Column visibility defaults - category hidden by default
  const defaultVisibility: ColumnVisibility = {
    nickname: true,
    category: false,
    current_hours: true,
    service_due: true,
    loler_due: true,
  };

  // Initialise with defaults; useEffect below will hydrate from localStorage
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultVisibility);

  // On mount, load saved preferences from localStorage (safe for SSR)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('plant-table-column-visibility');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ColumnVisibility>;
        // Merge with defaults so any newly-added columns get their default value
        setColumnVisibility(prev => ({ ...prev, ...parsed }));
      }
    } catch (e) {
      console.error('Failed to parse saved column visibility:', e);
    }
  }, []);

  // Persist column visibility changes to localStorage
  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => {
      const newVisibility = {
        ...prev,
        [column]: !prev[column]
      };
      localStorage.setItem('plant-table-column-visibility', JSON.stringify(newVisibility));
      return newVisibility;
    });
  };

  const fetchPlantData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch active plant assets with maintenance data
      const { data: plantData, error: plantError} = await supabase
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
          plant_id: plant.plant_id, // Human-readable identifier (P001, P002, etc.)
          plant: plant as PlantAsset,
          current_hours: maintenance?.current_hours || plant.current_hours || null,
          next_service_hours: maintenance?.next_service_hours || null,
        };
      });

      setActivePlantAssets(combined);

      // Fetch count of retired plant
      const { count, error: countError } = await supabase
        .from('plant')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'retired');

      if (!countError) {
        setRetiredPlantCount(count || 0);
      }
    } catch (error) {
      console.error('Error fetching plant assets:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Fetch plant assets from the plant table
  useEffect(() => {
    fetchPlantData();
  }, [fetchPlantData]);

  // Filter based on search
  const filteredPlant = activePlantAssets.filter(asset => {
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
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    switch (sortField) {
      case 'plant_id':
        return multiplier * (a.plant?.plant_id || '').localeCompare(b.plant?.plant_id || '');
      
      case 'nickname':
        return multiplier * (a.plant?.nickname || '').localeCompare(b.plant?.nickname || '');
      
      case 'category':
        return multiplier * (a.plant?.vehicle_categories?.name || '').localeCompare(b.plant?.vehicle_categories?.name || '');
      
      case 'current_hours':
        return multiplier * ((a.current_hours || 0) - (b.current_hours || 0));
      
      case 'next_service_hours':
        return multiplier * ((a.next_service_hours || 0) - (b.next_service_hours || 0));
      
      case 'loler_due':
        if (!a.plant?.loler_due_date && !b.plant?.loler_due_date) return 0;
        if (!a.plant?.loler_due_date) return 1;
        if (!b.plant?.loler_due_date) return -1;
        return multiplier * (new Date(a.plant.loler_due_date).getTime() - new Date(b.plant.loler_due_date).getTime());
      
      default:
        return 0;
    }
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
    router.push(`/fleet/plant/${plantId}/history?fromTab=plant`);
  };

  return (
    <>
      {/* Mobile Info Banner */}
      <Alert className="md:hidden bg-blue-900/20 border-blue-700/50 mb-4">
        <Monitor className="h-4 w-4 text-blue-400" />
        <AlertDescription className="text-blue-200 text-sm">
          Mobile view shows essential information only. Desktop recommended for complete data and advanced features.
        </AlertDescription>
      </Alert>

      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">
                All Plant
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {activePlantAssets.length} plant asset{activePlantAssets.length !== 1 ? 's' : ''} • Click column headers to sort
              </CardDescription>
            </div>
            <Button 
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setAddVehicleDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2 hidden md:inline" />
              <span className="hidden md:inline">Add Plant</span>
              <Plus className="h-4 w-4 md:hidden" />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          
          {/* Internal Tabs for Active vs Retired Plant */}
          <Tabs defaultValue="active" className="w-full">
            <TabsList className="bg-slate-800 border-border">
              <TabsTrigger value="active" className="data-[state=active]:bg-slate-700">
                Active Plant ({activePlantAssets.length})
              </TabsTrigger>
              <TabsTrigger value="deleted" className="data-[state=active]:bg-slate-700 flex items-center gap-2">
                <FolderClock className="h-4 w-4" />
                Retired Plant ({retiredPlantCount})
              </TabsTrigger>
            </TabsList>
            
            {/* Active Plant Tab */}
            <TabsContent value="active" className="space-y-4 mt-4">
              {/* Search Bar and Column Filter */}
              <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
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
              <DropdownMenuContent align="end" className="w-56 bg-slate-900 border border-border">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.nickname}
                  onCheckedChange={() => toggleColumn('nickname')}
                >
                  Nickname
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.category}
                  onCheckedChange={() => toggleColumn('category')}
                >
                  Category
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.current_hours}
                  onCheckedChange={() => toggleColumn('current_hours')}
                >
                  Hours
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.service_due}
                  onCheckedChange={() => toggleColumn('service_due')}
                >
                  Service Due
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.loler_due}
                  onCheckedChange={() => toggleColumn('loler_due')}
                >
                  LOLER Due
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop Table View */}
          {sortedPlant.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery ? 'No plant machinery found matching your search.' : 'No plant machinery with maintenance records yet.'}
            </div>
          ) : (
            <div className="hidden md:block border border-slate-700 rounded-lg">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead 
                        className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                        style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                        onClick={() => handleSort('plant_id')}
                      >
                        <div className="flex items-center gap-2">
                          Plant ID
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      {columnVisibility.nickname && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('nickname')}
                        >
                          <div className="flex items-center gap-2">
                            Nickname
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.category && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('category')}
                        >
                          <div className="flex items-center gap-2">
                            Category
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.current_hours && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('current_hours')}
                        >
                          <div className="flex items-center gap-2">
                            Hours
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.service_due && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('next_service_hours')}
                        >
                          <div className="flex items-center gap-2">
                            Service Due
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.loler_due && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('loler_due')}
                        >
                          <div className="flex items-center gap-2">
                            LOLER Due
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPlant.map((asset) => (
                      <TableRow 
                        key={asset.plant_id}
                        onClick={() => handleViewHistory(asset.plant?.id || '')}
                        className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                      >
                        {/* Plant ID */}
                        <TableCell className="font-medium text-white">
                          {asset.plant?.plant_id || 'Unknown'}
                        </TableCell>
                        
                        {/* Nickname */}
                        {columnVisibility.nickname && (
                          <TableCell className="text-muted-foreground">
                            {asset.plant?.nickname || (
                              <span className="text-slate-400 italic">No nickname</span>
                            )}
                          </TableCell>
                        )}
                        
                        {/* Category */}
                        {columnVisibility.category && (
                          <TableCell className="text-muted-foreground">
                            {asset.plant?.vehicle_categories?.name || 'All plant'}
                          </TableCell>
                        )}
                        
                        {/* Hours */}
                        {columnVisibility.current_hours && (
                          <TableCell className="text-muted-foreground">
                            {asset.current_hours ? (
                              <>{asset.current_hours.toLocaleString()}h</>
                            ) : (
                              <span className="text-slate-400 italic">Not set</span>
                            )}
                          </TableCell>
                        )}
                        
                        {/* Service Due */}
                        {columnVisibility.service_due && (
                          <TableCell>
                            {asset.next_service_hours ? (
                              <Badge className={`font-medium ${getStatusColorClass('ok')}`}>
                                {asset.next_service_hours.toLocaleString()}h
                              </Badge>
                            ) : (
                              <Badge className={`font-medium ${getStatusColorClass('not_set')}`}>
                                Not set
                              </Badge>
                            )}
                          </TableCell>
                        )}
                        
                        {/* LOLER Due */}
                        {columnVisibility.loler_due && (
                          <TableCell>
                            <Badge className={`font-medium ${getStatusColorClass(asset.plant?.loler_due_date ? 'ok' : 'not_set')}`}>
                              {formatMaintenanceDate(asset.plant?.loler_due_date || null)}
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
                                {asset.current_hours ? <>{asset.current_hours.toLocaleString()}h</> : 'Not set'}
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
                                {asset.current_hours ? (
                                  <>{asset.current_hours.toLocaleString()}h</>
                                ) : (
                                  <span className="text-slate-400 italic">Not set</span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Service Due:</span>
                              {asset.next_service_hours ? (
                                <Badge className={`font-medium ${getStatusColorClass('ok')}`}>
                                  {asset.next_service_hours.toLocaleString()}h
                                </Badge>
                              ) : (
                                <Badge className={`font-medium ${getStatusColorClass('not_set')}`}>
                                  Not set
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">LOLER Due:</span>
                              <Badge className={`font-medium ${getStatusColorClass(asset.plant?.loler_due_date ? 'ok' : 'not_set')}`}>
                                {formatMaintenanceDate(asset.plant?.loler_due_date || null)}
                              </Badge>
                            </div>
                          </div>

                          {/* Actions - Single History Button */}
                          <div className="flex items-center gap-2 pt-2 border-t border-border">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewHistory(asset.plant?.id || '');
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
            </TabsContent>
            
            {/* Retired Plant Tab */}
            <TabsContent value="deleted" className="space-y-4 mt-4">
              <div className="text-center py-12 text-muted-foreground">
                {retiredPlantCount === 0 ? (
                  'No retired plant machinery'
                ) : (
                  `${retiredPlantCount} retired plant asset${retiredPlantCount !== 1 ? 's' : ''} - Feature coming soon`
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AddVehicleDialog
        open={addVehicleDialogOpen}
        onOpenChange={setAddVehicleDialogOpen}
        assetType="plant"
        onSuccess={() => {
          // Refetch local data and notify parent
          fetchPlantData();
          onVehicleAdded?.();
        }}
      />
    </>
  );
}
