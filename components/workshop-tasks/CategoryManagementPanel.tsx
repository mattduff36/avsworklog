'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Edit, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTabletMode } from '@/components/layout/tablet-mode-context';

type Category = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  sort_order: number;
};

type LinkedTemplate = {
  templateId: string;
  templateName: string;
  isActive: boolean;
  isRequired: boolean;
};

type LinkState =
  | { categoryId: string; status: 'ready'; templates: LinkedTemplate[] }
  | { categoryId: string; status: 'error' };

interface CategoryManagementPanelProps {
  assetPicker: ReactNode;
  categories: Category[];
  onAddCategory: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onOpenTemplate: (templateId: string) => void;
  active: boolean;
}

export function CategoryManagementPanel({
  categories,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onOpenTemplate,
  active,
  assetPicker,
}: CategoryManagementPanelProps) {
  const { tabletModeEnabled } = useTabletMode();
  const touchClassName = tabletModeEnabled ? 'min-h-11 text-base' : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<LinkState | null>(null);
  const [linkRetry, setLinkRetry] = useState(0);
  const sorted = useMemo(() => [...categories].sort((a, b) => a.name.localeCompare(b.name)), [categories]);
  const selected = sorted.find((category) => category.id === selectedId) ?? sorted[0];
  const categoryId = selected?.id;
  const links = linkState?.categoryId === categoryId ? linkState : null;

  useEffect(() => {
    if (!categoryId || !active) return;
    const id = categoryId;
    const request = new AbortController();
    async function loadLinks() {
      try {
        const response = await fetch(`/api/workshop-tasks/category-attachments?categoryId=${encodeURIComponent(id)}`, {
          signal: request.signal,
        });
        if (!response.ok) throw new Error('Failed to load linked attachments');
        const data = await response.json() as { allTemplates: LinkedTemplate[]; optionalTemplates: LinkedTemplate[] };
        if (!request.signal.aborted) {
          setLinkState({ categoryId: id, status: 'ready', templates: [...data.allTemplates, ...data.optionalTemplates] });
        }
      } catch {
        if (!request.signal.aborted) setLinkState({ categoryId: id, status: 'error' });
      }
    }
    void loadLinks();
    return () => request.abort();
  }, [active, categoryId, linkRetry]);

  return (
    <Card>
      <CardHeader>
          {assetPicker && <div className="mb-3">{assetPicker}</div>}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Task categories</CardTitle>
            <CardDescription>Manage the categories staff choose when they create a task.</CardDescription>
          </div>
          <Button size="sm" onClick={onAddCategory} className={touchClassName}>
            <Plus aria-hidden="true" className="h-4 w-4" /> Add category
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {selected ? (
          <div className="grid min-w-0 overflow-hidden rounded-lg border border-border md:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)]">
            <ul aria-label="Task categories" className="divide-y divide-border border-b border-border md:border-b-0 md:border-r">
              {sorted.map((category) => (
                <li key={category.id}>
                  <button
                    type="button"
                    aria-pressed={category.id === categoryId}
                    onClick={() => { if (category.id !== categoryId) { setLinkState(null); setSelectedId(category.id); } }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset aria-pressed:bg-[hsl(var(--workshop-primary)/0.28)] aria-pressed:hover:bg-[hsl(var(--workshop-primary)/0.34)] aria-pressed:font-semibold ${tabletModeEnabled ? 'min-h-11' : 'min-h-10'}`}
                  >
                    <span className="break-words">{category.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {!category.is_active && <Badge variant="outline">Inactive</Badge>}
                      {category.id === categoryId && <Check aria-hidden="true" className="h-4 w-4" />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <section aria-label={selected.name} className="min-w-0 space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold">{selected.name}</h3>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEditCategory(selected)}
                    className={`bg-[hsl(var(--workshop-primary)/0.22)] text-foreground hover:bg-[hsl(var(--workshop-primary)/0.32)] hover:text-foreground ${touchClassName ?? ''}`}
                  >
                    <Edit aria-hidden="true" /> Edit category
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDeleteCategory(selected)}
                    className={`bg-red-500/10 text-red-700 hover:bg-red-500/20 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200 ${touchClassName ?? ''}`}
                  >
                    <Trash2 aria-hidden="true" /> Delete
                  </Button>
                </div>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium text-muted-foreground">Linked attachments</h4>
                {!links && <p role="status" className="border-t border-border py-2 text-sm text-muted-foreground">Loading linked attachments…</p>}
                {links?.status === 'error' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
                    <span role="alert">Unable to load linked attachments.</span>
                    <Button size="sm" variant="outline" onClick={() => { setLinkState(null); setLinkRetry((value) => value + 1); }}>Retry</Button>
                  </div>
                )}
                {links?.status === 'ready' && (links.templates.length === 0 ? (
                  <p className="border-t border-border py-2 text-sm text-muted-foreground">No linked attachments.</p>
                ) : (
                  <ul className="divide-y divide-border border-t border-border">
                    {links.templates.map((template) => (
                      <li key={template.templateId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="break-words font-medium">{template.templateName}</p>
                          <p className="text-muted-foreground">{template.isActive
                            ? (template.isRequired ? 'Required when creating a task' : 'Optional when creating a task')
                            : 'Inactive'}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Open template ${template.templateName}`}
                          onClick={() => onOpenTemplate(template.templateId)}
                          className={`bg-[hsl(var(--workshop-primary)/0.13)] text-foreground hover:bg-[hsl(var(--workshop-primary)/0.23)] hover:text-foreground ${touchClassName ?? ''}`}
                        >
                          Open template <ArrowRight aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </section>
          </div>
        ) : <p className="text-sm text-muted-foreground">No task categories for this asset type.</p>}
      </CardContent>
    </Card>
  );
}
