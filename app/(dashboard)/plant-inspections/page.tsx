'use client';

import { useState, useEffect, Suspense } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useInspectionRealtime } from '@/lib/hooks/useRealtime';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Clipboard, Clock, User, Download, Trash2, Filter, FileText, Wrench } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';
import { VehicleInspection } from '@/types/inspection';
import { Employee, InspectionStatusFilter } from '@/types/common';
import { useQueryState } from 'nuqs';
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

interface InspectionWithPlant extends VehicleInspection {
  plant: {
    plant_id: string;
    nickname: string | null;
    serial_number: string | null;
    vehicle_categories: { name: string } | null;
  };
}

interface Plant {
  id: string;
  plant_id: string;
  nickname: string | null;
  serial_number: string | null;
  vehicle_categories: { name: string } | null;
}

function PlantInspectionsContent() {
  const { user, isManager } = useAuth();
  usePermissionCheck('plant-inspections');
  const router = useRouter();
  const [inspections, setInspections] = useState<InspectionWithPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useQueryState('employee', { 
    defaultValue: 'all',
    shallow: false,
  });
  const [statusFilter, setStatusFilter] = useQueryState('status', {
    defaultValue: 'all' as InspectionStatusFilter,
    shallow: false,
  });
  const [plantFilter, setPlantFilter] = useQueryState('plant', {
    defaultValue: 'all',
    shallow: false,
  });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<{ id: string; plantId: string; date: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [displayCount, setDisplayCount] = useState(12);
  const supabase = createClient();

  useEffect(() => {
    if (user && isManager) {
      fetchEmployees();
    }
    fetchPlants();
  }, [user?.id, isManager]);

  useEffect(() => {
    fetchInspections();
  }, [user?.id, isManager, selectedEmployeeId, statusFilter, plantFilter]);

  // Listen for realtime updates to inspections
  useInspectionRealtime((payload) => {
    console.log('Realtime plant inspection update:', payload);
    
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      fetchInspections();
      
      if (payload.eventType === 'UPDATE' && payload.new && 'status' in payload.new) {
        const status = (payload.new as { status?: string }).status;
        if (status === 'submitted') {
          toast.success('Plant inspection submitted', {
            description: 'A plant inspection has been submitted.',
          });
        }
      }
    }
  });

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');
      
      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const fetchPlants = async () => {
    try {
      const { data, error } = await supabase
        .from('plant')
        .select(`
          id, 
          plant_id,
          nickname,
          serial_number,
          vehicle_categories (
            name
          )
        `)
        .eq('status', 'active')
        .order('plant_id');
      
      if (error) throw error;
      setPlants(data || []);
    } catch (err) {
      console.error('Error fetching plants:', err);
    }
  };

  const fetchInspections = async () => {
    if (!user) return;
    
    try {
      let query = supabase
        .from('vehicle_inspections')
        .select(`
          *,
          plant (
            plant_id,
            nickname,
            serial_number,
            vehicle_categories (
              name
            )
          ),
          profile:profiles!vehicle_inspections_user_id_fkey(full_name)
        `)
        .not('plant_id', 'is', null)
        .order('inspection_date', { ascending: false });

      // Filter based on user role and selection
      if (!isManager) {
        query = query.eq('user_id', user.id);
      } else {
        const employeeFilter = selectedEmployeeId || 'all';
        if (employeeFilter !== 'all') {
          query = query.eq('user_id', employeeFilter);
        }
      }

      // Apply status filter
      const currentStatusFilter = statusFilter || 'all';
      if (currentStatusFilter !== 'all') {
        query = query.eq('status', currentStatusFilter);
      }

      // Apply plant filter
      const currentPlantFilter = plantFilter || 'all';
      if (currentPlantFilter !== 'all') {
        query = query.eq('plant_id', currentPlantFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setInspections(data || []);
    } catch (error) {
      const message = (() => {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      })();
      const isNetworkFailure =
        message.includes('Failed to fetch') || message.includes('NetworkError') || message.toLowerCase().includes('network');

      if (isNetworkFailure) {
        console.warn('Unable to load plant inspections (network):', error);
      } else {
        console.error('Error fetching plant inspections:', error);
      }

      if (!navigator.onLine || isNetworkFailure) {
        try {
          toast.error('Unable to load plant inspections', {
            description: 'Please check your internet connection.',
          });
        } catch {
          console.warn('Unable to load plant inspections (toast unavailable)');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const getFilterLabel = (filter: InspectionStatusFilter) => {
    switch (filter) {
      case 'all': return 'All';
      case 'draft': return 'Draft';
      case 'submitted': return 'Submitted';
      default: return filter;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'default' as const, label: 'Submitted' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Clock className="h-5 w-5 text-amber-600" />;
      default:
        return <Clipboard className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const handleDownloadPDF = async (e: React.MouseEvent, inspectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDownloading(inspectionId);
    try {
      const response = await fetch(`/api/plant-inspections/${inspectionId}/pdf`);
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plant-inspection-${inspectionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error('Failed to download PDF', {
        description: 'Please try again or contact support if the problem persists.',
      });
    } finally {
      setDownloading(null);
    }
  };

  const openDeleteDialog = (e: React.MouseEvent, inspection: InspectionWithPlant) => {
    e.stopPropagation();
    setInspectionToDelete({
      id: inspection.id,
      plantId: inspection.plant?.plant_id || 'Unknown',
      date: formatDate(inspection.inspection_date),
    });
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/plant-inspections/${inspectionToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete inspection');
      }

      toast.success('Plant inspection deleted successfully');
      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
      fetchInspections();
    } catch (err: any) {
      console.error('Error deleting plant inspection:', err);
      toast.error(err.message || 'Failed to delete inspection');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      
      {/* Header */}
      <div className="bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Plant Inspections</h1>
            <p className="text-muted-foreground">
              Daily plant machinery safety checks
            </p>
          </div>
          <Link href="/plant-inspections/new">
            <Button className="bg-plant-inspection hover:bg-plant-inspection-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg">
              <Plus className="h-4 w-4 mr-2" />
              New Inspection
            </Button>
          </Link>
        </div>
        
        {/* Manager: Employee Filter */}
        {isManager && employees.length > 0 && (
          <div className="pt-4 border-t border-border">
            <div className="flex items-center gap-3 max-w-md">
              <Label htmlFor="employee-filter" className="text-white text-sm flex items-center gap-2 whitespace-nowrap">
                <User className="h-4 w-4" />
                View inspections for:
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger id="employee-filter" className="h-10 border-border text-white">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Filters - Only show for managers */}
      {isManager && (
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Status Filter */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 mr-2">Filter by status:</span>
                <div className="flex gap-2 flex-wrap">
                  {(['all', 'draft', 'submitted'] as InspectionStatusFilter[]).map((filter) => (
                    <Button
                      key={filter}
                      variant="outline"
                      size="sm"
                      onClick={() => setStatusFilter(filter)}
                      className={statusFilter === filter ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
                    >
                      {filter === 'submitted' && <Clock className="h-3 w-3 mr-1" />}
                      {filter === 'draft' && <FileText className="h-3 w-3 mr-1" />}
                      {getFilterLabel(filter)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Plant Filter */}
              <div className="flex items-center gap-3">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-slate-400 mr-2 whitespace-nowrap">Filter by plant:</span>
                <Select value={plantFilter} onValueChange={setPlantFilter}>
                  <SelectTrigger className="h-9 border-border text-white">
                    <SelectValue placeholder="All plant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Plant</SelectItem>
                    {plants.map((plant) => (
                      <SelectItem key={plant.id} value={plant.id}>
                        {plant.plant_id}
                        {plant.nickname && ` - ${plant.nickname}`}
                        {plant.vehicle_categories?.name && ` (${plant.vehicle_categories.name})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-border">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    <Skeleton className="h-5 w-5" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : inspections.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No plant inspections yet</h3>
            <p className="text-slate-400 mb-4">
              Create your first plant inspection
            </p>
            <Link href="/plant-inspections/new">
              <Button className="bg-plant-inspection hover:bg-plant-inspection-dark text-white transition-all duration-200 active:scale-95">
                <Plus className="h-4 w-4 mr-2" />
                Create Inspection
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4">
            {inspections.slice(0, displayCount).map((inspection) => (
            <Card 
              key={inspection.id} 
              className="border-border hover:shadow-lg hover:border-plant-inspection/50 transition-all duration-200 cursor-pointer"
              onClick={() => {
                if (inspection.status === 'draft') {
                  router.push(`/plant-inspections/new?id=${inspection.id}`);
                } else {
                  router.push(`/plant-inspections/${inspection.id}`);
                }
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(inspection.status)}
                    <div>
                      <CardTitle className="text-lg text-white">
                        {inspection.plant?.plant_id || 'Unknown Plant'}
                        {inspection.plant?.nickname && ` - ${inspection.plant.nickname}`}
                        {inspection.plant?.serial_number && ` (SN: ${inspection.plant.serial_number})`}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {isManager && (inspection as any).profile?.full_name && (
                          <span className="font-medium text-white">
                            {(inspection as any).profile.full_name}
                            {' • '}
                          </span>
                        )}
                        {inspection.plant?.vehicle_categories?.name && `${inspection.plant.vehicle_categories.name} • `}
                        {inspection.inspection_end_date && inspection.inspection_end_date !== inspection.inspection_date
                          ? `${formatDate(inspection.inspection_date)} - ${formatDate(inspection.inspection_end_date)}`
                          : formatDate(inspection.inspection_date)
                        }
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(inspection.status)}
                    {isManager && (
                      <Button
                        onClick={(e) => openDeleteDialog(e, inspection)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Delete inspection"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    {inspection.submitted_at
                      ? `Submitted ${formatDate(inspection.submitted_at)}`
                      : 'Not yet submitted'}
                  </div>
                  {inspection.status === 'rejected' && inspection.manager_comments && (
                    <div className="text-red-600 text-xs">
                      See manager comments
                    </div>
                  )}
                  {(inspection.status === 'approved' || inspection.status === 'submitted') && (
                    <Button
                      onClick={(e) => handleDownloadPDF(e, inspection.id)}
                      disabled={downloading === inspection.id}
                      variant="outline"
                      size="sm"
                      className="bg-slate-900 border-plant-inspection text-plant-inspection hover:bg-plant-inspection hover:text-white transition-all duration-200"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {downloading === inspection.id ? 'Downloading...' : 'Download PDF'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            ))}
          </div>

          {/* Show More Button */}
          {inspections.length > displayCount && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setDisplayCount(prev => prev + 12)}
                variant="outline"
                className="w-full max-w-xs border-border text-white hover:bg-slate-800"
              >
                Show More ({inspections.length - displayCount} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Plant Inspection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the inspection for{' '}
              <span className="font-semibold">{inspectionToDelete?.plantId}</span> on{' '}
              <span className="font-semibold">{inspectionToDelete?.date}</span>?
              <br />
              <br />
              This action cannot be undone. All inspection items will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function PlantInspectionsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <PlantInspectionsContent />
    </Suspense>
  );
}
