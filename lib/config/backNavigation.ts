/**
 * Sitemap parent route configuration
 * Maps current pathnames to their logical parent routes
 */

/**
 * Get the parent route for a given pathname
 * @param pathname - The current pathname
 * @param userRole - Optional user role context (for role-specific navigation)
 * @returns The parent route path
 */
export function getParentHref(pathname: string, userRole?: { isManager?: boolean; isAdmin?: boolean }): string {
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
  
  // Fleet routes
  if (normalizedPath.match(/^\/fleet\/vehicles\/[^/]+\/history$/)) {
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
