'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText,
  Trash2,
  Star,
  Copy,
  MoreHorizontal,
  ArrowUpDown,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { formatFileSize } from '@/lib/utils/file-validation';
import type { ManageDocumentRow, ManageDocumentsQuery } from '@/types/rams';

interface ProjectsDocumentsTableProps {
  documents: ManageDocumentRow[];
  sortBy: NonNullable<ManageDocumentsQuery['sortBy']>;
  sortDir: NonNullable<ManageDocumentsQuery['sortDir']>;
  onSortChange: (field: NonNullable<ManageDocumentsQuery['sortBy']>) => void;
  onDelete: (doc: ManageDocumentRow) => void;
  onToggleFavourite: (doc: ManageDocumentRow) => void;
  onReuse: (doc: ManageDocumentRow) => void;
}

function SortHeader({
  label,
  field,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  field: NonNullable<ManageDocumentsQuery['sortBy']>;
  currentSort: string;
  currentDir: string;
  onSort: (f: NonNullable<ManageDocumentsQuery['sortBy']>) => void;
}) {
  const isActive = currentSort === field;
  return (
    <button
      onClick={() => onSort(field)}
      className="flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${isActive ? 'text-rams' : 'text-muted-foreground/50'}`} />
    </button>
  );
}

function CompletionBadge({ signed, assigned, requiresSig }: { signed: number; assigned: number; requiresSig: boolean }) {
  if (assigned === 0) {
    return <span className="text-muted-foreground text-xs">Not assigned</span>;
  }
  const pct = Math.round((signed / assigned) * 100);
  const label = requiresSig ? 'signed' : 'read';

  let colorClasses = 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30';
  if (signed === 0) {
    colorClasses = 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30';
  } else if (signed === assigned) {
    colorClasses = 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30';
  }

  return (
    <Badge variant="outline" className={`text-xs font-normal whitespace-nowrap ${colorClasses}`}>
      {signed}/{assigned} {label} ({pct}%)
    </Badge>
  );
}

export function ProjectsDocumentsTable({
  documents,
  sortBy,
  sortDir,
  onSortChange,
  onDelete,
  onToggleFavourite,
  onReuse,
}: ProjectsDocumentsTableProps) {
  const router = useRouter();

  return (
    <div className="hidden md:block rounded-lg border border-border overflow-hidden bg-white dark:bg-slate-900">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <TableHead className="w-[30%]">
              <SortHeader
                label="Document"
                field="title"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={onSortChange}
              />
            </TableHead>
            <TableHead className="w-[12%]">Type</TableHead>
            <TableHead className="w-[15%]">
              <SortHeader
                label="Uploaded"
                field="created_at"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={onSortChange}
              />
            </TableHead>
            <TableHead className="w-[10%]">Uploader</TableHead>
            <TableHead className="w-[20%]">
              <SortHeader
                label="Completion"
                field="completion"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={onSortChange}
              />
            </TableHead>
            <TableHead className="w-[13%] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow
              key={doc.id}
              onClick={() => router.push(`/projects/${doc.id}?from=/projects/manage`)}
              className="group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
            >
              {/* Document info */}
              <TableCell>
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-rams shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground group-hover:text-rams transition-colors line-clamp-1">
                      {doc.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 block">
                      {doc.file_type.toUpperCase()} &middot; {formatFileSize(doc.file_size)}
                    </span>
                  </div>
                </div>
              </TableCell>

              {/* Type */}
              <TableCell className="text-sm text-muted-foreground">
                {doc.document_type_name || <span className="italic">None</span>}
              </TableCell>

              {/* Date */}
              <TableCell className="text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
              </TableCell>

              {/* Uploader */}
              <TableCell className="text-sm text-muted-foreground truncate max-w-[120px]">
                {doc.uploader_name}
              </TableCell>

              {/* Completion */}
              <TableCell>
                <CompletionBadge
                  signed={doc.total_signed}
                  assigned={doc.total_assigned}
                  requiresSig={doc.required_signature}
                />
              </TableCell>

              {/* Actions */}
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-slate-900 border-border">
                    <DropdownMenuItem onClick={() => onReuse(doc)}>
                      <Copy className="h-4 w-4 mr-2" />
                      Reuse Metadata
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onToggleFavourite(doc)}>
                      <Star className={`h-4 w-4 mr-2 ${doc.is_favourite ? 'fill-yellow-500 text-yellow-500' : ''}`} />
                      {doc.is_favourite ? 'Remove Favourite' : 'Add Favourite'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(doc)}
                      className="text-red-600 focus:text-red-600"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
