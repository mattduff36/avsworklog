'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface PDFViewerProps {
  url: string;
}

// Load PDF.js from CDN to avoid webpack bundling issues
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfjsLib?: any;
  }
}

export function PDFViewer({ url }: PDFViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Effect 1: Load PDF.js library and fetch PDF document
  useEffect(() => {
    let mounted = true;

    async function loadPdfFromCDN() {
      try {
        // Check if PDF.js is already loaded
        if (window.pdfjsLib) {
          await loadPdfDocument();
          return;
        }

        // Load PDF.js from CDN
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.async = true;

        script.onload = async () => {
          if (!mounted) return;

          // Configure worker
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            
            await loadPdfDocument();
          }
        };

        script.onerror = () => {
          if (mounted) {
            setError('Failed to load PDF library from CDN');
            setLoading(false);
          }
        };

        document.head.appendChild(script);

        return () => {
          if (script.parentNode) {
            document.head.removeChild(script);
          }
        };
      } catch (err) {
        console.error('Failed to load PDF:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
          setLoading(false);
        }
      }
    }

    async function loadPdfDocument() {
      try {
        if (!window.pdfjsLib || !mounted) return;

        const loadingTask = window.pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        
        if (!mounted) return;
        
        setPdfDoc(pdf);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load PDF document:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
          setLoading(false);
        }
      }
    }

    loadPdfFromCDN();

    return () => {
      mounted = false;
    };
  }, [url]);

  // Cleanup PDF document when component unmounts
  useEffect(() => {
    return () => {
      if (pdfDoc) {
        pdfDoc.destroy();
      }
    };
  }, [pdfDoc]);

  // Effect 2: Render PDF pages to canvas once container is available
  useEffect(() => {
    // Wait until we have a PDF document, loading is done, and container ref is available
    if (!pdfDoc || loading || !containerRef.current) {
      return;
    }

    let mounted = true;

    async function renderPages() {
      try {
        if (!containerRef.current) return;

        containerRef.current.innerHTML = ''; // Clear container

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          if (!mounted) break;

          const page = await pdfDoc.getPage(pageNum);
          
          // Create canvas for this page
          const canvas = document.createElement('canvas');
          canvas.className = 'mb-4 border border-slate-200 dark:border-slate-700 rounded-md w-full';
          
          const context = canvas.getContext('2d');
          if (!context) continue;

          // Calculate scale to fit width (520px)
          const viewport = page.getViewport({ scale: 1 });
          const scale = 520 / viewport.width;
          const scaledViewport = page.getViewport({ scale });

          canvas.height = scaledViewport.height;
          canvas.width = scaledViewport.width;

          // Render page to canvas
          await page.render({
            canvasContext: context,
            viewport: scaledViewport,
          }).promise;

          if (mounted && containerRef.current) {
            containerRef.current.appendChild(canvas);
          }
        }
      } catch (err) {
        console.error('Failed to render PDF pages:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to render PDF pages');
        }
      }
    }

    renderPages();

    return () => {
      mounted = false;
    };
  }, [pdfDoc, loading]); // Re-run when pdfDoc is set or loading changes

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-slate-600 dark:text-muted-foreground">
          Loading PDF...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600">
        <AlertCircle className="h-6 w-6 mr-2" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full space-y-4">
      {/* Pages will be rendered here as canvas elements */}
    </div>
  );
}
