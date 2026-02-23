'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  useManageDocuments,
  useFavourites,
  useDocumentTypes,
  useDeleteDocument,
  useAddFavourite,
  useRemoveFavourite,
  type FavouriteRow,
} from '@/lib/hooks/useProjectsManage';
import { UploadRAMSModal } from '@/components/rams/UploadRAMSModal';
import { ProjectsManageToolbar } from '@/components/projects/manage/ProjectsManageToolbar';
import { ProjectsManageStats } from '@/components/projects/manage/ProjectsManageStats';
import { ProjectsManageFilters } from '@/components/projects/manage/ProjectsManageFilters';
import { ProjectsFavouriteStrip } from '@/components/projects/manage/ProjectsFavouriteStrip';
import { ProjectsDocumentsTable } from '@/components/projects/manage/ProjectsDocumentsTable';
import { ProjectsDocumentsMobileCards } from '@/components/projects/manage/ProjectsDocumentsMobileCards';
import type { FilterKey } from '@/components/projects/manage/ProjectsManageStats';
import type { ManageDocumentRow, ManageDocumentsQuery, ManageDocumentsCounts } from '@/types/rams';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Upload, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Monitor } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const DEFAULT_COUNTS: ManageDocumentsCounts = {
  all: 0,
  needs_signature: 0,
  read_only: 0,
  recently_uploaded: 0,
};

export default function ProjectsManagePage() {
  const router = useRouter();
  const { isManager, isAdmin, loading: authLoading } = useAuth();

  // Search / filter / sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [signatureFilter, setSignatureFilter] = useState<ManageDocumentsQuery['signature'] | ''>('');
  const [sortBy, setSortBy] = useState<NonNullable<ManageDocumentsQuery['sortBy']>>('created_at');
  const [sortDir, setSortDir] = useState<NonNullable<ManageDocumentsQuery['sortDir']>>('desc');
  const [statFilter, setStatFilter] = useState<FilterKey>('all');

  // Upload modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [reuseDoc, setReuseDoc] = useState<{ title: string; description: string; typeId: string } | null>(null);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<ManageDocumentRow | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Map stat card filter to API params
  const computedSignature = useMemo(() => {
    if (statFilter === 'needs_signature') return 'required' as const;
    if (statFilter === 'read_only') return 'read-only' as const;
    return signatureFilter || undefined;
  }, [statFilter, signatureFilter]);

  const queryParams: ManageDocumentsQuery = useMemo(() => ({
    q: debouncedSearch || undefined,
    type: typeFilter || undefined,
    signature: computedSignature,
    sortBy,
    sortDir,
    limit: 200,
  }), [debouncedSearch, typeFilter, computedSignature, sortBy, sortDir]);

  // Data hooks
  const {
    data: docsData,
    isLoading: docsLoading,
    error: docsError,
  } = useManageDocuments(queryParams);

  const { data: favsData } = useFavourites();
  const { data: typesData } = useDocumentTypes();

  // Mutations
  const deleteDoc = useDeleteDocument();
  const addFav = useAddFavourite();
  const removeFav = useRemoveFavourite();

  // Redirect non-managers
  useEffect(() => {
    if (!authLoading && !isManager && !isAdmin) {
      router.push('/projects');
    }
  }, [isManager, isAdmin, authLoading, router]);

  // Derived data
  const documents = docsData?.documents ?? [];
  const counts = docsData?.counts ?? DEFAULT_COUNTS;
  const total = docsData?.total ?? 0;
  const favourites = favsData?.favourites ?? [];
  const documentTypes = useMemo(
    () => (typesData?.types ?? []).filter(t => t.is_active).map(t => ({ id: t.id, name: t.name })),
    [typesData],
  );

  const hasActiveFilters = !!(debouncedSearch || typeFilter || statFilter !== 'all');

  // Handlers
  const handleSortChange = useCallback((field: NonNullable<ManageDocumentsQuery['sortBy']>) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir(field === 'title' ? 'asc' : 'desc');
      return field;
    });
  }, []);

  const handleStatFilter = useCallback((filter: FilterKey) => {
    setStatFilter((prev) => (prev === filter ? 'all' : filter));
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setTypeFilter('');
    setSignatureFilter('');
    setStatFilter('all');
  }, []);

  const handleReuse = useCallback((fav: FavouriteRow) => {
    setReuseDoc({
      title: fav.document.title,
      description: fav.document.description || '',
      typeId: fav.document.document_type_id || fav.document.document_type?.id || '',
    });
    setUploadModalOpen(true);
  }, []);

  const handleReuseFromRow = useCallback((doc: ManageDocumentRow) => {
    setReuseDoc({
      title: doc.title,
      description: doc.description || '',
      typeId: doc.document_type_id || '',
    });
    setUploadModalOpen(true);
  }, []);

  const handleToggleFavourite = useCallback((doc: ManageDocumentRow) => {
    if (doc.is_favourite) {
      removeFav.mutate(doc.id);
    } else {
      addFav.mutate(doc.id);
    }
  }, [addFav, removeFav]);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    deleteDoc.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }, [deleteTarget, deleteDoc]);

  const handleUploadSuccess = useCallback(() => {
    setUploadModalOpen(false);
    setReuseDoc(null);
  }, []);

  // Auth guard loading
  if (authLoading || (!isManager && !isAdmin)) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 max-w-7xl">
      {/* Mobile info banner */}
      <Alert className="md:hidden bg-blue-900/20 border-blue-700/50">
        <Monitor className="h-4 w-4 text-blue-400" />
        <AlertDescription className="text-blue-200 text-sm">
          Tap a document card to expand details and actions.
        </AlertDescription>
      </Alert>

      {/* Toolbar */}
      <ProjectsManageToolbar onUploadClick={() => setUploadModalOpen(true)} />

      {/* Stats cards */}
      {docsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-lg" />
          ))}
        </div>
      ) : (
        <ProjectsManageStats
          counts={counts}
          activeFilter={statFilter}
          onFilterChange={handleStatFilter}
        />
      )}

      {/* Favourites strip */}
      <ProjectsFavouriteStrip
        favourites={favourites}
        onReuse={handleReuse}
        onRemove={(id) => removeFav.mutate(id)}
      />

      {/* Filters */}
      <ProjectsManageFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        documentTypes={documentTypes}
        totalResults={total}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Document list */}
      {docsLoading ? (
        <div className="space-y-3">
          {/* Desktop skeleton */}
          <div className="hidden md:block rounded-lg border border-border overflow-hidden bg-white dark:bg-slate-900 p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
          {/* Mobile skeleton */}
          <div className="md:hidden space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </div>
      ) : docsError ? (
        <Card className="bg-white dark:bg-slate-900 border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-destructive/50 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load documents</h3>
            <p className="text-muted-foreground mb-4 text-center text-sm">
              {(docsError as Error).message || 'Something went wrong. Please try again.'}
            </p>
          </CardContent>
        </Card>
      ) : documents.length === 0 ? (
        <Card className="bg-white dark:bg-slate-900 border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {hasActiveFilters ? 'No matching documents' : 'No documents yet'}
            </h3>
            <p className="text-muted-foreground mb-4 text-center text-sm">
              {hasActiveFilters
                ? 'Try adjusting your search or filters'
                : 'Upload your first project document to get started'}
            </p>
            {hasActiveFilters ? (
              <Button variant="outline" onClick={handleClearFilters}>
                Clear Filters
              </Button>
            ) : (
              <Button
                onClick={() => setUploadModalOpen(true)}
                className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Your First Document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <ProjectsDocumentsTable
            documents={documents}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={handleSortChange}
            onDelete={setDeleteTarget}
            onToggleFavourite={handleToggleFavourite}
            onReuse={handleReuseFromRow}
          />

          {/* Mobile cards */}
          <ProjectsDocumentsMobileCards
            documents={documents}
            onDelete={setDeleteTarget}
            onToggleFavourite={handleToggleFavourite}
            onReuse={handleReuseFromRow}
          />
        </>
      )}

      {/* Upload Modal */}
      <UploadRAMSModal
        open={uploadModalOpen}
        onClose={() => { setUploadModalOpen(false); setReuseDoc(null); }}
        onSuccess={handleUploadSuccess}
        prefillTitle={reuseDoc?.title}
        prefillDescription={reuseDoc?.description}
        prefillTypeId={reuseDoc?.typeId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Document</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-semibold">{deleteTarget?.title}</span>?
              <br /><br />
              This action cannot be undone. The document and all associated signatures will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDoc.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteDoc.isPending}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteDoc.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
