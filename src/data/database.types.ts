export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
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
          allergies: string
          birthday: string
          color: string
          created_at: string
          food_rules: string
          id: string
          name: string
          night_sleep_end: string | null
          night_sleep_start: string | null
          photo_id: string | null
          sort_order: number
        }
        Insert: {
          allergies?: string
          birthday: string
          color: string
          created_at?: string
          food_rules?: string
          id?: string
          name: string
          night_sleep_end?: string | null
          night_sleep_start?: string | null
          photo_id?: string | null
          sort_order?: number
        }
        Update: {
          allergies?: string
          birthday?: string
          color?: string
          created_at?: string
          food_rules?: string
          id?: string
          name?: string
          night_sleep_end?: string | null
          night_sleep_start?: string | null
          photo_id?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          accepted_at: string
          health_data_consent: boolean
          id: string
          policy_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          health_data_consent: boolean
          id?: string
          policy_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          health_data_consent?: boolean
          id?: string
          policy_version?: string
          user_id?: string
        }
        Relationships: []
      }
      diaper_entries: {
        Row: {
          at: string
          child_id: string
          created_at: string
          display_id: string | null
          household_id: string
          id: string
          kind: string
          logged_by_membership_id: string | null
          logged_by_name: string | null
          sitter_session_id: string | null
          updated_at: string
        }
        Insert: {
          at: string
          child_id: string
          created_at?: string
          display_id?: string | null
          household_id: string
          id?: string
          kind: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          sitter_session_id?: string | null
          updated_at?: string
        }
        Update: {
          at?: string
          child_id?: string
          created_at?: string
          display_id?: string | null
          household_id?: string
          id?: string
          kind?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          sitter_session_id?: string | null
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
          expires_at: string
          token_hash: string
        }
        Insert: {
          display_id: string
          expires_at: string
          token_hash: string
        }
        Update: {
          display_id?: string
          expires_at?: string
          token_hash?: string
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
          auth_user_id: string | null
          created_at: string
          household_id: string
          id: string
          last_seen_at: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          household_id: string
          id?: string
          last_seen_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          household_id?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          revoked_at?: string | null
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
          at: string
          child_id: string
          conflict_acknowledged_at: string | null
          conflict_acknowledged_by: string | null
          created_at: string
          display_id: string | null
          household_id: string
          id: string
          logged_by_membership_id: string | null
          logged_by_name: string | null
          logged_offline: boolean
          medicine_id: string
          note: string | null
          sitter_session_id: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          warnings_confirmed: string[]
        }
        Insert: {
          at: string
          child_id: string
          conflict_acknowledged_at?: string | null
          conflict_acknowledged_by?: string | null
          created_at?: string
          display_id?: string | null
          household_id: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          logged_offline?: boolean
          medicine_id: string
          note?: string | null
          sitter_session_id?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          warnings_confirmed?: string[]
        }
        Update: {
          at?: string
          child_id?: string
          conflict_acknowledged_at?: string | null
          conflict_acknowledged_by?: string | null
          created_at?: string
          display_id?: string | null
          household_id?: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          logged_offline?: boolean
          medicine_id?: string
          note?: string | null
          sitter_session_id?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          warnings_confirmed?: string[]
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
          child_id: string
          enabled: boolean
          feature: string
          id: string
        }
        Insert: {
          child_id: string
          enabled: boolean
          feature: string
          id?: string
        }
        Update: {
          child_id?: string
          enabled?: boolean
          feature?: string
          id?: string
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
          amount: string | null
          at: string
          child_id: string
          created_at: string
          display_id: string | null
          household_id: string
          id: string
          logged_by_membership_id: string | null
          logged_by_name: string | null
          note: string | null
          sitter_session_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          amount?: string | null
          at: string
          child_id: string
          created_at?: string
          display_id?: string | null
          household_id: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          note?: string | null
          sitter_session_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          amount?: string | null
          at?: string
          child_id?: string
          created_at?: string
          display_id?: string | null
          household_id?: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          note?: string | null
          sitter_session_id?: string | null
          type?: string
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
          checked_at: string | null
          created_at: string
          display_id: string | null
          household_id: string
          id: string
          text: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          display_id?: string | null
          household_id: string
          id?: string
          text: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          display_id?: string | null
          household_id?: string
          id?: string
          text?: string
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
          created_at: string
          default_night_sleep_end: string
          default_night_sleep_start: string
          deleted_at: string | null
          diaper_log_enabled: boolean
          dinner_tonight: string | null
          id: string
          lat: number | null
          leave_by_buffer_min: number
          lon: number | null
          name: string
          night_mode_end: string
          night_mode_start: string
          plan: string
          sitter_info: Json
          time_zone: string
          zip: string | null
        }
        Insert: {
          created_at?: string
          default_night_sleep_end?: string
          default_night_sleep_start?: string
          deleted_at?: string | null
          diaper_log_enabled?: boolean
          dinner_tonight?: string | null
          id?: string
          lat?: number | null
          leave_by_buffer_min?: number
          lon?: number | null
          name: string
          night_mode_end?: string
          night_mode_start?: string
          plan?: string
          sitter_info?: Json
          time_zone: string
          zip?: string | null
        }
        Update: {
          created_at?: string
          default_night_sleep_end?: string
          default_night_sleep_start?: string
          deleted_at?: string | null
          diaper_log_enabled?: boolean
          dinner_tonight?: string | null
          id?: string
          lat?: number | null
          leave_by_buffer_min?: number
          lon?: number | null
          name?: string
          night_mode_end?: string
          night_mode_start?: string
          plan?: string
          sitter_info?: Json
          time_zone?: string
          zip?: string | null
        }
        Relationships: []
      }
      invite_codes: {
        Row: {
          code: string
          used_at: string | null
          used_by_household_id: string | null
        }
        Insert: {
          code: string
          used_at?: string | null
          used_by_household_id?: string | null
        }
        Update: {
          code?: string
          used_at?: string | null
          used_by_household_id?: string | null
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
          created_at: string
          display_id: string | null
          done_at: string | null
          household_id: string
          id: string
          text: string
        }
        Insert: {
          created_at?: string
          display_id?: string | null
          done_at?: string | null
          household_id: string
          id?: string
          text: string
        }
        Update: {
          created_at?: string
          display_id?: string | null
          done_at?: string | null
          household_id?: string
          id?: string
          text?: string
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
          archived_at: string | null
          child_id: string
          created_at: string
          household_id: string
          id: string
          max_doses_per_24h: number | null
          min_interval_hours: number
          name: string
        }
        Insert: {
          archived_at?: string | null
          child_id: string
          created_at?: string
          household_id: string
          id?: string
          max_doses_per_24h?: number | null
          min_interval_hours: number
          name: string
        }
        Update: {
          archived_at?: string | null
          child_id?: string
          created_at?: string
          household_id?: string
          id?: string
          max_doses_per_24h?: number | null
          min_interval_hours?: number
          name?: string
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
      member_invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          household_id: string
          id: string
          role: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          household_id: string
          id?: string
          role: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          household_id?: string
          id?: string
          role?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_invites_created_by_household_id_fkey"
            columns: ["created_by", "household_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "member_invites_household_id_fkey"
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
          color: string
          display_name: string
          household_id: string
          id: string
          joined_at: string
          left_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          color: string
          display_name: string
          household_id: string
          id?: string
          joined_at?: string
          left_at?: string | null
          role: string
          user_id: string
        }
        Update: {
          color?: string
          display_name?: string
          household_id?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          role?: string
          user_id?: string
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
          added_at: string
          household_id: string
          id: string
          kind: string
          storage_path: string
        }
        Insert: {
          added_at?: string
          household_id: string
          id?: string
          kind: string
          storage_path: string
        }
        Update: {
          added_at?: string
          household_id?: string
          id?: string
          kind?: string
          storage_path?: string
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
          child_id: string
          day: string
          household_id: string
          id: string
          routine_id: string
        }
        Insert: {
          child_id: string
          day: string
          household_id: string
          id?: string
          routine_id: string
        }
        Update: {
          child_id?: string
          day?: string
          household_id?: string
          id?: string
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
          child_id: string
          completed_step_indexes: number[]
          day: string
          household_id: string
          id: string
          routine_id: string
        }
        Insert: {
          child_id: string
          completed_step_indexes?: number[]
          day: string
          household_id: string
          id?: string
          routine_id: string
        }
        Update: {
          child_id?: string
          completed_step_indexes?: number[]
          day?: string
          household_id?: string
          id?: string
          routine_id?: string
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
          child_id: string
          created_at: string
          household_id: string
          id: string
          name: string
          sort_order: number
          steps: Json
          weekdays: number[]
        }
        Insert: {
          child_id: string
          created_at?: string
          household_id: string
          id?: string
          name: string
          sort_order?: number
          steps?: Json
          weekdays?: number[]
        }
        Update: {
          child_id?: string
          created_at?: string
          household_id?: string
          id?: string
          name?: string
          sort_order?: number
          steps?: Json
          weekdays?: number[]
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
          at: string
          change: Json
          household_id: string
          id: number
          membership_id: string | null
        }
        Insert: {
          at?: string
          change: Json
          household_id: string
          id?: never
          membership_id?: string | null
        }
        Update: {
          at?: string
          change?: Json
          household_id?: string
          id?: never
          membership_id?: string | null
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
          display_id: string | null
          ended_at: string | null
          household_id: string
          id: string
          sitter_name: string | null
          started_at: string
          summary_shown_at: string | null
        }
        Insert: {
          display_id?: string | null
          ended_at?: string | null
          household_id: string
          id?: string
          sitter_name?: string | null
          started_at?: string
          summary_shown_at?: string | null
        }
        Update: {
          display_id?: string | null
          ended_at?: string | null
          household_id?: string
          id?: string
          sitter_name?: string | null
          started_at?: string
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
          child_id: string
          created_at: string
          display_id: string | null
          end_at: string | null
          household_id: string
          id: string
          logged_by_membership_id: string | null
          logged_by_name: string | null
          sitter_session_id: string | null
          start_at: string
          type: string
          updated_at: string
        }
        Insert: {
          child_id: string
          created_at?: string
          display_id?: string | null
          end_at?: string | null
          household_id: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          sitter_session_id?: string | null
          start_at: string
          type: string
          updated_at?: string
        }
        Update: {
          child_id?: string
          created_at?: string
          display_id?: string | null
          end_at?: string | null
          household_id?: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          sitter_session_id?: string | null
          start_at?: string
          type?: string
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
          archived_at: string | null
          household_id: string
          icon_key: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          archived_at?: string | null
          household_id: string
          icon_key: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          archived_at?: string | null
          household_id?: string
          icon_key?: string
          id?: string
          name?: string
          sort_order?: number
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
          at: string
          category_id: string
          child_id: string
          created_at: string
          display_id: string | null
          household_id: string
          id: string
          logged_by_membership_id: string | null
          logged_by_name: string | null
          sitter_session_id: string | null
          updated_at: string
        }
        Insert: {
          at: string
          category_id: string
          child_id: string
          created_at?: string
          display_id?: string | null
          household_id: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          sitter_session_id?: string | null
          updated_at?: string
        }
        Update: {
          at?: string
          category_id?: string
          child_id?: string
          created_at?: string
          display_id?: string | null
          household_id?: string
          id?: string
          logged_by_membership_id?: string | null
          logged_by_name?: string | null
          sitter_session_id?: string | null
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
          created_at: string
          expires_at: string
          household_id: string
          id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          household_id: string
          id?: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          household_id?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
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
      accept_member_invite: {
        Args: {
          p_color: string
          p_display_name: string
          p_pin: string
          p_token: string
        }
        Returns: string
      }
      acknowledge_dose_conflict: {
        Args: { p_dose_id: string; p_membership_id: string; p_pin: string }
        Returns: undefined
      }
      add_child: {
        Args: {
          p_birthday: string
          p_color: string
          p_household_id: string
          p_name: string
        }
        Returns: string
      }
      add_child_pin: {
        Args: {
          p_birthday: string
          p_color: string
          p_membership_id: string
          p_name: string
          p_pin: string
        }
        Returns: string
      }
      archive_medicine: {
        Args: { p_medicine_id: string; p_membership_id: string; p_pin: string }
        Returns: undefined
      }
      archive_sticker_category: {
        Args: { p_category_id: string; p_membership_id: string; p_pin: string }
        Returns: undefined
      }
      claim_display: {
        Args: { p_token: string }
        Returns: {
          out_display_id: string
          out_household_id: string
        }[]
      }
      create_household: {
        Args: {
          p_color: string
          p_display_name: string
          p_invite_code: string
          p_lat: number
          p_lon: number
          p_name: string
          p_time_zone: string
          p_zip: string
        }
        Returns: string
      }
      create_member_invite: {
        Args: { p_household_id: string; p_role: string }
        Returns: {
          out_expires_at: string
          out_token: string
        }[]
      }
      delete_household: {
        Args: { p_confirm_name: string; p_household_id: string }
        Returns: undefined
      }
      delete_old_entries: {
        Args: {
          p_before: string
          p_membership_id: string
          p_pin: string
          p_table: string
        }
        Returns: number
      }
      delete_routine: {
        Args: { p_membership_id: string; p_pin: string; p_routine_id: string }
        Returns: undefined
      }
      display_heartbeat: { Args: never; Returns: boolean }
      end_sitter_session: {
        Args: { p_membership_id: string; p_pin: string; p_session_id: string }
        Returns: string
      }
      leave_household: { Args: { p_household_id: string }; Returns: undefined }
      mark_sitter_summary_shown: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      my_display: {
        Args: never
        Returns: {
          out_display_id: string
          out_household_id: string
          out_name: string
          out_revoked: boolean
        }[]
      }
      record_consent: {
        Args: { p_health_data_consent: boolean; p_policy_version: string }
        Returns: undefined
      }
      register_display: {
        Args: { p_household_id: string; p_name: string }
        Returns: {
          out_claim_token: string
          out_display_id: string
        }[]
      }
      remove_member: { Args: { p_membership_id: string }; Returns: undefined }
      rename_display: {
        Args: { p_display_id: string; p_name: string }
        Returns: undefined
      }
      revoke_display: { Args: { p_display_id: string }; Returns: undefined }
      set_dinner_tonight: {
        Args: { p_household_id: string; p_text: string }
        Returns: undefined
      }
      set_feature_override: {
        Args: {
          p_child_id: string
          p_enabled: boolean
          p_feature: string
          p_membership_id: string
          p_pin: string
        }
        Returns: undefined
      }
      set_member_role: {
        Args: { p_membership_id: string; p_role: string }
        Returns: undefined
      }
      set_my_color: {
        Args: { p_color: string; p_membership_id: string; p_pin: string }
        Returns: undefined
      }
      set_my_pin: {
        Args: { p_household_id: string; p_pin: string }
        Returns: undefined
      }
      set_routine_day_override: {
        Args: {
          p_child_id: string
          p_day: string
          p_membership_id: string
          p_pin: string
          p_routine_id: string
        }
        Returns: undefined
      }
      set_routine_step: {
        Args: {
          p_child_id: string
          p_day: string
          p_done: boolean
          p_routine_id: string
          p_step_index: number
        }
        Returns: number[]
      }
      settings_verify: {
        Args: { p_membership_id: string; p_pin: string }
        Returns: {
          out_display_name: string
          out_role: string
        }[]
      }
      setup_household: {
        Args: {
          p_color: string
          p_display_name: string
          p_invite_code: string
          p_kids: Json
          p_lat: number
          p_lon: number
          p_name: string
          p_pin: string
          p_time_zone: string
          p_zip: string
        }
        Returns: string
      }
      start_sitter_session: {
        Args: {
          p_display_id?: string
          p_household_id: string
          p_membership_id: string
          p_pin: string
          p_session_id: string
          p_sitter_name?: string
        }
        Returns: string
      }
      update_child: {
        Args: {
          p_allergies: string
          p_birthday: string
          p_child_id: string
          p_color: string
          p_food_rules: string
          p_membership_id: string
          p_name: string
          p_night_end: string
          p_night_start: string
          p_pin: string
        }
        Returns: undefined
      }
      update_household_settings: {
        Args: {
          p_default_night_end: string
          p_default_night_start: string
          p_diaper_log_enabled: boolean
          p_leave_by_buffer_min: number
          p_membership_id: string
          p_name: string
          p_night_mode_end: string
          p_night_mode_start: string
          p_pin: string
          p_time_zone: string
          p_zip: string
        }
        Returns: undefined
      }
      update_sitter_info: {
        Args: { p_info: Json; p_membership_id: string; p_pin: string }
        Returns: undefined
      }
      upsert_medicine: {
        Args: {
          p_child_id: string
          p_max_doses_per_24h: number
          p_medicine_id: string
          p_membership_id: string
          p_min_interval_hours: number
          p_name: string
          p_pin: string
        }
        Returns: string
      }
      upsert_routine: {
        Args: {
          p_child_id: string
          p_membership_id: string
          p_name: string
          p_pin: string
          p_routine_id: string
          p_steps: Json
          p_weekdays: number[]
        }
        Returns: string
      }
      upsert_sticker_category: {
        Args: {
          p_category_id: string
          p_icon_key: string
          p_membership_id: string
          p_name: string
          p_pin: string
          p_sort_order: number
        }
        Returns: string
      }
      verify_pin: {
        Args: { p_membership_id: string; p_pin: string }
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

