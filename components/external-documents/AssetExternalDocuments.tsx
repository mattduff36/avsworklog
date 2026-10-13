'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, ExternalLink } from 'lucide-react';
import { useModuleAccessLevel } from '@/lib/hooks/useModuleAccessLevel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface LinkedDocument { id: string; title: string; category: string; document_date: string | null }

export function AssetExternalDocuments({ assetType, assetId }: { assetType: 'van' | 'plant' | 'hgv'; assetId: string }) {
  const { accessLevel, isLoading } = useModuleAccessLevel('external-documents');
  if (isLoading || accessLevel < 1) return null;
  return <LinkedDocuments key={`${assetType}:${assetId}:${accessLevel}`} assetType={assetType} assetId={assetId} />;
}

function LinkedDocuments({ assetType, assetId }: { assetType: 'van' | 'plant' | 'hgv'; assetId: string }) {
  const [documents, setDocuments] = useState<LinkedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filter = new URLSearchParams({ asset_type: assetType, asset_id: assetId }).toString();
  const href = `/external-documents?${filter}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/external-documents?${filter}&page_size=10`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 428
          ? 'Open External Documents to unlock access with your PIN.'
          : 'Unable to load external documents. Open the library to try again.');
        const data = await response.json() as { documents: LinkedDocument[] };
        if (!controller.signal.aborted) setDocuments(data.documents);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load external documents.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter]);

  return (
    <Card className="mb-4 border-border">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg"><FileText className="h-5 w-5" />External Documents</CardTitle>
            <CardDescription>Third-party records linked to this asset. Document access follows the permissions matrix.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm"><Link href={href}>Open library<ExternalLink className="ml-2 h-4 w-4" /></Link></Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-muted-foreground" role="status">Loading linked documents…</p>
          : error ? <p className="text-sm text-muted-foreground" role="alert">{error}</p>
          : documents.length === 0 ? <p className="text-sm text-muted-foreground">No linked external documents are available to you.</p>
          : <ul className="divide-y divide-border">{documents.map(document => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <Link className="font-medium underline underline-offset-4 hover:text-primary" href={`${href}&document=${encodeURIComponent(document.id)}`}>{document.title}</Link>
              <span className="text-muted-foreground">{document.category}{document.document_date ? ` · ${document.document_date}` : ''}</span>
            </li>
          ))}</ul>}
      </CardContent>
    </Card>
  );
}
