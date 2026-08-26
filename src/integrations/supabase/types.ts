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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      banners: {
        Row: {
          catalog_id: string
          created_at: string
          href: string | null
          id: string
          image_url: string
          object_position: string
          position: number
        }
        Insert: {
          catalog_id: string
          created_at?: string
          href?: string | null
          id?: string
          image_url: string
          object_position?: string
          position?: number
        }
        Update: {
          catalog_id?: string
          created_at?: string
          href?: string | null
          id?: string
          image_url?: string
          object_position?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "banners_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
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
          id: string
          instagram_url: string | null
          logo_position: string
          logo_size: string
          logo_url: string | null
          owner_bio: string | null
          owner_hours: string | null
          owner_name: string | null
          owner_photo_url: string | null
          payment_methods: Json | null
          primary_color: string
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
          id?: string
          instagram_url?: string | null
          logo_position?: string
          logo_size?: string
          logo_url?: string | null
          owner_bio?: string | null
          owner_hours?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          payment_methods?: Json | null
          primary_color?: string
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
          id?: string
          instagram_url?: string | null
          logo_position?: string
          logo_size?: string
          logo_url?: string | null
          owner_bio?: string | null
          owner_hours?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          payment_methods?: Json | null
          primary_color?: string
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
        ]
      }
      orders: {
        Row: {
          catalog_id: string
          created_at: string
          customer_name: string
          customer_phone: string | null
          id: string
          items: Json
          note: string | null
          status: string
          total: number
        }
        Insert: {
          catalog_id: string
          created_at?: string
          customer_name: string
          customer_phone?: string | null
          id?: string
          items?: Json
          note?: string | null
          status?: string
          total?: number
        }
        Update: {
          catalog_id?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string | null
          id?: string
          items?: Json
          note?: string | null
          status?: string
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
        ]
      }
      products: {
        Row: {
          available: boolean
          catalog_id: string
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          images: string[]
          is_bestseller: boolean
          is_new: boolean
          name: string
          position: number
          price: number
          price_options: Json
          sale_price: number | null
          updated_at: string
          variations: Json
        }
        Insert: {
          available?: boolean
          catalog_id: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          images?: string[]
          is_bestseller?: boolean
          is_new?: boolean
          name: string
          position?: number
          price?: number
          price_options?: Json
          sale_price?: number | null
          updated_at?: string
          variations?: Json
        }
        Update: {
          available?: boolean
          catalog_id?: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          images?: string[]
          is_bestseller?: boolean
          is_new?: boolean
          name?: string
          position?: number
          price?: number
          price_options?: Json
          sale_price?: number | null
          updated_at?: string
          variations?: Json
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
          accent_color: string
          background_color: string
          banner_autoplay: boolean
          banner_enabled: boolean
          banner_indicators: boolean
          banner_interval: number
          cover_url: string | null
          created_at: string
          cart_style: string
          id: string
          logo_position: string
          logo_size: string
          logo_url: string | null
          payment_methods: Json | null
          primary_color: string
          slug: string
          store_font: string
          store_name: string
          updated_at: string
          user_id: string
          whatsapp: string | null
          whatsapp_button_color: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
