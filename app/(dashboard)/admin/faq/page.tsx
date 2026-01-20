'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  HelpCircle, 
  Loader2, 
  Plus,
  Edit,
  Trash2,
  FolderOpen,
  FileText,
  Eye,
  EyeOff
} from 'lucide-react';
import { toast } from 'sonner';
import type { FAQCategory, FAQArticleWithCategory } from '@/types/faq';

export default function FAQEditorPage() {
  const router = useRouter();
  const { isAdmin, loading: authLoading } = useAuth();
  
  const [activeTab, setActiveTab] = useState('categories');
  
  // Categories state
  const [categories, setCategories] = useState<(FAQCategory & { article_count: number })[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  
  // Articles state
  const [articles, setArticles] = useState<FAQArticleWithCategory[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  
  // Category dialog
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FAQCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    slug: '',
    description: '',
    sort_order: 0,
  });
  const [savingCategory, setSavingCategory] = useState(false);
  
  // Article dialog
  const [articleDialogOpen, setArticleDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<FAQArticleWithCategory | null>(null);
  const [articleForm, setArticleForm] = useState({
    category_id: '',
    title: '',
    slug: '',
    summary: '',
    content_md: '',
    is_published: true,
    sort_order: 0,
  });
  const [savingArticle, setSavingArticle] = useState(false);
  
  // Delete dialogs
  const [deleteCategoryDialog, setDeleteCategoryDialog] = useState<FAQCategory | null>(null);
  const [deleteArticleDialog, setDeleteArticleDialog] = useState<FAQArticleWithCategory | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const fetchCategories = useCallback(async () => {
    try {
      setLoadingCategories(true);
      const response = await fetch('/api/admin/faq/categories');
      const data = await response.json();
      
      if (data.success) {
        setCategories(data.categories);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      toast.error('Failed to load categories');
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  const fetchArticles = useCallback(async (categoryFilter: string) => {
    try {
      setLoadingArticles(true);
      const params = new URLSearchParams();
      if (categoryFilter !== 'all') {
        params.set('category_id', categoryFilter);
      }
      
      const response = await fetch(`/api/admin/faq/articles?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setArticles(data.articles);
      }
    } catch (error) {
      console.error('Error fetching articles:', error);
      toast.error('Failed to load articles');
    } finally {
      setLoadingArticles(false);
    }
  }, []);

  // Fetch data on mount
  useEffect(() => {
    if (isAdmin) {
      fetchCategories();
      fetchArticles('all');
    }
  }, [isAdmin, fetchCategories, fetchArticles]);

  // Refetch articles when filter changes
  useEffect(() => {
    if (isAdmin) {
      fetchArticles(selectedCategoryFilter);
    }
  }, [selectedCategoryFilter, isAdmin, fetchArticles]);

  // Category handlers
  const openAddCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', slug: '', description: '', sort_order: categories.length });
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: FAQCategory) => {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      sort_order: category.sort_order,
    });
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim() || !categoryForm.slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }

    try {
      setSavingCategory(true);
      
      const url = editingCategory 
        ? `/api/admin/faq/categories/${editingCategory.id}`
        : '/api/admin/faq/categories';
      
      const response = await fetch(url, {
        method: editingCategory ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryForm),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(editingCategory ? 'Category updated' : 'Category created');
        setCategoryDialogOpen(false);
        fetchCategories();
      } else {
        throw new Error(data.error || 'Failed to save category');
      }
    } catch (error) {
      console.error('Error saving category:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save category');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryDialog) return;

    try {
      setDeleting(true);
      const response = await fetch(`/api/admin/faq/categories/${deleteCategoryDialog.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Category deleted');
        setDeleteCategoryDialog(null);
        fetchCategories();
      } else {
        throw new Error(data.error || 'Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete category');
    } finally {
      setDeleting(false);
    }
  };

  // Article handlers
  const openAddArticle = () => {
    setEditingArticle(null);
    setArticleForm({
      category_id: categories[0]?.id || '',
      title: '',
      slug: '',
      summary: '',
      content_md: '',
      is_published: true,
      sort_order: 0,
    });
    setArticleDialogOpen(true);
  };

  const openEditArticle = (article: FAQArticleWithCategory) => {
    setEditingArticle(article);
    setArticleForm({
      category_id: article.category_id,
      title: article.title,
      slug: article.slug,
      summary: article.summary || '',
      content_md: article.content_md,
      is_published: article.is_published,
      sort_order: article.sort_order,
    });
    setArticleDialogOpen(true);
  };

  const handleSaveArticle = async () => {
    if (!articleForm.category_id || !articleForm.title.trim() || !articleForm.slug.trim() || !articleForm.content_md.trim()) {
      toast.error('Category, title, slug, and content are required');
      return;
    }

    try {
      setSavingArticle(true);
      
      const url = editingArticle 
        ? `/api/admin/faq/articles/${editingArticle.id}`
        : '/api/admin/faq/articles';
      
      const response = await fetch(url, {
        method: editingArticle ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(articleForm),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(editingArticle ? 'Article updated' : 'Article created');
        setArticleDialogOpen(false);
        fetchArticles();
      } else {
        throw new Error(data.error || 'Failed to save article');
      }
    } catch (error) {
      console.error('Error saving article:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save article');
    } finally {
      setSavingArticle(false);
    }
  };

  const handleDeleteArticle = async () => {
    if (!deleteArticleDialog) return;

    try {
      setDeleting(true);
      const response = await fetch(`/api/admin/faq/articles/${deleteArticleDialog.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Article deleted');
        setDeleteArticleDialog(null);
        fetchArticles();
      } else {
        throw new Error(data.error || 'Failed to delete article');
      }
    } catch (error) {
      console.error('Error deleting article:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete article');
    } finally {
      setDeleting(false);
    }
  };

  // Auto-generate slug from title
  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 dark:bg-blue-950 rounded-lg">
            <HelpCircle className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
              FAQ Editor
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
              Manage FAQ categories and articles
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2 bg-slate-100 dark:bg-slate-800 p-1">
          <TabsTrigger value="categories" className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <FolderOpen className="h-4 w-4" />
            Categories
          </TabsTrigger>
          <TabsTrigger value="articles" className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <FileText className="h-4 w-4" />
            Articles
          </TabsTrigger>
        </TabsList>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">Categories</CardTitle>
                  <CardDescription className="text-slate-500">
                    Organize FAQ articles into categories
                  </CardDescription>
                </div>
                <Button onClick={openAddCategory} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingCategories ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : categories.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <FolderOpen className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                  <p>No categories yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {categories.map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-slate-900 dark:text-white">
                            {category.name}
                          </h3>
                          <Badge variant="secondary" className="text-xs">
                            {category.article_count} articles
                          </Badge>
                          {!category.is_active && (
                            <Badge variant="outline" className="text-xs text-slate-400">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-500">
                          /{category.slug}
                        </p>
                        {category.description && (
                          <p className="text-sm text-slate-400 mt-1">
                            {category.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditCategory(category)}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteCategoryDialog(category)}
                          className="text-red-500 hover:text-red-600"
                          disabled={category.article_count > 0}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Articles Tab */}
        <TabsContent value="articles">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">Articles</CardTitle>
                  <CardDescription className="text-slate-500">
                    Manage FAQ content
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
                    <SelectTrigger className="w-48 bg-slate-50 dark:bg-slate-800">
                      <SelectValue placeholder="Filter by category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    onClick={openAddArticle} 
                    className="bg-blue-600 hover:bg-blue-700"
                    disabled={categories.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Article
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingArticles ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : articles.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                  <p>No articles yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {articles.map((article) => (
                    <div
                      key={article.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-slate-900 dark:text-white truncate">
                            {article.title}
                          </h3>
                          {article.is_published ? (
                            <Eye className="h-4 w-4 text-green-500" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Badge variant="outline" className="text-xs">
                            {article.category?.name}
                          </Badge>
                          <span>/{article.slug}</span>
                        </div>
                        {article.summary && (
                          <p className="text-sm text-slate-400 mt-1 truncate">
                            {article.summary}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditArticle(article)}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteArticleDialog(article)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white">
              {editingCategory ? 'Edit Category' : 'Add Category'}
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              {editingCategory ? 'Update category details' : 'Create a new FAQ category'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Name</Label>
              <Input
                value={categoryForm.name}
                onChange={(e) => {
                  setCategoryForm({
                    ...categoryForm,
                    name: e.target.value,
                    slug: editingCategory ? categoryForm.slug : generateSlug(e.target.value),
                  });
                }}
                placeholder="Category name"
                className="bg-slate-50 dark:bg-slate-800"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Slug</Label>
              <Input
                value={categoryForm.slug}
                onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })}
                placeholder="category-slug"
                className="bg-slate-50 dark:bg-slate-800"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Description (optional)</Label>
              <Textarea
                value={categoryForm.description}
                onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                placeholder="Brief description"
                rows={2}
                className="bg-slate-50 dark:bg-slate-800"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Sort Order</Label>
              <Input
                type="number"
                value={categoryForm.sort_order}
                onChange={(e) => setCategoryForm({ ...categoryForm, sort_order: parseInt(e.target.value) || 0 })}
                className="bg-slate-50 dark:bg-slate-800"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCategory} disabled={savingCategory} className="bg-blue-600 hover:bg-blue-700">
              {savingCategory ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Article Dialog */}
      <Dialog open={articleDialogOpen} onOpenChange={setArticleDialogOpen}>
        <DialogContent className="max-w-3xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white">
              {editingArticle ? 'Edit Article' : 'Add Article'}
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              {editingArticle ? 'Update article content' : 'Create a new FAQ article'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-slate-300">Category</Label>
                <Select 
                  value={articleForm.category_id} 
                  onValueChange={(v) => setArticleForm({ ...articleForm, category_id: v })}
                >
                  <SelectTrigger className="bg-slate-50 dark:bg-slate-800">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-slate-300">Sort Order</Label>
                <Input
                  type="number"
                  value={articleForm.sort_order}
                  onChange={(e) => setArticleForm({ ...articleForm, sort_order: parseInt(e.target.value) || 0 })}
                  className="bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Title</Label>
              <Input
                value={articleForm.title}
                onChange={(e) => {
                  setArticleForm({
                    ...articleForm,
                    title: e.target.value,
                    slug: editingArticle ? articleForm.slug : generateSlug(e.target.value),
                  });
                }}
                placeholder="Article title"
                className="bg-slate-50 dark:bg-slate-800"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Slug</Label>
              <Input
                value={articleForm.slug}
                onChange={(e) => setArticleForm({ ...articleForm, slug: e.target.value })}
                placeholder="article-slug"
                className="bg-slate-50 dark:bg-slate-800"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Summary (optional)</Label>
              <Input
                value={articleForm.summary}
                onChange={(e) => setArticleForm({ ...articleForm, summary: e.target.value })}
                placeholder="Brief summary shown in search results"
                className="bg-slate-50 dark:bg-slate-800"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Content (Markdown)</Label>
              <Textarea
                value={articleForm.content_md}
                onChange={(e) => setArticleForm({ ...articleForm, content_md: e.target.value })}
                placeholder="# Heading&#10;&#10;Article content in markdown format..."
                rows={12}
                className="bg-slate-50 dark:bg-slate-800 font-mono text-sm"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Switch
                checked={articleForm.is_published}
                onCheckedChange={(checked) => setArticleForm({ ...articleForm, is_published: checked })}
              />
              <Label className="text-slate-700 dark:text-slate-300">Published</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setArticleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveArticle} disabled={savingArticle} className="bg-blue-600 hover:bg-blue-700">
              {savingArticle ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingArticle ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category Dialog */}
      <AlertDialog open={!!deleteCategoryDialog} onOpenChange={() => setDeleteCategoryDialog(null)}>
        <AlertDialogContent className="bg-white dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteCategoryDialog?.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Article Dialog */}
      <AlertDialog open={!!deleteArticleDialog} onOpenChange={() => setDeleteArticleDialog(null)}>
        <AlertDialogContent className="bg-white dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Article</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteArticleDialog?.title}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteArticle}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
