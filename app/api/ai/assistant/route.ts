import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Tables that require admin role to write to
const SETTINGS_TABLES = new Set(['tenants', 'users', 'scope_library', 'trade_type_sequence', 'report_templates'])

// All writable tables the AI is allowed to read from
const READABLE_TABLES = new Set([
  'jobs', 'quotes', 'scope_items', 'reports', 'inspections',
  'clients', 'insurer_orders', 'trades', 'work_orders', 'work_order_visits',
  'action_queue', 'communications', 'photos', 'safety_records',
  'scope_library', 'report_templates', 'trade_type_sequence',
  'job_schedule_blueprints', 'users', 'tenants', 'assistant_templates',
])

const SCHEMA_REFERENCE = `
DATABASE SCHEMA REFERENCE — use this to know exactly which table and column names to use in tool calls.

jobs: id, tenant_id, job_number, claim_number, client_id, insurer, adjuster, property_address, insured_name, insured_phone, insured_email, additional_contacts, date_of_loss, loss_type, claim_description, special_instructions, sum_insured, excess, assigned_to, status, kpi_contact_due, kpi_booking_due, kpi_visit_due, kpi_report_due, kpi_contacted_at, kpi_booked_at, kpi_visited_at, kpi_reported_at, notes, automation_overrides, created_at

reports: id, tenant_id, job_id, inspection_id, quote_id, parent_report_id, report_ref, version, is_locked, report_type, status, attendance_date, attendance_time, person_met, property_address, insured_name, claim_number, loss_type, assessor_name, property_description, incident_description, cause_of_damage, how_damage_occurred, resulting_damage, conclusion, pre_existing_conditions, maintenance_notes, raw_report_dump, damage_template, damage_template_saved, type_specific_fields, doc_storage_path, pdf_storage_path, deleted_at, deleted_by, delete_reason, created_at

quotes: id, tenant_id, job_id, inspection_id, report_id, parent_quote_id, quote_ref, quote_type, version, is_active_version, is_locked, status, approved_amount, approval_notes, raw_scope_notes, total_amount, markup_pct, gst_pct, doc_storage_path, pdf_storage_path, notes, created_at

scope_items: id, tenant_id, quote_id, scope_library_id, room, room_length, room_width, room_height, trade, keyword, item_description, unit, qty, rate_labour, rate_materials, rate_total, line_total, split_type, approval_status, is_custom, library_writeback_approved, sort_order, created_at
NOTE: scope_items links to quotes via quote_id, NOT job_id directly.

inspections: id, tenant_id, job_id, quote_id, report_id, inspection_ref, scheduled_date, scheduled_time, inspector_id, status, insured_notified, scheduling_sms_sent_at, scheduling_sms_response, booking_confirmed_at, access_notes, calendar_event_id, field_draft, form_submitted_at, safety_confirmed_at, person_met, scope_status, report_status, photos_status, send_checklist, notes, created_at

clients: id, tenant_id, client_type, parent_id, name, trading_name, abn, submission_email, contact_phone, address, kpi_contact_hours, kpi_booking_hours, kpi_visit_days, kpi_report_days, send_booking_confirmation, notes, status, created_at

insurer_orders: id, tenant_id, job_id, client_id, order_ref, status, claim_number, insurer, adjuster, wo_type, is_make_safe, property_address, insured_name, insured_phone, insured_email, additional_contacts, date_of_loss, loss_type, claim_description, special_instructions, sum_insured_building, excess_building, raw_email_link, parse_status, entry_method, notes, created_at

trades: id, tenant_id, primary_trade, trade_code, business_name, entity_name, abn, primary_contact, address, lat, lng, contact_email, contact_mobile, contact_office, can_do_make_safe, makesafe_priority, can_do_reports, availability, priority_rank, gary_opt_out, gary_contact_preference, gary_notes, status, status_note, notes, created_at

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

users: id, tenant_id, name, role, phone, address, is_emergency_contact, makesafe_available, can_send_to_insurer, can_edit_settings, can_approve_invoices, can_manage_scope_library, can_view_financials, created_at

tenants: id, name, slug, job_prefix, job_sequence, plan, contact_email, contact_phone, address, logo_storage_path, created_at
`

const SYSTEM_PROMPT = `You are an AI assistant for Insurance Repair Co, a building insurance repair business. You only assist with tasks and questions related to running this business and using this system. If asked anything clearly outside this scope, politely decline and redirect the user back to IRC-related topics. Never return raw JSON, code blocks, or technical syntax. When performing or proposing actions: be extremely concise. Present proposed actions as a brief numbered list — one short line per action, no explanation unless critical. After execution, confirm in one sentence or a few words per completed step. No preamble, no summaries, no elaboration. When answering questions: be clear and direct, slightly more detailed than action responses, but still concise — no padding, no restating the question, no closing remarks.

You have full read and write access to the entire IRC database. When answering questions about specific records, use the read_records tool to look up the current data rather than relying only on injected context. When the user asks you to update, create, or delete data, you can do so using the appropriate tools.

The only restriction: modifying tenants, users, scope_library, trade_type_sequence, or report_templates requires the user to be an admin. If the current user is not an admin and requests changes to those tables, politely decline and tell them to contact their administrator.

When the user asks you to take an action that requires a data change, always present the full action plan first as a numbered list in plain English before doing anything. At the end of every action proposal always say exactly: "Reply yes to confirm all, or tell me what you'd like to change."

If the user confirms (e.g., "yes", "go ahead", "sure", "ok", etc.), execute all steps sequentially using the available tools. After each step completes, report back in plain English that it is done before moving to the next. If a step fails, report the failure clearly and stop — do not continue to subsequent steps.

If the user replies with modifications (e.g., "yes but change step 2 to..."), regenerate the full updated action plan in plain English incorporating the requested changes. End the updated plan again with "Reply yes to confirm all, or tell me what you'd like to change." Loop until the user confirms or abandons.

If the user declines or asks for clarification, respond accordingly.

Never execute any data changes without receiving confirmation first. Never partially execute a plan.

Key facts about IRC:
- Sedgwick SLA: BAR reports within 7 calendar days, Make Safes attended within 24 hours
- Job numbers prefixed with IRC (e.g. IRC1008)
- Quote numbers use quote_ref field (e.g. Q1005-1)
- The business handles building insurance repairs: storm damage, water damage, make safes
- Reports have a property_description field for describing the property (roof type, wall construction, condition etc.)
${SCHEMA_REFERENCE}`


const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_records',
      description: 'Read records from any table. Use this to look up current data before proposing changes, or to answer questions about specific records.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name (e.g. jobs, reports, quotes, scope_items, inspections, etc.)' },
          filters: {
            type: 'object',
            description: 'Key-value pairs to filter by (e.g. {"job_id": "abc123", "status": "pending"}). All filters use equality matching.',
          },
          columns: { type: 'string', description: 'Comma-separated list of columns to return. Omit or use "*" for all columns.' },
          limit: { type: 'number', description: 'Maximum number of rows to return. Defaults to 20.' },
        },
        required: ['table'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_record',
      description: 'Update one or more fields on an existing record identified by its id.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          id: { type: 'string', description: 'The UUID of the record to update' },
          fields: { type: 'object', description: 'Key-value pairs of fields to update' },
        },
        required: ['table', 'id', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_record',
      description: 'Insert a new record into a table. tenant_id will be automatically set if not provided.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          fields: { type: 'object', description: 'Key-value pairs for the new record' },
        },
        required: ['table', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_record',
      description: 'Delete a record by its id from a table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          id: { type: 'string', description: 'The UUID of the record to delete' },
        },
        required: ['table', 'id'],
      },
    },
  },
]

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
  isAdmin: boolean,
): Promise<string> {
  const table = input.table as string

  if (table && !READABLE_TABLES.has(table)) {
    return `Error: table "${table}" is not accessible.`
  }

  // Settings tables require admin for writes
  if (name !== 'read_records' && table && SETTINGS_TABLES.has(table) && !isAdmin) {
    return `Permission denied: modifying "${table}" requires admin access. Please contact your administrator.`
  }

  // Use service client to bypass RLS — access control is handled above
  const db = createServiceClient()

  try {
    if (name === 'read_records') {
      const columns = (input.columns as string | undefined) ?? '*'
      const limit = (input.limit as number | undefined) ?? 20
      const filters = (input.filters as Record<string, unknown> | undefined) ?? {}

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (db as any).from(table).select(columns).limit(limit)
      for (const [col, val] of Object.entries(filters)) {
        q = q.eq(col, val)
      }
      // Scope to tenant
      if (!filters['tenant_id']) {
        q = q.eq('tenant_id', tenantId)
      }

      const { data, error } = await q
      if (error) return `Error reading ${table}: ${error.message}`
      if (!data || (Array.isArray(data) && data.length === 0)) return `No records found in ${table} matching those filters.`
      return JSON.stringify(data, null, 2)
    }

    if (name === 'update_record') {
      const { error } = await (db as any)
        .from(table)
        .update(input.fields)
        .eq('id', input.id as string)
      if (error) return `Error updating ${table}: ${error.message}`
      return `Successfully updated record ${input.id} in ${table}.`
    }

    if (name === 'insert_record') {
      const fields = { ...(input.fields as Record<string, unknown>), tenant_id: tenantId }
      
      // Validate required fields for specific tables
      if (table === 'insurer_orders' && !(fields as Record<string, unknown>).claim_number) {
        return `Error: claim_number is required when creating an insurer order. Please provide the claim number from the insurer.`
      }
      
      const { data, error } = await (db as any).from(table).insert(fields).select('id').single()
      if (error) return `Error inserting into ${table}: ${error.message}`
      return `Successfully created new record in ${table} with id ${(data as any)?.id}.`
    }

    if (name === 'delete_record') {
      const { error } = await (db as any)
        .from(table)
        .delete()
        .eq('id', input.id as string)
        .eq('tenant_id', tenantId)
      if (error) return `Error deleting from ${table}: ${error.message}`
      return `Successfully deleted record ${input.id} from ${table}.`
    }

    return `Unknown tool: ${name}`
  } catch (err) {
    return `Error executing tool: ${err instanceof Error ? err.message : String(err)}`
  }
}

function getPageName(pathname: string): string {
  if (pathname === '/dashboard') return 'Dashboard'
  if (pathname.startsWith('/dashboard/jobs')) return 'Jobs'
  if (pathname.startsWith('/dashboard/calendar')) return 'Calendar'
  if (pathname.startsWith('/dashboard/insurer-orders')) return 'Insurer Orders'
  if (pathname.startsWith('/dashboard/clients')) return 'Clients'
  if (pathname.startsWith('/dashboard/scope-library')) return 'Scope Library'
  if (pathname.startsWith('/dashboard/trades')) return 'Trades'
  if (pathname.startsWith('/dashboard/finance')) return 'Finance'
  if (pathname.startsWith('/dashboard/settings')) return 'Settings'
  return pathname.split('/').filter(Boolean).pop() ?? 'Unknown page'
}

async function fetchPageContext(pageContext: string, activeTab?: string): Promise<string> {
  const supabase = await createClient()
  const jobMatch = pageContext.match(/\/dashboard\/jobs\/([^/?#]+)/)

  if (!jobMatch) {
    return `Current page: ${getPageName(pageContext)}`
  }

  const jobId = jobMatch[1]

  try {
    // Quotes tab
    if (activeTab === 'quotes') {
      const { data: quotes } = await supabase
        .from('quotes')
        .select('id, quote_ref, status, total_amount')
        .eq('job_id', jobId)

      const lines: string[] = ['Current page: Job detail — Quotes tab', `Job ID: ${jobId}`]
      if (quotes?.length) {
        const quoteIds = (quotes as any[]).map((q) => q.id as string)
        const { data: scopeItems } = await supabase
          .from('scope_items')
          .select('quote_id, item_description, qty, rate_total, line_total')
          .in('quote_id', quoteIds)
          .limit(50)

        for (const q of quotes as any[]) {
          lines.push(`Quote: ${q.quote_ref}, Status: ${q.status}, Total: $${q.total_amount ?? 0} (ID: ${q.id})`)
        }
        if (scopeItems?.length) {
          lines.push(`Scope items (${scopeItems.length} total):`)
          for (const s of scopeItems as any[]) {
            lines.push(`  - ${s.item_description}: qty ${s.qty}, rate $${s.rate_total}, total $${s.line_total}`)
          }
        }
      }
      return lines.join('\n')
    }

    // Reports tab
    if (activeTab === 'reports') {
      const { data: reports } = await supabase
        .from('reports')
        .select('id, report_ref, report_type, status, property_description, attendance_date, person_met')
        .eq('job_id', jobId)

      const lines: string[] = ['Current page: Job detail — Reports tab', `Job ID: ${jobId}`]
      if (reports?.length) {
        for (const r of reports as any[]) {
          lines.push(`Report: ${r.report_ref ?? r.report_type}, Type: ${r.report_type}, Status: ${r.status} (ID: ${r.id})`)
          if (r.property_description) lines.push(`  Property description: ${r.property_description}`)
          if (r.attendance_date) lines.push(`  Attended: ${r.attendance_date}, Person met: ${r.person_met ?? 'N/A'}`)
        }
      }
      return lines.join('\n')
    }

    // Default job detail page
    const [{ data: job }, { data: quotes }, { data: actions }] = await Promise.all([
      supabase
        .from('jobs')
        .select('job_number, status, property_address, insured_name, insurer, claim_number, loss_type, adjuster, notes')
        .eq('id', jobId)
        .single(),
      supabase
        .from('quotes')
        .select('id, quote_ref, status, total_amount')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('action_queue')
        .select('id, title, priority, status')
        .eq('job_id', jobId)
        .eq('status', 'pending')
        .limit(10),
    ])

    if (!job) return `Current page: Job detail (ID: ${jobId})`

    const j = job as any
    const lines: string[] = [
      `Current page: Job detail`,
      `Job ID: ${jobId}`,
      `Job number: ${j.job_number}`,
      `Status: ${j.status}`,
      `Address: ${j.property_address ?? 'N/A'}`,
      `Insured: ${j.insured_name ?? 'N/A'}`,
      `Insurer: ${j.insurer ?? 'N/A'}`,
      `Claim number: ${j.claim_number ?? 'N/A'}`,
      `Loss type: ${j.loss_type ?? 'N/A'}`,
      `Adjuster: ${j.adjuster ?? 'N/A'}`,
    ]
    if (j.notes) lines.push(`Notes: ${j.notes}`)

    if (quotes?.length) {
      for (const q of quotes as any[]) {
        lines.push(`Quote: ${q.quote_ref}, Status: ${q.status}, Total: $${q.total_amount ?? 0} (ID: ${q.id})`)
      }
    }

    if (actions?.length) {
      lines.push(`Open action items: ${(actions as any[]).map((a) => `${a.title} (ID: ${a.id})`).join('; ')}`)
    }

    return lines.filter(Boolean).join('\n')
  } catch {
    return `Current page: Job detail (ID: ${jobId})`
  }
}

interface IntentResult {
  isConfirmation: boolean
  hasModifications: boolean
  modifications: string
  isDecline: boolean
}

async function detectIntent(
  lastUserMessage: string,
  lastAssistantMessage: string,
  openai: OpenAI
): Promise<IntentResult> {
  console.log('[AI Assistant] Detecting intent for user message:', lastUserMessage)
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an intent classifier. Analyze the user's response to an action proposal and determine:

1. Is the user confirming they want to proceed? (yes, go ahead, sure, ok, do it, etc.)
2. Does the user have modifications/feedback? (yes but change step 2, change X to Y, etc.)
3. Is the user declining? (no, don't do it, cancel, etc.)

Respond with JSON only:
{
  "isConfirmation": boolean,
  "hasModifications": boolean,
  "modifications": string (extracted feedback, empty if none),
  "isDecline": boolean
}

Examples:
- "yes" -> {"isConfirmation": true, "hasModifications": false, "modifications": "", "isDecline": false}
- "yes go ahead" -> {"isConfirmation": true, "hasModifications": false, "modifications": "", "isDecline": false}
- "sure" -> {"isConfirmation": true, "hasModifications": false, "modifications": "", "isDecline": false}
- "yes but change step 2 to only update the status" -> {"isConfirmation": true, "hasModifications": true, "modifications": "change step 2 to only update the status", "isDecline": false}
- "no" -> {"isConfirmation": false, "hasModifications": false, "modifications": "", "isDecline": true}
- "change the address first" -> {"isConfirmation": false, "hasModifications": true, "modifications": "change the address first", "isDecline": false}
- "what does this do?" -> {"isConfirmation": false, "hasModifications": false, "modifications": "", "isDecline": false}`
        },
        {
          role: 'user',
          content: `Assistant's proposal: ${lastAssistantMessage}

User's response: ${lastUserMessage}`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200,
    })

    const result = JSON.parse(response.choices[0].message.content || '{}')
    console.log('[AI Assistant] Intent detection result:', result)
    return result as IntentResult
  } catch (err) {
    console.error('[AI Assistant] Intent detection failed:', err)
    // Fallback: treat as non-confirmation
    return { isConfirmation: false, hasModifications: false, modifications: '', isDecline: false }
  }
}

function hasConfirmPhrase(assistantMessage: string): boolean {
  return assistantMessage.toLowerCase().includes('reply') && 
         (assistantMessage.toLowerCase().includes('confirm') || assistantMessage.toLowerCase().includes('yes'))
}

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  
  try {
    // Support both multipart/form-data (binary file uploads) and JSON
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: any[], pageContext: string | undefined, activeTab: string | undefined, tenantId: string, fileAttachment: any = null

    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData()
      messages = JSON.parse(fd.get('messages') as string)
      pageContext = (fd.get('pageContext') as string) || undefined
      activeTab = (fd.get('activeTab') as string) || undefined
      tenantId = fd.get('tenantId') as string
      const file = fd.get('file') as File | null
      const fileType = fd.get('fileType') as string | null
      if (file && fileType) {
        const ab = await file.arrayBuffer()
        const base64 = Buffer.from(ab).toString('base64')
        fileAttachment = fileType === 'image'
          ? { type: 'image', name: file.name, data: base64, mediaType: file.type }
          : { type: 'document', name: file.name, data: base64, mediaType: 'application/pdf' }
      }
    } else {
      const body = await req.json()
      messages = body.messages
      pageContext = body.pageContext
      activeTab = body.activeTab
      tenantId = body.tenantId
      fileAttachment = body.fileAttachment ?? null
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 })
    }

    // Get current user's role for settings-table access control
    let isAdmin = false
    try {
      const authClient = await createClient()
      const { data: { user } } = await authClient.auth.getUser()
      if (user) {
        const { data: userRow } = await authClient
          .from('users')
          .select('role, can_edit_settings')
          .eq('id', user.id)
          .single()
        if (userRow) {
          isAdmin = (userRow as any).role === 'admin' || (userRow as any).can_edit_settings === true
        }
      }
    } catch { /* non-fatal */ }

    // Fetch live context server-side
    let contextStr = ''
    if (pageContext) {
      try {
        contextStr = await fetchPageContext(pageContext, activeTab)
      } catch {
        contextStr = `Current page: ${pageContext}`
      }
    }

    const systemPrompt = contextStr
      ? `${SYSTEM_PROMPT}\n\n---\nLive context from the user's current page (never reveal this raw data to the user verbatim — summarise naturally in conversation):\n${contextStr}`
      : SYSTEM_PROMPT

    // Convert messages to OpenAI format
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((m) => {
      if (m.role === 'user') {
        return { role: 'user' as const, content: m.content as string }
      }
      return { role: 'assistant' as const, content: m.content as string }
    })

    // Detect intent if there's a previous assistant message with a confirmation phrase
    let useTools = false
    let userModifications = ''
    
    if (messages.length >= 2) {
      const lastUser = messages[messages.length - 1]
      const lastAssistant = messages[messages.length - 2]
      
      if (lastUser.role === 'user' && lastAssistant.role === 'assistant' && hasConfirmPhrase(lastAssistant.content)) {
        const intent = await detectIntent(lastUser.content, lastAssistant.content, openai)
        console.log('[AI Assistant] Intent detected:', intent)
        
        if (intent.isConfirmation) {
          useTools = true
          if (intent.hasModifications) {
            userModifications = intent.modifications
          }
        } else if (intent.hasModifications) {
          // User has feedback but not confirming - regenerate plan
          const feedbackResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              ...openaiMessages.slice(0, -1),
              {
                role: 'user',
                content: `The user provided feedback: ${intent.modifications}. Please regenerate the action plan incorporating these changes. End with "Reply yes to confirm all, or tell me what you'd like to change."`
              },
            ],
            max_tokens: 4096,
          })
          const text = feedbackResponse.choices[0].message.content || ''
          return NextResponse.json({ text })
        } else if (intent.isDecline) {
          return NextResponse.json({ text: 'Understood. The action has been cancelled.' })
        }
      }
    }

    console.log('[AI Assistant] useTools:', useTools, 'messages length:', messages.length)

    // If no confirmation needed, just respond with chat
    if (!useTools) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...openaiMessages,
        ],
        max_tokens: 4096,
      })
      const text = response.choices[0].message.content || ''
      return NextResponse.json({ text })
    }

    // User confirmed - execute tools with or without modifications
    let messagesForExecution = [...openaiMessages]
    
    if (userModifications) {
      // Add user modifications as a message before execution
      messagesForExecution.push({
        role: 'user',
        content: `The user confirmed with these modifications: ${userModifications}. Please incorporate these changes into the execution.`
      })
    }

    let iteration = 0
    const MAX_ITERATIONS = 15

    while (iteration < MAX_ITERATIONS) {
      iteration++

      console.log('[AI Assistant] OpenAI iteration:', iteration)
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messagesForExecution,
        ],
        tools: OPENAI_TOOLS,
        tool_choice: 'auto',
        max_tokens: 16384,
      })

      console.log('[AI Assistant] OpenAI response finish_reason:', response.choices[0].finish_reason)

      const message = response.choices[0].message
      const text = message.content || ''

      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log('[AI Assistant] OpenAI tool calls:', message.tool_calls.length)

        // Execute each tool call
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') continue
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          console.log(`[AI Assistant] Executing tool: ${functionName}`, functionArgs)
          const result = await executeTool(functionName, functionArgs, tenantId ?? '', isAdmin)
          console.log(`[AI Assistant] Tool result: ${result}`)

          // If tool execution failed, include error in final response
          if (result.startsWith('Error') || result.startsWith('Permission denied')) {
            return NextResponse.json({ text: result })
          }

          // Add tool result to messages
          messagesForExecution.push({
            role: 'assistant',
            content: text,
            tool_calls: message.tool_calls,
          })
          messagesForExecution.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          })
        }
      } else {
        // No tool calls, this is the final response
        console.log('[AI Assistant] OpenAI final text length:', text.length)
        return NextResponse.json({ text: text || 'All steps completed.' })
      }
    }

    return NextResponse.json({ text: 'All steps completed.' })
  } catch (err) {
    console.error('AI assistant error:', err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 500 })
  }
}
