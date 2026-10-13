'use client';

import { useId, useState } from 'react';
import { EXTERNAL_DOCUMENT_CATEGORIES, EXTERNAL_DOCUMENT_LIMITS, type ExternalDocumentAssetType, type ExternalDocumentCategory, type ExternalDocumentOptionsResponse } from '@/types/external-documents';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [fileError, setFileError] = useState<string | null>(null);
  const assetValue = draft.asset_type && draft.asset_id ? `${draft.asset_type}:${draft.asset_id}` : 'none';

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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${baseId}-title`}>Title</Label>
          <Input id={`${baseId}-title`} value={draft.title} maxLength={200} disabled={disabled} onChange={(event) => patch({ title: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${baseId}-category`}>Category</Label>
          <Select value={draft.category} disabled={disabled} onValueChange={(value) => patch({ category: value as ExternalDocumentCategory })}>
            <SelectTrigger id={`${baseId}-category`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXTERNAL_DOCUMENT_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${baseId}-company`}>External company</Label>
          <Input id={`${baseId}-company`} value={draft.external_company} maxLength={200} disabled={disabled} onChange={(event) => patch({ external_company: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${baseId}-date`}>Document date</Label>
          <Input id={`${baseId}-date`} type="date" value={draft.document_date} disabled={disabled} onChange={(event) => patch({ document_date: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${baseId}-expiry`}>Expiry date (optional)</Label>
          <Input id={`${baseId}-expiry`} type="date" value={draft.expiry_date} disabled={disabled} onChange={(event) => patch({ expiry_date: event.target.value })} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${baseId}-reference`}>Reference (optional)</Label>
          <Input id={`${baseId}-reference`} value={draft.reference} maxLength={120} disabled={disabled} onChange={(event) => patch({ reference: event.target.value })} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${baseId}-notes`}>Notes (optional)</Label>
          <Textarea id={`${baseId}-notes`} value={draft.notes} maxLength={4000} disabled={disabled} onChange={(event) => patch({ notes: event.target.value })} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${baseId}-asset`}>Linked asset (optional)</Label>
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
            <SelectTrigger id={`${baseId}-asset`}><SelectValue placeholder={optionsLoading ? 'Loading assets…' : 'No linked asset'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No linked asset</SelectItem>
              {assetValue !== 'none' && !assetChoices.some((choice) => choice.value === assetValue) ? <SelectItem value={assetValue}>Linked asset</SelectItem> : null}
              {assetChoices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {optionsError ? <p className="text-sm text-destructive" role="alert">{optionsError}</p> : null}
        </div>
      </div>

      {canManageSharing ? (
        <fieldset className="space-y-2" disabled={disabled || !options}>
          <legend className="text-sm font-medium">People who can read this document</legend>
          {optionsLoading ? <p className="text-sm text-muted-foreground" role="status">Loading people…</p> : null}
          {options && options.readers.length === 0 ? <p className="text-sm text-muted-foreground">No readers are available.</p> : null}
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3">
            {options?.readers.map((reader) => {
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

      {mode === 'create' ? (
        <fieldset className="space-y-3" disabled={disabled}>
          <legend className="text-sm font-medium">Files</legend>
          <p className="text-sm text-muted-foreground">Add PDFs, JPEGs, or PNGs. On a phone, take a photo and it joins the same list. The files are combined in the order shown.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-files`}>Choose files</Label>
              <Input id={`${baseId}-files`} type="file" accept={ACCEPT} multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-camera`}>Take a photo</Label>
              <Input id={`${baseId}-camera`} type="file" accept="image/jpeg,image/png" capture="environment" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
            </div>
          </div>
          {fileError ? <p className="text-sm text-destructive" role="alert">{fileError}</p> : null}
          {draft.files.length === 0 ? <p className="text-sm text-muted-foreground">No files added yet.</p> : (
            <ol className="space-y-2">
              {draft.files.map((item, index) => (
                <li key={item.key} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 break-words text-sm">{index + 1}. {item.file.name}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="h-11 md:h-8" disabled={index === 0} aria-label={`Move ${item.file.name} up`} onClick={() => moveFile(index, -1)}>Up</Button>
                    <Button type="button" variant="outline" className="h-11 md:h-8" disabled={index === draft.files.length - 1} aria-label={`Move ${item.file.name} down`} onClick={() => moveFile(index, 1)}>Down</Button>
                    <Button type="button" variant="outline" className="h-11 md:h-8" aria-label={`Remove ${item.file.name}`} onClick={() => patch({ files: draft.files.filter((file) => file.key !== item.key) })}>Remove</Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
