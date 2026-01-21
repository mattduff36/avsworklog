/**
 * Route-to-Accent Resolver
 * 
 * Maps route paths to their corresponding accent color identifier.
 * Employee modules get their own module colors, while non-module areas use brand yellow.
 */

export type AccentType = 
  | 'timesheets'
  | 'inspections'
  | 'rams'
  | 'absence'
  | 'maintenance'
  | 'workshop'
  | 'reports'
  | 'brand'; // yellow for Dashboard, Manager/Admin, Help

/**
 * Determine the accent color for a given route
 * 
 * @param pathname - Current route pathname (e.g. "/timesheets")
 * @param searchParams - URL search parameters (for detecting tab queries)
 * @returns AccentType identifier
 */
export function getAccentFromRoute(
  pathname: string,
  searchParams?: URLSearchParams | null
): AccentType {
  // Normalize pathname
  const path = pathname.toLowerCase();

  // Employee module routes → module colors
  if (path.startsWith('/timesheets')) return 'timesheets';
  if (path.startsWith('/inspections')) return 'inspections';
  if (path.startsWith('/rams')) return 'rams';
  if (path.startsWith('/absence')) return 'absence';
  if (path.startsWith('/workshop-tasks')) return 'workshop';
  if (path.startsWith('/reports')) return 'reports';

  // Fleet with maintenance tab → maintenance color
  if (path.startsWith('/fleet')) {
    const tab = searchParams?.get('tab');
    if (tab === 'maintenance') return 'maintenance';
  }

  // All other routes → brand yellow
  // This includes:
  // - /dashboard
  // - /help
  // - /approvals
  // - /actions
  // - /toolbox-talks
  // - /suggestions/manage
  // - /admin/*
  // - /fleet?tab=vehicles
  return 'brand';
}
