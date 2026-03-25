'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchUserDirectory, type DirectoryUser } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, ArrowLeft, Camera, CheckCircle2, Info, MinusCircle, Send, Timer, User, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';
import { formatDate, formatDateISO, getDayOfWeek } from '@/lib/utils/date';
import { scrollAndHighlightValidationTarget } from '@/lib/utils/validation-scroll';
import type { Database } from '@/types/database';
import type { Employee } from '@/types/common';
import type { InspectionStatus } from '@/types/inspection';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { InspectionPhotoTiles } from '@/components/inspections/InspectionPhotoTiles';
import { useInspectionPhotos } from '@/lib/hooks/useInspectionPhotos';
import { getInspectionPhotoKey } from '@/lib/inspection-photos';

const PhotoUpload = dynamic(() => import('@/components/forms/PhotoUpload'), { ssr: false });
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
type PendingNavigation = { type: 'href'; href: string } | { type: 'back' };
type ExistingInspectionConflict = { id: string; status: 'draft' | 'submitted' };

const MIN_HGV_INSPECTION_SECONDS = 10 * 60;
const STICKY_NAV_OFFSET_PX = 96;
const ARTIC_ONLY_START_ITEM = 22;
const ARTIC_ONLY_END_ITEM = 25;

function isArticOnlyItem(itemNumber: number): boolean {
  return itemNumber >= ARTIC_ONLY_START_ITEM && itemNumber <= ARTIC_ONLY_END_ITEM;
}

function NewHgvInspectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id');
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
  const saveInspectionInFlightRef = useRef(false);
  const allowNavigationRef = useRef(false);

  const [existingInspectionId, setExistingInspectionId] = useState<string | null>(draftId);
  const [photoUploadItem, setPhotoUploadItem] = useState<{ itemNumber: number; dayOfWeek: number } | null>(null);
  const [savingDraftForPhoto, setSavingDraftForPhoto] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const [conflictingDraftId, setConflictingDraftId] = useState<string | null>(null);
  const [showDraftConflictDialog, setShowDraftConflictDialog] = useState(false);
  const [resolvingDraftConflict, setResolvingDraftConflict] = useState(false);
  const [submittedConflictInspectionId, setSubmittedConflictInspectionId] = useState<string | null>(null);
  const [showSubmittedConflictDialog, setShowSubmittedConflictDialog] = useState(false);
  const { photoMap, refresh: refreshInspectionPhotos } = useInspectionPhotos(existingInspectionId, {
    enabled: Boolean(existingInspectionId),
  });

  const getPhotosForItem = useCallback(
    (itemNumber: number, dayOfWeek: number) =>
      photoMap[getInspectionPhotoKey(itemNumber, dayOfWeek)] ?? [],
    [photoMap]
  );

  const beginChecklist = useCallback(() => {
    setChecklistStarted(true);
    setInspectionStartMs(Date.now());
  }, []);

  const findExistingInspectionConflict = useCallback(async (): Promise<ExistingInspectionConflict | null> => {
    if (!hgvId || !inspectionDate) {
      return null;
    }

    const { data, error } = await supabase
      .from('hgv_inspections')
      .select('id, status')
      .eq('hgv_id', hgvId)
      .eq('inspection_date', inspectionDate)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Failed to check for existing inspection:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    if (data.id === existingInspectionId) {
      return null;
    }

    return {
      id: data.id,
      status: data.status as 'draft' | 'submitted',
    };
  }, [existingInspectionId, hgvId, inspectionDate, supabase]);

  const handleInspectionConflict = useCallback((conflict: ExistingInspectionConflict): void => {
    if (conflict.status === 'draft') {
      setConflictingDraftId(conflict.id);
      setShowDraftConflictDialog(true);
      toast.info('A draft already exists for this HGV and date.');
      return;
    }

    setSubmittedConflictInspectionId(conflict.id);
    setShowSubmittedConflictDialog(true);
    toast.info('A daily check has already been submitted for this HGV and date.');
  }, []);

  const discardDraftById = useCallback(async (inspectionId: string, showToast = true): Promise<boolean> => {
    try {
      const response = await fetch(`/api/hgv-inspections/${inspectionId}/discard`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to discard draft');
      }

      if (existingInspectionId === inspectionId) {
        setExistingInspectionId(null);
        setPhotoUploadItem(null);
        window.history.replaceState(null, '', '/hgv-inspections/new');
      }

      if (showToast) {
        toast.success('Draft discarded');
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to discard draft';
      toast.error(message);
      return false;
    }
  }, [existingInspectionId]);

  const navigateWithoutPrompt = useCallback((navigation: PendingNavigation) => {
    allowNavigationRef.current = true;
    if (navigation.type === 'back') {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push('/hgv-inspections');
      }
      return;
    }

    router.push(navigation.href);
  }, [router]);

  const requestNavigation = useCallback((navigation: PendingNavigation) => {
    if (!existingInspectionId || saveInspectionInFlightRef.current || allowNavigationRef.current) {
      navigateWithoutPrompt(navigation);
      return;
    }
    setPendingNavigation(navigation);
    setShowDiscardDraftDialog(true);
  }, [existingInspectionId, navigateWithoutPrompt]);

  const ensureDraftSaved = async (): Promise<string | null> => {
    if (existingInspectionId) return existingInspectionId;
    if (!user || !selectedEmployeeId || !hgvId) {
      toast.error('Select an HGV, employee and date before adding photos');
      return null;
    }
    if (!inspectionDate) {
      toast.error('Select an inspection date before adding photos');
      return null;
    }

    const inspectionConflict = await findExistingInspectionConflict();
    if (inspectionConflict) {
      handleInspectionConflict(inspectionConflict);
      return null;
    }

    setSavingDraftForPhoto(true);
    try {
      const mileageValue = parseInt(currentMileage, 10);
      const { data: draft, error: draftError } = await supabase
        .from('hgv_inspections')
        .insert({
          hgv_id: hgvId,
          user_id: selectedEmployeeId,
          inspection_date: inspectionDate,
          inspection_end_date: inspectionDate,
          current_mileage: Number.isNaN(mileageValue) ? null : mileageValue,
          status: 'draft' as const,
          inspector_comments: inspectorComments.trim() || null,
        })
        .select('id')
        .single();

      if (draftError) {
        if (draftError.code === '23505') {
          const inspectionConflict = await findExistingInspectionConflict();
          if (inspectionConflict) {
            handleInspectionConflict(inspectionConflict);
            return null;
          }
        }
        throw draftError;
      }

      const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
      const items: InspectionItemInsert[] = [];
      TRUCK_CHECKLIST_ITEMS.forEach((itemDescription, idx) => {
        const itemNumber = idx + 1;
        const key = `${itemNumber}`;
        if (checkboxStates[key]) {
          items.push({
            inspection_id: draft.id,
            item_number: itemNumber,
            item_description: itemDescription,
            day_of_week: dayOfWeek,
            status: checkboxStates[key],
            comments: comments[key] || null,
          });
        }
      });

      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('inspection_items')
          .insert(items);
        if (itemsError) throw itemsError;
      }

      setExistingInspectionId(draft.id);
      window.history.replaceState(null, '', `/hgv-inspections/new?id=${draft.id}`);
      return draft.id;
    } catch (err) {
      console.error('Silent draft save failed:', err);
      toast.error('Could not auto-save draft. Please try again.');
      return null;
    } finally {
      setSavingDraftForPhoto(false);
    }
  };

  const loadDraftInspection = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const { data: draft, error: draftError } = await supabase
        .from('hgv_inspections')
        .select('id, hgv_id, user_id, inspection_date, current_mileage, inspector_comments, created_at')
        .eq('id', id)
        .eq('status', 'draft')
        .single();

      if (draftError || !draft) {
        setExistingInspectionId(null);
        window.history.replaceState(null, '', '/hgv-inspections/new');
        return;
      }

      setExistingInspectionId(id);
      setConflictingDraftId(null);
      setShowDraftConflictDialog(false);
      setSubmittedConflictInspectionId(null);
      setShowSubmittedConflictDialog(false);
      setHgvId(draft.hgv_id);
      setInspectionDate(draft.inspection_date);
      setCurrentMileage(draft.current_mileage != null ? String(draft.current_mileage) : '');
      setSelectedEmployeeId(draft.user_id);
      setInspectorComments(draft.inspector_comments || '');

      const { data: items } = await supabase
        .from('inspection_items')
        .select('item_number, status, comments')
        .eq('inspection_id', id);

      const restoredStates: Record<string, InspectionStatus> = {};
      const restoredComments: Record<string, string> = {};
      for (const item of (items || []) as Array<{ item_number: number; status: InspectionStatus; comments: string | null }>) {
        const key = `${item.item_number}`;
        restoredStates[key] = item.status;
        if (item.comments) restoredComments[key] = item.comments;
      }
      setCheckboxStates(restoredStates);
      setComments(restoredComments);

      setChecklistStarted(true);
      const createdAt = draft.created_at ? new Date(draft.created_at).getTime() : Date.now();
      setInspectionStartMs(createdAt);

      if (draft.hgv_id) {
        await loadLockedDefects(draft.hgv_id);
      }
    } catch (err) {
      console.error('Error loading HGV draft:', err);
      toast.error('Failed to load draft inspection');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

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
    if (draftId && user) {
      loadDraftInspection(draftId);
    }
  }, [draftId, user, loadDraftInspection]);

  useEffect(() => {
    if (!existingInspectionId) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveInspectionInFlightRef.current || allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [existingInspectionId]);

  useEffect(() => {
    if (!existingInspectionId) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (saveInspectionInFlightRef.current || allowNavigationRef.current) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.hasAttribute('download') || anchor.target === '_blank') return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        return;
      }

      const nextUrl = new URL(rawHref, window.location.origin);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;

      const nextPathWithSearch = `${nextUrl.pathname}${nextUrl.search}`;
      const currentPathWithSearch = `${currentUrl.pathname}${currentUrl.search}`;
      if (nextPathWithSearch === currentPathWithSearch) return;

      event.preventDefault();
      event.stopPropagation();
      requestNavigation({ type: 'href', href: nextPathWithSearch });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [existingInspectionId, requestNavigation]);

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

  const startInspection = async () => {
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

    if (!existingInspectionId) {
      const inspectionConflict = await findExistingInspectionConflict();
      if (inspectionConflict) {
        handleInspectionConflict(inspectionConflict);
        return;
      }
    }

    setError('');
    beginChecklist();
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

  const saveInspection = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || saveInspectionInFlightRef.current) return;
    saveInspectionInFlightRef.current = true;
    setLoading(true);
    setError('');

    try {
      if (status === 'submitted') {
        const validationError = validate();
        if (validationError) {
          setError(validationError);
          setLoading(false);
          return;
        }
      }

      if (!hgvId || !inspectionDate || !selectedEmployeeId) {
        throw new Error('Select an HGV, employee and date before saving');
      }

      const mileageValue = parseInt(currentMileage, 10);
      if (Number.isNaN(mileageValue) || mileageValue < 0) {
        throw new Error('Please enter a valid current KM');
      }

      const inspectionPayload: InspectionInsert = {
        hgv_id: hgvId,
        user_id: selectedEmployeeId,
        inspection_date: inspectionDate,
        inspection_end_date: inspectionDate,
        current_mileage: mileageValue,
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: status === 'submitted' ? signatureData || null : null,
        signed_at: status === 'submitted' && signatureData ? new Date().toISOString() : null,
        inspector_comments: inspectorComments.trim() || null,
      };

      let inspectionId = existingInspectionId;

      if (existingInspectionId) {
        const { data: updatedInspection, error: updateError } = await supabase
          .from('hgv_inspections')
          .update(inspectionPayload)
          .eq('id', existingInspectionId)
          .select('id')
          .single();

        if (updateError || !updatedInspection) {
          throw updateError || new Error('Failed to update inspection');
        }
        inspectionId = updatedInspection.id;
      } else {
        const { data: newInspection, error: insertInspectionError } = await supabase
          .from('hgv_inspections')
          .insert(inspectionPayload)
          .select('id')
          .single();

        if (insertInspectionError || !newInspection) {
          throw insertInspectionError || new Error('Failed to create inspection');
        }
        inspectionId = newInspection.id;
        setExistingInspectionId(newInspection.id);
        window.history.replaceState(null, '', `/hgv-inspections/new?id=${newInspection.id}`);
      }

      if (!inspectionId) {
        throw new Error('Failed to resolve inspection id');
      }

      if (existingInspectionId) {
        const { error: deleteItemsError } = await supabase
          .from('inspection_items')
          .delete()
          .eq('inspection_id', existingInspectionId);
        if (deleteItemsError) {
          throw deleteItemsError;
        }
      }

      const dayOfWeek = getDayOfWeek(new Date(`${inspectionDate}T00:00:00`));
      const itemsToInsert: InspectionItemInsert[] = [];
      TRUCK_CHECKLIST_ITEMS.forEach((itemDescription, idx) => {
        const itemNumber = idx + 1;
        const key = `${itemNumber}`;
        const itemStatus = checkboxStates[key];

        if (!itemStatus) {
          return;
        }

        itemsToInsert.push({
          inspection_id: inspectionId,
          item_number: itemNumber,
          item_description: itemDescription,
          day_of_week: dayOfWeek,
          status: itemStatus,
          comments: comments[key] || null,
        });
      });

      type InsertedItem = {
        id: string;
        item_number: number;
        item_description: string;
        day_of_week: number | null;
        status: InspectionStatus;
        comments: string | null;
      };
      let insertedItems: InsertedItem[] = [];

      if (itemsToInsert.length > 0) {
        const { data, error: insertItemsError } = await supabase
          .from('inspection_items')
          .insert(itemsToInsert)
          .select('id, item_number, item_description, day_of_week, status, comments');

        if (insertItemsError) {
          throw insertItemsError;
        }
        insertedItems = (data || []) as InsertedItem[];
      }

      if (status === 'submitted') {
        const { error: updateHgvMileageError } = await supabase
          .from('hgvs')
          .update({ current_mileage: mileageValue })
          .eq('id', hgvId);

        if (updateHgvMileageError) {
          throw updateHgvMileageError;
        }
      }

      const failedItems = insertedItems.filter((item) => item.status === 'attention');
      if (status === 'submitted' && failedItems.length > 0) {
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
            inspectionId,
            hgvId,
            createdBy: user.id,
            defects,
          }),
        });
      }

      if (status === 'submitted' && informWorkshop && inspectorComments.trim().length >= 10) {
        await fetch('/api/hgv-inspections/inform-workshop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inspectionId,
            hgvId,
            createdBy: user.id,
            comments: inspectorComments.trim(),
          }),
        });
      }

      if (status === 'submitted') {
        toast.success('HGV inspection submitted successfully');
        allowNavigationRef.current = true;
        router.push(`/hgv-inspections/${inspectionId}`);
      } else {
        toast.success('Draft saved');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save inspection';
      setError(message);
      toast.error(message);
    } finally {
      saveInspectionInFlightRef.current = false;
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

  const handleBackButtonClick = () => {
    requestNavigation({ type: 'back' });
  };

  const handleStayOnPage = () => {
    setPendingNavigation(null);
    setShowDiscardDraftDialog(false);
  };

  const handleDiscardAndContinueNavigation = async () => {
    if (!pendingNavigation) {
      setShowDiscardDraftDialog(false);
      return;
    }

    if (!existingInspectionId) {
      setShowDiscardDraftDialog(false);
      const nextNavigation = pendingNavigation;
      setPendingNavigation(null);
      navigateWithoutPrompt(nextNavigation);
      return;
    }

    setDiscardingDraft(true);
    const discarded = await discardDraftById(existingInspectionId, false);
    setDiscardingDraft(false);
    if (!discarded) {
      return;
    }

    setShowDiscardDraftDialog(false);
    const nextNavigation = pendingNavigation;
    setPendingNavigation(null);
    navigateWithoutPrompt(nextNavigation);
  };

  const handleResumeConflictingDraft = async () => {
    if (!conflictingDraftId) return;
    setResolvingDraftConflict(true);
    try {
      window.history.replaceState(null, '', `/hgv-inspections/new?id=${conflictingDraftId}`);
      await loadDraftInspection(conflictingDraftId);
      setShowDraftConflictDialog(false);
      setConflictingDraftId(null);
    } finally {
      setResolvingDraftConflict(false);
    }
  };

  const handleDiscardConflictingDraftAndStart = async () => {
    if (!conflictingDraftId) return;
    setResolvingDraftConflict(true);
    const discarded = await discardDraftById(conflictingDraftId, false);
    setResolvingDraftConflict(false);
    if (!discarded) return;

    setConflictingDraftId(null);
    setShowDraftConflictDialog(false);
    setError('');
    if (!checklistStarted) {
      beginChecklist();
    }
  };

  const handleViewSubmittedConflictInspection = () => {
    if (!submittedConflictInspectionId) return;
    allowNavigationRef.current = true;
    setShowSubmittedConflictDialog(false);
    const inspectionId = submittedConflictInspectionId;
    setSubmittedConflictInspectionId(null);
    router.push(`/hgv-inspections/${inspectionId}`);
  };

  const handleUseDifferentDateForSubmittedConflict = () => {
    setShowSubmittedConflictDialog(false);
    setSubmittedConflictInspectionId(null);
    setError('A daily check is already submitted for this HGV and date. Choose a different date to continue.');
    scrollAndHighlightValidationTarget(document.getElementById('inspectionDate'), STICKY_NAV_OFFSET_PX);
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
            <Button
              variant="outline"
              size="icon"
              onClick={handleBackButtonClick}
              className="ui-component border-2 border-slate-600 text-slate-200 bg-slate-900/50 hover:bg-slate-800 hover:border-slate-500 hover:text-white focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
              aria-label="Back"
              title="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
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
                            {currentStatus === 'attention' && !isLocked && (() => {
                              const dayOfWeek = inspectionDate ? getDayOfWeek(new Date(inspectionDate + 'T00:00:00')) : 1;
                              const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
                              return (
                                <div className="mt-3">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                      const id = await ensureDraftSaved();
                                      if (id) setPhotoUploadItem({ itemNumber, dayOfWeek });
                                    }}
                                    disabled={savingDraftForPhoto}
                                    title={itemPhotos.length > 0 ? `${itemPhotos.length} photo(s) saved` : 'Add photo'}
                                    className={`h-10 min-w-24 gap-1.5 text-xs ${
                                      itemPhotos.length > 0
                                        ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                                        : 'border-border text-muted-foreground hover:text-white'
                                    }`}
                                  >
                                    <Camera className="h-3.5 w-3.5" />
                                    {savingDraftForPhoto ? 'Saving...' : itemPhotos.length > 0 ? `${itemPhotos.length} saved` : 'Add photo'}
                                  </Button>
                                </div>
                              );
                            })()}
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
                      {currentStatus === 'attention' && !isLocked && (() => {
                        const dayOfWeek = inspectionDate ? getDayOfWeek(new Date(inspectionDate + 'T00:00:00')) : 1;
                        const itemPhotos = getPhotosForItem(itemNumber, dayOfWeek);
                        return (
                          <InspectionPhotoTiles
                            photos={itemPhotos}
                            onManage={async () => {
                              const id = await ensureDraftSaved();
                              if (id) setPhotoUploadItem({ itemNumber, dayOfWeek });
                            }}
                            title={`Item #${itemNumber} photos`}
                            description={`Uploaded photos for ${item}.`}
                            emptyLabel={savingDraftForPhoto ? 'Saving draft...' : 'Add / View Photos'}
                            emptyHint="No photos saved yet"
                            manageLabel="Add / View"
                          />
                        );
                      })()}
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Do not tick this for defects already reported above. Marking a defect already creates a workshop task. Only use this if your comments describe an additional task that is not linked to a reported defect.
                  </p>
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

      <AlertDialog
        open={showDiscardDraftDialog}
        onOpenChange={(open) => {
          setShowDiscardDraftDialog(open);
          if (!open) setPendingNavigation(null);
        }}
      >
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard draft inspection?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Leaving this page will discard your hidden HGV draft so it does not block another check for this HGV today.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStayOnPage} disabled={discardingDraft}>
              Stay on page
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (event) => {
                event.preventDefault();
                await handleDiscardAndContinueNavigation();
              }}
              disabled={discardingDraft}
              className="bg-red-600 hover:bg-red-700"
            >
              {discardingDraft ? 'Discarding...' : 'Discard and leave'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showDraftConflictDialog}
        onOpenChange={(open) => {
          setShowDraftConflictDialog(open);
          if (!open) setConflictingDraftId(null);
        }}
      >
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Existing draft found</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              A hidden draft already exists for this HGV and date. Resume it or discard it and start a new check.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={resolvingDraftConflict}
              onClick={() => {
                setShowDraftConflictDialog(false);
                setConflictingDraftId(null);
              }}
            >
              Keep current form
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={handleResumeConflictingDraft}
              disabled={resolvingDraftConflict || !conflictingDraftId}
              className="border-border text-white hover:bg-slate-800"
            >
              {resolvingDraftConflict ? 'Working...' : 'Resume existing draft'}
            </Button>
            <AlertDialogAction
              onClick={async (event) => {
                event.preventDefault();
                await handleDiscardConflictingDraftAndStart();
              }}
              disabled={resolvingDraftConflict || !conflictingDraftId}
              className="bg-red-600 hover:bg-red-700"
            >
              {resolvingDraftConflict ? 'Working...' : 'Discard old draft and start new'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showSubmittedConflictDialog}
        onOpenChange={(open) => {
          setShowSubmittedConflictDialog(open);
          if (!open) setSubmittedConflictInspectionId(null);
        }}
      >
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Daily check already submitted</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              An HGV daily check already exists for this vehicle and date. You can view the submitted check or pick another date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleUseDifferentDateForSubmittedConflict}>
              Choose different date
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleViewSubmittedConflictInspection}>
              View existing check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              disabled={loading}
              onSave={async (signatureData: string) => {
                setShowSignatureDialog(false);
                await saveInspection('submitted', signatureData);
              }}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {photoUploadItem && existingInspectionId && (
        <PhotoUpload
          inspectionId={existingInspectionId}
          itemNumber={photoUploadItem.itemNumber}
          dayOfWeek={photoUploadItem.dayOfWeek}
          onClose={() => setPhotoUploadItem(null)}
          onUploadComplete={() => {
            void refreshInspectionPhotos();
          }}
        />
      )}
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
