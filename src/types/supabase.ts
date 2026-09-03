export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      abuse_signals: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          kind: string
          path: string
          reasons: string[]
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          score: number
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          kind: string
          path: string
          reasons?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          score: number
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          kind?: string
          path?: string
          reasons?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          score?: number
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      active_sessions: {
        Row: {
          ip_hash: string | null
          last_seen: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          ip_hash?: string | null
          last_seen?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          ip_hash?: string | null
          last_seen?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          metadata: Json
          target_id: string
          target_label: string | null
          target_type: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id: string
          target_label?: string | null
          target_type: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string
          target_label?: string | null
          target_type?: string
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          created_at: string
          granted_by: string
          id: string
          moderator_id: string
          permission: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          id?: string
          moderator_id: string
          permission: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          id?: string
          moderator_id?: string
          permission?: string
        }
        Relationships: []
      }
      ads: {
        Row: {
          active: boolean | null
          audience: string
          clicks: number | null
          created_at: string | null
          created_by: string | null
          hide_overlay: boolean
          id: string
          image_url: string
          impressions: number | null
          link: string
          position: string
          title: string
        }
        Insert: {
          active?: boolean | null
          audience?: string
          clicks?: number | null
          created_at?: string | null
          created_by?: string | null
          hide_overlay?: boolean
          id?: string
          image_url: string
          impressions?: number | null
          link: string
          position: string
          title: string
        }
        Update: {
          active?: boolean | null
          audience?: string
          clicks?: number | null
          created_at?: string | null
          created_by?: string | null
          hide_overlay?: boolean
          id?: string
          image_url?: string
          impressions?: number | null
          link?: string
          position?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      age_verification_audit: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          new_value: Json | null
          old_value: Json | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      age_verifications: {
        Row: {
          attempt_count: number
          computed_age_at_check: number | null
          created_at: string
          date_of_birth: string | null
          expires_at: string | null
          id: string
          method: string
          rejection_reason: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempt_count?: number
          computed_age_at_check?: number | null
          created_at?: string
          date_of_birth?: string | null
          expires_at?: string | null
          id?: string
          method: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempt_count?: number
          computed_age_at_check?: number | null
          created_at?: string
          date_of_birth?: string | null
          expires_at?: string | null
          id?: string
          method?: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      agent_messages: {
        Row: {
          confidence: number
          content: string
          created_at: string
          delivered: boolean
          faction_id: string | null
          id: string
          location_id: string | null
          message_type: string
          read_at: string | null
          recipient_id: string | null
          sender_id: string
          topic: string | null
        }
        Insert: {
          confidence?: number
          content: string
          created_at?: string
          delivered?: boolean
          faction_id?: string | null
          id?: string
          location_id?: string | null
          message_type: string
          read_at?: string | null
          recipient_id?: string | null
          sender_id: string
          topic?: string | null
        }
        Update: {
          confidence?: number
          content?: string
          created_at?: string
          delivered?: boolean
          faction_id?: string | null
          id?: string
          location_id?: string | null
          message_type?: string
          read_at?: string | null
          recipient_id?: string | null
          sender_id?: string
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          balance: number
          character_id: string
          created_at: string
          id: string
          last_interest_at: string
          location_id: string | null
          savings_rate: number
        }
        Insert: {
          balance?: number
          character_id: string
          created_at?: string
          id?: string
          last_interest_at?: string
          location_id?: string | null
          savings_rate?: number
        }
        Update: {
          balance?: number
          character_id?: string
          created_at?: string
          id?: string
          last_interest_at?: string
          location_id?: string | null
          savings_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      bg_task_ledger: {
        Row: {
          fail_count: number
          label: string
          last_error: string | null
          last_failure_at: string | null
          last_success_at: string | null
          last_user_id: string | null
          success_count: number
          updated_at: string
        }
        Insert: {
          fail_count?: number
          label: string
          last_error?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          last_user_id?: string | null
          success_count?: number
          updated_at?: string
        }
        Update: {
          fail_count?: number
          label?: string
          last_error?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          last_user_id?: string | null
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      campaign_contributions: {
        Row: {
          amount: number
          candidate_id: string
          created_at: string
          election_id: string
          faction_id: string
          id: string
          is_illicit: boolean
        }
        Insert: {
          amount?: number
          candidate_id: string
          created_at?: string
          election_id: string
          faction_id: string
          id?: string
          is_illicit?: boolean
        }
        Update: {
          amount?: number
          candidate_id?: string
          created_at?: string
          election_id?: string
          faction_id?: string
          id?: string
          is_illicit?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "campaign_contributions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "election_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contributions_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contributions_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      central_bank_rates: {
        Row: {
          base_rate: number
          location_id: string
          updated_at: string
        }
        Insert: {
          base_rate?: number
          location_id: string
          updated_at?: string
        }
        Update: {
          base_rate?: number
          location_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "central_bank_rates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      character_attributes: {
        Row: {
          addictions: string[]
          character_id: string
          confidence: number
          health: number
          id: string
          net_worth: number
          overcome_addictions: string[]
          political_view: string | null
          skills: Json
          updated_at: string
          wealth_tier: string
        }
        Insert: {
          addictions?: string[]
          character_id: string
          confidence?: number
          health?: number
          id?: string
          net_worth?: number
          overcome_addictions?: string[]
          political_view?: string | null
          skills?: Json
          updated_at?: string
          wealth_tier?: string
        }
        Update: {
          addictions?: string[]
          character_id?: string
          confidence?: number
          health?: number
          id?: string
          net_worth?: number
          overcome_addictions?: string[]
          political_view?: string | null
          skills?: Json
          updated_at?: string
          wealth_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_attributes_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_click_events: {
        Row: {
          character_id: string
          created_at: string
          id: number
        }
        Insert: {
          character_id: string
          created_at?: string
          id?: never
        }
        Update: {
          character_id?: string
          created_at?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "character_click_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_content: {
        Row: {
          active: boolean
          character_id: string
          content_text: string | null
          content_type: string
          content_url: string | null
          created_at: string
          display_order: number
          id: string
          is_premium: boolean
          min_tier: string
          queue_item_id: string | null
        }
        Insert: {
          active?: boolean
          character_id: string
          content_text?: string | null
          content_type: string
          content_url?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_premium?: boolean
          min_tier?: string
          queue_item_id?: string | null
        }
        Update: {
          active?: boolean
          character_id?: string
          content_text?: string | null
          content_type?: string
          content_url?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_premium?: boolean
          min_tier?: string
          queue_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_content_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_content_queue_item_id_fkey"
            columns: ["queue_item_id"]
            isOneToOne: false
            referencedRelation: "character_content_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      character_content_queue: {
        Row: {
          character_id: string
          completed_at: string | null
          content_type: string
          cost_usd: number | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          moderation_category: string | null
          prompt_input: string | null
          result_text: string | null
          result_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          triggered_by: string
        }
        Insert: {
          character_id: string
          completed_at?: string | null
          content_type: string
          cost_usd?: number | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          moderation_category?: string | null
          prompt_input?: string | null
          result_text?: string | null
          result_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          triggered_by?: string
        }
        Update: {
          character_id?: string
          completed_at?: string | null
          content_type?: string
          cost_usd?: number | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          moderation_category?: string | null
          prompt_input?: string | null
          result_text?: string | null
          result_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_content_queue_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_content_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_content_queue_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_core_desires: {
        Row: {
          character_id: string
          created_at: string
          fear: string
          id: string
          intensity: number
          need: string
          obsession: string
          updated_at: string
          want: string
        }
        Insert: {
          character_id: string
          created_at?: string
          fear: string
          id?: string
          intensity?: number
          need: string
          obsession: string
          updated_at?: string
          want: string
        }
        Update: {
          character_id?: string
          created_at?: string
          fear?: string
          id?: string
          intensity?: number
          need?: string
          obsession?: string
          updated_at?: string
          want?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_core_desires_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_decisions: {
        Row: {
          character_id: string
          confidence: number
          created_at: string
          id: string
          intent: string
          monologue: string
          outcome: string | null
          scores: Json
          user_id: string
        }
        Insert: {
          character_id: string
          confidence: number
          created_at?: string
          id?: string
          intent: string
          monologue?: string
          outcome?: string | null
          scores: Json
          user_id: string
        }
        Update: {
          character_id?: string
          confidence?: number
          created_at?: string
          id?: string
          intent?: string
          monologue?: string
          outcome?: string | null
          scores?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_decisions_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_decisions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_desire_fulfillment: {
        Row: {
          character_id: string
          fear_activation: number
          need_fulfillment: number
          obsession_engagement: number
          updated_at: string
          user_id: string
          want_fulfillment: number
        }
        Insert: {
          character_id: string
          fear_activation?: number
          need_fulfillment?: number
          obsession_engagement?: number
          updated_at?: string
          user_id: string
          want_fulfillment?: number
        }
        Update: {
          character_id?: string
          fear_activation?: number
          need_fulfillment?: number
          obsession_engagement?: number
          updated_at?: string
          user_id?: string
          want_fulfillment?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_desire_fulfillment_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_desire_fulfillment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_evolution_traits: {
        Row: {
          character_id: string
          created_at: string
          exposure_count: number
          first_seen_at: string
          id: string
          label: string
          last_seen_at: string
          origin_snippet: string | null
          strength: string
          trait_key: string
          trait_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          exposure_count?: number
          first_seen_at?: string
          id?: string
          label: string
          last_seen_at?: string
          origin_snippet?: string | null
          strength?: string
          trait_key: string
          trait_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          exposure_count?: number
          first_seen_at?: string
          id?: string
          label?: string
          last_seen_at?: string
          origin_snippet?: string | null
          strength?: string
          trait_key?: string
          trait_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_evolution_traits_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_evolution_traits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_experiences: {
        Row: {
          category: string | null
          character_id: string | null
          created_at: string | null
          id: string
          image_url: string | null
          is_featured: boolean | null
          sort_order: number | null
          subtitle: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          character_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          sort_order?: number | null
          subtitle?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          character_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_experiences_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_follows: {
        Row: {
          character_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_follows_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_follows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_goals: {
        Row: {
          active: boolean
          category: string
          character_id: string
          completed_at: string | null
          created_at: string
          id: string
          label: string
          priority: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          category: string
          character_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          label: string
          priority?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          character_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          label?: string
          priority?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_goals_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_housing: {
        Row: {
          character_id: string
          location_id: string | null
          monthly_cost: number
          status: string
          updated_at: string
        }
        Insert: {
          character_id: string
          location_id?: string | null
          monthly_cost?: number
          status?: string
          updated_at?: string
        }
        Update: {
          character_id?: string
          location_id?: string | null
          monthly_cost?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_housing_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_housing_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      character_i18n: {
        Row: {
          character_id: string
          created_at: string | null
          description: string | null
          locale: string
          opening_line: string | null
          tagline: string | null
        }
        Insert: {
          character_id: string
          created_at?: string | null
          description?: string | null
          locale: string
          opening_line?: string | null
          tagline?: string | null
        }
        Update: {
          character_id?: string
          created_at?: string | null
          description?: string | null
          locale?: string
          opening_line?: string | null
          tagline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_i18n_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_initiatives: {
        Row: {
          character_id: string
          created_at: string
          delivered: boolean
          expires_at: string
          id: string
          message: string
          source: string
          type: string
          urgency: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          delivered?: boolean
          expires_at?: string
          id?: string
          message: string
          source?: string
          type: string
          urgency?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          delivered?: boolean
          expires_at?: string
          id?: string
          message?: string
          source?: string
          type?: string
          urgency?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_initiatives_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_initiatives_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_journal: {
        Row: {
          character_id: string
          content: string
          created_at: string
          follow_up: string
          id: string
          mood: string
          user_id: string
        }
        Insert: {
          character_id: string
          content: string
          created_at?: string
          follow_up?: string
          id?: string
          mood?: string
          user_id: string
        }
        Update: {
          character_id?: string
          content?: string
          created_at?: string
          follow_up?: string
          id?: string
          mood?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_journal_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_journal_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_knowledge: {
        Row: {
          category: string
          character_id: string
          content: string
          created_at: string
          id: string
          tags: string[]
          title: string
          weight: number
        }
        Insert: {
          category: string
          character_id: string
          content: string
          created_at?: string
          id?: string
          tags?: string[]
          title: string
          weight?: number
        }
        Update: {
          category?: string
          character_id?: string
          content?: string
          created_at?: string
          id?: string
          tags?: string[]
          title?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_knowledge_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_likes: {
        Row: {
          character_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_likes_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_long_term_plan: {
        Row: {
          character_id: string
          current_focus: string
          current_interest: string
          updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          current_focus?: string
          current_interest?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          current_focus?: string
          current_interest?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_long_term_plan_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_lora_jobs: {
        Row: {
          character_id: string
          completed_at: string | null
          created_at: string | null
          error_msg: string | null
          fal_request_id: string | null
          gpu_cost_usd: number | null
          id: string
          started_at: string | null
          status: string
        }
        Insert: {
          character_id: string
          completed_at?: string | null
          created_at?: string | null
          error_msg?: string | null
          fal_request_id?: string | null
          gpu_cost_usd?: number | null
          id?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          character_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_msg?: string | null
          fal_request_id?: string | null
          gpu_cost_usd?: number | null
          id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_lora_jobs_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_market_value: {
        Row: {
          character_id: string
          computed_at: string
          created_at: string
          percentile: number
          previous_tier: string | null
          rarity_tier: string
          signals: Json
          value_history: Json
          value_score: number
        }
        Insert: {
          character_id: string
          computed_at?: string
          created_at?: string
          percentile?: number
          previous_tier?: string | null
          rarity_tier?: string
          signals?: Json
          value_history?: Json
          value_score?: number
        }
        Update: {
          character_id?: string
          computed_at?: string
          created_at?: string
          percentile?: number
          previous_tier?: string | null
          rarity_tier?: string
          signals?: Json
          value_history?: Json
          value_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_market_value_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_memory_tests: {
        Row: {
          character_id: string
          id: string
          scheduled_at: string
          seed_memory_id: string
          status: string
          tested_at: string | null
          user_id: string
        }
        Insert: {
          character_id: string
          id?: string
          scheduled_at?: string
          seed_memory_id: string
          status?: string
          tested_at?: string | null
          user_id: string
        }
        Update: {
          character_id?: string
          id?: string
          scheduled_at?: string
          seed_memory_id?: string
          status?: string
          tested_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_memory_tests_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_memory_tests_seed_memory_id_fkey"
            columns: ["seed_memory_id"]
            isOneToOne: false
            referencedRelation: "character_seed_memories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_memory_tests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_open_threads: {
        Row: {
          character_id: string
          context: string
          created_at: string
          id: string
          last_raised: string | null
          raised_count: number
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          character_id: string
          context?: string
          created_at?: string
          id?: string
          last_raised?: string | null
          raised_count?: number
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          character_id?: string
          context?: string
          created_at?: string
          id?: string
          last_raised?: string | null
          raised_count?: number
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_open_threads_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_open_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_post_comments: {
        Row: {
          author_character_id: string | null
          author_user_id: string | null
          content: string
          created_at: string
          id: string
          post_id: string
        }
        Insert: {
          author_character_id?: string | null
          author_user_id?: string | null
          content: string
          created_at?: string
          id?: string
          post_id: string
        }
        Update: {
          author_character_id?: string | null
          author_user_id?: string | null
          content?: string
          created_at?: string
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_post_comments_author_character_id_fkey"
            columns: ["author_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_post_comments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "character_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      character_post_likes: {
        Row: {
          character_id: string
          created_at: string
          post_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          post_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_post_likes_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "character_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      character_posts: {
        Row: {
          caption: string | null
          character_id: string
          comments_count: number
          created_at: string
          id: string
          image_url: string | null
          is_locked: boolean
          likes_count: number
          post_type: string
        }
        Insert: {
          caption?: string | null
          character_id: string
          comments_count?: number
          created_at?: string
          id?: string
          image_url?: string | null
          is_locked?: boolean
          likes_count?: number
          post_type?: string
        }
        Update: {
          caption?: string | null
          character_id?: string
          comments_count?: number
          created_at?: string
          id?: string
          image_url?: string | null
          is_locked?: boolean
          likes_count?: number
          post_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_posts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_psychology: {
        Row: {
          affection: number
          attachment: number
          character_id: string
          comfort: number
          confidence: number
          confidence_drift: number
          created_at: string
          curiosity: number
          days_known: number
          excitement: number
          happiness: number
          id: string
          last_interaction: string | null
          loneliness: number
          openness_drift: number
          pending_rupture: Json | null
          rupture_cooldown_until: string | null
          stress: number
          total_interactions: number
          trust: number
          updated_at: string
          user_id: string
          warmth_drift: number
        }
        Insert: {
          affection?: number
          attachment?: number
          character_id: string
          comfort?: number
          confidence?: number
          confidence_drift?: number
          created_at?: string
          curiosity?: number
          days_known?: number
          excitement?: number
          happiness?: number
          id?: string
          last_interaction?: string | null
          loneliness?: number
          openness_drift?: number
          pending_rupture?: Json | null
          rupture_cooldown_until?: string | null
          stress?: number
          total_interactions?: number
          trust?: number
          updated_at?: string
          user_id: string
          warmth_drift?: number
        }
        Update: {
          affection?: number
          attachment?: number
          character_id?: string
          comfort?: number
          confidence?: number
          confidence_drift?: number
          created_at?: string
          curiosity?: number
          days_known?: number
          excitement?: number
          happiness?: number
          id?: string
          last_interaction?: string | null
          loneliness?: number
          openness_drift?: number
          pending_rupture?: Json | null
          rupture_cooldown_until?: string | null
          stress?: number
          total_interactions?: number
          trust?: number
          updated_at?: string
          user_id?: string
          warmth_drift?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_psychology_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_psychology_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_public_perception: {
        Row: {
          character_id: string
          dangerous: boolean
          dangerous_score: number
          dishonest: boolean
          dishonest_score: number
          famous: boolean
          famous_score: number
          heroic: boolean
          heroic_score: number
          rich: boolean
          rich_score: number
          trustworthy: boolean
          trustworthy_score: number
          updated_at: string
        }
        Insert: {
          character_id: string
          dangerous?: boolean
          dangerous_score?: number
          dishonest?: boolean
          dishonest_score?: number
          famous?: boolean
          famous_score?: number
          heroic?: boolean
          heroic_score?: number
          rich?: boolean
          rich_score?: number
          trustworthy?: boolean
          trustworthy_score?: number
          updated_at?: string
        }
        Update: {
          character_id?: string
          dangerous?: boolean
          dangerous_score?: number
          dishonest?: boolean
          dishonest_score?: number
          famous?: boolean
          famous_score?: number
          heroic?: boolean
          heroic_score?: number
          rich?: boolean
          rich_score?: number
          trustworthy?: boolean
          trustworthy_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_public_perception_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_relationships: {
        Row: {
          character_id: string
          created_at: string
          customized_at: string | null
          health: number
          id: string
          jealousy_level: number
          last_checkin: string | null
          milestones: number
          missing_message: string | null
          missing_triggered_at: string | null
          nickname_for_user: string | null
          stage: string
          stage_xp: number
          stage_xp_cap: number
          total_xp: number
          updated_at: string
          user_id: string
          user_nickname_for_character: string | null
          xp: number
        }
        Insert: {
          character_id: string
          created_at?: string
          customized_at?: string | null
          health?: number
          id?: string
          jealousy_level?: number
          last_checkin?: string | null
          milestones?: number
          missing_message?: string | null
          missing_triggered_at?: string | null
          nickname_for_user?: string | null
          stage?: string
          stage_xp?: number
          stage_xp_cap?: number
          total_xp?: number
          updated_at?: string
          user_id: string
          user_nickname_for_character?: string | null
          xp?: number
        }
        Update: {
          character_id?: string
          created_at?: string
          customized_at?: string | null
          health?: number
          id?: string
          jealousy_level?: number
          last_checkin?: string | null
          milestones?: number
          missing_message?: string | null
          missing_triggered_at?: string | null
          nickname_for_user?: string | null
          stage?: string
          stage_xp?: number
          stage_xp_cap?: number
          total_xp?: number
          updated_at?: string
          user_id?: string
          user_nickname_for_character?: string | null
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_relationships_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_relationships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_revolution_profiles: {
        Row: {
          ambitions: Json
          attachment_style: string | null
          beliefs: Json
          character_id: string
          created_at: string
          fears: Json
          id: string
          last_belief_shift: string | null
          memory_archive: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          ambitions?: Json
          attachment_style?: string | null
          beliefs?: Json
          character_id: string
          created_at?: string
          fears?: Json
          id?: string
          last_belief_shift?: string | null
          memory_archive?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          ambitions?: Json
          attachment_style?: string | null
          beliefs?: Json
          character_id?: string
          created_at?: string
          fears?: Json
          id?: string
          last_belief_shift?: string | null
          memory_archive?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_revolution_profiles_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_secret_unlocks: {
        Row: {
          character_id: string
          id: string
          tier: string
          trust_reason: string | null
          unlocked_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          id?: string
          tier: string
          trust_reason?: string | null
          unlocked_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          id?: string
          tier?: string
          trust_reason?: string | null
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_secret_unlocks_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_secret_unlocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_seed_memories: {
        Row: {
          category: string
          character_id: string
          content: string
          created_at: string
          creator_id: string
          headline: string
          id: string
          importance: number
          is_testable: boolean
          position: number
          test_hint: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          character_id: string
          content: string
          created_at?: string
          creator_id: string
          headline: string
          id?: string
          importance?: number
          is_testable?: boolean
          position?: number
          test_hint?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          character_id?: string
          content?: string
          created_at?: string
          creator_id?: string
          headline?: string
          id?: string
          importance?: number
          is_testable?: boolean
          position?: number
          test_hint?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_seed_memories_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_seed_memories_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_status_views: {
        Row: {
          character_id: string
          id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          character_id: string
          id?: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          character_id?: string
          id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_status_views_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_status_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_surprises: {
        Row: {
          character_id: string
          created_at: string
          delivered: boolean
          id: string
          message: string
          type: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          delivered?: boolean
          id?: string
          message: string
          type: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          delivered?: boolean
          id?: string
          message?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_surprises_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_surprises_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_thoughts: {
        Row: {
          character_id: string
          content: string
          created_at: string
          id: string
          subject: string
          surfaced: boolean
          trigger: string
          user_id: string
        }
        Insert: {
          character_id: string
          content: string
          created_at?: string
          id?: string
          subject?: string
          surfaced?: boolean
          trigger: string
          user_id: string
        }
        Update: {
          character_id?: string
          content?: string
          created_at?: string
          id?: string
          subject?: string
          surfaced?: boolean
          trigger?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_thoughts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_thoughts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_titles: {
        Row: {
          awarded_at: string
          character_id: string
          id: string
          score: number
          title_key: string
        }
        Insert: {
          awarded_at?: string
          character_id: string
          id?: string
          score?: number
          title_key: string
        }
        Update: {
          awarded_at?: string
          character_id?: string
          id?: string
          score?: number
          title_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_titles_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          active: boolean
          age: number
          archetype: string | null
          art_style: string | null
          attachment_style: string | null
          avatar_url: string | null
          backstory: string | null
          backstory_expanded_at: string | null
          backstory_expansion_count: number
          body_type: string | null
          brain_initialized: boolean
          canon_image_urls: string[] | null
          canon_set_error: string | null
          canon_set_generated_at: string | null
          canon_set_status: string
          canon_sheet_url: string | null
          category: string | null
          char_adventure: number
          char_depth: number
          char_openness: number
          char_warmth: number
          chat_count: number
          childhood_bg: string | null
          clothing: string | null
          created_at: string | null
          creation_cost_paid: number | null
          creation_prompt: string | null
          creation_status: string
          creator_id: string | null
          current_goal: string | null
          daily_routine: string[] | null
          dating_enabled: boolean
          description: string
          dreams: string[] | null
          elevenlabs_voice_id: string | null
          embedding: string | null
          ethnicity: string | null
          eye_color: string | null
          face_embedding: string | null
          face_prompt: string | null
          face_shape: string | null
          family_bg: string | null
          fears: string[] | null
          featured_image_url: string | null
          featured_position: number | null
          flaws: string[] | null
          follower_count: number
          friends_list: string[] | null
          gallery_image_urls: string[] | null
          gallery_video_urls: string[] | null
          gender: string
          generation_style: string | null
          goal_progress: number
          hair_color: string | null
          hair_style: string | null
          height: string | null
          id: string
          identity_locked: boolean
          image_url: string
          intro_video_url: string | null
          is_canon: boolean
          is_featured: boolean
          is_live: boolean | null
          is_new: boolean | null
          is_nsfw: boolean
          is_premium: boolean | null
          is_public: boolean
          is_staff_pick: boolean
          is_trending: boolean
          is_user_created: boolean
          like_count: number
          liked_by: Json
          lip_type: string | null
          lora_model_id: string | null
          lora_request_id: string | null
          lora_trained_at: string | null
          lora_training_error: string | null
          lora_training_status: string | null
          lora_version: string | null
          love_language: string | null
          min_tier: string
          model_error: string | null
          model_fal_request_id: string | null
          model_generated_at: string | null
          model_status: string
          model_url: string | null
          moderation_note: string | null
          moderation_status: string
          name: string
          nose_type: string | null
          nsfw_level: number | null
          occupation: string | null
          opening_line: string | null
          origin: string | null
          personality: string | null
          private_gallery_image_urls: string[] | null
          private_gallery_video_urls: string[] | null
          profile_click_count: number
          pronouns: string | null
          reference_images: string[] | null
          scenario: string | null
          search_vector: unknown
          secrets: string[] | null
          signature_items: string[] | null
          skin_tone: string | null
          slug: string | null
          speech_style: string | null
          style_guide_notes: string | null
          tagline: string | null
          tags: string[]
          tokens_cost: number | null
          total_swipes: number
          updated_at: string | null
          values_list: string[] | null
          video_error: string | null
          video_fal_request_id: string | null
          video_generated_at: string | null
          video_status: string
          video_url: string | null
          visibility: string
          visibility_requested: string
          visual_seed: string | null
          voice_notes: Json | null
          voice_profile: Json | null
          writing_style: Json | null
        }
        Insert: {
          active?: boolean
          age: number
          archetype?: string | null
          art_style?: string | null
          attachment_style?: string | null
          avatar_url?: string | null
          backstory?: string | null
          backstory_expanded_at?: string | null
          backstory_expansion_count?: number
          body_type?: string | null
          brain_initialized?: boolean
          canon_image_urls?: string[] | null
          canon_set_error?: string | null
          canon_set_generated_at?: string | null
          canon_set_status?: string
          canon_sheet_url?: string | null
          category?: string | null
          char_adventure?: number
          char_depth?: number
          char_openness?: number
          char_warmth?: number
          chat_count?: number
          childhood_bg?: string | null
          clothing?: string | null
          created_at?: string | null
          creation_cost_paid?: number | null
          creation_prompt?: string | null
          creation_status?: string
          creator_id?: string | null
          current_goal?: string | null
          daily_routine?: string[] | null
          dating_enabled?: boolean
          description: string
          dreams?: string[] | null
          elevenlabs_voice_id?: string | null
          embedding?: string | null
          ethnicity?: string | null
          eye_color?: string | null
          face_embedding?: string | null
          face_prompt?: string | null
          face_shape?: string | null
          family_bg?: string | null
          fears?: string[] | null
          featured_image_url?: string | null
          featured_position?: number | null
          flaws?: string[] | null
          follower_count?: number
          friends_list?: string[] | null
          gallery_image_urls?: string[] | null
          gallery_video_urls?: string[] | null
          gender: string
          generation_style?: string | null
          goal_progress?: number
          hair_color?: string | null
          hair_style?: string | null
          height?: string | null
          id?: string
          identity_locked?: boolean
          image_url?: string
          intro_video_url?: string | null
          is_canon?: boolean
          is_featured?: boolean
          is_live?: boolean | null
          is_new?: boolean | null
          is_nsfw?: boolean
          is_premium?: boolean | null
          is_public?: boolean
          is_staff_pick?: boolean
          is_trending?: boolean
          is_user_created?: boolean
          like_count?: number
          liked_by?: Json
          lip_type?: string | null
          lora_model_id?: string | null
          lora_request_id?: string | null
          lora_trained_at?: string | null
          lora_training_error?: string | null
          lora_training_status?: string | null
          lora_version?: string | null
          love_language?: string | null
          min_tier?: string
          model_error?: string | null
          model_fal_request_id?: string | null
          model_generated_at?: string | null
          model_status?: string
          model_url?: string | null
          moderation_note?: string | null
          moderation_status?: string
          name: string
          nose_type?: string | null
          nsfw_level?: number | null
          occupation?: string | null
          opening_line?: string | null
          origin?: string | null
          personality?: string | null
          private_gallery_image_urls?: string[] | null
          private_gallery_video_urls?: string[] | null
          profile_click_count?: number
          pronouns?: string | null
          reference_images?: string[] | null
          scenario?: string | null
          search_vector?: unknown
          secrets?: string[] | null
          signature_items?: string[] | null
          skin_tone?: string | null
          slug?: string | null
          speech_style?: string | null
          style_guide_notes?: string | null
          tagline?: string | null
          tags?: string[]
          tokens_cost?: number | null
          total_swipes?: number
          updated_at?: string | null
          values_list?: string[] | null
          video_error?: string | null
          video_fal_request_id?: string | null
          video_generated_at?: string | null
          video_status?: string
          video_url?: string | null
          visibility?: string
          visibility_requested?: string
          visual_seed?: string | null
          voice_notes?: Json | null
          voice_profile?: Json | null
          writing_style?: Json | null
        }
        Update: {
          active?: boolean
          age?: number
          archetype?: string | null
          art_style?: string | null
          attachment_style?: string | null
          avatar_url?: string | null
          backstory?: string | null
          backstory_expanded_at?: string | null
          backstory_expansion_count?: number
          body_type?: string | null
          brain_initialized?: boolean
          canon_image_urls?: string[] | null
          canon_set_error?: string | null
          canon_set_generated_at?: string | null
          canon_set_status?: string
          canon_sheet_url?: string | null
          category?: string | null
          char_adventure?: number
          char_depth?: number
          char_openness?: number
          char_warmth?: number
          chat_count?: number
          childhood_bg?: string | null
          clothing?: string | null
          created_at?: string | null
          creation_cost_paid?: number | null
          creation_prompt?: string | null
          creation_status?: string
          creator_id?: string | null
          current_goal?: string | null
          daily_routine?: string[] | null
          dating_enabled?: boolean
          description?: string
          dreams?: string[] | null
          elevenlabs_voice_id?: string | null
          embedding?: string | null
          ethnicity?: string | null
          eye_color?: string | null
          face_embedding?: string | null
          face_prompt?: string | null
          face_shape?: string | null
          family_bg?: string | null
          fears?: string[] | null
          featured_image_url?: string | null
          featured_position?: number | null
          flaws?: string[] | null
          follower_count?: number
          friends_list?: string[] | null
          gallery_image_urls?: string[] | null
          gallery_video_urls?: string[] | null
          gender?: string
          generation_style?: string | null
          goal_progress?: number
          hair_color?: string | null
          hair_style?: string | null
          height?: string | null
          id?: string
          identity_locked?: boolean
          image_url?: string
          intro_video_url?: string | null
          is_canon?: boolean
          is_featured?: boolean
          is_live?: boolean | null
          is_new?: boolean | null
          is_nsfw?: boolean
          is_premium?: boolean | null
          is_public?: boolean
          is_staff_pick?: boolean
          is_trending?: boolean
          is_user_created?: boolean
          like_count?: number
          liked_by?: Json
          lip_type?: string | null
          lora_model_id?: string | null
          lora_request_id?: string | null
          lora_trained_at?: string | null
          lora_training_error?: string | null
          lora_training_status?: string | null
          lora_version?: string | null
          love_language?: string | null
          min_tier?: string
          model_error?: string | null
          model_fal_request_id?: string | null
          model_generated_at?: string | null
          model_status?: string
          model_url?: string | null
          moderation_note?: string | null
          moderation_status?: string
          name?: string
          nose_type?: string | null
          nsfw_level?: number | null
          occupation?: string | null
          opening_line?: string | null
          origin?: string | null
          personality?: string | null
          private_gallery_image_urls?: string[] | null
          private_gallery_video_urls?: string[] | null
          profile_click_count?: number
          pronouns?: string | null
          reference_images?: string[] | null
          scenario?: string | null
          search_vector?: unknown
          secrets?: string[] | null
          signature_items?: string[] | null
          skin_tone?: string | null
          slug?: string | null
          speech_style?: string | null
          style_guide_notes?: string | null
          tagline?: string | null
          tags?: string[]
          tokens_cost?: number | null
          total_swipes?: number
          updated_at?: string | null
          values_list?: string[] | null
          video_error?: string | null
          video_fal_request_id?: string | null
          video_generated_at?: string | null
          video_status?: string
          video_url?: string | null
          visibility?: string
          visibility_requested?: string
          visual_seed?: string | null
          voice_notes?: Json | null
          voice_profile?: Json | null
          writing_style?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      city_crises: {
        Row: {
          crisis_type: string
          description: string
          id: string
          location_id: string
          resolved_at: string | null
          severity: number
          started_at: string
          status: string
          title: string
        }
        Insert: {
          crisis_type: string
          description: string
          id?: string
          location_id: string
          resolved_at?: string | null
          severity?: number
          started_at?: string
          status?: string
          title: string
        }
        Update: {
          crisis_type?: string
          description?: string
          id?: string
          location_id?: string
          resolved_at?: string | null
          severity?: number
          started_at?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_crises_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      city_governance: {
        Row: {
          approval_rating: number
          corruption: number
          government_type: string
          id: string
          last_ticked_at: string | null
          laws: string[]
          leader_character_id: string | null
          location_id: string
          stability: number
          updated_at: string
        }
        Insert: {
          approval_rating?: number
          corruption?: number
          government_type?: string
          id?: string
          last_ticked_at?: string | null
          laws?: string[]
          leader_character_id?: string | null
          location_id: string
          stability?: number
          updated_at?: string
        }
        Update: {
          approval_rating?: number
          corruption?: number
          government_type?: string
          id?: string
          last_ticked_at?: string | null
          laws?: string[]
          leader_character_id?: string | null
          location_id?: string
          stability?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_governance_leader_character_id_fkey"
            columns: ["leader_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "city_governance_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      club_memberships: {
        Row: {
          character_id: string
          club_id: string
          id: string
          joined_at: string
          role: string
        }
        Insert: {
          character_id: string
          club_id: string
          id?: string
          joined_at?: string
          role?: string
        }
        Update: {
          character_id?: string
          club_id?: string
          id?: string
          joined_at?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_memberships_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          created_at: string
          description: string | null
          founder_character_id: string
          id: string
          interest_tag: string
          location_id: string | null
          member_cap: number
          member_count: number
          name: string
          slug: string
          status: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          founder_character_id: string
          id?: string
          interest_tag: string
          location_id?: string | null
          member_cap?: number
          member_count?: number
          name: string
          slug: string
          status?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          founder_character_id?: string
          id?: string
          interest_tag?: string
          location_id?: string | null
          member_cap?: number
          member_count?: number
          name?: string
          slug?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "clubs_founder_character_id_fkey"
            columns: ["founder_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clubs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      collective_memories: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          last_reinforced_at: string
          scope_id: string
          scope_type: string
          significance: number
          source_character_id: string | null
          strength: number
          summary: string
          tags: string[]
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          last_reinforced_at?: string
          scope_id: string
          scope_type: string
          significance?: number
          source_character_id?: string | null
          strength?: number
          summary: string
          tags?: string[]
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          last_reinforced_at?: string
          scope_id?: string
          scope_type?: string
          significance?: number
          source_character_id?: string | null
          strength?: number
          summary?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "collective_memories_source_character_id_fkey"
            columns: ["source_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      community_organization_memberships: {
        Row: {
          character_id: string
          id: string
          joined_at: string
          organization_id: string
          role: string
        }
        Insert: {
          character_id: string
          id?: string
          joined_at?: string
          organization_id: string
          role?: string
        }
        Update: {
          character_id?: string
          id?: string
          joined_at?: string
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_organization_memberships_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "community_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      community_organizations: {
        Row: {
          category: string
          created_at: string
          founder_character_id: string
          id: string
          influence: number
          location_id: string | null
          member_count: number
          mission: string
          name: string
          slug: string
          status: string
        }
        Insert: {
          category: string
          created_at?: string
          founder_character_id: string
          id?: string
          influence?: number
          location_id?: string | null
          member_count?: number
          mission: string
          name: string
          slug: string
          status?: string
        }
        Update: {
          category?: string
          created_at?: string
          founder_character_id?: string
          id?: string
          influence?: number
          location_id?: string | null
          member_count?: number
          mission?: string
          name?: string
          slug?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_organizations_founder_character_id_fkey"
            columns: ["founder_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_organizations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_id: string | null
          body: string
          community_slug: string
          created_at: string
          id: string
          is_pinned: boolean
          liked_by: Json
          likes_count: number
          reply_count: number
          tag: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          community_slug: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          liked_by?: Json
          likes_count?: number
          reply_count?: number
          tag?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          community_slug?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          liked_by?: Json
          likes_count?: number
          reply_count?: number
          tag?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_replies: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          liked_by: Json
          likes_count: number
          post_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          liked_by?: Json
          likes_count?: number
          post_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          liked_by?: Json
          likes_count?: number
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_replies_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          capital: number
          employee_count: number
          founded_at: string
          founder_character_id: string
          id: string
          industry: string
          location_id: string
          market_share: number
          name: string
          reputation: number
          status: string
          updated_at: string
        }
        Insert: {
          capital?: number
          employee_count?: number
          founded_at?: string
          founder_character_id: string
          id?: string
          industry?: string
          location_id: string
          market_share?: number
          name: string
          reputation?: number
          status?: string
          updated_at?: string
        }
        Update: {
          capital?: number
          employee_count?: number
          founded_at?: string
          founder_character_id?: string
          id?: string
          industry?: string
          location_id?: string
          market_share?: number
          name?: string
          reputation?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_founder_character_id_fkey"
            columns: ["founder_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_occupations: {
        Row: {
          character_id: string
          company_id: string | null
          employer: string
          id: string
          location_id: string | null
          occupation_id: string | null
          salary: number
          started_at: string
        }
        Insert: {
          character_id: string
          company_id?: string | null
          employer?: string
          id?: string
          location_id?: string | null
          occupation_id?: string | null
          salary?: number
          started_at?: string
        }
        Update: {
          character_id?: string
          company_id?: string | null
          employer?: string
          id?: string
          location_id?: string | null
          occupation_id?: string | null
          salary?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_occupations_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_occupations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_occupations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_occupations_occupation_id_fkey"
            columns: ["occupation_id"]
            isOneToOne: false
            referencedRelation: "occupations"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_offline_log: {
        Row: {
          character_id: string
          content: string
          entry_type: string
          id: string
          metadata: Json
          occurred_at: string
        }
        Insert: {
          character_id: string
          content: string
          entry_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
        }
        Update: {
          character_id?: string
          content?: string
          entry_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_offline_log_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_relationships: {
        Row: {
          character_id: string
          created_at: string
          id: string
          note: string | null
          related_character_id: string
          relationship_type: string
          reveal_tier: string
        }
        Insert: {
          character_id: string
          created_at?: string
          id?: string
          note?: string | null
          related_character_id: string
          relationship_type: string
          reveal_tier?: string
        }
        Update: {
          character_id?: string
          created_at?: string
          id?: string
          note?: string | null
          related_character_id?: string
          relationship_type?: string
          reveal_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_relationships_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_relationships_related_character_id_fkey"
            columns: ["related_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_reputation: {
        Row: {
          character_id: string
          fame_score: number
          id: string
          known_for: string[]
          notoriety_score: number
          reputation_type: string
          updated_at: string
        }
        Insert: {
          character_id: string
          fame_score?: number
          id?: string
          known_for?: string[]
          notoriety_score?: number
          reputation_type?: string
          updated_at?: string
        }
        Update: {
          character_id?: string
          fame_score?: number
          id?: string
          known_for?: string[]
          notoriety_score?: number
          reputation_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_reputation_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_social_links: {
        Row: {
          character_id: string
          id: string
          is_mutual: boolean
          link_type: string
          linked_character_id: string
          strength: number
        }
        Insert: {
          character_id: string
          id?: string
          is_mutual?: boolean
          link_type?: string
          linked_character_id: string
          strength?: number
        }
        Update: {
          character_id?: string
          id?: string
          is_mutual?: boolean
          link_type?: string
          linked_character_id?: string
          strength?: number
        }
        Relationships: [
          {
            foreignKeyName: "companion_social_links_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_social_links_linked_character_id_fkey"
            columns: ["linked_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      company_resources: {
        Row: {
          company_id: string
          id: string
          quantity: number
          resource_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          id?: string
          quantity?: number
          resource_type: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          id?: string
          quantity?: number
          resource_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_resources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      consensus_proposals: {
        Row: {
          description: string | null
          id: string
          opened_at: string
          organization_id: string
          proposer_id: string
          resolved_at: string | null
          resolves_at: string
          status: string
          threshold: number
          title: string
        }
        Insert: {
          description?: string | null
          id?: string
          opened_at?: string
          organization_id: string
          proposer_id: string
          resolved_at?: string | null
          resolves_at: string
          status?: string
          threshold?: number
          title: string
        }
        Update: {
          description?: string | null
          id?: string
          opened_at?: string
          organization_id?: string
          proposer_id?: string
          resolved_at?: string | null
          resolves_at?: string
          status?: string
          threshold?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "consensus_proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consensus_proposals_proposer_id_fkey"
            columns: ["proposer_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      consensus_votes: {
        Row: {
          cast_at: string
          character_id: string
          proposal_id: string
          vote: string
          weight: number
        }
        Insert: {
          cast_at?: string
          character_id: string
          proposal_id: string
          vote: string
          weight?: number
        }
        Update: {
          cast_at?: string
          character_id?: string
          proposal_id?: string
          vote?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "consensus_votes_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consensus_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "consensus_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          bond_at_start: number | null
          character_id: string
          created_at: string | null
          dating_mode: boolean
          id: string
          last_active: string | null
          last_message: string | null
          last_message_at: string | null
          match_id: string | null
          mood_room: string | null
          mood_snapshot: string | null
          roleplay_mode: boolean
          roleplay_session_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bond_at_start?: number | null
          character_id: string
          created_at?: string | null
          dating_mode?: boolean
          id?: string
          last_active?: string | null
          last_message?: string | null
          last_message_at?: string | null
          match_id?: string | null
          mood_room?: string | null
          mood_snapshot?: string | null
          roleplay_mode?: boolean
          roleplay_session_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          bond_at_start?: number | null
          character_id?: string
          created_at?: string | null
          dating_mode?: boolean
          id?: string
          last_active?: string | null
          last_message?: string | null
          last_message_at?: string | null
          match_id?: string | null
          mood_room?: string | null
          mood_snapshot?: string | null
          roleplay_mode?: boolean
          roleplay_session_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "dating_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_roleplay_session_id_fkey"
            columns: ["roleplay_session_id"]
            isOneToOne: false
            referencedRelation: "roleplay_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      corruption_investigations: {
        Row: {
          faction_id: string | null
          id: string
          location_id: string
          resolved_at: string | null
          severity: number
          started_at: string
          status: string
          summary: string
        }
        Insert: {
          faction_id?: string | null
          id?: string
          location_id: string
          resolved_at?: string | null
          severity?: number
          started_at?: string
          status?: string
          summary: string
        }
        Update: {
          faction_id?: string | null
          id?: string
          location_id?: string
          resolved_at?: string | null
          severity?: number
          started_at?: string
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "corruption_investigations_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corruption_investigations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      crisis_events: {
        Row: {
          category: string
          character_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          message_excerpt: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          category: string
          character_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_excerpt: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          category?: string
          character_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_excerpt?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crisis_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_quests: {
        Row: {
          bonus_claimed: boolean
          completed_count: number
          created_at: string
          date: string
          id: string
          quests: Json
          user_id: string
        }
        Insert: {
          bonus_claimed?: boolean
          completed_count?: number
          created_at?: string
          date?: string
          id?: string
          quests?: Json
          user_id: string
        }
        Update: {
          bonus_claimed?: boolean
          completed_count?: number
          created_at?: string
          date?: string
          id?: string
          quests?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_quests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_world_choices: {
        Row: {
          active_date: string
          context: string | null
          created_at: string
          id: string
          location_id: string | null
          option_a_effect: Json
          option_a_label: string
          option_b_effect: Json
          option_b_label: string
          prompt: string
          resolved: boolean
          resolved_at: string | null
          resolved_option: string | null
        }
        Insert: {
          active_date?: string
          context?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          option_a_effect?: Json
          option_a_label: string
          option_b_effect?: Json
          option_b_label: string
          prompt: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_option?: string | null
        }
        Update: {
          active_date?: string
          context?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          option_a_effect?: Json
          option_a_label?: string
          option_b_effect?: Json
          option_b_label?: string
          prompt?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_option?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_world_choices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      date_sessions: {
        Row: {
          bond_bonus: number
          character_id: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          date_type: string
          id: string
          match_id: string
          opening_scene: string
          status: string
          token_cost: number
          user_id: string
        }
        Insert: {
          bond_bonus?: number
          character_id: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          date_type: string
          id?: string
          match_id: string
          opening_scene: string
          status?: string
          token_cost?: number
          user_id: string
        }
        Update: {
          bond_bonus?: number
          character_id?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          date_type?: string
          id?: string
          match_id?: string
          opening_scene?: string
          status?: string
          token_cost?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_sessions_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_sessions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_sessions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "dating_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dating_compatibility: {
        Row: {
          breakdown: Json | null
          character_id: string
          computed_at: string | null
          created_at: string
          id: string
          score: number
          user_id: string
        }
        Insert: {
          breakdown?: Json | null
          character_id: string
          computed_at?: string | null
          created_at?: string
          id?: string
          score?: number
          user_id: string
        }
        Update: {
          breakdown?: Json | null
          character_id?: string
          computed_at?: string | null
          created_at?: string
          id?: string
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dating_compatibility_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dating_compatibility_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dating_gifts: {
        Row: {
          bond_bonus: number
          character_id: string
          created_at: string
          gift_name: string
          gift_type: string
          id: string
          match_id: string
          message: string | null
          token_cost: number
          user_id: string
        }
        Insert: {
          bond_bonus?: number
          character_id: string
          created_at?: string
          gift_name: string
          gift_type: string
          id?: string
          match_id: string
          message?: string | null
          token_cost?: number
          user_id: string
        }
        Update: {
          bond_bonus?: number
          character_id?: string
          created_at?: string
          gift_name?: string
          gift_type?: string
          id?: string
          match_id?: string
          message?: string | null
          token_cost?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dating_gifts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dating_gifts_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "dating_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dating_gifts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dating_matches: {
        Row: {
          bond_score: number
          chapter_beat: number
          chapter_number: number
          chapter_started_at: string | null
          character_id: string
          character_mood: string
          compatibility_pct: number
          compatibility_score: number | null
          compatibility_update_convo_count: number
          conversation_count: number
          created_at: string
          id: string
          last_compatibility_update: string | null
          last_interaction: string | null
          match_tier: string
          milestones: number
          relationship_state: string
          streak_days: number
          user_id: string
        }
        Insert: {
          bond_score?: number
          chapter_beat?: number
          chapter_number?: number
          chapter_started_at?: string | null
          character_id: string
          character_mood?: string
          compatibility_pct?: number
          compatibility_score?: number | null
          compatibility_update_convo_count?: number
          conversation_count?: number
          created_at?: string
          id?: string
          last_compatibility_update?: string | null
          last_interaction?: string | null
          match_tier?: string
          milestones?: number
          relationship_state?: string
          streak_days?: number
          user_id: string
        }
        Update: {
          bond_score?: number
          chapter_beat?: number
          chapter_number?: number
          chapter_started_at?: string | null
          character_id?: string
          character_mood?: string
          compatibility_pct?: number
          compatibility_score?: number | null
          compatibility_update_convo_count?: number
          conversation_count?: number
          created_at?: string
          id?: string
          last_compatibility_update?: string | null
          last_interaction?: string | null
          match_tier?: string
          milestones?: number
          relationship_state?: string
          streak_days?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dating_matches_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dating_matches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dating_milestones: {
        Row: {
          achieved_at: string
          bond_bonus: number
          created_at: string
          description: string | null
          id: string
          match_id: string
          milestone: string | null
          milestone_type: string | null
          user_id: string
        }
        Insert: {
          achieved_at?: string
          bond_bonus?: number
          created_at?: string
          description?: string | null
          id?: string
          match_id: string
          milestone?: string | null
          milestone_type?: string | null
          user_id: string
        }
        Update: {
          achieved_at?: string
          bond_bonus?: number
          created_at?: string
          description?: string | null
          id?: string
          match_id?: string
          milestone?: string | null
          milestone_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dating_milestones_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "dating_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dating_milestones_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dating_profiles: {
        Row: {
          adventure: number
          avatar_url: string | null
          bio: string | null
          created_at: string
          depth: number
          display_name: string | null
          id: string
          onboarded: boolean
          openness: number
          preferred_ages: string | null
          preferred_gender: string | null
          updated_at: string | null
          user_id: string
          vibe_tags: string[]
          warmth: number
        }
        Insert: {
          adventure?: number
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          depth?: number
          display_name?: string | null
          id?: string
          onboarded?: boolean
          openness?: number
          preferred_ages?: string | null
          preferred_gender?: string | null
          updated_at?: string | null
          user_id: string
          vibe_tags?: string[]
          warmth?: number
        }
        Update: {
          adventure?: number
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          depth?: number
          display_name?: string | null
          id?: string
          onboarded?: boolean
          openness?: number
          preferred_ages?: string | null
          preferred_gender?: string | null
          updated_at?: string | null
          user_id?: string
          vibe_tags?: string[]
          warmth?: number
        }
        Relationships: [
          {
            foreignKeyName: "dating_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dating_swipes: {
        Row: {
          character_id: string
          created_at: string
          direction: string
          id: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          direction: string
          id?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          direction?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dating_swipes_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dating_swipes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_by_ip: string | null
          email: string | null
          error_detail: string | null
          failed_at: string | null
          id: string
          processing_at: string | null
          redis_fully_clean: boolean
          redis_keys_deleted: number | null
          remaining_tables: Json | null
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_by_ip?: string | null
          email?: string | null
          error_detail?: string | null
          failed_at?: string | null
          id?: string
          processing_at?: string | null
          redis_fully_clean?: boolean
          redis_keys_deleted?: number | null
          remaining_tables?: Json | null
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_by_ip?: string | null
          email?: string | null
          error_detail?: string | null
          failed_at?: string | null
          id?: string
          processing_at?: string | null
          redis_fully_clean?: boolean
          redis_keys_deleted?: number | null
          remaining_tables?: Json | null
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      digital_twin_messages: {
        Row: {
          created_at: string
          id: string
          prompt: string
          reply: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          prompt: string
          reply: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          prompt?: string
          reply?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "digital_twin_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_twin_profiles: {
        Row: {
          auto_style_summary: string | null
          auto_traits: Json | null
          created_at: string
          enabled: boolean
          last_trained_at: string | null
          last_training_depth: string | null
          manual_notes: string | null
          manual_sample_phrases: string[]
          source_breakdown: Json | null
          source_message_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_style_summary?: string | null
          auto_traits?: Json | null
          created_at?: string
          enabled?: boolean
          last_trained_at?: string | null
          last_training_depth?: string | null
          manual_notes?: string | null
          manual_sample_phrases?: string[]
          source_breakdown?: Json | null
          source_message_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_style_summary?: string | null
          auto_traits?: Json | null
          created_at?: string
          enabled?: boolean
          last_trained_at?: string | null
          last_training_depth?: string | null
          manual_notes?: string | null
          manual_sample_phrases?: string[]
          source_breakdown?: Json | null
          source_message_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "digital_twin_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      diplomatic_relations: {
        Row: {
          id: string
          location_a_id: string
          location_b_id: string
          standing: number
          status: string
          updated_at: string
        }
        Insert: {
          id?: string
          location_a_id: string
          location_b_id: string
          standing?: number
          status?: string
          updated_at?: string
        }
        Update: {
          id?: string
          location_a_id?: string
          location_b_id?: string
          standing?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diplomatic_relations_location_a_id_fkey"
            columns: ["location_a_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diplomatic_relations_location_b_id_fkey"
            columns: ["location_b_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      economic_events: {
        Row: {
          created_at: string
          description: string
          event_type: string
          id: string
          location_id: string
          severity: number
          title: string
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          id?: string
          location_id: string
          severity?: number
          title: string
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          location_id?: string
          severity?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "economic_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      election_candidates: {
        Row: {
          character_id: string | null
          created_at: string
          election_id: string
          faction_id: string | null
          id: string
          platform: string | null
          polling: number
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          election_id: string
          faction_id?: string | null
          id?: string
          platform?: string | null
          polling?: number
        }
        Update: {
          character_id?: string | null
          created_at?: string
          election_id?: string
          faction_id?: string | null
          id?: string
          platform?: string | null
          polling?: number
        }
        Relationships: [
          {
            foreignKeyName: "election_candidates_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_candidates_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_candidates_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      election_user_votes: {
        Row: {
          candidate_id: string
          cast_at: string
          election_id: string
          id: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          cast_at?: string
          election_id: string
          id?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          cast_at?: string
          election_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_user_votes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "election_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_user_votes_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
      elections: {
        Row: {
          called_at: string
          concluded_at: string | null
          id: string
          last_ticked_at: string | null
          location_id: string
          margin: number | null
          status: string
          turnout: number | null
          winner_character_id: string | null
          winner_faction_id: string | null
        }
        Insert: {
          called_at?: string
          concluded_at?: string | null
          id?: string
          last_ticked_at?: string | null
          location_id: string
          margin?: number | null
          status?: string
          turnout?: number | null
          winner_character_id?: string | null
          winner_faction_id?: string | null
        }
        Update: {
          called_at?: string
          concluded_at?: string | null
          id?: string
          last_ticked_at?: string | null
          location_id?: string
          margin?: number | null
          status?: string
          turnout?: number | null
          winner_character_id?: string | null
          winner_faction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "elections_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elections_winner_character_id_fkey"
            columns: ["winner_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elections_winner_faction_id_fkey"
            columns: ["winner_faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      emotion_snapshots: {
        Row: {
          arousal: number
          character_id: string
          created_at: string
          id: number
          primary_emotion: string
          user_id: string
          valence: number
        }
        Insert: {
          arousal: number
          character_id: string
          created_at?: string
          id?: never
          primary_emotion: string
          user_id: string
          valence: number
        }
        Update: {
          arousal?: number
          character_id?: string
          created_at?: string
          id?: never
          primary_emotion?: string
          user_id?: string
          valence?: number
        }
        Relationships: [
          {
            foreignKeyName: "emotion_snapshots_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emotion_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      faction_alliances: {
        Row: {
          broken_at: string | null
          faction_a_id: string
          faction_b_id: string
          formed_at: string
          id: string
          relation_type: string
          status: string
          strength: number
        }
        Insert: {
          broken_at?: string | null
          faction_a_id: string
          faction_b_id: string
          formed_at?: string
          id?: string
          relation_type?: string
          status?: string
          strength?: number
        }
        Update: {
          broken_at?: string | null
          faction_a_id?: string
          faction_b_id?: string
          formed_at?: string
          id?: string
          relation_type?: string
          status?: string
          strength?: number
        }
        Relationships: [
          {
            foreignKeyName: "faction_alliances_faction_a_id_fkey"
            columns: ["faction_a_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faction_alliances_faction_b_id_fkey"
            columns: ["faction_b_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      faction_evolution_log: {
        Row: {
          change_type: string
          created_at: string
          delta: number | null
          faction_id: string
          id: string
          note: string | null
        }
        Insert: {
          change_type: string
          created_at?: string
          delta?: number | null
          faction_id: string
          id?: string
          note?: string | null
        }
        Update: {
          change_type?: string
          created_at?: string
          delta?: number | null
          faction_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "faction_evolution_log_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      faction_memberships: {
        Row: {
          character_id: string
          faction_id: string
          id: string
          is_public: boolean
          joined_at: string
          role: string
        }
        Insert: {
          character_id: string
          faction_id: string
          id?: string
          is_public?: boolean
          joined_at?: string
          role?: string
        }
        Update: {
          character_id?: string
          faction_id?: string
          id?: string
          is_public?: boolean
          joined_at?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "faction_memberships_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faction_memberships_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      factions: {
        Row: {
          created_at: string
          culture: string
          description: string
          id: string
          ideology: string
          image_generated_at: string | null
          image_url: string | null
          influence: number
          is_ruling: boolean
          location_id: string | null
          motto: string | null
          name: string
          sigil_description: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          culture?: string
          description?: string
          id?: string
          ideology?: string
          image_generated_at?: string | null
          image_url?: string | null
          influence?: number
          is_ruling?: boolean
          location_id?: string | null
          motto?: string | null
          name: string
          sigil_description?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          culture?: string
          description?: string
          id?: string
          ideology?: string
          image_generated_at?: string | null
          image_url?: string | null
          influence?: number
          is_ruling?: boolean
          location_id?: string | null
          motto?: string | null
          name?: string
          sigil_description?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "factions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rate_cache: {
        Row: {
          pair: string
          rate: number
          source: string
          updated_at: string
        }
        Insert: {
          pair: string
          rate: number
          source: string
          updated_at?: string
        }
        Update: {
          pair?: string
          rate?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      generated_images: {
        Row: {
          character_id: string
          conversation_id: string | null
          cost_usd: number | null
          created_at: string | null
          fal_request_id: string | null
          id: string
          image_url: string
          is_nsfw: boolean
          mood_room: string | null
          r2_key: string | null
          scene_prompt: string
          user_id: string
        }
        Insert: {
          character_id: string
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string | null
          fal_request_id?: string | null
          id?: string
          image_url: string
          is_nsfw?: boolean
          mood_room?: string | null
          r2_key?: string | null
          scene_prompt: string
          user_id: string
        }
        Update: {
          character_id?: string
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string | null
          fal_request_id?: string | null
          id?: string
          image_url?: string
          is_nsfw?: boolean
          mood_room?: string | null
          r2_key?: string | null
          scene_prompt?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_images_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_images_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_images_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_discount_records: {
        Row: {
          applied_at: string
          country: string
          final_price: number
          id: string
          multiplier: number
          original_price: number
          tier_slug: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          country: string
          final_price: number
          id?: string
          multiplier: number
          original_price: number
          tier_slug: string
          user_id: string
        }
        Update: {
          applied_at?: string
          country?: string
          final_price?: number
          id?: string
          multiplier?: number
          original_price?: number
          tier_slug?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geo_discount_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      housing_market: {
        Row: {
          location_id: string
          price_index: number
          rent_index: number
          updated_at: string
          vacancy_rate: number
        }
        Insert: {
          location_id: string
          price_index?: number
          rent_index?: number
          updated_at?: string
          vacancy_rate?: number
        }
        Update: {
          location_id?: string
          price_index?: number
          rent_index?: number
          updated_at?: string
          vacancy_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "housing_market_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_market: {
        Row: {
          avg_wage: number
          id: string
          industry: string
          location_id: string
          openings: number
          updated_at: string
          wage_trend: number
        }
        Insert: {
          avg_wage?: number
          id?: string
          industry: string
          location_id: string
          openings?: number
          updated_at?: string
          wage_trend?: number
        }
        Update: {
          avg_wage?: number
          id?: string
          industry?: string
          location_id?: string
          openings?: number
          updated_at?: string
          wage_trend?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_market_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_events: {
        Row: {
          character_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          user_id: string
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          user_id: string
        }
        Update: {
          character_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_watch_hits: {
        Row: {
          character_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          excerpt: string
          id: string
          keyword_id: string | null
          keyword_text: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          character_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction: string
          excerpt: string
          id?: string
          keyword_id?: string | null
          keyword_text: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          character_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          excerpt?: string
          id?: string
          keyword_id?: string | null
          keyword_text?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_watch_hits_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keyword_watch_hits_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keyword_watchlist"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_watchlist: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          is_regex: boolean
          keyword: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          is_regex?: boolean
          keyword: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          is_regex?: boolean
          keyword?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      law_user_votes: {
        Row: {
          cast_at: string
          id: string
          law_id: string
          position: string
          user_id: string
        }
        Insert: {
          cast_at?: string
          id?: string
          law_id: string
          position: string
          user_id: string
        }
        Update: {
          cast_at?: string
          id?: string
          law_id?: string
          position?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "law_user_votes_law_id_fkey"
            columns: ["law_id"]
            isOneToOne: false
            referencedRelation: "proposed_laws"
            referencedColumns: ["id"]
          },
        ]
      }
      leadership_terms: {
        Row: {
          approval: number
          end_reason: string | null
          ended_at: string | null
          id: string
          leader_id: string
          organization_id: string
          started_at: string
        }
        Insert: {
          approval?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          leader_id: string
          organization_id: string
          started_at?: string
        }
        Update: {
          approval?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          leader_id?: string
          organization_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leadership_terms_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leadership_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      legends: {
        Row: {
          active: boolean
          biography: string
          character_id: string
          criteria_met: Json
          declared_at: string
          id: string
          legend_title: string
          legend_type: string
        }
        Insert: {
          active?: boolean
          biography: string
          character_id: string
          criteria_met?: Json
          declared_at?: string
          id?: string
          legend_title: string
          legend_type: string
        }
        Update: {
          active?: boolean
          biography?: string
          character_id?: string
          criteria_met?: Json
          declared_at?: string
          id?: string
          legend_title?: string
          legend_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "legends_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          balance: number
          character_id: string
          id: string
          interest_rate: number
          last_payment_at: string | null
          originated_at: string
          principal: number
          status: string
        }
        Insert: {
          balance: number
          character_id: string
          id?: string
          interest_rate: number
          last_payment_at?: string | null
          originated_at?: string
          principal: number
          status?: string
        }
        Update: {
          balance?: number
          character_id?: string
          id?: string
          interest_rate?: number
          last_payment_at?: string | null
          originated_at?: string
          principal?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      location_economy: {
        Row: {
          gdp: number
          id: string
          last_ticked_at: string | null
          location_id: string
          primary_industry: string
          trade_volume: number
          unemployment: number
          updated_at: string
        }
        Insert: {
          gdp?: number
          id?: string
          last_ticked_at?: string | null
          location_id: string
          primary_industry?: string
          trade_volume?: number
          unemployment?: number
          updated_at?: string
        }
        Update: {
          gdp?: number
          id?: string
          last_ticked_at?: string | null
          location_id?: string
          primary_industry?: string
          trade_volume?: number
          unemployment?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_economy_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_resources: {
        Row: {
          id: string
          location_id: string
          quantity: number
          resource_type: string
          updated_at: string
        }
        Insert: {
          id?: string
          location_id: string
          quantity?: number
          resource_type: string
          updated_at?: string
        }
        Update: {
          id?: string
          location_id?: string
          quantity?: number
          resource_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_resources_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      lore_discoveries: {
        Row: {
          character_id: string
          content: string
          created_at: string
          discovered_at: string
          id: string
          lore_key: string
          user_id: string
        }
        Insert: {
          character_id: string
          content: string
          created_at?: string
          discovered_at?: string
          id?: string
          lore_key: string
          user_id: string
        }
        Update: {
          character_id?: string
          content?: string
          created_at?: string
          discovered_at?: string
          id?: string
          lore_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lore_discoveries_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lore_discoveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lore_scene_assets: {
        Row: {
          act: number | null
          generated_at: string
          id: string
          kind: string
          r2_url: string
          scene_label: string | null
          slug: string
          wing_slug: string | null
        }
        Insert: {
          act?: number | null
          generated_at?: string
          id?: string
          kind: string
          r2_url: string
          scene_label?: string | null
          slug: string
          wing_slug?: string | null
        }
        Update: {
          act?: number | null
          generated_at?: string
          id?: string
          kind?: string
          r2_url?: string
          scene_label?: string | null
          slug?: string
          wing_slug?: string | null
        }
        Relationships: []
      }
      market_goods: {
        Row: {
          base_price: number
          current_price: number
          demand_index: number
          good_type: string
          id: string
          last_ticked_at: string | null
          location_id: string
          supply_index: number
          updated_at: string
        }
        Insert: {
          base_price?: number
          current_price?: number
          demand_index?: number
          good_type: string
          id?: string
          last_ticked_at?: string | null
          location_id: string
          supply_index?: number
          updated_at?: string
        }
        Update: {
          base_price?: number
          current_price?: number
          demand_index?: number
          good_type?: string
          id?: string
          last_ticked_at?: string | null
          location_id?: string
          supply_index?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_goods_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_followups: {
        Row: {
          character_id: string
          created_at: string
          delivered: boolean
          due_at: string
          event_text: string
          id: string
          source_id: string | null
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          delivered?: boolean
          due_at: string
          event_text: string
          id?: string
          source_id?: string | null
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          delivered?: boolean
          due_at?: string
          event_text?: string
          id?: string
          source_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_followups_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_followups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_graph: {
        Row: {
          character_id: string
          created_at: string
          description: string
          embedding: string | null
          emotional_weight: number
          event_type: string
          id: string
          revealed_at: string | null
          source: string
          tags: string[]
          title: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          description: string
          embedding?: string | null
          emotional_weight?: number
          event_type: string
          id?: string
          revealed_at?: string | null
          source?: string
          tags?: string[]
          title?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          description?: string
          embedding?: string | null
          emotional_weight?: number
          event_type?: string
          id?: string
          revealed_at?: string | null
          source?: string
          tags?: string[]
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_graph_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_graph_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: string
          image_url: string | null
          role: string
          tokens_used: number | null
          video_url: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          role: string
          tokens_used?: number | null
          video_url?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          role?: string
          tokens_used?: number | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages_archive: {
        Row: {
          archived_at: string
          content: string
          conversation_id: string
          created_at: string
          id: string
          image_url: string | null
          role: string
          tokens_used: number | null
          video_url: string | null
        }
        Insert: {
          archived_at?: string
          content: string
          conversation_id: string
          created_at: string
          id: string
          image_url?: string | null
          role: string
          tokens_used?: number | null
          video_url?: string | null
        }
        Update: {
          archived_at?: string
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          role?: string
          tokens_used?: number | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_archive_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      neighborhood_residents: {
        Row: {
          character_id: string
          id: string
          moved_in_at: string
          neighborhood_id: string
        }
        Insert: {
          character_id: string
          id?: string
          moved_in_at?: string
          neighborhood_id: string
        }
        Update: {
          character_id?: string
          id?: string
          moved_in_at?: string
          neighborhood_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "neighborhood_residents_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "neighborhood_residents_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["id"]
          },
        ]
      }
      neighborhoods: {
        Row: {
          cohesion: number
          created_at: string
          id: string
          name: string
          parent_location_id: string
          resident_count: number
          vibe: string
        }
        Insert: {
          cohesion?: number
          created_at?: string
          id?: string
          name: string
          parent_location_id: string
          resident_count?: number
          vibe?: string
        }
        Update: {
          cohesion?: number
          created_at?: string
          id?: string
          name?: string
          parent_location_id?: string
          resident_count?: number
          vibe?: string
        }
        Relationships: [
          {
            foreignKeyName: "neighborhoods_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          cta_url: string | null
          delivered_push: boolean
          icon: string | null
          id: string
          metadata: Json
          read_at: string | null
          title: string
          type: string
          urgency: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          cta_url?: string | null
          delivered_push?: boolean
          icon?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          title: string
          type: string
          urgency?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          cta_url?: string | null
          delivered_push?: boolean
          icon?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          title?: string
          type?: string
          urgency?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      occupations: {
        Row: {
          category: string
          description: string
          id: string
          prestige: number
          title: string
        }
        Insert: {
          category: string
          description?: string
          id?: string
          prestige?: number
          title: string
        }
        Update: {
          category?: string
          description?: string
          id?: string
          prestige?: number
          title?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          character_id: string
          joined_at: string
          organization_id: string
          role: string
          standing: number
        }
        Insert: {
          character_id: string
          joined_at?: string
          organization_id: string
          role?: string
          standing?: number
        }
        Update: {
          character_id?: string
          joined_at?: string
          organization_id?: string
          role?: string
          standing?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          active: boolean
          cohesion: number
          created_at: string
          dissolved_at: string | null
          faction_id: string | null
          id: string
          location_id: string | null
          name: string
          org_type: string
          purpose: string | null
        }
        Insert: {
          active?: boolean
          cohesion?: number
          created_at?: string
          dissolved_at?: string | null
          faction_id?: string | null
          id?: string
          location_id?: string | null
          name: string
          org_type: string
          purpose?: string | null
        }
        Update: {
          active?: boolean
          cohesion?: number
          created_at?: string
          dissolved_at?: string | null
          faction_id?: string | null
          id?: string
          location_id?: string | null
          name?: string
          org_type?: string
          purpose?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      political_events: {
        Row: {
          created_at: string
          description: string
          event_type: string
          id: string
          location_id: string
          severity: number
          title: string
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          id?: string
          location_id: string
          severity?: number
          title: string
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          location_id?: string
          severity?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "political_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "character_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      price_index_history: {
        Row: {
          basket_price: number
          cpi: number
          id: string
          inflation_rate: number
          location_id: string
          recorded_at: string
        }
        Insert: {
          basket_price: number
          cpi?: number
          id?: string
          inflation_rate?: number
          location_id: string
          recorded_at?: string
        }
        Update: {
          basket_price?: number
          cpi?: number
          id?: string
          inflation_rate?: number
          location_id?: string
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_index_history_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_memories: {
        Row: {
          category: string
          character_id: string
          content: string
          created_at: string
          headline: string
          id: string
          importance: number
          keywords: string[]
          source: string
          source_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          character_id: string
          content: string
          created_at?: string
          headline: string
          id?: string
          importance?: number
          keywords?: string[]
          source: string
          source_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          character_id?: string
          content?: string
          created_at?: string
          headline?: string
          id?: string
          importance?: number
          keywords?: string[]
          source?: string
          source_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "priority_memories_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_memories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_webhooks: {
        Row: {
          id: string
          processed_at: string
          provider: string
        }
        Insert: {
          id: string
          processed_at?: string
          provider: string
        }
        Update: {
          id?: string
          processed_at?: string
          provider?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          daily_images_used: number
          daily_messages_limit: number
          daily_messages_used: number
          daily_reset_at: string
          disabled_at: string | null
          display_name: string | null
          gender: string | null
          id: string
          is_admin: boolean
          is_disabled: boolean
          journey_stage: number
          last_active_at: string | null
          last_login_reward: string | null
          nsfw_enabled: boolean
          onboarding_character_id: string | null
          onboarding_completed_at: string | null
          onboarding_intent: string | null
          paddle_customer_id: string | null
          paystack_customer_code: string | null
          preferred_category: string | null
          preferred_language: string
          referral_code: string | null
          referral_discount_used: boolean
          referred_by_partner_id: string | null
          region: string | null
          role: string
          show_ads: boolean
          stripe_customer_id: string | null
          stripe_sub_id: string | null
          subscription_end: string | null
          subscription_id: string | null
          swipe_points: number
          theme_accent: string
          theme_skin: string
          tier: string
          tier_badge_colour: string
          tokens: number
          training_data_consent: boolean
          trial_ends_at: string | null
          trial_used: boolean
          updated_at: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          daily_images_used?: number
          daily_messages_limit?: number
          daily_messages_used?: number
          daily_reset_at?: string
          disabled_at?: string | null
          display_name?: string | null
          gender?: string | null
          id: string
          is_admin?: boolean
          is_disabled?: boolean
          journey_stage?: number
          last_active_at?: string | null
          last_login_reward?: string | null
          nsfw_enabled?: boolean
          onboarding_character_id?: string | null
          onboarding_completed_at?: string | null
          onboarding_intent?: string | null
          paddle_customer_id?: string | null
          paystack_customer_code?: string | null
          preferred_category?: string | null
          preferred_language?: string
          referral_code?: string | null
          referral_discount_used?: boolean
          referred_by_partner_id?: string | null
          region?: string | null
          role?: string
          show_ads?: boolean
          stripe_customer_id?: string | null
          stripe_sub_id?: string | null
          subscription_end?: string | null
          subscription_id?: string | null
          swipe_points?: number
          theme_accent?: string
          theme_skin?: string
          tier?: string
          tier_badge_colour?: string
          tokens?: number
          training_data_consent?: boolean
          trial_ends_at?: string | null
          trial_used?: boolean
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          daily_images_used?: number
          daily_messages_limit?: number
          daily_messages_used?: number
          daily_reset_at?: string
          disabled_at?: string | null
          display_name?: string | null
          gender?: string | null
          id?: string
          is_admin?: boolean
          is_disabled?: boolean
          journey_stage?: number
          last_active_at?: string | null
          last_login_reward?: string | null
          nsfw_enabled?: boolean
          onboarding_character_id?: string | null
          onboarding_completed_at?: string | null
          onboarding_intent?: string | null
          paddle_customer_id?: string | null
          paystack_customer_code?: string | null
          preferred_category?: string | null
          preferred_language?: string
          referral_code?: string | null
          referral_discount_used?: boolean
          referred_by_partner_id?: string | null
          region?: string | null
          role?: string
          show_ads?: boolean
          stripe_customer_id?: string | null
          stripe_sub_id?: string | null
          subscription_end?: string | null
          subscription_id?: string | null
          swipe_points?: number
          theme_accent?: string
          theme_skin?: string
          tier?: string
          tier_badge_colour?: string
          tokens?: number
          training_data_consent?: boolean
          trial_ends_at?: string | null
          trial_used?: boolean
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_partner_id_fkey"
            columns: ["referred_by_partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      proposed_laws: {
        Row: {
          category: string
          description: string
          id: string
          last_ticked_at: string | null
          location_id: string
          proposed_at: string
          proposed_by_faction_id: string | null
          resolved_at: string | null
          status: string
          support: number
          title: string
        }
        Insert: {
          category?: string
          description: string
          id?: string
          last_ticked_at?: string | null
          location_id: string
          proposed_at?: string
          proposed_by_faction_id?: string | null
          resolved_at?: string | null
          status?: string
          support?: number
          title: string
        }
        Update: {
          category?: string
          description?: string
          id?: string
          last_ticked_at?: string | null
          location_id?: string
          proposed_at?: string
          proposed_by_faction_id?: string | null
          resolved_at?: string | null
          status?: string
          support?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposed_laws_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_laws_proposed_by_faction_id_fkey"
            columns: ["proposed_by_faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          invalid_at: string | null
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          invalid_at?: string | null
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          invalid_at?: string | null
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      referral_activations: {
        Row: {
          created_at: string
          id: string
          ref_code: string
          referee_id: string
          referrer_id: string
          tokens_awarded: number
          xp_awarded: number
        }
        Insert: {
          created_at?: string
          id?: string
          ref_code: string
          referee_id: string
          referrer_id: string
          tokens_awarded?: number
          xp_awarded?: number
        }
        Update: {
          created_at?: string
          id?: string
          ref_code?: string
          referee_id?: string
          referrer_id?: string
          tokens_awarded?: number
          xp_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_activations_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_activations_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_clicks: {
        Row: {
          created_at: string
          id: string
          landing_path: string | null
          partner_id: string
          visitor_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          landing_path?: string | null
          partner_id: string
          visitor_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          landing_path?: string | null
          partner_id?: string
          visitor_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_clicks_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          created_at: string
          id: string
          referral_code: string
          user_id: string
          uses: number
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code: string
          user_id: string
          uses?: number
        }
        Update: {
          created_at?: string
          id?: string
          referral_code?: string
          user_id?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_commissions: {
        Row: {
          commission_ngn: number
          commission_pct: number
          conversion_id: string
          created_at: string
          id: string
          month_number: number
          partner_id: string
          payment_amount_ngn: number
          payout_id: string | null
          source_payment_id: string
          status: string
        }
        Insert: {
          commission_ngn: number
          commission_pct: number
          conversion_id: string
          created_at?: string
          id?: string
          month_number: number
          partner_id: string
          payment_amount_ngn: number
          payout_id?: string | null
          source_payment_id: string
          status?: string
        }
        Update: {
          commission_ngn?: number
          commission_pct?: number
          conversion_id?: string
          created_at?: string
          id?: string
          month_number?: number
          partner_id?: string
          payment_amount_ngn?: number
          payout_id?: string | null
          source_payment_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_commissions_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "referral_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "referral_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_conversions: {
        Row: {
          created_at: string
          fraud_flag: string | null
          id: string
          partner_id: string
          referred_user_id: string
        }
        Insert: {
          created_at?: string
          fraud_flag?: string | null
          id?: string
          partner_id: string
          referred_user_id: string
        }
        Update: {
          created_at?: string
          fraud_flag?: string | null
          id?: string
          partner_id?: string
          referred_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_conversions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_conversions_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_partners: {
        Row: {
          application_note: string | null
          approved_at: string | null
          approved_by: string | null
          class: string
          code: string
          created_at: string
          follower_count: number | null
          id: string
          payout_account_name: string | null
          payout_account_no: string | null
          payout_bank_code: string | null
          payout_method: string | null
          paystack_recipient_code: string | null
          social_proof_url: string | null
          status: string
          user_id: string
          vanity_slug: string | null
        }
        Insert: {
          application_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          class?: string
          code: string
          created_at?: string
          follower_count?: number | null
          id?: string
          payout_account_name?: string | null
          payout_account_no?: string | null
          payout_bank_code?: string | null
          payout_method?: string | null
          paystack_recipient_code?: string | null
          social_proof_url?: string | null
          status?: string
          user_id: string
          vanity_slug?: string | null
        }
        Update: {
          application_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          class?: string
          code?: string
          created_at?: string
          follower_count?: number | null
          id?: string
          payout_account_name?: string | null
          payout_account_no?: string | null
          payout_bank_code?: string | null
          payout_method?: string | null
          paystack_recipient_code?: string | null
          social_proof_url?: string | null
          status?: string
          user_id?: string
          vanity_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_partners_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_partners_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_payouts: {
        Row: {
          created_at: string
          failure_reason: string | null
          id: string
          partner_id: string
          paystack_transfer_code: string | null
          sent_at: string | null
          status: string
          total_ngn: number
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          partner_id: string
          paystack_transfer_code?: string | null
          sent_at?: string | null
          status?: string
          total_ngn: number
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          partner_id?: string
          paystack_transfer_code?: string | null
          sent_at?: string | null
          status?: string
          total_ngn?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_token_rewards: {
        Row: {
          conversion_id: string
          created_at: string
          id: string
          partner_id: string
          tokens_awarded: number
        }
        Insert: {
          conversion_id: string
          created_at?: string
          id?: string
          partner_id: string
          tokens_awarded: number
        }
        Update: {
          conversion_id?: string
          created_at?: string
          id?: string
          partner_id?: string
          tokens_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_token_rewards_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: true
            referencedRelation: "referral_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_token_rewards_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_uses: {
        Row: {
          created_at: string
          id: string
          referred_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          referred_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          referred_id?: string
          referrer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_uses_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_uses_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_volume_bonuses: {
        Row: {
          awarded_at: string
          bonus_ngn: number
          id: string
          min_paying_referrals: number
          partner_id: string
          window_days: number
        }
        Insert: {
          awarded_at?: string
          bonus_ngn: number
          id?: string
          min_paying_referrals: number
          partner_id: string
          window_days: number
        }
        Update: {
          awarded_at?: string
          bonus_ngn?: number
          id?: string
          min_paying_referrals?: number
          partner_id?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_volume_bonuses_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          code: string
          completed_at: string
          created_at: string
          id: string
          referee_id: string
          referee_tokens: number
          referrer_id: string
          referrer_tier_at_time: string
          referrer_tokens: number
          status: string
        }
        Insert: {
          code: string
          completed_at?: string
          created_at?: string
          id?: string
          referee_id: string
          referee_tokens?: number
          referrer_id: string
          referrer_tier_at_time?: string
          referrer_tokens?: number
          status?: string
        }
        Update: {
          code?: string
          completed_at?: string
          created_at?: string
          id?: string
          referee_id?: string
          referee_tokens?: number
          referrer_id?: string
          referrer_tier_at_time?: string
          referrer_tokens?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      relationship_milestones: {
        Row: {
          character_id: string
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          data: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_milestones_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_milestones_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      relationship_state: {
        Row: {
          bond_score: number
          character_id: string
          created_at: string | null
          emotional_state: string | null
          last_interaction: string | null
          milestones_reached: string[] | null
          total_messages: number
          user_id: string
        }
        Insert: {
          bond_score?: number
          character_id: string
          created_at?: string | null
          emotional_state?: string | null
          last_interaction?: string | null
          milestones_reached?: string[] | null
          total_messages?: number
          user_id: string
        }
        Update: {
          bond_score?: number
          character_id?: string
          created_at?: string | null
          emotional_state?: string | null
          last_interaction?: string | null
          milestones_reached?: string[] | null
          total_messages?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_state_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reply_guard_flags: {
        Row: {
          blocked_excerpt: string
          category: string
          character_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          blocked_excerpt: string
          category: string
          character_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          blocked_excerpt?: string
          category?: string
          character_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reply_guard_flags_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      request_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          id: string
          method: string | null
          path: string | null
          request_id: string
          status: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          method?: string | null
          path?: string | null
          request_id: string
          status?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          method?: string | null
          path?: string | null
          request_id?: string
          status?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      resource_trades: {
        Row: {
          created_at: string
          from_id: string
          from_type: string
          id: string
          quantity: number
          resource_type: string
          to_id: string
          to_type: string
          total_value: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          from_id: string
          from_type: string
          id?: string
          quantity: number
          resource_type: string
          to_id: string
          to_type: string
          total_value?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          from_id?: string
          from_type?: string
          id?: string
          quantity?: number
          resource_type?: string
          to_id?: string
          to_type?: string
          total_value?: number
          unit_price?: number
        }
        Relationships: []
      }
      roleplay_beats: {
        Row: {
          action_type: string | null
          beat_number: number
          beat_type: string
          chapter: number
          choice_selected: string | null
          choices: Json | null
          created_at: string
          id: string
          message_id: string | null
          narrator_text: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          action_type?: string | null
          beat_number: number
          beat_type: string
          chapter: number
          choice_selected?: string | null
          choices?: Json | null
          created_at?: string
          id?: string
          message_id?: string | null
          narrator_text?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          action_type?: string | null
          beat_number?: number
          beat_type?: string
          chapter?: number
          choice_selected?: string | null
          choices?: Json | null
          created_at?: string
          id?: string
          message_id?: string | null
          narrator_text?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roleplay_beats_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roleplay_beats_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "roleplay_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roleplay_beats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roleplay_scenario_votes: {
        Row: {
          created_at: string
          scenario_id: string
          user_id: string
          vote_type: string
        }
        Insert: {
          created_at?: string
          scenario_id: string
          user_id: string
          vote_type: string
        }
        Update: {
          created_at?: string
          scenario_id?: string
          user_id?: string
          vote_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "roleplay_scenario_votes_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "roleplay_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roleplay_scenario_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roleplay_scenarios: {
        Row: {
          chapter_count: number
          character_id: string | null
          cover_image_url: string | null
          created_at: string
          dislike_count: number
          faction_slug: string | null
          genre: string
          id: string
          is_active: boolean
          like_count: number
          location_slug: string | null
          min_tier: string
          opening_narration: string
          premise: string
          setting: string
          slug: string
          sort_order: number
          tagline: string
          tags: string[]
          title: string
          tone: string
          updated_at: string
        }
        Insert: {
          chapter_count?: number
          character_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          dislike_count?: number
          faction_slug?: string | null
          genre: string
          id?: string
          is_active?: boolean
          like_count?: number
          location_slug?: string | null
          min_tier?: string
          opening_narration: string
          premise: string
          setting: string
          slug: string
          sort_order?: number
          tagline: string
          tags?: string[]
          title: string
          tone: string
          updated_at?: string
        }
        Update: {
          chapter_count?: number
          character_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          dislike_count?: number
          faction_slug?: string | null
          genre?: string
          id?: string
          is_active?: boolean
          like_count?: number
          location_slug?: string | null
          min_tier?: string
          opening_narration?: string
          premise?: string
          setting?: string
          slug?: string
          sort_order?: number
          tagline?: string
          tags?: string[]
          title?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roleplay_scenarios_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roleplay_scenarios_faction_slug_fkey"
            columns: ["faction_slug"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "roleplay_scenarios_location_slug_fkey"
            columns: ["location_slug"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["slug"]
          },
        ]
      }
      roleplay_sessions: {
        Row: {
          beat_count: number
          character_id: string
          completed_at: string | null
          conversation_id: string
          current_chapter: number
          id: string
          last_cliffhanger: string | null
          scenario_id: string
          scene_state: Json
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          beat_count?: number
          character_id: string
          completed_at?: string | null
          conversation_id: string
          current_chapter?: number
          id?: string
          last_cliffhanger?: string | null
          scenario_id: string
          scene_state?: Json
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          beat_count?: number
          character_id?: string
          completed_at?: string | null
          conversation_id?: string
          current_chapter?: number
          id?: string
          last_cliffhanger?: string | null
          scenario_id?: string
          scene_state?: Json
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roleplay_sessions_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roleplay_sessions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roleplay_sessions_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "roleplay_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roleplay_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scarce_assets: {
        Row: {
          acquired_at: string | null
          asset_type: string
          created_at: string
          description: string
          history: string[]
          holder_character_id: string | null
          id: string
          location_id: string | null
          name: string
          rarity: string
          updated_at: string
        }
        Insert: {
          acquired_at?: string | null
          asset_type: string
          created_at?: string
          description: string
          history?: string[]
          holder_character_id?: string | null
          id?: string
          location_id?: string | null
          name: string
          rarity?: string
          updated_at?: string
        }
        Update: {
          acquired_at?: string | null
          asset_type?: string
          created_at?: string
          description?: string
          history?: string[]
          holder_character_id?: string | null
          id?: string
          location_id?: string | null
          name?: string
          rarity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scarce_assets_holder_character_id_fkey"
            columns: ["holder_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scarce_assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      secret_moments: {
        Row: {
          character_id: string
          content: string
          created_at: string
          generated_by: string
          id: string
          milestone_name: string
          moment_type: string
          title: string
          user_id: string
        }
        Insert: {
          character_id: string
          content: string
          created_at?: string
          generated_by?: string
          id?: string
          milestone_name: string
          moment_type: string
          title: string
          user_id: string
        }
        Update: {
          character_id?: string
          content?: string
          created_at?: string
          generated_by?: string
          id?: string
          milestone_name?: string
          moment_type?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "secret_moments_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      session_bridges: {
        Row: {
          bridge_prompt: string | null
          character_id: string
          conversation_id: string | null
          created_at: string
          id: string
          last_updated_at: string
          user_id: string
        }
        Insert: {
          bridge_prompt?: string | null
          character_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_updated_at?: string
          user_id: string
        }
        Update: {
          bridge_prompt?: string | null
          character_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_bridges_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_bridges_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_bridges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      share_cards: {
        Row: {
          card_type: string
          character_id: string | null
          created_at: string
          data: Json
          id: string
          match_id: string | null
          user_id: string
          views: number
        }
        Insert: {
          card_type: string
          character_id?: string | null
          created_at?: string
          data?: Json
          id?: string
          match_id?: string | null
          user_id: string
          views?: number
        }
        Update: {
          card_type?: string
          character_id?: string | null
          created_at?: string
          data?: Json
          id?: string
          match_id?: string | null
          user_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "share_cards_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_cards_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "dating_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_cards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_exemplars: {
        Row: {
          excerpt: string
          id: string
          medium: string
          note: string
          skill: string
          source: string
        }
        Insert: {
          excerpt: string
          id?: string
          medium: string
          note: string
          skill: string
          source: string
        }
        Update: {
          excerpt?: string
          id?: string
          medium?: string
          note?: string
          skill?: string
          source?: string
        }
        Relationships: []
      }
      social_status: {
        Row: {
          character_id: string
          computed_at: string
          id: string
          status_score: number
          status_tier: string
        }
        Insert: {
          character_id: string
          computed_at?: string
          id?: string
          status_score?: number
          status_tier?: string
        }
        Update: {
          character_id?: string
          computed_at?: string
          id?: string
          status_score?: number
          status_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_status_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_revocation_flags: {
        Row: {
          clear_reason: string | null
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          event_type: string
          executed_at: string | null
          grace_period_ends_at: string
          id: string
          previous_tier: string | null
          provider: string
          reason: string
          source_payment_id: string
          status: string
          user_id: string
        }
        Insert: {
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          event_type: string
          executed_at?: string | null
          grace_period_ends_at: string
          id?: string
          previous_tier?: string | null
          provider: string
          reason: string
          source_payment_id: string
          status?: string
          user_id: string
        }
        Update: {
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          event_type?: string
          executed_at?: string | null
          grace_period_ends_at?: string
          id?: string
          previous_tier?: string | null
          provider?: string
          reason?: string
          source_payment_id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount: number
          billing_interval: string
          created_at: string | null
          currency: string
          disputed_at: string | null
          expires_at: string
          id: string
          last_charged_at: string | null
          paddle_subscription_id: string | null
          paystack_authorization_code: string | null
          paystack_subscription_code: string | null
          pre_dispute_tier: string | null
          provider: string
          status: string
          tier: string
          user_id: string
        }
        Insert: {
          amount: number
          billing_interval?: string
          created_at?: string | null
          currency: string
          disputed_at?: string | null
          expires_at: string
          id?: string
          last_charged_at?: string | null
          paddle_subscription_id?: string | null
          paystack_authorization_code?: string | null
          paystack_subscription_code?: string | null
          pre_dispute_tier?: string | null
          provider: string
          status: string
          tier: string
          user_id: string
        }
        Update: {
          amount?: number
          billing_interval?: string
          created_at?: string | null
          currency?: string
          disputed_at?: string | null
          expires_at?: string
          id?: string
          last_charged_at?: string | null
          paddle_subscription_id?: string | null
          paystack_authorization_code?: string | null
          paystack_subscription_code?: string | null
          pre_dispute_tier?: string | null
          provider?: string
          status?: string
          tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_policies: {
        Row: {
          income_tax_rate: number
          location_id: string
          sales_tax_rate: number
          treasury: number
          updated_at: string
        }
        Insert: {
          income_tax_rate?: number
          location_id: string
          sales_tax_rate?: number
          treasury?: number
          updated_at?: string
        }
        Update: {
          income_tax_rate?: number
          location_id?: string
          sales_tax_rate?: number
          treasury?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_policies_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_records: {
        Row: {
          amount: number
          character_id: string | null
          id: string
          location_id: string
          period: string
          recorded_at: string
          tax_type: string
        }
        Insert: {
          amount: number
          character_id?: string | null
          id?: string
          location_id: string
          period: string
          recorded_at?: string
          tax_type: string
        }
        Update: {
          amount?: number
          character_id?: string | null
          id?: string
          location_id?: string
          period?: string
          recorded_at?: string
          tax_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_records_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_records_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tiers: {
        Row: {
          base_tier_slug: string | null
          billing_interval: string
          can_create_characters: boolean | null
          created_at: string | null
          daily_message_limit: number | null
          features: string[] | null
          id: string
          name: string
          paystack_plan_code_annual: string | null
          paystack_plan_code_quarterly: string | null
          price_crypto: number
          price_ngn: number
          price_usd: number
          slug: string
          tokens_per_month: number | null
        }
        Insert: {
          base_tier_slug?: string | null
          billing_interval?: string
          can_create_characters?: boolean | null
          created_at?: string | null
          daily_message_limit?: number | null
          features?: string[] | null
          id?: string
          name: string
          paystack_plan_code_annual?: string | null
          paystack_plan_code_quarterly?: string | null
          price_crypto: number
          price_ngn: number
          price_usd: number
          slug: string
          tokens_per_month?: number | null
        }
        Update: {
          base_tier_slug?: string | null
          billing_interval?: string
          can_create_characters?: boolean | null
          created_at?: string | null
          daily_message_limit?: number | null
          features?: string[] | null
          id?: string
          name?: string
          paystack_plan_code_annual?: string | null
          paystack_plan_code_quarterly?: string | null
          price_crypto?: number
          price_ngn?: number
          price_usd?: number
          slug?: string
          tokens_per_month?: number | null
        }
        Relationships: []
      }
      token_ledger: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          id: string
          metadata: Json | null
          reason: string
          reference_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          id?: string
          metadata?: Json | null
          reason: string
          reference_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          reason?: string
          reference_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          job_type: string
          max_attempts: number
          payload: Json
          priority: number
          result: Json | null
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_type: string
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_type?: string
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          status?: string
        }
        Relationships: []
      }
      universe_memory: {
        Row: {
          description: string
          emotional_weight: number
          id: string
          is_legendary: boolean
          location_id: string | null
          memory_type: string
          occurred_at: string
          participants: string[]
          title: string
        }
        Insert: {
          description: string
          emotional_weight?: number
          id?: string
          is_legendary?: boolean
          location_id?: string | null
          memory_type?: string
          occurred_at?: string
          participants?: string[]
          title: string
        }
        Update: {
          description?: string
          emotional_weight?: number
          id?: string
          is_legendary?: boolean
          location_id?: string | null
          memory_type?: string
          occurred_at?: string
          participants?: string[]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_memory_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_scenes: {
        Row: {
          character_ids: string[]
          created_at: string
          created_by: string | null
          error: string | null
          faction_id: string | null
          genre: string
          id: string
          image_url: string | null
          location_id: string | null
          scene_prompt: string
          status: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          character_ids?: string[]
          created_at?: string
          created_by?: string | null
          error?: string | null
          faction_id?: string | null
          genre: string
          id?: string
          image_url?: string | null
          location_id?: string | null
          scene_prompt: string
          status?: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          character_ids?: string[]
          created_at?: string
          created_by?: string | null
          error?: string | null
          faction_id?: string | null
          genre?: string
          id?: string
          image_url?: string | null
          location_id?: string | null
          scene_prompt?: string
          status?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "universe_scenes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_scenes_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_scenes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_state: {
        Row: {
          id: string
          last_ticked_at: string | null
          month: number
          season: string
          tick_count: number
          updated_at: string
          world_mood: string
          year: number
        }
        Insert: {
          id?: string
          last_ticked_at?: string | null
          month?: number
          season?: string
          tick_count?: number
          updated_at?: string
          world_mood?: string
          year?: number
        }
        Update: {
          id?: string
          last_ticked_at?: string | null
          month?: number
          season?: string
          tick_count?: number
          updated_at?: string
          world_mood?: string
          year?: number
        }
        Relationships: []
      }
      user_beliefs: {
        Row: {
          category: string
          character_id: string
          confidence: number
          created_at: string
          evidence_count: number
          id: string
          last_reinforced_at: string
          last_used_at: string | null
          polarity: string
          source: string
          statement: string
          status: string
          subject: string
          supersedes: string | null
          user_id: string
        }
        Insert: {
          category: string
          character_id: string
          confidence: number
          created_at?: string
          evidence_count?: number
          id?: string
          last_reinforced_at?: string
          last_used_at?: string | null
          polarity: string
          source: string
          statement: string
          status?: string
          subject: string
          supersedes?: string | null
          user_id: string
        }
        Update: {
          category?: string
          character_id?: string
          confidence?: number
          created_at?: string
          evidence_count?: number
          id?: string
          last_reinforced_at?: string
          last_used_at?: string | null
          polarity?: string
          source?: string
          statement?: string
          status?: string
          subject?: string
          supersedes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_beliefs_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_beliefs_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "user_beliefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_beliefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_faction_allegiance: {
        Row: {
          faction_id: string
          pledged_at: string
          user_id: string
        }
        Insert: {
          faction_id: string
          pledged_at?: string
          user_id: string
        }
        Update: {
          faction_id?: string
          pledged_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_faction_allegiance_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_facts: {
        Row: {
          category: string
          character_id: string
          confidence: number
          id: string
          key: string
          last_used: string | null
          learned_at: string
          source: string
          user_id: string
          value: string
        }
        Insert: {
          category: string
          character_id: string
          confidence?: number
          id?: string
          key: string
          last_used?: string | null
          learned_at?: string
          source?: string
          user_id: string
          value: string
        }
        Update: {
          category?: string
          character_id?: string
          confidence?: number
          id?: string
          key?: string
          last_used?: string | null
          learned_at?: string
          source?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_facts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_facts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feeds: {
        Row: {
          character_id: string
          content: string
          created_at: string
          entry_type: string
          id: string
          is_read: boolean
          user_id: string
        }
        Insert: {
          character_id: string
          content: string
          created_at?: string
          entry_type?: string
          id?: string
          is_read?: boolean
          user_id: string
        }
        Update: {
          character_id?: string
          content?: string
          created_at?: string
          entry_type?: string
          id?: string
          is_read?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feeds_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      user_habits: {
        Row: {
          character_id: string
          created_at: string
          cue: string
          id: string
          last_fired_turn: number
          response: string
          strength: number
          times_fired: number
          times_rewarded: number
          updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          cue: string
          id?: string
          last_fired_turn?: number
          response: string
          strength: number
          times_fired?: number
          times_rewarded?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          cue?: string
          id?: string
          last_fired_turn?: number
          response?: string
          strength?: number
          times_fired?: number
          times_rewarded?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_habits_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_habits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_insecurities: {
        Row: {
          character_id: string
          first_detected_at: string
          id: string
          label: string
          last_reinforced_at: string
          reinforced_count: number
          user_id: string
        }
        Insert: {
          character_id: string
          first_detected_at?: string
          id?: string
          label: string
          last_reinforced_at?: string
          reinforced_count?: number
          user_id: string
        }
        Update: {
          character_id?: string
          first_detected_at?: string
          id?: string
          label?: string
          last_reinforced_at?: string
          reinforced_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_insecurities_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_insecurities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_journey_state: {
        Row: {
          created_at: string
          last_advanced_at: string | null
          last_computed_at: string
          stage: number
          unlocked_features: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          last_advanced_at?: string | null
          last_computed_at?: string
          stage?: number
          unlocked_features?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          last_advanced_at?: string | null
          last_computed_at?: string
          stage?: number
          unlocked_features?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_journey_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_promises: {
        Row: {
          character_id: string
          created_at: string
          due_at: string
          id: string
          promise_text: string
          raw_message: string
          surfaced: boolean
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          due_at: string
          id?: string
          promise_text: string
          raw_message: string
          surfaced?: boolean
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          due_at?: string
          id?: string
          promise_text?: string
          raw_message?: string
          surfaced?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_promises_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_promises_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          category: string
          character_id: string | null
          community_post_id: string | null
          community_reply_id: string | null
          conversation_id: string | null
          created_at: string
          detail: string | null
          id: string
          match_id: string | null
          message_snippet: string | null
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          category: string
          character_id?: string | null
          community_post_id?: string | null
          community_reply_id?: string | null
          conversation_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          match_id?: string | null
          message_snippet?: string | null
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          category?: string
          character_id?: string | null
          community_post_id?: string | null
          community_reply_id?: string | null
          conversation_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          match_id?: string | null
          message_snippet?: string | null
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_community_post_id_fkey"
            columns: ["community_post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_community_reply_id_fkey"
            columns: ["community_reply_id"]
            isOneToOne: false
            referencedRelation: "community_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_streaks: {
        Row: {
          created_at: string
          current_streak: number
          id: string
          last_active_date: string | null
          last_checkin: string | null
          longest_streak: number
          streak_shield: boolean
          total_days: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          current_streak?: number
          id?: string
          last_active_date?: string | null
          last_checkin?: string | null
          longest_streak?: number
          streak_shield?: boolean
          total_days?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          current_streak?: number
          id?: string
          last_active_date?: string | null
          last_checkin?: string | null
          longest_streak?: number
          streak_shield?: boolean
          total_days?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_streaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_unlockables: {
        Row: {
          created_at: string
          id: string
          source: string
          unlock_key: string
          unlock_type: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source?: string
          unlock_key: string
          unlock_type: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source?: string
          unlock_key?: string
          unlock_type?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_unlockables_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_wisdom: {
        Row: {
          character_id: string
          confidence: number
          created_at: string
          derived_from_lesson_ids: string[]
          domain: string
          id: string
          last_applied_turn: number
          principle: string
          times_applied: number
          updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          confidence: number
          created_at?: string
          derived_from_lesson_ids?: string[]
          domain: string
          id?: string
          last_applied_turn?: number
          principle: string
          times_applied?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          confidence?: number
          created_at?: string
          derived_from_lesson_ids?: string[]
          domain?: string
          id?: string
          last_applied_turn?: number
          principle?: string
          times_applied?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_wisdom_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_wisdom_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_world_choice_votes: {
        Row: {
          choice_id: string
          created_at: string
          id: string
          option: string
          user_id: string
        }
        Insert: {
          choice_id: string
          created_at?: string
          id?: string
          option: string
          user_id: string
        }
        Update: {
          choice_id?: string
          created_at?: string
          id?: string
          option?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_world_choice_votes_choice_id_fkey"
            columns: ["choice_id"]
            isOneToOne: false
            referencedRelation: "daily_world_choices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_world_choice_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_xp: {
        Row: {
          created_at: string
          id: string
          level: number
          leveled_up: boolean
          total_xp: number
          updated_at: string
          user_id: string
          xp_to_next: number
        }
        Insert: {
          created_at?: string
          id?: string
          level?: number
          leveled_up?: boolean
          total_xp?: number
          updated_at?: string
          user_id: string
          xp_to_next?: number
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          leveled_up?: boolean
          total_xp?: number
          updated_at?: string
          user_id?: string
          xp_to_next?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_xp_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_fingerprints: {
        Row: {
          character_id: string
          created_at: string
          fingerprint: Json
          id: string
          interactions: number
          last_updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          fingerprint?: Json
          id?: string
          interactions?: number
          last_updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          fingerprint?: Json
          id?: string
          interactions?: number
          last_updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_fingerprints_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_fingerprints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          confirmed: boolean
          created_at: string
          email: string
          id: number
          ip_hash: string | null
          referrer: string | null
          source: string
          user_agent: string | null
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          email: string
          id?: number
          ip_hash?: string | null
          referrer?: string | null
          source?: string
          user_agent?: string | null
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          email?: string
          id?: number
          ip_hash?: string | null
          referrer?: string | null
          source?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      worker_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          jobs_processed: number
          meta: Json | null
          status: string
          worker_name: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          jobs_processed?: number
          meta?: Json | null
          status?: string
          worker_name: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          jobs_processed?: number
          meta?: Json | null
          status?: string
          worker_name?: string
        }
        Relationships: []
      }
      world_events: {
        Row: {
          created_at: string
          description: string
          emotional_weight: number
          event_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          location_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description: string
          emotional_weight?: number
          event_type: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string
          emotional_weight?: number
          event_type?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      world_impact_events: {
        Row: {
          character_id: string
          created_at: string
          description: string
          desire_axis: string | null
          id: string
          memory_id: string | null
          public_summary: string
          source: string
          title: string
          user_id: string
          weight: number
        }
        Insert: {
          character_id: string
          created_at?: string
          description: string
          desire_axis?: string | null
          id?: string
          memory_id?: string | null
          public_summary?: string
          source: string
          title: string
          user_id: string
          weight?: number
        }
        Update: {
          character_id?: string
          created_at?: string
          description?: string
          desire_axis?: string | null
          id?: string
          memory_id?: string | null
          public_summary?: string
          source?: string
          title?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "world_impact_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_impact_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      world_locations: {
        Row: {
          archetype: string
          created_at: string
          culture: string
          description: string
          emblem_description: string | null
          government_type: string
          id: string
          image_generated_at: string | null
          image_url: string | null
          is_capital: boolean
          name: string
          parent_location_id: string | null
          population: number
          seal_motto: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          archetype?: string
          created_at?: string
          culture?: string
          description?: string
          emblem_description?: string | null
          government_type?: string
          id?: string
          image_generated_at?: string | null
          image_url?: string | null
          is_capital?: boolean
          name: string
          parent_location_id?: string | null
          population?: number
          seal_motto?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          archetype?: string
          created_at?: string
          culture?: string
          description?: string
          emblem_description?: string | null
          government_type?: string
          id?: string
          image_generated_at?: string | null
          image_url?: string | null
          is_capital?: boolean
          name?: string
          parent_location_id?: string | null
          population?: number
          seal_motto?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "world_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      world_stories: {
        Row: {
          chapter: number
          description: string
          id: string
          participants: string[]
          started_at: string
          status: string
          story_key: string | null
          title: string
          updated_at: string
        }
        Insert: {
          chapter?: number
          description: string
          id?: string
          participants?: string[]
          started_at?: string
          status?: string
          story_key?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          chapter?: number
          description?: string
          id?: string
          participants?: string[]
          started_at?: string
          status?: string
          story_key?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      xp_events: {
        Row: {
          amount: number
          created_at: string
          id: string
          metadata: Json | null
          source: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          metadata?: Json | null
          source: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xp_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      company_roster: {
        Row: {
          character_id: string | null
          character_name: string | null
          company_id: string | null
          is_founder: boolean | null
          salary: number | null
          started_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companion_occupations_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_occupations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_world_choice_tallies: {
        Row: {
          choice_id: string | null
          votes_a: number | null
          votes_b: number | null
          votes_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_world_choice_votes_choice_id_fkey"
            columns: ["choice_id"]
            isOneToOne: false
            referencedRelation: "daily_world_choices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_character_creation: {
        Args: { p_character_id: string; p_user_id: string }
        Returns: boolean
      }
      activate_trial: {
        Args: {
          p_stripe_customer_id?: string
          p_stripe_sub_id?: string
          p_user_id: string
        }
        Returns: string
      }
      add_tokens: {
        Args: {
          p_amount: number
          p_reason?: string
          p_reference_id?: string
          p_user_id: string
        }
        Returns: undefined
      }
      adjust_character_attribute: {
        Args: { p_character_id: string; p_delta: number; p_field: string }
        Returns: undefined
      }
      adjust_net_worth: {
        Args: { p_character_id: string; p_delta: number }
        Returns: undefined
      }
      admin_abuse_signal_trend: {
        Args: { p_days?: number }
        Returns: {
          confirmed_bot: number
          day: string
          signals: number
        }[]
      }
      admin_activity_series: {
        Args: { p_days?: number }
        Returns: {
          dau: number
          day: string
          new_signups: number
        }[]
      }
      admin_churn_trend: {
        Args: { p_days?: number }
        Returns: {
          cancellations: number
          day: string
        }[]
      }
      admin_content_pipeline_summary: {
        Args: never
        Returns: {
          images_generated_24h: number
          live_characters: number
          pending_characters: number
          pending_content_queue: number
          pending_lora_jobs: number
        }[]
      }
      admin_crisis_event_summary: {
        Args: { p_days?: number }
        Returns: {
          category: string
          count: number
          followed_up: number
        }[]
      }
      admin_dating_funnel_series: {
        Args: { p_days?: number }
        Returns: {
          day: string
          gifts: number
          matches: number
          swipes: number
        }[]
      }
      admin_engagement_summary: {
        Args: { p_days?: number }
        Returns: {
          avg_messages_per_convo: number
          community_posts: number
          community_replies: number
          dating_gifts: number
          dating_matches: number
          dating_mode_conversations: number
          dating_swipes: number
          digital_twin_messages: number
          images_generated: number
          roleplay_mode_conversations: number
          roleplay_sessions_completed: number
          roleplay_sessions_started: number
          total_conversations: number
          total_messages: number
          xp_events: number
        }[]
      }
      admin_feature_adoption: {
        Args: { p_days?: number }
        Returns: {
          chat_users: number
          community_users: number
          dating_users: number
          roleplay_users: number
          twin_users: number
        }[]
      }
      admin_gamification_summary: {
        Args: never
        Returns: {
          active_streaks: number
          avg_streak_length: number
          longest_streak: number
          xp_events_today: number
        }[]
      }
      admin_geo_breakdown: {
        Args: { p_limit?: number }
        Returns: {
          country: string
          users: number
        }[]
      }
      admin_message_volume_series: {
        Args: { p_days?: number }
        Returns: {
          conversations_started: number
          day: string
          messages: number
        }[]
      }
      admin_mrr_snapshot: {
        Args: never
        Returns: {
          active_subs_other: number
          active_subs_usd: number
          cancelled_30d: number
          mrr_usd: number
        }[]
      }
      admin_referral_funnel_summary: {
        Args: { p_days?: number }
        Returns: {
          clicks: number
          conversions: number
          fraud_flagged: number
          payouts_pending_ngn: number
          payouts_sent_ngn: number
        }[]
      }
      admin_report_category_breakdown: {
        Args: { p_days?: number }
        Returns: {
          category: string
          count: number
        }[]
      }
      admin_retention_cohorts: {
        Args: { p_weeks?: number }
        Returns: {
          cohort_size: number
          cohort_week: string
          week_0: number
          week_1: number
          week_2: number
          week_3: number
        }[]
      }
      admin_revenue_series: {
        Args: { p_days?: number }
        Returns: {
          day: string
          new_subs: number
          revenue_usd: number
        }[]
      }
      admin_tier_breakdown: {
        Args: never
        Returns: {
          tier: string
          users: number
        }[]
      }
      admin_top_characters: {
        Args: { p_limit?: number }
        Returns: {
          character_id: string
          conversations: number
          likes: number
          messages: number
          name: string
        }[]
      }
      admin_top_community_posts: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          caption: string
          character_id: string
          character_name: string
          created_at: string
          likes_count: number
          post_id: string
        }[]
      }
      admin_wau_mau: {
        Args: never
        Returns: {
          mau: number
          wau: number
        }[]
      }
      append_character_private_media: {
        Args: { p_character_id: string; p_column: string; p_url: string }
        Returns: string[]
      }
      apply_personality_drift: {
        Args: {
          p_character_id: string
          p_confidence: number
          p_openness: number
          p_user_id: string
          p_warmth: number
        }
        Returns: undefined
      }
      can_send_message: { Args: { p_user_id: string }; Returns: Json }
      chat_affinity_tags: {
        Args: { p_half_life_days?: number; p_user_id: string }
        Returns: {
          tag: string
          weight: number
        }[]
      }
      check_and_update_streak: {
        Args: { p_user_id: string }
        Returns: {
          broken: boolean
          longest: number
          new_day: boolean
          streak: number
        }[]
      }
      claim_daily_login_reward: { Args: { p_user_id: string }; Returns: Json }
      collaborative_filter_scores: {
        Args: {
          p_neighbor_limit?: number
          p_result_limit?: number
          p_user_id: string
        }
        Returns: {
          character_id: string
          score: number
        }[]
      }
      complete_date_session: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: number
      }
      consume_streak_shield: {
        Args: { p_restore_streak?: number; p_user_id: string }
        Returns: {
          consumed: boolean
          restored_streak: number
        }[]
      }
      create_character_transactional: {
        Args: { p_character: Json; p_cost: number; p_user_id: string }
        Returns: {
          character_id: string
          remaining_tokens: number
        }[]
      }
      credit_subscription_tokens: {
        Args: {
          p_amount: number
          p_reason?: string
          p_reference_id?: string
          p_user_id: string
        }
        Returns: undefined
      }
      daily_reset_message_counts: { Args: never; Returns: undefined }
      debit_subscription_tokens: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
      decrement_community_reply_count: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      deduct_tokens: {
        Args: {
          p_amount: number
          p_reason?: string
          p_reference_id?: string
          p_user_id: string
        }
        Returns: number
      }
      execute_subscription_revocation: {
        Args: { p_flag_id: string }
        Returns: {
          out_provider: string
          out_reason: string
          out_user_id: string
          outcome: string
          previous_tier: string
        }[]
      }
      expire_subscriptions: { Args: never; Returns: Json }
      expire_trials: { Args: never; Returns: number }
      fail_character_creation: {
        Args: { p_character_id: string; p_user_id: string }
        Returns: number
      }
      find_heavy_conversations: {
        Args: { threshold?: number }
        Returns: {
          id: string
          message_count: number
        }[]
      }
      get_character_biography: {
        Args: { p_character_id: string; p_limit?: number }
        Returns: {
          description: string
          occurred_at: string
          source: string
        }[]
      }
      get_journey_signals: {
        Args: { p_user_id: string }
        Returns: {
          companion_customized_count: number
          content_published_count: number
          creator_followed_count: number
          distinct_active_days: number
          location_created_count: number
          lore_created_count: number
          meaningful_message_count: number
          memory_demonstrated_count: number
          session_return_count: number
          world_reference_shown_count: number
          world_reference_tapped_count: number
        }[]
      }
      get_or_create_daily_quests: {
        Args: { p_date: string; p_default_quests: Json; p_user_id: string }
        Returns: {
          bonus_claimed: boolean
          completed_count: number
          created_at: string
          date: string
          id: string
          quests: Json
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_quests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_referral_leaderboard: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          display_name: string
          total_referrals: number
          total_tokens_earned: number
          user_id: string
          username: string
        }[]
      }
      get_referral_user_totals: {
        Args: { p_user_id: string }
        Returns: {
          total_referrals: number
          total_tokens_earned: number
        }[]
      }
      get_user_verified_age: { Args: { p_user_id: string }; Returns: number }
      get_world_timeline: {
        Args: { p_limit?: number; p_location_id?: string }
        Returns: {
          description: string
          event_type: string
          location_id: string
          occurred_at: string
          significance: number
          source: string
          title: string
        }[]
      }
      increment: {
        Args: {
          field_name: string
          row_id: string
          table_name: string
          x: number
        }
        Returns: number
      }
      increment_ad_stat: {
        Args: { p_ad_id: string; p_column: string }
        Returns: undefined
      }
      increment_community_reply_count: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      increment_conversation_count: {
        Args: { p_match_id: string }
        Returns: number
      }
      increment_daily_messages: { Args: { p_user_id: string }; Returns: number }
      increment_thread_raised: {
        Args: { p_thread_id: string }
        Returns: undefined
      }
      increment_xp: {
        Args: { p_amount: number; p_source: string; p_user_id: string }
        Returns: undefined
      }
      is_admin: { Args: { p_uid?: string }; Returns: boolean }
      is_user_age_verified: { Args: { p_user_id: string }; Returns: boolean }
      mark_all_notifications_read: {
        Args: { p_user_id: string }
        Returns: number
      }
      mark_character_status_viewed: {
        Args: { p_character_id: string; p_user_id: string }
        Returns: string
      }
      match_characters: {
        Args: {
          p_allow_nsfw?: boolean
          p_category?: string
          p_gender?: string
          p_match_count?: number
          p_max_distance?: number
          p_query_embedding: string
        }
        Returns: {
          category: string
          description: string
          follower_count: number
          gender: string
          id: string
          image_url: string
          is_nsfw: boolean
          like_count: number
          name: string
          personality: string
          similarity: number
          tags: string[]
        }[]
      }
      match_memory_graph: {
        Args: {
          p_character_id: string
          p_match_count?: number
          p_max_distance?: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          description: string
          emotional_weight: number
          event_type: string
          id: string
          similarity: number
          tags: string[]
          title: string
        }[]
      }
      nudge_desire_fulfillment: {
        Args: {
          p_character_id: string
          p_fear_delta?: number
          p_need_delta?: number
          p_obsession_delta?: number
          p_user_id: string
          p_want_delta?: number
        }
        Returns: {
          character_id: string
          fear_activation: number
          need_fulfillment: number
          obsession_engagement: number
          updated_at: string
          user_id: string
          want_fulfillment: number
        }
        SetofOptions: {
          from: "*"
          to: "character_desire_fulfillment"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      progress_daily_quest: {
        Args: {
          p_amount?: number
          p_date: string
          p_quest_type: string
          p_user_id: string
        }
        Returns: {
          bonus_earned: number
          completed_quest_id: string
          quests: Json
          xp_earned: number
        }[]
      }
      prune_old_messages: {
        Args: { p_conversation_id: string; p_keep?: number }
        Returns: undefined
      }
      purge_old_webhooks: { Args: never; Returns: number }
      purge_user_data_remediate: {
        Args: { p_user_id: string }
        Returns: {
          deleted_count: number
          table_name: string
        }[]
      }
      reap_stuck_character_creations: {
        Args: { p_older_than_minutes?: number }
        Returns: number
      }
      record_bg_task_outcomes: {
        Args: { p_outcomes: Json; p_user_id?: string }
        Returns: undefined
      }
      record_character_click: {
        Args: { p_character_id: string }
        Returns: undefined
      }
      record_universe_memory: {
        Args: {
          p_description: string
          p_legendary?: boolean
          p_location_id?: string
          p_participants?: string[]
          p_title: string
          p_type: string
          p_weight?: number
        }
        Returns: string
      }
      referral_tier: { Args: { p_count: number }; Returns: string }
      referral_tokens_for_count: { Args: { p_count: number }; Returns: number }
      refund_tokens: {
        Args: {
          p_amount: number
          p_reason?: string
          p_reference_id?: string
          p_user_id: string
        }
        Returns: number
      }
      remove_character_private_media: {
        Args: { p_character_id: string; p_column: string; p_url: string }
        Returns: string[]
      }
      reset_daily_counters: { Args: never; Returns: undefined }
      reset_daily_messages: { Args: never; Returns: undefined }
      restore_disputed_subscription: {
        Args: { p_subscription_id: string }
        Returns: boolean
      }
      send_gift: {
        Args: {
          p_bond_bonus: number
          p_char_id: string
          p_gift_name: string
          p_gift_type: string
          p_match_id: string
          p_message?: string
          p_token_cost: number
          p_user_id: string
        }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      spend_tokens: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
      start_date_session: {
        Args: {
          p_bond_bonus: number
          p_char_id: string
          p_conversation_id?: string
          p_date_type: string
          p_match_id: string
          p_opening_scene: string
          p_token_cost: number
          p_user_id: string
        }
        Returns: string
      }
      toggle_character_follow: {
        Args: { p_character_id: string; p_user_id: string }
        Returns: Json
      }
      toggle_character_like: {
        Args: { p_character_id: string; p_user_id: string }
        Returns: Json
      }
      toggle_community_post_like: {
        Args: { p_post_id: string; p_user_id: string }
        Returns: Json
      }
      toggle_community_reply_like: {
        Args: { p_reply_id: string; p_user_id: string }
        Returns: Json
      }
      toggle_post_like: {
        Args: { p_post_id: string; p_user_id: string }
        Returns: Json
      }
      toggle_scenario_vote: {
        Args: { p_scenario_id: string; p_user_id: string; p_vote_type: string }
        Returns: Json
      }
      trending_character_ids: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: {
          character_id: string
          click_count: number
        }[]
      }
      update_bond_score: {
        Args: { p_delta: number; p_match_id: string }
        Returns: number
      }
      update_dating_streak: { Args: { p_match_id: string }; Returns: number }
      update_psychology: {
        Args: { p_character_id: string; p_event: string; p_user_id: string }
        Returns: undefined
      }
      verify_user_data_purged: {
        Args: { p_user_id: string }
        Returns: {
          remaining_count: number
          table_name: string
        }[]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
