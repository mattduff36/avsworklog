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
  Users,
  Trash2,
  Star,
  Copy,
  Eye,
  MoreHorizontal,
  ArrowUpDown,
} from 'lucide-react';
import Link from 'next/link';
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
  let variant: 'default' | 'secondary' | 'outline' | 'destructive' = 'secondary';
  if (pct === 100) variant = 'default';
  else if (pct === 0) variant = 'outline';

  return (
    <Badge variant={variant} className="text-xs font-normal whitespace-nowrap">
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
  return (
    <div className="hidden md:block rounded-lg border border-border overflow-hidden bg-white dark:bg-slate-900">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <TableHead className="w-[40%]">
              <SortHeader
                label="Document"
                field="title"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={onSortChange}
              />
            </TableHead>
            <TableHead className="w-[15%]">
              <SortHeader
                label="Uploaded"
                field="created_at"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={onSortChange}
              />
            </TableHead>
            <TableHead className="w-[12%]">Uploader</TableHead>
            <TableHead className="w-[18%]">
              <SortHeader
                label="Completion"
                field="completion"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={onSortChange}
              />
            </TableHead>
            <TableHead className="w-[15%] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow
              key={doc.id}
              className="group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
            >
              {/* Document info */}
              <TableCell>
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-rams shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${doc.id}?from=/projects/manage`}
                      className="font-medium text-foreground hover:text-rams transition-colors line-clamp-1"
                    >
                      {doc.title}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      {doc.document_type_name && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                          {doc.document_type_name}
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {doc.file_type.toUpperCase()} &middot; {formatFileSize(doc.file_size)}
                      </span>
                    </div>
                  </div>
                </div>
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
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Link href={`/projects/${doc.id}?from=/projects/manage`}>
                    <Button variant="ghost" size="sm" className="h-8 px-2">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
