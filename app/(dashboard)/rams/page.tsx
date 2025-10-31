'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Search, FileText, CheckCircle2, Clock, Settings } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { formatFileSize } from '@/lib/utils/file-validation';

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
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">RAMS Documents</h1>
          <p className="text-muted-foreground mt-1">
            {isManager || isAdmin 
              ? 'View and manage risk assessments & method statements'
              : 'Review and sign safety documents'
            }
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Manage RAMS link for managers/admins */}
          {(isManager || isAdmin) && (
            <Button asChild variant="default">
              <Link href="/rams/manage">
                <Settings className="h-4 w-4 mr-2" />
                Manage RAMS Documents
              </Link>
            </Button>
          )}

          {/* Pending count badge for employees */}
          {!isManager && !isAdmin && pendingCount > 0 && (
            <Badge variant="destructive" className="text-lg px-4 py-2">
              {pendingCount} to sign
            </Badge>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            onClick={() => setStatusFilter('all')}
          >
            All
          </Button>
          <Button
            variant={statusFilter === 'pending' ? 'default' : 'outline'}
            onClick={() => setStatusFilter('pending')}
          >
            Pending
          </Button>
          <Button
            variant={statusFilter === 'signed' ? 'default' : 'outline'}
            onClick={() => setStatusFilter('signed')}
          >
            Signed
          </Button>
        </div>
      </div>

      {/* Documents List */}
      {filteredDocuments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              {searchQuery
                ? 'No documents match your search'
                : 'No RAMS documents assigned to you yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredDocuments.map((doc) => (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
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

                  <Button asChild>
                    <Link href={`/rams/${doc.id}/read`}>
                      {doc.assignment_status === 'signed' ? 'View Document' : 'Read & Sign'}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

