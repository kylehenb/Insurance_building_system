import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { runAssistantTurn } from '@/lib/ai/assistant'

// The in-app assistant (floating chat and dashboard chat): Claude with the
// voice connector's tools, acting as the signed-in user — lib/ai/assistant.ts.
// The browser keeps the conversation (`history`) and sends it back each time.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A turn can run several tools, and sends can render PDFs
export const maxDuration = 300

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type MessageParam = Anthropic.Beta.BetaMessageParam
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam

/** A conversation sent back by the browser: user/assistant turns only */
function validHistory(value: unknown): MessageParam[] | null {
  if (value == null) return []
  if (!Array.isArray(value)) return null
  const ok = value.every(m => m && typeof m === 'object'
    && (m.role === 'user' || m.role === 'assistant')
    && (typeof m.content === 'string' || Array.isArray(m.content)))
  return ok ? value as MessageParam[] : null
}

/** The new message: where the user is, any attached file, then what they typed */
function userContent(text: string, context: string, file: { type: string; name: string; data: string; mediaType?: string } | null): ContentBlockParam[] {
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth', dateStyle: 'full', timeStyle: 'short' })
  const blocks: ContentBlockParam[] = [{ type: 'text', text: `[${now}. ${context}]` }]
  if (file?.type === 'image') {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType as 'image/png', data: file.data } })
  } else if (file?.type === 'document') {
    blocks.push({ type: 'document', title: file.name, source: { type: 'base64', media_type: 'application/pdf', data: file.data } })
  } else if (file?.type === 'text') {
    blocks.push({ type: 'text', text: `Attached file ${file.name}:\n${file.data}` })
  }
  blocks.push({ type: 'text', text })
  return blocks
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

export async function POST(req: NextRequest) {
  // Signed-in users only; the tenant is always the session's, never the request's
  const user = await sessionUser()
  if (!user) return unauthorized()

  let messages: { role: string; content: string }[]
  let rawHistory: unknown, pageContext: string | undefined, activeTab: string | undefined
  let file: { type: string; name: string; data: string; mediaType?: string } | null = null
  try {
    // multipart/form-data when an image or PDF is attached, JSON otherwise
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const fd = await req.formData()
      messages = JSON.parse(fd.get('messages') as string)
      rawHistory = fd.get('history') ? JSON.parse(fd.get('history') as string) : null
      pageContext = (fd.get('pageContext') as string) || undefined
      activeTab = (fd.get('activeTab') as string) || undefined
      const upload = fd.get('file') as File | null
      const fileType = fd.get('fileType') as string | null
      if (upload && fileType) {
        const data = Buffer.from(await upload.arrayBuffer()).toString('base64')
        file = { type: fileType === 'image' ? 'image' : 'document', name: upload.name, data, mediaType: upload.type }
      }
    } else {
      const body = await req.json()
      messages = body.messages
      rawHistory = body.history
      pageContext = body.pageContext
      activeTab = body.activeTab
      file = body.fileAttachment ?? null
    }
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const last = Array.isArray(messages) ? messages[messages.length - 1] : null
  const history = validHistory(rawHistory)
  if (!last || last.role !== 'user' || typeof last.content !== 'string' || !history) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  let context = 'The user is somewhere in the app.'
  if (pageContext) {
    try {
      context = await fetchPageContext(pageContext, activeTab)
    } catch {
      context = `Current page: ${pageContext}`
    }
  }

  try {
    const turn = await runAssistantTurn({
      client: anthropic,
      history,
      userContent: userContent(last.content, context, file),
      ctx: { supabase: createServiceClient(), tenantId: user.tenantId, userId: user.userId },
    })
    return NextResponse.json(turn)
  } catch (err) {
    console.error('[assistant] turn failed:', err)
    // A tool may already have sent something before the failure
    return NextResponse.json({
      text: 'Something went wrong while I was working on that. If you asked me to send or change something, check the job (or Activity) before trying again.',
    })
  }
}
