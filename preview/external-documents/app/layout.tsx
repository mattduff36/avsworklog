import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import './preview.css';

export const metadata = { title: 'External Documents — local preview', robots: { index: false, follow: false } };

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div data-accent="external-documents" className="min-h-screen bg-slate-950 px-4 py-6 sm:px-6">
          <div className="mx-auto mb-5 max-w-6xl border-b border-border pb-4">
            <span className="text-xl font-bold text-avs-yellow">SQUIRES</span>
            <span className="ml-3 text-sm text-muted-foreground">Local testing</span>
          </div>
          {children}
        </div>
        <Toaster theme="dark" richColors />
      </body>
    </html>
  );
}
