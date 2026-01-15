'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ArrowLeft, 
  Wrench, 
  ClipboardCheck, 
  FileText, 
  MessageSquare,
  Calendar,
  User,
  Clock,
  CheckCircle2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Gauge,
  MapPin,
  Loader2,
  Edit
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/date';
import { useAuth } from '@/lib/hooks/useAuth';
import { EditMaintenanceDialog } from '@/app/(dashboard)/maintenance/components/EditMaintenanceDialog';
import { getStatusColorClass, formatMileage, formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
};

type VehicleData = {
  ves_make: string | null;
  ves_colour: string | null;
  ves_fuel_type: string | null;
  ves_year_of_manufacture: string | null;
  ves_engine_capacity: number | null;
  ves_tax_status: string | null;
  ves_mot_status: string | null;
  ves_co2_emissions: number | null;
  ves_euro_status: string | null;
  ves_wheelplan: string | null;
  mot_make: string | null;
  mot_model: string | null;
  mot_primary_colour: string | null;
  mot_year_of_manufacture: number | null;
  mot_fuel_type: string | null;
  mot_first_used_date: string | null;
  tax_due_date: string | null;
  mot_due_date: string | null;
  current_mileage: number | null;
};

type MaintenanceHistoryEntry = {
  id: string;
  created_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  comment: string;
};

type WorkshopTask = {
  id: string;
  action_type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  workshop_comments: string | null;
  logged_at: string | null;
  logged_by: string | null;
  logged_comment: string | null;
  actioned_at: string | null;
  actioned_by: string | null;
  actioned_comment: string | null;
  created_at: string;
  created_by: string;
  workshop_task_categories: {
    id: string;
    name: string;
    slug: string | null;
    ui_color: string | null;
  } | null;
  workshop_task_subcategories: {
    id: string;
    name: string;
    slug: string;
    ui_color: string | null;
    workshop_task_categories: {
      id: string;
      name: string;
      slug: string | null;
      ui_color: string | null;
    };
  } | null;
  profiles_created: {
    full_name: string;
  } | null;
  profiles_logged: {
    full_name: string;
  } | null;
  profiles_actioned: {
    full_name: string;
  } | null;
};

type WorkshopComment = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  author: {
    id: string;
    full_name: string;
  } | null;
};

export default function VehicleHistoryPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();
  
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleData, setVehicleData] = useState<VehicleData | null>(null);
  const [maintenanceRecord, setMaintenanceRecord] = useState<VehicleMaintenanceWithStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenanceHistory, setMaintenanceHistory] = useState<MaintenanceHistoryEntry[]>([]);
  const [workshopTasks, setWorkshopTasks] = useState<WorkshopTask[]>([]);
  const [taskComments, setTaskComments] = useState<Record<string, WorkshopComment[]>>({});
  const [activeTab, setActiveTab] = useState('maintenance');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [motData, setMotData] = useState<any>(null);
  const [motLoading, setMotLoading] = useState(false);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    if (user && resolvedParams.vehicleId) {
      fetchVehicleData();
      fetchMaintenanceRecord();
      fetchMaintenanceHistory();
      fetchWorkshopTasks();
    }
  }, [user, resolvedParams.vehicleId]);

  useEffect(() => {
    if (activeTab === 'mot' && !motData && vehicle?.reg_number) {
      fetchMotHistory();
    }
  }, [activeTab, motData, vehicle?.reg_number]);

  const fetchVehicleData = async () => {
    try {
      // Fetch basic vehicle info
      const { data: vehicleInfo, error: vehicleError } = await supabase
        .from('vehicles')
        .select('id, reg_number, nickname, status')
        .eq('id', resolvedParams.vehicleId)
        .single();

      if (vehicleError) throw vehicleError;
      setVehicle(vehicleInfo);

      // Fetch vehicle maintenance data (VES/MOT data)
      const { data: maintenanceData, error: maintenanceError } = await supabase
        .from('vehicle_maintenance')
        .select(`
          ves_make,
          ves_colour,
          ves_fuel_type,
          ves_year_of_manufacture,
          ves_engine_capacity,
          ves_tax_status,
          ves_mot_status,
          ves_co2_emissions,
          ves_euro_status,
          ves_wheelplan,
          mot_make,
          mot_model,
          mot_primary_colour,
          mot_year_of_manufacture,
          mot_fuel_type,
          mot_first_used_date,
          tax_due_date,
          mot_due_date,
          current_mileage
        `)
        .eq('vehicle_id', resolvedParams.vehicleId)
        .single();

      if (!maintenanceError) {
        setVehicleData(maintenanceData);
      }
    } catch (error) {
      console.error('Error fetching vehicle:', error);
    }
  };

  const fetchMaintenanceRecord = async () => {
    try {
      const response = await fetch('/api/maintenance');
      
      // Check if response is ok and has content
      if (!response.ok) {
        console.error('Maintenance API error:', response.status, response.statusText);
        return;
      }

      // Check if response has content
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Maintenance API returned non-JSON response');
        return;
      }

      const result = await response.json();
      
      if (result.success) {
        const vehicleMaintenance = result.vehicles.find(
          (v: VehicleMaintenanceWithStatus) => 
            v.vehicle_id === resolvedParams.vehicleId || v.vehicle?.id === resolvedParams.vehicleId
        );
        
        if (vehicleMaintenance) {
          setMaintenanceRecord(vehicleMaintenance);
        }
      }
    } catch (error) {
      console.error('Error fetching maintenance record:', error);
    }
  };

  const fetchMaintenanceHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('maintenance_history')
        .select(`
          id,
          created_at,
          field_name,
          old_value,
          new_value,
          comment,
          updated_by,
          updated_by_name
        `)
        .eq('vehicle_id', resolvedParams.vehicleId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Supabase error fetching maintenance history:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }
      setMaintenanceHistory(data || []);
    } catch (error) {
      console.error('Error fetching maintenance history:', error instanceof Error ? error.message : error);
    }
  };

  const fetchWorkshopTasks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('actions')
        .select(`
          id,
          action_type,
          title,
          description,
          status,
          priority,
          workshop_comments,
          logged_at,
          logged_by,
          logged_comment,
          actioned_at,
          actioned_by,
          actioned_comment,
          created_at,
          created_by,
          workshop_task_categories (
            id,
            name,
            slug,
            ui_color
          ),
          workshop_task_subcategories!workshop_subcategory_id (
            id,
            name,
            slug,
            ui_color,
            workshop_task_categories (
              id,
              name,
              slug,
              ui_color
            )
          )
        `)
        .eq('vehicle_id', resolvedParams.vehicleId)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error fetching workshop tasks:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }
      
      // Manually fetch profile names for created_by, logged_by, actioned_by
      let tasksWithProfiles = data || [];
      if (data && data.length > 0) {
        const userIds = new Set<string>();
        data.forEach(task => {
          if (task.created_by) userIds.add(task.created_by);
          if (task.logged_by) userIds.add(task.logged_by);
          if (task.actioned_by) userIds.add(task.actioned_by);
        });
        
        if (userIds.size > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', Array.from(userIds));
          
          const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
          
          tasksWithProfiles = data.map(task => ({
            ...task,
            profiles_created: task.created_by ? { full_name: profileMap.get(task.created_by) || null } : null,
            profiles_logged: task.logged_by ? { full_name: profileMap.get(task.logged_by) || null } : null,
            profiles_actioned: task.actioned_by ? { full_name: profileMap.get(task.actioned_by) || null } : null,
          }));
        }
      }
      
      setWorkshopTasks(tasksWithProfiles);

      // Fetch comments for all tasks
      if (tasksWithProfiles.length > 0) {
        await fetchTaskComments(tasksWithProfiles.map(t => t.id));
      }
    } catch (error) {
      console.error('Error fetching workshop tasks:', error instanceof Error ? error.message : error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTaskComments = async (taskIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('workshop_task_comments')
        .select(`
          id,
          task_id,
          body,
          created_at,
          updated_at,
          profiles:author_id (
            id,
            full_name
          )
        `)
        .in('task_id', taskIds)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Supabase error fetching task comments:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      // Group comments by task_id
      const commentsByTask: Record<string, WorkshopComment[]> = {};
      (data || []).forEach((comment: { task_id: string; id: string; body: string; created_at: string; updated_at: string | null; profiles: { id: string; full_name: string } | null }) => {
        const taskId = comment.task_id;
        if (!commentsByTask[taskId]) {
          commentsByTask[taskId] = [];
        }
        commentsByTask[taskId].push({
          id: comment.id,
          body: comment.body,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          author: comment.profiles ? {
            id: comment.profiles.id,
            full_name: comment.profiles.full_name,
          } : null,
        });
      });

      setTaskComments(commentsByTask);
    } catch (error) {
      console.error('Error fetching task comments:', error instanceof Error ? error.message : error);
    }
  };

  const fetchMotHistory = async () => {
    setMotLoading(true);
    try {
      const response = await fetch(`/api/maintenance/mot-history/${resolvedParams.vehicleId}`);
      const result = await response.json();
      
      if (result.success && result.data) {
        setMotData(result.data);
      }
    } catch (error) {
      console.error('Error fetching MOT history:', error);
    } finally {
      setMotLoading(false);
    }
  };

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      pending: { label: 'Pending', className: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30' },
      in_progress: { label: 'In Progress', className: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
      logged: { label: 'In Progress', className: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
      completed: { label: 'Completed', className: 'bg-green-500/10 text-green-300 border-green-500/30' },
    };
    const config = statusMap[status] || statusMap.pending;
    return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
  };

  const getDefectColor = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'MAJOR': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'MINOR': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'ADVISORY': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'FAIL': return 'text-red-600 bg-red-600/10 border-red-600/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getDefectIcon = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return '🔴';
      case 'MAJOR': return '🟠';
      case 'MINOR': return '🟡';
      case 'ADVISORY': return '🔵';
      case 'FAIL': return '⚫';
      default: return '⚪';
    }
  };

  const countDefectsByType = (defects: any[]) => {
    const counts: Record<string, number> = {};
    defects.forEach(defect => {
      counts[defect.type] = (counts[defect.type] || 0) + 1;
    });
    return counts;
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Not Set';
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatMileage = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '0';
    return value.toLocaleString();
  };

  const getFieldLabel = (fieldName: string): string => {
    const labels: Record<string, string> = {
      mot_expiry_date: 'MOT Expiry',
      tax_due_date: 'Tax Due Date',
      service_due_date: 'Service Due',
      service_due_mileage: 'Service Due Mileage',
      last_service_date: 'Last Service',
      last_service_mileage: 'Last Service Mileage',
      notes: 'Notes',
    };
    return labels[fieldName] || fieldName.replace(/_/g, ' ');
  };

  if (!vehicle && !loading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-16 w-16 text-red-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Vehicle Not Found</h2>
            <p className="text-gray-600 text-center max-w-md mb-4">
              The requested vehicle could not be found.
            </p>
            <Button onClick={() => router.back()} variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {vehicle?.reg_number || <Skeleton className="h-8 w-32" />}
              {vehicle?.nickname && <span className="text-muted-foreground ml-2">({vehicle.nickname})</span>}
            </h1>
            <p className="text-muted-foreground mt-1">Vehicle History & Records</p>
          </div>
        </div>
        {maintenanceRecord && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDialogOpen(true)}
            className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit Vehicle Record
          </Button>
        )}
      </div>

      {/* Vehicle Data Section */}
      {vehicleData && (vehicleData.ves_make || vehicleData.mot_make) && (
        <Card className="bg-gradient-to-r from-blue-900/20 to-blue-800/10 border-blue-700/30">
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {/* Make - prefer VES, fallback to MOT */}
              {(vehicleData.ves_make || vehicleData.mot_make) && (
                <div>
                  <span className="text-slate-400">Make:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_make || vehicleData.mot_make}</span>
                </div>
              )}
              
              {/* Model - from MOT API only */}
              {vehicleData.mot_model && (
                <div>
                  <span className="text-slate-400">Model:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.mot_model}</span>
                </div>
              )}
              
              {/* Colour - prefer VES, fallback to MOT */}
              {(vehicleData.ves_colour || vehicleData.mot_primary_colour) && (
                <div>
                  <span className="text-slate-400">Colour:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_colour || vehicleData.mot_primary_colour}</span>
                </div>
              )}
              
              {/* Year - prefer VES, fallback to MOT */}
              {(vehicleData.ves_year_of_manufacture || vehicleData.mot_year_of_manufacture) && (
                <div>
                  <span className="text-slate-400">Year:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_year_of_manufacture || vehicleData.mot_year_of_manufacture}</span>
                </div>
              )}
              
              {/* Fuel - prefer VES, fallback to MOT */}
              {(vehicleData.ves_fuel_type || vehicleData.mot_fuel_type) && (
                <div>
                  <span className="text-slate-400">Fuel:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_fuel_type || vehicleData.mot_fuel_type}</span>
                </div>
              )}
              
              {/* Current Mileage */}
              {vehicleData.current_mileage && (
                <div>
                  <span className="text-slate-400">Mileage:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.current_mileage.toLocaleString()} miles</span>
                </div>
              )}
              
              {/* First Registration - from MOT API */}
              {vehicleData.mot_first_used_date && (
                <div>
                  <span className="text-slate-400">First Reg:</span>
                  <span className="ml-2 text-white font-medium">
                    {new Date(vehicleData.mot_first_used_date).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </span>
                </div>
              )}
              
              {/* Engine - from VES only */}
              {vehicleData.ves_engine_capacity && (
                <div>
                  <span className="text-slate-400">Engine:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_engine_capacity}cc</span>
                </div>
              )}
              
              {/* Tax Status - from VES */}
              {vehicleData.ves_tax_status && (
                <div>
                  <span className="text-slate-400">Tax Status:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_tax_status}</span>
                </div>
              )}
              
              {/* Tax Due Date */}
              {vehicleData.tax_due_date && (
                <div>
                  <span className="text-slate-400">Tax Due:</span>
                  <span className="ml-2 text-white font-medium">
                    {new Date(vehicleData.tax_due_date).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </span>
                </div>
              )}
              
              {/* MOT Status - from VES */}
              {vehicleData.ves_mot_status && (
                <div>
                  <span className="text-slate-400">MOT Status:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_mot_status}</span>
                </div>
              )}
              
              {/* MOT Due Date */}
              {vehicleData.mot_due_date && (
                <div>
                  <span className="text-slate-400">MOT Due:</span>
                  <span className="ml-2 text-white font-medium">
                    {new Date(vehicleData.mot_due_date).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </span>
                </div>
              )}
              
              {/* CO2 Emissions - from VES */}
              {vehicleData.ves_co2_emissions && (
                <div>
                  <span className="text-slate-400">CO2:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_co2_emissions}g/km</span>
                </div>
              )}
              
              {/* Euro Status - from VES */}
              {vehicleData.ves_euro_status && (
                <div>
                  <span className="text-slate-400">Euro Status:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_euro_status}</span>
                </div>
              )}
              
              {/* Wheelplan - from VES */}
              {vehicleData.ves_wheelplan && (
                <div className="col-span-2">
                  <span className="text-slate-400">Wheelplan:</span>
                  <span className="ml-2 text-white font-medium">{vehicleData.ves_wheelplan}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="mot" className="gap-2">
            <ClipboardCheck className="h-4 w-4" />
            MOT
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Notes
          </TabsTrigger>
        </TabsList>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-6">
          {/* Vehicle Service Information Summary */}
          {maintenanceRecord && (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle>Service Information</CardTitle>
                <CardDescription>Current maintenance status and schedules</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {/* Current Mileage */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Current Mileage</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMileage(maintenanceRecord.current_mileage)}
                    </p>
                  </div>

                  {/* Tax Due */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Tax Due</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMaintenanceDate(maintenanceRecord.tax_due_date)}
                    </p>
                  </div>

                  {/* MOT Due */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">MOT Due</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMaintenanceDate(maintenanceRecord.mot_due_date)}
                    </p>
                  </div>

                  {/* Service Due */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Service Due</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord.next_service_mileage 
                        ? `${formatMileage(maintenanceRecord.next_service_mileage)} miles` 
                        : 'Not Set'}
                    </p>
                  </div>

                  {/* Cambelt Due */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Cambelt Due</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord.cambelt_due_mileage 
                        ? `${formatMileage(maintenanceRecord.cambelt_due_mileage)} miles` 
                        : 'Not Set'}
                    </p>
                  </div>

                  {/* First Aid Kit */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">First Aid Kit</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMaintenanceDate(maintenanceRecord.first_aid_kit_expiry)}
                    </p>
                  </div>

                  {/* Last Service */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Last Service</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord.last_service_mileage 
                        ? `${formatMileage(maintenanceRecord.last_service_mileage)} miles` 
                        : 'Not Set'}
                    </p>
                  </div>

                  {/* Tracker ID */}
                  {maintenanceRecord.tracker_id && (
                    <div className="space-y-1">
                      <span className="text-xs text-slate-400 uppercase tracking-wide">GPS Tracker</span>
                      <p className="text-lg font-semibold text-white">
                        {maintenanceRecord.tracker_id}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle>Maintenance & Workshop History</CardTitle>
              <CardDescription>
                Complete timeline of maintenance updates and workshop tasks
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-32 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Workshop Tasks */}
                  {workshopTasks.map((task) => (
                    <Card 
                      key={task.id} 
                      className="bg-slate-800/50 border-slate-700 border-l-4 border-l-orange-500 cursor-pointer hover:bg-slate-800/70 transition-colors"
                      onClick={() => toggleTaskExpansion(task.id)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                {task.action_type === 'inspection_defect' ? 'Inspection Defect' : 'Workshop Task'}
                              </Badge>
                              {getStatusBadge(task.status)}
                              {/* Feature 3: Category + Subcategory badges */}
                              {/* Show nested category from subcategory (preferred), or direct category (fallback) */}
                              {(task.workshop_task_subcategories?.workshop_task_categories || task.workshop_task_categories) && (
                                <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                  {task.workshop_task_subcategories?.workshop_task_categories?.name || task.workshop_task_categories?.name}
                                </Badge>
                              )}
                              {task.workshop_task_subcategories && (
                                <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/30">
                                  {task.workshop_task_subcategories.name}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium">{task.title}</p>
                            {task.workshop_comments && (
                              <p className="text-sm text-muted-foreground">{task.workshop_comments}</p>
                            )}
                          </div>
                          {expandedTasks.has(task.id) ? (
                            <ChevronUp className="h-5 w-5 text-slate-400 flex-shrink-0" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-slate-400 flex-shrink-0" />
                          )}
                        </div>
                      </CardHeader>
                      {expandedTasks.has(task.id) && (
                        <CardContent className="space-y-4 pt-0" onClick={(e) => e.stopPropagation()}>
                          {/* Timeline */}
                          <div className="space-y-3 border-l-2 border-slate-700 pl-4 ml-2">
                            {/* Created */}
                            <div className="relative">
                              <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-slate-700 border-2 border-slate-900"></div>
                              <div className="flex items-start gap-3">
                                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <div className="flex-1 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">{task.profiles_created?.full_name || 'Unknown'}</span>
                                    <span className="text-xs text-muted-foreground">created task</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {formatRelativeTime(task.created_at)}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Logged (In Progress) */}
                            {task.logged_at && (
                              <div className="relative">
                                <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-blue-500 border-2 border-slate-900"></div>
                                <div className="flex items-start gap-3">
                                  <Clock className="h-4 w-4 text-blue-400 mt-0.5" />
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{task.profiles_logged?.full_name || 'Unknown'}</span>
                                      <span className="text-xs text-muted-foreground">marked in progress</span>
                                    </div>
                                    {task.logged_comment && (
                                      <p className="text-sm text-slate-300">{task.logged_comment}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      {formatRelativeTime(task.logged_at)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Feature 1: Comments Timeline */}
                            {taskComments[task.id]?.map((comment) => (
                              <div key={comment.id} className="relative">
                                <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-purple-500 border-2 border-slate-900"></div>
                                <div className="flex items-start gap-3">
                                  <MessageSquare className="h-4 w-4 text-purple-400 mt-0.5" />
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{comment.author?.full_name || 'Unknown'}</span>
                                      <span className="text-xs text-muted-foreground">added comment</span>
                                    </div>
                                    <p className="text-sm text-slate-300">{comment.body}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatRelativeTime(comment.created_at)}
                                      {comment.updated_at && <span className="ml-1">(edited)</span>}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}

                            {/* Completed */}
                            {task.actioned_at && (
                              <div className="relative">
                                <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-green-500 border-2 border-slate-900"></div>
                                <div className="flex items-start gap-3">
                                  <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5" />
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{task.profiles_actioned?.full_name || 'Unknown'}</span>
                                      <span className="text-xs text-muted-foreground">marked complete</span>
                                    </div>
                                    {task.actioned_comment && (
                                      <p className="text-sm text-slate-300">{task.actioned_comment}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      {formatRelativeTime(task.actioned_at)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}

                  {/* Maintenance History Entries */}
                  {maintenanceHistory.map((entry) => (
                    <Card key={entry.id} className="bg-slate-800/50 border-slate-700 border-l-4 border-l-blue-500">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <Calendar className="h-5 w-5 text-blue-400 mt-0.5" />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{entry.updated_by_name || 'System'}</span>
                              <span className="text-xs text-muted-foreground">updated</span>
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                {getFieldLabel(entry.field_name)}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              <span className="line-through">{entry.old_value || 'None'}</span>
                              {' → '}
                              <span className="text-slate-200">{entry.new_value || 'None'}</span>
                            </div>
                            {entry.comment && (
                              <p className="text-sm text-slate-300 italic">&quot;{entry.comment}&quot;</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {formatRelativeTime(entry.created_at)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {workshopTasks.length === 0 && maintenanceHistory.length === 0 && (
                    <div className="text-center py-12">
                      <Wrench className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">No maintenance history yet</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MOT Tab */}
        <TabsContent value="mot" className="space-y-6">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle>MOT History</CardTitle>
              <CardDescription>Complete MOT test history from GOV.UK database</CardDescription>
            </CardHeader>
            <CardContent>
              {motLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                </div>
              ) : !motData || motData.tests?.length === 0 ? (
                <div className="text-center py-12">
                  <ClipboardCheck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No MOT History</h3>
                  <p className="text-muted-foreground mb-4">
                    This vehicle may be too new or exempt from MOT testing
                  </p>
                  {vehicleData?.mot_due_date && (
                    <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 max-w-md mx-auto">
                      <p className="text-sm text-blue-300">
                        First MOT due: <span className="text-white font-medium">{formatDate(vehicleData.mot_due_date)}</span>
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Current MOT Status Card */}
                  {motData.currentStatus && motData.currentStatus.status !== 'No MOT History' && motData.currentStatus.status !== 'Not Yet Due' && (
                    <Card className="bg-gradient-to-r from-blue-900/30 to-blue-800/20 border-blue-700/50">
                      <CardHeader>
                        <CardTitle className="text-lg text-blue-300 flex items-center gap-2">
                          <CheckCircle className="h-5 w-5" />
                          Current MOT Status
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-slate-400">Expiry Date:</span>
                            <p className="text-white font-semibold text-lg">{formatDate(motData.currentStatus.expiryDate)}</p>
                          </div>
                          <div>
                            <span className="text-slate-400">Status:</span>
                            <p className={`font-semibold text-lg ${motData.currentStatus.status === 'Valid' ? 'text-green-400' : 'text-red-400'}`}>
                              {motData.currentStatus.status}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Days Remaining:</span>
                            <p className="text-white font-semibold text-lg">{motData.currentStatus.daysRemaining}</p>
                          </div>
                          <div>
                            <span className="text-slate-400">Last Test:</span>
                            <p className="text-white font-semibold text-lg">{formatDate(motData.currentStatus.lastTestDate)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Test History */}
                  {motData.tests && motData.tests.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Test History</h3>
                      
                      {motData.tests.map((test: any) => {
                        const defects = Array.isArray(test.defects) ? test.defects : [];
                        const defectCounts = countDefectsByType(defects);
                        const isExpanded = expandedTestId === test.motTestNumber;
                        const isPassed = test.testResult === 'PASSED';
                        
                        return (
                          <Card 
                            key={test.motTestNumber}
                            className={`${
                              isPassed 
                                ? 'bg-gradient-to-r from-green-900/20 to-green-800/10 border-green-700/30' 
                                : 'bg-gradient-to-r from-red-900/20 to-red-800/10 border-red-700/30'
                            }`}
                          >
                            <CardContent className="p-4">
                              {/* Test Header */}
                              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3">
                                <div className="flex items-center gap-3 flex-1">
                                  {isPassed ? (
                                    <CheckCircle className="h-6 w-6 text-green-400 flex-shrink-0" />
                                  ) : (
                                    <XCircle className="h-6 w-6 text-red-400 flex-shrink-0" />
                                  )}
                                  <div>
                                    <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                                      {test.testResult}
                                      <span className="text-sm text-slate-400 font-normal">
                                        {formatDate(test.completedDate)}
                                      </span>
                                    </h4>
                                    {test.expiryDate && (
                                      <p className="text-sm text-slate-400">
                                        Expiry: <span className="text-white font-medium">{formatDate(test.expiryDate)}</span>
                                      </p>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Defect Summary Badges */}
                                {defects.length > 0 && (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {Object.entries(defectCounts).map(([type, count]) => (
                                      <Badge key={type} className={`${getDefectColor(type)} border text-xs`}>
                                        {count} {type}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Test Details */}
                              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 text-sm mb-3">
                                <div className="flex items-center gap-2">
                                  <Gauge className="h-4 w-4 text-slate-400" />
                                  <span className="text-slate-400">Mileage:</span>
                                  <span className="text-white font-medium">
                                    {test.odometerValue ? `${formatMileage(test.odometerValue)} ${test.odometerUnit || ''}`.trim() : 'Not Set'}
                                  </span>
                                </div>
                                {(test.testStationName || test.testStationPcode) && (
                                  <div className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-slate-400" />
                                    <span className="text-slate-400">Station:</span>
                                    <span className="text-white font-medium">
                                      {[test.testStationName, test.testStationPcode].filter(Boolean).join(', ')}
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-400">Test Number:</span>
                                  <span className="text-white font-medium text-xs">{test.motTestNumber}</span>
                                </div>
                              </div>

                              {/* Expandable Defects */}
                              {defects.length > 0 && (
                                <div className="space-y-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setExpandedTestId(isExpanded ? null : test.motTestNumber)}
                                    className="w-full text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                  >
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp className="h-4 w-4 mr-2" />
                                        Hide Defects
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown className="h-4 w-4 mr-2" />
                                        View {defects.length} Defect{defects.length !== 1 ? 's' : ''}
                                      </>
                                    )}
                                  </Button>

                                  {isExpanded && (
                                    <div className="space-y-2 border-t border-slate-700 pt-3">
                                      {defects.map((defect: any, idx: number) => (
                                        <div 
                                          key={idx}
                                          className={`p-3 rounded border ${getDefectColor(defect.type)}`}
                                        >
                                          <div className="flex items-start gap-2">
                                            <span className="text-lg">{getDefectIcon(defect.type)}</span>
                                            <div className="flex-1">
                                              <div className="flex items-center gap-2 mb-1">
                                                <Badge className={`${getDefectColor(defect.type)} border text-xs`}>
                                                  {defect.type}
                                                </Badge>
                                                {defect.locationLateral && (
                                                  <span className="text-xs text-slate-400">
                                                    {defect.locationLateral}
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-sm text-white">{defect.text}</p>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {defects.length === 0 && (
                                <div className="flex items-center gap-2 text-sm text-green-400">
                                  <CheckCircle className="h-4 w-4" />
                                  No defects or advisories recorded
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle>Vehicle Documents</CardTitle>
              <CardDescription>Upload and manage vehicle documents, invoices, and records</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <FileText className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold text-white mb-2">Coming Soon</h3>
                <p className="text-slate-400 mb-4">
                  Document management feature will be implemented in a future update
                </p>
                <p className="text-sm text-muted-foreground">
                  This will allow you to upload and view PDFs, images, and other documents related to this vehicle
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle>Vehicle Notes</CardTitle>
              <CardDescription>General notes and comments about this vehicle</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <MessageSquare className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold text-white mb-2">Coming Soon</h3>
                <p className="text-slate-400 mb-4">
                  Vehicle notes feature will be implemented in a future update
                </p>
                <p className="text-sm text-muted-foreground">
                  This will allow you to add and view general notes about this vehicle
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Vehicle Record Dialog */}
      {maintenanceRecord && (
        <EditMaintenanceDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          vehicle={maintenanceRecord}
          onSuccess={() => {
            setEditDialogOpen(false);
            fetchMaintenanceRecord();
            fetchMaintenanceHistory();
          }}
          onRetire={() => {
            router.push('/fleet?tab=vehicles');
          }}
        />
      )}
    </div>
  );
}
