'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Send, Edit2, CheckCircle2, XCircle, AlertCircle, Camera } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { INSPECTION_ITEMS, InspectionStatus, VehicleInspection, InspectionItem } from '@/types/inspection';
import PhotoUpload from '@/components/forms/PhotoUpload';
import { Database } from '@/types/database';

interface InspectionWithDetails extends VehicleInspection {
  vehicles: {
    reg_number: string;
    make: string;
    model: string;
  };
}

export default function ViewInspectionPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isManager } = useAuth();
  const supabase = createClient();
  
  const [inspection, setInspection] = useState<InspectionWithDetails | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [photoUploadItem, setPhotoUploadItem] = useState<number | null>(null);

  useEffect(() => {
    if (params.id) {
      fetchInspection(params.id as string);
    }
  }, [params.id, user]);

  const fetchInspection = async (id: string) => {
    try {
      // Fetch inspection
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .select(`
          *,
          vehicles (
            reg_number,
            make,
            model
          )
        `)
        .eq('id', id)
        .single() as { data: InspectionWithDetails | null; error: unknown };

      if (inspectionError) throw inspectionError;
      
      // Check if user has access
      if (!isManager && inspectionData && inspectionData.user_id !== user?.id) {
        setError('You do not have permission to view this inspection');
        return;
      }

      setInspection(inspectionData!);

      // Fetch items
      const { data: itemsData, error: itemsError } = await supabase
        .from('inspection_items')
        .select('*')
        .eq('inspection_id', id)
        .order('item_number');

      if (itemsError) throw itemsError;

      setItems(itemsData || []);
      
      // Enable editing for draft or rejected inspections
      if (inspectionData && (inspectionData.status === 'draft' || inspectionData.status === 'rejected')) {
        setEditing(true);
      }
    } catch (err) {
      console.error('Error fetching inspection:', err);
      setError(err instanceof Error ? err.message : 'Failed to load inspection');
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (itemNumber: number, field: string, value: string | InspectionStatus) => {
    const newItems = items.map(item => 
      item.item_number === itemNumber 
        ? { ...item, [field]: value }
        : item
    );
    setItems(newItems);
  };

  const handleSave = async () => {
    if (!inspection || !user) return;

    setSaving(true);
    setError('');

    try {
      // Update inspection
      type InspectionUpdate = Database['public']['Tables']['vehicle_inspections']['Update'];
      const inspectionUpdate: InspectionUpdate = {
        updated_at: new Date().toISOString(),
      };

      const { error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .update(inspectionUpdate)
        .eq('id', inspection.id);

      if (inspectionError) throw inspectionError;

      // Update items
      type InspectionItemUpdate = Database['public']['Tables']['inspection_items']['Update'];
      for (const item of items) {
        if (item.id) {
          const itemUpdate: InspectionItemUpdate = {
            status: item.status,
            comments: item.comments,
          };

          const { error: updateError } = await supabase
            .from('inspection_items')
            .update(itemUpdate)
            .eq('id', item.id);

          if (updateError) throw updateError;
        }
      }

      // Refresh data
      await fetchInspection(inspection.id);
      setEditing(false);
    } catch (err) {
      console.error('Error saving inspection:', err);
      setError(err instanceof Error ? err.message : 'Failed to save inspection');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!inspection || !user) return;

    // Validate: all defects must have comments
    const defectsWithoutComments = items.filter(
      item => item.status === 'defect' && !item.comments
    );

    if (defectsWithoutComments.length > 0) {
      setError('Please add comments for all defect items');
      return;
    }

    setSaving(true);
    setError('');

    try {
      // Save items first
      await handleSave();

      // Update inspection status
      const { error: updateError } = await supabase
        .from('vehicle_inspections')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', inspection.id);

      if (updateError) throw updateError;

      router.push('/inspections');
    } catch (err) {
      console.error('Error submitting inspection:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit inspection');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!inspection || !isManager) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('vehicle_inspections')
        .update({
          status: 'approved',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', inspection.id);

      if (error) throw error;
      
      await fetchInspection(inspection.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (comments: string) => {
    if (!inspection || !isManager) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('vehicle_inspections')
        .update({
          status: 'rejected',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          manager_comments: comments,
        })
        .eq('id', inspection.id);

      if (error) throw error;
      
      await fetchInspection(inspection.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending Approval' },
      approved: { variant: 'success' as const, label: 'Approved' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
    };
    const config = variants[status as keyof typeof variants] || variants.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: InspectionStatus) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'defect':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'na':
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-gray-100 text-gray-400 border-gray-200';
    
    switch (status) {
      case 'ok':
        return 'bg-green-100 text-green-700 border-green-300';
      case 'defect':
        return 'bg-red-100 text-red-700 border-red-300';
      case 'na':
        return 'bg-gray-100 text-gray-700 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-400 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading inspection...</p>
      </div>
    );
  }

  if (error && !inspection) {
    return (
      <div className="space-y-6">
        <Link href="/inspections">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Inspections
          </Button>
        </Link>
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inspection) return null;

  const canEdit = editing && (inspection.status === 'draft' || inspection.status === 'rejected');
  const canSubmit = inspection.user_id === user?.id && (inspection.status === 'draft' || inspection.status === 'rejected');
  const canApprove = isManager && inspection.status === 'submitted';

  const defectCount = items.filter(item => item.status === 'defect').length;
  const okCount = items.filter(item => item.status === 'ok').length;
  const naCount = items.filter(item => item.status === 'na').length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/inspections">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Vehicle Inspection</h1>
            <p className="text-muted-foreground">
              {inspection.vehicles?.reg_number} • {formatDate(inspection.inspection_date)}
            </p>
          </div>
        </div>
        {getStatusBadge(inspection.status)}
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      {inspection.manager_comments && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Manager Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-800">{inspection.manager_comments}</p>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-green-600">{okCount}</div>
            <div className="text-sm text-muted-foreground">OK</div>
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
            <div className="text-3xl font-bold text-gray-600">{naCount}</div>
            <div className="text-sm text-muted-foreground">N/A</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Inspection Items</CardTitle>
              <CardDescription>
                {inspection.vehicles?.make} {inspection.vehicles?.model}
              </CardDescription>
            </div>
            {canEdit && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 w-12 font-medium">#</th>
                  <th className="text-left p-2 font-medium">Item</th>
                  <th className="text-center p-2 w-48 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Comments</th>
                  <th className="text-center p-2 w-24 font-medium">Photo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-secondary/20">
                    <td className="p-2 text-sm text-muted-foreground">{item.item_number}</td>
                    <td className="p-2 text-sm">{item.item_description}</td>
                    <td className="p-2">
                      {canEdit ? (
                        <div className="flex items-center justify-center gap-2">
                          {(['ok', 'defect', 'na'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => updateItem(item.item_number, 'status', status)}
                              className={`flex items-center justify-center w-10 h-10 rounded border-2 transition-all ${
                                getStatusColor(status, item.status === status)
                              }`}
                              title={status.toUpperCase()}
                            >
                              {getStatusIcon(status)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          {getStatusIcon(item.status)}
                          <span className="ml-2 text-sm font-medium">
                            {item.status.toUpperCase()}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          value={item.comments || ''}
                          onChange={(e) => updateItem(item.item_number, 'comments', e.target.value)}
                          placeholder={item.status === 'defect' ? 'Required for defects' : 'Optional notes'}
                          className={item.status === 'defect' && !item.comments ? 'border-red-300' : ''}
                        />
                      ) : (
                        <span className="text-sm">{item.comments || '-'}</span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPhotoUploadItem(item.item_number)}
                        disabled={!canEdit}
                      >
                        <Camera className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {items.map((item) => (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    {item.item_number}. {item.item_description}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {canEdit ? (
                    <div className="flex items-center justify-center gap-3">
                      {(['ok', 'defect', 'na'] as InspectionStatus[]).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => updateItem(item.item_number, 'status', status)}
                          className={`flex flex-col items-center justify-center w-20 h-20 rounded border-2 transition-all ${
                            getStatusColor(status, item.status === status)
                          }`}
                        >
                          {getStatusIcon(status)}
                          <span className="text-xs mt-1 font-medium">
                            {status.toUpperCase()}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-4">
                      {getStatusIcon(item.status)}
                      <span className="ml-2 font-medium">
                        {item.status.toUpperCase()}
                      </span>
                    </div>
                  )}
                  {canEdit ? (
                    <Input
                      value={item.comments || ''}
                      onChange={(e) => updateItem(item.item_number, 'comments', e.target.value)}
                      placeholder={item.status === 'defect' ? 'Required for defects' : 'Optional notes'}
                      className={item.status === 'defect' && !item.comments ? 'border-red-300' : ''}
                    />
                  ) : (
                    item.comments && (
                      <p className="text-sm text-muted-foreground">{item.comments}</p>
                    )
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setPhotoUploadItem(item.item_number)}
                    disabled={!canEdit}
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    Add Photo
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4">
            {canEdit && (
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
            
            {canSubmit && (
              <Button
                onClick={handleSubmit}
                disabled={saving}
              >
                <Send className="h-4 w-4 mr-2" />
                {saving ? 'Submitting...' : 'Submit for Approval'}
              </Button>
            )}

            {canApprove && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const comments = prompt('Enter rejection reason (optional):');
                    if (comments !== null) {
                      handleReject(comments);
                    }
                  }}
                  disabled={saving}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={saving}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Photo Upload Modal */}
      {photoUploadItem && (
        <PhotoUpload
          inspectionId={inspection.id}
          itemNumber={photoUploadItem}
          onClose={() => setPhotoUploadItem(null)}
          onUploadComplete={() => {
            setPhotoUploadItem(null);
            // Optionally refresh data
          }}
        />
      )}
    </div>
  );
}

