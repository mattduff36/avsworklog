'use client';

import { Suspense, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { ExternalDocumentsWorkspace } from '@/components/external-documents/ExternalDocumentsWorkspace';
import { ModuleBetaBadge } from '@/components/ui/module-beta-badge';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';
import { httpExternalDocumentsAdapter, isExternalDocumentId, type ExternalDocumentsAssetFilter } from '@/lib/client/external-documents';
import { useAuth } from '@/lib/hooks/useAuth';
import { useModuleAccessLevel } from '@/lib/hooks/useModuleAccessLevel';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

const betaBadge = <ModuleBetaBadge accent="external-documents" />;

function readAssetFilter(params: URLSearchParams): { filter: ExternalDocumentsAssetFilter; error: string | null } {
  const assetType = params.get('asset_type');
  const assetId = params.get('asset_id');
  if (!assetType && !assetId) return { filter: null, error: null };
  const typeOk = assetType === 'van' || assetType === 'plant' || assetType === 'hgv';
  if (!typeOk || !assetId || !isExternalDocumentId(assetId)) {
    return { filter: null, error: 'Choose both an asset type and an asset.' };
  }
  return { filter: { asset_type: assetType, asset_id: assetId }, error: null };
}

function ExternalDocumentsPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('external-documents', false);
  const { accessLevel, isLoading: levelLoading } = useModuleAccessLevel('external-documents');
  const permissionKnown = !permissionLoading && !levelLoading;
  const allowed = permissionKnown && hasPermission && accessLevel >= 1;
  const sensitiveAccess = useSensitiveModuleAccess('external-documents', { enabled: allowed });
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asset = useMemo(() => readAssetFilter(searchParams), [searchParams]);
  const documentParam = searchParams.get('document');

  function replaceParams(mutate: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  if (!permissionKnown || (allowed && sensitiveAccess.loading)) {
    return (
      <AppPageLoadingShell
        title="External Documents"
        titleMeta={betaBadge}
        message="Loading external documents..."
      />
    );
  }

  if (!hasPermission || accessLevel < 1) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="External Documents"
          titleMeta={betaBadge}
          description="This module is not enabled for your team."
        />
      </AppPageShell>
    );
  }

  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="External Documents"
          titleMeta={betaBadge}
          description="Enter your PIN to open External Documents."
        />
        <SensitiveModuleGate moduleLabel="External Documents" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  if (!profile?.id) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="External Documents"
          titleMeta={betaBadge}
          description="Your profile could not be loaded, so documents were not requested."
        />
      </AppPageShell>
    );
  }

  return (
    <>
      <SensitiveModuleSessionManager moduleLabel="External Documents" access={sensitiveAccess} />
      <ExternalDocumentsWorkspace
        key={`${profile.id}:${accessLevel}`}
        adapter={httpExternalDocumentsAdapter}
        accessLevel={accessLevel}
        currentUserId={profile.id}
        assetFilter={asset.filter}
        assetLinkError={asset.error}
        onAssetFilterChange={(filter) => {
          replaceParams((params) => {
            if (filter) {
              params.set('asset_type', filter.asset_type);
              params.set('asset_id', filter.asset_id);
            } else {
              params.delete('asset_type');
              params.delete('asset_id');
            }
          });
        }}
        documentId={documentParam}
        onDocumentIdChange={(id) => {
          replaceParams((params) => {
            if (id) params.set('document', id);
            else params.delete('document');
          });
        }}
      />
    </>
  );
}

export default function ExternalDocumentsRoute() {
  return (
    <Suspense
      fallback={(
        <AppPageLoadingShell
          title="External Documents"
          titleMeta={betaBadge}
          message="Loading external documents..."
        />
      )}
    >
      <ExternalDocumentsPage />
    </Suspense>
  );
}
