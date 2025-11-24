'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface PDFViewerProps {
  url: string;
}

// Load PDF.js from CDN to avoid webpack bundling issues
declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

export function PDFViewer({ url }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    async function loadPdfFromCDN() {
      try {
        // Check if PDF.js is already loaded
        if (window.pdfjsLib) {
          await renderPdf();
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
            
            await renderPdf();
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

    async function renderPdf() {
      try {
        if (!window.pdfjsLib || !mounted) return;

        // Load the PDF document
        const loadingTask = window.pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        
        if (!mounted) return;
        
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setLoading(false);

        // Render all pages
        if (containerRef.current) {
          containerRef.current.innerHTML = ''; // Clear container

          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            
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

            // Render page
            await page.render({
              canvasContext: context,
              viewport: scaledViewport,
            }).promise;

            if (mounted && containerRef.current) {
              containerRef.current.appendChild(canvas);
            }
          }
        }
      } catch (err) {
        console.error('Failed to render PDF:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to render PDF');
          setLoading(false);
        }
      }
    }

    loadPdfFromCDN();

    return () => {
      mounted = false;
      if (pdfDoc) {
        pdfDoc.destroy();
      }
    };
  }, [url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
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

