'use client';

import { useMemo, useState } from 'react';
import { ExternalDocumentsWorkspace } from '@/components/external-documents/ExternalDocumentsWorkspace';
import {
  PREVIEW_CURRENT_USER_ID,
  PREVIEW_SAMPLE_ASSETS,
  createPreviewExternalDocumentsAdapter,
} from '@/lib/client/external-documents-preview';
import type { ExternalDocumentsAssetFilter } from '@/lib/client/external-documents';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const LEVELS = [0, 1, 2, 3, 4, 5] as const;

const LEVEL_COPY: Record<(typeof LEVELS)[number], string> = {
  0: '0 — No module access',
  1: '1 — Assigned active documents',
  2: '2 — Assigned active documents',
  3: '3 — Assigned active documents',
  4: '4 — Manage all documents',
  5: '5 — Manage all documents',
};

const SAMPLE_LINKS: Array<{ filter: Exclude<ExternalDocumentsAssetFilter, null>; label: string }> = [
  { filter: { asset_type: 'van', asset_id: PREVIEW_SAMPLE_ASSETS.vans[0].id }, label: PREVIEW_SAMPLE_ASSETS.vans[0].label },
  { filter: { asset_type: 'plant', asset_id: PREVIEW_SAMPLE_ASSETS.plant[0].id }, label: PREVIEW_SAMPLE_ASSETS.plant[0].label },
  { filter: { asset_type: 'hgv', asset_id: PREVIEW_SAMPLE_ASSETS.hgvs[0].id }, label: PREVIEW_SAMPLE_ASSETS.hgvs[0].label },
];

export function ExternalDocumentsPreview() {
  const [accessLevel, setAccessLevel] = useState<(typeof LEVELS)[number]>(4);
  const [assetFilter, setAssetFilter] = useState<ExternalDocumentsAssetFilter>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const adapter = useMemo(
    () => createPreviewExternalDocumentsAdapter({ accessLevel, userId: PREVIEW_CURRENT_USER_ID }),
    [accessLevel],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-external-documents/40 bg-external-documents-soft p-4 text-sm text-foreground" role="status">
        Sample assets and locally saved browser documents. No live data. Files stay in this browser on this PC.
      </div>
      <div className="rounded-lg border border-border bg-slate-900 p-4">
        <div className="max-w-md space-y-2">
          <Label htmlFor="preview-access-level">Access level</Label>
          <Select
            value={String(accessLevel)}
            onValueChange={(value) => {
              setAccessLevel(Number(value) as (typeof LEVELS)[number]);
              setDocumentId(null);
            }}
          >
            <SelectTrigger id="preview-access-level"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEVELS.map((level) => <SelectItem key={level} value={String(level)}>{LEVEL_COPY[level]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Access levels 0–5 follow the permissions matrix. Level 0 requests nothing. Levels 1–3 see active documents shared with Sample User (you). Levels 4–5 can upload, edit, share, and archive every saved document.
        </p>
      </div>
      <section className="space-y-3" aria-labelledby="sample-assets-heading">
        <h2 id="sample-assets-heading" className="text-lg font-semibold">Sample assets</h2>
        <p className="text-sm text-muted-foreground">Choose a sample asset to see its linked documents.</p>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_LINKS.map((link) => {
            const selected = assetFilter?.asset_type === link.filter.asset_type && assetFilter.asset_id === link.filter.asset_id;
            return (
              <Button
                key={link.filter.asset_id}
                type="button"
                variant={selected ? 'default' : 'outline'}
                className={selected ? 'bg-external-documents text-white hover:bg-external-documents-dark' : undefined}
                aria-pressed={selected}
                onClick={() => {
                  setAssetFilter(selected ? null : link.filter);
                  setDocumentId(null);
                }}
              >
                {link.label}
              </Button>
            );
          })}
        </div>
      </section>
      <ExternalDocumentsWorkspace
        key={accessLevel}
        adapter={adapter}
        accessLevel={accessLevel}
        currentUserId={PREVIEW_CURRENT_USER_ID}
        assetFilter={assetFilter}
        onAssetFilterChange={(filter) => {
          setAssetFilter(filter);
          setDocumentId(null);
        }}
        documentId={documentId}
        onDocumentIdChange={setDocumentId}
      />
    </div>
  );
}
