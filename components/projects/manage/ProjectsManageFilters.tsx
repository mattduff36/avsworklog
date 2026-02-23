'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, ArrowUpDown } from 'lucide-react';
import type { ManageDocumentsQuery } from '@/types/rams';

interface DocumentTypeOption {
  id: string;
  name: string;
}

interface ProjectsManageFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortBy: NonNullable<ManageDocumentsQuery['sortBy']>;
  sortDir: NonNullable<ManageDocumentsQuery['sortDir']>;
  onSortChange: (field: NonNullable<ManageDocumentsQuery['sortBy']>) => void;
  typeFilter: string;
  onTypeFilterChange: (typeId: string) => void;
  documentTypes: DocumentTypeOption[];
  totalResults: number;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export function ProjectsManageFilters({
  searchQuery,
  onSearchChange,
  sortBy,
  sortDir,
  onSortChange,
  typeFilter,
  onTypeFilterChange,
  documentTypes,
  totalResults,
  onClearFilters,
  hasActiveFilters,
}: ProjectsManageFiltersProps) {
  return (
    <Card className="bg-white dark:bg-slate-900 border-border">
      <CardContent className="pt-4 pb-4">
        <div className="flex flex-col gap-3">
          {/* Row 1: Search + type filter */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-10 bg-white dark:bg-slate-800 border-border text-foreground"
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Select value={typeFilter || '_all'} onValueChange={(v) => onTypeFilterChange(v === '_all' ? '' : v)}>
              <SelectTrigger className="w-full sm:w-[200px] bg-white dark:bg-slate-800 border-border">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Types</SelectItem>
                {documentTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={`${sortBy}-${sortDir}`}
              onValueChange={(v) => {
                const field = v.split('-')[0] as NonNullable<ManageDocumentsQuery['sortBy']>;
                onSortChange(field);
              }}
            >
              <SelectTrigger className="w-full sm:w-[200px] bg-white dark:bg-slate-800 border-border">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Sort by..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at-desc">Newest First</SelectItem>
                <SelectItem value="created_at-asc">Oldest First</SelectItem>
                <SelectItem value="title-asc">Title A-Z</SelectItem>
                <SelectItem value="title-desc">Title Z-A</SelectItem>
                <SelectItem value="completion-desc">Most Complete</SelectItem>
                <SelectItem value="completion-asc">Least Complete</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Row 2: Result count + clear */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{totalResults} document{totalResults !== 1 ? 's' : ''}</span>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearFilters}
                className="h-6 px-2 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
