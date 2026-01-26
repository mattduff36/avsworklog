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
  ChevronRight,
  AlertTriangle,
  Settings
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { FAQArticleWithCategory, FAQCategory, Suggestion } from '@/types/faq';
import type { ErrorReport } from '@/types/error-reports';
import type { ModuleName } from '@/types/roles';
import Link from 'next/link';

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
  
  // Error report state
  const [errorTitle, setErrorTitle] = useState('');
  const [errorDescription, setErrorDescription] = useState('');
  const [errorPageHint, setErrorPageHint] = useState('');
  const [submittingError, setSubmittingError] = useState(false);
  const [myErrors, setMyErrors] = useState<ErrorReport[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  
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

  const fetchMyErrors = useCallback(async () => {
    try {
      setLoadingErrors(true);
      const response = await fetch('/api/error-reports');
      const data = await response.json();
      
      if (data.success) {
        setMyErrors(data.reports);
      }
    } catch (error) {
      console.error('Error fetching error reports:', error);
    } finally {
      setLoadingErrors(false);
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

  // Fetch user's error reports when tab changes
  useEffect(() => {
    if (activeTab === 'my-errors') {
      fetchMyErrors();
    }
  }, [activeTab, fetchMyErrors]);

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

  // Handle error report submission
  const handleSubmitError = async () => {
    if (!errorTitle.trim() || !errorDescription.trim()) {
      toast.error('Please fill in both title and description');
      return;
    }

    try {
      setSubmittingError(true);
      const response = await fetch('/api/errors/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: errorTitle.trim(),
          description: errorDescription.trim(),
          page_url: errorPageHint.trim() || (typeof window !== 'undefined' ? window.location.href : undefined),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Error reported successfully!', {
          description: 'Admins have been notified and will investigate.'
        });
        setErrorTitle('');
        setErrorDescription('');
        setErrorPageHint('');
        // Refresh error reports list if on that tab
        if (activeTab === 'my-errors') {
          fetchMyErrors();
        }
      } else {
        throw new Error(data.error || 'Failed to submit error report');
      }
    } catch (error) {
      console.error('Error submitting error report:', error);
      toast.error('Failed to submit error report');
    } finally {
      setSubmittingError(false);
    }
  };

  // Render markdown content (simple version)
  const renderMarkdown = (content: string) => {
    // Simple markdown to HTML conversion
    return content
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-foreground">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-6 mb-3 text-foreground">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4 text-foreground">$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/^- (.*$)/gim, '<li class="ml-4">$1</li>')
      .replace(/^(\d+)\. (.*$)/gim, '<li class="ml-4">$2</li>')
      .replace(/\n\n/g, '</p><p class="mb-3 text-foreground">')
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

  const getErrorStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-red-500';
      case 'investigating': return 'bg-yellow-500';
      case 'resolved': return 'bg-green-500';
      default: return 'bg-slate-500';
    }
  };

  const getErrorStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return 'New';
      case 'investigating': return 'Investigating';
      case 'resolved': return 'Resolved';
      default: return status;
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Help & FAQ
        </h1>
        <p className="text-muted-foreground">
          Find answers to common questions and submit suggestions
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-3xl grid-cols-4 bg-slate-100 dark:bg-slate-800 p-1">
          <TabsTrigger value="faq" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
            <BookOpen className="h-4 w-4" />
            FAQ
          </TabsTrigger>
          <TabsTrigger value="errors" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
            <AlertTriangle className="h-4 w-4" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="suggest" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
            <Lightbulb className="h-4 w-4" />
            Suggest
          </TabsTrigger>
          <TabsTrigger value="my-suggestions" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
            <CheckCircle2 className="h-4 w-4" />
            My Suggestions
          </TabsTrigger>
        </TabsList>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-6">
          {/* Search Bar */}
          <Card className="">
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search FAQ articles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              {/* Category Filter */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant={selectedCategory === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(null)}
                  className={selectedCategory === null ? 'bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900' : ''}
                >
                  All Categories
                </Button>
                {filteredCategories.map((category) => (
                  <Button
                    key={category.id}
                    variant={selectedCategory === category.slug ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategory(category.slug)}
                    className={selectedCategory === category.slug ? 'bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900' : ''}
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
              <Loader2 className="h-8 w-8 animate-spin text-avs-yellow" />
            </div>
          ) : filteredArticles.length === 0 ? (
            <Card className="">
              <CardContent className="py-12 text-center">
                <HelpCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
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
                    <Card key={category.id} className="">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg text-foreground flex items-center gap-2">
                          <ChevronRight className="h-5 w-5 text-avs-yellow" />
                          {category.name}
                        </CardTitle>
                        {category.description && (
                          <CardDescription className="text-muted-foreground">
                            {category.description}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <Accordion type="single" collapsible className="w-full">
                          {catArticles.map((article) => (
                            <AccordionItem key={article.id} value={article.id}>
                              <AccordionTrigger className="text-left text-foreground hover:text-avs-yellow">
                                {article.title}
                              </AccordionTrigger>
                              <AccordionContent>
                                {article.summary && (
                                  <p className="text-muted-foreground mb-4 italic">
                                    {article.summary}
                                  </p>
                                )}
                                <div 
                                  className="prose prose-sm dark:prose-invert max-w-none"
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
                <Card className="">
                  <CardContent className="pt-6">
                    <Accordion type="single" collapsible className="w-full">
                      {filteredArticles.map((article) => (
                        <AccordionItem key={article.id} value={article.id}>
                          <AccordionTrigger className="text-left text-foreground hover:text-avs-yellow">
                            {article.title}
                          </AccordionTrigger>
                          <AccordionContent>
                            {article.summary && (
                              <p className="text-muted-foreground mb-4 italic">
                                {article.summary}
                              </p>
                            )}
                            <div 
                              className="prose prose-sm dark:prose-invert max-w-none"
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

        {/* Errors Tab */}
        <TabsContent value="errors" className="space-y-6">
          {/* Report Error Form */}
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Report an Error
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Found a bug or issue? Let us know and we&apos;ll investigate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="error-title">
                  Error Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="error-title"
                  placeholder="Brief description of the error"
                  value={errorTitle}
                  onChange={(e) => setErrorTitle(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="error-description">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="error-description"
                  placeholder="What happened? What did you expect to happen? Steps to reproduce..."
                  value={errorDescription}
                  onChange={(e) => setErrorDescription(e.target.value)}
                  rows={5}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="error-page">
                  Page/Feature (optional)
                </Label>
                <Input
                  id="error-page"
                  placeholder="e.g., Timesheets, Inspections, Dashboard"
                  value={errorPageHint}
                  onChange={(e) => setErrorPageHint(e.target.value)}
                />
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                <p className="text-sm text-blue-900 dark:text-blue-300">
                  <strong>Tip:</strong> Include any error messages, codes, or screenshots you saw. The more detail you provide, the faster we can fix it!
                </p>
              </div>

              <Button
                onClick={handleSubmitError}
                disabled={submittingError || !errorTitle.trim() || !errorDescription.trim()}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {submittingError ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit Error Report
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* My Errors */}
          <Card className="">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-foreground">
                    My Error Reports
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Track the status of your reported errors
                  </CardDescription>
                </div>
                {isAdmin && (
                  <Link href="/errors/manage">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Settings className="h-4 w-4" />
                      Manage All Errors
                    </Button>
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loadingErrors ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-red-500" />
                </div>
              ) : myErrors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p>You haven&apos;t reported any errors yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {myErrors.map((error) => (
                    <div 
                      key={error.id}
                      className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-medium text-foreground">
                            {error.title}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {error.description}
                          </p>
                          {error.page_url && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Page: {error.page_url}
                            </p>
                          )}
                        </div>
                        <Badge className={`${getErrorStatusColor(error.status)} text-white`}>
                          {getErrorStatusLabel(error.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        Reported {new Date(error.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Submit Suggestion Tab */}
        <TabsContent value="suggest">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                Submit a Suggestion
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Have an idea to improve the app? We&apos;d love to hear it!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="suggestion-title">
                  Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="suggestion-title"
                  placeholder="Brief title for your suggestion"
                  value={suggestionTitle}
                  onChange={(e) => setSuggestionTitle(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="suggestion-body">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="suggestion-body"
                  placeholder="Describe your suggestion in detail..."
                  value={suggestionBody}
                  onChange={(e) => setSuggestionBody(e.target.value)}
                  rows={5}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="suggestion-page">
                  Related Page/Feature (optional)
                </Label>
                <Input
                  id="suggestion-page"
                  placeholder="e.g., Timesheets, Inspections, Dashboard"
                  value={suggestionPageHint}
                  onChange={(e) => setSuggestionPageHint(e.target.value)}
                />
              </div>

              <Button
                onClick={handleSubmitSuggestion}
                disabled={submittingSuggestion || !suggestionTitle.trim() || !suggestionBody.trim()}
                className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
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
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                My Suggestions
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Track the status of your submitted suggestions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSuggestions ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-avs-yellow" />
                </div>
              ) : mySuggestions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
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
                      className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-medium text-foreground">
                            {suggestion.title}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {suggestion.body}
                          </p>
                          {suggestion.page_hint && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Related to: {suggestion.page_hint}
                            </p>
                          )}
                        </div>
                        <Badge className={`${getStatusColor(suggestion.status)} text-white`}>
                          {getStatusLabel(suggestion.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
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
