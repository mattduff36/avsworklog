/**
 * RAMS (Risk Assessment & Method Statement) Types
 */

export type RAMSDocumentStatus = 'active' | 'archived';
export type RAMSAssignmentStatus = 'pending' | 'read' | 'signed';
export type RAMSFileType = 'pdf' | 'docx';

export interface RAMSDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: RAMSFileType;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  version: number;
}

export interface RAMSAssignment {
  id: string;
  rams_document_id: string;
  employee_id: string;
  assigned_at: string;
  assigned_by: string | null;
  status: RAMSAssignmentStatus;
  read_at: string | null;
  signed_at: string | null;
  signature_data: string | null;
}

export interface RAMSVisitorSignature {
  id: string;
  rams_document_id: string;
  visitor_name: string;
  visitor_company: string | null;
  visitor_role: string | null;
  signature_data: string;
  signed_at: string;
  recorded_by: string | null;
}

// Extended types with joins for UI display

export interface RAMSDocumentWithStats extends RAMSDocument {
  total_assigned: number;
  total_signed: number;
  total_pending: number;
  uploader_name?: string;
}

export interface RAMSAssignmentWithDetails extends RAMSAssignment {
  document: RAMSDocument;
  employee_name?: string;
  employee_email?: string;
  assigned_by_name?: string;
}

export interface RAMSDocumentWithAssignments extends RAMSDocument {
  assignments: (RAMSAssignment & {
    employee_name?: string;
    employee_email?: string;
  })[];
  visitor_signatures: RAMSVisitorSignature[];
}

// Form types for creating/updating

export interface CreateRAMSDocumentInput {
  title: string;
  description?: string;
  file: File;
}

export interface AssignRAMSInput {
  rams_document_id: string;
  employee_ids: string[];
}

export interface SignRAMSInput {
  assignment_id: string;
  signature_data: string;
}

export interface RecordVisitorSignatureInput {
  rams_document_id: string;
  visitor_name: string;
  visitor_company?: string;
  visitor_role?: string;
  signature_data: string;
}

// API Response types

export interface RAMSUploadResponse {
  success: boolean;
  document?: RAMSDocument;
  error?: string;
}

export interface RAMSAssignResponse {
  success: boolean;
  assignments?: RAMSAssignment[];
  error?: string;
}

export interface RAMSSignResponse {
  success: boolean;
  assignment?: RAMSAssignment;
  error?: string;
}

export interface RAMSListResponse {
  success: boolean;
  documents?: RAMSDocumentWithStats[];
  error?: string;
}

export interface RAMSDetailsResponse {
  success: boolean;
  document?: RAMSDocumentWithAssignments;
  error?: string;
}

