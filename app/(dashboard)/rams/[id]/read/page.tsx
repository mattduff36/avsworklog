'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
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
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const supabase = createClientComponentClient<Database>();

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
        <Card className="p-6 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Document not found</p>
          <Button asChild className="mt-4">
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
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button asChild variant="ghost" size="icon">
                <Link href="/rams">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div>
                <h1 className="text-xl font-bold">{document.title}</h1>
                <p className="text-sm text-muted-foreground">
                  {document.file_type.toUpperCase()} Document
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isSigned && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Signed
                </Badge>
              )}
              {fileUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={fileUrl} download={document.file_name}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisitorSignModalOpen(true)}
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
          <div className="container mx-auto py-6 max-w-5xl">
            {document.file_type === 'pdf' && fileUrl ? (
              <div className="bg-white rounded-lg shadow-lg overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
                <iframe
                  src={`${fileUrl}#toolbar=1&navpanes=0&scrollbar=1`}
                  className="w-full h-full"
                  title={document.title}
                />
              </div>
            ) : document.file_type === 'docx' && fileUrl ? (
              <Card className="p-8">
                <div className="text-center space-y-4">
                  <FileText className="h-16 w-16 text-primary mx-auto" />
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Microsoft Word Document</h3>
                    <p className="text-muted-foreground mb-4">
                      Word documents must be downloaded and opened in Microsoft Word or a compatible application.
                    </p>
                    <p className="text-sm text-muted-foreground mb-6">
                      Please review the entire document before signing.
                    </p>
                  </div>
                  <Button asChild size="lg">
                    <a href={fileUrl} download={document.file_name}>
                      <Download className="h-5 w-5 mr-2" />
                      Download and Review
                    </a>
                  </Button>
                  {canSign && (
                    <div className="mt-8 pt-8 border-t">
                      <p className="text-sm text-muted-foreground mb-4">
                        After reviewing the document, click below to sign
                      </p>
                      <Button
                        size="lg"
                        onClick={() => setSignModalOpen(true)}
                      >
                        I have read and understood - Sign Document
                      </Button>
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
        <div className="fixed bottom-0 left-0 right-0 bg-primary text-primary-foreground shadow-lg animate-slide-up">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5" />
                <div>
                  <p className="font-semibold">Document Review Complete</p>
                  <p className="text-sm opacity-90">
                    Click to confirm you've read and understood the safety requirements
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => setSignModalOpen(true)}
              >
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

