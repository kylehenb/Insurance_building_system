import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  await params // consume

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rawReportDump, propDesc, scopeItemCount, photoCount } = await req.json()

  if (!rawReportDump?.trim()) {
    return NextResponse.json({ ok: true, score: 5, summary: 'No raw report notes to review.', flags: [] })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are a quality reviewer for building insurance inspection reports. Review the following field inspection notes and provide a quality score and feedback.

Property Description: ${propDesc || '(not provided)'}

Raw Report Notes:
${rawReportDump}

Additional context:
- Scope items entered: ${scopeItemCount}
- Photos taken: ${photoCount}

Rate the quality of these notes on a scale of 1–10, considering:
- Clarity and detail of damage description
- Identification of cause of damage
- Mention of pre-existing conditions (or confirmation there are none)
- Professional terminology
- Completeness for an insurance assessor report

Return ONLY a JSON object with this exact structure:
{
  "score": <number 1-10>,
  "summary": "<one sentence summary of quality>",
  "flags": [
    {"type": "ok|warn", "msg": "<specific feedback>"}
  ]
}

Include 2–5 flags covering what's good and what's missing. Be specific and actionable.`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0]?.type === 'text' ? message.content[0].text : '{}'
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return NextResponse.json({ ok: false })

    const result = JSON.parse(match[0])
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('AI review error:', e)
    return NextResponse.json({ ok: false })
  }
}
