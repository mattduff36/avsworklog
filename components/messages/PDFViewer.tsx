'use client';

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface PDFViewerProps {
  url: string;
}

export function PDFViewer({ url }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfComponents, setPdfComponents] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Dynamically import react-pdf only on the client side
    let mounted = true;

    async function loadPdfLibrary() {
      try {
        // Import react-pdf and pdfjs-dist dynamically
        const [reactPdf, pdfjsLib] = await Promise.all([
          import('react-pdf'),
          import('pdfjs-dist'),
        ]);

        // Import CSS dynamically
        await Promise.all([
          import('react-pdf/dist/Page/AnnotationLayer.css'),
          import('react-pdf/dist/Page/TextLayer.css'),
        ]);

        // Configure PDF.js worker
        pdfjsLib.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.pdfjs.version}/build/pdf.worker.min.mjs`;

        if (mounted) {
          setPdfComponents({
            Document: reactPdf.Document,
            Page: reactPdf.Page,
          });
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load PDF library:', err);
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    }

    loadPdfLibrary();

    return () => {
      mounted = false;
    };
  }, []);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
          Loading PDF viewer...
        </span>
      </div>
    );
  }

  if (error || !pdfComponents) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600">
        <AlertCircle className="h-6 w-6 mr-2" />
        <span className="text-sm">Failed to load PDF viewer</span>
      </div>
    );
  }

  const { Document, Page } = pdfComponents;

  return (
    <div className="w-full space-y-4">
      <Document
        file={url}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
              Loading PDF...
            </span>
          </div>
        }
        error={
          <div className="flex items-center justify-center py-12 text-red-600">
            <AlertCircle className="h-6 w-6 mr-2" />
            <span className="text-sm">Failed to load PDF document</span>
          </div>
        }
      >
        {numPages && Array.from(new Array(numPages), (el, index) => (
          <div key={`page_${index + 1}`} className="mb-4">
            <Page
              pageNumber={index + 1}
              width={520}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden"
            />
          </div>
        ))}
      </Document>
    </div>
  );
}

