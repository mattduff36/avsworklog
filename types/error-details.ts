/**
 * Error Details Types
 * 
 * Types for the error details system that provides contextual
 * information about why errors occurred and how to resolve them
 */

export type ErrorDetailsType =
  | 'subcategory-tasks'
  | 'category-subcategories'
  | 'missing-attachments'
  | 'permission-denied'
  | 'vehicle-conflict'
  | 'pending-tasks'
  | 'foreign-key-constraint'
  | 'validation-failure';

export interface ErrorDetailsAction {
  id: string;
  label: string;
  type: 'primary' | 'destructive' | 'secondary';
  endpoint?: string;
  requiresConfirmation?: boolean;
}

export interface ErrorDetailsResponse<T = any> {
  success: boolean;
  detailsType: ErrorDetailsType;
  summary: {
    title: string;
    description?: string;
    count: number;
    [key: string]: any;
  };
  items: T[];
  actions?: ErrorDetailsAction[];
  resolutionGuide?: string[];
}

// Specific item types for different error details

export interface SubcategoryTaskItem {
  id: string;
  title: string;
  status: string;
  vehicle: {
    reg_number: string;
    nickname: string | null;
  };
  created_at: string;
  url: string;
}

export interface CategorySubcategoryItem {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  task_count: number;
}

export interface MissingAttachmentItem {
  id: string;
  template_name: string;
  status: string;
  required_count: number;
  answered_count: number;
  missing_questions: string[];
}

export interface PendingTaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: {
    id: string;
    name: string;
  } | null;
}
