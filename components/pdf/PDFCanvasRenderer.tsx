'use client';

import { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { PanelLoader } from '@/components/ui/panel-loader';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { getPdfLoadMessage, isExpectedPdfLoadError, isExpectedPdfRenderError } from '@/lib/pdf/render-errors';

type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { url: string; useSystemFonts?: boolean }) => PDFDocumentLoadingTask;
};
let pdfjsCache: PdfjsLib | null = null;

async function getPdfjs(): Promise<PdfjsLib> {
  if (pdfjsCache) return pdfjsCache;
  const constructor = Promise as PromiseConstructor & {
    withResolvers?: <T>() => { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void };
  };
  if (!constructor.withResolvers) {
    constructor.withResolvers = function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
  // Native browser ESM avoids bundling the PDF.js runtime into webpack.
  const source = '/pdf.min.mjs';
  const pdfjs = await import(/* webpackIgnore: true */ /* @vite-ignore */ source) as PdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  pdfjsCache = pdfjs;
  return pdfjs;
}

export interface PdfPageSize { width: number; height: number }

export function bufferedPdfPages(visible: Iterable<number>, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const page of visible) {
    for (const candidate of [page - 1, page, page + 1]) {
      if (candidate >= 1 && candidate <= pageCount) pages.add(candidate);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export async function readPdfPageSizes(
  doc: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
  cancelled: () => boolean = () => false,
): Promise<PdfPageSize[]> {
  const sizes: PdfPageSize[] = [];
  // Metadata is bounded to four reads at a time; no canvas or raster work here.
  for (let start = 1; start <= doc.numPages; start += 4) {
    if (cancelled()) return [];
    const batch = await Promise.all(Array.from({ length: Math.min(4, doc.numPages - start + 1) }, async (_, offset) => {
      const page = await doc.getPage(start + offset);
      const viewport = page.getViewport({ scale: 1 });
      page.cleanup();
      return { width: viewport.width, height: viewport.height };
    }));
    sizes.push(...batch);
  }
  return sizes;
}

interface LoadedPdf { url: string; doc: PDFDocumentProxy; pages: PdfPageSize[] }
interface PDFCanvasRendererProps { url: string; className?: string }

export function PDFCanvasRenderer({ url, className }: PDFCanvasRendererProps) {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [error, setError] = useState<{ url: string; message: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = loaded?.url === url ? loaded : null;
  const currentError = error?.url === url ? error.message : null;

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | null = null;
    setLoaded(null);
    setError(null);
    void (async () => {
      try {
        const pdfjs = await getPdfjs();
        if (!active) return;
        task = pdfjs.getDocument({ url, useSystemFonts: true });
        const doc = await task.promise;
        const pages = await readPdfPageSizes(doc, () => !active);
        if (active) setLoaded({ url, doc, pages });
      } catch (cause) {
        if (!active) return;
        if (!isExpectedPdfLoadError(cause)) console.error('Failed to load PDF document:', cause);
        setError({ url, message: getPdfLoadMessage(cause) });
      }
    })();
    return () => {
      active = false;
      // LoadingTask owns the transport and loaded document, including pending metadata reads.
      void task?.destroy().catch(() => {});
    };
  }, [url]);

  useEffect(() => {
    const container = containerRef.current;
    if (!current || !container || currentError) return;
    const { doc, pages } = current;
    const frames = [...container.querySelectorAll<HTMLDivElement>('[data-pdf-page]')];
    const canvases = new Map<number, HTMLCanvasElement>();
    const pageResources = new Map<number, PDFPageProxy>();
    const rendered = new Set<number>();
    let visible = new Set<number>();
    let wanted = new Set<number>();
    let activeTask: RenderTask | null = null;
    let activePage: number | null = null;
    let busy = false;
    let disposed = false;
    let failed = false;
    let epoch = 0;
    let width = container.clientWidth;
    let dpr = window.devicePixelRatio || 1;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    const release = (number: number) => {
      const canvas = canvases.get(number);
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
      canvases.delete(number);
      rendered.delete(number);
      pageResources.get(number)?.cleanup();
      pageResources.delete(number);
    };
    const pump = () => {
      if (disposed || failed || busy || width <= 0) return;
      const number = [...wanted].find((page) => !rendered.has(page));
      if (number === undefined) return;
      busy = true;
      activePage = number;
      const renderEpoch = epoch;
      void (async () => {
        try {
          const page = await doc.getPage(number);
          pageResources.set(number, page);
          if (disposed || renderEpoch !== epoch || !wanted.has(number)) return;
          const viewport = page.getViewport({ scale: width / pages[number - 1].width * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.className = 'absolute inset-0 block';
          canvas.setAttribute('aria-label', 'PDF page ' + number);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas rendering is unavailable');
          canvases.set(number, canvas);
          frames[number - 1].appendChild(canvas);
          activeTask = page.render({ canvasContext: context, viewport });
          await activeTask.promise;
          if (!disposed && renderEpoch === epoch && wanted.has(number)) {
            rendered.add(number);
            canvas.dataset.pdfRendered = 'true';
          }
        } catch (cause) {
          if (!disposed && renderEpoch === epoch && !isExpectedPdfRenderError(cause)) {
            failed = true;
            console.error('Failed to render PDF page:', cause);
            setError({ url, message: 'Failed to render PDF' });
          }
        } finally {
          activeTask = null;
          activePage = null;
          busy = false;
          if (disposed || renderEpoch !== epoch || !wanted.has(number)) release(number);
          pump();
        }
      })();
    };
    const updateWanted = () => {
      wanted = new Set(bufferedPdfPages(visible, pages.length));
      if (activePage !== null && !wanted.has(activePage)) activeTask?.cancel();
      for (const number of canvases.keys()) {
        if (!wanted.has(number) && number !== activePage) release(number);
      }
      pump();
    };
    const measureVisible = () => {
      let top = 0;
      let bottom = window.innerHeight;
      for (let parent = container.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          const rect = parent.getBoundingClientRect();
          top = Math.max(top, rect.top);
          bottom = Math.min(bottom, rect.bottom);
        }
      }
      visible = new Set(frames.flatMap((frame, index) => {
        const rect = frame.getBoundingClientRect();
        return rect.bottom > top && rect.top < bottom ? [index + 1] : [];
      }));
      updateWanted();
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const number = Number((entry.target as HTMLElement).dataset.pdfPage);
        if (entry.isIntersecting) visible.add(number); else visible.delete(number);
      }
      updateWanted();
    });
    frames.forEach((frame) => observer?.observe(frame));
    if (!observer) window.addEventListener('scroll', measureVisible, true);
    const scheduleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const nextWidth = container.clientWidth;
        const nextDpr = window.devicePixelRatio || 1;
        // Mobile URL-bar height changes preserve canvases and scroll anchoring.
        if (Math.abs(nextWidth - width) < 2 && nextDpr === dpr) return;
        width = nextWidth;
        dpr = nextDpr;
        epoch += 1;
        activeTask?.cancel();
        for (const number of canvases.keys()) if (number !== activePage) release(number);
        rendered.clear();
        measureVisible();
      }, 200);
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleResize);
    resizeObserver?.observe(container);
    window.addEventListener('resize', scheduleResize);
    measureVisible();
    return () => {
      disposed = true;
      activeTask?.cancel();
      observer?.disconnect();
      resizeObserver?.disconnect();
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', scheduleResize);
      window.removeEventListener('scroll', measureVisible, true);
      for (const number of [...canvases.keys()]) release(number);
    };
  }, [current, currentError, url]);

  if (currentError) {
    return <div className="flex flex-col items-center justify-center py-16 gap-3 text-red-400">
      <AlertCircle className="h-8 w-8" /><span className="text-sm text-center max-w-xs">{currentError}</span>
    </div>;
  }
  if (!current) return <PanelLoader message="Loading PDF..." className="py-16" />;
  // The original file is the complete print/download path; virtual canvases are for screen viewing.
  let canOpenOriginal = false;
  try { canOpenOriginal = ['http:', 'https:', 'blob:'].includes(new URL(url, 'https://pdf.invalid').protocol); } catch {}
  return <div className={className}>
    <div className="text-center text-xs text-muted-foreground py-2">{current.pages.length} {current.pages.length === 1 ? 'page' : 'pages'}</div>
    {canOpenOriginal && <div className="text-center pb-2 text-xs">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Open original PDF to print or download</a>
    </div>}
    <div ref={containerRef} className="w-full space-y-1">
      {current.pages.map((page, index) => <div key={index + 1} data-pdf-page={index + 1}
        className="relative w-full bg-white" style={{ aspectRatio: page.width + ' / ' + page.height }} />)}
    </div>
  </div>;
}
