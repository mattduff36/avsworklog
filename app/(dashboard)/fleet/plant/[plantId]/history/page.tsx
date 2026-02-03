'use client';

import { useState, useEffect, use } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Wrench, 
  ClipboardCheck, 
  FileText, 
  MessageSquare,
  Calendar,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Gauge,
  HardHat,
  Loader2
} from 'lucide-react';
import { BackButton } from '@/components/ui/back-button';
import { formatRelativeTime } from '@/lib/utils/date';
import { useAuth } from '@/lib/hooks/useAuth';

// Dynamic imports
const WorkshopTaskHistoryCard = dynamic(() => import('@/components/workshop-tasks/WorkshopTaskHistoryCard').then(m => ({ default: m.WorkshopTaskHistoryCard })), { ssr: false });

type Plant = {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  year: number | null;
  weight_class: string | null;
  status: string;
  current_hours: number | null;
  loler_due_date: string | null;
  loler_last_inspection_date: string | null;
  loler_certificate_number: string | null;
  loler_inspection_interval_months: number;
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
  } | null;
  profiles_created: {
    full_name: string;
  } | null;
};

export default function PlantHistoryPage({
  params,
}: {
  params: Promise<{ plantId: string }>;
}) {
  const unwrappedParams = use(params);
  const router = useRouter();
  const supabase = createClient();
  const { profile, loading: authLoading } = useAuth();
  
  const [plant, setPlant] = useState<Plant | null>(null);
  const [workshopTasks, setWorkshopTasks] = useState<WorkshopTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      router.push('/login');
      return;
    }

    fetchPlantData();
    fetchWorkshopTasks();
  }, [unwrappedParams.plantId, profile, authLoading]);

  const fetchPlantData = async () => {
    try {
      const { data, error } = await supabase
        .from('plant')
        .select('*')
        .eq('id', unwrappedParams.plantId)
        .single();

      if (error) throw error;
      setPlant(data);
    } catch (err) {
      console.error('Error fetching plant:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkshopTasks = async () => {
    try {
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
          workshop_task_subcategories (
            id,
            name,
            slug,
            ui_color
          ),
          profiles_created:profiles!created_by (
            full_name
          )
        `)
        .eq('plant_id', unwrappedParams.plantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWorkshopTasks(data as any || []);
    } catch (err) {
      console.error('Error fetching workshop tasks:', err);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!plant) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <HardHat className="h-16 w-16 text-muted-foreground" />
        <p className="text-xl">Plant machinery not found</p>
        <BackButton />
      </div>
    );
  }

  const getAssetDisplay = () => {
    if (plant.nickname) {
      return `${plant.plant_id} (${plant.nickname})`;
    }
    return plant.plant_id;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton />
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <HardHat className="h-8 w-8" />
              {getAssetDisplay()}
            </h1>
            <p className="text-muted-foreground">
              Plant Machinery History &amp; Maintenance Records
            </p>
          </div>
        </div>
        <Badge variant={plant.status === 'active' ? 'default' : 'secondary'}>
          {plant.status}
        </Badge>
      </div>

      {/* Quick Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Current Hours
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {plant.current_hours?.toLocaleString() ?? 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              LOLER Due Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {plant.loler_due_date 
                ? new Date(plant.loler_due_date).toLocaleDateString()
                : 'Not Set'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              {plant.make && <p>Make: {plant.make}</p>}
              {plant.model && <p>Model: {plant.model}</p>}
              {plant.serial_number && <p>Serial: {plant.serial_number}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workshop">Workshop Tasks</TabsTrigger>
          <TabsTrigger value="loler">LOLER Compliance</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Plant Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Plant ID</p>
                <p className="font-medium">{plant.plant_id}</p>
              </div>
              {plant.nickname && (
                <div>
                  <p className="text-sm text-muted-foreground">Nickname</p>
                  <p className="font-medium">{plant.nickname}</p>
                </div>
              )}
              {plant.make && (
                <div>
                  <p className="text-sm text-muted-foreground">Make</p>
                  <p className="font-medium">{plant.make}</p>
                </div>
              )}
              {plant.model && (
                <div>
                  <p className="text-sm text-muted-foreground">Model</p>
                  <p className="font-medium">{plant.model}</p>
                </div>
              )}
              {plant.serial_number && (
                <div>
                  <p className="text-sm text-muted-foreground">Serial Number</p>
                  <p className="font-medium">{plant.serial_number}</p>
                </div>
              )}
              {plant.year && (
                <div>
                  <p className="text-sm text-muted-foreground">Year</p>
                  <p className="font-medium">{plant.year}</p>
                </div>
              )}
              {plant.weight_class && (
                <div>
                  <p className="text-sm text-muted-foreground">Weight Class</p>
                  <p className="font-medium">{plant.weight_class}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Current Hours</p>
                <p className="font-medium">{plant.current_hours?.toLocaleString() ?? 'Not recorded'}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Workshop Tasks Tab */}
        <TabsContent value="workshop" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workshop Task History</CardTitle>
              <CardDescription>
                All workshop tasks and maintenance for this plant machinery
              </CardDescription>
            </CardHeader>
            <CardContent>
              {workshopTasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Wrench className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No workshop tasks recorded</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {workshopTasks.map((task) => (
                    <WorkshopTaskHistoryCard key={task.id} task={task} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* LOLER Tab */}
        <TabsContent value="loler" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>LOLER Compliance</CardTitle>
              <CardDescription>
                Lifting Operations and Lifting Equipment Regulations 1998
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Last Inspection Date</p>
                <p className="font-medium text-lg">
                  {plant.loler_last_inspection_date 
                    ? new Date(plant.loler_last_inspection_date).toLocaleDateString()
                    : 'Not recorded'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Next Inspection Due</p>
                <p className="font-medium text-lg">
                  {plant.loler_due_date 
                    ? new Date(plant.loler_due_date).toLocaleDateString()
                    : 'Not set'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Inspection Interval</p>
                <p className="font-medium text-lg">
                  {plant.loler_inspection_interval_months} months
                </p>
              </div>
              {plant.loler_certificate_number && (
                <div>
                  <p className="text-sm text-muted-foreground">Certificate Number</p>
                  <p className="font-medium text-lg">{plant.loler_certificate_number}</p>
                </div>
              )}
              
              {plant.loler_due_date && (
                <div className="pt-4 border-t">
                  {new Date(plant.loler_due_date) < new Date() ? (
                    <Badge variant="destructive" className="text-base px-4 py-2">
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      LOLER Inspection Overdue
                    </Badge>
                  ) : (
                    <Badge variant="default" className="text-base px-4 py-2">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      LOLER Compliant
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
