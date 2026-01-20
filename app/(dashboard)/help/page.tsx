'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Search, 
  HelpCircle, 
  Lightbulb, 
  BookOpen, 
  Loader2,
  Send,
  CheckCircle2,
  ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { FAQArticleWithCategory, FAQCategory, Suggestion } from '@/types/faq';
import type { ModuleName } from '@/types/roles';

export default function HelpPage() {
  const { profile, isManager, isAdmin } = useAuth(); // Get user info
  const supabase = createClient();
  
  // FAQ state
  const [articles, setArticles] = useState<FAQArticleWithCategory[]>([]);
  const [categories, setCategories] = useState<FAQCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // Suggestion state
  const [suggestionTitle, setSuggestionTitle] = useState('');
  const [suggestionBody, setSuggestionBody] = useState('');
  const [suggestionPageHint, setSuggestionPageHint] = useState('');
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);
  const [mySuggestions, setMySuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  
  // Active tab
  const [activeTab, setActiveTab] = useState('faq');
  
  // User permissions
  const [userPermissions, setUserPermissions] = useState<Set<ModuleName>>(new Set());

  const fetchFAQ = useCallback(async (query: string, category: string | null) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (category) params.set('category', category);
      
      const response = await fetch(`/api/faq?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setArticles(data.articles);
        setCategories(data.categories);
      }
    } catch (error) {
      console.error('Error fetching FAQ:', error);
      toast.error('Failed to load FAQ content');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMySuggestions = useCallback(async () => {
    try {
      setLoadingSuggestions(true);
      const response = await fetch('/api/suggestions');
      const data = await response.json();
      
      if (data.success) {
        setMySuggestions(data.suggestions);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  // Fetch user permissions
  useEffect(() => {
    async function fetchPermissions() {
      if (!profile?.id) return;
      
      // Managers and admins have all permissions
      if (isManager || isAdmin) {
        setUserPermissions(new Set([
          'timesheets', 'inspections', 'rams', 'absence', 'maintenance', 'workshop-tasks',
          'approvals', 'actions', 'reports', 'admin-users', 'admin-vehicles'
        ] as ModuleName[]));
        return;
      }
      
      try {
        const { data } = await supabase
          .from('profiles')
          .select(`
            role_id,
            roles!inner(
              role_permissions(
                module_name,
                enabled
              )
            )
          `)
          .eq('id', profile.id)
          .single();
        
        // Build Set of enabled permissions
        const enabledModules = new Set<ModuleName>();
        data?.roles?.role_permissions?.forEach((perm: { enabled: boolean; module_name: string }) => {
          if (perm.enabled) {
            enabledModules.add(perm.module_name as ModuleName);
          }
        });
        
        setUserPermissions(enabledModules);
      } catch (error) {
        console.error('Error fetching permissions:', error);
        setUserPermissions(new Set());
      }
    }
    fetchPermissions();
  }, [profile?.id, isManager, isAdmin, supabase]);

  // Fetch FAQ data on mount
  useEffect(() => {
    fetchFAQ('', null);
  }, [fetchFAQ]);

  // Fetch user's suggestions when tab changes
  useEffect(() => {
    if (activeTab === 'my-suggestions') {
      fetchMySuggestions();
    }
  }, [activeTab, fetchMySuggestions]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFAQ(searchQuery, selectedCategory);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory, fetchFAQ]);

  // Filter categories based on user permissions
  const filteredCategories = useMemo(() => {
    // Managers and admins see all categories
    if (isManager || isAdmin) {
      return categories;
    }
    
    // Filter categories based on module permissions
    return categories.filter(category => {
      // If category has no module requirement, show it to everyone
      if (!category.module_name) {
        return true;
      }
      
      // Check if user has permission to this module
      return userPermissions.has(category.module_name as ModuleName);
    });
  }, [categories, userPermissions, isManager, isAdmin]);

  // Filter articles to only show those in accessible categories
  const filteredArticles = useMemo(() => {
    const accessibleCategoryIds = new Set(filteredCategories.map(cat => cat.id));
    return articles.filter(article => accessibleCategoryIds.has(article.category_id));
  }, [articles, filteredCategories]);

  // Group filtered articles by category
  const articlesByCategory = useMemo(() => {
    const grouped: Record<string, FAQArticleWithCategory[]> = {};
    filteredArticles.forEach(article => {
      const catSlug = article.category?.slug || 'uncategorized';
      if (!grouped[catSlug]) {
        grouped[catSlug] = [];
      }
      grouped[catSlug].push(article);
    });
    return grouped;
  }, [filteredArticles]);

  // Handle suggestion submission
  const handleSubmitSuggestion = async () => {
    if (!suggestionTitle.trim() || !suggestionBody.trim()) {
      toast.error('Please fill in both title and description');
      return;
    }

    try {
      setSubmittingSuggestion(true);
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: suggestionTitle.trim(),
          body: suggestionBody.trim(),
          page_hint: suggestionPageHint.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Suggestion submitted successfully!');
        setSuggestionTitle('');
        setSuggestionBody('');
        setSuggestionPageHint('');
        // Refresh suggestions list if on that tab
        if (activeTab === 'my-suggestions') {
          fetchMySuggestions();
        }
      } else {
        throw new Error(data.error || 'Failed to submit suggestion');
      }
    } catch (error) {
      console.error('Error submitting suggestion:', error);
      toast.error('Failed to submit suggestion');
    } finally {
      setSubmittingSuggestion(false);
    }
  };

  // Render markdown content (simple version)
  const renderMarkdown = (content: string) => {
    // Simple markdown to HTML conversion
    return content
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-slate-900 dark:text-white">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-6 mb-3 text-slate-900 dark:text-white">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4 text-slate-900 dark:text-white">$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/^- (.*$)/gim, '<li class="ml-4">$1</li>')
      .replace(/^(\d+)\. (.*$)/gim, '<li class="ml-4">$2</li>')
      .replace(/\n\n/g, '</p><p class="mb-3 text-slate-600 dark:text-slate-300">')
      .replace(/\n/g, '<br/>');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-500';
      case 'under_review': return 'bg-yellow-500';
      case 'planned': return 'bg-purple-500';
      case 'completed': return 'bg-green-500';
      case 'declined': return 'bg-slate-500';
      default: return 'bg-slate-500';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return 'New';
      case 'under_review': return 'Under Review';
      case 'planned': return 'Planned';
      case 'completed': return 'Completed';
      case 'declined': return 'Declined';
      default: return status;
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 dark:bg-blue-950 rounded-lg">
            <HelpCircle className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Help & FAQ
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
              Find answers to common questions and submit suggestions
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-lg grid-cols-3 bg-slate-100 dark:bg-slate-800 p-1">
          <TabsTrigger value="faq" className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <BookOpen className="h-4 w-4" />
            FAQ
          </TabsTrigger>
          <TabsTrigger value="suggest" className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <Lightbulb className="h-4 w-4" />
            Suggest
          </TabsTrigger>
          <TabsTrigger value="my-suggestions" className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <CheckCircle2 className="h-4 w-4" />
            My Suggestions
          </TabsTrigger>
        </TabsList>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-6">
          {/* Search Bar */}
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search FAQ articles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-100 text-slate-900"
                />
              </div>
              
              {/* Category Filter */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant={selectedCategory === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(null)}
                  className={selectedCategory === null ? 'bg-blue-600 hover:bg-blue-700' : ''}
                >
                  All Categories
                </Button>
                {filteredCategories.map((category) => (
                  <Button
                    key={category.id}
                    variant={selectedCategory === category.slug ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategory(category.slug)}
                    className={selectedCategory === category.slug ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  >
                    {category.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* FAQ Content */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : filteredArticles.length === 0 ? (
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardContent className="py-12 text-center">
                <HelpCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500">
                  {searchQuery ? 'No articles found matching your search.' : 'No FAQ articles available yet.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Group by category if no specific category selected */}
              {selectedCategory === null ? (
                filteredCategories.map((category) => {
                  const catArticles = articlesByCategory[category.slug] || [];
                  if (catArticles.length === 0) return null;
                  
                  return (
                    <Card key={category.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg text-slate-900 dark:text-white flex items-center gap-2">
                          <ChevronRight className="h-5 w-5 text-blue-500" />
                          {category.name}
                        </CardTitle>
                        {category.description && (
                          <CardDescription className="text-slate-500">
                            {category.description}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <Accordion type="single" collapsible className="w-full">
                          {catArticles.map((article) => (
                            <AccordionItem key={article.id} value={article.id}>
                              <AccordionTrigger className="text-left text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">
                                {article.title}
                              </AccordionTrigger>
                              <AccordionContent>
                                {article.summary && (
                                  <p className="text-slate-500 dark:text-slate-400 mb-4 italic">
                                    {article.summary}
                                  </p>
                                )}
                                <div 
                                  className="prose prose-sm dark:prose-invert max-w-none text-slate-600 dark:text-slate-300"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content_md) }}
                                />
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                  <CardContent className="pt-6">
                    <Accordion type="single" collapsible className="w-full">
                      {filteredArticles.map((article) => (
                        <AccordionItem key={article.id} value={article.id}>
                          <AccordionTrigger className="text-left text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">
                            {article.title}
                          </AccordionTrigger>
                          <AccordionContent>
                            {article.summary && (
                              <p className="text-slate-500 dark:text-slate-400 mb-4 italic">
                                {article.summary}
                              </p>
                            )}
                            <div 
                              className="prose prose-sm dark:prose-invert max-w-none text-slate-600 dark:text-slate-300"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content_md) }}
                            />
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Submit Suggestion Tab */}
        <TabsContent value="suggest">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                Submit a Suggestion
              </CardTitle>
              <CardDescription className="text-slate-500">
                Have an idea to improve the app? We&apos;d love to hear it!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="suggestion-title" className="text-slate-700 dark:text-slate-300">
                  Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="suggestion-title"
                  placeholder="Brief title for your suggestion"
                  value={suggestionTitle}
                  onChange={(e) => setSuggestionTitle(e.target.value)}
                  className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-100 text-slate-900"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="suggestion-body" className="text-slate-700 dark:text-slate-300">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="suggestion-body"
                  placeholder="Describe your suggestion in detail..."
                  value={suggestionBody}
                  onChange={(e) => setSuggestionBody(e.target.value)}
                  rows={5}
                  className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-100 text-slate-900"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="suggestion-page" className="text-slate-700 dark:text-slate-300">
                  Related Page/Feature (optional)
                </Label>
                <Input
                  id="suggestion-page"
                  placeholder="e.g., Timesheets, Inspections, Dashboard"
                  value={suggestionPageHint}
                  onChange={(e) => setSuggestionPageHint(e.target.value)}
                  className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-100 text-slate-900"
                />
              </div>

              <Button
                onClick={handleSubmitSuggestion}
                disabled={submittingSuggestion || !suggestionTitle.trim() || !suggestionBody.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {submittingSuggestion ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit Suggestion
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* My Suggestions Tab */}
        <TabsContent value="my-suggestions">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white">
                My Suggestions
              </CardTitle>
              <CardDescription className="text-slate-500">
                Track the status of your submitted suggestions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSuggestions ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : mySuggestions.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Lightbulb className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                  <p>You haven&apos;t submitted any suggestions yet.</p>
                  <Button
                    variant="link"
                    onClick={() => setActiveTab('suggest')}
                    className="mt-2"
                  >
                    Submit your first suggestion
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {mySuggestions.map((suggestion) => (
                    <div 
                      key={suggestion.id}
                      className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-medium text-slate-900 dark:text-white">
                            {suggestion.title}
                          </h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                            {suggestion.body}
                          </p>
                          {suggestion.page_hint && (
                            <p className="text-xs text-slate-400 mt-2">
                              Related to: {suggestion.page_hint}
                            </p>
                          )}
                        </div>
                        <Badge className={`${getStatusColor(suggestion.status)} text-white`}>
                          {getStatusLabel(suggestion.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 mt-3">
                        Submitted {new Date(suggestion.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
