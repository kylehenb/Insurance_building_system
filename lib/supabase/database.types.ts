export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          job_prefix: string;
          job_sequence: number;
          plan: string;
          contact_email: string | null;
          contact_phone: string | null;
          address: string | null;
          logo_storage_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          job_prefix: string;
          job_sequence?: number;
          plan?: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          address?: string | null;
          logo_storage_path?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          job_prefix?: string;
          job_sequence?: number;
          plan?: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          address?: string | null;
          logo_storage_path?: string | null;
          created_at?: string;
        };
      };
      users: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          role: string;
          phone: string | null;
          address: string | null;
          is_emergency_contact: boolean;
          makesafe_available: boolean;
          can_send_to_insurer: boolean | null;
          can_edit_settings: boolean | null;
          can_approve_invoices: boolean | null;
          can_manage_scope_library: boolean | null;
          can_view_financials: boolean | null;
          created_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          name: string;
          role: string;
          phone?: string | null;
          address?: string | null;
          is_emergency_contact?: boolean;
          makesafe_available?: boolean;
          can_send_to_insurer?: boolean | null;
          can_edit_settings?: boolean | null;
          can_approve_invoices?: boolean | null;
          can_manage_scope_library?: boolean | null;
          can_view_financials?: boolean | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          role?: string;
          phone?: string | null;
          address?: string | null;
          is_emergency_contact?: boolean;
          makesafe_available?: boolean;
          can_send_to_insurer?: boolean | null;
          can_edit_settings?: boolean | null;
          can_approve_invoices?: boolean | null;
          can_manage_scope_library?: boolean | null;
          can_view_financials?: boolean | null;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}
