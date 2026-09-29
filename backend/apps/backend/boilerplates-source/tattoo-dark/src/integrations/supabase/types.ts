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
      booking_rate_limits: {
        Row: {
          count: number
          email: string
          window_start: string
        }
        Insert: {
          count?: number
          email: string
          window_start?: string
        }
        Update: {
          count?: number
          email?: string
          window_start?: string
        }
        Relationships: []
      }
      booking_requests: {
        Row: {
          admin_notes: string | null
          approx_size: string | null
          availability: string | null
          budget: string | null
          color_pref: string | null
          created_at: string
          deposit_ack: boolean
          description: string
          email: string
          full_name: string
          health_flags: Json | null
          health_notes: string | null
          id: string
          landing_path: string | null
          lead_score: string | null
          over_18: boolean
          phone: string
          photo_release: boolean | null
          placement: string | null
          reference_url: string | null
          reference_urls: string[] | null
          referrer: string | null
          request_number: number
          source: string
          status: Database["public"]["Enums"]["booking_status"]
          style: string | null
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          admin_notes?: string | null
          approx_size?: string | null
          availability?: string | null
          budget?: string | null
          color_pref?: string | null
          created_at?: string
          deposit_ack?: boolean
          description: string
          email: string
          full_name: string
          health_flags?: Json | null
          health_notes?: string | null
          id?: string
          landing_path?: string | null
          lead_score?: string | null
          over_18?: boolean
          phone: string
          photo_release?: boolean | null
          placement?: string | null
          reference_url?: string | null
          reference_urls?: string[] | null
          referrer?: string | null
          request_number?: number
          source?: string
          status?: Database["public"]["Enums"]["booking_status"]
          style?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          admin_notes?: string | null
          approx_size?: string | null
          availability?: string | null
          budget?: string | null
          color_pref?: string | null
          created_at?: string
          deposit_ack?: boolean
          description?: string
          email?: string
          full_name?: string
          health_flags?: Json | null
          health_notes?: string | null
          id?: string
          landing_path?: string | null
          lead_score?: string | null
          over_18?: boolean
          phone?: string
          photo_release?: boolean | null
          placement?: string | null
          reference_url?: string | null
          reference_urls?: string[] | null
          referrer?: string | null
          request_number?: number
          source?: string
          status?: Database["public"]["Enums"]["booking_status"]
          style?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      email_captures: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          source: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          source: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          source?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      flash_drop_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string | null
        }
        Relationships: []
      }
      flash_items: {
        Row: {
          available: boolean
          created_at: string
          id: string
          image_url: string | null
          note: string | null
          price: string | null
          size: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          note?: string | null
          price?: string | null
          size?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          note?: string | null
          price?: string | null
          size?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      portfolio_items: {
        Row: {
          created_at: string
          healed_image_url: string | null
          id: string
          image_url: string
          placement: string | null
          published: boolean
          size: string | null
          slug: string | null
          sort_order: number
          style: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          healed_image_url?: string | null
          id?: string
          image_url: string
          placement?: string | null
          published?: boolean
          size?: string | null
          slug?: string | null
          sort_order?: number
          style?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          healed_image_url?: string | null
          id?: string
          image_url?: string
          placement?: string | null
          published?: boolean
          size?: string | null
          slug?: string | null
          sort_order?: number
          style?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          id: number
          settings: Json
          updated_at: string
        }
        Insert: {
          id?: number
          settings?: Json
          updated_at?: string
        }
        Update: {
          id?: number
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waitlist_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          notes: string | null
          phone: string | null
          size_preference: string | null
          style_preference: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          phone?: string | null
          size_preference?: string | null
          style_preference?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          phone?: string | null
          size_preference?: string | null
          style_preference?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "staff"
      booking_status:
        | "new"
        | "reviewing"
        | "consultation"
        | "approved"
        | "deposit_requested"
        | "booked"
        | "declined"
        | "archived"
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
      app_role: ["admin", "staff"],
      booking_status: [
        "new",
        "reviewing",
        "consultation",
        "approved",
        "deposit_requested",
        "booked",
        "declined",
        "archived",
      ],
    },
  },
} as const
