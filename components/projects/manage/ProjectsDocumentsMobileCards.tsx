'use client';

import { useState, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Trash2,
  Star,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { formatFileSize } from '@/lib/utils/file-validation';
import type { ManageDocumentRow } from '@/types/rams';

interface ProjectsDocumentsMobileCardsProps {
  documents: ManageDocumentRow[];
  onDelete: (doc: ManageDocumentRow) => void;
  onToggleFavourite: (doc: ManageDocumentRow) => void;
  onReuse: (doc: ManageDocumentRow) => void;
}

export function ProjectsDocumentsMobileCards({
  documents,
  onDelete,
  onToggleFavourite,
  onReuse,
}: ProjectsDocumentsMobileCardsProps) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => {
      const next = prev === id ? null : id;
      if (next) {
        requestAnimationFrame(() => {
          const el = cardRefs.current.get(id);
          if (el) {
            const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-nav-h') || '68', 10);
            const top = el.getBoundingClientRect().top + window.scrollY - navH - 12;
            window.scrollTo({ top, behavior: 'smooth' });
          }
        });
      }
      return next;
    });
  }, []);

  return (
    <div className="md:hidden space-y-2">
      {documents.map((doc) => {
        const isExpanded = expandedId === doc.id;
        const pct = doc.total_assigned ? Math.round((doc.total_signed / doc.total_assigned) * 100) : 0;
        const completionLabel = doc.required_signature ? 'signed' : 'read';

        return (
          <Card
            key={doc.id}
            ref={(el) => { if (el) cardRefs.current.set(doc.id, el); }}
            className={`bg-white dark:bg-slate-900 border-border transition-all duration-200 ${
              isExpanded ? 'ring-1 ring-rams/40 shadow-md' : ''
            }`}
          >
            <CardContent className="p-3">
              {/* Collapsed row: always visible */}
              <button
                onClick={() => handleToggle(doc.id)}
                className="w-full text-left"
              >
                <div className="flex items-start gap-2.5">
                  <FileText className="h-4 w-4 text-rams shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground line-clamp-1">
                      {doc.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {doc.document_type_name && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {doc.document_type_name}
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {doc.total_assigned > 0 && (
                      <span className={`text-[11px] font-medium whitespace-nowrap ${
                        doc.total_signed === 0
                          ? 'text-red-500'
                          : doc.total_signed === doc.total_assigned
                            ? 'text-green-500'
                            : 'text-yellow-500'
                      }`}>
                        {doc.total_signed}/{doc.total_assigned}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-border space-y-3">
                  {/* Metadata grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">File</span>
                      <p className="text-foreground">
                        {doc.file_type.toUpperCase()} &middot; {formatFileSize(doc.file_size)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Uploader</span>
                      <p className="text-foreground truncate">{doc.uploader_name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Completion</span>
                      <p className="text-foreground">
                        {doc.total_assigned > 0
                          ? `${doc.total_signed}/${doc.total_assigned} ${completionLabel} (${pct}%)`
                          : 'Not assigned'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Uploaded</span>
                      <p className="text-foreground">
                        {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>

                  {doc.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {doc.description}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="flex-1 min-w-[100px] h-9 bg-rams hover:bg-rams-dark text-white text-xs"
                      onClick={() => router.push(`/projects/${doc.id}?from=/projects/manage`)}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      View Details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onReuse(doc)}
                      className="h-9 text-xs"
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Reuse
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onToggleFavourite(doc)}
                      className="h-9 w-9 p-0"
                      title={doc.is_favourite ? 'Remove favourite' : 'Add favourite'}
                    >
                      <Star
                        className={`h-4 w-4 ${
                          doc.is_favourite ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'
                        }`}
                      />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDelete(doc)}
                      className="h-9 w-9 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                      title="Delete document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
