'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

  // Auto-select first category on load or when categories change
  useEffect(() => {
    if (categories.length > 0 && !selectedCategoryId) {
      setSelectedCategoryId(categories[0].id);
    } else if (categories.length > 0 && selectedCategoryId) {
      // Check if selected category still exists
      const categoryExists = categories.some(c => c.id === selectedCategoryId);
      if (!categoryExists) {
        setSelectedCategoryId(categories[0].id);
      }
    } else if (categories.length === 0) {
      setSelectedCategoryId(null);
    }
  }, [categories, selectedCategoryId]);

  const selectedCategory = categories.find(c => c.id === selectedCategoryId);
  const categorySubcategories = selectedCategoryId
    ? subcategories.filter(s => s.category_id === selectedCategoryId).sort((a, b) => a.name.localeCompare(b.name))
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
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Settings className="h-16 w-16 text-slate-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            No Categories Yet
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-6 text-center max-w-md">
            Create your first workshop task category to organize repairs and maintenance work
          </p>
          <Button onClick={onAddCategory} className="bg-workshop hover:bg-workshop-dark text-white">
            <Plus className="h-4 w-4 mr-2" />
            Add First Category
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-slate-900 dark:text-white">Category Management</CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-400">
              Organize workshop tasks with categories and subcategories
            </CardDescription>
          </div>
          <Button onClick={onAddCategory} className="bg-workshop hover:bg-workshop-dark text-white">
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Left Column: Category List */}
          <div className="space-y-2">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 uppercase tracking-wide">
              Categories ({categories.length})
            </p>
            {categories
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((category) => {
                const subcategoryCount = subcategories.filter(s => s.category_id === category.id).length;
                const isSelected = selectedCategoryId === category.id;

                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategoryId(category.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-workshop/10 border-workshop dark:border-workshop'
                        : 'bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate ${
                          isSelected ? 'text-workshop dark:text-workshop' : 'text-slate-900 dark:text-white'
                        }`}>
                          {category.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-slate-600 dark:text-slate-400">
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
                <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-slate-700">
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-1">
                      {selectedCategory.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        Organized alphabetically
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditCategory(selectedCategory)}
                      className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white"
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
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide">
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
                    <div className="text-center py-8 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-slate-700">
                      <p className="text-slate-600 dark:text-slate-400 mb-3">
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
                            className="bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-slate-700"
                          >
                            {/* Subcategory Header */}
                            <div className="flex items-center justify-between p-3">
                              <div className="flex items-center gap-3 flex-1">
                                <span className="text-sm font-medium text-slate-900 dark:text-white">
                                  {subcategory.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onEditSubcategory(subcategory, selectedCategory)}
                                  className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white h-8 w-8 p-0"
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
                                  className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white h-8 w-8 p-0"
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
                              <div className="px-3 pb-3 border-t border-slate-200 dark:border-slate-700 pt-3">
                                <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
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
                <p className="text-slate-600 dark:text-slate-400">
                  Select a category from the list to view details
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
