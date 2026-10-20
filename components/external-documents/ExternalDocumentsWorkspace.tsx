'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ZodError } from 'zod';
import { AlertCircle, FileText, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { DocumentEditor, emptyExternalDocumentDraft, type ExternalDocumentDraft } from '@/components/external-documents/DocumentEditor';
import { PDFCanvasRenderer } from '@/components/pdf/PDFCanvasRenderer';
import { ModuleBetaBadge } from '@/components/ui/module-beta-badge';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollArea, DialogTitle, dialogContentViewportClassName } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalDocumentsClientError, isExternalDocumentId, type ExternalDocumentsAdapter, type ExternalDocumentsAssetFilter } from '@/lib/client/external-documents';
import { ExternalDocumentPdfError, combineExternalDocumentSources, readExternalDocumentSource } from '@/lib/external-documents/pdf';
import { parseExternalDocumentMetadata, parseExternalDocumentPatch } from '@/lib/external-documents/validation';
import {
  EXTERNAL_DOCUMENT_CATEGORIES,
  EXTERNAL_DOCUMENT_LIMITS,
  type ExternalDocument,
  type ExternalDocumentArchiveFilter,
  type ExternalDocumentCategory,
  type ExternalDocumentListResponse,
  type ExternalDocumentOptionsResponse,
} from '@/types/external-documents';

const betaBadge = <ModuleBetaBadge accent="external-documents" />;
const primaryAction = 'h-11 bg-external-documents text-white hover:bg-external-documents-dark md:h-9';

function formatDocumentDate(value: string): string {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

function documentMeta(document: ExternalDocument): string {
  return [document.reference, document.category, document.external_company].filter(Boolean).join(' · ');
}

function DocumentStatus({ archived }: { archived: boolean }) {
  return (
    <Badge
      variant="outline"
      className={archived
        ? 'border-slate-600 bg-slate-800 text-slate-300'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}
    >
      {archived ? 'Archived' : 'Active'}
    </Badge>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ExternalDocumentsClientError || error instanceof ExternalDocumentPdfError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? 'The document details are not valid.';
  if (error instanceof Error) return error.message;
  return 'Something went wrong while handling the document.';
}

function assetLabel(document: ExternalDocument, options: ExternalDocumentOptionsResponse | null): string {
  if (document.van_id) return options?.assets.vans.find((asset) => asset.id === document.van_id)?.label ?? 'Linked van';
  if (document.plant_id) return options?.assets.plant.find((asset) => asset.id === document.plant_id)?.label ?? 'Linked plant';
  if (document.hgv_id) return options?.assets.hgvs.find((asset) => asset.id === document.hgv_id)?.label ?? 'Linked HGV';
  return 'Not linked';
}

function draftFromDocument(document: ExternalDocument): ExternalDocumentDraft {
  const asset_type = document.van_id ? 'van' : document.plant_id ? 'plant' : document.hgv_id ? 'hgv' : '';
  const asset_id = document.van_id ?? document.plant_id ?? document.hgv_id ?? '';
  return {
    ...emptyExternalDocumentDraft(),
    title: document.title,
    category: document.category,
    external_company: document.external_company,
    document_date: document.document_date,
    expiry_date: document.expiry_date ?? '',
    reference: document.reference ?? '',
    notes: document.notes ?? '',
    asset_type,
    asset_id,
    shared_with: document.shared_with,
    files: [],
  };
}

function metadataFromDraft(draft: ExternalDocumentDraft, includeFiles: boolean) {
  return {
    title: draft.title,
    category: draft.category,
    external_company: draft.external_company,
    document_date: draft.document_date,
    expiry_date: draft.expiry_date || null,
    reference: draft.reference.trim() || null,
    notes: draft.notes.trim() || null,
    van_id: draft.asset_type === 'van' ? draft.asset_id : null,
    plant_id: draft.asset_type === 'plant' ? draft.asset_id : null,
    hgv_id: draft.asset_type === 'hgv' ? draft.asset_id : null,
    shared_with: draft.shared_with,
    ...(includeFiles ? { source_files: draft.files.map((item) => item.file.name) } : {}),
  };
}

export function ExternalDocumentsWorkspace({
  adapter,
  accessLevel,
  currentUserId,
  assetFilter = null,
  onAssetFilterChange,
  assetLinkError = null,
  documentId = null,
  onDocumentIdChange,
  banner,
}: {
  adapter: ExternalDocumentsAdapter;
  accessLevel: number;
  currentUserId: string;
  assetFilter?: ExternalDocumentsAssetFilter;
  onAssetFilterChange?: (filter: ExternalDocumentsAssetFilter) => void;
  assetLinkError?: string | null;
  documentId?: string | null;
  onDocumentIdChange?: (id: string | null) => void;
  banner?: ReactNode;
}) {
  const canManage = accessLevel >= 4;
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ExternalDocumentCategory | 'all'>('all');
  const [archive, setArchive] = useState<ExternalDocumentArchiveFilter>('active');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ExternalDocumentListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [options, setOptions] = useState<ExternalDocumentOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [detail, setDetail] = useState<ExternalDocument | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyExternalDocumentDraft);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ExternalDocumentDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveIntent, setArchiveIntent] = useState<ExternalDocument | null>(null);
  const blobUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = blobUrls.current;
    return () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);
  const activeArchive = canManage ? archive : 'active';
  const assetKey = assetFilter ? `${assetFilter.asset_type}:${assetFilter.asset_id}` : '';

  const query = useMemo(() => ({
    q: search || null,
    category: category === 'all' ? null : category,
    asset_type: assetFilter?.asset_type ?? null,
    asset_id: assetFilter?.asset_id ?? null,
    archive: activeArchive,
    page,
    page_size: EXTERNAL_DOCUMENT_LIMITS.defaultPageSize,
  }), [search, category, assetFilter, activeArchive, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim().slice(0, 80)), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, category, activeArchive, assetKey]);

  useEffect(() => {
    blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.current.clear();
    setFileUrl(null);
    setDetail(null);
    setDetailError(null);
    setList(null);
    setListError(null);
  }, [accessLevel, currentUserId]);

  useEffect(() => {
    if (accessLevel < 1 || assetLinkError) {
      setListLoading(false);
      return undefined;
    }
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    adapter.list(query)
      .then((response) => {
        if (!cancelled) setList(response);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setList(null);
          setListError(errorText(error));
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, accessLevel, currentUserId, assetLinkError, query, reloadKey]);

  useEffect(() => {
    if (!canManage) return undefined;
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    adapter.options()
      .then((response) => {
        if (!cancelled) setOptions(response);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOptions(null);
          setOptionsError(errorText(error));
        }
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, canManage, currentUserId, accessLevel]);

  useEffect(() => {
    blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.current.clear();
    if (accessLevel < 1 || !documentId) {
      setDetail(null);
      setFileUrl(null);
      setDetailError(null);
      setDetailLoading(false);
      return undefined;
    }
    if (!isExternalDocumentId(documentId)) {
      setDetail(null);
      setFileUrl(null);
      setDetailError('Use a valid document id.');
      setDetailLoading(false);
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setFileUrl(null);
    void (async () => {
      try {
        const document = await adapter.get(documentId);
        if (cancelled) return;
        const file = await adapter.file(document.id);
        if (cancelled) {
          if (file.url.startsWith('blob:')) URL.revokeObjectURL(file.url);
          return;
        }
        if (file.url.startsWith('blob:')) blobUrls.current.add(file.url);
        setDetail(document);
        setFileUrl(file.url);
      } catch (error) {
        if (!cancelled) {
          setDetail(null);
          setFileUrl(null);
          setDetailError(errorText(error));
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, accessLevel, currentUserId, documentId, reloadKey]);

  async function saveCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setCreateError(null);
    try {
      const metadata = parseExternalDocumentMetadata(metadataFromDraft(createDraft, true));
      if (createDraft.files.reduce((total, item) => total + item.file.size, 0) > EXTERNAL_DOCUMENT_LIMITS.maxCombinedInputBytes) {
        throw new ExternalDocumentPdfError('Those files are over the 20 MB combined limit.');
      }
      const sources = [];
      for (const item of createDraft.files) sources.push(await readExternalDocumentSource(item.file));
      const combined = await combineExternalDocumentSources(sources);
      const saved = await adapter.create({
        metadata,
        file: new Blob([new Uint8Array(combined.bytes)], { type: 'application/pdf' }),
        fileName: combined.fileName,
      });
      setCreateDraft(emptyExternalDocumentDraft());
      setCreateOpen(false);
      setReloadKey((value) => value + 1);
      toast.success('Document saved.');
      onDocumentIdChange?.(saved.id);
    } catch (error) {
      setCreateError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !editDraft) return;
    setSaving(true);
    setEditError(null);
    try {
      const patch = parseExternalDocumentPatch(metadataFromDraft(editDraft, false));
      const saved = await adapter.update(detail.id, patch);
      setDetail(saved);
      setEditDraft(null);
      setReloadKey((value) => value + 1);
      toast.success('Document updated.');
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmArchive() {
    if (!archiveIntent) return;
    setSaving(true);
    try {
      const saved = await adapter.update(archiveIntent.id, { is_archived: !archiveIntent.is_archived });
      if (detail?.id === saved.id) setDetail(saved);
      setArchiveIntent(null);
      setReloadKey((value) => value + 1);
      toast.success(saved.is_archived ? 'Document archived.' : 'Document restored.');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  const assetChoices = options
    ? [
        ...options.assets.vans.map((asset) => ({ value: `van:${asset.id}`, label: `Van · ${asset.label}` })),
        ...options.assets.plant.map((asset) => ({ value: `plant:${asset.id}`, label: `Plant · ${asset.label}` })),
        ...options.assets.hgvs.map((asset) => ({ value: `hgv:${asset.id}`, label: `HGV · ${asset.label}` })),
      ]
    : [];
  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.page_size)) : 1;
  const rangeStart = list && list.total > 0 ? (list.page - 1) * list.page_size + 1 : 0;
  const rangeEnd = list ? Math.min(list.total, list.page * list.page_size) : 0;

  function openDocument(id: string) {
    onDocumentIdChange?.(id);
  }

  const filtersActive = Boolean(searchInput.trim() || category !== 'all' || (canManage && archive !== 'active') || assetFilter);
  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setCategory('all');
    setArchive('active');
    setPage(1);
    if (assetFilter || assetLinkError) onAssetFilterChange?.(null);
  }

  return (
    <AppPageShell>
      {banner}
      <AppPageHeader
        title="External Documents"
        titleMeta={betaBadge}
        description={accessLevel < 1
          ? 'Level 0 has no External Documents access, so nothing is requested or shown.'
          : 'Service records, reports and other documents from external companies.'}
        actions={canManage ? (
          <Button type="button" className={primaryAction} onClick={() => { setCreateError(null); setCreateOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />Add document
          </Button>
        ) : null}
      />

      {accessLevel < 1 ? null : (
        <Card className="overflow-hidden border-border">
          <CardContent className="p-0">
            <div className="space-y-3 border-b border-border p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-3">
                <SearchInput id="external-documents-search" aria-label="Search documents" value={searchInput} placeholder="Title, company, reference, or notes" onChange={(event) => setSearchInput(event.target.value)} containerClassName="min-w-48 flex-1" />
                <Select value={category} onValueChange={(value) => setCategory(value as ExternalDocumentCategory | 'all')}>
                  <SelectTrigger id="external-documents-category" aria-label="Category" className="h-11 w-full sm:w-52 md:h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {EXTERNAL_DOCUMENT_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
                {canManage ? (
                  <Select value={archive} onValueChange={(value) => setArchive(value as ExternalDocumentArchiveFilter)}>
                    <SelectTrigger id="external-documents-archive" aria-label="Archive" className="h-11 w-full sm:w-48 md:h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                      <SelectItem value="all">Active and archived</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                {canManage ? (
                  <Select
                    value={assetChoices.some((choice) => choice.value === assetKey) || !assetKey ? (assetKey || 'all') : assetKey}
                    onValueChange={(value) => {
                      if (!onAssetFilterChange) return;
                      if (value === 'all') onAssetFilterChange(null);
                      else {
                        const [asset_type, asset_id] = value.split(':') as ['van' | 'plant' | 'hgv', string];
                        onAssetFilterChange({ asset_type, asset_id });
                      }
                    }}
                  >
                    <SelectTrigger id="external-documents-asset" aria-label="Linked asset" className="h-11 w-full sm:w-56 md:h-10"><SelectValue placeholder="All assets" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All assets</SelectItem>
                      {assetKey && !assetChoices.some((choice) => choice.value === assetKey) ? <SelectItem value={assetKey}>Linked asset</SelectItem> : null}
                      {assetChoices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : null}
                <Button type="button" variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label="Refresh documents" onClick={() => setReloadKey((value) => value + 1)} disabled={listLoading}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex min-h-8 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <p aria-live="polite">
                  {listError ? 'Document library unavailable' : listLoading ? 'Document library' : `${list?.total ?? 0} document${list?.total === 1 ? '' : 's'}${filtersActive ? ' matching filters' : ''}`}
                  {accessLevel < 4 ? ' · Shared with you' : ''}
                </p>
                {filtersActive ? <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button> : null}
              </div>
            </div>

            {listError || assetLinkError ? (
              <div role="alert" className="flex flex-col items-center gap-3 px-5 py-12 text-center">
                <AlertCircle className="h-7 w-7 text-destructive" />
                <h2 className="font-semibold">{listError ? 'Unable to load documents' : 'This asset link is not valid'}</h2>
                <p className="max-w-md text-sm text-muted-foreground">{listError || assetLinkError}</p>
                {listError ? <Button type="button" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>Try again</Button> : null}
                {assetLinkError ? <Button type="button" variant="outline" onClick={clearFilters}>Clear filters</Button> : null}
              </div>
            ) : listLoading ? <PanelLoader message="Loading documents…" accent="external-documents" className="py-16" />
              : !list || list.documents.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
                  <div className="rounded-full bg-slate-800 p-3"><FileText className="h-6 w-6 text-muted-foreground" /></div>
                  <h2 className="font-semibold">{filtersActive ? 'No matching documents' : canManage ? 'Your document library is empty' : 'No shared documents yet'}</h2>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {filtersActive
                      ? 'Try a different title, company, reference or filter, or clear your filters.'
                      : canManage
                        ? 'Add the first external document. You can combine files into one PDF before saving.'
                        : 'Documents shared with you will appear here.'}
                  </p>
                  {filtersActive ? <Button type="button" variant="outline" onClick={clearFilters}>Clear filters</Button> : canManage ? <Button type="button" className={primaryAction} onClick={() => { setCreateError(null); setCreateOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add document</Button> : null}
                </div>
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table aria-label="External documents">
                      <TableHeader className="bg-slate-800/40">
                        <TableRow>
                          <TableHead className="w-[46%] pl-5">Document</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Asset</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="pr-5 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.documents.map((document) => (
                          <TableRow key={document.id}>
                            <TableCell className="py-4 pl-5">
                              <p className="break-words font-medium text-foreground">{document.title}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{documentMeta(document)}</p>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDocumentDate(document.document_date)}
                              {document.expiry_date ? <p className="mt-1 text-xs text-muted-foreground">Expires {formatDocumentDate(document.expiry_date)}</p> : null}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{assetLabel(document, options)}</TableCell>
                            <TableCell><DocumentStatus archived={document.is_archived} /></TableCell>
                            <TableCell className="pr-5 text-right">
                              <Button type="button" variant="outline" size="sm" className="h-11 md:h-8" aria-label={`View ${document.title}`} onClick={() => openDocument(document.id)}>View</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <ul className="divide-y divide-border md:hidden" aria-label="External documents">
                    {list.documents.map((document) => (
                      <li key={document.id} className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 break-words text-xs font-medium text-muted-foreground">{document.reference || document.category}</p>
                          <DocumentStatus archived={document.is_archived} />
                        </div>
                        <h2 className="break-words text-base font-semibold">{document.title}</h2>
                        <p className="text-sm text-muted-foreground">{document.external_company}</p>
                        <div className="flex flex-wrap items-end justify-between gap-3">
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>{formatDocumentDate(document.document_date)}{document.expiry_date ? ` · Expires ${formatDocumentDate(document.expiry_date)}` : ''}</p>
                            <p>{assetLabel(document, options)}</p>
                          </div>
                          <Button type="button" variant="outline" className="h-11" aria-label={`View ${document.title}`} onClick={() => openDocument(document.id)}>View</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
                    <p className="text-xs text-muted-foreground">Showing {rangeStart}–{rangeEnd} of {list.total}</p>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" className="h-11 md:h-9" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous page</Button>
                      <Button type="button" variant="outline" className="h-11 md:h-9" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next page</Button>
                    </div>
                  </div>
                </>
              )}
          </CardContent>
        </Card>
      )}

      <Dialog open={canManage && createOpen} onOpenChange={(open) => { if (!saving) setCreateOpen(open); }}>
        <DialogContent data-accent="external-documents" className={dialogContentViewportClassName({ size: '5xl', scroll: 'content', className: 'gap-3 border-border p-4 text-white md:p-5 max-md:[&_button]:!text-[14px]' })} mobileKeyboardSafe>
          <DialogHeader className="shrink-0 space-y-1">
            <DialogTitle className="max-md:!text-[18px]">Add document</DialogTitle>
            <DialogDescription className="max-md:!text-[12px]">Combine files into one PDF.</DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={saveCreate}>
            <DialogScrollArea className="pr-1">
              <DocumentEditor mode="create" draft={createDraft} onDraftChange={setCreateDraft} options={options} optionsLoading={optionsLoading} optionsError={optionsError} canManageSharing={canManage} disabled={saving} formError={createError} />
            </DialogScrollArea>
            <DialogFooter className="shrink-0 border-t border-border pt-3">
              <Button type="button" variant="outline" className="h-[44px] md:h-9" disabled={saving} onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" className="h-[44px] bg-external-documents text-white hover:bg-external-documents-dark md:h-9" disabled={saving}>{saving ? 'Saving…' : 'Save document'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={accessLevel > 0 && Boolean(documentId)} onOpenChange={(open) => { if (!open) onDocumentIdChange?.(null); }}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.title ?? 'Document'}</DialogTitle>
            <DialogDescription>View the saved document or download a copy.</DialogDescription>
          </DialogHeader>
          {detailLoading ? <PanelLoader message="Loading the document…" accent="external-documents" className="py-10" /> : null}
          {detailError ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-2 py-8 text-center">
              <AlertCircle className="h-7 w-7 text-destructive" />
              <p className="max-w-md text-sm text-muted-foreground">{detailError}</p>
            </div>
          ) : null}
          {detail && fileUrl ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" className="h-11 md:h-9"><a href={fileUrl} download={detail.file_name}>Download PDF</a></Button>
                {canManage ? <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => { setEditError(null); setEditDraft(draftFromDocument(detail)); }}>Edit details</Button> : null}
                {canManage ? <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => setArchiveIntent(detail)}>{detail.is_archived ? 'Restore' : 'Archive'}</Button> : null}
              </div>
              <PDFCanvasRenderer url={fileUrl} />
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Category</dt><dd>{detail.category}</dd></div>
                <div><dt className="text-xs text-muted-foreground">External company</dt><dd>{detail.external_company}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Document date</dt><dd>{formatDocumentDate(detail.document_date)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Expiry</dt><dd>{detail.expiry_date ? formatDocumentDate(detail.expiry_date) : 'None'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Reference</dt><dd>{detail.reference ?? 'None'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Asset</dt><dd>{assetLabel(detail, options)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Pages</dt><dd>{detail.page_count}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Status</dt><dd><DocumentStatus archived={detail.is_archived} /></dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{detail.notes ?? 'None'}</dd></div>
                {canManage ? <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Shared with</dt><dd>{detail.shared_with.length === 0 ? 'Nobody' : `${detail.shared_with.length} people`}</dd></div> : null}
              </dl>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={canManage && Boolean(editDraft)} onOpenChange={(open) => { if (!open && !saving) setEditDraft(null); }}>
        <DialogContent data-accent="external-documents" className={dialogContentViewportClassName({ size: '5xl', scroll: 'content', className: 'gap-3 border-border p-4 text-white md:p-5 max-md:[&_button]:!text-[14px]' })} mobileKeyboardSafe>
          <DialogHeader className="shrink-0 space-y-1">
            <DialogTitle className="max-md:!text-[18px]">Edit document</DialogTitle>
            <DialogDescription className="max-md:!text-[12px]">Update details and access.</DialogDescription>
          </DialogHeader>
          {editDraft ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={saveEdit}>
              <DialogScrollArea className="pr-1">
                <DocumentEditor mode="edit" draft={editDraft} onDraftChange={setEditDraft} options={options} optionsLoading={optionsLoading} optionsError={optionsError} canManageSharing={canManage} disabled={saving} formError={editError} />
              </DialogScrollArea>
              <DialogFooter className="shrink-0 border-t border-border pt-3">
                <Button type="button" variant="outline" className="h-[44px] md:h-9" disabled={saving} onClick={() => setEditDraft(null)}>Cancel</Button>
                <Button type="submit" className="h-[44px] bg-external-documents text-white hover:bg-external-documents-dark md:h-9" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(archiveIntent)} onOpenChange={(open) => { if (!open && !saving) setArchiveIntent(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archiveIntent?.is_archived ? 'Restore this document?' : 'Archive this document?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveIntent?.is_archived
                ? 'Restoring makes it active again. People with access can open it according to their level.'
                : 'Archiving hides it from active lists. It is not deleted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <Button type="button" className="bg-external-documents text-white hover:bg-external-documents-dark" disabled={saving} onClick={() => void confirmArchive()}>
              {archiveIntent?.is_archived ? 'Restore document' : 'Archive document'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageShell>
  );
}
