import { Database } from './database';

// Base types from database
export type AbsenceReason = Database['public']['Tables']['absence_reasons']['Row'];
export type AbsenceReasonInsert = Database['public']['Tables']['absence_reasons']['Insert'];
export type AbsenceReasonUpdate = Database['public']['Tables']['absence_reasons']['Update'];

export type Absence = Database['public']['Tables']['absences']['Row'];
export type AbsenceInsert = Database['public']['Tables']['absences']['Insert'];
export type AbsenceUpdate = Database['public']['Tables']['absences']['Update'];
export type AbsenceAllowanceCarryover = Database['public']['Tables']['absence_allowance_carryovers']['Row'];
export type AbsenceArchive = Database['public']['Tables']['absences_archive']['Row'];
export type AbsenceRecordSource = 'active' | 'archived';

// Extended types with relations
export interface AbsenceWithRelations extends Absence {
  absence_reasons: AbsenceReason;
  profiles: {
    full_name: string;
    employee_id: string | null;
    team_id?: string | null;
  };
  created_by_profile?: {
    full_name: string;
  };
  approved_by_profile?: {
    full_name: string;
  };
  record_source?: AbsenceRecordSource;
  archived_at?: string;
  financial_year_start_year?: number;
}

// Summary types
export interface AbsenceSummary {
  allowance: number;
  approved_taken: number;
  pending_total: number;
  remaining: number;
}

// Financial year type
export interface FinancialYear {
  start: Date;
  end: Date;
  label: string; // e.g., "2024/25"
}

