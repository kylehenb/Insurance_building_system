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
    PostgrestVersion: "14.4"
  }
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
      action_queue: {
        Row: {
          ai_draft: Json | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          description: string | null
          error_log: string | null
          id: string
          job_id: string
          priority: number | null
          rule_key: string
          snoozed_until: string | null
          status: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          ai_draft?: Json | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          description?: string | null
          error_log?: string | null
          id?: string
          job_id: string
          priority?: number | null
          rule_key: string
          snoozed_until?: string | null
          status?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          ai_draft?: Json | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          description?: string | null
          error_log?: string | null
          id?: string
          job_id?: string
          priority?: number | null
          rule_key?: string
          snoozed_until?: string | null
          status?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_queue_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "action_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          tenant_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          tenant_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_config: {
        Row: {
          description: string | null
          id: string
          key: string
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          value: string
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          value: string
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          abn: string | null
          address: string | null
          client_type: string
          contact_phone: string | null
          created_at: string | null
          id: string
          kpi_booking_hours: number | null
          kpi_contact_hours: number | null
          kpi_report_days: number | null
          kpi_visit_days: number | null
          name: string
          notes: string | null
          parent_id: string | null
          send_booking_confirmation: boolean | null
          status: string | null
          submission_email: string | null
          tenant_id: string
          trading_name: string | null
        }
        Insert: {
          abn?: string | null
          address?: string | null
          client_type: string
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          kpi_booking_hours?: number | null
          kpi_contact_hours?: number | null
          kpi_report_days?: number | null
          kpi_visit_days?: number | null
          name: string
          notes?: string | null
          parent_id?: string | null
          send_booking_confirmation?: boolean | null
          status?: string | null
          submission_email?: string | null
          tenant_id: string
          trading_name?: string | null
        }
        Update: {
          abn?: string | null
          address?: string | null
          client_type?: string
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          kpi_booking_hours?: number | null
          kpi_contact_hours?: number | null
          kpi_report_days?: number | null
          kpi_visit_days?: number | null
          name?: string
          notes?: string | null
          parent_id?: string | null
          send_booking_confirmation?: boolean | null
          status?: string | null
          submission_email?: string | null
          tenant_id?: string
          trading_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communications: {
        Row: {
          action_queue_id: string | null
          ai_extracted_notes: string | null
          attachments: Json | null
          contact_detail: string | null
          contact_name: string | null
          contact_type: string | null
          content: string | null
          created_at: string | null
          created_by: string | null
          direction: string | null
          id: string
          inspection_id: string | null
          job_id: string | null
          linked_to: string | null
          parse_confidence: string | null
          persona: string | null
          requires_action: boolean | null
          subject: string | null
          tenant_id: string
          type: string
          work_order_id: string | null
        }
        Insert: {
          action_queue_id?: string | null
          ai_extracted_notes?: string | null
          attachments?: Json | null
          contact_detail?: string | null
          contact_name?: string | null
          contact_type?: string | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          direction?: string | null
          id?: string
          inspection_id?: string | null
          job_id?: string | null
          linked_to?: string | null
          parse_confidence?: string | null
          persona?: string | null
          requires_action?: boolean | null
          subject?: string | null
          tenant_id: string
          type: string
          work_order_id?: string | null
        }
        Update: {
          action_queue_id?: string | null
          ai_extracted_notes?: string | null
          attachments?: Json | null
          contact_detail?: string | null
          contact_name?: string | null
          contact_type?: string | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          direction?: string | null
          id?: string
          inspection_id?: string | null
          job_id?: string | null
          linked_to?: string | null
          parse_confidence?: string | null
          persona?: string | null
          requires_action?: boolean | null
          subject?: string | null
          tenant_id?: string
          type?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communications_action_queue_id_fkey"
            columns: ["action_queue_id"]
            isOneToOne: false
            referencedRelation: "action_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "communications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_template: string | null
          client_id: string | null
          created_at: string | null
          id: string
          is_default: boolean | null
          name: string
          send_type: string
          subject_template: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          body_template?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          send_type: string
          subject_template?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          body_template?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          send_type?: string
          subject_template?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          access_notes: string | null
          booking_confirmed_at: string | null
          calendar_event_id: string | null
          created_at: string | null
          field_draft: Json | null
          form_submitted_at: string | null
          id: string
          inspection_ref: string | null
          inspector_id: string | null
          insured_notified: boolean | null
          job_id: string
          last_no_show_at: string | null
          no_show_count: number | null
          no_show_notes: string | null
          notes: string | null
          person_met: string | null
          photos_status: string | null
          quote_id: string | null
          report_id: string | null
          report_status: string | null
          safety_confirmed_at: string | null
          scheduled_date: string | null
          scheduled_time: string | null
          scheduling_sms_response: string | null
          scheduling_sms_sent_at: string | null
          scope_status: string | null
          send_checklist: Json | null
          status: string | null
          tenant_id: string
        }
        Insert: {
          access_notes?: string | null
          booking_confirmed_at?: string | null
          calendar_event_id?: string | null
          created_at?: string | null
          field_draft?: Json | null
          form_submitted_at?: string | null
          id?: string
          inspection_ref?: string | null
          inspector_id?: string | null
          insured_notified?: boolean | null
          job_id: string
          last_no_show_at?: string | null
          no_show_count?: number | null
          no_show_notes?: string | null
          notes?: string | null
          person_met?: string | null
          photos_status?: string | null
          quote_id?: string | null
          report_id?: string | null
          report_status?: string | null
          safety_confirmed_at?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          scheduling_sms_response?: string | null
          scheduling_sms_sent_at?: string | null
          scope_status?: string | null
          send_checklist?: Json | null
          status?: string | null
          tenant_id: string
        }
        Update: {
          access_notes?: string | null
          booking_confirmed_at?: string | null
          calendar_event_id?: string | null
          created_at?: string | null
          field_draft?: Json | null
          form_submitted_at?: string | null
          id?: string
          inspection_ref?: string | null
          inspector_id?: string | null
          insured_notified?: boolean | null
          job_id?: string
          last_no_show_at?: string | null
          no_show_count?: number | null
          no_show_notes?: string | null
          notes?: string | null
          person_met?: string | null
          photos_status?: string | null
          quote_id?: string | null
          report_id?: string | null
          report_status?: string | null
          safety_confirmed_at?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          scheduling_sms_response?: string | null
          scheduling_sms_sent_at?: string | null
          scope_status?: string | null
          send_checklist?: Json | null
          status?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "inspections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      insurer_orders: {
        Row: {
          additional_contacts: string | null
          adjuster: string | null
          claim_description: string | null
          claim_number: string | null
          client_id: string | null
          created_at: string | null
          date_of_loss: string | null
          entry_method: string | null
          excess_building: number | null
          id: string
          insured_email: string | null
          insured_name: string | null
          insured_phone: string | null
          insurer: string | null
          is_make_safe: boolean | null
          job_id: string | null
          loss_type: string | null
          notes: string | null
          order_ref: string | null
          parse_status: string | null
          property_address: string | null
          raw_email_link: string | null
          special_instructions: string | null
          status: string | null
          sum_insured_building: number | null
          tenant_id: string
          wo_type: string | null
        }
        Insert: {
          additional_contacts?: string | null
          adjuster?: string | null
          claim_description?: string | null
          claim_number?: string | null
          client_id?: string | null
          created_at?: string | null
          date_of_loss?: string | null
          entry_method?: string | null
          excess_building?: number | null
          id?: string
          insured_email?: string | null
          insured_name?: string | null
          insured_phone?: string | null
          insurer?: string | null
          is_make_safe?: boolean | null
          job_id?: string | null
          loss_type?: string | null
          notes?: string | null
          order_ref?: string | null
          parse_status?: string | null
          property_address?: string | null
          raw_email_link?: string | null
          special_instructions?: string | null
          status?: string | null
          sum_insured_building?: number | null
          tenant_id: string
          wo_type?: string | null
        }
        Update: {
          additional_contacts?: string | null
          adjuster?: string | null
          claim_description?: string | null
          claim_number?: string | null
          client_id?: string | null
          created_at?: string | null
          date_of_loss?: string | null
          entry_method?: string | null
          excess_building?: number | null
          id?: string
          insured_email?: string | null
          insured_name?: string | null
          insured_phone?: string | null
          insurer?: string | null
          is_make_safe?: boolean | null
          job_id?: string | null
          loss_type?: string | null
          notes?: string | null
          order_ref?: string | null
          parse_status?: string | null
          property_address?: string | null
          raw_email_link?: string | null
          special_instructions?: string | null
          status?: string | null
          sum_insured_building?: number | null
          tenant_id?: string
          wo_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurer_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "insurer_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_ex_gst: number | null
          amount_inc_gst: number | null
          created_at: string | null
          direction: string
          external_status: string | null
          gst: number | null
          id: string
          invoice_ref: string | null
          invoice_type: string
          issued_date: string | null
          job_id: string
          notes: string | null
          paid_date: string | null
          parse_status: string | null
          report_id: string | null
          status: string | null
          tenant_id: string
          trade_abn: string | null
          trade_id: string | null
          trade_invoice_date: string | null
          trade_invoice_number: string | null
          trade_pdf_storage_path: string | null
          work_order_id: string | null
          xero_invoice_id: string | null
          xero_last_synced_at: string | null
          xero_sync_error: string | null
          xero_sync_status: string | null
        }
        Insert: {
          amount_ex_gst?: number | null
          amount_inc_gst?: number | null
          created_at?: string | null
          direction: string
          external_status?: string | null
          gst?: number | null
          id?: string
          invoice_ref?: string | null
          invoice_type: string
          issued_date?: string | null
          job_id: string
          notes?: string | null
          paid_date?: string | null
          parse_status?: string | null
          report_id?: string | null
          status?: string | null
          tenant_id: string
          trade_abn?: string | null
          trade_id?: string | null
          trade_invoice_date?: string | null
          trade_invoice_number?: string | null
          trade_pdf_storage_path?: string | null
          work_order_id?: string | null
          xero_invoice_id?: string | null
          xero_last_synced_at?: string | null
          xero_sync_error?: string | null
          xero_sync_status?: string | null
        }
        Update: {
          amount_ex_gst?: number | null
          amount_inc_gst?: number | null
          created_at?: string | null
          direction?: string
          external_status?: string | null
          gst?: number | null
          id?: string
          invoice_ref?: string | null
          invoice_type?: string
          issued_date?: string | null
          job_id?: string
          notes?: string | null
          paid_date?: string | null
          parse_status?: string | null
          report_id?: string | null
          status?: string | null
          tenant_id?: string
          trade_abn?: string | null
          trade_id?: string | null
          trade_invoice_date?: string | null
          trade_invoice_number?: string | null
          trade_pdf_storage_path?: string | null
          work_order_id?: string | null
          xero_invoice_id?: string | null
          xero_last_synced_at?: string | null
          xero_sync_error?: string | null
          xero_sync_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      job_files: {
        Row: {
          added_by: string | null
          created_at: string | null
          description: string | null
          file_kind: string
          file_name: string
          id: string
          is_system_generated: boolean | null
          job_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string | null
          description?: string | null
          file_kind: string
          file_name: string
          id?: string
          is_system_generated?: boolean | null
          job_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string | null
          description?: string | null
          file_kind?: string
          file_name?: string
          id?: string
          is_system_generated?: boolean | null
          job_id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_files_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_flags: {
        Row: {
          created_at: string | null
          id: string
          job_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      job_notes: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_pinned: boolean | null
          job_id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_pinned?: boolean | null
          job_id: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_pinned?: boolean | null
          job_id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_schedule_blueprints: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          draft_data: Json | null
          id: string
          job_id: string
          notes: string | null
          status: string | null
          tenant_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          draft_data?: Json | null
          id?: string
          job_id: string
          notes?: string | null
          status?: string | null
          tenant_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          draft_data?: Json | null
          id?: string
          job_id?: string
          notes?: string | null
          status?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_schedule_blueprints_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_schedule_blueprints_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_schedule_blueprints_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_schedule_blueprints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          additional_contacts: string | null
          adjuster: string | null
          assigned_to: string | null
          automation_overrides: Json | null
          claim_description: string | null
          claim_number: string | null
          client_id: string | null
          completion_approved_at: string | null
          completion_approved_method: string | null
          completion_approved_notes: string | null
          created_at: string | null
          current_stage: string | null
          current_stage_updated_at: string | null
          date_of_loss: string | null
          excess: number | null
          homeowner_signoff_method: string | null
          homeowner_signoff_notes: string | null
          homeowner_signoff_received_at: string | null
          homeowner_signoff_sent_at: string | null
          id: string
          insured_email: string | null
          insured_name: string | null
          insured_phone: string | null
          insurer: string | null
          job_number: string
          kpi_booked_at: string | null
          kpi_booking_due: string | null
          kpi_contact_due: string | null
          kpi_contacted_at: string | null
          kpi_report_due: string | null
          kpi_reported_at: string | null
          kpi_visit_due: string | null
          kpi_visited_at: string | null
          loss_type: string | null
          notes: string | null
          override_stage: string | null
          property_address: string | null
          property_details: Json | null
          special_instructions: string | null
          sum_insured: number | null
          tenant_id: string
        }
        Insert: {
          additional_contacts?: string | null
          adjuster?: string | null
          assigned_to?: string | null
          automation_overrides?: Json | null
          claim_description?: string | null
          claim_number?: string | null
          client_id?: string | null
          completion_approved_at?: string | null
          completion_approved_method?: string | null
          completion_approved_notes?: string | null
          created_at?: string | null
          current_stage?: string | null
          current_stage_updated_at?: string | null
          date_of_loss?: string | null
          excess?: number | null
          homeowner_signoff_method?: string | null
          homeowner_signoff_notes?: string | null
          homeowner_signoff_received_at?: string | null
          homeowner_signoff_sent_at?: string | null
          id?: string
          insured_email?: string | null
          insured_name?: string | null
          insured_phone?: string | null
          insurer?: string | null
          job_number: string
          kpi_booked_at?: string | null
          kpi_booking_due?: string | null
          kpi_contact_due?: string | null
          kpi_contacted_at?: string | null
          kpi_report_due?: string | null
          kpi_reported_at?: string | null
          kpi_visit_due?: string | null
          kpi_visited_at?: string | null
          loss_type?: string | null
          notes?: string | null
          override_stage?: string | null
          property_address?: string | null
          property_details?: Json | null
          special_instructions?: string | null
          sum_insured?: number | null
          tenant_id: string
        }
        Update: {
          additional_contacts?: string | null
          adjuster?: string | null
          assigned_to?: string | null
          automation_overrides?: Json | null
          claim_description?: string | null
          claim_number?: string | null
          client_id?: string | null
          completion_approved_at?: string | null
          completion_approved_method?: string | null
          completion_approved_notes?: string | null
          created_at?: string | null
          current_stage?: string | null
          current_stage_updated_at?: string | null
          date_of_loss?: string | null
          excess?: number | null
          homeowner_signoff_method?: string | null
          homeowner_signoff_notes?: string | null
          homeowner_signoff_received_at?: string | null
          homeowner_signoff_sent_at?: string | null
          id?: string
          insured_email?: string | null
          insured_name?: string | null
          insured_phone?: string | null
          insurer?: string | null
          job_number?: string
          kpi_booked_at?: string | null
          kpi_booking_due?: string | null
          kpi_contact_due?: string | null
          kpi_contacted_at?: string | null
          kpi_report_due?: string | null
          kpi_reported_at?: string | null
          kpi_visit_due?: string | null
          kpi_visited_at?: string | null
          loss_type?: string | null
          notes?: string | null
          override_stage?: string | null
          property_address?: string | null
          property_details?: Json | null
          special_instructions?: string | null
          sum_insured?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          file_name: string | null
          id: string
          inspection_id: string | null
          job_id: string
          label: string | null
          mime_type: string | null
          report_code: string | null
          sequence_number: number | null
          size_bytes: number | null
          storage_path: string
          tenant_id: string
          uploaded_at: string | null
        }
        Insert: {
          file_name?: string | null
          id?: string
          inspection_id?: string | null
          job_id: string
          label?: string | null
          mime_type?: string | null
          report_code?: string | null
          sequence_number?: number | null
          size_bytes?: number | null
          storage_path: string
          tenant_id: string
          uploaded_at?: string | null
        }
        Update: {
          file_name?: string | null
          id?: string
          inspection_id?: string | null
          job_id?: string
          label?: string | null
          mime_type?: string | null
          report_code?: string | null
          sequence_number?: number | null
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_tokens: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          revoked_at: string | null
          tenant_id: string
          token: string
          work_order_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          revoked_at?: string | null
          tenant_id: string
          token: string
          work_order_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          revoked_at?: string | null
          tenant_id?: string
          token?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_tokens_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          category: string
          created_at: string | null
          id: string
          key: string
          name: string
          notes: string | null
          previous_prompt: string | null
          report_type: string | null
          system_prompt: string
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          key: string
          name: string
          notes?: string | null
          previous_prompt?: string | null
          report_type?: string | null
          system_prompt: string
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          key?: string
          name?: string
          notes?: string | null
          previous_prompt?: string | null
          report_type?: string | null
          system_prompt?: string
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_note_templates: {
        Row: {
          content: string
          created_at: string | null
          id: string
          sort_order: number | null
          tenant_id: string
          title: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          sort_order?: number | null
          tenant_id: string
          title: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          sort_order?: number | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_note_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          approval_notes: string | null
          approved_amount: number | null
          created_at: string | null
          doc_storage_path: string | null
          gst_pct: number | null
          id: string
          inspection_id: string | null
          is_active_version: boolean | null
          is_locked: boolean | null
          job_id: string
          markup_pct: number | null
          notes: string | null
          parent_quote_id: string | null
          pdf_storage_path: string | null
          permit_block_dismissed: boolean | null
          quote_ref: string | null
          quote_type: string | null
          raw_scope_notes: string | null
          report_id: string | null
          room_order: string[] | null
          status: string | null
          tenant_id: string
          total_amount: number | null
          version: number | null
        }
        Insert: {
          approval_notes?: string | null
          approved_amount?: number | null
          created_at?: string | null
          doc_storage_path?: string | null
          gst_pct?: number | null
          id?: string
          inspection_id?: string | null
          is_active_version?: boolean | null
          is_locked?: boolean | null
          job_id: string
          markup_pct?: number | null
          notes?: string | null
          parent_quote_id?: string | null
          pdf_storage_path?: string | null
          permit_block_dismissed?: boolean | null
          quote_ref?: string | null
          quote_type?: string | null
          raw_scope_notes?: string | null
          report_id?: string | null
          room_order?: string[] | null
          status?: string | null
          tenant_id: string
          total_amount?: number | null
          version?: number | null
        }
        Update: {
          approval_notes?: string | null
          approved_amount?: number | null
          created_at?: string | null
          doc_storage_path?: string | null
          gst_pct?: number | null
          id?: string
          inspection_id?: string | null
          is_active_version?: boolean | null
          is_locked?: boolean | null
          job_id?: string
          markup_pct?: number | null
          notes?: string | null
          parent_quote_id?: string | null
          pdf_storage_path?: string | null
          permit_block_dismissed?: boolean | null
          quote_ref?: string | null
          quote_type?: string | null
          raw_scope_notes?: string | null
          report_id?: string | null
          room_order?: string[] | null
          status?: string | null
          tenant_id?: string
          total_amount?: number | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_parent_quote_id_fkey"
            columns: ["parent_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_config: {
        Row: {
          gst_pct: number | null
          id: string
          margin_pct: number | null
          min_charge: number | null
          notes: string | null
          report_type: string
          standard_charge: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          gst_pct?: number | null
          id?: string
          margin_pct?: number | null
          min_charge?: number | null
          notes?: string | null
          report_type: string
          standard_charge?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          gst_pct?: number | null
          id?: string
          margin_pct?: number | null
          min_charge?: number | null
          notes?: string | null
          report_type?: string
          standard_charge?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          created_at: string | null
          id: string
          last_used_at: string | null
          loss_types: string[] | null
          name: string
          report_type: string
          tenant_id: string
          use_count: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          loss_types?: string[] | null
          name: string
          report_type: string
          tenant_id: string
          use_count?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          loss_types?: string[] | null
          name?: string
          report_type?: string
          tenant_id?: string
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      report_versions: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          changed_fields: string[] | null
          id: string
          report_id: string
          snapshot: Json
          tenant_id: string
          version_number: number
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          report_id: string
          snapshot: Json
          tenant_id: string
          version_number: number
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          report_id?: string
          snapshot?: Json
          tenant_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_versions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          assessor_name: string | null
          attendance_date: string | null
          attendance_time: string | null
          cause_of_damage: string | null
          claim_number: string | null
          conclusion: string | null
          created_at: string | null
          damage_template: string | null
          damage_template_saved: boolean | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          doc_storage_path: string | null
          how_damage_occurred: string | null
          id: string
          incident_description: string | null
          inspection_id: string | null
          insured_name: string | null
          is_locked: boolean | null
          job_id: string
          loss_type: string | null
          maintenance_notes: string | null
          parent_report_id: string | null
          pdf_storage_path: string | null
          person_met: string | null
          pre_existing_conditions: string | null
          property_address: string | null
          property_description: string | null
          quote_id: string | null
          raw_report_dump: string | null
          report_ref: string | null
          report_type: string
          resulting_damage: string | null
          status: string | null
          tenant_id: string
          type_specific_fields: Json | null
          version: number | null
        }
        Insert: {
          assessor_name?: string | null
          attendance_date?: string | null
          attendance_time?: string | null
          cause_of_damage?: string | null
          claim_number?: string | null
          conclusion?: string | null
          created_at?: string | null
          damage_template?: string | null
          damage_template_saved?: boolean | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          doc_storage_path?: string | null
          how_damage_occurred?: string | null
          id?: string
          incident_description?: string | null
          inspection_id?: string | null
          insured_name?: string | null
          is_locked?: boolean | null
          job_id: string
          loss_type?: string | null
          maintenance_notes?: string | null
          parent_report_id?: string | null
          pdf_storage_path?: string | null
          person_met?: string | null
          pre_existing_conditions?: string | null
          property_address?: string | null
          property_description?: string | null
          quote_id?: string | null
          raw_report_dump?: string | null
          report_ref?: string | null
          report_type: string
          resulting_damage?: string | null
          status?: string | null
          tenant_id: string
          type_specific_fields?: Json | null
          version?: number | null
        }
        Update: {
          assessor_name?: string | null
          attendance_date?: string | null
          attendance_time?: string | null
          cause_of_damage?: string | null
          claim_number?: string | null
          conclusion?: string | null
          created_at?: string | null
          damage_template?: string | null
          damage_template_saved?: boolean | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          doc_storage_path?: string | null
          how_damage_occurred?: string | null
          id?: string
          incident_description?: string | null
          inspection_id?: string | null
          insured_name?: string | null
          is_locked?: boolean | null
          job_id?: string
          loss_type?: string | null
          maintenance_notes?: string | null
          parent_report_id?: string | null
          pdf_storage_path?: string | null
          person_met?: string | null
          pre_existing_conditions?: string | null
          property_address?: string | null
          property_description?: string | null
          quote_id?: string | null
          raw_report_dump?: string | null
          report_ref?: string | null
          report_type?: string
          resulting_damage?: string | null
          status?: string | null
          tenant_id?: string
          type_specific_fields?: Json | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_parent_report_id_fkey"
            columns: ["parent_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_records: {
        Row: {
          asbestos_risk: boolean | null
          confirmed_at: string | null
          created_at: string | null
          custom_notes: string | null
          date: string | null
          hazards_noted: string | null
          id: string
          inspection_id: string | null
          inspector_id: string | null
          job_id: string
          lone_worker_checkin_active: boolean | null
          lone_worker_checkin_interval_mins: number | null
          nearest_hospital: string | null
          pdf_storage_path: string | null
          ppe_confirmed: boolean | null
          roof_access: boolean | null
          signature_data: string | null
          signed_by: string | null
          status: string | null
          structural_ok: boolean | null
          tenant_id: string
          type: string | null
        }
        Insert: {
          asbestos_risk?: boolean | null
          confirmed_at?: string | null
          created_at?: string | null
          custom_notes?: string | null
          date?: string | null
          hazards_noted?: string | null
          id?: string
          inspection_id?: string | null
          inspector_id?: string | null
          job_id: string
          lone_worker_checkin_active?: boolean | null
          lone_worker_checkin_interval_mins?: number | null
          nearest_hospital?: string | null
          pdf_storage_path?: string | null
          ppe_confirmed?: boolean | null
          roof_access?: boolean | null
          signature_data?: string | null
          signed_by?: string | null
          status?: string | null
          structural_ok?: boolean | null
          tenant_id: string
          type?: string | null
        }
        Update: {
          asbestos_risk?: boolean | null
          confirmed_at?: string | null
          created_at?: string | null
          custom_notes?: string | null
          date?: string | null
          hazards_noted?: string | null
          id?: string
          inspection_id?: string | null
          inspector_id?: string | null
          job_id?: string
          lone_worker_checkin_active?: boolean | null
          lone_worker_checkin_interval_mins?: number | null
          nearest_hospital?: string | null
          pdf_storage_path?: string | null
          ppe_confirmed?: boolean | null
          roof_access?: boolean | null
          signature_data?: string | null
          signed_by?: string | null
          status?: string | null
          structural_ok?: boolean | null
          tenant_id?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_records_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_records_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "safety_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_items: {
        Row: {
          approval_status: string | null
          created_at: string | null
          estimated_hours: number | null
          id: string
          is_custom: boolean | null
          item_description: string | null
          item_type: string | null
          keyword: string | null
          library_writeback_approved: boolean | null
          line_total: number | null
          preliminary_formula: string | null
          qty: number | null
          quote_id: string
          rate_labour: number | null
          rate_materials: number | null
          rate_total: number | null
          room: string | null
          room_height: number | null
          room_length: number | null
          room_width: number | null
          scope_library_id: string | null
          sort_order: number | null
          split_type: string | null
          tenant_id: string
          trade: string | null
          unit: string | null
        }
        Insert: {
          approval_status?: string | null
          created_at?: string | null
          estimated_hours?: number | null
          id?: string
          is_custom?: boolean | null
          item_description?: string | null
          item_type?: string | null
          keyword?: string | null
          library_writeback_approved?: boolean | null
          line_total?: number | null
          preliminary_formula?: string | null
          qty?: number | null
          quote_id: string
          rate_labour?: number | null
          rate_materials?: number | null
          rate_total?: number | null
          room?: string | null
          room_height?: number | null
          room_length?: number | null
          room_width?: number | null
          scope_library_id?: string | null
          sort_order?: number | null
          split_type?: string | null
          tenant_id: string
          trade?: string | null
          unit?: string | null
        }
        Update: {
          approval_status?: string | null
          created_at?: string | null
          estimated_hours?: number | null
          id?: string
          is_custom?: boolean | null
          item_description?: string | null
          item_type?: string | null
          keyword?: string | null
          library_writeback_approved?: boolean | null
          line_total?: number | null
          preliminary_formula?: string | null
          qty?: number | null
          quote_id?: string
          rate_labour?: number | null
          rate_materials?: number | null
          rate_total?: number | null
          room?: string | null
          room_height?: number | null
          room_length?: number | null
          room_width?: number | null
          scope_library_id?: string | null
          sort_order?: number | null
          split_type?: string | null
          tenant_id?: string
          trade?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scope_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_items_scope_library_id_fkey"
            columns: ["scope_library_id"]
            isOneToOne: false
            referencedRelation: "scope_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_library: {
        Row: {
          approval_status: string | null
          estimated_hours: number | null
          estimated_hours_overridden: boolean | null
          id: string
          insurer_specific: string | null
          item_description: string | null
          keyword: string | null
          labour_per_unit: number | null
          labour_rate_per_hour: number | null
          materials_per_unit: number | null
          pair_id: string | null
          split_type: string | null
          tenant_id: string
          total_per_unit: number | null
          trade: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          approval_status?: string | null
          estimated_hours?: number | null
          estimated_hours_overridden?: boolean | null
          id?: string
          insurer_specific?: string | null
          item_description?: string | null
          keyword?: string | null
          labour_per_unit?: number | null
          labour_rate_per_hour?: number | null
          materials_per_unit?: number | null
          pair_id?: string | null
          split_type?: string | null
          tenant_id: string
          total_per_unit?: number | null
          trade?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          approval_status?: string | null
          estimated_hours?: number | null
          estimated_hours_overridden?: boolean | null
          id?: string
          insurer_specific?: string | null
          item_description?: string | null
          keyword?: string | null
          labour_per_unit?: number | null
          labour_rate_per_hour?: number | null
          materials_per_unit?: number | null
          pair_id?: string | null
          split_type?: string | null
          tenant_id?: string
          total_per_unit?: number | null
          trade?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scope_library_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_library_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          id: string
          scope_library_id: string
          snapshot: Json
          tenant_id: string
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          scope_library_id: string
          snapshot: Json
          tenant_id: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          scope_library_id?: string
          snapshot?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scope_library_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_library_history_scope_library_id_fkey"
            columns: ["scope_library_id"]
            isOneToOne: false
            referencedRelation: "scope_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_library_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          job_prefix: string
          job_sequence: number | null
          logo_storage_path: string | null
          name: string
          plan: string | null
          slug: string
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          job_prefix: string
          job_sequence?: number | null
          logo_storage_path?: string | null
          name: string
          plan?: string | null
          slug: string
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          job_prefix?: string
          job_sequence?: number | null
          logo_storage_path?: string | null
          name?: string
          plan?: string | null
          slug?: string
        }
        Relationships: []
      }
      trade_type_sequence: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          tenant_id: string
          trade_type: string
          typical_sequence_order: number | null
          typical_visit_count: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          tenant_id: string
          trade_type: string
          typical_sequence_order?: number | null
          typical_visit_count?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          tenant_id?: string
          trade_type?: string
          typical_sequence_order?: number | null
          typical_visit_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_type_sequence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          abn: string | null
          address: string | null
          business_name: string | null
          can_do_make_safe: boolean | null
          can_do_reports: boolean | null
          contact_email: string | null
          contact_mobile: string | null
          contact_office: string | null
          created_at: string | null
          entity_name: string | null
          gary_contact_preference: string | null
          gary_notes: string | null
          gary_opt_out: boolean | null
          id: string
          makesafe_priority: number | null
          notes: string | null
          primary_contact: string | null
          primary_trade: string | null
          status: string | null
          status_note: string | null
          tenant_id: string
          trade_code: string | null
        }
        Insert: {
          abn?: string | null
          address?: string | null
          business_name?: string | null
          can_do_make_safe?: boolean | null
          can_do_reports?: boolean | null
          contact_email?: string | null
          contact_mobile?: string | null
          contact_office?: string | null
          created_at?: string | null
          entity_name?: string | null
          gary_contact_preference?: string | null
          gary_notes?: string | null
          gary_opt_out?: boolean | null
          id?: string
          makesafe_priority?: number | null
          notes?: string | null
          primary_contact?: string | null
          primary_trade?: string | null
          status?: string | null
          status_note?: string | null
          tenant_id: string
          trade_code?: string | null
        }
        Update: {
          abn?: string | null
          address?: string | null
          business_name?: string | null
          can_do_make_safe?: boolean | null
          can_do_reports?: boolean | null
          contact_email?: string | null
          contact_mobile?: string | null
          contact_office?: string | null
          created_at?: string | null
          entity_name?: string | null
          gary_contact_preference?: string | null
          gary_notes?: string | null
          gary_opt_out?: boolean | null
          id?: string
          makesafe_priority?: number | null
          notes?: string | null
          primary_contact?: string | null
          primary_trade?: string | null
          status?: string | null
          status_note?: string | null
          tenant_id?: string
          trade_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trades_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          address: string | null
          can_approve_invoices: boolean | null
          can_edit_settings: boolean | null
          can_manage_scope_library: boolean | null
          can_send_to_insurer: boolean | null
          can_view_financials: boolean | null
          created_at: string | null
          id: string
          is_emergency_contact: boolean | null
          makesafe_available: boolean | null
          name: string
          phone: string | null
          role: string
          tenant_id: string
        }
        Insert: {
          address?: string | null
          can_approve_invoices?: boolean | null
          can_edit_settings?: boolean | null
          can_manage_scope_library?: boolean | null
          can_send_to_insurer?: boolean | null
          can_view_financials?: boolean | null
          created_at?: string | null
          id: string
          is_emergency_contact?: boolean | null
          makesafe_available?: boolean | null
          name: string
          phone?: string | null
          role: string
          tenant_id: string
        }
        Update: {
          address?: string | null
          can_approve_invoices?: boolean | null
          can_edit_settings?: boolean | null
          can_manage_scope_library?: boolean | null
          can_send_to_insurer?: boolean | null
          can_view_financials?: boolean | null
          created_at?: string | null
          id?: string
          is_emergency_contact?: boolean | null
          makesafe_available?: boolean | null
          name?: string
          phone?: string | null
          role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_visits: {
        Row: {
          confirmed_date: string | null
          created_at: string | null
          estimated_hours: number | null
          gary_return_trigger_at: string | null
          gary_triggered_at: string | null
          id: string
          job_id: string
          lag_days_after: number | null
          lag_description: string | null
          notes: string | null
          scheduled_date: string | null
          scheduled_end_date: string | null
          status: string | null
          tenant_id: string
          trade_confirmed_at: string | null
          visit_number: number
          work_order_id: string
        }
        Insert: {
          confirmed_date?: string | null
          created_at?: string | null
          estimated_hours?: number | null
          gary_return_trigger_at?: string | null
          gary_triggered_at?: string | null
          id?: string
          job_id: string
          lag_days_after?: number | null
          lag_description?: string | null
          notes?: string | null
          scheduled_date?: string | null
          scheduled_end_date?: string | null
          status?: string | null
          tenant_id: string
          trade_confirmed_at?: string | null
          visit_number: number
          work_order_id: string
        }
        Update: {
          confirmed_date?: string | null
          created_at?: string | null
          estimated_hours?: number | null
          gary_return_trigger_at?: string | null
          gary_triggered_at?: string | null
          id?: string
          job_id?: string
          lag_days_after?: number | null
          lag_description?: string | null
          notes?: string | null
          scheduled_date?: string | null
          scheduled_end_date?: string | null
          status?: string | null
          tenant_id?: string
          trade_confirmed_at?: string | null
          visit_number?: number
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_visits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "work_order_visits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_visits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_visits_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          agreed_amount: number | null
          blueprint_id: string | null
          charge_out_amount: number | null
          created_at: string | null
          current_visit: number | null
          estimated_hours: number | null
          gary_state: string | null
          id: string
          is_concurrent: boolean | null
          job_id: string
          notes: string | null
          predecessor_work_order_id: string | null
          proximity_range: string | null
          quote_id: string | null
          report_id: string | null
          scheduled_date: string | null
          scope_summary: string | null
          sequence_order: number | null
          status: string | null
          tenant_id: string
          total_visits: number | null
          trade_cost: number | null
          trade_id: string | null
          work_type: string | null
        }
        Insert: {
          agreed_amount?: number | null
          blueprint_id?: string | null
          charge_out_amount?: number | null
          created_at?: string | null
          current_visit?: number | null
          estimated_hours?: number | null
          gary_state?: string | null
          id?: string
          is_concurrent?: boolean | null
          job_id: string
          notes?: string | null
          predecessor_work_order_id?: string | null
          proximity_range?: string | null
          quote_id?: string | null
          report_id?: string | null
          scheduled_date?: string | null
          scope_summary?: string | null
          sequence_order?: number | null
          status?: string | null
          tenant_id: string
          total_visits?: number | null
          trade_cost?: number | null
          trade_id?: string | null
          work_type?: string | null
        }
        Update: {
          agreed_amount?: number | null
          blueprint_id?: string | null
          charge_out_amount?: number | null
          created_at?: string | null
          current_visit?: number | null
          estimated_hours?: number | null
          gary_state?: string | null
          id?: string
          is_concurrent?: boolean | null
          job_id?: string
          notes?: string | null
          predecessor_work_order_id?: string | null
          proximity_range?: string | null
          quote_id?: string | null
          report_id?: string | null
          scheduled_date?: string | null
          scope_summary?: string | null
          sequence_order?: number | null
          status?: string | null
          tenant_id?: string
          total_visits?: number | null
          trade_cost?: number | null
          trade_id?: string | null
          work_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "job_schedule_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_margin_summary"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "work_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_predecessor_work_order_id_fkey"
            columns: ["predecessor_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          preference_key: string
          preference_value: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          preference_key: string
          preference_value?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          preference_key?: string
          preference_value?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      job_margin_summary: {
        Row: {
          approved_quote_total: number | null
          gross_margin_ex_gst: number | null
          insured_name: string | null
          job_id: string | null
          job_number: string | null
          tenant_id: string | null
          total_invoiced_ex_gst: number | null
          total_trade_cost_ex_gst: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      generate_job_number: { Args: { p_tenant_id: string }; Returns: string }
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
