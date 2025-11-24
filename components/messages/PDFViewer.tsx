'use client';

import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2, AlertCircle } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

interface PDFViewerProps {
  url: string;
}

export function PDFViewer({ url }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

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

