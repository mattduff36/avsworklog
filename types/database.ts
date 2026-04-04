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
          phone_number: string | null
          avatar_url: string | null
          role: string | null
          role_id: string | null
          must_change_password: boolean
          annual_holiday_allowance_days: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          employee_id?: string | null
          full_name: string
          phone_number?: string | null
          avatar_url?: string | null
          role?: string | null
          role_id?: string | null
          must_change_password?: boolean
          annual_holiday_allowance_days?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string | null
          full_name?: string
          phone_number?: string | null
          avatar_url?: string | null
          role?: string | null
          role_id?: string | null
          must_change_password?: boolean
          annual_holiday_allowance_days?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      user_page_visits: {
        Row: {
          id: string
          user_id: string
          path: string
          visited_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          path: string
          visited_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          path?: string
          visited_at?: string
          created_at?: string
        }
      }
      account_switch_settings: {
        Row: {
          profile_id: string
          quick_switch_enabled: boolean
          pin_hash: string | null
          pin_failed_attempts: number
          pin_locked_until: string | null
          pin_last_changed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          quick_switch_enabled?: boolean
          pin_hash?: string | null
          pin_failed_attempts?: number
          pin_locked_until?: string | null
          pin_last_changed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          quick_switch_enabled?: boolean
          pin_hash?: string | null
          pin_failed_attempts?: number
          pin_locked_until?: string | null
          pin_last_changed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      account_switch_audit_events: {
        Row: {
          id: string
          profile_id: string
          actor_profile_id: string | null
          event_type: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          actor_profile_id?: string | null
          event_type: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          actor_profile_id?: string | null
          event_type?: string
          metadata?: Json
          created_at?: string
        }
      }
      account_switch_devices: {
        Row: {
          id: string
          profile_id: string
          device_id_hash: string
          device_label: string | null
          trusted_at: string
          last_seen_at: string
          revoked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          device_id_hash: string
          device_label?: string | null
          trusted_at?: string
          last_seen_at?: string
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          device_id_hash?: string
          device_label?: string | null
          trusted_at?: string
          last_seen_at?: string
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      account_switch_device_credentials: {
        Row: {
          profile_id: string
          device_id: string
          pin_hash: string
          pin_failed_attempts: number
          pin_locked_until: string | null
          pin_last_changed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          device_id: string
          pin_hash: string
          pin_failed_attempts?: number
          pin_locked_until?: string | null
          pin_last_changed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          device_id?: string
          pin_hash?: string
          pin_failed_attempts?: number
          pin_locked_until?: string | null
          pin_last_changed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      account_switch_device_sessions: {
        Row: {
          profile_id: string
          device_id: string
          session_registered_at: string
          last_switch_at: string | null
          session_hint: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          device_id: string
          session_registered_at?: string
          last_switch_at?: string | null
          session_hint?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          device_id?: string
          session_registered_at?: string
          last_switch_at?: string | null
          session_hint?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      roles: {
        Row: {
          id: string
          name: string
          display_name: string
          description: string | null
          role_class: 'admin' | 'manager' | 'employee'
          hierarchy_rank: number | null
          is_super_admin: boolean
          is_manager_admin: boolean
          timesheet_type: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          display_name: string
          description?: string | null
          role_class?: 'admin' | 'manager' | 'employee'
          hierarchy_rank?: number | null
          is_super_admin?: boolean
          is_manager_admin?: boolean
          timesheet_type?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          display_name?: string
          description?: string | null
          role_class?: 'admin' | 'manager' | 'employee'
          hierarchy_rank?: number | null
          is_super_admin?: boolean
          is_manager_admin?: boolean
          timesheet_type?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      permission_modules: {
        Row: {
          module_name: string
          minimum_role_id: string
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          module_name: string
          minimum_role_id: string
          sort_order: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          module_name?: string
          minimum_role_id?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      role_permissions: {
        Row: {
          id: string
          role_id: string
          module_name: string
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          role_id: string
          module_name: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          role_id?: string
          module_name?: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      team_module_permissions: {
        Row: {
          team_id: string
          module_name: string
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          team_id: string
          module_name: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          team_id?: string
          module_name?: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      /** @deprecated Renamed to `vans`. This type is kept for reference only. */
      // vehicles: { ... }
      vans: {
        Row: {
          id: string
          reg_number: string
          /** @deprecated Use van_categories relationship instead. Auto-synced from category_id. */
          vehicle_type: string | null
          category_id: string
          status: string
          nickname: string | null
          created_at: string
        }
        Insert: {
          id?: string
          reg_number: string
          /** @deprecated Do not set this field. It auto-syncs from category_id. */
          vehicle_type?: string | null
          category_id: string
          status?: string
          nickname?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          reg_number?: string
          /** @deprecated Do not set this field. It auto-syncs from category_id. */
          vehicle_type?: string | null
          category_id?: string
          status?: string
          nickname?: string | null
          created_at?: string
        }
      }
      hgvs: {
        Row: {
          id: string
          reg_number: string
          category_id: string
          status: string
          nickname: string | null
          current_mileage: number | null
          retired_at: string | null
          retire_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          reg_number: string
          category_id: string
          status?: string
          nickname?: string | null
          current_mileage?: number | null
          retired_at?: string | null
          retire_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          reg_number?: string
          category_id?: string
          status?: string
          nickname?: string | null
          current_mileage?: number | null
          retired_at?: string | null
          retire_reason?: string | null
          created_at?: string
        }
      }
      hgv_categories: {
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
      hgv_inspections: {
        Row: {
          id: string
          hgv_id: string | null
          user_id: string
          inspection_date: string
          inspection_end_date: string | null
          current_mileage: number | null
          status: 'draft' | 'submitted'
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          inspector_comments: string | null
          signature_data: string | null
          signed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          hgv_id?: string | null
          user_id: string
          inspection_date: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          hgv_id?: string | null
          user_id?: string
          inspection_date?: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      plant: {
        Row: {
          id: string
          plant_id: string
          reg_number: string | null
          nickname: string | null
          make: string | null
          model: string | null
          serial_number: string | null
          year: number | null
          weight_class: string | null
          category_id: string
          loler_due_date: string | null
          loler_last_inspection_date: string | null
          loler_certificate_number: string | null
          loler_inspection_interval_months: number
          current_hours: number | null
          status: 'active' | 'inactive' | 'maintenance' | 'retired'
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          plant_id: string
          reg_number?: string | null
          nickname?: string | null
          make?: string | null
          model?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
          category_id: string
          loler_due_date?: string | null
          loler_last_inspection_date?: string | null
          loler_certificate_number?: string | null
          loler_inspection_interval_months?: number
          current_hours?: number | null
          status?: 'active' | 'inactive' | 'maintenance' | 'retired'
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          plant_id?: string
          reg_number?: string | null
          nickname?: string | null
          make?: string | null
          model?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
          category_id?: string
          loler_due_date?: string | null
          loler_last_inspection_date?: string | null
          loler_certificate_number?: string | null
          loler_inspection_interval_months?: number
          current_hours?: number | null
          status?: 'active' | 'inactive' | 'maintenance' | 'retired'
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
      }
      van_categories: {
        Row: {
          id: string
          name: string
          description: string | null
          applies_to: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          applies_to?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          applies_to?: string[]
          created_at?: string
          updated_at?: string
        }
      }
      maintenance_categories: {
        Row: {
          id: string
          name: string
          description: string | null
          type: 'date' | 'mileage' | 'hours'
          period_value: number
          alert_threshold_days: number | null
          alert_threshold_miles: number | null
          alert_threshold_hours: number | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type: 'date' | 'mileage' | 'hours'
          period_value: number
          alert_threshold_days?: number | null
          alert_threshold_miles?: number | null
          alert_threshold_hours?: number | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: 'date' | 'mileage' | 'hours'
          period_value?: number
          alert_threshold_days?: number | null
          alert_threshold_miles?: number | null
          alert_threshold_hours?: number | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      vehicle_maintenance: {
        Row: {
          id: string
          van_id: string | null
          plant_id: string | null
          hgv_id: string | null
          tax_due_date: string | null
          mot_due_date: string | null
          dvla_sync_status: string | null
          last_dvla_sync: string | null
          dvla_sync_error: string | null
          dvla_raw_data: Json | null
          ves_make: string | null
          ves_colour: string | null
          ves_fuel_type: string | null
          ves_year_of_manufacture: number | null
          ves_engine_capacity: number | null
          ves_tax_status: string | null
          ves_mot_status: string | null
          ves_co2_emissions: number | null
          ves_euro_status: string | null
          ves_real_driving_emissions: string | null
          ves_type_approval: string | null
          ves_wheelplan: string | null
          ves_revenue_weight: number | null
          ves_marked_for_export: boolean | null
          ves_month_of_first_registration: string | null
          ves_date_of_last_v5c_issued: string | null
          mot_api_sync_status: string | null
          last_mot_api_sync: string | null
          mot_api_sync_error: string | null
          mot_raw_data: Json | null
          mot_make: string | null
          mot_model: string | null
          mot_fuel_type: string | null
          mot_primary_colour: string | null
          mot_registration: string | null
          mot_year_of_manufacture: number | null
          mot_first_used_date: string | null
          mot_expiry_date: string | null
          first_aid_kit_expiry: string | null
          six_weekly_inspection_due_date: string | null
          fire_extinguisher_due_date: string | null
          taco_calibration_due_date: string | null
          current_mileage: number | null
          last_service_mileage: number | null
          next_service_mileage: number | null
          cambelt_due_mileage: number | null
          cambelt_done: boolean
          last_mileage_update: string | null
          current_hours: number | null
          last_service_hours: number | null
          next_service_hours: number | null
          last_hours_update: string | null
          last_updated_at: string
          last_updated_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          tax_due_date?: string | null
          mot_due_date?: string | null
          dvla_sync_status?: string | null
          last_dvla_sync?: string | null
          dvla_sync_error?: string | null
          dvla_raw_data?: Json | null
          ves_make?: string | null
          ves_colour?: string | null
          ves_fuel_type?: string | null
          ves_year_of_manufacture?: number | null
          ves_engine_capacity?: number | null
          ves_tax_status?: string | null
          ves_mot_status?: string | null
          ves_co2_emissions?: number | null
          ves_euro_status?: string | null
          ves_real_driving_emissions?: string | null
          ves_type_approval?: string | null
          ves_wheelplan?: string | null
          ves_revenue_weight?: number | null
          ves_marked_for_export?: boolean | null
          ves_month_of_first_registration?: string | null
          ves_date_of_last_v5c_issued?: string | null
          mot_api_sync_status?: string | null
          last_mot_api_sync?: string | null
          mot_api_sync_error?: string | null
          mot_raw_data?: Json | null
          mot_make?: string | null
          mot_model?: string | null
          mot_fuel_type?: string | null
          mot_primary_colour?: string | null
          mot_registration?: string | null
          mot_year_of_manufacture?: number | null
          mot_first_used_date?: string | null
          mot_expiry_date?: string | null
          first_aid_kit_expiry?: string | null
          six_weekly_inspection_due_date?: string | null
          fire_extinguisher_due_date?: string | null
          taco_calibration_due_date?: string | null
          current_mileage?: number | null
          last_service_mileage?: number | null
          next_service_mileage?: number | null
          cambelt_due_mileage?: number | null
          cambelt_done?: boolean
          last_mileage_update?: string | null
          current_hours?: number | null
          last_service_hours?: number | null
          next_service_hours?: number | null
          last_hours_update?: string | null
          last_updated_at?: string
          last_updated_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          tax_due_date?: string | null
          mot_due_date?: string | null
          dvla_sync_status?: string | null
          last_dvla_sync?: string | null
          dvla_sync_error?: string | null
          dvla_raw_data?: Json | null
          ves_make?: string | null
          ves_colour?: string | null
          ves_fuel_type?: string | null
          ves_year_of_manufacture?: number | null
          ves_engine_capacity?: number | null
          ves_tax_status?: string | null
          ves_mot_status?: string | null
          ves_co2_emissions?: number | null
          ves_euro_status?: string | null
          ves_real_driving_emissions?: string | null
          ves_type_approval?: string | null
          ves_wheelplan?: string | null
          ves_revenue_weight?: number | null
          ves_marked_for_export?: boolean | null
          ves_month_of_first_registration?: string | null
          ves_date_of_last_v5c_issued?: string | null
          mot_api_sync_status?: string | null
          last_mot_api_sync?: string | null
          mot_api_sync_error?: string | null
          mot_raw_data?: Json | null
          mot_make?: string | null
          mot_model?: string | null
          mot_fuel_type?: string | null
          mot_primary_colour?: string | null
          mot_registration?: string | null
          mot_year_of_manufacture?: number | null
          mot_first_used_date?: string | null
          mot_expiry_date?: string | null
          first_aid_kit_expiry?: string | null
          six_weekly_inspection_due_date?: string | null
          fire_extinguisher_due_date?: string | null
          taco_calibration_due_date?: string | null
          current_mileage?: number | null
          last_service_mileage?: number | null
          next_service_mileage?: number | null
          cambelt_due_mileage?: number | null
          cambelt_done?: boolean
          last_mileage_update?: string | null
          current_hours?: number | null
          last_service_hours?: number | null
          next_service_hours?: number | null
          last_hours_update?: string | null
          last_updated_at?: string
          last_updated_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      dvla_sync_log: {
        Row: {
          id: string
          van_id: string | null
          plant_id: string | null
          hgv_id: string | null
          registration_number: string
          sync_status: string
          error_message: string | null
          fields_updated: string[] | null
          tax_due_date_old: string | null
          tax_due_date_new: string | null
          mot_due_date_old: string | null
          mot_due_date_new: string | null
          api_provider: string | null
          api_response_time_ms: number | null
          raw_response: Json | null
          triggered_by: string | null
          trigger_type: string
          created_at: string
        }
        Insert: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          registration_number: string
          sync_status: string
          error_message?: string | null
          fields_updated?: string[] | null
          tax_due_date_old?: string | null
          tax_due_date_new?: string | null
          mot_due_date_old?: string | null
          mot_due_date_new?: string | null
          api_provider?: string | null
          api_response_time_ms?: number | null
          raw_response?: Json | null
          triggered_by?: string | null
          trigger_type: string
          created_at?: string
        }
        Update: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          registration_number?: string
          sync_status?: string
          error_message?: string | null
          fields_updated?: string[] | null
          tax_due_date_old?: string | null
          tax_due_date_new?: string | null
          mot_due_date_old?: string | null
          mot_due_date_new?: string | null
          api_provider?: string | null
          api_response_time_ms?: number | null
          raw_response?: Json | null
          triggered_by?: string | null
          trigger_type?: string
          created_at?: string
        }
      }
      maintenance_history: {
        Row: {
          id: string
          van_id: string | null
          plant_id: string | null
          hgv_id: string | null
          maintenance_category_id: string | null
          field_name: string
          old_value: string | null
          new_value: string | null
          value_type: 'date' | 'mileage' | 'boolean' | 'text'
          comment: string
          updated_by: string | null
          updated_by_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          maintenance_category_id?: string | null
          field_name: string
          old_value?: string | null
          new_value?: string | null
          value_type: 'date' | 'mileage' | 'boolean' | 'text'
          comment: string
          updated_by?: string | null
          updated_by_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          maintenance_category_id?: string | null
          field_name?: string
          old_value?: string | null
          new_value?: string | null
          value_type?: 'date' | 'mileage' | 'boolean' | 'text'
          comment?: string
          updated_by?: string | null
          updated_by_name?: string | null
          created_at?: string
        }
      }
      van_archive: {
        Row: {
          id: string
          van_id: string
          reg_number: string
          category_id: string | null
          status: string | null
          archive_reason: 'Sold' | 'Scrapped' | 'Other'
          archive_comment: string | null
          archived_by: string | null
          archived_at: string
          vehicle_data: Json
          maintenance_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          van_id: string
          reg_number: string
          category_id?: string | null
          status?: string | null
          archive_reason: 'Sold' | 'Scrapped' | 'Other'
          archive_comment?: string | null
          archived_by?: string | null
          archived_at?: string
          vehicle_data: Json
          maintenance_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          van_id?: string
          reg_number?: string
          category_id?: string | null
          status?: string | null
          archive_reason?: 'Sold' | 'Scrapped' | 'Other'
          archive_comment?: string | null
          archived_by?: string | null
          archived_at?: string
          vehicle_data?: Json
          maintenance_data?: Json | null
          created_at?: string
        }
      }
      timesheets: {
        Row: {
          id: string
          user_id: string
          timesheet_type: string | null
          template_version: number
          reg_number: string | null
          site_address: string | null
          hirer_name: string | null
          is_hired_plant: boolean
          hired_plant_id_serial: string | null
          hired_plant_description: string | null
          hired_plant_hiring_company: string | null
          week_ending: string
          status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted'
          signature_data: string | null
          signed_at: string | null
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          adjusted_by: string | null
          adjusted_at: string | null
          adjustment_recipients: string[] | null
          processed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          timesheet_type?: string | null
          template_version?: number
          reg_number?: string | null
          site_address?: string | null
          hirer_name?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
          week_ending: string
          status?: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted'
          signature_data?: string | null
          signed_at?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          adjusted_by?: string | null
          adjusted_at?: string | null
          adjustment_recipients?: string[] | null
          processed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          timesheet_type?: string | null
          template_version?: number
          reg_number?: string | null
          site_address?: string | null
          hirer_name?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
          week_ending?: string
          status?: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted'
          signature_data?: string | null
          signed_at?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          adjusted_by?: string | null
          adjusted_at?: string | null
          adjustment_recipients?: string[] | null
          processed_at?: string | null
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
          operator_travel_hours: number | null
          operator_yard_hours: number | null
          operator_working_hours: number | null
          machine_travel_hours: number | null
          machine_start_time: string | null
          machine_finish_time: string | null
          machine_working_hours: number | null
          machine_standing_hours: number | null
          machine_operator_hours: number | null
          maintenance_breakdown_hours: number | null
          job_number: string | null
          working_in_yard: boolean
          did_not_work: boolean
          night_shift: boolean
          bank_holiday: boolean
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
          operator_travel_hours?: number | null
          operator_yard_hours?: number | null
          operator_working_hours?: number | null
          machine_travel_hours?: number | null
          machine_start_time?: string | null
          machine_finish_time?: string | null
          machine_working_hours?: number | null
          machine_standing_hours?: number | null
          machine_operator_hours?: number | null
          maintenance_breakdown_hours?: number | null
          job_number?: string | null
          working_in_yard?: boolean
          did_not_work?: boolean
          night_shift?: boolean
          bank_holiday?: boolean
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
          operator_travel_hours?: number | null
          operator_yard_hours?: number | null
          operator_working_hours?: number | null
          machine_travel_hours?: number | null
          machine_start_time?: string | null
          machine_finish_time?: string | null
          machine_working_hours?: number | null
          machine_standing_hours?: number | null
          machine_operator_hours?: number | null
          maintenance_breakdown_hours?: number | null
          job_number?: string | null
          working_in_yard?: boolean
          did_not_work?: boolean
          night_shift?: boolean
          bank_holiday?: boolean
          daily_total?: number | null
          remarks?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      inspection_daily_hours: {
        Row: {
          id: string
          inspection_id: string
          day_of_week: number
          hours: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          inspection_id: string
          day_of_week: number
          hours?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          inspection_id?: string
          day_of_week?: number
          hours?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      van_inspections: {
        Row: {
          id: string
          van_id: string | null
          plant_id: string | null
          user_id: string
          inspection_date: string
          inspection_end_date: string | null
          current_mileage: number | null
          status: 'draft' | 'submitted'
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          inspector_comments: string | null
          signature_data: string | null
          signed_at: string | null
          is_hired_plant: boolean
          hired_plant_id_serial: string | null
          hired_plant_description: string | null
          hired_plant_hiring_company: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          user_id: string
          inspection_date: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          van_id?: string | null
          plant_id?: string | null
          user_id?: string
          inspection_date?: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      plant_inspections: {
        Row: {
          id: string
          vehicle_id: string | null
          plant_id: string | null
          user_id: string
          inspection_date: string
          inspection_end_date: string | null
          current_mileage: number | null
          status: 'draft' | 'submitted'
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          inspector_comments: string | null
          signature_data: string | null
          signed_at: string | null
          is_hired_plant: boolean
          hired_plant_id_serial: string | null
          hired_plant_description: string | null
          hired_plant_hiring_company: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          vehicle_id?: string | null
          plant_id?: string | null
          user_id: string
          inspection_date: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          vehicle_id?: string | null
          plant_id?: string | null
          user_id?: string
          inspection_date?: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
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
          action_type: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action'
          inspection_id: string | null
          inspection_item_id: string | null
          van_id: string | null
          plant_id: string | null
          hgv_id: string | null
          workshop_category_id: string | null
          workshop_subcategory_id: string | null
          workshop_comments: string | null
          title: string
          description: string | null
          priority: 'low' | 'medium' | 'high' | 'urgent'
          status: 'pending' | 'in_progress' | 'logged' | 'on_hold' | 'completed'
          actioned: boolean
          actioned_at: string | null
          actioned_by: string | null
          actioned_comment: string | null
          actioned_signature_data: string | null
          actioned_signed_at: string | null
          logged_comment: string | null
          logged_at: string | null
          logged_by: string | null
          status_history: Json | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          action_type?: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action'
          inspection_id?: string | null
          inspection_item_id?: string | null
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          workshop_category_id?: string | null
          workshop_comments?: string | null
          title: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          status?: 'pending' | 'in_progress' | 'logged' | 'completed'
          actioned?: boolean
          actioned_at?: string | null
          actioned_by?: string | null
          actioned_comment?: string | null
          actioned_signature_data?: string | null
          actioned_signed_at?: string | null
          logged_comment?: string | null
          logged_at?: string | null
          logged_by?: string | null
          status_history?: Json | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          action_type?: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action'
          inspection_id?: string | null
          inspection_item_id?: string | null
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          workshop_category_id?: string | null
          workshop_comments?: string | null
          title?: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          status?: 'pending' | 'in_progress' | 'logged' | 'completed'
          actioned?: boolean
          actioned_at?: string | null
          actioned_by?: string | null
          actioned_comment?: string | null
          actioned_signature_data?: string | null
          actioned_signed_at?: string | null
          logged_comment?: string | null
          logged_at?: string | null
          logged_by?: string | null
          status_history?: Json | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      workshop_task_categories: {
        Row: {
          id: string
          applies_to: 'van' | 'hgv' | 'plant' | 'tools'
          name: string
          slug: string | null
          is_active: boolean
          sort_order: number
          requires_subcategories: boolean
          ui_color: string | null
          ui_icon: string | null
          ui_badge_style: string | null
          completion_updates: Json | null
          created_at: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          applies_to?: 'van' | 'hgv' | 'plant' | 'tools'
          name: string
          slug?: string | null
          is_active?: boolean
          sort_order?: number
          requires_subcategories?: boolean
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          completion_updates?: Json | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          applies_to?: 'van' | 'hgv' | 'plant' | 'tools'
          name?: string
          slug?: string | null
          is_active?: boolean
          sort_order?: number
          requires_subcategories?: boolean
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          completion_updates?: Json | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
      }
      workshop_task_subcategories: {
        Row: {
          id: string
          category_id: string
          name: string
          slug: string
          sort_order: number
          is_active: boolean
          ui_color: string | null
          ui_icon: string | null
          ui_badge_style: string | null
          created_at: string
          created_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          category_id: string
          name: string
          slug: string
          sort_order?: number
          is_active?: boolean
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          category_id?: string
          name?: string
          slug?: string
          sort_order?: number
          is_active?: boolean
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
      }
      workshop_task_comments: {
        Row: {
          id: string
          task_id: string
          author_id: string
          body: string
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          task_id: string
          author_id: string
          body: string
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          author_id?: string
          body?: string
          created_at?: string
          updated_at?: string | null
        }
      }
      workshop_attachment_templates: {
        Row: {
          id: string
          name: string
          description: string | null
          applies_to: string[]
          is_active: boolean
          created_at: string
          created_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          applies_to?: string[]
          is_active?: boolean
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          applies_to?: string[]
          is_active?: boolean
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
      }
      workshop_attachment_questions: {
        Row: {
          id: string
          template_id: string
          question_text: string
          question_type: 'checkbox' | 'text' | 'long_text' | 'number' | 'date'
          is_required: boolean
          sort_order: number
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          template_id: string
          question_text: string
          question_type?: 'checkbox' | 'text' | 'long_text' | 'number' | 'date'
          is_required?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          template_id?: string
          question_text?: string
          question_type?: 'checkbox' | 'text' | 'long_text' | 'number' | 'date'
          is_required?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string | null
        }
      }
      workshop_task_attachments: {
        Row: {
          id: string
          task_id: string
          template_id: string
          status: 'pending' | 'completed'
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          task_id: string
          template_id: string
          status?: 'pending' | 'completed'
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          template_id?: string
          status?: 'pending' | 'completed'
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
        }
      }
      workshop_attachment_responses: {
        Row: {
          id: string
          attachment_id: string
          question_id: string
          question_snapshot: Record<string, unknown>
          response_value: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          attachment_id: string
          question_id: string
          question_snapshot: Record<string, unknown>
          response_value?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          attachment_id?: string
          question_id?: string
          question_snapshot?: Record<string, unknown>
          response_value?: string | null
          created_at?: string
          updated_at?: string | null
        }
      }
      project_document_types: {
        Row: {
          id: string
          name: string
          description: string | null
          required_signature: boolean
          is_active: boolean
          sort_order: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          required_signature?: boolean
          is_active?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          required_signature?: boolean
          is_active?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      project_favourites: {
        Row: {
          id: string
          document_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          document_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          id?: string
          document_id?: string
          user_id?: string
          created_at?: string
        }
      }
      rams_documents: {
        Row: {
          id: string
          title: string
          description: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: 'pdf' | 'docx'
          uploaded_by: string | null
          created_at: string
          updated_at: string
          is_active: boolean
          version: number
          document_type_id: string | null
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: 'pdf' | 'docx'
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
          is_active?: boolean
          version?: number
          document_type_id?: string | null
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: 'pdf' | 'docx'
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
          is_active?: boolean
          version?: number
          document_type_id?: string | null
        }
      }
      rams_assignments: {
        Row: {
          id: string
          rams_document_id: string
          employee_id: string
          assigned_at: string
          assigned_by: string | null
          status: 'pending' | 'read' | 'signed'
          read_at: string | null
          signed_at: string | null
          signature_data: string | null
          action_taken: string | null
        }
        Insert: {
          id?: string
          rams_document_id: string
          employee_id: string
          assigned_at?: string
          assigned_by?: string | null
          status?: 'pending' | 'read' | 'signed'
          read_at?: string | null
          signed_at?: string | null
          signature_data?: string | null
          action_taken?: string | null
        }
        Update: {
          id?: string
          rams_document_id?: string
          employee_id?: string
          assigned_at?: string
          assigned_by?: string | null
          status?: 'pending' | 'read' | 'signed'
          read_at?: string | null
          signed_at?: string | null
          signature_data?: string | null
          action_taken?: string | null
        }
      }
      rams_visitor_signatures: {
        Row: {
          id: string
          rams_document_id: string
          visitor_name: string
          visitor_company: string | null
          visitor_role: string | null
          signature_data: string
          signed_at: string
          recorded_by: string | null
        }
        Insert: {
          id?: string
          rams_document_id: string
          visitor_name: string
          visitor_company?: string | null
          visitor_role?: string | null
          signature_data: string
          signed_at?: string
          recorded_by?: string | null
        }
        Update: {
          id?: string
          rams_document_id?: string
          visitor_name?: string
          visitor_company?: string | null
          visitor_role?: string | null
          signature_data?: string
          signed_at?: string
          recorded_by?: string | null
        }
      }
      absence_module_settings: {
        Row: {
          id: boolean
          announcement_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          announcement_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          announcement_message?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      absence_reasons: {
        Row: {
          id: string
          name: string
          is_paid: boolean
          color: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          is_paid?: boolean
          color?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          is_paid?: boolean
          color?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      work_shift_templates: {
        Row: {
          id: string
          name: string
          description: string | null
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      work_shift_template_slots: {
        Row: {
          template_id: string
          day_of_week: number
          am_working: boolean
          pm_working: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          template_id: string
          day_of_week: number
          am_working?: boolean
          pm_working?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          template_id?: string
          day_of_week?: number
          am_working?: boolean
          pm_working?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      employee_work_shifts: {
        Row: {
          id: string
          profile_id: string
          template_id: string | null
          monday_am: boolean
          monday_pm: boolean
          tuesday_am: boolean
          tuesday_pm: boolean
          wednesday_am: boolean
          wednesday_pm: boolean
          thursday_am: boolean
          thursday_pm: boolean
          friday_am: boolean
          friday_pm: boolean
          saturday_am: boolean
          saturday_pm: boolean
          sunday_am: boolean
          sunday_pm: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          template_id?: string | null
          monday_am?: boolean
          monday_pm?: boolean
          tuesday_am?: boolean
          tuesday_pm?: boolean
          wednesday_am?: boolean
          wednesday_pm?: boolean
          thursday_am?: boolean
          thursday_pm?: boolean
          friday_am?: boolean
          friday_pm?: boolean
          saturday_am?: boolean
          saturday_pm?: boolean
          sunday_am?: boolean
          sunday_pm?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          template_id?: string | null
          monday_am?: boolean
          monday_pm?: boolean
          tuesday_am?: boolean
          tuesday_pm?: boolean
          wednesday_am?: boolean
          wednesday_pm?: boolean
          thursday_am?: boolean
          thursday_pm?: boolean
          friday_am?: boolean
          friday_pm?: boolean
          saturday_am?: boolean
          saturday_pm?: boolean
          sunday_am?: boolean
          sunday_pm?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      absences: {
        Row: {
          id: string
          profile_id: string
          date: string
          end_date: string | null
          reason_id: string
          duration_days: number
          is_half_day: boolean
          half_day_session: 'AM' | 'PM' | null
          notes: string | null
          status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by: string | null
          approved_by: string | null
          approved_at: string | null
          processed_by: string | null
          processed_at: string | null
          is_bank_holiday: boolean
          auto_generated: boolean
          generation_source: string | null
          holiday_key: string | null
          bulk_batch_id: string | null
          allow_timesheet_work_on_leave: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          date: string
          end_date?: string | null
          reason_id: string
          duration_days: number
          is_half_day?: boolean
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status?: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          processed_by?: string | null
          processed_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          bulk_batch_id?: string | null
          allow_timesheet_work_on_leave?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          date?: string
          end_date?: string | null
          reason_id?: string
          duration_days?: number
          is_half_day?: boolean
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status?: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          processed_by?: string | null
          processed_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          bulk_batch_id?: string | null
          allow_timesheet_work_on_leave?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      absence_bulk_batches: {
        Row: {
          id: string
          created_by: string | null
          reason_id: string
          reason_name: string
          start_date: string
          end_date: string
          notes: string | null
          apply_to_all: boolean
          role_names: string[]
          explicit_profile_ids: string[]
          targeted_count: number
          created_count: number
          duplicate_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          created_by?: string | null
          reason_id: string
          reason_name: string
          start_date: string
          end_date: string
          notes?: string | null
          apply_to_all?: boolean
          role_names?: string[]
          explicit_profile_ids?: string[]
          targeted_count?: number
          created_count?: number
          duplicate_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          created_by?: string | null
          reason_id?: string
          reason_name?: string
          start_date?: string
          end_date?: string
          notes?: string | null
          apply_to_all?: boolean
          role_names?: string[]
          explicit_profile_ids?: string[]
          targeted_count?: number
          created_count?: number
          duplicate_count?: number
          created_at?: string
          updated_at?: string
        }
      }
      absences_archive: {
        Row: {
          id: string
          profile_id: string
          date: string
          end_date: string | null
          reason_id: string
          duration_days: number
          is_half_day: boolean
          half_day_session: 'AM' | 'PM' | null
          notes: string | null
          status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by: string | null
          approved_by: string | null
          approved_at: string | null
          processed_by: string | null
          processed_at: string | null
          is_bank_holiday: boolean
          auto_generated: boolean
          generation_source: string | null
          holiday_key: string | null
          allow_timesheet_work_on_leave: boolean
          created_at: string
          updated_at: string
          financial_year_start_year: number
          archived_at: string
          archived_by: string | null
          archive_run_id: string | null
        }
        Insert: {
          id: string
          profile_id: string
          date: string
          end_date?: string | null
          reason_id: string
          duration_days: number
          is_half_day?: boolean
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          processed_by?: string | null
          processed_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          allow_timesheet_work_on_leave?: boolean
          created_at: string
          updated_at: string
          financial_year_start_year: number
          archived_at?: string
          archived_by?: string | null
          archive_run_id?: string | null
        }
        Update: {
          id?: string
          profile_id?: string
          date?: string
          end_date?: string | null
          reason_id?: string
          duration_days?: number
          is_half_day?: boolean
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status?: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          processed_by?: string | null
          processed_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          allow_timesheet_work_on_leave?: boolean
          created_at?: string
          updated_at?: string
          financial_year_start_year?: number
          archived_at?: string
          archived_by?: string | null
          archive_run_id?: string | null
        }
      }
      absence_financial_year_generations: {
        Row: {
          id: string
          financial_year_start_year: number
          generated_at: string
          generated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      absence_allowance_carryovers: {
        Row: {
          id: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days: number
          auto_generated: boolean
          generation_source: string
          generated_at: string
          generated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days?: number
          auto_generated?: boolean
          generation_source?: string
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          financial_year_start_year?: number
          source_financial_year_start_year?: number
          carried_days?: number
          auto_generated?: boolean
          generation_source?: string
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      absence_financial_year_closures: {
        Row: {
          id: string
          financial_year_start_year: number
          closed_at: string
          closed_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          closed_at?: string
          closed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          closed_at?: string
          closed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      absence_financial_year_close_snapshots: {
        Row: {
          id: string
          financial_year_start_year: number
          target_financial_year_start_year: number
          snapshot_taken_at: string
          snapshot_taken_by: string | null
          restored_at: string | null
          restored_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          target_financial_year_start_year: number
          snapshot_taken_at?: string
          snapshot_taken_by?: string | null
          restored_at?: string | null
          restored_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          target_financial_year_start_year?: number
          snapshot_taken_at?: string
          snapshot_taken_by?: string | null
          restored_at?: string | null
          restored_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      absence_financial_year_close_snapshot_rows: {
        Row: {
          id: string
          snapshot_id: string
          carryover_id: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days: number
          auto_generated: boolean
          generation_source: string
          generated_at: string
          generated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          snapshot_id: string
          carryover_id: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days: number
          auto_generated: boolean
          generation_source: string
          generated_at: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          snapshot_id?: string
          carryover_id?: string
          profile_id?: string
          financial_year_start_year?: number
          source_financial_year_start_year?: number
          carried_days?: number
          auto_generated?: boolean
          generation_source?: string
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      absence_financial_year_archives: {
        Row: {
          id: string
          financial_year_start_year: number
          archived_at: string
          archived_by: string | null
          row_count: number
          notes: string | null
          idempotency_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          archived_at?: string
          archived_by?: string | null
          row_count?: number
          notes?: string | null
          idempotency_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          archived_at?: string
          archived_by?: string | null
          row_count?: number
          notes?: string | null
          idempotency_key?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          type: 'TOOLBOX_TALK' | 'REMINDER'
          subject: string
          body: string
          priority: 'HIGH' | 'LOW'
          sender_id: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
          created_via: string
        }
        Insert: {
          id?: string
          type: 'TOOLBOX_TALK' | 'REMINDER'
          subject: string
          body: string
          priority: 'HIGH' | 'LOW'
          sender_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          created_via?: string
        }
        Update: {
          id?: string
          type?: 'TOOLBOX_TALK' | 'REMINDER'
          subject?: string
          body?: string
          priority?: 'HIGH' | 'LOW'
          sender_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          created_via?: string
        }
      }
      message_recipients: {
        Row: {
          id: string
          message_id: string
          user_id: string
          status: 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED'
          signed_at: string | null
          first_shown_at: string | null
          cleared_from_inbox_at: string | null
          signature_data: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          message_id: string
          user_id: string
          status?: 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED'
          signed_at?: string | null
          first_shown_at?: string | null
          cleared_from_inbox_at?: string | null
          signature_data?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          message_id?: string
          user_id?: string
          status?: 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED'
          signed_at?: string | null
          first_shown_at?: string | null
          cleared_from_inbox_at?: string | null
          signature_data?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      customers: {
        Row: {
          id: string
          company_name: string
          short_name: string | null
          contact_name: string | null
          contact_email: string | null
          contact_phone: string | null
          contact_job_title: string | null
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          county: string | null
          postcode: string | null
          payment_terms_days: number
          default_validity_days: number
          status: 'active' | 'inactive'
          notes: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          company_name: string
          short_name?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_job_title?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          county?: string | null
          postcode?: string | null
          payment_terms_days?: number
          default_validity_days?: number
          status?: 'active' | 'inactive'
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          company_name?: string
          short_name?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_job_title?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          county?: string | null
          postcode?: string | null
          payment_terms_days?: number
          default_validity_days?: number
          status?: 'active' | 'inactive'
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
      }
      quotes: {
        Row: {
          id: string
          quote_reference: string
          base_quote_reference: string
          customer_id: string
          quote_thread_id: string
          parent_quote_id: string | null
          requester_id: string | null
          requester_initials: string | null
          quote_date: string
          attention_name: string | null
          attention_email: string | null
          subject_line: string | null
          project_description: string | null
          salutation: string | null
          site_address: string | null
          validity_days: number
          subtotal: number
          total: number
          status:
            | 'draft'
            | 'pending_internal_approval'
            | 'changes_requested'
            | 'approved'
            | 'sent'
            | 'won'
            | 'lost'
            | 'ready_to_invoice'
            | 'po_received'
            | 'in_progress'
            | 'completed_part'
            | 'completed_full'
            | 'partially_invoiced'
            | 'invoiced'
            | 'closed'
          accepted: boolean
          po_number: string | null
          po_received_at: string | null
          po_value: number | null
          started: boolean
          start_date: string | null
          start_alert_days: number | null
          start_alert_sent_at: string | null
          invoice_number: string | null
          invoice_notes: string | null
          last_invoice_at: string | null
          signoff_name: string | null
          signoff_title: string | null
          custom_footer_text: string | null
          revision_number: number
          revision_type: 'original' | 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate'
          version_label: string | null
          version_notes: string | null
          is_latest_version: boolean
          duplicate_source_quote_id: string | null
          manager_name: string | null
          manager_email: string | null
          approver_profile_id: string | null
          approved_by: string | null
          approved_at: string | null
          returned_at: string | null
          return_comments: string | null
          customer_sent_at: string | null
          customer_sent_by: string | null
          completion_status: 'not_completed' | 'approved_in_full' | 'approved_in_part'
          completion_comments: string | null
          commercial_status: 'open' | 'closed'
          closed_at: string | null
          rams_requested_at: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          sent_at: string | null
          accepted_at: string | null
          invoiced_at: string | null
        }
        Insert: {
          id?: string
          quote_reference: string
          base_quote_reference?: string
          customer_id: string
          quote_thread_id?: string
          parent_quote_id?: string | null
          requester_id?: string | null
          requester_initials?: string | null
          quote_date?: string
          attention_name?: string | null
          attention_email?: string | null
          subject_line?: string | null
          project_description?: string | null
          salutation?: string | null
          site_address?: string | null
          validity_days?: number
          subtotal?: number
          total?: number
          status?:
            | 'draft'
            | 'pending_internal_approval'
            | 'changes_requested'
            | 'approved'
            | 'sent'
            | 'won'
            | 'lost'
            | 'ready_to_invoice'
            | 'po_received'
            | 'in_progress'
            | 'completed_part'
            | 'completed_full'
            | 'partially_invoiced'
            | 'invoiced'
            | 'closed'
          accepted?: boolean
          po_number?: string | null
          po_received_at?: string | null
          po_value?: number | null
          started?: boolean
          start_date?: string | null
          start_alert_days?: number | null
          start_alert_sent_at?: string | null
          invoice_number?: string | null
          invoice_notes?: string | null
          last_invoice_at?: string | null
          signoff_name?: string | null
          signoff_title?: string | null
          custom_footer_text?: string | null
          revision_number?: number
          revision_type?: 'original' | 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate'
          version_label?: string | null
          version_notes?: string | null
          is_latest_version?: boolean
          duplicate_source_quote_id?: string | null
          manager_name?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          approved_by?: string | null
          approved_at?: string | null
          returned_at?: string | null
          return_comments?: string | null
          customer_sent_at?: string | null
          customer_sent_by?: string | null
          completion_status?: 'not_completed' | 'approved_in_full' | 'approved_in_part'
          completion_comments?: string | null
          commercial_status?: 'open' | 'closed'
          closed_at?: string | null
          rams_requested_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          sent_at?: string | null
          accepted_at?: string | null
          invoiced_at?: string | null
        }
        Update: {
          id?: string
          quote_reference?: string
          base_quote_reference?: string
          customer_id?: string
          quote_thread_id?: string
          parent_quote_id?: string | null
          requester_id?: string | null
          requester_initials?: string | null
          quote_date?: string
          attention_name?: string | null
          attention_email?: string | null
          subject_line?: string | null
          project_description?: string | null
          salutation?: string | null
          site_address?: string | null
          validity_days?: number
          subtotal?: number
          total?: number
          status?:
            | 'draft'
            | 'pending_internal_approval'
            | 'changes_requested'
            | 'approved'
            | 'sent'
            | 'won'
            | 'lost'
            | 'ready_to_invoice'
            | 'po_received'
            | 'in_progress'
            | 'completed_part'
            | 'completed_full'
            | 'partially_invoiced'
            | 'invoiced'
            | 'closed'
          accepted?: boolean
          po_number?: string | null
          po_received_at?: string | null
          po_value?: number | null
          started?: boolean
          start_date?: string | null
          start_alert_days?: number | null
          start_alert_sent_at?: string | null
          invoice_number?: string | null
          invoice_notes?: string | null
          last_invoice_at?: string | null
          signoff_name?: string | null
          signoff_title?: string | null
          custom_footer_text?: string | null
          revision_number?: number
          revision_type?: 'original' | 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate'
          version_label?: string | null
          version_notes?: string | null
          is_latest_version?: boolean
          duplicate_source_quote_id?: string | null
          manager_name?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          approved_by?: string | null
          approved_at?: string | null
          returned_at?: string | null
          return_comments?: string | null
          customer_sent_at?: string | null
          customer_sent_by?: string | null
          completion_status?: 'not_completed' | 'approved_in_full' | 'approved_in_part'
          completion_comments?: string | null
          commercial_status?: 'open' | 'closed'
          closed_at?: string | null
          rams_requested_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          sent_at?: string | null
          accepted_at?: string | null
          invoiced_at?: string | null
        }
      }
      quote_line_items: {
        Row: {
          id: string
          quote_id: string
          description: string
          quantity: number
          unit: string | null
          unit_rate: number
          line_total: number
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          description: string
          quantity?: number
          unit?: string | null
          unit_rate?: number
          line_total?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          quote_id?: string
          description?: string
          quantity?: number
          unit?: string | null
          unit_rate?: number
          line_total?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      quote_sequences: {
        Row: {
          id: string
          requester_initials: string
          next_number: number
          updated_at: string
        }
        Insert: {
          id?: string
          requester_initials: string
          next_number?: number
          updated_at?: string
        }
        Update: {
          id?: string
          requester_initials?: string
          next_number?: number
          updated_at?: string
        }
      }
      quote_manager_series: {
        Row: {
          profile_id: string
          initials: string
          next_number: number
          number_start: number
          signoff_name: string | null
          signoff_title: string | null
          manager_email: string | null
          approver_profile_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          initials: string
          next_number: number
          number_start: number
          signoff_name?: string | null
          signoff_title?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          initials?: string
          next_number?: number
          number_start?: number
          signoff_name?: string | null
          signoff_title?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      quote_timeline_events: {
        Row: {
          id: string
          quote_id: string
          quote_thread_id: string
          quote_reference: string
          event_type: string
          title: string
          description: string | null
          from_status: string | null
          to_status: string | null
          actor_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          quote_thread_id: string
          quote_reference: string
          event_type: string
          title: string
          description?: string | null
          from_status?: string | null
          to_status?: string | null
          actor_user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          quote_id?: string
          quote_thread_id?: string
          quote_reference?: string
          event_type?: string
          title?: string
          description?: string | null
          from_status?: string | null
          to_status?: string | null
          actor_user_id?: string | null
          created_at?: string
        }
      }
      quote_attachments: {
        Row: {
          id: string
          quote_id: string
          file_name: string
          file_path: string
          content_type: string | null
          file_size: number | null
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          file_name: string
          file_path: string
          content_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          quote_id?: string
          file_name?: string
          file_path?: string
          content_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
      }
      quote_invoices: {
        Row: {
          id: string
          quote_id: string
          invoice_number: string
          invoice_date: string
          amount: number
          invoice_scope: 'full' | 'partial'
          comments: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          invoice_number: string
          invoice_date?: string
          amount: number
          invoice_scope?: 'full' | 'partial'
          comments?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          quote_id?: string
          invoice_number?: string
          invoice_date?: string
          amount?: number
          invoice_scope?: 'full' | 'partial'
          comments?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      quote_invoice_allocations: {
        Row: {
          id: string
          quote_invoice_id: string
          quote_line_item_id: string | null
          quantity_invoiced: number | null
          amount_invoiced: number
          comments: string | null
          created_at: string
        }
        Insert: {
          id?: string
          quote_invoice_id: string
          quote_line_item_id?: string | null
          quantity_invoiced?: number | null
          amount_invoiced: number
          comments?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          quote_invoice_id?: string
          quote_line_item_id?: string | null
          quantity_invoiced?: number | null
          amount_invoiced?: number
          comments?: string | null
          created_at?: string
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

