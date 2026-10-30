'use client';

import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Archive, Download, Edit, GraduationCap, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import {
  TRAINING_COLLECTIONS,
  TRAINING_TAB_COLLECTIONS,
  clearTrainingLoads,
  fetchTrainingCollection,
  invalidateTrainingCollections,
  isCurrentTrainingRead,
  parseTrainingTab,
  splitTrainingRefresh,
  trainingCollectionEpoch,
  trainingScopeKey,
  type TrainingCollection,
  type TrainingLoadScope,
  type TrainingMutation,
  type TrainingTab,
} from '@/lib/client/training-data-loader';
import { useAuth } from '@/lib/hooks/useAuth';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  TRAINING_VALIDATION_STATUS_OPTIONS,
  type TrainingPerson,
  type TrainingPersonFormData,
  type TrainingQualification,
  type TrainingQualificationFormData,
  type TrainingRecordFormData,
  type TrainingRecordWithRelations,
  type TrainingSummary,
  type TrainingWorkbookNote,
} from '@/types/training';
import { TrainingRecordDialog } from './components/TrainingRecordDialog';
import { TrainingPersonDialog } from './components/TrainingPersonDialog';
import { TrainingQualificationDialog } from './components/TrainingQualificationDialog';

type RecordFilter = 'all' | 'expired' | 'expiring' | 'no_expiry' | 'needs_nvq' | 'awaiting_card' | 'training_booked' | 'manual_review' | 'subcontractors' | 'unlinked' | 'archived';
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CollectionSlot<TData> {
  status: LoadStatus;
  data: TData | null;
  error: string | null;
}

interface TrainingPersonWithProfile extends TrainingPerson {
  profile?: {
    id: string;
    full_name: string | null;
    employee_id: string | null;
  } | null;
}

interface TrainingCollectionsState {
  summary: CollectionSlot<TrainingSummary>;
  records: CollectionSlot<TrainingRecordWithRelations[]>;
  people: CollectionSlot<TrainingPersonWithProfile[]>;
  qualifications: CollectionSlot<TrainingQualification[]>;
  notes: CollectionSlot<TrainingWorkbookNote[]>;
}

type TrainingCollectionsAction =
  | { type: 'reset' }
  | { type: 'loading'; collections: readonly TrainingCollection[] }
  | { type: 'clear'; collections: readonly TrainingCollection[] }
  | { type: 'summary-ready'; data: TrainingSummary }
  | { type: 'records-ready'; data: TrainingRecordWithRelations[] }
  | { type: 'people-ready'; data: TrainingPersonWithProfile[] }
  | { type: 'qualifications-ready'; data: TrainingQualification[] }
  | { type: 'notes-ready'; data: TrainingWorkbookNote[] }
  | { type: 'error'; collection: TrainingCollection; message: string };

function idleSlot<TData>(): CollectionSlot<TData> {
  return { status: 'idle', data: null, error: null };
}

function markCollectionLoading(state: TrainingCollectionsState, collection: TrainingCollection): TrainingCollectionsState {
  switch (collection) {
    case 'summary':
      return { ...state, summary: { status: 'loading', data: state.summary.data, error: null } };
    case 'records':
      return { ...state, records: { status: 'loading', data: state.records.data, error: null } };
    case 'people':
      return { ...state, people: { status: 'loading', data: state.people.data, error: null } };
    case 'qualifications':
      return { ...state, qualifications: { status: 'loading', data: state.qualifications.data, error: null } };
    case 'notes':
      return { ...state, notes: { status: 'loading', data: state.notes.data, error: null } };
    default:
      return state;
  }
}

function clearCollection(state: TrainingCollectionsState, collection: TrainingCollection): TrainingCollectionsState {
  switch (collection) {
    case 'summary':
      return { ...state, summary: idleSlot() };
    case 'records':
      return { ...state, records: idleSlot() };
    case 'people':
      return { ...state, people: idleSlot() };
    case 'qualifications':
      return { ...state, qualifications: idleSlot() };
    case 'notes':
      return { ...state, notes: idleSlot() };
    default:
      return state;
  }
}

function markCollectionError(
  state: TrainingCollectionsState,
  collection: TrainingCollection,
  message: string,
): TrainingCollectionsState {
  switch (collection) {
    case 'summary':
      return { ...state, summary: { status: 'error', data: state.summary.data, error: message } };
    case 'records':
      return { ...state, records: { status: 'error', data: state.records.data, error: message } };
    case 'people':
      return { ...state, people: { status: 'error', data: state.people.data, error: message } };
    case 'qualifications':
      return { ...state, qualifications: { status: 'error', data: state.qualifications.data, error: message } };
    case 'notes':
      return { ...state, notes: { status: 'error', data: state.notes.data, error: message } };
    default:
      return state;
  }
}

function idleCollections(): TrainingCollectionsState {
  return {
    summary: idleSlot(),
    records: idleSlot(),
    people: idleSlot(),
    qualifications: idleSlot(),
    notes: idleSlot(),
  };
}

function trainingCollectionsReducer(
  state: TrainingCollectionsState,
  action: TrainingCollectionsAction,
): TrainingCollectionsState {
  switch (action.type) {
    case 'reset':
      return idleCollections();
    case 'loading':
      return action.collections.reduce((next, collection) => markCollectionLoading(next, collection), state);
    case 'clear':
      return action.collections.reduce((next, collection) => clearCollection(next, collection), state);
    case 'summary-ready':
      return { ...state, summary: { status: 'ready', data: action.data, error: null } };
    case 'records-ready':
      return { ...state, records: { status: 'ready', data: action.data, error: null } };
    case 'people-ready':
      return { ...state, people: { status: 'ready', data: action.data, error: null } };
    case 'qualifications-ready':
      return { ...state, qualifications: { status: 'ready', data: action.data, error: null } };
    case 'notes-ready':
      return { ...state, notes: { status: 'ready', data: action.data, error: null } };
    case 'error':
      return markCollectionError(state, action.collection, action.message);
    default:
      return state;
  }
}

const COLLECTION_LOADING_MESSAGE: Record<TrainingCollection, string> = {
  summary: 'Loading training summary...',
  records: 'Loading training records...',
  people: 'Loading training people...',
  qualifications: 'Loading qualifications...',
  notes: 'Loading workbook notes...',
};

const RECORD_FILTERS: Array<{ value: RecordFilter; label: string }> = [
  { value: 'all', label: 'All Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'expiring', label: 'Expiring 90 Days' },
  { value: 'no_expiry', label: 'No Expiry' },
  { value: 'needs_nvq', label: 'Needs NVQ' },
  { value: 'awaiting_card', label: 'Awaiting Card' },
  { value: 'training_booked', label: 'Training Booked' },
  { value: 'manual_review', label: 'Manual Review' },
  { value: 'subcontractors', label: 'Subcontractors' },
  { value: 'unlinked', label: 'Unlinked People' },
  { value: 'archived', label: 'Archived' },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB');
}

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getExpiryStatus(record: TrainingRecordWithRelations): 'expired' | 'expiring' | 'ok' | 'none' {
  if (!record.expiry_date) return 'none';
  const todayIso = new Date().toISOString().slice(0, 10);
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 90);
  const soonIso = soonDate.toISOString().slice(0, 10);
  if (record.expiry_date < todayIso) return 'expired';
  if (record.expiry_date <= soonIso) return 'expiring';
  return 'ok';
}

function expiryBadgeClass(status: ReturnType<typeof getExpiryStatus>): string {
  if (status === 'expired') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'expiring') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'none') return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

function includesSearch(haystack: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return haystack.some((value) => (value || '').toLowerCase().includes(query));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
}

async function parseJsonResponse(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }
  return payload;
}

function SummaryCard({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <Card className="border-border bg-white dark:bg-slate-900">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function TrainingDevelopmentBanner() {
  return (
    <Card className="border-amber-500/30 bg-amber-500/10">
      <CardContent className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-300" />
        <div>
          <div className="font-medium text-amber-100">Training module still in development</div>
          <p className="mt-1 text-sm text-amber-100/80">
            This module is being actively built. Data, filters, and workflows may change while final checks are completed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CollectionFallback({
  collection,
  error,
  onRetry,
}: {
  collection: TrainingCollection;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button type="button" variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  return <PanelLoader message={COLLECTION_LOADING_MESSAGE[collection]} accent="brand" className="py-12" />;
}

function TrainingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isViewingAs, effectiveRole, loading: authLoading } = useAuth();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('training', false);
  const [collections, dispatch] = useReducer(trainingCollectionsReducer, undefined, idleCollections);
  const [refreshing, setRefreshing] = useState(false);
  const [recordSearch, setRecordSearch] = useState('');
  const [recordFilter, setRecordFilter] = useState<RecordFilter>('all');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [qualificationSearch, setQualificationSearch] = useState('');
  const [qualificationStatus, setQualificationStatus] = useState('all');
  const [notesSearch, setNotesSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TrainingRecordWithRelations | null>(null);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [editingPerson, setEditingPerson] = useState<TrainingPersonWithProfile | null>(null);
  const [editingQualification, setEditingQualification] = useState<TrainingQualification | null>(null);
  const [archivingRecordId, setArchivingRecordId] = useState<string | null>(null);

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TrainingTab>(() => parseTrainingTab(tabParam));
  const viewAsKey = isViewingAs
    ? `view:${effectiveRole?.name ?? ''}:${effectiveRole?.team_id ?? ''}`
    : 'self';
  const derivedScope: TrainingLoadScope | null = (!authLoading && !permissionLoading && hasPermission && user?.id)
    ? { userId: user.id, allowed: true, viewAsKey }
    : null;
  const derivedKey = derivedScope ? trainingScopeKey(derivedScope) : null;
  const scopeRef = useRef<TrainingLoadScope | null>(derivedScope);
  const derivedScopeRef = useRef(derivedScope);
  const loadedRef = useRef(new Set<TrainingCollection>());
  const generationRef = useRef(0);
  const activeTabRef = useRef(activeTab);
  const previousKeyRef = useRef<string | null | undefined>(undefined);
  derivedScopeRef.current = derivedScope;
  activeTabRef.current = activeTab;
  scopeRef.current = derivedScope;
  if (previousKeyRef.current !== derivedKey) {
    const previousKey = previousKeyRef.current;
    previousKeyRef.current = derivedKey;
    if (previousKey !== undefined) {
      generationRef.current += 1;
      clearTrainingLoads();
      loadedRef.current.clear();
      setRefreshing(false);
      dispatch({ type: 'reset' });
    }
  }

  const loadCollections = useCallback(async (
    requested: readonly TrainingCollection[],
    showRefreshing = false,
  ) => {
    const scope = scopeRef.current;
    if (!scope?.allowed || requested.length === 0) return;
    const generation = generationRef.current;
    const epochsAtStart = Object.fromEntries(
      requested.map((collection) => [collection, trainingCollectionEpoch(collection)]),
    ) as Record<TrainingCollection, number>;
    if (showRefreshing) setRefreshing(true);
    dispatch({ type: 'loading', collections: requested });
    const results = await Promise.all(requested.map(async (collection) => {
      try {
        if (collection === 'summary') {
          const read = await fetchTrainingCollection<TrainingSummary>(scope, collection);
          return { ok: true as const, collection, epoch: read.epoch, scopeKey: read.scopeKey, data: read.data };
        }
        if (collection === 'records') {
          const read = await fetchTrainingCollection<TrainingRecordWithRelations[]>(scope, collection);
          return { ok: true as const, collection, epoch: read.epoch, scopeKey: read.scopeKey, data: read.data };
        }
        if (collection === 'people') {
          const read = await fetchTrainingCollection<TrainingPersonWithProfile[]>(scope, collection);
          return { ok: true as const, collection, epoch: read.epoch, scopeKey: read.scopeKey, data: read.data };
        }
        if (collection === 'qualifications') {
          const read = await fetchTrainingCollection<TrainingQualification[]>(scope, collection);
          return { ok: true as const, collection, epoch: read.epoch, scopeKey: read.scopeKey, data: read.data };
        }
        const read = await fetchTrainingCollection<TrainingWorkbookNote[]>(scope, 'notes');
        return { ok: true as const, collection: 'notes' as const, epoch: read.epoch, scopeKey: read.scopeKey, data: read.data };
      } catch (error) {
        return { ok: false as const, collection, error };
      }
    }));
    if (generation !== generationRef.current) return;
    const currentScopeKey = scopeRef.current ? trainingScopeKey(scopeRef.current) : null;
    let toastMessage: string | null = null;
    for (const result of results) {
      if (!result.ok) {
        if (trainingCollectionEpoch(result.collection) !== epochsAtStart[result.collection]) continue;
        if (currentScopeKey !== trainingScopeKey(scope)) continue;
        loadedRef.current.delete(result.collection);
        const message = result.error instanceof Error ? result.error.message : 'Failed to load training data';
        dispatch({ type: 'error', collection: result.collection, message });
        toastMessage = message;
        continue;
      }
      if (!isCurrentTrainingRead(result, trainingCollectionEpoch(result.collection), currentScopeKey)) continue;
      loadedRef.current.add(result.collection);
      if (result.collection === 'summary') dispatch({ type: 'summary-ready', data: result.data });
      else if (result.collection === 'records') dispatch({ type: 'records-ready', data: result.data });
      else if (result.collection === 'people') dispatch({ type: 'people-ready', data: result.data });
      else if (result.collection === 'qualifications') dispatch({ type: 'qualifications-ready', data: result.data });
      else dispatch({ type: 'notes-ready', data: result.data });
    }
    if (toastMessage) toast.error(toastMessage);
    if (showRefreshing && generation === generationRef.current) setRefreshing(false);
  }, []);

  const refreshAfterMutation = useCallback(async (mutation: TrainingMutation) => {
    const { refresh, stale } = splitTrainingRefresh(mutation, activeTabRef.current);
    const affected = [...refresh, ...stale];
    invalidateTrainingCollections(affected);
    for (const collection of affected) loadedRef.current.delete(collection);
    if (stale.length > 0) dispatch({ type: 'clear', collections: stale });
    await loadCollections(refresh, true);
  }, [loadCollections]);

  const refreshVisible = useCallback(async () => {
    const visible = TRAINING_TAB_COLLECTIONS[activeTabRef.current];
    const hidden = TRAINING_COLLECTIONS.filter((collection) => !visible.includes(collection));
    invalidateTrainingCollections(TRAINING_COLLECTIONS);
    loadedRef.current.clear();
    if (hidden.length > 0) dispatch({ type: 'clear', collections: hidden });
    await loadCollections(visible, true);
  }, [loadCollections]);

  useEffect(() => {
    setActiveTab(parseTrainingTab(tabParam));
  }, [tabParam]);

  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    scopeRef.current = derivedScopeRef.current;
    if (!authLoading && !permissionLoading && !derivedScopeRef.current) {
      toast.error('Access denied', { id: 'training-access-denied' });
      routerRef.current.push('/dashboard');
    }
    return () => {
      generationRef.current += 1;
      scopeRef.current = null;
      clearTrainingLoads();
    };
  }, [authLoading, derivedKey, permissionLoading]);

  useEffect(() => {
    if (!derivedKey || !scopeRef.current?.allowed) return;
    const missing = TRAINING_TAB_COLLECTIONS[activeTab].filter((collection) => !loadedRef.current.has(collection));
    if (missing.length === 0) return;
    void loadCollections(missing);
  }, [activeTab, derivedKey, loadCollections]);

  function setTab(tab: TrainingTab) {
    setActiveTab(tab);
    router.replace(`/training?tab=${tab}`, { scroll: false });
  }

  function retryCollection(collection: TrainingCollection) {
    loadedRef.current.delete(collection);
    void loadCollections([collection]);
  }

  const filteredRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    return (collections.records.data ?? []).filter((record) => {
      const expiryStatus = getExpiryStatus(record);
      if (recordFilter === 'all' && record.record_status !== 'active') return false;
      if (recordFilter === 'archived' && record.record_status !== 'archived') return false;
      if (recordFilter === 'expired' && (record.record_status !== 'active' || expiryStatus !== 'expired')) return false;
      if (recordFilter === 'expiring' && (record.record_status !== 'active' || expiryStatus !== 'expiring')) return false;
      if (recordFilter === 'no_expiry' && (record.record_status !== 'active' || record.expiry_date)) return false;
      if (recordFilter === 'needs_nvq' && (record.record_status !== 'active' || !record.cpcs_statuses.includes('needs_nvq'))) return false;
      if (recordFilter === 'awaiting_card' && (record.record_status !== 'active' || !record.cpcs_statuses.includes('awaiting_card'))) return false;
      if (recordFilter === 'training_booked' && (record.record_status !== 'active' || !record.cpcs_statuses.includes('training_booked'))) return false;
      if (recordFilter === 'manual_review' && (record.record_status !== 'active' || record.qualification_validation_status !== 'needs_manual_review')) return false;
      if (recordFilter === 'subcontractors' && (record.record_status !== 'active' || record.relationship !== 'sub_contractor')) return false;
      if (recordFilter === 'unlinked' && (record.record_status !== 'active' || record.person?.profile_match_status === 'matched')) return false;

      return includesSearch([
        record.employee_name_raw,
        record.qualification_raw,
        record.qualification_canonical_proposed,
        record.card_number,
        record.source_sheet,
        record.comments,
      ], query);
    });
  }, [collections.records.data, recordFilter, recordSearch]);

  const filteredPeople = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    return (collections.people.data ?? []).filter((person) => includesSearch([
      person.employee_name_raw,
      person.employee_key,
      person.profile?.full_name,
      person.profile_match_status,
      person.profile_match_notes,
    ], query));
  }, [collections.people.data, peopleSearch]);

  const filteredQualifications = useMemo(() => {
    const query = qualificationSearch.trim().toLowerCase();
    return (collections.qualifications.data ?? []).filter((qualification) => {
      if (qualificationStatus !== 'all' && qualification.validation_status !== qualificationStatus) return false;
      return includesSearch([
        qualification.qualification_raw,
        qualification.canonical_name,
        qualification.validation_status,
        qualification.validation_notes,
      ], query);
    });
  }, [collections.qualifications.data, qualificationSearch, qualificationStatus]);

  const filteredNotes = useMemo(() => {
    const query = notesSearch.trim().toLowerCase();
    return (collections.notes.data ?? []).filter((note) => includesSearch([
      note.source_sheet,
      note.cell_address,
      note.note_value,
      note.reason,
      note.note_type,
    ], query));
  }, [collections.notes.data, notesSearch]);

  const priorityTrainingRecords = useMemo(() => (collections.records.data ?? [])
    .filter((record) => record.record_status === 'active')
    .filter((record) => ['expired', 'expiring', 'none'].includes(getExpiryStatus(record)) || record.cpcs_statuses.length > 0)
    .slice(0, 10), [collections.records.data]);

  const recordPagination = useLoadMorePagination(filteredRecords, { resetKey: `${recordFilter}:${recordSearch}:${filteredRecords.length}` });
  const peoplePagination = useLoadMorePagination(filteredPeople, { resetKey: `${peopleSearch}:${filteredPeople.length}` });
  const qualificationPagination = useLoadMorePagination(filteredQualifications, { resetKey: `${qualificationSearch}:${qualificationStatus}:${filteredQualifications.length}` });
  const notesPagination = useLoadMorePagination(filteredNotes, { resetKey: `${notesSearch}:${filteredNotes.length}` });

  async function saveRecord(form: TrainingRecordFormData) {
    const target = editingRecord;
    const response = await fetch(target ? `/api/training/records/${target.id}` : '/api/training/records', {
      method: target ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    await parseJsonResponse(response, target ? 'Failed to update training record' : 'Failed to create training record');
    toast.success(target ? 'Training record updated' : 'Training record created');
    setEditingRecord(null);
    setCreatingRecord(false);
    await refreshAfterMutation('record');
  }

  async function archiveRecord(record: TrainingRecordWithRelations) {
    if (!confirm(`Archive training record for ${record.employee_name_raw || 'this person'}?`)) return;
    setArchivingRecordId(record.id);
    try {
      const response = await fetch(`/api/training/records/${record.id}`, { method: 'DELETE' });
      await parseJsonResponse(response, 'Failed to archive training record');
      toast.success('Training record archived');
      await refreshAfterMutation('record');
    } finally {
      setArchivingRecordId(null);
    }
  }

  async function savePerson(form: TrainingPersonFormData) {
    if (!editingPerson) return;
    const response = await fetch(`/api/training/people/${editingPerson.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    await parseJsonResponse(response, 'Failed to update training person');
    toast.success('Training person updated');
    setEditingPerson(null);
    await refreshAfterMutation('person');
  }

  async function saveQualification(form: TrainingQualificationFormData) {
    if (!editingQualification) return;
    const response = await fetch(`/api/training/qualifications/${editingQualification.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    await parseJsonResponse(response, 'Failed to update training qualification');
    toast.success('Training qualification updated');
    setEditingQualification(null);
    await refreshAfterMutation('qualification');
  }

  async function exportRecords() {
    setExporting(true);
    try {
      const response = await fetch('/api/reports/training/export?status=active', { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || 'Failed to export training records');
      }
      const blob = await response.blob();
      downloadBlob(blob, `Training_Records_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export training records');
    } finally {
      setExporting(false);
    }
  }

  if (authLoading || permissionLoading) {
    return (
      <AppPageLoadingShell
        title="Training"
        description="Imported client training records with expiry tracking, source traceability, and manual admin updates."
        icon={<GraduationCap className="h-6 w-6" />}
        message="Checking training access..."
        accent="brand"
        width="full"
      />
    );
  }

  if (!hasPermission || !user?.id) {
    return (
      <AppPageLoadingShell
        title="Training"
        description="Imported client training records with expiry tracking, source traceability, and manual admin updates."
        icon={<GraduationCap className="h-6 w-6" />}
        message="Redirecting..."
        accent="brand"
        width="full"
      />
    );
  }

  const summaryBlocking = collections.summary.data === null && collections.summary.status !== 'error';
  if (summaryBlocking) {
    return (
      <AppPageShell width="full">
        <AppPageHeader
          title="Training"
          description="Imported client training records with expiry tracking, source traceability, and manual admin updates."
          icon={<GraduationCap className="h-6 w-6" />}
        />
        <PanelLoader message="Loading training..." accent="brand" className="py-20" />
      </AppPageShell>
    );
  }

  const summary = collections.summary.data;

  return (
    <AppPageShell width="full">
      <AppPageHeader
        title="Training"
        description="Imported client training records with expiry tracking, source traceability, and manual admin updates."
        icon={<GraduationCap className="h-6 w-6" />}
        actions={
          <>
            {refreshing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Refreshing
              </div>
            ) : null}
            <Button variant="outline" onClick={() => void refreshVisible()} disabled={refreshing}>
              Refresh
            </Button>
            <Button variant="outline" onClick={exportRecords} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export XLSX
            </Button>
            <Button className="bg-avs-yellow text-slate-950 hover:bg-avs-yellow/90" onClick={() => setCreatingRecord(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Record
            </Button>
          </>
        }
      />

      <TrainingDevelopmentBanner />

      {collections.summary.status === 'error' && !summary ? (
        <CollectionFallback collection="summary" error={collections.summary.error} onRetry={() => retryCollection('summary')} />
      ) : null}
      {summary ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Active Records" value={summary.activeRecords} description={`${summary.totalRecords} total imported/manual records`} />
          <SummaryCard label="Expired" value={summary.expiredRecords} description="Active records with expiry before today" />
          <SummaryCard label="Expiring Soon" value={summary.expiringSoonRecords} description="Active records expiring in the next 90 days" />
          <SummaryCard label="Needs Review" value={summary.manualReviewRecords + summary.unlinkedPeople} description="Manual qualification reviews plus unlinked people" />
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as TrainingTab)}>
        <TabsList className="h-auto flex-wrap p-1.5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
          <TabsTrigger value="notes">Workbook Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Priority Training Records</CardTitle>
                <CardDescription>Expired, expiring, missing expiry, and CPCS action-status records.</CardDescription>
              </CardHeader>
              <CardContent>
                {collections.records.data === null ? (
                  <CollectionFallback collection="records" error={collections.records.error} onRetry={() => retryCollection('records')} />
                ) : priorityTrainingRecords.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No training records found.</p>
                ) : (
                  <div className="space-y-3">
                    {priorityTrainingRecords.map((record) => (
                      <div key={record.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-medium">{record.employee_name_raw || 'Unknown person'}</div>
                          <div className="text-sm text-muted-foreground">{record.qualification_canonical_proposed}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className={expiryBadgeClass(getExpiryStatus(record))}>
                            {getExpiryStatus(record) === 'none' ? 'No expiry' : formatDate(record.expiry_date)}
                          </Badge>
                          {record.cpcs_statuses.map((status) => (
                            <Badge key={status} variant="outline">{formatStatusLabel(status)}</Badge>
                          ))}
                        </div>
                      </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Import Health</CardTitle>
                <CardDescription>Useful cleanup buckets before Phase 2 automation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span>No expiry</span><strong>{summary?.noExpiryRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Needs NVQ</span><strong>{summary?.needsNvqRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Awaiting card</span><strong>{summary?.awaitingCardRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Training booked</span><strong>{summary?.trainingBookedRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Unlinked people</span><strong>{summary?.unlinkedPeople || 0}</strong></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="records" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Training Records</CardTitle>
              <CardDescription>Search, filter, edit, archive, and export imported records.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {collections.records.data === null ? (
                <CollectionFallback collection="records" error={collections.records.error} onRetry={() => retryCollection('records')} />
              ) : (
              <>
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search employee, qualification, card, sheet, comments..." value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} />
                </div>
                <Select value={recordFilter} onValueChange={(value) => setRecordFilter(value as RecordFilter)}>
                  <SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECORD_FILTERS.map((filter) => (
                      <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Qualification</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>CPCS / Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordPagination.visibleItems.map((record) => {
                      const expiryStatus = getExpiryStatus(record);
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            <div className="font-medium">{record.employee_name_raw || 'Unknown'}</div>
                            <div className="text-xs text-muted-foreground">{record.person?.profile_match_status ? formatStatusLabel(record.person.profile_match_status) : 'No person link'}</div>
                          </TableCell>
                          <TableCell className="max-w-md">
                            <div className="font-medium">{record.qualification_canonical_proposed}</div>
                            <div className="truncate text-xs text-muted-foreground">{record.qualification_raw}</div>
                            {record.qualification_validation_status === 'needs_manual_review' ? (
                              <Badge variant="outline" className="mt-1 border-amber-500/30 bg-amber-500/10 text-amber-300">Needs review</Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={expiryBadgeClass(expiryStatus)}>
                              {expiryStatus === 'none' ? 'No expiry' : formatDate(record.expiry_date)}
                            </Badge>
                            {record.expiry_raw && record.expiry_raw !== record.expiry_date ? (
                              <div className="mt-1 text-xs text-muted-foreground">Raw: {record.expiry_raw}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {record.record_status === 'archived' ? <Badge variant="outline">Archived</Badge> : null}
                              {record.cpcs_statuses.length > 0 ? record.cpcs_statuses.map((status) => (
                                <Badge key={status} variant="outline">{formatStatusLabel(status)}</Badge>
                              )) : <span className="text-xs text-muted-foreground">-</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>{record.source_sheet}</div>
                            <div className="text-xs text-muted-foreground">Row {record.source_row}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => setEditingRecord(record)}>
                                <Edit className="mr-1.5 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              {record.record_status === 'active' ? (
                                <Button variant="outline" size="sm" onClick={() => archiveRecord(record)} disabled={archivingRecordId === record.id}>
                                  {archivingRecordId === record.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" />}
                                  Archive
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={recordPagination.visibleItems.length} totalCount={filteredRecords.length} itemLabel="records" onShowMore={recordPagination.showMore} />
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="people" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Training People</CardTitle>
              <CardDescription>Imported people with best-effort profile matches for future module links.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {collections.people.data === null ? (
                <CollectionFallback collection="people" error={collections.people.error} onRetry={() => retryCollection('people')} />
              ) : (
              <>
              <Input placeholder="Search people..." value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Profile</TableHead>
                      <TableHead>Source Sheets</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {peoplePagination.visibleItems.map((person) => (
                      <TableRow key={person.id}>
                        <TableCell>
                          <div className="font-medium">{person.employee_name_raw}</div>
                          <div className="text-xs text-muted-foreground">{person.employee_key}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{formatStatusLabel(person.profile_match_status)}</Badge>
                          <div className="mt-1 text-xs text-muted-foreground">{person.profile?.full_name || person.profile_match_notes || 'No linked profile'}</div>
                        </TableCell>
                        <TableCell className="max-w-sm truncate">{person.source_sheets.join(', ')}</TableCell>
                        <TableCell>{person.record_count}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setEditingPerson(person)}>
                            <Edit className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={peoplePagination.visibleItems.length} totalCount={filteredPeople.length} itemLabel="people" onShowMore={peoplePagination.showMore} />
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qualifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Qualification Catalogue</CardTitle>
              <CardDescription>Raw qualification strings with proposed canonical names awaiting client review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {collections.qualifications.data === null ? (
                <CollectionFallback collection="qualifications" error={collections.qualifications.error} onRetry={() => retryCollection('qualifications')} />
              ) : (
              <>
              <div className="flex flex-col gap-3 md:flex-row">
                <Input placeholder="Search qualifications..." value={qualificationSearch} onChange={(event) => setQualificationSearch(event.target.value)} />
                <Select value={qualificationStatus} onValueChange={setQualificationStatus}>
                  <SelectTrigger className="md:w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {TRAINING_VALIDATION_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Raw</TableHead>
                      <TableHead>Canonical Proposed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qualificationPagination.visibleItems.map((qualification) => (
                      <TableRow key={qualification.id}>
                        <TableCell className="max-w-lg truncate">{qualification.qualification_raw}</TableCell>
                        <TableCell className="max-w-lg truncate">{qualification.canonical_name}</TableCell>
                        <TableCell><Badge variant="outline">{formatStatusLabel(qualification.validation_status)}</Badge></TableCell>
                        <TableCell>{qualification.record_count}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setEditingQualification(qualification)}>
                            <Edit className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={qualificationPagination.visibleItems.length} totalCount={filteredQualifications.length} itemLabel="qualifications" onShowMore={qualificationPagination.showMore} />
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workbook Notes</CardTitle>
              <CardDescription>Preserved free text that was intentionally not mixed into training records.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {collections.notes.data === null ? (
                <CollectionFallback collection="notes" error={collections.notes.error} onRetry={() => retryCollection('notes')} />
              ) : (
              <>
              <Input placeholder="Search notes..." value={notesSearch} onChange={(event) => setNotesSearch(event.target.value)} />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Sheet / Cell</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notesPagination.visibleItems.map((note) => (
                      <TableRow key={note.id}>
                        <TableCell><Badge variant="outline">{formatStatusLabel(note.note_type)}</Badge></TableCell>
                        <TableCell>
                          <div>{note.source_sheet}</div>
                          <div className="text-xs text-muted-foreground">{note.cell_address}</div>
                        </TableCell>
                        <TableCell className="max-w-xl">{note.note_value}</TableCell>
                        <TableCell className="max-w-xl text-sm text-muted-foreground">{note.reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={notesPagination.visibleItems.length} totalCount={filteredNotes.length} itemLabel="notes" onShowMore={notesPagination.showMore} />
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TrainingRecordDialog
        open={Boolean(editingRecord) || creatingRecord}
        record={editingRecord}
        onClose={() => { setEditingRecord(null); setCreatingRecord(false); }}
        onSubmit={saveRecord}
      />
      <TrainingPersonDialog
        open={Boolean(editingPerson)}
        person={editingPerson}
        onClose={() => setEditingPerson(null)}
        onSubmit={savePerson}
      />
      <TrainingQualificationDialog
        open={Boolean(editingQualification)}
        qualification={editingQualification}
        onClose={() => setEditingQualification(null)}
        onSubmit={saveQualification}
      />
    </AppPageShell>
  );
}

export default function TrainingPage() {
  return (
    <Suspense
      fallback={(
        <AppPageLoadingShell
          title="Training"
          description="Imported client training records with expiry tracking, source traceability, and manual admin updates."
          icon={<GraduationCap className="h-6 w-6" />}
          message="Loading training..."
          accent="brand"
          width="full"
        />
      )}
    >
      <TrainingContent />
    </Suspense>
  );
}
