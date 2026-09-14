// Hand-written from supabase/migrations (Docker unavailable); regenerate with pnpm db:types when Supabase runs locally.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      child_households: {
        Row: {
          child_id: string
          household_id: string
        }
        Insert: {
          child_id: string
          household_id: string
        }
        Update: {
          child_id?: string
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_households_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: true
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_households_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          id: string
          name: string
          birthday: string
          color: string
          photo_id: string | null
          allergies: string
          food_rules: string
          night_sleep_start: string | null
          night_sleep_end: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          birthday: string
          color: string
          photo_id?: string | null
          allergies?: string
          food_rules?: string
          night_sleep_start?: string | null
          night_sleep_end?: string | null
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          birthday?: string
          color?: string
          photo_id?: string | null
          allergies?: string
          food_rules?: string
          night_sleep_start?: string | null
          night_sleep_end?: string | null
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          id: string
          user_id: string
          policy_version: string
          health_data_consent: boolean
          accepted_at: string
        }
        Insert: {
          id?: string
          user_id: string
          policy_version: string
          health_data_consent: boolean
          accepted_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          policy_version?: string
          health_data_consent?: boolean
          accepted_at?: string
        }
        Relationships: []
      }
      diaper_entries: {
        Row: {
          id: string
          household_id: string
          child_id: string
          at: string
          kind: string
          display_id: string | null
          logged_by_membership_id: string | null
          sitter_session_id: string | null
          logged_by_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          at: string
          kind: string
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          at?: string
          kind?: string
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diaper_entries_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diaper_entries_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "diaper_entries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diaper_entries_logged_by_membership_id_household_id_fkey"
            columns: ["logged_by_membership_id", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "diaper_entries_sitter_session_id_household_id_fkey"
            columns: ["sitter_session_id", "household_id"]
            isOneToOne: false
            referencedRelation: "sitter_sessions"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      display_claims: {
        Row: {
          display_id: string
          token_hash: string
          expires_at: string
        }
        Insert: {
          display_id: string
          token_hash: string
          expires_at: string
        }
        Update: {
          display_id?: string
          token_hash?: string
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "display_claims_display_id_fkey"
            columns: ["display_id"]
            isOneToOne: true
            referencedRelation: "displays"
            referencedColumns: ["id"]
          },
        ]
      }
      displays: {
        Row: {
          id: string
          household_id: string
          name: string
          auth_user_id: string | null
          last_seen_at: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          name: string
          auth_user_id?: string | null
          last_seen_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          auth_user_id?: string | null
          last_seen_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "displays_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      dose_entries: {
        Row: {
          id: string
          household_id: string
          child_id: string
          medicine_id: string
          at: string
          note: string | null
          logged_offline: boolean
          warnings_confirmed: string[]
          conflict_acknowledged_at: string | null
          conflict_acknowledged_by: string | null
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
          display_id: string | null
          logged_by_membership_id: string | null
          sitter_session_id: string | null
          logged_by_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          medicine_id: string
          at: string
          note?: string | null
          logged_offline?: boolean
          warnings_confirmed?: string[]
          conflict_acknowledged_at?: string | null
          conflict_acknowledged_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          medicine_id?: string
          at?: string
          note?: string | null
          logged_offline?: boolean
          warnings_confirmed?: string[]
          conflict_acknowledged_at?: string | null
          conflict_acknowledged_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_entries_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_entries_conflict_acknowledged_by_household_id_fkey"
            columns: ["conflict_acknowledged_by", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "dose_entries_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "dose_entries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_entries_logged_by_membership_id_household_id_fkey"
            columns: ["logged_by_membership_id", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "dose_entries_medicine_id_child_id_fkey"
            columns: ["medicine_id", "child_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id", "child_id"]
          },
          {
            foreignKeyName: "dose_entries_sitter_session_id_household_id_fkey"
            columns: ["sitter_session_id", "household_id"]
            isOneToOne: false
            referencedRelation: "sitter_sessions"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "dose_entries_voided_by_household_id_fkey"
            columns: ["voided_by", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      feature_overrides: {
        Row: {
          id: string
          child_id: string
          feature: string
          enabled: boolean
        }
        Insert: {
          id?: string
          child_id: string
          feature: string
          enabled: boolean
        }
        Update: {
          id?: string
          child_id?: string
          feature?: string
          enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "feature_overrides_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      feeding_entries: {
        Row: {
          id: string
          household_id: string
          child_id: string
          at: string
          type: string
          amount: string | null
          note: string | null
          display_id: string | null
          logged_by_membership_id: string | null
          sitter_session_id: string | null
          logged_by_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          at: string
          type: string
          amount?: string | null
          note?: string | null
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          at?: string
          type?: string
          amount?: string | null
          note?: string | null
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feeding_entries_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feeding_entries_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "feeding_entries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feeding_entries_logged_by_membership_id_household_id_fkey"
            columns: ["logged_by_membership_id", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "feeding_entries_sitter_session_id_household_id_fkey"
            columns: ["sitter_session_id", "household_id"]
            isOneToOne: false
            referencedRelation: "sitter_sessions"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      grocery_items: {
        Row: {
          id: string
          household_id: string
          text: string
          display_id: string | null
          created_at: string
          checked_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          text: string
          display_id?: string | null
          created_at?: string
          checked_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          text?: string
          display_id?: string | null
          created_at?: string
          checked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grocery_items_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "grocery_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          id: string
          name: string
          time_zone: string
          zip: string | null
          lat: number | null
          lon: number | null
          plan: string
          default_night_sleep_start: string
          default_night_sleep_end: string
          night_mode_start: string
          night_mode_end: string
          leave_by_buffer_min: number
          diaper_log_enabled: boolean
          dinner_tonight: string | null
          sitter_info: Json
          created_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          name: string
          time_zone: string
          zip?: string | null
          lat?: number | null
          lon?: number | null
          plan?: string
          default_night_sleep_start?: string
          default_night_sleep_end?: string
          night_mode_start?: string
          night_mode_end?: string
          leave_by_buffer_min?: number
          diaper_log_enabled?: boolean
          dinner_tonight?: string | null
          sitter_info?: Json
          created_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          time_zone?: string
          zip?: string | null
          lat?: number | null
          lon?: number | null
          plan?: string
          default_night_sleep_start?: string
          default_night_sleep_end?: string
          night_mode_start?: string
          night_mode_end?: string
          leave_by_buffer_min?: number
          diaper_log_enabled?: boolean
          dinner_tonight?: string | null
          sitter_info?: Json
          created_at?: string
          deleted_at?: string | null
        }
        Relationships: []
      }
      invite_codes: {
        Row: {
          code: string
          used_by_household_id: string | null
          used_at: string | null
        }
        Insert: {
          code: string
          used_by_household_id?: string | null
          used_at?: string | null
        }
        Update: {
          code?: string
          used_by_household_id?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_codes_used_by_household_id_fkey"
            columns: ["used_by_household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      jots: {
        Row: {
          id: string
          household_id: string
          text: string
          display_id: string | null
          created_at: string
          done_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          text: string
          display_id?: string | null
          created_at?: string
          done_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          text?: string
          display_id?: string | null
          created_at?: string
          done_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jots_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "jots_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          id: string
          household_id: string
          child_id: string
          name: string
          min_interval_hours: number
          max_doses_per_24h: number | null
          archived_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          name: string
          min_interval_hours: number
          max_doses_per_24h?: number | null
          archived_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          name?: string
          min_interval_hours?: number
          max_doses_per_24h?: number | null
          archived_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicines_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      member_pins: {
        Row: {
          membership_id: string
          pin_hash: string
          updated_at: string
        }
        Insert: {
          membership_id: string
          pin_hash: string
          updated_at?: string
        }
        Update: {
          membership_id?: string
          pin_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_pins_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: true
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          id: string
          user_id: string
          household_id: string
          role: string
          display_name: string
          color: string
          joined_at: string
          left_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          household_id: string
          role: string
          display_name: string
          color: string
          joined_at?: string
          left_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          household_id?: string
          role?: string
          display_name?: string
          color?: string
          joined_at?: string
          left_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          id: string
          household_id: string
          storage_path: string
          kind: string
          added_at: string
        }
        Insert: {
          id?: string
          household_id: string
          storage_path: string
          kind: string
          added_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          storage_path?: string
          kind?: string
          added_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_day_overrides: {
        Row: {
          id: string
          household_id: string
          child_id: string
          day: string
          routine_id: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          day: string
          routine_id: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          day?: string
          routine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_day_overrides_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_day_overrides_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_day_overrides_routine_id_child_id_fkey"
            columns: ["routine_id", "child_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id", "child_id"]
          },
        ]
      }
      routine_progress: {
        Row: {
          id: string
          household_id: string
          child_id: string
          routine_id: string
          day: string
          completed_step_indexes: number[]
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          routine_id: string
          day: string
          completed_step_indexes?: number[]
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          routine_id?: string
          day?: string
          completed_step_indexes?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "routine_progress_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_progress_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_progress_routine_id_child_id_fkey"
            columns: ["routine_id", "child_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id", "child_id"]
          },
        ]
      }
      routines: {
        Row: {
          id: string
          household_id: string
          child_id: string
          name: string
          weekdays: number[]
          steps: Json
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          name: string
          weekdays?: number[]
          steps?: Json
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          name?: string
          weekdays?: number[]
          steps?: Json
          sort_order?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routines_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_audit: {
        Row: {
          id: number
          household_id: string
          membership_id: string | null
          change: Json
          at: string
        }
        Insert: {
          id?: number
          household_id: string
          membership_id?: string | null
          change: Json
          at?: string
        }
        Update: {
          id?: number
          household_id?: string
          membership_id?: string | null
          change?: Json
          at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_audit_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_audit_membership_id_household_id_fkey"
            columns: ["membership_id", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      sitter_sessions: {
        Row: {
          id: string
          household_id: string
          display_id: string | null
          sitter_name: string | null
          started_at: string
          ended_at: string | null
          summary_shown_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          display_id?: string | null
          sitter_name?: string | null
          started_at?: string
          ended_at?: string | null
          summary_shown_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          display_id?: string | null
          sitter_name?: string | null
          started_at?: string
          ended_at?: string | null
          summary_shown_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sitter_sessions_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "sitter_sessions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      sleep_entries: {
        Row: {
          id: string
          household_id: string
          child_id: string
          start_at: string
          end_at: string | null
          type: string
          display_id: string | null
          logged_by_membership_id: string | null
          sitter_session_id: string | null
          logged_by_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          start_at: string
          end_at?: string | null
          type: string
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          start_at?: string
          end_at?: string | null
          type?: string
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sleep_entries_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sleep_entries_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "sleep_entries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sleep_entries_logged_by_membership_id_household_id_fkey"
            columns: ["logged_by_membership_id", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "sleep_entries_sitter_session_id_household_id_fkey"
            columns: ["sitter_session_id", "household_id"]
            isOneToOne: false
            referencedRelation: "sitter_sessions"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      sticker_categories: {
        Row: {
          id: string
          household_id: string
          name: string
          icon_key: string
          sort_order: number
          archived_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          name: string
          icon_key: string
          sort_order?: number
          archived_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          icon_key?: string
          sort_order?: number
          archived_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sticker_categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      sticker_entries: {
        Row: {
          id: string
          household_id: string
          child_id: string
          category_id: string
          at: string
          display_id: string | null
          logged_by_membership_id: string | null
          sitter_session_id: string | null
          logged_by_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          household_id: string
          child_id: string
          category_id: string
          at: string
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          child_id?: string
          category_id?: string
          at?: string
          display_id?: string | null
          logged_by_membership_id?: string | null
          sitter_session_id?: string | null
          logged_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_entries_category_id_household_id_fkey"
            columns: ["category_id", "household_id"]
            isOneToOne: false
            referencedRelation: "sticker_categories"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "sticker_entries_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_entries_display_id_household_id_fkey"
            columns: ["display_id", "household_id"]
            isOneToOne: false
            referencedRelation: "displays"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "sticker_entries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_entries_logged_by_membership_id_household_id_fkey"
            columns: ["logged_by_membership_id", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "sticker_entries_sitter_session_id_household_id_fkey"
            columns: ["sitter_session_id", "household_id"]
            isOneToOne: false
            referencedRelation: "sitter_sessions"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      take_list_links: {
        Row: {
          id: string
          household_id: string
          token_hash: string
          expires_at: string
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          token_hash: string
          expires_at: string
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          token_hash?: string
          expires_at?: string
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "take_list_links_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_dose_conflict: {
        Args: {
          p_dose_id: string
          p_membership_id: string
          p_pin: string
        }
        Returns: undefined
      }
      add_child: {
        Args: {
          p_household_id: string
          p_name: string
          p_birthday: string
          p_color: string
        }
        Returns: string
      }
      claim_display: {
        Args: {
          p_token: string
        }
        Returns: {
          out_display_id: string
          out_household_id: string
        }[]
      }
      create_household: {
        Args: {
          p_name: string
          p_time_zone: string
          p_zip: string
          p_lat: number | null
          p_lon: number | null
          p_invite_code: string
          p_display_name: string
          p_color: string
        }
        Returns: string
      }
      display_heartbeat: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      my_display: {
        Args: Record<PropertyKey, never>
        Returns: {
          out_display_id: string
          out_household_id: string
          out_name: string
          out_revoked: boolean
        }[]
      }
      record_consent: {
        Args: {
          p_policy_version: string
          p_health_data_consent: boolean
        }
        Returns: undefined
      }
      register_display: {
        Args: {
          p_household_id: string
          p_name: string
        }
        Returns: {
          out_display_id: string
          out_claim_token: string
        }[]
      }
      revoke_display: {
        Args: {
          p_display_id: string
        }
        Returns: undefined
      }
      set_dinner_tonight: {
        Args: {
          p_household_id: string
          p_text: string
        }
        Returns: undefined
      }
      set_my_pin: {
        Args: {
          p_household_id: string
          p_pin: string
        }
        Returns: undefined
      }
      setup_household: {
        Args: {
          p_name: string
          p_time_zone: string
          p_zip: string
          p_lat: number | null
          p_lon: number | null
          p_invite_code: string
          p_display_name: string
          p_color: string
          p_kids: Json
          p_pin: string
        }
        Returns: string
      }
      verify_pin: {
        Args: {
          p_membership_id: string
          p_pin: string
        }
        Returns: boolean
      }
      void_dose: {
        Args: {
          p_dose_id: string
          p_membership_id: string
          p_pin: string
          p_reason: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never
