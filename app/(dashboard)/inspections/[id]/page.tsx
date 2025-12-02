'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Send, Edit2, CheckCircle2, XCircle, AlertCircle, Camera, Download } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { InspectionStatus, VehicleInspection, InspectionItem } from '@/types/inspection';
import PhotoUpload from '@/components/forms/PhotoUpload';
import { Database } from '@/types/database';

interface InspectionWithDetails extends VehicleInspection {
  vehicles: {
    reg_number: string;
    vehicle_type: string;
  };
}

export default function ViewInspectionPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isManager, loading: authLoading } = useAuth();
  const supabase = createClient();
  
  const [inspection, setInspection] = useState<InspectionWithDetails | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [photoUploadItem, setPhotoUploadItem] = useState<number | null>(null);

  useEffect(() => {
    if (params.id && !authLoading) {
      fetchInspection(params.id as string);
    }
  }, [params.id, user, authLoading]);

  const fetchInspection = async (id: string) => {
    try {
      setError(''); // Clear any previous errors
      
      // Fetch inspection
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .select(`
          *,
          vehicles (
            reg_number,
            vehicle_type
          )
        `)
        .eq('id', id)
        .single() as { data: InspectionWithDetails | null; error: unknown };

      if (inspectionError) throw inspectionError;
      
      // Check if user has access
      if (!isManager && inspectionData && inspectionData.user_id !== user?.id) {
        setError('You do not have permission to view this inspection');
        setLoading(false);
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
      
      // Enable editing only for draft inspections
      if (inspectionData && inspectionData.status === 'draft') {
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
      console.log('[Mobile Debug] Starting save...', {
        inspectionId: inspection.id,
        totalItems: items.length,
        itemsWithStatus: items.filter(item => item.status).length,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
      });

      // Update inspection
      type InspectionUpdate = Database['public']['Tables']['vehicle_inspections']['Update'];
      const inspectionUpdate: InspectionUpdate = {
        updated_at: new Date().toISOString(),
      };

      const { error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .update(inspectionUpdate)
        .eq('id', inspection.id);

      if (inspectionError) {
        console.error('[Mobile Debug] Inspection update error:', inspectionError);
        throw inspectionError;
      }
      console.log('[Mobile Debug] Inspection updated successfully');

      // Delete all existing items and re-insert them
      // This handles both updating existing items and adding new items
      console.log('[Mobile Debug] Deleting existing items...');
      const { error: deleteError } = await supabase
        .from('inspection_items')
        .delete()
        .eq('inspection_id', inspection.id);

      if (deleteError) {
        console.error('[Mobile Debug] Delete error:', deleteError);
        throw deleteError;
      }
      console.log('[Mobile Debug] Existing items deleted successfully');

      // Re-insert all items (both existing and new)
      // Only insert items that have been explicitly set (non-null status)
      type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
      const itemsToInsert: InspectionItemInsert[] = items
        .filter(item => item.status) // Only save items with a status set
        .map(item => ({
          inspection_id: inspection.id,
          item_number: item.item_number,
          item_description: item.item_description,
          day_of_week: item.day_of_week,
          status: item.status,
          comments: item.comments || null,
        }));

      console.log('[Mobile Debug] Items to insert:', {
        count: itemsToInsert.length,
        sample: itemsToInsert.length > 0 ? itemsToInsert[0] : null,
      });

      if (itemsToInsert.length > 0) {
        const { error: insertError, data: insertedData } = await supabase
          .from('inspection_items')
          .insert(itemsToInsert)
          .select();

        if (insertError) {
          console.error('[Mobile Debug] Insert error:', insertError);
          throw insertError;
        }
        console.log('[Mobile Debug] Items inserted successfully:', insertedData?.length);
      }

      console.log('[Mobile Debug] Save completed, refreshing data...');
      // Refresh data
      await fetchInspection(inspection.id);
      setEditing(false);
      console.log('[Mobile Debug] Save process complete!');
    } catch (err) {
      console.error('[Mobile Debug] Error saving inspection:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to save inspection';
      setError(errorMessage);
      
      // Log to error logger if available
      if (typeof window !== 'undefined' && (window as any).errorLogger) {
        (window as any).errorLogger.logError({
          error: err,
          componentName: 'InspectionEditPage - handleSave',
          additionalData: {
            inspectionId: inspection.id,
            itemCount: items.length,
            itemsWithStatus: items.filter(item => item.status).length,
            isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
          },
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!inspection || !user) return;

    // Validate: all defects must have comments
    const defectsWithoutComments = items.filter(
      item => item.status === 'attention' && !item.comments
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

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Submitted' },
    };
    const config = variants[status as keyof typeof variants] || variants.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: InspectionStatus) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'attention':
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
      case 'attention':
        return 'bg-red-100 text-red-700 border-red-300';
      case 'na':
        return 'bg-gray-100 text-gray-700 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-400 border-gray-200';
    }
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

  const canEdit = editing && inspection.status === 'draft';
  const canSubmit = inspection.user_id === user?.id && inspection.status === 'draft';

  const defectCount = items.filter(item => item.status === 'attention').length;
  const okCount = items.filter(item => item.status === 'ok').length;
  const naCount = items.filter(item => item.status === 'na').length;

  // Check if this is a weekly inspection (has day_of_week data)
  const isWeeklyInspection = items.length > 0 && items[0].day_of_week !== null;

  // For weekly inspections, group items by item_number to show in table format
  const uniqueItems: Array<{ number: number; description: string }> = [];
  if (isWeeklyInspection) {
    const seenNumbers = new Set<number>();
    items.forEach(item => {
      if (!seenNumbers.has(item.item_number)) {
        seenNumbers.add(item.item_number);
        uniqueItems.push({
          number: item.item_number,
          description: item.item_description,
        });
      }
    });
    uniqueItems.sort((a, b) => a.number - b.number);
  }

  // Helper to get item status for a specific day
  const getItemStatusForDay = (itemNumber: number, dayOfWeek: number): InspectionStatus | null => {
    const item = items.find(i => i.item_number === itemNumber && i.day_of_week === dayOfWeek);
    return item ? item.status : null;
  };

  // Day names for weekly view
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
              {inspection.vehicles?.reg_number} • {
                inspection.inspection_end_date && inspection.inspection_end_date !== inspection.inspection_date
                  ? `${formatDate(inspection.inspection_date)} - ${formatDate(inspection.inspection_end_date)}`
                  : formatDate(inspection.inspection_date)
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <a href={`/api/inspections/${inspection.id}/pdf`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
            </a>
          )}
          {getStatusBadge(inspection.status)}
        </div>
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
                {inspection.vehicles?.vehicle_type || 'Vehicle'}
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
            {isWeeklyInspection ? (
              /* Weekly Inspection Table - grouped by day */
              <table className="w-full border-collapse border border-slate-300 dark:border-slate-600">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-600">
                    <th className="text-left p-2 w-12 font-medium border-r border-slate-300 dark:border-slate-600">#</th>
                    <th className="text-left p-2 font-medium border-r border-slate-300 dark:border-slate-600">Item</th>
                    {dayNames.map((day, index) => (
                      <th key={index} className="text-center p-2 w-16 font-medium border-r border-slate-300 dark:border-slate-600 last:border-r-0">
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uniqueItems.map((item) => (
                    <tr key={item.number} className="border-b border-slate-300 dark:border-slate-600 hover:bg-secondary/20">
                      <td className="p-2 text-sm text-muted-foreground font-medium border-r border-slate-300 dark:border-slate-600">
                        {item.number}
                      </td>
                      <td className="p-2 text-sm border-r border-slate-300 dark:border-slate-600">
                        {item.description}
                      </td>
                      {[1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => {
                        const status = getItemStatusForDay(item.number, dayOfWeek);
                        return (
                          <td key={dayOfWeek} className="p-2 text-center border-r border-slate-300 dark:border-slate-600 last:border-r-0">
                            {status ? (
                              <div className="flex items-center justify-center">
                                {getStatusIcon(status)}
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              /* Standard Inspection Table - flat list */
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
                            placeholder={item.status === 'attention' ? 'Required for defects' : 'Optional notes'}
                            className={item.status === 'attention' && !item.comments ? 'border-red-300' : ''}
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
            )}
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {isWeeklyInspection ? (
              /* Weekly Inspection - show items grouped by item number with days */
              uniqueItems.map((item) => (
                <Card key={item.number}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      {item.number}. {item.description}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-7 gap-1">
                      {dayNames.map((day, index) => {
                        const dayOfWeek = index + 1;
                        const status = getItemStatusForDay(item.number, dayOfWeek);
                        return (
                          <div key={index} className="flex flex-col items-center p-2 border border-slate-200 dark:border-slate-700 rounded">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                              {day}
                            </span>
                            {status ? (
                              <div className="flex items-center justify-center">
                                {getStatusIcon(status)}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              /* Standard Inspection - show flat list */
              items.map((item) => (
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
                        placeholder={item.status === 'attention' ? 'Required for defects' : 'Optional notes'}
                        className={item.status === 'attention' && !item.comments ? 'border-red-300' : ''}
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
              ))
            )}
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
                {saving ? 'Submitting...' : 'Submit Inspection'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Defects & Comments Section */}
      {items.some(item => item.status === 'attention' || item.comments) && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
          <CardHeader>
            <CardTitle className="text-red-900 dark:text-red-400">Defects & Comments</CardTitle>
            <CardDescription className="text-red-700 dark:text-red-500">
              Items requiring attention or with additional notes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {items
                .filter(item => item.status === 'attention' || item.comments)
                .sort((a, b) => {
                  // Sort by day_of_week first, then item_number
                  if (a.day_of_week !== b.day_of_week) {
                    return (a.day_of_week || 0) - (b.day_of_week || 0);
                  }
                  return a.item_number - b.item_number;
                })
                .map((item) => {
                  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                  const dayName = item.day_of_week ? dayNames[item.day_of_week - 1] : '';
                  const statusBadge = item.status === 'attention' 
                    ? <Badge variant="destructive" className="ml-2">DEFECT</Badge>
                    : <Badge variant="secondary" className="ml-2">NOTE</Badge>;
                  
                  return (
                    <div 
                      key={`${item.item_number}-${item.day_of_week}`}
                      className="p-3 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 rounded-md"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        {getStatusIcon(item.status)}
                        <div className="flex-1">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {item.item_number}. {item.item_description}
                            {dayName && ` (${dayName})`}
                            {statusBadge}
                          </div>
                        </div>
                      </div>
                      {item.comments && (
                        <div className="mt-2 pl-7 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-2 rounded border-l-4 border-red-400">
                          <span className="font-semibold">Comment:</span> {item.comments}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

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

