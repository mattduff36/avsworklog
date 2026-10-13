'use client';

import { useId, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, FileText, Link2, Upload, Users, X } from 'lucide-react';
import { EXTERNAL_DOCUMENT_CATEGORIES, EXTERNAL_DOCUMENT_LIMITS, type ExternalDocumentAssetType, type ExternalDocumentCategory, type ExternalDocumentOptionsResponse } from '@/types/external-documents';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type DraftFile = { key: string; file: File };

export type ExternalDocumentDraft = {
  title: string;
  category: ExternalDocumentCategory;
  external_company: string;
  document_date: string;
  expiry_date: string;
  reference: string;
  notes: string;
  asset_type: ExternalDocumentAssetType | '';
  asset_id: string;
  shared_with: string[];
  files: DraftFile[];
};

export function emptyExternalDocumentDraft(): ExternalDocumentDraft {
  return {
    title: '',
    category: 'Service record',
    external_company: '',
    document_date: '',
    expiry_date: '',
    reference: '',
    notes: '',
    asset_type: '',
    asset_id: '',
    shared_with: [],
    files: [],
  };
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
const fieldClassName = 'border-border bg-slate-950 text-white placeholder:text-muted-foreground';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentEditor({
  mode,
  draft,
  onDraftChange,
  options,
  optionsLoading,
  optionsError,
  canManageSharing,
  disabled,
  formError,
}: {
  mode: 'create' | 'edit';
  draft: ExternalDocumentDraft;
  onDraftChange: (draft: ExternalDocumentDraft) => void;
  options: ExternalDocumentOptionsResponse | null;
  optionsLoading: boolean;
  optionsError: string | null;
  canManageSharing: boolean;
  disabled: boolean;
  formError: string | null;
}) {
  const baseId = useId();
  const filesInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [readerQuery, setReaderQuery] = useState('');
  const assetValue = draft.asset_type && draft.asset_id ? `${draft.asset_type}:${draft.asset_id}` : 'none';
  const readerQueryText = readerQuery.trim().toLowerCase();
  const visibleReaders = options?.readers.filter((reader) => reader.label.toLowerCase().includes(readerQueryText)) ?? [];
  const totalBytes = draft.files.reduce((sum, item) => sum + item.file.size, 0);

  function patch(partial: Partial<ExternalDocumentDraft>) {
    onDraftChange({ ...draft, ...partial });
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = [...draft.files];
    let rejected = false;
    for (const file of Array.from(list)) {
      if (next.length >= EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles) {
        rejected = true;
        break;
      }
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`, file });
    }
    setFileError(rejected ? `Choose ${EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles} files or fewer.` : null);
    patch({ files: next });
  }

  function moveFile(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.files.length) return;
    const next = [...draft.files];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    patch({ files: next });
  }

  const assetChoices = options
    ? [
        ...options.assets.vans.map((asset) => ({ value: `van:${asset.id}`, label: `Van · ${asset.label}` })),
        ...options.assets.plant.map((asset) => ({ value: `plant:${asset.id}`, label: `Plant · ${asset.label}` })),
        ...options.assets.hgvs.map((asset) => ({ value: `hgv:${asset.id}`, label: `HGV · ${asset.label}` })),
      ]
    : [];

  return (
    <div className="space-y-4">
      {formError ? <p className="text-sm text-destructive" role="alert">{formError}</p> : null}

      {mode === 'create' ? (
        <fieldset className="space-y-3 rounded-lg border border-border bg-slate-900/40 p-4" disabled={disabled}>
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <Upload className="h-4 w-4 text-external-documents" aria-hidden="true" />
            Files
          </legend>
          <p className="text-sm text-muted-foreground">Add PDFs, JPEGs, or PNGs, up to {EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles} files. On a phone, take a photo and it joins the same list. The files are combined in the order shown.</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1">
              <Label htmlFor={`${baseId}-files`} className="sr-only">Choose files</Label>
              <Input
                ref={filesInputRef}
                id={`${baseId}-files`}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
              />
              <Button
                type="button"
                variant="outline"
                className="h-24 w-full border-2 border-dashed border-external-documents/40 text-slate-300 hover:border-external-documents hover:bg-external-documents/5 hover:text-external-documents"
                onClick={() => filesInputRef.current?.click()}
              >
                <span className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8" aria-hidden="true" />
                  <span className="font-medium">Choose files</span>
                  <span className="text-xs text-muted-foreground">PDF, JPEG, or PNG</span>
                </span>
              </Button>
            </div>
            <div className="sm:self-end">
              <Label htmlFor={`${baseId}-camera`} className="sr-only">Take a photo</Label>
              <Input
                ref={cameraInputRef}
                id={`${baseId}-camera`}
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                className="sr-only"
                onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
              />
              <Button type="button" variant="outline" className="h-11 w-full md:h-8 sm:w-auto" onClick={() => cameraInputRef.current?.click()}>
                <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                Take a photo
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {draft.files.length} {draft.files.length === 1 ? 'file' : 'files'} · {formatFileSize(totalBytes)}
          </p>
          {fileError ? <p className="text-sm text-destructive" role="alert">{fileError}</p> : null}
          {draft.files.length === 0 ? <p className="text-sm text-muted-foreground">No files added yet.</p> : (
            <ol className="space-y-2">
              {draft.files.map((item, index) => (
                <li key={item.key} className="flex items-center gap-3 rounded-md border border-border bg-slate-950/50 p-3">
                  <FileText className="h-8 w-8 shrink-0 text-external-documents" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{index + 1}. {item.file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(item.file.size)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="outline" size="icon" className="h-11 w-11 md:h-8 md:w-8" disabled={index === 0} aria-label={`Move ${item.file.name} up`} onClick={() => moveFile(index, -1)}>
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" className="h-11 w-11 md:h-8 md:w-8" disabled={index === draft.files.length - 1} aria-label={`Move ${item.file.name} down`} onClick={() => moveFile(index, 1)}>
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" aria-label={`Remove ${item.file.name}`} onClick={() => patch({ files: draft.files.filter((file) => file.key !== item.key) })}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </fieldset>
      ) : null}

      <section className="space-y-4 rounded-lg border border-border bg-slate-900/40 p-4" aria-labelledby={`${baseId}-details`}>
        <h3 id={`${baseId}-details`} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
          <FileText className="h-4 w-4 text-external-documents" aria-hidden="true" />
          Document details
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${baseId}-title`}>Title *</Label>
            <Input id={`${baseId}-title`} value={draft.title} maxLength={200} disabled={disabled} placeholder="e.g. Annual service certificate" className={fieldClassName} onChange={(event) => patch({ title: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-category`}>Category *</Label>
            <Select value={draft.category} disabled={disabled} onValueChange={(value) => patch({ category: value as ExternalDocumentCategory })}>
              <SelectTrigger id={`${baseId}-category`} className={fieldClassName}><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXTERNAL_DOCUMENT_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">e.g. Service record, Certificate, Invoice</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-company`}>External company *</Label>
            <Input id={`${baseId}-company`} value={draft.external_company} maxLength={200} disabled={disabled} placeholder="e.g. Acme Plant Services" className={fieldClassName} onChange={(event) => patch({ external_company: event.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${baseId}-date`}>Document date *</Label>
            <Input id={`${baseId}-date`} type="date" value={draft.document_date} disabled={disabled} className={fieldClassName} onChange={(event) => patch({ document_date: event.target.value })} />
            <p className="text-xs text-muted-foreground">e.g. the date printed on the certificate</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-reference`}>Reference (optional)</Label>
            <Input id={`${baseId}-reference`} value={draft.reference} maxLength={120} disabled={disabled} placeholder="e.g. INV-1042" className={fieldClassName} onChange={(event) => patch({ reference: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-expiry`}>Expiry date (optional)</Label>
            <Input id={`${baseId}-expiry`} type="date" value={draft.expiry_date} disabled={disabled} className={fieldClassName} onChange={(event) => patch({ expiry_date: event.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${baseId}-notes`}>Notes (optional)</Label>
            <Textarea id={`${baseId}-notes`} value={draft.notes} maxLength={4000} disabled={disabled} rows={2} placeholder="Optional notes about this document" className={fieldClassName} onChange={(event) => patch({ notes: event.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${baseId}-asset`} className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-external-documents" aria-hidden="true" />
              Linked asset (optional)
            </Label>
            <Select
              value={assetValue}
              disabled={disabled || optionsLoading || !options}
              onValueChange={(value) => {
                if (value === 'none') patch({ asset_type: '', asset_id: '' });
                else {
                  const [asset_type, asset_id] = value.split(':') as [ExternalDocumentAssetType, string];
                  patch({ asset_type, asset_id });
                }
              }}
            >
              <SelectTrigger id={`${baseId}-asset`} className={fieldClassName}><SelectValue placeholder={optionsLoading ? 'Loading assets…' : 'No linked asset'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No linked asset</SelectItem>
                {assetValue !== 'none' && !assetChoices.some((choice) => choice.value === assetValue) ? <SelectItem value={assetValue}>Linked asset</SelectItem> : null}
                {assetChoices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {optionsError ? <p className="text-sm text-destructive" role="alert">{optionsError}</p> : null}
          </div>
        </div>
      </section>

      {canManageSharing ? (
        <fieldset className="space-y-3 rounded-lg border border-border bg-slate-900/40 p-4" disabled={disabled || !options}>
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <Users className="h-4 w-4 text-external-documents" aria-hidden="true" />
            Access
          </legend>
          <p className="text-sm text-muted-foreground">People you select can open this document while it is active. People with manager access to External Documents can still open every document, whether or not they are selected here.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={readerQuery}
              onChange={(event) => setReaderQuery(event.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              disabled={disabled || !options}
              containerClassName="bg-slate-950"
            />
            <p className="shrink-0 text-sm text-muted-foreground">{draft.shared_with.length} selected</p>
          </div>
          {optionsLoading ? <p className="text-sm text-muted-foreground" role="status">Loading people…</p> : null}
          {options && options.readers.length === 0 ? <p className="text-sm text-muted-foreground">No readers are available.</p> : null}
          {options && options.readers.length > 0 && visibleReaders.length === 0 ? <p className="text-sm text-muted-foreground">No people match that search.</p> : null}
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border bg-slate-950/70 p-3">
            {visibleReaders.map((reader) => {
              const checked = draft.shared_with.some((id) => id.toLowerCase() === reader.id.toLowerCase());
              return (
                <label key={reader.id} className="flex items-center gap-2 text-sm" htmlFor={`${baseId}-reader-${reader.id}`}>
                  <Checkbox
                    id={`${baseId}-reader-${reader.id}`}
                    checked={checked}
                    onCheckedChange={(value) => {
                      const shared_with = value === true
                        ? [...draft.shared_with, reader.id]
                        : draft.shared_with.filter((id) => id.toLowerCase() !== reader.id.toLowerCase());
                      patch({ shared_with });
                    }}
                  />
                  <span>{reader.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
