/**
 * Sitemap parent route configuration
 * Maps current pathnames to their logical parent routes
 */

/**
 * Get the parent route for a given pathname
 * @param pathname - The current pathname
 * @param searchParams - Optional search params (for context like fromTab)
 * @param userRole - Optional user role context (for role-specific navigation)
 * @returns The parent route path
 */
export function getParentHref(
  pathname: string, 
  searchParams?: URLSearchParams | null,
  userRole?: { isManager?: boolean; isAdmin?: boolean }
): string {
  // Normalize pathname (remove trailing slashes)
  const normalizedPath = pathname.replace(/\/$/, '');
  
  // RAMS routes
  if (normalizedPath === '/rams/manage') {
    return '/rams';
  }
  if (normalizedPath.match(/^\/rams\/[^/]+$/)) {
    // /rams/[id] - manager/admin goes to manage, others to list
    return (userRole?.isManager || userRole?.isAdmin) ? '/rams/manage' : '/rams';
  }
  if (normalizedPath.match(/^\/rams\/[^/]+\/read$/)) {
    return '/rams';
  }
  
  // Fleet routes - support fromTab query param
  if (normalizedPath.match(/^\/fleet\/vehicles\/[^/]+\/history$/)) {
    const fromTab = searchParams?.get('fromTab');
    // Validate fromTab to prevent injection
    const validTabs = ['maintenance', 'plant', 'vehicles', 'settings'];
    if (fromTab && validTabs.includes(fromTab)) {
      return `/fleet?tab=${fromTab}`;
    }
    // Default fallback to vehicles tab
    return '/fleet?tab=vehicles';
  }
  
  // Inspection routes
  if (normalizedPath === '/inspections/new') {
    return '/inspections';
  }
  if (normalizedPath.match(/^\/inspections\/[^/]+$/)) {
    return '/inspections';
  }
  
  // Timesheet routes
  if (normalizedPath === '/timesheets/new') {
    return '/timesheets';
  }
  if (normalizedPath.match(/^\/timesheets\/[^/]+$/)) {
    return '/timesheets';
  }
  
  // Absence routes
  if (normalizedPath === '/absence/manage/allowances') {
    return '/absence/manage';
  }
  if (normalizedPath === '/absence/manage/reasons') {
    return '/absence/manage';
  }
  if (normalizedPath === '/absence/manage') {
    return '/absence';
  }
  
  // Workshop tasks routes
  if (normalizedPath.match(/^\/workshop-tasks\/[^/]+$/)) {
    return '/workshop-tasks';
  }
  
  // Suggestions routes
  if (normalizedPath === '/suggestions/manage') {
    return '/dashboard'; // or '/suggestions' if there's a list view
  }
  
  // Admin routes
  if (normalizedPath === '/admin/faq') {
    return '/dashboard';
  }
  if (normalizedPath === '/admin/users') {
    return '/dashboard';
  }
  if (normalizedPath === '/admin/vehicles') {
    return '/dashboard';
  }
  
  // Approvals
  if (normalizedPath === '/approvals') {
    return '/dashboard';
  }
  
  // Actions
  if (normalizedPath === '/actions') {
    return '/dashboard';
  }
  
  // Debug
  if (normalizedPath === '/debug') {
    return '/dashboard';
  }
  
  // Maintenance routes
  if (normalizedPath.match(/^\/maintenance\/[^/]+$/)) {
    return '/maintenance';
  }
  
  // Toolbox talks
  if (normalizedPath === '/toolbox-talks') {
    return '/dashboard';
  }
  
  // Default fallback to dashboard
  return '/dashboard';
}
