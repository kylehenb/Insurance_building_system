import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { trackAi } from '@/lib/health/ai-usage'
import { logError } from '@/lib/health/errors'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { PAGE_ONE_FORMAT, readPageOne } from '@/lib/reports/page-one'

export const dynamic = 'force-dynamic'

// Brings the roof report's page one (short cause and problem lines) back in step
// with the cause of damage after the inspector edited it, without rewriting the
// rest of the report: problems added get a line, problems taken out lose theirs,
// and everything still right stays word for word. Nothing is saved here: the
// field app puts the result in its draft like any edit.

const MODEL = 'claude-sonnet-4-6'

export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { specificCause, previousCause, causeSummary, problemSummaries } = await req.json() as Record<string, unknown>
  if (typeof specificCause !== 'string' || !specificCause.trim()) {
    return NextResponse.json({ error: 'specificCause is required' }, { status: 400 })
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const message = await trackAi({ feature: 'midcity-page-one', provider: 'anthropic', model: MODEL, tenantId: me.tenantId }, () => anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: `You keep page one of an Australian roof inspection report in step with its cause of damage. The inspector has edited the cause of damage (added, removed or changed problems). Update page one's two fields to match it.

${PAGE_ONE_FORMAT}

RULES FOR THIS UPDATE:
- The cause of damage is the source. Every problem letter in it gets a line in problemSummaries and a mention in causeSummary; a letter no longer in it is taken out of both.
- Change as little as possible. The inspector may have polished page one by hand: keep every line and phrase that still matches the cause word for word, and only add, remove or fix what the cause no longer supports.
- When the cause of damage as it was when page one was last written is given, compare it with the current one: that is exactly what the inspector changed. A problem whose points were reworded gets its page one wording brought in line with the new points (location, defect, numbers); a change that's only grammar or tidying needs no change on page one.
- Update any count in causeSummary ("from 3 defects") to match.
- Return ONLY JSON: {"causeSummary": "...", "problemSummaries": "..."}`,
      messages: [{
        role: 'user',
        content: `Cause of damage (current):\n${specificCause}\n\n${typeof previousCause === 'string' && previousCause.trim() && previousCause !== specificCause ? `Cause of damage when page one was last written:\n${previousCause}\n\n` : ''}Page one short cause (current):\n${typeof causeSummary === 'string' && causeSummary.trim() ? causeSummary : '(empty)'}\n\nPage one problem lines (current):\n${typeof problemSummaries === 'string' && problemSummaries.trim() ? problemSummaries : '(empty)'}`,
      }],
    }))
    const block = message.content[0]
    const pageOne = block?.type === 'text' ? readPageOne(block.text) : null
    if (!pageOne) {
      void logError('midcity-page-one', new Error('Unreadable AI reply'), { tenantId: me.tenantId })
      return NextResponse.json({ error: 'Could not read the AI reply' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, ...pageOne })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update page one', details: String(error) }, { status: 500 })
  }
}
