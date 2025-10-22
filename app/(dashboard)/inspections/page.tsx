'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { Plus, Clipboard, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { VehicleInspection } from '@/types/inspection';

interface InspectionWithVehicle extends VehicleInspection {
  vehicles: {
    reg_number: string;
    vehicle_type: string;
  };
}

export default function InspectionsPage() {
  const { user, isManager } = useAuth();
  const [inspections, setInspections] = useState<InspectionWithVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    fetchInspections();
  }, [user]);

  const fetchInspections = async () => {
    if (!user) return;
    
    try {
      let query = supabase
        .from('vehicle_inspections')
        .select(`
          *,
          vehicles (
            reg_number,
            vehicle_type
          )
        `)
        .order('inspection_date', { ascending: false });

      // If not manager, only show own inspections
      if (!isManager) {
        query = query.eq('user_id', user.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setInspections(data || []);
    } catch (error) {
      console.error('Error fetching inspections:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending' },
      approved: { variant: 'success' as const, label: 'Approved' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Clock className="h-5 w-5 text-amber-600" />;
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clipboard className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Vehicle Inspections</h1>
          <p className="text-slate-400">
            Daily safety check sheets
          </p>
        </div>
        <Link href="/inspections/new">
          <Button className="bg-inspection hover:bg-inspection/90 text-white">
            <Plus className="h-4 w-4 mr-2" />
            New Inspection
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
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
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clipboard className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No inspections yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first vehicle inspection
            </p>
            <Link href="/inspections/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Inspection
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {inspections.map((inspection) => (
            <Link key={inspection.id} href={`/inspections/${inspection.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(inspection.status)}
                      <div>
                        <CardTitle className="text-lg">
                          {inspection.vehicles?.reg_number || 'Unknown Vehicle'}
                        </CardTitle>
                        <CardDescription>
                          {inspection.vehicles?.vehicle_type && `${inspection.vehicles.vehicle_type} • `}{formatDate(inspection.inspection_date)}
                        </CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(inspection.status)}
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
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
