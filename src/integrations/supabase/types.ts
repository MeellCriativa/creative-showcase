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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      banners: {
        Row: {
          catalog_id: string
          created_at: string
          device: string
          href: string | null
          id: string
          image_url: string
          object_position: string
          position: number
          product_id: string | null
        }
        Insert: {
          catalog_id: string
          created_at?: string
          device?: string
          href?: string | null
          id?: string
          image_url: string
          object_position?: string
          position?: number
          product_id?: string | null
        }
        Update: {
          catalog_id?: string
          created_at?: string
          device?: string
          href?: string | null
          id?: string
          image_url?: string
          object_position?: string
          position?: number
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banners_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banners_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banners_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_visits: {
        Row: {
          catalog_id: string
          id: number
          visited_at: string
        }
        Insert: {
          catalog_id: string
          id?: never
          visited_at?: string
        }
        Update: {
          catalog_id?: string
          id?: never
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_visits_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_visits_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogs: {
        Row: {
          accent_color: string
          background_color: string | null
          banner_autoplay: boolean
          banner_enabled: boolean
          banner_indicators: boolean
          banner_interval: number
          cart_style: string
          cover_url: string | null
          created_at: string
          currency: string
          delivery_methods: Json | null
          id: string
          instagram_url: string | null
          logo_position: string
          logo_size: string
          logo_url: string | null
          meta_catalog_connected: boolean
          owner_bio: string | null
          owner_hours: string | null
          owner_name: string | null
          owner_photo_url: string | null
          payment_methods: Json | null
          pix_holder_document: string | null
          pix_holder_name: string | null
          pix_key_type: string | null
          pix_key_value: string | null
          pix_mode: string
          pix_qr_mime: string | null
          pix_qr_name: string | null
          pix_qr_path: string | null
          pix_qr_size: number | null
          plan: string
          primary_color: string
          shipping_origin_zip: string | null
          slug: string
          store_description: string | null
          store_font: string
          store_name: string
          updated_at: string
          user_id: string
          whatsapp: string | null
          whatsapp_button_color: string | null
        }
        Insert: {
          accent_color?: string
          background_color?: string | null
          banner_autoplay?: boolean
          banner_enabled?: boolean
          banner_indicators?: boolean
          banner_interval?: number
          cart_style?: string
          cover_url?: string | null
          created_at?: string
          currency?: string
          delivery_methods?: Json | null
          id?: string
          instagram_url?: string | null
          logo_position?: string
          logo_size?: string
          logo_url?: string | null
          meta_catalog_connected?: boolean
          owner_bio?: string | null
          owner_hours?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          payment_methods?: Json | null
          pix_holder_document?: string | null
          pix_holder_name?: string | null
          pix_key_type?: string | null
          pix_key_value?: string | null
          pix_mode?: string
          pix_qr_mime?: string | null
          pix_qr_name?: string | null
          pix_qr_path?: string | null
          pix_qr_size?: number | null
          plan?: string
          primary_color?: string
          shipping_origin_zip?: string | null
          slug: string
          store_description?: string | null
          store_font?: string
          store_name: string
          updated_at?: string
          user_id: string
          whatsapp?: string | null
          whatsapp_button_color?: string | null
        }
        Update: {
          accent_color?: string
          background_color?: string | null
          banner_autoplay?: boolean
          banner_enabled?: boolean
          banner_indicators?: boolean
          banner_interval?: number
          cart_style?: string
          cover_url?: string | null
          created_at?: string
          currency?: string
          delivery_methods?: Json | null
          id?: string
          instagram_url?: string | null
          logo_position?: string
          logo_size?: string
          logo_url?: string | null
          meta_catalog_connected?: boolean
          owner_bio?: string | null
          owner_hours?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          payment_methods?: Json | null
          pix_holder_document?: string | null
          pix_holder_name?: string | null
          pix_key_type?: string | null
          pix_key_value?: string | null
          pix_mode?: string
          pix_qr_mime?: string | null
          pix_qr_name?: string | null
          pix_qr_path?: string | null
          pix_qr_size?: number | null
          plan?: string
          primary_color?: string
          shipping_origin_zip?: string | null
          slug?: string
          store_description?: string | null
          store_font?: string
          store_name?: string
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
          whatsapp_button_color?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          catalog_id: string
          created_at: string
          id: string
          name: string
          position: number
        }
        Insert: {
          catalog_id: string
          created_at?: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          catalog_id?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_deliveries: {
        Row: {
          attempts: number
          catalog_id: string
          created_at: string
          customer_email: string
          id: string
          last_error: string | null
          order_id: string
          product_id: string
          provider_message_id: string | null
          revoked_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          catalog_id: string
          created_at?: string
          customer_email: string
          id?: string
          last_error?: string | null
          order_id: string
          product_id: string
          provider_message_id?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          catalog_id?: string
          created_at?: string
          customer_email?: string
          id?: string
          last_error?: string | null
          order_id?: string
          product_id?: string
          provider_message_id?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "digital_deliveries_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_deliveries_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_deliveries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_download_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          order_id: string | null
          product_id: string | null
          token_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          order_id?: string | null
          product_id?: string | null
          token_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          order_id?: string | null
          product_id?: string | null
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "digital_download_events_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "digital_download_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_download_tokens: {
        Row: {
          catalog_id: string
          created_at: string
          delivery_id: string
          expires_at: string
          id: string
          max_uses: number
          order_id: string
          product_id: string
          revoked_at: string | null
          token_hash: string
          used_count: number
        }
        Insert: {
          catalog_id: string
          created_at?: string
          delivery_id: string
          expires_at: string
          id?: string
          max_uses?: number
          order_id: string
          product_id: string
          revoked_at?: string | null
          token_hash: string
          used_count?: number
        }
        Update: {
          catalog_id?: string
          created_at?: string
          delivery_id?: string
          expires_at?: string
          id?: string
          max_uses?: number
          order_id?: string
          product_id?: string
          revoked_at?: string | null
          token_hash?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "digital_download_tokens_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_download_tokens_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_download_tokens_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "digital_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_download_tokens_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_download_tokens_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_order_emails: {
        Row: {
          attempts: number
          catalog_id: string
          created_at: string
          email_bundle_cipher: string | null
          last_error: string | null
          locked_at: string | null
          order_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          catalog_id: string
          created_at?: string
          email_bundle_cipher?: string | null
          last_error?: string | null
          locked_at?: string | null
          order_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          catalog_id?: string
          created_at?: string
          email_bundle_cipher?: string | null
          last_error?: string | null
          locked_at?: string | null
          order_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "digital_order_emails_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_order_emails_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_order_emails_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_payment_confirmations: {
        Row: {
          attempts: number
          catalog_id: string
          confirmed_at: string
          confirmed_by: string | null
          created_at: string
          declared_at: string | null
          last_error: string | null
          order_id: string
        }
        Insert: {
          attempts?: number
          catalog_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          declared_at?: string | null
          last_error?: string | null
          order_id: string
        }
        Update: {
          attempts?: number
          catalog_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          declared_at?: string | null
          last_error?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_payment_confirmations_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_payment_confirmations_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_payment_confirmations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      melhor_envio_accounts: {
        Row: {
          access_token: string | null
          catalog_id: string
          connected: boolean
          created_at: string
          environment: string
          id: string
          refresh_token: string | null
          sender_city: string | null
          sender_complement: string | null
          sender_district: string | null
          sender_document: string | null
          sender_email: string | null
          sender_name: string | null
          sender_number: string | null
          sender_phone: string | null
          sender_state: string | null
          sender_street: string | null
          sender_zip: string | null
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          catalog_id: string
          connected?: boolean
          created_at?: string
          environment?: string
          id?: string
          refresh_token?: string | null
          sender_city?: string | null
          sender_complement?: string | null
          sender_district?: string | null
          sender_document?: string | null
          sender_email?: string | null
          sender_name?: string | null
          sender_number?: string | null
          sender_phone?: string | null
          sender_state?: string | null
          sender_street?: string | null
          sender_zip?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          catalog_id?: string
          connected?: boolean
          created_at?: string
          environment?: string
          id?: string
          refresh_token?: string | null
          sender_city?: string | null
          sender_complement?: string | null
          sender_district?: string | null
          sender_document?: string | null
          sender_email?: string | null
          sender_name?: string | null
          sender_number?: string | null
          sender_phone?: string | null
          sender_state?: string | null
          sender_street?: string | null
          sender_zip?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "melhor_envio_accounts_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: true
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "melhor_envio_accounts_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: true
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_catalog_connections: {
        Row: {
          business_id: string
          business_name: string | null
          catalog_id: string
          catalog_id_meta: string
          catalog_name: string | null
          created_at: string
          facebook_access_token: string
          facebook_user_id: string
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          phone_number: string | null
          refresh_token: string | null
          sync_status: string
          token_expires_at: string
          updated_at: string
          user_id: string
          whatsapp_business_id: string | null
        }
        Insert: {
          business_id: string
          business_name?: string | null
          catalog_id: string
          catalog_id_meta: string
          catalog_name?: string | null
          created_at?: string
          facebook_access_token: string
          facebook_user_id: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          phone_number?: string | null
          refresh_token?: string | null
          sync_status?: string
          token_expires_at: string
          updated_at?: string
          user_id: string
          whatsapp_business_id?: string | null
        }
        Update: {
          business_id?: string
          business_name?: string | null
          catalog_id?: string
          catalog_id_meta?: string
          catalog_name?: string | null
          created_at?: string
          facebook_access_token?: string
          facebook_user_id?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          phone_number?: string | null
          refresh_token?: string | null
          sync_status?: string
          token_expires_at?: string
          updated_at?: string
          user_id?: string
          whatsapp_business_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_catalog_connections_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: true
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_catalog_connections_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: true
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_product_mapping: {
        Row: {
          catalog_id: string
          created_at: string
          error_message: string | null
          id: string
          last_synced_at: string | null
          meta_item_id: string | null
          meta_retailer_id: string
          product_id: string
          sync_state: string
          updated_at: string
        }
        Insert: {
          catalog_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_synced_at?: string | null
          meta_item_id?: string | null
          meta_retailer_id: string
          product_id: string
          sync_state?: string
          updated_at?: string
        }
        Update: {
          catalog_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_synced_at?: string | null
          meta_item_id?: string | null
          meta_retailer_id?: string
          product_id?: string
          sync_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_product_mapping_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_product_mapping_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_product_mapping_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_sync_logs: {
        Row: {
          catalog_id: string
          completed_at: string | null
          error_details: Json | null
          id: number
          items_created: number | null
          items_deleted: number | null
          items_failed: number | null
          items_total: number | null
          items_updated: number | null
          operation: string
          started_at: string
          status: string
        }
        Insert: {
          catalog_id: string
          completed_at?: string | null
          error_details?: Json | null
          id?: never
          items_created?: number | null
          items_deleted?: number | null
          items_failed?: number | null
          items_total?: number | null
          items_updated?: number | null
          operation: string
          started_at?: string
          status?: string
        }
        Update: {
          catalog_id?: string
          completed_at?: string | null
          error_details?: Json | null
          id?: never
          items_created?: number | null
          items_deleted?: number | null
          items_failed?: number | null
          items_total?: number | null
          items_updated?: number | null
          operation?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_sync_logs_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_sync_logs_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      order_checkout_sessions: {
        Row: {
          catalog_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          order_id: string
          token_hash: string
        }
        Insert: {
          catalog_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          order_id: string
          token_hash: string
        }
        Update: {
          catalog_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          order_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_checkout_sessions_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_checkout_sessions_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_checkout_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          catalog_id: string
          created_at: string
          currency: string | null
          customer_city: string | null
          customer_complement: string | null
          customer_district: string | null
          customer_document: string | null
          customer_email: string | null
          customer_name: string
          customer_number: string | null
          customer_phone: string | null
          customer_state: string | null
          customer_street: string | null
          delivery_method: string | null
          id: string
          items: Json
          me_agency_id: string | null
          me_label_id: string | null
          me_label_url: string | null
          me_order_id: string | null
          me_protocol: string | null
          me_status: string | null
          me_tracking: string | null
          note: string | null
          payment_method: string | null
          payment_provider: string | null
          payment_status: string
          payment_transaction_id: string | null
          pix_confirmed_at: string | null
          pix_confirmed_by: string | null
          pix_declared_at: string | null
          shipping_cost: number | null
          shipping_eta_days: number | null
          shipping_eta_text: string | null
          shipping_service: string | null
          shipping_service_name: string | null
          shipping_zip: string | null
          status: string
          subtotal: number | null
          total: number
        }
        Insert: {
          catalog_id: string
          created_at?: string
          currency?: string | null
          customer_city?: string | null
          customer_complement?: string | null
          customer_district?: string | null
          customer_document?: string | null
          customer_email?: string | null
          customer_name: string
          customer_number?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_street?: string | null
          delivery_method?: string | null
          id?: string
          items?: Json
          me_agency_id?: string | null
          me_label_id?: string | null
          me_label_url?: string | null
          me_order_id?: string | null
          me_protocol?: string | null
          me_status?: string | null
          me_tracking?: string | null
          note?: string | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_status?: string
          payment_transaction_id?: string | null
          pix_confirmed_at?: string | null
          pix_confirmed_by?: string | null
          pix_declared_at?: string | null
          shipping_cost?: number | null
          shipping_eta_days?: number | null
          shipping_eta_text?: string | null
          shipping_service?: string | null
          shipping_service_name?: string | null
          shipping_zip?: string | null
          status?: string
          subtotal?: number | null
          total?: number
        }
        Update: {
          catalog_id?: string
          created_at?: string
          currency?: string | null
          customer_city?: string | null
          customer_complement?: string | null
          customer_district?: string | null
          customer_document?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_number?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_street?: string | null
          delivery_method?: string | null
          id?: string
          items?: Json
          me_agency_id?: string | null
          me_label_id?: string | null
          me_label_url?: string | null
          me_order_id?: string | null
          me_protocol?: string | null
          me_status?: string | null
          me_tracking?: string | null
          note?: string | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_status?: string
          payment_transaction_id?: string | null
          pix_confirmed_at?: string | null
          pix_confirmed_by?: string | null
          pix_declared_at?: string | null
          shipping_cost?: number | null
          shipping_eta_days?: number | null
          shipping_eta_text?: string | null
          shipping_service?: string | null
          shipping_service_name?: string | null
          shipping_zip?: string | null
          status?: string
          subtotal?: number | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_connections: {
        Row: {
          access_token_enc: string | null
          capabilities: Json
          catalog_id: string
          connected: boolean
          connected_at: string | null
          created_at: string
          disconnected_at: string | null
          enabled: boolean
          environment: string
          external_account_id: string | null
          external_account_label: string | null
          id: string
          last_verified_at: string | null
          merchant_id: string | null
          provider: string
          refresh_token_enc: string | null
          scopes: string[]
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_enc?: string | null
          capabilities?: Json
          catalog_id: string
          connected?: boolean
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          enabled?: boolean
          environment?: string
          external_account_id?: string | null
          external_account_label?: string | null
          id?: string
          last_verified_at?: string | null
          merchant_id?: string | null
          provider: string
          refresh_token_enc?: string | null
          scopes?: string[]
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_enc?: string | null
          capabilities?: Json
          catalog_id?: string
          connected?: boolean
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          enabled?: boolean
          environment?: string
          external_account_id?: string | null
          external_account_label?: string | null
          id?: string
          last_verified_at?: string | null
          merchant_id?: string | null
          provider?: string
          refresh_token_enc?: string | null
          scopes?: string[]
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_connections_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_connections_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          attempts: number
          event_type: string | null
          id: string
          order_id: string | null
          payload: Json
          processed: boolean
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string
          received_at: string
          signature_valid: boolean
          transaction_id: string | null
        }
        Insert: {
          attempts?: number
          event_type?: string | null
          id?: string
          order_id?: string | null
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider: string
          provider_event_id: string
          received_at?: string
          signature_valid?: boolean
          transaction_id?: string | null
        }
        Update: {
          attempts?: number
          event_type?: string | null
          id?: string
          order_id?: string | null
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_valid?: boolean
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_oauth_states: {
        Row: {
          catalog_id: string
          code_challenge: string | null
          code_verifier_encrypted: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          nonce: string
          provider: string
          user_id: string
        }
        Insert: {
          catalog_id: string
          code_challenge?: string | null
          code_verifier_encrypted?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          nonce: string
          provider: string
          user_id: string
        }
        Update: {
          catalog_id?: string
          code_challenge?: string | null
          code_verifier_encrypted?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          nonce?: string
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_oauth_states_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_oauth_states_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_rate_limits: {
        Row: {
          bucket: string
          hits: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          bucket: string
          hits?: number
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          bucket?: string
          hits?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      payment_refunds: {
        Row: {
          amount: number
          catalog_id: string
          created_at: string
          dedupe_key: string | null
          entry_kind: string
          id: string
          idempotency_key: string | null
          last_attempt_at: string | null
          last_error: string | null
          operation_id: string | null
          provider: string
          provider_refund_id: string | null
          reason: string | null
          requested_by: string | null
          status: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          catalog_id: string
          created_at?: string
          dedupe_key?: string | null
          entry_kind?: string
          id?: string
          idempotency_key?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          operation_id?: string | null
          provider: string
          provider_refund_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          catalog_id?: string
          created_at?: string
          dedupe_key?: string | null
          entry_kind?: string
          id?: string
          idempotency_key?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          operation_id?: string | null
          provider?: string
          provider_refund_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          amount_minor: number
          capture_claimed_at: string | null
          captured_amount: number
          catalog_id: string
          checkout_url: string | null
          created_at: string
          currency: string
          environment: string
          id: string
          last_event_at: string | null
          metadata: Json
          order_id: string
          payer_reference: string | null
          provider: string
          provider_order_id: string | null
          provider_payment_id: string | null
          provider_status: string | null
          refunded_amount: number
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          amount_minor: number
          capture_claimed_at?: string | null
          captured_amount?: number
          catalog_id: string
          checkout_url?: string | null
          created_at?: string
          currency: string
          environment?: string
          id?: string
          last_event_at?: string | null
          metadata?: Json
          order_id: string
          payer_reference?: string | null
          provider: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          provider_status?: string | null
          refunded_amount?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_minor?: number
          capture_claimed_at?: string | null
          captured_amount?: number
          catalog_id?: string
          checkout_url?: string | null
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          last_event_at?: string | null
          metadata?: Json
          order_id?: string
          payer_reference?: string | null
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          provider_status?: string | null
          refunded_amount?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_testimonials: {
        Row: {
          catalog_id: string
          content: string
          created_at: string
          customer_name: string
          id: string
          position: number
          product_id: string
          stars: number
          truth_confirmed: boolean
          updated_at: string
        }
        Insert: {
          catalog_id: string
          content: string
          created_at?: string
          customer_name: string
          id?: string
          position?: number
          product_id: string
          stars?: number
          truth_confirmed?: boolean
          updated_at?: string
        }
        Update: {
          catalog_id?: string
          content?: string
          created_at?: string
          customer_name?: string
          id?: string
          position?: number
          product_id?: string
          stars?: number
          truth_confirmed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_testimonials_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_testimonials_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_testimonials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          additional_info: string | null
          available: boolean
          catalog_id: string
          category_id: string | null
          checkout_desktop_config: Json
          checkout_enabled: boolean
          checkout_mobile_config: Json
          created_at: string
          description: string | null
          digital_delivery_mode: string
          digital_external_url: string | null
          digital_file_checksum: string | null
          digital_file_mime: string | null
          digital_file_name: string | null
          digital_file_path: string | null
          digital_file_size: number | null
          digital_instructions: string | null
          digital_link_ttl_minutes: number | null
          digital_max_downloads: number | null
          height_cm: number | null
          id: string
          images: string[]
          is_bestseller: boolean
          is_new: boolean
          length_cm: number | null
          name: string
          position: number
          price: number
          price_options: Json
          product_type: string
          sale_price: number | null
          updated_at: string
          variations: Json
          weight_grams: number | null
          width_cm: number | null
        }
        Insert: {
          additional_info?: string | null
          available?: boolean
          catalog_id: string
          category_id?: string | null
          checkout_desktop_config?: Json
          checkout_enabled?: boolean
          checkout_mobile_config?: Json
          created_at?: string
          description?: string | null
          digital_delivery_mode?: string
          digital_external_url?: string | null
          digital_file_checksum?: string | null
          digital_file_mime?: string | null
          digital_file_name?: string | null
          digital_file_path?: string | null
          digital_file_size?: number | null
          digital_instructions?: string | null
          digital_link_ttl_minutes?: number | null
          digital_max_downloads?: number | null
          height_cm?: number | null
          id?: string
          images?: string[]
          is_bestseller?: boolean
          is_new?: boolean
          length_cm?: number | null
          name: string
          position?: number
          price?: number
          price_options?: Json
          product_type?: string
          sale_price?: number | null
          updated_at?: string
          variations?: Json
          weight_grams?: number | null
          width_cm?: number | null
        }
        Update: {
          additional_info?: string | null
          available?: boolean
          catalog_id?: string
          category_id?: string | null
          checkout_desktop_config?: Json
          checkout_enabled?: boolean
          checkout_mobile_config?: Json
          created_at?: string
          description?: string | null
          digital_delivery_mode?: string
          digital_external_url?: string | null
          digital_file_checksum?: string | null
          digital_file_mime?: string | null
          digital_file_name?: string | null
          digital_file_path?: string | null
          digital_file_size?: number | null
          digital_instructions?: string | null
          digital_link_ttl_minutes?: number | null
          digital_max_downloads?: number | null
          height_cm?: number | null
          id?: string
          images?: string[]
          is_bestseller?: boolean
          is_new?: boolean
          length_cm?: number | null
          name?: string
          position?: number
          price?: number
          price_options?: Json
          product_type?: string
          sale_price?: number | null
          updated_at?: string
          variations?: Json
          weight_grams?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      catalogs_public: {
        Row: {
          accent_color: string | null
          background_color: string | null
          banner_autoplay: boolean | null
          banner_enabled: boolean | null
          banner_indicators: boolean | null
          banner_interval: number | null
          cart_style: string | null
          cover_url: string | null
          created_at: string | null
          currency: string | null
          delivery_methods: Json | null
          id: string | null
          instagram_url: string | null
          logo_position: string | null
          logo_size: string | null
          logo_url: string | null
          owner_bio: string | null
          owner_hours: string | null
          owner_name: string | null
          owner_photo_url: string | null
          payment_methods: Json | null
          primary_color: string | null
          shipping_origin_zip: string | null
          slug: string | null
          store_description: string | null
          store_font: string | null
          store_name: string | null
          updated_at: string | null
          user_id: string | null
          whatsapp: string | null
          whatsapp_button_color: string | null
        }
        Insert: {
          accent_color?: string | null
          background_color?: string | null
          banner_autoplay?: boolean | null
          banner_enabled?: boolean | null
          banner_indicators?: boolean | null
          banner_interval?: number | null
          cart_style?: string | null
          cover_url?: string | null
          created_at?: string | null
          currency?: string | null
          delivery_methods?: Json | null
          id?: string | null
          instagram_url?: string | null
          logo_position?: string | null
          logo_size?: string | null
          logo_url?: string | null
          owner_bio?: string | null
          owner_hours?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          payment_methods?: Json | null
          primary_color?: string | null
          shipping_origin_zip?: string | null
          slug?: string | null
          store_description?: string | null
          store_font?: string | null
          store_name?: string | null
          updated_at?: string | null
          user_id?: string | null
          whatsapp?: string | null
          whatsapp_button_color?: string | null
        }
        Update: {
          accent_color?: string | null
          background_color?: string | null
          banner_autoplay?: boolean | null
          banner_enabled?: boolean | null
          banner_indicators?: boolean | null
          banner_interval?: number | null
          cart_style?: string | null
          cover_url?: string | null
          created_at?: string | null
          currency?: string | null
          delivery_methods?: Json | null
          id?: string | null
          instagram_url?: string | null
          logo_position?: string | null
          logo_size?: string | null
          logo_url?: string | null
          owner_bio?: string | null
          owner_hours?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          payment_methods?: Json | null
          primary_color?: string | null
          shipping_origin_zip?: string | null
          slug?: string | null
          store_description?: string | null
          store_font?: string | null
          store_name?: string | null
          updated_at?: string | null
          user_id?: string | null
          whatsapp?: string | null
          whatsapp_button_color?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      bump_payment_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window_ms: number }
        Returns: {
          allowed: boolean
          hits: number
          retry_after_ms: number
        }[]
      }
      claim_digital_order_email: {
        Args: {
          p_allowed_statuses: string[]
          p_cooldown_seconds?: number
          p_lock_seconds?: number
          p_order_id: string
        }
        Returns: boolean
      }
      confirm_manual_payment: {
        Args: { p_actor?: string; p_order_id: string }
        Returns: boolean
      }
      finish_digital_order_email: {
        Args: {
          p_bundle_cipher?: string
          p_error?: string
          p_message_id?: string
          p_ok: boolean
          p_order_id: string
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
