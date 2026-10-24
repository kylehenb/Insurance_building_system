import type Anthropic from '@anthropic-ai/sdk'
import { LOSS_TYPES_PROMPT_LIST } from '@/lib/loss-types'
import { callTool, type McpContext, type McpTool } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'

// The in-app assistant (floating chat and dashboard chat). Claude with the
// voice connector's tools, run as the signed-in user through the same
// callTool path — same permissions, approvals and who-did-what log — plus a
// read-only lookup for anything the tools don't cover. Tech spec §10b.

type MessageParam = Anthropic.Beta.BetaMessageParam
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam

/** Haiku by default; AI_ASSISTANT_MODEL overrides it (e.g. claude-sonnet-5-5 for harder questions) */
export const ASSISTANT_MODEL = process.env.AI_ASSISTANT_MODEL || 'claude-haiku-5-5'

/** Model calls per user message before the assistant has to answer */
const MAX_STEPS = 15

// Tables the lookup tool can read, always within the user's own tenant
const READABLE_TABLES = [
  'jobs', 'quotes', 'scope_items', 'reports', 'inspections',
  'clients', 'insurer_orders', 'trades', 'work_orders', 'work_order_visits',
  'action_queue', 'communications', 'photos', 'safety_records',
  'scope_library', 'report_templates', 'trade_type_sequence',
  'job_schedule_blueprints', 'users', 'tenants', 'assistant_templates',
]

const SCHEMA_REFERENCE = `
Tables and columns for read_records (read-only — changes go through the other tools).

loss_type (on jobs, reports and insurer_orders) must be exactly one of: ${LOSS_TYPES_PROMPT_LIST} — or null.

jobs: id, tenant_id, job_number, claim_number, client_id, insurer, adjuster, property_address, insured_name, insured_phone, insured_email, contacts (JSONB array of JobContact objects), adjuster_reference, order_sender_name, order_sender_email, date_of_loss, loss_type, claim_description, special_instructions, sum_insured, excess, assigned_to, status, kpi_contact_due, kpi_booking_due, kpi_visit_due, kpi_report_due, kpi_contacted_at, kpi_booked_at, kpi_visited_at, kpi_reported_at, notes, automation_overrides, created_at

reports: id, tenant_id, job_id, inspection_id, quote_id, parent_report_id, report_ref, version, is_locked, report_type, status, attendance_date, attendance_time, person_met, property_address, insured_name, claim_number, loss_type, assessor_name, property_description, incident_description, cause_of_damage, how_damage_occurred, resulting_damage, conclusion, pre_existing_conditions, maintenance_notes, raw_report_notes, damage_template, damage_template_saved, type_specific_fields, doc_storage_path, pdf_storage_path, deleted_at, deleted_by, delete_reason, created_at

quotes: id, tenant_id, job_id, inspection_id, report_id, parent_quote_id, quote_ref, quote_type, version, is_active_version, is_locked, status, approved_amount, approval_notes, raw_scope_notes, total_amount, markup_pct, gst_pct, doc_storage_path, pdf_storage_path, notes, created_at

scope_items: id, tenant_id, quote_id, scope_library_id, room, room_length, room_width, room_height, trade, keyword, item_description, unit, qty, rate_labour, rate_materials, rate_total, line_total, split_type, approval_status, is_custom, library_writeback_approved, sort_order, created_at
NOTE: scope_items links to quotes via quote_id, NOT job_id directly.

inspections: id, tenant_id, job_id, quote_id, report_id, inspection_ref, scheduled_date, start_time, finish_time, inspector_id, status, insured_notified, scheduling_sms_sent_at, scheduling_sms_response, booking_confirmed_at, access_notes, calendar_event_id, field_draft, form_submitted_at, safety_confirmed_at, person_met, scope_status, report_status, photos_status, send_checklist, raw_report_notes, created_at

clients: id, tenant_id, client_type, parent_id, name, trading_name, abn, submission_email, adjuster_submission_email, contact_phone, address, kpi_contact_hours, kpi_booking_hours, kpi_visit_days, kpi_report_days, send_booking_confirmation, notes, status, created_at

insurer_orders: id, tenant_id, job_id, client_id, order_ref, status, claim_number, insurer, adjuster, wo_type, is_make_safe, property_address, insured_name, insured_phone, insured_email, contacts (JSONB array of JobContact objects), adjuster_reference, order_sender_name, order_sender_email, date_of_loss, loss_type, claim_description, special_instructions, sum_insured_building, excess_building, raw_email_link, parse_status, entry_method, notes, created_at

trades: id, tenant_id, primary_trade, trade_code, business_name, entity_name, abn, primary_contact, address, lat, lng, contact_email, contact_mobile, contact_office, can_do_make_safe, makesafe_priority, can_do_reports, availability, priority_rank (star rating: 1=lowest priority, 5=highest priority), service_area (array of service area options, e.g., ["30kms radius"]), gary_opt_out, gary_contact_preference, gary_notes, status, status_note, notes, created_at

work_orders: id, tenant_id, job_id, quote_id, trade_id, report_id, blueprint_id, work_type, status, sequence_order, is_concurrent, predecessor_work_order_id, estimated_hours, total_visits, current_visit, proximity_range, gary_state, scope_summary, trade_cost, charge_out_amount, agreed_amount, notes, created_at

work_order_visits: id, tenant_id, work_order_id, job_id, visit_number, estimated_hours, scheduled_date, scheduled_end_date, confirmed_date, status, lag_days_after, lag_description, gary_triggered_at, gary_return_trigger_at, trade_confirmed_at, notes, created_at

action_queue: id, tenant_id, job_id, rule_key, title, description, ai_draft, status, priority (number: 0=low 1=medium 2=high), snoozed_until, confirmed_by, confirmed_at, error_log, created_at

communications: id, tenant_id, job_id, inspection_id, work_order_id, type, direction, contact_type, contact_name, contact_detail, subject, content, attachments, ai_extracted_notes, requires_action, action_queue_id, persona, parse_confidence, linked_to, created_by, created_at

photos: id, tenant_id, job_id, inspection_id, storage_path, label, report_code, sequence_number, file_name, mime_type, size_bytes, uploaded_at

safety_records: id, tenant_id, job_id, inspection_id, type, inspector_id, confirmed_at, date, status, signed_by, nearest_hospital, ppe_confirmed, hazards_noted, custom_notes, roof_access, structural_ok, asbestos_risk, lone_worker_checkin_active, lone_worker_checkin_interval_mins, signature_data, pdf_storage_path, created_at

scope_library: id, tenant_id, insurer_specific, pair_id, split_type, trade, keyword, item_description, unit, labour_rate_per_hour, labour_per_unit, materials_per_unit, total_per_unit, estimated_hours, has_lag, lag_days, lag_description, updated_at

report_templates: id, tenant_id, name, report_type, loss_types, use_count, last_used_at, created_at

trade_type_sequence: id, tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes, updated_at, created_at

job_schedule_blueprints: id, tenant_id, job_id, status, draft_data, confirmed_by, confirmed_at, notes, created_at

users: id, tenant_id, name, role, phone, address, is_emergency_contact, makesafe_available, created_at (what each user may do is set in Settings → Users & Permissions, not on this table)

tenants: id, name, slug, job_prefix, job_sequence, plan, contact_email, contact_phone, address, logo_storage_path, created_at
`

export const SYSTEM_PROMPT = `You are the assistant built into IRC Master, the job management system of Insurance Repair Co, a building insurance repair business (storm and water damage, make safes). You help the signed-in user look things up and get work done in the system. Politely decline anything unrelated to the business.

How to work:
- Use the tools to look things up rather than guessing. Prefer the specific tools (get_job_summary, find_work_orders, get_quote, find_line_items, get_invoice, get_report, list_job_emails, …); use read_records only for data they don't cover.
- Before anything that sends an email or changes a record, say briefly what will happen (who it goes to, amounts, what changes) and wait for the user to clearly say yes. Do not ask again once they have confirmed that exact action.
- When a request is ambiguous (which job, which trade, several work orders for the same trade), ask before acting.
- Always pass on warnings a tool returns (no email address, $0 amount, already sent). If a tool says something is waiting for approval, tell the user and don't retry it.
- If a tool fails, say what failed in plain words and stop; don't carry on with later steps.

How to write: the chat shows plain text, so no markdown — no **, #, tables or code blocks. Be short and direct: answers in a few lines, short "-" lists when listing things. Use job numbers, names, amounts and dates, never database ids.

Facts: job numbers look like IRC1008; quote refs like Q1005-1. Sedgwick SLA: BAR reports within 7 calendar days, make safes attended within 24 hours. Times are Perth time (AWST).

${SCHEMA_REFERENCE}`

const READ_RECORDS: Anthropic.Beta.BetaTool = {
  name: 'read_records',
  description: 'Read rows from a table in IRC Master (read-only). For data the other tools don\'t cover, e.g. quotes and scope items, reports, inspections, clients, trades. Filters are exact matches.',
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', enum: READABLE_TABLES },
      filters: { type: 'object', description: 'Column/value pairs to match exactly, e.g. {"job_number": "IRC1008"}.' },
      columns: { type: 'string', description: 'Comma-separated columns to return; "*" for all (the default).' },
      limit: { type: 'number', description: 'Most rows to return (default 20, max 100).' },
    },
    required: ['table'],
  },
}

/** Reads one table, scoped to the tenant (a tenant row is its own id) */
export async function readRecords(input: Record<string, unknown>, ctx: McpContext): Promise<{ text: string; isError?: boolean }> {
  const table = String(input.table ?? '')
  if (!READABLE_TABLES.includes(table)) return { text: `The table "${table}" can't be read here.`, isError: true }
  const columns = typeof input.columns === 'string' && input.columns.trim() ? input.columns : '*'
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100)
  const filters = input.filters && typeof input.filters === 'object' ? input.filters as Record<string, unknown> : {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (ctx.supabase as any).from(table).select(columns).limit(limit)
  for (const [col, val] of Object.entries(filters)) {
    if (col !== 'tenant_id') q = q.eq(col, val)
  }
  q = table === 'tenants' ? q.eq('id', ctx.tenantId) : q.eq('tenant_id', ctx.tenantId)
  const { data, error } = await q
  if (error) return { text: `Couldn't read ${table}: ${error.message}`, isError: true }
  if (!data?.length) return { text: `No rows in ${table} match.` }
  return { text: JSON.stringify(data) }
}

/** The tools Claude sees: every connector tool plus the read-only lookup */
export function assistantTools(tools: McpTool[] = MCP_TOOLS): Anthropic.Beta.BetaTool[] {
  return [
    ...tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema })),
    READ_RECORDS,
  ]
}

async function runTool(block: Anthropic.Beta.BetaToolUseBlock, tools: McpTool[], ctx: McpContext): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const args = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {}
  let text: string
  let isError = false
  if (block.name === READ_RECORDS.name) {
    try {
      const out = await readRecords(args, ctx)
      text = out.text
      isError = !!out.isError
    } catch (err) {
      console.error('[assistant] read_records failed:', err)
      text = 'The lookup hit an unexpected error.'
      isError = true
    }
  } else {
    const tool = tools.find(t => t.name === block.name)
    if (!tool) {
      text = `There is no tool called ${block.name}.`
      isError = true
    } else {
      const out = await callTool(tool, args, ctx)
      // The data carries the ids later calls need
      text = out.data ? `${out.text}\n${JSON.stringify(out.data)}` : out.text
      isError = !!out.isError
    }
  }
  return { type: 'tool_result', tool_use_id: block.id, content: text, is_error: isError }
}

/** Text the user sees from one response */
function replyText(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n\n').trim()
}

export interface AssistantTurn {
  /** What to show the user */
  text: string
  /** The whole conversation so far, to send back with the next message */
  history: MessageParam[]
}

/**
 * Answers one user message: calls Claude, runs the tools it asks for (one at
 * a time — some send emails) and loops until it replies. Only a completed
 * turn comes back, so the history never ends on an unanswered tool call.
 */
export async function runAssistantTurn(params: {
  client: Pick<Anthropic, 'beta'>
  history: MessageParam[]
  userContent: ContentBlockParam[]
  ctx: McpContext
  tools?: McpTool[]
  model?: string
}): Promise<AssistantTurn> {
  const tools = params.tools ?? MCP_TOOLS
  // Tools and the log know it's the assistant, not the voice connector
  const ctx: McpContext = { ...params.ctx, via: 'chat' }
  const model = params.model ?? ASSISTANT_MODEL
  const messages: MessageParam[] = [...params.history, { role: 'user', content: params.userContent }]
  // Server-side fallback when a safety check declines (not offered on Haiku)
  const fallback = model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }

  for (let step = 1; ; step++) {
    const lastStep = step >= MAX_STEPS
    const response = await params.client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: assistantTools(tools),
      // On the last step it has to answer with what it has
      tool_choice: lastStep ? { type: 'none' } : { type: 'auto' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      messages,
      ...fallback,
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)
    messages.push({ role: 'assistant', content: response.content as ContentBlockParam[] })

    if (response.stop_reason === 'pause_turn') continue
    if (response.stop_reason === 'tool_use' && !lastStep) {
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type === 'tool_use') results.push(await runTool(block, tools, ctx))
      }
      messages.push({ role: 'user', content: results })
      continue
    }

    let text = replyText(response.content)
    if (response.stop_reason === 'refusal') text = text || "Sorry, I can't help with that one."
    if (response.stop_reason === 'max_tokens') text = `${text}\n\n(That answer was cut short — ask me to continue.)`.trim()
    return { text: text || 'Done.', history: messages }
  }
}
