'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Search, FileText, CheckCircle2, Clock, Settings, Plus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { formatFileSize } from '@/lib/utils/file-validation';
import { RecordVisitorSignatureModal } from '@/components/rams/RecordVisitorSignatureModal';

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
  assignment_status?: 'pending' | 'read' | 'signed';
  assigned_at?: string;
  signed_at?: string;
}

export default function RAMSPage() {
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const [documents, setDocuments] = useState<RAMSDocument[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<RAMSDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'signed'>('all');
  const [visitorSignModalOpen, setVisitorSignModalOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedDocumentTitle, setSelectedDocumentTitle] = useState<string>('');

  const supabase = createClient();

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      // Fetch documents for all users (API handles permissions)
      const response = await fetch('/api/rams');
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
    // Fetch documents once auth is loaded
    if (!authLoading) {
      fetchDocuments();
    }
  }, [authLoading]);

  useEffect(() => {
    let filtered = documents;

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(doc => {
        if (statusFilter === 'pending') {
          return doc.assignment_status === 'pending' || doc.assignment_status === 'read';
        }
        return doc.assignment_status === statusFilter;
      });
    }

    setFilteredDocuments(filtered);
  }, [searchQuery, documents, statusFilter]);

  const pendingCount = documents.filter(doc => 
    doc.assignment_status === 'pending' || doc.assignment_status === 'read'
  ).length;

  // Show loading while checking auth
  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">RAMS Documents</h1>
            <p className="text-slate-600 dark:text-slate-400">
              {isManager || isAdmin 
                ? 'View and manage risk assessments & method statements'
                : 'Review and sign safety documents'
              }
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Manage RAMS link for managers/admins */}
            {(isManager || isAdmin) && (
              <Link href="/rams/manage">
                <Button className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage RAMS
                </Button>
              </Link>
            )}

            {/* Pending count badge for employees */}
            {!isManager && !isAdmin && pendingCount > 0 && (
              <Badge variant="destructive" className="text-lg px-4 py-2">
                {pendingCount} to sign
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                className={statusFilter === 'all' ? 'bg-rams hover:bg-rams-dark text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-700/50'}
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'pending' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('pending')}
                className={statusFilter === 'pending' ? 'bg-rams hover:bg-rams-dark text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-700/50'}
              >
                Pending
              </Button>
              <Button
                variant={statusFilter === 'signed' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('signed')}
                className={statusFilter === 'signed' ? 'bg-rams hover:bg-rams-dark text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-700/50'}
              >
                Signed
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      {filteredDocuments.length === 0 ? (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No documents found</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4 text-center">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search or filters'
                : 'No documents have been assigned to you yet'
              }
            </p>
            {(isManager || isAdmin) && !searchQuery && statusFilter === 'all' && (
              <Link href="/rams/manage">
                <Button className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage RAMS Documents
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredDocuments.map((doc) => (
            <Card key={doc.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-rams/50 transition-all duration-200 cursor-pointer">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-primary" />
                      <CardTitle className="text-xl">{doc.title}</CardTitle>
                      <Badge
                        variant={
                          doc.assignment_status === 'signed'
                            ? 'default'
                            : 'destructive'
                        }
                      >
                        {doc.assignment_status === 'signed' ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Signed
                          </>
                        ) : (
                          <>
                            <Clock className="h-3 w-3 mr-1" />
                            Needs Signature
                          </>
                        )}
                      </Badge>
                    </div>
                    {doc.description && (
                      <CardDescription className="mt-2">{doc.description}</CardDescription>
                    )}
                  </div>
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
                    {doc.assigned_at && (
                      <span>
                        Assigned {formatDistanceToNow(new Date(doc.assigned_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Link href={`/rams/${doc.id}/read`}>
                      <Button className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95">
                        {doc.assignment_status === 'signed' ? 'View Document' : 'Read & Sign'}
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedDocumentId(doc.id);
                        setSelectedDocumentTitle(doc.title);
                        setVisitorSignModalOpen(true);
                      }}
                      disabled={doc.assignment_status !== 'signed'}
                      className="border-rams text-rams hover:bg-rams hover:text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-rams"
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Record Visitor
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Visitor Signature Modal */}
      {selectedDocumentId && (
        <RecordVisitorSignatureModal
          open={visitorSignModalOpen}
          onClose={() => {
            setVisitorSignModalOpen(false);
            setSelectedDocumentId(null);
            setSelectedDocumentTitle('');
          }}
          onSuccess={() => {
            setVisitorSignModalOpen(false);
            setSelectedDocumentId(null);
            setSelectedDocumentTitle('');
            fetchDocuments(); // Refresh the documents list
          }}
          documentId={selectedDocumentId}
          documentTitle={selectedDocumentTitle}
        />
      )}
    </div>
  );
}

