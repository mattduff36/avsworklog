'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';

// Dynamically import PDF viewer component (client-side only)
const PDFViewer = dynamic(
  () => import('./PDFViewer').then((mod) => ({ default: mod.PDFViewer })),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
          Preparing PDF viewer...
        </span>
      </div>
    )
  }
);

interface BlockingMessageModalProps {
  open: boolean;
  message: {
    id: string;
    recipient_id: string;
    subject: string;
    body: string;
    sender_name: string;
    created_at: string;
    pdf_file_path?: string | null;
  };
  onSigned: () => void;
  totalPending: number;
  currentIndex: number;
}

export function BlockingMessageModal({
  open,
  message,
  onSigned,
  totalPending,
  currentIndex
}: BlockingMessageModalProps) {
  const [signing, setSigning] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Set PDF URL if pdf_file_path exists
  useEffect(() => {
    if (message.pdf_file_path) {
      // Use API route to serve PDF with authentication
      const url = `/api/toolbox-talk-pdf/${message.pdf_file_path}`;
      setPdfUrl(url);
    } else {
      setPdfUrl(null);
    }

    return () => {
      setPdfUrl(null);
    };
  }, [message.pdf_file_path]);

  async function handleSign(signatureData: string) {
    setSigning(true);

    try {
      const response = await fetch(`/api/messages/${message.recipient_id}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          signature_data: signatureData
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign message');
      }

      toast.success('Toolbox Talk signed successfully');
      onSigned();

    } catch (error) {
      console.error('Error signing message:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to sign message');
    } finally {
      setSigning(false);
    }
  }

  // This modal cannot be closed by user - they must sign
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 border-red-600 dark:border-red-600 flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-lg text-red-600">
            Toolbox Talk - {message.subject}
          </DialogTitle>
          {totalPending > 1 && (
            <DialogDescription className="text-xs text-slate-600 dark:text-slate-400">
              Message {currentIndex + 1} of {totalPending}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Warning - compact */}
        <div className="flex items-center gap-2 px-6 -mt-2 mb-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-xs text-slate-700 dark:text-slate-300">
            Read and sign to continue
          </p>
        </div>

        <ScrollArea className="flex-1 px-6">
          <div className="pb-6 space-y-4">
            {/* Message Body - No border, no padding */}
            {message.body && (
              <div className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                {message.body}
              </div>
            )}

            {/* PDF Viewer - Render each page separately */}
            {pdfUrl && <PDFViewer url={pdfUrl} />}

            {/* Open in Browser Button (if PDF attached) */}
            {pdfUrl && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(pdfUrl, '_blank')}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open PDF in Browser
                </Button>
              </div>
            )}

            {/* Signature Section - At the BOTTOM so users must scroll */}
            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              <label className="text-sm font-medium text-slate-900 dark:text-white">
                Your Signature <span className="text-destructive">*</span>
              </label>
              
              <SignaturePad
                onSave={handleSign}
                onCancel={() => {}}
                disabled={signing}
                variant="toolbox-talk"
              />

              {signing && (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording signature...
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

