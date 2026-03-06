'use client';

import { PDFCanvasRenderer } from '@/components/pdf/PDFCanvasRenderer';

interface PDFViewerProps {
  url: string;
}

export function PDFViewer({ url }: PDFViewerProps) {
  return <PDFCanvasRenderer url={url} className="w-full" />;
}
