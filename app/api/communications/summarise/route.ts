import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type Scope = 'recent' | 'full'

interface SummariseRequest {
  job_id?: unknown
  scope?: unknown
}

interface SummaryResult {
  where_its_at: string[]
  what_happened: string[]
  issues: string[]
  outstanding: string[]
}

function formatComm(c: {
  created_at: string | null
  type: string
  direction: string | null
  contact_name: string | null
  from_email: string | null
  contact_type: string | null
  subject: string | null
  content: string | null
  body_text: string | null
}): string {
  const date = c.created_at ? new Date(c.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date'
  const who = c.contact_name ?? c.from_email ?? 'Unknown'
  const dir = c.direction ? ` (${c.direction})` : ''
  const contactLabel = c.contact_type ? ` [${c.contact_type}]` : ''
  const body = c.body_text ?? c.content ?? ''
  const lines = [`[${date}] ${c.type.toUpperCase()}${dir} — ${who}${contactLabel}`]
  if (c.subject) lines.push(`Subject: ${c.subject}`)
  if (body) lines.push(body.slice(0, 600) + (body.length > 600 ? '…' : ''))
  return lines.join('\n')
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  let jobId: string
  let scope: Scope
  try {
    const body = await req.json() as SummariseRequest
    if (typeof body.job_id !== 'string' || !body.job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
    }
    jobId = body.job_id
    scope = body.scope === 'recent' ? 'recent' : 'full'
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = await createClient()
  const serviceClient = createServiceClient()

  // Fetch job details for context
  const { data: job } = await serviceClient
    .from('jobs')
    .select('job_number,insured_name,property_address,claim_number,insurer,created_at')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  // Fetch communications
  let commsQuery = supabase
    .from('communications')
    .select('created_at,type,direction,contact_name,from_email,contact_type,subject,content,body_text')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })

  if (scope === 'recent') {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    commsQuery = commsQuery.gte('created_at', cutoff)
  }

  // Cap at 60 entries to avoid token blowout on high-volume jobs
  commsQuery = commsQuery.limit(60)

  const { data: comms } = await commsQuery

  // Fetch job notes
  const { data: notes } = await supabase
    .from('job_notes')
    .select('created_at,content')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })

  const jobLabel = job
    ? `${job.job_number} — ${job.insured_name ?? 'Unknown insured'} at ${job.property_address ?? 'Unknown address'}`
    : `Job ${jobId}`
  const claimLabel = job
    ? `${job.claim_number ?? 'No claim number'} (${job.insurer ?? 'Unknown insurer'})`
    : 'Unknown claim'
  const scopeLabel = scope === 'recent' ? 'Last 14 days' : `Full history from ${job?.created_at ? new Date(job.created_at).toLocaleDateString('en-AU') : 'job open'}`

  const commsText = (comms ?? []).map(formatComm).join('\n\n---\n\n')
  const notesText = (notes ?? [])
    .map(n => {
      const d = n.created_at ? new Date(n.created_at).toLocaleDateString('en-AU') : ''
      return `[${d}] ${n.content}`
    })
    .join('\n')

  const systemPrompt = `You are a communications analyst for an insurance building repair company (IRC).
You review job communications to produce concise, factual summaries for the operations team.
Use plain Australian English. Be specific — include names, dates, key facts.
State facts directly; avoid filler phrases like "it appears" or "it seems".

Output ONLY valid JSON in this exact shape:
{
  "where_its_at": ["..."],
  "what_happened": ["..."],
  "issues": ["..."],
  "outstanding": ["..."]
}

Rules:
- where_its_at: 1–2 bullets. Current status and stage right now.
- what_happened: 3–5 bullets. Key chronological events.
- issues: 0–3 bullets. Problems, delays, complaints, things worth flagging. Empty array if none.
- outstanding: 2–4 bullets. Unresolved items, pending actions, things waiting on someone.
- Each bullet is one complete sentence, max two lines.
- Do not include meta-commentary about the number of communications.`

  const userMessage = `Job: ${jobLabel}
Claim: ${claimLabel}
Period: ${scopeLabel}

--- COMMUNICATIONS (${(comms ?? []).length} entries) ---
${commsText || '(none)'}

--- JOB NOTES ---
${notesText || '(none)'}

Generate the summary JSON.`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const responseText = message.content[0]?.type === 'text' ? message.content[0].text : ''

    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[summarise] No JSON in Claude response:', responseText)
      return NextResponse.json({ error: 'AI did not return a structured summary' }, { status: 500 })
    }

    let summary: SummaryResult
    try {
      summary = JSON.parse(jsonMatch[0]) as SummaryResult
    } catch {
      console.error('[summarise] Failed to parse Claude JSON:', jsonMatch[0])
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    return NextResponse.json(summary)
  } catch (err) {
    console.error('[summarise] Claude error:', err)
    return NextResponse.json({ error: 'AI service error' }, { status: 502 })
  }
}
