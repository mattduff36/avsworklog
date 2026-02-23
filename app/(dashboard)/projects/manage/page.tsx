'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, Search, FileText, Users, Trash2, Settings, Star, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { BackButton } from '@/components/ui/back-button';
import { formatDistanceToNow } from 'date-fns';
import { UploadRAMSModal } from '@/components/rams/UploadRAMSModal';
import { formatFileSize } from '@/lib/utils/file-validation';
import { toast } from 'sonner';
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

interface RAMSDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_size: number;
  file_type: string;
  created_at: string;
  uploader_name?: string;
  total_assigned?: number;
  total_signed?: number;
  total_pending?: number;
  document_type_name?: string | null;
  required_signature?: boolean;
}

export default function RAMSManagePage() {
  const router = useRouter();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const [documents, setDocuments] = useState<RAMSDocument[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<RAMSDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  // Favourites
  interface Favourite {
    id: string;
    document_id: string;
    document: RAMSDocument & { document_type?: { id: string; name: string } | null };
  }
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [reuseDoc, setReuseDoc] = useState<{ title: string; description: string; typeId: string } | null>(null);

  const supabase = createClient();

  // Redirect non-managers/admins to employee view
  useEffect(() => {
    if (!authLoading && !isManager && !isAdmin) {
      router.push('/projects');
    }
  }, [isManager, isAdmin, authLoading, router]);

  const fetchDocuments = useCallback(async () => {
    // Don't fetch if user is not manager/admin (they'll be redirected)
    if (!isManager && !isAdmin) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/rams?all=true');
      const data = await response.json();

      if (data.success) {
        setDocuments(data.documents);
        setFilteredDocuments(data.documents);
      }
    } catch (error) {
      console.error('Error fetching RAMS documents:', error);
    } finally {
      setLoading(false);
    }
  }, [isManager, isAdmin]);

  useEffect(() => {
    if (!authLoading && (isManager || isAdmin)) {
      fetchDocuments();
    }
  }, [authLoading, isManager, isAdmin, fetchDocuments]);

  useEffect(() => {
    let filtered = documents;

    if (searchQuery) {
      filtered = filtered.filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredDocuments(filtered);
  }, [searchQuery, documents]);

  const fetchFavourites = useCallback(async () => {
    try {
      const res = await fetch('/api/projects/favourites');
      const data = await res.json();
      if (data.success) {
        setFavourites(data.favourites || []);
      }
    } catch (error) {
      console.error('Error fetching favourites:', error);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && (isManager || isAdmin)) {
      fetchFavourites();
    }
  }, [authLoading, isManager, isAdmin, fetchFavourites]);

  const handleReuse = (fav: Favourite) => {
    setReuseDoc({
      title: fav.document.title,
      description: fav.document.description || '',
      typeId: fav.document.document_type_id || (fav.document as any).document_type?.id || '',
    });
    setUploadModalOpen(true);
  };

  const handleRemoveFavourite = async (documentId: string) => {
    try {
      const res = await fetch(`/api/projects/favourites?document_id=${documentId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Removed from favourites');
        fetchFavourites();
      }
    } catch (error) {
      console.error('Error removing favourite:', error);
    }
  };

  const handleUploadSuccess = () => {
    setUploadModalOpen(false);
    setReuseDoc(null);
    fetchDocuments();
  };

  const openDeleteDialog = (e: React.MouseEvent, document: RAMSDocument) => {
    e.preventDefault();
    e.stopPropagation();
    setDocumentToDelete({
      id: document.id,
      title: document.title,
    });
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!documentToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/rams/${documentToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete document');
      }

      toast.success('Document deleted successfully');
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete document');
    } finally {
      setDeleting(false);
    }
  };

  // Show loading while checking auth or redirecting
  if (authLoading || (!isManager && !isAdmin) || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">Manage Projects</h1>
              <p className="text-muted-foreground">
                Upload and manage project documents
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/projects/settings">
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </Link>
            <Button 
              onClick={() => setUploadModalOpen(true)} 
              className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </Button>
          </div>
        </div>
      </div>

      {/* Favourites Section */}
      {favourites.length > 0 && (
        <Card className="bg-white dark:bg-slate-900 border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
              <CardTitle className="text-lg text-foreground">Favourites</CardTitle>
            </div>
            <CardDescription className="text-muted-foreground">
              Quickly reuse previously uploaded documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {favourites.map((fav) => (
                <div
                  key={fav.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-rams/50 transition-all duration-200"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{fav.document.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {(fav.document as any).document_type?.name || 'No type'}
                        {' '}&middot;{' '}
                        {fav.document.file_type?.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleReuse(fav)}
                      className="bg-rams hover:bg-rams-dark text-white"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Reuse
                    </Button>
                    <Link href={`/projects/${fav.document_id}?from=/projects/manage`}>
                      <Button size="sm" variant="outline">
                        View
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveFavourite(fav.document_id)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                      title="Remove from favourites"
                    >
                      <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <Card className="">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 bg-white dark:bg-slate-900 border-border text-foreground"
            />
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      {filteredDocuments.length === 0 ? (
        <Card className="">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No documents found</h3>
            <p className="text-muted-foreground mb-4 text-center">
              {searchQuery
                ? 'Try adjusting your search'
                : 'Upload your first project document to get started'}
            </p>
            {!searchQuery && (
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
        <div className="grid gap-4">
          {filteredDocuments.map((doc) => (
            <Card 
              key={doc.id} 
              className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-rams/50 transition-all duration-200"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-primary" />
                      <CardTitle className="text-xl">{doc.title}</CardTitle>
                      {doc.document_type_name && (
                        <Badge variant="outline" className="text-xs">
                          {doc.document_type_name}
                        </Badge>
                      )}
                    </div>
                    {doc.description && (
                      <CardDescription className="mt-2">{doc.description}</CardDescription>
                    )}
                  </div>
                  <Button
                    onClick={(e) => openDeleteDialog(e, doc)}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                    title="Delete document"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span>
                      {doc.file_type.toUpperCase()} • {formatFileSize(doc.file_size)}
                    </span>
                    <span>
                      Uploaded {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                    </span>
                    {doc.uploader_name && (
                      <span>by {doc.uploader_name}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>
                        {doc.total_signed}/{doc.total_assigned} {doc.required_signature === false ? 'read' : 'signed'}
                      </span>
                    </div>
                    <Link href={`/projects/${doc.id}?from=/projects/manage`}>
                      <Button className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95">
                        View Details
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Document</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-semibold">{documentToDelete?.title}</span>?
              <br />
              <br />
              This action cannot be undone. The document and all associated signatures will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

