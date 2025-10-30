// Supabase Database Types
// This file will be auto-generated from Supabase CLI in production
// For now, we'll define the types manually based on our schema

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          employee_id: string | null
          full_name: string
          role: 'admin' | 'manager' | 'employee'
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          employee_id?: string | null
          full_name: string
          role: 'admin' | 'manager' | 'employee'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string | null
          full_name?: string
          role?: 'admin' | 'manager' | 'employee'
          created_at?: string
          updated_at?: string
        }
      }
      vehicles: {
        Row: {
          id: string
          reg_number: string
          vehicle_type: string | null
          category_id: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          reg_number: string
          vehicle_type?: string | null
          category_id?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          reg_number?: string
          vehicle_type?: string | null
          category_id?: string | null
          status?: string
          created_at?: string
        }
      }
      vehicle_categories: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      timesheets: {
        Row: {
          id: string
          user_id: string
          reg_number: string | null
          week_ending: string
          status: 'draft' | 'submitted' | 'approved' | 'rejected'
          signature_data: string | null
          signed_at: string | null
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          reg_number?: string | null
          week_ending: string
          status?: 'draft' | 'submitted' | 'approved' | 'rejected'
          signature_data?: string | null
          signed_at?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          reg_number?: string | null
          week_ending?: string
          status?: 'draft' | 'submitted' | 'approved' | 'rejected'
          signature_data?: string | null
          signed_at?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      timesheet_entries: {
        Row: {
          id: string
          timesheet_id: string
          day_of_week: number
          time_started: string | null
          time_finished: string | null
          job_number: string | null
          working_in_yard: boolean
          did_not_work: boolean
          daily_total: number | null
          remarks: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          timesheet_id: string
          day_of_week: number
          time_started?: string | null
          time_finished?: string | null
          job_number?: string | null
          working_in_yard?: boolean
          did_not_work?: boolean
          daily_total?: number | null
          remarks?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          timesheet_id?: string
          day_of_week?: number
          time_started?: string | null
          time_finished?: string | null
          job_number?: string | null
          working_in_yard?: boolean
          did_not_work?: boolean
          daily_total?: number | null
          remarks?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      vehicle_inspections: {
        Row: {
          id: string
          vehicle_id: string
          user_id: string
          inspection_date: string
          inspection_end_date: string | null
          current_mileage: number | null
          status: 'draft' | 'submitted' | 'approved' | 'rejected'
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          signature_data: string | null
          signed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          vehicle_id: string
          user_id: string
          inspection_date: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted' | 'approved' | 'rejected'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          vehicle_id?: string
          user_id?: string
          inspection_date?: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted' | 'approved' | 'rejected'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      inspection_items: {
        Row: {
          id: string
          inspection_id: string
          item_number: number
          day_of_week: number
          item_description: string
          status: 'ok' | 'attention' | 'na'
          comments: string | null
          created_at: string
        }
        Insert: {
          id?: string
          inspection_id: string
          item_number: number
          day_of_week: number
          item_description?: string
          status?: 'ok' | 'attention' | 'na'
          comments?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          inspection_id?: string
          item_number?: number
          day_of_week?: number
          item_description?: string
          status?: 'ok' | 'attention' | 'na'
          comments?: string | null
          created_at?: string
        }
      }
      inspection_photos: {
        Row: {
          id: string
          inspection_id: string
          item_number: number | null
          day_of_week: number | null
          photo_url: string
          caption: string | null
          created_at: string
        }
        Insert: {
          id?: string
          inspection_id: string
          item_number?: number | null
          day_of_week?: number | null
          photo_url: string
          caption?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          inspection_id?: string
          item_number?: number | null
          day_of_week?: number | null
          photo_url?: string
          caption?: string | null
          created_at?: string
        }
      }
      audit_log: {
        Row: {
          id: string
          table_name: string
          record_id: string
          user_id: string | null
          action: string
          changes: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          table_name: string
          record_id: string
          user_id?: string | null
          action: string
          changes?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          table_name?: string
          record_id?: string
          user_id?: string | null
          action?: string
          changes?: Json | null
          created_at?: string
        }
      }
      actions: {
        Row: {
          id: string
          inspection_id: string | null
          inspection_item_id: string | null
          title: string
          description: string | null
          priority: 'low' | 'medium' | 'high' | 'urgent'
          status: 'pending' | 'in_progress' | 'completed'
          actioned: boolean
          actioned_at: string | null
          actioned_by: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          inspection_id?: string | null
          inspection_item_id?: string | null
          title: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          status?: 'pending' | 'in_progress' | 'completed'
          actioned?: boolean
          actioned_at?: string | null
          actioned_by?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          inspection_id?: string | null
          inspection_item_id?: string | null
          title?: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          status?: 'pending' | 'in_progress' | 'completed'
          actioned?: boolean
          actioned_at?: string | null
          actioned_by?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

