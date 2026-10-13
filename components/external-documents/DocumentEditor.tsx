'use client';

import { useId, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, X } from 'lucide-react';
import { EXTERNAL_DOCUMENT_CATEGORIES, EXTERNAL_DOCUMENT_LIMITS, type ExternalDocumentAssetType, type ExternalDocumentCategory, type ExternalDocumentOptionsResponse } from '@/types/external-documents';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';

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

type EditorPanel = 'files' | 'details' | 'access';

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
const fieldClassName = 'h-[44px] border-border bg-slate-950 text-white placeholder:text-muted-foreground md:h-10';
const touchIconButtonClass = 'h-[44px] w-[44px] md:h-8 md:w-8';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasOptionalDetails(draft: ExternalDocumentDraft): boolean {
  return Boolean(draft.reference.trim() || draft.expiry_date || draft.notes.trim());
}

function panelForFormError(message: string, mode: 'create' | 'edit', canManageSharing: boolean): EditorPanel {
  if (mode === 'create' && /file|20 MB|combined limit/i.test(message)) return 'files';
  if (canManageSharing && /shared|reader|people/i.test(message)) return 'access';
  return 'details';
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
  const [panel, setPanel] = useState<EditorPanel>(formError ? panelForFormError(formError, mode, canManageSharing) : mode === 'create' ? 'files' : 'details');
  const [lastFormError, setLastFormError] = useState(formError);
  const [moreOpen, setMoreOpen] = useState(mode === 'edit' && hasOptionalDetails(draft));
  const errorOpensMore = Boolean(formError && /expiry|reference|notes/i.test(formError));
  const optionalOpen = moreOpen || errorOpensMore;
  const showFiles = mode === 'create';
  // Route each new validation error once, without locking the user onto that tab.
  if (formError !== lastFormError) {
    setLastFormError(formError);
    if (formError) setPanel(panelForFormError(formError, mode, canManageSharing));
  }
  let activePanel = panel;
  if (activePanel === 'files' && !showFiles) activePanel = 'details';
  if (activePanel === 'access' && !canManageSharing) activePanel = 'details';
  const assetValue = draft.asset_type && draft.asset_id ? `${draft.asset_type}:${draft.asset_id}` : 'none';
  const readerQueryText = readerQuery.trim().toLowerCase();
  const visibleReaders = options?.readers.filter((reader) => reader.label.toLowerCase().includes(readerQueryText)) ?? [];
  const totalBytes = draft.files.reduce((sum, item) => sum + item.file.size, 0);
  const tabs: Array<{ id: EditorPanel; label: string }> = [
    ...(showFiles ? [{ id: 'files' as const, label: `Files (${draft.files.length})` }] : []),
    { id: 'details', label: 'Details' },
    ...(canManageSharing ? [{ id: 'access' as const, label: `Access (${draft.shared_with.length})` }] : []),
  ];

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

  const detailsFields = (
    <section className="min-w-0 space-y-2" aria-labelledby={`${baseId}-details`}>
      <h3 id={`${baseId}-details`} className="text-xs font-semibold uppercase tracking-wide text-slate-300">Document details</h3>
      <div className="space-y-1">
        <Label htmlFor={`${baseId}-title`}>Title *</Label>
        <Input id={`${baseId}-title`} value={draft.title} maxLength={200} disabled={disabled} placeholder="e.g. Annual service certificate" aria-invalid={formError?.includes('title') ? true : undefined} className={fieldClassName} onChange={(event) => patch({ title: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${baseId}-category`}>Category *</Label>
        <Select value={draft.category} disabled={disabled} onValueChange={(value) => patch({ category: value as ExternalDocumentCategory })}>
          <SelectTrigger id={`${baseId}-category`} className={cn(fieldClassName, 'md:h-9')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXTERNAL_DOCUMENT_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${baseId}-company`}>External company *</Label>
        <Input id={`${baseId}-company`} value={draft.external_company} maxLength={200} disabled={disabled} placeholder="e.g. Acme Plant Services" aria-invalid={formError?.toLowerCase().includes('company') ? true : undefined} className={fieldClassName} onChange={(event) => patch({ external_company: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${baseId}-date`}>Document date *</Label>
        <Input id={`${baseId}-date`} type="date" value={draft.document_date} disabled={disabled} aria-invalid={formError?.toLowerCase().includes('date') ? true : undefined} className={fieldClassName} onChange={(event) => patch({ document_date: event.target.value })} />
      </div>
      <div className="space-y-1">
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
          <SelectTrigger id={`${baseId}-asset`} className={cn(fieldClassName, 'md:h-9')}><SelectValue placeholder={optionsLoading ? 'Loading assets…' : 'No linked asset'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No linked asset</SelectItem>
            {assetValue !== 'none' && !assetChoices.some((choice) => choice.value === assetValue) ? <SelectItem value={assetValue}>Linked asset</SelectItem> : null}
            {assetChoices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {optionsError ? <p className="text-sm text-destructive" role="alert">{optionsError}</p> : null}
      </div>
      <details open={optionalOpen}>
        <summary
          className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-slate-200 md:min-h-8"
          onClick={(event) => {
            event.preventDefault();
            setMoreOpen((open) => !open);
          }}
        >
          More details
        </summary>
        {optionalOpen ? <div className="space-y-2 pt-2">
          <div className="space-y-1">
            <Label htmlFor={`${baseId}-reference`}>Reference (optional)</Label>
            <Input id={`${baseId}-reference`} value={draft.reference} maxLength={120} disabled={disabled} placeholder="e.g. INV-1042" className={fieldClassName} onChange={(event) => patch({ reference: event.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${baseId}-expiry`}>Expiry date (optional)</Label>
            <Input id={`${baseId}-expiry`} type="date" value={draft.expiry_date} disabled={disabled} className={fieldClassName} onChange={(event) => patch({ expiry_date: event.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${baseId}-notes`}>Notes (optional)</Label>
            <Textarea id={`${baseId}-notes`} value={draft.notes} maxLength={4000} disabled={disabled} rows={2} placeholder="Optional notes about this document" className="border-border bg-slate-950 text-white placeholder:text-muted-foreground" onChange={(event) => patch({ notes: event.target.value })} />
          </div>
        </div> : null}
      </details>
    </section>
  );

  const filesFields = showFiles ? (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="text-xs font-semibold uppercase tracking-wide text-slate-300">Files</legend>
      <div>
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
          className="h-16 w-full border-2 border-dashed border-external-documents/40 text-slate-300 hover:border-external-documents hover:bg-external-documents/5 hover:text-external-documents"
          onClick={() => filesInputRef.current?.click()}
        >
          <span className="flex flex-col items-center leading-tight">
            <span className="text-sm font-medium">Choose files</span>
            <span className="text-xs text-muted-foreground">PDF, JPEG, or PNG · up to {EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles}</span>
          </span>
        </Button>
      </div>
      <div className="md:hidden">
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
        <Button type="button" variant="outline" className="h-[44px] w-full" onClick={() => cameraInputRef.current?.click()}>
          <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
          Take a photo
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {draft.files.length} {draft.files.length === 1 ? 'file' : 'files'} · {formatFileSize(totalBytes)}
      </p>
      {fileError ? <p className="text-sm text-destructive" role="alert">{fileError}</p> : null}
      {draft.files.length > 0 ? (
        <ol className="space-y-1 md:max-h-24 md:overflow-y-auto">
          {draft.files.map((item, index) => (
            <li key={item.key} className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{index + 1}. {item.file.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(item.file.size)}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="icon" className={touchIconButtonClass} disabled={index === 0} aria-label={`Move ${item.file.name} up`} onClick={() => moveFile(index, -1)}>
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="outline" size="icon" className={touchIconButtonClass} disabled={index === draft.files.length - 1} aria-label={`Move ${item.file.name} down`} onClick={() => moveFile(index, 1)}>
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className={touchIconButtonClass} aria-label={`Remove ${item.file.name}`} onClick={() => patch({ files: draft.files.filter((file) => file.key !== item.key) })}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </fieldset>
  ) : null;

  const accessFields = canManageSharing ? (
    <fieldset className="min-w-0 space-y-2" disabled={disabled || !options}>
      <legend className="text-xs font-semibold uppercase tracking-wide text-slate-300">Access</legend>
      <p className="text-sm text-muted-foreground">Selected people and document managers can read this document.</p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <SearchInput
          value={readerQuery}
          onChange={(event) => setReaderQuery(event.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          disabled={disabled || !options}
          containerClassName="h-[44px] bg-slate-950 md:h-10"
        />
        <p className="shrink-0 text-sm text-muted-foreground">{draft.shared_with.length} selected</p>
      </div>
      {optionsLoading ? <p className="text-sm text-muted-foreground" role="status">Loading people…</p> : null}
      {options && options.readers.length === 0 ? <p className="text-sm text-muted-foreground">No readers are available.</p> : null}
      {options && options.readers.length > 0 && visibleReaders.length === 0 ? <p className="text-sm text-muted-foreground">No people match that search.</p> : null}
      {visibleReaders.length > 0 ? (
        <div className="space-y-0.5 md:max-h-32 md:overflow-y-auto">
          {visibleReaders.map((reader) => {
            const checked = draft.shared_with.some((id) => id.toLowerCase() === reader.id.toLowerCase());
            return (
              <label key={reader.id} className="flex min-h-[44px] items-center gap-2 text-sm md:min-h-8" htmlFor={`${baseId}-reader-${reader.id}`}>
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
      ) : null}
    </fieldset>
  ) : null;

  return (
    <div className="space-y-3 max-md:[&_label]:!text-[14px] max-md:[&_p]:!text-[14px] max-md:[&_span]:!text-[14px] max-md:[&_summary]:!text-[14px] max-md:[&_input]:!text-[16px] max-md:[&_legend]:!text-[12px] max-md:[&_h3]:!text-[12px]">
      {formError ? <p className="text-sm text-destructive" role="alert">{formError}</p> : null}
      {tabs.length > 1 ? (
        <Tabs value={activePanel} onValueChange={(value) => setPanel(value as EditorPanel)} className="md:hidden">
          <TabsList className={cn('grid h-auto w-full gap-0 p-1', tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} id={`${baseId}-${tab.id}-tab`} aria-controls={`${baseId}-${tab.id}-panel`} className="min-h-[44px] px-1 text-xs data-[state=active]:bg-external-documents data-[state=active]:text-white">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      <div className={cn('grid items-start gap-3', (showFiles || canManageSharing) && 'md:grid-cols-2 md:gap-4')}>
        <div id={`${baseId}-details-panel`} role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `${baseId}-details-tab` : undefined} className={activePanel === 'details' ? undefined : 'max-md:hidden'}>
          {detailsFields}
        </div>
        {(showFiles || canManageSharing) ? (
          <div className={cn('space-y-3', activePanel === 'details' && 'max-md:hidden')}>
            {showFiles ? <div id={`${baseId}-files-panel`} role="tabpanel" aria-labelledby={`${baseId}-files-tab`} className={activePanel === 'files' ? undefined : 'max-md:hidden'}>{filesFields}</div> : null}
            {canManageSharing ? <div id={`${baseId}-access-panel`} role="tabpanel" aria-labelledby={`${baseId}-access-tab`} className={activePanel === 'access' ? undefined : 'max-md:hidden'}>{accessFields}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
