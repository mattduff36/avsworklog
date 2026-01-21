'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, Download } from 'lucide-react';
import { toast } from 'sonner';

function PDFViewerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  
  const url = searchParams.get('url');
  const title = searchParams.get('title') || 'Document';
  const returnUrl = searchParams.get('return') || '/rams';

  useEffect(() => {
    if (!url) {
      setError('No PDF URL provided');
      setLoading(false);
      return;
    }

    // Validate and set the PDF URL
    try {
      const decodedUrl = decodeURIComponent(url);
      setPdfUrl(decodedUrl);
      setLoading(false);
    } catch (err) {
      console.error('Error decoding PDF URL:', err);
      setError('Invalid PDF URL');
      setLoading(false);
    }
  }, [url]);

  const handleBack = () => {
    router.push(returnUrl);
  };

  const handleDownload = async () => {
    if (!pdfUrl) return;

    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error('Failed to fetch file');
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = downloadUrl;
      a.download = `${title}.pdf`;
      window.document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        window.URL.revokeObjectURL(downloadUrl);
        window.document.body.removeChild(a);
      }, 100);
      
      toast.success('Download started');
    } catch (err) {
      console.error('Error downloading PDF:', err);
      toast.error('Failed to download PDF');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center space-y-3">
          <Loader2 className="h-12 w-12 animate-spin text-rams mx-auto" />
          <p className="text-muted-foreground">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error || !pdfUrl) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 p-4">
        <div className="max-w-md w-full bg-slate-800 rounded-lg p-8 text-center space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-900/20 mx-auto">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Unable to load PDF</h2>
          <p className="text-muted-foreground">{error || 'An unknown error occurred'}</p>
          <Button
            onClick={handleBack}
            className="bg-rams hover:bg-rams-dark text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-slate-900">
      {/* Floating Back Button - Always visible on mobile */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <Button
          onClick={handleBack}
          size="lg"
          className="bg-slate-800/95 hover:bg-slate-700 text-white shadow-xl backdrop-blur-sm border border-slate-700 transition-all duration-200 active:scale-95"
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          <span className="hidden sm:inline">Back</span>
        </Button>
        
        {/* Download button for mobile */}
        <Button
          onClick={handleDownload}
          size="lg"
          className="bg-rams/95 hover:bg-rams-dark text-white shadow-xl backdrop-blur-sm border border-rams-dark transition-all duration-200 active:scale-95 sm:hidden"
          title="Download PDF"
        >
          <Download className="h-5 w-5" />
        </Button>
      </div>

      {/* Desktop Download Button */}
      <div className="fixed top-4 right-4 z-50 hidden sm:block">
        <Button
          onClick={handleDownload}
          size="lg"
          className="bg-rams/95 hover:bg-rams-dark text-white shadow-xl backdrop-blur-sm border border-rams-dark transition-all duration-200 active:scale-95"
        >
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>
      </div>

      {/* PDF Viewer */}
      <iframe
        src={pdfUrl}
        className="w-full h-full border-0"
        title={title}
        onError={() => {
          setError('Failed to load PDF. The file may be corrupted or in an unsupported format.');
        }}
      />
    </div>
  );
}

export default function PDFViewerPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <Loader2 className="h-12 w-12 animate-spin text-rams" />
      </div>
    }>
      <PDFViewerContent />
    </Suspense>
  );
}
