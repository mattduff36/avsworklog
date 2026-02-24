'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Star, Copy, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { FavouriteRow } from '@/lib/hooks/useProjectsManage';

interface ProjectsFavouriteStripProps {
  favourites: FavouriteRow[];
  onReuse: (fav: FavouriteRow) => void;
  onRemove: (documentId: string) => void;
  onView: (fav: FavouriteRow) => void;
  removingId?: string;
}

export function ProjectsFavouriteStrip({
  favourites,
  onReuse,
  onRemove,
  onView,
  removingId,
}: ProjectsFavouriteStripProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (favourites.length === 0) return null;

  return (
    <Card className="bg-white dark:bg-slate-900 border-border">
      <CardHeader className="pb-2 pt-4 px-4 cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
            <CardTitle className="text-sm font-semibold text-foreground">
              Favourites ({favourites.length})
            </CardTitle>
          </div>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="px-4 pb-4 pt-1">
          <div className="grid gap-2">
            {favourites.map((fav) => (
              <div
                key={fav.id}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:border-rams/50 transition-all duration-200"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {fav.document.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {fav.document.document_type?.name || 'No type'}
                      {' \u00B7 '}
                      {fav.document.file_type?.toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => onReuse(fav)}
                    className="h-7 px-2 bg-rams hover:bg-rams-dark text-white text-xs"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    <span className="hidden sm:inline">Use as Template</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onView(fav)}
                    className="h-7 px-2 text-xs"
                  >
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemove(fav.document_id)}
                    disabled={removingId === fav.document_id}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                    title="Remove from favourites"
                  >
                    <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
