'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Plus, Download, History, RefreshCw, MoreHorizontal, Archive, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/search-input';
import { PanelLoader } from '@/components/ui/panel-loader';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ModuleBetaBadge } from '@/components/ui/module-beta-badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { POLICY_CATEGORIES, POLICY_MAX_BYTES, policyMetadataSchema, type PolicyAction, type PolicyAdapter, type PolicyMetadata, type PolicyVersion } from '@/lib/policies-procedures/schema';

const emptyForm = (): PolicyMetadata => ({ reference: '', title: '', category: 'Company policies', version_label: '1.0', effective_date: null, review_date: null, notes: '' });
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete the request.';
const primary = 'bg-policies-procedures text-white hover:bg-policies-procedures-dark';

const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

function DocumentStatus({ document }: { document: PolicyVersion }) {
  const label = document.is_archived ? 'Archived' : document.status === 'published' ? 'Published' : 'Draft';
  const tone = document.is_archived ? 'border-slate-600 bg-slate-800 text-slate-300'
    : document.status === 'published' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : 'border-slate-500/50 bg-slate-800 text-slate-200';
  return <Badge variant="outline" className={tone}>{label}</Badge>;
}

export function PoliciesWorkspace({ adapter, accessLevel }: { adapter: PolicyAdapter; accessLevel: number }) {
  const manage = accessLevel >= 4;
  const [documents, setDocuments] = useState<PolicyVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('active');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PolicyMetadata>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [history, setHistory] = useState<PolicyVersion[] | null>(null);
  const [confirmation, setConfirmation] = useState<{ document: PolicyVersion; action: PolicyAction } | null>(null);
  const requestNumber = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    if (accessLevel < 1) { setDocuments([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try { const rows = await adapter.list(); if (request === requestNumber.current) setDocuments(rows); }
    catch (err) { if (request === requestNumber.current) setError(message(err)); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }, [adapter, accessLevel]);
  useEffect(() => {
    const requests = requestNumber;
    void load();
    return () => { requests.current++; };
  }, [load]);
  if (accessLevel < 1) return <AppPageShell><AppPageHeader title="Policies and Procedures" titleMeta={<ModuleBetaBadge accent="policies-procedures" />} description="You do not have access to this module." /></AppPageShell>;

  const visible = documents.filter(doc => {
    if (status === 'archived' ? !doc.is_archived : doc.is_archived) return false;
    if (status === 'draft' && doc.status !== 'draft') return false;
    if (status === 'published' && doc.status !== 'published') return false;
    return (category === 'all' || doc.category === category) && `${doc.reference} ${doc.title}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => a.reference.localeCompare(b.reference, undefined, { numeric: true }));

  function edit(doc?: PolicyVersion) {
    setForm(doc ? { document_id: doc.document_id, expected_version: doc.version, reference: doc.reference, title: doc.title, category: doc.category, version_label: '', effective_date: null, review_date: null, notes: '' } : emptyForm());
    setFile(null); setEditing(true);
  }
  async function save() {
    if (!file) { toast.error('Choose a document.'); return; }
    if (file.size > POLICY_MAX_BYTES) { toast.error('Choose a document up to 4 MB.'); return; }
    const parsed = policyMetadataSchema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setBusy(true);
    try { await adapter.upload(file, parsed.data); setEditing(false); toast.success('Draft uploaded. Review it before publishing.'); await load(); }
    catch (err) { toast.error(message(err)); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!confirmation) return;
    setBusy(true);
    try { await adapter.action(confirmation.document.document_id, confirmation.action); setConfirmation(null); setHistory(null); toast.success('Document updated'); await load(); }
    catch (err) { toast.error(message(err)); }
    finally { setBusy(false); }
  }
  async function openFile(doc: PolicyVersion) {
    setBusy(true);
    try {
      const url = await adapter.file(doc.document_id, doc.id);
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click();
    } catch (err) { toast.error(message(err)); }
    finally { setBusy(false); }
  }
  async function showHistory(doc: PolicyVersion) {
    setBusy(true);
    try { setHistory(await adapter.versions(doc.document_id)); } catch (err) { toast.error(message(err)); }
    finally { setBusy(false); }
  }

  const filtered = Boolean(query || category !== 'all' || status !== 'active');
  const clearFilters = () => { setQuery(''); setCategory('all'); setStatus('active'); };
  const today = new Date().toISOString().slice(0, 10);
  const documentActions = (doc: PolicyVersion) => <div className="flex items-center justify-end gap-2">
    <Button size="sm" variant="outline" className="h-11 md:h-8" disabled={busy} onClick={() => void openFile(doc)} aria-label={`Open ${doc.title}`}>
      <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />Open
    </Button>
    {manage && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" disabled={busy} aria-label={`Actions for ${doc.title}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => void showHistory(doc)}><History className="mr-2 h-4 w-4" />Version history</DropdownMenuItem>
        {!doc.is_archived && <DropdownMenuItem onSelect={() => edit(doc)}><Plus className="mr-2 h-4 w-4" />Upload new version</DropdownMenuItem>}
        {!doc.is_archived && doc.status === 'draft' && <DropdownMenuItem onSelect={() => setConfirmation({ document: doc, action: { action: 'publish', version_id: doc.id, expected_version: doc.version, confirm_complete: true } })}><CheckCircle2 className="mr-2 h-4 w-4" />Publish draft</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setConfirmation({ document: doc, action: { action: 'archive', archived: !doc.is_archived, expected_version: doc.version } })}>
          {doc.is_archived ? <RotateCcw className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}{doc.is_archived ? 'Restore document' : 'Archive document'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
  const reviewDate = (doc: PolicyVersion) => <span className={doc.review_date && doc.review_date < today && !doc.is_archived ? 'text-amber-300' : 'text-muted-foreground'}>
    {doc.review_date ? <>{formatDate(doc.review_date)}{doc.review_date < today && !doc.is_archived && <span className="block text-xs">Review overdue</span>}</> : 'Not scheduled'}
  </span>;

  return <AppPageShell>
    <AppPageHeader
      title="Policies and Procedures"
      titleMeta={<ModuleBetaBadge accent="policies-procedures" />}
      description="Find current company policies, procedures and controlled documents."
      actions={manage ? <Button className={`${primary} h-11 md:h-9`} onClick={() => edit()}><Plus className="mr-2 h-4 w-4" />Upload document</Button> : undefined}
    />
    <Card className="overflow-hidden border-border">
      <CardContent className="p-0">
        <div className="space-y-3 border-b border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput aria-label="Search policies" placeholder="Search title or reference…" value={query} onChange={e => setQuery(e.target.value)} containerClassName="min-w-48 flex-1" />
            <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="Category" className="h-11 w-full sm:w-56 md:h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{POLICY_CATEGORIES.map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select>
            {manage && <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Document status" className="h-11 flex-1 sm:w-40 sm:flex-none md:h-10"><SelectValue /></SelectTrigger><SelectContent>{['active','published','draft','archived'].map(value => <SelectItem key={value} value={value}>{value === 'active' ? 'All active' : value.charAt(0).toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select>}
            <Button variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10" aria-label="Refresh documents" onClick={() => void load()} disabled={loading || busy}><RefreshCw className="h-4 w-4" /></Button>
          </div>
          <div className="flex min-h-8 items-center justify-between gap-3 text-xs text-muted-foreground">
            <p aria-live="polite">{loading ? 'Document library' : error ? 'Document library unavailable' : `${visible.length} document${visible.length === 1 ? '' : 's'}${filtered ? ' matching filters' : ''}`}</p>
            {filtered && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
          </div>
        </div>
        {error ? <div role="alert" className="flex flex-col items-center gap-3 px-5 py-12 text-center"><AlertCircle className="h-7 w-7 text-destructive" /><h2 className="font-semibold">Unable to load documents</h2><p className="max-w-md text-sm text-muted-foreground">{error}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></div>
          : loading ? <PanelLoader message="Loading documents…" accent="policies-procedures" className="py-16" />
          : !visible.length ? <div className="flex flex-col items-center gap-3 px-5 py-14 text-center"><div className="rounded-full bg-slate-800 p-3"><FileText className="h-6 w-6 text-muted-foreground" /></div><h2 className="font-semibold">{filtered ? 'No matching documents' : manage ? 'Your document library is empty' : 'No published documents yet'}</h2><p className="max-w-md text-sm text-muted-foreground">{filtered ? 'Try a different title, reference or category, or clear your filters.' : manage ? 'Upload the first document as a draft, then review it before publishing.' : 'Approved policies and procedures will appear here when they are published.'}</p>{filtered ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : manage ? <Button className={primary} onClick={() => edit()}><Plus className="mr-2 h-4 w-4" />Upload document</Button> : null}</div>
          : <>
            <div className="hidden md:block">
              <Table aria-label="Policies and procedures"><TableHeader className="bg-slate-800/40"><TableRow><TableHead className="w-[45%] pl-5">Document</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Review due</TableHead><TableHead className="pr-5 text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{visible.map(doc => <TableRow key={doc.id}>
                  <TableCell className="py-4 pl-5"><p className="break-words font-medium text-foreground">{doc.title}</p><p className="mt-1 text-xs text-muted-foreground">{doc.reference} · {doc.category}</p></TableCell>
                  <TableCell className="whitespace-nowrap"><span className="font-medium">{doc.version_label}</span><p className="mt-1 text-xs text-muted-foreground">{doc.file_name.split('.').pop()?.toUpperCase()}</p></TableCell>
                  <TableCell><DocumentStatus document={doc} /></TableCell><TableCell className="whitespace-nowrap text-sm">{reviewDate(doc)}</TableCell><TableCell className="pr-5">{documentActions(doc)}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden" aria-label="Policies and procedures">{visible.map(doc => <li key={doc.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-xs font-medium text-muted-foreground">{doc.reference}</p><DocumentStatus document={doc} /></div>
              <h2 className="break-words text-base font-semibold">{doc.title}</h2>
              <p className="text-sm text-muted-foreground">{doc.category}</p>
              <div className="flex flex-wrap items-end justify-between gap-3"><div className="space-y-1 text-xs text-muted-foreground"><p>Version {doc.version_label} · {doc.file_name.split('.').pop()?.toUpperCase()}</p><div>Review: {reviewDate(doc)}</div></div>{documentActions(doc)}</div>
            </li>)}</ul>
          </>}
      </CardContent>
    </Card>

    <Dialog open={editing} onOpenChange={open => { if (!busy) setEditing(open); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{form.document_id ? 'Upload a new version' : 'Upload document'}</DialogTitle><DialogDescription>The original file is retained. Review the draft before publishing it to readers.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div><Label htmlFor="policy-reference">Document reference *</Label><Input id="policy-reference" disabled={Boolean(form.document_id)} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></div>
        <div><Label htmlFor="policy-title">Title *</Label><Input id="policy-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
        <div><Label>Category</Label><Select value={form.category} onValueChange={value => setForm({ ...form, category: value as PolicyMetadata['category'] })}><SelectTrigger aria-label="Upload category"><SelectValue /></SelectTrigger><SelectContent>{POLICY_CATEGORIES.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div><Label htmlFor="policy-version">Revision / version *</Label><Input id="policy-version" value={form.version_label} onChange={e => setForm({ ...form, version_label: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="policy-effective">Effective date</Label><Input id="policy-effective" type="date" value={form.effective_date || ''} onChange={e => setForm({ ...form, effective_date: e.target.value || null })} /></div><div><Label htmlFor="policy-review">Review due</Label><Input id="policy-review" type="date" value={form.review_date || ''} onChange={e => setForm({ ...form, review_date: e.target.value || null })} /></div></div>
        <div><Label htmlFor="policy-notes">Change notes</Label><Textarea id="policy-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        <div><Label htmlFor="policy-file">File * (PDF, Word or Excel; up to 4 MB)</Label><Input id="policy-file" type="file" accept=".pdf,.doc,.docx,.xlsx" onChange={e => setFile(e.target.files?.[0] || null)} /></div>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button className={primary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save draft'}</Button></div>
      </div>
    </DialogContent></Dialog>
    <Dialog open={history !== null} onOpenChange={open => { if (!open) setHistory(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Version history</DialogTitle><DialogDescription>Previous versions are retained for document control.</DialogDescription></DialogHeader>{history?.map(version => <div key={version.id} className="space-y-2 rounded border border-border p-3"><div className="flex justify-between gap-2"><p>Version {version.version_label}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void openFile(version)}>Open</Button></div><DocumentStatus document={version} /><p className="text-sm font-medium">{version.title}</p><p className="text-xs text-muted-foreground">Uploaded {new Date(version.created_at).toLocaleDateString('en-GB')}{version.published_at ? ` · Published ${new Date(version.published_at).toLocaleDateString('en-GB')}` : ''}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{version.notes}</p></div>)}</DialogContent></Dialog>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={open => { if (!open && !busy) setConfirmation(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.action.action === 'publish' ? 'Publish this completed document?' : confirmation?.document.is_archived ? 'Restore this document?' : 'Archive this document?'}</AlertDialogTitle><AlertDialogDescription>{confirmation?.document.title}. {confirmation?.action.action === 'publish' ? 'Confirm the content is complete and approved for company use. It will replace the current reader version; previous versions remain in history.' : 'Archiving removes all versions from readers. Restoring makes the existing published version available again.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction className={primary} disabled={busy} onClick={event => { event.preventDefault(); void apply(); }}>{busy ? 'Saving…' : 'Confirm'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AppPageShell>;
}
