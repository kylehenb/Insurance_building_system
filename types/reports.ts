export interface ReportTemplate {
  id: string
  tenant_id: string
  name: string
  report_type: string
  loss_types: string[] | null
  use_count: number
  last_used_at: string | null
  created_at: string
}
