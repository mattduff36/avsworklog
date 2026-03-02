'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Download, MinusCircle, XCircle } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import type { InspectionItem, InspectionStatus } from '@/types/inspection';

interface HgvInspectionDetails {
  id: string;
  user_id: string;
  hgv_id: string | null;
  inspection_date: string;
  inspection_end_date: string | null;
  current_mileage: number | null;
  status: 'submitted';
  inspector_comments: string | null;
  hgv: {
    reg_number: string;
    nickname: string | null;
    hgv_categories: { name: string } | null;
  } | null;
  profiles: { full_name: string } | null;
}

export default function ViewHgvInspectionPage() {
  const params = useParams();
  const supabase = createClient();
  const { user, isManager, loading: authLoading } = useAuth();

  const [inspection, setInspection] = useState<HgvInspectionDetails | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchInspection = useCallback(async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('hgv_inspections')
        .select(`
          *,
          hgv:hgvs!hgv_inspections_hgv_id_fkey(
            reg_number,
            nickname,
            hgv_categories(name)
          ),
          profiles!hgv_inspections_user_id_fkey(full_name)
        `)
        .eq('id', id)
        .single();

      if (inspectionError || !inspectionData) throw inspectionError || new Error('Inspection not found');

      if (!isManager && inspectionData.user_id !== user?.id) {
        setError('You do not have permission to view this inspection');
        setLoading(false);
        return;
      }

      const { data: itemsData, error: itemsError } = await supabase
        .from('inspection_items')
        .select('*')
        .eq('inspection_id', id)
        .order('item_number');

      if (itemsError) throw itemsError;

      setInspection(inspectionData as HgvInspectionDetails);
      setItems((itemsData || []) as InspectionItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inspection');
    } finally {
      setLoading(false);
    }
  }, [isManager, supabase, user?.id]);

  useEffect(() => {
    if (!params.id || authLoading) return;
    fetchInspection(params.id as string);
  }, [authLoading, fetchInspection, params.id]);

  const getStatusIcon = (status: InspectionStatus) => {
    if (status === 'ok') return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    if (status === 'attention') return <XCircle className="h-5 w-5 text-red-600" />;
    return <MinusCircle className="h-5 w-5 text-slate-400" />;
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading inspection...</p>
      </div>
    );
  }

  if (error && !inspection) {
    return (
      <div className="space-y-6">
        <BackButton fallbackHref="/hgv-inspections" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inspection) return null;

  const defectCount = items.filter(item => item.status === 'attention').length;
  const okCount = items.filter(item => item.status === 'ok').length;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3 md:space-x-4">
            <BackButton fallbackHref="/hgv-inspections" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">HGV Inspection</h1>
              <p className="text-sm md:text-base text-muted-foreground">
                {inspection.hgv?.reg_number || 'Unknown HGV'}
                {inspection.hgv?.nickname ? ` (${inspection.hgv.nickname})` : ''}
                {' • '}
                {formatDate(inspection.inspection_date)}
                {inspection.profiles?.full_name ? ` • ${inspection.profiles.full_name}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/api/hgv-inspections/${inspection.id}/pdf`, '_blank')}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            <Badge>Submitted</Badge>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-green-600">{okCount}</div>
            <div className="text-sm text-muted-foreground">Pass</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-red-600">{defectCount}</div>
            <div className="text-sm text-muted-foreground">Defects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-foreground">{inspection.current_mileage?.toLocaleString() || '-'}</div>
            <div className="text-sm text-muted-foreground">Mileage</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Checklist Items</CardTitle>
          <CardDescription>26-point HGV checklist results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 w-12 font-medium">#</th>
                  <th className="text-left p-2 font-medium">Item</th>
                  <th className="text-center p-2 w-40 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Comments</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-secondary/20">
                    <td className="p-2 text-sm text-muted-foreground">{item.item_number}</td>
                    <td className="p-2 text-sm">{item.item_description}</td>
                    <td className="p-2">
                      <div className="flex items-center justify-center gap-2">
                        {getStatusIcon(item.status)}
                        <span className="text-sm font-medium uppercase">{item.status}</span>
                      </div>
                    </td>
                    <td className="p-2 text-sm">{item.comments || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3">
            {items.map((item) => (
              <Card key={item.id}>
                <CardContent className="pt-4 space-y-2">
                  <div className="font-medium text-sm">{item.item_number}. {item.item_description}</div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    <span className="text-sm uppercase">{item.status}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">{item.comments || 'No comments'}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {inspection.inspector_comments && (
        <Card>
          <CardHeader>
            <CardTitle>Inspector Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{inspection.inspector_comments}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
