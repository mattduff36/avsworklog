'use client';

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { fetchUserDirectory, type DirectoryUser } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, CheckCircle2, Info, MinusCircle, Send, Timer, User, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';
import { formatDate, formatDateISO, getDayOfWeek } from '@/lib/utils/date';
import { scrollAndHighlightValidationTarget } from '@/lib/utils/validation-scroll';
import type { Database } from '@/types/database';
import type { Employee } from '@/types/common';
import type { InspectionStatus } from '@/types/inspection';
import { useTabletMode } from '@/components/layout/tablet-mode-context';

const SignaturePad = dynamic(() => import('@/components/forms/SignaturePad'), { ssr: false });

type HgvAsset = {
  id: string;
  reg_number: string;
  nickname: string | null;
  current_mileage?: number | null;
  hgv_categories?: { name: string } | null;
};

type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
type InspectionInsert = Database['public']['Tables']['hgv_inspections']['Insert'];

const MIN_HGV_INSPECTION_SECONDS = 10 * 60;
const STICKY_NAV_OFFSET_PX = 96;
const ARTIC_ONLY_START_ITEM = 22;
const ARTIC_ONLY_END_ITEM = 25;

function isArticOnlyItem(itemNumber: number): boolean {
  return itemNumber >= ARTIC_ONLY_START_ITEM && itemNumber <= ARTIC_ONLY_END_ITEM;
}

function NewHgvInspectionContent() {
  const router = useRouter();
  const supabase = createClient();
  const { user, isManager, isAdmin, isSuperAdmin } = useAuth();
  const isElevatedUser = isManager || isAdmin || isSuperAdmin;
  const { tabletModeEnabled } = useTabletMode();

  const [hgvs, setHgvs] = useState<HgvAsset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [hgvId, setHgvId] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  const [currentMileage, setCurrentMileage] = useState('');

  const [checklistStarted, setChecklistStarted] = useState(false);
  const [inspectionStartMs, setInspectionStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const [checkboxStates, setCheckboxStates] = useState<Record<string, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loggedDefects, setLoggedDefects] = useState<Map<string, { comment: string; actionId: string }>>(new Map());

  const [inspectorComments, setInspectorComments] = useState('');
  const [informWorkshop, setInformWorkshop] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const [{ data: hgvData }, employeeData] = await Promise.all([
        supabase
          .from('hgvs')
          .select('id, reg_number, nickname, current_mileage, hgv_categories(name)')
          .eq('status', 'active')
          .order('reg_number'),
        isElevatedUser
          ? fetchUserDirectory({ module: 'hgv-inspections' })
          : Promise.resolve([] as DirectoryUser[]),
      ]);

      setHgvs((hgvData || []) as HgvAsset[]);
      setEmployees(
        employeeData.map((employee) => ({
          id: employee.id,
          full_name: employee.full_name || 'Unknown User',
          employee_id: employee.employee_id,
          has_module_access: employee.has_module_access,
        })) as Employee[]
      );
      if (user) setSelectedEmployeeId(user.id);
    };

    loadData();
  }, [isElevatedUser, supabase, user]);

  useEffect(() => {
    if (!checklistStarted || !inspectionStartMs) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [checklistStarted, inspectionStartMs]);

  const elapsedSeconds = useMemo(() => {
    if (!inspectionStartMs) return 0;
    return Math.max(0, Math.floor((nowMs - inspectionStartMs) / 1000));
  }, [inspectionStartMs, nowMs]);

  const remainingSeconds = Math.max(0, MIN_HGV_INSPECTION_SECONDS - elapsedSeconds);
  const canSubmitNow = remainingSeconds === 0;

  const countdownLabel = useMemo(() => {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [remainingSeconds]);

  const loadLockedDefects = async (selectedHgvId: string) => {
    try {
      const response = await fetch(`/api/hgv-inspections/locked-defects?hgvId=${selectedHgvId}`);
      if (!response.ok) return;
      const { lockedItems } = await response.json();

      const map = new Map<string, { comment: string; actionId: string }>();
      const initialStates: Record<string, InspectionStatus> = {};
      const initialComments: Record<string, string> = {};

      for (const item of lockedItems as Array<{ item_number: number; comment: string; actionId: string }>) {
        const key = `${item.item_number}`;
        map.set(key, { comment: item.comment || 'Defect in progress', actionId: item.actionId });
        initialStates[key] = 'attention';
        initialComments[key] = item.comment || 'Defect in progress';
      }

      setLoggedDefects(map);
      setCheckboxStates(initialStates);
      setComments(initialComments);
    } catch {
      // Non-blocking.
    }
  };

  const startInspection = () => {
    if (!hgvId) {
      setError('Please select an HGV first');
      return;
    }
    if (!inspectionDate) {
      setError('Please select an inspection date');
      return;
    }
    const mileageValue = parseInt(currentMileage, 10);
    if (!currentMileage || Number.isNaN(mileageValue) || mileageValue < 0) {
      setError('Please enter a valid current KM');
      return;
    }
    setError('');
    setChecklistStarted(true);
    setInspectionStartMs(Date.now());
  };

  const handleStatusChange = (itemNumber: number, status: InspectionStatus) => {
    const key = `${itemNumber}`;
    if (loggedDefects.has(key)) return;
    setCheckboxStates(prev => ({ ...prev, [key]: status }));
  };

  const handleCommentChange = (itemNumber: number, comment: string) => {
    const key = `${itemNumber}`;
    if (loggedDefects.has(key)) return;
    setComments(prev => ({ ...prev, [key]: comment }));
  };

  const validate = () => {
    if (!hgvId) return 'Please select an HGV';
    if (!inspectionDate) return 'Please select an inspection date';
    if (!selectedEmployeeId) return 'Please select an employee';

    const mileageValue = parseInt(currentMileage, 10);
    if (Number.isNaN(mileageValue) || mileageValue < 0) {
      return 'Please enter a valid current KM';
    }

    if (!checklistStarted) {
      return 'Click Start Daily Check before completing the checklist';
    }

    const missingStatus = TRUCK_CHECKLIST_ITEMS
      .map((label, idx) => ({ label, key: `${idx + 1}` }))
      .filter(item => !checkboxStates[item.key]);
    if (missingStatus.length > 0) {
      return `Please complete all checklist items before submitting (${missingStatus.length} remaining)`;
    }

    const defectsWithoutComments = Object.entries(checkboxStates)
      .filter(([itemKey, status]) => status === 'attention' && !comments[itemKey]?.trim());
    if (defectsWithoutComments.length > 0) {
      return 'Please add comments for all failed items';
    }

    if (informWorkshop && inspectorComments.trim().length < 10) {
      return 'Workshop notification requires at least 10 characters in notes';
    }

    if (!canSubmitNow) {
      return `HGV inspections require a 10 minute minimum duration. Remaining: ${countdownLabel}`;
    }

    return null;
  };

  const scrollToValidationTarget = () => {
    const scroll = (el: Element | null) =>
      scrollAndHighlightValidationTarget(el, STICKY_NAV_OFFSET_PX);

    if (!hgvId) {
      scroll(document.getElementById('hgv'));
      return;
    }

    if (!inspectionDate) {
      scroll(document.getElementById('inspectionDate'));
      return;
    }

    if (!selectedEmployeeId) {
      scroll(document.getElementById('selectedEmployeeId'));
      return;
    }

    const mileageValue = parseInt(currentMileage, 10);
    if (Number.isNaN(mileageValue) || mileageValue < 0) {
      scroll(document.getElementById('currentMileage'));
      return;
    }

    const firstMissingStatus = TRUCK_CHECKLIST_ITEMS
      .map((_, idx) => `${idx + 1}`)
      .find((itemKey) => !checkboxStates[itemKey]);
    if (firstMissingStatus) {
      scroll(document.querySelector(`[data-checklist-item="${firstMissingStatus}"]`));
      return;
    }

    const firstMissingComment = Object.entries(checkboxStates)
      .find(([itemKey, status]) => status === 'attention' && !comments[itemKey]?.trim());
    if (firstMissingComment) {
      const [itemKey] = firstMissingComment;
      scroll(document.querySelector(`[data-comment-input="${itemKey}"]`));
      return;
    }

    if (informWorkshop && inspectorComments.trim().length < 10) {
      scroll(document.getElementById('inspectorComments'));
    }
  };

  const saveInspection = async (signatureData: string) => {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        setLoading(false);
        return;
      }

      const mileageValue = parseInt(currentMileage, 10);
      const inspectionPayload: InspectionInsert = {
        hgv_id: hgvId,
        user_id: selectedEmployeeId,
        inspection_date: inspectionDate,
        inspection_end_date: inspectionDate,
        current_mileage: mileageValue,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        signature_data: signatureData,
        signed_at: new Date().toISOString(),
        inspector_comments: inspectorComments.trim() || null,
      };

      const { data: inspection, error: insertInspectionError } = await supabase
        .from('hgv_inspections')
        .insert(inspectionPayload)
        .select()
        .single();

      if (insertInspectionError || !inspection) {
        throw insertInspectionError || new Error('Failed to create inspection');
      }

      const { error: updateHgvMileageError } = await supabase
        .from('hgvs')
        .update({ current_mileage: mileageValue })
        .eq('id', hgvId);

      if (updateHgvMileageError) {
        throw updateHgvMileageError;
      }

      const dayOfWeek = getDayOfWeek(new Date(`${inspectionDate}T00:00:00`));
      const itemsToInsert: InspectionItemInsert[] = TRUCK_CHECKLIST_ITEMS.map((itemDescription, idx) => {
        const itemNumber = idx + 1;
        const key = `${itemNumber}`;
        return {
          inspection_id: inspection.id,
          item_number: itemNumber,
          item_description: itemDescription,
          day_of_week: dayOfWeek,
          status: checkboxStates[key],
          comments: comments[key] || null,
        };
      });

      const { data: insertedItems, error: insertItemsError } = await supabase
        .from('inspection_items')
        .insert(itemsToInsert)
        .select();

      if (insertItemsError) {
        throw insertItemsError;
      }

      type InsertedItem = { id: string; item_number: number; item_description: string; day_of_week: number | null; status: InspectionStatus; comments: string | null };
      const failedItems = (insertedItems || []).filter((item: InsertedItem) => item.status === 'attention');
      if (failedItems.length > 0) {
        const defects = failedItems.map((item: InsertedItem) => ({
          item_number: item.item_number,
          item_description: item.item_description,
          dayOfWeek: item.day_of_week,
          comment: item.comments || '',
          primaryInspectionItemId: item.id,
        }));

        await fetch('/api/hgv-inspections/sync-defect-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inspectionId: inspection.id,
            hgvId,
            createdBy: user.id,
            defects,
          }),
        });
      }

      if (informWorkshop && inspectorComments.trim().length >= 10) {
        await fetch('/api/hgv-inspections/inform-workshop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inspectionId: inspection.id,
            hgvId,
            createdBy: user.id,
            comments: inspectorComments.trim(),
          }),
        });
      }

      toast.success('HGV inspection submitted successfully');
      router.push('/hgv-inspections');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save inspection';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmitClicked = () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      scrollToValidationTarget();
      return;
    }
    setShowSignatureDialog(true);
  };

  const getStatusIcon = (status: InspectionStatus, isSelected: boolean) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-green-400' : 'text-muted-foreground'}`} />;
      case 'attention':
        return <XCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-red-400' : 'text-muted-foreground'}`} />;
      case 'na':
        return <MinusCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-blue-300' : 'text-muted-foreground'}`} />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50';
    if (status === 'ok') return 'bg-green-500/20 border-green-500 shadow-lg shadow-green-500/20';
    if (status === 'attention') return 'bg-red-500/20 border-red-500 shadow-lg shadow-red-500/20';
    if (status === 'na') return 'bg-blue-500/20 border-blue-400 shadow-lg shadow-blue-500/20';
    return 'bg-slate-500/20 border-slate-400 shadow-lg shadow-slate-500/20';
  };

  const getStatusOptions = (itemNumber: number): InspectionStatus[] =>
    isArticOnlyItem(itemNumber) ? ['ok', 'attention', 'na'] : ['ok', 'attention'];

  const getStatusLabel = (status: InspectionStatus): string => {
    if (status === 'ok') return 'Pass';
    if (status === 'attention') return 'Fail';
    return 'N/A';
  };

  const completedItems = Object.keys(checkboxStates).length;
  const totalItems = TRUCK_CHECKLIST_ITEMS.length;

  return (
    <div className={`space-y-4 max-w-5xl ${tabletModeEnabled ? 'pb-36' : 'pb-32 md:pb-6'}`}>
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <BackButton fallbackHref="/hgv-inspections" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">New HGV Daily Check</h1>
              <p className="text-sm text-muted-foreground hidden md:block">Daily safety check</p>
            </div>
          </div>
          {checklistStarted && (
            <div className="bg-inspection/10 dark:bg-inspection/20 border border-inspection/30 rounded-lg px-3 py-2">
              <div className="text-xs text-muted-foreground">Progress</div>
              <div className="text-lg font-bold text-foreground">{completedItems}/{totalItems}</div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">Daily Check Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            {inspectionDate ? `Date: ${formatDate(inspectionDate)}` : 'Select a date'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isElevatedUser && (
            <div className="space-y-2 pb-4 border-b border-border">
              <Label className="text-foreground text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating daily check for
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger id="selectedEmployeeId" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                      {employee.full_name}
                      {employee.employee_id ? ` (${employee.employee_id})` : ''}
                      {employee.id === user?.id ? ' (You)' : ''}
                      {employee.has_module_access === false ? ' - No HGV Checks access' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hgv" className="text-foreground text-base flex items-center gap-2">
                HGV
                <span className="text-red-400">*</span>
              </Label>
              <Select
                value={hgvId}
                disabled={checklistStarted}
                onValueChange={(value) => {
                  setHgvId(value);
                  setCheckboxStates({});
                  setComments({});
                  setLoggedDefects(new Map());
                  if (value) {
                    loadLockedDefects(value);
                  }
                }}
              >
                <SelectTrigger id="hgv" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select an HGV" />
                </SelectTrigger>
                <SelectContent>
                  {hgvs.map((hgv) => (
                    <SelectItem key={hgv.id} value={hgv.id}>
                      {hgv.reg_number} {hgv.nickname ? `- ${hgv.nickname}` : ''} ({hgv.hgv_categories?.name || 'Uncategorised'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inspectionDate" className="text-foreground text-base flex items-center gap-2">
                Daily Check Date
                <span className="text-red-400">*</span>
              </Label>
              <Input
                id="inspectionDate"
                type="date"
                value={inspectionDate}
                onChange={(e) => {
                  setError('');
                  setInspectionDate(e.target.value);
                }}
                max={formatDateISO(new Date())}
                disabled={checklistStarted}
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white w-full"
                required
              />
            </div>
          </div>

          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="currentMileage" className="text-foreground text-base flex items-center gap-2">
                Current KM
                <span className="text-red-400">*</span>
              </Label>
              <Input
                id="currentMileage"
                type="number"
                min="0"
                step="1"
                value={currentMileage}
                onChange={(e) => setCurrentMileage(e.target.value)}
                placeholder={(() => {
                  const selectedHgv = hgvs.find((hgv) => hgv.id === hgvId);
                  return selectedHgv?.current_mileage != null ? `e.g. ${selectedHgv.current_mileage}` : 'e.g. 245000';
                })()}
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground"
                required
              />
            </div>

            {!checklistStarted ? (
              <Button
                onClick={startInspection}
                disabled={!hgvId || !inspectionDate || !currentMileage}
                className="h-12 bg-inspection hover:bg-inspection/90 text-white font-semibold whitespace-nowrap"
              >
                <Timer className="h-4 w-4 mr-2" />
                Start Daily Check
              </Button>
            ) : (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg shrink-0">
                <p className="text-sm text-blue-400">
                  <Info className="h-4 w-4 inline mr-2" />
                  Daily check started. The submit button unlocks after 10 minutes.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {checklistStarted && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground">25-Point HGV Safety Check</CardTitle>
            <CardDescription className="text-muted-foreground">
              Mark each item as Pass or Fail (items 22-25 also allow N/A)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 md:p-6">
            <div className={tabletModeEnabled ? 'hidden' : 'hidden md:block overflow-x-auto'}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 w-12 font-medium text-white">#</th>
                    <th className="text-left p-3 font-medium text-white">Item</th>
                    <th className="text-center p-3 w-64 font-medium text-white">Status</th>
                    <th className="text-left p-3 font-medium text-white">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {TRUCK_CHECKLIST_ITEMS.map((item, index) => {
                    const itemNumber = index + 1;
                    const key = `${itemNumber}`;
                    const currentStatus = checkboxStates[key];
                    const isLocked = loggedDefects.has(key);
                    const statusOptions = getStatusOptions(itemNumber);
                    return (
                      <Fragment key={itemNumber}>
                        {itemNumber === ARTIC_ONLY_START_ITEM && (
                          <tr className="bg-blue-500/10 border-y border-blue-400/40">
                            <td colSpan={4} className="p-2 text-center text-xs font-semibold tracking-wide text-blue-200 uppercase">
                              Artics only
                            </td>
                          </tr>
                        )}
                        <tr data-checklist-item={key} className={`border-b border-border/50 hover:bg-slate-800/30 ${isLocked ? 'bg-red-500/5' : ''}`}>
                          <td className="p-3 text-sm text-muted-foreground">{itemNumber}</td>
                          <td className="p-3 text-sm text-white">
                            {item}
                            {isLocked && <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30 text-xs">LOCKED</Badge>}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-2">
                              {statusOptions.map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  onClick={() => handleStatusChange(itemNumber, status)}
                                  disabled={isLocked}
                                  className={`flex flex-col items-center justify-center w-14 h-14 rounded-lg border-2 transition-all ${getStatusColor(status, currentStatus === status)} ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                  {getStatusIcon(status, currentStatus === status)}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="p-3">
                            <Input
                              id={`hgv-comment-${itemNumber}`}
                              data-comment-input={key}
                              value={comments[key] || ''}
                              onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                              placeholder={currentStatus === 'attention' ? 'Required for failed items' : 'Optional notes'}
                              className={`bg-slate-900/50 border-slate-600 text-white ${currentStatus === 'attention' && !comments[key] ? 'border-red-500' : ''}`}
                              readOnly={isLocked}
                            />
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={tabletModeEnabled ? 'space-y-3' : 'md:hidden space-y-3'}>
              {TRUCK_CHECKLIST_ITEMS.map((item, index) => {
                const itemNumber = index + 1;
                const key = `${itemNumber}`;
                const currentStatus = checkboxStates[key];
                const isLocked = loggedDefects.has(key);
                const statusOptions = getStatusOptions(itemNumber);
                return (
                  <Fragment key={itemNumber}>
                    {itemNumber === ARTIC_ONLY_START_ITEM && (
                      <div className="rounded-md border border-blue-400/50 bg-blue-500/10 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-blue-200">
                        Artics only
                      </div>
                    )}
                    <div data-checklist-item={key} className={`bg-slate-900/30 border rounded-lg p-4 space-y-3 ${isLocked ? 'border-red-500/50' : 'border-border/50'}`}>
                      <div className="text-sm font-medium text-white">{itemNumber}. {item}</div>
                      <div className={`grid ${statusOptions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                        {statusOptions.map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => handleStatusChange(itemNumber, status)}
                            disabled={isLocked}
                            className={`h-12 rounded-xl border-2 ${getStatusColor(status, currentStatus === status)} ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {getStatusLabel(status)}
                          </button>
                        ))}
                      </div>
                      <Textarea
                        id={`hgv-comment-${itemNumber}`}
                        data-comment-input={key}
                        value={comments[key] || ''}
                        onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                        placeholder={currentStatus === 'attention' ? 'Required for failed items' : 'Optional notes'}
                        className="min-h-[80px] bg-slate-900/50 border-slate-600 text-white"
                        readOnly={isLocked}
                      />
                    </div>
                  </Fragment>
                );
              })}
            </div>

            <div className="mt-6 p-4 bg-slate-800/40 border border-border/50 rounded-lg space-y-4">
              <div className="space-y-2">
                <Label className="text-white text-base">End of Daily Check Notes</Label>
                <Textarea
                  id="inspectorComments"
                  value={inspectorComments}
                  onChange={(e) => setInspectorComments(e.target.value)}
                  placeholder="Add any additional notes..."
                  className="min-h-[100px] bg-slate-900/50 border-slate-600 text-white"
                  maxLength={500}
                />
              </div>
              <div className="flex items-start space-x-3 p-3 bg-slate-900/30 rounded-lg border border-border/30">
                <Checkbox
                  id="inform-workshop"
                  checked={informWorkshop}
                  onCheckedChange={(checked) => setInformWorkshop(checked === true)}
                  className="mt-0.5 border-slate-500 data-[state=checked]:bg-workshop data-[state=checked]:border-workshop"
                />
                <div className="flex-1">
                  <Label htmlFor="inform-workshop" className="text-white cursor-pointer">Inform Workshop</Label>
                  <p className="text-xs text-muted-foreground mt-1">Creates a workshop task from your notes.</p>
                </div>
              </div>
            </div>

            <div className={tabletModeEnabled ? 'hidden' : 'hidden md:flex flex-row gap-3 justify-end pt-4'}>
              <Button
                onClick={onSubmitClicked}
                disabled={loading || !canSubmitNow}
                className="bg-inspection hover:bg-inspection/90 text-white font-semibold disabled:opacity-70"
              >
                <Send className="h-4 w-4 mr-2" />
                {canSubmitNow ? 'Submit Daily Check' : `Submit available in ${countdownLabel}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {checklistStarted && (
        <div className={`${tabletModeEnabled ? 'fixed bottom-0 left-0 right-0' : 'md:hidden fixed bottom-0 left-0 right-0'} bg-slate-900/95 backdrop-blur-xl border-t border-border/50 p-4 z-20`}>
          <Button
            onClick={onSubmitClicked}
            disabled={loading || !canSubmitNow}
            className={`${tabletModeEnabled ? 'w-full min-h-11 text-base bg-inspection hover:bg-inspection/90 text-white font-semibold disabled:opacity-70' : 'w-full h-14 bg-inspection hover:bg-inspection/90 text-white font-semibold text-base disabled:opacity-70'}`}
          >
            <Send className="h-5 w-5 mr-2" />
            {canSubmitNow ? 'Submit Daily Check' : `Submit in ${countdownLabel}`}
          </Button>
        </div>
      )}

      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="border-border text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Daily Check</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Sign below to confirm your inspection is accurate.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePad
              onSave={async (signatureData: string) => {
                setShowSignatureDialog(false);
                await saveInspection(signatureData);
              }}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NewHgvInspectionPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <NewHgvInspectionContent />
    </Suspense>
  );
}
