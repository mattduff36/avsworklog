'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  FileText,
  Users,
  CheckCircle2,
  Clock,
  Eye,
  Download,
  FileDown,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { BackButton } from '@/components/ui/back-button';
import { formatDistanceToNow } from 'date-fns';
import { AssignEmployeesModal } from '@/components/rams/AssignEmployeesModal';
import { formatFileSize } from '@/lib/utils/file-validation';

interface RAMSDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  created_at: string;
  uploader_name?: string;
}

interface Assignment {
  id: string;
  employee_id: string;
  status: 'pending' | 'read' | 'signed';
  assigned_at: string;
  read_at: string | null;
  signed_at: string | null;
  employee: {
    id: string;
    full_name: string;
    role: string;
  };
}

interface VisitorSignature {
  id: string;
  visitor_name: string;
  visitor_company: string | null;
  visitor_role: string | null;
  signed_at: string;
  recorded_by: string;
  recorder: {
    full_name: string;
  };
}

export default function RAMSDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const documentId = params.id as string;

  const [ramsDocument, setRamsDocument] = useState<RAMSDocument | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [visitorSignatures, setVisitorSignatures] = useState<VisitorSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignModalOpen, setAssignModalOpen] = useState(false);

  const supabase = createClient();

  // Redirect non-managers/admins
  useEffect(() => {
    if (!authLoading && !isManager && !isAdmin) {
      router.push('/rams');
    }
  }, [isManager, isAdmin, authLoading, router]);

  useEffect(() => {
    // Only fetch if auth is loaded and user IS a manager/admin
    if (!authLoading && (isManager || isAdmin) && documentId) {
      fetchDocumentDetails();
    }
  }, [documentId, authLoading, isManager, isAdmin]);

  const fetchDocumentDetails = async () => {
    setLoading(true);
    try {
      // Fetch document - use maybeSingle() instead of single() to handle 0 rows gracefully
      const { data: doc, error: docError } = await supabase
        .from('rams_documents')
        .select(`
          *,
          uploader:profiles!rams_documents_uploaded_by_fkey(full_name)
        `)
        .eq('id', documentId)
        .maybeSingle();

      if (docError) {
        console.error('Error fetching document:', {
          error: docError,
          message: docError.message,
          code: docError.code,
          details: docError.details,
          hint: docError.hint,
          documentId
        });
        setLoading(false);
        return;
      }

      if (!doc) {
        console.error('Document not found or no permission. ID:', documentId);
        setLoading(false);
        return;
      }

      setRamsDocument({
        ...doc,
        uploader_name: doc.uploader?.full_name || 'Unknown',
      });

      // Fetch assignments
      const { data: assignData, error: assignError } = await supabase
        .from('rams_assignments')
        .select(`
          *,
          employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role)
        `)
        .eq('rams_document_id', documentId)
        .order('assigned_at', { ascending: false });

      if (!assignError && assignData) {
        setAssignments(assignData);
      }

      // Fetch visitor signatures
      const { data: visitorData, error: visitorError } = await supabase
        .from('rams_visitor_signatures')
        .select(`
          *,
          recorder:profiles!rams_visitor_signatures_recorded_by_fkey(full_name)
        `)
        .eq('rams_document_id', documentId)
        .order('signed_at', { ascending: false });

      if (!visitorError && visitorData) {
        setVisitorSignatures(visitorData);
      }
    } catch (error) {
      console.error('Error fetching document details:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignSuccess = () => {
    setAssignModalOpen(false);
    fetchDocumentDetails();
  };

  const downloadDocument = async () => {
    if (!ramsDocument) return;

    try {
      const { data } = await supabase.storage
        .from('rams-documents')
        .createSignedUrl(ramsDocument.file_path, 3600);

      if (data?.signedUrl) {
        // Use proper download method that works on mobile
        // Fetch the file and create a blob URL for download
        const response = await fetch(data.signedUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ramsDocument.file_name || 'rams-document.pdf';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      // Fallback to opening in new tab if download fails
      try {
        const { data } = await supabase.storage
          .from('rams-documents')
          .createSignedUrl(ramsDocument.file_path, 3600);
        if (data?.signedUrl) {
          window.open(data.signedUrl, '_blank');
        }
      } catch (fallbackError) {
        console.error('Fallback download also failed:', fallbackError);
      }
    }
  };

  const exportPDF = async () => {
    if (!ramsDocument) return;

    try {
      const response = await fetch(`/api/rams/${documentId}/export`);
      
      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ramsDocument.title.replace(/[^a-z0-9]/gi, '_')}_signatures.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting PDF:', error);
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

  if (!ramsDocument) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-slate-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Document not found</h3>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            This document may have been deleted or you don&apos;t have permission to view it.
          </p>
          <BackButton userRole={{ isManager, isAdmin }} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalAssigned = assignments.length;
  const totalSigned = assignments.filter(a => a.status === 'signed').length;
  const totalPending = assignments.filter(a => a.status === 'pending' || a.status === 'read').length;
  const complianceRate = totalAssigned > 0 ? Math.round((totalSigned / totalAssigned) * 100) : 0;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <BackButton userRole={{ isManager, isAdmin }} />
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">{ramsDocument.title}</h1>
              <p className="text-slate-600 dark:text-slate-400">
                Uploaded {formatDistanceToNow(new Date(ramsDocument.created_at), { addSuffix: true })} by{' '}
                {ramsDocument.uploader_name}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={exportPDF}
              className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            <Button 
              variant="outline" 
              onClick={downloadDocument}
              className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button 
              onClick={() => setAssignModalOpen(true)}
              className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95"
            >
              <Users className="h-4 w-4 mr-2" />
              Assign Employees
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-2 md:gap-4 grid-cols-4 md:grid-cols-4">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-1 md:p-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0.5 md:pb-2 p-1 md:p-6">
            <CardTitle className="text-[10px] md:text-sm font-medium text-slate-900 dark:text-white leading-tight">Total Assigned</CardTitle>
            <Users className="h-2.5 w-2.5 md:h-4 md:w-4 text-slate-400" />
          </CardHeader>
          <CardContent className="p-1 md:p-6 pt-0">
            <div className="text-sm md:text-2xl font-bold text-slate-900 dark:text-white">{totalAssigned}</div>
            <p className="text-[9px] md:text-xs text-slate-600 dark:text-slate-400 leading-tight">Employees</p>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-1 md:p-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0.5 md:pb-2 p-1 md:p-6">
            <CardTitle className="text-[10px] md:text-sm font-medium text-slate-900 dark:text-white leading-tight">Signed</CardTitle>
            <CheckCircle2 className="h-2.5 w-2.5 md:h-4 md:w-4 text-green-400" />
          </CardHeader>
          <CardContent className="p-1 md:p-6 pt-0">
            <div className="text-sm md:text-2xl font-bold text-green-600">{totalSigned}</div>
            <p className="text-[9px] md:text-xs text-muted-foreground leading-tight">Completed</p>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-1 md:p-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0.5 md:pb-2 p-1 md:p-6">
            <CardTitle className="text-[10px] md:text-sm font-medium text-slate-900 dark:text-white leading-tight">Pending</CardTitle>
            <Clock className="h-2.5 w-2.5 md:h-4 md:w-4 text-orange-400" />
          </CardHeader>
          <CardContent className="p-1 md:p-6 pt-0">
            <div className="text-sm md:text-2xl font-bold text-orange-600">{totalPending}</div>
            <p className="text-[9px] md:text-xs text-slate-600 dark:text-slate-400 leading-tight">Awaiting signature</p>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-1 md:p-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0.5 md:pb-2 p-1 md:p-6">
            <CardTitle className="text-[10px] md:text-sm font-medium text-slate-900 dark:text-white leading-tight">Compliance</CardTitle>
            <FileText className="h-2.5 w-2.5 md:h-4 md:w-4 text-slate-400" />
          </CardHeader>
          <CardContent className="p-1 md:p-6 pt-0">
            <div className="text-sm md:text-2xl font-bold text-slate-900 dark:text-white">{complianceRate}%</div>
            <p className="text-[9px] md:text-xs text-slate-600 dark:text-slate-400 leading-tight">Completion rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Document Info */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <CardTitle className="text-slate-900 dark:text-white">Document Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ramsDocument.description && (
            <div>
              <span className="font-semibold text-slate-900 dark:text-white">Description: </span>
              <span className="text-slate-600 dark:text-slate-400">{ramsDocument.description}</span>
            </div>
          )}
          <div>
            <span className="font-semibold text-slate-900 dark:text-white">File: </span>
            <span className="text-slate-600 dark:text-slate-400">
              {ramsDocument.file_name} ({ramsDocument.file_type.toUpperCase()} •{' '}
              {formatFileSize(ramsDocument.file_size)})
            </span>
          </div>
          <div>
            <span className="font-semibold text-slate-900 dark:text-white">Created: </span>
            <span className="text-slate-600 dark:text-slate-400">
              {new Date(ramsDocument.created_at).toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="employees" className="space-y-4">
        <TabsList>
          <TabsTrigger value="employees">
            <Users className="h-4 w-4 mr-2" />
            Employees ({totalAssigned})
          </TabsTrigger>
          <TabsTrigger value="visitors">
            <UserPlus className="h-4 w-4 mr-2" />
            Visitors ({visitorSignatures.length})
          </TabsTrigger>
        </TabsList>

        {/* Employees Tab */}
        <TabsContent value="employees" className="space-y-4">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white">Employee Assignments</CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400">
                Track which employees have been assigned and signed this RAMS document
              </CardDescription>
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No employees assigned yet</p>
                  <Button
                    onClick={() => setAssignModalOpen(true)}
                    className="mt-4"
                    variant="outline"
                  >
                    Assign Employees
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Signed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map(assignment => (
                      <TableRow key={assignment.id}>
                        <TableCell className="font-medium">
                          {assignment.employee.full_name}
                        </TableCell>
                        <TableCell className="capitalize">
                          {assignment.employee.role}
                        </TableCell>
                        <TableCell>
                          {assignment.status === 'signed' ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Signed
                            </Badge>
                          ) : assignment.status === 'read' ? (
                            <Badge variant="secondary" className="gap-1">
                              <Eye className="h-3 w-3" />
                              Read
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <Clock className="h-3 w-3" />
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(assignment.assigned_at), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell>
                          {assignment.signed_at
                            ? formatDistanceToNow(new Date(assignment.signed_at), {
                                addSuffix: true,
                              })
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Visitors Tab */}
        <TabsContent value="visitors" className="space-y-4">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white">Visitor Signatures</CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400">
                Signatures captured from visitors and contractors
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visitorSignatures.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No visitor signatures recorded yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Visitor Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Signed</TableHead>
                      <TableHead>Recorded By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visitorSignatures.map(signature => (
                      <TableRow key={signature.id}>
                        <TableCell className="font-medium">
                          {signature.visitor_name}
                        </TableCell>
                        <TableCell>{signature.visitor_company || '-'}</TableCell>
                        <TableCell>{signature.visitor_role || '-'}</TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(signature.signed_at), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell>{signature.recorder.full_name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Assign Modal */}
      <AssignEmployeesModal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        onSuccess={handleAssignSuccess}
        documentId={documentId}
        documentTitle={ramsDocument.title}
      />
    </div>
  );
}

