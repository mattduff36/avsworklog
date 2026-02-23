import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ManageDocumentsQuery,
  ManageDocumentsResponse,
  ManageDocumentRow,
  ManageDocumentsCounts,
  ProjectFavouriteWithDocument,
} from '@/types/rams';

// ============================================================================
// Query keys
// ============================================================================

export const projectsManageKeys = {
  all: ['projects-manage'] as const,
  documents: (params: ManageDocumentsQuery) =>
    ['projects-manage', 'documents', params] as const,
  favourites: ['projects-manage', 'favourites'] as const,
  documentTypes: ['projects-manage', 'document-types'] as const,
};

// ============================================================================
// Query: Manage documents list (with search/filter/sort/pagination)
// ============================================================================

function buildSearchParams(params: ManageDocumentsQuery): string {
  const sp = new URLSearchParams({ all: 'true' });
  if (params.q) sp.set('q', params.q);
  if (params.type) sp.set('type', params.type);
  if (params.signature) sp.set('signature', params.signature);
  if (params.sortBy) sp.set('sortBy', params.sortBy);
  if (params.sortDir) sp.set('sortDir', params.sortDir);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  return sp.toString();
}

export function useManageDocuments(params: ManageDocumentsQuery = {}) {
  return useQuery<ManageDocumentsResponse>({
    queryKey: projectsManageKeys.documents(params),
    queryFn: async () => {
      const res = await fetch(`/api/rams?${buildSearchParams(params)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch documents');
      }
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

// ============================================================================
// Query: User favourites
// ============================================================================

interface FavouritesResponse {
  success: boolean;
  favourites: FavouriteRow[];
}

export interface FavouriteRow {
  id: string;
  document_id: string;
  document: {
    id: string;
    title: string;
    description: string | null;
    file_name: string;
    file_type: string;
    file_size: number;
    document_type_id: string | null;
    document_type?: { id: string; name: string; required_signature: boolean } | null;
  };
}

export function useFavourites() {
  return useQuery<FavouritesResponse>({
    queryKey: projectsManageKeys.favourites,
    queryFn: async () => {
      const res = await fetch('/api/projects/favourites');
      if (!res.ok) throw new Error('Failed to fetch favourites');
      return res.json();
    },
    staleTime: 60_000,
  });
}

// ============================================================================
// Query: Document types (for filter dropdown)
// ============================================================================

interface DocumentTypesResponse {
  success: boolean;
  types: { id: string; name: string; is_active: boolean; required_signature: boolean }[];
}

export function useDocumentTypes() {
  return useQuery<DocumentTypesResponse>({
    queryKey: projectsManageKeys.documentTypes,
    queryFn: async () => {
      const res = await fetch('/api/projects/document-types');
      if (!res.ok) throw new Error('Failed to fetch document types');
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}

// ============================================================================
// Mutation: Delete document
// ============================================================================

export function useDeleteDocument() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (docId: string) => {
      const res = await fetch(`/api/rams/${docId}/delete`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete document');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsManageKeys.all });
      toast.success('Document deleted successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete document');
    },
  });
}

// ============================================================================
// Mutation: Add favourite
// ============================================================================

export function useAddFavourite() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await fetch('/api/projects/favourites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: documentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add favourite');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsManageKeys.all });
      toast.success('Added to favourites');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add favourite');
    },
  });
}

// ============================================================================
// Mutation: Remove favourite
// ============================================================================

export function useRemoveFavourite() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await fetch(`/api/projects/favourites?document_id=${documentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove favourite');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsManageKeys.all });
      toast.success('Removed from favourites');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to remove favourite');
    },
  });
}

// ============================================================================
// Mutation: Upload document (wraps FormData upload)
// ============================================================================

interface UploadDocumentInput {
  file: File;
  title: string;
  description?: string;
  documentTypeId?: string;
}

export function useUploadDocument() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, title, description, documentTypeId }: UploadDocumentInput) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title.trim());
      if (description?.trim()) formData.append('description', description.trim());
      if (documentTypeId) formData.append('document_type_id', documentTypeId);

      const res = await fetch('/api/rams/upload', { method: 'POST', body: formData });
      const contentType = res.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        throw new Error(`Server error (${res.status}). Please try again.`);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload document');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsManageKeys.all });
      toast.success('Document uploaded successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Upload failed');
    },
  });
}
