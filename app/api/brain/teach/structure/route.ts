import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { StructuredTeachOutput } from '@/types/brain'

export const dynamic = 'force-dynamic'

const ALLOWED_TAGS = [
  'cash-settlement', 'private-work', 'job-creation', 'quote-copy',
  'email-parsing', 'gary', 'scheduling', 'invoicing', 'report',
  'scope', 'insurer-comms', 'homeowner-comms',
]

const STRUCTURE_SYSTEM_PROMPT = `You are an AI assistant helping to structure and extract knowledge from plain-English descriptions for an insurance repair company.

You will receive a dictation of a rule, tone note, or process workflow and an optional trigger condition. Extract and return ONLY a JSON object with this exact structure (no preamble, no markdown fences, no explanation):

{
  "type": "note",
  "title": "A clear, concise title in title case",
  "trigger_condition": "Complete sentence describing when this applies, or empty string if not applicable",
  "steps": [],
  "variables": [],
  "tags": [],
  "prompt_keys": [],
  "category": "rule",
  "confidence": "medium"
}

Rules:
- type: "note" if the input is a simple rule, tone preference, short instruction, or single guideline — "workflow" if it describes a multi-step process (2+ distinct actions in sequence)
- title: Short, descriptive, title-case
- trigger_condition: One complete sentence describing when this applies. Empty string if it's a general standing rule with no specific trigger.
- steps: For "workflow" type, number each step clearly. For "note" type, leave as empty array [].
- variables: Identify referenced entities that vary per use (e.g. "current_job_id", "homeowner_name"). Use snake_case. Empty array [] for notes.
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

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: STRUCTURE_SYSTEM_PROMPT,
  })

  const userContent = `Dictation:\n${dictation.trim()}\n\nTrigger condition:\n${trigger?.trim() || '(not specified)'}`

  let structured: StructuredTeachOutput
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { maxOutputTokens: 1024 },
    })

    const raw = result.response.text()
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }
    structured = JSON.parse(match[0]) as StructuredTeachOutput
  } catch (e) {
    console.error('[brain/teach/structure] AI error:', e)
    return NextResponse.json({ error: 'AI call failed' }, { status: 500 })
  }

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
          model: 'gemini-3.5-flash',
          created_by: user.id,
        }),
      })
    }
  } catch {
    // non-fatal
  }

  return NextResponse.json(structured)
}
