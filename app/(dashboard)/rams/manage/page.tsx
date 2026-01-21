'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, Search, FileText, Users, Trash2 } from 'lucide-react';
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

  const supabase = createClient();

  // Redirect non-managers/admins to employee view
  useEffect(() => {
    if (!authLoading && !isManager && !isAdmin) {
      router.push('/rams');
    }
  }, [isManager, isAdmin, authLoading, router]);

  const fetchDocuments = async () => {
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
  };

  useEffect(() => {
    // Only fetch if auth is loaded and user IS a manager/admin
    if (!authLoading && (isManager || isAdmin)) {
      fetchDocuments();
    }
  }, [authLoading, isManager, isAdmin]);

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

  const handleUploadSuccess = () => {
    setUploadModalOpen(false);
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
              <h1 className="text-3xl font-bold text-foreground mb-2">Manage RAMS Documents</h1>
              <p className="text-muted-foreground">
                Upload and manage Risk Assessment & Method Statement documents
              </p>
            </div>
          </div>

          <Button 
            onClick={() => setUploadModalOpen(true)} 
            className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload RAMS
          </Button>
        </div>
      </div>

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
                : 'Upload your first RAMS document to get started'}
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
                        {doc.total_signed}/{doc.total_assigned} signed
                      </span>
                    </div>
                    <Link href={`/rams/${doc.id}?from=/rams/manage`}>
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
        onClose={() => setUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete RAMS Document</AlertDialogTitle>
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

