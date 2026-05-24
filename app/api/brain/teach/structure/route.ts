import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { StructuredTeachOutput } from '@/types/brain'

export const dynamic = 'force-dynamic'

const ALLOWED_TAGS = [
  'cash-settlement', 'private-work', 'job-creation', 'quote-copy',
  'email-parsing', 'gary', 'scheduling', 'invoicing', 'report',
  'scope', 'insurer-comms', 'homeowner-comms',
]

const STRUCTURE_SYSTEM_PROMPT = `You are an AI assistant helping to structure and extract knowledge from plain-English process descriptions for an insurance repair company.

You will receive a dictation of a process/workflow and a trigger condition. Extract and return ONLY a JSON object with this exact structure (no preamble, no markdown fences, no explanation):

{
  "title": "A clear, concise workflow title in title case",
  "trigger_condition": "Complete sentence describing the specific condition that starts this process",
  "steps": [
    { "order": 1, "description": "Plain-English step description" }
  ],
  "variables": ["snake_case_variable_name"],
  "tags": [],
  "prompt_keys": [],
  "category": "workflow",
  "confidence": "medium"
}

Rules:
- title: Short, descriptive, title-case (e.g. "Cash Settled Job — Create Private Work Order")
- trigger_condition: One complete sentence describing when this process is triggered
- steps: Number each step clearly. Use plain English, no jargon.
- variables: Identify referenced entities that vary per use (e.g. "current_job_id", "homeowner_name", "new_job_id"). Use snake_case.
- tags: Only include tags from this list that genuinely apply: ${ALLOWED_TAGS.join(', ')}
- prompt_keys: Empty array unless clearly a tone/rule/example for a specific AI prompt context
- category: One of "workflow", "rule", "tone", "classification", "example", "correction"
- confidence: "low" if vague/incomplete, "medium" if reasonably clear, "high" if precise and complete

Return ONLY the JSON object. No other text.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    dictation: string
    trigger: string
    tenantId: string
  }

  const { dictation, trigger, tenantId } = body

  if (!dictation?.trim() || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const userContent = `Dictation:\n${dictation.trim()}\n\nTrigger condition:\n${trigger?.trim() || '(not specified)'}`

  let structured: StructuredTeachOutput
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: STRUCTURE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '{}'
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }
    structured = JSON.parse(match[0]) as StructuredTeachOutput
  } catch (e) {
    console.error('[brain/teach/structure] AI error:', e)
    return NextResponse.json({ error: 'AI call failed' }, { status: 500 })
  }

  // Best-effort audit log — ai_audit table created separately from brain module migration
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      await fetch(`${supabaseUrl}/rest/v1/ai_audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          category: 'brain_teach',
          prompt_key: 'brain_structure',
          created_by: user.id,
        }),
      })
    }
  } catch {
    // table may not exist yet — non-fatal
  }

  return NextResponse.json(structured)
}
