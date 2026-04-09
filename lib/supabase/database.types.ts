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
        Relationships: never[];
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
        Relationships: never[];
      };
      inspections: {
        Row: {
          id: string;
          tenant_id: string;
          job_id: string;
          quote_id: string | null;
          report_id: string | null;
          inspection_ref: string | null;
          scheduled_date: string | null;
          scheduled_time: string | null;
          inspector_id: string | null;
          status: string;
          insured_notified: boolean;
          scheduling_sms_sent_at: string | null;
          scheduling_sms_response: string | null;
          booking_confirmed_at: string | null;
          access_notes: string | null;
          calendar_event_id: string | null;
          field_draft: Json | null;
          form_submitted_at: string | null;
          safety_confirmed_at: string | null;
          person_met: string | null;
          scope_status: string;
          report_status: string;
          photos_status: string;
          send_checklist: Json;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          job_id: string;
          quote_id?: string | null;
          report_id?: string | null;
          inspection_ref?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          inspector_id?: string | null;
          status?: string;
          insured_notified?: boolean;
          scheduling_sms_sent_at?: string | null;
          scheduling_sms_response?: string | null;
          booking_confirmed_at?: string | null;
          access_notes?: string | null;
          calendar_event_id?: string | null;
          field_draft?: Json | null;
          form_submitted_at?: string | null;
          safety_confirmed_at?: string | null;
          person_met?: string | null;
          scope_status?: string;
          report_status?: string;
          photos_status?: string;
          send_checklist?: Json;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          job_id?: string;
          quote_id?: string | null;
          report_id?: string | null;
          inspection_ref?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          inspector_id?: string | null;
          status?: string;
          insured_notified?: boolean;
          scheduling_sms_sent_at?: string | null;
          scheduling_sms_response?: string | null;
          booking_confirmed_at?: string | null;
          access_notes?: string | null;
          calendar_event_id?: string | null;
          field_draft?: Json | null;
          form_submitted_at?: string | null;
          safety_confirmed_at?: string | null;
          person_met?: string | null;
          scope_status?: string;
          report_status?: string;
          photos_status?: string;
          send_checklist?: Json;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: never[];
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
        Relationships: never[];
      };
      insurer_orders: {
        Row: {
          id: string;
          tenant_id: string;
          status: string;
          created_at: string;
          [key: string]: unknown;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          status?: string;
          created_at?: string;
          [key: string]: unknown;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          status?: string;
          created_at?: string;
          [key: string]: unknown;
        };
        Relationships: never[];
      };
      job_flags: {
        Row: {
          id: string;
          tenant_id: string;
          job_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          job_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          job_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: {
          foreignKeyName: string;
          columns: string[];
          isOneToOne?: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }[];
      };
      action_queue: {
        Row: {
          id: string;
          tenant_id: string;
          job_id: string;
          rule_key: string;
          title: string;
          description: string | null;
          ai_draft: Json | null;
          status: string;
          priority: number;
          snoozed_until: string | null;
          confirmed_by: string | null;
          confirmed_at: string | null;
          error_log: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          job_id: string;
          rule_key: string;
          title: string;
          description?: string | null;
          ai_draft?: Json | null;
          status?: string;
          priority?: number;
          snoozed_until?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          error_log?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          job_id?: string;
          rule_key?: string;
          title?: string;
          description?: string | null;
          ai_draft?: Json | null;
          status?: string;
          priority?: number;
          snoozed_until?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          error_log?: string | null;
          created_at?: string;
        };
        Relationships: {
          foreignKeyName: string;
          columns: string[];
          isOneToOne?: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }[];
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
