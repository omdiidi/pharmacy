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
      audit_log: {
        Row: {
          action: string
          actor: string
          created_at: string | null
          id: string
          params: Json | null
          pharmacy_id: string
          result: Json | null
          target_entity_id: string | null
          target_entity_type: string | null
          undo_window_expires_at: string | null
          undone_at: string | null
        }
        Insert: {
          action: string
          actor: string
          created_at?: string | null
          id?: string
          params?: Json | null
          pharmacy_id: string
          result?: Json | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          undo_window_expires_at?: string | null
          undone_at?: string | null
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string | null
          id?: string
          params?: Json | null
          pharmacy_id?: string
          result?: Json | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          undo_window_expires_at?: string | null
          undone_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_log: {
        Row: {
          created_at: string | null
          filename: string
          id: number
          sha256: string
          size_bytes: number
        }
        Insert: {
          created_at?: string | null
          filename: string
          id?: number
          sha256: string
          size_bytes: number
        }
        Update: {
          created_at?: string | null
          filename?: string
          id?: number
          sha256?: string
          size_bytes?: number
        }
        Relationships: []
      }
      brand_authorization: {
        Row: {
          brand: string
          created_at: string | null
          id: string
          last_incident_at: string | null
          loa_document_url: string | null
          loa_expires_at: string | null
          notes: string | null
          paused_until: string | null
          pharmacy_id: string | null
          prior_status: Database["public"]["Enums"]["brand_auth_status"] | null
          status: Database["public"]["Enums"]["brand_auth_status"]
          updated_at: string | null
        }
        Insert: {
          brand: string
          created_at?: string | null
          id?: string
          last_incident_at?: string | null
          loa_document_url?: string | null
          loa_expires_at?: string | null
          notes?: string | null
          paused_until?: string | null
          pharmacy_id?: string | null
          prior_status?: Database["public"]["Enums"]["brand_auth_status"] | null
          status?: Database["public"]["Enums"]["brand_auth_status"]
          updated_at?: string | null
        }
        Update: {
          brand?: string
          created_at?: string | null
          id?: string
          last_incident_at?: string | null
          loa_document_url?: string | null
          loa_expires_at?: string | null
          notes?: string | null
          paused_until?: string | null
          pharmacy_id?: string | null
          prior_status?: Database["public"]["Enums"]["brand_auth_status"] | null
          status?: Database["public"]["Enums"]["brand_auth_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_authorization_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      briefings: {
        Row: {
          briefing_type: Database["public"]["Enums"]["briefing_type"]
          confidence: number | null
          created_at: string | null
          data_snapshot: Json | null
          id: string
          pharmacy_id: string
          proposed_actions: Json | null
          rationale: string | null
          reasoning_trail: Json | null
          related_entity_id: string | null
          related_entity_type: string | null
          source_agent: string
          source_job_id: string | null
          summary: string
          title: string
          urgency: number | null
        }
        Insert: {
          briefing_type: Database["public"]["Enums"]["briefing_type"]
          confidence?: number | null
          created_at?: string | null
          data_snapshot?: Json | null
          id?: string
          pharmacy_id: string
          proposed_actions?: Json | null
          rationale?: string | null
          reasoning_trail?: Json | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          source_agent: string
          source_job_id?: string | null
          summary: string
          title: string
          urgency?: number | null
        }
        Update: {
          briefing_type?: Database["public"]["Enums"]["briefing_type"]
          confidence?: number | null
          created_at?: string | null
          data_snapshot?: Json | null
          id?: string
          pharmacy_id?: string
          proposed_actions?: Json | null
          rationale?: string | null
          reasoning_trail?: Json | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          source_agent?: string
          source_job_id?: string | null
          summary?: string
          title?: string
          urgency?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "briefings_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      claude_usage: {
        Row: {
          cache_creation_tokens: number | null
          cache_read_tokens: number | null
          created_at: string | null
          estimated_cost_usd: number
          id: number
          input_tokens: number
          model: string
          output_tokens: number
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          cache_creation_tokens?: number | null
          cache_read_tokens?: number | null
          created_at?: string | null
          estimated_cost_usd?: number
          id?: number
          input_tokens?: number
          model: string
          output_tokens?: number
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          cache_creation_tokens?: number | null
          cache_read_tokens?: number | null
          created_at?: string | null
          estimated_cost_usd?: number
          id?: number
          input_tokens?: number
          model?: string
          output_tokens?: number
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      health_metrics: {
        Row: {
          captured_at: string | null
          id: number
          metric: string
          pharmacy_id: string | null
          platform: string
          value: number | null
        }
        Insert: {
          captured_at?: string | null
          id?: number
          metric: string
          pharmacy_id?: string | null
          platform: string
          value?: number | null
        }
        Update: {
          captured_at?: string | null
          id?: number
          metric?: string
          pharmacy_id?: string | null
          platform?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "health_metrics_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_items: {
        Row: {
          acted_at: string | null
          action_params: Json | null
          action_taken: string | null
          briefing_id: string
          created_at: string | null
          dismissed_reason: string | null
          id: string
          pharmacy_id: string
          seen_at: string | null
          state: Database["public"]["Enums"]["inbox_state"]
        }
        Insert: {
          acted_at?: string | null
          action_params?: Json | null
          action_taken?: string | null
          briefing_id: string
          created_at?: string | null
          dismissed_reason?: string | null
          id?: string
          pharmacy_id: string
          seen_at?: string | null
          state?: Database["public"]["Enums"]["inbox_state"]
        }
        Update: {
          acted_at?: string | null
          action_params?: Json | null
          action_taken?: string | null
          briefing_id?: string
          created_at?: string | null
          dismissed_reason?: string | null
          id?: string
          pharmacy_id?: string
          seen_at?: string | null
          state?: Database["public"]["Enums"]["inbox_state"]
        }
        Relationships: [
          {
            foreignKeyName: "inbox_items_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempt_count: number
          caller_log_url: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          expires_at: string | null
          final_transcript_bundle_id: string | null
          id: string
          job_type: string
          max_attempts: number | null
          mcp_bundle_id: string | null
          payload: Json
          priority: number
          progress: Json | null
          requested_status: string | null
          requires: Json
          result: Json | null
          started_at: string | null
          status: string
          submitted_by: string | null
          worker_id: string | null
          worker_version: string | null
        }
        Insert: {
          attempt_count?: number
          caller_log_url?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          final_transcript_bundle_id?: string | null
          id?: string
          job_type: string
          max_attempts?: number | null
          mcp_bundle_id?: string | null
          payload?: Json
          priority?: number
          progress?: Json | null
          requested_status?: string | null
          requires?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          submitted_by?: string | null
          worker_id?: string | null
          worker_version?: string | null
        }
        Update: {
          attempt_count?: number
          caller_log_url?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          final_transcript_bundle_id?: string | null
          id?: string
          job_type?: string
          max_attempts?: number | null
          mcp_bundle_id?: string | null
          payload?: Json
          priority?: number
          progress?: Json | null
          requested_status?: string | null
          requires?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          submitted_by?: string | null
          worker_id?: string | null
          worker_version?: string | null
        }
        Relationships: []
      }
      listings: {
        Row: {
          buybox_status: string | null
          created_at: string | null
          current_price: number | null
          current_source_cost: number | null
          current_source_supplier: string | null
          id: string
          pharmacy_id: string | null
          platform: string
          platform_listing_id: string | null
          product_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          buybox_status?: string | null
          created_at?: string | null
          current_price?: number | null
          current_source_cost?: number | null
          current_source_supplier?: string | null
          id?: string
          pharmacy_id?: string | null
          platform: string
          platform_listing_id?: string | null
          product_id?: string | null
          status: string
          updated_at?: string | null
        }
        Update: {
          buybox_status?: string | null
          created_at?: string | null
          current_price?: number | null
          current_source_cost?: number | null
          current_source_supplier?: string | null
          id?: string
          pharmacy_id?: string | null
          platform?: string
          platform_listing_id?: string | null
          product_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      memory: {
        Row: {
          content: string
          created_at: string | null
          embedding: string | null
          embedding_model: string | null
          id: string
          importance: number | null
          kind: Database["public"]["Enums"]["memory_kind"]
          last_retrieved_at: string | null
          metadata: Json | null
          pharmacy_id: string
          related_entity_id: string | null
          related_entity_type: string | null
          retrieval_count: number | null
          source: string
        }
        Insert: {
          content: string
          created_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          importance?: number | null
          kind: Database["public"]["Enums"]["memory_kind"]
          last_retrieved_at?: string | null
          metadata?: Json | null
          pharmacy_id: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          retrieval_count?: number | null
          source: string
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          importance?: number | null
          kind?: Database["public"]["Enums"]["memory_kind"]
          last_retrieved_at?: string | null
          metadata?: Json | null
          pharmacy_id?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          retrieval_count?: number | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          customer_address: Json | null
          fulfilled_at: string | null
          id: string
          listing_id: string | null
          net_profit: number | null
          pharmacy_id: string | null
          platform: string
          platform_fees: number | null
          platform_order_id: string
          shipping_cost: number | null
          sold_at: string | null
          sold_price: number | null
          status: string
          supplier_cost: number | null
          supplier_source: string | null
          tracking_number: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_address?: Json | null
          fulfilled_at?: string | null
          id?: string
          listing_id?: string | null
          net_profit?: number | null
          pharmacy_id?: string | null
          platform: string
          platform_fees?: number | null
          platform_order_id: string
          shipping_cost?: number | null
          sold_at?: string | null
          sold_price?: number | null
          status: string
          supplier_cost?: number | null
          supplier_source?: string | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_address?: Json | null
          fulfilled_at?: string | null
          id?: string
          listing_id?: string | null
          net_profit?: number | null
          pharmacy_id?: string | null
          platform?: string
          platform_fees?: number | null
          platform_order_id?: string
          shipping_cost?: number | null
          sold_at?: string | null
          sold_price?: number | null
          status?: string
          supplier_cost?: number | null
          supplier_source?: string | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_customer_messages: {
        Row: {
          amazon_order_id: string | null
          audit_log_id: string | null
          cancelled_at: string | null
          channel: string
          classification: string
          created_at: string
          customer_message_id: string | null
          id: string
          pharmacy_id: string
          proposed_text: string
          reasoning: string | null
          sent_at: string | null
          sp_api_message_id: string | null
          status: string
        }
        Insert: {
          amazon_order_id?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          channel?: string
          classification: string
          created_at?: string
          customer_message_id?: string | null
          id?: string
          pharmacy_id: string
          proposed_text: string
          reasoning?: string | null
          sent_at?: string | null
          sp_api_message_id?: string | null
          status?: string
        }
        Update: {
          amazon_order_id?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          channel?: string
          classification?: string
          created_at?: string
          customer_message_id?: string | null
          id?: string
          pharmacy_id?: string
          proposed_text?: string
          reasoning?: string | null
          sent_at?: string | null
          sp_api_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_customer_messages_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_customer_messages_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_health_actions: {
        Row: {
          action_kind: string
          applied_at: string | null
          audit_log_id: string | null
          cancelled_at: string | null
          created_at: string
          id: string
          listing_id: string | null
          pharmacy_id: string
          reasoning: string | null
          sp_api_submission_id: string | null
          status: string
          triggered_by: string
        }
        Insert: {
          action_kind: string
          applied_at?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          pharmacy_id: string
          reasoning?: string | null
          sp_api_submission_id?: string | null
          status?: string
          triggered_by: string
        }
        Update: {
          action_kind?: string
          applied_at?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          pharmacy_id?: string
          reasoning?: string | null
          sp_api_submission_id?: string | null
          status?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_health_actions_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_health_actions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_health_actions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_listings: {
        Row: {
          audit_log_id: string | null
          cancelled_at: string | null
          created_at: string
          id: string
          pharmacy_id: string
          product_id: string
          proposed_bullets: Json
          proposed_price: number
          proposed_title: string
          published_at: string | null
          reasoning: string | null
          sp_api_feed_id: string | null
          status: string
        }
        Insert: {
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          pharmacy_id: string
          product_id: string
          proposed_bullets: Json
          proposed_price: number
          proposed_title: string
          published_at?: string | null
          reasoning?: string | null
          sp_api_feed_id?: string | null
          status?: string
        }
        Update: {
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          pharmacy_id?: string
          product_id?: string
          proposed_bullets?: Json
          proposed_price?: number
          proposed_title?: string
          published_at?: string | null
          reasoning?: string | null
          sp_api_feed_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_listings_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_listings_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_pricing_changes: {
        Row: {
          applied_at: string | null
          audit_log_id: string | null
          cancelled_at: string | null
          created_at: string
          decision: string
          from_price: number | null
          id: string
          listing_id: string
          pharmacy_id: string
          reasoning: string | null
          sp_api_submission_id: string | null
          status: string
          to_price: number | null
          trigger: string
        }
        Insert: {
          applied_at?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          decision: string
          from_price?: number | null
          id?: string
          listing_id: string
          pharmacy_id: string
          reasoning?: string | null
          sp_api_submission_id?: string | null
          status?: string
          to_price?: number | null
          trigger: string
        }
        Update: {
          applied_at?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          decision?: string
          from_price?: number | null
          id?: string
          listing_id?: string
          pharmacy_id?: string
          reasoning?: string | null
          sp_api_submission_id?: string | null
          status?: string
          to_price?: number | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_pricing_changes_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_pricing_changes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_pricing_changes_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_purchase_orders: {
        Row: {
          applied_at: string | null
          audit_log_id: string | null
          cancelled_at: string | null
          created_at: string
          edi_850_envelope_id: string | null
          edi_855_acknowledgment_id: string | null
          id: string
          order_id: string | null
          pharmacy_id: string
          product_id: string | null
          proposed_eta: string | null
          proposed_quantity: number
          proposed_unit_price: number
          reasoning: string | null
          status: string
          wholesaler: string
        }
        Insert: {
          applied_at?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          edi_850_envelope_id?: string | null
          edi_855_acknowledgment_id?: string | null
          id?: string
          order_id?: string | null
          pharmacy_id: string
          product_id?: string | null
          proposed_eta?: string | null
          proposed_quantity: number
          proposed_unit_price: number
          reasoning?: string | null
          status?: string
          wholesaler: string
        }
        Update: {
          applied_at?: string | null
          audit_log_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          edi_850_envelope_id?: string | null
          edi_855_acknowledgment_id?: string | null
          id?: string
          order_id?: string | null
          pharmacy_id?: string
          product_id?: string | null
          proposed_eta?: string | null
          proposed_quantity?: number
          proposed_unit_price?: number
          reasoning?: string | null
          status?: string
          wholesaler?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_purchase_orders_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_purchase_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_purchase_orders_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_purchase_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacies: {
        Row: {
          address: Json | null
          created_at: string | null
          dea_number: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          address?: Json | null
          created_at?: string | null
          dea_number?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          address?: Json | null
          created_at?: string | null
          dea_number?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      policy_rules: {
        Row: {
          active: boolean
          created_at: string | null
          effective_at: string | null
          id: string
          notes: string | null
          pattern: string
          reason: string
          rule_kind: string
          tier: number
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          effective_at?: string | null
          id?: string
          notes?: string | null
          pattern: string
          reason: string
          rule_kind: string
          tier: number
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string | null
          effective_at?: string | null
          id?: string
          notes?: string | null
          pattern?: string
          reason?: string
          rule_kind?: string
          tier?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          asin: string | null
          blocked_reason: string | null
          brand: string | null
          category: string | null
          created_at: string | null
          default_supplier: string | null
          form: string | null
          id: string
          last_listed_at: string | null
          last_listed_price: number | null
          metadata: Json | null
          name: string
          ndc: string | null
          pack_size: string | null
          pharmacy_id: string
          upc: string | null
          updated_at: string | null
          watchlist_status: string | null
        }
        Insert: {
          asin?: string | null
          blocked_reason?: string | null
          brand?: string | null
          category?: string | null
          created_at?: string | null
          default_supplier?: string | null
          form?: string | null
          id?: string
          last_listed_at?: string | null
          last_listed_price?: number | null
          metadata?: Json | null
          name: string
          ndc?: string | null
          pack_size?: string | null
          pharmacy_id: string
          upc?: string | null
          updated_at?: string | null
          watchlist_status?: string | null
        }
        Update: {
          asin?: string | null
          blocked_reason?: string | null
          brand?: string | null
          category?: string | null
          created_at?: string | null
          default_supplier?: string | null
          form?: string | null
          id?: string
          last_listed_at?: string | null
          last_listed_price?: number | null
          metadata?: Json | null
          name?: string
          ndc?: string | null
          pack_size?: string | null
          pharmacy_id?: string
          upc?: string | null
          updated_at?: string | null
          watchlist_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          captured_at: string | null
          id: number
          product_id: string | null
          signal_type: string
          source: string
          value_json: Json | null
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          captured_at?: string | null
          id?: number
          product_id?: string | null
          signal_type: string
          source: string
          value_json?: Json | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          captured_at?: string | null
          id?: number
          product_id?: string | null
          signal_type?: string
          source?: string
          value_json?: Json | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      tic_certifications: {
        Row: {
          brand: string
          cert_document_url: string | null
          created_at: string | null
          expires_at: string
          id: string
          issued_at: string | null
          lab: string
          notes: string | null
          sku: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          brand: string
          cert_document_url?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          issued_at?: string | null
          lab: string
          notes?: string | null
          sku?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          brand?: string
          cert_document_url?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          issued_at?: string | null
          lab?: string
          notes?: string | null
          sku?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_pharmacy_access: {
        Row: {
          created_at: string | null
          pharmacy_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          pharmacy_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          pharmacy_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pharmacy_access_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      wholesaler_stock_snapshots: {
        Row: {
          anticipated_restock_date: string | null
          captured_at: string | null
          expiration_date: string | null
          id: number
          lot_number: string | null
          price: number | null
          product_id: string | null
          stock_qty: number | null
          supplier: string
        }
        Insert: {
          anticipated_restock_date?: string | null
          captured_at?: string | null
          expiration_date?: string | null
          id?: number
          lot_number?: string | null
          price?: number | null
          product_id?: string | null
          stock_qty?: number | null
          supplier: string
        }
        Update: {
          anticipated_restock_date?: string | null
          captured_at?: string | null
          expiration_date?: string | null
          id?: number
          lot_number?: string | null
          price?: number | null
          product_id?: string | null
          stock_qty?: number | null
          supplier?: string
        }
        Relationships: [
          {
            foreignKeyName: "wholesaler_stock_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_events: {
        Row: {
          event_type: string
          id: number
          payload: Json
          ts: string
          worker_id: string | null
        }
        Insert: {
          event_type: string
          id?: number
          payload?: Json
          ts?: string
          worker_id?: string | null
        }
        Update: {
          event_type?: string
          id?: number
          payload?: Json
          ts?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      workers: {
        Row: {
          hostname: string
          id: string
          instance: number
          last_heartbeat: string
          role: string
          started_at: string
          status: string
          version: string | null
        }
        Insert: {
          hostname: string
          id: string
          instance: number
          last_heartbeat?: string
          role: string
          started_at?: string
          status: string
          version?: string | null
        }
        Update: {
          hostname?: string
          id?: string
          instance?: number
          last_heartbeat?: string
          role?: string
          started_at?: string
          status?: string
          version?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_orphan_mcp_bundles: {
        Row: {
          created_at: string | null
          id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
        }
        Relationships: []
      }
      v_orphan_transcript_bundles: {
        Row: {
          created_at: string | null
          id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
        }
        Relationships: []
      }
      worker_stats: {
        Row: {
          busy_count: number | null
          idle_count: number | null
          offline_count: number | null
          queue_depth: number | null
          recent_errors_1h: number | null
          recent_failed_permanent_24h: number | null
          running_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_next_job_with_cap: {
        Args: { p_cap?: number; p_version: string; p_worker_id: string }
        Returns: {
          attempt_count: number
          caller_log_url: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          expires_at: string | null
          final_transcript_bundle_id: string | null
          id: string
          job_type: string
          max_attempts: number | null
          mcp_bundle_id: string | null
          payload: Json
          priority: number
          progress: Json | null
          requested_status: string | null
          requires: Json
          result: Json | null
          started_at: string | null
          status: string
          submitted_by: string | null
          worker_id: string | null
          worker_version: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dispatch_attach_bundles: {
        Args: {
          p_job_id: string
          p_mcp_bundle_id: string
          p_transcript_bundle_id?: string
        }
        Returns: undefined
      }
      dispatch_check_rpcs: { Args: { p_names: string[] }; Returns: string[] }
      dispatch_delete_mcp_bundle: { Args: { p_id: string }; Returns: undefined }
      dispatch_delete_transcript_bundle: {
        Args: { p_id: string }
        Returns: undefined
      }
      dispatch_fetch_mcp_bundle: { Args: { p_id: string }; Returns: string }
      dispatch_fetch_outbound_transcript: {
        Args: { p_job_id: string }
        Returns: Json
      }
      dispatch_fetch_transcript_bundle: {
        Args: { p_id: string }
        Returns: string
      }
      dispatch_register_mcp_bundle: {
        Args: { p_secret: Json }
        Returns: string
      }
      dispatch_register_transcript_bundle: {
        Args: { p_secret: Json }
        Returns: string
      }
      requeue_stale_jobs_for_worker: {
        Args: { p_default_max: number; p_worker_id: string }
        Returns: number
      }
      search_memory_text: {
        Args: { k?: number; kind_filter?: string; pharmacy: string; q: string }
        Returns: {
          content: string
          id: string
          importance: number
          kind: Database["public"]["Enums"]["memory_kind"]
          metadata: Json
          rank: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      brand_auth_status:
        | "safe"
        | "needs_loa"
        | "hunts_resellers"
        | "transparency_enrolled"
        | "unknown"
        | "paused"
      briefing_type:
        | "hot_arbitrage"
        | "new_opportunity"
        | "restock"
        | "seasonal"
        | "reprice_up"
        | "reprice_down"
        | "suspend"
        | "watchlist"
        | "order_to_fulfill"
        | "customer_message"
        | "account_health"
        | "strategic"
        | "rx_shortage_adjacency"
        | "fda_recall_triggered"
        | "tic_certification_gap"
        | "digest"
      inbox_state: "pending" | "seen" | "acted" | "archived" | "dismissed"
      memory_kind: "episodic" | "procedural" | "semantic" | "preferences"
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
  public: {
    Enums: {
      brand_auth_status: [
        "safe",
        "needs_loa",
        "hunts_resellers",
        "transparency_enrolled",
        "unknown",
        "paused",
      ],
      briefing_type: [
        "hot_arbitrage",
        "new_opportunity",
        "restock",
        "seasonal",
        "reprice_up",
        "reprice_down",
        "suspend",
        "watchlist",
        "order_to_fulfill",
        "customer_message",
        "account_health",
        "strategic",
        "rx_shortage_adjacency",
        "fda_recall_triggered",
        "tic_certification_gap",
        "digest",
      ],
      inbox_state: ["pending", "seen", "acted", "archived", "dismissed"],
      memory_kind: ["episodic", "procedural", "semantic", "preferences"],
    },
  },
} as const
