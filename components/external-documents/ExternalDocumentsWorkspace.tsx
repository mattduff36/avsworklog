'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ZodError } from 'zod';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { DocumentEditor, emptyExternalDocumentDraft, type ExternalDocumentDraft } from '@/components/external-documents/DocumentEditor';
import { PDFCanvasRenderer } from '@/components/pdf/PDFCanvasRenderer';
import { ModuleBetaBadge } from '@/components/ui/module-beta-badge';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
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

  return (
    <AppPageShell>
      {banner}
      <AppPageHeader
        title="External Documents"
        titleMeta={betaBadge}
        icon={<FileText className="h-5 w-5" />}
        description={accessLevel < 1
          ? 'Level 0 has no External Documents access, so nothing is requested or shown.'
          : 'Service records, reports and other documents from external companies.'}
        actions={canManage ? (
          <Button type="button" className="h-11 bg-external-documents text-white hover:bg-external-documents-dark md:h-9" onClick={() => { setCreateError(null); setCreateOpen(true); }}>
            Add document
          </Button>
        ) : null}
      />

      {accessLevel < 1 ? null : (
        <section className="space-y-4 rounded-lg border border-border bg-slate-900 p-4 sm:p-6" aria-busy={listLoading} aria-labelledby="external-documents-library">
          <h2 id="external-documents-library" className="text-lg font-semibold">Library</h2>
          {accessLevel < 4 ? <p className="text-sm text-muted-foreground">You can open active documents that have been shared with you.</p> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2 md:col-span-2 xl:col-span-1">
              <Label htmlFor="external-documents-search">Search</Label>
              <SearchInput id="external-documents-search" value={searchInput} placeholder="Title, company, reference, or notes" onChange={(event) => setSearchInput(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="external-documents-category">Category</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as ExternalDocumentCategory | 'all')}>
                <SelectTrigger id="external-documents-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {EXTERNAL_DOCUMENT_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {canManage ? (
              <div className="space-y-2">
                <Label htmlFor="external-documents-archive">Archive</Label>
                <Select value={archive} onValueChange={(value) => setArchive(value as ExternalDocumentArchiveFilter)}>
                  <SelectTrigger id="external-documents-archive"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                    <SelectItem value="all">Active and archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {canManage ? (
              <div className="space-y-2">
                <Label htmlFor="external-documents-asset">Asset</Label>
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
                  <SelectTrigger id="external-documents-asset"><SelectValue placeholder="All assets" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All assets</SelectItem>
                    {assetKey && !assetChoices.some((choice) => choice.value === assetKey) ? <SelectItem value={assetKey}>Linked asset</SelectItem> : null}
                    {assetChoices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : assetFilter ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Linked asset</p>
                <Button type="button" variant="outline" onClick={() => onAssetFilterChange?.(null)}>Clear asset filter</Button>
              </div>
            ) : null}
          </div>

          {assetLinkError ? <p className="text-sm text-destructive" role="alert">{assetLinkError}</p> : null}
          {listError ? (
            <div className="space-y-2" role="alert">
              <p className="text-sm text-destructive">{listError}</p>
              <Button type="button" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>Try again</Button>
            </div>
          ) : null}
          {listLoading ? <p className="text-sm text-muted-foreground" role="status">Loading documents…</p> : null}
          {!listLoading && !listError && !assetLinkError && list && list.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents match these filters.</p>
          ) : null}

          {list && list.documents.length > 0 ? (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Document date</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.documents.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell className="font-medium">{document.title}</TableCell>
                        <TableCell>{document.category}</TableCell>
                        <TableCell>{document.external_company}</TableCell>
                        <TableCell>{document.document_date}</TableCell>
                        <TableCell>{assetLabel(document, options)}</TableCell>
                        <TableCell>{document.is_archived ? <Badge variant="outline">Archived</Badge> : <Badge variant="outline">Active</Badge>}</TableCell>
                        <TableCell><Button type="button" variant="outline" size="sm" onClick={() => openDocument(document.id)}>View</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="space-y-3 md:hidden">
                {list.documents.map((document) => (
                  <li key={document.id} className="space-y-2 rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{document.title}</p>
                      <Badge variant="outline">{document.is_archived ? 'Archived' : 'Active'}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{document.category} · {document.external_company}</p>
                    <p className="text-sm text-muted-foreground">{document.document_date} · {assetLabel(document, options)}</p>
                    <Button type="button" variant="outline" className="h-11" onClick={() => openDocument(document.id)}>View</Button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Showing {rangeStart}–{rangeEnd} of {list.total}</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous page</Button>
                  <Button type="button" variant="outline" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next page</Button>
                </div>
              </div>
            </>
          ) : null}
        </section>
      )}

      <Dialog open={canManage && createOpen} onOpenChange={(open) => { if (!saving) setCreateOpen(open); }}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto" mobileKeyboardSafe>
          <DialogHeader>
            <DialogTitle>Add document</DialogTitle>
            <DialogDescription>Combine the files into one PDF and save the details with it.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveCreate}>
            <DocumentEditor mode="create" draft={createDraft} onDraftChange={setCreateDraft} options={options} optionsLoading={optionsLoading} optionsError={optionsError} canManageSharing={canManage} disabled={saving} formError={createError} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-external-documents text-white hover:bg-external-documents-dark" disabled={saving}>{saving ? 'Saving…' : 'Save document'}</Button>
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
          {detailLoading ? <p className="text-sm text-muted-foreground" role="status">Loading the document…</p> : null}
          {detailError ? <p className="text-sm text-destructive" role="alert">{detailError}</p> : null}
          {detail && fileUrl ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><a href={fileUrl} download={detail.file_name}>Download PDF</a></Button>
                {canManage ? <Button type="button" variant="outline" onClick={() => { setEditError(null); setEditDraft(draftFromDocument(detail)); }}>Edit details</Button> : null}
                {canManage ? <Button type="button" variant="outline" onClick={() => setArchiveIntent(detail)}>{detail.is_archived ? 'Restore' : 'Archive'}</Button> : null}
              </div>
              <PDFCanvasRenderer url={fileUrl} />
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Category</dt><dd>{detail.category}</dd></div>
                <div><dt className="text-muted-foreground">External company</dt><dd>{detail.external_company}</dd></div>
                <div><dt className="text-muted-foreground">Document date</dt><dd>{detail.document_date}</dd></div>
                <div><dt className="text-muted-foreground">Expiry</dt><dd>{detail.expiry_date ?? 'None'}</dd></div>
                <div><dt className="text-muted-foreground">Reference</dt><dd>{detail.reference ?? 'None'}</dd></div>
                <div><dt className="text-muted-foreground">Asset</dt><dd>{assetLabel(detail, options)}</dd></div>
                <div><dt className="text-muted-foreground">Pages</dt><dd>{detail.page_count}</dd></div>
                <div><dt className="text-muted-foreground">Status</dt><dd>{detail.is_archived ? 'Archived' : 'Active'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{detail.notes ?? 'None'}</dd></div>
                {canManage ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Shared with</dt><dd>{detail.shared_with.length === 0 ? 'Nobody' : `${detail.shared_with.length} people`}</dd></div> : null}
              </dl>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={canManage && Boolean(editDraft)} onOpenChange={(open) => { if (!open && !saving) setEditDraft(null); }}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto" mobileKeyboardSafe>
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>Update the details, asset link, or who can read this document.</DialogDescription>
          </DialogHeader>
          {editDraft ? (
            <form className="space-y-4" onSubmit={saveEdit}>
              <DocumentEditor mode="edit" draft={editDraft} onDraftChange={setEditDraft} options={options} optionsLoading={optionsLoading} optionsError={optionsError} canManageSharing={canManage} disabled={saving} formError={editError} />
              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setEditDraft(null)}>Cancel</Button>
                <Button type="submit" className="bg-external-documents text-white hover:bg-external-documents-dark" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
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
