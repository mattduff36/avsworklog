import { 
  FileText, 
  ClipboardCheck,
  AlertTriangle,
  Wrench,
  PackageCheck,
  Clipboard,
  FileCheck2,
  LucideIcon
} from 'lucide-react';

/**
 * Form Type Configuration
 * 
 * This file defines all available form types in the system.
 * To add a new form type:
 * 1. Add route handlers in app/(dashboard)/[formtype]/...
 * 2. Add entry to FORM_TYPES array below
 * 3. Add corresponding color variables to globals.css if needed
 * 
 * The system will automatically:
 * - Show the form in dashboard quick actions
 * - Include it in navigation (if desired)
 * - Track it in recent activity
 * - Include it in reports
 */

export interface FormType {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  listHref: string;
  color: string; // Must match CSS custom property in globals.css
  enabled: boolean; // Toggle to enable/disable without removing code
}

export const FORM_TYPES: FormType[] = [
  {
    id: 'timesheet',
    title: 'Timesheet',
    description: 'Weekly time tracking',
    icon: FileText,
    href: '/timesheets/new',
    listHref: '/timesheets',
    color: 'timesheet',
    enabled: true,
  },
  {
    id: 'inspection',
    title: 'Vehicle Inspection',
    description: 'Safety checklist',
    icon: ClipboardCheck,
    href: '/inspections/new',
    listHref: '/inspections',
    color: 'inspection',
    enabled: true,
  },
  {
    id: 'rams',
    title: 'RAMS Documents',
    description: 'Risk Assessment & Method Statement',
    icon: FileCheck2,
    href: '/rams',
    listHref: '/rams',
    color: 'rams',
    enabled: true,
  },
  // Future forms - uncomment and configure as needed:
  /*
  {
    id: 'incident',
    title: 'Incident Report',
    description: 'Safety incidents & near-misses',
    icon: AlertTriangle,
    href: '/incidents/new',
    listHref: '/incidents',
    color: 'incident', // Add --incident-primary to globals.css
    enabled: false,
  },
  {
    id: 'maintenance',
    title: 'Maintenance Request',
    description: 'Equipment & vehicle repairs',
    icon: Wrench,
    href: '/maintenance/new',
    listHref: '/maintenance',
    color: 'maintenance',
    enabled: false,
  },
  {
    id: 'delivery',
    title: 'Delivery Note',
    description: 'Material deliveries',
    icon: PackageCheck,
    href: '/deliveries/new',
    listHref: '/deliveries',
    color: 'delivery',
    enabled: false,
  },
  {
    id: 'site-diary',
    title: 'Site Diary',
    description: 'Daily site progress',
    icon: Clipboard,
    href: '/site-diary/new',
    listHref: '/site-diary',
    color: 'diary',
    enabled: false,
  },
  */
];

/**
 * Get only enabled form types
 */
export function getEnabledForms(): FormType[] {
  return FORM_TYPES.filter(form => form.enabled);
}

/**
 * Get form type by ID
 */
export function getFormType(id: string): FormType | undefined {
  return FORM_TYPES.find(form => form.id === id);
}

/**
 * Get form type by path
 */
export function getFormTypeByPath(path: string): FormType | undefined {
  return FORM_TYPES.find(form => 
    path.startsWith(form.listHref) || path.startsWith(form.href)
  );
}

