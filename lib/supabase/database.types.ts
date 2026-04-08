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
      jobs: {
        Row: {
          id: string;
          tenant_id: string;
          job_number: string;
          claim_number: string | null;
          client_id: string | null;
          insurer: string | null;
          adjuster: string | null;
          property_address: string | null;
          insured_name: string | null;
          insured_phone: string | null;
          insured_email: string | null;
          additional_contacts: string | null;
          date_of_loss: string | null;
          loss_type: string | null;
          claim_description: string | null;
          special_instructions: string | null;
          sum_insured: number | null;
          excess: number | null;
          assigned_to: string | null;
          status: string;
          kpi_contact_due: string | null;
          kpi_booking_due: string | null;
          kpi_visit_due: string | null;
          kpi_report_due: string | null;
          kpi_contacted_at: string | null;
          kpi_booked_at: string | null;
          kpi_visited_at: string | null;
          kpi_reported_at: string | null;
          notes: string | null;
          automation_overrides: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          job_number: string;
          claim_number?: string | null;
          client_id?: string | null;
          insurer?: string | null;
          adjuster?: string | null;
          property_address?: string | null;
          insured_name?: string | null;
          insured_phone?: string | null;
          insured_email?: string | null;
          additional_contacts?: string | null;
          date_of_loss?: string | null;
          loss_type?: string | null;
          claim_description?: string | null;
          special_instructions?: string | null;
          sum_insured?: number | null;
          excess?: number | null;
          assigned_to?: string | null;
          status?: string;
          kpi_contact_due?: string | null;
          kpi_booking_due?: string | null;
          kpi_visit_due?: string | null;
          kpi_report_due?: string | null;
          kpi_contacted_at?: string | null;
          kpi_booked_at?: string | null;
          kpi_visited_at?: string | null;
          kpi_reported_at?: string | null;
          notes?: string | null;
          automation_overrides?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          job_number?: string;
          claim_number?: string | null;
          client_id?: string | null;
          insurer?: string | null;
          adjuster?: string | null;
          property_address?: string | null;
          insured_name?: string | null;
          insured_phone?: string | null;
          insured_email?: string | null;
          additional_contacts?: string | null;
          date_of_loss?: string | null;
          loss_type?: string | null;
          claim_description?: string | null;
          special_instructions?: string | null;
          sum_insured?: number | null;
          excess?: number | null;
          assigned_to?: string | null;
          status?: string;
          kpi_contact_due?: string | null;
          kpi_booking_due?: string | null;
          kpi_visit_due?: string | null;
          kpi_report_due?: string | null;
          kpi_contacted_at?: string | null;
          kpi_booked_at?: string | null;
          kpi_visited_at?: string | null;
          kpi_reported_at?: string | null;
          notes?: string | null;
          automation_overrides?: Json;
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
