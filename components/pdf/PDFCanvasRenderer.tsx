'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import { isExpectedPdfRenderError } from '@/lib/pdf/render-errors';

type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { url: string; useSystemFonts?: boolean }) => PDFDocumentLoadingTask;
};

let pdfjsCache: PdfjsLib | null = null;

function ensurePromiseWithResolvers(): void {
  const promiseWithResolvers = (Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }).withResolvers;

  if (typeof promiseWithResolvers === 'function') {
    return;
  }

  (Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

function isExpectedPdfLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('unexpected server response (400)') ||
    message.includes('unexpected server response (401)') ||
    message.includes('unexpected server response (403)') ||
    message.includes('unexpected server response (404)')
  );
}

function getPdfLoadMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return 'Failed to load PDF';
  }

  const message = error.message;
  if (/(400|401|403)/.test(message) && message.includes('Unexpected server response')) {
    return 'This PDF link has expired or is unavailable. Please reopen the document and try again.';
  }

  if (/404/.test(message) && message.includes('Unexpected server response')) {
    return 'This PDF is no longer available.';
  }

  return message;
}

async function getPdfjs(): Promise<PdfjsLib> {
  if (pdfjsCache) return pdfjsCache;
  ensurePromiseWithResolvers();
  // webpackIgnore makes the browser's native ESM loader handle this import
  // instead of Webpack, which avoids the "Object.defineProperty on non-object" bug.
  // @ts-expect-error – absolute-URL import handled by browser ESM, not TypeScript/Webpack
  const pdfjs = await import(/* webpackIgnore: true */ '/pdf.min.mjs') as PdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  pdfjsCache = pdfjs;
  return pdfjs;
}

interface PDFCanvasRendererProps {
  url: string;
  className?: string;
}

export function PDFCanvasRenderer({ url, className }: PDFCanvasRendererProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);
  const activeRenderTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument({ url, useSystemFonts: true }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          if (!isExpectedPdfLoadError(err)) {
            console.error('Failed to load PDF document:', err);
          }
          setError(getPdfLoadMessage(err));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    return () => {
      activeRenderTaskRef.current?.cancel();
      activeRenderTaskRef.current = null;
      pdfDoc?.destroy();
    };
  }, [pdfDoc]);

  const lastWidthRef = useRef(0);

  const renderPages = useCallback(async () => {
    if (!pdfDoc || !containerRef.current) return;

    activeRenderTaskRef.current?.cancel();
    activeRenderTaskRef.current = null;

    const id = ++renderIdRef.current;
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    if (containerWidth === 0) return;

    lastWidthRef.current = containerWidth;
    container.innerHTML = '';

    const dpr = window.devicePixelRatio || 1;

    try {
      for (let num = 1; num <= pdfDoc.numPages; num++) {
        if (renderIdRef.current !== id) return;

        const page = await pdfDoc.getPage(num);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale: scale * dpr });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${containerWidth}px`;
        canvas.style.height = `${(viewport.height / dpr).toFixed(0)}px`;
        canvas.className = 'block';

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const renderTask = page.render({ canvasContext: ctx, viewport });
        activeRenderTaskRef.current = renderTask;
        await renderTask.promise;

        if (activeRenderTaskRef.current === renderTask) {
          activeRenderTaskRef.current = null;
        }

        if (renderIdRef.current !== id) return;
        container.appendChild(canvas);
      }
    } catch (error) {
      if (isExpectedPdfRenderError(error)) return;
      console.error('Failed to render PDF page:', error);
      setError('Failed to render PDF');
    } finally {
      activeRenderTaskRef.current = null;
    }
  }, [pdfDoc]);

  useEffect(() => {
    if (loading || !pdfDoc) return;
    void renderPages();
  }, [loading, pdfDoc, renderPages]);

  useEffect(() => {
    if (loading || !pdfDoc) return;

    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!containerRef.current) return;
        const newWidth = containerRef.current.clientWidth;
        // Skip re-render when width hasn't actually changed (mobile
        // browsers fire resize when the URL bar hides/shows on scroll,
        // which only changes height — re-rendering here would destroy
        // all canvases and jump the scroll position to the top).
        if (Math.abs(newWidth - lastWidthRef.current) < 2) return;
        void renderPages();
      }, 200);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [loading, pdfDoc, renderPages]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading PDF...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-red-400">
        <AlertCircle className="h-8 w-8" />
        <span className="text-sm text-center max-w-xs">{error}</span>
      </div>
    );
  }

  return (
    <div className={className}>
      {pageCount > 0 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </div>
      )}
      <div ref={containerRef} className="w-full space-y-1" />
    </div>
  );
}
