'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  Loader2,
  X,
  AlertCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { formatFileSize } from '@/lib/utils/file-validation';
import type { ManageDocumentRow, ManageDocumentsQuery } from '@/types/rams';
import type { UploadingDoc } from '@/app/(dashboard)/projects/manage/page';

interface ProjectsDocumentsTableProps {
  documents: ManageDocumentRow[];
  uploadingDocs?: UploadingDoc[];
  sortBy: NonNullable<ManageDocumentsQuery['sortBy']>;
  sortDir: NonNullable<ManageDocumentsQuery['sortDir']>;
  onSortChange: (field: NonNullable<ManageDocumentsQuery['sortBy']>) => void;
  onDelete: (doc: ManageDocumentRow) => void;
  onToggleFavourite: (doc: ManageDocumentRow) => void;
  onReuse: (doc: ManageDocumentRow) => void;
  onDismissUpload?: (id: string) => void;
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
  uploadingDocs = [],
  sortBy,
  sortDir,
  onSortChange,
  onDelete,
  onToggleFavourite,
  onReuse,
  onDismissUpload,
}: ProjectsDocumentsTableProps) {
  const router = useRouter();

  return (
    <div className="hidden md:block rounded-lg border border-border overflow-x-auto bg-white dark:bg-slate-900">
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
          {/* Uploading rows (shown at the top) */}
          {uploadingDocs.map((up) => (
            <TableRow
              key={up.id}
              className="bg-rams/[0.03] hover:bg-rams/[0.06] transition-colors"
            >
              <TableCell>
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-rams shrink-0 mt-0.5 opacity-60" />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground line-clamp-1">
                      {up.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 block">
                      {up.fileType.toUpperCase()} &middot; {formatFileSize(up.fileSize)}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {up.documentTypeName || <span className="italic">None</span>}
              </TableCell>
              <TableCell>
                {up.status === 'error' ? (
                  <div className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Upload failed
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Progress
                      value={up.progress}
                      className="h-2 w-full"
                      indicatorClassName="bg-rams"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {up.status === 'processing' ? 'Processing...' : `${up.progress}%`}
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">You</TableCell>
              <TableCell>
                {up.status === 'uploading' || up.status === 'processing' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-rams" />
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                {up.status === 'error' && onDismissUpload && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onDismissUpload(up.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}

          {/* Existing documents */}
          {documents.map((doc) => (
            <TableRow
              key={doc.id}
              onClick={() => router.push(`/projects/${doc.id}?from=/projects/manage`)}
              className="group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
            >
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
              <TableCell className="text-sm text-muted-foreground">
                {doc.document_type_name || <span className="italic">None</span>}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground truncate max-w-[120px]">
                {doc.uploader_name}
              </TableCell>
              <TableCell>
                <CompletionBadge
                  signed={doc.total_signed}
                  assigned={doc.total_assigned}
                  requiresSig={doc.required_signature}
                />
              </TableCell>
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
