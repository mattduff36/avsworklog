'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, ChevronDown, ChevronUp, Settings } from 'lucide-react';

type Category = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  sort_order: number;
};

type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
};

interface CategoryManagementPanelProps {
  categories: Category[];
  subcategories: Subcategory[];
  onAddCategory: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onAddSubcategory: (category: Category) => void;
  onEditSubcategory: (subcategory: Subcategory, category: Category) => void;
  onDeleteSubcategory: (subcategoryId: string, subcategoryName: string) => void;
}

export function CategoryManagementPanel({
  categories,
  subcategories,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onAddSubcategory,
  onEditSubcategory,
  onDeleteSubcategory,
}: CategoryManagementPanelProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedSubcategories, setExpandedSubcategories] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(false);

  const effectiveSelectedCategoryId = useMemo(() => {
    if (selectedCategoryId && categories.some((category) => category.id === selectedCategoryId)) {
      return selectedCategoryId;
    }

    return categories[0]?.id ?? null;
  }, [categories, selectedCategoryId]);

  const selectedCategory = categories.find(c => c.id === effectiveSelectedCategoryId);
  const categorySubcategories = effectiveSelectedCategoryId
    ? subcategories
        .filter(s => s.category_id === effectiveSelectedCategoryId)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const toggleSubcategoryExpansion = (subcategoryId: string) => {
    const newExpanded = new Set(expandedSubcategories);
    if (newExpanded.has(subcategoryId)) {
      newExpanded.delete(subcategoryId);
    } else {
      newExpanded.add(subcategoryId);
    }
    setExpandedSubcategories(newExpanded);
  };

  if (categories.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader
          className="cursor-pointer hover:bg-slate-800/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <ChevronDown 
                className={`h-5 w-5 text-muted-foreground transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
              <div>
                <CardTitle className="text-white">Category Management</CardTitle>
                <CardDescription className="text-muted-foreground">
                  0 categories
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onAddCategory();
              }}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Category
            </Button>
          </div>
        </CardHeader>
        {isExpanded && (
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12">
              <Settings className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No Categories Yet
              </h3>
              <p className="text-muted-foreground text-center max-w-md">
                Create your first workshop task category to organize repairs and maintenance work
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader
        className="cursor-pointer hover:bg-slate-800/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <ChevronDown 
              className={`h-5 w-5 text-muted-foreground transition-transform ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
            <div>
              <CardTitle className="text-white">Category Management</CardTitle>
              <CardDescription className="text-muted-foreground">
                {categories.length} {categories.length === 1 ? 'category' : 'categories'} • Organize workshop tasks by type
              </CardDescription>
            </div>
          </div>
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onAddCategory();
            }}
            className="bg-workshop hover:bg-workshop-dark text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            {/* Left Column: Category List */}
            <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">
              Categories ({categories.length})
            </p>
            {categories
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((category) => {
                const subcategoryCount = subcategories.filter(s => s.category_id === category.id).length;
                const isSelected = effectiveSelectedCategoryId === category.id;

                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategoryId(category.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-workshop/10 border-workshop'
                        : 'bg-muted/30 border-border hover:border-border/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate ${
                          isSelected ? 'text-workshop' : 'text-foreground'
                        }`}>
                          {category.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {subcategoryCount} {subcategoryCount === 1 ? 'subcategory' : 'subcategories'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>

          {/* Right Column: Category Detail Panel */}
          <div className="space-y-4">
            {selectedCategory ? (
              <>
                {/* Category Header with Actions */}
                <div className="flex items-start justify-between pb-4 border-b border-border">
                  <div>
                    <h3 className="text-xl font-semibold text-foreground mb-1">
                      {selectedCategory.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Organized alphabetically
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditCategory(selectedCategory)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDeleteCategory(selectedCategory)}
                      className="border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Subcategories Section */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                      Subcategories ({categorySubcategories.length})
                    </h4>
                    <Button
                      size="sm"
                      onClick={() => onAddSubcategory(selectedCategory)}
                      className="bg-workshop/20 hover:bg-workshop/30 text-workshop border border-workshop/30"
                      variant="outline"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Subcategory
                    </Button>
                  </div>

                  {categorySubcategories.length === 0 ? (
                    <div className="text-center py-8 bg-muted/30 rounded-lg border border-border">
                      <p className="text-muted-foreground mb-3">
                        No subcategories yet
                      </p>
                      <Button
                        size="sm"
                        onClick={() => onAddSubcategory(selectedCategory)}
                        variant="outline"
                        className="border-workshop/30 text-workshop hover:bg-workshop/10"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add First Subcategory
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {categorySubcategories.map((subcategory) => {
                        const isExpanded = expandedSubcategories.has(subcategory.id);

                        return (
                          <div
                            key={subcategory.id}
                            className="bg-muted/30 rounded-lg border border-border"
                          >
                            {/* Subcategory Header */}
                            <div className="flex items-center justify-between p-3">
                              <div className="flex items-center gap-3 flex-1">
                                <span className="text-sm font-medium text-foreground">
                                  {subcategory.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onEditSubcategory(subcategory, selectedCategory)}
                                  className="h-8 w-8 p-0"
                                  title="Edit Subcategory"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onDeleteSubcategory(subcategory.id, subcategory.name)}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 h-8 w-8 p-0"
                                  title="Delete Subcategory"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleSubcategoryExpansion(subcategory.id)}
                                  className="h-8 w-8 p-0"
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </div>

                            {/* Expanded Details (placeholder for future info) */}
                            {isExpanded && (
                              <div className="px-3 pb-3 border-t border-border pt-3">
                                <div className="text-xs text-muted-foreground space-y-1">
                                  <p><span className="font-medium">Slug:</span> {subcategory.slug}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  Select a category from the list to view details
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      )}
    </Card>
  );
}
