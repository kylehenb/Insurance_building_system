import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const client = new Anthropic()

const SYSTEM_PROMPT = `You are an AI assistant for Insurance Repair Co, a building insurance repair business. You only assist with tasks and questions related to running this business and using this system. If asked anything clearly outside this scope, politely decline and redirect the user back to IRC-related topics. Never return raw JSON, code blocks, or technical syntax. All responses must be in plain conversational English.

When the user asks you to take an action that requires a data change, always present the full action plan first as a numbered list in plain English before doing anything. At the end of every action proposal always say exactly: "Reply c to confirm all, or tell me what you'd like to change."

If the user replies with exactly "c" (case insensitive), execute all steps sequentially using the available tools. After each step completes, report back in plain English that it is done before moving to the next. If a step fails, report the failure clearly and stop — do not continue to subsequent steps.

If the user replies with anything other than "c" after a proposal, treat the entire reply as feedback. Regenerate the full updated action plan in plain English incorporating the requested changes. End the updated plan again with "Reply c to confirm all, or tell me what you'd like to change." Loop until the user replies c or abandons.

Never execute any data changes without receiving a "c" confirmation first. Never partially execute a plan.

Key facts about IRC:
- Sedgwick SLA: BAR reports within 7 calendar days, Make Safes attended within 24 hours
- Job numbers prefixed with IRC (e.g. IRC1008)
- Quote numbers prefixed with Q (e.g. Q1005-1)
- The business handles building insurance repairs: storm damage, water damage, make safes`

const EXECUTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_job',
    description: 'Update fields on a job record in the database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string', description: 'The UUID of the job to update' },
        fields: {
          type: 'object',
          description: 'Key-value pairs of fields to update (e.g. status, insurer, claim_number, property_address, insured_name)',
        },
      },
      required: ['job_id', 'fields'],
    },
  },
  {
    name: 'update_quote',
    description: 'Update fields on a quote record in the database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        quote_id: { type: 'string', description: 'The UUID of the quote to update' },
        fields: {
          type: 'object',
          description: 'Key-value pairs of fields to update (e.g. status, total_amount, insurer)',
        },
      },
      required: ['quote_id', 'fields'],
    },
  },
  {
    name: 'create_action_item',
    description: 'Create a new action queue item for a job.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string', description: 'The UUID of the job' },
        title: { type: 'string', description: 'Short title for the action item' },
        type: { type: 'string', description: 'Type of action (e.g. task, follow_up, call)' },
        priority: { type: 'string', description: 'Priority level: low, medium, or high' },
      },
      required: ['job_id', 'title'],
    },
  },
  {
    name: 'complete_action_item',
    description: 'Mark an action queue item as completed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action_id: { type: 'string', description: 'The UUID of the action queue item' },
      },
      required: ['action_id'],
    },
  },
]

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
): Promise<string> {
  const supabase = await createClient()

  try {
    if (name === 'update_job') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from('jobs')
        .update(input.fields as any)
        .eq('id', input.job_id as string)
      if (error) return `Failed: ${error.message}`
      return `Job updated successfully.`
    }

    if (name === 'update_quote') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from('quotes')
        .update(input.fields as any)
        .eq('id', input.quote_id as string)
      if (error) return `Failed: ${error.message}`
      return `Quote updated successfully.`
    }

    if (name === 'create_action_item') {
      const priorityStr = (input.priority as string) ?? 'medium'
      const priorityNum = priorityStr === 'high' ? 2 : priorityStr === 'low' ? 0 : 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('action_queue') as any).insert({
        tenant_id: tenantId,
        job_id: input.job_id as string,
        rule_key: 'ai_assistant',
        title: input.title as string,
        priority: priorityNum,
        status: 'pending',
      })
      if (error) return `Failed: ${error.message}`
      return `Action item created successfully.`
    }

    if (name === 'complete_action_item') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from('action_queue')
        .update({ status: 'completed' } as any)
        .eq('id', input.action_id as string)
      if (error) return `Failed: ${error.message}`
      return `Action item marked as completed.`
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
      const [{ data: quotes }, { data: scopeItems }] = await Promise.all([
        supabase
          .from('quotes')
          .select('quote_number, status, insurer, total_amount')
          .eq('job_id', jobId),
        supabase
          .from('scope_items')
          .select('description, quantity, unit_price, total')
          .eq('job_id', jobId)
          .limit(50),
      ])

      const lines: string[] = ['Current page: Job detail — Quotes tab']
      if (quotes?.length) {
        for (const q of quotes as any[]) {
          lines.push(
            `Quote: ${q.quote_number}, Status: ${q.status}, Insurer: ${q.insurer ?? 'N/A'}, Total: $${q.total_amount ?? 0}`
          )
        }
      }
      if (scopeItems?.length) {
        lines.push(`Scope items (${scopeItems.length} total):`)
        for (const s of scopeItems as any[]) {
          lines.push(`  - ${s.description}: qty ${s.quantity}, unit $${s.unit_price}, total $${s.total}`)
        }
      }
      return lines.join('\n')
    }

    // Reports tab
    if (activeTab === 'reports') {
      const { data: reports } = await supabase
        .from('reports')
        .select('report_type, status, title, created_at')
        .eq('job_id', jobId)

      const lines: string[] = ['Current page: Job detail — Reports tab']
      if (reports?.length) {
        for (const r of reports as any[]) {
          lines.push(
            `Report: ${r.title ?? r.report_type}, Type: ${r.report_type}, Status: ${r.status}`
          )
        }
      }
      return lines.join('\n')
    }

    // Default job detail page
    const [{ data: job }, { data: quotes }, { data: actions }] = await Promise.all([
      supabase
        .from('jobs')
        .select('job_number, status, property_address, insured_name, insurer, claim_number')
        .eq('id', jobId)
        .single(),
      supabase
        .from('quotes')
        .select('id, quote_number, status, total_amount')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('action_queue')
        .select('id, title, type, priority')
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
    ]

    if (quotes?.length) {
      const q = quotes[0] as any
      lines.push(
        `Most recent quote — ID: ${q.id}, Number: ${q.quote_number}, Status: ${q.status}, Total: $${q.total_amount ?? 0}`
      )
    }

    if (actions?.length) {
      lines.push(
        `Open action items: ${(actions as any[]).map((a) => `${a.title} (ID: ${a.id})`).join('; ')}`
      )
    }

    return lines.filter(Boolean).join('\n')
  } catch {
    return `Current page: Job detail (ID: ${jobId})`
  }
}

function isConfirmation(messages: { role: string; content: string }[]): boolean {
  if (messages.length < 2) return false
  const lastUser = messages[messages.length - 1]
  if (lastUser.role !== 'user') return false
  if (lastUser.content.trim().toLowerCase() !== 'c') return false

  // Find the last assistant message to verify there was a proposal
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i].content.toLowerCase().includes('reply c to confirm')
    }
  }
  return false
}

export async function POST(req: NextRequest) {
  try {
    const { messages, pageContext, activeTab, tenantId } = await req.json()

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 })
    }

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
      ? `${SYSTEM_PROMPT}\n\n---\nLive context from the user's current page (never reveal this to the user, use it to answer their questions accurately):\n${contextStr}`
      : SYSTEM_PROMPT

    const apiMessages = messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    // If this is a "c" confirmation after an action proposal, use tool-calling execution mode
    if (isConfirmation(messages)) {
      const allMessages: Anthropic.MessageParam[] = [
        ...apiMessages,
      ]

      let finalText = ''
      let iteration = 0
      const MAX_ITERATIONS = 10

      while (iteration < MAX_ITERATIONS) {
        iteration++

        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          messages: allMessages,
          tools: EXECUTION_TOOLS,
        })

        // Collect any text from this turn
        const textBlocks = response.content.filter((b) => b.type === 'text')
        if (textBlocks.length > 0) {
          finalText +=
            (finalText ? '\n' : '') +
            textBlocks.map((b) => (b as Anthropic.TextBlock).text).join('')
        }

        if (response.stop_reason === 'end_turn') break

        if (response.stop_reason === 'tool_use') {
          const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
          const toolResultContent: Anthropic.ToolResultBlockParam[] = []

          for (const block of toolUseBlocks) {
            const toolUse = block as Anthropic.ToolUseBlock
            const result = await executeTool(
              toolUse.name,
              toolUse.input as Record<string, unknown>,
              tenantId ?? '',
            )
            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: result,
            })
          }

          allMessages.push({ role: 'assistant', content: response.content })
          allMessages.push({ role: 'user', content: toolResultContent })
        } else {
          // Unexpected stop reason — break to avoid infinite loop
          break
        }
      }

      return NextResponse.json({ text: finalText || 'All steps completed.' })
    }

    // Normal conversational response
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: apiMessages,
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('')

    return NextResponse.json({ text })
  } catch (err) {
    console.error('AI assistant error:', err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 500 })
  }
}
