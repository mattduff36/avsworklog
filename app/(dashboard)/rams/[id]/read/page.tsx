'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, FileText, Download, CheckCircle2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { SignRAMSModal } from '@/components/rams/SignRAMSModal';
import { RecordVisitorSignatureModal } from '@/components/rams/RecordVisitorSignatureModal';

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
}

export default function ReadRAMSPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.id as string;
  
  const [document, setDocument] = useState<RAMSDocument | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showSignButton, setShowSignButton] = useState(false);
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [visitorSignModalOpen, setVisitorSignModalOpen] = useState(false);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchDocument();
  }, [documentId]);

  useEffect(() => {
    if (fileUrl && document?.file_type === 'pdf') {
      // For PDFs in iframe, we'll show the sign button after a delay
      // since we can't track scroll in iframe
      const timer = setTimeout(() => {
        setShowSignButton(true);
      }, 5000); // Show after 5 seconds

      return () => clearTimeout(timer);
    }
  }, [fileUrl, document?.file_type]);

  useEffect(() => {
    // Track scroll for non-iframe content
    const handleScroll = () => {
      if (!viewerRef.current) return;

      const element = viewerRef.current;
      const scrollTop = element.scrollTop;
      const scrollHeight = element.scrollHeight - element.clientHeight;
      const progress = (scrollTop / scrollHeight) * 100;

      setScrollProgress(progress);

      // Show sign button when scrolled to 90% or more
      if (progress >= 90) {
        setShowSignButton(true);
        markAsRead();
      }
    };

    const viewer = viewerRef.current;
    if (viewer) {
      viewer.addEventListener('scroll', handleScroll);
      return () => viewer.removeEventListener('scroll', handleScroll);
    }
  }, [viewerRef.current]);

  const fetchDocument = async () => {
    try {
      setLoading(true);

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
        console.error('Error fetching document:', docError);
        return;
      }

      setDocument(doc);

      // Fetch assignment (for employees)
      const { data: assignmentData } = await supabase
        .from('rams_assignments')
        .select('*')
        .eq('rams_document_id', documentId)
        .eq('employee_id', session.user.id)
        .single();

      if (assignmentData) {
        setAssignment(assignmentData);
      }

      // Get file URL from storage
      const { data: urlData } = await supabase.storage
        .from('rams-documents')
        .createSignedUrl(doc.file_path, 3600); // 1 hour

      if (urlData?.signedUrl) {
        setFileUrl(urlData.signedUrl);
      }

    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async () => {
    if (!assignment || assignment.status !== 'pending') return;

    try {
      await supabase
        .from('rams_assignments')
        .update({
          status: 'read',
          read_at: new Date().toISOString(),
        })
        .eq('id', assignment.id);

      setAssignment(prev => prev ? { ...prev, status: 'read' } : null);
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const handleSignSuccess = () => {
    setSignModalOpen(false);
    fetchDocument(); // Refresh to show signed status
    router.push('/rams');
  };

  const handleVisitorSignSuccess = () => {
    setVisitorSignModalOpen(false);
    // Could show a success message or update UI
  };

  const handleDownload = async (e?: React.MouseEvent<HTMLAnchorElement>) => {
    // Prevent default anchor behavior on mobile
    if (e) {
      e.preventDefault();
    }
    
    if (!fileUrl || !document) return;
    
    try {
      // Use proper download method that works on mobile
      // Fetch the file and create a blob URL for download
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Failed to fetch file');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = document.file_name || 'rams-document.pdf';
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);
      
      // Mark as downloaded to enable sign button
      setHasDownloaded(true);
      markAsRead();
    } catch (error) {
      console.error('Error downloading document:', error);
      // Fallback: try direct download link
      if (fileUrl) {
        const a = document.createElement('a');
        a.href = fileUrl;
        a.download = document.file_name || 'rams-document.pdf';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setHasDownloaded(true);
        markAsRead();
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!document) {
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

  return (
    <div className="flex flex-col h-screen">
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
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{document.title}</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {document.file_type.toUpperCase()} Document
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isSigned && (
                <Badge className="bg-green-600 hover:bg-green-700 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Signed
                </Badge>
              )}
              {fileUrl && (
                <Button
                  variant="outline" 
                  size="sm"
                  onClick={() => handleDownload()}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setVisitorSignModalOpen(true)}
                className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Record Visitor
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Document Viewer */}
      <div className="flex-1 overflow-hidden bg-slate-100 dark:bg-slate-900">
        <div
          ref={viewerRef}
          className="h-full overflow-auto"
        >
          <div className="container mx-auto py-8 max-w-5xl px-4">
            {document.file_type === 'pdf' && fileUrl ? (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden border border-slate-200 dark:border-slate-700" style={{ height: 'calc(100vh - 220px)' }}>
                <iframe
                  src={`${fileUrl}#toolbar=1&navpanes=0&scrollbar=1`}
                  className="w-full h-full"
                  title={document.title}
                />
              </div>
            ) : document.file_type === 'docx' && fileUrl ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-8 md:p-12">
                <div className="text-center space-y-6 max-w-2xl mx-auto">
                  <div className="p-4 rounded-full bg-rams/10 w-24 h-24 flex items-center justify-center mx-auto">
                    <FileText className="h-12 w-12 text-rams" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white">Microsoft Word Document</h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-4">
                      Word documents must be downloaded and opened in Microsoft Word or a compatible application.
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-500 mb-6">
                      Please review the entire document before signing.
                    </p>
                  </div>
                  <Button 
                    size="lg"
                    onClick={() => handleDownload()}
                    className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg text-base px-8 py-6"
                  >
                    <Download className="h-5 w-5 mr-2" />
                    Download and Review
                  </Button>
                  {canSign && (
                    <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-700">
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        After reviewing the document, click below to sign
                      </p>
                      <Button
                        size="lg"
                        onClick={() => setSignModalOpen(true)}
                        disabled={!hasDownloaded}
                        className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-base px-8 py-6"
                      >
                        <CheckCircle2 className="h-5 w-5 mr-2" />
                        I have read and understood - Sign Document
                      </Button>
                      {!hasDownloaded && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                          ⚠️ Please download and review the document first
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </div>

      {/* Sign Button - Sticky Banner (for PDFs) */}
      {canSign && showSignButton && document.file_type === 'pdf' && (
        <div className="fixed bottom-0 left-0 right-0 bg-rams border-t-4 border-rams-dark shadow-2xl animate-slide-up z-50">
          <div className="container mx-auto px-4 py-4 max-w-6xl">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-full">
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-white text-lg">Document Review Complete</p>
                  <p className="text-sm text-white/90">
                    {hasDownloaded 
                      ? "Click to confirm you've read and understood the safety requirements"
                      : "Please download the document first to enable signing"
                    }
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                onClick={() => setSignModalOpen(true)}
                disabled={!hasDownloaded}
                className="bg-white text-rams hover:bg-slate-100 font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed px-8 py-6"
              >
                <CheckCircle2 className="h-5 w-5 mr-2" />
                Sign Document
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Sign Modal */}
      {assignment && (
        <SignRAMSModal
          open={signModalOpen}
          onClose={() => setSignModalOpen(false)}
          onSuccess={handleSignSuccess}
          assignmentId={assignment.id}
          documentTitle={document.title}
        />
      )}

      {/* Visitor Signature Modal */}
      <RecordVisitorSignatureModal
        open={visitorSignModalOpen}
        onClose={() => setVisitorSignModalOpen(false)}
        onSuccess={handleVisitorSignSuccess}
        documentId={documentId}
        documentTitle={document.title}
      />
    </div>
  );
}

