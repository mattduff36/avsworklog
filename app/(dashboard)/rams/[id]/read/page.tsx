'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, FileText, Download, CheckCircle2, Mail, ExternalLink, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { SignRAMSModal } from '@/components/rams/SignRAMSModal';
import { toast } from 'sonner';
import { RAMSErrorBoundary } from '@/components/rams/RAMSErrorBoundary';

interface RAMSDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_type: 'pdf' | 'docx';
  created_at: string;
}

interface Assignment {
  id: string;
  status: 'pending' | 'read' | 'signed';
  signed_at: string | null;
  signature_data: string | null;
  action_taken: string | null;
}

type ActionType = 'downloaded' | 'opened' | 'emailed' | null;

export default function ReadRAMSPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.id as string;
  
  const [ramsDocument, setRamsDocument] = useState<RAMSDocument | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [actionTaken, setActionTaken] = useState<ActionType>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const supabase = createClient();

  useEffect(() => {
    fetchDocument();
  }, [documentId]);

  const fetchDocument = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get user session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      // Fetch document
      const { data: doc, error: docError } = await supabase
        .from('rams_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        const errorMessage = docError instanceof Error ? docError.message : 
                           docError?.message || 'Document not found';
        console.error('Error fetching RAMS document:', {
          message: errorMessage,
          documentId,
          error: docError,
          timestamp: new Date().toISOString()
        });
        setError('Document not found or you do not have permission to view it');
        return;
      }

      setRamsDocument(doc);

      // Fetch assignment (for employees)
      const { data: assignmentData } = await supabase
        .from('rams_assignments')
        .select('*')
        .eq('rams_document_id', documentId)
        .eq('employee_id', session.user.id)
        .single();

      if (assignmentData) {
        setAssignment(assignmentData);
        // If action was already taken, enable sign button
        if (assignmentData.action_taken) {
          setActionTaken(assignmentData.action_taken as ActionType);
        }
      }

      // Get file URL from storage
      const { data: urlData } = await supabase.storage
        .from('rams-documents')
        .createSignedUrl(doc.file_path, 3600); // 1 hour

      if (urlData?.signedUrl) {
        setFileUrl(urlData.signedUrl);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error loading RAMS document:', {
        message: errorMessage,
        documentId,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        timestamp: new Date().toISOString()
      });
      setError('Failed to load document. Please try refreshing the page.');
    } finally {
      setLoading(false);
    }
  };

  const recordAction = async (action: 'downloaded' | 'opened' | 'emailed', requireAssignment: boolean = true) => {
    // For signed documents, we don't require assignment to exist
    if (requireAssignment && !assignment) return;

    // For signed documents, we can still track the action but don't update status
    if (assignment) {
      try {
        const updateData: any = {
          action_taken: action,
        };

        // Only update status and read_at if not already signed
        if (assignment.status !== 'signed') {
          updateData.status = 'read';
          updateData.read_at = new Date().toISOString();
        }

        const { error: updateError } = await supabase
          .from('rams_assignments')
          .update(updateData)
          .eq('id', assignment.id);

        if (updateError) {
          const errorMessage = updateError instanceof Error ? updateError.message : 
                             updateError?.message || 'Unknown error';
          console.error('Error recording RAMS action:', {
            message: errorMessage,
            assignmentId: assignment.id,
            action,
            error: updateError,
            timestamp: new Date().toISOString()
          });
          return;
        }

        setActionTaken(action);
        setAssignment(prev => prev ? { 
          ...prev, 
          action_taken: action,
          ...(prev.status !== 'signed' ? {
            status: 'read' as const,
            read_at: new Date().toISOString()
          } : {})
        } : null);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error recording RAMS action (outer catch):', {
          message: errorMessage,
          assignmentId: assignment?.id,
          action,
          error: error instanceof Error ? {
            name: error.name,
            message: error.message
          } : error,
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  const handleDownload = async () => {
    if (!fileUrl || !ramsDocument) return;

    setActionInProgress('download');
    setError(null);

    try {
      // Fetch the file and create a blob URL for download
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Failed to fetch file');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = ramsDocument.file_name || 'rams-document.pdf';
      window.document.body.appendChild(a);
      a.click();
      
      // Clean up
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        window.document.body.removeChild(a);
      }, 100);
      
      // Record action (only if assignment exists, not required for signed docs)
      await recordAction('downloaded', !!assignment);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error downloading RAMS document:', {
        message: errorMessage,
        documentId,
        documentTitle: ramsDocument?.title,
        action: 'download',
        error: error instanceof Error ? {
          name: error.name,
          message: error.message
        } : error,
        timestamp: new Date().toISOString()
      });
      setError('Failed to download document. Please try again or select a different option.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleOpen = async () => {
    if (!fileUrl) return;

    setActionInProgress('open');
    setError(null);

    try {
      // Open in new tab
      const newWindow = window.open(fileUrl, '_blank');
      
      // Check if popup was blocked (null means blocked, undefined means browser doesn't support)
      if (!newWindow || typeof newWindow.closed === 'undefined') {
        throw new Error('Failed to open document. Please check your popup blocker settings.');
      }

      // On mobile browsers, window.closed becomes true immediately even when PDF opens successfully
      // So we only check if the window failed to open initially (popup blocker)
      // We don't do a delayed check as it's unreliable on mobile devices
      
      // Record action (only if assignment exists, not required for signed docs)
      // Small delay to ensure the window has started loading
      await new Promise(resolve => setTimeout(resolve, 500));
      await recordAction('opened', !!assignment);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 
                          typeof error === 'string' ? error : 'Unknown error';
      console.error('Error opening RAMS document:', {
        message: errorMessage,
        documentId,
        documentTitle: ramsDocument?.title,
        action: 'open',
        error: error instanceof Error ? {
          name: error.name,
          message: error.message
        } : error,
        timestamp: new Date().toISOString()
      });
      setError(errorMessage || 'Failed to open document. Please try again or select a different option.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleEmail = async () => {
    if (!ramsDocument) return;

    setActionInProgress('email');
    setError(null);

    try {
      const response = await fetch(`/api/rams/${documentId}/email`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send email');
      }

      // Show success notification
      toast.success('Email sent successfully - check your inbox to view the document');

      // Record action (only if assignment exists, not required for signed docs)
      await recordAction('emailed', !!assignment);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 
                          typeof error === 'string' ? error : 'Unknown error';
      console.error('Error sending RAMS email:', {
        message: errorMessage,
        documentId,
        documentTitle: ramsDocument?.title,
        action: 'email',
        error: error instanceof Error ? {
          name: error.name,
          message: error.message
        } : error,
        timestamp: new Date().toISOString()
      });
      setError(errorMessage || 'Failed to send email. Please try again or select a different option.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSignSuccess = () => {
    setSignModalOpen(false);
    fetchDocument(); // Refresh to show signed status
    router.push('/rams');
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ramsDocument) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-12 text-center">
          <div className="p-4 rounded-full bg-red-100 dark:bg-red-900/20 w-24 h-24 flex items-center justify-center mx-auto mb-4">
            <FileText className="h-12 w-12 text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Document not found</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6">The document you're looking for doesn't exist or has been removed.</p>
          <Button asChild className="bg-rams hover:bg-rams-dark text-white">
            <Link href="/rams">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to RAMS
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const isSigned = assignment?.status === 'signed';
  const canSign = assignment && !isSigned;
  const canTakeAction = canSign && !actionTaken;
  // For signed documents, allow viewing without requiring action tracking
  const canViewSigned = isSigned;

  return (
    <RAMSErrorBoundary>
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="container mx-auto px-4 py-4 max-w-6xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <Button asChild variant="ghost" size="sm" className="hover:bg-slate-800/50 text-slate-300 hover:text-white">
                <Link href="/rams">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{ramsDocument.title}</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {ramsDocument.file_type.toUpperCase()} Document
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!isSigned && actionTaken && (
                <Badge variant="outline" className="gap-1">
                  {actionTaken === 'downloaded' && 'Downloaded'}
                  {actionTaken === 'opened' && 'Opened'}
                  {actionTaken === 'emailed' && 'Viewed via email'}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-slate-100 dark:bg-slate-900">
        <div className="container mx-auto py-8 max-w-4xl px-4">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-8 md:p-12">
            <div className="text-center space-y-6 max-w-2xl mx-auto">

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons - For unsigned documents */}
              {canTakeAction && (
                <div className="space-y-4 pt-6">
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    Please choose how you would like to access this document:
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Download Button */}
                    <Button
                      size="lg"
                      onClick={handleDownload}
                      disabled={actionInProgress !== null}
                      className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed h-auto py-6 flex flex-col items-center gap-2"
                    >
                      {actionInProgress === 'download' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Download className="h-5 w-5" />
                      )}
                      <span>Download</span>
                    </Button>

                    {/* Open Button */}
                    <Button
                      size="lg"
                      onClick={handleOpen}
                      disabled={actionInProgress !== null}
                      className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed h-auto py-6 flex flex-col items-center gap-2"
                    >
                      {actionInProgress === 'open' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-5 w-5" />
                      )}
                      <span>Open</span>
                    </Button>

                    {/* Email Button */}
                    <Button
                      size="lg"
                      onClick={handleEmail}
                      disabled={actionInProgress !== null}
                      className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed h-auto py-6 flex flex-col items-center gap-2"
                    >
                      {actionInProgress === 'email' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Mail className="h-5 w-5" />
                      )}
                      <span>Email</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Action Buttons - For signed documents (view again) */}
              {canViewSigned && (
                <div className="space-y-4 pt-6">
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    Choose how you would like to access this document:
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Download Button */}
                    <Button
                      size="lg"
                      onClick={handleDownload}
                      disabled={actionInProgress !== null}
                      className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed h-auto py-6 flex flex-col items-center gap-2"
                    >
                      {actionInProgress === 'download' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Download className="h-5 w-5" />
                      )}
                      <span>Download</span>
                    </Button>

                    {/* Open Button */}
                    <Button
                      size="lg"
                      onClick={handleOpen}
                      disabled={actionInProgress !== null}
                      className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed h-auto py-6 flex flex-col items-center gap-2"
                    >
                      {actionInProgress === 'open' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-5 w-5" />
                      )}
                      <span>Open</span>
                    </Button>

                    {/* Email Button */}
                    <Button
                      size="lg"
                      onClick={handleEmail}
                      disabled={actionInProgress !== null}
                      className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed h-auto py-6 flex flex-col items-center gap-2"
                    >
                      {actionInProgress === 'email' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Mail className="h-5 w-5" />
                      )}
                      <span>Email</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Sign Button */}
              {canSign && actionTaken && (
                <div className="mt-4 pt-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                    You have accessed this document via <strong>{actionTaken === 'downloaded' ? 'download' : actionTaken === 'opened' ? 'opening in browser' : 'email'}</strong>. 
                    Please review it carefully, then click below to sign and acknowledge that you have read and understood the safety requirements.
                  </p>
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                    <Button
                      size="lg"
                      onClick={() => {
                        // Double-check assignment status before opening modal
                        if (assignment?.status === 'signed') {
                          toast.error('This document has already been signed');
                          fetchDocument(); // Refresh to show current state
                          return;
                        }
                        setSignModalOpen(true);
                      }}
                      className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg text-base px-8 py-6"
                    >
                      <CheckCircle2 className="h-5 w-5 mr-2" />
                      I have read and understood - Sign Document
                    </Button>
                  </div>
                </div>
              )}

              {/* Already Signed Message */}
              {isSigned && (
                <div className="mt-8 pt-8 border-t border-slate-700">
                  <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
                    <p className="text-sm font-medium text-green-300">
                      ✓ You have signed this document on {assignment?.signed_at ? new Date(assignment.signed_at).toLocaleDateString() : 'previously'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Sign Modal */}
      {assignment && (
        <SignRAMSModal
          open={signModalOpen}
          onClose={() => setSignModalOpen(false)}
          onSuccess={handleSignSuccess}
          assignmentId={assignment.id}
          documentTitle={ramsDocument.title}
        />
      )}

    </div>
    </RAMSErrorBoundary>
  );
}
